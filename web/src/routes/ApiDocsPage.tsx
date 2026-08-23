/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * The API reference screen of the Android TV Remote web UI. Renders the appliance's own
 * OpenAPI document — fetched live, so the reference can never describe a build other than
 * the one answering — as a grouped, filterable list of operations, and pairs each one with
 * a playground that sends the real request against this appliance using the stored bearer
 * token, showing the status, elapsed time, response body, and an equivalent `curl` command.
 * Also documents the parts of the contract that live outside OpenAPI: authentication, the
 * shared error envelope, and the `/api/ws` event stream.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, KeyRound, Play, Radio, Search, Send } from 'lucide-react'

import { Btn, ErrorStrip, Field } from '@/components/ui'
import { Card, CodeBlock, SectionHeading } from '@/components/CodeBlock'
import { Page, PageHeader } from '@/components/AppShell'
import { cn } from '@/lib/utils'
import { getToken } from '@/lib/api'
import { useRemote } from '@/state/store'
import {
  curlFor,
  exampleFromSchema,
  fetchOpenApi,
  flattenOperations,
  groupByTag,
  type ApiOperation,
  type OpenApiDocument,
} from '@/lib/openapi'

/** Colour per HTTP method, so the list is scannable by shape as well as by text. */
const METHOD_TONE: Record<string, string> = {
  get: 'bg-online/15 text-online',
  post: 'bg-pairing/15 text-pairing',
  patch: 'bg-pairing/15 text-pairing',
  put: 'bg-pairing/15 text-pairing',
  delete: 'bg-destructive/15 text-destructive',
}

/** The contract's error codes, which OpenAPI does not carry. */
const ERROR_CODES: Array<[string, string, string]> = [
  ['device_not_found', '404', 'Unknown device id.'],
  ['device_exists', '409', 'That MAC address is already registered.'],
  ['not_paired', '409', 'Command sent to a television with no certificate.'],
  ['pairing_not_started', '409', '`pair/complete` was called before `pair`.'],
  ['invalid_pairing_code', '400', 'The television rejected the code.'],
  ['unreachable', '503', 'The television did not answer.'],
  ['invalid_key', '400', 'Key is not in the catalog.'],
  ['invalid_request', '400', 'Malformed request body.'],
  ['no_media_session', '409', 'Nothing is casting to that television.'],
  ['not_found', '404', 'No such endpoint.'],
  ['unauthorized', '401', 'Missing or wrong token.'],
  ['internal_error', '500', 'Anything else.'],
]

/**
 * The API reference screen.
 */
