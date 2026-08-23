/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Self-check for the OpenAPI reader that drives the Android TV Remote API reference and
 * its playground. Exercises the parts that would silently render a wrong document rather
 * than fail loudly: flattening a paths object into ordered operations, extracting path and
 * query parameters, following `$ref` into `components.schemas`, and synthesising a request
 * body example from a schema (including enums, nullable `anyOf` unions, arrays, and the
 * `example`/`default` hints FastAPI emits). Run with `npm run test` in web/, which uses
 * Node's built-in test runner and type stripping — the project has no test framework.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  exampleFromSchema,
  flattenOperations,
  groupByTag,
  type OpenApiDocument,
} from './openapi.ts'

/** A miniature document shaped exactly like the one FastAPI emits for the appliance. */
const DOC: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 'Android TV Remote', version: '1.4.0' },
  paths: {
    '/api/devices': {
      get: {
        tags: ['devices'],
        summary: 'List devices',
        responses: { '200': { description: 'Every registered television' } },
      },
      post: {
        tags: ['devices'],
        summary: 'Register a device',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterDeviceRequest' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/devices/{device_id}/keys': {
      post: {
        tags: ['keys'],
        summary: 'Send a key',
        parameters: [
          { name: 'device_id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'dry_run', in: 'query', required: false, schema: { type: 'boolean' } },
        ],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SendKeyRequest' } } },
        },
        responses: { '204': { description: 'Sent' } },
      },
    },
  },
  components: {
    schemas: {
      RegisterDeviceRequest: {
        type: 'object',
        required: ['host'],
        properties: {
          host: { type: 'string', example: '192.168.1.23' },
          name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      SendKeyRequest: {
        type: 'object',
        properties: {
          key: { type: 'string', default: 'KEYCODE_DPAD_UP' },
          direction: { type: 'string', enum: ['SHORT', 'START_LONG', 'END_LONG'] },
          repeat: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

test('flattenOperations yields one entry per method, in document order', () => {
  const operations = flattenOperations(DOC)
  assert.deepEqual(
    operations.map((operation) => `${operation.method} ${operation.path}`),
    ['get /api/devices', 'post /api/devices', 'post /api/devices/{device_id}/keys'],
  )
  assert.equal(operations[0]!.summary, 'List devices')
  assert.equal(operations[0]!.id, 'get-api-devices')
})

test('flattenOperations separates path parameters from query parameters', () => {
  const sendKey = flattenOperations(DOC).find((operation) => operation.path.endsWith('/keys'))!
  assert.deepEqual(sendKey.pathParams, ['device_id'])
  assert.deepEqual(
    sendKey.queryParams.map((parameter) => parameter.name),
    ['dry_run'],
  )
})

test('a path parameter is found even when the document declares no parameters', () => {
  const bare: OpenApiDocument = {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: { '/api/devices/{device_id}': { delete: { responses: {} } } },
  }
  assert.deepEqual(flattenOperations(bare)[0]!.pathParams, ['device_id'])
})

test('an untagged operation is grouped, not dropped', () => {
  const bare: OpenApiDocument = {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: { '/healthz': { get: { responses: {} } } },
  }
  const groups = groupByTag(flattenOperations(bare))
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.operations.length, 1)
})

test('groupByTag keeps tags in first-seen order', () => {
  assert.deepEqual(
    groupByTag(flattenOperations(DOC)).map((group) => group.tag),
    ['devices', 'keys'],
  )
})

test('exampleFromSchema follows a $ref and prefers explicit examples and defaults', () => {
  const register = flattenOperations(DOC)[1]!
  assert.deepEqual(exampleFromSchema(register.requestSchema, DOC), {
    host: '192.168.1.23',
    name: 'string',
  })
  const sendKey = flattenOperations(DOC)[2]!
  assert.deepEqual(exampleFromSchema(sendKey.requestSchema, DOC), {
    key: 'KEYCODE_DPAD_UP',
    direction: 'SHORT',
    repeat: 0,
    tags: ['string'],
  })
})

test('exampleFromSchema returns null for an operation with no body', () => {
  assert.equal(exampleFromSchema(flattenOperations(DOC)[0]!.requestSchema, DOC), null)
})

test('a self-referencing schema terminates instead of recursing forever', () => {
  const recursive: OpenApiDocument = {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: {},
    components: {
      schemas: {
        Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } },
      },
    },
  }
  const value = exampleFromSchema({ $ref: '#/components/schemas/Node' }, recursive)
  assert.equal(typeof value, 'object')
})
