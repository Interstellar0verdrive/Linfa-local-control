#!/usr/bin/env python3
"""Serra Piano — backend dell'add-on.

Serve la UI statica (www/) e /api/timeline: un unico endpoint che
raccoglie dagli stati HA tutto quello che serve alla timeline.
La logica di composizione (fasi effettive -> giorni -> eventi) sta nel
frontend: qui si passano solo gli stati grezzi, cosi' c'e' UN posto solo
dove vive il modello.

Modalita' sviluppo: senza SUPERVISOR_TOKEN (fuori dall'add-on) serve
backend/fixture.json — dati reali catturati dai sensori il 2026-07-23.

Ingress: HA fa da proxy e riscrive i path, quindi il frontend usa SOLO
URL relativi ("api/timeline", non "/api/timeline").
"""
import datetime
import hashlib
import json
import math
import re
import logging
import os
import random
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, "..", "www")
PORT = 8099

# AUDIT R1 (BE-07): tetto ai body dei POST — note e piano stanno in KB, non MB.
MAX_BODY = 1 << 20  # 1 MiB

# AUDIT R1 (BE-09): prima non c'era NESSUN log — "il pannello non parte" era
# indiagnosticabile dal log dell'add-on. Livello sobrio: WARNING/ERROR sugli
# imprevisti, niente rumore sulle richieste normali.
logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                    format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("serra")

# AUDIT R1 (BE-03/BE-08): il server e' THREADED — le sezioni read-modify-write
# su file condivisi vanno serializzate (due tab = perdita silenziosa).
PLAN_LOCK = threading.Lock()
# AUDIT R2 (BE2-10): al massimo 2 validazioni concorrenti — ogni POST /api/piano
# lancia un python3 figlio PRIMA del lock; senza tetto, N richieste = N interpreti.
VALIDATE_SEM = threading.Semaphore(2)
NOTE_LOCK = threading.Lock()

