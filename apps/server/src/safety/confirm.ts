import { randomUUID } from 'node:crypto'
import type { ConfirmOutcome, ConfirmRequest } from '@code/protocol'

/**
 * Porte de validation des actions sensibles (docs/SPEC.md, 6.2).
 *
 * La décision est prise ici, par une règle fixe : Claude propose une action,
 * il ne décide jamais si la réponse vaut un « oui ».
 */

/** Minuscules, sans accents, sans ponctuation, espaces simples. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const LEADING = /^(?:(?:euh|heu|bon|bah|ben|alors|allez|code|hum|hmm)\s+)+/
const TRAILING = /(?:\s+(?:merci|merci beaucoup|s il te plait|s il vous plait|stp|svp|code))+$/

/** « euh oui merci » → « oui » : on ne garde que le cœur de la réponse. */
export function trimCourtesy(n: string): string {
  return n.replace(LEADING, '').replace(TRAILING, '').trim()
}

/** Refus explicites : l'action est annulée, sans autre suite. */
const REFUSALS = new Set(['non', 'non merci', 'annule', 'annuler', 'annule tout', 'stop', 'arrete', 'laisse tomber', 'pas maintenant', 'non annule', 'n envoie pas', 'ne l envoie pas', 'attends', 'non attends', 'oublie', 'oublie ca'])

export type ConfirmGateOptions = {
  timeoutMs: number
  acceptPhrases: string[]
  onResult: (req: ConfirmRequest, outcome: ConfirmOutcome, via: 'voix' | 'bouton' | 'delai' | 'systeme') => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

type Pending = { req: ConfirmRequest; timer: unknown; execute: () => Promise<void> | void }

export class ConfirmGate {
  private current: Pending | null = null
  private readonly accept: Set<string>
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly opts: ConfirmGateOptions) {
    this.accept = new Set(opts.acceptPhrases.map(normalize))
    this.now = opts.now ?? Date.now
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout))
  }

  get pending(): ConfirmRequest | null {
    return this.current?.req ?? null
  }

  /**
   * Met une action en attente. Une seule à la fois : la précédente est annulée.
   * `execute` ne s'exécute que sur un accord explicite.
   */
  request(title: string, summary: string, execute: () => Promise<void> | void): ConfirmRequest {
    this.resolve('annule', 'systeme')
    const req: ConfirmRequest = {
      actionId: randomUUID(),
      title,
      summary,
      expiresAt: this.now() + this.opts.timeoutMs
    }
    const timer = this.setTimer(() => this.resolve('expire', 'delai'), this.opts.timeoutMs)
    this.current = { req, timer, execute }
    return req
  }

  /**
   * Une phrase de la liste vaut accord, une fois retirés les mots d'appui du début (« euh », « bon »,
   * « alors ») et les politesses de la fin (« merci », « s'il te plaît ») ; tout le reste annule.
   */
  isAcceptance(transcript: string): boolean {
    return this.accept.has(trimCourtesy(normalize(transcript)))
  }

  /**
   * Ce que vaut une réponse pendant une validation : un accord, un refus (« non », « annule »), ou
   * autre chose (« dis-lui plutôt que… ») : l'action est alors annulée et la phrase traitée comme une demande.
   */
  classify(transcript: string): 'accord' | 'refus' | 'autre' {
    if (this.isAcceptance(transcript)) return 'accord'
    const n = trimCourtesy(normalize(transcript))
    return !n || REFUSALS.has(n) || n.split(' ').length < 3 ? 'refus' : 'autre'
  }

  answerVoice(transcript: string): ConfirmOutcome | null {
    if (!this.current) return null
    return this.resolve(this.isAcceptance(transcript) ? 'valide' : 'annule', 'voix')
  }

  /** Réponse par bouton : l'identifiant doit correspondre à l'action en attente. */
  answerButton(actionId: string, accepted: boolean): ConfirmOutcome | null {
    if (!this.current || this.current.req.actionId !== actionId) return null
    return this.resolve(accepted ? 'valide' : 'annule', 'bouton')
  }

  /** Annule l'action en attente (arrêt d'urgence, déconnexion…). */
  cancel(): void {
    this.resolve('annule', 'systeme')
  }

  private resolve(outcome: ConfirmOutcome, via: 'voix' | 'bouton' | 'delai' | 'systeme'): ConfirmOutcome | null {
    const p = this.current
    if (!p) return null
    this.current = null
    this.clearTimer(p.timer)
    if (outcome === 'valide' && this.now() > p.req.expiresAt) outcome = 'expire'
    this.opts.onResult(p.req, outcome, via)
    if (outcome === 'valide') void p.execute()
    return outcome
  }
}
