import type { EcheanceCategorie, EcheanceRecurrence } from '@code/protocol'

/**
 * Le calcul de l'échéancier, sans base ni horloge : dates en jours locaux (« AAAA-MM-JJ »), écart en jours,
 * prochaine occurrence d'une échéance récurrente, montants lisibles.
 */

export const CATEGORIES: readonly EcheanceCategorie[] = ['facture', 'loyer', 'impot', 'assurance', 'abonnement', 'document', 'autre']
export const RECURRENCES: readonly EcheanceRecurrence[] = ['mensuel', 'trimestriel', 'semestriel', 'annuel']
const MOIS_PAR: Record<EcheanceRecurrence, number> = { mensuel: 1, trimestriel: 3, semestriel: 6, annuel: 12 }
export const RECURRENCE_NOMS: Record<EcheanceRecurrence, string> = { mensuel: 'tous les mois', trimestriel: 'tous les trois mois', semestriel: 'tous les six mois', annuel: 'tous les ans' }

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/

/** Une date « AAAA-MM-JJ » qui existe vraiment (pas de 31 avril). */
export function dateValide(s: string): boolean {
  const m = JOUR.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

const utc = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Jours de `de` à `a` (négatif si `a` est passé). */
export function ecartJours(de: string, a: string): number {
  return Math.round((utc(a) - utc(de)) / 86_400_000)
}

export function ajouterJours(jour: string, n: number): string {
  return iso(utc(jour) + n * 86_400_000)
}

/**
 * L'occurrence suivante : quelques mois plus tard, au même jour du mois d'origine quand il existe
 * (31 janvier → 28 février → 31 mars), sans dériver vers le 28.
 */
export function suivante(date: string, recurrence: EcheanceRecurrence, jourOrigine: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + MOIS_PAR[recurrence]
  const an = Math.floor(total / 12)
  const mois = total % 12
  const dernier = new Date(Date.UTC(an, mois + 1, 0)).getUTCDate()
  return iso(Date.UTC(an, mois, Math.min(jourOrigine, dernier)))
}

/** « aujourd’hui », « demain », « dans 5 jours », « hier », « en retard de 3 jours ». */
export function dansCombien(jours: number): string {
  if (jours === 0) return 'aujourd’hui'
  if (jours === 1) return 'demain'
  if (jours === -1) return 'hier'
  if (jours > 1) return `dans ${jours} jours`
  return `en retard de ${-jours} jours`
}

/** « ven. 14 nov. » ; l'année s'ajoute quand ce n'est pas celle d'aujourd'hui. */
export function dateCourte(jour: string, aujourdhui: string): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...(jour.slice(0, 4) !== aujourdhui.slice(0, 4) ? { year: 'numeric' } : {}) }
  return new Intl.DateTimeFormat('fr-FR', opts).format(utc(jour))
}

/** « vendredi 14 novembre », pour la voix. */
export function dateParlee(jour: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(utc(jour))
}

/** « 84,90 € », « 25 000 F CFA » ; une devise inconnue s'écrit telle quelle, sans devise le nombre seul. */
export function montantLisible(montant: number, devise?: string | null): string {
  const code = devise?.trim().toUpperCase().replace(/^FCFA$|^CFA$/, 'XOF')
  if (code && /^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code, maximumFractionDigits: Number.isInteger(montant) ? 0 : 2 }).format(montant)
    } catch {
      // Code à trois lettres inconnu : écrit tel quel ci-dessous.
    }
  }
  const n = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(montant)
  return devise?.trim() ? `${n} ${devise.trim()}` : n
}

/** Les totaux par devise (« 1 240 € + 25 000 F CFA »), une échéance sans montant ne compte pas. */
export function totaux(items: { montant: number | null; devise: string | null }[]): string {
  const par = new Map<string, number>()
  for (const i of items) if (i.montant !== null) par.set(i.devise ?? '', (par.get(i.devise ?? '') ?? 0) + i.montant)
  return [...par].map(([d, n]) => montantLisible(Math.round(n * 100) / 100, d || null)).join(' + ')
}
