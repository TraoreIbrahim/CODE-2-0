// Télécharge le modèle de reconnaissance du locuteur (TitaNet large de NVIDIA NeMo, 16 kHz) depuis la
// publication officielle de sherpa-onnx, et vérifie son empreinte SHA-256. Le large plutôt que le small : dans
// le bruit d'une pièce animée, il sépare mieux la voix de son propriétaire des autres, pour un coût de calcul
// qui reste négligeable (environ 18 ms par tranche de 1,5 s).
// Gardé hors de git (models/).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'nemo_en_titanet_large.onnx'
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${NAME}`
const SHA256 = 'd51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77'

// Même chemin que `speakerModelPath` (apps/server/src/paths.ts).
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'voix-titanet.onnx')
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

if (existsSync(target) && sha(readFileSync(target)) === SHA256) {
  console.log('[voix] Modèle déjà présent.')
  process.exit(0)
}

console.log(`[voix] Téléchargement du modèle ${NAME}…`)
const res = await fetch(URL)
if (!res.ok) throw new Error(`[voix] Téléchargement impossible : HTTP ${res.status}`)
const buf = Buffer.from(await res.arrayBuffer())
if (sha(buf) !== SHA256) throw new Error('[voix] Empreinte SHA-256 inattendue : modèle refusé.')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(`${target}.part`, buf)
renameSync(`${target}.part`, target)
console.log(`[voix] Modèle prêt (${Math.round(buf.length / 1048576)} Mo).`)
