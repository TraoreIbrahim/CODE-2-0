import { phraseInachevee, type DeviceKind } from '@code/protocol'
import type { ClientState, CodeClient } from './client.ts'
import { isBuiltInMic, Mic, MicError, preloadMic, primeMicAudio } from './mic.ts'
import { Player } from './player.ts'

/** Délai pour commencer à parler après avoir touché l'orbe. */
const FIRST_WORDS_MS = 8_000
/** L'audio d'avant l'appel n'est joint à la phrase que si elle commence dans ce délai (dite d'une traite). */
const PREROLL_MS = 2_000
/** Silence de plus attendu quand le sens de la phrase n'est pas encore jugé (il arrive en général entre-temps). */
const HOLD_MS = 1_500
/** Silence de plus attendu au plus quand la phrase est au milieu (« … parce que », une énumération, « euh »). */
const HOLD_MAX_MS = 5_000

export type VoiceStatus = { micOn: boolean; opening: boolean; playing: boolean; micError: string | null }

/** Le mode conversation est-il tenu par cet écran (son micro reste ouvert) ? */
export function conversationHere(s: ClientState): boolean {
  return !!s.ecoute.conversation && s.ecoute.conversation.connectionId === s.connectionId
}

/** Le mode conversation tourne-t-il sur l'un de ces appareils (le Mac : son app et sa miniature) ? */
export function conversationOn(s: ClientState, appareils: DeviceKind[]): boolean {
  const c = s.ecoute.conversation
  return !!c && (c.connectionId === s.connectionId || (!!c.appareil && appareils.includes(c.appareil)))
}

/**
 * Relie le micro, le haut-parleur et le serveur pour un appareil :
 * appui sur l'orbe, détection de fin de phrase, interruption (« barge-in »),
 * micro qui reste ouvert le temps d'une relance puis se referme, ou tant que dure le mode conversation.
 */
const SILENT_PREFIX = 'Le micro'

/** Le message quand le micro ne capte rien : le nom de l'appareil dit souvent tout (des écouteurs rangés). */
export function silentMessage(device: string): string {
  const name = device.trim()
  return isBuiltInMic(name)
    ? `${SILENT_PREFIX} ne capte aucun son : vérifiez qu’aucune autre app ne l’utilise, puis touchez l’orbe pour réessayer.`
    : `${SILENT_PREFIX} « ${name} » ne capte aucun son : débranchez ces écouteurs ou passez au micro de l’appareil.`
}

export class VoiceController {
  readonly player = new Player()
  private mic: Mic | null = null
  private opening: Promise<void> | null = null
  private openAbort: AbortController | null = null
  private status: VoiceStatus = { micOn: false, opening: false, playing: false, micError: null }
  private listeners = new Set<() => void>()
  /**
   * `held` : le serveur a clos la phrase alors que le micro entend encore parler (d'autres autour de vous).
   * `hold` : silence après une phrase qui semble inachevée ; l'envoi continue, la suite reste dans la même phrase.
   */
  private speech: 'none' | 'pending' | 'streaming' | 'held' | 'hold' = 'none'
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  /** L'attente en cours est la longue (phrase jugée au milieu). */
  private holdLong = false
  private buffered: ArrayBuffer[] = []
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private micLevel = 0
  private disposers: (() => void)[] = []
  private enrollMic: Mic | null = null
  /** Micro ouvert exprès (orbe, mot d’activation) : la phrase qui suit est acceptée sans attendre votre voix. */
  private called = false
  /** Audio d'avant l'appel (la fin du mot d’activation et ce qui suit), pour ne pas perdre les premiers mots. */
  private preroll: { pcm: ArrayBuffer; at: number } | null = null
  /** Cet écran tient le mode conversation : le micro reste ouvert sans appel (seule la parole détectée part). */
  private conversing = false

  constructor(private readonly client: CodeClient) {
    this.disposers.push(
      client.on('audio', (header, pcm) => {
        this.player.enqueue(pcm, header.levels)
        this.mic?.setCodeSpeaking(true)
        this.patch({ playing: true })
      }),
      this.player.onIdle(() => {
        this.mic?.setCodeSpeaking(false)
        this.patch({ playing: false })
        this.armIdle(this.followUpMs())
        this.resumeHeld()
      }),
      client.on('audioStop', (reason) => this.onServerStop(reason)),
      client.on('audioBarge', () => {
        this.trace('votre voix pendant la réponse : l’assistant se tait')
        this.player.stop()
      }),
      client.subscribe(() => this.onClientChange()),
      client.on('enrollDone', () => void this.closeEnrollMic())
    )
  }

