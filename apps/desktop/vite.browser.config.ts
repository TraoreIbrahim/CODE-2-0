import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { codeConfig } from '../../config/code.config'

/**
 * Aperçu des pages de l'app de bureau dans un navigateur, sans Electron (travail sur l'interface).
 * `npm run preview:browser -w @code/desktop`, puis http://localhost:5174/?t=<jeton>
 * (miniature : /mini.html?t=<jeton>).
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  define: { __CODE_SERVER_URL__: JSON.stringify(codeConfig.desktop.serverUrl) },
  server: { port: 5174, strictPort: true }
})
