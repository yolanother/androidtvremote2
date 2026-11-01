/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The settings screen of the Android TV Remote web UI, rendered inside the app shell.
 * Manages the optional API token, states plainly whether the appliance actually requires
 * one (established by probing an authenticated endpoint without credentials, since the
 * contract exposes no flag for it), and offers the light/dark/system theme override. Also
 * reports the appliance's health and version from the always-unauthenticated `/healthz`,
 * hosts progressive-web-app installation and manages discovered optional providers.
 */
import { useEffect, useState } from 'react'
import { KeyRound, Monitor, Moon, Palette, Server, ShieldCheck, ShieldOff, Sun } from 'lucide-react'

import { Btn, ErrorStrip, Field } from '@/components/ui'
import { Card, SectionHeading } from '@/components/CodeBlock'
import { Page, PageHeader } from '@/components/AppShell'
import { cn } from '@/lib/utils'
import { getToken, setToken } from '@/lib/api'
import { useHealth } from '@/lib/useHealth'
import { useTheme, type Theme } from '@/lib/prefs'
import { InstallSection } from '@/pwa/InstallSection'
import { ProviderSettings } from '@/components/ProviderSettings'

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
  const { health, failed } = useHealth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void probeAuth().then(setAuth)
  }, [])

  useEffect(() => {
    if (failed) setError('Could not reach the appliance health endpoint.')
  }, [failed])

  const save = () => {
    setToken(token.trim() || null)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
    void probeAuth().then(setAuth)
  }

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Appearance and access token stay in this browser. Launcher integration choices are saved on the appliance."
      />

      <ErrorStrip message={error} onDismiss={() => setError(null)} />

      <Card>
        <SectionHeading
          title="Appearance"
          icon={<Palette aria-hidden className="size-4" />}
          description="Follow the operating system, or pin one scheme."
        />
        <div
          role="radiogroup"
          aria-label="Theme"
          className="bg-secondary grid max-w-md grid-cols-3 gap-1 rounded-2xl p-1"
        >
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
      </Card>

      <Card>
        <SectionHeading
          title="Access"
          icon={<KeyRound aria-hidden className="size-4" />}
          description="The token this browser sends with every request and socket connect."
        />

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
          <p className="text-pretty">
            {auth === 'checking' && 'Checking whether this appliance requires a token…'}
            {auth === 'required' &&
              'This appliance requires an access token. Requests without one are rejected.'}
            {auth === 'open' &&
              'This appliance is unauthenticated. Anyone who can reach it on the network can control your televisions.'}
          </p>
        </div>

        <div className="mt-3 flex max-w-md flex-col gap-3">
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
        </div>
      </Card>

      <InstallSection />
      <ProviderSettings />

      <Card>
        <SectionHeading
          title="Appliance"
          icon={<Server aria-hidden className="size-4" />}
          description="Reported by the appliance's health endpoint."
        />
        <dl className="grid max-w-md grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="text-right font-medium">{health?.version ?? '—'}</dd>
          <dt className="text-muted-foreground">Televisions</dt>
          <dd className="text-right font-medium">{health?.devices ?? '—'}</dd>
          <dt className="text-muted-foreground">Connected</dt>
          <dd className="text-right font-medium">{health?.connected ?? '—'}</dd>
          <dt className="text-muted-foreground">Public URL</dt>
          <dd className="truncate text-right font-medium">{health?.public_url ?? 'Not set'}</dd>
        </dl>
      </Card>
    </Page>
  )
}
