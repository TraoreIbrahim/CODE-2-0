import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // En dev, le WebSocket passe par Vite vers le serveur CODE local.
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      // Aperçus des fichiers (PDF, images…) servis par le serveur CODE.
      '/apercu': { target: 'http://127.0.0.1:8787' }
    }
  }
})
