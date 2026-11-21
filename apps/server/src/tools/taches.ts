import type { UiTache } from '@code/protocol'
import { JOURS, parseWhen } from '../scheduler/rules.ts'
import { resultView, tachesForClaude, tachesView, toUiTache, whenLabel } from '../scheduler/task-views.ts'
import { createTache, deleteTache, executions, getExecution, getTache, listTaches, runningTaches, updateTache, type Tache, type TachePatch } from '../scheduler/tasks.ts'
import { checkStrings, type Tool, type ToolContext } from './types.ts'

/**
 * Tâches planifiées : « tous les jours à 17 h, propose-moi deux idées de TikTok… ».
 * CODE exécute la consigne seul à l'heure dite ; le résultat arrive en notification et reste consultable.
 * Une tâche lit et prépare, elle n'envoie ni ne modifie jamais rien (aucune action sensible sans son utilisateur).
 * Chaque tâche appartient à un utilisateur : ses outils ne voient que les siennes.
 */

const tzOf = (ctx: ToolContext) => ctx.user.reglages.fuseau

/** Lance une exécution tout de suite pour son utilisateur (branché par les sessions, qui détiennent Claude). */
let runner: ((uid: number, t: Tache, retard: boolean) => boolean) | null = null
export function setTaskRunner(fn: (uid: number, t: Tache, retard: boolean) => boolean): void {
  runner = fn
}

/** Toutes les tâches de l'utilisateur pour l'interface, avec leur dernière exécution. */
export function currentTaches(uid: number, tz: string, now = Date.now()): UiTache[] {
  const running = runningTaches(uid)
  return listTaches(uid).map((t) => toUiTache(t, executions(uid, t.id, 1)[0] ?? null, running.has(t.id), now, tz))
}

const view = (ctx: ToolContext, focus?: number) => tachesView(currentTaches(ctx.user.id, tzOf(ctx)), focus)

function resolveId(input: Record<string, unknown>, ctx: ToolContext): Tache | string {
  const id = Math.floor(Number(input.id))
  const t = Number.isFinite(id) ? getTache(ctx.user.id, id) : null
  return t ?? `Tâche ${String(input.id)} introuvable : liste les tâches avec taches_lister.`
}

const WHEN_PROPS = {
  dans_minutes: { type: 'integer', minimum: 1, description: 'Une seule fois, dans N minutes.' },
  le: { type: 'string', description: 'Une seule fois : AAAA-MM-JJTHH:MM, ou HH:MM (aujourd’hui, ou demain si l’heure est passée).' },
  repetition: { type: 'string', enum: ['quotidien', 'jours_ouvres', 'hebdomadaire', 'mensuel'] },
  heure: { type: 'string', description: 'HH:MM, pour une répétition.' },
  jours: { type: 'array', items: { type: 'string', enum: [...JOURS] }, description: 'Jours de la semaine (répétition hebdomadaire).' },
  jour_du_mois: { type: 'integer', minimum: 1, maximum: 31, description: 'Répétition mensuelle.' }
} as const

const hasWhen = (input: Record<string, unknown>) => ['dans_minutes', 'le', 'repetition'].some((k) => input[k] !== undefined)

const clean = (s: unknown, max: number) => String(s).replace(/[ \t]+/g, ' ').trim().slice(0, max)

