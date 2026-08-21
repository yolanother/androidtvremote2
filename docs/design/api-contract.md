# Android TV Remote — API Contract

<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Frozen interface contract for the Android TV Remote appliance: defines every REST
endpoint, the WebSocket event stream, the MCP tool and resource surface, the shared
Pydantic/TypeScript data models, the error envelope, and the internal DeviceManager
facade that all consumers code against. Parallel workstreams (backend, MCP, web UI,
embed view, tray app) are all written against THIS document, so changes here are
breaking changes that must be coordinated across every stream.
-->

> **This contract is frozen.** Backend, MCP, web UI, embed view, and tray app are built
> in parallel against it. If a stream needs a change, it goes back through the epic —
> it does not get made unilaterally.

## Conventions

- Base path `/api`. JSON in, JSON out.
- `device_id` is the TV's MAC address, lowercased, colons stripped: `aabbccddeeff`.
- Timestamps are RFC 3339 UTC strings.
- Auth: when `REMOTE_API_TOKEN` is set, send `Authorization: Bearer <token>` or
  `?token=<token>`. Otherwise send nothing.

### Error envelope

Every non-2xx response:

```json
{ "error": { "code": "device_not_found", "message": "No device with id aabbccddeeff" } }
```

| `code` | HTTP | Meaning |
|---|---|---|
| `device_not_found` | 404 | Unknown `device_id` |
| `device_exists` | 409 | MAC already registered |
| `not_paired` | 409 | Command sent to a device that has no cert |
| `pairing_not_started` | 409 | `pair/complete` before `pair` |
| `invalid_pairing_code` | 400 | TV rejected the code |
| `unreachable` | 503 | TV did not answer |
| `invalid_key` | 400 | Key not in the catalog |
| `invalid_request` | 400 | Malformed request body — see note below |
| `unauthorized` | 401 | Missing/wrong token |
| `internal_error` | 500 | Anything else |


FastAPI's default validation failure is a 422 whose body shape is entirely different from
this envelope, which would break any client parsing `error.code`. The app therefore catches
request-validation errors and re-renders them as `400 invalid_request` in the envelope
above, with the field-level detail under `error.details`. Clients only ever need to parse
one error shape.

## Models

### `Device`

```json
{
  "id": "aabbccddeeff",
  "name": "Living Room TV",
  "host": "192.168.1.23",
  "mac": "aa:bb:cc:dd:ee:ff",
  "mdns_name": "BRAVIA 4K GB._androidtvremote2._tcp.local.",
  "model": "BRAVIA 4K GB",
  "paired": true,
  "enabled": true,
  "created_at": "2026-08-21T18:04:00Z",
  "state": { "...": "DeviceState" }
}
```

### `DeviceState`

```json
{
  "connection": "connected",
  "is_on": true,
  "current_app": "com.netflix.ninja",
  "volume": { "level": 12, "max": 100, "muted": false },
  "last_seen": "2026-08-21T18:04:02Z",
  "error": null
}
```

`connection` is one of: `connected`, `connecting`, `disconnected`, `unreachable`,
`unpaired`, `disabled`. `is_on`, `current_app`, and `volume` are `null` until the TV
reports them. `error` carries a human-readable reason when `connection` is `unreachable`
or `unpaired`.

### `DiscoveredDevice`

```json
{
  "mdns_name": "SHIELD._androidtvremote2._tcp.local.",
  "display_name": "SHIELD",
  "addresses": ["192.168.1.140"],
  "host": "192.168.1.140",
  "registered": false,
  "device_id": null,
  "last_seen": "2026-08-21T18:03:55Z"
}
```

`addresses` keeps every resolved address; `host` is the preferred IPv4. `registered` is
true when a device with this MAC is already in the registry, and `device_id` points at it.

### `KeyDescriptor`

```json
{ "key": "DPAD_UP", "keycode": "KEYCODE_DPAD_UP", "label": "Up", "category": "navigation" }
```

Categories: `navigation`, `transport`, `volume`, `power`, `channel`, `input`, `numeric`,
`system`.

### `AppDescriptor`

```json
{
  "id": "netflix",
  "name": "Netflix",
  "package": "com.netflix.ninja",
  "deep_link": "https://www.netflix.com/title/",
  "launch": "com.netflix.ninja",
  "icon": "netflix"
}
```

