import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-outils-'))
const { ALWAYS_LOADED, OUTILS_PROFIL, repairInput, toolDefinitions, toolsFor } = await import('./index.ts')
const { ensureOwner } = await import('../db.ts')

test('seuls les outils courants sont décrits d’avance ; les autres attendent la recherche d’outils', () => {
  const defs = (toolDefinitions({ fichiers: true, unattended: false, user: { id: ensureOwner() } } as never) as { name: string; defer_loading?: boolean; input_schema?: unknown }[])
  const named = new Map(defs.map((d) => [d.name, d]))
  for (const n of ['memoire_retenir', 'gmail_importants', 'agenda_evenements', 'fichiers_chercher', 'meteo']) {
    assert.ok(named.has(n), n)
    assert.equal(named.get(n)!.defer_loading, undefined, n)
  }
  for (const n of ['fichiers_corbeille', 'tache_creer', 'itineraire']) assert.equal(named.get(n)?.defer_loading, true, n)
  assert.ok(defs.some((d) => d.name === 'tool_search_tool_bm25'))
  // Assez d'outils visibles pour répondre sans chercher aux demandes courantes, mais une minorité.
  const visibles = defs.filter((d) => 'input_schema' in d && !d.defer_loading)
  assert.ok(visibles.length >= 10 && visibles.length <= ALWAYS_LOADED.size)
})

test('le profil choisit les outils décrits d’avance ; les autres restent trouvables', () => {
  const uid = ensureOwner()
  const differes = (profil: string) => new Map(toolsFor({ fichiers: true, unattended: false, user: { id: uid, reglages: { profil } } } as never).map((t) => [t.name, t.deferred]))
  const foyer = differes('foyer')
  assert.equal(foyer.get('itineraire'), false)
  assert.equal(foyer.get('fichiers_chercher'), true, 'toujours là, mais à chercher')
  // projet_etat n'existe qu'avec un connecteur de développement relié.
  if (foyer.has('projet_etat')) assert.equal(foyer.get('projet_etat'), true)
  const dev = differes('developpeur')
  assert.equal(dev.get('fichiers_lire'), false)
  assert.equal(dev.get('itineraire'), true)
  assert.equal(differes('secretariat').get('agenda_disponibilites'), false)
  // Chaque outil nommé par un profil existe (une faute de frappe le laisserait différé en silence).
  const tous = new Set(toolsFor({ fichiers: true, unattended: false, user: { id: uid } } as never).map((t) => t.name))
  for (const [profil, noms] of Object.entries(OUTILS_PROFIL)) for (const n of noms) if (n !== 'projet_etat') assert.ok(tous.has(n), `${profil} : ${n}`)
})

test('un champ obligatoire mal nommé par le modèle est renommé ; sinon l’entrée reste telle quelle', () => {
  const schema = { input_schema: { type: 'object' as const, properties: { conversation: {}, texte: {} }, required: ['conversation'] } }
  assert.deepEqual(repairInput(schema, { fil: 'Léa' }), { conversation: 'Léa' })
  assert.deepEqual(repairInput(schema, { fil: 'Léa', texte: 'Bonjour' }), { conversation: 'Léa', texte: 'Bonjour' })
  assert.deepEqual(repairInput(schema, { conversation: 'Léa' }), { conversation: 'Léa' })
  assert.deepEqual(repairInput(schema, { fil: 'Léa', nom: 'x' }), { fil: 'Léa', nom: 'x' }, 'deux champs inconnus : on ne devine pas')
})
