/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The app-launcher control surface for the Android TV Remote web UI. Renders the catalog
 * from `GET /api/apps` as a grid of real app icons served by the appliance at
 * `/api/icons/{package}`, each firing `POST /api/devices/{id}/launch`, and highlights the
 * tile the television reports as foreground — resolved from `current_app` or, when the TV
 * reports the native-app sentinel, from the Cast receiver's display name — so the launcher
 * doubles as a readout of what is on screen. An icon that fails to load degrades to the
 * initials-over-a-derived-hue tile rather than leaving a gap. Launch tiles identify
 * direct TV commands so pointer launch preserves desktop remote keyboard control.
 */
import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { foregroundApp } from '@/lib/media'
import type { AppDescriptor, DeviceState } from '@/lib/api-types'
import type { RemoteControl } from '@/hooks/useRemoteControl'
import { AppIcon } from '@/components/AppIcon'
import { ErrorStrip } from '@/components/ui'

/**
 * The app-launcher surface.
 *
 * @param props.control - The bound remote control for the active device.
 * @param props.apps - The app catalog loaded from the appliance.
 * @param props.state - The device's live state, read to highlight the foreground app.
 */
export function AppLauncher({
  control,
  apps,
  state,
}: {
  control: RemoteControl
  apps: AppDescriptor[]
  state: DeviceState
}) {
  const { launch, disabled, error, clearError } = control
  const [launching, setLaunching] = useState<string | null>(null)
  const foreground = foregroundApp(state, apps).app

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
          const isCurrent = foreground?.id === app.id
          const busy = launching === app.id
          return (
            <button
              key={app.id}
              type="button"
              data-remote-command
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
                className={cn(
                  'ring-offset-background relative block w-full rounded-2xl shadow-md transition-shadow',
                  isCurrent && 'ring-online ring-2 ring-offset-2',
                )}
              >
                {/* The name is rendered right below the icon, so the image itself is
                    decorative — giving it alt text would announce every app twice. */}
                <AppIcon iconUrl={app.icon_url} name={app.name} alt="" seed={app.id} />
                {busy && (
                  <span className="absolute inset-0 grid place-items-center rounded-2xl bg-black/50 text-white">
                    <Loader2 className="size-6 animate-spin" />
                  </span>
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