`launch` is what gets passed to `send_launch_app_command` — either a package id or a URL.

## REST endpoints

### Devices

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/devices` | — | `Device[]` |
| `POST` | `/api/devices` | `{ "host": "192.168.1.23", "name": "Living Room TV" }` | `Device` 201 |
| `GET` | `/api/devices/{id}` | — | `Device` |
| `PATCH` | `/api/devices/{id}` | `{ "name"?, "host"?, "enabled"? }` | `Device` |
| `DELETE` | `/api/devices/{id}` | — | 204, certs deleted |

`POST /api/devices` connects to `host` and calls `async_get_name_and_mac()` to derive the
identity before writing a row. If the MAC is already registered it returns `409
device_exists` with the existing device in `error.details.device`. `name` defaults to the
name the TV reports.

### Pairing

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/devices/{id}/pair` | — | `{ "status": "code_required" }` |
| `POST` | `/api/devices/{id}/pair/complete` | `{ "code": "123456" }` | `Device` |
| `DELETE` | `/api/devices/{id}/pair` | — | `Device` (`paired: false`, certs deleted) |

`POST .../pair` generates the per-device keypair if missing and starts the pairing
handshake; the TV displays a 6-character code. A pairing session that is not completed
within 120 s is torn down and the device returns to `unpaired`.

### Control

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/devices/{id}/keys` | `{ "key": "DPAD_UP", "direction": "SHORT", "repeat": 1 }` | 202 |
| `POST` | `/api/devices/{id}/text` | `{ "text": "stranger things" }` | 202 |
| `POST` | `/api/devices/{id}/launch` | `{ "app": "com.netflix.ninja" }` | 202 |
| `POST` | `/api/devices/{id}/power` | `{ "on": true }` | `DeviceState` |
| `POST` | `/api/devices/{id}/volume` | `{ "action": "up" }` or `{ "level": 20 }` | `DeviceState` |
| `POST` | `/api/devices/{id}/connect` | — | `DeviceState` |
| `POST` | `/api/devices/{id}/disconnect` | — | `DeviceState` |
| `GET` | `/api/devices/{id}/state` | — | `DeviceState` |

- `key` accepts either the short form (`DPAD_UP`) or the full keycode (`KEYCODE_DPAD_UP`).
- `direction` is `SHORT` (default), `START_LONG`, or `END_LONG`.
- `repeat` is 1–10; used for volume ramps and fast scrolling.
- `power` is **idempotent**: it reads `is_on` and only sends `KEYCODE_POWER` when the
  current state differs from the request. This is what makes it safe for Home Assistant
  to call repeatedly. `{"on": null}` toggles unconditionally.
- `volume.action` is `up`, `down`, `mute`, `unmute`, or `toggle_mute`. `level` sets an
  absolute level by issuing the appropriate number of up/down steps from the reported
  level.

### Discovery

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/discovery` | `DiscoveredDevice[]` — current cache, returns immediately |
| `POST` | `/api/discovery/scan` | 202 — kicks an async rescan; results arrive over `/api/ws` |

`GET /api/discovery` never blocks. The old build's `time.sleep(3)` inside a request
handler is gone; the browser runs continuously in the background.

### Catalog

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/keys` | `KeyDescriptor[]` |
| `GET` | `/api/apps` | `AppDescriptor[]` |

### Health

`GET /healthz` → `{ "status": "ok", "devices": 3, "connected": 2, "version": "..." }`.
Never authenticated.

## WebSocket — `/api/ws`

Connect with `?token=` when auth is enabled. On connect the server immediately sends a
snapshot, then streams deltas. All frames are JSON objects with a `type`.

```json
{ "type": "snapshot",       "devices": [ Device ], "discovered": [ DiscoveredDevice ] }
{ "type": "device.added",   "device": Device }
{ "type": "device.updated", "device": Device }
{ "type": "device.removed", "device_id": "aabbccddeeff" }
{ "type": "device.state",   "device_id": "aabbccddeeff", "state": DeviceState }
{ "type": "discovery",      "devices": [ DiscoveredDevice ] }
{ "type": "pairing",        "device_id": "aabbccddeeff",
  "status": "code_required" | "paired" | "failed" | "timeout", "error": null }
