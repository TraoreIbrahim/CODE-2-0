import type { UiRappels } from '@code/protocol'
import { localDay, zonedTime } from '../google/calendar.ts'
import { JOURS, dayLabel, describeRecurrence, parseWhen, timeLabel } from '../scheduler/rules.ts'
import { activeRappels, createRappel, deleteRappel, doneSince, getRappel, markDone, snooze, type Rappel } from '../scheduler/store.ts'
import { rappelsForClaude, rappelsView, toUiRappel } from '../scheduler/views.ts'
import { addLog } from '../db.ts'
import { prenomDe, trouverPersonnes } from '../users/personnes.ts'
import type { Utilisateur } from '../users/users.ts'
import { checkStrings, type Tool, type ToolContext } from './types.ts'

/**
 * Rappels : « rappelle-moi dans 2 h d'appeler le fournisseur », « tous les lundis à 8 h… ».
 * Un rappel se signale (voix, miniature, cockpit), il n'agit jamais.
 */

/** Fuseau de l'utilisateur : « demain à neuf heures » se comprend à son heure. */
const tzOf = (ctx: ToolContext) => ctx.user.reglages.fuseau

const startOfToday = (now: number, tz: string) => zonedTime(localDay(now, tz), 0, tz).getTime()

export function rappelsViewOf(uid: number, tz: string, focus?: number): UiRappels {
  const now = Date.now()
  return rappelsView(activeRappels(uid), doneSince(uid, startOfToday(now, tz)), now, tz, focus)
}

const view = (ctx: ToolContext, focus?: number) => rappelsViewOf(ctx.user.id, tzOf(ctx), focus)

const when = (r: Rappel, tz: string) => (r.recurrence ? describeRecurrence(r.recurrence) : `${dayLabel(r.echeance, Date.now(), tz)} à ${timeLabel(r.echeance, tz)}`)

/** Champs d'échéance communs à la création et au report. */
const WHEN_SCHEMA = {
  dans_minutes: { type: 'integer', minimum: 1, description: 'Dans combien de minutes (« dans 2 h » = 120).' },
  le: { type: 'string', description: 'Date et heure locales AAAA-MM-JJTHH:MM, ou HH:MM (aujourd’hui, ou demain si l’heure est passée).' }
} as const

/** « Léo, Sam et vous » : les destinataires, la personne qui parle en dernier. */
export function joindre(noms: readonly string[]): string {
  return noms.length <= 1 ? (noms[0] ?? '') : `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}`
}

/**
 * Les destinataires d'un rappel : la personne qui parle, sauf « pour » (prénoms, « tous », « moi »). Un nom
 * inconnu est refusé : le rappel n'arrive jamais chez quelqu'un de deviné.
 */
function destinataires(input: Record<string, unknown>, ctx: ToolContext): Utilisateur[] | string {
  if (input.pour === undefined) return [ctx.user as Utilisateur]
  if (!Array.isArray(input.pour) || input.pour.some((p) => typeof p !== 'string')) return 'Champ « pour » : une liste de prénoms (ou « tous »).'
  const r = trouverPersonnes(ctx.user.id, input.pour as string[])
  return 'erreur' in r ? `Champ « pour » : ${r.erreur}` : r.personnes
}

/** Un rappel de cet utilisateur : l'identifiant d'un rappel d'un autre ne trouve rien. */
function resolveId(input: Record<string, unknown>, ctx: ToolContext): Rappel | string {
  const id = Math.floor(Number(input.id))
  const r = Number.isFinite(id) ? getRappel(ctx.user.id, id) : null
  return r ?? `Rappel ${String(input.id)} introuvable : liste les rappels avec rappels_lister.`
}

