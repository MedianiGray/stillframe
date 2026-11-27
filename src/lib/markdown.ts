import type { ContentKind } from './intent';

/**
 * 取字结果 → Markdown。
 *
 * 为什么要有这一步：识别出的东西留在面板里，用户还得自己整理成能粘进文档的样子。
 * 段落已经有了（`groupParagraphs`），内容类型也已经判过（`detectContent`），
 * 那就顺手把两件事拼起来：正文按段落、清单补 `-`、代码包 ` ``` `、表格按行保留。
 * 不做智能改写——只做「原文结构 → 文档结构」的搬运，识别错字仍由用户自己改。
 */

export interface MarkdownOptions {
  /** 一级标题。不给就不写标题，方便直接粘到已有文档里。 */
  title?: string;
  /** `detectContent` 判出来的类型；缺省按正文处理。 */
  kind?: ContentKind;
  /** 末尾追加一行来源说明（本地识别 · 不上传图片之类），缺省不加。 */
  footer?: string;
}

const BULLET = /^[\s]*([-*•·●○▪]|\d+[.、)]|[①-⑳])[\s]*/;

/** 这一行像不像清单项：有项目符号，或以 1./2. 这类序号开头。 */
export function looksLikeBullet(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return BULLET.test(trimmed);
}

/** 清单项去掉原符号，内容在；渲染时统一换成 Markdown 的 `-`。 */
export function stripBullet(line: string): string {
  return line.trim().replace(BULLET, '').trim();
}

/** 代码段落有没有明显的代码记号——有就包代码块，避免 Markdown 把 `*`、`_` 当语法。 */
export function looksLikeCode(text: string): boolean {
  return /[{};]|=>|<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>|^\s*(def|class|function|import|const|let|var|#include|SELECT|from)\b/m.test(
    text,
  );
}

function wrapCode(paragraph: string): string {
  // 段落里可能自带 ``` 的三反引号正文，围栏加长一层就不会提前闭合
  const fence = paragraph.includes('```') ? '````' : '```';
  return `${fence}\n${paragraph}\n${fence}`;
}

/**
 * 段落数组 → Markdown 文本。清单段落每一行都变成 `- ` 项，其余段落原样成段。
 * 表格目前按「一行一段」输出：Markdown 表格需要列分隔符，识别结果里没有，
 * 硬猜只会错行——宁可给能用的纯文本，也不给坏表格。
 */
export function paragraphsToMarkdown(paragraphs: string[], options: MarkdownOptions = {}): string {
  const blocks: string[] = [];
  if (options.title && options.title.trim()) {
    blocks.push(`# ${options.title.trim()}`);
  }

  const kind = options.kind ?? 'prose';
  const codeMode = kind === 'code';

  for (const raw of paragraphs) {
    const paragraph = raw.replace(/\r\n/g, '\n').trim();
    if (!paragraph) continue;

    const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    if (codeMode || looksLikeCode(paragraph)) {
      blocks.push(wrapCode(lines.join('\n')));
      continue;
    }

    const bullets = lines.filter(looksLikeBullet).length;
    // 过半的行是清单项才整体当清单，单行里出现个「1.」只是正文里的编号
    if (bullets >= Math.max(2, Math.ceil(lines.length * 0.6))) {
      blocks.push(lines.map((line) => `- ${stripBullet(line)}`).join('\n'));
      continue;
    }

    // 正文段落：段内换行保留成两空格断行，段与段之间用空行
    blocks.push(lines.join('  \n'));
  }

  if (options.footer && options.footer.trim()) {
    blocks.push(`> ${options.footer.trim()}`);
  }

  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}
