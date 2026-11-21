import { codeConfig } from '../../../../config/code.config.ts'
import { motsDuLexique } from '../tools/memory.ts'

/**
 * Vocabulaire de la transcription : les mots à mieux reconnaître, envoyés avec chaque phrase.
 * - Scribe (phrase finale) : jusqu'à 1 000 mots-clés.
 * - Deepgram (texte en direct) : les plus utiles seulement, sous sa limite de jetons par requête.
 * En tête, les mots que la personne a corrigés (son lexique), puis ceux de la configuration.
 */

const cfg = () => codeConfig.voice.stt.vocabulaire

/** Un mot-clé accepté par Scribe : moins de 50 caractères, 5 mots au plus ; null sinon. */
export function nettoyer(terme: string): string | null {
  const t = terme.replace(/\s+/g, ' ').trim()
  if (!t || t.length >= 50 || t.split(' ').length > 5) return null
  return t
}

/** Jetons estimés d'un mot-clé pour Deepgram (prudent : un jeton pour trois caractères). */
export const jetons = (t: string) => Math.ceil(t.length / 3) + 1

const pli = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Liste dédoublonnée (sans souci de casse ni d'accents), nettoyée, coupée à `max`. */
function liste(groupes: string[][], max: number, budget = Infinity): string[] {
  const vus = new Set<string>()
  const out: string[] = []
  let total = 0
  for (const groupe of groupes) {
    for (const brut of groupe) {
      const t = nettoyer(brut)
      if (!t) continue
      const cle = pli(t)
      if (vus.has(cle)) continue
      if (out.length >= max) return out
      if (total + jetons(t) > budget) continue
      vus.add(cle)
      out.push(t)
      total += jetons(t)
    }
  }
  return out
}

export type SourcesVocabulaire = {
  /** Son lexique : les mots qu'il a corrigés (memory.ts), en tête des deux listes. */
  lexique: string[]
  /** `voice.stt.keyterms` de la configuration, et le nom de son assistant. */
  configures: string[]
}

export type MotsCles = { scribe: string[]; deepgram: string[] }

/** Les deux listes de mots-clés, de la plus utile à la moins utile. */
export function motsCles(s: SourcesVocabulaire, limites = { scribe: cfg().scribeMax, deepgram: cfg().deepgramMax, jetons: cfg().deepgramJetons }): MotsCles {
  return {
    scribe: liste([s.lexique, s.configures], limites.scribe),
    deepgram: liste([s.lexique, s.configures], limites.deepgram, limites.jetons)
  }
}

/** Les mots-clés de sa prochaine phrase ; `nom` : le nom qu'il a donné à son assistant. */
export function motsClesPour(uid: number, nom = codeConfig.reglages.nomAssistant): MotsCles {
  return motsCles({ lexique: motsDuLexique(uid), configures: [nom, ...codeConfig.voice.stt.keyterms] })
}
