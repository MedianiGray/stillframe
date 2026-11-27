import { resolveSelection } from './selection';
import type { Annotation, Point, Rect } from './types';

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function normalizeRect(rect: Rect): Rect {
  return {
    x: Math.min(rect.x, rect.x + rect.w),
    y: Math.min(rect.y, rect.y + rect.h),
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

/**
 * Shift 等比：把拖出来的矩形约束成正方形，方向跟着指针走。
 * 直接复用选区那套 `resolveSelection`，拖动选区和画标注才是同一种手感。
 */
export function squareRect(start: { x: number; y: number }, point: { x: number; y: number }): Rect {
  return resolveSelection(start.x, start.y, point.x, point.y, { alt: false, shift: true });
}

/**
 * Alt 吸附：把箭头线段吸到最近的 0° / 45° / 90° 方向，长度保持不变。
 * QQ 里按住修饰键画直线就是这个手感，画流程指向、坐标轴都靠它。
 */
export function snapAngle(from: { x: number; y: number }, to: { x: number; y: number }): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return { x: from.x, y: from.y };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: from.x + Math.cos(angle) * length,
    y: from.y + Math.sin(angle) * length,
  };
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  options: { mosaicSource?: HTMLCanvasElement; scale?: number } = {},
): void {
  const scale = options.scale ?? 1;
  for (const item of annotations) {
    ctx.save();
    switch (item.kind) {
      case 'rect': {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.weight * scale;
        ctx.lineJoin = 'miter';
        ctx.strokeRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
        break;
      }
      case 'ellipse': {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.weight * scale;
        ctx.beginPath();
        ctx.ellipse(
          item.rect.x + item.rect.w / 2,
          item.rect.y + item.rect.h / 2,
          Math.abs(item.rect.w / 2),
          Math.abs(item.rect.h / 2),
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        break;
      }
      case 'arrow': {
        drawArrow(ctx, item.from, item.to, item.color, item.weight * scale);
        break;
      }
      case 'pen': {
        if (item.points.length > 1) {
          ctx.strokeStyle = item.color;
          ctx.lineWidth = item.weight * scale;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(item.points[0].x, item.points[0].y);
          for (let i = 1; i < item.points.length; i += 1) {
            ctx.lineTo(item.points[i].x, item.points[i].y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'highlight': {
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = item.color;
        ctx.fillRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
        break;
      }
      case 'mosaic': {
        pixelate(ctx, item.rect, item.block, options.mosaicSource);
        break;
      }
      case 'text': {
        ctx.fillStyle = item.color;
        ctx.font = `600 ${item.size * scale}px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
        ctx.textBaseline = 'top';
        const lines = item.text.split('\n');
        // 行距按字号倍数算：1.28 是默认行高，调紧到 1.0 也不叠字。
        const step = item.size * (item.lineHeight ?? 1.28) * scale;
        lines.forEach((line, index) => {
          ctx.fillText(line, item.pos.x, item.pos.y + index * step);
        });
        break;
      }
      case 'step': {
        const radius = 15 * scale;
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(item.pos.x, item.pos.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0B0F0D';
        ctx.font = `700 ${13 * scale}px "Cascadia Mono", Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(item.index), item.pos.x, item.pos.y + 0.5 * scale);
        ctx.textAlign = 'start';
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  weight: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(10, weight * 3.4);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function pixelate(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  block: number,
  source?: HTMLCanvasElement,
): void {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.floor(rect.w));
  const h = Math.max(1, Math.floor(rect.h));
  const size = Math.max(3, Math.round(block));
  if (source && source.width > 0) {
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.floor(w / size));
    tmp.height = Math.max(1, Math.floor(h / size));
    const tmpCtx = tmp.getContext('2d');
    if (tmpCtx) {
      tmpCtx.drawImage(source, x, y, w, h, 0, 0, tmp.width, tmp.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
      ctx.restore();
    }
    return;
  }
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,12,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export const PALETTE = ['#E4A03C', '#E5444B', '#57C99A', '#6FA8DC', '#FFFFFF', '#0B0F0D'];
