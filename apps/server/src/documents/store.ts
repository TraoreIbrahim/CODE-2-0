import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PapierCategorie } from '@code/protocol'
import { db, userIndex } from '../db.ts'
import { dataDir } from '../paths.ts'

/**
 * Les papiers envoyés depuis un appareil (photo d'une facture, PDF d'un avis d'impôt) : le fichier reste sur le
 * serveur, dans un dossier propre à chaque utilisateur ; l'assistant le lit, lui donne un titre et un classement,
 * le range (Drive ou serveur) et note son échéance.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    -- Nom du fichier envoyé, et nom (aléatoire) du fichier sur le disque.
    nom TEXT NOT NULL,
    type TEXT NOT NULL,
    taille INTEGER NOT NULL,
    fichier TEXT NOT NULL,
    etat TEXT NOT NULL DEFAULT 'recu' CHECK (etat IN ('recu', 'range', 'supprime')),
    titre TEXT,
    categorie TEXT,
    emetteur TEXT,
    resume TEXT,
    -- Ce que l'assistant en a relevé : [{ label, valeur }] en JSON.
    champs TEXT,
    drive_id TEXT,
    drive_lien TEXT,
    -- « CODE 2.0 › Papiers › Factures » : où il a été déposé.
    drive_chemin TEXT,
    echeance_id INTEGER,
    recu INTEGER NOT NULL,
    range_le INTEGER
  );
`)
userIndex('documents', 'etat, recu')

/** Ce que le serveur accepte : ce que les modèles savent lire. */
export const DOCUMENT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
export const DOCUMENT_MAX_OCTETS = 15 * 1024 * 1024

export type Champ = { label: string; valeur: string }

export type Document = {
  id: number
  nom: string
  type: string
  taille: number
  chemin: string
  etat: 'recu' | 'range'
  titre: string | null
  categorie: PapierCategorie | null
  emetteur: string | null
  resume: string | null
  champs: Champ[]
  driveId: string | null
  driveLien: string | null
  driveChemin: string | null
  echeanceId: number | null
  recu: number
  rangeLe: number | null
}

type Row = { id: number; utilisateur_id: number; nom: string; type: string; taille: number; fichier: string; etat: 'recu' | 'range' | 'supprime'; titre: string | null; categorie: string | null; emetteur: string | null; resume: string | null; champs: string | null; drive_id: string | null; drive_lien: string | null; drive_chemin: string | null; echeance_id: number | null; recu: number; range_le: number | null }

const dossier = (uid: number) => join(dataDir, 'documents', String(uid))

function lireChamps(json: string | null): Champ[] {
  try {
    const v = JSON.parse(json ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((c): c is Champ => typeof c?.label === 'string' && typeof c?.valeur === 'string') : []
  } catch {
    return []
  }
}

const toDocument = (r: Row): Document => ({
  id: r.id,
  nom: r.nom,
  type: r.type,
  taille: r.taille,
  chemin: join(dossier(r.utilisateur_id), r.fichier),
  etat: r.etat === 'range' ? 'range' : 'recu',
  titre: r.titre,
  categorie: r.categorie as PapierCategorie | null,
  emetteur: r.emetteur,
  resume: r.resume,
  champs: lireChamps(r.champs),
  driveId: r.drive_id,
  driveLien: r.drive_lien,
  driveChemin: r.drive_chemin,
  echeanceId: r.echeance_id,
  recu: r.recu,
  rangeLe: r.range_le
})

const q = {
  insert: db.prepare('INSERT INTO documents (utilisateur_id, nom, type, taille, fichier, recu) VALUES (?, ?, ?, ?, ?, ?)'),
  get: db.prepare("SELECT * FROM documents WHERE utilisateur_id = ? AND id = ? AND etat != 'supprime'"),
  list: db.prepare("SELECT * FROM documents WHERE utilisateur_id = ? AND etat != 'supprime' ORDER BY recu DESC, id DESC"),
  ranger: db.prepare("UPDATE documents SET etat = 'range', titre = ?, categorie = ?, emetteur = ?, resume = ?, champs = ?, range_le = ? WHERE utilisateur_id = ? AND id = ?"),
  drive: db.prepare('UPDATE documents SET drive_id = ?, drive_lien = ?, drive_chemin = ? WHERE utilisateur_id = ? AND id = ?'),
  echeance: db.prepare('UPDATE documents SET echeance_id = ? WHERE utilisateur_id = ? AND id = ?')
}

/** Nom affichable du fichier envoyé : sans chemin ni caractères de contrôle, 120 caractères au plus. */
export function nomPropre(nom: string, type: string): string {
  const base = nom.split(/[/\\]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
  return base || `document.${DOCUMENT_TYPES[type] ?? 'bin'}`
}

/** Enregistre un fichier reçu (type déjà vérifié) ; il appartient à son utilisateur seul. */
export function enregistrerDocument(uid: number, d: { nom: string; type: string; data: Buffer }, now: number): Document {
  const ext = DOCUMENT_TYPES[d.type]
  if (!ext) throw new Error(`Type non pris en charge : ${d.type}`)
  const fichier = `${randomBytes(12).toString('hex')}.${ext}`
  mkdirSync(dossier(uid), { recursive: true, mode: 0o700 })
  writeFileSync(join(dossier(uid), fichier), d.data, { mode: 0o600 })
  const { lastInsertRowid } = q.insert.run(uid, nomPropre(d.nom, d.type), d.type, d.data.length, fichier, now)
  return getDocument(uid, Number(lastInsertRowid))!
}

export function getDocument(uid: number, id: number): Document | null {
  const row = q.get.get(uid, id) as Row | undefined
  return row ? toDocument(row) : null
}

export function listerDocuments(uid: number): Document[] {
  return (q.list.all(uid) as Row[]).map(toDocument)
}

export type Rangement = { titre: string; categorie: PapierCategorie; emetteur: string | null; resume: string | null; champs: Champ[] }

export function rangerDocument(uid: number, id: number, r: Rangement, now: number): Document | null {
  q.ranger.run(r.titre, r.categorie, r.emetteur, r.resume, JSON.stringify(r.champs), now, uid, id)
  return getDocument(uid, id)
}

export function noterDrive(uid: number, id: number, d: { id: string; lien: string | null; chemin: string }): void {
  q.drive.run(d.id, d.lien, d.chemin, uid, id)
}

export function lierEcheance(uid: number, id: number, echeanceId: number): void {
  q.echeance.run(echeanceId, uid, id)
}
