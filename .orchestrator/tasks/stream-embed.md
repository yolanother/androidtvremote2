# Stream: Embeddable iframe remote

**Worktree:** `.claude/worktrees/embed` — branch `stream-embed`. Work ONLY in there.

## Goal
A compact remote at `/embed` that drops into an `<iframe>` on internal sites and home
panels (Home Assistant dashboards, wall tablets) and just works.

## Read first
- `docs/design/api-contract.md` — the contract. Frozen.
- `web/src/lib/api-types.ts` — the TypeScript mirror. **Frozen — import it, don't edit it.**
- `docs/design/architecture.md` — the `FRAME_ANCESTORS` CSP knob and the `?token=` auth form
  (an `<iframe src>` cannot set an `Authorization` header, which is exactly why the query
  form exists)
- `docs/design/conventions.md` — TS/CSS header format

## Files to touch
- `web/src/embed/**` — the entire embed view, self-contained
- `web/index.html` / a second Vite entry if a separate bundle is warranted
- `docs/embedding.md` — operator-facing embedding guide

**Do not touch anything else under `web/`.** The main UI is being built in parallel on
another branch. Build the embed remote self-contained rather than importing from
`web/src/components/**`, which does not exist yet on your branch — a compact panel remote
has genuinely different constraints from the full app, and we will factor out anything
that turns out to be real duplication after both land.

## Requirements
- Route `/embed`, configured entirely by query params:
  - `?device=<device_id>` — required; which TV to control
  - `?token=<token>` — optional, when `REMOTE_API_TOKEN` is set
  - `?layout=dpad|touchpad|compact|full` — default `compact`
  - `?theme=dark|light|auto` — default `auto`
  - `?keys=power,home,back,dpad,volume` — optional explicit key allowlist, so a panel can
    embed just a volume strip or just a power button
- **Sized for a panel, not a page.** No app chrome, no nav, no scrollbars. It must look
  right in an iframe as small as 240×320 and scale up gracefully. Use container queries.
- Reactive: subscribe to `/api/ws` for that one device and reflect power/app/volume live.
  Fall back to `GET /api/devices/{id}/state` polling only if the socket fails.
- Transparent background option (`?bg=transparent`) so it can sit on a themed panel.
- Degrade honestly: if the device is `unreachable` or `unpaired`, say so inside the frame
  with a link that opens the full UI in a new tab to fix it. Never render a dead D-pad.
- Touch-first, big targets, no double-tap zoom, no text selection.
- Accessible: real buttons, `aria-label`s, keyboard operable inside the frame.

## `docs/embedding.md`
Operator-facing and copy-pasteable: a worked `<iframe>` snippet, the full query-param table,
sizing guidance, how to set `FRAME_ANCESTORS` to restrict who may frame it, a Home Assistant
`iframe` card example, and a note that the token appears in the URL so `FRAME_ANCESTORS`
should be narrowed on any untrusted network.

## Acceptance criteria
- [ ] `npm run build` in `web/` passes.
- [ ] `npx oxlint` clean.
- [ ] Verify it for real: `npm run dev`, then use the Playwright or chrome-devtools MCP
      tools to load a page containing an actual `<iframe src="/embed?device=test&layout=compact">`
      at 240×320 and at 420×640. Screenshot both. Confirm no scrollbars and no clipping.
- [ ] Every query param above is honoured.
- [ ] Headers per conventions.md.

## Out of scope
Anything under `server/`, `tray/`, `docker/`, or `web/` outside `web/src/embed/**` and the
Vite entry wiring. Do not edit `web/src/lib/api-types.ts`.
