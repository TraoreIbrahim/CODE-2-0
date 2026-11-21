import assert from 'node:assert/strict'
import { test } from 'node:test'
import { phraseInachevee } from '@code/protocol'
import { chiffresDictes } from './chiffres-dictes.ts'

test('chiffres dictés un par un : remis en chiffres', () => {
  assert.equal(chiffresDictes('Le numéro neuf neuf zéro zéro un zéro six'), 'Le numéro 9900106')
  assert.equal(chiffresDictes('le lot LOT zéro zéro cinq'), 'le lot LOT 005')
  assert.equal(chiffresDictes('dossier deux mille vingt-six, zéro zéro zéro trois'), 'dossier deux mille vingt-six, 0003')
  assert.equal(chiffresDictes('LOT double zéro cinq'), 'LOT double zéro cinq') // deux mots : trop peu
  assert.equal(chiffresDictes('code un double zéro sept'), 'code 1007')
})

test('chiffres dictés : le reste de la phrase ne bouge pas', () => {
  assert.equal(chiffresDictes('un client et deux fournisseurs'), 'un client et deux fournisseurs')
  assert.equal(chiffresDictes('Il est neuf heures'), 'Il est neuf heures')
  assert.equal(chiffresDictes('un, deux'), 'un, deux')
})

test('fin de phrase : inachevée sur une liaison, une virgule ou une hésitation', () => {
  for (const t of ['Je voudrais savoir si', 'appelle Bernard parce que', 'le rapport de', 'euh', 'les clients du jour,', 'regarde le dossier…'])
    assert.ok(phraseInachevee(t), t)
  for (const t of ['Quelle heure est-il ?', 'Appelle Bernard.', 'Montre-moi les rendez-vous', 'c’est tout', ''])
    assert.ok(!phraseInachevee(t), t)
})
