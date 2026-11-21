import type { MeteoCiel, UiMeteo } from '@code/protocol'
import { checkStrings, type Tool } from './types.ts'

/**
 * Météo : prévisions de MET Norway (institut météorologique norvégien, gratuit, usage commercial permis,
 * attribution « MET Norway »), lieu trouvé par OpenStreetMap. Une vraie carte météo, pas une recherche web.
 */

// Nominatim et MET Norway demandent une application identifiable.
const UA = 'CODE-2.0/0.1 (assistant vocal libre et auto-hébergé)'
const CACHE_MS = 30 * 60_000

const keyOf = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/,.*$/, '')
    .trim()
    .replace(/\s+/g, '-')

type Lieu = { nom: string; lat: number; lon: number }
const geoCache = new Map<string, Lieu | null>()

/** Coordonnées d'un lieu (« Paris », « Croix-Rousse, Lyon »), ou null s'il est introuvable. */
export async function geocode(lieu: string): Promise<Lieu | null> {
  const k = keyOf(lieu)
  if (geoCache.has(k)) return geoCache.get(k)!
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: lieu, format: 'json', limit: '1', 'accept-language': 'fr' })}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`géocodage ${res.status}`)
  const [hit] = (await res.json()) as { lat: string; lon: string; name?: string; display_name?: string }[]
  const found = hit ? { nom: hit.name || hit.display_name?.split(',')[0] || lieu, lat: Number(hit.lat), lon: Number(hit.lon) } : null
  geoCache.set(k, found)
  return found
}

// ── Prévisions ─────────────────────────────────────────────────────────────

type Entry = {
  time: string
  data: {
    instant: { details: { air_temperature?: number; wind_speed?: number; relative_humidity?: number } }
    next_1_hours?: { summary: { symbol_code: string }; details?: { precipitation_amount?: number } }
    next_6_hours?: { summary: { symbol_code: string }; details?: { precipitation_amount?: number } }
    next_12_hours?: { summary: { symbol_code: string } }
  }
}
export type Forecast = { properties: { meta: { updated_at: string }; timeseries: Entry[] } }

const forecastCache = new Map<string, { at: number; data: Forecast }>()

async function forecast(lat: number, lon: number): Promise<Forecast> {
  const k = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = forecastCache.get(k)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`prévisions ${res.status}`)
  const data = (await res.json()) as Forecast
  forecastCache.set(k, { at: Date.now(), data })
  return data
}

/** Le code de MET Norway (« lightrainshowers_night ») → famille de ciel, libellé français, nuit. */
export function sky(code: string): { ciel: MeteoCiel; libelle: string; nuit: boolean } {
  const nuit = code.endsWith('_night')
  const base = code.replace(/_(day|night|polartwilight)$/, '')
  const force = base.startsWith('light') ? ' faible' : base.startsWith('heavy') ? ' forte' : ''
  const fortes = base.startsWith('light') ? ' faibles' : base.startsWith('heavy') ? ' fortes' : ''
  if (base.includes('thunder')) return { ciel: 'orage', libelle: base.includes('showers') ? 'Averses orageuses' : 'Orage', nuit }
  if (base.includes('snow') || base.includes('sleet')) return { ciel: 'neige', libelle: base.includes('sleet') ? 'Neige fondue' : 'Neige', nuit }
  if (base.includes('rainshowers')) return { ciel: 'pluie', libelle: `Averses${fortes}`, nuit }
  if (base.includes('rain')) return { ciel: 'pluie', libelle: `Pluie${force}`, nuit }
  if (base === 'fog') return { ciel: 'brouillard', libelle: 'Brouillard', nuit }
  if (base === 'cloudy') return { ciel: 'nuages', libelle: 'Couvert', nuit }
  if (base === 'partlycloudy') return { ciel: 'eclaircies', libelle: 'Partiellement nuageux', nuit }
  if (base === 'fair') return { ciel: 'eclaircies', libelle: nuit ? 'Nuit plutôt claire' : 'Beau temps', nuit }
  return { ciel: 'soleil', libelle: nuit ? 'Nuit claire' : 'Ciel dégagé', nuit }
}

