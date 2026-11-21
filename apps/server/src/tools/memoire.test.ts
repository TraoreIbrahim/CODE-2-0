import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UiMemoire } from '@code/protocol'
import type { ToolContext } from './types.ts'
import { addNote, memoireView, memoireVoir, notesDe, remember } from './memory.ts'

const ctx = (uid: number) => ({ user: { id: uid } }) as unknown as ToolContext

test('mémoire à l’écran : les notes par rubrique, avec leur date ; rien quand il n’y a rien', async () => {
  assert.deepEqual(memoireView(9401).rubriques, [])
  assert.equal(memoireView(9401).sousTitre, 'Aucune note')
  assert.match(String((await memoireVoir.run({}, ctx(9401))).content), /Aucune note/)
  addNote(9401, 'contacts', 'M. Bernard est le comptable, à Villeurbanne')
  addNote(9401, 'preferences', 'Préfère les réponses courtes (jamais de liste)')
  const notes = notesDe(9401, 'contacts')
  assert.equal(notes[0]!.texte, 'M. Bernard est le comptable, à Villeurbanne')
  assert.match(notes[0]!.date ?? '', /^\d{1,2} \S+ \d{4}$/)
  // Une parenthèse dans la note n'est pas prise pour sa date.
  assert.equal(notesDe(9401, 'preferences')[0]!.texte, 'Préfère les réponses courtes (jamais de liste)')
  const vue = (await memoireVoir.run({}, ctx(9401))).view as UiMemoire
  assert.deepEqual(vue.rubriques.map((r) => [r.nom, r.notes.length]), [['Personnes', 1], ['Préférences', 1]])
  assert.equal(vue.sousTitre, '2 notes')
})

test('retenir : la note s’affiche, mise en avant ; chacun ses notes', async () => {
  const r = await remember.run({ fait: 'Camille est la graphiste de l’agence', sujet: 'contacts' }, ctx(9402))
  const vue = r.view as UiMemoire
  assert.equal(vue.kind, 'memoire')
  assert.equal(vue.focus, 'Camille est la graphiste de l’agence')
  assert.deepEqual(vue.rubriques[0]!.notes.map((n) => n.texte), ['Camille est la graphiste de l’agence'])
  assert.deepEqual(memoireView(9403).rubriques, [])
})