export const reminderCreate: Tool = {
  name: 'rappel_creer',
  description: `Crée un rappel : une seule échéance parmi « dans_minutes », « le » (heure locale de l'utilisateur) ou « repetition » avec « heure » (et « jours » pour hebdomadaire, « jour_du_mois » pour mensuel). Le rappel sonne à l'heure dite : tu le dis à voix haute et il s'affiche sur les écrans. Tu n'agis jamais toi-même. Le texte est ce qu'il faut rappeler, à l'infinitif ou en clair (« appeler le plombier »). « pour » : rappel donné à d'autres personnes de la maison (« rappelle à Léo… » → ["Léo"] ; « à toute la famille » → ["tous"], toi compris ; ajoute "moi" si la personne qui parle est aussi concernée). Il sonne chez chacun, de sa part.`,
  risk: 'preparation',
  ui: { kind: 'rappels', title: () => 'Nouveau rappel' },
  input_schema: {
    type: 'object',
    properties: {
      texte: { type: 'string', description: 'Ce qu’il faut rappeler.' },
      annonce: {
        type: 'string',
        description:
          'La phrase que tu diras quand le rappel sonnera, adressée à la personne dans son registre (vouvoiement ou tutoiement), complète et naturelle, sans salutation ni « je vous rappelle » (ajoutés automatiquement), avec l’heure dite comme on la dit (« vous avez rendez-vous avec Atlas à 19 h », « vous devez appeler le plombier »).'
      },
      ...WHEN_SCHEMA,
      repetition: { type: 'string', enum: ['quotidien', 'jours_ouvres', 'hebdomadaire', 'mensuel'] },
      heure: { type: 'string', description: 'HH:MM, pour une répétition.' },
      jours: { type: 'array', items: { type: 'string', enum: [...JOURS] }, description: 'Jours de la semaine (répétition hebdomadaire).' },
      jour_du_mois: { type: 'integer', minimum: 1, maximum: 31, description: 'Répétition mensuelle.' },
      pour: { type: 'array', items: { type: 'string' }, description: 'Prénoms des personnes de la maison à qui donner le rappel, « tous » pour toute la maison, « moi » pour toi. Absent : pour la personne qui parle.' }
    },
    required: ['texte'],
    additionalProperties: false
  },
  validate(input, ctx) {
    const bad = checkStrings(input, ['texte'], ['le', 'heure'])
    if (bad) return bad
    const qui = destinataires(input, ctx)
    if (typeof qui === 'string') return qui
    const parsed = parseWhen(input, Date.now(), tzOf(ctx))
    return typeof parsed === 'string' ? parsed : null
  },
  async run(input, ctx) {
    const tz = tzOf(ctx)
    const parsed = parseWhen(input, Date.now(), tz)
    if (typeof parsed === 'string') return { content: parsed, isError: true, summary: 'Rappel : échéance invalide' }
    const qui = destinataires(input, ctx)
    if (typeof qui === 'string') return { content: qui, isError: true, summary: 'Rappel : destinataire inconnu' }
    const texte = String(input.texte).replace(/\s+/g, ' ').trim().slice(0, 300)
    const annonce = typeof input.annonce === 'string' && input.annonce.trim() ? input.annonce.replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').slice(0, 300) : null
    const autres = qui.filter((u) => u.id !== ctx.user.id)
    if (autres.length) return pourAutres(ctx, qui, autres, texte, annonce, parsed)
    const r = createRappel(ctx.user.id, texte, parsed.echeance, parsed.recurrence, annonce)
    return {
      content: `Rappel ${r.id} enregistré : « ${texte} », ${when(r, tz)}${r.recurrence ? ` (prochain : ${dayLabel(r.echeance, Date.now(), tz)} à ${timeLabel(r.echeance, tz)})` : ''}. Confirme-le en une phrase.`,
      summary: `Rappel : « ${texte} », ${when(r, tz)} (${r.id})`,
      view: view(ctx, r.id)
    }
  }
}

/**
 * Un rappel donné à d'autres : un par personne, dans son compte, avec son auteur. L'annonce, écrite pour la
 * personne qui parle (son registre), ne sert qu'à elle ; les autres entendent le texte, « de la part de… ».
 */
function pourAutres(ctx: ToolContext, qui: Utilisateur[], autres: Utilisateur[], texte: string, annonce: string | null, parsed: { echeance: number; recurrence: Rappel['recurrence'] }) {
  const tz = tzOf(ctx)
  const now = Date.now()
  const moi = qui.find((u) => u.id === ctx.user.id)
  const auteur = prenomDe(ctx.user as Utilisateur)
  const mien = moi ? createRappel(ctx.user.id, texte, parsed.echeance, parsed.recurrence, annonce) : null
  const donnes = autres.map((u) => {
    const r = createRappel(u.id, texte, parsed.echeance, parsed.recurrence, null, ctx.user.id)
    addLog(u.id, 'systeme', `Rappel donné par ${auteur} : « ${texte} », ${when(r, tz)}`)
    return r
  })
  const noms = autres.map(prenomDe)
  const quand = when(donnes[0]!, tz)
  const v = view(ctx, mien?.id)
  // Ceux des autres, à part : « Pour Léo et Sam », sans leurs boutons (ils sont chez eux).
  v.groupes.unshift({ label: `Pour ${joindre(noms)}`, rappels: donnes.map((r) => ({ ...toUiRappel(r, now, tz), de: undefined })).map(({ de: _de, ...r }) => r) })
  return {
    content: `Rappel enregistré pour ${joindre([...noms, ...(mien ? ['toi'] : [])])} : « ${texte} », ${quand}. Il sonnera chez chacun, de la part de ${auteur}. Confirme-le en une phrase.`,
    summary: `Rappel pour ${joindre(noms)}${mien ? ' et soi' : ''} : « ${texte} », ${quand}`,
    view: v
  }
}

