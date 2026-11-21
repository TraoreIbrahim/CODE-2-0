import { createHash, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { pairInfo } from '../pairing.ts'
import { clientLogPath } from '../paths.ts'
import { FOURNISSEURS, decode, encode, type ClientMessage, type DeviceKind, type ServerPayload } from '@code/protocol'
import type { Secrets } from '../secrets.ts'
import { createTts, type Tts } from '../voice/tts.ts'
import { codeConfig } from '../../../../config/code.config.ts'
import { startAlerteGoogle } from '../google/alerte.ts'
import { googleStatus, onGoogleStatus, setGoogleClient } from '../google/oauth.ts'
import { onUsage } from '../brain/usage.ts'
import { startScheduler } from '../scheduler/scheduler.ts'
import { onRappelsChange } from '../scheduler/store.ts'
import { onConnecteurAutorise } from '../connecteurs/registre.ts'
import { onTachesChange } from '../scheduler/tasks.ts'
import { onEcheancesChange } from '../echeances/store.ts'
import { onCompetencesChange } from '../competences/store.ts'
import { cloreAbandonnees, onReunionsChange } from '../reunions/store.ts'
import { fileReunions } from '../reunions/transcrire.ts'
import { ProposeurReunions } from '../reunions/agenda.ts'
import { listEvents } from '../tools/agenda.ts'
import { localDay } from '../google/calendar.ts'
import { motsDuLexique } from '../tools/memory.ts'
import { onListesChange } from '../listes/store.ts'
import { startAlertesProjets } from '../connecteurs/alertes.ts'
import { listConnecteurs } from '../connecteurs/store.ts'
import { setTaskRunner } from '../tools/taches.ts'
import { runAsUser } from '../users/scope.ts'
import { checkCle, deleteCle, isCle, keysFor, listCles, setCle } from '../users/cles.ts'
import { cancelInvitation, claimInvitation, issueInvitation, listComptes, listInvitations, login as loginCompte, setActif, setIdentifiants, setNom } from '../users/comptes.ts'
import {
  authenticate,
  claimPairCode,
  getUser,
  issueDevice,
  issuePairCode,
  listDevices,
  listUsers,
  ownerId,
  revokeDevice,
  userInfo,
  type AppareilType
} from '../users/users.ts'
import { Session, type Io } from './session.ts'

type Connection = {
  id: string
  ws: WebSocket
  device: DeviceKind | null
  /** Utilisateur authentifié, et son appareil (jeton) ; null avant l'authentification. */
  uid: number | null
  appareilId: number | null
  alive: boolean
  missed: number
}

const AUTH_TIMEOUT_MS = 5_000
/** Après un identifiant refusé, le temps de corriger et de réessayer sur la même connexion. */
const RETRY_TIMEOUT_MS = 2 * 60_000
const HEARTBEAT_MS = 15_000
/** Essais d'association, de connexion et d'invitation : au plus 10 par connexion (et par identifiant), sur 10 minutes. */
const PAIR_WINDOW_MS = 10 * 60_000
const PAIR_MAX_PER_CONN = 10

/** Les sessions des utilisateurs, créées à la demande (premier appareil, premier rappel). */
export class Sessions {
  private readonly map = new Map<number, Session>()

  constructor(private readonly make: (uid: number) => Session) {}

  get(uid: number): Session {
    let s = this.map.get(uid)
    if (!s) {
      s = this.make(uid)
      this.map.set(uid, s)
    }
    return s
  }

  /** La session si elle existe déjà (sans la créer). */
  peek(uid: number): Session | undefined {
    return this.map.get(uid)
  }
}

const deviceType = (d: DeviceKind): AppareilType => (d === 'mobile' ? 'mobile' : 'mac')
const deviceName = (d: DeviceKind, nom: unknown) => (typeof nom === 'string' && nom.trim() ? nom.trim().slice(0, 40) : d === 'mobile' ? 'Téléphone' : 'Ordinateur')
/** Un identifiant d'entité Home Assistant (« light.salon ») ; vide sinon. */
const entiteDe = (v: unknown) => (typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]{1,120}$/.test(v) ? v : '')
const isDevice = (d: unknown): d is DeviceKind => d === 'mac' || d === 'mini' || d === 'mobile'

/**
 * Fichiers de l'ordinateur : seulement le propriétaire, sur le Mac où tourne le serveur, et s'il y a
 * relié son app de bureau. Personne d'autre ne voit jamais les fichiers de cette machine.
 */
