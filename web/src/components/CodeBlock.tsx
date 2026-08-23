/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Presentational primitives shared by the API reference and LLM integration screens: a
 * `CopyButton` that writes text to the clipboard and confirms it in place, a `CodeBlock`
 * that renders a copyable, horizontally scrolling snippet with an optional caption, and a
 * `Card` / `SectionHeading` pair used to build both pages out of one visual vocabulary.
 * Snippets on those pages exist to be pasted somewhere else, so copying is a first-class
 * control rather than something the reader has to select by hand.
 */
import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A button that copies text and reports success in place for a moment.
 *
 * @param props.text - The text to place on the clipboard.
 * @param props.label - Accessible name; defaults to "Copy".
 * @param props.className - Extra classes for positioning.
 */
export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access is denied on insecure origins; the text is still selectable.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? 'Copied' : label}
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-foreground inline-flex cursor-pointer',
        'items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
        className,
      )}
    >
      {copied ? (
        <Check aria-hidden className="text-online size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      <span className={copied ? 'text-online' : undefined}>{copied ? 'Copied' : label}</span>
    </button>
  )
}

/**
 * A copyable code snippet. Long lines scroll inside the block rather than widening the
 * page, which is what keeps these screens usable on a phone.
 *
 * @param props.code - The snippet text.
 * @param props.caption - Optional label shown in the block's title bar.
 * @param props.className - Extra classes for the wrapper.
 */
export function CodeBlock({
  code,
  caption,
  className,
}: {
  code: string
  caption?: string
  className?: string
}) {
  return (
    <figure className={cn('bg-secondary/60 overflow-hidden rounded-xl border', className)}>
      <figcaption className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground truncate font-mono text-[11px] tracking-wide uppercase">
          {caption ?? 'snippet'}
        </span>
        <CopyButton text={code} className="-mr-1 shrink-0" />
      </figcaption>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    </figure>
  )
}

/**
 * A surface panel. Every block on the landing, reference, and integration screens sits in
 * one of these so the pages read as one system.
 *
 * @param props.children - Panel content.
 * @param props.className - Extra classes.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('bg-card rounded-2xl border p-4 shadow-sm sm:p-5', className)}>
      {children}
    </section>
  )
}

/**
 * A heading with an optional supporting sentence and trailing controls.
 *
 * @param props.title - The heading text.
 * @param props.description - Supporting sentence beneath it.
 * @param props.icon - Optional leading glyph.
 * @param props.action - Controls aligned to the trailing edge.
 * @param props.level - Heading level, so pages keep a correct h1/h2/h3 outline.
 */
export function SectionHeading({
  title,
  description,
  icon,
  action,
  level = 2,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  level?: 2 | 3
}) {
  const Tag = level === 2 ? 'h2' : 'h3'
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <Tag className={cn('font-semibold', level === 2 ? 'text-base' : 'text-sm')}>{title}</Tag>
          {description && (
            <p className="text-muted-foreground mt-0.5 text-sm text-pretty">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
