/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Selected-TV provider state and action hook for the remote UI. Loads only advertised
 * resources, reacts to the appliance's existing WebSocket invalidations, aborts stale
 * requests on TV/profile changes and prevents late data or acknowledgements from being
 * applied to another television. Provider state remains independent from Cast.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage } from '@/lib/api'
import type { Device } from '@/lib/api-types'
import type { Surface } from '@/lib/prefs'
import { providerApi, providerCommandId } from '@/lib/provider-api'
import type {
  Integration, ProviderCatalog, ProviderCommandInput, ProviderCommandResult,
  ProviderGuide, ProviderPlayback, ProviderProfiles,
} from '@/lib/provider-types'
import { useRemote } from '@/state/store'

/** Resources cached only within one TV/provider/profile context. */
interface Resources {
  key: string
  catalog?: ProviderCatalog
  guide?: ProviderGuide
  playback?: ProviderPlayback | null
  profiles?: ProviderProfiles
}

/** State and commands consumed by provider-aware remote surfaces. */
export interface RemoteIntegration {
  integration: Integration | null
  scope: string
  version: number
  loading: boolean
  error: string | null
  message: string | null
  pending: boolean
  catalog: ProviderCatalog | undefined
  guide: ProviderGuide | undefined
  playback: ProviderPlayback | null
  profiles: ProviderProfiles | undefined
  send: (input: ProviderCommandInput) => Promise<ProviderCommandResult | null>
  clearError: () => void
}

/** Ignore cancellations while surfacing genuine network/contract failures. */
function aborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Bind optional resources and actions to one enabled paired television.
 * @param device - Selected TV, or undefined while its route resolves.
 * @param surface - Active destination; only its large resources are fetched.
 */
export function useIntegration(device: Device | undefined, surface: Surface): RemoteIntegration {
  const { state } = useRemote()
  const deviceId = device?.id
  const eligible = !!device?.paired && device.enabled
  const version = deviceId ? state.integrationVersions[deviceId] ?? 0 : 0
  const eventIntegration = deviceId ? state.integrations[deviceId] : undefined
  const [metadata, setMetadata] = useState<{ deviceId: string; version: number; value: Integration } | null>(null)
  const [resources, setResources] = useState<Resources>({ key: '' })
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<{ scope: string; text: string } | null>(null)
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null)
  const [pending, setPending] = useState<{ scope: string; id: string } | null>(null)
  const actions = useRef(new Set<AbortController>())

  const currentMetadata = metadata && metadata.deviceId === deviceId && metadata.version === version ? metadata.value : null
  const integration = eligible ? currentMetadata ?? eventIntegration ?? null : null
  const available = !!integration?.available && integration.device_id === deviceId
  const scope = available
    ? JSON.stringify([deviceId, integration.provider_id, integration.profile_id, integration.profile_revision])
    : ''
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const selectedRef = useRef(deviceId)
  selectedRef.current = deviceId

  useEffect(() => {
    if (!deviceId || !eligible) return
    const controller = new AbortController()
    void providerApi.integration(deviceId, controller.signal).then((value) => {
      if (!controller.signal.aborted && selectedRef.current === deviceId && value.device_id === deviceId) {
        setMetadata({ deviceId, version, value })
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted || aborted(error)) return
      // A public appliance without this optional endpoint is a normal core-only remote.
      setMetadata({ deviceId, version, value: {
        device_id: deviceId, available: false, provider_id: null, provider_name: null,
        capabilities: [], profile_id: null, profile_revision: '', error: errorMessage(error),
      } })
    })
    return () => controller.abort()
  }, [deviceId, eligible, version, state.socket])

  const capabilities = integration?.capabilities.join(',') ?? ''
  useEffect(() => {
    // Cancelling a request does not undo a command already accepted upstream; it
    // prevents its acknowledgement from becoming UI state for the new context.
    for (const controller of actions.current) controller.abort()
    actions.current.clear()
    return () => {
      for (const controller of actions.current) controller.abort()
      actions.current.clear()
    }
  }, [scope])

  useEffect(() => {
    if (!deviceId || !scope || !integration?.available) return
    const controller = new AbortController()
    const expectedProfile = integration.profile_revision
    const advertised = new Set(capabilities.split(','))
    setLoading(true)
    let left = 0
    const load = <T,>(key: keyof Omit<Resources, 'key'>, work: Promise<T>) => {
      left += 1
      void work.then((value) => {
        if (controller.signal.aborted || scopeRef.current !== scope) return
        if (value && typeof value === 'object' && 'profile_revision' in value && value.profile_revision !== expectedProfile) return
        setResources((previous) => ({ ...(previous.key === scope ? previous : {}), key: scope, [key]: value }))
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && !aborted(error) && scopeRef.current === scope) {
          setFailure({ scope, text: errorMessage(error) })
          if (key === 'playback') setResources((previous) => ({ ...(previous.key === scope ? previous : {}), key: scope, playback: null }))
        }
      }).finally(() => {
        left -= 1
        if (!left && !controller.signal.aborted && scopeRef.current === scope) setLoading(false)
      })
    }
    if (advertised.has('playback')) load('playback', providerApi.playback(deviceId, controller.signal))
    if (advertised.has('profiles')) load('profiles', providerApi.profiles(deviceId, controller.signal))
    if (surface === 'apps' && advertised.has('catalog')) load('catalog', providerApi.catalog(deviceId, controller.signal))
    if (surface === 'guide' && advertised.has('guide')) {
      const from = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
      load('guide', providerApi.guide(deviceId, from.toISOString(), new Date(from.getTime() + 6 * 3_600_000).toISOString(), controller.signal))
    }
    if (!left) setLoading(false)
    return () => controller.abort()
    // integration's identity changes on every snapshot; its stable scope/capabilities
    // and explicit invalidation counter determine resource refreshes instead.
  }, [deviceId, scope, capabilities, surface, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (input: ProviderCommandInput) => {
    if (!deviceId || !scope || !integration?.available || scopeRef.current !== scope) return null
    const controller = new AbortController()
    const id = providerCommandId()
    actions.current.add(controller)
    setPending({ scope, id })
    setFailure(null)
    setNotice(null)
    try {
      const result = await providerApi.command(deviceId, {
        ...input, command_id: id, profile_id: integration.profile_id,
        profile_revision: integration.profile_revision,
      }, controller.signal)
      if (controller.signal.aborted || scopeRef.current !== scope) return null
      if (result.status === 'failed') throw new Error(result.error || 'The TV could not complete that action.')
      setNotice({ scope, text: result.status === 'accepted' ? 'Request accepted by the TV.' : 'Request completed.' })
      return result
    } catch (error) {
      if (!controller.signal.aborted && !aborted(error) && scopeRef.current === scope) {
        setFailure({ scope, text: errorMessage(error) })
      }
      return null
    } finally {
      actions.current.delete(controller)
      setPending((previous) => previous?.id === id ? null : previous)
    }
  }, [deviceId, scope, integration])

  const values = resources.key === scope && available ? resources : undefined
  return {
    integration, scope, version, loading: !!scope && loading,
    error: failure?.scope === scope ? failure.text : null,
    message: notice?.scope === scope ? notice.text : null,
    pending: pending?.scope === scope,
    catalog: values?.catalog, guide: values?.guide, playback: values?.playback ?? null,
    profiles: values?.profiles, send, clearError: () => setFailure(null),
  }
}
