import type { UiItineraire, UiLieuMaps, UiLieux } from '@code/protocol'
import { simplify } from '../tools/itineraire.ts'

/**
 * Google Maps (connecteur) : ses réponses en blocs de CODE. La recherche de lieux devient une carte aux
 * repères numérotés reliés au résumé de Google ; un trajet devient la carte d'itinéraire habituelle, avec
 * la durée de Google. Les liens sont ceux que Google fournit, jamais construits (sauf la navigation d'un
 * trajet, faite des adresses demandées). Claude reçoit une version courte, sans tracé ni jetons.
 */

type LatLng = { latitude?: number; longitude?: number }
type Attribution = { title?: string; url?: string }
type PlaceView = { id?: string; place?: string; location?: LatLng; attribution?: Attribution; googleMapsLinks?: { placeUrl?: string; directionsUrl?: string; reviewsUrl?: string; photosUrl?: string } }
type Waypoint = { address?: string; placeId?: string; latLng?: LatLng }
type Route = { distanceMeters?: number; duration?: string; encodedPolyline?: string; attribution?: Attribution }

/** Les arguments complétés avant l'appel : un trajet vient toujours avec son tracé, les réponses en français. */
export function preparerMaps(outil: string, input: Record<string, unknown>): Record<string, unknown> {
  if (outil === 'compute_routes') return { ...input, includePolyline: true }
  if (outil === 'search_places') return { languageCode: 'fr', ...input }
  return input
}

/** Le contenu structuré d'un résultat MCP ; à défaut, son texte s'il est du JSON. */
export function donneesDe(result: Record<string, unknown>, text: string): Record<string, unknown> | null {
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent as Record<string, unknown>
  try {
    const d = JSON.parse(text) as unknown
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const RENVOI = /\[(\d+(?:\s*,\s*\d+)*)\]/g

/**
 * Le nom d'un lieu d'après le résumé : ce qui précède son premier renvoi « [n] », depuis le début de la
 * phrase ou de l'élément de liste ; un passage en gras l'emporte. Sinon « Lieu n ».
 */
export function nomDansResume(resume: string, n: number): string {
  let at = -1
  for (const m of resume.matchAll(RENVOI)) {
    if (m[1]!.split(',').map((x) => Number(x.trim())).includes(n)) {
      at = m.index!
      break
    }
  }
  const defaut = `Lieu ${n + 1}`
  if (at < 0) return defaut
  const avant = resume.slice(0, at)
  const gras = [...avant.matchAll(/\*\*([^*\n]{2,80})\*\*/g)].at(-1)
  if (gras && at - (gras.index! + gras[0].length) <= 3) return gras[1]!.trim()
  const debut = Math.max(avant.lastIndexOf('\n'), avant.lastIndexOf('. '), avant.lastIndexOf(': '), avant.lastIndexOf(', '), avant.lastIndexOf(']'), avant.lastIndexOf(' et '), avant.lastIndexOf('('))
  const bout = avant
    .slice(debut + 1)
    .replace(/^(\s*(et|ou|:|,|\.|\]|\(|[-*•]|\d+[.)])\s*)+/i, '')
    .replace(/\*\*/g, '')
    .replace(/^(il y a|vous trouverez|on trouve|essayez|comme|notamment|dont)\s+/i, '')
    .trim()
  if (!bout || bout.length > 70) return defaut
  return bout.charAt(0).toUpperCase() + bout.slice(1)
}

const lienSur = (u: unknown) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : undefined)

/** search_places → bloc de lieux ; null si la réponse n'a pas la forme attendue. */
export function lieuxMaps(input: Record<string, unknown>, d: Record<string, unknown>): { view: UiLieux; claude: string } | null {
  const resume = typeof d.summary === 'string' ? d.summary.trim() : ''
  const places = Array.isArray(d.places) ? (d.places as PlaceView[]) : []
  const lieux: UiLieuMaps[] = []
  places.forEach((p, n) => {
    const lat = p.location?.latitude
    const lng = p.location?.longitude
    if (typeof lat !== 'number' || typeof lng !== 'number') return
    const l = p.googleMapsLinks ?? {}
    const liens = { lien: lienSur(l.placeUrl), trajet: lienSur(l.directionsUrl), avis: lienSur(l.reviewsUrl), photos: lienSur(l.photosUrl) }
    lieux.push({ n, nom: nomDansResume(resume, n), lat, lng, ...Object.fromEntries(Object.entries(liens).filter(([, v]) => v)) })
  })
  if (!resume && !lieux.length) return null
  const attr = places.find((p) => p.attribution?.title)?.attribution
  const view: UiLieux = {
    kind: 'lieux',
    requete: String(input.textQuery ?? '').trim(),
    resume,
    lieux,
    attribution: { titre: attr?.title ?? 'Google Maps', ...(lienSur(attr?.url) ? { lien: attr!.url } : {}) }
  }
  const liste = lieux.map((l) => `[${l.n}] ${l.nom}`).join(' ; ')
  const claude = `Résumé de Google Maps : ${resume || '(aucun)'}\nLieux sur la carte : ${liste || 'aucun'}.\nLa carte, les lieux numérotés et leurs liens (fiche, trajet, avis) sont à l'écran : dis l'essentiel en une ou deux phrases, d'après Google Maps, sans lire les adresses web ni les numéros de renvoi.`
  return { view, claude }
}

