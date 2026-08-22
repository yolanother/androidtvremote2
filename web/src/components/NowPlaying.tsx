/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The now-playing stage surface of the Android TV Remote web UI. Its primary state is app
 * identity — the Cast receiver's display name, the catalog name for the foreground
 * package, or the raw package — because `state.now_playing` is null whenever the
 * television is driven by its own remote, which is most of the time. When a Cast media
 * session does exist it upgrades to artwork over a blurred backdrop, title and
 * season/episode or artist/album lines, a progress bar whose playhead is extrapolated
 * locally from `position`/`position_at` rather than polled, drag-to-seek, and transport
 * keys that are disabled rather than shown-and-rejected when `can_pause`/`can_seek` say
 * the session will not accept them.
 */
import { useEffect, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward, Tv } from 'lucide-react'

import { AppIcon } from '@/components/AppIcon'
import { ErrorStrip, Key } from '@/components/ui'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { episodeLabel, foregroundApp, formatTime, playheadAt } from '@/lib/media'
import { haptic } from '@/lib/keys'
import type { AppDescriptor, Device, MediaAction, NowPlaying as Session } from '@/lib/api-types'
import type { RemoteControl } from '@/hooks/useRemoteControl'

/** How often the locally extrapolated playhead is recomputed while something is playing. */
const TICK_MS = 500

/**
 * The now-playing surface for one television.
 *
 * @param props.device - The television being driven.
 * @param props.apps - The appliance's app catalog, used to name and illustrate the
 *                     foreground app when there is no media session.
 * @param props.control - The bound remote control, read for its disabled flag so the
 *                        transport matches the rest of the remote.
 */
