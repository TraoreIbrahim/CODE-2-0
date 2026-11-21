import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-moteurs-'))
const { MoteurCompat, schemaPour, usageDe, modeleDeConversation, modeleOllama, contexteOllama } = await import('./compat.ts')
const { chercherOutils } = await import('./recherche-outils.ts')
const { rangerCatalogue, prixCatalogue } = await import('./tarifs.ts')
const { creerMoteur, CleManquante, MoteurErreur } = await import('./index.ts')
const { priceOf, costOf } = await import('../usage.ts')
const { describeBrainError } = await import('../brain.ts')
const { remember } = await import('../../tools/memory.ts')
const { taskTools } = await import('../../tools/taches.ts')
const { reminderTools } = await import('../../tools/rappels.ts')
const { simule } = await import('../banc.ts')

type Corps = { model: string; messages: { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[]; tools?: { function: { name: string; parameters: Record<string, unknown> } }[]; max_completion_tokens?: number; max_tokens?: number; stream?: boolean }

/** Une réponse diffusée au format d'OpenAI : un `data:` par morceau, puis `[DONE]`. */
function flux(morceaux: unknown[]): Response {
  const txt = [...morceaux.map((m) => `data: ${JSON.stringify(m)}\n\n`), 'data: [DONE]\n\n'].join('')
  return new Response(txt, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** Un faux fournisseur : chaque requête est gardée, la réponse vient de `repondre`. */
function fournisseur(repondre: (c: Corps, n: number) => Response) {
  const requetes: Corps[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const c = JSON.parse(String(init?.body)) as Corps
    requetes.push(c)
    return repondre(c, requetes.length - 1)
  }) as unknown as typeof fetch
  return { requetes, fetchImpl }
}

const texte = (t: string) => ({ choices: [{ delta: { content: t } }] })
const appel = (id: string, name: string, args: string, index = 0) => ({ choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: args } }] } }] })
const fin = (raison: string) => ({ choices: [{ delta: {}, finish_reason: raison }] })

async function deroule<T>(g: AsyncGenerator<string, T>): Promise<{ texte: string; fin: T }> {
  let t = ''
  for (;;) {
    const r = await g.next()
    if (r.done) return { texte: t, fin: r.value }
    t += r.value
  }
}

const params = (outils: Parameters<InstanceType<typeof MoteurCompat>['echange']>[0]['outils'], compter: (modele: string, usage: unknown) => void = () => {}) => ({ modele: 'gpt-test', systeme: 'Tu es un assistant.', historique: [], question: 'Bonjour', outils, tier: 'fast' as const, tache: false, compter })

test('compat : texte diffusé, usage compté sous « fournisseur:modèle », plafond selon le fournisseur', async () => {
  const f = fournisseur(() => flux([{ model: 'gpt-test-2026', ...texte('Bon') }, texte('jour.'), fin('stop'), { choices: [], usage: { prompt_tokens: 120, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 100 } } }]))
  const comptes: [string, unknown][] = []
  const m = new MoteurCompat('openai', 'https://api.exemple.test/v1', 'sk-test', f.fetchImpl)
  const r = await deroule(m.echange(params([], (mod, u) => void comptes.push([mod, u]))).etape(new AbortController().signal))
  assert.equal(r.texte, 'Bonjour.')
  assert.equal(r.fin.arret, 'fin')
  assert.deepEqual(comptes, [['openai:gpt-test-2026', { input_tokens: 20, output_tokens: 8, cache_read_input_tokens: 100 }]])
  assert.equal(f.requetes[0]!.max_completion_tokens, 8000)
  assert.equal(f.requetes[0]!.stream, true)
  const g = fournisseur(() => flux([texte('Oui.'), fin('stop')]))
  await deroule(new MoteurCompat('mistral', 'https://api.exemple.test/v1', 'k', g.fetchImpl).echange(params([])).etape(new AbortController().signal))
  assert.equal(g.requetes[0]!.max_tokens, 8000)
})

