# Optional TV launcher providers

<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the repository root.

Operator and adapter-author reference for Android TV Remote's optional network providers.
Explains discovery, explicit endpoint configuration, canonical TV identity, capabilities,
live-state behavior, network requirements and the version-one HTTP/WebSocket extension.
-->

The public appliance can integrate a compatible launcher or media server without
bundling that server's proprietary APIs. With no provider, pairing, keys, text,
app links, power, volume and Google Cast continue to work normally.

The selected-TV action bar includes the provider's profile picker. Controls,
Apps, Guide (when available) and Playing share one compact icon row; only the
selected destination expands its name. The icon-width control-mode picker at the
right selects D-pad, Touchpad or Text and remembers that choice when returning
to Controls. D-pad and Touchpad fit the remaining viewport without scrolling,
including short landscape screens. Apps and Guide scroll inside their content
pane while the action bar, navigation and core keys stay in place. Text entry
keeps its own scroll area so fields and recent entries remain reachable. Destination
labels collapse and expand together using the same spring motion as list expansion,
profile artwork and programme details. Reduced-motion preferences remove that travel
and width animation; commands are always submitted immediately.

Apps show six available entries initially, ranked by the TV's recent foreground
session counts when supplied. Entries sharing an Android package are combined,
preferring a launchable service entry. View more opens the full inventory, including
unavailable entries, and View less restores the shortlist. Missing provider logos use
the appliance's existing `/api/icons/{package}` endpoint, which supplies cached app
artwork or a readable fallback. Usage belongs to the TV, shared across its profiles.
Without usage metadata the shortlist is labelled available apps, rather than claiming
to know which apps are frequently used. Profile photos fall back to colored initials.

The guide uses a compact time grid on phones and larger screens. The service rail and
time ruler stay visible within its contained scrolling area, starting at the current
half-hour so the current title stays readable near the end of an hour. Artwork, service colors,
the now marker and programme progress aid scanning. Selecting a programme opens details
without controlling playback. Tune remains an explicit action for its channel's current
available title; future programme details only offer the provider's title actions.

## Connecting a provider

On a multicast-capable LAN, a provider advertises `_atvr-provider._tcp.local.`
with TXT `version=1`, `path=/atvr/v1` and a stable `id`. The appliance discovers
it, validates its manifest and automatically associates its devices with paired,
enabled TVs using their canonical IDs. No browser multicast or cross-origin calls
are required. Multiple conflicting providers remain unresolved rather than
being chosen arbitrarily.

The provider publisher must actually share the LAN multicast network. A Docker
bridge, VPN or VLAN boundary can prevent mDNS from reaching the appliance even
when ordinary HTTPS works. Publish from the host network or configure an explicit
endpoint on the remote appliance:

```dotenv
PROVIDER_URLS=http://media-provider.local:8302/atvr/v1
PROVIDER_TIMEOUT=5
PROVIDER_POLL_INTERVAL=15
```

`PROVIDER_URLS` accepts comma-separated HTTP(S) base URLs with the exact
`/atvr/v1` path. Both compose stacks pass these settings to the API. Empty URLs
leave automatic discovery enabled when `DISCOVERY_ENABLED=true`. Explicit URLs
also work when discovery is disabled. Restart the API after environment changes.

The initial client supports providers with open internal APIs; it has no outbound
provider credential configuration. The appliance's own API token is never sent
to providers. URL credentials and redirects are refused. Requests have a total
deadline and a 2 MiB response limit. Providers return data and typed actions,
never downloaded code or UI modules.

## TV identity and launcher reporting

The existing remote service supplies the TV identity. During registration the
appliance reads the Android TV Remote Service's TLS certificate on port 6467 and
normalizes its MAC value: `AA:BB:CC:DD:EE:FF` becomes `aabbccddeeff`. A launcher
adapter should obtain the same certificate identity and return it to the launcher
at registration, rather than choosing an unrelated installation ID. Reading the
service certificate requires a client certificate even before PIN pairing.

