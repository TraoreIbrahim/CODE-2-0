import type { FournisseurId } from '@code/protocol'
import { codeConfig } from '../../../../../config/code.config.ts'

/**
 * Tarifs des modèles hors configuration, d'après le catalogue public d'OpenRouter (dollars par token,
 * convertis en dollars par million). Relu une fois par jour ; sans catalogue, le compteur reste prudent.
 */

export type Prix = { input: number; output: number; cacheRead: number; cacheWrite: number }

const catalogue = new Map<string, Prix>()
let charge = 0
let enCours: Promise<void> | null = null

/** Préfixes des modèles de chaque fournisseur dans le catalogue d'OpenRouter. */
const PREFIXES: Partial<Record<FournisseurId, string>> = { openai: 'openai/', gemini: 'google/', mistral: 'mistralai/', deepseek: 'deepseek/' }

type Entree = { id?: string; pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string } }

const parMillion = (v: string | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null
}

/** Range un catalogue (la réponse de `/api/v1/models`). */
export function rangerCatalogue(data: { data?: Entree[] }): number {
  catalogue.clear()
  for (const e of data.data ?? []) {
    const input = parMillion(e.pricing?.prompt)
    const output = parMillion(e.pricing?.completion)
    if (!e.id || input === null || output === null) continue
    catalogue.set(e.id, { input, output, cacheRead: parMillion(e.pricing?.input_cache_read) ?? input, cacheWrite: parMillion(e.pricing?.input_cache_write) ?? input })
  }
  charge = Date.now()
  return catalogue.size
}

/** Relit le catalogue s'il date de plus d'un jour (sans attendre : le compteur reste prudent en attendant). */
export function rafraichirCatalogue(fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = codeConfig.brain.catalogueTarifs
  if (!url || enCours || Date.now() - charge < 86_400_000) return enCours ?? Promise.resolve()
  enCours = fetchImpl(url, { signal: AbortSignal.timeout(20_000) })
    .then(async (res) => {
      if (res.ok) rangerCatalogue((await res.json()) as { data?: Entree[] })
    })
    .catch((err) => console.error('[tarifs] catalogue :', err instanceof Error ? err.message : err))
    .finally(() => {
      enCours = null
    })
  return enCours
}

/** Le tarif d'un modèle d'un fournisseur, s'il est au catalogue. */
export function prixCatalogue(fournisseur: FournisseurId, modele: string): Prix | null {
  if (fournisseur === 'openrouter') return catalogue.get(modele) ?? null
  const prefix = PREFIXES[fournisseur]
  if (prefix) return catalogue.get(prefix + modele) ?? catalogue.get(prefix + modele.replace(/-latest$/, '')) ?? null
  // Groq et les autres hébergeurs : le même nom chez un fournisseur du catalogue (« openai/gpt-oss-120b »).
  if (catalogue.has(modele)) return catalogue.get(modele)!
  for (const [id, p] of catalogue) if (id.endsWith(`/${modele}`)) return p
  return null
}
