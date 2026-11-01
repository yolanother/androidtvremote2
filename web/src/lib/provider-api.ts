/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Same-origin API client for optional launcher providers. Builds only fixed appliance
 * endpoints, attaches the existing remote authentication through the shared request
 * helper, and accepts abort signals so a TV/profile switch can cancel stale work.
 */
import { request } from './api'
import type {
  Integration, ProviderBrowse, ProviderCatalog, ProviderCommand, ProviderCommandResult,
  ProviderGuide, ProviderPlayback, ProviderProfiles, ProviderStatus, ProviderTitle,
} from './provider-types'

/** Build a fixed device resource path, encoding the canonical television identity. */
function devicePath(deviceId: string, resource: string): string {
  return `/api/devices/${encodeURIComponent(deviceId)}/${resource}`
}

/** Generic provider APIs used by the remote and integration settings. */
export const providerApi = {
  list: (signal?: AbortSignal) => request<ProviderStatus[]>('/api/providers', { signal }),
  enable: (id: string, enabled: boolean, signal?: AbortSignal) =>
    request<ProviderStatus>(`/api/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled }, signal }),
  integration: (id: string, signal?: AbortSignal) => request<Integration>(devicePath(id, 'integrations'), { signal }),
  catalog: (id: string, signal?: AbortSignal) => request<ProviderCatalog>(devicePath(id, 'catalog'), { signal }),
  playback: (id: string, signal?: AbortSignal) => request<ProviderPlayback | null>(devicePath(id, 'playback'), { signal }),
  profiles: (id: string, signal?: AbortSignal) => request<ProviderProfiles>(devicePath(id, 'profiles'), { signal }),
  guide: (id: string, from: string, to: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({ from, to })
    return request<ProviderGuide>(`${devicePath(id, 'guide')}?${query}`, { signal })
  },
  browse: (id: string, mode: string, query: string, cursor?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ mode, ...(query ? { query } : {}), ...(cursor ? { cursor } : {}) })
    return request<ProviderBrowse>(`${devicePath(id, 'browse')}?${params}`, { signal })
  },
  title: (id: string, titleId: string, signal?: AbortSignal) =>
    request<ProviderTitle>(devicePath(id, `titles/${encodeURIComponent(titleId)}`), { signal }),
  command: (id: string, command: ProviderCommand, signal?: AbortSignal) =>
    request<ProviderCommandResult>(devicePath(id, 'provider/commands'), { method: 'POST', body: command, signal }),
}

/** Generate a v4 command UUID even on LAN HTTP origins without crypto.randomUUID. */
export function providerCommandId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
