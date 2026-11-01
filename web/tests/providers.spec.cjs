/*
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Browser acceptance tests for optional launcher-provider surfaces in Android TV
 * Remote. Exercises the real responsive UI with selected-TV REST fixtures and
 * synthetic appliance WebSocket events, asserting capability-driven controls,
 * authoritative guide actions, source-aware playback and race-safe TV/profile
 * changes without any physical TV or production-service traffic.
 */
const { test, expect } = require('@playwright/test');

const TV_A = 'aabbccddeeff';
const TV_B = '112233445566';
const PLAYER = 'org.example.player';
const CAPS = ['catalog', 'browse', 'guide', 'tune', 'channel_step', 'playback', 'profiles'];

/** One registered paired TV with the existing public Device response shape. */
function device(id, name) {
  return {
    id, name, host: id === TV_A ? '192.168.1.23' : '192.168.1.24',
    mac: id.match(/../g).join(':'), mdns_name: null, model: 'Fixture TV',
    paired: true, enabled: true, created_at: '2026-11-01T00:00:00Z',
    state: {
      connection: 'connected', is_on: true, current_app: PLAYER,
      volume: { level: 12, max: 100, muted: false },
      last_seen: new Date().toISOString(), error: null, cast: null, now_playing: null,
    },
  };
}

/** Device-scoped provider descriptor; no global household catalog is implied. */
function integration(id, available = true) {
  return {
    device_id: id, available, provider_id: available ? 'fixture' : null,
    provider_name: available ? 'Fixture launcher' : null,
    capabilities: available ? [...CAPS] : [],
    profile_id: id === TV_A ? 'family' : 'adult', profile_revision: 'profile-1', error: null,
  };
}

/** A timestamped native media observation with only advertised session actions. */
function playing(title) {
  const now = new Date().toISOString();
  return {
    session_id: 'session-a', package: PLAYER, title, subtitle: 'Episode one', images: [],
    player_state: 'PLAYING', position: 40, duration: 600, position_at: now,
    observed_at: now, channel_id: null, actions: ['pause'],
  };
}

/** Build independently mutable provider resources for two televisions. */
function fixtures() {
  const devices = [device(TV_A, 'Living Room TV'), device(TV_B, 'Bedroom TV')];
  const resources = {};
  for (const [id, label] of [[TV_A, 'Family'], [TV_B, 'Bedroom']]) {
    const now = Date.now();
    resources[id] = {
      integration: integration(id),
      catalog: { revision: 'catalog-1', profile_revision: 'profile-1', items: [
        { id: `${id}-app`, name: `${label} player`, kind: 'app', package: PLAYER, icon_url: null, available: true, action: { type: 'launch', item_id: `${id}-app` } },
        { id: `${id}-unavailable`, name: `${label} unavailable app`, kind: 'app', package: 'org.example.uninstalled', icon_url: null, available: false, action: { type: 'launch', item_id: `${id}-unavailable` } },
      ] },
      guide: { revision: 'guide-1', profile_revision: 'profile-1', timezone: 'UTC', server_time: new Date(now).toISOString(), channels: [
        { id: `${id}-channel`, name: `${label} recommendations`, number: 1, kind: 'recommendation', programmes: [
          { id: `${id}-programme`, title_id: `${id}-title`, title: `${label} programme`, subtitle: 'Current title', image_url: null, start: new Date(now - 600000).toISOString(), end: new Date(now + 3000000).toISOString(), available: true },
          { id: `${id}-future`, title_id: `${id}-future-title`, title: `${label} next programme`, subtitle: 'Coming up', image_url: null, start: new Date(now + 3000000).toISOString(), end: new Date(now + 6600000).toISOString(), available: true },
        ] },
      ] },
      playback: playing(`${label} observed title`),
      browse: { revision: 'browse-1', profile_revision: 'profile-1', items: [{ id: `${id}-title`, title: `${label} continue title`, subtitle: null, image_url: null, available: true }], next_cursor: null },
      profiles: { items: [{ id: 'family', name: 'Family', image_url: null }, { id: 'adult', name: 'Adult', image_url: null }], active_id: id === TV_A ? 'family' : 'adult', revision: 'profile-1' },
    };
  }
  return { devices, resources, commands: [], keys: [], genericLaunches: [], requests: [] };
}

