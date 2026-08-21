# Stream: Reworked web remote UI

**Worktree:** `.claude/worktrees/web` — branch `stream-web`. Work ONLY in there.

## Goal
Replace the dead CRA app with a genuinely good, fully reactive remote UI: the thing the
operator actually reaches for instead of hunting for the physical remote.

## Read first
- `docs/design/api-contract.md` — every endpoint and WebSocket frame. Frozen.
- `web/src/lib/api-types.ts` — the TypeScript mirror of that contract. **Frozen — import it,
  don't edit it.** It is already complete, so you can build the whole UI without a running
  backend.
- `docs/design/conventions.md` — TS/CSS header format (`/** */` block)
- `TvKeys.txt` — the key names the backend will accept
- The scaffold is already in place and builds: Vite 8, React 19, TypeScript 6, Tailwind 4,
  shadcn/ui configured (`components.json`, `new-york`, zinc, `@/` alias), lucide icons,
  react-router. `npm run build` passes today — keep it passing.

## Design research — do this before writing components
Invoke the **`ui-ux-pro-max`** skill and the **Mobbin** MCP tools (`search_screens`,
`search_flows`, `search_sections`) and study how real remote/TV-control and connected-device
apps are built: the Google TV app, Apple TV Remote, Roku, SmartThings, Sonos. Pull specifics
— D-pad geometry and hit targets, how they handle the touchpad/D-pad toggle, device
switchers, connection status, keyboard entry. Write what you decide and why into
`docs/design/ui.md` before you build, then build to it. Do not skip this step and do not
produce a generic dashboard: this is a physical-feeling control surface, not a CRUD admin.

## Files to touch
Everything under `web/` **except `web/src/embed/**`** (owned by the embed stream) and
`web/src/lib/api-types.ts` (frozen). Add `docs/design/ui.md`.

## Requirements

### Data layer
- One `useRemoteSocket()` hook owning the `/api/ws` connection: applies the `snapshot`
  frame, then the deltas, into a single store. Auto-reconnect with backoff.
  **The UI must never poll.**
- A thin typed `apiClient` for REST, reading the optional token from localStorage /
  `?token=`, and surfacing the contract's `error.code` values as usable messages.
- Optimistic feedback on key presses (the TV's own state echo confirms or corrects).

### Surfaces (all four were explicitly requested)
1. **D-pad + transport** — up/down/left/right/OK, back, home, play/pause, prev/next,
   volume ±, mute, power. Big touch targets, press-and-hold repeat, haptic
   (`navigator.vibrate`) where available, and full keyboard control on desktop (arrow keys,
   Enter, Escape, media keys) with a visible focus ring.
2. **Touchpad** — a swipe surface that maps gestures to D-pad keys and tap to OK, like the
   Google TV app. Toggle between D-pad and touchpad; remember the choice.
3. **Text input** — send text to the focused field on the TV via `POST .../text`. Make this
   excellent; it is the single biggest win over a physical remote. Include a paste button
   and a send-on-enter field.
4. **App launcher** — tiles firing `POST .../launch` from `GET /api/apps`, with the live
   `current_app` highlighted.

### Device management
- Dashboard of registered devices with live connection state (`connected`, `unreachable`,
  `unpaired`, …), power state, and current app.
- Add a device: pick from discovered devices (`GET /api/discovery`, refresh via
  `POST /api/discovery/scan`) or type an IP.
- **Pairing flow that does not lose people**: start pairing, explain that a code appears on
  the TV, a 6-character code input, clear error states, and a visible retry. Drive it off
  the `pairing` WebSocket frames. When a device reports `unpaired` because auth was revoked,
  show an actionable "re-pair" prompt.
- Rename, edit host, enable/disable, remove.
- Settings page: token, theme, and a banner stating plainly whether auth is on.

### Quality bar
- **Reactive, mobile-first.** The phone layout is the primary one — thumb-reachable
  controls, safe-area insets, no page scroll while using the D-pad. Then tablet and desktop.
- Dark and light, following system preference with a manual override.
- Accessible: real buttons, `aria-label` on every icon-only control, visible focus, and
  `aria-live` for connection/pairing status changes. Do not ship a div-with-onClick D-pad.
- Fast: no layout shift on state updates, no spinner flashes on sub-200ms transitions.

## Acceptance criteria
- [ ] `npm run build` in `web/` passes (`tsc -b` + `vite build`), zero TS errors.
- [ ] `npx oxlint` is clean.
- [ ] Every one of the four surfaces above works against the contract types.
- [ ] Keyboard-only operation of the D-pad works on desktop.
- [ ] `docs/design/ui.md` records the researched design direction and the reasoning.
- [ ] Headers per conventions.md on every new file.
- [ ] Verify visually before claiming done: run `npm run dev` and drive it with the
      Playwright or chrome-devtools MCP tools at both a 390px-wide mobile viewport and a
      desktop one. Screenshot both. A backend is not required — stub the socket/API layer
      behind a dev flag if you need to, but do not leave the stub wired in by default.

## Out of scope
`web/src/embed/**`, anything under `server/`, `tray/`, or `docker/`, and editing
`web/src/lib/api-types.ts`.
