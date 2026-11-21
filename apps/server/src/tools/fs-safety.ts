import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { codeConfig } from '../../../../config/code.config.ts'

/** Noms français des dossiers macOS (le Finder les traduit, le disque non). */
const ALIASES: Record<string, string> = {
  bureau: 'Desktop',
  'mon bureau': 'Desktop',
  documents: 'Documents',
  'mes documents': 'Documents',
  telechargements: 'Downloads',
  images: 'Pictures',
  photos: 'Pictures',
  musique: 'Music',
  films: 'Movies',
  videos: 'Movies'
}

export function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

/** Dossiers autorisés tels qu'écrits dans la configuration (`CODE_ALLOWED_FOLDERS` pour les tests). */
export function allowedFolderList(): string[] {
  return process.env.CODE_ALLOWED_FOLDERS ? process.env.CODE_ALLOWED_FOLDERS.split(',') : codeConfig.files.allowedFolders
}

/** Dossiers autorisés, résolus (liens symboliques suivis). */
export function allowedRoots(): string[] {
  return allowedFolderList()
    .map(expandHome)
    .filter((p) => existsSync(p))
    .map((p) => realpathSync(p))
}

/** « ~/Desktop/devis.pdf » plutôt que le chemin complet. */
export function display(p: string): string {
  const home = homedir()
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

function inside(root: string, real: string): boolean {
  const rel = relative(root, real)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** « Bureau/Projects » → « ~/Desktop/Projects » ; un chemin absolu ou « ~/… » passe tel quel. */
function translate(input: string): string {
  const raw = input.trim()
  if (raw.startsWith('~') || isAbsolute(raw)) return expandHome(raw)
  const [first, ...rest] = raw.split('/')
  const key = (first ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const alias = ALIASES[key]
  return alias ? join(homedir(), alias, ...rest) : raw
}

/**
 * Le chemin vient du modèle : il n'est pas fiable. On le résout entièrement (liens symboliques
 * compris) et on refuse tout ce qui sort des dossiers autorisés. Renvoie le chemin réel, ou null.
 */
export function confine(input: string): string | null {
  const roots = allowedRoots()
  const raw = translate(input)
  const candidates = isAbsolute(raw) ? [raw] : roots.map((r) => resolve(r, raw))
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const real = realpathSync(candidate)
    if (roots.some((root) => inside(root, real))) return real
  }
  return null
}

/** Un dossier autorisé existant. */
export function confineDir(input: string): string | null {
  const p = confine(input)
  return p && statSync(p).isDirectory() ? p : null
}

/** Nom de fichier ou de dossier sûr : pas de séparateur, pas de fichier caché, pas de « .. ». */
export function safeName(name: string): string | null {
  const n = name.trim()
  if (!n || n.length > 200 || n.includes('/') || n.includes('\\') || n.startsWith('.') || n.includes('\u0000')) return null
  return n
}

/** Si `target` existe déjà, ajoute « (2) », « (3) »… avant l'extension. */
export function uniquePath(target: string): string {
  if (!existsSync(target)) return target
  const dir = dirname(target)
  const name = basename(target)
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let i = 2; ; i++) {
    const next = join(dir, `${stem} (${i})${ext}`)
    if (!existsSync(next)) return next
  }
}

export function deniedMessage(): string {
  return `Introuvable ou hors des dossiers autorisés (${allowedFolderList().join(', ')}). « Bureau » = ~/Desktop, « Téléchargements » = ~/Downloads.`
}
