/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The add-a-device dialog for the Android TV Remote web UI. Leads with the televisions the
 * appliance's mDNS browser has already found (`GET /api/discovery`, refreshed by
 * `POST /api/discovery/scan` with results arriving over the WebSocket) and falls back to a
 * manual IP address, because picking a name off a list is always easier than finding an IP
 * in a router's admin page. Registers the choice with `POST /api/devices` and reports the
 * `device_exists` conflict as a plain statement rather than an error.
 */
import { useState } from 'react'
import { Loader2, Plus, RefreshCw, Tv } from 'lucide-react'

import { Btn, ErrorStrip, Field, Modal } from '@/components/ui'
import { ApiError, api, errorMessage } from '@/lib/api'
import type { Device } from '@/lib/api-types'
import { useRemote } from '@/state/store'

/**
 * The add-device dialog.
 *
 * @param props.open - Whether the dialog is shown.
 * @param props.onClose - Called on every dismissal route.
 * @param props.onAdded - Called with the newly registered device, so the caller can jump
 *                        straight into pairing it.
 */
export function AddDeviceDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: (device: Device) => void
}) {
  const { state } = useRemote()
  const [host, setHost] = useState('')
  const [busyHost, setBusyHost] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidates = state.discovered.filter((d) => !d.registered)

  const add = async (targetHost: string, name?: string) => {
    if (!targetHost) return
    setBusyHost(targetHost)
    setError(null)
    try {
      const device = await api.registerDevice(targetHost, name)
      setHost('')
      onAdded(device)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'device_exists'
          ? 'That television is already registered.'
          : errorMessage(err),
      )
    } finally {
      setBusyHost(null)
    }
  }

  const rescan = async () => {
    setScanning(true)
    try {
      await api.rescan()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      // Results arrive as a `discovery` frame; the spinner only covers the request itself.
      setTimeout(() => setScanning(false), 1200)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a television"
      description="Pick one found on your network, or enter its address."
      footer={
        <Btn variant="ghost" onClick={onClose}>
          Done
        </Btn>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium">Found on your network</h3>
          <Btn variant="ghost" onClick={() => void rescan()} busy={scanning} className="min-h-9 px-2 text-xs">
            {!scanning && <RefreshCw aria-hidden className="size-3.5" />}
            Scan again
          </Btn>
        </div>

        {candidates.length === 0 ? (
          <p className="text-muted-foreground bg-secondary rounded-xl p-3 text-xs">
            No new televisions found. They must be switched on and on the same network. If
            yours is on a different subnet, add it by address below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {candidates.map((candidate) => (
              <li key={candidate.mdns_name}>
                <button
                  type="button"
                  disabled={busyHost !== null}
                  onClick={() => void add(candidate.host, candidate.display_name)}
                  className="hover:bg-accent flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Tv aria-hidden className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{candidate.display_name}</span>
                    <span className="text-muted-foreground block truncate text-xs">{candidate.host}</span>
                  </span>
                  {busyHost === candidate.host ? (
                    <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <Plus aria-hidden className="size-4 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void add(host.trim())
          }}
          className="flex flex-col gap-3 border-t pt-4"
        >
          <Field
            label="Or add by address"
            placeholder="192.168.1.23"
            value={host}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setHost(event.target.value)}
            hint="The appliance connects to it and reads back its name and MAC address."
          />
          <Btn type="submit" busy={busyHost === host.trim()} disabled={!host.trim()}>
            Add television
          </Btn>
        </form>

        <ErrorStrip message={error} onDismiss={() => setError(null)} />
      </div>
    </Modal>
  )
}
