import { randomBytes, randomInt } from 'node:crypto'
import { normalizeWidgets, type Appareil, type Reglages, type UtilisateurInfo } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { db, ensureOwner } from '../db.ts'
import { tokenHash } from './crypto.ts'
import { currentUserId } from './scope.ts'

/**
 * Utilisateurs de l'installation et leurs appareils. Le premier est le propriétaire, créé au premier
 * démarrage. Un appareil (ordinateur, téléphone, navigateur) a son propre jeton ; seule son empreinte est
 * gardée en base.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS appareils (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    jeton_hash TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('mac', 'mobile', 'navigateur')),
    nom TEXT NOT NULL,
    cree INTEGER NOT NULL,
    vu_le INTEGER,
    revoque_le INTEGER
  );
  CREATE INDEX IF NOT EXISTS appareils_utilisateur ON appareils (utilisateur_id);
`)

export type AppareilType = Appareil['type']

export type Utilisateur = {
  id: number
  prenom: string
  nom: string
  email: string | null
  telephone: string | null
  photo: string | null
  fonction: string | null
  departement: string | null
  reglages: Reglages
  /** Le premier utilisateur : vue d'ensemble des coûts, fichiers de l'ordinateur. */
  proprietaire: boolean
  /** L'assistant de premier lancement est terminé (ou passé). */
  configure: boolean
  /** Identifiant de connexion (minuscules) ; null : pas de mot de passe. */
  identifiant: string | null
  /** Désactivé par le propriétaire : aucun appareil ne se connecte plus. */
  actif: boolean
}

type Row = {
  id: number
  prenom: string
  nom: string
  email: string | null
  telephone: string | null
  photo: string | null
  fonction: string | null
  departement: string | null
  reglages: string
  assistant_le: number | null
  identifiant: string | null
  actif: number
}

/** Réglages complets : les valeurs par défaut de la configuration, puis ce que la personne a changé. */
export function reglagesOf(stored: string | Partial<Reglages>): Reglages {
  let own: Partial<Reglages> = {}
  try {
    own = typeof stored === 'string' ? (JSON.parse(stored) as Partial<Reglages>) : stored
  } catch {}
  const out = { ...codeConfig.reglages } as Reglages
  for (const k of Object.keys(out) as (keyof Reglages)[]) if (own[k] !== undefined) (out as Record<string, unknown>)[k] = own[k]
  // Une carte ajoutée depuis le dernier réglage apparaît à sa place par défaut.
  out.widgets = normalizeWidgets(out.widgets, codeConfig.reglages.widgets)
  // Un usage sans moteur choisi garde celui de l'installation.
  out.moteurs = { ...codeConfig.reglages.moteurs, ...(own.moteurs ?? {}) }
  return out
}

const q = {
  get: db.prepare('SELECT * FROM utilisateurs WHERE id = ?'),
  all: db.prepare('SELECT * FROM utilisateurs ORDER BY id'),
  insert: db.prepare('INSERT INTO utilisateurs (prenom, nom, cree) VALUES (?, ?, ?)'),
  first: db.prepare('SELECT id FROM utilisateurs ORDER BY id LIMIT 1'),
  reglages: db.prepare('UPDATE utilisateurs SET reglages = ? WHERE id = ?'),
  seen: db.prepare('UPDATE utilisateurs SET vu_le = ? WHERE id = ?'),
  assistant: db.prepare('UPDATE utilisateurs SET assistant_le = ? WHERE id = ? AND assistant_le IS NULL'),
  devInsert: db.prepare('INSERT INTO appareils (utilisateur_id, jeton_hash, type, nom, cree) VALUES (?, ?, ?, ?, ?)'),
  devByHash: db.prepare('SELECT * FROM appareils WHERE jeton_hash = ?'),
  devList: db.prepare('SELECT * FROM appareils WHERE utilisateur_id = ? AND revoque_le IS NULL ORDER BY vu_le DESC, id DESC'),
  devRevoke: db.prepare('UPDATE appareils SET revoque_le = ? WHERE id = ? AND utilisateur_id = ? AND revoque_le IS NULL'),
  devRevokeAll: db.prepare('UPDATE appareils SET revoque_le = ? WHERE utilisateur_id = ? AND revoque_le IS NULL'),
  devSeen: db.prepare('UPDATE appareils SET vu_le = ? WHERE id = ? AND utilisateur_id = ?')
}

