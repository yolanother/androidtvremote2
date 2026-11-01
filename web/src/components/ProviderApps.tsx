/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Television-specific app and service launcher for optional providers. Renders only
 * the selected TV/profile's reported inventory, visibly disables unavailable items,
 * and submits opaque launch actions through the scoped integration command hook.
 */
import { AppIcon } from '@/components/AppIcon'
import type { RemoteIntegration } from '@/hooks/useIntegration'

/** Render one TV's installed app/service inventory without treating curated apps as installed. */
export function ProviderApps({ remote, deviceName }: { remote: RemoteIntegration; deviceName: string }) {
  return (
    <section aria-label="Apps and services" className="w-full min-w-0">
      <h2 className="text-lg font-semibold">Apps &amp; services</h2>
      <p className="text-muted-foreground mt-1 text-sm">Available on {deviceName}</p>
      {!remote.catalog ? (
        <p role="status" className="text-muted-foreground py-6 text-sm">{remote.error ? 'This TV’s app list could not be loaded.' : 'Loading this TV’s apps…'}</p>
      ) : !remote.catalog.items.length ? (
        <p className="text-muted-foreground py-6 text-sm">No apps or services reported by this TV.</p>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          {remote.catalog.items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Open ${item.name}`}
              disabled={!item.available || remote.pending}
              onClick={() => void remote.send({ action: 'launch', item_id: item.action.item_id })}
              className="hover:bg-accent flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-2xl border p-3 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <AppIcon name={item.name} iconUrl={item.icon_url} alt="" className="w-14 sm:w-16" />
              <span className="max-w-full truncate text-sm font-medium">{item.name}</span>
              <span className="text-muted-foreground text-xs">{item.available ? item.kind === 'service' ? 'Service' : 'App' : 'Unavailable'}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
