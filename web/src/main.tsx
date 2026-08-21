/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Browser entry point for the Android TV Remote web UI. Imports the global Tailwind
 * stylesheet, applies the stored colour theme before the first paint (so the page never
 * flashes the wrong palette) and keeps following the operating system's preference, then
 * mounts the root App component into the #root element.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'
import './index.css'
import { applyTheme, watchSystemTheme } from '@/lib/prefs'

applyTheme()
watchSystemTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
