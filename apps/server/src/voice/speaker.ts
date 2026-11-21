import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { MIC_SAMPLE_RATE } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { db } from '../db.ts'
import { speakerModelPath } from '../paths.ts'
import { decrypt, encrypt } from '../users/crypto.ts'

export type SpeakerStatus = { available: boolean; enrolled: boolean; enabled: boolean; appareils: string[] }
export type Verdict = { accepted: boolean; score: number | null; reason: 'reconnu' | 'confiance' | 'inconnu' | 'desactive' }

// Empreinte de la voix de chaque utilisateur, chiffrée comme ses clés (c'est une donnée biométrique).
db.exec(`
  CREATE TABLE IF NOT EXISTS empreintes_vocales (
    utilisateur_id INTEGER PRIMARY KEY REFERENCES utilisateurs(id),
    profil TEXT NOT NULL,
    maj INTEGER NOT NULL
  );
`)

const q = {
  get: db.prepare('SELECT profil FROM empreintes_vocales WHERE utilisateur_id = ?'),
  set: db.prepare('INSERT INTO empreintes_vocales (utilisateur_id, profil, maj) VALUES (?, ?, ?) ON CONFLICT (utilisateur_id) DO UPDATE SET profil = excluded.profil, maj = excluded.maj'),
  remove: db.prepare('DELETE FROM empreintes_vocales WHERE utilisateur_id = ?')
}

const contexte = (uid: number) => `voix:${uid}`
/**
 * Une empreinte par appareil (« mac », « mobile ») : chaque micro, chaque lieu rend la voix différemment. Le nom
 * porte le modèle : les empreintes d'un autre modèle (« titanet-appareils: », « titanet: », du small) ne se
 * comparent pas et sont à réenregistrer.
 */
const FORMAT = 'titanet-large-appareils:'

type Profiles = Map<string, Float32Array>

const toBase64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
function fromBase64(text: string): Float32Array {
  const bytes = Buffer.from(text, 'base64')
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function saveProfiles(uid: number, profiles: Profiles): void {
  if (!profiles.size) return void q.remove.run(uid)
  const json = JSON.stringify(Object.fromEntries([...profiles].map(([device, v]) => [device, toBase64(v)])))
  q.set.run(uid, encrypt(FORMAT + json, contexte(uid)), Date.now())
}

function loadProfiles(uid: number): Profiles {
  const row = q.get.get(uid) as { profil: string } | undefined
  if (!row) return new Map()
  try {
    const plain = decrypt(row.profil, contexte(uid))
    if (plain.startsWith(FORMAT)) {
      return new Map(Object.entries(JSON.parse(plain.slice(FORMAT.length)) as Record<string, string>).map(([d, b]) => [d, fromBase64(b)]))
    }
    console.warn(`[voix] Empreinte de l’utilisateur ${uid} faite avec un autre modèle : à réenregistrer.`)
  } catch {
    console.warn(`[voix] Empreinte de l’utilisateur ${uid} illisible : à réenregistrer.`)
  }
  return new Map()
}

// ── Moteur (sherpa-onnx, modèle TitaNet large, sur le serveur) ──

type Stream = { acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void; inputFinished(): void }
type Extractor = { createStream(): Stream; compute(s: Stream, external?: boolean): Float32Array }

let engine: Extractor | null | undefined

/** Chargé au premier besoin, partagé par tous ; `null` si le modèle ou le module manque (CODE écoute alors tout le monde). */
function extractor(): Extractor | null {
  if (engine !== undefined) return engine
  try {
    if (!existsSync(speakerModelPath)) throw new Error('modèle absent (« node scripts/modele-voix.mjs »)')
    const { SpeakerEmbeddingExtractor } = createRequire(import.meta.url)('sherpa-onnx-node')
    engine = new SpeakerEmbeddingExtractor({ model: speakerModelPath, numThreads: 1, debug: false }) as Extractor
  } catch (err) {
    console.warn(`[voix] Reconnaissance de la voix indisponible : ${(err as Error).message}`)
    engine = null
  }
  return engine
}

/** Empreinte d'un extrait (vecteur de norme 1 : la ressemblance de deux extraits est leur produit scalaire). */
function embed(samples: Float32Array): Float32Array | null {
  const ex = extractor()
  if (!ex) return null
  const stream = ex.createStream()
  stream.acceptWaveform({ samples, sampleRate: MIC_SAMPLE_RATE })
  stream.inputFinished()
  return normalize(Float32Array.from(ex.compute(stream, false)))
}

export function normalize(v: Float32Array): Float32Array {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  return v.map((x) => x / norm)
}

export function similarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i]! * b[i]!
  return dot
}

