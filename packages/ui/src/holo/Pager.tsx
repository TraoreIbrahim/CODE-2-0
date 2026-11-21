import { useContext } from 'react'
import type { UiPager } from '@code/protocol'
import { Api, Panel } from './api.ts'

const fmt = (n: number) => n.toLocaleString('fr-FR')

/** Numéros de page autour de la page courante : 1 … 4 5 [6] 7 8 … 53. */
function window_(page: number, pages: number): (number | '…')[] {
  const out: (number | '…')[] = []
  const add = (n: number | '…') => out[out.length - 1] !== n && out.push(n)
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) add(n)
    else add('…')
  }
  return out
}

/** Barre de pagination ; `onGo` local (tableau générique) ou, par défaut, rechargement serveur via `ui.page`. */
export function Pager({ pager, onGo }: { pager: Pick<UiPager, 'page' | 'pages' | 'total' | 'parPage'> & Partial<UiPager>; onGo?: (page: number) => void }) {
  const { page: reload } = useContext(Api)
  const panel = useContext(Panel)
  if (pager.pages <= 1) return null
  const go = (n: number) => {
    if (n < 1 || n > pager.pages || n === pager.page || panel.loading) return
    if (onGo) onGo(n)
    else if (pager.tool) reload(panel.id, panel.turnId, pager.tool, { ...pager.args, page: n })
  }
  const from = (pager.page - 1) * pager.parPage + 1
  const to = Math.min(pager.total, pager.page * pager.parPage)
  return (
    <nav className="holo-pager" aria-label="Pagination">
      <span className="holo-pager__count">
        {fmt(from)}–{fmt(to)} <span>sur {fmt(pager.total)}</span>
      </span>
      <span className="holo-pager__pages">
        <button type="button" className="holo-pager__btn" onClick={() => go(pager.page - 1)} disabled={pager.page <= 1} aria-label="Page précédente">
          ‹
        </button>
        {window_(pager.page, pager.pages).map((n, i) =>
          n === '…' ? (
            <span key={`g${i}`} className="holo-pager__gap">
              …
            </span>
          ) : (
            <button key={n} type="button" className={`holo-pager__btn${n === pager.page ? ' is-current' : ''}`} onClick={() => go(n)} aria-current={n === pager.page ? 'page' : undefined}>
              {n}
            </button>
          )
        )}
        <button type="button" className="holo-pager__btn" onClick={() => go(pager.page + 1)} disabled={pager.page >= pager.pages} aria-label="Page suivante">
          ›
        </button>
      </span>
    </nav>
  )
}
