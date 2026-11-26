import { describe, expect, it } from 'vitest';
import { judgeScroll, wheelNotches } from '../src/lib/autoscroll';

describe('长截图自动滚动判定', () => {
  it('视口 70% 折算档数，并夹在 1~20 档', () => {
    expect(wheelNotches(300)).toBe(4); // 210px ≈ 4 档
    expect(wheelNotches(60)).toBe(1);
    expect(wheelNotches(4000)).toBe(20);
  });

  it('单帧还不能判断，先继续', () => {
    expect(judgeScroll([])).toBe('continue');
    expect(judgeScroll([{ overlap: 120, difference: 0.01 }])).toBe('continue');
  });

  it('拼上了就继续', () => {
    expect(
      judgeScroll([
        { overlap: 0, difference: 0.2 },
        { overlap: 118, difference: 0.2 },
      ]),
    ).toBe('continue');
  });

  it('连续两帧几乎没变且没拼上，判定到底', () => {
    expect(
      judgeScroll([
        { overlap: 0, difference: 0.001 },
        { overlap: 0, difference: 0.001 },
      ]),
    ).toBe('end');
  });

  it('没拼上且画面整体变了，回退手动', () => {
    expect(
      judgeScroll([
        { overlap: 100, difference: 0.2 },
        { overlap: 0, difference: 0.5 },
      ]),
    ).toBe('fallback');
  });

  it('超过屏数上限强制结束', () => {
    const many = Array.from({ length: 30 }, () => ({ overlap: 90, difference: 0.1 }));
    expect(judgeScroll(many, { maxFrames: 30 })).toBe('end');
  });
});