export function ApiDocsPage() {
  const [doc, setDoc] = useState<OpenApiDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void fetchOpenApi()
      .then(setDoc)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const groups = useMemo(() => {
    if (!doc) return []
    const needle = query.trim().toLowerCase()
    const operations = flattenOperations(doc).filter(
      (operation) =>
        needle === '' ||
        operation.path.toLowerCase().includes(needle) ||
        operation.summary.toLowerCase().includes(needle) ||
        operation.method.includes(needle),
    )
    return groupByTag(operations)
  }, [doc, query])

  const origin = window.location.origin

  return (
    <Page>
      <PageHeader
        title="API reference"
        description="Generated from this appliance's own OpenAPI document, so it always describes the build you are talking to. Every operation below can be sent for real."
      />

      <ErrorStrip message={error} onDismiss={() => setError(null)} />

      <Card>
        <SectionHeading
          title="Base URL and authentication"
          icon={<KeyRound aria-hidden className="size-4" />}
          description="JSON in, JSON out. Device ids are the television's MAC address, lowercased with colons stripped."
        />
        <div className="flex flex-col gap-3">
          <CodeBlock caption="base url" code={`${origin}/api`} />
          <p className="text-muted-foreground text-sm text-pretty">
            When the appliance runs with <code className="font-mono text-xs">REMOTE_API_TOKEN</code>{' '}
            set, every request needs a bearer token. Anything you send from the playground below
            uses the token stored in{' '}
            <Link to="/settings" className="underline underline-offset-2">
              Settings
            </Link>
            . Without that variable the appliance is open and no header is needed.
          </p>
          <CodeBlock
            caption="authenticated request"
            code={`curl '${origin}/api/devices' \\\n  -H 'Authorization: Bearer $REMOTE_API_TOKEN'`}
          />
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Errors"
          icon={<AlertTriangle aria-hidden className="size-4" />}
          description="Every non-2xx response uses one envelope, so a client parses one shape."
        />
        <CodeBlock
          caption="error envelope"
          code={`{ "error": { "code": "device_not_found", "message": "No device with id aabbccddeeff" } }`}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">code</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">HTTP</th>
                <th scope="col" className="py-1.5 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ERROR_CODES.map(([code, status, meaning]) => (
                <tr key={code}>
                  <td className="py-1.5 pr-3 font-mono text-xs">{code}</td>
                  <td className="text-muted-foreground py-1.5 pr-3 font-mono text-xs">{status}</td>
                  <td className="py-1.5 text-pretty">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Live event stream"
          icon={<Radio aria-hidden className="size-4" />}
          description="A WebSocket that pushes a full snapshot on connect and a delta on every change. Nothing in this UI polls."
        />
        <CodeBlock
          caption="javascript"
          code={`const socket = new WebSocket('${origin.replace(/^http/, 'ws')}/api/ws?token=TOKEN')

socket.onmessage = (event) => {
  const frame = JSON.parse(event.data)
  // frame.type is 'snapshot' | 'device.state' | 'device.added' |
  // 'device.removed' | 'pairing' | 'discovery'
  console.log(frame.type, frame)
}`}
        />
        <p className="text-muted-foreground mt-3 text-sm text-pretty">
          The token travels as a query parameter here because the browser's WebSocket
          constructor cannot set headers. REST calls should use the header instead, which keeps
          the token out of server access logs.
        </p>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Endpoints</h2>
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Filter endpoints</span>
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by path or summary"
            className="bg-card min-h-11 w-full rounded-xl border pr-3 pl-9 text-base outline-none focus-visible:border-ring"
          />
        </label>
      </div>

      {!doc && !error && (
        <Card className="text-muted-foreground text-sm">Loading the appliance's schema…</Card>
      )}

      {doc &&
        groups.map((group) => (
          <section key={group.tag} className="flex flex-col gap-3">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {group.tag}
            </h3>
            {group.operations.map((operation) => (
              <OperationCard key={operation.id} operation={operation} doc={doc} />
            ))}
          </section>
        ))}

      {doc && groups.length === 0 && (
        <Card className="text-muted-foreground text-sm">No endpoint matches that filter.</Card>
      )}
    </Page>
  )
}

/**
 * One operation: its signature and description, expanding into a playground.
 *
 * @param props.operation - The flattened operation.
 * @param props.doc - The document it came from, used to build the example body.
 */
function OperationCard({ operation, doc }: { operation: ApiOperation; doc: OpenApiDocument }) {
  const [open, setOpen] = useState(false)

  return (
    <article id={operation.id} className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="hover:bg-accent/50 flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors sm:p-4"
      >
        <span
          className={cn(
            'shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] font-semibold uppercase',
            METHOD_TONE[operation.method] ?? 'bg-secondary text-muted-foreground',
          )}
        >
          {operation.method}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs sm:text-sm">{operation.path}</span>
          <span className="text-muted-foreground block truncate text-xs">{operation.summary}</span>
        </span>
        <Play
          aria-hidden
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t p-3 sm:p-4">
          {operation.description && (
            <p className="text-muted-foreground text-sm text-pretty">{operation.description}</p>
          )}

          {operation.responses.length > 0 && (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {operation.responses.map((response) => (
                <div key={response.status} className="flex gap-1.5">
                  <dt className="font-mono font-semibold">{response.status}</dt>
                  <dd className="text-muted-foreground">{response.description}</dd>
                </div>
              ))}
            </dl>
          )}

          <Playground operation={operation} doc={doc} />
        </div>
      )}
    </article>
  )
}

