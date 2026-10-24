// Sezione DIARIO (Fase 4 del porting design v3).
//
// Regole rispettate qui (le stesse di Stato.jsx e Controllo.jsx):
//  - palette e token SOLO da app.css; geometrie/spaziature dal design
//    (design-v3-src.jsx r.116-158 + snapshot "Calendario Ciclo v3.dc.html").
//  - URL delle fetch RELATIVI (sotto Ingress un path assoluto non arriva).
//  - polling attivo SOLO a sezione visibile (prop `attiva`) e scheda non
//    nascosta.
//  - nessuna scrittura: la sezione e' di sola lettura.
//
/* ══════════════════════════════════════════════════════════════════════
   DA DOVE ARRIVANO I DATI (Fase 5 — diario strutturato)
   ──────────────────────────────────────────────────────────────────────
   Un endpoint solo, `api/diario`, che ne unisce due sorgenti:

   1. EVENTI STRUTTURATI — /config/serra_diario.jsonl, una riga JSON per
      evento {ts, g, comp, testo, tipo, origine}, scritta da
      script.serra_diario_scrivi insieme alla riga leggibile di sempre
      (dual write, patch in PORTING/diario-v2-patch.md). Qui `tipo`
      (evidenza|routine) e `origine` (auto|manuale) sono DICHIARATI da chi ha
      scritto la riga: non si indovinano piu'.
   2. STORICO LEGACY — la coda di /config/serra_diario.log scritta PRIMA che
      il dual write esistesse. Il backend la taglia al primo evento
      strutturato (niente doppioni) e la manda solo quando si e' arrivati in
      fondo al JSONL. Per quelle righe il parser testuale di questo file
      resta l'unico modo di leggerle — ed e' per questo che non e' stato
      buttato via.

   Prima della Fase 5 questa sezione leggeva `sensor.serra_diario` da
   api/timeline: un attributo tagliato a 60 righe, da cui veniva la vecchia
   nota "il diario conserva gli ultimi 60 eventi". Ora il tetto non c'e' piu':
   si scende con "carica altri" finche' il diario ha qualcosa da dire.

   Dal `model` (gia' passato da App, come a Stato/Controllo) arrivano fasi,
   data di semina e giorno di ciclo: servono a raggruppare per fase.
   ══════════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiWater, mdiWaterAlert, mdiWaterSync, mdiLightbulbOn, mdiLightbulbOff,
  mdiFan, mdiFlask, mdiCamera, mdiNoteTextOutline, mdiSprout,
  mdiAlertCircleOutline, mdiCheckCircleOutline, mdiCogOutline,
  mdiDotsHorizontal, mdiChevronUp, mdiChevronDown, mdiInformationOutline,
  mdiHistory, mdiFlagCheckered, mdiAlertOutline,
  mdiSeed, mdiFlower, mdiWaterOutline, mdiContentCut, mdiLedStripVariant,
} from '@mdi/js'
import Hint from './Hint.jsx'
import './diario.css'

// Il file cresce a ogni azione della serra, non c'e' uno scan_interval da
// aspettare: 2 minuti sono un compromesso fra "sembra vivo" e "non e' una
// chat". La sezione e' comunque di sola lettura.
const DIARIO_POLL_MS = 120000
const EM = '—'

/* ── Icona: copia locale (4 righe) come in Stato.jsx/Controllo.jsx —
   importarla da App creerebbe il ciclo App → Diario → App. ─────────── */
function Icon({ path, size = 16, color, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none', ...style }}>
      <path d={path} fill={color || 'currentColor'} />
    </svg>
  )
}

