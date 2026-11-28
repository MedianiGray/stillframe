import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // 先开一次浏览器把首页渲染完：这台机器冷启 Chromium 再冷读前端包能把第一条卡满超时
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  // 低配机器上解码大图 + 首帧渲染能到十几秒，给足余量，免得偶发红灯
  expect: { timeout: 25_000 },
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
