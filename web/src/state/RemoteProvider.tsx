/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Owns the single `/api/ws` connection for the Android TV Remote web UI and publishes its
 * results through the remote store. Applies the initial `snapshot` frame and then every
 * delta, reconnects with exponential backoff and a heartbeat ping, loads the key and app
 * catalogs once per session, and exposes optimistic-patch and refresh actions. This is the
 * only place a socket is opened, and the UI never polls: all liveness comes from here.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'

import { api, socketUrl } from '@/lib/api'
import type { ServerEvent } from '@/lib/api-types'
import {
  RemoteContext,
  initialState,
  reducer,
  type RemoteContextValue,
  type StoreAction,
} from './store'

/** Backoff bounds for reconnect attempts, in milliseconds. */
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 15_000

/** Heartbeat cadence; the server answers `ping` with `pong`. */
const HEARTBEAT_MS = 25_000

/** True when the dev-only stubbed backend has been explicitly requested. */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1'

/**
 * Provide the live remote store to the tree beneath it.
 *
 * Opens the appliance WebSocket on mount, keeps it open for the lifetime of the app, and
 * tears it down on unmount. Children read the result with `useRemote()`.
 *
 * @param props.children - The application tree.
 */
export function RemoteProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Kept in refs so the connect loop below never re-subscribes on a state change.
  const socketRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const closedRef = useRef(false)

  useEffect(() => {
    closedRef.current = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined

    /** Load the static catalogs once; they do not change while the app is running. */
    const loadCatalogs = async () => {
      const [keys, apps] = await Promise.allSettled([api.listKeys(), api.listApps()])
      dispatch({
        type: 'catalog',
        keys: keys.status === 'fulfilled' ? keys.value : undefined,
        apps: apps.status === 'fulfilled' ? apps.value : undefined,
      })
    }

    const connect = async () => {
      if (closedRef.current) return
      dispatch({ type: 'socket', status: 'connecting' })

      const socket = USE_MOCK
        ? ((await import('@/dev/mockBackend')).createMockSocket() as unknown as WebSocket)
        : new WebSocket(socketUrl())
      socketRef.current = socket

      socket.onopen = () => {
        retriesRef.current = 0
        dispatch({ type: 'socket', status: 'open' })
        void loadCatalogs()
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }))
        }, HEARTBEAT_MS)
      }

      socket.onmessage = (message: MessageEvent) => {
        let event: ServerEvent
        try {
          event = JSON.parse(message.data as string) as ServerEvent
        } catch {
          return // A frame we cannot parse is a server bug; dropping it beats crashing.
        }
        dispatch({ type: 'event', event } as StoreAction)
      }

      socket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat)
        socketRef.current = null
        if (closedRef.current) return
        dispatch({ type: 'socket', status: 'closed' })
        const delay = Math.min(BACKOFF_MIN_MS * 2 ** retriesRef.current, BACKOFF_MAX_MS)
        retriesRef.current += 1
        reconnectTimer = setTimeout(() => void connect(), delay)
      }

      // `onerror` always precedes `onclose`, which owns the retry, so this only reports.
      socket.onerror = () => dispatch({ type: 'socket', status: 'closed' })
    }

    void connect()

    return () => {
      closedRef.current = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (heartbeat) clearInterval(heartbeat)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [])

  const optimistic = useCallback<RemoteContextValue['optimistic']>((deviceId, patch) => {
    dispatch({ type: 'optimistic', deviceId, patch })
  }, [])

  const clearPairing = useCallback<RemoteContextValue['clearPairing']>((deviceId) => {
    dispatch({ type: 'pairing.clear', deviceId })
  }, [])

  const refresh = useCallback<RemoteContextValue['refresh']>(() => {
    void api
      .listDevices()
      .then((devices) => dispatch({ type: 'devices', devices }))
      .catch(() => {
        // The socket is the source of truth; a failed manual refresh is not worth
        // surfacing, because the next frame will correct us anyway.
      })
  }, [])

  const value = useMemo<RemoteContextValue>(
    () => ({ state, optimistic, clearPairing, refresh }),
    [state, optimistic, clearPairing, refresh],
  )

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>
}
