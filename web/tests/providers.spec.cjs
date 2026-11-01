/*
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Browser acceptance tests for optional launcher-provider surfaces in Android TV
 * Remote. Exercises the real responsive UI with selected-TV REST fixtures and
 * synthetic appliance WebSocket events, asserting capability-driven controls,
 * authoritative guide actions, source-aware playback and race-safe TV/profile
 * changes without any physical TV or production-service traffic.
 * Also checks compact navigation and actual control-pane geometry, wheel/touch
 * scrolling, held keys, independently scrollable browsing destinations, real app
 * icons and TV usage ranking, profile artwork, spring tab transitions and a compact
 * artwork-rich guide timeline on phones as well as larger displays.
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

test('provider apps use package icons when optional provider artwork is absent', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Apps').click();
  const app = page.getByRole('button', { name: 'Open Family player', exact: true });
  await expect(app.locator('img')).toHaveAttribute('src', `/api/icons/${PLAYER}`);
  await expect.poll(() => data.requests.some((r) => r.path === `/api/icons/${PLAYER}`)).toBe(true);
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
  const more = page.getByRole('region', { name: 'Apps and services', exact: true }).getByRole('button', { name: /View more/i });
  if (await more.count()) await more.click();
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

/** Let browser layout and pointer-driven React updates settle without timing guesses. */
async function frames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Exercise old controls on the RED baseline as well as the replacement dropdown. */
async function chooseMode(page, mode) {
  const picker = page.getByRole('combobox', { name: 'Control mode', exact: true });
  if (await picker.count()) await picker.selectOption(mode);
  else await page.getByRole('button', { name: { dpad: 'D-pad', touch: 'Touchpad', text: 'Text' }[mode], exact: true }).click();
  await frames(page);
}

/** Capture every control ancestor, since a locked document can still hide an inner scroll defect. */
async function controlGeometry(surface) {
  return surface.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      ancestors.push({ tag: node.tagName, role: node.getAttribute('role'),
        top: node.scrollTop, left: node.scrollLeft, range: node.scrollHeight - node.clientHeight,
        scrollable: /auto|scroll/.test(style.overflowY) });
    }
    return { x: box.x, y: box.y, width: box.width, height: box.height,
      windowX: window.scrollX, windowY: window.scrollY, ancestors };
  });
}

/** Dispatch actual Chromium touch input so native scrolling and pointer handlers both participate. */
async function touchGesture(page, surface, mode, tap = false) {
  const box = await surface.boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const x = box.x + box.width / 2;
  const y = mode === 'dpad' ? box.y + Math.min(34, box.height * .18) : box.y + box.height * .72;
  const point = (at) => ({ x, y: at, id: 1, radiusX: 3, radiusY: 3, force: 1 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(y)] });
  await frames(page);
  if (!tap) {
    const distance = Math.min(125, box.height * .5);
    for (let step = 1; step <= 5; step++) {
      const next = mode === 'dpad' ? y + distance * step / 5 : y - distance * step / 5;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(next)] });
      await frames(page);
    }
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await frames(page);
  await client.detach();
}

