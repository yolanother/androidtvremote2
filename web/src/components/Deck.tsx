/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The fixed bottom deck of the Android TV Remote web UI: the navigation and transport keys,
 * the segmented volume pill, and the tab bar that switches the stage between the D-pad,
 * touchpad, text, app, and now-playing surfaces. The deck never changes as the stage above it does, so
 * back, home, play/pause, and volume stay exactly where the user's thumb left them —
 * the single most important layout rule taken from the Google TV and SmartThings remotes.
 */
import {
  ArrowLeft,
  Grid3x3,
  Home,
  Keyboard,
  Menu,
  Minus,
  MonitorPlay,
  Play,
  Plus,
  Power,
  SkipBack,
  SkipForward,
  Squircle,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { Key } from '@/components/ui'
import { cn } from '@/lib/utils'
import { KEYS } from '@/lib/keys'
import type { Surface } from '@/lib/prefs'
import type { DeviceState } from '@/lib/api-types'
import type { RemoteControl } from '@/hooks/useRemoteControl'

/** The five stage surfaces, in tab order. */
const SURFACES: Array<{ id: Surface; label: string; Icon: typeof Home }> = [
  { id: 'dpad', label: 'D-pad', Icon: Squircle },
  { id: 'touch', label: 'Touchpad', Icon: Grid3x3 },
  { id: 'text', label: 'Text', Icon: Keyboard },
  { id: 'apps', label: 'Apps', Icon: Play },
  { id: 'media', label: 'Playing', Icon: MonitorPlay },
]

/**
 * The bottom deck.
 *
 * @param props.control - The bound remote control for the active device.
 * @param props.state - The device's live state, used for the power and mute readouts.
 * @param props.surface - The currently selected stage surface.
 * @param props.onSurfaceChange - Called when the user picks a different surface.
 */
export function Deck({
  control,
  state,
  surface,
  onSurfaceChange,
}: {
  control: RemoteControl
  state: DeviceState
  surface: Surface
  onSurfaceChange: (surface: Surface) => void
}) {
  const { send, hold, volume, togglePower, disabled } = control
  const muted = state.volume?.muted ?? false
  const level = state.volume?.level ?? null

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {/* Navigation row. */}
      <div className="grid grid-cols-4 gap-2">
        <Key label="Back" round disabled={disabled} {...hold(KEYS.back)} className="h-14">
          <ArrowLeft aria-hidden className="size-5" />
        </Key>
        <Key label="Home" round disabled={disabled} onClick={() => send(KEYS.home)} className="h-14">
          <Home aria-hidden className="size-5" />
        </Key>
        <Key label="Menu" round disabled={disabled} onClick={() => send(KEYS.menu)} className="h-14">
          <Menu aria-hidden className="size-5" />
        </Key>
        <Key
          label={state.is_on === null ? 'Power' : state.is_on ? 'Power off' : 'Power on'}
          round
          // Power stays live on a disconnected-but-paired TV: waking it is the point.
          disabled={state.connection === 'unpaired' || state.connection === 'disabled'}
          onClick={togglePower}
          className="h-14"
        >
          <Power
            aria-hidden
            className={cn('size-5', state.is_on === true && 'text-online')}
          />
        </Key>
      </div>

      {/* Transport row. */}
      <div className="grid grid-cols-3 gap-2">
        <Key
          label="Previous"
          disabled={disabled}
          onClick={() => send(KEYS.previous)}
          className="h-12"
        >
          <SkipBack aria-hidden className="size-5" />
        </Key>
        <Key
          label="Play or pause"
          tone="accent"
          disabled={disabled}
          onClick={() => send(KEYS.playPause)}
          className="h-12"
        >
          <Play aria-hidden className="size-5 fill-current" />
        </Key>
        <Key label="Next" disabled={disabled} onClick={() => send(KEYS.next)} className="h-12">
          <SkipForward aria-hidden className="size-5" />
        </Key>
      </div>

      {/* Volume. The level line is always rendered so a reading arriving from the TV never
          shifts the pill beneath it. */}
      <div className="flex flex-col gap-1">
        <div className="text-muted-foreground flex h-4 items-center justify-between px-1 text-[0.6875rem]">
          <span>Volume</span>
          <span aria-live="polite">
            {muted ? 'Muted' : level !== null ? `${level}${state.volume?.max ? ` / ${state.volume.max}` : ''}` : ''}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl">
          <Key
            label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            disabled={disabled}
            onClick={() => volume('toggle_mute')}
            className={cn('h-12 rounded-none', muted && 'text-destructive')}
          >
            {muted ? (
              <VolumeX aria-hidden className="size-5" />
            ) : (
              <Volume2 aria-hidden className="size-5" />
            )}
          </Key>
          <Key
            label="Volume down"
            disabled={disabled}
            {...hold(KEYS.volumeDown)}
            className="h-12 rounded-none"
          >
            <Minus aria-hidden className="size-5" />
          </Key>
          <Key
            label="Volume up"
            disabled={disabled}
            {...hold(KEYS.volumeUp)}
            className="h-12 rounded-none"
          >
            <Plus aria-hidden className="size-5" />
          </Key>
        </div>
      </div>

      {/* Surface tabs. Visible rather than tucked into an overflow menu — see
          docs/design/ui.md, "Deliberate deviations". */}
      <div role="tablist" aria-label="Control surface" className="bg-secondary grid grid-cols-5 gap-1 rounded-2xl p-1">
        {SURFACES.map(({ id, label, Icon }) => {
          const selected = surface === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSurfaceChange(id)}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl',
                'text-[0.6875rem] font-medium transition-colors duration-150',
                selected
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
