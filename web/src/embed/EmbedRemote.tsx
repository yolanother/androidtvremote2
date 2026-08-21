/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The embeddable Android TV remote's React component tree. Renders the optional status
 * strip, the D-pad, and the navigation, transport and volume rows for a single registered
 * device, wiring every button to the command callbacks from useRemote. The control set is
 * chosen by the `layout` query parameter (`compact` drops the transport row) and the whole
 * tree is deliberately self-contained -- it shares nothing with the full SPA's component
 * library -- because a 240x320 panel remote has different constraints from the full app.
 */
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FastForward,
  House,
  Play,
  Power,
  Rewind,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { ReactNode } from 'react'

import type { ConnectionStatus } from '@/lib/api-types'

import type { EmbedConfig } from './config'
import { useRemote } from './useRemote'

/** Human-readable text for each connection state, shown beside the status dot. */
const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  unreachable: 'Unreachable',
  unpaired: 'Not paired',
  disabled: 'Disabled',
}

/** Props for a single remote button. */
interface KeyButtonProps {
  /** Accessible name; also the tooltip. */
  label: string
  /** Icon or text to render inside the button. */
  children: ReactNode
  /** Fired on click. */
  onPress: () => void
  /** Grid area within the D-pad, when the button lives in one. */
  area?: string
  /** Visual tone hook consumed by embed.css. */
  tone?: string
  /** Renders the power button lit while the TV reports itself on. */
  on?: boolean
  /** Greys the button out when the embed has no device to talk to. */
  disabled?: boolean
}

/**
 * One remote key.
 *
 * `data-remote-key` opts the element into the global touch rules in index.css, which
 * suppress text selection and the iOS long-press callout on a held button.
 */
function KeyButton({ label, children, onPress, area, tone, on, disabled }: KeyButtonProps) {
  return (
    <button
      type="button"
      className="embed-key"
      data-remote-key=""
      data-area={area}
      data-tone={tone}
      data-on={on ? 'true' : undefined}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  )
}

/** Props for the embeddable remote. */
export interface EmbedRemoteProps {
  /** Configuration parsed from the embed URL's query string. */
  config: EmbedConfig
}

/**
 * The embeddable remote for one device.
 *
 * @param props - The parsed embed configuration.
 * @returns A remote sized to completely fill its iframe at any frame dimension.
 */
export function EmbedRemote({ config }: EmbedRemoteProps) {
  const { device, state, loaded, live, error, sendKey, sendVolume, togglePower } =
    useRemote(config)

  // Without a device id there is nothing to command, so the keys are inert rather than
  // silently no-op. Every other failure leaves them live: the TV may simply be asleep.
  const disabled = !config.deviceId
  const connection = state?.connection ?? 'disconnected'
  const muted = state?.volume?.muted === true

  return (
    <div className="embed" data-remote-surface="">
      {config.header && (
        <header className="embed-header">
          <span
            className="embed-dot"
            data-connection={connection}
            role="img"
            aria-label={CONNECTION_LABEL[connection]}
          />
          <span className="embed-name">
            {device?.name ?? (config.deviceId ? 'Loading…' : 'No device')}
          </span>
          <span className="embed-status">
            {live ? CONNECTION_LABEL[connection] : loaded ? 'Offline' : '…'}
          </span>
        </header>
      )}

      {error && (
        <p className="embed-error" role="status">
          {error}
        </p>
      )}

      <div className="embed-body">
        <div className="embed-pad-slot">
          <div className="embed-pad">
            <KeyButton area="up" label="Up" disabled={disabled} onPress={() => sendKey('DPAD_UP')}>
              <ChevronUp />
            </KeyButton>
            <KeyButton
              area="left"
              label="Left"
              disabled={disabled}
              onPress={() => sendKey('DPAD_LEFT')}
            >
              <ChevronLeft />
            </KeyButton>
            <KeyButton
              area="ok"
              label="Select"
              disabled={disabled}
              onPress={() => sendKey('DPAD_CENTER')}
            >
              OK
            </KeyButton>
            <KeyButton
              area="right"
              label="Right"
              disabled={disabled}
              onPress={() => sendKey('DPAD_RIGHT')}
            >
              <ChevronRight />
            </KeyButton>
            <KeyButton
              area="down"
              label="Down"
              disabled={disabled}
              onPress={() => sendKey('DPAD_DOWN')}
            >
              <ChevronDown />
            </KeyButton>
          </div>
        </div>

        <div className="embed-row">
          <KeyButton label="Back" disabled={disabled} onPress={() => sendKey('BACK')}>
            <Undo2 />
          </KeyButton>
          <KeyButton label="Home" disabled={disabled} onPress={() => sendKey('HOME')}>
            <House />
          </KeyButton>
          <KeyButton
            label="Power"
            tone="power"
            on={state?.is_on === true}
            disabled={disabled}
            onPress={togglePower}
          >
            <Power />
          </KeyButton>
        </div>

        {config.layout === 'full' && (
          <div className="embed-row">
            <KeyButton label="Rewind" disabled={disabled} onPress={() => sendKey('MEDIA_REWIND')}>
              <Rewind />
            </KeyButton>
            <KeyButton
              label="Play / pause"
              disabled={disabled}
              onPress={() => sendKey('MEDIA_PLAY_PAUSE')}
            >
              <Play />
            </KeyButton>
            <KeyButton
              label="Fast forward"
              disabled={disabled}
              onPress={() => sendKey('MEDIA_FAST_FORWARD')}
            >
              <FastForward />
            </KeyButton>
          </div>
        )}

        <div className="embed-row">
          <KeyButton label="Volume down" disabled={disabled} onPress={() => sendVolume('down')}>
            <VolumeDownIcon />
          </KeyButton>
          <KeyButton
            label={muted ? 'Unmute' : 'Mute'}
            tone={muted ? 'muted' : undefined}
            disabled={disabled}
            onPress={() => sendVolume('toggle_mute')}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </KeyButton>
          <KeyButton label="Volume up" disabled={disabled} onPress={() => sendVolume('up')}>
            <VolumeUpIcon />
          </KeyButton>
        </div>
      </div>
    </div>
  )
}

/** Minus glyph drawn on the same 24-unit grid as the lucide icons, for volume down. */
function VolumeDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  )
}

/** Plus glyph drawn on the same 24-unit grid as the lucide icons, for volume up. */
function VolumeUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14M12 5v14" />
    </svg>
  )
}
