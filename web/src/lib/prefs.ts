/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Persisted user preferences for the Android TV Remote web UI. Backs each preference with
 * localStorage behind a tiny subscribable store so that every component reading a value
 * re-renders when any other component changes it, and applies the colour theme (light,
 * dark, or follow-system) to the document element. Holds the theme, the remembered control
 * surface, and the last device the user was driving.
 */
import { useSyncExternalStore } from 'react'

/** Colour theme choice; `system` follows the OS `prefers-color-scheme`. */
export type Theme = 'light' | 'dark' | 'system'

/** Which control surface the remote shows in its stage area. */
export type Surface = 'dpad' | 'touch' | 'text' | 'apps' | 'media'

const listeners = new Set<() => void>()

/** Notify every `usePref` subscriber that a stored value changed. */
function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Read a persisted preference, falling back when it is unset or storage is unavailable.
 *
 * @param key - Storage key, namespaced by the caller.
 * @param fallback - Value to use when nothing valid is stored.
 * @returns The stored value, or the fallback.
 */
function read<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Persist a preference and wake every subscriber.
 *
 * @param key - Storage key.
 * @param value - New value; pass null to remove the entry.
 */
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private-mode storage failures must not break the remote; the value stays in memory
    // for this session only, which is the best we can do.
  }
  emit()
}

const THEME_KEY = 'atvr.theme'
const SURFACE_KEY = 'atvr.surface'
const LAST_DEVICE_KEY = 'atvr.lastDevice'

/**
 * Apply the stored theme to `<html>`. Called once at boot and on every theme change.
 *
 * The `dark` class drives Tailwind's `@custom-variant dark`, and `color-scheme` keeps
 * native form controls and scrollbars in step.
 */
export function applyTheme(): void {
  const theme = read<Theme>(THEME_KEY, 'system')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/**
 * Start following the OS colour-scheme so `system` stays correct without a reload.
 *
 * @returns An unsubscribe function.
 */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => applyTheme()
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/**
 * Read and set the colour theme.
 *
 * @returns A tuple of the current theme and a setter that persists and applies it.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => read<Theme>(THEME_KEY, 'system'),
    () => 'system' as Theme,
  )
  return [
    theme,
    (next: Theme) => {
      write(THEME_KEY, next)
      applyTheme()
    },
  ]
}

/**
 * Read and set the remembered control surface, so reopening the remote lands the user back
 * on the touchpad (or the D-pad) they chose last time.
 *
 * @returns A tuple of the current surface and a setter that persists it.
 */
export function useSurface(): [Surface, (surface: Surface) => void] {
  const surface = useSyncExternalStore(
    subscribe,
    () => read<Surface>(SURFACE_KEY, 'dpad'),
    () => 'dpad' as Surface,
  )
  return [surface, (next: Surface) => write(SURFACE_KEY, next)]
}

/**
 * Remember which device the user was last driving, so the app reopens on it.
 *
 * @returns The stored device id, or null.
 */
export function getLastDevice(): string | null {
  return read<string>(LAST_DEVICE_KEY, '') || null
}

/**
 * Record the device the user is driving.
 *
 * @param deviceId - The device id, or null to forget it.
 */
export function setLastDevice(deviceId: string | null): void {
  write(LAST_DEVICE_KEY, deviceId)
}
