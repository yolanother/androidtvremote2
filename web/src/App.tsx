/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Root component and route table for the Android TV Remote web UI. Wraps the application
 * in the remote store provider — which owns the single appliance WebSocket every screen
 * reads from — and splits the routes in two: everything console-like (the landing
 * dashboard, the device list, the API reference, the LLM integration guide, and settings)
 * renders inside the header-and-sidebar app shell, while the remote for one television
 * stays a chrome-free, full-viewport surface outside it. Also mounts the service-worker
 * update prompt, which sits outside the router so a waiting update is offered on every
 * screen.
 */
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom'

import { ApiDocsPage } from '@/routes/ApiDocsPage'
import { AppShell } from '@/components/AppShell'
import { DevicesPage } from '@/routes/DevicesPage'
import { HomePage } from '@/routes/HomePage'
import { LlmPage } from '@/routes/LlmPage'
import { RemotePage } from '@/routes/RemotePage'
import { RemoteProvider } from '@/state/RemoteProvider'
import { SettingsPage } from '@/routes/SettingsPage'
import { UpdatePrompt } from '@/pwa/UpdatePrompt'

/**
 * The application root.
 */
export default function App() {
  return (
    <RemoteProvider>
      <UpdatePrompt />
      <Router>
        <Routes>
          {/* The remote is the one screen that owns the whole viewport: it must not
              scroll, so it is deliberately outside the shell. */}
          <Route path="/d/:deviceId" element={<RemotePage />} />

          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/reference" element={<ApiDocsPage />} />
            <Route path="/llm" element={<LlmPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </RemoteProvider>
  )
}
