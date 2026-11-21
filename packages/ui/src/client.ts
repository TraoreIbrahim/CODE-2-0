import {
  decode,
  encode,
  type Appareil,
  type BoiteMail,
  type BancResultat,
  type CleApi,
  type CleInfo,
  type FournisseurId,
  type ModeleInfo,
  type MoteursEtat,
  type ClientPayload,
  type CompteInfo,
  type InvitationInfo,
  type CompetenceInfo,
  type UiReunionLigne,
  type ConnecteurInfo,
  type ConfirmOutcome,
  type ConfirmRequest,
  type ServiceConnecteur,
  type DeviceKind,
  type Etat,
  type GoogleStatus,
  type LogEntry,
  type PairInfo,
  type PersoResume,
  type PushInfo,
  type PushSubscriptionJson,
  type Reglages,
  type ReglagesErreurs,
  type VoixBibliotheque,
  type VoixChoix,
  type VoixRecherche,
  type UiMeteo,
  type UiRappel,
  type UiEcheance,
  type UiListe,
  type UiMaison,
  type UiTache,
  type ServerMessage,
  type SpeakerStatus,
  type Ecoute,
  type UiView,
  type Turn,
  type UsageResume,
  type UtilisateurInfo
} from '@code/protocol'
import { preparerDocument } from './document-envoi.ts'
import { Decoupeur, MicroReunion, decouperFichier, estAudio, wavDe, type Morceau } from './reunion-audio.ts'
import { primeAudio } from './audio.ts'

/** `auth` : pas (ou plus) de jeton sur cet appareil, l'écran de connexion s'affiche. */
export type Connection = 'connexion' | 'connecte' | 'injoignable' | 'refuse' | 'auth'

/** L'app Mac exécute les outils de fichiers pour le serveur hébergé (le pont) ; le résultat part par HTTP. */
export type PontClient = {
  outil(envoi: string, outil: string, input: Record<string, unknown>): Promise<void>
  executer(envoi: string, cle: string): Promise<void>
}

/** Connexion à un compte ou association en cours, et sa dernière erreur. */
/** `champ` : le champ du formulaire en cause (invitation : prénom, identifiant ou mot de passe refusé). */
export type AuthState = { busy: boolean; error: { code: string; message: string; champ?: string } | null }

/** Un message du fil de conversation (mode chat). */
export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; ts: number; streaming?: boolean; interrupted?: boolean }

const THREAD_MAX = 200
/** Panneaux rangés en miniature à côté de celui affiché. */
const PILE_MAX = 3

/** Texte affichable : sans la trace « [Résultats d'outils : …] » gardée dans l'historique pour Claude. */
function displayText(text: string): string {
  return text.replace(/\n?\[Résultats d’outils : [\s\S]*\]\s*$/, '').replace(/ \[interrompu\]$/, '').trim()
}

/**
 * Une réunion que cet appareil enregistre ou importe. `ouverture` : le serveur ou le micro n'a pas encore
 * répondu ; `preparation` : le fichier importé se décode ; `envoi` : l'enregistrement est fini, les derniers
 * morceaux partent ; `erreur` : rien n'est en cours, le message dit pourquoi.
 */
export type ReunionEnCours = {
  id: number | null
  source: 'micro' | 'fichier'
  etat: 'ouverture' | 'enregistrement' | 'preparation' | 'envoi' | 'erreur'
  titre: string
  /** Début de l'enregistrement (horloge de l'appareil). */
  debut: number
  /** Morceaux découpés, et morceaux arrivés au serveur. */
  decoupes: number
  envoyes: number
  /** Qui transcrit, et le prix de l'heure d'audio en dollars. */
  service?: string
  tarif?: number
  /**
   * Sur l'ordinateur : ce qui est capté. `micro` : le son de l'ordinateur n'a pas pu l'être (autorisation
   * système manquante), les personnes en visio ne s'entendent que par les haut-parleurs.
   */
  son?: 'micro+ordinateur' | 'micro'
  /** L'envoi attend le retour de la connexion. */
  enAttente?: boolean
  erreur?: string
}

export type ClientState = {
  connection: Connection
  serverState: Etat
  connectionId: string | null
  micOwner: string | null
  /** Ce que CODE comprend pendant qu'on parle. */
  partial: string
  /** Le sens de `text` (une transcription partielle), jugé par le serveur pendant une pause : phrase finie ou au milieu. */
  sens: { text: string; fini: boolean } | null
  /** Dernière phrase de l'utilisateur. */
  lastUser: string
  /** Réponse en cours ou dernière réponse de CODE. */
  reply: string
  replyTurnId: string | null
  history: Turn[]
  /** Fil de conversation : historique, messages envoyés, réponse en train de s'écrire. */
  thread: ChatMessage[]
  log: LogEntry[]
  pending: ConfirmRequest | null
  lastOutcome: { outcome: ConfirmOutcome; at: number } | null
  error: string | null
  /** Un papier en cours d'envoi depuis cet appareil, ou son échec. */
  documentEnvoi: { nom: string; erreur?: string } | null
  speaker: SpeakerStatus
  /** Relance après chaque réponse et mode conversation (micro ouvert sans clic), réglés par le serveur. */
  ecoute: Ecoute
  /** Enregistrement de l'empreinte vocale en cours sur cet appareil. */
  enroll: { percentage: number } | null
  enrollMessage: { ok: boolean; text: string } | null
  /** Association d'un téléphone (réponse à requestPair), null tant qu'elle n'est pas demandée. */
  pair: PairInfo | null
  /** Panneaux des outils du dernier tour (UI adaptative). */
  views: UiView[]
  /** Panneaux des tours précédents, rangés en miniature à côté (le plus récent d'abord) : un clic les ramène. */
  pile: UiView[][]
  /** Compte Google personnel (Gmail, Agenda). */
  google: GoogleStatus
  /** Rendez-vous du jour et mails importants (cockpit), après `refreshPerso`. */
  perso: PersoResume | null
  /** Carte météo de la ville de l'utilisateur (null : pas encore reçue). */
  meteo: { data: UiMeteo | null; erreur?: string; at: number } | null
  /** Rappels actifs : ceux qui sonnent (`etat: 'sonne'`) d'abord, puis à venir. */
  rappels: UiRappel[]
  /** Tâches planifiées et leur dernier résultat. */
  taches: UiTache[]
  /** Échéances à régler (carte « Échéances »). */
  echeances: UiEcheance[]
  /** Notifications du téléphone : clé du serveur et nombre d'abonnés. */
  push: PushInfo
  /** Réponse au dernier abonnement de cet appareil. */
  pushResult: { ok: boolean; message: string } | null
  /** L'utilisateur de cet appareil (après `welcome`). */
  utilisateur: UtilisateurInfo | null
  appareilId: number | null
  auth: AuthState
  /** Compteur de tokens (après `requestUsage`, puis à chaque appel compté). */
  usage: UsageResume | null
  /** Appareils de l'utilisateur (après `requestDevices`). */
  appareils: Appareil[] | null
  /** Boîtes mail IMAP reliées (adresse pro…), en plus de Gmail ; null tant que le serveur n'a pas répondu. */
  boites: BoiteMail[] | null
  /** Identifiants Google envoyés par le propriétaire : vérification en cours, puis la réponse. */
  googleIdentifiants: { busy: boolean; ok?: boolean; message?: string } | null
  /** Ajout d'une boîte en cours (test de connexion) et son résultat. */
  boiteAjout: { busy: boolean; ok?: boolean; message?: string; manuel?: boolean } | null
  /** L'enregistrement (ou l'import) d'une réunion en cours sur cet appareil. */
  reunion: ReunionEnCours | null
  /** Une réunion en visio de l'agenda commence : proposée à l'enregistrement, jusqu'à la réponse. */
  reunionProposee: { cle: string; titre: string; heure: string; service: string } | null
  /** Les réunions de la personne et leur avancement ; null tant que le serveur n'a pas répondu. */
  reunions: UiReunionLigne[] | null
  /** Compétences (méthodes en fichiers texte) et modèles livrés ; null tant que le serveur n'a pas répondu. */
  competences: CompetenceInfo[] | null
  modelesCompetences: CompetenceInfo[]
  /** Enregistrement d'une compétence en cours, puis sa réponse. */
  competenceAction: { busy: boolean; ok?: boolean; message?: string; id?: string } | null
  /** Connecteurs reliés (GitHub, Vercel…) et services proposés ; null tant que le serveur n'a pas répondu. */
  connecteurs: ConnecteurInfo[] | null
  catalogue: ServiceConnecteur[]
  /** Ajout ou autorisation d'un connecteur en cours, et son résultat (avec la page de consentement à ouvrir). */
  connecteurAction: { service: string; busy: boolean; ok?: boolean; message?: string; url?: string } | null
  /** Voix de CODE proposées, et synthèse disponible sur le serveur (après `requestReglages`). */
  voixChoix: VoixChoix[]
  synthese: boolean
  /** Une clé ElevenLabs est là : ses voix et la bibliothèque sont proposées. */
  elevenlabs: boolean
  /** La bibliothèque ElevenLabs ouverte : filtres, voix trouvées (pages accumulées), chargement ou erreur. */
  bibliotheque: { filtres: VoixRecherche; voix: VoixBibliotheque[]; suite: boolean; chargement: boolean; erreur?: string } | null
  /** Ajout d'une voix de la bibliothèque en cours, et son résultat. */
  voixAjout: { id: string; nom: string; busy: boolean; erreur?: string } | null
  /** Dernier changement de réglages refusé, champ par champ (rien n'a été enregistré). */
  reglagesErreurs: ReglagesErreurs | null
  /** Changement de ses identifiants en cours, et son résultat. */
  compteAction: { busy: boolean; ok?: boolean; message?: string; champ?: string } | null
  /** Propriétaire : comptes et invitations en attente (après `requestComptes`). */
  comptes: CompteInfo[] | null
  invitations: InvitationInfo[]
  /** La dernière invitation créée ici : son code n'est montré qu'à ce moment. */
  invitationCreee: { prenom: string; code: string; expire: number; url?: string } | null
  /** Coffre de clés API (après `requestCles`) : état de chaque clé, jamais sa valeur. */
  cles: CleInfo[] | null
  /** Enregistrement d'une clé en cours, et son résultat. */
  cleAction: { nom: CleApi; busy: boolean; ok?: boolean; message?: string } | null
  /** Réglages › Moteurs (après `requestMoteurs`) : Ollama, SearXNG et les bancs d'essai de l'installation. */
  moteurs: MoteursEtat | null
  /** Les modèles de chaque fournisseur, lus avec la clé de la personne (après `requestModeles`). */
  modeles: Partial<Record<FournisseurId, { liste: ModeleInfo[]; erreur?: string; busy: boolean }>>
  /** Le banc d'essai en cours ou le dernier lancé d'ici, scénario par scénario. */
  banc: BancResultat | null
}

