<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Operator and developer reference for the Android TV Remote appliance's app icon service.
Describes the four-rung resolution chain behind GET /api/icons/{package}, where resolved
icons are cached on the data volume, how to refresh, clear, or hand-pin an icon, the
validation and allowlisting applied to the client-supplied package id and the scraped image
URL, and the deliberate, accepted risk of sourcing artwork from an unofficial endpoint.
-->

# App icons

The launcher shows real app artwork rather than coloured letter tiles. `GET
/api/icons/{package}` resolves an Android package id to an image, caches it on the data
volume, and serves it locally from then on.

**This endpoint always returns an image.** It never answers a valid package id with a 404,
because a hole in a launcher grid is worse than an imperfect tile. The only non-image
response for a well-formed request is a `304 Not Modified` when the client already holds
the current icon.

## How resolution works

Four rungs, tried in order. The first one that produces bytes wins.

| # | Rung | Source | Cached to disk? |
|---|---|---|---|
| 0 | **Hand-pinned icon** | `<DATA_DIR>/icons/pinned/<package>.<ext>` | placed by you |
| 1 | **On-disk cache** | `<DATA_DIR>/icons/<package>.<ext>` | already there |
| 2 | **Play Store listing** | the listing page's `og:image`, downloaded | **yes** |
| 3 | **Bundled brand glyph** | simple-icons path data baked into `server/app/icons.py` | no |
| 4 | **Generated wordmark tile** | rendered SVG, brand-coloured when the brand is known | no |

Rungs 3 and 4 are **deliberately not cached**. Caching a fallback would pin a plain tile in
place permanently the first time the network happened to be down; instead, the *failure* is
remembered for an hour (so a missing app is not re-scraped on every page load) and real
artwork is picked up on the next attempt after that.

Which rung answered is reported in the `X-Icon-Source` response header — `pinned`,
`cache`, `play`, `glyph`, or `tile`. That is the first thing to look at when an icon is
wrong.

### Rung 2 in detail

The listing page is fetched with a browser `User-Agent`, and `<meta property="og:image">`
is read out of it. The resulting Google image URL carries a trailing size directive, which
is rewritten to `=s256` so the image server does the resizing:

```
...=s0-br30   ->  512x512, 252 KB   (Disney+, as the listing serves it)
...=s256      ->  256x256,  62 KB   (what the appliance stores and serves)
```

That is how icons are normalised to a launcher-appropriate size with no image library in
the runtime container.

### Rungs 3 and 4, and why both exist

simple-icons covers Netflix, YouTube, Spotify, Plex, Jellyfin, Max, Apple TV, Twitch, Kodi,
Crunchyroll, Paramount+ and Emby. It does **not** carry Disney+, Prime Video, Hulu, Peacock
or Pluto TV — those were removed after trademark requests. A glyph set alone therefore
cannot cover the catalogue, which is why rung 4 exists: those brands still get a tile in
their own brand colour with their real name on it. Ink is chosen as black or white by
luminance, so a light brand colour like Plex's yellow stays readable.

## Where the cache lives

```
<DATA_DIR>/icons/<package>.<ext>          # downloaded, managed by the appliance
<DATA_DIR>/icons/pinned/<package>.<ext>   # placed by you, never touched automatically
```

`DATA_DIR` defaults to `/volumes/androidtvremote` and is the mounted volume, so **cached
icons survive restarts, redeploys, and image rebuilds, and the launcher keeps working with
no internet.** Files are written to a temporary name and renamed into place, so a reader
never sees a half-written icon.

If the volume is read-only or full, caching is skipped with a warning and the endpoint
still serves icons — it just re-resolves each time.

## Fixing a wrong or stale icon

### Refresh one icon

```bash
curl -o /dev/null "http://<appliance>:7433/api/icons/com.netflix.ninja?refresh=1"
```

Discards the cached copy and re-resolves from source. Use this when an app has changed its
artwork, or when a bad icon got cached.

### Clear the cache

There is no clear endpoint; the cache is just files.

```bash
rm /volumes/androidtvremote/icons/com.netflix.ninja.*   # one app
rm -rf /volumes/androidtvremote/icons                   # everything, pins included
```

