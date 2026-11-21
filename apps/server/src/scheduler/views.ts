import type { UiRappel, UiRappels } from '@code/protocol'
import { addDays, localDay } from '../google/calendar.ts'
import { dayLabel, describeRecurrence, timeLabel } from './rules.ts'
import type { Rappel } from './store.ts'

/** Un rappel tel que l'interface l'affiche. */
export function toUiRappel(r: Rappel, now: number, tz: string): UiRappel {
  return {
    id: r.id,
    texte: r.texte,
    echeance: r.echeance,
    heure: timeLabel(r.echeance, tz),
    jour: dayLabel(r.echeance, now, tz),
    ...(r.recurrence ? { recurrence: describeRecurrence(r.recurrence) } : {}),
    etat: r.alerte ? 'sonne' : r.etat === 'fait' ? 'fait' : 'a_venir',
    ...(r.retard ? { retard: true } : {}),
    ...(r.de ? { de: r.de } : {})
  }
}

/** La vue « rappels » : ceux qui sonnent, puis aujourd'hui, demain, plus tard, les récurrents, et ceux faits aujourd'hui. */
export function rappelsView(active: Rappel[], done: Rappel[], now: number, tz: string, focus?: number): UiRappels {
  const today = localDay(now, tz)
  const tomorrow = addDays(today, 1)
  const ui = (r: Rappel) => toUiRappel(r, now, tz)
  const ringing = active.filter((r) => r.alerte)
  const waiting = active.filter((r) => !r.alerte)
  const oneShot = waiting.filter((r) => !r.recurrence)
  const groups: UiRappels['groupes'] = [
    { label: 'Qui sonnent', rappels: ringing.map(ui) },
    { label: 'Aujourd’hui', rappels: oneShot.filter((r) => localDay(r.echeance, tz) === today).map(ui) },
    { label: 'Demain', rappels: oneShot.filter((r) => localDay(r.echeance, tz) === tomorrow).map(ui) },
    { label: 'Plus tard', rappels: oneShot.filter((r) => localDay(r.echeance, tz) > tomorrow).map(ui) },
    { label: 'Récurrents', rappels: waiting.filter((r) => r.recurrence).map(ui) },
    { label: 'Faits aujourd’hui', rappels: done.map(ui) }
  ].filter((g) => g.rappels.length > 0)

  const todayCount = waiting.filter((r) => localDay(r.echeance, tz) === today).length
  const recurring = active.filter((r) => r.recurrence).length
  const next = waiting[0]
  return {
    kind: 'rappels',
    titre: 'Rappels',
    sousTitre: `${active.length} RAPPEL${active.length > 1 ? 'S' : ''} ACTIF${active.length > 1 ? 'S' : ''}${recurring ? ` · ${recurring} RÉCURRENT${recurring > 1 ? 'S' : ''}` : ''}`,
    kpis: [
      { label: 'Qui sonnent', valeur: String(ringing.length).padStart(2, '0'), tone: ringing.length ? 'attention' : 'neutre' },
      { label: 'Aujourd’hui', valeur: String(todayCount).padStart(2, '0'), tone: 'info' },
      { label: 'Prochain', valeur: next ? timeLabel(next.echeance, tz) : '—', detail: next ? dayLabel(next.echeance, now, tz).toUpperCase() : 'AUCUN', tone: 'info' },
      { label: 'Faits aujourd’hui', valeur: String(done.length).padStart(2, '0'), tone: done.length ? 'ok' : 'neutre' }
    ],
    groupes: groups,
    ...(focus !== undefined ? { focus } : {})
  }
}

/** La liste pour Claude, identifiants compris (pour reporter, terminer ou supprimer). */
export function rappelsForClaude(v: UiRappels): string {
  if (v.groupes.length === 0) return 'Aucun rappel.'
  return v.groupes
    .map((g) => `${g.label} :\n${g.rappels.map((r) => `  - [id ${r.id}] « ${r.texte} » · ${r.recurrence ?? `${r.jour} à ${r.heure}`}${r.recurrence ? ` (prochain : ${r.jour} à ${r.heure})` : ''}${r.retard ? ' · en retard' : ''}${r.de ? ` · de la part de ${r.de}` : ''}`).join('\n')}`)
    .join('\n')
}
