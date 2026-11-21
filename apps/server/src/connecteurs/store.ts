import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { db } from '../db.ts'
import { decrypt, encrypt } from '../users/crypto.ts'

/**
 * Connecteurs MCP de chaque utilisateur (Figma, GitHub, Vercel…) : le serveur MCP du service, et l'accès,
 * chiffré (clé maîtresse du serveur) comme les mots de passe des boîtes mail. L'accès ne quitte jamais le
 * serveur : ni l'écran ni Claude ne le voient.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS connecteurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    -- Identifiant du catalogue (« github », « vercel »…) ou « mcp » pour un serveur ajouté à la main.
    service TEXT NOT NULL,
    libelle TEXT NOT NULL,
    url TEXT NOT NULL,
    -- Jeton ou accès OAuth, chiffré (AES-GCM, contexte « connecteur:<id utilisateur>:<url> »).
    acces TEXT NOT NULL,
    cree INTEGER NOT NULL,
    UNIQUE (utilisateur_id, url)
  )
`)

/** Ce qui est chiffré : un jeton personnel, ou l'état d'une connexion OAuth (client inscrit, jetons, vérificateur PKCE). */
export type Acces = {
  jeton?: string
  /** Jeton en plus de la connexion OAuth, pour une API que le serveur MCP n'expose pas (Expo : la liste des projets). */
  complement?: string
  oauth?: { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string }
}

export type Connecteur = { id: number; uid: number; service: string; libelle: string; url: string; cree: number }

type Row = { id: number; utilisateur_id: number; service: string; libelle: string; url: string; acces: string; cree: number }

const q = {
  list: db.prepare('SELECT * FROM connecteurs WHERE utilisateur_id = ? ORDER BY id'),
  get: db.prepare('SELECT * FROM connecteurs WHERE id = ? AND utilisateur_id = ?'),
  byUrl: db.prepare('SELECT * FROM connecteurs WHERE utilisateur_id = ? AND url = ?'),
  insert: db.prepare(
    'INSERT INTO connecteurs (utilisateur_id, service, libelle, url, acces, cree) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (utilisateur_id, url) DO UPDATE SET service = excluded.service, libelle = excluded.libelle, acces = excluded.acces'
  ),
  setAcces: db.prepare('UPDATE connecteurs SET acces = ? WHERE id = ? AND utilisateur_id = ?'),
  remove: db.prepare('DELETE FROM connecteurs WHERE id = ? AND utilisateur_id = ?')
}

const contexte = (uid: number, url: string) => `connecteur:${uid}:${url}`
const toConnecteur = (r: Row): Connecteur => ({ id: r.id, uid: r.utilisateur_id, service: r.service, libelle: r.libelle, url: r.url, cree: r.cree })

export function listConnecteurs(uid: number): Connecteur[] {
  return (q.list.all(uid) as Row[]).map(toConnecteur)
}

export function getConnecteur(uid: number, id: number): Connecteur | null {
  const r = q.get.get(id, uid) as Row | undefined
  return r ? toConnecteur(r) : null
}

/** L'accès en clair, seulement pour ouvrir une connexion. */
export function accesOf(c: Connecteur): Acces {
  const r = q.get.get(c.id, c.uid) as Row | undefined
  if (!r) return {}
  try {
    return JSON.parse(decrypt(r.acces, contexte(c.uid, c.url))) as Acces
  } catch {
    return {}
  }
}

export function saveConnecteur(uid: number, service: string, libelle: string, url: string, acces: Acces): Connecteur {
  q.insert.run(uid, service, libelle, url, encrypt(JSON.stringify(acces), contexte(uid, url)), Date.now())
  return toConnecteur(q.byUrl.get(uid, url) as Row)
}

/** Met à jour l'accès (jetons OAuth rafraîchis, client inscrit). */
export function updateAcces(c: Connecteur, change: (a: Acces) => Acces): void {
  q.setAcces.run(encrypt(JSON.stringify(change(accesOf(c))), contexte(c.uid, c.url)), c.id, c.uid)
}

export function removeConnecteur(uid: number, id: number): boolean {
  return q.remove.run(id, uid).changes > 0
}

/** Ses accès aux services de développement, pour les appels directs de CODE (état d'un projet, alertes). */
export type JetonsDev = { github?: string; vercel?: string; expo?: string }

export function jetonsDev(uid: number): JetonsDev {
  const j: JetonsDev = {}
  for (const c of listConnecteurs(uid)) {
    if (c.service !== 'github' && c.service !== 'vercel' && c.service !== 'expo') continue
    const a = accesOf(c)
    // GitHub : jeton personnel ou accès OAuth ; Vercel : jeton ; Expo : le jeton d'accès en complément (l'OAuth ne vaut que pour son MCP).
    const v = c.service === 'github' ? (a.jeton ?? a.oauth?.tokens?.access_token) : c.service === 'vercel' ? a.jeton : a.complement
    if (v) j[c.service] = v
  }
  return j
}
