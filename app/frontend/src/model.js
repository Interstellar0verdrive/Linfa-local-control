// Costruisce il modello timeline dagli stati HA grezzi (api/timeline).
// UNICA fonte della logica di composizione lato UI: fasi effettive ->
// giorni -> eventi -> milestone -> limbo. I calcoli di cascata restano in HA
// (serra_fasi_effettive); qui si legge il risultato e si deriva la vista.
//
// Palette = ALB Design System (mockup "Calendario Ciclo v3"):
// germinazione→umidita · vegetativa→media · fioritura→etra ·
// flush→tapparella · essiccazione→luce.
// I VALORI vivono in :root (app.css, token --fase-*/--hero-*): qui si
// referenziano soltanto, così esiste UNA sola sorgente dei colori.
const fase = (key, letter, label) => ({
  key, letter, label,
  color: `var(--fase-${key})`,
  c10: `var(--fase-${key}-10)`,
  c25: `var(--fase-${key}-25)`,
  c50: `var(--fase-${key}-50)`,
  hero: `var(--hero-${key})`,
})

// interno al modulo: nessun altro file lo importa (K-8)
const FASI = [
  fase('germinazione', 'G', 'Germinazione'),
  fase('vegetativa', 'V', 'Vegetativa'),
  fase('fioritura', 'F', 'Fioritura'),
  fase('flush', 'W', 'Flush'),
  fase('essiccazione', 'E', 'Essiccazione'),
]


// somma GIORNI DI CALENDARIO (non millisecondi): il costruttore Date normalizza
// e usare i componenti locali evita lo sfasamento sui cambi d'ora (DST). Con
// (base.getTime() + n*86400000) attorno al fall-back di fine ottobre due giorni
// consecutivi finivano sulla stessa data → note condivise tra E15/E16.
export function addDays(base, n) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n)
}

function att(entities, id, key, fallback = null) {
  const e = entities[id]
  if (!e || !e.attributes) return fallback
  return e.attributes[key] ?? fallback
}
// AUDIT R1 (MD-03/MD-04): gli stati-sentinella di HA valgono come ASSENZA →
// fallback, mai stringhe spazzatura che a valle diventano NaN / Invalid Date
// (fino a scritture corrotte tipo date "NaN-NaN-NaN" verso HA).
const BAD_STATES = new Set(['unavailable', 'unknown', 'none', ''])
function st(entities, id, fallback = null) {
  const s = entities[id]?.state
  return s == null || BAD_STATES.has(s) ? fallback : s
}

function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtDate(d) {
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
}
export function fmtWd(d) {
  return d.toLocaleDateString('it-IT', { weekday: 'short' })
}
// ── Pezzi della data per la testata dell'ispettore ──────────────────────
// Il quadrato a sinistra e' un DATE BOX ("DOM" sopra, "23" sotto) e il testo
// accanto porta la data per esteso con l'anno: il giorno della settimana sta
// solo nel box, la data solo nel testo — nessuna ripetizione.
// Per esteso: sul desktop e' la riga sopra la data (nello stile del kicker).
export function fmtWdLong(d) {
  return d.toLocaleDateString('it-IT', { weekday: 'long' })
}
// 3 lettere secche: alcune build di ICU scrivono "dom." con il punto.
export function fmtWd3(d) {
  return d.toLocaleDateString('it-IT', { weekday: 'short' }).replace(/\W/g, '').slice(0, 3)
}
// SEMPRE 2 cifre: nel box "3" ballerebbe rispetto alle 3 lettere sopra.
export function fmtDD(d) {
  return String(d.getDate()).padStart(2, '0')
}
export function fmtDayMonthYear(d) {
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
}

function hhmm(s) {
  return (s || '').slice(0, 5)
}

function oreLuci(on, off) {
  // durata fotoperiodo in ore (off dopo mezzanotte incluso)
  const [h1, m1] = on.split(':').map(Number)
  const [h2, m2] = off.split(':').map(Number)
  let h = (h2 + 24 - h1) % 24 + (m2 - m1) / 60
  if (h === 0) h = 24
  return Math.round(h * 10) / 10
}

