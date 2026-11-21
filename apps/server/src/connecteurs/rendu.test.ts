import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderConnecteur, titreFr } from './rendu.ts'
import { estNomSimple, norme, parmi, slugProbable } from './expo.ts'
import { resoudre } from './schema.ts'

const pr = (n: number, repo: string, extra: Record<string, unknown> = {}) => ({
  url: `https://api.github.com/repos/octocat/${repo}/issues/${n}`,
  repository_url: `https://api.github.com/repos/octocat/${repo}`,
  html_url: `https://github.com/octocat/${repo}/pull/${n}`,
  id: 3000 + n,
  node_id: 'PR_kw',
  number: n,
  title: `Titre ${n}`,
  user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', url: 'https://api.github.com/users/octocat' },
  labels: [{ name: 'voix' }],
  state: 'open',
  locked: false,
  comments: 0,
  created_at: '2026-10-30T10:00:00Z',
  updated_at: '2026-11-01T09:00:00Z',
  body: '## Résumé\n\nCODE juge la **fin de vos phrases** au sens.',
  pull_request: { url: 'https://api.github.com/x', html_url: `https://github.com/octocat/${repo}/pull/${n}`, merged_at: null },
  ...extra
})

test('pull requests GitHub : des cartes en français, sans adresses d’API ni drapeaux techniques', () => {
  const text = JSON.stringify({
    total_count: 3,
    incomplete_results: false,
    items: [pr(6, 'code'), pr(5, 'code', { state: 'closed', pull_request: { merged_at: '2026-10-31T12:00:00Z' } }), pr(2, 'orbit', { draft: true })]
  })
  const v = renderConnecteur('github', 'GitHub', 'Pull requests', text)
  assert.equal(v.disposition, 'cartes')
  assert.equal(v.total, 3)
  assert.deepEqual(v.cartes.map((c) => c.statut?.label), ['Ouverte', 'Fusionnée', 'Brouillon'])
  assert.equal(v.cartes[0]!.contexte, 'octocat/code')
  assert.equal(v.cartes[0]!.numero, '#6')
  assert.equal(v.cartes[0]!.lien, 'https://github.com/octocat/code/pull/6')
  assert.equal(v.cartes[0]!.extrait, 'Résumé CODE juge la fin de vos phrases au sens.')
  assert.equal(v.resume[0]!.label, 'pull requests')
  assert.ok(v.resume.some((r) => r.label === 'dépôts' && r.valeur === '2'))
  assert.ok(!JSON.stringify(v).includes('api.github.com'))
  assert.ok(!JSON.stringify(v).toLowerCase().includes('incomplete'))
})

test('déploiements Vercel : une frise, la production en évidence, l’adresse devient un lien', () => {
  const text = JSON.stringify([
    { projet: 'mon-site', etat: 'READY', cible: 'production', branche: 'main', commit: 'feat(voix): fin de phrase au sens\n\ncorps', auteur: 'octocat', cree: '2026-10-27T18:02:00.000Z', adresse: 'mon-site-abc.vercel.app', id: 'dpl_1' },
    { projet: 'atlas-landing', etat: 'ERROR', cible: 'preview', cree: '2026-10-26T08:00:00.000Z', adresse: 'atlas-x.vercel.app', id: 'dpl_2' }
  ])
  const v = renderConnecteur('vercel', 'Vercel', 'Déploiements', text)
  assert.equal(v.disposition, 'frise')
  assert.equal(v.cartes[0]!.titre, 'feat(voix): fin de phrase au sens')
  assert.deepEqual(v.cartes[0]!.statut, { label: 'En ligne', ton: 'ok' })
  assert.deepEqual(v.cartes[0]!.puces, ['Production', 'main'])
  assert.equal(v.cartes[0]!.lien, 'https://mon-site-abc.vercel.app')
  assert.deepEqual(v.cartes[1]!.statut, { label: 'Échec', ton: 'echec' })
})

test('builds Expo : plateforme, version, profil', () => {
  const text = JSON.stringify({ builds: [{ id: 'b1', platform: 'IOS', status: 'FINISHED', appVersion: '1.2.0', appBuildVersion: '14', buildProfile: 'production', createdAt: '2026-10-29T10:00:00Z', initiatingActor: { username: 'octocat' } }] })
  const v = renderConnecteur('expo', 'Expo', 'Builds', text)
  assert.equal(v.disposition, 'frise')
  assert.equal(v.cartes[0]!.icone, 'ios')
  assert.equal(v.cartes[0]!.titre, 'iOS 1.2.0 (14)')
  assert.equal(v.cartes[0]!.auteur, 'octocat')
  assert.deepEqual(v.cartes[0]!.statut, { label: 'Réussi', ton: 'ok' })
})

