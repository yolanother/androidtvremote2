# Android TV Remote — Architecture

<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Architecture reference for the Android TV Remote appliance: describes the single-container
topology, the process layout inside it, the on-disk data layout under the NFS-backed
/volumes mount, device identity and pairing durability guarantees, network/mDNS
constraints, and the configuration surface. This is the document that explains WHY the
system is shaped the way it is; the endpoint-by-endpoint contract lives in
api-contract.md.
-->

## What this is

A LAN-hosted appliance that pairs with and controls Android TV / Google TV devices over
the Android TV Remote protocol v2. It exposes four consumer surfaces over one HTTP port:

| Surface | Path | Consumer |
|---|---|---|
| Web remote (SPA) | `/` | Humans, phones, tablets |
| Embed remote | `/embed` | Home panels, internal sites, via `<iframe>` |
| REST API + OpenAPI | `/api`, `/api/docs` | Home Assistant, scripts, home automation |
| MCP (streamable HTTP) | `/mcp` | LLM agents |

Plus a Tauri desktop tray app that opens the web remote in a styled native window.

## Topology

ONE container. `network_mode: host`. Port **7433**.

```
                      host network (192.168.1.0/24)
                                  |
              +-------------------+-------------------+
              |        androidtv-remote container      |
              |                                        |
              |  uvicorn :7433                         |
              |    +-- StaticFiles      -> /           SPA build
              |    +-- APIRouter        -> /api/*      REST
              |    +-- WebSocket        -> /api/ws     live state
              |    +-- FastMCP (ASGI)   -> /mcp        agent control
              |                                        |
              |  DeviceManager (asyncio)               |
              |    +-- one AndroidTVRemote per device  |
              |    +-- keep_reconnecting() per device  |
              |    +-- AsyncZeroconf mDNS browser      |
              +-------------------+--------------------+
                                  |
                     /volumes/androidtvremote (NFS)
```

### Why one container

The previous two-container split (Flask API + nginx SPA) bought nothing and cost a CORS
configuration, a cross-origin iframe, and a second image to rebuild. Same-origin means
the SPA, the embed view, and the WebSocket all just work.

### Why host networking

mDNS/DNS-SD (`_androidtvremote2._tcp.local.`) is link-local multicast. It does not cross
a Docker bridge. On a bridge network the discovery browser returns an empty list forever,
which is exactly what the old build did. Host mode is Linux-only; on Docker
Desktop the container still runs, discovery degrades to nothing, and devices are added by
typing an IP. `DISCOVERY_ENABLED=false` makes that degradation explicit rather than a
silent empty list.

## Device identity — the durability fix

The old build keyed devices by IP address and wrote a single shared `cert.pem`/`key.pem`
to the process working directory. Three independent bugs fell out of that, and together
they are the entire reason pairing was "constantly lost":

1. **Certs were ephemeral.** The declared `paired_tvs_data` volume was never mounted, so
   the certs lived in the container's writable layer. Rebuild or restart, pairing gone.
2. **One cert for every TV.** Pairing a second TV overwrote the first TV's identity.
3. **IP was the primary key.** A DHCP lease change orphaned the pairing even when the
   cert survived.

The rebuild fixes all three:

- **Primary key is the MAC address**, obtained from `AndroidTVRemote.async_get_name_and_mac()`
  during registration. `device_id` is the MAC lowercased with colons stripped
  (`aabbccddeeff`). It is stable across reboots, DHCP renewals, and renames.
- **`host` is a mutable attribute, not an identity.** The mDNS browser continuously
  re-resolves addresses; when a known MAC appears at a new IP, `DeviceManager` updates
  `host` in place and reconnects. Pairing is untouched.
- **Certs are per-device and live on the mounted volume** at
  `$DATA_DIR/certs/<device_id>/{cert.pem,key.pem}`. Nothing is written to CWD, ever.

## Connection lifetime

