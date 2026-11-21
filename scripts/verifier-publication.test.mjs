import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { analyserTexte, estAncienneIcone, lireListe, plier } from './verifier-publication.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'verifier-publication.mjs')

// Faux secrets assemblés à l'exécution : ce fichier lui-même doit passer la vérification.
const FAUSSE_CLE_ANTHROPIC = 'sk-' + 'ant-' + 'api03-' + 'x'.repeat(40)
const FAUSSE_CLE_GOOGLE = 'AI' + 'za' + 'B'.repeat(35)
// Adresse IP publique, assemblée elle aussi.
const IP_PUBLIQUE = ['51', '15', '2', '8'].join('.')
const FAUX_CLIENT_GOOGLE = '123456789012-' + 'a'.repeat(32) + '.apps.' + 'googleusercontent.com'

function depot() {
  const dossier = mkdtempSync(join(tmpdir(), 'verif-'))
  const g = (...args) => execFileSync('git', args, { cwd: dossier })
  g('init', '-q', '-b', 'main')
  g('config', 'user.name', 'Test')
  g('config', 'user.email', 'test@example.com')
  const ecrire = (chemin, texte) => {
    mkdirSync(dirname(join(dossier, chemin)), { recursive: true })
    writeFileSync(join(dossier, chemin), texte)
  }
  const commit = (message) => {
    g('add', '-A')
    g('commit', '-q', '-m', message)
  }
  const lancer = (...args) => spawnSync('node', [SCRIPT, ...args], { cwd: dossier, encoding: 'utf8' })
  return { dossier, ecrire, commit, g, lancer, fin: () => rmSync(dossier, { recursive: true, force: true }) }
}

test('reconnaît les secrets sans les recopier', () => {
  const p = analyserTexte(`const cle = '${FAUSSE_CLE_ANTHROPIC}'\nclient: ${FAUX_CLIENT_GOOGLE}\n${FAUSSE_CLE_GOOGLE}`, [])
  assert.deepEqual(p.map((x) => x.regle), ['clé Anthropic', 'client OAuth Google', 'clé Google'])
  assert.ok(p.every((x) => !x.extrait.includes('x'.repeat(10))), 'le secret ne doit pas être affiché en entier')
})

test('ignore les adresses locales, privées et les numéros de version', () => {
  const p = analyserTexte('http://127.0.0.1:8787 192.168.1.4 10.0.0.2 172.20.0.1 0.0.0.0 version 1.2.300.4 doc 203.0.113.9', [])
  assert.deepEqual(p, [])
  assert.equal(analyserTexte(`serveur ${IP_PUBLIQUE}`, [])[0]?.regle, 'adresse IP publique')
})

test('les mots interdits ne tiennent compte ni de la casse ni des accents', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'liste-'))
  const liste = join(dossier, 'liste.txt')
  writeFileSync(liste, '# commentaire\nDupré\n\nre:\\+99\\s?\\d{2}\n')
  const interdits = lireListe(liste)
  assert.equal(plier('DUPRÉ'), 'dupre')
  assert.equal(analyserTexte('Auteur : M. DUPRE', interdits)[0]?.extrait, 'Dupré')
  assert.equal(analyserTexte('Appelez le +99 07 00', interdits)[0]?.regle, 'mot interdit')
  assert.deepEqual(analyserTexte('rien à voir', interdits), [])
  // Une expression autorisée ne couvre qu'elle-même.
  const avecExceptions = [...interdits, { nom: '!Europe/Dupré', autorise: plier('Europe/Dupré') }]
  assert.deepEqual(analyserTexte("{ tz: 'Europe/Dupre' }", avecExceptions), [])
  assert.equal(analyserTexte("{ tz: 'Europe/Dupre', label: 'Dupre' }", avecExceptions).length, 1)
  rmSync(dossier, { recursive: true, force: true })
})

test('un dépôt propre passe', () => {
  const d = depot()
  d.ecrire('README.md', '# Projet\n')
  d.ecrire('.env.example', 'ANTHROPIC_API_KEY=\n')
  d.commit('début')
  const r = d.lancer()
  assert.equal(r.status, 0, r.stderr)
  d.fin()
})

test('un secret retiré reste refusé : il est encore dans l’historique', () => {
  const d = depot()
  d.ecrire('config.ts', `export const cle = '${FAUSSE_CLE_ANTHROPIC}'\n`)
  d.commit('oups')
  d.ecrire('config.ts', 'export const cle = process.env.CLE\n')
  d.commit('retrait')
  const r = d.lancer()
  assert.equal(r.status, 1)
  assert.match(r.stderr, /config\.ts:1 \[commit [0-9a-f]{8}\] — clé Anthropic/)
  d.fin()
})

test('les fichiers interdits sont refusés, même pas encore ajoutés', () => {
  const d = depot()
  d.ecrire('README.md', '# Projet\n')
  d.commit('début')
  d.ecrire('.env', 'X=1\n')
  d.ecrire('memory/profil.md', '- moi\n')
  d.ecrire('data/code.sqlite', 'x')
  const r = d.lancer()
  assert.equal(r.status, 1)
  assert.match(r.stderr, /\.env \[dossier\] — fichier interdit \(variables d’environnement\)/)
  assert.match(r.stderr, /memory\/profil\.md \[dossier\] — fichier interdit \(mémoire personnelle\)/)
  assert.match(r.stderr, /data\/code\.sqlite \[dossier\] — fichier interdit \(base de données\)/)
  d.fin()
})

test('en mode strict, la liste locale est obligatoire et appliquée', () => {
  const d = depot()
  d.ecrire('README.md', 'Fait par Jean Dupont\n')
  d.commit('début')
  assert.equal(d.lancer('--strict').status, 2)
  writeFileSync(join(d.dossier, 'liste-locale.txt'), 'dupont\n')
  const r = d.lancer('--strict', '--liste', join(d.dossier, 'liste-locale.txt'))
  assert.equal(r.status, 1)
  assert.match(r.stderr, /README\.md:1 .* — mot interdit : dupont/)
  d.fin()
})

test('les anciennes icônes de CODE sont reconnues à leur empreinte, pas à leur nom', () => {
  const icone = Buffer.from('<svg>ancienne</svg>')
  const empreintes = new Set([createHash('sha256').update(icone).digest('hex')])
  assert.ok(estAncienneIcone(icone, empreintes))
  assert.ok(!estAncienneIcone(Buffer.from('<svg>nouvelle</svg>'), empreintes))
  assert.ok(!estAncienneIcone(icone), 'pas dans la vraie liste')
})
