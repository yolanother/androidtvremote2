/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Settings screen of the Android TV Remote tray panel, and the first-run walkthrough. Takes
 * the appliance URL and optional bearer token, tests them against the unauthenticated
 * `/healthz` endpoint plus an authenticated `/api/devices` call so the user is told honestly
 * whether the server is reachable AND whether the token is accepted, captures the optional
 * global hotkey by recording the next key combination the user presses, and persists all of
 * it through the Tauri store. Hide-on-blur is suspended while this screen is open so the
 * panel does not disappear when the user switches away to copy a token.
 */
import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { ArrowLeft, Check, Loader2, X } from 'lucide-react'
import type { Appliance } from '@/lib/useAppliance'
import { RemoteApi } from '@/lib/api'
import { normaliseBaseUrl, type Settings } from '@/lib/settings'
import { Field, RemoteButton, inputClass } from './ui'

/** Outcome of the "Test connection" probe. */
type Probe =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; detail: string }
  | { state: 'failed'; detail: string }

/**
 * Formats a keyboard event as a Tauri accelerator string (`CommandOrControl+Shift+R`).
 *
 * @param event - the captured key event.
 * @returns the accelerator, or null when only modifiers were pressed.
 */
export function toAccelerator(event: KeyboardEvent): string | null {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = event.key
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null
  if (parts.length === 0) return null
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

/**
 * Renders the settings screen.
 *
 * @param appliance - the state facade from `useAppliance`.
 * @param onClose - returns to the remote; hidden during first-run until a URL is saved.
 */
export function SettingsView({
  appliance,
  onClose,
}: {
  appliance: Appliance
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Settings>(appliance.settings)
  const [probe, setProbe] = useState<Probe>({ state: 'idle' })
  const [capturing, setCapturing] = useState(false)
  const firstRun = !appliance.settings.configured

  // Keep the panel on screen while the user is configuring it: they will very likely click
  // away to another window to fetch their token.
  useEffect(() => {
    if (!isTauri()) return
    void invoke('set_hide_on_blur', { enabled: false }).catch(() => undefined)
    return () => {
      void invoke('set_hide_on_blur', { enabled: true }).catch(() => undefined)
    }
  }, [])

  // Hotkey capture: swallow the next real combination and store it.
  useEffect(() => {
    if (!capturing) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }
      const accelerator = toAccelerator(event)
      if (!accelerator) return
      setDraft((current) => ({ ...current, hotkey: accelerator }))
      setCapturing(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturing])

  /** Probes the entered address and token and reports what actually happened. */
  async function test() {
    const baseUrl = normaliseBaseUrl(draft.baseUrl)
    if (!baseUrl) {
      setProbe({ state: 'failed', detail: 'Enter the appliance address first.' })
      return
    }
    setProbe({ state: 'testing' })
    const client = new RemoteApi(baseUrl, draft.token)
    try {
      const health = await client.health()
      // /healthz is never authenticated, so a second, authenticated call is what actually
      // proves the token is right.
      const devices = await client.listDevices()
      setProbe({
        state: 'ok',
        detail: `v${health.version} · ${devices.length} device${devices.length === 1 ? '' : 's'}`,
      })
    } catch (err) {
      setProbe({ state: 'failed', detail: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Persists the draft and returns to the remote. */
  async function save() {
    await appliance.updateSettings({
      ...draft,
      baseUrl: normaliseBaseUrl(draft.baseUrl),
      configured: true,
    })
    onClose()
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="flex items-center gap-2" data-tauri-drag-region>
        {!firstRun ? (
          <RemoteButton aria-label="Back to remote" onPress={onClose} className="size-7">
            <ArrowLeft className="size-4" />
          </RemoteButton>
        ) : null}
        <h1 className="flex-1 text-sm font-semibold">
          {firstRun ? 'Set up your remote' : 'Settings'}
        </h1>
      </header>

      {firstRun ? (
        <p className="text-[11px] leading-relaxed text-[var(--muted)]">
          Point this app at the Android TV Remote appliance running on your network. It is
          usually <code>http://&lt;host&gt;:7433</code> — the same address you open the web
          remote at. Leave the token empty unless the appliance was started with
          <code> REMOTE_API_TOKEN</code>.
        </p>
      ) : null}

      <Field label="Appliance URL" hint="Host and port of the remote appliance.">
        <input
          value={draft.baseUrl}
          onChange={(event) => {
            setDraft({ ...draft, baseUrl: event.target.value })
            setProbe({ state: 'idle' })
          }}
          placeholder="http://localhost:7433"
          spellCheck={false}
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <Field label="API token" hint="Only needed when REMOTE_API_TOKEN is set on the server.">
        <input
          type="password"
          value={draft.token}
          onChange={(event) => {
            setDraft({ ...draft, token: event.target.value })
            setProbe({ state: 'idle' })
          }}
          placeholder="(none)"
          spellCheck={false}
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-2">
        <RemoteButton onPress={() => void test()} className="h-8 px-3">
          Test connection
        </RemoteButton>
        <span className="flex min-w-0 flex-1 items-center gap-1 text-[11px]">
          {probe.state === 'testing' ? <Loader2 className="size-3 animate-spin" /> : null}
          {probe.state === 'ok' ? <Check className="size-3 text-online" /> : null}
          {probe.state === 'failed' ? <X className="size-3 text-danger" /> : null}
          <span
            className={`truncate ${probe.state === 'failed' ? 'text-danger' : 'text-[var(--muted)]'}`}
            title={'detail' in probe ? probe.detail : undefined}
          >
            {'detail' in probe ? probe.detail : ''}
          </span>
        </span>
      </div>

      <Field
        label="Global hotkey"
        hint="Off by default. Summons or dismisses the panel from anywhere."
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCapturing(true)}
            className={`${inputClass} text-left ${capturing ? 'border-[var(--online)]' : ''}`}
          >
            {capturing ? 'Press a combination…' : draft.hotkey || 'Not set'}
          </button>
          {draft.hotkey ? (
            <RemoteButton
              aria-label="Clear hotkey"
              onPress={() => setDraft({ ...draft, hotkey: '' })}
              className="size-8"
            >
              <X className="size-4" />
            </RemoteButton>
          ) : null}
        </div>
      </Field>

      <div className="mt-auto flex gap-2">
        <RemoteButton variant="solid" onPress={() => void save()} className="h-9 flex-1">
          Save
        </RemoteButton>
        {!firstRun ? (
          <RemoteButton onPress={onClose} className="h-9 px-4">
            Cancel
          </RemoteButton>
        ) : null}
      </div>
    </div>
  )
}