/** All primary keys must remain reachable; clipping the control stage is not a layout fix. */
async function expectCoreKeysInViewport(page) {
  for (const name of ['Back', 'Home', 'Menu', 'Power off', 'Previous', 'Play or pause', 'Next', 'Mute', 'Volume down', 'Volume up']) {
    await expect.soft(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
}

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test(`compact action bar and selected-only destination labels at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const data = fixtures();
    await install(page, data);
    await page.goto(`/d/${TV_A}`);
    const profile = page.getByRole('combobox', { name: 'TV profile', exact: true });
    await expect(profile).toBeVisible();
    expect.soft(await profile.evaluate((element) => !!element.closest('header'))).toBe(true);
    const nav = page.getByRole('tablist', { name: 'Remote destination' });
    await expect(nav).toBeVisible();
    const mode = page.getByRole('combobox', { name: 'Control mode', exact: true });
    await expect.soft(mode).toHaveCount(1);
    for (const selected of ['Controls', 'Apps', 'Guide', 'Playing']) {
      await destination(page, selected).click();
      await expect(destination(page, selected)).toHaveAttribute('aria-selected', 'true');
      // Labels stay mounted while spring widths animate. Assess the settled visual
      // result rather than requiring conditional DOM removal, which causes jumps.
      await expect.poll(() => destination(page, selected).evaluate((element) => {
        const text = [...element.querySelectorAll('span')].find((node) => node.textContent === element.getAttribute('aria-label'));
        return text ? text.getBoundingClientRect().width : 0;
      })).toBeGreaterThan(10);
      for (const label of ['Controls', 'Apps', 'Guide', 'Playing']) {
        await expect.poll(() => destination(page, label).evaluate((element, name) => {
          const nodes = [...element.querySelectorAll('span')].filter((node) => node.textContent === name);
          return nodes.some((node) => {
            const rect = node.getBoundingClientRect();
            let left = rect.left;
            let right = rect.right;
            let opacity = 1;
            for (let parent = node; parent && parent !== element.parentElement; parent = parent.parentElement) {
              const css = getComputedStyle(parent);
              opacity *= Number(css.opacity);
              if (/hidden|clip/.test(css.overflowX)) {
                const clip = parent.getBoundingClientRect();
                left = Math.max(left, clip.left);
                right = Math.min(right, clip.right);
              }
            }
            return right - left > 2 && opacity > .1;
          });
        }, label), { message: `${label} visually expanded while ${selected} selected` }).toBe(label === selected);
        await expect(destination(page, label)).toBeVisible();
      }
    }
    if (await mode.count()) {
      const picker = await mode.boundingBox();
      const tabs = await nav.boundingBox();
      expect.soft(picker.width).toBeLessThanOrEqual(48);
      expect.soft(Math.abs(picker.y + picker.height / 2 - tabs.y - tabs.height / 2)).toBeLessThanOrEqual(2);
      expect.soft(picker.x).toBeGreaterThanOrEqual(tabs.x + tabs.width - 1);
      await mode.focus();
      expect(await mode.evaluate((element) => element === document.activeElement)).toBe(true);
    }
    expect.soft(await page.getByRole('group', { name: 'Control mode', exact: true }).count()).toBe(0);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await profile.selectOption('adult');
    await expect.poll(() => data.commands.find((command) => command.action === 'set_profile')).toBeTruthy();
    expect(data.commands.find((command) => command.action === 'set_profile')).toMatchObject({ device_id: TV_A, item_id: 'adult', profile_id: 'family', profile_revision: 'profile-1' });
  });
}

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  for (const mode of ['dpad', 'touch']) {
    test(`${mode} control surface never scrolls at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const data = fixtures();
      await install(page, data);
      await page.goto(`/d/${TV_A}`);
      await chooseMode(page, mode);
      const surface = page.locator('[data-remote-surface]').first();
      await expect(surface).toBeVisible();
      const before = await controlGeometry(surface);
      expect.soft(before.width).toBeGreaterThanOrEqual(120);
      expect.soft(before.height).toBeGreaterThanOrEqual(120);
      await expect.soft(surface).toBeInViewport({ ratio: 1 });
      await expectCoreKeysInViewport(page);
      const scrollRanges = before.ancestors.filter((ancestor) => ancestor.scrollable && ancestor.range > 1);
      expect.soft(scrollRanges, 'No scrollable ancestor may own the D-pad/touchpad').toEqual([]);
      const box = await surface.boundingBox();
      await page.mouse.move(box.x + box.width / 2, Math.min(box.y + box.height / 2, viewport.height - 20));
      await page.mouse.wheel(0, 550);
      await frames(page);
      const wheeled = await controlGeometry(surface);
      console.log(JSON.stringify({ viewport, mode, beforeY: before.y, afterWheelY: wheeled.y,
        scrollers: before.ancestors.filter((a) => a.scrollable).map((a) => ({ tag: a.tag, range: a.range })),
        beforeOffsets: before.ancestors.map((a) => a.top), afterOffsets: wheeled.ancestors.map((a) => a.top) }));
      expect.soft(wheeled.ancestors.map((a) => [a.top, a.left])).toEqual(before.ancestors.map((a) => [a.top, a.left]));
      expect.soft(wheeled.y).toBeCloseTo(before.y, 1);
      expect.soft([wheeled.windowX, wheeled.windowY]).toEqual([before.windowX, before.windowY]);
      // Reset only to let the existing defective baseline also exercise genuine touch input.
      await surface.evaluate((element) => { for (let node = element; node; node = node.parentElement) node.scrollTop = 0; });
      await frames(page);
      const touchedBefore = await controlGeometry(surface);
      const firstKey = data.keys.length;
      await touchGesture(page, surface, mode);
      const touched = await controlGeometry(surface);
      expect.soft(touched.ancestors.map((a) => [a.top, a.left])).toEqual(touchedBefore.ancestors.map((a) => [a.top, a.left]));
      expect.soft(touched.y).toBeCloseTo(touchedBefore.y, 1);
      await expect.poll(() => data.keys.slice(firstKey).some((key) => key.key === 'DPAD_UP')).toBe(true);
      expect(data.keys.slice(firstKey).every((key) => key.device_id === TV_A)).toBe(true);
    });
  }
}