function addOre(hhmmStr, ore) {
  // sposta un orario "HH:MM" di N ore (modulo 24), minuti preservati
  const [h, m] = (hhmmStr || '06:00').split(':').map(Number)
  return `${String((h + ore) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function ricircoliOrari(luciOn, ore) {
  const [h0, m0] = (luciOn || '06:00').split(':').map(Number)
  return (ore || []).map((o) => {
    const h = (h0 + Math.floor(o)) % 24
    const m = m0 + Math.round((o % 1) * 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  })
}

// Specchio client-side della cascata di serra_fasi_effettive (Jinja):
// dato mappa + un cambiamento d'ancora, ricalcola gli inizi a valle.
// Serve SOLO per l'aggiornamento ottimistico: la verità resta HA,
// che viene riletta subito dopo.
export function cascadeMappa(m, changes) {
  const n = { ...m, ...changes }
  n.veg_g = n.veg_conf ? n.veg_g : n.veg_plan
  n.fior_g = n.fior_conf ? n.fior_g : (n.foto ? 9999 : n.veg_g + (m.base_fior - m.veg_plan))
  // AUDIT R2 (MD2-09): specchio del guard 9999 del Jinja — in foto pre-flip
  // la cascata NON deve produrre 9999+dur (numeri gonfiati che inquinavano
  // concl_g e quindi essOltre nello stato ottimistico).
  n.flush_start = n.flush_g > 0 ? n.flush_g : (n.fior_g < 9999 ? n.fior_g + n.dur_fior : 9999)
  n.ess_start = n.ess_g > 0 ? n.ess_g : (n.flush_start < 9999 ? n.flush_start + n.dur_flush : 9999)
  n.concl_g = n.ess_start < 9999 ? n.ess_start + n.dur_ess : 9999
  return n
}

export const MOVE_CHANGES = {
  vegetativa: (g) => ({ veg_g: g, veg_conf: true }),
  fioritura: (g) => ({ fior_g: g, fior_conf: true }),
  flush: (g) => ({ flush_g: g }),
  essiccazione: (g) => ({ ess_g: g }),
}
export const RESET_CHANGES = {
  vegetativa: () => ({ veg_conf: false }),
  fioritura: () => ({ fior_conf: false }),
  flush: () => ({ flush_g: 0 }),
  essiccazione: () => ({ ess_g: 0 }),
}

// AUDIT R1 (MD-07) — RESIDUO ACCETTATO, NON "correggere" senza contesto:
// questa funzione DIVERGE volutamente da HA nel limbo dei periodi. HA tratta
// "nessun periodo che copre il giorno" come solo-acqua (dose nulla); qui si
// ritorna l'ULTIMO periodo come suggerimento visivo. La mitigazione vera e'
// a monte: il parser (batch G) impone fino_giorno crescenti e solo l'ultimo
// periodo puo' essere aperto, quindi il limbo non esiste su un piano valido.
export function dosePerGiorno(periodi, dof) {
  if (!periodi || !periodi.length) return null
  for (const p of periodi) {
    if (p.fino_giorno != null && dof <= p.fino_giorno) return p
  }
  return periodi[periodi.length - 1]
}

// AUDIT R1 (NT-13): normalizzazione ESTESA e SIMMETRICA al lato HA
// (apostrofi e virgolette tipografiche) — se si tocca, toccare ENTRAMBI.
// AUDIT R2 (MD2-04): esportata — la usa anche l'aggiornamento ottimistico
// di markDone/markUndone in App.jsx per patchare l'attr `fatti`.
export const normTitolo = (s) => (s || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim()

/* Livelli ventole: valore HA ⇄ etichetta italiana.
   AUDIT R2 (R2-4) — sta QUI e non in Controllo perche' le tendine sono due
   (Controllo · Ventole e Impostazioni · Componenti) e devono dire la stessa
   parola: prima Impostazioni mostrava «medium» mentre Controllo diceva «Media»,
   ed era l'unica stringa in inglese dell'interfaccia. Le CHIAVI sono le opzioni
   esatte dell'input_select (`off|low|medium|high`) e non si toccano: quello che
   cambia e' solo cio' che si legge. `off` non e' fra i livelli scegliibili in
   Impostazioni (li' si sceglie il livello dell'AUTOMATICO, che non e' "ferma"). */
export const LIVELLO_LAB = { off: 'Ferma', low: 'Bassa', medium: 'Media', high: 'Alta' }

export function buildModel(payload) {
  const entities = payload.entities || {}
  const mappa = att(entities, 'sensor.serra_fasi_effettive', 'mappa')
  const eventi = att(entities, 'sensor.serra_eventi_effettivi', 'eventi', [])
  const seminaIso = st(entities, 'input_datetime.serra_data_semina')
  if (!mappa || !seminaIso) return null

  const semina = parseLocalDate(seminaIso)
  // AUDIT R1 (MD-03/MD-04): con dati inutilizzabili meglio la schermata di
  // caricamento che una timeline plausibile ma sbagliata (o scritture NaN).
  if (isNaN(semina)) return null
  const oggiN = Number(st(entities, 'sensor.serra_giorno_ciclo'))
  if (!Number.isFinite(oggiN) || oggiN < 1) return null
  const oggi = oggiN
  const faseAttuale = st(entities, 'sensor.serra_fase', '')
  const varieta = st(entities, 'input_select.serra_varieta', 'Autofiorente')
  const piano = entities['sensor.serra_piano']?.attributes || {}
  const luciOn = hhmm(st(entities, 'input_datetime.serra_luci_on', '06:00'))
  const luciOff = hhmm(st(entities, 'input_datetime.serra_luci_off', '00:00'))

  // eventi del piano completo (con dose/ancora, che eventi_effettivi strippa):
  // indicizzati per titolo per arricchire i chip.
  const pianoEventi = new Map()
  for (const ev of piano.eventi || []) pianoEventi.set(ev.titolo, ev)

  // Stato "fatto" — AUDIT R1 (MD-01): fonte UFFICIALE = attr `fatti` di
  // sensor.serra_diario (mappa {titolo -> FATTO|ANNULLATO} calcolata da HA
  // sull'intero diario del ciclo corrente, già normalizzata). Il vecchio
  // parsing dell'attr `log` (finestra 60 righe: divergeva da HA dopo ~2gg)
  // resta SOLO come fallback per payload senza `fatti`.
  // normTitolo assorbe gli apostrofi tipografici delle righe storiche.
  const fatti = att(entities, 'sensor.serra_diario', 'fatti', null)
  const statoEvento = new Map()
  // AUDIT R2 (MD2-05): fail-CLOSED come HA (NT-05) — se il diario e' giu'
  // (ne' attr fatti ne' log) NON si puo' sapere cosa e' fatto: meglio zero
  // pendenti che una valanga di falsi pendenti divergente dal sensore HA.
  let fattiOk = true
  if (fatti && typeof fatti === 'object') {
    for (const [t, s] of Object.entries(fatti)) statoEvento.set(normTitolo(t), s === 'FATTO')
  } else {
    const diarioLog = att(entities, 'sensor.serra_diario', 'log', '') || ''
    if (!diarioLog) fattiOk = false
    for (const line of diarioLog.split('\n')) {
      const m = line.match(/(FATTO|ANNULLATO):\s*(.+)\s*$/)
      if (m) {
        const t = normTitolo(m[2])
        if (!statoEvento.has(t)) statoEvento.set(t, m[1] === 'FATTO')
      }
    }
  }

  // Fotoperiodica PRIMA del flip 12/12: fioritura/flush/essiccazione non sono
  // ancora partite (HA le tiene a 9999, partono solo a conferma). La vegetativa
  // non ha una fine nota: la disegniamo "aperta" fino a oggi + margine (coprendo
  // gli eventi veg già noti) e offriamo una milestone per innescare il flip.
  const fotoPending = mappa.foto === true && !mappa.fior_conf
  let vegEnd = mappa.fior_g - 1
  let flipDefault = null
  if (fotoPending) {
    const vegEvtDays = eventi.filter((e) => e.giorno > mappa.veg_g && e.giorno < 9000).map((e) => e.giorno)
    const lastEvt = vegEvtDays.length ? Math.max(...vegEvtDays) : mappa.veg_g
    flipDefault = Math.max(oggi + 1, lastEvt + 1)   // flip proposto: dopo oggi e dopo gli ultimi task veg
    vegEnd = flipDefault - 1                          // veg disegnata fino al giorno prima del flip
  }

  const startOf = {
    germinazione: 1,
    vegetativa: mappa.veg_g,
    fioritura: mappa.fior_g,
    flush: mappa.flush_start,
    essiccazione: mappa.ess_start,
  }
  // F1 (decisione Alberto): l'essiccazione va A OLTRANZA — oltre la fine
  // prevista dal piano si APPENDONO giorni (tratteggiati come il limbo)
  // finche' la coltura non viene conclusa esplicitamente. Il piano stima,
  // lo snap test decide.
  const coltivazioneAttiva = st(entities, 'input_boolean.serra_coltivazione_attiva', 'on') === 'on'
  // AUDIT R2 (MD2-01): specchio del gate HA (serra_fase) — l'essiccazione "a
  // oltranza" esiste solo se il taglio E' CONFERMATO (ess_g > 0). Senza gate,
  // con taglio mai confermato il pannello appendeva giorni tratteggiati mentre
  // HA restava in fioritura/flush e la CTA (legata alla fase HA) non compariva.
  const essOltre = coltivazioneAttiva && mappa.ess_g > 0 && oggi >= mappa.concl_g && mappa.ess_start < 9000
  // AUDIT R2: oltre la fine del piano SENZA taglio confermato — la CTA deve
  // comparire comunque (unica uscita: confermare le milestone o concludere).
  const oltrePiano = coltivazioneAttiva && oggi >= mappa.concl_g
  const endOf = {
    germinazione: mappa.veg_g - 1,
    vegetativa: vegEnd,
    fioritura: mappa.flush_start - 1,
    flush: mappa.ess_start - 1,
    essiccazione: essOltre ? oggi : mappa.concl_g - 1,
  }
  // AUDIT R3 (MD3-01): il clamp confermate-only lato HA (R2-B) rende
  // possibile una mappa NON contigua (es. taglio d'emergenza g60 con flush
  // previsto a g71: ess_start < flush_start). Senza questo, le fasi si
  // SOVRAPPONEVANO (giorni doppi, due marker OGGI, Inspector che mostrava
  // luci di fioritura durante il buio dell'essiccazione). Ogni fase finisce
  // comunque PRIMA dell'inizio di qualunque fase reale a valle: la fase
  // "scavalcata" collassa a invalid e sparisce, come deve.
  {
    const ordine = ['germinazione', 'vegetativa', 'fioritura', 'flush', 'essiccazione']
    // AUDIT R4 (R4C-01): in foto PRE-flip le fasi a valle sono tutte moot —
    // anche un flush/ess rimasto confermato per errore (stessa guardia della
    // validity a valle): senza questo skip il clamp troncava la vegetativa
    // aperta e OGGI spariva dalla timeline.
    const aValleMoot = new Set(fotoPending ? ['fioritura', 'flush', 'essiccazione'] : [])
    for (let i = 0; i < ordine.length - 1; i++) {
      let minLater = Infinity
      for (let j = i + 1; j < ordine.length; j++) {
        if (aValleMoot.has(ordine[j])) continue
        const s0 = startOf[ordine[j]]
        if (Number.isFinite(s0) && s0 > 0 && s0 < 9000) minLater = Math.min(minLater, s0)
      }
      if (minLater < Infinity) endOf[ordine[i]] = Math.min(endOf[ordine[i]], minLater - 1)
    }
  }
  // inizio PIANIFICATO (default dal piano) della fase successiva: serve per il
  // limbo = giorni della fase corrente oltre la fine prevista (fase prolungata).
  const planNextOf = {
    germinazione: mappa.veg_plan,
    vegetativa: mappa.base_fior,
    fioritura: mappa.flush_plan,
    flush: mappa.ess_plan,
    essiccazione: null,
  }
  const confirmedOf = {
    germinazione: true,
    vegetativa: mappa.veg_conf,
    fioritura: mappa.fior_conf,
    flush: mappa.flush_g > 0,
    essiccazione: mappa.ess_g > 0,
  }

  const eventiPerGiorno = new Map()
  for (const ev of eventi) {
    if (!eventiPerGiorno.has(ev.giorno)) eventiPerGiorno.set(ev.giorno, [])
    eventiPerGiorno.get(ev.giorno).push({
      ...ev,
      piano: pianoEventi.get(ev.titolo),
      done: statoEvento.get(normTitolo(ev.titolo)) === true,
    })
  }

  // AZIONI PENDENTI — specchio client-side di sensor.serra_azioni_pendenti
  // (notifiche v2): eventi MANUALI (azione/booster/raccolto) con giorno <= oggi
  // non FATTI (gli ANNULLATO tornano da fare). ritardo 0 = oggi.
  // AUDIT R1 (MD-09): stesso gate di HA — a coltivazione spenta, zero pendenti.
  const MANUALI = new Set(['azione', 'booster', 'raccolto'])
  const pendenti = (!coltivazioneAttiva || !fattiOk) ? [] : eventi
    .filter((e) => MANUALI.has(e.tipo) && e.giorno <= oggi && e.giorno < 9000
      && statoEvento.get(normTitolo(e.titolo)) !== true)
    .map((e) => ({ g: e.giorno, titolo: e.titolo, ritardo: oggi - e.giorno }))
    // AUDIT R1 (NT-11): ritardo DECRESCENTE, come il sensore HA (parità)
    .sort((a, b) => b.ritardo - a.ritardo)

  const curIdx = FASI.findIndex((f) => f.key === faseAttuale)

  // planStart per fase (default dal piano): serve alle milestone (delta) e al
  // calcolo del limbo qui sotto. In fotoperiodica i valori a valle del flip
  // sono i default AUTOFIORENTI: non significano nulla (vedi guardie foto).
  const planStartOf = {
    vegetativa: mappa.veg_plan,
    fioritura: mappa.fior_plan,
    flush: mappa.flush_plan,
    essiccazione: mappa.ess_plan,
  }

  const fasi = FASI.map((f, i) => {
    const start = startOf[f.key]
    const end = endOf[f.key]
    // Pre-flip (fotoperiodica non ancora fiorita): fioritura/flush/essiccazione
    // NON esistono ancora, anche se un flush/ess è rimasto confermato per errore
    // (altrimenti comparirebbe una fase "orfana" appesa senza fioritura davanti).
    const downstream = f.key === 'fioritura' || f.key === 'flush' || f.key === 'essiccazione'
    const valid = !(fotoPending && downstream) && start < 9000 && end < 9000 && end >= start
    const planNext = planNextOf[f.key]
    const nextEff = i < FASI.length - 1 ? startOf[FASI[i + 1].key] : mappa.concl_g
    // Limbo — SOLO sulla fase CAUSA (decisione Alberto, audit R1 #3): si
    // tratteggia il ritardo INTRODOTTO da questa fase (delta verso la prossima
    // milestone MENO il delta ereditato all'ingresso), non lo slittamento che
    // si trascina in cascata: se la germinazione dura +2, la vegetativa slitta
    // di 2 ma NON si allunga → nessun tratteggio su di lei.
    // Niente limbo in fotoperiodica (i "piani" a valle sono default auto).
    const planSelf = f.key === 'germinazione' ? 1 : planStartOf[f.key]
    const inherited = planSelf != null ? Math.max(0, start - planSelf) : 0
    const deltaNext = planNext != null && nextEff < 9000 ? nextEff - planNext : 0
    const ownDelay = Math.max(0, deltaNext - inherited)
    const days = []
    if (valid) {
      for (let g = start; g <= end; g++) {
        const dof = g - start + 1
        const date = addDays(semina, g - 1)
        const limbo = (!mappa.foto && ownDelay > 0 && g >= nextEff - ownDelay && g >= planNext)
          || (f.key === 'essiccazione' && g >= mappa.concl_g)   // F1: giorni oltre il piano
        days.push({
          g, dof,
          label: `${f.letter}${dof}`,
          date,
          state: g < oggi ? 'past' : g === oggi ? 'today' : 'future',
          limbo,
          eventi: eventiPerGiorno.get(g) || [],
        })
      }
    }
    const acqua = (piano.acqua || {})[f.key] || { ore: [], durata: 0 }
    const luciMix = (piano.luci || {})[f.key] || null
    const luciAccese = luciMix && luciMix.some((v) => v > 0)
    // Fotoperiodo PER FASE: una fotoperiodica in fioritura/flush va a 12/12
    // (come fa serra_ciclo_auto in HA quando la fase parte). L'alba non cambia;
    // il tramonto = alba + 12h. Veg/germ e le autofiorenti usano la finestra reale.
    const foto1212 = mappa.foto === true && (f.key === 'fioritura' || f.key === 'flush')
    const faseLuciOn = luciOn
    const faseLuciOff = foto1212 ? addOre(luciOn, 12) : luciOff
    return {
      ...f,
      idx: i, start, end, valid, days,
      durata: valid ? end - start + 1 : 0,
      open: fotoPending && f.key === 'vegetativa',   // fine non nota (fino al flip)
      confirmed: confirmedOf[f.key],
      current: i === curIdx,
      // AUDIT R2 (MD2-02/MD-08): fail-SAFE — con fase sconosciuta o 'conclusa'
      // (curIdx -1) TUTTE le milestone sono bloccate, non tutte sbloccate:
      // niente frecce/reset su un ciclo chiuso o su HA in riavvio.
      locked: curIdx === -1 || i < curIdx,
      luciMix, luciAccese,
      luciFinestraOn: faseLuciOn, luciFinestraOff: faseLuciOff,
      luciOre: luciAccese ? oreLuci(faseLuciOn, faseLuciOff) : 0,
      ricircoli: ricircoliOrari(luciOn, acqua.ore),
      ricircoloDurata: acqua.durata,
      ambiente: (piano.ambiente || {})[f.key] || null,
      nutrienti: (piano.nutrienti || {})[f.key] || null,
    }
  })

  // Milestone (inizio fase) per le fasi con àncora: tutte tranne la germinazione.
  // planStart = default dal piano -> delta = quanto la milestone e' stata spostata.
  // (planStartOf è definita sopra, prima del calcolo delle fasi.)
  const milestones = fasi.slice(1).filter((f) => f.valid).map((f) => {
    const prev = fasi[f.idx - 1]
    const next = fasi[f.idx + 1]
    return {
      faseIdx: f.idx,
      g: f.start,
      date: addDays(semina, f.start - 1),
      confirmed: f.confirmed,
      locked: f.locked,
      // AUDIT R2 (MD2-08/MD-10): in fotoperiodica il "piano" e' quello
      // autofiorente (fior_plan=0) — nessun riferimento sensato: null, e la
      // UI omette "(g0)" dal reset invece di mostrare un numero inventato.
      planStart: mappa.foto ? null : planStartOf[f.key],
      // in fotoperiodica il "piano" a valle non esiste (i default sono autofiorenti):
      // niente badge di scostamento, sarebbe un delta contro un riferimento sbagliato.
      delta: mappa.foto ? 0 : f.start - planStartOf[f.key],
      entity: `input_datetime.serra_inizio_${f.key}`,
      confermaEntity: `input_boolean.serra_conferma_${f.key}`,
      // AUDIT R3 (MD3-05): l'ultima fase VALIDA precedente — con una fase
      // scavalcata (invalid, start oltre) il vecchio prev.start dava un
      // minimo ASSURDO (> della posizione) e il posticipo era un no-op muto.
      minStart: (() => {
        for (let j = f.idx - 1; j >= 0; j--) {
          const x = fasi[j]
          if (x && x.valid) return x.start + 1
        }
        return 2
      })(), // mai azzerare la fase precedente
      // AUDIT R1 (MD-02): guardia superiore — mai oltre l'inizio della fase
      // successiva CONFERMATA (quelle non confermate slittano in cascata da
      // sole). Senza questo la fioritura poteva "sparire" (flush < fioritura)
      // e la milestone restava incastrata in entrambe le direzioni.
      // AUDIT R2 (MD2-09) + R3 (MD3-02): il tetto guarda anche OLTRE la fase
      // adiacente. La prima versione sottraeva le durate EFFETTIVE, che
      // tassellano per costruzione → cap sempre = start-1 (freccia viva ma
      // rifiutata a ogni tap) e persino negativo. Ora: prima confermata a
      // valle - 1 - numero di fasi valide non confermate in mezzo (a ognuna
      // resta almeno 1 giorno), e MAI sotto la posizione attuale (le frecce
      // si disabilitano quando g raggiunge il tetto).
      maxStart: (() => {
        if (next && next.valid && next.confirmed) return next.start - 1
        let intermedie = 0
        for (let j = f.idx + 1; j < fasi.length; j++) {
          const x = fasi[j]
          if (!x || !x.valid) continue
          if (x.confirmed) return Math.max(x.start - 1 - intermedie, f.start)
          intermedie += 1
        }
        return null
      })(),
    }
  })

  // data ISO (locale) di un giorno di ciclo: per set_datetime.
  // AUDIT R1 (MD-03): null su input invalido — MAI restituire "NaN-NaN-NaN"
  // (finirebbe scritto su HA come data di un'àncora).
  const isoOfDay = (g) => {
    if (!Number.isFinite(g)) return null
    const d = addDays(semina, g - 1)
    if (isNaN(d)) return null
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const totale = fotoPending ? null : mappa.concl_g - 1
  const oggiDate = addDays(semina, oggi - 1)
  const faseCorrente = fasi.find((f) => f.current) || null

  // Descrittore del flip 12/12 (solo fotoperiodica pre-flip): giorno proposto e
  // minimo (non si flippa nel passato). Il flip = impostare inizio_fioritura.
  const flip = fotoPending
    ? { defaultDay: flipDefault, minDay: oggi, fioIdx: FASI.findIndex((f) => f.key === 'fioritura') }
    : null

  // clima live (se i sensori esistono)
  const num = (id) => { const v = parseFloat(st(entities, id)); return isNaN(v) ? null : v }
  const clima = {
    temp: num('sensor.serra_clima_temperatura'),
    rh: num('sensor.serra_clima_umidita'),
    vpd: num('sensor.serra_vpd'),
    vpdTarget: att(entities, 'sensor.serra_vpd', 'target'),          // banda ideale es. "0.8–1.2"
    tempTarget: att(entities, 'sensor.serra_fase', 'target_temp_giorno'),   // banda giorno (luci accese)
    tempTargetNotte: att(entities, 'sensor.serra_fase', 'target_temp_notte'), // banda notte (luci spente)
    rhTarget: att(entities, 'sensor.serra_fase', 'target_umidita'),         // es. "55-65"
  }

  // Modalità operativa live: schedule ON = Pianificato, OFF = LIBERO (comandi diretti)
  const isOn = (id) => st(entities, id) === 'on'
  const modo = {
    luci:    isOn('input_boolean.serra_schedule_luci'),
    acqua:   isOn('input_boolean.serra_schedule_acqua'),
    ventole: isOn('input_boolean.serra_schedule_ventole'),
    // quarto gemello (04/08): stessa semantica degli altri tre — ON = il piano
    // guida dosi e promemoria, OFF = dosaggi pianificati sospesi.
    nutrienti: isOn('input_boolean.serra_schedule_nutrienti'),
  }
  // METODO di erogazione dentro il Pianificato: ON = dosano le pompe, OFF = a
  // mano (siringa). Non e' piu' la modalita' del sottosistema — quella e'
  // modo.nutrienti. NB: incide solo sui CAMBI acqua; le "aggiunte" (top-up
  // senza cambio) restano sempre a mano.
  const dosatoriAuto = isOn('input_boolean.serra_dosatori_auto')
  // Vasca: livello reale (per le AGGIUNTE) e capacità (per i CAMBI = vasca piena).
  const capacita = num('input_number.serra_vasca_litri') || 4.5
  const vascaLitri = num('sensor.serra_acqua_litri')
  const vasca = {
    litri: (vascaLitri && vascaLitri > 0) ? vascaLitri : null,
    capacita,
    aggiornato: st(entities, 'sensor.serra_livello_acqua_last_update') || null,  // ISO ultima lettura
  }

  // AUDIT R1 (I-13): i due campi che App leggeva con una sonda su api/stato
  // tutta sua (una GET /states completa al minuto per DUE valori). Ora
  // viaggiano nella timeline, che quella GET la fa comunque.
  // CONTRATTO (nomi e semantica fissati con l'audit, non cambiarli):
  //  - bridgeOnline: stato GREZZO di sensor.serra_bridge_online come stringa,
  //    null se l'entita' e' assente o a stato-sentinella. L'interpretazione
  //    ("on"/"online"/altro) resta a chi legge: qui non si decide niente.
  //  - erroreComponente: stato di input_text.serra_errore_componente come
  //    stringa, '' se assente (l'helper vuoto significa "nessun errore").
  const bridgeOnline = st(entities, 'sensor.serra_bridge_online')
  const erroreComponente = st(entities, 'input_text.serra_errore_componente', '') || ''

  return {
    dev: !!payload.dev,
    bridgeOnline: bridgeOnline == null ? null : String(bridgeOnline),
    erroreComponente: String(erroreComponente),
    semina, oggi, oggiDate, faseAttuale, faseCorrente, varieta,
    luciOn, luciOff, fasi, milestones, totale, flip, foto: mappa.foto === true, clima, modo, dosatoriAuto, vasca, isoOfDay,
    pendenti, oltrePiano, fattiOk,
    coltivazioneAttiva,
  }
}