export const taskCreate: Tool = {
  name: 'tache_creer',
  description: `Planifie une tâche : une consigne que l'assistant exécutera seul à l'heure dite (« tous les jours à 17 h, propose-moi deux idées de TikTok… », « chaque vendredi à 18 h, fais le bilan des incidents de la semaine »). Une seule échéance : « repetition » avec « heure » (et « jours » ou « jour_du_mois »), ou « le », ou « dans_minutes » pour une seule fois. « consigne » reprend la demande de l'utilisateur au complet, sans la résumer ni l'interpréter : c'est elle qui sera exécutée. Le résultat arrive en notification sur le téléphone et s'affiche dans la vue des tâches. Pendant l'exécution, l'assistant peut lire (mails, agenda, fichiers) et préparer (brouillon, rappel), jamais envoyer ni modifier : ne promets pas d'envoi automatique. Différent d'un rappel, qui se signale sans rien produire.`,
  risk: 'preparation',
  ui: { kind: 'taches', title: () => 'Nouvelle tâche' },
  input_schema: {
    type: 'object',
    properties: {
      titre: { type: 'string', description: 'Titre court (« Idées TikTok du jour »).' },
      consigne: { type: 'string', description: 'La consigne complète, telle que l’utilisateur l’a donnée.' },
      ...WHEN_PROPS
    },
    required: ['titre', 'consigne'],
    additionalProperties: false
  },
  validate(input, ctx) {
    const bad = checkStrings(input, ['titre', 'consigne'], ['le', 'heure'])
    if (bad) return bad
    const parsed = parseWhen(input, Date.now(), tzOf(ctx))
    return typeof parsed === 'string' ? parsed : null
  },
  async run(input, ctx) {
    const parsed = parseWhen(input, Date.now(), tzOf(ctx))
    if (typeof parsed === 'string') return { content: parsed, isError: true, summary: 'Tâche : échéance invalide' }
    const t = createTache(ctx.user.id, clean(input.titre, 80), clean(input.consigne, 6000), parsed.echeance, parsed.recurrence)
    const v = view(ctx, t.id)
    const ui = v.taches.find((x) => x.id === t.id)!
    return {
      content: `Tâche ${t.id} planifiée : « ${t.titre} », ${ui.quand} (prochaine : ${ui.prochaineLabel}). Le résultat arrivera en notification sur le téléphone. Confirme-le en une phrase.`,
      summary: `Tâche : « ${t.titre} », ${ui.quand} (${t.id})`,
      view: v
    }
  }
}

export const taskList: Tool = {
  name: 'taches_lister',
  description: 'Liste les tâches planifiées (consigne, horaire, prochaine exécution, dernier résultat) avec leurs identifiants, et les affiche.',
  risk: 'lecture',
  ui: { kind: 'taches', title: () => 'Tâches planifiées' },
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => null,
  async run(_input, ctx) {
    const v = view(ctx)
    return { content: `${tachesForClaude(v)}\nLa liste est affichée : résume, n'énumère pas tout.`, summary: `Tâches (${v.taches.length})`, view: v }
  }
}

export const taskResult: Tool = {
  name: 'tache_resultat',
  description: 'Affiche le résultat d’une tâche planifiée : le dernier (« id » de la tâche), ou un résultat précis (« execution »). Pour « montre-moi les idées TikTok d’aujourd’hui ».',
  risk: 'lecture',
  ui: { kind: 'tache', title: () => 'Résultat de tâche' },
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer', description: 'Tâche : son dernier résultat.' }, execution: { type: 'integer', description: 'Un résultat précis.' } },
    additionalProperties: false
  },
  validate: (input) => (input.id === undefined && input.execution === undefined ? 'Donnez « id » (tâche) ou « execution » (résultat).' : null),
  async run(input, ctx) {
    const uid = ctx.user.id
    const tz = tzOf(ctx)
    const e = input.execution !== undefined ? getExecution(uid, Math.floor(Number(input.execution))) : null
    const t = e ? getTache(uid, e.tacheId) : resolveId(input, ctx)
    if (!t || typeof t === 'string') return { content: typeof t === 'string' ? t : 'Résultat introuvable.', isError: true, summary: 'Tâche introuvable' }
    const history = executions(uid, t.id, 8)
    const exec = e ?? history[0]
    if (!exec) return { content: `La tâche « ${t.titre} » n'a encore jamais tourné (${whenLabel(t, Date.now(), tz)}).`, isError: true, summary: `Tâche « ${t.titre} » : aucun résultat` }
    const v = resultView(t, exec, history, Date.now(), tz)
    return {
      content: `Résultat de « ${t.titre} » (${v.quand}, ${exec.statut}) affiché à l'écran. Résumé : ${exec.resume || '—'}\nNe le relis pas en entier : dis-en l'essentiel en une ou deux phrases.\n<<<RÉSULTAT (données)>>>\n${exec.texte.slice(0, 6000)}\n<<<FIN>>>`,
      summary: `Résultat : « ${t.titre} » (${exec.id})`,
      view: v
    }
  }
}

