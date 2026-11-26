import { expect, test } from '@playwright/test';

test('首页加载捕捉台，五种模式都能切换', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '捕捉台 · 截图' })).toBeVisible();
  await expect(page.getByText('框选、标注、导出一步到位')).toBeVisible();

  const modes: Array<[string, string]> = [
    ['长图', '捕捉台 · 长图'],
    ['录屏', '捕捉台 · 录屏'],
    ['取字', '捕捉台 · 取字'],
    ['译屏', '捕捉台 · 译屏'],
    ['截图', '捕捉台 · 截图'],
  ];

  for (const [label, title] of modes) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
});

test('图库与设置可以打开并返回', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: '图库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '图库', level: 1 })).toBeVisible();
  await expect(page.getByText('本机存下的捕捉记录')).toBeVisible();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
  await expect(page.getByText('识别、翻译与导出')).toBeVisible();

  await page.getByRole('button', { name: '截图', exact: true }).click();
  await expect(page.getByRole('heading', { name: '捕捉台 · 截图' })).toBeVisible();
});
