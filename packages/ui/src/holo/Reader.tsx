import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from './markdown.ts'

/**
 * Lecteurs de documents dans l'interface : Markdown mis en forme, code avec numéros de ligne, tableau
 * (CSV, Excel), page isolée (HTML, Word, RTF). Tout défile dans le panneau ; rien du fichier ne s'exécute.
 */

// ── Markdown ───────────────────────────────────────────────────────────────

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>
          case 'code':
            return <code key={i}>{n.v}</code>
          case 'strong':
            return (
              <strong key={i}>
                <Inlines nodes={n.c} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            )
          case 'del':
            return (
              <del key={i}>
                <Inlines nodes={n.c} />
              </del>
            )
          // Un lien ne s'ouvre pas depuis l'aperçu (la fenêtre de CODE n'est pas un navigateur) : l'adresse est en info-bulle.
          case 'link':
            return (
              <span key={i} className="md-link" title={n.href}>
                <Inlines nodes={n.c} />
              </span>
            )
          case 'image':
            return (
              <span key={i} className="md-image" title={n.src}>
                ▣ {n.alt || 'image'}
              </span>
            )
          case 'br':
            return <br key={i} />
        }
      })}
    </>
  )
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </>
  )
}

function BlockView({ b }: { b: Block }): ReactNode {
  switch (b.t) {
    case 'h': {
      const H = `h${b.level}` as 'h1'
      return (
        <H>
          <Inlines nodes={b.c} />
        </H>
      )
    }
    case 'p':
      return (
        <p>
          <Inlines nodes={b.c} />
        </p>
      )
    case 'hr':
      return <hr />
    case 'code':
      return (
        <pre className="md-pre">
          {b.lang && <span className="md-pre__lang">{b.lang}</span>}
          <code>{b.v}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote>
          <Blocks blocks={b.c} />
        </blockquote>
      )
    case 'list': {
      const items = b.items.map((it, k) => (
        <li key={k} className={it.checked !== undefined ? 'md-task' : undefined}>
          {it.checked !== undefined && <span className={`md-check${it.checked ? ' is-on' : ''}`} aria-label={it.checked ? 'Fait' : 'À faire'} />}
          <Inlines nodes={it.c} />
          {it.sub && <BlockView b={it.sub} />}
        </li>
      ))
      return b.ordered ? <ol start={b.start}>{items}</ol> : <ul>{items}</ul>
    }
    case 'table':
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, k) => (
                  <th key={k} style={{ textAlign: b.align[k] ?? undefined }}>
                    <Inlines nodes={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                      <Inlines nodes={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

export function MarkdownReader({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <article className="holo-read md">
      <Blocks blocks={blocks} />
    </article>
  )
}

// ── Code et texte ──────────────────────────────────────────────────────────

export function CodeReader({ text, lang }: { text: string; lang: string }) {
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text])
  const width = String(lines.length).length
  return (
    <div className="holo-read holo-code" style={{ ['--gutter' as string]: `${width + 1}ch` }}>
      <span className="holo-code__lang">{lang.toUpperCase()}</span>
      <pre>
        {lines.map((l, i) => (
          <span key={i} className="holo-code__line">
            <span className="holo-code__n" aria-hidden="true">
              {i + 1}
            </span>
            {l || ' '}
          </span>
        ))}
      </pre>
    </div>
  )
}

export function TextReader({ text }: { text: string }) {
  return <div className="holo-read holo-text">{text}</div>
}

// ── Tableau ────────────────────────────────────────────────────────────────

type Tableau = { colonnes: string[]; lignes: string[][]; total: number; feuille?: string; feuilles?: string[] }

const PAGE = 100

export function SheetReader({ tableau }: { tableau: Tableau }) {
  const [shown, setShown] = useState(PAGE)
  const [filtre, setFiltre] = useState('')
  const q = filtre.trim().toLowerCase()
  const rows = q ? tableau.lignes.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : tableau.lignes
  // Colonnes de nombres alignées à droite : celles dont toutes les valeurs remplies sont numériques.
  const numeric = tableau.colonnes.map((_, j) => {
    const vals = tableau.lignes.slice(0, 200).map((r) => r[j] ?? '').filter((v) => v.trim())
    return vals.length > 0 && vals.every((v) => /^-?[\d\s]+([.,]\d+)?\s*%?$/.test(v.trim()))
  })
  return (
    <div className="holo-sheetview">
      <div className="holo-sheetview__bar">
        <span className="holo-sheetview__meta code-mono">
          {tableau.feuille ? `FEUILLE « ${tableau.feuille.toUpperCase()} »` : 'TABLEAU'} · {tableau.total} LIGNE{tableau.total > 1 ? 'S' : ''} · {tableau.colonnes.length} COLONNE{tableau.colonnes.length > 1 ? 'S' : ''}
          {tableau.feuilles && ` · ${tableau.feuilles.length} FEUILLES`}
        </span>
        <input className="holo-sheetview__filter" type="search" placeholder="Filtrer…" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Filtrer les lignes" />
      </div>
      <div className="holo-read holo-sheetview__scroll">
        <table className="holo-xl">
          <thead>
            <tr>
              <th className="holo-grid__n" aria-hidden="true" />
              {tableau.colonnes.map((c, j) => (
                <th key={j} scope="col" className={numeric[j] ? 'is-num' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r, i) => (
              <tr key={i}>
                <td className="holo-grid__n">{i + 1}</td>
                {tableau.colonnes.map((_, j) => (
                  <td key={j} className={numeric[j] ? 'is-num' : undefined}>
                    {r[j]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > shown && (
          <button type="button" className="holo-action holo-sheetview__more" onClick={() => setShown((n) => n + PAGE * 3)}>
            Afficher {Math.min(PAGE * 3, rows.length - shown)} lignes de plus
          </button>
        )}
        {q && rows.length === 0 && <p className="holo-more">Aucune ligne ne contient « {filtre.trim()} ».</p>}
      </div>
      {tableau.total > tableau.lignes.length && <p className="holo-more">Seules les {tableau.lignes.length} premières lignes sur {tableau.total} sont affichées. Ouvrez le fichier sur le Mac pour tout voir.</p>}
      {tableau.feuilles && <p className="holo-more">Le classeur a {tableau.feuilles.length} feuilles ({tableau.feuilles.join(', ')}) : seule la première est affichée.</p>}
    </div>
  )
}

// ── Page (HTML, Word, RTF) ─────────────────────────────────────────────────

/**
 * Une page dans un cadre isolé : `sandbox` sans aucune permission (ni script, ni formulaire, ni fenêtre,
 * ni navigation de la page de CODE) ; le serveur a déjà retiré scripts et liens et interdit tout chargement extérieur.
 */
export function PageReader({ html, title }: { html: string; title: string }) {
  return (
    <div className="holo-read holo-page">
      <iframe className="holo-page__frame" sandbox="" srcDoc={html} title={title} referrerPolicy="no-referrer" />
    </div>
  )
}
