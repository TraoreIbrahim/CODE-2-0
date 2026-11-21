import { mkdirSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Racine du dépôt (apps/server/src → ../../..). */
export const repoRoot = resolve(here, '../../..')

/** Dossier des données de l'utilisateur selon le système : macOS, Windows, puis Linux (XDG). */
function systemDataDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
}

/**
 * Données locales : base SQLite, jeton d'appareil.
 * Pas « Code » seul : macOS ignore la casse et ce dossier est celui de VS Code.
 */
export const dataDir =
  process.env.CODE_DATA_DIR ||
  // Sous `node --test`, jamais la base réelle : un test qui oublie CODE_DATA_DIR écrit dans un dossier jetable.
  (process.env.NODE_TEST_CONTEXT ? mkdtempSync(join(tmpdir(), 'code-test-')) : join(systemDataDir(), 'code-2'))
mkdirSync(dataDir, { recursive: true })

export const dbPath = join(dataDir, 'code.db')
/** Journal technique envoyé par les appareils (micro du téléphone…). */
export const clientLogPath = join(dataDir, 'appareils.log')
/** Jeton lu par l'app Mac (même machine). Droits 0600. */
export const tokenPath = join(dataDir, 'device-token')
/** Modèle de reconnaissance du locuteur (TitaNet small), téléchargé par scripts/modele-voix.mjs. */
export const speakerModelPath = process.env.CODE_SPEAKER_MODEL || join(repoRoot, 'models', 'voix-titanet.onnx')
/** `CODE_DATA_DIR` et `CODE_MEMORY_DIR` permettent un serveur de test isolé (scripts/e2e.mjs). */
export const memoryDir = process.env.CODE_MEMORY_DIR || (process.env.NODE_TEST_CONTEXT ? join(dataDir, 'memory') : join(repoRoot, 'memory'))
mkdirSync(memoryDir, { recursive: true })
export const mobileDist = join(repoRoot, 'apps', 'mobile', 'dist')
