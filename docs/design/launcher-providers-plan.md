# Launcher Providers Implementation Plan

> **For agentic workers:** Use the repository's required independent test/code agents in isolated worktrees, with a fresh review after convergence. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved optional launcher provider design, including the public remote UI and private launcher/home API adapter.

**Architecture:** Public FastAPI provider registry discovers versioned HTTP/data providers and forwards device-scoped commands and live state. The external home server implements that contract and receives registration, capabilities and observed playback from the Android launcher. Certificate-derived TV IDs are shared across both systems.

**Tech Stack:** Python/FastAPI/Pydantic/httpx/zeroconf, React/TypeScript/Tailwind, Node/Express and Android Java.

**Spec:** `docs/design/launcher-providers.md` (approved, with shared certificate identity refinement).

## Global constraints

- Control the selected TV only; automatically integrate compatible discovered providers for paired TVs.
- Public code contains no private origins or service adapter mappings and executes no downloaded provider code.
- Resume/open the current guide title; do not seek to synthetic guide elapsed time.
- Preserve existing Cast `/media`, generic remote commands, embeds and tray API compatibility.
- Keep histories separate from observed playback; unknown native metadata remains unknown.
- Implementation occurs in isolated worktrees. Test and source agents have disjoint file scopes.
- Use existing authentication, error envelopes, live event bus and lifecycle patterns.
- Document all new files with copyright and standalone purpose headers; document public functions.

## Review focus

- Late responses after a TV/profile change must never populate or control another TV.
- An unavailable provider must leave core key/power/volume control working.
- A stale/fake media observation must not replace a valid Cast session or allow stale seek.
- Channel stepping without playback telemetry must advance and not reopen the first channel repeatedly.
- Discovery must not leak remote credentials or follow redirects to arbitrary origins.

## Locked v1 wire contract

The public backend and private adapter share these payloads. Protocol major is 1.
Provider base `/atvr/v1`, manifest `{id,name,version:1}`; provider IDs are stable slugs.
`GET /devices` returns an array of `{id,name,online,capabilities,profile_id,profile_revision}`.
TV IDs are normalized certificate MAC values, exactly 12 lower-case hex digits.
Capability names: `catalog`, `browse`, `guide`, `tune`, `channel_step`, `playback`, `profiles`.
Only paired, enabled registered TVs bind automatically. Duplicate provider claims
remain unresolved; never choose one based on response order.

`GET /devices/{id}/catalog` returns `{revision,profile_revision,items:[...]}`.
Items: `{id,name,kind,package,icon_url,available,action}`; kind is `app` or `service`.
Action is `{type:"launch",item_id}`. IDs are provider-scoped opaque strings.

`GET /devices/{id}/browse?query=&mode=continue&cursor=` returns
`{revision,profile_revision,items:[{id,title,subtitle,image_url,available}],next_cursor}`.
`GET /devices/{id}/titles/{id}` returns title fields plus `actions:["open","resume"]`.
`GET /devices/{id}/profiles` returns `{items:[{id,name,image_url}],active_id,revision}`.

`GET /devices/{id}/guide?from=<UTC>&to=<UTC>` returns
`{revision,profile_revision,timezone,server_time,channels:[...]}`.
Channel: `{id,name,number,kind,programmes:[...]}` where kind is `recommendation` or `live`.
Programme: `{id,title_id,title,subtitle,image_url,start,end,available}`; timestamps are UTC.
Window is bounded to 24 hours, valid `from < to`. IDs and revisions are stable across clients.

`GET /devices/{id}/playback` returns null or
`{session_id,package,title,subtitle,images,player_state,position,duration,position_at,
observed_at,channel_id,actions}`. Position/duration are seconds; state follows existing
`NowPlaying.player_state`; actions are supported media action names. Observation expires
after 30 seconds unless refreshed. Missing title is valid; Watch Next is never substituted.

`POST /devices/{id}/commands` accepts
`{command_id,action,item_id?,channel_id?,direction?,session_id?,position?,profile_revision?,schedule_revision?}`.
Actions: `launch`, `open`, `resume`, `tune`, `channel_step`, `set_profile`, `play`, `pause`,
`play_pause`, `stop`, `seek`, `next`, `previous`. Direction is `up`/`down`.
Result `{command_id,status,error?}` where status is `accepted`, `completed` or `failed`.
Command IDs deduplicate; do not replay after profile/session changes or reconnect.
Provider events (`/events` WebSocket): `{epoch,sequence,type,device_id?,revision?}`;
snapshot contains `devices`, playback event contains `playback`. Other device-scoped events
invalidate corresponding GET data. Restarting epoch causes a full refresh.

