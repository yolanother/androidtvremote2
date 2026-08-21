/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Vite build and dev-server configuration for the Android TV Remote web UI. Registers the
 * React and Tailwind v4 plugins, maps the `@/` path alias to src/, and proxies /api and
 * /healthz (including WebSocket upgrades) to the FastAPI appliance so the SPA runs
 * same-origin in development exactly as it does when served from the container. Declares
 * two build entries -- the SPA (index.html) and the standalone iframe remote
 * (embed.html) -- and serves the latter at the extensionless /embed path in dev so the
 * dev server matches how the appliance routes it in production.
 */
import path from 'node:path'
import { defineConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:7433'

/**
 * Serve the iframe remote at `/embed` during development.
 *
 * The appliance maps `/embed` to the built `embed.html` (see docs/embedding.md); Vite's
 * dev server would otherwise only answer `/embed.html`, so an `<iframe src="/embed">`
 * that works in production would 404 in dev.
 */
const embedRoute = {
  name: 'embed-route',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, _res, next) => {
      const [pathname = ''] = (req.url ?? '').split('?')
      if (pathname === '/embed' || pathname === '/embed/') {
        req.url = `/embed.html${(req.url ?? '').slice(pathname.length)}`
      }
      next()
    })
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), embedRoute],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 7434,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
      '/healthz': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'index.html'),
        embed: path.resolve(import.meta.dirname, 'embed.html'),
      },
    },
  },
})
