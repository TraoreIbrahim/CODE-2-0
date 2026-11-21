import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UiProjetDepot, UiProjetSite } from '@code/protocol'
import { causeDuJournal, diffEchecs, type EchecProjet } from './alertes.ts'
import { bilan } from './projet.ts'
import { projetsHistory, projetsMessage, projetsSpoken } from '../push/messages.ts'

const depot = (ci?: UiProjetDepot['ci']): UiProjetDepot => ({ nom: 'octocat/atlas-api', lien: 'https://github.com/octocat/atlas-api', branche: 'main', prive: true, commits: [], prs: [], prsPlus: false, ...(ci ? { ci } : {}) })
const site = (ton: 'ok' | 'echec' | 'encours'): UiProjetSite => ({ nom: 'atlas-admin', production: { statut: { label: 'x', ton }, cible: 'production', date: '2026-11-02T10:00:00Z' } })

test('bilan d’un projet : les échecs d’abord, puis ce qui tourne, sinon tout va bien', () => {
  assert.deepEqual(bilan({ nom: 'kapita', depots: [], sites: [], applis: [] }).sante, 'inconnu')
  assert.deepEqual(bilan({ nom: 'atlas', depots: [depot()], sites: [site('ok')], applis: [] }), { sante: 'ok', phrase: 'Tout est au vert.' })
  assert.equal(bilan({ nom: 'atlas', depots: [depot()], sites: [site('encours')], applis: [] }).sante, 'encours')
  const ko = bilan({
    nom: 'atlas',
    depots: [depot({ titre: 'CI', statut: { label: 'Échec', ton: 'echec' }, date: '2026-11-02T10:00:00Z', lien: 'https://github.com/x' })],
    sites: [site('echec')],
    applis: [{ nom: 'Atlas', id: '@octocat/atlas', lien: 'https://expo.dev', builds: [{ plateforme: 'android', statut: { label: 'Échec', ton: 'echec' }, date: '2026-11-02T10:00:00Z', lien: 'https://expo.dev/b' }] }]
  })
  assert.equal(ko.sante, 'echec')
  assert.equal(ko.phrase, '3 échecs : l’intégration continue de atlas-api, la production de atlas-admin, le build Android de Atlas.')
  assert.equal(bilan({ nom: 'atlas', depots: [], sites: [site('echec')], applis: [] }).phrase, 'La production de atlas-admin est en échec.')
})

test('cause d’un échec : la ligne d’erreur du journal, avec son fichier, sans le bruit', () => {
  const journal = [
    'Running "pnpm run build"',
    '\u001b[36m▲ Next.js 15.1.0\u001b[0m',
    'Failed to compile.',
    './src/app/orders/page.tsx:42:7',
    "Type error: Property 'total' does not exist on type 'Order'.",
    'Error: Command "pnpm run build" exited with 1'
  ]
  assert.equal(causeDuJournal(journal), 'Failed to compile.')
  assert.equal(causeDuJournal(journal.filter((l) => l !== 'Failed to compile.')), "./src/app/orders/page.tsx:42:7 Type error: Property 'total' does not exist on type 'Order'.")
  assert.equal(causeDuJournal(['Installing dependencies…', 'Done in 3s']), undefined)
})

const echec = (cle: string, extra: Partial<EchecProjet> = {}): EchecProjet => ({
  cle,
  source: 'vercel',
  projet: 'atlas-admin',
  quoi: 'Déploiement en production',
  grave: true,
  ref: `déploiement Vercel ${cle}`,
  date: '2026-11-02T10:00:00Z',
  ...extra
})

test('alertes de projets : rien au premier passage, puis chaque échec une seule fois', () => {
  const premier = diffEchecs(null, [echec('vercel:a')], 1000)
  assert.deepEqual(premier.nouveaux, [])
  assert.deepEqual(premier.etat, { depuis: 1000, vus: ['vercel:a'] })
  const second = diffEchecs(premier.etat, [echec('vercel:a'), echec('vercel:b')], 2000)
  assert.deepEqual(second.nouveaux.map((e) => e.cle), ['vercel:b'])
  assert.deepEqual(second.etat.vus, ['vercel:a', 'vercel:b'])
  assert.deepEqual(diffEchecs(second.etat, [echec('vercel:b')], 3000).nouveaux, [])
})

test('alertes de projets : notification, phrase et mémoire de la conversation', () => {
  const e = echec('vercel:dpl_1', { cause: "Type error: Property 'total' does not exist on type 'Order'.", lien: 'https://vercel.com/x/atlas-admin/1' })
  assert.deepEqual(projetsMessage([e]), {
    titre: 'Vercel · atlas-admin : échec',
    corps: "Déploiement en production en échec — Type error: Property 'total' does not exist on type 'Order'.",
    tag: 'projets',
    url: '/'
  })
  assert.equal(projetsSpoken([e]), "Le déploiement en production de atlas-admin a échoué sur Vercel. Type error: Property 'total' does not exist on type 'Order'. Tu veux que je regarde ?")
  const run = echec('github:9', { source: 'github', projet: 'octocat/atlas-api', quoi: 'Workflow CI', grave: false, ref: 'run GitHub Actions 9 du dépôt octocat/atlas-api' })
  assert.equal(projetsSpoken([e, run]), '2 échecs dans tes projets : le déploiement en production de atlas-admin ; le workflow CI de atlas-api. Tu veux que je regarde ?')
  assert.ok(projetsHistory([run]).includes('(run GitHub Actions 9 du dépôt octocat/atlas-api)'))
})
