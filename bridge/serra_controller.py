#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Serra Controller (CLI only) - UART console root -> comandi hardware via /dev/tty-local e /dev/tty-nebbia.

Obiettivo:
- Comandi "umani" (lights/fans/pump/ring/checkup/net)
- Niente MQTT per ora (verrà dopo)
- Robustezza: login root via console + marker di conferma per ogni comando

Install alias "serra":
  sudo chmod +x /home/pi/serra_controller.py
  sudo ln -sf /home/pi/serra_controller.py /usr/local/bin/serra

NOTA DOCUMENTAZIONE CLI:
- La guida lunga all'uso della CLI è stata spostata in un file di testo esterno.
- Per modificarla, edita il file `serra_help.txt` posizionato nella stessa directory di questo script.
"""

import argparse
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

import fcntl
import json
import tempfile
import threading

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

# Credenziali console serra (BusyBox login)
# La password della console va fornita tramite variabile d'ambiente.
DEFAULT_USER = os.environ.get("SERRA_ROOT_USER", "root")
DEFAULT_PASSWORD = os.environ.get("SERRA_ROOT_PASSWORD", "")

# Limiti e costanti "magiche" resi espliciti
MAX_PUMP_DURATION_S = 300                   # secondi massimi pompa principale
MAX_NUTRIENT_DURATION_S = 300.0             # secondi massimi pompa nutrienti
MAX_NUTRIENT_TIMES = 100                    # ripetizioni massime pompa nutrienti
MAX_NUTRIENT_INTERVAL_S = 120.0             # intervallo massimo tra ripetizioni nutrienti
MIN_FAN_RELIABLE_PCT = 40                   # sotto questo %, la ventola può non partire
MAX_LIGHT_FADE_UNITS = 0xFFF                # 12-bit fade luci
MAX_RING_FADE_UNITS = 0xFF                  # 8-bit fade ring
SERIAL_READ_CHUNK_SIZE = 4096               # dimensione lettura seriale
STATE_SCHEMA_VERSION = 1                    # versione schema file stato
HELP_FILE_NAME = "serra_help.txt"  # file esterno accanto al controller


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
MQTT_HOST = os.environ.get("SERRA_MQTT_HOST", "").strip()
MQTT_PORT = int(os.environ.get("SERRA_MQTT_PORT", "1883").strip() or "1883")
MQTT_USER = os.environ.get("SERRA_MQTT_USER", "").strip()
MQTT_PASS = os.environ.get("SERRA_MQTT_PASS", "")
SERRA_CLI = os.environ.get("SERRA_CLI", "serra")
MQTT_TOPIC = os.environ.get("SERRA_MQTT_TOPIC", "serra").strip() or "serra"

MQTT_CLIENT_ID = os.environ.get("SERRA_MQTT_CLIENT_ID", "").strip() or f"serra-controller-{os.getpid()}"
MQTT_ENABLED = bool(MQTT_HOST)  # solo "host presente" (la libreria è verificata da _mqtt_enabled)
COMMAND_FAILED = False

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
    Salva lo stato in modo atomico. Il lock della CLI serializza l'intera
    operazione di lettura, modifica e scrittura tra processi del controller.
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
        if self._client is None:
            return
        data = json.dumps(payload, ensure_ascii=False)
        info = self._client.publish(topic, data, qos=1, retain=retain)
        info.wait_for_publish(timeout=5)
        if not info.is_published():
            raise SerraConnectionError(f"MQTT: pubblicazione non confermata per {topic}")

    def close(self) -> None:
        if self._client and self._connected:
            try:
                self._client.disconnect()
                self._client.loop_stop()
            except Exception:
                pass
        self._client = None
        self._connected = False


def _mqtt_publish(topic: str, payload: Dict[str, Any], retain: bool = True) -> None:
    """Pubblica un JSON su MQTT (best-effort). Se MQTT non è configurato, no-op."""
    if not _mqtt_enabled():
        return
    MQTTManager.get_instance().publish(topic, payload, retain=retain)


def _mqtt_status(msg: str, ok: bool = True, **extra: Any) -> None:
    """Pubblica un 'last seen' leggibile nel topic serra/status/last_seen."""
    if not _mqtt_enabled():
        return
    payload: Dict[str, Any] = {
        "ok": bool(ok),
        "msg": str(msg),
        **now_ts(),
    }
    if extra:
        payload.update(extra)
    _mqtt_publish(f"{MQTT_TOPIC.rstrip('/')}/status/last_seen", payload, retain=True)


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
            running_now = now < float(until) and bool(obj.get("ok", True))
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
            # Il fade termina, ma il ring resta acceso: until_ts nelle vecchie
            # versioni descriveva il fade e non lo spegnimento del LED.
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
    password: str = DEFAULT_PASSWORD
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

    def open(self) -> None:
        try:
            self.ser = serial.Serial(
                self.cfg.port,
                self.cfg.baudrate,
                timeout=self.cfg.timeout,
                write_timeout=self.cfg.write_timeout,
            )
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
        except Exception as ex:
            raise SerraConnectionError(f"Impossibile aprire {self.cfg.port} a {self.cfg.baudrate}: {ex}")

    def close(self) -> None:
        if self.ser:
            try:
                self.ser.close()
            except Exception:
                pass
        self.ser = None

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
        Conferma il completamento con successo del comando nella shell.
        Il marker non compare per intero nella riga inviata, così l'eco
        della console non può essere scambiata per la risposta.
        """
        assert self.ser is not None
        nonce = f"{now_ms()}_{os.getpid()}"
        marker = f"__SERRA_OK_{nonce}__"
        full = f"{cmd} && printf '\\n__SERRA_OK_%s__\\n' '{nonce}'"
        self._write_line(full)

        marker_re = re.compile(rb"(?:^|[\r\n])" + re.escape(marker.encode("ascii")) + rb"(?:[\r\n]|$)")
        out = self._read_until([marker_re], timeout=timeout)

        return bool(marker_re.search(out))


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