  getStatus = (): VoiceStatus => this.status
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Volume à afficher par l'orbe : voix de CODE quand il parle, sinon micro pendant l'écoute. */
  level = (): number => {
    const voice = this.player.level()
    if (voice >= 0) return voice
    return this.speech !== 'none' || this.enrollMic ? this.micLevel : -1
  }

  /** Appui sur l'orbe ou le bouton micro, ou le mot d’activation (`preroll` : l'audio juste avant, PCM 16 bits à 16 kHz). */
  async toggle(preroll?: ArrayBuffer): Promise<void> {
    // Pendant le toucher, avant toute attente : sinon Safari laisse l'audio du micro en pause.
    primeMicAudio()
    await this.player.unlock()
    const s = this.client.getState()
    if (s.connection !== 'connecte' || s.serverState === 'arret') return
    // Toucher pendant la préparation : on annule et on coupe le micro.
    if (this.opening) {
      this.trace('toucher pendant la préparation : annulation')
      this.openAbort?.abort()
      return
    }
    const codeBusy = this.player.playing || (this.client.isMicOwner && (s.serverState === 'parole' || s.serverState === 'reflexion'))
    if (codeBusy) {
      this.interrupt()
      this.markCalled(preroll)
      await this.openMic()
      return
    }
    if (s.ecoute.conversation) {
      // Second toucher : fin de l'écoute continue ; la phrase en cours part d'abord.
      if (this.speech === 'streaming' || this.speech === 'hold') this.endSpeech()
      this.trace('toucher : écoute continue arrêtée')
      await this.setConversation(false)
      return
    }
    if (this.status.micOn) {
      if (this.speech === 'streaming' || this.speech === 'hold') this.client.send({ type: 'audio.end' })
      else this.client.send({ type: 'audio.cancel' })
      await this.closeMic()
      return
    }
    // Premier toucher : écoute continue (mode conversation) jusqu'au toucher suivant, sans toucher à chaque
    // réponse ; la première phrase passe sans attendre votre voix. Sans empreinte vocale, une seule phrase.
    this.markCalled(preroll)
    if (s.speaker.enabled) {
      this.trace('toucher : écoute continue')
      await this.setConversation(true)
      return
    }
    await this.openMic()
    this.armIdle(FIRST_WORDS_MS)
  }

  /**
   * Bouton ou veille de l'appareil : active le mode conversation ici, ou le coupe (où qu'il soit). Activé
   * pendant le toucher, le micro s'ouvre aussitôt (Safari l'exige) ; sans empreinte vocale, le serveur
   * refuse et dit pourquoi, et le micro se referme après la relance.
   */
  async setConversation(active: boolean): Promise<void> {
    if (!active) {
      if (this.client.getState().ecoute.conversation) this.client.send({ type: 'conversation.set', active: false })
      return
    }
    primeMicAudio()
    await this.player.unlock()
    const s = this.client.getState()
    if (s.connection !== 'connecte' || s.serverState === 'arret') return
    if (!this.client.send({ type: 'conversation.set', active: true })) return
    if (s.speaker.enabled) await this.openMic()
  }

  /** Écoute une voix de CODE (assistant, Réglages) : pendant le toucher, pour que le son puisse partir. */
  async preview(voix: string, vitesse: number): Promise<void> {
    this.player.stop()
    await this.player.unlock()
    this.client.sampleVoice(voix, vitesse)
  }

  /**
   * Enregistre l'empreinte vocale : tout le son du micro part au serveur
   * jusqu'à 100 %, puis l'enregistrement se termine tout seul.
   */
  async startEnrollment(): Promise<void> {
    if (this.enrollMic) return
    primeMicAudio()
    this.player.stop()
    await this.closeMic()
    if (!this.client.send({ type: 'enroll.start' })) return
    let finishing = false
    try {
      this.enrollMic = await Mic.open({
        onSpeechStart: () => {},
        onFrame: (pcm) => {
          if (finishing) return
          this.client.sendAudio(pcm)
          if ((this.client.getState().enroll?.percentage ?? 0) >= 100) {
            finishing = true
            this.client.send({ type: 'enroll.end' })
          }
        },
        onSpeechConfirmed: () => {},
        onSpeechEnd: () => {},
        onMisfire: () => {},
        onLevel: (level) => (this.micLevel = level)
      }, { trace: this.trace })
      this.patch({ micOn: true })
    } catch (err) {
      this.client.send({ type: 'enroll.cancel' })
      this.patch({ micError: err instanceof MicError ? err.message : 'Micro indisponible.' })
    }
  }

  async cancelEnrollment(): Promise<void> {
    this.client.send({ type: 'enroll.cancel' })
    await this.closeEnrollMic()
  }

  private async closeEnrollMic(): Promise<void> {
    const mic = this.enrollMic
    this.enrollMic = null
    this.patch({ micOn: false })
    await mic?.close()
    if (mic && this.conversing) void this.openMic()
  }

