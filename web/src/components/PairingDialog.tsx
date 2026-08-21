/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The pairing dialog for the Android TV Remote web UI. Drives the two-step handshake from
 * `POST /api/devices/{id}/pair` through to `pair/complete`, following the `pairing` frames
 * on the WebSocket rather than polling, and explains at every step what should be visible
 * on the television. Distinguishes a rejected code from a timed-out session from an
 * unreachable TV, and always offers a visible retry, so a failed pairing never dead-ends.
 * Mounted only while pairing is in progress, so each attempt starts from clean state.
 */
import { useEffect, useState } from 'react'
import { Loader2, Tv } from 'lucide-react'

import { Btn, ErrorStrip, Field, Modal } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import type { Device } from '@/lib/api-types'
import { useRemote } from '@/state/store'

/** Length of the code the television displays. */
const CODE_LENGTH = 6

/**
 * The pairing dialog. Render it only while pairing; mounting begins the handshake.
 *
 * @param props.device - The device being paired.
 * @param props.onClose - Called on every dismissal route, including a successful pairing.
 */
export function PairingDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const { state, clearPairing } = useRemote()
  const session = state.pairing[device.id]

  const [code, setCode] = useState('')
  const [starting, setStarting] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by "Try again" to re-run the start effect. */
  const [attempt, setAttempt] = useState(0)

  // Ask the appliance to begin the handshake as soon as the dialog appears — there is
  // nothing useful to show beforehand, so a "Start" button would only add a step.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await api.startPairing(device.id)
        if (!cancelled) setStarting(false)
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err))
          setStarting(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [device.id, attempt])

  // The socket reports success independently of the REST response, so close on either.
  useEffect(() => {
    if (session?.status === 'paired') onClose()
  }, [session?.status, onClose])

  /** Restart the handshake after a failure or timeout. */
  const retry = () => {
    clearPairing(device.id)
    setCode('')
    setError(null)
    setStarting(true)
    setAttempt((previous) => previous + 1)
  }

  const submit = async () => {
    if (code.length < CODE_LENGTH) return
    setSubmitting(true)
    setError(null)
    try {
      await api.completePairing(device.id, code)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  const failed = session?.status === 'failed' || session?.status === 'timeout'
  const awaitingCode = session?.status === 'code_required'
  const message = failed
    ? session.status === 'timeout'
      ? 'The pairing session timed out. Televisions give you about two minutes — start again and enter the code promptly.'
      : (session.error ?? 'The television rejected that code.')
    : error

  return (
    <Modal
      open
      onClose={onClose}
      title={`Pair with ${device.name}`}
      description={`${device.model ?? 'Android TV'} at ${device.host}`}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          {failed ? (
            <Btn onClick={retry} busy={starting}>
              Try again
            </Btn>
          ) : (
            <Btn onClick={() => void submit()} busy={submitting} disabled={code.length < CODE_LENGTH}>
              Pair
            </Btn>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="bg-secondary flex items-start gap-3 rounded-xl p-3">
          <Tv aria-hidden className="text-muted-foreground mt-0.5 size-5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Look at the television.</p>
            <ol className="text-muted-foreground mt-1 list-decimal space-y-0.5 pl-4 text-xs">
              <li>A pairing code appears on the TV screen.</li>
              <li>It is {CODE_LENGTH} characters long.</li>
              <li>Type it below within about two minutes.</li>
            </ol>
          </div>
        </div>

        <div aria-live="polite" className="text-muted-foreground flex min-h-5 items-center gap-2 text-xs">
          {starting && (
            <>
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              Asking the television to show a code&hellip;
            </>
          )}
          {!starting && awaitingCode && 'The television is showing a code now.'}
        </div>

        <Field
          label="Pairing code"
          value={code}
          autoFocus
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={CODE_LENGTH}
          invalid={failed}
          onChange={(event) =>
            setCode(event.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, CODE_LENGTH))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          className="text-center font-mono text-2xl tracking-[0.4em] uppercase"
        />

        <ErrorStrip message={message} onDismiss={() => setError(null)} />

        <p className="text-muted-foreground text-xs">
          Nothing on screen? Make sure the television is switched on and on this network,
          then try again.
        </p>
      </div>
    </Modal>
  )
}
