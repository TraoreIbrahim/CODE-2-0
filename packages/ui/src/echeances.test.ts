import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aujourdhuiDans, echeanceCourt, echeanceDans, echeancesDuJour, jourMois, joursAvant } from './echeances.ts'

test('échéances côté écran : aujourd’hui dans le fuseau, écart recalculé, étiquette courte', () => {
  const now = Date.parse('2026-11-04T23:30:00Z')
  assert.equal(aujourdhuiDans('UTC', now), '2026-11-04')
  assert.equal(aujourdhuiDans('Europe/Paris', now), '2026-11-05')
  assert.equal(joursAvant('2026-11-01', '2026-11-04'), -3)
  assert.deepEqual([-4, 0, 1, 6].map(echeanceCourt), ['RETARD · 4 J', 'AUJ.', 'DEMAIN', 'DANS 6 J'])
  const base = { categorie: 'facture' as const, quand: '', dans: '', etat: 'a_regler' as const }
  const liste = echeancesDuJour([{ ...base, id: 2, titre: 'B', date: '2026-11-10', jours: 99 }, { ...base, id: 1, titre: 'A', date: '2026-11-02', jours: 99 }], 'UTC', now)
  assert.deepEqual(liste.map((e) => [e.titre, e.jours]), [['A', -2], ['B', 6]])
})

test('jour et mois d’une date', () => {
  assert.deepEqual(jourMois('2026-11-14'), { jour: 14, mois: 'NOV.' })
  assert.deepEqual(jourMois('2027-03-02'), { jour: 2, mois: 'MARS' })
})

test('la ligne sous le titre', () => {
  assert.deepEqual([-4, 0, 1, 6].map(echeanceDans), ['en retard de 4 j', 'aujourd’hui', 'demain', 'dans 6 j'])
})
