<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Design and implementation notes for the Android TV Remote web console: the app shell
(header plus sidebar) that wraps every screen except the immersive remote, the landing
dashboard at /, the OpenAPI-driven API reference and its request playground, and the LLM
integration guide. Records the route table, why the remote deliberately sits outside the
shell, why the reference is generated rather than hand-written, and the constraints any
change to these screens has to keep. Read this before changing anything under
web/src/routes or web/src/components/AppShell.tsx.
-->

# Web console

The SPA has two halves with different rules.

**The remote** (`/d/:deviceId`) is a physical object rendered in a browser — full
viewport, never scrolls, no navigation chrome. It is designed in
[ui.md](ui.md) and is deliberately **outside** the app shell.

**The console** is everything else: a landing dashboard, device management, the API
reference, the LLM integration guide, and settings. These are read, not operated in the
dark, so they get conventional application chrome and use the width of a desktop display.

## Routes

| Route | Screen | In the shell |
|---|---|---|
| `/` | Landing dashboard — every television as a live card | yes |
| `/devices` | Device management: add, rename, re-pair, remove | yes |
| `/reference` | API reference and request playground | yes |
| `/llm` | LLM integration: MCP, direct REST, embedded iframe | yes |
| `/settings` | Token, theme, install, appliance health | yes |
| `/d/:deviceId` | The remote for one television | **no** |
| `/embed` | Separate Vite entry, framed by other pages | **no** |

`/` used to redirect to the last-used television. It no longer does: the dashboard is the
index, and "resume the last television" is an explicit button on it. Because of that the
remote header carries its own link back to the console — losing the index redirect would
otherwise have left the remote with no way home.

### Why the reference is at `/reference`, not `/api-docs`

The Vite dev server proxies everything prefixed `/api` to the appliance, so a client-side
route under that prefix is swallowed in development and only works in a production build.
Any new console route must not start with `/api`, `/mcp`, or `/healthz`.

## App shell

`web/src/components/AppShell.tsx`.

- **Header** (sticky, `z-30`): drawer trigger below `lg`, the wordmark, and a pill showing
  the browser's own WebSocket state plus a connected-count. Appliance reachability is
  chrome, not page content — a console whose controls silently do nothing is the failure
  the header exists to make obvious.
- **Sidebar**: a persistent 16–17rem rail from `lg` up with its own scroll container; an
  off-canvas drawer below that (backdrop `z-40`, panel `z-50`), dismissed by Escape, by
  the backdrop, and by any navigation.
- **Quick remote links**: the sidebar's second section lists every registered television
  with its live `StatusDot`, so switching remotes never costs a trip through a list. This
  is the reason the sidebar exists; do not reduce it to top-level navigation only.
- **Skip link** to `#main`, and exactly one `<main>` landmark.
- `Page` caps prose screens at `max-w-5xl` and dashboards (`wide`) at `1600px`;
  `PageHeader` renders the single `h1`.

## Landing dashboard

`web/src/routes/HomePage.tsx`. One card per television: identity, live status, and one
line of detail (now playing, else the foreground app, else the model or host) in a
fixed-height row so a state change never resizes the card under the pointer. Actions are
**Open remote** (plain navigation — no Fullscreen API), a power toggle with the same
optimistic local flip the remote uses, and a link to manage the device. An unpaired
television offers **Pair** in place of Open remote, because opening its remote would only
show a pairing prompt.

Beside the grid sits a column carrying appliance facts, entry points into the reference,
LLM guide and embed builder, and the PWA install block. Counts come from the live store,
not `/healthz` — that probe runs once per page load and would go stale as soon as a
television connects. `/healthz` supplies only the version and the public URL.

## API reference and playground

`web/src/routes/ApiDocsPage.tsx`, backed by `web/src/lib/openapi.ts`.

The endpoint list is generated from the appliance's own `/api/openapi.json` at runtime, so
it can never describe a build other than the one answering. Hand-written sections cover
what OpenAPI does not carry: the base URL, the auth scheme, the shared error envelope and
its code table, and the `/api/ws` event stream.

The playground sends the **real** request against this appliance with the token from
settings, and shows status, elapsed time, response body, and an equivalent `curl`. A
`device_id` path parameter is offered as a dropdown of registered televisions rather than
a free-text box. Request bodies are pre-filled by walking the schema
(`exampleFromSchema`): explicit `example`, then `default`, then the first `enum` member,
then a value derived from the type; a nullable `anyOf` uses its first non-null member.
`web/src/lib/openapi.test.ts` covers that logic — run it with `npm run test` in `web/`,
which uses Node's built-in test runner and type stripping (the project has no test
framework, and adding one for a single pure module was not worth the weight).

## LLM integration

`web/src/routes/LlmPage.tsx`. Three routes, in ascending order of effort: the built-in MCP
server at `/mcp`, the REST API directly, and the embeddable iframe. Every snippet is
generated against this appliance's origin, its registered televisions, and its live key
and app catalog counts, so what the reader copies needs no editing. The embed section is
an interactive builder over the documented query parameters (see
[embedding.md](../embedding.md)) that previews the real `/embed` entry inline — what is
previewed is what ships.

The page closes with the security notes that matter before handing an API to an agent:
tokens in URLs are visible in logs and history, and pairing needs a human to read a code
off the television.

## Constraints for any change here

- Never signal state by colour alone; every tinted card also carries `StatusDot` wording
  and, where it matters, a glyph.
- Reserve height for anything that arrives asynchronously.
- Touch targets stay at 44px (`min-h-11`); icon-only controls keep an `aria-label`.
- Both palettes are first-class — check light and dark before landing.
- The remote stays outside the shell. If a change needs the shell around it, that is a
  sign the change belongs on the console instead.
