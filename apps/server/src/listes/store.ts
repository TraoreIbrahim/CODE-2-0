import { db, userIndex } from '../db.ts'
import { personnesActives, plat } from '../users/personnes.ts'

/**
 * Listes (courses, choses à faire) : chacune a son créateur, et se partage avec toute la maison ou quelques
 * personnes de l'installation. Tous ceux qui la voient l'écrivent et la cochent ; seul son créateur la partage,
 * la renomme ou la supprime. Une liste privée n'est visible que de lui (cloisonnement.test.ts).
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS listes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Le créateur : le seul à pouvoir la partager, la renommer ou la supprimer.
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    nom TEXT NOT NULL,
    partage TEXT NOT NULL DEFAULT 'prive' CHECK (partage IN ('prive', 'tous', 'personnes')),
    cree INTEGER NOT NULL,
    modifie INTEGER NOT NULL,
    supprimee INTEGER NOT NULL DEFAULT 0
  );
  -- Partage « personnes » : qui la voit, en plus du créateur.
  CREATE TABLE IF NOT EXISTS listes_membres (
    liste_id INTEGER NOT NULL REFERENCES listes(id),
    membre_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    PRIMARY KEY (liste_id, membre_id)
  );
  CREATE TABLE IF NOT EXISTS listes_elements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    liste_id INTEGER NOT NULL REFERENCES listes(id),
    texte TEXT NOT NULL,
    quantite TEXT,
    coche INTEGER NOT NULL DEFAULT 0,
    ajoute_par INTEGER NOT NULL REFERENCES utilisateurs(id),
    coche_par INTEGER REFERENCES utilisateurs(id),
    cree INTEGER NOT NULL,
    coche_le INTEGER
  );
  CREATE INDEX IF NOT EXISTS listes_elements_liste ON listes_elements (liste_id, coche, id);
  CREATE INDEX IF NOT EXISTS listes_membres_membre ON listes_membres (membre_id);
`)
userIndex('listes', 'supprimee')

export type Partage = 'prive' | 'tous' | 'personnes'

export type Liste = {
  id: number
  /** Le créateur. */
  auteur: number
  nom: string
  partage: Partage
  /** Partage « personnes » : qui la voit en plus du créateur. */
  membres: number[]
  modifie: number
}

export type Element = {
  id: number
  texte: string
  quantite: string | null
  coche: boolean
  ajoutePar: number
  cochePar: number | null
  cree: number
  cocheLe: number | null
}

type ListeRow = { id: number; utilisateur_id: number; nom: string; partage: Partage; modifie: number }
type ElementRow = { id: number; texte: string; quantite: string | null; coche: number; ajoute_par: number; coche_par: number | null; cree: number; coche_le: number | null }

const q = {
  // Ce qu'une personne voit : ses listes, celles de toute la maison, et celles qu'on partage avec elle.
  visibles: db.prepare(`SELECT * FROM listes WHERE supprimee = 0 AND (utilisateur_id = ? OR partage = 'tous' OR (partage = 'personnes' AND id IN (SELECT liste_id FROM listes_membres WHERE membre_id = ?))) ORDER BY modifie DESC, id DESC`),
  get: db.prepare(`SELECT * FROM listes WHERE supprimee = 0 AND (utilisateur_id = ? OR partage = 'tous' OR (partage = 'personnes' AND id IN (SELECT liste_id FROM listes_membres WHERE membre_id = ?))) AND id = ?`),
  insert: db.prepare('INSERT INTO listes (utilisateur_id, nom, partage, cree, modifie) VALUES (?, ?, ?, ?, ?)'),
  // Réservées au créateur : partager, renommer, supprimer.
  partager: db.prepare('UPDATE listes SET partage = ?, modifie = ? WHERE utilisateur_id = ? AND id = ? AND supprimee = 0'),
  renommer: db.prepare('UPDATE listes SET nom = ?, modifie = ? WHERE utilisateur_id = ? AND id = ? AND supprimee = 0'),
  supprimer: db.prepare('UPDATE listes SET supprimee = 1, modifie = ? WHERE utilisateur_id = ? AND id = ? AND supprimee = 0'),
  // Écrite par n'importe quelle personne qui la voit (accès vérifié avant, par `get`).
  touche: db.prepare('UPDATE listes SET modifie = ? WHERE id = ?'),
  membres: db.prepare('SELECT membre_id FROM listes_membres WHERE liste_id = ? ORDER BY membre_id'),
  sansMembres: db.prepare('DELETE FROM listes_membres WHERE liste_id = ?'),
  ajoutMembre: db.prepare('INSERT OR IGNORE INTO listes_membres (liste_id, membre_id) VALUES (?, ?)'),
  elements: db.prepare('SELECT * FROM listes_elements WHERE liste_id = ? ORDER BY coche, CASE WHEN coche = 1 THEN -coche_le ELSE id END, id'),
  element: db.prepare('SELECT * FROM listes_elements WHERE liste_id = ? AND id = ?'),
  ajout: db.prepare('INSERT INTO listes_elements (liste_id, texte, quantite, ajoute_par, cree) VALUES (?, ?, ?, ?, ?)'),
  quantite: db.prepare('UPDATE listes_elements SET quantite = ? WHERE liste_id = ? AND id = ?'),
  cocher: db.prepare('UPDATE listes_elements SET coche = ?, coche_par = ?, coche_le = ? WHERE liste_id = ? AND id = ?'),
  retirer: db.prepare('DELETE FROM listes_elements WHERE liste_id = ? AND id = ?'),
  retirerCoches: db.prepare('DELETE FROM listes_elements WHERE liste_id = ? AND coche = 1')
}

