// Sezione STATO (Fase 2 del porting design v3).
//
// Regole rispettate qui:
//  - palette e token SOLO da app.css (i colori del design non fanno fede),
//    geometrie/layout dal design (snapshot "Calendario Ciclo v3.dc.html").
//  - URL delle fetch RELATIVI: sotto Ingress l'app vive in
//    /api/hassio_ingress/<token>/ e un path assoluto non arriva al backend.
//  - polling attivo SOLO quando la sezione e' visibile (prop `attiva`) e la
//    scheda non e' nascosta — stesso pattern del Piano in App.jsx.
//  - grafici SVG fatti a mano: nessuna libreria.
//
// Il file e' autonomo: App.jsx importa il componente e basta.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiWifiOff, mdiWaterAlert, mdiAlertCircleOutline,
  mdiClockCheckOutline, mdiClockAlertOutline, mdiThermometer, mdiWaterPercent,
  mdiWaves, mdiCupWater, mdiLightbulbOn, mdiWater, mdiFlask, mdiFan,
  mdiLedStripVariant, mdiChevronRight, mdiChevronLeft, mdiTuneVertical,
  mdiRouterWireless, mdiWifi, mdiRestart, mdiRaspberryPi,
  mdiWaterSync, mdiImageOutline, mdiAlertOutline, mdiCamera,
  mdiInformationOutline, mdiClose,
} from '@mdi/js'
import Hint from './Hint.jsx'
import { LIVELLO_LAB } from './model.js'
import './stato.css'

/* ══════════════════════════════════════════════════════════════════════
   MAPPING ENTITÀ — coppie (id candidati, suffissi di ricerca)
   ──────────────────────────────────────────────────────────────────────
   Ogni voce e' una COPPIA: il resolver prova prima gli id nell'ordine
   dichiarato, poi cerca fra le chiavi del payload la prima che finisce con
   uno dei suffissi. Quando i nomi veri sono noti basta lasciare un solo id
   in `ids` e cancellare `sfx`.

   AUDIT R1 (I-3/K-11): il meccanismo ora FUNZIONA DAVVERO. Prima il
   resolver si fermava alla presenza della chiave, e api/stato emette una
   chiave per OGNI voce di STATO_ENTITIES (anche assente, con
   `error: entita' assente` e stato null): il primo id vinceva sempre e la
   ricerca per suffisso era irraggiungibile. Ora si richiede uno STATO non
   nullo, quindi un secondo candidato viene provato davvero e il ripiego
   per suffisso puo' scattare.

   AUDIT R3 (C-R3-2): il resolver vede SOLO cio' che il backend manda, cioe'
   STATO_ENTITIES. Un id fuori whitelist non e' un ripiego: e' una riga che
   non puo' risolversi mai. Le voci qui sotto portano quindi un solo id
   quando uno solo e' whitelistato — i `sfx` restano perche' quelli girano
   sulle chiavi vere del payload.

   Le 4 serie storiche (temp/rh/vpd/vasca) usano LE STESSE chiavi: l'id
   che il resolver trova qui e' quello passato a api/history?entity=…
   ══════════════════════════════════════════════════════════════════════ */
const ENT = {
  // ── clima tarato (gli stessi valori dell'header, via model.clima) ──
  temp:   { ids: ['sensor.serra_clima_temperatura'], sfx: ['_clima_temperatura', '_temperatura_tarata', '_temperatura'] },
  rh:     { ids: ['sensor.serra_clima_umidita'],     sfx: ['_clima_umidita', '_umidita_tarata', '_umidita'] },
  vpd:    { ids: ['sensor.serra_vpd'],               sfx: ['_vpd'] },
  vasca:  { ids: ['sensor.serra_livello_acqua'], sfx: ['_livello_acqua', '_acqua_livello', '_vasca_livello'] },
  // soglia dell'allarme acqua bassa: e' il fondo della banda ideale della
  // vasca (la stessa che si regola in Impostazioni · Notifiche)
  sogliaAcqua: { ids: ['input_number.serra_acqua_soglia_pct'], sfx: ['_acqua_soglia_pct'] },
  // ── componenti (stato sintetico + eventuale attributo modo) ──
  cLuci:      { ids: ['sensor.serra_componente_luci'],      sfx: ['_componente_luci'] },
  cAcqua:     { ids: ['sensor.serra_componente_acqua'],     sfx: ['_componente_acqua'] },
  cNutrienti: { ids: ['sensor.serra_componente_nutrienti'], sfx: ['_componente_nutrienti'] },
  cVentole:   { ids: ['sensor.serra_componente_ventole'],   sfx: ['_componente_ventole'] },
  cRing:      { ids: ['sensor.serra_componente_ring'],      sfx: ['_componente_ring'] },
  /* ── dettaglio dei componenti (pannello in overlay) ──────────────────
     Sono le STESSE entita' che legge Controllo, gia' dentro api/stato: il
     pannello non apre nessuna fetch nuova, pesca dal payload che la sezione
     riceve comunque ogni 60 s. Qui stanno solo quelle che servono al
     dettaglio rapido — il resto (comandi, staging, taratura) resta a
     Controllo, che e' l'altra meta' del patto: qui si legge, li' si agisce. */
  litri:      { ids: ['sensor.serra_acqua_litri'], sfx: ['_acqua_litri'] },
  pompaRun:   { ids: ['sensor.serra_pump_main_running_now'], sfx: ['_pump_main_running_now'] },
  pompaStato: { ids: ['sensor.serra_pump_main_state'],       sfx: ['_pump_main_state'] },
  pompaSec:   { ids: ['sensor.serra_pump_main_seconds'],     sfx: ['_pump_main_seconds'] },
  pompaFine:  { ids: ['sensor.serra_pump_main_until'],       sfx: ['_pump_main_until'] },
  // luci: STATO pubblicato dal bridge (divergenza #3), mai gli input di staging
  luciStato:  { ids: ['sensor.serra_lights_state'],     sfx: ['_lights_state'] },
  luciInt:    { ids: ['sensor.serra_lights_intensity'], sfx: ['_lights_intensity'] },
  luciSched:  { ids: ['binary_sensor.serra_luci_dovrebbero_essere_on'], sfx: ['_dovrebbero_essere_on'] },
  luciRampa:  { ids: ['input_number.serra_luce_fade_min'], sfx: ['_luce_fade_min'] },
  fan1Lv:     { ids: ['sensor.serra_fan_1_level'], sfx: ['_fan_1_level'] },
  fan2Lv:     { ids: ['sensor.serra_fan_2_level'], sfx: ['_fan_2_level'] },
  fanFLv:     { ids: ['sensor.serra_fan_f_level'], sfx: ['_fan_f_level'] },
  ventAuto:   { ids: ['input_select.serra_vent_livello_auto'], sfx: ['_vent_livello_auto'] },
  filtro:     { ids: ['input_boolean.serra_filtro_odori'], sfx: ['_filtro_odori'] },
  dose:       { ids: ['sensor.serra_dose_nutrienti'], sfx: ['_dose_nutrienti'] },
  booster:    { ids: ['sensor.serra_prossimo_booster'], sfx: ['_prossimo_booster'] },
  nutrUltimo: { ids: ['sensor.serra_nutrients_last_update'], sfx: ['_nutrients_last_update'] },
  // NIENTE ricerca per suffisso: `sensor.serra_ring_color` (il colore ACCESO,
  // esadecimale) e `input_select.serra_ring_color` (quello impostato a mano)
  // finiscono entrambi con `_ring_color` e si prenderebbero a vicenda.
  ringStato:  { ids: ['sensor.serra_ring_state'], sfx: ['_ring_state'] },
  ringColore: { ids: ['sensor.serra_ring_color'], sfx: [] },
  ringSel:    { ids: ['input_select.serra_ring_color'], sfx: [] },
  ringFade:   { ids: ['input_number.serra_ring_fade'], sfx: ['_ring_fade'] },
  ringUltimo: { ids: ['sensor.serra_ring_last_update'], sfx: ['_ring_last_update'] },
  // ── diagnostica centralina ──
  online:     { ids: ['sensor.serra_bridge_online'], sfx: ['_bridge_online', '_online'] },
  // Wifi: NON esiste un sensore di potenza del segnale, e non e' una lacuna da
  // riempire a mano — il firmware pubblica serra/state/net con enabled/ntp/ts e
  // nient'altro. net_state (on/off + attributo ts_local) e' il solo dato reale.
  net:        { ids: ['sensor.serra_net_state'],   sfx: ['_net_state'] },
  uptimeSerra:{ ids: ['sensor.serra_uptime'],      sfx: ['_serra_uptime', '_uptime_serra'] },
  uptimePi:   { ids: ['sensor.serra_pi_uptime'],   sfx: ['_pi_uptime', '_uptime_pi', '_raspberry_uptime'] },
  // ripiego per il sub "Ultimo avvio" della serra quando l'uptime non si parsa:
  // stato gia' pronto ("Ultimo avvio: 15/07"), si mostra tale e quale.
  avvioSerra: { ids: ['sensor.serra_ultimo_avvio'], sfx: ['_ultimo_avvio'] },
  freschezza: { ids: ['sensor.serra_freschezza_dati'], sfx: ['_freschezza_dati', '_freschezza', '_ultimo_aggiornamento', '_last_update'] },
  // ── ultimi eventi ──
  ricircolo:  { ids: ['sensor.serra_acqua_ultimo_ricircolo'], sfx: ['_ultimo_ricircolo'] },
  cambioAcqua:{ ids: ['input_datetime.serra_acqua_ultimo_cambio'], sfx: ['_ultimo_cambio_acqua', '_acqua_ultimo_cambio', '_cambio_acqua'] },
  // ── foto ──
  // (niente ENT.fotoCaption: la data/ora si ricava dal nome file, vedi
  //  capFromName — la caption del sensore portava un contatore suo)
  fotoArch:   { ids: ['sensor.serra_foto_archivio'], sfx: ['_foto_archivio'] },
  // ── allarmi / gate ──
  errore:      { ids: ['input_text.serra_errore_componente'], sfx: ['_errore_componente'] },
  acquaBassa:  { ids: ['binary_sensor.serra_acqua_bassa'], sfx: ['_acqua_bassa', '_allarme_acqua'] },
  // latch discordanza attesa/realta' (piano avvisi 03/08): alzati da HA
  // quando un componente in modalita' Pianificata non segue il programma da >10 min
  discLuci:    { ids: ['input_boolean.serra_discordanza_luci'], sfx: ['_discordanza_luci'] },
  discAcqua:   { ids: ['input_boolean.serra_discordanza_acqua'], sfx: ['_discordanza_acqua'] },
  discVentole: { ids: ['input_boolean.serra_discordanza_ventole'], sfx: ['_discordanza_ventole'] },
  // (niente ENT.coltivazione: la coltivazione attiva arriva da
  //  model.coltivazioneAttiva, cioe' da api/timeline, e nessuno la leggeva qui)
}

// Serie storiche disegnate: chiave di ENT + resa grafica.
// I colori sono token di app.css, NON del design.
const SERIE = {
  temp:  { key: 'temp',  label: 'Temperatura',   icon: mdiThermometer,  unit: '°C',  accent: 'var(--warn)',  dec: 1 },
  rh:    { key: 'rh',    label: 'Umidità',       icon: mdiWaterPercent, unit: '%',   accent: 'var(--fase-germinazione)', dec: 0 },
  vpd:   { key: 'vpd',   label: 'VPD',           icon: mdiWaves,        unit: 'kPa', accent: 'var(--fase-fioritura)', dec: 2 },
  vasca: { key: 'vasca', label: 'Livello vasca', icon: mdiCupWater,     unit: '%',   accent: 'var(--acqua)', dec: 0 },
}