# Guide: cartella "live" editabile a caldo, montata via homeassistant_config
# (= /config di HA, dove vive gia' serra_piano.yaml). Se un file guide/... esiste
# qui vince sulla copia inclusa in www/, cosi' le guide si modificano dallo share
# senza rebuild. In dev (nessun supervisor) la cartella non esiste e si usa il
# fallback baked. Override con la env GUIDE_DIR.
GUIDE_LIVE = os.environ.get("GUIDE_DIR", "/homeassistant/serra_piano_guide")
# AUDIT R1 (M-17): quello che una guida puo' essere. Estensione -> Content-Type
# ESPLICITO: niente mimetypes.guess_type, che dedurrebbe text/html da un .html
# lasciato nella cartella e lo servirebbe dalla stessa origin dell'app.
GUIDE_TYPES = {
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN")
CORE_API = "http://supervisor/core/api"

# Tutto cio' che la timeline consuma. Aggiungere qui = arriva al frontend.
# AUDIT R1 (BE-12): le entita' milestone (inizio_*/conferma_*) NON stanno
# qui apposta — il model non le legge (i valori arrivano dentro `mappa`);
# compaiono solo come TARGET delle service call del pannello.
ENTITIES = [
    "sensor.serra_fasi_effettive",
    "sensor.serra_eventi_effettivi",
    "input_boolean.serra_coltivazione_attiva",
    "sensor.serra_fase",
    "sensor.serra_giorno_ciclo",
    "sensor.serra_piano",
    "input_datetime.serra_data_semina",
    "input_select.serra_varieta",
    "input_boolean.serra_schedule_luci",
    "input_boolean.serra_schedule_acqua",
    "input_boolean.serra_schedule_ventole",
    # modalita' Pianificato/Libero dei nutrienti (04/08): quarto gemello
    "input_boolean.serra_schedule_nutrienti",
    "input_boolean.serra_dosatori_auto",
    "sensor.serra_acqua_litri",
    "sensor.serra_livello_acqua_last_update",
    "input_number.serra_vasca_litri",
    "input_datetime.serra_luci_on",
    "input_datetime.serra_luci_off",
    "sensor.serra_clima_temperatura",
    "sensor.serra_clima_umidita",
    "sensor.serra_vpd",
    "sensor.serra_diario",
    # AUDIT R1 (I-13): i due valori che il frontend leggeva con una sonda su
    # api/stato tutta sua (= una GET /states completa al minuto per due
    # campi). Qui costano zero: la GET si fa comunque.
    "sensor.serra_bridge_online",
    "input_text.serra_errore_componente",
]


def ha_get(path, timeout=10):
    req = urllib.request.Request(
        CORE_API + path,
        headers={"Authorization": "Bearer %s" % SUPERVISOR_TOKEN},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def timeline_payload():
    """AUDIT R1 (BE-02): UNA chiamata GET /states filtrata localmente, invece
    di 28 GET sequenziali (fino a ~280s cumulativi con il core lento). Se la
    chiamata unica fallisce si solleva: il chiamante risponde 502 e il
    frontend mostra l'errore invece di un payload vuoto 'plausibile'."""
    if not SUPERVISOR_TOKEN:
        # AUDIT R2 (M-R2-8): la fixture si serve verbatim, quindi deve contenere
        # anche le due entita' dei banner globali (sensor.serra_bridge_online e
        # input_text.serra_errore_componente): senza, in dev restano "non lo so"
        # e i due banner non si accendono nemmeno cambiando scenario.
        with open(os.path.join(HERE, "fixture.json"), encoding="utf-8") as f:
            return json.load(f)
    wanted = set(ENTITIES)
    by_id = {}
    for s in ha_get("/states"):
        eid = s.get("entity_id")
        if eid in wanted:
            by_id[eid] = {"state": s.get("state"), "attributes": s.get("attributes", {})}
    entities = {}
    missing = []
    for eid in ENTITIES:
        if eid in by_id:
            entities[eid] = by_id[eid]
        else:
            entities[eid] = {"state": None, "attributes": {}, "error": "entita' assente"}
            missing.append(eid)
    if missing:
        LOG.warning("timeline: %d entita' assenti dal core: %s", len(missing), ", ".join(missing))
    return {"entities": entities, "dev": False}


# ── Fase 2: sezione "Stato" ───────────────────────────────────────────────────
# Tre endpoint SOLA LETTURA (nessuna scrittura, nessuna call_service): stati
# istantanei, history per i grafici, archivio foto. Nomi verificati sul
# registry di HA (core.entity_registry) il 2026-08-02.
#
# Whitelist read-only: la UI di Stato non legge NIENTE fuori da qui. Come per
# ENTITIES, aggiungere una riga qui = il dato arriva al frontend.
STATO_ENTITIES = [
    # I 5 sensori-presentazione dei sottosistemi (censimento r.36): stato
    # sintetico gia' pronto per le righe componenti della home.
    "sensor.serra_componente_luci",
    "sensor.serra_componente_acqua",
    "sensor.serra_componente_nutrienti",
    "sensor.serra_componente_ventole",
    "sensor.serra_componente_ring",
    # Clima TARATO (gli stessi che legge gia' la timeline: la taratura e'
    # applicata dentro il template, non c'e' una seconda coppia "grezza").
    "sensor.serra_clima_temperatura",
    "sensor.serra_clima_umidita",
    "sensor.serra_vpd",
    # Vasca: percentuale, litri e allarme acqua bassa.
    "sensor.serra_livello_acqua",
    "sensor.serra_acqua_litri",
    "binary_sensor.serra_acqua_bassa",
    # latch discordanza attesa/realta' (piano avvisi 03/08): alzati dalle
    # automazioni serra_alert_discordanza_* quando un componente in Automatico
    # non segue il programma da >10 min; l'app li mostra come banner
    "input_boolean.serra_discordanza_luci",
    "input_boolean.serra_discordanza_acqua",
    "input_boolean.serra_discordanza_ventole",
    # modalita' Pianificato/Libero nutrienti: la legge anche il segmented del
    # pannello (via api/stato), non solo il model (via api/timeline)
    "input_boolean.serra_schedule_nutrienti",
    # Diagnostica centralina (lacuna #4 del censimento).
    "sensor.serra_bridge_online",
    "sensor.serra_net_state",
    "sensor.serra_last_seen",
    "sensor.serra_freschezza_dati",
    "sensor.serra_uptime",
    "sensor.serra_pi_uptime",
    "sensor.serra_ultimo_avvio",
    # Stato pompa principale (Fase 3, pannello Acqua): lo STATO pubblicato
    # dal bridge, non i comandi (divergenza #3).
    "sensor.serra_pump_main_running_now",
    "sensor.serra_pump_main_state",
    "sensor.serra_pump_main_seconds",
    "sensor.serra_pump_main_until",
    "sensor.serra_pump_main_last_action",
    # ── Fase 3, pannelli Controllo (tutte SOLA LETTURA) ──
    # LUCI: stato reale dal bridge (divergenza #3) + helper di supporto.
    "sensor.serra_lights_state",
    "sensor.serra_lights_channel",
    "sensor.serra_lights_intensity",
    "sensor.serra_lights_fade",
    "sensor.serra_lights_last_action",
    "sensor.serra_lights_last_update",
    # Ultima azione SEMANTICA del pannello ("<evento> @<iso>"): classifica la
    # transizione reale (accensione/spegnimento/cambio mix canali), non il
    # verbo grezzo che il firmware ha ricevuto.
    "input_text.serra_luci_ultima_azione",
    "binary_sensor.serra_luci_dovrebbero_essere_on",
    "input_number.serra_luce_fade_min",
    # VENTOLE: livelli reali, sonda grezza + tarature, riferimento casa.
    # AUDIT R1 (K-5): via le 3 percentuali, il livello aggregato e l'ultimo
    # aggiornamento delle ventole — nessuna sezione li legge (i livelli
    # low/medium/high bastano). Via anche input_select.serra_fase_luci.
    "sensor.serra_fan_1_level",
    "sensor.serra_fan_2_level",
    "sensor.serra_fan_f_level",
    # AUDIT R5 (C-R5-1): via i due sensori grezzi della sonda serra
    # (_temperature/_humidity). La riga "misurato -> tarato" e' uscita dal
    # pannello Ventole: si mostra un solo numero, quello tarato.
    "input_number.serra_taratura_temp",
    "input_number.serra_taratura_umidita",
    "sensor.serra_clima_rif_temperatura",
    "sensor.serra_clima_rif_umidita",
    "input_select.serra_vent_livello_auto",
    "input_boolean.serra_filtro_odori",
    # NUTRIENTI: stato pompe, dose di fase (attributo `dose`), parametri.
    "sensor.serra_nutrient_0_stato",
    "sensor.serra_nutrient_1_stato",
    "sensor.serra_nutrient_2_stato",
    "sensor.serra_nutrient_0_running_now",
    "sensor.serra_nutrient_1_running_now",
    "sensor.serra_nutrient_2_running_now",
    "sensor.serra_nutrients_last_update",
    "sensor.serra_dose_nutrienti",
    "sensor.serra_prossimo_booster",
    "input_number.serra_nutrient_duration",
    "input_number.serra_nutrient_times",
    "input_number.serra_nutrient_interval",
    "input_number.serra_cal_pompa_0_ml_s",
    "input_number.serra_cal_pompa_1_ml_s",
    "input_number.serra_cal_pompa_2_ml_s",
    "input_boolean.serra_dosatori_auto",
    # RING: stato, colore, priorita' della legenda.
    "sensor.serra_ring_state",
    "sensor.serra_ring_color",
    "sensor.serra_ring_last_action",
    "sensor.serra_ring_last_update",
    "input_number.serra_ring_fade",
    "input_number.serra_ring_blink_times",
    "input_number.serra_ring_blink_duration",
    "input_number.serra_ring_blink_interval",
    "input_select.serra_ring_color",
    "input_boolean.serra_ring_auto",
    "input_boolean.serra_errore_pendente",
    "input_boolean.serra_booster_da_dare",
    # AUDIT R1 (K-5): i tre input_boolean.serra_schedule_* NON stanno piu' qui.
    # La modalita' dei badge arriva da model.modo (api/timeline, dove i tre
    # boolean ci sono gia'); da api/stato non li leggeva nessuno. Restano
    # target di scrittura, e per quello basta la whitelist dei servizi.
    # Ultimi eventi. Divergenza #6 DECISA: si usa il SENSOR, non
    # input_datetime.serra_acqua_ultimo.
    "sensor.serra_acqua_ultimo_ricircolo",
    "input_datetime.serra_acqua_ultimo_cambio",
    # durata dell'ultimo ricircolo (03/08): scritta da HA a ogni marcatura
    # di serra_acqua_ultimo, in tutti i percorsi (schedule/recupero/manuale)
    "input_number.serra_acqua_ultimo_ricircolo_s",
    # Foto: indice dell'archivio (attributo `files`). La caption non serve:
    # data/ora e posizione si ricavano dal nome file (vedi Stato.jsx).
    "sensor.serra_foto_archivio",
    # Banner: errore pendente e coltivazione spenta.
    "input_text.serra_errore_componente",
    "input_boolean.serra_coltivazione_attiva",
    # ── Fase 4, sezione Impostazioni (sola lettura) ──
    "input_select.serra_ciclo_luce",
    "input_boolean.serra_foto_giornaliera",
    "input_datetime.serra_foto_ora",
    "input_boolean.serra_notifiche_push",
    "input_datetime.serra_digest_mattina",
    "input_datetime.serra_digest_sera",
    "input_datetime.serra_promemoria_ora",
    "input_boolean.serra_notifica_acqua",
    "input_boolean.serra_digest_mattina_attivo",
    "input_boolean.serra_digest_sera_attivo",
    "input_boolean.serra_notifica_foto",
    "input_number.serra_acqua_soglia_pct",
    "input_boolean.serra_wifi",
    # Sorgenti climatiche scelte nelle Impostazioni: helper HA, non sensori
    # appartenenti fisicamente alla serra o all'add-on.
    "input_text.serra_sorgente_temp_interna",
    "input_text.serra_sorgente_umid_interna",
    "input_text.serra_sorgente_temp_stanza",
    "input_text.serra_sorgente_umid_stanza",
    # coerenza: la sezione li ha anche da model, ma cosi' vive di api/stato
    "input_datetime.serra_data_semina",
    "input_select.serra_varieta",
    "input_datetime.serra_luci_on",
    "input_datetime.serra_luci_off",
]

# Gli attributi arrivano al frontend SOLO se sono in questa lista: /states
# restituisce anche blob enormi (es. `raw` del magnetometro, mappe del piano)
# che non servono a nessuno e gonfiano ogni polling.
STATO_ATTR_KEYS = (
    "friendly_name", "unit_of_measurement", "device_class", "state_class",
    "icon", "files", "count", "level_pct", "calibrated", "enabled", "ntp",
    "ts_local", "has_date", "has_time", "timestamp",
    # Fase 3: gli unici due attributi-struttura senza cui una riga non ha
    # ripiego (mix per canale e dose di fase non esistono come sensori piatti)
    "channels", "dose",
)
# Tetto per entita': se il subset sfora si tengono solo le chiavi essenziali
# (l'unico attributo che puo' crescere e' `files` dell'archivio foto).
MAX_ATTR_BYTES = 2048
STATO_ATTR_ESSENTIAL = ("friendly_name", "unit_of_measurement")

# Grafici: SOLO i 4 sensori del design (temp tarata, umidita' tarata, VPD,
# livello vasca %) e SOLO le finestre previste dal selettore.
HISTORY_ENTITIES = (
    "sensor.serra_clima_temperatura",
    "sensor.serra_clima_umidita",
    "sensor.serra_vpd",
    "sensor.serra_livello_acqua",
)
# Lista CHIUSA: `hours` arriva da fuori e non diventa mai un valore libero.
# Fino a 168 h (7 giorni) si legge la history GREZZA del recorder.
HISTORY_HOURS = (6, 12, 24, 48, 168)
# Oltre, la history non c'e' piu': il recorder tiene i campioni ~10 giorni. Le
# STATISTICHE di lungo periodo (medie orarie) restano invece per sempre, ma non
# sono esposte dalla REST API — si leggono dal database del recorder (vedi
# stats_payload). Anche questa e' una lista chiusa: 720 h = 30 giorni, e il
# token "coltura" (finestra dalla data di semina a ora).
STATS_HOURS = (720,)
STATS_TOKEN = "coltura"
# Sopra questa finestra le medie orarie sono troppe anche solo da leggere
# (45 g = 1080 righe per serie): si accorpano in medie giornaliere.
STATS_DAILY_OVER_H = 45 * 24
# Tetto sulla finestra "coltura": una data di semina sbagliata (anno 1970) non
# deve trasformarsi in una scansione di tutto il database.
STATS_MAX_H = 400 * 24
STATS_DB_TIMEOUT = 3.0
# 48h di recorder possono essere migliaia di campioni (a 7 giorni, decine di
# migliaia): il grafico e' largo 640px, oltre ~300 punti si disegna rumore
# invisibile. Il tetto vale per OGNI finestra, quindi anche a 168h il payload
# per serie resta di ~300 punti — ben sotto la soglia di guardia dei 400.
HISTORY_MAX_POINTS = 300

# Archivio foto: nel container homeassistant_config e' montato su
# /homeassistant, quindi /config/www/serra/archivio di HA = questo path.
# In dev si usa una cartella locale con qualche jpg finto.
FOTO_DIR = os.environ.get("FOTO_DIR") or (
    "/homeassistant/www/serra/archivio" if SUPERVISOR_TOKEN
    else os.path.join(HERE, "foto_dev"))
# Formato prodotto da serra_foto_diario: 2026-07-13_1620.jpg. Tutto il resto
# (thumbnail, latest.jpg, file di servizio) viene ignorato — ed e' anche
# l'UNICA validazione ammessa prima di comporre un path. Si usa fullmatch e
# non match: con "^...$" un "\n" finale passerebbe (in '$' ci sta dentro).
FOTO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{4}\.jpg$")


def _attr_subset(attrs):
    """Attributi in allow-list e sotto il tetto di taglia."""
    out = {k: attrs[k] for k in STATO_ATTR_KEYS if k in attrs}
    if len(json.dumps(out, ensure_ascii=False).encode("utf-8")) > MAX_ATTR_BYTES:
        out = {k: out[k] for k in STATO_ATTR_ESSENTIAL if k in out}
    return out


def stato_payload():
    """Come timeline_payload: UNA sola GET /states filtrata localmente.
    Piu' robusta di N GET /states/<id> (un'entita' assente non e' un 404 che
    interrompe il giro, e il costo non cresce con la whitelist)."""
    if not SUPERVISOR_TOKEN:
        return _stato_fixture()
    wanted = set(STATO_ENTITIES)
    by_id = {}
    for s in ha_get("/states", timeout=15):
        eid = s.get("entity_id")
        if eid in wanted:
            by_id[eid] = {
                "state": s.get("state"),
                "attributes": _attr_subset(s.get("attributes", {}) or {}),
                "last_changed": s.get("last_changed"),
            }
    entities = {}
    missing = []
    for eid in STATO_ENTITIES:
        if eid in by_id:
            entities[eid] = by_id[eid]
        else:
            entities[eid] = {"state": None, "attributes": {}, "last_changed": None,
                             "error": "entita' assente"}
            missing.append(eid)
    if missing:
        LOG.warning("stato: %d entita' assenti dal core: %s", len(missing), ", ".join(missing))
    return {"entities": entities, "fetched": _now_iso()}


CLIMATE_SOURCE_HELPERS = {
    "input_text.serra_sorgente_temp_interna": "temperature",
    "input_text.serra_sorgente_umid_interna": "humidity",
    "input_text.serra_sorgente_temp_stanza": "temperature",
    "input_text.serra_sorgente_umid_stanza": "humidity",
}


def climate_sensor_choices(states):
    """Espone solo i sensori HA del tipo adatto, senza gli altri stati di casa."""
    choices = {"temperature": [], "humidity": []}
    for item in states:
        eid = item.get("entity_id", "")
        attrs = item.get("attributes") or {}
        kind = attrs.get("device_class")
        if (not isinstance(eid, str) or not re.fullmatch(r"sensor\.[a-z0-9_]+", eid)
                or kind not in choices):
            continue
        choices[kind].append({
            "entity_id": eid,
            "name": attrs.get("friendly_name") or eid,
            "state": item.get("state"),
            "unit": attrs.get("unit_of_measurement") or "",
        })
    for kind in choices:
        choices[kind].sort(key=lambda row: (row["name"].casefold(), row["entity_id"]))
    return choices


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec="seconds")


def _stato_fixture():
    """Dev (nessun SUPERVISOR_TOKEN): stessa forma del payload reale con valori
    plausibili. Sta QUI e non in fixture.json apposta — fixture.json e' la
    cattura reale dei sensori della timeline, non si tocca."""
    now = _now_iso()
    # I 5 sensori-componente si LEGANO alla coltivazione (cleanup noto n.4):
    # a coltura chiusa la serra e' ferma, e una fixture che continua a
    # raccontare ricircoli e booster nasconde proprio i rami piu' delicati
    # della UI (BoxDeve spenta, tag FERMA, riga "spento" del semaforo).
    # I testi sono quelli VERI dei template HA (verificati su
    # core.config_entries / core.restore_state il 03/08).
    # DEV_COLTIVAZIONE=off prova il caso a coltura chiusa senza un HA vero.
    attiva = os.environ.get("DEV_COLTIVAZIONE", "on").strip().lower() != "off"
    vals = {
        "sensor.serra_componente_luci": ("Accese · Vegetativa" if attiva else "Spente", {}),
        "sensor.serra_componente_acqua": (
            "Oggi 3 ricircoli (08:00 · 13:00 · 19:00)" if attiva else "Nessun ricircolo", {}),
        "sensor.serra_componente_nutrienti": (
            "Booster 1 · g37 (tra 3 gg)" if attiva else "Nessuno (fase flush/raccolto)", {}),
        "sensor.serra_componente_ventole": (
            "2/3 · V1 medium · V2 low" if attiva else "Tutte spente", {}),
        "sensor.serra_componente_ring": ("Bianco" if attiva else "Spento", {}),
        "sensor.serra_clima_temperatura": ("24.3", {"unit_of_measurement": "°C"}),
        "sensor.serra_clima_umidita": ("61.5", {"unit_of_measurement": "%"}),
        "sensor.serra_vpd": ("1.16", {"unit_of_measurement": "kPa"}),
        "sensor.serra_livello_acqua": ("72.0", {"unit_of_measurement": "%", "calibrated": True}),
        "sensor.serra_acqua_litri": ("3.2", {"unit_of_measurement": "L"}),
        "binary_sensor.serra_acqua_bassa": ("off", {"device_class": "problem"}),
        # soglia dell'allarme: da lei nascono la banda vasca di Stato e il
        # pallino del livello in Controllo (AUDIT R2 · R2-2). 15 = default HA
        "input_number.serra_acqua_soglia_pct": ("15.0", {"unit_of_measurement": "%"}),
        "sensor.serra_bridge_online": ("online", {}),
        # ts_local = istante dell'ultima finestra wifi (il firmware pubblica
        # enabled/ntp/ts, mai l'RSSI). In dev si campiona 20 min fa, cosi' la
        # riga "Wifi serra" mostra davvero il ramo "A intervalli · ultimo alle".
        "sensor.serra_net_state": ("off", {
            "enabled": False, "ntp": False,
            "ts_local": (datetime.datetime.now(datetime.timezone.utc).astimezone()
                         - datetime.timedelta(minutes=20)).isoformat(timespec="seconds")}),
        "sensor.serra_last_seen": (now, {"device_class": "timestamp"}),
        "sensor.serra_freschezza_dati": ("2 min fa · online", {}),
        "sensor.serra_uptime": ("11g 23h 14min", {}),
        "sensor.serra_pi_uptime": ("11g 23h 15min", {}),
        "sensor.serra_ultimo_avvio": ("21/07 alle 05:40", {}),
        # AUDIT R2 (M-R2-10): il sensore vero e' un device_class timestamp (ISO),
        # non una frase gia' composta: con la stringa di prima toDate() rifiutava
        # il valore e in dev la riga restava sempre '—'. Si campiona 6 h fa, cosi'
        # cade nella giornata corrente e il ramo "oggi alle …" si prova davvero.
        "sensor.serra_acqua_ultimo_ricircolo": (
            (datetime.datetime.now(datetime.timezone.utc).astimezone()
             - datetime.timedelta(hours=6)).isoformat(timespec="seconds"),
            {"device_class": "timestamp"}),
        "input_datetime.serra_acqua_ultimo_cambio": ("2026-07-25 10:30:00",
                                                     {"has_date": True, "has_time": True}),
        # "<evento> @<iso>" — la testata del pannello Luci legge prima questo.
        # A coltura chiusa l'ultimo fatto e' lo spegnimento, e si campiona 26 h
        # fa cosi' in dev si prova anche il ramo "ieri" di whenBreve.
        "input_text.serra_luci_ultima_azione": (
            ("cambio mix canali @" if attiva else "spegnimento @")
            + (datetime.datetime.now(datetime.timezone.utc).astimezone()
               - datetime.timedelta(minutes=45 if attiva else 26 * 60)).isoformat(timespec="seconds"),
            {"max": 255}),
        "sensor.serra_foto_archivio": ("3", {"files": foto_list()}),
        "input_text.serra_errore_componente": ("", {}),
        "input_boolean.serra_coltivazione_attiva": ("on" if attiva else "off", {}),
    }
    entities = {}
    for eid in STATO_ENTITIES:
        state, attrs = vals.get(eid, (None, {}))
        attrs = dict(attrs)
        attrs.setdefault("friendly_name", eid.split(".", 1)[1].replace("_", " ").title())
        entities[eid] = {"state": state, "attributes": _attr_subset(attrs),
                         "last_changed": now}
    return {"entities": entities, "fetched": now, "dev": True}


def _to_epoch(ts):
    """ISO di HA -> epoch secondi. None se illeggibile."""
    if not ts:
        return None
    try:
        d = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:  # naive = UTC per convenzione del recorder
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.timestamp()


def _downsample(points, maxn):
    """Bucket a taglia fissa + media: mantiene la forma della curva senza
    spedire migliaia di punti che il grafico non puo' disegnare.
    PRIMO e ULTIMO campione passano INTATTI, non mediati: sono i due estremi
    che la UI legge come inizio e fine della finestra (dominio X e valore
    corrente), e a 7 giorni un bucket di bordo largo mezz'ora li sposterebbe."""
    n = len(points)
    if n <= maxn:
        return points
    out = []
    for i in range(maxn):
        chunk = points[i * n // maxn:(i + 1) * n // maxn]
        if not chunk:
            continue
        out.append([round(sum(p[0] for p in chunk) / len(chunk)),
                    round(sum(p[1] for p in chunk) / len(chunk), 3)])
    if out:
        out[0] = list(points[0])
        out[-1] = list(points[-1])
    return out


def _serie_payload(entity, hours, points, extra=None, mn=None, mx=None):
    """Risposta di api/history. `min`/`max` si calcolano sui punti GREZZI,
    prima del downsample: la media a bucket lima i picchi, e un minimo/massimo
    ricavato dai punti spediti direbbe un numero che nella finestra non e' mai
    stato letto. Sulle statistiche i due estremi arrivano gia' pronti da chi
    chiama (min dei min / max dei max dei bucket), che e' l'unico modo di
    restare esatti quando i punti disegnati sono medie."""
    vals = [p[1] for p in points]
    out = {"entity": entity, "hours": hours,
           "min": mn if mn is not None else (min(vals) if vals else None),
           "max": mx if mx is not None else (max(vals) if vals else None),
           "points": _downsample(points, HISTORY_MAX_POINTS)}
    if extra:
        out.update(extra)
    return out


def history_payload(entity, hours):
    """Proxy dell'API history di HA, ridotta a una serie [[epoch, valore], ...].
    Gli stati non numerici (unknown/unavailable, stringhe) si scartano: il
    grafico salta il buco invece di disegnare uno zero che non c'e' mai stato."""
    if not SUPERVISOR_TOKEN:
        return _history_fixture(entity, hours)
    start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    # `:` e `+` restano LETTERALI nel path (safe=): e' la forma documentata da
    # HA (.../period/2026-08-01T08:00:00+00:00) e vale sia per aiohttp che per
    # un eventuale proxy in mezzo; percent-encodarli e' terreno di sorprese.
    # end_time OBBLIGATORIO: senza, l'API history copre 1 GIORNO dallo start
    # (bug visto live: hours=48 tornava solo la prima meta' della finestra).
    end = datetime.datetime.now(datetime.timezone.utc)
    path = "/history/period/%s?%s" % (
        urllib.parse.quote(start.isoformat(timespec="seconds"), safe=":+"),
        urllib.parse.urlencode({"filter_entity_id": entity,
                                "end_time": end.isoformat(timespec="seconds")}) +
        "&minimal_response&no_attributes",
    )
    raw = ha_get(path, timeout=15)
    points = []
    for series in raw or []:
        for s in series or []:
            # minimal_response: dal 2° elemento in poi c'e' solo state +
            # last_changed/last_updated, mai entity_id.
            try:
                val = float(s.get("state"))
            except (TypeError, ValueError):
                continue
            if math.isnan(val) or math.isinf(val):
                continue
            ts = _to_epoch(s.get("last_changed") or s.get("last_updated"))
            if ts is None:
                continue
            points.append([round(ts), round(val, 3)])
    points.sort(key=lambda p: p[0])
    # `start`/`res` viaggiano su OGNI risposta, non solo sulle statistiche: il
    # frontend disegna l'asse X sulla finestra dichiarata dal server e non deve
    # sapere da quale sorgente arrivano i punti.
    return _serie_payload(entity, hours, points,
                          {"start": int(start.timestamp()), "res": "raw"})


# (centro, ampiezza, rumore) delle serie finte: le condividono la fixture della
# history e quella delle statistiche, cosi' cambiando chip la curva resta la stessa.
_FIXTURE_BASE = {
    "sensor.serra_clima_temperatura": (24.0, 2.5, 0.4),
    "sensor.serra_clima_umidita": (61.0, 6.0, 1.2),
    "sensor.serra_vpd": (1.15, 0.25, 0.04),
    "sensor.serra_livello_acqua": (86.0, 14.0, 0.6),
}


def _history_fixture(entity, hours):
    """Dev: serie sintetica DETERMINISTICA (seed da entita'+finestra), cosi'
    ricaricando la pagina il grafico non salta."""
    centro, ampiezza, rumore = _FIXTURE_BASE[entity]
    rnd = random.Random("%s|%d" % (entity, hours))
    # oltre HISTORY_MAX_POINTS, cosi' in dev il downsample lavora davvero
    n = 360
    now = time.time()
    step = hours * 3600.0 / n
    points = []
    for i in range(n):
        # un ciclo giorno/notte completo ogni 24h simulate
        fase = 2 * math.pi * ((now - (n - 1 - i) * step) % 86400) / 86400.0
        val = centro + ampiezza * math.sin(fase) + rnd.uniform(-rumore, rumore)
        points.append([round(now - (n - 1 - i) * step), round(val, 3)])
    return _serie_payload(entity, hours, points,
                          {"start": round(now - hours * 3600), "res": "raw", "dev": True})


# ── Statistiche di lungo periodo ──────────────────────────────────────────────
# Perche' non la REST API: /history/period legge la tabella `states`, che il
# recorder pota (~10 giorni). Le medie orarie vivono in `statistics` e non hanno
# endpoint HTTP. Si aprono quindi in SOLA LETTURA sul file del recorder: HA
# scrive in WAL, quindi un lettore in piu' non blocca ne' viene bloccato.
# Nessun entity_id entra mai nella query come stringa: sempre bindato, e
# comunque solo dopo il filtro su HISTORY_ENTITIES.
STATS_SQL = (
    "SELECT s.start_ts, s.mean, s.min, s.max "
    "FROM statistics s JOIN statistics_meta m ON m.id = s.metadata_id "
    "WHERE m.statistic_id = ? AND s.start_ts >= ? AND s.mean IS NOT NULL "
    "ORDER BY s.start_ts"
)


def _stats_db():
    """Database del recorder. Nel container dell'addon /config di HA e' montato
    su /homeassistant (stesso doppio path di piano_path)."""
    return _first_existing(["/homeassistant/home-assistant_v2.db",
                            "/config/home-assistant_v2.db"])


def _semina_ts():
    """Epoch dell'inizio coltura. None se la data non e' leggibile: chi chiama
    ripiega su 30 giorni invece di inventarsi una finestra."""
    try:
        if SUPERVISOR_TOKEN:
            raw = (ha_get("/states/input_datetime.serra_data_semina", timeout=8)
                   or {}).get("state")
        else:  # dev: la stessa entita' sta nella fixture della timeline
            raw = ((timeline_payload().get("entities") or {})
                   .get("input_datetime.serra_data_semina") or {}).get("state")
    except Exception as exc:
        LOG.warning("statistiche: data di semina non leggibile: %s", exc)
        return None
    raw = str(raw or "").strip()
    if not raw or raw.lower() in ("unknown", "unavailable", "none"):
        return None
    try:
        d = datetime.datetime.fromisoformat(raw.replace(" ", "T"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.astimezone()   # l'helper di HA e' in ora locale, non UTC
    return d.timestamp()


def _stats_window(hours):
    """(t0, ore_effettive). `hours` None = token "coltura"."""
    now = time.time()
    if hours is not None:
        return now - hours * 3600, hours
    t0 = _semina_ts()
    if t0 is None or now - t0 <= 0:
        return now - 720 * 3600, 720          # ripiego dichiarato: 30 giorni
    ore = min(STATS_MAX_H, max(1, int((now - t0) / 3600)))
    return now - ore * 3600, ore


def _stats_rows(entity, t0):
    """[(start_ts, mean, min, max)] dal DB del recorder, sola lettura."""
    path = _stats_db()
    if not path:
        raise RuntimeError("database del recorder non trovato")
    uri = "file:%s?mode=ro" % urllib.parse.quote(path)
    con = sqlite3.connect(uri, uri=True, timeout=STATS_DB_TIMEOUT)
    try:
        return con.execute(STATS_SQL, (entity, float(t0))).fetchall()
    finally:
        con.close()


def stats_payload(entity, hours):
    """Serie di lungo periodo. `hours` None = finestra "coltura".
    I punti sono le MEDIE (orarie, o giornaliere oltre STATS_DAILY_OVER_H);
    min/max del payload restano gli estremi VERI del periodo, cioe' il minimo
    dei minimi e il massimo dei massimi dei bucket."""
    if entity not in HISTORY_ENTITIES:      # ridondante col filtro di rotta, voluto
        raise ValueError("entita' fuori whitelist")
    t0, ore = _stats_window(hours)
    daily = ore > STATS_DAILY_OVER_H
    if not SUPERVISOR_TOKEN:
        return _stats_fixture(entity, ore, t0, daily)
    rows = _stats_rows(entity, t0)
    if not rows:
        return _serie_payload(entity, ore, [],
                              {"start": int(t0), "res": "daily" if daily else "hourly"})
    mn = min(r[2] for r in rows if r[2] is not None) if any(r[2] is not None for r in rows) else None
    mx = max(r[3] for r in rows if r[3] is not None) if any(r[3] is not None for r in rows) else None
    if daily:
        # accorpamento per GIORNO LOCALE: il punto porta la mezzanotte locale,
        # cosi' le tacche dell'asse X cadono sui giorni veri e non su un
        # multiplo di 24 h che scivola a ogni cambio d'ora legale.
        per_day = {}
        for ts, mean, _mn, _mx in rows:
            giorno = datetime.datetime.fromtimestamp(ts).replace(
                hour=0, minute=0, second=0, microsecond=0)
            per_day.setdefault(giorno.timestamp(), []).append(mean)
        points = [[round(k), round(sum(v) / len(v), 3)] for k, v in sorted(per_day.items())]
    else:
        points = [[round(ts), round(mean, 3)] for ts, mean, _mn, _mx in rows]
    return _serie_payload(entity, ore, points,
                          {"start": int(t0), "res": "daily" if daily else "hourly"},
                          mn=round(mn, 3) if mn is not None else None,
                          mx=round(mx, 3) if mx is not None else None)


def _stats_fixture(entity, ore, t0, daily):
    """Dev: il database del recorder non c'e'. Stessa forma d'onda della
    fixture della history, campionata al passo delle statistiche."""
    centro, ampiezza, rumore = _FIXTURE_BASE[entity]
    rnd = random.Random("%s|stat|%d" % (entity, ore))
    passo = 86400 if daily else 3600
    n = max(2, int(ore * 3600 / passo))
    mese = 30 * 86400.0
    points, mn, mx = [], None, None
    for i in range(n):
        t = t0 + i * passo
        # deriva lenta sul mese + ciclo giorno/notte. Sulle giornaliere il ciclo
        # sparisce: mediando 24 ore si annulla davvero, come nel dato vero.
        # l'ampiezza totale resta quella della history (0.4 + 0.6), altrimenti in
        # dev la vasca finiva sopra il 100 %
        val = centro + ampiezza * 0.4 * math.sin(2 * math.pi * (t % mese) / mese)
        if not daily:
            val += ampiezza * 0.6 * math.sin(2 * math.pi * (t % 86400) / 86400.0)
        val += rnd.uniform(-rumore, rumore)
        points.append([round(t), round(val, 3)])
        # gli estremi del bucket stanno FUORI dalla media, come nel dato vero —
        # ma di poco: allargarli troppo darebbe in dev vasche al 113 %
        lo, hi = val - rumore * 2, val + rumore * 2
        mn = lo if mn is None else min(mn, lo)
        mx = hi if mx is None else max(mx, hi)
    return _serie_payload(entity, ore, points,
                          {"start": int(t0), "res": "daily" if daily else "hourly", "dev": True},
                          mn=round(mn, 3), mx=round(mx, 3))


def serie_payload(entity, win):
    """Unico ingresso di api/history. `win` = ore (int) o STATS_TOKEN; la
    sorgente la sceglie la finestra, il chiamante non deve saperlo."""
    if win == STATS_TOKEN:
        return stats_payload(entity, None)
    if win in STATS_HOURS:
        return stats_payload(entity, win)
    return history_payload(entity, win)


def foto_list():
    """Nomi dei jpg dell'archivio, dal piu' recente. Archivio assente (primo
    avvio, share smontato) = lista vuota, non un errore: la sezione Foto si
    mostra vuota invece di far fallire tutta la schermata."""
    try:
        names = os.listdir(FOTO_DIR)
    except OSError:
        return []
    return sorted((n for n in names if FOTO_RE.fullmatch(n)), reverse=True)


# ── Fase 5: diario strutturato (v2) ───────────────────────────────────────────
# DUE file, scritti entrambi da script.serra_diario_scrivi (dual write):
#   serra_diario.jsonl  una riga JSON per evento, APPEND (piu' vecchio in cima)
#                       {"ts","g","comp","testo","tipo","origine"}
#   serra_diario.log    la riga leggibile di sempre, PREPEND (piu' recente in
#                       cima). Sopravvive perche' e' quella che si legge a mano.
# L'app vuole il JSONL; il .log serve solo per lo STORICO, cioe' per la parte
# di diario scritta PRIMA che il dual write esistesse. Da quel momento in poi i
# due file raccontano le stesse cose: restituire il .log intero significherebbe
# mostrare ogni evento due volte.
#
# TAGLIO ANTI-DOPPIONE: si tiene del .log solo cio' che e' piu' vecchio del
# PRIMO evento del JSONL. Il .log ha risoluzione al minuto e il JSONL al
# secondo: il confronto si fa al minuto e si scarta anche il minuto di
# frontiera. Perdere una riga legacy nel minuto esatto in cui e' partito il
# dual write e' un prezzo minore che mostrarne una doppia.
#
# Endpoint SOLA LETTURA: nessun lock, nessuna scrittura, errori neutri.
DIARIO_DIR = "/homeassistant" if SUPERVISOR_TOKEN else HERE
DIARIO_JSONL = os.path.join(DIARIO_DIR, "serra_diario.jsonl")
DIARIO_LOG = os.path.join(DIARIO_DIR, "serra_diario.log")
# In dev i due file veri non esistono: si usano i gemelli _dev, se presenti.
DIARIO_JSONL_DEV = os.path.join(HERE, "serra_diario_dev.jsonl")
DIARIO_LOG_DEV = os.path.join(HERE, "serra_diario_dev.log")

DIARIO_LIMIT_DEF = 500
DIARIO_LIMIT_MAX = 1000
# Tetti difensivi: il diario e' append-only e cresce per sempre. Non si legge
# mai tutto il file — solo la CODA (le righe piu' recenti del JSONL) e solo un
# numero finito di righe legacy.
DIARIO_TAIL_BYTES = 4 * 1024 * 1024     # ~4 MB = decine di migliaia di eventi
DIARIO_LEGACY_MAX = 2000
DIARIO_CAMPI = ("ts", "g", "comp", "testo", "tipo", "origine")
# "2026-08-02 21:18 · g23 · Luci · ..." → si legge solo il timestamp: il resto
# della riga lo parsa il frontend, che ha gia' il parser tollerante.
DIARIO_LOG_TS = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})")


def _diario_files():
    """(jsonl, log) da leggere: i file veri in add-on, i _dev in sviluppo."""
    if SUPERVISOR_TOKEN:
        return DIARIO_JSONL, DIARIO_LOG
    j = DIARIO_JSONL_DEV if os.path.exists(DIARIO_JSONL_DEV) else DIARIO_JSONL
    l = DIARIO_LOG_DEV if os.path.exists(DIARIO_LOG_DEV) else DIARIO_LOG
    return j, l


def _tail_lines(path, max_bytes):
    """Ultime righe del file, senza caricarlo tutto. Serve al JSONL, che e'
    in APPEND: le righe recenti stanno in fondo. La prima riga letta puo'
    essere troncata a meta' (si parte da un offset arbitrario): si scarta."""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            if size > max_bytes:
                f.seek(size - max_bytes)
                f.readline()          # scarta la riga tagliata a meta'
            raw = f.read()
    except OSError:
        return []
    return raw.decode("utf-8", "replace").splitlines()


def _head_lines(path, max_bytes):
    """Prime righe del file. Serve al .log, che e' in PREPEND: li' le righe
    recenti stanno in CIMA, e la coda legacy che ci interessa (quella appena
    piu' vecchia del primo evento strutturato) e' subito sotto — non in fondo
    al file, dove finirebbe un tail."""
    try:
        with open(path, "rb") as f:
            raw = f.read(max_bytes)
    except OSError:
        return []
    righe = raw.decode("utf-8", "replace").splitlines()
    # l'ultima riga letta puo' essere tronca se il file supera il tetto
    return righe[:-1] if len(raw) == max_bytes and righe else righe


def _ts_epoch(ts):
    """Timestamp del diario -> ISTANTE ASSOLUTO (epoch), per ordinare e
    paginare. AUDIT R1 (M-15): i `ts` del JSONL sono ISO LOCALI CON OFFSET, e
    confrontarli come stringhe sbaglia nell'ora ripetuta del cambio d'ora
    autunnale ('…T02:30+02:00' ordina prima di '…T02:15+01:00' pur essendo
    successivo): una volta l'anno il taglio di pagina `before` poteva saltare
    o ripetere righe. Illeggibile = -inf, cosi' finisce in fondo (piu'
    vecchio) invece di scombinare l'ordine. Il formato ESTERNO non cambia:
    quello che entra ed esce resta l'ISO scritto da HA."""
    e = _to_epoch(ts)
    return float("-inf") if e is None else e


def _diario_eventi(path):
    """Righe JSONL → eventi normalizzati, dal piu' RECENTE. Una riga illeggibile
    non ferma le altre: il diario e' un registro, non una transazione."""
    out = []
    for line in _tail_lines(path, DIARIO_TAIL_BYTES):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict) or not d.get("ts"):
            continue
        # AUDIT R2 (R2-1): un `ts` che non produce un epoch non e' ne' ordinabile
        # ne' paginabile — finirebbe in fondo all'ordine discendente (-inf) e
        # diventerebbe il `piu_vecchio` da cui si taglia il legacy, con un
        # confronto senza senso che lascia passare tutto. Si scarta qui, cosi'
        # a valle `piu_vecchio` e' leggibile per costruzione.
        if _to_epoch(d.get("ts")) is None:
            continue
        # solo i campi previsti: quello che arriva in piu' non passa
        out.append({k: d.get(k) for k in DIARIO_CAMPI})
    out.sort(key=lambda e: _ts_epoch(e.get("ts")), reverse=True)
    return out


def _log_ts_minuto(line):
    """'YYYY-MM-DD HH:MM' iniziale della riga, come stringa confrontabile."""
    m = DIARIO_LOG_TS.match(line)
    return "%s-%s-%sT%s:%s" % m.groups() if m else None


def diario_payload(limit=DIARIO_LIMIT_DEF, before=None):
    """{"eventi":[...], "legacy":[...], "altri":bool}.

    `eventi` = pagina di eventi strutturati, dal piu' recente, piu' vecchi di
    `before` (ISO) se passato. `altri` dice se sotto la pagina ce n'e' ancora.
    `legacy` = coda grezza del vecchio diario, servita SOLO quando il JSONL e'
    finito (altri=False): e' li' che la storia continua, e prima sarebbe fuori
    posto."""
    jsonl, log = _diario_files()
    eventi = _diario_eventi(jsonl)
    piu_vecchio = eventi[-1]["ts"] if eventi else None

    if before:
        # AUDIT R1 (M-15): confronto per ISTANTE, non fra stringhe ISO con
        # offset. Se il `before` del client non e' un ISO leggibile si ricade
        # sul vecchio confronto testuale invece di servire tutto da capo.
        soglia = _to_epoch(before)
        if soglia is None:
            eventi = [e for e in eventi if str(e.get("ts") or "") < before]
        else:
            eventi = [e for e in eventi if _ts_epoch(e.get("ts")) < soglia]
    altri = len(eventi) > limit
    pagina = eventi[:limit]

    legacy = []
    if not altri:
        # Il taglio legacy resta un confronto FRA STRINGHE, ed e' corretto:
        # entrambi i lati sono l'ora LOCALE NAIVE al minuto ('YYYY-MM-DDTHH:MM')
        # renderizzata dallo stesso now() del dual write — nessun offset di
        # mezzo, quindi niente di cui M-15 si occupi.
        taglio = str(piu_vecchio)[:16] if piu_vecchio else None
        for line in _head_lines(log, DIARIO_TAIL_BYTES):
            line = line.rstrip()
            if not line:
                continue
            if taglio is not None:
                ts = _log_ts_minuto(line)
                # righe senza timestamp riconoscibile: si tengono solo se non
                # c'e' un JSONL con cui potrebbero accavallarsi
                if ts is None or ts >= taglio:
                    continue
            legacy.append(line)
            if len(legacy) >= DIARIO_LEGACY_MAX:
                break

    return {"eventi": pagina, "legacy": legacy, "altri": altri}


# ── Note per-giorno (v3.1) ────────────────────────────────────────────────────
# Store separato dal diario (che è append-only): le note sono MUTABILI
# (edita/cancella). File JSON { "YYYY-MM-DD": ["nota1", "nota2"], ... } in
# /homeassistant (config HA). Chiave = data assoluta (una nota è "di quel
# giorno" reale, non del giorno-di-ciclo che può slittare).
def note_path():
    if not SUPERVISOR_TOKEN:
        return os.path.join(HERE, "note_dev.json")
    return "/homeassistant/serra_note.json"


def load_note():
    # AUDIT R2 (BE2-02): fail-CLOSED — "file assente" (primo uso) torna {},
    # ma "file presente e illeggibile" (JSON corrotto, share giu') SOLLEVA:
    # prima tornava {} e la POST successiva riscriveva lo store con il solo
    # giorno editato, cancellando in silenzio tutte le altre note.
    p = note_path()
    if not os.path.exists(p):
        return {}
    with open(p, encoding="utf-8") as f:
        d = json.load(f)   # OSError/ValueError propagano -> 500, nessuna scrittura
    if not isinstance(d, dict):
        raise ValueError("store note corrotto (non e' un dizionario)")
    return d


def save_note(data):
    p = note_path()
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)


