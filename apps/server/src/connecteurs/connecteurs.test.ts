import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ToolContext } from '../tools/types.ts'
import { catalogueInfo, headersFor, serviceOf } from './catalogue.ts'
import { isReadOnly, toolName } from './mcp.ts'
import { figmaKey, nativeTools } from './natifs.ts'

const remote = (name: string, annotations?: { readOnlyHint?: boolean }) => ({ name, inputSchema: { type: 'object' }, ...(annotations ? { annotations } : {}) })

test('lecture ou action : les annotations du serveur d’abord, le nom sinon', () => {
  assert.equal(isReadOnly(remote('list_pull_requests')), true)
  assert.equal(isReadOnly(remote('get-issue')), true)
  assert.equal(isReadOnly(remote('search')), true)
  assert.equal(isReadOnly(remote('create_issue')), false)
  assert.equal(isReadOnly(remote('merge_pull_request')), false)
  // « listing_delete » ne commence pas par « list_ » : une action.
  assert.equal(isReadOnly(remote('listing_delete')), false)
  assert.equal(isReadOnly(remote('create_view', { readOnlyHint: true })), true)
  assert.equal(isReadOnly(remote('get_and_reset', { readOnlyHint: false })), false)
})

test('les noms d’outils restent acceptés par Claude', () => {
  assert.equal(toolName('github', 'list_pull_requests'), 'github_list_pull_requests')
  assert.equal(toolName('mcp3', 'files/read.all'), 'mcp3_files_read_all')
  assert.equal(toolName('linear', 'x'.repeat(80)).length, 64)
})

test('le jeton part dans l’en-tête attendu par chaque service', () => {
  assert.deepEqual(headersFor('github', 'abc'), { Authorization: 'Bearer abc' })
  assert.deepEqual(headersFor('sentry', 'abc'), { 'Sentry-Bearer': 'abc' })
  assert.deepEqual(headersFor('cloudinary', 'cloudinary://k:s@c'), { 'cloudinary-url': 'cloudinary://k:s@c' })
  assert.deepEqual(headersFor('maps', 'abc'), { 'X-Goog-Api-Key': 'abc' })
  assert.deepEqual(headersFor('mcp', 'abc'), { Authorization: 'Bearer abc' })
})

test('le catalogue envoyé à l’écran ne contient ni adresse ni en-tête', () => {
  for (const s of catalogueInfo()) {
    assert.equal('url' in s, false)
    assert.equal('entete' in s, false)
    assert.ok(serviceOf(s.id))
  }
  assert.equal(catalogueInfo().find((s) => s.id === 'coolify')?.urlLibre, true)
})

test('un lien Figma donne la clé du fichier', () => {
  assert.equal(figmaKey('https://www.figma.com/design/AbC123xyz/Maquette-CODE?node-id=1-2'), 'AbC123xyz')
  assert.equal(figmaKey('https://figma.com/file/K3y/Ancien'), 'K3y')
  assert.equal(figmaKey('  AbC123  '), 'AbC123')
})

test('les outils natifs sont en lecture, différés et préfixés', () => {
  const tools = [...nativeTools('vercel', 'Vercel', 'x'), ...nativeTools('figma', 'Figma', 'x')]
  assert.ok(tools.length >= 8)
  for (const t of tools) {
    assert.equal(t.risk, 'lecture')
    assert.equal(t.deferred, true)
    assert.match(t.name, /^(vercel|figma)_[a-z_]+$/)
  }
  const journal = tools.find((t) => t.name === 'vercel_journal_deploiement')!
  assert.equal(journal.validate?.({}, {} as ToolContext), 'Champ « deploiement » manquant.')
  assert.equal(journal.validate?.({ deploiement: 'dpl_1' }, {} as ToolContext), null)
})
