/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The progressive-web-app runtime for the Android TV Remote SPA. Registers the generated
 * service worker, tracks whether a newer build is waiting to take over, and captures the
 * browser's `beforeinstallprompt` event so the UI can offer a real install button. Loaded
 * from index.html directly rather than from a React component, because
 * `beforeinstallprompt` fires during page load and would otherwise be missed before the
 * settings screen mounts. Deliberately not loaded by embed.html: the embed view must stay
 * a plain, always-fresh document.
 */
import { registerSW } from 'virtual:pwa-register'

/**
 * The `beforeinstallprompt` event, which is Chromium-only and not in the DOM lib.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  /** Resolves once the operator has accepted or dismissed the browser's install dialog. */
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * What the UI should offer the operator.
 *
 * - `ready` — the browser has offered an install prompt; the button works.
 * - `installed` — the page is already running as an installed app.
 * - `ios` — iOS and iPadOS never fire `beforeinstallprompt`; show Share → Add to Home
 *   Screen instructions instead of a button that would do nothing.
 * - `insecure` — the page is not a secure context, so the browser will not install it and
 *   will not run a service worker. This is the normal case for an appliance reached at
 *   `http://192.168.x.x:7433`; see docs/pwa.md.
 * - `unavailable` — installable in principle, but this browser has not offered a prompt
 *   (Firefox and desktop Safari never do).
 */
export type InstallState = 'ready' | 'installed' | 'ios' | 'insecure' | 'unavailable'

const listeners = new Set<() => void>()

let installState: InstallState = 'unavailable'
let deferredPrompt: BeforeInstallPromptEvent | null = null
let updateReady = false

/** Notify every subscriber that a snapshot changed. */
function emit(): void {
  for (const listener of listeners) listener()
}

/** Whether this is iOS or iPadOS, where installation is a manual Share-sheet action. */
function isIos(): boolean {
  return (
    /iP(?:ad|hone|od)/.test(navigator.userAgent) ||
    // iPadOS 13+ reports a desktop Macintosh UA; touch points give it away.
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  )
}

/** Whether the page is already running as an installed app rather than in a browser tab. */
function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    // Safari's pre-standard equivalent, still the only signal on iOS.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Resolve the state to show before any browser event has had a chance to fire. */
function initialInstallState(): InstallState {
  if (isInstalled()) return 'installed'
  // iOS is checked before the secure-context test on purpose: Add to Home Screen is a
  // user-driven Share-sheet action and does not require HTTPS, unlike a Chromium install.
  if (isIos()) return 'ios'
  if (!window.isSecureContext) return 'insecure'
  return 'unavailable'
}

installState = initialInstallState()

window.addEventListener('beforeinstallprompt', (event) => {
  // Suppress Chrome's own mini-infobar so the install stays a deliberate act in Settings.
  event.preventDefault()
  deferredPrompt = event as BeforeInstallPromptEvent
  installState = 'ready'
  emit()
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  installState = 'installed'
  emit()
})

/**
 * Ask the browser to install the app.
 *
 * A `beforeinstallprompt` event may only be used once, so the captured event is discarded
 * whatever the outcome; Chrome fires a fresh one if the operator declines and remains
 * eligible.
 *
 * @returns The operator's choice, or `unavailable` when no prompt was ever captured.
 */
export async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt
  if (!prompt) return 'unavailable'
  deferredPrompt = null
  try {
    const { outcome } = await prompt.prompt()
    if (outcome === 'dismissed') {
      // The prompt is spent. `appinstalled` will correct this if the install completes.
      installState = 'unavailable'
      emit()
    }
    return outcome
  } catch {
    installState = 'unavailable'
    emit()
    return 'unavailable'
  }
}

// `registerSW` no-ops when `navigator.serviceWorker` is absent, which is exactly what
// happens on an insecure origin — the property does not exist there at all.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady = true
    emit()
  },
  onRegisteredSW(_url, registration) {
    // A wall panel can sit on one page for weeks. Without a periodic check it would never
    // learn that the appliance has been rebuilt.
    if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
  },
})

/**
 * Activate the waiting service worker and reload the page onto the new build.
 */
export function applyUpdate(): void {
  void updateSW(true)
}

/**
 * Subscribe to install- and update-state changes.
 *
 * @param listener - Called whenever a snapshot getter would return something new.
 * @returns An unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * @returns What the install UI should currently offer.
 */
export function getInstallState(): InstallState {
  return installState
}

/**
 * @returns Whether a newer build is downloaded and waiting for the operator to reload.
 */
export function getUpdateReady(): boolean {
  return updateReady
}
