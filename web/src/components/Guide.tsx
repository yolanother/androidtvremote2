/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Compact selected-TV programme grid for every screen size. Keeps service identities
 * and time labels visible while browsing artwork-rich authoritative UTC intervals,
 * then opens details before explicit TV actions. Recommendation channels resume/open
 * their current title and never imply a live-time seek.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, ChevronUp, Clock3, MonitorPlay, Play } from 'lucide-react'

import { AppIcon } from '@/components/AppIcon'
import { Btn, Modal } from '@/components/ui'
import type { RemoteIntegration } from '@/hooks/useIntegration'
import { useOrganicMotion } from '@/lib/motion'
import { providerApi } from '@/lib/provider-api'
import type { GuideChannel, Programme, ProviderTitle } from '@/lib/provider-types'

/** Is an authoritative programme currently on the provider's schedule? */
function current(programme: Programme, now: number): boolean {
  return Date.parse(programme.start) <= now && Date.parse(programme.end) > now
}

/** Format an authoritative time in the selected television's timezone. */
function clock(value: string | number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(value))
  } catch {
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
}

/** Validate optional service colors before using them as decorative CSS. */
function serviceColor(channel: GuideChannel): string {
  return /^#[\da-f]{6}$/i.test(channel.accent_color ?? '') ? channel.accent_color! : 'var(--muted-foreground)'
}

