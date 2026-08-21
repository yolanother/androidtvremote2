/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Owns the Android TV Remote appliance's single `/api/ws` connection. Applies the initial
 * `snapshot` frame and then every delta by dispatching into the remote store, reconnects
 * with exponential backoff, keeps the connection alive with a heartbeat ping, and loads
 * the key and app catalogs once per session. This is the only place in the SPA that opens
 * a socket and the only source of liveness: nothing polls.
 */
import { useEffect, useRef } from 'react'

import { api, socketUrl } from '@/lib/api'
import type { ServerEvent } from '@/lib/api-types'
import type { StoreAction } from './store'

/** Backoff bounds for reconnect attempts, in milliseconds. */
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 15_000

/** Heartbeat cadence; the server answers `ping` with `pong`. */
const HEARTBEAT_MS = 25_000

/** True when the dev-only stubbed backend has been explicitly requested. */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1'

/**
 * Connect to the appliance for the lifetime of the calling component and feed everything
 * it pushes into the store.
 *
 * @param dispatch - The remote store's dispatch, used for socket health, catalog loads,
 *                   and every server frame.
 */
export function useRemoteSocket(dispatch: React.Dispatch<StoreAction>): void {
  // Kept in refs so the connect loop never re-subscribes because of a state change.
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
        dispatch({ type: 'event', event })
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
  }, [dispatch])
}
