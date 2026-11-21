/**
 * Les panneaux d'un tour n'apparaissent qu'au moment où CODE en parle. Claude place `[[voir:outil]]` devant la
 * phrase qui commente un résultat ; le panneau de cet outil se montre quand cette phrase commence à se dire
 * (ou à s'écrire). Sans marque, tout s'affiche à la fin de sa réflexion, comme avant.
 */
import type { UiView } from '@code/protocol'

const MARK = /\[\[voir(?::([^\]\n]{0,60}))?\]\]/g
const OPENING = '[[voir'

/** Ce qui, en fin de texte, pourrait être le début d'une marque : à garder jusqu'au morceau suivant. */
function heldFrom(text: string): number {
  for (let i = Math.max(0, text.length - 70); i < text.length; i++) {
    if (text[i] !== '[') continue
    const rest = text.slice(i)
    if (OPENING.startsWith(rest) || /^\[\[voir(:[^\]\n]*)?\]?$/.test(rest)) return i
  }
  return text.length
}

/** Retire les marques du texte qui arrive par morceaux (une marque peut être coupée entre deux morceaux). */
export class MarkStripper {
  private held = ''
  /** Claude a placé au moins une marque : les panneaux attendent leur phrase. */
  seen = false

  push(delta: string): string {
    const joined = this.held + delta
    const text = joined.replace(MARK, '')
    if (text !== joined) this.seen = true
    const cut = heldFrom(text)
    this.held = text.slice(cut)
    return text.slice(0, cut)
  }

  flush(): string {
    const rest = this.held
    this.held = ''
    return rest
  }
}

/** Les marques d'une phrase complète, et la phrase sans elles. */
export function takeMarks(sentence: string): { text: string; names: string[] } {
  const names = [...sentence.matchAll(MARK)].map((m) => (m[1] ?? '').trim())
  return { text: names.length ? sentence.replace(MARK, ' ').replace(/\s+/g, ' ').trim() : sentence, names }
}

/** Les phrases passent par le nettoyage de la voix, qui retire les « _ » des noms d'outils. */
const same = (a: string, b: string) => a.replace(/[^a-z0-9]/gi, '').toLowerCase() === b.replace(/[^a-z0-9]/gi, '').toLowerCase()

type Panel = { name: string; view: UiView; shown: boolean; planned: boolean }

/** Le temps de lire une phrase à l'écran (≈ 20 caractères par seconde), entre 0,9 et 6 secondes. */
export function readingMs(sentence: string): number {
  return Math.min(6000, Math.max(900, sentence.trim().length * 50))
}

export class TurnPanels {
  private list: Panel[] = []
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(private readonly send: (view: UiView) => void) {}

  /** Nouvel état d'une vue (chargement, prête, erreur) : envoyée masquée tant que CODE n'en a pas parlé. */
  update(name: string, view: UiView): void {
    let p = this.list.find((x) => x.view.id === view.id)
    if (p) p.view = view
    else this.list.push((p = { name, view, shown: false, planned: false }))
    this.send(p.shown ? view : { ...view, masque: true })
  }

  /**
   * `[[voir:nom]]` : le premier panneau encore caché de cet outil, dans `delayMs` (le temps que la phrase
   * commence à se dire). Un nom inconnu montre le premier panneau caché : l'ordre des appels suit souvent celui
   * de la réponse.
   */
  reveal(name: string, delayMs = 0): void {
    const waiting = this.list.filter((x) => !x.shown && !x.planned)
    const p = waiting.find((x) => same(x.name, name)) ?? waiting[0]
    if (!p) return
    p.planned = true
    if (delayMs <= 0) return this.show(p)
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.show(p)
    }, delayMs)
    this.timers.add(timer)
  }

  /** Tout ce qui reste caché s'affiche (réponse interrompue, ou tour suivant qui commence). */
  showAll(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    for (const p of this.list) this.show(p)
  }

  /**
   * Fin de la réponse : ce dont CODE n'a pas parlé s'affiche dans `delayMs` (quand la lecture de la réponse
   * arrive au bout), les panneaux déjà prévus gardent leur moment.
   */
  finish(delayMs = 0): void {
    for (const p of this.list.filter((x) => !x.shown && !x.planned)) this.reveal(p.name, delayMs)
  }

  private show(p: Panel): void {
    if (p.shown) return
    p.shown = true
    // Le panneau qui vient d'apparaître passe au premier plan.
    p.view = { ...p.view, at: Date.now() }
    this.send(p.view)
  }
}
