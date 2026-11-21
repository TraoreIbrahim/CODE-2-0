import type { VoixBibliotheque, VoixChoix, VoixRecherche } from '@code/protocol'

/**
 * Les voix ElevenLabs de chacun, avec sa propre clé : celles de son compte (clonées, conçues, ajoutées depuis
 * la bibliothèque) et la bibliothèque publique, limitée aux voix françaises, pour en écouter et en ajouter.
 * Les voix de base du compte (« premade ») sont anglophones : elles restent dans la configuration.
 */

const API = 'https://api.elevenlabs.io'

/** Identifiant de voix ElevenLabs : vingt lettres et chiffres. */
export const ID_VOIX = /^[A-Za-z0-9]{20}$/

type VoixApi = {
  voice_id: string
  name: string
  category?: string
  description?: string | null
  labels?: Record<string, string | undefined>
}

type VoixPartagee = {
  public_owner_id: string
  voice_id: string
  name: string
  gender?: string
  age?: string
  accent?: string
  use_case?: string
  descriptive?: string
  description?: string | null
  preview_url?: string | null
  cloned_by_count?: number
  verified_languages?: { language?: string; preview_url?: string | null }[]
}

/** Erreur ElevenLabs lisible : leur message (`detail.message`) plutôt qu'un code. */
async function erreurDe(res: Response, quoi: string): Promise<Error> {
  const corps = (await res.json().catch(() => null)) as { detail?: { message?: string; status?: string } | string } | null
  const detail = typeof corps?.detail === 'string' ? corps.detail : corps?.detail?.message
  if (res.status === 401) return new Error('ElevenLabs refuse la clé : vérifiez-la dans Réglages › Clés API.')
  if (corps && typeof corps.detail === 'object' && corps.detail?.status === 'missing_permissions') {
    return new Error('La clé ElevenLabs n’a pas le droit de lire les voix : donnez-lui l’accès « Voices » (lecture et écriture) dans ElevenLabs.')
  }
  return new Error(`${quoi} (${res.status})${detail ? ` : ${detail}` : '.'}`)
}

const GENRES: Record<string, string> = { female: 'Femme', male: 'Homme', neutral: 'Neutre' }
const AGES: Record<string, string> = { young: 'Jeune', middle_aged: 'Adulte', middle_age: 'Adulte', old: 'Âgée' }
const USAGES: Record<string, string> = {
  conversational: 'Conversation',
  narrative_story: 'Narration',
  narration: 'Narration',
  informative_educational: 'Infos',
  social_media: 'Réseaux',
  entertainment_tv: 'Télé',
  advertisement: 'Publicité',
  characters_animation: 'Personnage'
}
const TONS: Record<string, string> = {
  calm: 'calme',
  confident: 'assurée',
  warm: 'chaleureuse',
  professional: 'professionnelle',
  casual: 'décontractée',
  deep: 'grave',
  soft: 'douce',
  friendly: 'amicale',
  energetic: 'énergique',
  pleasant: 'agréable',
  mature: 'mûre',
  classy: 'élégante',
  crisp: 'nette',
  husky: 'voilée',
  smooth: 'veloutée',
  formal: 'formelle',
  relaxed: 'détendue',
  upbeat: 'enjouée',
  serious: 'sérieuse'
}
const ACCENTS: Record<string, string> = {
  parisian: 'parisien',
  standard: 'standard',
  canadian: 'québécois',
  quebecois: 'québécois',
  belgian: 'belge',
  swiss: 'suisse',
  african: 'africain',
  'west african': 'ouest-africain',
  southern: 'du Sud',
  french: 'français'
}

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const propre = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

/** « Femme · Adulte · Conversation · Accent parisien », sans ce qu'ElevenLabs ne renseigne pas. */
function etiquettesDe(v: { gender?: string; age?: string; use_case?: string; accent?: string; descriptive?: string }): string[] {
  const out: string[] = []
  if (v.gender && GENRES[v.gender]) out.push(GENRES[v.gender]!)
  if (v.age && AGES[v.age]) out.push(AGES[v.age]!)
  if (v.descriptive && TONS[v.descriptive]) out.push(majuscule(TONS[v.descriptive]!))
  if (v.use_case && USAGES[v.use_case]) out.push(USAGES[v.use_case]!)
  const accent = propre(v.accent).toLowerCase()
  if (accent && accent !== 'standard' && accent !== 'french') out.push(`Accent ${ACCENTS[accent] ?? accent}`)
  return out
}

/** Les voix de base d'ElevenLabs sont dans la configuration ; seules les voix propres au compte sont listées. */
const PROPRES = new Set(['cloned', 'generated', 'professional', 'famous', 'high_quality'])

const cacheCompte = new Map<string, { quand: number; voix: Promise<VoixChoix[]> }>()
const DUREE_CACHE = 5 * 60_000

