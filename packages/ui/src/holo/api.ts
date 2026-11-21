import { createContext } from 'react'
import { NOM_ASSISTANT_DEFAUT } from '@code/protocol'

export type HoloAction = 'parcourir' | 'afficher' | 'ouvrir_mac' | 'finder'

/**
 * Ce que les rendus peuvent faire : agir sur un fichier (clic sur une tuile),
 * résoudre une adresse d'aperçu, et poser une question à l'assistant (clic sur une carte d'agent).
 */
export type HoloApi = {
  act: (action: HoloAction, chemin: string) => void
  url: (path: string) => string
  ask: (text: string) => void
  /** Recharge le panneau `viewId` avec un autre appel de la même liste (page, onglet, recherche). */
  page: (viewId: string, turnId: string, tool: string, args: Record<string, unknown>) => void
  /** Un rappel : « fait », ou reporté de quelques minutes. */
  remind: (id: number, action: 'fait' | 'reporter', minutes?: number) => void
  /** Une tâche planifiée : la lancer tout de suite, la mettre en pause ou la reprendre. */
  task: (id: number, action: 'executer' | 'pause' | 'reprendre') => void
  /** Un élément d'une liste : le cocher ou le remettre. */
  liste: (liste: number, element: number, coche: boolean) => void
  /** Un appareil de la maison : l'allumer ou l'éteindre. */
  maison: (entite: string) => void
  /** Une caméra : reprendre son image. */
  camera: (entite: string) => void
  /** Réunions : lancer un enregistrement sur cet appareil, ou importer un fichier audio. */
  reunion: { enregistrer: () => void; importer: (fichier: File) => void }
  /** Le nom de l'assistant, pour ce qu'il signe (brouillons). */
  nom: string
}

export const Api = createContext<HoloApi>({ act: () => {}, url: (p) => p, ask: () => {}, page: () => {}, remind: () => {}, task: () => {}, liste: () => {}, maison: () => {}, camera: () => {}, reunion: { enregistrer: () => {}, importer: () => {} }, nom: NOM_ASSISTANT_DEFAUT })

/** Le panneau en cours de rendu : son identifiant, et s'il se recharge. */
/** Le panneau en cours : son appel d'outil, s'il se recharge, et s'il est au premier plan (seul celui-là monte une carte). */
export const Panel = createContext<{ id: string; turnId: string; loading: boolean; front: boolean }>({ id: '', turnId: '', loading: false, front: true })
