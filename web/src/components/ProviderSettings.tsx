/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Optional provider health and enablement settings for Android TV Remote. Lists the
 * appliance's discovered providers, reacts to live provider changes, and persists an
 * operator's enable/disable choice through the generic API without exposing credentials.
 */
import { useEffect, useState } from 'react'
import { Plug } from 'lucide-react'

import { Card, SectionHeading } from '@/components/CodeBlock'
import { Btn, ErrorStrip } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { providerApi } from '@/lib/provider-api'
import type { ProviderStatus } from '@/lib/provider-types'
import { useRemote } from '@/state/store'

/** Show discovered provider health and a persisted enable/disable action. */
export function ProviderSettings() {
  const { state } = useRemote()
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void providerApi.list(controller.signal).then((value) => { if (!controller.signal.aborted) setProviders(value) })
      .catch(() => { /* Older/core-only appliances have no optional provider API. */ })
    return () => controller.abort()
  }, [state.providers, state.socket])
  const toggle = async (provider: ProviderStatus) => {
    setBusy(provider.id); setError(null)
    try {
      const value = await providerApi.enable(provider.id, !provider.enabled)
      setProviders((previous) => previous.map((item) => item.id === value.id ? value : item))
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(null) }
  }
  return <Card>
    <SectionHeading title="Launcher integrations" icon={<Plug aria-hidden className="size-4" />} description="Compatible services on the appliance’s network connect automatically for paired TVs." />
    <ErrorStrip message={error} onDismiss={() => setError(null)} />
    {!providers.length ? <p className="text-muted-foreground text-sm">No compatible providers discovered. The standard remote and Cast features remain available.</p>
      : <ul className="flex flex-col gap-3">{providers.map((provider) => <li key={provider.id} className="flex min-w-0 items-center gap-3 rounded-xl border p-3">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{provider.name}</p><p className="text-muted-foreground mt-1 text-xs">{!provider.enabled ? 'Disabled' : provider.available ? 'Connected' : 'Unavailable'}{provider.error ? ` · ${provider.error}` : ''}</p></div>
        <Btn variant="secondary" busy={busy === provider.id} aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.name}`} onClick={() => void toggle(provider)}>{provider.enabled ? 'Disable' : 'Enable'}</Btn>
      </li>)}</ul>}
  </Card>
}
