import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfirmGate, normalize, trimCourtesy } from './confirm.ts'
import { codeConfig } from '../../../../config/code.config.ts'

function setup() {
  let clock = 1_000
  let fire: (() => void) | null = null
  const results: string[] = []
  let executed = 0
  const gate = new ConfirmGate({
    timeoutMs: 30_000,
    acceptPhrases: ['oui', 'oui envoie', 'vas y', 'confirme'],
    onResult: (_req, outcome, via) => results.push(`${outcome}:${via}`),
    now: () => clock,
    setTimer: (fn) => ((fire = fn), 1),
    clearTimer: () => (fire = null)
  })
  const ask = () => gate.request('Envoyer le mail', 'À M. Bernard', () => void executed++)
  return {
    gate,
    ask,
    results,
    executed: () => executed,
    advance: (ms: number) => (clock += ms),
    fireTimer: () => fire?.()
  }
}

test('normalize retire accents, casse et ponctuation', () => {
  assert.equal(normalize('  Oui, ENVOIE ! '), 'oui envoie')
  assert.equal(normalize('Vas-y'), 'vas y')
  assert.equal(normalize('Ça marche'), 'ca marche')
})

test('un « oui » explicite valide et exécute', () => {
  const t = setup()
  t.ask()
  assert.equal(t.gate.answerVoice('Oui, envoie.'), 'valide')
  assert.equal(t.executed(), 1)
  assert.deepEqual(t.results, ['valide:voix'])
  assert.equal(t.gate.pending, null)
})

test('hésitation, bruit ou phrase ambiguë annulent sans exécuter', () => {
  for (const said of ['euh', '', 'oui mais attends', 'non', 'ouais peut-être', 'oui oui envoie le à tout le monde']) {
    const t = setup()
    t.ask()
    assert.equal(t.gate.answerVoice(said), 'annule', `« ${said} » ne doit pas valider`)
    assert.equal(t.executed(), 0)
  }
})

test('le délai dépassé expire la demande', () => {
  const t = setup()
  t.ask()
  t.advance(30_001)
  t.fireTimer()
  assert.deepEqual(t.results, ['expire:delai'])
  assert.equal(t.gate.answerVoice('oui'), null)
  assert.equal(t.executed(), 0)
})

test('un accord arrivé après l’échéance ne vaut rien', () => {
  const t = setup()
  t.ask()
  t.advance(31_000)
  assert.equal(t.gate.answerVoice('oui'), 'expire')
  assert.equal(t.executed(), 0)
})

test('le bouton doit citer le bon identifiant d’action', () => {
  const t = setup()
  const req = t.ask()
  assert.equal(t.gate.answerButton('autre-action', true), null)
  assert.equal(t.executed(), 0)
  assert.equal(t.gate.answerButton(req.actionId, true), 'valide')
  assert.equal(t.executed(), 1)
})

test('une nouvelle demande annule la précédente', () => {
  const t = setup()
  const first = t.ask()
  t.ask()
  assert.deepEqual(t.results, ['annule:systeme'])
  assert.equal(t.gate.answerButton(first.actionId, true), null)
  assert.equal(t.executed(), 0)
})

test('accord : les mots d’appui et les politesses ne comptent pas ; « je valide » vaut « oui »', () => {
  assert.equal(trimCourtesy(normalize('Euh, oui merci !')), 'oui')
  assert.equal(trimCourtesy(normalize('Bon alors, je valide, s’il te plaît')), 'je valide')
  const gate = new ConfirmGate({ timeoutMs: 30_000, acceptPhrases: codeConfig.safety.acceptPhrases, onResult: () => {} })
  for (const said of ['Je valide.', 'Oui, je valide', 'C’est bon', 'OK, envoie', 'D’accord', 'Vas-y, envoie', 'Parfait, envoie', 'Oui merci', 'Euh oui', 'Tu peux envoyer', 'Oui, tu peux l’envoyer']) {
    assert.equal(gate.classify(said), 'accord', said)
  }
  for (const said of ['non', 'Annule', 'laisse tomber', 'euh', '', 'non merci']) assert.equal(gate.classify(said), 'refus', said)
  // Une autre demande : l'action est annulée et la phrase repart comme une demande.
  for (const said of ['Dis-lui plutôt qu’on le rappelle demain', 'tutoie-le et fais plus court', 'oui mais attends une seconde']) assert.equal(gate.classify(said), 'autre', said)
  // Jamais d'accord sur une phrase qui ajoute quelque chose.
  for (const said of ['oui envoie le à tout le monde', 'je valide mais change le début', 'ok mais pas maintenant']) assert.notEqual(gate.classify(said), 'accord', said)
})
