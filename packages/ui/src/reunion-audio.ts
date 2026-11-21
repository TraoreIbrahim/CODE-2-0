import { MIC_SAMPLE_RATE } from '@code/protocol'
import { audioContext } from './audio.ts'

/**
 * L'audio d'une réunion, côté appareil : ramené à 16 kHz mono, puis découpé en morceaux que le serveur
 * transcrit un par un. On coupe à une pause (personne ne parle) dès que le morceau a sa durée cible, pour
 * ne pas trancher un mot ; d'office à la durée la plus longue. Chaque morceau part en WAV : tous les
 * services de transcription le lisent, et le serveur n'a rien à décoder.
 */

export type Morceau = { rang: number; debutS: number; dureeS: number; pcm: Int16Array }

/** Fenêtre d'écoute des pauses : 100 ms. */
const FENETRE = MIC_SAMPLE_RATE / 10
/** En dessous, la fenêtre est du silence (voix normale : 0,03 à 0,3). */
const SEUIL_SILENCE = 0.008
/** Trois fenêtres calmes de suite (300 ms) : une pause. */
const PAUSE_FENETRES = 3

export class Decoupeur {
  private blocs: Int16Array[] = []
  private longueur = 0
  private rang = 0
  private debut = 0
  /** Énergie de la fenêtre en cours, et fenêtres calmes de suite. */
  private somme = 0
  private dansFenetre = 0
  private calmes = 0
  /** Le plus fort entendu dans le morceau : un morceau entièrement silencieux n'est pas envoyé. */
  private crete = 0

  constructor(
    private readonly cibleS: number,
    private readonly maxS: number,
    private readonly sortie: (m: Morceau) => void
  ) {}

  /** Secondes d'audio reçues depuis le début. */
  get dureeS(): number {
    return (this.debut + this.longueur) / MIC_SAMPLE_RATE
  }

  /** Des échantillons à 16 kHz, entre -1 et 1. */
  ajouter(samples: Float32Array): void {
    let depuis = 0
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] ?? 0
      this.somme += v * v
      if (++this.dansFenetre < FENETRE) continue
      const rms = Math.sqrt(this.somme / FENETRE)
      this.crete = Math.max(this.crete, rms)
      this.calmes = rms < SEUIL_SILENCE ? this.calmes + 1 : 0
      this.somme = 0
      this.dansFenetre = 0
      const ici = this.longueur + (i + 1 - depuis)
      if ((ici >= this.cibleS * MIC_SAMPLE_RATE && this.calmes >= PAUSE_FENETRES) || ici >= this.maxS * MIC_SAMPLE_RATE) {
        this.garder(samples.subarray(depuis, i + 1))
        this.couper()
        depuis = i + 1
      }
    }
    if (depuis < samples.length) this.garder(samples.subarray(depuis))
  }

  private garder(samples: Float32Array): void {
    const pcm = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i] ?? 0))
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    this.blocs.push(pcm)
    this.longueur += pcm.length
  }

  private couper(): void {
    if (!this.longueur) return
    const pcm = new Int16Array(this.longueur)
    let o = 0
    for (const b of this.blocs) {
      pcm.set(b, o)
      o += b.length
    }
    const m: Morceau = { rang: this.rang, debutS: this.debut / MIC_SAMPLE_RATE, dureeS: this.longueur / MIC_SAMPLE_RATE, pcm }
    const audible = this.crete >= SEUIL_SILENCE
    this.debut += this.longueur
    this.blocs = []
    this.longueur = 0
    this.crete = 0
    this.calmes = 0
    // Un silence complet (pause, micro coupé) : rien à transcrire, et rien à payer.
    if (!audible) return
    this.rang++
    this.sortie(m)
  }

  /** La fin : ce qui reste part, s'il dure au moins une demi-seconde. */
  finir(): void {
    if (this.dansFenetre) this.crete = Math.max(this.crete, Math.sqrt(this.somme / this.dansFenetre))
    if (this.longueur >= MIC_SAMPLE_RATE / 2) this.couper()
    this.blocs = []
    this.longueur = 0
  }
}

