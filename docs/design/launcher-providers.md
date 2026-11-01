# Optional launcher providers

<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Proposed architecture for optional network providers in Android TV Remote. Defines
the public extension boundary, automatic discovery and selected-TV association,
guide and playback behavior, responsive remote surfaces, and the responsibilities
of an external launcher adapter. This is a design proposal, not a description of
features already implemented.
-->

Status: proposed, awaiting product approval. Tracking: T323980e4d5825.

## Intent and agreed behavior

Make the remote a useful companion to a television's launcher: browse its apps,
services and media, see what is playing, browse a guide, and surf channels without
first navigating the TV's home screen. Everything controls the selected TV;
phone playback is outside this version.

Compatible providers are discovered automatically and integrated automatically
for already paired TVs. There is no per-provider enablement prompt in the normal
flow. A provider can be disabled in Settings.

Channel selection follows the launcher's behavior: resume or open the current
title. A scheduled recommendation is not a live broadcast and does not imply
seeking to the elapsed guide time. Future programmes open details; they do not
create recording or reminder jobs.

The public remote remains independently useful. Proprietary API mappings,
service names, account access and deployment URLs belong to an external provider
maintained in the launcher's repository. The remote contains generic models,
network discovery, a provider client and reusable UI. It downloads data, never
provider JavaScript, executable modules or HTML UI.

## Verified starting point

The remote is a LAN-hosted FastAPI appliance serving a React SPA, REST API,
WebSocket updates, embeds and MCP. Discovery already runs on the appliance;
the phone browser need not access multicast or private provider origins.

Existing implementation seams:

| Responsibility | Current source |
|---|---|
| App lifecycle and routers | `server/app/main.py`, `create_app` |
| Stable MAC-derived TV IDs, pairing, commands | `server/app/devices.py`, `DeviceManager` |
| LAN DNS-SD discovery | `server/app/discovery.py`, `DiscoveryBrowser` |
| Cast metadata and transport | `server/app/cast.py`; `DeviceManager.media_control` |
| Shared response models | `server/app/models.py`, `web/src/lib/api-types.ts` |
| Snapshot and incremental stream | `server/app/events.py`, `routers/ws.py`, `web/src/state/store.ts` |
| Selected-TV screen | `web/src/routes/RemotePage.tsx` |
| Apps, playback and persistent keys | `web/src/components/AppLauncher.tsx`, `NowPlaying.tsx`, `Deck.tsx` |

The existing app catalog is curated, not an installed-app inventory. Native TV
playback usually has no Cast media metadata. The remote protocol itself does not
provide title, artwork, duration or position. Preserve those distinctions.

The reference custom launcher currently generates its recommendation schedule
locally and uploads household-wide app/history data. It does not yet expose
per-TV identity, active profile, live playback or remote provider discovery.
Its Watch Next records are resume history, not evidence of current playback.
The external adapter therefore requires launcher changes as well as server APIs.

## Public extension boundary

Use a versioned HTTP provider protocol, with a WebSocket event stream, rather
than installable code inside the remote. Providers may represent a single TV or
a server serving several TVs. A small synthetic example provider should exercise
the contract without any private services.

The proposed service type is `_atvr-provider._tcp.local.`; this is a new project
convention, not an existing Android standard. DNS-SD advertises provider instance
ID, protocol major version, and manifest path. The manifest provides display
name and supported capability names. API major version 1 uses `/atvr/v1`.

All browser requests go through the remote appliance. No proprietary hostname,
SDK, credentials or private API shape is built into the SPA or public backend.
Provider networking has bounded timeouts and response sizes; redirects cannot
silently move requests outside the discovered/configured provider origin. Never
forward the remote's own API token to a provider. Optional provider credentials
are configured on the appliance and stay there. Discovery cannot bypass a
provider's authentication requirements.

The initial automatic mode trusts compatible providers on the appliance's local
network, consistent with the requested zero-prompt discovery. TV pairing is a
control prerequisite, not cryptographic authentication of a discovered provider.
Only schema-validated data and allowlisted actions are accepted. Networks that
need a stronger trust boundary can disable discovery and configure provider
origins/credentials explicitly; signed plugin packages are outside this version.

## Per-TV identity and capabilities

