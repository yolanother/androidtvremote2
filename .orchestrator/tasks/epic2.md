# Epic: Rich now-playing — Cast media session + real app icons

## Goal
Decorate the remote with real metadata: box art, title, playback position and transport
control from the Google Cast media session, and true app icons in the launcher.

## Findings that shaped this (probed against the operator's live network)

The Android TV Remote v2 protocol carries NO media metadata. `remotemessage.proto` gives
`app_package`, volume steps, power, IME field status and device info. That is the whole
surface. Box art is simply not in it.

All five TVs advertise Google Cast on port 8009. Connecting to them yielded:

| Device        | app_id            | display_name | icon_url | media |
|---------------|-------------------|--------------|----------|-------|
| BRAVIA 4K GB  | Netflix           | Netflix      | (empty)  | none  |
| Bedroom TV    | AndroidNativeApp  | Spotify      | (empty)  | none  |
| Garage TV     | AndroidNativeApp  | Spotify      | (empty)  | none  |
| Office Shield | E8C28D3C          | Backdrop     | (empty)  | none  |

So Cast reliably gives a human-readable app name and float-precision volume, and the mDNS
TXT `st` flag gives idle/active with no connection at all. It does NOT give media metadata
for NATIVE app playback -- `AndroidNativeApp` is literally "a native app is foreground", and
Cast's media namespace only carries title/artwork/position for content CAST to the device
from a phone or browser.

The operator was told box art would therefore be empty in their common case and chose the
full media-session integration anyway. Build it properly; make the empty case degrade well.

Play Store lookup by package id was verified working for all six catalogue packages,
including Disney+ and Prime Video which simple-icons has dropped over trademark requests.
It also returns the app title, which solves friendly names for packages not in our
catalogue.

## Decisions (operator)
- Full Cast media session: title, artwork, position, transport, scrubbing.
- App icons fetched at runtime from the Play Store, cached on the data volume.

## Risks accepted (raised, operator chose to proceed)
- Cast media metadata is empty during native playback, which is most of the time here.
- Play Store scraping is unofficial, needs internet, and can break without notice.
  Mitigation: aggressive on-disk caching plus a bundled simple-icons fallback and a
  brand-coloured wordmark tile, so the launcher never regresses to blank.

## Done looks like
- A now-playing view showing artwork, title, subtitle and a live progress bar when a Cast
  media session exists, and degrading to app identity when it does not.
- Play/pause/seek working against a Cast session.
- Every app in the launcher shows a real icon, offline, after first fetch.