/** Mock all appliance I/O before navigation; real Vite assets still load normally. */
async function install(page, data, intercept) {
  await page.addInitScript(({ devices }) => {
    const RealSocket = window.WebSocket;
    const peers = [];
    class ApplianceSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url, protocols) {
        const parsed = new URL(url, location.href);
        if (parsed.pathname !== '/api/ws') return new RealSocket(url, protocols);
        this.readyState = 0;
        this.url = String(url);
        peers.push(this);
        setTimeout(() => {
          if (this.readyState === 3) return;
          this.readyState = 1;
          this.onopen?.(new Event('open'));
          this.emit({ type: 'snapshot', devices, discovered: [] });
        }, 0);
      }
      emit(value) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) })); }
      send(body) { if (JSON.parse(body).type === 'ping') this.emit({ type: 'pong' }); }
      close() { this.readyState = 3; }
      addEventListener(type, handler) { this[`on${type}`] = handler; }
      removeEventListener(type, handler) { if (this[`on${type}`] === handler) this[`on${type}`] = null; }
    }
    window.WebSocket = ApplianceSocket;
    window.__emitAppliance = (event) => peers.filter((p) => p.readyState === 1).forEach((p) => p.emit(event));
  }, { devices: data.devices });
  await page.route('**/healthz', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', devices: 2, connected: 2, version: 'fixture', public_url: null }) }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    data.requests.push({ method: req.method(), path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (intercept && await intercept(route, url)) return;
    const response = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/devices') return response(data.devices);
    if (url.pathname === '/api/discovery' || url.pathname === '/api/keys') return response([]);
    if (url.pathname === '/api/apps') return response([{ id: 'generic-player', name: 'Generic player', package: PLAYER, deep_link: null, launch: PLAYER, icon: null, icon_url: null }]);
    if (url.pathname === '/api/providers') return response([{ id: 'fixture', name: 'Fixture launcher', enabled: true, available: true }]);
    if (url.pathname.startsWith('/api/icons/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' });
    const match = /^\/api\/devices\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!match) return response({ error: { code: 'not_found', message: 'Unmocked API route' } }, 404);
    const [, id, resource] = match;
    const tv = data.resources[id];
    if (resource === 'integrations') return response(tv.integration);
    if (['catalog', 'guide', 'playback', 'browse', 'profiles'].includes(resource)) {
      if (!tv.integration.available) return response({ error: { code: 'provider_unavailable', message: 'Launcher unavailable' } }, 503);
      if (resource === 'browse' && url.searchParams.get('query')) return response({ ...tv.browse, items: [{ id: `${id}-search-result`, title: `Search result ${url.searchParams.get('query')}`, subtitle: null, image_url: null, available: true }] });
      return response(tv[resource]);
    }
    if (resource.startsWith('titles/')) return response({ id: resource.slice(7), title: id === TV_A ? 'Family title details' : 'Bedroom title details', subtitle: 'Title details', image_url: null, available: true, actions: ['open', 'resume'] });
    if (resource === 'provider/commands') {
      const body = req.postDataJSON();
      data.commands.push({ device_id: id, ...body });
      return response({ command_id: body.command_id, status: 'accepted' });
    }
    if (resource === 'keys') { data.keys.push({ device_id: id, ...req.postDataJSON() }); return response({}, 202); }
    if (resource === 'launch') { data.genericLaunches.push({ device_id: id, ...req.postDataJSON() }); return response({}, 202); }
    if (resource === 'state' || resource === 'volume' || resource === 'power') return response(data.devices.find((d) => d.id === id).state);
    return response({}, 202);
  });
}

/** Destinations may be represented by accessible tabs or navigation buttons. */
function destination(page, name) {
  return page.getByRole('tab', { name, exact: true }).or(page.getByRole('button', { name, exact: true }));
}

/** Deliver the documented reactive event without opening an appliance socket. */
async function emit(page, event) {
  await page.evaluate((value) => window.__emitAppliance(value), event);
}

/** Switch through the visible television chooser rather than remounting the whole app. */
async function selectTv(page, fromName, toName) {
  await page.getByRole('button', { name: new RegExp(fromName) }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(toName) }).click();
}

