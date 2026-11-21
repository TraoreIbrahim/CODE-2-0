import type { UiEcheance, UiEcheancier, UiKpi, UiTone } from '@code/protocol'
import { localDay } from '../google/calendar.ts'
import { RECURRENCE_NOMS, dansCombien, dateCourte, ecartJours, montantLisible, totaux } from './regles.ts'
import type { Echeance } from './store.ts'

/** L'échéancier tel que l'écran l'affiche, et tel que l'assistant le lit. */

const HORIZON = 60
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

export function uiEcheance(e: Echeance, aujourdhui: string, tz: string): UiEcheance {
  const jours = ecartJours(aujourdhui, e.date)
  return {
    id: e.id,
    titre: e.titre,
    categorie: e.categorie,
    date: e.date,
    quand: dateCourte(e.date, aujourdhui),
    jours,
    dans: dansCombien(jours),
    ...(e.montant !== null ? { montant: montantLisible(e.montant, e.devise) } : {}),
    ...(e.recurrence ? { recurrence: RECURRENCE_NOMS[e.recurrence] } : {}),
    etat: e.etat === 'regle' ? 'regle' : 'a_regler',
    ...(e.regleLe ? { regleLe: `réglée le ${dateCourte(localDay(e.regleLe, tz), aujourdhui)}` } : {}),
    ...(e.note ? { note: e.note } : {})
  }
}

/** Les groupes, du plus pressant au plus lointain. */
const GROUPES: { label: string; tone: UiTone; garde: (jours: number) => boolean }[] = [
  { label: 'En retard', tone: 'alerte', garde: (j) => j < 0 },
  { label: 'Cette semaine', tone: 'attention', garde: (j) => j >= 0 && j <= 7 },
  { label: 'Ce mois-ci', tone: 'info', garde: (j) => j > 7 && j <= 31 },
  { label: 'Plus tard', tone: 'neutre', garde: (j) => j > 31 }
]

export function echeancierView(aRegler: Echeance[], reglees: Echeance[], now: number, tz: string, focus?: number): UiEcheancier {
  const aujourdhui = localDay(now, tz)
  const items = aRegler.map((e) => ({ e, ui: uiEcheance(e, aujourdhui, tz) }))
  const retard = items.filter((i) => i.ui.jours < 0)
  const semaine = items.filter((i) => i.ui.jours >= 0 && i.ui.jours <= 7)
  const mois = items.filter((i) => i.ui.jours <= 30)
  const prochaine = items.find((i) => i.ui.jours >= 0)
  const recurrentes = aRegler.filter((e) => e.recurrence).length
  const kpis: UiKpi[] = [
    { label: 'En retard', valeur: String(retard.length).padStart(2, '0'), tone: retard.length ? 'alerte' : 'ok' },
    { label: '7 prochains jours', valeur: String(semaine.length).padStart(2, '0'), tone: semaine.length ? 'attention' : 'info' },
    { label: 'À régler sous 30 jours', valeur: totaux(mois.map((i) => i.e)) || '—', tone: 'info' },
    prochaine
      ? { label: 'Prochaine', valeur: prochaine.ui.jours === 0 ? 'auj.' : `${prochaine.ui.jours} j`, detail: prochaine.e.titre.toUpperCase(), tone: prochaine.ui.jours <= 3 ? 'attention' : 'info' }
      : { label: 'Prochaine', valeur: '—', tone: 'neutre' }
  ]
  return {
    kind: 'echeancier',
    titre: 'Échéancier',
    sousTitre: aRegler.length ? `${pluriel(aRegler.length, 'ÉCHÉANCE')} À RÉGLER${recurrentes ? ` · ${pluriel(recurrentes, 'RÉCURRENTE')}` : ''}` : 'RIEN À RÉGLER',
    kpis,
    aujourdhui,
    horizon: HORIZON,
    groupes: GROUPES.map((g) => ({ label: g.label, tone: g.tone, echeances: items.filter((i) => g.garde(i.ui.jours)).map((i) => i.ui) })).filter((g) => g.echeances.length),
    reglees: reglees.map((e) => uiEcheance(e, aujourdhui, tz)),
    ...(focus ? { focus } : {})
  }
}

/** Pour l'assistant : une ligne par échéance, avec son identifiant. */
export function echeancierPourClaude(v: UiEcheancier): string {
  if (!v.groupes.length) return `Aucune échéance à régler.${v.reglees.length ? ` ${pluriel(v.reglees.length, 'échéance')} réglée(s) ces 30 derniers jours.` : ''}`
  const lignes = v.groupes.map(
    (g) =>
      `${g.label} :\n${g.echeances.map((e) => `- [échéance ${e.id}] ${e.titre} · ${e.quand} (${e.dans})${e.montant ? ` · ${e.montant}` : ''}${e.recurrence ? ` · ${e.recurrence}` : ''} · ${e.categorie}${e.note ? ` · note : ${e.note}` : ''}`).join('\n')}`
  )
  const total = v.kpis.find((k) => k.label === 'À régler sous 30 jours')?.valeur
  return `${lignes.join('\n')}${total && total !== '—' ? `\nÀ régler sous 30 jours : ${total}.` : ''}`
}
