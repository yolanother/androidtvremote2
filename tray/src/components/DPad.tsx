/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The circular D-pad for the tray panel, matching the shape of the web remote's D-pad: four
 * directional wedges clipped to 90-degree sectors around a round OK key, rather than a grid
 * of square buttons. Each wedge fills its whole bounding square via `clip-path` reaching to
 * two corners; the wrapper's own `overflow-hidden rounded-full` then crops the assembly into
 * rounded quarter-pie sectors, which is why the clip paths below are plain corner-to-corner
 * triangles rather than arcs.
 */
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { RemoteButton, cn } from './ui'

/** A direction the D-pad can send. */
export type Direction = 'up' | 'right' | 'down' | 'left'

/** Geometry and content for each of the four wedges. */
const WEDGES: Array<{
  direction: Direction
  label: string
  clip: string
  place: string
  Icon: typeof ChevronUp
}> = [
  {
    direction: 'up',
    label: 'Up',
    clip: 'polygon(50% 50%, 0% 0%, 100% 0%)',
    place: 'items-start justify-center pt-[10%]',
    Icon: ChevronUp,
  },
  {
    direction: 'right',
    label: 'Right',
    clip: 'polygon(50% 50%, 100% 0%, 100% 100%)',
    place: 'items-center justify-end pr-[10%]',
    Icon: ChevronRight,
  },
  {
    direction: 'down',
    label: 'Down',
    clip: 'polygon(50% 50%, 100% 100%, 0% 100%)',
    place: 'items-end justify-center pb-[10%]',
    Icon: ChevronDown,
  },
  {
    direction: 'left',
    label: 'Left',
    clip: 'polygon(50% 50%, 0% 100%, 0% 0%)',
    place: 'items-center justify-start pl-[10%]',
    Icon: ChevronLeft,
  },
]

/**
 * The circular D-pad.
 *
 * @param disabled - Disables every wedge and the OK key.
 * @param onDirection - Fired on press, and repeatedly while a wedge is held.
 * @param onOk - Fired when the centre OK key is pressed.
 */
export function DPad({
  disabled,
  onDirection,
  onOk,
}: {
  disabled: boolean
  onDirection: (direction: Direction) => void
  onOk: () => void
}) {
  return (
    <div
      className={cn('relative mx-auto aspect-square w-52 shrink-0', disabled && 'pointer-events-none opacity-40')}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full">
        {WEDGES.map(({ direction, label, clip, place, Icon }) => (
          <RemoteButton
            key={direction}
            variant="key"
            aria-label={label}
            title={label}
            repeat
            disabled={disabled}
            onPress={() => onDirection(direction)}
            style={{ clipPath: clip }}
            className={cn('absolute inset-0 rounded-none', place)}
          >
            <Icon className="size-6" />
          </RemoteButton>
        ))}
      </div>

      {/* A hairline gap so the OK key reads as a separate part sitting in the ring. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 m-auto size-[40%] rounded-full bg-[var(--surface)]"
      />

      <RemoteButton
        variant="key-accent"
        aria-label="OK"
        title="OK"
        disabled={disabled}
        onPress={onOk}
        className="absolute inset-0 m-auto size-[36%] rounded-full text-sm font-semibold"
      >
        OK
      </RemoteButton>
    </div>
  )
}
