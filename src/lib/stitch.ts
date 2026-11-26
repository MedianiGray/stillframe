export interface StitchResult {
  canvas: HTMLCanvasElement;
  overlap: number;
  confidence: number;
}

function rowSignatures(canvas: HTMLCanvasElement, cols = 32): { data: Float32Array; rows: number } {
  const rows = canvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = cols;
  tmp.height = rows;
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(canvas, 0, 0, cols, rows);
  const pixels = ctx.getImageData(0, 0, cols, rows).data;
  const data = new Float32Array(rows * cols);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = (y * cols + x) * 4;
      data[y * cols + x] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }
  }
  return { data, rows };
}

/**
 * Find how many trailing rows of `top` repeat at the head of `bottom`.
 * Uses coarse luminance rows and a sampled comparison so it stays fast on long captures.
 */
export function findOverlap(
  top: HTMLCanvasElement,
  bottom: HTMLCanvasElement,
  options: { min?: number; max?: number; tolerance?: number } = {},
): { overlap: number; confidence: number } {
  const cols = 32;
  const a = rowSignatures(top, cols);
  const b = rowSignatures(bottom, cols);
  const limit = Math.min(a.rows, b.rows);
  const minOverlap = options.min ?? 24;
  const maxOverlap = options.max ?? Math.min(limit, 2400);
  const tolerance = options.tolerance ?? 9;

  let best: { overlap: number; score: number } = { overlap: 0, score: Number.POSITIVE_INFINITY };

  for (let overlap = minOverlap; overlap <= maxOverlap; overlap += 1) {
    const step = overlap > 600 ? 3 : 1;
    let sum = 0;
    let samples = 0;
    for (let row = 0; row < overlap; row += step) {
      const topRow = (a.rows - overlap + row) * cols;
      const bottomRow = row * cols;
      for (let x = 0; x < cols; x += 1) {
        sum += Math.abs(a.data[topRow + x] - b.data[bottomRow + x]);
      }
      samples += 1;
    }
    const score = sum / (samples * cols);
    if (score < best.score) best = { overlap, score };
  }

  if (best.overlap === 0 || best.score > tolerance) {
    return { overlap: 0, confidence: 0 };
  }
  return { overlap: best.overlap, confidence: Math.max(0, 1 - best.score / tolerance) };
}

export function stitchVertical(
  top: HTMLCanvasElement,
  bottom: HTMLCanvasElement,
  options: { overlap?: number; autoDetect?: boolean } = {},
): StitchResult {
  let overlap = options.overlap ?? 0;
  let confidence = 0;

  if (options.autoDetect !== false) {
    const detected = findOverlap(top, bottom);
    overlap = detected.overlap;
    confidence = detected.confidence;
  }

  const height = top.height + bottom.height - overlap;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(top.width, bottom.width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(top, 0, 0);
  ctx.drawImage(bottom, 0, top.height - overlap);
  return { canvas, overlap, confidence };
}

/** 顺时针 / 逆时针 90°，用于把横向拼接转成纵向算法复用。 */
function rotate90(source: HTMLCanvasElement, clockwise: boolean): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.height;
  out.height = source.width;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((clockwise ? Math.PI : -Math.PI) / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

/**
 * 长截图工具的方向开关里「水平」那一档：把两张图转成竖向求重叠，
 * 拼完再转回来，重叠量即列重叠像素数。
 */
export function stitchHorizontal(
  left: HTMLCanvasElement,
  right: HTMLCanvasElement,
  options: { overlap?: number; autoDetect?: boolean } = {},
): StitchResult {
  const a = rotate90(left, false);
  const b = rotate90(right, false);
  const result = stitchVertical(a, b, options);
  return { canvas: rotate90(result.canvas, true), overlap: result.overlap, confidence: result.confidence };
}
