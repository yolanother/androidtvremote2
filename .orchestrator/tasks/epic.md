# Epic: Rebuild Android TV Remote as a home-automation appliance

## Goal
Turn this dead CRA+Flask project into a containerized, LAN-hosted Android TV remote
appliance: durable pairing, a complete REST API, an MCP server for agents, a reworked
reactive web UI, an embeddable iframe view, and a desktop tray remote.

## Why now
The app does not function. Root causes found during recon:
1. `AndroidTVRemote(name, 'cert.pem', 'key.pem', ip)` writes certs to the process CWD,
   uses ONE shared cert for every TV, and `docker-compose.yml` declares a
   `paired_tvs_data` volume it never mounts. Any restart destroys pairing.
2. `keep_reconnecting()` exists in the library and is never called. Connections are
   opened ad-hoc per keypress and dropped.
3. Devices are keyed by IP, so a DHCP lease change silently orphans a pairing.
4. Flask + a background asyncio loop marshals every call across a thread boundary.
5. mDNS discovery does a blocking `time.sleep(3)` in a request handler and cannot
   see anything from a bridge-network container.
6. `react-scripts@5` + React 19 + MUI + a stray Tailwind postcss config does not build.

## Decisions (confirmed with operator)
- Backend: FastAPI rewrite. Library `src/androidtvremote2` stays untouched.
- Frontend: Vite + React + TypeScript + Tailwind + shadcn/ui.
- Deployment: ONE container, `network_mode: host`, port 7433, serving SPA + /api + /mcp.
- Storage: SQLite + per-device certs at `/volumes/androidtvremote` (NFS-backed volume).
- Auth: optional bearer token via `REMOTE_API_TOKEN`, disabled by default.
- Device identity: MAC address (via `async_get_name_and_mac`), NOT IP.
- Tray app: Tauri v2, lowest priority.
- UI surfaces: D-pad + transport, text/IME input, app launcher deep links, touchpad.

## Done looks like
- `docker compose up -d` on the host serves a working remote at :7433.
- Pairing survives container rebuild, restart, and a DHCP IP change.
- `/api/docs` documents every endpoint; Home Assistant can drive a TV over REST.
- An agent can discover, register, pair, and control a TV entirely through MCP.
- `/embed?device=<id>` renders a compact remote usable in an iframe on a home panel.
- A Tauri tray app opens a styled remote window on macOS and Windows.
