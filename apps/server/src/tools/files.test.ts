import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confine } from './files.ts'

test('refuse tout chemin hors des dossiers autorisés', () => {
  assert.equal(confine('/etc/passwd'), null)
  assert.equal(confine('../../../../etc/passwd'), null)
  assert.equal(confine('~/Documents/../../../etc/passwd'), null)
  assert.equal(confine('~/.ssh/id_rsa'), null)
  assert.equal(confine('/Library/Keychains'), null)
})

test('un fichier inexistant est refusé', () => {
  assert.equal(confine('~/Documents/ce-fichier-n-existe-pas-1234.pdf'), null)
})

test('« Bureau » et « Téléchargements » désignent Desktop et Downloads', () => {
  const desktop = confine('~/Desktop')
  assert.ok(desktop, 'le Bureau doit être autorisé')
  assert.equal(confine('Bureau'), desktop)
  assert.equal(confine('bureau'), desktop)
  const downloads = confine('~/Downloads')
  if (downloads) assert.equal(confine('Téléchargements'), downloads)
})
