import type { UiEcheance } from '@code/protocol'

/**
 * Pour les cartes « Échéances » : le serveur envoie les dates, l'écran recalcule chaque jour l'écart à
 * aujourd'hui (une carte ouverte depuis la veille ne dit pas « demain » pour une échéance du jour).
 */

/** Aujourd'hui, « AAAA-MM-JJ », dans le fuseau de l'utilisateur. */
export function aujourdhuiDans(tz: string, now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Jours d'aujourd'hui à la date (négatif : en retard). */
export function joursAvant(date: string, aujourdhui: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) / 86_400_000)
}

/** « RETARD · 4 J », « AUJ. », « DEMAIN », « DANS 6 J ». */
export function echeanceCourt(jours: number): string {
  return jours < 0 ? `RETARD · ${-jours} J` : jours === 0 ? 'AUJ.' : jours === 1 ? 'DEMAIN' : `DANS ${jours} J`
}

/** « en retard de 4 j », « aujourd’hui », « demain », « dans 6 j » : la ligne sous le titre. */
export function echeanceDans(jours: number): string {
  return jours < 0 ? `en retard de ${-jours} j` : jours === 0 ? 'aujourd’hui' : jours === 1 ? 'demain' : `dans ${jours} j`
}

const MOIS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.']

/** « 14 NOV. » : le jour et le mois d'une date « AAAA-MM-JJ ». */
export function jourMois(date: string): { jour: number; mois: string } {
  const d = new Date(`${date}T00:00:00Z`)
  return { jour: d.getUTCDate(), mois: MOIS[d.getUTCMonth()]! }
}

/** Les échéances triées, avec leur écart du jour. */
export function echeancesDuJour(liste: readonly UiEcheance[], tz: string, now = Date.now()): (UiEcheance & { jours: number })[] {
  const auj = aujourdhuiDans(tz, now)
  return liste.map((e) => ({ ...e, jours: joursAvant(e.date, auj) })).sort((a, b) => a.jours - b.jours || a.id - b.id)
}
