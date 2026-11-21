import { ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { PontReponse } from '@code/protocol'
import { executerAction, executerOutil } from '../../../server/src/pont/execution-mac.ts'

/**
 * Le pont, côté app de bureau : quand le serveur hébergé demande un outil de fichiers, la page le passe ici ; le
 * processus principal l'exécute sur cet ordinateur (dossiers autorisés seulement) et renvoie le résultat au
 * serveur par HTTP, avec le jeton d'envoi de la demande. Les aperçus (PDF, images, vidéos) y sont déposés.
 */

/** Au-delà, pas d'aperçu à distance : le fichier reste lisible et s'ouvre sur l'ordinateur. */
const MAX_APERCU = 60 * 1024 * 1024
const JETON = /^[0-9a-f]{32}$/

export function installerPont(serverUrl: string): void {
  const ws = new URL(serverUrl)
  const http = `${ws.protocol === 'wss:' ? 'https:' : 'http:'}//${ws.host}`

  const poster = async (envoi: string, r: PontReponse) => {
    const res = await fetch(`${http}/pont/${envoi}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
    if (!res.ok) throw new Error(`le serveur a refusé la réponse (${res.status})`)
  }

  const deposer = (envoi: string) => async (chemin: string) => {
    if ((await stat(chemin)).size > MAX_APERCU) return null
    const res = await fetch(`${http}/pont/${envoi}/apercu?nom=${encodeURIComponent(basename(chemin))}`, { method: 'POST', body: await readFile(chemin) })
    if (!res.ok) return null
    return ((await res.json()) as { url?: string }).url ?? null
  }

  ipcMain.handle('pont:outil', async (_e, envoi: unknown, outil: unknown, input: unknown) => {
    if (typeof envoi !== 'string' || !JETON.test(envoi) || typeof outil !== 'string' || !input || typeof input !== 'object') throw new Error('demande invalide')
    await poster(envoi, await executerOutil(outil, input as Record<string, unknown>, deposer(envoi)))
  })
  ipcMain.handle('pont:executer', async (_e, envoi: unknown, cle: unknown) => {
    if (typeof envoi !== 'string' || !JETON.test(envoi) || typeof cle !== 'string') throw new Error('demande invalide')
    await poster(envoi, await executerAction(cle))
  })
}