def _ring_color_to_hex(color: str) -> str:
    c = color.strip()
    key = c.lower()
    if key in RING_COLORS:
        return RING_COLORS[key]
    # HEX custom (6 chars)
    if re.fullmatch(r"[0-9a-fA-F]{6}", c):
        return c.upper()
    raise SerraCommandError("Colore ring: nome (white/red/green/yellow/orange/blue/purple) oppure HEX RRGGBB")


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
    global COMMAND_FAILED
    if not ok:
        COMMAND_FAILED = True
    try:
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
        COMMAND_FAILED = True
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

    def _mk_state(ch: str, intensity_pct: int, fade_s: float) -> Dict[str, Any]:
        t = now_ts()
        st: Dict[str, Any] = {
            "channel": ch,
            "intensity_pct": int(intensity_pct),
            "fade_s": float(fade_s),
            "on": bool(intensity_pct > 0),
            **t,
        }
        if fade_s and fade_s > 0:
            st.update({"transition": "fading"})
            st.update(make_until_timestamps(fade_s))
        return st

    if action == "on":
        ch = "A"
        cmd = light_cmd(ch, intensity if intensity is not None else 100, fade)
        ok = step(console, f"LIGHTS ON (A, intensity {intensity}%, fade ~{fade}s)", cmd)
        _record(
            "lights",
            ok,
            _mk_state(ch, intensity, fade),
            {"ok": ok, "action": "on", "cmd": cmd, **now_ts()},
        )
        return

    if action == "off":
        ch = "A"
        cmd = light_cmd(ch, 0, fade)
        ok = step(console, f"LIGHTS OFF (fade ~{fade}s)", cmd)
        _record(
            "lights",
            ok,
            _mk_state(ch, 0, fade),
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
    _record(
        "lights",
        ok,
        _mk_state(ch, intensity, fade),
        {"ok": ok, "action": "set", "cmd": cmd, **now_ts()},
    )


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
        if level in ("low", "medium"):
            ok = ok and wake_used

        ts = now_ts()
        state_now[fan_id] = {
            "level": level,
            "pct": pct_val,
            "running": bool(pct_val > 0),
            "wake_used": wake_used,
            "ok": ok,
            "cmd": cmd,
            **ts,
            # last per questa specifica ventola
            "last": {
                "ok": ok,
                "action": action,
                "target": fan_id,
                "level": level,
                "pct": pct_val,
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
    ok = step(console, f"PUMP MAIN ON ({sec}s)", cmd)

    st: Dict[str, Any] = {
        "running": bool(ok),
        "seconds": sec,
        "cmd": cmd,
        **now_ts(),
    }
    st.update(make_until_timestamps(sec))

    _record(
        "pump_main",
        ok,
        st,
        {"ok": ok, "action": "on", "cmd": cmd, **now_ts()},
    )


def do_pump_nutrient(console: SerraConsole, nid: int, seconds: float, times: int, interval: float):
    nid = int(nid)
    if nid not in (0, 1, 2):
        raise ValueError("Nutrient id: 0|1|2")

    times = clamp(int(times), 1, 100)
    interval = clamp(float(interval), 0.0, 120.0)
    seconds = clamp(float(seconds), 0.1, 300.0)

    # esegui loop (command P<id>,1,<ticks>)
    ok_all = True
    for i in range(times):
        cmd = pump_nutrient_cmd(nid, seconds)
        ok = step(console, f"PUMP NUTRIENT-{nid} ON ({seconds:.2f}s) [{i+1}/{times}]", cmd)
        ok_all = ok_all and ok
        if not ok:
            break
        if i < times - 1:
            # L'MCU esegue l'impulso in autonomia: aspetta che finisca prima
            # di iniziare la pausa richiesta e inviare l'impulso successivo.
            time.sleep(seconds + interval)

    # All'uscita dal ciclo resta soltanto l'ultimo impulso da completare.
    total = (times * float(seconds)) + ((times - 1) * float(interval))
    until = time.time() + max(0.0, float(seconds))

    dt_utc = datetime.fromtimestamp(until, tz=timezone.utc)
    dt_local = dt_utc.astimezone(ROME_TZ)

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
        "running": bool(ok_all),
        "seconds": float(seconds),
        "times": int(times),
        "interval": float(interval),
        "total_s": float(total),
        "until_ts": until,
        "until_iso": dt_utc.isoformat().replace("+00:00", "Z"),
        "until_local": dt_local.isoformat(),
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
            transition_until = make_until_timestamps(fade)
            extra.update({f"transition_{key}": value for key, value in transition_until.items()})

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

    # publish "running" all'inizio, con until
    total = (t * duration) + ((t - 1) * interval) + (2 * fade * t)
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

        if ntp_effective is False:
            ok &= step(console, "NTP: kill ntpd", "killall ntpd 2>/dev/null || true")
        else:
            print("ℹ️  NTP lasciato attivo (richiesto)")

        print("✅ NET OFF (vale fino al prossimo reboot)")

    else:
        # action == on
        ok &= step(console, "NET: start (S45net start)", "/etc/init.d/S45net start")
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


def do_state_sync() -> bool:
    """
    Ricalcola gli stati time-based (es. pompe con durata) in base al tempo corrente.
    Non legge telemetrie reali: si limita a interpretare until_ts e a spegnere i flag 'running'
    quando il tempo è scaduto, aggiornando MQTT/state.json.
    """
    st = (_load_state() or {})
    _bump_last_seen(st)
    _derive_running_flags(st)

    now = time.time()

    def _expire_running(comp_key: str) -> None:
        comp = st.get(comp_key)
        if not isinstance(comp, dict):
            return
        state = comp.get("state") if isinstance(comp.get("state"), dict) else None
        if not state:
            return
        until_ts = state.get("until_ts")
        if until_ts is None:
            return
        try:
            until = float(until_ts)
        except Exception:
            return
        if now >= until:
            if state.get("running") is True:
                state["running"] = False
            state["running_now"] = False

    _expire_running("pump_main")

    # nutrient pumps: chiavi "0","1","2" dentro pump_nutrients.state
    pn = st.get("pump_nutrients")
    if isinstance(pn, dict):
        pn_state = pn.get("state")
        if isinstance(pn_state, dict):
            for k in ("0", "1", "2"):
                state = pn_state.get(k)
                if not isinstance(state, dict):
                    continue
                until_ts = state.get("until_ts")
                if until_ts is None:
                    continue
                try:
                    until = float(until_ts)
                except Exception:
                    continue
                if now >= until:
                    if state.get("running") is True:
                        state["running"] = False
                    state["running_now"] = False

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

    # --- STATE SYNC FINALE ---
    try:
        sleep_s(3)
        do_state_sync()
        print("✅ STATE SYNC OK (post-checkup)")
    except Exception as e:
        global COMMAND_FAILED
        COMMAND_FAILED = True
        print(f"⚠️ STATE SYNC FAILED (post-checkup): {e}")

    print("=== CHECKUP END ===")


# ---------------------------
# HELP esterno
# ---------------------------

def _load_help_text() -> str:
    """
    Carica il testo di help esteso dalla documentazione esterna.

    Per modificare la guida CLI, edita il file `serra_help.txt`
    posizionato nella stessa directory di questo script.
    """
    # Il comando /usr/local/bin/serra è un symlink: risolvi il file reale.
    base_dir = os.path.dirname(os.path.realpath(__file__))
    help_path = os.path.join(base_dir, HELP_FILE_NAME)
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
        description="Serra Controller (CLI) - UART console root",
        epilog=_load_help_text(),
    )
    p.add_argument("--port", default=DEFAULT_SERIAL_PORT, help=f"UART port (default: {DEFAULT_SERIAL_PORT})")
    p.add_argument("--baud", default=DEFAULT_BAUDRATE, type=int, help=f"UART baudrate (default: {DEFAULT_BAUDRATE})")

    sub = p.add_subparsers(dest="cmd", required=True)

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
    ppn.add_argument("-s", "--seconds", type=float, default=1.0, help="secondi (default 1, max 300)")
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

    return p


def main() -> None:
    global COMMAND_FAILED
    COMMAND_FAILED = False
    parser = build_parser()
    args = parser.parse_args()

    if not DEFAULT_PASSWORD:
        parser.error("Set SERRA_ROOT_PASSWORD in the environment before connecting to the device")

    cfg = ConsoleConfig(
        port=args.port,
        baudrate=args.baud,
        user=DEFAULT_USER,
        password=DEFAULT_PASSWORD,
    )

    # Un solo processo alla volta può usare la console e aggiornare lo stato.
    # Include i comandi MQTT e i due timer systemd.
    lock_path = STATE_FILE_DEFAULT + ".lock"
    os.makedirs(os.path.dirname(lock_path) or ".", exist_ok=True)
    lock_file = open(lock_path, "a+")
    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)

    console = SerraConsole(cfg)
    try:
        console.open()
        console.ensure_root_prompt()

        if args.cmd == "lights":
            if args.action == "on":
                do_lights(console, "on", None, args.intensity, args.fade)
            elif args.action == "off":
                do_lights(console, "off", None, 0, args.fade)
            elif args.action == "set":
                do_lights(console, "set", args.channel, args.intensity, args.fade)

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

        else:
            raise SerraError("Comando non riconosciuto (bug parser).")

        if COMMAND_FAILED:
            raise SerraError("Uno o piu comandi non sono stati confermati dalla console; controlla i messaggi sopra.")

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
        console.close()
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()


if __name__ == "__main__":
    main()