/** Tranches de 20 ms. */
const FRAME = MIC_SAMPLE_RATE / 50
/** Volume (RMS) au-dessus duquel une tranche compte comme de la parole. */
const VOICED_RMS = 0.015

/** Ne garde que les tranches où l'on parle : les silences d'une phrase brouillent l'empreinte. */
export function voiced(samples: Float32Array): Float32Array {
  const kept: Float32Array[] = []
  for (let start = 0; start + FRAME <= samples.length; start += FRAME) {
    const frame = samples.subarray(start, start + FRAME)
    let sum = 0
    for (const s of frame) sum += s * s
    if (Math.sqrt(sum / FRAME) >= VOICED_RMS) kept.push(frame)
  }
  const out = new Float32Array(kept.length * FRAME)
  kept.forEach((f, i) => out.set(f, i * FRAME))
  return out
}

/** Parole minimale pour juger une phrase (« oui » n'y suffit pas : voir la fenêtre de confiance). */
const MIN_VERIFY_SAMPLES = MIC_SAMPLE_RATE
/** Parole à recueillir pour l'empreinte (le texte à lire en donne largement plus). */
const ENROLL_SAMPLES = 20 * MIC_SAMPLE_RATE
/** L'empreinte est la moyenne d'extraits de cette longueur. */
const ENROLL_CHUNK = 4 * MIC_SAMPLE_RATE

/**
 * Identification du locuteur, entièrement sur le serveur (sherpa-onnx, sans clé ni service extérieur).
 * L'empreinte de la voix de l'utilisateur est enregistrée une fois ; chaque phrase y est comparée avant d'aller à Claude.
 */
/**
 * Le seuil d'une phrase jugée d'un bloc : celui de l'empreinte, un peu plus tolérant quand votre voix vient
 * d'être reconnue (la suite d'une conversation), jamais plus strict.
 */
export function seuilPhrase(depuisReconnuMs: number): number {
  const c = codeConfig.speaker
  return depuisReconnuMs < c.trustWindowMs ? Math.min(c.threshold, c.seuilRecent) : c.threshold
}

export class SpeakerGate {
  private profiles: Profiles
  private recording: Float32Array[] | null = null
  private recordingDevice = ''
  private recorded = 0
  private lastRecognized = 0

  constructor(private readonly uid: number) {
    this.profiles = loadProfiles(uid)
  }

  get status(): SpeakerStatus {
    return { available: extractor() !== null, enrolled: this.profiles.size > 0, enabled: this.active, appareils: [...this.profiles.keys()] }
  }

  private get active(): boolean {
    return codeConfig.speaker.enabled && this.profiles.size > 0 && extractor() !== null
  }

  /** Ressemblance à la plus proche des empreintes (celle de l'appareil, du lieu qui convient). */
  private resemblance(sample: Float32Array): number {
    return Math.max(...[...this.profiles.values()].map((p) => similarity(sample, p)))
  }

  /** Compare une phrase entière à l'empreinte. Sans empreinte enregistrée, tout passe. */
  verify(pcm: Buffer): Verdict {
    if (!this.active) return { accepted: true, score: null, reason: 'desactive' }
    const speech = voiced(toFloat(pcm))
    const sample = speech.length >= MIN_VERIFY_SAMPLES ? embed(speech) : null
    const score = sample ? Math.round(this.resemblance(sample) * 100) / 100 : null
    const now = Date.now()
    if (score !== null && score >= seuilPhrase(now - this.lastRecognized)) {
      this.lastRecognized = now
      return { accepted: true, score, reason: 'reconnu' }
    }
    // Phrase trop courte pour juger (« oui ») : acceptée si votre voix a été reconnue il y a peu.
    if (score === null && now - this.lastRecognized < codeConfig.speaker.trustWindowMs) {
      return { accepted: true, score, reason: 'confiance' }
    }
    return { accepted: false, score, reason: 'inconnu' }
  }

  // ── Enregistrement de l'empreinte ──

  /** `device` : l'appareil qui enregistre ; son empreinte remplace la précédente du même appareil. */
  startEnrollment(device: string): void {
    if (!extractor()) throw new Error('Reconnaissance de la voix indisponible sur ce serveur (modèle absent).')
    this.recording = []
    this.recordingDevice = device
    this.recorded = 0
  }

