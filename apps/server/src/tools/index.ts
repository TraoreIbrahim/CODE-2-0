import type Anthropic from '@anthropic-ai/sdk'
import type { ProfilId, UiData, UiKind } from '@code/protocol'
import { FICHIERS } from './fichiers-outils.ts'
import { parLePont } from '../pont/pont.ts'
import { forget, learnWord, memoireVoir, remember } from './memory.ts'
import { persoTools } from './perso.ts'
import { reminderTools } from './rappels.ts'
import { taskTools } from './taches.ts'
import { echeanceTools } from './echeances.ts'
import { documentTools } from './documents.ts'
import { listeTools } from './listes.ts'
import { itinerary } from './itineraire.ts'
import { mailTools } from './mail.ts'
import { listBoites } from '../mail/boites.ts'
import { weather } from './meteo.ts'
import { showWebResults } from './web.ts'
import { conversationMode } from './ecoute.ts'
import { codeConfig } from '../../../../config/code.config.ts'
import { connecteurTools } from '../connecteurs/registre.ts'
import { competenceTools } from './competences.ts'
import { reunionTools } from './reunions.ts'
import type { Tool, ToolContext } from './types.ts'

export type { ToolContext } from './types.ts'

/** Sur place si le serveur tourne sur l'ordinateur ; sinon par le pont, exécutés par l'app de bureau. */
export const FILE_TOOLS: Tool[] = FICHIERS.map(parLePont)
const FILE_NAMES = new Set(FILE_TOOLS.map((t) => t.name))

/** Ce qui décide des outils d'un utilisateur : ses fichiers (app de bureau reliée), ses boîtes, ses connecteurs, son profil. */
export type ToolScope = Pick<ToolContext, 'fichiers' | 'unattended'> & { user?: Pick<ToolContext['user'], 'id'> & { proprietaire?: boolean; reglages?: { profil: ProfilId } } }

/**
 * Outils locaux (mémoire, fichiers, Gmail, Agenda) + outils des connecteurs de l'utilisateur, dans un ordre
 * stable pour le cache.
 */
function allTools(scope: ToolScope): Tool[] {
  // L'affichage des résultats web n'a de sens que si Claude a la recherche web.
  const web = codeConfig.brain.web.enabled ? [showWebResults] : []
  // Boîtes mail IMAP (adresse pro…) : leurs outils seulement si la personne en a relié une.
  const mail = scope.user && listBoites(scope.user.id).length ? mailTools : []
  // Le micro d'un appareil : rien à régler dans une tâche planifiée.
  const ecoute = scope.unattended ? [] : [conversationMode]
  // Connecteurs MCP (GitHub, Figma…) : en dernier, décrits à Claude seulement quand il les cherche.
  const connecteurs = scope.user ? connecteurTools(scope.user.id) : []
  // Ses compétences (méthodes en fichiers texte) : la lecture n'est proposée que s'il en a.
  const competences = scope.user ? competenceTools(scope.user.id) : []
  return [remember, forget, memoireVoir, learnWord, ...competences, ...(scope.fichiers ? FILE_TOOLS : []), ...persoTools, ...mail, ...reminderTools, ...listeTools, ...echeanceTools, ...documentTools, ...reunionTools(scope.unattended), ...taskTools, weather, itinerary, ...ecoute, ...web, ...connecteurs]
}

/**
 * Les outils décrits au modèle à chaque appel : les plus demandés, selon le profil. Les autres (fichiers,
 * actions secondaires, connecteurs) ne sont décrits qu'une fois trouvés par la recherche d'outils :
 * leurs descriptions faisaient l'essentiel de chaque requête (≈ 75 000 tokens).
 */
const SOCLE = ['memoire_retenir', 'memoire_oublier', 'memoire_voir', 'competence_lire', 'competences_lister', 'gmail_importants', 'mails_importants', 'agenda_evenements', 'rappel_creer', 'rappels_lister', 'meteo', 'web_resultats_afficher', 'document_lire', 'document_ranger', 'listes_voir', 'liste_ajouter', 'liste_cocher', 'reunion_lire', 'reunions_lister', 'reunion_ranger']

