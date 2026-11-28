import { chromium } from '@playwright/test';

/**
 * 预热：第一条用例常常卡在 90 秒超时，不是代码问题，是这台机器冷启 Chromium
 * 加磁盘冷读 300KB 前端包一起挤（I 盘 + 内存紧）。先开一次浏览器把页面渲染完，
 * 系统缓存热起来后再跑正式用例。
 */
export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto('http://127.0.0.1:24118/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByRole('heading', { name: '捕捉台 · 截图' }).waitFor({ timeout: 120_000 });
  } finally {
    await browser.close();
  }
}
