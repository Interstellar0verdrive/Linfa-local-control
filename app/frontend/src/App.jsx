import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiLightbulbOn, mdiWater, mdiSprout, mdiLeaf, mdiFlower, mdiContentCut,
  mdiWaterOutline, mdiChevronRight, mdiChevronDown, mdiChevronUp, mdiTarget,
  mdiCheck, mdiCheckCircle, mdiCircleOutline, mdiLockOutline, mdiProgressClock,
  mdiFlash, mdiHandBackRight, mdiBeakerOutline, mdiCalendarCheck, mdiFan,
  mdiClockOutline, mdiClipboardCheckOutline, mdiCalendarBlankOutline,
  mdiSync, mdiClose, mdiRestore, mdiPencil, mdiCheckBold,
  mdiUnfoldMoreHorizontal, mdiUnfoldLessHorizontal, mdiPlus, mdiNoteEditOutline,
  mdiCogOutline, mdiNoteTextOutline, mdiWaterPump, mdiBookOpenVariant, mdiImageOutline,
  mdiBookMultipleOutline, mdiClockAlertOutline, mdiFlagCheckered,
  mdiGauge, mdiNotebookOutline, mdiTuneVertical,
  mdiWifiOff, mdiAlertCircleOutline,
} from '@mdi/js'
import Stato from './Stato.jsx'
import Controllo from './Controllo.jsx'
import Diario from './Diario.jsx'
import Impostazioni from './Impostazioni.jsx'
import Hint from './Hint.jsx'
import { parseGuide } from './markdown.js'
import { GUIDE_INDEX } from './guideIndex.js'
import { buildModel, normTitolo, fmtDate, fmtWd, fmtWd3, fmtWdLong, fmtDD, fmtDayMonthYear, dosePerGiorno, cascadeMappa, MOVE_CHANGES, RESET_CHANGES, addDays } from './model.js'

const FASE_ICON = {
  germinazione: mdiSprout, vegetativa: mdiLeaf, fioritura: mdiFlower,
  flush: mdiWaterOutline, essiccazione: mdiContentCut,
}

// azione/booster/raccolto = compiti manuali (ambra / verde a fine corsa);
// checkpoint = verifica (neutro).
const TIPO_META = {
  azione:     { label: 'Azione manuale', manual: true,  icon: mdiHandBackRight },
  booster:    { label: 'Booster',        manual: true,  icon: mdiBeakerOutline },
  checkpoint: { label: 'Checkpoint',     manual: false, icon: mdiCalendarCheck },
  raccolto:   { label: 'Raccolto',       manual: true,  icon: mdiContentCut },
}

function Icon({ path, size = 16, color, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none', ...style }}>
      <path d={path} fill={color || 'currentColor'} />
    </svg>
  )
}

// ── Sezioni (porting design v3) ──────────────────────────
// Barra di navigazione a 5 pill. `fase` = in quale fase del porting la
// sezione arriva davvero (null = già viva). NIENTE router/history API:
// sotto Ingress il base path non è prevedibile — solo stato + sessionStorage.
const SEZIONI = [
  { k: 'stato',     l: 'Stato',        icon: mdiGauge,                fase: 2 },
  { k: 'piano',     l: 'Piano',        icon: mdiCalendarBlankOutline, fase: null },
  { k: 'diario',    l: 'Diario',       icon: mdiNotebookOutline,      fase: 4 },
  { k: 'controllo', l: 'Controllo',    icon: mdiTuneVertical,         fase: 3 },
  { k: 'imp',       l: 'Impostazioni', icon: mdiCogOutline,           fase: 4 },
]
const SEZ_KEY = 'serra.sez'
// Pannello aperto in Controllo. Stato SOLLEVATO qui perché non appartiene a
// una sezione sola: le righe Componenti di Stato lo impostano prima di
// navigare, così un tap su "Acqua" atterra già sul pannello giusto.
const CTRL_KEY = 'serra.ctrl'
const CTRL_DEFAULT = 'acqua'   // il primo pannello costruito (Fase 3, step 1)
// ── Due ombre DIVERSE, da non confondere ────────────────────────────────
// 1) Scroller "di sezione": contenitori il cui contenuto passa DAVVERO sotto
//    la fascia nav sticky. Solo loro comandano l'ombra della nav: lo scroller
//    qualunque nodo marcato data-sez-scroll (oggi .st-scroll di Stato e
//    .cc-scroll di Controllo). UN SOLO criterio: l'attributo.
//    NON .tl-scroll: e' lo scroller INTERNO della card timeline, il suo
//    contenuto non passa sotto la nav — li' l'ombra della nav non ha senso.
const SEZ_SCROLLERS = '[data-sez-scroll]'
// 2) Scroller "di riquadro": hanno una testata propria (fratello precedente)
//    sotto cui deve comparire l'ombra quando sono scrollati. Marcati con
//    data-scroll-shadow; il resto e' tutto CSS (vedi app.css, "scroll-shadow
//    degli scroller interni"). Oggi: .tl-scroll e .insp-scroll (ispettore
//    desktop e sheet mobile, stesso componente).
const BOX_SCROLLERS = '[data-scroll-shadow]'
// 3) Fascia ferma "di sezione": alcune sezioni hanno una loro fascia che non
//    scorre (i filtri del Diario, il rail di Controllo). Li' il contenuto
//    passa sotto QUELLA, non sotto la nav: l'ombra della nav cadrebbe SOPRA
//    la fascia e la taglierebbe a meta' (hairline in mezzo ai filtri).
//    Lo scroller che ne ha una la trova marcata data-sez-band, sul nodo
//    stesso: DENTRO lo scroller (rail sticky di Controllo) o come fratello
//    precedente (testata fuori dallo scroller, Diario). Chi non la dichiara
//    resta com'era: e' lui a comandare l'ombra della nav (Stato, Impostazioni).
const SEZ_BANDS = '[data-sez-band]'

// breakpoint alzato: dentro HA c'è quasi sempre la sidebar a mangiare spazio
// ── Timing (audit R1/UI-06-07): TUTTE le attese in un posto solo. ──
// Le coppie reconcile = doppio refetch post-azione (primo assestamento +
// verita' definitiva di HA). PHASE_ANIM_MS deve restare > della transizione
// CSS .ph-days-grid (app.css, .45s).
const RECONCILE_FAST = [700, 1800]    // toggle di un boolean (goAuto)
const RECONCILE_MS   = [900, 2500]    // set_datetime + cascata milestone/flip/reset
const RECONCILE_SLOW = [1500, 5000]   // script con delay interni (diario/segna-fatto)
const RECONCILE_PLAN = [1200, 4000]   // riscrittura YAML piano + reload sensore
const PHASE_ANIM_MS = 450             // = transizione apertura fase in app.css
const AFTER_EXPAND_MS = PHASE_ANIM_MS + 70
const TOAST_MS = 4500
const SEL_FADE_MS = 5000              // outline selezione dopo chiusura modale
const ARM_TIMEOUT_MS = 10000          // disarmo doppia conferma
const CLIMA_POLL_MS = 60000           // refresh dati live a pannello aperto
// Dati non freschi = sbiaditi. Stesso valore di Stato.jsx e Controllo.jsx
// (design r.581-585): un solo grado di attenuazione in tutta l'app.
const DIM_OFF = 0.42
// Stati-sentinella di HA = ASSENZA di valore (come BAD_STATES in model.js).
const VUOTO = new Set(['', '-', 'unavailable', 'unknown', 'none', 'null'])
const noto = (s) => s != null && !VUOTO.has(String(s).trim().toLowerCase())

// ml reali da una dose in ml/L (audit R1/UI-15: era copiata in 3 punti —
// e' il numero che finisce in vasca, DEVE avere un'unica definizione)
const mlDose = (mlPerL, litri) => Math.round((mlPerL || 0) * litri * 10) / 10

// Comportamento comune delle modali (audit R1/UI-04): Escape chiude e lo
// scroll del fondo resta bloccato finche' la modale e' aperta.
// AUDIT R5 (M-13): la callback arriva quasi sempre RICREATA a ogni render
// (arrow inline, o una funzione del corpo del componente). Metterla nelle deps
// rifaceva add/remove del listener e due scritture su body.style a OGNI render
// — lo stesso difetto gia' corretto per l'ispettore mobile. Il ref la tiene
// sempre fresca senza far ripartire l'effetto, che ora monta una volta sola.
function useModal(onClose) {
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

const NARROW_MQ = '(max-width: 1150px)'
function useMedia(query) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const fn = (e) => setOn(e.matches)
    setOn(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [query])
  return on
}
const useNarrow = () => useMedia(NARROW_MQ)

// Scroll animato (~1s, ease-in-out) che centra `el` nel suo contenitore
// .tl-scroll. Usato dal load iniziale e dal bottone "Oggi". Rispetta
// prefers-reduced-motion (salto istantaneo). Leggero: solo rAF, niente librerie.
function smoothScrollCenter(el, ms = 1000) {
  if (!el) return
  const scroller = el.closest('.tl-scroll')
  if (!scroller || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollIntoView({ block: 'center' })
    return
  }
  const start = scroller.scrollTop
  // delta via rect (riflette lo scroll CORRENTE, robusto rispetto a offsetParent):
  // quanto muovere per centrare `el` nel viewport dello scroller.
  const cRect = scroller.getBoundingClientRect()
  const eRect = el.getBoundingClientRect()
  const delta = (eRect.top - cRect.top) - (scroller.clientHeight / 2 - eRect.height / 2)
  const max = scroller.scrollHeight - scroller.clientHeight
  const end = Math.max(0, Math.min(start + delta, max))
  const t0 = performance.now()
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms)
    scroller.scrollTop = start + (end - start) * ease(p)
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

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

