/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Reader for the appliance's own OpenAPI document, which backs the API reference screen
 * and its request playground. Fetches `/api/openapi.json`, flattens its nested
 * paths/methods object into an ordered list of operations carrying the parameters, request
 * schema, and responses each one declares, groups those operations by tag for the page's
 * table of contents, resolves `$ref` pointers into `components.schemas`, and synthesises a
 * realistic JSON request body from a schema so the playground opens pre-filled rather than
 * blank. Deriving the reference from the live document means it can never drift from the
 * appliance actually serving it. Only the subset of OpenAPI that FastAPI emits is modelled.
 */

/** A JSON Schema node as it appears in the appliance's document. */
export interface Schema {
  $ref?: string
  type?: string
  format?: string
  title?: string
  description?: string
  enum?: unknown[]
  default?: unknown
  example?: unknown
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  anyOf?: Schema[]
  allOf?: Schema[]
  additionalProperties?: Schema | boolean
}

/** A single declared parameter (path, query, or header). */
export interface Parameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: Schema
}

/** One method on one path, as the document declares it. */
export interface RawOperation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: Parameter[]
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: Schema }>
  }
  responses?: Record<string, { description?: string }>
}

/** The document itself, reduced to the parts this UI reads. */
export interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string; description?: string }
  paths: Record<string, Record<string, RawOperation>>
  components?: { schemas?: Record<string, Schema> }
}

/** One HTTP response the operation documents. */
export interface ResponseDescriptor {
  status: string
  description: string
}

/** An operation flattened out of the document, ready to render and to invoke. */
export interface ApiOperation {
  /** Stable slug used for anchors, list keys, and the playground's selection. */
  id: string
  /** Lowercase HTTP method. */
  method: string
  /** Templated path, e.g. `/api/devices/{device_id}`. */
  path: string
  /** Tag the operation is filed under; `general` when it declares none. */
  tag: string
  summary: string
  description: string
  /** Names of the `{placeholders}` in the path, in the order they appear. */
  pathParams: string[]
  /** Declared query parameters. */
  queryParams: Parameter[]
  /** JSON request-body schema, or null when the operation takes no body. */
  requestSchema: Schema | null
  /** Whether the body is mandatory. */
  requestRequired: boolean
  responses: ResponseDescriptor[]
}

/** Methods worth rendering; `head`, `options`, and `trace` are noise in a reference. */
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

/** Guard against a cyclic schema turning example generation into infinite recursion. */
const MAX_EXAMPLE_DEPTH = 6

/**
 * Fetch and decode the appliance's OpenAPI document.
 *
 * The document is served outside the token-protected `/api` router, so no credentials are
 * attached; a reader of the reference should not have to authenticate first.
 *
 * @returns The parsed document.
 * @throws {Error} When the appliance is unreachable or does not answer with a document.
 */
export async function fetchOpenApi(): Promise<OpenApiDocument> {
  const response = await fetch('/api/openapi.json')
  if (!response.ok) throw new Error(`The appliance answered ${response.status} for its API schema.`)
  return (await response.json()) as OpenApiDocument
}

/**
 * Turn a method and path into a slug usable as a DOM id and a React key.
 *
 * @param method - Lowercase HTTP method.
 * @param path - Templated path.
 * @returns A slug such as `post-api-devices-device-id-keys`.
 */
