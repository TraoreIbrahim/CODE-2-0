import { useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { TypeAppareil, UiAppareil, UiCamera, UiMaison } from '@code/protocol'
import { Api } from './api.ts'

/**
 * La maison, comme un plan : une case par pièce, avec sa température en grand, puis ses appareils. Ce qui est
 * en marche s'éclaire en ambre (une lampe allumée) ; ce qui demande l'attention (porte ouverte, serrure
 * déverrouillée, fumée) passe au rouge. Un toucher allume ou éteint ce qui ne demande pas de validation.
 */

/** Ce qui ne se dit pas « en marche » : une serrure ouverte, une alarme armée, c'est un état, pas un appareil allumé. */
const HORS_MARCHE: ReadonlySet<TypeAppareil> = new Set(['camera', 'serrure', 'alarme', 'portail', 'capteur', 'detecteur'])

const stagger = (i: number) => ({ '--i': Math.min(i, 24) }) as CSSProperties

const P: Partial<Record<TypeAppareil, ReactNode>> = {
  lumiere: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />,
  prise: <path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5" />,
  ventilateur: (
    <>
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 10.4C11 6 12.2 3 15 3.4s2.6 4-3 7M13.4 12.8c4.3 1.3 6.3 3.8 4.9 6.2s-4.8.8-5.1-5.4M10.6 12.8c-3.3 3-6.5 3.4-7.6.8s1.8-4.3 7.6-1.4" />
    </>
  ),
  clim: <path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0zM12 9v7" />,
  chauffe_eau: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM12 17.5a2.5 2.5 0 0 1-2.5-2.5" />,
  volet: <path d="M4 4h16M5 4v16M19 4v16M5 8h14M5 12h14M5 16h14" />,
  portail: <path d="M3 21V8l9-5 9 5v13M7 21v-9h10v9M7 15h10M7 18h10" />,
  media: <path d="M3 6h18v11H3zM8 21h8M12 17v4" />,
  serrure: <path d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2" />,
  alarme: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  camera: <path d="M3 7h12v10H3zM15 10.5l6-3v9l-6-3" />,
  aspirateur: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 9.5h8M12 15.5h.01" />
    </>
  ),
  humidificateur: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  scene: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" />,
  script: <path d="M8 5v14l11-7z" />,
  vanne: <path d="M4 14h16M12 14V7M8 7h8M6 10v8M18 10v8" />,
  sirene: <path d="M7 18v-6a5 5 0 0 1 10 0v6M5 18h14v3H5zM12 3v2M4 7l1.5 1M20 7l-1.5 1" />,
  bouton: <circle cx="12" cy="12" r="5" />
}

function Icone({ type }: { type: TypeAppareil }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {P[type] ?? P.bouton}
    </svg>
  )
}

/** La température d'une pièce : son capteur, sinon ce que mesure sa clim. */
function temperatureDe(appareils: UiAppareil[]): string | null {
  const capteur = appareils.find((a) => a.type === 'capteur' && /°/.test(a.etat))
  if (capteur) return capteur.etat.replace(/\s*°C?$/, '°')
  const clim = appareils.find((a) => a.type === 'clim' && /°C/.test(a.etat))
  return clim ? clim.etat.split(' · ')[0]!.replace(/\s*°C$/, '°') : null
}

function Tuile({ a, i, focus }: { a: UiAppareil; i: number; focus: boolean }) {
  const { maison, ask } = useContext(Api)
  const classes = `mai-app${a.actif ? ' is-actif' : ''}${a.alerte ? ' is-alerte' : ''}${a.indisponible ? ' is-absent' : ''}${focus ? ' is-focus' : ''}`
  const corps = (
    <>
      <span className="mai-app__icone">
        <Icone type={a.type} />
      </span>
      <span className="mai-app__texte">
        <span className="mai-app__nom">{a.nom}</span>
        <span className="mai-app__etat">
          {a.etat}
          {a.detail && <span className="mai-app__detail"> · {a.detail}</span>}
        </span>
      </span>
      {a.sensible && (
        <span className="mai-app__garde" title="Ses commandes demandent votre validation">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
      )}
    </>
  )
  if (a.basculable && !a.indisponible) {
    const verbe = a.type === 'scene' ? 'Activer' : a.type === 'volet' ? (a.actif ? 'Fermer' : 'Ouvrir') : a.actif ? 'Éteindre' : 'Allumer'
    return (
      <li style={stagger(i)}>
        <button type="button" className={classes} aria-pressed={a.type === 'scene' ? undefined : a.actif} aria-label={`${verbe} : ${a.nom}, ${a.etat}`} onClick={() => maison(a.id)}>
          {corps}
        </button>
      </li>
    )
  }
  // Une caméra : la toucher demande son image à l'assistant.
  if (a.type === 'camera' && !a.indisponible) {
    return (
      <li style={stagger(i)}>
        <button type="button" className={classes} aria-label={`Voir l’image : ${a.nom}`} onClick={() => ask(`Montre-moi la caméra « ${a.nom} ».`)}>
          {corps}
        </button>
      </li>
    )
  }
  return (
    <li style={stagger(i)}>
      <div className={classes}>{corps}</div>
    </li>
  )
}

