import { useContext, useEffect, type CSSProperties } from 'react'
import type { MeteoCiel, UiMeteo, UiWeb } from '@code/protocol'
import type { Code } from '../hooks.ts'
import { Api } from './api.ts'

/**
 * Météo : une carte, pas une liste de liens. La température en grand, le ciel qui vit (soleil qui
 * tourne, pluie qui tombe), les prochaines heures et les jours, avec la barre des températures.
 * Et les résultats d'une recherche web, quand la personne en a demandé une.
 */

const stagger = (i: number) => ({ '--i': i }) as CSSProperties

const METEO_MS = 30 * 60_000

/** Garde la carte météo à jour (cockpit, téléphone) : à la connexion, toutes les 30 minutes, et quand la ville change. */
export function useMeteoRefresh(code: Code | null, on = true): void {
  const ready = Boolean(code) && on && code!.state.connection === 'connecte'
  const client = code?.client
  const ville = code?.state.utilisateur?.reglages.ville
  useEffect(() => {
    if (!ready || !client) return
    client.refreshMeteo()
    const t = setInterval(() => client.refreshMeteo(), METEO_MS)
    return () => clearInterval(t)
  }, [ready, ville, client])
}

/** L'icône du ciel, animée doucement (le mouvement s'arrête si l'utilisateur le demande au système). */
export function SkyIcon({ ciel, nuit, size = 48 }: { ciel: MeteoCiel; nuit?: boolean; size?: number }) {
  const sun = nuit ? (
    <path className="sky__moon" d="M30 10a14 14 0 1 0 12 20 11 11 0 0 1-12-20z" />
  ) : (
    <g className="sky__sun">
      <circle cx="26" cy="22" r="9" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1="26" y1="6" x2="26" y2="9.5" transform={`rotate(${i * 45} 26 22)`} />
      ))}
    </g>
  )
  const cloud = <path className="sky__cloud" d="M18 44h26a9 9 0 0 0 0-18 12 12 0 0 0-23 3 7.5 7.5 0 0 0-3 15z" />
  const drops = (n: number) =>
    Array.from({ length: n }, (_, i) => <line key={i} className="sky__drop" style={stagger(i)} x1={22 + i * 8} y1="49" x2={20 + i * 8} y2="55" />)
  return (
    <svg className={`sky sky--${ciel}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {ciel === 'soleil' && <g transform="translate(6 10)">{sun}</g>}
      {ciel === 'eclaircies' && (
        <>
          {sun}
          {cloud}
        </>
      )}
      {ciel === 'nuages' && (
        <>
          <path className="sky__cloud sky__cloud--back" d="M12 34h20a7 7 0 0 0 0-14 9 9 0 0 0-17 2 6 6 0 0 0-3 12z" />
          {cloud}
        </>
      )}
      {ciel === 'pluie' && (
        <>
          {cloud}
          {drops(3)}
        </>
      )}
      {ciel === 'orage' && (
        <>
          {cloud}
          <path className="sky__bolt" d="M33 44l-6 9h5l-3 8 9-11h-5l3-6z" />
          {drops(2)}
        </>
      )}
      {ciel === 'brouillard' && (
        <g className="sky__fog">
          {[24, 32, 40, 48].map((y, i) => (
            <line key={y} x1={10 + (i % 2) * 4} y1={y} x2={54 - (i % 2) * 6} y2={y} />
          ))}
        </g>
      )}
      {ciel === 'neige' && (
        <>
          {cloud}
          {[22, 32, 42].map((x, i) => (
            <circle key={x} className="sky__flake" style={stagger(i)} cx={x} cy="53" r="1.8" />
          ))}
        </>
      )}
    </svg>
  )
}

export function MeteoView({ data }: { data: UiMeteo }) {
  const n = data.maintenant
  const min = Math.min(...data.jours.map((j) => j.min), n.temp)
  const max = Math.max(...data.jours.map((j) => j.max), n.temp)
  const span = Math.max(1, max - min)
  const rainSoon = data.heures.find((h) => h.pluie > 0)
  return (
    <div className={`meteo meteo--${n.ciel}${n.nuit ? ' meteo--nuit' : ''}`}>
      <div className="meteo__now">
        <div className="meteo__icon">
          <SkyIcon ciel={n.ciel} nuit={n.nuit} size={112} />
        </div>
        <div className="meteo__main">
          <p className="meteo__lieu code-mono">{data.lieu.toUpperCase()}</p>
          <p className="meteo__temp">
            {n.temp}
            <span>°C</span>
          </p>
          <p className="meteo__sky">{n.libelle}</p>
        </div>
        <dl className="meteo__facts">
          {n.ressenti > n.temp && (
            <div>
              <dt>Ressenti</dt>
              <dd>{n.ressenti} °C</dd>
            </div>
          )}
          <div>
            <dt>Humidité</dt>
            <dd>{n.humidite} %</dd>
          </div>
          <div>
            <dt>Vent</dt>
            <dd>{n.vent} km/h</dd>
          </div>
          <div>
            <dt>Pluie</dt>
            <dd>{rainSoon ? `vers ${rainSoon.heure.replace(':00', ' h')}` : 'aucune d’ici 12 h'}</dd>
          </div>
        </dl>
      </div>

      {data.heures.length > 0 && (
        <ol className="meteo__hours" aria-label="Prochaines heures">
          {data.heures.map((h, i) => (
            <li key={h.heure} style={stagger(i)} className={h.pluie > 0 ? 'is-rain' : undefined}>
              <span className="meteo__h code-mono">{h.heure.replace(':00', ' h')}</span>
              <SkyIcon ciel={h.ciel} nuit={h.nuit} size={30} />
              <b>{h.temp}°</b>
              <span className="meteo__mm code-mono">{h.pluie > 0 ? `${String(h.pluie).replace('.', ',')} mm` : ' '}</span>
            </li>
          ))}
        </ol>
      )}

      {data.jours.length > 0 && (
        <ol className="meteo__days" aria-label="Prochains jours">
          {data.jours.map((j, i) => (
            <li key={j.jour} style={stagger(i)}>
              <span className="meteo__day">{j.jour}</span>
              <SkyIcon ciel={j.ciel} size={28} />
              <span className="meteo__daysky">{j.libelle}</span>
              <span className="meteo__min code-mono">{j.min}°</span>
              <span className="meteo__bar" aria-hidden="true">
                <i style={{ left: `${((j.min - min) / span) * 100}%`, right: `${((max - j.max) / span) * 100}%` }} />
              </span>
              <span className="meteo__max code-mono">{j.max}°</span>
              <span className="meteo__mm code-mono">{j.pluie >= 0.5 ? `${String(j.pluie).replace('.', ',')} mm` : ''}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="meteo__src code-mono">
        PRÉVISIONS {data.source.toUpperCase()} · MISES À JOUR À {data.maj.replace(':', ' H ')}
      </p>
    </div>
  )
}

// ── Recherche web ──────────────────────────────────────────────────────────

/** Les résultats d'une recherche demandée : un clic demande à CODE de lire la page (rien ne s'ouvre seul). */
export function WebView({ data }: { data: UiWeb }) {
  const { ask } = useContext(Api)
  return (
    <ol className="web-res">
      {data.resultats.map((r, i) => (
        <li key={r.url} style={stagger(i)}>
          <button type="button" className="web-res__item" onClick={() => ask(`Lis-moi l’essentiel de cette page : ${r.url}`)} title={r.url}>
            <span className="web-res__mark code-mono" aria-hidden="true">
              {r.site.replace(/^(m|fr|en)\./, '').slice(0, 2).toUpperCase()}
            </span>
            <span className="web-res__body">
              <span className="web-res__site code-mono">
                {r.site}
                {r.date && <em> · {r.date}</em>}
              </span>
              <strong className="web-res__title">{r.titre}</strong>
              {r.resume && <span className="web-res__resume">{r.resume}</span>}
            </span>
            <span className="web-res__go" aria-hidden="true">
              LIRE →
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}
