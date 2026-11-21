import { ajouterElements, cocherElements, creerListe, elementsDe, getListe, listesDe, partagerListe, renommerListe, retirerElements, supprimerListe, trouverListe, type Element, type Liste, type Partage } from '../listes/store.ts'
import { listeForClaude, listeView, listesView, partageDe, personne } from '../listes/vue.ts'
import { plat, trouverPersonnes } from '../users/personnes.ts'
import { checkStrings, type Tool, type ToolContext } from './types.ts'

/**
 * Listes (courses, choses à faire), cochées à la voix : « ajoute du lait à la liste », « j’ai pris le pain ».
 * Partagées avec toute la maison ou quelques personnes ; chacun voit les mêmes, à jour sur ses écrans.
 */

const nomsDe = (listes: Liste[]) => listes.map((l) => `« ${l.nom} »`).join(', ')

/** La liste désignée (identifiant ou nom), ou la raison de ne pas la trouver, avec les listes existantes. */
function resoudre(ref: unknown, ctx: ToolContext): Liste | string {
  const uid = ctx.user.id
  const toutes = listesDe(uid)
  const existantes = toutes.length ? `Listes : ${nomsDe(toutes)}.` : 'Aucune liste pour le moment.'
  if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref.trim()))) {
    return getListe(uid, Math.floor(Number(ref))) ?? `Liste ${String(ref)} introuvable. ${existantes}`
  }
  if (typeof ref !== 'string' || !ref.trim()) return `Champ « liste » manquant. ${existantes}`
  const r = trouverListe(uid, ref)
  if (!r) return `Pas de liste « ${ref.trim()} ». ${existantes}`
  if (Array.isArray(r)) return `« ${ref.trim()} » peut désigner plusieurs listes : ${nomsDe(r)}. Demande laquelle.`
  return r
}

/** Les éléments désignés (identifiant, texte exact, ou texte approché sans ambiguïté). */
function designer(elements: Element[], refs: unknown[]): { ids: number[] } | { erreur: string } {
  const ids: number[] = []
  for (const ref of refs) {
    const id = typeof ref === 'number' ? ref : typeof ref === 'string' && /^\d+$/.test(ref.trim()) ? Number(ref) : null
    if (id !== null && elements.some((e) => e.id === id)) {
      ids.push(id)
      continue
    }
    if (typeof ref === 'number') return { erreur: `Élément ${ref} absent de la liste.` }
    const n = plat(String(ref ?? ''))
    if (!n) continue
    const exact = elements.filter((e) => plat(e.texte) === n)
    const proches = exact.length ? exact : elements.filter((e) => plat(e.texte).includes(n) || n.includes(plat(e.texte)))
    if (proches.length === 0) return { erreur: `« ${String(ref)} » n’est pas dans la liste.` }
    // Le même produit noté deux fois (« lait », « lait d’avoine ») : demander, sauf si tous sont visés.
    if (proches.length > 1 && !exact.length) return { erreur: `« ${String(ref)} » peut être ${proches.map((e) => `« ${e.texte} »`).join(' ou ')} : précise.` }
    ids.push(...proches.map((e) => e.id))
  }
  return { ids: [...new Set(ids)] }
}

