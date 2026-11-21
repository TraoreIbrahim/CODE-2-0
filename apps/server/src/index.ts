import './restore.ts'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { codeConfig } from '../../../config/code.config.ts'
import { startGateway } from './gateway/gateway.ts'
import { createHttpServer } from './http.ts'
import { tokenPath } from './paths.ts'
import { loadSecrets } from './secrets.ts'
import { refreshConnecteurs } from './connecteurs/registre.ts'
import { rafraichirCatalogue } from './brain/moteurs/tarifs.ts'
import { modeleOllama } from './brain/moteurs/compat.ts'
import { ROLES_MOTEUR } from '@code/protocol'
import { googleStatus, initGoogle } from './google/oauth.ts'
import { initPush, pushInfo } from './push/push.ts'
import { initMasterKey } from './users/crypto.ts'
import { ensureOwner, issueDevice, issuePairCode, knownToken, listDevices, listUsers } from './users/users.ts'

const secrets = await loadSecrets()

// Clé maîtresse (trousseau de macOS, ou CODE_MASTER_KEY ailleurs) : elle chiffre les secrets de chacun en base.
await initMasterKey()

// Le propriétaire existe dès le premier démarrage. L'app de bureau de cette machine lit son jeton dans
// `device-token` (droits 0600) ; un autre appareil s'associe par un code (QR depuis l'ordinateur).
const owner = ensureOwner()
const saved = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : ''
if (!saved || !knownToken(saved)) writeFileSync(tokenPath, issueDevice(owner, 'mac', 'Ordinateur').token, { mode: 0o600 })

// Connecteurs (GitHub, Vercel, Figma…) : chacun relié avec l'accès de son utilisateur, rafraîchi toutes les 5 minutes.
void refreshConnecteurs()
setInterval(() => void refreshConnecteurs(), 5 * 60_000).unref()
// Tarifs des modèles hors configuration (autres moteurs) : relus une fois par jour au plus.
void rafraichirCatalogue()
setInterval(() => void rafraichirCatalogue(), 6 * 3_600_000).unref()

// Google (Gmail, Agenda, Drive) : identifiants du client dans les secrets, accès de chacun vérifié en arrière-plan.
const googleReady = initGoogle()
// Notifications du téléphone : clé VAPID lue dans les secrets (créée au premier démarrage).
await initPush()

const server = createHttpServer()
// Clés du serveur : celles du propriétaire. Chaque autre compte range les siennes (Réglages › Clés API).
// Ollama sur cette machine, sans adresse donnée : détecté au démarrage, le modèle local se choisit alors
// dans Réglages › Moteurs sans autre réglage. CODE_OLLAMA_URL vide (« CODE_OLLAMA_URL= ») le désactive.
if (!codeConfig.brain.compat.ollama && process.env.CODE_OLLAMA_URL !== '') {
  const local = 'http://127.0.0.1:11434'
  const present = await fetch(`${local}/api/version`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false)
  if (present) codeConfig.brain.compat.ollama = `${local}/v1`
}
// Sans clé Anthropic mais avec Ollama : le modèle local devient le moteur par défaut, pour qu'une
// installation neuve réponde tout de suite. Chacun le change dans Réglages › Moteurs.
let moteurLocal: string | null = null
if (codeConfig.brain.compat.ollama && !secrets.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  moteurLocal = await modeleOllama(codeConfig.brain.compat.ollama)
  if (moteurLocal) {
    for (const role of ROLES_MOTEUR) codeConfig.reglages.moteurs[role] = { fournisseur: 'ollama', modele: moteurLocal }
  }
}

const { sessions } = startGateway(server, secrets)
await sessions.get(owner).ready
const { host } = codeConfig.server
const port = codeConfig.server.port

server.listen(port, host, () => {
  const missing = [
    !secrets.ANTHROPIC_API_KEY && !moteurLocal && 'ANTHROPIC_API_KEY',
    !secrets.DEEPGRAM_API_KEY && !secrets.GROQ_API_KEY && 'DEEPGRAM_API_KEY ou GROQ_API_KEY',
    !secrets.ELEVENLABS_API_KEY && !secrets.OPENAI_API_KEY && 'ELEVENLABS_API_KEY ou OPENAI_API_KEY'
  ].filter(Boolean)

  console.log(`[code] Serveur prêt sur http://${host}:${port}  (WebSocket : /ws)`)
  console.log(`[code] Voix de l’assistant (propriétaire) : ${sessions.get(owner).voiceProvider}`)
  const users = listUsers()
  console.log(`[code] Utilisateurs : ${users.map((u) => `${u.prenom || u.nom || `n° ${u.id}`}${u.proprietaire ? ' (propriétaire)' : ''}`).join(', ')}`)
  const speaker = sessions.get(owner).speaker.status
  console.log(
    `[code] Reconnaissance de la voix du propriétaire : ${
      !speaker.available ? 'indisponible (modèle absent : node scripts/modele-voix.mjs)' : speaker.enabled ? 'active' : 'empreinte à enregistrer depuis l’app de bureau'
    }`
  )
  void googleReady.then(() => console.log(`[code] Google (Gmail, Agenda) du propriétaire : ${googleStatus(owner).message}`))
  const abonnes = pushInfo(owner).abonnes
  console.log(`[code] Notifications du téléphone : ${abonnes ? `${abonnes} abonné(s)` : 'aucun téléphone abonné (cloche dans l’app du téléphone)'}`)
  if (moteurLocal) console.log(`[code] Modèle local : Ollama relié (${codeConfig.brain.compat.ollama}), ${moteurLocal} répond par défaut (pas de clé Anthropic)`)
  else if (codeConfig.brain.compat.ollama) console.log(`[code] Modèle local : Ollama relié (${codeConfig.brain.compat.ollama}), à choisir dans Réglages › Moteurs`)
  if (missing.length) console.log(`[code] Clés du serveur manquantes : ${missing.join(' · ')}  →  npm run secrets, ou Réglages › Clés API`)
  // Serveur hébergé sans app de bureau sur la même machine : un code pour associer le premier appareil.
  if (!listDevices(owner).some((d) => d.vuLe !== null)) {
    console.log(`[code] Premier appareil : code d’association ${issuePairCode(owner)} (valable 10 minutes, nouveau code à chaque démarrage).`)
  }
  console.log(
    codeConfig.server.publicUrl
      ? `[code] Téléphone : ouvrez ${codeConfig.server.publicUrl}, puis associez-le depuis le cockpit de l’ordinateur (QR).`
      : `[code] Téléphone : rendez le serveur joignable en HTTPS (par exemple « tailscale serve --bg ${port} »), puis associez-le depuis le cockpit de l’ordinateur (QR).`
  )
})

// Arrêt immédiat : les clients se reconnectent seuls, inutile d'attendre la fermeture des WebSocket.
const stop = () => {
  server.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
