import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Tableaux à afficher : CSV/TSV, et classeurs Excel (.xlsx) lus sans dépendance (le fichier est une
 * archive zip de XML, extraite avec `unzip` de macOS). Seulement la lecture des valeurs : ni formules, ni mise en forme.
 */

const run = promisify(execFile)

export type Tableau = { colonnes: string[]; lignes: string[][]; total: number; feuille?: string; feuilles?: string[] }

export const MAX_LIGNES = 1000
export const MAX_COLONNES = 40

/** Tableau à partir de lignes brutes : la première sert d'en-têtes, les colonnes vides de la fin sont retirées. */
function toTableau(rows: string[][], extra: Partial<Tableau> = {}): Tableau {
  const filled = rows.filter((r) => r.some((c) => c.trim() !== ''))
  const width = Math.min(MAX_COLONNES, Math.max(0, ...filled.map((r) => lastFilled(r) + 1)))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const [head = [], ...body] = filled
  const colonnes = pad(head).map((c, i) => c.trim() || colName(i))
  return { colonnes, lignes: body.slice(0, MAX_LIGNES).map(pad), total: body.length, ...extra }
}

function lastFilled(r: string[]): number {
  for (let i = r.length - 1; i >= 0; i--) if (r[i]!.trim() !== '') return i
  return -1
}

/** « A », « B »… « AA » : le nom d'une colonne de tableur. */
function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Index (0…) de la colonne d'une référence de cellule (« AB12 » → 27). */
function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// ── CSV / TSV ──────────────────────────────────────────────────────────────

/** Lit un CSV (guillemets, retours à la ligne dans un champ) ; le séparateur est deviné (`;` courant en français). */
export function parseCsv(text: string, sep?: string): Tableau {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? undefined : src.indexOf('\n'))
  const d = sep ?? ([';', '\t', ','] as const).reduce((best, c) => (count(firstLine, c) > count(firstLine, best) ? c : best), ',' as string)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === d) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (rows.length > MAX_LIGNES + 1) break
    } else field += ch
  }
  if (field !== '' || row.length) rows.push([...row, field])
  return toTableau(rows)
}

function count(s: string, c: string): number {
  return s.split(c).length - 1
}

// ── Excel (.xlsx) ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)
  )
}

/** Le texte d'un élément `<si>` ou `<is>` : tous ses `<t>`, mis bout à bout (texte enrichi). */
function runsText(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('')
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1]!))
}

/** Pour chaque style de cellule (`s`), s'il s'agit d'une date. */
export function parseDateStyles(xml: string): boolean[] {
  const custom = new Map<number, string>()
  for (const m of xml.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decode(m[2]!))
  const xfs = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  return [...xfs.matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)].map((m) => {
    const id = Number(m[1])
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true
    // Un format personnalisé avec jour, mois ou année (hors texte entre guillemets et couleurs entre crochets).
    const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '')
    return /[dy]/i.test(code) || /m{3,}/i.test(code)
  })
}

/** Date Excel (jours depuis le 30/12/1899) → « 26/07/2026 », avec l'heure si elle n'est pas minuit. */
export function excelDate(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000))
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  const time = d.getUTCHours() || d.getUTCMinutes() ? ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : ''
  return serial < 1 ? time.trim() || '00:00' : date + time
}

/** Un nombre lisible : sans les queues d'arrondi (0,30000000000000004), virgule décimale. */
function number(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return String(Number(n.toPrecision(12))).replace('.', ',')
}

/** Les lignes d'une feuille (`xl/worksheets/sheetN.xml`), valeurs déjà lisibles. */
export function parseSheet(xml: string, strings: string[], dates: boolean[]): string[][] {
  const rows: string[][] = []
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const at = Number(r[1]!.match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1
    if (at > MAX_LIGNES + 1) break
    const row: string[] = []
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1]
      const col = ref ? colIndex(ref) : row.length
      if (col >= MAX_COLONNES) continue
      const type = attrs.match(/\bt="(\w+)"/)?.[1]
      const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0)
      const inner = c[2] ?? ''
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let text = ''
      if (type === 's') text = strings[Number(v)] ?? ''
      else if (type === 'inlineStr') text = runsText(inner)
      else if (type === 'b') text = v === '1' ? 'VRAI' : 'FAUX'
      else if (type === 'str' || type === 'e') text = decode(v ?? '')
      else if (v !== undefined) text = dates[style] ? excelDate(Number(v)) : number(v)
      row[col] = text
    }
    rows[at] = Array.from(row, (x) => x ?? '')
  }
  return Array.from(rows, (x) => x ?? [])
}

/** Les feuilles du classeur, dans l'ordre, avec le fichier XML de chacune. */
export function parseWorkbook(workbook: string, rels: string): { nom: string; fichier: string }[] {
  const targets = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1]
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }
  return [...workbook.matchAll(/<sheet\s[^>]*>/g)].flatMap((m) => {
    const nom = decode(m[0].match(/\bname="([^"]*)"/)?.[1] ?? '')
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1]
    const target = rid ? targets.get(rid) : undefined
    return target ? [{ nom, fichier: `xl/${target}` }] : []
  })
}

async function entry(path: string, name: string): Promise<string> {
  try {
    const { stdout } = await run('unzip', ['-p', path, name], { timeout: 15_000, maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch {
    return ''
  }
}

/** La première feuille d'un classeur .xlsx, ou null si le fichier ne se lit pas ainsi. */
export async function readXlsx(path: string): Promise<Tableau | null> {
  const [workbook, rels] = await Promise.all([entry(path, 'xl/workbook.xml'), entry(path, 'xl/_rels/workbook.xml.rels')])
  const sheets = parseWorkbook(workbook, rels)
  const first = sheets[0]
  if (!first) return null
  const [strings, styles, sheet] = await Promise.all([entry(path, 'xl/sharedStrings.xml'), entry(path, 'xl/styles.xml'), entry(path, first.fichier)])
  if (!sheet) return null
  const rows = parseSheet(sheet, parseSharedStrings(strings), parseDateStyles(styles))
  return toTableau(rows, { feuille: first.nom, ...(sheets.length > 1 ? { feuilles: sheets.map((s) => s.nom) } : {}) })
}

// ── Archive .zip : son contenu ─────────────────────────────────────────────

/** Le contenu d'une sortie `unzip -l` : nom, taille, date de chaque fichier (les dossiers sont omis). */
export function parseZipListing(out: string): Tableau {
  const rows: string[][] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2})\s+(.+)$/)
    if (!m || m[6]!.endsWith('/')) continue
    const n = Number(m[1])
    const taille = n < 1024 ? `${n} o` : n < 1024 ** 2 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} Mo`
    rows.push([m[6]!, taille, `${m[3]}/${m[2]}/${m[4]} ${m[5]}`])
  }
  return toTableau([['Fichier', 'Taille', 'Modifié le'], ...rows])
}

export async function readZip(path: string): Promise<Tableau | null> {
  try {
    const { stdout } = await run('unzip', ['-l', path], { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 })
    return parseZipListing(stdout)
  } catch {
    return null
  }
}

