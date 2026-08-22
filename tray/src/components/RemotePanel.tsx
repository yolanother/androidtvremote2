/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The remote surface of the Android TV Remote tray panel: device switcher, power, a circular
 * D-pad with OK, a back/home row, transport controls, a segmented volume pill, and a
 * text-entry row that types into the TV's focused field — matching the layout and moulded
 * key styling of the default web remote view. Every control issues the corresponding
 * request from the frozen API contract — key presses through `POST /api/devices/{id}/keys`,
 * power through the idempotent `/power` endpoint, and volume through `/volume` — and the
 * panel is fully keyboard-operable, with the arrow keys driving the D-pad while it has focus.
 */
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  CornerUpLeft,
  FastForward,
  Home,
  Keyboard,
  Minus,
  Play,
  Plus,
  Power,
  RefreshCw,
  Rewind,
  Settings as SettingsIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import type { Appliance } from '@/lib/useAppliance'
import { DPad, type Direction } from './DPad'
import { RemoteButton, StatusDot, cn, inputClass } from './ui'

/** Keys the panel sends, in the contract's short form. */
const KEY = {
  up: 'DPAD_UP',
  down: 'DPAD_DOWN',
  left: 'DPAD_LEFT',
  right: 'DPAD_RIGHT',
  ok: 'DPAD_CENTER',
  back: 'BACK',
  home: 'HOME',
  playPause: 'MEDIA_PLAY_PAUSE',
  rewind: 'MEDIA_REWIND',
  forward: 'MEDIA_FAST_FORWARD',
} as const

/**
 * Renders the remote.
 *
 * @param appliance - the state facade from `useAppliance`.
 * @param onOpenSettings - opens the settings screen.
 */
