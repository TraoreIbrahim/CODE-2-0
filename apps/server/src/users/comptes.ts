import { randomInt } from 'node:crypto'
import type { CompteInfo, InvitationInfo } from '@code/protocol'
import { db } from '../db.ts'
import { hashPassword, tokenHash, verifyPassword } from './crypto.ts'
import { createUser, getUser, ownerId, revokeAllDevices, type Utilisateur } from './users.ts'

/**
 * Comptes locaux : un identifiant et un mot de passe par personne, et les invitations du propriétaire.
 * Le propriétaire est créé au premier démarrage ; chaque autre compte naît d'une invitation (un code à
 * usage unique, valable sept jours) que la personne invitée échange contre son compte.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Seule l'empreinte du code est gardée : il n'est montré qu'une fois, au propriétaire.
    code_hash TEXT NOT NULL UNIQUE,
    prenom TEXT NOT NULL,
    cree INTEGER NOT NULL,
    expire INTEGER NOT NULL,
    utilise_le INTEGER,
    -- Le compte créé avec ce code.
    compte_id INTEGER REFERENCES utilisateurs(id)
  );
`)

export const INVITATION_TTL_MS = 7 * 24 * 3_600_000
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const MOT_DE_PASSE_MIN = 8

const q = {
  byIdentifiant: db.prepare('SELECT id, mot_de_passe, actif FROM utilisateurs WHERE identifiant = ?'),
  password: db.prepare('SELECT mot_de_passe FROM utilisateurs WHERE id = ?'),
  setIdentifiant: db.prepare('UPDATE utilisateurs SET identifiant = ? WHERE id = ?'),
  setPassword: db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?'),
  setActif: db.prepare('UPDATE utilisateurs SET actif = ? WHERE id = ?'),
  setNom: db.prepare('UPDATE utilisateurs SET prenom = ?, nom = ? WHERE id = ?'),
  comptes: db.prepare('SELECT id, prenom, nom, identifiant, actif, cree, vu_le FROM utilisateurs ORDER BY id'),
  invInsert: db.prepare('INSERT INTO invitations (code_hash, prenom, cree, expire) VALUES (?, ?, ?, ?)'),
  invByHash: db.prepare('SELECT id, prenom, expire, utilise_le FROM invitations WHERE code_hash = ?'),
  invUse: db.prepare('UPDATE invitations SET utilise_le = ? WHERE id = ? AND utilise_le IS NULL'),
  invUnuse: db.prepare('UPDATE invitations SET utilise_le = NULL WHERE id = ?'),
  invCompte: db.prepare('UPDATE invitations SET compte_id = ? WHERE id = ?'),
  invPending: db.prepare('SELECT id, prenom, cree, expire FROM invitations WHERE utilise_le IS NULL AND expire >= ? ORDER BY id'),
  invDelete: db.prepare('DELETE FROM invitations WHERE id = ? AND utilise_le IS NULL')
}

export type Refus<C extends string = string> = { ok: false; champ?: C; message: string }

/** Un identifiant sans casse ni espaces autour : « Lea.Martin » et « lea.martin » sont le même. */
export const normIdentifiant = (raw: string) => raw.normalize('NFC').trim().toLowerCase()

/** Lettres, chiffres et `. _ - @ +` : un pseudo, une adresse mail ou un numéro conviennent. */
const IDENTIFIANT = /^[\p{L}\p{N}+][\p{L}\p{N}._@+-]*$/u
const PRENOM = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u

/** L'identifiant normalisé, ou ce qui ne va pas (`uid` : le compte qui le garde, s'il l'a déjà). */
export function checkIdentifiant(raw: unknown, uid?: number): { ok: string } | Refus<'identifiant'> {
  const id = typeof raw === 'string' ? normIdentifiant(raw) : ''
  if (id.length < 3 || id.length > 64) return { ok: false, champ: 'identifiant', message: 'Entre 3 et 64 caractères.' }
  if (!IDENTIFIANT.test(id)) return { ok: false, champ: 'identifiant', message: 'Lettres, chiffres, points, tirets, @ et + seulement, sans espace.' }
  const taken = q.byIdentifiant.get(id) as { id: number } | undefined
  if (taken && taken.id !== uid) return { ok: false, champ: 'identifiant', message: 'Cet identifiant est déjà pris.' }
  return { ok: id }
}

