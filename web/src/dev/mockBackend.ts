/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Development-only stub of the Android TV Remote appliance, used to exercise the web UI
 * without a running backend. Provides a fake WebSocket that emits the contract's snapshot
 * and delta frames and a `fetch` interceptor that answers every `/api` route with
 * plausible data, including a working pairing handshake, volume/power echoes, and a Cast
 * media session that responds to seek and transport. The registry deliberately covers all
 * four now-playing shapes — a television running a native app with no media session at
 * all (the common case), a seekable video session with artwork, an audio session with no
 * artwork that refuses to seek, and a live stream with no duration that refuses to pause — so the empty path is exercised rather than assumed. It
 * is
 * loaded lazily and only when `VITE_MOCK=1` in a dev build, so it is never part of the
 * production bundle or the default dev experience.
 */
import type {
  AppDescriptor,
  CastInfo,
  Device,
  DeviceState,
  DiscoveredDevice,
  KeyDescriptor,
  MediaAction,
  NowPlaying,
  PlayerState,
  ServerEvent,
} from '@/lib/api-types'
import { playheadAt } from '@/lib/media'

/** Inline an SVG as a data URI, so the stub needs no files and no network. */
function svg(markup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`
}

/** Stand-in for `/api/icons/{package}`, which the real appliance serves. */
function icon(glyph: string, fill: string): string {
  return svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="${fill}"/>` +
      `<text x="48" y="64" font-family="system-ui,sans-serif" font-size="48" font-weight="700" fill="#fff" text-anchor="middle">${glyph}</text></svg>`,
  )
}

/** Stand-in for a poster served from a content CDN. */
const ARTWORK = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#160c2e"/><stop offset="0.6" stop-color="#6d1030"/><stop offset="1" stop-color="#e0243c"/></linearGradient></defs>` +
    `<rect width="640" height="360" fill="url(#g)"/>` +
    `<text x="320" y="176" font-family="system-ui,sans-serif" font-size="44" font-weight="800" letter-spacing="6" fill="#fff" text-anchor="middle">STRANGER</text>` +
    `<text x="320" y="226" font-family="system-ui,sans-serif" font-size="44" font-weight="800" letter-spacing="6" fill="#fff" text-anchor="middle">THINGS</text></svg>`,
)

/** Build a Cast receiver readout with the fields the UI reads. */
function cast(partial: Partial<CastInfo>): CastInfo {
  return {
    app_id: 'CA5E8412',
    display_name: null,
    status_text: null,
    volume_level: 0.24,
    muted: false,
    available: true,
    ...partial,
  }
}

/** Build a media session, defaulted to a seekable video with artwork. */
function session(partial: Partial<NowPlaying>): NowPlaying {
  return {
    title: null,
    subtitle: null,
    album: null,
    season: null,
    episode: null,
    content_type: 'video/mp4',
    player_state: 'PLAYING',
    duration: 4680,
    position: 132.5,
    position_at: new Date().toISOString(),
    images: [ARTWORK],
    can_pause: true,
    can_seek: true,
    ...partial,
  }
}

