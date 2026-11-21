import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServerMessage, UiView } from '@code/protocol'
import { CodeClient } from './client.ts'

const view = (id: string, turnId: string, at: number, data = true): UiView =>
  ({ id, turnId, kind: 'sites', title: id, status: data ? 'pret' : 'chargement', at, ...(data ? { data: { kind: 'sites', titre: id } } : {}) }) as unknown as UiView

function client() {
  const c = new CodeClient({ url: 'ws://test', token: 't', device: 'mac' })
  const send = (v: UiView) => (c as unknown as { handle(m: ServerMessage): void }).handle({ type: 'ui.view', view: v } as ServerMessage)
  return { c, send }
}

test('un nouveau tour range les panneaux du précédent, un clic les ramène', () => {
  const { c, send } = client()
  send(view('liste', 't1', 1))
  send(view('fiche', 't2', 2))
  assert.deepEqual(c.getState().views.map((v) => v.id), ['fiche'])
  assert.deepEqual(c.getState().pile.map((g) => g.map((v) => v.id)), [['liste']])

  c.restoreViews('t1')
  assert.deepEqual(c.getState().views.map((v) => v.id), ['liste'])
  assert.deepEqual(c.getState().pile.map((g) => g.map((v) => v.id)), [['fiche']])

  c.clearViews()
  assert.equal(c.getState().views.length, 0)
  assert.equal(c.getState().pile.length, 0)
})

test('même tour : le panneau se met à jour sur place ; la pile garde trois tours ; un panneau vide ne se range pas', () => {
  const { c, send } = client()
  send(view('a', 't1', 1, false))
  send(view('b', 't2', 2))
  assert.equal(c.getState().pile.length, 0, 'un chargement sans contenu ne se range pas')
  send(view('b', 't2', 3))
  assert.equal(c.getState().views.length, 1)
  for (const t of ['t3', 't4', 't5', 't6']) send(view(t, t, 4))
  assert.deepEqual(c.getState().pile.map((g) => g[0]!.turnId), ['t5', 't4', 't3'])
  // Une page arrivée après coup pour un tour rangé reste rangée.
  send({ ...view('t4', 't4', 9), title: 'page 2' })
  assert.equal(c.getState().views[0]!.turnId, 't6')
  assert.equal(c.getState().pile[1]![0]!.title, 'page 2')
})
