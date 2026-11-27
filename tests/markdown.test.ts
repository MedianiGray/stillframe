import { describe, expect, it } from 'vitest';
import {
  looksLikeBullet,
  looksLikeCode,
  paragraphsToMarkdown,
  stripBullet,
} from '../src/lib/markdown';

describe('looksLikeBullet / stripBullet', () => {
  it('认得出常见项目符号与序号', () => {
    expect(looksLikeBullet('- 先看课表')).toBe(true);
    expect(looksLikeBullet('• 第二项')).toBe(true);
    expect(looksLikeBullet('1. 打开设置')).toBe(true);
    expect(looksLikeBullet('① 第一条')).toBe(true);
  });

  it('普通句子不当清单项', () => {
    expect(looksLikeBullet('课表在哪，先问一下')).toBe(false);
    expect(looksLikeBullet('')).toBe(false);
  });

  it('去掉符号后内容不丢', () => {
    expect(stripBullet('- 先看课表')).toBe('先看课表');
    expect(stripBullet('2、第二条')).toBe('第二条');
    expect(stripBullet('呆文本')).toBe('呆文本');
  });
});

describe('looksLikeCode', () => {
  it('代码记号命中', () => {
    expect(looksLikeCode('const a = 1;')).toBe(true);
    expect(looksLikeCode('def main():\n  pass')).toBe(true);
    expect(looksLikeCode('<div class="x">')).toBe(true);
  });

  it('正文不误判', () => {
    expect(looksLikeCode('今天把课表整理了一遍，顺便记了笔记')).toBe(false);
  });
});

describe('paragraphsToMarkdown', () => {
  it('正文按段落输出，段间空行', () => {
    const md = paragraphsToMarkdown(['第一段内容。', '第二段内容。']);
    expect(md).toBe('第一段内容。\n\n第二段内容。\n');
  });

  it('清单段落整体转成 - 列表', () => {
    const md = paragraphsToMarkdown(['- 课表\n- 作业\n- 复习'], { kind: 'list' });
    expect(md).toBe('- 课表\n- 作业\n- 复习\n');
  });

  it('只有单行带序号时不把整段当清单', () => {
    const md = paragraphsToMarkdown(['1. 这是正文里的编号\n后面接着解释这句话']);
    expect(md).toContain('1. 这是正文里的编号');
    expect(md).not.toMatch(/^- /m);
  });

  it('代码类型包成代码块', () => {
    const md = paragraphsToMarkdown(['int main() { return 0; }'], { kind: 'code' });
    expect(md).toBe('```\nint main() { return 0; }\n```\n');
  });

  it('正文里自带三反引号时围栏加长，不提前闭合', () => {
    const md = paragraphsToMarkdown(['说明\n```\n示例\n```'], { kind: 'code' });
    expect(md.startsWith('````')).toBe(true);
  });

  it('标题与页脚各自成块', () => {
    const md = paragraphsToMarkdown(['正文'], { title: '课表截图', footer: '本地识别 · stillframe' });
    expect(md).toBe('# 课表截图\n\n正文\n\n> 本地识别 · stillframe\n');
  });

  it('空段落被跳过，全空时输出空串', () => {
    expect(paragraphsToMarkdown(['', '   ', '有字'])).toBe('有字\n');
    expect(paragraphsToMarkdown([])).toBe('');
  });
});