export function RemotePanel({
  appliance,
  onOpenSettings,
}: {
  appliance: Appliance
  onOpenSettings: () => void
}) {
  const { device, devices, link, linkError, actionError, run, selectDevice, retry } = appliance
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)

  const disabled = !device || device.state.connection !== 'connected'
  const key = (name: string, repeat = 1) => run((api, id) => api.sendKey(id, name, 'SHORT', repeat))
  const direction = (d: Direction) => key(KEY[d])

  // Arrow keys drive the D-pad whenever the panel, rather than a text field, has focus.
  useEffect(() => {
    if (typing) return
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, string> = {
        ArrowUp: KEY.up,
        ArrowDown: KEY.down,
        ArrowLeft: KEY.left,
        ArrowRight: KEY.right,
        Enter: KEY.ok,
        Backspace: KEY.back,
        h: KEY.home,
        ' ': KEY.playPause,
      }
      const mapped = map[event.key]
      if (mapped) {
        event.preventDefault()
        key(mapped)
        return
      }
      if (event.key === 'm') run((api, id) => api.setVolume(id, { action: 'toggle_mute' }))
      if (event.key === '+' || event.key === '=')
        run((api, id) => api.setVolume(id, { action: 'up' }))
      if (event.key === '-') run((api, id) => api.setVolume(id, { action: 'down' }))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [typing, run])

  const muted = device?.state.volume?.muted === true
  const level = device?.state.volume?.level ?? null
  const max = device?.state.volume?.max ?? null
  const banner = actionError ?? (link === 'closed' ? (linkError ?? 'Disconnected') : null)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* The header packs several small controls into very little width, so it opts out of
          the panel's "deep" drag region — an imprecise click landing on its background would
          otherwise start dragging the window instead of hitting the intended button. */}
      <header className="flex items-center gap-2" data-tauri-drag-region="false">
        <StatusDot status={device?.state.connection ?? 'disconnected'} />
        {devices.length > 0 ? (
          <select
            aria-label="Device"
            value={device?.id ?? ''}
            onChange={(event) => selectDevice(event.target.value)}
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-xs outline-none"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1 truncate text-xs text-[var(--muted)]">
            {link === 'open' ? 'No devices registered' : 'Not connected'}
          </span>
        )}
        <RemoteButton
          variant="ghost"
          aria-label="Power"
          title="Power"
          disabled={!device}
          onPress={() => run((api, id) => api.setPower(id, device?.state.is_on === true ? false : true))}
          className="size-7"
        >
          <Power className="size-4" />
        </RemoteButton>
        <RemoteButton
          variant="ghost"
          aria-label="Settings"
          title="Settings"
          onPress={onOpenSettings}
          className="size-7"
        >
          <SettingsIcon className="size-4" />
        </RemoteButton>
        <RemoteButton
          variant="ghost"
          aria-label="Hide"
          title="Hide"
          onPress={() => void invoke('hide_panel').catch(() => undefined)}
          className="size-7"
        >
          <X className="size-4" />
        </RemoteButton>
      </header>

      {banner ? (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-danger">
          <span className="min-w-0 flex-1 truncate" title={banner}>
            {banner}
          </span>
          <button
            type="button"
            onClick={retry}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-foreground hover:brightness-125"
          >
            <RefreshCw className="size-3" />
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <RemoteButton aria-label="Back" title="Back" disabled={disabled} onPress={() => key(KEY.back)} className="h-11 rounded-full">
          <CornerUpLeft className="size-4" />
        </RemoteButton>
        <RemoteButton aria-label="Home" title="Home" disabled={disabled} onPress={() => key(KEY.home)} className="h-11 rounded-full">
          <Home className="size-4" />
        </RemoteButton>
      </div>

      <DPad disabled={disabled} onDirection={direction} onOk={() => key(KEY.ok)} />

      {/* Volume. The level line is always rendered so a reading arriving from the TV never
          shifts the pill beneath it. */}
      <div className="flex flex-col gap-1">
        <div className="flex h-4 items-center justify-between px-1 text-[11px] text-[var(--muted)]">
          <span>Volume</span>
          <span aria-live="polite">
            {muted ? 'Muted' : level !== null ? `${level}${max ? ` / ${max}` : ''}` : ''}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl">
          <RemoteButton
            variant="key"
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute' : 'Mute'}
            disabled={disabled}
            onPress={() => run((api, id) => api.setVolume(id, { action: 'toggle_mute' }))}
            className={cn('h-11 rounded-none', muted && 'text-pairing')}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </RemoteButton>
          <RemoteButton
            variant="key"
            aria-label="Volume down"
            title="Volume down"
            repeat
            disabled={disabled}
            onPress={() => run((api, id) => api.setVolume(id, { action: 'down' }))}
            className="h-11 rounded-none"
          >
            <Minus className="size-4" />
          </RemoteButton>
          <RemoteButton
            variant="key"
            aria-label="Volume up"
            title="Volume up"
            repeat
            disabled={disabled}
            onPress={() => run((api, id) => api.setVolume(id, { action: 'up' }))}
            className="h-11 rounded-none"
          >
            <Plus className="size-4" />
          </RemoteButton>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <RemoteButton aria-label="Rewind" title="Rewind" disabled={disabled} onPress={() => key(KEY.rewind)} className="h-11">
          <Rewind className="size-4" />
        </RemoteButton>
        <RemoteButton aria-label="Play or pause" title="Play / pause" disabled={disabled} onPress={() => key(KEY.playPause)} className="h-11">
          <Play className="size-4" />
        </RemoteButton>
        <RemoteButton aria-label="Fast forward" title="Fast forward" disabled={disabled} onPress={() => key(KEY.forward)} className="h-11">
          <FastForward className="size-4" />
        </RemoteButton>
      </div>

      <form
        className="mt-auto flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!text) return
          run((api, id) => api.sendText(id, text))
          setText('')
        }}
      >
        <Keyboard className="size-4 shrink-0 text-[var(--muted)]" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          disabled={disabled}
          placeholder="Type on the TV…"
          className={inputClass}
        />
      </form>

      <p className="text-center text-[10px] text-[var(--muted)]">
        Arrows move · Enter selects · Backspace goes back · Esc hides
      </p>
    </div>
  )
}
