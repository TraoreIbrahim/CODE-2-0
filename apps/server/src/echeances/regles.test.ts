import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ajouterJours, dansCombien, dateCourte, dateValide, ecartJours, montantLisible, suivante, totaux } from './regles.ts'

test('dates : validité, écart en jours, ajout par-delà les mois', () => {
  assert.ok(dateValide('2026-02-28'))
  assert.ok(!dateValide('2026-02-29'))
  assert.ok(!dateValide('2026-4-01'))
  assert.equal(ecartJours('2026-11-04', '2026-11-14'), 10)
  assert.equal(ecartJours('2026-11-04', '2026-10-31'), -4)
  assert.equal(ajouterJours('2026-03-01', -3), '2026-02-26')
})

test('récurrence : même jour du mois quand il existe, sans dériver vers le 28', () => {
  assert.equal(suivante('2026-01-31', 'mensuel', 31), '2026-02-28')
  assert.equal(suivante('2026-02-28', 'mensuel', 31), '2026-03-31')
  assert.equal(suivante('2026-11-15', 'trimestriel', 15), '2027-02-15')
  assert.equal(suivante('2028-02-29', 'annuel', 29), '2029-02-28')
  assert.equal(suivante('2026-08-31', 'semestriel', 31), '2027-02-28')
})

test('libellés : « demain », « en retard de 3 jours », date courte avec l’année si elle change', () => {
  assert.deepEqual([0, 1, -1, 5, -3].map(dansCombien), ['aujourd’hui', 'demain', 'hier', 'dans 5 jours', 'en retard de 3 jours'])
  assert.equal(dateCourte('2026-11-14', '2026-11-04'), 'sam. 14 nov.')
  assert.match(dateCourte('2027-03-02', '2026-11-04'), /2027/)
})

test('montants : devise ISO, FCFA reconnu, devise inconnue écrite telle quelle, totaux par devise', () => {
  const espace = (s: string) => s.replace(/[  ]/g, ' ')
  assert.equal(espace(montantLisible(84.9, 'EUR')), '84,90 €')
  assert.equal(espace(montantLisible(1150, 'eur')), '1 150 €')
  assert.match(espace(montantLisible(250000, 'FCFA')), /^250 000 F\s?CFA$/)
  assert.equal(espace(montantLisible(12, 'points')), '12 points')
  assert.equal(espace(montantLisible(12.5, null)), '12,5')
  assert.equal(espace(totaux([{ montant: 10, devise: 'EUR' }, { montant: 5.5, devise: 'EUR' }, { montant: null, devise: 'EUR' }, { montant: 1000, devise: 'XOF' }])), '15,50 € + 1 000 F CFA')
  assert.equal(totaux([{ montant: null, devise: null }]), '')
})
