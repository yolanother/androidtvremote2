/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The persistent header of the Android TV Remote web UI. Keeps the active television's
 * name, connection state, and the app it is showing permanently visible — a remote whose presses are
 * silently going nowhere is worse than one that is obviously offline — and turns the name
 * into the device switcher, a sheet listing every registered TV with its live status plus
 * routes back to the console dashboard and to add or manage devices. Also announces connection changes through a polite live
 * region so the state is available without sight. Optional TV profile selection shares
 * the action bar as a compact, keyboard-accessible picker with configured profile photos
 * and distinguishable colored initials instead of occupying another row.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, LayoutDashboard, Plus, Settings, Sliders, Tv } from 'lucide-react'

import { Btn, LiveRegion, Modal, StatusDot } from '@/components/ui'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { cn } from '@/lib/utils'
import { foregroundApp } from '@/lib/media'
import type { Device } from '@/lib/api-types'
import type { ProviderProfiles } from '@/lib/provider-types'
import { useRemote } from '@/state/store'

/**
 * The remote header.
 *
 * @param props.device - The television currently being driven.
 * @param props.onSelect - Called with a device id when the user switches televisions.
 * @param props.onAdd - Called when the user asks to add a television.
 * @param props.profiles - Available selected-TV profiles, when supported by its provider.
 * @param props.profileId - Current provider profile identity.
 * @param props.profilePending - Prevents another profile selection while a command is pending.
 * @param props.onProfileChange - Sends the guarded selected-TV profile change.
 */
export function RemoteHeader({
  device,
  onSelect,
  onAdd,
  profiles,
  profileId,
  profilePending,
  onProfileChange,
}: {
  device: Device
  onSelect: (deviceId: string) => void
  onAdd: () => void
  profiles?: ProviderProfiles
  profileId?: string | null
  profilePending?: boolean
  onProfileChange?: (profileId: string) => void
}) {
  const { state } = useRemote()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // Resolved rather than read straight off `current_app`, which is the opaque
  // `AndroidNativeApp` sentinel whenever the television is driven by its own remote.
  const appName = foregroundApp(device.state, state.apps).name
  const activeProfile = profiles?.items.find((profile) => profile.id === (profileId ?? profiles.active_id))

  return (
    <header className="tv-remote-header flex shrink-0 items-center gap-1 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 md:px-0 md:pt-0">
      <button
        type="button"
        onClick={() => setSwitcherOpen(true)}
        aria-haspopup="dialog"
        className="hover:bg-accent -ml-2 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-base font-semibold">{device.name}</span>
            <ChevronDown aria-hidden className="text-muted-foreground size-4 shrink-0" />
          </span>
          {/* Status and current app share one line whose height never changes, so a state
              update cannot shift the stage below. */}
          <span className="flex h-4 items-center gap-2">
            <StatusDot status={device.state.connection} />
            {appName && (
              <span className="text-muted-foreground min-w-0 truncate text-xs">&middot; {appName}</span>
            )}
          </span>
        </span>
      </button>

      {profiles && onProfileChange && <div title={`TV profile: ${activeProfile?.name ?? 'Choose profile'}`}
        className="hover:bg-accent focus-within:ring-ring relative grid size-11 shrink-0 place-items-center rounded-xl focus-within:ring-2">
        <ProfileAvatar profile={activeProfile} />
        <select aria-label="TV profile" value={profileId ?? profiles.active_id ?? ''} disabled={profilePending}
          onChange={(event) => onProfileChange(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-wait">
          {profiles.items.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </div>}

      {/* The remote sits outside the app shell, so it carries its own way back to the
          console — the index route is the dashboard, not this screen. */}
      <Link
        to="/"
        aria-label="Back to the console"
        title="Back to the console"
        className="hover:bg-accent grid size-10 shrink-0 place-items-center rounded-xl transition-colors"
      >
        <LayoutDashboard aria-hidden className="size-5" />
      </Link>
      <Link
        to="/devices"
        aria-label="Manage televisions"
        title="Manage televisions"
        className="hover:bg-accent grid size-10 shrink-0 place-items-center rounded-xl transition-colors"
      >
        <Sliders aria-hidden className="size-5" />
      </Link>
      <Link
        to="/settings"
        aria-label="Settings"
        title="Settings"
        className="hover:bg-accent -mr-2 grid size-10 shrink-0 place-items-center rounded-xl transition-colors"
      >
        <Settings aria-hidden className="size-5" />
      </Link>

      <LiveRegion>
        {device.name} is {device.state.connection}
        {device.state.error ? `. ${device.state.error}` : ''}
      </LiveRegion>

      <Modal
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        title="Switch television"
        description="Every television registered with this appliance."
        footer={
          <Btn
            variant="secondary"
            onClick={() => {
              setSwitcherOpen(false)
              onAdd()
            }}
          >
            <Plus aria-hidden className="size-4" />
            Add television
          </Btn>
        }
      >
        <ul className="flex flex-col gap-2">
          {state.devices.map((candidate) => {
            const active = candidate.id === device.id
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(candidate.id)
                    setSwitcherOpen(false)
                  }}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                    active ? 'bg-accent border-ring' : 'hover:bg-accent/60',
                  )}
                >
                  <Tv aria-hidden className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{candidate.name}</span>
                    <StatusDot status={candidate.state.connection} />
                  </span>
                  {active && <Check aria-hidden className="size-4 shrink-0" />}
                </button>
              </li>
            )
          })}
        </ul>
      </Modal>
    </header>
  )
}