function Piece({ nom, appareils, focus, rang }: { nom: string; appareils: UiAppareil[]; focus: Set<string>; rang: number }) {
  const temperature = temperatureDe(appareils)
  const releves = appareils.filter((a) => a.type === 'capteur' || a.type === 'detecteur')
  const tuiles = appareils.filter((a) => a.type !== 'capteur' && a.type !== 'detecteur')
  const enMarche = tuiles.filter((a) => a.actif && !HORS_MARCHE.has(a.type)).length
  const temperatureVue = releves.find((a) => a.type === 'capteur' && /°/.test(a.etat))
  return (
    <section className="mai-piece" style={stagger(rang)} aria-label={nom}>
      <header className="mai-piece__tete">
        <div className="mai-piece__titre">
          <h3>{nom}</h3>
          <span className="code-mono">{tuiles.length ? (enMarche ? `${enMarche} en marche` : 'tout est éteint') : 'relevés'}</span>
        </div>
        {temperature && (
          <span className="mai-piece__temp" aria-label={`Température : ${temperature}`}>
            {temperature}
          </span>
        )}
      </header>
      {releves.filter((r) => r !== temperatureVue).length > 0 && (
        <ul className="mai-releves">
          {releves
            .filter((r) => r !== temperatureVue)
            .map((r) => (
              <li key={r.id} className={`mai-releve${r.alerte ? ' is-alerte' : r.actif ? ' is-actif' : ''}${r.indisponible ? ' is-absent' : ''}`}>
                <span className="mai-releve__nom">{r.nom}</span> {r.etat}
              </li>
            ))}
        </ul>
      )}
      {tuiles.length > 0 && (
        <ul className="mai-apps">
          {tuiles.map((a, i) => (
            <Tuile key={a.id} a={a} i={i + rang * 2} focus={focus.has(a.id)} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function MaisonView({ data }: { data: UiMaison }) {
  const focus = new Set(data.focus ?? [])
  return (
    <div className="mai">
      <header className="mai-tete">
        <span className="mai-tete__kicker code-mono">HOME ASSISTANT · {data.heure}</span>
        <h2 className="mai-tete__titre">{data.titre}</h2>
        <span className="mai-tete__sous code-mono">{data.sousTitre}</span>
      </header>
      {data.message && (
        <p className="mai-message" role="status">
          {data.message}
        </p>
      )}
      <div className={`mai-plan${data.pieces.length === 1 ? ' mai-plan--seule' : ''}`}>
        {data.pieces.map((p, k) => (
          <Piece key={p.nom} nom={p.nom} appareils={p.appareils} focus={focus} rang={k} />
        ))}
      </div>
    </div>
  )
}

/** L'image d'une caméra, dans un viseur ; « Nouvelle image » la reprend, rien n'est gardé. */
export function CameraView({ data }: { data: UiCamera }) {
  const { camera } = useContext(Api)
  const [attente, setAttente] = useState(false)
  useEffect(() => setAttente(false), [data.heure, data.image, data.erreur])
  return (
    <div className="cam">
      <header className="cam-tete">
        <div>
          <span className="cam-tete__kicker code-mono">CAMÉRA{data.piece ? ` · ${data.piece.toUpperCase()}` : ''}</span>
          <h2 className="cam-tete__titre">{data.nom}</h2>
        </div>
        <button
          type="button"
          className="cam-actualiser"
          disabled={attente}
          onClick={() => {
            setAttente(true)
            camera(data.id)
          }}
        >
          {attente ? 'Prise de vue…' : 'Nouvelle image'}
        </button>
      </header>
      <figure className={`cam-viseur${attente ? ' is-attente' : ''}`}>
        {data.image ? <img src={data.image} alt={`Image de la caméra ${data.nom}${data.heure ? ` à ${data.heure}` : ''}`} /> : <div className="cam-vide">{data.erreur ?? 'Pas d’image.'}</div>}
        <span className="cam-coin cam-coin--hg" aria-hidden="true" />
        <span className="cam-coin cam-coin--hd" aria-hidden="true" />
        <span className="cam-coin cam-coin--bg" aria-hidden="true" />
        <span className="cam-coin cam-coin--bd" aria-hidden="true" />
        {data.heure && (
          <figcaption className="cam-heure code-mono">
            <i aria-hidden="true" /> {data.heure}
          </figcaption>
        )}
      </figure>
      {data.image && data.erreur && <p className="mai-message">{data.erreur}</p>}
      <small className="cam-note">Image prise à l’instant, gardée nulle part.</small>
    </div>
  )
}
