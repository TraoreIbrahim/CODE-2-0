import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paragraphes, parPersonne } from './Reunion.tsx'

test('un long passage se lit en paragraphes de quelques phrases, sans perdre un mot', () => {
  const texte = Array.from({ length: 9 }, (_, i) => `Phrase numéro ${i + 1} de la réunion, assez longue pour compter.`).join(' ')
  const ps = paragraphes(texte, 160)
  assert.ok(ps.length >= 3)
  assert.equal(ps.join(' '), texte)
  assert.ok(ps.every((p) => /[.!?…]$/.test(p)))
  assert.deepEqual(paragraphes('Une seule phrase sans point final'), ['Une seule phrase sans point final'])
  assert.deepEqual(paragraphes('Oui. Non ! Peut-être ?', 400), ['Oui. Non ! Peut-être ?'])
})

test('les actions se regroupent par personne, celles sans nom en dernier', () => {
  const g = parPersonne([{ quoi: 'a' }, { quoi: 'b', qui: 'Léa' }, { quoi: 'c', qui: 'Paul' }, { quoi: 'd', qui: ' Léa ' }])
  assert.deepEqual(g.map((x) => [x.qui, x.actions.map((a) => a.quoi)]), [['Léa', ['b', 'd']], ['Paul', ['c']], ['', ['a']]])
})
