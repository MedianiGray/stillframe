import type { QqFilterId } from './qqspec';

interface Recipe {
  filter: string;
  vignette?: number;
  tint?: string;
  tintAlpha?: number;
}

/**
 * 对应 QQ 滤镜栏的十二项（Tips_Camera_Toolbar_FilterBar_*）。
 * QQ 使用自家图像引擎，这里用 Canvas 的等价调色近似，参数经过逐项目视校准。
 */
const RECIPES: Record<QqFilterId, Recipe> = {
  none: { filter: 'none' },
  sunshine: { filter: 'saturate(1.16) brightness(1.07) sepia(0.1)', tint: 'rgb(255,196,120)', tintAlpha: 0.07 },
  lomo: { filter: 'saturate(1.36) contrast(1.14)', vignette: 0.34 },
  ageing: { filter: 'sepia(0.52) contrast(0.96) brightness(1.04)', tint: 'rgb(120,86,44)', tintAlpha: 0.06 },
  gray: { filter: 'grayscale(1)' },
  sketch: { filter: 'grayscale(1) contrast(2.3) brightness(1.16)' },
  classiclomo: { filter: 'contrast(1.2) saturate(1.18) sepia(0.08)', vignette: 0.44 },
  rainbow: { filter: 'saturate(1.28) hue-rotate(-7deg)' },
  copperplate: { filter: 'sepia(0.7) contrast(1.24)', tint: 'rgb(96,62,30)', tintAlpha: 0.08 },
  polaroid: { filter: 'brightness(1.12) contrast(0.92) saturate(0.9)', tint: 'rgb(255,255,255)', tintAlpha: 0.05 },
  sweet: { filter: 'brightness(1.1) saturate(0.94) sepia(0.07)', tint: 'rgb(255,198,220)', tintAlpha: 0.09 },
  nightfall: { filter: 'brightness(0.9) saturate(1.12) hue-rotate(12deg)', tint: 'rgb(40,64,120)', tintAlpha: 0.12 },
};

export function applyFilter(source: HTMLCanvasElement, id: QqFilterId): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  const recipe = RECIPES[id] ?? RECIPES.none;

  ctx.save();
  ctx.filter = recipe.filter === 'none' ? 'none' : recipe.filter;
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  if (recipe.tint) {
    ctx.save();
    ctx.globalAlpha = recipe.tintAlpha ?? 0.08;
    ctx.fillStyle = recipe.tint;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.restore();
  }

  if (recipe.vignette) {
    const radius = Math.hypot(out.width, out.height) / 2;
    const gradient = ctx.createRadialGradient(
      out.width / 2,
      out.height / 2,
      radius * 0.35,
      out.width / 2,
      out.height / 2,
      radius,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${recipe.vignette})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.restore();
  }

  return out;
}
