import { floatToPcm16 } from '@code/protocol'

/**
 * Détection de parole par le volume, sans WebAssembly : le repli quand le moteur
 * Silero ne démarre pas (Safari sur iPhone, sans isolement cross-origin).
 * Trames de 512 échantillons à 16 kHz (32 ms), comme Silero, pour le même flux vers le serveur.
 */

export type EnergyCallbacks = {
  onFrame: (pcm: ArrayBuffer, level: number) => void
  onSpeechStart: () => void
  onSpeechConfirmed: () => void
  onSpeechEnd: () => void
  onMisfire: () => void
}

const RATE = 16_000
const FRAME = 512
const START_FRAMES = 3 // ≈ 100 ms au-dessus du seuil pour commencer
const CONFIRM_FRAMES = 8 // ≈ 250 ms de parole pour confirmer (et interrompre CODE)
const END_FRAMES = 47 // ≈ 1,5 s de silence pour finir la phrase (une pause de réflexion ne la coupe pas)

/** Machine à états de la détection, séparée de l'audio pour être testée seule. */
export class EnergyDetector {
  private floor = 0.004
  private above = 0
  private below = 0
  private voiced = 0
  private inSpeech = false
  private strict = false

  constructor(private readonly cb: Omit<EnergyCallbacks, 'onFrame'>) {}

  /** Plus exigeant pendant que CODE parle, pour ne pas se déclencher sur un reste d'écho. */
  setStrict(strict: boolean): void {
    this.strict = strict
  }

  /** Une trame : son volume RMS (0..1). */
  push(rms: number): void {
    const k = this.strict ? 2.2 : 1
    const start = Math.max(0.012, this.floor * 3.2) * k
    const stop = Math.max(0.008, this.floor * 2) * k
    if (!this.inSpeech) {
      // Bruit de fond suivi lentement, seulement hors parole.
      this.floor = this.floor * 0.97 + Math.min(rms, 0.05) * 0.03
      this.above = rms > start ? this.above + 1 : 0
      if (this.above >= START_FRAMES) {
        this.inSpeech = true
        this.voiced = this.above
        this.below = 0
        this.cb.onSpeechStart()
      }
      return
    }
    if (rms > stop) {
      this.below = 0
      if (++this.voiced === CONFIRM_FRAMES) this.cb.onSpeechConfirmed()
      return
    }
    if (++this.below >= END_FRAMES) {
      const confirmed = this.voiced >= CONFIRM_FRAMES
      this.inSpeech = false
      this.above = 0
      this.voiced = 0
      if (confirmed) this.cb.onSpeechEnd()
      else this.cb.onMisfire()
    }
  }
}

/** Capture du micro, passage à 16 kHz et découpage en trames de 32 ms. */
export class EnergyVad {
  private source: MediaStreamAudioSourceNode
  private node: ScriptProcessorNode
  private sink: GainNode
  private pending: number[] = []
  private pos = 0
  readonly detector: EnergyDetector

  constructor(ctx: AudioContext, stream: MediaStream, private readonly cb: EnergyCallbacks) {
    this.detector = new EnergyDetector(cb)
    this.source = ctx.createMediaStreamSource(stream)
    // ScriptProcessor : déprécié, mais fiable partout, y compris Safari sur iPhone.
    this.node = ctx.createScriptProcessor(2048, 1, 1)
    // Sortie muette : le nœud doit être relié à la destination pour tourner, sans rien jouer.
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    const step = ctx.sampleRate / RATE
    this.node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)
      // Rééchantillonnage simple (interpolation linéaire) vers 16 kHz.
      for (; this.pos < input.length - 1; this.pos += step) {
        const i = Math.floor(this.pos)
        const f = this.pos - i
        this.pending.push((input[i] ?? 0) * (1 - f) + (input[i + 1] ?? 0) * f)
      }
      this.pos -= input.length
      while (this.pending.length >= FRAME) this.emit(Float32Array.from(this.pending.splice(0, FRAME)))
    }
    this.source.connect(this.node)
    this.node.connect(this.sink)
    this.sink.connect(ctx.destination)
  }

  private emit(frame: Float32Array): void {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += (frame[i] ?? 0) ** 2
    const rms = Math.sqrt(sum / frame.length)
    this.cb.onFrame(floatToPcm16(frame), Math.min(1, rms * 6))
    this.detector.push(rms)
  }

  close(): void {
    this.node.onaudioprocess = null
    this.source.disconnect()
    this.node.disconnect()
    this.sink.disconnect()
  }
}
