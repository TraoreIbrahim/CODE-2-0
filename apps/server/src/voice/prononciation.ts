/**
 * Ce que la voix doit dire, écrit en toutes lettres. Le modèle rapide d'ElevenLabs (Flash) ne met pas les
 * chiffres en mots : « REF-2026-0003 » ou « +33 6 12 34 56 78 » sortaient mâchés, comme un charabia. On lui
 * donne donc des mots :
 * - codes (« REF-2026-0003 », « LOT-005 ») : les lettres épelées, l'année dite, le reste chiffre par chiffre ;
 * - téléphones : par paires, indicatif international compris (« plus trente-trois ») ;
 * - heures, dates, pourcentages, montants, nombres : en toutes lettres.
 * Seule la voix reçoit ce texte : l'écran garde l'écriture d'origine.
 */

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf']
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** Le nom des lettres, tel qu'on les épelle : écrites ainsi, la voix ne tente pas de lire « REF » comme un mot. */
const LETTRES: Record<string, string> = {
  A: 'a', B: 'bé', C: 'cé', D: 'dé', E: 'eu', F: 'èf', G: 'jé', H: 'ache', I: 'i', J: 'ji', K: 'ka', L: 'èl', M: 'èm',
  N: 'èn', O: 'o', P: 'pé', Q: 'ku', R: 'èr', S: 'èss', T: 'té', U: 'u', V: 'vé', W: 'double vé', X: 'iks', Y: 'i grec', Z: 'zèd'
}

