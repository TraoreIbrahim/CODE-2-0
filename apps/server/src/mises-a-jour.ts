import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dataDir } from './paths.ts'
import { authenticate } from './users/users.ts'

/**
 * Les versions de l'app Mac, servies par le serveur : l'app y lit `derniere.json`, télécharge le zip de la
 * nouvelle version en arrière-plan et propose « Redémarrer pour mettre à jour ». Le DMG sert à une première
 * installation (`/telecharger/mac`). Seul le propriétaire publie (`scripts/publier-mac.mjs`, avec le jeton de
 * son app Mac) ; la publication du manifeste, en dernier, efface les fichiers des versions précédentes.
 */

export type ManifesteMac = {
  version: string
  publiee: string
  zip: { fichier: string; sha512: string; taille: number }
  dmg?: { fichier: string; taille: number }
}

const DOSSIER = join(dataDir, 'mises-a-jour', 'mac')
const MANIFESTE = 'derniere.json'
const NOM = /^[A-Za-z0-9][\w.-]{0,100}\.(zip|dmg)$/
const VERSION = /^\d+\.\d+\.\d+$/
const MAX_OCTETS = 600 * 1024 * 1024

function proprietaire(req: IncomingMessage): boolean {
  const jeton = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  return !!jeton && authenticate(jeton)?.utilisateur.proprietaire === true
}

export function lireManifeste(dossier = DOSSIER): ManifesteMac | null {
  try {
    return JSON.parse(readFileSync(join(dossier, MANIFESTE), 'utf8')) as ManifesteMac
  } catch {
    return null
  }
}

/** Un manifeste reçu : bien formé, et ses fichiers déjà déposés. */
function valide(m: unknown, dossier: string): m is ManifesteMac {
  const v = m as ManifesteMac
  const present = (f: unknown) => typeof f === 'string' && NOM.test(f) && existsSync(join(dossier, f))
  return (
    !!v &&
    typeof v.version === 'string' &&
    VERSION.test(v.version) &&
    !!v.zip &&
    present(v.zip.fichier) &&
    typeof v.zip.sha512 === 'string' &&
    /^[0-9a-f]{128}$/.test(v.zip.sha512) &&
    (v.dmg === undefined || present(v.dmg.fichier))
  )
}

function envoyer(res: ServerResponse, chemin: string, type: string, nom?: string): void {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': statSync(chemin).size,
    'Cache-Control': 'no-store',
    ...(nom ? { 'Content-Disposition': `attachment; filename="${nom}"` } : {})
  })
  createReadStream(chemin).pipe(res)
}

