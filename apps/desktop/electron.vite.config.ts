import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { codeConfig } from '../../config/code.config'

/** Le serveur (`desktop.serverUrl`) : son adresse WebSocket et son origine HTTP (aperçus `/apercu`). */
const serverWs = new URL(codeConfig.desktop.serverUrl)
const SERVER_WS = serverWs.origin
const SERVER_HTTP = `${serverWs.protocol === 'wss:' ? 'https:' : 'http:'}//${serverWs.host}`

/** Politique de sécurité du contenu, ajoutée à la compilation (le mode dev de Vite a besoin de scripts en ligne). */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // Polices intégrées à l'app (@fontsource), plus de Google Fonts.
  "font-src 'self' data:",
  // Aperçus des fichiers servis par le serveur, et les images des blocs (photos de contacts, avatars
  // GitHub, vignettes Figma, pages web…) : toute image en https.
  `img-src 'self' data: blob: https:`,
  `media-src 'self' blob: ${SERVER_HTTP}`,
  // Fonds de carte vectoriels (OpenFreeMap : style, tuiles, polices, icônes).
  `connect-src 'self' ${SERVER_WS} ${SERVER_HTTP} https://tiles.openfreemap.org`,
  "worker-src 'self' blob:"
].join('; ')

const csp: Plugin = {
  name: 'code-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), csp],
    define: { __CODE_SERVER_URL__: JSON.stringify(codeConfig.desktop.serverUrl) },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          mini: resolve(__dirname, 'src/renderer/mini.html')
        }
      }
    },
  }
})
