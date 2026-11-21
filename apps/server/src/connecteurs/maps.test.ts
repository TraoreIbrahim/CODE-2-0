import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UiItineraire, UiLieux } from '@code/protocol'
import { decoderPolyligne, donneesDe, nomDansResume, preparerMaps, vueMaps } from './maps.ts'

test('polyligne de Google décodée (exemple de la documentation)', () => {
  assert.deepEqual(decoderPolyligne('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453]
  ])
})

test('nom d’un lieu d’après le résumé de Google : gras, début de phrase, sinon « Lieu n »', () => {
  const r = 'Voici des pharmacies à Vaise :\n* **Pharmacie des Terreaux** [0] est de garde.\n* La Pharmacie Sainte-Cécile [1], aux Brotteaux.\nAussi Pharmacie Saint-Jacques [2] et Pharmacie du Golf [3, 4].'
  assert.equal(nomDansResume(r, 0), 'Pharmacie des Terreaux')
  assert.equal(nomDansResume(r, 1), 'La Pharmacie Sainte-Cécile')
  assert.equal(nomDansResume(r, 3), 'Pharmacie du Golf')
  assert.equal(nomDansResume(r, 4), 'Pharmacie du Golf')
  assert.equal(nomDansResume(r, 7), 'Lieu 8')
})

test('search_places → lieux sur la carte, liens de Google, et un texte court pour Claude', () => {
  const d = {
    summary: 'Ouverte ce soir : **Pharmacie des Terreaux** [0].',
    contentToken: 'x'.repeat(5000),
    places: [
      { id: 'a', location: { latitude: 45.76, longitude: 4.83 }, attribution: { title: 'Google Maps', url: 'https://maps.google.com' }, googleMapsLinks: { placeUrl: 'https://maps.google.com/?cid=1', directionsUrl: 'https://www.google.com/maps/dir/?x', reviewsUrl: 'javascript:alert(1)' } },
      { id: 'b' }
    ]
  }
  const r = vueMaps('search_places', { textQuery: 'pharmacie de garde Vaise' }, donneesDe({}, JSON.stringify(d)))!
  const v = r.view as UiLieux
  assert.equal(v.kind, 'lieux')
  assert.deepEqual(v.lieux, [{ n: 0, nom: 'Pharmacie des Terreaux', lat: 45.76, lng: 4.83, lien: 'https://maps.google.com/?cid=1', trajet: 'https://www.google.com/maps/dir/?x' }])
  assert.deepEqual(v.attribution, { titre: 'Google Maps', lien: 'https://maps.google.com' })
  assert.ok(!r.claude.includes('xxxx'))
  assert.match(r.claude, /\[0\] Pharmacie des Terreaux/)
})

test('compute_routes → carte d’itinéraire de Google, tracé demandé d’office', () => {
  assert.equal(preparerMaps('compute_routes', { origin: { address: 'Bellecour' } }).includePolyline, true)
  assert.equal(preparerMaps('search_places', { textQuery: 'x' }).languageCode, 'fr')
  const input = { origin: { address: 'Bellecour, Lyon' }, destination: { address: 'Aéroport Saint-Exupéry' }, travelMode: 'DRIVE' }
  const r = vueMaps('compute_routes', input, { routes: [{ distanceMeters: 16_480, duration: '1534s', encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }] })!
  const v = r.view as UiItineraire
  assert.equal(v.fournisseur, 'google')
  assert.deepEqual(v.trajet && { km: v.trajet.km, minutes: v.trajet.minutes, mode: v.trajet.mode }, { km: 16.5, minutes: 26, mode: 'voiture' })
  assert.deepEqual([v.depart?.nom, v.depart?.source, v.destination.nom], ['Bellecour, Lyon', 'lieu', 'Aéroport Saint-Exupéry'])
  assert.equal(v.google, 'https://www.google.com/maps/dir/?api=1&origin=Bellecour%2C+Lyon&destination=A%C3%A9roport+Saint-Exup%C3%A9ry&travelmode=driving')
  assert.match(r.claude, /16,5 km, environ 26 min en voiture/)
  // Sans tracé : pas de carte, le rendu générique prend le relais.
  assert.equal(vueMaps('compute_routes', input, { routes: [{ distanceMeters: 1000, duration: '60s' }] }), null)
})
