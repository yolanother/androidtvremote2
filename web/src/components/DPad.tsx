/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The circular D-pad control surface for the Android TV Remote web UI. Renders four
 * directional wedges and a centre OK key as real `<button>` elements — the wedges are
 * clipped to 90-degree sectors so every direction owns a hit region reaching the diagonals
 * — and wires each to press-and-hold repeat with haptic ticks. Because the clip path also
 * clips both an outline and an inset ring, a focused wedge is filled entirely instead,
 * keeping the surface unmistakably and fully keyboard-operable.
 */
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { DIRECTION_KEYS, KEYS, type Direction } from '@/lib/keys'
import type { RemoteControl } from '@/hooks/useRemoteControl'

/** Geometry and content for each of the four wedges. */
const WEDGES: Array<{
  direction: Direction
  label: string
  clip: string
  /** Where the glyph sits inside the wedge's bounding square. */
  place: string
  Icon: typeof ChevronUp
}> = [
  {
    direction: 'up',
    label: 'Up',
    clip: 'polygon(50% 50%, 0% 0%, 100% 0%)',
    place: 'items-start justify-center pt-[7%]',
    Icon: ChevronUp,
  },
  {
    direction: 'right',
    label: 'Right',
    clip: 'polygon(50% 50%, 100% 0%, 100% 100%)',
    place: 'items-center justify-end pr-[7%]',
    Icon: ChevronRight,
  },
  {
    direction: 'down',
    label: 'Down',
    clip: 'polygon(50% 50%, 100% 100%, 0% 100%)',
    place: 'items-end justify-center pb-[7%]',
    Icon: ChevronDown,
  },
  {
    direction: 'left',
    label: 'Left',
    clip: 'polygon(50% 50%, 0% 100%, 0% 0%)',
    place: 'items-center justify-start pl-[7%]',
    Icon: ChevronLeft,
  },
]

/**
 * The D-pad surface.
 *
 * @param props.control - The bound remote control for the active device.
 */
export function DPad({ control }: { control: RemoteControl }) {
  const { hold, disabled } = control

  return (
    <div
      data-remote-surface
      className={cn(
        'relative aspect-square w-[min(84vw,19rem)] shrink-0 rounded-full',
        'bg-card border shadow-lg',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {/* The wedges live inside a clipping circle so their straight outer edges read as
          one moulded ring rather than four triangles. */}
      <div className="absolute inset-0 overflow-hidden rounded-full">
        {WEDGES.map(({ direction, label, clip, place, Icon }) => (
          <button
            key={direction}
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            style={{ clipPath: clip }}
            {...hold(DIRECTION_KEYS[direction])}
            className={cn(
              'absolute inset-0 flex cursor-pointer transition-colors duration-150',
              'text-muted-foreground bg-[var(--key)]',
              'hover:bg-[var(--key-hover)] active:bg-[var(--key-active)]',
              // Neither an outline nor an inset ring survives `clip-path` — both are drawn
              // against the border box and then cut away. Focus therefore fills the whole
              // wedge instead, which is unmistakable and cannot be clipped off.
              'outline-none focus-visible:bg-ring focus-visible:text-background',
              place,
            )}
          >
            <Icon aria-hidden className="size-9" strokeWidth={2.25} />
          </button>
        ))}
      </div>

      {/* A hairline gap so the centre key reads as a separate part sitting in the ring. */}
      <div
        aria-hidden
        className="bg-background pointer-events-none absolute inset-0 m-auto size-[42%] rounded-full"
      />

      <button
        type="button"
        aria-label="OK"
        title="OK"
        disabled={disabled}
        {...hold(KEYS.ok)}
        className={cn(
          'key key-accent absolute inset-0 m-auto size-[38%] rounded-full',
          'text-sm font-semibold tracking-wide',
        )}
      >
        OK
      </button>
    </div>
  )
}
