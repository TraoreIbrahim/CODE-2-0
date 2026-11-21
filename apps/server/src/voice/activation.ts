import { codeConfig } from '../../../../config/code.config.ts'

/**
 * Le nom de l'assistant en tête de la phrase qui suit l'appel (« Dis Aya, quel temps fait-il ») : l'app de
 * bureau y joint l'audio d'avant pour ne pas perdre les premiers mots, et l'appel lui-même finit transcrit.
 * Seul le début est retiré : le nom, précédé ou non de « dis », « dis-moi », « hey » ou « ok ».
 */
function motActivation(nom: string): RegExp {
  const echappe = nom.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')
  return new RegExp(`^[\\s,.!?…-]*(?:(?:dis|dit|dites|hey|ok)[\\s,-]*(?:moi[\\s,-]+)?)?${echappe}(?![\\p{L}\\p{N}])[\\s,.!?…-]*`, 'iu')
}

export function sansMotActivation(text: string, nom: string = codeConfig.reglages.nomAssistant): string {
  if (!nom.trim()) return text
  const rest = text.replace(motActivation(nom), '')
  if (rest === text) return text
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}
