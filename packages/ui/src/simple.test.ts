import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dernierEchange, queue } from './Simple.tsx'

const m = (id: string, role: 'user' | 'assistant', text: string) => ({ id, role, text, ts: 0 })

test('écran simplifié : le dernier échange, la réponse avec la phrase qui l’a demandée', () => {
  assert.deepEqual(dernierEchange([]), {})
  const q = m('u1', 'user', 'Quel temps fait-il ?')
  const r = m('a1', 'assistant', 'Du soleil.')
  assert.deepEqual(dernierEchange([m('a0', 'assistant', 'Bonjour.'), q]), { vous: q }, 'la réponse n’est pas encore là')
  assert.deepEqual(dernierEchange([q, r]), { vous: q, lui: r })
  assert.deepEqual(dernierEchange([m('a0', 'assistant', 'Bonjour.'), r]), { lui: r }, 'un message de l’assistant seul (briefing)')
})

test('écran simplifié : un texte trop long se lit par sa fin, à partir d’une phrase', () => {
  assert.equal(queue('Court.', 50), 'Court.')
  const long = 'Première phrase assez longue pour déborder. Deuxième phrase. Troisième et dernière phrase.'
  assert.equal(queue(long, 50), '… Deuxième phrase. Troisième et dernière phrase.')
  assert.match(queue('un mot puis un autre mot sans aucune ponctuation jusqu’au bout', 30), /^… \S/)
})