/** « Courses », « Choses à faire » : la majuscule en tête, le reste tel quel. */
const nomPropre = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim().replace(/^(la |ma |notre )?liste (des |de |du |d’|d')?/i, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

type Partager = { partage: Partage; membres: number[] } | string

/** Le partage demandé : « tous », « prive », ou « personnes » avec leurs prénoms. */
function partageDemande(input: Record<string, unknown>, ctx: ToolContext): Partager | null {
  if (input.partage === undefined && input.personnes === undefined) return null
  const personnes = input.personnes
  if (personnes !== undefined && (!Array.isArray(personnes) || personnes.some((p) => typeof p !== 'string'))) return 'Champ « personnes » : une liste de prénoms.'
  const mode = (input.partage ?? (Array.isArray(personnes) && personnes.length ? 'personnes' : 'prive')) as string
  if (mode === 'prive' || mode === 'tous') return { partage: mode, membres: [] }
  if (mode !== 'personnes') return 'Champ « partage » : « prive », « tous » ou « personnes ».'
  if (!Array.isArray(personnes) || !personnes.length) return 'Partage « personnes » : donne leurs prénoms dans « personnes ».'
  const r = trouverPersonnes(ctx.user.id, personnes as string[])
  return 'erreur' in r ? `Champ « personnes » : ${r.erreur}` : { partage: 'personnes', membres: r.personnes.map((u) => u.id) }
}

type Ajout = { texte: string; quantite?: string }

function ajoutsDe(input: Record<string, unknown>): Ajout[] | string {
  const raw = input.elements
  if (!Array.isArray(raw) || !raw.length) return 'Champ « elements » : au moins un élément.'
  const out: Ajout[] = []
  for (const e of raw.slice(0, 40)) {
    if (typeof e === 'string' && e.trim()) out.push({ texte: e })
    else if (e && typeof e === 'object' && typeof (e as Ajout).texte === 'string' && (e as Ajout).texte.trim()) {
      const q = (e as { quantite?: unknown }).quantite
      if (q !== undefined && typeof q !== 'string' && typeof q !== 'number') return 'Champ « quantite » invalide.'
      out.push({ texte: (e as Ajout).texte, ...(q !== undefined && String(q).trim() ? { quantite: String(q) } : {}) })
    } else return 'Champ « elements » : chaque élément a un « texte ».'
  }
  return out
}

const ELEMENTS_REFS = { type: 'array', items: { type: ['string', 'integer'] }, description: 'Les éléments : leur texte (« pain ») ou leur identifiant.' }
const LISTE = { type: 'string', description: 'Le nom de la liste (« courses », « choses à faire ») ou son identifiant.' }
const tel = (l: Liste, ctx: ToolContext) => partageDe(l, ctx.user.id).libelle.toLowerCase()
const textes = (es: Element[]) => es.map((e) => `${e.texte}${e.quantite ? ` (${e.quantite})` : ''}`).join(', ')

export const listesShow: Tool = {
  name: 'listes_voir',
  description: 'Affiche une liste (courses, choses à faire…) en grand, à cocher, avec ce qu’il reste à prendre ; sans « liste », toutes les listes de la personne, les partagées comprises. « Qu’est-ce qu’il faut acheter ? », « montre la liste de courses ».',
  risk: 'lecture',
  ui: { kind: 'listes', title: (input) => (input.liste ? 'Liste' : 'Listes') },
  input_schema: { type: 'object', properties: { liste: { type: ['string', 'integer'], description: LISTE.description } }, additionalProperties: false },
  validate(input, ctx) {
    if (input.liste === undefined || input.liste === '') return null
    const l = resoudre(input.liste, ctx)
    return typeof l === 'string' ? l : null
  },
  async run(input, ctx) {
    const uid = ctx.user.id
    if (input.liste === undefined || input.liste === '') {
      const v = listesView(uid)
      const resume = v.listes.map((l) => `- [${l.id}] « ${l.nom} » (${l.partage.libelle.toLowerCase()}) : ${l.restants} à prendre sur ${l.total}`).join('\n')
      return { content: v.listes.length ? `${resume}\nLes listes sont affichées : résume en une phrase.` : 'Aucune liste. Propose d’en commencer une (« ajoute du lait à la liste de courses »).', summary: `Listes (${v.listes.length})`, view: v }
    }
    const l = resoudre(input.liste, ctx) as Liste
    return { content: `${listeForClaude(l, elementsDe(uid, l.id), uid)}\nLa liste est affichée : dis ce qu’il reste en une ou deux phrases, sans tout énumérer s’il y en a beaucoup.`, summary: `Liste « ${l.nom} »`, view: listeView(uid, l) }
  }
}

export const listeAdd: Tool = {
  name: 'liste_ajouter',
  description: 'Ajoute des éléments à une liste (« ajoute du lait et des œufs à la liste de courses »). Si la liste n’existe pas, elle est créée : privée, sauf « partage » (« tous » : toute la maison ; « personnes » avec leurs prénoms). Un élément déjà présent n’est pas doublé (sa quantité est mise à jour, et il revient s’il était coché). Sans liste nommée pour des courses, prends « courses ».',
  risk: 'preparation',
  ui: { kind: 'liste', title: () => 'Liste' },
  input_schema: {
    type: 'object',
    properties: {
      liste: LISTE,
      elements: {
        type: 'array',
        items: { type: 'object', properties: { texte: { type: 'string', description: 'L’élément, court (« lait », « appeler le garage »).' }, quantite: { type: 'string', description: '« 2 », « 1 kg », si elle est dite.' } }, required: ['texte'], additionalProperties: false }
      },
      partage: { type: 'string', enum: ['prive', 'tous', 'personnes'], description: 'Seulement pour une liste nouvelle.' },
      personnes: { type: 'array', items: { type: 'string' }, description: 'Prénoms, pour le partage « personnes ».' }
    },
    required: ['liste', 'elements'],
    additionalProperties: false
  },
  validate(input, ctx) {
    const bad = checkStrings(input, ['liste'])
    if (bad) return bad
    const ajouts = ajoutsDe(input)
    if (typeof ajouts === 'string') return ajouts
    const p = partageDemande(input, ctx)
    return typeof p === 'string' ? p : null
  },
  async run(input, ctx) {
    const uid = ctx.user.id
    const ajouts = ajoutsDe(input) as Ajout[]
    const trouvee = resoudre(input.liste, ctx)
    if (typeof trouvee === 'string' && /plusieurs listes/.test(trouvee)) return { content: trouvee, isError: true, summary: 'Liste ambiguë' }
    const p = partageDemande(input, ctx) as Exclude<Partager, string> | null
    const nouvelle = typeof trouvee === 'string'
    const l = nouvelle ? creerListe(uid, nomPropre(String(input.liste)), p?.partage ?? 'prive', p?.membres ?? []) : trouvee
    const r = ajouterElements(uid, l.id, ajouts)!
    const ajoutes = r.ajoutes.length ? `Ajouté : ${textes(r.ajoutes)}.` : ''
    const deja = r.deja.length ? ` Déjà dessus : ${textes(r.deja)}.` : ''
    const restants = elementsDe(uid, l.id).filter((e) => !e.coche).length
    return {
      content: `${nouvelle ? `Liste « ${l.nom} » créée (${tel(l, ctx)}). ` : `Liste « ${l.nom} » (${tel(l, ctx)}). `}${ajoutes}${deja} ${restants} à prendre. Confirme en une phrase courte.`.replace(/\s+/g, ' '),
      summary: `Liste « ${l.nom} » : ${textes([...r.ajoutes, ...r.deja])}`,
      view: listeView(uid, getListe(uid, l.id)!, [...r.ajoutes, ...r.deja].map((e) => e.id))
    }
  }
}

export const listeCheck: Tool = {
  name: 'liste_cocher',
  description: 'Coche des éléments d’une liste (« j’ai pris le pain et le lait », « c’est fait pour le garage ») ; « coche » à false pour les remettre (« finalement, il faut encore du lait »).',
  risk: 'preparation',
  ui: { kind: 'liste', title: () => 'Liste' },
  input_schema: { type: 'object', properties: { liste: LISTE, elements: ELEMENTS_REFS, coche: { type: 'boolean', description: 'false : décocher. Par défaut true.' } }, required: ['liste', 'elements'], additionalProperties: false },
  validate(input, ctx) {
    const l = resoudre(input.liste, ctx)
    if (typeof l === 'string') return l
    if (!Array.isArray(input.elements) || !input.elements.length) return 'Champ « elements » : au moins un élément.'
    const d = designer(elementsDe(ctx.user.id, l.id), input.elements)
    return 'erreur' in d ? d.erreur : null
  },
  async run(input, ctx) {
    const uid = ctx.user.id
    const l = resoudre(input.liste, ctx) as Liste
    const d = designer(elementsDe(uid, l.id), Array.isArray(input.elements) ? input.elements : [])
    if ('erreur' in d) return { content: d.erreur, isError: true, summary: `Liste « ${l.nom} » : élément introuvable` }
    const coche = input.coche !== false
    const faits = cocherElements(uid, l.id, d.ids, coche)!
    const restants = elementsDe(uid, l.id).filter((e) => !e.coche).length
    const quoi = faits.length ? `${coche ? 'Coché' : 'Remis dans la liste'} : ${textes(faits)}.` : coche ? 'C’était déjà coché.' : 'Ce n’était pas coché.'
    return {
      content: `${quoi} Liste « ${l.nom} » : ${restants === 0 ? 'tout est pris' : `${restants} à prendre`}. Confirme en quelques mots.`,
      summary: `Liste « ${l.nom} » : ${coche ? 'coché' : 'décoché'} ${textes(faits) || '(rien)'}`,
      view: listeView(uid, getListe(uid, l.id)!, d.ids)
    }
  }
}

export const listeRemove: Tool = {
  name: 'liste_retirer',
  description: 'Retire des éléments d’une liste (« enlève les œufs »), ou tout ce qui est coché avec « coches » (« vide ce qui est pris »).',
  risk: 'preparation',
  ui: { kind: 'liste', title: () => 'Liste' },
  input_schema: { type: 'object', properties: { liste: LISTE, elements: ELEMENTS_REFS, coches: { type: 'boolean', description: 'true : retirer tout ce qui est coché.' } }, required: ['liste'], additionalProperties: false },
  validate(input, ctx) {
    const l = resoudre(input.liste, ctx)
    if (typeof l === 'string') return l
    if (input.coches === true) return null
    if (!Array.isArray(input.elements) || !input.elements.length) return 'Donne « elements », ou « coches » à true.'
    const d = designer(elementsDe(ctx.user.id, l.id), input.elements)
    return 'erreur' in d ? d.erreur : null
  },
  async run(input, ctx) {
    const uid = ctx.user.id
    const l = resoudre(input.liste, ctx) as Liste
    const avant = elementsDe(uid, l.id)
    const d = input.coches === true ? { coches: true as const } : designer(avant, Array.isArray(input.elements) ? input.elements : [])
    if ('erreur' in d) return { content: d.erreur, isError: true, summary: `Liste « ${l.nom} » : élément introuvable` }
    const cible = d
    const retires = 'coches' in cible ? avant.filter((e) => e.coche) : avant.filter((e) => cible.ids.includes(e.id))
    retirerElements(uid, l.id, cible)
    return {
      content: retires.length ? `Retiré de « ${l.nom} » : ${textes(retires)}.` : `Rien à retirer de « ${l.nom} ».`,
      summary: `Liste « ${l.nom} » : retiré ${retires.length}`,
      view: listeView(uid, getListe(uid, l.id)!)
    }
  }
}

/** Le créateur seul partage, renomme ou supprime une liste. */
function aLui(l: Liste, ctx: ToolContext, quoi: string): string | null {
  return l.auteur === ctx.user.id ? null : `Seule la personne qui a créé la liste « ${l.nom} » (${personne(l.auteur).prenom}) peut ${quoi}.`
}

export const listeShare: Tool = {
  name: 'liste_partager',
  description: 'Change qui voit une liste : « tous » (toute la maison), « personnes » (prénoms dans « personnes »), ou « prive ». Peut aussi la renommer (« nom »). Seul son créateur le peut.',
  risk: 'preparation',
  ui: { kind: 'liste', title: () => 'Partage de liste' },
  input_schema: {
    type: 'object',
    properties: { liste: LISTE, partage: { type: 'string', enum: ['prive', 'tous', 'personnes'] }, personnes: { type: 'array', items: { type: 'string' } }, nom: { type: 'string', description: 'Nouveau nom.' } },
    required: ['liste'],
    additionalProperties: false
  },
  validate(input, ctx) {
    const l = resoudre(input.liste, ctx)
    if (typeof l === 'string') return l
    const bad = checkStrings(input, [], ['nom'])
    if (bad) return bad
    const p = partageDemande(input, ctx)
    if (typeof p === 'string') return p
    if (!p && !(typeof input.nom === 'string' && input.nom.trim())) return 'Rien à changer : donne « partage » ou « nom ».'
    return aLui(l, ctx, 'la partager ou la renommer')
  },
  async run(input, ctx) {
    const uid = ctx.user.id
    let l = resoudre(input.liste, ctx) as Liste
    const p = partageDemande(input, ctx) as Exclude<Partager, string> | null
    if (typeof input.nom === 'string' && input.nom.trim()) l = renommerListe(uid, l.id, nomPropre(input.nom)) ?? l
    if (p) l = partagerListe(uid, l.id, p.partage, p.membres) ?? l
    ctx.log(`Liste « ${l.nom} » : ${tel(l, ctx)}`)
    return { content: `Liste « ${l.nom} » : ${tel(l, ctx)}. Elle s’affiche chez chacun. Confirme en une phrase.`, summary: `Liste « ${l.nom} » : ${tel(l, ctx)}`, view: listeView(uid, l) }
  }
}

export const listeDelete: Tool = {
  name: 'liste_supprimer',
  description: 'Supprime une liste entière, chez tous ceux qui la voient. Action sensible : une carte de validation s’affiche, rien n’est supprimé sans « oui ». Seul son créateur le peut. Pour vider ce qui est coché : liste_retirer.',
  risk: 'sensible',
  ui: { kind: 'liste', title: () => 'Supprimer une liste' },
  input_schema: { type: 'object', properties: { liste: LISTE }, required: ['liste'], additionalProperties: false },
  validate(input, ctx) {
    const l = resoudre(input.liste, ctx)
    return typeof l === 'string' ? l : aLui(l, ctx, 'la supprimer')
  },
  async run(input, ctx) {
    const uid = ctx.user.id
    const l = resoudre(input.liste, ctx) as Liste
    const n = elementsDe(uid, l.id).length
    ctx.requestConfirmation('Supprimer une liste', `« ${l.nom} » · ${n} élément${n > 1 ? 's' : ''} · ${partageDe(l, uid).libelle}`, async () => {
      supprimerListe(uid, l.id)
      ctx.log(`Liste supprimée : « ${l.nom} »`)
      ctx.announce('C’est supprimé.')
    })
    return {
      content: `En attente de validation : supprimer la liste « ${l.nom} » (${n} éléments, ${tel(l, ctx)}). Une carte est affichée. Dis-le en une phrase et demande son accord ; ne prétends pas que c'est fait.`,
      summary: `Suppression demandée : liste « ${l.nom} »`,
      view: listeView(uid, l)
    }
  }
}

export const listeTools: Tool[] = [listesShow, listeAdd, listeCheck, listeRemove, listeShare, listeDelete]
