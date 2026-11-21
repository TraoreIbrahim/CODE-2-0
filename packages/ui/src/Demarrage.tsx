import { useEffect, useState } from 'react'
import type { Connection } from './client.ts'
import { BrandMark } from './Logo.tsx'
import { Orb } from './Orb.tsx'

/** Assez long pour ne pas clignoter quand le serveur répond tout de suite. */
const MINIMUM_MS = 900
/** Au-delà, l'écran s'efface quand même : l'app montre alors « Injoignable » et ses nouveaux essais. */
const MAXIMUM_MS = 15_000
/** Durée du fondu de sortie (voir demarrage.css). */
const SORTIE_MS = 550

/** Ce que dit l'écran pendant l'attente : un serveur qui sort de veille peut mettre quelques secondes. */
export function messageDemarrage(ecoule: number): string {
  if (ecoule < 4_000) return 'Connexion au serveur'
  if (ecoule < 9_000) return 'Le serveur se réveille'
  return 'Encore un instant'
}

/**
 * Écran de démarrage, à l'ouverture de l'app (ordinateur et téléphone) : l'orbe sur le fond de l'app, à la
 * couleur de la personne, le temps que la connexion s'établisse et que l'historique arrive. Posé par-dessus
 * l'app, qui se prépare dessous ; il s'efface dès que le serveur répond (ou demande de se connecter), et ne
 * revient pas aux reconnexions suivantes. `connexion` : absente tant que l'adresse du serveur n'est pas connue.
 */
export function Demarrage({ connexion, taille = 240 }: { connexion: Connection | undefined; taille?: number }) {
  const [debut] = useState(() => performance.now())
  const [ecoule, setEcoule] = useState(0)
  const [phase, setPhase] = useState<'attente' | 'sortie' | 'fini'>('attente')
  const pret = connexion === 'connecte' || connexion === 'auth'

  useEffect(() => {
    if (phase !== 'attente') return
    const t = setInterval(() => setEcoule(performance.now() - debut), 250)
    return () => clearInterval(t)
  }, [phase, debut])

  useEffect(() => {
    if (phase !== 'attente') return
    const maintenant = performance.now() - debut
    const delai = pret ? Math.max(0, MINIMUM_MS - maintenant) : Math.max(0, MAXIMUM_MS - maintenant)
    const t = setTimeout(() => setPhase('sortie'), delai)
    return () => clearTimeout(t)
  }, [pret, phase, debut])

  useEffect(() => {
    if (phase !== 'sortie') return
    const t = setTimeout(() => setPhase('fini'), SORTIE_MS)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'fini') return null
  return (
    <div className={`demarrage code-grid-bg${phase === 'sortie' ? ' demarrage--sortie' : ''}`} role="status" aria-live="polite" aria-label="CODE 2.0 démarre">
      <div className="demarrage__halo" aria-hidden="true" />
      <div className="demarrage__orbe">
        <Orb mode={pret ? 'ecoute' : 'repos'} size={taille} label="CODE 2.0 démarre" />
      </div>
      <span className="code-logo demarrage__logo">
        <BrandMark size={30} />
        <span className="code-brand code-logo__name">CODE 2.0</span>
      </span>
      <p className="demarrage__etat code-mono">
        {pret ? 'Prêt' : messageDemarrage(ecoule)}
        <span className="demarrage__points" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>
      <span className="demarrage__barre" aria-hidden="true" />
    </div>
  )
}
