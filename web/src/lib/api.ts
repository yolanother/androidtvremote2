/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Typed REST client for the Android TV Remote appliance. Wraps every `/api` endpoint from
 * docs/design/api-contract.md in a promise-returning function, attaches the optional
 * bearer token (read from `?token=` or localStorage), and converts the contract's error
 * envelope into a thrown `ApiError` carrying the machine-readable `code` alongside a
 * human-readable message suitable for display.
 */
import type {
  AppDescriptor,
  ApiErrorBody,
  ApiErrorCode,
  Device,
  DeviceState,
  DiscoveredDevice,
  KeyDescriptor,
  KeyDirection,
  StartPairingResponse,
  VolumeAction,
} from './api-types'

const TOKEN_STORAGE_KEY = 'atvr.token'

/** Human-readable fallbacks for every contract error code, used when the server's
 *  message is missing or too terse to show a user. */
const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  device_not_found: 'That TV is no longer registered.',
  device_exists: 'That TV is already registered.',
  not_paired: 'This TV is not paired yet. Pair it before sending commands.',
  pairing_not_started: 'Pairing has not been started. Begin pairing again.',
  invalid_pairing_code: 'That code was not accepted. Check the TV and try again.',
  unreachable: 'The TV did not answer. Check that it is on and on the same network.',
  invalid_key: 'That key is not supported by this TV.',
  invalid_request: 'The appliance rejected that request as malformed.',
  no_media_session: 'Nothing is casting to this TV, so there is no playback to control.',
  unauthorized: 'This appliance requires an access token. Add it in Settings.',
  internal_error: 'The appliance hit an unexpected error.',
}

/** A non-2xx response from the appliance, carrying the contract's error envelope. */
export class ApiError extends Error {
  /** Machine-readable code from the contract's error table. */
  readonly code: ApiErrorCode
  /** HTTP status the request failed with, or 0 for a network-level failure. */
  readonly status: number
  /** Extra context the server attached, e.g. the conflicting device on `device_exists`. */
  readonly details?: Record<string, unknown>

  constructor(code: ApiErrorCode, message: string, status: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/**
 * Read the API token, preferring a `?token=` query parameter (which is also persisted so
 * a shared link only has to carry it once) over the stored value.
 *
 * @returns The token, or null when the appliance is running unauthenticated.
 */
export function getToken(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('token')
  if (fromQuery) {
    localStorage.setItem(TOKEN_STORAGE_KEY, fromQuery)
    return fromQuery
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

/**
 * Persist (or clear) the API token used by every subsequent request and socket connect.
 *
 * @param token - The bearer token, or null/empty to remove it.
 */
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
  else localStorage.removeItem(TOKEN_STORAGE_KEY)
}

/**
 * Build the absolute `/api/ws` URL for the current origin, carrying the token when set.
 *
 * @returns A `ws://` or `wss://` URL matching the page's protocol.
 */
export function socketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = getToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${proto}//${window.location.host}/api/ws${query}`
}

/** Turn an unknown thrown value into a displayable sentence. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

/**
 * Issue a request against the appliance and decode its JSON body.
 *
 * @param path - Path below the origin, e.g. `/api/devices`.
 * @param init - Optional method/body overrides; a JSON body is serialised automatically.
 * @returns The decoded response body, or undefined for a 204.
 * @throws {ApiError} When the response is non-2xx, or the appliance is unreachable.
 */
async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError('unreachable', 'Cannot reach the remote appliance.', 0)
  }

  if (!response.ok) {
    let code: ApiErrorCode = response.status === 401 ? 'unauthorized' : 'internal_error'
    let message = ''
    let details: Record<string, unknown> | undefined
    try {
      const body = (await response.json()) as ApiErrorBody
      if (body?.error?.code) {
        code = body.error.code
        message = body.error.message ?? ''
        details = body.error.details
      }
    } catch {
      // Non-JSON error body; the status-derived code above is the best we have.
    }
    throw new ApiError(code, message || ERROR_MESSAGES[code], response.status, details)
  }

  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Every REST call the SPA makes, named after the contract's endpoint table. */
export const api = {
  listDevices: () => request<Device[]>('/api/devices'),

  registerDevice: (host: string, name?: string) =>
    request<Device>('/api/devices', { method: 'POST', body: { host, ...(name ? { name } : {}) } }),

  updateDevice: (id: string, patch: { name?: string; host?: string; enabled?: boolean }) =>
    request<Device>(`/api/devices/${id}`, { method: 'PATCH', body: patch }),

  removeDevice: (id: string) => request<void>(`/api/devices/${id}`, { method: 'DELETE' }),

  startPairing: (id: string) =>
    request<StartPairingResponse>(`/api/devices/${id}/pair`, { method: 'POST' }),

  completePairing: (id: string, code: string) =>
    request<Device>(`/api/devices/${id}/pair/complete`, { method: 'POST', body: { code } }),

  unpair: (id: string) => request<Device>(`/api/devices/${id}/pair`, { method: 'DELETE' }),

  sendKey: (id: string, key: string, direction?: KeyDirection, repeat?: number) =>
    request<void>(`/api/devices/${id}/keys`, {
      method: 'POST',
      body: { key, ...(direction ? { direction } : {}), ...(repeat ? { repeat } : {}) },
    }),

  sendText: (id: string, text: string) =>
    request<void>(`/api/devices/${id}/text`, { method: 'POST', body: { text } }),

  launchApp: (id: string, app: string) =>
    request<void>(`/api/devices/${id}/launch`, { method: 'POST', body: { app } }),

  setPower: (id: string, on: boolean | null) =>
    request<DeviceState>(`/api/devices/${id}/power`, { method: 'POST', body: { on } }),

  setVolume: (id: string, body: { action?: VolumeAction; level?: number }) =>
    request<DeviceState>(`/api/devices/${id}/volume`, { method: 'POST', body }),

  connect: (id: string) => request<DeviceState>(`/api/devices/${id}/connect`, { method: 'POST' }),

  disconnect: (id: string) =>
    request<DeviceState>(`/api/devices/${id}/disconnect`, { method: 'POST' }),

  listDiscovered: () => request<DiscoveredDevice[]>('/api/discovery'),

  rescan: () => request<void>('/api/discovery/scan', { method: 'POST' }),

  listKeys: () => request<KeyDescriptor[]>('/api/keys'),

  listApps: () => request<AppDescriptor[]>('/api/apps'),
}
