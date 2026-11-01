<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

How the Android TV Remote web UI works as an installable progressive web app: what the
service worker does and — more importantly — what it deliberately refuses to cache, how to
install it on Android and iOS, why installation does not work over a plain
`http://192.168.x.x` LAN address and what the practical ways around that are, and how to
clear a stuck service worker when debugging. Read this before changing anything under
web/src/pwa, web/public, or the PWA block in web/vite.config.ts.
-->

# Installing the remote as an app

The web remote is a progressive web app. Installed, it launches from the home screen with
no browser chrome, in portrait, on the app's own dark surface — the thing you actually want
from a remote you open twenty times a day.

## Read this first: it will not install over `http://192.168.1.209:7433`

**Installing a PWA requires a secure context, and a bare LAN IP address over plain HTTP is
not one.** This is a browser rule, not something the appliance can opt out of. `localhost`
and `127.0.0.1` are special-cased as secure; `192.168.x.x` is not.

This was measured, not assumed. The same build was served from two origins and Chrome was
asked directly (`Page.getInstallabilityErrors`, the command behind the DevTools
Application ▸ Manifest panel):

| Origin | Secure context | `navigator.serviceWorker` | Chrome's installability verdict |
|---|---|---|---|
| `http://127.0.0.1:7455/` | yes | present | `[]` — no errors, installable |
| `http://192.168.1.209:7455/` | **no** | **undefined** | `[{ "errorId": "not-from-secure-origin" }]` |

The manifest itself is clean on both: zero parse errors, four icons. **The origin is the
only thing blocking installation.**

Note what the second row means beyond the install button: on an insecure origin
`navigator.serviceWorker` does not merely fail, it **does not exist**, and neither does the
`caches` API. So over plain HTTP there is no service worker, no precache, and no offline
shell either. The app still works perfectly as a normal web page — it just cannot be
installed and gains nothing from the worker.

### What the operator actually sees at `http://192.168.1.209:7433`

- The remote loads and works exactly as before. Nothing is broken.
- Settings ▸ Install shows a plain explanation that the appliance is on plain HTTP and the
  browser will not install it. There is no dead button to press.
- Chrome's ⋮ menu still offers **Add to Home Screen**. On an insecure origin this makes a
  *shortcut*, not an installed app: it gets an icon on the home screen, but tapping it
  opens a normal browser tab with the address bar and browser UI, not a standalone window.
  Useful, but it is not the real thing.
- **iPhone and iPad are the exception.** Safari's Share ▸ Add to Home Screen is a
  user-driven bookmark and is offered on any page, secure or not, so an iOS home-screen
  icon works over plain HTTP today. Whether it opens standalone depends on iOS reading
  `apple-mobile-web-app-capable` / the manifest's `display`, which the page sends. This is
  the one part of this document that has **not** been verified on a real device — no iOS
  hardware was available. Treat it as expected behaviour, not measured behaviour.

### Getting a real install: put the appliance behind HTTPS

Any of these gives the appliance a secure origin, after which Chrome on Android installs it
properly, with the maskable icon and a standalone window. They are listed cheapest first.

1. **Tailscale Serve.** If the appliance is already on a tailnet, `tailscale serve` puts it
   behind `https://<machine>.<tailnet>.ts.net` with a real, auto-renewed certificate and no
   DNS or port-forwarding work at all. This is the least effort by a wide margin, and it
   works from outside the house as a bonus.
2. **A reverse proxy with a real certificate.** Caddy or Traefik in front of port 7433, with
   a hostname on a domain you own and a Let's Encrypt **DNS-01** challenge (DNS-01 because
   the appliance is not reachable from the public internet, so HTTP-01 cannot validate).
   Point the hostname at `192.168.1.209` with a local DNS override or a public A record for
   the private address.
3. **Your own CA, installed on the phone.** Generate a CA, issue a certificate for the
   appliance's hostname, install the CA in Android's user trust store (Chrome on Android
   honours user-installed CAs). Works, but every device needs the CA installed, and it is
   the option most likely to be quietly broken by an OS update.

A **self-signed certificate with no CA** is not sufficient. Clicking through the
interstitial gets you the page but leaves the origin untrusted, and it stays uninstallable.

