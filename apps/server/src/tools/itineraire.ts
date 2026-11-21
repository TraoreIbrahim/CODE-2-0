import type { UiItineraire, UiLieu } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { checkStrings, type GeoPosition, type Tool, type ToolContext } from './types.ts'

/**
 * Position d'un lieu et trajet pour s'y rendre, en mini-carte : une adresse ou un endroit. Le départ est la position de l'appareil qui a demandé (demandée une fois, jamais gardée),
 * ou un lieu nommé. La durée est calculée sans circulation (OSRM) ; la navigation se fait dans Google Maps.
 */

// Nominatim et les serveurs OSRM publics demandent une application identifiable.
const UA = 'CODE-2.0/0.1 (assistant vocal libre et auto-hébergé)'
const MAX_TRACE = 300

type Mode = 'voiture' | 'pied'

/** Pays où chercher d'abord une adresse (codes ISO, « fr,be ») : `CODE_PAYS`, sinon partout. */
const PAYS = (process.env.CODE_PAYS ?? '').toLowerCase().replace(/[^a-z,]/g, '')

/** Une adresse ou un lieu (« Pharmacie de la gare », « aéroport ») : d'abord dans le pays de l'installation, puis partout. */
async function geocode(q: string): Promise<UiLieu | null> {
  for (const country of PAYS ? [PAYS, ''] : ['']) {
    const params = new URLSearchParams({ q, format: 'json', limit: '1', 'accept-language': 'fr', addressdetails: '0' })
    if (country) params.set('countrycodes', country)
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8_000) })
    if (!res.ok) throw new Error(`recherche d’adresse ${res.status}`)
    const [hit] = (await res.json()) as { lat: string; lon: string; name?: string; display_name?: string }[]
    if (hit) {
      const parts = (hit.display_name ?? '').split(',').map((p) => p.trim())
      return { nom: hit.name || parts[0] || q, adresse: parts.slice(1, 4).join(', '), lat: Number(hit.lat), lng: Number(hit.lon) }
    }
  }
  return null
}

async function resolve(lieu: string): Promise<UiLieu | { erreur: string }> {
  return (await geocode(lieu)) ?? { erreur: `lieu introuvable : « ${lieu} »` }
}

/** Trajet OSRM : distance, durée sans circulation, tracé. */
async function route(from: GeoPosition, to: GeoPosition, mode: Mode): Promise<NonNullable<UiItineraire['trajet']>> {
  const base = codeConfig.itineraire[mode]
  const url = `${base}/${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}?overview=full&geometries=geojson&alternatives=false&steps=false`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`calcul d’itinéraire ${res.status}`)
  const data = (await res.json()) as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }
  const r = data.routes?.[0]
  if (data.code !== 'Ok' || !r) throw new Error('aucun trajet trouvé par la route')
  return { km: Math.round(r.distance / 100) / 10, minutes: Math.max(1, Math.round(r.duration / 60)), mode, trace: simplify(r.geometry.coordinates.map(([lng, lat]) => [lat, lng])) }
}

/** Au plus 300 points, le premier et le dernier gardés, à 5 décimales (un mètre près). */
export function simplify(points: [number, number][]): [number, number][] {
  const step = Math.max(1, Math.ceil(points.length / MAX_TRACE))
  const kept = points.filter((_, i) => i % step === 0 || i === points.length - 1)
  return kept.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5])
}

/** Lien Google Maps : la navigation depuis la position du téléphone (ou un départ donné), sinon le lieu seul. */
export function googleLink(dest: GeoPosition, mode: Mode, origin?: GeoPosition | null, navigate = true): string {
  if (!navigate) return `https://www.google.com/maps/search/?api=1&query=${dest.lat},${dest.lng}`
  const p = new URLSearchParams({ api: '1', destination: `${dest.lat},${dest.lng}`, travelmode: mode === 'pied' ? 'walking' : 'driving' })
  if (origin) p.set('origin', `${origin.lat},${origin.lng}`)
  return `https://www.google.com/maps/dir/?${p}`
}

