import { useContext, useEffect, useState, type CSSProperties } from 'react'
import type { UiRappel, UiRappels } from '@code/protocol'
import { Api } from './api.ts'
import { Stat } from './PersoViews.tsx'

/** Rappels : compte à rebours vers le prochain, alertes en cours, puis la liste par moment. */

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties

/** Maintenant, mis à jour chaque seconde. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** « dans 25 min », « dans 2 h 10 », « maintenant ». */
export function inWords(echeance: number, now: number): string {
  const min = Math.round((echeance - now) / 60_000)
  if (min <= 0) return 'maintenant'
  if (min < 60) return `dans ${min} min`
  if (min < 24 * 60) return `dans ${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`
  const days = Math.round(min / (24 * 60))
  return `dans ${days} jour${days > 1 ? 's' : ''}`
}

/** « 01:24:07 » avant l'échéance (moins d'un jour). */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

const LoopIcon = () => (
  <svg className="rappel-loop" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label="Récurrent">
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </svg>
)

function Ringing({ r, i }: { r: UiRappel; i: number }) {
  const { remind } = useContext(Api)
  return (
    <li className="rappel-alert" style={stagger(i)}>
      <span className="rappel-alert__bell" aria-hidden="true">
        <span />
      </span>
      <span className="rappel-alert__text">
        <span className="rappel-alert__kicker">
          {r.retard ? 'EN RETARD · ' : ''}
          {r.recurrence ? r.recurrence.toUpperCase() : `${r.jour.toUpperCase()} · ${r.heure}`}
          {r.de ? ` · DE ${r.de.toUpperCase()}` : ''}
        </span>
        <strong>{r.texte}</strong>
      </span>
      <span className="rappel-alert__actions">
        <button type="button" className="holo-action holo-action--main" onClick={() => remind(r.id, 'fait')}>
          Fait
        </button>
        <button type="button" className="holo-action" onClick={() => remind(r.id, 'reporter', 10)}>
          +10 min
        </button>
        <button type="button" className="holo-action" onClick={() => remind(r.id, 'reporter', 60)}>
          +1 h
        </button>
      </span>
    </li>
  )
}

export function RappelsView({ data }: { data: UiRappels }) {
  const now = useNow()
  const ringing = data.groupes.find((g) => g.label === 'Qui sonnent')?.rappels ?? []
  const others = data.groupes.filter((g) => g.label !== 'Qui sonnent')
  const next = others
    .flatMap((g) => g.rappels)
    .filter((r) => r.etat === 'a_venir')
    .sort((a, b) => a.echeance - b.echeance)[0]
  const left = next ? next.echeance - now : 0
  // L'anneau se remplit sur la dernière heure avant l'échéance.
  const ring = next ? Math.max(0, Math.min(1, 1 - left / 3_600_000)) : 0
  return (
    <div className="perso perso-rappels">
      <header className="agenda-head">
        <h3 className="perso-fil__subject">{data.titre}</h3>
        <span className="agenda-head__sub">{data.sousTitre}</span>
      </header>

      {ringing.length > 0 && (
        <ol className="rappel-alerts" aria-label="Rappels qui sonnent">
          {ringing.map((r, i) => (
            <Ringing key={r.id} r={r} i={i} />
          ))}
        </ol>
      )}

      <div className="rappel-hero">
        <div className={`rappel-next${next ? '' : ' rappel-next--calm'}`}>
          <svg className="rappel-dial" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="52" className="rappel-dial__track" />
            {Array.from({ length: 60 }, (_, i) => (
              <line key={i} x1="60" y1="4" x2="60" y2={i % 5 ? 8 : 12} transform={`rotate(${i * 6} 60 60)`} className="rappel-dial__tick" />
            ))}
            <circle cx="60" cy="60" r="52" className="rappel-dial__fill" style={{ strokeDashoffset: `${(1 - ring) * 326.7}` }} transform="rotate(-90 60 60)" />
            <line x1="60" y1="60" x2="60" y2="16" className="rappel-dial__hand" style={{ transform: `rotate(${(now / 1000) * 6}deg)` }} />
          </svg>
          <span className="agenda-next__kicker">PROCHAIN RAPPEL</span>
          {next ? (
            <>
              <strong className="rappel-next__clock">{left < 24 * 3_600_000 ? clock(left) : inWords(next.echeance, now)}</strong>
              <span className="agenda-next__title">{next.texte}</span>
              <span className="agenda-next__when">
                {next.jour} · {next.heure}
                {next.recurrence && (
                  <span className="agenda-meta">
                    <LoopIcon />
                    {next.recurrence}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <strong className="rappel-next__clock">—</strong>
              <span className="agenda-next__title">Aucun rappel à venir.</span>
            </>
          )}
        </div>
        <div className="perso-stats">
          {data.kpis.map((k, i) => (
            <Stat key={k.label} k={k} i={i} />
          ))}
        </div>
      </div>

      {others.length === 0 && ringing.length === 0 && <p className="perso-empty">Aucun rappel. Dites « rappelle-moi dans deux heures de… ».</p>}
      {others.map((g) => (
        <section key={g.label} className="rappel-group">
          <h4 className="agenda-list__label">{g.label.toUpperCase()}</h4>
          <ol>
            {g.rappels.map((r, i) => (
              <li key={r.id} className={`rappel-item rappel-item--${r.etat}${data.focus === r.id ? ' is-focus' : ''}`} style={stagger(i)}>
                <span className="rappel-item__time">{r.heure}</span>
                <span className="rappel-item__dot" aria-hidden="true" />
                <span className="rappel-item__text">
                  <strong>{r.texte}</strong>
                  <small>
                    {r.recurrence ? (
                      <>
                        <LoopIcon /> {r.recurrence} · prochain {r.jour}
                      </>
                    ) : r.etat === 'fait' ? (
                      'fait'
                    ) : (
                      `${r.jour} · ${inWords(r.echeance, now)}`
                    )}
                    {r.de ? ` · de la part de ${r.de}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
