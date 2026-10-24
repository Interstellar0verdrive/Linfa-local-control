// Sezione IMPOSTAZIONI (Fase 4 del porting design v3).
//
// Regole rispettate qui (le stesse di Stato.jsx / Controllo.jsx / Diario.jsx):
//  - palette e token SOLO da app.css; geometrie dal design (design-v3-src.jsx
//    `setGroups` r.532-580 + snapshot "Calendario Ciclo v3.dc.html").
//  - URL delle fetch RELATIVI (sotto Ingress un path assoluto non arriva).
//  - polling attivo SOLO a sezione visibile (prop `attiva`).
//  - le conferme di SOLO SETTAGGIO (un orario, un toggle, uno slider) NON si
//    armano: scrivono e lo dicono nel toast. Si arma solo cio' che cambia il
//    cuore del sistema (l'avvio della coltivazione).
//
/* ══════════════════════════════════════════════════════════════════════
   DUE FONTI, UNA SOLA FETCH
   ──────────────────────────────────────────────────────────────────────
   - `model` (gia' passato da App, come a Stato/Controllo) da' data di
     semina, varieta', finestra luci e stato della coltivazione: sono le
     stesse entita' che la timeline legge gia', inutile rileggerle.
   - api/stato da' tutto il resto (tarature, taratura pompe, rampa, filtro
     odori, livello ventole automatico...). E' l'endpoint di sola lettura
     gia' usato dal Controllo: qui si aggiunge SOLO una lista di entita' da
     esporre, non un endpoint nuovo.
   Le entita' non ancora pubblicate NON si inventano: la riga mostra '—' e il
   comando resta fermo, con la nota che lo dice (elenco DA-ESPORRE nel report).
   ══════════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiSprout, mdiBellOutline, mdiTuneVertical,
  mdiInformationOutline, mdiChevronDown, mdiPlay, mdiAlertOutline,
  mdiWeatherSunsetUp, mdiWeatherSunsetDown, mdiOpenInNew,
  mdiCalendarMonthOutline, mdiChevronLeft, mdiChevronRight, mdiClose, mdiCheck,
  mdiDeleteOutline, mdiWifiOff,
  mdiThermometer,
} from '@mdi/js'
import Hint from './Hint.jsx'
import { LIVELLO_LAB } from './model.js'
import './impostazioni.css'

const POLL_MS = 60000        // = POLL_MS di Controllo / STATO_POLL_MS di Stato
const RECONCILE = [700, 1800]  // doppio refetch post-scrittura (come Controllo)
const ARM_MS = 4000          // finestra della doppia conferma (design r.180-184)
const EM = '—'

/* ══════════════════════════════════════════════════════════════════════
   ENTITÀ — ogni id VERIFICATO in /config/packages/other/serra_mqtt.yaml
   (sola lettura del file, 02/08/2026). Fra parentesi la riga del sorgente
   e i limiti dichiarati la': i cursori usano QUELLI, non quelli del design
   (scrivere fuori range fallisce lato HA).
   ══════════════════════════════════════════════════════════════════════ */
const E = {
  // ── Coltivazione ──
  semina: 'input_datetime.serra_data_semina',        // r.1492 · has_date, no time
  varieta: 'input_select.serra_varieta',             // r.1126 · Autofiorente|Fotoperiodica
  cicloLuce: 'input_select.serra_ciclo_luce',        // r.1139 · 18/6|20/4|12/12
  alba: 'input_datetime.serra_luci_on',              // r.1539 · solo ora
  // (niente voce per input_datetime.serra_luci_off: il tramonto e' SEMPRE
  //  ricalcolato da alba + ore di luce, non si legge e non si scrive — M-9)
  coltivazione: 'input_boolean.serra_coltivazione_attiva',  // r.1291
  fotoGiorno: 'input_boolean.serra_foto_giornaliera',       // r.1230
  fotoOra: 'input_datetime.serra_foto_ora',                 // r.1469 · solo ora
  // ── Notifiche ──
  push: 'input_boolean.serra_notifiche_push',        // r.1327 · master del push
  // I tre boolean qui sotto sono NUOVI (creati in HA il 03/08): il master
  // resta il gate globale, questi accendono/spengono il singolo avviso.
  digestMOn: 'input_boolean.serra_digest_mattina_attivo',
  digestSOn: 'input_boolean.serra_digest_sera_attivo',
  notifFoto: 'input_boolean.serra_notifica_foto',
  digestM: 'input_datetime.serra_digest_mattina',    // r.1447 · solo ora
  digestS: 'input_datetime.serra_digest_sera',       // r.1453 · solo ora
  promemoria: 'input_datetime.serra_promemoria_ora', // r.1477 · solo ora
  allarmeAcqua: 'input_boolean.serra_notifica_acqua', // r.1208
  sogliaAcqua: 'input_number.serra_acqua_soglia_pct', // r.817 · 5-50, step 1
  // ── Componenti ──
  filtroOdori: 'input_boolean.serra_filtro_odori',   // r.1224
  dosAuto: 'input_boolean.serra_dosatori_auto',      // r.1216
  cal0: 'input_number.serra_cal_pompa_0_ml_s',       // r.852 · 0-3, step 0.01 · Blu/Bloom, destra
  cal1: 'input_number.serra_cal_pompa_1_ml_s',       // r.858 · Verde/Micro, centro
  cal2: 'input_number.serra_cal_pompa_2_ml_s',       // r.864 · Rossa/Grow, sinistra
  tarT: 'input_number.serra_taratura_temp',          // r.873 · -10..10, step 0.1
  tarH: 'input_number.serra_taratura_umidita',       // r.830 · -15..15, step 0.5
  ventLev: 'input_select.serra_vent_livello_auto',   // r.1101 · low|medium|high (NIENTE off)
  rampa: 'input_number.serra_luce_fade_min',         // r.1041 · 1-30 min, step 1
  // Wi-Fi della serra: stato LOGICO (ultimo comando inviato), r.1245. Vive
  // in Componenti — e' un componente della serra come gli altri; l'uptime e
  // la diagnostica stanno in Stato e non si duplicano qui.
  wifi: 'input_boolean.serra_wifi',
  tempSerra: 'input_text.serra_sorgente_temp_interna',
  umidSerra: 'input_text.serra_sorgente_umid_interna',
  tempStanza: 'input_text.serra_sorgente_temp_stanza',
  umidStanza: 'input_text.serra_sorgente_umid_stanza',
}

// Script gia' in whitelist (script.turn_on su script.serra_*).
const SCRIPT_SEMINA_OGGI = 'script.serra_semina_oggi'   // r.1929
// Chiude la coltura e azzera lo stato del ciclo (le 4 conferme di milestone;
// le ancore si risincronizzano da sole). Il DIARIO non viene toccato: resta
// l'archivio di quello che e' successo.
const SCRIPT_CANCELLA = 'script.serra_coltivazione_cancella'