/** Les voix propres au compte ElevenLabs (cinq minutes en mémoire ; `frais` relit après un ajout). */
export function voixDuCompte(cle: string, frais = false): Promise<VoixChoix[]> {
  const c = cacheCompte.get(cle)
  if (c && !frais && Date.now() - c.quand < DUREE_CACHE) return c.voix
  const voix = lireCompte(cle)
  cacheCompte.set(cle, { quand: Date.now(), voix })
  // Un échec n'est pas gardé : la prochaine demande réessaie.
  voix.catch(() => cacheCompte.delete(cle))
  return voix
}

async function lireCompte(cle: string): Promise<VoixChoix[]> {
  const res = await fetch(`${API}/v1/voices`, { headers: { 'xi-api-key': cle } })
  if (!res.ok) throw await erreurDe(res, 'Voix ElevenLabs illisibles')
  const { voices = [] } = (await res.json()) as { voices?: VoixApi[] }
  return voices
    .filter((v) => PROPRES.has(v.category ?? '') && ID_VOIX.test(v.voice_id))
    .map((v) => {
      const l = v.labels ?? {}
      const etiquettes = etiquettesDe({ gender: l.gender, age: l.age, use_case: l.use_case, accent: l.accent, descriptive: l.descriptive ?? l.description })
      const description = etiquettes.length ? etiquettes.join(' · ') : propre(v.description).slice(0, 90) || 'Voix de votre compte ElevenLabs.'
      return { id: v.voice_id, nom: propre(v.name).slice(0, 60) || 'Voix', description, source: 'compte' as const }
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}

const PAR_PAGE = 24
const USAGE_API: Record<NonNullable<VoixRecherche['usage']>, string> = {
  conversation: 'conversational',
  narration: 'narrative_story',
  infos: 'informative_educational'
}

/** L'extrait en français s'il existe (voix multilingues), sinon l'extrait principal. */
function apercuDe(v: VoixPartagee): string | null {
  const fr = v.verified_languages?.find((l) => l.language === 'fr' && l.preview_url)
  return fr?.preview_url ?? v.preview_url ?? null
}

/** Une page de la bibliothèque publique, voix françaises seulement, les plus utilisées d'abord. */
export async function bibliotheque(cle: string, f: VoixRecherche): Promise<{ voix: VoixBibliotheque[]; suite: boolean }> {
  const page = Math.max(0, Math.min(50, Math.floor(f.page ?? 0)))
  const params = new URLSearchParams({ page_size: String(PAR_PAGE), page: String(page), language: 'fr', sort: 'usage_character_count_1y' })
  const recherche = propre(f.recherche).slice(0, 80)
  if (recherche) params.set('search', recherche)
  if (f.genre) params.set('gender', f.genre === 'femme' ? 'female' : 'male')
  if (f.usage) params.set('use_cases', USAGE_API[f.usage])
  const [res, compte] = await Promise.all([
    fetch(`${API}/v1/shared-voices?${params}`, { headers: { 'xi-api-key': cle } }),
    voixDuCompte(cle).catch(() => [] as VoixChoix[])
  ])
  if (!res.ok) throw await erreurDe(res, 'Bibliothèque ElevenLabs indisponible')
  const { voices = [], has_more = false } = (await res.json()) as { voices?: VoixPartagee[]; has_more?: boolean }
  const deja = new Set(compte.map((v) => v.id))
  return {
    voix: voices
      .filter((v) => ID_VOIX.test(v.voice_id) && v.public_owner_id)
      .map((v) => ({
        id: v.voice_id,
        auteur: v.public_owner_id,
        nom: propre(v.name).slice(0, 60) || 'Voix',
        description: propre(v.description).slice(0, 220),
        etiquettes: etiquettesDe(v),
        apercu: apercuDe(v),
        ajoutee: deja.has(v.voice_id),
        ajouts: v.cloned_by_count ?? 0
      })),
    suite: has_more
  }
}

/** Ajoute une voix de la bibliothèque au compte ElevenLabs ; renvoie l'identifiant à utiliser. */
export async function ajouterVoix(cle: string, auteur: string, id: string, nom: string): Promise<string> {
  if (!ID_VOIX.test(id) || !/^[A-Za-z0-9]{8,80}$/.test(auteur)) throw new Error('Voix inconnue.')
  const res = await fetch(`${API}/v1/voices/add/${encodeURIComponent(auteur)}/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'xi-api-key': cle, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: propre(nom).slice(0, 60) || 'Voix' })
  })
  if (!res.ok) throw await erreurDe(res, 'ElevenLabs n’a pas ajouté la voix')
  const { voice_id } = (await res.json()) as { voice_id?: string }
  await voixDuCompte(cle, true).catch(() => [])
  return voice_id && ID_VOIX.test(voice_id) ? voice_id : id
}
