<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Developer and user documentation for the Android TV Remote desktop tray app. Covers the
prerequisites for each platform, how to run it in development and produce release bundles
for macOS and Windows, how the Rust shell and the webview divide responsibility, what the
app expects from the appliance it connects to, and what an unsigned build looks like on
first launch — including the exact steps a user needs to get past Gatekeeper and
SmartScreen.
-->

# Android TV Remote — desktop tray app

A menubar (macOS) and notification-area (Windows) remote for the Android TV Remote
appliance. Clicking the tray icon opens a borderless, always-on-top panel anchored to the
icon. It stays open as a persistent overlay widget — rather than a popover that vanishes on
focus loss — until you dismiss it yourself: the panel's own close (X) button, `Esc`, or
clicking the tray icon again.

The app is a **client**. It does not talk to TVs directly — it drives the appliance over the
REST and WebSocket contract in [`docs/design/api-contract.md`](../docs/design/api-contract.md),
exactly as the web UI does. The appliance has to be running somewhere on your LAN first.

## What it does

- Tray icon whose colour reports connection health at a glance: green when every enabled
  device is connected, amber when some are not, grey when the appliance itself is
  unreachable.
- Tray menu with **Show Remote**, a submenu of quick actions (power toggle, mute) per
  device, **Settings…**, and **Quit**.
- Remote panel: device switcher, power, D-pad with OK/back/home, transport, volume with
  mute, and text entry that types into the TV's focused field.
- Live device state over `/api/ws`, with exponential backoff, jitter, and a ping/pong
  watchdog so a sleeping laptop reconnects rather than sitting on a dead socket.
- Optional global hotkey to summon or dismiss the panel. **Off by default** — set it in
  Settings.
- Follows the OS light/dark setting, with native vibrancy on macOS and Mica (falling back to
  acrylic) on Windows.
- Keyboard-operable throughout: arrows drive the D-pad, `Enter` selects, `Backspace` goes
  back, `h` goes home, `space` plays/pauses, `+`/`-` change volume, `m` mutes, `Esc` hides
  the panel.

## First run

There is no configuration file to edit. On first launch the panel opens on the setup screen
and asks for:

| Field | Meaning |
|---|---|
| **Appliance URL** | Where the appliance is, e.g. `http://192.168.1.10:7433`. A bare `host:port` is accepted and gets `http://` prepended. |
| **API token** | Only needed if the appliance was started with `REMOTE_API_TOKEN`. Leave empty otherwise. |
| **Global hotkey** | Optional. Click the field and press a combination; `Esc` cancels. |

**Test connection** probes `/healthz` *and* an authenticated `/api/devices` call, because
`/healthz` is never authenticated — passing it alone would not prove the token is right.
Settings are stored via the Tauri store plugin in the platform's app-data directory.

Pairing a TV is not done here. Register and pair devices in the web UI or over MCP; the tray
app drives devices that are already paired.

## Prerequisites

