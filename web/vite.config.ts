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
 * dev server matches how the appliance routes it in production. Also generates the
 * progressive-web-app service worker that precaches the SPA shell while keeping /api,
 * /healthz, /mcp and the embed view permanently on the network.
 */
import path from 'node:path'
import { defineConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:7433'

/**
 * Paths the service worker must never answer from its own cache.
 *
 * `/api` carries the device list and every live state snapshot, so a cached response would
 * show the operator phantom devices, a stale power state, or a volume that never moves —
 * strictly worse than no offline support at all. `/healthz` is a liveness probe and a
 * cached 200 would be a lie. `/mcp` is an agent transport. `/embed` is a second Vite entry
 * that other people's pages iframe; it has to stay a plain, always-fresh document.
 *
 * WebSockets (`/api/ws`) never reach a service worker at all — the handshake is not a
 * `fetch` event — so the socket is unaffected either way.
 */
const NEVER_CACHED = [/^\/api\//, /^\/healthz$/, /^\/mcp(\/|$)/, /^\/embed(\/|$)/]

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

/**
 * Build the service worker that makes the SPA installable.
 *
 * `manifest: false` and `injectRegister: null` are deliberate. The plugin's own
 * `transformIndexHtml` pass runs against *every* HTML entry, so letting it inject the
 * manifest link and the registration script would silently turn `embed.html` into a PWA
 * too. Instead `index.html` carries both by hand and `embed.html` is left untouched, so
 * the embed view neither registers a worker nor advertises itself as installable. The
 * manifest itself is a hand-written static file at `public/manifest.webmanifest`; the
 * appliance serves it as `application/manifest+json` because Python's built-in mimetypes
 * table knows that extension even in a container with no /etc/mime.types (verified).
 */
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: null,
  manifest: false,
  workbox: {
    // The app shell only. `embed.html` is excluded so a navigation to /embed always
    // fetches a fresh document; its hashed JS chunks may be shared with the SPA and are
    // safe to precache because their contents are pinned by the hash in the filename.
    globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,webmanifest}'],
    globIgnores: ['**/node_modules/**/*', '**/embed.html'],
    navigateFallback: '/index.html',
    navigateFallbackDenylist: NEVER_CACHED,
    // Explicit, even though an unrouted request would fall through to the network anyway:
    // a reader of this config should not have to know that to trust the appliance.
    runtimeCaching: NEVER_CACHED.map((urlPattern) => ({
      urlPattern,
      handler: 'NetworkOnly' as const,
    })),
    cleanupOutdatedCaches: true,
    // `registerType: 'prompt'` means the new worker waits until the operator accepts the
    // reload, so it must not claim clients or skip waiting on its own.
    skipWaiting: false,
    clientsClaim: false,
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), embedRoute, pwa],
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
