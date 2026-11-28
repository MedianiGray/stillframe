/**
 * 用 CDP 直接给桌面壳的每个模块拍界面实况。
 *
 * 为什么单独有这一支：物理屏截图只能拍到显示器上的内容（锁屏/远程断开时就是一块纯色），
 * 但 WebView 里的界面一直在渲染。CDP 的 page.screenshot 拿到的是窗口自己画的内容，
 * 不受显示器状态影响，所以「某个面板到底长什么样」这件事随时可以留证据。
 *
 * 进入覆盖层的入口只有一个：待机页的「开始捕捉」（左侧导航只是切模式，点了不会开拍）。
 * 每一轮拍完用 reload 复位，比去猜编辑器/面板上的退出按钮更稳。
 *
 * 前置：
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
 *   Start-Process I:\Cache\cargo-target\debug\stillframe-desktop.exe
 * 运行：
 *   node tools\shell-shots.mjs --out=<目录> [--only=snap|ocr|record|set|quick|pin]
 */
import { chromium } from 'playwright';
import { mkdirSync, appendFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = 'http://127.0.0.1:9223';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const OUT = arg('out', 'I:\\Temp\\sf-shots');
const ONLY = arg('only', '');
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, '_shots.log');
try {
  if (!ONLY) unlinkSync(LOG);
} catch {}
const say = (s) => {
  appendFileSync(LOG, `${s}\n`);
  console.log(s);
};

const browser = await chromium.connectOverCDP(ENDPOINT);
const ctx = browser.contexts()[0];
const main = ctx.pages().find((p) => p.url().includes('tauri.localhost') && !/quick|pin/.test(p.url()));
if (!main) throw new Error('没有主窗 target');
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  say(`SHOT ${name}`);
};
const reset = async () => {
  await main.reload();
  await main.waitForTimeout(1600);
};
/** 待机页 → 切模式（用底部卡片文字，比左侧图标稳）→ 开始捕捉 → 返回视口尺寸 */
const enter = async (card, name, waitMs = 2600) => {
  await reset();
  if (card) {
    await main.getByText(card, { exact: true }).first().click({ timeout: 5000 });
    await main.waitForTimeout(900);
  }
  await main.getByRole('button', { name: /开始捕捉/ }).first().click({ timeout: 6000 });
  await main.waitForTimeout(waitMs);
  const vp = await main.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  say(`${name} overlay ${vp.w}x${vp.h}`);
  return vp;
};
const select = async (vp, from = [0.18, 0.2], to = [0.82, 0.78]) => {
  await main.mouse.move(vp.w * from[0], vp.h * from[1]);
  await main.mouse.down();
  await main.mouse.move(vp.w * to[0], vp.h * to[1], { steps: 10 });
  await main.mouse.up();
  await main.waitForTimeout(400);
};
const dbl = async (vp) => {
  await main.mouse.dblclick(vp.w * 0.5, vp.h * 0.45);
  await main.waitForTimeout(2800);
};

const want = (key) => !ONLY || ONLY === key;

if (want('snap')) await shot(main, '01-主界面-截图模式');

if (want('snap')) {
  const vp = await enter(null, '截图');
  await shot(main, '02-覆盖层-冻结画面');
  await select(vp);
  await shot(main, '03-框选读数');
  await dbl(vp);
  await shot(main, '04-标注台');
  const body = (await main.evaluate(() => document.body.innerText.slice(0, 120))).replace(/\n/g, ' | ');
  say(`标注台判定：${body}`);
}

if (want('set')) {
  await reset();
  await main.getByRole('button', { name: /^设置|设置$/ }).first().click();
  await main.waitForTimeout(1500);
  await shot(main, '05-设置-含显示器小节');
}

if (want('ocr')) {
  const vp = await enter('提取文字', '取字');
  await select(vp, [0.2, 0.3], [0.8, 0.62]);
  await shot(main, '06a-取字-框选');
  await dbl(vp);
  await main.waitForTimeout(9000);
  await shot(main, '06-取字-识别结果');
  const body = (await main.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\n/g, ' | ');
  say(`取字判定：${body}`);
}

if (want('record')) {
  const vp = await enter('区域录屏', '录屏');
  await select(vp, [0.2, 0.22], [0.8, 0.72]);
  await dbl(vp);
  await shot(main, '07-录屏面板');
  const body = (await main.evaluate(() => document.body.innerText.slice(0, 160))).replace(/\n/g, ' | ');
  say(`录屏判定：${body}`);
}

if (want('quick')) {
  await reset();
  await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('open_quick').catch(() => {}));
  for (let i = 0; i < 12; i += 1) {
    await main.waitForTimeout(1500);
    const hit = ctx.pages().find((p) => p.url().includes('quick.html'));
    if (hit) {
      await hit.waitForTimeout(700);
      await shot(hit, '08-快捷浮窗');
      break;
    }
    if (i === 11) say('quick page 没挂上');
  }
  await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('close_quick').catch(() => {}));
}

if (want('pin')) {
  await reset();
  await main.evaluate(async () => {
    const url = await window.__TAURI_INTERNALS__.invoke('capture_screen', { display: null });
    await window.__TAURI_INTERNALS__.invoke('pin_image', { dataUrl: url }).catch(() => {});
  });
  await main.waitForTimeout(3500);
  const pinPage = ctx.pages().find((p) => p.url().includes('pin.html'));
  say(`pin page=${Boolean(pinPage)}`);
  if (pinPage) {
    await pinPage.waitForTimeout(600);
    await shot(pinPage, '09-贴图窗口');
  }
}

say('done');
process.exit(0);
