import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { UiItineraire } from '@code/protocol'
import { dureeTexte, googleLink, itinerary, simplify, sourcePosition } from './itineraire.ts'
import type { ToolContext } from './types.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Un contexte d'outil minimal : la position de l'appareil. */
function ctx(position: Awaited<ReturnType<NonNullable<ToolContext['position']>>>): ToolContext {
  return { position: async () => position } as unknown as ToolContext
}

/** Nominatim factice (la gare, ou rien) et OSRM factice : 12,43 km, 25 min 40 s, trois points. */
function stubServices(calls: string[] = []) {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('nominatim')) {
      const q = new URL(u).searchParams.get('q') ?? ''
      return new Response(JSON.stringify(q.includes('gare') ? [{ lat: '45.7605', lon: '4.8597', name: 'Gare de la Part-Dieu', display_name: 'Gare de la Part-Dieu, Rue de Bonnel, Lyon, France' }] : []))
    }
    return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 12_430, duration: 1540, geometry: { coordinates: [[4.8, 45.73], [4.82, 45.74], [4.8597, 45.7605]] } }] }))
  }) as typeof fetch
}

test('tracé simplifié, lien Google Maps, durée lisible, provenance de la position', () => {
  const many = Array.from({ length: 1000 }, (_, i) => [45 + i / 1e4, 4] as [number, number])
  const s = simplify(many)
  assert.ok(s.length <= 301)
  assert.deepEqual(s.at(-1), [45.0999, 4])
  assert.equal(googleLink({ lat: 45.76, lng: 4.86 }, 'voiture'), 'https://www.google.com/maps/dir/?api=1&destination=45.76%2C4.86&travelmode=driving')
  assert.match(googleLink({ lat: 45.76, lng: 4.86 }, 'pied', { lat: 45.7, lng: 4.8 }), /travelmode=walking&origin=45.7%2C4.8/)
  assert.equal(googleLink({ lat: 45.76, lng: 4.86 }, 'voiture', null, false), 'https://www.google.com/maps/search/?api=1&query=45.76,4.86')
  assert.equal(dureeTexte(26), '26 min')
  assert.equal(dureeTexte(95), '1 h 35')
  assert.equal(sourcePosition({ appareil: 'mobile', precision: 30 }), 'du téléphone, à 30 m près')
})

test('trajet depuis la position de l’appareil : distance, durée sans circulation, carte et Google Maps', async () => {
  const calls: string[] = []
  stubServices(calls)
  const r = await itinerary.run({ lieu: 'gare Part-Dieu' }, ctx({ lat: 45.73, lng: 4.8, precision: 30 }))
  const v = r.view as UiItineraire
  assert.equal(r.isError, undefined)
  assert.equal(v.destination.nom, 'Gare de la Part-Dieu')
  assert.equal(v.destination.adresse, 'Rue de Bonnel, Lyon, France')
  assert.match(calls.at(-1)!, /routed-car\/route\/v1\/driving\/4\.800000,45\.730000;4\.859700,45\.760500\?overview=full/)
  assert.deepEqual(v.trajet, { km: 12.4, minutes: 26, mode: 'voiture', trace: [[45.73, 4.8], [45.74, 4.82], [45.7605, 4.8597]] })
  assert.equal(v.depart?.source, 'appareil')
  // Départ depuis le téléphone : Google Maps le retrouve seul (pas d'origine dans le lien).
  assert.doesNotMatch(v.google, /origin=/)
  assert.match(String(r.content), /12,4 km, environ 26 min en voiture SANS circulation/)
})

test('position refusée : la destination et Google Maps quand même, sans trajet', async () => {
  stubServices()
  const r = await itinerary.run({ lieu: 'gare Part-Dieu' }, ctx({ erreur: 'autorisation refusée' }))
  const v = r.view as UiItineraire
  assert.equal(v.trajet, undefined)
  assert.match(v.note!, /autorisation refusée/)
  assert.match(v.google, /destination=45\.7605%2C4\.8597/)
})

test('seulement la position, et lieu introuvable', async () => {
  stubServices()
  const pos = await itinerary.run({ lieu: 'gare Part-Dieu', trajet: false }, ctx(null))
  assert.match((pos.view as UiItineraire).google, /maps\/search/)
  const ko = await itinerary.run({ lieu: 'nulle part' }, ctx(null))
  assert.equal(ko.isError, true)
  assert.match(String(ko.content), /lieu introuvable : « nulle part »/)
  assert.match(itinerary.validate({}, {} as ToolContext)!, /lieu/)
})

test('sur place : « vous y êtes » seulement avec une position précise, et l’appareil qui l’a donnée', async () => {
  stubServices()
  const pres = await itinerary.run({ lieu: 'gare Part-Dieu' }, ctx({ lat: 45.7608, lng: 4.8597, precision: 25, appareil: 'mac' }))
  assert.equal((pres.view as UiItineraire).note, 'Vous y êtes : moins de 150 mètres (position de l’ordinateur, à 25 m près).')
  assert.match(String(pres.content), /demande-lui d’où il part et passe-le dans depart/)
  // Wi-Fi ou adresse IP : à 2 km près, l'assistant ne sait pas s'il y est ; il demande.
  const vague = await itinerary.run({ lieu: 'gare Part-Dieu' }, ctx({ lat: 45.765, lng: 4.86, precision: 2100, appareil: 'mac' }))
  assert.equal((vague.view as UiItineraire).trajet, undefined)
  assert.equal((vague.view as UiItineraire).note, 'Position de l’ordinateur, à 2,1 km près : trop vague pour calculer le trajet. Dites d’où vous partez.')
  assert.match(String(vague.content), /demande-lui d’où il part/)
})
