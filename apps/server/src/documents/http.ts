import type { IncomingMessage, ServerResponse } from 'node:http'
import { authenticate } from '../users/users.ts'
import { DOCUMENT_MAX_OCTETS, DOCUMENT_TYPES, enregistrerDocument } from './store.ts'

/**
 * `POST /documents` : un appareil relié envoie un papier (photo JPEG ou PNG, PDF), avec son jeton
 * (`Authorization: Bearer …`) et son nom (`X-Nom`, encodé). Réponse : `{ id, nom }` ; l'appareil
 * demande ensuite à l'assistant de le lire (message `document`).
 */
export const DOCUMENTS_PATH = '/documents'

/** L'app de bureau (Electron, Vite) envoie depuis une autre origine : le jeton fait foi, pas l'origine. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Nom',
  'Access-Control-Max-Age': '600'
}

/** Au-delà, un envoi refusé n'est plus lu : la connexion est coupée. */
const JETE_MAX = DOCUMENT_MAX_OCTETS + 1024 * 1024

function repondre(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
}

/**
 * Lit le corps, au plus `max` octets gardés ; null au-delà. Le reste est lu et jeté jusqu'au bout (l'appareil
 * reçoit ainsi la réponse, pas une connexion coupée en pleine écriture), sauf au-delà de JETE_MAX.
 */
function lireCorps(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > JETE_MAX) req.destroy(new Error('Envoi trop long.'))
      else if (total <= max) parts.push(c)
    })
    req.on('end', () => resolve(total > max ? null : Buffer.concat(parts)))
    req.on('error', reject)
  })
}

/** Refus avant lecture : le corps est jeté, puis la réponse part. */
function refuser(req: IncomingMessage, res: ServerResponse, status: number, erreur: string): void {
  lireCorps(req, 0).then(
    () => repondre(res, status, { erreur }),
    () => {}
  )
}

function nomDe(req: IncomingMessage): string {
  const brut = String(req.headers['x-nom'] ?? '')
  try {
    return decodeURIComponent(brut)
  } catch {
    return brut
  }
}

/** La route des documents ; `false` si la requête n'en est pas une. */
export function serveDocuments(req: IncomingMessage, res: ServerResponse, pathname: string, now = () => Date.now()): boolean {
  if (pathname !== DOCUMENTS_PATH) return false
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end()
    return true
  }
  if (req.method !== 'POST') {
    refuser(req, res, 405, 'POST seulement.')
    return true
  }
  const session = authenticate(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
  if (!session) {
    refuser(req, res, 401, 'Appareil inconnu ou révoqué.')
    return true
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  if (!DOCUMENT_TYPES[type]) {
    refuser(req, res, 415, 'Une photo (JPEG, PNG, WebP) ou un PDF.')
    return true
  }
  // Annoncé trop lourd : coupé tout de suite, sans rien lire.
  if (Number(req.headers['content-length'] ?? 0) > JETE_MAX) {
    res.writeHead(413, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' }).end(JSON.stringify({ erreur: 'Fichier trop lourd : 15 Mo au plus.' }), () => req.destroy())
    return true
  }
  lireCorps(req, DOCUMENT_MAX_OCTETS).then(
    (data) => {
      if (!data) return repondre(res, 413, { erreur: 'Fichier trop lourd : 15 Mo au plus.' })
      if (!data.length) return repondre(res, 400, { erreur: 'Fichier vide.' })
      const d = enregistrerDocument(session.utilisateur.id, { nom: nomDe(req), type, data }, now())
      repondre(res, 201, { id: d.id, nom: d.nom })
    },
    () => {}
  )
  return true
}
