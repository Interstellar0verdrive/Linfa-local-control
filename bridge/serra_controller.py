#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Serra Controller (CLI only) - UART console root -> comandi hardware via /dev/tty-local e /dev/tty-nebbia.

Obiettivo:
- Comandi "umani" (lights/fans/pump/ring/checkup/net) + sottocomandi MQTT (state/uptime/foto)
- MQTT integrato: bridge, publish QoS1, stati retained per HA
- Robustezza: login root via console + marker di conferma per ogni comando

Install alias "serra":
  sudo chmod +x /home/pi/serra_controller.py
  sudo ln -sf /home/pi/serra_controller.py /usr/local/bin/serra

NOTA DOCUMENTAZIONE CLI:
- La guida lunga all'uso della CLI è stata spostata in un file di testo esterno.
- Per modificarla, edita `serra_help.txt` accanto a questo script.
"""

import argparse
import getpass
import os
import re
import stat
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

import fcntl
import json
import threading
import socket
import tempfile

import serial
from serial.serialutil import SerialException
from zoneinfo import ZoneInfo

try:
    import paho.mqtt.client as mqtt
except Exception:  # pragma: no cover
    mqtt = None


# ---------------------------
# Config di base (Raspberry)
# ---------------------------

DEFAULT_SERIAL_PORT = os.environ.get("SERRA_UART_PORT", "/dev/ttyUSB0")
DEFAULT_BAUDRATE = int(os.environ.get("SERRA_UART_BAUD", "115200"))
DEFAULT_TRANSPORT = os.environ.get("SERRA_TRANSPORT", "uart").strip().lower()
DEFAULT_PRIMARY_TRANSPORT = os.environ.get("SERRA_PRIMARY_TRANSPORT", "wifi").strip().lower()
DEFAULT_SSH_HOST = os.environ.get("SERRA_SSH_HOST", "").strip()
DEFAULT_SSH_PORT = int(os.environ.get("SERRA_SSH_PORT", "22"))

# Lockfile per serializzare gli accessi concorrenti alla UART tra invocazioni
# `serra` (bridge MQTT, timer systemd, comandi manuali via SSH).
UART_LOCK_PATH = os.environ.get("SERRA_DEVICE_LOCK", os.environ.get("SERRA_UART_LOCK", "/tmp/serra-uart.lock"))
UART_LOCK_TIMEOUT_S = float(os.environ.get("SERRA_UART_LOCK_TIMEOUT", "20").strip() or "20")

# Credenziali console serra (BusyBox login)
# I servizi usano l'ambiente; la CLI manuale può usare un file privato di pi.
DEFAULT_USER = os.environ.get("SERRA_ROOT_USER", "root")
LOCAL_PASSWORD_FILE = os.path.expanduser("~/.config/serra/root-password")

# Limiti e costanti "magiche" resi espliciti
MAX_PUMP_DURATION_S = 300                   # secondi massimi pompa principale
MAX_NUTRIENT_DURATION_S = 60.0              # limite collaudato sul Raspberry
MAX_NUTRIENT_TIMES = 100                    # ripetizioni massime pompa nutrienti
MAX_NUTRIENT_INTERVAL_S = 120.0             # intervallo massimo tra ripetizioni nutrienti
# La UART resta occupata per tutta la sequenza. Il limite dipende dal timeout
# del lock, per lasciare tempo ai comandi concorrenti di acquisirlo.
MAX_SEQUENCE_TOTAL_S = UART_LOCK_TIMEOUT_S * 0.6
# Dead-man pompa principale (backstop lato Pi, INDIPENDENTE da HA): margine dopo
# la fine prevista oltre cui un processo staccato forza 'pump main off'. Copre il
# caso di pompa avviata mentre HA e' giu'/disconnessa E il tick di auto-spegnimento
# del firmware VoCore si perde -> altrimenti pompa accesa a tempo indeterminato
# (allagamento). E' l'analogo, lato controller, del "belt" gia' presente in HA.
PUMP_DEADMAN_MARGIN_S = float(os.environ.get("SERRA_PUMP_DEADMAN_MARGIN", "20").strip() or "20")
MIN_FAN_RELIABLE_PCT = 40                   # sotto questo %, la ventola può non partire
MAX_LIGHT_FADE_UNITS = 0xFFF                # 12-bit fade luci
MAX_RING_FADE_UNITS = 0xFF                  # 8-bit fade ring
SERIAL_READ_CHUNK_SIZE = 4096               # dimensione lettura seriale
STATE_SCHEMA_VERSION = 1                    # versione schema file stato
HELP_FILE_NAME = "serra_help.txt"


# ---------------------------
# Errori custom
# ---------------------------

class SerraError(Exception):
    """Errore base per Serra controller."""
    pass


class SerraCommandError(SerraError):
    """Errore di uso/parametri della CLI."""
    pass


class SerraConnectionError(SerraError):
    """Errore di connessione/seriale/MQTT."""
    pass


class SerraUncertainError(SerraConnectionError):
    """Il comando potrebbe essere stato eseguito: non ritentarlo su un altro canale."""
    pass


def _resolve_console_password() -> str:
    """Preferisce la variabile dei servizi, poi il file privato della CLI."""
    password = os.environ.get("SERRA_ROOT_PASSWORD", "")
    if password:
        return password
    try:
        fd = os.open(LOCAL_PASSWORD_FILE, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return ""
    except OSError as exc:
        raise SerraCommandError(f"Impossibile leggere {LOCAL_PASSWORD_FILE}: {exc}") from exc
    with os.fdopen(fd, "r", encoding="utf-8") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise SerraCommandError(
                f"{LOCAL_PASSWORD_FILE} deve essere un file tuo, leggibile solo da te (chmod 600)"
            )
        return source.read().rstrip("\r\n")


def _save_console_password(password: str) -> None:
    if not password:
        raise SerraCommandError("Password vuota: nessun file salvato")
    directory = os.path.dirname(LOCAL_PASSWORD_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    info = os.lstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise SerraCommandError(f"La cartella {directory} deve appartenere all'utente corrente")
    os.chmod(directory, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=".root-password-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            target.write(password + "\n")
        os.replace(temporary, LOCAL_PASSWORD_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def do_auth_save() -> None:
    password = os.environ.get("SERRA_ROOT_PASSWORD", "")
    if not password:
        try:
            password = getpass.getpass("Password della console della serra: ")
            repeated = getpass.getpass("Ripeti la password: ")
        except (EOFError, KeyboardInterrupt) as exc:
            raise SerraCommandError("Inserimento password interrotto") from exc
        if password != repeated:
            raise SerraCommandError("Le password non coincidono; nessun file salvato")
    _save_console_password(password)
    print(f"Credenziale salvata in {LOCAL_PASSWORD_FILE} (accessibile solo a questo utente)")


# ---------------------------
# Utility
# ---------------------------

def eprint(*args, **kwargs) -> None:
    print(*args, file=sys.stderr, **kwargs)


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(v, hi))


def now_ms() -> int:
    return int(time.time() * 1000)


def sleep_s(seconds: float) -> None:
    if seconds <= 0:
        return
    time.sleep(seconds)


# ---------------------------
# Stato + MQTT (opzionale)
# ---------------------------

STATE_FILE_DEFAULT = os.environ.get("SERRA_STATE_FILE", os.path.expanduser("~/.serra_state.json"))
# Lock dedicato tenuto per l'INTERO read-modify-write di state.json
# (load->modify->save), NON solo per il dump come il flock in _save_state:
# serializza _record (durante un comando, con UART lock tenuto) e do_state_sync
# (che NON prende la UART, es. dal timer/belt/fine-nutrient_run) -> niente
# lost-update del record. Best-effort: su timeout prosegue (meglio scrivere che
# bloccare per sempre).
STATE_LOCK_PATH = STATE_FILE_DEFAULT + ".lock"


class _StateLock:
    def __init__(self, timeout: float = 10.0):
        self._timeout = timeout
        self._f = None

    def __enter__(self):
        try:
            os.makedirs(os.path.dirname(STATE_LOCK_PATH) or ".", exist_ok=True)
            self._f = open(STATE_LOCK_PATH, "w")
        except Exception:
            self._f = None
            return self
        end = time.time() + self._timeout
        while True:
            try:
                fcntl.flock(self._f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.time() >= end:
                    return self  # best-effort
                time.sleep(0.05)

    def __exit__(self, *exc):
        if self._f is not None:
            try:
                fcntl.flock(self._f, fcntl.LOCK_UN)
            finally:
                self._f.close()
        return False


MQTT_HOST = os.environ.get("SERRA_MQTT_HOST", "").strip()
MQTT_PORT = int(os.environ.get("SERRA_MQTT_PORT", "1883").strip() or "1883")
MQTT_USER = os.environ.get("SERRA_MQTT_USER", "").strip()
MQTT_PASS = os.environ.get("SERRA_MQTT_PASS", "")
SERRA_CLI = os.environ.get("SERRA_CLI", "serra")
MQTT_TOPIC = os.environ.get("SERRA_MQTT_TOPIC", "serra").strip() or "serra"

MQTT_CLIENT_ID = os.environ.get("SERRA_MQTT_CLIENT_ID", "serra-controller").strip() or "serra-controller"
MQTT_ENABLED = bool(MQTT_HOST)  # solo "host presente" (la libreria è verificata da _mqtt_enabled)

# Timeout (secondi) per il connect al broker: evita che un broker irraggiungibile
# blocchi il comando (e, a cascata, il bridge MQTT che è single-thread).
MQTT_CONNECT_TIMEOUT = float(os.environ.get("SERRA_MQTT_CONNECT_TIMEOUT", "4").strip() or "4")

ROME_TZ = ZoneInfo("Europe/Rome")


def now_ts() -> Dict[str, Any]:
    """Ritorna ts epoch + ISO UTC + ISO locale (Europe/Rome)."""
    t = time.time()
    dt_utc = datetime.fromtimestamp(t, tz=timezone.utc)
    dt_local = dt_utc.astimezone(ROME_TZ)
    return {
        "ts": t,
        "ts_iso": dt_utc.isoformat().replace("+00:00", "Z"),
        "ts_local": dt_local.isoformat(),
    }


def make_until_timestamps(seconds_from_now: float) -> Dict[str, Any]:
    """
    Crea un blocco standardizzato di campi until_* (epoch, ISO UTC, ISO locale)
    a partire da una durata in secondi a partire da ora.
    """
    until = time.time() + float(seconds_from_now)
    dt_utc = datetime.fromtimestamp(until, tz=timezone.utc)
    dt_local = dt_utc.astimezone(ROME_TZ)
    return {
        "until_ts": until,
        "until_iso": dt_utc.isoformat().replace("+00:00", "Z"),
        "until_local": dt_local.isoformat(),
    }


def _default_state() -> Dict[str, Any]:
    """Stato iniziale di default."""
    return {
        "meta": {"schema": STATE_SCHEMA_VERSION, **now_ts()},
        "last_seen": now_ts(),
        "lights": {"state": {}, "last": None},
        "fans": {"state": {}, "last": None},
        "ring": {"state": {}, "last": None},
        "pump_main": {"state": {}, "last": None},
        "net": {"state": {}, "last": None},
        "pump_nutrients": {
            "state": {"0": {}, "1": {}, "2": {}},
            "last": None,
        },
    }


def _load_state(path: str = STATE_FILE_DEFAULT) -> Dict[str, Any]:
    """
    Carica lo stato da JSON.

    - Se il file non esiste: ritorna stato di default.
    - Se il JSON è corrotto: logga un warning e ritorna stato di default.
    - Se ci sono errori di permesso: solleva un errore esplicito.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return _default_state()
    except json.JSONDecodeError as e:
        eprint(f"[state] Warning: state file {path} is corrupted, resetting: {e}")
        return _default_state()
    except PermissionError as e:
        raise SerraError(f"Cannot read state file {path}: {e}")
    except Exception as e:
        # Per qualsiasi altro errore inatteso, non nascondiamo il problema.
        raise SerraError(f"Unexpected error while loading state file {path}: {e}")


