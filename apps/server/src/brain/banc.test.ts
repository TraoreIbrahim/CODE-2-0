import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-banc-'))
const { ensureOwner } = await import('../db.ts')
const { getUser } = await import('../users/users.ts')
const { runAsUser } = await import('../users/scope.ts')
const { Brain } = await import('./brain.ts')
const { lancerBanc, listBancs, verdict } = await import('./banc.ts')
const { activeRappels } = await import('../scheduler/store.ts')

type Corps = { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] }

const flux = (morceaux: unknown[]) => new Response([...morceaux.map((m) => `data: ${JSON.stringify(m)}\n\n`), 'data: [DONE]\n\n'].join(''))
const appels = (...a: [string, unknown][]) => flux([{ choices: [{ delta: { tool_calls: a.map(([name, args], index) => ({ index, id: `c${index}_${name}`, function: { name, arguments: JSON.stringify(args) } })) } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50 } }])
const texte = (t: string) => flux([{ choices: [{ delta: { content: t }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20 } }])

/** Un modèle docile : l'outil attendu pour chaque demande, puis une phrase ; il cherche les outils différés. */
const docile = (async (_url: string, init?: RequestInit) => {
  const c = JSON.parse(String(init?.body)) as Corps
  const dernier = c.messages.at(-1)!
  // Après un vrai résultat d'outil, une phrase ; après une recherche d'outils, on agit avec ce qui a été trouvé.
  if (dernier.role === 'tool' && !String(dernier.content).startsWith('Outils maintenant disponibles')) return texte('C’est fait.')
  const q = String(c.messages.findLast((m) => m.role === 'user')?.content)
  const outils = new Set(c.tools?.map((t) => t.function.name))
  if (/Présente-toi/.test(q)) return texte('Je suis Code, votre assistant vocal.')
  if (/vendredis/.test(q)) return outils.has('tache_creer') ? appels(['tache_creer', { titre: 'Bilan', consigne: 'Fais-moi le bilan de la semaine.', repetition: 'hebdomadaire', heure: '17:00', jours: ['vendredi'] }]) : appels(['outils_chercher', { requete: 'tâche planifiée récurrente' }])
  if (/puis dis-moi/.test(q)) return appels(['rappel_creer', { texte: 'envoyer le devis', annonce: 'vous devez envoyer le devis', dans_minutes: 900 }], ['rappels_lister', {}])
  if (/Rappelle-moi/.test(q)) return appels(['rappel_creer', { texte: 'appeler le garage', annonce: 'vous devez appeler le garage', dans_minutes: 120 }])
  if (/temps/.test(q)) return appels(['meteo', { lieu: 'Lyon' }])
  if (/Retiens/.test(q)) return appels(['memoire_retenir', { fait: 'Préfère les réunions le matin', sujet: 'preferences' }])
  return texte('Je ne sais pas.')
}) as unknown as typeof fetch

/** Un modèle qui n'appelle jamais d'outil. */
const bavard = (async () => texte('Bien sûr, c’est noté.')) as unknown as typeof fetch

test('banc : un moteur docile est « testé », sans rien créer ; le web est ignoré sans source', async () => {
  const uid = ensureOwner()
  const user = getUser(uid)!
  const brain = new Brain({ OPENAI_API_KEY: 'sk-test' }, { fetchImpl: docile })
  const etapes: number[] = []
  const r = await runAsUser(uid, () => lancerBanc(brain, user, { fournisseur: 'openai', modele: 'gpt-test' }, (p) => etapes.push(p.scenarios.length)))
  assert.deepEqual(
    r.scenarios.map((s) => [s.id, s.ok, s.ignore ?? false, s.detail ?? '']),
    [
      ['presentation', true, false, ''],
      ['rappel', true, false, ''],
      ['meteo', true, false, ''],
      ['memoire', true, false, ''],
      ['enchainement', true, false, ''],
      ['recherche_outils', true, false, ''],
      ['web', false, true, 'aucune recherche web sur ce serveur (clé Brave ou SearXNG)']
    ]
  )
  assert.equal(r.etat, 'teste')
  assert.ok(r.cout > 0, 'le banc compte ce qu’il coûte')
  assert.deepEqual(etapes, [1, 2, 3, 4, 5, 6])
  assert.equal(activeRappels(uid).length, 0, 'outils simulés : aucun rappel créé')
  assert.deepEqual(listBancs().map((b) => [b.fournisseur, b.modele, b.etat]), [['openai', 'gpt-test', 'teste']])
})

test('banc : un moteur qui n’appelle aucun outil échoue ; le verdict compte sans les ignorés', async () => {
  const uid = ensureOwner()
  const brain = new Brain({ MISTRAL_API_KEY: 'k' }, { fetchImpl: bavard })
  const r = await runAsUser(uid, () => lancerBanc(brain, getUser(uid)!, { fournisseur: 'mistral', modele: 'm' }, () => {}))
  assert.equal(r.etat, 'echec')
  assert.equal(r.scenarios.find((s) => s.id === 'rappel')?.detail, 'rappel_creer pas appelé')
  const s = (ok: boolean, ignore = false) => ({ id: 'x', nom: 'x', ok, ignore, ms: 0 })
  assert.equal(verdict([s(true), s(true), s(false, true)]), 'teste')
  assert.equal(verdict([s(true), s(false), s(false, true)]), 'limite')
  assert.equal(verdict([s(true), s(false), s(false)]), 'echec')
  assert.equal(listBancs().length, 2)
})
