# Stream: Desktop tray remote (Tauri v2)

**Worktree:** `.claude/worktrees/tray` — branch `stream-tray`. Work ONLY in there.

**Priority: lowest.** The container, backend, MCP, and web UI all matter more. Build this
well, but do not block on anything from the other streams.

## Goal
A macOS and Windows notification-tray app that opens a nicely styled remote window on click,
so the TV is controllable without finding a browser tab.

## Read first
- `docs/design/api-contract.md` — the contract. Frozen.
- `web/src/lib/api-types.ts` — the TypeScript mirror. Frozen; import or copy it.
- `docs/design/architecture.md` — the appliance is a LAN service; the tray app is a client
- `docs/design/conventions.md` — header format per language

## Files to touch
`tray/**` only. Nothing outside it.

## Requirements
- **Tauri v2.** `tray/` holds the frontend (Vite + React + TS + Tailwind, mirroring `web/`'s
  setup) and `tray/src-tauri/` the Rust shell.
- **Tray icon** with a menu: Show Remote, per-device quick actions (power toggle, mute),
  Settings, Quit. The icon reflects connection health at a glance.
- **Click the tray icon -> a borderless, rounded, always-on-top remote panel** anchored near
  the tray icon, that hides on focus loss. Not a full window with a title bar — this should
  feel like a native menubar popover on macOS and a flyout on Windows.
- **Global hotkey** to summon/dismiss it, configurable, off by default.
- **Server connection**: a settings screen taking the appliance URL (default
  `http://localhost:7433`) and the optional token, persisted via the Tauri store plugin.
  Show connection status honestly and offer a retry. First-run should walk the user through
  pointing at their server.
- **Remote surfaces**: D-pad + OK, back, home, transport, volume, power, and a device
  switcher. Text input if it fits the panel; the app launcher is optional at this size.
- Live state over `/api/ws`, same reconnect-with-backoff behaviour as the web UI.
- Native-feeling styling per platform: vibrancy/blur on macOS, Mica/acrylic where available
  on Windows, dark and light following the OS.
- Keyboard-operable throughout; arrow keys drive the D-pad while the panel has focus.

## Build and packaging
- `tray/README.md` covering prerequisites (Rust, platform SDKs), `npm run tauri dev`, and
  `npm run tauri build` for both targets.
- A GitHub Actions workflow building macOS and Windows artifacts is welcome but optional.
- Do not set up code signing or notarization — out of scope, but note in the README what a
  user will see on first launch without it, and how to get past it on each OS.

## Acceptance criteria
- [ ] `npm run build` in `tray/` passes (`tsc -b` + `vite build`).
- [ ] `cargo check` succeeds in `tray/src-tauri`.
- [ ] `npm run tauri build` succeeds on this Linux host (proving the project is coherent);
      note explicitly in your report that mac/Windows binaries were NOT produced here and
      remain unverified on those platforms. Do not claim cross-platform success you did not
      observe.
- [ ] The remote UI renders and its controls issue the correct contract requests — verify
      against a stubbed server if the real one is not up, and say which you used.
- [ ] Headers per conventions.md.

## Out of scope
Anything outside `tray/`. Do not edit the shared contract files.
