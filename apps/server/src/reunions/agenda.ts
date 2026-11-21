import type { CalEvent } from '../google/calendar.ts'
import { visio } from '../google/calendar.ts'

/**
 * Proposer d'enregistrer une réunion en visio à l'heure où elle commence, d'après l'agenda. L'assistant ne
 * lance rien seul : il demande, la personne répond (bouton ou voix). Seules les réunions en visio de l'agenda
 * sont vues ; un appel improvisé ne l'est pas.
 */

export type VisioProche = {
  /** L'événement et son heure : une proposition par occurrence. */
  cle: string
  titre: string
  debut: number
  /** « Meet », « Zoom », « Teams », ou vide. */
  service: string
}

function serviceDe(ev: CalEvent): string {
  const texte = `${ev.hangoutLink ?? ''} ${ev.location ?? ''} ${ev.description ?? ''}`
  if (/zoom\.us/i.test(texte)) return 'Zoom'
  if (/teams\.(microsoft|live)/i.test(texte)) return 'Teams'
  if (ev.hangoutLink || /meet\.google/i.test(texte)) return 'Meet'
  return ''
}

/** Les réunions en visio à heure fixe, ni annulées ni déclinées. */
export function visiosDe(events: CalEvent[]): VisioProche[] {
  const out: VisioProche[] = []
  for (const ev of events) {
    const debut = ev.start?.dateTime ? Date.parse(ev.start.dateTime) : NaN
    if (!Number.isFinite(debut) || ev.status === 'cancelled' || !visio(ev)) continue
    if (ev.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue
    out.push({ cle: `${ev.id}@${debut}`, titre: (ev.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Réunion', debut, service: serviceDe(ev) })
  }
  return out
}

type Deps = {
  /** Les événements du jour de la personne ; null si son agenda n'est pas relié. */
  evenements(uid: number, now: number): Promise<CalEvent[] | null>
  /** Propose sur ses écrans ; `false` si personne n'a pu la voir (à retenter tant qu'elle commence). */
  proposer(uid: number, v: VisioProche): boolean
  /** Entre deux lectures de l'agenda. */
  rafraichirMs?: number
}

/** De une minute avant le début à trois minutes après. */
const AVANT_MS = 60_000
const APRES_MS = 3 * 60_000

export class ProposeurReunions {
  private agendas = new Map<number, { lu: number; visios: VisioProche[]; lecture?: Promise<void> }>()
  private faites = new Set<string>()

  constructor(private readonly deps: Deps) {}

  /** Appelé souvent (planificateur) : relit l'agenda de temps en temps, et propose ce qui commence. */
  tick(uid: number, now: number): void {
    const a = this.agendas.get(uid) ?? { lu: 0, visios: [] }
    this.agendas.set(uid, a)
    if (!a.lecture && now - a.lu >= (this.deps.rafraichirMs ?? 10 * 60_000)) {
      a.lecture = this.deps
        .evenements(uid, now)
        .then((evs) => {
          a.visios = evs ? visiosDe(evs) : []
        })
        // Agenda injoignable : on garde ce qu'on savait, et on réessaiera.
        .catch(() => {})
        .finally(() => {
          a.lu = now
          a.lecture = undefined
        })
    }
    for (const v of a.visios) {
      const cle = `${uid}:${v.cle}`
      if (this.faites.has(cle) || now < v.debut - AVANT_MS || now > v.debut + APRES_MS) continue
      if (this.deps.proposer(uid, v)) this.faites.add(cle)
    }
    // Les propositions d'hier ne servent plus.
    if (this.faites.size > 500) this.faites.clear()
  }

  /** Pour les tests : la lecture en cours de l'agenda. */
  async attendre(uid: number): Promise<void> {
    await this.agendas.get(uid)?.lecture
  }
}
