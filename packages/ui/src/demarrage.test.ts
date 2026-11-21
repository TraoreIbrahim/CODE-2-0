import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageDemarrage } from './Demarrage.tsx'

test('écran de démarrage : le message suit l’attente', () => {
  assert.equal(messageDemarrage(0), 'Connexion au serveur')
  assert.equal(messageDemarrage(3_999), 'Connexion au serveur')
  assert.equal(messageDemarrage(4_000), 'Le serveur se réveille')
  assert.equal(messageDemarrage(9_000), 'Encore un instant')
})
