import type { MicVAD } from '@ricky0123/vad-web'
import { floatToPcm16 } from '@code/protocol'
import { audioContext, existingAudioContext, primeAudio } from './audio.ts'
import { EnergyVad } from './energy-vad.ts'

export type MicHandlers = {
  /** Début probable de parole ; `before` = l'audio juste avant, pour ne pas couper la première syllabe. */
  onSpeechStart: (before: ArrayBuffer[]) => void
  /** Chaque trame de 32 ms (PCM 16 bits, 16 kHz). */
  onFrame: (pcm: ArrayBuffer) => void
  /** Parole confirmée (au moins 250 ms) : c'est elle qui interrompt CODE. */
  onSpeechConfirmed: () => void
  onSpeechEnd: () => void
  /** Fausse alerte : bruit trop court. */
  onMisfire: () => void
  /** Le volume du micro (0..1), pour animer l'orbe pendant l'écoute. */
  onLevel: (level: number) => void
  /** Le micro ne renvoie que du silence numérique (écouteurs rangés, mauvaise entrée) : `device` est son nom. */
  onSilent?: (device: string) => void
  /** Le son revient après un `onSilent`. */
  onSound?: () => void
}

/** Un micro qui marche capte toujours un fond sonore ; en dessous, c'est un silence numérique (≈ −90 dB). */
const DEAD_LEVEL = 0.0002
const DEAD_AFTER_MS = 3000

/**
 * Surveille le volume : au bout de 3 s sans le moindre son, prévient une fois
 * (et le dit au journal) ; prévient aussi quand le son revient.
 */
export function watchSilence(handlers: MicHandlers, device: string, trace: (s: string) => void, now = () => performance.now()): MicHandlers {
  let first: number | null = null
  let peak = 0
  let silent = false
  return {
    ...handlers,
    onLevel: (level) => {
      handlers.onLevel(level)
      const t = now()
      first ??= t
      if (level > DEAD_LEVEL) {
        peak = Math.max(peak, level)
        if (silent) {
          silent = false
          trace('le son revient')
          handlers.onSound?.()
        }
        return
      }
      if (!silent && peak <= DEAD_LEVEL && t - first >= DEAD_AFTER_MS) {
        silent = true
        trace(`aucun son depuis ${Math.round((t - first) / 1000)} s (${device || 'micro'})`)
        handlers.onSilent?.(device)
      }
    }
  }
}

/** Pourquoi le micro n'a pas pu s'ouvrir, avec le message à montrer. */
export class MicError extends Error {
  constructor(
    readonly reason: 'insecure' | 'unsupported' | 'denied' | 'absent' | 'busy' | 'timeout' | 'engine' | 'cancelled' | 'failed',
    message: string
  ) {
    super(message)
  }
}

const IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
/** Démarrage du moteur (modèle, worklet) : au-delà, on abandonne avec un message plutôt que de rester bloqué.
 *  Large : au premier lancement, un iPhone télécharge et compile 15 Mo de WebAssembly. */
const ENGINE_TIMEOUT_MS = 60_000

export type MicOptions = {
  /** Étapes de l'ouverture (diagnostic à distance). */
  trace?: (step: string) => void
  /** Annule une ouverture en cours (nouveau toucher pendant la préparation). */
  signal?: AbortSignal
}

/** Rejette si `p` ne se termine pas à temps ou si l'ouverture est annulée. */
function guard<T>(p: Promise<T>, ms: number, onTimeout: () => MicError, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms)
    const abort = () => reject(new MicError('cancelled', 'Ouverture du micro annulée.'))
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    p.then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    })
  })
}

/** Remet l'audio du micro en marche s'il est en pause ou interrompu (iPhone), sans jamais bloquer. */
async function wake(ctx: AudioContext | null, trace?: (s: string) => void): Promise<void> {
  if (!ctx || ctx.state === 'running') return
  trace?.(`contexte audio ${ctx.state} : relance`)
  await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
  trace?.(`contexte audio après relance : ${ctx.state}`)
}
/** Demande d'accès sans réponse : certains navigateurs (Arc sur iPhone…) ne la transmettent jamais. */
const PERMISSION_TIMEOUT_MS = 15_000

