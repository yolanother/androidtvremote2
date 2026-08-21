/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The app-launcher control surface for the Android TV Remote web UI. Renders the catalog
 * from `GET /api/apps` as a grid of tiles that fire `POST /api/devices/{id}/launch`, and
 * highlights the tile matching the device's live `current_app` so the launcher doubles as
 * a readout of what the TV is showing. Tiles are drawn from each app's initials over a
 * hue derived from its id, because the appliance ships no icon artwork.
 */
import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { AppDescriptor } from '@/lib/api-types'
import type { RemoteControl } from '@/hooks/useRemoteControl'
import { ErrorStrip } from '@/components/ui'

/**
 * Derive a stable hue from an app id so every tile has a consistent, distinguishable
 * colour without shipping artwork.
 *
 * @param id - The app's catalog id.
 * @returns A hue in degrees, 0-359.
 */
function hueFor(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360
  return hash
}

/** First letters of the app name, used as the tile glyph. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

/**
 * The app-launcher surface.
 *
 * @param props.control - The bound remote control for the active device.
 * @param props.apps - The app catalog loaded from the appliance.
 * @param props.currentApp - The package the TV reports as foreground, or null.
 */
export function AppLauncher({
  control,
  apps,
  currentApp,
}: {
  control: RemoteControl
  apps: AppDescriptor[]
  currentApp: string | null
}) {
  const { launch, disabled, error, clearError } = control
  const [launching, setLaunching] = useState<string | null>(null)

  if (apps.length === 0) {
    return (
      <p className="text-muted-foreground max-w-xs text-center text-sm">
        No apps in the catalog yet. The appliance publishes them at <code>/api/apps</code>.
      </p>
    )
  }

  const open = async (app: AppDescriptor) => {
    setLaunching(app.id)
    try {
      await launch(app.launch)
    } catch {
      // `launch` has already published the message through `control.error`.
    } finally {
      setLaunching(null)
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <ErrorStrip message={error} onDismiss={clearError} />
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {apps.map((app) => {
          const isCurrent = currentApp !== null && app.package === currentApp
          const busy = launching === app.id
          return (
            <button
              key={app.id}
              type="button"
              disabled={disabled}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => void open(app)}
              className={cn(
                'group flex cursor-pointer flex-col items-center gap-2 rounded-xl p-2',
                'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                isCurrent ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <span
                aria-hidden
                style={{ backgroundColor: `oklch(0.62 0.16 ${hueFor(app.id)})` }}
                className={cn(
                  'relative grid aspect-square w-full place-items-center rounded-2xl',
                  'text-lg font-semibold text-white shadow-md',
                  'ring-offset-background transition-shadow',
                  isCurrent && 'ring-online ring-2 ring-offset-2',
                )}
              >
                {busy ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  initials(app.name)
                )}
                {isCurrent && !busy && (
                  <span className="bg-online text-background absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-xs font-medium">
                {app.name}
                {isCurrent && <span className="sr-only"> (currently open)</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
