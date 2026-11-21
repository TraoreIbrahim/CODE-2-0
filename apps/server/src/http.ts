import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { OAUTH_PATH } from './connecteurs/mcp.ts'
import { GOOGLE_PATH, serveGoogleReturn } from './google/oauth.ts'
import { finishOAuth } from './connecteurs/registre.ts'
import { serveImport } from './import.ts'
import { serveDocuments } from './documents/http.ts'
import { serveReunions } from './reunions/http.ts'
import { mobileDist } from './paths.ts'
import { servePreview } from './previews.ts'
import { servePont } from './pont/pont.ts'
import { serveMisesAJour } from './mises-a-jour.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.woff2': 'font/woff2'
}

/** Sert la PWA mobile compilée (apps/mobile/dist) et un point de santé. */
export function createHttpServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (servePreview(req, res, url.pathname)) return
    if (servePont(req, res, url)) return
    if (serveMisesAJour(req, res, url.pathname)) return
    if (serveImport(req, res, url.pathname)) return
    if (serveDocuments(req, res, url.pathname)) return
    if (serveReunions(req, res, url.pathname)) return
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (url.pathname === GOOGLE_PATH) {
      void serveGoogleReturn(url, res)
      return
    }
    if (url.pathname === OAUTH_PATH) {
      void serveOAuthReturn(url, res)
      return
    }
    const dist = mobileDist
    if (!existsSync(dist)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('PWA non compilée : lancez « npm run build -w @code/mobile ».')
      return
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
    let file = join(dist, relative)
    if (!file.startsWith(dist + sep) && file !== dist) {
      res.writeHead(403).end()
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // Un fichier absent (morceau d'une version précédente) : une vraie erreur. Renvoyer la page à sa place,
      // le téléphone la garderait comme script et la carte resterait noire.
      if (extname(relative)) {
        res.writeHead(404, { 'Cache-Control': 'no-store' }).end()
        return
      }
      file = join(dist, 'index.html')
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': type,
      // Le moteur de détection de parole (≈ 17 Mo) change rarement : gardé un jour sur le téléphone.
      // Fichiers à empreinte (assets/…-Hk3s.js) : jamais modifiés, gardés un an sans revalidation.
      'Cache-Control':
        file.endsWith('index.html') || file.endsWith('sw.js')
          ? 'no-cache'
          : file.includes(`${sep}assets${sep}`)
            ? 'public, max-age=31536000, immutable'
            : file.includes(`${sep}vad${sep}`)
              ? 'public, max-age=86400'
              : 'public, max-age=3600'
    })
    createReadStream(file).pipe(res)
  })
}

const escape = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

/** Retour du consentement OAuth d'un connecteur : une petite page qui dit si c'est fait. */
async function serveOAuthReturn(url: URL, res: ServerResponse): Promise<void> {
  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code') ?? ''
  const refus = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  const r = refus || !code ? { ok: false, message: refus ? `Autorisation refusée (${refus}).` : 'Réponse incomplète du service.' } : await finishOAuth(state, code)
  res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecteur</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#05080c;color:#cfe9ff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px">` +
      `<div><div style="letter-spacing:.3em;font-size:12px;color:${r.ok ? '#4fd1ff' : '#ff8a7a'}">CONNECTEUR · ${r.ok ? 'CONNECTÉ' : 'ÉCHEC'}</div><p style="max-width:28em">${escape(r.message)}</p></div></body></html>`
  )
}