/** Responsive guide, selected programme details and guarded TV channel surfing. */
export function Guide({ deviceId, deviceName, remote }: { deviceId: string; deviceName: string; remote: RemoteIntegration }) {
  const guide = remote.guide
  const capabilities = remote.integration?.capabilities ?? []
  const { reduced, transition } = useOrganicMotion()
  const [now, setNow] = useState(Date.now)
  const offset = useMemo(() => guide ? Date.parse(guide.server_time) - Date.now() : 0, [guide?.server_time])
  const [selected, setSelected] = useState<{ channel: GuideChannel; programme: Programme } | null>(null)
  const [detail, setDetail] = useState<ProviderTitle | null>(null)
  const timeline = useRef<HTMLDivElement>(null)
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
  const gridWidth = 1200
  const nowLeft = (serverNow - start) / timeRange * gridWidth
  const selectedCurrent = selected && current(selected.programme, serverNow)
  const selectedImage = detail?.image_url || selected?.programme.image_url

  return (
    <section aria-label="TV guide" className="w-full min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><h2 className="text-lg font-semibold">TV guide</h2><p className="text-muted-foreground mt-0.5 truncate text-xs">{deviceName}{guide ? ` · ${guide.timezone}` : ''}</p></div>
        {capabilities.includes('channel_step') && <div className="flex gap-1.5">
          <Btn variant="secondary" aria-label="Channel down" disabled={!hasChannels || remote.pending} onClick={() => void remote.send({ action: 'channel_step', direction: 'down', schedule_revision: guide?.revision })} className="w-11 px-0"><ChevronDown aria-hidden className="size-4" /></Btn>
          <Btn variant="secondary" aria-label="Channel up" disabled={!hasChannels || remote.pending} onClick={() => void remote.send({ action: 'channel_step', direction: 'up', schedule_revision: guide?.revision })} className="w-11 px-0"><ChevronUp aria-hidden className="size-4" /></Btn>
        </div>}
      </div>
      {!guide ? <p role="status" className="text-muted-foreground py-8 text-sm">{remote.error ? 'This TV’s guide could not be loaded.' : 'Loading this TV’s guide…'}</p>
        : !hasChannels ? <p className="text-muted-foreground py-8 text-sm">No channels available for this TV and profile.</p>
        : <>
          <div className="text-muted-foreground my-2 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5"><span aria-hidden className="bg-online size-1.5 rounded-full" />{clock(serverNow, guide.timezone)} · On now</span>
            <button type="button" className="hover:bg-accent min-h-11 cursor-pointer rounded-lg px-2 font-medium" onClick={() => timeline.current?.scrollTo({ left: 0, behavior: reduced ? 'instant' : 'smooth' })}>Back to now</button>
          </div>
          <div ref={timeline} className="tv-guide-timeline max-w-full overflow-auto overscroll-contain rounded-2xl border" tabIndex={0} role="region" aria-label="Guide timeline">
            <div className="tv-guide-grid" style={{ '--guide-width': `${gridWidth}px` } as CSSProperties}>
              <div className="tv-guide-ruler bg-secondary sticky top-0 z-30 flex h-10 border-b text-[0.6875rem] font-medium tabular-nums">
                <div className="tv-guide-channel bg-secondary sticky left-0 z-40 flex shrink-0 items-center border-r px-2">Channels</div>
                <div className="relative shrink-0" style={{ width: gridWidth }}>
                  {Array.from({ length: 12 }, (_, index) => <span key={index} className="absolute inset-y-0 flex items-center border-l px-2" style={{ left: index / 12 * gridWidth, width: gridWidth / 12 }}>{clock(start + index * 1_800_000, guide.timezone)}</span>)}
                  <span aria-hidden className="bg-online absolute bottom-0 h-1.5 w-1.5 rounded-full" style={{ left: nowLeft - 2 }} />
                </div>
              </div>
              {guide.channels.map((channel) => {
                const active = channel.programmes.find((programme) => current(programme, serverNow))
                const accent = serviceColor(channel)
                return <div key={channel.id} className="tv-guide-row flex border-b last:border-b-0" style={{ '--service-color': accent } as CSSProperties}>
                  <div className="tv-guide-channel bg-card sticky left-0 z-20 shrink-0 border-r">
                    <button type="button" aria-label={`Tune ${channel.name}`} disabled={!capabilities.includes('tune') || !active?.available || remote.pending} onClick={() => tune(channel)}
                      className="hover:bg-accent flex h-full w-full cursor-pointer flex-col items-start justify-center gap-1 border-l-[3px] px-2 text-left disabled:cursor-default" style={{ borderLeftColor: accent }}>
                      <span className="flex w-full items-center gap-1.5"><AppIcon iconUrl={channel.icon_url || (channel.package ? `/api/icons/${encodeURIComponent(channel.package)}` : null)} name={channel.name} alt="" className="!w-6 !rounded-md" size={48} /><span className="text-muted-foreground text-[0.625rem] tabular-nums">{String(channel.number).padStart(2, '0')}</span><Play aria-hidden className="ml-auto size-3" /></span>
                      <span className="w-full truncate text-[0.6875rem] font-semibold" title={channel.name}>{channel.name}</span>
                      <span className="text-muted-foreground text-[0.625rem]">{active?.available ? 'Tune on TV' : 'Unavailable'}</span>
                    </button>
                  </div>
                  <div className="bg-secondary/40 relative shrink-0 overflow-hidden" style={{ width: gridWidth }}>
                    {Array.from({ length: 12 }, (_, index) => <span key={index} aria-hidden className="pointer-events-none absolute inset-y-0 border-l" style={{ left: index * gridWidth / 12 }} />)}
                    <span aria-label="Current time" className="bg-online pointer-events-none absolute inset-y-0 z-10 w-px" style={{ left: nowLeft }} />
                    {channel.programmes.filter((programme) => Date.parse(programme.end) > start && Date.parse(programme.start) < end).map((programme) => {
                      const left = Math.max(start, Date.parse(programme.start))
                      const right = Math.min(end, Date.parse(programme.end))
                      const onNow = current(programme, serverNow)
                      const progress = Math.max(0, Math.min(1, (serverNow - Date.parse(programme.start)) / (Date.parse(programme.end) - Date.parse(programme.start))))
                      return <motion.button key={programme.id} type="button" onClick={() => setSelected({ channel, programme })} whileTap={reduced ? undefined : { scale: 0.98 }} transition={transition}
                        aria-pressed={selected?.programme.id === programme.id} aria-label={`${programme.title}, ${clock(programme.start, guide.timezone)} – ${clock(programme.end, guide.timezone)}`}
                        style={{ left: (left - start) / timeRange * gridWidth + 3, width: Math.max(1, (right - left) / timeRange * gridWidth - 6), borderColor: onNow ? accent : undefined }}
                        className="tv-guide-programme bg-card hover:bg-accent absolute inset-y-1 min-w-0 cursor-pointer overflow-hidden rounded-xl border text-left focus-visible:z-20">
                        <span aria-hidden className="absolute inset-0 bg-gradient-to-br from-black/15 to-black/60"><MonitorPlay className="absolute right-3 top-3 size-10 opacity-15" /></span>
                        {programme.image_url && <img src={programme.image_url} alt="" width="320" height="180" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true }} className="absolute inset-0 size-full object-cover" />}
                        <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/40" />
                        <span className="relative flex h-full min-w-0 flex-col justify-center gap-1 px-2.5 text-white">
                          <span className="truncate text-[0.625rem] text-white/80">{onNow ? 'NOW · ' : ''}{clock(programme.start, guide.timezone)} – {clock(programme.end, guide.timezone)}</span>
                          <span className="block truncate text-xs font-semibold">{programme.title}</span>
                          <span className="truncate text-[0.625rem] text-white/75">{programme.available ? programme.subtitle ?? 'View programme' : 'Unavailable'}</span>
                        </span>
                        {onNow && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20"><span className="block h-full" style={{ width: `${progress * 100}%`, backgroundColor: accent }} /></span>}
                      </motion.button>
                    })}
                  </div>
                </div>
              })}
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-[0.6875rem]">Swipe through the schedule. Tune resumes or opens the channel’s current title on your TV.</p>
        </>}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={detail?.title ?? selected?.programme.title ?? 'Programme details'}
        description={selected && guide ? `${selected.channel.name} · ${clock(selected.programme.start, guide.timezone)} – ${clock(selected.programme.end, guide.timezone)}` : undefined}
        footer={<>
          {selectedCurrent && capabilities.includes('tune') && <Btn disabled={!selected.programme.available || remote.pending} onClick={() => tune(selected.channel)}><Play aria-hidden className="size-4" />Tune channel</Btn>}
          {(detail?.actions ?? []).map((action) => <Btn key={action} variant="secondary" disabled={!detail?.available || remote.pending} onClick={() => void remote.send({ action, item_id: detail!.id })}>{action === 'resume' ? 'Resume on TV' : 'Open on TV'}</Btn>)}
        </>}>
        <motion.div key={selected?.programme.id} initial={reduced ? false : { opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={transition}>
          <div className="bg-secondary relative mb-3 aspect-video overflow-hidden rounded-xl">
            <MonitorPlay aria-hidden className="text-muted-foreground absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 opacity-25" />
            {selectedImage && <img src={selectedImage} alt="" width="640" height="360" onError={(event) => { event.currentTarget.hidden = true }} className="absolute inset-0 size-full object-cover" />}
            {selected && <span className="absolute bottom-2 left-2 rounded-lg bg-black/75 px-2 py-1 text-xs font-medium text-white" style={{ borderLeft: `3px solid ${serviceColor(selected.channel)}` }}>{selected.channel.name}</span>}
          </div>
          <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs"><Clock3 aria-hidden className="size-3.5" />{selectedCurrent ? 'On now' : 'Scheduled'}{selected && ` · ${Math.round((Date.parse(selected.programme.end) - Date.parse(selected.programme.start)) / 60_000)} min`}</p>
          <p className="text-muted-foreground text-sm">{detail?.description ?? detail?.subtitle ?? selected?.programme.subtitle ?? 'Open this title on the selected TV using an available action.'}</p>
          {selected && !selected.programme.available && <p className="text-muted-foreground mt-3 text-sm">This title is unavailable on this TV.</p>}
        </motion.div>
      </Modal>
    </section>
  )
}
