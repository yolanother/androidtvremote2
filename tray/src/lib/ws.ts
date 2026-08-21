/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * WebSocket client for the appliance's `/api/ws` live state stream. Keeps a single socket
 * open, reconnects with exponential backoff and jitter after any drop, sends the contract's
 * `ping` frames and treats a missing `pong` as a dead connection, and hands decoded
 * `ServerEvent` frames to a listener. Deliberately transport-only: it never interprets the
 * events, so the panel's state reducer is the single place device state is derived.
 */
import type { ServerEvent } from './api-types'

/** Whether the live stream is up, coming up, or down. */
export type LinkStatus = 'connecting' | 'open' | 'closed'

/** Callbacks a {@link LiveConnection} owner supplies. */
export interface LiveHandlers {
  /** Called for each decoded server frame. */
  onEvent: (event: ServerEvent) => void
  /** Called whenever the link status changes, with the reason when it went down. */
  onStatus: (status: LinkStatus, reason?: string) => void
}

/** First backoff delay, in milliseconds. */
const BACKOFF_MIN_MS = 1000
/** Backoff ceiling, in milliseconds. */
const BACKOFF_MAX_MS = 15000
/** How often to send a keepalive ping. */
const PING_INTERVAL_MS = 20000
/** How long to wait for the matching pong before declaring the socket dead. */
const PONG_TIMEOUT_MS = 10000

/**
 * Computes the delay before reconnect attempt number `attempt` (0-based), doubling from
 * {@link BACKOFF_MIN_MS} to {@link BACKOFF_MAX_MS} with up to 30% jitter so that several
 * clients reconnecting after an appliance restart do not arrive in lockstep.
 *
 * @param attempt - how many consecutive failures have happened.
 * @returns delay in milliseconds.
 */
export function backoffDelay(attempt: number): number {
  const base = Math.min(BACKOFF_MIN_MS * 2 ** attempt, BACKOFF_MAX_MS)
  return Math.round(base * (1 + Math.random() * 0.3))
}

/**
 * A self-healing connection to `/api/ws`.
 *
 * Construct one per appliance URL; call {@link close} before replacing it. The connection
 * starts as soon as it is constructed.
 */
export class LiveConnection {
  private socket: WebSocket | null = null
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  /** Absolute `ws://` or `wss://` URL this connection reconnects to. */
  private readonly url: string
  /** Event and status callbacks supplied by the owner. */
  private readonly handlers: LiveHandlers

  /**
   * @param url - absolute `ws://` or `wss://` URL, token already applied.
   * @param handlers - event and status callbacks.
   */
  constructor(url: string, handlers: LiveHandlers) {
    this.url = url
    this.handlers = handlers
    this.connect()
  }

  /** Tears the connection down for good; no further reconnects or callbacks happen. */
  close(): void {
    this.closed = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
  }

  /** Drops the current socket and reconnects immediately, resetting the backoff. */
  reconnectNow(): void {
    if (this.closed) return
    this.attempt = 0
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.connect()
  }

  /** Opens a socket and wires its lifecycle. */
  private connect(): void {
    if (this.closed) return
    this.handlers.onStatus('connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : String(err))
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      this.handlers.onStatus('open')
      this.startPinging()
    }

    socket.onmessage = (message) => {
      let event: ServerEvent
      try {
        event = JSON.parse(String(message.data)) as ServerEvent
      } catch {
        return // A frame we cannot parse is not worth dropping the connection over.
      }
      if (event.type === 'pong') {
        this.clearPongTimer()
        return
      }
      this.handlers.onEvent(event)
    }

    socket.onerror = () => {
      // `onclose` always follows, and carries the useful information; nothing to do here.
    }

    socket.onclose = (closeEvent) => {
      if (this.socket !== socket) return // A newer socket already replaced this one.
      this.socket = null
      this.scheduleReconnect(closeEvent.reason || 'connection closed')
    }
  }

  /** Starts the keepalive ping/pong watchdog for the currently open socket. */
  private startPinging(): void {
    this.clearPingTimers()
    this.pingTimer = setInterval(() => {
      const socket = this.socket
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'ping' }))
      this.clearPongTimer()
      this.pongTimer = setTimeout(() => {
        // Nothing came back: the socket is a zombie (asleep laptop, silently dropped NAT
        // entry). Close it so `onclose` runs the normal backoff path.
        socket.close()
      }, PONG_TIMEOUT_MS)
    }, PING_INTERVAL_MS)
  }

  /** Reports the drop and queues the next attempt. */
  private scheduleReconnect(reason: string): void {
    if (this.closed) return
    this.clearTimers()
    this.handlers.onStatus('closed', reason)
    const delay = backoffDelay(this.attempt)
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  /** Clears every timer this connection owns. */
  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.clearPingTimers()
  }

  /** Clears the keepalive timers only. */
  private clearPingTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    this.pingTimer = null
    this.clearPongTimer()
  }

  /** Clears the outstanding pong watchdog, if any. */
  private clearPongTimer(): void {
    if (this.pongTimer !== null) clearTimeout(this.pongTimer)
    this.pongTimer = null
  }
}
