import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CLES_API, type CleApi } from '@code/protocol'
import { dataDir } from './paths.ts'

const run = promisify(execFile)

/** Nom du service sous lequel les secrets sont rangés dans le trousseau macOS. */
export const KEYCHAIN_SERVICE = 'code-2'

export type SecretName =
  /** Les clés API de l'installation (moteurs, voix, recherche web) : celles du propriétaire. */
  | CleApi
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  /** Jeton de rafraîchissement Google et sa date (JSON), écrit par la connexion depuis le cockpit. */
  | 'GOOGLE_TOKEN'
  /** Clé VAPID des notifications du téléphone (JSON), créée au premier démarrage. */
  | 'PUSH_VAPID'
  /** Clé maîtresse (32 octets, base64) qui chiffre les secrets gardés en base (accès Google, connecteurs). */
  | 'CODE_MASTER_KEY'

/**
 * Hors de macOS (Windows, Linux, serveur hébergé) : pas de trousseau. Les secrets que le serveur crée lui-même (clé des
 * notifications, clé maîtresse, accès Google) vont dans un fichier du dossier de données, lisible du seul serveur.
 */
const fileStore = join(dataDir, 'secrets.json')

function readStore(): Partial<Record<SecretName, string>> {
  try {
    return JSON.parse(readFileSync(fileStore, 'utf8'))
  } catch {
    return {}
  }
}

function writeStore(store: Partial<Record<SecretName, string>>): void {
  writeFileSync(fileStore, JSON.stringify(store), { mode: 0o600 })
}

/** Lit un secret : variable d'environnement d'abord (dev, serveur hébergé), sinon trousseau macOS ou fichier du serveur. */
export async function getSecret(name: SecretName): Promise<string | undefined> {
  const fromEnv = process.env[name]
  if (fromEnv) return fromEnv
  if (process.platform !== 'darwin') return readStore()[name]
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name, '-w'])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function setSecret(name: SecretName, value: string): Promise<void> {
  if (process.platform !== 'darwin') return writeStore({ ...readStore(), [name]: value })
  await run('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', name, '-w', value])
}

export async function deleteSecret(name: SecretName): Promise<void> {
  if (process.platform !== 'darwin') {
    const { [name]: _, ...rest } = readStore()
    return writeStore(rest)
  }
  await run('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name]).catch(() => {})
}

export type Secrets = Partial<Record<SecretName, string>>

export async function loadSecrets(): Promise<Secrets> {
  const names: SecretName[] = [...CLES_API]
  const values = await Promise.all(names.map((n) => getSecret(n)))
  return Object.fromEntries(names.map((n, i) => [n, values[i]]).filter(([, v]) => v)) as Secrets
}
