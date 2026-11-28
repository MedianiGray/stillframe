/**
 * 桌面壳前端验收：通过 WebView2 的 CDP 端点接管真实窗口，检查渲染与关键交互。
 *
 * 用法：
 *   1) 启动壳时带调试端口：
 *      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
 *      Start-Process I:\Cache\cargo-target\debug\stillframe-desktop.exe
 *   2) node tools/shell-probe.mjs                   只读检查（页面标题、TAURI 桥、首屏文案）
 *      node tools/shell-probe.mjs --flow=snap       区域截图：全屏→抓帧→拖框→双击→标注台
 *      node tools/shell-probe.mjs --flow=full       整屏截图→标注台
 *      node tools/shell-probe.mjs --flow=ocr        取字：整屏→离线 OCR 出中文（最多等 90 秒）
 *      node tools/shell-probe.mjs --flow=settings   设置页（含显示器清单）
 *      node tools/shell-probe.mjs --flow=quick      快捷浮窗按钮 → quick 窗口真的建起来
 *      node tools/shell-probe.mjs --flow=record     录屏：框选→录 4 秒→停止→出成片
 *      node tools/shell-probe.mjs --flow=pin        标注台钉图 → 桌面贴图窗口
 *
 * 为什么走 CDP：桌面壳里的界面在 WebView2 里跑，Playwright 的浏览器实例够不着它；
 * 开个调试端口就能用同一套选择器做真机点击，比肉眼点更可复现。
 */
import { chromium } from 'playwright';

const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223';
const flow = process.argv.find((arg) => arg.startsWith('--flow='))?.slice('--flow='.length);

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context.pages()[0];
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));
await page.waitForTimeout(1200);

const snap = async (label, target = page, limit = 240) => {
  const info = {
    headings: await target.locator('h1, h2').allInnerTexts(),
    imgs: await target.evaluate(() =>
      [...document.querySelectorAll('img')]
        .map((img) => `${img.naturalWidth}x${img.naturalHeight}`)
        .slice(0, 6),
    ),
    size: await target.evaluate(() => [window.innerWidth, window.innerHeight, devicePixelRatio]),
    body: (await target.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, limit),
  };
  console.log(label, JSON.stringify(info));
};

/** 回到待机首页：切回截图模式，再按 Esc 退掉残留的选区层 / 结果面板。 */
const goHome = async () => {
  if (!(await page.getByRole('button', { name: '开始捕捉' }).count())) {
    await page.getByRole('button', { name: '截图', exact: true }).click();
    await page.waitForTimeout(800);
  }
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByRole('button', { name: '开始捕捉' }).count()) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
};

/** 进全屏引用层，等抓帧完成；超时只记录现状，不打断后续诊断。 */
const openOverlay = async () => {
  await page.getByRole('button', { name: '开始捕捉' }).first().click();
  await page.waitForTimeout(1500);
  const settled = await page
    .waitForFunction(() => !document.body.innerText.includes('正在请求屏幕授权'), null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!settled) console.log('OVERLAY_TIMEOUT', JSON.stringify((await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)));
};

const dragBox = async (x0, y0, x1, y1) => {
  const vw = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  const a = { x: vw[0] * x0, y: vw[1] * y0 };
  const b = { x: vw[0] * x1, y: vw[1] * y1 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + 20, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(600);
};

await goHome();
await snap('BASE');
console.log('TAURI_INVOKE', await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__?.invoke)));

