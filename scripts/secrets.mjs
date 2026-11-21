// Range les clés API dans le trousseau macOS (service « code-2 »).
// `security` demande la valeur lui-même : elle n'apparaît ni à l'écran ni dans l'historique.
// Sur Windows et Linux, en attendant le coffre chiffré : passez les clés en variables d'environnement.
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

const SERVICE = 'code-2'
// Clés du propriétaire ; chacun peut aussi ranger les siennes dans Réglages › Clés API.
const KEYS = [
  ['ANTHROPIC_API_KEY', 'Moteur Claude (un moteur au moins : Claude ou un autre ci-dessous)'],
  ['OPENAI_API_KEY', 'Moteur GPT, et voix de l’assistant (secours)'],
  ['GEMINI_API_KEY', 'Moteur Gemini (facultatif)'],
  ['MISTRAL_API_KEY', 'Moteur Mistral (facultatif)'],
  ['DEEPSEEK_API_KEY', 'Moteur DeepSeek (facultatif)'],
  ['OPENROUTER_API_KEY', 'Moteurs par OpenRouter (facultatif)'],
  ['GROQ_API_KEY', 'Moteurs Groq, et transcription Whisper (secours)'],
  ['BRAVE_API_KEY', 'Recherche web des moteurs autres que Claude (facultatif)'],
  ['DEEPGRAM_API_KEY', 'Transcription en continu (recommandé)'],
  ['ELEVENLABS_API_KEY', 'Voix de l’assistant (recommandé)'],
  ['GOOGLE_CLIENT_ID', 'Gmail et Agenda : identifiant du client OAuth « Application de bureau » (…apps.googleusercontent.com)'],
  ['GOOGLE_CLIENT_SECRET', 'Gmail et Agenda : code secret du même client OAuth']
]

if (process.platform !== 'darwin') {
  console.log('Pas de trousseau macOS ici : définissez ces variables d’environnement avant de lancer le serveur.\n')
  for (const [name, label] of KEYS) console.log(`  ${name} — ${label}`)
  process.exit(0)
}

const has = (name) =>
  spawnSync('security', ['find-generic-password', '-s', SERVICE, '-a', name], { stdio: 'ignore' }).status === 0

const rl = createInterface({ input: process.stdin, output: process.stdout })
console.log('Clés de l’assistant dans le trousseau macOS.\n')
for (const [name, label] of KEYS) {
  const state = has(name) ? 'déjà enregistrée' : 'absente'
  const answer = (await rl.question(`${name} — ${label} [${state}]. Saisir ? (o/N) `)).trim().toLowerCase()
  if (answer !== 'o' && answer !== 'oui') continue
  rl.pause()
  // `-w` en dernier, sans valeur : `security` demande le secret de façon masquée.
  const res = spawnSync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', name, '-w'], { stdio: 'inherit' })
  rl.resume()
  console.log(res.status === 0 ? `  ✓ ${name} enregistrée.\n` : `  ✗ Échec pour ${name}.\n`)
}
rl.close()
console.log('Redémarrez le serveur pour prendre en compte les nouvelles clés.')