/** Ce que chaque profil a en plus sous la main (dont tout ce que demande son briefing). */
export const OUTILS_PROFIL: Record<ProfilId, string[]> = {
  general: ['gmail_rechercher', 'gmail_lire_fil', 'gmail_piece_jointe', 'taches_lister', 'fichiers_lister', 'fichiers_chercher', 'fichiers_afficher', 'projet_etat', 'contacts_chercher', 'documents_retrouver'],
  developpeur: ['gmail_rechercher', 'gmail_lire_fil', 'taches_lister', 'tache_resultat', 'fichiers_lister', 'fichiers_chercher', 'fichiers_afficher', 'fichiers_lire', 'projet_etat'],
  secretariat: ['gmail_rechercher', 'gmail_lire_fil', 'gmail_piece_jointe', 'gmail_brouillon', 'agenda_disponibilites', 'agenda_creer', 'agenda_annuler', 'contacts_chercher', 'rappel_reporter', 'drive_rechercher', 'fichiers_chercher', 'fichiers_afficher', 'documents_retrouver'],
  administration: ['gmail_rechercher', 'gmail_lire_fil', 'gmail_piece_jointe', 'drive_rechercher', 'drive_lire', 'drive_creer_tableur', 'tableur_ecrire', 'contacts_chercher', 'echeance_ajouter', 'echeances_lister', 'echeance_regler', 'documents_retrouver', 'taches_lister', 'fichiers_chercher', 'fichiers_afficher'],
  foyer: ['gmail_rechercher', 'agenda_creer', 'rappel_terminer', 'rappel_reporter', 'liste_retirer', 'liste_partager', 'echeance_ajouter', 'echeances_lister', 'echeance_regler', 'documents_retrouver', 'itineraire']
}

/** Les outils décrits d'avance pour un profil. */
export function outilsCharges(profil: ProfilId = 'general'): ReadonlySet<string> {
  return new Set([...SOCLE, ...(OUTILS_PROFIL[profil] ?? OUTILS_PROFIL.general)])
}

/** Ceux de l'usage général : la règle des outils qui n'ont pas reçu de profil (banc d'essai, outils du web ajoutés). */
export const ALWAYS_LOADED: ReadonlySet<string> = outilsCharges('general')

/** Décrit seulement quand le modèle le cherche (connecteurs, outils moins demandés, hors du profil). */
export const isDeferred = (t: Tool): boolean => t.deferred ?? !ALWAYS_LOADED.has(t.name)

function byName(name: string, scope: ToolScope & { outils?: Tool[] }): Tool | undefined {
  return (scope.outils ?? allTools(scope)).find((t) => t.name === name)
}

/** Outil de fichiers de l'ordinateur (réservé à l'utilisateur dont l'app de bureau est reliée). */
export function isFileTool(name: string): boolean {
  return FILE_NAMES.has(name)
}

/** Ce qu'une tâche planifiée peut utiliser seule : lire et préparer, jamais d'action sensible ni de gestion des tâches. */
export function unattendedAllowed(t: Tool): boolean {
  return t.risk !== 'sensible' && !t.name.startsWith('tache')
}

/**
 * Les outils d'un utilisateur, tous moteurs confondus (une tâche planifiée n'a que ceux qu'elle peut lancer
 * seule) ; chacun marqué différé ou non selon son profil.
 */
export function toolsFor(scope: ToolScope): Tool[] {
  const charges = outilsCharges(scope.user?.reglages?.profil)
  return allTools(scope)
    .filter((t) => !scope.unattended || unattendedAllowed(t))
    .map((t) => (t.deferred === true ? t : { ...t, deferred: !charges.has(t.name) }))
}

