import { describe, expect, it } from 'vitest';
import { detectColumns } from '../src/lib/columns';

/** 白底、指定区间刷黑块的图，用来造「有栏 / 无栏」的版面。 */
function page(width: number, height: number, blocks: Array<[number, number]>) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x0, x1] of blocks) {
    for (let y = 10; y < height - 10; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = 20;
        data[i + 1] = 20;
        data[i + 2] = 20;
      }
    }
  }
  return { width, height, data };
}

describe('版面分栏检测', () => {
  it('左右两栏之间留出竖向空白，切成两栏', () => {
    const bands = detectColumns(page(400, 200, [[20, 160], [240, 380]]));
    expect(bands).toHaveLength(2);
    expect(bands[0].x0).toBeLessThanOrEqual(20);
    expect(bands[0].x1).toBeGreaterThanOrEqual(160);
    expect(bands[1].x0).toBeLessThanOrEqual(240);
  });

  it('满宽正文不乱切', () => {
    expect(detectColumns(page(400, 200, [[10, 390]]))).toHaveLength(1);
  });

  it('页边距的空白不当成栏间切口', () => {
    // 只有左右页边距，中间是完整一段文字：切了等于白切
    expect(detectColumns(page(400, 200, [[40, 360]]))).toHaveLength(1);
  });

  it('窄缝隙是字间距，不是栏', () => {
    // 缝隙只有 8px，远小于图宽 4%
    expect(detectColumns(page(400, 200, [[20, 196], [204, 380]]))).toHaveLength(1);
  });
});
