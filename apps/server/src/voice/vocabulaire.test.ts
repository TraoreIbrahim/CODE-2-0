import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-vocabulaire-'))
const { jetons, motsCles, nettoyer } = await import('./vocabulaire.ts')

const beaucoup = Array.from({ length: 1200 }, (_, i) => `Mot numéro ${i}`)

test('vocabulaire : un mot-clé Scribe fait moins de 50 caractères et 5 mots au plus', () => {
  assert.equal(nettoyer('  ordre   du jour '), 'ordre du jour')
  assert.equal(nettoyer('x'.repeat(49)), 'x'.repeat(49))
  assert.equal(nettoyer('x'.repeat(50)), null)
  assert.equal(nettoyer('un deux trois quatre cinq'), 'un deux trois quatre cinq')
  assert.equal(nettoyer('un deux trois quatre cinq six'), null)
  assert.equal(nettoyer('   '), null)
})

test('vocabulaire : le lexique d’abord, sans doublon (ni casse ni accents), 1 000 au plus pour Scribe', () => {
  const { scribe } = motsCles({ lexique: ['Hélène', 'Brocéliande'], configures: ['HELENE', 'Aya', ...beaucoup] }, { scribe: 1000, deepgram: 50, jetons: 450 })
  assert.deepEqual(scribe.slice(0, 3), ['Hélène', 'Brocéliande', 'Aya'])
  assert.equal(scribe.length, 1000)
  for (const t of scribe) assert.ok(t.length < 50 && t.split(' ').length <= 5, t)
})

test('vocabulaire : Deepgram reçoit les plus utiles, sous son budget de jetons', () => {
  const { deepgram } = motsCles({ lexique: ['Brocéliande'], configures: beaucoup }, { scribe: 1000, deepgram: 50, jetons: 450 })
  assert.ok(deepgram.length <= 50)
  assert.equal(deepgram[0], 'Brocéliande')
  assert.ok(deepgram.reduce((n, t) => n + jetons(t), 0) <= 450)
  assert.ok(motsCles({ lexique: [], configures: beaucoup }, { scribe: 1000, deepgram: 50, jetons: 60 }).deepgram.reduce((n, t) => n + jetons(t), 0) <= 60)
})
