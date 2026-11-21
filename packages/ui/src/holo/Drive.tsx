import { useContext, useState, type CSSProperties } from 'react'
import type { UiDrive, UiDriveFeuille, UiDriveFichier, UiDriveItem, UiDriveType } from '@code/protocol'
import { Api, Panel } from './api.ts'
import { MarkdownBlocks, parseBlocks, plainText } from './Markdown.tsx'

/** Google Drive : fichiers trouvés (tuiles par type), contenu d'un Doc ou d'un tableur. */

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties

const GLYPH: Record<UiDriveType, string> = { dossier: 'DIR', document: 'DOC', tableur: 'XLS', presentation: 'PPT', pdf: 'PDF', image: 'IMG', texte: 'TXT', autre: 'BIN' }
const FAMILY: Record<UiDriveType, string> = { dossier: 'Dossiers', document: 'Documents', tableur: 'Tableurs', presentation: 'Présentations', pdf: 'PDF', image: 'Images', texte: 'Textes', autre: 'Autres' }
const ORDER: UiDriveType[] = ['dossier', 'document', 'tableur', 'presentation', 'pdf', 'image', 'texte', 'autre']

/** Feuille au coin replié, teintée par type, avec son abréviation. */
function Glyph({ type, big = false }: { type: UiDriveType; big?: boolean }) {
  return (
    <span className={`drive-glyph drive-glyph--${type}${big ? ' drive-glyph--big' : ''}`} aria-hidden="true">
      <span className="drive-glyph__tag">{GLYPH[type]}</span>
    </span>
  )
}

const ExternalIcon = () => (
  <svg className="perso-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
)

function OpenInDrive({ lien, label = 'Ouvrir dans Google Drive' }: { lien?: string; label?: string }) {
  if (!lien) return null
  return (
    <a className="holo-action drive-open" href={lien} target="_blank" rel="noreferrer noopener">
      {label}
      <ExternalIcon />
    </a>
  )
}