function micErrorOf(err: unknown): MicError {
  if (err instanceof MicError) return err
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new MicError(
      'denied',
      IOS
        ? 'Micro bloqué. Dans Arc ou un autre navigateur, ouvrez CODE 2.0 dans Safari ; dans Safari, autorisez-le dans Réglages → Apps → Safari → Micro.'
        : 'Accès au micro refusé : autorisez-le dans Réglages Système → Confidentialité et sécurité → Micro.'
    )
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new MicError('absent', 'Aucun micro détecté sur cet appareil.')
  if (name === 'NotReadableError' || name === 'AbortError') return new MicError('busy', 'Le micro est déjà utilisé par une autre app : fermez-la et réessayez.')
  return new MicError('failed', 'Micro indisponible : touchez l’orbe pour réessayer.')
}

/**
 * Le micro est-il utilisable ici ? HTTPS obligatoire, et l'API doit exister
 * (absente dans certains navigateurs intégrés à des apps).
 */
function checkSupport(): void {
  if (typeof window !== 'undefined' && !window.isSecureContext)
    throw new MicError('insecure', 'Le micro demande une connexion sécurisée : ouvrez CODE 2.0 par son adresse Tailscale en https.')
  if (!navigator.mediaDevices?.getUserMedia)
    throw new MicError('unsupported', IOS ? 'Ce navigateur ne donne pas accès au micro : ouvrez CODE 2.0 dans Safari.' : 'Ce navigateur ne donne pas accès au micro.')
}

/** À appeler pendant le toucher, avant toute attente : réveille l'audio (partagé avec la voix de CODE). */
export function primeMicAudio(): void {
  primeAudio()
}

const assetBase = () => new URL('vad/', document.baseURI).href
let warming: Promise<void> | null = null
let warmed = false
/**
 * Silero (ONNX Runtime en WebAssembly) sur cet appareil ? Pas sur iPhone : son démarrage y prend
 * près d'une minute, occupe le processeur (le son capté en saccade) et recommence à chaque ouverture.
 * Ailleurs, abandonné aussi s'il met plus de 3 s à démarrer.
 */
let sileroUsable = !IOS
const SILERO_MAX_WARM_MS = 3_000

type Ort = typeof import('onnxruntime-web/wasm')

/** Réglages du moteur ONNX, communs au préchauffage et à la détection de parole. */
function configureOrt(ort: Ort, base: string): void {
  ort.env.logLevel = 'error'
  ort.env.wasm.wasmPaths = base
  // Un seul fil : sans isolement cross-origin (pas de SharedArrayBuffer), le mode multi-fil
  // peut attendre ses workers indéfiniment, notamment sur iPhone.
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
}

/**
 * Démarre le moteur de détection de parole en fond (téléchargement, compilation du WebAssembly,
 * premier chargement du modèle), pour que le toucher sur l'orbe n'ait plus qu'à ouvrir le micro.
 * Le moteur ONNX est partagé avec la bibliothèque VAD : il n'est initialisé qu'une fois.
 */
export function preloadMic(trace?: (step: string) => void): Promise<void> {
  if (warming) return warming
  if (typeof window === 'undefined') return Promise.resolve()
  if (!sileroUsable) {
    trace?.('détection par le volume sur cet appareil (Silero désactivé)')
    return (warming = Promise.resolve())
  }
  const base = assetBase()
  const t0 = (warmStartedAt = performance.now())
  const ms = () => Math.round(performance.now() - t0)
  const slow = setTimeout(() => !warmed && trace?.('préchauffage : toujours en cours après 20 s (moteur bloqué ?)'), 20_000)
  warming = (async () => {
    const [ort] = await Promise.all([import('onnxruntime-web/wasm'), import('@ricky0123/vad-web')])
    configureOrt(ort, base)
    trace?.(`préchauffage : moteur importé (+${ms()} ms), démarrage du WebAssembly`)
    const session = await ort.InferenceSession.create(base + 'silero_vad_v5.onnx')
    warmed = true
    clearTimeout(slow)
    if (ms() > SILERO_MAX_WARM_MS) sileroUsable = false
    trace?.(`préchauffage : moteur prêt en ${ms()} ms${sileroUsable ? '' : ' — trop lent, détection par le volume'}`)
    await session.release().catch(() => {})
  })()
  warming.catch((err: Error) => {
    trace?.(`préchauffage : échec après ${ms()} ms — ${err?.name} ${err?.message}`)
    warming = null
  })
  return warming
}

