/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Shared presentational primitives for the Android TV Remote web UI: the tactile `Key`
 * used by every remote control surface, a conventional `Btn` for dialogs and forms, a
 * labelled `Field` input, a `Modal` built on the native `<dialog>` element so focus
 * trapping and Escape-to-close come from the platform, and the `StatusDot` that renders a
 * device's connection state as colour, glyph, and text together rather than colour alone.
 * Dialogs enter and leave with the workspace's cancellable spring, preserving native
 * focus trapping through the exit and snapping when reduced motion is requested.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, Check, Loader2, Lock, PowerOff, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@/lib/api-types'
import { useOrganicMotion } from '@/lib/motion'

/** Visual weight of a remote key. */
type KeyTone = 'default' | 'accent'

/** Props accepted by `Key`; everything a native button takes, plus the tone and shape. */
export interface KeyProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Required, because every key on this remote is icon-only. */
  label: string
  tone?: KeyTone
  /** Render as a circle rather than a rounded rectangle. */
  round?: boolean
  children: ReactNode
}

/**
 * A remote key: a real `<button>` with a moulded face, a travelled press state, and a
 * mandatory accessible name.
 *
 * @param props.label - The `aria-label` and tooltip text.
 * @param props.tone - `accent` for the one lit key in a cluster (OK, active power).
 * @param props.round - Circular rather than rounded-rectangle.
 */
export function Key({ label, tone = 'default', round, className, children, ...rest }: KeyProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'key select-none',
        round ? 'rounded-full' : 'rounded-xl',
        tone === 'accent' && 'key-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Visual weight of a conventional button. */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  /** Show a spinner and block interaction while an action is in flight. */
  busy?: boolean
}

const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
  ghost: 'text-foreground hover:bg-accent',
  danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
}

/**
 * A conventional button for dialogs, forms, and settings — not for the remote surfaces,
 * which use `Key`.
 *
 * @param props.variant - Visual weight; defaults to `primary`.
 * @param props.busy - Disables the button and shows a spinner.
 */
export function Btn({ variant = 'primary', busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4',
        'text-sm font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BTN_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Forwarded to the underlying input (React 19 passes `ref` as an ordinary prop). */
  ref?: React.Ref<HTMLInputElement>
  /** Visible label text, associated with the input via `htmlFor`. */
  label: string
  /** Validation or explanatory text rendered beneath the input. */
  hint?: string
  /** Marks the field invalid and renders `hint` in the destructive colour. */
  invalid?: boolean
}

/**
 * A labelled text input. The label is always rendered (never a placeholder standing in for
 * one) so the field stays understandable once it has content.
 *
 * @param props.label - Visible label.
 * @param props.hint - Helper or error text.
 * @param props.invalid - Whether `hint` describes an error.
 */
export function Field({ label, hint, invalid, className, id, ...rest }: FieldProps) {
  const generated = useId()
  const inputId = id ?? generated
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        className={cn(
          'bg-card min-h-11 w-full rounded-xl border px-3 text-base',
          'placeholder:text-muted-foreground/60',
          'focus-visible:border-ring outline-none',
          invalid && 'border-destructive',
          className,
        )}
        {...rest}
      />
      {hint && (
        <p id={hintId} className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}>
          {hint}
        </p>
      )}
    </div>
  )
}

export interface ModalProps {
  open: boolean
  /** Called on Escape, backdrop click, and the close button. */
  onClose: () => void
  title: string
  /** Supporting sentence shown under the title. */
  description?: string
  children: ReactNode
  /** Action buttons, right-aligned at the foot of the dialog. */
  footer?: ReactNode
}

/**
 * A modal dialog built on the native `<dialog>` element, which supplies focus trapping,
 * Escape-to-close, inert background, and top-layer stacking without a z-index scale.
 *
 * On phones it presents as a bottom sheet; from `sm` up it centres.
 *
 * @param props.open - Whether the dialog is shown.
 * @param props.onClose - Invoked for every dismissal route.
 */