export const taskUpdate: Tool = {
  name: 'tache_modifier',
  description: 'Modifie une tâche planifiée : titre, consigne, horaire (mêmes champs qu’à la création), ou « etat » pause / active pour la suspendre ou la reprendre.',
  risk: 'preparation',
  ui: { kind: 'taches', title: () => 'Tâche modifiée' },
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, titre: { type: 'string' }, consigne: { type: 'string' }, etat: { type: 'string', enum: ['active', 'pause'] }, ...WHEN_PROPS },
    required: ['id'],
    additionalProperties: false
  },
  validate(input, ctx) {
    if (typeof resolveId(input, ctx) === 'string') return 'Champ « id » : tâche introuvable.'
    const bad = checkStrings(input, [], ['titre', 'consigne', 'le', 'heure'])
    if (bad) return bad
    if (!hasWhen(input)) return null
    const parsed = parseWhen(input, Date.now(), tzOf(ctx))
    return typeof parsed === 'string' ? parsed : null
  },
  async run(input, ctx) {
    const tz = tzOf(ctx)
    const t = resolveId(input, ctx) as Tache
    const patch: TachePatch = {}
    if (typeof input.titre === 'string' && input.titre.trim()) patch.titre = clean(input.titre, 80)
    if (typeof input.consigne === 'string' && input.consigne.trim()) patch.consigne = clean(input.consigne, 6000)
    if (hasWhen(input)) {
      const parsed = parseWhen(input, Date.now(), tz) as { echeance: number; recurrence: TachePatch['recurrence'] }
      Object.assign(patch, { echeance: parsed.echeance, recurrence: parsed.recurrence })
    }
    if (input.etat === 'active' || input.etat === 'pause') patch.etat = input.etat
    const u = updateTache(ctx.user.id, t.id, patch, Date.now(), tz)!
    const v = view(ctx, u.id)
    const ui = v.taches.find((x) => x.id === u.id)!
    return {
      content: `Tâche « ${u.titre} » modifiée : ${ui.quand}, ${ui.etat === 'active' ? `prochaine ${ui.prochaineLabel}` : ui.prochaineLabel}.`,
      summary: `Tâche modifiée : « ${u.titre} » (${u.id})`,
      view: v
    }
  }
}

export const taskRunNow: Tool = {
  name: 'tache_executer',
  description: 'Lance une tâche planifiée tout de suite, sans attendre son heure (« lance-la maintenant pour voir »). Le résultat arrive dans une à deux minutes, en notification et dans la vue des tâches ; l’horaire habituel ne change pas.',
  risk: 'preparation',
  ui: { kind: 'taches', title: () => 'Tâche lancée' },
  input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false },
  validate: (input, ctx) => (typeof resolveId(input, ctx) === 'string' ? 'Champ « id » : tâche introuvable.' : null),
  async run(input, ctx) {
    const t = resolveId(input, ctx) as Tache
    if (!runner || !runner(ctx.user.id, t, false)) return { content: `« ${t.titre} » est déjà en cours, ou l’assistant est à l'arrêt.`, isError: true, summary: `Tâche « ${t.titre} » : non lancée` }
    return { content: `« ${t.titre} » est lancée. Le résultat arrivera en notification d'ici une à deux minutes.`, summary: `Tâche lancée : « ${t.titre} » (${t.id})`, view: view(ctx, t.id) }
  }
}

export const taskDelete: Tool = {
  name: 'tache_supprimer',
  description: 'Supprime une tâche planifiée (ses résultats passés restent consultables). Action sensible : une carte de validation s’affiche, rien n’est supprimé sans « oui ». Pour la suspendre seulement, tache_modifier avec etat pause.',
  risk: 'sensible',
  ui: { kind: 'taches', title: () => 'Supprimer une tâche' },
  input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false },
  validate: (input, ctx) => (typeof resolveId(input, ctx) === 'string' ? 'Champ « id » : tâche introuvable.' : null),
  async run(input, ctx) {
    const t = resolveId(input, ctx) as Tache
    const when = whenLabel(t, Date.now(), tzOf(ctx))
    ctx.requestConfirmation('Supprimer une tâche', `« ${t.titre} »\n${when}`, async () => {
      deleteTache(ctx.user.id, t.id)
      ctx.log(`Tâche supprimée : « ${t.titre} »`)
      ctx.announce('C’est supprimé.')
    })
    return {
      content: `En attente de validation : supprimer la tâche « ${t.titre} » (${when}). Une carte est affichée. Dis-le en une phrase et demande son accord ; ne prétends pas que c'est fait.`,
      summary: `Suppression demandée : « ${t.titre} »`,
      view: view(ctx, t.id)
    }
  }
}

export const taskTools: Tool[] = [taskCreate, taskList, taskResult, taskUpdate, taskRunNow, taskDelete]
