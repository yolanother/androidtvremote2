/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The settings screen of the Android TV Remote web UI. Manages the optional API token,
 * states plainly whether the appliance actually requires one (established by probing an
 * authenticated endpoint without credentials, since the contract exposes no flag for it),
 * and offers the light/dark/system theme override. Also reports the appliance's health and
 * version from the always-unauthenticated `/healthz`.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, KeyRound, Monitor, Moon, ShieldCheck, ShieldOff, Sun } from 'lucide-react'

import { Btn, ErrorStrip, Field } from '@/components/ui'
import { cn } from '@/lib/utils'
import { getToken, setToken } from '@/lib/api'
import { useTheme, type Theme } from '@/lib/prefs'
import type { HealthResponse } from '@/lib/api-types'
import { InstallSection } from '@/pwa/InstallSection'

/** Whether the appliance rejects unauthenticated requests. */
type AuthState = 'checking' | 'required' | 'open'

/** Theme choices, in the order they are offered. */
const THEMES: Array<{ id: Theme; label: string; Icon: typeof Sun }> = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
]

/**
 * Determine whether the appliance requires a token, by calling an authenticated endpoint
 * with no credentials at all. The contract has no endpoint that reports this directly.
 *
 * @returns `required` when the appliance answers 401, `open` otherwise.
 */
async function probeAuth(): Promise<AuthState> {
  try {
    const response = await fetch('/api/devices', { headers: {} })
    return response.status === 401 ? 'required' : 'open'
  } catch {
    return 'open'
  }
}

/**
 * The settings screen.
 */
export function SettingsPage() {
  const [theme, setThemeValue] = useTheme()
  const [token, setTokenValue] = useState(() => getToken() ?? '')
  const [saved, setSaved] = useState(false)
  const [auth, setAuth] = useState<AuthState>('checking')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void probeAuth().then(setAuth)
    void fetch('/healthz')
      .then((response) => (response.ok ? (response.json() as Promise<HealthResponse>) : null))
      .then(setHealth)
      .catch(() => setError('Could not reach the appliance health endpoint.'))
  }, [])

  const save = () => {
    setToken(token.trim() || null)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
    void probeAuth().then(setAuth)
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        <Link
          to="/"
          aria-label="Back to the remote"
          className="hover:bg-accent -ml-2 cursor-pointer rounded-xl p-2.5 transition-colors"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <div role="radiogroup" aria-label="Theme" className="bg-secondary grid grid-cols-3 gap-1 rounded-2xl p-1">
          {THEMES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              onClick={() => setThemeValue(id)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors',
                theme === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Access</h2>

        {/* Say plainly whether the appliance is protected, rather than leaving the user to
            infer it from whether things happen to work. */}
        <div
          className={cn(
            'flex items-start gap-3 rounded-xl p-3 text-sm',
            auth === 'required' ? 'bg-online/10 text-online' : 'bg-pairing/10 text-pairing',
            auth === 'checking' && 'bg-secondary text-muted-foreground',
          )}
        >
          {auth === 'required' ? (
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
          ) : (
            <ShieldOff aria-hidden className="mt-0.5 size-5 shrink-0" />
          )}
          <p>
            {auth === 'checking' && 'Checking whether this appliance requires a token…'}
            {auth === 'required' &&
              'This appliance requires an access token. Requests without one are rejected.'}
            {auth === 'open' &&
              'This appliance is unauthenticated. Anyone who can reach it on the network can control your televisions.'}
          </p>
        </div>

        <Field
          label="API token"
          type="password"
          value={token}
          autoComplete="off"
          spellCheck={false}
          placeholder={auth === 'required' ? 'Required' : 'Not required'}
          onChange={(event) => setTokenValue(event.target.value)}
          hint="Stored in this browser only, and sent as a bearer token with every request."
        />
        <div className="flex items-center gap-3">
          <Btn onClick={save}>
            <KeyRound aria-hidden className="size-4" />
            Save token
          </Btn>
          <span
            aria-live="polite"
            className={cn('text-online text-xs transition-opacity', saved ? 'opacity-100' : 'opacity-0')}
          >
            Saved
          </span>
        </div>
      </section>

      <InstallSection />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Appliance</h2>
        <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 text-xs">
          <dt>Version</dt>
          <dd className="text-foreground text-right">{health?.version ?? '—'}</dd>
          <dt>Televisions</dt>
          <dd className="text-foreground text-right">{health?.devices ?? '—'}</dd>
          <dt>Connected</dt>
          <dd className="text-foreground text-right">{health?.connected ?? '—'}</dd>
        </dl>
      </section>

      <ErrorStrip message={error} onDismiss={() => setError(null)} />
    </div>
  )
}
