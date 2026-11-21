import { useEffect, useState } from 'react'
import type { CodeBridge } from '../../preload/bridge'

const BROWSER_TOKEN_KEY = 'code.desktop.token'

/** `desktop.serverUrl` de la configuration, injecté par Vite (electron.vite.config.ts, vite.browser.config.ts). */
declare const __CODE_SERVER_URL__: string

/**
 * Hors d'Electron (aperçu dans un navigateur : `npm run dev -w @code/desktop` puis
 * http://localhost:5173/?t=<jeton>), on simule le pont du processus principal.
 */
const browserBridge: CodeBridge = {
  // `?ws=ws://127.0.0.1:8790/ws` : un autre serveur (serveur de test, faux Google).
  getConfig: async () => {
    const params = new URLSearchParams(location.search)
    let stored: string | null = null
    try {
      stored = localStorage.getItem(BROWSER_TOKEN_KEY)
    } catch {}
    return { url: params.get('ws') ?? __CODE_SERVER_URL__, token: params.get('t') ?? stored, attendre: false }
  },
  setToken: (token) => {
    try {
      if (token) localStorage.setItem(BROWSER_TOKEN_KEY, token)
      else localStorage.removeItem(BROWSER_TOKEN_KEY)
    } catch {}
  },
  resizeMini: () => {},
  moveMini: () => {},
  openMain: () => {},
  copyText: (text) => navigator.clipboard.writeText(text),
  toMini: () => {},
  onToggleVoice: () => () => {},
  onPresence: () => () => {},
  onSleep: () => () => {}
}

/**
 * Le preload n'est compilé qu'au lancement d'`electron-vite dev`, alors que les pages se rechargent à chaud :
 * une méthode ajoutée depuis manquait au pont, son appel levait une erreur et la miniature restait vide.
 * Ce qui manque au preload garde donc son équivalent du navigateur (sans effet).
 */
export const bridge: CodeBridge = window.codeBridge ? { ...browserBridge, ...window.codeBridge } : browserBridge

export type ServerConfig = { url: string | null; token: string | null; attendre: boolean }

/**
 * Adresse du serveur et jeton d'appareil, fournis par le processus principal. Sans jeton du tout,
 * l'écran de connexion s'affiche, et on réessaie tant que le serveur n'a pas écrit le sien (premier démarrage).
 */
export function useServerConfig(): ServerConfig {
  const [cfg, setCfg] = useState<ServerConfig>({ url: null, token: null, attendre: true })
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const c = await bridge.getConfig()
      if (stop) return
      setCfg((prev) => (prev.url === c.url && prev.token === c.token && prev.attendre === c.attendre ? prev : c))
      if (c.attendre) timer = setTimeout(load, 2_000)
    }
    void load()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [])
  return cfg
}