const toUser = (r: Row, ownerId: number | null): Utilisateur => ({
  id: r.id,
  prenom: r.prenom,
  nom: r.nom,
  email: r.email,
  telephone: r.telephone,
  photo: r.photo,
  fonction: r.fonction,
  departement: r.departement,
  reglages: reglagesOf(r.reglages),
  proprietaire: r.id === ownerId,
  configure: r.assistant_le !== null,
  identifiant: r.identifiant,
  actif: r.actif !== 0
})

/** Le propriétaire (premier utilisateur), ou null avant le premier démarrage. */
export function ownerId(): number | null {
  return (q.first.get() as { id: number } | undefined)?.id ?? null
}

/** Un nouvel utilisateur de l'installation (son identifiant et son mot de passe : comptes.ts). */
export function createUser(prenom: string, nom: string, now = Date.now()): Utilisateur {
  const id = Number(q.insert.run(prenom.trim(), nom.trim(), now).lastInsertRowid)
  return getUser(id)!
}

export function getUser(id: number): Utilisateur | null {
  const row = q.get.get(id) as Row | undefined
  return row ? toUser(row, ownerId()) : null
}

export function listUsers(): Utilisateur[] {
  const owner = ownerId()
  return (q.all.all() as Row[]).map((r) => toUser(r, owner))
}

/** Ce que les écrans savent de l'utilisateur connecté (jamais sa clé). */
export function userInfo(u: Utilisateur): UtilisateurInfo {
  return {
    id: u.id,
    prenom: u.prenom,
    nom: u.nom,
    appellation: appellationOf(u),
    ...(u.photo ? { photo: u.photo } : {}),
    ...(u.fonction ? { fonction: u.fonction } : {}),
    proprietaire: u.proprietaire,
    configure: u.configure,
    ...(u.identifiant ? { identifiant: u.identifiant } : {}),
    reglages: u.reglages
  }
}

/** Comment l'assistant appelle la personne : son appellation, sinon son nom de famille. */
export function appellationOf(u: Pick<Utilisateur, 'reglages' | 'nom' | 'prenom'>): string {
  return u.reglages.appellation.trim() || u.nom || u.prenom || 'vous'
}

/**
 * Le nom dit quand l'assistant prend la parole de lui-même (« Bonsoir Sam, je vous rappelle… ») : l'appellation
 * choisie, sinon le prénom.
 */
export function spokenNameOf(u: Pick<Utilisateur, 'reglages' | 'nom' | 'prenom'>): string {
  return u.reglages.appellation.trim() || u.prenom || appellationOf(u)
}

/** Fuseau de l'utilisateur (par défaut : l'utilisateur courant). */
export function userTimeZone(uid = currentUserId()): string {
  return getUser(uid)?.reglages.fuseau ?? codeConfig.reglages.fuseau
}

export function updateReglages(uid: number, patch: Partial<Reglages>): Utilisateur | null {
  const u = getUser(uid)
  if (!u) return null
  const next = reglagesOf({ ...u.reglages, ...patch })
  // Seule la différence avec les valeurs par défaut est gardée : un défaut changé dans la configuration s'applique à tous.
  const own = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((codeConfig.reglages as Record<string, unknown>)[k])))
  q.reglages.run(JSON.stringify(own), uid)
  return getUser(uid)
}

/** L'assistant de premier lancement est fini (ou passé) : il ne s'affichera plus. La première date reste. */
export function finishAssistant(uid: number, now = Date.now()): Utilisateur | null {
  q.assistant.run(now, uid)
  return getUser(uid)
}