/** 0 à 99 ; `pluriel` : « quatre-vingts » en fin de nombre, « quatre-vingt » devant « mille ». */
function moinsDeCent(n: number, pluriel = true): string {
  if (n < 20) return UNITES[n]!
  const d = Math.floor(n / 10)
  const u = n % 10
  if (d === 7 || d === 9) return d === 7 && u === 1 ? 'soixante et onze' : `${DIZAINES[d]}-${UNITES[10 + u]}`
  if (d === 8) return u === 0 ? (pluriel ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${UNITES[u]}`
  if (u === 0) return DIZAINES[d]!
  return u === 1 ? `${DIZAINES[d]} et un` : `${DIZAINES[d]}-${UNITES[u]}`
}

/** 0 à 999 ; « deux cents » en fin de nombre, « deux cent mille » devant « mille ». */
function moinsDeMille(n: number, pluriel = true): string {
  const c = Math.floor(n / 100)
  const r = n % 100
  const cent = c === 0 ? '' : c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 && pluriel ? 's' : ''}`
  if (!r) return cent || 'zéro'
  return cent ? `${cent} ${moinsDeCent(r, pluriel)}` : moinsDeCent(r, pluriel)
}

/** Un entier en lettres, jusqu'aux milliards : 41 000 000 → « quarante et un millions ». */
export function enLettres(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return String(n).split('').map((c) => UNITES[Number(c)] ?? c).join(' ')
  n = Math.floor(n)
  if (n === 0) return 'zéro'
  const milliards = Math.floor(n / 1e9)
  const millions = Math.floor(n / 1e6) % 1000
  const milliers = Math.floor(n / 1000) % 1000
  const reste = n % 1000
  const parts: string[] = []
  if (milliards) parts.push(`${moinsDeMille(milliards)} milliard${milliards > 1 ? 's' : ''}`)
  if (millions) parts.push(`${moinsDeMille(millions)} million${millions > 1 ? 's' : ''}`)
  if (milliers) parts.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers, false)} mille`)
  if (reste) parts.push(moinsDeMille(reste))
  return parts.join(' ')
}

/** « 0106 » → « zéro un zéro six ». */
export function chiffreParChiffre(digits: string): string {
  return digits.split('').map((c) => UNITES[Number(c)]).join(' ')
}

/** « 05 » → « zéro cinq », « 69 » → « soixante-neuf » : une paire de numéro de téléphone. */
function paire(p: string): string {
  return p.startsWith('0') ? chiffreParChiffre(p) : enLettres(Number(p))
}

/** Un groupe de numéro tel qu'il est écrit : « 6 » → « six », « 1234 » → « douze, trente-quatre », « 415 » → « quatre un cinq ». */
function groupe(g: string): string {
  if (g.length > 2 && g.length % 2) return chiffreParChiffre(g)
  return (g.match(/\d\d?/g) ?? []).map(paire).join(', ')
}

/** « 3,5 » → « trois virgule cinq » ; « 0,05 » → « zéro virgule zéro cinq ». */
function nombre(entier: string, decimales?: string): string {
  const e = entier.length > 1 && entier.startsWith('0') ? chiffreParChiffre(entier) : entier.length > 12 ? chiffreParChiffre(entier) : enLettres(Number(entier))
  if (!decimales) return e
  return `${e} virgule ${decimales.startsWith('0') ? chiffreParChiffre(decimales) : enLettres(Number(decimales))}`
}

/** « 1 » → « une » devant un nom féminin (heure, minute) ; « 21 » → « vingt et une ». */
const feminin = (n: number) => enLettres(n).replace(/(^| )un$/, '$1une')

/** « REF-2026-0003 » → « èr eu èf, deux mille vingt-six, zéro zéro zéro trois ». */
function code(lettres: string, chiffres: string): string {
  const groupes = lettres.split('-').map((g) => g.split('').map((l) => LETTRES[l] ?? l).join(' '))
  const nombres = chiffres.split('-').map((g) => (/^(19|20)\d\d$/.test(g) ? enLettres(Number(g)) : chiffreParChiffre(g)))
  return [...groupes, ...nombres].join(', ')
}

function date(j: number, m: number, a?: string): string | null {
  if (j < 1 || j > 31 || m < 1 || m > 12) return null
  return `${j === 1 ? 'premier' : enLettres(j)} ${MOIS[m - 1]}${a ? ` ${enLettres(Number(a))}` : ''}`
}

function heure(h: number, min?: string): string {
  const m = min ? Number(min) : 0
  const base = `${feminin(h)} heure${h > 1 ? 's' : ''}`
  return m ? `${base} ${feminin(m)}` : base
}

/** Le texte à dire : chiffres, codes et symboles en mots. */
export function pourLaVoix(texte: string): string {
  return (
    texte
      // Codes de dossier : lettres, tiret, chiffres (« REF-2026-0003 », « LOT-005 »).
      .replace(/\b([A-Z]{1,6}(?:-[A-Z]{1,6})*)-(\d+(?:-\d+)*)\b/g, (_, l: string, c: string) => code(l, c))
      // Téléphones internationaux : l'indicatif, puis les groupes tels qu'écrits (« +33 6 12 34 56 78 ») ;
      // collés, on ne sait pas où finit l'indicatif : chiffre par chiffre.
      .replace(/\+(\d{1,3})((?:[\s.]\d{1,4}){2,})\b/g, (_, ind: string, reste: string) => `plus ${enLettres(Number(ind))}, ${reste.trim().split(/[\s.]+/).map(groupe).join(', ')}`)
      .replace(/\+(\d{8,15})\b/g, (_, n: string) => `plus ${chiffreParChiffre(n)}`)
      // Téléphones nationaux : par paires (« 06 12 34 56 78 », « 0612345678 »).
      .replace(/\b\d{2}(?:[\s.]\d{2}){3,4}\b|\b0[1-9]\d{8}\b/g, (m) => groupe(m.replace(/\D/g, '')))
      // Dates : 05/11/2026, 5/11, 2026-11-05.
      .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, a: string, mo: string, j: string) => date(Number(j), Number(mo), a) ?? m)
      .replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g, (m, j: string, mo: string, a?: string) => date(Number(j), Number(mo), a) ?? m)
      // Heures : 14:32, 14h32, 9 h 05, 14h.
      .replace(/\b([01]?\d|2[0-3])\s?(?:h|:)\s?([0-5]\d)?\b/g, (_, h: string, m?: string) => heure(Number(h), m))
      // Montants et nombres à séparateurs de milliers (espaces, y compris insécables).
      .replace(/\b\d{1,3}(?:[   ]\d{3})+(?:,\d+)?\b/g, (m) => {
        const [e, d] = m.replace(/[   ]/g, '').split(',')
        return nombre(e!, d)
      })
      .replace(/\b1er\b/g, 'premier')
      .replace(/\b1re\b/g, 'première')
      // Le reste des nombres, décimales comprises ; « 0003 » se dit chiffre par chiffre.
      .replace(/\b(\d+)(?:,(\d+))?\b/g, (_, e: string, d?: string) => nombre(e, d))
      .replace(/\s?%/g, ' pour cent')
      .replace(/\s?€/g, ' euros')
      .replace(/\bF ?CFA\b|\bFCFA\b/g, 'francs CFA')
      .replace(/\s+,/g, ',')
      .replace(/ {2,}/g, ' ')
  )
}