// (i) in coda alla label: stesso componente delle altre due sezioni.
function RowInfo({ text }) {
  return (
    <Hint text={text} anchor>
      <button type="button" className="hint-i" aria-label="Spiegazione">
        <Icon path={mdiInformationOutline} size={15} />
      </button>
    </Hint>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   FORMATO REALE DELLE RIGHE DI DIARIO
   ──────────────────────────────────────────────────────────────────────
   Le scrive script.serra_diario_scrivi (serra_mqtt.yaml r.2066-2083):

     {{ now().strftime('%Y-%m-%d %H:%M') }}
     {% if coltivazione attiva e giorno_ciclo numerico %} · g{{ giorno }}{% endif %}
     · {{ msg }}

   e `msg` ha, per convenzione di TUTTI i chiamanti, la forma
   "Componente · dettaglio". Righe vere:

     2026-08-02 21:18 · g23 · Luci · mix applicato (D 0 · R 0 · B 0 · G 0 · A 0)
     2026-08-02 16:20 · g23 · Camera · foto scattata
     2026-07-11 21:09 · Ventole · off (umidità 50%)        ← senza gN
     2026-07-27 09:12 · g1 · Coltivazione · AVVIATA (semina 2026-07-27)

   Tre trappole vere, tutte gestite qui sotto:
    1. il gN puo' MANCARE (coltivazione spenta) o essere "gunavailable"
       (giorno_ciclo non numerico: nel log ce ne sono 2);
    2. il dettaglio contiene a sua volta dei " · " (il mix per canale): il
       componente si stacca col PRIMO separatore, non con uno split;
    3. righe piu' vecchie di una convenzione (o troncate) non si parsano:
       diventano categoria 'altro' e si mostrano grezze — mai un crash.
   ══════════════════════════════════════════════════════════════════════ */
const RE_TS = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\s*·\s*(.*)$/
const RE_G = /^g(\S+)\s*·\s*(.*)$/
// AUDIT R1 (I-12): lo stacco componente/testo e' identico al gemello Jinja
// (serra_mqtt.yaml, script serra_diario_scrivi: `msg.split(' · ', 1)`) —
// separatore ESATTO " · ", spazi compresi, e senza separatore il componente
// non c'e'. Il vecchio regex a spazi opzionali classificava "Sistema·errore"
// come componente "Sistema" mentre il Jinja lo lasciava senza componente:
// la stessa riga finiva in due categorie a seconda di CHI l'aveva letta.
const SEP_COMP = ' · '

// Sottosistemi del diario → tipo `y` del design (chip di filtro).
const TIPO_DI = {
  acqua: 'acqua',
  luci: 'luci',
  ventole: 'ventole',
  nutrienti: 'nutrienti',
  camera: 'foto',
  piano: 'altro',
  coltivazione: 'altro',
  sistema: 'altro',
  // «Anello» e' il componente nuovo che il logger scrive da quando registra
  // anche i comandi del LED ring («Anello · spento», «Anello · colore applicato
  // (viola · fade 3 s)»). Sta in 'altro' di proposito: i chip di filtro sono i
  // sei del design e l'anello non e' una luce di coltivazione, e' la spia di
  // stato — metterlo sotto "Luci" farebbe cercare li' un mix che non c'e'.
  // La riga si riconosce lo stesso: ha l'icona del ring (vedi iconaDi).
  anello: 'altro',
}

/* ══════════════════════════════════════════════════════════════════════
   RILIEVO: "in evidenza" oppure "routine"
   ──────────────────────────────────────────────────────────────────────
   Sostituisce il segmented Azioni/Sistema del design: il confine fra "la
   serra ha mosso qualcosa" e "la serra ha registrato qualcosa" era sfumato
   (un ricircolo automatico e' entrambe le cose) e non aiutava a leggere.
   La domanda utile e' un'altra: QUESTA RIGA MERITA ATTENZIONE?

   IN EVIDENZA = lista CHIUSA, derivata dai tipi di riga realmente prodotti
   dagli script HA (serra_mqtt.yaml) e presenti in /config/serra_diario.log:
     · tutto cio' che scrive il componente "Sistema" (offline/online, errori
       di comando, rientri, reset manuali, failsafe, riavvio serra, sonda
       clima persa e ritrovata);
     · tutto "Piano" (FATTO / ANNULLATO di un'azione del piano);
     · tutto "Coltivazione" (AVVIATA, TERMINATA, passaggio di fase, milestone
       confermata/spostata/annullata, data di semina, ciclo spostato);
     · dei quattro sottosistemi fisici, SOLO le righe che raccontano un
       cambio di modalita' (Pianificato⇄Libero), un allarme, una sicurezza, un
       recupero dopo riavvio, una dose che tocca alla persona (a siringa /
       da versare a mano), un booster, un cambio acqua completo confermato o
       un cambio di ciclo luce.
   ROUTINE = tutto il resto, cioe' il lavoro ordinario previsto dal piano:
   ricircoli, alba/tramonto, mix e preset luce, dosaggi programmati, foto
   giornaliera, ventole mosse dalle soglie, riposo periodico.
   Le righe fuori formato restano ROUTINE: sono rumore, non un allarme.
   ══════════════════════════════════════════════════════════════════════ */
// Sottosistemi che nel diario parlano SOLO quando succede qualcosa di notevole.
const COMP_EVIDENZA = new Set(['sistema', 'piano', 'coltivazione'])
/* Dentro i sottosistemi fisici, i pattern che alzano la riga a "in evidenza".
   AUDIT R2 (M-R2-3): questa alternanza e' COPIATA CARATTERE PER CARATTERE dalla
   variabile `notevole` del Jinja (serra_mqtt.yaml, script serra_diario_scrivi).
   `modalit` sta senza classe di caratteri finali apposta — cosi' com'e' di la' —
   e copre sia "modalità" sia "modalita". Se si tocca qui, si tocca anche li':
   e' l'unica cosa che tiene le due copie d'accordo.
   ("a mano"/"a siringa" ci stanno per la stessa ragione degli allarmi: sono
    righe che chiedono un intervento della persona, non lavoro della serra) */
const RE_EVIDENZA = /modalit|allarme|sicurezza|failsafe|non disponibil|recuperato|a siringa|a mano|booster|cambio completo|^ciclo /i
function rilievoDi(comp, testo) {
  const c = (comp || '').toLowerCase()
  if (COMP_EVIDENZA.has(c)) return 'evidenza'
  if (c === 'acqua' || c === 'luci' || c === 'ventole' || c === 'nutrienti') {
    return RE_EVIDENZA.test(testo || '') ? 'evidenza' : 'routine'
  }
  return 'routine'
}

/* ══════════════════════════════════════════════════════════════════════
   RIGHE CRITICHE (fondo rosso)
   ──────────────────────────────────────────────────────────────────────
   La famiglia allarme: errori di comando, centralina caduta, failsafe e
   sicurezze, sonda non disponibile, allarme acqua bassa, e gli avvisi di
   programma disatteso («FUORI PROGRAMMA», «RICIRCOLO NON PARTITO»).
   FUORI le righe che raccontano la FINE del problema ("rientrato", "di nuovo
   online", "resettato", "di nuovo disponibile"): sono buone notizie, e una
   fascia rossa le farebbe leggere come un secondo guasto.
   AUDIT R1 (I-12): niente 'disattivato' — non compare in nessuna delle righe
   reali e potrebbe solo far passare per "rientro" uno spegnimento.

   E' lo stesso criterio del contatore "allarmi" delle stat, ed e' lo stesso
   perche' e' LO STESSO codice: tenerne due copie voleva dire vedere prima o
   poi una riga rossa che il contatore non conta.
   ══════════════════════════════════════════════════════════════════════ */
const RE_ALLARME = /allarme|errore|sicurezza|failsafe|offline|non disponibil|fuori programma|non partit/i
const RE_RIENTRO = /rientrat|di nuovo online|resettat|di nuovo disponibil/i
// «allarme acqua bassa DISATTIVATO (essiccazione: vasca vuota)» e' la fine di
// un allarme, non un allarme: niente fascia rossa e niente conteggio. Fuori
// pero' da RE_RIENTRO, che alimenta "rientrati": uno spegnimento previsto non
// e' un rientro, e contarlo li' gonfierebbe il secondo numero come gia'
// successo col primo.
const RE_ALLARME_OFF = /allarme[^·]*disattivat/i
function criticoDi(comp, testo) {
  const t = `${comp || ''} · ${testo || ''}`
  return RE_ALLARME.test(t) && !RE_RIENTRO.test(t) && !RE_ALLARME_OFF.test(t)
}

// Icona della riga: parte dal sottosistema, si specializza sul testo dove
// cambia davvero il senso (acqua bassa ≠ ricircolo, luci spente ≠ accese).
function iconaDi(comp, testo) {
  const c = (comp || '').toLowerCase()
  const t = testo || ''
  if (c === 'acqua') {
    if (/allarme/i.test(t)) return mdiWaterAlert
    if (/cambio/i.test(t)) return mdiWaterSync
    return mdiWater
  }
  if (c === 'luci') return /spent|off\b/i.test(t) ? mdiLightbulbOff : mdiLightbulbOn
  // stessa icona con cui l'anello si presenta in Controllo: e' lo stesso oggetto
  if (c === 'anello') return mdiLedStripVariant
  if (c === 'ventole') return mdiFan
  if (c === 'nutrienti') return mdiFlask
  if (c === 'camera') return mdiCamera
  if (c === 'piano') return mdiNoteTextOutline
  if (c === 'coltivazione') return /terminata/i.test(t) ? mdiFlagCheckered : mdiSprout
  if (c === 'sistema') {
    if (/rientrat|di nuovo|resettat|ripristino/i.test(t)) return mdiCheckCircleOutline
    if (/errore|offline|failsafe|non disponibil/i.test(t)) return mdiAlertCircleOutline
    return mdiCogOutline
  }
  return mdiDotsHorizontal
}

// Accento della riga = accento del TIPO. Tutti token di app.css: nessun
// colore nuovo. 'altro' resta neutro apposta (Piano/Sistema/Coltivazione
// non sono un sottosistema fisico e un colore proprio li farebbe gridare).
const ACCENTO = {
  acqua: 'var(--acqua)',
  luci: 'var(--luce)',
  ventole: 'var(--warn)',
  nutrienti: 'var(--verde)',
  foto: 'var(--fase-fioritura)',
  altro: 'var(--fg-2)',
}

const TIPI = [
  { k: 'acqua', l: 'Acqua', icon: mdiWater },
  { k: 'luci', l: 'Luci', icon: mdiLightbulbOn },
  { k: 'ventole', l: 'Ventole', icon: mdiFan },
  { k: 'nutrienti', l: 'Nutrienti', icon: mdiFlask },
  { k: 'foto', l: 'Foto', icon: mdiCamera },
  { k: 'altro', l: 'Altro', icon: mdiDotsHorizontal },
]
// Ordine voluto: si apre su cio' che merita attenzione, la routine e' un
// secondo sguardo.
const FILTRI = [
  { k: 'evidenza', l: 'In evidenza' },
  { k: 'routine', l: 'Routine' },
  { k: 'tutto', l: 'Tutto' },
]
const CHIAVE_LETTURA = 'In evidenza: allarmi, errori, cambi di fase e di modalità — ciò che merita attenzione. '
  + 'Routine: il lavoro ordinario previsto dal piano (ricircoli, luci, dosaggi, foto).'
// Icona della testata di fase: le stesse cinque del Piano/HA (seed → sprout →
// flower → water → forbici), cosi' la fase si riconosce dallo stesso segno in
// tutte le sezioni.
const ICONA_FASE = {
  germinazione: mdiSeed,
  vegetativa: mdiSprout,
  fioritura: mdiFlower,
  flush: mdiWaterOutline,
  essiccazione: mdiContentCut,
}

/* ── parser tollerante ──────────────────────────────────────────────── */
function parseDiario(log) {
  const righe = String(log || '').split('\n')
  const out = []
  righe.forEach((raw, i) => {
    const riga = raw.trim()
    if (!riga) return
    const m = RE_TS.exec(riga)
    if (!m) {
      // Riga fuori formato: si mostra com'e'. Meglio una riga muta che un
      // buco silenzioso (o un'eccezione).
      out.push({ i, data: null, ora: EM, giorno: null, comp: null, testo: riga, ril: 'routine', tipo: 'altro' })
      return
    }
    const [, Y, M, D, h, mi, resto0] = m
    const data = new Date(+Y, +M - 1, +D, +h, +mi)
    let resto = resto0
    let giorno = null
    const g = RE_G.exec(resto)
    if (g) {
      // "gunavailable" (giorno_ciclo non numerico): il prefisso si consuma
      // lo stesso, il numero resta null e la riga finisce fra i non databili.
      if (/^\d+$/.test(g[1])) giorno = +g[1]
      resto = g[2]
    }
    let comp = null
    let testo = resto
    const k = resto.indexOf(SEP_COMP)
    if (k >= 0) { comp = resto.slice(0, k); testo = resto.slice(k + SEP_COMP.length) }
    const tipo = TIPO_DI[(comp || '').toLowerCase()] || 'altro'
    out.push({
      i,
      data,
      ora: `${h}:${mi}`,
      giorno,
      comp,
      testo,
      ril: rilievoDi(comp, testo),
      tipo,
    })
  })
  return out
}

/* ── evento STRUTTURATO (JSONL) → stessa forma di quello parsato ──────
   Chiave stabile per de-duplicare fra pagine e giri di polling: due righe con
   lo stesso istante, componente e testo SONO la stessa riga (il diario non
   registra due volte lo stesso evento nello stesso secondo). */
const chiaveEv = (e) => `${e && e.ts}|${e && e.comp}|${e && e.testo}`

function normalizzaEv(e) {
  const d = e && e.ts ? new Date(e.ts) : null
  const data = d && !isNaN(d) ? d : null
  const comp = e.comp || null
  const testo = e.testo || ''
  // il `tipo` DICHIARATO vince: chi ha scritto la riga sa meglio di un regex
  // che cosa ha fatto. Il classificatore resta la rete per un tipo assente o
  // fuori vocabolario (righe scritte da versioni piu' vecchie dello script).
  //
  // ATTENZIONE — IL CLASSIFICATORE ESISTE IN DUE COPIE, in due linguaggi:
  // qui (rilievoDi + COMP_EVIDENZA + RE_EVIDENZA) e in Jinja dentro
  // /config/packages/other/serra_mqtt.yaml, script `serra_diario_scrivi`
  // (variabile `notevole` + la lista sistema/piano/coltivazione). Niente le
  // tiene allineate: vanno modificate A MANO INSIEME, altrimenti la stessa
  // riga risulta "in evidenza" o "routine" a seconda di quando e' stata
  // scritta (il JSONL porta il tipo dichiarato dal Jinja, lo storico legacy
  // passa da qui). Verificato il 03/08: le due liste sono identiche carattere
  // per carattere, separatore compreso.
  const ril = (e.tipo === 'evidenza' || e.tipo === 'routine') ? e.tipo : rilievoDi(comp, testo)
  return {
    // il ts GREZZO si conserva: e' la chiave con cui si chiede la pagina
    // successiva, e va rimandata al backend nella forma esatta in cui e'
    // arrivata — il backend la riconverte in istante (AUDIT R1 · M-15), e
    // riscriverla qui (normalizzando l'offset, troncando i secondi) vorrebbe
    // dire mandargli un cursore che non e' piu' quello di nessuna riga
    ts: e.ts || null,
    data,
    ora: data ? `${p2(data.getHours())}:${p2(data.getMinutes())}` : EM,
    giorno: typeof e.g === 'number' ? e.g : null,
    comp,
    testo,
    // ATTENZIONE ai due "tipo": nel JSONL `tipo` e' evidenza|routine (qui
    // diventa `ril`, come per le righe parsate), mentre il `tipo` di questo
    // file e' il SOTTOSISTEMA (acqua/luci/.../altro) che comanda chip, icona
    // e accento. Il secondo si deriva dal componente, come sempre.
    tipo: TIPO_DI[(comp || '').toLowerCase()] || 'altro',
    ril,
    // 'manuale' e' l'unico valore che si mostra: 'auto' e' la norma e una pill
    // su ogni riga sarebbe rumore. Assente (storico) = non si sa, niente pill.
    origine: e.origine === 'manuale' ? 'manuale' : null,
  }
}

/* ── formattatori ───────────────────────────────────────────────────── */
/* Il dettaglio si legge con l'iniziale maiuscola («Modalità Libera»,
   «Ricircolo automatico (60s)»). Le righe gia' scritte nei file sono
   minuscole e restano tali: la maiuscola e' SOLO di display, applicata
   all'ultimo momento — dopo il classificatore evidenza/routine, le icone e i
   contatori, che lavorano tutti sul testo originale. Si tocca solo un primo
   carattere che sia una lettera minuscola: numeri e simboli (righe fuori
   formato, che cominciano con la data) restano come sono. */
function maiuscola(t) {
  const s = t || ''
  const c = s.charAt(0)
  const C = c.toUpperCase()
  return c && c !== C ? C + s.slice(1) : s
}
const p2 = (n) => String(n).padStart(2, '0')
const dm = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`
const chiaveGiorno = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
function etichettaGiorno(d, oggi) {
  if (!d) return 'Senza data'
  if (chiaveGiorno(d) === chiaveGiorno(oggi)) return 'OGGI'
  const ieri = new Date(oggi)
  ieri.setDate(ieri.getDate() - 1)
  if (chiaveGiorno(d) === chiaveGiorno(ieri)) return 'IERI'
  return dm(d)
}
// giorni di CALENDARIO fra due date (mezzanotte a mezzanotte): niente
// millisecondi, cosi' il cambio d'ora non sposta un giorno di ciclo.
function giorniFra(a, b) {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((B - A) / 86400000)
}

/* ══════════════════════════════════════════════════════════════════════
   `onToast` fa parte del contratto comune delle sezioni (attiva/onToast/onNav)
   e arriva da App come alle altre: qui non ha ancora un messaggio da dare —
   il Diario e' di sola lettura e non compie azioni. Resta nella firma perche'
   il contratto e' uno solo per tutte e cinque le sezioni.
   ══════════════════════════════════════════════════════════════════════ */
// eslint-disable-next-line no-unused-vars
export default function Diario({ attiva, model, onToast, onNav }) {
  // eventi STRUTTURATI accumulati (chiave stabile → evento): il polling
  // rilegge la prima pagina, "carica altri" ne aggiunge una piu' vecchia, e
  // la mappa tiene insieme le due cose senza doppioni.
  const [strutturati, setStrutturati] = useState([])
  const [legacy, setLegacy] = useState([])
  const [ancora, setAncora] = useState(false)       // c'e' altro sotto?
  const [caricando, setCaricando] = useState(false)
  const [vuoto, setVuoto] = useState(false)         // risposta arrivata, diario vuoto
  const [err, setErr] = useState(null)
  // si apre su "In evidenza": all'apertura conta cosa e' successo di
  // notevole, non la lista completa
  const [filtro, setFiltro] = useState('evidenza')    // evidenza | routine | tutto
  const [tipi, setTipi] = useState(null)              // null = tutti accesi
  const [aperte, setAperte] = useState({})            // chiave fase → bool (override del default)
  // una volta scesi oltre la prima pagina, il polling non deve piu' rimettere
  // il bottone "carica altri" solo perche' la prima pagina e' piena
  const paginatoRef = useRef(false)

  /* ── api/diario ─────────────────────────────────────────────────────
     Un endpoint solo per due sorgenti: il backend restituisce gli eventi
     STRUTTURATI (JSONL del dual write) gia' de-duplicati e, quando si e'
     arrivati in fondo, la coda LEGACY del vecchio diario testuale — cioe'
     quello che e' stato scritto prima che il logging strutturato esistesse. */
  const carica = useCallback((before) => {
    setCaricando(true)
    const q = before ? `?limit=500&before=${encodeURIComponent(before)}` : '?limit=500'
    return fetch(`api/diario${q}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => {
        const nuovi = Array.isArray(j.eventi) ? j.eventi : []
        setStrutturati((prec) => {
          const m = new Map(prec.map((e) => [chiaveEv(e), e]))
          nuovi.forEach((e) => m.set(chiaveEv(e), e))
          return [...m.values()]
        })
        const leg = Array.isArray(j.legacy) ? j.legacy : []
        // il legacy arriva SOLO quando si e' toccato il fondo: se c'e' lo si
        // tiene, e non lo si cancella con la risposta di una prima pagina che
        // (essendo piena) non lo porta
        if (leg.length) setLegacy(leg)
        else if (!paginatoRef.current) setLegacy([])
        // il bottone lo comanda solo la richiesta che sta scavando in fondo:
        // il polling della prima pagina non lo rimette se abbiamo gia' sceso
        if (before || !paginatoRef.current) setAncora(!!j.altri)
        if (before) paginatoRef.current = true
        setVuoto(!before && !nuovi.length && !leg.length)
        setErr(null)
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setCaricando(false))
  }, [])

  useEffect(() => {
    if (!attiva) return undefined
    carica()   // il primo giro ignora document.hidden (l'iframe Ingress mente)
    const tick = () => { if (!document.hidden) carica() }
    const iv = setInterval(tick, DIARIO_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [attiva, carica])

  /* ── le due sorgenti diventano una lista sola ───────────────────────
     Gli eventi strutturati portano `tipo` e `origine` DICHIARATI da chi ha
     scritto la riga: vincono sempre sul classificatore, che resta solo per lo
     storico (dove non c'e' nessuna dichiarazione da rispettare) e come rete
     per un `tipo` assente o fuori vocabolario. */
  const eventi = useMemo(() => {
    const da = strutturati.map(normalizzaEv)
    const st = parseDiario(legacy.join('\n'))
    // le due liste non si sovrappongono (il backend taglia il legacy al primo
    // evento strutturato): basta concatenare e riordinare per data.
    const tutti = [...da, ...st]
    tutti.sort((a, b) => {
      const ta = a.data ? a.data.getTime() : -Infinity
      const tb = b.data ? b.data.getTime() : -Infinity
      return tb - ta
    })
    return tutti.map((e, i) => ({ ...e, i }))
  }, [strutturati, legacy])

  const oggi = useMemo(() => new Date(), [strutturati])   // rinfrescata a ogni poll
  const semina = model?.semina || null

  /* ── confine con la coltura precedente ──────────────────────────────
     Il diario non e' tagliato per coltura (lo e' solo `fatti`): la coda del
     file puo' contenere ancora quella di prima. Il confine e' la MEZZANOTTE
     DEL GIORNO DI SEMINA della coltura in corso — l'unico dato che dice
     davvero dove comincia.

     NON la riga "Coltivazione · AVVIATA": nel diario vero ne compare una per
     ogni riavvio della coltivazione, e una coltura viene terminata e
     riavviata anche solo per correggere la data di semina. Tagliare alla piu'
     recente spediva nel gruppo "Coltura precedente" tutto cio' che stava
     sotto, cioe' le prime due settimane della coltura IN CORSO.

     Le righe piu' vecchie della semina si tengono — buttarle sarebbe una
     bugia — ma in un gruppo loro, chiuso. */
  const inizioColtura = useMemo(() => (
    semina ? new Date(semina.getFullYear(), semina.getMonth(), semina.getDate()).getTime() : null
  ), [semina])
  const precedente = useCallback(
    (ev) => inizioColtura != null && !!ev.data && ev.data.getTime() < inizioColtura,
    [inizioColtura],
  )

  /* Giorno di ciclo di una riga. La DATA vince sul "gN" scritto nel file: il
     gN e' quello che il sistema conosceva nell'istante in cui scriveva, e una
     semina spostata lo lascia indietro per sempre (nel diario vero righe dello
     stesso minuto portano g1, g17, g22 e g32; altre scritte a mezzanotte in
     punto portano il giorno prima). Il gN scritto serve solo dove la data
     manca — riga troncata o fuori formato. */
  const giornoDi = useCallback((ev) => {
    if (semina && ev.data) {
      // riga della coltura precedente: un giorno di QUESTA non ce l'ha
      if (precedente(ev)) return null
      return giorniFra(semina, ev.data) + 1
    }
    return ev.giorno != null ? ev.giorno : null
  }, [semina, precedente])

  /* ── contatori (4 card del design) ─────────────────────────────────
     Contano su cio' che e' CARICATO, non su tutto il diario: con la
     paginazione si scende a richiesta e il totale della coltura resta una
     cosa che nessuno registra. L'(i) di ogni card dichiara il perimetro,
     invece di far passare un parziale per un totale. */
  const stats = useMemo(() => {
    const n = (re) => eventi.filter((e) => re.test(`${e.comp || ''} · ${e.testo || ''}`)).length
    /* Il conto e' dei RICIRCOLI FATTI, non di quelli schedulati: la card dice
       "ricircoli" e l'(i) parla di ricircoli e nebulizzazioni, senza distinguere
       chi li ha chiesti. Quindi la riga nuova «Acqua · ricircolo avviato a mano»
       — che il logger scrive da quando registra anche i comandi del pannello —
       entra nel conto, ed e' giusto: la pompa ha girato. Se un giorno servisse
       il solo automatico, il filtro va sull'`origine` della riga, non sul testo. */
    const ricircoli = n(/ricircolo|pompa avviata|nebulizzazione/i)
    const dosaggi = n(/erogat|a siringa|booster somministrato|aggiunta nutrienti|cambio completo/i)
    const foto = eventi.filter((e) => e.tipo === 'foto').length
    // Una riga di RISOLUZIONE non e' un allarme: "errore resettato
    // manualmente" contiene 'errore' ma racconta la fine del problema, non
    // il problema — contarla in entrambi gonfiava tutti e due i numeri
    // (visto da Alberto: "23 · 52 rientrati"). Il criterio sta in criticoDi:
    // e' lo stesso che accende il fondo rosso sulla riga.
    const allarmi = eventi.filter((e) => criticoDi(e.comp, e.testo)).length
    const rientri = n(RE_RIENTRO)
    return [
      {
        k: 'ricircoli', icon: mdiWater, accent: ACCENTO.acqua, label: 'ricircoli',
        val: `${ricircoli} caricati`,
        info: 'Ricircoli e nebulizzazioni fra gli eventi caricati. Scendendo con “carica gli eventi più vecchi” il conto cresce: vale sugli eventi in elenco, non sull’intera coltura.',
      },
      {
        k: 'dosaggi', icon: mdiFlask, accent: ACCENTO.nutrienti, label: 'dosaggi',
        val: `${dosaggi} caricati`,
        info: 'Erogazioni con le pompe, dosi a siringa confermate, cambi acqua completi e booster.',
      },
      {
        k: 'foto', icon: mdiCamera, accent: ACCENTO.foto, label: 'foto',
        val: `${foto} caricate`,
        info: 'Scatti fra gli eventi caricati. L’archivio completo delle foto è nella sezione Stato.',
      },
      {
        k: 'allarmi', icon: mdiAlertCircleOutline, accent: 'var(--errore)', label: 'allarmi',
        val: allarmi === 0 ? 'Nessuno' : `${allarmi} · ${rientri} rientrati`,
        info: 'Allarmi, errori di comando, sicurezze, cadute della centralina e avvisi di programma disatteso fra gli eventi caricati: sono le righe col fondo rosso. “Rientrati” conta le righe che dichiarano il ritorno alla normalità: non sono coppie — un rientro può riferirsi a un allarme più vecchio degli eventi caricati.',
      },
    ]
  }, [eventi])

  /* ── filtri ─────────────────────────────────────────────────────────
     I due filtri si combinano: prima il rilievo (evidenza/routine/tutto),
     poi i chip per sottosistema. Un chip e' DISABILITATO (tratteggiato) se,
     col rilievo corrente, non resterebbe nessun evento di quel tipo —
     stessa regola del design (r.502-509), applicata al filtro nuovo. */
  const disponibili = useMemo(() => {
    const s = new Set()
    eventi.forEach((e) => { if (filtro === 'tutto' || e.ril === filtro) s.add(e.tipo) })
    return s
  }, [eventi, filtro])

  const tipoAcceso = (k) => !tipi || tipi[k]
  const toggleTipo = (k) => setTipi((t) => {
    const base = t || { acqua: true, luci: true, ventole: true, nutrienti: true, foto: true, altro: true }
    return { ...base, [k]: !base[k] }
  })
  const passa = useCallback((e) => (filtro === 'tutto' || e.ril === filtro) && tipoAcceso(e.tipo), [filtro, tipi])

  /* ── raggruppamento: fase → giorno → eventi ─────────────────────────
     Le fasi arrivano dal modello (stesse date, stessi colori del Piano):
     qui non si ricalcola nulla, si smista. Ordine dal piu' recente al piu'
     vecchio, come nel design. */
  const gruppi = useMemo(() => {
    const fasi = (model?.fasi || []).filter((f) => f.valid)
    const perGruppo = new Map()
    const chiaveDi = (ev) => {
      if (precedente(ev)) return '__prec'
      const g = giornoDi(ev)
      if (g == null) return '__fuori'
      const f = fasi.find((x) => g >= x.start && g <= x.end)
      return f ? f.key : '__fuori'
    }
    eventi.forEach((ev) => {
      const k = chiaveDi(ev)
      if (!perGruppo.has(k)) perGruppo.set(k, [])
      perGruppo.get(k).push(ev)
    })
    const meta = []
    // fasi dal piu' recente al piu' vecchio
    for (let i = fasi.length - 1; i >= 0; i--) {
      const f = fasi[i]
      if (!perGruppo.has(f.key)) continue
      const d0 = model?.semina ? new Date(model.semina.getFullYear(), model.semina.getMonth(), model.semina.getDate() + f.start - 1) : null
      const d1 = model?.semina ? new Date(model.semina.getFullYear(), model.semina.getMonth(), model.semina.getDate() + f.end - 1) : null
      meta.push({
        key: f.key,
        label: f.label,
        accent: f.color,
        icon: ICONA_FASE[f.key] || mdiSprout,
        corrente: !!f.current,
        range: f.current
          ? `g${f.start} – oggi${d0 ? ` · dal ${dm(d0)}` : ''}`
          : `g${f.start} – g${f.end}${d0 && d1 ? ` · ${dm(d0)} – ${dm(d1)}` : ''}`,
        eventi: perGruppo.get(f.key),
      })
    }
    // Righe non assegnabili a una fase (giorno di ciclo assente o fuori
    // dall'arco del piano) e coda del ciclo precedente: due gruppi neutri
    // in fondo, chiusi.
    if (perGruppo.has('__fuori')) {
      meta.push({
        // "Fuori dal piano" no: suonava applicabile anche alle azioni manuali,
        // che nel piano non ci sono ma nella coltura si'. Qui finiscono solo
        // le righe che non si riescono ad appendere a un giorno del ciclo.
        key: '__fuori', label: 'Fuori dalla coltura in corso', accent: 'var(--fg-2)', icon: mdiAlertOutline,
        corrente: false, range: 'righe senza giorno di ciclo', eventi: perGruppo.get('__fuori'),
      })
    }
    if (perGruppo.has('__prec')) {
      meta.push({
        key: '__prec', label: 'Coltura precedente', accent: 'var(--fg-2)', icon: mdiHistory,
        corrente: false,
        range: semina ? `prima del ${dm(semina)}, semina di questa coltura` : 'prima di questa coltura',
        eventi: perGruppo.get('__prec'),
      })
    }
    return meta
  }, [eventi, model, giornoDi, precedente, semina])

  // aperto/chiuso: default = solo la fase corrente aperta (design r.178)
  const isAperta = (g) => (g.key in aperte ? aperte[g.key] : g.corrente)
  const toggleFase = (k, def) => setAperte((a) => ({ ...a, [k]: !(k in a ? a[k] : def) }))

  // giorni di un gruppo, filtrati: un giorno senza eventi superstiti sparisce
  const giorniDi = useCallback((g) => {
    const per = new Map()
    g.eventi.forEach((ev) => {
      if (!passa(ev)) return
      const k = ev.data ? chiaveGiorno(ev.data) : '__nd'
      if (!per.has(k)) per.set(k, { data: ev.data, giorno: giornoDi(ev), eventi: [] })
      per.get(k).eventi.push(ev)
    })
    return [...per.values()]
  }, [passa, giornoDi])

  const nRighe = eventi.length

  /* ── stati vuoti ──────────────────────────────────────────────────── */
  const primoGiro = caricando && !nRighe && !err
  /* "carica altri": il diario piu' vecchio esiste ancora, e' solo piu' giu'.
     Si riparte dal ts GREZZO dell'evento strutturato piu' vecchio che abbiamo,
     rimandato tale e quale (un toISOString lo convertirebbe in UTC e non
     sarebbe piu' il ts di nessuna riga).
     AUDIT R2 (R2-7): "piu' vecchio" si decide per ISTANTE ASSOLUTO, lo stesso
     criterio con cui il backend consuma il cursore da M-15 in poi. Sceglierlo
     con un `<` fra stringhe ISO CON OFFSET dava un vincitore diverso nell'ora
     ripetuta del cambio d'ora autunnale ('…T02:15+01:00' precede
     '…T02:30+02:00' come stringa, ma gli e' successivo come istante). */
  const tsPiuVecchio = useMemo(() => {
    let ts = null, min = Infinity
    strutturati.forEach((e) => {
      if (!e || !e.ts) return
      const t = new Date(e.ts).getTime()
      if (isNaN(t) || t >= min) return
      min = t; ts = String(e.ts)
    })
    return ts
  }, [strutturati])
  const cercaAltri = () => { if (tsPiuVecchio) carica(tsPiuVecchio) }

  return (
    <section className={'di-root' + (attiva ? '' : ' sez-off')} aria-label="Diario">
      {/* data-sez-band: titolo + filtri sono la fascia ferma della sezione —
          il contenuto passa sotto DI LEI, non sotto la nav. Hairline e ombra
          si accendono qui (App.jsx, .sc-under) e la nav resta pulita. */}
      <div className="di-head" data-sez-band="1">
        <span className="di-titolo">Diario della coltura</span>
        <span className="di-sub">registro automatico di cosa ha fatto la serra</span>
        {/* l'(i) sta SUBITO DOPO il segmented: e' la chiave di lettura di
            tutta la sezione, non di una singola voce */}
        <div className="di-filtri-wrap">
          <div className="di-filtri" role="group" aria-label="Filtro rilievo">
            {FILTRI.map((f) => (
              <button key={f.k} type="button" className={'di-filtro' + (filtro === f.k ? ' on' : '')}
                aria-pressed={filtro === f.k} onClick={() => setFiltro(f.k)}>{f.l}</button>
            ))}
          </div>
          <RowInfo text={CHIAVE_LETTURA} />
        </div>
        <span className="di-sep" aria-hidden="true" />
        <div className="di-tipi" role="group" aria-label="Filtro sottosistema">
          {TIPI.map((t) => {
            const vuoto = !disponibili.has(t.k)
            const on = tipoAcceso(t.k)
            return (
              <button key={t.k} type="button" disabled={vuoto}
                className={'di-tipo' + (on && !vuoto ? ' on' : '') + (vuoto ? ' vuoto' : '')}
                aria-pressed={on && !vuoto}
                onClick={() => toggleTipo(t.k)}>
                <Icon path={t.icon} size={14} />{t.l}
              </button>
            )
          })}
        </div>
      </div>

      <div className="di-scroll" data-sez-scroll="1">
        {/* Serra ferma: dirlo, invece di lasciare un registro che smette di
            crescere senza spiegare perche'. Lo storico sotto resta: e' il
            valore della sezione, non un residuo. */}
        {model && model.coltivazioneAttiva === false && (
          <div className="di-nota di-nota--lock" role="status">
            <Icon path={mdiFlagCheckered} size={17} />
            Non c’è una coltivazione in corso: il diario riprende all’avvio della prossima coltura.
          </div>
        )}
        {err && (
          <div className="di-nota di-nota--lock" role="status">
            <Icon path={mdiAlertOutline} size={17} />
            Diario non disponibile in questo momento ({err}): la sezione si aggiorna da sola al prossimo giro.
          </div>
        )}
        {primoGiro && <div className="di-nota di-nota--lock">Lettura del diario in corso…</div>}
        {vuoto && !err && (
          <div className="di-nota di-nota--lock">Il diario è vuoto: non ci sono ancora eventi registrati.</div>
        )}

        {nRighe > 0 && (
          <div className="di-stats">
            {stats.map((s) => (
              <div className="di-stat" key={s.k} style={{ '--di-accent': s.accent }}>
                <Icon path={s.icon} size={21} color="var(--di-accent)" />
                <div className="di-stat-txt">
                  <div className="di-stat-lab">
                    {s.label}
                    <RowInfo text={s.info} />
                  </div>
                  <div className="di-stat-val">{s.val}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {gruppi.map((g) => {
          const aperta = isAperta(g)
          const giorni = aperta ? giorniDi(g) : []
          return (
            <div className="di-fase" key={g.key} style={{ '--di-accent': g.accent }}>
              <button type="button" className="di-fase-head" aria-expanded={aperta}
                onClick={() => toggleFase(g.key, g.corrente)}>
                <span className="di-fase-disc"><Icon path={g.icon} size={18} /></span>
                <span className="di-fase-lab">{g.label}</span>
                <span className="di-fase-range mono">{g.range}</span>
                <span className="di-fase-n">· {g.eventi.length} {g.eventi.length === 1 ? 'evento' : 'eventi'}</span>
                <span className="spacer" />
                {g.corrente && <span className="di-fase-badge">IN CORSO</span>}
                <Icon path={aperta ? mdiChevronUp : mdiChevronDown} size={21} color="var(--fg-3)" />
              </button>
              {aperta && (
                <div className="di-fase-body">
                  {giorni.length === 0 && (
                    <div className="di-vuoto">Nessun evento di questa fase con i filtri attivi.</div>
                  )}
                  {giorni.map((d, i) => {
                    const et = etichettaGiorno(d.data, oggi)
                    const dataInline = (et === 'OGGI' || et === 'IERI') && d.data ? `${dm(d.data)} · ` : ''
                    return (
                      <div className="di-giorno" key={d.data ? chiaveGiorno(d.data) : `nd-${i}`}>
                        <div className="di-giorno-head">
                          <span className="di-giorno-lab">{et}</span>
                          <span className="di-giorno-sub mono">
                            {dataInline}{d.giorno != null ? `g${d.giorno}` : 'giorno non noto'}
                          </span>
                        </div>
                        {d.eventi.map((ev) => {
                          const critica = criticoDi(ev.comp, ev.testo)
                          return (
                            /* Sul fondo rosso l'accento del sottosistema
                               diventerebbe una macchia (un disco azzurro su
                               banda rossa): sulla riga critica l'accento passa
                               al bianco, e il sottosistema resta leggibile dal
                               glifo e dal chip di filtro. L'accento viaggia
                               inline perche' e' un dato, non uno stato: da CSS
                               non si potrebbe sovrascrivere. */
                            <div key={ev.i} style={{ '--di-accent': critica ? 'var(--fg-1)' : ACCENTO[ev.tipo] }}
                              className={'di-riga'
                                + (ev.ril === 'evidenza' ? ' di-riga--ril' : '')
                                + (critica ? ' di-riga--critica' : '')}>
                              <span className="di-riga-disc">
                                <Icon path={iconaDi(ev.comp, ev.testo)} size={17} color="var(--di-accent)" />
                              </span>
                              <span className="di-riga-ora mono">{ev.ora}</span>
                              <span className="di-riga-txt">
                                {ev.comp && <b>{ev.comp}</b>}
                                {ev.comp ? ' · ' : ''}{maiuscola(ev.testo)}
                              </span>
                              {/* Solo "manuale": auto e' la norma e una pill su
                                  ogni riga sarebbe rumore. Sullo storico, dove
                                  l'origine non e' registrata, non compare nulla
                                  — meglio niente che una pill indovinata. */}
                              {ev.origine === 'manuale' && (
                                <span className="di-riga-org">manuale</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Il tetto delle 60 righe non c'e' piu': il diario si legge dal file,
            non da un attributo di sensore, e scende fin dove serve. */}
        {ancora && (
          <button type="button" className="di-altri" disabled={caricando} onClick={cercaAltri}>
            <Icon path={mdiHistory} size={16} />
            {caricando ? 'Carico…' : 'Carica gli eventi più vecchi'}
          </button>
        )}
        {nRighe > 0 && (
          <div className="di-cap">
            Le azioni segnate come fatte e le note della coltura si gestiscono nel{' '}
            <button type="button" className="di-link" onClick={() => onNav && onNav('piano')}>Piano</button>.
          </div>
        )}
      </div>
    </section>
  )
}