/** Répartition des fichiers par type : une barre spectrale et sa légende. */
function Spectrum({ items }: { items: UiDriveItem[] }) {
  const counts = ORDER.map((t) => ({ t, n: items.filter((i) => i.type === t).length })).filter((c) => c.n > 0)
  if (!items.length) return null
  return (
    <div className="drive-spectrum">
      <div className="drive-spectrum__bar" role="img" aria-label={counts.map((c) => `${c.n} ${FAMILY[c.t].toLowerCase()}`).join(', ')}>
        {counts.map((c, i) => (
          <span key={c.t} className={`drive-spectrum__seg drive-spectrum__seg--${c.t}`} style={{ flexGrow: c.n, ...stagger(i) }} />
        ))}
      </div>
      <ul className="drive-spectrum__legend">
        {counts.map((c) => (
          <li key={c.t} className={`drive-spectrum__key drive-spectrum__key--${c.t}`}>
            <strong>{c.n}</strong> {FAMILY[c.t].toUpperCase()}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Tile({ it, i, open }: { it: UiDriveItem; i: number; open: (it: UiDriveItem) => void }) {
  const meta = [it.modifie && `modifié ${it.modifie}`, it.taille].filter(Boolean).join(' · ')
  return (
    <li className={`drive-tile drive-tile--${it.type}`} style={stagger(i)}>
      <button type="button" className="drive-tile__main" onClick={() => open(it)} aria-label={`${it.type === 'dossier' ? 'Ouvrir le dossier' : 'Lire'} « ${it.nom} »`}>
        <Glyph type={it.type} />
        <span className="drive-tile__text">
          <span className="drive-tile__name">{it.nom}</span>
          <span className="drive-tile__meta">
            {it.format.toUpperCase()}
            {meta && ` · ${meta}`}
          </span>
          {it.proprietaire && <span className="drive-tile__owner">Partagé par {it.proprietaire}</span>}
        </span>
      </button>
      {it.lien && (
        <a className="drive-tile__ext" href={it.lien} target="_blank" rel="noreferrer noopener" aria-label={`Ouvrir « ${it.nom} » dans Google Drive`} title="Ouvrir dans Google Drive">
          <ExternalIcon />
        </a>
      )}
    </li>
  )
}

export function DriveView({ data }: { data: UiDrive }) {
  const { page } = useContext(Api)
  const panel = useContext(Panel)
  // Un dossier s'ouvre à la place de la liste ; un fichier dans son propre panneau.
  const open = (it: UiDriveItem) =>
    it.type === 'dossier' ? page(panel.id, panel.turnId, 'drive_rechercher', { dossier: it.id }) : page(`${panel.id}~${it.id}`, panel.turnId, 'drive_lire', { id: it.id })
  return (
    <div className="perso drive">
      <header className="drive-head">
        <span className="agenda-next__kicker">GOOGLE DRIVE{data.compte ? ` · ${data.compte.toUpperCase()}` : ''}</span>
        <div className="drive-head__row">
          <h3 className="perso-fil__subject">
            {data.dossier && <span className="drive-head__dir">DOSSIER</span>}
            {data.titre}
          </h3>
          <span className="drive-head__count">
            <strong>{String(data.items.length).padStart(2, '0')}</strong>
            {data.plus ? '+' : ''} {data.items.length > 1 ? 'ÉLÉMENTS' : 'ÉLÉMENT'}
          </span>
        </div>
        {data.requete && <span className="holo-query">{data.requete}</span>}
        <Spectrum items={data.items} />
      </header>
      {data.items.length === 0 ? (
        <p className="perso-empty">{data.dossier ? 'Ce dossier est vide.' : 'Aucun fichier ne correspond.'}</p>
      ) : (
        <ol className="drive-grid">
          {data.items.map((it, i) => (
            <Tile key={it.id} it={it} i={i} open={open} />
          ))}
        </ol>
      )}
      <footer className="drive-foot">
        {data.plus && <span className="perso-more">D’autres résultats existent : précisez la recherche.</span>}
        {data.dossier && <OpenInDrive lien={data.dossier.lien} label="Ouvrir le dossier dans Drive" />}
      </footer>
    </div>
  )
}

// ── Contenu d'un fichier ──

const NUMERIC = /^[-+−]?\s?[\d\s  .,]+\s?(%|€|\$|F|FCFA|F CFA|XOF)?$/

function Sheet({ f }: { f: UiDriveFeuille }) {
  const cols = f.lignes[0]?.length ?? 0
  const letters = Array.from({ length: cols }, (_, i) => {
    let s = ''
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    return s
  })
  if (!f.lignes.length) return <p className="perso-empty">Onglet vide.</p>
  const cut = f.lignes.length < f.totalLignes || cols < f.totalColonnes
  return (
    <>
      <div className="drive-sheet" tabIndex={0} aria-label={`Onglet ${f.nom}`}>
        <table>
          <thead>
            <tr>
              <th className="drive-sheet__corner" aria-hidden="true" />
              {letters.map((l) => (
                <th key={l} scope="col">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {f.lignes.map((r, i) => (
              <tr key={i} className={i === 0 ? 'drive-sheet__header' : undefined}>
                <th scope="row">{i + 1}</th>
                {r.map((c, j) => (
                  <td key={j} className={i > 0 && c && NUMERIC.test(c) ? 'is-num' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cut && (
        <span className="perso-more">
          Aperçu : {f.lignes.length} ligne(s) sur {f.totalLignes}, {cols} colonne(s) sur {f.totalColonnes}. Ouvrez le tableur dans Drive pour tout voir.
        </span>
      )}
    </>
  )
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = () =>
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      })
      .catch(() => {})
  return (
    <button type="button" className={`holo-action tache-copy${done ? ' is-done' : ''}`} onClick={copy}>
      {done ? 'Copié ✓' : 'Copier le texte'}
    </button>
  )
}

export function DriveFichierView({ data }: { data: UiDriveFichier }) {
  const [tab, setTab] = useState(0)
  const feuille = data.feuilles?.[Math.min(tab, data.feuilles.length - 1)]
  const meta = [data.format, data.modifie && `modifié ${data.modifie}`, data.taille, data.proprietaire && `partagé par ${data.proprietaire}`].filter(Boolean).join(' · ')
  return (
    <div className={`perso drive-file drive-file--${data.type}`}>
      <header className="drive-file__head">
        <Glyph type={data.type} big />
        <div className="drive-file__title">
          <span className="agenda-next__kicker">{meta.toUpperCase()}</span>
          <h3 className="perso-fil__subject">{data.nom}</h3>
          {data.cree && <span className="drive-created">CRÉÉ · DOSSIER « CODE 2.0 »</span>}
        </div>
        <div className="drive-file__actions">
          <OpenInDrive lien={data.lien} label={data.source === 'gmail' ? 'Ouvrir dans Gmail' : undefined} />
          {data.texte && <CopyText text={plainText(data.texte)} />}
        </div>
      </header>

      {data.note && !data.cree && (data.texte !== undefined || data.feuilles) && <p className="drive-note">{data.note}</p>}

      {data.feuilles && data.feuilles.length > 0 && (
        <section className="drive-sheets">
          {data.feuilles.length > 1 && (
            <div className="drive-tabs" role="tablist">
              {data.feuilles.map((f, i) => (
                <button key={i} type="button" role="tab" aria-selected={i === tab} className={`drive-tab${i === tab ? ' is-on' : ''}`} onClick={() => setTab(i)}>
                  {f.nom}
                  <small>
                    {f.totalLignes}×{f.totalColonnes}
                  </small>
                </button>
              ))}
            </div>
          )}
          {feuille && <Sheet key={tab} f={feuille} />}
        </section>
      )}

      {data.texte !== undefined && (
        <article className="drive-doc tache-md">
          {data.texte.trim() ? <MarkdownBlocks blocks={parseBlocks(data.texte)} /> : <p className="perso-empty">Document vide.</p>}
        </article>
      )}
      {data.tronque && data.texte !== undefined && <span className="perso-more">Document long : seul le début est affiché.</span>}

      {!data.texte && !data.feuilles && (
        <div className="drive-sealed">
          <Glyph type={data.type} big />
          <span>{data.note ?? 'Aperçu indisponible.'}</span>
        </div>
      )}
    </div>
  )
}
