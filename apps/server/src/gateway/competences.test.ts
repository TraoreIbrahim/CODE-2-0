import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { decode, encode, type ClientMessage, type ClientPayload, type ServerPayload } from '@code/protocol'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-competences-'))
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { ensureOwner } = await import('../db.ts')
const { Session } = await import('./session.ts')
const { listCompetences } = await import('../competences/store.ts')
type SessionDeps = ConstructorParameters<typeof Session>[1]

const uid = ensureOwner()
const sent: { to: string; msg: ServerPayload }[] = []
const io = { send: (to: string, msg: ServerPayload) => sent.push({ to, msg }), sendBinary: () => {}, broadcast: (msg: ServerPayload) => sent.push({ to: '*', msg }) }
const s = new Session(uid, { io, cles: () => ({}), voix: async () => null, fichiers: () => false } satisfies SessionDeps)

/** Le message tel qu'il arrive du réseau : avec l'enveloppe (`v`, `id` du message, `ts`). */
const recu = (p: ClientPayload) => decode<ClientMessage>(encode(p)) as unknown as Record<string, unknown>
const resultat = () => sent.filter((e) => e.msg.type === 'competence.resultat').at(-1)!.msg as Extract<ServerPayload, { type: 'competence.resultat' }>

test('Réglages : une nouvelle compétence s’enregistre (l’identifiant du message n’est pas celui d’une compétence)', () => {
  const msg = recu({ type: 'competence.enregistrer', nom: 'Compte rendu de réunion', description: 'Quand une réunion se termine.', corps: '1. Décisions\n2. Actions' })
  assert.equal(typeof msg.id, 'string')
  s.onCompetenceEnregistrer('mac-1', msg)
  assert.deepEqual(resultat(), { type: 'competence.resultat', ok: true, message: '« Compte rendu de réunion » est apprise.', competence: 'compte-rendu-de-reunion' })
  assert.deepEqual(listCompetences(uid).map((c) => c.id), ['compte-rendu-de-reunion'])
})

test('Réglages : modifier, importer un fichier, refuser un doublon, oublier', () => {
  s.onCompetenceEnregistrer('mac-1', recu({ type: 'competence.enregistrer', competence: 'compte-rendu-de-reunion', nom: 'Compte rendu', description: 'Quand une réunion se termine.', corps: 'Décisions, actions, points ouverts.' }))
  assert.equal(resultat().ok, true)
  assert.deepEqual(listCompetences(uid).map((c) => c.id), ['compte-rendu'])
  s.onCompetenceEnregistrer('mac-1', recu({ type: 'competence.enregistrer', texte: '---\nname: Relance\ndescription: Quand un client tarde.\n---\nRetrouver le fil.', fichier: 'SKILL.md' }))
  assert.equal(resultat().competence, 'relance')
  s.onCompetenceEnregistrer('mac-1', recu({ type: 'competence.enregistrer', nom: 'Relance', description: 'Autre.', corps: 'Autre.' }))
  assert.equal(resultat().ok, false)
  assert.match(resultat().message, /existe déjà/)
  s.onCompetenceEnregistrer('mac-1', recu({ type: 'competence.enregistrer', competence: 'disparue', nom: 'X', description: 'Y.', corps: 'Z.' }))
  assert.match(resultat().message, /n’existe plus/)
  s.onCompetenceSupprimer(String(recu({ type: 'competence.supprimer', competence: 'relance' }).competence))
  assert.deepEqual(listCompetences(uid).map((c) => c.id), ['compte-rendu'])
})
