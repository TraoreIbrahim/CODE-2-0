/** Pont exposé aux pages par le preload (`window.codeBridge`). */
export type CodeBridge = {
  /** `attendre` : pas encore de jeton du serveur (il démarre), réessayer. */
  getConfig(): Promise<{ url: string; token: string | null; attendre: boolean }>
  /** Garde le jeton obtenu à la connexion, ou l'efface (déconnexion) ; l'autre fenêtre repart avec. */
  setToken(token: string | null): void
  resizeMini(width: number, height: number): void
  /** Déplace la miniature (glisser à la souris), en pixels d'écran. */
  moveMini(dx: number, dy: number): void
  openMain(): void
  /** Copie un texte dans le presse-papiers (par le processus principal : la page n'en a pas le droit). */
  copyText(text: string): Promise<void>
  /** Le pont : exécute un outil de fichiers sur cet ordinateur pour le serveur, ou l'action validée (voir main/pont.ts) ; absent hors d'Electron. */
  pont?: {
    outil(envoi: string, outil: string, input: Record<string, unknown>): Promise<void>
    executer(envoi: string, cle: string): Promise<void>
  }
  toMini(): void
  onToggleVoice(fn: () => void): () => void
  /** L'utilisateur est devant l'ordinateur (clavier, souris, réveil, déverrouillage) : signalé au serveur pour le point du retour. */
  onPresence(fn: () => void): () => void
  /** L'ordinateur se met en veille ou se verrouille : le mode conversation se coupe. */
  onSleep(fn: () => void): () => void
}

declare global {
  interface Window {
    codeBridge: CodeBridge
  }
}
