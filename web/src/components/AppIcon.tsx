/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The app artwork tile shared by the Android TV Remote web UI's launcher and now-playing
 * surfaces. Renders the appliance-served icon from `AppDescriptor.icon_url`
 * (`/api/icons/{package}`) lazily and at a fixed aspect ratio so a slow icon cannot shift
 * the grid, and falls back to the previous build's initials-over-a-derived-hue tile the
 * moment the image fails — a launcher with a missing icon degrades to a readable letter
 * tile rather than to a hole.
 */
import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Derive a stable hue from an app id so every fallback tile has a consistent,
 * distinguishable colour without shipping artwork.
 *
 * @param seed - The app's catalog id, or any other stable string.
 * @returns A hue in degrees, 0-359.
 */
function hueFor(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return hash
}

/** First letters of the app name, used as the fallback tile's glyph. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

export interface AppIconProps {
  /** The appliance icon endpoint for this app, or null when the catalog has none. */
  iconUrl: string | null
  /** The app's display name; drives the fallback glyph and the accessible name. */
  name: string
  /**
   * Accessible name for the image. Pass `""` where the app's name is already rendered
   * beside the icon, so a screen reader does not announce it twice.
   */
  alt: string
  /** Stable string the fallback hue is derived from; defaults to the name. */
  seed?: string
  /**
   * Intrinsic pixel size written to the `width`/`height` attributes. The tile is square
   * and sized by CSS; this only tells the browser the aspect ratio up front.
   */
  size?: number
  className?: string
}

/**
 * An app's icon, with the coloured initials tile as its failure state.
 *
 * @param props.iconUrl - Icon endpoint; null goes straight to the fallback.
 * @param props.name - Display name, used for the fallback glyph.
 * @param props.alt - Alternative text; `""` when the name is already adjacent.
 * @param props.seed - Overrides the string the fallback hue is derived from.
 * @param props.size - Intrinsic width/height hint in pixels.
 */
export function AppIcon({ iconUrl, name, alt, seed, size = 96, className }: AppIconProps) {
  const [failed, setFailed] = useState(false)

  // A new icon URL deserves a fresh attempt: the tile is reused as the launcher scrolls
  // and as the foreground app changes.
  const [attempted, setAttempted] = useState(iconUrl)
  if (attempted !== iconUrl) {
    setAttempted(iconUrl)
    setFailed(false)
  }

  const shell = cn('aspect-square w-full overflow-hidden rounded-2xl', className)

  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn(shell, 'bg-secondary object-cover')}
      />
    )
  }

  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      style={{ backgroundColor: `oklch(0.62 0.16 ${hueFor(seed ?? name)})` }}
      className={cn(shell, 'grid place-items-center text-lg font-semibold text-white')}
    >
      {initials(name)}
    </span>
  )
}
