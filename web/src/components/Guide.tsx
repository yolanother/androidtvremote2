/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Selected-TV guide for optional providers. Presents now/next cards on phones and a
 * horizontally contained time grid on wider screens, with authoritative provider
 * intervals, title details, explicit tune and channel-step actions. Recommendations
 * resume/open through the TV launcher and never pretend to be live-time seeks.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { Btn, Modal } from '@/components/ui'
import type { RemoteIntegration } from '@/hooks/useIntegration'
import { providerApi } from '@/lib/provider-api'
import type { GuideChannel, Programme, ProviderTitle } from '@/lib/provider-types'

/** Is an authoritative programme currently on the provider's schedule? */
function current(programme: Programme, now: number): boolean {
  return Date.parse(programme.start) <= now && Date.parse(programme.end) > now
}

/** Render a programme clock label in the television's timezone. */
function clock(value: string | number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(value))
  } catch {
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
}

/** React to the card/grid breakpoint without duplicating programme controls in the DOM. */
function watchWide(listener: () => void): () => void {
  const media = matchMedia('(min-width: 768px)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** Responsive guide, title details and channel surfing for a stable TV/provider context. */
export function Guide({ deviceId, deviceName, remote }: { deviceId: string; deviceName: string; remote: RemoteIntegration }) {
  const guide = remote.guide
  const wide = useSyncExternalStore(watchWide, () => matchMedia('(min-width: 768px)').matches, () => false)
  const capabilities = remote.integration?.capabilities ?? []
  const [now, setNow] = useState(Date.now)
  const offset = useMemo(() => guide ? Date.parse(guide.server_time) - Date.now() : 0, [guide?.server_time])
  const [selected, setSelected] = useState<{ channel: GuideChannel; programme: Programme } | null>(null)
  const [detail, setDetail] = useState<ProviderTitle | null>(null)
  const scopeRef = useRef(remote.scope)
  scopeRef.current = remote.scope
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    setDetail(null)
    if (!selected || !capabilities.includes('browse')) return
    const controller = new AbortController()
    const scope = remote.scope
    void providerApi.title(deviceId, selected.programme.title_id, controller.signal).then((value) => {
      if (!controller.signal.aborted && scopeRef.current === scope) setDetail(value)
    }).catch(() => { /* Programme metadata remains useful when optional details fail. */ })
    return () => controller.abort()
  }, [deviceId, remote.scope, selected, capabilities.includes('browse')])

  const serverNow = now + (Number.isFinite(offset) ? offset : 0)
  const tune = (channel: GuideChannel) => void remote.send({ action: 'tune', channel_id: channel.id, schedule_revision: guide?.revision })
  const hasChannels = !!guide?.channels.length
  const start = Math.floor(serverNow / 3_600_000) * 3_600_000
  const end = start + 6 * 3_600_000
  const timeRange = end - start

  return (
    <section aria-label="TV guide" className="w-full min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">TV guide</h2><p className="text-muted-foreground mt-1 text-sm">{deviceName}{guide ? ` · ${guide.timezone}` : ''}</p></div>
        {capabilities.includes('channel_step') && <div className="flex gap-2">
          <Btn variant="secondary" aria-label="Channel down" disabled={!hasChannels} onClick={() => void remote.send({ action: 'channel_step', direction: 'down', schedule_revision: guide?.revision })}><ChevronDown aria-hidden className="size-4" /><span className="hidden sm:inline">Channel</span> −</Btn>
          <Btn variant="secondary" aria-label="Channel up" disabled={!hasChannels} onClick={() => void remote.send({ action: 'channel_step', direction: 'up', schedule_revision: guide?.revision })}><ChevronUp aria-hidden className="size-4" /><span className="hidden sm:inline">Channel</span> +</Btn>
        </div>}
      </div>
      {!guide ? <p role="status" className="text-muted-foreground py-8 text-sm">{remote.error ? 'This TV’s guide could not be loaded.' : 'Loading this TV’s guide…'}</p>
        : !hasChannels ? <p className="text-muted-foreground py-8 text-sm">No channels available for this TV and profile.</p>
        : <>
          <p className="text-muted-foreground my-3 text-xs">Choose a channel to resume or open its current title on the TV.</p>
          {!wide && <div className="flex flex-col gap-3">
            {guide.channels.map((channel) => {
              const programmes = channel.programmes.filter((programme) => Date.parse(programme.end) > serverNow).slice(0, 3)
              const active = programmes.find((programme) => current(programme, serverNow))
              return <section key={channel.id} aria-label={channel.name} className="bg-card min-w-0 rounded-2xl border p-3">
                <div className="mb-2 flex min-w-0 items-center justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-semibold">{channel.number}. {channel.name}</h3>
                  {capabilities.includes('tune') && <Btn variant="secondary" aria-label={`Tune ${channel.name}`} disabled={!active?.available || remote.pending} onClick={() => tune(channel)} className="shrink-0 px-3 text-xs">Tune</Btn>}
                </div>
                {!programmes.length && <p className="text-muted-foreground text-xs">No programmes scheduled.</p>}
                {programmes.map((programme) => <button key={programme.id} type="button" onClick={() => setSelected({ channel, programme })}
                  className="hover:bg-accent flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-xl px-2 py-3 text-left">
                  <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">{current(programme, serverNow) ? 'Now' : clock(programme.start, guide.timezone)}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{programme.title}</span><span className="text-muted-foreground mt-1 block truncate text-xs">{programme.subtitle ?? (programme.available ? 'View details' : 'Unavailable')}</span></span>
                </button>)}
              </section>
            })}
          </div>}
          {wide && <div className="max-w-full overflow-x-auto rounded-2xl border" tabIndex={0} aria-label="Guide timeline">
            <div className="min-w-[900px]">
              <div className="bg-secondary grid grid-cols-[10rem_1fr] border-b text-xs"><span className="p-3 font-semibold">Channel</span><div className="grid grid-cols-6">{Array.from({ length: 6 }, (_, index) => <span key={index} className="border-l p-3 tabular-nums">{clock(start + index * 3_600_000, guide.timezone)}</span>)}</div></div>
              {guide.channels.map((channel) => {
                const active = channel.programmes.find((programme) => current(programme, serverNow))
                return <div key={channel.id} className="grid grid-cols-[10rem_1fr] border-b last:border-b-0">
                  <div className="bg-card flex min-w-0 flex-col justify-center gap-2 border-r p-3"><h3 className="truncate text-sm font-semibold">{channel.number}. {channel.name}</h3>
                    {capabilities.includes('tune') && <Btn variant="secondary" aria-label={`Tune ${channel.name}`} disabled={!active?.available || remote.pending} onClick={() => tune(channel)} className="min-h-9 text-xs">Tune</Btn>}
                  </div>
                  <div className="bg-secondary/30 relative h-28 overflow-hidden">
                    <span aria-hidden className="bg-online pointer-events-none absolute inset-y-0 z-10 w-px" style={{ left: `${(serverNow - start) / timeRange * 100}%` }} />
                    {channel.programmes.filter((programme) => Date.parse(programme.end) > start && Date.parse(programme.start) < end).map((programme) => {
                      const left = Math.max(start, Date.parse(programme.start))
                      const right = Math.min(end, Date.parse(programme.end))
                      return <button key={programme.id} type="button" onClick={() => setSelected({ channel, programme })}
                        style={{ left: `${(left - start) / timeRange * 100}%`, width: `${(right - left) / timeRange * 100}%` }}
                        className="bg-card hover:bg-accent absolute inset-y-1 min-w-0 cursor-pointer overflow-hidden rounded-lg border px-3 py-2 text-left focus-visible:z-20">
                        <span className="text-muted-foreground block truncate text-[0.6875rem]">{clock(programme.start, guide.timezone)} – {clock(programme.end, guide.timezone)}</span>
                        <span className="mt-1 block truncate text-sm font-medium">{programme.title}</span>
                        <span className="text-muted-foreground mt-1 block truncate text-xs">{programme.subtitle ?? (programme.available ? 'View details' : 'Unavailable')}</span>
                      </button>
                    })}
                  </div>
                </div>
              })}
            </div>
          </div>}
        </>}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.programme.title ?? 'Programme details'}
        description={selected && guide ? `${selected.channel.name} · ${clock(selected.programme.start, guide.timezone)} – ${clock(selected.programme.end, guide.timezone)}` : undefined}
        footer={<>
          {selected && current(selected.programme, serverNow) && capabilities.includes('tune') && <Btn disabled={!selected.programme.available || remote.pending} onClick={() => tune(selected.channel)}>Tune channel</Btn>}
          {(detail?.actions ?? []).map((action) => <Btn key={action} variant="secondary" disabled={!detail?.available || remote.pending} onClick={() => void remote.send({ action, item_id: detail!.id })}>{action === 'resume' ? 'Resume on TV' : 'Open on TV'}</Btn>)}
        </>}>
        {selected?.programme.image_url && <img src={selected.programme.image_url} alt="" className="mb-3 aspect-video w-full rounded-xl object-cover" />}
        <p className="text-muted-foreground text-sm">{detail?.subtitle ?? selected?.programme.subtitle ?? 'Open this title on the selected TV using an available action.'}</p>
        {selected && !selected.programme.available && <p className="text-muted-foreground mt-3 text-sm">This title is unavailable on this TV.</p>}
      </Modal>
    </section>
  )
}
