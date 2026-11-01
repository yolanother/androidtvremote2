/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Measures the usable phone viewport for the remote workspace as browser chrome,
 * orientation or the software keyboard changes. Pinch zoom keeps the existing
 * layout size so zooming magnifies controls instead of shrinking their layout.
 */
import { useLayoutEffect, useState } from 'react'

/** Return visible CSS-pixel height, falling back to the window when no viewport API exists. */
export function useVisibleViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight)
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const measure = () => {
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
      setHeight(Math.min(window.innerHeight, viewport?.height ?? window.innerHeight))
    }
    measure()
    window.addEventListener('resize', measure)
    viewport?.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
    }
  }, [])
  return height
}
