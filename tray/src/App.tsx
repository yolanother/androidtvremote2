/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Root component of the Android TV Remote tray panel. Owns the single piece of navigation
 * the app has — remote versus settings — sending first-run users straight to settings until
 * an appliance URL has been saved, responding to the tray menu's "Settings…" item, and
 * hiding the panel on Escape the way a native popover does. Everything else is delegated to
 * `useAppliance` for state and to the two views for presentation.
 */
import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { RemotePanel } from '@/components/RemotePanel'
import { SettingsView } from '@/components/SettingsView'
import { useAppliance } from '@/lib/useAppliance'

/** Which of the panel's two screens is showing. */
type View = 'remote' | 'settings'

/**
 * Renders the panel.
 *
 * @returns the remote or the settings screen, inside the translucent popover surface.
 */
export default function App() {
  const appliance = useAppliance()
  const [view, setView] = useState<View>('remote')

  // First run has nothing to control yet, so open settings instead of an empty remote.
  useEffect(() => {
    if (!appliance.loading && !appliance.settings.configured) setView('settings')
  }, [appliance.loading, appliance.settings.configured])

  // "Settings…" in the tray menu.
  useEffect(() => {
    if (!isTauri()) return
    const unlisten = listen('open-settings', () => setView('settings'))
    return () => {
      void unlisten.then((off) => off())
    }
  }, [])

  // Escape dismisses the panel, like any native popover.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.activeElement instanceof HTMLInputElement) return
      void invoke('hide_panel').catch(() => undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <main className="panel-surface h-full overflow-hidden">
      {appliance.loading ? null : view === 'settings' ? (
        <SettingsView appliance={appliance} onClose={() => setView('remote')} />
      ) : (
        <RemotePanel appliance={appliance} onOpenSettings={() => setView('settings')} />
      )}
    </main>
  )
}
