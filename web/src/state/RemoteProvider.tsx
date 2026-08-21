/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Publishes the Android TV Remote store to the whole SPA. Holds the reducer state that
 * `useRemoteSocket` feeds from the appliance's `/api/ws` connection, and exposes the
 * imperative actions components need alongside it: the optimistic local patch that makes
 * mute and power feel instant, clearing a finished pairing session, and a manual REST
 * refresh for the rare mutation that produces no frame.
 */
import { useCallback, useMemo, useReducer, type ReactNode } from 'react'

import { api } from '@/lib/api'
import { RemoteContext, initialState, reducer, type RemoteContextValue } from './store'
import { useRemoteSocket } from './useRemoteSocket'

/**
 * Provide the live remote store to the tree beneath it.
 *
 * @param props.children - The application tree.
 */
export function RemoteProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useRemoteSocket(dispatch)

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
