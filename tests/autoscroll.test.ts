import { describe, expect, it } from 'vitest';
import { judgeScroll, shadowsCapture, wheelNotches } from '../src/lib/autoscroll';

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

  it('窗口压住选区才算遮挡，贴边蹭到不算', () => {
    const region = { x: 100, y: 100, w: 800, h: 600 };
    // 整块盖住
    expect(shadowsCapture({ x: 0, y: 0, width: 1000, height: 800 }, region)).toBe(true);
    // 只压住右边缘一条 3px 缝：不值得为它把窗口藏起来
    expect(shadowsCapture({ x: 897, y: 0, width: 400, height: 800 }, region)).toBe(false);
    // 完全在选区外面
    expect(shadowsCapture({ x: 1200, y: 0, width: 300, height: 400 }, region)).toBe(false);
    // 横跨选区上沿、压进去 40px：算遮挡
    expect(shadowsCapture({ x: 300, y: 0, width: 600, height: 140 }, region)).toBe(true);
  });

  it('margin 可按屏幕密度放宽', () => {
    const region = { x: 0, y: 0, w: 500, h: 500 };
    const box = { x: 0, y: 0, width: 520, height: 30 };
    expect(shadowsCapture(box, region, 8)).toBe(true);
    expect(shadowsCapture(box, region, 40)).toBe(false);
  });
});
