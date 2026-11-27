import { createWorker } from 'tesseract.js';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { fallbackParagraphs, groupParagraphs, type OcrLineBox } from './paragraphs';
import { cropToBand, detectColumns, type Band } from './columns';

// 聚段规则搬到了 `paragraphs.ts`（纯函数，量化脚本要单独加载），
// 这里原名转出，调用方与测试都不用改导入路径。
export { groupParagraphs } from './paragraphs';

/**
 * 在缩略图上找栏：整图取像素太重（2000×1500 就是 12MB），先缩到 900 宽再数墨。
 * 栏的位置是按比例的，缩图上的切口能原样换算回原图坐标。
 */
function detectColumnsFromCanvas(canvas: HTMLCanvasElement): Band[] {
  const whole: Band[] = [{ x0: 0, x1: canvas.width }];
  const scale = canvas.width > 900 ? 900 / canvas.width : 1;
  const probe = document.createElement('canvas');
  probe.width = Math.max(1, Math.round(canvas.width * scale));
  probe.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return whole;
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  const bands = detectColumns({ width: probe.width, height: probe.height, data });
  if (bands.length <= 1) return whole;
  return bands.map((band) => ({
    x0: Math.round(band.x0 / scale),
    x1: Math.round(band.x1 / scale),
  }));
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

interface CacheEntry {
  lang: string;
  worker: OcrWorker;
}

let cache: CacheEntry | null = null;
let progressHandler: ((progress: number, status: string) => void) | null = null;

const FAST_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const BEST_CDN = 'https://tessdata.projectnaptha.com/4.0.0';

export interface OcrOptions {
  lang: string;
  langPath: string;
  onProgress?: (progress: number, status: string) => void;
  /** 桌面壳离线取字：返回 gz 字节的 base64；拿不到再回落到网络 fetch。 */
  loadGzBase64?: (lang: string) => Promise<string | null>;
}

/** 相对路径补成绝对 URL：Worker 内按 Worker 脚本位置解析相对路径，会指错目录，这里统一在主线程算好。 */
function toAbsolute(base: string): string {
  if (/^(https?|blob|file):/i.test(base)) return base.replace(/\/+$/, '');
  return new URL(base, window.location.href).href.replace(/\/+$/, '');
}

/** 随站点分发的内置语言包目录，兼容子路径部署（GitHub Pages 的 /stillframe/）。 */
function bundledTessdata(): string {
  return new URL('tessdata', document.baseURI).href.replace(/\/+$/, '');
}

/**
 * 本地识别引擎（worker 脚本 + WASM 核心），不再从 jsdelivr 拉取，内网/离线可完整运行。
 * corePath 给目录，Worker 内按 SIMD 能力自行选 simd-lstm 或 lstm 核心。
 */
function localEngine(): { workerPath: string; corePath: string } {
  const dir = new URL('tesseract', document.baseURI).href.replace(/\/+$/, '');
  return { workerPath: `${dir}/worker.min.js`, corePath: dir };
}

/**
 * 语言包目录解析：优先用户配置，其次随站点分发的 ./tessdata（内网/离线部署用），
 * 再走 fast CDN（体积小、加载快），最后回落到 best CDN 兜底。只发 HEAD，不额外下载。
 */
async function resolveLangPath(preferred: string): Promise<string> {
  const candidates = [
    preferred,
    bundledTessdata(),
    FAST_CDN,
    BEST_CDN,
  ];
  for (const base of candidates) {
    const trimmed = toAbsolute(base);
    if (!trimmed) continue;
    try {
      const response = await fetch(`${trimmed}/eng.traineddata.gz`, { method: 'HEAD' });
      if (response.ok) return trimmed;
    } catch {
      // 跨域/离线都按不可用处理，继续试下一个。
    }
  }
  return toAbsolute(preferred);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 流式 gunzip：主线程解压，避免把大 gz 丢进 Worker 再卡一道结构化克隆。 */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([bytes as unknown as BlobPart]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

interface PreloadOptions {
  langPath: string;
  loadGzBase64?: (lang: string) => Promise<string | null>;
  onProgress?: (progress: number, label: string) => void;
}

/**
 * 预取语言包并写进 tesseract.js 的 IndexedDB 缓存（idb-keyval 默认 store，
 * 键 `./<lang>.traineddata`）。Worker 启动时先读缓存，命中就不再发网络请求，
 * 桌面壳因此能完全离线取字。已缓存的语言直接跳过，不重复下载。
 */
export async function preloadLanguages(langCodes: string[], options: PreloadOptions): Promise<void> {
  const resolvedBase = await resolveLangPath(options.langPath);
  const total = langCodes.length || 1;

  for (let index = 0; index < langCodes.length; index += 1) {
    const code = langCodes[index];
    const cacheKey = `./${code}.traineddata`;
    const cached = await idbGet(cacheKey).catch(() => undefined);
    if (cached instanceof Uint8Array && cached.length > 0) {
      options.onProgress?.((index + 1) / total, `语言包就绪 ${code}`);
      continue;
    }

    options.onProgress?.(index / total, `读取内置语言包 ${code}`);
    let gz: Uint8Array | null = null;
    if (options.loadGzBase64) {
      const base64 = await options.loadGzBase64(code).catch(() => null);
      if (base64) gz = base64ToBytes(base64);
    }

    if (!gz) {
      options.onProgress?.(index / total, `下载语言包 ${code}`);
      const response = await fetch(`${resolvedBase}/${code}.traineddata.gz`);
      if (!response.ok) throw new Error(`语言包 ${code} 下载失败：HTTP ${response.status}`);
      gz = new Uint8Array(await response.arrayBuffer());
    }

    options.onProgress?.(index / total, `解压语言包 ${code}`);
    const bytes = await gunzip(gz);
    await idbSet(cacheKey, bytes);
    options.onProgress?.((index + 1) / total, `语言包就绪 ${code}`);
  }
}

async function getWorker(options: OcrOptions): Promise<OcrWorker> {
  progressHandler = options.onProgress ?? null;
  if (cache && cache.lang === options.lang) return cache.worker;

  if (cache) {
    await cache.worker.terminate().catch(() => undefined);
    cache = null;
  }

  const langCodes = options.lang.split('+').filter(Boolean);
  await preloadLanguages(langCodes, {
    langPath: options.langPath,
    loadGzBase64: options.loadGzBase64,
    onProgress: (value, label) => options.onProgress?.(value, label),
  });

  const langPath = await resolveLangPath(options.langPath);
  const engine = localEngine();
  const worker = await createWorker(options.lang, 1, {
    workerPath: engine.workerPath,
    corePath: engine.corePath,
    langPath,
    gzip: true,
    logger: (message: { status: string; progress: number }) => {
      progressHandler?.(message.progress ?? 0, message.status ?? '');
    },
  });

  cache = { lang: options.lang, worker };
  return worker;
}

export interface OcrResult {
  text: string;
  confidence: number;
  /** 按版面间距聚出来的段落，对应升级项目书 G7。 */
  paragraphs: string[];
}

/**
 * 超大画布先缩到最长边 maxEdge 再出 PNG：既降低识别开销，也规避大画布结构化克隆在 WebView 里卡住。
 * 上限取 2400 —— 1080p/1440p 屏的整窗截图不再降采样，小字号中文不会被压糊；只有 4K 以上才缩。
 * 反向也补一刀：框选区往往只有几百像素宽，12px 左右的字直接喂给 tesseract 会漏笔画，
 * 长边不足 1200 时放大 2 倍再识别（实测同一块区域「日常」不会再读成「日党」，置信度 82 → 89）。
 */
export async function toOcrBlob(image: HTMLCanvasElement, maxEdge = 2400): Promise<Blob> {
  const longest = Math.max(image.width, image.height);
  const scale = longest > maxEdge ? maxEdge / longest : longest < 1200 ? 2 : 1;

  const exportFrom = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('识别图像导出失败'))), 'image/png');
    });

  if (Math.abs(scale - 1) < 0.01) return exportFrom(image);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建缩放画布');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return exportFrom(canvas);
}

