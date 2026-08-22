/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * A one-line banner that appears when the service worker has downloaded a newer build of
 * the Android TV Remote and is waiting to take over. Without it an installed remote would
 * keep running the build it was installed with indefinitely, because the new worker never
 * activates while a client holds the old one. Renders nothing at all until an update is
 * actually waiting, and can be dismissed for the session.
 */
import { useState, useSyncExternalStore } from 'react'
import { RefreshCw, X } from 'lucide-react'

import { applyUpdate, getUpdateReady, subscribe } from '@/pwa/runtime'

/**
 * The "a new version is ready" banner.
 *
 * Mount it once, at the top level of the app, so it is reachable from every screen.
 */
export function UpdatePrompt() {
  const ready = useSyncExternalStore(subscribe, getUpdateReady)
  const [dismissed, setDismissed] = useState(false)

  if (!ready || dismissed) return null

  return (
    <div
      role="status"
      className="bg-card ring-border fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex items-center gap-3 rounded-2xl p-3 shadow-lg ring-1"
    >
      <RefreshCw aria-hidden className="size-5 shrink-0" />
      <p className="flex-1 text-sm">A new version of the remote is ready.</p>
      <button
        type="button"
        onClick={applyUpdate}
        className="bg-primary text-primary-foreground min-h-11 cursor-pointer rounded-xl px-4 text-sm font-medium transition-opacity hover:opacity-90"
      >
        Reload
      </button>
      <button
        type="button"
        aria-label="Dismiss the update notice"
        onClick={() => setDismissed(true)}
        className="hover:bg-accent cursor-pointer rounded-xl p-2.5 transition-colors"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}
