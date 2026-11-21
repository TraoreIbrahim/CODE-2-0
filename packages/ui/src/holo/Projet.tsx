import type { CSSProperties, ReactNode } from 'react'
import type { UiDevTon, UiProjet, UiProjetAppli, UiProjetBuild, UiProjetDeploiement, UiProjetDepot, UiProjetSite } from '@code/protocol'
import { depuis, Icone, Ouvrir, Statut } from './Connecteur.tsx'
import { useNow } from './Rappels.tsx'

/**
 * « Où en est Atlas ? » : un tableau de bord du projet. En tête, un anneau en trois arcs — code, web,
 * mobile — chacun de la couleur de son pire état, et le bilan en une phrase. Dessous, trois couloirs : les
 * dépôts GitHub (intégration continue, derniers commits, pull requests), les sites Vercel (production,
 * dernier déploiement) et les applications Expo (dernier build iOS et Android, l'erreur s'il a échoué).
 */

const stagger = (i: number) => ({ '--i': Math.min(i, 20) }) as CSSProperties

/** Le pire état d'un couloir : l'échec l'emporte, puis ce qui tourne, puis le vert. */
function pire(tons: (UiDevTon | undefined)[]): UiDevTon {
  if (tons.includes('echec')) return 'echec'
  if (tons.some((t) => t === 'encours' || t === 'attente')) return 'encours'
  if (tons.includes('ok')) return 'ok'
  return 'neutre'
}

const tonsDepots = (d: UiProjetDepot[]) => d.map((x) => x.ci?.statut.ton ?? (x.commits.length ? 'ok' : undefined))
const tonsSites = (s: UiProjetSite[]) => s.flatMap((x) => [x.production?.statut.ton, x.dernier?.statut.ton])
const tonsApplis = (a: UiProjetAppli[]) => a.flatMap((x) => x.builds.map((b) => b.statut.ton))

const court = (depot: string) => depot.split('/')[1] ?? depot

// ── L'anneau ────────────────────────────────────────────────────────────

const R = 40
const C = 2 * Math.PI * R
/** Trois arcs de 110°, séparés de 10°, le premier en haut à gauche. */
const ARC = (C * 110) / 360

function Anneau({ tons, sante }: { tons: [UiDevTon, UiDevTon, UiDevTon]; sante: UiProjet['sante'] }) {
  return (
    <svg className={`pj-anneau pj-anneau--${sante}`} viewBox="0 0 100 100" aria-hidden="true">
      <circle className="pj-anneau__fond" cx="50" cy="50" r={R} />
      {tons.map((ton, i) => (
        <circle
          key={i}
          className={`pj-anneau__arc cx-ton--${ton}`}
          cx="50"
          cy="50"
          r={R}
          strokeDasharray={`${ARC} ${C - ARC}`}
          strokeDashoffset={-((C * (i * 120 + 5)) / 360)}
          style={stagger(i)}
        />
      ))}
      <g className={`pj-anneau__coeur cx-ton--${sante === 'echec' ? 'echec' : sante === 'encours' ? 'encours' : sante === 'ok' ? 'ok' : 'neutre'}`}>
        {sante === 'ok' && <path d="M38 51l8 8 16-17" />}
        {sante === 'echec' && <path d="M50 36v17M50 63v.5" />}
        {sante === 'encours' && <path d="M62 50a12 12 0 1 1-4-9M62 36v6h-6" />}
        {sante === 'inconnu' && <path d="M44 44a6 6 0 1 1 8 6c-2 1-2 2-2 4M50 62v.5" />}
      </g>
    </svg>
  )
}

// ── Couloirs ────────────────────────────────────────────────────────────

function Couloir({ service, titre, sous, ton, n, vide, children }: { service: string; titre: string; sous: string; ton: UiDevTon; n: number; vide: string; children: ReactNode }) {
  return (
    <section className={`pj-couloir cx--${service} cx-ton--${ton}`}>
      <h4 className="pj-couloir__titre">
        <span className="pj-couloir__point" aria-hidden="true" />
        <strong>{titre}</strong>
        <small>{sous}</small>
        {n > 0 && <b>{n}</b>}
      </h4>
      {n > 0 ? <ul className="pj-liste">{children}</ul> : <p className="pj-vide">{vide}</p>}
    </section>
  )
}