/** Ramène un flux à 16 kHz en moyennant les échantillons de chaque pas (filtre simple contre le repliement). */
export class Reechantillonneur {
  private pos = 0
  private somme = 0
  private n = 0
  private readonly pas: number

  constructor(frequence: number) {
    this.pas = frequence / MIC_SAMPLE_RATE
  }

  passer(entree: Float32Array): Float32Array {
    if (this.pas === 1) return entree
    const sortie = new Float32Array(Math.ceil((entree.length + this.pos) / this.pas) + 1)
    let k = 0
    for (let i = 0; i < entree.length; i++) {
      this.somme += entree[i] ?? 0
      this.n++
      if (++this.pos >= this.pas) {
        sortie[k++] = this.somme / this.n
        this.pos -= this.pas
        this.somme = 0
        this.n = 0
      }
    }
    return sortie.subarray(0, k)
  }
}

/** Un morceau en fichier WAV (PCM 16 bits, mono, 16 kHz). */
export function wavDe(pcm: Int16Array): Blob {
  const octets = pcm.length * 2
  const tampon = new ArrayBuffer(44 + octets)
  const h = new DataView(tampon)
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  h.setUint32(4, 36 + octets, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  h.setUint32(16, 16, true)
  h.setUint16(20, 1, true)
  h.setUint16(22, 1, true)
  h.setUint32(24, MIC_SAMPLE_RATE, true)
  h.setUint32(28, MIC_SAMPLE_RATE * 2, true)
  h.setUint16(32, 2, true)
  h.setUint16(34, 16, true)
  ascii(36, 'data')
  h.setUint32(40, octets, true)
  for (let i = 0; i < pcm.length; i++) h.setInt16(44 + i * 2, pcm[i] ?? 0, true)
  return new Blob([tampon], { type: 'audio/wav' })
}

/** Les types de fichiers audio qu'on sait importer (ce que le navigateur sait décoder). */
export function estAudio(f: { name: string; type: string }): boolean {
  return f.type.startsWith('audio/') || f.type === 'video/mp4' || f.type === 'video/webm' || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4|caf|aiff?)$/i.test(f.name)
}

/**
 * Décode un fichier audio et le passe au découpeur. Le navigateur décode tout le fichier en mémoire : une
 * heure pèse quelques centaines de Mo, d'où la limite de taille par appareil.
 */
export async function decouperFichier(f: Blob, decoupeur: Decoupeur, dureeMaxS: number): Promise<void> {
  const Hors = globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!Hors) throw new Error('Cet appareil ne sait pas lire les fichiers audio : importez-le depuis l’ordinateur.')
  let audio: AudioBuffer
  try {
    // Un contexte à 16 kHz : le décodage rend directement la bonne fréquence.
    audio = await new Hors(1, 1, MIC_SAMPLE_RATE).decodeAudioData(await f.arrayBuffer())
  } catch {
    throw new Error('Ce fichier n’a pas pu être lu : essayez un MP3, un M4A ou un WAV.')
  }
  if (audio.duration > dureeMaxS) throw new Error(`Enregistrement trop long : ${Math.round(dureeMaxS / 3600)} heures au plus.`)
  const reech = new Reechantillonneur(audio.sampleRate)
  const canaux = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  const BLOC = audio.sampleRate * 10
  for (let o = 0; o < audio.length; o += BLOC) {
    const n = Math.min(BLOC, audio.length - o)
    const mono = new Float32Array(n)
    for (const c of canaux) for (let i = 0; i < n; i++) mono[i]! += (c[o + i] ?? 0) / canaux.length
    decoupeur.ajouter(reech.passer(mono))
    // Rend la main à l'écran entre deux blocs.
    await new Promise((ok) => setTimeout(ok, 0))
  }
  decoupeur.finir()
}

/**
 * Le micro d'une réunion : son propre flux (sans annulation d'écho : personne ne parle par le haut-parleur),
 * ramené à 16 kHz et passé au découpeur. `niveau` : le volume du moment, pour le témoin à l'écran.
 */
