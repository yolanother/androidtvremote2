/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Pure media helpers for the Android TV Remote web UI's now-playing surface. Extrapolates
 * the playhead locally from the Cast session's `position`/`position_at` pair so the
 * progress bar advances between `device.state` frames without polling the appliance, and
 * formats a duration as a clock reading, an episode as a season/episode label, and the
 * media session's identity line. Kept free of React so the maths can be exercised by
 * `media.check.mjs` without a browser or a test framework.
 */
import type { AppDescriptor, DeviceState, NowPlaying } from './api-types'

/**
 * Clamp a playhead into the track.
 *
 * @param seconds - Raw playhead position.
 * @param duration - Track length, or null when the session did not report one.
 * @returns The position, never negative and never past the end.
 */
function clamp(seconds: number, duration: number | null): number {
  if (seconds < 0) return 0
  if (duration !== null && seconds > duration) return duration
  return seconds
}

/**
 * Extrapolate the playhead for a media session at a given wall-clock instant.
 *
 * While the session is `PLAYING` this is `position + (now - position_at)`, which is why
 * the contract carries `position_at` at all: a client can animate the progress bar with
 * zero network traffic and re-sync whenever a new `device.state` frame arrives. Any other
 * player state holds the reported position still.
 *
 * A negative elapsed time means the appliance's clock reads ahead of the browser's, so it
 * is treated as zero rather than winding the playhead backwards; the bar then resumes
 * advancing once the browser clock passes the sample instant.
 *
 * @param np - The live media session.
 * @param now - Milliseconds since the epoch, i.e. `Date.now()`.
 * @returns The playhead in seconds, clamped to `[0, duration]`.
 */
export function playheadAt(np: NowPlaying, now: number): number {
  const base = np.position ?? 0
  if (np.player_state !== 'PLAYING' || np.position_at === null) return clamp(base, np.duration)
  const sampledAt = Date.parse(np.position_at)
  if (Number.isNaN(sampledAt)) return clamp(base, np.duration)
  const elapsed = (now - sampledAt) / 1000
  return clamp(base + Math.max(elapsed, 0), np.duration)
}

/**
 * Format a number of seconds as a clock reading, dropping the hours field when it is zero.
 *
 * @param seconds - A position or duration; null and negative values render as a dash-free
 *                  zero reading so the layout never changes width mid-playback.
 * @returns `m:ss`, or `h:mm:ss` for anything an hour or longer.
 */
export function formatTime(seconds: number | null): string {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

/**
 * Build the season/episode label for episodic content.
 *
 * @param season - Season number, or null.
 * @param episode - Episode number, or null.
 * @returns `S4 · E1`, `Season 4`, `Episode 1`, or null when neither is known.
 */
export function episodeLabel(season: number | null, episode: number | null): string | null {
  if (season !== null && episode !== null) return `S${season} · E${episode}`
  if (season !== null) return `Season ${season}`
  if (episode !== null) return `Episode ${episode}`
  return null
}

/**
 * The value `current_app` carries when the television is being driven by its own remote
 * rather than by a Cast sender. It is a sentinel, not a package, and must never be shown.
 */
const NATIVE_APP_SENTINEL = 'AndroidNativeApp'

/**
 * Resolve what the television is showing when there is no media session to describe — the
 * common case, because the remote protocol carries no metadata and Cast only publishes a
 * media session for content cast from a phone or browser.
 *
 * The catalog entry is matched on the reported package first, then on the Cast receiver's
 * display name, because a television driven by its own remote reports the
 * `AndroidNativeApp` sentinel as its package while Cast still names the app ("Netflix").
 *
 * @param state - The device's live state.
 * @param apps - The appliance's app catalog, used to turn a package into a readable name
 *               and to find the icon that goes with it.
 * @returns The app's display name and the catalog entry behind it, either of which may be
 *          null/undefined when the television is idle or running something unrecognised.
 */
export function foregroundApp(
  state: DeviceState,
  apps: AppDescriptor[],
): { name: string | null; app: AppDescriptor | undefined } {
  const pkg = state.current_app === NATIVE_APP_SENTINEL ? null : state.current_app
  const castName = state.cast?.display_name ?? null
  const app =
    apps.find((a) => a.package !== null && a.package === pkg) ??
    (castName === null
      ? undefined
      : apps.find((a) => a.name.toLowerCase() === castName.toLowerCase()))
  return { name: castName ?? app?.name ?? pkg, app }
}
