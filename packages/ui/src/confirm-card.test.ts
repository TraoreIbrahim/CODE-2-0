import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitSummary } from './ConfirmCard.tsx'

test('carte de validation : le cadre (À, Depuis, Objet) à part, le message dans son encadré', () => {
  assert.deepEqual(splitSummary('À Claire Martin (claire.martin@exemple.com)\nBonjour Claire.'), { meta: ['À Claire Martin (claire.martin@exemple.com)'], body: 'Bonjour Claire.' })
  assert.deepEqual(splitSummary('Depuis a@b.fr (Pro)\nÀ k@x.fr\nObjet : Devis\nBonjour,\nVoici.'), { meta: ['Depuis a@b.fr (Pro)', 'À k@x.fr', 'Objet : Devis'], body: 'Bonjour,\nVoici.' })
  // Une seule ligne, ou une phrase qui commence par « Annuler » : tout reste dans le corps.
  assert.deepEqual(splitSummary('Archiver la facture FAC-2026'), { meta: [], body: 'Archiver la facture FAC-2026' })
  assert.deepEqual(splitSummary('À demain 9 h'), { meta: [], body: 'À demain 9 h' })
})
