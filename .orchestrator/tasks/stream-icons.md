# Stream: App icon service

**Worktree:** `.claude/worktrees/icons` — branch `stream-icons`. Work ONLY in there.

## Goal
`GET /api/icons/{package}` returns a real icon for any Android app package, cached on the
data volume, so the launcher shows true app artwork and keeps working offline.

## Read first
- `docs/design/api-contract.md` — the Icons section
- `server/app/models.py` — `AppDescriptor.icon_url` (FROZEN)
- `server/app/apps.py` — the current 8-app catalogue
- `server/app/config.py` — `settings.data_dir` (FROZEN)
- `docs/design/conventions.md` — Python header format (`#` block, NOT a docstring)

## Verified findings — do not re-derive
- Play Store lookup by package id WORKS. `https://play.google.com/store/apps/details?id=<pkg>&gl=us&hl=en`
  with a browser User-Agent, then `<meta property="og:image">`, resolved correctly for all
  of: `com.netflix.ninja`, `com.disney.disneyplus`,
  `com.amazon.amazonvideo.livingroom`, `com.spotify.tv.android`, `org.jellyfin.androidtv`,
  `com.plexapp.android`. `og:title` also gives the app's display name.
- `simple-icons` (npm, 3453 icons, CC0 paths + official brand hex) covers Netflix, YouTube,
  Spotify, Plex, Jellyfin, HBO Max/Max, Apple TV, Twitch, Kodi, Crunchyroll, Paramount+,
  Emby. It does **NOT** have Disney+, Prime Video, Hulu, Peacock or Pluto TV — those were
  removed after trademark requests. So simple-icons alone is not sufficient; it is the
  second rung of the fallback chain.
- Cast's `icon_url` is EMPTY on all of the operator's devices. It is not a usable source.

## Files to touch
- `server/app/icons.py` — the whole service (you own it)
- `server/app/apps.py` — populate `icon_url`; extend the catalogue if you like
- `server/app/routers/catalog.py` — the `/api/icons/{package}` route
- `server/tests/test_icons.py`
- `docs/icons.md`

**Frozen:** `server/app/{models,config,errors}.py`, `docs/design/*`, `web/**`. Another
stream owns `server/app/cast.py`; do not create it.

## Requirements
- **Fallback chain, in order.** The endpoint must ALWAYS return an image, never a 404:
  1. On-disk cache under `settings.data_dir / "icons"`.
  2. Play Store `og:image` for the package, downloaded and cached.
  3. A bundled monochrome brand glyph (simple-icons path data) tinted with the brand hex.
  4. A generated wordmark/letter tile in the brand colour, or a neutral colour if unknown.
- **Cache aggressively and persistently.** This is the mitigation for depending on an
  unofficial source: once fetched, an icon must survive restarts and work with no internet.
  Store the resolved bytes plus content type. Add a long `Cache-Control` and an `ETag`.
- **Never block the event loop** on a network fetch, and never let a slow or failed Play
  Store request stall a request for a different package. Time out fast (a few seconds) and
  fall through the chain. A launcher that hangs is worse than one with plain tiles.
- Negative-cache failures for a while so a missing package does not re-hit Play Store on
  every page load.
- Validate the `package` path parameter against a strict Android package pattern before it
  ever reaches a URL or a filesystem path. **This is a path-traversal and SSRF boundary**:
  it comes from the client and is used to build both a URL and a cache filename.
- Sensible size: normalise to a reasonable max dimension so the launcher is not pulling
  512px PNGs per tile.
- A refresh path (e.g. `?refresh=1`, or a documented way to clear the cache) so a wrong or
  stale icon can be corrected without a redeploy.
- `docs/icons.md`: how resolution works, where the cache lives, how to clear it, how to
  pin an icon manually, and a plain statement that Play Store scraping is unofficial and
  may break — with the reassurance that the fallback chain degrades polish, not function.

## Acceptance criteria
- [ ] `./scripts/dev-build.sh check` exits 0.
- [ ] Tests cover, with the network faked: cache hit; Play Store success; Play Store
      failure falling through to a glyph; unknown package producing a tile; rejection of
      traversal-style package names; and the endpoint returning an image in every case.
- [ ] Verify for real and put the output in your report: fetch icons for
      `com.netflix.ninja` and `com.disney.disneyplus` and confirm a second request is
      served from cache without a network call.
- [ ] Headers per conventions.md.

## Out of scope
`server/app/cast.py`, anything under `web/` or `tray/`, editing the frozen models.