// Le entita' che questa sezione si aspetta da api/stato. Semina, varieta',
// alba e tramonto NON sono qui: arrivano dal `model` (stanno gia' in
// ENTITIES, cioe' nel payload della timeline) e la loro assenza da api/stato
// non e' una lacuna da segnalare.
const DA_STATO = [
  'cicloLuce', 'fotoGiorno', 'fotoOra',
  'push', 'digestMOn', 'digestSOn', 'notifFoto',
  'digestM', 'digestS', 'promemoria', 'allarmeAcqua', 'sogliaAcqua',
  'filtroOdori', 'dosAuto', 'cal0', 'cal1', 'cal2', 'tarT', 'tarH', 'ventLev', 'rampa',
  'wifi', 'tempSerra', 'umidSerra', 'tempStanza', 'umidStanza',
]

// Le tre pompe, con la mappatura VINCOLANTE della divergenza #1 (risolta il
// 02/08 sulla dashboard-serra e confermata dai nomi degli helper):
//   cal_pompa_2 = Rossa · Grow · gocciolatore SINISTRO
//   cal_pompa_1 = Verde · Micro · CENTRALE
//   cal_pompa_0 = Blu · Bloom · DESTRO
const POMPE = [
  { k: 'cal2', l: 'Rossa · Grow', pos: 'sinistra', colore: 'var(--errore)' },
  { k: 'cal1', l: 'Verde · Micro', pos: 'centro', colore: 'var(--verde)' },
  { k: 'cal0', l: 'Blu · Bloom', pos: 'destra', colore: 'var(--acqua)' },
]

const CICLI = ['18/6', '20/4', '12/12']
// Ordine di VISUALIZZAZIONE dei tre bottoni: dal ciclo piu' corto al piu'
// lungo (12 → 18 → 20 ore di luce), che si legge come una scala. Il default
// resta 18/6, che nel segmentato finisce al centro.
const CICLI_ORDINE = ['12/12', '18/6', '20/4']
const ORE_CICLO = { '18/6': 18, '20/4': 20, '12/12': 12 }
// Opzioni ESATTE di input_select.serra_vent_livello_auto (niente `off`: qui si
// sceglie il livello dell'automatico, non se le ventole girano). Le etichette
// italiane arrivano da LIVELLO_LAB (model.js), condivise con Controllo.
const VENT_LIV = ['low', 'medium', 'high']
const SOGLIE = [10, 15, 20, 25, 35, 50]

/* ── copie locali (come nelle altre sezioni: importarle da App = ciclo) ── */
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
function Icon({ path, size = 16, color, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none', ...style }}>
      <path d={path} fill={color || 'currentColor'} />
    </svg>
  )
}
function RowInfo({ text }) {
  return (
    <Hint text={text} anchor>
      <button type="button" className="hint-i" aria-label="Spiegazione">
        <Icon path={mdiInformationOutline} size={15} />
      </button>
    </Hint>
  )
}

/* ── lettura tollerante ─────────────────────────────────────────────── */
const UNAVAIL = new Set(['unavailable', 'unknown', 'none', 'null', ''])
const has = (s) => s != null && !UNAVAIL.has(String(s).trim().toLowerCase())
const isOn = (s) => s === 'on' || s === 'true' || s === 'True'
const p2 = (n) => String(n).padStart(2, '0')
// "06:00:00" / "06:00" → "06:00"; qualunque altra cosa → null
function hhmm(s) {
  if (!has(s)) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s).trim())
  return m ? `${p2(+m[1])}:${m[2]}` : null
}
const somma = (ora, ore) => {
  const [h, m] = String(ora).split(':').map(Number)
  return `${p2((h + ore) % 24)}:${p2(m || 0)}`
}