test('a capable selected TV exposes the Guide destination', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await expect(page.getByRole('button', { name: /Living Room TV/ }).first()).toBeVisible();
  await expect(destination(page, 'Guide')).toBeVisible();
});

test('without a provider the remote retains generic keys and app launching', async ({ page }) => {
  const data = fixtures();
  data.resources[TV_A].integration = integration(TV_A, false);
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await expect(destination(page, 'Guide')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => data.keys.length).toBe(1);
  expect(data.keys[0]).toMatchObject({ device_id: TV_A });
  expect(data.keys[0].key).toMatch(/BACK$/);
  await destination(page, /^Apps(?: & services)?$/).click();
  await page.getByRole('button', { name: /^Generic player(?:\s|$)/ }).click();
  await expect.poll(() => data.genericLaunches.length).toBe(1);
  expect(data.genericLaunches[0]).toMatchObject({ device_id: TV_A, app: PLAYER });
});

for (const profileId of ['family', null]) {
test(`guide channel actions target the selected TV without fabricating playback (${profileId ?? 'household'})`, async ({ page }) => {
  const data = fixtures();
  data.resources[TV_A].integration.profile_id = profileId;
  data.resources[TV_A].playback = null;
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Guide').click();
  await expect(page.getByText('Family programme', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Channel up', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_A, action: 'channel_step', direction: 'up', profile_id: profileId });
  expect(data.commands[0].command_id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  await destination(page, 'Playing').click();
  await expect(page.getByText('Family observed title', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Living Room TV/ }).first()).toBeVisible();
});
}

test('future guide selection opens title details before any playback command', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Guide').click();
  await page.getByText('Family next programme', { exact: true }).click();
  await expect(page.getByText('Family title details', { exact: true })).toBeVisible();
  expect(data.commands).toEqual([]);
  expect(data.requests.some((r) => r.path === `/api/devices/${TV_A}/titles/${TV_A}-future-title`)).toBe(true);
});

test('installed apps are per TV and unavailable apps cannot launch', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, /^Apps(?: & services)?$/).click();
  await expect(page.getByRole('button', { name: /Family unavailable app/ })).toBeDisabled();
  await page.getByRole('button', { name: /Family player/ }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_A, action: 'launch', item_id: `${TV_A}-app` });
  await selectTv(page, 'Living Room TV', 'Bedroom TV');
  await destination(page, /^Apps(?: & services)?$/).click();
  await expect(page.getByRole('button', { name: /Bedroom player/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Family player/ })).toHaveCount(0);
});

test('a late guide response from the previous TV cannot populate the new TV', async ({ page }) => {
  const data = fixtures();
  let release;
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  await install(page, data, async (route, url) => {
    if (url.pathname !== `/api/devices/${TV_A}/guide`) return false;
    entered();
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data.resources[TV_A].guide) }).catch(() => {});
    return true;
  });
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Guide').click();
  await waiting;
  await selectTv(page, 'Living Room TV', 'Bedroom TV');
  await destination(page, 'Guide').click();
  await expect(page.getByText('Bedroom programme', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText('Family programme', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Channel down', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_B, action: 'channel_step', direction: 'down' });
});

test('capable TVs offer continue watching, search and a TV-scoped profile picker', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, /^Apps(?: & services)?$/).click();
  await expect(page.getByText('Family continue title', { exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: /search/i }).or(page.getByRole('textbox', { name: /search/i }));
  await search.fill('cats');
  await search.press('Enter');
  await expect(page.getByText('Search result cats', { exact: true })).toBeVisible();
  const nativePicker = page.getByRole('combobox', { name: /profile/i });
  if (await nativePicker.count()) await nativePicker.selectOption('adult');
  else {
    await page.getByRole('button', { name: /profile/i }).click();
    await page.getByRole('option', { name: 'Adult', exact: true }).click();
  }
  await expect.poll(() => data.commands.find((command) => command.action === 'set_profile')).toBeTruthy();
  expect(data.commands.find((command) => command.action === 'set_profile')).toMatchObject({ device_id: TV_A, item_id: 'adult' });
});

