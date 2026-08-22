# Stream: Installable PWA

**Worktree:** `.claude/worktrees/pwa` — branch `stream-pwa`. Work ONLY in there.

## Goal
Make the remote installable to an Android home screen as a PWA, with an in-app install
button, so it launches full-screen with no browser chrome — like a native remote.

## Why this fits
A TV remote is close to the ideal PWA: launched constantly, wants full screen and a home
screen icon, needs zero cold-start friction, and is used on a phone in the same room. The
operator asked specifically for the Android install button.

## Read first
- `docs/design/architecture.md` — the appliance serves the SPA at `/` on port 7433
- `web/vite.config.ts` — TWO entries already exist (`index.html` and `embed.html`); do not
  break the embed entry
- `web/index.html`, `web/public/icon.svg` — the current head and the only icon that exists
- `docs/design/ui.md` — the app's design direction, for the icon and theme colour
- `docs/design/conventions.md` — TS/CSS header format (`/** */`)

## Files to touch
- `web/index.html` — manifest link, theme-color, apple-touch-icon meta
- `web/public/**` — `manifest.webmanifest` and generated icon PNGs (192/512, maskable)
- `web/vite.config.ts` — PWA plugin or manual service-worker wiring
- `web/src/pwa/**` — the install-prompt hook and button component (you own this directory)
- `web/package.json` — any new dependency
- `docs/pwa.md`

**Do NOT touch** `web/src/components/**`, `web/src/routes/**`, `web/src/state/**`,
`web/src/lib/**` or `web/src/embed/**` — other streams own those and are working in
parallel. Export your install button from `web/src/pwa/` and tell me in your report where
it should be mounted; I will wire the one-line import at integration.

## Requirements
- **`vite-plugin-pwa`** is the sane choice unless you find a concrete reason otherwise.
  Whatever you choose must keep BOTH Vite entries building — `/` and `/embed`.
- `manifest.webmanifest`: name, short_name ("Remote"), `display: standalone`,
  `start_url: /`, `scope: /`, theme and background colours matching the app's dark surface,
  `orientation: portrait-primary`, and icons at 192 and 512 including a **maskable** variant
  (without one, Android renders a white box behind the icon).
- **Install button**: capture `beforeinstallprompt`, hide the button when the app is already
  installed or the event never fires, and call `prompt()` on click. Handle the user
  dismissing it. Put it somewhere discoverable but not nagging — Settings is a good home,
  with an optional dismissible hint elsewhere.
- **iOS has no `beforeinstallprompt`.** Detect iOS Safari and show short "Share → Add to
  Home Screen" instructions instead of a dead button. Android is the priority, but a
  non-functioning button on iPhone is worse than none.
- **Service worker caching must not break the appliance.** Precache the app shell, but
  `/api/**`, `/api/ws` and `/healthz` must ALWAYS go to the network — never serve a cached
  device list or a stale state snapshot. Get this wrong and the remote shows phantom
  devices. Be explicit in your config and test it.
- Handle updates: when a new service worker is waiting, prompt to reload rather than
  stranding the user on a stale build indefinitely.
- **The `/embed` route must NOT be caught by the PWA scope or precache** — it is embedded in
  other people's pages and must stay a plain, always-fresh document.
- The appliance is usually served over plain **HTTP on a LAN IP**, not HTTPS. Service
  workers only run on secure contexts, and `http://192.168.x.x` is NOT one. Determine and
  document exactly what the operator will experience at `http://192.168.1.209:7433` — this
  is the single most important thing to get right and report honestly. If installability
  requires HTTPS or a hostname, say so plainly and document the practical options.
- `docs/pwa.md`: how to install on Android, what iOS users do instead, the HTTPS/secure-
  context situation in plain terms, and how to clear the service worker when debugging.

## Acceptance criteria
- [ ] `npm run build` in `web/` passes; BOTH `dist/index.html` and `dist/embed.html` are
      still produced. `npx oxlint` clean.
- [ ] Verify with the Playwright or chrome-devtools MCP tools against the running appliance:
      manifest parses, the service worker registers (or you have documented exactly why it
      cannot over plain HTTP), and an `/api/devices` request goes to the network rather
      than the cache.
- [ ] Run a Lighthouse installability check if the chrome-devtools MCP tools expose one,
      and report what it says.
- [ ] Screenshot the install button.
- [ ] Headers per conventions.md.

## Out of scope
Anything under `server/`, `tray/`, or the other streams' `web/src` directories.
