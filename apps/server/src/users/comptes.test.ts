import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-comptes-'))
const { hashPassword, setMasterKey, verifyPassword } = await import('./crypto.ts')
setMasterKey(randomBytes(32))
const users = await import('./users.ts')
const comptes = await import('./comptes.ts')
const cles = await import('./cles.ts')
const { db } = await import('../db.ts')

const owner = users.ensureOwner()

// Fausses clés assemblées à l'exécution : la vérification avant publication ne doit rien trouver ici.
const FAUSSE_ANTHROPIC = 'sk-' + 'ant-' + 'test-' + 'a'.repeat(30)
const FAUSSE_OPENAI = 'sk-' + 'test-' + 'b'.repeat(30)

test('mot de passe : empreinte scrypt salée, jamais le mot de passe', async () => {
  const h = await hashPassword('cheval-agrafe-1')
  assert.match(h, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/)
  assert.ok(!h.includes('cheval'))
  assert.notEqual(await hashPassword('cheval-agrafe-1'), h, 'un sel neuf à chaque fois')
  assert.equal(await verifyPassword('cheval-agrafe-1', h), true)
  assert.equal(await verifyPassword('cheval-agrafe-2', h), false)
  assert.equal(await verifyPassword('cheval-agrafe-1', 'illisible'), false)
})

test('identifiants : propriétaire, connexion sans casse, mot de passe actuel exigé pour changer', async () => {
  assert.deepEqual(await comptes.setIdentifiants(owner, 'Lea.Martin', 'court'), { ok: false, champ: 'motDePasse', message: '8 caractères au moins.' })
  assert.equal((await comptes.setIdentifiants(owner, 'avec espace', 'assez-long-1')).ok, false)
  assert.equal((await comptes.setIdentifiants(owner, 'lea.martin', 'lea.martin')).ok, false, 'pas l’identifiant comme mot de passe')
  assert.deepEqual(await comptes.setIdentifiants(owner, '  Lea.Martin ', 'assez-long-1'), { ok: true })
  assert.equal(users.getUser(owner)?.identifiant, 'lea.martin')
  assert.equal(users.userInfo(users.getUser(owner)!).identifiant, 'lea.martin')
  const stored = (db.prepare('SELECT mot_de_passe FROM utilisateurs WHERE id = ?').get(owner) as { mot_de_passe: string }).mot_de_passe
  assert.ok(!stored.includes('assez-long-1'))

  const ok = await comptes.login('LEA.MARTIN', 'assez-long-1')
  assert.ok(typeof ok === 'object' && ok.id === owner)
  assert.equal(await comptes.login('lea.martin', 'mauvais-mot'), 'identifiants')
  assert.equal(await comptes.login('personne', 'assez-long-1'), 'identifiants', 'même réponse : on ne sait pas si l’identifiant existe')

  assert.equal((await comptes.setIdentifiants(owner, 'lea', 'nouveau-mot-2')).ok, false, 'sans l’ancien mot de passe : refusé')
  assert.equal((await comptes.setIdentifiants(owner, 'lea', 'nouveau-mot-2', 'faux-ancien')).ok, false)
  assert.deepEqual(await comptes.setIdentifiants(owner, 'lea', 'nouveau-mot-2', 'assez-long-1'), { ok: true })
  assert.equal(await comptes.login('lea.martin', 'assez-long-1'), 'identifiants')
  assert.ok(typeof (await comptes.login('lea', 'nouveau-mot-2')) === 'object')
})

test('prénom et nom : le prénom est attendu, le nom facultatif', () => {
  assert.deepEqual(comptes.setNom(owner, '  Sam ', ''), { ok: true })
  assert.equal(users.getUser(owner)?.prenom, 'Sam')
  assert.equal(comptes.setNom(owner, '', 'Martin').ok, false)
  assert.equal(comptes.setNom(owner, 'Sam', '<b>').ok, false)
  assert.deepEqual(comptes.setNom(owner, 'Sam', 'D’Artois-Lemaire'), { ok: true })
  assert.equal(users.getUser(owner)?.nom, 'D’Artois-Lemaire')
})

