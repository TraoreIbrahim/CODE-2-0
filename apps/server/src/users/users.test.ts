import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-users-'))
const { decrypt, encrypt, setMasterKey, tokenHash } = await import('./crypto.ts')
setMasterKey(randomBytes(32))
const users = await import('./users.ts')
const { db } = await import('../db.ts')
const { codeConfig } = await import('../../../../config/code.config.ts')

test('chiffrement : aller-retour, lié à son contexte, illisible avec une autre clé', () => {
  const box = encrypt('cle-secrete', 'cle:1')
  assert.notEqual(box, 'cle-secrete')
  assert.ok(!box.includes('cle-secrete'))
  assert.equal(decrypt(box, 'cle:1'), 'cle-secrete')
  assert.notEqual(encrypt('cle-secrete', 'cle:1'), box, 'un IV neuf à chaque fois')
  // Déplacé sur la ligne d'un autre utilisateur : refusé.
  assert.throws(() => decrypt(box, 'cle:2'))
  const [v, iv, , data] = box.split('.')
  assert.throws(() => decrypt([v, iv, Buffer.alloc(16).toString('base64url'), data].join('.'), 'cle:1'), 'chiffré modifié : refusé')
  setMasterKey(randomBytes(32))
  assert.throws(() => decrypt(box, 'cle:1'), 'une base copiée sans sa clé maîtresse ne révèle rien')
})

test('propriétaire : le premier utilisateur, créé une seule fois', () => {
  const owner = users.ensureOwner()
  assert.equal(users.ensureOwner(), owner)
  assert.equal(users.ownerId(), owner)
  assert.equal(users.getUser(owner)?.proprietaire, true)
  assert.equal(users.createUser('Léa', 'Martin').proprietaire, false)
})

test('jeton : seule son empreinte est gardée', () => {
  const owner = users.ensureOwner()
  const { token } = users.issueDevice(owner, 'mac', 'Ordinateur de test')
  const row = db.prepare('SELECT jeton_hash FROM appareils WHERE jeton_hash = ?').get(tokenHash(token)) as { jeton_hash: string }
  assert.equal(row.jeton_hash, tokenHash(token))
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM appareils WHERE jeton_hash = ?').get(token) as { n: number }).n, 0)
})

test('appareils : authentification, révocation, et jamais l’appareil d’un autre', () => {
  const owner = users.ensureOwner()
  const other = users.createUser('Léa', 'Bernard')
  const mine = users.issueDevice(owner, 'mobile', 'Téléphone')
  const hers = users.issueDevice(other.id, 'mobile', 'Téléphone')
  assert.equal(users.authenticate(mine.token)?.utilisateur.id, owner)
  assert.equal(users.authenticate(hers.token)?.utilisateur.id, other.id)
  assert.equal(users.authenticate('inconnu'), null)
  assert.equal(users.authenticate(''), null)
  assert.equal(users.revokeDevice(owner, hers.appareil.id), false, 'on ne révoque que ses propres appareils')
  assert.ok(users.authenticate(hers.token))
  assert.equal(users.revokeDevice(other.id, hers.appareil.id), true)
  assert.equal(users.authenticate(hers.token), null, 'révoqué : refusé')
  assert.ok(!users.listDevices(other.id).some((d) => d.id === hers.appareil.id))
  assert.ok(users.listDevices(owner).some((d) => d.id === mine.appareil.id))
})

test('jeton déjà tiré : enregistré tel quel', () => {
  const owner = users.ensureOwner()
  const token = randomBytes(24).toString('base64url')
  assert.equal(users.knownToken(token), false)
  users.registerDevice(owner, token, 'mac', 'Ordinateur')
  assert.equal(users.knownToken(token), true)
  assert.equal(users.authenticate(token)?.utilisateur.id, owner)
})

test('code d’association : une seule fois, dix minutes, pour l’utilisateur qui l’a demandé', () => {
  const owner = users.ensureOwner()
  const now = Date.parse('2026-10-30T10:00:00Z')
  const code = users.issuePairCode(owner, now)
  assert.match(code, /^[A-Z2-9]{10}$/)
  assert.equal(users.claimPairCode(code.toLowerCase(), now + 1000), owner)
  assert.equal(users.claimPairCode(code, now + 2000), null, 'usage unique')
  const late = users.issuePairCode(owner, now)
  assert.equal(users.claimPairCode(late, now + 10 * 60_000 + 1), null, 'expiré')
  assert.equal(users.claimPairCode('ABCDEFGHJK', now), null)
})

test('réglages : défauts de la configuration, seule la différence est gardée ; appellation', () => {
  const u = users.createUser('Aya', 'Durand')
  assert.equal(u.reglages.tutoiement, false)
  assert.equal(users.appellationOf(u), 'Durand')
  // Quand l'assistant prend la parole de lui-même (rappels) : le prénom, tant qu'aucune appellation n'est choisie.
  assert.equal(users.spokenNameOf(u), 'Aya')
  assert.equal(users.spokenNameOf({ reglages: { ...u.reglages, appellation: 'Cheffe' }, nom: 'Durand', prenom: 'Aya' }), 'Cheffe')
  const v = users.updateReglages(u.id, { tutoiement: true, appellation: 'Aya' })!
  assert.equal(v.reglages.tutoiement, true)
  assert.equal(users.appellationOf(v), 'Aya')
  assert.equal(v.reglages.fuseau, codeConfig.reglages.fuseau)
  const stored = JSON.parse((db.prepare('SELECT reglages FROM utilisateurs WHERE id = ?').get(u.id) as { reglages: string }).reglages)
  assert.deepEqual(stored, { appellation: 'Aya', tutoiement: true })
  assert.equal(users.userInfo(v).appellation, 'Aya')
})

test('assistant de premier lancement : la première date reste', () => {
  const u = users.createUser('Hugo', 'Petit')
  assert.equal(u.configure, false)
  assert.equal(users.finishAssistant(u.id, 1000)?.configure, true)
  users.finishAssistant(u.id, 2000)
  assert.equal((db.prepare('SELECT assistant_le FROM utilisateurs WHERE id = ?').get(u.id) as { assistant_le: number }).assistant_le, 1000)
})