/**
 * Définitions envoyées à Claude. L'entrée arrive en streaming ; on la valide nous-mêmes avant exécution.
 * Les outils des connecteurs sont différés : Claude les trouve par la recherche d'outils, ajoutée s'il y en a.
 */
export function toolDefinitions(scope: ToolScope): Anthropic.Beta.BetaToolUnion[] {
  return claudeDefinitions(toolsFor(scope))
}

export function claudeDefinitions(tools: Tool[]): Anthropic.Beta.BetaToolUnion[] {
  const defs: Anthropic.Beta.BetaToolUnion[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    eager_input_streaming: true,
    ...(isDeferred(t) ? { defer_loading: true } : {})
  }))
  return tools.some(isDeferred) ? [...defs, { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' }] : defs
}

export type ToolRun = {
  block: Anthropic.Beta.BetaToolResultBlockParam
  summary: string
  risk: Tool['risk'] | 'inconnu'
  view?: UiData
  failed: boolean
}

/** Le panneau à afficher pendant l'exécution d'un appel, s'il y en a un. */
export function toolUi(name: string, input: unknown, scope: ToolScope): { kind: UiKind; title: string } | null {
  const tool = byName(name, scope)
  if (!tool?.ui) return null
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return { kind: tool.ui.kind, title: tool.ui.title(args) }
}

/**
 * Un seul champ obligatoire manque et un seul champ inconnu le remplace (`{ fil: "Léa" }` au lieu de
 * `{ conversation: "Léa" }`, vu avec le modèle rapide) : on le renomme plutôt que d'afficher un échec.
 */
export function repairInput(tool: Pick<Tool, 'input_schema'>, input: Record<string, unknown>): Record<string, unknown> {
  const known = Object.keys(tool.input_schema.properties ?? {})
  const missing = (tool.input_schema.required ?? []).filter((k) => input[k] === undefined)
  const unknown = Object.keys(input).filter((k) => !known.includes(k))
  if (missing.length !== 1 || unknown.length !== 1) return input
  const { [unknown[0]!]: value, ...rest } = input
  return { ...rest, [missing[0]!]: value }
}

/** Un appel d'outil, quel que soit le moteur. */
export type ToolCall = { id: string; name: string; input: unknown }

/**
 * Exécute un appel d'outil du modèle. Les erreurs reviennent au modèle (is_error) pour qu'il s'adapte.
 * `ctx.outils` : la boîte à outils de cet échange, si elle n'est pas celle de l'utilisateur (outils web des
 * autres moteurs, outils simulés du banc d'essai).
 */
export async function runTool(use: ToolCall, ctx: ToolContext): Promise<ToolRun> {
  const tool = byName(use.name, ctx)
  const fail = (content: string, summary: string, risk: ToolRun['risk']): ToolRun => ({
    block: { type: 'tool_result', tool_use_id: use.id, is_error: true, content },
    summary,
    risk,
    failed: true
  })
  if (!tool) return fail(`Outil inconnu : ${use.name}`, `Outil inconnu : ${use.name}`, 'inconnu')
  if (ctx.unattended && !unattendedAllowed(tool)) {
    return fail(`${tool.name} est interdit dans une tâche planifiée : personne n'est là pour valider. Propose-le dans ton résultat.`, `${tool.name} : refusé (tâche planifiée)`, tool.risk)
  }
  const input = repairInput(tool, (use.input && typeof use.input === 'object' ? use.input : {}) as Record<string, unknown>)
  const invalid = tool.validate(input, ctx)
  if (invalid) return fail(JSON.stringify({ INVALID_JSON: JSON.stringify(input), raison: invalid }), `${tool.name} : entrée invalide`, tool.risk)
  try {
    const result = await tool.run(input, ctx)
    return {
      block: { type: 'tool_result', tool_use_id: use.id, content: result.content, ...(result.isError ? { is_error: true } : {}) },
      summary: result.summary,
      risk: tool.risk,
      view: result.view,
      failed: !!result.isError
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail(`Échec : ${message}`, `${tool.name} : échec`, tool.risk)
  }
}