function Depot({ d, i, now }: { d: UiProjetDepot; i: number; now: number }) {
  return (
    <li className={`pj-carte cx-ton--${d.ci?.statut.ton ?? 'neutre'}`} style={stagger(i)}>
      <div className="pj-carte__tete">
        <Icone icone="depot" />
        <strong className="pj-carte__nom" title={d.nom}>
          {court(d.nom)}
        </strong>
        {d.prive && (
          <svg className="pj-cadenas" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-label="Privé">
            <rect x="5" y="11" width="14" height="10" rx="1.5" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        )}
        <Ouvrir lien={d.lien} court />
      </div>
      <div className="pj-ligne">
        {d.ci ? (
          <a className="pj-ci" href={d.ci.lien} target="_blank" rel="noreferrer" title={`${d.ci.titre} · ${new Date(d.ci.date).toLocaleString('fr-FR')}`}>
            <Statut statut={d.ci.statut} />
            <span>{d.ci.titre}</span>
          </a>
        ) : (
          <span className="pj-ci pj-ci--sans">Pas d’intégration continue</span>
        )}
        <span className="pj-branche">{d.branche}</span>
      </div>
      {d.commits.length > 0 && (
        <ol className="pj-commits">
          {d.commits.slice(0, 3).map((c) => (
            <li key={c.sha}>
              <a href={c.lien} target="_blank" rel="noreferrer">
                <code>{c.sha}</code>
                <span>{c.message}</span>
                <time dateTime={c.date}>{depuis(c.date, now)}</time>
              </a>
            </li>
          ))}
        </ol>
      )}
      {d.prs.length > 0 && (
        <div className="pj-prs">
          <span className="pj-prs__compte">
            <Icone icone="pr" />
            {d.prs.length}
            {d.prsPlus ? '+' : ''} PR ouverte{d.prs.length > 1 ? 's' : ''}
          </span>
          {d.prs.slice(0, 3).map((p) => (
            <a key={p.numero} className={`pj-pr${p.brouillon ? ' pj-pr--brouillon' : ''}`} href={p.lien} target="_blank" rel="noreferrer">
              <b>#{p.numero}</b> {p.titre}
            </a>
          ))}
        </div>
      )}
    </li>
  )
}

function Deploiement({ d, now, principal }: { d: UiProjetDeploiement; now: number; principal: boolean }) {
  const corps = (
    <>
      <span className="pj-deploiement__cible">{d.cible === 'production' ? 'Production' : 'Prévisualisation'}</span>
      <Statut statut={d.statut} />
      <time dateTime={d.date}>{depuis(d.date, now)}</time>
      {(d.commit || d.branche) && (
        <span className="pj-deploiement__commit">
          {d.branche && <span className="pj-branche">{d.branche}</span>}
          {d.commit}
        </span>
      )}
    </>
  )
  const cls = `pj-deploiement cx-ton--${d.statut.ton}${principal ? ' pj-deploiement--principal' : ''}`
  return d.lien ? (
    <a className={cls} href={d.lien} target="_blank" rel="noreferrer">
      {corps}
    </a>
  ) : (
    <div className={cls}>{corps}</div>
  )
}

