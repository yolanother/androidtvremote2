/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Dependency-free runnable check for the embeddable remote's pure logic. Exercises the
 * query-string configuration parser and the idempotent power-request helper in
 * config.ts using node:test, so the embed's only non-trivial non-visual logic has a
 * regression guard without adding a test framework to the shared web/package.json.
 * Run with: node --test web/src/embed/config.check.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseEmbedConfig, powerRequest, wsUrl } from './config.ts'

test('device id is read from ?device and trimmed', () => {
  assert.equal(parseEmbedConfig('?device=aabbccddeeff').deviceId, 'aabbccddeeff')
  assert.equal(parseEmbedConfig('?device=%20aabb%20').deviceId, 'aabb')
})

test('a missing or blank device id is null, not an empty string', () => {
  assert.equal(parseEmbedConfig('').deviceId, null)
  assert.equal(parseEmbedConfig('?device=').deviceId, null)
  assert.equal(parseEmbedConfig('?device=%20%20').deviceId, null)
})

test('layout defaults to compact and only accepts the two known values', () => {
  assert.equal(parseEmbedConfig('').layout, 'compact')
  assert.equal(parseEmbedConfig('?layout=full').layout, 'full')
  assert.equal(parseEmbedConfig('?layout=FULL').layout, 'full')
  assert.equal(parseEmbedConfig('?layout=banana').layout, 'compact')
})

test('theme defaults to auto and only accepts the three known values', () => {
  assert.equal(parseEmbedConfig('').theme, 'auto')
  assert.equal(parseEmbedConfig('?theme=dark').theme, 'dark')
  assert.equal(parseEmbedConfig('?theme=light').theme, 'light')
  assert.equal(parseEmbedConfig('?theme=neon').theme, 'auto')
})

test('header defaults on and is switched off by the usual falsy spellings', () => {
  assert.equal(parseEmbedConfig('').header, true)
  assert.equal(parseEmbedConfig('?header=1').header, true)
  for (const off of ['0', 'false', 'no', 'off', 'FALSE']) {
    assert.equal(parseEmbedConfig(`?header=${off}`).header, false, off)
  }
})

test('token is captured for the websocket but absent when not supplied', () => {
  assert.equal(parseEmbedConfig('?token=s3cret').token, 's3cret')
  assert.equal(parseEmbedConfig('').token, null)
})

test('power is idempotent when the TV state is known and a toggle when it is not', () => {
  assert.deepEqual(powerRequest(true), { on: false })
  assert.deepEqual(powerRequest(false), { on: true })
  assert.deepEqual(powerRequest(null), { on: null })
})

test('wsUrl targets /api/ws on the same origin and carries the token as a query param', () => {
  assert.equal(wsUrl('http://tv.lan:7433/embed', null), 'ws://tv.lan:7433/api/ws')
  assert.equal(
    wsUrl('https://tv.lan/embed?device=x', 's3cret'),
    'wss://tv.lan/api/ws?token=s3cret',
  )
})

test('a token with url-unsafe characters survives the round trip', () => {
  const token = 'a b/c&d=e'
  const url = new URL(wsUrl('http://tv.lan/embed', token))
  assert.equal(url.searchParams.get('token'), token)
})
