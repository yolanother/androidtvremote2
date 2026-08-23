/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The landing screen of the Android TV Remote web UI, and the app's index route. Presents
 * every registered television as a live card — connection state, power, and whatever it is
 * playing — with a full-width button that opens that television's remote and an inline
 * power toggle, so the common case (pick up a remote for the TV in front of you) is one
 * tap from a cold start. Alongside it sits the appliance's own health, a shortcut into the
 * last television used, and entry points to the API reference, the LLM integration guide,
 * the embeddable remote, and installing the app. On a phone it is a single column; from
 * `lg` up the cards form a grid beside a persistent detail column.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  BookOpen,
  Bot,
  Code2,
  Maximize2,
  Play,
  Plus,
  Power,
  Settings2,
  Tv,
} from 'lucide-react'

import { AddDeviceDialog } from '@/components/AddDeviceDialog'
import { Btn, ErrorStrip, StatusDot } from '@/components/ui'
import { Card, SectionHeading } from '@/components/CodeBlock'
import { Page, PageHeader } from '@/components/AppShell'
import { PairingDialog } from '@/components/PairingDialog'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { foregroundApp } from '@/lib/media'
import { getLastDevice } from '@/lib/prefs'
import { InstallSection } from '@/pwa/InstallSection'
import { useHealth } from '@/lib/useHealth'
import { useRemote } from '@/state/store'
import type { ConnectionStatus, Device } from '@/lib/api-types'

/** Card tint per connection state. Colour is supporting detail only; every card also
 *  carries a `StatusDot` with the wording and, where it matters, a glyph. */
const CARD_TINT: Record<ConnectionStatus, string> = {
  connected: 'border-online/40 bg-online/[0.06]',
  connecting: 'border-pairing/40 bg-pairing/[0.06]',
  disconnected: 'bg-card',
  unreachable: 'border-destructive/40 bg-destructive/[0.06]',
  unpaired: 'border-pairing/40 bg-pairing/[0.06]',
  disabled: 'bg-card opacity-60',
}

/**
 * The landing screen.
 */
