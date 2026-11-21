import assert from 'node:assert/strict'
import { test } from 'node:test'
import { briefingDue, dayLabel, describeRecurrence, nextOccurrence, parseWhen, weekday } from './rules.ts'
import { rappelsView } from './views.ts'
import type { Rappel } from './store.ts'

const TZ = 'UTC'
const NOW = Date.parse('2026-10-29T10:30:00Z') // jeudi 29 octobre, 10:30 en UTC
const iso = (ms: number) => new Date(ms).toISOString()

test('« dans 2 h », « à 9 h » (demain si passé), date précise, passé refusé', () => {
  assert.equal(iso((parseWhen({ dans_minutes: 120 }, NOW, TZ) as { echeance: number }).echeance), '2026-10-29T12:30:00.000Z')
  assert.equal(iso((parseWhen({ le: '18:00' }, NOW, TZ) as { echeance: number }).echeance), '2026-10-29T18:00:00.000Z')
  assert.equal(iso((parseWhen({ le: '9h' }, NOW, TZ) as { echeance: number }).echeance), '2026-10-30T09:00:00.000Z')
  assert.equal(iso((parseWhen({ le: '2026-11-03T08:15' }, NOW, TZ) as { echeance: number }).echeance), '2026-11-03T08:15:00.000Z')
  assert.match(parseWhen({ le: '2026-10-28T08:00' }, NOW, TZ) as string, /déjà passée/)
  assert.match(parseWhen({ dans_minutes: 30, le: '18:00' }, NOW, TZ) as string, /exactement une/)
  assert.match(parseWhen({}, NOW, TZ) as string, /exactement une/)
})

test('répétitions : tous les jours, jours ouvrés, lundis et jeudis, le 31 de chaque mois', () => {
  const daily = parseWhen({ repetition: 'quotidien', heure: '08:00' }, NOW, TZ) as { echeance: number; recurrence: never }
  assert.equal(iso(daily.echeance), '2026-10-30T08:00:00.000Z')
  const work = parseWhen({ repetition: 'jours_ouvres', heure: '07:45' }, Date.parse('2026-10-30T09:00:00Z'), TZ) as { echeance: number }
  assert.equal(iso(work.echeance), '2026-11-02T07:45:00.000Z') // vendredi après l'heure → lundi
  const weekly = parseWhen({ repetition: 'hebdomadaire', jours: ['lundi', 'Jeudi'], heure: '17:00' }, NOW, TZ) as { echeance: number; recurrence: Parameters<typeof nextOccurrence>[0] }
  assert.equal(iso(weekly.echeance), '2026-10-29T17:00:00.000Z') // jeudi, plus tard aujourd'hui
  assert.equal(iso(nextOccurrence(weekly.recurrence, weekly.echeance, TZ)), '2026-11-02T17:00:00.000Z')
  const monthly = parseWhen({ repetition: 'mensuel', jour_du_mois: 31, heure: '09:00' }, NOW, TZ) as { echeance: number; recurrence: Parameters<typeof nextOccurrence>[0] }
  assert.equal(iso(monthly.echeance), '2026-10-31T09:00:00.000Z')
  assert.equal(iso(nextOccurrence(monthly.recurrence, monthly.echeance, TZ)), '2026-11-30T09:00:00.000Z') // novembre : 30 jours
  assert.match(parseWhen({ repetition: 'hebdomadaire', jours: ['lundy'], heure: '08:00' }, NOW, TZ) as string, /jours/)
  assert.match(parseWhen({ repetition: 'quotidien' }, NOW, TZ) as string, /heure/)
})

test('descriptions lisibles', () => {
  assert.equal(describeRecurrence({ type: 'hebdomadaire', heure: 480, jours: [3, 0] }), 'tous les lundis et jeudis à 08:00')
  assert.equal(describeRecurrence({ type: 'jours_ouvres', heure: 465 }), 'du lundi au vendredi à 07:45')
  assert.equal(describeRecurrence({ type: 'mensuel', heure: 540, jour: 1 }), 'le 1er de chaque mois à 09:00')
  assert.equal(weekday('2026-10-29'), 3)
  assert.equal(dayLabel(Date.parse('2026-10-30T08:00:00Z'), NOW, TZ), 'demain')
  assert.equal(dayLabel(Date.parse('2026-11-05T08:00:00Z'), NOW, TZ), 'jeu. 5 nov.')
})

test('briefing du matin : à partir de 7 h 30, une fois par jour, jamais l’après-midi', () => {
  const at = (h: string) => Date.parse(`2026-10-29T${h}:00Z`)
  assert.equal(briefingDue(at('07:29'), TZ, '07:30', null), false)
  assert.equal(briefingDue(at('07:30'), TZ, '07:30', null), true)
  assert.equal(briefingDue(at('09:10'), TZ, '07:30', '2026-10-28'), true) // Mac allumé plus tard
  assert.equal(briefingDue(at('09:10'), TZ, '07:30', '2026-10-29'), false) // déjà fait
  assert.equal(briefingDue(at('14:00'), TZ, '07:30', null), false)
  assert.equal(briefingDue(at('21:40'), TZ, '21:35', null), true) // heure de test, le soir
})

test('vue : ceux qui sonnent d’abord, puis aujourd’hui, demain, récurrents, faits', () => {
  const r = (id: number, texte: string, at: string, extra: Partial<Rappel> = {}): Rappel => ({ id, texte, echeance: Date.parse(at), recurrence: null, etat: 'a_venir', sonneLe: null, retard: false, alerte: false, annonce: null, de: null, deLaPart: null, ...extra })
  const active = [
    r(1, 'Appeler le fournisseur', '2026-10-29T10:00:00Z', { etat: 'sonne', alerte: true, retard: true }),
    r(2, 'Envoyer le devis', '2026-10-29T16:00:00Z'),
    r(3, 'Réunion Atlas', '2026-10-30T09:00:00Z'),
    r(4, 'Point hebdo', '2026-11-02T08:00:00Z', { recurrence: { type: 'hebdomadaire', heure: 480, jours: [0] } })
  ]
  const v = rappelsView(active, [r(5, 'Payer la facture', '2026-10-29T08:00:00Z', { etat: 'fait' })], NOW, TZ, 2)
  assert.deepEqual(v.groupes.map((g) => g.label), ['Qui sonnent', 'Aujourd’hui', 'Demain', 'Récurrents', 'Faits aujourd’hui'])
  assert.equal(v.groupes[0]!.rappels[0]!.etat, 'sonne')
  assert.ok(v.groupes[0]!.rappels[0]!.retard)
  assert.equal(v.groupes[3]!.rappels[0]!.recurrence, 'tous les lundis à 08:00')
  assert.equal(v.kpis[0]!.valeur, '01')
  assert.equal(v.kpis[2]!.valeur, '16:00')
  assert.equal(v.focus, 2)
  assert.equal(v.sousTitre, '4 RAPPELS ACTIFS · 1 RÉCURRENT')
})