/* ══════════════════════════════════════════════════════════════════════ */
// `centralinaOff` arriva da App (sonda su api/stato): qui non serve a
// bloccare niente — gli helper di queste righe vivono in Home Assistant, non
// nella serra, e si scrivono benissimo anche a bridge giu'. Serve a dirlo:
// senza nota, un'impostazione salvata mentre la centralina e' muta sembrerebbe
// gia' in vigore.
export default function Impostazioni({ attiva, model, onToast, onNav, onRefresh, centralinaOff }) {
  const [stato, setStato] = useState(null)
  const [statoErr, setStatoErr] = useState(null)
  const [climateChoices, setClimateChoices] = useState({ temperature: [], humidity: [] })
  const [climateErr, setClimateErr] = useState(null)
  const [armed, setArmed] = useState(null)
  const [busy, setBusy] = useState(false)
  // AUDIT R2 (M-R2-6): gemello SINCRONO di `busy`. `busy` e' stato React, quindi
  // la guardia si accende solo dal render dopo il tap e due tap ravvicinati
  // entrano tutti e due. Le scritture di qui sono idempotenti (toggle,
  // select_option, set_value), ma la porta va chiusa nello stesso istante del
  // gesto — e' lo stesso principio di azione() in App e di arma() in Controllo.
  const busyRef = useRef(false)
  const [cal, setCal] = useState(false)     // overlay del calendario di semina
  const armT = useRef(null)
  useEffect(() => () => clearTimeout(armT.current), [])
  useEffect(() => { setArmed(null); clearTimeout(armT.current) }, [attiva])

  const carica = useCallback(() => fetch('api/stato')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then((j) => { setStato(j); setStatoErr(null) })
    .catch((e) => setStatoErr(String(e.message || e))), [])

  const caricaSensori = useCallback(() => fetch('api/climate-sensors')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then((j) => { if (!j.ok) throw new Error(j.error || 'lettura fallita'); setClimateChoices(j); setClimateErr(null) })
    .catch((e) => setClimateErr(String(e.message || e))), [])

  useEffect(() => {
    if (!attiva) return undefined
    carica()   // il primo giro ignora document.hidden (l'iframe Ingress mente)
    const tick = () => { if (!document.hidden) carica() }
    const iv = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [attiva, carica])

  useEffect(() => { if (attiva) caricaSensori() }, [attiva, caricaSensori])

  const entities = stato?.entities || null

  /* ══ "L'ULTIMO INVIO FA FEDE" ═════════════════════════════════════════
     Stesso principio di applicaMix in Controllo.jsx, per un motivo diverso
     ma con lo stesso effetto: fra la scrittura e il giro di polling
     successivo (fino a 60 s) api/stato racconta ancora il valore VECCHIO.
     Senza questo, ogni cursore mosso "tornava indietro" un istante dopo.
     Si tiene quindi una mappa entita' → ultimo valore inviato: comanda lei
     finche' la lettura non la conferma (o finche' non scade: un invio che
     non si vede riflesso entro ECO_TTL_MS non e' andato a buon fine e la
     verita' deve tornare a essere quella pubblicata). */
  const [eco, setEco] = useState({})
  const ECO_TTL_MS = 180000
  useEffect(() => {
    if (!entities) return
    setEco((cur) => {
      const now = Date.now()
      let cambiato = false
      const out = {}
      for (const [id, rec] of Object.entries(cur)) {
        const letto = entities[id]?.state
        const scaduto = now - rec.t > ECO_TTL_MS
        // confronto NUMERICO quando entrambi sono numeri: HA restituisce
        // "15.0" dove noi abbiamo inviato 15, e un confronto fra stringhe
        // terrebbe l'eco viva fino alla scadenza per nulla.
        const a = String(rec.v).trim()
        const b = has(letto) ? String(letto).trim() : null
        const numerici = b != null && a !== '' && b !== '' && !isNaN(+a) && !isNaN(+b)
        const confermato = b != null && (numerici ? Math.abs(+a - +b) < 1e-6 : a === b)
        if (scaduto || confermato) { cambiato = true; continue }
        out[id] = rec
      }
      return cambiato ? out : cur
    })
  }, [entities])
  const ricorda = (id, v) => setEco((c) => ({ ...c, [id]: { v: String(v), t: Date.now() } }))

  // stato letto, con l'eco davanti
  const st = useCallback((id) => {
    if (eco[id]) return eco[id].v
    const s = entities ? entities[id]?.state : undefined
    return has(s) ? String(s) : null
  }, [entities, eco])
  const num = useCallback((id) => { const v = parseFloat(st(id)); return isNaN(v) ? null : v }, [st])
  // Una riga e' viva solo se la sua entita' e' DAVVERO nel payload: un'entita'
  // non ancora esposta non si comanda alla cieca.
  // AUDIT R1 (I-1): api/stato emette una chiave per OGNI voce di
  // STATO_ENTITIES, anche per le entita' assenti dal core (con
  // `error: entita' assente`). Testare la sola presenza rendeva c1() sempre
  // vero, e con lui erano codice morto il banner "N valori non sono ancora
  // fra i dati pubblicati", lo stato `assente` del Toggle e ogni
  // disabilitazione: un'entita' sparita si leggeva come "spenta".
  const c1 = useCallback((id) => !!(entities && entities[id] && !entities[id].error), [entities])

  const noData = !entities
  const say = (t) => { if (onToast) onToast(t) }
  const refetch = () => RECONCILE.forEach((t) => setTimeout(carica, t))

  /* ── scritture ────────────────────────────────────────────────────── */
  // Settaggio semplice: scrive, ricorda l'invio, lo dice. NIENTE doppio tap
  // (si arma solo cio' che cambia il cuore del sistema, piu' sotto).
  //
  // AUDIT R1 (I-6): `opts.piano` per le scritture che alimentano il MODELLO
  // della timeline (varieta', ciclo luce, alba, dosatori, semina a oggi).
  // refetch() rilegge solo api/stato: senza questo flag la riga che mostra il
  // valore preso da `model` restava vecchia fino al poll da 60 s, mentre il
  // toast diceva gia' che era cambiato. Stessa meccanica della conferma di
  // semina qui sotto.
  const scrivi = async (dominio, servizio, dati, id, valEco, msgOk, opts) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await callService(dominio, servizio, dati)
      if (id != null) ricorda(id, valEco)
      say(msgOk)
      refetch()
      if (opts && opts.piano && onRefresh) RECONCILE.forEach((t) => setTimeout(onRefresh, t))
    } catch (e) {
      say(`Non salvato: ${e.message || e}`)
      carica()
    } finally { busyRef.current = false; setBusy(false) }
  }
  const setBool = (id, on, label, opts) => scrivi('input_boolean', on ? 'turn_on' : 'turn_off',
    { entity_id: id }, id, on ? 'on' : 'off', `${label}: ${on ? 'attivo' : 'spento'}`, opts)
  const setOra = (id, v, label, opts) => scrivi('input_datetime', 'set_datetime',
    { entity_id: id, time: `${v}:00` }, id, `${v}:00`, `${label}: ${v}`, opts)
  const setNum = (id, v, label, unita, opts) => scrivi('input_number', 'set_value',
    { entity_id: id, value: v }, id, v, `${label}: ${v}${unita ? ` ${unita}` : ''}`, opts)
  const setOpt = (id, v, label, opts) => scrivi('input_select', 'select_option',
    { entity_id: id, option: v }, id, v, `${label}: ${v}`, opts)
  const setSource = (id, value, label) => scrivi('input_text', 'set_value',
    { entity_id: id, value }, id, value, `${label}: ${value}`)

  /* Data di semina scelta dal calendario. Non e' un settaggio come gli altri:
     sposta il giorno 0 e con lui TUTTA la timeline (fasi, eventi, promemoria),
     quindi la conferma vive dentro l'overlay (tap esplicito su "Conferma", con
     l'avviso accanto) e qui si scrive e basta. Dopo la scrittura si chiede ad
     App di rileggere il piano: la sezione da sola non basta, la data la
     mostra il `model` che nasce da api/timeline. */
  const scriviSemina = async (iso, etichetta) => {
    // stessa guardia sincrona di scrivi(): `busyRef` e' UNO per tutta la
    // sezione, quindi ogni percorso che alza `busy` deve alzare anche lui
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await callService('input_datetime', 'set_datetime', { entity_id: E.semina, date: iso })
      say(`Semina: ${etichetta} · la timeline si riallinea`)
      refetch()
      if (onRefresh) RECONCILE.forEach((t) => setTimeout(onRefresh, t))
    } catch (e) {
      say(`Data non salvata: ${e.message || e}`)
    } finally { busyRef.current = false; setBusy(false) }
  }

  // Azione ARMATA: solo l'avvio della coltivazione (design r.180-184).
  const arma = (id, esegui) => {
    clearTimeout(armT.current)
    if (armed !== id) {
      setArmed(id)
      armT.current = setTimeout(() => setArmed(null), ARM_MS)
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setArmed(null)
    setBusy(true)
    Promise.resolve().then(esegui).finally(() => { busyRef.current = false; setBusy(false) })
  }

  /* ══ NOTIFICHE ════════════════════════════════════════════════════════
     Il master apre e chiude il riquadro. Si nasconde SOLO quando si sa che e'
     spento: se il boolean non e' ancora pubblicato non si fa sparire mezza
     colonna per un dato che manca — le singole voci si leggono da sole. */
  const pushOn = !c1(E.push) || isOn(st(E.push))

  /* ══ COLTIVAZIONE ═════════════════════════════════════════════════════ */
  const viva = model?.coltivazioneAttiva !== false
  const semina = model?.semina || null
  const seminaTxt = semina ? `${p2(semina.getDate())}/${p2(semina.getMonth() + 1)}/${semina.getFullYear()} · g0` : EM
  const varieta = st(E.varieta) || model?.varieta || null
  const auto = varieta !== 'Fotoperiodica'

  // ciclo luce: si legge l'input_select; se non e' ancora esposto lo si
  // DEDUCE dalla finestra luci del piano (alba→tramonto), che il modello ha
  // gia'. Meglio un valore derivato e vero che un trattino.
  const cicloLetto = st(E.cicloLuce)
  const cicloDedotto = useMemo(() => {
    const on = hhmm(model?.luciOn); const off = hhmm(model?.luciOff)
    if (!on || !off) return null
    const [h1, m1] = on.split(':').map(Number)
    const [h2, m2] = off.split(':').map(Number)
    let ore = ((h2 * 60 + m2) - (h1 * 60 + m1) + 1440) % 1440
    ore = Math.round(ore / 60)
    return CICLI.find((c) => ORE_CICLO[c] === ore) || null
  }, [model])
  const ciclo = cicloLetto || cicloDedotto
  const alba = hhmm(st(E.alba)) || hhmm(model?.luciOn) || null
  const oreLuce = ciclo ? ORE_CICLO[ciclo] : null
  const tramonto = alba && oreLuce != null ? somma(alba, oreLuce) : hhmm(model?.luciOff)
  // 24 celle: accesa se l'ora cade nella finestra alba→alba+ore di luce
  const celle = useMemo(() => {
    if (!alba || oreLuce == null) return null
    const a = parseInt(alba, 10)
    return Array.from({ length: 24 }, (_, h) => ({
      h, lit: ((h - a + 24) % 24) < oreLuce, tick: h % 6 === 0 ? String(h) : '',
    }))
  }, [alba, oreLuce])

  /* ══ render ═══════════════════════════════════════════════════════════ */
  const nota = noData
    ? `Valori non disponibili${statoErr ? ` (${statoErr})` : ''}: le impostazioni restano in sola lettura finché i dati non tornano.`
    : null

  // righe non ancora pubblicate: si conta quante sono per dirlo UNA volta.
  // Solo le entita' che la sezione legge DAVVERO da api/stato: semina,
  // varieta', alba e tramonto arrivano dal `model` (sono gia' nella timeline)
  // e la loro assenza qui non e' una lacuna.
  const mancanti = useMemo(() => {
    if (!entities) return []
    // stesso criterio di c1(): chiave presente ma con `error` = entita' assente
    return DA_STATO.map((k) => E[k]).filter((id) => !entities[id] || entities[id].error)
  }, [entities])

  return (
    <section className={'im-root' + (attiva ? '' : ' sez-off')} aria-label="Impostazioni">
      <div className="im-scroll" data-sez-scroll="1">
        {nota && (
          <div className="im-block" role="status">
            <Icon path={mdiAlertOutline} size={18} />{nota}
          </div>
        )}
        {centralinaOff && !noData && (
          <div className="im-block" role="status">
            <Icon path={mdiWifiOff} size={18} />
            A centralina offline le impostazioni si salvano lo stesso: la serra le applica al prossimo contatto.
          </div>
        )}
        {!noData && mancanti.length > 0 && (
          <div className="im-block" role="status">
            <Icon path={mdiAlertOutline} size={18} />
            {mancanti.length === 1
              ? 'Un valore non è fra i dati che la centralina sta comunicando: la riga con — resta in sola lettura finché il dato non torna.'
              : `${mancanti.length} valori non sono fra i dati che la centralina sta comunicando: le righe con — restano in sola lettura finché i dati non tornano.`}
          </div>
        )}

        <div className="im-cols">
          {/* ══════════════ COLTIVAZIONE ══════════════ */}
          <Gruppo titolo="Coltivazione" icona={mdiSprout}>
            <Riga label="Data di semina" hint="Giorno 0 del ciclo: fasi ed eventi si contano da qui">
              <span className="im-val mono">{seminaTxt}</span>
              <button type="button" className="im-ic" disabled={busy} aria-label="Scegli la data di semina"
                onClick={() => setCal(true)}>
                <Icon path={mdiCalendarMonthOutline} size={18} />
              </button>
              <button type="button" className="im-quick" disabled={busy}
                onClick={() => scrivi('script', 'turn_on', { entity_id: SCRIPT_SEMINA_OGGI },
                  null, null, 'Semina impostata a oggi', { piano: true })}>oggi</button>
            </Riga>

            <Riga label="Varietà"
              hint="L’autofiorente tiene un ciclo luce costante; la fotoperiodica cambia ore di luce a ogni fase">
              <div className="im-radio" role="group" aria-label="Varietà">
                {['Autofiorente', 'Fotoperiodica'].map((v) => (
                  <button key={v} type="button" className={'im-opt' + (varieta === v ? ' on' : '')}
                    aria-pressed={varieta === v} disabled={busy || !varieta}
                    onClick={() => setOpt(E.varieta, v, 'Varietà', { piano: true })}>{v}</button>
                ))}
              </div>
            </Riga>

            {!auto && (
              <Riga nota>
                In fotoperiodica gli orari di luce e buio sono gestiti dal piano, fase per fase:
                ciclo luce, alba e ore di luce non vengono usati.
              </Riga>
            )}

            {auto && (
              <>
                <Riga child label="Ciclo luce" hint="Ore di luce / buio, costante per tutta la coltura">
                  <div className="im-radio" role="group" aria-label="Ciclo luce">
                    {CICLI_ORDINE.map((v) => (
                      <button key={v} type="button" className={'im-opt' + (ciclo === v ? ' on' : '')}
                        aria-pressed={ciclo === v} disabled={busy}
                        onClick={() => setOpt(E.cicloLuce, v, 'Ciclo luce', { piano: true })}>{v}</button>
                    ))}
                  </div>
                </Riga>

                <Riga child label="Ora accensione (alba)"
                  hint="Quando “sorge il sole” in serra; il tramonto è calcolato dal ciclo"
                  info="Il tramonto non si imposta a mano: la serra lo ricalcola da alba + ore di luce a ogni cambio.">
                  <TimeBox valore={alba} disabled={busy || !alba}
                    onSalva={(v) => setOra(E.alba, v, 'Alba', { piano: true })} />
                </Riga>

                <Riga child label="Ore di luce"
                  hint={celle ? `Giorno dalle ${alba} alle ${tramonto} · ${oreLuce} h di luce, ${24 - oreLuce} di buio` : 'Finestra non disponibile'}>
                  {celle && (
                    <div className="im-band">
                      <div className="im-band-cells">
                        {celle.map((c) => (
                          <div key={c.h} className={'im-cell' + (c.lit ? ' lit' : '')}>
                            {c.tick && <span className="im-tick mono">{c.tick}</span>}
                          </div>
                        ))}
                      </div>
                      <div className="im-band-legend">
                        <span><Icon path={mdiWeatherSunsetUp} size={14} color="var(--luce)" />alba {alba}</span>
                        <span><Icon path={mdiWeatherSunsetDown} size={14} color="var(--fg-3)" />tramonto {tramonto}</span>
                      </div>
                    </div>
                  )}
                </Riga>
              </>
            )}

            <Riga label="Scatto foto giornaliera"
              hint="Una foto al giorno con luce bianca, per l’archivio della coltura">
              <Toggle on={isOn(st(E.fotoGiorno))} disabled={busy || !c1(E.fotoGiorno)}
                assente={!c1(E.fotoGiorno)}
                onChange={(v) => setBool(E.fotoGiorno, v, 'Scatto foto giornaliera')} />
            </Riga>
            {isOn(st(E.fotoGiorno)) && (
              <Riga child label="Orario scatto" hint="Meglio a luci accese e lontano dai ricircoli">
                <TimeBox valore={hhmm(st(E.fotoOra))} disabled={busy || !c1(E.fotoOra)}
                  onSalva={(v) => setOra(E.fotoOra, v, 'Orario scatto foto')} />
              </Riga>
            )}

            {!viva ? (
              <Riga label="Avvio coltivazione"
                hint="Accende il conteggio dei giorni, le milestone e il diario della nuova coltura"
                info="Ordine: prima la data di semina qui sopra, poi l’avvio. Avviando con una data sbagliata partono con lei fasi, eventi e promemoria.">
                <button type="button" className={'im-cta' + (armed === 'avvia' ? ' arm' : '')}
                  disabled={busy} onClick={() => arma('avvia', () =>
                    callService('input_boolean', 'turn_on', { entity_id: E.coltivazione })
                      .then(() => { say('Coltivazione avviata 🌱'); refetch() })
                      .catch((e) => say(`Avvio non riuscito: ${e.message || e}`)))}>
                  <Icon path={mdiPlay} size={18} />
                  {armed === 'avvia' ? 'Confermare?' : 'Avvia'}
                </button>
              </Riga>
            ) : (
              <Riga label="Chiusura coltivazione"
                hint="Chiude il ciclo in corso: la serra si spegne e la timeline resta consultabile">
                <button type="button" className="im-link-btn" onClick={() => onNav && onNav('piano')}>
                  <Icon path={mdiOpenInNew} size={15} />Vai al Piano
                </button>
              </Riga>
            )}

            {/* Ultima voce del riquadro, come nel design (r.544): azione
                DANGER a doppio tocco. Diversa dalla chiusura qui sopra —
                quella conclude la coltura e basta, questa azzera anche lo
                stato del ciclo (le 4 conferme di milestone; le ancore si
                risincronizzano da sole). Il diario NON si tocca: resta
                l'archivio di cio' che e' successo. */}
            <Riga label="Cancella coltivazione"
              hint="Chiude la coltura in corso e azzera lo stato del ciclo; il diario resta come archivio">
              <button type="button" className={'im-cta im-cta--danger' + (armed === 'cancella' ? ' arm' : '')}
                disabled={busy} onClick={() => arma('cancella', () =>
                  callService('script', 'turn_on', { entity_id: SCRIPT_CANCELLA })
                    .then(() => {
                      say('Coltivazione cancellata · il diario resta')
                      refetch()
                      if (onRefresh) RECONCILE.forEach((t) => setTimeout(onRefresh, t))
                    })
                    .catch((e) => say(`Cancellazione non riuscita: ${e.message || e}`)))}>
                <Icon path={mdiDeleteOutline} size={18} />
                {armed === 'cancella' ? 'Confermare?' : 'Cancella'}
              </button>
            </Riga>
          </Gruppo>

          {/* ══════════════ NOTIFICHE ══════════════ */}
          <Gruppo titolo="Notifiche" icona={mdiBellOutline}>
            <Riga label="Notifiche push"
              hint="Interruttore generale: spento, nessuna notifica sul telefono"
              info="L’errore pendente notifica comunque: è l’unico avviso che non passa da qui. Anche a push spente i riepiloghi restano nella campanella di Home Assistant.">
              <Toggle on={isOn(st(E.push))} disabled={busy || !c1(E.push)} assente={!c1(E.push)}
                onChange={(v) => setBool(E.push, v, 'Notifiche push')} />
            </Riga>

            {/* Il master e' il GENITORE di tutto il riquadro: a push spente
                le singole voci non hanno piu' senso (non partirebbe niente) e
                spariscono, invece di restare accese a mentire. Stesso rapporto
                figlio/genitore delle righe orario sotto ai digest. */}
            {pushOn && (
            <>
            {/* Digest: il toggle comanda, l'orario e' la sua riga figlia e
                compare solo a digest acceso — come fa il design con l'orario
                sotto l'interruttore. */}
            <Riga label="Digest mattina" hint="Riepilogo delle azioni da fare, all’ora scelta">
              <Toggle on={isOn(st(E.digestMOn))} disabled={busy || !c1(E.digestMOn)}
                assente={!c1(E.digestMOn)}
                onChange={(v) => setBool(E.digestMOn, v, 'Digest mattina')} />
            </Riga>
            {isOn(st(E.digestMOn)) && (
              <Riga child label="Orario digest mattina">
                <TimeBox valore={hhmm(st(E.digestM))} disabled={busy || !c1(E.digestM)}
                  onSalva={(v) => setOra(E.digestM, v, 'Orario digest mattina')} />
              </Riga>
            )}

            <Riga label="Digest sera" hint="Parte solo se a fine giornata è rimasto qualcosa da fare">
              <Toggle on={isOn(st(E.digestSOn))} disabled={busy || !c1(E.digestSOn)}
                assente={!c1(E.digestSOn)}
                onChange={(v) => setBool(E.digestSOn, v, 'Digest sera')} />
            </Riga>
            {isOn(st(E.digestSOn)) && (
              <Riga child label="Orario digest sera">
                <TimeBox valore={hhmm(st(E.digestS))} disabled={busy || !c1(E.digestS)}
                  onSalva={(v) => setOra(E.digestS, v, 'Orario digest sera')} />
              </Riga>
            )}

            <Riga label="Notifica foto" hint="Push quando la foto giornaliera è stata acquisita">
              <Toggle on={isOn(st(E.notifFoto))} disabled={busy || !c1(E.notifFoto)}
                assente={!c1(E.notifFoto)}
                onChange={(v) => setBool(E.notifFoto, v, 'Notifica foto')} />
            </Riga>

            {/* Non e' un digest: e' il promemoria delle conferme di fase, e
                nel YAML non passa dal push — vive solo nella campanella. */}
            <Riga label="Promemoria di fase"
              hint="Solo in campanella: ricorda le conferme di flush e taglio quando sono oltre la data prevista">
              <TimeBox valore={hhmm(st(E.promemoria))} disabled={busy || !c1(E.promemoria)}
                onSalva={(v) => setOra(E.promemoria, v, 'Promemoria di fase')} />
            </Riga>

            <Riga label="Allarme acqua bassa"
              hint="Avviso sotto la soglia; i ricircoli si sospendono comunque"
              info="In essiccazione si spegne da solo (la vasca è vuota di proposito) e si riaccende all’avvio della coltivazione.">
              <Toggle on={isOn(st(E.allarmeAcqua))} disabled={busy || !c1(E.allarmeAcqua)}
                assente={!c1(E.allarmeAcqua)}
                onChange={(v) => setBool(E.allarmeAcqua, v, 'Allarme acqua bassa')} />
            </Riga>
            {isOn(st(E.allarmeAcqua)) && (
              <Riga child label="Soglia allarme" hint="Livello vasca sotto il quale arriva l’avviso">
                <Select valore={num(E.sogliaAcqua) != null ? `${Math.round(num(E.sogliaAcqua))} %` : EM}
                  opzioni={SOGLIE.map((v) => `${v} %`)} disabled={busy || !c1(E.sogliaAcqua)}
                  onSel={(v) => setNum(E.sogliaAcqua, parseInt(v, 10), 'Soglia allarme acqua', '%')} />
              </Riga>
            )}
            </>
            )}
          </Gruppo>

          {/* ══════════════ COMPONENTI ══════════════ */}
          <Gruppo titolo="Componenti" icona={mdiTuneVertical}>
            <Riga label="Filtro odori ventole"
              hint="Tutte a low 30 minuti sì e 30 no, in fioritura, flush ed essiccazione">
              <Toggle on={isOn(st(E.filtroOdori))} disabled={busy || !c1(E.filtroOdori)}
                assente={!c1(E.filtroOdori)}
                onChange={(v) => setBool(E.filtroOdori, v, 'Filtro odori')} />
            </Riga>

            <Riga label="Rampa alba e tramonto"
              hint="Quanto dura la salita e la discesa della luce"
              info="Vale sia per l’accensione sia per lo spegnimento automatici; i comandi diretti del Controllo hanno un loro fade in secondi.">
              <Slider aria="Rampa alba e tramonto" min={1} max={30} step={1} unita="min" dec={0}
                valore={num(E.rampa)} disabled={busy || !c1(E.rampa)}
                onSalva={(v) => setNum(E.rampa, v, 'Rampa alba e tramonto', 'min')} />
            </Riga>

            <Riga label="Taratura temperatura"
              hint="Scarto applicato alla sonda della serra (misurato → tarato)">
              <Slider aria="Taratura temperatura" min={-10} max={10} step={0.1} unita="°C" dec={1} segno centro
                valore={num(E.tarT)} disabled={busy || !c1(E.tarT)}
                onSalva={(v) => setNum(E.tarT, v, 'Taratura temperatura', '°C')} />
            </Riga>
            <Riga label="Taratura umidità"
              hint="Scarto applicato alla sonda della serra">
              <Slider aria="Taratura umidità" min={-15} max={15} step={0.5} unita="%" dec={1} segno centro
                valore={num(E.tarH)} disabled={busy || !c1(E.tarH)}
                onSalva={(v) => setNum(E.tarH, v, 'Taratura umidità', '%')} />
            </Riga>

            {/* METODO, non modalita' (04/08): la modalità Pianificata/Libera
                dei nutrienti sta nel Controllo e ha il suo interruttore. Qui
                si sceglie solo COME si eroga dentro il Pianificato — con le
                pompe o a mano — e la taratura qui sotto e' figlia di questa
                scelta, non di quella. */}
            <Riga label="Erogazione automatica (pompe)"
              hint="Sconsigliato: a siringa la dose è più precisa. Spento, la serra mette solo il promemoria nel Piano">
              <Toggle on={isOn(st(E.dosAuto))} disabled={busy || !c1(E.dosAuto)}
                assente={!c1(E.dosAuto)}
                onChange={(v) => setBool(E.dosAuto, v, 'Erogazione automatica', { piano: true })} />
            </Riga>

            {/* La taratura delle pompe ha senso solo se le pompe le usa
                qualcuno: righe figlie del toggle, come nel design
                (`...(S.sw.dosAuto ? [...] : [])`). A dosatori spenti i
                nutrienti si danno a siringa e questi tre cursori sarebbero
                tre numeri senza effetto. */}
            {isOn(st(E.dosAuto)) && (
              <>
                <Riga child nota>
                  Taratura pompe: 0 = pompa fuori uso, quel nutriente passa a siringa.
                  Come tarare: bilancia di precisione sotto il gocciolatore, erogare 1 secondo più
                  volte, la media dei grammi è il valore in ml/s. Sempre a capsula piena.
                </Riga>
                {POMPE.map((p) => (
                  <Riga key={p.k} child wide label={`Pompa ${p.l}`} hint={`Gocciolatore di ${p.pos}`}>
                    <Slider aria={`Taratura pompa ${p.l}`} min={0} max={3} step={0.01} unita="ml/s" dec={2}
                      accento={p.colore} valore={num(E[p.k])} disabled={busy || !c1(E[p.k])}
                      onSalva={(v) => setNum(E[p.k], v, `Pompa ${p.l}`, 'ml/s')} />
                  </Riga>
                ))}
              </>
            )}

            <Riga label="Livello ventole automatico"
              hint="Velocità usata quando scattano le soglie di clima">
              {/* AUDIT R2 (R2-4): si MOSTRA l'italiano e si SCRIVE il valore HA.
                  Le opzioni dell'input_select restano low|medium|high; cambia
                  solo l'etichetta, che ora dice la stessa parola di Controllo
                  (dove la nota «si sceglie in Impostazioni · Componenti» porta
                  proprio qui: leggere «Media» e poi trovare «medium» era la
                  sola stringa in inglese di tutta l'interfaccia). */}
              <Select valore={st(E.ventLev) || EM} opzioni={VENT_LIV} lab={LIVELLO_LAB}
                disabled={busy || !c1(E.ventLev)}
                onSel={(v) => scrivi('input_select', 'select_option',
                  { entity_id: E.ventLev, option: v }, E.ventLev, v,
                  `Livello ventole automatico: ${LIVELLO_LAB[v] || v}`)} />
            </Riga>

            {/* Ultima voce del riquadro. Il gruppo "Sistema" che stava qui e'
                stato tolto: lo scatto foto e il suo orario vivono in
                Coltivazione (dov'e' il design a metterli) e uptime,
                freschezza e diagnostica sono gia' la sezione Stato — qui
                sarebbero un doppione. Della vecchia colonna resta solo il
                wi-fi, che e' un componente della serra come gli altri. */}
            <Riga label="Wi-Fi della serra"
              hint="Acceso solo quando serve: la centralina lo tiene spento per consumare meno"
              info="È lo stato dell’ultimo comando inviato. Dopo un riavvio della sola serra può restare “attivo” con la radio già spenta: basta rifare il comando.">
              <Toggle on={isOn(st(E.wifi))} disabled={busy || !c1(E.wifi)} assente={!c1(E.wifi)}
                onChange={(v) => setBool(E.wifi, v, 'Wi-Fi della serra')} />
            </Riga>
          </Gruppo>

          <Gruppo titolo="Sensori climatici" icona={mdiThermometer}>
            <Riga nota>
              Scegli i sensori già presenti in Home Assistant. Temperatura e umidità dentro la serra
              sono necessarie per l’automazione delle ventole. I due sensori della stanza le aiutano
              a decidere se ventilare può raffreddare o togliere umidità; senza questi, il confronto
              viene saltato e restano attive le sole soglie interne.
            </Riga>
            {climateErr && <Riga nota>Elenco sensori non disponibile: {climateErr}</Riga>}
            {[
              ['tempSerra', 'Temperatura nella serra', 'temperature'],
              ['umidSerra', 'Umidità nella serra', 'humidity'],
              ['tempStanza', 'Temperatura della stanza', 'temperature'],
              ['umidStanza', 'Umidità della stanza', 'humidity'],
            ].map(([key, label, kind]) => (
              <Riga key={key} label={label} wide>
                <ClimateSourceSelect
                  value={st(E[key]) || ''}
                  choices={climateChoices[kind] || []}
                  disabled={busy || !!climateErr || !c1(E[key])}
                  label={label}
                  onSelect={(value) => setSource(E[key], value, label)} />
              </Riga>
            ))}
          </Gruppo>
        </div>
      </div>

      {cal && (
        <CalendarioSemina
          semina={semina}
          onClose={() => setCal(false)}
          onConferma={(iso, etichetta) => {
            setCal(false)
            scriviSemina(iso, etichetta)
          }} />
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   PEZZI DI RIGA — geometrie dallo snapshot del design (blocco IMPOSTAZIONI)
   ══════════════════════════════════════════════════════════════════════ */
/* Overlay del calendario (scrim + Escape + fondo che non scorre): stesso
   comportamento delle modali di App, riscritto qui in sei righe invece di
   importare `useModal` da App — che creerebbe il ciclo App → Impostazioni → App,
   lo stesso motivo per cui sono locali anche Icon e callService. */
function useModale(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const GG = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const isoDi = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const stessoGiorno = (a, b) => !!a && !!b && isoDi(a) === isoDi(b)

/* Calendario mensile fatto a mano: niente <input type="date"> (il controllo
   nativo ha un vestito suo, diverso su ogni piattaforma, e qui stonerebbe).
   La scelta di un giorno NON scrive: arma il bottone "Conferma" in fondo, che
   e' l'unico punto in cui si tocca il giorno 0 della coltura. */
function CalendarioSemina({ semina, onClose, onConferma }) {
  useModale(onClose)
  const oggi = new Date()
  const base = semina || oggi
  const [mese, setMese] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1))
  const [scelta, setScelta] = useState(semina || null)

  // griglia lun→dom: quante celle vuote prima del 1 del mese
  const primo = new Date(mese.getFullYear(), mese.getMonth(), 1)
  const vuote = (primo.getDay() + 6) % 7
  const nGiorni = new Date(mese.getFullYear(), mese.getMonth() + 1, 0).getDate()
  const celle = [
    ...Array.from({ length: vuote }, () => null),
    ...Array.from({ length: nGiorni }, (_, i) => new Date(mese.getFullYear(), mese.getMonth(), i + 1)),
  ]
  const spostaMese = (d) => setMese((m) => new Date(m.getFullYear(), m.getMonth() + d, 1))
  const cambia = scelta && !stessoGiorno(scelta, semina)
  const etichetta = scelta ? `${p2(scelta.getDate())}/${p2(scelta.getMonth() + 1)}/${scelta.getFullYear()}` : null

  return (
    <div className="im-overlay" role="dialog" aria-modal="true" aria-label="Data di semina" onClick={onClose}>
      <div className="im-modale" onClick={(e) => e.stopPropagation()}>
        <div className="im-modale-head">
          <span className="im-modale-tit">Data di semina</span>
          <div className="spacer" />
          <button type="button" className="im-ic" onClick={onClose} aria-label="Chiudi">
            <Icon path={mdiClose} size={18} />
          </button>
        </div>

        <div className="im-cal-nav">
          <button type="button" className="im-ic" onClick={() => spostaMese(-1)} aria-label="Mese precedente">
            <Icon path={mdiChevronLeft} size={20} />
          </button>
          <span className="im-cal-mese">{MESI[mese.getMonth()]} {mese.getFullYear()}</span>
          <button type="button" className="im-ic" onClick={() => spostaMese(1)} aria-label="Mese successivo">
            <Icon path={mdiChevronRight} size={20} />
          </button>
        </div>

        <div className="im-cal-gg">{GG.map((g) => <span key={g}>{g}</span>)}</div>
        <div className="im-cal-grid">
          {celle.map((d, i) => d === null
            ? <span key={`v${i}`} className="im-cal-v" />
            : (
              <button key={isoDi(d)} type="button"
                className={'im-cal-d'
                  + (stessoGiorno(d, oggi) ? ' oggi' : '')
                  + (stessoGiorno(d, scelta) ? ' sel' : '')
                  + (stessoGiorno(d, semina) ? ' cur' : '')}
                aria-pressed={stessoGiorno(d, scelta)}
                onClick={() => setScelta(d)}>{d.getDate()}</button>
            ))}
        </div>

        <div className="im-modale-piede">
          {/* avviso sobrio, non un allarme: cambiare la semina e' legittimo,
              va solo saputo che trascina tutto il resto */}
          <span className="im-cal-avviso">
            {cambia
              ? <>Confermando, la timeline si riallinea alla nuova data: fasi, eventi e promemoria si ricontano da qui.</>
              : <>Il giorno scelto diventa il giorno 0 della coltura.</>}
          </span>
          <button type="button" className="im-cta im-cta--ok" disabled={!cambia}
            onClick={() => onConferma(isoDi(scelta), etichetta)}>
            <Icon path={mdiCheck} size={18} />Conferma
          </button>
        </div>
      </div>
    </div>
  )
}

function Gruppo({ titolo, icona, children }) {
  return (
    <div className="im-gruppo">
      <div className="im-gruppo-head">
        <Icon path={icona} size={19} color="var(--fg-3)" />
        <span>{titolo}</span>
      </div>
      {children}
    </div>
  )
}

// `nota` = avviso a tutta riga (ricetta gialla dell'app: fondo pieno, testo
// scuro, nessuna icona). `child` = riga figlia, rientrata col filetto.
function Riga({ label, hint, info, child, wide, nota, children }) {
  if (nota) {
    // niente filetto sotto un avviso: il riquadro pieno chiude gia' da solo
    return (
      <div className={'im-riga im-riga--nota' + (child ? ' im-riga--child' : '')}>
        <div className="im-nota">{children}</div>
      </div>
    )
  }
  return (
    <div className={'im-riga' + (child ? ' im-riga--child' : '') + (wide ? ' im-riga--wide' : '')}>
      <div className="im-riga-txt">
        <div className="im-riga-lab">{label}{info && <RowInfo text={info} />}</div>
        {hint && <div className="im-riga-hint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

// Interruttore: 52×32 come nel design. `assente` = valore non pubblicato:
// il pallino sta a meta' strada e il controllo e' inerte, cosi' non si legge
// come "spento" un dato che semplicemente non si conosce.
function Toggle({ on, disabled, assente, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={assente ? 'mixed' : !!on}
      className={'im-sw' + (on && !assente ? ' on' : '') + (assente ? ' na' : '')}
      disabled={disabled} onClick={() => onChange(!on)}>
      <span className="im-sw-knob" />
    </button>
  )
}

// Orario hh:mm in due campi. Si SCRIVE al termine della modifica (blur o
// Invio), non a ogni tasto: un set_datetime per cifra digitata sarebbe una
// raffica di scritture su HA.
function TimeBox({ valore, disabled, onSalva }) {
  const [h, setH] = useState('')
  const [m, setM] = useState('')
  const [tocco, setTocco] = useState(false)
  useEffect(() => {
    if (tocco) return
    const v = valore || ''
    setH(v.slice(0, 2)); setM(v.slice(3, 5))
  }, [valore, tocco])
  const salva = () => {
    setTocco(false)
    const H = Math.max(0, Math.min(23, parseInt(h, 10) || 0))
    const M = Math.max(0, Math.min(59, parseInt(m, 10) || 0))
    const v = `${p2(H)}:${p2(M)}`
    setH(p2(H)); setM(p2(M))
    if (v !== valore) onSalva(v)
  }
  const key = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }
  if (!valore && disabled) return <span className="im-val mono">{EM}</span>
  return (
    <div className={'im-time' + (disabled ? ' off' : '')}>
      <input value={h} disabled={disabled} maxLength={2} inputMode="numeric" aria-label="Ore"
        onChange={(e) => { setTocco(true); setH(e.target.value.replace(/\D/g, '')) }}
        onBlur={salva} onKeyDown={key} />
      <span className="mono">:</span>
      <input value={m} disabled={disabled} maxLength={2} inputMode="numeric" aria-label="Minuti"
        onChange={(e) => { setTocco(true); setM(e.target.value.replace(/\D/g, '')) }}
        onBlur={salva} onKeyDown={key} />
    </div>
  )
}

/* `lab` (facoltativo) = mappa valore→etichetta. AUDIT R2 (R2-4): serve quando
   quello che si SCRIVE non e' quello che si LEGGE — i livelli ventole sono
   `low|medium|high` sull'input_select e «Bassa/Media/Alta» nell'interfaccia.
   Il `value` dell'option resta il valore HA, quindi onSel riceve sempre quello:
   la traduzione e' solo davanti. */
function Select({ valore, opzioni, disabled, onSel, lab }) {
  if (disabled && (valore == null || valore === EM)) return <span className="im-val mono">{EM}</span>
  const et = (o) => (lab && lab[o]) || o
  return (
    <div className="im-select">
      <select value={valore} disabled={disabled} onChange={(e) => onSel(e.target.value)}>
        {!opzioni.includes(valore) && <option value={valore}>{et(valore)}</option>}
        {opzioni.map((o) => <option key={o} value={o}>{et(o)}</option>)}
      </select>
      <Icon path={mdiChevronDown} size={17} color="var(--fg-3)" />
    </div>
  )
}

function ClimateSourceSelect({ value, choices, disabled, label, onSelect }) {
  const known = choices.some((row) => row.entity_id === value)
  return (
    <div className="im-select im-source-select">
      <select value={value} disabled={disabled} aria-label={label}
        onChange={(e) => onSelect(e.target.value)}>
        <option value="" disabled>Seleziona un sensore</option>
        {value && !known && <option value={value}>{value} · non disponibile</option>}
        {choices.map((row) => (
          <option key={row.entity_id} value={row.entity_id}>
            {row.name} · {row.entity_id}
          </option>
        ))}
      </select>
      <Icon path={mdiChevronDown} size={17} color="var(--fg-3)" />
    </div>
  )
}

/* Cursore. Tre accortezze, tutte imparate a spese di qualcuno:
   - si SCRIVE al rilascio (pointerup / fine tasto / blur), non a ogni pixel:
     un input_number.set_value per frame sarebbe una raffica su HA;
   - il valore "in mano" resta LOCALE finche' la lettura non lo conferma —
     altrimenti, fra la scrittura e il giro di polling, il cursore tornerebbe
     indietro da solo (stesso principio dell'eco piu' sopra);
   - `centro` disegna la tacca dello zero (negli offset di taratura il segno
     conta quanto il valore). */
function Slider({ aria, min, max, step, unita, dec, segno, centro, accento, valore, disabled, onSalva }) {
  const [loc, setLoc] = useState(null)     // valore trascinato, non ancora confermato
  const inviatoRef = useRef(null)
  // la lettura ha raggiunto il valore trascinato → il locale non serve piu'
  useEffect(() => {
    if (loc != null && valore != null && Math.abs(valore - loc) < step / 2) setLoc(null)
  }, [valore, loc, step])

  const v = loc != null ? loc : valore
  if (v == null && disabled) return <span className="im-val mono">{EM}</span>
  const pieno = v == null ? 0 : ((v - min) / (max - min)) * 100
  const zero = ((0 - min) / (max - min)) * 100
  // barra colorata: dallo zero al valore per gli offset, da min al valore
  // per le grandezze che partono da zero
  const da = centro ? Math.min(zero, pieno) : 0
  const largo = centro ? Math.abs(pieno - zero) : pieno
  const etichetta = v == null ? EM : `${segno && v > 0 ? '+' : ''}${v.toFixed(dec)} ${unita}`

  const fine = () => {
    if (loc == null) return
    const arrot = +loc.toFixed(dec)
    if (inviatoRef.current === arrot) return          // blur dopo il pointerup: non si riscrive
    if (valore != null && Math.abs(valore - arrot) < step / 2) { setLoc(null); return }
    inviatoRef.current = arrot
    onSalva(arrot)
  }
  return (
    <div className="im-slider" style={accento ? { '--im-accent': accento } : undefined}>
      <div className="im-track">
        <div className="im-track-bg" />
        <div className="im-track-fill" style={{ left: `${da}%`, width: `${largo}%` }} />
        {centro && <div className="im-notch" style={{ left: `${zero}%` }} />}
        <input type="range" min={min} max={max} step={step} value={v == null ? min : v}
          disabled={disabled} aria-label={aria}
          onChange={(e) => setLoc(parseFloat(e.target.value))}
          onPointerUp={fine} onKeyUp={fine} onBlur={fine} />
      </div>
      <span className="im-slider-val mono">{etichetta}</span>
    </div>
  )
}
