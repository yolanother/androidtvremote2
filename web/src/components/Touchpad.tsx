/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The swipe touchpad control surface for the Android TV Remote web UI. Maps pointer
 * gestures onto directional keys the way the Google TV app does: a key is emitted for each
 * fixed increment of travel *during* the drag rather than once on release, the dominant
 * axis is locked on the first emission so a diagonal drift cannot flip direction mid
 * scroll, and a short stationary press sends OK. Works with touch, mouse, and pen through
 * pointer events, and flashes the direction it emitted so the gesture is visibly landing.
 * Supports a height-bounded workspace class so the pad fits without a scrolling ancestor.
 */
import { useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle } from 'lucide-react'

import { cn } from '@/lib/utils'
import { DIRECTION_KEYS, KEYS, type Direction } from '@/lib/keys'
import type { RemoteControl } from '@/hooks/useRemoteControl'

/** Travel, in CSS pixels, that emits one directional key. */
const STEP_PX = 56

/** Maximum travel that still counts as a tap rather than a swipe. */
const TAP_SLOP_PX = 10

/** Maximum duration, in milliseconds, that still counts as a tap. */
const TAP_MS = 300

/** Glyph shown for each emitted direction, plus the tap. */
const FLASH_ICONS = {
  up: ChevronUp,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  ok: Circle,
} as const

type Flash = keyof typeof FLASH_ICONS

/**
 * The touchpad surface.
 *
 * @param props.control - The bound remote control for the active device.
 * @param props.className - Optional sizing for the available remote control stage.
 */
export function Touchpad({ control, className }: { control: RemoteControl; className?: string }) {
  const { send, disabled } = control
  const [active, setActive] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)

  // Gesture bookkeeping. Refs rather than state: these change on every pointermove and
  // must not drive a re-render.
  const origin = useRef({ x: 0, y: 0, time: 0 })
  const axis = useRef<'x' | 'y' | null>(null)
  const emitted = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** Emit a key and pulse its glyph so the gesture visibly lands. */
  const emit = (direction: Direction | 'ok') => {
    send(direction === 'ok' ? KEYS.ok : DIRECTION_KEYS[direction])
    setFlash(direction)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 220)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = { x: event.clientX, y: event.clientY, time: Date.now() }
    axis.current = null
    emitted.current = false
    setActive(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return
    const dx = event.clientX - origin.current.x
    const dy = event.clientY - origin.current.y

    if (axis.current === null) {
      if (Math.abs(dx) < STEP_PX && Math.abs(dy) < STEP_PX) return
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }

    const travel = axis.current === 'x' ? dx : dy
    if (Math.abs(travel) < STEP_PX) return

    const direction: Direction =
      axis.current === 'x' ? (travel > 0 ? 'right' : 'left') : travel > 0 ? 'down' : 'up'
    emit(direction)
    emitted.current = true
    // Re-origin at the current point so a continued drag keeps emitting every STEP_PX.
    origin.current = { ...origin.current, x: event.clientX, y: event.clientY }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return
    setActive(false)
    if (emitted.current) return
    const dx = Math.abs(event.clientX - origin.current.x)
    const dy = Math.abs(event.clientY - origin.current.y)
    const held = Date.now() - origin.current.time
    if (dx < TAP_SLOP_PX && dy < TAP_SLOP_PX && held < TAP_MS) emit('ok')
  }

  const FlashIcon = flash ? FLASH_ICONS[flash] : null

  return (
    <div className={cn('flex w-full flex-col items-center gap-2', className)}>
      <div
        data-remote-surface
        role="group"
        aria-label="Touchpad. Swipe to navigate, tap to select. The arrow keys work here too."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setActive(false)}
        className={cn(
          'tv-touchpad-surface relative grid w-full max-w-sm place-items-center rounded-3xl border',
          'h-[min(52vh,22rem)] cursor-grab transition-colors duration-150',
          active ? 'bg-accent cursor-grabbing' : 'bg-secondary',
          disabled && 'pointer-events-none opacity-40',
        )}
      >
        {/* Deliberately empty: anything drawn in here invites tapping *at* a target
            instead of swiping across the whole pad. */}
        {FlashIcon && (
          <FlashIcon
            aria-hidden
            className={cn(
              'text-foreground/70 size-20 transition-opacity duration-200',
              flash === 'ok' && 'fill-current size-12',
            )}
            strokeWidth={1.5}
          />
        )}
      </div>
      <p className="text-muted-foreground shrink-0 text-center text-xs">
        Swipe to move &middot; tap to select
      </p>
    </div>
  )
}
