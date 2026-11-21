import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sansMotActivation } from './activation.ts'

test('le nom de l’assistant est retiré du début de la phrase', () => {
  assert.equal(sansMotActivation('Dis Aya, quel temps fait-il ?', 'Aya'), 'Quel temps fait-il ?')
  assert.equal(sansMotActivation('Dis-moi AYA, euh, ce qui te manque', 'Aya'), 'Euh, ce qui te manque')
  assert.equal(sansMotActivation('hey aya quels sont mes rendez-vous', 'Aya'), 'Quels sont mes rendez-vous')
  assert.equal(sansMotActivation('Ok Jean Paul. Rappelle-moi demain', 'Jean Paul'), 'Rappelle-moi demain')
  assert.equal(sansMotActivation('Aya', 'Aya'), '')
  assert.equal(sansMotActivation('Dis code.', 'Code'), '')
})

test('le reste de la phrase est gardé tel quel', () => {
  assert.equal(sansMotActivation('Quel temps fait-il ?', 'Aya'), 'Quel temps fait-il ?')
  assert.equal(sansMotActivation('Dis-moi le code du lot LOT-005', 'Code'), 'Dis-moi le code du lot LOT-005')
  assert.equal(sansMotActivation('Ayant fini, appelle Léa', 'Aya'), 'Ayant fini, appelle Léa')
  assert.equal(sansMotActivation('Ouvre le code', 'Code'), 'Ouvre le code')
  assert.equal(sansMotActivation('Dis Aya, bonjour', ''), 'Dis Aya, bonjour')
})
