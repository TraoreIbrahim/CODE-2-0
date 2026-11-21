import { Fragment, type ReactNode } from 'react'

/**
 * Markdown simple (résultats de tâches, Google Docs) : titres, paragraphes, listes, citations, tableaux, gras, italique, code.
 * Jamais de HTML brut : tout passe par React (le texte vient de Claude, qui a pu lire des contenus externes).
 */

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'table'; rows: string[][] }

/** « | a | b | » → ['a', 'b']. */
const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function parseBlocks(md: string): Block[] {
  const blocks: Block[] = []
  const last = () => blocks[blocks.length - 1]
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] })
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ kind: 'h', level: h[1]!.length, text: h[2]! })
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // Ligne de séparation « |---|:--:| » : sans contenu, ignorée.
      if (/^[\s|:-]+$/.test(line)) continue
      const prev = last()
      if (prev?.kind === 'table') prev.rows.push(tableCells(line))
      else blocks.push({ kind: 'table', rows: [tableCells(line)] })
      continue
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)
    const prev = last()
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol'
      const text = (ul ?? ol)![1]!
      if (prev?.kind === kind) prev.items.push(text)
      else blocks.push({ kind, items: [text] })
    } else if (quote) {
      if (prev?.kind === 'quote') prev.lines.push(quote[1]!)
      else blocks.push({ kind: 'quote', lines: [quote[1]!] })
    } else if ((prev?.kind === 'ul' || prev?.kind === 'ol') && /^\s{2,}/.test(raw)) {
      // Suite d'un élément de liste (ligne indentée).
      prev.items[prev.items.length - 1] += `\n${line.trim()}`
    } else if (prev?.kind === 'p' && prev.lines.length > 0) prev.lines.push(line)
    else blocks.push({ kind: 'p', lines: [line] })
  }
  return blocks.filter((b) => b.kind !== 'p' || b.lines.length > 0)
}

/** **gras**, *italique*, `code`. */
export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push(text.slice(at, m.index))
    const t = m[0]
    if (t.startsWith('**') || t.startsWith('__')) out.push(<strong key={m.index}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={m.index}>{t.slice(1, -1)}</code>)
    else out.push(<em key={m.index}>{t.slice(1, -1)}</em>)
    at = m.index! + t.length
  }
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

const lines = (text: string) =>
  text.split('\n').map((l, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      <Inline text={l} />
    </Fragment>
  ))

export function MarkdownBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return b.level <= 2 ? <h4 key={i}><Inline text={b.text} /></h4> : <h5 key={i}><Inline text={b.text} /></h5>
          case 'hr':
            return <hr key={i} />
          case 'quote':
            return <blockquote key={i}>{lines(b.lines.join('\n'))}</blockquote>
          case 'ul':
          case 'ol': {
            const List = b.kind
            return (
              <List key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{lines(it)}</li>
                ))}
              </List>
            )
          }
          case 'table': {
            const [head, ...body] = b.rows
            return (
              <div key={i} className="md-table">
                <table>
                  <thead>
                    <tr>{head!.map((c, j) => <th key={j}><Inline text={c} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {body.map((r, k) => (
                      <tr key={k}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          case 'p':
            return <p key={i}>{lines(b.lines.join('\n'))}</p>
        }
      })}
    </>
  )
}

/** Texte à copier : sans les marques de mise en forme, lignes et listes conservées. */
export function plainText(md: string): string {
  return md
    .replace(/\r/g, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/^#{1,4}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Découpe en sections aux titres de premier niveau du document (# ou ##) : chacune se copie à part. */
export function sections(md: string): { titre: string | null; corps: string }[] {
  const top = /^##\s+/m.test(md) ? /^##\s+(.*)$/ : /^#\s+/m.test(md) ? /^#\s+(.*)$/ : null
  if (!top) return [{ titre: null, corps: md.trim() }]
  const out: { titre: string | null; corps: string }[] = []
  let cur: { titre: string | null; lines: string[] } = { titre: null, lines: [] }
  for (const line of md.split('\n')) {
    const m = top.exec(line)
    if (m) {
      if (cur.titre !== null || cur.lines.some((l) => l.trim())) out.push({ titre: cur.titre, corps: cur.lines.join('\n').trim() })
      cur = { titre: m[1]!, lines: [] }
    } else cur.lines.push(line)
  }
  out.push({ titre: cur.titre, corps: cur.lines.join('\n').trim() })
  return out
}