  interrupt(): void {
    this.player.stop()
    this.client.send({ type: 'interrupt' })
  }

  async dispose(): Promise<void> {
    for (const d of this.disposers) d()
    this.player.stop()
    await this.closeMic()
    await this.closeEnrollMic()
  }

  private async openMic(): Promise<void> {
    if (this.mic) return
    if (this.opening) return this.opening
    this.patch({ opening: true, micError: null })
    const abort = (this.openAbort = new AbortController())
    this.opening = (async () => {
      try {
        this.mic = await Mic.open({
          onSpeechStart: (before) => {
            this.clearIdle()
            if (this.speech === 'hold') {
              // Vous reprenez : c'est la suite de la même phrase (le silence a été envoyé, rien n'est perdu).
              this.clearHold()
              this.speech = 'streaming'
              this.trace('vous reprenez : même phrase')
              return
            }
            this.speech = 'pending'
            this.buffered = [...before]
          },
          onFrame: (pcm) => {
            if (this.speech === 'streaming' || this.speech === 'hold') this.client.sendAudio(pcm)
            else if (this.speech === 'pending') this.buffered.push(pcm)
          },
          onSpeechConfirmed: () => {
            if (this.speech !== 'pending') return
            // Parole confirmée pendant que CODE parle : coupé tout de suite (spec 3.1), sauf avec une empreinte,
            // où le serveur ne le coupe qu'à votre voix (`audio.barge`) : son écho ou un voisin ne l'arrêtent plus.
            const overReply = this.player.playing
            if (overReply && !this.client.getState().speaker.enabled) this.interrupt()
            // Seule la première phrase après l'appel en profite ; les relances passent par votre voix.
            const called = this.called && !overReply
            const head = called && this.preroll && Date.now() - this.preroll.at < PREROLL_MS ? this.preroll.pcm : null
            this.called = false
            this.preroll = null
            if (!this.client.send({ type: 'audio.start', overReply, called })) return
            if (called) this.trace(`parole après l’appel : envoyée sans attendre votre voix${head ? ', avec l’audio d’avant' : ''}`)
            if (head) this.client.sendAudio(head)
            for (const pcm of this.buffered) this.client.sendAudio(pcm)
            this.buffered = []
            this.speech = 'streaming'
          },
          onSpeechEnd: () => {
            // Le silence ne suffit pas : la phrase finit si son sens est complet, sinon CODE attend la suite.
            if (this.speech === 'streaming') return this.pause()
            this.speech = 'none'
            this.buffered = []
          },
          onMisfire: () => {
            // Un son trop court après une reprise : on revient à l'attente de la suite.
            if (this.speech === 'streaming') return this.pause()
            this.speech = 'none'
            this.buffered = []
          },
          onLevel: (level) => (this.micLevel = level),
          onSilent: (device) => this.patch({ micError: silentMessage(device) }),
          onSound: () => this.status.micError?.startsWith(SILENT_PREFIX) && this.patch({ micError: null })
        }, { trace: this.trace, signal: abort.signal })
        this.patch({ micOn: true })
      } catch (err) {
        const cancelled = err instanceof MicError && err.reason === 'cancelled'
        if (!cancelled) this.patch({ micError: err instanceof MicError ? err.message : 'Micro indisponible : touchez l’orbe pour réessayer.' })
        console.error('[voix]', err)
      } finally {
        this.opening = null
        this.openAbort = null
        this.patch({ opening: false })
      }
    })()
    return this.opening
  }

  /**
   * Le sens de la phrase dite jusqu'ici : finie (`true`), au milieu (`false`), ou pas encore jugé (`null`).
   * Le serveur le juge pendant les pauses ; une fin évidente (« … parce que ») se voit ici.
   */
  private sensDeLaPhrase(): boolean | null {
    const s = this.client.getState()
    const text = s.partial.trim()
    if (!text) return null
    if (phraseInachevee(text)) return false
    return s.sens && s.sens.text.trim() === text ? s.sens.fini : null
  }

  /** Silence après de la parole : fin de la phrase si elle est complète, sinon attente de la suite. */
  private pause(): void {
    const sens = this.sensDeLaPhrase()
    if (sens === true) {
      this.trace('silence, phrase complète : envoyée')
      return this.endSpeech()
    }
    this.hold(sens === false)
  }

