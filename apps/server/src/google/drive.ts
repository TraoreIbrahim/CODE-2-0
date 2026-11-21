import type { UiDriveFeuille, UiDriveItem, UiDriveType } from '@code/protocol'
import { formatSize, whenShort } from './gmail.ts'

/**
 * Google Drive : fonctions pures (requêtes de recherche, mise en forme, tableurs).
 * Les appels réseau sont dans tools/drive.ts.
 */

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
  webViewLink?: string
  owners?: { displayName?: string; emailAddress?: string; me?: boolean }[]
  parents?: string[]
  capabilities?: { canAddChildren?: boolean }
}

export const MIME = {
  folder: 'application/vnd.google-apps.folder',
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
} as const

/** Formats Word que `textutil` (macOS) sait lire une fois téléchargés. */
export const WORD_MIMES: Record<string, string> = {
  [MIME.docx]: '.docx',
  'application/msword': '.doc',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'application/vnd.oasis.opendocument.text': '.odt'
}

const FAMILIES: Record<Exclude<UiDriveType, 'autre'>, string[]> = {
  dossier: [MIME.folder],
  document: [MIME.doc, ...Object.keys(WORD_MIMES)],
  tableur: [MIME.sheet, MIME.xlsx, 'application/vnd.ms-excel', 'text/csv', 'application/vnd.oasis.opendocument.spreadsheet'],
  presentation: [MIME.slides, MIME.pptx, 'application/vnd.ms-powerpoint'],
  pdf: [MIME.pdf],
  image: [],
  texte: []
}

export function driveType(mime: string): UiDriveType {
  for (const [type, mimes] of Object.entries(FAMILIES)) if (mimes.includes(mime)) return type as UiDriveType
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('text/') || mime === 'application/json') return 'texte'
  return 'autre'
}

const FORMATS: Record<string, string> = {
  [MIME.folder]: 'Dossier',
  [MIME.doc]: 'Google Docs',
  [MIME.sheet]: 'Google Sheets',
  [MIME.slides]: 'Google Slides',
  'application/vnd.google-apps.form': 'Google Forms',
  'application/vnd.google-apps.drawing': 'Google Drawings',
  'application/vnd.google-apps.shortcut': 'Raccourci',
  [MIME.pdf]: 'PDF',
  [MIME.docx]: 'Word',
  'application/msword': 'Word',
  [MIME.xlsx]: 'Excel',
  'application/vnd.ms-excel': 'Excel',
  [MIME.pptx]: 'PowerPoint',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'text/csv': 'CSV',
  'text/plain': 'Texte',
  'text/markdown': 'Markdown',
  'application/zip': 'Archive ZIP'
}

/** « Google Docs », « PDF », « Image PNG ». */
export function driveFormat(mime: string): string {
  if (FORMATS[mime]) return FORMATS[mime]
  if (mime.startsWith('image/')) return `Image ${mime.slice(6).toUpperCase()}`
  if (mime.startsWith('video/')) return 'Vidéo'
  if (mime.startsWith('audio/')) return 'Audio'
  return 'Fichier'
}

/** Échappe un texte pour une requête Drive (entre apostrophes). */
export const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export type DriveFilter = 'tout' | Exclude<UiDriveType, 'autre' | 'texte'>
export const DRIVE_FILTERS: DriveFilter[] = ['tout', 'document', 'tableur', 'presentation', 'pdf', 'dossier', 'image']

/** Requête `q` de files.list : texte (nom ou contenu), famille de fichiers, dossier ; jamais la corbeille. */
export function buildQuery(o: { requete?: string; type?: DriveFilter; dossier?: string }): string {
  const parts = ['trashed = false']
  const text = o.requete?.trim()
  if (text) parts.push(`(name contains ${quote(text)} or fullText contains ${quote(text)})`)
  if (o.type && o.type !== 'tout') {
    parts.push(o.type === 'image' ? "mimeType contains 'image/'" : `(${FAMILIES[o.type].map((m) => `mimeType = ${quote(m)}`).join(' or ')})`)
  }
  if (o.dossier) parts.push(`${quote(o.dossier)} in parents`)
  return parts.join(' and ')
}

export function driveItem(f: DriveFile, now: number, tz: string): UiDriveItem {
  const owner = f.owners?.[0]
  return {
    id: f.id,
    nom: f.name,
    type: driveType(f.mimeType),
    format: driveFormat(f.mimeType),
    modifie: f.modifiedTime ? whenShort(Date.parse(f.modifiedTime), now, tz) : '',
    ...(f.size ? { taille: formatSize(Number(f.size)) } : {}),
    ...(owner && owner.me === false ? { proprietaire: owner.displayName || owner.emailAddress || 'quelqu’un' } : {}),
    ...(f.webViewLink ? { lien: f.webViewLink } : {})
  }
}