const AUDIO = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }

/** Le micro de l'appareil lui-même (pas des écouteurs ni un micro externe), d'après son nom. */
export const isBuiltInMic = (label: string) => !label.trim() || /iphone|ipad|built-in|intégré|default|par défaut/i.test(label)

async function askStream(trace: (s: string) => void = () => {}): Promise<MediaStream> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new MicError('timeout', IOS ? 'Le navigateur ne répond pas à la demande de micro : ouvrez CODE 2.0 dans Safari.' : 'Le navigateur ne répond pas à la demande de micro.')),
      PERMISSION_TIMEOUT_MS
    )
  })
  let stream: MediaStream
  try {
    stream = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: AUDIO }), timeout])
  } finally {
    clearTimeout(timer)
  }
  return IOS ? preferBuiltIn(stream, trace) : stream
}

/**
 * Sur iPhone, des écouteurs Bluetooth prennent la main sur le micro et, souvent, ne transmettent qu'un
 * souffle (rien n'est jamais détecté avec des « H4 PRO MAX »). On repasse sur le micro du téléphone ;
 * la voix de CODE continue de sortir dans les écouteurs.
 */
async function preferBuiltIn(stream: MediaStream, trace: (s: string) => void): Promise<MediaStream> {
  const label = stream.getAudioTracks()[0]?.label ?? ''
  if (isBuiltInMic(label)) return stream
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const builtIn = devices.find((d) => d.kind === 'audioinput' && d.label && isBuiltInMic(d.label) && !/default|par défaut/i.test(d.label))
    if (!builtIn) return stream
    const other = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: builtIn.deviceId } } })
    for (const t of stream.getTracks()) t.stop()
    trace(`« ${label} » écarté → ${other.getAudioTracks()[0]?.label || builtIn.label}`)
    return other
  } catch (err) {
    trace(`micro du téléphone indisponible (${(err as Error).name}), on garde « ${label} »`)
    return stream
  }
}

const NORMAL = { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35 }
/** Pendant que CODE parle : plus exigeant, pour ne pas se couper sur un reste d'écho. */
const WHILE_SPEAKING = { positiveSpeechThreshold: 0.8, negativeSpeechThreshold: 0.65 }
const PAD_FRAMES = 10 // ≈ 320 ms

/** Le moteur de détection en service : Silero (réseau de neurones) ou repli par le volume. */
type Engine = { name: string; setSpeaking: (speaking: boolean) => void; close: () => Promise<void> }

/** Le moteur Silero n'est attendu que ce temps-là après le début de son préchauffage ; au-delà, repli par le volume. */
const SILERO_WAIT_MS = 6_000
let warmStartedAt = 0

/** Silero prêt à temps ? Attend au plus ce qu'il reste de SILERO_WAIT_MS depuis le début du préchauffage. */
async function sileroInTime(trace: (s: string) => void): Promise<boolean> {
  if (!sileroUsable) return false
  if (warmed) return true
  const pending = preloadMic(trace)
  const left = Math.max(0, warmStartedAt + SILERO_WAIT_MS - performance.now())
  if (left === 0) return false
  trace(`attente du moteur Silero (au plus ${Math.round(left)} ms)`)
  await Promise.race([pending.catch(() => {}), new Promise((r) => setTimeout(r, left))])
  // Pas prêt à temps : trop lent ici, on n'y revient pas (il gênerait le son en finissant de démarrer).
  if (!warmed) sileroUsable = false
  return warmed
}

/** Micro avec annulation d'écho + détection de parole (Silero dans le navigateur, ou repli par le volume). */
export class Mic {
  private ring: ArrayBuffer[] = []
  private engine: Engine | null = null

  private constructor(private readonly stream: MediaStream) {}

