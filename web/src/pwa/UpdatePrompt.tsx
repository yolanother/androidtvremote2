/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * A compact banner that appears when the service worker has downloaded a newer build of
 * the Android TV Remote and is waiting to take over. Without it an installed remote would
 * keep running the build it was installed with indefinitely, because the new worker never
 * activates while a client holds the old one. Renders nothing at all until an update is
 * actually waiting, and can be dismissed for the session. Reserves its measured height
 * above the remote rather than covering the touch surface or bottom control keys.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  const ref = useRef<HTMLDivElement>(null)
  const shown = ready && !dismissed

  useLayoutEffect(() => {
    const notice = ref.current
    if (!shown || !notice) return
    const measure = () => document.documentElement.style.setProperty('--pwa-update-height', `${notice.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(notice)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--pwa-update-height')
    }
  }, [shown])

  if (!shown) return null

  return (
    <div
      ref={ref}
      role="status"
      className="pwa-update-notice bg-card ring-border flex items-center gap-2 border-b px-3 py-2"
    >
      <RefreshCw aria-hidden className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm">A new version of the remote is ready.</p>
      <button
        type="button"
        onClick={applyUpdate}
        className="bg-primary text-primary-foreground min-h-[44px] shrink-0 cursor-pointer rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-90"
      >
        Reload
      </button>
      <button
        type="button"
        aria-label="Dismiss the update notice"
        onClick={() => setDismissed(true)}
        className="hover:bg-accent grid size-[44px] shrink-0 cursor-pointer place-items-center rounded-xl transition-colors"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}
