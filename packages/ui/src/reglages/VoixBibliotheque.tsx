import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { QualiteVoix, VoixBibliotheque, VoixRecherche } from '@code/protocol'
import type { Code } from '../hooks.ts'
import { Label, reglagesOf } from './fields.tsx'

/**
 * Les voix ElevenLabs au-delà des voix de base : la qualité du modèle, et la bibliothèque publique limitée aux
 * voix françaises natives. On écoute l'extrait fourni par ElevenLabs (rien n'est facturé), puis « Ajouter » la
 * range dans son compte ElevenLabs et la choisit aussitôt.
 */

type Props = { code: Code }

const QUALITES: { id: QualiteVoix; nom: string; aide: string }[] = [
  { id: 'rapide', nom: 'Rapide', aide: 'Répond sans attendre. Idéal pour converser.' },
  { id: 'naturelle', nom: 'Naturelle', aide: 'Plus humaine, intonations plus riches ; démarre un peu plus tard.' }
]

/** Rapide ou naturelle : le modèle ElevenLabs. Seulement quand ElevenLabs parle. */
export function QualiteVoixField({ code }: Props) {
  const r = reglagesOf(code)
  if (!r || !code.state.elevenlabs || (r.synthese !== 'elevenlabs' && r.synthese !== 'auto')) return null
  const actuelle = QUALITES.find((q) => q.id === r.qualiteVoix) ?? QUALITES[0]!
  return (
    <div className="rg-field">
      <Label>Rendu ElevenLabs</Label>
      <div className="rg-chips" role="radiogroup" aria-label="Rendu de la voix">
        {QUALITES.map((q) => (
          <button key={q.id} type="button" role="radio" aria-checked={r.qualiteVoix === q.id} className="rg-chip" onClick={() => r.qualiteVoix !== q.id && code.client.setReglages({ qualiteVoix: q.id })}>
            {q.nom}
          </button>
        ))}
      </div>
      <small className="rg-hint">{actuelle.aide}</small>
    </div>
  )
}

const GENRES: { id: VoixRecherche['genre']; nom: string }[] = [
  { id: undefined, nom: 'Toutes' },
  { id: 'femme', nom: 'Femmes' },
  { id: 'homme', nom: 'Hommes' }
]
const USAGES: { id: VoixRecherche['usage']; nom: string }[] = [
  { id: undefined, nom: 'Tout usage' },
  { id: 'conversation', nom: 'Conversation' },
  { id: 'narration', nom: 'Narration' },
  { id: 'infos', nom: 'Infos' }
]

/** Une empreinte d'onde propre à chaque voix (tirée de son identifiant) : on les distingue d'un coup d'œil. */
function empreinte(id: string, n = 28): number[] {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177) + i
    const enveloppe = Math.sin((Math.PI * (i + 0.5)) / n)
    return 0.18 + 0.82 * enveloppe * (((h >>> 0) % 1000) / 1000)
  })
}

