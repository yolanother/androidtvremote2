/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Television-specific app and service launcher for optional providers. Shows a compact
 * usage-ranked shortlist with real appliance-served package icons, expands the full
 * inventory on request, and submits opaque actions through the scoped command hook.
 * Launch tiles preserve desktop remote keyboard control after pointer activation.
 */
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { AppIcon } from '@/components/AppIcon'
import { Btn } from '@/components/ui'
import type { RemoteIntegration } from '@/hooks/useIntegration'
import { useOrganicMotion } from '@/lib/motion'

/** Render one TV's installed app/service inventory without treating curated apps as installed. */
export function ProviderApps({ remote, deviceName }: { remote: RemoteIntegration; deviceName: string }) {
  const [expandedScope, setExpandedScope] = useState<string | null>(null)
  const expanded = expandedScope === remote.scope
  const { reduced, transition } = useOrganicMotion()
  const items = useMemo(() => {
    const unique = new Map<string, NonNullable<typeof remote.catalog>['items'][number]>()
    for (const item of remote.catalog?.items ?? []) {
      const key = item.package || item.id
      const existing = unique.get(key)
      const preferred = !existing || (item.available && !existing.available) || (item.available === existing.available && item.kind === 'service' && existing.kind !== 'service') ? item : existing
      unique.set(key, { ...preferred, usage_count: Math.max(item.usage_count ?? 0, existing?.usage_count ?? 0) })
    }
    return [...unique.values()].sort((a, b) => Number(b.available) - Number(a.available)
      || (b.usage_count ?? 0) - (a.usage_count ?? 0)
      || (a.package ?? a.name).localeCompare(b.package ?? b.name)
      || a.name.localeCompare(b.name))
  }, [remote.catalog])
  const ranked = items.some((item) => item.available && (item.usage_count ?? 0) > 0)
  const visible = expanded ? items : items.filter((item) => item.available && (!ranked || (item.usage_count ?? 0) > 0)).slice(0, 6)
  return (
    <section aria-label="Apps and services" className="w-full min-w-0">
      <h2 className="text-lg font-semibold">Apps &amp; services</h2>
      <p className="text-muted-foreground mt-1 text-sm">{ranked ? 'Frequently used on' : 'Available on'} {deviceName}</p>
      {!remote.catalog ? (
        <p role="status" className="text-muted-foreground py-6 text-sm">{remote.error ? 'This TV’s app list could not be loaded.' : 'Loading this TV’s apps…'}</p>
      ) : !remote.catalog.items.length ? (
        <p className="text-muted-foreground py-6 text-sm">No apps or services reported by this TV.</p>
      ) : (
        <>
        <motion.div layout={!reduced} transition={transition} className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          <AnimatePresence initial={false}>
          {visible.map((item) => (
            <motion.button
              key={item.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, scale: 0.94, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={transition}
              whileTap={reduced ? undefined : { scale: 0.96 }}
              type="button"
              data-remote-command
              aria-label={`Open ${item.name}`}
              disabled={!item.available || remote.pending}
              onClick={() => void remote.send({ action: 'launch', item_id: item.action.item_id })}
              className="hover:bg-accent flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-2xl border p-3 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <AppIcon name={item.name} iconUrl={item.icon_url || (item.package ? `/api/icons/${encodeURIComponent(item.package)}` : null)} alt="" className="w-14 sm:w-16" />
              <span className="max-w-full truncate text-sm font-medium">{item.name}</span>
              <span className="text-muted-foreground text-xs">{item.available ? item.kind === 'service' ? 'Service' : 'App' : 'Unavailable'}</span>
            </motion.button>
          ))}
          </AnimatePresence>
        </motion.div>
        {items.length > visible.length || expanded ? <Btn variant="secondary" aria-expanded={expanded} className="mt-3 w-full" onClick={() => setExpandedScope(expanded ? null : remote.scope)}>{expanded ? 'View less' : 'View more'}</Btn> : null}
        </>
      )}
    </section>
  )
}
