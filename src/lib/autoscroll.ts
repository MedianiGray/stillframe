/**
 * 自动滚动长截图的判定层。
 *
 * 驱动（注入滚轮）在桌面壳里，这里只做两件与平台无关的事：
 * 1. 把视口高度折算成滚轮档数；
 * 2. 根据「相邻两帧能不能拼上、差异多少」判断该继续、到底、还是该回退手动。
 */

export interface ScrollSample {
  /** 自动检测到的重叠行数，0 表示没拼上 */
  overlap: number;
  /** 两张图逐点差异的归一化值，0~1 */
  difference: number;
}

export type ScrollVerdict = 'continue' | 'end' | 'fallback';

/** 屏幕矩形（物理像素）。窗口和选区都换算到这一套坐标再比。 */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 选区（Rect 记法，w/h 是宽高）。 */
export interface ScreenRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScrollLimits {
  /** 最多自动滚多少屏，防止无限循环 */
  maxFrames?: number;
  /** 判定「到底」的差异阈值：连续两帧几乎一样说明滚不动了 */
  sameScreen?: number;
  /** 判定「断层」的差异阈值：完全变了且没有重叠，需要手动给重叠量 */
  jump?: number;
}

/** 一档滚轮大约推进 50px（系统默认 3 行 × 行高）。取视口 70%，避免重叠区不足。 */
const PIXELS_PER_NOTCH = 50;

/**
 * 自己窗口会不会挡住截取区域。
 *
 * `offset` 是选区所在屏在虚拟桌面上的原点：窗口是屏幕绝对坐标，选区是图内坐标，
 * 副屏（原点为负）不补偿就会误判成「没挡住」，长图里于是混进自己的窗口。
 * 重叠宽高都要超过 margin 才算遮挡：贴着边 1~2px 蹭到不算，
 * 否则每张长图都会无谓地把自己的窗口收起来，反而打断用户。
 */
export function shadowsCapture(
  box: ScreenBox,
  region: ScreenRegion,
  margin = 8,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): boolean {
  const regionX = region.x + offset.x;
  const regionY = region.y + offset.y;
  const overlapX = Math.min(box.x + box.width, regionX + region.w) - Math.max(box.x, regionX);
  const overlapY = Math.min(box.y + box.height, regionY + region.h) - Math.max(box.y, regionY);
  return overlapX > margin && overlapY > margin;
}

export function wheelNotches(viewHeight: number): number {
  const target = Math.max(64, viewHeight * 0.7);
  return Math.min(20, Math.max(1, Math.round(target / PIXELS_PER_NOTCH)));
}

/**
 * 看最后两帧决定下一步：
 * - 连续两次没拼上且画面几乎没变 → 到底，停止；
 * - 没拼上且画面变化很大 → 断层，停止并提示手动重叠；
 * - 其余情况继续。
 */
export function judgeScroll(samples: ScrollSample[], limits: ScrollLimits = {}): ScrollVerdict {
  const maxFrames = limits.maxFrames ?? 30;
  const sameScreen = limits.sameScreen ?? 0.004;
  const jump = limits.jump ?? 0.02;

  if (samples.length >= maxFrames) return 'end';
  if (samples.length < 2) return 'continue';

  const last = samples[samples.length - 1];
  const prev = samples[samples.length - 2];
  if (last.overlap > 0) return 'continue';

  const stuck = prev.overlap === 0 && last.difference <= sameScreen && prev.difference <= sameScreen;
  if (stuck) return 'end';
  if (last.difference > jump) return 'fallback';
  return 'continue';
}

/** 抽样比对两张画布，返回 0~1 的差异比例；尺寸不同直接算全变。 */
export function sampledDifference(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const cols = 24;
  const rows = Math.min(64, Math.max(8, Math.round((cols * a.height) / Math.max(1, a.width))));
  const sample = (canvas: HTMLCanvasElement) => {
    const tmp = document.createElement('canvas');
    tmp.width = cols;
    tmp.height = rows;
    const ctx = tmp.getContext('2d');
    if (!ctx) throw new Error('无法创建取样画布');
    ctx.drawImage(canvas, 0, 0, cols, rows);
    return ctx.getImageData(0, 0, cols, rows).data;
  };
  const pa = sample(a);
  const pb = sample(b);
  let changed = 0;
  let total = 0;
  for (let i = 0; i < pa.length; i += 4) {
    total += 1;
    const diff =
      Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
    if (diff > 36) changed += 1;
  }
  return total ? changed / total : 0;
}
