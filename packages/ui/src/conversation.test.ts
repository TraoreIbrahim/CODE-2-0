import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ecoute, ServerMessage } from '@code/protocol'
import { CodeClient } from './client.ts'
import { viewOf } from './view.ts'
import { conversationHere, conversationOn } from './voice.ts'

const idle = { micOn: false, opening: false, playing: false, micError: null }

function client(connectionId: string, ecoute: Ecoute) {
  const c = new CodeClient({ url: 'ws://test', token: 't', device: 'mac' })
  const handle = (m: ServerMessage) => (c as unknown as { handle(m: ServerMessage): void }).handle(m)
  ;(c as unknown as { patch(p: object): void }).patch({ connection: 'connecte', connectionId })
  handle({ type: 'ecoute', ecoute } as ServerMessage)
  return c.getState()
}

test('mode conversation : tenu ici, ailleurs sur le Mac, ou sur le téléphone', () => {
  const sur = (connectionId: string, appareil: 'mac' | 'mini' | 'mobile') => ({ relanceMs: 20_000, conversation: { connectionId, appareil, silenceMs: 300_000 } })
  const ici = client('a', sur('a', 'mac'))
  assert.ok(conversationHere(ici))
  assert.equal(viewOf(ici, idle, 'mac').label, 'EN CONVERSATION')

  // Tenu par l'app du Mac : la miniature le montre aussi, sans ouvrir son propre micro.
  const miniature = client('b', sur('a', 'mac'))
  assert.ok(!conversationHere(miniature))
  assert.ok(conversationOn(miniature, ['mac', 'mini']))
  assert.equal(viewOf(miniature, idle, 'mac').label, 'EN CONVERSATION')

  // Tenu par le téléphone : le Mac reste en veille.
  const mac = client('b', sur('t', 'mobile'))
  assert.ok(!conversationOn(mac, ['mac', 'mini']))
  assert.equal(viewOf(mac, idle, 'mac').label, 'EN VEILLE')

  const coupe = client('a', { relanceMs: 20_000, conversation: null })
  assert.ok(!conversationHere(coupe))
})

test('alerte : un rappel qui sonne met l’orbe en alerte, au repos seulement', () => {
  const c = client('a', { relanceMs: 20_000, conversation: null })
  const sonne = { id: 1, texte: 'Appeler le plombier', echeance: 0, heure: '19:00', jour: 'aujourd’hui', etat: 'sonne' as const, retard: true }
  const s = { ...c, rappels: [sonne] }
  const v = viewOf(s, idle, 'mac')
  assert.equal(v.orb, 'alerte')
  assert.equal(v.label, 'RAPPEL EN RETARD')
  assert.equal(v.tone, 'rouge')
  // Micro ouvert : l'écoute passe avant l'alerte.
  assert.equal(viewOf(s, { ...idle, micOn: true }, 'mac').orb, 'ecoute')
  // Rien qui sonne : veille.
  assert.equal(viewOf({ ...c, rappels: [{ ...sonne, etat: 'a_venir' }] }, idle, 'mac').orb, 'repos')
})