The directory is recreated on the next request. Nothing else lives in it, and deleting it
loses nothing that cannot be re-fetched.

### Pin an icon by hand

Drop a file into the **pinned** directory, named after the package id:

```bash
mkdir -p /volumes/androidtvremote/icons/pinned
cp my-icon.png /volumes/androidtvremote/icons/pinned/com.example.app.png
```

A pin outranks every other rung and is served untouched, so this is how you override an
icon the Play Store gets wrong. `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` and `.svg` are
recognised.

Pins are kept in their own directory precisely so that **`?refresh=1` cannot delete them** —
refresh clears only what the appliance downloaded. A pinned package therefore keeps serving
the pin no matter how often it is refreshed; delete the pinned file to hand the package back
to automatic resolution.

SVG is accepted **only** for hand-pinned files, never from the network: an SVG can carry
script, and one served back from the appliance's own origin would be stored XSS. A file you
put there yourself is trusted local content; a file scraped off the internet is not.

## Caching headers

| Result | `Cache-Control` |
|---|---|
| Real artwork (`pinned`, `cache`, `play`) | `public, max-age=604800` (7 days) |
| Generated fallback (`glyph`, `tile`) | `public, max-age=300` (5 minutes) |

A strong `ETag` is sent with every response and conditional requests are answered with
`304`. Fallbacks get a short max-age deliberately, so a browser that was served a tile
during an outage picks up the real icon shortly after connectivity returns instead of
holding the tile for a week.

`X-Content-Type-Options: nosniff` is set on every response.

## Security notes

`package` is a client-controlled path parameter that is used to build **both** an outbound
URL and a cache filename, so it is a path-traversal and SSRF boundary. It is validated
against a strict Android package pattern (dot-separated Java identifiers, at least two
segments, 200 characters max) before it reaches either. Anything else — `..`, a slash, a
URL, a shell metacharacter — is rejected with `400 invalid_request` and never touches the
filesystem or the network.

The `og:image` URL is a **second** attacker-influenced hop, since it is read out of
third-party HTML. It is allowlisted to Google's image hosts (`*.googleusercontent.com`,
`*.ggpht.com`, `*.gstatic.com`), required to be HTTPS, re-checked after redirects, and
required to come back with a raster image content type.

Icons are served under `/api`, so when `REMOTE_API_TOKEN` is set they need the same bearer
token or `?token=` as every other API call.

## Performance

Outbound fetches run on a worker thread with a 5 second timeout, so **the event loop is
never blocked and a slow Play Store response for one package cannot delay a request for a
different one.** Concurrent requests for the *same* package collapse into a single outbound
fetch rather than each opening their own.

Measured against the live Play Store: first request ~270 ms (two outbound requests), second
request ~3 ms and zero outbound requests.

## The unofficial-source caveat

**The Play Store listing scrape is unofficial. Google does not publish this as an API, and
it may change or break without notice.** There is no supported alternative: the Cast
channel's `icon_url` is empty on real devices, and no official Play Store metadata endpoint
exists for this.

That risk was accepted deliberately, because of how it fails. If the scrape breaks:

- Every icon already cached on the data volume keeps working, indefinitely and offline.
- Newly requested apps fall to their bundled brand glyph, and then to a brand-coloured
  wordmark tile.
- The endpoint still returns an image for every package, so the launcher renders exactly
  as many tiles as before.

**A Play Store change degrades the launcher's polish, not its function.** The one thing
that would turn it into a real outage is removing the fallback rungs, so they must stay —
and the endpoint must keep answering with an image rather than a 404.

If the scrape does break, the fix is confined to `_fetch_store_icon` and
`_OG_IMAGE_PATTERN` in `server/app/icons.py`; the chain around it is unaffected.

## Extending the catalogue

Adding an app to `server/app/apps.py` gives it an icon automatically — `AppDescriptor.
icon_url` is derived from the package id, so the path and the package can never drift
apart. To add a bundled glyph for a new brand, add an entry to `BRANDS` (name, `#rrggbb`,
and simple-icons 24x24 path data) and map its package ids in `PACKAGE_BRANDS` in
`server/app/icons.py`. A brand with no glyph available can still be listed with an empty
path so that its wordmark tile comes out in the right colour.
