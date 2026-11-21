import type { UiRappel } from '@code/protocol'
import type { ClientState } from './client.ts'
import type { OrbMode } from './Orb.tsx'
import { conversationHere, conversationOn, type VoiceStatus } from './voice.ts'

export type ViewState = 'veille' | 'ecoute' | 'reflexion' | 'parole' | 'validation' | 'arret' | 'injoignable' | 'refuse'

export type View = {
  state: ViewState
  orb: OrbMode
  label: string
  sub: string
  /** Couleur d'accent de l'état (cyan, ambre, rouge, gris). */
  tone: 'cyan' | 'ambre' | 'rouge' | 'gris'
}

/** Ce que l'écran affiche, à partir de l'état du serveur et de l'audio local. */
export function viewOf(s: ClientState, v: VoiceStatus, device: 'mac' | 'mobile'): View {
  if (s.connection === 'refuse')
    return { state: 'refuse', orb: 'injoignable', label: 'ACCÈS REFUSÉ', sub: 'Jeton d’appareil invalide', tone: 'gris' }
  if (s.connection === 'auth') return { state: 'refuse', orb: 'injoignable', label: 'CONNEXION', sub: 'Connectez-vous avec votre compte', tone: 'gris' }
  if (s.connection !== 'connecte')
    return {
      state: 'injoignable',
      orb: 'injoignable',
      label: 'INJOIGNABLE',
      sub: s.connection === 'connexion' ? 'Connexion au Mac…' : 'Nouvel essai dans quelques secondes…',
      tone: 'gris'
    }
  if (s.serverState === 'arret') return { state: 'arret', orb: 'injoignable', label: 'À L’ARRÊT', sub: 'Arrêt d’urgence actif', tone: 'gris' }
  if (v.playing || s.serverState === 'parole')
    return { state: 'parole', orb: 'parole', label: 'JE PARLE', sub: device === 'mac' ? 'Parlez pour m’interrompre' : 'Touchez ou parlez pour m’interrompre', tone: 'cyan' }
  switch (s.serverState) {
    case 'ecoute':
      return { state: 'ecoute', orb: 'ecoute', label: 'JE VOUS ÉCOUTE', sub: 'Parlez normalement, je détecte la fin de votre phrase', tone: 'cyan' }
    case 'reflexion':
      return { state: 'reflexion', orb: 'reflexion', label: 'JE RÉFLÉCHIS', sub: 'Un instant…', tone: 'ambre' }
    case 'attente_validation':
      return { state: 'validation', orb: 'validation', label: 'VOTRE ACCORD ?', sub: 'J’attends un « oui » clair', tone: 'ambre' }
    default:
      // Toucher reçu, micro pas encore prêt (demande d'accès, chargement du moteur) : on le montre.
      if (v.opening && !v.micOn)
        return { state: 'ecoute', orb: 'reflexion', label: 'PRÉPARATION', sub: 'J’ouvre le micro…', tone: 'ambre' }
      // Sur le Mac, le mode conversation se montre dans l'app comme dans la miniature, quel que soit l'écran qui le tient.
      if (device === 'mac' ? conversationOn(s, ['mac', 'mini']) : conversationHere(s))
        return { state: 'ecoute', orb: 'ecoute', label: 'EN CONVERSATION', sub: device === 'mac' ? 'Parlez librement · cliquez sur l’orbe pour arrêter' : 'Parlez librement · touchez l’orbe pour arrêter', tone: 'cyan' }
      if (v.micOn)
        return { state: 'ecoute', orb: 'ecoute', label: 'JE VOUS ÉCOUTE', sub: 'Allez-y, je vous écoute', tone: 'cyan' }
      if (ringing(s)) return alerteOf(ringing(s)!)
      return {
        state: 'veille',
        orb: 'repos',
        label: 'EN VEILLE',
        sub: v.micError ?? (device === 'mac' ? 'Cliquez sur l’orbe pour parler' : 'Touchez l’orbe pour parler'),
        tone: 'cyan'
      }
  }
}

/** Le premier rappel qui sonne (ils arrivent en tête de liste), s'il y en a un. */
export function ringing(s: ClientState): UiRappel | undefined {
  return s.rappels.find((r) => r.etat === 'sonne')
}

/** Un rappel qui sonne : l'orbe passe en alerte, au repos seulement (une conversation passe avant). */
export function alerteOf(r: UiRappel): View {
  return { state: 'veille', orb: 'alerte', label: r.retard ? 'RAPPEL EN RETARD' : 'RAPPEL', sub: r.texte, tone: 'rouge' }
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
