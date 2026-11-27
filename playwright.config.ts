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
    // Windows 上 npm 起 vite preview 偶发要等一分多钟，给足余量免得整轮测试白跑
    timeout: 180_000,
  },
});
