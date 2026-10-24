// Sezione CONTROLLO (Fase 3 del porting design v3) — i 5 sottosistemi.
//
// Regole rispettate qui (le stesse di Stato.jsx):
//  - palette e token SOLO da app.css; geometrie/layout dal design v3
//    (mappa §3 e §3.1-3.5, snapshot "Calendario Ciclo v3.dc.html");
//  - URL delle fetch RELATIVI (sotto Ingress un path assoluto non arriva);
//  - polling attivo SOLO a sezione visibile (prop `attiva`);
//  - spiegazioni via <Hint>, MAI title=, e con PARSIMONIA: solo dove aggiungono
//    davvero qualcosa (una convenzione, un calcolo, il perche' di un blocco).
//    Sulle righe chiave/valore la riga NON e' interrogabile: c'e' l'(i) in coda;
//  - testi IMPERSONALI (mai "tu"): "la pompa si ferma da sola", non "ti fermi";
//  - ogni azione fisica e' armata in due tap, l'esito esce nel toast globale;
//  - VALORI ASCIUTTI: la cella valore non ripete cio' che la label gia' dice
//    (regola 02/08: "Ricircoli di oggi" → "2 (07:00 · 19:00)", mai "Oggi 2
//    ricircoli..."). Su mobile ogni parola di troppo manda la riga a capo.
//
// DUE SORGENTI DI DATO, per ruolo:
//  - `api/stato` (polling locale, 60 s): il MONDO REALE — livelli, stati dei
//    dispositivi, freschezza. E' la stessa lettura di Stato.jsx.
//  - `model` (payload api/timeline di App): il PIANO — orari, ricette, soglie
//    della fase corrente, modalita' auto/manuale degli schedule.
//    Il piano non si legge dai sensori: e' gia' calcolato una volta sola in
//    model.js e ricalcolarlo qui vorrebbe dire duplicarlo.
//
// LETTURE E SCRITTURE: le entita' lette qui sono tutte in STATO_ENTITIES e
// tutte le scritture usate (input_number.set_value, input_select.select_option,
// script.turn_on) sono in whitelist — verificate una per una. Il resolver resta
// comunque tollerante: se un'entita' sparisce dal payload la riga degrada a '—'
// con la sua spiegazione, e l'errore di una chiamata rifiutata esce nel toast
// cosi' com'e' — nessun ramo finto, nessun successo simulato.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mdiLightbulbOn, mdiWater, mdiFlask, mdiFan, mdiLedStripVariant,
  mdiEyeOutline, mdiFlashAuto, mdiHandBackRightOutline, mdiBookOpenVariant,
  mdiCupWater, mdiPump, mdiWaterSync, mdiHistory, mdiSync, mdiClockOutline,
  mdiTimerSand, mdiLeaf, mdiPlayCircle, mdiStopCircleOutline, mdiMinus, mdiPlus,
  mdiLockOutline, mdiWifiOff, mdiFlagCheckered,
  mdiAlertOutline, mdiTimerOutline,
  mdiInformationOutline,
  // luci
  mdiPalette, mdiThemeLightDark, mdiWeatherSunsetUp,
  mdiWeatherSunsetDown, mdiSprout, mdiFlower, mdiScissorsCutting, mdiCamera,
  mdiLightbulbOff, mdiWaterOutline, mdiBrightness6, mdiTuneVertical,
  // ventole
  mdiThermometer, mdiWaterPercent, mdiWaves, mdiHomeThermometerOutline,
  mdiTriangleOutline, mdiThermometerWater,
  mdiAirFilter, mdiTimerPauseOutline, mdiSpeedometer,
  // nutrienti
  mdiFlaskOutline, mdiTestTube, mdiScaleBalance, mdiNeedle, mdiCalendarClock,
  // ring
  mdiCircleSlice8, mdiFlagOutline,
} from '@mdi/js'
import Hint from './Hint.jsx'
import { LIVELLO_LAB } from './model.js'
import './controllo.css'

/* ══════════════════════════════════════════════════════════════════════
   MAPPING ENTITÀ — verificate su /config/packages/other/serra_mqtt.yaml e
   sul registry HA (core.entity_registry + core.restore_state) il 02/08/2026,
   in SOLA LETTURA. Stesso resolver tollerante di Stato.jsx: prima gli id
   esatti (il primo che arriva con un valore), poi la ricerca per suffisso fra
   le chiavi del payload. Se un'entita' manca la UI degrada a '—' con la sua
   spiegazione, senza rompersi.
   ══════════════════════════════════════════════════════════════════════ */
const ENT = {
  // ── stato sintetico dei 5 sottosistemi (gia' esposti) ──
  cLuci:      { ids: ['sensor.serra_componente_luci'],      sfx: ['_componente_luci'] },
  cAcqua:     { ids: ['sensor.serra_componente_acqua'],     sfx: ['_componente_acqua'] },
  cNutrienti: { ids: ['sensor.serra_componente_nutrienti'], sfx: ['_componente_nutrienti'] },
  cVentole:   { ids: ['sensor.serra_componente_ventole'],   sfx: ['_componente_ventole'] },
  cRing:      { ids: ['sensor.serra_componente_ring'],      sfx: ['_componente_ring'] },
  // ── vasca (gia' esposte) ──
  livello:    { ids: ['sensor.serra_livello_acqua'],  sfx: ['_livello_acqua'] },
  litri:      { ids: ['sensor.serra_acqua_litri'],    sfx: ['_acqua_litri'] },
  acquaBassa: { ids: ['binary_sensor.serra_acqua_bassa'], sfx: ['_acqua_bassa'] },
  // Soglia VERA dell'allarme acqua bassa (regolabile in Impostazioni · Notifiche
  // fra 10 e 50). Stessa entita' che usa Stato.jsx per il fondo della banda
  // vasca: e' da li' che deve nascere anche il pallino di questa sezione.
  sogliaAcqua: { ids: ['input_number.serra_acqua_soglia_pct'], sfx: ['_acqua_soglia_pct'] },
  // ── ultimi eventi (gia' esposte; divergenza #6 decisa dal backend: il SENSOR) ──
  ricircolo:  { ids: ['sensor.serra_acqua_ultimo_ricircolo'], sfx: ['_ultimo_ricircolo'] },
  ricircoloS: { ids: ['input_number.serra_acqua_ultimo_ricircolo_s'], sfx: ['_ultimo_ricircolo_s'] },
  cambio:     { ids: ['input_datetime.serra_acqua_ultimo_cambio'], sfx: ['_ultimo_cambio'] },
  // ── diagnostica (gia' esposte) ──
  online:     { ids: ['sensor.serra_bridge_online'], sfx: ['_bridge_online', '_online'] },
  // PRIMO last_seen: e' un device_class timestamp, quindi una data vera.
  // serra_freschezza_dati e' una FRASE ("27 min fa · online"), che toDate()
  // rifiuta: come primo id manderebbe la testata sul ripiego, cioe' sull'ora
  // della nostra fetch — "Dati delle 14:32" a centralina muta da ore.
  freschezza: { ids: ['sensor.serra_last_seen', 'sensor.serra_freschezza_dati'], sfx: ['_last_seen', '_freschezza_dati'] },
  // (niente ENT.coltivazione: arriva da model.coltivazioneAttiva, vedi sotto)
  // ── POMPA: divergenza #3 — si legge lo STATO pubblicato dal bridge, non il
  //    comando inviato. `_state` e' on/off "dichiarato", `_running_now` e' il
  //    derivato (now < until_ts) ed e' quello che conta davvero.
  //    Gia' in STATO_ENTITIES dal pannello Acqua.
  pompaStato: { ids: ['sensor.serra_pump_main_state'],       sfx: ['_pump_main_state'] },
  pompaRun:   { ids: ['sensor.serra_pump_main_running_now'], sfx: ['_pump_main_running_now'] },
  pompaSec:   { ids: ['sensor.serra_pump_main_seconds'],     sfx: ['_pump_main_seconds'] },
  pompaFine:  { ids: ['sensor.serra_pump_main_until'],       sfx: ['_pump_main_until'] },
  pompaUltimaAz: { ids: ['sensor.serra_pump_main_last_action'], sfx: ['_pump_main_last_action'] },
  // La modalita' acqua NON si legge qui: e' l'interruttore dello SCHEDULE e
  // arriva gia' da api/timeline (model.modo.acqua). Idem luci e ventole.

  /* ── LUCI ────────────────────────────────────────────────────────────
     Il mix REALE per canale vive SOLO nell'attributo `channels` di
     sensor.serra_lights_state. Divergenza #3: si legge lo STATO pubblicato
     dal bridge, non gli input_number di staging. */
  luciStato:   { ids: ['sensor.serra_lights_state'],       sfx: ['_lights_state'] },
  luciCanale:  { ids: ['sensor.serra_lights_channel'],     sfx: ['_lights_channel'] },
  luciInt:     { ids: ['sensor.serra_lights_intensity'],   sfx: ['_lights_intensity'] },
  luciFadeS:   { ids: ['sensor.serra_lights_fade'],        sfx: ['_lights_fade'] },
  luciUltimaAz: { ids: ['sensor.serra_lights_last_action'], sfx: ['_lights_last_action'] },
  luciUltimo:  { ids: ['sensor.serra_lights_last_update'], sfx: ['_lights_last_update'] },
  // Ultima azione SEMANTICA del pannello, nella forma "<evento> @<iso>":
  // dice cosa e' cambiato davvero (accensione, spegnimento, cambio mix
  // canali), non il verbo grezzo che il pannello ha ricevuto.
  luciAzione:  { ids: ['input_text.serra_luci_ultima_azione'], sfx: ['_luci_ultima_azione'] },
  luciDaSched: { ids: ['binary_sensor.serra_luci_dovrebbero_essere_on'], sfx: ['_luci_dovrebbero_essere_on'] },
  luciFadeMin: { ids: ['input_number.serra_luce_fade_min'], sfx: ['_luce_fade_min'] },

  /* ── VENTOLE ─────────────────────────────────────────────────────────
     I 3 livelli sono lo STATO pubblicato dal bridge (divergenza #3). Del
     clima serve la sola lettura TARATA: e' quella su cui decidono le soglie,
     ed e' l'unica che il pannello mostra. */
  fan1Lv:  { ids: ['sensor.serra_fan_1_level'],   sfx: ['_fan_1_level'] },
  fan2Lv:  { ids: ['sensor.serra_fan_2_level'],   sfx: ['_fan_2_level'] },
  fanFLv:  { ids: ['sensor.serra_fan_f_level'],   sfx: ['_fan_f_level'] },
  // clima tarato: lo usano anche Stato e i grafici
  tempTarata: { ids: ['sensor.serra_clima_temperatura'], sfx: ['_clima_temperatura'] },
  umidTarata: { ids: ['sensor.serra_clima_umidita'],     sfx: ['_clima_umidita'] },
  // (le letture GREZZE della sonda non servono piu' a nessuna riga: il clima
  //  si mostra solo tarato, riordino 03/08)
  casaT:   { ids: ['sensor.serra_clima_rif_temperatura'], sfx: ['_clima_rif_temperatura'] },
  casaH:   { ids: ['sensor.serra_clima_rif_umidita'],     sfx: ['_clima_rif_umidita'] },
  ventAuto: { ids: ['input_select.serra_vent_livello_auto'], sfx: ['_vent_livello_auto'] },
  filtroOdori: { ids: ['input_boolean.serra_filtro_odori'], sfx: ['_filtro_odori'] },
  // DIVERGENZA #12 — il motivo in italiano di "da soglie ora" (il template da
  // ~1500 caratteri duplicato nelle vecchie dashboard) non esiste come
  // sensore: la riga e' stata tolta del tutto (03/08), non finta.

  /* ── NUTRIENTI ───────────────────────────────────────────────────────
     MAPPATURA DELLE POMPE, verificata e vincolante (divergenza #1, chiusa
     il 02/08 su dashboard-serra e confermata dai nomi degli helper di
     taratura in serra_mqtt.yaml r.852-869, che scrivono la posizione a
     chiare lettere):
        serra_nutrient_2 = Rossa · Grow  · gocciolatore SINISTRO
        serra_nutrient_1 = Verde · Micro · gocciolatore CENTRALE
        serra_nutrient_0 = Blu   · Bloom · gocciolatore DESTRO
     I colori dei tre bottoni EROGA seguono questa mappa e nessun'altra. */
  nutr0Stato: { ids: ['sensor.serra_nutrient_0_stato'], sfx: ['_nutrient_0_stato'] },
  nutr1Stato: { ids: ['sensor.serra_nutrient_1_stato'], sfx: ['_nutrient_1_stato'] },
  nutr2Stato: { ids: ['sensor.serra_nutrient_2_stato'], sfx: ['_nutrient_2_stato'] },
  nutr0Run:   { ids: ['sensor.serra_nutrient_0_running_now'], sfx: ['_nutrient_0_running_now'] },
  nutr1Run:   { ids: ['sensor.serra_nutrient_1_running_now'], sfx: ['_nutrient_1_running_now'] },
  nutr2Run:   { ids: ['sensor.serra_nutrient_2_running_now'], sfx: ['_nutrient_2_running_now'] },
  nutrUltimo: { ids: ['sensor.serra_nutrients_last_update'], sfx: ['_nutrients_last_update'] },
  dose:       { ids: ['sensor.serra_dose_nutrienti'], sfx: ['_dose_nutrienti'] },
  booster:    { ids: ['sensor.serra_prossimo_booster'], sfx: ['_prossimo_booster'] },
  dosDurata:  { ids: ['input_number.serra_nutrient_duration'], sfx: ['_nutrient_duration'] },
  dosVolte:   { ids: ['input_number.serra_nutrient_times'],    sfx: ['_nutrient_times'] },
  dosPausa:   { ids: ['input_number.serra_nutrient_interval'], sfx: ['_nutrient_interval'] },
  cal0:       { ids: ['input_number.serra_cal_pompa_0_ml_s'], sfx: ['_cal_pompa_0_ml_s'] },
  cal1:       { ids: ['input_number.serra_cal_pompa_1_ml_s'], sfx: ['_cal_pompa_1_ml_s'] },
  cal2:       { ids: ['input_number.serra_cal_pompa_2_ml_s'], sfx: ['_cal_pompa_2_ml_s'] },
  // (niente ENT.dosatori: la modalita' Pianificato/Libero dei nutrienti arriva
  //  da model.modo.nutrienti e il metodo di erogazione da model.dosatoriAuto)
  // (niente ENT.vascaLitri: input_number.serra_vasca_litri non e' in
  //  STATO_ENTITIES, quindi da api/stato non arriverebbe comunque — i litri
  //  della vasca vengono da model.vasca, vedi litriVasca)

  /* ── LED RING ────────────────────────────────────────────────────────
     Oltre a stato e colore dell'anello servono i due segnali che alimentano
     le priorita' alte del semaforo (errore pendente, booster da dare).
     `binary_sensor.serra_luci_dovrebbero_essere_on` e i `_running_now`
     delle pompe sono gia' fra le voci delle Luci e dei Nutrienti. */
  ringStato:  { ids: ['sensor.serra_ring_state'],  sfx: ['_ring_state'] },
  // NIENTE ricerca per suffisso su questi due: `sensor.serra_ring_color` (il
  // colore ACCESO, in esadecimale) e `input_select.serra_ring_color` (il
  // colore SCELTO, in italiano) finiscono con la stessa stringa e il ripiego
  // per suffisso li scambierebbe. Gli id esatti bastano: sono stabili.
  ringColore: { ids: ['sensor.serra_ring_color'],  sfx: [] },
  ringSel:    { ids: ['input_select.serra_ring_color'], sfx: [] },
  ringUltimaAz: { ids: ['sensor.serra_ring_last_action'], sfx: ['_ring_last_action'] },
  ringUltimo: { ids: ['sensor.serra_ring_last_update'], sfx: ['_ring_last_update'] },
  ringFade:   { ids: ['input_number.serra_ring_fade'], sfx: ['_ring_fade'] },
  blinkVolte:  { ids: ['input_number.serra_ring_blink_times'], sfx: ['_ring_blink_times'] },
  blinkDurata: { ids: ['input_number.serra_ring_blink_duration'], sfx: ['_ring_blink_duration'] },
  blinkPausa:  { ids: ['input_number.serra_ring_blink_interval'], sfx: ['_ring_blink_interval'] },
  ringAuto:   { ids: ['input_boolean.serra_ring_auto'], sfx: ['_ring_auto'] },
  errore:     { ids: ['input_boolean.serra_errore_pendente'], sfx: ['_errore_pendente'] },
  erroreComp: { ids: ['input_text.serra_errore_componente'], sfx: ['_errore_componente'] },
  boosterDaDare: { ids: ['input_boolean.serra_booster_da_dare'], sfx: ['_booster_da_dare'] },
}

/* ── i 5 sottosistemi: ordine, icona, accento ──────────────────────────
   Ordine del design (r.476).
   `sched` = l'input_boolean che comanda l'automatico del sottosistema,
   verificato in serra_mqtt.yaml (r.1255 luci · r.1264 acqua · r.1270
   ventole · r.1298 ring), piu' serra_schedule_nutrienti per il quarto
   gemello aggiunto il 04/08. */
/* Tre valori cromatici per sottosistema, tutti passati alla CSS come
   variabili (--cc-accent / --cc-soft / --cc-hero):
     accent  tinta piena (disco, icone del blocco "da piano", CTA)
     soft    la stessa tinta al 25% — il bordo del blocco "da piano" in
             automatico dev'essere un accenno, non una cornice
     hero    gradiente della fascia di testata, preso TALE E QUALE dai token
             del DS (PORTING/.../tokens/gradients.css): --hero-umidita per
             l'acqua, --hero-luce per le luci, --hero-temperatura per le
             ventole, --hero-media per i nutrienti, --hero-sicurezza per il
             ring. Tutti e cinque partono da una tinta CHIARA al 90%, quindi
             tutti e cinque hanno `dark: true` (testo e icone in scuro sulla
             fascia: il bianco ci sparirebbe sopra).
   I gradienti vivono come token LOCALI --cc-hero-* in controllo.css: sono
   valori del DS che app.css non ha (app.css ha solo gli --hero-<fase>).
   ACQUA e RING usano anche un accento LOCALE (--cc-acqua*, --cc-ring*):
   per l'acqua e' il turchese del design (decisione di Alberto), per il ring
   e' il viola "sicurezza" del DS, che in app.css non esiste — il
   --fase-fioritura usato finora era il segnaposto in attesa del gradiente. */
const COMP = [
  { k: 'luci',      label: 'Luci',      icon: mdiLightbulbOn,     accent: 'var(--luce)',     soft: 'var(--luce-25)',     ent: 'cLuci',      modo: 'luci',    hero: 'var(--cc-hero-luci)',      dark: true },
  { k: 'acqua',     label: 'Acqua',     icon: mdiWater,           accent: 'var(--cc-acqua)', soft: 'var(--cc-acqua-25)', ent: 'cAcqua',     modo: 'acqua',   hero: 'var(--cc-hero-acqua)',     dark: true },
  { k: 'nutrienti', label: 'Nutrienti', icon: mdiFlask,           accent: 'var(--verde)',    soft: 'var(--verde-25)',    ent: 'cNutrienti', modo: 'nutrienti' },
  { k: 'ventole',   label: 'Ventole',   icon: mdiFan,             accent: 'var(--warn)',     soft: 'var(--cc-vent-25)',  ent: 'cVentole',   modo: 'ventole' },
  { k: 'ring',      label: 'LED Ring',  icon: mdiLedStripVariant, accent: 'var(--cc-ring)',  soft: 'var(--cc-ring-25)',  ent: 'cRing',      modo: 'ring' },
]

const POLL_MS = 60000        // = STATO_POLL_MS di Stato.jsx
const ARM_MS = 4000          // finestra della doppia conferma (design r.180-184)
// Doppio refetch post-azione, come RECONCILE_FAST di App.jsx: il primo
// prende l'assestamento, il secondo la verita' definitiva di HA.
const RECONCILE = [700, 1800]
const DIM_OFF = '0.42'       // dati non freschi = dim (design r.581-585)

// Durata del ricircolo manuale. Il comando reale (script.serra_pump_main_on in
// serra_mqtt.yaml) accetta i secondi come variabile e NON li clampa:
// il range e' quindi una scelta di interfaccia. Si usa quello del design
// (5-300 s, passo 10), che coincide con il range dell'input_number dello
// SCHEDULE (serra_acqua_durata_s, r.1078: min 5 max 300 step 5) — cioe' con
// le durate che la serra fa davvero.
const DUR_MIN = 5, DUR_MAX = 300, DUR_STEP = 10, DUR_DEF = 60
const clampDur = (n) => Math.max(DUR_MIN, Math.min(DUR_MAX, Math.round(n / DUR_STEP) * DUR_STEP))

