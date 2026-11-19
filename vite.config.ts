import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const TALENTO_BASE = 'https://desarrolloluxor.lat/api/talentohumano'
const TALENTO_KEY =
  process.env.VITE_TALENTO_HUMANO_KEY ||
  'PBDFeysVkGLa0zRfq5bYEUtNbmV0akhtN3hFakRES3E2cU82TVE9PQ=='

/**
 * Proxy de desarrollo para la API de Talento Humano.
 *
 * Motivo: esa API responde el preflight CORS con
 * `Access-Control-Allow-Headers: token, Content-Type`, pero el endpoint exige
 * el header `API_KEY`. El navegador bloquea la petición antes de enviarla.
 * En servidor (Node) no aplica CORS, así que Vite reenvía la petición.
 */
function talentoHumanoProxy(): Plugin {
  return {
    name: 'talento-humano-proxy',
    configureServer(server) {
      server.middlewares.use('/api/talento', (req, res) => {
        const target = `${TALENTO_BASE}${req.url ?? ''}`
        const headers: Record<string, string> = { API_KEY: TALENTO_KEY }
        const accept = req.headers.accept
        if (accept) headers.Accept = accept

        fetch(target, { headers })
          .then(async (upstream) => {
            res.statusCode = upstream.status
            const ct = upstream.headers.get('content-type')
            if (ct) res.setHeader('Content-Type', ct)
            res.end(Buffer.from(await upstream.arrayBuffer()))
          })
          .catch((err: unknown) => {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error: 'Proxy: no se pudo contactar la API de Talento Humano',
                detail: err instanceof Error ? err.message : String(err),
              })
            )
          })
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/talento', (req, res) => {
        const target = `${TALENTO_BASE}${req.url ?? ''}`
        fetch(target, { headers: { API_KEY: TALENTO_KEY } })
          .then(async (upstream) => {
            res.statusCode = upstream.status
            const ct = upstream.headers.get('content-type')
            if (ct) res.setHeader('Content-Type', ct)
            res.end(Buffer.from(await upstream.arrayBuffer()))
          })
          .catch((err: unknown) => {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error: 'Proxy: no se pudo contactar la API de Talento Humano',
                detail: err instanceof Error ? err.message : String(err),
              })
            )
          })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    talentoHumanoProxy(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'logo-mark.png', 'icons/*.png'],
      manifest: {
        name: 'LOGIXLITE - Administración de Flota',
        short_name: 'LOGIXLITE',
        description:
          'Administración de flota de transporte particular: vehículos, choferes, pasajeros y viajes.',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Empleados de la API externa (con caché para uso offline)
            urlPattern: /^https:\/\/desarrolloluxor\.lat\/api\/talentohumano\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'talento-humano',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
})