const COMP = [
  { k: 'luci',      ent: 'cLuci',      label: 'Luci',      icon: mdiLightbulbOn,     disc: 'var(--luce)' },
  { k: 'acqua',     ent: 'cAcqua',     label: 'Acqua',     icon: mdiWater,           disc: 'var(--acqua)' },
  { k: 'nutrienti', ent: 'cNutrienti', label: 'Nutrienti', icon: mdiFlask,           disc: 'var(--verde)' },
  { k: 'ventole',   ent: 'cVentole',   label: 'Ventole',   icon: mdiFan,             disc: 'var(--warn)' },
  { k: 'ring',      ent: 'cRing',      label: 'LED Ring',  icon: mdiLedStripVariant, disc: 'var(--fase-fioritura)' },
]

// Canali del pannello LED, nell'ordine in cui li pubblica il bridge.
const CH = ['D', 'R', 'B', 'G', 'A']
// Colore acceso sull'anello: il sensore pubblica l'esadecimale, non il nome.
// DUPLICATO consapevole di RING_HEX in Controllo.jsx (4 righe): le due sezioni
// non si importano a vicenda. Se un domani la mappa si sposta in model.js,
// cancellare questa.
const RING_HEX = {
  ffffff: 'bianco', ff0000: 'rosso', '00ff00': 'verde', ffff00: 'giallo',
  ffa500: 'arancione', '0000ff': 'blu', 800080: 'viola',
  303030: 'bianco attenuato', '000000': 'spento',
}
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// Finestre storiche selezionabili: UNA pill-bar per tutti e quattro i grafici.
// Le stesse ore sono whitelistate in HISTORY_HOURS lato backend — la lista qui
// non e' la fonte: e' la copia leggibile di quella chiusa.
// Oltre le 168 h la history grezza non esiste piu' (il recorder pota a ~10
// giorni): quelle due finestre leggono le STATISTICHE di lungo periodo, cioe'
// medie orarie o giornaliere. Lo dice la riga .st-res sotto ai chip.
const COLTURA = 'coltura'      // token esatto, come lo attende il backend
const RANGES = [
  { v: 6, lab: '6 h' }, { v: 12, lab: '12 h' }, { v: 24, lab: '24 h' },
  { v: 48, lab: '48 h' }, { v: 168, lab: '7 g' },
  { v: 720, lab: '30 g' }, { v: COLTURA, lab: 'Coltura' },
]
// ore di una finestra: serve solo come stima prima che il backend risponda —
// la durata vera di "coltura" dipende dalla data di semina e la dichiara lui.
const oreDi = (v) => (typeof v === 'number' ? v : 720)
// per le aria-label: "ultime 12 ore" / "ultimi 30 giorni" / "dall'inizio della coltura"
const finestraLabel = (v) => (
  v === COLTURA ? 'dall’inizio della coltura'
    : (v >= 168 ? `ultimi ${Math.round(v / 24)} giorni` : `ultime ${v} ore`))
// trasparenza sui dati: sulle finestre lunghe i punti non sono letture ma medie
const RES_LABEL = { hourly: 'medie orarie', daily: 'medie giornaliere' }
const STATO_POLL_MS = 60000    // = CLIMA_POLL_MS del Piano
const HIST_POLL_MS = 300000    // history: 5 minuti (≤300 punti, non serve di piu')
// La centralina NON e' sempre connessa: accende il wifi a duty-cycle (una
// finestra ogni ~30-60 min) per risparmiare corrente. Un'eta' dei dati di
// 10-60 minuti e' quindi il FUNZIONAMENTO NORMALE, non un guasto: la soglia
// di allarme sta oltre due cicli mancati.
const STALE_MIN = 90           // oltre → pill/riga freschezza in warn
const MAIN_W = 640, MAIN_H = 190
const MINI_W = 320, MINI_H = 120
const DIM_OFF = '0.42'         // design r.581-585: dati non freschi = dim
const SCATTO_ARM_MS = 4000     // "Scatta foto ora": finestra di conferma (2 tap)
const SCATTO_SCRIPT = 'script.serra_foto_scatta'
/* AZZERAMENTO DELL'ERRORE PENDENTE — la via d'uscita dello stato "errore".
   Sta QUI e in nessun altro punto dell'app: il banner che dichiara il guasto
   e' anche quello che lo chiude. Lo script spegne il latch
   (input_boolean.serra_errore_pendente + input_text.serra_errore_componente)
   e scrive la riga nel diario; e' un'azione di HA, quindi funziona anche a
   centralina offline — ed e' giusto cosi', altrimenti un errore preso mentre
   la serra e' muta resterebbe rosso per sempre.
   Non cancella il guasto: cancella la SEGNALAZIONE. Se il componente sbaglia
   ancora, l'errore tornera' da solo — per questo la conferma e' in due tocchi
   come tutte le azioni fisiche. */
const RESET_SCRIPT = 'script.serra_errore_reset'
// doppio refetch post-azione: = RECONCILE di Controllo.jsx
const RESET_RECONCILE = [700, 1800]

// Copia locale della callService di App.jsx (10 righe). Importarla da App
// creerebbe il ciclo App → Stato → App, stesso motivo del componente Icon.
async function callService(domain, service, data) {
  const r = await fetch('api/service', {   // URL RELATIVO: obbligatorio sotto Ingress
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, service, data }),
  })
  const j = await r.json()
  if (!j.ok) throw new Error(j.error || 'chiamata fallita')
  return j
}

// Icona: copia locale del componente di App.jsx (4 righe). Importarlo da
// App creerebbe un ciclo App → Stato → App, e spostarlo altrove vorrebbe
// dire toccare App oltre il minimo concesso in questa fase.
function Icon({ path, size = 16, color, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none', ...style }}>
      <path d={path} fill={color || 'currentColor'} />
    </svg>
  )
}

// Affordance "(i)" delle righe informative (pattern condiviso con Stato.jsx):
// la riga NON e' piu' interrogabile, la spiegazione vive solo su questo
// puntino in coda. `anchor` = bolla ferma col caret anche col mouse: il
// bersaglio e' minuscolo, una bolla che scappa dietro al cursore farebbe
// perdere il riferimento a quale riga si sta leggendo.
function RowInfo({ text }) {
  return (
    <Hint text={text} anchor>
      <button type="button" className="hint-i" aria-label="Spiegazione">
        <Icon path={mdiInformationOutline} size={15} />
      </button>
    </Hint>
  )
}

/* ── lettura tollerante del payload ─────────────────────────────────── */
function resolveIds(entities) {
  const keys = Object.keys(entities || {})
  const out = {}
  for (const [k, spec] of Object.entries(ENT)) {
    // AUDIT R1 (I-3): "chiave presente" non basta — api/stato emette una
    // chiave anche per le entita' assenti dal core. Vale solo uno STATO vero.
    let id = spec.ids.find((x) => entities && entities[x] && entities[x].state != null)
    if (!id) id = keys.find((x) => spec.sfx.some((s) => x.endsWith(s)))
    out[k] = id || null
  }
  return out
}
const entOf = (entities, id) => (id && entities ? entities[id] : null) || null
const stOf = (entities, id) => { const e = entOf(entities, id); return e && e.state != null ? String(e.state) : null }
const numOf = (entities, id) => { const v = parseFloat(stOf(entities, id)); return isNaN(v) ? null : v }
const attrOf = (entities, id, a) => { const e = entOf(entities, id); return e && e.attributes ? e.attributes[a] : undefined }
const isOn = (s) => s === 'on' || s === 'true' || s === 'True' || s === 'home'
const UNAVAIL = new Set(['unavailable', 'unknown', 'none', 'null', ''])
const has = (s) => s != null && !UNAVAIL.has(String(s).trim().toLowerCase())