  get enrolling(): boolean {
    return this.recording !== null
  }

  /** Donne de l'audio à l'enregistrement ; renvoie le pourcentage atteint (parole recueillie, silences exclus). */
  enroll(pcm: Buffer): number {
    if (!this.recording) return 0
    const speech = voiced(toFloat(pcm))
    if (speech.length) {
      this.recording.push(speech)
      this.recorded += speech.length
    }
    return Math.min(100, Math.floor((this.recorded / ENROLL_SAMPLES) * 100))
  }

  /** Termine l'enregistrement et garde l'empreinte si elle est complète. */
  finishEnrollment(): { ok: boolean; percentage: number } {
    const recording = this.recording
    if (!recording) return { ok: false, percentage: 0 }
    try {
      const percentage = Math.min(100, Math.floor((this.recorded / ENROLL_SAMPLES) * 100))
      if (percentage < 100) return { ok: false, percentage }
      const all = new Float32Array(this.recorded)
      let offset = 0
      for (const part of recording) {
        all.set(part, offset)
        offset += part.length
      }
      // Moyenne des empreintes de chaque extrait : plus stable qu'une seule sur toute la lecture.
      let mean: Float32Array = new Float32Array(0)
      for (let start = 0; start + ENROLL_CHUNK <= all.length; start += ENROLL_CHUNK) {
        const e = embed(all.subarray(start, start + ENROLL_CHUNK))
        if (!e) return { ok: false, percentage }
        mean = mean.length ? mean.map((x, i) => x + e[i]!) : e
      }
      this.profiles.set(this.recordingDevice, normalize(mean))
      saveProfiles(this.uid, this.profiles)
      this.lastRecognized = Date.now()
      return { ok: true, percentage }
    } finally {
      this.cancelEnrollment()
    }
  }

  cancelEnrollment(): void {
    this.recording = null
    this.recorded = 0
  }

  /** Une empreinte est enregistrée et active : la phrase suit la voix (`SpeakerTurn`). */
  get tracking(): boolean {
    return this.active
  }

  /** Ressemblance d'une tranche à l'empreinte ; `null` si trop peu de parole pour juger. */
  scoreWindow(pcm: Buffer): number | null {
    if (!this.active) return null
    const speech = voiced(toFloat(pcm))
    if (speech.length < MIN_WINDOW_SAMPLES) return null
    const sample = embed(speech)
    return sample ? this.resemblance(sample) : null
  }

  /** Voix reconnue par le suivi de la phrase : ouvre la fenêtre de confiance des phrases courtes. */
  markRecognized(): void {
    this.lastRecognized = Date.now()
  }

  /** Oublie l'empreinte : CODE écoute de nouveau tout le monde. */
  reset(): void {
    this.profiles.clear()
    q.remove.run(this.uid)
  }
}

// ── Suivi de la voix pendant une phrase ──

/** Pas du suivi : 0,5 s d'audio (PCM 16 bits). */
const HOP_MS = 500
const HOP_BYTES = (MIC_SAMPLE_RATE * 2 * HOP_MS) / 1000
/** Chaque jugement porte sur les 3 derniers pas (1,5 s). */
const WINDOW_HOPS = 3
/** En dessous, la tranche a trop peu de parole pour être jugée. */
const MIN_WINDOW_SAMPLES = 0.6 * MIC_SAMPLE_RATE

export type TurnLimits = { windowThreshold: number; continueThreshold: number; endMs: number; endFiniMs: number; endMaxMs: number; giveUpMs: number; calledMaxMs: number }
/** Une voix un peu moins reconnue que le seuil (plus basse, une hésitation) : sans doute encore la vôtre. */
const PRES_DU_SEUIL = 0.1
/** `release` : audio de votre voix, à transcrire ; `end` : `fin` (vous avez fini), `autre` (jamais votre voix). */
export type TurnUpdate = { release: Buffer[]; end: 'fin' | 'autre' | null }

/**
 * Suit une phrase pas à pas : elle commence à votre voix (ce qui précède est oublié), finit quand votre voix
 * se tait, même si d'autres parlent encore, et ne garde que vos passages (et les courts silences entre eux).
 * Après un appel exprès (`called`), elle commence tout de suite : tout est gardé jusqu'à ce que votre voix
 * soit reconnue, puis le suivi reprend comme d'habitude.
 */
