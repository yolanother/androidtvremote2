/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Shared presentational primitives for the Android TV Remote tray panel: the `cn` class
 * merger, the `RemoteButton` used for every control on the remote (with press feedback and
 * an auto-repeat mode for volume and scrolling), the connection `StatusDot`, and the
 * `Field` label wrapper used by the settings screen. Kept deliberately small — the panel is
 * one screen, so a full component library would be more code than the panel itself.
 */
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ConnectionStatus } from '@/lib/api-types'

/**
 * Merges conditional class names, letting later Tailwind utilities win over earlier ones.
 *
 * @param inputs - class values, as accepted by clsx.
 * @returns the merged class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Delay before a held button starts repeating. */
const REPEAT_DELAY_MS = 400
/** Interval between repeats while a button is held. */
const REPEAT_INTERVAL_MS = 120

interface RemoteButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual weight. `ghost` is the flat icon button used in the header and transport row;
   * `solid` and `danger` are conventional filled buttons used outside the remote surface
   * (settings actions). `key` and `key-accent` give a control the moulded, physically-pressed
   * face the D-pad and volume pill use — `key-accent` is the one lit key in a cluster (OK).
   */
  variant?: 'solid' | 'ghost' | 'danger' | 'key' | 'key-accent'
  /** When true, holding the button repeats `onPress` — used for volume and D-pad. */
  repeat?: boolean
  /** Fired on press, and repeatedly while held when `repeat` is set. */
  onPress: () => void
  children: ReactNode
}

/**
 * A single control on the remote.
 *
 * Fires on pointer-down rather than click so the TV reacts as fast as a real remote, and
 * optionally auto-repeats while held. Keyboard activation still goes through the normal
 * click path so the panel stays operable without a mouse.
 */
export function RemoteButton({
  variant = 'ghost',
  repeat = false,
  onPress,
  className,
  children,
  ...rest
}: RemoteButtonProps) {
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval> }>({})

  const stop = () => {
    if (timers.current.delay) clearTimeout(timers.current.delay)
    if (timers.current.tick) clearInterval(timers.current.tick)
    timers.current = {}
  }

  // A pointer released outside the button still has to stop the repeat.
  useEffect(() => stop, [])

  return (
    <button
      type="button"
      onPointerDown={(event) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return
        onPress()
        if (!repeat) return
        timers.current.delay = setTimeout(() => {
          timers.current.tick = setInterval(onPress, REPEAT_INTERVAL_MS)
        }, REPEAT_DELAY_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        // Let the panel's arrow-key handler own the arrows; don't move focus instead.
        if (event.key.startsWith('Arrow')) event.preventDefault()
      }}
      onClick={(event) => {
        // Pointer input already fired; only keyboard activation should reach here.
        if (event.detail !== 0) return
        onPress()
      }}
      className={cn(
        'flex items-center justify-center text-sm font-medium transition',
        // The moulded key faces animate their own press state with a translateY, which a
        // simultaneous Tailwind active:scale would fight with, so only non-key variants get it.
        variant === 'key' || variant === 'key-accent' ? 'key' : 'rounded-xl active:scale-95',
        'disabled:pointer-events-none disabled:opacity-35',
        variant === 'ghost' &&
          'bg-[var(--surface-raised)] text-foreground hover:brightness-110 border border-[var(--border)]',
        variant === 'solid' && 'bg-accent text-accent-foreground hover:brightness-110',
        variant === 'danger' && 'bg-[var(--surface-raised)] text-danger border border-[var(--border)] hover:brightness-110',
        variant === 'key' && 'border border-[var(--border)] text-foreground',
        variant === 'key-accent' && 'key-accent border-transparent text-accent-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Maps a contract connection status to the palette token that represents it. */
const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: 'var(--online)',
  connecting: 'var(--pairing)',
  disconnected: 'var(--offline)',
  unreachable: 'var(--danger)',
  unpaired: 'var(--pairing)',
  disabled: 'var(--offline)',
}

/**
 * The coloured dot that reports a device's connection state, matching the tray icon's
 * colour vocabulary.
 *
 * @param status - the device's `DeviceState.connection`.
 */
export function StatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span
      role="img"
      aria-label={status}
      title={status}
      className="size-2 shrink-0 rounded-full"
      style={{ background: STATUS_COLOR[status] }}
    />
  )
}

/**
 * A labelled form row for the settings screen.
 *
 * @param label - the field's visible label.
 * @param hint - optional helper text shown under the control.
 * @param children - the control itself.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-[var(--muted)]">{hint}</span> : null}
    </label>
  )
}

/** Shared class list for the settings screen's text inputs. */
export const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-[var(--online)]'
