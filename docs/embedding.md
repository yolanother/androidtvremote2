<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Operator guide to embedding the Android TV Remote in another page. Documents the /embed
iframe URL and every query parameter that configures it, recommended frame sizes for each
layout, the FRAME_ANCESTORS CSP knob that controls who is allowed to frame the appliance,
the security consequences of passing REMOTE_API_TOKEN in a URL, and worked Home Assistant
and plain-HTML examples.
-->

# Embedding the remote

The appliance serves a second, self-contained remote at **`/embed`**, designed to be
dropped into an `<iframe>` on a home panel, a dashboard, or an internal page. It is not
the SPA in a smaller window: it is a separate bundle with no navigation, no device list
and no settings, and it sizes itself to whatever box you give it.

```html
<iframe
  src="http://tv-remote.lan:7433/embed?device=aabbccddeeff&layout=compact"
  width="240"
  height="320"
  style="border: 0"
  title="Living Room TV remote"
></iframe>
```

That is the whole integration. Everything else on this page is optional tuning.

## How it is served

The embed is a **second Vite entry**, not a route inside the SPA. `npm run build` in
`web/` emits `dist/index.html` for the SPA and `dist/embed.html` for the remote, sharing
their common chunks. A host page's iframe therefore downloads the remote and nothing else.

That means the appliance must map the extensionless path **`/embed` to
`dist/embed.html`**, ahead of the `StaticFiles` mount that serves the SPA at `/`. Without
that route the embed is only reachable at `/embed.html`, and every snippet on this page
404s. The Vite dev server does the same rewrite so `npm run dev` behaves identically.

## Query parameters

Configuration is entirely in the URL — there is no `postMessage` API and nothing to
script.

| Parameter | Values | Default | Meaning |
|---|---|---|---|
| `device` | a device id | *(required)* | Which TV to control. The MAC lowercased with colons stripped, e.g. `aabbccddeeff`. `GET /api/devices` lists them. |
| `layout` | `dpad`, `touchpad`, `compact`, `full` | `compact` | Which controls to show (see below). |
| `keys` | comma-separated group names | *(layout default)* | Explicit allowlist that overrides the layout's control set. |
| `theme` | `auto`, `light`, `dark` | `auto` | `auto` follows the viewer's `prefers-color-scheme` and re-themes live if it changes. |
| `bg` | `transparent` | *(opaque)* | Do not paint a background, so the frame composites over the host panel. |
| `header` | `0` / `1` | on, except `layout=dpad` | Show the device-name and connection strip. Also accepts `false`/`no`/`off`. |
| `token` | the API token | *(none)* | Required only when the appliance runs with `REMOTE_API_TOKEN` set. Read the security note below first. |

An unrecognised value for any enumerated parameter falls back to its default rather than
erroring, so a typo degrades to the standard remote instead of a blank frame.

### `layout`

| Layout | Controls | Good frame size |
|---|---|---|
| `dpad` | Just the D-pad, no status strip. | 200×200 and up |
| `touchpad` | A swipe surface, plus Back and Home. | 240×280 and up |
| `compact` | D-pad, Back / Home / Power, volume. **The default.** | 240×320 and up |
| `full` | `compact` plus a transport row (rewind, play-pause, fast-forward). | 280×420 and up |

`full` does fit in 240×320, but the D-pad arrows end up around 42px — under the usual
44px touch-target guideline. Use `compact` in frames that small, or give `full` more room.

### `keys`

`keys` overrides whatever the layout would have shown, so a panel can embed one strip
rather than a whole remote. The groups are `dpad`, `back`, `home`, `power`, `transport`
and `volume`.

```html
<!-- A volume strip and nothing else. -->
<iframe src="/embed?device=aabbccddeeff&keys=volume" width="240" height="90"></iframe>

<!-- One big power button. -->
<iframe src="/embed?device=aabbccddeeff&keys=power&header=0" width="120" height="120"></iframe>
```

Unknown group names and duplicates are dropped. If nothing recognisable survives — you
mistyped every one — the layout's default set is used rather than rendering an empty box.

Note that `keys` picks the *groups*; `layout` still decides whether the directional group
is a D-pad or a touchpad. `?layout=touchpad&keys=dpad,volume` is a touchpad with a volume
row.

## Sizing

Give the iframe a fixed width and height and the remote fills it. It reads its own frame
as a CSS size container, so there are no breakpoints to hit and no scrollbars in either
axis at any size: buttons, gaps, icons and text all scale with the box. Below roughly
360px tall it drops the wordy half of the status strip and keeps the colour dot.

