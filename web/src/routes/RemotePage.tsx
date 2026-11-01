/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The selected-TV remote workspace. Provides Controls, Apps, optional Guide and Playing
 * destinations with a persistent header and core keys; phones use a single content pane
 * and tablets/desktops gain a wider browsing pane beside remote controls. Content panes
 * scroll independently so touchpad gestures cannot rubber-band the page. Binds the physical
 * keyboard to the same key paths, replaces the controls with an actionable re-pair prompt
 * when the television reports `unpaired`, and surfaces appliance-socket loss as a banner.
 */
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppWindow, CalendarDays, Lock, MonitorPlay, PlugZap, SlidersHorizontal, Tv } from 'lucide-react'

import { AddDeviceDialog } from '@/components/AddDeviceDialog'
import { AppLauncher } from '@/components/AppLauncher'
import { Btn, ErrorStrip } from '@/components/ui'
import { DPad } from '@/components/DPad'
import { Deck } from '@/components/Deck'
import { Guide } from '@/components/Guide'
import { MediaBrowse } from '@/components/MediaBrowse'
import { ProviderApps } from '@/components/ProviderApps'
import { ProviderPlaying } from '@/components/ProviderPlaying'
import { PairingDialog } from '@/components/PairingDialog'
import { RemoteHeader } from '@/components/RemoteHeader'
import { TextEntry } from '@/components/TextEntry'
import { Touchpad } from '@/components/Touchpad'
import { useKeyboardControl, useRemoteControl } from '@/hooks/useRemoteControl'
import { useIntegration } from '@/hooks/useIntegration'
import { setLastDevice, useSurface, type Surface } from '@/lib/prefs'
import { cn } from '@/lib/utils'
import { useDevice, useRemote } from '@/state/store'

/**
 * The remote screen for one television, selected by the `:deviceId` route parameter.
 */