export default function App() {
  const [payload, setPayload] = useState(null)
  const [err, setErr] = useState(null)
  const [selG, setSelG] = useState(null)
  const [showInsp, setShowInsp] = useState(false)   // modale (solo narrow)
  const [openPhases, setOpenPhases] = useState(null)  // fasi espanse (null = default: solo la corrente)
  const [notesMap, setNotesMap] = useState({})        // { "YYYY-MM-DD": ["nota", ...] }
  const [planOpen, setPlanOpen] = useState(false)   // v3: editor del piano
  const [toast, setToast] = useState(null)
  const [animFrom, setAnimFrom] = useState(null)    // {g, key}: cascata visiva
  const [busy, setBusy] = useState(false)
  const [resetAsk, setResetAsk] = useState(null)    // milestone in attesa di conferma reset
  const [guidaOpen, setGuidaOpen] = useState(null)  // topic guida aperta in overlay (o null)
  // Sezione attiva. All'ingresso si atterra su STATO: e' la vista d'insieme,
  // la risposta alla domanda che si ha aprendo l'app ("come va?"). Il Piano si
  // sceglie quando si vuole lavorare sui giorni.
  // sessionStorage (non local): un reload dell'iframe HA non riporta indietro,
  // ma la scelta non resta appiccicata per sempre.
  const [sez, setSez] = useState(() => {
    try {
      const s = sessionStorage.getItem(SEZ_KEY)
      return SEZIONI.some((x) => x.k === s) ? s : 'stato'
    } catch { return 'stato' }
  })
  useEffect(() => {
    try { sessionStorage.setItem(SEZ_KEY, sez) } catch { /* storage negato: pazienza */ }
  }, [sez])
  // Pannello di Controllo: stessa politica della sezione (sessionStorage, non
  // local) — l'ultimo pannello visitato sopravvive a un reload dell'iframe.
  const [ctrlPanel, setCtrlPanel] = useState(() => {
    try { return sessionStorage.getItem(CTRL_KEY) || CTRL_DEFAULT } catch { return CTRL_DEFAULT }
  })
  useEffect(() => {
    try { sessionStorage.setItem(CTRL_KEY, ctrlPanel) } catch { /* storage negato: pazienza */ }
  }, [ctrlPanel])
  const todayRef = useRef(null)
  // AUDIT R5 (M-14): segna-fatto in volo, PER EVENTO. Con un solo boolean
  // globale, segnare A e subito dopo B faceva cadere B senza nessun feedback.
  const doneRef = useRef(new Set())
  // AUDIT R2 (MD2-14): specchio di `busy` leggibile dal tick del polling
  // senza rilegare l'interval a ogni cambio di stato.
  const busyRef = useRef(false)
  useEffect(() => { busyRef.current = busy }, [busy])
  /* AUDIT R5 (I-11): guardia SINCRONA delle azioni. `busy` e' stato React e
     il `disabled` che ne deriva si applica solo dal render dopo: due consegne
     dello stesso click (o un doppio tap svelto) passavano entrambe, e su
     concludiColtura o resetMilestone erano due chiamate vere a HA. Il ref si
     alza nello stesso istante di `busy` — resta separato da busyRef, che
     serve al polling e continua a specchiarsi via effetto.
     AUDIT R2 (M-R2-1): `azione()` CONTA, non commuta. Prima markDone/markUndone
     alzavano `busy` per conto loro con un setBusy nudo: se due cose si
     sovrapponevano, la prima che finiva spegneva `busy` per tutte e il polling
     poteva rientrare dentro la finestra ottimistica dell'altra (MD2-14). Ora
     ogni percorso passa di qui e `busy` si spegne quando l'ULTIMO ha finito.
     AUDIT R3 (M-R3-6): il Set per-titolo di markDone/markUndone (doneRef)
     RESTA, ma come seconda linea di difesa. Da quando ogni percorso passa da
     azione(), `busy` alza il `disabled` di tutti i «Segna fatto»: il caso per
     cui il Set era nato — segnare B mentre A e' in volo — dalla UI non e' piu'
     raggiungibile. Il Set copre quindi solo cio' che sfugge al render (due
     consegne dello stesso click) e resta la rete se un domani i bottoni
     smettessero di guardare `busy`. */
  const inVoloRef = useRef(0)
  const actionRef = useRef(false)
  const azione = (v) => {
    inVoloRef.current = Math.max(0, inVoloRef.current + (v ? 1 : -1))
    const occupato = inVoloRef.current > 0
    actionRef.current = occupato
    setBusy(occupato)
  }
  const fadeRef = useRef(null)   // mobile: spegne la selezione ~5s dopo la chiusura modale
  const scrolledRef = useRef(false)  // auto-scroll a OGGI solo al PRIMO load
  const pendingScrollRef = useRef(false)  // scroll a OGGI dopo aver espanso la fase corrente
  const narrow = useNarrow()

  /* ── Scroll-shadow (design v3 r.199 "navShadow") ──────────────────────
     UN SOLO listener in CAPTURE sul contenitore .app che serve DUE ombre:
     · sotto la nav sezioni  → scroller di sezione (SEZ_SCROLLERS), classe
       .scrolled sul nodo della nav;
     · sotto la testata di un riquadro → scroller interni (BOX_SCROLLERS),
       classe .sc-on sullo scroller STESSO (il CSS risale alla testata).
     GENERICHE per costruzione: una sezione futura eredita la prima mettendo
     data-sez-scroll, un riquadro futuro la seconda mettendo data-scroll-shadow.
     Zero setState: le classi le scrive direttamente sui nodi, cosi' lo scroll
     non provoca render (e i boolean cambiano comunque di rado). */
  const appRef = useRef(null)
  const navRef = useRef(null)
  useEffect(() => {
    const root = appRef.current
    const nav = navRef.current
    if (!root || !nav) return undefined
    let on = null
    const apply = (v) => { if (v !== on) { on = v; nav.classList.toggle('scrolled', v) } }
    const isScrolled = (el) => el.scrollTop > 2
    // dedupe anche per gli scroller di riquadro: la classe la si tocca solo
    // quando cambia davvero (uno scroll spara decine di eventi al secondo).
    // La classe va ANCHE sulla testata (fratello precedente): affidarsi a
    // `:has(+ .sc-on)` per la parte dinamica inciampa nell'invalidazione
    // pigra di Chromium (matches() dice si', il ricalcolo stili non parte).
    const applyBox = (el, v) => {
      if (el.classList.contains('sc-on') !== v) {
        el.classList.toggle('sc-on', v)
        const head = el.previousElementSibling
        if (head) head.classList.toggle('sc-under', v)
      }
    }
    // Fascia ferma di sezione (SEZ_BANDS): si cerca UNA volta per scroller e
    // si memorizza — la mappa vive quanto l'effetto, che si rimonta a ogni
    // cambio sezione e a ogni poll. Senza cache sarebbe una querySelector su
    // tutto il sottoalbero a ogni evento di scroll.
    const bands = new Map()
    const bandOf = (el) => {
      if (bands.has(el)) return bands.get(el)
      const prev = el.previousElementSibling
      const b = el.querySelector(SEZ_BANDS) || (prev && prev.matches(SEZ_BANDS) ? prev : null)
      bands.set(el, b)
      return b
    }
    // stessa classe del caso "riquadro": l'ombra e' la stessa convenzione,
    // cambia solo chi la porta (qui la fascia, li' la testata della card).
    const applyBand = (band, v) => {
      if (band.classList.contains('sc-under') !== v) band.classList.toggle('sc-under', v)
    }
    // al cambio sezione nessuno scrolla: la sezione appena mostrata puo' avere
    // gia' uno scrollTop suo (resta montata), quindi si risincronizza a mano
    // guardando SOLO gli scroller visibili (offsetParent null = display:none).
    const sync = () => {
      let v = false
      root.querySelectorAll(SEZ_SCROLLERS).forEach((el) => {
        if (el.offsetParent === null) return
        const on = isScrolled(el)
        const band = bandOf(el)
        // con una fascia propria l'ombra la porta lei: la nav resta pulita
        if (band) applyBand(band, on)
        else if (on) v = true
      })
      apply(v)
      root.querySelectorAll(BOX_SCROLLERS).forEach((el) => {
        if (el.offsetParent !== null) applyBox(el, isScrolled(el))
      })
    }
    sync()
    const onScroll = (e) => {
      const t = e.target
      if (!t || t.nodeType !== 1) return
      // ombra sotto la testata del riquadro: vale anche se il riquadro e'
      // dentro una sezione nascosta (non si vede, non fa danno).
      if (t.matches(BOX_SCROLLERS)) applyBox(t, isScrolled(t))
      if (!t.matches(SEZ_SCROLLERS)) return
      // nascondendo una sezione il browser puo' azzerarne lo scrollTop e
      // sparare un evento: e' lo scroller USCENTE, non comanda piu' nulla
      // (a decidere ci pensa il sync() del giro successivo dell'effetto).
      if (t.offsetParent === null) return
      const band = bandOf(t)
      if (band) { applyBand(band, isScrolled(t)); return }
      apply(isScrolled(t))
    }
    root.addEventListener('scroll', onScroll, true)
    return () => root.removeEventListener('scroll', onScroll, true)
    // `payload` non e' usato dentro: serve solo come segnale che .app ESISTE
    // (prima del primo caricamento il render e' lo schermo "Carico il piano…"
    // e appRef sarebbe null). Poi cambia a ogni poll: riattaccare un listener
    // una volta al minuto non costa nulla e risincronizza pure l'ombra.
  }, [sez, payload])

  // AUDIT R1 (UI-01): l'errore fa cadere la UI SOLO al primo caricamento;
  // sui refetch di background (riconciliazioni post-azione) un blip di rete
  // diventa un toast e la UI resta in piedi con i dati precedenti. Il check
  // r.ok evita che un 500 con corpo HTML esploda dentro r.json().
  const load = useCallback((opts = {}) => {
    return fetch('api/timeline')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => { setPayload(j); setErr(null) })
      .catch((e) => {
        if (opts.initial) setErr(String(e))
        else setToast(`Aggiornamento non riuscito (${e.message}) — dati non aggiornati`)
      })
  }, [])
  useEffect(() => { load({ initial: true }) }, [load])
  const reconcile = (ms) => ms.forEach((t) => setTimeout(load, t))
  // Escape/scroll-lock per la modale ispettore su mobile (inline, non puo'
  // usare useModal: e' renderizzata condizionalmente dentro App)
  // chiusura modale (mobile): l'outline di selezione resta ~5s a indicare
  // "cosa ho appena aperto", poi si spegne e sfuma (transizione CSS).
  // AUDIT R2 (MD2-12): definita QUI, sopra l'effetto che la usa e sopra gli
  // early-return — se un render usciva presto (model null durante un riavvio
  // HA) la closure dell'effetto restava in TDZ e un Escape lanciava
  // ReferenceError.
  const closeInsp = () => {
    setShowInsp(false)
    clearTimeout(fadeRef.current)
    fadeRef.current = setTimeout(() => setSelG(null), SEL_FADE_MS)
  }
  useEffect(() => {
    if (!(narrow && showInsp)) return undefined
    const onKey = (e) => { if (e.key === 'Escape') closeInsp() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    // AUDIT R2 (MD2-12): deps esplicite — senza array l'effetto rifaceva
    // add/remove del listener e due scritture su body.style a OGNI render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, showInsp])
  // AUDIT R1 (UI-16): il pannello resta aperto per ore (tablet/iframe HA) e
  // clima/badge restavano CONGELATI all'apertura. Refresh leggero: ogni 60s
  // se la scheda e' visibile + subito quando torna visibile.
  useEffect(() => {
    // AUDIT R2 (MD2-14): niente refetch mentre un'azione ottimistica e' in
    // volo (busy) — un visibilitychange tra applyLocal e la ricomputa HA
    // riportava la mappa vecchia (timeline che rimbalza indietro-avanti).
    const tick = () => { if (!document.hidden && !busyRef.current) load() }
    const iv = setInterval(tick, CLIMA_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  const loadNotes = useCallback(() => fetch('api/note')
    .then((r) => r.json())
    .then((j) => { if (j.ok) setNotesMap(j.notes || {}) })
    .catch(() => {}), [])
  useEffect(() => { loadNotes() }, [loadNotes])
  // salva l'array note di UN giorno (ottimistico; [] cancella il giorno)
  const saveNote = async (dateISO, notes) => {
    setNotesMap((m) => {
      const n = { ...m }
      if (notes.length) n[dateISO] = notes; else delete n[dateISO]
      return n
    })
    try {
      const r = await fetch('api/note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateISO, notes }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'salvataggio nota fallito')
    } catch (e) {
      setToast(`Errore nota: ${e.message}`)
      loadNotes()
    }
  }

  const model = useMemo(() => (payload ? buildModel(payload) : null), [payload])
  // NB: selG parte da null (nessuna selezione) — OGGI NON è auto-selezionato,
  // così non ha un outline permanente al caricamento. L'ispettore desktop
  // ripiega su OGGI solo per avere contenuto (vedi inspDay sotto).

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  // al PRIMO caricamento centra la riga OGGI (una volta sola: il guard evita
  // di strappare lo scroll ad ogni refetch successivo).
  // Con il Piano nascosto (sez !== 'piano') le misure sono a zero: rimanda
  // senza consumare il guard, così lo scroll avviene al primo ingresso in Piano.
  // AFTER_EXPAND_MS e non rAF: al primo paint la fase corrente sta ancora
  // animando l'apertura (grid .3s) e OGGI misurerebbe la posizione sbagliata.
  useEffect(() => {
    if (!model || scrolledRef.current || sez !== 'piano') return
    // Il primo paint NON e' affidabile: PhaseBar (flex-grow .38s) e apertura
    // fase animano, e il layout puo' essere ancora schiacciato (misurato dal
    // vivo: .tl-scroll a 38px, poi 431px). Un timeout fisso misura stantio;
    // qui si campiona finche' l'altezza dello scroller e l'offset di OGGI
    // restano identici per due giri consecutivi, poi si centra una volta sola.
    let last = null, tries = 0
    const iv = setInterval(() => {
      const el = todayRef.current
      const sc = el && el.closest('.tl-scroll')
      if (scrolledRef.current) { clearInterval(iv); return }
      // layout non pronto (prima del paint utile, o tab/iframe nascosti:
      // viewport 0 => tutto collassato): aspetta senza consumare tentativi.
      if (!el || !sc || sc.clientHeight < 150) { last = null; return }
      if (++tries > 25) { clearInterval(iv); return }  // ~3s da layout pronto: rinuncia, niente strappi tardivi
      const cur = sc.clientHeight + ':' + Math.round(el.getBoundingClientRect().top)
      if (cur === last) {
        clearInterval(iv)
        scrolledRef.current = true
        smoothScrollCenter(el)
      } else last = cur
    }, 120)
    return () => clearInterval(iv)
  }, [model, sez])

  // scroll a OGGI differito: dopo che "Oggi" ha espanso la fase corrente.
  // Attende la fine dell'animazione (grid .3s) così misura la posizione finale.
  useEffect(() => {
    if (!pendingScrollRef.current || !todayRef.current) return
    pendingScrollRef.current = false
    setTimeout(() => smoothScrollCenter(todayRef.current), AFTER_EXPAND_MS)
  })

  // AUDIT R3 (MD3-06): anche l'errore primario ha il Riprova (il polling
  // da 60s resta comunque attivo: gli hook stanno sopra gli early-return).
  if (err) return (
    <div className="boot error">
      Errore: {err}
      <button className="btn-oggi" style={{ marginLeft: 12 }} onClick={() => load({ initial: true })}>Riprovare</button>
    </div>
  )
  // AUDIT R2 (MD2-07/MD-05): payload arrivato ma modello non costruibile
  // (mappa none = piano rotto, semina/giorno invalidi = HA in transitorio)
  // NON e' un caricamento: dirlo e offrire il retry, non uno spinner eterno.
  if (!model && payload) return (
    <div className="boot error">
      Dati del piano non leggibili in questo momento.
      Controllare serra_piano.yaml se persiste.
      <button className="btn-oggi" style={{ marginLeft: 12 }} onClick={() => load({ initial: true })}>Riprovare</button>
    </div>
  )
  if (!model) return <div className="boot">Carico il piano…</div>

  /* ── I DUE SEGNALI GLOBALI DELLA CENTRALINA ───────────────────────────
     Arrivano dal `model` (api/timeline), non da una sonda dedicata: leggerli
     da api/stato costava una GET /states completa al minuto per due campi.
     Alimentano lo stato GLOBALE dell'app — banner sopra la nav e clima
     sbiadito nell'header.
     Un campo che non arriva (payload vecchio) NON diventa "offline": resta
     "non lo so", perche' dichiarare offline una centralina che magari sta
     benissimo sarebbe l'esatto opposto dell'onesta' che si cerca qui. */
  const bridgeVivo = (s) => s === 'on' || s === 'true' || s === 'True' || s === 'online'
  const centralinaOff = noto(model.bridgeOnline) ? !bridgeVivo(String(model.bridgeOnline)) : false
  const erroreComp = noto(model.erroreComponente) ? String(model.erroreComponente) : null

  // fasi espanse: default (null) = solo la corrente. expand/collapse-all le sovrascrive.
  const validFasi = model.fasi.filter((f) => f.valid)
  const openSet = openPhases ?? new Set(validFasi.filter((f) => f.current).map((f) => f.key))
  const allExpanded = validFasi.length > 0 && validFasi.every((f) => openSet.has(f.key))
  const togglePhase = (k) => {
    const next = new Set(openSet)
    next.has(k) ? next.delete(k) : next.add(k)
    setOpenPhases(next)
  }
  const toggleAll = () => setOpenPhases(allExpanded ? new Set() : new Set(validFasi.map((f) => f.key)))

  const allDays = model.fasi.flatMap((f) => f.days)
  const selDay = allDays.find((d) => d.g === selG) || null   // selezione ATTIVA (può essere null)
  const selFase = selDay ? model.fasi.find((f) => selDay.g >= f.start && selDay.g <= f.end) : null
  // l'ispettore desktop mostra il giorno selezionato, o OGGI se niente è selezionato
  // AUDIT R2 (MD2-03): oltre la fine del piano (post-Concludi, o piano
  // esaurito senza taglio confermato) nessun giorno ha g === oggi — si
  // ripiega sull'ULTIMO giorno invece di far sparire l'ispettore.
  const inspDay = selDay || allDays.find((d) => d.g === model.oggi) || allDays[allDays.length - 1] || null
  const inspFase = inspDay ? model.fasi.find((f) => inspDay.g >= f.start && inspDay.g <= f.end) : null

  const goToday = () => {
    clearTimeout(fadeRef.current)
    setSelG(null)   // solo "porta a oggi": nessun outline forzato su OGGI
    // se la fase corrente è collassata, la riga OGGI non è nel DOM: espandila
    // prima, poi scrolla dopo il render (via pendingScrollRef + effetto sotto).
    const curKeys = validFasi.filter((f) => f.current).map((f) => f.key)
    if (curKeys.some((k) => !openSet.has(k))) {
      setOpenPhases(new Set([...openSet, ...curKeys]))
      pendingScrollRef.current = true
    } else {
      smoothScrollCenter(todayRef.current)
    }
  }

  // pill "N in ritardo" (notifiche v2): porta alla PIÙ VECCHIA azione in
  // ritardo — espande la sua fase se chiusa, seleziona il giorno (su mobile
  // apre la modale) e centra la riga (attesa lunga se la fase deve aprirsi).
  const nRitardo = (model?.pendenti || []).filter((p) => p.ritardo > 0).length
  // F1: chiusura esplicita della coltivazione (CTA in fondo allo schedule).
  // Usa il flusso 'fine' esistente (serra_coltivazione_ciclo: spegne ventole,
  // pulisce il latch booster, scrive TERMINATA nel diario).
  const concludiColtura = async () => {
    if (busy || actionRef.current) return
    azione(true)
    try {
      await callService('input_boolean', 'turn_off', { entity_id: 'input_boolean.serra_coltivazione_attiva' })
      azione(false)
      setToast('Coltivazione conclusa · la serra si spegne 🏁')
      reconcile(RECONCILE_FAST)
    } catch (e) {
      azione(false)
      setToast(`Errore: ${e.message}`)
      load()
    }
  }

  const goRitardo = () => {
    const first = (model?.pendenti || []).filter((p) => p.ritardo > 0)
      .sort((a, b) => a.g - b.g)[0]
    if (!first) return
    const f = validFasi.find((x) => first.g >= x.start && first.g <= x.end)
    const mustOpen = f && !openSet.has(f.key)
    if (mustOpen) setOpenPhases(new Set([...openSet, f.key]))
    selectDay(first.g)
    setTimeout(() => {
      smoothScrollCenter(document.querySelector(`.day[data-g="${first.g}"]`))
    }, mustOpen ? AFTER_EXPAND_MS : 60)
  }
  const selectDay = (g) => {
    clearTimeout(fadeRef.current)
    setSelG(g)
    if (narrow) setShowInsp(true)
  }

  // ── v2: spostamento milestone con cascata OTTIMISTICA ───
  // Al tap la cascata si applica SUBITO in locale (cascadeMappa rispecchia
  // il Jinja di serra_fasi_effettive) così l'animazione parte istantanea;
  // HA resta la verità: la chiamata parte in parallelo e si rilegge dopo.
  const applyLocal = (changesFn) => {
    setPayload((p) => {
      const next = structuredClone(p)
      const fx = next.entities['sensor.serra_fasi_effettive']
      fx.attributes.mappa = cascadeMappa(fx.attributes.mappa, changesFn())
      return next
    })
  }

  const moveMilestone = async (ms, dir) => {
    if (busy || actionRef.current) return
    const fase = model.fasi[ms.faseIdx]
    const newStart = ms.g + dir
    // AUDIT R3 (MD3-05): niente return muto — con una fase scavalcata il
    // minimo puo' superare la posizione attuale e il tap non faceva nulla.
    if (newStart < ms.minStart) { setToast(`Non prima della fase precedente (g${ms.minStart})`); return }
    // AUDIT R1 (MD-02): mai oltre l'inizio della fase successiva confermata
    if (ms.maxStart != null && newStart > ms.maxStart) {
      setToast(`Non oltre l'inizio confermato della fase successiva (g${ms.maxStart + 1})`)
      return
    }
    // AUDIT R1 (MD-03): niente scritture con date invalide (HA in riavvio)
    const iso = model.isoOfDay(newStart)
    if (!iso) { setToast('Date non disponibili in questo momento: riprovare'); return }
    azione(true)
    applyLocal(() => MOVE_CHANGES[fase.key](newStart))
    setAnimFrom((a) => ({ g: Math.min(newStart, ms.g), key: (a?.key || 0) + 1 }))
    const downstream = model.fasi.slice(ms.faseIdx + 1).filter((f) => f.valid && !f.confirmed).map((f) => f.label)
    setToast(
      `Inizio ${fase.label} ${dir > 0 ? 'posticipato' : 'anticipato'} di 1 giorno` +
      (downstream.length ? ` · a cascata: ${downstream.join(', ')}` : '')
    )
    try {
      await callService('input_datetime', 'set_datetime', {
        entity_id: ms.entity,
        date: iso,
      })
      azione(false)
      reconcile(RECONCILE_MS)
    } catch (e) {
      azione(false)
      setToast(`Errore: ${e.message}`)
      load()                  // rollback allo stato reale
    }
  }

  // Flip 12/12 (fotoperiodica): imposta inizio fioritura al giorno scelto e
  // conferma → HA fa partire la fioritura e la cascata a valle. Ottimistico.
  const goFlip = async (flipDay) => {
    if (busy || actionRef.current) return
    // AUDIT R1 (MD-03): niente scritture con date invalide
    const iso = model.isoOfDay(flipDay)
    if (!iso) { setToast('Date non disponibili in questo momento: riprovare'); return }
    azione(true)
    applyLocal(() => MOVE_CHANGES.fioritura(flipDay))
    setAnimFrom((a) => ({ g: flipDay, key: (a?.key || 0) + 1 }))
    setToast(`Flip a fioritura il g${flipDay} · parte la cascata`)
    try {
      await callService('input_datetime', 'set_datetime', {
        entity_id: 'input_datetime.serra_inizio_fioritura',
        date: iso,
      })
      await callService('input_boolean', 'turn_on', { entity_id: 'input_boolean.serra_conferma_fioritura' })
      azione(false)
      reconcile(RECONCILE_MS)
    } catch (e) {
      azione(false)
      setToast(`Errore: ${e.message}`)
      load()
    }
  }

  // ── v2b: segna fatto ─────────────────────────────────────
  // Scrive `Piano · FATTO: <titolo>` nel diario (= lo stato "fatto" che la UI
  // rilegge). Per cambio acqua / booster lancia ANCHE lo script completo di
  // conferma (timestamp + diario + dose dal piano + rilettura livello),
  // fire-and-forget perché ha delay interni.
  const markDone = async (ev) => {
    // guardia SINCRONA (ref, non state): un solo giro anche se il click
    // viene consegnato due volte nello stesso tick. E' PER EVENTO: segnare
    // un'attivita' mentre un'altra e' in volo deve funzionare.
    const chiave = normTitolo(ev.titolo)
    if (doneRef.current.has(chiave) || ev.done) return
    doneRef.current.add(chiave)
    const isCambio = ev.tipo === 'booster' || /cambio\s+acqua/i.test(ev.titolo)
    azione(true)   // conteggio condiviso, vedi la nota su azione()
    // AUDIT R2 (MD2-04): l'ottimismo va sull'ATTR `fatti` — dal fix P0-1 e'
    // quello che statoEvento legge (il patch sul solo log era diventato un
    // no-op: card senza feedback fino a 5s e finestra di doppio-FATTO,
    // perche' ev.done restava falso). Il log si patcha comunque (fallback).
    setPayload((p) => {
      const next = structuredClone(p)
      const d = next.entities['sensor.serra_diario']
      if (d) {
        // AUDIT R3 (MD3-04): si patcha `fatti` SOLO se esisteva — crearlo dal
        // nulla (diario giu') riaccendeva fattiOk con UNA voce e generava
        // falsi pendenti dallo stesso ottimismo.
        if (d.attributes.fatti && typeof d.attributes.fatti === 'object') {
          d.attributes.fatti = { ...d.attributes.fatti, [normTitolo(ev.titolo)]: 'FATTO' }
        }
        // AUDIT R4 (R4C-03): anche il log solo se gia' presente — crearlo dal
        // nulla riaccendeva fattiOk e generava falsi pendenti (race stretta).
        if (d.attributes.log) d.attributes.log = `· Piano · FATTO: ${ev.titolo}\n` + d.attributes.log
      }
      return next
    })
    try {
      if (isCambio) {
        // AUDIT R2: senza_fatto=true — il FATTO qui lo scrive il pannello con
        // il titolo ESATTO dell'evento toccato; lo script (RT2-04) lo scrive
        // solo per le conferme fuori dal pannello (CTA dashboard).
        await callService('script', 'turn_on', {
          entity_id: 'script.serra_acqua_cambio_fatto',
          variables: { senza_fatto: true },
        })
      }
      // fire-and-forget via script.turn_on: la chiamata sincrona aspettava
      // l'intero script e con HA impegnato superava il timeout ("timed out"
      // spurio: la riga poi arrivava comunque). turn_on ritorna subito.
      await callService('script', 'turn_on', {
        entity_id: 'script.serra_diario_scrivi',
        variables: { msg: `Piano · FATTO: ${ev.titolo}` },
      })
      setToast(isCambio
        ? `Cambio acqua confermato — dose dal piano in corso · registrato nel diario`
        : `Fatto: ${ev.titolo} · registrato nel diario`)
      reconcile(RECONCILE_SLOW)
    } catch (e) {
      setToast(`Errore: ${e.message}`)
      load()  // rollback allo stato reale
    }
    azione(false)
    doneRef.current.delete(chiave)
  }

  // annulla un "fatto" (tap per sbaglio): riga ANNULLATO nel diario —
  // append-only, lo storico resta e vince la riga piu' recente.
  const markUndone = async (ev) => {
    const chiave = normTitolo(ev.titolo)
    if (doneRef.current.has(chiave) || !ev.done) return
    doneRef.current.add(chiave)
    azione(true)
    setPayload((p) => {
      const next = structuredClone(p)
      const d = next.entities['sensor.serra_diario']
      if (d) {
        // AUDIT R2 (MD2-04)/R3 (MD3-04): come markDone — solo se esisteva
        if (d.attributes.fatti && typeof d.attributes.fatti === 'object') {
          d.attributes.fatti = { ...d.attributes.fatti, [normTitolo(ev.titolo)]: 'ANNULLATO' }
        }
        if (d.attributes.log) d.attributes.log = `· Piano · ANNULLATO: ${ev.titolo}\n` + d.attributes.log
      }
      return next
    })
    try {
      await callService('script', 'turn_on', {
        entity_id: 'script.serra_diario_scrivi',
        variables: { msg: `Piano · ANNULLATO: ${ev.titolo}` },
      })
      setToast(`Annullato: ${ev.titolo}`)
      reconcile(RECONCILE_SLOW)
    } catch (e) {
      setToast(`Errore: ${e.message}`)
      load()
    }
    azione(false)
    doneRef.current.delete(chiave)
  }

  const resetMilestone = async (ms) => {
    if (busy || actionRef.current) return
    const fase = model.fasi[ms.faseIdx]
    const unflipFoto = model.foto && fase.key === 'fioritura'   // annullo del flip in fotoperiodica
    azione(true)
    applyLocal(() => RESET_CHANGES[fase.key]())
    setAnimFrom((a) => ({ g: Math.min(ms.g, ms.planStart ?? ms.g), key: (a?.key || 0) + 1 }))
    setToast(unflipFoto
      ? 'Flip annullato: ritorno in vegetativa, flush ed essiccazione azzerati'
      : `Inizio ${fase.label}: tornato al piano${ms.planStart != null ? ` (g${ms.planStart})` : ''}`)
    try {
      await callService('input_boolean', 'turn_off', { entity_id: ms.confermaEntity })
      // Annullare il flip resetta anche le fasi a valle: flush ed essiccazione
      // tornano a derivare dal prossimo flip (niente milestone orfane pinnate).
      if (unflipFoto) {
        await callService('input_boolean', 'turn_off', { entity_id: 'input_boolean.serra_conferma_flush' })
        await callService('input_boolean', 'turn_off', { entity_id: 'input_boolean.serra_conferma_essiccazione' })
      }
      azione(false)
      reconcile(RECONCILE_MS)
    } catch (e) {
      azione(false)
      setToast(`Errore: ${e.message}`)
      load()
    }
  }

  // Passa un componente (luci/acqua/ventole) da LIBERO a PIANIFICATO: riattiva
  // lo schedule (input_boolean.serra_schedule_*). Ottimistico + refetch.
  const goAuto = async (scheduleEntity, label) => {
    if (busy || actionRef.current) return
    azione(true)
    setToast(`${label}: passato in Pianificato`)
    try {
      await callService('input_boolean', 'turn_on', { entity_id: scheduleEntity })
      azione(false)
      reconcile(RECONCILE_FAST)
    } catch (e) {
      azione(false)
      setToast(`Errore: ${e.message}`)
      load()
    }
  }

  return (
    <div className="app" ref={appRef}>
      <Header model={model} off={centralinaOff} onEditPlan={() => setPlanOpen(true)} />
      {/* AUDIT R2 (cluster F1): stato "conclusa" ben visibile in TUTTI i
          layout (la cella meta dell'header sparisce sotto i 1200px). */}
      {!model.coltivazioneAttiva && (
        <div className="conclusa-banner" role="status">
          <Icon path={mdiFlagCheckered} size={15} />
          Coltivazione non attiva — il ciclo è chiuso. Timeline in sola consultazione.
        </div>
      )}
      {/* ── I DUE STATI PARTICOLARI GLOBALI ────────────────────────────────
          Stessa logica del banner qui sopra: riguardano l'app intera, quindi
          stanno sopra la nav e si vedono da qualunque sezione.
          In STATO non si ripetono: quella sezione ha gia' i suoi banner, che
          dicono anche da quanto manca il contatto e portano il reset — due
          righe identiche a un centimetro di distanza sarebbero un doppione. */}
      {centralinaOff && sez !== 'stato' && (
        <div className="conclusa-banner conclusa-banner--off" role="status">
          <Icon path={mdiWifiOff} size={15} />
          Centralina offline — i valori mostrati sono dell'ultimo contatto, non di adesso.
        </div>
      )}
      {erroreComp && sez !== 'stato' && (
        <div className="conclusa-banner conclusa-banner--errore" role="status">
          <Icon path={mdiAlertCircleOutline} size={15} />
          {/* REGOLA LINK: la via d'uscita non si racconta, si offre. */}
          <span>
            Errore pendente su <b>{erroreComp}</b> — l'azzeramento si fa in{' '}
            <button type="button" className="banner-link" onClick={() => setSez('stato')}>Stato</button>.
          </span>
        </div>
      )}
      <PhaseBar model={model} />
      <SezioneNav sez={sez} onSel={setSez} navRef={navRef} />
      {/* Il Piano resta SEMPRE montato e si nasconde via CSS (.sez-off):
          cambiando sezione non si perdono fasi aperte, selezione e scroll
          della timeline, né si rimontano i suoi effetti. */}
      <div className={'main' + (sez === 'piano' ? '' : ' sez-off')}>
        <div className="tl-card">
          <div className="tl-head">
            <span className="tl-title">Timeline</span>
            <span className="tl-hint">un giorno per i dettagli · frecce sulle milestone</span>
            <div className="spacer" />
            <div className="legend">
              <span><i className="lg-dot past" />Passato</span>
              <span><i className="lg-dot today" />Oggi</span>
              <span><i className="lg-dot future" />Futuro</span>
              <span><i className="lg-dot limbo" />Limbo</span>
            </div>
            {/* i title= della barra sono diventati fumettini (Hint.jsx):
                hover 500 ms su mouse, tap su touch, mai il tooltip nativo */}
            {nRitardo > 0 && (
              <Hint text="Vai alla più vecchia azione in ritardo">
                <button className="btn-ritardo" onClick={goRitardo}>
                  <Icon path={mdiClockAlertOutline} size={15} />
                  {nRitardo} in ritardo
                </button>
              </Hint>
            )}
            {/* niente fumettino: il bottone ha gia' la label "Oggi" */}
            <button className="btn-oggi" onClick={goToday}>
              <Icon path={mdiTarget} size={17} />Oggi
            </button>
            <Hint text={allExpanded ? 'Collassa tutte le fasi' : 'Espandi tutte le fasi'}>
              <button className="btn-icon" onClick={toggleAll}>
                <Icon path={allExpanded ? mdiUnfoldLessHorizontal : mdiUnfoldMoreHorizontal} size={19} />
              </button>
            </Hint>
            <Hint text="Libreria guide">
              <button className="btn-icon" onClick={() => setGuidaOpen('index')}>
                <Icon path={mdiBookMultipleOutline} size={19} />
              </button>
            </Hint>
          </div>
          <Timeline model={model} open={openSet} onToggle={togglePhase}
            selG={selG} inspG={selG != null ? selG : model.oggi} onSelect={selectDay}
            todayRef={todayRef} notesMap={notesMap}
            animFrom={animFrom} busy={busy} onMove={moveMilestone} onReset={setResetAsk}
            onGoFlip={goFlip} onGuida={setGuidaOpen} narrow={narrow} onConcludi={concludiColtura} />
        </div>
        {!narrow && inspDay && inspFase && (
          <Inspector model={model} day={inspDay} fase={inspFase} onDone={markDone} onUndone={markUndone}
            notesMap={notesMap} onSaveNote={saveNote} onGoAuto={goAuto} onGuida={setGuidaOpen} busy={busy} />
        )}
      </div>
      {/* Fase 2: Stato. Come il Piano resta SEMPRE montato e si nasconde via
          CSS (range grafici e indice foto sopravvivono al cambio sezione);
          tutto il suo polling e' spento dalla prop `attiva`. */}
      {/* onToast: i messaggi transitori di Stato (scatto foto) escono nel toast
          globale in basso al centro, non piu' inline sotto il bottone */}
      {/* onFocus: la riga Componenti di Stato sceglie il pannello PRIMA di
          navigare, così l'atterraggio in Controllo è già su quel sottosistema */}
      <Stato attiva={sez === 'stato'} onNav={setSez} onFocus={setCtrlPanel} model={model} onToast={setToast} />
      {/* Fase 3: Controllo. Stessa regola di Stato — sempre montato, nascosto
          via CSS, polling spento dalla prop `attiva`.
          onRefresh: dopo un cambio di modalità il PIANO va riletto (è model.modo
          a dire auto/manuale), non solo api/stato. */}
      <Controllo attiva={sez === 'controllo'} model={model} onToast={setToast}
        focus={ctrlPanel} onFocus={setCtrlPanel} onRefresh={load} onGuida={setGuidaOpen}
        onNav={setSez} />
      {/* Fase 4: Diario. Stessa regola di Stato e Controllo — sempre montato,
          nascosto via CSS (filtri e fasi aperte sopravvivono al cambio
          sezione), polling spento dalla prop `attiva`. */}
      <Diario attiva={sez === 'diario'} model={model} onToast={setToast} onNav={setSez} />
      {/* Fase 4: Impostazioni. Come le altre — sempre montata, nascosta via
          CSS, polling spento dalla prop `attiva`.
          onRefresh: cambiando la DATA DI SEMINA si sposta il giorno 0 e con
          lui l'intera timeline — il piano va riletto, non basta api/stato. */}
      <Impostazioni attiva={sez === 'imp'} model={model} onToast={setToast}
        onNav={setSez} onRefresh={load} centralinaOff={centralinaOff} />
      {narrow && showInsp && selDay && selFase && (
        <div className="insp-overlay" role="dialog" aria-modal="true" aria-label="Dettagli giorno" onClick={closeInsp}>
          <div className="insp-sheet" onClick={(e) => e.stopPropagation()}>
            <Inspector model={model} day={selDay} fase={selFase} onClose={closeInsp}
              onDone={markDone} onUndone={markUndone}
              notesMap={notesMap} onSaveNote={saveNote} onGoAuto={goAuto} onGuida={setGuidaOpen} busy={busy} />
          </div>
        </div>
      )}
      {planOpen && (
        <PlanEditor
          onClose={() => setPlanOpen(false)}
          onSaved={(refreshFailed) => {
            setPlanOpen(false)
            setToast(refreshFailed
              ? 'Piano salvato — riallineamento rimandato al prossimo aggiornamento (~5 min)'
              : 'Piano validato e salvato — la serra si riallinea')
            reconcile(RECONCILE_PLAN)
          }}
        />
      )}
      {resetAsk && (
        <ResetConfirm
          ms={resetAsk}
          fase={model.fasi[resetAsk.faseIdx]}
          foto={model.foto}
          busy={busy}
          onCancel={() => setResetAsk(null)}
          onConfirm={() => { resetMilestone(resetAsk); setResetAsk(null) }}
        />
      )}
      {guidaOpen && (
        <GuideOverlay topic={guidaOpen} onClose={() => setGuidaOpen(null)} onNav={setGuidaOpen} />
      )}
      {/* toast a livello APP: visibile sempre, anche sopra la modale */}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <Icon path={mdiSync} size={19} />
          <span>{toast}</span>
          <button className="toast-x" aria-label="Chiudi avviso" onClick={() => setToast(null)}><Icon path={mdiClose} size={15} /></button>
        </div>
      )}
      {model.dev && <div className="devbadge">DEV · dati fixture</div>}
    </div>
  )
}

// Barra di navigazione delle sezioni (geometria dal design v3: gruppo di
// pill dentro una pillola; attivo = pieno chiaro su testo scuro). I colori
// sono quelli di app.css, non quelli del design.
// Niente fumettini sulle pill: sopra i 700px la label e' scritta dentro il
// bottone (ripeterla sarebbe rumore), sotto sono a sola icona ma li' si e' su
// touch, dove la regola "bottone attivo = solo la sua azione" non le farebbe
// comparire comunque. L'etichetta resta in aria-label per gli screen reader.
function SezioneNav({ sez, onSel, navRef }) {
  return (
    // navRef: App ci scrive/toglie la classe .scrolled (scroll-shadow)
    <nav className="sez-nav" aria-label="Sezioni" ref={navRef}>
      <div className="sez-pills">
        {SEZIONI.map((s) => (
          <button key={s.k} type="button" aria-label={s.l}
            className={'sez-pill' + (s.k === sez ? ' on' : '')}
            aria-current={s.k === sez ? 'page' : undefined}
            onClick={() => onSel(s.k)}>
            <Icon path={s.icon} size={18} />
            <span>{s.l}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

// (SezioneVuota — lo scheletro delle sezioni non ancora portate — e' stata
//  rimossa con la Fase 4: tutte e cinque le sezioni ora esistono davvero.)

// Conferma esplicita per l'annullo di una milestone. Per il flip di una
// fotoperiodica (fioritura confermata) l'effetto è forte → spiega bene cosa
// succede e rassicura che note/attività-fatte non si perdono.
function ResetConfirm({ ms, fase, foto, busy, onCancel, onConfirm }) {
  const isFlip = foto && fase.key === 'fioritura'
  useModal(onCancel)
  return (
    <div className="plan-overlay" role="dialog" aria-modal="true" aria-label="Conferma reset milestone" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-head">
          <span className="confirm-ic" style={{ background: fase.color }}>
            <Icon path={mdiRestore} size={20} color="var(--ink)" />
          </span>
          <b>{isFlip ? 'Annullare il flip a fioritura?' : `Riportare ${fase.label} al piano?`}</b>
        </div>
        <div className="confirm-body">
          {isFlip ? (
            <>
              <p>La coltura torna in <b>vegetativa</b>, di nuovo aperta fino a un prossimo flip.
                Fioritura, flush ed essiccazione <b>spariscono dalla timeline</b> e le loro date
                <b> si azzerano</b> (ripartiranno dal prossimo flip).</p>
              <p className="confirm-safe"><Icon path={mdiCheck} size={16} color="var(--ok)" />
                <span>Note e attività segnate come fatte <b>non si perdono</b>: restano salvate e
                  ricompaiono al prossimo flip.</span></p>
            </>
          ) : (
            <p>La milestone torna alla data prevista dal piano{ms.planStart != null ? ' (g' + ms.planStart + ')' : ''} e le fasi a valle si
              ricalcolano. Note e attività fatte non si perdono.</p>
          )}
        </div>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={onCancel} disabled={busy}>Annulla</button>
          <button className="confirm-ok" style={{ background: fase.color }} onClick={onConfirm} disabled={busy}>
            {isFlip ? 'Sì, annulla il flip' : 'Sì, ripristina il piano'}
          </button>
        </div>
      </div>
    </div>
  )
}

// v3: editor del documento serra_piano.yaml — la validazione la fa il
// backend col parser di HA PRIMA di salvare: un piano rotto non passa mai.
function PlanEditor({ onClose, onSaved }) {
  const [text, setText] = useState(null)
  const [hash, setHash] = useState(null)
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  // AUDIT R1 (UI-05): l'editor e' l'unica modale con dati non salvati — un
  // click sul backdrop scartava mezz'ora di YAML senza chiedere nulla.
  const [loaded, setLoaded] = useState(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = text != null && loaded != null && text !== loaded
  const tryClose = () => {
    if (!dirty) { onClose(); return }
    if (confirmDiscard) { onClose(); return }
    setConfirmDiscard(true)
    setTimeout(() => setConfirmDiscard(false), ARM_TIMEOUT_MS)
  }
  useModal(tryClose)

  useEffect(() => {
    fetch('api/piano')
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || 'caricamento fallito')
        setText(j.yaml)
        setLoaded(j.yaml)
        setHash(j.hash)
      })
      .catch((e) => setErr(String(e.message || e)))
  }, [])

  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      const r = await fetch('api/piano', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: text, base_hash: hash }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'salvataggio fallito')
      // AUDIT R2 (BE2-09): il backend segnala se il refresh del sensore e'
      // fallito (salvato SI', ma la serra si riallinea solo al prossimo
      // polling ~5') — prima il campo veniva ignorato e il toast mentiva.
      onSaved(j.refresh_failed === true)
    } catch (e) {
      setErr(String(e.message || e))
    }
    setSaving(false)
  }

  return (
    <div className="plan-overlay" role="dialog" aria-modal="true" aria-label="Editor del piano" onClick={tryClose}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plan-head">
          <Icon path={mdiPencil} size={18} color="var(--fg-2)" />
          <div className="plan-title">
            <b>Piano di coltivazione</b>
            <span className="mono">serra_piano.yaml</span>
          </div>
          <div className="spacer" />
          <button className="plan-x" aria-label="Chiudi editor" onClick={tryClose}><Icon path={mdiClose} size={19} /></button>
        </div>
        {text == null && !err && <div className="plan-loading">Carico il piano…</div>}
        {text != null && (
          <textarea
            className="plan-text mono"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        {err && <pre className="plan-err">{err}</pre>}
        <div className="plan-foot">
          <span className="plan-hint">Ogni salvataggio viene prima controllato: un piano con errori non viene applicato e la serra continua con l’ultima versione valida.</span>
          <button className={'plan-cancel' + (confirmDiscard ? ' danger' : '')} onClick={tryClose}>
            {confirmDiscard ? 'Scartare le modifiche?' : 'Annulla'}
          </button>
          <button className="plan-save" disabled={saving || text == null} onClick={save}>
            <Icon path={mdiCheckBold} size={17} />{saving ? 'Valido…' : 'Valida e salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Le tre celle del clima nell'header. A centralina offline non si nascondono
// (sparire di colpo e' peggio) e non si spengono a '—': restano, SBIADITE
// come ovunque nell'app, e il fumettino dice perche' — regola dell'app: un
// indicatore di anomalia deve spiegarsi da solo, mai stati visivi muti.
const OFF_HINT = 'Centralina offline: è l’ultimo valore ricevuto, non quello di adesso.'
function ClimaCell({ off, colore, valore, sotto }) {
  const cella = (
    <div className="cell clima" style={off ? { opacity: DIM_OFF } : undefined}>
      <div className="v" style={{ color: colore }}>{valore}</div>
      <div className="k">{sotto}</div>
    </div>
  )
  return off ? <Hint text={OFF_HINT}>{cella}</Hint> : cella
}

function Header({ model, off, onEditPlan }) {
  const f = model.faseCorrente
  const idx = f ? f.idx + 1 : 0
  const dof = f ? model.oggi - f.start + 1 : null
  const amb = f?.ambiente
  // Banda ideale agronomica dalla fase (es. "22-28" / "55-65"), non le soglie ventole del piano
  const parseBand = (s) => {
    if (!s) return null
    const p = String(s).split(/[–-]/).map((x) => parseFloat(x))
    return p.length === 2 && !p.some(isNaN) ? p : null
  }
  // Colore a 3 livelli: dentro banda = verde; poco fuori (entro margine) = arancione; molto fuori = rosso
  const bandColor = (v, band, margin) => {
    if (v == null || !band) return 'var(--fg-1)'
    const [lo, hi] = band
    if (v >= lo && v <= hi) return 'var(--ok)'
    if (v >= lo - margin && v <= hi + margin) return 'var(--warn)'
    return 'var(--danger)'
  }
  // Giorno/notte dalla finestra luci del piano: luci spente = notte → banda temp notturna
  const hm = (s) => { if (!s) return null; const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })()
  let onM = hm(model.luciOn), offM = hm(model.luciOff)
  let isDay = true
  if (onM != null && offM != null) {
    if (offM === 0) offM = 1440                 // mezzanotte = fine giornata
    isDay = onM < offM ? (nowMin >= onM && nowMin < offM) : (nowMin >= onM || nowMin < offM)
  }
  const nightBand = parseBand(model.clima.tempTargetNotte)
  const tempStr = (!isDay && nightBand) ? model.clima.tempTargetNotte : model.clima.tempTarget
  const dayLabel = isDay ? 'giorno' : 'notte'
  const tempBand = parseBand(tempStr)
  const rhBand = parseBand(model.clima.rhTarget)
  const vpdBand = parseBand(model.clima.vpdTarget)
  return (
    <header className="header">
      <div className="coltura-wrap">
        <h1 className="coltura">Coltivazione</h1>
        <Hint text="Modifica il piano di coltivazione">
          <button className="btn-editplan" onClick={onEditPlan}>
            <Icon path={mdiPencil} size={17} />
          </button>
        </Hint>
      </div>
      <div className="strip">
        {/* ordine (scelta Alberto 03/08): prima il GIORNO, poi la fase */}
        <div className="cell meta">
          <div className="v">Giorno {model.oggi}</div>
          {/* AUDIT R2 (cluster F1): a coltivazione spenta la fase e' 'conclusa'
              (faseCorrente null) — dirlo, invece di una riga monca. */}
          <div className="k">{!model.coltivazioneAttiva
            ? 'Coltivazione non attiva'
            : f && f.open
              ? `${f.label} · giorno ${dof} · fino al flip`
              /* AUDIT R2 (MD2-10): foto pre-flip in germinazione → totale
                 ignoto (null): si omette, niente "Totale null" a schermo. */
              : `${f ? `Fase ${dof}/${f.durata}` : ''}${model.totale != null ? `${f ? ' · ' : ''}Totale ${model.totale}` : `${f ? ' · ' : ''}fino al flip`}`}</div>
        </div>
        {f && (
          <div className="cell meta">
            <div className="v" style={{ color: f.color }}>Fase {idx}/5: {f.label}</div>
            <div className="k">{tempStr && model.clima.rhTarget
              ? `ideale ${tempStr} °C (${dayLabel}) · ${model.clima.rhTarget} %`
              : (amb ? `ideale ${amb.temp_min}–${amb.soglia_temp} °C · ${amb.umid_min}–${amb.soglia_umidita} %` : '')}</div>
          </div>
        )}
        <div className="cell meta">
          <div className="v">{fmtWd(model.semina)} {fmtDate(model.semina)}</div>
          <div className="k">semina · {model.varieta.toLowerCase()}</div>
        </div>
        {model.clima.temp != null && (
          <ClimaCell off={off} colore={bandColor(model.clima.temp, tempBand, 2)}
            valore={`Temp ${Math.round(model.clima.temp)} °C`}
            sotto={tempStr ? `ideale ${tempStr} (${dayLabel})` : (amb ? `ideale ${amb.temp_min}–${amb.soglia_temp}` : '')} />
        )}
        {model.clima.rh != null && (
          <ClimaCell off={off} colore={bandColor(model.clima.rh, rhBand, 7)}
            valore={`Umidità ${Math.round(model.clima.rh)} %`}
            sotto={model.clima.rhTarget ? `ideale ${model.clima.rhTarget}` : (amb ? `ideale ${amb.umid_min}–${amb.soglia_umidita}` : '')} />
        )}
        {model.clima.vpd != null && (
          <ClimaCell off={off} colore={bandColor(model.clima.vpd, vpdBand, 0.3)}
            valore={`VPD ${model.clima.vpd.toFixed(2)} kPa`}
            sotto={model.clima.vpdTarget ? `ideale ${model.clima.vpdTarget}` : 'deficit di pressione'} />
        )}
      </div>
    </header>
  )
}

function PhaseBar({ model }) {
  return (
    <div className="phasebar">
      {model.fasi.filter((f) => f.valid).map((f) => {
        const curIdx = model.faseCorrente?.idx ?? -1
        // FATTE + ATTIVA = "accese": hero (schiarito) + testo scuro.
        // FUTURE = tenui: fondo phase-10, bordo tenue, testi nei toni della fase.
        const lit = f.idx <= curIdx && curIdx >= 0
        const bg = lit ? f.hero : f.c10
        // niente bordo sulle accese: col gradiente + background-clip border-box
        // un bordo trasparente lascia trasparire una riga di 1px sul lato.
        // Le altezze restano allineate grazie a box-sizing:border-box.
        const border = lit ? 'none' : `1px solid ${f.c10}`
        const nameColor = lit ? 'var(--ink)' : f.color
        const subColor = lit ? 'var(--ink-2)' : f.c50
        const hasToday = model.oggi >= f.start && model.oggi <= f.end
        const todayPct = hasToday ? ((model.oggi - f.start + 0.5) / f.durata) * 100 : null
        return (
          // flex-grow ∝ durata + min-width di sicurezza: le fasi corte non
          // collassano; il marker OGGI vive DENTRO il suo segmento, cosi'
          // resta preciso anche quando le proporzioni non sono lineari.
          <div key={f.key} className="ph-seg" style={{ flexGrow: f.durata }}>
            <div className="ph-fill" style={{ background: bg, border }}>
              <div className="ph-line1">
                <span className="ph-name" style={{ color: nameColor }}>{f.label}</span>
                <span className="ph-dur" style={{ color: subColor }}>{f.open ? 'in corso' : `${f.durata} gg`}</span>
              </div>
              <div className="ph-dates" style={{ color: subColor }}>
                {f.open ? (
                  <>dal {fmtDate(addDays(model.semina, f.start - 1))} · fino al flip</>
                ) : (
                  <>{fmtDate(addDays(model.semina, f.start - 1))}{' – '}{fmtDate(addDays(model.semina, f.end - 1))}</>
                )}
              </div>
            </div>
            {hasToday && (
              <div className="ph-oggi" style={{ left: `${todayPct}%` }}><span>OGGI</span></div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Timeline({ model, open, onToggle, selG, inspG, onSelect, todayRef, notesMap, animFrom, busy, onMove, onReset, onGoFlip, onGuida, narrow, onConcludi }) {
  // data-scroll-shadow: accende l'ombra sotto .tl-head (testata della card)
  // quando la lista e' scrollata — vedi app.css.
  return (
    <div className="tl-scroll" data-scroll-shadow="1">
      {model.fasi.filter((f) => f.valid).map((f) => {
        const isOpen = open.has(f.key)
        const ms = model.milestones.find((m) => m.faseIdx === f.idx)
        return (
          <React.Fragment key={f.key}>
            {ms && <MilestoneRow fase={f} ms={ms} busy={busy} onMove={onMove} onReset={onReset} onGuida={onGuida} narrow={narrow}
              anim={animFrom && ms.g >= animFrom.g ? animFrom.key : 0} />}
            {/* header + giorni in un'unica card: da aperta il perimetro
                dell'area espansa resta visibile (feedback Alberto) */}
            <section className={'ph-group' + (isOpen ? ' open' : '')}
              style={isOpen && f.current ? { borderColor: f.c25 } : undefined}>
              <button className={'ph-header' + (isOpen ? ' open' : ' closed')}
                style={isOpen && f.current ? { background: f.c10 } : undefined} onClick={() => onToggle(f.key)}>
                <span className="ph-sq" style={{ background: f.color }} />
                <Icon path={FASE_ICON[f.key]} size={19} color={f.color} />
                <span className="ph-h-name">{f.label}</span>
                {f.open ? (
                  <span className="ph-h-range">in corso · fino alla conferma del flip a fioritura</span>
                ) : (
                  <>
                    <span className="ph-h-dur">{f.durata} gg</span>
                    <span className="ph-h-range mono">· g{f.start}–{f.end}</span>
                  </>
                )}
                <div className="spacer" />
                {f.current && <span className="pill-corso" style={{ background: f.color }}>IN CORSO</span>}
                <Icon path={isOpen ? mdiChevronUp : mdiChevronDown} size={21} color="var(--fg-3)" />
              </button>
              {/* giorni SEMPRE montati, avvolti nel wrapper collassabile: così
                  l'altezza si anima (grid 0fr↔1fr) in apertura E chiusura */}
              <div className="ph-days-grid">
                <div className="ph-days-inner">
                  {f.days.map((d) => (
                    <DayRow key={d.g} d={d} fase={f} model={model} selected={d.g === selG} chevron={d.g === inspG} onSelect={onSelect}
                      rowRef={d.state === 'today' ? todayRef : null}
                      hasNote={(notesMap[model.isoOfDay(d.g)] || []).length > 0}
                      anim={animFrom && d.g >= animFrom.g ? animFrom.key : 0} />
                  ))}
                </div>
              </div>
            </section>
          </React.Fragment>
        )
      })}
      {model.flip && <FlipControl key={model.flip.defaultDay} model={model} onGoFlip={onGoFlip} onGuida={onGuida} busy={busy} />}
      {/* AUDIT R2: la CTA compare anche oltre la fine del piano SENZA taglio
          confermato (oltrePiano) — prima era legata alla sola fase HA
          'essiccazione' e con milestone non confermate non c'era via d'uscita. */}
      {model.coltivazioneAttiva && (model.faseAttuale === 'essiccazione' || model.oltrePiano) && (
        <ConcludiCTA busy={busy} onConfirm={onConcludi} />
      )}
    </div>
  )
}

// F1 — CTA di chiusura del ciclo, visibile solo in essiccazione: il piano
// STIMA la fine, lo snap test DECIDE. Doppia conferma col pattern "armato"
// (come le card attivita'), disarmo automatico.
function ConcludiCTA({ busy, onConfirm }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <div className="concludi-wrap">
      <button className={'btn-concludi' + (armed ? ' armed' : '')} disabled={busy}
        onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}>
        <Icon path={mdiFlagCheckered} size={18} />
        {armed ? 'Confermare? Il ciclo si chiude e la serra si spegne' : 'Concludi coltivazione'}
      </button>
      <span className="concludi-hint">
        Da usare quando lo snap test è superato: l'essiccazione prosegue a oltranza finché il ciclo non viene concluso.
      </span>
    </div>
  )
}

// Controllo del flip 12/12 (fotoperiodica pre-flip): giorno proposto regolabile
// con le frecce + conferma. Confermare imposta l'inizio fioritura → cascata.
function FlipControl({ model, onGoFlip, onGuida, busy }) {
  const fase = model.fasi[model.flip.fioIdx]         // fioritura (colore/label/icona)
  const [day, setDay] = React.useState(model.flip.defaultDay)
  const date = addDays(model.semina, day - 1)
  const canDown = day - 1 >= model.flip.minDay
  return (
    <div className="ms-row flip-row">
      <span className="ms-line" style={{ borderColor: fase.color }} />
      <div className="ms-card flip-card" style={{ '--phase': fase.color, background: fase.c10, borderColor: fase.color }}>
        <span className="ms-icon" style={{ background: fase.color }}>
          <Icon path={FASE_ICON[fase.key]} size={17} color="var(--ink)" />
        </span>
        <div className="ms-mid">
          <span className="ms-kicker" style={{ color: fase.color }}>Flip</span>
          <span className="ms-name">Inizio {fase.label}</span>
          <span className="ms-date mono">g{day} · {fmtWd(date)} {fmtDate(date)}</span>
          <span className="flip-hint">quando la pianta è pronta</span>
        </div>
        <div className="ms-actions">
          {/* stessa regola delle frecce milestone (AUDIT R2 · M-R2-7): bloccata
              = si dice perche', non si promette il giorno che non arriva */}
          <Hint text={canDown ? 'Flip un giorno prima' : `Già al minimo: il flip non va prima di g${model.flip.minDay}`}>
            <button className="ms-btn" disabled={busy || !canDown} onClick={() => setDay((d) => d - 1)}>
              <Icon path={mdiChevronUp} size={20} />
            </button>
          </Hint>
          <Hint text="Flip un giorno dopo">
            <button className="ms-btn" disabled={busy} onClick={() => setDay((d) => d + 1)}>
              <Icon path={mdiChevronDown} size={20} />
            </button>
          </Hint>
        </div>
        <button className="flip-go" disabled={busy} onClick={() => onGoFlip(day)}>
          <Icon path={mdiFlower} size={15} color="var(--ink)" />Flip a fioritura
        </button>
        <GuidaLink topic="flip-fioritura" onGuida={onGuida} hint="Guida: come decidere il flip" />
      </div>
      <span className="ms-line" style={{ borderColor: fase.color }} />
    </div>
  )
}

function MilestoneRow({ fase, ms, busy, onMove, onReset, onGuida, narrow, anim }) {
  const editable = !ms.locked
  const guidaTopic = MILESTONE_GUIDA[fase.key]
  /* AUDIT R2 (M-R2-7): a freccia bloccata il fumettino SPIEGA il limite invece
     di promettere un giorno che non si sposta. Il toast di moveMilestone dice
     gia' la stessa cosa, ma su un bottone disabilitato non parte nessun click e
     quindi nessuno lo legge — e da K-10 la bolla si apre anche al tap su touch.
     Convenzione #3: un indicatore si spiega, non resta muto. */
  const primaBloccata = ms.g - 1 < ms.minStart
  const dopoBloccata = ms.maxStart != null && ms.g >= ms.maxStart
  const hintPrima = primaBloccata
    ? `Già al minimo: non prima della fase precedente (g${ms.minStart})`
    : `Inizio ${fase.label} un giorno prima`
  const hintDopo = dopoBloccata
    ? `Già al massimo: non oltre l'inizio confermato della fase successiva (g${ms.maxStart + 1})`
    : `Inizio ${fase.label} un giorno dopo`
  return (
    <div className="ms-row" style={anim ? { animation: `ccShift${anim % 2 ? 'A' : 'B'} .55s cubic-bezier(.34,1.56,.64,1)` } : undefined}>
      <span className="ms-line" style={{ borderColor: fase.color }} />
      <div className="ms-card" style={{ '--phase': fase.color, background: fase.c10, borderColor: fase.color }}>
        <span className="ms-icon" style={{ background: fase.color }}>
          <Icon path={FASE_ICON[fase.key]} size={17} color="var(--ink)" />
        </span>
        <div className="ms-mid">
          <span className="ms-kicker" style={{ color: fase.color }}>Inizio fase</span>
          <span className="ms-name">{fase.label}</span>
          <span className="ms-date mono">g{ms.g} · {fmtWd(ms.date)} {fmtDate(ms.date)}</span>
          <span className="ms-status" style={ms.confirmed ? { background: fase.color, color: 'var(--ink)' } : {}}>
            {ms.confirmed ? 'confermata' : 'prevista'}
          </span>
          {ms.delta !== 0 && (
            <span className="ms-delta" style={{ background: fase.color }}>{ms.delta > 0 ? '+' : ''}{ms.delta} gg</span>
          )}
        </div>
        {editable ? (
          <div className="ms-actions">
            <Hint text={hintPrima}>
              <button className="ms-btn" disabled={busy || primaBloccata}
                onClick={() => onMove(ms, -1)}>
                <Icon path={mdiChevronUp} size={20} />
              </button>
            </Hint>
            <Hint text={hintDopo}>
              <button className="ms-btn"
                disabled={busy || dopoBloccata} onClick={() => onMove(ms, +1)}>
                <Icon path={mdiChevronDown} size={20} />
              </button>
            </Hint>
            {ms.confirmed && (
              <Hint text={`Riporta la milestone alla data del piano${ms.planStart != null ? ` (g${ms.planStart})` : ''}`}>
                <button className="ms-btn reset" disabled={busy}
                  onClick={() => onReset(ms)}>
                  <Icon path={mdiRestore} size={19} />
                </button>
              </Hint>
            )}
          </div>
        ) : (
          <span className="ms-lock"><Icon path={mdiLockOutline} size={15} />iniziata</span>
        )}
        <GuidaLink topic={guidaTopic} onGuida={onGuida} hint="Guida: come decidere questa milestone" />
      </div>
      <span className="ms-line" style={{ borderColor: fase.color }} />
    </div>
  )
}

function DayRow({ d, fase, model, selected, chevron, onSelect, rowRef, hasNote, anim }) {
  const today = d.state === 'today'
  const cls = ['day', d.state, selected ? 'selected' : '', d.limbo ? 'limbo' : ''].join(' ')
  const luciTxt = fase.luciAccese ? `${fase.luciFinestraOn}–${fase.luciFinestraOff} · ${fase.luciOre} h` : 'spente'
  const acquaTxt = fase.ricircoli.length
    ? `${fase.ricircoli.length}× · ${fase.ricircoli.join(' · ')} (${fase.ricircoloDurata}s)`
    : 'nessuno'
  return (
    <button ref={rowRef} className={cls} data-g={d.g}
      aria-pressed={selected} aria-current={today ? 'date' : undefined}
      style={{
        '--phase': fase.color, '--phase25': fase.c25,
        ...(anim ? { animation: `ccShift${anim % 2 ? 'A' : 'B'} .55s cubic-bezier(.34,1.56,.64,1)` } : {}),
      }}
      onClick={() => onSelect(d.g)}>
      <div className="rail">
        <div className="rail-line" />
        <span className={'dot' + (d.limbo && !today ? ' dashed' : '')}
          style={today
            ? {}
            : d.state === 'past' ? { background: fase.color, borderColor: fase.color } : {}} />
      </div>
      <div className="day-body">
        {/* Vn/tot = giorno di fase su durata TOTALE fase (limbo incluso);
            GG = giorno assoluto dalla semina */}
        <div className="day-code">
          <div><span>{d.label}</span>{!fase.open && <small> / {fase.durata}</small>}</div>
          <div className="day-gg">GIORNO {d.g}</div>
        </div>
        {/* colonna data: su OGGI la chip PRENDE IL POSTO di data+giorno-settimana
            (non si aggiunge prima, così le colonne restano allineate) */}
        <div className="day-date">
          {today ? (
            <span className="pill-oggi">OGGI</span>
          ) : (
            <>
              <div className="wd">{fmtWd(d.date)}</div>
              <div className="mono num">{fmtDate(d.date)}</div>
            </>
          )}
        </div>
        <div className="day-params">
          <div><Icon path={mdiLightbulbOn} size={15} color={today ? 'var(--ink)' : fase.luciAccese ? 'var(--luce)' : 'var(--fg-3)'} />Luci {luciTxt}</div>
          <div><Icon path={mdiWater} size={15} color={today ? 'var(--ink)' : fase.ricircoli.length ? 'var(--acqua)' : 'var(--fg-3)'} />Ricircoli {acquaTxt}</div>
        </div>
        {d.limbo && (
          <span className="limbo-tag"><Icon path={mdiProgressClock} size={14} />Limbo</span>
        )}
        <div className="day-chips">
          {d.eventi.map((ev, i) => {
            // done = dal DIARIO (FATTO/ANNULLATO, vince il piu' recente), non
            // dal passare del giorno: un'azione saltata resta ambra anche nel
            // passato. I checkpoint sono osservazioni: mai stato "fatto".
            const meta = TIPO_META[ev.tipo] || TIPO_META.checkpoint
            const done = meta.manual && ev.done
            const cls2 = done
              ? 'chip donegreen'
              : meta.manual ? 'chip manual' : (d.state === 'past' ? 'chip done' : 'chip check')
            const lead = done ? mdiCheckCircle : meta.manual ? mdiCircleOutline : meta.icon
            return (
              <span key={i} className={cls2}>
                <Icon path={lead} size={14} />
                <span className="chip-txt">{ev.titolo}</span>
              </span>
            )
          })}
        </div>
        {/* indicatore: questo giorno ha una o più note. NIENTE fumettino:
            l'icona nota su una riga giorno dice gia' tutto, e la riga e' un
            bottone — su touch il tap deve aprire il giorno, non una bolla. */}
        {hasNote && (
          <span className="day-note">
            <Icon path={mdiNoteTextOutline} size={15} color={today ? 'var(--ink)' : 'var(--fg-2)'} />
          </span>
        )}
        {/* slot chevron SEMPRE presente (vuoto se non evidenziata): le chip
            non si spostano. La chevron segue il giorno mostrato nel pannello
            (OGGI di default), non solo la selezione attiva. */}
        <span className="day-chev">
          {chevron && <Icon path={mdiChevronRight} size={22} color={today ? 'var(--ink)' : fase.color} />}
        </span>
      </div>
    </button>
  )
}

// titolo di sezione unificato: MAIUSCOLO fg-2 + icona inline senza wrapper
function SectTitle({ icon, children }) {
  return (
    <div className="insp-sect">
      <Icon path={icon} size={14} style={{ marginRight: 6, verticalAlign: -2 }} />{children}
    </div>
  )
}

// Note libere del giorno: array editabile, salva su blur / cancella subito.
// Remontato per giorno (key=day.g) così ri-semina il draft cambiando giorno.
function NotesSection({ dateISO, notes, onSave }) {
  const [draft, setDraft] = useState(notes)
  const [confirmDel, setConfirmDel] = useState(null)   // indice nota in attesa di conferma cancellazione
  const commit = (arr) => onSave(dateISO, arr.map((s) => s.trim()).filter(Boolean))
  const grow = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
  const doDelete = (i) => { const next = draft.filter((_, j) => j !== i); setDraft(next); setConfirmDel(null); commit(next) }
  return (
    <div className="notes insp-block">
      <SectTitle icon={mdiNoteEditOutline}>Note del giorno</SectTitle>
      {draft.map((n, i) => (
        confirmDel === i ? (
          <div className="note note-confirm" key={i}>
            <span className="note-confirm-txt">Eliminare questa nota?</span>
            <button className="note-cancel" onClick={() => setConfirmDel(null)}>Annulla</button>
            <button className="note-delok" onClick={() => doDelete(i)}>Elimina</button>
          </div>
        ) : (
          <div className="note" key={i}>
            <textarea
              className="note-txt" value={n} placeholder="Nota libera… (es. pH 6.2)"
              rows={1} ref={(el) => el && grow(el)}
              onChange={(e) => { setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x))); grow(e.target) }}
              onBlur={() => commit(draft)} />
            {/* niente fumettino sulla spunta: la spunta accanto a un campo di
                testo si legge da sola. La X invece, li' accanto, leggerebbe
                "annulla la modifica": vale la pena dire che cancella. */}
            <button className="note-ok"
              onMouseDown={(e) => e.preventDefault()} onClick={() => commit(draft)}>
              <Icon path={mdiCheck} size={16} />
            </button>
            <Hint text="Elimina la nota">
              <button className="note-del" onClick={() => setConfirmDel(i)}>
                <Icon path={mdiClose} size={15} />
              </button>
            </Hint>
          </div>
        )
      ))}
      <button className="note-add" onClick={() => setDraft((d) => [...d, ''])}>
        <Icon path={mdiPlus} size={16} />Aggiungi nota
      </button>
    </div>
  )
}

function Inspector({ model, day, fase, onClose, onDone, onUndone, notesMap, onSaveNote, onGoAuto, onGuida, busy }) {
  const dateISO = model.isoOfDay(day.g)
  // doppio tap di conferma per le azioni che dosano (cambio acqua/booster)
  const [armed, setArmed] = useState(null)
  useEffect(() => {
    if (armed == null) return
    const t = setTimeout(() => setArmed(null), ARM_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [armed])
  const stato = day.state === 'today'
    ? { label: 'Oggi', icon: mdiTarget }
    : day.state === 'past'
      ? { label: 'Passato', icon: mdiCheck }
      : { label: 'Previsto', icon: mdiProgressClock }
  const nextFase = model.fasi[fase.idx + 1]
  // Eventi da mostrare come ATTIVITÀ: in auto l'aggiunta (top-up) la fanno le
  // pompe da sole → non è un'attività, va esclusa (la dose è in "Cosa fa la serra").
  const eventiVisibili = day.eventi.filter((ev) => {
    const dd = ev.piano?.dose
    return !(dd && dd.modo === 'aggiunta' && model.dosatoriAuto)
  })
  return (
    <aside className="inspector" style={{
      '--phase': fase.color,
      // doppio layer: il gradiente tinta sta SOPRA una base opaca, cosi'
      // in modale non traspare lo sfondo (feedback Alberto)
      background: `linear-gradient(179deg, ${fase.c10} 0%, var(--surface-raised) 46%), var(--surface-raised)`,
      borderColor: fase.c25,
    }}>
      <div className="insp-hero" style={{ background: `${fase.hero}, var(--surface-raised)` }}>
        {/* DATE BOX al posto dell'icona di fase (che e' gia' nel colore della
            fascia e nelle righe della timeline): settimana a 3 lettere sopra,
            numero del giorno a 2 cifre sotto. */}
        <span className="insp-datebox">
          <span className="insp-dbox-wd">{fmtWd3(day.date)}</span>
          <span className="insp-dbox-n">{fmtDD(day.date)}</span>
        </span>
        {/* Le DUE colonne di testo stanno in un contenitore comune: sul
            desktop diventa una griglia 2×2 che allinea le righe alle
            BASELINE (settimana↔sigla fase, data↔giorno·fase) — vedi app.css.
            Nello sheet la colonna destra non c'e' e resta un blocco normale. */}
        <div className="insp-hero-txt">
          <div className="insp-hero-mid">
            {/* Riga sopra la data, stesso stile in entrambi i layout:
                · sheet  → "Giorno 22 · V15 / 21", cioe' quello che sul desktop
                  sta nella colonna destra (qui occupata dal bottone di chiusura).
                  Il "/ N" cade se la fase e' aperta (pre-flip: il totale non
                  esiste ancora), esattamente come fa quella colonna.
                · desktop → il giorno della settimana per esteso: giorno e sigla
                  fase sono gia' a destra, e la settimana nel date box e' solo
                  abbreviata. */}
            <div className="insp-kicker">
              {onClose
                ? <>Giorno {day.g} · {day.label}{!fase.open && ` / ${fase.durata}`}</>
                : fmtWdLong(day.date)}
            </div>
            {/* data per esteso CON anno, su una riga: il giorno della settimana
                non si ripete, sta nel date box qui a sinistra. */}
            <div className="insp-title">{fmtDayMonthYear(day.date)}</div>
          </div>
          {!onClose && (
            <div className="insp-hero-right">
              <div className="mono code">{day.label}{!fase.open && <small> / {fase.durata}</small>}</div>
              <div className="sub">Giorno {day.g} · {fase.label}</div>
            </div>
          )}
        </div>
        {onClose && (
          <button className="insp-close" aria-label="Chiudi dettagli giorno" onClick={onClose}><Icon path={mdiClose} size={20} color="var(--ink)" /></button>
        )}
      </div>

      {/* data-scroll-shadow: ombra sotto .insp-hero quando il corpo e'
          scrollato. Vale per l'ispettore desktop E per lo sheet mobile:
          e' lo stesso componente. */}
      <div className="insp-scroll" data-scroll-shadow="1">
        <div className="insp-block">
          <div className="insp-staterow">
            <span className="state-pill"><Icon path={stato.icon} size={16} />{stato.label}</span>
            <span className="state-fase">Fase <b>{fase.label}</b> · giorno {day.dof}{fase.open ? ' · fino al flip' : ` di ${fase.durata}`}</span>
          </div>
          {day.limbo && (
            <div className="limbo-note">
              <Icon path={mdiProgressClock} size={19} color="var(--luce)" />
              <span>{fase.key === 'essiccazione'
                ? 'Giorno oltre il piano: l\u2019essiccazione prosegue a oltranza — lo snap test decide quando concludere il ciclo (pulsante in fondo alla timeline).'
                : `Giorno di limbo: la ${fase.label} è stata prolungata oltre il piano — da programma sarebbe già iniziata la ${nextFase ? nextFase.label : 'fase successiva'}. La serra prosegue col piano ${fase.label} finché la milestone non viene spostata.`}</span>
            </div>
          )}
        </div>

        {/* ── ATTIVITÀ DEL GIORNO ── */}
        <div className="insp-block">
        <SectTitle icon={mdiClipboardCheckOutline}>Attività del giorno</SectTitle>
        {eventiVisibili.length === 0 && (
          <div className="acts-empty">
            <div className="acts-empty-main"><Icon path={mdiCalendarBlankOutline} size={18} />Nessuna attività da svolgere — la serra procede in automatico.</div>
            {fase.ricircoli.length > 0 && (
              <div className="acts-empty-note">Eventuali rabbocchi nella vasca principale (per alzare il livello di acqua) vanno fatti con sola acqua, 50/50 rubinetto + demineralizzata.</div>
            )}
          </div>
        )}
        {eventiVisibili.map((ev, i) => {
          const meta = TIPO_META[ev.tipo] || TIPO_META.checkpoint
          const dd = ev.piano?.dose
          // Dosaggio: le pompe erogano SOLO ai cambi-acqua e solo se dosatori_auto ON.
          // Le "aggiunte" (top-up senza cambio) restano sempre a mano (siringa).
          const isTopUp = dd?.modo === 'aggiunta'
          const pumpsDose = !!dd && !isTopUp && model.dosatoriAuto
          // ml reali da iniettare = ml/L × litri della base giusta, la stessa
          // che usa il riquadro "Prossima azione" del Controllo (AUDIT R5-2:
          // per lo stesso intervento i due schermi devono dare lo stesso
          // numero): AGGIUNTA NON FUTURA (oggi O in ritardo: si sta facendo
          // ADESSO) → acqua ATTUALE in vasca, perche' e' quella in cui il
          // prodotto finisce; CAMBIO → vasca PIENA; AGGIUNTA FUTURA → vasca
          // piena, perche' il livello di quel giorno non si conosce
          // (AUDIT R6, M-R6-1).
          const topAdesso = isTopUp && day.state !== 'future'
          const litriKnown = topAdesso ? (model.vasca.litri != null) : true
          const litriDose = topAdesso ? (model.vasca.litri ?? model.vasca.capacita) : model.vasca.capacita
          const pct = model.vasca.litri != null ? Math.round((model.vasca.litri / model.vasca.capacita) * 100) : null
          const mlReali = (v) => mlDose(v, litriDose)
          // orario dell'ultima lettura del livello (per le aggiunte)
          const upd = model.vasca.aggiornato ? new Date(model.vasca.aggiornato) : null
          const p2 = (n) => String(n).padStart(2, '0')
          const updTxt = (upd && !isNaN(upd.getTime()))
            ? (upd.toDateString() === new Date().toDateString()
                ? `letto alle ${p2(upd.getHours())}:${p2(upd.getMinutes())}`
                : `letto il ${p2(upd.getDate())}/${p2(upd.getMonth() + 1)} ${p2(upd.getHours())}:${p2(upd.getMinutes())}`)
            : null
          const cls = 'act ' + (meta.manual ? 'manual' : 'check') + (ev.tipo === 'raccolto' ? ' harvest' : '')
          const isCambio = ev.tipo === 'booster' || /cambio\s+acqua/i.test(ev.titolo)
          // checkpoint = osservazione, niente segna-fatto (feedback Alberto);
          // futuro = permesso ("lo faccio oggi in anticipo") ma con conferma.
          const canDo = meta.manual && !ev.done
          const needsArm = isCambio || day.state === 'future'
          // se e' nel futuro, la data e' l'informazione che conta (anche per i cambi)
          const armLabel = day.state === 'future'
            ? `Prevista per ${fmtWd(day.date)} ${fmtDate(day.date)} — confermare?`
            : (pumpsDose ? 'Confermare il cambio? Le pompe dosano dal piano' : 'Confermare? La dose viene registrata (a mano)')
          const isArmed = armed === ev.titolo
          return (
            <div key={i} className={cls}>
              <span className="act-stripe" />
              <div className="act-badge-row">
                <span className="act-badge"><Icon path={meta.icon} size={13} />{meta.label}</span>
                <span className="spacer" />
                {/* niente hint: l'icona-libro dentro la card di un'attivita'
                    apre la guida di quell'attivita', e non c'e' altro da dire */}
                {ev.piano?.guida && <GuidaLink topic={ev.piano.guida} onGuida={onGuida} />}
              </div>
              <div className="act-main">
                <Icon path={meta.icon} size={24} style={{ marginTop: 1 }} />
                <div>
                  <div className="act-title">{ev.titolo}</div>
                  {ev.suggerimento && <div className="act-desc">{ev.suggerimento}</div>}
                  {pumpsDose && (
                    <div className="act-autonote">
                      <b>Erogazione automatica attiva:</b> oggi basta cambiare l'acqua, ai nutrienti pensano le pompe.
                      Confermare con «Segna fatto» solo dopo aver rimesso la vasca piena (4.5 L) — la dose è calcolata su quel volume.
                    </div>
                  )}
                </div>
              </div>
              {dd && !model.dosatoriAuto && (
                <>
                  <div className="act-autonote">
                    <b>A mano · siringa:</b> {isTopUp
                      ? (topAdesso
                          ? 'i nutrienti vanno aggiunti a mano — sotto i ml da iniettare, calcolati sull’acqua attualmente in vasca.'
                          : 'i nutrienti vanno aggiunti a mano — sotto i ml a vasca piena: l’acqua di quel giorno non si conosce.')
                      : 'i nutrienti vanno iniettati a mano — sotto i ml calcolati sulla vasca piena.'}
                  </div>
                  <div className="act-vol">
                    <Icon path={mdiWater} size={14} />
                    {isTopUp
                      ? (topAdesso
                          ? (litriKnown
                              ? <span>Acqua in vasca ora: <b>{litriDose} L</b>{pct != null ? ` · ${pct}%` : ''}{updTxt ? <i> · {updTxt}</i> : null}</span>
                              : <span>Acqua in vasca ora: <b>~{litriDose} L</b> <i>(livello ignoto, uso la capacità)</i></span>)
                          : <span>Riferimento: vasca piena (<b>{litriDose} L</b>) — con meno acqua le quantità vanno ridotte in proporzione.</span>)
                      : <span>La vasca deve essere piena (<b>{model.vasca.capacita} L</b>).</span>}
                  </div>
                  <div className="act-doses">
                    <span><small>GROW</small><b>{mlReali(dd.grow)} ml</b><i>{dd.grow} ml/L × {litriDose} L</i></span>
                    <span><small>MICRO</small><b>{mlReali(dd.micro)} ml</b><i>{dd.micro} ml/L × {litriDose} L</i></span>
                    <span><small>BLOOM</small><b>{mlReali(dd.bloom)} ml</b><i>{dd.bloom} ml/L × {litriDose} L</i></span>
                  </div>
                  {ev.piano?.alt_cambio && (() => {
                    const full = dosePerGiorno(fase.nutrienti, day.dof) || {}
                    const cap = model.vasca.capacita
                    const fml = (v) => mlDose(v, cap)
                    return (
                      <div className="act-altdose">
                        In alternativa, con cambio d'acqua completo ({cap} L nuovi) va data la dose piena:{' '}
                        Grow <b>{fml(full.grow)} ml</b> ({full.grow} ml/L × {cap} L) · Micro <b>{fml(full.micro)} ml</b> ({full.micro} ml/L × {cap} L) · Bloom <b>{fml(full.bloom)} ml</b> ({full.bloom} ml/L × {cap} L).
                      </div>
                    )
                  })()}
                </>
              )}
              {ev.done && meta.manual && (
                <div className="act-foot">
                  <span className="act-donestate"><Icon path={mdiCheckCircle} size={19} />Fatto</span>
                  {/* "Annulla" da solo non dice cosa annulla: il fumettino sì */}
                  <Hint text="Annulla la spunta: l’attività torna «da fare»">
                    <button className="act-undobtn" disabled={busy}
                      onClick={() => onUndone(ev)}>Annulla</button>
                  </Hint>
                </div>
              )}
              {canDo && (
                <div className="act-foot">
                  {/* il fumettino parla SOLO da bloccato: da abilitato il
                      bottone dice gia' tutto (bottone disabled → Hint mette
                      da solo lo span-bersaglio, vedi Hint.jsx) */}
                  <Hint text={model.fattiOk === false ? 'Diario non leggibile: riprovare tra poco' : ''}>
                    <button
                      className={'act-dobtn' + (isArmed ? ' armed' : '')}
                      /* AUDIT R3 (MD3-04): diario giu' = done-state illeggibile —
                         card in sola lettura, niente FATTO alla cieca (rischio
                         riga doppia su un'azione gia' chiusa). */
                      disabled={busy || model.fattiOk === false}
                      onClick={() => {
                        if (needsArm && !isArmed) { setArmed(ev.titolo); return }
                        setArmed(null)
                        onDone(ev)
                      }}>
                      <Icon path={mdiCircleOutline} size={19} />
                      {isArmed ? armLabel : 'Segna fatto'}
                    </button>
                  </Hint>
                </div>
              )}
            </div>
          )
        })}
        </div>

        {/* ── NOTE DEL GIORNO ── (NotesSection è già un .insp-block) */}
        <NotesSection key={day.g} dateISO={dateISO} notes={notesMap[dateISO] || []} onSave={onSaveNote} />

        {/* ── COSA FA LA SERRA ── */}
        <div className="insp-block">
        <SectTitle icon={mdiCogOutline}>Cosa fa la serra {day.state === 'today' ? 'oggi' : 'questo giorno'}</SectTitle>

        {/* Nutrienti (solo con dosatori in AUTO: le pompe erogano da sole; a mano
            la dose resta nell'attività manuale sopra) */}
        {model.dosatoriAuto && (() => {
          const nd = day.eventi.map((e) => e.piano?.dose).find(
            (x) => x && ((x.grow || 0) + (x.micro || 0) + (x.bloom || 0)) > 0)
          if (!nd) return null
          // stessa base dell'attivita' manuale qui sopra (AUDIT R5-2): l'acqua
          // reale vale solo per l'aggiunta di OGGI, altrimenti si dosa sulla
          // vasca piena
          const top = nd.modo === 'aggiunta'
          const topAdessoN = top && day.state !== 'future'
          const litriN = topAdessoN ? (model.vasca.litri ?? model.vasca.capacita) : model.vasca.capacita
          const ml = (v) => mlDose(v, litriN)
          return (
            <div className="pcard">
              <span className="pdisc" style={{ background: 'var(--verde)' }}><Icon path={mdiWaterPump} size={24} color="var(--ink)" /></span>
              <div className="pbody">
                <div className="prow1"><span className="pname">Nutrienti</span><Badge auto={true} /></div>
                <div className="pval">{top
                  ? (topAdessoN ? `Aggiunta su ${litriN} L in vasca` : `Aggiunta · riferimento vasca piena ${litriN} L`)
                  : `Al cambio acqua · vasca piena ${litriN} L`} · le pompe dosano</div>
                <div className="psub">R <b>{ml(nd.grow)}</b> · G <b>{ml(nd.micro)}</b> · B <b>{ml(nd.bloom)}</b> ml <span className="mono">({nd.grow}/{nd.micro}/{nd.bloom} ml/L × {litriN} L)</span></div>
              </div>
            </div>
          )
        })()}

        {/* Luci */}
        <div className="pcard">
          <span className="pdisc" style={{ background: 'var(--luce)' }}><Icon path={mdiLightbulbOn} size={24} color="var(--ink)" /></span>
          <div className="pbody">
            <div className="prow1"><span className="pname">Luci</span><Badge auto={model.modo.luci} /></div>
            {!model.modo.luci && <ManualNotice label="Luci" entity="input_boolean.serra_schedule_luci" onGoAuto={onGoAuto} busy={busy} />}
            <div className="pval">
              {fase.luciAccese
                ? <>{fase.luciFinestraOn} → {fase.luciFinestraOff} · <span className="mono">{fase.luciOre} h</span></>
                : 'spente (buio di fase)'}
            </div>
            {fase.luciAccese && fase.luciMix && (
              <div className="psub">Mix D/R/B <b>{fase.luciMix.slice(0, 3).join(' / ')}</b></div>
            )}
          </div>
        </div>

        {/* Acqua · Ricircoli — per-ciclo, come nel mockup */}
        <div className="pcard">
          <span className="pdisc" style={{ background: 'var(--acqua)' }}><Icon path={mdiWater} size={24} color="var(--ink)" /></span>
          <div className="pbody">
            <div className="prow1"><span className="pname">Acqua · Ricircoli</span><Badge auto={model.modo.acqua} /></div>
            {!model.modo.acqua && <ManualNotice label="Acqua" entity="input_boolean.serra_schedule_acqua" onGoAuto={onGoAuto} busy={busy} />}
            {fase.ricircoli.length ? (
              <>
                <div className="psub" style={{ marginTop: 0, marginBottom: 7 }}>
                  {fase.ricircoli.length} al giorno · pompa in vasca
                </div>
                <div className="cicli">
                  {fase.ricircoli.map((t, i) => (
                    <div key={i} className="ciclo">
                      <Icon path={mdiClockOutline} size={15} color="var(--acqua)" />
                      <span className="mono t">{t}</span>
                      <span className="spacer" />
                      <span className="d">durata <b className="mono">{fase.ricircoloDurata}s</b></span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="pval">nessun ricircolo in questa fase</div>
            )}
          </div>
        </div>

        {/* Ambiente / Ventole */}
        {fase.ambiente && (
          <div className="pcard">
            <span className="pdisc" style={{ background: 'var(--warn)' }}><Icon path={mdiFan} size={24} color="var(--ink)" /></span>
            <div className="pbody">
              <div className="prow1"><span className="pname">Ambiente</span><Badge auto={model.modo.ventole} /></div>
              {!model.modo.ventole && <ManualNotice label="Ventole" entity="input_boolean.serra_schedule_ventole" onGoAuto={onGoAuto} busy={busy} />}
              <div className="pval">{fase.ambiente.temp_min}–{fase.ambiente.soglia_temp} °C · {fase.ambiente.umid_min}–{fase.ambiente.soglia_umidita} % UR</div>
              <div className="psub">le ventole estraggono sopra soglia</div>
            </div>
          </div>
        )}
        </div>
      </div>
    </aside>
  )
}

function Badge({ auto }) {
  return auto ? (
    <span className="badge auto"><Icon path={mdiFlash} size={12} />PIANO</span>
  ) : (
    <span className="badge manual"><Icon path={mdiHandBackRight} size={12} />LIBERO</span>
  )
}

// Avviso testuale sotto il titolo del componente quando è in modalità Libera:
// lo schedule del piano NON viene applicato. La seconda frase è un link per
// tornare alla modalità Pianificata.
function ManualNotice({ label, entity, onGoAuto, busy }) {
  return (
    <div className="pmanual">
      Attualmente il programma giornaliero viene ignorato.{' '}
      <button className="pmanual-go" disabled={busy} onClick={() => onGoAuto(entity, label)}>
        Passa alla modalità Pianificata
      </button>
    </div>
  )
}

// Milestone-fase → topic guida (per l'icona-libro accanto alle frecce).
// La decisione tipica di ciascuna milestone: cosa valutare per farla scattare.
const MILESTONE_GUIDA = {
  germinazione: 'germinazione',
  vegetativa: 'topping-lst',
  fioritura: 'fioritura',
  flush: 'flush',
  essiccazione: 'raccolto',
}

// Icona-libro che apre una guida in overlay. Compare solo se la guida esiste.
// `hint` e' facoltativo: si passa solo dove aggiunge qualcosa (quale decisione
// spiega quella guida). Dove il contesto lo dice gia' resta vuoto e il
// fumettino non compare — PARSIMONIA, niente "Apri la guida" su un libro.
function GuidaLink({ topic, onGuida, hint = '' }) {
  if (!topic || !onGuida) return null
  return (
    <Hint text={hint}>
      <button className="guida-link" onClick={(e) => { e.stopPropagation(); onGuida(topic) }}>
        <Icon path={mdiBookOpenVariant} size={17} />
      </button>
    </Hint>
  )
}

// Immagine di una guida: se il file non c'è ancora, mostra un segnaposto.
// AUDIT R2 (M-R2-4): `src` nullo = sorgente RIFIUTATA dal parser (non relativa
// alla cartella guide). Stesso segnaposto del file mancante: la didascalia resta
// leggibile e non parte nessuna richiesta.
function GuideImg({ src, cap }) {
  const [ok, setOk] = useState(true)
  return (ok && src) ? (
    <figure className="guide-fig">
      <img src={src} alt={cap || ''} loading="lazy" onError={() => setOk(false)} />
      {cap && <figcaption>{cap}</figcaption>}
    </figure>
  ) : (
    <div className="guide-fig-ph"><Icon path={mdiImageOutline} size={20} /><span>Immagine non disponibile{cap ? ` — ${cap}` : ''}</span></div>
  )
}

// Rende gli span inline (grassetto, link) prodotti dal parser markdown.
function Inline({ spans }) {
  return (spans || []).map((sp, i) => {
    if (sp.t === 'b') return <b key={i}>{sp.s}</b>
    if (sp.t === 'i') return <em key={i}>{sp.s}</em>
    if (sp.t === 'a') return <a key={i} href={sp.href} target="_blank" rel="noopener noreferrer">{sp.s}</a>
    return <React.Fragment key={i}>{sp.s}</React.Fragment>
  })
}

// Indice della libreria: gruppi di guide cliccabili (apre il topic via onNav).
function GuideIndexList({ onNav }) {
  return (
    <div className="guide-idx">
      {GUIDE_INDEX.map((g) => (
        <section key={g.group} className="guide-idx-group">
          <h4>{g.group}</h4>
          {g.items.map((it) => (
            <button key={it.topic} className="guide-idx-item" onClick={() => onNav(it.topic)}>
              <Icon path={mdiBookOpenVariant} size={16} />
              <span>{it.titolo}</span>
              <Icon path={mdiChevronRight} size={16} />
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

// Overlay guida: legge il file .md da www/guide/<topic>.md a runtime (nessun
// rebuild per modificarne il testo) e lo rende. topic === 'index' apre invece la
// libreria (indice di tutte le guide). Superficie sopra tutto.
function GuideOverlay({ topic, onClose, onNav }) {
  useModal(onClose)
  const isIndex = topic === 'index'
  const [guida, setGuida] = useState(null)
  const [stato, setStato] = useState('load')  // load | ok | err
  useEffect(() => {
    if (isIndex) return
    let vivo = true
    setStato('load'); setGuida(null)
    fetch(`guide/${topic}.md`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.text() })
      .then((md) => { if (vivo) { setGuida(parseGuide(md)); setStato('ok') } })
      .catch(() => { if (vivo) setStato('err') })
    return () => { vivo = false }
  }, [topic, isIndex])
  return (
    <div className="guide-overlay" role="dialog" aria-modal="true" aria-label="Guida" onClick={onClose}>
      <div className="guide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="guide-head">
          <Icon path={isIndex ? mdiBookMultipleOutline : mdiBookOpenVariant} size={20} color="var(--fg-2)" />
          <div className="guide-title">
            <b>{isIndex ? 'Libreria guide' : (guida?.titolo || 'Guida')}</b>
            {isIndex
              ? <span>Tutte le guide della serra</span>
              : (guida?.sottotitolo && <span>{guida.sottotitolo}</span>)}
          </div>
          <div className="spacer" />
          {/* la X si spiega da sola; il secondo libro no: dice dove porta */}
          {!isIndex && (
            <Hint text="Apre l’indice di tutte le guide">
              <button className="guide-x" aria-label="Tutte le guide" onClick={() => onNav('index')}>
                <Icon path={mdiBookMultipleOutline} size={18} />
              </button>
            </Hint>
          )}
          <button className="guide-x" aria-label="Chiudi" onClick={onClose}><Icon path={mdiClose} size={19} /></button>
        </div>
        <div className="guide-body">
          {isIndex && <GuideIndexList onNav={onNav} />}
          {!isIndex && stato === 'load' && <p className="guide-intro">Caricamento…</p>}
          {!isIndex && stato === 'err' && <p className="guide-intro">Guida non disponibile.</p>}
          {!isIndex && stato === 'ok' && guida.blocks.map((b, i) => {
            if (b.type === 'h2') return <h3 key={i}>{b.text}</h3>
            if (b.type === 'quote') return <blockquote key={i} className={b.variant ? `guide-quote guide-callout guide-callout--${b.variant}` : 'guide-quote'}><Inline spans={b.spans} /></blockquote>
            if (b.type === 'p') return <p key={i}><Inline spans={b.spans} /></p>
            if (b.type === 'ul') return (
              <ul key={i} className="guide-check">
                {b.items.map((it, j) => <li key={j}><Inline spans={it} /></li>)}
              </ul>
            )
            if (b.type === 'imgs') return (
              <div key={i} className={`guide-imgs${b.imgs.length > 1 ? ' multi' : ''}`}>
                {b.imgs.map((im, j) => <GuideImg key={j} src={im.src} cap={im.cap} />)}
              </div>
            )
            return null
          })}
          {!isIndex && stato === 'ok' && (
            <div className="guide-more">
              <button onClick={() => onNav('index')}>
                <Icon path={mdiBookMultipleOutline} size={16} />Tutte le guide
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
