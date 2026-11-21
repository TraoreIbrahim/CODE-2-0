import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Conversions pour l'aperçu, avec les outils de macOS : Quick Look (première page de presque tout format),
 * `sips` (HEIC, TIFF, PSD → JPEG, que le navigateur ne lit pas) et `textutil` (Word, RTF → HTML).
 * Les images produites sont gardées un jour dans un dossier temporaire, une par version du fichier.
 */

const run = promisify(execFile)
const DIR = join(tmpdir(), 'code-apercus')
const KEEP_MS = 24 * 3600_000

/** Nom stable d'une conversion : le chemin, la date et la taille du fichier (une nouvelle version, une nouvelle image). */
function key(path: string, kind: string): string {
  const st = statSync(path)
  return createHash('sha256').update(`${kind}\0${path}\0${st.mtimeMs}\0${st.size}`).digest('hex').slice(0, 32)
}

let cleaned = 0
function ready(): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  if (Date.now() - cleaned < 3600_000) return
  cleaned = Date.now()
  for (const name of readdirSync(DIR)) {
    const p = join(DIR, name)
    try {
      if (Date.now() - statSync(p).mtimeMs > KEEP_MS) rmSync(p, { recursive: true, force: true })
    } catch {}
  }
}

/** Image Quick Look (PNG) de la première page ou vue du fichier, ou null si macOS n'en produit pas. */
export async function quickLook(path: string, px = 1600): Promise<string | null> {
  ready()
  const out = join(DIR, `${key(path, `ql${px}`)}.png`)
  if (existsSync(out)) return out
  const work = join(DIR, `${key(path, `ql${px}`)}.tmp`)
  mkdirSync(work, { recursive: true })
  try {
    // Quick Look peut rester bloqué sur certains formats : l'écran n'attend pas plus de 8 secondes.
    await run('qlmanage', ['-t', '-s', String(px), '-o', work, path], { timeout: 8_000 })
    const made = join(work, `${basename(path)}.png`)
    if (!existsSync(made)) return null
    renameSync(made, out)
    return out
  } catch {
    return null
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Copie JPEG d'une image que le navigateur ne lit pas (HEIC, TIFF, PSD…), ou null. */
export async function toJpeg(path: string): Promise<string | null> {
  ready()
  const out = join(DIR, `${key(path, 'jpeg')}.jpg`)
  if (existsSync(out)) return out
  try {
    await run('sips', ['-s', 'format', 'jpeg', '-Z', '3000', path, '--out', out], { timeout: 30_000 })
    return existsSync(out) ? out : null
  } catch {
    return null
  }
}

/** HTML d'un document Word, RTF, OpenDocument… (mise en forme gardée : titres, gras, tableaux), ou null. */
export async function toHtml(path: string): Promise<string | null> {
  try {
    const { stdout } = await run('textutil', ['-convert', 'html', '-stdout', path], { timeout: 20_000, maxBuffer: 30 * 1024 * 1024 })
    return stdout || null
  } catch {
    return null
  }
}
