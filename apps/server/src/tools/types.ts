import type Anthropic from '@anthropic-ai/sdk'
import type { UiData, UiKind } from '@code/protocol'
import type { PontMac } from '../pont/pont.ts'
import type { Utilisateur } from '../users/users.ts'

/** Niveaux de risque (docs/SPEC.md, 6.1). */
export type Risk = 'lecture' | 'preparation' | 'sensible'

export type ToolContext = {
  /** Pour qui l'outil tourne : ses rappels, ses tâches, sa mémoire, son compte Google. */
  user: Utilisateur
  /** Fichiers de l'ordinateur : seulement pour l'utilisateur dont l'app de bureau est reliée à ce serveur. */
  fichiers: boolean
  /** Met une action sensible en attente d'un « oui » ; `execute` ne tourne qu'après accord. */
  requestConfirmation(title: string, summary: string, execute: () => Promise<void>): void
  /** Ce que l'assistant dit une fois l'action validée et faite. */
  announce(text: string): void
  log(summary: string): void
  /** Tâche planifiée, sans personne pour valider : les actions sensibles et la gestion des tâches sont refusées. */
  unattended?: boolean
  /**
   * Position de l'appareil qui a posé la question (itinéraire), demandée à lui seul, une fois, et jamais gardée.
   * `erreur` : refusée ou indisponible ; null : pas d'appareil à qui la demander.
   */
  position?(): Promise<GeoPosition | { erreur: string } | null>
  /** Active ou coupe le mode conversation sur l'appareil qui a parlé ; `message` : ce qui s'est passé. */
  conversation?(actif: boolean): { ok: boolean; message: string }
  /** Demande à l'appareil qui a parlé de lancer, d'arrêter, de suspendre ou de reprendre l'enregistrement d'une réunion ; `message` : ce qui s'est passé. */
  reunion?(action: 'demarrer' | 'arreter' | 'pause' | 'reprendre', titre?: string): { ok: boolean; message: string }
  /** Le pont vers l'app de bureau de l'utilisateur, quand le serveur hébergé n'a pas ses fichiers lui-même. */
  pont?: PontMac
  /** Les outils de cet échange, quand ce ne sont pas ceux de l'utilisateur (voir `runTool`). */
  outils?: Tool[]
  /** Recherche web des moteurs qui n'en ont pas (Brave ou SearXNG), bornée par réponse. */
  rechercheWeb?: (requete: string, nombre: number) => Promise<ResultatWeb[]>
}

/** Un résultat de recherche web (outils web des autres moteurs). */
export type ResultatWeb = { titre: string; url: string; extrait: string; date?: string }

/** `appareil` : qui l'a donnée (« mac », « mobile »…) ; `precision` : rayon d'incertitude en mètres. */
export type GeoPosition = { lat: number; lng: number; precision?: number; appareil?: string }

/** Ce qu'un outil renvoie à Claude. */
export type ToolResult = {
  content: string | Anthropic.Beta.BetaToolResultBlockParam['content']
  isError?: boolean
  /** Une ligne pour le journal et l'écran (« Recherche : devis cuisine »). */
  summary: string
  /** Données pour l'interface de l'outil (panneau holographique). */
  view?: UiData
}

export type Tool = {
  name: string
  description: string
  risk: Risk
  input_schema: Anthropic.Beta.BetaTool.InputSchema
  /** Décrit à Claude seulement quand il le cherche (recherche d'outils) : les connecteurs en apportent des dizaines. */
  deferred?: boolean
  /** Panneau affiché pendant l'exécution, puis rempli avec `ToolResult.view`. */
  ui?: { kind: UiKind; title: (input: Record<string, unknown>) => string }
  /** Valide l'entrée (le modèle peut produire une entrée tronquée) ; renvoie un message d'erreur ou null. */
  validate(input: Record<string, unknown>, ctx: ToolContext): string | null
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

/** Vérifie les champs texte obligatoires et optionnels d'une entrée d'outil. */
export function checkStrings(input: Record<string, unknown>, required: string[], optional: string[] = []): string | null {
  for (const key of required) {
    if (typeof input[key] !== 'string' || !(input[key] as string).trim()) return `Champ « ${key} » manquant.`
  }
  for (const key of optional) {
    if (input[key] !== undefined && typeof input[key] !== 'string') return `Champ « ${key} » invalide.`
  }
  return null
}
