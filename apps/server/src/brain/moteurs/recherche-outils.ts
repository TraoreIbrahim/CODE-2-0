import type { Tool } from '../../tools/types.ts'

/**
 * Recherche d'outils pour les moteurs qui n'en ont pas (Claude a la sienne, côté Anthropic) : seuls les
 * outils courants sont décrits d'avance ; les autres se trouvent par mots-clés et sont décrits à partir de
 * l'étape suivante.
 */

export const OUTILS_CHERCHER = 'outils_chercher'

export const outilsChercherDef = {
  name: OUTILS_CHERCHER,
  description:
    'Cherche parmi tes autres outils (fichiers, Drive, tâches planifiées, actions secondaires, connecteurs…) et les rend utilisables dès l’étape suivante. Par nom (« drive_creer_tableur ») ou par mots-clés (« itinéraire », « tableur », « github pull requests »). À faire avant de dire que tu ne peux pas.',
  parameters: {
    type: 'object',
    properties: { requete: { type: 'string', description: 'Nom d’outil ou quelques mots-clés.' } },
    required: ['requete']
  }
}

/** Mots comparables : minuscules, sans accents, sans pluriel simple. */
function mots(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 1)
    .map((m) => (m.length > 3 ? m.replace(/(es|s|x)$/, '') : m))
}

const VIDES = new Set(['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'en', 'pour', 'mes', 'mon', 'ma', 'sur', 'dan', 'au', 'aux'])

/** Les outils les plus proches de la requête (5 au plus) ; un nom exact passe devant. */
export function chercherOutils(requete: string, outils: Tool[], max = 5): Tool[] {
  const exact = outils.find((t) => t.name === requete.trim())
  const q = mots(requete).filter((m) => !VIDES.has(m))
  const notes = outils
    .map((t) => {
      const nom = mots(t.name.replace(/_/g, ' '))
      const desc = mots(t.description)
      let score = 0
      for (const m of q) {
        if (nom.includes(m)) score += 3
        else if (nom.some((n) => n.startsWith(m) || m.startsWith(n))) score += 2
        // Description : le mot exact, ou une autre forme du même mot (« planifiée », « planifie »).
        if (desc.includes(m)) score += 1
        else if (m.length >= 5 && desc.some((d) => d.length >= 5 && (d.startsWith(m) || m.startsWith(d)))) score += 0.5
      }
      return { t, score }
    })
    .filter((x) => x.score > 0 && x.t !== exact)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t)
  return [...(exact ? [exact] : []), ...notes].slice(0, max)
}

/** Ce que la recherche répond au modèle. */
export function reponseRecherche(trouves: Tool[]): string {
  if (!trouves.length) return 'Aucun outil ne correspond : essaie d’autres mots-clés, ou dis que tu ne peux pas le faire.'
  return `Outils maintenant disponibles :\n${trouves.map((t) => `- ${t.name} : ${t.description.split(/(?<=\.)\s/)[0]}`).join('\n')}`
}