test('réponse rédigée ou objet seul : texte ou fiche', () => {
  assert.equal(renderConnecteur('expo', 'Expo', 'Builds', '## 2 builds\n- iOS').disposition, 'texte')
  const fiche = renderConnecteur('github', 'GitHub', 'Mon profil', JSON.stringify({ login: 'octocat', name: 'Claire Martin', public_repos: 12, url: 'https://api.github.com/users/x', id: 4 }))
  assert.equal(fiche.disposition, 'fiche')
  assert.equal(fiche.cartes[0]!.titre, 'Claire Martin')
  assert.ok(!JSON.stringify(fiche).includes('api.github.com'))
})

test('titres des outils en français', () => {
  assert.equal(titreFr('search_pull_requests', 'Search pull requests'), 'Pull requests')
  assert.equal(titreFr('list_workflow_runs'), 'Exécutions des Actions')
  assert.equal(titreFr('build_list'), 'Builds')
  assert.equal(titreFr('list_issues'), 'Issues')
  assert.equal(titreFr('get_me'), 'Mon profil')
})

test('schéma Excalidraw : reprise, suppressions et cadre', () => {
  const avant = [{ type: 'rectangle', id: 'a', x: 0, y: 0, width: 10, height: 10 }, { type: 'text', id: 'b', x: 0, y: 0, text: 'x' }]
  const r = resoudre(
    [{ type: 'restoreCheckpoint', id: 'c1' }, { type: 'delete', ids: 'b' }, { type: 'cameraUpdate', x: 0, y: 0, width: 800, height: 600 }, { type: 'ellipse', id: 'c', x: 5, y: 5, width: 4, height: 4 }],
    (id) => (id === 'c1' ? avant : undefined)
  )
  assert.deepEqual(r.elements.map((e) => e.id), ['a', 'c'])
  assert.deepEqual(r.camera, { x: 0, y: 0, width: 800, height: 600 })
})

test('Expo : un nom simple est à retrouver, un identifiant complet passe tel quel', () => {
  assert.equal(estNomSimple('atlas'), true)
  assert.equal(estNomSimple('Atlas Plus'), true)
  assert.equal(estNomSimple('@octocat/atlas'), false)
  assert.equal(estNomSimple('780fbb66-88d4-42c5-a33d-6f9a371d891d'), false)
  assert.equal(norme('Atlas Plus'), 'atlasplus')
  assert.equal(norme('@octocat/atlas-plus'), 'atlasplus')
})

test('Expo : le projet le plus proche dans la liste du compte, et la liste en tuiles', () => {
  const apps = [
    { nom: 'Atlas', slug: 'atlas', compte: 'octocat', appFullName: '@octocat/atlas', appId: '1', lien: 'https://expo.dev/accounts/octocat/projects/atlas' },
    { nom: 'Atlas Plus', slug: 'atlas-plus', compte: 'octocat', appFullName: '@octocat/atlas-plus', appId: '2', lien: 'https://expo.dev/accounts/octocat/projects/atlas-plus' },
    { nom: 'Nova', slug: 'nova-app', compte: 'octocat', appFullName: '@octocat/nova-app', appId: '3', lien: 'https://expo.dev/accounts/octocat/projects/nova-app' }
  ]
  assert.equal(parmi(apps, 'atlas')?.appFullName, '@octocat/atlas')
  assert.equal(parmi(apps, 'Atlas plus')?.appFullName, '@octocat/atlas-plus')
  assert.equal(parmi(apps, 'nova')?.appFullName, '@octocat/nova-app')
  assert.equal(parmi(apps, 'kapita'), null)
  assert.equal(slugProbable('Nova Pro'), 'nova-pro')
  const v = renderConnecteur('expo', 'Expo', 'Projets', JSON.stringify(apps))
  assert.equal(v.disposition, 'grille')
  assert.equal(v.cartes[2]!.titre, 'Nova')
  assert.equal(v.resume[0]!.label, 'projets')
})
