import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// 用基准里那张中文版面当输入：和 OCR 基准同一份图，出问题时两边能对上
const SAMPLE = fileURLToPath(new URL('../tools/ocr-bench/pages/page1-zh.png', import.meta.url));

/** 从待机页打开一张本地图片，进入对应面板。 */
async function openSample(page: import('@playwright/test').Page, mode: string, heading: string) {
  await page.getByRole('button', { name: mode, exact: true }).click();
  // 切模式会重挂载待机页，等新的一屏稳定下来再投喂文件，否则 input 可能已 detach
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  const input = page.getByTestId('open-image-input');
  await input.waitFor({ state: 'attached' });
  await input.setInputFiles(SAMPLE);
}

test('截图链路：打开图片 → 标注 → 保存 → 图库留档', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openSample(page, '截图', '捕捉台 · 截图');

  // 标注台的保存按钮，title 与 QQ 一致
  const saveButton = page.locator('button[title="保存 Ctrl+S"]');
  await expect(saveButton).toBeVisible({ timeout: 20_000 });

  // 在图上拖一个矩形，工具栏的计数应当从 0 变成 1 才有东西可存
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
  }

  // 网页端没授权目录时走下载：等到 download 事件说明真的把成品交出来了
  const downloading = page.waitForEvent('download', { timeout: 30_000 });
  await saveButton.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.(png|jpg)$/);

  // 保存顺带入图库，回图库应当看到这张
  await page.getByRole('button', { name: '图库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '图库', level: 1 })).toBeVisible();
  await expect(page.getByText('本机存下的捕捉记录')).toBeVisible();
});

test('取字链路：打开图片后本地识别出中文', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openSample(page, '取字', '捕捉台 · 取字');

  // 取字面板进来自动跑一次识别；离线语言包随站点分发，不需要外网
  const output = page.locator('textarea').first();
  await expect(output).toBeVisible({ timeout: 20_000 });
  await expect(output).toHaveValue(/校园网络维护记录|实训室/, { timeout: 75_000 });
});

test('贴图链路：标注台把成图钉到桌面上', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openSample(page, '截图', '捕捉台 · 截图');

  // 先等编辑台真的把图画出来了，否则点钉图时 canvas 还是空的
  await expect(page.locator('button[title="保存 Ctrl+S"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('canvas').first()).toBeVisible();

  await page.locator('button[title="钉在桌面上"]').click();

  // 贴图浮层自带缩放百分比，出现即说明成图被钉住了
  await expect(page.getByTestId('pin-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('pin-card')).toContainText('100%');
});
