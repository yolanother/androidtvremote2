/*
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * Local browser acceptance-test configuration for Android TV Remote provider UI.
 * Runs the actual Vite application against test-owned REST/WebSocket fixtures;
 * no appliance or television is contacted. Supports an existing dev-server URL
 * and an optional cached Chromium executable for offline verification.
 */
const { defineConfig } = require('@playwright/test');
const path = require('node:path');

const baseURL = process.env.ATVR_TEST_BASE_URL || 'http://127.0.0.1:18434';
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.cjs',
  timeout: 15000,
  expect: { timeout: 3000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: process.env.ATVR_TEST_OUTPUT || '/tmp/atvr-provider-browser-results',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    actionTimeout: 3000,
    navigationTimeout: 5000,
    serviceWorkers: 'block',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: process.env.ATVR_TEST_BASE_URL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 18434 --strictPort',
    cwd: path.resolve(__dirname, '..'),
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