export const reminderList: Tool = {
  name: 'rappels_lister',
  description: 'Liste les rappels : ceux qui sonnent, ceux d’aujourd’hui, de demain, plus tard, les récurrents, et ceux faits aujourd’hui, avec leurs identifiants. Affiche la liste à l’écran.',
  risk: 'lecture',
  ui: { kind: 'rappels', title: () => 'Rappels' },
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => null,
  async run(_input, ctx) {
    const v = view(ctx)
    const n = activeRappels(ctx.user.id).length
    return { content: `${rappelsForClaude(v)}\nLa liste est affichée : résume, n'énumère pas tout.`, summary: `Rappels (${n})`, view: v }
  }
}

export const reminderSnooze: Tool = {
  name: 'rappel_reporter',
  description: 'Reporte un rappel (« dans_minutes » ou « le »). Pour un rappel récurrent, seule cette fois est reportée : la répétition continue.',
  risk: 'preparation',
  ui: { kind: 'rappels', title: () => 'Report de rappel' },
  input_schema: { type: 'object', properties: { id: { type: 'integer' }, ...WHEN_SCHEMA }, required: ['id'], additionalProperties: false },
  validate(input, ctx) {
    if (typeof resolveId(input, ctx) === 'string') return 'Champ « id » : rappel introuvable.'
    const parsed = parseWhen({ dans_minutes: input.dans_minutes, le: input.le }, Date.now(), tzOf(ctx))
    return typeof parsed === 'string' ? parsed : null
  },
  async run(input, ctx) {
    const tz = tzOf(ctx)
    const r = resolveId(input, ctx) as Rappel
    const parsed = parseWhen({ dans_minutes: input.dans_minutes, le: input.le }, Date.now(), tz) as { echeance: number }
    const moved = snooze(ctx.user.id, r.id, parsed.echeance)!
    return {
      content: `Rappel « ${r.texte} » reporté : ${dayLabel(moved.echeance, Date.now(), tz)} à ${timeLabel(moved.echeance, tz)}.`,
      summary: `Rappel reporté : « ${r.texte} » (${moved.id})`,
      view: view(ctx, moved.id)
    }
  }
}

export const reminderDone: Tool = {
  name: 'rappel_terminer',
  description: 'Marque un rappel comme fait (« c’est fait », « j’ai appelé »). Pour un récurrent : arrête seulement l’alerte en cours, la répétition continue.',
  risk: 'preparation',
  ui: { kind: 'rappels', title: () => 'Rappel fait' },
  input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false },
  validate: (input, ctx) => (typeof resolveId(input, ctx) === 'string' ? 'Champ « id » : rappel introuvable.' : null),
  async run(input, ctx) {
    const r = resolveId(input, ctx) as Rappel
    markDone(ctx.user.id, r.id, Date.now())
    return { content: `« ${r.texte} » : noté comme fait.`, summary: `Rappel fait : « ${r.texte} »`, view: view(ctx, r.id) }
  }
}

export const reminderDelete: Tool = {
  name: 'rappel_supprimer',
  description: 'Supprime un rappel (récurrent compris, toutes ses occurrences). Action sensible : une carte de validation s’affiche, rien n’est supprimé sans « oui ».',
  risk: 'sensible',
  ui: { kind: 'rappels', title: () => 'Supprimer un rappel' },
  input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false },
  validate: (input, ctx) => (typeof resolveId(input, ctx) === 'string' ? 'Champ « id » : rappel introuvable.' : null),
  async run(input, ctx) {
    const r = resolveId(input, ctx) as Rappel
    const tz = tzOf(ctx)
    ctx.requestConfirmation('Supprimer un rappel', `« ${r.texte} »\n${when(r, tz)}`, async () => {
      deleteRappel(ctx.user.id, r.id)
      ctx.log(`Rappel supprimé : « ${r.texte} »`)
      ctx.announce('C’est supprimé.')
    })
    return {
      content: `En attente de validation : supprimer le rappel « ${r.texte} » (${when(r, tz)}). Une carte est affichée. Dis-le en une phrase et demande son accord ; ne prétends pas que c'est fait.`,
      summary: `Suppression demandée : « ${r.texte} »`,
      view: view(ctx, r.id)
    }
  }
}

export const reminderTools: Tool[] = [reminderCreate, reminderList, reminderSnooze, reminderDone, reminderDelete]
