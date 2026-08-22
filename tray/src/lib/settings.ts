/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Persisted user settings for the Android TV Remote tray app: the appliance base URL, the
 * optional bearer token, the last selected device, and the optional global hotkey. Backed by
 * the Tauri store plugin (`settings.json` in the app's data directory) with an in-memory
 * fallback so the same code runs in a plain browser during frontend development. Also owns
 * registration of the configurable global shortcut, which is off by default.
 */
import { load, type Store } from '@tauri-apps/plugin-store'
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'
import { isTauri } from '@tauri-apps/api/core'

/** Everything the tray app remembers between launches. */
export interface Settings {
  /** Base URL of the appliance, no trailing slash, e.g. `http://192.168.1.10:7433`. */
  baseUrl: string
  /** Bearer token, or empty when the appliance runs unauthenticated. */
  token: string
  /** `device_id` last driven from the panel, restored on next launch. */
  lastDeviceId: string | null
  /** Tauri accelerator (`CommandOrControl+Shift+T`), or empty for no hotkey. */
  hotkey: string
  /** Whether the user has finished the first-run setup. */
  configured: boolean
}

/** Defaults for a fresh install: the appliance's public hostname, no auth, no hotkey. */
export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://remote.jaxns.net',
  token: '',
  lastDeviceId: null,
  hotkey: '',
  configured: false,
}

const STORE_FILE = 'settings.json'
const STORE_KEY = 'settings'

let store: Store | null = null
let memory: Settings = { ...DEFAULT_SETTINGS }

/** Opens (and caches) the backing store. Returns null outside a Tauri webview. */
async function open(): Promise<Store | null> {
  if (!isTauri()) return null
  store ??= await load(STORE_FILE, { autoSave: true })
  return store
}

/**
 * Reads the persisted settings, filling in defaults for anything missing.
 *
 * @returns the stored settings merged over {@link DEFAULT_SETTINGS}.
 */
export async function loadSettings(): Promise<Settings> {
  const s = await open()
  if (!s) return { ...memory }
  const stored = await s.get<Partial<Settings>>(STORE_KEY)
  return { ...DEFAULT_SETTINGS, ...stored }
}

/**
 * Persists settings, normalising the base URL so a trailing slash or a bare host does not
 * produce a broken request URL later.
 *
 * @param next - the settings to write.
 * @returns the normalised settings that were actually stored.
 */
export async function saveSettings(next: Settings): Promise<Settings> {
  const normalised: Settings = { ...next, baseUrl: normaliseBaseUrl(next.baseUrl) }
  const s = await open()
  if (s) {
    await s.set(STORE_KEY, normalised)
    await s.save()
  } else {
    memory = normalised
  }
  return normalised
}

/**
 * Trims a user-typed appliance address into a usable origin: adds a scheme when the user
 * typed a bare host or `host:port`, and drops any trailing slash.
 *
 * @param raw - what the user typed into the settings field.
 * @returns a base URL with a scheme and no trailing slash.
 */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

/**
 * Applies the configured global hotkey, replacing whatever was registered before.
 *
 * Registration is best-effort: another application may already own the combination, in which
 * case the OS refuses it. The caller is told so it can show the user an honest message
 * rather than silently pretending the hotkey works.
 *
 * @param hotkey - a Tauri accelerator, or an empty string to register nothing.
 * @param onTrigger - called on key-down of the accelerator.
 * @returns null on success, or a human-readable reason the hotkey could not be registered.
 */
export async function applyHotkey(
  hotkey: string,
  onTrigger: () => void,
): Promise<string | null> {
  if (!isTauri()) return null
  try {
    await unregisterAll()
    if (!hotkey) return null
    await register(hotkey, (event) => {
      if (event.state === 'Pressed') onTrigger()
    })
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