/** Les dossiers d'abord, puis l'ordre de Drive (pertinence ou date). */
export const foldersFirst = (items: UiDriveItem[]) => [...items.filter((i) => i.type === 'dossier'), ...items.filter((i) => i.type !== 'dossier')]

export function itemsForClaude(items: UiDriveItem[]): string {
  return items
    .map((i) => `- [id ${i.id}] ${i.type === 'dossier' ? '📁 ' : ''}« ${i.nom} » · ${i.format}${i.modifie ? ` · modifié ${i.modifie}` : ''}${i.taille ? ` · ${i.taille}` : ''}${i.proprietaire ? ` · partagé par ${i.proprietaire}` : ''}`)
    .join('\n')
}

/**
 * Markdown exporté d'un Google Doc, allégé : images (en base64, parfois des mégaoctets) remplacées par « [image] »,
 * échappements de Google (« 1\\. », « \\- ») retirés.
 */
export function docMarkdown(md: string): string {
  return md
    .replace(/\r/g, '')
    .replace(/^\[[^\]\n]+\]:\s*<?data:[^\n]*$/gm, '')
    .replace(/!\[[^\]\n]*\](\[[^\]\n]*\]|\(data:[^)]*\))/g, '[image]')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Tableurs ──

/** Lettre de colonne : 0 → A, 26 → AA. */
export function columnName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Les premières lignes et colonnes d'un onglet, lignes vides de fin retirées, rectangle complété. */
export function sheetTab(nom: string, values: unknown[][], maxRows: number, maxCols: number): UiDriveFeuille {
  const rows = values.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))))
  while (rows.length && rows[rows.length - 1]!.every((c) => !c.trim())) rows.pop()
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const cols = Math.min(width, maxCols)
  return {
    nom,
    lignes: rows.slice(0, maxRows).map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')),
    totalLignes: rows.length,
    totalColonnes: width
  }
}

export function sheetsForClaude(feuilles: UiDriveFeuille[]): string {
  return feuilles
    .map((f) => {
      const cut = f.lignes.length < f.totalLignes || (f.lignes[0]?.length ?? 0) < f.totalColonnes
      const header = `## Onglet « ${f.nom} » (${f.totalLignes} lignes × ${f.totalColonnes} colonnes${cut ? `, ${f.lignes.length} premières lignes incluses` : ''})`
      const body = f.lignes.map((r, i) => `${i + 1}\t${r.map((c) => c.replace(/[\t\n]+/g, ' ')).join('\t')}`).join('\n')
      return `${header}\n${body || '(onglet vide)'}`
    })
    .join('\n\n')
}

/** CSV simple (RFC 4180 : guillemets, virgules ou points-virgules). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split('\n', 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const endCell = () => {
    row.push(cell.replace(/\r$/, ''))
    cell = ''
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && !cell) quoted = true
    else if (ch === sep) endCell()
    else if (ch === '\n') {
      endCell()
      rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell || row.length) {
    endCell()
    rows.push(row)
  }
  return rows
}

/** Fonctions de Sheets qui vont chercher ou afficher du contenu externe : jamais écrites comme formules par CODE. */
const OUTSIDE = /\b(IMPORT\w*|IMAGE|HYPERLINK|WEBSERVICE)\s*\(/i

/** Cellule de tableur à créer : nombre, formule (sans accès externe) ou texte. */
export function cellValue(v: unknown): { numberValue: number } | { formulaValue: string } | { stringValue: string } | { boolValue: boolean } {
  if (typeof v === 'number' && Number.isFinite(v)) return { numberValue: v }
  if (typeof v === 'boolean') return { boolValue: v }
  const s = v === null || v === undefined ? '' : String(v)
  if (s.startsWith('=') && !OUTSIDE.test(s)) return { formulaValue: s }
  return { stringValue: s }
}

/**
 * Case écrite dans un tableur existant (saisie « comme l'utilisateur ») : une formule qui va chercher dehors
 * est gardée en texte, précédée d'une apostrophe, comme Sheets le fait lui-même.
 */
export function valeurSaisie(v: unknown): string | number | boolean {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  const s = v === null || v === undefined ? '' : String(v)
  return /^\s*[=+\-@]/.test(s) && OUTSIDE.test(s) ? `'${s}` : s
}

/** Corps multipart/related d'un envoi Drive : métadonnées JSON puis contenu. */
export function multipart(meta: object, content: string, type: string, boundary: string): string {
  return [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta), `--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, '', content, `--${boundary}--`, ''].join('\r\n')
}
