import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { ServerPayload } from '@code/protocol'
import { FILE_TOOLS } from '../tools/index.ts'
import type { ToolContext } from '../tools/types.ts'
import { executerAction, executerOutil } from './execution-mac.ts'
import { erreurDuMac, pontVers, servePont } from './pont.ts'

/**
 * Le pont de bout en bout, sans Electron : un vrai serveur HTTP pour les dépôts, et le code que l'app du
 * Mac exécute (execution-mac) branché sur la « connexion WebSocket » du test.
 */

const dossier = realpathSync(mkdtempSync(join(tmpdir(), 'code-pont-test-')))
let server: Server
let origine = ''

before(async () => {
  process.env.CODE_ALLOWED_FOLDERS = dossier
  // Une image PNG d'un pixel.
  writeFileSync(join(dossier, 'photo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'))
  writeFileSync(join(dossier, 'notes.txt'), 'Réunion lundi 9 h.')
  server = createServer((req, res) => {
    if (!servePont(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  origine = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.close()
  rmSync(dossier, { recursive: true, force: true })
  delete process.env.CODE_ALLOWED_FOLDERS
})

/** Ce que fait l'app du Mac à la réception d'un message du pont (main/pont.ts, sans Electron). */
async function mac(p: ServerPayload): Promise<void> {
  if (p.type !== 'pont.outil' && p.type !== 'pont.executer') return
  const deposer = async (chemin: string) => {
    const { readFileSync } = await import('node:fs')
    const res = await fetch(`${origine}/pont/${p.envoi}/apercu?nom=${encodeURIComponent(chemin.split('/').pop()!)}`, { method: 'POST', body: readFileSync(chemin) })
    return res.ok ? ((await res.json()) as { url: string }).url : null
  }
  const r = p.type === 'pont.outil' ? await executerOutil(p.outil, p.input, deposer) : await executerAction(p.cle)
  await fetch(`${origine}/pont/${p.envoi}`, { method: 'POST', body: JSON.stringify(r) })
}

function contexte() {
  const journal: string[] = []
  const annonces: string[] = []
  const confirmations: { titre: string; resume: string; execute: () => Promise<void> }[] = []
  const ctx = {
    fichiers: true,
    pont: pontVers('mac-1', (p) => {
      void mac(p)
      return true
    }),
    requestConfirmation: (titre: string, resume: string, execute: () => Promise<void>) => confirmations.push({ titre, resume, execute }),
    log: (l: string) => journal.push(l),
    announce: (t: string) => annonces.push(t)
  } as unknown as ToolContext
  return { ctx, journal, annonces, confirmations }
}

const outil = (nom: string) => FILE_TOOLS.find((t) => t.name === nom)!

test('lecture : le Mac lit le fichier, le serveur reçoit le résultat par HTTP', async () => {
  const { ctx } = contexte()
  const r = await outil('fichiers_lire').run({ chemin: join(dossier, 'notes.txt') }, ctx)
  assert.ok(!r.isError, String(r.content))
  assert.match(JSON.stringify(r.content), /Réunion lundi 9 h/)
})

test('affichage : l’image est déposée au serveur et reçoit une adresse d’aperçu du serveur', async () => {
  const { ctx } = contexte()
  const r = await outil('fichiers_afficher').run({ chemin: join(dossier, 'photo.png') }, ctx)
  assert.ok(!r.isError, String(r.content))
  const vue = JSON.stringify(r.view)
  assert.match(vue, /\/apercu\/[0-9a-f]{32}/)
  assert.ok(!vue.includes('pont-apercu-'), 'le jeton provisoire du Mac est remplacé')
})

test('modification : préparée sur le Mac, faite seulement après le « oui » du serveur', async () => {
  const { ctx, journal, annonces, confirmations } = contexte()
  const r = await outil('fichiers_creer_dossier').run({ dans: dossier, nom: 'Factures 2026' }, ctx)
  assert.ok(!r.isError, String(r.content))
  assert.equal(confirmations.length, 1)
  assert.equal(confirmations[0]!.titre, 'Créer un dossier')
  assert.ok(!existsSync(join(dossier, 'Factures 2026')), 'rien n’est fait avant le « oui »')
  await confirmations[0]!.execute()
  assert.ok(existsSync(join(dossier, 'Factures 2026')))
  assert.ok(journal.some((l) => l.startsWith('Dossier créé')))
  assert.ok(annonces.length > 0)
  // Une clé ne sert qu'une fois.
  assert.deepEqual(await executerAction('cle-inconnue'), { erreur: 'cette action a expiré sur le Mac, redemandez-la' })
})

test('hors des dossiers autorisés : refusé sur le Mac comme en local', async () => {
  const { ctx } = contexte()
  const r = await outil('fichiers_lire').run({ chemin: '/etc/passwd' }, ctx)
  assert.equal(r.isError, true)
})

test('Mac déconnecté ou en erreur : un message clair, rien qui reste en attente', async () => {
  const absent = { pont: pontVers('mac-2', () => false) } as unknown as ToolContext
  const r = await outil('fichiers_lister').run({ dossier: dossier }, absent)
  assert.equal(r.isError, true)
  assert.match(String(r.content), /injoignables.*plus connecté/)

  let id = ''
  const enPanne = {
    pont: pontVers('mac-3', (p) => {
      id = (p as { id: string }).id
      setImmediate(() => erreurDuMac('mac-3', id, 'pas de pont dans cette version'))
      return true
    })
  } as unknown as ToolContext
  const r2 = await outil('fichiers_lister').run({ dossier: dossier }, enPanne)
  assert.equal(r2.isError, true)
  assert.match(String(r2.content), /pas de pont dans cette version/)
})

test('un jeton d’envoi inconnu ou périmé est refusé', async () => {
  assert.equal((await fetch(`${origine}/pont/${'0'.repeat(32)}`, { method: 'POST', body: '{}' })).status, 404)
  assert.equal((await fetch(`${origine}/pont/pas-un-jeton`, { method: 'POST', body: '{}' })).status, 404)
})