The adapter maintains installed apps, active profile/filter, timezone and
capabilities per TV. Resume history must stay separate from observed playback.
The launcher should publish media observations on changes and heartbeat them;
after 30 seconds without a fresh observation, playback becomes unknown. Native
Android MediaSession access may need notification-listener approval on the TV;
the UI must still work without that access or when a player exposes no session.

Provider commands require the TV to remain paired and enabled. A fresh,
foreground-compatible provider session can supply playback; otherwise the UI
falls back to Cast or app identity. Accepting a launch/tune command never proves
that the title is playing. Commands carry UUIDs and expected profile/session
context; adapters must deduplicate and expire pending work instead of replaying
it after reconnect or a profile change.

## API surface

| Appliance endpoint | Purpose |
|---|---|
| `GET /api/providers` | Discovered/configured provider status |
| `PATCH /api/providers/{id}` with `{enabled}` | Persist provider enablement |
| `GET /api/devices/{id}/integrations` | Selected-TV provider and capabilities |
| `GET /api/devices/{id}/catalog` | Installed/launchable apps and services |
| `GET /api/devices/{id}/browse` | Search or continue-watching cards |
| `GET /api/devices/{id}/titles/{title_id}` | Available title actions |
| `GET /api/devices/{id}/profiles` | Current TV profile and choices |
| `GET /api/devices/{id}/guide?from=...&to=...` | Bounded UTC programme intervals |
| `GET /api/devices/{id}/playback` | Observed provider session or JSON null |
| `POST /api/devices/{id}/provider/commands` | Typed provider action |

The existing `/api/devices/{id}/media` endpoint remains Cast-only. Provider media
actions use the new command endpoint with their own session ID. Generic MCP
tools expose integration, catalog, guide, browsing, playback and commands through
the same registry. `/api/ws` adds `provider.updated` and `integration.updated`
invalidation events; the existing device/Cast event shapes remain compatible.

Providers implement the analogous `/atvr/v1` routes, `GET /manifest`, `GET
/devices`, per-device resources, commands and an `/events` WebSocket with an
epoch and monotonic sequence. The complete wire shapes and acceptance behavior
are specified in [the implementation contract](design/launcher-providers-plan.md)
and [the architecture design](design/launcher-providers.md).

Guide responses own the schedule, timezone and revision. The remote renders
their UTC intervals without independently shuffling recommendations. Channel
up/down follows available channels in provider order using an acknowledged
navigation cursor, so it still advances when the TV cannot confirm a channel.
Recommendation channels resume/start their current title; they do not seek to
the elapsed time of a synthetic broadcast.

Version one also accepts these optional presentation fields; older providers can omit
them without changing their existing responses:

| Resource | Optional fields |
|---|---|
| Catalog item | `usage_count`: integer 0–1,000,000,000, recent TV foreground sessions |
| Profile | `color`: `#RRGGBB` for the initials fallback, alongside `image_url` |
| Channel | `package`, `icon_url` (HTTP(S)), `accent_color` (`#RRGGBB`) |
| Title | `description`: synopsis of at most 4,000 characters |

Providers own artwork URLs and colors; the public remote contains no private server
origins or service-specific branding map. These fields never change programme order,
intervals, timezone, action IDs or the active profile's command guards.

## Portable example

From a source checkout with the server dependencies installed:

```sh
.venv/bin/python examples/provider_fixture.py --device-id aabbccddeeff --port 8765
```

Set the appliance's `PROVIDER_URLS` to `http://127.0.0.1:8765/atvr/v1` for
same-host development. The example is labelled simulated, uses generic fake data,
binds loopback and never connects to a TV. It demonstrates HTTP snapshot fallback,
guide intervals, UUID deduplication and a virtual media session. Launch/tune
actions are acknowledgements only. Use fixture TVs in tests; the example does
not register or pair a physical device and is not a production adapter.
