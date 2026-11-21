import type { EcheanceCategorie, EcheanceRecurrence } from '@code/protocol'
import { zonedTime } from '../google/calendar.ts'
import { db, userIndex } from '../db.ts'
import { createRappel, deleteRappel } from '../scheduler/store.ts'
import { ajouterJours, dateParlee, montantLisible, suivante } from './regles.ts'

/**
 * L'échéancier en base. Chaque échéance à régler a son rappel (quelques jours avant, à 9 h) : c'est le
 * planificateur des rappels qui prévient, à la voix, sur les écrans et sur le téléphone. Une échéance
 * récurrente réglée reste dans l'historique, et la suivante est créée aussitôt.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS echeances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    titre TEXT NOT NULL,
    categorie TEXT NOT NULL DEFAULT 'autre',
    -- Jour local « AAAA-MM-JJ ».
    date TEXT NOT NULL,
    -- Jour du mois d'origine : une échéance du 31 revient le 31 quand le mois l'a.
    jour INTEGER NOT NULL,
    montant REAL,
    devise TEXT,
    recurrence TEXT,
    -- Jours de préavis du rappel (0 : le jour même).
    prevenir INTEGER NOT NULL DEFAULT 3,
    etat TEXT NOT NULL DEFAULT 'a_regler' CHECK (etat IN ('a_regler', 'regle', 'supprime')),
    regle_le INTEGER,
    note TEXT,
    rappel_id INTEGER,
    cree INTEGER NOT NULL
  );
`)
userIndex('echeances', 'etat, date')

const listeners = new Set<(uid: number) => void>()
/** Une échéance de cet utilisateur a été ajoutée, modifiée ou réglée : ses écrans doivent se mettre à jour. */
export function onEcheancesChange(fn: (uid: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = (uid: number) => {
  for (const fn of listeners) fn(uid)
}

/** Heure du rappel d'une échéance, le jour du préavis. */
const HEURE_RAPPEL = 9 * 60

export type Echeance = {
  id: number
  titre: string
  categorie: EcheanceCategorie
  date: string
  jour: number
  montant: number | null
  devise: string | null
  recurrence: EcheanceRecurrence | null
  prevenir: number
  etat: 'a_regler' | 'regle' | 'supprime'
  regleLe: number | null
  note: string | null
  rappelId: number | null
}

type Row = { id: number; titre: string; categorie: string; date: string; jour: number; montant: number | null; devise: string | null; recurrence: string | null; prevenir: number; etat: Echeance['etat']; regle_le: number | null; note: string | null; rappel_id: number | null }

const toEcheance = (r: Row): Echeance => ({
  id: r.id,
  titre: r.titre,
  categorie: r.categorie as EcheanceCategorie,
  date: r.date,
  jour: r.jour,
  montant: r.montant,
  devise: r.devise,
  recurrence: (r.recurrence as EcheanceRecurrence | null) ?? null,
  prevenir: r.prevenir,
  etat: r.etat,
  regleLe: r.regle_le,
  note: r.note,
  rappelId: r.rappel_id
})

const q = {
  insert: db.prepare('INSERT INTO echeances (utilisateur_id, titre, categorie, date, jour, montant, devise, recurrence, prevenir, note, cree) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM echeances WHERE utilisateur_id = ? AND id = ?'),
  aRegler: db.prepare("SELECT * FROM echeances WHERE utilisateur_id = ? AND etat = 'a_regler' ORDER BY date, id"),
  reglees: db.prepare("SELECT * FROM echeances WHERE utilisateur_id = ? AND etat = 'regle' AND regle_le >= ? ORDER BY regle_le DESC"),
  update: db.prepare('UPDATE echeances SET titre = ?, categorie = ?, date = ?, jour = ?, montant = ?, devise = ?, recurrence = ?, prevenir = ?, note = ? WHERE utilisateur_id = ? AND id = ?'),
  etat: db.prepare('UPDATE echeances SET etat = ?, regle_le = ? WHERE utilisateur_id = ? AND id = ?'),
  rappel: db.prepare('UPDATE echeances SET rappel_id = ? WHERE utilisateur_id = ? AND id = ?')
}

export type NouvelleEcheance = Pick<Echeance, 'titre' | 'categorie' | 'date' | 'montant' | 'devise' | 'recurrence' | 'prevenir' | 'note'> & { jour?: number }

export function getEcheance(uid: number, id: number): Echeance | null {
  const row = q.get.get(uid, id) as Row | undefined
  return row && row.etat !== 'supprime' ? toEcheance(row) : null
}

export function echeancesARegler(uid: number): Echeance[] {
  return (q.aRegler.all(uid) as Row[]).map(toEcheance)
}

export function regleesDepuis(uid: number, since: number): Echeance[] {
  return (q.reglees.all(uid, since) as Row[]).map(toEcheance)
}

/** Ce que le rappel dira : « l’échéance « Électricité » de 84 € tombe vendredi 14 novembre ». */
function annonce(e: Echeance): string {
  const montant = e.montant !== null ? ` de ${montantLisible(e.montant, e.devise)}` : ''
  return `l’échéance « ${e.titre} »${montant} tombe ${dateParlee(e.date)}`
}

/** Remplace le rappel d'une échéance : le jour du préavis à 9 h ; aucun si ce moment est déjà passé. */
function replanifier(uid: number, e: Echeance, now: number, tz: string): void {
  if (e.rappelId) deleteRappel(uid, e.rappelId)
  let rappelId: number | null = null
  if (e.etat === 'a_regler') {
    const quand = zonedTime(ajouterJours(e.date, -e.prevenir), HEURE_RAPPEL, tz).getTime()
    if (quand > now) {
      const montant = e.montant !== null ? ` · ${montantLisible(e.montant, e.devise)}` : ''
      rappelId = createRappel(uid, `Échéance « ${e.titre} »${montant} le ${dateParlee(e.date)} (échéance ${e.id})`, quand, null, annonce(e)).id
    }
  }
  q.rappel.run(rappelId, uid, e.id)
}

export function creerEcheance(uid: number, n: NouvelleEcheance, now: number, tz: string): Echeance {
  const jour = n.jour ?? Number(n.date.slice(8, 10))
  const { lastInsertRowid } = q.insert.run(uid, n.titre, n.categorie, n.date, jour, n.montant, n.devise, n.recurrence, n.prevenir, n.note, now)
  const e = getEcheance(uid, Number(lastInsertRowid))!
  replanifier(uid, e, now, tz)
  changed(uid)
  return getEcheance(uid, e.id)!
}

/** Modifie une échéance à régler ; son rappel suit la nouvelle date ou le nouveau préavis. */
export function modifierEcheance(uid: number, id: number, champs: Partial<NouvelleEcheance>, now: number, tz: string): Echeance | null {
  const e = getEcheance(uid, id)
  if (!e) return null
  const m = { ...e, ...champs }
  const jour = champs.date ? Number(champs.date.slice(8, 10)) : e.jour
  q.update.run(m.titre, m.categorie, m.date, jour, m.montant, m.devise, m.recurrence, m.prevenir, m.note, uid, id)
  const apres = getEcheance(uid, id)!
  replanifier(uid, apres, now, tz)
  changed(uid)
  return getEcheance(uid, id)
}

/** Réglée : elle passe dans l'historique, son rappel disparaît ; une récurrente crée la suivante. */
export function reglerEcheance(uid: number, id: number, now: number, tz: string): { reglee: Echeance; suivante: Echeance | null } | null {
  const e = getEcheance(uid, id)
  if (!e || e.etat !== 'a_regler') return null
  if (e.rappelId) deleteRappel(uid, e.rappelId)
  q.etat.run('regle', now, uid, id)
  q.rappel.run(null, uid, id)
  const prochaine = e.recurrence
    ? creerEcheance(uid, { titre: e.titre, categorie: e.categorie, date: suivante(e.date, e.recurrence, e.jour), jour: e.jour, montant: e.montant, devise: e.devise, recurrence: e.recurrence, prevenir: e.prevenir, note: e.note }, now, tz)
    : null
  changed(uid)
  return { reglee: getEcheance(uid, id)!, suivante: prochaine }
}

export function supprimerEcheance(uid: number, id: number): Echeance | null {
  const e = getEcheance(uid, id)
  if (!e) return null
  if (e.rappelId) deleteRappel(uid, e.rappelId)
  q.etat.run('supprime', e.regleLe, uid, id)
  q.rappel.run(null, uid, id)
  changed(uid)
  return e
}