  /** L'envoi continue un moment (plus longtemps si la phrase est au milieu), puis la phrase se termine si rien ne suit. */
  private hold(long: boolean): void {
    this.clearHold()
    this.speech = 'hold'
    this.holdLong = long
    this.trace(long ? 'phrase au milieu : l’assistant attend la suite' : 'silence : l’assistant vérifie si la phrase est finie')
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null
      if (this.speech === 'hold') this.endSpeech()
    }, long ? HOLD_MAX_MS : HOLD_MS)
  }

  private clearHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.holdTimer = null
  }

  /** Fin de la phrase en cours, envoyée au serveur. */
  private endSpeech(): void {
    this.clearHold()
    this.client.send({ type: 'audio.end' })
    this.speech = 'none'
    this.buffered = []
  }

  private async closeMic(): Promise<void> {
    this.clearHold()
    this.clearIdle()
    const mic = this.mic
    this.mic = null
    this.called = false
    this.preroll = null
    this.speech = 'none'
    this.buffered = []
    this.patch({ micOn: false })
    await mic?.close()
  }

  /**
   * Phrase close par le serveur : vous avez fini (`fin`), ou seules d'autres voix parlent (`autre`, le micro
   * se ferme). Si le micro entend encore parler, on n'envoie plus rien jusqu'à la réponse de CODE.
   */
  private onServerStop(reason: 'fin' | 'autre'): void {
    this.clearHold()
    if (this.speech === 'streaming' || this.speech === 'hold') this.speech = 'held'
    // Pendant une réponse (son écho, d'autres voix) : le micro reste ouvert pour la suite de la conversation.
    const replying = this.player.playing || this.client.getState().serverState !== 'ecoute'
    this.trace(reason === 'fin' ? 'fin de phrase décidée par le serveur (votre voix s’est tue)' : replying ? 'pendant la réponse, pas votre voix : ignoré' : this.conversing ? 'd’autres voix seulement : ignorées (mode conversation)' : 'd’autres voix seulement : micro fermé')
    if (reason === 'autre' && !replying && !this.conversing) void this.closeMic()
  }

  /**
   * CODE a répondu et on parle encore autour : on reprend l'envoi, le serveur attendra votre voix pour la suite.
   * Sans relance ni mode conversation, le micro se referme plutôt : on ne reparle qu'en touchant l'orbe.
   */
  private resumeHeld(): void {
    if (this.speech !== 'held' || this.player.playing || this.client.getState().serverState !== 'veille') return
    if (!this.conversing && this.followUpMs() <= 0) {
      void this.closeMic()
      return
    }
    if (!this.client.send({ type: 'audio.start' })) return
    this.speech = 'streaming'
  }

  private markCalled(preroll?: ArrayBuffer): void {
    this.called = true
    this.preroll = preroll ? { pcm: preroll, at: Date.now() } : null
  }

  /** Garde le micro ouvert tant que la conversation est active ; sinon le referme après un délai. */
  private onClientChange(): void {
    const s = this.client.getState()
    // Connecté : on prépare le moteur de détection de parole en fond, pour un premier toucher rapide.
    if (s.connection === 'connecte') void preloadMic(this.trace).catch(() => {})
    if (s.connection !== 'connecte' || s.serverState === 'arret') {
      this.player.stop()
      void this.closeMic()
      void this.closeEnrollMic()
      return
    }
    const conversing = conversationHere(s)
    if (conversing !== this.conversing) {
      this.conversing = conversing
      this.trace(conversing ? 'mode conversation : micro ouvert sans appel' : 'mode conversation coupé : micro refermé après la relance')
      // Activé de vive voix (micro déjà ouvert) ou depuis le bouton : une seule ouverture, pas d'essais en boucle.
      if (conversing && !this.mic && !this.enrollMic) void this.openMic()
    }
    if (!this.mic) return
    if (this.speech === 'hold') {
      // Le sens arrive pendant l'attente : complète, elle part ; au milieu, CODE attend plus longtemps.
      const sens = this.sensDeLaPhrase()
      if (sens === true) {
        this.trace('phrase jugée complète : envoyée')
        this.endSpeech()
      } else if (sens === false && !this.holdLong) this.hold(true)
    }
    this.resumeHeld()
    const active = this.conversing || s.serverState !== 'veille' || this.player.playing || this.speech !== 'none'
    if (active) this.clearIdle()
    else if (!this.idleTimer) this.armIdle(this.followUpMs())
  }

  /** Délai de la relance après une réponse (réglé sur le serveur, `voice.ecoute.relanceMs`). */
  private followUpMs(): number {
    return this.client.getState().ecoute.relanceMs
  }

  private armIdle(ms: number): void {
    this.clearIdle()
    if (this.conversing || (!this.mic && !this.opening)) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      const s = this.client.getState()
      if (s.serverState === 'veille' && !this.player.playing && this.speech === 'none') void this.closeMic()
    }, ms)
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  /** Journal technique au serveur (étapes du micro), pour diagnostiquer un appareil à distance. */
  private trace = (step: string): void => {
    this.client.send({ type: 'client.log', message: step })
  }

  private patch(part: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...part }
    for (const fn of this.listeners) fn()
  }
}