type AudioHeader = { turnId: string; seq: number; levels: number[] }
type Events = {
  audio: (header: AudioHeader, pcm: ArrayBuffer) => void
  replyEnd: (interrupted: boolean) => void
  enrollDone: (ok: boolean) => void
  /** Le serveur a clos la phrase (suivi de la voix) : `fin`, à traiter ; `autre`, d'autres voix seulement. */
  audioStop: (reason: 'fin' | 'autre') => void
  /** Votre voix reconnue pendant la réponse de CODE : couper le son. */
  audioBarge: () => void
}

const PING_MS = 5_000
/** Sans réponse au ping pendant ce temps, la connexion est jugée morte. Large : un téléphone peut rester
 *  muet quelques secondes (Wi-Fi qui s'économise) ; couper trop tôt perdait la réponse en cours. */
const DEAD_AFTER_MS = 30_000

/** Connexion temps réel au serveur CODE, avec reconnexion automatique. */
export class CodeClient {
  private ws: WebSocket | null = null
  private state: ClientState = {
    connection: 'connexion',
    serverState: 'veille',
    connectionId: null,
    micOwner: null,
    partial: '',
    sens: null,
    lastUser: '',
    reply: '',
    replyTurnId: null,
    history: [],
    thread: [],
    log: [],
    pending: null,
    lastOutcome: null,
    error: null,
    documentEnvoi: null,
    speaker: { available: false, enrolled: false, enabled: false, appareils: [] },
    ecoute: { relanceMs: 0, conversation: null },
    enroll: null,
    enrollMessage: null,
    pair: null,
    views: [],
    pile: [],
    google: { etat: 'deconnecte', gmail: false, agenda: false, drive: false, message: '', mode: 'local', identifiants: null },
    googleIdentifiants: null,
    perso: null,
    meteo: null,
    rappels: [],
    taches: [],
    echeances: [],
    push: { publicKey: null, abonnes: 0 },
    pushResult: null,
    utilisateur: null,
    appareilId: null,
    auth: { busy: false, error: null },
    usage: null,
    appareils: null,
    boites: null,
    boiteAjout: null,
    reunion: null,
    reunionProposee: null,
    reunions: null,
    competences: null,
    modelesCompetences: [],
    competenceAction: null,
    connecteurs: null,
    catalogue: [],
    connecteurAction: null,
    voixChoix: [],
    synthese: false,
    elevenlabs: false,
    bibliotheque: null,
    voixAjout: null,
    reglagesErreurs: null,
    compteAction: null,
    comptes: null,
    invitations: [],
    invitationCreee: null,
    cles: null,
    cleAction: null,
    moteurs: null,
    modeles: {},
    banc: null
  }
  private listeners = new Set<() => void>()
  /** Moment où cet écran a demandé la connexion à Google (hébergé : il ouvre alors la page lui-même). */
  private googleDemande = 0
  private events: { [K in keyof Events]: Set<Events[K]> } = { audio: new Set(), replyEnd: new Set(), enrollDone: new Set(), audioStop: new Set(), audioBarge: new Set() }
  private audioHeader: AudioHeader | null = null
  private retry = 0
  private lastPong = 0
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private errorTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private visibilityHooked = false
  /** Journal de connexion, gardé jusqu'à la prochaine connexion réussie puis envoyé au serveur (diagnostic). */
  private connTrace: string[] = []
  private openedAt = 0

  /** Une étape de la connexion, horodatée depuis le chargement de la page. */
  private note(step: string): void {
    this.connTrace.push(`connexion +${Math.round(performance.now())} ms : ${step}`)
    if (this.connTrace.length > 30) this.connTrace.shift()
  }

  /** Connexion ou association à envoyer dès l'ouverture d'une connexion sans jeton. */
  private pendingAuth: ClientPayload | null = null
  private token: string | null

  /**
   * `token` : jeton de cet appareil, ou null (écran de connexion). `onToken` : un jeton vient d'être
   * donné (connexion, association) ou n'est plus valable (null) — à garder ou effacer sur l'appareil.
   */
  constructor(private readonly opts: { url: string; token: string | null; device: DeviceKind; nom?: string; onToken?: (token: string | null) => void; pont?: PontClient; sonSysteme?: () => Promise<MediaStream | null> }) {
    this.token = opts.token
    if (!this.token) this.state = { ...this.state, connection: 'auth' }
  }

  // ── Abonnement (compatible useSyncExternalStore) ──
  getState = (): ClientState => this.state
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  on<K extends keyof Events>(event: K, fn: Events[K]): () => void {
    this.events[event].add(fn)
    return () => this.events[event].delete(fn)
  }

  get isMicOwner(): boolean {
    return this.state.connectionId !== null && this.state.connectionId === this.state.micOwner
  }

