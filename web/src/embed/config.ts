/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Query-string configuration surface for the embeddable Android TV remote. Parses the
 * `device`, `token`, `layout`, `keys`, `theme`, `bg` and `header` parameters that a host
 * page supplies through the `<iframe src>` into a validated EmbedConfig, resolving the
 * chosen layout into a navigation surface (D-pad or touchpad) and an ordered set of key
 * groups that `?keys=` may override. Also provides the two pure helpers the remote needs
 * alongside it: the same-origin WebSocket URL (which carries the token as a query
 * parameter because the WebSocket constructor cannot set headers) and the idempotent
 * power-request body. Every value falls back to a safe default rather than throwing, so a
 * malformed embed URL still renders a usable remote.
 */
import type { SetPowerRequest } from '@/lib/api-types'

/** Which preset of controls the embed renders. */
export type EmbedLayout = 'dpad' | 'touchpad' | 'compact' | 'full'

/** How directional input is collected: discrete keys, or a swipe surface. */
export type EmbedSurface = 'dpad' | 'touchpad'

/** Colour scheme, where `auto` follows the host device's `prefers-color-scheme`. */
export type EmbedTheme = 'auto' | 'light' | 'dark'

/** A block of related keys that a host page can include or omit via `?keys=`. */
export type EmbedKeyGroup = 'dpad' | 'back' | 'home' | 'power' | 'transport' | 'volume'

/** Validated configuration derived from the embed URL's query string. */
export interface EmbedConfig {
  /** Registered device id (MAC, lowercased, colons stripped), or null when absent. */
  deviceId: string | null
  /** Bearer token, present only when the appliance has `REMOTE_API_TOKEN` set. */
  token: string | null
  /** The requested layout preset. */
  layout: EmbedLayout
  /** Directional input surface implied by the layout. */
  surface: EmbedSurface
  /** Key groups to render, in order. Never empty. */
  keys: EmbedKeyGroup[]
  /** Requested colour scheme. */
  theme: EmbedTheme
  /** True when `bg=transparent` asked the frame not to paint its own backdrop. */
  transparent: boolean
  /** Whether to show the device-name / status strip above the controls. */
  header: boolean
}

/** Every key group `?keys=` accepts, and the order they are rendered in by default. */
const KEY_GROUPS: readonly EmbedKeyGroup[] = [
  'dpad',
  'back',
  'home',
  'power',
  'transport',
  'volume',
]

/** Controls each layout shows when the host page does not override them with `?keys=`. */
const LAYOUT_KEYS: Record<EmbedLayout, readonly EmbedKeyGroup[]> = {
  dpad: ['dpad'],
  touchpad: ['dpad', 'back', 'home'],
  compact: ['dpad', 'back', 'home', 'power', 'volume'],
  full: ['dpad', 'back', 'home', 'power', 'transport', 'volume'],
}

/** A bare D-pad is meant to be chrome-free; the page-sized layouts show their status. */
const LAYOUT_HEADER: Record<EmbedLayout, boolean> = {
  dpad: false,
  touchpad: true,
  compact: true,
  full: true,
}

const LAYOUTS: readonly string[] = ['dpad', 'touchpad', 'compact', 'full']
const THEMES: readonly string[] = ['auto', 'light', 'dark']
const FALSY: readonly string[] = ['0', 'false', 'no', 'off']

/**
 * Read a parameter, trimmed and lowercased, treating blank values as absent.
 *
 * @param params - The parsed query string.
 * @param key - Parameter name to read.
 * @returns The normalised value, or null when missing or blank.
 */
function flag(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key)?.trim().toLowerCase()
  return raw ? raw : null
}

/**
 * Read a parameter, trimmed but case-preserving, treating blank values as absent.
 *
 * @param params - The parsed query string.
 * @param key - Parameter name to read.
 * @returns The trimmed value, or null when missing or blank.
 */
function str(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key)?.trim()
  return raw ? raw : null
}

/**
 * Resolve the `?keys=` allowlist, falling back to the layout's own default set.
 *
 * Unknown names and duplicates are dropped. A list that survives that filtering empty is
 * treated as a typo rather than a request for a blank frame, so the layout default wins.
 *
 * @param raw - The raw `keys` parameter value, or null when it was not supplied.
 * @param layout - The resolved layout, used for the fallback set.
 * @returns A non-empty, de-duplicated list of key groups in the requested order.
 */
function resolveKeys(raw: string | null, layout: EmbedLayout): EmbedKeyGroup[] {
  const requested = (raw ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is EmbedKeyGroup => (KEY_GROUPS as readonly string[]).includes(name))

  const unique = [...new Set(requested)]
  return unique.length > 0 ? unique : [...LAYOUT_KEYS[layout]]
}

/**
 * Parse the embed's query string into a fully-defaulted configuration.
 *
 * Unknown values for the enumerated parameters fall back to their default rather than
 * failing, so a typo in a host page's iframe URL degrades to the standard remote.
 *
 * @param search - A query string, with or without its leading `?`.
 * @returns The validated configuration.
 */
export function parseEmbedConfig(search: string): EmbedConfig {
  const params = new URLSearchParams(search)

  const rawLayout = flag(params, 'layout') ?? ''
  const layout: EmbedLayout = LAYOUTS.includes(rawLayout) ? (rawLayout as EmbedLayout) : 'compact'

  const rawTheme = flag(params, 'theme') ?? ''
  const rawHeader = flag(params, 'header')

  return {
    deviceId: str(params, 'device'),
    token: str(params, 'token'),
    layout,
    surface: layout === 'touchpad' ? 'touchpad' : 'dpad',
    keys: resolveKeys(str(params, 'keys'), layout),
    theme: THEMES.includes(rawTheme) ? (rawTheme as EmbedTheme) : 'auto',
    transparent: flag(params, 'bg') === 'transparent',
    header: rawHeader === null ? LAYOUT_HEADER[layout] : !FALSY.includes(rawHeader),
  }
}

/**
 * Build the same-origin `/api/ws` URL for the live state stream.
 *
 * The token travels as a query parameter here — and only here — because the browser's
 * WebSocket constructor cannot attach an Authorization header. Ordinary REST calls from
 * inside the frame use the header instead, keeping the token out of server access logs.
 *
 * @param href - The embed page's own URL, used to inherit origin and scheme.
 * @param token - Bearer token, or null when the appliance runs unauthenticated.
 * @returns An absolute `ws://` or `wss://` URL.
 */
export function wsUrl(href: string, token: string | null): string {
  const url = new URL('/api/ws', href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

/**
 * Build the body for `POST /api/devices/{id}/power` given the last-known TV state.
 *
 * When `is_on` is known the request names the target state explicitly, which the contract
 * defines as idempotent — the appliance only emits `KEYCODE_POWER` if the TV disagrees.
 * When the TV has not reported yet, `{ on: null }` falls back to an unconditional toggle.
 *
 * @param isOn - The device's last reported `is_on`, or null if it has not reported.
 * @returns The request body to POST.
 */
export function powerRequest(isOn: boolean | null): SetPowerRequest {
  return { on: isOn === null ? null : !isOn }
}
