import type { EcheanceCategorie, EcheanceRecurrence, UiEcheancier } from '@code/protocol'
import { CATEGORIES, RECURRENCES, RECURRENCE_NOMS, dateValide, montantLisible } from '../echeances/regles.ts'
import { creerEcheance, echeancesARegler, getEcheance, modifierEcheance, reglerEcheance, regleesDepuis, supprimerEcheance, type Echeance, type NouvelleEcheance } from '../echeances/store.ts'
import { echeancierPourClaude, echeancierView } from '../echeances/vue.ts'
import { checkStrings, type Tool, type ToolContext } from './types.ts'

/**
 * L'échéancier : factures, loyer, impôts, assurances, abonnements, papiers à renouveler. L'assistant note,
 * rappelle avant la date et coche ce qui est réglé ; il ne paie jamais rien lui-même.
 */

const tzOf = (ctx: ToolContext) => ctx.user.reglages.fuseau
const TRENTE_JOURS = 30 * 86_400_000

export function echeancierOf(uid: number, tz: string, focus?: number): UiEcheancier {
  const now = Date.now()
  return echeancierView(echeancesARegler(uid), regleesDepuis(uid, now - TRENTE_JOURS), now, tz, focus)
}

const vue = (ctx: ToolContext, focus?: number) => echeancierOf(ctx.user.id, tzOf(ctx), focus)

export const decrire = (e: Echeance) => `« ${e.titre} » le ${e.date}${e.montant !== null ? `, ${montantLisible(e.montant, e.devise)}` : ''}${e.recurrence ? `, ${RECURRENCE_NOMS[e.recurrence]}` : ''}`

/** Champs communs à l'ajout et à la modification. */
export const CHAMPS = {
  titre: { type: 'string', description: 'Ce qui est dû, en clair (« Électricité », « Loyer », « Taxe foncière », « Passeport de Léa »).' },
  date: { type: 'string', description: 'Date limite, AAAA-MM-JJ (calcule-la si on te dit « le 15 », « fin du mois »).' },
  montant: { type: 'number', minimum: 0, description: 'Montant, si connu (nombre seul).' },
  devise: { type: 'string', description: 'Devise du montant : EUR, XOF, USD… (celle du document ; à défaut celle de l’utilisateur).' },
  categorie: { type: 'string', enum: [...CATEGORIES] },
  repetition: { type: 'string', enum: [...RECURRENCES, 'aucune'], description: 'Pour ce qui revient (loyer, abonnement) : la suivante est créée quand celle-ci est réglée. « aucune » retire la répétition.' },
  prevenir_jours: { type: 'integer', minimum: 0, maximum: 60, description: 'Jours de préavis du rappel, à 9 h (3 par défaut ; 0 : le jour même ; plus pour un papier à renouveler).' },
  note: { type: 'string', description: 'Référence, numéro de contrat, moyen de paiement, d’où vient l’échéance (mail, document).' }
} as const

export function checkChamps(input: Record<string, unknown>): string | null {
  const bad = checkStrings(input, [], ['titre', 'date', 'devise', 'note'])
  if (bad) return bad
  if (input.date !== undefined && !dateValide(String(input.date))) return 'Champ « date » : AAAA-MM-JJ, une date qui existe.'
  if (input.montant !== undefined && (typeof input.montant !== 'number' || !Number.isFinite(input.montant) || input.montant < 0)) return 'Champ « montant » : un nombre positif.'
  if (input.categorie !== undefined && !CATEGORIES.includes(input.categorie as EcheanceCategorie)) return `Champ « categorie » : ${CATEGORIES.join(', ')}.`
  if (input.repetition !== undefined && input.repetition !== 'aucune' && !RECURRENCES.includes(input.repetition as EcheanceRecurrence)) return `Champ « repetition » : ${RECURRENCES.join(', ')} ou aucune.`
  const p = input.prevenir_jours
  if (p !== undefined && (!Number.isInteger(p) || (p as number) < 0 || (p as number) > 60)) return 'Champ « prevenir_jours » : de 0 à 60.'
  return null
}

const texte = (v: unknown, max: number) => String(v).replace(/\s+/g, ' ').trim().slice(0, max)

/** Les champs donnés, nettoyés (pour l'ajout comme pour la modification). */
export function champsDe(input: Record<string, unknown>): Partial<NouvelleEcheance> {
  return {
    ...(input.titre !== undefined ? { titre: texte(input.titre, 120) } : {}),
    ...(input.date !== undefined ? { date: String(input.date) } : {}),
    ...(input.montant !== undefined ? { montant: Math.round(Number(input.montant) * 100) / 100 } : {}),
    ...(input.devise !== undefined ? { devise: texte(input.devise, 12) || null } : {}),
    ...(input.categorie !== undefined ? { categorie: input.categorie as EcheanceCategorie } : {}),
    ...(input.repetition !== undefined ? { recurrence: input.repetition === 'aucune' ? null : (input.repetition as EcheanceRecurrence) } : {}),
    ...(input.prevenir_jours !== undefined ? { prevenir: Number(input.prevenir_jours) } : {}),
    ...(input.note !== undefined ? { note: texte(input.note, 300) || null } : {})
  }
}

function resoudre(input: Record<string, unknown>, ctx: ToolContext): Echeance | string {
  const id = Math.floor(Number(input.id))
  const e = Number.isFinite(id) ? getEcheance(ctx.user.id, id) : null
  return e ?? `Échéance ${String(input.id)} introuvable : affiche l’échéancier avec echeances_lister.`
}

