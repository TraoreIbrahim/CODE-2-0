import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CalEvent } from '../google/calendar.ts'
import { ProposeurReunions, visiosDe, type VisioProche } from './agenda.ts'

const T = Date.UTC(2026, 10, 12, 13, 30)
const a = (min: number) => new Date(T + min * 60_000).toISOString()
const EVENTS: CalEvent[] = [
  { id: 'meet', summary: 'Point hebdo', start: { dateTime: a(0) }, hangoutLink: 'https://meet.google.com/abc-defg-hij' },
  { id: 'zoom', summary: '  Démo   client ', start: { dateTime: a(60) }, location: 'https://exemple.zoom.us/j/123' },
  { id: 'salle', summary: 'Déjeuner', start: { dateTime: a(0) }, location: 'Salle 2' },
  { id: 'jour', summary: 'Congé', start: { date: '2026-11-12' }, hangoutLink: 'https://meet.google.com/x' },
  { id: 'annule', summary: 'Annulée', status: 'cancelled', start: { dateTime: a(0) }, hangoutLink: 'https://meet.google.com/y' },
  { id: 'decline', summary: 'Déclinée', start: { dateTime: a(0) }, hangoutLink: 'https://meet.google.com/z', attendees: [{ self: true, responseStatus: 'declined' }] }
]

test('seules les visios à heure fixe, ni annulées ni déclinées', () => {
  assert.deepEqual(
    visiosDe(EVENTS).map((v) => [v.titre, v.service]),
    [
      ['Point hebdo', 'Meet'],
      ['Démo client', 'Zoom']
    ]
  )
})

test('proposée une fois, de une minute avant à trois minutes après ; retentée tant que personne ne l’a vue', async () => {
  const vues: VisioProche[] = []
  let ecran = false
  const p = new ProposeurReunions({ evenements: async () => EVENTS, proposer: (_uid, v) => (ecran ? (vues.push(v), true) : false), rafraichirMs: 10 * 60_000 })
  // Premier passage : l'agenda se lit, rien n'est encore connu.
  p.tick(1, T - 5 * 60_000)
  await p.attendre(1)
  p.tick(1, T - 2 * 60_000)
  assert.equal(vues.length, 0)
  // Dans la fenêtre, mais aucun écran ouvert : rien, et ce sera retenté.
  p.tick(1, T - 30_000)
  assert.equal(vues.length, 0)
  ecran = true
  p.tick(1, T)
  p.tick(1, T + 10_000)
  p.tick(1, T + 2 * 60_000)
  assert.deepEqual(vues.map((v) => v.titre), ['Point hebdo'])
  // La suivante, une heure plus tard ; trop tard pour une visio commencée depuis plus de trois minutes.
  p.tick(1, T + 64 * 60_000)
  assert.equal(vues.length, 1)
  const q = new ProposeurReunions({ evenements: async () => EVENTS, proposer: (_uid, v) => (vues.push(v), true) })
  q.tick(2, T + 59 * 60_000)
  await q.attendre(2)
  q.tick(2, T + 59 * 60_000 + 10_000)
  assert.deepEqual(vues.map((v) => v.titre), ['Point hebdo', 'Démo client'])
})

test('agenda non relié ou injoignable : rien, sans erreur', async () => {
  const vues: VisioProche[] = []
  let panne = true
  const p = new ProposeurReunions({ evenements: async () => (panne ? Promise.reject(new Error('réseau')) : null), proposer: (_u, v) => (vues.push(v), true), rafraichirMs: 0 })
  p.tick(1, T)
  await p.attendre(1)
  panne = false
  p.tick(1, T + 10_000)
  await p.attendre(1)
  p.tick(1, T + 20_000)
  assert.equal(vues.length, 0)
})
