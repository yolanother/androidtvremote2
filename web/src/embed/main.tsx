/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Browser entry point for the embeddable Android TV remote served at /embed. It is a
 * separate Vite entry from the SPA on purpose: a host page's iframe downloads only the
 * remote, with no router, app shell, or dashboard code. Parses the embed URL's query
 * string, applies the requested colour scheme to the document (following the host
 * device's `prefers-color-scheme` when `theme=auto`), marks the document when
 * `bg=transparent` asked the frame not to paint a backdrop, and mounts EmbedRemote.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../index.css'
import './embed.css'

import { EmbedRemote } from './EmbedRemote'
import { parseEmbedConfig, type EmbedTheme } from './config'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Apply a colour scheme to the document root.
 *
 * The shared token layer in index.css switches palettes on a `.dark` class, so `auto`
 * has to resolve `prefers-color-scheme` here rather than in CSS.
 *
 * @param theme - The requested scheme from the embed URL.
 */
function applyTheme(theme: EmbedTheme): void {
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia(DARK_QUERY).matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

const config = parseEmbedConfig(window.location.search)

// CSS cannot read the query string, so the backdrop choice is stamped onto the document.
if (config.transparent) document.documentElement.dataset.bg = 'transparent'

applyTheme(config.theme)
if (config.theme === 'auto') {
  // A panel that flips to night mode should take the embed with it.
  window.matchMedia(DARK_QUERY).addEventListener('change', () => applyTheme(config.theme))
}

createRoot(document.getElementById('embed-root')!).render(
  <StrictMode>
    <EmbedRemote config={config} />
  </StrictMode>,
)