Public appliance API:
- `GET /api/providers` -> provider status list; `PATCH /api/providers/{id}` `{enabled}` persists enablement.
- `GET /api/devices/{id}/integrations` -> `{device_id,available,provider_id,provider_name,capabilities,profile_id,profile_revision,error}`.
- `GET /api/devices/{id}/catalog|browse|titles/{title_id}|guide|profiles|playback` proxy validated device-scoped data.
- `POST /api/devices/{id}/provider/commands` uses the command contract above, pairing and capability guards.
- Existing `/api/ws`: add `integration.updated` `{device_id,integration}` and `provider.updated` `{provider}`;
  playback changes invalidate/refresh the device integration without altering existing Cast fields.
- Existing `/api/devices/{id}/media` stays Cast-only; provider controls use the new command endpoint.
- Unsupported/unavailable provider -> existing envelope with `provider_unavailable` (503),
  unsupported/stale action -> `invalid_request` (400/409 as appropriate), unpaired -> existing `not_paired`.

Production provider discovery uses `_atvr-provider._tcp.local.` with TXT `version=1`,
`path=/atvr/v1`, `id=<slug>` and address/port. Explicit `PROVIDER_URLS` is a comma-separated
fallback of base URLs. No provider token inherited from remote auth. HTTP client has 5-second
timeout, no redirects, <=2 MiB response, and verifies endpoint path/origin. Catalog/guide
requests do not accept arbitrary URLs supplied by the browser. Heartbeat/metadata fallback
refresh is 15 seconds. Explicit endpoints allow deployments where mDNS cannot cross networks.

## Task 1: Public provider backend

**Files:** create `server/app/providers/{__init__,models,client,registry,discovery}.py`,
`server/app/routers/providers.py`; modify `server/app/main.py`, `config.py`, `errors.py`,
`routers/ws.py`, `mcp_server.py`, `server/pyproject.toml`; tests only under `server/tests/`.

**Interfaces:** `create_app(...,provider_transport=None)` accepts an optional httpx
transport for fake upstream HTTP in integration tests. `app.state.providers` owns
`async start()`, `stop()`, `refresh()`, device lookup/data/command methods and event fanout.
It consumes `DeviceManager`, existing event bus and settings. Settings add `provider_urls`
(string, default empty), `provider_timeout` (5 seconds), `provider_poll_interval` (15).
Add httpx as runtime dependency. Store provider enablement in existing settings storage.

- [ ] Independent tests exercise routes against fake provider HTTP and real fake-TV registry.
  Verify no-provider status, correct paired-TV binding, unpaired and duplicate claims,
  two-TV isolation, redirects/oversize/version rejection, guide bounds, stale playback,
  session/capability guards, provider disablement and normal remote controls during outage.
- [ ] Run the new tests on baseline and record failures before source implementation.
- [ ] Implement only the locked public contract, DNS-SD listener and bounded HTTP/WS lifecycle.
  Refresh a snapshot on reconnect; stop all discovery/network tasks at shutdown.
- [ ] Run new tests plus existing server tests; commit source and tests separately, converge
  in the feature worktree and run full suite. Add MCP provider tools using the same facade.
- [ ] Fresh review checks contract, auth, lifecycle and typed event changes.

## Task 2: Home server adapter and shared schedule

