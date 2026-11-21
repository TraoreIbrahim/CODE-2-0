import { timingSafeEqual } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { dataDir, dbPath, memoryDir } from './paths.ts'

/**
 * Transfert des données du Mac vers un serveur hébergé : la base (empreinte vocale comprise) et la mémoire
 * arrivent par `PUT /import/<fichier>` (jeton CODE_IMPORT_TOKEN, posé le temps du transfert), puis
 * `POST /import/terminer` redémarre le serveur, qui les met en place avant d'ouvrir la base.
 */
const pendingDir = join(dataDir, 'import')
const MEMORY = /^memory\/[\w.-]+\.md$/
const MAX_BYTES = 200 * 1024 * 1024

/** Au démarrage, avant la base : remplace les données par celles reçues. */
export function applyPendingImport(): void {
  if (!existsSync(join(pendingDir, 'pret'))) return
  const db = join(pendingDir, 'code.db')
  if (existsSync(db)) {
    for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
    renameSync(db, dbPath)
  }
  const memory = join(pendingDir, 'memory')
  if (existsSync(memory)) for (const f of readdirSync(memory)) renameSync(join(memory, f), join(memoryDir, f))
  rmSync(pendingDir, { recursive: true, force: true })
  console.log('[code] Données importées du Mac mises en place.')
}

function authorized(req: IncomingMessage): boolean {
  const expected = process.env.CODE_IMPORT_TOKEN ?? ''
  const given = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (expected.length < 32 || given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

/** Les routes d'import ; `false` si la requête n'en est pas une. */
export function serveImport(req: IncomingMessage, res: ServerResponse, pathname: string, restart: () => void = () => process.exit(0)): boolean {
  if (!pathname.startsWith('/import/')) return false
  if (!authorized(req)) {
    res.writeHead(404).end()
    return true
  }
  const name = pathname.slice('/import/'.length)
  if (req.method === 'POST' && name === 'terminer') {
    mkdirSync(pendingDir, { recursive: true })
    createWriteStream(join(pendingDir, 'pret')).end()
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Redémarrage pour mettre les données en place.\n')
    // Le conteneur redémarre seul (politique de redémarrage de Coolify).
    setTimeout(restart, 500)
    return true
  }
  if (req.method !== 'PUT' || !(name === 'code.db' || MEMORY.test(name))) {
    res.writeHead(400).end()
    return true
  }
  if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) {
    res.writeHead(413).end()
    return true
  }
  const target = join(pendingDir, name)
  mkdirSync(join(target, '..'), { recursive: true })
  pipeline(req, createWriteStream(target)).then(
    () => res.writeHead(200).end(),
    () => res.writeHead(500).end()
  )
  return true
}
