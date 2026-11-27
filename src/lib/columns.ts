/**
 * 版面分栏检测。
 *
 * 为什么需要它：tesseract 对「左右两栏、栏间没有分隔线」的截图，会把同一水平带上的
 * 左右两段文字拼成一条 line（`机柜重新整理…图纸上。 = - 上行端口 24个`）。
 * 到了行的粒度就已经串了，后面再怎么聚段都救不回来——只能在下手识别之前先把栏切开。
 *
 * 判据只看像素：横着一列一列数「有多少行在这一列上有墨」，整列几乎没墨的就是栏间空白。
 * 只切内部的空白带（左右都有内容），页边距不算；切口两侧剪掉的空白比留着更好，
 * 否则 tesseract 又会把两片拼回去。
 */

export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

export interface Band {
  x0: number;
  x1: number;
}

export interface ColumnOptions {
  /** 与背景色差多少算有墨（0-255 的欧氏距离）。 */
  tolerance?: number;
  /** 一列里有墨的行占比低于它，就算空白列。 */
  inkRatio?: number;
  /** 切口至少要这么宽（相对图宽），太窄的缝隙是字间距，不是栏。 */
  minGapRatio?: number;
  /** 切出来的每一栏至少要这么宽（相对图宽），否则更像表格列而不是栏。 */
  minBandRatio?: number;
  /** 最多切几栏，超过当误检。 */
  maxBands?: number;
}

const DEFAULTS: Required<ColumnOptions> = {
  tolerance: 28,
  inkRatio: 0.015,
  minGapRatio: 0.04,
  minBandRatio: 0.18,
  maxBands: 3,
};

/** 背景色取四角小块的中位数：白底、浅灰底、深色主题都吃得下。 */
function background(image: RawImage): [number, number, number] {
  const { width, height, data } = image;
  const samples: number[][] = [[], [], []];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 40));
  for (let y = 2; y < Math.min(24, height); y += step) {
    for (let x = 2; x < Math.min(24, width); x += step) {
      const i = (y * width + x) * 4;
      samples[0].push(data[i]);
      samples[1].push(data[i + 1]);
      samples[2].push(data[i + 2]);
    }
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 255;
  };
  return [median(samples[0]), median(samples[1]), median(samples[2])];
}

export function detectColumns(image: RawImage, options: ColumnOptions = {}): Band[] {
  const opts = { ...DEFAULTS, ...options };
  const { width, height, data } = image;
  const whole: Band[] = [{ x0: 0, x1: width }];
  if (width < 240 || height < 120) return whole;

  const [br, bg, bb] = background(image);
  const tol = opts.tolerance * opts.tolerance;

  // 每列数墨：隔行采样，两倍速度换不到 1% 的精度损失
  const ink = new Float32Array(width);
  let sampled = 0;
  for (let y = 0; y < height; y += 2) {
    sampled += 1;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = (row + x) * 4;
      const dr = data[i] - br;
      const dg = data[i + 1] - bg;
      const db = data[i + 2] - bb;
      if (dr * dr + dg * dg + db * db > tol) ink[x] += 1;
    }
  }

  // 连续空白带
  const gaps: Band[] = [];
  let start = -1;
  for (let x = 0; x <= width; x += 1) {
    const empty = x < width && ink[x] / sampled < opts.inkRatio;
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) {
      gaps.push({ x0: start, x1: x });
      start = -1;
    }
  }
  if (start >= 0) gaps.push({ x0: start, x1: width });

  const minGap = Math.max(10, Math.round(width * opts.minGapRatio));
  // 只认内部切口：左右都要有墨，页边距切了没意义
  const cuts = gaps.filter((gap) => gap.x0 > 0 && gap.x1 < width && gap.x1 - gap.x0 >= minGap);
  if (cuts.length === 0) return whole;

  const edges = [0, ...cuts.flatMap((cut) => [cut.x0, cut.x1]), width];
  const bands: Band[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    bands.push({ x0: edges[i], x1: edges[i + 1] });
  }

  const minBand = width * opts.minBandRatio;
  const usable = bands.filter((band) => band.x1 - band.x0 >= minBand);
  if (usable.length < 2 || usable.length > opts.maxBands) return whole;
  return usable;
}

/** 按栏裁一张 canvas：左右各留 2px，够 tesseract 不当成贴边，又不足把它和隔壁拼回去。 */
export function cropToBand(canvas: HTMLCanvasElement, band: Band): HTMLCanvasElement {
  const pad = 2;
  const x0 = Math.max(0, band.x0 + pad);
  const x1 = Math.min(canvas.width, band.x1 - pad);
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0);
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (ctx) ctx.drawImage(canvas, x0, 0, out.width, canvas.height, 0, 0, out.width, canvas.height);
  return out;
}