For desktop debugging only, Chrome's
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` will force one named origin to be
treated as secure. Do not ship this to a household — it is a per-device developer setting
that weakens the browser.

## Pointing the UI at your HTTPS origin: `PUBLIC_URL`

Set `PUBLIC_URL` in `.env` to the HTTPS origin the appliance is also reachable at:

```sh
.orchestrator/scripts/dev-config.sh env set PUBLIC_URL https://remote.example.net
docker compose up -d
```

It is advisory only — the appliance never connects to it, and it changes nothing about how
the server listens. It changes one thing: what the Settings screen's **Install** section
does.

| Where you opened the remote | `PUBLIC_URL` set | What Install shows |
|---|---|---|
| `https://remote.example.net` | either | The real install button |
| `http://192.168.1.50:7433` | yes | A link to `https://remote.example.net` to install from there |
| `http://192.168.1.50:7433` | no | **Nothing at all** |

The last row is deliberate. Telling someone "this cannot be installed" is not something
they can act on, so the section is hidden entirely rather than explaining a dead end. The
appliance refuses to start if `PUBLIC_URL` is an `http://` URL, because advertising a
plaintext origin would send people somewhere the install still cannot happen.

Any of these gets you an HTTPS origin — pick whatever you already run:

- A reverse proxy terminating TLS (nginx, openresty, Caddy, Traefik) with a Let's Encrypt
  certificate on a hostname that resolves to the appliance.
- A Cloudflare Tunnel, which needs no port forwarding and no inbound firewall rule.
- Tailscale or a similar mesh VPN with HTTPS on the tailnet name.

Whichever you choose, **the proxy must forward WebSocket upgrades to `/api/ws`** or the UI
loads and then sits there never receiving live state.

A public hostname does not make the appliance private. If the origin is reachable from the
internet and `REMOTE_API_TOKEN` is unset, anyone who resolves the name can list your
televisions and control them. Restrict the origin at your firewall or VPN, set a token, or
both. See `.env.example`.

## Installing

### Android (Chrome or Edge), on a secure origin

Open the remote, go to **Settings ▸ Install**, tap **Install app**, confirm in the browser's
dialog. Chrome's own ⋮ ▸ Install app works too. The button is only shown when the browser
has actually offered an install; it is never rendered as a button that would do nothing.

### iPhone and iPad

iOS never fires `beforeinstallprompt`, so there is no button to press. Settings ▸ Install
shows the manual steps instead:

1. Tap **Share** at the bottom of Safari.
2. Scroll down and tap **Add to Home Screen**.
3. Tap **Add**.

### Firefox and desktop Safari

Neither supports the install prompt. Settings ▸ Install says so plainly rather than showing
a button.

## What the service worker caches — and what it must never cache

The worker precaches **the app shell only**: `index.html`, the hashed JS and CSS bundles,
the icons, and the manifest. Fourteen files, about 620 KiB.

These paths are **permanently excluded** and always go to the network:

| Path | Why |
|---|---|
| `/api/**` | Carries the device list and every live state snapshot. A cached response would show phantom devices, a stale power state, or a volume that never moves. |
| `/api/ws` | The live state socket. (Service workers never see WebSocket handshakes at all, so this is belt and braces.) |
| `/healthz` | A liveness probe. A cached `200` would be a lie. |
| `/mcp` | The agent transport. |
| `/embed` | A second Vite entry that other people's pages iframe. It must stay a plain, always-fresh document. |

This is enforced twice in `web/vite.config.ts`, from one `NEVER_CACHED` list: each pattern
gets an explicit workbox `NetworkOnly` route, and the same patterns form the
`navigateFallbackDenylist` so a navigation to one of them is never answered with the SPA
shell from cache.

Verified with the worker active and controlling the page: three `fetch('/api/devices')`
calls produced exactly three new hits in the origin server's access log, and
`caches.match()` reports nothing stored for `/api/devices`, `/api/discovery`, `/healthz`,
`/embed` or `/embed.html`. With the origin server stopped entirely, the app shell still
rendered from precache while `/api/devices` failed with a hard network error rather than
serving a stale device list — which is the correct behaviour.

### `/embed` is not part of the PWA

