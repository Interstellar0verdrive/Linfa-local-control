// Mini-parser markdown per le guide della serra. Gestisce solo il sottoinsieme
// che serve: `# titolo`, `> sottotitolo`, `## sezioni`, `![didascalia](src)`
// (immagini; più di fila = galleria affiancata), `- elenco`, paragrafi,
// **grassetto**, [testo](url).
//
// Volutamente minimale: le guide sono file .md dentro www/guide/, editabili a
// mano sullo share e caricati a runtime — modificarne una non richiede rebuild.
// Le immagini si scrivono relative alla cartella guide (es. `img/foto.jpg`).

// AUDIT R1 (M-17): allow-list degli schemi di URL. Le guide sono file .md
// editabili a mano sullo share: un `[testo](javascript:…)` diventerebbe
// codice eseguibile nell'app. Passano solo http/https/mailto, i path
// relativi e le ancore interne; tutto il resto perde il link e resta testo.
// I caratteri di controllo si tolgono PRIMA di guardare lo schema: dentro un
// href i browser li ignorano, quindi "java\nscript:" tornerebbe eseguibile.
const SCHEMA_OK = /^(?:https?|mailto):/i
function hrefSicuro(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!s) return null
  if (s.startsWith('#')) return s                        // ancora interna
  if (s.startsWith('//')) return null                    // protocol-relative: altra origin
  // schema esplicito = deve essere fra quelli ammessi; senza schema e' relativo
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return SCHEMA_OK.test(s) ? s : null
  return s
}

function parseInline(s) {
  const out = []
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let m
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) })
    if (m[1] != null) out.push({ t: 'b', s: m[1] })
    else if (m[2] != null) out.push({ t: 'i', s: m[2] })
    else {
      const href = hrefSicuro(m[4])
      // link scartato: resta il testo, senza <a> — meglio una frase muta che
      // un bersaglio che non si sa dove porta
      out.push(href ? { t: 'a', s: m[3], href } : { t: 'text', s: m[3] })
    }
    last = re.lastIndex
  }
  if (last < s.length) out.push({ t: 'text', s: s.slice(last) })
  return out
}

/* AUDIT R2 (M-R2-4): stessa severita' di hrefSicuro, applicata alle immagini.
   Prima un `![x](https://host/…)` in una guida diventava un <img src> verso un
   host qualunque: una richiesta in uscita dall'iframe Ingress, decisa da un
   file .md editabile a mano sullo share — la stessa porta che M-17 ha chiuso
   sui link, lasciata aperta di fianco.
   Passano SOLO i path relativi, e solo dentro guide/. Niente schema (nemmeno
   https: le guide non ospitano immagini remote), niente `//host`, niente `..`.
   Scartata = null: il chiamante mostra il segnaposto "Foto da aggiungere". */
function resolveImg(src) {
  const s = String(src || '').replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!s) return null
  if (s.startsWith('//')) return null                       // protocol-relative
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return null      // qualunque schema
  const rel = s.replace(/^\.?\//, '')
  if (rel.split('/').includes('..')) return null            // niente risalita
  return rel.startsWith('guide/') ? rel : 'guide/' + rel
}

export function parseGuide(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let titolo = ''
  let sottotitolo = ''
  const blocks = []
  let para = []
  let list = null
  let imgs = null
  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', spans: parseInline(para.join(' ')) }); para = [] }
  }
  const flushList = () => {
    if (list) { blocks.push({ type: 'ul', items: list }); list = null }
  }
  const flushImgs = () => {
    if (imgs) { blocks.push({ type: 'imgs', imgs }); imgs = null }
  }
  let quote = null
  const flushQuote = () => {
    if (quote) { blocks.push({ type: 'quote', variant: quote.variant, spans: quote.spans }); quote = null }
  }
  const flushAll = () => { flushPara(); flushList(); flushImgs(); flushQuote() }

  for (const raw of lines) {
    const line = raw.trim()
    let m
    if (!line) { flushAll(); continue }
    if ((m = line.match(/^#\s+(.*)/))) { flushAll(); titolo = m[1].trim(); continue }
    if ((m = line.match(/^>\s+(.*)/))) {
      let txt = m[1].trim()
      // il primo `>` in cima (prima di ogni contenuto) è il sottotitolo;
      // i `>` successivi diventano citazioni in evidenza (blockquote).
      if (!sottotitolo && !blocks.length && !para.length && !list && !imgs && !quote) {
        sottotitolo = txt
      } else {
        flushPara(); flushList(); flushImgs()
        if (quote) {
          if (quote.spans.length) quote.spans.push({ t: 'text', s: ' ' })
          quote.spans.push(...parseInline(txt))
        } else {
          // marcatore "admonition" a inizio blocco: `[!nota]` → riquadro d'avviso
          let variant = null
          const am = txt.match(/^\[!([a-zA-Z]+)\]\s*(.*)$/)
          if (am) { variant = am[1].toLowerCase(); txt = am[2] }
          quote = { variant, spans: txt ? parseInline(txt) : [] }
        }
      }
      continue
    }
    if ((m = line.match(/^##\s+(.*)/))) { flushAll(); blocks.push({ type: 'h2', text: m[1].trim() }); continue }
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/))) {
      flushPara(); flushList(); flushQuote()
      ;(imgs = imgs || []).push({ cap: m[1].trim(), src: resolveImg(m[2].trim()) })
      continue
    }
    if ((m = line.match(/^[-*]\s+(.*)/))) {
      flushPara(); flushImgs(); flushQuote()
      ;(list = list || []).push(parseInline(m[1].trim()))
      continue
    }
    if (list) {
      // riga a capo che continua l'ultima voce di elenco (bullet su più righe)
      list[list.length - 1].push({ t: 'text', s: ' ' }, ...parseInline(line))
      continue
    }
    flushImgs(); flushQuote()
    para.push(line)
  }
  flushAll()
  return { titolo, sottotitolo, blocks }
}