test('invitation : code à usage unique, sept jours, une faute de saisie ne le consomme pas', async () => {
  const now = Date.parse('2026-11-03T10:00:00Z')
  assert.equal(comptes.issueInvitation('', now).ok, false, 'un prénom est attendu')
  const inv = comptes.issueInvitation('  Paul ', now)
  assert.ok(inv.ok)
  assert.match(inv.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.deepEqual(comptes.listInvitations(now).map((i) => i.prenom), ['Paul'])
  const stored = db.prepare('SELECT code_hash FROM invitations').all() as { code_hash: string }[]
  assert.ok(stored.every((r) => !r.code_hash.includes(inv.code.replace(/-/g, ''))), 'seule l’empreinte du code est gardée')

  const champs = { prenom: 'Paul', identifiant: 'paul', motDePasse: 'mot-de-passe-paul' }
  assert.equal((await comptes.claimInvitation('ZZZZ-ZZZZ-ZZZZ', champs, now)).ok, false)
  // L'identifiant est déjà pris : refusé, le code reste valable.
  const pris = await comptes.claimInvitation(inv.code, { ...champs, identifiant: 'lea' }, now)
  assert.equal(pris.ok, false)
  assert.equal(!pris.ok && pris.champ, 'identifiant')
  // Saisi en minuscules et sans tirets : accepté.
  const res = await comptes.claimInvitation(inv.code.toLowerCase().replace(/-/g, ''), champs, now + 1000)
  assert.ok(res.ok)
  assert.equal(res.utilisateur.prenom, 'Paul')
  assert.equal(res.utilisateur.proprietaire, false)
  assert.equal(res.utilisateur.configure, false, 'le premier lancement l’attend')
  assert.equal((await comptes.claimInvitation(inv.code, { ...champs, identifiant: 'paul2' }, now + 2000)).ok, false, 'usage unique')
  assert.deepEqual(comptes.listInvitations(now), [])
  assert.ok(typeof (await comptes.login('paul', 'mot-de-passe-paul')) === 'object')

  const vieille = comptes.issueInvitation('Claire', now)
  assert.ok(vieille.ok)
  assert.equal((await comptes.claimInvitation(vieille.code, { prenom: 'Claire', identifiant: 'claire', motDePasse: 'mot-de-passe-claire' }, now + comptes.INVITATION_TTL_MS + 1)).ok, false, 'expirée')
  const annulee = comptes.issueInvitation('Hugo', now)
  assert.ok(annulee.ok)
  const id = comptes.listInvitations(now).find((i) => i.prenom === 'Hugo')!.id
  assert.equal(comptes.cancelInvitation(id), true)
  assert.equal((await comptes.claimInvitation(annulee.code, { prenom: 'Hugo', identifiant: 'hugo', motDePasse: 'mot-de-passe-hugo' }, now)).ok, false, 'annulée')
})

test('désactivation : plus de connexion ni d’appareil, jamais le propriétaire', async () => {
  const u = users.createUser('Nina', 'Petit')
  assert.deepEqual(await comptes.setIdentifiants(u.id, 'nina', 'mot-de-passe-nina'), { ok: true })
  const { token } = users.issueDevice(u.id, 'mobile', 'Téléphone')
  assert.ok(users.authenticate(token))
  assert.equal(comptes.setActif(owner, false), false)
  assert.equal(comptes.setActif(u.id, false), true)
  assert.equal(users.authenticate(token), null, 'ses appareils sont déconnectés')
  assert.equal(await comptes.login('nina', 'mot-de-passe-nina'), 'inactif')
  assert.equal(await comptes.login('nina', 'mauvais-mot-de-passe'), 'identifiants', 'sans le bon mot de passe, rien n’est dit du compte')
  assert.equal(comptes.listComptes().find((c) => c.id === u.id)?.actif, false)
  comptes.setActif(u.id, true)
  assert.ok(typeof (await comptes.login('nina', 'mot-de-passe-nina')) === 'object')
  const vue = comptes.listComptes()
  assert.equal(vue.find((c) => c.proprietaire)?.id, owner)
  assert.ok(vue.every((c) => !('mot_de_passe' in c) && !('motDePasse' in c)))
})

test('coffre : chiffré, propre à chacun ; les clés du serveur pour le propriétaire seulement', () => {
  const membre = users.createUser('Jade', 'Roux')
  const serveur = { ANTHROPIC_API_KEY: FAUSSE_ANTHROPIC, OPENAI_API_KEY: FAUSSE_OPENAI }
  assert.deepEqual(cles.keysFor(membre.id, serveur), {}, 'un membre n’utilise jamais les clés du serveur')
  assert.deepEqual(cles.keysFor(owner, serveur), serveur)

  assert.ok('erreur' in cles.checkCle('ANTHROPIC_API_KEY', FAUSSE_OPENAI), 'une clé OpenAI collée au mauvais endroit')
  assert.ok('erreur' in cles.checkCle('GROQ_API_KEY', 'trop courte'))
  assert.ok('erreur' in cles.checkCle('GROQ_API_KEY', 'avec des espaces dedans 123456'))
  const check = cles.checkCle('ANTHROPIC_API_KEY', `  ${FAUSSE_ANTHROPIC}\n`)
  assert.deepEqual(check, { ok: FAUSSE_ANTHROPIC })

  cles.setCle(membre.id, 'ANTHROPIC_API_KEY', FAUSSE_ANTHROPIC, 1000)
  const row = db.prepare('SELECT valeur FROM cles WHERE utilisateur_id = ?').get(membre.id) as { valeur: string }
  assert.ok(!row.valeur.includes(FAUSSE_ANTHROPIC), 'chiffrée en base')
  assert.deepEqual(cles.keysFor(membre.id, serveur), { ANTHROPIC_API_KEY: FAUSSE_ANTHROPIC })
  const vue = cles.listCles(membre.id, serveur)
  assert.deepEqual(vue.find((c) => c.nom === 'ANTHROPIC_API_KEY'), { nom: 'ANTHROPIC_API_KEY', source: 'coffre', fin: FAUSSE_ANTHROPIC.slice(-4), modifie: 1000 })
  assert.deepEqual(vue.find((c) => c.nom === 'OPENAI_API_KEY'), { nom: 'OPENAI_API_KEY', source: null })
  assert.ok(!JSON.stringify(vue).includes(FAUSSE_ANTHROPIC.slice(0, 12)), 'jamais la clé entière')
  assert.equal(cles.listCles(owner, serveur).find((c) => c.nom === 'OPENAI_API_KEY')?.source, 'serveur')

  // Copiée sur la ligne d'un autre : illisible, donc ignorée.
  db.prepare('INSERT INTO cles (utilisateur_id, nom, valeur, modifie) VALUES (?, ?, ?, ?)').run(owner, 'GROQ_API_KEY', row.valeur, 1)
  assert.equal(cles.keysFor(owner, {}).GROQ_API_KEY, undefined)

  assert.equal(cles.deleteCle(membre.id, 'ANTHROPIC_API_KEY'), true)
  assert.deepEqual(cles.keysFor(membre.id, serveur), {})
})
