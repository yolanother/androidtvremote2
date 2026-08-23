/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The LLM integration screen of the Android TV Remote web UI. Explains the three ways an
 * agent or an AI-assisted build can drive this appliance — the built-in MCP server, the
 * REST API directly, and the embeddable iframe remote — and hands over copy-ready prompts
 * and snippets for each, all generated against THIS appliance's origin, its registered
 * televisions, and its live key catalog, so what the reader pastes into an agent needs no
 * editing. Includes an interactive embed builder that assembles the iframe URL from the
 * documented query parameters and previews the result inline.
 */
import { useMemo, useState } from 'react'
import { Bot, Code2, MonitorSmartphone, Plug, ShieldAlert } from 'lucide-react'

import { Card, CodeBlock, SectionHeading } from '@/components/CodeBlock'
import { Page, PageHeader } from '@/components/AppShell'
import { cn } from '@/lib/utils'
import { getToken } from '@/lib/api'
import { useRemote } from '@/state/store'
import type { EmbedLayout, EmbedTheme } from '@/embed/config'

/** Embed layouts, with the frame size each one is designed for. */
const LAYOUTS: Array<{ id: EmbedLayout; label: string; size: string; blurb: string }> = [
  { id: 'dpad', label: 'D-pad', size: '200×200', blurb: 'Just the D-pad, no status strip.' },
  { id: 'touchpad', label: 'Touchpad', size: '240×280', blurb: 'Swipe surface, Back and Home.' },
  { id: 'compact', label: 'Compact', size: '240×320', blurb: 'D-pad, Back/Home/Power, volume.' },
  { id: 'full', label: 'Full', size: '280×420', blurb: 'Compact plus a transport row.' },
]

/** Colour schemes the embed accepts. */
const THEMES: EmbedTheme[] = ['auto', 'light', 'dark']

/**
 * The LLM integration screen.
 */
export function LlmPage() {
  const { state } = useRemote()
  const origin = window.location.origin
  const token = getToken()
  const device = state.devices[0]
  const deviceId = device?.id ?? 'aabbccddeeff'

  return (
    <Page>
      <PageHeader
        title="LLM integration"
        description="Three ways to put this appliance in an agent's hands. Every snippet below is generated for this appliance, so it is ready to paste as-is."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <RouteCard
          href="#mcp"
          Icon={Plug}
          title="MCP server"
          blurb="Built in at /mcp. The shortest path for Claude Code, Claude Desktop, or any MCP client."
        />
        <RouteCard
          href="#rest"
          Icon={Code2}
          title="Direct REST"
          blurb="For an agent that owns its own tools, or a script that calls the API itself."
        />
        <RouteCard
          href="#embed"
          Icon={MonitorSmartphone}
          title="Embedded remote"
          blurb="Have an assistant drop a working remote into a page it is building."
        />
      </div>

      <Card>
        <h2 id="mcp" className="scroll-mt-20 text-base font-semibold">
          MCP server
        </h2>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          The appliance serves an MCP server over streamable HTTP on the same port as this UI.
          There is no separate process and nothing to install — point a client at it and the
          agent can discover, register, pair with, and drive televisions.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <CodeBlock caption="endpoint" code={`${origin}/mcp`} />
          <CodeBlock
            caption="claude code"
            code={
              token
                ? `claude mcp add --transport http androidtv ${origin}/mcp \\\n  --header "Authorization: Bearer $REMOTE_API_TOKEN"`
                : `claude mcp add --transport http androidtv ${origin}/mcp`
            }
          />
          <CodeBlock
            caption="claude_desktop_config.json"
            code={JSON.stringify(
              {
                mcpServers: {
                  androidtv: {
                    type: 'http',
                    url: `${origin}/mcp`,
                    ...(token ? { headers: { Authorization: 'Bearer your-token-here' } } : {}),
                  },
                },
              },
              null,
              2,
            )}
          />
          <CodeBlock
            caption="prompt to get started"
            code={`You have an androidtv MCP server connected to a local Android TV appliance.

Do this:
1. List the registered televisions and tell me which are connected.
2. If "${device?.name ?? 'Living Room TV'}" is not paired, start pairing and ask me for the
   code shown on the television screen.
3. Once it is connected, open Netflix on it and pause playback.

Report what you did, and stop and ask if a television is unreachable rather than retrying
in a loop.`}
          />
        </div>
      </Card>

      <Card>
        <h2 id="rest" className="scroll-mt-20 text-base font-semibold">
          Driving the REST API directly
        </h2>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          Give an agent the block below as a system prompt (or a tool description) and it has
          everything it needs: the base URL, the auth scheme, the identifier convention, the
          endpoints, and the failure modes it should not paper over.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <CodeBlock caption="system prompt" code={restPrompt(origin, state.devices.map((d) => `${d.id} — ${d.name}`), Boolean(token))} />
          <CodeBlock
            caption="worked example"
            code={`# Send a key
curl -X POST '${origin}/api/devices/${deviceId}/keys' \\
${token ? "  -H 'Authorization: Bearer $REMOTE_API_TOKEN' \\\n" : ''}  -H 'Content-Type: application/json' \\
  -d '{"key":"KEYCODE_DPAD_DOWN"}'

# Launch an app
curl -X POST '${origin}/api/devices/${deviceId}/launch' \\
${token ? "  -H 'Authorization: Bearer $REMOTE_API_TOKEN' \\\n" : ''}  -H 'Content-Type: application/json' \\
  -d '{"app":"com.netflix.ninja"}'

# Read live state (snapshot, then deltas)
websocat '${origin.replace(/^http/, 'ws')}/api/ws${token ? '?token=$REMOTE_API_TOKEN' : ''}'`}
          />
          <p className="text-muted-foreground text-sm text-pretty">
            The full endpoint list, with a playground that sends real requests, is on the{' '}
            <a href="/reference" className="underline underline-offset-2">
              API reference
            </a>{' '}
            page. The appliance's key catalog currently has{' '}
            <strong>{state.keys.length || '—'}</strong> keys and{' '}
            <strong>{state.apps.length || '—'}</strong> known apps; an agent should read
            <code className="mx-1 font-mono text-xs">/api/keys</code> and
            <code className="mx-1 font-mono text-xs">/api/apps</code> rather than guessing names.
          </p>
        </div>
      </Card>

      <EmbedSection origin={origin} />

      <Card className="border-pairing/40 bg-pairing/[0.06]">
        <SectionHeading
          title="Before you hand this to an agent"
          icon={<ShieldAlert aria-hidden className="size-4" />}
        />
        <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm">
          <li>
            An agent with this API can turn televisions on and off and type into them. Scope it to
            a network you control.
          </li>
          <li>
            A token in an iframe URL or a WebSocket query string is visible in browser history and
            server access logs. Prefer the <code className="font-mono text-xs">Authorization</code>{' '}
            header wherever the client can set one.
          </li>
          <li>
            Pairing needs a human once: the code is shown on the television, not returned by the
            API. An agent should ask for it rather than pretend it can read the screen.
          </li>
        </ul>
      </Card>
    </Page>
  )
}

