import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-web-'))
const { webSources, webTools } = await import('./brain.ts')
const { costOf } = await import('./usage.ts')

test('outils web : versions par modèle, plafonds, pas de code pays', () => {
  const deep = webTools('deep')
  assert.deepEqual(deep.map((t) => ('type' in t ? t.type : '')), ['web_search_20260209', 'web_fetch_20260209'])
  const fast = webTools('fast')
  assert.deepEqual(fast.map((t) => ('type' in t ? t.type : '')), ['web_search_20250305'])
  assert.ok(!JSON.stringify([...deep, ...fast]).includes('"country"'), 'l’API refuse certains codes pays')
  assert.ok(deep.every((t) => 'max_uses' in t && typeof t.max_uses === 'number'))
})

test('sources d’une recherche : titre et site, sans le www', () => {
  const found = webSources({
    type: 'web_search_tool_result',
    tool_use_id: 'srv_1',
    content: [
      { type: 'web_search_result', title: 'Prix du carburant : octobre 2026', url: 'https://www.lemonde.fr/prix', encrypted_content: 'x', page_age: null },
      { type: 'web_search_result', title: 'Ministère de l’Économie', url: 'https://economie.gouv.fr/prix-carburant', encrypted_content: 'y', page_age: null }
    ]
  } as never)
  assert.deepEqual(found?.sources.map((s) => s.site), ['lemonde.fr', 'economie.gouv.fr'])
  // Une erreur de recherche arrive comme un objet, pas une liste : pas de sources.
  assert.equal(webSources({ type: 'web_search_tool_result', tool_use_id: 'srv_2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } } as never), null)
})

test('une recherche web coûte un centime en plus des tokens', () => {
  const sans = costOf('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 100 })
  const avec = costOf('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2 } })
  assert.equal(Math.round((avec - sans) * 1000) / 1000, 0.02)
})