The remote's existing MAC-derived `device_id` remains canonical in the launcher
and provider as well. Its precise source is the Android TV Remote Service's TLS
certificate, not a Wi-Fi API or an IP-derived identifier. The existing library's
`async_get_name_and_mac()` connects to pairing port 6467, reads the server
certificate and takes the last slash-delimited component of its subject common
name. `DeviceManager.add_device()` lowercases that value and removes colons:
`AA:BB:CC:DD:EE:FF` becomes `aabbccddeeff`.

On launcher registration, the provider backend performs the same certificate
lookup against that TV and returns the canonical ID to the launcher. This shares
the remote's identity method without depending on Android's restricted local
hardware-MAC APIs. The launcher publishes installed apps, active profile,
timezone, launcher version, capabilities and subsequent watching updates under
that ID through the provider's home API. It uses an outbound connection so TVs
do not require an inbound control server. An optional installation UUID tracks
reinstalls and connection epochs; it is not a competing TV identity.

The adapter obtains the TV address at trusted LAN ingress, then verifies the
certificate-derived ID against the paired remote inventory. A reverse proxy's
address is not a TV address; arbitrary forwarded headers or launcher-supplied
addresses are not sufficient evidence. If ingress cannot identify the TV address,
or the certificate lookup fails, leave registration unresolved and expose an
explicit TV mapping instead of inferring identity from a friendly name. A
launcher-local lookup of the same service can be a fallback only after verifying
reachability and equivalent certificate results on the target TVs.

Validate the certificate identity's MAC format and reject empty, placeholder or
conflicting IDs. DHCP changes update addresses, not identity. Reinstallation
retains the same TV identity when its Remote Service certificate identity is
unchanged. A factory reset or Remote Service identity change requires a fresh
association and pairing as appropriate; do not silently migrate another TV's
state. The certificate name is an identity source, not provider authentication.
Recheck pairing, enabled state and association before every command. Unpairing
immediately disables provider control. An unpaired TV may be visible in discovery
but cannot receive provider commands.

Capabilities are per TV, not merely per provider: installed apps, services,
search, continue watching, title details, guide, tune, channel step, live playback
and supported playback actions. A missing capability removes its UI/action.
Each operation carries the canonical selected device ID and the bound provider
TV ID. A provider handling several TVs must keep their profiles and playback
separate. Each capability has one active owner per TV; prefer a persisted owner,
otherwise select a sole candidate. If several providers claim the same capability
without an owner, leave it unresolved in Settings rather than switching sources.
Guide, tune and channel-step form one capability group with one owner, so channel
IDs and schedule revisions never cross provider boundaries. Playback observations
and their session controls likewise share an owner.

## Proposed provider contract

Paths below are relative to `/atvr/v1`. These are new adapter endpoints, not
claims about existing launcher APIs.

| Endpoint | Behavior |
|---|---|
| `GET /manifest` | Provider ID, protocol version, display name and capabilities |
| `GET /devices` | Live TV registrations, identity evidence and per-TV capabilities |
| `GET /devices/{tv}/catalog` | Installed apps, launchable services and browsing capabilities |
| `GET /devices/{tv}/browse` | Continue watching or search results; bounded cursor pagination |
| `GET /devices/{tv}/titles/{id}` | Title details and available actions |
| `GET /devices/{tv}/guide?from=...&to=...` | Channels and authoritative programme times for a bounded window |
| `GET /devices/{tv}/playback` | Current observed playback, or an explicit unknown/idle state |
| `POST /devices/{tv}/commands` | Typed app/service launch, title open/resume, tune, channel step or media action |
| `GET /events` (WebSocket upgrade) | Snapshot, then device-scoped capability/catalog/guide/profile/playback changes |

Every data response includes provider/TV identity, revision and `observed_at`.
Events include a provider-instance epoch and monotonic sequence. Reconnection
fetches a new snapshot; duplicate/old events are ignored within an epoch. No
cross-restart sequence assumptions. Heartbeats distinguish a quiet connection
from a dead one. The provider filters data using the TV's current profile and
family settings. Returned profile revision lets the remote discard responses
started under an old profile.

Catalog entries have stable namespaced IDs, label, kind, image and action IDs.
They distinguish installed apps, services available through an installed player,
and unavailable entries. A service logo alone never implies it is launchable.
Account passwords, provider access tokens and raw account administration never
appear in these payloads.