// ── entita' e servizi delle azioni ──────────────────────────────────────
// Gia' dentro la whitelist del backend: script.turn_on su script.serra_*,
// input_boolean.turn_on/off su input_boolean.serra_*,
// input_datetime.set_datetime su input_datetime.serra_*.
const SCRIPT_POMPA_ON = 'script.serra_pump_main_on'    // fields: seconds
const SCRIPT_POMPA_OFF = 'script.serra_pump_main_off'
// LUCI: gli script sono tutti gia' permessi (script.turn_on su script.serra_*).
// (niente serra_luce_applica_fase: vedi AUDIT R2 · R2-6 in "Applica colore" —
//  chiamandolo, l'applica_mix interno nasce con un parent e il diario segnava
//  `auto` un gesto manuale.)
const SCRIPT_LUCE_VERDE = 'script.serra_luce_preset_verde'
const SCRIPT_LUCE_BIANCO = 'script.serra_luce_preset_bianco'
const SCRIPT_LUCE_ALBA = 'script.serra_luce_alba'
const SCRIPT_LUCE_TRAMONTO = 'script.serra_luce_tramonto'
const SCRIPT_LUCE_OFF = 'script.serra_luci_lab_off'
const SCRIPT_LUCE_MIX = 'script.serra_luce_applica_mix'
// I 5 canali e il fade del mix: input_number, si scrivono con set_value.
const IN_LUCE_CH = { d: 'input_number.serra_luce_ch_d', r: 'input_number.serra_luce_ch_r', b: 'input_number.serra_luce_ch_b', g: 'input_number.serra_luce_ch_g', a: 'input_number.serra_luce_ch_a' }
const IN_LUCE_FADE = 'input_number.serra_lights_fade'   // secondi, 0-120 step 5
// VENTOLE — i tre livelli sono input_select (select_option).
const IN_FAN = { v1: 'input_select.serra_fan_1_level', v2: 'input_select.serra_fan_2_level', vf: 'input_select.serra_fan_f_level' }
const LIVELLI = ['off', 'low', 'medium', 'high']
// LIVELLO_LAB vive in model.js: la stessa mappa la usa la tendina di
// Impostazioni · Componenti (AUDIT R2 · R2-4).

/* ── NUTRIENTI · le tre pompe ────────────────────────────────────────
   ORDINE E COLORI VINCOLANTI (vedi la nota in ENT): l'indice non e' un
   dettaglio interno, e' quale tubo si mette in moto. Il colore del bottone
   e' un token esistente scelto perche' LEGGE come quel colore fisico —
   --errore e' il rosso del DS, --verde il verde, --fase-flush il blu:
   qui non identificano uno stato, identificano una pompa. */
const POMPE = [
  { id: 2, nome: 'Rossa', nutr: 'Grow',  chiave: 'grow',  colore: 'var(--errore)',     cal: 'cal2', stato: 'nutr2Stato', run: 'nutr2Run' },
  { id: 1, nome: 'Verde', nutr: 'Micro', chiave: 'micro', colore: 'var(--verde)',      cal: 'cal1', stato: 'nutr1Stato', run: 'nutr1Run' },
  { id: 0, nome: 'Blu',   nutr: 'Bloom', chiave: 'bloom', colore: 'var(--fase-flush)', cal: 'cal0', stato: 'nutr0Stato', run: 'nutr0Run' },
]
const SCRIPT_NUTR = (n) => `script.serra_nutrient_${n}_apply`
// I tre parametri di erogazione, che lo script legge al momento del via.
const IN_DOS = { durata: 'input_number.serra_nutrient_duration', volte: 'input_number.serra_nutrient_times', pausa: 'input_number.serra_nutrient_interval' }

/* ── LED RING ────────────────────────────────────────────────────────
   I 7 colori sono le opzioni ESATTE di input_select.serra_ring_color
   (serra_mqtt.yaml r.1185): in italiano nella UI, tradotte in inglese dal
   payload dello script. NIENTE blocco lampeggio: e' stato pensionato. */
const RING_COLORI = ['Bianco', 'Rosso', 'Verde', 'Giallo', 'Arancione', 'Blu', 'Viola']
const SCRIPT_RING_APPLY = 'script.serra_ring_apply'
const SCRIPT_RING_OFF = 'script.serra_ring_off'
// serra_ring_apply legge il colore e il fade DAGLI HELPER, non li accetta
// come variabili: per applicare un colore vanno scritti prima.
const IN_RING_COL = 'input_select.serra_ring_color'
const IN_RING_FADE = 'input_number.serra_ring_fade'   // secondi, 0-30 step 1
/* LAMPEGGIO — nel design c'e' (r.471-474) e ci resta, ma con la nota che ne
   sconsiglia l'uso. Il motivo NON e' un'opinione: il commento di testata di
   script.serra_ring_blink_apply, in serra_mqtt.yaml, lo scrive nero su bianco
   — "il blink del controller tiene la UART per tutta
   la durata", cioe' mentre lampeggia la centralina non riceve altri comandi.
   Il censimento lo classifica inoltre come residuo di collaudo.
   Anche questo script legge tutto dagli helper: volte, durata e pausa hanno i
   loro input_number, colore e fade sono gli STESSI del colore fisso. */
const SCRIPT_RING_BLINK = 'script.serra_ring_blink_apply'
const IN_BLINK = {
  volte: 'input_number.serra_ring_blink_times',      // 1-20 step 1
  durata: 'input_number.serra_ring_blink_duration',  // 1-10 s step 1
  pausa: 'input_number.serra_ring_blink_interval',   // 1-5 s step 1
}
// Il bridge pubblica il colore acceso in esadecimale: qui torna una parola.
// 303030 e' il "bianco attenuato" della notte (il fade del firmware verso il
// nero lascia un bagliore, quindi lo spento vero e' un comando a parte).
const RING_HEX = {
  ffffff: 'bianco', ff0000: 'rosso', '00ff00': 'verde', ffff00: 'giallo',
  ffa500: 'arancione', '0000ff': 'blu', 800080: 'viola',
  303030: 'bianco attenuato', '000000': 'spento',
}
/* Un esadecimale grezzo non e' un'informazione: "303030" sulla card del rail
   diceva all'utente esattamente niente. La traduzione vale ovunque il colore
   arrivi crudo — dal sensore del colore come dal sensore-componente. Un
   valore che esadecimale non e' (le frasi gia' composte, "Bianco · giorno")
   torna intatto: qui si traduce, non si riscrive. */
const HEX6 = /^#?[0-9a-f]{6}$/i
function nomeColore(v) {
  const s = String(v ?? '').trim()
  if (!HEX6.test(s)) return s
  const k = s.toLowerCase().replace('#', '')
  return RING_HEX[k] || `#${k.toUpperCase()}`
}
const capofrase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const GUIDA_ACQUA = 'acqua-ricircoli'
const GUIDA_VENTOLE = 'clima-vpd'
const GUIDA_NUTRIENTI = 'cambio-acqua'

/* ── modalita' per sottosistema ────────────────────────────────────────
   Il segmented Pianificato ⇄ Libero accende/spegne UN input_boolean. Non e'
   un "modo" a parte: e' l'interruttore dell'automatismo di quel
   sottosistema, verificato uno per uno in serra_mqtt.yaml. */
const MODO = {
  luci: {
    ent: 'input_boolean.serra_schedule_luci',
    okAuto: 'Luci: modalità Pianificata · alba, tramonto e ricetta di fase tornano al piano',
    okMan: 'Luci: modalità Libera · la programmazione resta sospesa',
    attivaAuto: 'Modalità attiva: le luci seguono alba, tramonto e ricetta della fase',
    attivaMan: 'Modalità attiva: la serra esegue solo i comandi dati qui',
    vaiAuto: 'Riattiva la programmazione automatica delle luci',
    vaiMan: 'Sospende la programmazione: alba e tramonto non partono più da soli',
    perche: 'In modalità Libera, il piano di coltivazione viene ignorato e i comandi diretti alla serra vengono lanciati dal pannello di controllo qui sotto. Lo stato non cambia fino a un nuovo comando diretto, passaggio alla modalità Pianificata o fine della coltivazione.',
  },
  acqua: {
    ent: 'input_boolean.serra_schedule_acqua',
    okAuto: 'Acqua: modalità Pianificata · i ricircoli tornano a seguire il piano',
    okMan: 'Acqua: modalità Libera · la programmazione resta sospesa',
    attivaAuto: 'Modalità attiva: i ricircoli seguono il piano',
    attivaMan: 'Modalità attiva: la serra esegue solo i comandi dati qui',
    vaiAuto: 'Riattiva la programmazione automatica dei ricircoli',
    vaiMan: 'Sospende la programmazione: i ricircoli si avviano solo a mano',
    perche: 'In modalità Libera, il piano di coltivazione viene ignorato e la pompa parte solo dai comandi diretti del pannello di controllo qui sotto. La pompa si ferma da sola a fine tempo e non riparte fino a un nuovo comando diretto, passaggio alla modalità Pianificata o fine della coltivazione.',
  },
  ventole: {
    ent: 'input_boolean.serra_schedule_ventole',
    okAuto: 'Ventole: modalità Pianificata · tornano a salire e scendere sulle soglie',
    okMan: 'Ventole: modalità Libera · le soglie restano sospese',
    attivaAuto: 'Modalità attiva: le ventole seguono soglie, isteresi e riposo',
    attivaMan: 'Modalità attiva: le ventole restano al livello impostato qui',
    vaiAuto: 'Riattiva il controllo automatico sulle soglie',
    vaiMan: 'Sospende le soglie: il livello resta quello impostato a mano',
    perche: 'In modalità Libera, le soglie della fase vengono ignorate e le ventole eseguono solo i comandi diretti del pannello di controllo qui sotto. Il livello resta quello impostato fino a un nuovo comando diretto, passaggio alla modalità Pianificata o fine della coltivazione.',
  },
  /* I nutrienti sono il quarto gemello degli altri schedule (04/08): il
     segmented comanda input_boolean.serra_schedule_nutrienti, non piu' i
     dosatori. `serra_dosatori_auto` e' rimasto, ma dice un'altra cosa — il
     METODO di erogazione dentro il Pianificato (pompe o siringa) — e per
     questo qui non c'e' piu' nessun "sconsigliato": quello riguarda il
     metodo, e vive accanto alla riga "Erogazione" del riquadro del piano. */
  nutrienti: {
    ent: 'input_boolean.serra_schedule_nutrienti',
    okAuto: 'Nutrienti: modalità Pianificata · il piano guida dosi e promemoria',
    okMan: 'Nutrienti: modalità Libera · i dosaggi pianificati restano sospesi',
    attivaAuto: 'Modalità attiva: dosi e promemoria li decide il piano di coltivazione',
    attivaMan: 'Modalità attiva: la serra esegue solo i comandi dati qui',
    vaiAuto: 'Riattiva le dosi e i promemoria previsti dal piano',
    vaiMan: 'Sospende i dosaggi pianificati: si eroga solo dai comandi diretti',
    perche: 'In modalità Libera, i dosaggi pianificati sono sospesi e si eroga con i comandi qui sotto. I promemoria del piano restano attivi.',
  },
  ring: {
    ent: 'input_boolean.serra_ring_auto',
    okAuto: 'Anello: modalità Pianificata · torna a seguire il semaforo di stato',
    okMan: 'Anello: modalità Libera · resta sul colore impostato qui',
    attivaAuto: 'Modalità attiva: il colore lo decide il semaforo di stato',
    attivaMan: 'Modalità attiva: l’anello resta sul colore impostato qui',
    vaiAuto: 'Restituisce l’anello al semaforo di stato',
    vaiMan: 'Sospende il semaforo: l’anello resta sul colore scelto a mano',
    perche: 'In modalità Libera, il semaforo di stato viene ignorato e l’anello esegue solo i comandi diretti del pannello di controllo qui sotto. Il colore resta quello applicato fino a un nuovo comando diretto, passaggio alla modalità Pianificata o fine della coltivazione.',
  },
}

// Copia locale della callService di App.jsx, come in Stato.jsx: importarla
// creerebbe il ciclo App → Controllo → App.
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

/* ── lettura tollerante del payload (gemella di Stato.jsx) ───────────── */
function resolveIds(entities) {
  const keys = Object.keys(entities || {})
  const out = {}
  for (const [k, spec] of Object.entries(ENT)) {
    // `state != null`: la chiave c'e' SEMPRE (il backend emette una voce anche
    // per le entita' assenti, con state null). Senza questo controllo il primo
    // id vincerebbe comunque e il secondo candidato — e la ricerca per
    // suffisso — non verrebbero mai provati.
    let id = spec.ids.find((x) => entities && entities[x] && entities[x].state != null)
    if (!id) id = keys.find((x) => spec.sfx.some((s) => x.endsWith(s)))
    out[k] = id || null
  }
  return out
}
const entOf = (entities, id) => (id && entities ? entities[id] : null) || null
const stOf = (entities, id) => { const e = entOf(entities, id); return e && e.state != null ? String(e.state) : null }
const numOf = (entities, id) => { const v = parseFloat(stOf(entities, id)); return isNaN(v) ? null : v }
const attrOf = (entities, id, k) => { const e = entOf(entities, id); return e && e.attributes ? e.attributes[k] : undefined }
const isOn = (s) => s === 'on' || s === 'true' || s === 'True'
const UNAVAIL = new Set(['unavailable', 'unknown', 'none', 'null', ''])
const has = (s) => s != null && !UNAVAIL.has(String(s).trim().toLowerCase())

