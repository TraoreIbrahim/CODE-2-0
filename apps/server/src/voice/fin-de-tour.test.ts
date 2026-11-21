import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SensDuTour } from './fin-de-tour.ts'

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('le sens est demandé à la pause, puis gardé pour ce texte', async () => {
  const demandes: string[] = []
  const verdicts: [string, boolean][] = []
  const sens = new SensDuTour(async (t) => (demandes.push(t), t.endsWith('?')), (t, f) => verdicts.push([t, f]))
  sens.observer('quel temps fait')
  sens.observer('quel temps fait-il à Lyon ?')
  assert.equal(sens.verdict(), null, 'pas encore jugé')
  await attendre(300)
  assert.deepEqual(demandes, ['quel temps fait-il à Lyon ?'], 'seule la transcription stable est relue')
  assert.equal(sens.verdict(), true)
  assert.deepEqual(verdicts, [['quel temps fait-il à Lyon ?', true]])
})

test('une fin évidemment inachevée est jugée sans le modèle ; une erreur laisse le sens inconnu', async () => {
  let appels = 0
  const sens = new SensDuTour(async () => (appels++, null))
  sens.observer('envoie un message à Petit parce que')
  assert.equal(sens.verdict(), false)
  sens.observer('envoie un message à Petit')
  await attendre(300)
  assert.equal(appels, 1)
  assert.equal(sens.verdict(), null)
  sens.reset()
  assert.equal(sens.verdict(), null)
})