/** Distance à vol d'oiseau, en mètres. */
export function distanceM(a: GeoPosition, b: GeoPosition): number {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/** « de l'ordinateur, à 30 m près » : d'où vient la position de l'appareil, pour qu'une position fausse se remarque. */
export function sourcePosition(d: { appareil?: string; precision?: number }): string {
  const qui = d.appareil === 'mac' || d.appareil === 'mini' ? 'de l’ordinateur' : d.appareil === 'mobile' ? 'du téléphone' : 'de l’appareil'
  if (d.precision === undefined) return qui
  const pres = d.precision >= 1000 ? `${String(Math.round(d.precision / 100) / 10).replace('.', ',')} km` : `${d.precision} m`
  return `${qui}, à ${pres} près`
}

/** Au-delà, la position ne suffit pas pour dire « vous y êtes ». */
const PRECISION_SUR_PLACE = 150

/** Ce que le modèle doit faire si l'utilisateur conteste sa position. */
const SI_CONTESTE = 'S’il dit que ce n’est pas là qu’il se trouve, ne relance pas sans départ : demande-lui d’où il part et passe-le dans depart.'

export function dureeTexte(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

export const itinerary: Tool = {
  name: 'itineraire',
  description:
    "Position d'un lieu sur une mini-carte, et le trajet pour s'y rendre avec la durée estimée et un bouton de navigation Google Maps. Pour « où se trouve la mairie », « comment aller à la gare », « combien de temps jusqu'à l'aéroport ». `lieu` : une adresse ou un endroit. Le départ est la position de l'appareil sur lequel il parle ou écrit (un ordinateur se situe par le Wi-Fi, donc parfois à tort), sauf s'il en nomme un (`depart`) ; s'il dit être ailleurs que la position trouvée, rappelle avec `depart` à l'endroit qu'il donne, ou demande-le. `trajet: false` quand il ne veut que la position.",
  risk: 'lecture',
  input_schema: {
    type: 'object',
    properties: {
      lieu: { type: 'string', description: 'Adresse ou endroit (« gare de Lyon-Part-Dieu », « 10 rue de la République, Lyon »).' },
      depart: { type: 'string', description: 'Point de départ nommé (adresse ou endroit) ; vide : là où se trouve l’utilisateur.' },
      mode: { type: 'string', enum: ['voiture', 'pied'], description: 'Voiture par défaut.' },
      trajet: { type: 'boolean', description: 'false : seulement la position du lieu (pas de calcul de trajet).' }
    },
    required: ['lieu'],
    additionalProperties: false
  },
  ui: { kind: 'itineraire', title: (i) => String(i.lieu ?? 'Itinéraire') },
  validate(input) {
    const bad = checkStrings(input, ['lieu'], ['depart'])
    if (bad) return bad
    if (input.mode !== undefined && input.mode !== 'voiture' && input.mode !== 'pied') return 'mode : voiture ou pied.'
    if (input.trajet !== undefined && typeof input.trajet !== 'boolean') return 'trajet : oui ou non.'
    return null
  },
  async run(input, ctx) {
    const lieu = String(input.lieu).trim()
    const departText = String(input.depart ?? '').trim() || null
    const mode: Mode = input.mode === 'pied' ? 'pied' : 'voiture'
    const withRoute = input.trajet !== false
    const summary = `Itinéraire : ${lieu}`
    let dest: UiLieu | { erreur: string }
    try {
      dest = await resolve(lieu)
    } catch (err) {
      return { content: `Destination introuvable (${err instanceof Error ? err.message : err}).`, isError: true, summary }
    }
    if ('erreur' in dest) return { content: `Destination introuvable : ${dest.erreur}.`, isError: true, summary }

    const where = [dest.nom, dest.adresse].filter(Boolean).join(', ')
    if (!withRoute) {
      const view: UiItineraire = { kind: 'itineraire', destination: dest, google: googleLink(dest, mode, null, false) }
      return { content: `${where}. La carte est affichée avec un bouton pour l’ouvrir dans Google Maps. Ne lis pas les coordonnées.`, summary, view }
    }

    // Le départ : un lieu nommé, sinon la position de l'appareil (demandée maintenant, à lui seul).
    let depart: UiItineraire['depart'] | undefined
    let note: string | undefined
    if (departText) {
      const d = await resolve(departText).catch((err: unknown) => ({ erreur: err instanceof Error ? err.message : String(err) }))
      if ('erreur' in d) note = `Départ introuvable : ${d.erreur}.`
      else depart = { ...d, source: 'lieu' }
    } else {
      const p = ctx.position ? await ctx.position() : null
      if (p && !('erreur' in p)) depart = { nom: 'Votre position', lat: p.lat, lng: p.lng, source: 'appareil', ...(p.precision !== undefined ? { precision: p.precision } : {}), ...(p.appareil ? { appareil: p.appareil } : {}) }
      else note = p ? `Position de l’appareil indisponible (${p.erreur}) : Google Maps calculera le trajet depuis là où vous êtes.` : 'Position de l’appareil inconnue : Google Maps calculera le trajet depuis là où vous êtes.'
    }

    const google = googleLink(dest, mode, depart?.source === 'lieu' ? depart : null)
    if (!depart) {
      const view: UiItineraire = { kind: 'itineraire', destination: dest, google, ...(note ? { note } : {}) }
      return { content: `${where}. ${note ?? ''} La carte et le bouton de navigation Google Maps sont à l'écran. Ne lis pas les coordonnées.`, summary, view }
    }
    const source = depart.source === 'appareil' ? sourcePosition(depart) : ''
    const ecart = distanceM(depart, dest)
    if (depart.source === 'appareil' && ecart < 150 + (depart.precision ?? 0)) {
      if ((depart.precision ?? 0) > PRECISION_SUR_PLACE) {
        // Trop vague pour trancher : mieux vaut demander que d'affirmer « vous y êtes ».
        const view: UiItineraire = { kind: 'itineraire', destination: dest, depart, google, note: `Position ${source} : trop vague pour calculer le trajet. Dites d’où vous partez.` }
        return { content: `${where}. La position ${source} est trop vague pour savoir s’il y est déjà ou en est loin : demande-lui d’où il part, puis rappelle itineraire avec depart.`, summary, view }
      }
      const view: UiItineraire = { kind: 'itineraire', destination: dest, depart, google, note: `Vous y êtes : moins de 150 mètres (position ${source}).` }
      return { content: `${where}. D’après la position ${source}, l’utilisateur y est déjà (moins de 150 m). ${SI_CONTESTE}`, summary, view }
    }
    if (ecart < 150) {
      const view: UiItineraire = { kind: 'itineraire', destination: dest, depart, google, note: 'Le départ et l’arrivée sont au même endroit.' }
      return { content: `${where}. Le départ donné est au même endroit que la destination.`, summary, view }
    }
    try {
      const trajet = await route(depart, dest, mode)
      const vague = depart.precision && depart.precision > 1500 ? ' (position de l’appareil approximative)' : ''
      const view: UiItineraire = { kind: 'itineraire', destination: dest, depart, trajet, google, ...(vague ? { note: `Position approximative, à ${Math.round(depart.precision! / 100) / 10} km près.` } : {}) }
      return {
        content: `${where}. Depuis ${depart.source === 'appareil' ? `la position ${source}` : depart.nom}${vague} : ${String(trajet.km).replace('.', ',')} km, environ ${dureeTexte(trajet.minutes)} ${mode === 'pied' ? 'à pied' : 'en voiture'} SANS circulation (estimation ; aux heures de pointe, compte davantage, Google Maps donne la durée réelle). La carte et le bouton de navigation Google Maps sont à l'écran. Ne lis pas les coordonnées.${depart.source === 'appareil' ? ` ${SI_CONTESTE}` : ''}`,
        summary,
        view
      }
    } catch (err) {
      const view: UiItineraire = { kind: 'itineraire', destination: dest, depart, google, note: 'Durée indisponible pour le moment : Google Maps la donnera.' }
      return { content: `${where}. Calcul du trajet impossible (${err instanceof Error ? err.message : err}) ; la carte et le bouton Google Maps sont à l'écran.`, summary, view }
    }
  }
}