Guide responses contain timezone, server time, schedule revision and channels
with stable IDs, order and `kind` (`recommendation` or `live`). Programmes contain
stable IDs, title IDs, title/artwork, UTC start/end times, availability, and
supported action IDs. Details can include season, episode and source service.
The provider owns timezone/DST and daily schedule boundaries; the remote only
lays out those intervals. The launcher consumes the same schedule/revision, so
channel ordering and titles agree on both screens.

Commands contain a client-generated command UUID, typed action, referenced item
IDs and expected profile/schedule revision where relevant. The adapter validates
the action against the current TV catalog. It deduplicates command UUIDs and
returns `accepted`, `completed` or `failed` with a reason; acceptance is never
rendered as proof of playback. The provider forwards commands on the launcher's
outbound connection. Lost connections fail pending work; commands are not queued
for execution when a different profile or TV later comes online.

Existing paired app-link launch can handle compatible apps without the adapter's
command channel. Launcher-native actions use a small fixed command allowlist;
providers cannot request arbitrary shell commands or arbitrary network fetches.

## Playback and channel surfing

The launcher publishes currently watching observations through the home API,
keyed by the shared canonical TV ID. Send updates on session/title changes,
play/pause/seek/stop and profile changes, with a heartbeat while active. Include
session ID, observation time and sequence, package, profile, optional title and
channel IDs, metadata, position/duration and supported actions. The provider
retains each TV's latest observed state and pushes changes to the remote's generic
provider client, which fans them out on `/api/ws`. Stop clears the active session;
heartbeat expiry marks it unknown/stale. Keep resume history in its existing
history API, separate from this device-scoped live state.

Playback includes source, foreground package, session ID, title/artwork, state,
position/duration, observation timestamp, optional channel ID and supported
actions. A valid provider observation wins only when fresh and consistent with
the TV's foreground app. Otherwise retain a valid Cast session, then fall back
to app identity. Unknown and stale observations do not overwrite newer valid
data. Store source states separately so an unrelated Cast callback cannot erase
provider playback.

Version 1 includes a launcher-side MediaSession observer and transport controller,
using Android notification-listener access to observe supported external players.
The operator must grant that access on the TV; automatic provider connection
does not grant Android permissions. Launcher Settings should expose the access
state and the appropriate system settings link. The observer handles session
start/stop, metadata, position and supported actions, reporting only what it
actually observes. If access is absent or a player exposes no usable session,
publish app identity or unknown metadata and keep ordinary media keys usable.
A launched title, Watch Next row, or position extrapolation is never promoted
to confirmed live playback. The launcher's own active profile is also available
through an optional profile picker/action; account administration stays private.

Playback controls route to the source and session that advertised support.
Seek appears only for a seekable session. The existing Cast `/media` API keeps
its current semantics; a new generic playback action endpoint dispatches provider
or Cast commands with an expected session ID, rejecting stale sessions.

Channel up/down traverses the currently available channels in provider order,
wrapping at the ends. Navigation from an unknown channel begins at the first
available channel for up and the last for down. It acts on the selected TV's
profile-specific lineup. Resolve the current programme at command execution,
then resume/open it with the launcher's existing target selection. Empty or
unavailable channels are skipped. Rapid stepping is serialized per TV, with
superseded unsent selections coalesced; do not replay a stale queue of launches.
Selection is shown as pending until acknowledged. Maintain a separate acknowledged
navigation cursor per TV/profile/lineup revision, so subsequent channel steps
advance even when the player reports no channel telemetry. Rapid pending steps
advance the latest desired cursor; a failed launch returns to the last acknowledged
cursor. Confirmed external channel changes re-anchor it; a profile or lineup
change clears it. Only observed playback marks a channel as playing. Outside a
provider lineup, ordinary Android channel keys
remain available through the generic key controls.

## Remote-facing API and reactive UI

Add device-scoped integrations, catalog, browse, guide and playback endpoints
under `/api/devices/{id}/...`; expose the same generic capabilities to MCP.
Existing `/api/apps`, commands, embeds and tray consumers remain compatible.
The SPA receives provider availability and playback changes through the existing
`/api/ws` connection. Large catalogs and guide windows load through bounded REST
requests; events invalidate affected revisions rather than broadcasting entire
guide datasets to every client.

