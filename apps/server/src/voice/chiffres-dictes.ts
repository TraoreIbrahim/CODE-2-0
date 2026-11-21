/**
 * Un numéro dicté chiffre par chiffre arrive souvent en mots : « neuf neuf zéro zéro un zéro six ». On le
 * remet en chiffres collés pour le modèle et l'écran : « 9900106 ». Trois chiffres au moins : « un deux » reste tel quel (« un agent » aussi).
 */

const CHIFFRES: Record<string, string> = { zéro: '0', zero: '0', un: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9' }
const MOT = '(?:double\\s+)?(?:zéro|zero|un|deux|trois|quatre|cinq|six|sept|huit|neuf)'
const SUITE = new RegExp(`(?<![\\p{L}-])${MOT}(?:[\\s,-]+${MOT}){2,}(?![\\p{L}-])`, 'giu')

export function chiffresDictes(text: string): string {
  return text.replace(SUITE, (m) => {
    return m
      .toLowerCase()
      .split(/[\s,-]+/)
      .reduce<{ out: string; double: boolean }>(
        (acc, w) => (w === 'double' ? { ...acc, double: true } : { out: acc.out + CHIFFRES[w]!.repeat(acc.double ? 2 : 1), double: false }),
        { out: '', double: false }
      ).out
  })
}
