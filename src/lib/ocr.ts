import { createWorker } from 'tesseract.js';

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

interface CacheEntry {
  lang: string;
  worker: OcrWorker;
}

let cache: CacheEntry | null = null;
let progressHandler: ((progress: number, status: string) => void) | null = null;

export interface OcrOptions {
  lang: string;
  langPath: string;
  onProgress?: (progress: number, status: string) => void;
}

async function getWorker(options: OcrOptions): Promise<OcrWorker> {
  progressHandler = options.onProgress ?? null;
  if (cache && cache.lang === options.lang) return cache.worker;

  if (cache) {
    await cache.worker.terminate().catch(() => undefined);
    cache = null;
  }

  const worker = await createWorker(options.lang, 1, {
    langPath: options.langPath,
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

interface OcrLineBox {
  text: string;
  x0: number;
  y0: number;
  y1: number;
}

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
const ENDS_WITH_CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]$/;

/** 两行之间该不该断开：行距明显大于中位行高，或左侧缩进跳变。 */
function groupParagraphs(lines: OcrLineBox[]): string[] {
  const rows = lines
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.y0 - b.y0);

  if (rows.length === 0) return [];

  const heights = rows.map((row) => Math.max(1, row.y1 - row.y0)).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 20;

  const joinLine = (prev: string, next: string) =>
    ENDS_WITH_CJK.test(prev) || CJK.test(next.slice(0, 1)) ? `${prev}${next}` : `${prev} ${next}`;

  const paragraphs: string[] = [];
  let current = rows[0].text;
  let prev = rows[0];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const gap = row.y0 - prev.y1;
    const indent = Math.abs(row.x0 - prev.x0);
    const bigGap = gap > median * 1.4;
    const newIndent = indent > median * 2.2 && gap > median * 0.35;
    if (bigGap || newIndent) {
      paragraphs.push(current);
      current = row.text;
    } else {
      current = joinLine(current, row.text);
    }
    prev = row;
  }
  paragraphs.push(current);
  return paragraphs;
}

function fallbackParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export async function recognize(
  image: HTMLCanvasElement | Blob,
  options: OcrOptions,
): Promise<OcrResult> {
  const worker = await getWorker(options);
  progressHandler = options.onProgress ?? null;
  const source = image instanceof Blob ? image : image;
  const result = await worker.recognize(source as Parameters<OcrWorker['recognize']>[0]);
  const rawText = (result.data.text ?? '').replace(/\n{3,}/g, '\n\n').trim();

  type RawLine = { text?: string; bbox?: { x0?: number; y0?: number; y1?: number } };
  const rawLines = ((result.data as unknown as { lines?: RawLine[] }).lines ?? [])
    .map((line) => ({
      text: line.text ?? '',
      x0: line.bbox?.x0 ?? 0,
      y0: line.bbox?.y0 ?? 0,
      y1: line.bbox?.y1 ?? 0,
    }))
    .filter((line) => line.text.trim().length > 0 && line.y1 > line.y0);

  const paragraphs = groupParagraphs(rawLines);
  const text = paragraphs.length > 0 ? paragraphs.join('\n\n') : rawText;

  return {
    text,
    confidence: result.data.confidence ?? 0,
    paragraphs: paragraphs.length > 0 ? paragraphs : fallbackParagraphs(rawText),
  };
}

export async function disposeWorker(): Promise<void> {
  if (!cache) return;
  await cache.worker.terminate().catch(() => undefined);
  cache = null;
}