`AndroidTVRemote.keep_reconnecting()` already exists in the vendored library and the old
build never called it. `DeviceManager` holds exactly one `AndroidTVRemote` instance per
enabled+paired device for the lifetime of the process, calls `keep_reconnecting()` once,
and registers the four `*_updated` callbacks to feed the event bus. Commands never open
connections; they use the held one. A TV that is off or unplugged simply reports
`connection: "unreachable"` and the library's own backoff handles recovery.

`keep_reconnecting(invalid_auth_callback=...)` is wired so that a revoked pairing (the TV
was factory-reset, or the user removed the client) flips the device to
`connection: "unpaired"` and surfaces in the UI as an actionable "re-pair" prompt instead
of an infinite silent retry.

## Data layout

`DATA_DIR` defaults to `/volumes/androidtvremote`.

```
/volumes/androidtvremote/
  devices.db                       SQLite: devices, settings
  certs/
    aabbccddeeff/
      cert.pem
      key.pem
```

### SQLite on NFS

`/volumes` is an NFS mount. SQLite's WAL journal mode requires shared-memory mmap and
does **not** work over NFS. The connection is opened with `journal_mode=TRUNCATE` and
`synchronous=FULL`. There is exactly one writer process, so this is safe; it is slower
than WAL, and at this write volume (a handful of rows, changed when a device is
registered or renamed) that is irrelevant.

Do not "optimize" this back to WAL. It will appear to work and then corrupt on a lock
contention event.

## Event flow

```
AndroidTVRemote callback  ->  DeviceManager  ->  EventBus  ->  fan-out
  is_on_updated                                                  |
  current_app_updated                                            +-> /api/ws clients
  volume_info_updated                                            +-> internal subscribers
  is_available_updated
```

`EventBus` is an in-process pub/sub over `asyncio.Queue`. Each WebSocket client gets its
own bounded queue; a slow client is dropped rather than allowed to apply backpressure to
the device callbacks. On connect, a client receives a full snapshot of every device
before the incremental stream begins, so the UI never has to poll.

## Configuration

Every knob is an environment variable. There is no config file.

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `/volumes/androidtvremote` | SQLite + cert storage root |
| `PORT` | `7433` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `REMOTE_API_TOKEN` | *(unset)* | If set, `/api` + `/mcp` require this bearer token |
| `CLIENT_NAME` | `Android TV Remote` | Name shown on the TV during pairing |
| `DISCOVERY_ENABLED` | `true` | Run the mDNS browser |
| `DISCOVERY_INTERVAL` | `60` | Seconds between full rescans |
| `FRAME_ANCESTORS` | `*` | CSP `frame-ancestors` for the `/embed` view |
| `LOG_LEVEL` | `info` | Uvicorn/app log level |
| `CORS_ORIGINS` | `*` | Allowed origins for `/api` |

## Auth

Optional by design: a fresh `docker compose up` must produce a working remote with zero
configuration, because that is the actual home-lab use case.

When `REMOTE_API_TOKEN` is set, every `/api/*` and `/mcp` request must carry it as
`Authorization: Bearer <token>` **or** `?token=<token>`. The query-param form exists
because an `<iframe src>` and a browser `WebSocket` constructor cannot set headers.
`/healthz` and the SPA static assets are always unauthenticated.

When it is unset, no check runs and a banner in the settings UI says so.

## Repository layout

```
server/            FastAPI app, DeviceManager, MCP server        (Python)
web/               Vite + React + TS + Tailwind + shadcn SPA     (TypeScript)
tray/              Tauri v2 desktop tray remote                  (Rust + TS)
src/androidtvremote2/   Vendored protocol library — DO NOT MODIFY (Python)
docker/            Dockerfile + entrypoint
docs/design/       This document and the API contract
```

`src/androidtvremote2` is the upstream protocol library. It is correct, it is the one
part of this repo that works, and it stays byte-identical so upstream changes can be
merged. All new backend code lives in `server/` and imports it.
