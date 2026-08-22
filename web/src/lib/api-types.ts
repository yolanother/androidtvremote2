/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Hand-written TypeScript mirror of the Android TV Remote appliance's HTTP and WebSocket
 * contract (docs/design/api-contract.md). Declares the Device, DeviceState,
 * DiscoveredDevice, KeyDescriptor and AppDescriptor models, every request/response body,
 * the tagged union of WebSocket server events, and the error envelope. This is the single
 * source of truth shared by the web SPA, the embeddable remote, and the Tauri tray app,
 * so all three compile without a running backend.
 */

/** Connection lifecycle reported by the server for a registered device. */
export type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'unreachable'
  | 'unpaired'
  | 'disabled'

/** Volume readout as reported by the TV. `level`/`max` are absent until the TV reports. */
export interface VolumeInfo {
  level: number | null
  max: number | null
  muted: boolean
}

/** Cast player state for an active media session. */
export type PlayerState = 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'IDLE' | 'UNKNOWN'

/** Transport actions accepted by `POST /api/devices/{id}/media`. */
export type MediaAction = 'play' | 'pause' | 'play_pause' | 'stop' | 'seek' | 'next' | 'previous'

/**
 * Media metadata for whatever the television is currently playing.
 *
 * Comes from the Google Cast media session, and is `null` for native app playback — Cast
 * only publishes this namespace for content cast from a phone or browser. Render the
 * absent case as a first-class state, not an error.
 */
export interface NowPlaying {
  title: string | null
  subtitle: string | null
  album: string | null
  season: number | null
  episode: number | null
  content_type: string | null
  player_state: PlayerState
  duration: number | null
  position: number | null
  /** When `position` was sampled, so the UI can extrapolate instead of polling. */
  position_at: string | null
  /** Artwork URLs, largest first. May be empty even during playback. */
  images: string[]
  can_pause: boolean
  can_seek: boolean
}

/**
 * Receiver-level Cast state, independent of any media session. Populated far more often
 * than {@link NowPlaying}: it resolves the foreground app to a readable name and gives
 * float-precision volume, neither of which the remote protocol provides.
 */
export interface CastInfo {
  app_id: string | null
  display_name: string | null
  status_text: string | null
  volume_level: number | null
  muted: boolean | null
  available: boolean
}

/** Live, non-persisted view of a device: connection health and last-known TV state. */
export interface DeviceState {
  connection: ConnectionStatus
  is_on: boolean | null
  current_app: string | null
  volume: VolumeInfo | null
  last_seen: string | null
  error: string | null
  cast: CastInfo | null
  now_playing: NowPlaying | null
}

/** A registered TV. `id` is the MAC lowercased with colons stripped and never changes. */
export interface Device {
  id: string
  name: string
  host: string
  mac: string
  mdns_name: string | null
  model: string | null
  paired: boolean
  enabled: boolean
  created_at: string
  state: DeviceState
}

/** A TV seen by the mDNS browser, which may or may not already be registered. */
export interface DiscoveredDevice {
  mdns_name: string
  display_name: string
  addresses: string[]
  host: string
  registered: boolean
  device_id: string | null
  last_seen: string
}

/** Grouping used to lay out the key catalog in the UI. */
export type KeyCategory =
  | 'navigation'
  | 'transport'
  | 'volume'
  | 'power'
  | 'channel'
  | 'input'
  | 'numeric'
  | 'system'

/** One sendable key, in both its short form and its full Android keycode. */
export interface KeyDescriptor {
  key: string
  keycode: string
  label: string
  category: KeyCategory
}

/** A launchable app: `launch` is passed verbatim to the TV (package id or deep link). */
export interface AppDescriptor {
  id: string
  name: string
  package: string | null
  deep_link: string | null
  launch: string
  icon: string | null
  /** Appliance-served icon endpoint, e.g. `/api/icons/com.netflix.ninja`. */
  icon_url: string | null
}

