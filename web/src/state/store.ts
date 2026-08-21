/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Central client-side state for the Android TV Remote web UI. Defines the store shape
 * (registered devices, discovered devices, live socket health, in-flight pairing sessions,
 * and the key/app catalogs), the reducer that folds the WebSocket `snapshot` frame and
 * every subsequent delta into it, the optimistic local patch used to make mute and power
 * feel instant, and the React context plus selector hooks that components read it through.
 * This is the single source of truth the whole SPA renders from; nothing polls.
 */
import { createContext, useContext } from 'react'
import type {
  AppDescriptor,
  Device,
  DeviceState,
  DiscoveredDevice,
  KeyDescriptor,
  PairingStatus,
  ServerEvent,
} from '@/lib/api-types'

/** Health of the browser's own connection to the appliance (not to any TV). */
export type SocketStatus = 'connecting' | 'open' | 'closed'

/** Progress of a pairing handshake as reported over the socket. */
export interface PairingSession {
  status: PairingStatus
  error: string | null
}

/** Everything the UI renders from. */
export interface RemoteState {
  devices: Device[]
  discovered: DiscoveredDevice[]
  keys: KeyDescriptor[]
  apps: AppDescriptor[]
  socket: SocketStatus
  /** True once the initial `snapshot` frame has been applied. */
  ready: boolean
  /** Live pairing handshakes, keyed by device id. */
  pairing: Record<string, PairingSession>
}

/** The empty store, before the socket has delivered anything. */
export const initialState: RemoteState = {
  devices: [],
  discovered: [],
  keys: [],
  apps: [],
  socket: 'connecting',
  ready: false,
  pairing: {},
}

/** Actions the provider dispatches; `event` carries anything the server pushed. */
export type StoreAction =
  | { type: 'event'; event: ServerEvent }
  | { type: 'socket'; status: SocketStatus }
  | { type: 'catalog'; keys?: KeyDescriptor[]; apps?: AppDescriptor[] }
  | { type: 'devices'; devices: Device[] }
  | { type: 'optimistic'; deviceId: string; patch: Partial<DeviceState> }
  | { type: 'pairing.clear'; deviceId: string }

/** Replace one device in the list, preserving order; append when it is new. */
function upsertDevice(devices: Device[], device: Device): Device[] {
  const index = devices.findIndex((d) => d.id === device.id)
  if (index === -1) return [...devices, device]
  const next = devices.slice()
  next[index] = device
  return next
}

/** Merge a partial state into one device without touching the others. */
function patchState(devices: Device[], deviceId: string, patch: Partial<DeviceState>): Device[] {
  return devices.map((d) => (d.id === deviceId ? { ...d, state: { ...d.state, ...patch } } : d))
}

/**
 * Fold an action into the store.
 *
 * @param state - The current store.
 * @param action - A socket frame, a socket-health change, a catalog load, or an
 *                 optimistic local patch.
 * @returns The next store; the same object when nothing changed.
 */
export function reducer(state: RemoteState, action: StoreAction): RemoteState {
  switch (action.type) {
    case 'socket':
      return { ...state, socket: action.status }

    case 'catalog':
      return {
        ...state,
        keys: action.keys ?? state.keys,
        apps: action.apps ?? state.apps,
      }

    case 'devices':
      return { ...state, devices: action.devices, ready: true }

    case 'optimistic':
      return { ...state, devices: patchState(state.devices, action.deviceId, action.patch) }

    case 'pairing.clear': {
      const pairing = { ...state.pairing }
      delete pairing[action.deviceId]
      return { ...state, pairing }
    }

    case 'event':
      return applyEvent(state, action.event)
  }
}

/** Apply one server frame. Split out so the socket frame handling reads on its own. */
function applyEvent(state: RemoteState, event: ServerEvent): RemoteState {
  switch (event.type) {
    case 'snapshot':
      return {
        ...state,
        devices: event.devices,
        discovered: event.discovered,
        ready: true,
      }

    case 'device.added':
    case 'device.updated':
      return { ...state, devices: upsertDevice(state.devices, event.device) }

    case 'device.removed':
      return { ...state, devices: state.devices.filter((d) => d.id !== event.device_id) }

    case 'device.state':
      return { ...state, devices: patchState(state.devices, event.device_id, event.state) }

    case 'discovery':
      return { ...state, discovered: event.devices }

    case 'pairing':
      return {
        ...state,
        pairing: {
          ...state.pairing,
          [event.device_id]: { status: event.status, error: event.error },
        },
      }

    case 'pong':
      return state
  }
}

/** Imperative operations the provider exposes alongside the state. */
export interface RemoteActions {
  /** Apply a local state patch immediately; the next `device.state` frame corrects it. */
  optimistic: (deviceId: string, patch: Partial<DeviceState>) => void
  /** Forget a finished pairing session so its dialog can be reopened cleanly. */
  clearPairing: (deviceId: string) => void
  /** Re-read devices over REST; used after a mutation when no frame is expected. */
  refresh: () => void
}

/** Store + actions, as handed to consumers. */
export interface RemoteContextValue extends RemoteActions {
  state: RemoteState
}

export const RemoteContext = createContext<RemoteContextValue | null>(null)

/**
 * Access the live remote store.
 *
 * @returns The current state and the imperative actions.
 * @throws {Error} When called outside a `RemoteProvider`.
 */
export function useRemote(): RemoteContextValue {
  const value = useContext(RemoteContext)
  if (!value) throw new Error('useRemote must be used inside a RemoteProvider')
  return value
}

/**
 * Look up one registered device by id.
 *
 * @param deviceId - The device's MAC-derived id, or undefined while a route is resolving.
 * @returns The device, or undefined when it is unknown or not yet loaded.
 */
export function useDevice(deviceId: string | undefined): Device | undefined {
  const { state } = useRemote()
  return deviceId ? state.devices.find((d) => d.id === deviceId) : undefined
}
