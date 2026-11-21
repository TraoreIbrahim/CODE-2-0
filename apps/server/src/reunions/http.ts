import type { IncomingMessage, ServerResponse } from 'node:http'
import { MIC_SAMPLE_RATE } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { authenticate } from '../users/users.ts'
import { ajouterSegment } from './store.ts'
import { fileReunions } from './transcrire.ts'

/**
 * `POST /reunions/<numéro>/segments` : un appareil relié envoie un morceau d'une réunion en cours (WAV 16 kHz
 * mono), avec son jeton (`Authorization: Bearer …`), son rang (`X-Rang`) et son instant de début en secondes
 * (`X-Debut`). Le morceau est transcrit aussitôt ; renvoyer le même rang ne le double pas.
 */
const ROUTE = /^\/reunions\/(\d{1,12})\/segments$/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Rang, X-Debut',
  'Access-Control-Max-Age': '600'
}

/** Le plus long morceau accepté : la coupe d'office, avec de la marge. */
export const SEGMENT_MAX_OCTETS = 44 + Math.ceil((codeConfig.voice.reunions.segmentMaxS + 30) * MIC_SAMPLE_RATE * 2)

function repondre(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
}

/** Lit le corps, `max` octets au plus ; null au-delà (la connexion est alors coupée). */
function lireCorps(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > max) {
        resolve(null)
        req.destroy()
      } else parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })
}

/** La route des morceaux de réunion ; `false` si la requête n'en est pas une. */
export function serveReunions(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const m = ROUTE.exec(pathname)
  if (!m) return false
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end()
    return true
  }
  const refuser = (status: number, erreur: string) => {
    req.resume()
    repondre(res, status, { erreur })
  }
  if (req.method !== 'POST') return refuser(405, 'POST seulement.'), true
  const session = authenticate(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
  if (!session) return refuser(401, 'Appareil inconnu ou révoqué.'), true
  const rang = Number(req.headers['x-rang'])
  const debutS = Number(req.headers['x-debut'])
  if (!Number.isInteger(rang) || rang < 0 || rang > 5000 || !Number.isFinite(debutS) || debutS < 0 || debutS > codeConfig.voice.reunions.dureeMaxS) return refuser(400, 'Rang ou instant de début invalide.'), true
  if (Number(req.headers['content-length'] ?? 0) > SEGMENT_MAX_OCTETS) return refuser(413, 'Morceau trop long.'), true
  const id = Number(m[1])
  lireCorps(req, SEGMENT_MAX_OCTETS).then(
    (wav) => {
      if (!wav) return
      const r = ajouterSegment(session.utilisateur.id, id, { rang, debutS, wav })
      if ('erreur' in r) return repondre(res, r.erreur === 'Réunion inconnue.' ? 404 : 400, r)
      fileReunions.planifier(id)
      repondre(res, 201, { rang })
    },
    () => {}
  )
  return true
}
