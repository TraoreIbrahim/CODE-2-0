import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { excelDate, parseCsv, parseZipListing, parseDateStyles, parseSharedStrings, parseSheet, parseWorkbook, readXlsx } from './sheets.ts'

test('CSV : séparateur deviné, guillemets, retours à la ligne dans un champ', () => {
  const t = parseCsv('﻿Nom;Site;Note\r\n"Bernard; Paul";Vaise;"dit ""oui""\nhier"\r\nDurand;Bellecour;\n')
  assert.deepEqual(t.colonnes, ['Nom', 'Site', 'Note'])
  assert.deepEqual(t.lignes, [
    ['Bernard; Paul', 'Vaise', 'dit "oui"\nhier'],
    ['Durand', 'Bellecour', '']
  ])
  assert.equal(t.total, 2)
  assert.deepEqual(parseCsv('a,b\n1,2').lignes, [['1', '2']])
})

test('CSV : en-têtes vides nommés comme dans un tableur, colonnes vides de la fin retirées', () => {
  const t = parseCsv('Nom,,\nBernard,12,\n')
  assert.deepEqual(t.colonnes, ['Nom', 'B'])
  assert.deepEqual(t.lignes, [['Bernard', '12']])
})

test('Excel : dates reconnues par leur style (intégré ou personnalisé)', () => {
  const styles = `<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="[Red]0.00"/></numFmts>
    <cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`
  assert.deepEqual(parseDateStyles(styles), [false, true, true, false])
  assert.equal(excelDate(46229), '26/07/2026')
  assert.equal(excelDate(46229.5), '26/07/2026 12:00')
})

test('Excel : chaînes partagées, texte enrichi, cellules creuses, nombres et booléens', () => {
  const strings = parseSharedStrings('<sst><si><t>Nom</t></si><si><r><t>Ber</t></r><r><t xml:space="preserve">nard &amp; fils</t></r></si><si><t>Date</t></si></sst>')
  assert.deepEqual(strings, ['Nom', 'Bernard & fils', 'Date'])
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>0.30000000000000004</v></c><c r="C2" s="1"><v>46229</v></c><c r="D2" t="b"><v>1</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Durand</t></is></c></row>
  </sheetData></worksheet>`
  assert.deepEqual(parseSheet(sheet, strings, [false, true]), [
    ['Nom', '', 'Date'],
    ['Bernard & fils', '0,3', '26/07/2026', 'VRAI'],
    [],
    ['Durand']
  ])
})

test('Excel : feuilles du classeur dans l’ordre, avec leur fichier', () => {
  const wb = '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId2"/><sheet name="Résumé &amp; total" sheetId="2" r:id="rId1"/></sheets></workbook>'
  const rels = '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet1.xml"/></Relationships>'
  assert.deepEqual(parseWorkbook(wb, rels), [
    { nom: 'Budget', fichier: 'xl/worksheets/sheet1.xml' },
    { nom: 'Résumé & total', fichier: 'xl/worksheets/sheet2.xml' }
  ])
})

test('Excel : un vrai fichier .xlsx se lit (première feuille, liste des feuilles)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-xlsx-'))
  try {
    const src = join(dir, 'src')
    mkdirSync(join(src, 'xl', '_rels'), { recursive: true })
    mkdirSync(join(src, 'xl', 'worksheets'), { recursive: true })
    writeFileSync(join(src, 'xl', 'workbook.xml'), '<workbook><sheets><sheet name="Équipe" sheetId="1" r:id="rId1"/><sheet name="Projets" sheetId="2" r:id="rId2"/></sheets></workbook>')
    writeFileSync(join(src, 'xl', '_rels', 'workbook.xml.rels'), '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
    writeFileSync(join(src, 'xl', 'sharedStrings.xml'), '<sst><si><t>Nom</t></si><si><t>Heures</t></si><si><t>Bernard</t></si></sst>')
    writeFileSync(join(src, 'xl', 'worksheets', 'sheet1.xml'), '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12.5</v></c></row></sheetData></worksheet>')
    const file = join(dir, 'Budget.xlsx')
    execFileSync('zip', ['-qr', file, 'xl'], { cwd: src })
    assert.deepEqual(await readXlsx(file), { colonnes: ['Nom', 'Heures'], lignes: [['Bernard', '12,5']], total: 1, feuille: 'Équipe', feuilles: ['Équipe', 'Projets'] })
    writeFileSync(join(dir, 'faux.xlsx'), 'pas un zip')
    assert.equal(await readXlsx(join(dir, 'faux.xlsx')), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Archive .zip : fichiers, tailles et dates, sans les dossiers', () => {
  const out = `Archive:  photos.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  10-23-2026 12:47   Photos/
   224037  10-23-2026 12:47   Photos/site 01.jpg
      512  10-24-2026 08:05   lisez-moi.txt
---------                     -------
   224549                     3 files`
  assert.deepEqual(parseZipListing(out), {
    colonnes: ['Fichier', 'Taille', 'Modifié le'],
    lignes: [
      ['Photos/site 01.jpg', '219 Ko', '23/10/2026 12:47'],
      ['lisez-moi.txt', '512 o', '24/10/2026 08:05']
    ],
    total: 2
  })
})