export class SpeakerTurn {
  started: boolean
  /** Votre voix a été reconnue au moins une fois dans la phrase. */
  heard = false
  private partial = Buffer.alloc(0)
  private window: Buffer[] = []
  /** Pas depuis votre dernière tranche reconnue, en attente : gardés si votre voix revient. */
  private held: Buffer[] = []
  /** Le score de chacun de ces pas : à la fin, ceux proches de votre voix sont transcrits aussi. */
  private heldScores: (number | null)[] = []
  private all: Buffer[] = []
  private others = 0
  private ended = false
  private scores: (number | null)[] = []

  constructor(
    private readonly score: (pcm: Buffer) => number | null,
    private readonly limits: TurnLimits = codeConfig.speaker.turn,
    readonly called = false,
    /**
     * Le sens de la phrase dite jusqu'ici : finie (`true`, la fin vient après `endFiniMs` de silence), inachevée
     * (`false`, elle attend jusqu'à `endMaxMs`) ou pas encore jugée (`null`, `endMs`).
     */
    private readonly sens: () => boolean | null = () => null
  ) {
    this.started = called
  }

  push(pcm: Buffer): TurnUpdate {
    const update: TurnUpdate = { release: [], end: null }
    if (this.ended) return update
    this.all.push(pcm)
    this.partial = Buffer.concat([this.partial, pcm])
    while (this.partial.length >= HOP_BYTES && !update.end) {
      const hop = this.partial.subarray(0, HOP_BYTES)
      this.partial = this.partial.subarray(HOP_BYTES)
      this.onHop(hop, update)
    }
    return update
  }

  /** Fin de la phrase côté appareil (silence) : le reste en attente, votre voix étant reconnue. */
  flush(): Buffer[] {
    this.ended = true
    if (!this.started) return []
    const rest = [...this.held, this.partial]
    this.held = []
    this.heldScores = []
    this.partial = Buffer.alloc(0)
    return rest
  }

  /** Scores des tranches, pour le journal (« · » : trop peu de parole pour juger). */
  summary(): string {
    const shown = this.scores.slice(-24).map((s) => (s === null ? '·' : s.toFixed(2))).join(' ')
    return `${this.scores.length > 24 ? '… ' : ''}${shown || 'aucune tranche'}`
  }

  /** Toute la phrase, pour juger d'un bloc une phrase trop courte pour le suivi (« oui »). */
  whole(): Buffer {
    return Buffer.concat(this.all)
  }

  private onHop(hop: Buffer, update: TurnUpdate): void {
    this.window.push(hop)
    if (this.window.length > WINDOW_HOPS) this.window.shift()
    const score = this.score(Buffer.concat(this.window))
    this.scores.push(score)
    // Plus exigeant pour commencer que pour continuer : une fois votre voix reconnue, le bruit la fait moins trébucher.
    const me = score !== null && score >= (this.started ? this.limits.continueThreshold : this.limits.windowThreshold)
    if (!this.started) {
      if (me) {
        this.started = this.heard = true
        update.release.push(...this.window)
      } else if (score !== null && ++this.others * HOP_MS >= this.limits.giveUpMs) {
        this.ended = true
        update.end = 'autre'
      }
      return
    }
    if (me) {
      this.heard = true
      update.release.push(...this.held, hop)
      this.held = []
      this.heldScores = []
      return
    }
    if (this.called && !this.heard) {
      // Appelé exprès, votre voix pas encore reconnue (le bruit) : tout est transcrit, dans une limite de durée.
      update.release.push(hop)
      if (this.scores.length * HOP_MS >= this.limits.calledMaxMs) {
        this.ended = true
        update.end = 'fin'
      }
      return
    }
    this.held.push(hop)
    this.heldScores.push(score)
    const wait = this.held.length * HOP_MS
    const sens = this.sens()
    const limite = sens === true ? this.limits.endFiniMs : sens === false ? this.limits.endMaxMs : this.limits.endMs
    if (wait >= limite) {
      // Le premier pas en attente porte souvent vos dernières syllabes ; les pas proches de votre voix aussi.
      const proche = this.limits.continueThreshold - PRES_DU_SEUIL
      update.release.push(...this.held.filter((_, i) => i === 0 || (this.heldScores[i] ?? -1) >= proche))
      this.held = []
      this.heldScores = []
      this.ended = true
      update.end = 'fin'
    }
  }
}

/** PCM 16 bits (petit-boutiste) → échantillons entre -1 et 1. */
function toFloat(pcm: Buffer): Float32Array {
  const out = new Float32Array(Math.floor(pcm.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = pcm.readInt16LE(i * 2) / 0x8000
  return out
}
