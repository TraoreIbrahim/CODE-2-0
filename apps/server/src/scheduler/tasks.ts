import { db, userIndex } from '../db.ts'
import { nextOccurrence, type Recurrence } from './rules.ts'

/**
 * Tâches planifiées : une consigne que CODE exécute seul, à l'heure dite, comme si son utilisateur la lui demandait.
 * Chaque exécution garde son résultat (Markdown) pour être relu sur le Mac ou le téléphone.
 * Tâches et exécutions appartiennent à un utilisateur : toute lecture filtre sur lui.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS taches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    titre TEXT NOT NULL,
    consigne TEXT NOT NULL,
    echeance INTEGER,
    recurrence TEXT,
    etat TEXT NOT NULL DEFAULT 'active' CHECK (etat IN ('active', 'pause', 'terminee', 'supprimee')),
    cree INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS taches_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    tache_id INTEGER NOT NULL,
    debut INTEGER NOT NULL,
    fin INTEGER,
    statut TEXT NOT NULL CHECK (statut IN ('en_cours', 'ok', 'erreur')),
    retard INTEGER NOT NULL DEFAULT 0,
    resume TEXT NOT NULL DEFAULT '',
    texte TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS taches_executions_tache ON taches_executions (tache_id, debut);
`)
userIndex('taches', 'etat, echeance')
userIndex('taches_executions', 'statut, fin')

// Exécutions coupées par un arrêt du serveur : elles ne finiront jamais (celles de tous : le serveur entier s'est arrêté).
db.prepare(`UPDATE taches_executions SET statut = 'erreur', fin = debut, resume = 'Interrompue : le serveur s’est arrêté pendant l’exécution.' WHERE utilisateur_id IS NOT NULL AND statut = 'en_cours'`).run()

const listeners = new Set<(uid: number) => void>()
/** Une tâche de cet utilisateur a été créée, modifiée, lancée ou a fini : ses écrans doivent se mettre à jour. */
export function onTachesChange(fn: (uid: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = (uid: number) => {
  for (const fn of listeners) fn(uid)
}

export type Tache = {
  id: number
  titre: string
  consigne: string
  /** Prochaine exécution ; `null` une fois terminée (tâche ponctuelle) ou en pause. */
  echeance: number | null
  recurrence: Recurrence | null
  etat: 'active' | 'pause' | 'terminee' | 'supprimee'
}

export type Execution = {
  id: number
  tacheId: number
  debut: number
  fin: number | null
  statut: 'en_cours' | 'ok' | 'erreur'
  retard: boolean
  resume: string
  texte: string
}

type TacheRow = { id: number; titre: string; consigne: string; echeance: number | null; recurrence: string | null; etat: Tache['etat'] }
type ExecRow = { id: number; tache_id: number; debut: number; fin: number | null; statut: Execution['statut']; retard: number; resume: string; texte: string }

const toTache = (r: TacheRow): Tache => ({ id: r.id, titre: r.titre, consigne: r.consigne, echeance: r.echeance, etat: r.etat, recurrence: r.recurrence ? (JSON.parse(r.recurrence) as Recurrence) : null })
const toExec = (r: ExecRow): Execution => ({ id: r.id, tacheId: r.tache_id, debut: r.debut, fin: r.fin, statut: r.statut, retard: r.retard === 1, resume: r.resume, texte: r.texte })

const q = {
  insert: db.prepare('INSERT INTO taches (utilisateur_id, titre, consigne, echeance, recurrence, cree) VALUES (?, ?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM taches WHERE utilisateur_id = ? AND id = ? AND etat != ?'),
  list: db.prepare(`SELECT * FROM taches WHERE utilisateur_id = ? AND etat != 'supprimee' ORDER BY etat = 'terminee', echeance IS NULL, echeance, id`),
  due: db.prepare(`SELECT * FROM taches WHERE utilisateur_id = ? AND etat = 'active' AND echeance IS NOT NULL AND echeance <= ? ORDER BY echeance`),
  update: db.prepare('UPDATE taches SET titre = ?, consigne = ?, echeance = ?, recurrence = ?, etat = ? WHERE utilisateur_id = ? AND id = ?'),
  start: db.prepare(`INSERT INTO taches_executions (utilisateur_id, tache_id, debut, statut, retard) VALUES (?, ?, ?, 'en_cours', ?)`),
  finish: db.prepare('UPDATE taches_executions SET fin = ?, statut = ?, resume = ?, texte = ? WHERE utilisateur_id = ? AND id = ?'),
  exec: db.prepare('SELECT * FROM taches_executions WHERE utilisateur_id = ? AND id = ?'),
  history: db.prepare('SELECT * FROM taches_executions WHERE utilisateur_id = ? AND tache_id = ? ORDER BY debut DESC, id DESC LIMIT ?'),
  running: db.prepare(`SELECT tache_id FROM taches_executions WHERE utilisateur_id = ? AND statut = 'en_cours'`),
  finishedSince: db.prepare(`SELECT * FROM taches_executions WHERE utilisateur_id = ? AND statut != 'en_cours' AND fin >= ? ORDER BY fin ASC LIMIT 20`)
}

export function createTache(uid: number, titre: string, consigne: string, echeance: number, recurrence: Recurrence | null): Tache {
  const { lastInsertRowid } = q.insert.run(uid, titre, consigne, echeance, recurrence ? JSON.stringify(recurrence) : null, Date.now())
  changed(uid)
  return getTache(uid, Number(lastInsertRowid))!
}

/** Une tâche de cet utilisateur (null si elle est à quelqu'un d'autre ou supprimée). */
export function getTache(uid: number, id: number): Tache | null {
  const row = q.get.get(uid, id, 'supprimee') as TacheRow | undefined
  return row ? toTache(row) : null
}

export function listTaches(uid: number): Tache[] {
  return (q.list.all(uid) as TacheRow[]).map(toTache)
}

function save(uid: number, t: Tache): Tache {
  q.update.run(t.titre, t.consigne, t.echeance, t.recurrence ? JSON.stringify(t.recurrence) : null, t.etat, uid, t.id)
  changed(uid)
  return t
}

export type TachePatch = { titre?: string; consigne?: string; echeance?: number; recurrence?: Recurrence | null; etat?: 'active' | 'pause' }

/**
 * Modifie une tâche. Reprise d'une tâche récurrente dont l'heure est passée pendant la pause :
 * elle repart à sa prochaine occurrence, sans rattraper celles manquées.
 */
export function updateTache(uid: number, id: number, patch: TachePatch, now = Date.now(), tz = 'UTC'): Tache | null {
  const t = getTache(uid, id)
  if (!t) return null
  const next: Tache = { ...t, ...patch, recurrence: patch.recurrence !== undefined ? patch.recurrence : t.recurrence }
  if (patch.etat === 'active' && next.recurrence && (next.echeance === null || next.echeance <= now) && patch.echeance === undefined) {
    next.echeance = nextOccurrence(next.recurrence, now, tz)
  }
  // Une tâche ponctuelle terminée qu'on replanifie redevient active.
  if (patch.echeance !== undefined && t.etat === 'terminee') next.etat = patch.etat ?? 'active'
  return save(uid, next)
}

export function deleteTache(uid: number, id: number): Tache | null {
  const t = getTache(uid, id)
  if (!t) return null
  return save(uid, { ...t, etat: 'supprimee', echeance: null })
}

/** Retard au-delà duquel une exécution est dite « en retard » (Mac éteint ou endormi à l'heure prévue). */
const LATE_MS = 10 * 60_000

/**
 * Tâches à lancer maintenant. Leur échéance avance avant l'exécution (pas de double lancement) :
 * une récurrente passe à sa prochaine occurrence future, sans rattraper les occurrences manquées une à une ;
 * une ponctuelle est terminée.
 */
export function takeDue(uid: number, now: number, tz: string): { tache: Tache; retard: boolean }[] {
  const due = (q.due.all(uid, now) as TacheRow[]).map(toTache)
  return due.map((t) => {
    const retard = now - t.echeance! > LATE_MS
    save(uid, t.recurrence ? { ...t, echeance: nextOccurrence(t.recurrence, now, tz) } : { ...t, etat: 'terminee', echeance: null })
    return { tache: getTache(uid, t.id)!, retard }
  })
}

export function startExecution(uid: number, tacheId: number, now: number, retard: boolean): number {
  const { lastInsertRowid } = q.start.run(uid, tacheId, now, retard ? 1 : 0)
  changed(uid)
  return Number(lastInsertRowid)
}

export function finishExecution(uid: number, id: number, statut: 'ok' | 'erreur', resume: string, texte: string, now = Date.now()): Execution {
  q.finish.run(now, statut, resume, texte, uid, id)
  changed(uid)
  return getExecution(uid, id)!
}

/** Une exécution de cet utilisateur : le lien d'une notification ne montre rien à un autre. */
export function getExecution(uid: number, id: number): Execution | null {
  const row = q.exec.get(uid, id) as ExecRow | undefined
  return row ? toExec(row) : null
}

export function executions(uid: number, tacheId: number, limit = 10): Execution[] {
  return (q.history.all(uid, tacheId, limit) as ExecRow[]).map(toExec)
}

/** Exécutions terminées depuis `since` (point du retour). */
export function finishedSince(uid: number, since: number): Execution[] {
  return (q.finishedSince.all(uid, since) as ExecRow[]).map(toExec)
}

/** Tâches dont une exécution est en cours. */
export function runningTaches(uid: number): Set<number> {
  return new Set((q.running.all(uid) as { tache_id: number }[]).map((r) => r.tache_id))
}
