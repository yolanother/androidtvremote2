/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Data layer for the embeddable Android TV remote. Exposes the `useRemote` hook, which
 * loads one registered device over `GET /api/devices/{id}`, keeps its DeviceState live by
 * subscribing to the `/api/ws` event stream (reconnecting with backoff when the appliance
 * restarts), and returns the command callbacks the remote's buttons fire: key presses,
 * volume actions and an idempotent power toggle. Command failures are decoded from the
 * contract's error envelope into a human-readable message rather than thrown, so a TV
 * that is off or unreachable degrades the frame to a status line instead of a blank page.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ApiErrorBody,
  Device,
  DeviceState,
  ServerEvent,
  SetVolumeRequest,
  VolumeAction,
} from '@/lib/api-types'

import { powerRequest, wsUrl, type EmbedConfig } from './config'

/** Everything the remote UI needs: current device, liveness, and the command callbacks. */
export interface Remote {
  /** The registered device, or null until it loads (or if it failed to load). */
  device: Device | null
  /** Last-known TV state, kept current by the WebSocket stream. */
  state: DeviceState | null
  /** True once the initial `GET /api/devices/{id}` has settled either way. */
  loaded: boolean
  /** True while the `/api/ws` stream is connected. */
  live: boolean
  /** Most recent load or command failure, already made human-readable. */
  error: string | null
  /** Send a single key from the catalog, e.g. `DPAD_UP`. */
  sendKey: (key: string) => void
  /** Step or mute the volume via the dedicated endpoint. */
  sendVolume: (action: VolumeAction) => void
  /** Toggle power, preferring the contract's idempotent explicit-target form. */
  togglePower: () => void
}

/** How long to wait before the first WebSocket reconnect attempt, in milliseconds. */
const RECONNECT_MIN_MS = 1_000

/** Ceiling for the WebSocket reconnect backoff, in milliseconds. */
const RECONNECT_MAX_MS = 15_000

/**
 * Turn a failed response into a readable message using the contract's error envelope.
 *
 * @param response - The non-2xx response.
 * @returns The server's message when the envelope is present, else a generic fallback.
 */
async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody
    if (body?.error?.message) return body.error.message
  } catch {
    // Body was not the JSON envelope (a proxy error page, say); fall through.
  }
  return `Request failed (${response.status})`
}

/**
 * Subscribe to one device and expose its live state plus the remote's command callbacks.
 *
 * @param config - Parsed embed configuration; `deviceId` and `token` are used here.
 * @returns The device, its live state, liveness/error flags, and command callbacks.
 */
export function useRemote(config: EmbedConfig): Remote {
  const { deviceId, token } = config

  const [device, setDevice] = useState<Device | null>(null)
  const [state, setState] = useState<DeviceState | null>(null)
  // With no device id there is nothing to load, so the embed is already settled.
  const [loaded, setLoaded] = useState(!deviceId)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Commands read the freshest is_on without re-creating the callbacks on every frame.
  const stateRef = useRef<DeviceState | null>(null)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  /**
   * Issue an authenticated request against the appliance.
   *
   * The bearer token goes in the Authorization header: `fetch` can set headers even
   * though the surrounding `<iframe src>` could not, which keeps the token out of the
   * appliance's access logs.
   */
  const request = useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      if (init?.body) headers.set('Content-Type', 'application/json')
      return fetch(path, { ...init, headers })
    },
    [token],
  )

  /** Fire a command and surface any failure without throwing into the render tree. */
  const command = useCallback(
    (path: string, body: unknown) => {
      if (!deviceId) return
      void (async () => {
        try {
          const response = await request(`/api/devices/${deviceId}${path}`, {
            method: 'POST',
            body: JSON.stringify(body),
          })
          if (!response.ok) {
            setError(await readError(response))
            return
          }
          setError(null)
          // The volume and power endpoints answer with the authoritative DeviceState;
          // apply it immediately rather than waiting for the WebSocket echo.
          if (response.status !== 202) {
            const next = (await response.json()) as DeviceState
            if (next?.connection) setState(next)
          }
        } catch {
          setError('Cannot reach the remote appliance')
        }
      })()
    },
    [deviceId, request],
  )

  // Initial load.
  useEffect(() => {
    if (!deviceId) return
    let cancelled = false
    void (async () => {
      try {
        const response = await request(`/api/devices/${deviceId}`)
        if (cancelled) return
        if (!response.ok) {
          setError(await readError(response))
        } else {
          const loadedDevice = (await response.json()) as Device
          setDevice(loadedDevice)
          setState(loadedDevice.state)
          setError(null)
        }
      } catch {
        if (!cancelled) setError('Cannot reach the remote appliance')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deviceId, request])

  // Live state stream, with backoff so a restarting appliance is picked back up.
  useEffect(() => {
    if (!deviceId) return

    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let delay = RECONNECT_MIN_MS
    let closed = false

    const connect = () => {
      if (closed) return
      socket = new WebSocket(wsUrl(window.location.href, token))

      socket.onopen = () => {
        delay = RECONNECT_MIN_MS
        setLive(true)
      }

      socket.onmessage = (event) => {
        let frame: ServerEvent
        try {
          frame = JSON.parse(event.data as string) as ServerEvent
        } catch {
          return
        }
        switch (frame.type) {
          case 'snapshot': {
            const mine = frame.devices.find((d) => d.id === deviceId)
            if (mine) {
              setDevice(mine)
              setState(mine.state)
            }
            break
          }
          case 'device.updated':
            if (frame.device.id === deviceId) {
              setDevice(frame.device)
              setState(frame.device.state)
            }
            break
          case 'device.state':
            if (frame.device_id === deviceId) setState(frame.state)
            break
          case 'device.removed':
            if (frame.device_id === deviceId) {
              setDevice(null)
              setError('This device was removed from the appliance')
            }
            break
          default:
            break
        }
      }

      socket.onclose = () => {
        setLive(false)
        if (closed) return
        retry = setTimeout(connect, delay)
        delay = Math.min(delay * 2, RECONNECT_MAX_MS)
      }
    }

    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [deviceId, token])

  const sendKey = useCallback((key: string) => command('/keys', { key }), [command])

  const sendVolume = useCallback(
    (action: VolumeAction) => command('/volume', { action } satisfies SetVolumeRequest),
    [command],
  )

  const togglePower = useCallback(
    () => command('/power', powerRequest(stateRef.current?.is_on ?? null)),
    [command],
  )

  // A missing device id is a static configuration mistake, not a runtime failure, so it
  // is derived rather than pushed into state from an effect.
  const shownError = deviceId ? error : 'No device: add ?device=<id> to the embed URL'

  return { device, state, loaded, live, error: shownError, sendKey, sendVolume, togglePower }
}
