/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Root component and route table for the Android TV Remote web UI. Wraps the application
 * in the remote store provider — which owns the single appliance WebSocket every screen
 * reads from — and routes between the remote surface for one television, the device
 * dashboard, and settings. The index route resolves to whichever television was last used,
 * falling back to the first registered one and then to the dashboard. Also mounts the
 * service-worker update prompt, which sits outside the router so a waiting update is
 * offered on every screen.
 */
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom'

import { DevicesPage } from '@/routes/DevicesPage'
import { RemotePage } from '@/routes/RemotePage'
import { SettingsPage } from '@/routes/SettingsPage'
import { RemoteProvider } from '@/state/RemoteProvider'
import { getLastDevice } from '@/lib/prefs'
import { useRemote } from '@/state/store'
import { UpdatePrompt } from '@/pwa/UpdatePrompt'

/**
 * Resolve the index route to a television: the one last used if it is still registered,
 * otherwise the first, otherwise the dashboard.
 */
function IndexRedirect() {
  const { state } = useRemote()

  if (!state.ready) {
    return (
      <div className="grid min-h-dvh place-items-center p-8">
        <p className="text-muted-foreground text-sm">Connecting to the appliance&hellip;</p>
      </div>
    )
  }

  const last = getLastDevice()
  const target = state.devices.find((device) => device.id === last) ?? state.devices[0]
  return <Navigate to={target ? `/d/${target.id}` : '/devices'} replace />
}

/**
 * The application root.
 */
export default function App() {
  return (
    <RemoteProvider>
      <UpdatePrompt />
      <Router>
        <Routes>
          <Route path="/" element={<IndexRedirect />} />
          <Route path="/d/:deviceId" element={<RemotePage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </RemoteProvider>
  )
}
