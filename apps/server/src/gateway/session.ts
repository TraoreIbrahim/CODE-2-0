import { createHash, randomUUID } from 'node:crypto'
import { PROFIL_DETAILS, TRANSCRIPTION_INFOS, VOICE_SAMPLE_RATE, type ChoixMoteur, type DeviceKind, type FournisseurId, type Ecoute, type Etat, type LogEntry, type Reglages, type ServerPayload, type UiData, type UsageKind, type VoixChoix, type VoixRecherche } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { Brain, describeBrainError } from '../brain/brain.ts'
import { SentenceChunker } from '../brain/chunker.ts'
import { lancerBanc, listBancs } from '../brain/banc.ts'
import { contexteOllama } from '../brain/moteurs/compat.ts'
import { MarkStripper, TurnPanels, readingMs, takeMarks } from './panels.ts'
import { addLog, addMessage, recentLog, recentMessages } from '../db.ts'
import { ConfirmGate } from '../safety/confirm.ts'
import type { Secrets } from '../secrets.ts'
import { AsyncQueue, isAbort, sleep } from '../util.ts'
import { durationMs, levels } from '../voice/pcm.ts'
import { SttUnavailable, openStt, type SttStream } from '../voice/stt.ts'
import { SensDuTour } from '../voice/fin-de-tour.ts'
import { SpeakerGate, SpeakerTurn } from '../voice/speaker.ts'
import { chiffresDictes } from '../voice/chiffres-dictes.ts'
import { sansMotActivation } from '../voice/activation.ts'
import { addNote } from '../tools/memory.ts'
import { motsClesPour } from '../voice/vocabulaire.ts'
import type { Tts, TtsOptions } from '../voice/tts.ts'
import { ajouterVoix, bibliotheque, voixDuCompte } from '../voice/elevenlabs-voix.ts'
import { toolUi, type ToolContext } from '../tools/index.ts'
import type { GeoPosition } from '../tools/types.ts'
import { FILE_TOOLS } from '../tools/index.ts'
import { erreurDuMac, pontVers, type PontMac } from '../pont/pont.ts'
import { meteoFor } from '../tools/meteo.ts'
import { listCompetences, lireTexte, modeles, removeCompetence, saveCompetence, ID_VALIDE } from '../competences/store.ts'
import { boiteInfo, cleanEmail, guessServers, listBoites, removeBoite, saveBoite, setDefaultBoite, testBoite, type Serveurs } from '../mail/boites.ts'
import { persoPageable, persoResume } from '../tools/perso.ts'
import { catalogueInfo, serviceOf } from '../connecteurs/catalogue.ts'
import { connexion, connexionsFor, connecteursInfo, maisonDe } from '../connecteurs/registre.ts'
import { baseMaison } from '../connecteurs/maison.ts'
import { jetonsDev, listConnecteurs, removeConnecteur, saveConnecteur, updateAcces, type Acces } from '../connecteurs/store.ts'
import type { AlertesHooks, EchecProjet } from '../connecteurs/alertes.ts'
import { verifierComplement } from '../connecteurs/expo.ts'
import { disconnectGoogle, googleStatus, startGoogleConnect } from '../google/oauth.ts'
import { BRIEFING_PROMPT, nomAssistant } from '../brain/prompt.ts'
import { activeRappels, getState, markDone, setState, snooze, type Rappel } from '../scheduler/store.ts'
import { localDay } from '../google/calendar.ts'
import { notifyAll, notifyOne, pushInfo, subscribe, unsubscribe } from '../push/push.ts'
import type { PushMessage } from '../push/messages.ts'
import type { PushOptions } from '../push/webpush.ts'
import { briefingMessage, reminderMessage, projetsHistory, projetsMessage, projetsSpoken } from '../push/messages.ts'
import { currentTaches } from '../tools/taches.ts'
import { finishExecution, finishedSince, getTache, startExecution, updateTache, type Tache } from '../scheduler/tasks.ts'
import { briefingDue, silenceNow } from '../scheduler/rules.ts'
import { budgetThreshold, usageResume } from '../brain/usage.ts'
import { runAsUser } from '../users/scope.ts'
import { appellationOf, finishAssistant, getUser, listUsers, spokenNameOf, updateReglages, userInfo, type Utilisateur } from '../users/users.ts'
import { validateReglages } from '../users/reglages.ts'
import { PANNEAUX_RETOUR, absenceText, panneauxRetour, retourPrompt, type PanneauRetour, type RetourFacts } from './retour.ts'
import { presentationSpeech, reminderSpeech, sampleSpeech } from '../scheduler/speech.ts'
import { splitResult } from '../scheduler/task-views.ts'
import { toUiRappel } from '../scheduler/views.ts'
import { echeancesARegler, reglerEcheance } from '../echeances/store.ts'
import { getDocument } from '../documents/store.ts'
import { creerReunion, getReunion, listerReunions, marquerAnnoncee, supprimerReunion, terminerReunion, type Reunion } from '../reunions/store.ts'
import { fileReunions, serviceReunion, tarifHeure } from '../reunions/transcrire.ts'
import type { VisioProche } from '../reunions/agenda.ts'
import { dureeLisible, reunionLigne } from '../tools/reunions.ts'
import { uiEcheance } from '../echeances/vue.ts'
import { cocherElements, getListe } from '../listes/store.ts'
import { listeView } from '../listes/vue.ts'

/** Ce dont la session a besoin pour parler aux appareils connectés de son utilisateur (et à eux seuls). */
export interface Io {
  broadcast(payload: ServerPayload): void
  send(connectionId: string, payload: ServerPayload): void
  sendBinary(connectionId: string, data: Buffer): void
}

type RunningTurn = { id: string; abort: AbortController }
/** `vues` : des panneaux déjà prêts (point du retour), cachés jusqu'à la marque `[[voir:nom]]` de l'assistant. */
type TurnOptions = { speak: boolean; written: boolean; usage?: UsageKind; vues?: { nom: string; titre: string; data: UiData }[] }

/** Une tâche planifiée qui dépasse ce temps est arrêtée (boucle d'outils, réseau bloqué). */
const TASK_TIMEOUT_MS = 5 * 60_000

/** Ce qu'il faut à une session en plus de son utilisateur. */
export type SessionDeps = {
  io: Io
  /** Ses clés API, relues à chaque changement : son coffre, plus celles du serveur pour le propriétaire. */
  cles: () => Secrets
  /** La voix qui va avec des clés (partagée entre comptes qui ont les mêmes). */
  voix: (secrets: Secrets) => Promise<Tts | null>
  /** Fichiers de l'ordinateur : seulement l'utilisateur dont l'app de bureau est reliée à ce serveur. */
  fichiers: () => boolean
}

/**
 * La conversation d'un utilisateur, partagée par tous ses appareils (et eux seuls) ; chaque utilisateur a la sienne.
 * Machine à états : veille → écoute → réflexion → parole → veille,
 * avec attente de validation et arrêt d'urgence (docs/SPEC.md, 3.2).
 */
/** Calme après la dernière réponse au bout duquel CODE relit la conversation pour apprendre. */
const LEARN_AFTER_MS = 3 * 60_000
/** Au plus autant de messages relus d'un coup (une très longue conversation : les plus récents). */
const LEARN_MAX_MESSAGES = 60
/** Délai pendant lequel un appel exprès resté sans texte vaut pour la phrase suivante. */
const CALL_CARRY_MS = 10_000

export class Session {
  private state: Etat = 'veille'
  private micOwner: string | null = null
  /** Appareil de chaque connexion, pour reprendre une réponse si le même appareil se reconnecte. */
  private devices = new Map<string, string>()
  /** Connexions de l'app Mac qui exécutent les outils de fichiers sur ce Mac (le pont). */
  private ponts = new Set<string>()
  /** Où part la voix de la réponse en cours ; suit l'appareil s'il se reconnecte pendant qu'elle est lue. */
  private replyTo: string | null = null
  /** Le dernier échange s'est fait par écrit (mode chat) : les annonces suivantes restent muettes aussi. */
  private lastWritten = false
  private replyDevice: string | null = null
  private stt: SttStream | null = null
  private turn: RunningTurn | null = null
  /** Les panneaux du dernier tour (certains peuvent encore attendre leur moment). */
  private panels: TurnPanels | null = null
  private stopped = false
  /** Dernier signe de l'utilisateur (parole, écrit, clic, écran réveillé) ; gardé en base pour survivre aux redémarrages. */
  private lastActive: number
  private lastActiveSaved = 0
  /** Apprentissage après une conversation : échanges déjà relus jusqu'à cet instant. */
  private learnTimer: ReturnType<typeof setTimeout> | null = null
  private learnedUpTo = Date.now()
  /** Audio de la phrase en cours, pour vérifier la voix. */
  private utterance: Buffer[] = []
  /** Empreinte enregistrée : la phrase en cours suit votre voix (début, fin, passages gardés). */
  private voiceTurn: SpeakerTurn | null = null
  /** Le sens de la phrase en cours : finie ou au milieu, jugé pendant les pauses. */
  private readonly sens: SensDuTour
  /**
   * Phrase commencée pendant que CODE répond : il n'est coupé qu'à votre voix reconnue. Son propre écho
   * dans le haut-parleur, la télé ou un voisin ne l'interrompent plus.
   */
  private overReply = false
  /**
   * Dernière phrase après un appel exprès. Si elle n'a rien donné (la fin du mot, un bruit) ou se transcrit
   * encore, l'appel vaut aussi pour la phrase suivante : votre vraie demande ne doit pas passer par la voix.
   */
  private lastCall: { until: number; empty: boolean | null } | null = null
  /** Appareil qui enregistre l'empreinte vocale, le cas échéant. */
  private enroller: string | null = null
  /**
   * Mode conversation : la connexion dont le micro reste ouvert sans appel, et le minuteur du long
   * silence qui le coupe (compté depuis votre dernière phrase reconnue ou la fin de la réponse de CODE).
   */
  private conversation: { connectionId: string; timer?: ReturnType<typeof setTimeout> } | null = null
  readonly speaker: SpeakerGate
  private brain!: Brain
  private tts: Tts | null = null
  private readonly io: Io
  private secrets: Secrets = {}
  /** Les voix de son compte ElevenLabs (clonées, ajoutées depuis la bibliothèque), proposées en plus des voix de base. */
  private voixCompte: VoixChoix[] = []
  /** Empreinte des clés en service : une clé changée recharge le moteur et la voix. */
  private clesEmpreinte = ''
  private readonly voixPour: SessionDeps['voix']
  private readonly lireCles: SessionDeps['cles']
  /** Moteur et voix prêts avec ses clés (la voix se charge en arrière-plan). */
  ready: Promise<void>
  private readonly fichiers: () => boolean
  readonly gate: ConfirmGate

  constructor(
    readonly uid: number,
    deps: SessionDeps
  ) {
    this.io = deps.io
    this.lireCles = deps.cles
    this.voixPour = deps.voix
    this.fichiers = deps.fichiers
    this.ready = this.reloadKeys()
    this.sens = new SensDuTour(
      (texte, signal) => this.brain.finDePhrase(this.user, texte, signal),
      (text, fini) => this.micOwner && this.io.send(this.micOwner, { type: 'transcript.sens', text, fini })
    )
    this.speaker = new SpeakerGate(uid)
    this.lastActive = Number(getState(uid, 'derniere_presence')) || Date.now()
    this.gate = new ConfirmGate({
      timeoutMs: codeConfig.safety.confirmTimeoutMs,
      acceptPhrases: codeConfig.safety.acceptPhrases,
      onResult: (req, outcome, via) => {
        this.io.broadcast({ type: 'confirm.result', actionId: req.actionId, outcome })
        const verdict = { valide: 'validée', annule: 'annulée', expire: 'expirée' }[outcome]
        this.log('validation', `${req.title} : ${verdict} (${via})`)
        if (this.state === 'attente_validation') this.setState('veille')
      }
    })
  }

  /**
   * Recharge ses clés : les moteurs tout de suite, la voix dès qu'elle est prête. Un compte autre que le
   * propriétaire n'utilise que ses propres clés (jamais celles du serveur).
   */
  reloadKeys(): Promise<void> {
    const secrets = this.lireCles()
    const empreinte = createHash('sha256').update(JSON.stringify(Object.entries(secrets).sort())).digest('hex')
    if (empreinte === this.clesEmpreinte) return this.ready
    this.clesEmpreinte = empreinte
    this.secrets = secrets
    this.brain = new Brain(secrets, { ambiante: this.user.proprietaire })
    void this.chargerVoixCompte()
    return this.voixPour(secrets).then(
      (tts) => {
        if (this.clesEmpreinte === empreinte) this.tts = tts
      },
      (err) => console.error(`[session ${this.uid}] voix :`, err instanceof Error ? err.message : err)
    )
  }

  /** L'utilisateur, relu à chaque fois : ses réglages peuvent changer pendant la session. */
  get user(): Utilisateur {
    const u = getUser(this.uid)
    if (!u) throw new Error(`Utilisateur ${this.uid} introuvable.`)
    return u
  }

  private get tz(): string {
    return this.user.reglages.fuseau
  }

  /** Ses heures de silence, en ce moment : ni annonce ni notification, sauf une alerte grave. */
  private get quiet(): boolean {
    const r = this.user.reglages
    return silenceNow(Date.now(), r.fuseau, r.silence)
  }

  /** La voix de son assistant, sa vitesse et le service qui la dit, à chaque synthèse. */
  private get voice(): TtsOptions {
    const r = this.user.reglages
    return { voix: r.voix, vitesse: r.vitesseVoix, qualite: r.qualiteVoix, synthese: r.synthese }
  }