test('mode dropdown preserves selection and pointer tap/hold controls still reach the TV', async ({ page }) => {
  const data = fixtures();
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  const picker = page.getByRole('combobox', { name: 'Control mode', exact: true });
  await expect(picker).toBeVisible();
  await picker.selectOption('touch');
  await destination(page, 'Apps').click();
  await destination(page, 'Controls').click();
  await expect(picker).toHaveValue('touch');
  const surface = page.locator('[data-remote-surface]').first();
  await touchGesture(page, surface, 'touch', true);
  await expect.poll(() => data.keys.filter((key) => key.key === 'DPAD_CENTER').length).toBe(1);
  await picker.selectOption('dpad');
  const up = page.getByRole('button', { name: 'Up', exact: true });
  const box = await up.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 25);
  await page.mouse.down();
  await expect.poll(() => data.keys.filter((key) => key.key === 'DPAD_UP').length).toBeGreaterThanOrEqual(2);
  await page.mouse.up();
  const stopped = data.keys.length;
  await page.waitForTimeout(300);
  expect(data.keys.length).toBe(stopped);
  await picker.selectOption('text');
  await expect(page.getByRole('textbox').first()).toBeVisible();
  await expect(picker).toHaveValue('text');
});

for (const selected of ['Apps', 'Guide']) {
  test(`${selected} content scrolls independently of the compact chrome and core keys`, async ({ page }) => {
    const data = fixtures();
    const resources = data.resources[TV_A];
    resources.catalog.items = Array.from({ length: 70 }, (_, i) => ({ ...resources.catalog.items[0], id: `app-${i}`, name: `Fixture app ${i}`, package: `org.example.app${i}` }));
    resources.guide.channels = Array.from({ length: 70 }, (_, i) => ({ ...resources.guide.channels[0], id: `channel-${i}`, name: `Fixture channel ${i}`, number: i + 1 }));
    await install(page, data);
    await page.goto(`/d/${TV_A}`);
    await destination(page, selected).click();
    const heading = page.getByRole('heading', { name: selected === 'Apps' ? 'Apps & services' : 'TV guide', exact: true });
    await expect(heading).toBeVisible();
    await expect(selected === 'Apps' ? page.getByRole('button', { name: 'Open Fixture app 0', exact: true })
      : page.getByText('Family programme', { exact: true }).first()).toBeVisible();
    if (selected === 'Apps') await page.getByRole('button', { name: /View more/i }).click();
    await frames(page);
    const fixed = [page.getByRole('banner'), page.getByRole('tablist', { name: 'Remote destination' }), page.getByRole('button', { name: 'Home', exact: true })];
    const before = await Promise.all(fixed.map((item) => item.boundingBox()));
    const scroller = await heading.evaluateHandle((element, selected) => {
      if (selected === 'Guide') {
        const timeline = element.closest('section')?.querySelector('[aria-label="Guide timeline"]');
        if (timeline && /auto|scroll/.test(getComputedStyle(timeline).overflowY) && timeline.scrollHeight > timeline.clientHeight + 1) return timeline;
      }
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
      }
      return null;
    }, selected);
    expect(await scroller.evaluate((element) => !!element)).toBe(true);
    const box = await scroller.evaluate((element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 550);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    const after = await Promise.all(fixed.map((item) => item.boundingBox()));
    // Chromium rounds spring-driven widths to 1/64 CSS pixel. Ignore subpixel
    // settling while still rejecting visible movement of the fixed remote chrome.
    for (let i = 0; i < before.length; i++) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        expect(Math.abs(after[i][dimension] - before[i][dimension]), `Fixed chrome ${i} ${dimension}`).toBeLessThanOrEqual(.25);
      }
    }
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
    await expectCoreKeysInViewport(page);
  });
}