export function checkMotDePasse(raw: unknown, identifiant: string): Refus<'motDePasse'> | null {
  if (typeof raw !== 'string' || raw.length < MOT_DE_PASSE_MIN) return { ok: false, champ: 'motDePasse', message: `${MOT_DE_PASSE_MIN} caractères au moins.` }
  if (raw.length > 200) return { ok: false, champ: 'motDePasse', message: '200 caractères au plus.' }
  if (normIdentifiant(raw) === identifiant) return { ok: false, champ: 'motDePasse', message: 'Le mot de passe ne peut pas être l’identifiant.' }
  return null
}

/**
 * Identifiant et mot de passe de son compte. Un compte qui a déjà un mot de passe doit le redonner (`ancien`) ;
 * ses autres appareils restent connectés.
 */
export async function setIdentifiants(uid: number, identifiant: unknown, motDePasse: unknown, ancien?: unknown): Promise<{ ok: true } | Refus<'identifiant' | 'motDePasse' | 'ancien'>> {
  const stored = (q.password.get(uid) as { mot_de_passe: string | null } | undefined)?.mot_de_passe
  if (stored && (typeof ancien !== 'string' || !(await verifyPassword(ancien, stored)))) return { ok: false, champ: 'ancien', message: 'Mot de passe actuel incorrect.' }
  const id = checkIdentifiant(identifiant, uid)
  if ('message' in id) return id
  const bad = checkMotDePasse(motDePasse, id.ok)
  if (bad) return bad
  const hash = await hashPassword(motDePasse as string)
  // Revérifié après le calcul : un autre compte a pu le prendre entre-temps.
  const again = checkIdentifiant(id.ok, uid)
  if ('message' in again) return again
  q.setIdentifiant.run(id.ok, uid)
  q.setPassword.run(hash, uid)
  return { ok: true }
}

/** Empreinte de comparaison quand l'identifiant n'existe pas : la réponse prend le même temps. */
let leurre: Promise<string> | null = null

/** Connexion : le compte, ou pourquoi elle est refusée (sans dire si l'identifiant existe). */
export async function login(identifiant: unknown, motDePasse: unknown): Promise<Utilisateur | 'identifiants' | 'inactif'> {
  const id = typeof identifiant === 'string' ? normIdentifiant(identifiant) : ''
  const pw = typeof motDePasse === 'string' ? motDePasse.slice(0, 200) : ''
  const row = id ? (q.byIdentifiant.get(id) as { id: number; mot_de_passe: string | null; actif: number } | undefined) : undefined
  if (!row?.mot_de_passe) {
    leurre ??= hashPassword('leurre-de-comparaison')
    await verifyPassword(pw, await leurre)
    return 'identifiants'
  }
  if (!(await verifyPassword(pw, row.mot_de_passe))) return 'identifiants'
  if (!row.actif) return 'inactif'
  return getUser(row.id) ?? 'identifiants'
}

// ── Invitations ───────────────────────────────────────────────────────────

/** « ABCD-EFGH-JKLM » : douze caractères sans 0/O ni 1/I, faciles à dicter. */
const formatCode = (raw: string) => raw.match(/.{1,4}/g)!.join('-')
const cleanCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

export function checkPrenom(raw: unknown): { ok: string } | Refus<'prenom'> {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (!s || s.length > 40 || !PRENOM.test(s)) return { ok: false, champ: 'prenom', message: 'Un prénom est attendu (lettres seulement).' }
  return { ok: s }
}