/** Long-press support: a held key is bracketed by START_LONG and END_LONG. */
export type KeyDirection = 'SHORT' | 'START_LONG' | 'END_LONG'

/** Body for `POST /api/devices`. */
export interface RegisterDeviceRequest {
  host: string
  name?: string
}

/** Body for `PATCH /api/devices/{id}`. */
export interface UpdateDeviceRequest {
  name?: string
  host?: string
  enabled?: boolean
}

/** Body for `POST /api/devices/{id}/pair/complete`. */
export interface CompletePairingRequest {
  code: string
}

/** Body for `POST /api/devices/{id}/keys`. */
export interface SendKeyRequest {
  key: string
  direction?: KeyDirection
  repeat?: number
}

/** Body for `POST /api/devices/{id}/text`. */
export interface SendTextRequest {
  text: string
}

/** Body for `POST /api/devices/{id}/launch`. */
export interface LaunchAppRequest {
  app: string
}

/** Body for `POST /api/devices/{id}/media`. `position` is required only for `seek`. */
export interface MediaControlRequest {
  action: MediaAction
  position?: number
}

/** Body for `POST /api/devices/{id}/power`. `on: null` toggles unconditionally. */
export interface SetPowerRequest {
  on: boolean | null
}

/** Volume mutations; `level` sets an absolute level, `action` steps or mutes. */
export type VolumeAction = 'up' | 'down' | 'mute' | 'unmute' | 'toggle_mute'

/** Body for `POST /api/devices/{id}/volume`. Supply exactly one of `action` or `level`. */
export interface SetVolumeRequest {
  action?: VolumeAction
  level?: number
}

/** Response from `POST /api/devices/{id}/pair`. */
export interface StartPairingResponse {
  status: 'code_required'
}

/** Response from the always-unauthenticated `GET /healthz`. */
export interface HealthResponse {
  status: 'ok'
  devices: number
  connected: number
  version: string
}

/** Machine-readable failure codes shared by REST and MCP. */
export type ApiErrorCode =
  | 'device_not_found'
  | 'device_exists'
  | 'not_paired'
  | 'pairing_not_started'
  | 'invalid_pairing_code'
  | 'unreachable'
  | 'invalid_key'
  | 'invalid_request'
  | 'no_media_session'
  | 'not_found'
  | 'unauthorized'
  | 'internal_error'

/** Envelope returned with every non-2xx response. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

/** Progress of an in-flight pairing handshake, pushed over the WebSocket. */
export type PairingStatus = 'code_required' | 'paired' | 'failed' | 'timeout'

/** Full state dump sent immediately on WebSocket connect, before any deltas. */
export interface SnapshotEvent {
  type: 'snapshot'
  devices: Device[]
  discovered: DiscoveredDevice[]
}

export interface DeviceAddedEvent {
  type: 'device.added'
  device: Device
}

export interface DeviceUpdatedEvent {
  type: 'device.updated'
  device: Device
}

export interface DeviceRemovedEvent {
  type: 'device.removed'
  device_id: string
}

export interface DeviceStateEvent {
  type: 'device.state'
  device_id: string
  state: DeviceState
}

export interface DiscoveryEvent {
  type: 'discovery'
  devices: DiscoveredDevice[]
}

export interface PairingEvent {
  type: 'pairing'
  device_id: string
  status: PairingStatus
  error: string | null
}

export interface PongEvent {
  type: 'pong'
}

/** Every frame the server can push over `/api/ws`, discriminated by `type`. */
export type ServerEvent =
  | SnapshotEvent
  | DeviceAddedEvent
  | DeviceUpdatedEvent
  | DeviceRemovedEvent
  | DeviceStateEvent
  | DiscoveryEvent
  | PairingEvent
  | PongEvent

/** Every frame a client may send over `/api/ws`. Control happens over REST, not here. */
export type ClientEvent = { type: 'ping' }
