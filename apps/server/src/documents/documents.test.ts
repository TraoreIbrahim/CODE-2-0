import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base et fichiers de test isolés, dans un dossier jetable.
const scratch = mkdtempSync(join(tmpdir(), 'code-documents-'))
process.env.CODE_DATA_DIR = scratch
process.env.CODE_MEMORY_DIR = join(scratch, 'memory')
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { db, ensureOwner } = await import('../db.ts')
const { issueDevice } = await import('../users/users.ts')
const { runAsUser } = await import('../users/scope.ts')
const { enregistrerDocument, getDocument, listerDocuments, nomPropre } = await import('./store.ts')
const { getEcheance } = await import('../echeances/store.ts')
const { documentFile, documentRead, documentsFind } = await import('../tools/documents.ts')
const { createHttpServer } = await import('../http.ts')
import type { ToolContext } from '../tools/types.ts'
import type { UiPapier, UiPapiers } from '@code/protocol'

const U = ensureOwner()
const other = Number(db.prepare('INSERT INTO utilisateurs (nom, cree) VALUES (?, ?)').run('Durand', Date.now()).lastInsertRowid)
const ctx = (uid: number) => ({ user: { id: uid, reglages: { fuseau: 'Europe/Paris' } } }) as unknown as ToolContext
/** Un vrai PNG d'un pixel : ce que les modèles savent lire. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test('nom affichable : ni chemin ni caractère de contrôle', () => {
  assert.equal(nomPropre('../../etc/facture.jpg', 'image/jpeg'), 'facture.jpg')
  assert.equal(nomPropre('C:\\Users\\a\\scan\u0007.pdf', 'application/pdf'), 'scan.pdf')
  assert.equal(nomPropre('  ', 'application/pdf'), 'document.pdf')
})

test('un papier appartient à son utilisateur seul ; fichier privé sur le disque', () => {
  const d = enregistrerDocument(U, { nom: 'facture.png', type: 'image/png', data: PNG }, Date.now())
  assert.equal(d.etat, 'recu')
  assert.ok(d.chemin.startsWith(join(scratch, 'documents', String(U))))
  assert.deepEqual(readFileSync(d.chemin), PNG)
  assert.equal(statSync(d.chemin).mode & 0o777, 0o600)
  assert.equal(getDocument(other, d.id), null)
  assert.equal(listerDocuments(other).length, 0)
  assert.throws(() => enregistrerDocument(U, { nom: 'x.exe', type: 'application/x-msdownload', data: PNG }, Date.now()))
})

test('lire : l’image telle quelle, avec son numéro ; jamais le papier d’un autre', async () => {
  const d = enregistrerDocument(U, { nom: 'avis.png', type: 'image/png', data: PNG }, Date.now())
  const r = await runAsUser(U, () => documentRead.run({ id: d.id }, ctx(U)))
  assert.ok(Array.isArray(r.content))
  assert.equal((r.content as { type: string }[])[0]!.type, 'image')
  assert.match(JSON.stringify(r.content), new RegExp(`\\[document ${d.id}\\].*Pas encore rangé`))
  const view = r.view as UiPapier
  assert.equal(view.kind, 'papier')
  assert.match(view.apercu!, /^\/apercu\/[0-9a-f]{32}$/)
  assert.equal(view.recu.startsWith('aujourd’hui à '), true)
  const ko = await runAsUser(other, () => documentRead.run({ id: d.id }, ctx(other)))
  assert.equal(ko.isError, true)
})

test('ranger sans Google : gardé sur le serveur ; l’échéance notée et liée, une seule fois', async () => {
  const d = enregistrerDocument(U, { nom: 'IMG_2231.jpg', type: 'image/png', data: PNG }, Date.now())
  const input = {
    id: d.id,
    titre: 'Facture d’électricité — novembre',
    categorie: 'facture',
    emetteur: 'EDF',
    resume: 'Facture du mois de novembre, prélevée le 14.',
    champs: [{ label: 'Montant', valeur: '84,90 €' }, { label: 'Référence', valeur: 'FA-2026-11' }],
    echeance: { titre: 'Électricité', date: '2099-11-14', montant: 84.9, devise: 'EUR' }
  }
  assert.equal(documentFile.validate(input, ctx(U)), null)
  const r = await runAsUser(U, () => documentFile.run(input, ctx(U)))
  assert.match(String(r.content), /rangé.*gardé sur le serveur.*Échéance \d+ notée/)
  const apres = getDocument(U, d.id)!
  assert.equal(apres.etat, 'range')
  assert.equal(apres.emetteur, 'EDF')
  const e = getEcheance(U, apres.echeanceId!)!
  assert.equal(e.categorie, 'facture')
  assert.equal(e.note, `Document ${d.id} : Facture d’électricité — novembre`)
  const view = r.view as UiPapier
  assert.deepEqual(view.rangement, { ou: 'serveur', chemin: 'Papiers › Factures' })
  assert.equal(view.echeance?.id, e.id)
  // Rangé de nouveau : pas de seconde échéance.
  const encore = await runAsUser(U, () => documentFile.run(input, ctx(U)))
  assert.match(String(encore.content), /déjà notée/)
  assert.equal(getDocument(U, d.id)!.echeanceId, e.id)
})

test('ranger : classement, champs et échéance vérifiés', () => {
  assert.match(documentFile.validate({ id: 1, titre: 'X', categorie: 'bijoux' }, ctx(U))!, /categorie/)
  assert.match(documentFile.validate({ id: 1, titre: 'X', categorie: 'facture', champs: [{ label: 'Montant' }] }, ctx(U))!, /champs/)
  assert.match(documentFile.validate({ id: 1, titre: 'X', categorie: 'facture', echeance: { titre: 'X', date: '2026-02-30' } }, ctx(U))!, /date/)
})

test('retrouver : sans accents ni casse, dans le titre, l’émetteur et les champs', async () => {
  const r = await runAsUser(U, () => documentsFind.run({ requete: 'electricite edf' }, ctx(U)))
  const view = r.view as UiPapiers
  assert.equal(view.papiers.length, 1)
  assert.equal(view.papiers[0]!.titre, 'Facture d’électricité — novembre')
  assert.match(String(r.content), /\[document \d+\]/)
  const ref = await runAsUser(U, () => documentsFind.run({ requete: 'fa-2026' }, ctx(U)))
  assert.equal((ref.view as UiPapiers).papiers.length, 1)
  const aucun = await runAsUser(other, () => documentsFind.run({}, ctx(other)))
  assert.equal((aucun.view as UiPapiers).papiers.length, 0)
})

test('envoi HTTP : jeton d’appareil, type et taille vérifiés', async () => {
  const server = createHttpServer().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/documents`
  const { token } = issueDevice(other, 'mobile', 'Téléphone')
  const post = (headers: Record<string, string>, body: Buffer) => fetch(base, { method: 'POST', headers, body })
  try {
    const pre = await fetch(base, { method: 'OPTIONS' })
    assert.equal(pre.status, 204)
    assert.match(pre.headers.get('access-control-allow-headers')!, /Authorization/)
    assert.equal((await post({ 'Content-Type': 'image/png' }, PNG)).status, 401)
    assert.equal((await post({ Authorization: 'Bearer faux', 'Content-Type': 'image/png' }, PNG)).status, 401)
    const auth = { Authorization: `Bearer ${token}` }
    assert.equal((await post({ ...auth, 'Content-Type': 'text/html' }, PNG)).status, 415)
    const ok = await post({ ...auth, 'Content-Type': 'image/png', 'X-Nom': encodeURIComponent('Reçu de loyer.png') }, PNG)
    assert.equal(ok.status, 201)
    const { id, nom } = (await ok.json()) as { id: number; nom: string }
    assert.equal(nom, 'Reçu de loyer.png')
    // Il appartient au compte du jeton.
    assert.ok(getDocument(other, id))
    assert.equal(getDocument(U, id), null)
    const trop = await post({ ...auth, 'Content-Type': 'application/pdf' }, Buffer.alloc(15 * 1024 * 1024 + 1))
    assert.equal(trop.status, 413)
    assert.ok(existsSync(getDocument(other, id)!.chemin))
  } finally {
    server.close()
  }
})