  /** Ouvre le micro ; en cas d'échec, une MicError avec le message à afficher. */
  static async open(handlers: MicHandlers, opts: MicOptions = {}): Promise<Mic> {
    const t0 = performance.now()
    const trace = (step: string) => opts.trace?.(`micro +${Math.round(performance.now() - t0)} ms : ${step}`)
    trace(`ouverture (contexte audio : ${existingAudioContext()?.state ?? 'aucun'}, ${existingAudioContext()?.sampleRate ?? '?'} Hz, isolé : ${String(globalThis.crossOriginIsolated)})`)
    checkSupport()
    // L'accès au micro d'abord : la demande s'affiche tout de suite, sans attendre le moteur.
    let stream: MediaStream
    try {
      stream = await guard(askStream(trace), PERMISSION_TIMEOUT_MS + 1000, () => new MicError('timeout', 'Le navigateur ne répond pas à la demande de micro.'), opts.signal)
    } catch (err) {
      trace(`accès refusé : ${(err as Error).name} ${(err as Error).message}`)
      throw micErrorOf(err)
    }
    const track = stream.getAudioTracks()[0]
    trace(`accès accordé (${track?.label || 'piste'} · ${track?.readyState} · ${JSON.stringify(track?.getSettings?.() ?? {})})`)
    const starting = Mic.start(stream, watchSilence(handlers, track?.label ?? '', trace), trace)
    try {
      return await guard(
        starting,
        ENGINE_TIMEOUT_MS,
        () => new MicError('engine', 'Le moteur de voix ne démarre pas sur cet appareil. Touchez l’orbe pour réessayer.'),
        opts.signal
      )
    } catch (err) {
      for (const t of stream.getTracks()) t.stop()
      // Annulé ou trop lent : si le moteur finit par démarrer, on le libère aussitôt.
      void starting.then((late) => late.close()).catch(() => {})
      trace(`échec : ${(err as Error).name} ${(err as Error).message}`)
      console.error('[micro]', err)
      throw micErrorOf(err)
    }
  }

  private static async start(stream: MediaStream, handlers: MicHandlers, trace: (s: string) => void): Promise<Mic> {
    // URL absolue : le moteur ONNX résout ses fichiers par rapport à son propre module.
    const base = assetBase()
    let mic: Mic | null = null
    const micContext = audioContext()
    await wake(micContext, trace)
    // Silero préchauffé à la connexion (preloadMic). Pas prêt à temps (Safari sur iPhone) : repli par le volume.
    if (!(await sileroInTime(trace))) {
      trace('moteur Silero indisponible → détection par le volume')
      return Mic.energy(stream, handlers, trace)
    }
    const { MicVAD } = await import('@ricky0123/vad-web')
    trace('moteur importé')
    let frames = 0
    const options: NonNullable<Parameters<typeof MicVAD.new>[0]> = {
      model: 'v5',
      baseAssetPath: base,
      onnxWASMBasePath: base,
      ...NORMAL,
      // Silence avant de considérer la phrase finie : assez long pour une pause de réflexion au milieu d'un
      // long propos (0,9 s coupait les phrases). Avec une empreinte, le serveur finit aussi la phrase quand sa voix se tait.
      redemptionMs: 1_500,
      preSpeechPadMs: 300,
      minSpeechMs: 250,
      submitUserSpeechOnPause: false,
      startOnLoad: false,
      // Un seul fil : sans isolement cross-origin (pas de SharedArrayBuffer), le moteur multi-fil
      // peut attendre indéfiniment ses workers, notamment sur iPhone.
      ortConfig: (ort) => configureOrt(ort as unknown as Ort, base),
      ...(micContext ? { audioContext: micContext } : {}),
      getStream: async () => stream,
      // Le micro reste à nous : la bibliothèque ne le coupe pas (repli, pause) ; Mic.close() le coupe.
      pauseStream: async () => {},
      resumeStream: async () => stream,
      onFrameProcessed: (probs, frame) => {
        if (++frames === 1 || frames === 100) trace(`trame ${frames} (proba. parole ${probs.isSpeech.toFixed(2)}, contexte ${micContext?.state ?? '?'})`)
        const pcm = floatToPcm16(frame)
        mic?.pushRing(pcm)
        let sum = 0
        for (let i = 0; i < frame.length; i++) sum += (frame[i] ?? 0) ** 2
        handlers.onLevel(Math.min(1, Math.sqrt(sum / frame.length) * 6))
        handlers.onFrame(pcm)
      },
      onSpeechStart: () => handlers.onSpeechStart(mic?.takeRing() ?? []),
      onSpeechRealStart: () => handlers.onSpeechConfirmed(),
      onSpeechEnd: () => handlers.onSpeechEnd(),
      onVADMisfire: () => handlers.onMisfire()
    }
    // 1. Le modèle (réseau de neurones en WebAssembly).
    trace('chargement du modèle')
    const vad = await MicVAD.new({ ...options, processorType: 'AudioWorklet' })
    trace('modèle chargé')
    // 2. L'audio : module AudioWorklet, et repli sur l'ancien traitement s'il ne démarre pas.
    try {
      await guard(vad.start(), 8000, () => new MicError('engine', 'AudioWorklet sans réponse'))
      trace('audio démarré (AudioWorklet)')
      return Mic.ready(Mic.silero(vad, 'Silero · AudioWorklet'), stream, () => frames, trace, (m) => (mic = m))
    } catch (err) {
      trace(`AudioWorklet : ${(err as Error).message} → repli ScriptProcessor`)
      await vad.destroy().catch(() => {})
    }
    const fallback = await MicVAD.new({ ...options, processorType: 'ScriptProcessor' })
    await fallback.start()
    trace('audio démarré (ScriptProcessor)')
    return Mic.ready(Mic.silero(fallback, 'Silero · ScriptProcessor'), stream, () => frames, trace, (m) => (mic = m))
  }