test('compat : appel d’outil en morceaux, puis son résultat renvoyé dans l’ordre', async () => {
  const outil = simule(remember)
  const f = fournisseur((_c, n) =>
    n === 0 ? flux([texte('Je note. '), appel('c1', 'memoire_retenir', '{"fait":"Préfère le matin",'), { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"sujet":"preferences"}' } }] } }] }, fin('tool_calls')]) : flux([texte('C’est noté.'), fin('stop')])
  )
  const m = new MoteurCompat('openai', 'https://api.exemple.test/v1', 'sk-test', f.fetchImpl)
  const e = m.echange(params([outil]))
  const un = await deroule(e.etape(new AbortController().signal))
  assert.equal(un.fin.arret, 'outils')
  assert.deepEqual(un.fin.appels, [{ id: 'c1', name: 'memoire_retenir', input: { fait: 'Préfère le matin', sujet: 'preferences' } }])
  e.resultats([{ appel: un.fin.appels[0]!, run: { block: { type: 'tool_result', tool_use_id: 'c1', content: 'Fait.' }, summary: '', risk: 'preparation', failed: false } }])
  const deux = await deroule(e.etape(new AbortController().signal))
  assert.equal(deux.texte, 'C’est noté.')
  const msgs = f.requetes[1]!.messages
  assert.equal(msgs.at(-2)!.role, 'assistant')
  assert.deepEqual(msgs.at(-1), { role: 'tool', tool_call_id: 'c1', content: 'Fait.' })
})

test('compat : recherche d’outils faite sur place, l’outil trouvé est décrit à l’étape suivante', async () => {
  const outils = [...reminderTools, ...taskTools].map(simule)
  const f = fournisseur((c, n) => {
    if (n === 0) return flux([appel('s1', 'outils_chercher', '{"requete":"planifier une tâche"}'), fin('tool_calls')])
    return flux([appel('t1', 'tache_creer', JSON.stringify({ titre: 'Bilan', consigne: 'Fais le bilan', repetition: 'hebdomadaire', heure: '17:00', jours: ['vendredi'] })), fin('tool_calls')])
  })
  const m = new MoteurCompat('groq', 'https://api.exemple.test/v1', 'gsk_test', f.fetchImpl)
  const e = m.echange(params(outils))
  const noms = (i: number) => f.requetes[i]!.tools!.map((t) => t.function.name)
  const r = await deroule(e.etape(new AbortController().signal))
  assert.ok(noms(0).includes('outils_chercher') && !noms(0).includes('tache_creer'), 'tache_creer est différé')
  assert.ok(noms(0).includes('rappel_creer'), 'les outils courants sont décrits d’emblée')
  assert.ok(noms(1).includes('tache_creer'), 'trouvé, il est décrit ensuite')
  assert.equal(r.fin.arret, 'outils')
  assert.deepEqual(r.fin.appels.map((a) => a.name), ['tache_creer'])
  const tool = f.requetes[1]!.messages.at(-1)!
  assert.equal(tool.role, 'tool')
  assert.match(String(tool.content), /tache_creer/)
})

test('compat : erreur HTTP lisible, clé manquante, Ollama sans adresse', async () => {
  const f = fournisseur(() => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 }))
  const m = new MoteurCompat('openai', 'https://api.exemple.test/v1', 'sk-faux', f.fetchImpl)
  await assert.rejects(deroule(m.echange(params([])).etape(new AbortController().signal)), (err: unknown) => err instanceof MoteurErreur && err.status === 401)
  assert.match(describeBrainError(new MoteurErreur('OpenAI', 401, 'x')), /Clé OpenAI refusée/)
  assert.throws(() => creerMoteur('gemini', {}), CleManquante)
  assert.throws(() => creerMoteur('ollama', {}), /CODE_OLLAMA_URL/)
  assert.match(describeBrainError(new CleManquante('Mistral')), /Réglages › Clés API/)
})

test('compat : modèle qui refuse les outils en raisonnant, relancé sans réflexion et retenu', async () => {
  const refus = () => new Response(JSON.stringify({ error: { message: 'Function tools with reasoning_effort are not supported for gpt-6.1-x in /v1/chat/completions.' } }), { status: 400 })
  const f = fournisseur((c) => ((c as { reasoning_effort?: string }).reasoning_effort === 'none' ? flux([texte('Oui.'), fin('stop')]) : refus()))
  const m = new MoteurCompat('openai', 'https://api.exemple.test/v1', 'sk-test', f.fetchImpl)
  const p = { ...params([simule(remember)]), modele: 'gpt-6.1-x' }
  assert.equal((await deroule(m.echange(p).etape(new AbortController().signal))).texte, 'Oui.')
  assert.deepEqual(f.requetes.map((r) => (r as { reasoning_effort?: string }).reasoning_effort), ['low', 'none'])
  // La fois suivante, directement sans réflexion ; sans outils, la réflexion reste.
  await deroule(m.echange(p).etape(new AbortController().signal))
  assert.equal((f.requetes[2] as { reasoning_effort?: string }).reasoning_effort, 'none')
})

