/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Optional provider title browsing for Android TV Remote. Offers continue watching,
 * explicit search and bounded pagination, with title-detail/resume actions bound to
 * the selected television/profile. Context changes cancel pending pages and details
 * so results from an old TV can never become the new TV's launch targets.
 */
import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { Btn, ErrorStrip, Field, Modal } from '@/components/ui'
import type { RemoteIntegration } from '@/hooks/useIntegration'
import { errorMessage } from '@/lib/api'
import { providerApi } from '@/lib/provider-api'
import type { ProviderBrowse, ProviderTitle } from '@/lib/provider-types'

/** Continue watching, title search and details for one stable provider context. */
export function MediaBrowse({ deviceId, remote }: { deviceId: string; remote: RemoteIntegration }) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [page, setPage] = useState<ProviderBrowse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ProviderTitle | null>(null)
  const [detail, setDetail] = useState<ProviderTitle | null>(null)
  const scopeRef = useRef(remote.scope)
  scopeRef.current = remote.scope

  useEffect(() => {
    const controller = new AbortController()
    const scope = remote.scope
    setLoading(true)
    setError(null)
    void providerApi.browse(deviceId, query ? 'search' : 'continue', query, cursor, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && scopeRef.current === scope && value.profile_revision === remote.integration?.profile_revision) setPage(value)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted && scopeRef.current === scope) setError(errorMessage(reason))
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [deviceId, remote.scope, remote.version, query, cursor, remote.integration?.profile_revision])

  useEffect(() => {
    setDetail(null)
    if (!selected) return
    const controller = new AbortController()
    const scope = remote.scope
    void providerApi.title(deviceId, selected.id, controller.signal).then((value) => {
      if (!controller.signal.aborted && scopeRef.current === scope) setDetail(value)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && scopeRef.current === scope) setError(errorMessage(reason))
    })
    return () => controller.abort()
  }, [deviceId, remote.scope, selected])

  return (
    <section aria-label="Browse titles" className="mt-7 w-full min-w-0 border-t pt-5">
      <h2 className="text-lg font-semibold">{query ? 'Search results' : 'Continue watching'}</h2>
      <form className="mt-3 flex min-w-0 items-end gap-2" onSubmit={(event) => {
        event.preventDefault(); setQuery(input.trim()); setCursor(null); setPage(null)
      }}>
        <div className="min-w-0 flex-1"><Field label="Search titles" value={input} onChange={(event) => setInput(event.target.value)} /></div>
        <Btn type="submit" aria-label="Search"><Search aria-hidden className="size-4" /></Btn>
        {query && <Btn variant="secondary" onClick={() => { setInput(''); setQuery(''); setCursor(null); setPage(null) }}>Clear</Btn>}
      </form>
      <ErrorStrip message={error} onDismiss={() => setError(null)} />
      {loading && !page && <p role="status" className="text-muted-foreground py-4 text-sm">Loading titles…</p>}
      {page && !page.items.length && <p className="text-muted-foreground py-4 text-sm">{query ? 'No matching titles.' : 'Nothing to continue on this TV yet.'}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {page?.items.map((title) => (
          <button key={title.id} type="button" disabled={!title.available} onClick={() => setSelected(title)}
            className="hover:bg-accent min-w-0 cursor-pointer overflow-hidden rounded-xl border text-left disabled:opacity-45">
            {title.image_url && <img src={title.image_url} alt="" loading="lazy" className="bg-secondary aspect-video w-full object-cover" />}
            <span className="block truncate px-3 pt-3 text-sm font-semibold">{title.title}</span>
            <span className="text-muted-foreground block truncate px-3 pb-3 pt-1 text-xs">{title.subtitle ?? (title.available ? 'View details' : 'Unavailable')}</span>
          </button>
        ))}
      </div>
      {page?.next_cursor && <Btn variant="secondary" className="mt-4" disabled={loading} onClick={() => { setCursor(page.next_cursor); setPage(null) }}>Next page</Btn>}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? 'Title details'}
        footer={<>{(detail?.actions ?? []).map((action) => (
          <Btn key={action} disabled={!detail?.available || remote.pending} onClick={() => void remote.send({ action, item_id: detail!.id })}>{action === 'resume' ? 'Resume on TV' : 'Open on TV'}</Btn>
        ))}</>}>
        {selected?.image_url && <img src={selected.image_url} alt="" className="mb-3 aspect-video w-full rounded-xl object-cover" />}
        <p className="text-muted-foreground text-sm">{detail?.subtitle ?? selected?.subtitle ?? 'Choose an available action to open this title on the selected TV.'}</p>
        {!detail && <p role="status" className="text-muted-foreground mt-3 text-sm">Loading title actions…</p>}
      </Modal>
    </section>
  )
}
