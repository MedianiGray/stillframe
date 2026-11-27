import { describe, expect, it } from 'vitest';
import { groupParagraphs } from '../src/lib/ocr';

type Box = { text: string; x0: number; y0: number; y1: number };

/** 造一段等行高（20px）的版面，行距可调。 */
const box = (text: string, x0: number, y0: number, height = 20): Box => ({ text, x0, y0, y1: y0 + height });

describe('取字段落归并', () => {
  it('同一列连续正文按中文无空格拼接', () => {
    const rows = [box('第一行正文', 40, 100), box('第二行正文', 40, 120), box('第三行正文', 40, 140)];
    expect(groupParagraphs(rows)).toEqual(['第一行正文第二行正文第三行正文']);
  });

  it('行距明显变大就断段', () => {
    const rows = [box('标题', 40, 100), box('段落一', 40, 180), box('段落二', 40, 200)];
    expect(groupParagraphs(rows)).toEqual(['标题', '段落一段落二']);
  });

  it('左边界跨列就断段，不把两栏串成一句', () => {
    const rows = [box('侧边栏条目', 30, 100), box('正文内容', 400, 120), box('正文续行', 400, 140)];
    expect(groupParagraphs(rows)).toEqual(['侧边栏条目', '正文内容正文续行']);
  });

  it('空行与空白行直接丢掉', () => {
    expect(groupParagraphs([box('   ', 0, 0), box('有效文字', 40, 100)])).toEqual(['有效文字']);
    expect(groupParagraphs([])).toEqual([]);
  });

  it('并排双栏各归各段，按栏读而不是按行横着串', () => {
    // 左右两栏在同一水平带上交错，行序一混就会读成「左一右一左二右二」这种怪句
    const rows = [
      box('左栏第一行', 40, 100),
      box('右栏参数一', 500, 104),
      box('左栏第二行', 40, 120),
      box('右栏参数二', 500, 124),
      box('左栏第三行', 40, 140),
    ];
    expect(groupParagraphs(rows)).toEqual(['左栏第一行左栏第二行左栏第三行', '右栏参数一右栏参数二']);
  });

  it('居中标题不当成第二栏，顺序仍在最前', () => {
    const rows = [box('大标题', 300, 60), box('正文第一行', 40, 120), box('正文第二行', 40, 140)];
    expect(groupParagraphs(rows)).toEqual(['大标题', '正文第一行正文第二行']);
  });
});
