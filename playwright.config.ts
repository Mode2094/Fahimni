import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './qa/browser',
  globalSetup:'./qa/browser/global-setup.ts',
  fullyParallel: true,
  workers: 3,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/recovery-browser.json' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3010',
    headless: true,
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
});
