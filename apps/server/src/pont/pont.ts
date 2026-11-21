import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { PontReponse, ServerPayload } from '@code/protocol'
import { previewType, previewUrl } from '../previews.ts'
import type { Tool, ToolContext, ToolResult } from '../tools/types.ts'

/**
 * Le pont vers le Mac. Le serveur hébergé n'a pas les fichiers du Mac : il demande à l'app CODE du Mac
 * d'exécuter l'outil de fichiers sur place (mêmes dossiers autorisés, même code), puis le Mac renvoie son
 * résultat par HTTP — une connexion WebSocket n'accepte pas plus d'un mégaoctet, une lecture de PDF si.
 * Chaque demande porte un jeton d'envoi à usage unique, impossible à deviner et valable le temps de la
 * demande : il sert à déposer le résultat et les aperçus (PDF, images, vidéos) qui s'affichent ensuite
 * partout comme les autres. Une modification est préparée sur le Mac, validée ici (« oui »), puis faite là-bas.
 */

const DELAI_OUTIL_MS = 60_000
const DELAI_ACTION_MS = 120_000
const MAX_REPONSE = 40 * 1024 * 1024
const MAX_APERCU = 60 * 1024 * 1024
const MAX_APERCUS = 8
/** Les aperçus déposés vivent un peu plus que leur adresse (30 minutes). */
const VIE_APERCU_MS = 35 * 60_000
const DOSSIER = join(tmpdir(), 'code-pont')

type Attente = { connectionId: string; resolve: (r: PontReponse) => void; apercus: number; timer: NodeJS.Timeout }
/** Par jeton d'envoi. */
const attentes = new Map<string, Attente>()
/** Jeton d'envoi d'une demande, par son identifiant (réponse d'erreur par le WebSocket). */
const parId = new Map<string, string>()

export type PontMac = {
  outil(nom: string, input: Record<string, unknown>): Promise<PontReponse>
  executer(cle: string): Promise<PontReponse>
}

/** Le pont d'une connexion Mac : `send` envoie au Mac par sa connexion WebSocket. */
export function pontVers(connectionId: string, send: (payload: ServerPayload) => boolean): PontMac {
  const demander = (payload: (id: string, envoi: string) => ServerPayload, delai: number) =>
    new Promise<PontReponse>((resolve, reject) => {
      const id = randomBytes(8).toString('hex')
      const envoi = randomBytes(16).toString('hex')
      const fin = (r: PontReponse) => {
        clearTimeout(timer)
        attentes.delete(envoi)
        parId.delete(id)
        resolve(r)
      }
      const timer = setTimeout(() => {
        attentes.delete(envoi)
        parId.delete(id)
        reject(new Error('le Mac n’a pas répondu à temps'))
      }, delai)
      attentes.set(envoi, { connectionId, resolve: fin, apercus: 0, timer })
      parId.set(id, envoi)
      if (!send(payload(id, envoi))) {
        clearTimeout(timer)
        attentes.delete(envoi)
        parId.delete(id)
        reject(new Error('le Mac n’est plus connecté'))
      }
    })
  return {
    outil: (outil, input) => demander((id, envoi) => ({ type: 'pont.outil', id, outil, input, envoi }), DELAI_OUTIL_MS),
    executer: (cle) => demander((id, envoi) => ({ type: 'pont.executer', id, cle, envoi }), DELAI_ACTION_MS)
  }
}

/** Le Mac signale par le WebSocket qu'il n'a rien pu faire (pas de pont dans cette version, erreur réseau). */
export function erreurDuMac(connectionId: string, id: string, erreur: string): void {
  const envoi = parId.get(id)
  const a = envoi ? attentes.get(envoi) : undefined
  if (a && a.connectionId === connectionId) a.resolve({ erreur: erreur.slice(0, 300) })
}

/** Lit un corps de requête, en refusant au-delà de `max` octets. */
function limite(max: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length
      if (total > max) cb(new Error('trop gros'))
      else cb(null, chunk)
    }
  })
}

/**
 * POST /pont/<jeton> : la réponse du Mac (JSON). POST /pont/<jeton>/apercu?nom=… : un fichier à afficher,
 * qui reçoit une adresse d'aperçu. Renvoie false si l'adresse n'est pas celle du pont.
 */
export function servePont(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const m = url.pathname.match(/^\/pont\/([0-9a-f]{32})(\/apercu)?$/)
  if (!m) return false
  const a = attentes.get(m[1]!)
  if (req.method !== 'POST' || !a) {
    res.writeHead(404).end()
    return true
  }
  if (m[2]) {
    const nom = (url.searchParams.get('nom') ?? 'apercu').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(-80)
    if (++a.apercus > MAX_APERCUS || !previewType(nom) || Number(req.headers['content-length'] ?? 0) > MAX_APERCU) {
      res.writeHead(413).end()
      return true
    }
    mkdirSync(DOSSIER, { recursive: true })
    const chemin = join(DOSSIER, `${randomBytes(12).toString('hex')}${extname(nom).toLowerCase()}`)
    pipeline(req, limite(MAX_APERCU), createWriteStream(chemin)).then(
      () => {
        setTimeout(() => rmSync(chemin, { force: true }), VIE_APERCU_MS).unref()
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ url: previewUrl(chemin) }))
      },
      () => {
        rmSync(chemin, { force: true })
        res.writeHead(413).end()
      }
    )
    return true
  }
  const morceaux: Buffer[] = []
  pipeline(
    req,
    limite(MAX_REPONSE),
    new Writable({
      write(chunk: Buffer, _enc, cb) {
        morceaux.push(chunk)
        cb()
      }
    })
  ).then(
    () => {
      let r: PontReponse
      try {
        r = JSON.parse(Buffer.concat(morceaux).toString('utf8')) as PontReponse
      } catch {
        res.writeHead(400).end()
        return
      }
      res.writeHead(204).end()
      a.resolve(r)
    },
    () => res.writeHead(413).end()
  )
  return true
}

/**
 * Un outil de fichiers qui passe par le pont quand le serveur n'a pas les fichiers lui-même (`ctx.pont`) :
 * même nom, même description, même validation ; sinon il tourne sur place comme avant.
 */
export function parLePont(tool: Tool): Tool {
  return {
    ...tool,
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      const pont = ctx.pont
      if (!pont) return tool.run(input, ctx)
      let r: PontReponse
      try {
        r = await pont.outil(tool.name, input)
      } catch (err) {
        const pourquoi = err instanceof Error ? err.message : String(err)
        return { content: `Fichiers du Mac injoignables : ${pourquoi}. L’app CODE 2.0 doit être ouverte sur le Mac.`, isError: true, summary: 'Mac injoignable' }
      }
      if (r.erreur || !r.resultat) return { content: `Sur le Mac : ${r.erreur ?? 'pas de réponse'}.`, isError: true, summary: 'Erreur sur le Mac' }
      const conf = r.confirmation
      if (conf) {
        ctx.requestConfirmation(conf.titre, conf.resume, async () => {
          let fait: PontReponse
          try {
            fait = await pont.executer(conf.cle)
          } catch (err) {
            fait = { erreur: err instanceof Error ? err.message : String(err) }
          }
          for (const ligne of fait.journal ?? []) ctx.log(ligne)
          if (fait.erreur) {
            ctx.log(`${conf.titre} : échec sur le Mac — ${fait.erreur}`)
            ctx.announce(`Le Mac n’a pas pu le faire : ${fait.erreur}`)
          } else for (const phrase of fait.annonces ?? []) ctx.announce(phrase)
        })
      }
      return r.resultat as ToolResult
    }
  }
}
