import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // VIES does not expose permissive CORS headers for browser apps, so we proxy it in dev.
    proxy: {
      '/api/vies': {
        target: 'https://ec.europa.eu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/vies/, '/taxation_customs/vies/rest-api')
      },
      '/api/enrich-by-siret': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      },
      '/api/enrich-by-vat': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      },
      '/api/health': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      }
    }
  }
})