  /** Notification sur ses téléphones, s'il les veut ; pendant le silence, seulement si `grave`. */
  private notify(msg: PushMessage, opts: PushOptions = {}, grave = false): Promise<number> {
    const r = this.user.reglages
    if (!r.notifications || (this.quiet && !grave)) return Promise.resolve(0)
    return notifyAll(this.uid, msg, opts)
  }

  /** Arrêt d'urgence en cours : le planificateur et les alertes ne font rien pour lui. */
  get halted(): boolean {
    return this.stopped
  }

  private rappels() {
    const now = Date.now()
    const tz = this.tz
    return activeRappels(this.uid).map((r) => toUiRappel(r, now, tz))
  }

  // ── Événements venus d'ailleurs (base, Google, compteur), relayés par le gestionnaire des sessions ──

  onRemindersChanged(): void {
    this.io.broadcast({ type: 'reminders', rappels: this.rappels() })
  }

  onTasksChanged(): void {
    this.io.broadcast({ type: 'tasks', taches: currentTaches(this.uid, this.tz) })
  }

  /** Les échéances à régler, pour la carte « Échéances » (l'écran recalcule « dans 3 jours » chaque jour). */
  private echeances() {
    const now = Date.now()
    const today = localDay(now, this.tz)
    return echeancesARegler(this.uid).map((e) => uiEcheance(e, today, this.tz))
  }

  onEcheancesChanged(): void {
    this.io.broadcast({ type: 'echeances', echeances: this.echeances() })
  }

  /** Une liste qu'il voit (ou voyait) a changé, chez lui ou chez quelqu'un de la maison : ses panneaux suivent. */
  onListeChanged(id: number): void {
    const l = getListe(this.uid, id)
    this.io.broadcast(l ? { type: 'liste', id, liste: listeView(this.uid, l) } : { type: 'liste', id })
  }

  onGoogleStatus(): void {
    this.io.broadcast({ type: 'google.status', status: googleStatus(this.uid) })
  }

  // ── Boîtes mail IMAP ──

  boitesPayload() {
    return { type: 'boites' as const, boites: listBoites(this.uid).map(boiteInfo) }
  }

