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
}

export async function recognize(
  image: HTMLCanvasElement | Blob,
  options: OcrOptions,
): Promise<OcrResult> {
  const worker = await getWorker(options);
  progressHandler = options.onProgress ?? null;
  const source = image instanceof Blob ? image : image;
  const result = await worker.recognize(source as Parameters<OcrWorker['recognize']>[0]);
  const text = (result.data.text ?? '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, confidence: result.data.confidence ?? 0 };
}

export async function disposeWorker(): Promise<void> {
  if (!cache) return;
  await cache.worker.terminate().catch(() => undefined);
  cache = null;
}