```

Client→server frames: `{"type":"ping"}` → server replies `{"type":"pong"}`. Nothing else
is accepted; control goes over REST so it has real status codes.

## MCP — `/mcp` (streamable HTTP)

Server name `androidtv-remote`. Same token as the REST API.

### Tools

| Tool | Args | Notes |
|---|---|---|
| `list_devices` | — | Registered devices with live state |
| `discover_devices` | `rescan?: bool` | TVs seen on the network |
| `register_device` | `host`, `name?` | Adds by IP; returns the device |
| `pair_device` | `device_id` | Starts pairing; response tells the agent to ask the human for the on-screen code |
| `complete_pairing` | `device_id`, `code` | Finishes pairing |
| `unpair_device` | `device_id` | Deletes certs, keeps the registration |
| `remove_device` | `device_id` | Deletes everything |
| `rename_device` | `device_id`, `name` | |
| `get_device_state` | `device_id` | |
| `send_key` | `device_id`, `key`, `repeat?` | |
| `send_keys` | `device_id`, `keys: string[]` | Sequence, for macros like "open Netflix and go down 3" |
| `send_text` | `device_id`, `text` | Types into the focused field |
| `launch_app` | `device_id`, `app` | Package id or deep-link URL |
| `set_power` | `device_id`, `on: bool` | Idempotent |
| `set_volume` | `device_id`, `action?`, `level?` | |
| `list_keys` | `category?` | Key catalog |
| `list_apps` | — | App catalog |

Every tool returns a JSON object. Errors return `{"error": {"code","message"}}` rather
than raising, so the agent can recover and retry.

**Pairing is a two-step human-in-the-loop flow.** `pair_device` must return text that
explicitly instructs the agent to ask the user to read the code shown on the TV, because
an agent cannot see the screen.

### Resources

| URI | Content |
|---|---|
| `androidtv://devices` | `Device[]` |
| `androidtv://devices/{device_id}` | `Device` |
| `androidtv://keys` | `KeyDescriptor[]` |
| `androidtv://apps` | `AppDescriptor[]` |

## Internal facade — `DeviceManager`

Every surface (REST router, MCP tool, WebSocket) goes through this one object. It is
created at app startup and reachable as `request.app.state.devices`, or via
`server.app.deps.get_device_manager()`.

```python
class DeviceManager:
    async def start(self) -> None: ...
    async def stop(self) -> None: ...

    def list_devices(self) -> list[Device]: ...
    def get_device(self, device_id: str) -> Device: ...          # raises DeviceNotFound
    async def add_device(self, host: str, name: str | None = None) -> Device: ...
    async def update_device(self, device_id: str, *, name: str | None = None,
                            host: str | None = None,
                            enabled: bool | None = None) -> Device: ...
    async def remove_device(self, device_id: str) -> None: ...

    async def start_pairing(self, device_id: str) -> None: ...
    async def finish_pairing(self, device_id: str, code: str) -> Device: ...
    async def unpair(self, device_id: str) -> Device: ...

    async def connect(self, device_id: str) -> DeviceState: ...
    async def disconnect(self, device_id: str) -> DeviceState: ...
    def get_state(self, device_id: str) -> DeviceState: ...

    async def send_key(self, device_id: str, key: str,
                       direction: str = "SHORT", repeat: int = 1) -> None: ...
    async def send_text(self, device_id: str, text: str) -> None: ...
    async def launch_app(self, device_id: str, app: str) -> None: ...
    async def set_power(self, device_id: str, on: bool | None) -> DeviceState: ...
    async def set_volume(self, device_id: str, action: str | None = None,
                         level: int | None = None) -> DeviceState: ...

    def list_discovered(self) -> list[DiscoveredDevice]: ...
    async def rescan(self) -> None: ...

    def subscribe(self) -> AsyncIterator[Event]: ...             # EventBus fan-out
```

Exceptions in `server/app/errors.py`, each mapping to one `error.code` above:
`DeviceNotFound`, `DeviceExists`, `NotPaired`, `PairingNotStarted`, `InvalidPairingCode`,
`Unreachable`, `InvalidKey`.

## Shared TypeScript types

`web/src/lib/api-types.ts` mirrors the models above and is the single source of truth for
the SPA, the embed view, and the tray app. It is hand-written to match this document —
not generated — so that the embed and tray streams do not have to wait on a running
backend to compile.