test('observed provider playback uses only advertised session-scoped actions', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Playing').click();
  await expect(page.getByText('Family observed title', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_A, action: 'pause', session_id: 'session-a' });
  const seek = page.getByRole('slider', { name: /seek/i });
  if (await seek.count()) await expect(seek).toBeDisabled();
  expect(data.commands.some((command) => command.action === 'seek')).toBe(false);
});

for (const unavailable of ['stale', 'other-app', 'unknown', 'idle']) {
  test(`${unavailable} provider playback falls back to a valid Cast session`, async ({ page }) => {
    const data = fixtures();
    if (unavailable === 'stale') data.resources[TV_A].playback.observed_at = new Date(Date.now() - 31000).toISOString();
    else if (unavailable === 'other-app') data.resources[TV_A].playback.package = 'org.example.other';
    else Object.assign(data.resources[TV_A].playback, { player_state: unavailable.toUpperCase(), title: null, actions: [] });
    data.devices[0].state.now_playing = {
      title: 'Current Cast title', subtitle: 'Cast subtitle', album: null, season: null, episode: null,
      content_type: 'video/mp4', player_state: 'PLAYING', position: 10, duration: 600,
      position_at: new Date().toISOString(), images: [], can_pause: true, can_seek: true,
    };
    await install(page, data);
    await page.goto(`/d/${TV_A}`);
    await destination(page, 'Playing').click();
    await expect(page.getByText('Current Cast title', { exact: true })).toBeVisible();
    await expect(page.getByText('Family observed title', { exact: true })).toHaveCount(0);
  });
}

test('integration events refresh active playback and provider loss preserves core keys', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Playing').click();
  await expect(page.getByText('Family observed title', { exact: true })).toBeVisible();
  data.resources[TV_A].playback.title = 'Newly observed title';
  await emit(page, { type: 'integration.updated', device_id: TV_A, integration: data.resources[TV_A].integration });
  await expect(page.getByText('Newly observed title', { exact: true })).toBeVisible();
  data.resources[TV_A].integration = integration(TV_A, false);
  await emit(page, { type: 'integration.updated', device_id: TV_A, integration: data.resources[TV_A].integration });
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => data.keys.length).toBe(1);
  expect(data.keys[0].device_id).toBe(TV_A);
});

test('a profile change discards an old in-flight catalog response', async ({ page }) => {
  const data = fixtures();
  let release;
  let entered;
  let heldOnce = false;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const oldCatalog = structuredClone(data.resources[TV_A].catalog);
  await install(page, data, async (route, url) => {
    if (url.pathname !== `/api/devices/${TV_A}/catalog` || heldOnce) return false;
    heldOnce = true;
    entered();
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(oldCatalog) }).catch(() => {});
    return true;
  });
  await page.goto(`/d/${TV_A}`);
  await destination(page, /^Apps(?: & services)?$/).click();
  await waiting;
  data.resources[TV_A].integration.profile_id = 'kids';
  data.resources[TV_A].integration.profile_revision = 'kids-2';
  data.resources[TV_A].catalog = { revision: 'catalog-2', profile_revision: 'kids-2', items: [{
    id: 'kids-app', name: 'Kids player', kind: 'app', package: PLAYER, icon_url: null,
    available: true, action: { type: 'launch', item_id: 'kids-app' },
  }] };
  await emit(page, { type: 'integration.updated', device_id: TV_A, integration: data.resources[TV_A].integration });
  await expect(page.getByRole('button', { name: /Kids player/ })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: /Family player/ })).toHaveCount(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
  test(`guide and core controls remain usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const data = fixtures();
    await install(page, data);
    await page.goto(`/d/${TV_A}`);
    await destination(page, 'Guide').click();
    await expect(page.getByText('Family programme', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Volume up', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Volume up', exact: true })).toBeInViewport({ ratio: 1 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return { interactive: element.matches('button,a,input,select,[tabindex]'), width: box.width, height: box.height, outline: style.outlineStyle, shadow: style.boxShadow };
    });
    expect(focus.interactive).toBe(true);
    expect(focus.width).toBeGreaterThan(0);
    expect(focus.height).toBeGreaterThan(0);
    expect(focus.outline !== 'none' || focus.shadow !== 'none').toBe(true);
    if (viewport.width === 1440) {
      const content = await page.getByRole('main').boundingBox();
      expect(content.width).toBeGreaterThan(650);
    }
  });
}