  connect(): void {
    this.closed = false
    // Retour au premier plan (téléphone déverrouillé, app rouverte) : on vérifie la connexion tout de suite.
    if (typeof document !== 'undefined' && !this.visibilityHooked) {
      this.visibilityHooked = true
      document.addEventListener('visibilitychange', () => {
        // Sans jeton, la connexion porte une connexion en cours : la rouvrir la perdrait.
        if (document.hidden || this.closed || !this.ws || !this.token) return
        if (Date.now() - this.lastPong > DEAD_AFTER_MS) {
          this.note('retour au premier plan, connexion trop ancienne : reconnexion')
          this.reconnect()
        } else this.send({ type: 'ping' })
      })
    }
    const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav) this.note(`page chargée (réponse ${Math.round(nav.responseEnd)} ms, prête ${Math.round(nav.domContentLoadedEventEnd)} ms, ${nav.type})`)
    // Sans jeton, rien à ouvrir : la connexion s'ouvrira avec l'identifiant (login) ou le code (claimPair).
    if (this.token) this.open()
  }

  /**
   * Connexion à un compte de l'installation : l'identifiant et le mot de passe partent une fois au serveur,
   * qui répond avec le jeton de cet appareil.
   */
  login(identifiant: string, motDePasse: string): void {
    this.authenticate({ type: 'auth.login', identifiant, motDePasse, device: this.opts.device, ...(this.opts.nom ? { nom: this.opts.nom } : {}) })
  }

  /** Association par le QR du Mac : le code à usage unique contre un jeton de cet appareil. */
  claimPair(code: string): void {
    this.authenticate({ type: 'auth.pair', code, device: this.opts.device, ...(this.opts.nom ? { nom: this.opts.nom } : {}) })
  }

  /** Invitation du propriétaire : le code et le nouveau compte (prénom, identifiant, mot de passe), envoyés une fois. */
  joinInvitation(code: string, prenom: string, identifiant: string, motDePasse: string): void {
    this.authenticate({ type: 'auth.invitation', code, prenom, identifiant, motDePasse, device: this.opts.device, ...(this.opts.nom ? { nom: this.opts.nom } : {}) })
  }

  /** Son prénom et son nom : affichés tout de suite ici, confirmés par le serveur (refusés : `compteAction`). */
  setNom(prenom: string, nom: string): void {
    const u = this.state.utilisateur
    if (!this.send({ type: 'compte.nom', prenom, nom }) || !u) return
    this.patch({ utilisateur: { ...u, prenom, nom }, compteAction: null })
  }

  /** Identifiant et mot de passe de son compte (`ancien` : le mot de passe actuel, s'il en a un). Réponse : `compteAction`. */
  setIdentifiants(identifiant: string, motDePasse: string, ancien?: string): void {
    if (!this.send({ type: 'compte.identifiants', identifiant, motDePasse, ...(ancien ? { ancien } : {}) })) return
    this.patch({ compteAction: { busy: true } })
  }

  oublierCompteAction(): void {
    this.patch({ compteAction: null })
  }

  /** Propriétaire : comptes et invitations ; inviter, annuler une invitation, activer ou désactiver un compte. */
  requestComptes(): void {
    this.send({ type: 'comptes.lister' })
  }

  inviter(prenom: string): void {
    this.send({ type: 'invitation.creer', prenom })
  }

  oublierInvitation(): void {
    this.patch({ invitationCreee: null })
  }

  annulerInvitation(id: number): void {
    this.send({ type: 'invitation.annuler', id })
  }

  setCompteActif(id: number, actif: boolean): void {
    this.send({ type: 'compte.actif', id, actif })
  }

  /** Coffre de clés API : l'état de chaque clé (réponse : `cles`). */
  requestCles(): void {
    this.send({ type: 'cles.lister' })
  }

  /** Range une clé (valeur vide : la retire). Elle part une fois au serveur, qui la chiffre ; elle ne revient jamais. */
  setCle(nom: CleApi, valeur: string): void {
    if (!this.send({ type: 'cle.definir', nom, valeur })) return
    this.patch({ cleAction: { nom, busy: true } })
  }

  /** Réglages › Moteurs : ce que l'installation offre et les bancs d'essai (réponse : `moteurs`). */
  requestMoteurs(): void {
    this.send({ type: 'moteurs.lister' })
  }

  /** Les modèles d'un fournisseur, lus avec sa clé (réponse : `moteurs.modeles`). */
  requestModeles(fournisseur: FournisseurId): void {
    if (!this.send({ type: 'moteurs.modeles', fournisseur })) return
    const avant = this.state.modeles[fournisseur]
    this.patch({ modeles: { ...this.state.modeles, [fournisseur]: { liste: avant?.liste ?? [], busy: true } } })
  }

  /** Pose les scénarios du banc d'essai à un moteur ; la progression arrive par `banc`. */
  lancerBanc(fournisseur: FournisseurId, modele: string): void {
    if (!this.send({ type: 'moteurs.banc', fournisseur, modele })) return
    this.patch({ banc: { fournisseur, modele, etat: 'en_cours', scenarios: [], cout: 0, le: Date.now() } })
  }

  /** Déconnexion de cet appareil : son jeton est révoqué au serveur et oublié ici. */
  logout(): void {
    this.send({ type: 'auth.logout' })
    this.forgetToken()
  }

  /** Appareils de l'utilisateur (réponse : `appareils`), et révocation de l'un d'eux. */
  requestDevices(): void {
    this.send({ type: 'devices.list' })
  }

  revokeDevice(id: number): void {
    this.send({ type: 'device.revoke', id })
  }

  /** Compteur de tokens (réponse : `usage`). */
  requestUsage(): void {
    this.send({ type: 'usage.request' })
  }

  /** Réglages, voix proposées (réponse : `utilisateur`, `voixChoix`). */
  requestReglages(): void {
    this.send({ type: 'reglages.get' })
  }

  /**
   * Change des réglages : affiché tout de suite ici, puis confirmé par le serveur à tous les appareils
   * de l'utilisateur. Refusé : les réglages enregistrés reviennent, avec l'erreur de chaque champ.
   */
  setReglages(patch: Partial<Reglages>): void {
    const u = this.state.utilisateur
    if (!this.send({ type: 'reglages.set', reglages: patch }) || !u) return
    this.patch({ utilisateur: { ...u, reglages: { ...u.reglages, ...patch } }, reglagesErreurs: null })
  }

  /** Court extrait d'une voix (l'audio arrive comme une réponse, sur cet appareil seulement). */
  sampleVoice(voix: string, vitesse: number): void {
    this.send({ type: 'voix.echantillon', voix, vitesse })
  }

  /** Cherche dans la bibliothèque ElevenLabs (voix françaises) ; une page de plus si `page` > 0. */
  chercherVoix(filtres: VoixRecherche): void {
    const b = this.state.bibliotheque
    if (!this.send({ type: 'voix.bibliotheque', filtres })) return
    const plus = (filtres.page ?? 0) > 0 && b
    this.patch({ bibliotheque: { filtres, voix: plus ? b.voix : [], suite: plus ? b.suite : false, chargement: true } })
  }

  /** Ajoute une voix de la bibliothèque à son compte ElevenLabs ; le serveur la choisit ensuite. */
  ajouterVoix(v: Pick<VoixBibliotheque, 'auteur' | 'id' | 'nom'>): void {
    if (!this.send({ type: 'voix.ajouter', auteur: v.auteur, id: v.id, nom: v.nom })) return
    this.patch({ voixAjout: { id: v.id, nom: v.nom, busy: true } })
  }

  /** Fin de l'assistant de premier lancement ; `presentation` : CODE se présente à voix haute ici. */
  finishAssistant(presentation: boolean): void {
    const u = this.state.utilisateur
    if (!this.send({ type: 'assistant.fini', presentation }) || !u) return
    this.patch({ utilisateur: { ...u, configure: true } })
  }

  private authenticate(payload: ClientPayload): void {
    this.patch({ auth: { busy: true, error: null } })
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(payload))
      return
    }
    this.pendingAuth = payload
    this.closed = false
    if (!this.ws) this.open()
  }

  /** Jeton refusé ou révoqué : retour à l'écran de connexion. */
  private forgetToken(message: string | null = null): void {
    this.token = null
    this.opts.onToken?.(null)
    this.stopTimers()
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.patch({ connection: 'auth', connectionId: null, utilisateur: null, appareilId: null, usage: null, appareils: null, comptes: null, invitations: [], invitationCreee: null, cles: null, cleAction: null, moteurs: null, modeles: {}, banc: null, compteAction: null, auth: { busy: false, error: message ? { code: 'session', message } : null } })
  }

  close(): void {
    this.closed = true
    this.stopTimers()
    this.ws?.close()
  }

  send(payload: ClientPayload): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || this.state.connection !== 'connecte') return false
    this.ws.send(encode(payload))
    return true
  }

  /** Adresse HTTP du serveur pour un chemin relatif (« /apercu/… »), déduite de l'adresse WebSocket. */
  httpUrl(path: string): string {
    const ws = new URL(this.opts.url, location.href)
    ws.protocol = ws.protocol === 'wss:' ? 'https:' : 'http:'
    return new URL(path, ws.origin).href
  }

  /** Clic dans l'interface : parcourir un dossier, afficher un fichier, l'ouvrir sur le Mac. */
  uiAction(action: 'parcourir' | 'afficher' | 'ouvrir_mac' | 'finder', chemin: string): void {
    const turnId = this.state.views[0]?.turnId ?? 'interface'
    this.send({ type: 'ui.action', action, chemin, turnId })
  }

  /** Autre page, onglet ou recherche d'une liste : le serveur recharge le panneau `viewId`, sans Claude. */
  uiPage(viewId: string, turnId: string, tool: string, args: Record<string, unknown>): void {
    this.send({ type: 'ui.page', viewId, turnId, tool, args })
  }

  /** Demande au serveur de quoi associer un téléphone (Mac seulement). */
  requestPair(): void {
    this.send({ type: 'pair.request' })
  }

  /**
   * Lance la connexion au compte Google. Serveur sur l'ordinateur : la page de consentement s'ouvre dans son
   * navigateur. Hébergé : cet écran l'ouvre dès que le serveur la donne (sinon, le lien reste affiché).
   */
  connectGoogle(): void {
    this.googleDemande = Date.now()
    this.send({ type: 'google.connect' })
  }

  oublierGoogleIdentifiants(): void {
    this.patch({ googleIdentifiants: null })
  }

  /** Le propriétaire relie l'installation à son client Google (réponse : `google.identifiants`). */
  relierGoogle(clientId: string, clientSecret: string): void {
    this.patch({ googleIdentifiants: { busy: true } })
    this.send({ type: 'google.identifiants', clientId, clientSecret })
  }

  disconnectGoogle(): void {
    this.send({ type: 'google.disconnect' })
  }

  /**
   * Itinéraire : le serveur demande la position de cet appareil, pour ce trajet seulement. Le système
   * demande l'autorisation la première fois ; un refus ou une absence de GPS est renvoyé tel quel.
   */
  private sendPosition(id: string): void {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined
    if (!geo) {
      this.send({ type: 'position', id, erreur: 'cet appareil ne donne pas sa position' })
      return
    }
    geo.getCurrentPosition(
      (p) => this.send({ type: 'position', id, lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
      (err) => this.send({ type: 'position', id, erreur: err.code === err.PERMISSION_DENIED ? 'autorisation de localisation refusée' : err.code === err.TIMEOUT ? 'position trop longue à obtenir' : 'position indisponible' }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 }
    )
  }

  /**
   * Relier une boîte mail : le mot de passe part une fois au serveur (qui le chiffre) et ne reste pas ici.
   * Le serveur teste la lecture et l'envoi avant d'enregistrer (réponse : `boite.resultat`).
   */
  ajouterBoite(b: { libelle: string; email: string; motDePasse: string; imapHote?: string; imapPort?: number; smtpHote?: string; smtpPort?: number }): void {
    this.patch({ boiteAjout: { busy: true } })
    this.send({ type: 'boite.ajouter', ...b })
  }

  retirerBoite(id: number): void {
    this.send({ type: 'boite.retirer', id })
  }

  boiteParDefaut(id: number): void {
    this.send({ type: 'boite.defaut', id })
  }

  oublierAjoutBoite(): void {
    this.patch({ boiteAjout: null })
  }

  // ── Réunions : enregistrer ou importer, envoyer les morceaux ──

  private reunionMic: MicroReunion | null = null
  private reunionFile: Morceau[] = []
  private reunionEnvoi = false
  private reunionFichier: File | null = null
  private reunionMax = 0

  requestReunions(): void {
    this.send({ type: 'reunions.lister' })
  }

  /** Le volume du micro de la réunion en cours (0 à 1), pour le témoin à l'écran. */
  niveauReunion(): number {
    return this.reunionMic?.niveau ?? 0
  }

  /** L'assistant parlait ou écoutait à cet instant (horloge de l'appareil) : la capture reste coupée un court moment après. */
  private assistantOccupe = 0

  /**
   * Rien ne doit entrer dans la réunion : elle est en pause, ou l'assistant est interrogé (on lui parle, il
   * réfléchit, il répond). Sa voix sort des haut-parleurs et y traîne un instant : la capture reprend 0,7 s après.
   */
  private reunionMuette(): boolean {
    const r = this.state.reunion
    if (r?.id && this.state.reunions?.find((x) => x.id === r.id)?.enPause) return true
    const etat = this.state.serverState
    if (etat === 'ecoute' || etat === 'reflexion' || etat === 'parole') this.assistantOccupe = Date.now()
    return Date.now() - this.assistantOccupe < 700
  }

  /** Met l'enregistrement en pause ou le reprend (depuis n'importe quel écran ; le serveur diffuse l'état). */
  pauseReunion(id: number, pause: boolean): void {
    this.send({ type: 'reunion.pause', reunion: id, pause })
  }

  private majReunion(p: Partial<ReunionEnCours>): void {
    if (this.state.reunion) this.patch({ reunion: { ...this.state.reunion, ...p } })
  }

  private ouvrirReunion(source: 'micro' | 'fichier', titre: string): boolean {
    const r = this.state.reunion
    if (r && r.etat !== 'erreur') return false
    const base: ReunionEnCours = { id: null, source, etat: 'ouverture', titre, debut: Date.now(), decoupes: 0, envoyes: 0 }
    if (!this.token || !this.send({ type: 'reunion.demarrer', source, ...(titre ? { titre } : {}) })) {
      this.patch({ reunion: { ...base, etat: 'erreur', erreur: 'Serveur injoignable : réessayez une fois reconnecté.' } })
      return false
    }
    this.reunionFile = []
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.surFermeture)
    this.patch({ reunion: base })
    return true
  }

  private propositionMinuteur: ReturnType<typeof setTimeout> | undefined

  /** La proposition de l'agenda : acceptée (l'enregistrement démarre avec son titre) ou écartée. */
  repondreReunionProposee(oui: boolean): void {
    const p = this.state.reunionProposee
    clearTimeout(this.propositionMinuteur)
    this.patch({ reunionProposee: null })
    if (oui && p) this.demarrerReunion(p.titre)
  }

  /**
   * La page se ferme ou se recharge en plein enregistrement : la réunion est remise au serveur avec ce qui est
   * déjà parti (sinon elle resterait « en cours » une demi-heure sur les autres écrans).
   */
  private surFermeture = (): void => {
    const r = this.state.reunion
    if (r?.id && (r.etat === 'enregistrement' || r.etat === 'envoi')) this.send({ type: 'reunion.terminer', reunion: r.id })
  }

  /** Lance l'enregistrement d'une réunion avec le micro de cet appareil (à appeler pendant le toucher). */
  demarrerReunion(titre = ''): void {
    primeAudio()
    this.reunionFichier = null
    clearTimeout(this.propositionMinuteur)
    if (this.state.reunionProposee) this.patch({ reunionProposee: null })
    this.ouvrirReunion('micro', titre.trim())
  }

  /** Importe un enregistrement (MP3, M4A, WAV…) : décodé ici, envoyé par morceaux, transcrit par le serveur. */
  importerReunion(fichier: File): void {
    // Le fichier est décodé en mémoire : un téléphone n'a pas la place d'un très long enregistrement.
    const tactile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const max = (tactile ? 80 : 500) * 1024 * 1024
    if (fichier.size > max) {
      this.patch({ reunion: { id: null, source: 'fichier', etat: 'erreur', titre: fichier.name, debut: Date.now(), decoupes: 0, envoyes: 0, erreur: `Fichier trop lourd pour cet appareil (${Math.round(max / 1024 / 1024)} Mo au plus)${tactile ? ' : importez-le depuis l’ordinateur.' : '.'}` } })
      return
    }
    this.reunionFichier = fichier
    this.ouvrirReunion('fichier', fichier.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim())
  }

  /** Le serveur a ouvert la réunion : le micro s'ouvre, ou le fichier se décode. */
  private async onReunionOuverte(msg: { reunion: number; titre: string; segmentS: number; segmentMaxS: number; dureeMaxS: number; service: string; tarif: number }): Promise<void> {
    const r = this.state.reunion
    if (!r || r.etat !== 'ouverture') return void this.send({ type: 'reunion.annuler', reunion: msg.reunion })
    this.reunionMax = msg.dureeMaxS
    const decoupeur = new Decoupeur(msg.segmentS, msg.segmentMaxS, (m) => this.morceauReunion(m, decoupeur))
    this.majReunion({ id: msg.reunion, titre: msg.titre, service: msg.service, tarif: msg.tarif })
    try {
      if (r.source === 'fichier') {
        this.majReunion({ etat: 'preparation' })
        await decouperFichier(this.reunionFichier!, decoupeur, msg.dureeMaxS)
        this.reunionFichier = null
        if (this.state.reunion?.id !== msg.reunion) return
        if (!this.state.reunion.decoupes) throw new Error('Rien d’audible dans ce fichier.')
        this.majReunion({ etat: 'envoi' })
        void this.envoyerMorceaux()
      } else {
        this.reunionMic = await MicroReunion.ouvrir(decoupeur, this.opts.sonSysteme, () => this.reunionMuette())
        // Annulée pendant l'ouverture du micro.
        if (this.state.reunion?.id !== msg.reunion) return this.fermerMicReunion(false)
        this.reunionMic.surPerteSonSysteme = () => this.majReunion({ son: 'micro' })
        this.note(`réunion : ${this.reunionMic.sonSysteme ? 'micro et son de l’ordinateur' : this.opts.sonSysteme ? 'micro seul (son de l’ordinateur indisponible)' : 'micro seul'}`)
        this.majReunion({ etat: 'enregistrement', debut: Date.now(), ...(this.opts.sonSysteme ? { son: this.reunionMic.sonSysteme ? 'micro+ordinateur' : 'micro' } : {}) })
      }
    } catch (err) {
      this.note(`réunion : ${(err as Error).message}`)
      this.fermerMicReunion(false)
      this.reunionFile = []
      this.reunionFichier = null
      this.send({ type: 'reunion.annuler', reunion: msg.reunion })
      if (this.state.reunion?.id === msg.reunion) this.majReunion({ etat: 'erreur', erreur: (err as Error).message })
    }
  }

  private fermerMicReunion(garder: boolean): void {
    this.reunionMic?.fermer(garder)
    this.reunionMic = null
  }

  private morceauReunion(m: Morceau, decoupeur: Decoupeur): void {
    if (!this.state.reunion?.id) return
    this.reunionFile.push(m)
    this.majReunion({ decoupes: this.state.reunion.decoupes + 1 })
    void this.envoyerMorceaux()
    // La durée la plus longue est atteinte : l'enregistrement s'arrête de lui-même.
    if (this.reunionMic && decoupeur.dureeS >= this.reunionMax) queueMicrotask(() => this.arreterReunion())
  }

  /**
   * Envoie les morceaux un par un, dans l'ordre. Une coupure de réseau ne perd rien : le morceau attend et
   * repart (de plus en plus espacé, 15 s au plus). La file vidée après l'arrêt, la réunion est remise au serveur.
   */
  private async envoyerMorceaux(): Promise<void> {
    if (this.reunionEnvoi) return
    this.reunionEnvoi = true
    try {
      for (let essai = 0; this.reunionFile.length; ) {
        const r = this.state.reunion
        if (!r?.id || r.etat === 'erreur') return
        const m = this.reunionFile[0]!
        let res: Response | null = null
        try {
          res = await fetch(this.httpUrl(`/reunions/${r.id}/segments`), {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'audio/wav', 'X-Rang': String(m.rang), 'X-Debut': m.debutS.toFixed(2) },
            body: wavDe(m.pcm)
          })
        } catch {
          res = null
        }
        if (this.state.reunion?.id !== r.id) return
        if (res?.status === 201) {
          this.reunionFile.shift()
          essai = 0
          this.majReunion({ envoyes: this.state.reunion.envoyes + 1, enAttente: false })
          continue
        }
        // Refusé pour de bon (réunion close, appareil révoqué) : inutile d'insister.
        if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          const corps = (await res.json().catch(() => ({}))) as { erreur?: string }
          this.fermerMicReunion(false)
          this.reunionFile = []
          return this.majReunion({ etat: 'erreur', erreur: corps.erreur ?? `Envoi refusé (${res.status}).` })
        }
        this.majReunion({ enAttente: true })
        await new Promise((ok) => setTimeout(ok, Math.min(15_000, 1000 * 2 ** essai++)))
      }
    } finally {
      this.reunionEnvoi = false
    }
    this.cloreReunion()
  }

  /** Tout est parti et l'enregistrement est arrêté : le serveur finit la transcription et préviendra. */
  private cloreReunion(): void {
    const r = this.state.reunion
    if (!r?.id || r.etat !== 'envoi' || this.reunionFile.length) return
    if (!this.send({ type: 'reunion.terminer', reunion: r.id })) {
      this.majReunion({ enAttente: true })
      return void setTimeout(() => this.cloreReunion(), 3000)
    }
    this.patch({ reunion: null })
  }

  /** Arrête l'enregistrement : le dernier morceau part, puis la transcription se termine côté serveur. */
  arreterReunion(): void {
    const r = this.state.reunion
    if (!r || r.etat !== 'enregistrement') return
    this.majReunion({ etat: 'envoi' })
    this.fermerMicReunion(true)
    if (!this.state.reunion?.decoupes) {
      // Rien d'audible : rien à transcrire.
      this.send({ type: 'reunion.annuler', reunion: r.id! })
      return this.majReunion({ etat: 'erreur', erreur: 'Rien n’a été enregistré : le micro n’a capté aucun son.' })
    }
    void this.envoyerMorceaux()
  }

  /** « Terminer » depuis n'importe quel écran : ici si c'est lui qui enregistre, sinon demandé à celui qui enregistre. */
  demanderArretReunion(id: number): void {
    if (this.state.reunion?.id === id) return this.arreterReunion()
    this.send({ type: 'reunion.stop', reunion: id })
  }

  /** Abandonne l'enregistrement ou l'import : ce qui est déjà parti est effacé du serveur. */
  annulerReunion(): void {
    const r = this.state.reunion
    if (!r) return
    this.fermerMicReunion(false)
    this.reunionFile = []
    this.reunionFichier = null
    if (r.id && r.etat !== 'erreur') this.send({ type: 'reunion.annuler', reunion: r.id })
    this.patch({ reunion: null })
  }

  requestCompetences(): void {
    this.send({ type: 'competences.lister' })
  }

  /** Écrite ou modifiée (`id`) dans les Réglages ; le serveur vérifie puis répond `competence.resultat`. */
  enregistrerCompetence(c: { id?: string; nom: string; description: string; corps: string }): void {
    this.patch({ competenceAction: { busy: true } })
    const { id, ...champs } = c
    this.send({ type: 'competence.enregistrer', ...champs, ...(id ? { competence: id } : {}) })
  }

  /** Un fichier .md ou .txt importé : le serveur lit son en-tête (ou son titre) et l'enregistre. */
  importerCompetence(texte: string, fichier: string): void {
    this.patch({ competenceAction: { busy: true } })
    this.send({ type: 'competence.enregistrer', texte, fichier })
  }

  supprimerCompetence(id: string): void {
    this.send({ type: 'competence.supprimer', competence: id })
  }

  oublierActionCompetence(): void {
    this.patch({ competenceAction: null })
  }

  requestConnecteurs(): void {
    this.send({ type: 'connecteurs.lister' })
  }

  /**
   * Relier un service : le jeton part une fois au serveur (qui le chiffre et le teste) et ne reste pas ici.
   * Sans jeton, le serveur renvoie la page de consentement du service (`connecteur.resultat` avec `url`).
   */
  ajouterConnecteur(c: { service: string; jeton?: string; url?: string; libelle?: string; complement?: string }): void {
    this.patch({ connecteurAction: { service: c.service, busy: true } })
    this.send({ type: 'connecteur.ajouter', ...c })
  }

  autoriserConnecteur(id: number, service: string): void {
    this.patch({ connecteurAction: { service, busy: true } })
    this.send({ type: 'connecteur.autoriser', id })
  }

  /** Jeton complémentaire d'un connecteur relié (Expo : la liste des projets) ; vide pour le retirer. */
  complementConnecteur(id: number, service: string, jeton: string): void {
    this.patch({ connecteurAction: { service, busy: true } })
    this.send({ type: 'connecteur.complement', id, jeton })
  }

  retirerConnecteur(id: number): void {
    this.send({ type: 'connecteur.retirer', id })
  }

  oublierActionConnecteur(): void {
    this.patch({ connecteurAction: null })
  }

  /** Redemande la météo de la ville de l'utilisateur (réponse : `meteo`). */
  refreshMeteo(): void {
    this.send({ type: 'meteo.refresh' })
  }

  /** Redemande les rendez-vous du jour et les mails importants (réponse : `perso`). */
  refreshPerso(): void {
    this.send({ type: 'perso.refresh' })
  }

  /** Un rappel qui sonne : « fait », ou reporté de quelques minutes. */
  reminderAction(id: number, action: 'fait' | 'reporter', minutes = 10): void {
    this.send({ type: 'reminder.action', id, action, minutes })
  }

  /** Une tâche planifiée : la lancer tout de suite, la mettre en pause ou la reprendre. */
  taskAction(id: number, action: 'executer' | 'pause' | 'reprendre'): void {
    this.send({ type: 'task.action', id, action })
  }

  /**
   * Envoie un papier (photo réduite, PDF tel quel) au serveur, puis demande à l'assistant de le lire, de le
   * ranger et de noter son échéance. `voice` : réponse à voix haute (écran d'accueil) ou écrite (mode chat).
   */
  async envoyerDocument(fichier: File, voice: boolean): Promise<boolean> {
    // Un enregistrement audio n'est pas un papier : il part à la transcription.
    if (estAudio(fichier)) {
      this.importerReunion(fichier)
      return true
    }
    if (!this.token || this.state.connection !== 'connecte') {
      this.patch({ documentEnvoi: { nom: fichier.name, erreur: 'Serveur injoignable : réessayez une fois reconnecté.' } })
      return false
    }
    this.patch({ documentEnvoi: { nom: fichier.name } })
    try {
      const { data, type, nom } = await preparerDocument(fichier)
      const res = await fetch(this.httpUrl('/documents'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': type, 'X-Nom': encodeURIComponent(nom) },
        body: data
      })
      const body = (await res.json().catch(() => ({}))) as { id?: number; erreur?: string }
      if (!res.ok || !body.id) throw new Error(body.erreur ?? `Envoi refusé (${res.status}).`)
      if (!this.send({ type: 'document', id: body.id, voice })) throw new Error('Connexion perdue pendant l’envoi : réessayez.')
      this.patch({ documentEnvoi: null })
      return true
    } catch (err) {
      const message = err instanceof TypeError ? 'Serveur injoignable : réessayez.' : err instanceof Error ? err.message : String(err)
      this.note(`envoi d’un document : ${message}`)
      this.patch({ documentEnvoi: { nom: fichier.name, erreur: message } })
      return false
    }
  }

  oublierEnvoiDocument(): void {
    this.patch({ documentEnvoi: null })
  }

  /**
   * Coche ou décoche un élément d'une liste affichée : l'écran change aussitôt, puis la liste revient du
   * serveur (message `liste`), sur cet appareil comme chez tous ceux qui la voient.
   */
  listeCocher(liste: number, element: number, coche: boolean): void {
    this.majListe(liste, (l) => {
      const elements = l.elements.map((e) => (e.id === element ? { ...e, coche } : e))
      return { ...l, elements, restants: elements.filter((e) => !e.coche).length, focus: [element] }
    })
    this.send({ type: 'liste.cocher', liste, element, coche })
  }

  /** Les panneaux qui montrent cette liste (au premier plan comme rangés) ; `null` : elle n'est plus visible. */
  private majListe(id: number, f: (l: UiListe) => UiListe | null): void {
    const maj = (v: UiView): UiView => {
      if (v.data?.kind !== 'liste' || v.data.id !== id) return v
      const l = f(v.data)
      return l ? { ...v, data: l } : { ...v, data: undefined, status: 'erreur', message: 'Cette liste n’est plus partagée avec vous.' }
    }
    const touche = (g: UiView[]) => g.some((v) => v.data?.kind === 'liste' && v.data.id === id)
    if (!touche(this.state.views) && !this.state.pile.some(touche)) return
    this.patch({ views: this.state.views.map(maj), pile: this.state.pile.map((g) => (touche(g) ? g.map(maj) : g)) })
  }

  /**
   * Allume ou éteint un appareil de la maison d'un toucher : la tuile bascule aussitôt, puis son état revient de
   * Home Assistant (message `maison.appareil`), sur tous les écrans qui la montrent.
   */
  maisonBasculer(entite: string): void {
    this.majMaison((m) => ({ ...m, message: undefined, focus: [entite], pieces: m.pieces.map((p) => ({ ...p, appareils: p.appareils.map((a) => (a.id === entite ? { ...a, actif: !a.actif } : a)) })) }))
    this.send({ type: 'maison.basculer', entite })
  }

  /** Reprend l'image d'une caméra affichée (réponse : `maison.camera`). */
  cameraActualiser(entite: string): void {
    this.send({ type: 'maison.camera', entite })
  }

  /** Les panneaux « Maison » (au premier plan comme rangés), transformés par `f`. */
  private majMaison(f: (m: UiMaison) => UiMaison): void {
    const maj = (v: UiView): UiView => (v.data?.kind === 'maison' ? { ...v, data: f(v.data) } : v)
    const touche = (g: UiView[]) => g.some((v) => v.data?.kind === 'maison')
    if (!touche(this.state.views) && !this.state.pile.some(touche)) return
    this.patch({ views: this.state.views.map(maj), pile: this.state.pile.map((g) => (touche(g) ? g.map(maj) : g)) })
  }

  /** Coche une échéance comme réglée ; la liste revient par le message `echeances`. */
  echeanceReglee(id: number): void {
    this.send({ type: 'echeance.regler', id })
  }

  /** Abonne ce téléphone aux notifications (réponse : `pushResult`). */
  subscribePush(subscription: PushSubscriptionJson): void {
    this.patch({ pushResult: null })
    this.send({ type: 'push.subscribe', subscription })
  }

  testPush(): void {
    this.patch({ pushResult: null })
    this.send({ type: 'push.test' })
  }

  unsubscribePush(endpoint: string): void {
    this.send({ type: 'push.unsubscribe', endpoint })
  }

  /** Ferme les panneaux des outils, et ceux rangés à côté. */
  clearViews(): void {
    this.patch({ views: [], pile: [] })
  }

  /** Ramène au premier plan des panneaux rangés ; ceux qui étaient affichés prennent leur place dans la pile. */
  restoreViews(turnId: string): void {
    const group = this.state.pile.find((g) => g[0]?.turnId === turnId)
    if (!group) return
    const rest = this.state.pile.filter((g) => g !== group)
    this.patch({ views: group, pile: (this.state.views.length ? [this.state.views, ...rest] : rest).slice(0, PILE_MAX) })
  }

  /** Efface le résultat du dernier enregistrement de voix (bouton « OK »). */
  clearEnrollMessage(): void {
    this.patch({ enrollMessage: null })
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm)
  }

  private open(): void {
    this.stopTimers()
    // Premier essai et première reconnexion : « Connexion au Mac… » ; ensuite seulement « injoignable ».
    // Sans jeton, l'écran de connexion reste affiché pendant l'essai.
    if (this.token) this.patch({ connection: this.retry <= 1 ? 'connexion' : 'injoignable' })
    this.openedAt = performance.now()
    this.note(`ouverture (essai ${this.retry + 1})`)
    const ws = new WebSocket(this.opts.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.note(`ouverte en ${Math.round(performance.now() - this.openedAt)} ms`)
      const auth = this.pendingAuth
      this.pendingAuth = null
      if (auth) ws.send(encode(auth))
      else if (this.token) ws.send(encode({ type: 'hello', token: this.token, device: this.opts.device }))
    }
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const header = this.audioHeader
        this.audioHeader = null
        if (header) for (const fn of this.events.audio) fn(header, ev.data)
        return
      }
      const msg = decode<ServerMessage>(String(ev.data))
      if (msg) this.handle(msg)
    }
    ws.onclose = (ev) => {
      this.note(`fermée (code ${ev.code}${ev.reason ? ` « ${ev.reason} »` : ''}) après ${Math.round(performance.now() - this.openedAt)} ms`)
      if (this.ws !== ws) return
      if (ev.code === 4401) {
        // Jeton refusé ou révoqué (déconnexion depuis un autre appareil) : on se reconnecte avec son compte.
        if (this.token) return this.forgetToken('Cet appareil a été déconnecté. Reconnectez-vous.')
        this.ws = null
        this.stopTimers()
        return this.patch({ connection: 'auth', auth: { ...this.state.auth, busy: false } })
      }
      // Sans jeton (écran de connexion), pas de reconnexion automatique : le prochain essai rouvrira.
      if (!this.token) {
        this.ws = null
        return this.patch({ auth: this.state.auth.busy ? { busy: false, error: { code: 'indisponible', message: 'Serveur injoignable. Vérifiez la connexion puis réessayez.' } } : this.state.auth })
      }
      this.reconnect()
    }
  }

  private reconnect(): void {
    this.stopTimers()
    const dead = this.ws
    this.ws = null
    dead?.close()
    if (this.closed) return
    // Premier essai immédiat et discret (« Connexion au Mac… ») ; « injoignable » seulement s'il échoue.
    this.patch({ connection: this.retry === 0 ? 'connexion' : 'injoignable' })
    const delay = this.retry === 0 ? 300 : Math.min(5_000, 1_000 * 2 ** (this.retry - 1))
    this.retry++
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome': {
        this.note(`accueil du Mac en ${Math.round(performance.now() - this.openedAt)} ms (${msg.history.length} messages d'historique)`)
        // Le journal de connexion part maintenant que le serveur nous a acceptés.
        queueMicrotask(() => {
          for (const line of this.connTrace.splice(0)) this.send({ type: 'client.log', message: line })
          // Les boîtes mail : la carte « Mails importants » s'en sert même sans Google.
          this.send({ type: 'boites.lister' })
          // Les réunions : une transcription en cours s'affiche dès l'ouverture.
          this.send({ type: 'reunions.lister' })
          // L'app Mac : le serveur hébergé peut lui confier les outils de fichiers (le pont).
          if (this.opts.pont) this.send({ type: 'pont.pret', outils: ['fichiers'] })
        })
        this.retry = 0
        this.lastPong = Date.now()
        this.startPing()
        const lastUser = [...msg.history].reverse().find((t) => t.role === 'user')
        const lastReply = [...msg.history].reverse().find((t) => t.role === 'assistant')
        return this.patch({
          connection: 'connecte',
          connectionId: msg.connectionId,
          utilisateur: msg.utilisateur ?? null,
          appareilId: msg.appareilId ?? null,
          auth: { busy: false, error: null },
          serverState: msg.state,
          micOwner: msg.micOwner,
          history: msg.history,
          thread: msg.history.map((t, i) => ({ id: `h${t.ts}-${i}`, role: t.role, text: displayText(t.text), ts: t.ts })).filter((m) => m.text),
          log: msg.log,
          pending: msg.pendingConfirm,
          speaker: msg.speaker,
          // Un serveur d'avant le mode conversation n'envoie rien : relance par défaut.
          ecoute: msg.ecoute ?? { relanceMs: 20_000, conversation: null },
          google: msg.google,
          rappels: msg.rappels ?? [],
          push: msg.push ?? { publicKey: null, abonnes: 0 },
          taches: msg.taches ?? [],
          echeances: msg.echeances ?? [],
          lastUser: lastUser?.text ?? '',
          reply: lastReply?.text ?? ''
        })
      }
      case 'state':
        return this.patch({
          serverState: msg.state,
          micOwner: msg.micOwner,
          ...(msg.state === 'ecoute' ? { partial: '', sens: null } : {})
        })
      case 'transcript.partial':
        if (this.state.serverState !== 'ecoute') return
        return this.patch({ partial: msg.text })
      case 'transcript.sens':
        return this.patch({ sens: { text: msg.text, fini: msg.fini } })
      case 'transcript.final':
        return this.patch({
          partial: '',
          sens: null,
          lastUser: msg.text,
          reply: '',
          replyTurnId: null,
          thread: [...this.state.thread, { id: `u${Date.now()}`, role: 'user' as const, text: msg.text, ts: Date.now() }].slice(-THREAD_MAX)
        })
      case 'reply.text': {
        const thread = this.state.thread
        const last = thread[thread.length - 1]
        const next =
          last && last.id === msg.turnId
            ? [...thread.slice(0, -1), { ...last, text: last.text + msg.delta }]
            : [...thread, { id: msg.turnId, role: 'assistant' as const, text: msg.delta, ts: Date.now(), streaming: true }].slice(-THREAD_MAX)
        return this.patch(
          msg.turnId === this.state.replyTurnId
            ? { reply: this.state.reply + msg.delta, thread: next }
            : { reply: msg.delta, replyTurnId: msg.turnId, thread: next }
        )
      }
      case 'reply.audio':
        this.audioHeader = { turnId: msg.turnId, seq: msg.seq, levels: msg.levels }
        return
      case 'reply.end':
        for (const fn of this.events.replyEnd) fn(msg.interrupted)
        return this.patch({
          thread: this.state.thread.map((m) => (m.id === msg.turnId ? { ...m, streaming: false, interrupted: msg.interrupted } : m))
        })
      case 'confirm.request': {
        const { actionId, title, summary, expiresAt } = msg
        return this.patch({ pending: { actionId, title, summary, expiresAt } })
      }
      case 'confirm.result':
        return this.patch({ pending: null, lastOutcome: { outcome: msg.outcome, at: Date.now() } })
      case 'log':
        return this.patch({ log: [msg.entry, ...this.state.log].slice(0, 50) })
      case 'error':
        if (this.state.enroll) this.patch({ enroll: null })
        // Banc refusé (déjà en cours, pas de clé) : l'affichage « en cours » s'efface.
        if (msg.code === 'banc' && this.state.banc?.etat === 'en_cours' && !this.state.banc.scenarios.length) this.patch({ banc: null })
        if (this.errorTimer) clearTimeout(this.errorTimer)
        this.errorTimer = setTimeout(() => this.patch({ error: null }), 6_000)
        return this.patch({ error: msg.message })
      case 'enroll.progress':
        return this.patch({ enroll: { percentage: msg.percentage }, enrollMessage: null })
      case 'enroll.done':
        for (const fn of this.events.enrollDone) fn(msg.ok)
        return this.patch({ enroll: null, enrollMessage: { ok: msg.ok, text: msg.message } })
      case 'speaker.status':
        return this.patch({ speaker: msg.status })
      case 'ecoute':
        return this.patch({ ecoute: msg.ecoute })
      case 'audio.stop':
        for (const fn of this.events.audioStop) fn(msg.reason)
        return
      case 'audio.barge':
        for (const fn of this.events.audioBarge) fn()
        return
      case 'pair.info':
        return this.patch({ pair: msg.info })
      case 'google.status':
        if (msg.status.etat === 'connexion' && msg.status.mode === 'heberge' && msg.status.url && Date.now() - this.googleDemande < 15_000) {
          this.googleDemande = 0
          if (typeof window !== 'undefined') window.open(msg.status.url, '_blank', 'noopener')
        }
        return this.patch({ google: msg.status, ...(msg.status.etat === 'connecte' ? {} : { perso: null }) })
      case 'google.identifiants':
        return this.patch({ googleIdentifiants: { busy: false, ok: msg.ok, message: msg.message } })
      case 'perso.resume':
        return this.patch({ perso: msg.resume })
      case 'boites':
        return this.patch({ boites: msg.boites })
      case 'boite.resultat':
        return this.patch({ boiteAjout: { busy: false, ok: msg.ok, message: msg.message, ...(msg.manuel ? { manuel: true } : {}) } })
      case 'reunion.ouverte':
        return void this.onReunionOuverte(msg)
      case 'reunion.refus':
        return this.majReunion({ etat: 'erreur', erreur: msg.message })
      case 'reunions':
        return this.patch({ reunions: msg.reunions })
      case 'reunion.etat': {
        const autres = (this.state.reunions ?? []).filter((r) => r.id !== msg.reunion)
        return this.patch({ reunions: msg.ligne ? [msg.ligne, ...autres] : autres })
      }
      case 'reunion.proposition': {
        // Déjà en train d'enregistrer ici, ou miniature (pas d'écran pour elle) : rien à proposer.
        if ((this.state.reunion && this.state.reunion.etat !== 'erreur') || this.opts.device === 'mini') return
        clearTimeout(this.propositionMinuteur)
        // Sans réponse, elle s'efface d'elle-même : dix minutes après, la réunion est bien entamée.
        this.propositionMinuteur = setTimeout(() => this.patch({ reunionProposee: null }), 10 * 60_000)
        return this.patch({ reunionProposee: { cle: msg.cle, titre: msg.titre, heure: msg.heure, service: msg.service } })
      }
      case 'reunion.commande':
        return msg.action === 'demarrer' ? this.demarrerReunion(msg.titre) : this.arreterReunion()
      case 'competences':
        return this.patch({ competences: msg.competences, modelesCompetences: msg.modeles })
      case 'competence.resultat':
        return this.patch({ competenceAction: { busy: false, ok: msg.ok, message: msg.message, ...(msg.competence ? { id: msg.competence } : {}) } })
      case 'connecteurs':
        return this.patch({ connecteurs: msg.connecteurs, catalogue: msg.catalogue })
      case 'connecteur.resultat': {
        // La page de consentement s'ouvre dans le navigateur (l'app Mac la passe au navigateur du système) ;
        // si le téléphone la bloque, l'écran garde un lien à toucher.
        if (msg.url) window.open(msg.url, '_blank', 'noopener')
        const service = this.state.connecteurAction?.service ?? ''
        return this.patch({ connecteurAction: { service, busy: false, ok: msg.ok, message: msg.message, ...(msg.url ? { url: msg.url } : {}) } })
      }
      case 'meteo':
        return this.patch({ meteo: { data: msg.meteo, ...(msg.erreur ? { erreur: msg.erreur } : {}), at: Date.now() } })
      case 'position.demande':
        return this.sendPosition(msg.id)
      case 'pont.outil':
      case 'pont.executer': {
        // Le résultat part au serveur par HTTP (main/pont.ts) ; ici, seulement l'échec.
        const pont = this.opts.pont
        const fait = !pont ? Promise.reject(new Error('cette app ne donne pas accès aux fichiers')) : msg.type === 'pont.outil' ? pont.outil(msg.envoi, msg.outil, msg.input) : pont.executer(msg.envoi, msg.cle)
        void fait.catch((err: unknown) => this.send({ type: 'pont.resultat', id: msg.id, erreur: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) }))
        return
      }
      case 'reminders':
        return this.patch({ rappels: msg.rappels })
      case 'reminder.fire':
        // La liste complète suit (`reminders`) ; on l'anticipe pour que l'alerte s'affiche aussitôt.
        return this.patch({ rappels: [msg.rappel, ...this.state.rappels.filter((r) => r.id !== msg.rappel.id)] })
      case 'tasks':
        return this.patch({ taches: msg.taches })
      case 'echeances':
        return this.patch({ echeances: msg.echeances })
      case 'liste': {
        const liste = msg.liste
        // L'élément touché ici reste en évidence ; une liste changée ailleurs n'en met aucun.
        return this.majListe(msg.id, (l) => (liste ? { ...liste, ...(l.focus ? { focus: l.focus } : {}) } : null))
      }
      case 'maison.appareil': {
        const { entite, appareil, erreur } = msg
        return this.majMaison((m) => {
          const contient = m.pieces.some((p) => p.appareils.some((a) => a.id === entite))
          if (!contient) return m
          return {
            ...m,
            ...(erreur ? { message: erreur } : { message: undefined }),
            // Refusé : la tuile revient à son état ; sinon, l'état lu dans Home Assistant.
            pieces: m.pieces.map((p) => ({ ...p, appareils: p.appareils.map((a) => (a.id !== entite ? a : appareil ? { ...appareil, piece: a.piece } : { ...a, actif: !a.actif })) }))
          }
        })
      }
      case 'maison.camera': {
        const vue = msg.vue
        const maj = (v: UiView): UiView => (v.data?.kind === 'camera' && v.data.id === vue.id ? { ...v, data: vue.image || !v.data.image ? vue : { ...v.data, erreur: vue.erreur, heure: vue.heure } } : v)
        return this.patch({ views: this.state.views.map(maj), pile: this.state.pile.map((g) => g.map(maj)) })
      }
      case 'push.status':
        return this.patch({ push: msg.info, ...(msg.ok !== undefined ? { pushResult: { ok: msg.ok, message: msg.message ?? '' } } : {}) })
      case 'pong':
        this.lastPong = Date.now()
        return
      case 'ui.view': {
        const v = msg.view
        // Une page qui se recharge garde son contenu affiché (atténué) jusqu'à la réponse. Un panneau qui
        // apparaît (CODE commence à en parler) passe au premier plan.
        const merge = (group: UiView[]) => {
          const i = group.findIndex((x) => x.id === v.id)
          return i >= 0
            ? group.map((x) => (x.id === v.id ? { ...v, data: v.data ?? (v.status === 'chargement' ? x.data : undefined), at: x.masque && !v.masque ? v.at : x.at } : x))
            : [...group, v]
        }
        const current = this.state.views
        if (!current.length || current[0]!.turnId === v.turnId) return this.patch({ views: merge(current) })
        // Un panneau rangé qui se met à jour (page suivante arrivée après coup) reste rangé.
        const k = this.state.pile.findIndex((g) => g[0]?.turnId === v.turnId)
        if (k >= 0) return this.patch({ pile: this.state.pile.map((g, j) => (j === k ? merge(g) : g)) })
        // Un nouveau tour prend le premier plan ; les panneaux du précédent se rangent à côté.
        const keep = current.some((x) => x.data)
        return this.patch({ views: [v], pile: (keep ? [current, ...this.state.pile] : this.state.pile).slice(0, PILE_MAX) })
      }
      case 'auth.ok':
        this.token = msg.token
        this.opts.onToken?.(msg.token)
        return this.patch({ utilisateur: msg.utilisateur, auth: { busy: false, error: null } })
      case 'auth.error':
        return this.patch({ auth: { busy: false, error: { code: msg.code, message: msg.message, ...(msg.champ ? { champ: msg.champ } : {}) } } })
      case 'compte.resultat':
        return this.patch({ compteAction: { busy: false, ok: msg.ok, message: msg.message, ...(msg.champ ? { champ: msg.champ } : {}) } })
      case 'comptes':
        return this.patch({ comptes: msg.comptes, invitations: msg.invitations })
      case 'invitation':
        return this.patch({ invitationCreee: { prenom: msg.prenom, code: msg.code, expire: msg.expire, ...(msg.url ? { url: msg.url } : {}) } })
      case 'cles':
        return this.patch({ cles: msg.cles })
      case 'cle.resultat':
        return this.patch({ cleAction: { nom: msg.nom, busy: false, ok: msg.ok, message: msg.message } })
      case 'moteurs':
        return this.patch({ moteurs: msg.etat })
      case 'moteurs.modeles':
        return this.patch({ modeles: { ...this.state.modeles, [msg.fournisseur]: { liste: msg.modeles, busy: false, ...(msg.erreur ? { erreur: msg.erreur } : {}) } } })
      case 'banc':
        return this.patch({ banc: msg.resultat })
      case 'usage':
        return this.patch({ usage: msg.usage })
      case 'devices':
        return this.patch({ appareils: msg.appareils })
      case 'reglages':
        return this.patch({ utilisateur: msg.utilisateur, voixChoix: msg.voix, synthese: msg.synthese, elevenlabs: msg.elevenlabs })
      case 'voix.bibliotheque': {
        const b = this.state.bibliotheque
        // Une réponse à une recherche remplacée depuis (autres filtres) est ignorée.
        const cle = (f: VoixRecherche) => [f.recherche?.trim() ?? '', f.genre ?? '', f.usage ?? ''].join('|')
        if (!b || cle(b.filtres) !== cle(msg.filtres)) return
        const voix = (msg.filtres.page ?? 0) > 0 ? [...b.voix, ...msg.voix.filter((v) => !b.voix.some((w) => w.id === v.id))] : msg.voix
        return this.patch({ bibliotheque: { filtres: msg.filtres, voix, suite: msg.suite, chargement: false, erreur: msg.erreur } })
      }
      case 'voix.ajoutee': {
        const b = this.state.bibliotheque
        const demandee = this.state.voixAjout?.id
        return this.patch({
          voixAjout: { id: msg.id, nom: msg.nom, busy: false, erreur: msg.erreur },
          bibliotheque: b && !msg.erreur ? { ...b, voix: b.voix.map((v) => (v.id === msg.id || v.id === demandee ? { ...v, ajoutee: true } : v)) } : b
        })
      }
      case 'reglages.erreur':
        // L'affichage anticipé était faux : on reprend les réglages enregistrés.
        this.send({ type: 'reglages.get' })
        return this.patch({ reglagesErreurs: msg.erreurs })
      case 'card':
        return
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPong > DEAD_AFTER_MS) {
        // Pas de réponse : on considère le Mac injoignable et on se reconnecte.
        this.note(`pas de réponse au ping depuis ${Math.round((Date.now() - this.lastPong) / 1000)} s : reconnexion`)
        return this.reconnect()
      }
      this.send({ type: 'ping' })
    }, PING_MS)
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.pingTimer = null
    this.reconnectTimer = null
  }

  private patch(part: Partial<ClientState>): void {
    this.state = { ...this.state, ...part }
    for (const fn of this.listeners) fn()
  }
}
