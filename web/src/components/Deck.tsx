/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The persistent core deck of the Android TV Remote web UI: navigation and transport keys
 * and the segmented volume pill, independent from optional provider navigation. The deck
 * never changes as the content beside or above it does, so
 * back, home, play/pause, and volume stay exactly where the user's thumb left them —
 * the single most important layout rule taken from the Google TV and SmartThings remotes.
 */
import {
  ArrowLeft,
  Home,
  Menu,
  Minus,
  Play,
  Plus,
  Power,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { Key } from '@/components/ui'
import { cn } from '@/lib/utils'
import { KEYS } from '@/lib/keys'
import type { DeviceState } from '@/lib/api-types'
import type { RemoteControl } from '@/hooks/useRemoteControl'

/**
 * The bottom deck.
 *
 * @param props.control - The bound remote control for the active device.
 * @param props.state - The device's live state, used for the power and mute readouts.
 */
export function Deck({
  control,
  state,
}: {
  control: RemoteControl
  state: DeviceState
}) {
  const { send, hold, volume, togglePower, disabled } = control
  const muted = state.volume?.muted ?? false
  const level = state.volume?.level ?? null

  return (
    <div className="tv-core-deck flex w-full max-w-sm flex-col gap-3">
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

    </div>
  )
}