  private static silero(vad: MicVAD, name: string): Engine {
    return {
      name,
      setSpeaking: (speaking) => vad.setOptions(speaking ? WHILE_SPEAKING : NORMAL),
      close: () => vad.destroy().catch(() => {})
    }
  }

  /** Repli sans WebAssembly : détection de parole par le volume, seuil adapté au bruit ambiant. */
  private static async energy(stream: MediaStream, handlers: MicHandlers, trace: (s: string) => void): Promise<Mic> {
    const ctx = audioContext()
    let mic: Mic | null = null
    let frames = 0
    let peak = 0
    const vad = new EnergyVad(ctx, stream, {
      onFrame: (pcm, level) => {
        peak = Math.max(peak, level)
        // Le pic dit si l'on a entendu quelqu'un : un micro qui ne transmet qu'un souffle reste vers 0,01.
        if (++frames === 1 || frames % 300 === 100) trace(`trame ${frames} (volume ${level.toFixed(2)}, pic ${peak.toFixed(3)}, contexte ${ctx.state})`)
        mic?.pushRing(pcm)
        handlers.onLevel(level)
        handlers.onFrame(pcm)
      },
      onSpeechStart: () => {
        trace('parole détectée (volume)')
        handlers.onSpeechStart(mic?.takeRing() ?? [])
      },
      onSpeechConfirmed: () => handlers.onSpeechConfirmed(),
      onSpeechEnd: () => {
        trace('fin de phrase (volume)')
        handlers.onSpeechEnd()
      },
      onMisfire: () => {
        trace('fausse alerte (bruit trop court)')
        handlers.onMisfire()
      }
    })
    const engine: Engine = { name: 'volume', setSpeaking: (s) => vad.detector.setStrict(s), close: async () => vad.close() }
    return Mic.ready(engine, stream, () => frames, trace, (m) => (mic = m))
  }

  private static async ready(engine: Engine, stream: MediaStream, frames: () => number, trace: (s: string) => void, bind: (m: Mic) => void): Promise<Mic> {
    trace(`moteur prêt (${engine.name})`)
    const mic = new Mic(stream)
    mic.engine = engine
    bind(mic)
    const micContext = existingAudioContext()
    await wake(micContext, trace)
    // Aucune trame au bout de 2 s : l'audio est resté en pause (iPhone). On le signale au journal.
    setTimeout(() => frames() === 0 && trace(`aucune trame après 2 s (contexte ${micContext?.state ?? '?'}, piste ${stream.getAudioTracks()[0]?.readyState})`), 2000)
    return mic
  }

  /** Plus exigeant pendant que CODE parle. */
  setCodeSpeaking(speaking: boolean): void {
    this.engine?.setSpeaking(speaking)
  }

  async close(): Promise<void> {
    await this.engine?.close()
    for (const t of this.stream.getTracks()) t.stop()
  }

  private pushRing(pcm: ArrayBuffer): void {
    this.ring.push(pcm)
    if (this.ring.length > PAD_FRAMES) this.ring.shift()
  }

  private takeRing(): ArrayBuffer[] {
    const out = this.ring
    this.ring = []
    return out
  }
}
