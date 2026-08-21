/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * REST client for the Android TV Remote appliance, written against the frozen contract in
 * docs/design/api-contract.md. Wraps every endpoint the tray panel uses (devices, keys,
 * text, power, volume, connect, catalogs, health), attaches the optional bearer token,
 * and unwraps the `{ error: { code, message } }` envelope into a typed {@link ApiError} so
 * callers can distinguish an unreachable TV from a bad token.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  AppDescriptor,
  Device,
  DeviceState,
  HealthResponse,
  KeyDescriptor,
  KeyDirection,
  SetVolumeRequest,
} from './api-types'

/** A non-2xx response from the appliance, carrying the contract's machine-readable code. */
export class ApiError extends Error {
  /** Contract error code, or `internal_error` when the body was not an error envelope. */
  readonly code: ApiErrorCode
  /** HTTP status that carried the error. */
  readonly status: number

  /**
   * @param code - contract error code.
   * @param message - human-readable message from the server.
   * @param status - HTTP status code.
   */
  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** Raised when the appliance could not be reached at all (DNS, refused, timed out). */
export class TransportError extends Error {
  /**
   * @param message - the underlying fetch failure, phrased for a user.
   */
  constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}

/** Milliseconds before a request is abandoned. The appliance is on the LAN; it is fast. */
const TIMEOUT_MS = 8000

/**
 * Typed client for one appliance. Cheap to construct — make a new one when the configured
 * URL or token changes rather than mutating an existing instance.
 */
export class RemoteApi {
  /** Normalised appliance origin, without a trailing slash. */
  readonly baseUrl: string
  /** Bearer token, or empty when the appliance is unauthenticated. */
  readonly token: string

  /**
   * @param baseUrl - appliance origin, e.g. `http://192.168.1.10:7433`.
   * @param token - optional bearer token; pass an empty string when auth is disabled.
   */
  constructor(baseUrl: string, token = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
  }

  /**
   * Builds the WebSocket URL for `/api/ws`, carrying the token as a query parameter because
   * browsers cannot set headers on a WebSocket handshake.
   *
   * @returns an absolute `ws://` or `wss://` URL.
   */
  websocketUrl(): string {
    const url = new URL('/api/ws', this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    if (this.token) url.searchParams.set('token', this.token)
    return url.toString()
  }

  /**
   * Issues one request against the appliance and decodes the result.
   *
   * @param method - HTTP method.
   * @param path - path below the origin, starting with a slash.
   * @param body - JSON body, or undefined for none.
   * @returns the decoded response body, or undefined for 204/202-with-no-body.
   * @throws {ApiError} when the appliance returns an error envelope.
   * @throws {TransportError} when the appliance could not be reached.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new TransportError(`Cannot reach ${this.baseUrl}: ${reason}`)
    }

    if (!res.ok) {
      let code: ApiErrorCode = 'internal_error'
      let message = `${res.status} ${res.statusText}`
      try {
        const parsed = (await res.json()) as ApiErrorBody
        if (parsed?.error?.code) {
          code = parsed.error.code
          message = parsed.error.message
        }
      } catch {
        // Not an error envelope — keep the status line as the message.
      }
      throw new ApiError(code, message, res.status)
    }

    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Health probe. Never authenticated, so it also works before a token is entered. */
  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/healthz')
  }

  /** Every registered device with its live state. */
  listDevices(): Promise<Device[]> {
    return this.request<Device[]>('GET', '/api/devices')
  }

  /** Current state of one device. */
  getState(deviceId: string): Promise<DeviceState> {
    return this.request<DeviceState>('GET', `/api/devices/${deviceId}/state`)
  }

  /** Asks the appliance to (re)connect to a device. */
  connect(deviceId: string): Promise<DeviceState> {
    return this.request<DeviceState>('POST', `/api/devices/${deviceId}/connect`)
  }

  /**
   * Sends a key press.
   *
   * @param deviceId - target device.
   * @param key - short form (`DPAD_UP`) or full keycode (`KEYCODE_DPAD_UP`).
   * @param direction - `SHORT` by default; `START_LONG`/`END_LONG` bracket a held key.
   * @param repeat - 1-10, used for fast scrolling.
   */
  sendKey(
    deviceId: string,
    key: string,
    direction: KeyDirection = 'SHORT',
    repeat = 1,
  ): Promise<void> {
    return this.request<void>('POST', `/api/devices/${deviceId}/keys`, {
      key,
      direction,
      repeat,
    })
  }

  /** Types text into the TV's focused field. */
  sendText(deviceId: string, text: string): Promise<void> {
    return this.request<void>('POST', `/api/devices/${deviceId}/text`, { text })
  }

  /** Launches an app by package id or deep link. */
  launchApp(deviceId: string, app: string): Promise<void> {
    return this.request<void>('POST', `/api/devices/${deviceId}/launch`, { app })
  }

  /**
   * Sets power state. Idempotent per the contract; `null` toggles unconditionally.
   *
   * @param deviceId - target device.
   * @param on - desired state, or null to toggle.
   */
  setPower(deviceId: string, on: boolean | null): Promise<DeviceState> {
    return this.request<DeviceState>('POST', `/api/devices/${deviceId}/power`, { on })
  }

  /** Steps, mutes, or sets an absolute volume level. */
  setVolume(deviceId: string, body: SetVolumeRequest): Promise<DeviceState> {
    return this.request<DeviceState>('POST', `/api/devices/${deviceId}/volume`, body)
  }

  /** The key catalog, for labelling the panel's buttons. */
  listKeys(): Promise<KeyDescriptor[]> {
    return this.request<KeyDescriptor[]>('GET', '/api/keys')
  }

  /** The app catalog. */
  listApps(): Promise<AppDescriptor[]> {
    return this.request<AppDescriptor[]>('GET', '/api/apps')
  }
}