test('compat : json imposé (outil forcé, ou objet trouvé dans le texte) et réponse courte', async () => {
  const f = fournisseur((_c, n) =>
    Response.json(
      n === 0
        ? { model: 'm', choices: [{ message: { tool_calls: [{ id: 'x', type: 'function', function: { name: 'noter', arguments: '{"faits":[]}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }
        : n === 1
          ? { choices: [{ message: { content: '```json\n{"faits":[{"sujet":"profil","fait":"A un chien"}]}\n```' } }] }
          : { choices: [{ message: { content: 'fini' } }] }
    )
  )
  const m = new MoteurCompat('deepseek', 'https://api.exemple.test/v1', 'k', f.fetchImpl)
  const outil = { name: 'noter', description: 'Notes', schema: { type: 'object', properties: { faits: { type: 'array' } } } }
  assert.deepEqual(await m.json({ modele: 'm', systeme: 's', texte: 't', outil, compter: () => {} }), { faits: [] })
  assert.deepEqual(await m.json({ modele: 'm', systeme: 's', texte: 't', outil, compter: () => {} }), { faits: [{ sujet: 'profil', fait: 'A un chien' }] })
  assert.equal(await m.court({ modele: 'm', systeme: 's', texte: 't', delaiMs: 1000, compter: () => {} }), 'fini')
})

test('schémas : Gemini sans les mots qu’il refuse, les autres intacts', () => {
  const schema = { type: 'object', properties: { a: { type: 'string', pattern: '^x', minLength: 1 }, b: { type: 'string', format: 'uri' } }, additionalProperties: false }
  assert.deepEqual(schemaPour('gemini', schema), { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } })
  assert.deepEqual(schemaPour('openai', schema), schema)
})

test('usage : cache d’OpenAI et de DeepSeek, coût fourni par OpenRouter', () => {
  assert.deepEqual(usageDe({ prompt_tokens: 50, completion_tokens: 5, prompt_cache_hit_tokens: 30 }), { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 30 })
  const u = usageDe({ prompt_tokens: 10, completion_tokens: 5, cost: 0.0042 })
  assert.equal(costOf('openrouter:openrouter/auto', u), 0.0042)
})

test('modèles : sans les embeddings, la voix ni les images', () => {
  assert.ok(modeleDeConversation('gpt-5.5'))
  assert.ok(!modeleDeConversation('text-embedding-3-large'))
  assert.ok(!modeleDeConversation('gpt-4o-mini-tts'))
  assert.ok(!modeleDeConversation('imagen-4'))
})

test('recherche d’outils : par nom exact d’abord, sans accents ni mots vides', () => {
  const outils = [...reminderTools, ...taskTools]
  assert.equal(chercherOutils('tache_creer', outils)[0]!.name, 'tache_creer')
  assert.ok(chercherOutils('planifier une tâche chaque vendredi', outils).some((t) => t.name === 'tache_creer'))
  assert.deepEqual(chercherOutils('zzz', outils), [])
})

test('tarifs : catalogue d’OpenRouter par fournisseur, Ollama gratuit, inconnu au prix prudent', () => {
  rangerCatalogue({ data: [{ id: 'openai/gpt-test', pricing: { prompt: '0.000002', completion: '0.000008' } } as never, { id: 'mistralai/mistral-test', pricing: { prompt: '0.0000004', completion: '0.000002' } } as never] })
  assert.deepEqual(prixCatalogue('openai', 'gpt-test'), { input: 2, output: 8, cacheRead: 2, cacheWrite: 2 })
  assert.equal(prixCatalogue('mistral', 'mistral-test')?.output, 2)
  assert.equal(priceOf('openai:gpt-test').input, 2)
  assert.equal(priceOf('ollama:qwen3').output, 0)
  assert.ok(priceOf('groq:inconnu').output > 0)
})

test('Ollama : un modèle installé qui sait se servir des outils (qwen3 d’abord), et le contexte chargé', async () => {
  const reponses: Record<string, unknown> = {
    '/api/tags': { models: [{ name: 'llava:7b', capabilities: ['completion', 'vision'] }, { name: 'llama3.1:8b', capabilities: ['completion', 'tools'] }, { name: 'qwen3:8b', capabilities: ['completion', 'tools'] }] },
    '/api/ps': { models: [{ name: 'qwen3:8b', context_length: 4096 }] }
  }
  const faux = (async (url: URL) => Response.json(reponses[url.pathname])) as unknown as typeof fetch
  assert.equal(await modeleOllama('http://127.0.0.1:11434/v1', faux), 'qwen3:8b')
  assert.equal(await contexteOllama('http://127.0.0.1:11434/v1', faux), 4096)
  reponses['/api/tags'] = { models: [{ name: 'llava:7b', capabilities: ['vision'] }] }
  assert.equal(await modeleOllama('http://127.0.0.1:11434/v1', faux), null)
  const injoignable = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
  assert.equal(await modeleOllama('http://127.0.0.1:11434/v1', injoignable), null)
  assert.equal(await contexteOllama('http://127.0.0.1:11434/v1', injoignable), null)
})
