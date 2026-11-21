import { db, hasColumn, userIndex } from '../db.ts'
import { nextOccurrence, type Recurrence } from './rules.ts'

/**
 * Rappels en base : un rappel ponctuel passe « à venir » → « sonne » → « fait » ;
 * un rappel récurrent sonne puis reprend aussitôt sa prochaine échéance.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS rappels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    texte TEXT NOT NULL,
    echeance INTEGER NOT NULL,
    recurrence TEXT,
    etat TEXT NOT NULL DEFAULT 'a_venir' CHECK (etat IN ('a_venir', 'sonne', 'fait', 'supprime')),
    sonne_le INTEGER,
    retard INTEGER NOT NULL DEFAULT 0,
    alerte INTEGER NOT NULL DEFAULT 0,
    -- La phrase dite quand le rappel sonne (« vous avez rendez-vous avec le dentiste à 19 h »).
    annonce TEXT,
    cree INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rappels_echeance ON rappels (etat, echeance);
`)
userIndex('rappels', 'etat, echeance')
// Rappel donné par une autre personne de la maison (« rappelle à Léo… ») : son auteur.
if (!hasColumn('rappels', 'de_la_part')) db.exec('ALTER TABLE rappels ADD COLUMN de_la_part INTEGER REFERENCES utilisateurs(id)')
// État clé-valeur de chaque utilisateur (dernière présence, briefing du jour).
db.exec('CREATE TABLE IF NOT EXISTS etat (utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id), cle TEXT NOT NULL, valeur TEXT NOT NULL, PRIMARY KEY (utilisateur_id, cle))')

const listeners = new Set<(uid: number) => void>()
/** Un rappel de cet utilisateur a été créé, a sonné ou a changé : ses écrans doivent se mettre à jour. */
export function onRappelsChange(fn: (uid: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = (uid: number) => {
  for (const fn of listeners) fn(uid)
}

export type Rappel = {
  id: number
  texte: string
  echeance: number
  recurrence: Recurrence | null
  etat: 'a_venir' | 'sonne' | 'fait' | 'supprime'
  sonneLe: number | null
  retard: boolean
  /** A sonné et attend « fait » ou un report (ponctuel comme récurrent). */
  alerte: boolean
  /** Ce que CODE dit quand il sonne, adressé à la personne ; à défaut, le texte. */
  annonce: string | null
  /** Donné par une autre personne de la maison : son prénom (et son identifiant). */
  de: string | null
  deLaPart: number | null
}

type Row = { id: number; texte: string; echeance: number; recurrence: string | null; etat: Rappel['etat']; sonne_le: number | null; retard: number; alerte: number; annonce: string | null; de_la_part: number | null }

const toRappel = (r: Row): Rappel => ({
  id: r.id,
  texte: r.texte,
  echeance: r.echeance,
  recurrence: r.recurrence ? (JSON.parse(r.recurrence) as Recurrence) : null,
  etat: r.etat,
  sonneLe: r.sonne_le,
  retard: r.retard === 1,
  alerte: r.alerte === 1,
  annonce: r.annonce ?? null,
  de: r.de_la_part ? auteur(r.de_la_part) : null,
  deLaPart: r.de_la_part
})

/** Le prénom de l'auteur d'un rappel donné par quelqu'un d'autre. */
function auteur(uid: number): string {
  const u = q.auteur.get(uid) as { prenom: string; nom: string } | undefined
  return u?.prenom || u?.nom || 'Quelqu’un'
}

const q = {
  insert: db.prepare('INSERT INTO rappels (utilisateur_id, texte, echeance, recurrence, cree, annonce, de_la_part) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  auteur: db.prepare('SELECT prenom, nom FROM utilisateurs WHERE id = ?'),
  get: db.prepare('SELECT * FROM rappels WHERE utilisateur_id = ? AND id = ?'),
  active: db.prepare("SELECT * FROM rappels WHERE utilisateur_id = ? AND etat IN ('a_venir', 'sonne') ORDER BY alerte DESC, echeance"),
  due: db.prepare("SELECT * FROM rappels WHERE utilisateur_id = ? AND etat = 'a_venir' AND echeance <= ? ORDER BY echeance"),
  done: db.prepare("SELECT * FROM rappels WHERE utilisateur_id = ? AND etat = 'fait' AND sonne_le >= ? ORDER BY sonne_le DESC"),
  set: db.prepare('UPDATE rappels SET etat = ?, echeance = ?, sonne_le = ?, retard = ?, alerte = ? WHERE utilisateur_id = ? AND id = ?'),
  getEtat: db.prepare('SELECT valeur FROM etat WHERE utilisateur_id = ? AND cle = ?'),
  setEtat: db.prepare('INSERT INTO etat (utilisateur_id, cle, valeur) VALUES (?, ?, ?) ON CONFLICT (utilisateur_id, cle) DO UPDATE SET valeur = excluded.valeur')
}

/** `deLaPart` : l'auteur, quand une autre personne de la maison le donne (« rappelle à Léo… »). */
export function createRappel(uid: number, texte: string, echeance: number, recurrence: Recurrence | null, annonce: string | null = null, deLaPart: number | null = null): Rappel {
  const { lastInsertRowid } = q.insert.run(uid, texte, echeance, recurrence ? JSON.stringify(recurrence) : null, Date.now(), annonce, deLaPart && deLaPart !== uid ? deLaPart : null)
  changed(uid)
  return getRappel(uid, Number(lastInsertRowid))!
}

/** Un rappel de cet utilisateur (null s'il est à quelqu'un d'autre, ou supprimé). */
export function getRappel(uid: number, id: number): Rappel | null {
  const row = q.get.get(uid, id) as Row | undefined
  return row && row.etat !== 'supprime' ? toRappel(row) : null
}

/** Rappels qui sonnent, puis à venir, par échéance. */
export function activeRappels(uid: number): Rappel[] {
  return (q.active.all(uid) as Row[]).map(toRappel)
}

/** Rappels faits depuis `since` (pour la liste du jour). */
export function doneSince(uid: number, since: number): Rappel[] {
  return (q.done.all(uid, since) as Row[]).map(toRappel)
}

/**
 * Déclenche les rappels arrivés à échéance. Un rappel manqué de plus de `lateMs` (serveur arrêté)
 * sonne quand même, marqué « en retard » ; un récurrent saute directement à sa prochaine occurrence.
 */
export function fireDue(uid: number, now: number, tz: string, lateMs = 5 * 60_000): Rappel[] {
  const fired: Rappel[] = []
  for (const r of (q.due.all(uid, now) as Row[]).map(toRappel)) {
    const retard = now - r.echeance > lateMs
    // Un récurrent reprend aussitôt sa prochaine échéance, mais reste en alerte jusqu'à « fait ».
    if (r.recurrence) q.set.run('a_venir', nextOccurrence(r.recurrence, now, tz), now, retard ? 1 : 0, 1, uid, r.id)
    else q.set.run('sonne', r.echeance, now, retard ? 1 : 0, 1, uid, r.id)
    fired.push(getRappel(uid, r.id)!)
  }
  if (fired.length) changed(uid)
  return fired
}

/** « Fait » : un ponctuel est terminé ; un récurrent garde sa prochaine échéance. */
export function markDone(uid: number, id: number, now: number): Rappel | null {
  const r = getRappel(uid, id)
  if (!r) return null
  q.set.run(r.recurrence ? r.etat : 'fait', r.echeance, r.recurrence ? r.sonneLe : now, 0, 0, uid, id)
  changed(uid)
  return getRappel(uid, id)
}

/** Reporte un rappel. Un récurrent garde sa répétition : le report crée un rappel ponctuel à part. */
export function snooze(uid: number, id: number, at: number): Rappel | null {
  const r = getRappel(uid, id)
  if (!r) return null
  if (r.recurrence) {
    q.set.run(r.etat, r.echeance, r.sonneLe, 0, 0, uid, id)
    return createRappel(uid, r.texte, at, null, r.annonce, r.deLaPart)
  }
  q.set.run('a_venir', at, r.sonneLe, 0, 0, uid, id)
  changed(uid)
  return getRappel(uid, id)
}

export function deleteRappel(uid: number, id: number): void {
  const r = getRappel(uid, id)
  if (!r) return
  q.set.run('supprime', r.echeance, r.sonneLe, 0, 0, uid, id)
  changed(uid)
}

export function getState(uid: number, key: string): string | null {
  return (q.getEtat.get(uid, key) as { valeur: string } | undefined)?.valeur ?? null
}

export function setState(uid: number, key: string, value: string): void {
  q.setEtat.run(uid, key, value)
}