if (flow === 'snap' || flow === 'full' || flow === 'ocr' || flow === 'record' || flow === 'pin' || flow === 'scroll') {
  if (flow === 'ocr') {
    await page.getByRole('button', { name: '取字', exact: true }).click();
    await page.waitForTimeout(800);
  }
  if (flow === 'record') {
    await page.getByRole('button', { name: '录屏', exact: true }).click();
    await page.waitForTimeout(800);
  }
  if (flow === 'pin' || flow === 'snap') {
    await page.getByRole('button', { name: '截图', exact: true }).click();
    await page.waitForTimeout(800);
  }
  if (flow === 'scroll') {
    await page.getByRole('button', { name: '长图', exact: true }).click();
    await page.waitForTimeout(800);
  }
  await goHome();
  await openOverlay();
  await snap('OVERLAY');

  if (flow === 'snap' || flow === 'pin') {
    await dragBox(0.15, 0.18, 0.65, 0.64);
    await snap('SELECTED');
    await page.mouse.dblclick(
      (await page.evaluate(() => window.innerWidth)) * 0.4,
      (await page.evaluate(() => window.innerHeight)) * 0.4,
    );
    await page.waitForTimeout(2000);
    await snap('EDITOR');

    if (flow === 'pin') {
      await page.locator('button[title="钉在桌面上"]').click();
      await page.waitForTimeout(2000);
      const pages = context.pages().map((p) => p.url());
      console.log('TARGETS', JSON.stringify(pages));
    }
  } else if (flow === 'record') {
    await dragBox(0.2, 0.22, 0.8, 0.72);
    await snap('REC_SELECTED');
    // 录屏和截图一样，先在选区层双击收口，之后才出「开始录制」工具条。
    await page.mouse.dblclick(
      (await page.evaluate(() => window.innerWidth)) * 0.45,
      (await page.evaluate(() => window.innerHeight)) * 0.45,
    );
    await page.waitForTimeout(2200);
    await snap('REC_PANEL');
    await page.getByRole('button', { name: /开始录制/ }).first().click();
    await page.waitForTimeout(4200);
    await snap('RECORDING', page, 200);
    // 停止按钮的文案是「结束录制」不是「停止」，别按 /停止/ 去找。
    await page.getByRole('button', { name: /结束录制|停止录制/ }).first().click();
    await page.waitForTimeout(2500);
    await snap('REC_STOPPED', page, 260);
  } else if (flow === 'scroll') {
    await dragBox(0.2, 0.2, 0.7, 0.7);
    await snap('SCROLL_SELECTED');
    await page.getByRole('button', { name: /开始拼接|开始滚动/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(2500);
    await snap('SCROLLING', page, 220);
  } else {
    await page.getByRole('button', { name: '整屏' }).first().click();
    await page.waitForTimeout(2200);
    await snap('FULL');
    if (flow === 'ocr') {
      await page
        .waitForFunction(
          () => {
            const area = document.querySelector('textarea');
            const badge = document.body.innerText;
            const chars = badge.match(/识别结果\s*(\d+)\s*字符/);
            return (area && area.value.length > 30) || (chars && Number(chars[1]) > 30);
          },
          null,
          { timeout: 90000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(1500);
      const text = page.locator('textarea').first();
      if (await text.count()) console.log('OCR_TEXT', JSON.stringify((await text.inputValue()).slice(0, 160)));
      await snap('OCR_DONE', page, 300);
    }
  }
}

if (flow === 'settings') {
  await page.getByRole('button', { name: '设置' }).first().click();
  await page.waitForTimeout(1500);
  await snap('SETTINGS', page, 700);
  console.log('HAS_DISPLAY_SECTION', await page.evaluate(() => document.body.innerText.includes('显示器')));
}

if (flow === 'quick') {
  await page.getByRole('button', { name: '快捷浮窗' }).first().click();
  // 新窗口要先建 WebView 再导航，2 秒时还停在过渡页；给足 6 秒再查。
  await page.waitForTimeout(6000);
  const targets = context.pages();
  console.log('TARGETS', JSON.stringify(targets.map((p) => p.url())));
  const quick = targets.find((p) => p.url().includes('quick.html'));
  if (quick) {
    await snap('QUICK', quick, 200);
    console.log('QUICK_BUTTONS', JSON.stringify((await quick.getByRole('button').allInnerTexts()).slice(0, 12)));
    await quick.evaluate(() => window.__TAURI_INTERNALS__?.invoke('close_quick')).catch(() => undefined);
  } else {
    console.log('QUICK_MISSING');
  }
}

if (errors.length) console.log('ERRORS', JSON.stringify(errors.slice(0, 6)));
await browser.close();
