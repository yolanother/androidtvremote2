/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The selected-TV remote workspace. Provides Controls, Apps, optional Guide and Playing
 * destinations with a persistent header and core keys; phones use a single content pane
 * and tablets/desktops gain a wider browsing pane beside remote controls. Content panes
 * scroll independently, while D-pad and touchpad occupy a height-bounded, non-scrolling
 * stage. The action bar owns profiles; one icon navigation row includes the control-mode
 * picker and simultaneously springs the old destination label closed and the selected
 * label open, respecting reduced motion. Binds the physical
 * keyboard to the same key paths, replaces the controls with an actionable re-pair prompt
 * when the television reports `unpaired`, and surfaces appliance-socket loss as a banner.
 * Budgets the actual visible phone height and in-flow update notice so enlarged text
 * and installed-app updates cannot push the input surface or core keys off screen.
 * Roomy desktops use Playing as the default content destination and keep the selected
 * input surface mounted beside every content pane, without replacing mobile preferences.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { motion } from 'motion/react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppWindow, CalendarDays, Hand, Keyboard, Lock, MonitorPlay, Move, PlugZap, SlidersHorizontal, Tv } from 'lucide-react'

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
import { useVisibleViewportHeight } from '@/hooks/useVisibleViewportHeight'
import { useIntegration } from '@/hooks/useIntegration'
import { setLastDevice, useSurface, type Surface } from '@/lib/prefs'
import { cn } from '@/lib/utils'
import { useOrganicMotion } from '@/lib/motion'
import { useDevice, useRemote } from '@/state/store'

/** Desktop content mode needs enough width and height for persistent sidebar controls. */
const DESKTOP_LAYOUT = '(min-width: 1024px) and (min-height: 600px)'