/* ── formattatori ───────────────────────────────────────────────────── */
const p2 = (n) => String(n).padStart(2, '0')
const dm = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`
const EM = '—'

function toDate(v) {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v) ? null : v
  const s = String(v).trim()
  if (!has(s)) return null
  // epoch (s o ms) oppure ISO
  if (/^\d{9,14}$/.test(s)) { const n = Number(s); return new Date(n > 1e11 ? n : n * 1000) }
  const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s)
  return isNaN(d) ? null : d
}
// "2 min fa" / "3 ore fa" / "2 giorni fa"
function fromNow(d, now = Date.now()) {
  if (!d) return null
  const m = Math.round((now - d.getTime()) / 60000)
  if (m < 1) return 'ora'
  if (m < 60) return `${m} min fa`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ${h === 1 ? 'ora' : 'ore'} fa`
  const g = Math.round(h / 24)
  return `${g} ${g === 1 ? 'giorno' : 'giorni'} fa`
}
// "Oggi alle 19:00" / "25/07 alle 11:20"
function whenLabel(d, now = new Date()) {
  if (!d) return null
  const sameDay = d.toDateString() === now.toDateString()
  const ieri = new Date(now); ieri.setDate(ieri.getDate() - 1)
  const pre = sameDay ? 'Oggi' : (d.toDateString() === ieri.toDateString() ? 'Ieri' : dm(d))
  return `${pre} alle ${hhmm(d)}`
}
// uptime → SECONDI di accensione. Tre formati accettati, in ordine:
//  1. numero puro: durata in secondi (< 1e8 s ≈ 3 anni) oppure, sopra quella
//     soglia, un epoch (≈1.7e9) che e' l'ISTANTE di boot, non una durata;
//  2. stringa "17g 14h 36min" — il formato REALE dei sensori uptime — con le
//     sue varianti senza giorni ("5h 12min") o di soli minuti ("44min");
//  3. data/ora ISO di boot.
// Restituisce null se non e' nessuna delle tre.
function uptimeSeconds(raw) {
  if (!has(raw)) return null
  const s = String(raw).trim()
  const n = parseFloat(s)
  if (!isNaN(n) && s === String(n)) {
    if (n <= 1e8) return n < 0 ? null : n
    const ms = n > 1e11 ? n : n * 1000
    return Math.max(0, (Date.now() - ms) / 1000)
  }
  // "17g 14h 36min" / "5h 12min" / "44min" / "11 g 23 h" / "1 giorno 2 ore"
  const g = /(\d+)\s*(?:gg|g|d|giorn[oi])\b/i.exec(s)
  const h = /(\d+)\s*(?:h|or[ae])\b/i.exec(s)
  const mi = /(\d+)\s*(?:min(?:uti?)?|m)\b/i.exec(s)
  if (g || h || mi) {
    return (g ? +g[1] * 86400 : 0) + (h ? +h[1] * 3600 : 0) + (mi ? +mi[1] * 60 : 0)
  }
  const d = toDate(s)
  return d ? Math.max(0, (Date.now() - d.getTime()) / 1000) : null
}
// uptime → "11 g 23 h". Se il formato e' sconosciuto si mostra il grezzo.
function uptimeLabel(raw) {
  if (!has(raw)) return null
  const sec = uptimeSeconds(raw)
  if (sec == null) return String(raw)
  const g = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600)
  if (g > 0) return `${g} g ${h} h`
  const mi = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h} h ${mi} min` : `${mi} min`
}
/* Istante di ultimo avvio = now − uptime.
   NON esiste un sensore data/ora di boot (per il Pi non esiste proprio), quindi
   si calcola. Due accorgimenti obbligatori:
    - l'uptime ha risoluzione al minuto e il poll cade in un punto qualunque del
      minuto: la stima grezza oscilla di ±1 min a ogni giro. Si arrotonda al
      minuto e si TIENE il valore gia' mostrato finche' la nuova stima non si
      sposta di piu' di BOOT_TOL_MS (un riavvio vero salta di ore, non di
      minuti: la tolleranza non nasconde nulla di reale).
    - lo stato e' per-riga, quindi l'hook va chiamato una volta per sensore.
   AUDIT R1 (M-12): il valore stabilizzato vive in uno STATO con
   inizializzazione lazy e viene aggiornato in un effetto — durante il render
   non si scrive piu' niente, cosi' il render resta puro (e StrictMode/
   concurrent mode non hanno piu' niente da rimproverare). */
const BOOT_TOL_MS = 5 * 60000
function useBootTime(raw) {
  const sec = uptimeSeconds(raw)
  /* AUDIT R3 (M-R3-5): inizializzazione LAZY, cosi' al primo paint con i dati
     gia' in mano il sub e' subito quello calcolato invece di comparire (o
     cambiare stringa) un frame dopo. Non e' un render impuro: l'initializer di
     useState gira UNA volta, alla nascita dell'hook, non a ogni giro — e' il
     `Date.now()` nel corpo del render che M-R2-2 ha tolto, e resta tolto. */
  const [boot, setBoot] = useState(() => (
    sec == null ? null : new Date(Math.round((Date.now() - sec * 1000) / 60000) * 60000)
  ))
  /* AUDIT R2 (M-R2-2): l'istante si campiona QUI DENTRO. Calcolando `cand` nel
     corpo del render, Date.now() cambiava a ogni giro e con lui la dipendenza
     dell'effetto, che ripartiva sempre (React faceva bail-out perche' l'updater
     tornava lo stesso oggetto, ma il lavoro c'era). La sola cosa che deve far
     ripartire il calcolo e' l'uptime LETTO, che e' `sec`. */
  useEffect(() => {
    if (sec == null) { setBoot((p) => (p == null ? p : null)); return }
    const cand = Math.round((Date.now() - sec * 1000) / 60000) * 60000
    // si TIENE il valore gia' mostrato finche' la nuova stima resta dentro
    // la tolleranza: identita' invariata = nessun re-render
    setBoot((p) => ((!p || Math.abs(p.getTime() - cand) > BOOT_TOL_MS) ? new Date(cand) : p))
  }, [sec])
  return sec == null ? null : boot
}
const avvioLabel = (d) => (d ? `Ultimo avvio: ${dm(d)} alle ${hhmm(d)}` : null)

/* ── banda ideale + colore a 3 livelli ──────────────────────────────────
   DUPLICATO consapevole della logica dell'header: le gemelle di parseBand e
   bandColor, e il calcolo giorno/notte che qui sta in isGiorno, vivono dentro
   il componente `Header` di App.jsx (sono variabili locali sue, non export).
   Estrarle vorrebbe dire rifattorizzare App, che in questa fase va toccato il
   minimo. Se un domani si spostano in model.js, cancellare queste 3 fn. */
function parseBand(s) {
  if (!s) return null
  const p = String(s).split(/[–-]/).map((x) => parseFloat(x))
  return p.length === 2 && !p.some(isNaN) ? p : null
}
function bandColor(v, band, margin) {
  if (v == null || !band) return 'var(--fg-1)'
  const [lo, hi] = band
  if (v >= lo && v <= hi) return 'var(--ok)'
  if (v >= lo - margin && v <= hi + margin) return 'var(--warn)'
  return 'var(--danger)'
}
// giorno/notte dalla finestra luci del piano (serve per la banda temp giusta)
function isGiorno(luciOn, luciOff) {
  const hm = (s) => { if (!s) return null; const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes()
  let on = hm(luciOn), off = hm(luciOff)
  if (on == null || off == null) return true
  if (off === 0) off = 1440
  return on < off ? (nowMin >= on && nowMin < off) : (nowMin >= on || nowMin < off)
}

/* ── geometria dei grafici (SVG a mano, zero librerie) ──────────────── */
// Catmull-Rom → cubiche (design r.258): curva morbida senza overshoot.
function smoothPath(P) {
  if (!P.length) return ''
  if (P.length === 1) return `M${P[0][0]},${P[0][1]}`
  let d = `M${P[0][0]},${P[0][1]}`
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]}`
  }
  return d
}
// normalizza i punti grezzi: [[epoch_s|epoch_ms, val]] → [[epoch_s, val]]
function normPoints(points) {
  return (points || [])
    .map((p) => { const t = Number(p[0]); const v = Number(p[1]); return [t > 1e11 ? t / 1000 : t, v] })
    .filter((p) => isFinite(p[0]) && isFinite(p[1]))
    .sort((a, b) => a[0] - b[0])
}
// epoch_s dell'ULTIMO campione valido, o null. Serve a chiudere il dominio X
// sul dato reale invece che su "adesso": la centralina campiona a intervalli e
// far finire l'asse a now lascerebbe sempre un buco a destra (r.3 del brief).
function lastTs(points) {
  const src = normPoints(points)
  return src.length ? src[src.length - 1][0] : null
}
// points [[epoch_s, val]] → path/area + scala verticale. La x e' sul TEMPO
// (non sull'indice): serie con cadenze diverse restano allineate.
function buildSerie(points, t0, t1, band, w, h) {
  const src = normPoints(points)
  if (!src.length) return null
  const vals = src.map((p) => p[1])
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (band) { lo = Math.min(lo, band[0]); hi = Math.max(hi, band[1]) }
  // SERIE COSTANTE (es. vasca ferma a 100.0) o punto unico senza banda:
  // min == max → r = 0 → Y() = NaN → path "NaN,NaN" → linea invisibile.
  // Si allarga il dominio di ±2% del valore (minimo ±1) e la linea esce piatta
  // a meta' altezza invece di sparire.
  if (!(hi - lo > 0)) {
    const pad = Math.max(1, Math.abs(hi) * 0.02)
    lo -= pad; hi += pad
  }
  const span = hi - lo
  lo -= span * 0.08; hi += span * 0.08          // respiro: la linea non tocca i bordi
  const r = hi - lo
  const dt = (t1 - t0) || 1
  const X = (t) => +(Math.max(0, Math.min(1, (t - t0) / dt)) * w).toFixed(1)
  const Y = (v) => +(h - ((v - lo) / r) * h).toFixed(1)
  // un solo campione = sensore step-held che non e' MAI cambiato nella
  // finestra (il recorder da' una riga sola): il valore "tiene" per tutta la
  // finestra → linea piatta a tutta larghezza, non un dot solitario.
  const held = src.length === 1
    ? [[t0, src[0][1]], [t1, src[0][1]]]
    : src
  const pts = held.map((p) => [X(p[0]), Y(p[1])])
  const multi = pts.length > 1
  const path = multi ? smoothPath(pts) : ''
  return {
    lo, hi, X, Y, path, h,
    // punti normalizzati [[epoch_s, val]]: li legge il crosshair per trovare il
    // campione piu' vicino (il path e' gia' pixel, non ci si torna indietro)
    src,
    area: multi ? `${path} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z` : '',
    dot: multi ? null : { x: pts[0][0], y: pts[0][1] },
    last: vals[vals.length - 1],
    vMin: Math.min(...vals), vMax: Math.max(...vals),
    valAt: (f) => hi - f * r,   // etichette di griglia dall'alto verso il basso
  }
}
// campione [epoch_s, val] piu' vicino a t (src e' gia' ordinato per tempo)
function nearest(src, t) {
  let best = src[0]
  for (const p of src) { if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p }
  return best
}
// tick temporali "nice": passo che tiene ≤7 etichette. Sotto la settimana il
// passo e' in ORE (etichette "14:00", data a mezzanotte); sopra e' in GIORNI —
// con le sole ore, un mese di finestra produceva una tacca per ogni mezzanotte
// e trenta date accavallate sull'asse.
function timeTicks(t0, t1) {
  const hours = (t1 - t0) / 3600
  const perGiorni = hours > 168
  const out = []
  if (perGiorni) {
    const step = [1, 2, 3, 5, 7, 10, 14, 21, 30, 60].find((s) => (hours / 24) / s <= 7) || 60
    // si parte dalla PRIMA mezzanotte dentro la finestra e si conta di li': i
    // giorni si sommano con setDate, che assorbe da solo il cambio d'ora legale
    const cur = new Date(t0 * 1000); cur.setHours(0, 0, 0, 0)
    if (cur.getTime() / 1000 < t0) cur.setDate(cur.getDate() + 1)
    for (let i = 0; i < 400; i++) {
      const ts = cur.getTime() / 1000
      if (ts > t1) break
      if (i % step === 0) out.push({ frac: (ts - t0) / ((t1 - t0) || 1), label: dm(cur), day: true })
      cur.setDate(cur.getDate() + 1)
    }
  } else {
    const step = [1, 2, 3, 4, 6, 8, 12, 24].find((s) => hours / s <= 7) || 24
    const cur = new Date(t0 * 1000); cur.setMinutes(0, 0, 0)
    for (let i = 0; i < 200; i++) {
      const ts = cur.getTime() / 1000
      if (ts > t1) break
      if (ts >= t0 && cur.getHours() % step === 0) {
        const frac = (ts - t0) / ((t1 - t0) || 1)
        const day = cur.getHours() === 0
        out.push({ frac, label: day ? dm(cur) : `${p2(cur.getHours())}:00`, day })
      }
      cur.setHours(cur.getHours() + 1)
    }
  }
  // niente etichette sovrapposte (design: soglia 0.045; le date sono piu'
  // larghe degli orari, quindi vogliono piu' respiro)
  const soglia = perGiorni ? 0.075 : 0.045
  const ded = []
  out.forEach((t) => { if (!ded.some((x) => Math.abs(x.frac - t.frac) < soglia)) ded.push(t) })
  return ded.map((t) => ({
    ...t,
    pct: (t.frac * 100).toFixed(2),
    tf: t.frac < 0.04 ? 'translateX(6px)' : (t.frac > 0.96 ? 'translateX(calc(-100% - 6px))' : 'translateX(-50%)'),
  }))
}

/* ── crosshair: riga verticale + etichetta del campione piu' vicino ──────
   Overlay fatto in casa dentro il plot, NON un Hint: li' il bersaglio e' un
   elemento, qui e' una superficie continua e la bolla deve muoversi lungo la
   x. Vestito coerente col fumettino (mono 11px, hairline, r-8), classe
   dedicata .st-xh. Ne vive UNO solo alla volta in tutta la sezione. */
function Crosshair({ data }) {
  if (!data) return null
  const x = `${(data.left * 100).toFixed(2)}%`
  // ai bordi la bolla non esce dal plot: si appoggia al lato invece di centrarsi
  const lato = data.left < 0.18 ? ' bordo-sx' : (data.left > 0.82 ? ' bordo-dx' : '')
  return (
    <>
      <div className="st-xh-line" style={{ left: x }} />
      {data.rows.map((r) => (
        <span key={r.k} className="st-xh-pin" style={{
          left: x, top: `calc((100% - var(--st-axis)) * ${r.fy.toFixed(4)})`, background: r.accent,
        }} />
      ))}
      <div className={'st-xh' + lato} style={{ left: x }}>
        <span className="st-xh-t mono">{data.ora}</span>
        {data.rows.map((r) => (
          <span key={r.k} className="st-xh-v mono" style={{ color: r.accent }}>{r.txt}</span>
        ))}
      </div>
    </>
  )
}