Both platforms need [Node.js](https://nodejs.org/) 20+ and a
[Rust](https://www.rust-lang.org/tools/install) toolchain (1.77.2 or newer).

**macOS** — Xcode Command Line Tools:

```sh
xcode-select --install
```

**Windows** — the [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
with the "Desktop development with C++" workload, and
[WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (already present on
Windows 11 and up-to-date Windows 10; the installer this build produces will fetch it if it
is missing).

**Linux** — supported for development and for proving the build, not as a target; see
[Platform notes](#platform-notes). It needs the WebKitGTK and app-indicator development
packages:

```sh
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  build-essential curl wget file libssl-dev libxdo-dev libglib2.0-dev
```

## Development

```sh
cd tray
npm install
npm run tauri dev
```

The webview dev server runs on port **7435** (the web SPA uses 7434, so both can run at
once). Unlike the SPA there is no dev proxy — the tray app calls whatever appliance URL you
configure, cross-origin, so the appliance must send permissive CORS headers or be reached
through a same-origin deployment.

You can also run just the webview in a normal browser with `npm run dev`, which is useful for
working on the UI. Outside a Tauri window `isTauri()` is false, so settings fall back to
in-memory storage and the tray, hotkey, and window commands are skipped.

## Building

```sh
npm run tauri build
```

Tauri builds **for the host platform only** — there is no cross-compilation for macOS or
Windows from another OS. Run the command on each target machine, or in CI:

| Host | Artifacts under `src-tauri/target/release/bundle/` |
|---|---|
| macOS | `dmg/*.dmg` and `macos/*.app` (universal binaries need `--target universal-apple-darwin`) |
| Windows | `nsis/*-setup.exe` and `msi/*.msi` |
| Linux | `deb/*.deb`, `rpm/*.rpm`, `appimage/*.AppImage` |

### Code signing

**Deliberately not configured.** No Apple Developer ID, no notarization, no Windows
Authenticode certificate. This is what a user sees as a result, and how to get past it:

**macOS** — the app is quarantined on download and Gatekeeper refuses it with *"Android TV
Remote" is damaged and can't be opened* or *cannot be opened because the developer cannot be
verified*. Either right-click the app in Finder and choose **Open**, then **Open** again in
the dialog, or clear the quarantine attribute:

```sh
xattr -dr com.apple.quarantine "/Applications/Android TV Remote.app"
```

Building locally and running the result from `target/release/bundle/macos/` avoids this
entirely — the quarantine flag is only applied to downloaded files.

**Windows** — SmartScreen shows *Windows protected your PC*. Click **More info** →
**Run anyway**. Unsigned installers may also be flagged by some antivirus products.

Signing both platforms is a matter of adding the certificate details under `bundle.macOS`
and `bundle.windows` in `tauri.conf.json`; it was left out because it needs paid developer
accounts and secrets that do not belong in this repository.

## Platform notes

- **Clicking the tray icon does not work on Linux.** Tauri does not emit tray icon click
  events there (the tray is an app-indicator, which only supports a menu). Use the tray
  menu's **Show Remote** item or the global hotkey. macOS and Windows both get click-to-open.
- **Vibrancy and Mica are macOS/Windows only.** On Linux the panel falls back to a blurred
  translucent surface drawn in CSS.
- **Mica requires Windows 11.** On Windows 10 the app falls back to acrylic, and on builds
  older than 1903 to the plain CSS surface.
- On macOS the app runs with the `Accessory` activation policy: no Dock icon, no app menu,
  which is what a tray-resident app should do.

## How it is put together

```
tray/
  src/                    webview (Vite + React + TypeScript + Tailwind v4)
    lib/api-types.ts      copy of the frozen contract types from web/src/lib
    lib/api.ts            REST client
    lib/ws.ts             /api/ws connection with backoff and a ping/pong watchdog
    lib/settings.ts       Tauri store persistence and global-hotkey registration
    lib/useAppliance.ts   state: devices, health, selection, tray sync
    components/           the remote surface and the settings screen
  src-tauri/              Rust shell
    src/tray.rs           procedural tray icon and the context menu
    src/lib.rs            window anchoring, effects, commands
```

The division is deliberate: **all HTTP and WebSocket traffic lives in the webview.** The Rust
side never talks to the appliance. The webview pushes a compact device summary to the
`sync_tray` command, which recolours the icon and rebuilds the menu; when a per-device menu
item is clicked, Rust emits a `tray-action` event back to the webview, which issues the REST
call. That keeps one API client, one token, and one source of device state.

The tray icon is drawn pixel by pixel in `tray.rs` rather than shipped as three near-identical
PNGs, so the health colours have a single definition.

## Verification

From `tray/`:

```sh
npm run build            # tsc -b + vite build
cd src-tauri && cargo check --all-targets && cargo test
```

`cargo test` covers the tray icon's geometry and the tooltip's device counting. The panel's
contract behaviour — that each control issues the request the contract specifies — was
verified by driving the UI against a stub appliance; see the report accompanying this work
for what was and was not observed on each platform.
