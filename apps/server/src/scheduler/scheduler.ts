import { localDay } from '../google/calendar.ts'
import { briefingDue } from './rules.ts'
import { fireDue, getState, setState, type Rappel } from './store.ts'
import { takeDue, type Tache } from './tasks.ts'

/** Vérifie les échéances toutes les 10 secondes : robuste à la mise en veille du Mac, sans minuterie longue. */
const TICK_MS = 10_000

/** Ce que le planificateur sait de chaque utilisateur : son fuseau et l'heure de son briefing. */
export type ScheduledUser = { id: number; tz: string; briefing: string }

export type SchedulerHooks = {
  users(): ScheduledUser[]
  /** Planificateur suspendu pour lui (arrêt d'urgence) : rien ne sonne, ses rappels sonneront à la reprise. */
  halted(uid: number): boolean
  fire(uid: number, rappels: Rappel[]): void
  /** Lance son briefing ; `false` s'il faut réessayer plus tard (aucun écran connecté, conversation en cours). */
  briefing(uid: number): boolean
  /** Le briefing attend un écran : de quoi prévenir son téléphone (une fois par jour, au choix de la session). */
  briefingWaiting?(uid: number): void
  /** Une de ses tâches planifiées arrive à échéance (son échéance suivante est déjà calculée). */
  runTask?(uid: number, tache: Tache, retard: boolean): void
  /** À chaque passage : de quoi proposer d'enregistrer une réunion de l'agenda qui commence. */
  reunions?(uid: number, now: number): void
}

/**
 * Planificateur : rappels et tâches à l'heure, briefing du matin (docs/SPEC.md, « Planificateur »),
 * pour chaque utilisateur à son heure. Un utilisateur en échec n'empêche pas les autres.
 */
export function startScheduler(hooks: SchedulerHooks): () => void {
  const tick = () => {
    const now = Date.now()
    for (const u of hooks.users()) {
      if (hooks.halted(u.id)) continue
      try {
        tickUser(hooks, u, now)
      } catch (err) {
        console.error(`[planificateur] utilisateur ${u.id} :`, err)
      }
    }
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref()
  return () => clearInterval(timer)
}

function tickUser(hooks: SchedulerHooks, { id: uid, tz, briefing }: ScheduledUser, now: number): void {
  // CODE_BRIEFING_AT : autre heure de briefing, pour tous (tests de bout en bout).
  const briefingAt = process.env.CODE_BRIEFING_AT || briefing
  const fired = fireDue(uid, now, tz)
  if (fired.length) hooks.fire(uid, fired)
  if (hooks.runTask) for (const { tache, retard } of takeDue(uid, now, tz)) hooks.runTask(uid, tache, retard)
  hooks.reunions?.(uid, now)
  if (briefingDue(now, tz, briefingAt, getState(uid, 'briefing_matin'))) {
    if (hooks.briefing(uid)) setState(uid, 'briefing_matin', localDay(now, tz))
    else hooks.briefingWaiting?.(uid)
  }
}