All queries, caches, pending commands and UI preferences are keyed by TV ID and,
where applicable, provider and profile revision. Switching TV aborts old requests
and rejects late responses. Profile changes invalidate the relevant catalog,
guide, browse and playback state. Reconnecting refreshes a snapshot and visible
data. The guide advances its now marker locally; progress extrapolates from a
timestamp without polling the browser every second.

Use four primary destinations: Controls, Apps & services, Guide, and Playing.
D-pad, touchpad and text remain available within Controls. Preserve familiar
back, home, power and volume access. The selected TV's name stays visible during
browsing and pending actions. Missing guide capability hides Guide; losing the
provider while it is open shows unavailable/stale state and a route to Controls.
Settings exposes discovery health and TV mappings without making configuration
part of the normal remote flow.

Phone: one destination at a time, thumb-sized controls, now/next channel cards
with programme details, and a contained scrolling guide. Tablet: two panes so
browsing and core remote keys can coexist. Wide desktop: a large channel/time
grid with a narrower remote/now-playing area, using available width instead of
the current fixed remote body. Use content-driven breakpoints; verify at 390px,
768px and 1440px widths, plus landscape/short screens. Keep scroll inside content
panes, preserve touchpad gestures and safe areas, and provide keyboard navigation,
visible focus, reduced motion and accessible programme labels.

Without a provider, retain the curated generic app catalog, app-link launching,
Android key/text/power/volume control, discovery/pairing and Cast now-playing.
Show no invented installed-app status or empty mandatory guide shell. A provider
outage never prevents those core controls from working. In-flight provider
actions show a bounded failure; stale cached browsing can remain labelled with
its last update, but cannot execute an obsolete action.

## Implementation and acceptance sequence

1. Public protocol/models, fixture provider, registry/discovery and device
   association. Verify zero-provider startup, automatic sole matches, ambiguous
   matches, DHCP change, duplicate providers, auth, version rejection and shutdown.
   Verify identical certificate parsing/normalization in the remote and provider,
   including supported certificate subject layouts and invalid/placeholder IDs.
2. External launcher registration, per-TV inventory/profile and outbound command
   connection; adapter manifest/discovery. Verify two simultaneous TVs with
   different apps/profiles and loss/reconnect. Register using the shared
   certificate-derived TV ID and publish device-scoped watching observations
   through the home API. Do not use household-global data as a per-device fallback.
3. Shared authoritative schedule, title/service browsing, tune/channel step and
   source-aware observed playback. Verify launcher/remote agreement, timezone and
   midnight/DST cases, resume/open semantics, command deduplication, stale sessions,
   absent MediaSession access and unsupported actions. Include the MediaSession
   observer/controller and TV access settings in this stage, rather than deferring
   all native playback telemetry. Validate repeated stepping without telemetry.
4. Responsive public UI and generic MCP tools. Verify TV/profile changes during
   requests, provider disappearance, empty guides, long labels, keyboard/touch use
   and the three viewport sizes. Confirm no private URLs, adapters or credentials
   enter the public source or production bundle.
5. Run task-specific tests and `./scripts/dev-build.sh check`, `build` and
   `container` in isolated worktrees before integration. Record any unavailable
   environment check explicitly. Update the API/architecture docs and sync docs.

For non-trivial implementation, follow the repository's independent test/code
agent contract in separate worktrees, then use a fresh reviewer. Shared observable
acceptance cases must precede either implementation brief. This proposal itself
changes documentation only and does not claim any implementation checks passed.

## Choices and remaining boundaries

The user has confirmed selected-TV playback, automatic integration for paired
TVs, and matching the launcher's resume/open guide behavior. The HTTP/data-only
provider model, appliance-side discovery, shared schedule authority, conservative
identity association, responsive pane layouts and staged delivery are proposed
engineering choices for approval.

Universal native-app metadata and seek are not promised: capability discovery
must reflect what each TV can report and control. Cloud plugin marketplaces,
downloaded executable plugins, arbitrary plugin UI, phone streaming, recording,
reminder jobs and service-account administration are outside this version.
Exact schema field spelling, module/file splits and visual tokens remain builder
choices within this contract. Integration into a development branch, local main,
or a reviewed PR follows the developer's session preference; no product changes
have been merged or deployed by this proposal.
