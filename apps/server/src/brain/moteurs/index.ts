import { FOURNISSEUR_INFOS, type FournisseurId } from '@code/protocol'
import type { Secrets } from '../../secrets.ts'
import { MoteurClaude } from './claude.ts'
import { MoteurCompat, adresseCompat } from './compat.ts'
import { CleManquante, type Moteur } from './types.ts'

export { CleManquante, MoteurErreur, type BrainEvent, type Moteur } from './types.ts'

/**
 * Le moteur d'un fournisseur, avec les clés de la personne. `ambiante` (propriétaire seulement) : Claude
 * peut se passer de clé si la machine a un profil `ant auth login`.
 */
export function creerMoteur(fournisseur: FournisseurId, secrets: Secrets, { ambiante = false, fetchImpl }: { ambiante?: boolean; fetchImpl?: typeof fetch } = {}): Moteur {
  const info = FOURNISSEUR_INFOS[fournisseur]
  if (fournisseur === 'anthropic') {
    const m = new MoteurClaude(secrets.ANTHROPIC_API_KEY, { ambiante })
    if (!m.pret) throw new CleManquante('Anthropic')
    return m
  }
  const base = adresseCompat(fournisseur)
  if (!base) throw new CleManquante(`${info.nom} (adresse du serveur Ollama, CODE_OLLAMA_URL)`)
  const cle = info.cle ? secrets[info.cle] : undefined
  if (info.cle && !cle) throw new CleManquante(info.nom)
  return new MoteurCompat(fournisseur, base.replace(/\/$/, ''), cle, fetchImpl)
}