def _save_state(state: Dict[str, Any], path: str = STATE_FILE_DEFAULT) -> None:
    """
    Salva lo stato in modo atomico. _StateLock protegge l'intero ciclo
    lettura-modifica-scrittura tra processi.
    """
    dir_path = os.path.dirname(path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)

    fd, tmp = tempfile.mkstemp(prefix=".serra-state-", dir=dir_path or ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _mqtt_enabled() -> bool:
    return bool(MQTT_HOST) and mqtt is not None


def _mqtt_make_client(client_id: str):
    """Create a paho-mqtt Client without triggering the v1 callback API deprecation warning."""
    try:
        # paho-mqtt >= 2.0
        from paho.mqtt.client import CallbackAPIVersion  # type: ignore
        return mqtt.Client(
            client_id=client_id,
            clean_session=True,
            protocol=getattr(mqtt, "MQTTv311", 4),
            callback_api_version=CallbackAPIVersion.VERSION2,
        )
    except Exception:
        # paho-mqtt < 2.0 (no CallbackAPIVersion)
        return mqtt.Client(
            client_id=client_id,
            clean_session=True,
            protocol=getattr(mqtt, "MQTTv311", 4),
        )


def _broker_reachable(host: str, port: int, timeout: float) -> bool:
    """Verifica rapida (TCP) che il broker sia raggiungibile, con timeout.

    Evita che paho.connect() — bloccante e senza timeout — resti appeso per
    minuti quando l'host MQTT è irraggiungibile (HA in reboot, box spento, rete
    partizionata), congelando il comando e il bridge.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _wait_published(info, timeout: float) -> None:
    """Attende che un messaggio MQTT sia effettivamente uscito, con timeout,
    in modo compatibile sia con paho-mqtt >= 2.0 sia < 2.0."""
    try:
        info.wait_for_publish(timeout)  # paho >= 2.0 (accetta timeout)
    except TypeError:
        # paho < 2.0: wait_for_publish() non accetta timeout -> poll su is_published()
        end = time.time() + timeout
        while time.time() < end:
            try:
                if info.is_published():
                    return
            except Exception:
                return
            time.sleep(0.02)
    except Exception:
        # RuntimeError se il publish fallisce (es. disconnesso): non bloccare.
        return


class MQTTManager:
    """
    Gestisce una singola connessione MQTT riutilizzata per tutte le pubblicazioni
    durante l'esecuzione del processo, evitando di riconnettere per ogni messaggio.
    """
    _instance: Optional["MQTTManager"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._client = None
        self._connected = False
        self._pending: List[Any] = []  # MQTTMessageInfo da flushare prima del disconnect
        self._unreachable = False  # broker già rilevato irraggiungibile in questo processo

    @classmethod
    def get_instance(cls) -> "MQTTManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _ensure_client(self) -> None:
        if not _mqtt_enabled():
            return
        if self._client is not None and self._connected:
            return

        # Se in questo processo il broker è già risultato irraggiungibile, non
        # ripaghiamo il timeout del pre-flight a ogni publish (un comando ne fa ~13).
        if self._unreachable:
            return

        # Pre-flight: se il broker non è raggiungibile non tentiamo il connect
        # bloccante di paho. Il publish diventa un no-op (best-effort) e il
        # comando hardware prosegue senza restare appeso.
        if not _broker_reachable(MQTT_HOST, MQTT_PORT, MQTT_CONNECT_TIMEOUT):
            self._unreachable = True
            eprint(f"[mqtt] broker {MQTT_HOST}:{MQTT_PORT} non raggiungibile: publish saltato")
            return

        self._client = _mqtt_make_client(MQTT_CLIENT_ID)
        if MQTT_USER:
            self._client.username_pw_set(MQTT_USER, MQTT_PASS)
        self._client.on_disconnect = self._on_disconnect
        self._client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        self._client.loop_start()
        self._connected = True

    def _on_disconnect(self, client, userdata, *args) -> None:  # type: ignore[override]
        # Paho 1.x passa rc; Paho 2.x VERSION2 passa flags, reason_code, properties.
        self._connected = False

    def publish(self, topic: str, payload: Dict[str, Any], retain: bool = True) -> None:
        if not _mqtt_enabled():
            return
        self._ensure_client()
        if self._client is None or not self._connected:
            return
        data = json.dumps(payload, ensure_ascii=False)
        # QoS 1: consegna garantita al broker, così lo stato arriva a HA anche se
        # il processo si chiude subito dopo. Il flush effettivo è in close().
        info = self._client.publish(topic, data, qos=1, retain=retain)
        if info is not None:
            self._pending.append(info)

    def close(self) -> None:
        if self._client and self._connected:
            try:
                # Flush dei publish in sospeso PRIMA di disconnettere: senza questo,
                # chiudere il socket subito dopo il publish può far perdere gli
                # aggiornamenti di stato verso HA (era il difetto principale).
                deadline = time.time() + 5.0
                for info in self._pending:
                    _wait_published(info, max(0.0, deadline - time.time()))
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass
        self._pending = []
        self._client = None
        self._connected = False


def _mqtt_publish(topic: str, payload: Dict[str, Any], retain: bool = True) -> None:
    """Pubblica un JSON su MQTT (best-effort). Se MQTT non è configurato, no-op."""
    if not _mqtt_enabled():
        return
    MQTTManager.get_instance().publish(topic, payload, retain=retain)


def _publish_state_all(state: dict) -> None:
    """Publish current component states to MQTT (retained).

    NOTE: We intentionally do NOT publish any bulky aggregate like /state/all.
    We publish only the per-component topics that are useful in HA / MQTT Explorer.
    """
    if not MQTT_ENABLED:
        return
    base = MQTT_TOPIC.rstrip("/")

    # Lights
    _mqtt_publish(f"{base}/state/lights", state.get("lights", {}), retain=True)

    # Fans (split) - each fan gets only its own state and last
    fans = state.get("fans") or {}
    fans_state = fans.get("state") or {}
    for k in ("1", "2", "F"):
        fan_data = dict(fans_state.get(k, {}))  # copia per non modificare l'originale
        # Estrai last da dentro state e mettilo come fratello
        fan_last = fan_data.pop("last", None)
        payload = {"state": fan_data, "last": fan_last}
        _mqtt_publish(f"{base}/state/fans/fan-{k}", payload, retain=True)

    # Ring
    _mqtt_publish(f"{base}/state/ring", state.get("ring", {}), retain=True)

    # Pumps (split)
    _mqtt_publish(f"{base}/state/pumps/main", state.get("pump_main", {}), retain=True)

    # Nutrient pumps - each pump gets only its own state and last
    pn = state.get("pump_nutrients") or {}
    pn_state = pn.get("state") or {}
    for nid in ("0", "1", "2"):
        pump_data = dict(pn_state.get(nid, {}))  # copia per non modificare l'originale
        # Estrai last da dentro state e mettilo come fratello
        pump_last = pump_data.pop("last", None)
        payload = {"state": pump_data, "last": pump_last}
        _mqtt_publish(f"{base}/state/pumps/nutrient-{nid}", payload, retain=True)

    # Net (optional)
    if "net" in state:
        _mqtt_publish(f"{base}/state/net", state.get("net", {}), retain=True)


def _bump_last_seen(state: Dict[str, Any]) -> None:
    state["last_seen"] = now_ts()
    state.setdefault("meta", {})
    state["meta"].update(now_ts())


def _derive_running_flags(state: Dict[str, Any]) -> None:
    """Ricalcola running_now in base agli until_* (utile dopo reboot / crash)."""
    now = time.time()

    def derive_until(obj: Dict[str, Any]) -> Dict[str, Any]:
        until = obj.get("until_ts")
        if isinstance(until, (int, float)):
            running_now = now < float(until)
            obj["running_now"] = running_now
            if "running" in obj:
                obj["running"] = running_now
        else:
            if "running" in obj:
                obj["running_now"] = bool(obj["running"])
        return obj

    # pump main
    pm = state.get("pump_main", {}).get("state", {})
    if isinstance(pm, dict):
        derive_until(pm)

    # ring
    rg = state.get("ring", {}).get("state", {})
    if isinstance(rg, dict):
        if rg.get("mode") == "on":
            # Il fade termina, ma il ring resta acceso.
            rg["running_now"] = bool(rg.get("running"))
            transition_until = rg.get("transition_until_ts", rg.get("until_ts"))
            if isinstance(transition_until, (int, float)) and now >= transition_until:
                rg["transition"] = "complete"
        else:
            derive_until(rg)

    # lights fade
    li = state.get("lights", {}).get("state", {})
    if isinstance(li, dict):
        derive_until(li)

    # nutrient pumps
    pn_state = state.get("pump_nutrients", {}).get("state", {})
    if isinstance(pn_state, dict):
        for k in ("0", "1", "2"):
            if isinstance(pn_state.get(k), dict):
                derive_until(pn_state[k])


# ---------------------------
# UART Console Session
# ---------------------------

@dataclass
class ConsoleConfig:
    port: str = DEFAULT_SERIAL_PORT
    baudrate: int = DEFAULT_BAUDRATE
    user: str = DEFAULT_USER
    password: str = field(default_factory=_resolve_console_password)
    timeout: float = 0.2  # read timeout
    write_timeout: float = 1.0


class SerraConsole:
    """
    Gestisce:
    - apertura seriale (UART)
    - login root sulla console BusyBox
    - esecuzione comandi con marker di conferma
    """

    PROMPT_RE = re.compile(rb"(^|\n)#\s*$", re.M)  # prompt root "#"
    LOGIN_RE = re.compile(rb"(buildroot\s+login:|login:)\s*$", re.I | re.M)
    PASS_RE = re.compile(rb"Password:\s*$", re.I | re.M)

    def __init__(self, cfg: ConsoleConfig):
        self.cfg = cfg
        self.ser: Optional[serial.Serial] = None
        self._lock_fd = None  # fd del lockfile UART (flock)

    def _acquire_lock(self) -> None:
        """Acquisisce un lock esclusivo (flock) per serializzare gli accessi alla
        UART tra invocazioni concorrenti di `serra` (bridge, timer, SSH manuale).
        Se la porta è occupata, attende fino a UART_LOCK_TIMEOUT_S e poi fallisce
        in modo pulito, invece di corrompere lo stream seriale."""
        try:
            self._lock_fd = open(UART_LOCK_PATH, "w")
        except Exception as ex:
            # UART e SSH condividono il lock: procedere senza serializzazione
            # potrebbe sovrapporre comandi e lasciare lo stato hardware incerto.
            raise SerraConnectionError(f"Impossibile aprire il lock {UART_LOCK_PATH}: {ex}") from ex
        end = time.time() + UART_LOCK_TIMEOUT_S
        while True:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except OSError:
                if time.time() >= end:
                    self._release_lock()
                    raise SerraConnectionError(
                        f"UART occupata: un altro comando serra sta usando {self.cfg.port} "
                        f"(atteso {UART_LOCK_TIMEOUT_S:.0f}s sul lock {UART_LOCK_PATH})"
                    )
                time.sleep(0.1)

    def _release_lock(self) -> None:
        if self._lock_fd is not None:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
                self._lock_fd.close()
            except Exception:
                pass
            self._lock_fd = None

    def open(self) -> None:
        self._acquire_lock()
        try:
            self.ser = serial.Serial(
                self.cfg.port,
                self.cfg.baudrate,
                timeout=self.cfg.timeout,
                write_timeout=self.cfg.write_timeout,
                exclusive=True,  # TIOCEXCL: seconda difesa contro aperture concorrenti
            )
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
        except Exception as ex:
            self._release_lock()
            raise SerraConnectionError(f"Impossibile aprire {self.cfg.port} a {self.cfg.baudrate}: {ex}")

    def close(self) -> None:
        if self.ser:
            try:
                self.ser.close()
            except Exception:
                pass
        self.ser = None
        self._release_lock()

    def _write_line(self, s: str) -> None:
        assert self.ser is not None
        self.ser.write((s + "\n").encode("utf-8"))
        self.ser.flush()

    def _read_some(self, max_bytes: int = SERIAL_READ_CHUNK_SIZE) -> bytes:
        assert self.ser is not None
        try:
            return self.ser.read(max_bytes) or b""
        except SerialException as ex:
            raise SerraConnectionError(
                f"Errore lettura seriale ({self.cfg.port}). "
                f"Probabile porta occupata (picocom) o disconnessione: {ex}"
            )

    def _read_until(self, patterns: List[re.Pattern], timeout: float = 3.0) -> bytes:
        """
        Legge finché trova uno dei pattern (regex bytes) oppure scade timeout.
        Usa una lista di chunk per evitare concatenazioni O(n^2).
        """
        end = time.time() + timeout
        chunks: List[bytes] = []
        buf = b""

        while time.time() < end:
            chunk = self._read_some()
            if chunk:
                chunks.append(chunk)
                buf = b"".join(chunks)
                for pat in patterns:
                    if pat.search(buf):
                        return buf
            else:
                time.sleep(0.05)

        return b"".join(chunks)

    def ensure_root_prompt(self, timeout: float = 8.0) -> None:
        """
        Porta la console a prompt root (#), facendo login se serve.
        """
        assert self.ser is not None

        # "poke" console
        self._write_line("")
        time.sleep(0.1)
        self._write_line("")
        data = self._read_until([self.PROMPT_RE, self.LOGIN_RE, self.PASS_RE], timeout=timeout)

        # già root?
        if self.PROMPT_RE.search(data):
            return

        # login richiesto
        if self.LOGIN_RE.search(data):
            self._write_line(self.cfg.user)
            data = self._read_until([self.PASS_RE, self.PROMPT_RE, self.LOGIN_RE], timeout=timeout)

        # password richiesta
        if self.PASS_RE.search(data):
            self._write_line(self.cfg.password)
            data = self._read_until([self.PROMPT_RE, self.LOGIN_RE, self.PASS_RE], timeout=timeout)

        if not self.PROMPT_RE.search(data):
            # ultimo tentativo: manda newline e rilegge
            self._write_line("")
            data2 = self._read_until([self.PROMPT_RE], timeout=2.0)
            if not self.PROMPT_RE.search(data2):
                raise SerraConnectionError(
                    "Non riesco ad ottenere prompt root (#). Login fallito o console non pronta."
                )

    def run_checked(self, cmd: str, timeout: float = 4.0) -> bool:
        """
        Esegue cmd e conferma che la shell l'ha eseguito CON SUCCESSO.
        Ritorna True se il marker compare nell'OUTPUT reale.
        """
        assert self.ser is not None
        # Come run_capture: il marker e' assemblato A RUNTIME dalla shell da una
        # variabile (M_), cosi' la riga ECHEGGIATA dal tty contiene "${M_}OK"
        # NON espanso e il match scatta SOLO sull'output vero.
        # (Bug precedente: marker LETTERALE dentro il comando -> compariva
        # identico nell'eco della riga di comando -> marker_re.search matchava
        # l'eco, non l'output -> run_checked tornava ~sempre True e il
        # rilevamento errori/timeout era di fatto spento.)
        # '&&' invece di ';' -> il marker esce SOLO se cmd termina con exit 0.
        # Niente PROMPT_RE/LOGIN_RE tra i pattern: come run_capture aspettiamo il
        # marker vero (un comando fallito non lo emette -> timeout -> False).
        tag = f"RC{now_ms()}"
        self._write_line(f'M_={tag}; {cmd} && echo "${{M_}}OK"')

        expanded = f"{tag}OK".encode("utf-8")
        marker_re = re.compile(re.escape(expanded))
        out = self._read_until([marker_re], timeout=timeout)

        return bool(marker_re.search(out))

    def run_capture(self, cmd: str, timeout: float = 6.0) -> str:
        """
        Esegue cmd sulla console e ritorna il suo stdout (tra due marker).
        Usato per LEGGERE risposte dei micro-controller (es. magnetometro Nebbia),
        non solo per confermare l'esecuzione come run_checked.
        """
        assert self.ser is not None
        # Marker assemblati a runtime dalla shell: la riga ECHEGGIATA contiene
        # "${M_}B"/"${M_}E" (non espansi), quindi il match scatta solo sull'OUTPUT.
        tag = f"CAP{now_ms()}"
        self._write_line(f'M_={tag}; echo "${{M_}}B"; {cmd}; echo "${{M_}}E"')
        beg = f"{tag}B".encode("utf-8")
        end = f"{tag}E".encode("utf-8")
        out = self._read_until([re.compile(re.escape(end))], timeout=timeout)
        bi = out.find(beg)
        if bi >= 0:
            nl = out.find(b"\n", bi)
            start = nl + 1 if nl >= 0 else bi + len(beg)
        else:
            start = 0
        ei = out.find(end, start)
        chunk = out[start:ei] if ei >= 0 else out[start:]
        return chunk.decode("utf-8", "replace")


class SerraSSH(SerraConsole):
    """Esegue sulla stessa shell del VoCore i comandi usati dalla console UART.

    La chiave host deve essere gia' presente in ~/.ssh/known_hosts. La password
    viaggia a sshpass su un file descriptor, mai negli argomenti del processo.
    Ogni comando crea una sessione SSH; il lock comune copre l'intera sequenza.
    """

    def __init__(self, cfg: ConsoleConfig, host: str, port: int = 22):
        super().__init__(cfg)
        if not host or host.startswith("-") or any(ch.isspace() for ch in host):
            raise SerraCommandError("SERRA_SSH_HOST deve contenere l'IP o il nome della serra")
        if not 1 <= port <= 65535:
            raise SerraCommandError("SERRA_SSH_PORT non valido")
        self.host = host
        self.port = port
        self.active_transport = "wifi"

    def _invoke(self, cmd: str, timeout: float, *, preflight: bool = False) -> subprocess.CompletedProcess:
        if not self.cfg.password:
            raise SerraCommandError("Password root della serra mancante: esegui serra auth save")
        if not os.path.exists(os.path.expanduser("~/.ssh/known_hosts")):
            raise SerraConnectionError("Chiave SSH della serra non registrata in ~/.ssh/known_hosts")
        read_fd, write_fd = os.pipe()
        argv = [
            "sshpass", "-d", str(read_fd), "ssh", "-T",
            "-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=no",
            "-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=password",
            "-o", "PubkeyAuthentication=no", "-o", "ConnectTimeout=5",
            "-p", str(self.port), "-l", self.cfg.user, self.host, cmd,
        ]
        try:
            os.write(write_fd, (self.cfg.password + "\n").encode("utf-8"))
            os.close(write_fd)
            write_fd = -1
            proc = subprocess.Popen(
                argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, pass_fds=(read_fd,),
            )
            try:
                stdout, stderr = proc.communicate(timeout=max(1.0, timeout))
            except subprocess.TimeoutExpired as exc:
                proc.kill()
                proc.communicate()
                error = SerraConnectionError if preflight else SerraUncertainError
                raise error("Timeout SSH: esito del comando sconosciuto" if not preflight else "Timeout SSH prima dell'invio") from exc
            return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)
        except OSError as exc:
            error = SerraConnectionError if preflight else SerraUncertainError
            raise error(f"Impossibile avviare SSH: {exc}") from exc
        finally:
            os.close(read_fd)
            if write_fd >= 0:
                os.close(write_fd)

    def open(self) -> None:
        self._acquire_lock()
        try:
            result = self._invoke("true", 8, preflight=True)
            if result.returncode:
                detail = result.stderr.decode("utf-8", "replace").strip()[-240:]
                raise SerraConnectionError(f"Accesso SSH alla serra fallito: {detail or result.returncode}")
        except Exception:
            self._release_lock()
            raise

    def ensure_root_prompt(self, timeout: float = 8.0) -> None:
        # La prova SSH in open() ha gia' eseguito `true` come root.
        return

    def run_checked(self, cmd: str, timeout: float = 4.0) -> bool:
        result = self._invoke(cmd, timeout + 5)
        if result.returncode == 255:
            raise SerraUncertainError("Connessione SSH interrotta: il comando potrebbe essere stato eseguito")
        return result.returncode == 0

    def run_capture(self, cmd: str, timeout: float = 6.0) -> str:
        result = self._invoke(cmd, timeout + 5)
        if result.returncode == 255:
            raise SerraUncertainError("Connessione SSH interrotta durante la lettura")
        if result.returncode:
            raise SerraConnectionError(f"Lettura SSH fallita (exit {result.returncode})")
        return result.stdout.decode("utf-8", "replace")

    def run_binary(self, cmd: str, timeout: float = 30.0) -> bytes:
        result = self._invoke(cmd, timeout + 5)
        if result.returncode:
            raise SerraUncertainError("Trasferimento binario SSH non completato")
        return result.stdout

    def close(self) -> None:
        self._release_lock()


class SerraAutoConsole:
    """Seleziona il secondario solo durante l'apertura, prima del primo comando."""

    def __init__(self, candidates):
        self.candidates = candidates
        self.active = None
        self.active_transport = None

    def open(self) -> None:
        failures = []
        for candidate in self.candidates:
            try:
                candidate.open()
                candidate.ensure_root_prompt()
                self.active = candidate
                self.active_transport = candidate.active_transport
                if failures:
                    eprint(f"[transport] primario indisponibile ({failures[0]}); uso {self.active_transport}")
                return
            except SerraConnectionError as exc:
                failures.append(str(exc))
                candidate.close()
        raise SerraConnectionError("Nessun trasporto disponibile: " + " | ".join(failures))

    def ensure_root_prompt(self, timeout: float = 8.0) -> None:
        return

    def run_checked(self, cmd: str, timeout: float = 4.0) -> bool:
        return self.active.run_checked(cmd, timeout)

    def run_capture(self, cmd: str, timeout: float = 6.0) -> str:
        return self.active.run_capture(cmd, timeout)

    def run_binary(self, cmd: str, timeout: float = 30.0) -> bytes:
        return self.active.run_binary(cmd, timeout)

    def close(self) -> None:
        if self.active is not None:
            self.active.close()
            self.active = None


def make_console(cfg: ConsoleConfig, transport: str = DEFAULT_TRANSPORT,
                 host: str = DEFAULT_SSH_HOST, ssh_port: int = DEFAULT_SSH_PORT,
                 primary: str = DEFAULT_PRIMARY_TRANSPORT):
    transport = transport.lower().strip()
    if transport not in {"uart", "wifi", "auto"}:
        raise SerraCommandError("SERRA_TRANSPORT deve essere uart, wifi o auto")
    if transport == "uart":
        console = SerraConsole(cfg)
        console.active_transport = "uart"
        return console
    if transport == "wifi":
        return SerraSSH(cfg, host, ssh_port)
    if primary not in {"uart", "wifi"}:
        raise SerraCommandError("SERRA_PRIMARY_TRANSPORT deve essere uart o wifi")
    secondary = "uart" if primary == "wifi" else "wifi"
    return SerraAutoConsole([
        make_console(cfg, primary, host, ssh_port),
        make_console(cfg, secondary, host, ssh_port),
    ])


# ---------------------------
# Mapping comandi hardware
# ---------------------------

# LUCI
LIGHT_CHANNELS = {"A", "G", "B", "R", "D"}  # full, green, blue+white, red1, red2


def _pct_to_hex2(pct: int) -> str:
    """
    Intensità luce: percentuale -> 00..ff (hex, lowercase)
    """
    pct = int(clamp(int(pct), 0, 100))
    val = int(round(pct * 255 / 100))
    return f"{val:02x}"


def _fade_seconds_to_hex3(seconds: float) -> str:
    """
    Fade luci: secondi "umani" -> unità hex (000..FFF).
    1 unità ~ 1 secondo (approssimato).
    """
    units = int(round(float(seconds)))
    units = int(clamp(units, 0, MAX_LIGHT_FADE_UNITS))
    return f"{units:03x}"


def light_cmd(channel: str, intensity_pct: int, fade_s: float) -> str:
    """
    Costruisce comando per /dev/tty-local:
      echo 0<CH><II><FFF> > /dev/tty-local
    """
    ch = channel.upper()
    if ch not in LIGHT_CHANNELS:
        raise SerraCommandError(f"Canale luci non valido: {channel} (usa A/G/B/R/D)")
    intensity_pct = int(clamp(int(intensity_pct), 0, 100))
    ii = _pct_to_hex2(intensity_pct)
    fff = _fade_seconds_to_hex3(fade_s)
    return f"echo 0{ch}{ii}{fff} > /dev/tty-local"


# Preset luce verificati sulla serra.
#   A = full spectrum (bianco pieno)
#   G = verde (~520nm)                 -> luce di servizio
#   B = blu+bianco (azzurrino-lilla)
#   R = arancio/amber (~610-630nm)     -] R e D sono complementari (LED distinti):
#   D = rosso scuro/deep-red (~660nm)  -] insieme = copertura rossa totale
# I canali NON elencati in una ricetta vengono spenti.
# La ricetta viola esatta era profile-driven (persa col cloud): questi sono
# valori iniziali, tarabili dal vivo (rossi dominanti + blu = luce viola).
LIGHT_PRESETS: Dict[str, Dict[str, int]] = {
    # Viola/crescita: valori tarati tramite il banco luci di Home Assistant.
    # D+R=100 (tutti i LED rossi, copertura uniforme, max fotoni utili),
    # B=40 (blu per morfologia compatta; porta anche i bianchi = spettro largo).
    # G/A=0. La potenza totale può essere ridotta con -i.
    "viola": {"D": 100, "R": 100, "B": 40},
    "verde": {"G": 100},                     # servizio/notte
    "bianco": {"A": 100},                    # full spectrum manuale
}


# Micro-pausa tra i comandi canale: il microcontrollore ("Cirronembo") non
# digerisce i 5 echo sparati in burst (il primo comando, che accende, puo'
# corrompersi -> pannello spento). 0.15s da' tempo al MCU. busybox sleep
# frazionario verificato sulla serra.
_MIX_INTERCMD_SLEEP = "0.25"


def _channels_to_cmd(eff: Dict[str, int], fade_s: float) -> str:
    """
    Costruisce il comando composto per i 5 canali A/G/B/R/D.
    - canali da SPEGNERE (0) per primi, quelli da ACCENDERE per ultimi: cosi'
      un eventuale glitch di burst non spegne un canale appena acceso;
    - micro-pausa tra un comando e l'altro per non intasare il MCU.
    """
    order = sorted(("A", "G", "B", "R", "D"), key=lambda c: eff.get(c, 0) > 0)
    parts = [light_cmd(c, int(eff.get(c, 0)), fade_s) for c in order]
    # B-c: separatore '&&' (non ';') cosi' run_checked verifica TUTTI i canali.
    # Con ';' il '&& echo marker' di run_checked proteggeva solo l'ULTIMO echo
    # (un canale intermedio fallito passava come 'ok'); con '&&' il marker esce
    # solo se OGNI canale (e ogni sleep) va a buon fine -> fallimento propagato
    # (e con M3 do_lights_mix solleva -> serra-foto/banco-luci lo vedono).
    return f" && sleep {_MIX_INTERCMD_SLEEP} && ".join(parts)


def light_preset_cmd(preset: str, master_pct: int, fade_s: float) -> tuple[str, Dict[str, int]]:
    """
    Costruisce UN comando composto (tutti i canali A/G/B/R/D) per il preset.
    master_pct = scala uniforme 0..100 applicata alla ricetta (100 = ricetta piena).
    Ritorna (comando_shell, mappa_canale->pct_effettivo).
    """
    key = preset.lower().strip()
    recipe = LIGHT_PRESETS.get(key)
    if recipe is None:
        valid = "|".join(sorted(LIGHT_PRESETS))
        raise SerraCommandError(f"Preset luci non valido: {preset} (usa {valid})")
    master = int(clamp(int(master_pct), 0, 100))
    effective: Dict[str, int] = {}
    for ch in ("A", "G", "B", "R", "D"):
        base = int(recipe.get(ch, 0))
        effective[ch] = int(round(base * master / 100)) if base else 0
    return _channels_to_cmd(effective, fade_s), effective


# VENTOLE
FAN_TARGETS = {"1": "1", "2": "2", "F": "P"}  # CLI F -> protocol VP...

FAN_LEVELS: Dict[str, int] = {
    "off": 0,
    "low": 50,
    "medium": 75,
    "high": 100,
}


def _fan_pct_to_hex2(pct: int) -> str:
    pct = int(clamp(int(pct), 0, 100))
    if pct == 0:
        return "00"
    pct = max(pct, MIN_FAN_RELIABLE_PCT)
    val = int(round(pct * 255 / 100))
    return f"{val:02x}"


def fan_cmd(fid_proto: str, level: int | str) -> str:
    """Build fan command. level can be int pct (0..100) or 1-2 hex digits."""
    if isinstance(level, int):
        hex2 = _fan_pct_to_hex2(level)
    else:
        hex2 = str(level).strip()
        if re.fullmatch(r"[0-9a-fA-F]{1,2}", hex2 or ""):
            hex2 = hex2.zfill(2).upper()
        else:
            raise SerraCommandError(f"Invalid fan level hex: {hex2!r}")
    return f"echo V{fid_proto}{hex2}xxx > /dev/tty-local"


# POMPE
def pump_main_cmd(seconds: int) -> str:
    # W<sec>, W0 per stop
    sec = int(clamp(int(seconds), 0, MAX_PUMP_DURATION_S))
    return f"echo W{sec} > /dev/tty-nebbia"


def pump_nutrient_cmd(nid: int, seconds: float) -> str:
    """
    Da test: P0,1,100 ~ 1s (scala ~100 unità / secondo)
    Supportiamo float (0.5s -> 50)
    """
    nid = int(nid)
    if nid not in (0, 1, 2):
        raise SerraCommandError("Nutrient id valido: 0 / 1 / 2")
    sec = float(seconds)
    sec = float(clamp(sec, 0.0, MAX_NUTRIENT_DURATION_S))
    units = int(round(sec * 100))
    units = int(clamp(units, 0, int(MAX_NUTRIENT_DURATION_S * 100)))
    # secondo parametro ignorato, teniamo "1"
    return f"echo P{nid},1,{units} > /dev/tty-nebbia"


# LED RING
RING_COLORS: Dict[str, str] = {
    "white": "FFFFFF",
    "red": "FF0000",
    "green": "00FF00",
    "yellow": "FFFF00",
    "orange": "FF7A00",
    "blue": "0000FF",
    "purple": "FF00FF",
    "off": "000000",
}


def _fade_seconds_to_hex2(seconds: float) -> str:
    """
    Fade ring: HEX a 2 cifre (00..FF).
    1 unità ~ 1 secondo (approssimato), clamp a 255.
    """
    units = int(round(float(seconds)))
    units = int(clamp(units, 0, MAX_RING_FADE_UNITS))
    return f"{units:02X}"


def ring_cmd(color_hex: str, fade: float) -> str:
    ff = _fade_seconds_to_hex2(fade)
    return f"echo N{color_hex}{ff} > /dev/tty-nebbia"


# ---------------------------
# Azioni CLI (implementazione)
# ---------------------------

def step(
    console: SerraConsole,
    title: str,
    cmd: str,
    timeout: float = 4.0,
    wait_after: float = 0.0,
) -> bool:
    try:
        ok = console.run_checked(cmd, timeout=timeout)
        if ok:
            print(f"✅ {title}")
        else:
            print(f"❌ {title} (no marker/timeout)")
        sleep_s(wait_after)
        return ok
    except SerraUncertainError:
        # Non continuare sequenze di pompe/dosaggi dopo un esito sconosciuto.
        raise
    except SerraError as ex:
        print(f"❌ {title}: {ex}")
        return False
    except Exception as ex:
        print(f"❌ {title}: {ex}")
        return False


def _record(
    component: str,
    ok: bool,
    state_update: Dict[str, Any],
    last_update: Dict[str, Any],
    existing_state: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Registra stato su file JSON + pubblica su MQTT (se configurato).

    component: lights | fans | ring | pump_main | pump_nutrients
    state_update: dict che va in <component>.state
    last_update: dict che va in <component>.last
    existing_state: stato già caricato da riutilizzare (per evitare doppio _load_state)
    """
    try:
        # state.json race: lock esclusivo per l'INTERO read-modify-write
        with _StateLock():
            st = existing_state if existing_state is not None else (_load_state() or {})
            _bump_last_seen(st)
            comp = st.setdefault(component, {"state": {}, "last": None})
            comp["state"] = state_update
            comp["last"] = last_update
            _derive_running_flags(st)
            _save_state(st)
        _publish_state_all(st)

        # Pubblica anche status/last e status/last_seen (se MQTT è configurato)
        try:
            if _mqtt_enabled():
                base = MQTT_TOPIC.rstrip("/")
                now = now_ts()
                _mqtt_publish(
                    f"{base}/status/last_seen",
                    {
                        "ok": True,
                        "source": "controller",
                        "ts": now["ts"],
                        "ts_iso": now["ts_iso"],
                        "ts_local": now["ts_local"],
                        "cli": SERRA_CLI,
                    },
                    retain=True,
                )

                _mqtt_publish(
                    f"{base}/status/last",
                    {
                        "ok": bool(ok),
                        "component": component,
                        **(last_update or {}),
                        "ts": now["ts"],
                        "ts_iso": now["ts_iso"],
                        "ts_local": now["ts_local"],
                        "cli": SERRA_CLI,
                    },
                    retain=True,
                )
        except Exception as _ex:
            eprint(f"[mqtt] warning status publish failed: {_ex}")
    except Exception as ex:
        # Non bloccare mai i comandi hardware per colpa di logging/MQTT
        eprint(f"[state] warning: {ex}")


def do_lights(
    console: SerraConsole,
    action: str,
    channel: Optional[str],
    intensity: int,
    fade: float,
) -> None:
    """
    lights on/off/set
    - on  => set A (default intensity 100, fade 0)
    - off => set A intensity 0 (fade opzionale)
    - set <channel> con intensity/fade
    """
    action = action.lower().strip()
    intensity = int(clamp(intensity, 0, 100))
    fade = float(max(0.0, fade))

    def _known_channels() -> Optional[Dict[str, int]]:
        previous = (_load_state().get("lights", {}) or {})
        if (previous.get("last") or {}).get("ok") is not True:
            return None
        channels = (previous.get("state") or {}).get("channels")
        if not isinstance(channels, dict):
            return None
        try:
            result = {key: int(channels[key]) for key in ("A", "G", "B", "R", "D")}
        except (KeyError, TypeError, ValueError):
            return None
        return result if all(0 <= value <= 100 for value in result.values()) else None

    def _mk_state(ch: str, intensity_pct: int, fade_s: float,
                  channels: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
        t = now_ts()
        st: Dict[str, Any] = {
            "channel": ch,
            "intensity_pct": int(intensity_pct),
            "fade_s": float(fade_s),
            "on": bool(intensity_pct > 0),
            **t,
        }
        if channels is not None:
            st["channels"] = channels
        if fade_s and fade_s > 0:
            st.update({"transition": "fading"})
            st.update(make_until_timestamps(fade_s))
        return st

    if action == "on":
        ch = "A"
        cmd = light_cmd(ch, intensity if intensity is not None else 100, fade)
        ok = step(console, f"LIGHTS ON (A, intensity {intensity}%, fade ~{fade}s)", cmd)
        channels = _known_channels()
        if channels is not None:
            channels[ch] = intensity
        _record(
            "lights",
            ok,
            _mk_state(ch, intensity, fade, channels if ok else None),
            {"ok": ok, "action": "on", "cmd": cmd, **now_ts()},
        )
        return

    if action == "off":
        ch = "A"
        # Lo spegnimento promette TUTTI i LED: invia tutti e cinque i canali.
        # Un solo `0A...` non prova che G/B/R/D siano spenti e lascia la foto
        # senza una mappa affidabile da ripristinare dopo lo scatto.
        channels = {key: 0 for key in ("A", "G", "B", "R", "D")}
        cmd = _channels_to_cmd(channels, fade)
        ok = step(console, f"LIGHTS OFF (fade ~{fade}s)", cmd, timeout=6.0)
        _record(
            "lights",
            ok,
            _mk_state(ch, 0, fade, channels if ok else None),
            {"ok": ok, "action": "off", "cmd": cmd, **now_ts()},
        )
        return

    if action != "set":
        raise SerraCommandError("Uso: serra lights <on|off|set> ...")

    if not channel:
        raise SerraCommandError("Uso: serra lights set <A|G|B|R|D> [-i 0..100] [-f seconds]")

    ch = channel.upper()
    cmd = light_cmd(ch, intensity, fade)
    ok = step(console, f"LIGHTS SET {ch} (intensity {intensity}%, fade ~{fade}s)", cmd)
    channels = _known_channels()
    if channels is not None:
        channels[ch] = intensity
    _record(
        "lights",
        ok,
        _mk_state(ch, intensity, fade, channels if ok else None),
        {"ok": ok, "action": "set", "cmd": cmd, **now_ts()},
    )


def do_lights_preset(
    console: SerraConsole,
    preset: str,
    intensity: int,
    fade: float,
) -> None:
    """
    Applica un preset luce (viola/verde/bianco): accende i canali della ricetta
    e spegne tutti gli altri, in un unico comando composto.
    intensity = scala uniforme 0..100 sulla ricetta (default 100).
    """
    intensity = int(clamp(intensity, 0, 100))
    fade = float(max(0.0, fade))
    key = preset.lower().strip()
    cmd, eff = light_preset_cmd(key, intensity, fade)
    on_channels = {c: p for c, p in eff.items() if p > 0}
    label = ", ".join(f"{c} {p}%" for c, p in on_channels.items()) or "tutto spento"
    ok = step(console, f"LIGHTS PRESET {key} ({label}, fade ~{fade}s)", cmd, timeout=6.0)

    t = now_ts()
    state: Dict[str, Any] = {
        "preset": key,
        "channels": eff,
        "master_pct": intensity,
        "fade_s": fade,
        "on": any(p > 0 for p in eff.values()),
        **t,
    }
    if fade and fade > 0:
        state.update({"transition": "fading"})
        state.update(make_until_timestamps(fade))
    _record(
        "lights",
        ok,
        state,
        {"ok": ok, "action": "preset", "preset": key, "cmd": cmd, **t},
    )


def light_mix_cmd(chmap: Dict[str, int], fade_s: float) -> tuple[str, Dict[str, int]]:
    """
    Comando composto che imposta TUTTI i canali A/G/B/R/D ai valori dati
    (mancanti -> 0), in una sola sessione UART. Ritorna (cmd, mappa effettiva).
    """
    eff: Dict[str, int] = {}
    for ch in ("A", "G", "B", "R", "D"):
        eff[ch] = int(clamp(int(chmap.get(ch, 0)), 0, 100))
    return _channels_to_cmd(eff, fade_s), eff


def do_lights_mix(
    console: SerraConsole,
    a: int, g: int, b: int, r: int, d: int,
    fade: float,
) -> None:
    """
    Imposta l'intero mix luci (5 canali) atomicamente in un'unica sessione UART.
    Usato dal "banco luci" HA: applica sempre lo stato COMPLETO corrente, quindi
    non ci sono race/sovrascritture tra comandi per-canale.
    """
    fade = float(max(0.0, fade))
    cmd, eff = light_mix_cmd({"A": a, "G": g, "B": b, "R": r, "D": d}, fade)
    on_ch = {c: p for c, p in eff.items() if p > 0}
    label = ", ".join(f"{c} {p}%" for c, p in on_ch.items()) or "tutto spento"
    ok = step(console, f"LIGHTS MIX ({label}, fade ~{fade}s)", cmd, timeout=6.0)

    t = now_ts()
    state: Dict[str, Any] = {
        "mix": True,
        "channels": eff,
        "fade_s": fade,
        "on": any(p > 0 for p in eff.values()),
        **t,
    }
    if fade and fade > 0:
        state.update({"transition": "fading"})
        state.update(make_until_timestamps(fade))
    _record(
        "lights",
        ok,
        state,
        {"ok": ok, "action": "mix", "cmd": cmd, **t},
    )
    # M3: propaga il fallimento all'EXIT CODE. Prima do_lights_mix usciva 0 anche
    # con ok=False (marker perso/timeout): i chiamanti potevano credere riuscito
    # il ripristino e lasciare le luci accese in silenzio. Sollevo SerraCommandError
    # (main -> sys.exit(2)) DOPO aver registrato lo stato con ok=False. NB e' una
    # ECCEZIONE, non sys.exit: il finally all-off di do_checkup (except Exception)
    # la cattura e prosegue best-effort.
    if not ok:
        raise SerraCommandError("LIGHTS MIX non confermato (marker perso/timeout)")


def do_fans(console: SerraConsole, action: str, target: Optional[str], intensity_label: str):
    """
    fans on/off/set

    Intensità: off / low / medium / high  (con wake a 100% per low/medium)
    target: 1 / 2 / F / all
    """
    action = action.lower().strip()
    lvl = (intensity_label or "medium").lower().strip()

    if lvl not in FAN_LEVELS:
        raise ValueError("Intensità ventole: off|low|medium|high")

    pct = int(FAN_LEVELS[lvl])

    # carica stato precedente (per update parziali)
    st_prev = _load_state()
    prev = (st_prev.get("fans", {}) or {}).get("state", {}) or {}
    state_now = {
        "1": dict(prev.get("1", {})),
        "2": dict(prev.get("2", {})),
        "F": dict(prev.get("F", {})),
    }

    def _apply_one(fan_id: str, level: str, pct_val: int):
        # wake: per partire in modo affidabile, se non high/off -> prima ff
        wake_used = False
        if level in ("low", "medium"):
            fan_proto = FAN_TARGETS.get(fan_id, fan_id)
            wake_cmd = fan_cmd(fan_proto, 100)
            wake_used = step(console, f"FAN {fan_id} WAKE 100%", wake_cmd)
            time.sleep(1.0)
        fan_proto = FAN_TARGETS.get(fan_id, fan_id)
        cmd = fan_cmd(fan_proto, pct_val)
        ok = step(console, f"FAN {fan_id} {pct_val}% ({level})", cmd)

        # Retry unico su QUALSIASI fallimento del set. Prima ritentava SOLO il
        # ramo col wake (low/medium): off e high — che non fanno il wake —
        # restavano SENZA retry, quindi un "fans off" perso lasciava la ventola
        # FISICAMENTE in moto mentre lo stato la dava spenta (dashboard che mente
        # + ventola non ferma, e nessun reconcile perche' running=False).
        eff_level, eff_pct = level, pct_val
        if not ok:
            ok = step(console, f"FAN {fan_id} {pct_val}% ({level}) RETRY", cmd)
        if not ok:
            if wake_used:
                # col wake la ventola e' gia' a 100%; se il set fallisce ancora
                # resta FISICAMENTE a 100% -> registro lo stato REALE (100%): una
                # ventola a 100% e' innocua e il reconcile/HA riallineera'.
                eff_level, eff_pct = "high", 100
                print(f"⚠️ FAN {fan_id}: set {level} fallito dopo il wake, resta a 100% (registro 100%)")
            else:
                # off/high senza wake: comando NON confermato, esito UART incerto.
                # NON dichiaro la ventola spenta: tengo lo stato PRECEDENTE (potrebbe
                # girare ancora) con ok=False, cosi' HA vede il fallimento e il
                # reconcile ritenta l'off al giro dopo (meglio "forse accesa" che
                # "creduta spenta e invece gira").
                prev_one = prev.get(fan_id, {}) or {}
                eff_level = prev_one.get("level", level)
                eff_pct = int(prev_one.get("pct", pct_val) or 0)
                print(f"⚠️ FAN {fan_id}: {level} ({pct_val}%) fallito dopo retry; mantengo {eff_level}/{eff_pct}% (ok=False)")

        ts = now_ts()
        state_now[fan_id] = {
            "level": eff_level,
            "pct": eff_pct,
            "running": bool(eff_pct > 0),
            "wake_used": wake_used,
            "ok": ok,
            "cmd": cmd,
            **ts,
            # last per questa specifica ventola
            "last": {
                "ok": ok,
                "action": action,
                "target": fan_id,
                "level": eff_level,
                "pct": eff_pct,
                "cmd": cmd,
                **ts,
            },
        }
        return ok

    if action == "off":
        ok1 = _apply_one("1", "off", 0)
        ok2 = _apply_one("2", "off", 0)
        okF = _apply_one("F", "off", 0)
        _record("fans", ok1 and ok2 and okF, state_now, {"ok": ok1 and ok2 and okF, "action": "off", **now_ts()})
        return

    if action == "on":
        # default: all a medium se non specificato diversamente
        ok1 = _apply_one("1", lvl, pct)
        ok2 = _apply_one("2", lvl, pct)
        okF = _apply_one("F", lvl, pct)
        _record("fans", ok1 and ok2 and okF, state_now, {"ok": ok1 and ok2 and okF, "action": "on", "target": "all", **now_ts()})
        return

    if action != "set":
        raise ValueError("Uso: serra fans <on|off|set> ...")

    if not target:
        raise ValueError("Uso: serra fans set <1|2|F|all> [-i off|low|medium|high]")

    tgt = target.upper()
    if tgt not in ("1", "2", "F", "ALL"):
        raise ValueError("Target ventole: 1|2|F|all")

    ok_all = True
    if tgt == "ALL":
        for fid in ("1", "2", "F"):
            ok_all = _apply_one(fid, lvl, pct) and ok_all
    else:
        ok_all = _apply_one(tgt, lvl, pct)

    _record("fans", ok_all, state_now, {"ok": ok_all, "action": "set", "target": tgt, **now_ts()})


def _spawn_pump_deadman(expected_until: float, margin: float = PUMP_DEADMAN_MARGIN_S) -> None:
    """Backstop DEAD-MAN per la pompa principale, INDIPENDENTE da HA.

    A ogni 'pump main on' spawna un processo STACCATO che dorme fino a
    (expected_until + margin) e poi forza 'pump main off' — MA solo se nel
    frattempo non e' partito un nuovo pump-on con until piu' avanti (guardia
    sul until_ts corrente in state.json, per non tagliare un ricircolo nuovo).
    Non tiene la UART durante l'attesa; alla scadenza apre la seriale via la
    CLI 'serra pump main off'. Se lo state file non e' leggibile -> spegne
    comunque (fail-safe). Copre la pompa avviata con HA giu' + tick firmware
    perso (allagamento)."""
    import subprocess
    code = (
        "import time, json, subprocess, sys\n"
        "exp = float(sys.argv[1]); margin = float(sys.argv[2]); sp = sys.argv[3]\n"
        "time.sleep(max(1.0, (exp + margin) - time.time()))\n"
        "u = None\n"
        "try:\n"
        "    u = json.load(open(sp)).get('pump_main', {}).get('state', {}).get('until_ts')\n"
        "except Exception:\n"
        "    u = None\n"
        "if u is None or float(u) <= exp + 1.0:\n"
        "    subprocess.run(['serra', 'pump', 'main', 'off'])\n"
    )
    try:
        subprocess.Popen(
            [sys.executable, "-c", code, repr(float(expected_until)), repr(float(margin)), STATE_FILE_DEFAULT],
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as ex:
        eprint(f"[pump] warning: impossibile avviare il dead-man pompa: {ex}")


def do_pump_main(console: SerraConsole, action: str, seconds: float) -> None:
    action = action.lower().strip()
    if action not in ("on", "off"):
        raise SerraCommandError("Uso: serra pump main <on|off> [-s seconds]")

    if action == "off":
        cmd = pump_main_cmd(0)
        ok = step(console, "PUMP MAIN OFF", cmd)
        st = {"running": False, "seconds": 0, "cmd": cmd, **now_ts()}
        _record(
            "pump_main",
            ok,
            st,
            {"ok": ok, "action": "off", "cmd": cmd, **now_ts()},
        )
        return

    sec = int(clamp(int(seconds), 1, MAX_PUMP_DURATION_S))
    cmd = pump_main_cmd(sec)
    try:
        ok = step(console, f"PUMP MAIN ON ({sec}s)", cmd)
    except SerraUncertainError:
        # Il comando potrebbe aver avviato la pompa anche senza conferma SSH.
        # Mantieni il backstop senza ritentare l'accensione.
        _spawn_pump_deadman(time.time() + sec)
        raise

    until_info = make_until_timestamps(sec)
    st: Dict[str, Any] = {
        "running": True,
        "seconds": sec,
        "cmd": cmd,
        **now_ts(),
    }
    st.update(until_info)

    _record(
        "pump_main",
        ok,
        st,
        {"ok": ok, "action": "on", "cmd": cmd, **now_ts()},
    )

    # Dead-man backstop (indipendente da HA): a until_ts + margine forza off se
    # il firmware non ha spento. Spawnato SEMPRE (anche con 'ok' dubbio): un off
    # ridondante e' innocuo, ma se la pompa e' partita il backstop dev'esserci.
    _spawn_pump_deadman(until_info["until_ts"])


def do_pump_nutrient(console: SerraConsole, nid: int, seconds: float, times: int, interval: float):
    nid = int(nid)
    if nid not in (0, 1, 2):
        raise ValueError("Nutrient id: 0|1|2")

    times = clamp(int(times), 1, 100)
    interval = clamp(float(interval), 0.0, 120.0)
    seconds = clamp(float(seconds), 0.1, MAX_NUTRIENT_DURATION_S)  # B-e: allineato al cap HW (pump_nutrient_cmd) -> total/until_ts non sovrastimati

    # B: la sequenza tiene il lock UART per tutto il loop (il wall-clock e'
    # dominato dalle pause 'interval'). Se supera UART_LOCK_TIMEOUT_S un comando
    # concorrente andrebbe in timeout. Limitiamo il numero di cicli cosi' che la
    # durata totale resti <= MAX_SEQUENCE_TOTAL_S. Le sequenze legittime (pochi
    # cicli con pause brevi) non vengono toccate.
    # M2: il per-ciclo include la pausa 'interval' E un margine per lo step
    # (invio comando + attesa marker); vale ANCHE con interval=0 (prima il guard
    # 'interval>0' saltava del tutto il cap -> times x step_time illimitato).
    if times > 1:
        per_cycle = float(interval) + 2.0  # 2s = margine step (comando + marker)
        max_times = max(1, int(MAX_SEQUENCE_TOTAL_S / per_cycle))
        if times > max_times:
            print(f"⚠️ NUTRIENT-{nid}: times {times} → {max_times} "
                  f"(cap sequenza {MAX_SEQUENCE_TOTAL_S:.0f}s per non tenere la UART oltre il lock-timeout)")
            times = max_times

    # esegui loop (command P<id>,1,<ticks>)
    ok_all = True
    for i in range(times):
        cmd = pump_nutrient_cmd(nid, seconds)
        ok = step(console, f"PUMP NUTRIENT-{nid} ON ({seconds:.2f}s) [{i+1}/{times}]", cmd)
        ok_all = ok_all and ok
        if i < times - 1:
            time.sleep(interval)

    # Stato: best-effort. Consideriamo "running" fino a fine sequenza.
    total = (times * float(seconds)) + ((times - 1) * float(interval))
    # H: usa l'helper standard (come do_pump_main) invece di ricalcolare a mano
    # until_ts/iso/local -> un solo formato ISO/timezone per tutte le pompe.
    until_info = make_until_timestamps(max(0.0, total))

    ts = now_ts()

    st_all = _load_state()
    prev = (st_all.get("pump_nutrients", {}) or {}).get("state", {}) or {"0": {}, "1": {}, "2": {}}
    state_now = {
        "0": dict(prev.get("0", {})),
        "1": dict(prev.get("1", {})),
        "2": dict(prev.get("2", {})),
    }

    # last specifico per questa pompa
    last_for_this_pump = {
        "ok": ok_all,
        "action": "run",
        "nid": nid,
        "seconds": float(seconds),
        "times": int(times),
        "interval": float(interval),
        **ts,
    }

    state_now[str(nid)] = {
        "running": True,
        "seconds": float(seconds),
        "times": int(times),
        "interval": float(interval),
        "total_s": float(total),
        **until_info,
        "ok": ok_all,
        **ts,
        # last incluso dentro lo stato di questa pompa
        "last": last_for_this_pump,
    }

    # Il last globale di _record è comunque utile per status/last, ma non per i singoli topic
    _record("pump_nutrients", ok_all, state_now, last_for_this_pump)


def do_ring(
    console: SerraConsole,
    action: str,
    color: str,
    fade: float,
    times: Optional[int],
    duration: float,
    interval: float,
) -> None:
    action = action.lower().strip()
    fade = float(max(0.0, fade))
    duration = float(max(0.0, duration))
    interval = float(max(0.0, interval))

    # parse color (named or HEX)
    ckey = (color or "white").lower().strip()
    if ckey in RING_COLORS:
        rgb = RING_COLORS[ckey]
    else:
        rgb = ckey.upper()
        if not re.fullmatch(r"[0-9A-F]{6}", rgb):
            raise SerraCommandError("Colore ring: nome (white/red/green/...) oppure HEX RRGGBB")

    def _mk_state(mode: str, running: bool, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        st: Dict[str, Any] = {
            "mode": mode,
            "color": rgb,
            "fade_s": float(fade),
            "running": bool(running),
            **now_ts(),
        }
        if extra:
            st.update(extra)
        return st

    if action == "off":
        cmd = ring_cmd(RING_COLORS["off"], fade=fade)
        ok = step(console, f"RING OFF (fade ~{fade}s)", cmd)
        _record(
            "ring",
            ok,
            _mk_state("off", False, {"cmd": cmd}),
            {"ok": ok, "action": "off", "cmd": cmd, **now_ts()},
        )
        return

    if action == "on":
        cmd = ring_cmd(rgb, fade=fade)
        ok = step(console, f"RING ON ({rgb}, fade ~{fade}s)", cmd)

        extra: Dict[str, Any] = {"cmd": cmd}
        if fade and fade > 0:
            extra["transition"] = "fading"
            extra.update(make_until_timestamps(fade))

        _record(
            "ring",
            ok,
            _mk_state("on", True, extra),
            {"ok": ok, "action": "on", "cmd": cmd, **now_ts()},
        )
        return

    if action != "blink":
        raise SerraCommandError("Uso: serra ring <on|off|blink> ...")

    # blink: finito, non infinito (safety)
    t = 5 if times is None else int(times)
    t = int(clamp(t, 1, 100))
    duration = float(clamp(duration, 0.1, 60.0))
    interval = float(clamp(interval, 0.0, 10.0))

    # B: come per i nutrienti, il blink tiene il lock UART per tutta la sequenza.
    # Limitiamo il numero di lampeggi cosi' che la durata totale resti sotto
    # MAX_SEQUENCE_TOTAL_S (< lock-timeout) e uno stop concorrente non fallisca.
    per_cycle = (fade + duration) + (fade + interval)
    if per_cycle > 0:
        max_t = max(1, int(MAX_SEQUENCE_TOTAL_S / per_cycle))
        if t > max_t:
            print(f"⚠️ RING blink: times {t} → {max_t} "
                  f"(cap sequenza {MAX_SEQUENCE_TOTAL_S:.0f}s per non bloccare la UART)")
            t = max_t

    # publish "running" all'inizio, con until
    total = (t * (duration + interval)) + (2 * fade * t)
    until_info = make_until_timestamps(max(0.0, total))
    _record(
        "ring",
        True,
        _mk_state(
            "blink",
            True,
            {
                "times": t,
                "duration_s": duration,
                "interval_s": interval,
                **until_info,
            },
        ),
        {"ok": True, "action": "blink_start", "times": t, **now_ts()},
    )

    ok_all = True
    for i in range(t):
        cmd_on = ring_cmd(rgb, fade=fade)
        ok_all = step(console, f"RING BLINK {i+1}/{t} ON ({rgb})", cmd_on) and ok_all
        time.sleep(fade + duration)  # aspetta fade + tempo a 100%
        cmd_off = ring_cmd(RING_COLORS["off"], fade=fade)
        ok_all = step(console, f"RING BLINK {i+1}/{t} OFF", cmd_off) and ok_all
        if i < t - 1:
            time.sleep(fade + interval)  # aspetta fade + tempo a 0%

    # stato finale: OFF
    _record(
        "ring",
        ok_all,
        _mk_state(
            "off",
            False,
            {
                "last_blink": {
                    "color": rgb,
                    "times": t,
                    "duration_s": duration,
                    "interval_s": interval,
                }
            },
        ),
        {"ok": ok_all, "action": "blink_end", "color": rgb, "times": t, **now_ts()},
    )


def do_net(console: SerraConsole, action: str, ntp: Optional[str]) -> bool:
    """
    net on/off
    - off: spegne apcli0/ra0, stop udhcpc/udhcpd/apcliautoconnect, kill ntpd (default)
    - on:  avvia /etc/init.d/S45net start; NTP start via /etc/init.d/S70time start (default)
    """
    if getattr(console, "active_transport", "uart") == "wifi":
        raise SerraCommandError("serra net on/off richiede UART: non interrompere il canale SSH attivo")
    action = (action or "").strip().lower()
    if action not in ("on", "off"):
        raise SerraCommandError("Uso: serra net on|off [--ntp on|off]")

    # default coerente: net on -> ntp on, net off -> ntp off
    if ntp is None:
        ntp_effective = (action == "on")
    else:
        ntp_effective = (ntp.strip().lower() == "on")

    ok = True

    if action == "off":
        ok &= step(
            console,
            "NET: stop udhcpc (pidfile)",
            "[ -s /var/run/udhcpc.pid ] && kill $(cat /var/run/udhcpc.pid) 2>/dev/null || true",
        )
        ok &= step(
            console,
            "NET: stop udhcpd (pidfile)",
            "[ -s /var/run/udhcpd.pid ] && kill $(cat /var/run/udhcpd.pid) 2>/dev/null || true",
        )
        ok &= step(
            console,
            "NET: stop apcliautoconnect (pidfile)",
            "[ -s /var/run/apcliautoconnect.pid ] && kill $(cat /var/run/apcliautoconnect.pid) 2>/dev/null || true",
        )

        ok &= step(console, "NET: apcli0 down", "ifconfig apcli0 down 2>/dev/null || true")
        ok &= step(console, "NET: ra0 down", "ifconfig ra0 down 2>/dev/null || true")
        # Scarica il driver wifi: stesso stato del boot (wifi disabilitata di default)
        ok &= step(console, "NET: unload mt_wifi", "rmmod mt_wifi 2>/dev/null || true")

        if ntp_effective is False:
            ok &= step(console, "NTP: kill ntpd", "killall ntpd 2>/dev/null || true")
        else:
            print("ℹ️  NTP lasciato attivo (richiesto)")

        print("✅ NET OFF (vale fino al prossimo reboot)")

    else:
        # action == on — risolve lo script rete comunque si chiami (S45net o,
        # se il wifi è disabilitato di default al boot, OFF_S45net).
        ok &= step(
            console,
            "NET: start (S45net/OFF_S45net start)",
            "S=$(ls /etc/init.d/S45net /etc/init.d/OFF_S45net 2>/dev/null | head -1); "
            "[ -n \"$S\" ] && sh \"$S\" start || echo no-net-script",
            # B-c: lo start rete (sh S45net start) puo' impiegare 5-8s; col
            # timeout default 4s run_checked scadeva -> falso ❌ e DESYNC (il
            # comando NTP successivo veniva scritto mentre lo start era ancora
            # in corso sulla console). 20s coprono l'avvio con margine.
            timeout=20,
        )
        if ntp_effective is True:
            ok &= step(
                console,
                "NTP: start (S70time start)",
                "/etc/init.d/S70time start 2>/dev/null || true",
            )
        else:
            ok &= step(console, "NTP: kill ntpd", "killall ntpd 2>/dev/null || true")

        print("✅ NET ON (vale fino al prossimo reboot)")

    # Stato LOGICO (non telemetria reale)
    st_update: Dict[str, Any] = {
        "enabled": (action == "on"),
        "ntp": bool(ntp_effective),
        **now_ts(),
    }
    last_update: Dict[str, Any] = {
        "ok": bool(ok),
        "action": action,
        "ntp": ("on" if ntp_effective else "off"),
        **now_ts(),
    }

    _record("net", bool(ok), st_update, last_update)
    return bool(ok)


# ---------------------------
# WATER LEVEL (magnetometro via Nebbia)
# ---------------------------
# Il livello acqua e' dato da un galleggiante magnetico letto da un magnetometro
# sul controller Nebbia. Si interroga inviando "M\r\n" a /dev/tty-nebbia; risponde
# con una o piu' triplette esadecimali "xxxx,yyyy,zzzz" (16-bit con segno).
# Il livello si ottiene per CALIBRAZIONE (vasca vuota + piena) proiettando la
# lettura corrente sul vettore vuoto->pieno (robusto: indipendente dall'asse).
# NB: leggere sempre a POMPA SPENTA / vasca a riposo (il motore pompa disturba il campo).

_MAG_READ_SHELL = (
    "(cat /dev/tty-nebbia > /tmp/serra_mag.raw & __MP=$!; "
    "sleep 0.4; printf 'M\\r\\n' > /dev/tty-nebbia; sleep 1.2; "
    "kill $__MP 2>/dev/null); cat /tmp/serra_mag.raw"
)
_MAG_TRIPLET_RE = re.compile(r"([0-9a-fA-F]{4}),([0-9a-fA-F]{4}),([0-9a-fA-F]{4})")


def _s16(h: str) -> int:
    v = int(h, 16)
    return v - 0x10000 if v >= 0x8000 else v


def read_magnetometer(console: SerraConsole, retries: int = 3) -> Optional[List[float]]:
    """Legge il magnetometro. Ritorna [x, y, z] (media delle triplette) o None."""
    for _ in range(max(1, retries)):
        raw = console.run_capture(_MAG_READ_SHELL, timeout=6.0)
        trips = _MAG_TRIPLET_RE.findall(raw or "")
        if trips:
            n = len(trips)
            return [
                sum(_s16(t[0]) for t in trips) / n,
                sum(_s16(t[1]) for t in trips) / n,
                sum(_s16(t[2]) for t in trips) / n,
            ]
        time.sleep(0.3)
    return None


def _water_level_pct(cur: List[float], empty: List[float], full: List[float]) -> Optional[float]:
    """Proiezione di (cur-empty) sul vettore (full-empty) -> 0..100%."""
    d = [full[i] - empty[i] for i in range(3)]
    denom = sum(x * x for x in d)
    if denom <= 0:
        return None
    num = sum((cur[i] - empty[i]) * d[i] for i in range(3))
    return round(max(0.0, min(1.0, num / denom)) * 100.0, 1)


def do_water(console: SerraConsole, action: str, point: Optional[str] = None) -> None:
    """
    water read                          -> stampa la lettura grezza [x,y,z]
    water calibrate <empty|full|earth>  -> salva la lettura come riferimento
    water level                         -> 0..100% (serve calibrazione empty+full) + MQTT
    """
    action = (action or "").lower().strip()
    cur = read_magnetometer(console)
    if cur is None:
        raise SerraConnectionError("Magnetometro: nessuna risposta dal controller Nebbia (comando M).")

    if action == "read":
        print(f"MAG raw: x={cur[0]:.1f} y={cur[1]:.1f} z={cur[2]:.1f}")
        return

    st = _load_state()
    water = st.setdefault("water", {"cal": {}, "state": {}, "last": None})
    cal = water.setdefault("cal", {})

    if action == "calibrate":
        pt = (point or "").lower().strip()
        if pt not in ("empty", "full", "earth"):
            raise SerraCommandError("Uso: serra water calibrate <empty|full|earth>")
        cal[pt] = {"xyz": cur, **now_ts()}
        _save_state(st)
        print(f"✅ WATER CALIBRATE {pt.upper()}: x={cur[0]:.1f} y={cur[1]:.1f} z={cur[2]:.1f}")
        return

    if action == "level":
        empty = (cal.get("empty") or {}).get("xyz")
        full = (cal.get("full") or {}).get("xyz")
        if not empty or not full:
            raise SerraCommandError(
                "Calibrazione mancante: esegui prima 'serra water calibrate empty' e '... full'."
            )
        pct = _water_level_pct(cur, empty, full)
        state_now = {
            "level_pct": pct,
            "raw": {"x": round(cur[0], 1), "y": round(cur[1], 1), "z": round(cur[2], 1)},
            "calibrated": True,
            **now_ts(),
        }
        water["state"] = state_now
        water["last"] = {"ok": True, "action": "level", "level_pct": pct, **now_ts()}
        _save_state(st)
        if _mqtt_enabled():
            base = MQTT_TOPIC.rstrip("/")
            _mqtt_publish(f"{base}/state/water", {"state": state_now, "last": water["last"]}, retain=True)
        print(f"✅ WATER LEVEL: {pct}%  (raw x={cur[0]:.1f} y={cur[1]:.1f} z={cur[2]:.1f})")
        return

    raise SerraCommandError("Uso: serra water <read|level|calibrate <empty|full|earth>>")


def do_uptime(console: SerraConsole) -> None:
    """Legge /proc/uptime della serra via console e pubblica il boot timestamp.

    Serve a RILEVARE I RIAVVII della serra senza falsi positivi: il topic
    serra/state/boot (retained) cambia SOLO quando il boot_ts cambia davvero.
    Anti-jitter: la lettura oscilla di qualche secondo tra un check e l'altro,
    quindi se il nuovo boot_ts dista <30s da quello memorizzato si ripubblica
    QUELLO. HA usa il cambio di stato come trigger del reconcile fisico
    (re-assert di luci/ventole/ring solo a riavvio vero, niente lampeggi
    periodici).
    """
    out = console.run_capture("cat /proc/uptime", timeout=6.0)
    up_s = None
    for tok in out.split():
        try:
            up_s = float(tok)
            break
        except ValueError:
            continue
    if up_s is None:
        raise SerraConnectionError(f"uptime: risposta console non interpretabile ({out[:80]!r})")

    boot_ts = time.time() - up_s
    st = _load_state()
    boot = st.setdefault("boot", {})
    prev = boot.get("boot_ts")
    riavvio = prev is not None and abs(boot_ts - float(prev)) > 30.0
    if prev is None or riavvio:
        boot["boot_ts"] = boot_ts
        boot["detected"] = now_ts()
        _save_state(st)
        canonical = boot_ts
    else:
        canonical = float(prev)

    payload = {
        "boot_ts": round(canonical, 1),
        "boot_iso": datetime.fromtimestamp(canonical, timezone.utc).isoformat(),
        "uptime_s": int(up_s),
        **now_ts(),
    }
    if _mqtt_enabled():
        base = MQTT_TOPIC.rstrip("/")
        _mqtt_publish(f"{base}/state/boot", payload, retain=True)
    # Anche l'uptime del PI stesso (locale), stessa logica anti-jitter,
    # per la riga "Raspberry Pi acceso da" in dashboard (serra/state/pi_boot).
    try:
        with open("/proc/uptime") as _f:
            pi_up = float(_f.read().split()[0])
        pi_boot_ts = time.time() - pi_up
        pboot = st.setdefault("pi_boot", {})
        pprev = pboot.get("boot_ts")
        if pprev is None or abs(pi_boot_ts - float(pprev)) > 30.0:
            pboot["boot_ts"] = pi_boot_ts
            _save_state(st)
            pi_canonical = pi_boot_ts
        else:
            pi_canonical = float(pprev)
        if _mqtt_enabled():
            base = MQTT_TOPIC.rstrip("/")
            _mqtt_publish(f"{base}/state/pi_boot", {
                "boot_ts": round(pi_canonical, 1),
                "boot_iso": datetime.fromtimestamp(pi_canonical, timezone.utc).isoformat(),
                "uptime_s": int(pi_up),
                **now_ts(),
            }, retain=True)
    except Exception:
        pass
    extra = " — RIAVVIO RILEVATO" if riavvio else ""
    print(f"UPTIME: {int(up_s)}s (boot {payload['boot_iso']}){extra}")


def do_foto(transport: Optional[str] = None, host: Optional[str] = None,
            ssh_port: Optional[int] = None, primary: Optional[str] = None) -> bool:
    """Lancia in background la pipeline foto /usr/local/bin/serra-foto.

    Il comando torna subito. La pipeline cambia temporaneamente i LED,
    scatta sul VoCore, ripristina le luci, trasferisce il JPEG via UART o SSH
    e lo pubblica su MQTT. Il log va in /tmp/serra-foto.log.
    """
    import subprocess
    pipeline = os.environ.get("SERRA_FOTO_BIN", "/usr/local/bin/serra-foto")
    if not os.path.isfile(pipeline) or not os.access(pipeline, os.X_OK):
        raise SerraCommandError(f"Pipeline foto non installata o non eseguibile: {pipeline}")
    photo_env = os.environ.copy()
    if transport is not None:
        photo_env["SERRA_TRANSPORT"] = transport
    if host is not None:
        photo_env["SERRA_SSH_HOST"] = host
    if ssh_port is not None:
        photo_env["SERRA_SSH_PORT"] = str(ssh_port)
    if primary is not None:
        photo_env["SERRA_PRIMARY_TRANSPORT"] = primary
    try:
        check = subprocess.run([pipeline, "--check"], capture_output=True,
                               text=True, timeout=15, env=photo_env)
    except subprocess.TimeoutExpired as exc:
        raise SerraCommandError("Verifica della pipeline foto scaduta") from exc
    if check.returncode != 0:
        raise SerraCommandError(
            "Pipeline foto non pronta: " + (check.stderr or check.stdout).strip()[-300:]
        )
    with open("/tmp/serra-foto.log", "ab") as logf:
        subprocess.Popen([pipeline],
                         stdout=logf, stderr=logf, start_new_session=True, env=photo_env)
    print("foto: pipeline avviata in background (log /tmp/serra-foto.log)")
    return True


def do_state_sync() -> bool:
    """
    Ricalcola gli stati time-based (es. pompe con durata) in base al tempo corrente.
    Non legge telemetrie reali: si limita a interpretare until_ts e a spegnere i flag 'running'
    quando il tempo è scaduto, aggiornando MQTT/state.json.
    """
    # state.json race: lock esclusivo per l'INTERO read-modify-write (serializza
    # con _record dei comandi, che gira con la UART tenuta ma non protegge state.json)
    with _StateLock():
        st = (_load_state() or {})
        _bump_last_seen(st)
        _derive_running_flags(st)

        # G: rimosso il blocco _expire_running(pump_main) + loop nutrienti che era
        # dead-code — _derive_running_flags(st) (chiamata qui sopra e di nuovo prima
        # del save) ri-deriva running/running_now da until_ts per TUTTI i componenti
        # (pump_main, ring, lights, nutrient 0/1/2), sovrascrivendo qualunque cosa
        # facesse quel blocco. Restano il refresh NET e il publish.

        # Refresh logico NET: non leggiamo lo stato reale, aggiorniamo solo i timestamp
        net = st.get("net")
        if isinstance(net, dict):
            nst = net.get("state") if isinstance(net.get("state"), dict) else {}
            enabled = bool(nst.get("enabled")) if "enabled" in nst else None
            ntp_val = bool(nst.get("ntp")) if "ntp" in nst else None

            new_state: Dict[str, Any] = {}
            if enabled is not None:
                new_state["enabled"] = enabled
            if ntp_val is not None:
                new_state["ntp"] = ntp_val
            new_state.update(now_ts())

            st["net"] = st.get("net") or {"state": {}, "last": None}
            st["net"]["state"] = new_state

        _derive_running_flags(st)
        _save_state(st)
    _publish_state_all(st)

    # Un heartbeat pulito
    try:
        if _mqtt_enabled():
            base = MQTT_TOPIC.rstrip("/")
            ts = now_ts()
            _mqtt_publish(
                f"{base}/status/last_seen",
                {
                    "ok": True,
                    "source": "controller",
                    "ts": ts["ts"],
                    "ts_iso": ts["ts_iso"],
                    "ts_local": ts["ts_local"],
                    "cli": SERRA_CLI,
                },
                retain=True,
            )
    except Exception:
        pass

    print("✅ STATE SYNC OK")
    return True


def do_checkup(
    console: SerraConsole,
    do_l: bool,
    do_f: bool,
    do_lr: bool,
    do_pm: bool,
    do_pn: bool,
) -> None:
    """
    CHECKUP COMPLETO (stato finale: tutto OFF)
    """
    print("=== CHECKUP START ===")

    try:
        # --- LUCI ---
        if do_l:
            # Colori singoli: G, B, R, D (2s ciascuno + 2s pausa)
            for ch in ["G", "B", "R", "D"]:
                do_lights(console, action="set", channel=ch, intensity=100, fade=0.0)
                sleep_s(2)
                do_lights(console, action="set", channel=ch, intensity=0, fade=0.0)
                sleep_s(2)

            # Full spectrum 5s
            do_lights(console, action="on", channel="A", intensity=100, fade=0.0)
            sleep_s(5)
            do_lights(console, action="off", channel="A", intensity=0, fade=0.0)

        # --- VENTOLE ---
        if do_f:
            # Singole: 1, 2, F al 100% (wake + 5s + off) con 3s pausa tra una e l'altra
            for which in ["1", "2", "F"]:
                do_fans(console, action="set", target=which, intensity_label="high")
                sleep_s(5)
                do_fans(console, action="set", target=which, intensity_label="off")
                sleep_s(3)

        # --- RING ---
        if do_lr:
            # Ring rosso: 3 blink, 1s on / 1s off, fade 1s
            do_ring(console, action="blink", color="red", fade=1, times=3, duration=1.0, interval=1.0)

        # --- NUTRIENTI ---
        if do_pn:
            for nid in [0, 1, 2]:
                do_pump_nutrient(console, nid=nid, seconds=1.0, times=1, interval=1.0)
                sleep_s(3)

        # --- POMPA PRINCIPALE ---
        if do_pm:
            do_pump_main(console, action="on", seconds=3.0)
            # il comando gestisce la durata; lo stato verrà normalizzato da state sync
    finally:
        # F: stato finale OFF garantito anche se un comando solleva a meta'
        # (prima, senza try/finally, una ventola/luce poteva restare accesa).
        # Best-effort: ogni off e' indipendente e NON deve mascherare l'eccezione
        # originale, quindi ne inghiottiamo gli errori qui. (Le pompe si
        # auto-spengono via firmware; il main ha anche il failsafe HA.)
        print("--- CHECKUP: spegnimento finale di sicurezza ---")

        def _off(desc, fn):
            try:
                fn()
            except Exception as e:
                print(f"⚠️ checkup off {desc} fallito: {e}")

        _off("luci", lambda: do_lights_mix(console, 0, 0, 0, 0, 0, 0.0))
        _off("ventole", lambda: do_fans(console, action="set", target="all", intensity_label="off"))
        _off("ring", lambda: do_ring(console, action="off", color="white", fade=0, times=None, duration=0.0, interval=0.0))

    # --- STATE SYNC FINALE ---
    try:
        sleep_s(3)
        do_state_sync()
        print("✅ STATE SYNC OK (post-checkup)")
    except Exception as e:
        print(f"⚠️ STATE SYNC FAILED (post-checkup): {e}")

    print("=== CHECKUP END ===")


# ---------------------------
# HELP esterno
# ---------------------------

def _load_help_text() -> str:
    """
    Carica il testo di help esteso dalla documentazione esterna.

    Per modificare la guida CLI, edita `serra_help.txt` accanto a questo script.
    """
    help_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), HELP_FILE_NAME)
    try:
        with open(help_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return (
            "Full CLI guide not found (missing `serra_help.txt`).\n"
            "Place a `serra_help.txt` file next to this script to customize this help."
        )
    except Exception as e:
        return f"Error loading help file {help_path}: {e}"


# ---------------------------
# Parser CLI
# ---------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="serra",
        formatter_class=argparse.RawTextHelpFormatter,
        description="Serra Controller (CLI) - console root via UART o SSH locale",
        epilog=_load_help_text(),
    )
    p.add_argument("--port", default=DEFAULT_SERIAL_PORT, help=f"UART port (default: {DEFAULT_SERIAL_PORT})")
    p.add_argument("--baud", default=DEFAULT_BAUDRATE, type=int, help=f"UART baudrate (default: {DEFAULT_BAUDRATE})")
    p.add_argument("--transport", choices=("uart", "wifi", "auto"), default=DEFAULT_TRANSPORT,
                   help="canale verso la serra (default: SERRA_TRANSPORT o uart)")
    p.add_argument("--ssh-host", default=DEFAULT_SSH_HOST, help="IP o nome della serra sulla LAN")
    p.add_argument("--ssh-port", type=int, default=DEFAULT_SSH_PORT, help="porta SSH della serra")
    p.add_argument("--primary", choices=("uart", "wifi"), default=DEFAULT_PRIMARY_TRANSPORT,
                   help="canale preferito in modalita' auto (default: wifi)")

    sub = p.add_subparsers(dest="cmd", required=True)

    auth = sub.add_parser("auth", help="Salva la password console in un file privato per la CLI manuale")
    auth_sub = auth.add_subparsers(dest="auth_cmd", required=True)
    auth_sub.add_parser("save", help="Chiede la password una volta e la salva per l'utente corrente")

    # lights
    pl = sub.add_parser("lights", help="Controllo luci")
    pl_sub = pl.add_subparsers(dest="action", required=True)

    pl_on = pl_sub.add_parser("on", help="Accende luci full spectrum (A)")
    pl_on.add_argument("-i", "--intensity", type=int, default=100, help="0..100 (default 100)")
    pl_on.add_argument("-f", "--fade", type=float, default=0, help="secondi (approx) (default 0)")

    pl_off = pl_sub.add_parser("off", help="Spegne luci full spectrum (A)")
    pl_off.add_argument("-f", "--fade", type=float, default=0, help="secondi (approx) (default 0)")

    pl_set = pl_sub.add_parser("set", help="Imposta canale A/G/B/R/D")
    pl_set.add_argument("channel", type=str, help="A|G|B|R|D")
    pl_set.add_argument("-i", "--intensity", type=int, default=100, help="0..100 (default 100)")
    pl_set.add_argument("-f", "--fade", type=float, default=0, help="secondi (approx) (default 0)")

    pl_preset = pl_sub.add_parser("preset", help="Preset luce (viola/verde/bianco)")
    pl_preset.add_argument("preset", type=str, help="viola|verde|bianco")
    pl_preset.add_argument("-i", "--intensity", type=int, default=100,
                           help="scala 0..100 sulla ricetta (default 100)")
    pl_preset.add_argument("-f", "--fade", type=float, default=0, help="secondi (approx) (default 0)")

    pl_mix = pl_sub.add_parser("mix", help="Imposta tutti i canali insieme (atomico)")
    pl_mix.add_argument("-a", type=int, default=0, help="canale A %% (0..100)")
    pl_mix.add_argument("-g", type=int, default=0, help="canale G %% (0..100)")
    pl_mix.add_argument("-b", type=int, default=0, help="canale B %% (0..100)")
    pl_mix.add_argument("-r", type=int, default=0, help="canale R %% (0..100)")
    pl_mix.add_argument("-d", type=int, default=0, help="canale D %% (0..100)")
    pl_mix.add_argument("-f", "--fade", type=float, default=0, help="secondi (approx) (default 0)")

    # fans
    pf = sub.add_parser("fans", help="Controllo ventole")
    pf_sub = pf.add_subparsers(dest="action", required=True)

    pf_on = pf_sub.add_parser("on", help="Accende tutte le ventole")
    pf_on.add_argument("-i", "--intensity", default="medium", help="off|low|medium|high (default medium)")

    pf_off = pf_sub.add_parser("off", help="Spegne tutte le ventole")

    pf_set = pf_sub.add_parser("set", help="Imposta una ventola o tutte")
    pf_set.add_argument("target", help="1|2|F|all")
    pf_set.add_argument("-i", "--intensity", default="medium", help="off|low|medium|high (default medium)")

    # pump
    pp = sub.add_parser("pump", help="Controllo pompe")
    pp_sub = pp.add_subparsers(dest="ptype", required=True)

    ppm = pp_sub.add_parser("main", help="Pompa principale")
    ppm_sub = ppm.add_subparsers(dest="action", required=True)
    ppm_on = ppm_sub.add_parser("on", help="Pompa principale ON per N secondi")
    ppm_on.add_argument("-s", "--seconds", type=float, default=1, help="secondi (default 1, max 300)")
    ppm_off = ppm_sub.add_parser("off", help="Pompa principale OFF immediato")

    ppn = pp_sub.add_parser("nutrient", help="Pompe nutrienti (0/1/2)")
    ppn.add_argument("nid", type=int, help="0|1|2")
    ppn.add_argument("-s", "--seconds", type=float, default=1.0, help=f"secondi (default 1, max {int(MAX_NUTRIENT_DURATION_S)})")
    ppn.add_argument("-t", "--times", type=int, default=1, help="ripetizioni (default 1, max 100)")
    ppn.add_argument("-i", "--interval", type=float, default=1.0, help="intervallo tra ripetizioni (default 1, max 120)")

    # ring
    pr = sub.add_parser("ring", help="Controllo LED ring")
    pr_sub = pr.add_subparsers(dest="action", required=True)

    pr_on = pr_sub.add_parser("on", help="Ring ON fisso")
    pr_on.add_argument("-c", "--color", default="white", help="nome colore o HEX RRGGBB (default white)")
    pr_on.add_argument("-f", "--fade", type=float, default=0.0, help="secondi (approx) (default 0)")

    pr_off = pr_sub.add_parser("off", help="Ring OFF")
    pr_off.add_argument("-f", "--fade", type=float, default=0.0, help="secondi (approx) (default 0)")

    pr_blink = pr_sub.add_parser("blink", help="Ring BLINK")
    pr_blink.add_argument("-c", "--color", default="white", help="nome colore o HEX RRGGBB (default white)")
    pr_blink.add_argument("-t", "--times", type=int, default=5, help="numero lampeggi (default 5, max 100)")
    pr_blink.add_argument("-f", "--fade", type=float, default=0.0, help="fade in/out (approx) (default 0)")
    pr_blink.add_argument("-d", "--duration", type=float, default=1.0, help="durata ON per lampeggio (default 1, max 60)")
    pr_blink.add_argument("-i", "--interval", type=float, default=1.0, help="pausa OFF tra lampeggi (default 1, max 10)")

    # checkup
    pc = sub.add_parser("checkup", help="Checkup completo componenti")
    pc.add_argument("-l", "--lights", choices=["on", "off"], default="on")
    pc.add_argument("-f", "--fans", choices=["on", "off"], default="on")
    pc.add_argument("-lr", "--led-ring", choices=["on", "off"], default="on", dest="led_ring")
    pc.add_argument("-pm", "--pump-main", choices=["on", "off"], default="on", dest="pump_main")
    pc.add_argument("-pn", "--pump-nutrients", choices=["on", "off"], default="on", dest="pump_nutrients")

    # net
    pnw = sub.add_parser("net", help="Rete serra ON/OFF (+ NTP)")
    pnw.add_argument("action", choices=["on", "off"])
    pnw.add_argument("-n", "--ntp", choices=["on", "off"], default=None, help="override NTP (default: on con net on, off con net off)")

    # STATE / SYNC
    ps = sub.add_parser("state", help="Pubblica/risincronizza lo stato (MQTT)")
    ps_sub = ps.add_subparsers(dest="state_cmd", required=True)
    ps_sub.add_parser("sync", help="Ricalcola running_now e ripubblica /serra/state/*")

    # WATER (livello vasca via magnetometro)
    pw = sub.add_parser("water", help="Livello acqua (magnetometro) + calibrazione")
    pw_sub = pw.add_subparsers(dest="water_cmd", required=True)
    pw_sub.add_parser("read", help="Legge il magnetometro grezzo [x,y,z]")
    pw_sub.add_parser("level", help="Calcola livello 0..100%% (serve calibrazione) + MQTT")
    pw_cal = pw_sub.add_parser("calibrate", help="Salva un riferimento di calibrazione")
    pw_cal.add_argument("point", choices=["empty", "full", "earth"], help="quale riferimento salvare")

    sub.add_parser("uptime", help="Legge uptime/boot della serra e pubblica serra/state/boot (rilevazione riavvii)")
    sub.add_parser("foto", help="Scatta la foto della serra (pipeline completa, in background)")

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # I processi staccati (foto e dead-man) devono usare la stessa scelta della CLI.
    os.environ["SERRA_TRANSPORT"] = args.transport
    os.environ["SERRA_SSH_HOST"] = args.ssh_host
    os.environ["SERRA_SSH_PORT"] = str(args.ssh_port)
    os.environ["SERRA_PRIMARY_TRANSPORT"] = args.primary

    if args.cmd == "auth":
        try:
            do_auth_save()
        except SerraError as exc:
            parser.error(str(exc))
        return

    needs_console = not (args.cmd == "state" and getattr(args, "state_cmd", None) == "sync") and args.cmd != "foto"
    try:
        password = _resolve_console_password() if needs_console else ""
    except SerraError as exc:
        parser.error(str(exc))
    if needs_console and not password:
        parser.error("Esegui 'serra auth save' oppure imposta SERRA_ROOT_PASSWORD prima di collegarti")

    cfg = ConsoleConfig(
        port=args.port,
        baudrate=args.baud,
        user=DEFAULT_USER,
        password=password,
    )

    try:
        console = make_console(cfg, args.transport, args.ssh_host, args.ssh_port, args.primary) if needs_console else None
    except SerraError as exc:
        parser.error(str(exc))
    # `state sync` è puramente logico (ricalcolo timestamp + publish MQTT): non
    # tocca la UART. Evitiamo di aprire la seriale e fare login inutilmente — e
    # soprattutto di contendere la porta col resto ogni 30 minuti (timer).
    try:
        if needs_console:
            console.open()
            console.ensure_root_prompt()

        if args.cmd == "lights":
            if args.action == "on":
                do_lights(console, "on", None, args.intensity, args.fade)
            elif args.action == "off":
                do_lights(console, "off", None, 0, args.fade)
            elif args.action == "set":
                do_lights(console, "set", args.channel, args.intensity, args.fade)
            elif args.action == "preset":
                do_lights_preset(console, args.preset, args.intensity, args.fade)
            elif args.action == "mix":
                do_lights_mix(console, args.a, args.g, args.b, args.r, args.d, args.fade)

        elif args.cmd == "fans":
            if args.action == "on":
                do_fans(console, "on", None, args.intensity)
            elif args.action == "off":
                do_fans(console, "off", None, "off")
            elif args.action == "set":
                do_fans(console, "set", args.target, args.intensity)

        elif args.cmd == "pump":
            if args.ptype == "main":
                if args.action == "on":
                    do_pump_main(console, "on", args.seconds)
                else:
                    do_pump_main(console, "off", 0)
            elif args.ptype == "nutrient":
                do_pump_nutrient(console, args.nid, args.seconds, args.times, args.interval)

        elif args.cmd == "ring":
            if args.action == "on":
                do_ring(console, "on", args.color, args.fade, None, 0, 0)
            elif args.action == "off":
                do_ring(console, "off", "off", args.fade, None, 0, 0)
            elif args.action == "blink":
                do_ring(console, "blink", args.color, args.fade, args.times, args.duration, args.interval)

        elif args.cmd == "checkup":
            do_checkup(
                console,
                do_l=(args.lights == "on"),
                do_f=(args.fans == "on"),
                do_lr=(args.led_ring == "on"),
                do_pm=(args.pump_main == "on"),
                do_pn=(args.pump_nutrients == "on"),
            )

        elif args.cmd == "net":
            do_net(console, args.action, args.ntp)

        elif args.cmd == "state":
            if args.state_cmd == "sync":
                do_state_sync()

        elif args.cmd == "water":
            if args.water_cmd == "read":
                do_water(console, "read")
            elif args.water_cmd == "level":
                do_water(console, "level")
            elif args.water_cmd == "calibrate":
                do_water(console, "calibrate", args.point)

        elif args.cmd == "uptime":
            do_uptime(console)

        elif args.cmd == "foto":
            do_foto(args.transport, args.ssh_host, args.ssh_port, args.primary)

        else:
            raise SerraError("Comando non riconosciuto (bug parser).")

    except SerraCommandError as ex:
        eprint(f"ERRORE COMANDO: {ex}")
        sys.exit(2)
    except SerraConnectionError as ex:
        eprint(f"ERRORE CONNESSIONE: {ex}")
        sys.exit(1)
    except SerraError as ex:
        eprint(f"ERRORE: {ex}")
        sys.exit(1)
    except Exception as ex:
        eprint(f"ERRORE IMPREVISTO: {ex}")
        sys.exit(1)
    finally:
        # Chiudi connessione MQTT (se aperta) e seriale
        if _mqtt_enabled():
            try:
                MQTTManager.get_instance().close()
            except Exception:
                pass
        if console is not None:
            console.close()


if __name__ == "__main__":
    main()
