import type { FournisseurId, ModeleInfo, Turn, UiData } from '@code/protocol'
import type { ToolCall, ToolRun } from '../../tools/index.ts'
import type { Tool } from '../../tools/types.ts'
import type { ApiUsage } from '../usage.ts'

/**
 * Un moteur : un fournisseur de modèles (Claude, ou tout ce qui parle le format d'OpenAI), vu par le
 * cerveau. La boucle d'outils est commune ; chaque moteur traduit les messages, les outils et l'usage.
 */

/** Ce que le cerveau diffuse : texte, outils lancés, résultats (voir `Brain.reply`). */
export type BrainEvent =
  | { type: 'text'; text: string }
  /** Le modèle lance un outil : son panneau s'affiche en « chargement ». */
  | { type: 'tool-start'; id: string; name: string; input: unknown }
  /** Résultat d'un outil : le panneau se remplit. */
  | { type: 'tool'; id: string; name: string; summary: string; risk: string; view?: UiData; failed: boolean; message?: string }

/** Chaque appel au modèle est compté : le modèle qui a répondu et son `usage`. */
export type Compteur = (modele: string, usage: ApiUsage) => void

/**
 * Fin d'une étape. `outils` : des appels à exécuter, puis `resultats` ; `pause` : le fournisseur a interrompu
 * son propre travail (recherches web de Claude), on relance tel quel ; `evenements` : ce que le fournisseur a
 * fait lui-même pendant l'étape (recherches web), pour le journal.
 */
export type FinEtape = {
  arret: 'fin' | 'outils' | 'refus' | 'longueur' | 'pause'
  appels: ToolCall[]
  evenements: BrainEvent[]
}

/** Un échange en cours : l'historique propre au fournisseur reste dans le moteur, d'une étape à l'autre. */
export interface Echange {
  /** Un appel au modèle (ou quelques-uns, pour la recherche d'outils) : diffuse le texte, rend la fin. */
  etape(signal: AbortSignal): AsyncGenerator<string, FinEtape>
  /** Les résultats des appels de la dernière étape, dans leur ordre. */
  resultats(runs: { appel: ToolCall; run: ToolRun }[]): void
}

export type EchangeParams = {
  modele: string
  systeme: string
  historique: Turn[]
  question: string
  outils: Tool[]
  /** Demande simple (`fast`) ou à plusieurs étapes (`deep`) : effort de réflexion, outils web de Claude. */
  tier: 'deep' | 'fast'
  /** Tâche planifiée : plus de réflexion, réponse plus longue. */
  tache: boolean
  compter: Compteur
}

export interface Moteur {
  readonly fournisseur: FournisseurId
  /** Le fournisseur cherche lui-même sur le web (Claude) ; sinon, les outils web libres s'il y en a. */
  readonly webNatif: boolean
  /** Nom de son outil de recherche d'outils, cité dans les consignes. */
  readonly rechercheOutils: string
  echange(p: EchangeParams): Echange
  /** Réponse imposée sous forme d'outil (les notes à retenir) : l'entrée de l'outil. */
  json(p: { modele: string; systeme: string; texte: string; outil: { name: string; description: string; schema: Record<string, unknown> }; signal?: AbortSignal; compter: Compteur }): Promise<unknown>
  /** Réponse très courte, sans outils (fin de phrase) ; `delaiMs` : au-delà, abandon. */
  court(p: { modele: string; systeme: string; texte: string; signal?: AbortSignal; delaiMs: number; compter: Compteur }): Promise<string>
  /** Les modèles du fournisseur, lus avec la clé. */
  modeles(): Promise<ModeleInfo[]>
}

/** Pas de clé (ou d'adresse, pour Ollama) pour ce fournisseur : chacun utilise la sienne. */
export class CleManquante extends Error {
  constructor(readonly nom: string) {
    super(`Aucune clé ${nom} pour votre compte : ajoutez la vôtre dans Réglages › Clés API, ou choisissez un autre moteur dans Réglages › Moteurs.`)
  }
}

/** Erreur d'un fournisseur au format OpenAI (statut HTTP et message de l'API). */
export class MoteurErreur extends Error {
  constructor(
    readonly fournisseur: string,
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}
