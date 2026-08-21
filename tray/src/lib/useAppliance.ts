/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * React state layer binding the tray panel to one appliance. Loads and saves the persisted
 * settings, builds the {@link RemoteApi} client, keeps the `/api/ws` live stream open and
 * folds its `ServerEvent` frames into the device list, tracks the selected device, exposes
 * a `run` helper that surfaces contract error codes as user-visible messages, and mirrors
 * overall health plus a compact device summary into the native tray icon and menu. This is
 * the only place the panel's device state is derived.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Device, ServerEvent } from './api-types'
import { ApiError, RemoteApi, TransportError } from './api'
import { LiveConnection, type LinkStatus } from './ws'
import {
  DEFAULT_SETTINGS,
  applyHotkey,
  loadSettings,
  saveSettings,
  type Settings,
} from './settings'

/** Overall health mirrored onto the tray icon. Mirrors the Rust `Health` enum. */
export type Health = 'ok' | 'degraded' | 'offline'

/** Payload the Rust side emits when a per-device tray menu item is clicked. */
interface TrayAction {
  action: string
  device_id: string
}

/** Everything the panel components need from the appliance. */
export interface Appliance {
  /** Current persisted settings. */
  settings: Settings
  /** True until the settings have been read from disk. */
  loading: boolean
  /** Registered devices, newest server state applied. */
  devices: Device[]
  /** The device the panel is currently driving, or null when there is none. */
  device: Device | null
  /** Live-stream status. */
  link: LinkStatus
  /** Why the link is down, when it is. */
  linkError: string | null
  /** Last command failure, shown as a transient banner. */
  actionError: string | null
  /** Derived health, matching what the tray icon shows. */
  health: Health
  /** The REST client, or null before settings load / when no URL is configured. */
  api: RemoteApi | null
  /** Selects a device and remembers it for next launch. */
  selectDevice: (deviceId: string) => void
  /** Writes new settings, rebuilding the client, hotkey, and live connection. */
  updateSettings: (next: Settings) => Promise<void>
  /** Drops and reopens the live stream immediately. */
  retry: () => void
  /** Runs a command, turning any failure into {@link Appliance.actionError}. */
  run: (fn: (api: RemoteApi, deviceId: string) => Promise<unknown>) => void
}

/**
 * Turns a thrown error into a short sentence a user can act on.
 *
 * @param err - whatever the API client threw.
 * @returns a message suitable for the panel's error banner.
 */
function describe(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'not_paired':
        return 'This TV is not paired yet — pair it in the web UI first.'
      case 'unreachable':
        return 'The TV did not answer.'
      case 'unauthorized':
        return 'The appliance rejected the token. Check Settings.'
      case 'device_not_found':
        return 'That device is no longer registered.'
      default:
        return err.message
    }
  }
  if (err instanceof TransportError) return err.message
  return err instanceof Error ? err.message : String(err)
}

/**
 * Derives overall health from the link state and the device list.
 *
 * @param link - live-stream status.
 * @param devices - registered devices.
 * @returns `offline` when the appliance is unreachable, `ok` when every enabled device is
 *   connected, and `degraded` in between.
 */
export function deriveHealth(link: LinkStatus, devices: Device[]): Health {
  if (link !== 'open') return 'offline'
  const enabled = devices.filter((d) => d.enabled)
  if (enabled.length === 0) return 'degraded'
  return enabled.every((d) => d.state.connection === 'connected') ? 'ok' : 'degraded'
}

/**
 * Applies one server frame to the device list.
 *
 * Exported so it can be exercised directly; it is a pure function of the previous list and
 * the frame, which is what keeps the live stream and the initial REST fetch consistent.
 *
 * @param devices - the previous list.
 * @param event - the frame to apply.
 * @returns the new list, or the same reference when the frame changes nothing.
 */
export function reduceDevices(devices: Device[], event: ServerEvent): Device[] {
  switch (event.type) {
    case 'snapshot':
      return event.devices
    case 'device.added':
      return devices.some((d) => d.id === event.device.id)
        ? devices.map((d) => (d.id === event.device.id ? event.device : d))
        : [...devices, event.device]
    case 'device.updated':
      return devices.map((d) => (d.id === event.device.id ? event.device : d))
    case 'device.removed':
      return devices.filter((d) => d.id !== event.device_id)
    case 'device.state':
      return devices.map((d) =>
        d.id === event.device_id ? { ...d, state: event.state } : d,
      )
    default:
      return devices
  }
}

