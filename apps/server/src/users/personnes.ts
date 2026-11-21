import { listUsers, type Utilisateur } from './users.ts'

/**
 * Les personnes d'une même installation, désignées par leur prénom : « rappelle à Léo », « partage la liste
 * avec Sam ». Seuls les comptes actifs comptent ; « tous » désigne toute la maison, « moi » la personne qui parle.
 */

/** Sans accents, ligatures ni casse : « Léo » et « leo », « œufs » et « oeufs » se valent. */
export const plat = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ')
    .trim()

const TOUS = new Set(['tous', 'tout le monde', 'toute la maison', 'toute la famille', 'la famille', 'la maison', 'everyone'])
const MOI = new Set(['moi', 'moi-meme', 'moi meme', 'me'])

/** Le nom sous lequel on désigne une personne : son prénom, sinon son nom. */
export const prenomDe = (u: Pick<Utilisateur, 'prenom' | 'nom'>) => u.prenom || u.nom || 'Quelqu’un'

/** Teinte stable d'une personne (0-359), pour la reconnaître d'un coup d'œil dans une liste partagée. */
export const teinteDe = (uid: number) => (uid * 137 + 190) % 360

export function personnesActives(): Utilisateur[] {
  return listUsers().filter((u) => u.actif)
}

/** Les autres personnes de l'installation, par leur prénom (pour le prompt et les messages d'erreur). */
export function autresPrenoms(uid: number): string[] {
  return personnesActives()
    .filter((u) => u.id !== uid)
    .map(prenomDe)
}

function correspond(u: Utilisateur, nom: string): boolean {
  const n = plat(nom)
  if (!n) return false
  const prenom = plat(u.prenom)
  const complet = plat(`${u.prenom} ${u.nom}`)
  const appellation = plat(u.reglages.appellation)
  return n === prenom || n === complet || (appellation !== '' && n === appellation) || (plat(u.nom) !== '' && n === plat(u.nom))
}

/**
 * Les personnes désignées, sans doublon, dans l'ordre de la maison. Un nom inconnu ou porté par deux personnes
 * est refusé avec la liste des prénoms possibles : jamais de destinataire deviné.
 */
export function trouverPersonnes(uid: number, noms: readonly string[]): { personnes: Utilisateur[] } | { erreur: string } {
  const actives = personnesActives()
  const autres = actives.filter((u) => u.id !== uid).map(prenomDe)
  const possibles = autres.length ? `Personnes de la maison : ${autres.join(', ')}.` : 'Personne d’autre n’a de compte sur cette installation.'
  const ids = new Set<number>()
  for (const brut of noms) {
    const nom = String(brut ?? '').trim()
    if (!nom) continue
    const n = plat(nom)
    if (TOUS.has(n)) {
      for (const u of actives) ids.add(u.id)
      continue
    }
    if (MOI.has(n)) {
      ids.add(uid)
      continue
    }
    const trouves = actives.filter((u) => correspond(u, nom))
    if (trouves.length === 0) return { erreur: `« ${nom} » n’a pas de compte sur cette installation. ${possibles}` }
    if (trouves.length > 1) return { erreur: `« ${nom} » désigne plusieurs personnes : précise avec le nom de famille. ${possibles}` }
    ids.add(trouves[0]!.id)
  }
  if (!ids.size) return { erreur: `Personne n’est désigné. ${possibles}` }
  return { personnes: actives.filter((u) => ids.has(u.id)) }
}
