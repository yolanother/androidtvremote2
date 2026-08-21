/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Development-only stub of the Android TV Remote appliance, used to exercise the web UI
 * without a running backend. Provides a fake WebSocket that emits the contract's snapshot
 * and delta frames and a `fetch` interceptor that answers every `/api` route with
 * plausible data, including a working pairing handshake and volume/power echoes. It is
 * loaded lazily and only when `VITE_MOCK=1` in a dev build, so it is never part of the
 * production bundle or the default dev experience.
 */
import type {
  AppDescriptor,
  Device,
  DeviceState,
  DiscoveredDevice,
  KeyDescriptor,
  ServerEvent,
} from '@/lib/api-types'

/** Build a device state with sensible defaults for the fields the TV has not reported. */
function state(partial: Partial<DeviceState>): DeviceState {
  return {
    connection: 'connected',
    is_on: true,
    current_app: null,
    volume: { level: 14, max: 100, muted: false },
    last_seen: new Date().toISOString(),
    error: null,
    ...partial,
  }
}

/** The stub registry: one healthy TV, one unreachable, one whose pairing was revoked. */
const devices: Device[] = [
  {
    id: 'aabbccddeeff',
    name: 'Living Room TV',
    host: '192.168.1.23',
    mac: 'aa:bb:cc:dd:ee:ff',
    mdns_name: 'BRAVIA 4K GB._androidtvremote2._tcp.local.',
    model: 'BRAVIA 4K GB',
    paired: true,
    enabled: true,
    created_at: '2026-08-01T18:04:00Z',
    state: state({ current_app: 'com.netflix.ninja' }),
  },
  {
    id: '112233445566',
    name: 'Bedroom SHIELD',
    host: '192.168.1.140',
    mac: '11:22:33:44:55:66',
    mdns_name: 'SHIELD._androidtvremote2._tcp.local.',
    model: 'NVIDIA SHIELD Android TV',
    paired: true,
    enabled: true,
    created_at: '2026-08-02T09:12:00Z',
    state: state({
      connection: 'unreachable',
      is_on: false,
      volume: null,
      error: 'No route to host 192.168.1.140',
    }),
  },
  {
    id: 'ddeeff001122',
    name: 'Kitchen Chromecast',
    host: '192.168.1.61',
    mac: 'dd:ee:ff:00:11:22',
    mdns_name: 'Chromecast._androidtvremote2._tcp.local.',
    model: 'Chromecast with Google TV',
    paired: false,
    enabled: true,
    created_at: '2026-08-03T20:41:00Z',
    state: state({
      connection: 'unpaired',
      is_on: null,
      volume: null,
      error: 'The TV revoked this pairing.',
    }),
  },
]

const discovered: DiscoveredDevice[] = [
  {
    mdns_name: 'BRAVIA 4K GB._androidtvremote2._tcp.local.',
    display_name: 'BRAVIA 4K GB',
    addresses: ['192.168.1.23'],
    host: '192.168.1.23',
    registered: true,
    device_id: 'aabbccddeeff',
    last_seen: new Date().toISOString(),
  },
  {
    mdns_name: 'Office TV._androidtvremote2._tcp.local.',
    display_name: 'Office TV',
    addresses: ['192.168.1.88'],
    host: '192.168.1.88',
    registered: false,
    device_id: null,
    last_seen: new Date().toISOString(),
  },
]

const keys: KeyDescriptor[] = [
  { key: 'DPAD_UP', keycode: 'KEYCODE_DPAD_UP', label: 'Up', category: 'navigation' },
  { key: 'DPAD_DOWN', keycode: 'KEYCODE_DPAD_DOWN', label: 'Down', category: 'navigation' },
  { key: 'DPAD_LEFT', keycode: 'KEYCODE_DPAD_LEFT', label: 'Left', category: 'navigation' },
  { key: 'DPAD_RIGHT', keycode: 'KEYCODE_DPAD_RIGHT', label: 'Right', category: 'navigation' },
  { key: 'DPAD_CENTER', keycode: 'KEYCODE_DPAD_CENTER', label: 'OK', category: 'navigation' },
  { key: 'BACK', keycode: 'KEYCODE_BACK', label: 'Back', category: 'navigation' },
  { key: 'HOME', keycode: 'KEYCODE_HOME', label: 'Home', category: 'navigation' },
  { key: 'POWER', keycode: 'KEYCODE_POWER', label: 'Power', category: 'power' },
]

const apps: AppDescriptor[] = [
  { id: 'netflix', name: 'Netflix', package: 'com.netflix.ninja', deep_link: null, launch: 'com.netflix.ninja', icon: null },
  { id: 'youtube', name: 'YouTube', package: 'com.google.android.youtube.tv', deep_link: null, launch: 'com.google.android.youtube.tv', icon: null },
  { id: 'primevideo', name: 'Prime Video', package: 'com.amazon.amazonvideo.livingroom', deep_link: null, launch: 'com.amazon.amazonvideo.livingroom', icon: null },
  { id: 'disneyplus', name: 'Disney+', package: 'com.disney.disneyplus', deep_link: null, launch: 'com.disney.disneyplus', icon: null },
  { id: 'plex', name: 'Plex', package: 'com.plexapp.android', deep_link: null, launch: 'com.plexapp.android', icon: null },
  { id: 'spotify', name: 'Spotify', package: 'com.spotify.tv.android', deep_link: null, launch: 'com.spotify.tv.android', icon: null },
  { id: 'jellyfin', name: 'Jellyfin', package: 'org.jellyfin.androidtv', deep_link: null, launch: 'org.jellyfin.androidtv', icon: null },
  { id: 'twitch', name: 'Twitch', package: 'tv.twitch.android.app', deep_link: null, launch: 'tv.twitch.android.app', icon: null },
]