test('generic and unpaired TVs keep compact navigation and an accessible repair action', async ({ page }) => {
  const data = fixtures();
  data.resources[TV_A].integration = integration(TV_A, false);
  data.devices[0].paired = false;
  data.devices[0].state.connection = 'unpaired';
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await expect(page.getByRole('combobox', { name: 'TV profile', exact: true })).toHaveCount(0);
  await expect(destination(page, 'Guide')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pair this television', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('combobox', { name: 'Control mode', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

/** Catalog fixture with deliberately unsorted usage, package duplication and custom artwork. */
function rankedCatalog(data) {
  const items = Array.from({ length: 9 }, (_, i) => ({
    id: `rank-${i}`, name: `Ranked app ${i}`, kind: 'app', package: `org.example.rank${i}`,
    icon_url: i === 8 ? '/api/icons/custom-artwork' : null, usage_count: i + 1,
    available: true, action: { type: 'launch', item_id: `rank-${i}` },
  }));
  items.push({ ...items[8], id: 'rank-service', name: 'Ranked service', kind: 'service', action: { type: 'launch', item_id: 'rank-service' } });
  data.resources[TV_A].catalog.items = items;
}

test('TV usage ranking produces six unique shortcuts and explicit View more/less', async ({ page }) => {
  const data = fixtures();
  rankedCatalog(data);
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Apps').click();
  const apps = page.getByRole('region', { name: 'Apps and services', exact: true });
  const tiles = apps.getByRole('button', { name: /^Open / });
  await expect(tiles).toHaveCount(6);
  expect(await tiles.allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('Ranked service')]));
  expect((await tiles.allTextContents()).map((s) => /Ranked (?:app \d|service)/.exec(s)?.[0])).toEqual([
    'Ranked service', 'Ranked app 7', 'Ranked app 6', 'Ranked app 5', 'Ranked app 4', 'Ranked app 3',
  ]);
  await expect(apps.getByRole('button', { name: 'Open Ranked app 8', exact: true })).toHaveCount(0);
  await expect(apps.getByRole('button', { name: 'Open Ranked service', exact: true }).locator('img')).toHaveAttribute('src', '/api/icons/custom-artwork');
  await apps.getByRole('button', { name: /View more/i }).click();
  await expect(tiles).toHaveCount(9);
  await apps.getByRole('button', { name: 'Open Ranked app 0', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_A, action: 'launch', item_id: 'rank-0', profile_id: 'family' });
  await apps.getByRole('button', { name: /View less/i }).click();
  await expect(tiles).toHaveCount(6);
});

test('older catalogs without usage remain honest and browsing resets for another TV', async ({ page }) => {
  const data = fixtures();
  rankedCatalog(data);
  data.resources[TV_A].catalog.items = data.resources[TV_A].catalog.items.slice(0, 9).map(({ usage_count, ...item }) => item);
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Apps').click();
  const apps = page.getByRole('region', { name: 'Apps and services', exact: true });
  await expect(apps.getByRole('button', { name: /^Open / })).toHaveCount(6);
  await expect(apps.getByText(/recent|frequent/i)).toHaveCount(0);
  await apps.getByRole('button', { name: /View more/i }).click();
  await expect(apps.getByRole('button', { name: /^Open / })).toHaveCount(9);
  await selectTv(page, 'Living Room TV', 'Bedroom TV');
  await destination(page, 'Apps').click();
  await expect(page.getByRole('button', { name: 'Open Bedroom player', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Open Ranked/ })).toHaveCount(0);
});

test('selected TV profile picture is visible and a broken image falls back to colored initials', async ({ page }) => {
  const data = fixtures();
  data.resources[TV_A].profiles.items[0] = { id: 'family', name: 'Family', color: '#b49bff', image_url: '/api/icons/family-avatar' };
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  const header = page.getByRole('banner');
  await expect(header.locator('img[src="/api/icons/family-avatar"]')).toBeVisible();
  const picker = page.getByRole('combobox', { name: 'TV profile', exact: true });
  await expect(picker).toHaveValue('family');
  await header.locator('img[src="/api/icons/family-avatar"]').evaluate((image) => image.dispatchEvent(new Event('error')));
  await expect(header.getByText('F', { exact: true })).toBeVisible();
  const color = await header.getByText('F', { exact: true }).evaluate((element) => {
    for (let node = element; node && node.tagName !== 'HEADER'; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (css.backgroundColor === 'rgb(180, 155, 255)' || css.color === 'rgb(180, 155, 255)') return true;
    }
    return false;
  });
  expect(color).toBe(true);
  await picker.selectOption('adult');
  await expect.poll(() => data.commands.some((c) => c.action === 'set_profile' && c.item_id === 'adult')).toBe(true);
});

/** Sample destination widths across real animation frames after one user selection. */
async function tabFrames(page, selected, count = 8) {
  return page.getByRole('tablist', { name: 'Remote destination' }).evaluate(async (nav, { selected, count }) => {
    const tabs = [...nav.querySelectorAll('[role="tab"]')];
    const widths = () => Object.fromEntries(tabs.map((tab) => [tab.getAttribute('aria-label'), tab.getBoundingClientRect().width]));
    const before = widths();
    tabs.find((tab) => tab.getAttribute('aria-label') === selected).click();
    const samples = [];
    for (let i = 0; i < count; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(widths());
    }
    return { before, samples };
  }, { selected, count });
}

test('destination labels collapse and expand together through intermediate spring frames', async ({ page }) => {
  const data = fixtures();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await expect(destination(page, 'Controls')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(400);
  const motion = await tabFrames(page, 'Guide');
  await expect(destination(page, 'Guide')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(650);
  const final = await destination(page, 'Guide').boundingBox();
  const oldFinal = await destination(page, 'Controls').boundingBox();
  expect(motion.samples.some((sample) => sample.Controls < motion.before.Controls - 2 && sample.Controls > oldFinal.width + 2
    && sample.Guide > motion.before.Guide + 2 && sample.Guide < final.width - 2), 'Old and new labels must both have intermediate widths in the same frame').toBe(true);
  for (const name of ['Controls', 'Apps', 'Guide', 'Playing']) {
    const box = await destination(page, name).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
  await page.getByRole('tablist', { name: 'Remote destination' }).evaluate(async (nav) => {
    for (const name of ['Apps', 'Playing', 'Controls', 'Guide']) {
      nav.querySelector(`[aria-label="${name}"]`).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }
  });
  await page.waitForTimeout(650);
  await expect(destination(page, 'Guide')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('reduced-motion tab changes settle immediately and remote commands do not wait for animation', async ({ page }) => {
  const data = fixtures();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await expect(destination(page, 'Guide')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const motion = await tabFrames(page, 'Guide', 3);
  await page.waitForTimeout(600);
  const final = await destination(page, 'Guide').boundingBox();
  console.log(JSON.stringify({ reducedMotion: true, motion, finalWidth: final.width }));
  // Allow React's commit and the browser's next layout pass; reduced motion must
  // already be final by the third painted frame, with no spring settling tail.
  expect(motion.samples[2].Guide).toBeCloseTo(final.width, 0);
  await page.getByRole('button', { name: 'Channel up', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_A, action: 'channel_step', direction: 'up', schedule_revision: 'guide-1' });
});

/** Give guide artwork, service branding, timezone and interval metadata independent of wall-clock minutes. */
function visualGuide(data) {
  const guide = data.resources[TV_A].guide;
  const now = Date.parse('2026-11-01T20:15:00Z');
  guide.server_time = new Date(now).toISOString();
  guide.timezone = 'America/Los_Angeles';
  const channel = guide.channels[0];
  Object.assign(channel, { package: PLAYER, icon_url: null, accent_color: '#b20710' });
  Object.assign(channel.programmes[0], { image_url: '/api/icons/programme-art', start: new Date(now - 15 * 60000).toISOString(), end: new Date(now + 45 * 60000).toISOString() });
  Object.assign(channel.programmes[1], { image_url: '/api/icons/future-art', start: new Date(now + 45 * 60000).toISOString(), end: new Date(now + 105 * 60000).toISOString() });
}

for (const width of [390, 1440]) {
  test(`artwork guide time grid contains horizontal pan and keeps service rail fixed at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const data = fixtures();
    visualGuide(data);
    await install(page, data);
    await page.goto(`/d/${TV_A}`);
    await destination(page, 'Guide').click();
    const timeline = page.getByLabel('Guide timeline', { exact: true });
    await expect(timeline).toBeVisible();
    await expect(timeline.getByLabel('Current time', { exact: true }).first()).toBeVisible();
    expect(await timeline.evaluate((element) => [...element.querySelectorAll('*')].some((node) => {
      const css = getComputedStyle(node);
      return css.position === 'sticky' && css.top !== 'auto';
    }))).toBe(true);
    const programme = page.getByRole('button').filter({ has: page.getByText('Family programme', { exact: true }) });
    await expect(programme).toBeInViewport({ ratio: .1 });
    await expect(programme.locator('img[src="/api/icons/programme-art"]')).toBeVisible();
    const programmeBounds = await programme.boundingBox();
    expect(programmeBounds.height).toBeLessThanOrEqual(100);
    expect(programmeBounds.height).toBeGreaterThanOrEqual(44);
    await expect(timeline.locator('img[src="/api/icons/org.example.player"]')).toBeVisible();
    await expect(timeline.getByText(/12:00/).first()).toBeVisible();
    const tune = page.getByRole('button', { name: 'Tune Family recommendations', exact: true });
    const tuneBounds = await tune.boundingBox();
    expect(tuneBounds.height).toBeGreaterThanOrEqual(44);
    expect(tuneBounds.width).toBeGreaterThanOrEqual(44);
    const service = timeline.getByText('Family recommendations', { exact: true });
    const before = await service.boundingBox();
    expect(await service.evaluate((element) => {
      for (let node = element; node; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (css.position === 'sticky' && css.left !== 'auto') return true;
      }
      return false;
    })).toBe(true);
    expect(await timeline.evaluate((element) => [...element.querySelectorAll('*')].some((node) => {
      const css = getComputedStyle(node);
      return css.borderColor.includes('178, 7, 16') || css.backgroundColor.includes('178, 7, 16') || css.color.includes('178, 7, 16') || css.getPropertyValue('--channel-accent').trim() === '#b20710';
    }))).toBe(true);
    await timeline.evaluate((element) => { element.scrollLeft = 180; });
    await frames(page);
    if (width === 390) expect(await timeline.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
    const after = await service.boundingBox();
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const fixed = page.getByRole('tablist', { name: 'Remote destination' });
    await expect(fixed).toBeInViewport({ ratio: 1 });
  });
}

test('artwork guide selection expands details without tuning and preserves explicit current-title actions', async ({ page }) => {
  const data = fixtures();
  visualGuide(data);
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Guide').click();
  await page.getByText('Family programme', { exact: true }).click();
  const details = page.getByRole('dialog');
  await expect(details).toBeVisible();
  await expect(details.locator('img[src="/api/icons/programme-art"]')).toBeVisible();
  expect(data.commands).toEqual([]);
  await expect(details.getByText(/12:00/)).toBeVisible();
  await details.getByRole('button', { name: 'Tune channel', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_A, action: 'tune', channel_id: `${TV_A}-channel`, schedule_revision: 'guide-1', profile_id: 'family' });
});

test('future programme details offer explicit Open/Resume without falsely tuning a scheduled title', async ({ page }) => {
  const data = fixtures();
  visualGuide(data);
  await install(page, data, async (route, url) => {
    if (!url.pathname.endsWith(`/titles/${TV_A}-future-title`)) return false;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      id: `${TV_A}-future-title`, title: 'A future title', subtitle: 'Episode details',
      description: 'A full synopsis for the selected programme.', image_url: '/api/icons/future-art',
      available: true, actions: ['open', 'resume'],
    }) });
    return true;
  });
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Guide').click();
  await page.getByText('Family next programme', { exact: true }).click();
  const details = page.getByRole('dialog');
  await expect(details.getByText('A full synopsis for the selected programme.', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Tune channel', exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Resume on TV', exact: true })).toBeEnabled();
  expect(data.commands).toEqual([]);
  await details.getByRole('button', { name: 'Open on TV', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ device_id: TV_A, action: 'open', item_id: `${TV_A}-future-title`, profile_id: 'family' });
});

test('an unavailable current programme cannot tune its channel from the grid or details', async ({ page }) => {
  const data = fixtures();
  visualGuide(data);
  data.resources[TV_A].guide.channels[0].programmes[0].available = false;
  await install(page, data);
  await page.goto(`/d/${TV_A}`);
  await destination(page, 'Guide').click();
  await expect(page.getByRole('button', { name: 'Tune Family recommendations', exact: true })).toBeDisabled();
  await page.getByText('Family programme', { exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Tune channel', exact: true })).toBeDisabled();
  expect(data.commands).toEqual([]);
});
