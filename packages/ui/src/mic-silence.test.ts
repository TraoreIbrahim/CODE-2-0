import assert from 'node:assert/strict'
import { test } from 'node:test'
import { watchSilence, type MicHandlers } from './mic.ts'
import { silentMessage } from './voice.ts'

function harness() {
  let t = 0
  const events: string[] = []
  const base: MicHandlers = {
    onSpeechStart: () => {},
    onFrame: () => {},
    onSpeechConfirmed: () => {},
    onSpeechEnd: () => {},
    onMisfire: () => {},
    onLevel: () => {},
    onSilent: (d) => events.push(`silent:${d}`),
    onSound: () => events.push('sound')
  }
  const h = watchSilence(base, 'H4 PRO MAX', () => {}, () => t)
  // Une trame toutes les 32 ms pendant `ms`, au volume donné.
  const feed = (level: number, ms: number) => {
    for (let end = t + ms; t < end; t += 32) h.onLevel(level)
  }
  return { feed, events }
}

test('micro muet : prévenu une fois au bout de 3 s, puis quand le son revient', () => {
  const { feed, events } = harness()
  feed(0, 2900)
  assert.deepEqual(events, [], 'pas avant 3 s')
  feed(0, 2000)
  assert.deepEqual(events, ['silent:H4 PRO MAX'], 'une seule fois')
  feed(0.08, 100)
  assert.deepEqual(events, ['silent:H4 PRO MAX', 'sound'])
})

test('pièce calme : un fond sonore, même faible, n’est pas un micro muet', () => {
  const { feed, events } = harness()
  feed(0.004, 6000)
  feed(0, 6000)
  assert.deepEqual(events, [], 'le micro a déjà capté du son : c’est un silence, pas une panne')
})

test('message : le nom des écouteurs, ou le micro de l’appareil', () => {
  assert.match(silentMessage('H4 PRO MAX'), /« H4 PRO MAX » ne capte aucun son : débranchez ces écouteurs/)
  assert.match(silentMessage('Micro de l’iPhone'), /ne capte aucun son : vérifiez/)
  assert.match(silentMessage(''), /ne capte aucun son : vérifiez/)
})