The remote stops growing past 26rem wide and 42rem tall and centres itself, so a very
large frame gets a sensibly proportioned remote rather than a stretched one.

Do not set `scrolling="no"` or fuss with `overflow` — the embedded document is already
`overflow: hidden` on both axes.

### Transparent background

`?bg=transparent` stops the frame painting anything behind the buttons, so it composites
over whatever your panel's background is:

```html
<iframe src="/embed?device=aabbccddeeff&bg=transparent" style="border:0;background:transparent"></iframe>
```

Combine it with `theme=dark` or `theme=light` to pick button colours that suit your panel.
Note that `bg=transparent` also stops the frame declaring a `color-scheme`, because a
declared scheme makes the browser paint an opaque canvas behind the frame regardless of
what the page's own CSS says.

## Who is allowed to frame it

The appliance sends a `Content-Security-Policy: frame-ancestors` header built from the
**`FRAME_ANCESTORS`** environment variable. It defaults to `*`, which lets any page on
any origin frame the remote.

```yaml
# docker-compose.yml
services:
  androidtv-remote:
    environment:
      FRAME_ANCESTORS: "https://homeassistant.lan:8123 https://panel.lan"
```

Space-separate multiple origins. Set it to `'none'` to disable embedding entirely.

Restricting this is the only thing that stops an arbitrary page on your network from
framing the remote and driving your TV, so narrow it as soon as you know which panel is
actually going to use it.

## Authentication, and why the token is in the URL

If you run with `REMOTE_API_TOKEN` set, the embed needs it too — pass it as
`?token=<token>`.

This is a genuine trade-off, not an oversight. An `<iframe src>` cannot set an
`Authorization` header, and neither can the browser's `WebSocket` constructor, so a query
parameter is the only way to authenticate the initial frame load and the live state
stream. Once running, the embed *does* use an `Authorization: Bearer` header for its
ordinary REST calls, which keeps the token out of the appliance's request logs for
everything except the socket handshake.

What that means for you:

- **The token is visible** in the host page's HTML source, in the browser history of
  anyone using that panel, and in any proxy or referrer logs along the way.
- **Narrow `FRAME_ANCESTORS`** whenever the token is in a URL. It is what stops another
  page from simply reusing it.
- **Prefer leaving auth off** on a trusted home LAN — that is the default, and the
  appliance is designed to work with zero configuration.
- Do not paste an embed URL containing a token into a shared document, a screenshot, or
  an issue tracker.

## Live state

The embed opens a WebSocket to `/api/ws` and reflects power, volume and mute for its one
device as they change — including changes made from the TV's own remote. If the socket
cannot be established it falls back to polling `GET /api/devices/{id}/state` every five
seconds and keeps retrying the socket with backoff, so a restarting appliance recovers on
its own. The status dot dims while the live stream is down.

## When the TV cannot be driven

If the device is unpaired, disabled, unreachable, or the id in the URL does not exist, the
frame shows a short explanation and a link that opens the full remote in a new tab, rather
than a D-pad whose buttons quietly do nothing. A TV that is merely switched off is *not*
one of those cases — the remote stays fully live, because the power button is exactly what
you want in that situation.

## Home Assistant

Use a [Webpage card](https://www.home-assistant.io/dashboards/iframe/):

```yaml
type: iframe
url: http://tv-remote.lan:7433/embed?device=aabbccddeeff&layout=compact&bg=transparent
aspect_ratio: 75%
```

`aspect_ratio` is height ÷ width as a percentage; `75%` gives a 4:3 box. For the taller
`full` layout try `150%`. In a `grid` or `masonry` view, put the card in its own column so
Home Assistant does not stretch it.

Home Assistant serves its dashboard from its own origin, so add it to `FRAME_ANCESTORS`:

```yaml
FRAME_ANCESTORS: "http://homeassistant.lan:8123"
```

## A wall panel with several TVs

```html
<div style="display: flex; gap: 16px">
  <iframe src="/embed?device=aabbccddeeff&layout=compact" width="240" height="320"
          style="border:0" title="Living Room"></iframe>
  <iframe src="/embed?device=001122334455&layout=compact" width="240" height="320"
          style="border:0" title="Bedroom"></iframe>
</div>
```

Each frame holds its own WebSocket, so they update independently. Give every iframe a
`title` — it is what a screen reader announces before entering the frame.

## Accessibility

Every control is a real `<button>` with an `aria-label`, so the frame is tab-navigable and
announces properly. The `touchpad` layout, which has no discrete buttons, additionally
responds to the arrow keys and Enter. Pinch-zoom is left enabled.
