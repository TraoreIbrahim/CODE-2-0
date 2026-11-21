import { phraseInachevee } from '@code/protocol'

/** Pause stable (la transcription ne bouge plus) avant de demander le sens : pas d'appel à chaque mot. */
const STABLE_MS = 250

/**
 * Le sens de la phrase en cours : finie, ou au milieu. Pendant une pause, la transcription partielle est
 * relue par le modèle rapide (« fini » ou « suite ») ; les fins évidemment inachevées (« … parce que »,
 * « euh ») sont jugées sans lui. CODE ne coupe donc plus sur un silence, mais quand la demande est complète.
 */
export class SensDuTour {
  private texte = ''
  private verdicts = new Map<string, boolean>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private controller: AbortController | null = null

  constructor(
    /** `true` : demande complète ; `false` : il est au milieu ; `null` : pas de réponse (erreur, délai). */
    private readonly juger: (texte: string, signal: AbortSignal) => Promise<boolean | null>,
    /** Un verdict pour le texte courant, à transmettre à l'appareil. */
    private readonly onVerdict: (texte: string, fini: boolean) => void = () => {}
  ) {}

  /** Nouvelle transcription partielle : son sens sera demandé si elle ne bouge plus. */
  observer(texte: string): void {
    this.texte = texte.trim()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const connu = this.verdict()
    if (!this.texte || connu !== null) {
      if (connu !== null) this.onVerdict(this.texte, connu)
      return
    }
    this.timer = setTimeout(() => void this.demander(this.texte), STABLE_MS)
  }

  /** Le sens du texte courant : `null` tant qu'il n'est pas jugé. */
  verdict(): boolean | null {
    if (!this.texte) return null
    if (phraseInachevee(this.texte)) return false
    return this.verdicts.get(this.texte) ?? null
  }

  /** Nouvelle phrase : on oublie la précédente. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.controller?.abort()
    this.controller = null
    this.texte = ''
    this.verdicts.clear()
  }

  private async demander(texte: string): Promise<void> {
    this.timer = null
    this.controller?.abort()
    const controller = (this.controller = new AbortController())
    const fini = await this.juger(texte, controller.signal).catch(() => null)
    if (controller.signal.aborted || fini === null) return
    this.verdicts.set(texte, fini)
    if (texte === this.texte) this.onVerdict(texte, fini)
  }
}
