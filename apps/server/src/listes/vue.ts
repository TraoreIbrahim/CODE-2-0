import type { UiListe, UiListeResume, UiListes, UiPartage, UiPersonne } from '@code/protocol'
import { getUser } from '../users/users.ts'
import { prenomDe, teinteDe } from '../users/personnes.ts'
import { elementsDe, lecteursDe, listesDe, type Element, type Liste } from './store.ts'

/** Les vues d'une liste : la grande liste à cocher, et le tour de toutes les listes. */

export function personne(uid: number): UiPersonne {
  const u = getUser(uid)
  return { prenom: u ? prenomDe(u) : 'Quelqu’un', teinte: teinteDe(uid) }
}

/** « Léo, Sam et Alex » (sans la personne qui regarde, dite « vous » ailleurs). */
const joindre = (noms: string[]) => (noms.length <= 1 ? (noms[0] ?? '') : `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}`)

export function partageDe(l: Liste, uid: number): UiPartage {
  if (l.partage === 'prive') return { mode: 'prive', libelle: 'Privée', personnes: [] }
  const personnes = lecteursDe(l).map(personne)
  if (l.partage === 'tous') return { mode: 'tous', libelle: 'Toute la maison', personnes }
  const autres = lecteursDe(l)
    .filter((id) => id !== uid)
    .map((id) => personne(id).prenom)
  return { mode: 'personnes', libelle: `Avec ${joindre(autres)}`, personnes }
}

export function listeView(uid: number, l: Liste, focus: readonly number[] = []): UiListe {
  const elements = elementsDe(uid, l.id)
  const partagee = l.partage !== 'prive'
  return {
    kind: 'liste',
    id: l.id,
    nom: l.nom,
    partage: partageDe(l, uid),
    ...(l.auteur !== uid ? { auteur: personne(l.auteur) } : {}),
    mienne: l.auteur === uid,
    elements: elements.map((e) => ({
      id: e.id,
      texte: e.texte,
      ...(e.quantite ? { quantite: e.quantite } : {}),
      coche: e.coche,
      ...(partagee ? { par: personne(e.ajoutePar) } : {}),
      ...(partagee && e.coche && e.cochePar ? { cochePar: personne(e.cochePar) } : {})
    })),
    restants: elements.filter((e) => !e.coche).length,
    ...(focus.length ? { focus: [...focus] } : {})
  }
}

/** « à l’instant », « il y a 5 min », « il y a 3 h », « hier », « il y a 4 j ». */
export function depuis(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60_000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.floor(h / 24)
  return j === 1 ? 'hier' : `il y a ${j} j`
}

export function resumeDe(uid: number, l: Liste, now = Date.now()): UiListeResume {
  const elements = elementsDe(uid, l.id)
  const restants = elements.filter((e) => !e.coche)
  return {
    id: l.id,
    nom: l.nom,
    partage: partageDe(l, uid),
    restants: restants.length,
    total: elements.length,
    apercu: restants.slice(0, 4).map((e) => e.texte),
    modifie: depuis(l.modifie, now)
  }
}

export function listesView(uid: number, now = Date.now()): UiListes {
  const listes = listesDe(uid)
  const partagees = listes.filter((l) => l.partage !== 'prive').length
  return {
    kind: 'listes',
    titre: 'Listes',
    sousTitre: listes.length ? `${listes.length} LISTE${listes.length > 1 ? 'S' : ''}${partagees ? ` · ${partagees} PARTAGÉE${partagees > 1 ? 'S' : ''}` : ''}` : 'AUCUNE LISTE',
    listes: listes.map((l) => resumeDe(uid, l, now))
  }
}

/** Pour le modèle : chaque élément avec son identifiant, ce qu'il reste d'abord. */
export function listeForClaude(l: Liste, elements: Element[], uid: number): string {
  const p = partageDe(l, uid).libelle.toLowerCase()
  const lignes = elements.map((e) => `  - [${e.id}] ${e.texte}${e.quantite ? ` (${e.quantite})` : ''}${e.coche ? ' · coché' : ''}`)
  const restants = elements.filter((e) => !e.coche).length
  return `Liste « ${l.nom} » (${p}${l.auteur !== uid ? `, créée par ${personne(l.auteur).prenom}` : ''}) : ${restants} à prendre sur ${elements.length}.${lignes.length ? `\n${lignes.join('\n')}` : ' Elle est vide.'}`
}
