/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * TypeScript mirror of the generic version-one launcher provider contract. Describes
 * per-TV integration capabilities, catalogs, guide intervals, browsing/profile data,
 * observed playback and typed commands without private service names or API mappings.
 * Appliance commands also carry an expected profile identity that is not forwarded
 * as part of the external provider v1 protocol.
 */
import type { MediaAction, PlayerState } from './api-types'

/** Features a provider can supply for one television and its current profile. */
export type Capability = 'catalog' | 'browse' | 'guide' | 'tune' | 'channel_step' | 'playback' | 'profiles'

/** Association and active profile reported for the canonical selected TV. */
export interface Integration {
  device_id: string
  available: boolean
  provider_id: string | null
  provider_name: string | null
  capabilities: Capability[]
  profile_id: string | null
  profile_revision: string
  error: string | null
}

/** Credential-free provider discovery and enablement information. */
export interface ProviderStatus {
  id: string
  name: string
  enabled: boolean
  available: boolean
  error: string | null
  last_seen: string | null
}

/** Installed app or service available through a player on the selected TV. */
export interface ProviderCatalogItem {
  id: string
  name: string
  kind: 'app' | 'service'
  package: string | null
  icon_url: string | null
  /** Recent foreground sessions reported by this TV; absent for older providers. */
  usage_count?: number | null
  available: boolean
  action: { type: 'launch'; item_id: string }
}

/** Catalog filtered by the launcher's active profile. */
export interface ProviderCatalog {
  revision: string
  profile_revision: string
  items: ProviderCatalogItem[]
}

/** Safe title detail shared by browsing, search and guide details. */
export interface ProviderTitle {
  id: string
  title: string
  subtitle: string | null
  description?: string | null
  image_url: string | null
  available: boolean
  actions?: Array<'open' | 'resume'>
}

/** One bounded page of continue-watching or search results. */
export interface ProviderBrowse {
  revision: string
  profile_revision: string
  items: ProviderTitle[]
  next_cursor: string | null
}

/** One authoritative programme interval; recommendations do not imply live seeking. */
export interface Programme {
  id: string
  title_id: string
  title: string
  subtitle: string | null
  image_url: string | null
  start: string
  end: string
  available: boolean
}

/** Stable channel in the provider's profile-specific lineup. */
export interface GuideChannel {
  id: string
  name: string
  number: number
  kind: 'recommendation' | 'live'
  package?: string | null
  icon_url?: string | null
  accent_color?: string | null
  programmes: Programme[]
}

/** Schedule shared with the launcher, expressed in absolute UTC intervals. */
export interface ProviderGuide {
  revision: string
  profile_revision: string
  timezone: string
  server_time: string
  channels: GuideChannel[]
}

/** Safe launcher profile choices; no streaming account credentials. */
export interface ProviderProfiles {
  items: Array<{ id: string; name: string; image_url: string | null; color?: string | null }>
  active_id: string | null
  revision: string
}

/** A genuinely observed native media session, independent from Cast and Watch Next. */
export interface ProviderPlayback {
  session_id: string
  package: string | null
  title: string | null
  subtitle: string | null
  images: string[]
  player_state: PlayerState
  position: number | null
  duration: number | null
  position_at: string | null
  observed_at: string
  channel_id: string | null
  actions: MediaAction[]
}

/** Allowlisted provider actions; commands carry opaque IDs, never executable code. */
export type ProviderAction = MediaAction | 'launch' | 'open' | 'resume' | 'tune' | 'channel_step' | 'set_profile'

/** Selected-TV command with idempotency and expected profile/session context. */
export interface ProviderCommand {
  command_id: string
  action: ProviderAction
  item_id?: string
  channel_id?: string
  direction?: 'up' | 'down'
  session_id?: string
  position?: number
  /** Appliance-only expected profile identity; null explicitly means no active profile. */
  profile_id?: string | null
  profile_revision?: string
  schedule_revision?: string
}

/** Acknowledgement is distinct from confirmed current playback. */
export interface ProviderCommandResult {
  command_id: string
  status: 'accepted' | 'completed' | 'failed'
  error?: string | null
}

/** UI command input; the scoped hook supplies UUID and current profile revision. */
export type ProviderCommandInput = Omit<ProviderCommand, 'command_id' | 'profile_id' | 'profile_revision'>
