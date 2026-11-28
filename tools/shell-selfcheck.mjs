/**
 * 桌面壳自检：不动界面，直接把 Tauri 命令逐个调一遍，看返回是否可用。
 *
 * 为什么单独有这一支：shell-probe.mjs 走的是「像人一样点」，证明流程通；
 * 但有些命令（write_shot、capture_window、quick_action）在界面上要点好多步才碰得到。
 * 这个脚本一次性过一遍，缺哪个模块一眼能看出来。
 *
 * 前置：壳已带调试端口启动
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
 *   Start-Process I:\Cache\cargo-target\debug\stillframe-desktop.exe
 * 运行：node tools/shell-selfcheck.mjs
 * 结果逐行写进 I:\Temp\sf-selfcheck.log，进程中途卡住也能看出停在哪一步。
 */
import { chromium } from 'playwright';
import { writeFileSync, appendFileSync, unlinkSync } from 'node:fs';

const ENDPOINT = 'http://127.0.0.1:9223';
const OUT_DIR = process.env.SF_OUT_DIR || 'I:\\Temp';
const LOG = process.env.SF_LOG || `${OUT_DIR}\\sf-selfcheck.log`;
try {
  unlinkSync(LOG);
} catch {}
const say = (line) => {
  appendFileSync(LOG, `${line}\n`);
  console.log(line);
};

