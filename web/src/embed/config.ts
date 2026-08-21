/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Query-string configuration surface for the embeddable Android TV remote. Parses the
 * `device`, `token`, `layout`, `theme` and `header` parameters that a host page supplies
 * through the `<iframe src>` into a validated EmbedConfig, and provides the two pure
 * helpers the remote needs alongside it: the same-origin WebSocket URL (which carries the
 * token as a query parameter because the WebSocket constructor cannot set headers) and
 * the idempotent power-request body. All values fall back to a safe default rather than
 * throwing, so a malformed embed URL still renders a usable remote.
 */
import type { SetPowerRequest } from '@/lib/api-types'

/** Which set of controls the embed renders. */
export type EmbedLayout = 'compact' | 'full'

/** Colour scheme, where `auto` follows the host device's `prefers-color-scheme`. */
export type EmbedTheme = 'auto' | 'light' | 'dark'

/** Validated configuration derived from the embed URL's query string. */
export interface EmbedConfig {
  /** Registered device id (MAC, lowercased, colons stripped), or null when absent. */
  deviceId: string | null
  /** Bearer token, present only when the appliance has `REMOTE_API_TOKEN` set. */
  token: string | null
  /** Control set to render. */
  layout: EmbedLayout
  /** Requested colour scheme. */
  theme: EmbedTheme
  /** Whether to show the device-name / status strip above the controls. */
  header: boolean
}

const LAYOUTS: readonly string[] = ['compact', 'full']
const THEMES: readonly string[] = ['auto', 'light', 'dark']
const FALSY: readonly string[] = ['0', 'false', 'no', 'off']

/**
 * Read a parameter, trimmed, treating blank values as absent.
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

  const layout = str(params, 'layout')?.toLowerCase() ?? ''
  const theme = str(params, 'theme')?.toLowerCase() ?? ''
  const header = str(params, 'header')?.toLowerCase() ?? ''

  return {
    deviceId: str(params, 'device'),
    token: str(params, 'token'),
    layout: LAYOUTS.includes(layout) ? (layout as EmbedLayout) : 'compact',
    theme: THEMES.includes(theme) ? (theme as EmbedTheme) : 'auto',
    header: !FALSY.includes(header),
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
