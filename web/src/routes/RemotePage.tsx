/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The main remote screen of the Android TV Remote web UI. Composes the persistent header,
 * the swappable stage (D-pad, touchpad, text, or app launcher), and the fixed deck of
 * navigation, transport, and volume keys into a frame that fills the viewport and never
 * scrolls, so a swipe on the touchpad cannot rubber-band the page. Binds the physical
 * keyboard to the same key paths, replaces the controls with an actionable re-pair prompt
 * when the television reports `unpaired`, and surfaces appliance-socket loss as a banner.
 */
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Lock, PlugZap, Tv } from 'lucide-react'

import { AddDeviceDialog } from '@/components/AddDeviceDialog'
import { AppLauncher } from '@/components/AppLauncher'
import { Btn, ErrorStrip } from '@/components/ui'
import { DPad } from '@/components/DPad'
import { Deck } from '@/components/Deck'
import { PairingDialog } from '@/components/PairingDialog'
import { RemoteHeader } from '@/components/RemoteHeader'
import { TextEntry } from '@/components/TextEntry'
import { Touchpad } from '@/components/Touchpad'
import { useKeyboardControl, useRemoteControl } from '@/hooks/useRemoteControl'
import { setLastDevice, useSurface } from '@/lib/prefs'
import { useDevice, useRemote } from '@/state/store'

/**
 * The remote screen for one television, selected by the `:deviceId` route parameter.
 */
export function RemotePage() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()
  const { state } = useRemote()
  const device = useDevice(deviceId)
  const [surface, setSurface] = useSurface()
  const [pairingOpen, setPairingOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const control = useRemoteControl(device)
  // Modal dialogs own the keyboard while they are open, or Escape would send BACK to the
  // TV instead of closing them.
  useKeyboardControl(control, !pairingOpen && !addOpen)

  useEffect(() => {
    if (deviceId) setLastDevice(deviceId)
  }, [deviceId])

  if (!state.ready) {
    return (
      <div className="grid min-h-dvh place-items-center p-8">
        <p className="text-muted-foreground text-sm">Connecting to the appliance&hellip;</p>
      </div>
    )
  }

  if (state.devices.length === 0) return <Navigate to="/devices" replace />
  if (!device) return <Navigate to={`/d/${state.devices[0]!.id}`} replace />

  const unpaired = device.state.connection === 'unpaired' || !device.paired

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <RemoteHeader
        device={device}
        onSelect={(id) => void navigate(`/d/${id}`)}
        onAdd={() => setAddOpen(true)}
      />

      {state.socket !== 'open' && (
        <div
          role="status"
          className="bg-pairing/15 text-pairing mx-4 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
        >
          <PlugZap aria-hidden className="size-4 shrink-0" />
          {state.socket === 'connecting'
            ? 'Connecting to the appliance…'
            : 'Lost the appliance. Retrying…'}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 lg:flex-row lg:items-center lg:justify-center lg:gap-12">
        {/* Stage. Only the app grid and text history scroll; the frame itself never does. */}
        <main className="flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto overscroll-contain px-4 lg:max-w-xl">
          {unpaired ? (
            <RePairPrompt name={device.name} reason={device.state.error} onPair={() => setPairingOpen(true)} />
          ) : (
            <div className="flex w-full flex-col items-center gap-3 py-2">
              <ErrorStrip message={control.error} onDismiss={control.clearError} />
              {surface === 'dpad' && <DPad control={control} />}
              {surface === 'touch' && <Touchpad control={control} />}
              {surface === 'text' && <TextEntry control={control} />}
              {surface === 'apps' && (
                <AppLauncher
                  control={control}
                  apps={state.apps}
                  currentApp={device.state.current_app}
                />
              )}
            </div>
          )}
        </main>

        <div className="w-full shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:w-auto lg:pb-0">
          <div className="mx-auto flex justify-center">
            <Deck
              control={control}
              state={device.state}
              surface={surface}
              onSurfaceChange={setSurface}
            />
          </div>
        </div>
      </div>

      {pairingOpen && <PairingDialog device={device} onClose={() => setPairingOpen(false)} />}
      <AddDeviceDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(added) => {
          setAddOpen(false)
          void navigate(`/d/${added.id}`)
          setPairingOpen(true)
        }}
      />
    </div>
  )
}

/**
 * Shown in place of the controls when the television has no usable pairing, so a revoked
 * pairing surfaces as an action rather than as keypresses that silently fail.
 *
 * @param props.name - The television's name.
 * @param props.reason - The reason the appliance reported, when it gave one.
 * @param props.onPair - Opens the pairing dialog.
 */
function RePairPrompt({
  name,
  reason,
  onPair,
}: {
  name: string
  reason: string | null
  onPair: () => void
}) {
  return (
    <div className="flex max-w-xs flex-col items-center gap-4 text-center">
      <span className="bg-pairing/15 text-pairing grid size-14 place-items-center rounded-2xl">
        <Lock aria-hidden className="size-7" />
      </span>
      <div>
        <h2 className="text-base font-semibold">{name} is not paired</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {reason ?? 'This television has not been paired with the appliance yet.'} Pair it to
          send commands.
        </p>
      </div>
      <Btn onClick={onPair}>
        <Tv aria-hidden className="size-4" />
        Pair this television
      </Btn>
    </div>
  )
}