`embed.html` is excluded from the precache, is on the navigation denylist, carries no
manifest link, and does not register the worker. Loading `/embed` on a clean profile creates
zero service worker registrations and zero caches — verified.

Because the worker's scope has to be `/` for the app itself, an `/embed` page *is* still
within scope and will be controlled if the visitor previously opened the SPA. That is
harmless: every `/embed` request is routed `NetworkOnly`, so the document is always fetched
fresh. Its hashed JS chunks may be shared with the SPA and served from precache, which is
safe because the filename pins the content.

`vite-plugin-pwa` runs with `manifest: false` and `injectRegister: null` for this reason:
its own HTML transform runs against *every* entry, so letting it inject would have made
`embed.html` a PWA too. `index.html` carries the manifest link and the registration script
by hand instead.

## Updates

`registerType` is `prompt`. When a new build is deployed, the waiting worker does not take
over on its own — the app shows a "A new version of the remote is ready" banner with
**Reload** and a dismiss button. Returning to the installed app, focusing its window
or reconnecting it checks for an update; duplicate events are limited to one check
per minute and one request at a time. Offline/failing checks are caught and can be
retried. The registration is also re-checked hourly, so a wall-mounted panel that
is never reloaded still learns about a new build. An already-waiting worker is
offered immediately on startup.

The notice reserves its measured height above the remote, including the top safe
area on a notched phone. It never floats over the touchpad or volume/navigation
keys. Dismissing it restores the space. Only **Reload** activates the waiting
worker: opening, focusing or reconnecting the app never interrupts a held key or
text entry. Pairing and user preferences are retained during an update.
On phones the notice uses the concise “Update ready” label and 44-pixel actions,
so enlarged text does not turn an update message into a multi-line control obstruction.

Verified end to end: with the page open, a rebuild put the new worker into `waiting`, the
banner appeared, the old build kept rendering, and clicking **Reload** activated the new
worker and swapped in the new build.

## Clearing a stuck service worker when debugging

A stale worker is the usual cause of "I deployed but I still see the old UI".

**Desktop Chrome** — DevTools ▸ Application ▸ Service Workers ▸ **Unregister**, then
Application ▸ Storage ▸ **Clear site data**. Ticking **Update on reload** in the Service
Workers panel disables the waiting step entirely for the session, which is what you want
while iterating.

**Android Chrome** — Settings ▸ Site settings ▸ All sites ▸ the appliance's address ▸
**Clear & reset**. If the app is installed, uninstall it from the launcher first, since an
installed app keeps its own storage.

**From the console, on any platform:**

```js
;(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  for (const k of await caches.keys()) await caches.delete(k)
  location.reload()
})()
```

Note that this only works on a secure origin — on plain HTTP there is no worker to clear,
because there was never one to begin with.

## Files

| File | Role |
|---|---|
| `web/public/manifest.webmanifest` | The manifest. Hand-written, not generated. Served as `application/manifest+json` — Python's built-in mimetypes table knows the extension even in a container with no `/etc/mime.types`, verified inside the running appliance. |
| `web/public/icon-{192,512}.png` | `purpose: any` — the rounded-square app icon on transparency. |
| `web/public/icon-maskable-{192,512}.png` | `purpose: maskable` — full-bleed background with the glyph inside the central 80% safe circle. Without a maskable variant Android draws a white box behind the icon. |
| `web/public/apple-touch-icon.png` | 180px, opaque; iOS composites transparency onto black and applies its own mask. |
| `web/src/pwa/runtime.ts` | Registers the worker, tracks the waiting update, captures `beforeinstallprompt`. Loaded from `index.html` as its own module because that event fires during page load, long before React mounts. |
| `web/src/pwa/InstallSection.tsx` | The Settings ▸ Install block. |
| `web/src/pwa/UpdatePrompt.tsx` | The "new version ready" banner. |
| `web/vite.config.ts` | The `NEVER_CACHED` list and the workbox configuration. |

Regenerating the icons from `web/public/icon.svg` needs a rasteriser; headless Chrome was
used (`google-chrome --headless --screenshot=out.png --window-size=512,512
--default-background-color=00000000 file://…`), which avoids adding a native image
dependency to the web build for assets that change roughly never.