# Servizi che la UI puo' chiamare (v2 milestone + v2b segna-fatto).
# Whitelist stretta: solo i domini/servizi previsti e solo su entita' serra_*.
# AUDIT R1 (BE-13): rimossi ALLOWED_DIRECT_SCRIPTS (il frontend usa SOLO
# script.turn_on fire-and-forget dal 0.6.1) e homeassistant.update_entity
# (mai chiamato dal client: il backend lo invoca in proprio dopo il save).
ALLOWED_SERVICES = {
    ("input_datetime", "set_datetime"),
    ("input_boolean", "turn_on"),
    ("input_boolean", "turn_off"),
    ("script", "turn_on"),   # fire-and-forget (cambio acqua: ha delay interni)
    # Fase 3 (pannelli Controllo): coppie nuove — le entita' ammesse sono
    # elencate UNA A UNA in ALLOWED_ENTITY_PREFIXES qui sotto.
    ("input_number", "set_value"),
    ("input_select", "select_option"),
    ("input_text", "set_value"),
}
# AUDIT R3 (BE3-05): coerenza dominio-servizio ↔ dominio-entita' — prima
# script.turn_on su sensor.serra_x passava il check (innocuo lato HA, ma
# superficie inutile); sensor.serra_ rimosso: non e' target di NESSUNA call.
ALLOWED_ENTITY_PREFIXES = {
    ("input_datetime", "set_datetime"): ("input_datetime.serra_",),
    ("input_boolean", "turn_on"): ("input_boolean.serra_",),
    ("input_boolean", "turn_off"): ("input_boolean.serra_",),
    ("script", "turn_on"): ("script.serra_",),
    ("input_text", "set_value"): tuple(CLIMATE_SOURCE_HELPERS),
    # Fase 3 (pannelli Controllo): scritture su helper PUNTUALI, elencati uno
    # a uno — niente prefissi larghi: ogni entita' qui e' un comando voluto.
    ("input_number", "set_value"): (
        "input_number.serra_luce_ch_d",
        "input_number.serra_luce_ch_r",
        "input_number.serra_luce_ch_b",
        "input_number.serra_luce_ch_g",
        "input_number.serra_luce_ch_a",
        "input_number.serra_lights_fade",
        "input_number.serra_luce_fade_min",   # rampa alba/tramonto (minuti)
        "input_number.serra_nutrient_duration",
        "input_number.serra_nutrient_times",
        "input_number.serra_nutrient_interval",
        # Fase 4 — Impostazioni: tarature, soglia allarme, calibrazione pompe.
        "input_number.serra_taratura_temp",
        "input_number.serra_taratura_umidita",
        "input_number.serra_acqua_soglia_pct",
        "input_number.serra_cal_pompa_0_ml_s",
        "input_number.serra_cal_pompa_1_ml_s",
        "input_number.serra_cal_pompa_2_ml_s",
        "input_number.serra_ring_fade",
        "input_number.serra_ring_blink_times",
        "input_number.serra_ring_blink_duration",
        "input_number.serra_ring_blink_interval",
    ),
    ("input_select", "select_option"): (
        "input_select.serra_fan_1_level",
        "input_select.serra_fan_2_level",
        "input_select.serra_fan_f_level",
        "input_select.serra_ring_color",
        # Fase 4 — Impostazioni
        "input_select.serra_varieta",
        "input_select.serra_ciclo_luce",
        "input_select.serra_vent_livello_auto",
    ),
}
# AUDIT R1 (BE-06): allow-list dei CAMPI del body — l'API HA accetta anche
# area_id/device_id/label_id come target: senza questo filtro la whitelist
# sulle entity si aggirava affiancando un secondo selettore (es. area_id →
# tutti gli script dell'area). entity_id deve essere UNA stringa.
ALLOWED_DATA_KEYS = {"entity_id", "date", "time", "datetime", "timestamp", "variables",
                     "value", "option"}  # Fase 3: set_value/select_option


