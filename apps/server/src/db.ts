import { DatabaseSync } from 'node:sqlite'
import type { LogEntry, Turn } from '@code/protocol'
import { dbPath } from './paths.ts'

/**
 * Base partagée par tous les modules. Chaque donnée appartient à un utilisateur (`utilisateur_id`) :
 * aucune requête ne lit ni n'écrit sans ce filtre (vérifié par cloisonnement.test.ts).
 */
export const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

export function hasColumn(table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prenom TEXT NOT NULL DEFAULT '',
    nom TEXT NOT NULL DEFAULT '',
    email TEXT,
    telephone TEXT,
    photo TEXT,
    fonction TEXT,
    departement TEXT,
    -- Réglages propres à la personne (JSON) : seulement ce qui diffère des valeurs par défaut de la configuration.
    reglages TEXT NOT NULL DEFAULT '{}',
    cree INTEGER NOT NULL,
    vu_le INTEGER,
    -- Fin de l'assistant de premier lancement (terminé ou passé) ; vide : il s'affiche à la connexion.
    assistant_le INTEGER,
    -- Connexion par mot de passe : identifiant unique (minuscules) et empreinte scrypt ; vides : appareils associés par code seulement.
    identifiant TEXT,
    mot_de_passe TEXT,
    -- Compte désactivé par le propriétaire : plus de connexion, ses données restent.
    actif INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL
  );
`)

// Bases créées avant les comptes locaux.
for (const [col, def] of [['identifiant', 'TEXT'], ['mot_de_passe', 'TEXT'], ['actif', 'INTEGER NOT NULL DEFAULT 1']] as const) {
  if (!hasColumn('utilisateurs', col)) db.exec(`ALTER TABLE utilisateurs ADD COLUMN ${col} ${def}`)
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS utilisateurs_identifiant ON utilisateurs (identifiant)')

/**
 * Le propriétaire : le premier utilisateur, créé au premier démarrage du serveur. Son nom et ses réglages
 * viennent de l'assistant de premier lancement.
 */
export function ensureOwner(): number {
  const row = db.prepare('SELECT id FROM utilisateurs ORDER BY id LIMIT 1').get() as { id: number } | undefined
  if (row) return row.id
  const { lastInsertRowid } = db.prepare('INSERT INTO utilisateurs (cree) VALUES (?)').run(Date.now())
  return Number(lastInsertRowid)
}

/** Index par utilisateur (les lectures filtrent toujours sur lui). */
export function userIndex(table: string, columns = ''): void {
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_utilisateur ON ${table} (utilisateur_id${columns ? `, ${columns}` : ''})`)
}

userIndex('messages', 'id')
userIndex('log', 'id')

const insertMessage = db.prepare('INSERT INTO messages (utilisateur_id, role, text, ts) VALUES (?, ?, ?, ?)')
const selectMessages = db.prepare('SELECT role, text, ts FROM messages WHERE utilisateur_id = ? ORDER BY id DESC LIMIT ?')
const insertLog = db.prepare('INSERT INTO log (utilisateur_id, ts, kind, summary) VALUES (?, ?, ?, ?)')
const selectLog = db.prepare('SELECT id, ts, kind, summary FROM log WHERE utilisateur_id = ? ORDER BY id DESC LIMIT ?')

export function addMessage(uid: number, role: Turn['role'], text: string): void {
  insertMessage.run(uid, role, text, Date.now())
}

/** Derniers messages de l'utilisateur, du plus ancien au plus récent. */
export function recentMessages(uid: number, limit: number): Turn[] {
  return (selectMessages.all(uid, limit) as Turn[]).reverse()
}

export function addLog(uid: number, kind: LogEntry['kind'], summary: string): LogEntry {
  const ts = Date.now()
  const { lastInsertRowid } = insertLog.run(uid, ts, kind, summary)
  return { id: Number(lastInsertRowid), ts, kind, summary }
}

export function recentLog(uid: number, limit: number): LogEntry[] {
  return selectLog.all(uid, limit) as LogEntry[]
}