export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const { reduced, transition } = useOrganicMotion()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && reduced && dialog.open) dialog.close()
  }, [open, reduced])

  return (
    <motion.dialog
      ref={ref}
      initial={false}
      animate={{ opacity: open ? 1 : 0, y: open || reduced ? 0 : 16, scale: open || reduced ? 1 : 0.98 }}
      transition={transition}
      onAnimationComplete={() => { if (!open && ref.current?.open) ref.current.close() }}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // A click that lands on the dialog element itself is a backdrop click; one on a
        // child bubbles up with a different target.
        if (event.target === ref.current) onClose()
      }}
      className={cn(
        'bg-card text-card-foreground m-0 max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain border p-0 shadow-2xl backdrop:bg-black/60',
        'mt-auto rounded-t-2xl sm:m-auto sm:rounded-2xl',
      )}
    >
      <div className="flex items-start gap-3 border-b p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="hover:bg-accent -mr-1 cursor-pointer rounded-lg p-2 transition-colors"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="p-4">{children}</div>
      {footer && (
        <div className="flex flex-wrap justify-end gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </motion.dialog>
  )
}

/** Colour, glyph, and wording for each connection state. Never colour alone. */
const STATUS_META: Record<
  ConnectionStatus,
  { label: string; dot: string; text: string; Icon?: typeof AlertTriangle }
> = {
  connected: { label: 'Connected', dot: 'bg-online', text: 'text-online' },
  connecting: { label: 'Connecting', dot: 'bg-pairing animate-pulse', text: 'text-pairing' },
  disconnected: { label: 'Disconnected', dot: 'bg-offline', text: 'text-muted-foreground' },
  unreachable: {
    label: 'Unreachable',
    dot: 'bg-destructive',
    text: 'text-destructive',
    Icon: AlertTriangle,
  },
  unpaired: { label: 'Not paired', dot: 'bg-pairing', text: 'text-pairing', Icon: Lock },
  disabled: { label: 'Disabled', dot: 'bg-offline', text: 'text-muted-foreground', Icon: PowerOff },
}

/**
 * Render a device's connection state as a coloured dot plus its wording, with a glyph on
 * the states that need action. Width is reserved by the layout so a status change never
 * shifts what sits beside it.
 *
 * @param props.status - The device's current connection state.
 * @param props.compact - Hide the wording, keeping only the dot (used inside dense rows).
 */
export function StatusDot({ status, compact }: { status: ConnectionStatus; compact?: boolean }) {
  const meta = STATUS_META[status]
  const Icon = meta.Icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', meta.text)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', meta.dot)} />
      {!compact && <span>{meta.label}</span>}
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      {compact && <span className="sr-only">{meta.label}</span>}
    </span>
  )
}

/**
 * A polite live region for status announcements. Screen readers read changes to its
 * content without moving focus, which is what connection and pairing updates need.
 *
 * @param props.children - The message to announce; render null when there is nothing.
 */
export function LiveRegion({ children }: { children: ReactNode }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {children}
    </div>
  )
}

/**
 * An inline dismissible error strip, used where a failed action needs acknowledging
 * without interrupting the remote.
 *
 * @param props.message - The failure text; the strip renders nothing when null.
 * @param props.onDismiss - Called when the user closes the strip.
 */
export function ErrorStrip({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl px-3 py-2 text-xs"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="cursor-pointer opacity-70 hover:opacity-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}

/**
 * A success tick that fades itself out, used to confirm a fire-and-forget action such as
 * sending text, where the TV gives no echo the UI can observe.
 *
 * @param props.show - Whether the tick is currently visible.
 * @param props.children - The confirmation wording.
 */
export function SentTick({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'text-online inline-flex items-center gap-1 text-xs transition-opacity duration-200',
        show ? 'opacity-100' : 'opacity-0',
      )}
    >
      <Check aria-hidden className="size-3.5" />
      {children}
    </span>
  )
}