// ── Appareils ─────────────────────────────────────────────────────────────

type DevRow = { id: number; utilisateur_id: number; type: AppareilType; nom: string; cree: number; vu_le: number | null; revoque_le: number | null }

const toAppareil = (r: DevRow): Appareil => ({ id: r.id, type: r.type, nom: r.nom, cree: r.cree, vuLe: r.vu_le })

/** Nouveau jeton d'appareil pour un utilisateur. Le jeton n'est rendu qu'ici, une fois. */
export function issueDevice(uid: number, type: AppareilType, nom: string): { token: string; appareil: Appareil } {
  const token = randomBytes(24).toString('base64url')
  return { token, appareil: registerDevice(uid, token, type, nom) }
}

/** Enregistre un jeton déjà tiré (celui de l'ordinateur du serveur, lu dans le fichier `device-token`). */
export function registerDevice(uid: number, token: string, type: AppareilType, nom: string): Appareil {
  q.devInsert.run(uid, tokenHash(token), type, nom.slice(0, 80), Date.now())
  return toAppareil(q.devByHash.get(tokenHash(token)) as DevRow)
}

/** Le jeton est-il déjà connu (même révoqué) ? */
export function knownToken(token: string): boolean {
  return !!q.devByHash.get(tokenHash(token))
}

const SEEN_EVERY_MS = 60_000
const seenAt = new Map<number, number>()

/** Authentifie un jeton d'appareil : son appareil et son utilisateur, ou null (inconnu ou révoqué). */
export function authenticate(token: string, now = Date.now()): { appareil: Appareil; utilisateur: Utilisateur } | null {
  if (!token) return null
  const row = q.devByHash.get(tokenHash(token)) as DevRow | undefined
  if (!row || row.revoque_le !== null) return null
  const utilisateur = getUser(row.utilisateur_id)
  if (!utilisateur?.actif) return null
  if (now - (seenAt.get(row.id) ?? 0) > SEEN_EVERY_MS) {
    seenAt.set(row.id, now)
    q.devSeen.run(now, row.id, row.utilisateur_id)
    q.seen.run(now, row.utilisateur_id)
  }
  return { appareil: toAppareil({ ...row, vu_le: now }), utilisateur }
}

export function listDevices(uid: number): Appareil[] {
  return (q.devList.all(uid) as DevRow[]).map(toAppareil)
}

/** Révoque un appareil de cet utilisateur (jamais celui d'un autre). */
export function revokeDevice(uid: number, deviceId: number, now = Date.now()): boolean {
  return q.devRevoke.run(now, deviceId, uid).changes > 0
}

/** Révoque tous ses appareils (compte désactivé, mot de passe changé ailleurs). Renvoie leur nombre. */
export function revokeAllDevices(uid: number, now = Date.now()): number {
  return Number(q.devRevokeAll.run(now, uid).changes)
}

// ── Association d'un appareil (QR depuis l'ordinateur) ────────────────────

const PAIR_TTL_MS = 10 * 60_000
const pairCodes = new Map<string, { uid: number; expires: number }>()

/** Code à usage unique, valable dix minutes : le QR de l'ordinateur le contient, jamais un jeton. */
export function issuePairCode(uid: number, now = Date.now()): string {
  for (const [c, v] of pairCodes) if (v.expires < now) pairCodes.delete(c)
  const code = Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('')
  pairCodes.set(code, { uid, expires: now + PAIR_TTL_MS })
  return code
}

/** Échange un code d'association contre l'utilisateur qui l'a demandé (une seule fois). */
export function claimPairCode(code: string, now = Date.now()): number | null {
  const key = code.trim().toUpperCase()
  const entry = pairCodes.get(key)
  pairCodes.delete(key)
  return entry && entry.expires >= now ? entry.uid : null
}

export { ensureOwner }
