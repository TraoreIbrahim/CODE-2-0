import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-boites-'))
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { db, ensureOwner } = await import('../db.ts')
const boites = await import('./boites.ts')
const { parseRowId, recipients, rowId } = await import('./imap.ts')

const mx = (hosts: string[]) => async () => hosts.map((exchange) => ({ exchange }))

test('serveurs devinés : OVHcloud par le MX du domaine, Yahoo par le domaine, Gmail et Outlook refusés, inconnu à saisir', async () => {
  const ovh = await boites.guessServers('paul@atelier-martin.fr', mx(['mx1.mail.ovh.net.', 'mx3.mail.ovh.net.']))
  assert.deepEqual(ovh, { fournisseur: 'OVHcloud', imapHote: 'ssl0.ovh.net', imapPort: 993, smtpHote: 'ssl0.ovh.net', smtpPort: 465 })
  assert.equal((await boites.guessServers('a@yahoo.fr', mx([]))) && 'imapHote' in (await boites.guessServers('a@yahoo.fr', mx([])))!, true)
  assert.match(((await boites.guessServers('a@gmail.com', mx([]))) as { erreur: string }).erreur, /Connecter Google/)
  assert.match(((await boites.guessServers('a@hotmail.fr', mx([]))) as { erreur: string }).erreur, /Microsoft/)
  assert.match(((await boites.guessServers('a@entreprise.fr', mx(['aspmx.l.google.com']))) as { erreur: string }).erreur, /Google/)
  assert.equal(await boites.guessServers('a@inconnu.fr', mx(['mail.inconnu.fr'])), null)
})

test('adresses : seules les adresses simples passent (pas de commentaire, de groupe ni de chevron piégé)', () => {
  assert.equal(boites.cleanEmail(' Paul@Atelier-Martin.fr '), 'paul@atelier-martin.fr')
  assert.deepEqual(recipients('Bernard <pb@exemple.fr>, a@b.fr; a@b.fr'), { list: ['pb@exemple.fr', 'a@b.fr'] })
  for (const bad of ['a@b.fr (x@evil.fr)', '"a;b"@x.fr', 'x@y.fr>evil@z.fr', 'groupe: a@b.fr;', 'pas une adresse', '']) assert.ok('erreur' in recipients(bad), bad)
})

test('identifiant d’un mail IMAP : distinct d’un fil Gmail', () => {
  assert.deepEqual(parseRowId('b3:1452'), { boite: 3, uid: 1452 })
  assert.equal(parseRowId('18f2a9c0d1e2'), null)
  assert.equal(rowId({ id: 7 } as never, 12), 'b7:12')
})

test('boîtes : plusieurs par personne, mot de passe chiffré et propre à chacun, boîte par défaut', () => {
  const uid = ensureOwner()
  const s = { fournisseur: 'OVHcloud', imapHote: 'ssl0.ovh.net', imapPort: 993, smtpHote: 'ssl0.ovh.net', smtpPort: 465 }
  const pro = boites.saveBoite(uid, 'Pro', 'paul@atelier-martin.fr', 'motdepasse-pro', s)
  const dir = boites.saveBoite(uid, 'Direction', 'direction@atelier-martin.fr', 'motdepasse-dir', s)
  assert.equal(pro.defaut, true, 'la première est la boîte par défaut')
  assert.equal(dir.defaut, false)
  const stored = db.prepare('SELECT mot_de_passe FROM boites_mail WHERE id = ?').get(pro.id) as { mot_de_passe: string }
  assert.ok(!stored.mot_de_passe.includes('motdepasse'), 'jamais en clair en base')
  assert.equal(boites.passwordOf(pro), 'motdepasse-pro')
  assert.equal(boites.passwordOf(dir), 'motdepasse-dir')
  // L'écran ne reçoit jamais le mot de passe.
  assert.equal(JSON.stringify(boites.boiteInfo(pro)).includes('motdepasse'), false)
  boites.setDefaultBoite(uid, dir.id)
  assert.deepEqual(boites.listBoites(uid).map((b) => [b.libelle, b.defaut]), [['Direction', true], ['Pro', false]])
  // Un autre utilisateur ne voit ni ne retire les boîtes du propriétaire.
  assert.equal(boites.getBoite(uid + 1, pro.id), null)
  assert.equal(boites.removeBoite(uid + 1, pro.id), false)
  // Retirer la boîte par défaut : la suivante prend le relais.
  assert.equal(boites.removeBoite(uid, dir.id), true)
  assert.deepEqual(boites.listBoites(uid).map((b) => [b.libelle, b.defaut]), [['Pro', true]])
})

test('erreurs de connexion lisibles', () => {
  assert.equal(boites.connectionError({ authenticationFailed: true }, 'lecture'), 'Adresse ou mot de passe refusé par le serveur.')
  assert.equal(boites.connectionError({ code: 'EAUTH' }, 'envoi'), 'Adresse ou mot de passe refusé par le serveur.')
  assert.equal(boites.connectionError({ code: 'ETIMEDOUT' }, 'envoi'), 'Serveur d’envoi injoignable.')
  assert.equal(boites.connectionError({ code: 'ENOTFOUND' }, 'lecture'), 'Serveur de lecture introuvable.')
})

test('mails de plusieurs boîtes : une boîte très active ne fait pas disparaître les autres', async () => {
  const { mixRows } = await import('../tools/mail.ts')
  const row = (boite: string, ts: number) => ({ id: `${boite}${ts}`, boite, ts }) as never
  const gmail = Array.from({ length: 10 }, (_, i) => row('Gmail', 100 - i))
  const pro = Array.from({ length: 10 }, (_, i) => row('Pro', 50 - i))
  const mixed = mixRows([...gmail, ...pro], 8, 3) as { boite: string; ts: number }[]
  assert.equal(mixed.length, 8)
  assert.deepEqual(mixed.map((r) => r.boite), ['Gmail', 'Gmail', 'Gmail', 'Gmail', 'Gmail', 'Pro', 'Pro', 'Pro'], 'toujours du plus récent au plus ancien')
  // Une seule boîte, ou assez de place : rien n'est écarté.
  assert.equal(mixRows(gmail, 8, 3).length, 8)
  assert.equal(mixRows([...gmail.slice(0, 3), ...pro.slice(0, 3)], 8, 3).length, 6)
})