/**
 * Build the copy-ready system prompt that teaches an agent this appliance's REST API.
 *
 * @param origin - The appliance's origin, so the prompt needs no editing.
 * @param devices - Registered televisions, rendered as `id — name` lines.
 * @param authenticated - Whether a token is configured in this browser.
 * @returns The prompt text.
 */
function restPrompt(origin: string, devices: string[], authenticated: boolean): string {
  return `You control Android TV and Google TV devices through a local appliance at
${origin}. It exposes a JSON REST API under /api.

Auth: ${
    authenticated
      ? 'send `Authorization: Bearer <token>` on every request.'
      : 'this appliance is unauthenticated; send no auth header.'
  }
Device ids are the television's MAC address, lowercased with colons stripped.

${devices.length > 0 ? `Registered televisions:\n${devices.map((line) => `  ${line}`).join('\n')}` : 'No televisions are registered yet; register one with POST /api/devices.'}

Endpoints you will need:
  GET    /api/devices                      list televisions and their live state
  POST   /api/devices                      { host, name? } register one
  POST   /api/devices/{id}/pair            begin pairing; the code appears on the TV
  POST   /api/devices/{id}/pair/complete   { code } finish pairing
  POST   /api/devices/{id}/keys            { key, direction?, repeat? } send a key
  POST   /api/devices/{id}/text            { text } type into the focused field
  POST   /api/devices/{id}/launch          { app } launch an app by package name
  POST   /api/devices/{id}/power           { on: true | false | null } null toggles
  POST   /api/devices/{id}/volume          { action? , level? }
  POST   /api/devices/{id}/media           { action, position? } casting sessions only
  GET    /api/keys                         the key catalog — use it, do not guess names
  GET    /api/apps                         known apps and their package names
  GET    /api/discovery                    televisions seen on the network but not registered

Rules:
- Read GET /api/devices before acting; connection is one of connected, connecting,
  disconnected, unreachable, unpaired, disabled.
- Every failure is { "error": { "code", "message" } }. Handle unreachable (503) and
  not_paired (409) by telling the user what to do, not by retrying in a loop.
- now_playing is null unless something is casting to the television. That is normal and
  is not an error; fall back to the current app.
- Power is idempotent when you name the target state, so prefer { on: true } over a toggle.`
}

/**
 * The embed builder: assembles an iframe URL from the documented parameters and previews it.
 *
 * @param props.origin - The appliance's origin.
 */
