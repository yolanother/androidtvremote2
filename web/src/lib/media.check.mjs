/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Dependency-free runnable check for the now-playing surface's pure logic. Exercises the
 * local playhead extrapolation (advance while PLAYING, hold while paused, clamp to the
 * track, tolerate a skewed or missing `position_at`), the clock and season/episode
 * formatters, and the foreground-app resolution that falls back from the Cast display
 * name to the catalog to the raw package. Uses node:test so the maths behind the progress
 * bar has a regression guard without adding a test framework to web/package.json.
 * Run with: node --test web/src/lib/media.check.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { episodeLabel, foregroundApp, formatTime, playheadAt } from './media.ts'

/** A media session with the fields these checks care about, defaults filled in. */
function session(partial) {
  return {
    title: 'Stranger Things',
    subtitle: null,
    album: null,
    season: null,
    episode: null,
    content_type: 'video/mp4',
    player_state: 'PLAYING',
    duration: 600,
    position: 100,
    position_at: '2026-08-21T12:00:00Z',
    images: [],
    can_pause: true,
    can_seek: true,
    ...partial,
  }
}

const SAMPLED = Date.parse('2026-08-21T12:00:00Z')

test('a playing session advances by the elapsed wall-clock time', () => {
  assert.equal(playheadAt(session({}), SAMPLED), 100)
  assert.equal(playheadAt(session({}), SAMPLED + 30_000), 130)
})

test('a paused session holds the reported position however long ago it was sampled', () => {
  const paused = session({ player_state: 'PAUSED' })
  assert.equal(playheadAt(paused, SAMPLED + 300_000), 100)
  assert.equal(playheadAt(session({ player_state: 'BUFFERING' }), SAMPLED + 300_000), 100)
})

test('the playhead never runs past the duration or before the start', () => {
  assert.equal(playheadAt(session({}), SAMPLED + 10_000_000), 600)
  assert.equal(playheadAt(session({ position: -5, player_state: 'PAUSED' }), SAMPLED), 0)
})

test('an unknown duration lets the playhead keep counting up', () => {
  assert.equal(playheadAt(session({ duration: null }), SAMPLED + 10_000_000), 10_100)
})

test('an appliance clock reading ahead of the browser does not wind the playhead back', () => {
  assert.equal(playheadAt(session({}), SAMPLED - 45_000), 100)
})

test('a missing or unparseable position_at falls back to the reported position', () => {
  assert.equal(playheadAt(session({ position_at: null }), SAMPLED + 30_000), 100)
  assert.equal(playheadAt(session({ position_at: 'not a date' }), SAMPLED + 30_000), 100)
})

test('a session with no position at all starts at zero', () => {
  assert.equal(playheadAt(session({ position: null, position_at: null }), SAMPLED), 0)
})

test('times render as m:ss below an hour and h:mm:ss above it', () => {
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(9), '0:09')
  assert.equal(formatTime(132.5), '2:12')
  assert.equal(formatTime(3600), '1:00:00')
  assert.equal(formatTime(4680), '1:18:00')
  assert.equal(formatTime(null), '0:00')
  assert.equal(formatTime(-10), '0:00')
})

test('episode labels degrade from both numbers to either to nothing', () => {
  assert.equal(episodeLabel(4, 1), 'S4 · E1')
  assert.equal(episodeLabel(4, null), 'Season 4')
  assert.equal(episodeLabel(null, 1), 'Episode 1')
  assert.equal(episodeLabel(null, null), null)
})

const APPS = [
  { id: 'netflix', name: 'Netflix', package: 'com.netflix.ninja', deep_link: null, launch: 'com.netflix.ninja', icon: null, icon_url: '/api/icons/com.netflix.ninja' },
]

/** A device state with the fields foregroundApp reads. */
function deviceState(partial) {
  return {
    connection: 'connected',
    is_on: true,
    current_app: null,
    volume: null,
    last_seen: null,
    error: null,
    cast: null,
    now_playing: null,
    ...partial,
  }
}

test('the Cast display name wins, and still resolves the catalog entry for its icon', () => {
  const resolved = foregroundApp(
    deviceState({ current_app: 'AndroidNativeApp', cast: { app_id: 'CA5E8412', display_name: 'Netflix', status_text: null, volume_level: null, muted: null, available: true } }),
    APPS,
  )
  assert.equal(resolved.name, 'Netflix')
  assert.equal(resolved.app?.id, 'netflix')
})

test('the catalog name is used when Cast is silent but the package is known', () => {
  const resolved = foregroundApp(deviceState({ current_app: 'com.netflix.ninja' }), APPS)
  assert.equal(resolved.name, 'Netflix')
  assert.equal(resolved.app?.id, 'netflix')
})

test('an unrecognised package falls through to the raw package', () => {
  const resolved = foregroundApp(deviceState({ current_app: 'com.example.unknown' }), APPS)
  assert.equal(resolved.name, 'com.example.unknown')
  assert.equal(resolved.app, undefined)
})

test('the AndroidNativeApp sentinel is never shown as an app name', () => {
  assert.equal(foregroundApp(deviceState({ current_app: 'AndroidNativeApp' }), APPS).name, null)
})

test('an idle television resolves to nothing rather than to a placeholder', () => {
  assert.equal(foregroundApp(deviceState({}), APPS).name, null)
})
