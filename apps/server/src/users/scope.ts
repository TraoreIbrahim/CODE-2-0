import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * L'utilisateur pour qui le code tourne en ce moment : posé par la passerelle (message d'un appareil),
 * le planificateur (rappel, tâche, briefing) ou la veille, puis lu par ce qui n'a pas d'autre moyen de le
 * savoir (accès Google des outils Gmail, Agenda, Drive). Hors de ce cadre, aucun utilisateur n'est deviné.
 */

const scope = new AsyncLocalStorage<number>()

export function runAsUser<T>(uid: number, fn: () => T): T {
  return scope.run(uid, fn)
}

/** Lève hors d'un `runAsUser` : mieux vaut une erreur qu'un accès au compte de quelqu'un d'autre. */
export function currentUserId(): number {
  const uid = scope.getStore()
  if (uid === undefined) throw new Error('Aucun utilisateur courant (runAsUser manquant).')
  return uid
}
