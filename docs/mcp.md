<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Operator guide to the Android TV Remote appliance's MCP server: how to point Claude Code,
Claude Desktop, or any other MCP client at the /mcp streamable-HTTP endpoint, how to pass
the optional bearer token, the complete catalog of tools and resources an agent gets, a
worked transcript of an agent pairing a new television end to end, and the troubleshooting
notes for the failure modes this endpoint actually produces.
-->

# MCP server

The appliance exposes an [MCP](https://modelcontextprotocol.io) server so that an LLM
agent can discover televisions on the network, register and pair with them, and then drive
them — without a human touching a remote, other than to read the pairing code off the
screen once.

It is served over **streamable HTTP** at `/mcp`, on the same port as the web UI and the
REST API. There is no separate process and no stdio wrapper to install.

| | |
|---|---|
| URL | `http://<appliance-host>:7433/mcp` |
| Transport | streamable HTTP |
| Server name | `androidtv-remote` |
| Auth | none, or the same bearer token as `/api` (see below) |

## Adding it to a client

### Claude Code

```bash
claude mcp add --transport http androidtv http://192.168.1.10:7433/mcp
```

With a token configured on the appliance:

```bash
claude mcp add --transport http androidtv http://192.168.1.10:7433/mcp \
  --header "Authorization: Bearer $REMOTE_API_TOKEN"
```

Check it connected:

```bash
claude mcp list
```

### Claude Desktop

Add an entry to `claude_desktop_config.json` and restart the app:

```json
{
  "mcpServers": {
    "androidtv": {
      "type": "http",
      "url": "http://192.168.1.10:7433/mcp",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

Drop the `headers` block entirely when `REMOTE_API_TOKEN` is not set.

### Anything else

Any MCP client that speaks streamable HTTP works. Point it at the same URL. Clients that
cannot set headers may pass the token as a query parameter instead:

```text
http://192.168.1.10:7433/mcp?token=your-token-here
```

### Checking the endpoint by hand

```bash
curl -s -X POST http://192.168.1.10:7433/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"curl","version":"1"}}}'
```

A working endpoint replies with an SSE frame containing the server's capabilities and the
name `androidtv-remote`. With a token configured and none supplied, it replies `401` with
`{"error":{"code":"unauthorized", ...}}`.

## Authentication

MCP uses exactly the same rule as the REST API, described in
[design/architecture.md](design/architecture.md):

- `REMOTE_API_TOKEN` unset (the default) — no authentication. Fine on a trusted LAN, and
  it is what makes a zero-configuration `docker compose up` produce a working appliance.
- `REMOTE_API_TOKEN` set — every request to `/mcp` must carry
  `Authorization: Bearer <token>` **or** `?token=<token>`. Anything else gets `401`.

```bash
# docker-compose.yml, or the .env beside it
REMOTE_API_TOKEN=a-long-random-string
```

`/healthz` is never authenticated, so a health check keeps working either way.

## Tools

Every tool returns a JSON object. **Tools never raise.** A failure comes back as a normal
result containing an error envelope, so an agent can read the code and recover:

```json
{ "error": { "code": "not_paired", "message": "Device aabbccddeeff has no certificate" } }
```

The codes are the ones in [design/api-contract.md](design/api-contract.md):
`device_not_found`, `device_exists`, `not_paired`, `pairing_not_started`,
`invalid_pairing_code`, `unreachable`, `invalid_key`, `unauthorized`, `internal_error`,
plus `invalid_request` for arguments this layer rejects before they reach a television.

### Discovery and registration

| Tool | Arguments | Returns |
|---|---|---|
| `list_devices` | — | `{"devices": [Device], "count": int}` |
| `discover_devices` | `rescan?: bool` | `{"devices": [DiscoveredDevice], "count": int}` |
| `register_device` | `host: str`, `name?: str` | `{"device": Device}` |
| `rename_device` | `device_id: str`, `name: str` | `{"device": Device}` |
| `remove_device` | `device_id: str` | `{"removed": true, "device_id": str}` |

`discover_devices` reads a continuously-maintained mDNS cache and returns instantly;
`rescan: true` forces a fresh sweep first. `remove_device` deletes the pairing certificate
too and cannot be undone.

### Pairing

| Tool | Arguments | Returns |
|---|---|---|
| `pair_device` | `device_id: str` | `{"status": "code_required", "device_id": str, "instructions": str}` |
| `complete_pairing` | `device_id: str`, `code: str` | `{"device": Device}` |
| `unpair_device` | `device_id: str` | `{"device": Device}` |

Pairing is **human-in-the-loop by construction**. `pair_device` makes the television
display a six-character code; the agent cannot see it. The tool's description and its
`instructions` field both tell the agent to stop and ask a person to read the code aloud.
The code expires after about 120 seconds — calling `pair_device` again displays a fresh
one.

`unpair_device` revokes the certificate but keeps the device registered, which is what you
want when a pairing has gone stale. `remove_device` forgets everything.

### Control

| Tool | Arguments | Returns |
|---|---|---|
| `get_device_state` | `device_id: str` | `{"device_id": str, "state": DeviceState}` |
| `send_key` | `device_id: str`, `key: str`, `repeat?: int` | `{"sent": str, "repeat": int, "device_id": str}` |
| `send_keys` | `device_id: str`, `keys: string[]` | `{"sent": [str], "device_id": str}` |
| `send_text` | `device_id: str`, `text: str` | `{"sent": str, "device_id": str}` |
| `launch_app` | `device_id: str`, `app: str` | `{"launched": str, "device_id": str}` |
| `set_power` | `device_id: str`, `on: bool` | `{"device_id": str, "state": DeviceState}` |
| `set_volume` | `device_id: str`, `action?: str`, `level?: int` | `{"device_id": str, "state": DeviceState}` |

`send_keys` sends a sequence in order with a short pause between presses, so an agent can
express a whole navigation macro in one call — `["HOME", "DPAD_DOWN", "DPAD_DOWN",
"DPAD_CENTER"]`. If a press fails partway, the error envelope's `details` carry `sent` and
`failed_at` so the agent knows where the TV's focus actually stopped.

`set_power` is idempotent: it reads the current state and only sends the power key when it
differs, so an agent (or Home Assistant) can call it repeatedly without flipping the TV
off. `set_volume` takes exactly one of `action` (`up`, `down`, `mute`, `unmute`,
`toggle_mute`) or `level` (absolute).

### Catalog

| Tool | Arguments | Returns |
|---|---|---|
| `list_keys` | `category?: str` | `{"keys": [KeyDescriptor], "count": int}` |
| `list_apps` | — | `{"apps": [AppDescriptor], "count": int}` |

Key categories are `navigation`, `transport`, `volume`, `power`, `channel`, `input`,
`numeric`, and `system`. `send_key` accepts either the short name (`DPAD_UP`) or the full
Android keycode (`KEYCODE_DPAD_UP`).

## Resources

For clients that prefer reading context over calling tools:

| URI | Content |
|---|---|
| `androidtv://devices` | `Device[]` |
| `androidtv://devices/{device_id}` | `Device` |
| `androidtv://keys` | `KeyDescriptor[]` |
| `androidtv://apps` | `AppDescriptor[]` |

All four are `application/json`. They carry the same data as the corresponding tools.

## Worked example — pairing a new television

What the conversation looks like end to end. The agent's tool calls are shown with the
essential parts of each response.

**User:** "Add the TV in the living room and put Netflix on."

**1. See what is already known.**

```text
list_devices()
-> {"devices": [], "count": 0}
```

**2. Find it on the network.**

```text
discover_devices()
-> {"devices": [{"mdns_name": "BRAVIA 4K GB._androidtvremote2._tcp.local.",
                 "display_name": "BRAVIA 4K GB",
                 "host": "192.168.1.23",
                 "registered": false, "device_id": null}], "count": 1}
```

If discovery comes back empty, ask the user for the TV's IP address and skip to step 3 —
`register_device` only needs an address.

**3. Register it.** This derives the permanent `device_id` from the TV's MAC address.

```text
register_device(host="192.168.1.23", name="Living Room TV")
-> {"device": {"id": "aabbccddeeff", "name": "Living Room TV",
               "host": "192.168.1.23", "paired": false, ...}}
```

Note `"paired": false`. Commands will fail with `not_paired` until pairing completes.

**4. Start pairing.** The television now shows a code.

```text
pair_device(device_id="aabbccddeeff")
-> {"status": "code_required", "device_id": "aabbccddeeff",
    "instructions": "The television is now showing a 6-character pairing code on its
     screen. You cannot see that screen. Ask the person you are talking to to look at
     the TV and read the code back to you, then call complete_pairing with this
     device_id and the code they give you. ..."}
```

**5. The agent stops and asks the human.**

> **Agent:** Your TV should now be showing a six-character pairing code. What does it say?
>
> **User:** It's 4KJ7QW.

**6. Finish pairing.**

```text
complete_pairing(device_id="aabbccddeeff", code="4KJ7QW")
-> {"device": {"id": "aabbccddeeff", "paired": true,
               "state": {"connection": "connected", "is_on": true, ...}}}
```

The certificate is written to `$DATA_DIR/certs/aabbccddeeff/` on the mounted volume, so
this pairing survives container rebuilds, restarts, and the TV getting a new IP address.
If the TV rejects the code, `complete_pairing` returns `invalid_pairing_code` — digits and
letters are easy to mishear, so ask again and retry. If the session timed out, it returns
`pairing_not_started` and the agent calls `pair_device` again for a fresh code.

**7. Now control it.**

```text
set_power(device_id="aabbccddeeff", on=true)
-> {"state": {"is_on": true, ...}}

list_apps()
-> {"apps": [{"id": "netflix", "name": "Netflix", "launch": "com.netflix.ninja", ...}]}

launch_app(device_id="aabbccddeeff", app="com.netflix.ninja")
-> {"launched": "com.netflix.ninja", "device_id": "aabbccddeeff"}
```

Pairing is a one-time cost. Every later session starts at `list_devices`, gets the
`device_id` back with `"paired": true`, and goes straight to controlling the TV.

## Troubleshooting

**The client cannot connect at all.** Confirm the appliance is up and the port is right:

```bash
curl -s http://192.168.1.10:7433/healthz
```

`/healthz` is never authenticated, so a reply here proves the container is running and
only the MCP URL or the token is at fault.

**Every call returns `401 unauthorized`.** `REMOTE_API_TOKEN` is set on the appliance and
the client is not sending it, or is sending a different value. Re-add the server with the
`Authorization` header, or append `?token=` to the URL.

**Commands return `not_paired`.** The device is registered but has no certificate. Run
`pair_device` and `complete_pairing`. This also happens after a TV is factory-reset or the
user removes this client from the TV's paired-device list — the appliance notices and
flips the device to `connection: "unpaired"`, and the fix is to pair again.

**Commands return `unreachable`.** The TV is off the network or unplugged from mains. Most
Android TVs stay reachable with the screen off; one with no power cannot be woken over the
network by this appliance.

**`discover_devices` always returns an empty list.** mDNS is link-local multicast and does
not cross a Docker bridge network. The container must run with `network_mode: host` (see
[design/architecture.md](design/architecture.md)). On Docker Desktop, host networking is
not available and discovery degrades to nothing — set `DISCOVERY_ENABLED=false` to make
that explicit, and register televisions by IP address instead.

**`invalid_key`.** The key name is not in the catalog. Call `list_keys` rather than
guessing; both `DPAD_UP` and `KEYCODE_DPAD_UP` are accepted, but nothing else is.

## Mounting it from the server (for developers)

The MCP app lives in [`server/app/mcp_server.py`](../server/app/mcp_server.py) and is
attached to the FastAPI application with a single call inside the application factory:

```python
from .mcp_server import mount_mcp

mount_mcp(app, manager)
```

`mount_mcp` deliberately does more than a plain `app.mount("/mcp", ...)`, because two
things would otherwise break at runtime:

- Starlette's `Mount("/mcp")` compiles to `^/mcp/(?P<path>.*)$`, which does **not** match
  `/mcp` itself — the router answers `307` to `/mcp/`, and the MCP Python client does not
  follow redirects. Both spellings are registered so the documented URL works.
- A mounted sub-application never receives ASGI lifespan events, so the streamable-HTTP
  session manager would never start and the first request would fail with "Task group is
  not initialized". Its lifespan is chained onto the host application's.

`build_mcp_app(manager, token=None) -> Starlette` is the raw factory underneath, and
`build_mcp_server(manager) -> MCPServer` is the transport-free core that the test suite
drives directly. Wiring either of those by hand means taking on the lifespan chaining
yourself.