/* ── formattatori ───────────────────────────────────────────────────── */
const EM = '—'
const p2 = (n) => String(n).padStart(2, '0')
const dm = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`

function toDate(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!has(s)) return null
  if (/^\d{9,14}$/.test(s)) { const n = Number(s); return new Date(n > 1e11 ? n : n * 1000) }
  const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s)
  return isNaN(d) ? null : d
}
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
/* Quando e' successo, in forma CORTA: "oggi 12:10" · "ieri 09:25" ·
   "25/07 09:25". La forma lunga ("Oggi alle 12:10") e' stata tolta: nelle
   righe chiave/valore il valore ha quasi sempre anche dell'altro accanto, e
   su mobile "alle" costa una riga intera. */
/* Solo il GIORNO, nella stessa forma corta: "Oggi" · "Ieri" · "27/07". Serve
   dove la data e l'ora stanno su due righe diverse (Acqua, riordino 03/08):
   li' il giorno e' un valore a se' e comincia di maiuscola. */
function giornoBreve(d, now = new Date()) {
  if (!d) return null
  const ieri = new Date(now); ieri.setDate(ieri.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Oggi'
  if (d.toDateString() === ieri.toDateString()) return 'Ieri'
  return dm(d)
}
function whenBreve(d, now = new Date()) {
  if (!d) return null
  return `${giornoBreve(d, now).toLowerCase()} ${hhmm(d)}`
}
// "07:00" → minuti dalla mezzanotte (null se non e' un orario)
function toMin(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''))
  return m ? (+m[1]) * 60 + (+m[2]) : null
}
// Prossimo orario della lista rispetto ad adesso: "oggi alle 19:00" oppure,
// se sono tutti passati, "domani alle 07:00".
function prossimoOrario(orari) {
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const mins = (orari || []).map(toMin).filter((x) => x != null).sort((a, b) => a - b)
  if (!mins.length) return null
  const dopo = mins.find((m) => m > nowMin)
  const val = dopo != null ? dopo : mins[0]
  const hm = `${p2(Math.floor(val / 60))}:${p2(val % 60)}`
  return { quando: dopo != null ? 'oggi' : 'domani', ora: hm }
}

/* ── VENTOLE: punto di rugiada ────────────────────────────────────────
   DIVERGENZA #2 (due formule in giro): si usa MAGNUS con le costanti
   a=17.62 · b=243.12, cioe' ESATTAMENTE quelle che usa l'automazione
   serra_ventole_automatico_a_soglia in serra_mqtt.yaml (r.3862-3869) per
   decidere se ventilare. E' la piu' precisa delle due ed e' l'unica che
   conta: mostrare qui un numero calcolato in un altro modo vorrebbe dire
   spiegare una decisione con dati diversi da quelli che l'hanno presa.
   Non esiste un sensore che la pubblichi: si calcola dai sensori clima
   ESISTENTI (serra + casa), che sono gia' quelli che legge l'automazione. */
function dewPoint(t, rh) {
  if (t == null || rh == null) return null
  const a = 17.62, b = 243.12
  const alpha = Math.log(Math.max(rh, 1) / 100) + (a * t) / (b + t)
  const d = (b * alpha) / (a - alpha)
  return isFinite(d) ? d : null
}
// "+0.7" / "−4.7": il segno serve, e il meno dev'essere il meno tipografico.
const conSegno = (n, dec = 1) => (n == null ? null : `${n > 0 ? '+' : (n < 0 ? '−' : '')}${Math.abs(n).toFixed(dec)}`)
/* ── banda ideale + colore a 3 livelli ──────────────────────────────────
   STESSA LOGICA della testata dell'app e di Stato.jsx (le gemelle di queste
   tre funzioni vivono dentro il componente Header di App.jsx e in cima a
   Stato.jsx; non sono export, e estrarle vorrebbe dire rifattorizzare App).
   Serve ai pallini di Temperatura e Umidita' del pannello Ventole: lo stesso
   numero non puo' essere verde in testata e muto qui.
   La banda della temperatura cambia fra giorno e notte, quindi serve anche
   la finestra luci del piano. */
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
// pallino: senza banda o senza valore NON si mette (un puntino color testo
// direbbe "giudizio" dove giudizio non ce n'e')
const bandDot = (v, band, margin) => ((v == null || !band) ? null : bandColor(v, band, margin))
function isGiorno(luciOn, luciOff) {
  const hm = (s) => { if (!s) return null; const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes()
  let on = hm(luciOn), off = hm(luciOff)
  if (on == null || off == null) return true
  if (off === 0) off = 1440
  return on < off ? (nowMin >= on && nowMin < off) : (nowMin >= on || nowMin < off)
}

// "0.8–1.2" → dentro o fuori banda (il target arriva come stringa dal piano)
function inBanda(v, target) {
  if (v == null || !target) return null
  const m = /(-?\d+(?:[.,]\d+)?)\s*[–-]\s*(-?\d+(?:[.,]\d+)?)/.exec(String(target))
  if (!m) return null
  const lo = parseFloat(m[1].replace(',', '.')), hi = parseFloat(m[2].replace(',', '.'))
  return v >= lo && v <= hi
}

/* ── LUCI: mix dei canali e riconoscimento del preset ─────────────────── */
const CH_ORDER = ['d', 'r', 'b', 'g', 'a']
const CH_LAB = { d: 'D', r: 'R', b: 'B', g: 'G', a: 'A' }
// Nome esteso dei canali, per lo slider avanzato (design r.394-395).
const CH_NOME = { d: 'D · rosso profondo', r: 'R · rosso chiaro', b: 'B · blu + bianco', g: 'G · verde', a: 'A · bianco / full' }
/* Colore REALE di ciascun canale LED (design r.394-395). Sono gli unici
   esadecimali dell'app, e la mappa lo mette per iscritto (§7: "extra
   hardcoded solo i dot canali/pompe"): identificano un pezzo di hardware,
   non uno stato dell'interfaccia, e nessun token li rappresenta — il rosso
   profondo del canale D in palette non esiste proprio. */
const CH_COL = { d: '#7f1d2e', r: '#ef2b2b', b: '#2b7bef', g: '#22c55e', a: '#f5f5f5' }
// Il mix del PIANO e del bridge e' sempre nell'ordine D,R,B,G,A.
const mixToObj = (arr) => (Array.isArray(arr) && arr.length >= 5
  ? { d: +arr[0] || 0, r: +arr[1] || 0, b: +arr[2] || 0, g: +arr[3] || 0, a: +arr[4] || 0 }
  : null)
// "D 70 · R 70 · B 30" — solo i canali accesi, per non riempire la riga di zeri.
function mixLabel(o) {
  if (!o) return null
  const on = CH_ORDER.filter((k) => (o[k] || 0) > 0)
  if (!on.length) return 'Tutti a zero'
  return on.map((k) => `${CH_LAB[k]} ${Math.round(o[k])}`).join(' · ')
}
const mixUguale = (a, b) => !!a && !!b && CH_ORDER.every((k) => Math.round(a[k] || 0) === Math.round(b[k] || 0))
// Nome del preset che corrisponde al mix acceso adesso. Le ricette di fase
// arrivano dal PIANO (model.fasi[].luciMix): non sono cablate qui.
function presetDelMix(mix, fasi) {
  if (!mix) return null
  // a canali tutti spenti la riga NON ripete "Spente" (lo dice gia' la riga
  // Stato due sopra): qui interessa che non c'e' nessuna ricetta in corso
  if (CH_ORDER.every((k) => !(mix[k] > 0))) return 'Nessuno'
  if (mix.g > 0 && !mix.d && !mix.r && !mix.b && !mix.a) return 'Luce verde · servizio'
  if (mix.a > 0 && !mix.d && !mix.r && !mix.b && !mix.g) return 'Luce bianca · foto'
  const f = (fasi || []).find((x) => mixUguale(mixToObj(x.luciMix), mix))
  return f ? f.label : null
}

/* ══════════════════════════════════════════════════════════════════════
   BLOCCHI CONDIVISI — la tripletta del design (com'e' ora · da piano ·
   manuale) e' identica in tutti e cinque i pannelli: qui vive una volta
   sola, i pannelli passano solo le righe e le note.
   ══════════════════════════════════════════════════════════════════════ */
/* Righe chiave/valore. Ordine dentro la cella della chiave, fisso ovunque:
     label · (i) · pallino di banda
   L'(i) NON sta piu' in fondo alla riga (decisione 02/08): li' finiva fra i
   valori, spingeva a sinistra il valore delle sole righe che ce l'avevano e
   per rimettere in colonna le altre serviva uno pseudo-spacer vuoto su quasi
   tutte — un buco per riga. Attaccata alla label se la assorbe la cella
   elastica della chiave, e i valori tornano a filo destro da soli.
   `after` = blocco che va SUBITO SOTTO quella riga (es. la nota di
   discordanza dello schedule, che deve stare attaccata alla sua riga e non
   in fondo al riquadro).
   AUDIT R2 (R2-3) — `muto`: a centralina offline i valori vanno gia' a '—',
   e un pallino che continua a dire "in moto"/"in banda" accanto a un trattino
   afferma sull'adesso proprio dove non si sa niente (il caso peggiore era la
   Pompa, nel pannello dove si preme Stop). Qui i pallini che ci sono diventano
   grigi come in Stato.jsx; quelli assenti restano assenti. */
function Righe({ rows, colore, muto }) {
  return rows.filter(Boolean).map((r) => (
    <React.Fragment key={r.k}>
      <div className="cc-row">
        {/* `dotPre` = pallino IN TESTA, prima dell'icona (design r.439-441:
            le tre pompe si riconoscono dal colore del tubo, che deve venire
            prima di tutto). `dot` = pallino di banda in coda alla label,
            quello che qualifica un valore. Sono due cose diverse. */}
        {r.dotPre && <i className="cc-dot" style={{ background: r.dotPre }} />}
        <Icon path={r.i} size={17} color={r.ic || colore || 'var(--fg-3)'} />
        <span className="cc-row-k">
          {r.k}
          {r.info && <RowInfo text={r.info} />}
          {r.dot && <i className="cc-dot" style={{ background: muto ? 'var(--fg-3)' : r.dot }} />}
        </span>
        <span className="cc-row-v">{r.v}</span>
      </div>
      {r.after}
    </React.Fragment>
  ))
}

/* `off` = centralina muta. Riguarda SOLO questo riquadro: "Com'è ora" e' il
   mondo reale letto dai sensori, e senza centralina non se ne sa niente. Il
   riquadro "da piano" invece resta vero (e' il piano, non una lettura), quindi
   li' i pallini non si toccano. L'attenuazione la porta gia' `dim` sul box. */
function BoxOra({ dim, off, rows, children, sub = null }) {
  return (
    <div className="cc-box cc-box--ora" style={{ opacity: dim }}>
      <div className="cc-box-head">
        <Icon path={mdiEyeOutline} size={15} color="var(--fg-2)" />
        <span className="cc-box-t">Com'è ora</span>
      </div>
      {sub && <><div className="cc-box-sub">{sub}</div><div className="cc-sep cc-sep--full" /></>}
      <Righe rows={rows} muto={off} />
      {children}
    </div>
  )
}

/* Introduttivo di "Com'è ora", gemello di quello del riquadro Pianificato e
   IDENTICO in tutti i pannelli (stampo delle Luci, 03/08): la prima frase dice
   cos'e' il riquadro, la seconda cambia con la modalita' — in Pianificato invita
   al confronto con il riquadro accanto, in Libero ricorda che il piano e'
   ignorato. Sta qui una volta sola: e' una frase che dev'essere la stessa
   parola per parola sui cinque pannelli, non cinque frasi che si assomigliano. */
const subOra = (manuale) => (manuale
  ? 'La fotografia di quello che la serra sta facendo adesso. La modalità Libera è attiva: il piano è ignorato e valgono solo i comandi diretti.'
  : 'La fotografia di quello che la serra sta facendo adesso. In modalità Pianificata, il confronto col riquadro accanto dice se tutto è allineato al piano.')

/* In Libero la pill dice "SOSPESA" su tutti e cinque i pannelli: una
   programmazione che c'e' ma non gira. I nutrienti dicevano "DISATTIVATA"
   finche' il loro interruttore era quello dei dosatori (una funzione spenta,
   non uno schedule); dal 04/08 hanno il loro schedule_nutrienti e rientrano
   nella regola comune, quindi l'eccezione (`tagOff`) e' sparita. */
/* `spenta` = coltivazione chiusa. Vale PRIMA della modalita': senza una fase
   in corso il piano non ha nessuna riga da applicare, quindi in Pianificato
   non sta girando niente lo stesso. Dire "ATTIVA" sopra un riquadro di
   trattini prometterebbe automatismi che non ci sono. */
/* `titolo`/`sub` = titolo e spiegazione del riquadro. Il default e' quello
   storico; le Luci provano la forma nuova ("Pianificato · Gestito dal piano"
   con la frase sotto, riorganizzazione 03/08) prima di estenderla agli altri. */
/* `sempre` = contenuto che vale anche a coltivazione chiusa (i rimandi ad
   altre sezioni: dove si impostano alba e ciclo si va comunque). `children`
   invece descrive come lavora il piano: senza coltura non ha soggetto. */
function BoxDeve({ manuale, spenta, rows, children, sempre = null, titolo = 'Come deve essere · da piano', sub = null }) {
  const ferma = manuale || spenta
  return (
    <div className={'cc-box cc-box--deve' + (ferma ? ' spenta' : '')}>
      <div className="cc-box-head">
        <Icon path={mdiFlashAuto} size={16} color="var(--cc-accent)" />
        <span className="cc-box-t cc-box-t--acc">{titolo}</span>
        <span className={'cc-tag' + (ferma ? '' : ' on')}>{spenta ? 'FERMA' : (manuale ? 'SOSPESA' : 'ATTIVA')}</span>
      </div>
      {/* Senza coltura il piano non ha righe da applicare: una colonna di
          trattini lascerebbe il dubbio fra "non previsto" e "dato mancante".
          Vale per tutti e cinque i pannelli, e sta qui una volta sola. */}
      {spenta ? (
        <div className="cc-nota">Non c’è una coltivazione in corso: questo riquadro si popola all’avvio di una coltura.</div>
      ) : (
        <>
          {sub && <><div className="cc-box-sub">{sub}</div><div className="cc-sep cc-sep--full" /></>}
          <Righe rows={rows} colore="var(--cc-accent)" />
          {children}
        </>
      )}
      {sempre}
    </div>
  )
}

/* Il riquadro dei comandi diretti in PIANIFICATO resta visibile ma disattivato, con la
   spiegazione del design: nascondere i comandi lascerebbe l'utente a
   chiedersi dove sono finiti. */
function BoxMan({ manuale, blocked, blockNote, autoNoto, perche, children }) {
  return (
    <div className={'cc-box cc-box--man' + (manuale ? ' on' : '')}>
      <div className="cc-box-head">
        <Icon path={mdiHandBackRightOutline} size={17} color={manuale ? 'var(--errore)' : 'var(--fg-3)'} />
        <span className="cc-box-t" style={{ color: manuale ? 'var(--errore)' : 'var(--fg-3)' }}>
          Libero · comandi diretti
        </span>
        <span className={'cc-tag' + (manuale ? ' man' : '')}>{manuale ? 'ATTIVA' : 'DISATTIVATA'}</span>
      </div>

      {/* stesso vestito "a citazione" degli introduttivi degli altri box.
          SEMPRE PRESENTE, in tutte e due le modalita' (correzione Alberto
          03/08): prima in Libero spariva e al suo posto compariva un avviso
          rosso che diceva la stessa identica cosa — un doppione che a ogni
          cambio di modalita' faceva saltare l'altezza del riquadro. */}
      <div className="cc-box-sub">
        {!autoNoto
          ? 'Modalità non ancora nota: i comandi diretti restano fermi finché la centralina non risponde.'
          : perche}
      </div>
      <div className="cc-sep cc-sep--full" />

      {manuale && blocked && (
        <div className="cc-nota cc-nota--lock">
          <Icon path={mdiLockOutline} size={18} color="var(--fg-3)" />
          <span>{blockNote}</span>
        </div>
      )}
      {children}
    </div>
  )
}

/* Stepper ± condiviso (durata ricircolo, fade, erogazione…). */
function Stepper({ lab, icon, val, unit, min, max, step, disabled, onStep }) {
  return (
    <div className="cc-stepper">
      <span className="cc-stepper-lab">
        {icon && <Icon path={icon} size={16} color="var(--fg-3)" />}
        {lab}
      </span>
      <Hint text={`Diminuisce di ${step}${unit ? ` ${unit}` : ''} (minimo ${min}${unit ? ` ${unit}` : ''})`}>
        <button type="button" className="cc-step" aria-label={`Diminuisci ${lab}`}
          disabled={disabled || val <= min} onClick={() => onStep(-step)}>
          <Icon path={mdiMinus} size={20} />
        </button>
      </Hint>
      <span className="cc-stepper-val mono">{val}{unit ? ` ${unit}` : ''}</span>
      <Hint text={`Aumenta di ${step}${unit ? ` ${unit}` : ''} (massimo ${max}${unit ? ` ${unit}` : ''})`}>
        <button type="button" className="cc-step" aria-label={`Aumenta ${lab}`}
          disabled={disabled || val >= max} onClick={() => onStep(step)}>
          <Icon path={mdiPlus} size={20} />
        </button>
      </Hint>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   COMPONENTE
   ══════════════════════════════════════════════════════════════════════
   Props:
     attiva    sezione visibile → accende il polling
     model     il piano (payload api/timeline di App)
     focus     pannello selezionato — stato SOLLEVATO in App, cosi' una riga
               Componenti di Stato puo' aprire direttamente il suo pannello
     onFocus   setter di `focus`
     onToast   toast globale del Piano: ogni messaggio transitorio passa di li'
     onRefresh refetch del piano lato App (dopo un cambio modalita')
     onGuida   apre la guida (overlay gia' esistente del Piano, per topic)
     onNav     cambia sezione. REGOLA: ogni testo che rimanda a un'altra
               sezione dell'app la offre come LINK, non come indicazione da
               seguire a mano (decisione 02/08). */
export default function Controllo({ attiva, model, focus, onFocus, onToast, onRefresh, onGuida, onNav }) {
  const [stato, setStato] = useState(null)
  const [statoErr, setStatoErr] = useState(null)
  const [durata, setDurata] = useState(DUR_DEF)
  const [durataTocca, setDurataTocca] = useState(false)  // true dopo il primo ± manuale
  const [armed, setArmed] = useState(null)   // id del comando armato | null
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)              // gemello SINCRONO di busy (vedi arma)
  // LUCI · banco canali: staging locale finche' non lo si applica.
  const [luciCh, setLuciCh] = useState({ d: 0, r: 0, b: 0, g: 0, a: 0 })
  const [luciFade, setLuciFade] = useState(0)
  const [luciTocca, setLuciTocca] = useState(false)
  const armT = useRef(null)
  useEffect(() => () => clearTimeout(armT.current), [])
  // uscendo dalla sezione o cambiando pannello un comando armato NON deve
  // restare armato: al ritorno il primo tap eseguirebbe senza conferma.
  useEffect(() => { setArmed(null); clearTimeout(armT.current) }, [attiva, focus])

  const entities = stato?.entities || null
  const ids = useMemo(() => resolveIds(entities), [entities])

  /* ── api/stato: 60 s, solo a sezione attiva e scheda visibile ─────── */
  const loadStato = useCallback(() => fetch('api/stato')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then((j) => { setStato(j); setStatoErr(null) })
    .catch((e) => setStatoErr(String(e.message || e))), [])

  useEffect(() => {
    if (!attiva) return undefined
    // Il PRIMO caricamento ignora document.hidden (l'iframe di HA puo'
    // dichiararsi nascosto mentre la sezione e' davanti all'utente).
    loadStato()
    const tick = () => { if (!document.hidden) loadStato() }
    const iv = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [attiva, loadStato])

  /* ── stati globali della sezione ──────────────────────────────────── */
  const noData = !entities
  const onlineRaw = stOf(entities, ids.online)
  // offline = il bridge dice esplicitamente di no. Payload assente NON e'
  // offline: e' "dati non disponibili" (nota diversa, piu' onesta).
  const off = has(onlineRaw) ? !isOn(onlineRaw) && onlineRaw !== 'online' : false
  const coltivazione = model?.coltivazioneAttiva !== false
  // `blocked` = i comandi non partono. Due cause, due spiegazioni diverse
  // (design r.585 + §6 della mappa).
  const blocked = off || noData || !coltivazione
  const blockNote = off
    ? 'Centralina offline: i comandi sono disabilitati e i valori mostrati non sono aggiornati.'
    : (noData
      ? `Dati di stato non disponibili${statoErr ? ` (${statoErr})` : ''}: i pannelli sono consultabili, i comandi restano fermi.`
      : (!coltivazione
        ? 'Nessuna coltivazione in corso: i pannelli sono consultabili, i comandi restano fermi.'
        : null))
  const blockIcon = off ? mdiWifiOff : (noData ? mdiAlertOutline : mdiFlagCheckered)
  const dim = (off || noData) ? DIM_OFF : '1'
  const acquaBassa = isOn(stOf(entities, ids.acquaBassa))

  /* ── freschezza: quando la centralina ha parlato l'ultima volta ───── */
  const fresco = useMemo(() => {
    const d = toDate(stOf(entities, ids.freschezza))
      || toDate(entOf(entities, ids.livello)?.last_changed)
      || toDate(stato?.fetched)
    return d ? { d, label: fromNow(d), ora: hhmm(d) } : null
  }, [entities, ids, stato])

  /* ── modalita' dei 5 sottosistemi ─────────────────────────────────────
     Fonte per luci/acqua/ventole/nutrienti: model.modo (api/timeline legge
     gia' i quattro input_boolean.serra_schedule_*). Ring:
     input_boolean.serra_ring_auto da api/stato; se non
     arriva il modo resta `null` e il pannello lo dice invece di inventarselo. */
  const autoDi = (k) => {
    if (k === 'ring') {
      const s = stOf(entities, ids.ringAuto)
      return has(s) ? isOn(s) : null
    }
    return model?.modo ? !!model.modo[k] : null
  }

  /* ── le 5 chip ────────────────────────────────────────────────────── */
  const chips = COMP.map((c) => {
    const s = stOf(entities, ids[c.ent])
    const auto = autoDi(c.modo)
    return {
      ...c,
      on: c.k === focus,
      // il sensore-componente del ring puo' pubblicare il colore in
      // esadecimale grezzo ("303030"): sulla card diventa una parola, come
      // dappertutto nel pannello. Le altre quattro passano intatte.
      stato: (off || !has(s)) ? EM : (c.k === 'ring' ? capofrase(nomeColore(s)) : s),
      badge: auto == null ? null : (auto ? 'PIANO' : 'LIBERO'),
      man: auto === false,
    }
  })

  const compSel = COMP.find((c) => c.k === focus) || COMP[1]
  const modoCfg = MODO[compSel.k]
  const autoSel = autoDi(compSel.k)
  const manuale = autoSel === false

  /* ── azioni ───────────────────────────────────────────────────────────
     Pattern armato (design r.180-184): il 1° tap arma e si disarma da solo
     dopo ARM_MS, il 2° esegue. `arma(id, fn)` incapsula tutto e serve sia
     al toggle di modalita' sia a ogni comando diretto. */
  const say = (t) => { if (onToast) onToast(t) }
  const refetch = () => RECONCILE.forEach((t) => setTimeout(() => {
    loadStato()
    if (onRefresh) onRefresh()
  }, t))

  /* AUDIT R3 (M-R3-4): `azione()` CONTA, non commuta. `busy` ha due scrittori
     indipendenti — arma() (tutti i comandi armati) e applicaMix() ("Applica
     colore", che apposta non chiede il secondo tocco e quindi non passa da
     arma) — e con un setBusy nudo la prima delle due che finiva spegneva `busy`
     anche per l'altra. Stesso contatore di azione() in App.jsx: `busy` si
     spegne quando l'ULTIMO ha finito. Le guardie sincrone per-comando (busyRef,
     mixRef) restano: li' il criterio e' "questo comando e' gia' in volo", non
     "il pannello e' occupato". */
  const inVoloRef = useRef(0)
  const azione = (v) => {
    inVoloRef.current = Math.max(0, inVoloRef.current + (v ? 1 : -1))
    setBusy(inVoloRef.current > 0)
  }

  /* AUDIT R2 (M-R2-6): la porta si chiude su un REF, nello stesso istante del
     tap. `busy` e' stato React: il bottone si disabilita solo dal render dopo,
     e fino a li' due tap ravvicinati entrano tutti e due. Le azioni di qui sono
     idempotenti, quindi non e' mai stato un danno — ma il principio e' lo stesso
     di applicaMix e di azione() in App, e vale ovunque si spari un comando. */
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
    azione(true)
    Promise.resolve()
      .then(esegui)
      .finally(() => { busyRef.current = false; azione(false) })
  }

  // Toggle Pianificato ⇄ Libero del pannello aperto.
  const setModo = (auto) => arma(auto ? 'auto' : 'man', () =>
    callService('input_boolean', auto ? 'turn_on' : 'turn_off', { entity_id: modoCfg.ent })
      .then(() => { say(auto ? modoCfg.okAuto : modoCfg.okMan); refetch() })
      .catch((e) => say(`Cambio modalità non riuscito: ${e.message || e}`)))

  /* Scorciatoia per i comandi "lancia uno script e basta".
     `msgGia` (facoltativo) e' la scorciatoia per i comandi che portano a uno
     STATO: se quello stato c'e' gia', il secondo tap non chiama niente e lo
     dice. Serve solo dove il ri-invio non farebbe nulla di visibile — MAI su
     azioni che ripetono davvero (ricircolo, erogazione, rampe), dove "di
     nuovo" e' una richiesta legittima. */
  const lanciaScript = (id, entity, msgOk, variables, msgGia) => arma(id, () => {
    if (msgGia) { say(msgGia); return undefined }
    return callService('script', 'turn_on', variables ? { entity_id: entity, variables } : { entity_id: entity })
      .then(() => { say(msgOk); refetch() })
      .catch((e) => say(`Comando non riuscito: ${e.message || e}`))
  })

  /* ══ PANNELLO ACQUA ══════════════════════════════════════════════════
     Tripletta del design: com'e' ora (reale) · come deve essere (piano,
     sola lettura) · comandi manuali (solo in manuale e non bloccati). */

  // 1. COM'È ORA — solo stato reale letto dai sensori.
  const livello = numOf(entities, ids.livello)
  const litri = numOf(entities, ids.litri)
  /* AUDIT R2 (R2-2) + R3 (M-R3-1): le soglie del pallino vasca nascono dallo
     STESSO helper da cui Stato prende il fondo della banda
     (input_number.serra_acqua_soglia_pct) e ora usano anche gli STESSI gradini.
     Stato costruisce la banda [soglia, 100] con margine 5, cioe': verde da
     soglia in su, ambra nei 5 punti sotto, rosso piu' giu'. Qui si ripete quella
     semantica — rosso anche se l'allarme acqua bassa e' in corso, che e' un
     fatto, non una stima. Prima erano tre gradini di un'altra scala (soglia /
     soglia+15) e lo stesso livello cambiava colore fra le due sezioni.
     15 e' il default dell'helper. */
  const sogliaAcqua = Math.round(numOf(entities, ids.sogliaAcqua) ?? 15)
  // divergenza #3: lo stato pompa e' quello PUBBLICATO dal bridge. Vale
  // `running_now` (derivato da until_ts) se c'e', altrimenti lo stato
  // dichiarato. Se nessuno dei due e' esposto la riga resta a '—' e lo dice.
  const pompaRun = stOf(entities, ids.pompaRun)
  const pompaSt = stOf(entities, ids.pompaStato)
  const pompaNota = has(pompaRun) || has(pompaSt) ? null
    : 'Lo stato della pompa non è fra i dati che la centralina sta comunicando: la riga resta vuota finché il dato non torna.'
  const pompaAttiva = has(pompaRun) ? isOn(pompaRun) : (has(pompaSt) ? isOn(pompaSt) : null)
  const pompaSec = numOf(entities, ids.pompaSec)
  const pompaFine = toDate(stOf(entities, ids.pompaFine))
  const pompaVal = pompaAttiva == null ? EM
    : (pompaAttiva
      ? `In moto${pompaSec ? ` · ${pompaSec} s` : ''}${pompaFine ? ` · fino alle ${hhmm(pompaFine)}` : ''}`
      : 'Ferma')
  const dRic = toDate(stOf(entities, ids.ricircolo))
  const dCambio = toDate(stOf(entities, ids.cambio))

  /* RIORDINO 03/08 (Alberto). "Com'è ora" e' la fotografia dello stato, e
     l'ordine segue quello: prima cosa sta facendo la pompa adesso, poi quando
     ha lavorato l'ultima volta (giorno e ora su due righe, ciascuna con un
     valore asciutto), infine i due livelli lenti — vasca e cambio acqua.
     La riga "Ricircoli" (quanti oggi) e' USCITA da qui: non e' lo stato
     attuale, ed e' gia' nel riquadro Pianificato, che e' il suo posto.
     La DURATA dell'ultimo ricircolo arriva da un helper che HA scrive a ogni
     marcatura (03/08), in tutti i percorsi — schedule, recupero e manuale:
     0 = mai registrata, e la riga non compare. */
  const acquaOra = [
    {
      i: mdiPump, k: 'Pompa', v: off ? EM : pompaVal,
      dot: pompaAttiva == null ? null : (pompaAttiva ? 'var(--cc-acqua)' : 'var(--fg-3)'),
      info: pompaNota || 'Stato pubblicato dalla centralina, non il comando inviato: se un comando fallisce, qui si vede la verità.',
    },
    {
      i: mdiHistory, k: 'Ultimo ricircolo',
      v: (off || !dRic) ? EM : giornoBreve(dRic),
    },
    {
      i: mdiClockOutline, k: 'Orario ultimo ricircolo',
      v: (off || !dRic) ? EM : hhmm(dRic),
    },
    ...(numOf(entities, ids.ricircoloS) > 0 ? [{
      i: mdiTimerSand, k: 'Durata ultimo ricircolo',
      v: (off || !dRic) ? EM : `${Math.round(numOf(entities, ids.ricircoloS))} s`,
    }] : []),
    {
      i: mdiCupWater, k: 'Livello vasca',
      v: (off || livello == null) ? EM : `${Math.round(livello)}%${litri != null ? ` · ${litri} L` : ''}`,
      dot: livello == null ? null
        : (acquaBassa || livello < sogliaAcqua - 5 ? 'var(--errore)'
          : (livello < sogliaAcqua ? 'var(--warn)' : 'var(--ok)')),
      // niente (i): il valore si spiega da solo e l'allarme acqua bassa ha gia'
      // la sua nota in chiaro sotto il blocco
    },
    {
      i: mdiWater, k: 'Ultimo cambio acqua',
      v: (off || !dCambio) ? EM : `${dm(dCambio)} · ${fromNow(dCambio)}`,
      // la soglia consigliata e' informazione di valore: vive nell'(i)
      info: 'Oltre ~17 giorni dallo stesso mix conviene rifare il cambio: i nutrienti si sbilanciano.',
    },
  ]

  // 2. COME DEVE ESSERE · DA PIANO — sola lettura (divergenza #5: questi
  // valori li riscrive il piano a ogni cambio fase, renderli editabili qui
  // sarebbe una modifica illusoria).
  const faseCur = model?.fasi ? model.fasi.find((f) => f.current) : null
  const orari = faseCur?.ricircoli || []
  const durPiano = faseCur?.ricircoloDurata || null
  const pross = prossimoOrario(orari)
  const acquaDeve = [
    // La fase APRE il riquadro (scelta Alberto 03/08): e' lei a decidere
    // tutto quello che segue.
    {
      i: mdiLeaf, k: 'Fase (dal tracker)', v: faseCur?.label || model?.faseAttuale || EM,
      info: 'Fase corrente della coltivazione: è lei a decidere quale riga del piano vale adesso.',
    },
    {
      i: mdiWaterSync, k: 'Ricircoli',
      v: orari.length ? `${orari.length} al giorno` : (faseCur ? 'Nessuno in questa fase' : EM),
    },
    {
      i: mdiClockOutline, k: 'Orario',
      v: orari.length ? orari.join(' · ') : EM,
      info: 'Gli orari nascono come ore dopo l’Alba: spostando l’Alba si spostano anche i ricircoli.',
    },
    { i: mdiTimerSand, k: 'Durata ricircolo', v: durPiano ? `${durPiano} s` : EM },
  ]
  // NIENTE AUTOMATISMI PROMESSI a coltivazione chiusa: "Prossimo ricircolo
  // oggi alle 19:00" su un ciclo finito e' una promessa che nessuno mantiene.
  // La causa si dice per nome — "nessuna fase in corso" da solo lascerebbe a
  // chi legge il compito di indovinare perche'.
  const acquaDeveNota = !coltivazione
    ? 'Coltivazione non attiva: senza una fase in corso il piano non programma ricircoli.'
    : !faseCur
    ? 'Nessuna fase in corso: il piano non prevede ricircoli automatici.'
    : (orari.length
      ? `${pross ? `Prossimo ricircolo ${pross.quando} alle ${pross.ora}. ` : ''}La pompa si ferma da sola.`
      : 'In questa fase il piano non prevede ricircoli automatici.')

  // "Avvia ricircolo di N secondi".
  // Lo script serra_pump_main_apply legge l'input_number "di prova" (1-30 s),
  // che e' un range piu' stretto di quello del pannello. Si chiama invece
  // serra_pump_main_on passando i secondi come `variables`.
  // La marcatura dell'ultimo ricircolo (quella che serve al programma per
  // calcolare il ciclo successivo) la scrive lo script stesso, quindi qui
  // non si tocca: una seconda scrittura riscriverebbe lo stesso valore con
  // un timestamp di poco successivo.
  const avviaRicircolo = () => arma('ric', async () => {
    try {
      await callService('script', 'turn_on', {
        entity_id: SCRIPT_POMPA_ON,
        variables: { seconds: durata },
      })
      say(`Ricircolo avviato · ${durata} s · la pompa si ferma da sola`)
    } catch (e) {
      say(`Ricircolo non avviato: ${e.message || e}`)
      return
    }
    refetch()
  })

  // Durata proposta: quella del piano finche' non la si tocca a mano. Cosi'
  // il valore di partenza e' gia' quello "giusto" per la fase in corso.
  useEffect(() => {
    if (durataTocca) return
    setDurata(clampDur(durPiano || DUR_DEF))
  }, [durPiano, durataTocca])
  const stepDur = (d) => { setDurataTocca(true); setDurata((v) => clampDur(v + d)) }

  /* ══ PANNELLO LUCI ═══════════════════════════════════════════════════
     Divergenza #3: il blocco "com'e' ora" legge lo STATO pubblicato dal
     bridge (sensor.serra_lights_*), MAI gli input_number di staging — quelli
     dicono solo cosa si sta per mandare. */

  // Mix reale: vive nell'attributo `channels` di sensor.serra_lights_state.
  // Se l'attributo non arriva (oggi STATO_ATTR_KEYS non lo lascia passare) si
  // ripiega su canale dominante + intensita', che sono sensori a se'.
  const luciOnRaw = stOf(entities, ids.luciStato)
  const luciAccese = has(luciOnRaw) ? isOn(luciOnRaw) : null
  const luciChReali = useMemo(() => {
    const c = attrOf(entities, ids.luciStato, 'channels')
    if (!c || typeof c !== 'object') return null
    return { d: +c.D || 0, r: +c.R || 0, b: +c.B || 0, g: +c.G || 0, a: +c.A || 0 }
  }, [entities, ids.luciStato])
  const luciIntensita = numOf(entities, ids.luciInt)
  const luciCanaleDom = stOf(entities, ids.luciCanale)
  const luciMixVal = luciChReali
    ? mixLabel(luciChReali)
    : (has(luciCanaleDom) && luciIntensita != null ? `canale ${luciCanaleDom} · ${Math.round(luciIntensita)}%` : null)
  const luciPreset = presetDelMix(luciChReali, model?.fasi)
  // "da schedule ora" = la finestra oraria dice acceso o spento. E' uno
  // STATO calcolato dalla serra, non un comando: se discorda dal pannello,
  // qualcosa non ha eseguito.
  const luciSchedRaw = stOf(entities, ids.luciDaSched)
  const luciSchedOn = has(luciSchedRaw) ? isOn(luciSchedRaw) : null
  const luciDiscorda = luciSchedOn != null && luciAccese != null && luciSchedOn !== luciAccese
  const luciAz = stOf(entities, ids.luciUltimaAz)
  const luciAzQuando = toDate(stOf(entities, ids.luciUltimo))
  /* Ultima azione del pannello, forma "<evento> @<iso>". Descrive la
     transizione avvenuta, quindi vince sul verbo del firmware qui sopra;
     se il valore manca o non ha la coda "@<iso>" si torna al ripiego. */
  const luciAzione = useMemo(() => {
    const raw = String(stOf(entities, ids.luciAzione) ?? '').trim()
    const i = raw.indexOf(' @')
    if (i <= 0) return null
    const ev = raw.slice(0, i).trim()
    return ev ? { ev, quando: toDate(raw.slice(i + 2)) } : null
  }, [entities, ids.luciAzione])

  /* RIORGANIZZAZIONE 03/08 (Alberto): "Com'è ora" e' SOLO la fotografia del
     presente; cio' che prevede il programma sta nel riquadro Pianificato, con
     le STESSE label (Stato/Preset/Mix canali) cosi' le righe si leggono in
     parallelo fra i due riquadri. */
  const luciOra = [
    {
      i: luciAccese ? mdiLightbulbOn : mdiLightbulbOff, k: 'Stato',
      // l'intensita' del firmware e' un dimmer globale che oggi riporta 0
      // anche a pannello acceso (la luminosita' vera sta nei canali): si
      // mostra solo se mai diventasse un numero significativo
      v: (off || luciAccese == null) ? EM
        : (luciAccese ? `Accese${luciIntensita > 0 ? ` · ${Math.round(luciIntensita)}%` : ''}` : 'Spente'),
      dot: luciAccese == null ? null : (luciAccese ? 'var(--luce)' : 'var(--fg-3)'),
      info: luciAccese == null
        ? 'Lo stato del pannello luci non è fra i dati che la centralina sta comunicando: la riga resta vuota finché il dato non torna.'
        : null,
    },
    {
      i: mdiPalette, k: 'Preset', v: (off || !luciPreset) ? EM : luciPreset,
      info: 'Il nome esce dal confronto fra il mix acceso adesso e le ricette del piano: se nessuna combacia la riga resta vuota.',
    },
    { i: mdiBrightness6, k: 'Mix canali', v: (off || !luciMixVal) ? EM : luciMixVal },
    // niente riga "Ultimo comando": nel design vive nell'INTESTAZIONE del
    // pannello (`updated`), che e' il posto giusto — e' un dato sul pannello
    // intero, non una delle cose che la serra sta facendo adesso
  ]

  // "Da piano": ciclo, alba, tramonto CALCOLATO, fade, ricetta di fase.
  // Il ciclo non si legge dall'input_select: si ricava dalla finestra reale
  // che il piano ha calcolato (divergenza #4 — gli orari si calcolano, non
  // si scrivono a mano).
  const luciOre = faseCur?.luciOre != null ? Math.round(faseCur.luciOre) : null
  const luciCiclo = luciOre ? `${luciOre}/${24 - luciOre}` : null
  const alba = faseCur?.luciFinestraOn || model?.luciOn || null
  const tramonto = faseCur?.luciFinestraOff || model?.luciOff || null
  /* DUE FADE DIVERSI, DUE UNITÀ DIVERSE (decisione di Alberto, 02/08):
       · il fade del MIX (input_number.serra_lights_fade, 0-120 s) e' una
         dissolvenza breve fra due colori → SECONDI, ed e' a lui che si
         applica la divergenza #11;
       · la RAMPA di alba e tramonto (input_number.serra_luce_fade_min,
         1-30 min) e' un'altra cosa: e' l'alba vera, dura decine di minuti.
         Si mostra e si imposta in MINUTI, cioe' TALI E QUALI i valori
         dell'helper — nessuna conversione, che a 30 minuti darebbe "1800 s".
     La rampa e' nativa del microcontrollore: lo script pubblica un solo
     comando MQTT e finisce, non tiene occupata la serra e un comando nuovo
     la sostituisce. */
  const rampaMin = numOf(entities, ids.luciFadeMin)
  const mixPiano = mixToObj(faseCur?.luciMix)

  /* Le prime tre righe SPECCHIANO "Com'è ora" (stesse label, stesso ordine):
     a sinistra la fotografia, qui cosa farebbe il programma — la lettura e'
     un confronto riga per riga. Il resto (ciclo, alba, tramonto, rampa) e'
     il contorno che spiega DA DOVE esce la previsione. */
  const luciDeve = [
    {
      // stessa icona della gemella in "Com'è ora", ma sullo stato PREVISTO
      i: luciSchedOn ? mdiLightbulbOn : mdiLightbulbOff, k: 'Stato',
      v: (off || luciSchedOn == null) ? EM : (luciSchedOn ? 'Accese' : 'Spente'),
      dot: luciDiscorda ? 'var(--warn)' : null,
      info: 'Cosa prevede la finestra oraria in questo momento. È una lettura, non un comando.',
      // la spiegazione della discordanza sta ATTACCATA alla riga che la
      // genera, non in fondo al riquadro
      after: luciDiscorda ? (
        <div className="cc-nota cc-nota--gialla">
          {/* IN LIBERO non c'e' niente di storto: il programma e' sospeso
              apposta. Dire "un comando non è arrivato" sarebbe un allarme
              inventato — il tono resta informativo. */}
          <span>
            {manuale
              ? `La modalità Libera è attiva e il programma è ignorato: la finestra oraria prevederebbe ${luciSchedOn ? 'acceso' : 'spento'}.`
              : `Il pannello è ${luciAccese ? 'acceso' : 'spento'} ma la finestra oraria prevede ${luciSchedOn ? 'acceso' : 'spento'}: un comando potrebbe non essere arrivato a destinazione.`}
          </span>
        </div>
      ) : null,
    },
    {
      i: mdiPalette, k: 'Preset', v: faseCur?.label || model?.faseAttuale || EM,
      info: 'È la fase corrente della coltivazione a scegliere la ricetta di luce: quando il Piano cambia fase, cambia anche il preset.',
    },
    { i: mdiBrightness6, k: 'Mix canali', v: mixPiano ? (mixLabel(mixPiano) || EM) : EM },
    { i: mdiThemeLightDark, k: 'Ciclo luce', v: luciCiclo || EM },
    { i: mdiWeatherSunsetUp, k: 'Alba', v: alba || EM },
    {
      i: mdiWeatherSunsetDown, k: 'Tramonto', v: tramonto || EM,
      info: 'Non si imposta: è calcolato come Alba più le ore di luce del ciclo.',
    },
    {
      i: mdiTimerSand, k: 'Rampa alba e tramonto', v: rampaMin != null ? `${Math.round(rampaMin)} min` : EM,
      info: 'Quanto durano l’alba e il tramonto: la luce sale e scende piano, come fuori. La rampa la esegue la centralina per conto suo, quindi nel frattempo la serra resta libera di fare tutto il resto.',
    },
  ]

  /* NOVE PRESET — dal design (r.413-417). Due cose da tenere ferme:
     · sono STAGER, non comandi: al tap spostano i cursori qui sotto e basta.
       Niente doppia conferma, perche' non parte niente. La conferma UNICA e'
       "Applica colore" (design: `presetsNote` r.418).
     · il COLORE e' quello del design. Per le quattro fasi si usa la palette
       di fase di app.css (--fase-*), che e' anche quella della barra in cima:
       lo stesso concetto non puo' avere due colori in due punti dell'app.
       Verde/Alba/Tramonto/Spegni coincidono con gli accenti del design
       (media / luce / temperatura / nessuno); per "Bianco" il design usa
       l'accento `lab`, che in app.css non esiste: si usa --oggi, il bianco
       pieno, che per una luce bianca dice anche la cosa giusta.
     Il sottotitolo dei quattro di fase e' il mix VERO del piano, non un
     valore cablato: se la ricetta cambia in serra_piano.yaml cambia qui. */
  const mixDiFase = (key) => mixToObj((model?.fasi || []).find((f) => f.key === key)?.luciMix)
  const MIX_VERDE = { d: 0, r: 0, b: 0, g: 100, a: 0 }    // = script serra_luce_preset_verde
  const MIX_BIANCO = { d: 0, r: 0, b: 0, g: 0, a: 100 }   // = script serra_luce_preset_bianco
  const MIX_ZERO = { d: 0, r: 0, b: 0, g: 0, a: 0 }       // = script serra_luci_lab_off

  const stagePreset = (mix) => { setLuciTocca(true); setLuciCh({ ...mix }) }

  const luciStager = [
    ...[
      // accenti ESATTI del design (PR(label, sub, mix, ACCENT, icona)):
      // alberto · media · sicurezza · tapparella. NON la palette di fase:
      // germinazione qui e' verde-acqua, non l'azzurro della barra fasi.
      { key: 'germinazione', lab: 'Germinazione', icon: mdiLeaf, col: 'var(--cc-alberto)' },
      { key: 'vegetativa', lab: 'Vegetativa', icon: mdiSprout, col: 'var(--verde)' },
      { key: 'fioritura', lab: 'Fioritura', icon: mdiFlower, col: 'var(--cc-sicurezza)' },
      { key: 'flush', lab: 'Flush', icon: mdiWaterOutline, col: 'var(--fase-flush)' },
    ].map((p) => {
      const m = mixDiFase(p.key)
      return {
        ...p, id: `pf:${p.key}`, mix: m,
        sub: m ? (mixLabel(m) || 'tutti a zero') : 'ricetta non nel piano',
      }
    }),
    { id: 'p:verde', lab: 'Verde', sub: 'Luce di servizio', icon: mdiScissorsCutting, col: 'var(--verde)', mix: MIX_VERDE },
    { id: 'p:bianco', lab: 'Bianco', sub: 'Luce piena, per foto', icon: mdiCamera, col: 'var(--cc-lab)', mix: MIX_BIANCO },
  ]
  // "Spegni tutto" e' il NONO: resta solo sulla sua riga e il flex lo porta a
  // tutta larghezza — nel design e' esattamente cosi'. Accento: nessuno.
  const luciSpegni = { id: 'p:off', lab: 'Spegni tutto', sub: 'Tutti i canali a zero', icon: mdiLightbulbOff, col: 'var(--hairline-strong)', ic: 'var(--fg-3)', mix: MIX_ZERO }

  /* ALBA e TRAMONTO stanno NELLA GRIGLIA come gli altri sette e hanno lo
     stesso identico vestito (accenti del design: luce e temperatura) — cambia
     solo cosa fanno al tocco: non preparano i cursori, mandano la rampa vera
     (serra_luce_alba/tramonto), quindi sono armati in due tocchi.
     Nel mock del design erano `PR()` come gli altri, ma coi valori di
     "Vegetativa" e "Spegni tutto": come stager sarebbero due doppioni esatti
     e il sottotitolo "Rampa di N min" sarebbe falso, perche' "Applica colore"
     usa il fade del mix in secondi, non la rampa in minuti. */
  const rampaSub = (dove) => (rampaMin != null ? `Rampa di ${Math.round(rampaMin)} min ${dove}` : `Rampa ${dove}`)
  const luciTransizioni = [
    {
      id: 'p:alba', lab: 'Alba', sub: rampaSub('fino al preset fase'), icon: mdiWeatherSunsetUp,
      col: 'var(--luce)', ent: SCRIPT_LUCE_ALBA, msg: 'Luci: avviata la rampa di alba',
    },
    {
      id: 'p:tramonto', lab: 'Tramonto', sub: rampaSub('fino a spento'), icon: mdiWeatherSunsetDown,
      col: 'var(--warn)', ent: SCRIPT_LUCE_TRAMONTO, msg: 'Luci: avviata la rampa di tramonto',
    },
  ].map((p) => ({ ...p, azione: true, run: () => lanciaScript(p.id, p.ent, p.msg) }))

  /* I NOVE TILE nell'ordine del design: le quattro fasi, Verde, Bianco,
     Alba, Tramonto, e Spegni tutto in coda a tutta larghezza. */
  const luciTile = [...luciStager, ...luciTransizioni, luciSpegni]

  /* Cursori: partono dal mix REALE (o da quello del piano se il reale non e'
     pubblicato) e restano fermi appena li si tocca o si preme un preset —
     altrimenti il polling ogni 60 s riscriverebbe sotto le dita quello che si
     sta preparando.
     NB il fade proposto qui e' quello del MIX (sensor.serra_lights_fade),
     non quello di alba/tramonto: sono due impostazioni diverse sulla
     centralina, con due range diversi (0-120 s il mix, 1-30 min la rampa). */
  const luciFadeReale = numOf(entities, ids.luciFadeS)
  useEffect(() => {
    if (luciTocca) return
    const base = luciChReali || mixPiano
    if (base) setLuciCh(base)
    if (luciFadeReale != null) setLuciFade(Math.max(0, Math.min(120, Math.round(luciFadeReale / 5) * 5)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [luciChReali, faseCur?.key, luciFadeReale, luciTocca])

  const setCh = (k, v) => { setLuciTocca(true); setLuciCh((o) => ({ ...o, [k]: Math.max(0, Math.min(100, Math.round(v))) })) }
  const stepFadeLuci = (d) => { setLuciTocca(true); setLuciFade((v) => Math.max(0, Math.min(120, v + d))) }

  /* ── "Applica colore": l'UNICA conferma del pannello ──────────────────
     I preset non mandano niente, spostano i cursori: tutto passa di qui.

     SCORCIATOIE. Il mix preparato coincide a volte con una ricetta che la
     serra ha gia' pronta come script (verde, bianco, spento): in quei casi si
     chiama lo script dedicato invece di riscrivere i cinque input_number.
     La scorciatoia vale solo a fade INVARIATO: gli script leggono il fade
     dall'helper, quindi se lo si e' toccato bisogna scriverlo, e a quel punto
     tanto vale passare dalla via lunga.

     AUDIT R2 (R2-6) — PERCHE' LE FASI NON HANNO PIU' LA SCORCIATOIA.
     Il logger del diario deduce l'origine dal CONTEXT dello state-change:
     `parent_id is none` = gesto di una persona, altrimenti catena automatica.
     Conta solo l'anello INIZIALE. serra_luce_applica_fase chiama al suo interno
     serra_luce_applica_mix: partendo di li', l'applica_mix nasce DENTRO un
     altro script — parent_id valorizzato — e il diario scriveva `origine: auto`
     per un dito su "Applica colore". Stesso bottone, stesso gesto, verdetto
     opposto a seconda di quale ricetta capitava sui cursori.
     Verde/bianco/spento restano: li' lo script e' l'anello iniziale (lo chiama
     l'app), quindi parent none → `manuale`, che e' corretto. I mix di fase
     passano dalla via lunga (canali + fade + applica_mix chiamato direttamente),
     che e' anch'essa un anello iniziale.

     "GIA' ATTIVO": se il mix preparato e' identico a quello acceso adesso
     (e il fade non e' cambiato) non parte nessuna chiamata. La centralina
     avrebbe comunque la sua guardia, ma da fuori si vedrebbe un comando
     partito e niente che cambia — il modo peggiore di non fare niente. */
  // Il fade staged e' sempre su griglia di 5 (l'effetto qui sopra lo arrotonda):
  // il reale va portato sulla stessa griglia PRIMA di confrontarlo, altrimenti
  // un valore fuori passo disattiverebbe la scorciatoia per sempre.
  const fadeInvariato = luciFadeReale == null || Math.round(luciFadeReale / 5) * 5 === luciFade
  const scorciatoia = () => {
    if (!fadeInvariato) return null
    if (mixUguale(luciCh, MIX_VERDE)) return { ent: SCRIPT_LUCE_VERDE }
    if (mixUguale(luciCh, MIX_BIANCO)) return { ent: SCRIPT_LUCE_BIANCO }
    if (mixUguale(luciCh, MIX_ZERO)) return { ent: SCRIPT_LUCE_OFF }
    return null
  }
  // Ultimo mix INVIATO da qui: lo stato reale arriva dal bridge a duty-cycle
  // (minuti dopo), quindi confrontare solo con la realta' fa ri-mandare lo
  // stesso colore al secondo tap. Se la realta' non si e' mossa da quando
  // abbiamo inviato, cio' che abbiamo inviato FA FEDE come "gia' impostato".
  const ultimoInvioRef = useRef(null)
  /* GUARDIA DI REENTRANZA. "Applica colore" NON chiede il secondo tocco
     (decisione Alberto: premere = applicare), quindi non passa da arma() e
     nessuno alza `busy` per lui. Senza guardia due tap ravvicinati avviano due
     sequenze INTERLACCIATE: gli input_number vengono scritti a mani alterne e
     serra_luce_applica_mix pubblica un mix ibrido fra i due colori. Il ref
     chiude la porta nello stesso istante del tap (`busy` e' stato React: il
     bottone si disabilita solo dal render dopo). */
  const mixRef = useRef(false)
  const applicaMix = async () => {
    if (mixRef.current) return
    mixRef.current = true
    azione(true)
    try { await mandaMix() } finally { mixRef.current = false; azione(false) }
  }
  // Niente doppio tap: il caso "niente da fare" e' gestito qui sotto con il
  // toast dedicato, non con una conferma.
  const mandaMix = async () => {
    const esito = `Colore applicato · ${mixLabel(luciCh) || 'tutti a zero'}${luciFade ? ` · fade ${luciFade} s` : ''}`
    // Lo stato EFFETTIVO contro cui confrontare: se dall'ultimo invio la
    // realta' pubblicata non si e' mossa (bridge a duty-cycle: puo' restare
    // stantia per minuti), fa fede L'ULTIMO INVIO — anche quando la realta'
    // stantia coincide per caso col colore che si sta per mandare. Se la
    // realta' si e' aggiornata (o non abbiamo mai inviato), fa fede lei.
    const u = ultimoInvioRef.current
    const realtaFerma = u && (!luciChReali || (u.realeAllora && mixUguale(luciChReali, u.realeAllora)))
    const effettivo = realtaFerma ? u.mix : luciChReali
    const effFadeOk = realtaFerma ? (u.fade === luciFade) : fadeInvariato
    if (effettivo && mixUguale(effettivo, luciCh) && effFadeOk) {
      say('Colore non cambiato: era già impostato così')
      return
    }
    const ricordaInvio = () => { ultimoInvioRef.current = { mix: { ...luciCh }, fade: luciFade, realeAllora: luciChReali ? { ...luciChReali } : null } }
    const corta = scorciatoia()
    if (corta) {
      try {
        await callService('script', 'turn_on', { entity_id: corta.ent })
        ricordaInvio()
        say(esito)
        refetch()
      } catch (e) { say(`Colore non applicato: ${e.message || e}`) }
      return
    }
    // via lunga: i cinque canali piu' il fade, poi la pubblicazione del mix.
    // Se una scrittura fallisce l'errore esce nel toast e il mix NON parte:
    // meglio fermarsi che mandare un colore diverso da quello sui cursori.
    try {
      for (const k of CH_ORDER) {
        await callService('input_number', 'set_value', { entity_id: IN_LUCE_CH[k], value: Math.round(luciCh[k] || 0) })
      }
      await callService('input_number', 'set_value', { entity_id: IN_LUCE_FADE, value: luciFade })
    } catch (e) {
      say(`Canali non scritti: ${e.message || e}`)
      return
    }
    try {
      await callService('script', 'turn_on', { entity_id: SCRIPT_LUCE_MIX })
      ricordaInvio()
      say(esito)
      refetch()
    } catch (e) { say(`Colore non applicato: ${e.message || e}`) }
  }

  /* ══ PANNELLO VENTOLE ════════════════════════════════════════════════
     E' il pannello piu' ricco, ed e' quasi tutto SUPERVISIONE: la parte di
     valore non sono i tre comandi, e' capire perche' le ventole girano o no.
     Divergenza #3: i livelli si leggono dallo STATO pubblicato dal bridge
     (sensor.serra_fan_*_level), non dagli input_select che li comandano. */
  const fanLv = { v1: stOf(entities, ids.fan1Lv), v2: stOf(entities, ids.fan2Lv), vf: stOf(entities, ids.fanFLv) }
  const fanDot = (k) => (has(fanLv[k]) ? (fanLv[k] === 'off' ? 'var(--fg-3)' : 'var(--warn)') : null)

  // Clima: il tarato e' gia' esposto, il grezzo e l'offset no. Se manca il
  // grezzo si mostra il solo tarato invece di inventare la freccia.
  const tSerra = numOf(entities, ids.tempTarata)
  const hSerra = numOf(entities, ids.umidTarata)
  // (niente lettura GREZZA: dal riordino 03/08 le righe clima mostrano solo il
  //  valore tarato, che e' quello su cui decidono le soglie)
  const tCasa = numOf(entities, ids.casaT)
  const hCasa = numOf(entities, ids.casaH)
  // VPD: si preferisce api/stato (stessa lettura, stesso giro di polling di
  // tutto il resto del pannello); il piano resta il ripiego. La BANDA ideale
  // invece vive solo negli attributi che passa api/timeline.
  const vpd = numOf(entities, 'sensor.serra_vpd') ?? (model?.clima?.vpd != null ? model.clima.vpd : null)
  const vpdTarget = model?.clima?.vpdTarget || null
  const vpdOk = inBanda(vpd, vpdTarget)
  const dewSerra = dewPoint(tSerra, hSerra)
  const dewCasa = dewPoint(tCasa, hCasa)
  /* BANDE IDEALI della fase, le stesse della testata e di Stato: la banda
     della temperatura cambia fra giorno e notte (le piante di notte stanno
     piu' fresche), quella dell'umidita' no. I margini — 2 °C e 7 punti —
     sono quelli dell'header: lo stesso numero non puo' essere ambra in cima
     alla pagina e verde qui. */
  const climaGiorno = isGiorno(model?.luciOn, model?.luciOff)
  const bandaTemp = parseBand((!climaGiorno && model?.clima?.tempTargetNotte) ? model.clima.tempTargetNotte : model?.clima?.tempTarget)
  const bandaUmid = parseBand(model?.clima?.rhTarget)

  const ventoleOra = [
    {
      // UNA riga per tutte e tre, come nel design (r.424): i livelli delle
      // singole si leggono comunque nei segmenti del riquadro manuale, dove
      // sono anche il comando — ripeterli qui in tre righe era un doppione.
      i: mdiFan, k: 'Ventole',
      // la percentuale della singola sta nell'attributo _percent: qui basta il
      // livello, la percentuale la si vede premendo (i tre segmenti sotto)
      // il livello arriva dal firmware via MQTT senza validazione: un valore
      // fuori dai quattro noti non deve far cadere l'albero (si mostra grezzo)
      v: (off || !has(fanLv.v1)) ? EM
        : `V1 ${LIVELLO_LAB[fanLv.v1]?.toLowerCase() || fanLv.v1} · V2 ${LIVELLO_LAB[fanLv.v2]?.toLowerCase() || EM} · fr. ${LIVELLO_LAB[fanLv.vf]?.toLowerCase() || EM}`,
      dot: fanDot('v1') && (fanLv.v1 !== 'off' || fanLv.v2 !== 'off' || fanLv.vf !== 'off') ? 'var(--warn)' : 'var(--fg-3)',
      info: 'La frontale è quella sul canale del filtro ai carboni: porta fuori l’aria che le altre due spingono.',
    },
    /* CORREZIONE 03/08 (Alberto): un numero solo, intero, quello TARATO —
       cioe' quello su cui decidono le soglie. La coppia "grezza → tarata"
       raccontava la taratura, che qui non serve a nessuno, e con lei se n'e'
       andata anche l'(i) che la spiegava. Resta il pallino di banda, con gli
       stessi colori della testata. */
    {
      i: mdiThermometer, k: 'Temperatura', v: (off || tSerra == null) ? EM : `${Math.round(tSerra)} °C`,
      dot: bandDot(tSerra, bandaTemp, 2),
    },
    {
      i: mdiWaterPercent, k: 'Umidità', v: (off || hSerra == null) ? EM : `${Math.round(hSerra)} %`,
      dot: bandDot(hSerra, bandaUmid, 7),
    },
    {
      i: mdiWaves, k: 'VPD', v: (off || vpd == null) ? EM : `${vpd} kPa${vpdOk == null ? '' : (vpdOk ? ' · in banda' : ' · fuori banda')}`,
      dot: vpdOk == null ? null : (vpdOk ? 'var(--ok)' : 'var(--warn)'),
      info: 'Quanta sete ha l’aria vista dalla pianta. È solo un indicatore: le ventole non lo seguono, girano su temperatura e umidità.',
    },
    {
      i: mdiHomeThermometerOutline, k: 'Casa (riferimento)',
      v: (off || tCasa == null) ? EM : `${tCasa.toFixed(1)} °C${hCasa != null ? ` · ${Math.round(hCasa)}%` : ''}`,
      info: 'La serra ha quattro fori e scambia aria con la stanza: ventilando può solo avvicinarsi a queste condizioni, mai superarle.',
    },
    {
      // VALORI ASCIUTTI: la riga sopra ha gia' detto cos'e' la "casa", qui
      // basta "con la casa" — su mobile ogni parola in piu' manda a capo.
      i: mdiTriangleOutline, k: 'Scarto con la casa',
      v: (off || tSerra == null || tCasa == null) ? EM
        : `${conSegno(tSerra - tCasa)} °C${(hSerra != null && hCasa != null) ? ` · ${conSegno(hSerra - hCasa, 0)}%` : ''}`,
      info: 'Sotto un grado di scarto le ventole girerebbero a vuoto: per raffreddare serve che in casa faccia davvero più fresco.',
    },
    {
      i: mdiThermometerWater, k: 'Punto di rugiada',
      v: (off || dewSerra == null) ? EM
        : `${dewSerra.toFixed(1)}${dewCasa != null ? ` · ${dewCasa.toFixed(1)}` : ''} °C`,
      dot: (dewSerra != null && dewCasa != null) ? ((dewSerra - dewCasa) >= 0.5 ? 'var(--ok)' : 'var(--fg-3)') : null,
      info: 'Primo numero la serra, secondo la casa. È il confronto che conta per deumidificare: l’acqua vera nell’aria, non la percentuale. Se in casa il punto di rugiada è più basso, ventilare asciuga davvero; altrimenti no, anche con l’umidità di casa alta.',
    },
    /* La riga "Da soglie ora" e' USCITA (Alberto 03/08): il motivo per cui le
       ventole stanno a un livello non e' fra i dati che la serra pubblica, e
       una riga permanentemente a trattino non e' informazione. */
  ]

  // "Da piano": le due soglie arrivano dal PIANO della fase corrente, non
  // dagli input_number (che il piano riscrive a ogni cambio fase —
  // divergenza #5). Livello auto e filtro odori sono impostazioni.
  const amb = faseCur?.ambiente || null
  const ventLivAuto = stOf(entities, ids.ventAuto)
  const filtroOdori = stOf(entities, ids.filtroOdori)
  /* Il filtro ai carboni serve dalle fasi che profumano in poi: fioritura,
     flush ed essiccazione (nel piano di coltura e' la milestone "Montare
     filtro odore", che cade all'inizio della fioritura). E' la FASE a dirlo,
     non l'interruttore in Impostazioni — quello dice solo se la funzione e'
     accesa. */
  const FILTRO_FASI = ['fioritura', 'flush', 'essiccazione']
  const filtroServe = !!faseCur && FILTRO_FASI.includes(faseCur.key)
  /* Le prime quattro righe SPECCHIANO "Com'è ora" (stesse label, stesso
     ordine, stessa icona): a sinistra la misura di adesso, qui la soglia su
     cui decide il piano — la lettura e' un confronto riga per riga. Filtro
     odori e riposo sono il contorno: descrivono comportamenti che nel riquadro
     reale non hanno una misura corrispondente. */
  const ventoleDeve = [
    {
      // il rimando a Impostazioni NON sta nella bolla (li' un link non puo'
      // esistere): e' la nota in fondo al riquadro, con il suo link
      i: mdiFan, k: 'Ventole', v: has(ventLivAuto) ? `${LIVELLO_LAB[ventLivAuto] || ventLivAuto} quando serve` : EM,
      info: 'Il livello a cui salgono quando le soglie lo chiedono.',
    },
    /* "Oltre", non "Soglia" (Alberto 03/08): la parola soglia da sola non dice
       da che parte si sale. E il come lo spiega l'(i), una per riga, perche' le
       due grandezze rientrano con margini diversi — un grado la temperatura,
       cinque punti l'umidita' (isteresi del piano di coltura). */
    {
      i: mdiThermometer, k: 'Temperatura', v: amb?.soglia_temp != null ? `Oltre ${amb.soglia_temp} °C` : EM,
      info: 'Sopra questa temperatura le ventole salgono al livello automatico e ci restano finché la serra non scende di un grado sotto: senza questo margine si accenderebbero e spegnerebbero di continuo. Estraggono soltanto, quindi raffreddano solo se in casa fa davvero più fresco.',
    },
    {
      i: mdiWaterPercent, k: 'Umidità', v: amb?.soglia_umidita != null ? `Oltre ${amb.soglia_umidita} %` : EM,
      info: 'Sopra questa umidità le ventole salgono al livello automatico e ci restano finché la serra non scende di cinque punti sotto: senza questo margine si accenderebbero e spegnerebbero di continuo. Estraggono soltanto, quindi asciugano solo se l’aria di casa è più secca davvero.',
    },
    { i: mdiWaves, k: 'VPD', v: vpdTarget ? `Target ${vpdTarget} kPa` : EM },
    {
      /* VALORE DALLA FASE, non dall'interruttore (Alberto 03/08): la riga
         risponde a "serve adesso?", e a deciderlo e' la fase in corso —
         il filtro va montato dalla fioritura all'essiccazione. Se l'utente
         l'ha spento in Impostazioni, il fatto si dice nell'(i): fra
         l'indicazione e il dato vero vince il dato vero. */
      i: mdiAirFilter, k: 'Filtro odori',
      v: !faseCur ? EM : (filtroServe ? 'Necessario' : 'Non necessario'),
      info: `Serve dalla fioritura all’essiccazione, le fasi che profumano: tutte le ventole vanno a livello basso mezz’ora sì e mezz’ora no, per tenere l’aria in movimento nel filtro anche quando il clima non lo chiede.${filtroServe && has(filtroOdori) && !isOn(filtroOdori) ? ' In questo momento la funzione è spenta, quindi il ciclo non parte.' : ''}`,
    },
    {
      // niente durate cablate: se cambiassero nel YAML la riga mentirebbe
      i: mdiTimerPauseOutline, k: 'Riposo anti-usura', v: 'A intervalli regolari',
      info: 'Una pausa periodica che batte tutto il resto: sono micro-ventole, tenerle in moto senza sosta le consuma.',
    },
  ]
  const ventoleDeveNota = !coltivazione
    ? 'Coltivazione non attiva: le soglie di fase non si applicano e le ventole restano ferme.'
    : 'Le ventole salgono solo se lo scambio con la casa aiuta davvero, e si spengono da sole al rientro delle condizioni.'

  /* ── Comandi: QUATTRO RIGHE A SEGMENTI (design r.435) ────────────────
     Niente tendine e niente CTA "Applica": il segmento E' il comando.
     Ogni pressione e' un'azione fisica → armata in due tocchi: il primo
     porta quel segmento in ambra, il secondo manda il comando.
     "Tutte le ventole (derivato)" e' la riga in cima: premuta, porta tutte e
     tre allo stesso livello — mandando pero' SOLO quelle che devono davvero
     cambiare.

     ULTIMO INVIO FA FEDE (stesso schema di applicaMix delle Luci).
     Il livello che il bridge pubblica arriva col suo comodo: il wifi e' a
     duty-cycle e sensor.serra_fan_N_level puo' restare fermo per minuti su un
     valore vecchio. Confrontare la pressione con la sola realta' sbaglia in
     tutt'e due i versi:
       · invio "alta", poi "bassa", poi di nuovo "alta" mentre il reale e'
         ancora fermo su "alta" → direbbe "gia' su alta" e NON manderebbe,
         lasciando la ventola su bassa;
       · e al contrario, ripremere subito lo stesso livello lo rimanderebbe.
     Quindi: finche' la realta' non si MUOVE da dov'era quando abbiamo
     inviato, fa fede quello che abbiamo inviato; appena la realta' cambia
     (o se non abbiamo mai inviato) torna a comandare lei. Nessun TTL: e' la
     realta' che si muove a fare da reset, non un orologio. */
  const ultimoFanRef = useRef({})
  const effettivoFan = (k) => {
    const reale = has(fanLv[k]) ? fanLv[k] : null
    const u = ultimoFanRef.current[k]
    // realta' ferma = non sappiamo nulla, oppure e' ancora quella di allora
    const realtaFerma = u && (!reale || (u.realeAllora && reale === u.realeAllora))
    return realtaFerma ? u.livello : reale
  }
  const ricordaFan = (k, liv) => {
    ultimoFanRef.current[k] = { livello: liv, realeAllora: has(fanLv[k]) ? fanLv[k] : null }
  }
  // Il derivato "Tutte" e' acceso solo quando le tre EFFETTIVE coincidono:
  // il sensore aggregato della serra ha lo stesso ritardo delle singole.
  const effTutte = (() => {
    const [a, b, c] = ['v1', 'v2', 'vf'].map(effettivoFan)
    return (a && a === b && b === c) ? a : null
  })()

  const ventRighe = [
    { k: 'all', lab: 'Tutte le ventole', sub: 'le tre insieme', ora: effTutte },
    { k: 'v1', lab: 'Ventola 1', ora: effettivoFan('v1') },
    { k: 'v2', lab: 'Ventola 2', ora: effettivoFan('v2') },
    { k: 'vf', lab: 'Frontale', ora: effettivoFan('vf') },
  ]
  // Quali ventole toccherebbe questa pressione: quelle il cui livello
  // EFFETTIVO e' diverso da quello chiesto.
  const bersagli = (riga, liv) => (riga === 'all'
    ? ['v1', 'v2', 'vf'].filter((k) => effettivoFan(k) !== liv)
    : (effettivoFan(riga) === liv ? [] : [riga]))
  const nomeFan = (k) => (k === 'vf' ? 'frontale' : `V${k.slice(1)}`)
  const setLivello = (riga, liv) => arma(`vent:${riga}:${liv}`, async () => {
    const da = bersagli(riga, liv)
    // "gia' cosi'" sull'EFFETTIVO, non sulla sola realta': zero chiamate
    if (!da.length) {
      say(riga === 'all'
        ? `Le ventole sono già tutte su ${LIVELLO_LAB[liv].toLowerCase()}`
        : `${riga === 'vf' ? 'La frontale è' : `La ventola ${riga.slice(1)} è`} già su ${LIVELLO_LAB[liv].toLowerCase()}`)
      return
    }
    const fatte = []
    try {
      for (const k of da) {
        await callService('input_select', 'select_option', { entity_id: IN_FAN[k], option: liv })
        // si ricorda SUBITO, ventola per ventola: se la terza fallisce, le
        // prime due sono partite davvero e la memoria deve saperlo
        ricordaFan(k, liv)
        fatte.push(k)
      }
    } catch (e) {
      say(`Livello non impostato: ${e.message || e}`)
      if (fatte.length) refetch()
      return
    }
    say(`${fatte.map(nomeFan).join(' · ')} → ${LIVELLO_LAB[liv].toLowerCase()}`)
    refetch()
  })

  /* ══ PANNELLO NUTRIENTI ══════════════════════════════════════════════
     STRUTTURA DAL DESIGN (r.438-455): colonna 1 = le tre pompe + una CARD A
     PARTE con la dose di fase in tre tessere; colonna 2 = il piano; colonna
     3 = erogazione (parametri + portata in sola lettura) e i tre EROGA.
     Nessuna sezione "avanzata": il design non ce l'ha. La TARATURA delle
     pompe non vive qui — e' un'impostazione, sta in Impostazioni (Fase 4);
     di lei resta solo la riga di lettura "Portata pompe".
     Le pompe non si chiamano mai "N0/N1/N2": colore e nutriente, ed e'
     quella la mappa che comanda i bottoni. */
  const dNutr = toDate(stOf(entities, ids.nutrUltimo))
  const nutrOra = [
    ...POMPE.map((p) => {
      const st = stOf(entities, ids[p.stato])
      const run = stOf(entities, ids[p.run])
      const inMoto2 = has(run) ? isOn(run) : null
      return {
        i: mdiPump, k: `Pompa ${p.nome} · ${p.nutr}`,
        v: off ? EM : (has(st) ? st : (inMoto2 == null ? EM : (inMoto2 ? 'In erogazione' : 'Ferma'))),
        dotPre: p.colore, ic: p.colore,
      }
    }),
    // chiude il riquadro come l'"Ultimo cambio acqua" chiude quello dell'Acqua:
    // le tre righe dicono l'adesso, questa da' la profondita' temporale.
    // CON L'ORA (04/08): il sensore porta il timestamp completo e qui l'ora e'
    // informazione vera — fra un'erogazione della mattina e una della sera
    // cambia se la vasca ha gia' girato o no. Forma estesa ("25/07 alle 14:30")
    // perche' e' l'unico valore della riga: non deve stare stretto accanto ad
    // altro, e "alle" la fa leggere come una frase invece che come un codice.
    {
      i: mdiHistory, k: 'Ultima erogazione',
      v: (off || !dNutr) ? EM : `${giornoBreve(dNutr)} alle ${hhmm(dNutr)}`,
    },
  ]

  /* Dose della fase. Il sensore la pubblica gia' risolta: lo stato e' la riga
     in chiaro ("R 1.8 · G 1.2 · B 0.6 ml/L"), l'attributo `dose` porta anche
     i millilitri per la vasca REALE. Se l'attributo non arriva (oggi il
     backend filtra gli attributi) i ml si ricavano dal ml/L per i litri della
     vasca, che il piano gia' conosce: meglio un numero calcolato in chiaro
     che tre tessere vuote. */
  const doseAttr = attrOf(entities, ids.dose, 'dose')
  const doseTxt = stOf(entities, ids.dose)
  // I litri vengono da model.vasca e basta: `capacita` ha un default (4.5),
  // quindi un terzo ripiego non avrebbe mai materia su cui girare.
  const litriVasca = (model?.vasca?.litri && model.vasca.litri > 0)
    ? model.vasca.litri
    : (model?.vasca?.capacita || null)
  const doseMlL = useMemo(() => {
    if (doseAttr && typeof doseAttr === 'object') {
      return { grow: doseAttr.grow_ml_l, micro: doseAttr.micro_ml_l, bloom: doseAttr.bloom_ml_l }
    }
    const m = /R\s*([\d.,]+)\s*·\s*G\s*([\d.,]+)\s*·\s*B\s*([\d.,]+)/i.exec(doseTxt || '')
    if (!m) return null
    const f = (x) => parseFloat(String(x).replace(',', '.'))
    return { grow: f(m[1]), micro: f(m[2]), bloom: f(m[3]) }
  }, [doseAttr, doseTxt])
  const doseMlVasca = (k) => {
    if (doseAttr && typeof doseAttr === 'object' && doseAttr[`${k}_ml_vasca`] != null) return doseAttr[`${k}_ml_vasca`]
    if (doseMlL && doseMlL[k] != null && litriVasca) return Math.round(doseMlL[k] * litriVasca * 10) / 10
    return null
  }
  const doseEc = doseAttr && typeof doseAttr === 'object' ? doseAttr.ec : null
  /* I litri su cui i millilitri sono calcolati: quelli dell'attributo, che li
     ha usati per il conto, e solo in mancanza quelli della vasca dal piano.
     Vanno mostrati ACCANTO al numero (04/08): "8.1 ml" da solo non dice su
     quanta acqua, e la stessa card serve sia a chi dosa con la siringa sia a
     chi controlla cosa hanno erogato le pompe. */
  const doseLitri = (doseAttr && typeof doseAttr === 'object' && doseAttr.vasca_litri != null)
    ? doseAttr.vasca_litri
    : litriVasca
  /* Titolo SENZA il nome della fase (04/08): una fase puo' avere piu' ricette
     — nei giorni di booster la dose cambia pur restando la stessa fase — e un
     titolo che promette "la dose della Vegetativa" sarebbe falso proprio nel
     giorno in cui i numeri contano di piu'.
     "CONCENTRAZIONE" e non "dosaggio": la card non chiede di dosare, dice
     quanto prodotto c'e' in un litro d'acqua. Il testo non promette una misura
     dell'ultima erogazione, che nessun dato registra: il valore e' la ricetta
     che il piano prevede ADESSO (fase + giorno di fase), quindi coincide con
     la concentrazione reale solo se l'ultima erogazione ha seguito il piano —
     ed e' esattamente cio' che la frase dichiara. I litri escono
     dall'introduttivo e vanno sotto ai millilitri, dove sono il loro "su". */
  const doseTitolo = 'Concentrazione attuale'
  const doseSub = 'La concentrazione prevista dal piano per l’acqua in vasca adesso. Coincide con quella reale se l’ultima erogazione ha seguito il piano.'
  const doseTessere = POMPE.map((p) => ({
    ...p,
    mlL: doseMlL ? doseMlL[p.chiave] : null,
    ml: doseMlVasca(p.chiave),
  }))

  /* ── PROSSIMA AZIONE di dosaggio ──────────────────────────────────────
     Il piano non dice solo la concentrazione di oggi: dice anche QUANDO si
     torna a mettere le mani nella vasca e con quali quantita'. Prima di
     questo riquadro l'unica traccia era la riga "Prossimo booster" — un
     titolo e una data, senza numeri, e solo per i booster.
     FONTE: gli eventi del piano (model), che portano un blocco `dose` in
     ml/L con il `modo`:
       cambio   = vasca svuotata e rifatta → dose PIENA su vasca piena;
       aggiunta = quantita' IN PIU' su quella che c'e' gia' in vasca.
     I MILLILITRI seguono la stessa base dell'ispettore del Piano, perche' per
     lo stesso intervento i due schermi devono dare lo stesso numero (vedi
     `litriDose` in App.jsx): cambio e aggiunta futura sulla CAPACITA' della
     vasca (`vasca.capacita`), aggiunta di OGGI sull'acqua realmente in vasca.
     Per un'aggiunta futura il volume di quel giorno non si conosce: resta il
     caveat da riga (l'(i) su "Intervento"), non da nota.
     Se un evento non porta la dose (piano senza quel blocco) resta comunque
     l'appuntamento: evento e data, senza quantita'. */
  const prossimaAzione = useMemo(() => {
    if (!model || !Array.isArray(model.fasi)) return null
    for (const f of model.fasi) {
      if (!f.valid) continue
      for (const d of f.days) {
        if (d.g < model.oggi) continue
        for (const ev of d.eventi || []) {
          const dose = (ev.piano && ev.piano.dose) || null
          // i booster restano in elenco anche senza blocco dose: sono la
          // sessione che questo riquadro eredita dalla riga di prima
          if (!dose && ev.tipo !== 'booster') continue
          if (ev.done) continue
          return { g: d.g, date: d.date, titolo: ev.titolo, tipo: ev.tipo, dose }
        }
      }
    }
    return null
  }, [model])
  const paCambio = prossimaAzione?.dose?.modo === 'cambio'
  /* BASE dei millilitri, identica a quella dell'ispettore del Piano:
       CAMBIO           -> capacita', perche' dopo il cambio la vasca e' piena
                           ed e' su quel volume che dosa anche la centralina;
       AGGIUNTA di OGGI -> acqua realmente in vasca, che e' quella in cui il
                           prodotto finisce adesso (la lettura di livello vale
                           per oggi, non per un giorno futuro);
       AGGIUNTA FUTURA  -> capacita', perche' il volume di quel giorno non si
                           conosce; lo dice l'(i) della riga "Intervento".
     La seconda riga delle tessere stampa questa base ("X ml su Y L"), quindi
     il volume usato si legge sempre accanto al numero. */
  const paOggi = !!prossimaAzione && prossimaAzione.g === model?.oggi
  const paLitriReali = !paCambio && paOggi && model?.vasca?.litri != null
  const paLitri = paLitriReali ? model.vasca.litri : (model?.vasca?.capacita || null)
  const paQuando = (() => {
    if (!prossimaAzione) return EM
    const gg = prossimaAzione.g - model.oggi
    if (gg <= 0) return `Oggi · g${prossimaAzione.g}`
    if (gg === 1) return `Domani · g${prossimaAzione.g}`
    /* "tra N gg" e non "fra N giorni": la riga sotto ("Prossimo booster")
       arriva gia' formattata cosi' dal sensore, e due attese scritte in due
       modi dentro lo stesso riquadro si leggono come due unita' di misura
       diverse. Il singolare non si corregge ("tra 1 gg") per la stessa
       ragione: la forma la detta il sensore, non la grammatica. */
    return `${dm(prossimaAzione.date)} · g${prossimaAzione.g} (tra ${gg} gg)`
  })()
  const paTessere = prossimaAzione?.dose
    ? POMPE.map((p) => {
      const v = prossimaAzione.dose[p.chiave]
      return {
        ...p,
        mlL: v == null ? null : v,
        ml: (v != null && paLitri) ? Math.round(v * paLitri * 10) / 10 : null,
      }
    })
    : null
  const boosterTxt = has(stOf(entities, ids.booster)) ? stOf(entities, ids.booster) : EM
  const paRows = [
    /* L'(i) porta la differenza fra cambio e aggiunta, che prima stava in una
       nota di coda: nel cambio i millilitri sono il volume esatto, in
       un'aggiunta si sommano a quelle gia' dentro e valgono sull'acqua di
       oggi (se l'intervento e' oggi) o a vasca piena (se e' piu' avanti).
       Caveat da riga, non da paragrafo. */
    {
      i: mdiFlaskOutline, k: 'Intervento', v: prossimaAzione ? prossimaAzione.titolo : EM,
      info: !prossimaAzione?.dose ? null : (paCambio
        ? `Cambio completo: la vasca si svuota e si rifà, quindi vale la dose piena${paLitri ? ` sui ${paLitri} L pieni` : ''}.`
        : paLitriReali
          ? `Aggiunta senza cambio acqua: le quantità si sommano a quelle già in vasca. I millilitri sono calcolati sull’acqua che c’è adesso (${paLitri} L).`
          : `Aggiunta senza cambio acqua: le quantità si sommano a quelle già in vasca. I millilitri valgono a vasca piena${paLitri ? ` (${paLitri} L)` : ''}; con meno acqua vanno ridotti in proporzione.`),
    },
    { i: mdiClockOutline, k: 'Quando', v: paQuando },
    /* La riga che era nel riquadro del piano (04/08): li' era un titolo senza
       numeri in mezzo alle impostazioni della fase, qui sta accanto alla data
       e alle dosi. Si mostra solo quando il prossimo intervento NON e' gia'
       il booster, altrimenti direbbe due volte la stessa sessione. */
    prossimaAzione?.tipo === 'booster' ? null : { i: mdiFlask, k: 'Prossimo booster', v: boosterTxt },
  ]
  const paSub = 'I prossimi interventi previsti dal piano su nutrienti e booster.'

  /* METODO di erogazione: non e' piu' la modalita' del pannello (quella e' il
     segmented in testata), e' come si eroga DENTRO il Pianificato. Si legge da
     model.dosatoriAuto e si cambia in Impostazioni · Componenti. */
  const pompe = model ? !!model.dosatoriAuto : null
  const nutrDeve = [
    // La fase apre il riquadro come nell'Acqua: e' lei a decidere la ricetta.
    {
      i: mdiLeaf, k: 'Fase (dal tracker)', v: faseCur?.label || model?.faseAttuale || EM,
      info: 'Fase corrente della coltivazione: è lei a decidere quale riga del piano vale adesso.',
    },
    {
      i: mdiNeedle, k: 'Erogazione',
      v: pompe == null ? EM : (pompe ? 'Automatica (pompe)' : 'Manuale (siringa)'),
      info: 'Con la siringa la dose è precisa al millilitro; le pompe peristaltiche vanno tarate e sbagliano facilmente di qualcosa.',
      // l'avviso sta ATTACCATO alla riga che lo genera, come la discordanza
      // delle Luci: e' il metodo a essere sconsigliato, non la modalita'.
      after: pompe ? (
        <div className="cc-nota cc-nota--gialla">
          <span>
            Erogazione automatica sconsigliata: le pompe peristaltiche vanno tarate e
            sbagliano facilmente di qualche millilitro. Con la siringa la dose è precisa
            al millilitro.
          </span>
        </div>
      ) : null,
    },
    /* "Prossimo booster" non e' piu' qui (04/08): e' finito nel riquadro
       "Prossima azione", dove ha accanto la data e le quantita'. Qui restava
       una scadenza in mezzo alle impostazioni della fase. */
    {
      i: mdiTestTube, k: 'EC target',
      v: doseEc ? `${String(doseEc).replace('-', ' – ')} mS (dopo pH 5.5 – 6.5)` : EM,
    },
    {
      // stessa formula dell'ispettore del Piano: un solo modo di dirlo
      i: mdiWater, k: 'Acqua', v: '50/50 rubinetto + demineralizzata',
      info: 'Mezza e mezza tiene il calcare basso senza togliere del tutto i minerali che servono.',
    },
  ]
  /* Introduttivo del riquadro, gemello di quello degli altri pannelli ma
     DINAMICO sul metodo: in Pianificato le due strade portano a due giornate
     diverse (un promemoria da eseguire a mano, oppure tre pompe che partono
     da sole), e la frase deve dire quale delle due si sta vivendo. */
  const nutrDeveSub = pompe
    ? 'In modalità Pianificata, al cambio acqua e nei giorni di aggiunta le tre pompe dosano da sole le quantità del piano.'
    : 'In modalità Pianificata, la serra calcola le dosi e mette il promemoria nel Piano al giorno giusto: l’erogazione si fa a mano, niente parte da solo.'
  /* La vecchia nota di coda ("con il dosaggio automatico spento la serra non
     dosa…") non c'e' piu': diceva la stessa cosa dell'introduttivo, che ora la
     dice per tutti e due i metodi. In coda resta solo il rimando a dove si
     cambia il metodo — che vale anche a coltivazione chiusa. */

  /* ── Erogazione ──────────────────────────────────────────────────────
     I tre parametri vivono in altrettanti input_number che lo script legge
     al momento dell'erogazione. Restano in staging locale e si scrivono solo
     se sono stati CAMBIATI: un EROGA che non tocca nulla non lascia dietro
     di se' scritture inutili sugli helper. */
  const dosDurata = numOf(entities, ids.dosDurata)
  const dosVolte = numOf(entities, ids.dosVolte)
  const dosPausa = numOf(entities, ids.dosPausa)
  const [dos, setDos] = useState({ durata: 1, volte: 1, pausa: 1 })
  const [dosTocca, setDosTocca] = useState(false)
  useEffect(() => {
    if (dosTocca || dosDurata == null) return
    setDos({ durata: dosDurata, volte: dosVolte ?? 1, pausa: dosPausa ?? 1 })
  }, [dosDurata, dosVolte, dosPausa, dosTocca])
  const stepDos = (k, d, min, max) => {
    setDosTocca(true)
    setDos((o) => ({ ...o, [k]: Math.round(Math.max(min, Math.min(max, o[k] + d)) * 10) / 10 }))
  }
  const dosCambiati = [
    dosDurata != null && dosDurata !== dos.durata ? [IN_DOS.durata, dos.durata] : null,
    dosVolte != null && dosVolte !== dos.volte ? [IN_DOS.volte, Math.round(dos.volte)] : null,
    dosPausa != null && dosPausa !== dos.pausa ? [IN_DOS.pausa, dos.pausa] : null,
  ].filter(Boolean)

  // Portata: sola lettura, nell'ordine dei tre bottoni (Rossa · Verde · Blu).
  const portate = POMPE.map((p) => numOf(entities, ids[p.cal]))
  const portataTxt = portate.every((x) => x == null) ? EM
    : portate.map((x) => (x == null ? EM : x.toFixed(2))).join(' / ') + ' ml/s'

  /* EROGA: azione fisica e IRREVERSIBILE (il liquido e' uscito) → sempre due
     tocchi, anche col dosaggio automatico acceso (divergenza #10). */
  const eroga = (p) => arma(`nutr:${p.id}`, async () => {
    if (dosCambiati.length) {
      try {
        for (const [ent, val] of dosCambiati) {
          await callService('input_number', 'set_value', { entity_id: ent, value: val })
        }
      } catch (e) {
        say(`Parametri non impostati: ${e.message || e}`)
        return
      }
    }
    try {
      await callService('script', 'turn_on', { entity_id: SCRIPT_NUTR(p.id) })
      say(`Erogazione avviata · ${p.nome} · ${p.nutr} · ${dos.durata} s${dos.volte > 1 ? ` × ${Math.round(dos.volte)}` : ''}`)
      refetch()
    } catch (e) { say(`Erogazione non avviata: ${e.message || e}`) }
  })

  /* ══ PANNELLO LED RING ═══════════════════════════════════════════════
     Il pezzo di valore non e' il comando: e' la LEGENDA. L'anello e' un
     semaforo a priorita' e senza la chiave di lettura un colore non dice
     niente. La cascata qui sotto e' la stessa, nello stesso ordine, di
     script.serra_ring_manager_apply (in serra_mqtt.yaml): se una
     riga si accende qui, e' perche' si accenderebbe anche l'anello. */
  const ringSt = stOf(entities, ids.ringStato)
  const ringHex = stOf(entities, ids.ringColore)
  const ringNome = has(ringHex) ? nomeColore(ringHex) : null
  const ringAcceso = has(ringSt) ? (ringSt !== 'off' && ringNome !== 'spento') : null
  const ringAz = stOf(entities, ids.ringUltimaAz)
  const ringAzQuando = toDate(stOf(entities, ids.ringUltimo))

  // I quattro segnali della cascata. `errore` e' il boolean; se non e'
  // esposto si ripiega sul nome del componente guasto, che invece lo e'.
  const erroreRaw = stOf(entities, ids.errore)
  const errPend = has(erroreRaw) ? isOn(erroreRaw) : has(stOf(entities, ids.erroreComp))
  const boosterDaDare = isOn(stOf(entities, ids.boosterDaDare))
  const intervento = acquaBassa || boosterDaDare
  const inMoto = isOn(stOf(entities, ids.pompaRun))
    || POMPE.some((p) => isOn(stOf(entities, ids[p.run])))
  const giorno = isOn(stOf(entities, ids.luciDaSched))

  /* In LIBERO il semaforo e' sospeso: la legenda resta li' come chiave di
     lettura, ma nessuna riga si accende — dire "ORA" su una regola che in
     questo momento non comanda niente sarebbe una bugia. */
  /* E senza dati non si accende NIENTE: con la centralina muta tutti i
     segnali della cascata leggono "spento", e l'ultima riga rimasta in piedi
     si accenderebbe da sola — l'anello direbbe "tutto in ordine" proprio
     quando non si sa niente. */
  const semNoto = !off && !noData
  const semOn = (c) => semNoto && !manuale && c
  const ringSemaforo = [
    {
      k: 'rosso', lab: 'Rosso · errore da risolvere', col: 'var(--errore)', on: semOn(errPend),
      perche: 'Un comando non è andato a buon fine. Resta rosso finché il componente non riesce da solo o finché non si azzera l’errore.',
    },
    {
      k: 'viola', lab: 'Viola · serve un intervento', col: 'var(--cc-ring)', on: semOn(!errPend && intervento),
      perche: 'Qualcosa aspetta una mano: la vasca da rabboccare oppure il booster da dare.',
    },
    {
      k: 'blu', lab: 'Blu · acqua in movimento', col: 'var(--fase-flush)', on: semOn(!errPend && !intervento && inMoto),
      perche: 'La pompa di ricircolo o una delle tre dosatrici sta lavorando adesso.',
    },
    {
      k: 'bianco',
      lab: (giorno || !coltivazione) ? 'Bianco · tutto in ordine' : 'Bianco attenuato · notte',
      col: (giorno || !coltivazione) ? 'var(--oggi)' : 'var(--fg-3)',
      on: semOn(!errPend && !intervento && !inMoto && coltivazione),
      perche: 'Nessuna delle condizioni sopra: di giorno resta bianco pieno, di notte e in essiccazione si abbassa, perché al buio una luce piena darebbe fastidio alle piante.',
    },
    {
      k: 'spento', lab: 'Spento · nessuna coltivazione', col: 'var(--fg-3)',
      on: semOn(!errPend && !intervento && !inMoto && !coltivazione),
      perche: 'A coltivazione chiusa l’anello si spegne del tutto.',
    },
  ]
  // Riga accesa ADESSO (nessuna in manuale) e riga che il semaforo sceglierebbe
  // comunque: la seconda serve al blocco "da piano", che deve continuare a dire
  // cosa farebbe l'automatismo anche mentre e' sospeso.
  const ringAttiva = ringSemaforo.find((r) => r.on) || null
  const ringAttivaPiano = !semNoto ? null
    : (errPend ? ringSemaforo[0]
      : (intervento ? ringSemaforo[1]
        : (inMoto ? ringSemaforo[2]
          : (coltivazione ? ringSemaforo[3] : ringSemaforo[4]))))

  const ringOra = [
    {
      i: mdiCircleSlice8, k: 'Anello',
      v: (off || ringAcceso == null) ? EM : (ringAcceso ? `Acceso · ${ringNome}` : 'Spento'),
      dot: ringAcceso == null ? null : (ringAcceso ? 'var(--cc-ring)' : 'var(--fg-3)'),
      info: ringAcceso == null
        ? 'Lo stato dell’anello non è fra i dati che la centralina sta comunicando: la riga resta vuota finché il dato non torna.'
        : 'Colore realmente acceso sull’anello, così come lo pubblica la centralina.',
    },
    {
      i: mdiFlagOutline, k: 'Priorità attiva',
      v: !semNoto ? EM : (manuale ? 'Colore fisso' : (ringAttiva ? ringAttiva.lab : EM)),
      dot: manuale ? null : (ringAttiva ? ringAttiva.col : null),
      info: 'Le condizioni del semaforo possono essere accese anche tutte insieme, ma l’anello ne mostra una sola: quella con la priorità più alta. Qui si legge quale sta vincendo adesso. In modalità Libera il semaforo è sospeso e vale il colore impostato a mano.',
    },
  ]

  const ringFadeReale = numOf(entities, ids.ringFade)
  const ringSelReale = stOf(entities, ids.ringSel)
  /* Le prime due righe SPECCHIANO "Com'è ora" (stesse label, stesso ordine,
     stesse icone): a sinistra il colore acceso adesso, qui quello che il
     semaforo sceglierebbe — e continua a dirlo anche mentre e' sospeso. */
  const ringDeve = [
    {
      i: mdiCircleSlice8, k: 'Anello',
      v: !ringAttivaPiano ? EM
        : (ringAttivaPiano.k === 'spento'
          ? 'Spento'
          : `Acceso · ${ringAttivaPiano.lab.split(' · ')[0].toLowerCase()}`),
      dot: !ringAttivaPiano ? null : (ringAttivaPiano.k === 'spento' ? 'var(--fg-3)' : 'var(--cc-ring)'),
      info: 'Il colore che il semaforo accenderebbe in questo momento. È una lettura, non un comando.',
    },
    {
      i: mdiFlagOutline, k: 'Priorità attiva',
      v: ringAttivaPiano ? ringAttivaPiano.lab : EM,
      dot: ringAttivaPiano ? ringAttivaPiano.col : null,
    },
    {
      i: mdiTimerOutline, k: 'Fade', v: ringFadeReale != null ? `${Math.round(ringFadeReale)} s` : EM,
      info: 'Quanto ci mette il colore a cambiare. Lo spegnimento invece è sempre secco: in dissolvenza resterebbe acceso un filo di luce.',
    },
  ]

  // Comandi: colore fisso + fade, poi lo script che li legge dagli helper.
  const [ringCol, setRingCol] = useState('Bianco')
  const [ringFadeS, setRingFadeS] = useState(0)
  const [ringTocca, setRingTocca] = useState(false)
  useEffect(() => {
    if (ringTocca) return
    if (has(ringSelReale) && RING_COLORI.includes(ringSelReale)) setRingCol(ringSelReale)
    if (ringFadeReale != null) setRingFadeS(Math.max(0, Math.min(30, Math.round(ringFadeReale))))
  }, [ringSelReale, ringFadeReale, ringTocca])
  /* ULTIMO INVIO FA FEDE — stesso schema di applicaMix delle Luci.
     Il colore acceso lo pubblica il bridge (sensor.serra_ring_color) e arriva
     col ritardo del duty-cycle: finche' quel valore non si MUOVE da dov'era
     quando abbiamo inviato, fa fede l'ultimo invio. Il confronto e' sulla
     COPPIA colore+fade, perche' e' la coppia che lo script applica.
     Lo "spento" e' un valore come gli altri in questa memoria: cosi' due
     Spegni di fila dicono "gia' spento" senza rimandare il comando.
     NB il SEMAFORO non entra qui: quella e' lettura di stato: dice cosa
     comanderebbe l'automatismo, non cosa abbiamo inviato noi. */
  const ultimoRingRef = useRef(null)
  const ringEffettivo = () => {
    const u = ultimoRingRef.current
    const realtaFerma = u && (!ringNome || (u.realeAllora && ringNome === u.realeAllora))
    return realtaFerma
      ? { nome: u.nome, fade: u.fade }
      : { nome: ringNome, fade: ringFadeReale == null ? null : Math.round(ringFadeReale) }
  }
  const ricordaRing = (nome, fade) => {
    ultimoRingRef.current = { nome, fade, realeAllora: ringNome || null }
  }

  const applicaRing = () => arma('ring:apply', async () => {
    const eff = ringEffettivo()
    // fade sconosciuto (null) = DIVERSO, non "coincidente": trattarlo come
    // uguale farebbe cadere nel silenzio un cambio del solo fade
    if (eff.nome === ringCol.toLowerCase() && eff.fade === ringFadeS) {
      say('Colore non cambiato: era già impostato così')
      return
    }
    try {
      await callService('input_select', 'select_option', { entity_id: IN_RING_COL, option: ringCol })
      await callService('input_number', 'set_value', { entity_id: IN_RING_FADE, value: ringFadeS })
    } catch (e) {
      say(`Colore non impostato: ${e.message || e}`)
      return
    }
    try {
      await callService('script', 'turn_on', { entity_id: SCRIPT_RING_APPLY })
      ricordaRing(ringCol.toLowerCase(), ringFadeS)
      say(`Anello su ${ringCol.toLowerCase()}${ringFadeS ? ` · fade ${ringFadeS} s` : ''}`)
      refetch()
    } catch (e) { say(`Colore non applicato: ${e.message || e}`) }
  })

  const spegniRing = () => arma('ring:off', async () => {
    if (ringEffettivo().nome === 'spento') {
      say('Anello già spento')
      return
    }
    try {
      await callService('script', 'turn_on', { entity_id: SCRIPT_RING_OFF })
      // il fade non c'entra: lo spegnimento e' sempre secco (-f 0)
      ricordaRing('spento', null)
      say('Anello spento')
      refetch()
    } catch (e) { say(`Spegnimento non riuscito: ${e.message || e}`) }
  })

  /* ── Lampeggio ───────────────────────────────────────────────────────
     C'e' perche' c'e' nel design, con la nota che ne sconsiglia l'uso: il
     motivo e' scritto nel yaml, in testa a script.serra_ring_blink_apply, e
     non e' un parere. Colore e
     fade sono gli STESSI del colore fisso — lo script legge gli stessi due
     helper — quindi il blocco ha solo i tre parametri suoi. */
  const blinkVolteR = numOf(entities, ids.blinkVolte)
  const blinkDurataR = numOf(entities, ids.blinkDurata)
  const blinkPausaR = numOf(entities, ids.blinkPausa)
  const [blink, setBlink] = useState({ volte: 3, durata: 1, pausa: 1 })
  const [blinkTocca, setBlinkTocca] = useState(false)
  useEffect(() => {
    if (blinkTocca || blinkVolteR == null) return
    setBlink({ volte: blinkVolteR, durata: blinkDurataR ?? 1, pausa: blinkPausaR ?? 1 })
  }, [blinkVolteR, blinkDurataR, blinkPausaR, blinkTocca])
  const stepBlink = (k, d, min, max) => {
    setBlinkTocca(true)
    setBlink((o) => ({ ...o, [k]: Math.max(min, Math.min(max, o[k] + d)) }))
  }
  const avviaBlink = () => arma('ring:blink', async () => {
    try {
      // colore e fade li condivide col colore fisso: si scrivono comunque,
      // perche' il lampeggio deve uscire del colore che si vede sopra
      await callService('input_select', 'select_option', { entity_id: IN_RING_COL, option: ringCol })
      await callService('input_number', 'set_value', { entity_id: IN_RING_FADE, value: ringFadeS })
      await callService('input_number', 'set_value', { entity_id: IN_BLINK.volte, value: Math.round(blink.volte) })
      await callService('input_number', 'set_value', { entity_id: IN_BLINK.durata, value: Math.round(blink.durata) })
      await callService('input_number', 'set_value', { entity_id: IN_BLINK.pausa, value: Math.round(blink.pausa) })
    } catch (e) {
      say(`Lampeggio non impostato: ${e.message || e}`)
      return
    }
    try {
      await callService('script', 'turn_on', { entity_id: SCRIPT_RING_BLINK })
      say(`Lampeggio avviato · ${Math.round(blink.volte)}× ${Math.round(blink.durata)} s`)
      refetch()
    } catch (e) { say(`Lampeggio non avviato: ${e.message || e}`) }
  })

  /* ── testata: sottotitolo per pannello ──────────────────────────────
     Stessa forma del design (`updated`, r.398/406/423/438/456): QUANDO sono
     i dati, e cos'e' l'ultima cosa che quel sottosistema ha fatto. E' un
     dato sul pannello intero: nel blocco "com'e' ora" starebbe fra le cose
     che la serra sta facendo adesso, che e' un'altra categoria. */
  const quando = fresco ? `Dati delle ${fresco.ora}` : 'In attesa di dati'
  /* L'azione arriva dal firmware col suo verbo grezzo ('mix', 'on', …):
     qui si traduce in italiano. Un verbo nuovo non mappato passa com'e',
     cosi' si vede e si aggiunge — meglio grezzo che sparito. */
  const AZ_LAB = { mix: 'colore applicato', on: 'accensione', off: 'spegnimento', sunrise: 'alba', alba: 'alba', sunset: 'tramonto', tramonto: 'tramonto', blink: 'lampeggio', apply: 'colore applicato' }
  const azLab = (raw, extra) => { const k = String(raw ?? '').toLowerCase(); return (extra && extra[k]) || AZ_LAB[k] || raw }
  const coda = {
    /* "ultima AZIONE", non "ultimo comando": qui si racconta cosa e'
       cambiato sul pannello — e un'accensione all'alba non l'ha comandata
       nessuno. Vale per entrambi i rami, cosi' la label non balla a seconda
       di quale dei due dati e' arrivato. */
    luci: luciAzione
      ? `Ultima azione: ${luciAzione.ev}${luciAzione.quando ? ` (${whenBreve(luciAzione.quando)})` : ''}`
      : (has(luciAz) || luciAzQuando)
        ? `Ultima azione: ${has(luciAz) ? azLab(luciAz) : '—'}${luciAzQuando ? ` (${whenBreve(luciAzQuando)})` : ''}` : null,
    // per la pompa on/off si leggono meglio come avvio/stop
    acqua: has(stOf(entities, ids.pompaUltimaAz)) ? `Ultimo comando pompa: ${azLab(stOf(entities, ids.pompaUltimaAz), { on: 'avvio', off: 'stop' })}` : null,
    // NIENTE coda per i nutrienti (04/08): l'ultima erogazione e' diventata
    // una riga di "Com'è ora", e ripeterla in testata la scriveva due volte a
    // due centimetri di distanza.
    nutrienti: null,
    ventole: faseCur?.label ? `Soglie dalla fase ${faseCur.label}` : null,
    ring: (has(ringAz) || ringAzQuando)
      ? `Ultimo comando: ${has(ringAz) ? azLab(ringAz) : '—'}${ringAzQuando ? ` (${whenBreve(ringAzQuando)})` : ''}` : null,
  }[compSel.k]
  const sottotitolo = coda ? `${quando} · ${coda}` : quando

  // Guida: si apre solo dove una guida esiste davvero in www/guide/.
  const guidaDi = { acqua: GUIDA_ACQUA, ventole: GUIDA_VENTOLE, nutrienti: GUIDA_NUTRIENTI }[compSel.k] || null
  const guidaTxt = {
    acqua: 'Come funzionano ricircoli e allarme acqua bassa',
    ventole: 'Come si leggono clima e VPD',
    nutrienti: 'Come si prepara il cambio acqua con i nutrienti',
  }[compSel.k] || ''
  const pronto = true   // tutti e cinque i pannelli sono costruiti

  /* ══════════════════════════════════════════════════════════════════ */
  return (
    <section className={'cc-root' + (attiva ? '' : ' sez-off')} style={{ '--cc-dim': dim }} aria-label="Controllo">
      <div className="cc-scroll" data-sez-scroll="1">
        {/* ── rail delle 5 chip ──
            data-sez-band: e' la fascia ferma della sezione (sticky in cima
            allo scroller, vedi controllo.css) — il contenuto le passa sotto
            e da lei emanano hairline e ombra (App.jsx, .sc-under).
            Sta PRIMA della nota di blocco proprio per questo: se avesse
            qualcosa sopra, l'ombra si accenderebbe al primo pixel di scroll
            mentre il rail e' ancora a meta' strada dal bordo. */}
        <div className="cc-rail" data-sez-band="1" role="tablist" aria-label="Sottosistemi">
          {chips.map((c) => (
            /* niente fumettino: la chip scrive gia' label, stato e modalita',
               e su mobile e' un tile-icona che apre un pannello che si spiega da se' */
            <button key={c.k} type="button" role="tab" aria-selected={c.on} aria-label={c.label}
              className={'cc-chip' + (c.on ? ' on' : '')}
              style={{ '--cc-accent': c.accent, '--cc-soft': c.soft }}
              onClick={() => onFocus && onFocus(c.k)}>
              {/* fondo e colore icona vengono dal CSS (--cc-accent), non da
                  uno style inline: su mobile il tile diventa pieno e l'icona
                  cambia colore con la selezione — vedi controllo.css */}
              <span className="cc-chip-disc">
                <Icon path={c.icon} size={19} color="currentColor" />
              </span>
              <span className="cc-chip-txt">
                <span className="cc-chip-lab">{c.label}</span>
                <span className="cc-chip-sub" style={{ opacity: dim }}>{c.stato}</span>
              </span>
              {c.badge && <span className={'cc-badge' + (c.man ? ' man' : '')}>{c.badge}</span>}
              {/* badge iOS-like: compare SOLO su mobile (tile a sola icona) e
                  solo in modalita' Libera — vedi .cc-chip-m in controllo.css */}
              {c.man && <span className="cc-chip-m" aria-hidden="true">L</span>}
            </button>
          ))}
        </div>

        {blockNote && (
          <div className="cc-block" role="status">
            <Icon path={blockIcon} size={19} color="var(--fg-3)" />
            <span>{blockNote}</span>
          </div>
        )}

        {/* ── pannello selezionato ── */}
        <div className={'cc-panel' + (compSel.hero ? ' cc-panel--hero' : '')}
          style={{ '--cc-accent': compSel.accent, '--cc-soft': compSel.soft, '--cc-hero': compSel.hero || compSel.accent }}>
          <div className="cc-head">
            {/* sulla fascia a gradiente il disco e' un quadrato chiaro con
                l'icona scura (design r.~370 dello snapshot), non un disco
                pieno di accento: sopra il gradiente svanirebbe */}
            <span className="cc-head-disc" style={{ background: compSel.dark ? 'var(--w-30)' : compSel.accent }}>
              <Icon path={compSel.icon} size={22} color="var(--ink)" />
            </span>
            <div className="cc-head-txt">
              <span className="cc-head-lab">{compSel.label}</span>
              <span className="cc-head-sub">{sottotitolo}</span>
            </div>
            {pronto && (
              <>
                {guidaDi && (
                  <Hint text={guidaTxt}>
                    <button type="button" className="cc-guida" onClick={() => onGuida && onGuida(guidaDi)}>
                      <Icon path={mdiBookOpenVariant} size={19} />
                    </button>
                  </Hint>
                )}
                <div className="cc-modo" role="group" aria-label={`Modalità ${compSel.label}`}>
                  {[[true, 'Pianificato'], [false, 'Libero']].map(([auto, lab]) => {
                    const attivo = autoSel === auto
                    const armato = armed === (auto ? 'auto' : 'man')
                    return (
                      <Hint key={lab}
                        text={blocked
                          ? blockNote
                          : (attivo
                            ? (auto ? modoCfg.attivaAuto : modoCfg.attivaMan)
                            : (armato ? '' : (auto ? modoCfg.vaiAuto : modoCfg.vaiMan)))}>
                        <button type="button"
                          className={'cc-modo-b' + (attivo ? ' on' : '') + (armato ? ' arm' : '')}
                          aria-pressed={attivo}
                          disabled={blocked || busy || attivo || autoSel == null}
                          onClick={() => setModo(auto)}>
                          {armato ? 'Confermare?' : lab}
                        </button>
                      </Hint>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* ══ ACQUA ══ */}
          {compSel.k === 'acqua' && (
            <div className="cc-cols">
              <BoxOra dim={dim} off={off} rows={acquaOra} sub={subOra(manuale)}>
                {acquaBassa && (
                  <div className="cc-nota cc-nota--gialla">
                                        <span>Vasca sotto la soglia: i ricircoli automatici restano sospesi fino al rabbocco.</span>
                  </div>
                )}
              </BoxOra>

              <BoxDeve manuale={manuale} spenta={!coltivazione} rows={acquaDeve}
                titolo="Pianificato · Gestito dal piano"
                /* due righe come l'introduttivo di "Com'è ora": e' quello che
                   tiene le due colonne di righe sulla stessa quota */
                sub="In modalità Pianificata, i ricircoli partono agli orari e per la durata del piano. Senza una coltivazione in corso la pompa resta ferma.">
                {/* NIENTE meta-note (regola 02/08): la UI non spiega i propri
                    limiti ne' cita path di configurazione. Restano solo le note
                    di COMPORTAMENTO, che sono informazione. */}
                <div className="cc-nota">{acquaDeveNota}</div>
              </BoxDeve>

              <BoxMan manuale={manuale} blocked={blocked} blockNote={blockNote}
                autoNoto={autoSel != null} perche={modoCfg.perche}>
                {/* GERARCHIA come nel pannello Luci: titoletto di sezione,
                    cosi' l'introduttivo del box non si fonde con i comandi.
                    Il filetto sopra non serve: sotto l'introduttivo c'e' gia'
                    quello a piena larghezza del riquadro. Una sezione sola:
                    durata e i due bottoni sono lo stesso gesto. */}
                <div className="cc-sez">
                  <Icon path={mdiWaterSync} size={16} color="var(--fg-3)" />
                  <span>Ricircolo</span>
                </div>
                <Stepper lab="Durata" icon={mdiTimerOutline} val={durata} unit="s"
                  min={DUR_MIN} max={DUR_MAX} step={DUR_STEP}
                  disabled={!manuale || blocked} onStep={stepDur} />
                <div className="cc-nota cc-nota--fine">
                  {durPiano && !durataTocca
                    ? `Proposta la durata del piano per la fase in corso (${durPiano} s).`
                    : `Da ${DUR_MIN} a ${DUR_MAX} s. La pompa si ferma da sola a fine tempo.`}
                </div>

                {/* i due comandi, entrambi armati in due tap */}
                <div className="cc-chips">
                  {/* da abilitato il bottone dice gia' tutto (titolo + "Per N s"):
                      il fumettino resta solo per spiegare PERCHE' e' bloccato */}
                  <Hint text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                    {/* CTA primaria: dal design e' un CONTORNO accent su fondo
                        scuro (titolo bianco, play accent), non un pieno. Lo
                        "Stop" resta il contorno rosso: e' il freno. */}
                    <button type="button" className={'cc-cmd cc-cmd--go' + (armed === 'ric' ? ' arm' : '')}
                      disabled={!manuale || blocked || busy} onClick={avviaRicircolo}>
                      <span className="cc-cmd-ic"><Icon path={mdiPlayCircle} size={19} /></span>
                      <span className="cc-cmd-txt">
                        <b>{armed === 'ric' ? 'Confermare il ricircolo?' : 'Avvia ricircolo'}</b>
                        <i>Per {durata} s</i>
                      </span>
                    </button>
                  </Hint>
                  <Hint text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                    <button type="button" className={'cc-cmd' + (armed === 'stop' ? ' arm' : '')}
                      disabled={!manuale || blocked || busy}
                      onClick={() => lanciaScript('stop', SCRIPT_POMPA_OFF, 'Stop inviato alla pompa')}>
                      <Icon path={mdiStopCircleOutline} size={19} />
                      <span className="cc-cmd-txt">
                        <b>{armed === 'stop' ? 'Confermare lo stop?' : 'Stop pompa'}</b>
                        <i>Ferma subito la pompa</i>
                      </span>
                    </button>
                  </Hint>
                </div>
              </BoxMan>
            </div>
          )}

          {/* ══ LUCI ══ */}
          {compSel.k === 'luci' && (
            <div className="cc-cols cc-cols--start">
              {/* la nota di discordanza non e' piu' qui in fondo: viaggia con
                  la riga "Da schedule ora" (campo `after`) */}
              {/* Intro gemella di quella del riquadro Pianificato (righe
                  allineate fra i due box): il testo vive in subOra, uguale
                  parola per parola su tutti i pannelli. */}
              <BoxOra dim={dim} off={off} rows={luciOra} sub={subOra(manuale)} />

              <BoxDeve manuale={manuale} spenta={!coltivazione} rows={luciDeve}
                titolo="Pianificato · Gestito dal piano"
                sub="In modalità Pianificata, le luci seguono la programmazione prevista dal piano. Se non c'è una coltivazione in corso, le luci rimangono spente."
                /* Wayfinding, non meta-nota. REGOLA (02/08): un rimando a
                   un'altra sezione dell'app si OFFRE come link — dirlo e
                   basta lascerebbe all'utente il lavoro di cercarla. Resta
                   anche a coltura chiusa: e' li' che si prepara la prossima. */
                sempre={(
                  <div className="cc-nota">
                    Alba e ciclo si impostano in{' '}
                    <button type="button" className="cc-link" onClick={() => onNav && onNav('imp')}>
                      Impostazioni · Coltivazione
                    </button>.
                  </div>
                )} />

              {/* TUTTO il manuale sta QUI DENTRO e SEMPRE VISIBILE: preset,
                  cursori, applica. Niente sezione a scomparsa — i
                  cursori sono il seguito naturale del preset appena premuto,
                  nasconderli dietro un chevron spezza il gesto in due. */}
              <BoxMan manuale={manuale} blocked={blocked} blockNote={blockNote}
                autoNoto={autoSel != null} perche={modoCfg.perche}>
                {/* GERARCHIA (affinamento Alberto 03/08): titoletto di
                    sezione, cosi' l'introduttivo del box non si fonde con la
                    caption dei preset. Il filetto sopra e' gia' quello a
                    piena larghezza che chiude l'introduttivo. */}
                <div className="cc-sez">
                  <Icon path={mdiPalette} size={16} color="var(--fg-3)" />
                  <span>Preset</span>
                </div>
                {/* caption, testo esatto del design (r.418) */}
                <div className="cc-nota cc-nota--fine">
                  I preset impostano i cursori qui sotto; poi si conferma con “Applica colore”.
                </div>
                {/* I NOVE TILE, tutti nello stesso stile e nella stessa griglia.
                    Alba e Tramonto sono azioni (armate), gli altri sette
                    preparano i cursori: si distinguono da cosa fanno, non da
                    come sono vestiti. */}
                <div className="cc-presets">
                  {luciTile.map((p) => {
                    const armato = armed === p.id
                    return (
                      <Hint key={p.id} text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                        <button type="button" className={'cc-preset' + (armato ? ' arm' : '')}
                          style={{ '--preset': p.col }}
                          disabled={!manuale || blocked || busy}
                          onClick={() => (p.azione ? p.run() : (p.mix && stagePreset(p.mix)))}>
                          <Icon path={p.icon} size={18} color={armato ? 'var(--ink)' : (p.ic || p.col)} />
                          <span className="cc-preset-txt">
                            <b>{armato ? 'Confermare?' : p.lab}</b>
                            <i>{armato ? p.lab : p.sub}</i>
                          </span>
                        </button>
                      </Hint>
                    )
                  })}
                </div>

                {/* ── Regola i singoli canali ── */}
                <div className="cc-sep" />
                <div className="cc-sez">
                  <Icon path={mdiTuneVertical} size={16} color="var(--fg-3)" />
                  <span>Regola i singoli canali</span>
                </div>
                <div className="cc-sliders">
                  {CH_ORDER.map((k) => (
                    <label key={k} className="cc-slider">
                      {/* PALLINO del canale: e' il colore che quel LED fa
                          davvero. Gli unici valori esadecimali dell'app (mappa
                          §7: "extra hardcoded solo i dot canali/pompe") —
                          identificano un pezzo di hardware, non uno stato, e
                          nessun token li rappresenta (il rosso profondo D non
                          esiste in palette). */}
                      <i className="cc-slider-dot" style={{ background: CH_COL[k] }} />
                      <span className="cc-slider-lab">{CH_NOME[k]}</span>
                      <input type="range" min="0" max="100" step="1" value={luciCh[k] || 0}
                        style={{ '--fill': `${Math.round(luciCh[k] || 0)}%` }}
                        disabled={!manuale || blocked}
                        onChange={(e) => setCh(k, +e.target.value)} />
                      <span className="cc-slider-val mono">{Math.round(luciCh[k] || 0)}%</span>
                    </label>
                  ))}
                </div>
                <div className="cc-riga-sep">
                  <Stepper lab="Fade" icon={mdiTimerOutline} val={luciFade} unit="s"
                    min={0} max={120} step={5} disabled={!manuale || blocked} onStep={stepFadeLuci} />
                </div>
                <div className="cc-chips cc-chips--uno">
                  <Hint text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                    {/* CTA col suo accento: nel design "Applica colore" e'
                        VERDE (accent `media`), non ambra come il pannello. */}
                    <button type="button" className="cc-cmd cc-cmd--go cc-cmd--center"
                      style={{ '--cc-accent': 'var(--verde)' }}
                      disabled={!manuale || blocked || busy} onClick={applicaMix}>
                      <span className="cc-cmd-ic"><Icon path={mdiPlayCircle} size={19} /></span>
                      <span className="cc-cmd-txt">
                        <b>Applica colore</b>
                        {/* mix COMPLETO in mono, come nel design: tutti e cinque
                            i canali, zeri compresi — qui serve il confronto
                            esatto con quello che si vede sui cursori */}
                        <i className="mono">{CH_ORDER.map((k) => `${CH_LAB[k]}${Math.round(luciCh[k] || 0)}`).join(' · ')}</i>
                      </span>
                    </button>
                  </Hint>
                </div>

                {/* la REGOLAZIONE della rampa vive in Impostazioni (decisione
                    Alberto): qui resta solo la riga informativa nel "da piano". */}
                <div className="cc-nota cc-nota--fine">
                  Alba e tramonto chiedono un secondo tocco di conferma. “Applica colore”
                  no: parte al primo.
                </div>
              </BoxMan>
            </div>
          )}

          {/* ══ VENTOLE ══ */}
          {compSel.k === 'ventole' && (
            <div className="cc-cols cc-cols--start">
              <BoxOra dim={dim} off={off} rows={ventoleOra} sub={subOra(manuale)} />

              <BoxDeve manuale={manuale} spenta={!coltivazione} rows={ventoleDeve}
                titolo="Pianificato · Gestito dal piano"
                /* Introduttivo tenuto alla stessa altezza di quello di "Com'è
                   ora" (due righe): con altezze diverse le prime righe dei due
                   riquadri partono sfalsate e il confronto a coppie si perde. */
                sub="In modalità Pianificata, le ventole salgono sulle soglie della fase, con le pause del riposo anti-usura. Senza una coltivazione restano ferme."
                /* REGOLA LINK: un rimando a un'altra sezione si OFFRE come
                   link, e dentro la bolla di un Hint un link non puo' stare.
                   In `sempre`: il livello si sceglie anche a serra ferma. */
                sempre={(
                  <div className="cc-nota">
                    Il livello automatico si sceglie in{' '}
                    <button type="button" className="cc-link" onClick={() => onNav && onNav('imp')}>
                      Impostazioni · Componenti
                    </button>.
                  </div>
                )}>
                <div className="cc-nota">{ventoleDeveNota}</div>
              </BoxDeve>

              <BoxMan manuale={manuale} blocked={blocked} blockNote={blockNote}
                autoNoto={autoSel != null} perche={modoCfg.perche}>
                {/* GERARCHIA come nel pannello Luci: titoletto di sezione (il
                    filetto sopra e' quello dell'introduttivo). */}
                <div className="cc-sez">
                  <Icon path={mdiSpeedometer} size={16} color="var(--fg-3)" />
                  <span>Livelli</span>
                </div>
                {/* Quattro righe a segmenti: il segmento acceso e' lo STATO
                    REALE, non una scelta in sospeso. Prima riga separata da
                    hairline: e' il derivato, non una ventola. */}
                <div className="cc-segs">
                  {ventRighe.map((r) => (
                    <div key={r.k} className={'cc-seg-r' + (r.k === 'all' ? ' der' : '')}>
                      <span className="cc-seg-lab">
                        {r.lab}
                        {r.sub && <em>{r.sub}</em>}
                        {r.k === 'all' && (
                          <RowInfo text="Livello complessivo calcolato dalla serra dai tre singoli. Premendo un segmento vanno tutte a quel livello: partono solo i comandi per quelle che devono davvero cambiare." />
                        )}
                      </span>
                      <div className="cc-seg" role="group" aria-label={`Livello ${r.lab}`}>
                        {LIVELLI.map((l) => {
                          const attivo = has(r.ora) && r.ora === l
                          const armato = armed === `vent:${r.k}:${l}`
                          // da armato il segmento dice gia' "Confermare?": il
                          // fumettino non ha niente da aggiungere
                          return (
                            <Hint key={l}
                              text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                              <button type="button"
                                className={'cc-seg-b' + (attivo ? ' on' : '') + (armato ? ' arm' : '')}
                                aria-pressed={attivo}
                                disabled={!manuale || blocked || busy}
                                onClick={() => setLivello(r.k, l)}>
                                {armato ? 'Confermare?' : LIVELLO_LAB[l]}
                              </button>
                            </Hint>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cc-nota cc-nota--fine">
                  Le azioni fisiche chiedono un secondo tocco di conferma.
                </div>
              </BoxMan>
            </div>
          )}

          {/* ══ NUTRIENTI ══ */}
          {compSel.k === 'nutrienti' && (
            <div className="cc-cols cc-cols--start">
              {/* Colonna 1: le tre pompe, poi una CARD A PARTE con la dose di
                  fase in tre tessere (design r.442-443). La dose non e' una
                  riga di stato: e' una tabella di tre numeri da confrontare,
                  e in tre tessere affiancate si legge in un colpo. */}
              <div className="cc-colonna">
                <BoxOra dim={dim} off={off} rows={nutrOra} sub={subOra(manuale)} />
                <div className="cc-box cc-dosi">
                  <div className="cc-box-head">
                    <Icon path={mdiFlaskOutline} size={15} color="var(--cc-accent)" />
                    <span className="cc-box-t">{doseTitolo}</span>
                  </div>
                  {/* stesso vestito "a citazione" degli introduttivi dei tre
                      riquadri: i litri della vasca stavano nel titolo, qui
                      hanno spazio per dire anche che la card non chiede niente */}
                  <div className="cc-box-sub">{doseSub}</div>
                  <div className="cc-sep cc-sep--full" />
                  <div className="cc-dosi-g">
                    {doseTessere.map((t) => (
                      <div key={t.id} className="cc-dosi-t" style={{ '--pompa': t.colore }}>
                        <span className="cc-dosi-n">
                          <i className="cc-dot" style={{ background: t.colore }} />
                          {t.nutr}
                        </span>
                        <b>{t.mlL != null ? `${t.mlL} ml/L` : EM}</b>
                        {/* "8.1 ml su 4.5 L": il millilitro da solo non dice
                            su quanta acqua, e i litri erano finiti in una
                            parentesi dell'introduttivo, lontani dal numero
                            che qualificano. Forma asciutta: nessun'altra
                            parola, ci sta anche su mobile. */}
                        <i>{t.ml != null ? `${t.ml} ml${doseLitri ? ` su ${doseLitri} L` : ''}` : EM}</i>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Colonna 2: il piano e, sotto, l'appuntamento successivo —
                  stessa impaginazione della colonna 1 (un riquadro di
                  cornice e una card a parte per i numeri). */}
              <div className="cc-colonna">
              <BoxDeve manuale={manuale} spenta={!coltivazione} rows={nutrDeve}
                titolo="Pianificato · Gestito dal piano"
                sub={nutrDeveSub}
                /* REGOLA LINK: il metodo si cambia altrove, e il rimando si
                   OFFRE come link. Sta in `sempre` perche' vale anche a
                   coltura chiusa — e' li' che si prepara la prossima.
                   La destinazione e' "Componenti" e non "Coltivazione": lo
                   switch dell'erogazione automatica vive li', insieme alla
                   taratura delle pompe che ne e' figlia (stessa meta' del
                   link sulle portate, in fondo al riquadro Libero). */
                sempre={(
                  <div className="cc-nota">
                    Il metodo di erogazione si cambia in{' '}
                    <button type="button" className="cc-link" onClick={() => onNav && onNav('imp')}>
                      Impostazioni · Componenti
                    </button>.
                  </div>
                )} />

              {/* PROSSIMA AZIONE — l'appuntamento successivo con la vasca.
                  Stessa VELATURA del riquadro "Pianificato" (.cc-box--deve:
                  velo dell'accento + bordo --cc-soft): anche questo e' roba
                  che il piano decide da se', e sotto al Pianificato si legge
                  come la sua continuazione — l'oggi e il poi della stessa
                  automazione. Senza coltura si spegne come lui (.spenta):
                  la stessa frase in due riquadri gemelli non puo' stare una
                  volta grigia e una volta accesa. */}
              <div className={'cc-box cc-box--deve' + (coltivazione ? '' : ' spenta')}>
                <div className="cc-box-head">
                  <Icon path={mdiCalendarClock} size={15} color="var(--cc-accent)" />
                  <span className="cc-box-t">Prossima azione</span>
                </div>
                {/* Senza coltura l'introduttivo sparisce insieme al contenuto,
                    come nel riquadro del piano: annunciare un intervento sopra
                    a un riquadro che non ne ha e' peggio che tacere. */}
                {!coltivazione ? (
                  <div className="cc-nota">Non c’è una coltivazione in corso: questo riquadro si popola all’avvio di una coltura.</div>
                ) : !prossimaAzione ? (
                  <>
                    <div className="cc-box-sub">{paSub}</div>
                    <div className="cc-sep cc-sep--full" />
                    <div className="cc-nota">Il piano non prevede altri interventi sui nutrienti in questa coltura.</div>
                  </>
                ) : (
                  <>
                    <div className="cc-box-sub">{paSub}</div>
                    <div className="cc-sep cc-sep--full" />
                    <Righe rows={paRows} colore="var(--cc-accent)" />
                    {paTessere && (
                      <>
                        <div className="cc-dosi-g">
                          {paTessere.map((t) => (
                            <div key={t.id} className="cc-dosi-t" style={{ '--pompa': t.colore }}>
                              <span className="cc-dosi-n">
                                <i className="cc-dot" style={{ background: t.colore }} />
                                {t.nutr}
                              </span>
                              {/* il "+" NON e' decorazione: in un'aggiunta la
                                  quantita' si somma a quella gia' in vasca,
                                  in un cambio e' la dose intera */}
                              <b>{t.mlL != null ? `${paCambio ? '' : '+'}${t.mlL} ml/L` : EM}</b>
                              {/* stessa seconda riga della card accanto
                                  ("8.1 ml su 4.5 L"), stessa classe: il ml/L
                                  da solo non dice quanto prodotto va messo.
                                  Si scrive anche quando manca (EM), cosi' le
                                  tre tessere restano della stessa altezza. */}
                              <i>{t.ml != null ? `${t.ml} ml${paLitri ? ` su ${paLitri} L` : ''}` : EM}</i>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              </div>

              <BoxMan manuale={manuale} blocked={blocked} blockNote={blockNote}
                autoNoto={autoSel != null} perche={modoCfg.perche}>
                {/* GERARCHIA come negli altri quattro pannelli: titoletto di
                    sezione CON icona (.cc-sez). Era l'ultimo .cc-adv-sez
                    rimasto, un titoletto di seconda classe in mezzo a quattro
                    di prima. */}
                <div className="cc-sez">
                  <Icon path={mdiPump} size={16} color="var(--fg-3)" />
                  <span>Erogazione</span>
                </div>
                <Stepper lab="Durata erogazione" icon={mdiTimerOutline} val={dos.durata} unit="s"
                  min={0.5} max={10} step={0.5} disabled={!manuale || blocked} onStep={(d) => stepDos('durata', d, 0.5, 10)} />
                <Stepper lab="Ripetizioni" icon={mdiSync} val={Math.round(dos.volte)} unit=""
                  min={1} max={10} step={1} disabled={!manuale || blocked} onStep={(d) => stepDos('volte', d, 1, 10)} />
                <Stepper lab="Pausa tra ripetizioni" icon={mdiTimerSand} val={dos.pausa} unit="s"
                  min={1} max={10} step={1} disabled={!manuale || blocked} onStep={(d) => stepDos('pausa', d, 1, 10)} />
                {/* sola lettura: la taratura si fa in Impostazioni, qui serve
                    solo sapere quanto butta ogni pompa */}
                <div className="cc-row cc-row--sola">
                  <Icon path={mdiScaleBalance} size={17} color="var(--fg-3)" />
                  <span className="cc-row-k">
                    Portata pompe
                    <RowInfo text="Millilitri al secondo di ciascuna pompa, nell’ordine Rossa · Verde · Blu. Si misura con una bilancia sotto il gocciolatore; una portata a zero vuol dire pompa fuori uso." />
                  </span>
                  <span className="cc-row-v mono">{portataTxt}</span>
                </div>
                {/* REGOLA LINK: il rimando esce dalla bolla e diventa link */}
                <div className="cc-nota cc-nota--fine">
                  Le portate si tarano in{' '}
                  <button type="button" className="cc-link" onClick={() => onNav && onNav('imp')}>
                    Impostazioni · Componenti
                  </button>.
                </div>
                <div className="cc-nota cc-nota--fine">
                  Ogni EROGA esegue {dos.durata} s × {Math.round(dos.volte)} sulla pompa scelta.
                  Il liquido uscito non torna indietro: per questo serve la conferma.
                </div>
                {/* I tre EROGA seguono la mappa colore→pompa e nessun'altra:
                    il colore del bottone E' l'identificazione del tubo. */}
                <div className="cc-eroga">
                  {POMPE.map((p) => (
                    <Hint key={p.id} text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                      <button type="button" className={'cc-dose' + (armed === `nutr:${p.id}` ? ' arm' : '')}
                        style={{ '--pompa': p.colore }}
                        disabled={!manuale || blocked || busy} onClick={() => eroga(p)}>
                        <Icon path={mdiPlayCircle} size={19} />
                        <b>{armed === `nutr:${p.id}` ? 'Confermare?' : 'EROGA'}</b>
                        <span>{p.nome} · {p.nutr}</span>
                      </button>
                    </Hint>
                  ))}
                </div>
              </BoxMan>
            </div>
          )}

          {/* ══ LED RING ══ */}
          {compSel.k === 'ring' && (
            <div className="cc-cols cc-cols--start">
              <BoxOra dim={dim} off={off} rows={ringOra} sub={subOra(manuale)}>
                {/* LA LEGENDA: senza questa, un colore sull'anello non
                    significa niente. La riga accesa e' quella che comanda. */}
                <div className="cc-sem-t">Il semaforo, dalla priorità più alta</div>
                {/* la sospensione si dice SUBITO sotto il titolo della legenda
                    (Alberto 03/08): in fondo all'elenco arrivava dopo che si
                    erano gia' lette cinque righe senza il loro "ORA", cioe'
                    dopo che il dubbio era gia' nato */}
                {manuale && (
                  <div className="cc-nota cc-nota--fine">
                    Il semaforo è sospeso: l’anello resta sul colore impostato a mano.
                  </div>
                )}
                <div className="cc-sem">
                  {ringSemaforo.map((r) => (
                    <Hint key={r.k} text={r.perche} anchor>
                      <div className={'cc-sem-r' + (r.on ? ' on' : '')} style={{ '--sem': r.col }}>
                        <i className="cc-sem-dot" />
                        <span className="cc-sem-lab">{r.lab}</span>
                        {r.on && <span className="cc-sem-now">ORA</span>}
                      </div>
                    </Hint>
                  ))}
                </div>
              </BoxOra>

              <BoxDeve manuale={manuale} spenta={!coltivazione} rows={ringDeve}
                titolo="Pianificato · Gestito dal piano"
                /* Stessa altezza dell'introduttivo di "Com'è ora" (due righe):
                   l'elenco delle condizioni e' gia' nella legenda del riquadro
                   accanto, ripeterlo qui costava una riga in piu' e sfalsava
                   le due colonne. */
                sub="In modalità Pianificata, l'anello segue il semaforo di stato. Se non c'è una coltivazione in corso, resta spento.">
                <div className="cc-nota">Vince sempre la priorità più alta fra quelle accese.</div>
              </BoxDeve>

              <BoxMan manuale={manuale} blocked={blocked} blockNote={blockNote}
                autoNoto={autoSel != null} perche={modoCfg.perche}>
                {/* GERARCHIA come nel pannello Luci: titoletto con icona
                    sopra ciascuna delle due sezioni. Il filetto della prima e'
                    quello a piena larghezza dell'introduttivo; fra le due
                    sezioni resta il .cc-sep dentro il padding. */}
                <div className="cc-sez">
                  <Icon path={mdiPalette} size={16} color="var(--fg-3)" />
                  <span>Colore fisso</span>
                </div>
                <div className="cc-sels">
                  <label className="cc-sel">
                    <span className="cc-sel-lab">Colore</span>
                    <select value={ringCol} disabled={!manuale || blocked || busy}
                      onChange={(e) => { setRingTocca(true); setRingCol(e.target.value) }}>
                      {RING_COLORI.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
                <Stepper lab="Fade" icon={mdiTimerOutline} val={ringFadeS} unit="s"
                  min={0} max={30} step={1} disabled={!manuale || blocked}
                  onStep={(d) => { setRingTocca(true); setRingFadeS((v) => Math.max(0, Math.min(30, v + d))) }} />

                <div className="cc-chips">
                  <Hint text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                    <button type="button" className={'cc-cmd cc-cmd--go' + (armed === 'ring:apply' ? ' arm' : '')}
                      disabled={!manuale || blocked || busy} onClick={applicaRing}>
                      <span className="cc-cmd-ic"><Icon path={mdiPalette} size={19} /></span>
                      <span className="cc-cmd-txt">
                        <b>{armed === 'ring:apply' ? 'Confermare il colore?' : 'Applica colore'}</b>
                        <i>{ringCol}{ringFadeS ? ` · fade ${ringFadeS} s` : ''}</i>
                      </span>
                    </button>
                  </Hint>
                  <Hint text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                    <button type="button" className={'cc-cmd' + (armed === 'ring:off' ? ' arm' : '')}
                      disabled={!manuale || blocked || busy}
                      onClick={spegniRing}>
                      <Icon path={mdiLightbulbOff} size={19} />
                      <span className="cc-cmd-txt">
                        <b>{armed === 'ring:off' ? 'Confermare lo spegnimento?' : 'Spegni anello'}</b>
                        <i>Senza dissolvenza</i>
                      </span>
                    </button>
                  </Hint>
                </div>

                {/* LAMPEGGIO — c'e' nel design, quindi c'e'; la nota dice
                    perche' e' meglio lasciarlo stare, e il perche' viene dal
                    comportamento vero della centralina, non da un'opinione. */}
                <div className="cc-sep" />
                <div className="cc-sez">
                  <Icon path={mdiLedStripVariant} size={16} color="var(--fg-3)" />
                  <span>Lampeggio</span>
                </div>
                {/* L'avviso urla solo quando puo' servire: in Libero attivo
                    e' giallo pieno, a modalita' spenta STESSO INGOMBRO (resta
                    nel suo riquadro) ma sfondo appena visibile — cosi' il
                    passaggio di modalita' non fa spostare niente. */}
                <div className={'cc-nota cc-nota--gialla' + (manuale ? '' : ' quieta')}>
                                    <span>
                    Uso fortemente sconsigliato: mentre l’anello lampeggia la centralina
                    resta occupata e non riceve altri comandi. Viene fornito solo per
                    completezza.
                  </span>
                </div>
                <Stepper lab="Volte" icon={mdiSync} val={Math.round(blink.volte)} unit=""
                  min={1} max={20} step={1} disabled={!manuale || blocked} onStep={(d) => stepBlink('volte', d, 1, 20)} />
                <Stepper lab="Durata" icon={mdiTimerOutline} val={Math.round(blink.durata)} unit="s"
                  min={1} max={10} step={1} disabled={!manuale || blocked} onStep={(d) => stepBlink('durata', d, 1, 10)} />
                <Stepper lab="Pausa" icon={mdiTimerSand} val={Math.round(blink.pausa)} unit="s"
                  min={1} max={5} step={1} disabled={!manuale || blocked} onStep={(d) => stepBlink('pausa', d, 1, 5)} />
                <div className="cc-chips cc-chips--uno">
                  <Hint text={blocked ? blockNote : (!manuale ? 'Disponibile solo in modalità Libera' : '')}>
                    <button type="button" className={'cc-cmd' + (armed === 'ring:blink' ? ' arm' : '')}
                      disabled={!manuale || blocked || busy} onClick={avviaBlink}>
                      <Icon path={mdiLedStripVariant} size={19} />
                      <span className="cc-cmd-txt">
                        <b>{armed === 'ring:blink' ? 'Confermare il lampeggio?' : 'Avvia lampeggio'}</b>
                        <i>{Math.round(blink.volte)}× {Math.round(blink.durata)} s (pausa {Math.round(blink.pausa)} s)</i>
                      </span>
                    </button>
                  </Hint>
                </div>
              </BoxMan>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