function fichiersFor(uid: number): boolean {
  if (process.platform !== 'darwin' || uid !== ownerId()) return false
  return listDevices(uid).some((d) => d.type === 'mac')
}

/**
 * Passerelle WebSocket : authentifie chaque appareil (son jeton désigne son utilisateur), relaie ses
 * messages à la session de cet utilisateur et ne diffuse qu'à ses appareils à lui.
 */
export function startGateway(server: Server, secrets: Secrets): { sessions: Sessions } {
  const connections = new Map<string, Connection>()

  // Une voix par jeu de clés de synthèse : les comptes qui ont les mêmes la partagent. CODE_NO_TTS : tests sans voix.
  const voix = new Map<string, Promise<Tts | null>>()
  const voixFor = (s: Secrets): Promise<Tts | null> => {
    if (process.env.CODE_NO_TTS) return Promise.resolve(null)
    const key = createHash('sha256').update([s.ELEVENLABS_API_KEY, s.OPENAI_API_KEY, s.DEEPGRAM_API_KEY, s.GEMINI_API_KEY].map((k) => k ?? '').join('\0')).digest('hex')
    let tts = voix.get(key)
    if (!tts) voix.set(key, (tts = createTts(s)))
    return tts
  }

  const ioFor = (uid: number): Io => ({
    broadcast(payload) {
      const data = encode(payload)
      for (const c of connections.values()) {
        if (c.uid === uid && c.device && c.ws.readyState === WebSocket.OPEN) c.ws.send(data)
      }
    },
    // Une connexion d'un autre utilisateur n'est jamais servie, même avec son identifiant.
    send(id, payload) {
      const c = connections.get(id)
      if (c?.uid === uid && c.device && c.ws.readyState === WebSocket.OPEN) c.ws.send(encode(payload))
    },
    sendBinary(id, data) {
      const c = connections.get(id)
      if (c?.uid === uid && c.device && c.ws.readyState === WebSocket.OPEN) c.ws.send(data, { binary: true })
    }
  })

  const sessions = new Sessions((uid) => new Session(uid, { io: ioFor(uid), cles: () => keysFor(uid, secrets), voix: voixFor, fichiers: () => fichiersFor(uid) }))

  // Ce qui change en base ou chez Google n'atteint que les écrans de l'utilisateur concerné.
  onRappelsChange((uid) => sessions.peek(uid)?.onRemindersChanged())
  onTachesChange((uid) => sessions.peek(uid)?.onTasksChanged())
  onEcheancesChange((uid) => sessions.peek(uid)?.onEcheancesChanged())
  onCompetencesChange((uid) => sessions.peek(uid)?.onCompetencesChanged())
  // Réunions : la file transcrit avec les clés de chacun ; la fin s'annonce même si aucun écran n'est ouvert.
  onReunionsChange((uid, id) => runAsUser(uid, () => sessions.get(uid).onReunionChanged(id)))
  fileReunions.configurer({ cles: (uid) => keysFor(uid, secrets), mots: (uid) => motsDuLexique(uid) })
  const cloreReunions = () => {
    for (const r of cloreAbandonnees(Date.now())) fileReunions.planifier(r.id)
  }
  cloreReunions()
  setInterval(cloreReunions, 5 * 60_000).unref()
  fileReunions.reprendre()
  // Une liste partagée : chacun de ceux qui la voient (ou la voyaient, partage retiré).
  onListesChange((uids, id) => {
    for (const uid of uids) sessions.peek(uid)?.onListeChanged(id)
  })
  onConnecteurAutorise((uid, libelle, ok) => sessions.peek(uid)?.onConnecteurAutorise(libelle, ok))
  onGoogleStatus((uid) => sessions.peek(uid)?.onGoogleStatus())
  onUsage((uid) => {
    sessions.peek(uid)?.onUsageChanged()
    // La vue par personne du propriétaire suit aussi.
    const owner = ownerId()
    if (owner !== null && owner !== uid) sessions.peek(owner)?.onUsageChanged()
  })
  setTaskRunner((uid, t, retard) => sessions.get(uid).runTask(t, retard))

  // Une réunion en visio de l'agenda commence : proposée à l'enregistrement, sur ses écrans ouverts seulement.
  const proposeur = new ProposeurReunions({
    evenements: async (uid, now) => {
      const u = listUsers().find((x) => x.id === uid)
      const g = googleStatus(uid)
      if (!u?.reglages.reunionsAgenda || g.etat !== 'connecte' || !g.agenda) return null
      return runAsUser(uid, () => listEvents(localDay(now, u.reglages.fuseau), 1))
    },
    proposer: (uid, v) => runAsUser(uid, () => sessions.peek(uid)?.onVisioProche(v) ?? false)
  })

  // CODE_TACHES_DE_FOND=0 : un second serveur (avant une bascule) ne sonne ni n'annonce rien en double.
  if (process.env.CODE_TACHES_DE_FOND === '0') console.log('[code] Tâches de fond coupées (rappels, briefing, alertes de projets).')
  else startBackground()

  function startBackground(): void {
    startScheduler({
      users: () => listUsers().filter((u) => u.actif).map((u) => ({ id: u.id, tz: u.reglages.fuseau, briefing: u.reglages.briefing })),
      halted: (uid) => sessions.peek(uid)?.halted ?? false,
      fire: (uid, r) => runAsUser(uid, () => sessions.get(uid).onReminderFire(r)),
      briefing: (uid) => runAsUser(uid, () => sessions.get(uid).startBriefing()),
      briefingWaiting: (uid) => void runAsUser(uid, () => sessions.get(uid).pushBriefing()),
      runTask: (uid, t, retard) => void sessions.get(uid).runTask(t, retard),
      reunions: (uid, now) => proposeur.tick(uid, now)
    })
    // Accès Google bientôt coupé (7 jours en mode test) : annoncé la veille.
    startAlerteGoogle(
      () => listUsers().filter((u) => u.actif).map((u) => u.id),
      (uid, expireLe) => runAsUser(uid, () => sessions.get(uid).onGoogleBientot(expireLe))
    )
    // Échecs de ses projets (déploiements Vercel, GitHub Actions, builds Expo) : annoncés avec leur cause.
    startAlertesProjets(
      () => listUsers().filter((u) => u.actif).map((u) => u.id),
      (uid) => (listConnecteurs(uid).some((c) => c.service === 'github' || c.service === 'vercel' || c.service === 'expo') ? sessions.get(uid).projetsHooks() : null)
    )
  }

  const attempts = new Map<string, number[]>()
  const tooMany = (key: string, max: number, now: number) => {
    const recent = (attempts.get(key) ?? []).filter((t) => now - t < PAIR_WINDOW_MS)
    recent.push(now)
    attempts.set(key, recent)
    return recent.length > max
  }

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 })

  wss.on('connection', (ws) => {
    const conn: Connection = { id: randomUUID(), ws, device: null, uid: null, appareilId: null, alive: true, missed: 0 }
    connections.set(conn.id, conn)
    const reply = (payload: ServerPayload) => ws.readyState === WebSocket.OPEN && ws.send(encode(payload))
    let authTimer: NodeJS.Timeout | null = null
    const armAuthTimer = (ms: number) => {
      if (authTimer) clearTimeout(authTimer)
      authTimer = setTimeout(() => {
        if (conn.uid === null) ws.close(4401, 'authentification requise')
      }, ms)
    }
    armAuthTimer(AUTH_TIMEOUT_MS)

    /** L'appareil est authentifié : il rejoint la session de son utilisateur. */
    const attach = (uid: number, appareilId: number, device: DeviceKind) => {
      if (conn.uid !== null && conn.uid !== uid) sessions.peek(conn.uid)?.onDisconnect(conn.id)
      conn.uid = uid
      conn.appareilId = appareilId
      conn.device = device
      if (authTimer) clearTimeout(authTimer)
      reply(sessions.get(uid).welcome(conn.id, device, appareilId))
    }

    ws.on('pong', () => {
      conn.alive = true
      conn.missed = 0
    })
    ws.on('close', () => {
      if (authTimer) clearTimeout(authTimer)
      connections.delete(conn.id)
      if (conn.uid !== null) sessions.peek(conn.uid)?.onDisconnect(conn.id)
    })

    ws.on('message', (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        if (conn.uid !== null && conn.device) sessions.get(conn.uid).onAudio(conn.id, toBuffer(raw))
        return
      }
      const msg = decode<ClientMessage>(raw.toString())
      if (!msg) return reply({ type: 'error', code: 'protocole', message: 'Message illisible.' })

      // Connexion, association et invitation : avant (ou à la place de) l'authentification par jeton.
      if (msg.type === 'auth.login' || msg.type === 'auth.pair' || msg.type === 'auth.invitation') {
        void (msg.type === 'auth.login' ? login(msg) : msg.type === 'auth.pair' ? pair(msg) : invitation(msg)).catch((err) => {
          console.error('[gateway] connexion :', err)
          reply({ type: 'auth.error', code: 'indisponible', message: 'Connexion impossible pour le moment. Réessayez dans un instant.' })
        })
        return
      }

      if (conn.uid === null) {
        const auth = msg.type === 'hello' && typeof msg.token === 'string' && isDevice(msg.device) ? authenticate(msg.token) : null
        if (!auth) {
          ws.close(4401, 'jeton invalide')
          return
        }
        attach(auth.utilisateur.id, auth.appareil.id, msg.type === 'hello' ? msg.device : 'mobile')
        return
      }

      const uid = conn.uid
      void runAsUser(uid, () => handle(conn, uid, msg)).catch((err) => {
        console.error('[gateway]', err)
        reply({ type: 'error', code: 'interne', message: 'Erreur interne du serveur.' })
      })
    })

    /** Connexion à un compte local : identifiant et mot de passe contre un jeton de cet appareil. */
    async function login(msg: Extract<ClientMessage, { type: 'auth.login' }>): Promise<void> {
      if (conn.uid === null) armAuthTimer(RETRY_TIMEOUT_MS)
      const now = Date.now()
      const identifiant = typeof msg.identifiant === 'string' ? msg.identifiant.trim().toLowerCase().slice(0, 64) : ''
      if (tooMany(`login:${conn.id}`, PAIR_MAX_PER_CONN, now) || tooMany(`login-id:${identifiant}`, PAIR_MAX_PER_CONN, now)) {
        return void reply({ type: 'auth.error', code: 'trop_d_essais', message: 'Trop d’essais : réessayez dans quelques minutes.' })
      }
      if (!isDevice(msg.device)) return void reply({ type: 'auth.error', code: 'identifiants', message: 'Appareil inconnu.' })
      const res = await loginCompte(identifiant, msg.motDePasse)
      if (res === 'identifiants') return void reply({ type: 'auth.error', code: 'identifiants', message: 'Identifiant ou mot de passe incorrect.' })
      if (res === 'inactif') return void reply({ type: 'auth.error', code: 'inactif', message: 'Ce compte est désactivé : voyez avec le propriétaire de l’installation.' })
      const { token, appareil } = issueDevice(res.id, deviceType(msg.device), deviceName(msg.device, msg.nom))
      console.log(`[gateway] Utilisateur ${res.id} : connexion par mot de passe (${appareil.type} « ${appareil.nom} »)`)
      reply({ type: 'auth.ok', token, utilisateur: userInfo(res) })
      attach(res.id, appareil.id, msg.device)
    }

    /** Invitation du propriétaire : le code contre un nouveau compte, connecté sur cet appareil. */
    async function invitation(msg: Extract<ClientMessage, { type: 'auth.invitation' }>): Promise<void> {
      if (conn.uid === null) armAuthTimer(RETRY_TIMEOUT_MS)
      if (tooMany(`invitation:${conn.id}`, PAIR_MAX_PER_CONN, Date.now())) {
        return void reply({ type: 'auth.error', code: 'trop_d_essais', message: 'Trop d’essais : réessayez dans quelques minutes.' })
      }
      if (!isDevice(msg.device)) return void reply({ type: 'auth.error', code: 'invitation', message: 'Appareil inconnu.' })
      const res = await claimInvitation(msg.code, { prenom: msg.prenom, identifiant: msg.identifiant, motDePasse: msg.motDePasse })
      if (!res.ok) return void reply({ type: 'auth.error', code: 'invitation', message: res.message, ...(res.champ && res.champ !== 'code' ? { champ: res.champ } : {}) })
      const u = res.utilisateur
      const { token, appareil } = issueDevice(u.id, deviceType(msg.device), deviceName(msg.device, msg.nom))
      console.log(`[gateway] Utilisateur ${u.id} : compte créé par invitation (${appareil.type} « ${appareil.nom} »)`)
      reply({ type: 'auth.ok', token, utilisateur: userInfo(u) })
      attach(u.id, appareil.id, msg.device)
      const owner = ownerId()
      if (owner !== null) ioFor(owner).broadcast(comptesPayload())
    }

    /** Association par le QR de l'ordinateur : le code à usage unique contre un jeton du même utilisateur. */
    async function pair(msg: Extract<ClientMessage, { type: 'auth.pair' }>): Promise<void> {
      if (tooMany(`pair:${conn.id}`, PAIR_MAX_PER_CONN, Date.now())) {
        return void reply({ type: 'auth.error', code: 'trop_d_essais', message: 'Trop d’essais : réessayez dans quelques minutes.' })
      }
      const uid = typeof msg.code === 'string' && isDevice(msg.device) ? claimPairCode(msg.code) : null
      const user = uid !== null ? getUser(uid) : null
      if (!user || !isDevice(msg.device)) {
        if (conn.uid === null) armAuthTimer(RETRY_TIMEOUT_MS)
        return void reply({ type: 'auth.error', code: 'code', message: 'Ce code d’association n’est plus valable : affichez-en un nouveau sur l’ordinateur.' })
      }
      const { token, appareil } = issueDevice(user.id, deviceType(msg.device), deviceName(msg.device, msg.nom))
      console.log(`[gateway] Utilisateur ${user.id} : appareil associé (${appareil.type} « ${appareil.nom} »)`)
      reply({ type: 'auth.ok', token, utilisateur: userInfo(user) })
      attach(user.id, appareil.id, msg.device)
    }
  })

  /** Écrit une ligne du journal technique d'un appareil (bornée en taille et en débit). */
  const logBudget = new Map<string, { at: number; n: number }>()
  function logFromDevice(conn: Connection, message: string): void {
    const now = Date.now()
    const b = logBudget.get(conn.id) ?? { at: now, n: 0 }
    if (now - b.at > 60_000) Object.assign(b, { at: now, n: 0 })
    if (++b.n > 120) return
    logBudget.set(conn.id, b)
    const line = `${new Date(now).toISOString()} [${conn.device} · utilisateur ${conn.uid}] ${message.replace(/[\r\n]+/g, ' ').slice(0, 500)}`
    console.log(`[appareil] ${line}`)
    try {
      if ((statSync(clientLogPath, { throwIfNoEntry: false })?.size ?? 0) > 2_000_000) writeFileSync(clientLogPath, '')
      appendFileSync(clientLogPath, line + '\n')
    } catch {}
  }

  const comptesPayload = (): ServerPayload => ({ type: 'comptes', comptes: listComptes(), invitations: listInvitations() })
  const clesPayload = (uid: number): ServerPayload => ({ type: 'cles', cles: listCles(uid, secrets) })

  /** Coupe toutes les connexions d'un utilisateur (compte désactivé). */
  function closeUser(uid: number): void {
    for (const c of connections.values()) if (c.uid === uid) c.ws.close(4401, 'compte désactivé')
  }

  /** Coupe toutes les connexions d'un appareil révoqué. */
  function closeDevice(uid: number, appareilId: number): void {
    for (const c of connections.values()) if (c.uid === uid && c.appareilId === appareilId) c.ws.close(4401, 'appareil déconnecté')
  }

  async function handle(conn: Connection, uid: number, msg: ClientMessage): Promise<void> {
    const session = sessions.get(uid)
    const send = (payload: ServerPayload) => {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(encode(payload))
    }
    switch (msg.type) {
      case 'audio.start':
        return session.onAudioStart(conn.id, msg.overReply === true, msg.called === true)
      case 'audio.end':
        return session.onAudioEnd(conn.id)
      case 'audio.cancel':
        return session.onAudioCancel(conn.id)
      case 'text':
        return session.onText(conn.id, String(msg.text ?? ''), msg.voice !== false)
      case 'interrupt':
        return session.onInterrupt()
      case 'confirm':
        return session.onConfirm(msg.actionId, true)
      case 'cancel':
        return session.onConfirm(msg.actionId, false)
      case 'halt':
        return session.onHalt()
      case 'resume':
        return session.onResume()
      case 'ui.action':
        return session.onUiAction(conn.id, msg.action, String(msg.chemin ?? ''), String(msg.turnId ?? ''))
      case 'ui.page':
        return session.onUiPage(conn.id, String(msg.viewId ?? ''), String(msg.turnId ?? ''), String(msg.tool ?? ''), msg.args && typeof msg.args === 'object' ? (msg.args as Record<string, unknown>) : {})
      case 'enroll.start':
        return session.onEnrollStart(conn.id)
      case 'enroll.end':
        return session.onEnrollEnd(conn.id)
      case 'enroll.cancel':
        return session.onEnrollCancel(conn.id)
      case 'speaker.reset':
        return session.onSpeakerReset()
      case 'conversation.set':
        return void session.setConversation(conn.id, msg.active === true)
      case 'ping':
        return send({ type: 'pong' })
      case 'client.log':
        return logFromDevice(conn, String(msg.message ?? ''))
      case 'pair.request':
        // Le lien contient un code d'association à usage unique : il n'est donné qu'à l'app de bureau.
        if (conn.device !== 'mac') return send({ type: 'error', code: 'action', message: 'L’association se fait depuis l’ordinateur.' })
        return send({ type: 'pair.info', info: await pairInfo((server.address() as AddressInfo).port, issuePairCode(uid)) })
      case 'google.connect':
        // Serveur sur l'ordinateur : Google revient sur une boucle locale, la connexion se lance depuis l'app de bureau.
        // Hébergé : Google revient sur l'adresse publique, depuis n'importe quel appareil.
        if (conn.device !== 'mac' && !codeConfig.server.publicUrl) return send({ type: 'error', code: 'action', message: 'Google se connecte depuis l’ordinateur qui fait tourner le serveur.' })
        return session.onGoogleConnect(conn.id)
      case 'google.disconnect':
        return session.onGoogleDisconnect()
      case 'google.identifiants': {
        if (uid !== ownerId()) return send({ type: 'google.identifiants', ok: false, message: 'Seul le propriétaire de l’installation relie Google.' })
        if (tooMany(`google:${uid}`, PAIR_MAX_PER_CONN, Date.now())) return send({ type: 'google.identifiants', ok: false, message: 'Trop d’essais : réessayez dans quelques minutes.' })
        const r = await setGoogleClient(msg.clientId, msg.clientSecret)
        console.log(`[gateway] Utilisateur ${uid} : identifiants Google ${r.ok ? 'enregistrés' : 'refusés'}`)
        send({ type: 'google.identifiants', ...r })
        if (r.ok) ioFor(uid).broadcast({ type: 'google.status', status: googleStatus(uid) })
        return
      }
      case 'perso.refresh':
        return session.onPersoRefresh(conn.id)
      case 'meteo.refresh':
        return session.onMeteoRefresh(conn.id)
      case 'position':
        return session.onPosition(conn.id, msg)
      case 'pont.pret':
        return session.onPontPret(conn.id, msg.outils)
      case 'pont.resultat':
        return session.onPontErreur(conn.id, msg.id, msg.erreur)
      case 'reminder.action':
        return session.onReminderAction(conn.id, Number(msg.id), msg.action === 'fait' ? 'fait' : 'reporter', Number(msg.minutes) || 10)
      case 'task.action':
        return session.onTaskAction(conn.id, Number(msg.id), msg.action === 'pause' ? 'pause' : msg.action === 'reprendre' ? 'reprendre' : 'executer')
      case 'document':
        return void session.onDocument(conn.id, Number(msg.id), msg.voice !== false)
      case 'echeance.regler':
        return session.onEcheanceReglee(conn.id, Number(msg.id))
      case 'liste.cocher':
        return session.onListeCocher(conn.id, Number(msg.liste), Number(msg.element), msg.coche === true)
      case 'maison.basculer':
        return void session.onMaisonBasculer(conn.id, entiteDe(msg.entite))
      case 'maison.camera':
        return void session.onMaisonCamera(conn.id, entiteDe(msg.entite))
      case 'push.subscribe':
        return session.onPushSubscribe(conn.id, msg.subscription)
      case 'push.unsubscribe':
        return session.onPushUnsubscribe(String(msg.endpoint ?? ''))
      case 'push.test':
        return session.onPushTest(conn.id)
      case 'presence':
        return session.onPresence(conn.id, msg.voice !== false)
      case 'usage.request':
        return send({ type: 'usage', usage: session.usage() })
      case 'reglages.get':
        return send(session.reglagesPayload())
      case 'reglages.set':
        return session.onReglagesSet(conn.id, msg.reglages)
      case 'voix.echantillon':
        return session.onVoiceSample(conn.id, String(msg.voix ?? ''), Number(msg.vitesse))
      case 'voix.bibliotheque': {
        const f = (msg.filtres ?? {}) as Record<string, unknown>
        return session.onVoixBibliotheque(conn.id, {
          recherche: typeof f.recherche === 'string' ? f.recherche.slice(0, 80) : undefined,
          genre: f.genre === 'femme' || f.genre === 'homme' ? f.genre : undefined,
          usage: f.usage === 'conversation' || f.usage === 'narration' || f.usage === 'infos' ? f.usage : undefined,
          page: Number.isFinite(Number(f.page)) ? Number(f.page) : 0
        })
      }
      case 'voix.ajouter':
        return session.onVoixAjouter(conn.id, String(msg.auteur ?? ''), String(msg.id ?? ''), String(msg.nom ?? '').slice(0, 60))
      case 'assistant.fini':
        return session.onAssistantFini(conn.id, msg.presentation === true)
      case 'boites.lister':
        return send(session.boitesPayload())
      case 'boite.ajouter':
        return session.onBoiteAjouter(conn.id, msg)
      case 'boite.retirer':
        return session.onBoiteRetirer(Number(msg.id))
      case 'boite.defaut':
        return session.onBoiteDefaut(Number(msg.id))
      case 'reunion.demarrer':
        return session.onReunionDemarrer(conn.id, msg)
      case 'reunion.terminer':
        return Number.isInteger(msg.reunion) ? session.onReunionTerminer(msg.reunion) : undefined
      case 'reunion.annuler':
        return Number.isInteger(msg.reunion) ? session.onReunionAnnuler(msg.reunion) : undefined
      case 'reunion.pause':
        return Number.isInteger(msg.reunion) ? void session.onReunionPause(msg.reunion, msg.pause === true) : undefined
      case 'reunion.stop':
        return Number.isInteger(msg.reunion) ? session.onReunionStop(msg.reunion) : undefined
      case 'reunions.lister':
        return send(session.reunionsPayload())
      case 'competences.lister':
        return send(session.competencesPayload())
      case 'competence.enregistrer':
        return session.onCompetenceEnregistrer(conn.id, msg)
      case 'competence.supprimer':
        return typeof msg.competence === 'string' ? session.onCompetenceSupprimer(msg.competence) : undefined
      case 'connecteurs.lister':
        return send(session.connecteursPayload())
      case 'connecteur.ajouter':
        return session.onConnecteurAjouter(conn.id, msg)
      case 'connecteur.autoriser':
        return session.authorizeConnecteur(conn.id, Number(msg.id))
      case 'connecteur.retirer':
        return session.onConnecteurRetirer(Number(msg.id))
      case 'connecteur.complement':
        return session.onConnecteurComplement(conn.id, Number(msg.id), String(msg.jeton ?? ''))
      case 'devices.list':
        return send({ type: 'devices', appareils: listDevices(uid), courant: conn.appareilId ?? 0 })
      case 'device.revoke': {
        const id = Number(msg.id)
        if (!revokeDevice(uid, id)) return send({ type: 'error', code: 'action', message: 'Cet appareil n’est plus connecté.' })
        console.log(`[gateway] Utilisateur ${uid} : appareil ${id} révoqué`)
        send({ type: 'devices', appareils: listDevices(uid), courant: conn.appareilId ?? 0 })
        return closeDevice(uid, id)
      }
      case 'compte.nom': {
        const res = setNom(uid, msg.prenom, msg.nom)
        if (!res.ok) return send({ type: 'compte.resultat', ok: false, message: res.message, ...(res.champ ? { champ: res.champ } : {}) })
        ioFor(uid).broadcast(session.reglagesPayload())
        const owner = ownerId()
        if (owner !== null) ioFor(owner).broadcast(comptesPayload())
        return
      }
      case 'compte.identifiants': {
        if (tooMany(`mdp:${uid}`, PAIR_MAX_PER_CONN, Date.now())) return send({ type: 'compte.resultat', ok: false, message: 'Trop d’essais : réessayez dans quelques minutes.' })
        const res = await setIdentifiants(uid, msg.identifiant, msg.motDePasse, msg.ancien)
        if (!res.ok) return send({ type: 'compte.resultat', ok: false, message: res.message, ...(res.champ ? { champ: res.champ } : {}) })
        console.log(`[gateway] Utilisateur ${uid} : identifiants de connexion changés`)
        send({ type: 'compte.resultat', ok: true, message: 'Identifiants enregistrés.' })
        ioFor(uid).broadcast(session.reglagesPayload())
        const owner = ownerId()
        if (owner !== null) ioFor(owner).broadcast(comptesPayload())
        return
      }
      case 'comptes.lister':
      case 'invitation.creer':
      case 'invitation.annuler':
      case 'compte.actif': {
        // Les comptes de l'installation ne regardent que son propriétaire.
        if (uid !== ownerId()) return send({ type: 'error', code: 'action', message: 'Seul le propriétaire gère les comptes.' })
        if (msg.type === 'invitation.creer') {
          const inv = issueInvitation(msg.prenom)
          if (!inv.ok) return send({ type: 'error', code: 'invitation', message: inv.message })
          const lien = await pairInfo((server.address() as AddressInfo).port, inv.code.replace(/-/g, ''), 'i').catch(() => null)
          console.log(`[gateway] Utilisateur ${uid} : invitation créée`)
          send({ type: 'invitation', prenom: inv.prenom, code: inv.code, expire: inv.expire, ...(lien?.url ? { url: lien.url } : {}) })
        } else if (msg.type === 'invitation.annuler') {
          cancelInvitation(Number(msg.id))
        } else if (msg.type === 'compte.actif') {
          const id = Number(msg.id)
          if (!setActif(id, msg.actif === true)) return send({ type: 'error', code: 'action', message: 'Ce compte ne peut pas être modifié.' })
          console.log(`[gateway] Utilisateur ${uid} : compte ${id} ${msg.actif ? 'réactivé' : 'désactivé'}`)
          if (!msg.actif) closeUser(id)
        }
        return ioFor(uid).broadcast(comptesPayload())
      }
      case 'cles.lister':
        return send(clesPayload(uid))
      case 'cle.definir': {
        if (!isCle(msg.nom)) return send({ type: 'error', code: 'action', message: 'Clé inconnue.' })
        const nom = msg.nom
        const retiree = typeof msg.valeur === 'string' && msg.valeur.trim() === ''
        if (retiree) {
          deleteCle(uid, nom)
          send({ type: 'cle.resultat', nom, ok: true, message: 'Clé retirée.' })
        } else {
          const check = checkCle(nom, msg.valeur)
          if ('erreur' in check) return send({ type: 'cle.resultat', nom, ok: false, message: check.erreur })
          setCle(uid, nom, check.ok)
          send({ type: 'cle.resultat', nom, ok: true, message: 'Clé enregistrée.' })
        }
        console.log(`[gateway] Utilisateur ${uid} : clé ${nom} ${retiree ? 'retirée' : 'enregistrée'}`)
        ioFor(uid).broadcast(clesPayload(uid))
        // Moteur et voix suivent la nouvelle clé ; « voix disponible » peut changer.
        await session.reloadKeys()
        return ioFor(uid).broadcast(session.reglagesPayload())
      }
      case 'moteurs.lister':
        return send(await session.moteursPayload())
      case 'moteurs.modeles':
        if (!FOURNISSEURS.includes(msg.fournisseur)) return send({ type: 'error', code: 'action', message: 'Fournisseur inconnu.' })
        return send(await session.modelesPayload(msg.fournisseur))
      case 'moteurs.banc': {
        if (!FOURNISSEURS.includes(msg.fournisseur) || typeof msg.modele !== 'string' || !/^[\w.:/@+-]{1,120}$/.test(msg.modele)) {
          return send({ type: 'error', code: 'action', message: 'Moteur inconnu.' })
        }
        const refus = session.lancerBanc({ fournisseur: msg.fournisseur, modele: msg.modele })
        if (refus) return send({ type: 'error', code: 'banc', message: refus })
        console.log(`[gateway] Utilisateur ${uid} : banc d’essai ${msg.fournisseur} ${msg.modele}`)
        return
      }
      case 'auth.logout':
        // Déconnexion de cet appareil : son jeton ne sert plus, l'écran revient à la connexion.
        if (conn.appareilId !== null) revokeDevice(uid, conn.appareilId)
        console.log(`[gateway] Utilisateur ${uid} : appareil ${conn.appareilId} déconnecté`)
        return closeDevice(uid, conn.appareilId ?? -1)
      case 'hello':
      case 'auth.login':
      case 'auth.pair':
      case 'auth.invitation':
        return
    }
  }

  // Coupe les connexions mortes (téléphone en veille, réseau perdu).
  const heartbeat = setInterval(() => {
    for (const c of connections.values()) {
      // Deux battements manqués (30 s) avant de couper : un téléphone peut rester muet quelques
      // secondes (Wi-Fi qui s'économise, page occupée) sans être perdu pour autant.
      if (!c.alive && ++c.missed >= 2) {
        c.ws.terminate()
        continue
      }
      c.alive = false
      c.ws.ping()
    }
  }, HEARTBEAT_MS)
  wss.on('close', () => clearInterval(heartbeat))

  return { sessions }
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (Array.isArray(raw)) return Buffer.concat(raw)
  return Buffer.from(raw)
}
