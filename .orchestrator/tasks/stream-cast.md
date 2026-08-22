# Stream: Google Cast media session

**Worktree:** `.claude/worktrees/cast` — branch `stream-cast`. Work ONLY in there.

## Goal
Populate `DeviceState.cast` and `DeviceState.now_playing` from each TV's Google Cast
channel, and implement `POST /api/devices/{id}/media` for transport and scrubbing.

## Read first
- `docs/design/api-contract.md` — the `NowPlaying`/`CastInfo` models and the Media section
- `server/app/models.py` — `NowPlaying`, `CastInfo`, `MediaControlRequest` (FROZEN)
- `server/app/errors.py` — `NoMediaSession` (FROZEN)
- `server/app/devices.py` — `DeviceManager`, which you extend
- `server/app/events.py` — the event bus that feeds the WebSocket
- `docs/design/conventions.md` — Python header format (`#` block, NOT a docstring)

## Verified findings — do not re-derive these
Probed against the operator's live network:
- All five TVs advertise `_googlecast._tcp.local.` on port **8009**.
- `cast` fields populate reliably: BRAVIA reported `app_id=Netflix`,
  `display_name='Netflix'`, `volume_level=0.68`. Two others reported
  `app_id=AndroidNativeApp`, `display_name='Spotify'`.
- **`icon_url` was EMPTY on every device.** Do not rely on it; app icons are a separate
  stream fed by the Play Store.
- **`now_playing` was empty on every device**, because all four were playing native apps.
  `AndroidNativeApp` literally means "a native app is foreground", and Cast publishes the
  media namespace only for content cast from a phone/browser. This is the COMMON case here.
- The mDNS TXT `st` flag is `1` when a session is active and `0` when idle, available
  without connecting at all. Use it to avoid pointless connections.

## Files to touch
- `server/app/cast.py` — the Cast client and session manager (new; you own it)
- `server/app/devices.py` — wire Cast state into `DeviceState` and the event bus
- `server/app/routers/devices.py` — add the `POST .../media` endpoint
- `server/app/discovery.py` — surface the `st` TXT flag if it helps you gate connections
- `server/pyproject.toml` — add the Cast dependency
- `server/tests/test_cast.py`, and extend `server/tests/test_devices.py` as needed

**Frozen — do not edit:** `server/app/{models,config,errors}.py`, `docs/design/*`,
`web/**`. Another stream owns `server/app/icons.py`; do not create it.

## Requirements
- Use `pychromecast` (verified working here, v14.0.10; it is what Home Assistant uses).
  Add it to `server/pyproject.toml`. If you find it too heavy or thread-bound to sit
  cleanly in the asyncio app, a lean direct implementation of the Cast v2 protobuf channel
  is acceptable — but say so in your report and justify it.
- **Never block the event loop.** pychromecast is thread-based; keep it off the loop with
  `asyncio.to_thread` or a dedicated worker, and marshal updates back via the event bus.
- One Cast connection per enabled device, held and auto-reconnecting, mirroring how
  `DeviceManager` already holds `AndroidTVRemote`. A TV that is off must not spin.
- Push a `device.state` event whenever cast/now_playing changes. **Do not poll from the UI
  side and do not add a polling endpoint.**
- `now_playing.position_at` must be stamped when position is sampled, so the client can
  extrapolate the playhead locally.
- `POST /api/devices/{id}/media` implements play/pause/play_pause/stop/seek/next/previous,
  raising `NoMediaSession` (409) when there is no session. Honour `can_pause`/`can_seek`.
- **Cast must be optional and non-fatal.** A TV with Cast unreachable, or Cast disabled
  entirely, must leave the remote fully working with `cast: null, now_playing: null`. Add a
  `CAST_ENABLED` env var (default true). A Cast failure must never degrade key sending.

## Acceptance criteria
- [ ] `./scripts/dev-build.sh check` exits 0 (this now runs the full server suite).
- [ ] Tests cover, with Cast faked: cast fields populating `DeviceState`; `now_playing`
      staying null when no session exists; each media action; `NoMediaSession` when idle;
      `position_at` stamping; and a Cast failure NOT breaking key sending.
- [ ] Verify against the real network and put the actual output in your report: the
      appliance is running, and the BRAVIA (192.168.1.202) should report
      `cast.display_name` non-null.
- [ ] Headers per conventions.md.

## Out of scope
`server/app/icons.py`, anything under `web/` or `tray/`, and editing the frozen models.
