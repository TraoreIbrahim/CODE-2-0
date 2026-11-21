import { randomBytes } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'

/**
 * Aperçus : pour afficher un fichier dans l'interface, le serveur crée une adresse
 * impossible à deviner (/apercu/<128 bits>), valable 30 minutes, qui ne sert que ce fichier.
 * Le chemin a déjà été vérifié par l'outil (dossiers autorisés).
 */
const TTL_MS = 30 * 60_000
const MAX = 500
const links = new Map<string, { path: string; expires: number }>()

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac'
}

export function previewType(path: string): string | null {
  return TYPES[extname(path).toLowerCase()] ?? null
}

/** Sur le Mac (le pont) : l'aperçu part au serveur après coup ; on ne note ici que le fichier. */
let publier: ((path: string) => string) | null = null
export function setPreviewPublisher(fn: ((path: string) => string) | null): void {
  publier = fn
}

/** Crée l'adresse d'aperçu d'un fichier (chemin réel, déjà confiné). */
export function previewUrl(path: string): string {
  if (publier) return publier(path)
  const now = Date.now()
  for (const [id, l] of links) if (l.expires < now) links.delete(id)
  while (links.size >= MAX) links.delete(links.keys().next().value!)
  const id = randomBytes(16).toString('hex')
  links.set(id, { path, expires: now + TTL_MS })
  return `/apercu/${id}`
}

/** Sert /apercu/<id>, avec les requêtes partielles (Range) pour la vidéo et l'audio. Renvoie false si l'adresse n'est pas une adresse d'aperçu. */
export function servePreview(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const m = pathname.match(/^\/apercu\/([0-9a-f]{32})$/)
  if (!m) return false
  const link = links.get(m[1]!)
  if (!link || link.expires < Date.now()) {
    res.writeHead(404).end()
    return true
  }
  const type = previewType(link.path) ?? 'application/octet-stream'
  let size: number
  try {
    size = statSync(link.path).size
  } catch {
    res.writeHead(404).end()
    return true
  }
  // Les pages locales (Electron, Vite) lisent l'aperçu depuis une autre origine : l'adresse elle-même fait office de clé.
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    // Un SVG pourrait contenir du script : interdit.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
  }
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return true
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    createReadStream(link.path, { start, end }).pipe(res)
    return true
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  createReadStream(link.path).pipe(res)
  return true
}
