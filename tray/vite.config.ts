/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Vite build and dev-server configuration for the Android TV Remote tray app's webview.
 * Registers the React and Tailwind v4 plugins, maps the `@/` alias to src/, and pins the
 * dev server to the fixed port and host that `tauri.conf.json`'s `devUrl` points at (7435,
 * one above the web SPA's 7434 so both can run at once). Unlike the SPA there is no API
 * proxy: the tray app talks to whatever appliance URL the user configures, cross-origin.
 */
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  clearScreen: false,
  server: {
    port: 7435,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Tauri ships its own webview, so there is no need to transpile for old browsers.
    target: 'es2023',
  },
})