/**
 * Connects the panel to the configured appliance.
 *
 * @returns the {@link Appliance} facade the panel components render from.
 */
export function useAppliance(): Appliance {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [link, setLink] = useState<LinkStatus>('connecting')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const live = useRef<LiveConnection | null>(null)

  const api = useMemo(
    () => (settings.baseUrl ? new RemoteApi(settings.baseUrl, settings.token) : null),
    [settings.baseUrl, settings.token],
  )

  // First run: read the persisted settings before anything tries to connect.
  useEffect(() => {
    let cancelled = false
    void loadSettings().then((stored) => {
      if (cancelled) return
      setSettings(stored)
      setDeviceId(stored.lastDeviceId)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // One live connection per appliance URL/token, torn down when either changes.
  useEffect(() => {
    if (loading || !api) return
    setDevices([])
    // The snapshot frame supplies the device list, but fetching once up front means the
    // panel is populated even if the server's snapshot is delayed.
    void api
      .listDevices()
      .then((list) => setDevices((current) => (current.length ? current : list)))
      .catch(() => undefined)

    const connection = new LiveConnection(api.websocketUrl(), {
      onEvent: (event) => setDevices((current) => reduceDevices(current, event)),
      onStatus: (status, reason) => {
        setLink(status)
        setLinkError(status === 'closed' ? (reason ?? 'disconnected') : null)
      },
    })
    live.current = connection
    return () => {
      connection.close()
      live.current = null
    }
  }, [api, loading])

  // Keep the selection pointing at a device that still exists.
  useEffect(() => {
    if (devices.length === 0) return
    if (!deviceId || !devices.some((d) => d.id === deviceId)) {
      setDeviceId(devices[0]!.id)
    }
  }, [devices, deviceId])

  const health = deriveHealth(link, devices)

  // Mirror health and the device list into the native tray icon and menu.
  useEffect(() => {
    if (!isTauri()) return
    void invoke('sync_tray', {
      next: {
        health,
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          connection: d.state.connection,
          is_on: d.state.is_on,
          muted: d.state.volume?.muted ?? null,
        })),
      },
    }).catch(() => undefined)
  }, [health, devices])

  const device = devices.find((d) => d.id === deviceId) ?? null

  const run = useCallback(
    (fn: (client: RemoteApi, id: string) => Promise<unknown>) => {
      if (!api || !deviceId) return
      setActionError(null)
      void fn(api, deviceId).catch((err: unknown) => setActionError(describe(err)))
    },
    [api, deviceId],
  )

  // Per-device quick actions fired from the tray menu land here.
  useEffect(() => {
    if (!isTauri() || !api) return
    const unlisten = listen<TrayAction>('tray-action', (event) => {
      const { action, device_id } = event.payload
      const target = devices.find((d) => d.id === device_id)
      const promise =
        action === 'power'
          ? api.setPower(device_id, target?.state.is_on === true ? false : true)
          : api.setVolume(device_id, { action: 'toggle_mute' })
      void promise.catch((err: unknown) => setActionError(describe(err)))
    })
    return () => {
      void unlisten.then((off) => off())
    }
  }, [api, devices])

  const selectDevice = useCallback((next: string) => {
    setDeviceId(next)
    setSettings((current) => {
      const updated = { ...current, lastDeviceId: next }
      void saveSettings(updated)
      return updated
    })
  }, [])

  const updateSettings = useCallback(async (next: Settings) => {
    const stored = await saveSettings(next)
    setSettings(stored)
  }, [])

  // Register the configurable global hotkey whenever it changes.
  useEffect(() => {
    if (loading) return
    void applyHotkey(settings.hotkey, () => {
      void invoke('toggle_panel').catch(() => undefined)
    })
  }, [settings.hotkey, loading])

  const retry = useCallback(() => {
    setActionError(null)
    live.current?.reconnectNow()
  }, [])

  return {
    settings,
    loading,
    devices,
    device,
    link,
    linkError,
    actionError,
    health,
    api,
    selectDevice,
    updateSettings,
    retry,
    run,
  }
}
