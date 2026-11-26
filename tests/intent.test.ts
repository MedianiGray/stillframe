import { describe, expect, it } from 'vitest';
import { detectContent } from '../src/lib/intent';

describe('识别结果的内容判读', () => {
  it('字太少就不给建议，宁可不猜', () => {
    expect(detectContent('')).toBeNull();
    expect(detectContent('课表在哪')).toBeNull();
  });

  it('中文正文给「复制文字」', () => {
    const read = detectContent('把你刚才那段话再发一遍。\n我这边没有收到，麻烦重新发一下。');
    expect(read).not.toBeNull();
    expect(read!.kind).toBe('prose');
    expect(read!.script).toBe('zh');
    expect(read!.suggest).toBe('copy');
    expect(read!.summary).toContain('中文');
    expect(read!.summary).toContain('正文');
  });

  it('英文正文预选翻译', () => {
    const read = detectContent(
      'The quick brown fox jumps over the lazy dog.\nThis paragraph exists only for the test.',
    );
    expect(read!.script).toBe('en');
    expect(read!.suggest).toBe('translate');
    expect(read!.actionLabel).toBe('翻译');
  });

  it('代码片段：判成代码，但不预选翻译', () => {
    const read = detectContent(
      ['function add(a, b) {', '  return a + b;', '}', 'const total = add(1, 2);'].join('\n'),
    );
    expect(read!.kind).toBe('code');
    expect(read!.suggest).toBe('copy');
    expect(read!.summary).toContain('保留缩进');
  });

  it('英文代码也不推翻译', () => {
    const read = detectContent(['import os', 'def main():', '    return os.path.join("a", "b")'].join('\n'));
    expect(read!.kind).toBe('code');
    expect(read!.suggest).toBe('copy');
  });

  it('多列对齐的文本判成表格，并报出列数', () => {
    const read = detectContent(
      ['姓名    班级    分数', '张三    2502    88', '李四    2502    92', '王五    2501    75'].join('\n'),
    );
    expect(read!.kind).toBe('table');
    expect(read!.summary).toContain('列');
    expect(read!.suggest).toBe('copy');
  });

  it('以符号开头的连续行判成清单', () => {
    const read = detectContent(['- 检查电源', '- 检查网线', '- 检查交换机端口', '- 记录日志'].join('\n'));
    expect(read!.kind).toBe('list');
  });

  it('数字为主（如账单）标记为号码而不是正文', () => {
    const read = detectContent(['2026', '11', '26', '3534', '2262', '79'].join('\n'));
    expect(read!.script).toBe('num');
  });
});
