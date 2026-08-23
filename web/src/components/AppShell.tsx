/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The application shell every screen except the immersive remote and the embed view is
 * rendered inside: a sticky product header carrying the appliance's live connection state,
 * and a navigation sidebar that is a persistent rail from `lg` up and an off-canvas drawer
 * below it. The sidebar's second section is the reason it exists — a quick link to every
 * registered television with its live status, so switching remotes never costs a trip back
 * to a list. Also provides the skip link, the single `<main>` landmark, and the page
 * container that keeps content readable on a phone while using the full width of a desktop.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BookOpen,
  Bot,
  LayoutDashboard,
  Menu,
  Settings,
  Tv,
  X,
} from 'lucide-react'

import { StatusDot } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useHealth } from '@/lib/useHealth'
import { useRemote } from '@/state/store'

/** Top-level destinations, in sidebar order. */
const NAV = [
  { to: '/', label: 'Overview', Icon: LayoutDashboard, end: true },
  { to: '/devices', label: 'Televisions', Icon: Tv, end: false },
  { to: '/reference', label: 'API reference', Icon: BookOpen, end: false },
  { to: '/llm', label: 'LLM integration', Icon: Bot, end: false },
  { to: '/settings', label: 'Settings', Icon: Settings, end: false },
]

/** Wording for the browser's own connection to the appliance. */
const SOCKET_LABEL = {
  connecting: 'Connecting',
  open: 'Live',
  closed: 'Offline',
} as const

/**
 * The shell: header, sidebar, and the routed page in `<main>`.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // A drawer that survives navigation would cover the page the user just asked for.
  useEffect(() => setDrawerOpen(false), [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className={cn(
          'sr-only focus:not-sr-only focus:bg-card focus:text-foreground focus:fixed',
          'focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:border focus:px-3 focus:py-2 focus:text-sm',
        )}
      >
        Skip to content
      </a>

      <AppHeader onOpenDrawer={() => setDrawerOpen(true)} />

      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
        {/* The desktop rail. Its own scroll container, so a long television list never
            drags the page content with it. */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto border-r px-3 py-4 lg:block">
          <SidebarContent />
        </aside>

        <main id="main" className="min-w-0">
          <Outlet />
        </main>
      </div>

      {drawerOpen && (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="animate-in fade-in-0 fixed inset-0 z-40 cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-label="Navigation"
            className={cn(
              'bg-card animate-in slide-in-from-left fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw]',
              'flex-col overflow-y-auto border-r px-3 py-4 shadow-2xl',
            )}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="hover:bg-accent cursor-pointer rounded-lg p-2 transition-colors"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <SidebarContent />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The product header: the drawer trigger on small screens, the brand, and the live state
 * of this browser's connection to the appliance.
 *
 * @param props.onOpenDrawer - Opens the mobile navigation drawer.
 */
function AppHeader({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { state } = useRemote()
  const connected = state.devices.filter((d) => d.state.connection === 'connected').length

  return (
    <header
      className={cn(
        'bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur',
        'pt-[env(safe-area-inset-top)] sm:px-4',
      )}
    >
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        className="hover:bg-accent -ml-1 cursor-pointer rounded-xl p-2.5 transition-colors lg:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      <Brand />

      <div className="flex-1" />

      {/* Appliance reachability belongs in the chrome: a page whose controls silently do
          nothing is the failure this header exists to make obvious. */}
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
          state.socket === 'open' && 'border-online/30 bg-online/10 text-online',
          state.socket === 'connecting' && 'border-pairing/30 bg-pairing/10 text-pairing',
          state.socket === 'closed' && 'border-destructive/30 bg-destructive/10 text-destructive',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            state.socket === 'open' && 'bg-online',
            state.socket === 'connecting' && 'bg-pairing animate-pulse',
            state.socket === 'closed' && 'bg-destructive',
          )}
        />
        {SOCKET_LABEL[state.socket]}
        <span className="text-muted-foreground hidden sm:inline">
          · {connected}/{state.devices.length} on
        </span>
      </span>
    </header>
  )
}

/**
 * The wordmark, which is also the route home.
 */
function Brand() {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5">
      <span className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-xl">
        <Tv aria-hidden className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm leading-tight font-semibold">Android TV Remote</span>
        <span className="text-muted-foreground hidden text-[11px] leading-tight sm:block">
          Appliance console
        </span>
      </span>
    </Link>
  )
}

/**
 * The sidebar body, shared by the desktop rail and the mobile drawer.
 */
function SidebarContent() {
  const { state } = useRemote()
  const { health } = useHealth()

  return (
    <nav aria-label="Primary" className="flex h-full flex-col gap-6">
      <ul className="flex flex-col gap-0.5">
        {NAV.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <Icon aria-hidden className="size-4.5 shrink-0" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="min-w-0">
        <h2 className="text-muted-foreground px-3 pb-1.5 text-[11px] font-semibold tracking-wider uppercase">
          Remotes
        </h2>
        {state.devices.length === 0 ? (
          <p className="text-muted-foreground px-3 text-xs text-pretty">
            No televisions registered yet.{' '}
            <Link to="/devices" className="underline underline-offset-2">
              Add one
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {state.devices.map((device) => (
              <li key={device.id}>
                <NavLink
                  to={`/d/${device.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm transition-colors',
                      isActive
                        ? 'bg-secondary text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )
                  }
                >
                  <StatusDot status={device.state.connection} compact />
                  <span className="min-w-0 flex-1 truncate">{device.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-muted-foreground mt-auto px-3 pt-2 text-[11px]">
        {/* Reserved height: the version arrives after the first paint. */}
        <p className="h-4">{health ? `Appliance v${health.version}` : ''}</p>
      </div>
    </nav>
  )
}

/**
 * A page container for shell-hosted screens: comfortable reading width for prose-heavy
 * screens, full bleed for the dashboards that use the desktop's width.
 *
 * @param props.children - Page content.
 * @param props.wide - Let the page use the full content column rather than capping it.
 */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-6 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6',
        wide ? 'max-w-[1600px]' : 'max-w-5xl',
      )}
    >
      {children}
    </div>
  )
}

/**
 * A page's title block.
 *
 * @param props.title - The page's `h1`.
 * @param props.description - Supporting sentence.
 * @param props.action - Controls aligned to the trailing edge.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm text-pretty">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}