const listeners = new Set<(uids: number[], listeId: number) => void>()
/** Une liste a changé : les écrans de tous ceux qui la voient (ou la voyaient) doivent suivre. */
export function onListesChange(fn: (uids: number[], listeId: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = (uids: Iterable<number>, listeId: number) => {
  const tous = [...new Set(uids)]
  for (const fn of listeners) fn(tous, listeId)
}

function toListe(r: ListeRow): Liste {
  return {
    id: r.id,
    auteur: r.utilisateur_id,
    nom: r.nom,
    partage: r.partage,
    membres: r.partage === 'personnes' ? (q.membres.all(r.id) as { membre_id: number }[]).map((m) => m.membre_id) : [],
    modifie: r.modifie
  }
}

const toElement = (r: ElementRow): Element => ({
  id: r.id,
  texte: r.texte,
  quantite: r.quantite,
  coche: r.coche === 1,
  ajoutePar: r.ajoute_par,
  cochePar: r.coche_par,
  cree: r.cree,
  cocheLe: r.coche_le
})

/** Qui voit cette liste : le créateur, toute la maison, ou le créateur et ses membres. */
export function lecteursDe(l: Liste): number[] {
  if (l.partage === 'tous') return personnesActives().map((u) => u.id)
  return [l.auteur, ...l.membres]
}

export function listesDe(uid: number): Liste[] {
  return (q.visibles.all(uid, uid) as ListeRow[]).map(toListe)
}

/** Une liste que cette personne voit ; null sinon (privée d'un autre, supprimée). */
export function getListe(uid: number, id: number): Liste | null {
  const row = q.get.get(uid, uid, id) as ListeRow | undefined
  return row ? toListe(row) : null
}

/**
 * La liste désignée par son nom : exacte d'abord (« Courses »), puis celle dont le nom contient ce qui est dit
 * (« liste de courses » → « Courses »), sans accents ni casse. Plusieurs candidates : toutes, pour demander.
 */
export function trouverListe(uid: number, nom: string): Liste | Liste[] | null {
  const n = plat(nom).replace(/^(la |ma |notre |une )?(liste )?(des |de |du |d'|d’)?/, '')
  if (!n) return null
  const toutes = listesDe(uid)
  const exactes = toutes.filter((l) => plat(l.nom) === n || plat(l.nom) === plat(nom))
  if (exactes.length) return exactes.length === 1 ? exactes[0]! : exactes.sort((a, b) => Number(b.auteur === uid) - Number(a.auteur === uid))[0]!
  const proches = toutes.filter((l) => plat(l.nom).includes(n) || n.includes(plat(l.nom)))
  if (proches.length === 1) return proches[0]!
  return proches.length ? proches : null
}

export function elementsDe(uid: number, listeId: number): Element[] {
  if (!getListe(uid, listeId)) return []
  return (q.elements.all(listeId) as ElementRow[]).map(toElement)
}

function setMembres(listeId: number, membres: readonly number[], auteur: number): void {
  q.sansMembres.run(listeId)
  for (const m of membres) if (m !== auteur) q.ajoutMembre.run(listeId, m)
}

export function creerListe(uid: number, nom: string, partage: Partage = 'prive', membres: readonly number[] = [], now = Date.now()): Liste {
  const mode: Partage = partage === 'personnes' && !membres.some((m) => m !== uid) ? 'prive' : partage
  const id = Number(q.insert.run(uid, nom.replace(/\s+/g, ' ').trim().slice(0, 60), mode, now, now).lastInsertRowid)
  if (mode === 'personnes') setMembres(id, membres, uid)
  const l = getListe(uid, id)!
  changed(lecteursDe(l), id)
  return l
}

/** Écrit par quelqu'un qui la voit : la liste remonte en tête chez tous ses lecteurs. */
function apres(uid: number, listeId: number, now: number): void {
  q.touche.run(now, listeId)
  const l = getListe(uid, listeId)
  if (l) changed(lecteursDe(l), listeId)
}

export type Ajout = { texte: string; quantite?: string | null }

/**
 * Ajoute des éléments. Ce qui y est déjà (même texte) n'est pas dupliqué : sa quantité est mise à jour, et
 * s'il était coché, il revient dans ce qu'il reste à prendre.
 */
export function ajouterElements(uid: number, listeId: number, ajouts: readonly Ajout[], now = Date.now()): { ajoutes: Element[]; deja: Element[] } | null {
  if (!getListe(uid, listeId)) return null
  const existants = (q.elements.all(listeId) as ElementRow[]).map(toElement)
  const ajoutes: Element[] = []
  const deja: Element[] = []
  for (const a of ajouts) {
    const texte = a.texte.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!texte) continue
    const quantite = a.quantite?.replace(/\s+/g, ' ').trim().slice(0, 30) || null
    const meme = existants.find((e) => plat(e.texte) === plat(texte))
    if (meme) {
      if (meme.coche) q.cocher.run(0, null, null, listeId, meme.id)
      if (quantite && quantite !== meme.quantite) q.quantite.run(quantite, listeId, meme.id)
      deja.push(toElement(q.element.get(listeId, meme.id) as ElementRow))
      continue
    }
    const id = Number(q.ajout.run(listeId, texte, quantite, uid, now).lastInsertRowid)
    const e = toElement(q.element.get(listeId, id) as ElementRow)
    existants.push(e)
    ajoutes.push(e)
  }
  apres(uid, listeId, now)
  return { ajoutes, deja }
}

/** Coche (ou décoche) des éléments ; renvoie ceux qui ont changé. */
export function cocherElements(uid: number, listeId: number, ids: readonly number[], coche = true, now = Date.now()): Element[] | null {
  if (!getListe(uid, listeId)) return null
  const faits: Element[] = []
  for (const id of ids) {
    const row = q.element.get(listeId, id) as ElementRow | undefined
    if (!row || (row.coche === 1) === coche) continue
    q.cocher.run(coche ? 1 : 0, coche ? uid : null, coche ? now : null, listeId, id)
    faits.push(toElement(q.element.get(listeId, id) as ElementRow))
  }
  if (faits.length) apres(uid, listeId, now)
  return faits
}

/** Retire des éléments, ou tous ceux qui sont cochés (« vide ce qui est pris »). */
export function retirerElements(uid: number, listeId: number, cible: { ids: readonly number[] } | { coches: true }, now = Date.now()): number | null {
  if (!getListe(uid, listeId)) return null
  let n = 0
  if ('coches' in cible) n = Number(q.retirerCoches.run(listeId).changes)
  else for (const id of cible.ids) n += Number(q.retirer.run(listeId, id).changes)
  if (n) apres(uid, listeId, now)
  return n
}

/** Change le partage (créateur seulement) ; les anciens lecteurs sont prévenus aussi, la liste disparaît de leurs écrans. */
export function partagerListe(uid: number, listeId: number, partage: Partage, membres: readonly number[] = [], now = Date.now()): Liste | null {
  const avant = getListe(uid, listeId)
  if (!avant || avant.auteur !== uid) return null
  const mode: Partage = partage === 'personnes' && !membres.some((m) => m !== uid) ? 'prive' : partage
  q.partager.run(mode, now, uid, listeId)
  setMembres(listeId, mode === 'personnes' ? membres : [], uid)
  const apresPartage = getListe(uid, listeId)!
  changed([...lecteursDe(avant), ...lecteursDe(apresPartage)], listeId)
  return apresPartage
}

export function renommerListe(uid: number, listeId: number, nom: string, now = Date.now()): Liste | null {
  const l = getListe(uid, listeId)
  if (!l || l.auteur !== uid) return null
  q.renommer.run(nom.replace(/\s+/g, ' ').trim().slice(0, 60), now, uid, listeId)
  changed(lecteursDe(l), listeId)
  return getListe(uid, listeId)
}

/** Supprime une liste (créateur seulement) : elle disparaît chez tous ses lecteurs. */
export function supprimerListe(uid: number, listeId: number, now = Date.now()): boolean {
  const l = getListe(uid, listeId)
  if (!l || l.auteur !== uid) return false
  q.supprimer.run(now, uid, listeId)
  changed(lecteursDe(l), listeId)
  return true
}