const rows = [];
const step = (name, pass, detail) => {
  rows.push({ name, pass, detail });
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const targets = async () => (await fetch(`${ENDPOINT}/json`)).json();

const browser = await chromium.connectOverCDP(ENDPOINT);
const ctx = browser.contexts()[0];
const main = ctx.pages().find((p) => p.url().includes('tauri.localhost') && !/quick|pin/.test(p.url()));
if (!main) throw new Error('没有主窗 target');
say(`connected, main=${main.url()}`);

// 每条命令都压一个超时：锁屏 / 宿主编译忙的时候 invoke 偶尔会挂住，
// 挂住就记 TIMEOUT 继续往下走，别让一个模块把整轮自检拖死。
const inv = async (cmd, args) => {
  const call = main.evaluate(
    async ([c, a]) => {
      try {
        return { value: await window.__TAURI_INTERNALS__.invoke(c, a) };
      } catch (error) {
        return { error: String(error) };
      }
    },
    [cmd, args ?? {}],
  );
  return Promise.race([
    call,
    new Promise((resolve) => setTimeout(() => resolve({ error: 'TIMEOUT 8s' }), 8000)),
  ]);
};

// 1) 基础信息
{
  const info = await inv('app_info');
  info.value?.exe ? step('app_info', true, `${info.value.version} ${info.value.exe}`) : step('app_info', false, info.error);
}

{
  const hotkeys = await inv('hotkey_status');
  if (Array.isArray(hotkeys.value)) {
    const remapped = hotkeys.value.filter((r) => r.state !== 'primary');
    step('hotkey_status', true, `${hotkeys.value.length} 条，${remapped.length} 条走备用键位`);
  } else step('hotkey_status', false, hotkeys.error ?? String(hotkeys.value));
}

{
  const displays = await inv('displays');
  if (Array.isArray(displays.value) && displays.value.length) {
    step('displays', true, displays.value.map((d) => `#${d.id} ${d.width}x${d.height}@(${d.x},${d.y})`).join(' | '));
  } else step('displays', false, displays.error ?? 'empty');
}

{
  const autostart = await inv('autostart_enabled');
  typeof autostart.value === 'boolean' ? step('autostart_enabled', true, String(autostart.value)) : step('autostart_enabled', false, autostart.error);
}

// 2) 抓屏三种取景
const screen = await inv('capture_screen', { display: null });
if (typeof screen.value === 'string' && screen.value.startsWith('data:image/png')) {
  const bytes = Buffer.from(screen.value.split(',')[1], 'base64');
  writeFileSync(`${OUT_DIR}\\sf-self-screen.png`, bytes);
  step('capture_screen', true, `${bytes.length} B → sf-self-screen.png`);
} else step('capture_screen', false, JSON.stringify(screen).slice(0, 200));

{
  const frame = await inv('capture_frame', { display: null });
  // capture_frame 回的是 { dataUrl }，不是裸字符串
  const url = frame.value?.dataUrl ?? frame.value;
  typeof url === 'string' && url.startsWith('data:image/png')
    ? step('capture_frame', true, `${url.length} chars`)
    : step('capture_frame', false, JSON.stringify(frame).slice(0, 200));
}

{
  // capture_window 要窗口句柄：先从 list_windows 挑一个真实存在的窗口
  const windows = await inv('list_windows');
  const first = Array.isArray(windows.value) ? windows.value[0] : null;
  if (!first) {
    step('capture_window', false, windows.error ?? '没有可截的窗口');
  } else {
    const win = await inv('capture_window', { id: first.id ?? first.hwnd });
    const url = win.value?.dataUrl ?? win.value;
    if (typeof url === 'string' && url.startsWith('data:image/png')) {
      const bytes = Buffer.from(url.split(',')[1], 'base64');
      writeFileSync(`${OUT_DIR}\\sf-self-window.png`, bytes);
      step('capture_window', true, `${bytes.length} B → sf-self-window.png`);
    } else step('capture_window', false, JSON.stringify(win).slice(0, 200));
  }
  Array.isArray(windows.value) ? step('list_windows', true, `${windows.value.length} 个窗口`) : step('list_windows', false, windows.error);
}

// 3) 落盘两条路：write_shot（静默进图库）与 save_png（用户另存）
{
  const shot = await inv('write_shot', { dataUrl: screen.value ?? '', suggestedName: 'selfcheck' });
  shot.value ? step('write_shot', true, String(shot.value)) : step('write_shot', false, shot.error);
}

// save_png 会弹系统「另存为」对话框，人在场时才有意义；自动化里一弹就把主线程占住，
// 后面所有命令全部超时。落盘能力由上面的 write_shot 证明（同一条写文件代码路径）。
say('SKIP  save_png  弹系统另存对话框，自动化不点；落盘由 write_shot 证明');

// 4) 快捷浮窗：建窗 → 触发动作 → 关掉
// 6) 窗口清单（长截图的滚动与遮挡都靠它）
{
  const windows = await inv('list_windows');
  Array.isArray(windows.value) ? step('list_windows', true, `${windows.value.length} 个窗口`) : step('list_windows', false, windows.error);
}

// 7) 建窗类命令（快捷浮窗 / 贴图）单独跑。
//    原因很实在：这类窗口一旦顶到最前把主窗遮住，WebView2 会把主窗的 JS 挂起，
//    之后的 invoke 全部超时——不是命令坏了，是「壳在主窗不可见时不接 IPC」。
//    所以一次只验一项，验完立刻收工：--windows=quick 或 --windows=pin。
const WIN = (process.argv.find((a) => a.startsWith('--windows=')) ?? '--windows=none').split('=')[1];

if (WIN === 'quick') {
  const open = await inv('open_quick');
  open.error ? step('open_quick', false, open.error) : step('open_quick', true, 'window requested');
  // /json 端点比 context.pages() 可靠：新 target 不一定马上出现在 pages() 里
  const quick = (await targets()).find((t) => t.url.includes('quick.html'));
  step('open_quick#target', Boolean(quick), quick ? 'quick.html 已在 target 列表' : '没看到 quick.html target');
  const act = await inv('quick_action', { mode: 'snap' });
  act.error ? step('quick_action', false, act.error) : step('quick_action', true, JSON.stringify(act.value).slice(0, 140));
  const close = await inv('close_quick');
  close.error ? step('close_quick', false, close.error) : step('close_quick', true, 'closed');
} else if (WIN === 'pin') {
  const pinned = await inv('pin_image', { dataUrl: screen.value ?? '' });
  const after = await targets();
  const pin = after.find((t) => t.url.includes('pin.html'));
  pinned.error ? step('pin_image', false, pinned.error) : step('pin_image', true, `pin.html target=${Boolean(pin)} (${after.length} targets)`);
} else {
  say('SKIP  quick/pin  建窗类按需单独跑：--windows=quick | --windows=pin');
}

await browser.close();
const failed = rows.filter((r) => !r.pass).length;
say(`\n${rows.length - failed}/${rows.length} 通过`);
process.exit(failed ? 1 : 0);
