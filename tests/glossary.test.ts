import { describe, expect, it } from 'vitest';
import { parseGlossary } from '../src/lib/glossary';

describe('parseGlossary', () => {
  it('解析逗号分隔的 CSV', () => {
    expect(parseGlossary('截图,screenshot\n长截图,scrolling capture')).toEqual({
      截图: 'screenshot',
      长截图: 'scrolling capture',
    });
  });

  it('解析等号与制表符写法', () => {
    expect(parseGlossary('OCR = 文字识别\n贴图\tpin')).toEqual({
      OCR: '文字识别',
      贴图: 'pin',
    });
  });

  it('忽略空行与注释', () => {
    expect(parseGlossary('\n# 注释行\n标注,annotation\n')).toEqual({ 标注: 'annotation' });
  });

  it('解析 JSON 对象并过滤非字符串值', () => {
    expect(parseGlossary('{"滤色": "filter", "num": 3}')).toEqual({ 滤色: 'filter' });
  });

  it('坏 JSON 返回空表', () => {
    expect(parseGlossary('{bad json')).toEqual({});
  });

  it('空文本返回空表', () => {
    expect(parseGlossary('   ')).toEqual({});
  });

  it('缺译词的行被跳过', () => {
    expect(parseGlossary('只有原词\n完整,complete')).toEqual({ 完整: 'complete' });
  });
});
