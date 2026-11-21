// Certaines installations npm sautent le téléchargement du binaire Electron :
// on le récupère s'il manque.
// Sur macOS, l'Electron de développement ne déclare pas la localisation : le système la refuse alors
// sans même la demander (itinéraires). On ajoute la déclaration, puis on le resigne localement.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const electron = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'electron')
if (existsSync(join(electron, 'install.js')) && !existsSync(join(electron, 'path.txt'))) {
  console.log('[electron] Téléchargement du binaire Electron…')
  const res = spawnSync(process.execPath, [join(electron, 'install.js')], { stdio: 'inherit' })
  process.exitCode = res.status ?? 1
}

const app = join(electron, 'dist', 'Electron.app')
const plist = join(app, 'Contents', 'Info.plist')
const LOCATION = "L'assistant utilise votre position, au moment où vous le demandez, pour calculer un itinéraire."
if (process.platform === 'darwin' && existsSync(plist)) {
  const buddy = (cmd) => spawnSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { encoding: 'utf8' })
  if (buddy('Print :NSLocationUsageDescription').status !== 0) {
    console.log('[electron] Déclaration de la localisation (itinéraires) et nouvelle signature locale…')
    buddy(`Add :NSLocationUsageDescription string ${LOCATION}`)
    buddy(`Add :NSLocationWhenInUseUsageDescription string ${LOCATION}`)
    const sign = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
    if (sign.status !== 0) console.warn('[electron] Signature locale impossible : la localisation restera refusée par macOS.')
  }
}