function Site({ s, i, now }: { s: UiProjetSite; i: number; now: number }) {
  return (
    <li className={`pj-carte cx-ton--${s.production?.statut.ton ?? s.dernier?.statut.ton ?? 'neutre'}`} style={stagger(i)}>
      <div className="pj-carte__tete">
        <Icone icone="deploiement" />
        <strong className="pj-carte__nom">{s.nom}</strong>
        {s.framework && <span className="pj-branche">{s.framework}</span>}
        {s.lien && <Ouvrir lien={s.lien} court />}
      </div>
      {s.lien && (
        <a className="pj-domaine" href={s.lien} target="_blank" rel="noreferrer">
          {s.lien.replace(/^https:\/\//, '')}
        </a>
      )}
      {s.production ? <Deploiement d={s.production} now={now} principal /> : <p className="pj-vide pj-vide--petit">Jamais déployé en production.</p>}
      {s.dernier && <Deploiement d={s.dernier} now={now} principal={false} />}
    </li>
  )
}

const PLATEFORMES: UiProjetBuild['plateforme'][] = ['ios', 'android']
const PLATEFORME_FR = { ios: 'iOS', android: 'Android' }

function Appli({ a, i, now }: { a: UiProjetAppli; i: number; now: number }) {
  const echec = a.builds.find((b) => b.erreur)
  return (
    <li className={`pj-carte cx-ton--${pire(a.builds.map((b) => b.statut.ton))}`} style={stagger(i)}>
      <div className="pj-carte__tete">
        <Icone icone="projet" />
        <strong className="pj-carte__nom">{a.nom}</strong>
        <span className="pj-id">{a.id}</span>
        <Ouvrir lien={a.lien} court />
      </div>
      <div className="pj-plateformes">
        {PLATEFORMES.map((p) => {
          const b = a.builds.find((x) => x.plateforme === p)
          return b ? (
            <a key={p} className={`pj-plateforme cx-ton--${b.statut.ton}`} href={b.lien} target="_blank" rel="noreferrer">
              <span className="pj-plateforme__tete">
                <Icone icone={p} />
                {PLATEFORME_FR[p]}
              </span>
              <Statut statut={b.statut} />
              <span className="pj-plateforme__version">{b.version ?? '—'}</span>
              <small>
                {b.profil && <>{b.profil} · </>}
                {depuis(b.date, now)}
              </small>
            </a>
          ) : (
            <span key={p} className="pj-plateforme pj-plateforme--sans">
              <span className="pj-plateforme__tete">
                <Icone icone={p} />
                {PLATEFORME_FR[p]}
              </span>
              <small>Aucun build</small>
            </span>
          )
        })}
      </div>
      {echec?.erreur && (
        <p className="pj-erreur">
          <b>{PLATEFORME_FR[echec.plateforme]}</b> {echec.erreur}
        </p>
      )}
    </li>
  )
}

// ── Le tableau ──────────────────────────────────────────────────────────

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Le service n'est pas relié : le couloir le dit au lieu de « rien trouvé ». */
function absent(manques: string[], service: string): string | undefined {
  const m = manques.find((x) => x.startsWith(`${service} :`))?.slice(service.length + 3)
  return m && `${m.charAt(0).toUpperCase()}${m.slice(1)}.`
}

export function ProjetView({ data }: { data: UiProjet }) {
  const now = useNow(30_000)
  const tons: [UiDevTon, UiDevTon, UiDevTon] = [pire(tonsDepots(data.depots)), pire(tonsSites(data.sites)), pire(tonsApplis(data.applis))]
  const vide = (service: string, quoi: string) => absent(data.manques, service) ?? `Aucun ${quoi} « ${data.nom} ».`
  return (
    <div className={`cx pj pj--${data.sante}`}>
      <header className="pj-entete">
        <Anneau tons={tons} sante={data.sante} />
        <div className="pj-entete__texte">
          <span className="pj-entete__sur">Projet</span>
          <h3 className="pj-entete__nom">{data.nom}</h3>
          <p className="pj-entete__phrase">{data.phrase}</p>
        </div>
        <dl className="pj-compte">
          {(
            [
              ['Dépôts', data.depots.length, tons[0]],
              ['Sites', data.sites.length, tons[1]],
              ['Applis', data.applis.length, tons[2]]
            ] as const
          ).map(([label, n, ton], i) => (
            <div key={label} className={`cx-ton--${ton}`} style={stagger(i)}>
              <dt>{label}</dt>
              <dd>{n}</dd>
            </div>
          ))}
          <div className="pj-compte__heure">
            <dt>Vérifié</dt>
            <dd>{heure(data.verifieLe)}</dd>
          </div>
        </dl>
      </header>
      <div className="pj-couloirs">
        <Couloir service="github" titre="Code" sous="GitHub" ton={tons[0]} n={data.depots.length} vide={vide('GitHub', 'dépôt nommé')}>
          {data.depots.map((d, i) => (
            <Depot key={d.nom} d={d} i={i} now={now} />
          ))}
        </Couloir>
        <Couloir service="vercel" titre="Web" sous="Vercel" ton={tons[1]} n={data.sites.length} vide={vide('Vercel', 'site nommé')}>
          {data.sites.map((s, i) => (
            <Site key={s.nom} s={s} i={i + 2} now={now} />
          ))}
        </Couloir>
        <Couloir service="expo" titre="Mobile" sous="Expo" ton={tons[2]} n={data.applis.length} vide={vide('Expo', 'projet nommé')}>
          {data.applis.map((a, i) => (
            <Appli key={a.id} a={a} i={i + 4} now={now} />
          ))}
        </Couloir>
      </div>
    </div>
  )
}
