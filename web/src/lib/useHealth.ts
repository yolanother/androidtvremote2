/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Shared access to the appliance's always-unauthenticated `/healthz` summary — version,
 * registered and connected television counts, and the optional public HTTPS origin. The
 * result is fetched once per page load and cached in a module-level promise, so the app
 * shell, the landing page, and settings can all read it without three probes on every
 * navigation. Reading it also publishes the public URL to the PWA runtime, which needs it
 * to send a phone from an insecure LAN origin to an installable one.
 */
import { useEffect, useState } from 'react'

import type { HealthResponse } from '@/lib/api-types'
import { setPublicUrl } from '@/pwa/runtime'

/** In-flight or completed probe, shared by every caller for the life of the page. */
let pending: Promise<HealthResponse | null> | null = null

/**
 * Fetch `/healthz` once and reuse the result.
 *
 * @returns The health summary, or null when the appliance did not answer.
 */
function probe(): Promise<HealthResponse | null> {
  pending ??= fetch('/healthz')
    .then((response) => (response.ok ? (response.json() as Promise<HealthResponse>) : null))
    .then((health) => {
      setPublicUrl(health?.public_url ?? null)
      return health
    })
    .catch(() => null)
  return pending
}

/** What `useHealth` reports back. */
export interface HealthProbe {
  /** The summary, or null while loading or after a failure. */
  health: HealthResponse | null
  /** True until the probe settles, so a caller can reserve space rather than jump. */
  loading: boolean
  /** True when the appliance could not be reached at all. */
  failed: boolean
}

/**
 * Read the appliance's health summary.
 *
 * @returns The summary alongside its loading and failure state.
 */
export function useHealth(): HealthProbe {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void probe().then((result) => {
      if (!live) return
      setHealth(result)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [])

  return { health, loading, failed: !loading && health === null }
}
