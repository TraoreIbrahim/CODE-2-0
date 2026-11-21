import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { documentView, safeHtml } from './files.ts'

const dir = mkdtempSync(join(tmpdir(), 'code-vue-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const file = (name: string, content: string) => {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

test('Markdown : rendu mis en forme, texte complet', async () => {
  const v = await documentView(file('CLAUDE.md', '# Soft\n\n- un\n- deux\n'))
  assert.equal(v.media, 'markdown')
  assert.equal(v.texte, '# Soft\n\n- un\n- deux\n')
})

test('CSV : un tableau', async () => {
  const v = await documentView(file('clients.csv', 'Nom;Site\nBernard;Vaise\n'))
  assert.equal(v.media, 'tableau')
  assert.deepEqual(v.tableau, { colonnes: ['Nom', 'Site'], lignes: [['Bernard', 'Vaise']], total: 1 })
})

test('Code : affiché comme code ; texte inconnu mais lisible : texte', async () => {
  assert.equal((await documentView(file('index.ts', 'export const a = 1\n'))).media, 'code')
  assert.equal((await documentView(file('notes.txt', 'Bonjour'))).media, 'texte')
})

test('Page web : sans script, sans lien, sans chargement extérieur', async () => {
  const v = await documentView(file('page.html', '<html><head><title>x</title></head><body onload="steal()"><a href="https://x.example">lien</a><script>alert(1)</script><img src="https://x.example/p.gif"></body></html>'))
  assert.equal(v.media, 'page')
  assert.doesNotMatch(v.html!, /<script|onload|\shref=/i)
  assert.match(v.html!, /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/)
  // Sans <head> : la règle passe en tête quand même.
  assert.match(safeHtml('<p>Bonjour</p>'), /^<meta http-equiv="Content-Security-Policy"/)
  assert.doesNotMatch(safeHtml('<meta http-equiv="refresh" content="0;url=https://x.example"><p>a</p>'), /refresh/)
})

// La conversion passe par `textutil`, propre à macOS ; ailleurs le document s'affiche en texte.
test('Document Word ou RTF : converti en page (mise en forme gardée)', { skip: process.platform !== 'darwin' && 'textutil : macOS seulement' }, async () => {
  const v = await documentView(file('note.rtf', '{\\rtf1\\ansi {\\b Note de cadrage}\\par Objet : refonte.}'))
  assert.equal(v.media, 'page')
  assert.match(v.html!, /Note de cadrage/)
  assert.match(v.html!, /Content-Security-Policy/)
})

test('Fichier vide : dit qu’il est vide', async () => {
  const v = await documentView(file('vide.md', '   \n'))
  assert.equal(v.texte, '(Document vide.)')
})
