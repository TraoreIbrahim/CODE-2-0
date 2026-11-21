import { addDays, hhmm, localDay, localMinutes, parseLocal, zonedTime } from '../google/calendar.ts'

/**
 * Échéances des rappels : « dans 2 h », « demain à 9 h », « tous les lundis à 8 h ».
 * Claude traduit la phrase en champs simples ; ces fonctions calculent l'instant exact dans le fuseau du propriétaire.
 */

export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
export type Jour = (typeof JOURS)[number]

export type Recurrence =
  | { type: 'quotidien'; heure: number }
  | { type: 'jours_ouvres'; heure: number }
  /** Jours : 0 = lundi … 6 = dimanche. */
  | { type: 'hebdomadaire'; heure: number; jours: number[] }
  /** Jour du mois (1-31) ; un mois trop court prend son dernier jour. */
  | { type: 'mensuel'; heure: number; jour: number }

/** Lundi = 0 … dimanche = 6. */
export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

function daysInMonth(day: string): number {
  const [y, m] = day.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function matches(rec: Recurrence, day: string): boolean {
  switch (rec.type) {
    case 'quotidien':
      return true
    case 'jours_ouvres':
      return weekday(day) < 5
    case 'hebdomadaire':
      return rec.jours.includes(weekday(day))
    case 'mensuel':
      return Number(day.slice(8, 10)) === Math.min(rec.jour, daysInMonth(day))
  }
}

/** Prochaine occurrence strictement après `after`. */
export function nextOccurrence(rec: Recurrence, after: number, tz: string): number {
  let day = localDay(after, tz)
  for (let i = 0; i < 400; i++, day = addDays(day, 1)) {
    if (!matches(rec, day)) continue
    const at = zonedTime(day, rec.heure, tz).getTime()
    if (at > after) return at
  }
  throw new Error('Aucune occurrence trouvée pour cette répétition.')
}

export function describeRecurrence(rec: Recurrence): string {
  const at = `à ${hhmm(rec.heure)}`
  switch (rec.type) {
    case 'quotidien':
      return `tous les jours ${at}`
    case 'jours_ouvres':
      return `du lundi au vendredi ${at}`
    case 'hebdomadaire': {
      const names = [...rec.jours].sort().map((j) => `${JOURS[j]}s`)
      return `tous les ${names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0]} ${at}`
    }
    case 'mensuel':
      return `le ${rec.jour === 1 ? '1er' : rec.jour} de chaque mois ${at}`
  }
}

/** Ce que Claude transmet (champs de l'outil). */
export type WhenInput = { dans_minutes?: unknown; le?: unknown; repetition?: unknown; jours?: unknown; jour_du_mois?: unknown; heure?: unknown }

/** Échéance (et répétition) d'une demande, ou message d'erreur lisible par Claude. */
export function parseWhen(input: WhenInput, now: number, tz: string): { echeance: number; recurrence: Recurrence | null } | string {
  const given = ['dans_minutes', 'le', 'repetition'].filter((k) => input[k as keyof WhenInput] !== undefined)
  if (given.length !== 1) return 'Donnez exactement une échéance : « dans_minutes », « le » ou « repetition ».'
  const today = localDay(now, tz)

  if (input.dans_minutes !== undefined) {
    const n = Math.floor(Number(input.dans_minutes))
    if (!Number.isFinite(n) || n < 1 || n > 60 * 24 * 366) return 'Champ « dans_minutes » : entier entre 1 et 527 040 attendu.'
    return { echeance: now + n * 60_000, recurrence: null }
  }

  if (input.le !== undefined) {
    const at = typeof input.le === 'string' ? parseLocal(input.le, today) : null
    if (!at) return 'Champ « le » : AAAA-MM-JJTHH:MM ou HH:MM attendu.'
    let echeance = zonedTime(at.day, at.minutes, tz).getTime()
    // « à 9 h » sans date, déjà passé aujourd'hui : demain.
    if (echeance <= now && !/^\d{4}-/.test(String(input.le).trim())) echeance = zonedTime(addDays(at.day, 1), at.minutes, tz).getTime()
    if (echeance <= now) return 'Cette heure est déjà passée.'
    return { echeance, recurrence: null }
  }

  const heure = typeof input.heure === 'string' ? parseLocal(input.heure, today) : null
  if (!heure) return 'Une répétition demande « heure » (HH:MM).'
  let rec: Recurrence
  switch (input.repetition) {
    case 'quotidien':
    case 'jours_ouvres':
      rec = { type: input.repetition, heure: heure.minutes }
      break
    case 'hebdomadaire': {
      const jours = Array.isArray(input.jours) ? input.jours.map((j) => JOURS.indexOf(String(j).toLowerCase().trim() as Jour)) : []
      if (jours.length === 0 || jours.some((j) => j < 0)) return 'Répétition hebdomadaire : « jours » attendus (lundi … dimanche).'
      rec = { type: 'hebdomadaire', heure: heure.minutes, jours: [...new Set(jours)].sort() }
      break
    }
    case 'mensuel': {
      const jour = Math.floor(Number(input.jour_du_mois))
      if (!(jour >= 1 && jour <= 31)) return 'Répétition mensuelle : « jour_du_mois » entre 1 et 31 attendu.'
      rec = { type: 'mensuel', heure: heure.minutes, jour }
      break
    }
    default:
      return 'Champ « repetition » : quotidien, jours_ouvres, hebdomadaire ou mensuel.'
  }
  return { echeance: nextOccurrence(rec, now, tz), recurrence: rec }
}

/** « aujourd’hui », « demain », « jeu. 6 nov. ». */
export function dayLabel(ms: number, now: number, tz: string): string {
  const day = localDay(ms, tz)
  const today = localDay(now, tz)
  if (day === today) return 'aujourd’hui'
  if (day === addDays(today, 1)) return 'demain'
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
}

export const timeLabel = (ms: number, tz: string) => hhmm(localMinutes(ms, tz))

/**
 * Le briefing du matin est-il dû ? Une fois par jour, de l'heure prévue jusqu'à midi (au moins trois heures) :
 * si le Mac était éteint à 7 h 30, le briefing a lieu à la première occasion de la matinée.
 */
export function briefingDue(now: number, tz: string, at: string, lastDay: string | null): boolean {
  const today = localDay(now, tz)
  const start = parseLocal(at, today)
  if (!start || lastDay === today) return false
  const minutes = localMinutes(now, tz)
  return minutes >= start.minutes && minutes < Math.max(12 * 60, start.minutes + 3 * 60)
}

/** « 07:30 » (ou « 7h30 ») → minutes depuis minuit, ou null. */
export function parseHhmm(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2})[:h](\d{2})$/i)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h > 23 || min > 59 ? null : h * 60 + min
}

/**
 * Une heure de la journée (minutes depuis minuit) tombe-t-elle dans les heures de silence ?
 * La plage peut passer minuit (22:00 → 06:30) ; le début est compris, la fin non.
 */
export function inSilence(minutes: number, silence: { de: string; a: string } | null): boolean {
  if (!silence) return false
  const de = parseHhmm(silence.de)
  const a = parseHhmm(silence.a)
  if (de === null || a === null || de === a) return false
  return de < a ? minutes >= de && minutes < a : minutes >= de || minutes < a
}

/** En ce moment, dans le fuseau de la personne, est-ce l'heure du silence ? */
export const silenceNow = (now: number, tz: string, silence: { de: string; a: string } | null): boolean => inSilence(localMinutes(now, tz), silence)
