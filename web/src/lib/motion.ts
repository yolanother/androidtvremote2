/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Shared motion language for the remote workspace. Uses a gently damped spring for
 * destination labels, artwork, lists and sheets, with an immediate final state when
 * the operating system requests reduced motion. Animation never gates TV commands.
 */
import { useReducedMotion, type Transition } from 'motion/react'

/** Return the common spring, or an immediate transition for reduced-motion users. */
export function useOrganicMotion(): { reduced: boolean; transition: Transition } {
  const reduced = !!useReducedMotion()
  return { reduced, transition: reduced ? { duration: 0 } : { type: 'spring', stiffness: 370, damping: 29, mass: 0.8 } }
}