/** Build a device state with sensible defaults for the fields the TV has not reported. */
function state(partial: Partial<DeviceState>): DeviceState {
  return {
    connection: 'connected',
    is_on: true,
    current_app: null,
    volume: { level: 14, max: 100, muted: false },
    last_seen: new Date().toISOString(),
    error: null,
    cast: null,
    now_playing: null,
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
    // The common case, verified against real hardware: the television is driving itself,
    // so the remote protocol reports the native-app sentinel and Cast names the app but
    // publishes no media session.
    state: state({
      current_app: 'AndroidNativeApp',
      cast: cast({ display_name: 'Netflix', volume_level: 0.24 }),
    }),
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

const extraDevices: Device[] = [
  {
    id: '778899aabbcc',
    name: 'Playroom Display',
    host: '192.168.1.77',
    mac: '77:88:99:aa:bb:cc',
    mdns_name: 'Playroom._androidtvremote2._tcp.local.',
    model: 'Chromecast with Google TV',
    paired: true,
    enabled: true,
    created_at: '2026-08-04T11:20:00Z',
    state: state({
      current_app: 'com.netflix.ninja',
      cast: cast({ display_name: 'Netflix', status_text: 'Casting from Pixel 9' }),
      now_playing: session({
        title: 'Stranger Things',
        subtitle: 'Chapter One: MADMAX',
        season: 4,
        episode: 1,
      }),
    }),
  },
  {
    id: '99aabbccddee',
    name: 'Studio Speaker',
    host: '192.168.1.91',
    mac: '99:aa:bb:cc:dd:ee',
    mdns_name: 'Studio._androidtvremote2._tcp.local.',
    model: 'Chromecast Audio',
    paired: true,
    enabled: true,
    created_at: '2026-08-05T08:02:00Z',
    // An audio session that publishes no artwork and refuses to seek — both happen, and
    // both have to look deliberate rather than broken.
    state: state({
      current_app: 'com.spotify.tv.android',
      cast: cast({ app_id: 'CC32E753', display_name: 'Spotify', status_text: 'Casting' }),
      now_playing: session({
        title: 'Everything In Its Right Place',
        subtitle: 'Radiohead',
        album: 'Kid A',
        content_type: 'audio/mpeg',
        duration: 251,
        position: 64,
        images: [],
        can_seek: false,
      }),
    }),
  },
  {
    id: 'bbccddeeff00',
    name: 'Patio Radio',
    host: '192.168.1.104',
    mac: 'bb:cc:dd:ee:ff:00',
    mdns_name: 'Patio._androidtvremote2._tcp.local.',
    model: 'Chromecast Audio',
    paired: true,
    enabled: true,
    created_at: '2026-08-06T17:45:00Z',
    // A live stream: no duration to draw a bar against, and a session that accepts
    // neither pause nor seek, so both controls have to say so rather than 409.
    state: state({
      current_app: 'com.spotify.tv.android',
      cast: cast({ app_id: 'CC32E753', display_name: 'Spotify', status_text: 'Live' }),
      now_playing: session({
        title: 'BBC Radio 6 Music',
        subtitle: 'Now: Radiohead — Everything In Its Right Place',
        content_type: 'audio/aac',
        duration: null,
        position: 0,
        images: [],
        can_pause: false,
        can_seek: false,
      }),
    }),
  },
]

devices.push(...extraDevices)

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
  { id: 'netflix', name: 'Netflix', package: 'com.netflix.ninja', deep_link: null, launch: 'com.netflix.ninja', icon: null, icon_url: icon('N', '#e50914') },
  { id: 'youtube', name: 'YouTube', package: 'com.google.android.youtube.tv', deep_link: null, launch: 'com.google.android.youtube.tv', icon: null, icon_url: icon('YT', '#ff0033') },
  { id: 'primevideo', name: 'Prime Video', package: 'com.amazon.amazonvideo.livingroom', deep_link: null, launch: 'com.amazon.amazonvideo.livingroom', icon: null, icon_url: '/api/icons/com.amazon.amazonvideo.livingroom' },
  { id: 'disneyplus', name: 'Disney+', package: 'com.disney.disneyplus', deep_link: null, launch: 'com.disney.disneyplus', icon: null, icon_url: icon('D+', '#0c1c4a') },
  { id: 'plex', name: 'Plex', package: 'com.plexapp.android', deep_link: null, launch: 'com.plexapp.android', icon: null, icon_url: '/api/icons/com.plexapp.android' },
  { id: 'spotify', name: 'Spotify', package: 'com.spotify.tv.android', deep_link: null, launch: 'com.spotify.tv.android', icon: null, icon_url: icon('S', '#1db954') },
  { id: 'jellyfin', name: 'Jellyfin', package: 'org.jellyfin.androidtv', deep_link: null, launch: 'org.jellyfin.androidtv', icon: null, icon_url: '/api/icons/org.jellyfin.androidtv' },
  { id: 'twitch', name: 'Twitch', package: 'tv.twitch.android.app', deep_link: null, launch: 'tv.twitch.android.app', icon: null, icon_url: '/api/icons/tv.twitch.android.app' },
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

  if (path.endsWith('/media')) {
    const playing = device.state.now_playing
    // The real appliance answers 409 here whenever nothing is casting, which is exactly
    // what the UI must avoid provoking by hiding its transport in that state.
    if (!playing) {
      return json(
        { error: { code: 'no_media_session', message: 'Nothing is casting to this TV.' } },
        409,
      )
    }
    const action = body.action as MediaAction
    const playerState: PlayerState =
      action === 'play'
        ? 'PLAYING'
        : action === 'pause'
          ? 'PAUSED'
          : action === 'stop'
            ? 'IDLE'
            : action === 'play_pause'
              ? playing.player_state === 'PLAYING'
                ? 'PAUSED'
                : 'PLAYING'
              : playing.player_state
    const position =
      action === 'seek'
        ? Number(body.position ?? 0)
        : action === 'next' || action === 'previous'
          ? 0
          : playheadAt(playing, Date.now())
    const step = action === 'next' ? 1 : action === 'previous' ? -1 : 0
    device.state = {
      ...device.state,
      now_playing: {
        ...playing,
        player_state: playerState,
        position,
        position_at: new Date().toISOString(),
        episode: playing.episode === null ? null : Math.max(1, playing.episode + step),
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
    if (path === '/healthz') {
      return json({
        status: 'ok',
        devices: devices.length,
        connected: devices.filter((d) => d.state.connection === 'connected').length,
        version: '0.0.0-mock',
      })
    }
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
