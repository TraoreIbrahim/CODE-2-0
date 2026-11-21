import { useContext, useState, type CSSProperties } from 'react'
import type { UiTache, UiTacheResultat, UiTaches } from '@code/protocol'
import { Api, Panel } from './api.ts'
import { MarkdownBlocks, parseBlocks, plainText, sections } from './Markdown.tsx'
import { inWords, useNow } from './Rappels.tsx'

/** Tâches planifiées : ce que CODE fait seul, à l'heure dite, et ce qu'il a produit. */

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties

const LoopIcon = () => (
  <svg className="rappel-loop" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </svg>
)

/** « 01:24:07 » avant l'échéance. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

function CopyButton({ text, label = 'Copier' }: { text: string; label?: string }) {
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
      {done ? 'Copié ✓' : label}
    </button>
  )
}

function TaskCard({ t, i, focus }: { t: UiTache; i: number; focus: boolean }) {
  const { task, page } = useContext(Api)
  const panel = useContext(Panel)
  const [day, time] = t.prochaine ? t.prochaineLabel.split(' · ') : [t.prochaineLabel, '—']
  const open = (id: number) => page(`${panel.id}~r${id}`, panel.turnId, 'tache_resultat', { execution: id })
  return (
    <li className={`tache-card tache-card--${t.etat}${t.enCours ? ' is-running' : ''}${focus ? ' is-focus' : ''}`} style={stagger(i)}>
      <div className="tache-card__when">
        <strong>{time}</strong>
        <small>{day}</small>
      </div>
      <div className="tache-card__body">
        <span className="tache-card__kicker">
          {t.quand.startsWith('tous') || t.quand.startsWith('du ') || t.quand.startsWith('le ') ? <LoopIcon /> : null}
          {t.quand.toUpperCase()}
        </span>
        <strong className="tache-card__title">{t.titre}</strong>
        <p className="tache-card__consigne">{t.consigne}</p>
        {t.enCours && (
          <span className="tache-card__run" role="status">
            EXÉCUTION EN COURS
            <span aria-hidden="true" />
          </span>
        )}
        {t.derniere && !t.enCours && (
          <button type="button" className={`tache-card__last tache-card__last--${t.derniere.statut}`} onClick={() => open(t.derniere!.id)}>
            <small>{t.derniere.statut === 'ok' ? 'DERNIER RÉSULTAT' : 'DERNIER ESSAI · ÉCHEC'} · {t.derniere.quand.toUpperCase()}</small>
            <span>{t.derniere.resume || 'Ouvrir le résultat'}</span>
          </button>
        )}
      </div>
      <div className="tache-card__actions">
        <button type="button" className="holo-action holo-action--main" disabled={t.enCours || t.etat === 'terminee'} onClick={() => task(t.id, 'executer')}>
          Lancer
        </button>
        {t.etat === 'active' && (
          <button type="button" className="holo-action" onClick={() => task(t.id, 'pause')}>
            Pause
          </button>
        )}
        {t.etat === 'pause' && (
          <button type="button" className="holo-action" onClick={() => task(t.id, 'reprendre')}>
            Reprendre
          </button>
        )}
      </div>
    </li>
  )
}

export function TachesView({ data }: { data: UiTaches }) {
  const now = useNow()
  const next = data.taches.filter((t) => t.prochaine && t.etat === 'active').sort((a, b) => a.prochaine! - b.prochaine!)[0]
  const left = next ? next.prochaine! - now : 0
  return (
    <div className="perso taches">
      <header className="taches-head">
        <div className="agenda-head">
          <h3 className="perso-fil__subject">{data.titre}</h3>
          <span className="agenda-head__sub">{data.sousTitre}</span>
        </div>
        {next && (
          <div className="taches-next">
            <span className="agenda-next__kicker">PROCHAINE EXÉCUTION</span>
            <strong className="taches-next__clock">{left < 24 * 3_600_000 ? clock(left) : inWords(next.prochaine!, now)}</strong>
            <span className="taches-next__what">{next.titre}</span>
          </div>
        )}
      </header>
      {data.taches.length === 0 ? (
        <p className="perso-empty">Aucune tâche. Dites « tous les jours à dix-sept heures, propose-moi deux idées de TikTok… ».</p>
      ) : (
        <ol className="taches-list">
          {data.taches.map((t, i) => (
            <TaskCard key={t.id} t={t} i={i} focus={data.focus === t.id} />
          ))}
        </ol>
      )}
    </div>
  )
}

export function TacheResultView({ data }: { data: UiTacheResultat }) {
  const { task, page } = useContext(Api)
  const panel = useContext(Panel)
  const parts = sections(data.texte)
  const show = (args: Record<string, unknown>, tool = 'tache_resultat') => page(panel.id, panel.turnId, tool, args)
  return (
    <div className="perso tache-res">
      <header className="tache-res__head">
        <span className="agenda-next__kicker">
          RÉSULTAT · {data.quand.toUpperCase()}
          {data.retard ? ' · EN RETARD' : ''}
        </span>
        <h3 className="perso-fil__subject">{data.titre}</h3>
        {data.statut === 'ok' && data.resume && <p className="tache-res__lead">{data.resume}</p>}
        <div className="tache-res__tools">
          {data.texte && <CopyButton text={plainText(data.texte)} label="Tout copier" />}
          <button type="button" className="holo-action" onClick={() => task(data.tacheId, 'executer')}>
            Relancer
          </button>
          <button type="button" className="holo-action" onClick={() => show({}, 'taches_lister')}>
            Toutes les tâches
          </button>
        </div>
      </header>

      {data.statut === 'erreur' && <p className="tache-res__error">{data.resume || 'L’exécution a échoué.'}</p>}
      {data.statut === 'en_cours' && <p className="tache-card__run">EXÉCUTION EN COURS<span aria-hidden="true" /></p>}

      <div className="tache-res__sections">
        {parts.map((s, i) => (
          <section key={i} className="tache-sec" style={stagger(i)}>
            {s.titre !== null && (
              <header className="tache-sec__head">
                <span className="tache-sec__index">{String(i + (parts[0]?.titre === null ? 0 : 1)).padStart(2, '0')}</span>
                <h4>{s.titre}</h4>
                <CopyButton text={plainText(`${s.titre}\n\n${s.corps}`)} />
              </header>
            )}
            <div className="tache-md">
              <MarkdownBlocks blocks={parseBlocks(s.corps)} />
            </div>
          </section>
        ))}
      </div>

      {data.precedentes.length > 0 && (
        <footer className="tache-res__hist">
          <span className="agenda-list__label">PRÉCÉDENTS</span>
          <span className="tache-res__chips">
            {data.precedentes.map((p) => (
              <button key={p.id} type="button" className={`tache-chip tache-chip--${p.statut}`} onClick={() => show({ execution: p.id })}>
                {p.quand}
              </button>
            ))}
          </span>
        </footer>
      )}
    </div>
  )
}