/** Follow layout changes as a window is resized or a foldable screen changes size. */
function watchDesktopLayout(listener: () => void): () => void {
  const media = window.matchMedia(DESKTOP_LAYOUT)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** Read the current spacious-layout match without storing a presentation preference. */
function desktopLayout(): boolean {
  return window.matchMedia(DESKTOP_LAYOUT).matches
}

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
  const { reduced, transition } = useOrganicMotion()
  const viewportHeight = useVisibleViewportHeight()
  const desktop = useSyncExternalStore(watchDesktopLayout, desktopLayout, () => false)
  const controlsSelected = surface === 'dpad' || surface === 'touch' || surface === 'text'
  const contentSurface = desktop && controlsSelected ? 'media' : surface

  const control = useRemoteControl(device)
  const remote = useIntegration(device, contentSurface)
  const available = !!remote.integration?.available
  const capabilities = available ? remote.integration!.capabilities : []
  const guideAvailable = capabilities.includes('guide')
  const activeMode = controlsSelected ? surface : controlMode
  const ModeIcon = activeMode === 'touch' ? Hand : activeMode === 'text' ? Keyboard : Move
  const destination = contentSurface === 'apps' ? 'apps' : contentSurface === 'media' ? 'media'
    : contentSurface === 'guide' && guideAvailable ? 'guide' : desktop ? 'media' : 'controls'
  // Modal dialogs own the keyboard while they are open, or Escape would send BACK to the
  // TV instead of closing them.
  useKeyboardControl(control, !pairingOpen && !addOpen && (desktop || destination === 'controls'))

  useEffect(() => {
    if (deviceId) setLastDevice(deviceId)
  }, [deviceId])

  useEffect(() => {
    if (surface === 'dpad' || surface === 'touch' || surface === 'text') setControlMode(surface)
  }, [surface])

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
    <div className="tv-remote flex min-w-0 flex-col overflow-hidden md:p-4 xl:p-6"
      style={{ height: `calc(${viewportHeight}px - var(--pwa-update-height, 0px))` }}>
      <div className="tv-remote-frame bg-background mx-auto flex min-h-0 w-full max-w-[1700px] flex-1 flex-col md:rounded-3xl md:border md:p-4">
      <RemoteHeader
        device={device}
        onSelect={(id) => void navigate(`/d/${id}`)}
        onAdd={() => setAddOpen(true)}
        profiles={capabilities.includes('profiles') ? remote.profiles ?? undefined : undefined}
        profileId={remote.integration?.profile_id}
        profilePending={remote.pending}
        onProfileChange={(id) => void remote.send({ action: 'set_profile', item_id: id })}
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

      <div className="tv-navigation mx-4 mb-2 flex min-w-0 shrink-0 items-center gap-2 md:mx-0">
      <div role="tablist" aria-label="Remote destination" className="tv-destinations bg-secondary flex min-w-0 gap-1 rounded-2xl p-1">
        {([
          ...(!desktop ? [{ id: 'controls', label: 'Controls', Icon: SlidersHorizontal }] : []),
          { id: 'apps', label: 'Apps', Icon: AppWindow },
          ...(guideAvailable ? [{ id: 'guide', label: 'Guide', Icon: CalendarDays }] : []),
          { id: 'media', label: 'Playing', Icon: MonitorPlay },
        ]).map(({ id, label, Icon }) => <button key={id} type="button" role="tab" aria-label={label} title={label} aria-selected={destination === id}
          onClick={() => setSurface(id === 'controls' ? controlMode : id as Surface)}
          className={cn('flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl px-2 text-xs font-medium sm:text-sm', destination === id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          <Icon aria-hidden className="size-4 shrink-0" /><motion.span aria-hidden={destination !== id} className="overflow-hidden whitespace-nowrap"
            initial={false} animate={{ width: destination === id ? 'auto' : 0, opacity: destination === id ? 1 : 0, marginLeft: destination === id ? 6 : 0 }}
            transition={transition} style={{ maxWidth: 'clamp(40px, 20vw, 88px)' }}>
            <span className="block truncate">{label}</span>
          </motion.span>
        </button>)}
      </div>
      <div title={`Control mode: ${activeMode === 'dpad' ? 'D-pad' : activeMode === 'touch' ? 'Touchpad' : 'Text'}`}
        className="tv-mode-picker bg-secondary focus-within:ring-ring relative ml-auto grid size-11 shrink-0 place-items-center rounded-xl focus-within:ring-2">
        <ModeIcon aria-hidden className="pointer-events-none size-5" />
        <select aria-label="Control mode" value={activeMode}
          onChange={(event) => {
            const mode = event.target.value as 'dpad' | 'touch' | 'text'
            setControlMode(mode)
            if (!desktop || controlsSelected) setSurface(mode)
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0">
          <option value="dpad">D-pad</option><option value="touch">Touchpad</option><option value="text">Text</option>
        </select>
      </div>
      </div>

      <div className="tv-remote-workspace flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_17rem] md:gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <main aria-label={`${device.name} remote content`} className={cn('min-h-0 min-w-0 flex-1 px-4 pb-2 md:px-0',
          destination === 'controls' && !unpaired ? 'tv-controls-main flex flex-col overflow-hidden' : 'overflow-y-auto overscroll-contain')}>
          {unpaired ? (
            <RePairPrompt name={device.name} reason={device.state.error} onPair={() => setPairingOpen(true)} />
          ) : (
            <motion.div key={destination} initial={reduced ? false : { opacity: 0, y: destination === 'controls' ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} transition={transition}
              className={cn('flex w-full min-w-0 flex-col gap-3 py-1', destination === 'controls' && 'min-h-0 flex-1')}>
              <ErrorStrip message={control.error} onDismiss={control.clearError} />
              <ErrorStrip message={remote.error} onDismiss={remote.clearError} />
              {remote.message && <p role="status" className="text-muted-foreground rounded-xl border px-3 py-2 text-xs">{remote.message}</p>}
              {surface === 'guide' && !guideAvailable && <p role="status" className="text-muted-foreground text-sm">The guide is unavailable. You can still use the standard remote controls.</p>}
              {destination === 'controls' && <section aria-label="Remote controls" className={cn('tv-control-stage min-h-0 min-w-0 flex-1', activeMode === 'text' && 'tv-control-stage-text')}>
                {activeMode === 'dpad' && <DPad control={control} className="tv-fitted-dpad" />}
                {activeMode === 'touch' && <Touchpad control={control} className="tv-fitted-touchpad" />}
                {activeMode === 'text' && <TextEntry control={control} />}
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
            </motion.div>
          )}
        </main>

        <aside aria-label={`Core controls for ${device.name}`} className={cn('w-full min-w-0 shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:min-h-0 md:overflow-y-auto md:border-l md:pl-5 md:pr-0 md:pb-0', desktop && 'tv-desktop-sidebar')}>
          <div className="tv-remote-control-column mx-auto flex w-full max-w-sm flex-col items-center gap-5">
            {desktop && !unpaired && <section key={device.id} aria-label="Remote controls" className={cn('tv-desktop-control-stage tv-control-stage min-w-0', activeMode === 'text' && 'tv-control-stage-text')}>
              {activeMode === 'dpad' && <DPad control={control} className="tv-fitted-dpad" />}
              {activeMode === 'touch' && <Touchpad control={control} className="tv-fitted-touchpad" />}
              {activeMode === 'text' && <TextEntry control={control} />}
            </section>}
            {!desktop && destination !== 'controls' && !unpaired && <div className="tv-side-dpad hidden w-full flex-col items-center gap-3 md:flex"><p className="text-muted-foreground text-xs">Remote · {device.name}</p><DPad control={control} className="w-full max-w-52" /></div>}
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
