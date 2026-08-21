/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Turns user gestures into TV key presses for the Android TV Remote web UI. Provides
 * one-shot sending, press-and-hold pointer bindings that repeat a key at a fixed cadence
 * with haptic ticks, optimistic local updates for mute and power so those controls feel
 * instant, and a whole-document physical-keyboard binding that drives the same paths.
 * Every failure is captured as a displayable message rather than thrown at the component.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, api, errorMessage } from '@/lib/api'
import type { Device, VolumeAction } from '@/lib/api-types'
import {
  KEYS,
  REPEAT_DELAY_MS,
  REPEAT_INTERVAL_MS,
  haptic,
  isEditableTarget,
  keyForEvent,
} from '@/lib/keys'
import { useRemote } from '@/state/store'

/** Pointer handlers that make a button repeat while it is held. */
export interface HoldBindings {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onLostPointerCapture: () => void
}

/** Everything a control surface needs to drive one TV. */
export interface RemoteControl {
  /** Send a key press, optionally repeated server-side (the contract caps `repeat` at 10). */
  send: (key: string, repeat?: number) => void
  /** Pointer handlers for a button that should repeat while held. */
  hold: (key: string) => HoldBindings
  /** Send text to the field focused on the TV. */
  sendText: (text: string) => Promise<void>
  /** Launch an app by package id or deep link. */
  launch: (app: string) => Promise<void>
  /** Change volume, optimistically flipping mute locally first. */
  volume: (action: VolumeAction) => void
  /** Toggle power, optimistically flipping `is_on` locally first. */
  togglePower: () => void
  /** The most recent failure, for display; null when the last action succeeded. */
  error: string | null
  /** Dismiss the current error. */
  clearError: () => void
  /** True when the device cannot currently accept commands. */
  disabled: boolean
}

/**
 * Bind the control surfaces to one device.
 *
 * @param device - The device to drive, or undefined while a route is still resolving.
 * @returns Send, hold, and convenience actions, plus the last error and a disabled flag.
 */
export function useRemoteControl(device: Device | undefined): RemoteControl {
  const { optimistic } = useRemote()
  const [error, setError] = useState<string | null>(null)

  const deviceId = device?.id
  const disabled = !device || !device.paired || !device.enabled

  // Timers live in refs so a repeat survives the re-renders caused by incoming state
  // frames. The device id is read from the closure instead: these callbacks are cheap to
  // re-create, and a stale id would send keys to the wrong television.
  const delayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const repeatTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const send = useCallback(
    (key: string, repeat?: number) => {
      const id = deviceId
      if (!id) return
      haptic()
      void api.sendKey(id, key, undefined, repeat).catch((err: unknown) => {
        // `unreachable` is already visible in the header status; repeating it as an error
        // on every keypress of a dead TV is noise, not information.
        if (err instanceof ApiError && err.code === 'unreachable') return
        setError(errorMessage(err))
      })
    },
    [deviceId],
  )

  /** Stop any in-flight repeat. Safe to call when nothing is held. */
  const release = useCallback(() => {
    if (delayTimer.current) clearTimeout(delayTimer.current)
    if (repeatTimer.current) clearInterval(repeatTimer.current)
    delayTimer.current = undefined
    repeatTimer.current = undefined
  }, [])

  const startHold = useCallback(
    (key: string) => {
      release()
      send(key)
      delayTimer.current = setTimeout(() => {
        repeatTimer.current = setInterval(() => send(key), REPEAT_INTERVAL_MS)
      }, REPEAT_DELAY_MS)
    },
    [release, send],
  )

  const hold = useCallback(
    (key: string): HoldBindings => ({
      onPointerDown: (event) => {
        // Capture so a thumb that slides off the button still ends the repeat on release.
        event.currentTarget.setPointerCapture?.(event.pointerId)
        startHold(key)
      },
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
    }),
    [release, startHold],
  )

  const sendText = useCallback(
    async (text: string) => {
      const id = deviceId
      if (!id || !text) return
      try {
        await api.sendText(id, text)
        haptic(12)
      } catch (err) {
        setError(errorMessage(err))
        throw err
      }
    },
    [deviceId],
  )

  const launch = useCallback(async (app: string) => {
    const id = deviceId
    if (!id) return
    try {
      await api.launchApp(id, app)
      haptic(12)
    } catch (err) {
      setError(errorMessage(err))
      throw err
    }
  }, [deviceId])

  const volume = useCallback(
    (action: VolumeAction) => {
      const id = deviceId
      if (!id) return
      haptic()
      // Mute is the one volume action with local state worth predicting: the TV's echo
      // takes a moment and a mute button that lags feels broken.
      if (action === 'toggle_mute' && device?.state.volume) {
        optimistic(id, { volume: { ...device.state.volume, muted: !device.state.volume.muted } })
      }
      void api.setVolume(id, { action }).catch((err: unknown) => setError(errorMessage(err)))
    },
    [device, deviceId, optimistic],
  )

  const togglePower = useCallback(() => {
    const id = deviceId
    if (!id) return
    haptic(12)
    const next = device?.state.is_on === null ? null : !device?.state.is_on
    if (next !== null) optimistic(id, { is_on: next })
    void api.setPower(id, next).catch((err: unknown) => setError(errorMessage(err)))
  }, [device, deviceId, optimistic])

  // Release any held key if the component unmounts mid-press.
  useEffect(() => release, [release])

  return {
    send,
    hold,
    sendText,
    launch,
    volume,
    togglePower,
    error,
    clearError: useCallback(() => setError(null), []),
    disabled,
  }
}

/**
 * Bind the physical keyboard to the remote for the lifetime of the calling component.
 *
 * Repeats are driven by our own timer rather than the OS auto-repeat so the cadence
 * matches the on-screen buttons on every platform. Bindings are suppressed while focus is
 * inside a text field so the text surface still types normally.
 *
 * @param control - The control returned by `useRemoteControl`.
 * @param enabled - False to leave the keyboard alone, e.g. while a modal is open.
 */
export function useKeyboardControl(control: RemoteControl, enabled: boolean): void {
  const { send, disabled } = control

  useEffect(() => {
    if (!enabled || disabled) return

    let heldKey: string | null = null
    let delay: ReturnType<typeof setTimeout> | undefined
    let repeat: ReturnType<typeof setInterval> | undefined

    const stop = () => {
      heldKey = null
      if (delay) clearTimeout(delay)
      if (repeat) clearInterval(repeat)
      delay = undefined
      repeat = undefined
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const key = keyForEvent(event)
      if (!key) return
      event.preventDefault()
      // Ignore the OS auto-repeat; our own timer owns the cadence.
      if (event.repeat || heldKey === key) return
      stop()
      heldKey = key
      send(key)
      delay = setTimeout(() => {
        repeat = setInterval(() => send(key), REPEAT_INTERVAL_MS)
      }, REPEAT_DELAY_MS)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (keyForEvent(event) === heldKey) stop()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stop)
    return () => {
      stop()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', stop)
    }
  }, [enabled, disabled, send])
}

/** Re-exported so surfaces can name keys without importing the catalog separately. */
export { KEYS }
