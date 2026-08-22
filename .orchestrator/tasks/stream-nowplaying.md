# Stream: Now-playing UI and real launcher icons

**Worktree:** `.claude/worktrees/nowplaying` — branch `stream-nowplaying`. Work ONLY there.

## Goal
A now-playing surface showing artwork, title and a live progress bar with scrubbing, plus
an app launcher that shows real app icons instead of coloured letter tiles.

## Read first
- `docs/design/api-contract.md` — `NowPlaying`, `CastInfo`, the Media and Icons sections
- `web/src/lib/api-types.ts` — already extended with `NowPlaying`, `CastInfo`,
  `MediaAction`, `MediaControlRequest`, `AppDescriptor.icon_url`. **FROZEN — import, never edit.**
- `web/src/components/AppLauncher.tsx` — currently renders a coloured letter tile and says
  so in its header comment; that is what you are replacing
- `web/src/state/store.ts`, `web/src/state/useRemoteSocket.ts` — existing live-state plumbing
- `docs/design/ui.md` — the design direction already researched for this app
- `docs/design/conventions.md` — TS/CSS header format (`/** */`)

## The constraint that shapes this whole task
**`state.now_playing` is null far more often than not, and that is normal, not an error.**

Verified against the operator's real TVs: the Android TV remote protocol carries no media
metadata at all, and Cast publishes its media namespace only for content *cast from a phone
or browser*. All four of their active TVs were playing native apps and reported no media
session. `state.cast.display_name` ("Netflix", "Spotify") was populated; `now_playing` was
not.

So the **primary** visual state is "app identity, no media metadata", and the rich artwork
view is the bonus. Design it that way round. A now-playing card that looks broken or empty
whenever nothing is casting would be a worse UI than what exists today.

## Files to touch
Everything under `web/src/components/**`, `web/src/routes/**`, `web/src/state/**`,
`web/src/lib/**` EXCEPT `api-types.ts`, plus `web/src/dev/mockBackend.ts`.

**Do NOT touch** `web/vite.config.ts`, `web/index.html`, `web/public/**` or
`web/src/embed/**` — the PWA stream owns the first three and the embed remote owns the last.

## Requirements

### Now-playing
- Show artwork from `now_playing.images` (largest first) with a graceful load and a
  sensible aspect-ratio box. Handle an empty `images` array during playback — it happens.
- Title, subtitle, season/episode or artist/album as appropriate to the content.
- **Live progress bar extrapolated locally**, not polled: compute
  `position + (now - position_at)` while `player_state === 'PLAYING'`, and stop advancing
  when paused. Re-sync whenever a new `device.state` event arrives.
- Scrubbing via `POST /api/devices/{id}/media {action:'seek', position}`, and transport
  buttons for play/pause/next/previous. **Respect `can_pause` and `can_seek`** — hide or
  disable rather than showing controls that will 409.
- When `now_playing` is null: fall back to app identity — `cast.display_name` if present,
  otherwise the catalogue name for `current_app`, otherwise the raw package. Make this a
  deliberate, good-looking state.
- Consider using artwork as a blurred backdrop; make sure text contrast survives it in both
  themes.

### Launcher icons
- Render `AppDescriptor.icon_url` (`/api/icons/{package}`). Keep the existing coloured tile
  strictly as the `onError` fallback so a failed fetch degrades instead of leaving a gap.
- Lazy-load, set explicit dimensions to avoid layout shift, and add `alt` text.
- Highlight the live `current_app` / `cast.app_id` tile as it does today.

## Acceptance criteria
- [ ] `npm run build` in `web/` passes and `npx oxlint` is clean.
- [ ] Extend `web/src/dev/mockBackend.ts` with BOTH cases — a device mid-playback with
      artwork and one with `now_playing: null` — so the empty path is exercised, not assumed.
- [ ] Verify visually with the Playwright or chrome-devtools MCP tools at a 390px mobile
      viewport and a desktop one, screenshotting BOTH the playing and the null states.
      "It compiles" is not evidence.
- [ ] The progress bar visibly advances without any network traffic between state events.
- [ ] Headers per conventions.md.

## Out of scope
Anything under `server/`, `tray/`, `web/src/embed/`, `web/public/`, `web/index.html`,
`web/vite.config.ts`. Do not edit `web/src/lib/api-types.ts`.
