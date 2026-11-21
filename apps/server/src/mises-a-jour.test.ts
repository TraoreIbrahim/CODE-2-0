import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const scratch = mkdtempSync(join(tmpdir(), 'code-maj-'))
process.env.CODE_DATA_DIR = scratch
process.env.CODE_MEMORY_DIR = join(scratch, 'memory')
const { serveMisesAJour } = await import('./mises-a-jour.ts')

test('mises à jour de l’app Mac : publiées par le propriétaire seul, servies à tous, l’ancienne version effacée', async () => {
  const dossier = join(scratch, 'maj')
  const server = createServer((req, res) => {
    const ok = serveMisesAJour(req, res, new URL(req.url ?? '/', 'http://x').pathname, { dossier, estProprietaire: (r) => r.headers.authorization === 'Bearer bon' })
    if (!ok) res.writeHead(418).end()
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const put = (nom: string, body: string | Buffer, jeton = 'bon') => fetch(`${base}/mises-a-jour/mac/${nom}`, { method: 'PUT', body, headers: { Authorization: `Bearer ${jeton}` } })
  const publier = async (version: string) => {
    const zip = Buffer.from(`zip ${version}`)
    assert.equal((await put(`CODE-${version}-arm64-mac.zip`, zip)).status, 204)
    assert.equal((await put(`CODE-${version}-arm64.dmg`, `dmg ${version}`)).status, 204)
    const manifeste = { version, publiee: '2026-11-03', zip: { fichier: `CODE-${version}-arm64-mac.zip`, sha512: createHash('sha512').update(zip).digest('hex'), taille: zip.length }, dmg: { fichier: `CODE-${version}-arm64.dmg`, taille: 9 } }
    assert.equal((await put('derniere.json', JSON.stringify(manifeste))).status, 204)
  }
  try {
    assert.equal((await fetch(`${base}/telecharger/mac`)).status, 404)
    assert.equal((await put('CODE-0.2.1-arm64-mac.zip', 'x', 'mauvais')).status, 401)
    assert.equal((await put('../code.db.zip', 'x')).status, 418, 'un chemin hors du dossier n’est pas une route')
    assert.equal((await put('code.db', 'x')).status, 404)
    // Un manifeste qui désigne un fichier absent est refusé.
    assert.equal((await put('derniere.json', JSON.stringify({ version: '9.9.9', zip: { fichier: 'absent.zip', sha512: 'a'.repeat(128), taille: 1 } }))).status, 422)

    await publier('0.2.1')
    const m = (await (await fetch(`${base}/mises-a-jour/mac/derniere.json`)).json()) as { version: string; zip: { fichier: string } }
    assert.equal(m.version, '0.2.1')
    assert.equal(await (await fetch(`${base}/mises-a-jour/mac/${m.zip.fichier}`)).text(), 'zip 0.2.1')
    const dmg = await fetch(`${base}/telecharger/mac`)
    assert.match(dmg.headers.get('content-disposition') ?? '', /CODE-0\.2\.1-arm64\.dmg/)
    assert.equal(await dmg.text(), 'dmg 0.2.1')

    await publier('0.2.2')
    assert.deepEqual(readdirSync(dossier).sort(), ['CODE-0.2.2-arm64-mac.zip', 'CODE-0.2.2-arm64.dmg', 'derniere.json'])
    assert.ok(!existsSync(join(dossier, 'CODE-0.2.1-arm64-mac.zip')))
  } finally {
    server.close()
  }
})

test('envoi par morceaux : chaque morceau à la suite, reprise après une coupure', async () => {
  const dossier = join(scratch, 'morceaux')
  const server = createServer((req, res) => {
    serveMisesAJour(req, res, new URL(req.url ?? '/', 'http://x').pathname, { dossier, estProprietaire: () => true })
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mises-a-jour/mac/CODE-1.0.0-arm64.dmg`
  const put = (range: string, body?: string) => fetch(url, { method: 'PUT', headers: { 'Content-Range': range }, ...(body ? { body } : {}) })
  try {
    assert.deepEqual(await (await put('bytes */10')).json(), { recu: 0 })
    assert.equal((await put('bytes 0-3/10', 'abcd')).status, 202)
    // Un morceau hors de place est refusé avec ce qui est déjà reçu, pour reprendre.
    const hors = await put('bytes 8-9/10', 'ij')
    assert.equal(hors.status, 409)
    assert.deepEqual(await hors.json(), { recu: 4 })
    assert.deepEqual(await (await put('bytes */10')).json(), { recu: 4 })
    assert.equal((await put('bytes 4-7/10', 'efgh')).status, 202)
    assert.equal((await put('bytes 8-9/10', 'ij')).status, 204)
    assert.equal(await (await fetch(url)).text(), 'abcdefghij')
    assert.equal((await put('bytes 0-3/2', 'abcd')).status, 416)
  } finally {
    server.close()
  }
})
