import { describe, expect, it } from 'vitest';
import { snapAngle, squareRect, toNativeAnnotation } from '../src/lib/annotate';

describe('squareRect', () => {
  it('正向斜拖取较长边变正方形', () => {
    expect(squareRect({ x: 0, y: 0 }, { x: 40, y: 90 })).toEqual({ x: 0, y: 0, w: 90, h: 90 });
  });

  it('反向拖拽保持方向，矩形仍在起点左侧', () => {
    expect(squareRect({ x: 100, y: 100 }, { x: 60, y: 20 })).toEqual({ x: 20, y: 20, w: 80, h: 80 });
  });
});

describe('snapAngle', () => {
  it('接近水平时吸成水平线，长度不变', () => {
    const to = snapAngle({ x: 0, y: 0 }, { x: 100, y: 8 });
    expect(Math.round(to.x)).toBe(100);
    expect(Math.round(to.y)).toBe(0);
  });

  it('接近垂直时吸成垂直线，长度不变', () => {
    const to = snapAngle({ x: 0, y: 0 }, { x: 9, y: -80 });
    expect(Math.round(to.x)).toBe(0);
    expect(Math.round(Math.hypot(to.x, to.y))).toBe(Math.round(Math.hypot(9, -80)));
  });

  it('45 度斜线吸附后仍是等长对角线', () => {
    const to = snapAngle({ x: 0, y: 0 }, { x: 70, y: 66 });
    const length = Math.hypot(to.x, to.y);
    expect(Math.round(length)).toBe(Math.round(Math.hypot(70, 66)));
    expect(Math.round(to.x)).toBe(Math.round(to.y));
  });

  it('几乎没动时保持原位，不闪成奇怪方向', () => {
    expect(snapAngle({ x: 5, y: 5 }, { x: 5.3, y: 5.2 })).toEqual({ x: 5, y: 5 });
  });
});

describe('toNativeAnnotation', () => {
  const W = 1280;
  const H = 720;

  it('矩形按选区宽高归一化，线宽跟着宽走', () => {
    const payload = toNativeAnnotation(
      { kind: 'rect', color: '#FF3030', width: 5, a: { x: 128, y: 72 }, b: { x: 640, y: 360 } },
      W,
      H,
      1000,
    );
    expect(payload).toEqual({
      kind: 'rect',
      color: '#FF3030',
      width: 5 / W,
      atMs: 1000,
      a: [0.1, 0.1],
      b: [0.5, 0.5],
    });
  });

  it('画笔每个点都归一化，文字字号按宽归一化', () => {
    const pen = toNativeAnnotation(
      { kind: 'pen', color: '#7CFF6B', width: 3, points: [{ x: 0, y: 0 }, { x: 1280, y: 720 }] },
      W,
      H,
      2000,
    );
    expect(pen.points).toEqual([[0, 0], [1, 1]]);

    const text = toNativeAnnotation(
      { kind: 'text', color: '#FFFFFF', size: 18, pos: { x: 128, y: 648 }, text: '标注进成片' },
      W,
      H,
      3000,
    );
    expect(text.size).toBeCloseTo(18 / W, 10);
    expect(text.pos).toEqual([0.1, 0.9]);
    expect(text.text).toBe('标注进成片');
  });

  it('选区尺寸为 0 时不产生 Inf / NaN', () => {
    const payload = toNativeAnnotation(
      { kind: 'arrow', color: '#FFD400', width: 3, a: { x: 0, y: 0 }, b: { x: 12, y: 8 } },
      0,
      0,
      0,
    );
    expect(Number.isFinite(payload.width)).toBe(true);
    expect(payload.a?.every(Number.isFinite)).toBe(true);
  });
});
