import { getState, setState } from '../scheduler/store.ts'
import { googleCompte } from './oauth.ts'

/**
 * Prévenir la veille : en mode test, Google coupe l'accès 7 jours après la connexion. Une fois par heure, CODE
 * regarde l'accès de chacun ; à moins de 24 h de la fin, il le dit une fois (notification, et à voix haute si
 * un écran est ouvert). Repère gardé en base : la connexion déjà annoncée, pour ne le dire qu'une fois.
 */

const STATE_KEY = 'google_alerte'
const EVERY_MS = 3600_000
const VEILLE_MS = 24 * 3600_000

/** L'alerte est due : accès connecté, fin dans moins de 24 h et pas encore passée, connexion pas encore annoncée. */
export function alerteDue(compte: { obtenu: number; expireLe: number } | null, dejaAnnonce: string | null | undefined, now: number): boolean {
  if (!compte) return false
  const restant = compte.expireLe - now
  return restant > 0 && restant <= VEILLE_MS && dejaAnnonce !== String(compte.obtenu)
}

/** Lance la surveillance : premier passage une minute après le démarrage, puis toutes les heures. */
export function startAlerteGoogle(users: () => number[], annoncer: (uid: number, expireLe: number) => void): () => void {
  const tick = () => {
    const now = Date.now()
    for (const uid of users()) {
      const compte = googleCompte(uid, now)
      if (!alerteDue(compte, getState(uid, STATE_KEY), now)) continue
      setState(uid, STATE_KEY, String(compte!.obtenu))
      annoncer(uid, compte!.expireLe)
    }
  }
  const start = setTimeout(tick, 60_000)
  const timer = setInterval(tick, EVERY_MS)
  start.unref()
  timer.unref()
  return () => {
    clearTimeout(start)
    clearInterval(timer)
  }
}
