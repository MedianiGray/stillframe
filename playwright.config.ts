import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:24118',
    trace: 'retain-on-failure',
    navigationTimeout: 60_000,
  },
  webServer: {
    command: 'npm run preview -- --port 24118 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:24118',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