# ── v3: editor del piano ──────────────────────────────────────────────────────
# La config HA e' montata a /homeassistant (map homeassistant_config) — /config
# dentro l'add-on e' il config PRIVATO dell'add-on, non quello di HA.
def _first_existing(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    return None


def piano_path():
    if not SUPERVISOR_TOKEN:  # dev: copia locale
        return os.path.join(HERE, "piano_dev.yaml")
    return _first_existing(["/homeassistant/serra_piano.yaml", "/config/serra_piano.yaml"])


def parser_path():
    return _first_existing(["/homeassistant/serra_piano_parse.py", "/config/serra_piano_parse.py"])


def _hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# Esegue il parser di Alberto (validatore fail-loudly) sul CANDIDATO:
# il sorgente viene caricato e il path hardcoded /config/serra_piano.yaml
# viene ripuntato al file temporaneo. Stesso codice, zero duplicazione.
VALIDATE_WRAPPER = (
    "import sys\n"
    "src = open(sys.argv[2], encoding='utf-8').read()"
    ".replace('/config/serra_piano.yaml', sys.argv[1])\n"
    "exec(compile(src, sys.argv[2], 'exec'))\n"
)


def validate_piano(candidate_text):
    """Ritorna None se valido, stringa d'errore altrimenti."""
    pp = parser_path()
    if pp is None:
        return None if not SUPERVISOR_TOKEN else "serra_piano_parse.py non trovato"
    # AUDIT R1 (BE-01): la replace del path e' FAIL-OPEN per natura — se il
    # parser non contiene la stringa attesa, non sostituisce nulla, gira sul
    # file REALE e "valida" sempre. Qui si verifica PRIMA che il ripunto sia
    # possibile: meglio rifiutare il salvataggio che salvare non-validato.
    try:
        with open(pp, encoding="utf-8") as f:
            parser_src = f.read()
    except OSError as exc:
        return "validatore illeggibile: %s" % exc
    if "/config/serra_piano.yaml" not in parser_src:
        LOG.error("validate: path atteso assente da %s — validazione impossibile", pp)
        # AUDIT R3 (BE3-07): dettaglio nel log, messaggio neutro all'editor
        return "validazione non disponibile: configurazione del validatore da aggiornare (dettagli nel log dell'add-on)"
    # AUDIT R1 (BE-03): candidato con nome UNIVOCO — il path fisso condiviso
    # faceva validare il file di un ALTRO thread (due tab → salvataggi incrociati).
    fd, tmp = tempfile.mkstemp(prefix=".candidate-", suffix=".yaml", dir=HERE)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(candidate_text)
        res = subprocess.run(
            ["python3", "-c", VALIDATE_WRAPPER, tmp, pp],
            capture_output=True, text=True, timeout=30,
        )
        if res.returncode == 0:
            return None
        err = (res.stderr or "").strip().splitlines()
        LOG.warning("validate: piano respinto: %s", err[-1] if err else "?")
        return err[-1] if err else "validazione fallita"
    except Exception as exc:
        # AUDIT R2 (BE2-11): dettaglio SOLO nel log — l'eccezione conteneva
        # l'intera command line del validatore (path interni + sorgente).
        LOG.error("validate: errore di esecuzione: %s", exc)
        return "validazione non completata (timeout o errore interno): riprovare, dettagli nel log dell'add-on"
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def save_piano(text):
    path = piano_path()
    if path is None:
        raise RuntimeError("serra_piano.yaml non trovato")
    if os.path.exists(path):
        # AUDIT R2 (BE2-12): backup a ROTAZIONE (ultime 5, timestampate) —
        # il singolo .bak veniva sovrascritto a ogni save: due salvataggi
        # consecutivi perdevano l'ultima versione buona.
        with open(path, encoding="utf-8") as f:
            old = f.read()
        # AUDIT R3 (BE3-01): suffisso in microsecondi — con la sola precisione
        # al secondo due save ravvicinati collassavano sullo stesso file e la
        # versione buona spariva (lo scenario esatto di BE2-12).
        stamp = "%s-%06d" % (time.strftime("%Y%m%d-%H%M%S"), int(time.time() * 1e6) % 1000000)
        with open("%s.bak-%s" % (path, stamp), "w", encoding="utf-8") as f:
            f.write(old)
        # AUDIT R3 (BE3-02): in rotazione SOLO i nostri timestamp — un backup
        # manuale ".bak-appunti" occupava per sempre uno dei 5 slot.
        _pat = re.compile(r"\.bak-\d{8}-\d{6}(-\d{6})?$")
        baks = sorted(
            p for p in os.listdir(os.path.dirname(path))
            if p.startswith(os.path.basename(path) + ".bak-") and _pat.search(p))
        for stale in baks[:-5]:
            try:
                os.remove(os.path.join(os.path.dirname(path), stale))
            except OSError:
                pass
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def ha_post(path, payload):
    req = urllib.request.Request(
        CORE_API + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer %s" % SUPERVISOR_TOKEN,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.load(resp)


class Handler(SimpleHTTPRequestHandler):
    # AUDIT R2 (BE2-04): senza timeout una connessione che dichiara un
    # Content-Length e non manda mai il body blocca il suo thread PER SEMPRE
    # (slowloris banale dalla rete Docker/ingress). 15s copre anche i client
    # mobili lenti; a scadenza il thread si libera da solo.
    timeout = 15

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WWW, **kw)

    # AUDIT R1 (BE-10): niente directory listing (GET /guide/ elencava i file).
    def list_directory(self, path):
        self.send_error(404)
        return None

    def send_header(self, keyword, value):
        if keyword.lower() == "cache-control":
            self._cc_sent = True
        super().send_header(keyword, value)

    def end_headers(self):
        # Cache corretta per una SPA: la shell (index.html) MAI in cache,
        # gli asset hashati per sempre. AUDIT R1 (BE-14): un solo header
        # Cache-Control (prima usciva doppio dove il metodo ne mandava gia'
        # uno) e match ancorato all'inizio del path, non substring.
        if not getattr(self, "_cc_sent", False):
            if self._route().startswith("/assets/"):
                super().send_header("Cache-Control", "public, max-age=31536000, immutable")
            else:
                super().send_header("Cache-Control", "no-cache")
        self._cc_sent = False
        super().end_headers()

    def _route(self):
        # path normalizzato senza query, per il routing ESATTO delle API
        # (AUDIT R1/BE-15: endswith su path rstrippato matchava troppo).
        # AUDIT R2 (BE2-03): getattr — su una request-line malformata
        # send_error() parte PRIMA che self.path esista e end_headers()
        # (che chiama _route per il Cache-Control) esplodeva in AttributeError:
        # il client riceveva 0 byte e il log un traceback per ogni port-scan.
        return urllib.parse.urlsplit(getattr(self, "path", "") or "").path

    def _read_body(self):
        # AUDIT R1 (BE-07): Content-Length validato — negativo o oltre il
        # tetto = 413, niente read(-1) che blocca il thread fino a EOF.
        length = int(self.headers.get("Content-Length", 0))
        if length < 0 or length > MAX_BODY:
            raise ValueError("body troppo grande o Content-Length invalido")
        return json.loads(self.rfile.read(length) or b"{}")

    def _json_nostore(self, obj):
        # stati e storici sono "vivi": mai in cache, come /api/timeline
        out = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def _query(self):
        return urllib.parse.parse_qs(
            urllib.parse.urlsplit(getattr(self, "path", "") or "").query)

    def _json(self, obj, code=200):
        out = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):
        route = self._route().rstrip("/")
        if route == "/api/note":
            # salva le note di UN giorno (array completo; [] = cancella il giorno)
            try:
                body = self._read_body()
                date = str(body.get("date", "")).strip()
                # AUDIT R2 (BE2-06): tipi stretti — una stringa al posto della
                # lista veniva iterata per carattere ("abc" -> ["a","b","c"]);
                # una data malformata diventava una chiave permanente invisibile
                # alla UI (che genera solo YYYY-MM-DD).
                notes_raw = body.get("notes") or []
                if not isinstance(notes_raw, list):
                    raise ValueError("'notes' deve essere una lista")
                notes = [str(x).strip() for x in notes_raw if str(x).strip()]
                if not date:
                    raise ValueError("data mancante")
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                    raise ValueError("data non valida (atteso YYYY-MM-DD)")
                # AUDIT R1 (BE-08): lock sull'intero read-modify-write — due
                # superfici che salvano quasi insieme non si perdono piu' note.
                with NOTE_LOCK:
                    # AUDIT R3 (BE3-03): guasto NOSTRO (store illeggibile) →
                    # 500 con messaggio fisso, non un 400 col dump di json
                    # spacciato per colpa dell'utente.
                    try:
                        data = load_note()
                    except Exception as exc:
                        LOG.error("note: store illeggibile: %s", exc)
                        self._json({"ok": False, "error": "store note illeggibile"}, 500)
                        return
                    if notes:
                        data[date] = notes
                    else:
                        data.pop(date, None)
                    save_note(data)
                self._json({"ok": True, "notes": data})
            except Exception as exc:
                LOG.warning("note: salvataggio fallito: %s", exc)
                self._json({"ok": False, "error": str(exc)}, 400)
            return
        if route == "/api/piano":
            # v3: salva il piano — SOLO se il parser di Alberto lo valida.
            try:
                body = self._read_body()
                text = body.get("yaml", "")
                if not text.strip():
                    raise ValueError("piano vuoto")
                # AUDIT R1 (BE-04): base_hash OBBLIGATORIO (senza, un client
                # con la GET fallita sovrascriveva alla cieca) e ri-verificato
                # DENTRO la sezione critica (il vecchio check era TOCTOU:
                # letto prima di una validazione che dura fino a 30s).
                base_hash = body.get("base_hash")
                if not base_hash:
                    self._json({"ok": False, "error": "base_hash mancante: riapri l'editor"}, 400)
                    return
                # AUDIT R3 (BE3-04): attesa con TETTO — senza, l'ennesimo POST
                # restava appeso in coda fino a ~120s (timeout socket escluso:
                # il body e' gia' letto).
                if not VALIDATE_SEM.acquire(timeout=20):
                    self._json({"ok": False, "error": "validazione occupata: riprovare tra qualche secondo"}, 503)
                    return
                try:
                    err = validate_piano(text)
                finally:
                    VALIDATE_SEM.release()
                if err:
                    self._json({"ok": False, "error": err}, 422)
                    return
                with PLAN_LOCK:
                    path = piano_path()
                    current = ""
                    if path and os.path.exists(path):
                        with open(path, encoding="utf-8") as f:
                            current = f.read()
                    if base_hash != _hash(current):
                        self._json({"ok": False,
                                    "error": "il piano è cambiato nel frattempo: riapri l'editor"}, 409)
                        return
                    save_piano(text)
                LOG.info("piano: salvato (%d byte)", len(text))
            # AUDIT R2 (BE2-05): errori del CLIENT (body non-JSON, piano
            # vuoto...) -> 400, come /api/note; 500 solo per guasti nostri.
            except ValueError as exc:
                LOG.warning("piano: richiesta non valida: %s", exc)
                self._json({"ok": False, "error": str(exc)}, 400)
                return
            except Exception as exc:
                LOG.error("piano: salvataggio fallito: %s", exc)
                self._json({"ok": False, "error": str(exc)}, 500)
                return
            # AUDIT R1 (BE-05): il refresh del sensore e' BEST-EFFORT, fuori
            # dal try del salvataggio — prima un timeout di update_entity
            # rispondeva "fallito" su un save gia' riuscito (e il retry
            # trovava l'hash stale: confusione totale).
            refresh_failed = False
            if SUPERVISOR_TOKEN:
                try:
                    ha_post("/services/homeassistant/update_entity",
                            {"entity_id": "sensor.serra_piano"})
                except Exception as exc:
                    refresh_failed = True
                    LOG.warning("piano: update_entity fallito (il polling da 5' recupera): %s", exc)
            self._json({"ok": True, "hash": _hash(text), "refresh_failed": refresh_failed})
            return
        if not route == "/api/service":
            self._json({"ok": False, "error": "endpoint sconosciuto"}, 404)
            return
        try:
            body = self._read_body()
            domain = body.get("domain", "")
            service = body.get("service", "")
            data = body.get("data", {}) or {}
            entity = data.get("entity_id", "")
            if (domain, service) not in ALLOWED_SERVICES:
                raise ValueError("servizio non permesso: %s.%s" % (domain, service))
            # AUDIT R1 (BE-06): campi del body in allow-list (niente area_id/
            # device_id che scavalcherebbero la whitelist sulle entity) ed
            # entity_id SOLO stringa singola con prefisso serra_.
            extra = set(data.keys()) - ALLOWED_DATA_KEYS
            if extra:
                raise ValueError("campi non permessi: %s" % ", ".join(sorted(extra)))
            # AUDIT R2 (BE2-14): variables passa agli script serra_* senza
            # controllo di contenuto — almeno tipo e taglia stretti.
            if "variables" in data:
                if not isinstance(data["variables"], dict):
                    raise ValueError("'variables' deve essere un oggetto")
                if len(json.dumps(data["variables"], ensure_ascii=False).encode("utf-8")) > 2048:
                    raise ValueError("'variables' troppo grande (max 2KB)")
            # AUDIT R2 (BE2-01): forma STRETTA prima del prefisso — HA splitta
            # entity_id sulla virgola (cv.entity_ids), quindi la stringa
            # "script.serra_x,script.qualsiasi" passava il prefix-check ed
            # eseguiva QUALUNQUE script. Niente virgole/spazi/jolly: una sola
            # entita' per chiamata, formato dominio.oggetto.
            prefs = ALLOWED_ENTITY_PREFIXES.get((domain, service), ())
            if not isinstance(entity, str) or not re.fullmatch(
                    r"[a-z_]+\.[a-z0-9_]+", entity) or not any(
                    entity.startswith(pref) for pref in prefs):
                raise ValueError("entita' non permessa: %s" % entity)
            if (domain, service) == ("input_text", "set_value"):
                if entity not in CLIMATE_SOURCE_HELPERS or set(data) != {"entity_id", "value"}:
                    raise ValueError("sorgente climatica non permessa")
                value = data["value"]
                if not isinstance(value, str) or len(value) > 100 or not re.fullmatch(
                        r"sensor\.[a-z0-9_]+", value):
                    raise ValueError("scegli un sensore Home Assistant valido")
                if SUPERVISOR_TOKEN:
                    choices = climate_sensor_choices(ha_get("/states", timeout=15))
                    expected = CLIMATE_SOURCE_HELPERS[entity]
                    if value not in {row["entity_id"] for row in choices[expected]}:
                        raise ValueError("il sensore non esiste o non misura la grandezza richiesta")
            if SUPERVISOR_TOKEN:
                ha_post("/services/%s/%s" % (domain, service), data)
                result = {"ok": True}
            else:
                result = {"ok": True, "dev": True}  # dev: no-op
            self._json(result)
        except Exception as exc:
            LOG.warning("service: rifiutato/fallito: %s", exc)
            self._json({"ok": False, "error": str(exc)}, 400)

    # AUDIT R2 (BE2-08): routing con match ESATTO — endswith accettava
    # /qualunque/cosa/api/piano (over-match); il prefisso ingress e' strippato
    # dal proxy, quindi il path arriva gia' pulito.
    def do_GET(self):
        route = self._route().rstrip("/")
        if route == "/api/climate-sensors":
            try:
                states = ha_get("/states", timeout=15) if SUPERVISOR_TOKEN else []
                self._json_nostore({"ok": True, **climate_sensor_choices(states)})
            except Exception as exc:
                LOG.error("sensori climatici: core irraggiungibile: %s", exc)
                self._json({"ok": False, "error": "sensori HA non disponibili"}, 502)
            return
        if route == "/api/note":
            # AUDIT R2 (BE2-02): load_note ora solleva su store illeggibile
            try:
                self._json({"ok": True, "notes": load_note()})
            except Exception as exc:
                LOG.error("note: store illeggibile: %s", exc)
                self._json({"ok": False, "error": "store note illeggibile"}, 500)
            return
        if route == "/api/piano":
            path = piano_path()
            if path is None or not os.path.exists(path):
                # AUDIT R1 (BE-15): prima open(None) esplodeva in un TypeError
                # mostrato tal quale nell'editor.
                self._json({"ok": False, "error": "serra_piano.yaml non trovato"}, 404)
                return
            try:
                with open(path, encoding="utf-8") as f:
                    text = f.read()
                self._json({"ok": True, "yaml": text, "hash": _hash(text)})
            except Exception as exc:
                LOG.error("piano: lettura fallita: %s", exc)
                self._json({"ok": False, "error": str(exc)}, 500)
            return
        if route == "/api/timeline":
            try:
                body = json.dumps(timeline_payload()).encode("utf-8")
            except Exception as exc:
                # AUDIT R1 (BE-02): core irraggiungibile → 502 esplicito (il
                # frontend ha il check r.ok), non un payload vuoto plausibile.
                LOG.error("timeline: core irraggiungibile: %s", exc)
                self._json({"ok": False, "error": "core HA irraggiungibile: %s" % exc}, 502)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # ── Fase 2 (sezione Stato): tutte GET read-only. NON passano dal
        # VALIDATE_SEM ne' dai lock del piano — non toccano nessun file.
        if route == "/api/stato":
            try:
                payload = stato_payload()
            except Exception as exc:
                LOG.error("stato: core irraggiungibile: %s", exc)
                self._json({"ok": False, "error": "core HA irraggiungibile"}, 502)
                return
            self._json_nostore(payload)
            return
        if route == "/api/history":
            q = self._query()
            entity = (q.get("entity") or [""])[0]
            hours_raw = (q.get("hours") or [""])[0]
            # `win` = ore (int) oppure il token esatto "coltura". Whitelist
            # chiusa su entrambi i fronti: niente valori liberi dall'esterno.
            if hours_raw == STATS_TOKEN:
                win = STATS_TOKEN
            else:
                try:
                    win = int(hours_raw)
                except ValueError:
                    win = 0
                if win not in HISTORY_HOURS and win not in STATS_HOURS:
                    win = None
            if entity not in HISTORY_ENTITIES or win is None:
                # messaggio neutro: chi chiama fuori whitelist non deve
                # scoprire cosa c'e' dentro
                self._json({"ok": False, "error": "parametri non validi"}, 400)
                return
            try:
                payload = serie_payload(entity, win)
            except Exception as exc:
                LOG.error("history: %s (%s) fallita: %s", entity, win, exc)
                self._json({"ok": False, "error": "storico non disponibile"}, 502)
                return
            self._json_nostore(payload)
            return
        # ── Fase 5: diario strutturato. GET read-only, come Stato: niente
        # lock del piano, niente scritture, errori neutri.
        if route == "/api/diario":
            q = self._query()
            try:
                limit = int((q.get("limit") or [DIARIO_LIMIT_DEF])[0])
            except ValueError:
                limit = DIARIO_LIMIT_DEF
            limit = max(1, min(DIARIO_LIMIT_MAX, limit))
            # `before` e' un timestamp ISO che arriva dal client: si usa SOLO
            # come cursore temporale (convertito in epoch), mai per comporre un
            # path. Il taglio a 32 caratteri tiene corta una stringa arbitraria.
            before = (q.get("before") or [""])[0][:32] or None
            try:
                payload = diario_payload(limit, before)
            except Exception as exc:
                LOG.error("diario: lettura fallita: %s", exc)
                self._json({"ok": False, "error": "diario non disponibile"}, 502)
                return
            self._json_nostore(payload)
            return
        if route == "/api/foto/list":
            self._json_nostore({"files": foto_list()})
            return
        if route == "/api/foto/file":
            name = (self._query().get("name") or [""])[0]
            # La regex e' l'UNICA porta: nessun join prima di averla passata,
            # quindi niente "../" e niente nomi arbitrari.
            if not FOTO_RE.fullmatch(name):
                self._json({"ok": False, "error": "nome non valido"}, 400)
                return
            try:
                with open(os.path.join(FOTO_DIR, name), "rb") as f:
                    body = f.read()
            except OSError:
                self._json({"ok": False, "error": "foto non trovata"}, 404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(body)))
            # i file dell'archivio sono immutabili (il nome contiene data+ora)
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.end_headers()
            self.wfile.write(body)
            return
        # guide "live": se il file esiste in GUIDE_LIVE servilo da li' (editabile
        # a caldo), altrimenti cadi sulla copia baked in www/ via super().
        gp = self._route()
        if gp.startswith("/guide/") and self._serve_live_guide(gp[len("/guide/"):]):
            return
        super().do_GET()

    def _serve_live_guide(self, rel):
        # AUDIT R1: unquote PRIMA del join — un file con spazi/accenti non
        # prendeva mai l'override live (cadeva in silenzio sulla copia baked).
        # Il check realpath sotto resta valido sull'input decodificato.
        rel = urllib.parse.unquote(rel)
        base = os.path.realpath(GUIDE_LIVE)
        target = os.path.realpath(os.path.join(base, rel))
        # no path traversal: target deve stare dentro GUIDE_LIVE
        if target != base and not target.startswith(base + os.sep):
            return False
        if not os.path.isfile(target):
            return False
        # AUDIT R1 (M-17): allow-list di ESTENSIONI con Content-Type esplicito.
        # Prima il tipo lo deduceva mimetypes: un .html (o .svg) lasciato per
        # sbaglio in GUIDE_LIVE veniva servito come text/html DALLA STESSA
        # ORIGIN dell'app. Le guide sono markdown e immagini: tutto il resto
        # non si serve.
        ctype = GUIDE_TYPES.get(os.path.splitext(target)[1].lower())
        if ctype is None:
            self.send_error(404)
            return True
        try:
            with open(target, "rb") as f:
                body = f.read()
        except OSError:
            return False
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)
        return True

    def log_message(self, fmt, *args):  # log sobrio
        pass


if __name__ == "__main__":
    print("Serra Piano backend su :%d (dev=%s)" % (PORT, not SUPERVISOR_TOKEN))
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
