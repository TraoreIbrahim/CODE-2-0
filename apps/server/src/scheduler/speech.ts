/**
 * Ce que CODE dit quand il prend la parole de lui-même : une phrase, pas une étiquette.
 * « Bonsoir Paul, je vous rappelle que vous avez rendez-vous avec Atlas à 19 h. »
 */

/** `de` : le prénom de la personne de la maison qui l'a donné (« rappelle à Léo… »). */
export type Spoken = { texte: string; annonce: string | null; de?: string | null }

/** « de la part de Léo », « de la part d’Inès ». */
export function deLaPart(prenom: string): string {
  return /^[aeiouyhàâéèêëîïôöûüœ]/i.test(prenom) ? `de la part d’${prenom}` : `de la part de ${prenom}`
}

/** « Bonjour » jusqu'à 18 h, « Bonsoir » ensuite (heure locale). */
export function greeting(hour: number): string {
  return hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir'
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.!;:]+$/, '')

/** La phrase d'un rappel, sans l'adresse : l'annonce si Claude l'a écrite, sinon le texte tel quel. */
function phrase(r: Spoken): string {
  return r.annonce ? `que ${lower(clean(r.annonce))}` : `: ${lower(clean(r.texte))}`
}

/**
 * Les rappels qui sonnent, dits à la personne. `greet` : la saluer (CODE ne lui a pas parlé depuis un moment) ;
 * sinon seulement son prénom, pour ne pas dire « bonsoir » deux fois en dix minutes. `tu` : la tutoyer.
 */
export function reminderSpeech(rappels: Spoken[], name: string, hour: number, greet: boolean, tu = false): string {
  const hello = greet ? `${greeting(hour)} ${name}, ` : `${name}, `
  if (rappels.length === 1) {
    const r = rappels[0]!
    if (r.de) return r.annonce ? `${hello}${deLaPart(r.de)}, je ${tu ? 'te' : 'vous'} rappelle ${phrase(r)}.` : `${hello}petit rappel ${deLaPart(r.de)} ${phrase(r)}.`
    return r.annonce ? `${hello}je ${tu ? 'te' : 'vous'} rappelle ${phrase(r)}.` : `${hello}petit rappel ${phrase(r)}.`
  }
  const items = rappels.map((r) => `${r.annonce ? clean(r.annonce) : clean(r.texte)}${r.de ? ` (${deLaPart(r.de)})` : ''}`)
  return `${hello}j’ai ${rappels.length} rappels pour ${tu ? 'toi' : 'vous'} : ${items.map(lower).join(' ; ')}.`
}

/** « 07:30 » → « 7 h 30 », « 08:00 » → « 8 h » : l'heure telle qu'on la dit. */
export function spokenTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h ?? 0} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`
}

/** Extrait d'une voix (assistant, Réglages) : court, à son nom, dans son registre. */
export function sampleSpeech(name: string, tu: boolean, moi: string): string {
  return `${name}, je suis ${moi}. C’est avec cette voix que je ${tu ? 'te' : 'vous'} parlerai.`
}

/**
 * Fin de l'assistant de premier lancement : CODE se présente en une phrase, sans Claude (aucun token),
 * avec ce qui vient d'être choisi (appellation, registre, heure du briefing).
 */
export function presentationSpeech(name: string, tu: boolean, briefing: string, hour: number, moi: string): string {
  return tu
    ? `${greeting(hour)} ${name}, je suis ${moi}. Touche l’orbe ou parle-moi quand tu veux ; chaque matin à ${spokenTime(briefing)}, je te fais le point.`
    : `${greeting(hour)} ${name}, je suis ${moi}. Touchez l’orbe ou parlez-moi quand vous voulez ; chaque matin à ${spokenTime(briefing)}, je vous fais le point.`
}
