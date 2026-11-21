import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Un dossier jetable, posé avant de charger les chemins : ce test ne touche jamais aux vraies données.
const scratch = mkdtempSync(join(tmpdir(), 'code-http-'))
process.env.CODE_DATA_DIR = scratch
process.env.CODE_MEMORY_DIR = join(scratch, 'memory')
const { createHttpServer } = await import('./http.ts')

test('point de santé, et aucun fichier hors de la PWA', async () => {
  const server = createHttpServer().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { ok: true })
    const escape = await fetch(`${base}/..%2F..%2Fpackage.json`)
    assert.ok([403, 404, 503].includes(escape.status), String(escape.status))
    await escape.text()
  } finally {
    server.close()
  }
})
