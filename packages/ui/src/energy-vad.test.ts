import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EnergyDetector } from './energy-vad.ts'

function run(levels: number[], strict = false) {
  const events: string[] = []
  const d = new EnergyDetector({
    onSpeechStart: () => events.push('début'),
    onSpeechConfirmed: () => events.push('confirmé'),
    onSpeechEnd: () => events.push('fin'),
    onMisfire: () => events.push('fausse alerte')
  })
  d.setStrict(strict)
  for (const l of levels) d.push(l)
  return events
}
const silence = (n: number) => Array(n).fill(0.002)
const voice = (n: number) => Array(n).fill(0.08)

test('une phrase : début, confirmation, puis fin après ~1,5 s de silence', () => {
  assert.deepEqual(run([...silence(30), ...voice(40), ...silence(60)]), ['début', 'confirmé', 'fin'])
})

test('une courte pause au milieu de la phrase ne la coupe pas', () => {
  assert.deepEqual(run([...silence(30), ...voice(20), ...silence(15), ...voice(20), ...silence(60)]), ['début', 'confirmé', 'fin'])
})

test('un bruit bref est une fausse alerte', () => {
  assert.deepEqual(run([...silence(30), ...voice(4), ...silence(60)]), ['début', 'fausse alerte'])
})

test('le bruit de fond constant ne déclenche rien', () => {
  assert.deepEqual(run(Array(200).fill(0.006)), [])
})

test('pendant que CODE parle, un écho faible ne déclenche rien', () => {
  const echo = Array(40).fill(0.025)
  assert.deepEqual(run([...silence(30), ...echo, ...silence(60)], true), [])
  assert.deepEqual(run([...silence(30), ...echo, ...silence(60)], false), ['début', 'confirmé', 'fin'])
})
