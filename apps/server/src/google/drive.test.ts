import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildQuery, cellValue, columnName, docMarkdown, driveItem, driveType, foldersFirst, multipart, parseCsv, valeurSaisie, sheetTab, sheetsForClaude } from './drive.ts'

const TZ = 'UTC'

test('requête Drive : texte échappé, famille de fichiers, dossier, jamais la corbeille', () => {
  assert.equal(buildQuery({}), 'trashed = false')
  assert.equal(buildQuery({ requete: "devis d'Hugo" }), "trashed = false and (name contains 'devis d\\'Hugo' or fullText contains 'devis d\\'Hugo')")
  assert.match(buildQuery({ type: 'tableur' }), /mimeType = 'application\/vnd.google-apps.spreadsheet' or .*text\/csv/)
  assert.equal(buildQuery({ type: 'image', dossier: 'abc' }), "trashed = false and mimeType contains 'image/' and 'abc' in parents")
})

test('types et lignes : Google Docs, Excel, image ; propriétaire seulement si partagé', () => {
  assert.equal(driveType('application/vnd.google-apps.document'), 'document')
  assert.equal(driveType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'tableur')
  assert.equal(driveType('image/png'), 'image')
  assert.equal(driveType('application/zip'), 'autre')
  const now = Date.parse('2026-10-30T12:00:00Z')
  const mine = driveItem({ id: '1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-10-30T09:42:00Z', owners: [{ displayName: 'Martin', me: true }] }, now, TZ)
  assert.deepEqual(mine, { id: '1', nom: 'Budget', type: 'tableur', format: 'Google Sheets', modifie: '09:42' })
  const shared = driveItem({ id: '2', name: 'Devis.pdf', mimeType: 'application/pdf', size: '245000', owners: [{ displayName: 'Paul Bernard', me: false }] }, now, TZ)
  assert.equal(shared.proprietaire, 'Paul Bernard')
  assert.equal(shared.taille, '239 Ko')
  assert.deepEqual(foldersFirst([shared, { ...mine, type: 'dossier' }]).map((i) => i.id), ['1', '2'])
})

test('tableur : colonnes A…AA, onglet rogné, lignes vides de fin retirées', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(columnName), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA'])
  const tab = sheetTab('Budget', [['Poste', 'Montant', 'Note'], ['Peinture', '3 840'], [], ['', '']], 10, 2)
  assert.deepEqual(tab, { nom: 'Budget', lignes: [['Poste', 'Montant'], ['Peinture', '3 840']], totalLignes: 2, totalColonnes: 3 })
  assert.match(sheetsForClaude([tab]), /Onglet « Budget » \(2 lignes × 3 colonnes, 2 premières lignes incluses\)\n1\tPoste\tMontant\n2\tPeinture\t3 840/)
})

test('CSV : virgules ou points-virgules, guillemets, retours à la ligne dans une cellule', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","il a dit ""oui"""\n'), [['a', 'b'], ['x, y', 'il a dit "oui"']])
  assert.deepEqual(parseCsv('nom;montant\nBernard;"3 840\n000"'), [['nom', 'montant'], ['Bernard', '3 840\n000']])
})

test('cellules créées : nombres, formules locales, jamais de formule qui va chercher dehors', () => {
  assert.deepEqual(cellValue(12.5), { numberValue: 12.5 })
  assert.deepEqual(cellValue('=SUM(B2:B9)'), { formulaValue: '=SUM(B2:B9)' })
  assert.deepEqual(cellValue('=IMPORTXML("https://pirate.example";"//a")'), { stringValue: '=IMPORTXML("https://pirate.example";"//a")' })
  assert.deepEqual(cellValue('=image("https://x")'), { stringValue: '=image("https://x")' })
  assert.deepEqual(cellValue(null), { stringValue: '' })
})

test('cases écrites dans un tableur existant : formules externes gardées en texte', () => {
  assert.equal(valeurSaisie(3840), 3840)
  assert.equal(valeurSaisie('=SUM(B2:B9)'), '=SUM(B2:B9)')
  assert.equal(valeurSaisie('=IMPORTDATA("https://pirate.example")'), `'=IMPORTDATA("https://pirate.example")`)
  assert.equal(valeurSaisie('+HYPERLINK("https://x";"x")'), `'+HYPERLINK("https://x";"x")`)
  assert.equal(valeurSaisie(null), '')
})

test('envoi multipart : métadonnées puis contenu, séparateurs CRLF', () => {
  const body = multipart({ name: 'Note' }, '# Titre', 'text/markdown', 'XYZ')
  assert.equal(body, '--XYZ\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"Note"}\r\n--XYZ\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n# Titre\r\n--XYZ--\r\n')
})

test('Markdown d’un Google Doc : images base64 retirées, échappements de Google enlevés', () => {
  const md = '# Plan\\-2026\n\n1\\. Peinture ![][image1]\n\n\n\n![logo](data:image/png;base64,AAAA)\n\n[image1]: <data:image/png;base64,iVBORw0KGgo>\n'
  assert.equal(docMarkdown(md), '# Plan-2026\n\n1. Peinture [image]\n\n[image]')
})