/* ── dettaglio di un componente: overlay in sola lettura ─────────────────
   Non e' un doppione del pannello di Controllo: e' la scheda RAPIDA che la
   riga compatta non riesce a dire in una frase sola. Nessun comando, nessuna
   scrittura — chi vuole agire scende in Controllo dal link in fondo. */

// Comportamento comune delle modali: Escape chiude, il fondo non scorre.
// Copia locale di useModal (App.jsx, 10 righe): importarlo da App creerebbe
// il ciclo App → Stato → App, stesso motivo di callService e Icon.
// La callback arriva ricreata a ogni render → vive in un ref, cosi' l'effetto
// monta una volta sola invece di rifare add/remove del listener a ogni giro.
function useModalLocal(onClose) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [])
}

function CompDetail({ comp, rows, onClose, onGo }) {
  useModalLocal(onClose)
  // il focus entra nel pannello all'apertura (torna sulla riga alla chiusura,
  // vedi chiudiDet in Stato): senza, il tab dopo l'apertura ripartirebbe da
  // capo alla pagina, che sotto la modale non e' nemmeno raggiungibile
  const boxRef = useRef(null)
  useEffect(() => { if (boxRef.current) boxRef.current.focus() }, [])
  return (
    <div className="st-det-overlay" role="dialog" aria-modal="true"
      aria-label={`Dettaglio ${comp.label}`} onClick={onClose}>
      <div className="st-det" ref={boxRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="st-det-head">
          <span className="st-comp-disc" style={{ background: comp.disc }}>
            <Icon path={comp.icon} size={18} color="var(--ink)" />
          </span>
          <div className="st-det-tit">
            <b>{comp.label}</b>
            <span>{comp.stato}</span>
          </div>
          {/* il badge sta QUI e non fra le righe: la modalita' e' una
              proprieta' del componente, non uno dei suoi valori */}
          {comp.badge && <span className={'st-badge' + (comp.man ? ' man' : '')}>{comp.badge}</span>}
          <button type="button" className="st-det-x" aria-label="Chiudi" onClick={onClose}>
            <Icon path={mdiClose} size={19} />
          </button>
        </div>
        <div className="st-det-body">
          {rows.length ? rows.map((r) => (
            <div className="st-kv" key={r.k}>
              <span className="st-kv-txt st-kv-k">{r.k}</span>
              <span className="st-kv-v mono">{r.v}</span>
            </div>
          )) : (
            <div className="st-det-vuoto">Nessun dettaglio disponibile per questo componente.</div>
          )}
        </div>
        <div className="st-det-foot">
          <button type="button" className="st-det-go" onClick={onGo}>
            <Icon path={mdiTuneVertical} size={16} />
            Apri in Controllo
            <Icon path={mdiChevronRight} size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   COMPONENTE
   ══════════════════════════════════════════════════════════════════════ */
// onToast: il toast globale del Piano (pill verde in basso al centro). REGOLA
// GENERALE dell'app: ogni messaggio transitorio passa di li', mai testo inline
// che compare e sparisce sotto il controllo.
// onFocus: sceglie il pannello di Controllo prima di navigarci (Fase 3). Lo
// stato vive in App, non qui: e' la stessa informazione per due sezioni.
export default function Stato({ attiva, onNav, onFocus, model, onToast }) {
  const [stato, setStato] = useState(null)        // payload api/stato
  const [statoErr, setStatoErr] = useState(null)
  const [range, setRange] = useState(12)          // ore, o COLTURA (default come il design)
  const [hist, setHist] = useState({})            // { chiave: { pts, min, max } }
  const [histErr, setHistErr] = useState(null)
  const [histWin, setHistWin] = useState(null)    // [t0,t1] della finestra disegnata
  const [histRes, setHistRes] = useState(null)    // 'raw' | 'hourly' | 'daily'
  const [files, setFiles] = useState(null)        // archivio foto (piu' recente in testa)
  const [fotoIdx, setFotoIdx] = useState(0)
  const [imgErr, setImgErr] = useState(false)
  const [scattoArm, setScattoArm] = useState(false)   // "Scatta ora": 1° tap = arma
  const [scattoBusy, setScattoBusy] = useState(false)
  const [resetArm, setResetArm] = useState(false)     // "Azzera errore": idem
  const [resetBusy, setResetBusy] = useState(false)
  const [det, setDet] = useState(null)                // chiave del componente aperto
  const detBtn = useRef(null)                         // riga da cui si e' aperto
  const armT = useRef(null)
  const resetT = useRef(null)
  useEffect(() => () => { clearTimeout(armT.current); clearTimeout(resetT.current) }, [])
  // uscendo dalla sezione un comando armato non deve restare armato: al
  // ritorno il primo tap eseguirebbe senza conferma (stessa regola di Controllo).
  // AUDIT R1 (M-10): il disarmo vale per ENTRAMBI i comandi armati, come il
  // commento qui sopra dichiara — prima lo scatto foto restava armato.
  // il dettaglio di un componente non sopravvive all'uscita dalla sezione:
  // tornando qui si troverebbe una modale aperta su niente
  useEffect(() => {
    setResetArm(false); clearTimeout(resetT.current)
    setScattoArm(false); clearTimeout(armT.current)
    setDet(null)
  }, [attiva])
  // indice e archivio foto leggibili dal tick del refresh senza rilegare l'effetto
  const fotoIdxRef = useRef(0)
  useEffect(() => { fotoIdxRef.current = fotoIdx }, [fotoIdx])
  const filesRef = useRef(null)
  useEffect(() => { filesRef.current = files }, [files])

  const entities = stato?.entities || null
  const ids = useMemo(() => resolveIds(entities), [entities])

  /* ── api/stato: 60s, solo a sezione attiva e scheda visibile ──────── */
  const loadStato = useCallback(() => fetch('api/stato')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then((j) => { setStato(j); setStatoErr(null) })
    .catch((e) => setStatoErr(String(e.message || e))), [])

  useEffect(() => {
    if (!attiva) return undefined
    // Il PRIMO caricamento non guarda document.hidden (come load({initial})
    // del Piano): l'iframe di HA puo' essere "hidden" mentre l'utente ha la
    // sezione davanti, e resterebbe vuota. I tick successivi sono gia' gratis.
    loadStato()
    const tick = () => { if (!document.hidden) loadStato() }
    const iv = setInterval(tick, STATO_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [attiva, loadStato])

  /* ── api/history: al cambio range + ogni 5 min ────────────────────── */
  // Le 4 serie hanno id risolti dal payload: finche' api/stato non ha
  // risposto almeno una volta non si sa cosa chiedere → si aspetta.
  const histKey = [ids.temp, ids.rh, ids.vpd, ids.vasca].join('|')
  useEffect(() => {
    if (!attiva) return undefined
    const wanted = { temp: ids.temp, rh: ids.rh, vpd: ids.vpd, vasca: ids.vasca }
    if (!Object.values(wanted).some(Boolean)) return undefined
    let vivo = true
    let primo = true
    const tick = () => {
      if (document.hidden && !primo) return
      primo = false
      const t1 = Math.floor(Date.now() / 1000)
      Promise.all(Object.entries(wanted).map(([k, id]) => {
        if (!id) return Promise.resolve([k, null])
        return fetch(`api/history?entity=${encodeURIComponent(id)}&hours=${range}`)
          .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
          // min/max arrivano dal backend, calcolati sui punti GREZZI: il
          // downsample a medie lima i picchi, e ricavarli dai punti disegnati
          // mostrerebbe un estremo che nella finestra non e' mai stato letto.
          .then((j) => [k, { pts: j.points || [], min: j.min, max: j.max, start: j.start, res: j.res }])
          .catch(() => [k, null])
      })).then((pairs) => {
        if (!vivo) return
        const next = {}
        pairs.forEach(([k, v]) => { next[k] = v })
        setHist(next)
        // La finestra la DICHIARA il backend: la durata di "coltura" dipende
        // dalla data di semina, che qui non si conosce. Ripiego sulla stima
        // locale solo se nessuna delle quattro risposte e' arrivata.
        const ok = pairs.map(([, v]) => v).find((v) => v && v.start != null)
        setHistWin([ok ? ok.start : t1 - oreDi(range) * 3600, t1])
        setHistRes(ok ? ok.res : null)
        setHistErr(pairs.every(([, v]) => v == null) ? 'storico non disponibile' : null)
      })
    }
    tick()
    const iv = setInterval(tick, HIST_POLL_MS)
    return () => { vivo = false; clearInterval(iv) }
    // histKey rappresenta gli id risolti: cambia solo quando cambiano davvero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attiva, range, histKey])

  /* ── api/foto/list: una volta all'attivazione + refresh soft ──────── */
  useEffect(() => {
    if (!attiva) return undefined
    let vivo = true
    let primo = true
    const tick = () => {
      if (document.hidden && !primo) return
      primo = false
      fetch('api/foto/list')
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((j) => {
          if (!vivo) return
          const arr = Array.isArray(j.files) ? j.files : []
          // refresh soft: si resta sulla foto che si sta guardando; se e'
          // sparita dall'archivio si torna alla piu' recente.
          // AUDIT R1 (M-11): il riposizionamento sta FUORI dall'updater di
          // setFiles — un side effect dentro un reducer viene eseguito due
          // volte in StrictMode. La foto corrente si legge dal ref, che e'
          // gia' l'indice vivo.
          const cur = filesRef.current && filesRef.current[fotoIdxRef.current]
          if (cur) {
            const i = arr.indexOf(cur)
            setFotoIdx(i >= 0 ? i : 0)
          }
          setFiles(arr)
        })
        .catch(() => { if (vivo) setFiles((prev) => (prev == null ? [] : prev)) })
    }
    tick()
    const iv = setInterval(tick, HIST_POLL_MS)
    return () => { vivo = false; clearInterval(iv) }
  }, [attiva])
  useEffect(() => { setImgErr(false) }, [fotoIdx, files])

  /* ── stati globali della sezione ──────────────────────────────────── */
  const fetched = toDate(stato?.fetched)
  // api/stato mai risposta (backend vecchio → 404): tutto a '—', niente crash
  const noData = !entities
  const onlineRaw = stOf(entities, ids.online)
  // offline = il bridge dice esplicitamente di no. Payload assente NON e'
  // "offline": e' "dati non disponibili" (banner diverso, piu' onesto).
  const off = has(onlineRaw) ? !isOn(onlineRaw) && onlineRaw !== 'online' : false
  // (stato coltivazione: il banner globale di App copre il caso "spenta";
  // qui non serve piu' un flag locale)
  const acquaBassa = isOn(stOf(entities, ids.acquaBassa))
  // discordanze attesa/realta' (latch alzati da HA, >10 min fuori programma)
  const discLuci = isOn(stOf(entities, ids.discLuci))
  const discAcqua = isOn(stOf(entities, ids.discAcqua))
  const discVentole = isOn(stOf(entities, ids.discVentole))
  const erroreComp = (() => { const s = stOf(entities, ids.errore); return has(s) && s !== '-' ? s : null })()
  const dim = off || noData ? DIM_OFF : '1'

  // freschezza: sensore dedicato se c'e', altrimenti il last_changed piu'
  // recente fra i sensori clima, altrimenti il `fetched` del payload.
  // `stale` (aspetto pesca + icona d'allarme) SOLO se il bridge si dichiara
  // offline o se l'eta' supera STALE_MIN: sotto quella soglia il silenzio e'
  // il duty-cycle wifi, e il pill resta grigio come gli altri.
  const freschezza = useMemo(() => {
    const cand = [
      toDate(stOf(entities, ids.freschezza)),
      ...[ids.temp, ids.rh, ids.vpd].map((id) => toDate(entOf(entities, id)?.last_changed)),
    ].filter(Boolean)
    const d = cand.sort((a, b) => b - a)[0] || fetched
    if (!d) {
      return { label: null, stale: true, min: null, info: 'Nessun contatto registrato: la centralina non ha ancora risposto da quando l’app e’ aperta.' }
    }
    const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
    const vecchio = min > STALE_MIN
    const info = off
      ? `Centralina offline: nessun contatto da ${min} min (ultimo alle ${hhmm(d)}). Possibile problema di alimentazione o wifi.`
      : (vecchio
        ? `Nessun contatto da ${min} min (ultimo alle ${hhmm(d)}): possibile problema di alimentazione o wifi.`
        : `La centralina accende il wifi a intervalli per risparmiare: ultimo contatto alle ${hhmm(d)}. Normale fino a ${STALE_MIN} min.`)
    return { label: `Aggiornato ${fromNow(d)}`, stale: off || vecchio, when: d, min, info }
  }, [entities, ids, fetched, off])

  /* ── bande ideali: dal piano (model), come fa l'header ────────────── */
  const giorno = isGiorno(model?.luciOn, model?.luciOff)
  const tempStr = (!giorno && model?.clima?.tempTargetNotte) ? model.clima.tempTargetNotte : model?.clima?.tempTarget
  const bands = {
    temp: parseBand(tempStr),
    rh: parseBand(model?.clima?.rhTarget),
    vpd: parseBand(model?.clima?.vpdTarget),
    // AUDIT R1 (I-5): il fondo della banda vasca e' la SOGLIA VERA
    // dell'allarme (input_number.serra_acqua_soglia_pct, regolabile in
    // Impostazioni · Notifiche), non un 40 cablato: cosi' il grafico e
    // l'«ideale N–100 %» sotto di lui dicono lo stesso numero a cui scatta
    // l'allarme. 15 e' il valore di default dell'helper, usato solo se
    // l'entita' non e' leggibile.
    vasca: [Math.round(numOf(entities, ids.sogliaAcqua) ?? 15), 100],
  }
  const margins = { temp: 2, rh: 7, vpd: 0.3, vasca: 5 }

  /* ── valori correnti ──────────────────────────────────────────────── */
  const cur = {
    temp: numOf(entities, ids.temp),
    rh: numOf(entities, ids.rh),
    vpd: numOf(entities, ids.vpd),
    vasca: numOf(entities, ids.vasca),
  }
  const fmtVal = (k, v) => (v == null ? EM : `${v.toFixed(SERIE[k].dec)} ${SERIE[k].unit}`)
  /* AUDIT R2 (M-R2-11): a centralina muta anche il COLORE del valore torna
     neutro. Prima si spegneva il solo pallino e restava un numero verde "in
     banda" accanto a un puntino grigio "non lo so": due verdetti opposti sullo
     stesso dato. --fg-1 e' lo stesso colore che bandColor da' quando la banda
     non c'e', cioe' il colore del "nessun giudizio". */
  // AUDIT R4 (M-R4-1): con l'allarme acqua attivo la vasca e' ROSSA anche qui,
  // come in Controllo — la banda da sola resterebbe tiepida (ambra) a 12%.
  const colBanda = (k, v, band) => (k === 'vasca' && acquaBassa ? 'var(--errore)' : bandColor(v, band, margins[k]))
  const colVal = (k, v, band) => (off ? 'var(--fg-1)' : colBanda(k, v, band))

  /* ── serie disegnate ──────────────────────────────────────────────── */
  const [t0, t1] = histWin || [Math.floor(Date.now() / 1000) - oreDi(range) * 3600, Math.floor(Date.now() / 1000)]
  // Il dominio X di OGNI grafico finisce sul suo ultimo campione, non su now:
  // altrimenti (campionamento a intervalli) la linea si ferma prima del bordo
  // destro mentre a sinistra parte attaccata. Fallback a t1 se la serie e'
  // vuota o se l'ultimo punto e' fuori finestra.
  const fine = (...keys) => {
    const ts = keys.map((k) => lastTs(hist[k]?.pts)).filter((x) => x != null && x > t0 && x <= t1)
    return ts.length ? Math.max(...ts) : t1
  }
  const tMain = fine('temp', 'rh')
  const tVpd = fine('vpd')
  const tVasca = fine('vasca')
  const ticksMain = useMemo(() => timeTicks(t0, tMain), [t0, tMain])
  const ticksVpd = useMemo(() => timeTicks(t0, tVpd), [t0, tVpd])
  const ticksVasca = useMemo(() => timeTicks(t0, tVasca), [t0, tVasca])
  const mk = (k, tEnd, w, h) => buildSerie(hist[k]?.pts, t0, tEnd, bands[k], w, h)
  const sTemp = mk('temp', tMain, MAIN_W, MAIN_H)
  const sRh = mk('rh', tMain, MAIN_W, MAIN_H)
  const sVpd = mk('vpd', tVpd, MINI_W, MINI_H)
  const sVasca = mk('vasca', tVasca, MINI_W, MINI_H)

  /* ── min/max della finestra (riga sotto alla banda ideale) ───────────
     Valori ASCIUTTI: niente unita' ripetuta, la dice gia' la riga sopra
     ("ideale 22–28 °C") e il valore grande accanto. Riga assente quando lo
     storico non c'e': un "min — · max —" sarebbe rumore. */
  const mm = (k, s) => {
    const h = hist[k]
    const lo = h && h.min != null ? h.min : (s ? s.vMin : null)
    const hi = h && h.max != null ? h.max : (s ? s.vMax : null)
    if (lo == null || hi == null) return null
    const d = SERIE[k].dec
    // serie ferma (vasca piena, sensore step-held): "min 100 · max 100" e' un
    // giro di parole per dire una cosa sola
    if (lo === hi) return `costante ${lo.toFixed(d)}`
    return `min ${lo.toFixed(d)} · max ${hi.toFixed(d)}`
  }
  const mmBig = { temp: mm('temp', sTemp), rh: mm('rh', sRh) }

  /* ── crosshair (hover desktop / tap touch) ───────────────────────────
     Le misure si prendono SOLO dentro l'handler dell'evento, mai al mount:
     la sezione puo' nascere mentre la scheda e' nascosta e li'
     getBoundingClientRect torna zeri (stesso gotcha del Piano). */
  const [xh, setXh] = useState(null)     // { plot, left, ora, rows[] }
  // finestra cambiata o storico rinfrescato: un'etichetta ferma direbbe un
  // valore che sotto non c'e' piu'
  useEffect(() => { setXh(null) }, [attiva, range, hist])
  const xhOn = !!xh
  useEffect(() => {
    if (!xhOn) return undefined
    // tap fuori chiude (touch); lo scroll chiude sempre — il contenuto scorre
    // sotto al puntatore e la riga resterebbe appesa a una x che non e' piu'
    // quella. Su desktop il primo movimento del mouse la riapre da sola.
    const fuori = (e) => { if (!(e.target && e.target.closest && e.target.closest('.st-xh-hit'))) setXh(null) }
    const via = () => setXh(null)
    window.addEventListener('pointerdown', fuori, true)
    window.addEventListener('scroll', via, true)
    return () => {
      window.removeEventListener('pointerdown', fuori, true)
      window.removeEventListener('scroll', via, true)
    }
  }, [xhOn])
  // `serie` = [[chiave, serieDisegnata], …]: la PRIMA fa da guida (temp e
  // umidita' arrivano dallo stesso messaggio della centralina, stessa cadenza).
  const xhMove = (plot, tEnd, serie) => (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (!box.width) return
    const list = serie.filter(([, s]) => s && s.src.length)
    if (!list.length) return
    const dt = (tEnd - t0) || 1
    const fx = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width))
    const guida = list[0][1].src
    const g = nearest(guida, t0 + fx * dt)
    // la riga si POSA sul campione piu' vicino: il valore letto e' un dato
    // vero, non un punto interpolato. Con una sola lettura nella finestra
    // (serie step-held, linea piatta) non c'e' niente su cui posarsi: la riga
    // resta sotto il puntatore e l'etichetta dichiara l'ora vera del campione.
    const left = guida.length > 1 ? Math.max(0, Math.min(1, (g[0] - t0) / dt)) : fx
    const d = new Date(g[0] * 1000)
    setXh({
      plot,
      left,
      // finestra lunga: senza la data "14:20" non dice di quale giorno. Sulle
      // medie GIORNALIERE l'ora non esiste proprio (il punto e' l'intero
      // giorno): si mostra la sola data.
      ora: histRes === 'daily' ? dm(d) : ((t1 - t0) > 86400 ? `${dm(d)} · ${hhmm(d)}` : hhmm(d)),
      rows: list.map(([k, s]) => {
        const p = nearest(s.src, g[0])
        return {
          k, accent: SERIE[k].accent,
          txt: `${p[1].toFixed(SERIE[k].dec)} ${SERIE[k].unit}`,
          fy: Math.max(0, Math.min(1, s.Y(p[1]) / s.h)),
        }
      }),
    })
  }
  // desktop: segue il mouse. touch: il tap mostra (il pointerdown globale qui
  // sopra chiude quando il dito fa altro). Niente librerie, niente listener
  // registrati al mount.
  const xhHit = (plot, tEnd, serie) => {
    const move = xhMove(plot, tEnd, serie)
    return {
      className: 'st-xh-hit',
      onPointerMove: (e) => { if (e.pointerType === 'mouse') move(e) },
      onPointerDown: (e) => { if (e.pointerType !== 'mouse') move(e) },
      // si chiude solo il proprio: passando da un grafico all'altro il
      // pointerleave del primo arriva dopo l'apertura del secondo
      onPointerLeave: (e) => { if (e.pointerType === 'mouse') setXh((p) => (p && p.plot === plot ? null : p)) },
    }
  }
  const xhOf = (plot) => (xh && xh.plot === plot ? xh : null)

  /* ── banner (ordine di priorità del brief) ────────────────────────── */
  const banners = []
  if (noData) banners.push({ k: 'nodata', icon: mdiAlertOutline, tone: 'neutro', title: 'Dati di stato non disponibili', sub: statoErr ? `La centralina non risponde (${statoErr}) · valori non aggiornati` : 'Nessuna risposta dal sistema · valori non aggiornati' })
  else if (off) banners.push({ k: 'off', icon: mdiWifiOff, tone: 'errore', title: 'Centralina offline', sub: `Ultimo contatto ${fromNow(freschezza.when) || 'sconosciuto'} · dati non aggiornati, comandi bloccati` })
  // coltivazione spenta: NIENTE banner qui — App mostra gia' il
  // .conclusa-banner globale sopra la nav (doppione altrimenti)
  if (acquaBassa) banners.push({ k: 'acqua', icon: mdiWaterAlert, tone: 'ambra', title: 'Acqua bassa', sub: 'Rabboccare la vasca: i ricircoli restano sospesi' })
  // discordanze attesa/realta' (piano avvisi 03/08): si spengono da sole al
  // rientro — nessuna azione qui, la diagnosi si fa in Controllo
  if (discLuci) banners.push({ k: 'discluci', icon: mdiLightbulbOn, tone: 'ambra', title: 'Luci fuori programma', sub: 'Il pannello non segue la finestra oraria da oltre 10 minuti' })
  if (discAcqua) banners.push({ k: 'discacqua', icon: mdiWaterSync, tone: 'ambra', title: 'Ricircolo non partito', sub: 'L’ultimo ricircolo registrato è precedente all’orario in programma' })
  if (discVentole) banners.push({ k: 'discvent', icon: mdiFan, tone: 'ambra', title: 'Ventole fuori programma', sub: 'I livelli comandati non risultano applicati da oltre 10 minuti' })
  // L'errore pendente e' l'unico banner con un'AZIONE: dichiarare un guasto
  // senza offrire la via d'uscita lascia l'anello rosso e nessun modo di
  // spegnerlo. Il bottone vive nel banner stesso (vedi RESET_SCRIPT).
  if (erroreComp) banners.push({ k: 'err', icon: mdiAlertCircleOutline, tone: 'errore', title: 'Errore pendente', sub: `Componente fallito: ${erroreComp} · l’anello resta rosso finché non si azzera`, reset: true })

  /* ── righe componenti ─────────────────────────────────────────────── */
  const compRows = COMP.map((c) => {
    const id = ids[c.ent]
    const s = stOf(entities, id)
    // Badge PIANO/LIBERO: prima gli attributi del sensore componente (nomi
    // possibili finche' il backend non li fissa), poi il modo gia' noto
    // all'app (input_boolean.serra_schedule_*, via model.modo).
    // TODO DA-RACCORDARE: quando il sensore espone l'attributo definitivo,
    // lasciare solo quello e cancellare il fallback su model.modo.
    const a = entOf(entities, id)?.attributes || {}
    let man = null
    for (const key of ['modo', 'mode', 'modalita']) {
      if (a[key] != null) { man = /man/i.test(String(a[key])); break }
    }
    if (man == null && a.auto != null) man = !(a.auto === true || isOn(String(a.auto)))
    if (man == null && model?.modo && c.k in model.modo) man = !model.modo[c.k]
    return {
      ...c,
      stato: (off || !has(s)) ? EM : s,
      // niente badge se il modo non e' derivabile: meglio omettere che mentire
      badge: man == null ? null : (man ? 'LIBERO' : 'PIANO'),
      man: !!man,
    }
  })

  /* ── dettaglio di un componente (pannello in overlay) ────────────────────
     DUE REGOLE, diverse fra loro e valide per tutte e cinque le schede:
      · dato che NON c'e' (sensore assente, attributo non pubblicato) → la
        riga non compare affatto: una riga a trattino e' rumore, non onesta';
      · centralina muta (`off`) → i valori PUBBLICATI DAL BRIDGE passano a '—',
        perche' non li stiamo piu' garantendo, mentre quelli che vivono negli
        helper di HA (soglie, rampa, finestra del piano) restano leggibili:
        sono veri anche a serra spenta. E' la stessa distinzione di Controllo.
     Il sottotitolo della testata e' gia' la frase del sensore-componente:
     qui non si ripete cio' che quella dice (regola dei valori asciutti). */
  const faseCur = model?.fasi ? model.fasi.find((f) => f.current) : null
  const dettaglio = (k) => {
    const oOff = (v) => (off ? EM : v)   // valore del bridge a centralina muta
    const out = []
    const add = (kk, v) => { if (v != null && v !== '') out.push({ k: kk, v }) }

    if (k === 'luci') {
      const ch = attrOf(entities, ids.luciStato, 'channels')
      const accesi = (ch && typeof ch === 'object') ? CH.filter((c) => (+ch[c] || 0) > 0) : []
      const inten = numOf(entities, ids.luciInt)
      const sched = stOf(entities, ids.luciSched)
      const rampa = numOf(entities, ids.luciRampa)
      const on = faseCur?.luciFinestraOn || model?.luciOn || null
      const offOra = faseCur?.luciFinestraOff || model?.luciOff || null
      const ore = faseCur?.luciOre != null ? Math.round(faseCur.luciOre) : null
      // mix: solo i canali accesi, come in Controllo — a canali tutti a zero la
      // riga sparisce (le luci sono spente, lo dice gia' la testata)
      if (accesi.length) add('Mix canali', oOff(accesi.map((c) => `${c} ${Math.round(+ch[c])}`).join(' · ')))
      if (inten != null) add('Intensità', oOff(`${Math.round(inten)} %`))
      if (on && offOra) add('Finestra luci', `${on} → ${offOra}${ore ? ` (${ore}/${24 - ore})` : ''}`)
      // e' una LETTURA (cosa prevede la finestra oraria adesso), non un comando
      if (has(sched)) add('Da programma ora', oOff(isOn(sched) ? 'Acceso' : 'Spento'))
      if (rampa != null) add('Rampa alba/tramonto', `${Math.round(rampa)} min`)
    }

    if (k === 'acqua') {
      const liv = numOf(entities, ids.vasca)
      const lt = stOf(entities, ids.litri)
      const pRun = stOf(entities, ids.pompaRun)
      const pSt = stOf(entities, ids.pompaStato)
      // divergenza #3: vale `running_now` se c'e', altrimenti lo stato dichiarato
      const pOn = has(pRun) ? isOn(pRun) : (has(pSt) ? isOn(pSt) : null)
      const pSec = numOf(entities, ids.pompaSec)
      const pFine = toDate(stOf(entities, ids.pompaFine))
      const soglia = numOf(entities, ids.sogliaAcqua)
      if (liv != null) add('Livello vasca', oOff(`${Math.round(liv)} %${has(lt) ? ` · ${lt} L` : ''}`))
      if (pOn != null) {
        add('Pompa', oOff(pOn
          ? `In moto${pSec ? ` · ${pSec} s` : ''}${pFine ? ` · fino alle ${hhmm(pFine)}` : ''}`
          : 'Ferma'))
      }
      if (soglia != null) add('Allarme sotto', `${Math.round(soglia)} %`)
      if (dRic) add('Ultimo ricircolo', oOff(whenLabel(dRic)))
      if (dCambio) add('Ultimo cambio acqua', oOff(`${dm(dCambio)} · ${fromNow(dCambio)}`))
    }

    if (k === 'nutrienti') {
      // la dose e' gia' risolta dal sensore: lo stato e' la riga in chiaro,
      // l'attributo `dose` porta i millilitri per la vasca REALE
      const doseTxt = stOf(entities, ids.dose)
      const d = attrOf(entities, ids.dose, 'dose')
      const ml = (d && typeof d === 'object')
        ? [['R', d.grow_ml_vasca], ['G', d.micro_ml_vasca], ['B', d.bloom_ml_vasca]].filter((x) => x[1] != null)
        : []
      const dNutr = toDate(stOf(entities, ids.nutrUltimo))
      const boost = stOf(entities, ids.booster)
      if (has(doseTxt)) add('Dose di fase', doseTxt)
      if (ml.length) {
        const lt = (d && d.vasca_litri) || (model?.vasca?.litri || model?.vasca?.capacita) || null
        add(`In vasca${lt ? ` (${String(lt).replace('.', ',')} L)` : ''}`,
          `${ml.map(([c, v]) => `${c} ${v}`).join(' · ')} ml`)
      }
      if (d && typeof d === 'object' && has(d.ec)) add('EC attesa', String(d.ec))
      if (dNutr) add('Ultima erogazione', oOff(`${dm(dNutr)} · ${fromNow(dNutr)}`))
      if (has(boost)) add('Prossimo booster', boost)
    }

    if (k === 'ventole') {
      // livelli dallo STATO pubblicato dal bridge, non dagli input_select che
      // li comandano (divergenza #3). Un livello fuori dai quattro noti si
      // mostra grezzo invece di far cadere la riga.
      const lab = (id) => { const s = stOf(entities, id); return has(s) ? (LIVELLO_LAB[s] || s) : null }
      const v1 = lab(ids.fan1Lv), v2 = lab(ids.fan2Lv), vf = lab(ids.fanFLv)
      const auto = lab(ids.ventAuto)
      const filtro = stOf(entities, ids.filtro)
      if (v1) add('Ventola 1', oOff(v1))
      if (v2) add('Ventola 2', oOff(v2))
      if (vf) add('Frontale', oOff(vf))
      if (auto) add('Livello automatico', auto)
      if (has(filtro)) add('Filtro odori', isOn(filtro) ? 'Acceso' : 'Spento')
    }

    if (k === 'ring') {
      const st = stOf(entities, ids.ringStato)
      const hex = stOf(entities, ids.ringColore)
      const nome = has(hex) ? (RING_HEX[String(hex).toLowerCase().replace('#', '')] || `#${String(hex).toUpperCase()}`) : null
      const acceso = has(st) ? (st !== 'off' && nome !== 'spento') : null
      const fade = numOf(entities, ids.ringFade)
      const sel = stOf(entities, ids.ringSel)
      const ultimo = toDate(stOf(entities, ids.ringUltimo))
      // colore REALMENTE acceso, cosi' come lo pubblica la centralina
      if (acceso != null) add('Colore acceso', oOff(acceso ? capFirst(nome) : 'Spento'))
      if (fade != null) add('Fade', `${Math.round(fade)} s`)
      // in Pianificato il colore lo sceglie il semaforo: l'helper direbbe una
      // cosa che sull'anello non si vede, quindi la riga esiste solo in Libero
      const cRing = compRows.find((c) => c.k === 'ring')
      if (cRing && cRing.man && has(sel)) add('Colore impostato', sel)
      if (ultimo) add('Ultimo comando', oOff(whenLabel(ultimo)))
    }
    return out
  }
  const detComp = det ? compRows.find((c) => c.k === det) : null
  // chiusura: il focus torna sulla riga da cui si e' aperto il pannello
  const chiudiDet = () => { setDet(null); if (detBtn.current) detBtn.current.focus() }

  /* ── centralina ───────────────────────────────────────────────────── */
  // "Ultimo avvio": calcolato da now − uptime (vedi useBootTime). Un hook per
  // riga — lo stato che smorza l'oscillazione e' per-sensore.
  const bootSerra = useBootTime(stOf(entities, ids.uptimeSerra))
  const bootPi = useBootTime(stOf(entities, ids.uptimePi))
  // ripiego della SOLA serra: il sensore gia' testuale ("Ultimo avvio: 15/07").
  // AUDIT R1 (I-4): tolto l'anello intermedio sull'attributo `ultimo_avvio`,
  // che nessun sensore pubblica e che il backend filtra comunque
  // (STATO_ATTR_KEYS). Il primo anello — now − uptime — funziona gia'.
  // Per il Pi non c'e' nulla → il sub si omette (meglio niente che un'invenzione).
  const subAvvioSerra = avvioLabel(bootSerra)
    || (() => { const s = stOf(entities, ids.avvioSerra); return has(s) ? String(s) : null })()
  /* Wifi della serra: l'unico dato reale e' sensor.serra_net_state (on/off) col
     suo attributo ts_local. NIENTE potenza del segnale: il firmware pubblica
     serra/state/net con enabled/ntp/ts e basta, un RSSI qui sarebbe inventato.
     La riga dice quindi le due cose che si sanno davvero: se il wifi e' acceso
     ADESSO, e quando c'e' stato l'ultimo collegamento. `off` (bridge muto) ha
     la precedenza: li' anche net_state e' un dato vecchio.
     Ripiego di ts_local: il last_changed del sensore, cioe' l'istante in cui il
     wifi si e' spento — la stessa cosa detta dall'altro capo. */
  const netSt = stOf(entities, ids.net)
  const netOn = isOn(netSt)
  const netTs = toDate(attrOf(entities, ids.net, 'ts_local'))
    || (has(netSt) ? toDate(entOf(entities, ids.net)?.last_changed) : null)
  const centralina = [
    {
      icon: off || (has(netSt) && !netOn) ? mdiWifiOff : mdiWifi, k: 'Wifi serra', warn: off,
      v: off ? 'Spento' : (has(netSt) ? (netOn ? 'Acceso adesso' : 'A intervalli') : EM),
      // il sub compare solo quando aggiunge qualcosa: a wifi acceso il valore
      // ha gia' detto tutto. Contestualizza "A intervalli", che da solo non
      // direbbe se l'ultima finestra e' di dieci minuti fa o di ieri.
      sub: (!off && has(netSt) && !netOn && netTs) ? `Ultimo collegamento: ${whenLabel(netTs)}` : null,
    },
    {
      icon: mdiRestart, k: 'Serra accesa da',
      v: off ? EM : (uptimeLabel(stOf(entities, ids.uptimeSerra)) || EM),
      // a centralina offline il valore e' '—': un "Ultimo avvio" sotto un
      // trattino direbbe una cosa che non stiamo piu' garantendo → via anche il sub
      sub: off ? null : subAvvioSerra,
    },
    {
      icon: mdiRaspberryPi, k: 'Raspberry Pi acceso da',
      v: uptimeLabel(stOf(entities, ids.uptimePi)) || EM,
      sub: avvioLabel(bootPi),
    },
    {
      // orologio, MAI wifi barrata: se il bridge risponde il silenzio e' il
      // duty-cycle, non un problema di rete.
      icon: freschezza.stale ? mdiClockAlertOutline : mdiClockCheckOutline, k: 'Dati aggiornati',
      warn: freschezza.stale,
      v: freschezza.label ? `${off ? 'Offline' : 'Online'} · ${fromNow(freschezza.when)}` : EM,
      // il sub resta (pattern voluto: contestualizza un valore poco chiaro);
      // l'altezza non sfonda piu' perche' .st-kv ha una min-height uniforme.
      sub: 'Freschezza dei dati dalla centralina',
      info: freschezza.info,
    },
  ]
  const dRic = toDate(stOf(entities, ids.ricircolo))
  const dCambio = toDate(stOf(entities, ids.cambioAcqua))
  const ultimi = [
    // AUDIT R1 (I-4): niente suffisso «· N s» — l'attributo `durata` non e'
    // pubblicato dal sensore e non e' in allow-list: non compariva mai.
    { icon: mdiWaterSync, label: 'Ultimo ricircolo', v: off || !dRic ? EM : whenLabel(dRic) },
    { icon: mdiCupWater, label: 'Ultimo cambio acqua', v: off || !dCambio ? EM : `${dm(dCambio)} · ${fromNow(dCambio)}` },
  ]

  /* ── foto ─────────────────────────────────────────────────────────── */
  // Fallback: se api/foto/list non risponde si prova l'attributo `files`
  // di sensor.serra_foto_archivio (stessa lista, sorgente diversa).
  const archAttr = attrOf(entities, ids.fotoArch, 'files')
  const fotoFiles = (files && files.length ? files : (Array.isArray(archAttr) ? archAttr : [])) || []
  const nFoto = fotoFiles.length
  const idx = Math.min(fotoIdx, Math.max(0, nFoto - 1))
  const fotoName = nFoto ? fotoFiles[idx] : null
  // Data/ora SEMPRE dal nome file (YYYY-MM-DD_HHMM.jpg → "01/08/2026 alle 16:20").
  // La caption del sensore NON si usa piu': descrive solo lo scatto piu'
  // recente e contiene gia' un contatore suo, che sfogliando l'archivio
  // finiva accanto al nostro (doppione "foto 31 di 31 · foto 1 di 31").
  const capFromName = (name) => {
    if (!name) return null
    const m = String(name).match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_T ]?(\d{2})?[-_:]?(\d{2})?/)
    if (!m) return null
    const [, Y, M, D, h, mi] = m
    return `${D}/${M}/${Y}${h && mi ? ` alle ${h}:${mi}` : ''}`
  }
  // fotoFiles[] e' ordinato dal PIU' RECENTE: idx 0 e' l'ultimo scatto, quindi
  // il numero cronologico e' nFoto − idx (idx 0 → "Foto N di N", non "1 di N").
  const fotoConta = nFoto ? `Foto ${nFoto - idx} di ${nFoto}` : null
  const fotoQuando = capFromName(fotoName) || fotoName || null
  const fotoAlt = nFoto ? `${fotoConta}${fotoQuando ? ` · ${fotoQuando}` : ''}` : 'Nessuna foto in archivio'
  const fotoSrc = fotoName ? `api/foto/file?name=${encodeURIComponent(fotoName)}` : null
  // ‹ = indietro nel tempo (idx+1, foto piu' vecchia) · › = avanti (idx−1)
  const goFoto = (d) => setFotoIdx((i) => Math.max(0, Math.min(nFoto - 1, i + d)))

  /* ── "Scatta foto ora": armato in due tap, esito asincrono ─────────────────
     La centralina e' a duty-cycle wifi: lo script parte subito ma la FOTO
     compare solo al prossimo contatto. Nessun polling aggressivo — il
     refresh naturale di api/foto/list (5 min) la trova da solo. */
  const say = (text) => { if (onToast) onToast(text) }
  const scatta = () => {
    clearTimeout(armT.current)
    if (!scattoArm) {                       // 1° tap: arma e si disarma da solo
      setScattoArm(true)
      armT.current = setTimeout(() => setScattoArm(false), SCATTO_ARM_MS)
      return
    }
    setScattoArm(false)                     // 2° tap: esegue
    setScattoBusy(true)
    callService('script', 'turn_on', { entity_id: SCATTO_SCRIPT })
      .then(() => say('Scatto richiesto · la foto arriverà al prossimo contatto della centralina'))
      .catch((e) => say(`Scatto non riuscito: ${e.message || e}`))
      .finally(() => setScattoBusy(false))
  }

  /* ── "Azzera l'errore": armato in due tap, come ogni azione che cambia
     lo stato del sistema. Dopo l'invio si rilegge api/stato due volte (lo
     stesso doppio refetch del Controllo: il primo prende l'assestamento, il
     secondo la verita' di HA) — cosi' il banner sparisce da solo invece di
     restare li' fino al giro di polling successivo. */
  const azzeraErrore = () => {
    clearTimeout(resetT.current)
    if (!resetArm) {
      setResetArm(true)
      resetT.current = setTimeout(() => setResetArm(false), SCATTO_ARM_MS)
      return
    }
    setResetArm(false)
    setResetBusy(true)
    callService('script', 'turn_on', { entity_id: RESET_SCRIPT })
      .then(() => {
        say('Errore azzerato · se il componente sbaglia ancora, tornerà da solo')
        RESET_RECONCILE.forEach((t) => setTimeout(loadStato, t))
      })
      .catch((e) => say(`Azzeramento non riuscito: ${e.message || e}`))
      .finally(() => setResetBusy(false))
  }

  /* ══════════════════════════════════════════════════════════════════ */
  return (
    <section className={'st-root' + (attiva ? '' : ' sez-off')} style={{ '--st-dim': dim }} aria-label="Stato">
      {banners.length > 0 && (
        <div className="st-banners">
          {banners.map((b) => (
            <div key={b.k} className={`st-banner st-banner--${b.tone}`} role="status">
              <Icon path={b.icon} size={22} />
              <div className="st-banner-txt">
                <div className="st-banner-t">{b.title}</div>
                <div className="st-banner-s">{b.sub}</div>
              </div>
              {b.reset && (
                /* da armato il bottone dice gia' cosa sta chiedendo: il
                   fumettino ripeterebbe, quindi tace (come "Scatta foto ora") */
                <Hint text={resetArm ? '' : 'Spegne la segnalazione e l’anello rosso. Non ripara niente: se il componente sbaglia ancora, l’errore torna.'}>
                  <button type="button" className={'st-banner-act' + (resetArm ? ' arm' : '')}
                    disabled={resetBusy} onClick={azzeraErrore}>
                    <Icon path={mdiRestart} size={17} />
                    {resetBusy ? 'Invio…' : (resetArm ? 'Confermare l’azzeramento?' : 'Azzera l’errore')}
                  </button>
                </Hint>
              )}
            </div>
          ))}
        </div>
      )}

      {/* K-12: lo scroller di sezione si dichiara come le altre quattro, con
          l'attributo — la classe resta solo per il vestito */}
      <div className="st-scroll" data-sez-scroll="1">
        {/* ── riga 1: clima grande + due mini-card ── */}
        <div className="st-row1">
          <div className="st-card st-clima">
            <div className="st-clima-head">
              {['temp', 'rh'].map((k) => {
                const v = cur[k]
                const band = bands[k]
                return (
                  <div className="st-big" key={k}>
                    <div className="st-big-lab">
                      <i className="st-swatch" style={{ background: SERIE[k].accent }} />
                      <span>{SERIE[k].label}</span>
                    </div>
                    {/* pallino di banda a SINISTRA del valore, come VPD/vasca */}
                    <div className="st-big-valrow">
                      {/* a centralina offline il pallino NON dichiara "in
                          banda" su un dato che il numero accanto sta gia'
                          smorzando: grigio e stessa opacita' del valore */}
                      <i className="st-dot" style={{ background: (off || v == null || !band) ? 'var(--fg-3)' : colBanda(k, v, band), opacity: dim }} />
                      <span className="st-big-val mono" style={{ color: colVal(k, v, band), opacity: dim }}>
                        {fmtVal(k, v)}
                      </span>
                    </div>
                    <div className="st-big-sub">{band ? `ideale ${band[0]}–${band[1]} ${SERIE[k].unit}${k === 'temp' ? ` (${giorno ? 'giorno' : 'notte'})` : ''}` : 'banda ideale non disponibile'}</div>
                    {/* estremi della finestra: due numeri mono, nessuna
                        decorazione sul tracciato */}
                    {mmBig[k] && <div className="st-mm mono">{mmBig[k]}</div>}
                  </div>
                )
              })}
              <div className="spacer" />
              <div className="st-clima-ctl">
                {/* il pill si spiega col fumettino (hover 500 ms o tap): la
                    vecchia riga espansa sotto al pill non c'e' piu' */}
                <Hint text={freschezza.info}>
                  <button type="button" className={'st-fresh' + (freschezza.stale ? ' stale' : '')}>
                    <Icon path={freschezza.stale ? mdiClockAlertOutline : mdiClockCheckOutline} size={14} />
                    {freschezza.label || 'Freschezza sconosciuta'}
                  </button>
                </Hint>
                {/* una sola pill-bar per tutti e quattro i grafici: la
                    finestra e' della sezione, non del singolo tracciato */}
                <div className="st-ranges" role="group" aria-label="Finestra storica">
                  {RANGES.map((r) => (
                    <button key={r.v} type="button" className={'st-range' + (r.v === range ? ' on' : '')}
                      aria-pressed={r.v === range} aria-label={`Finestra ${finestraLabel(r.v)}`}
                      // se la barra e' dovuta scorrere (schermi stretti), il
                      // chip scelto non deve restare mezzo fuori
                      onClick={(e) => { setRange(r.v); e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' }) }}>{r.lab}</button>
                  ))}
                </div>
                {/* Trasparenza sui dati: oltre la settimana i punti non sono
                    letture ma medie di periodo. Una riga sola per tutti e
                    quattro i grafici, come la pill-bar che la genera. */}
                {RES_LABEL[histRes] && <div className="st-res mono">{RES_LABEL[histRes]}</div>}
              </div>
            </div>
            <div className="st-plot st-plot--main">
              {sTemp || sRh ? (
                <>
                  {[0.25, 0.5, 0.75].map((f) => (
                    <React.Fragment key={f}>
                      <div className="st-gridline" style={{ top: `${f * 100}%` }} />
                      {sTemp && <span className="st-gval mono left" style={{ top: `calc(${f * 100}% - 15px)`, color: SERIE.temp.accent }}>{sTemp.valAt(f).toFixed(1)}°</span>}
                      {sRh && <span className="st-gval mono right" style={{ top: `calc(${f * 100}% - 15px)`, color: SERIE.rh.accent }}>{Math.round(sRh.valAt(f))}%</span>}
                    </React.Fragment>
                  ))}
                  {ticksMain.map((t) => (
                    <React.Fragment key={t.pct}>
                      <div className="st-vtick" style={{ left: `${t.pct}%` }} />
                      <span className="st-vlab mono" style={{ left: `${t.pct}%`, transform: t.tf, fontWeight: t.day ? 700 : 400 }}>{t.label}</span>
                    </React.Fragment>
                  ))}
                  <svg viewBox={`0 0 ${MAIN_W} ${MAIN_H}`} preserveAspectRatio="none" className="st-svg" role="img"
                    aria-label={`Andamento temperatura e umidità, ${finestraLabel(range)}`}>
                    {[[sTemp, SERIE.temp], [sRh, SERIE.rh]].map(([s, meta]) => s && (
                      <g key={meta.key}>
                        {s.path && <path d={s.area} fill={meta.accent} opacity="0.10" />}
                        {s.path && (
                          <path d={s.path} fill="none" stroke={meta.accent} strokeWidth="2.5"
                            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        )}
                        {/* un solo campione: subpath di lunghezza zero + cap
                            tondo + non-scaling-stroke = dot rotondo (un
                            <circle> qui verrebbe schiacciato dal viewBox) */}
                        {s.dot && (
                          <path d={`M${s.dot.x},${s.dot.y} L${s.dot.x},${s.dot.y}`} fill="none"
                            stroke={meta.accent} strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        )}
                      </g>
                    ))}
                  </svg>
                  <Crosshair data={xhOf('main')} />
                  <div {...xhHit('main', tMain, [['temp', sTemp], ['rh', sRh]])} />
                </>
              ) : (
                <div className="st-plot-empty">
                  <Icon path={mdiAlertOutline} size={20} color="var(--fg-3)" />
                  <span>{(histErr || noData) ? 'Storico non disponibile' : 'Nessun dato storico in questa finestra'}</span>
                </div>
              )}
            </div>
          </div>

          <div className="st-side">
            {[['vpd', sVpd, ticksVpd, tVpd], ['vasca', sVasca, ticksVasca, tVasca]].map(([k, s, tks, tEnd]) => {
              const meta = SERIE[k]
              const v = cur[k]
              const band = bands[k]
              const bandRect = s && band ? { y: s.Y(Math.min(band[1], s.hi)), h: Math.max(2, s.Y(band[0]) - s.Y(Math.min(band[1], s.hi))) } : null
              const mmTxt = mm(k, s)
              return (
                <div className="st-card st-mini" key={k}>
                  <div className="st-mini-head">
                    <Icon path={meta.icon} size={18} color={meta.accent} />
                    <div className="st-mini-txt">
                      <div className="st-mini-lab">{meta.label}</div>
                      <div className="st-mini-sub">{band ? `ideale ${band[0]}–${band[1]} ${meta.unit}` : 'banda non disponibile'}</div>
                      {mmTxt && <div className="st-mm mono">{mmTxt}</div>}
                    </div>
                    {/* stessa regola del pallino grande: offline = grigio e dim */}
                    <span className="st-dot" style={{ background: (off || v == null || !band) ? 'var(--fg-3)' : colBanda(k, v, band), opacity: dim }} />
                    <span className="st-mini-val mono" style={{ color: colVal(k, v, band), opacity: dim }}>{fmtVal(k, v)}</span>
                  </div>
                  <div className="st-plot st-plot--mini">
                    {s ? (
                      <>
                        {[0.3, 0.65].map((f) => (
                          <React.Fragment key={f}>
                            <div className="st-gridline" style={{ top: `${f * 100}%` }} />
                            <span className="st-gval mono right" style={{ top: `calc(${f * 100}% - 14px)`, color: meta.accent }}>
                              {s.valAt(f).toFixed(meta.dec)}
                            </span>
                          </React.Fragment>
                        ))}
                        {tks.filter((_, i) => i % 2 === 0).map((t) => (
                          <React.Fragment key={t.pct}>
                            <div className="st-vtick" style={{ left: `${t.pct}%` }} />
                            <span className="st-vlab mono small" style={{ left: `${t.pct}%`, transform: t.tf, fontWeight: t.day ? 700 : 400 }}>{t.label}</span>
                          </React.Fragment>
                        ))}
                        <svg viewBox={`0 0 ${MINI_W} ${MINI_H}`} preserveAspectRatio="none" className="st-svg" role="img"
                          aria-label={`Andamento ${meta.label}, ${finestraLabel(range)}`}>
                          {bandRect && <rect x="0" y={bandRect.y} width={MINI_W} height={bandRect.h} fill={meta.accent} opacity="0.09" />}
                          {s.path && <path d={s.area} fill={meta.accent} opacity="0.12" />}
                          {s.path && (
                            <path d={s.path} fill="none" stroke={meta.accent} strokeWidth="2.5"
                              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          )}
                          {s.dot && (
                            <path d={`M${s.dot.x},${s.dot.y} L${s.dot.x},${s.dot.y}`} fill="none"
                              stroke={meta.accent} strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          )}
                        </svg>
                        <Crosshair data={xhOf(k)} />
                        <div {...xhHit(k, tEnd, [[k, s]])} />
                      </>
                    ) : (
                      <div className="st-plot-empty"><span>storico non disponibile</span></div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── riga 2: componenti · centralina · foto ── */}
        <div className="st-row2">
          <div className="st-card st-list">
            <div className="st-card-head">
              <Icon path={mdiTuneVertical} size={18} color="var(--fg-3)" />
              <span>Componenti</span>
            </div>
            {compRows.map((c) => (
              /* niente fumettino: label, stato e chevron dicono gia' tutto.
                 Il tap apre la scheda RAPIDA in sola lettura; il salto al
                 pannello di Controllo e' il link in fondo a quella. */
              <button key={c.k} type="button" className="st-comp" aria-haspopup="dialog"
                onClick={(e) => { detBtn.current = e.currentTarget; setDet(c.k) }}>
                <span className="st-comp-disc" style={{ background: c.disc }}>
                  <Icon path={c.icon} size={18} color="var(--ink)" />
                </span>
                <span className="st-comp-txt">
                  <span className="st-comp-lab">{c.label}</span>
                  <span className="st-comp-sub" style={{ opacity: dim }}>{c.stato}</span>
                </span>
                {c.badge && <span className={'st-badge' + (c.man ? ' man' : '')}>{c.badge}</span>}
                <Icon path={mdiChevronRight} size={19} color="var(--fg-3)" />
              </button>
            ))}
          </div>

          <div className="st-card st-list">
            <div className="st-card-head">
              <Icon path={mdiRouterWireless} size={18} color="var(--fg-3)" />
              <span>Centralina</span>
            </div>
            {centralina.map((r) => {
              // La riga NON e' un bersaglio (niente hover, niente fascia che si
              // illumina): dove la spiegazione ha valore vive sull'(i), unico
              // punto interrogabile. L'(i) sta SUBITO DOPO LA LABEL (02/08),
              // non in fondo: in fondo si infilava fra i valori e la colonna
              // dei numeri usciva a scalini.
              return (
                <div className="st-kv" key={r.k}>
                  <Icon path={r.icon} size={18} color={r.warn ? 'var(--errore-text)' : 'var(--fg-3)'} />
                  <div className="st-kv-txt">
                    <div className="st-kv-k">
                      {r.k}
                      {r.info && <RowInfo text={r.info} />}
                    </div>
                    {r.sub && <div className="st-kv-sub">{r.sub}</div>}
                  </div>
                  <span className="st-kv-v mono" style={r.warn ? { color: 'var(--errore-text)' } : undefined}>{r.v}</span>
                </div>
              )
            })}
            <div className="spacer" />
            {ultimi.map((u) => (
              <div className="st-kv" key={u.label}>
                <Icon path={u.icon} size={18} color="var(--fg-3)" />
                <span className="st-kv-txt st-kv-k">{u.label}</span>
                <span className="st-kv-v mono" style={{ opacity: dim }}>{u.v}</span>
              </div>
            ))}
          </div>

          <div className="st-card st-foto">
            <div className="st-foto-img" style={{ opacity: dim }}>
              {fotoSrc && !imgErr ? (
                <img src={fotoSrc} alt={fotoAlt} onError={() => setImgErr(true)} />
              ) : (
                <Icon path={mdiImageOutline} size={46} color="var(--fg-3)" />
              )}
              {nFoto > 1 && (
                <>
                  <button type="button" className="st-foto-nav left" aria-label="Foto precedente"
                    disabled={idx >= nFoto - 1} onClick={() => goFoto(1)}>
                    <Icon path={mdiChevronLeft} size={22} />
                  </button>
                  <button type="button" className="st-foto-nav right" aria-label="Foto successiva"
                    disabled={idx <= 0} onClick={() => goFoto(-1)}>
                    <Icon path={mdiChevronRight} size={22} />
                  </button>
                </>
              )}
            </div>
            {/* contatore a sinistra, data/ora a destra: una riga sola */}
            <div className="st-foto-cap">
              {nFoto ? (
                <>
                  <span>{fotoConta}</span>
                  <span className="st-foto-when">{fotoQuando}</span>
                </>
              ) : <span>Nessuna foto in archivio</span>}
            </div>
            {/* Serra ferma: la foto giornaliera non scatta piu'. L'archivio
                resta navigabile — e' il diario visivo della coltura chiusa. */}
            {model?.coltivazioneAttiva === false && (
              <div className="st-foto-nota">Le foto della coltura ripartono all’avvio di una coltivazione.</div>
            )}
            <div className="st-foto-act">
              {/* CTA a piena larghezza, geometria di .act-dobtn ("Segna fatto"):
                  l'icona resta SEMPRE la camera — niente cerchio/spunta, che
                  qui vorrebbe dire "fatto" mentre l'esito e' asincrono. Lo
                  stato armato lo dice il colore (ambra) e la label. */}
              {/* disabilitato = Hint mette da solo lo span-bersaglio: i bottoni
                  disabled non ricevono eventi di mouse (vedi Hint.jsx) */}
              {/* da armato il bottone dice gia' "Confermare lo scatto?": il
                  fumettino ripeterebbe, quindi tace */}
              <Hint text={off ? 'Centralina offline: lo scatto non può essere richiesto'
                : (scattoArm ? '' : 'Chiede alla centralina una foto fuori programma')}>
                <button type="button" className={'st-shoot' + (scattoArm ? ' arm' : '')}
                  disabled={off || scattoBusy} onClick={scatta}>
                  <Icon path={mdiCamera} size={19} />
                  {scattoBusy ? 'Invio…' : (scattoArm ? 'Confermare lo scatto?' : 'Scatta foto ora')}
                </button>
              </Hint>
            </div>
          </div>
        </div>
      </div>

      {detComp && (
        <CompDetail comp={detComp} rows={dettaglio(detComp.k)} onClose={chiudiDet}
          onGo={() => {
            setDet(null)
            if (onFocus) onFocus(detComp.k)
            if (onNav) onNav('controllo')
          }} />
      )}
    </section>
  )
}
