import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import type { ServerPayload } from '@code/protocol'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-conversation-'))
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { ensureOwner } = await import('../db.ts')
const { Session } = await import('./session.ts')
const { codeConfig } = await import('../../../../config/code.config.ts')
type SessionDeps = ConstructorParameters<typeof Session>[1]

const uid = ensureOwner()

/** Une session sans réseau : ce qu'elle envoie est noté, par connexion (`*` : à tous). */
function session(empreinte: boolean) {
  const sent: { to: string; msg: ServerPayload }[] = []
  const io = {
    send: (to: string, msg: ServerPayload) => sent.push({ to, msg }),
    sendBinary: () => {},
    broadcast: (msg: ServerPayload) => sent.push({ to: '*', msg })
  }
  const s = new Session(uid, { io, cles: () => ({}), voix: async () => null, fichiers: () => false } satisfies SessionDeps)
  // Le modèle de reconnaissance n'est pas là pendant les tests : l'empreinte est simulée.
  Object.defineProperty(s.speaker, 'tracking', { get: () => empreinte })
  s.welcome('mac-1', 'mac', 1)
  s.welcome('mobile-1', 'mobile', 2)
  const ecoutes = () => sent.filter((e) => e.to === '*' && e.msg.type === 'ecoute').map((e) => (e.msg as Extract<ServerPayload, { type: 'ecoute' }>).ecoute)
  return { s, sent, ecoutes }
}

test('mode conversation : refusé sans empreinte vocale, en disant comment l’enregistrer', () => {
  const { s, sent, ecoutes } = session(false)
  const r = s.setConversation('mac-1', true)
  assert.equal(r.ok, false)
  assert.match(r.message, /empreinte vocale|reconnaissance de votre voix/)
  assert.ok(sent.some((e) => e.to === 'mac-1' && e.msg.type === 'error' && e.msg.code === 'conversation_empreinte'))
  assert.equal(ecoutes().length, 0)
  assert.equal(s.ecoute().conversation, null)
})

test('mode conversation : tenu par l’appareil qui le demande, coupé par lui ou par sa déconnexion', () => {
  const { s, ecoutes } = session(true)
  assert.equal(s.ecoute().relanceMs, codeConfig.voice.ecoute.relanceMs)
  assert.equal(s.setConversation('inconnu', true).ok, false, 'pas depuis un appareil inconnu')
  assert.equal(s.setConversation('mac-1', true).ok, true)
  assert.deepEqual(ecoutes().at(-1)?.conversation, { connectionId: 'mac-1', appareil: 'mac', silenceMs: codeConfig.voice.ecoute.conversationSilenceMs })
  assert.equal(s.setConversation(null, false).ok, true, '« arrête d’écouter », d’où qu’il vienne')
  assert.equal(ecoutes().at(-1)?.conversation, null)
  s.setConversation('mac-1', true)
  s.onDisconnect('mac-1')
  assert.equal(s.ecoute().conversation, null, 'Mac en veille : connexion perdue')
})

test('mode conversation : coupé après le long silence de votre voix', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { s } = session(true)
    s.setConversation('mac-1', true)
    mock.timers.tick(codeConfig.voice.ecoute.conversationSilenceMs - 1_000)
    assert.notEqual(s.ecoute().conversation, null)
    mock.timers.tick(1_000)
    assert.equal(s.ecoute().conversation, null)
  } finally {
    mock.timers.reset()
  }
})
