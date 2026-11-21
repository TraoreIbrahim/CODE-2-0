import { CLES_API, CLE_NOMS, type CleApi, type CleInfo } from '@code/protocol'
import { db } from '../db.ts'
import type { Secrets } from '../secrets.ts'
import { decrypt, encrypt } from './crypto.ts'
import { ownerId } from './users.ts'

/**
 * Coffre de clés API : chacun range les siennes, chiffrées avec la clé maîtresse et liées à leur ligne
 * (utilisateur et nom). Les clés du serveur (environnement, trousseau) ne servent qu'au propriétaire : un
 * autre compte n'utilise jamais que ses propres clés.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cles (
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    nom TEXT NOT NULL,
    valeur TEXT NOT NULL,
    modifie INTEGER NOT NULL,
    PRIMARY KEY (utilisateur_id, nom)
  );
`)

const q = {
  list: db.prepare('SELECT nom, valeur, modifie FROM cles WHERE utilisateur_id = ?'),
  upsert: db.prepare(
    'INSERT INTO cles (utilisateur_id, nom, valeur, modifie) VALUES (?, ?, ?, ?) ON CONFLICT (utilisateur_id, nom) DO UPDATE SET valeur = excluded.valeur, modifie = excluded.modifie'
  ),
  remove: db.prepare('DELETE FROM cles WHERE utilisateur_id = ? AND nom = ?')
}

const contexte = (uid: number, nom: CleApi) => `cle:${uid}:${nom}`
export const isCle = (nom: unknown): nom is CleApi => CLES_API.includes(nom as CleApi)

/** Le début attendu de certaines clés : une clé collée au mauvais endroit est refusée tout de suite. */
const PREFIXES: Partial<Record<CleApi, string>> = { ANTHROPIC_API_KEY: 'sk-ant-', OPENAI_API_KEY: 'sk-', OPENROUTER_API_KEY: 'sk-or-', GEMINI_API_KEY: 'AIza', GROQ_API_KEY: 'gsk_' }

/** La clé nettoyée, ou pourquoi elle est refusée. */
export function checkCle(nom: CleApi, raw: unknown): { ok: string } | { erreur: string } {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (v.length < 16 || v.length > 500 || !/^[\x21-\x7e]+$/.test(v)) return { erreur: 'Clé illisible : collez-la telle que le service la donne, sans espace.' }
  const prefix = PREFIXES[nom]
  if (prefix && !v.startsWith(prefix)) return { erreur: `Ce n’est pas une clé ${CLE_NOMS[nom].nom} : elle commence par « ${prefix} ».` }
  return { ok: v }
}

type Row = { nom: CleApi; valeur: string; modifie: number }

/** Ses clés, déchiffrées (une clé illisible, après un changement de clé maîtresse, est ignorée). */
function rangees(uid: number): { nom: CleApi; valeur: string; modifie: number }[] {
  return (q.list.all(uid) as Row[]).flatMap((r) => {
    if (!isCle(r.nom)) return []
    try {
      return [{ nom: r.nom, valeur: decrypt(r.valeur, contexte(uid, r.nom)), modifie: r.modifie }]
    } catch {
      return []
    }
  })
}

export function setCle(uid: number, nom: CleApi, valeur: string, now = Date.now()): void {
  q.upsert.run(uid, nom, encrypt(valeur, contexte(uid, nom)), now)
}

export function deleteCle(uid: number, nom: CleApi): boolean {
  return q.remove.run(uid, nom).changes > 0
}

/** Les clés dont il dispose : les siennes, et pour le propriétaire celles du serveur en complément. */
export function keysFor(uid: number, serveur: Secrets): Secrets {
  const own = Object.fromEntries(rangees(uid).map((c) => [c.nom, c.valeur])) as Secrets
  return uid === ownerId() ? { ...serveur, ...own } : own
}

/** L'état de chaque clé, pour ses écrans : d'où elle vient et ses quatre derniers caractères, jamais plus. */
export function listCles(uid: number, serveur: Secrets): CleInfo[] {
  const own = new Map(rangees(uid).map((c) => [c.nom, c]))
  const owner = uid === ownerId()
  return CLES_API.map((nom) => {
    const c = own.get(nom)
    if (c) return { nom, source: 'coffre', fin: c.valeur.slice(-4), modifie: c.modifie }
    return { nom, source: owner && serveur[nom] ? 'serveur' : null }
  })
}