export function VoixBibliothequeField({ code }: Props) {
  const { state, client } = code
  const r = reglagesOf(code)
  const [ouverte, setOuverte] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [genre, setGenre] = useState<VoixRecherche['genre']>()
  const [usage, setUsage] = useState<VoixRecherche['usage']>('conversation')
  const [ecoute, setEcoute] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const b = state.bibliotheque
  const ajout = state.voixAjout

  // Nouvelle recherche à chaque filtre (la saisie attend une pause).
  useEffect(() => {
    if (!ouverte) return
    const t = setTimeout(() => client.chercherVoix({ recherche: recherche.trim() || undefined, genre, usage, page: 0 }), recherche ? 350 : 0)
    return () => clearTimeout(t)
  }, [ouverte, recherche, genre, usage, client])

  // Fermée ou démontée : l'extrait s'arrête.
  useEffect(() => {
    if (!ouverte) audio.current?.pause()
    return () => audio.current?.pause()
  }, [ouverte])

  if (!r || !state.elevenlabs) return null

  const ecouter = (v: VoixBibliotheque) => {
    if (!v.apercu) return
    if (ecoute === v.id) {
      audio.current?.pause()
      return setEcoute(null)
    }
    audio.current?.pause()
    const a = new Audio(v.apercu)
    audio.current = a
    a.onended = a.onerror = () => setEcoute((e) => (e === v.id ? null : e))
    setEcoute(v.id)
    void a.play().catch(() => setEcoute(null))
  }

  if (!ouverte) {
    return (
      <div className="rg-field">
        <button type="button" className="vb-ouvrir" onClick={() => setOuverte(true)}>
          <span className="vb-ouvrir__onde" aria-hidden="true">
            {empreinte('bibliotheque-fr', 14).map((h, i) => (
              <i key={i} style={{ '--h': h } as CSSProperties} />
            ))}
          </span>
          <span className="vb-ouvrir__texte">
            <strong>Voix françaises d’ElevenLabs</strong>
            <small>Des milliers de voix natives, à écouter avant de choisir. Les voix ci-dessus sont anglophones.</small>
          </span>
          <span className="vb-ouvrir__fleche code-mono" aria-hidden="true">
            PARCOURIR ›
          </span>
        </button>
      </div>
    )
  }

  return (
    <section className="rg-field vb" aria-labelledby="vb-titre">
      <header className="vb__tete">
        <div>
          <span className="vb__kicker code-mono">BIBLIOTHÈQUE ELEVENLABS · FRANÇAIS</span>
          <h3 id="vb-titre" className="vb__titre">
            Trouver sa voix
          </h3>
        </div>
        <button type="button" className="rg-chip rg-chip--ghost" onClick={() => setOuverte(false)}>
          Fermer
        </button>
      </header>

      <input className="rg-input vb__recherche" type="search" value={recherche} placeholder="Chercher : calme, grave, radio, Québec…" aria-label="Chercher une voix" onChange={(e) => setRecherche(e.target.value)} />
      <div className="vb__filtres">
        <div className="rg-chips" role="radiogroup" aria-label="Genre">
          {GENRES.map((g) => (
            <button key={g.nom} type="button" role="radio" aria-checked={genre === g.id} className="rg-chip vb__chip" onClick={() => setGenre(g.id)}>
              {g.nom}
            </button>
          ))}
        </div>
        <div className="rg-chips" role="radiogroup" aria-label="Usage">
          {USAGES.map((u) => (
            <button key={u.nom} type="button" role="radio" aria-checked={usage === u.id} className="rg-chip vb__chip" onClick={() => setUsage(u.id)}>
              {u.nom}
            </button>
          ))}
        </div>
      </div>

      {ajout && !ajout.busy && (
        <p className={ajout.erreur ? 'rg-error' : 'rg-note vb__ok'} role="status">
          {ajout.erreur ?? `« ${ajout.nom} » est dans votre compte ElevenLabs, et c’est maintenant la voix de l’assistant.`}
        </p>
      )}
      {b?.erreur && <p className="rg-error">{b.erreur}</p>}

      <ul className="vb__liste" aria-busy={b?.chargement ?? true}>
        {(b?.voix ?? []).map((v, i) => {
          const choisie = r.voix === v.id
          const enAjout = ajout?.busy && ajout.id === v.id
          const joue = ecoute === v.id
          return (
            <li key={v.id} className={`vb-voix${joue ? ' is-joue' : ''}${choisie ? ' is-choisie' : ''}`} style={{ '--i': Math.min(i % 24, 12) } as CSSProperties}>
              <button type="button" className="vb-voix__jouer" disabled={!v.apercu} aria-label={joue ? `Arrêter l’extrait de ${v.nom}` : `Écouter ${v.nom}`} onClick={() => ecouter(v)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {joue ? <path d="M7 6h3.5v12H7zM13.5 6H17v12h-3.5z" /> : <path d="M8 5.5v13l10.5-6.5z" />}
                </svg>
              </button>
              <div className="vb-voix__corps">
                <div className="vb-voix__ligne">
                  <strong className="vb-voix__nom">{v.nom}</strong>
                  {v.ajouts > 0 && <span className="vb-voix__ajouts code-mono">{v.ajouts >= 1000 ? `${Math.round(v.ajouts / 1000)} k` : v.ajouts} ajouts</span>}
                </div>
                <span className="vb-voix__onde" aria-hidden="true">
                  {empreinte(v.id).map((h, k) => (
                    <i key={k} style={{ '--h': h, '--k': k } as CSSProperties} />
                  ))}
                </span>
                {v.etiquettes.length > 0 && <span className="vb-voix__etiquettes code-mono">{v.etiquettes.join(' · ')}</span>}
                {v.description && <p className="vb-voix__description">{v.description}</p>}
              </div>
              <div className="vb-voix__action">
                {choisie ? (
                  <span className="vb-voix__choisie code-mono">CHOISIE</span>
                ) : v.ajoutee ? (
                  <button type="button" className="rg-chip vb__chip" onClick={() => client.setReglages({ voix: v.id })}>
                    Choisir
                  </button>
                ) : (
                  <button type="button" className="rg-chip vb__ajouter" disabled={Boolean(ajout?.busy)} onClick={() => client.ajouterVoix(v)}>
                    {enAjout ? 'Ajout…' : 'Ajouter'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {b?.chargement && <p className="rg-note vb__attente">Recherche dans la bibliothèque…</p>}
      {b && !b.chargement && !b.erreur && b.voix.length === 0 && <p className="rg-note">Aucune voix française pour ces filtres : élargissez la recherche.</p>}
      {b && !b.chargement && b.suite && (
        <button type="button" className="rg-chip rg-chip--ghost vb__plus" onClick={() => client.chercherVoix({ ...b.filtres, page: (b.filtres.page ?? 0) + 1 })}>
          Plus de voix
        </button>
      )}
      <small className="rg-hint">
        L’extrait est celui d’ElevenLabs, gratuit. Une voix ajoutée rejoint votre compte ElevenLabs (« My Voices ») ; les voix de la bibliothèque demandent un abonnement ElevenLabs payant pour parler.
      </small>
    </section>
  )
}
