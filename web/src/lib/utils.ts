/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Shared class-name helper for the Android TV Remote web UI. Exports `cn`, the
 * clsx + tailwind-merge combinator that every component and shadcn/ui primitive uses to
 * compose conditional Tailwind classes while letting caller-supplied classes correctly
 * override built-in ones.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combine conditional class values and resolve conflicting Tailwind utilities.
 *
 * @param inputs - Any mix of strings, arrays, and conditional objects accepted by clsx.
 * @returns A single class string with later Tailwind utilities winning over earlier ones.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
