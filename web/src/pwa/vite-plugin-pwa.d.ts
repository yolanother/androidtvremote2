/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Ambient type declarations for the `virtual:pwa-register` module that vite-plugin-pwa
 * synthesises at build time. tsconfig.app.json pins `types` to `vite/client` only, so the
 * plugin's client types have to be pulled in explicitly here rather than through the
 * compiler's automatic @types discovery. Lives under src/pwa because tsconfig.app.json
 * only includes src, and this stream owns nothing above it.
 */
/// <reference types="vite-plugin-pwa/client" />