/** Les routes des mises à jour ; `false` si la requête n'en est pas une. */
export function serveMisesAJour(req: IncomingMessage, res: ServerResponse, pathname: string, opts: { dossier?: string; estProprietaire?: (req: IncomingMessage) => boolean } = {}): boolean {
  const dossier = opts.dossier ?? DOSSIER
  const estProprietaire = opts.estProprietaire ?? proprietaire

  if (pathname === '/telecharger/mac') {
    const dmg = lireManifeste(dossier)?.dmg
    if (!dmg || !existsSync(join(dossier, dmg.fichier))) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Aucune version de l’app Mac publiée.')
    else envoyer(res, join(dossier, dmg.fichier), 'application/x-apple-diskimage', dmg.fichier)
    return true
  }

  const m = pathname.match(/^\/mises-a-jour\/mac\/([^/]+)$/)
  if (!m) return false
  const nom = m[1]!
  if (nom !== MANIFESTE && !NOM.test(nom)) {
    res.writeHead(404).end()
    return true
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const chemin = join(dossier, nom)
    if (!existsSync(chemin)) res.writeHead(404).end()
    else envoyer(res, chemin, nom === MANIFESTE ? 'application/json' : nom.endsWith('.zip') ? 'application/zip' : 'application/x-apple-diskimage')
    return true
  }

  if (req.method !== 'PUT') {
    res.writeHead(405).end()
    return true
  }
  if (!estProprietaire(req)) {
    res.writeHead(401).end()
    return true
  }
  mkdirSync(dossier, { recursive: true })
  const plage = req.headers['content-range']
  if (plage && nom !== MANIFESTE) return deposerMorceau(req, res, dossier, nom, String(plage))
  const provisoire = join(dossier, `.${nom}.${process.pid}.part`)
  let total = 0
  const limite = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length
      cb(total > MAX_OCTETS ? new Error('trop gros') : null, chunk)
    }
  })
  const morceaux: Buffer[] = []
  const destination =
    nom === MANIFESTE
      ? new Transform({
          transform(chunk: Buffer, _enc, cb) {
            morceaux.push(chunk)
            cb()
          }
        })
      : createWriteStream(provisoire)
  pipeline(req, limite, destination).then(
    () => {
      if (nom !== MANIFESTE) {
        renameSync(provisoire, join(dossier, nom))
        return void res.writeHead(204).end()
      }
      let manifeste: unknown
      try {
        manifeste = JSON.parse(Buffer.concat(morceaux).toString('utf8'))
      } catch {
        return void res.writeHead(400).end()
      }
      if (!valide(manifeste, dossier)) return void res.writeHead(422, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Manifeste invalide ou fichiers absents.')
      writeFileSync(join(dossier, MANIFESTE), JSON.stringify(manifeste, null, 2))
      // Les versions précédentes ne servent plus.
      const garder = new Set([MANIFESTE, manifeste.zip.fichier, manifeste.dmg?.fichier])
      for (const f of readdirSync(dossier)) if (!garder.has(f)) rmSync(join(dossier, f), { force: true })
      res.writeHead(204).end()
    },
    () => {
      rmSync(provisoire, { force: true })
      res.writeHead(413).end()
    }
  )
  return true
}

/**
 * Un fichier envoyé par morceaux (`Content-Range: bytes début-fin/total`) : le proxy de l'hébergeur coupe
 * une requête trop longue, et la connexion du Mac est lente. Chaque morceau s'ajoute au fichier en cours ;
 * `bytes * /total` (sans espace) demande où en est l'envoi, pour reprendre après une coupure.
 */
function deposerMorceau(req: IncomingMessage, res: ServerResponse, dossier: string, nom: string, plage: string): true {
  const enCours = join(dossier, `.${nom}.part`)
  const recu = existsSync(enCours) ? statSync(enCours).size : 0
  const repondre = (code: number) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify({ recu: existsSync(enCours) ? statSync(enCours).size : 0 }))
  const etat = plage.match(/^bytes \*\/(\d+)$/)
  if (etat) {
    req.resume()
    repondre(200)
    return true
  }
  const m = plage.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
  const [debut, fin, total] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [NaN, NaN, NaN]
  if (!m || fin < debut || fin >= total || total > MAX_OCTETS) {
    req.resume()
    res.writeHead(416).end()
    return true
  }
  // Un morceau ne se place qu'à la suite de ce qui est déjà reçu (0 : on recommence).
  if (debut !== 0 && debut !== recu) {
    req.resume()
    repondre(409)
    return true
  }
  let longueur = 0
  const compte = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      longueur += chunk.length
      cb(longueur > fin - debut + 1 ? new Error('morceau trop long') : null, chunk)
    }
  })
  pipeline(req, compte, createWriteStream(enCours, { flags: debut === 0 ? 'w' : 'a' })).then(
    () => {
      if (longueur !== fin - debut + 1) {
        // Morceau incomplet (connexion coupée) : on revient au dernier morceau entier.
        truncateSync(enCours, debut)
        return repondre(409)
      }
      if (fin + 1 < total) return repondre(202)
      renameSync(enCours, join(dossier, nom))
      res.writeHead(204).end()
    },
    () => {
      if (existsSync(enCours)) truncateSync(enCours, debut)
      repondre(409)
    }
  )
  return true
}
