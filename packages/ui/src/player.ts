import { LEVEL_STEP_MS, VOICE_SAMPLE_RATE, pcm16ToFloat } from '@code/protocol'
import { audioContext } from './audio.ts'

/** Avance prise sur le premier morceau d'une phrase, pour absorber les retards du réseau (Tailscale, Wi-Fi). */
const JITTER_LEAD_S = 0.25

type Scheduled = { source: AudioBufferSourceNode; start: number; end: number; levels: number[] }

/** Joue la voix de CODE sans trou entre les morceaux, et expose son volume pour l'orbe. */
export class Player {
  private ctx: AudioContext | null = null
  private queue: Scheduled[] = []
  private nextStart = 0
  private idleListeners = new Set<() => void>()

  /** À appeler pendant un geste de l'utilisateur (exigence de Safari et Chrome). */
  async unlock(): Promise<void> {
    this.ctx ??= audioContext()
    // Sans attendre indéfiniment : sur iPhone, resume() peut rester en suspens.
    if (this.ctx.state === 'suspended') await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 800))])
  }

  get playing(): boolean {
    return this.queue.length > 0
  }

  onIdle(fn: () => void): () => void {
    this.idleListeners.add(fn)
    return () => this.idleListeners.delete(fn)
  }

  enqueue(pcm: ArrayBuffer, levels: number[]): void {
    const ctx = (this.ctx ??= audioContext())
    const samples = pcm16ToFloat(pcm)
    if (samples.length === 0) return
    const buffer = ctx.createBuffer(1, samples.length, VOICE_SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    // Réserve au début de chaque phrase (et après un trou) : les morceaux arrivent par le réseau,
    // parfois en retard ; sans réserve, chaque retard s'entendait comme une coupure.
    const late = this.nextStart < ctx.currentTime + 0.02
    const start = late ? ctx.currentTime + JITTER_LEAD_S : this.nextStart
    const item: Scheduled = { source, start, end: start + buffer.duration, levels }
    this.nextStart = item.end
    this.queue.push(item)
    source.onended = () => {
      this.queue = this.queue.filter((q) => q !== item)
      if (this.queue.length === 0) for (const fn of this.idleListeners) fn()
    }
    source.start(start)
  }

  /** Coupe net (interruption). */
  stop(): void {
    const items = this.queue
    this.queue = []
    this.nextStart = 0
    for (const q of items) {
      q.source.onended = null
      try {
        q.source.stop()
      } catch {}
    }
    if (items.length) for (const fn of this.idleListeners) fn()
  }

  /** Volume (0..1) de ce qui est joué en ce moment, ou -1 si rien ne joue. */
  level(): number {
    const ctx = this.ctx
    if (!ctx || this.queue.length === 0) return -1
    const now = ctx.currentTime
    const current = this.queue.find((q) => now >= q.start && now < q.end)
    if (!current) return 0
    const i = Math.floor(((now - current.start) * 1000) / LEVEL_STEP_MS)
    return current.levels[Math.min(i, current.levels.length - 1)] ?? 0
  }
}
