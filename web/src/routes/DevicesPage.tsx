/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The device dashboard of the Android TV Remote web UI. Lists every registered television
 * as a tile whose tint, glyph, and wording all encode its live connection state, with its
 * power state and current app as supporting detail, and routes a tap straight into that
 * television's remote. Also hosts adding a television, and the per-device editor for
 * renaming, changing the host, enabling or disabling, unpairing, and removing.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, Settings, Tv } from 'lucide-react'

import { AddDeviceDialog } from '@/components/AddDeviceDialog'
import { Page, PageHeader } from '@/components/AppShell'
import { Btn, ErrorStrip, Field, Modal, StatusDot } from '@/components/ui'
import { PairingDialog } from '@/components/PairingDialog'
import { api, errorMessage } from '@/lib/api'
import { foregroundApp } from '@/lib/media'
import { cn } from '@/lib/utils'
import type { ConnectionStatus, Device } from '@/lib/api-types'
import { useRemote } from '@/state/store'

/** Tile tint per connection state. State is never signalled by colour alone; the
 *  `StatusDot` inside each tile carries the wording and glyph. */
const TILE_TINT: Record<ConnectionStatus, string> = {
  connected: 'bg-online/10 border-online/30',
  connecting: 'bg-pairing/10 border-pairing/30',
  disconnected: 'bg-card',
  unreachable: 'bg-destructive/10 border-destructive/30',
  unpaired: 'bg-pairing/10 border-pairing/30',
  disabled: 'bg-card opacity-60',
}

/**
 * The registered-television dashboard.
 */
export function DevicesPage() {
  const { state } = useRemote()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)
  const [pairing, setPairing] = useState<Device | null>(null)

  return (
    <Page wide>
      <PageHeader
        title="Televisions"
        description="Every television registered with this appliance. Open one to drive it, or use the gear to rename, re-pair, or remove it."
        action={
          <Btn onClick={() => setAddOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Add a television
          </Btn>
        }
      />

      {state.devices.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <span className="bg-secondary text-muted-foreground grid size-14 place-items-center rounded-2xl">
            <Tv aria-hidden className="size-7" />
          </span>
          <div>
            <h2 className="text-base font-semibold">No televisions yet</h2>
            <p className="text-muted-foreground mt-1 max-w-xs text-sm">
              The appliance watches the network for Android TVs. Add one to start using it as
              a remote.
            </p>
          </div>
          <Btn onClick={() => setAddOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Add a television
          </Btn>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {state.devices.map((device) => (
            <li key={device.id}>
              <div
                className={cn(
                  'flex items-stretch gap-1 rounded-2xl border transition-colors',
                  TILE_TINT[device.state.connection],
                )}
              >
                <button
                  type="button"
                  onClick={() => void navigate(`/d/${device.id}`)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl p-4 text-left"
                >
                  <Tv aria-hidden className="text-muted-foreground size-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{device.name}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <StatusDot status={device.state.connection} />
                    </span>
                    <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                      {/* Resolved through `foregroundApp`, which maps the opaque
                          `AndroidNativeApp` sentinel back to the app Cast names. */}
                      {device.state.is_on === false
                        ? 'Standby'
                        : (foregroundApp(device.state, state.apps).name ??
                          device.model ??
                          device.host)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(device)}
                  aria-label={`Settings for ${device.name}`}
                  className="hover:bg-accent cursor-pointer rounded-r-2xl px-3 transition-colors"
                >
                  <Settings aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddDeviceDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(device) => {
          setAddOpen(false)
          setPairing(device)
        }}
      />
      {editing && (
        <DeviceEditor
          device={editing}
          onClose={() => setEditing(null)}
          onPair={() => {
            setPairing(editing)
            setEditing(null)
          }}
        />
      )}
      {pairing && <PairingDialog device={pairing} onClose={() => setPairing(null)} />}
    </Page>
  )
}

/**
 * The per-device editor: rename, change host, enable or disable, unpair, and remove.
 *
 * @param props.device - The device being edited.
 * @param props.onClose - Called on every dismissal route.
 * @param props.onPair - Switches to the pairing dialog for this device.
 */
function DeviceEditor({
  device,
  onClose,
  onPair,
}: {
  device: Device
  onClose: () => void
  onPair: () => void
}) {
  const [name, setName] = useState(device.name)
  const [host, setHost] = useState(device.host)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  /** Run one mutation, reporting any failure inline and closing on success. */
  const run = async (action: () => Promise<unknown>, close = true) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (close) onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={device.name}
      description={`${device.mac} · added ${new Date(device.created_at).toLocaleDateString()}`}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            busy={busy}
            onClick={() => void run(() => api.updateDevice(device.id, { name, host }))}
            disabled={!name.trim() || !host.trim()}
          >
            Save
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <Field
          label="Address"
          value={host}
          inputMode="url"
          spellCheck={false}
          onChange={(event) => setHost(event.target.value)}
          hint="The television is identified by its MAC address, so a changed IP is safe to update here."
        />

        <div className="flex flex-col gap-2 border-t pt-4">
          <Btn
            variant="secondary"
            busy={busy}
            onClick={() => void run(() => api.updateDevice(device.id, { enabled: !device.enabled }), false)}
          >
            {device.enabled ? 'Disable this television' : 'Enable this television'}
          </Btn>

          {device.paired ? (
            <Btn
              variant="secondary"
              busy={busy}
              onClick={() => void run(() => api.unpair(device.id), false)}
            >
              Unpair (keeps the registration)
            </Btn>
          ) : (
            <Btn variant="secondary" onClick={onPair}>
              Pair this television
            </Btn>
          )}

          {confirmRemove ? (
            <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-xl border p-3">
              <p className="text-xs">
                Remove <strong>{device.name}</strong> and delete its certificates? You will have
                to pair it again.
              </p>
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setConfirmRemove(false)} className="min-h-9 text-xs">
                  Keep
                </Btn>
                <Btn
                  variant="danger"
                  busy={busy}
                  className="min-h-9 text-xs"
                  onClick={() => void run(() => api.removeDevice(device.id))}
                >
                  Remove
                </Btn>
              </div>
            </div>
          ) : (
            <Btn variant="danger" onClick={() => setConfirmRemove(true)}>
              Remove this television
            </Btn>
          )}
        </div>

        <ErrorStrip message={error} onDismiss={() => setError(null)} />
      </div>
    </Modal>
  )
}
