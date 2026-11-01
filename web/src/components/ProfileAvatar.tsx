/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The selected television profile's compact identity badge. Displays a configured
 * photo, with stable colored initials when artwork is absent or fails, and replaces
 * identities with the same reduced-motion-aware spring used by remote navigation.
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { useOrganicMotion } from '@/lib/motion'

/** Render a profile photograph or accessible, distinguishable initials fallback. */
export function ProfileAvatar({ profile }: { profile?: { id: string; name: string; image_url: string | null; color?: string | null } }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const { reduced, transition } = useOrganicMotion()
  const initials = profile?.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?'
  const color = /^#[\da-f]{6}$/i.test(profile?.color ?? '') ? profile!.color! : '#6984b1'
  const components = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const foreground = components[0]! * 0.2126 + components[1]! * 0.7152 + components[2]! * 0.0722 > 0.179 ? '#000000' : '#ffffff'
  return <span className="pointer-events-none relative size-7 overflow-hidden rounded-full border" role="img" aria-label={profile ? `${profile.name} profile` : 'Choose TV profile'}>
    <AnimatePresence initial={false}>
      <motion.span key={`${profile?.id}:${profile?.image_url}:${profile?.color}`} className="absolute inset-0 grid place-items-center rounded-full text-xs font-bold"
        style={{ backgroundColor: color, color: foreground }} initial={reduced ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={transition}>
        {profile?.image_url && failedUrl !== profile.image_url
          ? <img src={profile.image_url} alt="" className="size-full object-cover" onError={() => setFailedUrl(profile.image_url)} />
          : initials}
      </motion.span>
    </AnimatePresence>
  </span>
}
