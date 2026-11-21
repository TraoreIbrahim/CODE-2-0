import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { UiConnecteur, UiDevCarte, UiDevIcone } from '@code/protocol'
import { MarkdownBlocks, parseBlocks } from './Markdown.tsx'
import { useNow } from './Rappels.tsx'

/**
 * Résultats des connecteurs (GitHub, Vercel, Expo…) en blocs : cartes de pull requests et d'issues,
 * chronologie des déploiements et des builds, tuiles de dépôts, journal de construction. Chaque état a sa
 * couleur (ouvert, fusionné, en ligne, en échec, en cours qui pulse) ; le lien mène à la page du service.
 */

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties
const PAR_PAGE = 12

/** « il y a 3 min », « il y a 2 h », « hier », « le 27/10 ». */
export function depuis(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.round((now - t) / 1000)
  if (s < 0) return 'à l’instant'
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`
  const jours = Math.floor(s / 86_400)
  if (jours === 1) return 'hier'
  if (jours < 7) return `il y a ${jours} jours`
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `le ${p(d.getDate())}/${p(d.getMonth() + 1)}${d.getFullYear() !== new Date(now).getFullYear() ? `/${d.getFullYear()}` : ''}`
}

const heure = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── Pictogrammes ────────────────────────────────────────────────────────

const PATHS: Record<UiDevIcone, ReactNode> = {
  pr: (
    <>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="19" r="2.2" />
      <path d="M6 7.2v9.6M18 16.8V10a3 3 0 0 0-3-3h-4" />
      <path d="M13 4.5 10.5 7 13 9.5" />
    </>
  ),
  issue: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </>
  ),
  commit: (
    <>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M2.5 12h6.1M15.4 12h6.1" />
    </>
  ),
  depot: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6" />
    </>
  ),
  deploiement: <path d="M12 3.5 21 19.5H3z" />,
  projet: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
  build: (
    <>
      <path d="M14.5 6.5 17.5 3.5l3 3-3 3M17.5 6.5 9 15" />
      <path d="M4 20l5-5 2 2-5 5H4z" />
    </>
  ),
  ios: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.6" />
      <path d="M10 5h4" />
    </>
  ),
  android: (
    <>
      <path d="M5 11a7 7 0 0 1 14 0v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z" />
      <path d="M8 4.5 9.5 7M16 4.5 14.5 7" />
      <circle cx="9.5" cy="11" r=".9" fill="currentColor" />
      <circle cx="14.5" cy="11" r=".9" fill="currentColor" />
    </>
  ),
  workflow: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m10 8.5 5 3.5-5 3.5z" />
    </>
  ),
  version: <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8.5 8.5-9 9z M8 8h.01" />,
  fichier: <path d="M6 2.5h8l4.5 4.5v14.5H6zM14 2.5V7h4.5" />,
  commentaire: <path d="M4 5h16v11H9l-5 4z" />,
  personne: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  ligne: <path d="M4 7l4 5-4 5M11 17h9" />,
  element: (
    <>
      <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z" />
      <path d="M3 7.5l9 5 9-5M12 12.5v9" />
    </>
  )
}

export function Icone({ icone, className = 'cx-icone' }: { icone: UiDevIcone; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[icone]}
    </svg>
  )
}

/** La marque du service, en monogramme dans un losange (pas de logo de marque). */
const MONOGRAMMES: Record<string, string> = { github: 'GH', vercel: '▲', expo: 'EX', figma: 'FG', sentry: 'SN', linear: 'LN', supabase: 'SB', coolify: 'CF', cloudinary: 'CL', trello: 'TR', notion: 'NO', excalidraw: 'XD', maps: 'GM' }

export const Ouvrir = ({ lien, court = false }: { lien: string; court?: boolean }) => (
  <a className="cx-ouvrir" href={lien} target="_blank" rel="noreferrer" title={lien}>
    {court ? '' : 'Ouvrir'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  </a>
)

export const Statut = ({ statut }: { statut: NonNullable<UiDevCarte['statut']> }) => (
  <span className={`cx-statut cx-ton--${statut.ton}`}>
    <span className="cx-statut__point" aria-hidden="true" />
    {statut.label}
  </span>
)

function Auteur({ c, now }: { c: UiDevCarte; now: number }) {
  if (!c.auteur && !c.date) return null
  return (
    <span className="cx-auteur">
      {c.avatar ? <img src={c.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" /> : c.auteur ? <span className="cx-initiale">{c.auteur.charAt(0).toUpperCase()}</span> : null}
      {c.auteur && <strong>{c.auteur}</strong>}
      {c.date && <time dateTime={c.date} title={new Date(c.date).toLocaleString('fr-FR')}>{depuis(c.date, now)}</time>}
    </span>
  )
}

const Puces = ({ puces }: { puces?: string[] }) =>
  puces?.length ? (
    <span className="cx-puces">
      {puces.map((p) => (
        <span key={p} className={`cx-puce${p.includes('→') || /^[\w./-]+$/.test(p) ? ' cx-puce--code' : ''}${p === 'Production' ? ' cx-puce--prod' : ''}`}>
          {p}
        </span>
      ))}
    </span>
  ) : null

// ── Dispositions ────────────────────────────────────────────────────────

function Carte({ c, i, now, sansContexte }: { c: UiDevCarte; i: number; now: number; sansContexte: boolean }) {
  return (
    <li className={`cx-carte cx-ton--${c.statut?.ton ?? 'neutre'}`} style={stagger(i)}>
      <div className="cx-carte__tete">
        <Icone icone={c.icone} />
        {c.numero && <span className="cx-numero">{c.numero}</span>}
        {!sansContexte && c.contexte && <span className="cx-contexte">{c.contexte}</span>}
        {c.statut && <Statut statut={c.statut} />}
      </div>
      <strong className="cx-carte__titre">{c.titre}</strong>
      {c.extrait && <p className="cx-carte__extrait">{c.extrait}</p>}
      <Puces puces={c.puces} />
      {c.faits?.length ? (
        <dl className="cx-faits">
          {c.faits.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.valeur}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="cx-carte__pied">
        <Auteur c={c} now={now} />
        {c.lien && <Ouvrir lien={c.lien} />}
      </div>
    </li>
  )
}

/** Regroupées par dépôt ou projet quand il y en a plusieurs. */
function Cartes({ cartes, now }: { cartes: UiDevCarte[]; now: number }) {
  // Chaque carte garde son rang dans l'ensemble, pour l'apparition en cascade.
  const groupes = useMemo(() => {
    const m = new Map<string, { c: UiDevCarte; i: number }[]>()
    cartes.forEach((c, i) => m.set(c.contexte ?? '', [...(m.get(c.contexte ?? '') ?? []), { c, i }]))
    return [...m]
  }, [cartes])
  if (groupes.length < 2) {
    return (
      <ul className="cx-cartes">
        {cartes.map((c, i) => (
          <Carte key={i} c={c} i={i} now={now} sansContexte={false} />
        ))}
      </ul>
    )
  }
  return (
    <div className="cx-groupes">
      {groupes.map(([contexte, cs]) => (
        <section key={contexte} className="cx-groupe">
          <h4 className="cx-groupe__titre">
            <span>{contexte || 'Autres'}</span>
            <small>{cs.length}</small>
          </h4>
          <ul className="cx-cartes">
            {cs.map(({ c, i }) => (
              <Carte key={i} c={c} i={i} now={now} sansContexte />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Frise({ cartes, now }: { cartes: UiDevCarte[]; now: number }) {
  return (
    <ol className="cx-frise">
      {cartes.map((c, i) => (
        <li key={i} className={`cx-jalon cx-ton--${c.statut?.ton ?? 'neutre'}`} style={stagger(i)}>
          <div className="cx-jalon__quand">
            {c.date ? (
              <>
                <strong>{heure(c.date)}</strong>
                <small>{depuis(c.date, now)}</small>
              </>
            ) : (
              <strong>—</strong>
            )}
          </div>
          <span className="cx-jalon__noeud" aria-hidden="true">
            <Icone icone={c.icone} />
          </span>
          <div className="cx-jalon__corps">
            <div className="cx-carte__tete">
              {c.contexte && <span className="cx-contexte cx-contexte--fort">{c.contexte}</span>}
              {c.numero && <span className="cx-numero">{c.numero}</span>}
              {c.statut && <Statut statut={c.statut} />}
            </div>
            <strong className="cx-jalon__titre">{c.titre}</strong>
            {c.extrait && <p className="cx-carte__extrait">{c.extrait}</p>}
            <div className="cx-jalon__pied">
              <Puces puces={c.puces} />
              {c.auteur && <span className="cx-par">par {c.auteur}</span>}
              {c.lien && <Ouvrir lien={c.lien} />}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Grille({ cartes, now }: { cartes: UiDevCarte[]; now: number }) {
  return (
    <ul className="cx-grille">
      {cartes.map((c, i) => (
        <li key={i} className={`cx-tuile cx-ton--${c.statut?.ton ?? 'neutre'}`} style={stagger(i)}>
          <div className="cx-carte__tete">
            <Icone icone={c.icone} />
            {c.statut && <Statut statut={c.statut} />}
            {c.lien && <Ouvrir lien={c.lien} court />}
          </div>
          <strong className="cx-tuile__titre">{c.titre}</strong>
          {c.extrait && <p className="cx-carte__extrait">{c.extrait}</p>}
          <Puces puces={c.puces} />
          {c.faits?.length ? (
            <span className="cx-tuile__faits">
              {c.faits.map((f) => (
                <span key={f.label}>
                  <b>{f.valeur}</b> {f.label.toLowerCase()}
                </span>
              ))}
            </span>
          ) : null}
          {c.date && <time className="cx-tuile__date">mis à jour {depuis(c.date, now)}</time>}
        </li>
      ))}
    </ul>
  )
}

const ERREUR = /\b(error|erreur|failed|échec|fatal|exception)\b/i
const ALERTE = /\b(warn|warning|deprecated|avertissement)\b/i

function Journal({ cartes }: { cartes: UiDevCarte[] }) {
  return (
    <pre className="cx-journal">
      {cartes.map((c, i) => (
        <span key={i} className={ERREUR.test(c.titre) ? 'is-erreur' : ALERTE.test(c.titre) ? 'is-alerte' : undefined}>
          <i>{String(i + 1).padStart(3, ' ')}</i>
          {c.titre}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

function Fiche({ c, now }: { c: UiDevCarte; now: number }) {
  return (
    <div className={`cx-fiche cx-ton--${c.statut?.ton ?? 'neutre'}`}>
      <div className="cx-fiche__tete">
        {c.avatar ? <img className="cx-fiche__avatar" src={c.avatar} alt="" referrerPolicy="no-referrer" /> : <Icone icone={c.icone} className="cx-fiche__icone" />}
        <div>
          {c.contexte && <span className="cx-contexte">{c.contexte}</span>}
          <strong className="cx-fiche__titre">
            {c.numero && <span className="cx-numero">{c.numero}</span>} {c.titre}
          </strong>
          {c.statut && <Statut statut={c.statut} />}
        </div>
        {c.lien && <Ouvrir lien={c.lien} />}
      </div>
      {c.extrait && <p className="cx-fiche__extrait">{c.extrait}</p>}
      <Puces puces={c.puces} />
      {c.faits?.length ? (
        <dl className="cx-faits cx-faits--fiche">
          {c.faits.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.valeur}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Auteur c={c} now={now} />
    </div>
  )
}

export function ConnecteurView({ data }: { data: UiConnecteur }) {
  const now = useNow(30_000)
  const [page, setPage] = useState(1)
  const pagine = data.disposition === 'cartes' || data.disposition === 'grille'
  const pages = pagine ? Math.max(1, Math.ceil(data.cartes.length / PAR_PAGE)) : 1
  const cartes = pagine ? data.cartes.slice((page - 1) * PAR_PAGE, page * PAR_PAGE) : data.cartes
  return (
    <div className={`cx cx--${data.service} cx--${data.disposition}`}>
      <header className="cx-entete">
        <span className="cx-marque" aria-hidden="true">
          {MONOGRAMMES[data.service] ?? data.source.slice(0, 2).toUpperCase()}
        </span>
        <h3 className="cx-entete__titre">{data.titre}</h3>
        {data.resume.length > 0 && (
          <ul className="cx-resume">
            {data.resume.map((r, i) => (
              <li key={r.label} className={r.ton ? `cx-ton--${r.ton}` : undefined} style={stagger(i)}>
                <b>{r.valeur}</b>
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        )}
      </header>
      {data.disposition === 'texte' && data.texte ? (
        <div className="cx-texte">
          <MarkdownBlocks blocks={parseBlocks(data.texte)} />
        </div>
      ) : data.cartes.length === 0 ? (
        <p className="holo-empty">Rien à afficher.</p>
      ) : data.disposition === 'frise' ? (
        <Frise cartes={cartes} now={now} />
      ) : data.disposition === 'grille' ? (
        <Grille cartes={cartes} now={now} />
      ) : data.disposition === 'journal' ? (
        <Journal cartes={cartes} />
      ) : data.disposition === 'fiche' ? (
        <Fiche c={cartes[0]!} now={now} />
      ) : (
        <Cartes cartes={cartes} now={now} />
      )}
      {pages > 1 && (
        <nav className="cx-pages" aria-label="Pages">
          <button type="button" className="holo-action" disabled={page === 1} onClick={() => setPage(page - 1)}>
            ← Précédents
          </button>
          <span>
            {page} / {pages}
          </span>
          <button type="button" className="holo-action" disabled={page === pages} onClick={() => setPage(page + 1)}>
            Suivants →
          </button>
        </nav>
      )}
      {data.total > data.cartes.length && <p className="holo-more">Les {data.cartes.length} premiers sur {data.total}.</p>}
    </div>
  )
}
