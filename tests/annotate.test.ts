import { describe, expect, it } from 'vitest';
import { snapAngle, squareRect } from '../src/lib/annotate';

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
