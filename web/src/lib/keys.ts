/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Key catalog and physical-keyboard bindings for the Android TV Remote web UI. Names every
 * TV key the interface sends (a subset of TvKeys.txt, in the short form the appliance's
 * `POST /api/devices/{id}/keys` accepts), and maps desktop keyboard events onto those keys
 * so the remote is fully operable without a pointer. Also holds the shared press-and-hold
 * repeat timings used by both the D-pad and the volume controls.
 */

/** The keys this UI can emit, in the short form the contract accepts. */
export const KEYS = {
  up: 'DPAD_UP',
  down: 'DPAD_DOWN',
  left: 'DPAD_LEFT',
  right: 'DPAD_RIGHT',
  ok: 'DPAD_CENTER',
  back: 'BACK',
  home: 'HOME',
  menu: 'MENU',
  power: 'POWER',
  playPause: 'MEDIA_PLAY_PAUSE',
  next: 'MEDIA_NEXT',
  previous: 'MEDIA_PREVIOUS',
  rewind: 'MEDIA_REWIND',
  fastForward: 'MEDIA_FAST_FORWARD',
  volumeUp: 'VOLUME_UP',
  volumeDown: 'VOLUME_DOWN',
  mute: 'MUTE',
  del: 'DEL',
  enter: 'ENTER',
  search: 'SEARCH',
  settings: 'SETTINGS',
} as const

/** A directional key emitted by the D-pad, the touchpad, and the arrow-key bindings. */
export type Direction = 'up' | 'down' | 'left' | 'right'

/** Short-form key name for each swipe/press direction. */
export const DIRECTION_KEYS: Record<Direction, string> = {
  up: KEYS.up,
  down: KEYS.down,
  left: KEYS.left,
  right: KEYS.right,
}

/**
 * Delay before a held key starts repeating, in milliseconds. Long enough that a normal
 * tap never repeats, short enough that holding feels immediate.
 */
export const REPEAT_DELAY_MS = 400

/** Interval between repeats of a held key, in milliseconds. */
export const REPEAT_INTERVAL_MS = 120

/**
 * Desktop keyboard bindings, keyed by `KeyboardEvent.key`. Documented in
 * docs/design/ui.md; suppressed while focus is inside a text field.
 */
const KEYBOARD_BINDINGS: Record<string, string> = {
  ArrowUp: KEYS.up,
  ArrowDown: KEYS.down,
  ArrowLeft: KEYS.left,
  ArrowRight: KEYS.right,
  Enter: KEYS.ok,
  Escape: KEYS.back,
  Backspace: KEYS.back,
  ' ': KEYS.playPause,
  k: KEYS.playPause,
  h: KEYS.home,
  m: KEYS.mute,
  '+': KEYS.volumeUp,
  '=': KEYS.volumeUp,
  '-': KEYS.volumeDown,
  '_': KEYS.volumeDown,
  '[': KEYS.previous,
  ']': KEYS.next,
}

/**
 * Resolve a physical keyboard event to the TV key it should send.
 *
 * @param event - The originating keydown event.
 * @returns The short-form key name, or null when the event is not bound or a modifier is
 *          held (so browser shortcuts such as Ctrl+L keep working).
 */
export function keyForEvent(event: KeyboardEvent): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  return KEYBOARD_BINDINGS[event.key] ?? null
}

/**
 * Report whether a keyboard event originated inside an editable field, in which case the
 * remote's bindings must not swallow it.
 *
 * @param target - The event target to test.
 * @returns True when the target is an input, textarea, select, or contenteditable node.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  )
}

/**
 * Fire a short confirmation tick on devices that support haptics.
 *
 * @param ms - Pulse length; the default is a tick rather than a felt buzz.
 */
export function haptic(ms = 8): void {
  navigator.vibrate?.(ms)
}
