/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The embeddable Android TV remote's React component tree. Renders, for a single
 * registered device, the optional status strip and whichever key groups the resolved
 * EmbedConfig asked for: a D-pad or a swipe touchpad, plus navigation, transport and
 * volume rows. When the device is missing, unpaired, disabled or unreachable it replaces
 * the controls with an actionable notice linking to the full UI rather than presenting a
 * D-pad that cannot work. The tree is deliberately self-contained -- it shares nothing
 * with the full SPA's component library -- because a 240x320 panel remote has genuinely
 * different constraints from the full app.
 */
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
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
import { Touchpad } from './Touchpad'
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

/**
 * Connection states the remote cannot usefully drive, and what to tell the operator.
 *
 * `disconnected` is deliberately absent: the appliance reconnects on its own, and a TV
 * that is merely asleep still answers a power key.
 */
const BLOCKING_REASON: Partial<Record<ConnectionStatus, string>> = {
  unpaired: 'This TV is not paired yet.',
  unreachable: 'This TV is not answering.',
  disabled: 'This device is disabled in the appliance.',
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
}

/**
 * One remote key.
 *
 * `data-remote-key` opts the element into the global touch rules in index.css, which
 * suppress text selection and the iOS long-press callout on a held button.
 */
function KeyButton({ label, children, onPress, area, tone, on }: KeyButtonProps) {
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
      onClick={onPress}
    >
      {children}
    </button>
  )
}

/** Props for a row of keys, which sizes its columns to however many it was given. */
interface KeyRowProps {
  /** The buttons to lay out across the row. */
  children: ReactNode[]
}

/**
 * A row of equally sized keys.
 *
 * @param props - The buttons to place. The column count follows the button count, so a
 *   volume-only embed gets three full-width keys rather than three keys and a gap.
 */
function KeyRow({ children }: KeyRowProps) {
  return (
    <div className="embed-row" style={{ gridTemplateColumns: `repeat(${children.length}, 1fr)` }}>
      {children}
    </div>
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

  const connection = state?.connection ?? 'disconnected'
  const muted = state?.volume?.muted === true
  const show = (group: string) => config.keys.includes(group as never)

  // A frame that cannot command the TV says so and offers the fix, rather than rendering
  // controls that silently do nothing.
  const blocked: string | null = !config.deviceId
    ? 'This embed has no device: add ?device=<id> to the iframe URL.'
    : loaded && !device && error
      ? error
      : (BLOCKING_REASON[connection] ?? null)

  const navKeys = [
    show('back') && (
      <KeyButton key="back" label="Back" onPress={() => sendKey('BACK')}>
        <Undo2 />
      </KeyButton>
    ),
    show('home') && (
      <KeyButton key="home" label="Home" onPress={() => sendKey('HOME')}>
        <House />
      </KeyButton>
    ),
    show('power') && (
      <KeyButton
        key="power"
        label="Power"
        tone="power"
        on={state?.is_on === true}
        onPress={togglePower}
      >
        <Power />
      </KeyButton>
    ),
  ].filter(Boolean) as ReactNode[]

  return (
    <div className="embed" data-remote-surface="" data-layout={config.layout}>
      {config.header && (
        <header className="embed-header" data-live={live ? 'true' : 'false'}>
          <span
            className="embed-dot"
            data-connection={connection}
            role="img"
            aria-label={CONNECTION_LABEL[connection]}
          />
          <span className="embed-name">
            {device?.name ?? (!config.deviceId ? 'No device' : loaded ? 'Unavailable' : 'Loading…')}
          </span>
          <span className="embed-status">
            {live ? CONNECTION_LABEL[connection] : loaded ? 'Offline' : '…'}
          </span>
        </header>
      )}

      {blocked ? (
        <div className="embed-notice" role="status">
          <p className="embed-notice-text">{blocked}</p>
          {state?.error && <p className="embed-notice-detail">{state.error}</p>}
          <a className="embed-notice-link" href="/" target="_blank" rel="noreferrer noopener">
            Open the full remote
            <ExternalLink />
          </a>
        </div>
      ) : (
        <div className="embed-body">
          {error && (
            <p className="embed-error" role="status">
              {error}
            </p>
          )}

          {show('dpad') &&
            (config.surface === 'touchpad' ? (
              <div className="embed-pad-slot">
                <Touchpad onDirection={sendKey} onSelect={() => sendKey('DPAD_CENTER')} />
              </div>
            ) : (
              <div className="embed-pad-slot">
                <div className="embed-pad">
                  <KeyButton area="up" label="Up" onPress={() => sendKey('DPAD_UP')}>
                    <ChevronUp />
                  </KeyButton>
                  <KeyButton area="left" label="Left" onPress={() => sendKey('DPAD_LEFT')}>
                    <ChevronLeft />
                  </KeyButton>
                  <KeyButton area="ok" label="Select" onPress={() => sendKey('DPAD_CENTER')}>
                    OK
                  </KeyButton>
                  <KeyButton area="right" label="Right" onPress={() => sendKey('DPAD_RIGHT')}>
                    <ChevronRight />
                  </KeyButton>
                  <KeyButton area="down" label="Down" onPress={() => sendKey('DPAD_DOWN')}>
                    <ChevronDown />
                  </KeyButton>
                </div>
              </div>
            ))}

          {navKeys.length > 0 && <KeyRow>{navKeys}</KeyRow>}

          {show('transport') && (
            <KeyRow>
              {[
                <KeyButton key="rw" label="Rewind" onPress={() => sendKey('MEDIA_REWIND')}>
                  <Rewind />
                </KeyButton>,
                <KeyButton
                  key="pp"
                  label="Play / pause"
                  onPress={() => sendKey('MEDIA_PLAY_PAUSE')}
                >
                  <Play />
                </KeyButton>,
                <KeyButton
                  key="ff"
                  label="Fast forward"
                  onPress={() => sendKey('MEDIA_FAST_FORWARD')}
                >
                  <FastForward />
                </KeyButton>,
              ]}
            </KeyRow>
          )}

          {show('volume') && (
            <KeyRow>
              {[
                <KeyButton key="vd" label="Volume down" onPress={() => sendVolume('down')}>
                  <MinusIcon />
                </KeyButton>,
                <KeyButton
                  key="mute"
                  label={muted ? 'Unmute' : 'Mute'}
                  tone={muted ? 'muted' : undefined}
                  onPress={() => sendVolume('toggle_mute')}
                >
                  {muted ? <VolumeX /> : <Volume2 />}
                </KeyButton>,
                <KeyButton key="vu" label="Volume up" onPress={() => sendVolume('up')}>
                  <PlusIcon />
                </KeyButton>,
              ]}
            </KeyRow>
          )}
        </div>
      )}
    </div>
  )
}

/** Minus glyph drawn on the same 24-unit grid as the lucide icons, for volume down. */
function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  )
}

/** Plus glyph drawn on the same 24-unit grid as the lucide icons, for volume up. */
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14M12 5v14" />
    </svg>
  )
}
