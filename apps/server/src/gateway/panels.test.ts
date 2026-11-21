import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UiView } from '@code/protocol'
import { MarkStripper, TurnPanels, readingMs, takeMarks } from './panels.ts'

test('les marques disparaissent du texte, même coupées entre deux morceaux', () => {
  const s = new MarkStripper()
  const out = ['Voici. [[vo', 'ir:mails_impor', 'tants]] Côté mails, [', '3 non lus]. [[voir]]Fin'].map((d) => s.push(d)).join('') + s.flush()
  assert.equal(out, 'Voici.  Côté mails, [3 non lus]. Fin')
  assert.equal(s.seen, true)
  const plain = new MarkStripper()
  assert.equal(plain.push('Rien [à') + plain.flush(), 'Rien [à')
  assert.equal(plain.seen, false)
})

test('une phrase rend ses marques (noms nettoyés par la voix compris)', () => {
  assert.deepEqual(takeMarks('[[voir:crmgetdashboardstats]] Mille clients.'), { text: 'Mille clients.', names: ['crmgetdashboardstats'] })
  assert.deepEqual(takeMarks('Mille clients.'), { text: 'Mille clients.', names: [] })
})

test('un panneau reste masqué jusqu’à sa marque ; un nom inconnu prend le premier caché', () => {
  const sent: UiView[] = []
  const p = new TurnPanels((v) => sent.push(v))
  const view = (id: string): UiView => ({ id, turnId: 't', kind: 'mails', title: id, status: 'pret', at: 1 })
  p.update('mails_importants', view('a'))
  p.update('crm_get_dashboard_stats', view('b'))
  p.update('rappels_lister', view('c'))
  assert.deepEqual(sent.map((v) => v.masque), [true, true, true])
  p.reveal('crmgetdashboardstats')
  assert.equal(sent.at(-1)!.id, 'b')
  assert.equal(sent.at(-1)!.masque, undefined)
  p.reveal('inconnu')
  assert.equal(sent.at(-1)!.id, 'a')
  p.update('mails_importants', view('a'))
  assert.equal(sent.at(-1)!.masque, undefined)
  p.showAll()
  assert.deepEqual(sent.slice(-1).map((v) => [v.id, v.masque]), [['c', undefined]])
})

test('fin de réponse : les panneaux déjà prévus gardent leur moment, les autres viennent après', async () => {
  const sent: UiView[] = []
  const panels = new TurnPanels((v) => sent.push(v))
  const view = (id: string): UiView => ({ id, turnId: 't', kind: 'mails', title: id, status: 'pret', at: 0 })
  panels.update('a', view('a'))
  panels.update('b', view('b'))
  panels.reveal('a', 30)
  panels.finish(60)
  assert.equal(sent.filter((v) => !v.masque).length, 0)
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(sent.filter((v) => !v.masque).map((v) => v.id), ['a'])
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(sent.filter((v) => !v.masque).map((v) => v.id), ['a', 'b'])
})

test('lecture : une phrase courte reste un instant, une longue plafonne', () => {
  assert.equal(readingMs('Oui.'), 900)
  assert.equal(readingMs('x'.repeat(60)), 3000)
  assert.equal(readingMs('x'.repeat(500)), 6000)
})
