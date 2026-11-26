import type { Rect } from './types';

export interface SelectionModifiers {
  alt: boolean;
  shift: boolean;
}

/**
 * 由起点、当前点与修饰键算出选区矩形。
 * Shift 等比（正方形），Alt 吸附成直线（只保留主轴）。对应升级项目书 W2 标注细节。
 */
export function resolveSelection(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  modifiers: SelectionModifiers = { alt: false, shift: false },
): Rect {
  let x = currentX;
  let y = currentY;
  const dx = x - startX;
  const dy = y - startY;

  if (modifiers.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    x = startX + (dx < 0 ? -side : side);
    y = startY + (dy < 0 ? -side : side);
  }
  if (modifiers.alt) {
    if (Math.abs(dx) >= Math.abs(dy)) y = startY;
    else x = startX;
  }

  return {
    x: Math.min(startX, x),
    y: Math.min(startY, y),
    w: Math.abs(x - startX),
    h: Math.abs(y - startY),
  };
}

/** 选区是否够格确认：直线选区允许短边为 0，只要长边够长。 */
export function isSelectionUsable(rect: Rect, min = 6): boolean {
  return Math.max(rect.w, rect.h) >= min;
}