export function RemotePage() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()
  const { state } = useRemote()
  const device = useDevice(deviceId)
  const [surface, setSurface] = useSurface(deviceId)
  const [controlMode, setControlMode] = useState<'dpad' | 'touch' | 'text'>('dpad')
  const [pairingOpen, setPairingOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const control = useRemoteControl(device)
  const remote = useIntegration(device, surface)
  const available = !!remote.integration?.available
  const capabilities = available ? remote.integration!.capabilities : []
  const guideAvailable = capabilities.includes('guide')
  const controlsSelected = surface === 'dpad' || surface === 'touch' || surface === 'text'
  const destination = surface === 'apps' ? 'apps' : surface === 'media' ? 'media' : surface === 'guide' && guideAvailable ? 'guide' : 'controls'
  // Modal dialogs own the keyboard while they are open, or Escape would send BACK to the
  // TV instead of closing them.
  useKeyboardControl(control, !pairingOpen && !addOpen && destination === 'controls')

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
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden md:p-4 xl:p-6">
      <div className="bg-background mx-auto flex min-h-0 w-full max-w-[1700px] flex-1 flex-col md:rounded-3xl md:border md:p-4">
      <RemoteHeader
        device={device}
        onSelect={(id) => void navigate(`/d/${id}`)}
        onAdd={() => setAddOpen(true)}
      />

      {capabilities.includes('profiles') && remote.profiles && <div className="mb-3 flex min-w-0 items-center gap-3 px-4 text-xs md:px-0">
        <label htmlFor="tv-profile" className="text-muted-foreground shrink-0">TV profile</label>
        <select id="tv-profile" aria-label="TV profile" value={remote.integration?.profile_id ?? remote.profiles.active_id ?? ''}
          disabled={remote.pending} onChange={(event) => void remote.send({ action: 'set_profile', item_id: event.target.value })}
          className="bg-card min-h-11 min-w-0 max-w-64 rounded-xl border px-3 text-sm">
          {remote.profiles.items.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </div>}

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

      <div role="tablist" aria-label="Remote destination" className={cn('bg-secondary mx-4 mb-3 grid shrink-0 gap-1 rounded-2xl p-1 md:mx-0', guideAvailable ? 'grid-cols-4' : 'grid-cols-3')}>
        {([
          { id: 'controls', label: 'Controls', Icon: SlidersHorizontal },
          { id: 'apps', label: 'Apps', Icon: AppWindow },
          ...(guideAvailable ? [{ id: 'guide', label: 'Guide', Icon: CalendarDays }] : []),
          { id: 'media', label: 'Playing', Icon: MonitorPlay },
        ]).map(({ id, label, Icon }) => <button key={id} type="button" role="tab" aria-selected={destination === id}
          onClick={() => setSurface(id === 'controls' ? controlMode : id as Surface)}
          className={cn('flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-medium sm:text-sm', destination === id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          <Icon aria-hidden className="size-4 shrink-0" />{label}
        </button>)}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_17rem] md:gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <main aria-label={`${device.name} remote content`} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 md:px-0">
          {unpaired ? (
            <RePairPrompt name={device.name} reason={device.state.error} onPair={() => setPairingOpen(true)} />
          ) : (
            <div className="flex w-full min-w-0 flex-col gap-3 py-2">
              <ErrorStrip message={control.error} onDismiss={control.clearError} />
              <ErrorStrip message={remote.error} onDismiss={remote.clearError} />
              {remote.message && <p role="status" className="text-muted-foreground rounded-xl border px-3 py-2 text-xs">{remote.message}</p>}
              {surface === 'guide' && !guideAvailable && <p role="status" className="text-muted-foreground text-sm">The guide is unavailable. You can still use the standard remote controls.</p>}
              {destination === 'controls' && <section aria-label="Remote controls" className="flex min-w-0 flex-col items-center gap-4">
                <div role="group" aria-label="Control mode" className="bg-secondary grid w-full max-w-sm grid-cols-3 gap-1 rounded-xl p-1">
                  {(['dpad', 'touch', 'text'] as const).map((mode) => <button key={mode} type="button" aria-pressed={(controlsSelected ? surface : controlMode) === mode}
                    onClick={() => { setControlMode(mode); setSurface(mode) }} className={cn('min-h-10 cursor-pointer rounded-lg text-xs font-medium', (controlsSelected ? surface : controlMode) === mode && 'bg-card shadow-sm')}>
                    {mode === 'dpad' ? 'D-pad' : mode === 'touch' ? 'Touchpad' : 'Text'}
                  </button>)}
                </div>
                {(controlsSelected ? surface : controlMode) === 'dpad' && <DPad control={control} />}
                {(controlsSelected ? surface : controlMode) === 'touch' && <Touchpad control={control} />}
                {(controlsSelected ? surface : controlMode) === 'text' && <TextEntry control={control} />}
                <p className="text-muted-foreground max-w-sm text-center text-xs">Controlling {device.name}</p>
              </section>}
              {destination === 'apps' && <>
                {capabilities.includes('catalog') ? <ProviderApps remote={remote} deviceName={device.name} /> : <section className="flex flex-col items-center gap-3">
                  <h2 className="self-start text-lg font-semibold">App shortcuts</h2><p className="text-muted-foreground self-start text-xs">Popular apps. Availability varies by TV.</p>
                  <AppLauncher control={control} apps={state.apps} state={device.state} />
                </section>}
                {capabilities.includes('browse') && <MediaBrowse key={remote.scope} deviceId={device.id} remote={remote} />}
              </>}
              {destination === 'guide' && <Guide key={remote.scope} deviceId={device.id} deviceName={device.name} remote={remote} />}
              {destination === 'media' && <div className="flex justify-center"><ProviderPlaying key={device.id} remote={remote} device={device} apps={state.apps} control={control} /></div>}
            </div>
          )}
        </main>

        <aside aria-label={`Core controls for ${device.name}`} className="w-full min-w-0 shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:min-h-0 md:overflow-y-auto md:border-l md:pl-5 md:pr-0 md:pb-0">
          <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5">
            {destination !== 'controls' && !unpaired && <div className="hidden w-full flex-col items-center gap-3 md:flex"><p className="text-muted-foreground text-xs">Remote · {device.name}</p><DPad control={control} className="w-full max-w-52" /></div>}
            <Deck control={control} state={device.state} />
          </div>
        </aside>
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