/** Température ressentie (indice de chaleur, formule de Rothfusz) : seulement quand il fait chaud et humide. */
export function feelsLike(t: number, rh: number): number {
  if (t < 27 || rh < 40) return Math.round(t)
  const f = (t * 9) / 5 + 32
  const hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f - 0.05481717 * rh * rh + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh
  return Math.round(((hi - 32) * 5) / 9)
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Prévisions brutes → la carte : maintenant, les 12 prochaines heures, 5 jours (heures locales de `tz`). */
export function summarize(data: Forecast, lieu: string, tz: string, now = new Date()): UiMeteo {
  const series = data.properties.timeseries
  const local = (iso: string | Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, ...o }).format(new Date(iso))
  // Clé de jour triable (« 2026-10-30 ») : comparée comme texte, elle suit l'ordre des dates.
  const dayKey = (d: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
  const hour = (d: string | Date) => local(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  // L'entrée en cours : la dernière dont l'heure est passée (la première sinon).
  const startAt = Math.max(0, series.findIndex((e) => new Date(e.time).getTime() > now.getTime()) - 1)
  const cur = series[startAt]!
  const d = cur.data.instant.details
  const s = sky(cur.data.next_1_hours?.summary.symbol_code ?? cur.data.next_6_hours?.summary.symbol_code ?? 'cloudy')
  const temp = Math.round(d.air_temperature ?? 0)
  const humidite = Math.round(d.relative_humidity ?? 0)

  const heures = series
    .slice(startAt + 1)
    .filter((e) => e.data.next_1_hours)
    .slice(0, 12)
    .map((e) => {
      const h = sky(e.data.next_1_hours!.summary.symbol_code)
      return { heure: hour(e.time), temp: Math.round(e.data.instant.details.air_temperature ?? 0), ciel: h.ciel, nuit: h.nuit, pluie: round1(e.data.next_1_hours!.details?.precipitation_amount ?? 0) }
    })

  const days = new Map<string, { temps: number[]; pluie: number; midi?: string; first: string }>()
  for (const e of series) {
    const k = dayKey(e.time)
    const day = days.get(k) ?? { temps: [], pluie: 0, first: e.time }
    if (e.data.instant.details.air_temperature !== undefined) day.temps.push(e.data.instant.details.air_temperature)
    day.pluie += e.data.next_1_hours?.details?.precipitation_amount ?? (e.data.next_1_hours ? 0 : (e.data.next_6_hours?.details?.precipitation_amount ?? 0))
    // Le ciel de la journée : la prévision sur 12 h ou 6 h prise en fin de matinée.
    const h = Number(hour(e.time).slice(0, 2))
    if (!day.midi && h >= 6 && h <= 12) day.midi = e.data.next_12_hours?.summary.symbol_code ?? e.data.next_6_hours?.summary.symbol_code
    days.set(k, day)
  }
  const today = dayKey(now)
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000))
  const jours = [...days.entries()]
    // Aujourd'hui seulement s'il en reste une bonne part (le soir, les prochaines heures suffisent).
    .filter(([k, v]) => k > today || (k === today && v.temps.length >= 6))
    .slice(0, 5)
    .map(([k, v]) => {
      const sk = sky(v.midi ?? 'partlycloudy_day')
      const label = k === today ? 'Aujourd’hui' : k === tomorrow ? 'Demain' : local(v.first, { weekday: 'short', day: 'numeric' }).replace(/^./, (c) => c.toUpperCase())
      return { jour: label, min: Math.round(Math.min(...v.temps)), max: Math.round(Math.max(...v.temps)), ciel: sk.ciel, libelle: sk.libelle, pluie: round1(v.pluie) }
    })

  return {
    kind: 'meteo',
    lieu,
    maj: hour(data.properties.meta.updated_at),
    maintenant: { temp, ressenti: feelsLike(d.air_temperature ?? 0, humidite), ciel: s.ciel, libelle: s.libelle, nuit: s.nuit, vent: Math.round((d.wind_speed ?? 0) * 3.6), humidite, pluie: round1(cur.data.next_1_hours?.details?.precipitation_amount ?? 0) },
    heures,
    jours,
    source: 'MET Norway'
  }
}

/** Ce que Claude lit pour répondre en une ou deux phrases. */
export function meteoText(m: UiMeteo): string {
  const n = m.maintenant
  const rain = m.heures.filter((h) => h.pluie > 0)
  const next = rain.length ? `Pluie prévue vers ${rain[0]!.heure} (${rain.reduce((a, h) => a + h.pluie, 0).toFixed(1).replace('.', ',')} mm sur les 12 prochaines heures).` : 'Pas de pluie prévue dans les 12 prochaines heures.'
  return [
    `Météo à ${m.lieu} (source ${m.source}, mise à jour ${m.maj}). La carte est affichée à l'écran.`,
    `Maintenant : ${n.temp} °C${n.ressenti > n.temp ? `, ressenti ${n.ressenti} °C` : ''}, ${n.libelle.toLowerCase()}, vent ${n.vent} km/h, humidité ${n.humidite} %.`,
    next,
    ...m.jours.map((j) => `${j.jour} : ${j.min} à ${j.max} °C, ${j.libelle.toLowerCase()}${j.pluie >= 0.5 ? `, ${j.pluie.toString().replace('.', ',')} mm de pluie` : ''}.`)
  ].join('\n')
}

/** La carte météo d'un lieu (lieu introuvable : null). */
export async function meteoFor(asked: string, tz: string): Promise<UiMeteo | null> {
  const lieu = await geocode(asked)
  return lieu ? summarize(await forecast(lieu.lat, lieu.lon), lieu.nom, tz) : null
}

export const weather: Tool = {
  name: 'meteo',
  description:
    "Météo d'un lieu : maintenant, les prochaines heures et les 5 prochains jours, affichée en carte à l'écran. À utiliser pour toute question de météo, de pluie ou de température (« quel temps fait-il », « va-t-il pleuvoir ce soir », « météo à Bordeaux demain ») — jamais la recherche web. Sans lieu : la ville de l'utilisateur.",
  risk: 'lecture',
  input_schema: {
    type: 'object',
    properties: { lieu: { type: 'string', description: 'Ville ou quartier (« Bordeaux », « Croix-Rousse, Lyon »). Vide : la ville de l’utilisateur.' } },
    additionalProperties: false
  },
  ui: { kind: 'meteo', title: (i) => (typeof i.lieu === 'string' && i.lieu.trim() ? i.lieu.trim() : 'Météo') },
  validate: (input) => checkStrings(input, [], ['lieu']),
  async run(input, ctx) {
    const asked = typeof input.lieu === 'string' && input.lieu.trim() ? input.lieu.trim() : ctx.user.reglages.ville
    const summary = `Météo : ${asked}`
    try {
      const m = await meteoFor(asked, ctx.user.reglages.fuseau)
      if (!m) return { content: `Lieu introuvable : « ${asked} ». Demande-lui de préciser (ville, pays).`, isError: true, summary }
      return { content: meteoText(m), summary, view: m }
    } catch (err) {
      return { content: `Service météo injoignable (${err instanceof Error ? err.message : err}). Dis-le simplement ; ne cherche pas sur le web.`, isError: true, summary }
    }
  }
}