/** Son prénom (obligatoire) et son nom (facultatif). */
export function setNom(uid: number, prenom: unknown, nom: unknown): { ok: true } | Refus<'prenom' | 'nom'> {
  const p = checkPrenom(prenom)
  if ('message' in p) return p
  const n = typeof nom === 'string' ? nom.replace(/\s+/g, ' ').trim() : ''
  if (n.length > 40 || (n && !PRENOM.test(n))) return { ok: false, champ: 'nom', message: 'Un nom de famille, en lettres seulement.' }
  q.setNom.run(p.ok, n, uid)
  return { ok: true }
}

/** Nouvelle invitation : son code n'est rendu qu'ici, une fois. */
export function issueInvitation(prenom: unknown, now = Date.now()): { ok: true; code: string; prenom: string; expire: number } | Refus<'prenom'> {
  const p = checkPrenom(prenom)
  if ('message' in p) return p
  const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  const expire = now + INVITATION_TTL_MS
  q.invInsert.run(tokenHash(raw), p.ok, now, expire)
  return { ok: true, code: formatCode(raw), prenom: p.ok, expire }
}

export function listInvitations(now = Date.now()): InvitationInfo[] {
  return q.invPending.all(now) as InvitationInfo[]
}

export function cancelInvitation(id: number): boolean {
  return q.invDelete.run(id).changes > 0
}

/**
 * Échange une invitation contre un compte : prénom, identifiant et mot de passe vérifiés d'abord (une erreur
 * de saisie ne consomme pas le code), puis le code et l'identifiant sont pris d'un coup.
 */
export async function claimInvitation(
  code: unknown,
  champs: { prenom: unknown; identifiant: unknown; motDePasse: unknown },
  now = Date.now()
): Promise<{ ok: true; utilisateur: Utilisateur } | Refus<'prenom' | 'identifiant' | 'motDePasse' | 'code'>> {
  const invalide: Refus<'code'> = { ok: false, champ: 'code', message: 'Cette invitation n’est plus valable : demandez-en une nouvelle.' }
  const find = () => (typeof code === 'string' ? (q.invByHash.get(tokenHash(cleanCode(code))) as { id: number; expire: number; utilise_le: number | null } | undefined) : undefined)
  const first = find()
  if (!first || first.utilise_le !== null || first.expire < now) return invalide
  const prenom = checkPrenom(champs.prenom)
  if ('message' in prenom) return prenom
  const id = checkIdentifiant(champs.identifiant)
  if ('message' in id) return id
  const bad = checkMotDePasse(champs.motDePasse, id.ok)
  if (bad) return bad
  const hash = await hashPassword(champs.motDePasse as string)
  // Sans attente à partir d'ici : le code et l'identifiant sont pris ensemble, ou rien.
  const inv = find()
  if (!inv || inv.expire < now || q.invUse.run(now, inv.id).changes === 0) return invalide
  const again = checkIdentifiant(id.ok)
  if ('message' in again) {
    q.invUnuse.run(inv.id)
    return again
  }
  const u = createUser(prenom.ok, '', now)
  q.setIdentifiant.run(id.ok, u.id)
  q.setPassword.run(hash, u.id)
  q.invCompte.run(u.id, inv.id)
  return { ok: true, utilisateur: getUser(u.id)! }
}

// ── Vue du propriétaire ───────────────────────────────────────────────────

type CompteRow = { id: number; prenom: string; nom: string; identifiant: string | null; actif: number; cree: number; vu_le: number | null }

export function listComptes(): CompteInfo[] {
  const owner = ownerId()
  return (q.comptes.all() as CompteRow[]).map((r) => ({
    id: r.id,
    prenom: r.prenom,
    nom: r.nom,
    ...(r.identifiant ? { identifiant: r.identifiant } : {}),
    proprietaire: r.id === owner,
    actif: r.actif !== 0,
    cree: r.cree,
    vuLe: r.vu_le
  }))
}

/** Active ou désactive un compte (jamais celui du propriétaire). Désactivé, tous ses appareils sont déconnectés. */
export function setActif(uid: number, actif: boolean): boolean {
  if (uid === ownerId() || !getUser(uid)) return false
  q.setActif.run(actif ? 1 : 0, uid)
  if (!actif) revokeAllDevices(uid)
  return true
}