function slug(method: string, path: string): string {
  const cleaned = path
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${method}-${cleaned}`.toLowerCase()
}

/**
 * Read the `{placeholder}` names out of a templated path.
 *
 * The path is the authority rather than the `parameters` array: a placeholder that the
 * document forgot to declare still has to be filled in before the request can be sent.
 *
 * @param path - Templated path.
 * @returns The placeholder names, in order of appearance.
 */
function pathPlaceholders(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)
}

/**
 * Flatten the document's paths object into an ordered list of operations.
 *
 * @param doc - The parsed OpenAPI document.
 * @returns Every renderable operation, in document order.
 */
export function flattenOperations(doc: OpenApiDocument): ApiOperation[] {
  const operations: ApiOperation[] = []

  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const raw = methods[method]
      if (!raw) continue

      const parameters = raw.parameters ?? []
      const body = raw.requestBody?.content?.['application/json']?.schema ?? null

      operations.push({
        id: slug(method, path),
        method,
        path,
        tag: raw.tags?.[0] ?? 'general',
        summary: raw.summary ?? `${method.toUpperCase()} ${path}`,
        description: raw.description ?? '',
        pathParams: pathPlaceholders(path),
        queryParams: parameters.filter((parameter) => parameter.in === 'query'),
        requestSchema: body,
        requestRequired: raw.requestBody?.required ?? false,
        responses: Object.entries(raw.responses ?? {}).map(([status, response]) => ({
          status,
          description: response?.description ?? '',
        })),
      })
    }
  }

  return operations
}

/** A tag and the operations filed under it. */
export interface OperationGroup {
  tag: string
  operations: ApiOperation[]
}

/**
 * Group operations by their tag, preserving the order each tag was first seen in.
 *
 * @param operations - Flattened operations.
 * @returns One group per tag.
 */
export function groupByTag(operations: ApiOperation[]): OperationGroup[] {
  const groups = new Map<string, ApiOperation[]>()
  for (const operation of operations) {
    const existing = groups.get(operation.tag)
    if (existing) existing.push(operation)
    else groups.set(operation.tag, [operation])
  }
  return [...groups].map(([tag, ops]) => ({ tag, operations: ops }))
}

/**
 * Resolve a `$ref` pointer into the document's schema components.
 *
 * @param schema - A schema that may be a reference.
 * @param doc - The document the reference points into.
 * @returns The referenced schema, or the input unchanged when it is not a reference.
 */
export function resolveSchema(schema: Schema, doc: OpenApiDocument): Schema {
  if (!schema.$ref) return schema
  const name = schema.$ref.split('/').pop()
  const resolved = name ? doc.components?.schemas?.[name] : undefined
  return resolved ?? {}
}

/**
 * Produce a placeholder value for one scalar schema node.
 *
 * @param schema - The resolved schema.
 * @returns A representative value for its declared type.
 */
function scalarExample(schema: Schema): unknown {
  switch (schema.type) {
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return schema.format === 'date-time' ? new Date().toISOString() : 'string'
  }
}

/**
 * Build a representative JSON body from a request schema, so the playground opens with a
 * request the operator can send or edit rather than an empty box.
 *
 * An explicit `example` wins, then a `default`, then the first `enum` member, then a value
 * derived from the declared type. A `anyOf` union — how FastAPI renders an optional field —
 * uses its first non-null member, because a body full of nulls teaches the reader nothing.
 *
 * @param schema - The request schema, or null when the operation takes no body.
 * @param doc - The document, used to follow `$ref` pointers.
 * @param depth - Internal recursion guard; callers should omit it.
 * @returns The example value, or null when there is no body.
 */
export function exampleFromSchema(
  schema: Schema | null,
  doc: OpenApiDocument,
  depth = 0,
): unknown {
  if (!schema) return null
  if (depth > MAX_EXAMPLE_DEPTH) return null

  const resolved = resolveSchema(schema, doc)

  if (resolved.example !== undefined) return resolved.example
  if (resolved.default !== undefined) return resolved.default
  if (resolved.enum?.length) return resolved.enum[0]

  if (resolved.anyOf?.length) {
    const concrete = resolved.anyOf.find((member) => member.type !== 'null') ?? resolved.anyOf[0]!
    return exampleFromSchema(concrete, doc, depth + 1)
  }

  if (resolved.allOf?.length) {
    return Object.assign(
      {},
      ...resolved.allOf.map((member) => exampleFromSchema(member, doc, depth + 1)),
    ) as unknown
  }

  if (resolved.type === 'array') {
    return [exampleFromSchema(resolved.items ?? {}, doc, depth + 1)]
  }

  if (resolved.properties) {
    const example: Record<string, unknown> = {}
    for (const [name, property] of Object.entries(resolved.properties)) {
      example[name] = exampleFromSchema(property, doc, depth + 1)
    }
    return example
  }

  if (resolved.type === 'object') return {}

  return scalarExample(resolved)
}

/**
 * Render a request as a copy-and-run `curl` command.
 *
 * @param method - HTTP method.
 * @param url - Absolute or origin-relative URL, already substituted.
 * @param body - Request body text, or null.
 * @param token - Bearer token to include, or null when the appliance is unauthenticated.
 * @returns A multi-line shell command.
 */
export function curlFor(
  method: string,
  url: string,
  body: string | null,
  token: string | null,
): string {
  const lines = [`curl -X ${method.toUpperCase()} '${url}'`]
  if (token) lines.push(`  -H 'Authorization: Bearer ${token}'`)
  if (body) {
    lines.push(`  -H 'Content-Type: application/json'`)
    lines.push(`  -d '${body.replace(/\n\s*/g, '')}'`)
  }
  return lines.join(' \\\n')
}
