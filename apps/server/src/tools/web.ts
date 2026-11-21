import type { UiWeb } from '@code/protocol'
import type { Tool } from './types.ts'

/**
 * Résultats d'une recherche web à l'écran : seulement quand la personne a demandé une recherche
 * (« trouve-moi », « cherche les appels d'offres… », « quelles sont tes sources »). Pour une simple
 * information (un prix, un taux, un horaire), CODE répond directement, sans rien afficher.
 */

const MAX = 12

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const showWebResults: Tool = {
  name: 'web_resultats_afficher',
  description:
    "Affiche à l'écran les résultats d'une RECHERCHE web que l'utilisateur a demandée (« cherche », « trouve-moi », « liste », « quelles sources », une veille) : les résultats utiles seulement, chacun avec une phrase qui dit ce qu'on y trouve. Pas pour une simple information (météo, prix, taux, horaire, un fait) : là, réponds directement, sans afficher de résultats. Les adresses doivent venir de tes recherches web de ce tour, jamais inventées.",
  risk: 'lecture',
  input_schema: {
    type: 'object',
    properties: {
      requete: { type: 'string', description: 'Ce qui a été cherché, en quelques mots (« appels d’offres nettoyage Lyon »).' },
      resultats: {
        type: 'array',
        maxItems: MAX,
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            url: { type: 'string', description: 'Adresse exacte du résultat de recherche.' },
            resume: { type: 'string', description: 'Une phrase : ce que la page apporte pour la demande.' },
            date: { type: 'string', description: 'Date de la page si elle est connue (« 12 oct. 2026 »).' }
          },
          required: ['titre', 'url'],
          additionalProperties: false
        }
      }
    },
    required: ['requete', 'resultats'],
    additionalProperties: false
  },
  ui: { kind: 'web', title: (i) => (typeof i.requete === 'string' ? `« ${i.requete} »` : 'Recherche web') },
  validate(input) {
    if (typeof input.requete !== 'string' || !input.requete.trim()) return 'requete : texte attendu.'
    if (!Array.isArray(input.resultats) || input.resultats.length === 0) return 'resultats : au moins un résultat.'
    for (const r of input.resultats as unknown[]) {
      const o = r as Record<string, unknown>
      if (!o || typeof o.titre !== 'string' || typeof o.url !== 'string') return 'resultats : chaque résultat a un titre et une adresse.'
      if (!/^https?:\/\//i.test(o.url) || !hostOf(o.url)) return `resultats : adresse invalide (${String(o.url).slice(0, 80)}).`
    }
    return null
  },
  async run(input) {
    const requete = String(input.requete).trim()
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
    const resultats = (input.resultats as Record<string, unknown>[]).slice(0, MAX).map((r) => {
      const url = String(r.url)
      const resume = text(r.resume, 300)
      const date = text(r.date, 40)
      return { titre: String(r.titre).trim().slice(0, 200), site: hostOf(url), url, ...(resume ? { resume } : {}), ...(date ? { date } : {}) }
    })
    const view: UiWeb = { kind: 'web', requete, resultats }
    return { content: `Affiché à l'écran : ${resultats.length} résultat${resultats.length > 1 ? 's' : ''}. Ne les relis pas un par un : dis l'essentiel en une ou deux phrases.`, summary: `Web : ${requete}`, view }
  }
}