export const echeanceAdd: Tool = {
  name: 'echeance_ajouter',
  description:
    'Note une échéance dans l’échéancier : une facture, le loyer, un impôt, une assurance, un abonnement, un papier à renouveler (passeport, carte grise, contrôle technique). Un rappel sonnera quelques jours avant, à 9 h. Quand elle vient d’un mail ou d’un document, reprends exactement le montant, la devise et la date limite, et mets la référence en note. Tu ne paies jamais rien : tu notes et tu préviens.',
  risk: 'preparation',
  ui: { kind: 'echeancier', title: () => 'Nouvelle échéance' },
  input_schema: { type: 'object', properties: { ...CHAMPS }, required: ['titre', 'date'], additionalProperties: false },
  validate(input) {
    return checkStrings(input, ['titre', 'date']) ?? checkChamps(input)
  },
  async run(input, ctx) {
    const c = champsDe(input)
    const e = creerEcheance(
      ctx.user.id,
      { titre: c.titre!, date: c.date!, categorie: c.categorie ?? 'autre', montant: c.montant ?? null, devise: c.devise ?? null, recurrence: c.recurrence ?? null, prevenir: c.prevenir ?? 3, note: c.note ?? null },
      Date.now(),
      tzOf(ctx)
    )
    const rappel = e.rappelId ? `rappel ${e.prevenir ? `${e.prevenir} jour(s) avant` : 'le jour même'}, à 9 h` : 'pas de rappel (le préavis est déjà passé)'
    return {
      content: `Échéance ${e.id} notée : ${decrire(e)} ; ${rappel}. Confirme-le en une phrase.`,
      summary: `Échéance : ${decrire(e)} (${e.id})`,
      view: vue(ctx, e.id)
    }
  }
}

export const echeancesList: Tool = {
  name: 'echeances_lister',
  description: 'Affiche l’échéancier : ce qui est en retard, cette semaine, ce mois-ci et plus tard, avec les montants, et ce qui a été réglé ces 30 derniers jours. Pour « mes échéances », « qu’est-ce que je dois payer », « mes factures à venir ».',
  risk: 'lecture',
  ui: { kind: 'echeancier', title: () => 'Échéancier' },
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => null,
  async run(_input, ctx) {
    const v = vue(ctx)
    return { content: `${echeancierPourClaude(v)}\nL’échéancier est affiché : dis l’essentiel (retards, la plus proche, le total), pas la liste entière.`, summary: `Échéancier : ${v.sousTitre.toLowerCase()}`, view: v }
  }
}

export const echeancePay: Tool = {
  name: 'echeance_regler',
  description: 'Coche une échéance comme réglée (payée, faite, renouvelée) quand l’utilisateur le dit. Son rappel disparaît ; si elle revient (loyer, abonnement), la suivante est créée. Ne coche jamais sur la foi d’un mail : seulement sur sa parole.',
  risk: 'preparation',
  ui: { kind: 'echeancier', title: () => 'Échéance réglée' },
  input_schema: { type: 'object', properties: { id: { type: 'integer', description: 'Identifiant de l’échéance (« [échéance 12] »).' } }, required: ['id'], additionalProperties: false },
  validate: () => null,
  async run(input, ctx) {
    const e = resoudre(input, ctx)
    if (typeof e === 'string') return { content: e, isError: true, summary: 'Échéance introuvable' }
    const r = reglerEcheance(ctx.user.id, e.id, Date.now(), tzOf(ctx))
    if (!r) return { content: `L’échéance « ${e.titre} » est déjà réglée.`, summary: `Échéance déjà réglée : « ${e.titre} »`, view: vue(ctx) }
    return {
      content: `« ${e.titre} » est cochée comme réglée.${r.suivante ? ` La suivante est notée : ${decrire(r.suivante)} (échéance ${r.suivante.id}).` : ''} Confirme-le en une phrase.`,
      summary: `Échéance réglée : « ${e.titre} » (${e.id})`,
      view: vue(ctx, r.suivante?.id)
    }
  }
}

export const echeanceEdit: Tool = {
  name: 'echeance_modifier',
  description: 'Corrige une échéance à régler (date, montant, préavis, répétition, note…) : son rappel suit. Avec « supprimer » : la retire de l’échéancier (une erreur, un contrat résilié).',
  risk: 'preparation',
  ui: { kind: 'echeancier', title: () => 'Échéance modifiée' },
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, ...CHAMPS, supprimer: { type: 'boolean' } },
    required: ['id'],
    additionalProperties: false
  },
  validate: (input) => checkChamps(input),
  async run(input, ctx) {
    const e = resoudre(input, ctx)
    if (typeof e === 'string') return { content: e, isError: true, summary: 'Échéance introuvable' }
    if (input.supprimer === true) {
      supprimerEcheance(ctx.user.id, e.id)
      return { content: `« ${e.titre} » est retirée de l’échéancier, avec son rappel.`, summary: `Échéance retirée : « ${e.titre} » (${e.id})`, view: vue(ctx) }
    }
    if (e.etat !== 'a_regler') return { content: `« ${e.titre} » est déjà réglée : rien à modifier.`, isError: true, summary: 'Échéance déjà réglée' }
    const m = modifierEcheance(ctx.user.id, e.id, champsDe(input), Date.now(), tzOf(ctx))!
    return { content: `Échéance ${m.id} modifiée : ${decrire(m)}.`, summary: `Échéance modifiée : ${decrire(m)} (${m.id})`, view: vue(ctx, m.id) }
  }
}

export const echeanceTools: Tool[] = [echeanceAdd, echeancesList, echeancePay, echeanceEdit]