/** Sockets currently listening, so REST mutations can echo a delta frame back. */
const sockets = new Set<MockSocket>()

/** Push a frame to every open mock socket. */
function broadcast(event: ServerEvent): void {
  for (const socket of sockets) socket.emit(event)
}

/** Find a device by the id embedded in a request path. */
function deviceFor(path: string): Device | undefined {
  const id = /\/api\/devices\/([^/]+)/.exec(path)?.[1]
  return devices.find((d) => d.id === id)
}

/** A minimal stand-in for the browser WebSocket, covering only what the provider uses. */
class MockSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0

  constructor() {
    sockets.add(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
      this.emit({ type: 'snapshot', devices, discovered })
    }, 120)
  }

  /** Deliver one server frame to this socket's consumer. */
  emit(event: ServerEvent): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }))
  }

  send(raw: string): void {
    if ((JSON.parse(raw) as { type: string }).type === 'ping') this.emit({ type: 'pong' })
  }

  close(): void {
    this.readyState = 3
    sockets.delete(this)
    this.onclose?.()
  }
}

/** JSON response helper. */
function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Route one intercepted request. Returns null for anything not part of the API. */
async function route(path: string, init: RequestInit | undefined): Promise<Response | null> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const body: Record<string, unknown> =
    typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
  const device = deviceFor(path)

  if (path === '/api/keys') return json(keys)
  if (path === '/api/apps') return json(apps)
  if (path === '/api/devices' && method === 'GET') return json(devices)
  if (path === '/api/discovery' && method === 'GET') return json(discovered)
  if (path === '/api/discovery/scan') {
    setTimeout(() => broadcast({ type: 'discovery', devices: discovered }), 800)
    return json(null, 202)
  }

  if (!device) {
    if (path.startsWith('/api/devices/')) {
      return json({ error: { code: 'device_not_found', message: 'No such device.' } }, 404)
    }
    return null
  }

  /** Publish the device's current state as a delta frame. */
  const echo = () => broadcast({ type: 'device.state', device_id: device.id, state: device.state })

  if (path.endsWith('/pair') && method === 'POST') {
    setTimeout(
      () => broadcast({ type: 'pairing', device_id: device.id, status: 'code_required', error: null }),
      500,
    )
    return json({ status: 'code_required' })
  }

  if (path.endsWith('/pair/complete')) {
    if (body.code !== '123456') {
      broadcast({ type: 'pairing', device_id: device.id, status: 'failed', error: 'Wrong code.' })
      return json(
        { error: { code: 'invalid_pairing_code', message: 'The TV rejected that code.' } },
        400,
      )
    }
    device.paired = true
    device.state = state({})
    broadcast({ type: 'pairing', device_id: device.id, status: 'paired', error: null })
    broadcast({ type: 'device.updated', device })
    return json(device)
  }

  if (path.endsWith('/power')) {
    device.state = { ...device.state, is_on: (body.on as boolean | null) ?? !device.state.is_on }
    echo()
    return json(device.state)
  }

  if (path.endsWith('/volume')) {
    const volume = device.state.volume ?? { level: 14, max: 100, muted: false }
    const action = body.action as string | undefined
    device.state = {
      ...device.state,
      volume: {
        ...volume,
        muted: action === 'toggle_mute' ? !volume.muted : action === 'mute',
        level:
          action === 'up'
            ? Math.min((volume.level ?? 0) + 1, volume.max ?? 100)
            : action === 'down'
              ? Math.max((volume.level ?? 0) - 1, 0)
              : ((body.level as number | undefined) ?? volume.level),
      },
    }
    echo()
    return json(device.state)
  }

  if (path.endsWith('/launch')) {
    device.state = { ...device.state, current_app: String(body.app) }
    echo()
    return json(null, 202)
  }

  if (path.endsWith('/keys') || path.endsWith('/text')) return json(null, 202)

  if (method === 'PATCH') {
    Object.assign(device, body)
    broadcast({ type: 'device.updated', device })
    return json(device)
  }

  if (method === 'DELETE' && path.endsWith('/pair')) {
    device.paired = false
    device.state = state({ connection: 'unpaired', is_on: null, volume: null })
    broadcast({ type: 'device.updated', device })
    return json(device)
  }

  if (method === 'DELETE') {
    devices.splice(devices.indexOf(device), 1)
    broadcast({ type: 'device.removed', device_id: device.id })
    return json(null, 204)
  }

  return json(device.state)
}

let installed = false

/** Replace `window.fetch` with the stub router. Idempotent. */
function installMockFetch(): void {
  if (installed) return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    if (path.startsWith('/api')) {
      // A little latency, so loading and optimistic paths are actually exercised.
      await new Promise((resolve) => setTimeout(resolve, 90))
      const response = await route(path, init)
      if (response) return response
    }
    return original(input, init)
  }
  console.info('[mock] Android TV Remote stub backend is active. Pairing code is 123456.')
}

/**
 * Create a stubbed appliance socket, installing the REST interceptor alongside it.
 *
 * @returns A WebSocket-shaped object the provider can drive.
 */
export function createMockSocket(): MockSocket {
  installMockFetch()
  return new MockSocket()
}