  /**
   * Relier une boîte : adresse et mot de passe vérifiés, serveurs devinés (ou saisis), connexion testée en
   * lecture et en envoi, puis seulement enregistrement (mot de passe chiffré). Jamais de mot de passe au journal.
   */
  async onBoiteAjouter(connectionId: string, msg: Record<string, unknown>): Promise<void> {
    const reply = (ok: boolean, message: string, manuel = false) => this.io.send(connectionId, { type: 'boite.resultat', ok, message, ...(manuel ? { manuel } : {}) })
    const email = cleanEmail(String(msg.email ?? ''))
    const password = typeof msg.motDePasse === 'string' ? msg.motDePasse : ''
    const libelle = String(msg.libelle ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
    if (!email) return reply(false, 'Adresse e-mail invalide.')
    if (!password || password.length > 256) return reply(false, 'Mot de passe attendu.')
    const host = (v: unknown) => (typeof v === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim()) ? v.trim().toLowerCase() : null)
    const port = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536 ? (v as number) : null)
    let servers: Serveurs | null = null
    if (msg.imapHote || msg.smtpHote) {
      const ih = host(msg.imapHote)
      const sh = host(msg.smtpHote)
      if (!ih || !sh) return reply(false, 'Serveurs IMAP et SMTP attendus (ex. imap.exemple.fr).', true)
      servers = { fournisseur: ih, imapHote: ih, imapPort: port(msg.imapPort) ?? 993, smtpHote: sh, smtpPort: port(msg.smtpPort) ?? 465 }
    } else {
      const guess = await guessServers(email)
      if (guess && 'erreur' in guess) return reply(false, guess.erreur)
      if (!guess) return reply(false, 'Serveurs de cette adresse inconnus : indiquez-les (lecture IMAP, envoi SMTP).', true)
      servers = guess
    }
    const failure = await testBoite(email, password, servers)
    if (failure) return reply(false, failure)
    const b = saveBoite(this.uid, libelle || (email.split('@')[1]!), email, password, servers)
    this.log('action', `Boîte mail reliée : ${b.libelle} <${b.email}>`)
    reply(true, `${b.email} est reliée : lecture et envoi vérifiés.`)
    this.io.broadcast(this.boitesPayload())
    this.io.broadcast({ type: 'perso.resume', resume: await persoResume(this.uid, this.tz) })
  }

  async onBoiteRetirer(id: number): Promise<void> {
    if (removeBoite(this.uid, id)) this.log('action', 'Boîte mail retirée')
    this.io.broadcast(this.boitesPayload())
    this.io.broadcast({ type: 'perso.resume', resume: await persoResume(this.uid, this.tz) })
  }

  onBoiteDefaut(id: number): void {
    setDefaultBoite(this.uid, id)
    this.io.broadcast(this.boitesPayload())
  }

  // ── Réunions (enregistrées ou importées, puis transcrites) ──

  /** Les enregistrements en pause (le temps du serveur : au redémarrage, ils reprennent). */
  private reunionsEnPause = new Set<number>()

  /** Une réunion s'enregistre au micro pour cette personne : l'assistant se tait et n'écoute que sur appel. */
  private get enReunion(): boolean {
    return listerReunions(this.uid).some((r) => r.etat === 'enregistrement' && r.source === 'micro')
  }

  private ligneReunion(r: Reunion) {
    return { ...reunionLigne(r, this.tz), ...(r.etat === 'enregistrement' && this.reunionsEnPause.has(r.id) ? { enPause: true } : {}) }
  }

  reunionsPayload() {
    return { type: 'reunions' as const, reunions: listerReunions(this.uid).map((r) => this.ligneReunion(r)) }
  }

  /**
   * Un appareil veut enregistrer (ou importer un fichier audio) : la réunion est ouverte, et l'appareil apprend
   * comment découper l'audio, qui transcrira et à quel prix. Sans clé de transcription, rien ne commence.
   */
  onReunionDemarrer(connectionId: string, msg: Record<string, unknown>): void {
    const cles = this.lireCles()
    const service = serviceReunion((c) => !!cles[c])
    if (!service) return void this.io.send(connectionId, { type: 'reunion.refus', message: 'Aucune clé de transcription : ajoutez-en une dans Réglages › Clés API (Groq est la moins chère, environ 4 centimes de dollar l’heure).' })
    const source = msg.source === 'fichier' ? 'fichier' : 'micro'
    const now = Date.now()
    const jour = new Date(now).toLocaleDateString('fr-FR', { timeZone: this.tz, day: 'numeric', month: 'long' })
    const heure = new Date(now).toLocaleTimeString('fr-FR', { timeZone: this.tz, hour: '2-digit', minute: '2-digit' })
    const titre = (typeof msg.titre === 'string' ? msg.titre.replace(/\s+/g, ' ').trim().slice(0, 120) : '') || (source === 'fichier' ? `Enregistrement importé le ${jour}` : `Réunion du ${jour}, ${heure}`)
    const r = creerReunion(this.uid, { titre, source }, now)
    this.log('action', `Réunion : ${source === 'fichier' ? 'import d’un enregistrement' : 'enregistrement lancé'} (${r.titre})`)
    // Pendant la réunion, il ne doit ni répondre à ce qui se dit ni couper la parole : l'écoute continue s'arrête.
    if (source === 'micro') this.endConversation('une réunion s’enregistre')
    const c = codeConfig.voice.reunions
    this.io.send(connectionId, { type: 'reunion.ouverte', reunion: r.id, titre: r.titre, segmentS: c.segmentS, segmentMaxS: c.segmentMaxS, dureeMaxS: c.dureeMaxS, service: TRANSCRIPTION_INFOS[service].nom, tarif: tarifHeure(service) })
  }

  /** L'enregistrement est fini : la transcription va au bout, puis l'assistant l'annonce. */
  onReunionTerminer(id: number): void {
    const r = terminerReunion(this.uid, id)
    if (!r) return
    this.log('action', `Réunion : enregistrement terminé (${r.titre}, ${dureeLisible(r.dureeS)})`)
    if (r.etat === 'transcription') fileReunions.planifier(id)
  }

  /** Pause ou reprise, depuis n'importe quel écran : l'appareil qui enregistre suit l'état diffusé. */
  onReunionPause(id: number, pause: boolean): boolean {
    const r = getReunion(this.uid, id)
    if (r?.etat !== 'enregistrement' || this.reunionsEnPause.has(id) === pause) return false
    if (pause) this.reunionsEnPause.add(id)
    else this.reunionsEnPause.delete(id)
    this.log('action', `Réunion : enregistrement ${pause ? 'en pause' : 'repris'}`)
    this.io.broadcast({ type: 'reunion.etat', reunion: id, ligne: this.ligneReunion(r) })
    return true
  }

  /** « Terminer » depuis un autre écran : celui qui enregistre s'arrête (les autres ignorent la demande). */
  onReunionStop(id: number): void {
    if (getReunion(this.uid, id)?.etat === 'enregistrement') this.io.broadcast({ type: 'reunion.commande', action: 'arreter' })
  }

  onReunionAnnuler(id: number): void {
    if (supprimerReunion(this.uid, id)) this.log('action', 'Réunion : enregistrement abandonné')
  }

  /** Une réunion a avancé : ses écrans suivent ; transcrite (ou en échec), elle est annoncée une fois. */
  onReunionChanged(id: number): void {
    const r = getReunion(this.uid, id)
    if (r?.etat !== 'enregistrement') this.reunionsEnPause.delete(id)
    this.io.broadcast({ type: 'reunion.etat', reunion: id, ...(r ? { ligne: this.ligneReunion(r) } : {}) })
    if (!r || r.annoncee || (r.etat !== 'prete' && r.etat !== 'erreur')) return
    marquerAnnoncee(id)
    this.annoncerReunion(r)
  }

  /**
   * Rédigé sans le modèle (rien à payer tant qu'il ne demande rien) ; la phrase entre dans la conversation,
   * pour que « oui, fais le compte rendu » se comprenne.
   */
  private annoncerReunion(r: Reunion): void {
    const duree = dureeLisible(r.dureeS)
    const tu = this.user.reglages.tutoiement
    const ok = r.etat === 'prete'
    const dit = ok
      ? `La réunion est transcrite : ${duree}. ${tu ? 'Veux-tu' : 'Voulez-vous'} le compte rendu, ou la liste de ce qu’il y a à faire ?`
      : `La transcription de la réunion a échoué. ${r.erreur ?? ''}`.trim()
    const historique = ok ? `[Réunion ${r.id} transcrite : « ${r.titre} », ${duree}.] ${dit}` : `[Réunion ${r.id} : transcription en échec.] ${dit}`
    this.log('systeme', ok ? `Réunion transcrite : ${r.titre} (${duree})` : `Réunion : transcription en échec (${r.titre})`)
    void this.notify({ titre: ok ? 'Réunion transcrite' : 'Réunion : transcription en échec', corps: `${r.titre} · ${duree}`, tag: `reunion-${r.id}`, url: '/' })
    const device = this.speakerDevice()
    if (!this.quiet && device && this.state === 'veille' && !this.turn) void this.announce(dit, device, historique)
    else addMessage(this.uid, 'assistant', historique)
  }

  /**
   * Une réunion en visio de son agenda commence : proposée sur ses écrans (carte) et, s'il est disponible, à
   * voix haute. `false` : aucun écran ouvert, à retenter. Rien ne s'enregistre sans sa réponse.
   */
  onVisioProche(v: VisioProche): boolean {
    if (!this.user.reglages.reunionsAgenda || this.stopped) return true
    if (!this.devices.size) return false
    // Déjà en train d'enregistrer : rien à proposer.
    if (listerReunions(this.uid).some((r) => r.etat === 'enregistrement')) return true
    const heure = new Date(v.debut).toLocaleTimeString('fr-FR', { timeZone: this.tz, hour: '2-digit', minute: '2-digit' })
    this.io.broadcast({ type: 'reunion.proposition', cle: v.cle, titre: v.titre, heure, service: v.service })
    const tu = this.user.reglages.tutoiement
    const dit = `${tu ? 'Ta' : 'Votre'} réunion « ${v.titre} » commence${v.service ? ` sur ${v.service}` : ''}. Je l’enregistre ?`
    const historique = `[Réunion d’agenda : « ${v.titre} », ${heure}, en visio.] ${dit}`
    this.log('systeme', `Réunion de l’agenda proposée à l’enregistrement : ${v.titre} (${heure})`)
    const device = this.speakerDevice()
    if (!this.quiet && device && this.state === 'veille' && !this.turn) void this.announce(dit, device, historique)
    else addMessage(this.uid, 'assistant', historique)
    return true
  }

  /** « Enregistre la réunion » : l'appareil qui a parlé reçoit la demande, c'est lui qui a le micro. */
  private commandeReunion(action: 'demarrer' | 'arreter' | 'pause' | 'reprendre', titre?: string): { ok: boolean; message: string } {
    if (action === 'pause' || action === 'reprendre') {
      const r = listerReunions(this.uid).find((x) => x.etat === 'enregistrement')
      if (!r) return { ok: false, message: 'Aucun enregistrement en cours.' }
      this.onReunionPause(r.id, action === 'pause')
      return { ok: true, message: action === 'pause' ? 'L’enregistrement est en pause : rien n’est capté jusqu’à la reprise. Dis-le en trois mots.' : 'L’enregistrement a repris. Dis-le en trois mots, puis tais-toi.' }
    }
    let to = this.micOwner
    // La miniature de l'ordinateur n'a pas d'écran pour l'enregistrement : la fenêtre de l'app s'en charge.
    if (to && this.devices.get(to) === 'mini') {
      to = [...this.devices].find(([, d]) => d === 'mac')?.[0] ?? null
      if (!to) return { ok: false, message: 'La miniature ne peut pas enregistrer : il faut ouvrir la fenêtre de l’app (double-clic sur la miniature), puis le redemander. Dis-le simplement.' }
    }
    if (!to) return { ok: false, message: 'Aucun appareil à qui le demander : l’enregistrement se lance depuis un appareil ouvert (bouton « Réunion »).' }
    this.io.send(to, { type: 'reunion.commande', action, ...(titre?.trim() ? { titre: titre.trim().slice(0, 120) } : {}) })
    return action === 'demarrer'
      ? { ok: true, message: 'Demande envoyée à l’appareil : l’enregistrement démarre, un bandeau l’indique à l’écran. Réponds par une seule phrase très courte (« C’est parti, j’enregistre. »), sans question ni rappel. Ensuite tu te tais : l’écoute continue est coupée, il te touchera s’il a besoin de toi.' }
      : { ok: true, message: 'Demande envoyée à l’appareil : l’enregistrement s’arrête et la transcription se termine. Tu préviendras quand elle sera prête ; ne lis rien avant.' }
  }

  // ── Compétences (méthodes en fichiers texte) ──

  competencesPayload() {
    return { type: 'competences' as const, competences: listCompetences(this.uid), modeles: modeles() }
  }

  /** Les compétences ont changé (Réglages, voix, autre appareil) : tous ses écrans suivent. */
  onCompetencesChanged(): void {
    this.io.broadcast(this.competencesPayload())
  }

  /** Écrite dans les Réglages, ou importée d'un fichier : vérifiée, puis enregistrée (la liste suit par `onCompetencesChanged`). */
  onCompetenceEnregistrer(connectionId: string, msg: Record<string, unknown>): void {
    const reply = (ok: boolean, message: string, id?: string) => this.io.send(connectionId, { type: 'competence.resultat', ok, message, ...(id ? { competence: id } : {}) })
    // `competence`, jamais `msg.id` : celui-là est l'identifiant du message, présent sur chacun.
    const id = typeof msg.competence === 'string' && ID_VALIDE.test(msg.competence) ? msg.competence : undefined
    if (msg.competence !== undefined && !id) return reply(false, 'Cette compétence n’existe plus.')
    const texte = (k: string, max: number) => (typeof msg[k] === 'string' ? (msg[k] as string).slice(0, max) : '')
    const lu =
      typeof msg.texte === 'string'
        ? lireTexte(texte('texte', 30_000), texte('fichier', 120))
        : { nom: texte('nom', 200), description: texte('description', 1000), corps: texte('corps', 30_000) }
    if ('erreur' in lu) return reply(false, lu.erreur)
    const r = saveCompetence(this.uid, lu, { id })
    if ('erreur' in r) return reply(false, r.erreur)
    this.log('action', `Compétence ${id ? 'modifiée' : 'ajoutée'} : ${r.nom}`)
    reply(true, id ? `« ${r.nom} » est enregistrée.` : `« ${r.nom} » est apprise.`, r.id)
  }

  onCompetenceSupprimer(id: string): void {
    if (removeCompetence(this.uid, id)) this.log('action', 'Compétence retirée')
  }

  // ── Connecteurs MCP (GitHub, Figma, Vercel…) ──

  connecteursPayload() {
    return { type: 'connecteurs' as const, connecteurs: connecteursInfo(this.uid), catalogue: catalogueInfo() }
  }

  /**
   * Relier un service : avec un jeton, la connexion est testée avant d'être gardée ; sans jeton (OAuth), la
   * page de consentement du service est renvoyée à l'appareil, qui l'ouvre dans le navigateur. Le jeton n'est
   * jamais écrit au journal ni renvoyé à un écran.
   */
  async onConnecteurAjouter(connectionId: string, msg: Record<string, unknown>): Promise<void> {
    const reply = (ok: boolean, message: string, url?: string) => this.io.send(connectionId, { type: 'connecteur.resultat', ok, message, ...(url ? { url } : {}) })
    const id = String(msg.service ?? '')
    const service = serviceOf(id)
    if (!service && id !== 'mcp') return reply(false, 'Service inconnu.')
    const jeton = typeof msg.jeton === 'string' ? msg.jeton.trim() : ''
    if (jeton.length > 4096) return reply(false, 'Jeton trop long.')
    let url = service?.url ?? ''
    if (!service || service.urlLibre) {
      try {
        const brut = String(msg.url ?? '').trim()
        // Home Assistant : l'adresse de l'installation, quelle que soit la page copiée (…/lovelace/0, …/api).
        if (service?.natif === 'homeassistant') url = baseMaison(brut)
        else {
          const u = new URL(brut)
          if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
          url = u.toString()
        }
      } catch {
        return reply(false, service?.natif === 'homeassistant' ? 'Adresse de Home Assistant attendue (http://homeassistant.local:8123).' : 'Adresse du serveur MCP attendue (https://…/mcp).')
      }
    }
    // Une seule maison : ses outils portent des noms fixes (maison_commande…).
    if (service?.natif === 'homeassistant' && listConnecteurs(this.uid).some((c) => c.service === service.id && c.url !== url)) {
      return reply(false, 'Home Assistant est déjà relié : retirez-le d’abord pour en relier un autre.')
    }
    if (service?.acces === 'jeton' && !jeton) return reply(false, `Collez le jeton ${service.nom}.`)
    const libelle = service?.nom ?? (String(msg.libelle ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) || new URL(url).host)
    // Sans jeton : OAuth si le service le demande ; un serveur ajouté à la main est d'abord essayé sans accès.
    const base: Acces = jeton ? { jeton } : service && service.acces !== 'aucun' ? { oauth: {} } : {}
    const complement = service?.complement && typeof msg.complement === 'string' ? msg.complement.trim().slice(0, 4096) : ''
    if (complement) {
      const refus = await verifierComplement(service!.id, complement)
      if (refus) return reply(false, `${service!.nom} : ${refus}`)
    }
    const acces: Acces = complement ? { ...base, complement } : base
    const c = saveConnecteur(this.uid, service?.id ?? 'mcp', libelle, url, acces)
    const cx = connexion(this.uid, c.id)!
    cx.close()
    try {
      if (acces.oauth) return this.authorizeConnecteur(connectionId, c.id)
      await cx.init(true)
      let st = cx.status()
      if (!service && st.etat === 'erreur' && /401|unauthori[sz]ed|invalid_token/i.test(st.message)) {
        saveConnecteur(this.uid, 'mcp', libelle, url, { oauth: {} })
        return this.authorizeConnecteur(connectionId, c.id)
      }
      st = cx.status()
      if (st.etat !== 'connecte') {
        removeConnecteur(this.uid, c.id)
        connexionsFor(this.uid)
        return reply(false, `${libelle} : connexion impossible (${st.message || 'refusée'}).`)
      }
      this.log('action', `Connecteur relié : ${libelle}`)
      reply(true, `${libelle} est relié : ${st.outils} outil${st.outils > 1 ? 's' : ''}${st.actions ? `, dont ${st.actions} avec votre validation` : ''}.`)
    } finally {
      this.io.broadcast(this.connecteursPayload())
    }
  }

  /** Jeton complémentaire d'un connecteur relié (Expo : la liste des projets) : vérifié, chiffré, jamais renvoyé. */
  async onConnecteurComplement(connectionId: string, id: number, jeton: string): Promise<void> {
    const reply = (ok: boolean, message: string) => this.io.send(connectionId, { type: 'connecteur.resultat', ok, message })
    const cx = connexion(this.uid, id)
    const service = cx && serviceOf(cx.c.service)
    if (!cx || !service?.complement) return reply(false, 'Ce connecteur n’accepte pas de jeton complémentaire.')
    const valeur = String(jeton ?? '').trim().slice(0, 4096)
    if (valeur) {
      const refus = await verifierComplement(service.id, valeur)
      if (refus) return reply(false, `${service.nom} : ${refus}`)
    }
    updateAcces(cx.c, (a) => {
      const { complement: _, ...reste } = a
      return valeur ? { ...reste, complement: valeur } : reste
    })
    await cx.init(true)
    this.log('action', `${cx.c.libelle} : jeton complémentaire ${valeur ? 'ajouté' : 'retiré'}`)
    reply(true, valeur ? `${cx.c.libelle} : jeton enregistré, ${nomAssistant(this.user)} voit maintenant tous vos projets.` : `${cx.c.libelle} : jeton retiré.`)
    this.io.broadcast(this.connecteursPayload())
  }

  /** Demande la page de consentement OAuth d'un connecteur ; l'appareil l'ouvre, le retour passe par `/connecteurs/retour`. */
  async authorizeConnecteur(connectionId: string, id: number): Promise<void> {
    const reply = (ok: boolean, message: string, url?: string) => this.io.send(connectionId, { type: 'connecteur.resultat', ok, message, ...(url ? { url } : {}) })
    const cx = connexion(this.uid, id)
    if (!cx) return reply(false, 'Ce connecteur n’existe plus.')
    try {
      const url = await cx.authorize()
      if (!url) {
        await cx.init(true)
        reply(true, `${cx.c.libelle} est déjà autorisé.`)
      } else reply(true, `Autorisez CODE 2.0 dans la page ${cx.c.libelle} qui s’ouvre.`, url)
    } catch (err) {
      reply(false, `${cx.c.libelle} : autorisation impossible (${err instanceof Error ? err.message : String(err)}).`)
    }
    this.io.broadcast(this.connecteursPayload())
  }

  /** Consentement donné (retour du navigateur) : la liste se met à jour sur ses écrans. */
  onConnecteurAutorise(libelle: string, ok: boolean): void {
    if (ok) this.log('action', `Connecteur relié : ${libelle}`)
    this.io.broadcast(this.connecteursPayload())
  }

  onConnecteurRetirer(id: number): void {
    const cx = connexion(this.uid, id)
    if (cx && removeConnecteur(this.uid, id)) this.log('action', `Connecteur retiré : ${cx.c.libelle}`)
    connexionsFor(this.uid)
    this.io.broadcast(this.connecteursPayload())
  }

  /** Coût du jour et du mois ; la vue par personne n'est donnée qu'au premier utilisateur. */
  usage() {
    const u = this.user
    const people = u.proprietaire ? listUsers().map((p) => ({ id: p.id, nom: [p.prenom, p.nom].filter(Boolean).join(' ') || `Utilisateur ${p.id}` })) : null
    return usageResume(this.uid, u.reglages.fuseau, people)
  }

  onUsageChanged(): void {
    this.io.broadcast({ type: 'usage', usage: this.usage() })
    const r = this.user.reglages
    const franchi = budgetThreshold(this.uid, r.fuseau, r.plafondJour)
    if (!franchi || r.plafondJour === null) return
    const montant = (n: number) => `${n.toFixed(2).replace('.', ',')} $`
    const nom = nomAssistant(this.user)
    const quoi = franchi.seuil === 100 ? 'plafond du jour atteint' : '80 % du budget du jour'
    const msg: PushMessage = {
      titre: `${nom} · ${quoi}`,
      corps:
        franchi.seuil === 100
          ? `${montant(franchi.depense)} dépensés sur ${montant(r.plafondJour)} aujourd’hui. ${nom} répond avec le modèle rapide jusqu’à minuit (Réglages › Consommation pour changer le plafond).`
          : `${montant(franchi.depense)} dépensés sur ${montant(r.plafondJour)} aujourd’hui. Au-delà, ${nom} passera sur le modèle rapide jusqu’à minuit.`,
      tag: 'budget'
    }
    this.log('systeme', quoi.replace(/^./, (c) => c.toUpperCase()) + ` (${montant(franchi.depense)} sur ${montant(r.plafondJour)})`)
    void this.notify(msg, { ttl: 6 * 3600 })
  }

  /** Les alertes de ses projets (GitHub, Vercel, Expo) ; null s'il n'a relié aucun de ces services. */
  projetsHooks(): AlertesHooks | null {
    const j = jetonsDev(this.uid)
    if (!j.github && !j.vercel && !j.expo) return null
    return {
      halted: () => this.stopped,
      jetons: () => jetonsDev(this.uid),
      notify: (nouveaux) => runAsUser(this.uid, () => this.onEchecsProjets(nouveaux))
    }
  }

  get voiceProvider(): string {
    return this.tts ? this.tts.decrire(this.user.reglages.synthese) : 'aucune (texte seul)'
  }

  welcome(connectionId: string, device: string | null, appareilId: number): ServerPayload {
    if (device) this.devices.set(connectionId, device)
    // Le téléphone s'est reconnecté au milieu d'une réponse : la suite lui revient.
    if (device && this.turn && !this.replyTo && this.replyDevice === device) {
      this.replyTo = connectionId
      if (!this.micOwner) this.micOwner = connectionId
    }
    return {
      type: 'welcome',
      version: 1,
      connectionId,
      utilisateur: userInfo(this.user),
      appareilId,
      state: this.state,
      micOwner: this.micOwner,
      history: recentMessages(this.uid, 20),
      log: recentLog(this.uid, 30),
      pendingConfirm: this.gate.pending,
      speaker: this.speaker.status,
      ecoute: this.ecoute(),
      google: googleStatus(this.uid),
      rappels: this.rappels(),
      push: pushInfo(this.uid),
      taches: currentTaches(this.uid, this.tz),
      echeances: this.echeances()
    }
  }

  /**
   * Demande de validation d'une action sensible. Utilisée par les outils (étape 1) :
   * `execute` ne tourne que si l'utilisateur dit clairement oui.
   */
  requestConfirmation(title: string, summary: string, execute: () => Promise<void> | void): void {
    const req = this.gate.request(title, summary, execute)
    this.io.broadcast({ type: 'confirm.request', ...req })
    this.log('validation', `Validation demandée : ${title}`)
    if (this.state === 'veille') this.setState('attente_validation')
  }

  // ── Messages des clients ──────────────────────────────────────────────

  /** `called` : phrase qui suit un appel exprès (le nom de l'assistant, l'orbe), acceptée sans attendre votre voix. */
  onAudioStart(connectionId: string, overReply = false, called = false): void {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    const call = this.lastCall
    this.lastCall = null
    if (!called && !overReply && call && Date.now() < call.until && call.empty !== false) {
      console.log('[voix] l’appel n’avait rien donné : il vaut pour cette phrase')
      called = true
    }
    if (!called && this.speaker.tracking && (this.turn || overReply)) {
      this.micOwner = connectionId
      this.overReply = true
      this.sens.reset()
      this.voiceTurn = new SpeakerTurn((pcm) => this.speaker.scoreWindow(pcm), undefined, false, () => this.sens.verdict())
      return
    }
    this.overReply = false
    this.stopTurn()
    this.stt?.abort()
    this.stt = null
    this.micOwner = connectionId
    this.utterance = []
    // Avec une empreinte, la transcription n'ouvre qu'à votre voix : ce que disent les autres avant ne part nulle part.
    // Sauf après un appel exprès : dans le bruit, votre voix n'est pas toujours reconnue à temps.
    this.sens.reset()
    this.voiceTurn = this.speaker.tracking ? new SpeakerTurn((pcm) => this.speaker.scoreWindow(pcm), undefined, called, () => this.sens.verdict()) : null
    if (called && this.voiceTurn) console.log('[voix] appel exprès : phrase ouverte sans attendre votre voix')
    if (!this.voiceTurn && !this.openUtteranceStt(connectionId)) return
    this.setState('ecoute')
  }

  /** Ouvre la transcription de la phrase ; en cas d'échec, l'erreur est signalée et CODE revient au repos. */
  private openUtteranceStt(connectionId: string): boolean {
    try {
      const stt: SttStream = openStt(
        this.secrets,
        (text) => {
          if (this.stt !== stt) return
          this.sens.observer(text)
          if (this.state === 'ecoute') this.io.broadcast({ type: 'transcript.partial', text })
        },
        motsClesPour(this.uid, nomAssistant(this.user)),
        this.user.reglages.transcription
      )
      this.stt = stt
      return true
    } catch (err) {
      this.stt = null
      this.voiceTurn = null
      this.error(connectionId, err instanceof SttUnavailable ? 'stt_indisponible' : 'stt', err)
      this.setState(this.idleState())
      return false
    }
  }

  onAudio(connectionId: string, pcm: Buffer): void {
    if (connectionId === this.enroller) return this.onEnrollAudio(pcm)
    if (connectionId !== this.micOwner || (this.state !== 'ecoute' && !this.overReply)) return
    const turn = this.voiceTurn
    if (!turn) {
      this.stt?.write(pcm)
      this.utterance.push(pcm)
      return
    }
    const { release, end } = turn.push(pcm)
    if (this.overReply && turn.started) {
      // Votre voix pendant la réponse : CODE se tait et vous écoute.
      this.overReply = false
      this.stopTurn()
      this.io.send(connectionId, { type: 'audio.barge' })
      this.setState('ecoute')
    }
    if (this.overReply && end) {
      // Jamais votre voix pendant la réponse (son écho, d'autres) : CODE continue, rien n'est noté.
      console.log(`[voix] pendant la réponse, pas votre voix : ${turn.summary()}`)
      this.overReply = false
      this.voiceTurn = null
      this.io.send(connectionId, { type: 'audio.stop', reason: 'autre' })
      return
    }
    if (release.length && !this.stt && !this.openUtteranceStt(connectionId)) return
    for (const part of release) this.stt?.write(part)
    if (end === 'fin') {
      // Votre voix s'est tue : la phrase est finie, même si d'autres parlent encore.
      this.io.send(connectionId, { type: 'audio.stop', reason: 'fin' })
      void this.onAudioEnd(connectionId)
    } else if (end === 'autre') {
      console.log(`[voix] suivi, jamais votre voix : ${turn.summary()}`)
      this.voiceTurn = null
      this.stt?.abort()
      this.stt = null
      this.io.send(connectionId, { type: 'audio.stop', reason: 'autre' })
      this.log('voix', 'D’autres voix que la vôtre : écoute arrêtée')
      this.setState(this.idleState())
    }
  }

  async onAudioEnd(connectionId: string): Promise<void> {
    if (connectionId !== this.micOwner) return
    const turn = this.voiceTurn
    this.voiceTurn = null
    const call: { until: number; empty: boolean | null } | null = turn?.called ? { until: Date.now() + CALL_CARRY_MS, empty: null } : null
    if (call) this.lastCall = call
    if (turn) console.log(`[voix] suivi, ${turn.heard ? 'votre voix' : turn.started ? 'appel exprès' : 'pas encore votre voix'} : ${turn.summary()}`)
    if (this.overReply) {
      // Phrase finie pendant la réponse sans votre voix reconnue (un écho court, un bruit) : ignorée.
      this.overReply = false
      return
    }
    if (turn?.started) {
      // Votre voix a été reconnue pendant la phrase (seuls vos passages ont été transcrits), ou vous avez appelé CODE.
      for (const part of turn.flush()) this.stt?.write(part)
      // Un appel exprès vaut reconnaissance : le « oui » qui suit (trop court pour être jugé) passe.
      this.speaker.markRecognized()
      console.log(turn.heard ? '[voix] reconnu · suivi de la phrase' : '[voix] appel exprès · phrase acceptée sans votre voix')
    } else {
      // Sans suivi, ou phrase trop courte pour lui (« oui ») : jugée d'un bloc.
      const audio = turn ? turn.whole() : Buffer.concat(this.utterance)
      this.utterance = []
      if (!turn && !this.stt) return
      const verdict = this.speaker.verify(audio)
      if (verdict.score !== null || verdict.reason !== 'desactive') {
        console.log(`[voix] ${verdict.reason} · score ${verdict.score === null ? 'trop court' : verdict.score.toFixed(2)}`)
      }
      if (!verdict.accepted) {
        this.stt?.abort()
        this.stt = null
        this.io.broadcast({ type: 'transcript.partial', text: '' })
        this.log('voix', `Voix non reconnue : phrase ignorée${verdict.score === null ? '' : ` (score ${verdict.score.toFixed(2)})`}`)
        this.io.send(connectionId, { type: 'error', code: 'voix_inconnue', message: 'Voix non reconnue : je n’écoute que la vôtre.' })
        return this.setState(this.idleState())
      }
      if (turn) {
        if (!this.openUtteranceStt(connectionId)) return
        this.stt!.write(audio)
      }
    }
    const stt = this.stt
    this.stt = null
    if (!stt) {
      if (call) call.empty = true
      return
    }

    this.setState('reflexion')
    let text: string
    try {
      text = await stt.finish()
    } catch (err) {
      this.error(connectionId, 'stt', err)
      return this.setState(this.idleState())
    }
    if (call) {
      // L'audio d'avant l'appel porte souvent le mot d'activation : ce n'est pas la demande.
      text = sansMotActivation(text, nomAssistant(this.user))
      call.empty = !text
    }
    // « neuf neuf zéro zéro un zéro six » → « 990-0106 » : un numéro dicté chiffre par chiffre.
    text = chiffresDictes(text)
    if (this.stt || this.voiceTurn) return // une nouvelle prise de parole a commencé entre-temps
    if (!text) return this.setState(this.idleState())
    this.io.broadcast({ type: 'transcript.final', text })
    this.log('voix', text)

    // Une réponse pendant une validation : accord ou refus ; une autre demande (« dis-lui plutôt… ») annule et se traite.
    if (this.gate.pending && !this.answerPending(text)) return this.setState(this.idleState())
    await this.runTurn(text, { speak: true, written: false })
  }

  /**
   * Réponse à une validation en attente. Accord ou refus : c'est tout (false). Autre chose : l'action est
   * annulée et la phrase doit être traitée comme une demande (true), pour « change le texte », « tutoie-le ».
   */
  private answerPending(text: string): boolean {
    const kind = this.gate.classify(text)
    this.gate.answerVoice(text)
    return kind === 'autre'
  }

  onAudioCancel(connectionId: string): void {
    if (connectionId !== this.micOwner) return
    this.stt?.abort()
    this.stt = null
    this.voiceTurn = null
    this.overReply = false
    if (this.state === 'ecoute') this.setState(this.idleState())
  }

  /** Message écrit ; `voice: false` (mode chat, endroit bruyant) : réponse à lire, sans voix. */
  async onText(connectionId: string, text: string, voice = true): Promise<void> {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    const clean = text.trim().slice(0, 4000)
    if (!clean) return
    this.stopTurn()
    this.micOwner = connectionId
    this.io.broadcast({ type: 'transcript.final', text: clean })
    this.log('voix', `(écrit) ${clean}`)
    this.lastWritten = !voice
    if (this.gate.pending && !this.answerPending(clean)) return this.setState(this.idleState())
    await this.runTurn(clean, { speak: voice, written: !voice })
  }

  /** Un papier vient d'arriver (`POST /documents`) : l'assistant le lit, le range et note son échéance. */
  async onDocument(connectionId: string, id: number, voice = true): Promise<void> {
    const d = getDocument(this.uid, id)
    if (!d) return this.io.send(connectionId, { type: 'error', code: 'action', message: 'Ce document n’est pas arrivé : renvoyez-le.' })
    await this.onText(connectionId, `Voici un document à lire et à ranger : « ${d.nom} » [document ${d.id}].`, voice)
  }

  onInterrupt(): void {
    if (!this.turn) return
    this.stopTurn()
    this.setState(this.idleState())
  }

  onConfirm(actionId: string, accepted: boolean): void {
    this.markActive()
    if (this.stopped) return
    this.gate.answerButton(actionId, accepted)
  }

  onHalt(): void {
    if (this.stopped) return
    this.stopped = true
    this.stopTurn()
    this.stt?.abort()
    this.stt = null
    this.gate.cancel()
    for (const c of this.taskAborts) c.abort()
    this.endConversation('arrêt d’urgence')
    this.log('systeme', 'Arrêt d’urgence : micro, outils et planificateur coupés')
    this.setState('arret')
  }

  onResume(): void {
    if (!this.stopped) return
    this.stopped = false
    this.log('systeme', 'Reprise après arrêt d’urgence')
    this.setState('veille')
  }

  onDisconnect(connectionId: string): void {
    this.devices.delete(connectionId)
    this.ponts.delete(connectionId)
    // La réponse en cours attend que le même appareil revienne (welcome) plutôt que de se perdre.
    if (connectionId === this.replyTo) this.replyTo = null
    if (connectionId === this.enroller) this.onEnrollCancel(connectionId)
    if (connectionId === this.conversation?.connectionId) this.endConversation('appareil déconnecté (veille, réseau)')
    if (connectionId !== this.micOwner) return
    this.stt?.abort()
    this.stt = null
    this.micOwner = null
    if (this.state === 'ecoute') this.setState(this.idleState())
  }

  // ── Le pont vers le Mac (fichiers) ───────────────────────────────────

  /** L'app Mac annonce qu'elle exécute les outils de fichiers sur place : seulement l'app du Mac elle-même. */
  onPontPret(connectionId: string, outils: unknown): void {
    const device = this.devices.get(connectionId)
    if ((device === 'mac' || device === 'mini') && Array.isArray(outils) && outils.includes('fichiers')) this.ponts.add(connectionId)
  }

  /** Le Mac n'a rien pu faire (réponse par la connexion, pas par HTTP). */
  onPontErreur(connectionId: string, id: unknown, erreur: unknown): void {
    if (typeof id === 'string') erreurDuMac(connectionId, id, typeof erreur === 'string' ? erreur : 'erreur sur le Mac')
  }

  /** La fenêtre principale du Mac d'abord, sinon la miniature. */
  private pontMac(): PontMac | undefined {
    if (this.fichiers()) return undefined
    const ids = [...this.ponts]
    const id = ids.find((c) => this.devices.get(c) === 'mac') ?? ids[0]
    if (!id) return undefined
    return pontVers(id, (payload) => {
      this.io.send(id, payload)
      return this.ponts.has(id)
    })
  }

  /** Les fichiers du Mac : sur place (serveur sur le Mac), ou par le pont tant que l'app Mac est ouverte. */
  private fichiersOk(): boolean {
    return this.fichiers() || this.ponts.size > 0
  }

  // ── Actions dans l'interface (sans Claude) ────────────────────────────

  /** Un clic sur une tuile : parcourir un dossier, afficher un fichier, l'ouvrir sur le Mac. */
  async onUiAction(connectionId: string, action: 'parcourir' | 'afficher' | 'ouvrir_mac' | 'finder', chemin: string, turnId: string): Promise<void> {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    // Les fichiers du Mac ne sont qu'à l'utilisateur dont l'app Mac est reliée.
    if (!this.fichiersOk()) return this.io.send(connectionId, { type: 'error', code: 'action', message: 'Les fichiers du Mac ne sont accessibles que lorsque l’app CODE 2.0 du Mac est ouverte.' })
    const ctx = this.toolContext()
    const id = randomUUID()
    const tool = FILE_TOOLS.find((t) => t.name === (action === 'parcourir' ? 'fichiers_lister' : action === 'afficher' ? 'fichiers_afficher' : 'fichiers_ouvrir'))!
    const input = action === 'parcourir' ? { dossier: chemin } : action === 'finder' ? { chemin, montrer_dans_finder: true } : { chemin }
    const kind = action === 'parcourir' ? 'dossier' : 'document'
    if (action === 'parcourir' || action === 'afficher') {
      this.io.send(connectionId, { type: 'ui.view', view: { id, turnId, kind, title: chemin, status: 'chargement', at: Date.now() } })
    }
    try {
      const result = await tool.run(input, ctx)
      this.log('action', `${result.summary} (interface)`)
      if (action === 'parcourir' || action === 'afficher') {
        this.io.send(connectionId, {
          type: 'ui.view',
          view: {
            id,
            turnId,
            kind: result.view?.kind ?? kind,
            title: chemin,
            status: result.isError || !result.view ? 'erreur' : 'pret',
            ...(result.view ? { data: result.view } : {}),
            ...(result.isError ? { message: String(result.content) } : {}),
            at: Date.now()
          }
        })
      } else if (result.isError) {
        this.io.send(connectionId, { type: 'error', code: 'action', message: String(result.content) })
      }
    } catch (err) {
      this.error(connectionId, 'action', err)
    }
  }

  /** Autre page, onglet ou recherche d'une liste : le même panneau est rechargé, sans le modèle. */
  async onUiPage(connectionId: string, viewId: string, turnId: string, toolName: string, args: Record<string, unknown>): Promise<void> {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    const tool = persoPageable(toolName)
    if (!tool) return this.io.send(connectionId, { type: 'error', code: 'action', message: 'Cette liste n’est plus disponible.' })
    // Seulement des valeurs simples : l'interface ne choisit que la page, le filtre ou la recherche.
    const input: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args ?? {})) if (['string', 'number', 'boolean'].includes(typeof v)) input[k] = v
    const ui = tool.ui!
    this.io.send(connectionId, { type: 'ui.view', view: { id: viewId, turnId, kind: ui.kind, title: ui.title(input), status: 'chargement', at: Date.now() } })
    try {
      const ctx = this.toolContext()
      const invalid = tool.validate(input, ctx)
      if (invalid) return this.io.send(connectionId, { type: 'error', code: 'action', message: invalid })
      const result = await runAsUser(this.uid, () => tool.run(input, ctx))
      this.log('action', `${result.summary} (interface)`)
      this.io.send(connectionId, {
        type: 'ui.view',
        view: {
          id: viewId,
          turnId,
          kind: result.view?.kind ?? ui.kind,
          title: ui.title(input),
          status: result.isError || !result.view ? 'erreur' : 'pret',
          ...(result.view ? { data: result.view } : {}),
          ...(result.isError ? { message: String(result.content) } : {}),
          at: Date.now()
        }
      })
    } catch (err) {
      this.error(connectionId, 'action', err)
    }
  }

  // ── Compte Google (Gmail, Agenda) ──────────────────────────────────────

  /** Commence la connexion à Google (page de consentement) ; l'état suit par `google.status`. */
  async onGoogleConnect(connectionId: string): Promise<void> {
    try {
      await startGoogleConnect(this.uid)
      this.log('systeme', 'Connexion Google : page de consentement ouverte')
    } catch (err) {
      this.error(connectionId, 'google', err)
    }
  }

  /**
   * L'accès Google finit dans moins de 24 h (mode test) : notification et, si un écran est ouvert et CODE au
   * repos, à voix haute. Rédigé sans le modèle ; il entre dans la conversation.
   */
  onGoogleBientot(expireLe: number): void {
    const heure = new Date(expireLe).toLocaleTimeString('fr-FR', { timeZone: this.tz, hour: 'numeric' }).replace(/\s/g, ' ')
    const tu = this.user.reglages.tutoiement
    const texte = tu
      ? `Ton accès Google se coupe demain vers ${heure} : Google le limite à 7 jours tant que ton projet est en mode test. Reconnecte-le dans Réglages, Connecteurs, pour garder tes mails, ton agenda et tes fichiers.`
      : `Votre accès Google se coupe demain vers ${heure} : Google le limite à 7 jours tant que votre projet est en mode test. Reconnectez-le dans Réglages, Connecteurs, pour garder vos mails, votre agenda et vos fichiers.`
    this.log('systeme', 'Accès Google : fin dans moins de 24 h, annoncée')
    void this.notify({ titre: 'Google', corps: tu ? `Ton accès Google se coupe demain vers ${heure}. Reconnecte-le dans Réglages › Connecteurs.` : `Votre accès Google se coupe demain vers ${heure}. Reconnectez-le dans Réglages › Connecteurs.`, tag: 'google-expire', url: '/' })
    const device = this.speakerDevice()
    if (!this.quiet && device && this.state === 'veille' && !this.turn) void this.announce(texte, device, texte)
    else addMessage(this.uid, 'assistant', texte)
  }

  async onGoogleDisconnect(): Promise<void> {
    await disconnectGoogle(this.uid)
    this.log('systeme', 'Google déconnecté')
  }

  /** Rendez-vous du jour et mails importants, pour le cockpit. */
  async onPersoRefresh(connectionId: string): Promise<void> {
    this.io.send(connectionId, { type: 'perso.resume', resume: await persoResume(this.uid, this.tz) })
  }

  /** La carte météo du cockpit : la ville de ses réglages, sans Claude (les prévisions sont gardées 30 minutes). */
  async onMeteoRefresh(connectionId: string): Promise<void> {
    const { ville } = this.user.reglages
    try {
      const meteo = await meteoFor(ville, this.tz)
      this.io.send(connectionId, meteo ? { type: 'meteo', meteo } : { type: 'meteo', meteo: null, erreur: `Ville introuvable : ${ville}.` })
    } catch {
      this.io.send(connectionId, { type: 'meteo', meteo: null, erreur: 'Service météo injoignable.' })
    }
  }

  // ── Présence et point du retour ───────────────────────────────────────

  private markActive(now = Date.now()): void {
    this.lastActive = now
    if (now - this.lastActiveSaved < 60_000) return
    this.lastActiveSaved = now
    setState(this.uid, 'derniere_presence', String(now))
  }

  /**
   * Un écran signale que l'utilisateur est là (Mac réveillé ou utilisé, téléphone ouvert).
   * Après une longue absence, CODE fait le point de ce qui le concerne depuis son départ.
   */
  async onPresence(connectionId: string, voice: boolean): Promise<void> {
    const now = Date.now()
    const since = this.lastActive
    this.markActive(now)
    const { reglages } = this.user
    if (now - since < reglages.retourApresMinutes * 60_000) return
    if (this.stopped || this.quiet || this.state !== 'veille' || this.turn || this.gate.pending) return
    const tz = reglages.fuseau
    // Le matin, le briefing du jour s'en charge.
    if (briefingDue(now, tz, process.env.CODE_BRIEFING_AT || reglages.briefing, getState(this.uid, 'briefing_matin'))) return
    // Les faits et, en même temps, les panneaux qui les montreront (les mêmes lectures que les cartes de l'accueil).
    const [perso, vues] = await Promise.all([persoResume(this.uid, tz, now).catch(() => null), this.vuesRetour()])
    if (this.turn || this.state !== 'veille') return
    const clock = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
    const sameDay = localDay(since, tz) === localDay(now, tz)
    const [h, m] = clock(now).split(':').map(Number)
    const faits: RetourFacts = {
      depuis: sameDay ? clock(since) : `le ${new Date(since).toLocaleDateString('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric' })} à ${clock(since)}`,
      absence: absenceText(now - since),
      rappels: this.rappels(),
      taches: finishedSince(this.uid, since).map((execution) => ({ execution, tache: getTache(this.uid, execution.tacheId) })),
      enAttente: this.gate.pending,
      perso,
      maintenant: (h ?? 0) * 60 + (m ?? 0)
    }
    // Seuls les panneaux qui ont quelque chose à montrer, et que leur lecture a bien rendus.
    const SUJETS: Record<PanneauRetour, string> = { rappels: 'les rappels', taches: 'les tâches planifiées', mails: 'les mails', agenda: 'les rendez-vous' }
    const prets = panneauxRetour(faits).flatMap((k) => (vues[k] ? [{ k, ...vues[k]! }] : []))
    const prompt = retourPrompt(faits, appellationOf(this.user), prets.map((p) => ({ marque: PANNEAUX_RETOUR[p.k], sujet: SUJETS[p.k] })))
    this.micOwner = connectionId
    this.lastWritten = !voice
    this.log('systeme', `Retour après ${absenceText(now - since)} : point de la situation`)
    await this.runTurn(prompt, { speak: voice, written: !voice, usage: 'retour', vues: prets.map((p) => ({ nom: PANNEAUX_RETOUR[p.k], titre: p.titre, data: p.data })) })
  }

  /**
   * Les panneaux du point du retour, lus directement (sans le modèle) : rappels, tâches, mails, agenda. Une
   * lecture qui échoue ou traîne (Google) laisse simplement son panneau de côté.
   */
  private async vuesRetour(): Promise<Partial<Record<PanneauRetour, { titre: string; data: UiData }>>> {
    const mails = listBoites(this.uid).length ? 'mails_importants' : 'gmail_importants'
    const outils: Record<PanneauRetour, string> = { rappels: 'rappels_lister', taches: 'taches_lister', mails, agenda: 'agenda_evenements' }
    const ctx = this.toolContext()
    const lire = async (nom: string) => {
      const tool = persoPageable(nom)
      if (!tool?.ui) return null
      const r = await Promise.race([runAsUser(this.uid, () => tool.run({}, ctx)), new Promise<null>((ok) => setTimeout(() => ok(null), 6000))])
      return r && !r.isError && r.view ? { titre: tool.ui.title({}), data: r.view } : null
    }
    const cles = Object.keys(outils) as PanneauRetour[]
    const lus = await Promise.all(cles.map((k) => lire(outils[k]).catch(() => null)))
    return Object.fromEntries(cles.flatMap((k, i) => (lus[i] ? [[k, lus[i]]] : [])))
  }

  // ── Rappels et briefing ───────────────────────────────────────────────

  /** L'écran qui parle pour CODE hors conversation : l'app du Mac d'abord, sinon la miniature, sinon le téléphone. */
  private speakerDevice(): string | null {
    for (const kind of ['mac', 'mini', 'mobile']) {
      for (const [id, device] of this.devices) if (device === kind) return id
    }
    return null
  }

  /** Un rappel sonne : affiché partout, dit à voix haute si CODE n'est pas déjà en train de parler ou d'écouter. */
  onReminderFire(fired: Rappel[]): void {
    const now = Date.now()
    const tz = this.tz
    for (const r of fired) {
      const ui = toUiRappel(r, now, tz)
      this.io.broadcast({ type: 'reminder.fire', rappel: ui })
      this.log('systeme', `Rappel${r.retard ? ' (en retard)' : ''} : ${r.texte}`)
      // Sur le téléphone aussi, même app fermée (sauf heures de silence : l'écran seulement).
      void this.notify(reminderMessage(ui))
    }
    if (this.state !== 'veille' || this.turn || this.quiet) return
    // Une phrase, pas une étiquette ; « bonjour » seulement si la personne n'a pas parlé à CODE depuis une demi-heure.
    const hour = Number(new Date(now).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }))
    const text = reminderSpeech(fired, spokenNameOf(this.user), hour, now - this.lastActive > 30 * 60_000, this.user.reglages.tutoiement)
    void this.announce(text, this.speakerDevice())
  }

  /**
   * Un échec dans ses projets : notification et, si un écran est ouvert et CODE au repos, à voix haute. Rédigé
   * sans Claude ; il entre dans la conversation pour « explique-moi ». Heures de silence : seule la production
   * d'un site en échec passe, et seulement en notification.
   */
  private onEchecsProjets(nouveaux: EchecProjet[]): void {
    this.log('systeme', `Projets en échec : ${nouveaux.map((e) => `${e.projet} (${e.quoi})`).join(' ; ')}`)
    const dits = this.quiet ? nouveaux.filter((e) => e.grave) : nouveaux
    if (dits.length) void this.notify(projetsMessage(dits), {}, true)
    const device = this.speakerDevice()
    if (!this.quiet && device && this.state === 'veille' && !this.turn) void this.announce(projetsSpoken(nouveaux), device, projetsHistory(nouveaux))
    else addMessage(this.uid, 'assistant', projetsHistory(nouveaux))
  }

  /** « Fait » ou « dans 10 min » depuis la miniature ou le cockpit, sans passer par Claude. */
  onReminderAction(connectionId: string, id: number, action: 'fait' | 'reporter', minutes = 10): void {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    const r = action === 'fait' ? markDone(this.uid, id, Date.now()) : snooze(this.uid, id, Date.now() + Math.max(1, Math.min(24 * 60, Math.floor(minutes))) * 60_000)
    if (!r) return this.io.send(connectionId, { type: 'error', code: 'action', message: 'Ce rappel n’existe plus.' })
    this.log('action', action === 'fait' ? `Rappel fait : ${r.texte}` : `Rappel reporté de ${minutes} min : ${r.texte}`)
  }

  /** « Réglée » touché sur une carte : l'échéance passe dans l'historique, ses écrans suivent. */
  onEcheanceReglee(connectionId: string, id: number): void {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    const r = reglerEcheance(this.uid, id, Date.now(), this.tz)
    if (!r) return this.io.send(connectionId, { type: 'error', code: 'action', message: 'Cette échéance est déjà réglée ou n’existe plus.' })
    this.log('action', `Échéance réglée : « ${r.reglee.titre} »${r.suivante ? ` ; la suivante le ${r.suivante.date}` : ''}`)
  }

  /** Un élément coché ou décoché d'un toucher : tous ceux qui voient la liste la voient changer. */
  onListeCocher(connectionId: string, listeId: number, elementId: number, coche: boolean): void {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    const faits = cocherElements(this.uid, listeId, [elementId], coche)
    if (!faits) return this.io.send(connectionId, { type: 'error', code: 'action', message: 'Cette liste n’existe plus.' })
    const e = faits[0]
    if (e) this.log('action', `Liste « ${getListe(this.uid, listeId)?.nom ?? listeId} » : ${coche ? 'coché' : 'décoché'} ${e.texte}`)
  }

  /** Un toucher sur un appareil de la maison : allumé ou éteint, sans passer par l'assistant (jamais une action sensible). */
  async onMaisonBasculer(connectionId: string, entite: string): Promise<void> {
    this.markActive()
    if (this.refuseWhenHalted(connectionId) || !entite) return
    const m = maisonDe(this.uid)
    if (!m) return this.io.send(connectionId, { type: 'maison.appareil', entite, erreur: 'Home Assistant n’est pas joignable : voyez Réglages › Connecteurs.' })
    try {
      const appareil = await m.basculer(entite)
      this.log('action', `${m.libelle} : ${appareil.nom} ${appareil.etat}`)
      this.io.broadcast({ type: 'maison.appareil', entite, appareil })
    } catch (err) {
      this.io.send(connectionId, { type: 'maison.appareil', entite, erreur: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Reprendre l'image d'une caméra affichée : seulement pour l'écran qui la demande, rien n'est gardé. */
  async onMaisonCamera(connectionId: string, entite: string): Promise<void> {
    this.markActive()
    if (!entite.startsWith('camera.')) return
    const m = maisonDe(this.uid)
    if (!m) return this.io.send(connectionId, { type: 'maison.camera', vue: { kind: 'camera', id: entite, nom: entite, heure: '', erreur: 'Home Assistant n’est pas joignable.' } })
    this.io.send(connectionId, { type: 'maison.camera', vue: await m.camera(entite) })
  }

  /** Briefing du matin : un tour de CODE qui consulte l'agenda, les mails et les rappels, puis résume à voix haute. */
  startBriefing(): boolean {
    const device = this.speakerDevice()
    if (!device || this.state !== 'veille' || this.turn || this.gate.pending) return false
    // Déjà reçu par écrit sur le téléphone : la version parlée attend le Mac.
    if (this.devices.get(device) === 'mobile' && getState(this.uid, 'briefing_push') === localDay(Date.now(), this.tz)) return false
    this.micOwner = device
    this.lastWritten = false
    this.log('systeme', 'Briefing du matin')
    void this.runTurn(BRIEFING_PROMPT(appellationOf(this.user), PROFIL_DETAILS[this.user.reglages.profil]?.briefing), { speak: true, written: false, usage: 'briefing' })
    return true
  }

  /** Aucun écran ouvert à l'heure du briefing : sa version écrite part sur le téléphone, une fois par jour. */
  async pushBriefing(): Promise<void> {
    const now = Date.now()
    const tz = this.tz
    const today = localDay(now, tz)
    if (this.speakerDevice() || getState(this.uid, 'briefing_push') === today || pushInfo(this.uid).abonnes === 0) return
    setState(this.uid, 'briefing_push', today)
    const resume = await persoResume(this.uid, tz, now).catch(() => null)
    const sent = await this.notify(briefingMessage(resume, this.rappels(), appellationOf(this.user)), { ttl: 4 * 3600 })
    if (sent) this.log('systeme', 'Briefing du matin envoyé sur le téléphone')
  }

  // ── Tâches planifiées ─────────────────────────────────────────────────

  private runningTasks = new Set<number>()
  private taskAborts = new Set<AbortController>()

  /** Lance une tâche en arrière-plan, à côté de la conversation. `false` si elle tourne déjà ou si CODE est à l'arrêt. */
  runTask(t: Tache, retard: boolean): boolean {
    if (this.stopped || this.runningTasks.has(t.id)) return false
    this.runningTasks.add(t.id)
    const execId = startExecution(this.uid, t.id, Date.now(), retard)
    this.log('systeme', `Tâche lancée : « ${t.titre} »${retard ? ' (en retard)' : ''}`)
    void runAsUser(this.uid, () => this.executeTask(t, execId)).finally(() => this.runningTasks.delete(t.id))
    return true
  }

  /** Un tour de Claude sans historique ni écran : lecture et préparation seulement, résultat écrit gardé et notifié. */
  private async executeTask(t: Tache, execId: number): Promise<void> {
    const controller = new AbortController()
    this.taskAborts.add(controller)
    const timer = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS)
    const ctx: ToolContext = {
      user: this.user,
      fichiers: this.fichiersOk(),
      pont: this.pontMac(),
      requestConfirmation: () => {
        throw new Error('Aucune action sensible dans une tâche planifiée.')
      },
      announce: () => {},
      log: (summary) => this.log('action', `${summary} (tâche)`),
      unattended: true
    }
    const url = `/#resultat=${execId}`
    let text = ''
    try {
      for await (const ev of this.brain.reply([], `Consigne de la tâche « ${t.titre} » :\n${t.consigne}`, controller.signal, ctx, { task: true, usage: 'tache' })) {
        if (ev.type === 'text') text += ev.text
        else if (ev.type === 'tool') this.log('action', `${ev.summary} (tâche « ${t.titre} »)`)
      }
      const { resume, texte } = splitResult(text)
      if (!texte) throw new Error('Claude n’a rien produit.')
      finishExecution(this.uid, execId, 'ok', resume, texte)
      this.log('systeme', `Tâche terminée : « ${t.titre} »`)
      void this.notify({ titre: t.titre, corps: resume, tag: `tache-${t.id}`, url }, { ttl: 12 * 3600, urgency: 'normal' })
    } catch (err) {
      const message = isAbort(err) ? (this.stopped ? 'Arrêtée par l’arrêt d’urgence.' : 'Trop longue : arrêtée après cinq minutes.') : describeBrainError(err)
      finishExecution(this.uid, execId, 'erreur', message, text.trim())
      this.log('systeme', `Tâche en échec : « ${t.titre} » — ${message}`)
      void this.notify({ titre: `${t.titre} · échec`, corps: message, tag: `tache-${t.id}`, url }, { ttl: 12 * 3600, urgency: 'normal' })
    } finally {
      clearTimeout(timer)
      this.taskAborts.delete(controller)
    }
  }

  /** « Lancer maintenant », « Pause », « Reprendre » depuis la vue des tâches, sans passer par Claude. */
  onTaskAction(connectionId: string, id: number, action: 'executer' | 'pause' | 'reprendre'): void {
    this.markActive()
    if (this.refuseWhenHalted(connectionId)) return
    const t = getTache(this.uid, id)
    if (!t) return this.io.send(connectionId, { type: 'error', code: 'action', message: 'Cette tâche n’existe plus.' })
    if (action === 'executer') {
      if (!this.runTask(t, false)) this.io.send(connectionId, { type: 'error', code: 'action', message: `« ${t.titre} » est déjà en cours.` })
      return
    }
    updateTache(this.uid, id, { etat: action === 'pause' ? 'pause' : 'active' }, Date.now(), this.tz)
    this.log('action', `Tâche ${action === 'pause' ? 'en pause' : 'reprise'} : « ${t.titre} »`)
  }

  // ── Notifications du téléphone ────────────────────────────────────────

  /** Abonnement du téléphone : enregistré, puis une première notification pour vérifier que tout passe. */
  async onPushSubscribe(connectionId: string, raw: unknown): Promise<void> {
    const res = subscribe(this.uid, raw)
    if ('erreur' in res) return this.io.send(connectionId, { type: 'push.status', info: pushInfo(this.uid), ok: false, message: res.erreur })
    if (!res.nouveau) return this.io.send(connectionId, { type: 'push.status', info: pushInfo(this.uid), ok: true })
    const ok = await notifyOne(this.uid, res.sub, { titre: 'Notifications activées', corps: 'Vos rappels arriveront ici, même quand CODE 2.0 est fermé.', tag: 'bienvenue', url: '/' })
    this.log('systeme', ok ? 'Notifications activées sur le téléphone' : 'Notifications : le service du téléphone a refusé l’envoi')
    if (!ok) unsubscribe(this.uid, res.sub.endpoint)
    this.io.send(connectionId, {
      type: 'push.status',
      info: pushInfo(this.uid),
      ok,
      message: ok ? 'Notifications activées.' : 'Le service de notification du téléphone a refusé l’envoi. Réessayez dans un instant.'
    })
    this.io.broadcast({ type: 'push.status', info: pushInfo(this.uid) })
  }

  async onPushTest(connectionId: string): Promise<void> {
    const sent = await notifyAll(this.uid, { titre: 'Essai', corps: `Les notifications de ${nomAssistant(this.user)} arrivent bien sur ce téléphone.`, tag: 'essai', url: '/' }, { ttl: 300 })
    this.io.send(connectionId, {
      type: 'push.status',
      info: pushInfo(this.uid),
      ok: sent > 0,
      message: sent > 0 ? 'Notification d’essai envoyée.' : 'Aucun téléphone n’a pu être prévenu : réactivez les notifications.'
    })
  }

  onPushUnsubscribe(endpoint: string): void {
    unsubscribe(this.uid, endpoint)
    this.log('systeme', 'Notifications désactivées sur le téléphone')
    this.io.broadcast({ type: 'push.status', info: pushInfo(this.uid) })
  }

  // ── Empreinte vocale ──────────────────────────────────────────────────

  onEnrollStart(connectionId: string): void {
    if (this.refuseWhenHalted(connectionId)) return
    this.stopTurn()
    try {
      // Le Mac (app ou miniature) n'a qu'une empreinte ; le téléphone la sienne.
      const device = this.devices.get(connectionId)
      this.speaker.startEnrollment(device === 'mini' || device === 'mac' ? 'mac' : device ?? 'mobile')
    } catch (err) {
      return this.error(connectionId, 'voix', err)
    }
    this.enroller = connectionId
    this.io.send(connectionId, { type: 'enroll.progress', percentage: 0 })
  }

  private onEnrollAudio(pcm: Buffer): void {
    if (!this.enroller) return
    try {
      const percentage = this.speaker.enroll(pcm)
      this.io.send(this.enroller, { type: 'enroll.progress', percentage: Math.round(percentage) })
    } catch (err) {
      const who = this.enroller
      this.enroller = null
      this.speaker.cancelEnrollment()
      this.error(who, 'voix', err)
    }
  }

  onEnrollEnd(connectionId: string): void {
    if (connectionId !== this.enroller) return
    this.enroller = null
    try {
      const { ok, percentage } = this.speaker.finishEnrollment()
      console.log(`[voix] empreinte (${this.devices.get(connectionId) ?? '?'}) : ${ok ? 'enregistrée' : `pas assez de voix (${Math.round(percentage)} %)`} · appareils : ${this.speaker.status.appareils.join(', ') || 'aucun'}`)
      this.io.send(connectionId, {
        type: 'enroll.done',
        ok,
        message: ok ? 'Votre voix est enregistrée. Je n’écoute plus que vous.' : `Pas assez de voix (${Math.round(percentage)} %). Recommencez en parlant un peu plus longtemps.`
      })
      if (ok) this.log('systeme', 'Empreinte vocale enregistrée')
    } catch (err) {
      this.error(connectionId, 'voix', err)
    }
    this.io.broadcast({ type: 'speaker.status', status: this.speaker.status })
  }

  onEnrollCancel(connectionId: string): void {
    if (connectionId !== this.enroller) return
    this.enroller = null
    this.speaker.cancelEnrollment()
  }

  onSpeakerReset(): void {
    this.speaker.reset()
    this.endConversation('empreinte vocale effacée')
    this.log('systeme', `Empreinte vocale effacée : ${nomAssistant(this.user)} écoute tout le monde`)
    this.io.broadcast({ type: 'speaker.status', status: this.speaker.status })
  }

  // ── Mode conversation ─────────────────────────────────────────────────

  /** La relance après chaque réponse, et le mode conversation en cours (à qui il appartient). */
  ecoute(): Ecoute {
    const c = this.conversation
    const { relanceMs, conversationSilenceMs: silenceMs } = codeConfig.voice.ecoute
    return { relanceMs, conversation: c ? { connectionId: c.connectionId, appareil: (this.devices.get(c.connectionId) as DeviceKind | undefined) ?? null, silenceMs } : null }
  }

  /**
   * Active le mode conversation sur cette connexion (il quitte l'appareil qui l'avait), ou le coupe, d'où qu'il
   * soit. Refusé sans empreinte vocale : CODE répondrait à toutes les voix de la pièce, et tout ce qui s'y dit
   * serait transcrit. `message` : ce qui s'est passé, pour l'outil vocal et l'écran.
   */
  setConversation(connectionId: string | null, active: boolean): { ok: boolean; message: string } {
    this.markActive()
    if (!active) {
      if (!this.conversation) return { ok: true, message: 'Le mode conversation n’était pas actif.' }
      this.endConversation('à votre demande')
      return { ok: true, message: 'Mode conversation coupé : il faut de nouveau m’appeler.' }
    }
    if (this.stopped) return { ok: false, message: `${nomAssistant(this.user)} est à l’arrêt : reprenez-le d’abord.` }
    if (this.enReunion) {
      const message = 'Pas de mode conversation pendant l’enregistrement d’une réunion : je répondrais à tout ce qui se dit. Touchez l’orbe pour me parler.'
      if (connectionId) this.io.send(connectionId, { type: 'error', code: 'action', message })
      return { ok: false, message }
    }
    const device = connectionId ? this.devices.get(connectionId) : undefined
    if (!connectionId || !device) return { ok: false, message: 'Le mode conversation se règle depuis l’ordinateur ou le téléphone.' }
    if (!this.speaker.tracking) {
      const message = this.speaker.status.available
        ? 'Le mode conversation demande votre empreinte vocale, sinon je répondrais à toutes les voix de la pièce : enregistrez-la dans Réglages, « Votre voix ».'
        : 'Le mode conversation demande la reconnaissance de votre voix, indisponible sur le serveur (modèle absent).'
      this.io.send(connectionId, { type: 'error', code: 'conversation_empreinte', message })
      this.log('voix', 'Mode conversation refusé : pas d’empreinte vocale')
      return { ok: false, message }
    }
    clearTimeout(this.conversation?.timer)
    this.conversation = { connectionId }
    this.armConversation()
    const minutes = Math.round(codeConfig.voice.ecoute.conversationSilenceMs / 60_000)
    this.log('voix', `Mode conversation activé (${device}) : coupé après ${minutes} min sans votre voix`)
    this.io.broadcast({ type: 'ecoute', ecoute: this.ecoute() })
    return { ok: true, message: `Mode conversation activé : je vous écoute sans que vous ayez à m’appeler, jusqu’à ${minutes} minutes de silence.` }
  }

  /** Relance le compte du long silence ; à son terme, CODE occupé (réponse, tâche) attend la fin pour compter. */
  private armConversation(): void {
    const c = this.conversation
    if (!c) return
    clearTimeout(c.timer)
    c.timer = setTimeout(() => {
      if (this.conversation !== c) return
      if (this.state !== 'veille' && this.state !== 'ecoute') return this.armConversation()
      this.endConversation(`${Math.round(codeConfig.voice.ecoute.conversationSilenceMs / 60_000)} min sans votre voix`)
    }, codeConfig.voice.ecoute.conversationSilenceMs)
  }

  private endConversation(raison: string): void {
    const c = this.conversation
    if (!c) return
    clearTimeout(c.timer)
    this.conversation = null
    this.log('voix', `Mode conversation coupé : ${raison}`)
    this.io.broadcast({ type: 'ecoute', ecoute: this.ecoute() })
  }

  // ── Moteurs ───────────────────────────────────────────────────────────

  /** Réglages › Moteurs : ce que l'installation offre (Ollama, SearXNG) et les bancs d'essai déjà faits. */
  async moteursPayload(): Promise<ServerPayload> {
    const ollama = codeConfig.brain.compat.ollama
    const ollamaContexte = ollama ? await contexteOllama(ollama) : null
    return { type: 'moteurs', etat: { ollama: !!ollama, ...(ollamaContexte ? { ollamaContexte } : {}), searxng: !!codeConfig.brain.web.searxng, bancs: listBancs() } }
  }

  /** Les modèles d'un fournisseur, lus avec sa clé ; sans clé ou en erreur, le message à afficher. */
  async modelesPayload(fournisseur: FournisseurId): Promise<ServerPayload> {
    try {
      return { type: 'moteurs.modeles', fournisseur, modeles: await this.brain.moteur(fournisseur).modeles() }
    } catch (err) {
      return { type: 'moteurs.modeles', fournisseur, modeles: [], erreur: describeBrainError(err) }
    }
  }

  private banc: AbortController | null = null

  /** Lance le banc d'essai d'un moteur (un à la fois) ; renvoie pourquoi il ne part pas, ou null. */
  lancerBanc(choix: ChoixMoteur): string | null {
    if (this.banc) return 'Un banc d’essai est déjà en cours.'
    try {
      this.brain.moteur(choix.fournisseur)
    } catch (err) {
      return describeBrainError(err)
    }
    const ctl = new AbortController()
    this.banc = ctl
    const brain = this.brain
    void runAsUser(this.uid, () => lancerBanc(brain, this.user, choix, (r) => this.io.broadcast({ type: 'banc', resultat: r }), ctl.signal))
      .then((r) => {
        this.io.broadcast({ type: 'banc', resultat: r })
        this.log('systeme', `Banc d’essai ${choix.fournisseur} ${choix.modele} : ${{ teste: 'testé', limite: 'limité', echec: 'échec', en_cours: 'en cours' }[r.etat]}`)
      })
      .catch((err) => this.error(null, 'banc', err))
      .finally(() => {
        if (this.banc === ctl) this.banc = null
        void this.moteursPayload().then((m) => this.io.broadcast(m))
      })
    return null
  }

  // ── Réglages et assistant de premier lancement ────────────────────────

  /** Ses réglages, les voix proposées et la synthèse disponible : à un appareil, ou à tous après un changement. */
  reglagesPayload(): ServerPayload {
    return {
      type: 'reglages',
      utilisateur: userInfo(this.user),
      voix: [...this.voixCompte, ...codeConfig.voice.tts.choix.map(({ id, nom, description }) => ({ id, nom, description, source: 'base' as const }))],
      synthese: this.tts !== null,
      elevenlabs: Boolean(this.secrets.ELEVENLABS_API_KEY)
    }
  }

  /** Relit les voix de son compte ElevenLabs (sans clé : aucune), puis prévient ses écrans. */
  private async chargerVoixCompte(frais = false): Promise<void> {
    const cle = this.secrets.ELEVENLABS_API_KEY
    const avant = JSON.stringify(this.voixCompte)
    try {
      this.voixCompte = cle ? await voixDuCompte(cle, frais) : []
    } catch (err) {
      console.warn(`[session ${this.uid}] voix ElevenLabs :`, err instanceof Error ? err.message : err)
      return
    }
    if (JSON.stringify(this.voixCompte) !== avant) this.io.broadcast(this.reglagesPayload())
  }

  /** Une page de la bibliothèque ElevenLabs (voix françaises), avec sa clé à lui. */
  async onVoixBibliotheque(connectionId: string, filtres: VoixRecherche): Promise<void> {
    const cle = this.secrets.ELEVENLABS_API_KEY
    if (!cle) return this.io.send(connectionId, { type: 'voix.bibliotheque', filtres, voix: [], suite: false, erreur: 'Ajoutez d’abord une clé ElevenLabs dans Réglages › Clés API.' })
    try {
      const page = await bibliotheque(cle, filtres)
      this.io.send(connectionId, { type: 'voix.bibliotheque', filtres, ...page })
    } catch (err) {
      this.io.send(connectionId, { type: 'voix.bibliotheque', filtres, voix: [], suite: false, erreur: err instanceof Error ? err.message : 'Bibliothèque ElevenLabs indisponible.' })
    }
  }

  /** Ajoute une voix de la bibliothèque à son compte ElevenLabs, puis la choisit. */
  async onVoixAjouter(connectionId: string, auteur: string, id: string, nom: string): Promise<void> {
    const cle = this.secrets.ELEVENLABS_API_KEY
    if (!cle) return this.io.send(connectionId, { type: 'voix.ajoutee', id, nom, erreur: 'Ajoutez d’abord une clé ElevenLabs dans Réglages › Clés API.' })
    try {
      const voix = await ajouterVoix(cle, auteur, id, nom)
      await this.chargerVoixCompte(true)
      if (!this.voixCompte.some((v) => v.id === voix)) this.voixCompte = [...this.voixCompte, { id: voix, nom, description: 'Voix de votre compte ElevenLabs.', source: 'compte' }]
      updateReglages(this.uid, { voix })
      this.log('systeme', `Voix ElevenLabs ajoutée et choisie : ${nom}`)
      this.io.broadcast(this.reglagesPayload())
      this.io.send(connectionId, { type: 'voix.ajoutee', id: voix, nom })
    } catch (err) {
      this.io.send(connectionId, { type: 'voix.ajoutee', id, nom, erreur: err instanceof Error ? err.message : 'ElevenLabs n’a pas ajouté la voix.' })
    }
  }

  /** Changement de réglages : validé champ par champ, puis appliqué partout (thème, voix, habitudes). */
  onReglagesSet(connectionId: string, raw: unknown): void {
    const res = validateReglages(raw, this.user.reglages, this.voixCompte.map((v) => v.id))
    if ('erreurs' in res) return this.io.send(connectionId, { type: 'reglages.erreur', erreurs: res.erreurs })
    const before = this.user.reglages
    updateReglages(this.uid, res.ok)
    const changed = (Object.keys(res.ok) as (keyof Reglages)[]).filter((k) => JSON.stringify(res.ok[k]) !== JSON.stringify(before[k]))
    if (changed.length) this.log('systeme', `Réglages modifiés : ${changed.join(', ')}`)
    this.io.broadcast(this.reglagesPayload())
  }

  /** Coupure de l'extrait précédent quand on en demande un autre (on passe d'une voix à l'autre). */
  private sampleAbort: AbortController | null = null
  /** Extraits déjà synthétisés (voix, vitesse, texte) : réécouter ne coûte rien. */
  private readonly samples = new Map<string, Buffer[]>()

  /** Court extrait d'une voix, à cette vitesse, pour cet appareil seulement (sans changer l'état de CODE). */
  async onVoiceSample(connectionId: string, voix: string, vitesse: number): Promise<void> {
    const check = validateReglages({ voix, vitesseVoix: vitesse }, this.user.reglages, this.voixCompte.map((v) => v.id))
    if ('erreurs' in check) return this.io.send(connectionId, { type: 'reglages.erreur', erreurs: check.erreurs })
    if (!this.tts) return this.io.send(connectionId, { type: 'error', code: 'voix', message: `Aucune voix sur le serveur : ${nomAssistant(this.user)} répond par écrit.` })
    this.sampleAbort?.abort()
    const abort = new AbortController()
    this.sampleAbort = abort
    const u = this.user
    const text = sampleSpeech(spokenNameOf(u), u.reglages.tutoiement, nomAssistant(u))
    const synthese = u.reglages.synthese
    const key = `${synthese}|${u.reglages.qualiteVoix}|${check.ok.voix}|${check.ok.vitesseVoix}|${text}`
    const turnId = `echantillon-${randomUUID()}`
    let seq = 0
    const send = (pcm: Buffer) => {
      this.io.send(connectionId, { type: 'reply.audio', turnId, seq: seq++, levels: levels(pcm, VOICE_SAMPLE_RATE) })
      this.io.sendBinary(connectionId, pcm)
    }
    try {
      const cached = this.samples.get(key)
      if (cached) cached.forEach(send)
      else {
        const parts: Buffer[] = []
        for await (const pcm of this.tts.synthesize(text, abort.signal, { voix: check.ok.voix, vitesse: check.ok.vitesseVoix, qualite: u.reglages.qualiteVoix, synthese })) {
          if (abort.signal.aborted) break
          parts.push(pcm)
          send(pcm)
        }
        if (!abort.signal.aborted) {
          if (this.samples.size >= 16) this.samples.delete(this.samples.keys().next().value!)
          this.samples.set(key, parts)
        }
      }
    } catch (err) {
      if (!isAbort(err) && !abort.signal.aborted) this.error(connectionId, 'voix', err)
    }
    this.io.send(connectionId, { type: 'reply.end', turnId, interrupted: abort.signal.aborted })
  }

  /**
   * Fin de l'assistant (ou « passer ») : il ne s'affichera plus, sur aucun de ses appareils. Avec
   * `presentation`, CODE se présente en une phrase, à voix haute sur cet appareil, avec sa voix.
   */
  async onAssistantFini(connectionId: string, presentation: boolean): Promise<void> {
    const first = !this.user.configure
    finishAssistant(this.uid)
    if (first) this.log('systeme', presentation ? 'Assistant de premier lancement terminé' : 'Assistant de premier lancement passé')
    this.io.broadcast(this.reglagesPayload())
    if (!presentation || this.turn) return
    const u = this.user
    const hour = Number(new Date().toLocaleTimeString('fr-FR', { timeZone: u.reglages.fuseau, hour: '2-digit', hourCycle: 'h23' }))
    this.lastWritten = false
    await this.announce(presentationSpeech(spokenNameOf(u), u.reglages.tutoiement, u.reglages.briefing, hour, nomAssistant(u)), connectionId)
  }

  // ── Un tour de conversation ───────────────────────────────────────────

  private runTurn(userText: string, opts: TurnOptions = { speak: true, written: false }): Promise<void> {
    // Tout le tour (outils Google compris) tourne pour cet utilisateur.
    return runAsUser(this.uid, () => this.turnFor(userText, opts))
  }

  private async turnFor(userText: string, opts: TurnOptions): Promise<void> {
    if (!opts.written) this.lastWritten = false
    const turn: RunningTurn = { id: randomUUID(), abort: new AbortController() }
    this.turn = turn
    const { signal } = turn.abort
    const owner = this.micOwner
    this.replyTo = owner
    this.replyDevice = owner ? (this.devices.get(owner) ?? null) : null
    const history = recentMessages(this.uid, codeConfig.brain.historyLimit)
    addMessage(this.uid, 'user', userText)
    this.setState('reflexion')

    /** `outils` : la phrase vient après un résultat d'outil (elle peut en commenter un). */
    const sentences = new AsyncQueue<{ texte: string; outils: boolean }>()
    let reply = ''
    /** Ce que les outils ont rapporté, gardé dans l'historique comme preuve de ce que CODE a consulté. */
    const evidence: string[] = []
    let failed = false
    let audioEndsAt = 0
    // Les panneaux du tour précédent encore en attente apparaissent avant ceux de celui-ci.
    this.panels?.showAll()
    const panels = new TurnPanels((view) => this.io.broadcast({ type: 'ui.view', view }))
    this.panels = panels
    // Panneaux déjà prêts (point du retour) : cachés jusqu'à leur marque, comme ceux des outils.
    for (const [i, v] of (opts.vues ?? []).entries()) panels.update(v.nom, { id: `${turn.id}-v${i}`, turnId: turn.id, kind: v.data.kind, title: v.titre, status: 'pret', data: v.data, at: Date.now() })
    /** Réponse écrite : le moment où la lecture arrive au bout des phrases déjà reçues. */
    let readUntil = 0
    const stripper = new MarkStripper()
    let afterTools = false

    const think = (async () => {
      const chunker = new SentenceChunker()
      try {
        const ctx = this.toolContext()
        for await (const ev of this.brain.reply(history, userText, signal, ctx, { written: opts.written, usage: opts.usage ?? 'conversation' })) {
          if (ev.type === 'tool-start') {
            // « Je regarde ça. » se dit pendant que les outils travaillent, sans attendre la suite du texte.
            for (const s of chunker.flush()) sentences.push({ texte: s, outils: afterTools })
            const ui = toolUi(ev.name, ev.input, ctx)
            if (ui) panels.update(ev.name, { id: ev.id, turnId: turn.id, ...ui, status: 'chargement', at: Date.now() })
            continue
          }
          if (ev.type === 'tool') {
            afterTools = true
            this.log('action', ev.summary)
            evidence.push(ev.summary)
            // Les outils web (exécutés par Anthropic) n'ont pas de panneau déclaré : leur vue suffit.
            const ui = toolUi(ev.name, {}, ctx) ?? (ev.view ? { kind: ev.view.kind, title: ev.summary } : null)
            if (ui) {
              panels.update(ev.name, {
                id: ev.id,
                turnId: turn.id,
                kind: ev.view?.kind ?? ui.kind,
                title: ev.view && 'chemin' in ev.view ? ev.view.chemin : ev.view?.kind === 'recherche' ? `« ${ev.view.requete} »` : ev.summary,
                status: ev.failed || !ev.view ? 'erreur' : 'pret',
                ...(ev.view ? { data: ev.view } : {}),
                ...(ev.message ? { message: ev.message } : {}),
                at: Date.now()
              })
            }
            continue
          }
          // Le texte affiché et gardé est sans marques ; les phrases à dire les gardent, pour l'instant où elles se disent.
          const delta = stripper.push(ev.text)
          reply += delta
          if (delta) this.io.broadcast({ type: 'reply.text', turnId: turn.id, delta })
          if ((!this.tts || !opts.speak) && this.state === 'reflexion') this.setState('parole')
          for (const s of chunker.push(ev.text)) sentences.push({ texte: s, outils: afterTools })
        }
        const rest = stripper.flush()
        if (rest) {
          reply += rest
          this.io.broadcast({ type: 'reply.text', turnId: turn.id, delta: rest })
        }
        for (const s of chunker.flush()) sentences.push({ texte: s, outils: afterTools })
      } catch (err) {
        // Une interruption volontaire n'est pas une erreur.
        if (!isAbort(err) && !signal.aborted) {
          failed = true
          this.error(owner, 'cerveau', describeBrainError(err))
        }
      } finally {
        sentences.close()
      }
    })()

    /**
     * Les panneaux qu'ouvre une phrase : ceux de ses marques, ou, si Claude n'en met pas, le suivant dans l'ordre
     * des appels pour chaque phrase venue après les outils.
     */
    const revealsOf = (texte: string, outils: boolean): string[] => {
      const { names } = takeMarks(texte)
      return names.length || stripper.seen || !outils ? names : ['']
    }

    const speak = (async () => {
      if (!this.tts || !opts.speak) {
        // Sans voix : les panneaux suivent la lecture de la réponse, phrase après phrase, au lieu d'arriver
        // tous ensemble (le texte écrit arrive en quelques secondes).
        for await (const { texte, outils } of sentences) {
          if (signal.aborted) break
          const now = Date.now()
          for (const name of revealsOf(texte, outils)) panels.reveal(name, Math.max(readUntil, now) - now)
          readUntil = Math.max(readUntil, now) + readingMs(takeMarks(texte).text)
        }
        return
      }
      let seq = 0
      try {
        for await (const { texte, outils } of sentences) {
          if (signal.aborted) break
          const sentence = takeMarks(texte).text
          const names = revealsOf(texte, outils)
          // La phrase commence à se jouer quand l'audio déjà envoyé est fini.
          const revealAt = () => {
            for (const name of names.splice(0)) panels.reveal(name, Math.max(audioEndsAt, Date.now()) - Date.now())
          }
          if (!sentence) {
            revealAt()
            continue
          }
          for await (const pcm of this.tts.synthesize(sentence, signal, this.voice)) {
            if (signal.aborted) break
            revealAt()
            if (this.state !== 'parole') this.setState('parole')
            const to = this.replyTo
            if (to) {
              this.io.send(to, { type: 'reply.audio', turnId: turn.id, seq: seq++, levels: levels(pcm, VOICE_SAMPLE_RATE) })
              this.io.sendBinary(to, pcm)
            }
            audioEndsAt = Math.max(audioEndsAt, Date.now()) + durationMs(pcm.length, VOICE_SAMPLE_RATE)
          }
        }
      } catch (err) {
        if (!isAbort(err) && !signal.aborted) this.error(owner, 'voix', err)
      }
    })()

    await Promise.all([think, speak])
    // L'audio est envoyé plus vite qu'il n'est joué : on reste « parole » jusqu'à la fin de la lecture.
    await sleep(audioEndsAt - Date.now(), signal)
    if (signal.aborted) panels.showAll()
    else panels.finish(Math.max(readUntil - Date.now(), 0))

    const interrupted = signal.aborted
    this.io.broadcast({ type: 'reply.end', turnId: turn.id, interrupted })
    if (reply.trim()) {
      const said = interrupted ? `${reply.trim()} [interrompu]` : reply.trim()
      addMessage(this.uid, 'assistant', evidence.length ? `${said}\n[Résultats d’outils : ${evidence.join(' ; ')}]` : said)
      this.log('reponse', interrupted ? 'Réponse interrompue' : truncate(reply.trim(), 90))
    } else if (!failed && !interrupted) {
      this.log('reponse', 'Réponse vide')
    }
    if (this.turn === turn) {
      this.turn = null
      this.setState(this.idleState())
    }
    this.planLearning()
  }

  /** Quelques minutes après la dernière réponse, CODE relit les échanges pour retenir ce qui servira encore. */
  private planLearning(): void {
    if (this.learnTimer) clearTimeout(this.learnTimer)
    this.learnTimer = setTimeout(() => {
      this.learnTimer = null
      void runAsUser(this.uid, () => this.learn())
    }, LEARN_AFTER_MS)
    this.learnTimer.unref()
  }

  private async learn(): Promise<void> {
    if (this.turn) return this.planLearning()
    const since = this.learnedUpTo
    const exchanges = recentMessages(this.uid, LEARN_MAX_MESSAGES).filter((t) => t.ts > since)
    // Seuls ses propres mots comptent ; les messages entre crochets viennent de l'application (briefing, alertes).
    if (!exchanges.some((t) => t.role === 'user' && !t.text.startsWith('['))) return
    this.learnedUpTo = exchanges.at(-1)!.ts
    try {
      const faits = await this.brain.learn(this.user, exchanges)
      for (const { sujet, fait } of faits) if (addNote(this.uid, sujet, fait)) this.log('systeme', `Appris : ${fait}`)
      console.log(`[mémoire] utilisateur ${this.uid} : ${exchanges.length} message(s) relu(s), ${faits.length} fait(s) retenu(s)`)
    } catch (err) {
      console.warn(`[mémoire] apprentissage impossible : ${(err as Error).message}`)
    }
  }

  /** Ce que les outils peuvent demander à la session. */
  private toolContext(): ToolContext {
    return {
      user: this.user,
      fichiers: this.fichiersOk(),
      pont: this.pontMac(),
      requestConfirmation: (title, summary, execute) =>
        this.requestConfirmation(title, summary, () =>
          // L'accord arrive plus tard (bouton, voix) : l'action tourne quand même pour cet utilisateur.
          runAsUser(this.uid, async () => {
            try {
              await execute()
            } catch (err) {
              this.error(this.micOwner, 'action', err)
            }
          })
        ),
      announce: (text) => void this.announce(text),
      log: (summary) => this.log('action', summary),
      position: () => this.requestPosition(this.micOwner),
      conversation: (actif) => this.setConversation(this.micOwner, actif),
      reunion: (action, titre) => this.commandeReunion(action, titre)
    }
  }

  /** Demandes de position en cours (itinéraire), par identifiant. */
  private positions = new Map<string, { connectionId: string; resolve: (p: GeoPosition | { erreur: string } | null) => void }>()

  /**
   * Demande sa position à l'appareil qui a posé la question, et à lui seul. La réponse n'est pas gardée :
   * elle sert à ce trajet. Sans réponse dans le délai (appareil fermé, autorisation en attente) : erreur.
   */
  private requestPosition(connectionId: string | null): Promise<GeoPosition | { erreur: string } | null> {
    if (!connectionId) return Promise.resolve(null)
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.positions.delete(id)
        resolve({ erreur: 'l’appareil n’a pas donné sa position à temps' })
      }, codeConfig.itineraire.attentePosition * 1000)
      this.positions.set(id, {
        connectionId,
        resolve: (p) => {
          clearTimeout(timer)
          this.positions.delete(id)
          resolve(p)
        }
      })
      this.io.send(connectionId, { type: 'position.demande', id })
    })
  }

  /** Réponse d'un appareil : seulement celui à qui on l'a demandée, avec des coordonnées valides. */
  onPosition(connectionId: string, msg: { id?: unknown; lat?: unknown; lng?: unknown; precision?: unknown; erreur?: unknown }): void {
    const wait = this.positions.get(String(msg.id ?? ''))
    if (!wait || wait.connectionId !== connectionId) return
    const { lat, lng } = msg
    if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const appareil = this.devices.get(connectionId)
      wait.resolve({ lat, lng, ...(typeof msg.precision === 'number' ? { precision: Math.round(msg.precision) } : {}), ...(appareil ? { appareil } : {}) })
    } else wait.resolve({ erreur: typeof msg.erreur === 'string' ? msg.erreur.slice(0, 120) : 'position indisponible' })
  }

  /**
   * Une courte phrase de CODE hors conversation (« C'est fait. »), à voix haute sur l'appareil qui a le micro.
   * `history` : ce qu'en garde la conversation, s'il faut plus de précision que ce qui est dit (références).
   */
  private async announce(text: string, to: string | null = this.micOwner, history = text): Promise<void> {
    const turnId = randomUUID()
    this.io.broadcast({ type: 'reply.text', turnId, delta: text })
    // Pendant l'enregistrement d'une réunion, rien n'est dit de lui-même (rappel, annonce) : l'écran seulement.
    const owner = this.enReunion ? null : to
    if (this.tts && owner && !this.lastWritten) {
      let seq = 0
      try {
        for await (const pcm of this.tts.synthesize(text, new AbortController().signal, this.voice)) {
          this.io.send(owner, { type: 'reply.audio', turnId, seq: seq++, levels: levels(pcm, VOICE_SAMPLE_RATE) })
          this.io.sendBinary(owner, pcm)
        }
      } catch (err) {
        this.error(owner, 'voix', err)
      }
    }
    this.io.broadcast({ type: 'reply.end', turnId, interrupted: false })
    addMessage(this.uid, 'assistant', history)
  }

  private stopTurn(): void {
    this.turn?.abort.abort()
    this.turn = null
  }

  // ── Utilitaires ───────────────────────────────────────────────────────

  private idleState(): Etat {
    if (this.stopped) return 'arret'
    return this.gate.pending ? 'attente_validation' : 'veille'
  }

  private setState(state: Etat): void {
    if (this.stopped && state !== 'arret') state = 'arret'
    if (state === this.state) return
    // Vous parlez ou CODE répond : le silence qui coupe le mode conversation se compte depuis la fin.
    if (this.conversation && (state === 'reflexion' || state === 'parole' || this.state === 'parole')) this.armConversation()
    this.state = state
    this.io.broadcast({ type: 'state', state, micOwner: this.micOwner })
  }

  private refuseWhenHalted(connectionId: string): boolean {
    if (!this.stopped) return false
    this.io.send(connectionId, { type: 'error', code: 'arret', message: `${nomAssistant(this.user)} est à l’arrêt. Reprenez-le depuis le Mac.` })
    return true
  }

  private log(kind: LogEntry['kind'], summary: string): void {
    this.io.broadcast({ type: 'log', entry: addLog(this.uid, kind, summary) })
  }

  private error(connectionId: string | null, code: string, err: unknown): void {
    const message = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err)
    console.error(`[session ${this.uid}] ${code} :`, message)
    this.log('erreur', message)
    const payload: ServerPayload = { type: 'error', code, message }
    if (connectionId) this.io.send(connectionId, payload)
    else this.io.broadcast(payload)
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
