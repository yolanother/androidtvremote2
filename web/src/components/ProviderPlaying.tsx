/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Native provider playback surface with strict freshness and foreground matching.
 * Extrapolates observed progress locally, exposes only advertised session-scoped
 * actions and falls back to the existing Cast/app-identity view when the observation
 * expires, disagrees with the foreground app or is unavailable.
 */
import { useEffect, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'

import { Key } from '@/components/ui'
import { NowPlaying } from '@/components/NowPlaying'
import type { RemoteIntegration } from '@/hooks/useIntegration'
import type { RemoteControl } from '@/hooks/useRemoteControl'
import type { AppDescriptor, Device, MediaAction } from '@/lib/api-types'
import { formatTime } from '@/lib/media'
import type { ProviderPlayback } from '@/lib/provider-types'

/** A usable provider observation must be recent and describe the TV's foreground player. */
function usable(playback: ProviderPlayback | null, device: Device, now: number): playback is ProviderPlayback {
  if (!playback) return false
  const age = now - Date.parse(playback.observed_at)
  const foreground = device.state.current_app
  return Number.isFinite(age) && age >= -5_000 && age <= 30_000
    && (!foreground || foreground === 'AndroidNativeApp' || !playback.package || foreground === playback.package)
}

/** Observed provider playback, or the independent Cast/core fallback. */
export function ProviderPlaying({ remote, device, apps, control }: {
  remote: RemoteIntegration; device: Device; apps: AppDescriptor[]; control: RemoteControl
}) {
  const [now, setNow] = useState(Date.now)
  const [scrub, setScrub] = useState<number | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  const playback = remote.playback
  const sample = `${remote.scope}:${playback?.session_id}:${playback?.position_at}:${playback?.position}`
  const [lastSample, setLastSample] = useState(sample)
  if (lastSample !== sample) { setLastSample(sample); setScrub(null) }
  if (!usable(playback, device, now)) return <NowPlaying device={device} apps={apps} control={control} />
  const elapsed = playback.player_state === 'PLAYING' ? Math.max(0, (now - Date.parse(playback.position_at ?? playback.observed_at)) / 1000) : 0
  const position = Math.max(0, Math.min(playback.duration ?? Infinity, (playback.position ?? 0) + (Number.isFinite(elapsed) ? elapsed : 0)))
  const shown = scrub ?? position
  const actions = new Set(playback.actions)
  const toggle: MediaAction | null = actions.has('play_pause') ? 'play_pause'
    : playback.player_state === 'PLAYING' ? actions.has('pause') ? 'pause' : null : actions.has('play') ? 'play' : null
  const send = (action: MediaAction, target?: number) => void remote.send({ action, session_id: playback.session_id, ...(target === undefined ? {} : { position: target }) })
  const seekable = actions.has('seek') && playback.duration !== null && playback.duration > 0

  return (
    <section aria-label="Now playing" className="bg-card w-full max-w-2xl overflow-hidden rounded-2xl border p-4 sm:p-6">
      {playback.images[0] && <img src={playback.images[0]} alt="" className="bg-secondary mb-4 aspect-video max-h-64 w-full rounded-xl object-cover" />}
      <p className="text-muted-foreground text-xs">Playing on {device.name}</p>
      <h2 className="mt-1 text-xl font-semibold">{playback.title ?? playback.package ?? 'Playing'}</h2>
      {playback.subtitle && <p className="text-muted-foreground mt-1 text-sm">{playback.subtitle}</p>}
      <p className="text-muted-foreground mt-2 text-xs">{playback.player_state === 'BUFFERING' ? 'Buffering…' : playback.player_state === 'PAUSED' ? 'Paused' : 'Observed playback'}</p>
      <div className="my-4">
        {seekable ? <input type="range" min={0} max={playback.duration!} step={1} value={shown} disabled={remote.pending}
          aria-label="Seek" aria-valuetext={`${formatTime(shown)} of ${formatTime(playback.duration)}`}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={() => { if (scrub !== null) send('seek', scrub) }}
          onKeyUp={() => { if (scrub !== null) send('seek', scrub) }} className="accent-foreground min-h-8 w-full" />
          : playback.duration !== null && playback.duration > 0 ? <progress aria-label="Playback position" max={playback.duration} value={shown} className="accent-foreground h-2 w-full" /> : null}
        <div className="text-muted-foreground flex justify-between text-xs tabular-nums"><span>{formatTime(shown)}</span><span>{playback.duration === null ? 'Live' : formatTime(playback.duration)}</span></div>
      </div>
      <div className="flex justify-center gap-3">
        {actions.has('previous') && <Key label="Previous track" disabled={remote.pending} onClick={() => send('previous')} className="size-12"><SkipBack aria-hidden className="size-5" /></Key>}
        {toggle && <Key label={playback.player_state === 'PLAYING' ? 'Pause' : 'Play'} tone="accent" disabled={remote.pending} onClick={() => send(toggle)} className="h-12 min-w-20">{playback.player_state === 'PLAYING' ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="size-5" />}</Key>}
        {actions.has('stop') && <Key label="Stop playback" disabled={remote.pending} onClick={() => send('stop')} className="size-12"><Square aria-hidden className="size-4" /></Key>}
        {actions.has('next') && <Key label="Next track" disabled={remote.pending} onClick={() => send('next')} className="size-12"><SkipForward aria-hidden className="size-5" /></Key>}
      </div>
    </section>
  )
}
