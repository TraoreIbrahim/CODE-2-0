import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { join } from 'node:path'
import { dataDir } from '../paths.ts'
import { getSecret, setSecret } from '../secrets.ts'

/**
 * Chiffrement des secrets gardés en base (clés API du coffre, accès Google, connecteurs) : AES-256-GCM
 * avec la clé maîtresse du serveur. Elle vient de CODE_MASTER_KEY (32 octets en base64) si elle est
 * définie, sinon du trousseau de macOS ; ailleurs, d'un fichier du dossier de données lisible du seul
 * serveur. Une base copiée sans sa clé maîtresse ne révèle aucune clé.
 */

const VERSION = 'v1'
let master: Buffer | null = null

function parseKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== 32) throw new Error('CODE_MASTER_KEY doit faire 32 octets (base64).')
  return key
}

/** Charge la clé maîtresse ; la crée au premier démarrage (trousseau sur le Mac, fichier ailleurs). */
export async function initMasterKey(): Promise<void> {
  const stored = await getSecret('CODE_MASTER_KEY')
  if (stored) {
    master = parseKey(stored)
    return
  }
  const fresh = randomBytes(32)
  await setSecret('CODE_MASTER_KEY', fresh.toString('base64'))
  master = fresh
  if (process.platform !== 'darwin') {
    console.warn(`[code] Clé maîtresse créée dans ${join(dataDir, 'secrets.json')} : sauvegardez ce fichier avec la base, ou passez la clé par CODE_MASTER_KEY.`)
  }
}

/** Tests : une clé fixe, sans trousseau. */
export function setMasterKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('clé de 32 octets attendue')
  master = key
}

function key(): Buffer {
  if (!master) throw new Error('Clé maîtresse non chargée (initMasterKey).')
  return master
}

/** « v1.<iv>.<tag>.<chiffré> » en base64url. `contexte` (l'utilisateur, l'usage) lie le chiffré à sa ligne. */
export function encrypt(plain: string, contexte: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  c.setAAD(Buffer.from(contexte))
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [VERSION, iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

/** Déchiffre ; lève si la clé maîtresse, le contexte ou le texte ne correspondent pas. */
export function decrypt(box: string, contexte: string): string {
  const [v, iv, tag, data] = box.split('.')
  if (v !== VERSION || !iv || !tag || data === undefined) throw new Error('Secret chiffré illisible.')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAAD(Buffer.from(contexte))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
}

/** Empreinte d'un jeton d'appareil : seule elle est gardée en base. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── Mots de passe ─────────────────────────────────────────────────────────

/** scrypt (RFC 7914), 32 Mo de mémoire par calcul : lent à deviner, rapide à vérifier une fois. */
const SCRYPT = { N: 1 << 15, r: 8, p: 1 }
const SCRYPT_MAXMEM = 64 * 1024 * 1024

function derive(motDePasse: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: SCRYPT_MAXMEM }
  return new Promise((resolve, reject) => scrypt(motDePasse.normalize('NFC'), salt, 32, options, (err, key) => (err ? reject(err) : resolve(key))))
}

/** « scrypt$N$r$p$<sel>$<empreinte> » : le mot de passe lui-même n'est jamais gardé. */
export async function hashPassword(motDePasse: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(motDePasse, salt, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/** Compare en temps constant ; une empreinte illisible ne correspond à rien. */
export async function verifyPassword(motDePasse: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64url')
  const got = await derive(motDePasse, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) })
  return got.length === expected.length && timingSafeEqual(got, expected)
}
