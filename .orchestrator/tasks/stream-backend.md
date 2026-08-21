# Stream: FastAPI backend core

**Worktree:** `.claude/worktrees/backend` — branch `stream-backend`. Work ONLY in there.

## Goal
Replace the dead Flask app with a FastAPI service that holds durable, self-healing
connections to Android TVs and exposes the full REST + WebSocket contract.

## Why
The current build does not work. `src/api/routes.py` writes a single shared
`cert.pem`/`key.pem` to the process CWD (never mounted as a volume), keys devices by IP,
never calls the library's `keep_reconnecting()`, and blocks a request thread for 3 seconds
doing mDNS. Fixing those four things IS this task.

## Read first
- `docs/design/architecture.md` — topology, identity model, SQLite-on-NFS constraints
- `docs/design/api-contract.md` — the frozen contract; implement it exactly
- `docs/design/conventions.md` — file header format (Python needs a `#` block, NOT a docstring)
- `src/androidtvremote2/androidtv_remote.py` — the vendored library. **DO NOT MODIFY IT.**
  Note `keep_reconnecting()` (line 281), `async_get_name_and_mac()` (line 301), and the
  four `add_*_updated_callback` registration methods.
- `TvKeys.txt` and `src/androidtvremote2/remotemessage.proto` (~line 90) — key catalog source
- `src/api/routes.py` — the old implementation, for reference only. It is being deleted.

## Files to touch
Everything under `server/app/` EXCEPT `server/app/mcp_server.py` (owned by the MCP stream),
plus `server/tests/`. Specifically:
- `server/app/main.py` — app factory, lifespan, middleware, static SPA mount, exception handlers
- `server/app/deps.py` — `get_device_manager()` and the auth dependency
- `server/app/auth.py` — optional bearer token (header OR `?token=`; the query form exists
  because `<iframe src>` and the `WebSocket` constructor cannot set headers)
- `server/app/storage.py` — SQLite device registry
- `server/app/devices.py` — `DeviceManager`
- `server/app/discovery.py` — background async mDNS browser
- `server/app/events.py` — in-process pub/sub event bus
- `server/app/keys.py` — key catalog
- `server/app/apps.py` — app deep-link catalog
- `server/app/routers/{devices,discovery,catalog,ws}.py`
- `server/tests/**`

**Frozen — do not edit:** `server/app/{config,models,errors}.py`, `docs/design/*`,
`web/src/lib/api-types.ts`.

## Requirements

### Identity and durability (the actual bug fix)
- Register a device by connecting to `host` and calling `async_get_name_and_mac()`. The
  `device_id` is that MAC, lowercased, colons stripped. Never key on IP.
- Per-device certs at `settings.cert_paths(device_id)` — under the mounted `DATA_DIR`.
  Create parent dirs. Nothing may ever be written to the process CWD.
- When the mDNS browser sees a known MAC at a new address, update `host` in place and
  reconnect. Pairing must survive it.

### Connection lifetime
- One `AndroidTVRemote` per enabled+paired device, held for the process lifetime.
- Call `keep_reconnecting(invalid_auth_callback=...)` exactly once per device. The callback
  flips the device to `connection: "unpaired"` with an actionable error so the UI can
  prompt a re-pair instead of retrying forever.
- Register all four `*_updated` callbacks and push every change onto the event bus.
- Control commands use the held connection. They must never open one ad-hoc.

### Storage
- SQLite at `settings.database_path`. **`journal_mode=TRUNCATE`, `synchronous=FULL`** —
  `/volumes` is NFS and WAL will corrupt there. Leave a comment saying so.
- Run all sqlite calls off the event loop (`asyncio.to_thread` or a lock + thread executor).
- Schema migration on startup: create tables if absent, and import any existing
  `src/api/paired_tvs.json` as unpaired devices so the operator's one known TV
  (192.168.1.23 "BRAVIA 4K GB") shows up ready to pair.

### Discovery
- `AsyncZeroconf` browser for `_androidtvremote2._tcp.local.`, started in the app lifespan,
  running continuously. `GET /api/discovery` returns the cache instantly — no sleeping in a
  request handler, ever.
- Mark entries `registered`/`device_id` by matching against the registry.
- Honour `DISCOVERY_ENABLED=false` by not starting the browser at all.

### Power and volume semantics
- `set_power(on=True/False)` is idempotent: read `is_on`, send `KEYCODE_POWER` only if the
  state differs. `on=None` toggles unconditionally. This is what makes it safe for Home
  Assistant to retry.
- `set_volume(level=N)` steps up/down from the reported level to reach N.

### WebSocket
- `/api/ws` sends a full `snapshot` frame on connect, then deltas.
- Per-client bounded queue. **Drop a slow client rather than letting it apply backpressure
  to the device callbacks** — a stalled browser tab must not wedge the TV connections.

### HTTP surface
- Every endpoint in the contract, with the exact paths, bodies, and status codes.
- An exception handler mapping `RemoteError` -> `err.status` + `err.to_dict()`.
- `GET /healthz`, unauthenticated.
- CORS from `settings.cors_origin_list`.
- CSP `frame-ancestors <settings.frame_ancestors>` on HTML responses, so the embed view can
  be framed by home panels.
- Mount the built SPA (`web/dist`) at `/` with an SPA fallback, but ONLY if the directory
  exists — the dev workflow runs Vite separately and the server must start without it.
- OpenAPI at `/api/docs`, with real summaries and examples. Home automation users read this.

## Acceptance criteria
- [ ] `python -m pytest server/tests -q` passes from the worktree root.
- [ ] Tests cover, with the network faked: MAC-derived identity; per-device cert paths;
      registry survives a manager restart; an IP change preserves pairing; idempotent power;
      absolute volume stepping; the error-code mapping table; slow-WS-client eviction.
- [ ] `cd server && python -c "from app.main import create_app; create_app()"` succeeds.
- [ ] Server starts with `DATA_DIR` pointed at a temp dir and `/healthz` returns 200.
- [ ] No file in `server/app/` writes to the CWD.
- [ ] Every file has the `#`-block header from conventions.md.

## Out of scope
- `server/app/mcp_server.py` (MCP stream), anything under `web/` or `tray/`, the Dockerfile
  (container stream), and deleting the old `src/app.py` / `src/api/` (the integrator does
  that at final merge — leave them alone so the other streams' worktrees stay consistent).
