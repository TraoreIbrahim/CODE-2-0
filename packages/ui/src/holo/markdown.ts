/**
 * Markdown → blocs, pour l'aperçu des documents (.md). Volontairement simple et sans HTML : le rendu
 * construit des éléments React, rien du fichier n'est injecté tel quel dans la page.
 * Gère : titres, paragraphes, listes (imbriquées, à cocher), citations, blocs de code, tableaux, séparateurs.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; c: Inline[]; href: string }
  | { t: 'image'; alt: string; src: string }
  | { t: 'br' }

export type ListItem = { c: Inline[]; checked?: boolean; sub?: Block }
export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; head: Inline[][]; align: ('left' | 'center' | 'right' | null)[]; rows: Inline[][][] }
  | { t: 'hr' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, '    ').length

export function parseMarkdown(src: string): Block[] {
  return blocks(src.replace(/\r\n?/g, '\n').split('\n'))
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`)
      const body: string[] = []
      i++
      while (i < lines.length && !close.test(lines[i]!)) body.push(lines[i++]!)
      i++
      out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') })
      continue
    }
    const h = line.match(HEADING)
    if (h) {
      out.push({ t: 'h', level: h[1]!.length as 1, c: inline(h[2]!) })
      i++
      continue
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && lines[i]!.trim() && QUOTE.test(lines[i]!)) body.push(lines[i++]!.match(QUOTE)![1]!)
      out.push({ t: 'quote', c: blocks(body) })
      continue
    }
    if (LIST.test(line)) {
      const [list, next] = listAt(lines, i)
      out.push(list)
      i = next
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map((c) => {
        const s = c.trim()
        return s.startsWith(':') && s.endsWith(':') ? 'center' : s.endsWith(':') ? 'right' : s.startsWith(':') ? 'left' : null
      })
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!).map(inline))
      out.push({ t: 'table', head: head.map(inline), align, rows })
      continue
    }
    // Paragraphe : jusqu'à une ligne vide ou le début d'un autre bloc.
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !(para.length && startsBlock(lines, i))) para.push(lines[i++]!)
    out.push({ t: 'p', c: inline(para.map((l, k) => (k < para.length - 1 && / {2,}$/.test(l) ? `${l.trimEnd()}\u2028` : l.trim())).join(' ')) })
  }
  return out
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i]!
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!))
}

/** Une liste à partir de la ligne `start` : ses éléments, et les lignes plus indentées en sous-liste ou suite. */
function listAt(lines: string[], start: number): [Block, number] {
  const first = lines[start]!.match(LIST)!
  const base = indentOf(first[1]!)
  const ordered = /\d/.test(first[2]!)
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      // Une ligne vide n'arrête la liste que si la suivante n'en fait plus partie.
      const next = lines[i + 1]
      if (next && (indentOf(next) > base || (LIST.test(next) && indentOf(next) === base))) {
        i++
        continue
      }
      break
    }
    const m = line.match(LIST)
    const indent = indentOf(line)
    if (m && indent === base && /\d/.test(m[2]!) === ordered) {
      let text = m[3]!
      let checked: boolean | undefined
      const task = text.match(/^\[([ xX])\]\s+(.*)$/)
      if (task) {
        checked = task[1] !== ' '
        text = task[2]!
      }
      items.push({ c: inline(text), ...(checked !== undefined ? { checked } : {}) })
      i++
    } else if (indent > base && items.length) {
      // Plus indenté : une sous-liste, ou la suite du texte de l'élément.
      const last = items[items.length - 1]!
      if (m) {
        const [sub, next] = listAt(lines, i)
        last.sub = sub
        i = next
      } else {
        last.c.push({ t: 'text', v: ' ' }, ...inline(line.trim()))
        i++
      }
    } else break
  }
  return [{ t: 'list', ordered, start: ordered ? Number(first[2]!.replace(/\D/g, '')) : 1, items }, i]
}

function cells(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const out: string[] = []
  let cur = ''
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') {
      cur += '|'
      k++
    } else if (s[k] === '|') {
      out.push(cur.trim())
      cur = ''
    } else cur += s[k]
  }
  out.push(cur.trim())
  return out
}

// ── En ligne ───────────────────────────────────────────────────────────────

const INLINE: [RegExp, (m: RegExpExecArray) => Inline][] = [
  // Un caractère échappé (« \* ») reste tel quel : avant tout le reste.
  [/\\([\\`*_{}[\]()#+\-.!|~>])/, (m) => ({ t: 'text', v: m[1]! })],
  [/`([^`]+)`/, (m) => ({ t: 'code', v: m[1]! })],
  [/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, (m) => ({ t: 'image', alt: m[1]!, src: m[2]! })],
  [/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, (m) => ({ t: 'link', c: inline(m[1]!), href: m[2]! })],
  [/(\*\*|__)(?=\S)([\s\S]*?\S)\1/, (m) => ({ t: 'strong', c: inline(m[2]!) })],
  [/~~(?=\S)([\s\S]*?\S)~~/, (m) => ({ t: 'del', c: inline(m[1]!) })],
  [/(?<![\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)|(?<!\w)_(?=\S)([^_]*?\S)_(?!\w)/, (m) => ({ t: 'em', c: inline(m[1] ?? m[2]!) })],
  [/<(https?:\/\/[^>\s]+)>/, (m) => ({ t: 'link', c: [{ t: 'text', v: m[1]! }], href: m[1]! })],
  [/\u2028/, () => ({ t: 'br' })]
]

/** Le texte d'une ligne en éléments : le premier motif trouvé l'emporte, le reste est analysé à son tour. */
export function inline(src: string): Inline[] {
  const out: Inline[] = []
  let rest = src
  while (rest) {
    let best: { at: number; len: number; node: Inline } | null = null
    for (const [re, make] of INLINE) {
      const m = re.exec(rest)
      if (m && (!best || m.index < best.at)) best = { at: m.index, len: m[0].length, node: make(m) }
    }
    if (!best) {
      out.push({ t: 'text', v: unescape(rest) })
      break
    }
    if (best.at) out.push({ t: 'text', v: unescape(rest.slice(0, best.at)) })
    out.push(best.node)
    rest = rest.slice(best.at + best.len)
  }
  // Les morceaux de texte voisins (autour d'un échappement) n'en font qu'un.
  return out.reduce<Inline[]>((acc, n) => {
    const last = acc[acc.length - 1]
    if (n.t === 'text' && last?.t === 'text') last.v += n.v
    else acc.push(n)
    return acc
  }, [])
}

const unescape = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1')
