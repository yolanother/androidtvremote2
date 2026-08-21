/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Swipe surface used by the embeddable remote's `layout=touchpad` preset. Translates
 * pointer drags into repeated D-pad key presses -- one press per threshold crossed, with
 * the origin re-anchored after each so a long swipe scrolls a row continuously -- and a
 * tap without movement into DPAD_CENTER. The threshold scales with the rendered size of
 * the surface, so it feels the same in a 240px-wide panel as in a larger frame. Arrow and
 * Enter keys drive the same callbacks, keeping the surface operable from a keyboard
 * inside the iframe.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/** Fraction of the surface's shorter side a drag must cover to emit one key press. */
const THRESHOLD_RATIO = 0.16

/** Floor for the swipe threshold in CSS pixels, so a tiny frame stays usable. */
const THRESHOLD_MIN_PX = 22

/** A tap held longer than this is treated as a drag that happened not to move. */
const TAP_MAX_MS = 500

/** Keyboard equivalents for the four directions. */
const ARROW_KEYS: Record<string, string> = {
  ArrowUp: 'DPAD_UP',
  ArrowDown: 'DPAD_DOWN',
  ArrowLeft: 'DPAD_LEFT',
  ArrowRight: 'DPAD_RIGHT',
}

/** Props for the touchpad surface. */
export interface TouchpadProps {
  /** Called with a D-pad key name (`DPAD_UP`, …) each time a swipe crosses the threshold. */
  onDirection: (key: string) => void
  /** Called when the surface is tapped without a meaningful drag. */
  onSelect: () => void
}

/** Mutable gesture state, kept in a ref so a drag does not re-render on every move. */
interface Gesture {
  x: number
  y: number
  threshold: number
  startedAt: number
  moved: boolean
}

/**
 * A directional swipe surface that emits D-pad keys.
 *
 * @param props - The direction and select callbacks.
 * @returns The touchpad element, filling whatever slot it is placed in.
 */
export function Touchpad({ onDirection, onSelect }: TouchpadProps) {
  const gesture = useRef<Gesture | null>(null)
  const [active, setActive] = useState(false)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      threshold: Math.max(THRESHOLD_MIN_PX, Math.min(rect.width, rect.height) * THRESHOLD_RATIO),
      startedAt: performance.now(),
      moved: false,
    }
    // Capture so a swipe that leaves the surface still reports its moves and its release.
    event.currentTarget.setPointerCapture(event.pointerId)
    setActive(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current) return

    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < current.threshold) return

    // The dominant axis wins, so a slightly diagonal swipe still reads as one direction.
    if (Math.abs(dx) > Math.abs(dy)) {
      onDirection(dx > 0 ? 'DPAD_RIGHT' : 'DPAD_LEFT')
    } else {
      onDirection(dy > 0 ? 'DPAD_DOWN' : 'DPAD_UP')
    }

    // Re-anchor rather than reset, so holding a long swipe keeps stepping.
    current.x = event.clientX
    current.y = event.clientY
    current.moved = true
  }

  const handlePointerUp = () => {
    const current = gesture.current
    gesture.current = null
    setActive(false)
    if (current && !current.moved && performance.now() - current.startedAt < TAP_MAX_MS) {
      onSelect()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = ARROW_KEYS[event.key]
    if (key) {
      event.preventDefault()
      onDirection(key)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      className="embed-touchpad"
      data-remote-surface=""
      data-active={active ? 'true' : undefined}
      // `application` asks assistive tech to forward arrow keys instead of consuming them
      // for its own navigation, which is what makes this surface keyboard-operable.
      role="application"
      tabIndex={0}
      aria-label="Touchpad: swipe or use the arrow keys to navigate, tap or press Enter to select"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <span className="embed-touchpad-hint" aria-hidden="true">
        swipe · tap
      </span>
    </div>
  )
}