export async function recognize(
  image: HTMLCanvasElement | Blob,
  options: OcrOptions,
): Promise<OcrResult> {
  const worker = await getWorker(options);
  progressHandler = options.onProgress ?? null;

  type RawLine = { text?: string; bbox?: { x0?: number; y0?: number; y1?: number } };
  const collect = (result: Awaited<ReturnType<OcrWorker['recognize']>>, offsetX = 0): OcrLineBox[] =>
    ((result.data as unknown as { lines?: RawLine[] }).lines ?? []).map((line) => ({
      text: line.text ?? '',
      x0: (line.bbox?.x0 ?? 0) + offsetX,
      y0: line.bbox?.y0 ?? 0,
      y1: line.bbox?.y1 ?? 0,
    }));

  // 多栏截图先按竖向空白切栏，各栏分别识别再把行坐标拼回去。
  // 不切的话 tesseract 会把同一水平带的左右两栏拼成一条 line，段级无从挽回（见 docs/UPGRADE-PLAN §5.4）。
  const bands = image instanceof HTMLCanvasElement ? detectColumnsFromCanvas(image) : [{ x0: 0, x1: 0 }];
  const parts: OcrLineBox[] = [];
  const confidences: number[] = [];
  let rawText = '';

  if (bands.length > 1) {
    for (const band of bands) {
      const crop = cropToBand(image as HTMLCanvasElement, band);
      const result = await worker.recognize(crop as Parameters<OcrWorker['recognize']>[0]);
      parts.push(...collect(result, band.x0));
      confidences.push(result.data.confidence ?? 0);
      rawText += `${(result.data.text ?? '').trim()}\n\n`;
    }
  } else {
    const result = await worker.recognize(image as Parameters<OcrWorker['recognize']>[0]);
    parts.push(...collect(result));
    confidences.push(result.data.confidence ?? 0);
    rawText = result.data.text ?? '';
  }

  rawText = rawText.replace(/\n{3,}/g, '\n\n').trim();

  const rawLines = parts.filter((line) => line.text.trim().length > 0 && line.y1 > line.y0);

  const paragraphs = groupParagraphs(rawLines);
  // 可编辑区保留识别出的原始行结构（贴合截图里的换行，复制出去能直接对行），
  // 归并后的段落只在「段落视图」里用，避免整屏 UI 被糊成两三坨。
  const text = rawText;

  return {
    text,
    confidence: confidences.length === 0 ? 0 : Math.min(...confidences),
    paragraphs: paragraphs.length > 0 ? paragraphs : fallbackParagraphs(rawText),
  };
}

export async function disposeWorker(): Promise<void> {
  if (!cache) return;
  await cache.worker.terminate().catch(() => undefined);
  cache = null;
}
