import { describe, expect, it } from 'vitest';
import { isSelectionUsable, resolveSelection } from '../src/lib/selection';
import { normalizeRect, rectFromPoints } from '../src/lib/annotate';

describe('resolveSelection', () => {
  it('自由拖拽得到普通矩形', () => {
    expect(resolveSelection(10, 20, 60, 80)).toEqual({ x: 10, y: 20, w: 50, h: 60 });
  });

  it('反向拖拽也归一化为正矩形', () => {
    expect(resolveSelection(60, 80, 10, 20)).toEqual({ x: 10, y: 20, w: 50, h: 60 });
  });

  it('Shift 强制正方形，取较长边', () => {
    expect(resolveSelection(0, 0, 40, 90, { alt: false, shift: true })).toEqual({
      x: 0,
      y: 0,
      w: 90,
      h: 90,
    });
  });

  it('Shift 在反向拖拽时保持方向', () => {
    expect(resolveSelection(100, 100, 60, 20, { alt: false, shift: true })).toEqual({
      x: 20,
      y: 20,
      w: 80,
      h: 80,
    });
  });

  it('Alt 吸附成水平直线', () => {
    expect(resolveSelection(0, 50, 200, 58, { alt: true, shift: false })).toEqual({
      x: 0,
      y: 50,
      w: 200,
      h: 0,
    });
  });

  it('Alt 吸附成垂直直线', () => {
    expect(resolveSelection(50, 0, 58, 200, { alt: true, shift: false })).toEqual({
      x: 50,
      y: 0,
      w: 0,
      h: 200,
    });
  });

  it('Shift 与 Alt 同时按下时，Alt 按原始位移方向取舍', () => {
    expect(resolveSelection(0, 0, 30, 90, { alt: true, shift: true })).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 90,
    });
  });
});

describe('isSelectionUsable', () => {
  it('普通选区两边都要够大期间按长边判定', () => {
    expect(isSelectionUsable({ x: 0, y: 0, w: 100, h: 0 })).toBe(true);
    expect(isSelectionUsable({ x: 0, y: 0, w: 4, h: 4 })).toBe(false);
    expect(isSelectionUsable({ x: 0, y: 0, w: 6, h: 6 })).toBe(true);
  });
});

describe('rect helpers', () => {
  it('rectFromPoints 不依赖拖拽方向', () => {
    expect(rectFromPoints({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 4, h: 7 });
  });

  it('normalizeRect 修正负宽高', () => {
    expect(normalizeRect({ x: 10, y: 10, w: -4, h: -6 })).toEqual({ x: 6, y: 4, w: 4, h: 6 });
  });
});