/** The outcome of a playground request. */
interface Result {
  status: number
  statusText: string
  ms: number
  body: string
}

/**
 * A live request builder for one operation: fills path parameters (offering the registered
 * televisions for a `device_id`), pre-fills the body from the schema, sends the real
 * request with the stored token, and shows the outcome alongside the equivalent `curl`.
 *
 * @param props.operation - The operation to invoke.
 * @param props.doc - The document, used to synthesise the example body.
 */
function Playground({ operation, doc }: { operation: ApiOperation; doc: OpenApiDocument }) {
  const { state } = useRemote()
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      operation.pathParams.map((name) => [
        name,
        name === 'device_id' ? (state.devices[0]?.id ?? '') : '',
      ]),
    ),
  )
  const [body, setBody] = useState(() => {
    const example = exampleFromSchema(operation.requestSchema, doc)
    return example === null ? '' : JSON.stringify(example, null, 2)
  })
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const url = operation.pathParams.reduce(
    (path, name) => path.replace(`{${name}}`, params[name] || `{${name}}`),
    operation.path,
  )
  const missing = operation.pathParams.filter((name) => !params[name])

  const send = async () => {
    setBusy(true)
    setFailure(null)
    const started = performance.now()
    try {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      if (body.trim()) headers['Content-Type'] = 'application/json'

      const response = await fetch(url, {
        method: operation.method.toUpperCase(),
        headers,
        body: body.trim() ? body : undefined,
      })
      const text = await response.text()
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // A 204 or a non-JSON body is shown exactly as it arrived.
      }
      setResult({
        status: response.status,
        statusText: response.statusText,
        ms: Math.round(performance.now() - started),
        body: pretty || '(empty body)',
      })
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The request could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {operation.pathParams.map((name) => (
        <div key={name}>
          {name === 'device_id' && state.devices.length > 0 ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs font-medium">device_id</span>
              <select
                value={params[name] ?? ''}
                onChange={(event) => setParams({ ...params, [name]: event.target.value })}
                className="bg-card min-h-11 w-full cursor-pointer rounded-xl border px-3 text-base outline-none focus-visible:border-ring"
              >
                {state.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} — {device.id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Field
              label={name}
              value={params[name] ?? ''}
              spellCheck={false}
              onChange={(event) => setParams({ ...params, [name]: event.target.value })}
            />
          )}
        </div>
      ))}

      {operation.queryParams.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Query parameters: {operation.queryParams.map((parameter) => parameter.name).join(', ')}
        </p>
      )}

      {operation.requestSchema && (
        <label className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            Request body {operation.requestRequired ? '(required)' : '(optional)'}
          </span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            spellCheck={false}
            rows={Math.min(12, Math.max(3, body.split('\n').length))}
            className="bg-card w-full rounded-xl border p-3 font-mono text-xs outline-none focus-visible:border-ring"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={() => void send()} busy={busy} disabled={missing.length > 0}>
          <Send aria-hidden className="size-4" />
          Send request
        </Btn>
        {missing.length > 0 && (
          <span className="text-muted-foreground text-xs">
            Fill in {missing.join(', ')} to send.
          </span>
        )}
        {result && (
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold',
              result.status < 400 ? 'bg-online/15 text-online' : 'bg-destructive/15 text-destructive',
            )}
          >
            {result.status} {result.statusText} · {result.ms}ms
          </span>
        )}
      </div>

      <ErrorStrip message={failure} onDismiss={() => setFailure(null)} />

      {result && <CodeBlock caption="response" code={result.body} />}

      <CodeBlock
        caption="curl"
        code={curlFor(
          operation.method,
          `${window.location.origin}${url}`,
          operation.requestSchema && body.trim() ? body : null,
          getToken(),
        )}
      />
    </div>
  )
}
