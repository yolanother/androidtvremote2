/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The text-entry control surface for the Android TV Remote web UI — the single biggest
 * improvement over a physical remote, since it replaces D-pad pecking at an on-screen
 * keyboard with real typing. Sends the field's contents to whatever input is focused on
 * the TV, offers paste from the system clipboard, exposes the backspace, clear-field, and
 * enter keys the TV's own search box needs, and keeps a short history of recent sends so a
 * repeated search is one tap.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardPaste, CornerDownLeft, Delete, Eraser, Search, Send } from 'lucide-react'

import { Btn, ErrorStrip, Field, Key, SentTick } from '@/components/ui'
import { KEYS } from '@/lib/keys'
import type { RemoteControl } from '@/hooks/useRemoteControl'

const HISTORY_KEY = 'atvr.textHistory'
const HISTORY_LIMIT = 6

/** Read the recent-send history, tolerating a corrupt or absent entry. */
function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * The text-entry surface.
 *
 * @param props.control - The bound remote control for the active device.
 */
export function TextEntry({ control }: { control: RemoteControl }) {
  const { send, sendText, disabled, error, clearError } = control
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>(readHistory)
  const [sent, setSent] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const tickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(tickTimer.current), [])

  /** Record a successful send at the head of the history, de-duplicated. */
  const remember = useCallback((text: string) => {
    setHistory((previous) => {
      const next = [text, ...previous.filter((item) => item !== text)].slice(0, HISTORY_LIMIT)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        // History is a convenience; losing it is not worth surfacing.
      }
      return next
    })
  }, [])

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || disabled) return
      try {
        await sendText(trimmed)
        remember(trimmed)
        setValue('')
        setSent(true)
        clearTimeout(tickTimer.current)
        tickTimer.current = setTimeout(() => setSent(false), 1600)
        // Successive searches should not need a re-tap to focus the field.
        inputRef.current?.focus()
      } catch {
        // `sendText` has already published the message through `control.error`.
      }
    },
    [disabled, remember, sendText],
  )

  const paste = useCallback(async () => {
    setPasteError(null)
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setValue(text)
        inputRef.current?.focus()
      }
    } catch {
      setPasteError('The browser blocked clipboard access. Paste into the field instead.')
    }
  }, [])

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit(value)
        }}
        className="flex flex-col gap-3"
      >
        <Field
          ref={inputRef}
          label="Send text to the TV"
          placeholder="Type here, then press Enter"
          value={value}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          onChange={(event) => setValue(event.target.value)}
          hint="Goes to whatever field is focused on the TV."
        />

        <div className="flex items-center gap-2">
          <Btn type="submit" disabled={disabled || !value.trim()} className="flex-1">
            <Send aria-hidden className="size-4" />
            Send
          </Btn>
          <Btn type="button" variant="secondary" onClick={() => void paste()} disabled={disabled}>
            <ClipboardPaste aria-hidden className="size-4" />
            Paste
          </Btn>
        </div>
      </form>

      <div className="flex h-4 items-center justify-end">
        <SentTick show={sent}>Sent to the TV</SentTick>
      </div>

      <ErrorStrip message={pasteError} onDismiss={() => setPasteError(null)} />
      <ErrorStrip message={error} onDismiss={clearError} />

      {/* The TV's own field usually needs clearing before it needs filling, and a search
          box needs a submit that is not text. */}
      <div className="grid grid-cols-4 gap-2">
        <Key
          label="Backspace"
          disabled={disabled}
          onClick={() => send(KEYS.del)}
          className="h-12"
        >
          <Delete aria-hidden className="size-5" />
        </Key>
        <Key
          label="Clear the field on the TV"
          disabled={disabled}
          // One request, ten deletions: `repeat` is capped at 10 by the contract.
          onClick={() => send(KEYS.del, 10)}
          className="h-12"
        >
          <Eraser aria-hidden className="size-5" />
        </Key>
        <Key label="Search" disabled={disabled} onClick={() => send(KEYS.search)} className="h-12">
          <Search aria-hidden className="size-5" />
        </Key>
        <Key label="Enter" disabled={disabled} onClick={() => send(KEYS.enter)} className="h-12">
          <CornerDownLeft aria-hidden className="size-5" />
        </Key>
      </div>

      {history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs font-medium">Recent</h3>
          <div className="flex flex-wrap gap-2">
            {history.map((item) => (
              <button
                key={item}
                type="button"
                disabled={disabled}
                onClick={() => void submit(item)}
                className="bg-secondary text-secondary-foreground hover:bg-accent max-w-full cursor-pointer truncate rounded-full px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