export class MicroReunion {
  niveau = 0
  /** Le son de l'ordinateur est capté aussi (les personnes en visio) ; faux : le micro seul. */
  sonSysteme = false
  /** Appelé si le son de l'ordinateur se coupe en cours d'enregistrement (autorisation retirée, périphérique changé). */
  surPerteSonSysteme: (() => void) | null = null
  private fluxSysteme: MediaStream | null = null
  private constructor(
    private readonly flux: MediaStream,
    private readonly noeuds: AudioNode[],
    private readonly decoupeur: Decoupeur,
    private verrou: { release(): Promise<void> } | null
  ) {}

  /**
   * `sonSysteme` : donne le son de l'ordinateur (app de bureau), ou null s'il n'est pas disponible.
   * `coupe` : vrai tant que rien ne doit être capté (pause, assistant qui parle ou qu'on interroge). Du silence
   * prend alors la place du son : les instants de la réunion restent justes, et le silence n'est pas transcrit.
   */
  static async ouvrir(decoupeur: Decoupeur, sonSysteme?: () => Promise<MediaStream | null>, coupe?: () => boolean): Promise<MicroReunion> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Cet appareil ne donne pas accès au micro.')
    let flux: MediaStream
    try {
      flux = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
    } catch (err) {
      throw new Error((err as Error).name === 'NotAllowedError' ? 'Micro refusé : autorisez-le pour enregistrer.' : 'Le micro n’a pas pu s’ouvrir.')
    }
    // Le contexte audio de l'app (un second, à une autre fréquence, hache la voix sur iPhone).
    const ctx = audioContext()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const source = ctx.createMediaStreamSource(flux)
    // ScriptProcessor : déprécié, mais fiable partout, y compris Safari sur iPhone.
    const node = ctx.createScriptProcessor(4096, 1, 1)
    const muet = ctx.createGain()
    muet.gain.value = 0
    const reech = new Reechantillonneur(ctx.sampleRate)
    // L'écran reste allumé : verrouillé, un téléphone coupe le micro d'une web app.
    const verrou = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').catch(() => null)
    const mic = new MicroReunion(flux, [source, node, muet], decoupeur, verrou ?? null)
    node.onaudioprocess = (e) => {
      const entree = e.inputBuffer.getChannelData(0)
      if (coupe?.()) {
        mic.niveau = 0
        return decoupeur.ajouter(reech.passer(new Float32Array(entree.length)))
      }
      let somme = 0
      for (let i = 0; i < entree.length; i++) somme += (entree[i] ?? 0) ** 2
      mic.niveau = Math.min(1, Math.sqrt(somme / entree.length) * 6)
      decoupeur.ajouter(reech.passer(entree))
    }
    source.connect(node)
    node.connect(muet)
    muet.connect(ctx.destination)
    // Le son de l'ordinateur, mêlé au micro (les entrées d'un même nœud s'additionnent).
    const systeme = await sonSysteme?.().catch(() => null)
    const piste = systeme?.getAudioTracks().find((t) => t.readyState === 'live')
    if (systeme && piste) {
      const sourceSysteme = ctx.createMediaStreamSource(new MediaStream([piste]))
      sourceSysteme.connect(node)
      mic.noeuds.push(sourceSysteme)
      mic.fluxSysteme = systeme
      mic.sonSysteme = true
      piste.addEventListener('ended', () => {
        mic.sonSysteme = false
        mic.surPerteSonSysteme?.()
      })
    } else for (const t of systeme?.getTracks() ?? []) t.stop()
    return mic
  }

  /** Arrête le micro ; `garder` : le dernier morceau part (sinon tout est jeté). */
  fermer(garder: boolean): void {
    ;(this.noeuds[1] as ScriptProcessorNode).onaudioprocess = null
    for (const n of this.noeuds) n.disconnect()
    for (const t of this.flux.getTracks()) t.stop()
    for (const t of this.fluxSysteme?.getTracks() ?? []) t.stop()
    this.fluxSysteme = null
    void this.verrou?.release().catch(() => {})
    this.verrou = null
    this.niveau = 0
    if (garder) this.decoupeur.finir()
  }
}