**Repository:** Docker Home Control, start from its current `origin/main`, not stale primary checkout.
**Files:** create `server/utils/tv-provider.js`, `server/endpoints/tv-provider.js`,
`server/utils/media/guide-schedule.js`; modify `server/endpoints/tv.js`, `server/server.js`;
tests under `tests/server/` (the repository's existing Jest root). Use existing
media/guide, title, profile and enabled-service utilities.

**Interfaces:** Mount `/atvr/v1` contract above and launcher ingress `/api/tv/devices/register`,
`/api/tv/devices/{id}/state`, `/api/tv/devices/{id}/watching`, `/api/tv/devices/{id}/connection` (WS).
Registration resolves certificate identity on port 6467 using an appropriate self-signed client
certificate, validates it and returns `{device_id}`. Probe only an allowed LAN peer from trusted
ingress; unresolved proxy ingress is explicit rather than trusting arbitrary headers.
Device registrations/profiles persist using existing storage; live sessions expire after 30s.
DNS-SD advertises the provider on its LAN address (optional when unavailable, explicit URL works).

- [ ] Test two TV registrations with mocked TLS peer certificate, consistent normalized IDs,
  missing/placeholder/malformed identities, trusted ingress, and expired/cleared watching state.
- [ ] Test observed playback vs history, state/profile isolation, command dedup/ack/timeouts,
  channel-step cursor, current/future programme actions, app availability and no credential leakage.
- [ ] Test schedule goldens matching Java hash, Random shuffle, date seed, slot rounding and
  current launcher defaults; UTC conversion uses each TV timezone and handles day boundaries.
- [ ] Implement adapter and shared authoritative schedule; preserve legacy `/api/tv/apps` and
  `/api/tv/watching` until older launchers upgrade. Do not turn household state into TV data.
- [ ] Run affected Node suites/build, commit and review with independent tests.

## Task 3: Android launcher reporting and control

**Repository/files:** `tv-launcher/app/src/main/java/.../` existing `ServerApi.java`,
`Profiles.java`, `GuideSchedule.java`, `WatchNext.java`, launcher activity and lifecycle;
new `RemoteBridge.java` and `PlaybackObserver.java`; Android manifest notification listener.
Tests live under `tv-launcher/app/src/test/` (pure Java protocol/state tests), never source.

**Interfaces:** register against home API for canonical ID; outbound WS and 10-second observed
state heartbeat. Keep installed apps, current profile and timezone per TV. Commands follow
Task 2 contract; route app/title/tune to existing sanitized intents and profile logic.
MediaSession observer requires TV notification access and advertises only usable capabilities.
Guide consumes provider-authoritative schedule, with existing local fallback when unavailable.

- [ ] Test registration/reconnect epoch, profile invalidation, stale command/session rejection,
  wire serialization, no synthetic watching from launch/history, supported-action mapping.
- [ ] Implement listener plus settings entry for access state, launch/resume/channel actions,
  command acknowledgement and lifecycle cleanup. Retain offline launcher behavior.
- [ ] Build/test Android launcher and verify permission-absent behavior. Hardware validation
  remains explicit if no TV/adb connection is available; do not claim it was exercised.
- [ ] Commit and fresh review the source/tests and source-to-server contract fixtures.

## Task 4: Public responsive UI and generic consumers

**Files:** `web/src/lib/provider-types.ts`, `provider-api.ts`, `hooks/useIntegration.ts`,
`components/{ProviderApps,Guide,ProviderPlaying,MediaBrowse}.tsx`; modify `RemotePage.tsx`,
`Deck.tsx`, `prefs.ts`, `SettingsPage.tsx`, `api-types.ts`, store event handling, relevant CSS.
Tests only under `web/tests/`; use node:test/TypeScript compilation and browser integration
tests following installed tooling. Source/test agent scopes must stay disjoint.

**Interfaces:** consume Task 1 locked routes. Hook caches by TV/provider/profile/revision,
aborts outdated fetches and listens to `integration.updated` on existing store connection.
Playback uses provider only when fresh and compatible foreground package, else existing Cast.

- [ ] Test two TVs, late A response after switching to B, profile changes, outage fallback,
  empty guide, bounded time rendering, supported transports and acknowledged channel cursor.
- [ ] Implement Controls (D-pad/touch/text), Apps & services, Guide, Playing destinations;
  keep core keys accessible and use multi-pane layouts on tablets and wide desktops.
- [ ] Add title/continue/search/profile surfaces where capabilities exist; public catalog
  remains available without a provider. Settings lists/disables providers and explains status.
- [ ] Browser-check 390px, 768px, 1440px and short landscape screens, keyboard focus,
  scroll containment and touchpad ownership. Run TS builds and relevant tests.
- [ ] Commit and fresh review. Keep existing embeds/tray consumers working.

## Task 5: Convergence and integration

- [ ] Cross-repository fixture/provider smoke test: a launcher-reported session for TV A
  appears only on TV A; guide tune produces one acknowledged resume/open action; no provider
  leaves the public remote fully usable. Test disconnect/reconnect and zero-permission state.
- [ ] Add portable fixture provider example and protocol documentation, operator setup and
  private adapter docs in the owning repo. Share review artifacts through Adept file sharing.
- [ ] Run `./scripts/dev-build.sh check`, `build`, `container` in the remote feature worktree;
  run upstream Node and Android gates. Report environment limitations precisely.
- [ ] Attach commits/progress to orch tasks. Integrate only verified work per session choice;
  use required local coordination. Do not publish or install builds without authorization.

## Execution ledger

- Design approved by user. Execution follows required independent test/code pairing locally.
- Integration preference question has been asked; no selection received yet. Keep work in
  isolated feature worktrees until integration handling is resolved.
- Full docs sync was blocked by the existing sync-coordinator registry lock; direct knowledge
  ingestion succeeded. Retry sync after implementation rather than resetting another worker's lock.
