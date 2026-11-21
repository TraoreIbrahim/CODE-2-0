import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Un dossier jetable, posé avant de charger les chemins : ce test ne touche jamais aux vraies données.
const scratch = mkdtempSync(join(tmpdir(), 'code-import-'))
process.env.CODE_DATA_DIR = scratch
process.env.CODE_MEMORY_DIR = join(scratch, 'memory')
const { applyPendingImport, serveImport } = await import('./import.ts')
const { dataDir, memoryDir } = await import('./paths.ts')

const TOKEN = 'x'.repeat(40)

test('import des données du Mac : jeton exigé, fichiers en place au redémarrage', async () => {
  assert.equal(dataDir, scratch)
  process.env.CODE_IMPORT_TOKEN = TOKEN
  let restarted = false
  const server = createServer((req, res) => {
    if (!serveImport(req, res, new URL(req.url ?? '/', 'http://x').pathname, () => (restarted = true))) res.writeHead(418).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const put = (name: string, body: string, token = TOKEN) => fetch(`${base}/import/${name}`, { method: 'PUT', body, headers: { Authorization: `Bearer ${token}` } })
  try {
    assert.equal((await put('code.db', 'base', 'y'.repeat(40))).status, 404)
    assert.equal((await put('secrets.json', 'non')).status, 400)
    assert.equal((await put('memory/sous/x.md', 'non')).status, 400)
    assert.equal((await put('code.db', 'base du Mac')).status, 200)
    assert.equal((await put('voix.eagle', 'ancien moteur')).status, 400)
    assert.equal((await put('memory/notes.md', '# notes')).status, 200)
    assert.equal((await fetch(`${base}/import/terminer`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } })).status, 200)
    await new Promise((r) => setTimeout(r, 600))
    assert.ok(restarted)
  } finally {
    server.close()
    delete process.env.CODE_IMPORT_TOKEN
  }
  writeFileSync(join(scratch, 'code.db-wal'), 'ancien journal')
  applyPendingImport()
  assert.equal(readFileSync(join(scratch, 'code.db'), 'utf8'), 'base du Mac')
  assert.ok(!existsSync(join(scratch, 'code.db-wal')))
  assert.equal(readFileSync(join(memoryDir, 'notes.md'), 'utf8'), '# notes')
  assert.ok(!existsSync(join(scratch, 'import')))
})

test('sans jeton configuré, les routes d’import n’existent pas', async () => {
  const server = createServer((req, res) => void serveImport(req, res, '/import/terminer', () => assert.fail('redémarrage')))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/import/terminer`, { method: 'POST', headers: { Authorization: 'Bearer ' } })
    assert.equal(r.status, 404)
  } finally {
    server.close()
  }
})
