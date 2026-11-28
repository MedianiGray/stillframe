'use strict';

const DEFAULT_EDITOR = 'https://medianigray.github.io/stillframe/';
const MAX_COPY_BYTES = 40 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const el = {
  hint: $('hint'),
  stage: $('stage'),
  placeholder: $('placeholder'),
  canvasWrap: $('canvasWrap'),
  canvas: $('canvas'),
  sel: $('sel'),
  capture: $('capture'),
  copy: $('copy'),
  download: $('download'),
  open: $('open'),
  reset: $('reset'),
  editorUrl: $('editorUrl'),
  size: $('size'),
  tip: $('tip'),
};

const state = {
  bitmap: null,
  /** 选区，单位是原图像素；null 表示整张 */
  rect: null,
  drag: null,
};

function hint(text, tone) {
  el.hint.textContent = text;
  el.hint.style.color = tone === 'warn' ? '#b45309' : tone === 'error' ? '#b91c1c' : '';
}

function setReady(ready) {
  for (const b of [el.copy, el.download, el.open]) b.disabled = !ready;
}

function currentCanvas() {
  const c = document.createElement('canvas');
  const r = state.rect;
  if (!r || !state.bitmap) {
    c.width = state.bitmap ? state.bitmap.width : 0;
    c.height = state.bitmap ? state.bitmap.height : 0;
  } else {
    c.width = Math.max(1, Math.round(r.w));
    c.height = Math.max(1, Math.round(r.h));
  }
  c.getContext('2d').drawImage(
    state.bitmap,
    state.rect ? state.rect.x : 0,
    state.rect ? state.rect.y : 0,
    c.width,
    c.height,
    0, 0, c.width, c.height,
  );
  return c;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('编码失败'))), 'image/png');
  });
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function draw() {
  const bmp = state.bitmap;
  el.canvas.width = bmp.width;
  el.canvas.height = bmp.height;
  el.canvas.getContext('2d').drawImage(bmp, 0, 0);
  el.placeholder.hidden = true;
  el.canvasWrap.hidden = false;
  el.stage.classList.remove('empty');
}

function updateSelBox() {
  const r = state.rect;
  if (!r || !r.w || !r.h) {
    el.sel.hidden = true;
    el.reset.disabled = true;
    el.size.textContent = `${state.bitmap.width}×${state.bitmap.height}`;
    return;
  }
  const scale = el.canvas.clientWidth / el.canvas.width;
  el.sel.hidden = false;
  el.sel.style.left = `${r.x * scale}px`;
  el.sel.style.top = `${r.y * scale}px`;
  el.sel.style.width = `${r.w * scale}px`;
  el.sel.style.height = `${r.h * scale}px`;
  el.reset.disabled = false;
  el.size.textContent = `选区 ${Math.round(r.w)}×${Math.round(r.h)}`;
}

async function capture() {
  el.capture.disabled = true;
  hint('正在截取…');
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    state.bitmap?.close?.();
    state.bitmap = bmp;
    state.rect = null;
    state.drag = null;
    draw();
    updateSelBox();
    setReady(true);
    hint('已截取，可直接复制 / 下载，或在图上拖框裁剪');
  } catch (err) {
    hint(`截取失败：${err?.message || err}（内部页面、阅读模式或受保护页面不给截）`, 'error');
    setReady(false);
  } finally {
    el.capture.disabled = false;
  }
}

function pointToImage(ev) {
  const rect = el.canvas.getBoundingClientRect();
  const scale = el.canvas.width / rect.width;
  return {
    x: Math.min(Math.max((ev.clientX - rect.left) * scale, 0), el.canvas.width),
    y: Math.min(Math.max((ev.clientY - rect.top) * scale, 0), el.canvas.height),
  };
}

el.canvasWrap.addEventListener('pointerdown', (ev) => {
  if (!state.bitmap || ev.button !== 0) return;
  const p = pointToImage(ev);
  state.drag = { x0: p.x, y0: p.y };
  el.canvasWrap.setPointerCapture(ev.pointerId);
});

el.canvasWrap.addEventListener('pointermove', (ev) => {
  if (!state.drag) return;
  const p = pointToImage(ev);
  state.rect = {
    x: Math.min(state.drag.x0, p.x),
    y: Math.min(state.drag.y0, p.y),
    w: Math.abs(p.x - state.drag.x0),
    h: Math.abs(p.y - state.drag.y0),
  };
  updateSelBox();
});

el.canvasWrap.addEventListener('pointerup', (ev) => {
  if (!state.drag) return;
  state.drag = null;
  el.canvasWrap.releasePointerCapture?.(ev.pointerId);
  // 小于 8px 的拖动当作误触，回到整张
  if (state.rect && (state.rect.w < 8 || state.rect.h < 8)) state.rect = null;
  updateSelBox();
});

el.reset.addEventListener('click', () => {
  state.rect = null;
  updateSelBox();
});

el.capture.addEventListener('click', capture);

el.copy.addEventListener('click', async () => {
  try {
    const blob = await canvasBlob(currentCanvas());
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    hint('已复制到剪贴板');
  } catch (err) {
    hint(`复制失败：${err?.message || err}，可以改用「存 PNG」`, 'warn');
  }
});

el.download.addEventListener('click', async () => {
  try {
    const blob = await canvasBlob(currentCanvas());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stillframe-${stamp()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    hint('已交给浏览器下载');
  } catch (err) {
    hint(`保存失败：${err?.message || err}`, 'error');
  }
});

el.open.addEventListener('click', async () => {
  const editor = (el.editorUrl.value || '').trim() || DEFAULT_EDITOR;
  let copied = false;
  try {
    const blob = await canvasBlob(currentCanvas());
    if (blob.size <= MAX_COPY_BYTES) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copied = true;
    }
  } catch {
    copied = false;
  }
  await chrome.storage.local.set({ editorUrl: editor });
  await chrome.tabs.create({ url: editor });
  hint(
    copied
      ? '已打开编辑台：在页面里按 Ctrl+V 就能把这张图接进来'
      : '已打开编辑台，但剪贴板没写成功，请用「存 PNG」再在编辑台「打开图片」选它',
    copied ? '' : 'warn',
  );
});

chrome.storage.local.get({ editorUrl: DEFAULT_EDITOR }).then((v) => {
  el.editorUrl.value = v.editorUrl;
});

el.editorUrl.addEventListener('change', () => {
  const v = el.editorUrl.value.trim() || DEFAULT_EDITOR;
  el.editorUrl.value = v;
  chrome.storage.local.set({ editorUrl: v });
});

// 打开即截：少点一次，符合截图工具的手感
setReady(false);
capture();
