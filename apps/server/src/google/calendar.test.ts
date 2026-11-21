import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays, agendaForClaude, agendaView, eventsOfDay, freeSlots, localDay, localMinutes, mondayOf, parseLocal, relative, zonedTime, type CalEvent } from './calendar.ts'

const TZ = 'UTC'
const NOW = Date.parse('2026-10-29T10:30:00Z') // jeudi, 10:30 en UTC

const ev = (id: string, summary: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id,
  summary,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra
})

const DAY: CalEvent[] = [
  ev('a', 'Point équipe', '2026-10-29T08:30:00Z', '2026-10-29T09:15:00Z'),
  ev('b', 'Déjeuner M. Bernard', '2026-10-29T12:30:00Z', '2026-10-29T14:00:00Z', { location: 'Vaise, Saint-Rambert' }),
  ev('c', 'Visio partenaires', '2026-10-29T15:00:00Z', '2026-10-29T16:00:00Z', { hangoutLink: 'https://meet.google.com/x', attendees: [{ email: 'claire@gmail.com', self: true, responseStatus: 'needsAction' }, { email: 'a@x.fr' }, { email: 'b@x.fr' }] }),
  ev('d', 'Annulé', '2026-10-29T17:00:00Z', '2026-10-29T18:00:00Z', { status: 'cancelled' }),
  { id: 'e', summary: 'Toussaint (veille)', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } }
]

test('fuseau : minuit local, minutes, jours, lundi, heures saisies', () => {
  assert.equal(zonedTime('2026-10-29', 0, TZ).toISOString(), '2026-10-29T00:00:00.000Z')
  // Paris passe à l'heure d'hiver le 25 octobre 2026 : minuit = 23:00 UTC la veille.
  assert.equal(zonedTime('2026-10-29', 0, 'Europe/Paris').toISOString(), '2026-10-28T23:00:00.000Z')
  assert.equal(zonedTime('2026-07-01', 0, 'Europe/Paris').toISOString(), '2026-06-30T22:00:00.000Z')
  assert.equal(localDay(NOW, TZ), '2026-10-29')
  assert.equal(localMinutes(NOW, TZ), 630)
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(mondayOf('2026-10-29'), '2026-10-26')
  assert.equal(mondayOf('2026-11-01'), '2026-10-26')
  assert.deepEqual(parseLocal('2026-10-30T15:00', '2026-10-29'), { day: '2026-10-30', minutes: 900 })
  assert.deepEqual(parseLocal('9h30', '2026-10-29'), { day: '2026-10-29', minutes: 570 })
  assert.equal(parseLocal('25:00', '2026-10-29'), null)
})

test('événements du jour : triés, annulés retirés, journée entière en tête, état passé / en cours / à venir', () => {
  const evs = eventsOfDay(DAY, '2026-10-29', NOW, TZ)
  assert.deepEqual(evs.map((e) => e.id), ['e', 'a', 'b', 'c'])
  assert.deepEqual(evs.map((e) => e.etat), ['en_cours', 'passe', 'a_venir', 'a_venir'])
  const visio = evs.find((e) => e.id === 'c')!
  assert.equal(visio.debut, '15:00')
  assert.equal(visio.de, 900)
  assert.ok(visio.visio)
  assert.equal(visio.participants, 2)
  assert.equal(visio.reponse?.label, 'À RÉPONDRE')
  assert.ok(evs[0]!.journee)
})

test('un événement sur deux jours est coupé à minuit', () => {
  const night = [ev('n', 'Train de nuit', '2026-10-29T22:00:00Z', '2026-10-30T02:00:00Z')]
  assert.deepEqual(eventsOfDay(night, '2026-10-29', NOW, TZ).map((e) => [e.de, e.a]), [[1320, 1440]])
  assert.deepEqual(eventsOfDay(night, '2026-10-30', NOW, TZ).map((e) => [e.de, e.a, e.debut]), [[0, 120, '22:00']])
})

test('créneaux libres : entre les rendez-vous, assez longs, après maintenant, au quart d’heure', () => {
  const busy = [{ de: 510, a: 555 }, { de: 750, a: 840 }, { de: 900, a: 960 }]
  assert.deepEqual(freeSlots(busy, { de: 480, a: 1080 }, 60), [{ de: 555, a: 750 }, { de: 840, a: 900 }, { de: 960, a: 1080 }])
  assert.deepEqual(freeSlots(busy, { de: 480, a: 1080 }, 90, 637), [{ de: 645, a: 750 }, { de: 960, a: 1080 }])
  assert.deepEqual(freeSlots(busy, { de: 480, a: 1080 }, 200), [])
  assert.deepEqual(freeSlots([{ de: 470, a: 1100 }], { de: 480, a: 1080 }, 30), [])
})

test('délais lisibles', () => {
  assert.equal(relative(NOW + 25 * 60_000, NOW, TZ), 'dans 25 min')
  assert.equal(relative(NOW + 190 * 60_000, NOW, TZ), 'dans 3 h 10')
  assert.equal(relative(Date.parse('2026-10-30T09:00:00Z'), NOW, TZ), 'demain à 09:00')
  assert.equal(relative(Date.parse('2026-11-02T14:30:00Z'), NOW, TZ), 'lundi à 14:30')
})

test('vue du jour : prochain rendez-vous, plage élargie, maintenant, chiffres', () => {
  const early = [...DAY, ev('f', 'Footing', '2026-10-29T06:15:00Z', '2026-10-29T07:00:00Z')]
  const v = agendaView({ events: early, debut: '2026-10-29', jours: 1, now: NOW, tz: TZ, titre: 'Aujourd’hui' })
  assert.equal(v.prochain?.id, 'b')
  assert.equal(v.prochain?.dans, 'dans 2 h')
  assert.equal(v.prochain?.lieu, 'Vaise, Saint-Rambert')
  assert.deepEqual(v.plage, { de: 360, a: 1200 })
  assert.equal(v.maintenant, 630)
  assert.equal(v.kpis[0]!.valeur, '05')
  assert.equal(v.kpis[1]!.valeur, '4 h')
  assert.equal(v.kpis[2]!.valeur, '02') // déjeuner et visio restent aujourd'hui
  assert.match(v.sousTitre, /^JEUDI 29 OCTOBRE · 5 ÉVÉNEMENTS$/)
})

test('disponibilités sur la semaine : rien dans le passé, un refus ne bloque pas', () => {
  const declined = ev('x', 'Refusé', '2026-10-30T09:00:00Z', '2026-10-30T17:00:00Z', { attendees: [{ email: 'o@gmail.com', self: true, responseStatus: 'declined' }] })
  const v = agendaView({ events: [...DAY, declined], debut: '2026-10-28', jours: 3, now: NOW, tz: TZ, titre: 'Disponibilités', libres: { duree: 60, plage: { de: 480, a: 1080 } } })
  assert.equal(v.jours[0]!.libres, undefined) // hier
  assert.deepEqual(v.jours[1]!.libres!.map((s) => `${s.debut}-${s.fin}`), ['10:30-12:30', '14:00-15:00', '16:00-18:00'])
  assert.deepEqual(v.jours[2]!.libres!.map((s) => `${s.debut}-${s.fin}`), ['08:00-18:00'])
  assert.match(agendaForClaude(v), /libres : 10:30-12:30, 14:00-15:00, 16:00-18:00/)
  assert.match(agendaForClaude(v), /\[id c\]/)
})
