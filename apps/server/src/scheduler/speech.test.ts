import assert from 'node:assert/strict'
import { test } from 'node:test'
import { greeting, presentationSpeech, reminderSpeech, sampleSpeech, spokenTime } from './speech.ts'

test('salutation selon l’heure', () => {
  assert.equal(greeting(9), 'Bonjour')
  assert.equal(greeting(18), 'Bonsoir')
  assert.equal(greeting(2), 'Bonsoir')
})

test('un rappel dit comme une phrase', () => {
  assert.equal(
    reminderSpeech([{ texte: 'Rendez-vous Atlas à 19 h', annonce: 'Vous avez rendez-vous avec Atlas à 19 h.' }], 'Paul', 18, true),
    'Bonsoir Paul, je vous rappelle que vous avez rendez-vous avec Atlas à 19 h.'
  )
  // Rappel ancien, sans annonce : le texte, introduit naturellement.
  assert.equal(reminderSpeech([{ texte: 'Rendez-vous Atlas à dix-neuf heures ce soir', annonce: null }], 'Paul', 18, true), 'Bonsoir Paul, petit rappel : rendez-vous Atlas à dix-neuf heures ce soir.')
  // CODE vient de parler : pas de deuxième « bonjour ».
  assert.equal(reminderSpeech([{ texte: 'x', annonce: 'vous devez appeler Bernard' }], 'Paul', 10, false), 'Paul, je vous rappelle que vous devez appeler Bernard.')
})

test('plusieurs rappels en une phrase', () => {
  assert.equal(
    reminderSpeech([{ texte: 'Appeler Bernard', annonce: null }, { texte: 'x', annonce: 'Vous devez payer le fournisseur' }], 'Paul', 9, true),
    'Bonjour Paul, j’ai 2 rappels pour vous : appeler Bernard ; vous devez payer le fournisseur.'
  )
})

test('au tutoiement, si la personne l’a choisi', () => {
  assert.equal(reminderSpeech([{ texte: 'x', annonce: 'tu as rendez-vous avec Atlas à 19 h' }], 'Aya', 18, true, true), 'Bonsoir Aya, je te rappelle que tu as rendez-vous avec Atlas à 19 h.')
  assert.equal(reminderSpeech([{ texte: 'Appeler Bernard', annonce: null }, { texte: 'Payer le fournisseur', annonce: null }], 'Aya', 9, false, true), 'Aya, j’ai 2 rappels pour toi : appeler Bernard ; payer le fournisseur.')
})

test('présentation de CODE et extrait de voix : dans le registre choisi, l’heure dite', () => {
  assert.equal(spokenTime('07:30'), '7 h 30')
  assert.equal(spokenTime('08:00'), '8 h')
  assert.equal(spokenTime('08:05'), '8 h 05')
  const vous = presentationSpeech('Madame Durand', false, '08:15', 10, 'Aya')
  assert.match(vous, /^Bonjour Madame Durand, je suis Aya\..*vous fais le point\.$/)
  assert.ok(vous.includes('à 8 h 15') && !/\b(te|tu|toi)\b/.test(vous))
  const tu = presentationSpeech('Léa', true, '07:30', 20, 'Code')
  assert.match(tu, /^Bonsoir Léa, .*Touche l’orbe.*je te fais le point\.$/)
  assert.ok(!/\bvous\b/.test(tu))
  assert.equal(sampleSpeech('Martin', false, 'Nova'), 'Martin, je suis Nova. C’est avec cette voix que je vous parlerai.')
  assert.ok(sampleSpeech('Léa', true, 'Code').includes('je te parlerai'))
})
