/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Webview entry point for the Android TV Remote tray panel. Mounts the React tree into the
 * document, pulls in the global stylesheet, and suppresses the browser context menu and
 * drag-to-navigate gestures that would otherwise make a borderless popover feel like a web
 * page rather than a native panel.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import '@/index.css'

// A native popover has no right-click "Reload" or image drag-and-drop.
window.addEventListener('contextmenu', (event) => event.preventDefault())
window.addEventListener('dragstart', (event) => event.preventDefault())

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
