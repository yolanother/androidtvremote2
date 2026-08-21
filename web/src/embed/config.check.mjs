/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Dependency-free runnable check for the embeddable remote's pure logic. Exercises the
 * query-string configuration parser (device, token, layout, theme, keys, bg, header),
 * the layout-to-key-group defaults, the same-origin WebSocket URL builder and the
 * idempotent power-request helper in config.ts using node:test, so the embed's only
 * non-trivial non-visual logic has a regression guard without adding a test framework to
 * the shared web/package.json that stream-web owns.
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

test('layout defaults to compact and accepts all four documented values', () => {
  assert.equal(parseEmbedConfig('').layout, 'compact')
  for (const layout of ['dpad', 'touchpad', 'compact', 'full']) {
    assert.equal(parseEmbedConfig(`?layout=${layout}`).layout, layout)
  }
  assert.equal(parseEmbedConfig('?layout=FULL').layout, 'full')
  assert.equal(parseEmbedConfig('?layout=banana').layout, 'compact')
})

test('the navigation surface is a touchpad only for layout=touchpad', () => {
  assert.equal(parseEmbedConfig('?layout=touchpad').surface, 'touchpad')
  for (const layout of ['dpad', 'compact', 'full']) {
    assert.equal(parseEmbedConfig(`?layout=${layout}`).surface, 'dpad')
  }
})

test('each layout brings its own default key groups', () => {
  assert.deepEqual(parseEmbedConfig('?layout=dpad').keys, ['dpad'])
  assert.deepEqual(parseEmbedConfig('?layout=touchpad').keys, ['dpad', 'back', 'home'])
  assert.deepEqual(parseEmbedConfig('?layout=compact').keys, [
    'dpad',
    'back',
    'home',
    'power',
    'volume',
  ])
  assert.deepEqual(parseEmbedConfig('?layout=full').keys, [
    'dpad',
    'back',
    'home',
    'power',
    'transport',
    'volume',
  ])
})

test('?keys overrides the layout defaults, keeping the caller order', () => {
  assert.deepEqual(parseEmbedConfig('?keys=volume').keys, ['volume'])
  assert.deepEqual(parseEmbedConfig('?keys=power,volume').keys, ['power', 'volume'])
  assert.deepEqual(parseEmbedConfig('?keys=%20POWER%20,%20dpad%20').keys, ['power', 'dpad'])
})

test('?keys drops unknown groups and duplicates, and an all-unknown list is ignored', () => {
  assert.deepEqual(parseEmbedConfig('?keys=power,nonsense,power').keys, ['power'])
  // Nothing recognisable means the operator mistyped: fall back to the layout default
  // rather than rendering an empty frame.
  assert.deepEqual(parseEmbedConfig('?layout=compact&keys=nonsense').keys, [
    'dpad',
    'back',
    'home',
    'power',
    'volume',
  ])
  assert.deepEqual(parseEmbedConfig('?layout=dpad&keys=').keys, ['dpad'])
})

test('a volume-only strip is expressible, which is the point of ?keys', () => {
  const config = parseEmbedConfig('?device=x&keys=volume')
  assert.deepEqual(config.keys, ['volume'])
  assert.equal(config.keys.includes('dpad'), false)
})

test('theme defaults to auto and only accepts the three known values', () => {
  assert.equal(parseEmbedConfig('').theme, 'auto')
  assert.equal(parseEmbedConfig('?theme=dark').theme, 'dark')
  assert.equal(parseEmbedConfig('?theme=light').theme, 'light')
  assert.equal(parseEmbedConfig('?theme=neon').theme, 'auto')
})

test('?bg=transparent is the only value that turns the backdrop off', () => {
  assert.equal(parseEmbedConfig('').transparent, false)
  assert.equal(parseEmbedConfig('?bg=transparent').transparent, true)
  assert.equal(parseEmbedConfig('?bg=TRANSPARENT').transparent, true)
  assert.equal(parseEmbedConfig('?bg=black').transparent, false)
})

test('the status strip is on for page-sized layouts and off for a bare D-pad', () => {
  assert.equal(parseEmbedConfig('?layout=compact').header, true)
  assert.equal(parseEmbedConfig('?layout=full').header, true)
  assert.equal(parseEmbedConfig('?layout=touchpad').header, true)
  assert.equal(parseEmbedConfig('?layout=dpad').header, false)
})

test('?header overrides the per-layout default in both directions', () => {
  assert.equal(parseEmbedConfig('?layout=dpad&header=1').header, true)
  for (const off of ['0', 'false', 'no', 'off', 'FALSE']) {
    assert.equal(parseEmbedConfig(`?layout=full&header=${off}`).header, false, off)
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