export function NowPlaying({
  device,
  apps,
  control,
}: {
  device: Device
  apps: AppDescriptor[]
  control: RemoteControl
}) {
  const session = device.state.now_playing
  const { name: appName, app } = foregroundApp(device.state, apps)

  const [error, setError] = useState<string | null>(null)
  const [artFailed, setArtFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [scrub, setScrub] = useState<number | null>(null)

  const artwork = session?.images[0] ?? null
  const playing = session?.player_state === 'PLAYING'

  // The playhead advances from the last sample with no network traffic at all; a new
  // `device.state` frame re-anchors it by changing `position`/`position_at`.
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [playing])

  // A fresh sample from the television supersedes whatever the user dragged to, and a
  // different image deserves a fresh load attempt. Both are adjusted during render rather
  // than in an effect, so neither costs an extra render pass on every state frame.
  const sample = `${session?.position ?? ''}@${session?.position_at ?? ''}`
  const [lastSample, setLastSample] = useState(sample)
  if (lastSample !== sample) {
    setLastSample(sample)
    setScrub(null)
  }

  const [lastArtwork, setLastArtwork] = useState(artwork)
  if (lastArtwork !== artwork) {
    setLastArtwork(artwork)
    setArtFailed(false)
  }

  /**
   * Send one transport action, surfacing a rejection inline instead of throwing.
   *
   * @param action - The media action to post.
   * @param position - Target position in seconds, for `seek` only.
   */
  const send = (action: MediaAction, position?: number) => {
    haptic()
    setError(null)
    void api.media(device.id, action, position).catch((err: unknown) => setError(errorMessage(err)))
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <ErrorStrip message={error} onDismiss={() => setError(null)} />

      <section
        aria-label="Now playing"
        className="bg-card relative overflow-hidden rounded-3xl border shadow-sm"
      >
        {/* Artwork doubles as the backdrop. It is blurred, faded, and then covered by a
            gradient that lands on the card colour, so every text token below keeps its
            designed contrast in both themes rather than sitting on an unknown image. */}
        {artwork && !artFailed && (
          <>
            <img
              src={artwork}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-25 blur-2xl"
            />
            <div aria-hidden className="from-card/40 to-card absolute inset-0 bg-gradient-to-b" />
          </>
        )}

        <div className="relative flex flex-col items-center gap-4 p-4">
          {session ? (
            <SessionView
              session={session}
              artwork={artFailed ? null : artwork}
              onArtError={() => setArtFailed(true)}
              appName={appName}
              app={app}
              now={now}
              scrub={scrub}
              onScrub={setScrub}
              onSend={send}
              disabled={control.disabled}
            />
          ) : (
            <AppIdentityView device={device} appName={appName} app={app} />
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * The rich state: a live Cast media session with artwork, metadata, and transport.
 *
 * @param props.session - The live media session.
 * @param props.artwork - The largest artwork URL, or null when there is none to show.
 * @param props.onArtError - Called when the artwork fails to load, so it can be replaced.
 * @param props.appName - The resolved foreground app name, used as a title fallback.
 * @param props.app - The catalog entry behind that name, for its icon.
 * @param props.now - The current instant, ticked while playing, used to extrapolate.
 * @param props.scrub - The position the user is dragging to, or null when not dragging.
 * @param props.onScrub - Reports the in-progress drag position.
 * @param props.onSend - Posts a transport action.
 * @param props.disabled - True when the television cannot accept commands.
 */
function SessionView({
  session,
  artwork,
  onArtError,
  appName,
  app,
  now,
  scrub,
  onScrub,
  onSend,
  disabled,
}: {
  session: Session
  artwork: string | null
  onArtError: () => void
  appName: string | null
  app: AppDescriptor | undefined
  now: number
  scrub: number | null
  onScrub: (position: number | null) => void
  onSend: (action: MediaAction, position?: number) => void
  disabled: boolean
}) {
  const playhead = playheadAt(session, now)
  const shown = scrub ?? playhead
  const duration = session.duration
  // A live stream reports no duration, so there is no bar to draw — only elapsed time.
  const measured = duration !== null && duration > 0
  const seekable = session.can_seek && measured
  const playing = session.player_state === 'PLAYING'

  // Music gets a square sleeve, video a 16:9 frame. Falling back on `album` catches the
  // senders that leave `content_type` null.
  const square = session.content_type?.startsWith('audio') ?? session.album !== null

  const episode = episodeLabel(session.season, session.episode)
  const lines = [episode, session.subtitle, session.album].filter(Boolean) as string[]

  return (
    <>
      <div
        className={cn(
          'bg-secondary relative overflow-hidden rounded-2xl shadow-lg',
          square ? 'aspect-square w-40' : 'aspect-video w-full',
        )}
      >
        {artwork ? (
          <img
            src={artwork}
            alt={session.title ? `Artwork for ${session.title}` : 'Album artwork'}
            loading="lazy"
            decoding="async"
            onError={onArtError}
            className="size-full object-cover"
          />
        ) : (
          // A session with no artwork is common enough to design for rather than leave
          // as an empty box: the app's own icon stands in.
          <div className="grid size-full place-items-center p-6">
            {app ? (
              <AppIcon iconUrl={app.icon_url} name={app.name} alt="" className="max-w-24" />
            ) : (
              <Tv aria-hidden className="text-muted-foreground size-10" />
            )}
          </div>
        )}
      </div>

      <div className="flex w-full min-w-0 flex-col items-center gap-1 text-center">
        <h2 className="w-full truncate text-base font-semibold">
          {session.title ?? appName ?? 'Playing'}
        </h2>
        {lines.length > 0 && (
          <p className="text-muted-foreground w-full truncate text-sm">{lines.join(' · ')}</p>
        )}
        <p className="text-muted-foreground/80 flex h-4 items-center gap-1.5 text-[0.6875rem]">
          {session.player_state === 'BUFFERING' ? 'Buffering…' : (appName ?? '')}
        </p>
      </div>

      {/* Progress. */}
      <div className="flex w-full flex-col gap-1">
        {seekable ? (
          <input
            type="range"
            min={0}
            max={duration}
            step={1}
            value={Math.min(shown, duration)}
            disabled={disabled}
            aria-label="Seek"
            aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}`}
            onChange={(event) => onScrub(Number(event.target.value))}
            onPointerUp={() => scrub !== null && onSend('seek', scrub)}
            onKeyUp={() => scrub !== null && onSend('seek', scrub)}
            className="accent-foreground h-1.5 w-full cursor-pointer disabled:cursor-not-allowed"
          />
        ) : measured ? (
          <div
            role="progressbar"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={duration ?? 0}
            aria-valuenow={Math.floor(shown)}
            aria-valuetext={formatTime(shown)}
            className="bg-secondary h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-foreground/70 h-full rounded-full transition-[width] duration-500 ease-linear"
              style={{ width: `${Math.min(100, (shown / duration!) * 100)}%` }}
            />
          </div>
        ) : null}
        <div className="text-muted-foreground flex justify-between text-[0.6875rem] tabular-nums">
          <span>{formatTime(shown)}</span>
          <span>{measured ? formatTime(duration) : 'Live'}</span>
        </div>
      </div>

      {/* Transport. Play/pause is disabled rather than hidden when the session refuses it,
          so the row keeps its shape and the reason is available as a tooltip. */}
      <div className="grid w-full grid-cols-3 gap-2">
        <Key label="Previous track" disabled={disabled} onClick={() => onSend('previous')} className="h-12">
          <SkipBack aria-hidden className="size-5" />
        </Key>
        <Key
          label={
            !session.can_pause
              ? 'This app does not allow pausing'
              : playing
                ? 'Pause'
                : 'Play'
          }
          // Only a usable play/pause reads as the lit key; a refused one is a dead key.
          tone={session.can_pause ? 'accent' : 'default'}
          disabled={disabled || !session.can_pause}
          onClick={() => onSend('play_pause')}
          className="h-12"
        >
          {playing ? (
            <Pause aria-hidden className="size-5 fill-current" />
          ) : (
            <Play aria-hidden className="size-5 fill-current" />
          )}
        </Key>
        <Key label="Next track" disabled={disabled} onClick={() => onSend('next')} className="h-12">
          <SkipForward aria-hidden className="size-5" />
        </Key>
      </div>
    </>
  )
}

/**
 * The ordinary state: no Cast media session, so the television is identified by the app it
 * is showing. This is what the surface looks like most of the time — the remote protocol
 * carries no media metadata and Cast only publishes a session for content cast from a
 * phone or browser — so it is written as a finished state, not as an empty one.
 *
 * @param props.device - The television, for its name and power state.
 * @param props.appName - The resolved foreground app name, or null when nothing is open.
 * @param props.app - The catalog entry behind that name, for its icon.
 */
function AppIdentityView({
  device,
  appName,
  app,
}: {
  device: Device
  appName: string | null
  app: AppDescriptor | undefined
}) {
  const off = device.state.is_on === false
  const status = device.state.cast?.status_text ?? null

  return (
    <div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
      <div className="w-24">
        {app ? (
          <AppIcon iconUrl={app.icon_url} name={app.name} alt="" size={128} className="shadow-lg" />
        ) : (
          <span
            aria-hidden
            className="bg-secondary text-muted-foreground grid aspect-square w-full place-items-center rounded-2xl"
          >
            <Tv className="size-10" />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {off ? `${device.name} is off` : (appName ?? 'Nothing playing')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {status ?? (off
            ? 'Turn it on from the power key to see what it is showing.'
            : appName !== null
              ? `Open on ${device.name}`
              : `${device.name} is on its home screen.`)}
        </p>
      </div>

      <p className="text-muted-foreground/70 max-w-64 text-xs">
        Titles, artwork, and a progress bar appear here for anything cast from a phone or
        browser. Apps opened on the television itself do not publish them.
      </p>
    </div>
  )
}
