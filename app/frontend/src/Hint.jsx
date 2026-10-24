// Hint — il "fumettino" dell'app (tooltip custom, sostituisce quello nativo).
//
// Regola UX (vale per TUTTA l'app). NIENTE auto-hide a tempo: la bolla resta
// finche' l'utente e' ancora "li' sopra", e sparisce quando fa altro.
//
//  DESKTOP (pointer fine)
//   - hover: compare dopo 500 ms (niente comparse involontarie al passaggio);
//   - click: compare SUBITO — il click serve solo a saltare l'attesa;
//   - SEGUE IL CURSORE (modalita' "cursor"): niente ancoraggio e niente caret,
//     che su un bersaglio mobile ballerebbe. La posizione la scrive JS
//     direttamente sul nodo a ogni mousemove, senza passare da setState.
//   - sparisce all'uscita del mouse dal target (o con Escape / perdita di focus).
//
//  TOUCH (pointer coarse)
//   - tap: compare subito, ri-tap sullo stesso target la richiude (toggle);
//   - sparisce quando l'utente fa altro: tap fuori, SCROLL della pagina
//     (su touch lo scroll chiude, non riposiziona), apertura di un altro hint.
//   - vale SOLO per target informativi o disabilitati: un bottone attivo al tap
//     fa la sua azione e basta (vedi `inerte` piu' sotto).
//
// In entrambi i casi: uno solo visibile alla volta (registro singleton in cima
// al modulo) ed Escape chiude.
//
// Il componente NON mette mai `title` sul target: dove si applica Hint il
// `title=` esistente va RIMOSSO, altrimenti si vedono due tooltip sovrapposti.
//
// Posizionamento: position:fixed calcolata da getBoundingClientRect al momento
// della comparsa + portal su document.body — cosi' funziona anche dentro
// contenitori con overflow (timeline, liste scrollabili) e dentro l'iframe
// Ingress (il portal resta nel document dell'iframe, non esce dall'app).
import React, { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './hint.css'

const HOVER_DELAY = 500   // ms di hover prima della comparsa (solo pointer fine)
const GAP = 9             // distanza bolla↔target (la freccetta ne occupa 6)
const EDGE = 8            // margine minimo dai bordi del viewport
const CARET_INSET = 14    // quanto la freccetta puo' avvicinarsi allo spigolo
const WATCHDOG_MS = 250   // ronda anti-bolla-orfana (target sparito/nascosto)
const CURSOR_DX = 10      // scostamento a destra del puntatore (modalita' cursor)
const CURSOR_DY = 14      // scostamento sotto il puntatore

// marker di stato per la modalita' "segue il cursore": la posizione NON sta
// nello state (la scrive JS sul nodo a ogni mousemove), qui serve solo a far
// scattare la classe .ready. Riferimento stabile = zero render inutili.
const CURSOR_POS = { cursor: true }

// ── registro singleton: aprirne uno chiude l'altro ──
let active = null
function claim(inst) {
  if (active && active !== inst) active.close()
  active = inst
}
function release(inst) {
  if (active === inst) active = null
}

const canHover = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * <Hint text="spiegazione">{<button .../>}</Hint>
 *
 * Clona il figlio aggiungendo SOLO gli handler (zero markup extra: niente
 * wrapper che rompa flex/height dei bottoni esistenti). Unica eccezione: se il
 * figlio puo' essere `disabled` i browser non gli mandano eventi di mouse,
 * quindi in quel caso si avvolge in uno <span class="hint-wrap"> inline-flex
 * che fa da bersaglio (il figlio ha pointer-events:none via CSS).
 *
 * Props:
 *   text     testo della bolla. Se vuoto il componente e' trasparente, ma la
 *            STRUTTURA resta identica (stesso wrapper o stesso figlio nudo):
 *            i call site che passano `text={armato ? '' : '…'}` non devono
 *            far rimontare il bottone a ogni transizione.
 *   wrap     forza il wrapper anche su figli senza prop `disabled`
 *   info     forza il comportamento "informativo" (hint al tap anche su touch)
 *            per un target che ha comunque un onClick. Di norma non serve:
 *            l'euristica sotto ci arriva da sola.
 *   anchor   forza la bolla ANCORATA col caret anche su desktop col mouse,
 *            invece del follow-cursor. Serve sulle affordance "(i)" delle righe
 *            informative: li' il bersaglio e' un puntino preciso, e una bolla
 *            che scappa dietro al cursore fa perdere il riferimento.
 */
export default function Hint({ text, children, wrap = false, info = false, anchor = false }) {
  const id = useId()
  const inst = useRef({}).current
  const bubbleRef = useRef(null)
  const elRef = useRef(null)        // il target DOM, catturato dall'evento
  const hoverT = useRef(0)
  const coarseRef = useRef(false)   // com'era il pointer QUANDO si e' aperta
  // 'cursor' = segue il mouse (desktop, aperta col puntatore)
  // 'anchor' = ancorata al target col caret (touch, oppure focus da tastiera)
  const modeRef = useRef('anchor')
  const ptrRef = useRef(null)       // ultima posizione nota del puntatore
  const sizeRef = useRef({ w: 0, h: 0 })  // misura della bolla, presa alla comparsa
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)   // { top, left, caret, below } | CURSOR_POS
  // contatore di comparse: se il fumettino e' GIA' aperto (hover 500 ms) e si
  // clicca lo stesso target, `open` non cambia e il layout effect non
  // ripartirebbe — la bolla resterebbe senza posizione, cioe' invisibile.
  const [tick, setTick] = useState(0)

  const close = useCallback(() => {
    clearTimeout(hoverT.current); hoverT.current = 0
    release(inst)
    setOpen(false)
    setPos(null)
  }, [inst])
  inst.close = close

  // Modalita' cursor: scrive la posizione DIRETTAMENTE sul nodo (transform), mai
  // via setState — a 120 mousemove/s un re-render per evento sarebbe insensato.
  // Flip: vicino al bordo destro passa a sinistra del puntatore, vicino al bordo
  // basso passa sopra; poi clamp, cosi' non viene mai tagliata.
  const placeAtCursor = useCallback(() => {
    const bub = bubbleRef.current
    const p = ptrRef.current
    if (!bub || !p) return
    const { w, h } = sizeRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = p.x + CURSOR_DX
    let y = p.y + CURSOR_DY
    if (x + w > vw - EDGE) x = p.x - CURSOR_DX - w
    if (y + h > vh - EDGE) y = p.y - CURSOR_DY - h
    x = Math.max(EDGE, Math.min(x, vw - w - EDGE))
    y = Math.max(EDGE, Math.min(y, vh - h - EDGE))
    bub.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
  }, [])

  const show = useCallback((el, mode) => {
    if (!el || !text) return
    clearTimeout(hoverT.current); hoverT.current = 0
    elRef.current = el
    coarseRef.current = !canHover()
    // su touch e da tastiera resta ancorata; segue il cursore solo se e' stato
    // il puntatore ad aprirla su un dispositivo con hover — e se il call site
    // non ha chiesto esplicitamente l'ancoraggio (prop `anchor`)
    const m = (!anchor && !coarseRef.current && mode === 'cursor' && ptrRef.current) ? 'cursor' : 'anchor'
    modeRef.current = m
    claim(inst)
    // in modalita' cursor NON si azzera la posizione: farlo toglierebbe .ready
    // per un frame e la bolla lampeggerebbe a ogni click sul target gia' aperto
    if (m !== 'cursor') setPos(null)
    setOpen(true)
    setTick((t) => t + 1)
  }, [inst, text, anchor])

  // posizione: sopra il target, sotto se in alto non ci sta (flip semplice)
  useLayoutEffect(() => {
    if (!open) return
    const el = elRef.current
    const bub = bubbleRef.current
    if (!el || !bub) return
    const r = el.getBoundingClientRect()
    // target sparito dal DOM (re-render che lo rimonta) o nascosto/uscito dal
    // viewport: niente bolla orfana incollata a (0,0)
    if (!el.isConnected || (r.width === 0 && r.height === 0)) { close(); return }
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
      close(); return
    }

    // ── modalita' cursor: misura una volta e poi insegue il puntatore ──
    if (modeRef.current === 'cursor') {
      sizeRef.current = { w: bub.offsetWidth, h: bub.offsetHeight }
      placeAtCursor()
      setPos(CURSOR_POS)
      return
    }

    // ── modalita' anchor ──
    // Si ripulisce il transform lasciato da un'eventuale apertura precedente in
    // modalita' cursor, altrimenti sfaserebbe top/left.
    bub.style.transform = ''
    // E si riporta a (0,0) PRIMA di misurare: la bolla e' position:fixed con
    // solo `left`, quindi la sua larghezza e' shrink-to-fit su (viewport −
    // left). Misurandola dove sta gia' — es. su resize, quando ha ancora il
    // left del viewport precedente — si legge una larghezza gia' compressa, il
    // clamp la crede stretta e la posiziona a cavallo del bordo.
    bub.style.left = '0px'
    bub.style.top = '0px'
    const bw = bub.offsetWidth
    const bh = bub.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    const below = (r.top - bh - GAP) < EDGE && (r.bottom + bh + GAP) <= vh - EDGE
    const top = below ? r.bottom + GAP : Math.max(EDGE, r.top - bh - GAP)

    const cx = r.left + r.width / 2
    let left = cx - bw / 2
    left = Math.max(EDGE, Math.min(left, vw - bw - EDGE))
    const caret = Math.max(CARET_INSET, Math.min(cx - left, bw - CARET_INSET))

    setPos({ top: Math.round(top), left: Math.round(left), caret: Math.round(caret), below })
  }, [open, tick, close, placeAtCursor])

  // Listener globali attivi SOLO mentre la bolla e' aperta.
  //  - cursor: nessun listener di scroll/resize — la bolla sta gia' attaccata al
  //    puntatore, riposizionarla sarebbe lavoro inutile;
  //  - anchor da tastiera: scroll/resize RIPOSIZIONANO;
  //  - touch: scroll e tap fuori CHIUDONO — il dito sta gia' facendo altro.
  // La ronda copre i casi in cui il target sparisce senza eventi (cambio
  // sezione: la vecchia va in display:none e il mouseleave non arriva).
  useEffect(() => {
    if (!open) return
    const coarse = coarseRef.current
    const cursorMode = modeRef.current === 'cursor'
    const onKey = (e) => { if (e.key === 'Escape') close() }
    const reflow = () => setTick((t) => t + 1)
    const onDownOutside = (e) => {
      const el = elRef.current
      const bub = bubbleRef.current
      // ri-tap sul target: lo gestisce onClick (toggle), qui non si chiude
      if (el && el.contains(e.target)) return
      if (bub && bub.contains(e.target)) return
      close()
    }
    const watchdog = setInterval(() => {
      const el = elRef.current
      if (!el || !el.isConnected) { close(); return }
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) close()
    }, WATCHDOG_MS)

    window.addEventListener('keydown', onKey)
    if (coarse) {
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
      window.addEventListener('pointerdown', onDownOutside, true)
    } else if (!cursorMode) {
      window.addEventListener('scroll', reflow, true)
      window.addEventListener('resize', reflow)
    }
    return () => {
      clearInterval(watchdog)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('pointerdown', onDownOutside, true)
      window.removeEventListener('scroll', reflow, true)
      window.removeEventListener('resize', reflow)
    }
  }, [open, close])

  useEffect(() => () => { clearTimeout(hoverT.current); release(inst) }, [inst])

  if (!React.isValidElement(children)) return children || null

  const child = children
  // La FORMA del risultato non deve dipendere dal testo. Molti call site
  // passano `text={armato ? '' : '…'}`: se a testo vuoto tornasse il figlio
  // nudo, al primo tap il bottone verrebbe smontato e rimontato (perde il
  // focus, riparte a ogni transizione) e le regole CSS scritte sul wrapper
  // smetterebbero di prendere. Il wrapper dipende quindi SOLO da props
  // stabili: `wrap` e la PRESENZA della prop `disabled` sul figlio.
  const conWrap = wrap || child.props.disabled !== undefined
  // Testo vuoto = componente trasparente: stessa struttura, zero handler.
  if (!text) return conWrap ? <span className="hint-wrap">{child}</span> : child

  const chain = (mine, theirs) => (e) => { mine(e); if (theirs) theirs(e) }

  // "inerte" = target senza azione propria (o disabilitato): e' li' solo per
  // essere spiegato, quindi su TOUCH il tap puo' mostrare il fumettino. Un
  // bottone attivo, invece, al tap fa la sua azione e basta.
  const inerte = info || !!child.props.disabled || !child.props.onClick

  const handlers = {
    // hover: solo su pointer fine, e con il ritardo anti-comparsa
    onMouseEnter: chain((e) => {
      if (!canHover()) return
      const el = e.currentTarget
      ptrRef.current = { x: e.clientX, y: e.clientY }
      clearTimeout(hoverT.current)
      hoverT.current = setTimeout(() => show(el, 'cursor'), HOVER_DELAY)
    }, child.props.onMouseEnter),
    // la bolla insegue il puntatore: nessun setState, si scrive sul nodo
    onMouseMove: chain((e) => {
      ptrRef.current = { x: e.clientX, y: e.clientY }
      if (open && modeRef.current === 'cursor') placeAtCursor()
    }, child.props.onMouseMove),
    // unica uscita su desktop: il mouse lascia il target
    onMouseLeave: chain(() => {
      if (!canHover()) return
      close()
    }, child.props.onMouseLeave),
    onClick: chain((e) => {
      const el = e.currentTarget
      if (canHover()) {
        // detail 0 = "click" da tastiera (Invio/Spazio): niente coordinate utili
        if (e.detail > 0) ptrRef.current = { x: e.clientX, y: e.clientY }
        show(el, e.detail > 0 ? 'cursor' : 'anchor')   // desktop: salta l'attesa
        return
      }
      if (!inerte) return                    // touch + bottone attivo: solo l'azione
      if (open) close(); else show(el)       // touch: tap = toggle
    }, child.props.onClick),
    // tastiera: il focus da tab mostra la spiegazione senza dover cliccare.
    // Solo :focus-visible, altrimenti su touch il focus del tap riaprirebbe
    // l'hint anche sui bottoni attivi.
    onFocus: chain((e) => {
      const t = e.target
      if (t && typeof t.matches === 'function' && t.matches(':focus-visible')) show(e.currentTarget)
    }, child.props.onFocus),
    onBlur: chain(() => close(), child.props.onBlur),
  }

  // Click sul WRAPPER (ramo `hint-wrap` piu' sotto): NON deve richiamare
  // l'onClick del figlio. Se il figlio e' abilitato lo esegue gia' lui e
  // l'evento risale fino allo span, quindi chainarlo lo farebbe partire DUE
  // volte — con le azioni "armate in due tap" il primo tap armava ed eseguiva
  // nello stesso istante (verificato: due POST api/service per un solo tap).
  // Se e' disabilitato non deve partire per niente. Qui resta solo il
  // fumettino; tutto il resto del comportamento e' identico a `handlers`.
  const onClickWrap = (e) => {
    const el = e.currentTarget
    if (canHover()) {
      if (e.detail > 0) ptrRef.current = { x: e.clientX, y: e.clientY }
      show(el, e.detail > 0 ? 'cursor' : 'anchor')   // desktop: salta l'attesa
      return
    }
    if (!inerte) return                    // touch + bottone attivo: solo l'azione
    if (open) close(); else show(el)       // touch: tap = toggle
  }

  // In modalita' cursor top/left restano a 0 e la posizione e' un transform
  // scritto da placeAtCursor: React non deve toccarla a ogni re-render.
  const cursorMode = !!(pos && pos.cursor)
  const bubble = open ? createPortal(
    <div
      ref={bubbleRef}
      id={id}
      role="tooltip"
      className={'hint-bubble' + (pos ? ' ready' : '') + (cursorMode ? ' cursor' : '')
        + (pos && pos.below ? ' below' : '')}
      style={pos && !cursorMode ? { top: pos.top, left: pos.left } : { top: 0, left: 0 }}
    >
      {text}
      {/* niente freccetta quando insegue il puntatore: punterebbe un bersaglio
          che si muove, e ballerebbe a ogni mousemove */}
      {!cursorMode && <span className="hint-caret" style={pos ? { left: pos.caret } : undefined} />}
    </div>,
    document.body,
  ) : null

  // Figlio che PUO' essere disabilitato (prop presente, anche se ora e' false):
  // serve un bersaglio che riceva eventi al posto suo. La decisione guarda la
  // presenza della prop, non il suo valore, perche' deve restare stabile: se
  // cambiasse a ogni toggle React rimonterebbe il bottone e il riferimento al
  // target diventerebbe stale (bolla piazzata a 0,0).
  if (conWrap) {
    return (
      <>
        <span className="hint-wrap" {...handlers} onClick={onClickWrap} aria-describedby={open ? id : undefined}>
          {child}
        </span>
        {bubble}
      </>
    )
  }

  return (
    <>
      {cloneElement(child, { ...handlers, 'aria-describedby': open ? id : child.props['aria-describedby'] })}
      {bubble}
    </>
  )
}
