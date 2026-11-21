// Copie le modèle Silero VAD, son worklet et le moteur ONNX (WebAssembly)
// dans le dossier public de chaque client, servis sous /vad/.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vadDist = join(root, 'node_modules/@ricky0123/vad-web/dist')
const ortDist = join(root, 'node_modules/onnxruntime-web/dist')

if (!existsSync(vadDist) || !existsSync(ortDist)) {
  console.warn('[vad] vad-web ou onnxruntime-web absent : copie ignorée.')
  process.exit(0)
}

const files = [
  ...['silero_vad_v5.onnx', 'vad.worklet.bundle.min.js'].map((f) => join(vadDist, f)),
  ...readdirSync(ortDist)
    .filter((f) => /^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f))
    .map((f) => join(ortDist, f))
]

for (const target of ['apps/mobile/public/vad', 'apps/desktop/src/renderer/public/vad']) {
  const dir = join(root, target)
  mkdirSync(dir, { recursive: true })
  for (const file of files) copyFileSync(file, join(dir, file.split('/').pop()))
}
console.log(`[vad] ${files.length} fichiers copiés pour l'ordinateur et le téléphone.`)