function EmbedSection({ origin }: { origin: string }) {
  const { state } = useRemote()
  const [deviceId, setDeviceId] = useState(() => state.devices[0]?.id ?? '')
  const [layout, setLayout] = useState<EmbedLayout>('compact')
  const [theme, setTheme] = useState<EmbedTheme>('auto')
  const [header, setHeader] = useState(true)
  const [transparent, setTransparent] = useState(false)

  const effectiveId = deviceId || state.devices[0]?.id || 'aabbccddeeff'

  const url = useMemo(() => {
    const params = new URLSearchParams({ device: effectiveId, layout, theme })
    if (!header) params.set('header', '0')
    if (transparent) params.set('bg', 'transparent')
    return `${origin}/embed?${params.toString()}`
  }, [effectiveId, header, layout, origin, theme, transparent])

  const size = LAYOUTS.find((entry) => entry.id === layout)!.size.split('×')

  return (
    <Card>
      <h2 id="embed" className="scroll-mt-20 text-base font-semibold">
        Embedded remote
      </h2>
      <p className="text-muted-foreground mt-1 text-sm text-pretty">
        The appliance serves a second, self-contained remote at{' '}
        <code className="font-mono text-xs">/embed</code>, built to be dropped into an iframe on
        a dashboard or a page an assistant is generating. It is configured entirely through the
        URL — there is no script to load and no postMessage API.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">Television</span>
            <select
              value={effectiveId}
              onChange={(event) => setDeviceId(event.target.value)}
              disabled={state.devices.length === 0}
              className="bg-card min-h-11 w-full cursor-pointer rounded-xl border px-3 text-base outline-none focus-visible:border-ring disabled:opacity-60"
            >
              {state.devices.length === 0 ? (
                <option value="aabbccddeeff">No televisions registered</option>
              ) : (
                state.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <fieldset>
            <legend className="text-muted-foreground mb-1.5 text-xs font-medium">Layout</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LAYOUTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={layout === entry.id}
                  onClick={() => setLayout(entry.id)}
                  className={cn(
                    'cursor-pointer rounded-xl border p-2 text-left transition-colors',
                    layout === entry.id ? 'border-ring bg-secondary' : 'hover:bg-accent',
                  )}
                >
                  <span className="block text-sm font-medium">{entry.label}</span>
                  <span className="text-muted-foreground block font-mono text-[11px]">
                    {entry.size}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs">
              {LAYOUTS.find((entry) => entry.id === layout)!.blurb}
            </p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground text-xs font-medium">Theme</span>
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value as EmbedTheme)}
                className="bg-card min-h-11 cursor-pointer rounded-xl border px-3 text-sm outline-none focus-visible:border-ring"
              >
                {THEMES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={header}
                onChange={(event) => setHeader(event.target.checked)}
                className="size-4 cursor-pointer"
              />
              Status strip
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(event) => setTransparent(event.target.checked)}
                className="size-4 cursor-pointer"
              />
              Transparent background
            </label>
          </div>
        </div>

        {/* The preview is the real embed entry, so what is previewed is what ships. */}
        <div className="flex flex-col items-center gap-2">
          <iframe
            key={url}
            src={url}
            title="Embedded remote preview"
            width={size[0]}
            height={size[1]}
            className="rounded-xl border"
          />
          <span className="text-muted-foreground font-mono text-[11px]">
            {size[0]}×{size[1]}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <CodeBlock caption="url" code={url} />
        <CodeBlock
          caption="html"
          code={`<iframe
  src="${url}"
  width="${size[0]}"
  height="${size[1]}"
  style="border: 0"
  title="Television remote"
></iframe>`}
        />
        <CodeBlock
          caption="prompt for a coding assistant"
          code={`Add a television remote to this page.

The remote is served by an appliance at ${origin} and is embedded as an iframe — there is
no package to install and no JavaScript API. Use exactly this element:

<iframe src="${url}" width="${size[0]}" height="${size[1]}" style="border:0"
        title="Television remote"></iframe>

Notes:
- Configuration is entirely in the query string: device (the TV's MAC, lowercased, colons
  stripped), layout (dpad | touchpad | compact | full), theme (auto | light | dark),
  keys (comma-separated: dpad, back, home, power, transport, volume), bg=transparent,
  header=0.
- Keep the frame at least ${size[0]}×${size[1]}; smaller than that pushes the D-pad arrows
  under the 44px touch-target minimum.
- Do not proxy or re-host it, and do not scale it with a CSS transform — it sizes itself to
  whatever box you give it.
- The appliance must allow your page to frame it: its FRAME_ANCESTORS setting has to list
  your origin.`}
        />
      </div>
    </Card>
  )
}

/**
 * A jump link to one of the integration routes.
 *
 * @param props.href - In-page anchor.
 * @param props.Icon - Leading glyph.
 * @param props.title - Route name.
 * @param props.blurb - One-line explanation.
 */
function RouteCard({
  href,
  Icon,
  title,
  blurb,
}: {
  href: string
  Icon: typeof Bot
  title: string
  blurb: string
}) {
  return (
    <a
      href={href}
      className="bg-card hover:bg-accent flex flex-col gap-1.5 rounded-2xl border p-4 shadow-sm transition-colors"
    >
      <span className="bg-secondary text-muted-foreground grid size-8 place-items-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-muted-foreground text-xs text-pretty">{blurb}</span>
    </a>
  )
}