export function HomePage() {
  const { state, optimistic } = useRemote()
  const { health } = useHealth()
  const [addOpen, setAddOpen] = useState(false)
  const [pairing, setPairing] = useState<Device | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lastId = getLastDevice()
  const last = state.devices.find((device) => device.id === lastId) ?? null
  const connected = state.devices.filter((d) => d.state.connection === 'connected').length

  return (
    <Page wide>
      <PageHeader
        title="Your televisions"
        description={
          state.devices.length === 0
            ? 'Register an Android TV or Google TV on this network to start using it as a remote.'
            : `${connected} of ${state.devices.length} connected. Pick one to open its remote.`
        }
        action={
          <div className="flex items-center gap-2">
            {last && (
              <Link
                to={`/d/${last.id}`}
                className={cn(
                  'bg-secondary text-secondary-foreground hover:bg-accent hidden min-h-11 cursor-pointer',
                  'items-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors sm:inline-flex',
                )}
              >
                <Play aria-hidden className="size-4" />
                <span className="max-w-40 truncate">Resume {last.name}</span>
              </Link>
            )}
            <Btn onClick={() => setAddOpen(true)}>
              <Plus aria-hidden className="size-4" />
              Add a television
            </Btn>
          </div>
        }
      />

      <ErrorStrip message={error} onDismiss={() => setError(null)} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {state.devices.length === 0 ? (
            <EmptyState onAdd={() => setAddOpen(true)} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {state.devices.map((device) => (
                <li key={device.id}>
                  <RemoteCard
                    device={device}
                    featured={device.id === lastId}
                    onPower={() => {
                      const next = device.state.is_on === null ? null : !device.state.is_on
                      if (next !== null) optimistic(device.id, { is_on: next })
                      void api
                        .setPower(device.id, next)
                        .catch((err: unknown) => setError(errorMessage(err)))
                    }}
                    onPair={() => setPairing(device)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <SectionHeading
              title="Appliance"
              icon={<Activity aria-hidden className="size-4" />}
              description="This server, and what it can see."
            />
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="text-right font-medium">{health?.version ?? '—'}</dd>
              {/* Counts come from the live store, not the health probe: /healthz is read
                  once per page load and would go stale the moment a television connects. */}
              <dt className="text-muted-foreground">Televisions</dt>
              <dd className="text-right font-medium">{state.devices.length}</dd>
              <dt className="text-muted-foreground">Connected</dt>
              <dd className="text-right font-medium">{connected}</dd>
              <dt className="text-muted-foreground">Live stream</dt>
              <dd className="text-right font-medium">
                {state.socket === 'open' ? 'Connected' : 'Reconnecting'}
              </dd>
              <dt className="text-muted-foreground">Key catalog</dt>
              <dd className="text-right font-medium">{state.keys.length || '—'}</dd>
              <dt className="text-muted-foreground">App catalog</dt>
              <dd className="text-right font-medium">{state.apps.length || '—'}</dd>
            </dl>
          </Card>

          <Card>
            <SectionHeading
              title="Build on it"
              icon={<Code2 aria-hidden className="size-4" />}
              description="Everything this UI does is available over HTTP."
            />
            <div className="flex flex-col gap-2">
              <ShortcutLink
                to="/reference"
                Icon={BookOpen}
                title="API reference"
                blurb="Every endpoint, with a playground that sends real requests."
              />
              <ShortcutLink
                to="/llm"
                Icon={Bot}
                title="LLM integration"
                blurb="Copy-ready prompts for agents, MCP, and the embedded remote."
              />
              <ShortcutLink
                to="/llm#embed"
                Icon={Maximize2}
                title="Embed a remote"
                blurb="Drop one television's controls into any page as an iframe."
              />
            </div>
          </Card>

          <InstallSection />
        </div>
      </div>

      <AddDeviceDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(device) => {
          setAddOpen(false)
          setPairing(device)
        }}
      />
      {pairing && <PairingDialog device={pairing} onClose={() => setPairing(null)} />}
    </Page>
  )
}

/**
 * One television, as a card: identity and live state above, actions below.
 *
 * @param props.device - The television to render.
 * @param props.featured - Marks the television the operator last drove.
 * @param props.onPower - Toggles the television's power.
 * @param props.onPair - Starts pairing, offered when the television has no certificate.
 */
function RemoteCard({
  device,
  featured,
  onPower,
  onPair,
}: {
  device: Device
  featured: boolean
  onPower: () => void
  onPair: () => void
}) {
  const { state } = useRemote()
  const navigate = useNavigate()
  const unpaired = device.state.connection === 'unpaired' || !device.paired
  const app = foregroundApp(device.state, state.apps)

  // One line, fixed height, so a state change never resizes the card under the pointer.
  const detail = unpaired
    ? 'Pair this television to use it'
    : device.state.is_on === false
      ? 'Standby'
      : (device.state.now_playing?.title ?? app.name ?? device.model ?? device.host)

  return (
    <article
      className={cn(
        'flex h-full flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-colors',
        CARD_TINT[device.state.connection],
        featured && 'ring-ring/60 ring-2',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="bg-secondary text-muted-foreground grid size-10 shrink-0 place-items-center rounded-xl">
          <Tv aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold">{device.name}</h3>
            {featured && (
              <span className="bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                Last used
              </span>
            )}
          </div>
          <div className="mt-1 flex h-4 items-center">
            <StatusDot status={device.state.connection} />
          </div>
          <p className="text-muted-foreground mt-1 h-4 truncate text-xs">{detail}</p>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2">
        {unpaired ? (
          <Btn onClick={onPair} className="flex-1">
            Pair
          </Btn>
        ) : (
          <Btn onClick={() => void navigate(`/d/${device.id}`)} className="flex-1">
            <Maximize2 aria-hidden className="size-4" />
            Open remote
          </Btn>
        )}
        <Btn
          variant="secondary"
          onClick={onPower}
          aria-label={`Toggle power for ${device.name}`}
          title={`Toggle power for ${device.name}`}
          disabled={unpaired}
          className="w-11 px-0"
        >
          <Power
            aria-hidden
            className={cn('size-4', device.state.is_on === true && 'text-online')}
          />
        </Btn>
        <Link
          to="/devices"
          aria-label={`Manage ${device.name}`}
          title={`Manage ${device.name}`}
          className="bg-secondary text-secondary-foreground hover:bg-accent grid min-h-11 w-11 cursor-pointer place-items-center rounded-xl transition-colors"
        >
          <Settings2 aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  )
}

/**
 * A labelled link into another part of the console.
 *
 * @param props.to - Route to navigate to.
 * @param props.Icon - Leading glyph.
 * @param props.title - Link title.
 * @param props.blurb - One-line explanation.
 */
function ShortcutLink({
  to,
  Icon,
  title,
  blurb,
}: {
  to: string
  Icon: typeof BookOpen
  title: string
  blurb: string
}) {
  return (
    <Link
      to={to}
      className="hover:bg-accent flex items-start gap-3 rounded-xl p-2.5 transition-colors"
    >
      <span className="bg-secondary text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs text-pretty">{blurb}</span>
      </span>
    </Link>
  )
}

/**
 * The zero-television state: what the appliance is for, and the one action that matters.
 *
 * @param props.onAdd - Opens the add-television dialog.
 */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-4 py-12 text-center">
      <span className="bg-secondary text-muted-foreground grid size-14 place-items-center rounded-2xl">
        <Tv aria-hidden className="size-7" />
      </span>
      <div>
        <h2 className="text-base font-semibold">No televisions yet</h2>
        <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm text-pretty">
          The appliance watches the network for Android TV and Google TV devices. Add one, read
          the pairing code off its screen once, and it stays paired through address changes.
        </p>
      </div>
      <Btn onClick={onAdd}>
        <Plus aria-hidden className="size-4" />
        Add a television
      </Btn>
    </Card>
  )
}