/** Polyligne encodée de Google → points [lat, lng]. */
export function decoderPolyligne(code: string): [number, number][] {
  const points: [number, number][] = []
  let i = 0
  let lat = 0
  let lng = 0
  const suivant = () => {
    let res = 0
    let shift = 0
    let b: number
    do {
      b = code.charCodeAt(i++) - 63
      res |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return res & 1 ? ~(res >> 1) : res >> 1
  }
  while (i < code.length) {
    lat += suivant()
    lng += suivant()
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

const MODES: Record<string, { mode: NonNullable<UiItineraire['trajet']>['mode']; google: string }> = {
  WALK: { mode: 'pied', google: 'walking' },
  BICYCLE: { mode: 'velo', google: 'bicycling' },
  TRANSIT: { mode: 'transports', google: 'transit' }
}

const nomEtape = (w: Waypoint | undefined, defaut: string) => (w?.address?.trim() ? w.address.trim() : defaut)
const pourLien = (w: Waypoint | undefined, pt: [number, number]) => (w?.address?.trim() ? w.address.trim() : `${pt[0]},${pt[1]}`)

/** compute_routes → carte d'itinéraire ; null sans tracé (rien à dessiner). */
export function trajetMaps(input: Record<string, unknown>, d: Record<string, unknown>): { view: UiItineraire; claude: string } | null {
  const r = (Array.isArray(d.routes) ? (d.routes as Route[]) : [])[0]
  if (!r?.encodedPolyline) return null
  const points = decoderPolyligne(r.encodedPolyline)
  if (points.length < 2) return null
  const origine = input.origin as Waypoint | undefined
  const destination = input.destination as Waypoint | undefined
  const { mode, google } = MODES[String(input.travelMode)] ?? { mode: 'voiture' as const, google: 'driving' }
  const secondes = Number(String(r.duration ?? '').replace(/s$/, ''))
  const minutes = Math.max(1, Math.round((Number.isFinite(secondes) ? secondes : 0) / 60))
  const km = Math.round((r.distanceMeters ?? 0) / 100) / 10
  const [debut, fin] = [points[0]!, points.at(-1)!]
  const lien = new URLSearchParams({ api: '1', origin: pourLien(origine, debut), destination: pourLien(destination, fin), travelmode: google })
  if (destination?.placeId) lien.set('destination_place_id', destination.placeId)
  if (origine?.placeId) lien.set('origin_place_id', origine.placeId)
  const arrivee = nomEtape(destination, 'Arrivée')
  const view: UiItineraire = {
    kind: 'itineraire',
    destination: { nom: arrivee, lat: fin[0], lng: fin[1] },
    depart: { nom: nomEtape(origine, 'Départ'), lat: debut[0], lng: debut[1], source: 'lieu' },
    trajet: { km, minutes, mode, trace: simplify(points) },
    google: `https://www.google.com/maps/dir/?${lien}`,
    fournisseur: 'google'
  }
  const duree = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
  const claude = `Trajet Google Maps jusqu'à ${arrivee} : ${String(km).replace('.', ',')} km, environ ${duree}${mode === 'voiture' ? ' en voiture' : mode === 'pied' ? ' à pied' : mode === 'velo' ? ' à vélo' : ' en transports'} (durée de Google ; aux heures de pointe, le bouton Google Maps donne la durée avec le trafic du moment). La carte et le bouton de navigation sont à l'écran : dis la durée et la distance en une phrase, sans lire de coordonnées.`
  return { view, claude }
}

/** Le bloc dédié d'un outil Google Maps, s'il en a un. */
export function vueMaps(outil: string, input: Record<string, unknown>, d: Record<string, unknown> | null): { view: UiLieux | UiItineraire; claude: string } | null {
  if (!d) return null
  if (outil === 'search_places') return lieuxMaps(input, d)
  if (outil === 'compute_routes') return trajetMaps(input, d)
  return null
}
