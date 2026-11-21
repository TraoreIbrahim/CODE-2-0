/**
 * Découpe le texte de Claude, qui arrive par petits morceaux, en propositions
 * à envoyer à la synthèse vocale dès qu'elles sont complètes.
 * La première proposition est coupée tôt (virgule) pour que CODE commence à parler vite.
 */
export class SentenceChunker {
  private buffer = ''
  private emitted = 0

  push(delta: string): string[] {
    this.buffer += delta
    const out: string[] = []
    for (;;) {
      const cut = this.findCut()
      if (cut < 0) break
      const piece = clean(this.buffer.slice(0, cut))
      this.buffer = this.buffer.slice(cut)
      if (piece) {
        out.push(piece)
        this.emitted++
      }
    }
    return out
  }

  flush(): string[] {
    const piece = clean(this.buffer)
    this.buffer = ''
    return piece ? [piece] : []
  }

  private findCut(): number {
    const end = /[.!?…]+["»”)]?(\s|$)|[:;]\s|\n+/g
    let m: RegExpExecArray | null
    while ((m = end.exec(this.buffer))) {
      const cut = m.index + m[0].length
      // « M. Bernard », « 3.5 » : pas une fin de phrase.
      if (/\b(M|Mme|Dr|St|etc)\.$/.test(this.buffer.slice(0, m.index + 1))) continue
      if (cut < this.buffer.length || /\s$/.test(m[0])) return cut
    }
    if (this.emitted === 0 && this.buffer.length > 60) {
      const comma = this.buffer.lastIndexOf(', ')
      if (comma > 25) return comma + 2
    }
    return -1
  }
}

/** Retire ce qui ne se prononce pas (markdown, puces). */
export function clean(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
