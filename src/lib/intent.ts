/**
 * 内容判读：识别出文字之后，先说清楚「这是什么」，再给一个默认动作。
 *
 * 为什么不做像素级的版面分析：那一层现在做不到可信，猜错还会误导。
 * 文字已经识别出来的情况下，行结构、语言占比、缩进形态本身就够判断大致类型，
 * 而且每一条判断都能用一句话解释给用户听——这比一个说不清理由的「智能」按钮有用。
 *
 * 约束（对应 docs/SMART-CAPTURE.md 的 L2）：
 * - 有默认但不唯一：只给建议，点不点由用户决定；
 * - 可撤销：不自动复制、不自动翻译、不自动存库；
 * - 说得出理由：summary 里带判断依据，用户能验证。
 */

export type ContentKind = 'code' | 'table' | 'list' | 'prose';
export type ScriptKind = 'zh' | 'en' | 'mixed' | 'num';
export type SuggestedAction = 'copy' | 'translate' | 'keep';

export interface ContentRead {
  kind: ContentKind;
  script: ScriptKind;
  /** 界面上那一句话：检测到什么 */
  summary: string;
  /** 预选动作，仅作建议 */
  suggest: SuggestedAction;
  /** 动作按钮上的字 */
  actionLabel: string;
}

const KIND_LABEL: Record<ContentKind, string> = {
  code: '代码片段',
  table: '表格式文本',
  list: '条目清单',
  prose: '正文',
};

const SCRIPT_LABEL: Record<ScriptKind, string> = {
  zh: '中文',
  en: '英文',
  mixed: '中英混排',
  num: '数字为主',
};

const ACTION_LABEL: Record<SuggestedAction, string> = {
  copy: '复制文字',
  translate: '翻译',
  keep: '保留原图',
};

/** 代码特征行：出现这些记号多半是在抄代码，而不是抄文章。 */
const CODE_MARKS = [
  '{', '}', ';', '=>', 'def ', 'function', 'import ', 'const ', 'let ', 'class ',
  '#include', 'public ', 'private ', 'return ', '()', '</', ');',
];

function countScript(text: string) {
  const han = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const digit = (text.match(/[0-9]/g) ?? []).length;
  return { han, latin, digit };
}

function pickScript(han: number, latin: number, digit: number): ScriptKind {
  const letters = han + latin;
  if (letters < 4 && digit >= 4) return 'num';
  if (letters === 0) return 'num';
  const ratio = han / letters;
  if (ratio >= 0.6) return 'zh';
  if (ratio <= 0.2) return 'en';
  return 'mixed';
}

/** 表格：多数行都能按「两个以上空格 / 制表符」切成同样的列数。 */
function looksTabular(lines: string[]): boolean {
  const split = lines.filter((line) => line.trim().length > 0).map((line) => line.trim().split(/\t|\s{2,}/));
  if (split.length < 3) return false;
  const cols = split.map((cells) => cells.length);
  const multi = cols.filter((n) => n >= 2);
  if (multi.length < split.length * 0.6) return false;
  const counts: Record<number, number> = {};
  for (const n of multi) counts[n] = (counts[n] ?? 0) + 1;
  const topCols = Number(Object.keys(counts).sort((a, b) => counts[Number(b)] - counts[Number(a)])[0]);
  return counts[topCols] >= multi.length * 0.7;
}

function looksLikeCode(lines: string[]): boolean {
  const body = lines.filter((line) => line.trim().length > 0);
  if (body.length < 2) return false;
  const marked = body.filter((line) => CODE_MARKS.some((mark) => line.includes(mark)));
  if (marked.length / body.length < 0.3) return false;
  // 缩进形态也是证据：代码几乎必然有行首空格分层。
  const indented = body.filter((line) => /^\s{2,}/.test(line)).length;
  return indented >= 1 || body.some((line) => /[{};]/.test(line));
}

function looksLikeList(lines: string[]): boolean {
  const body = lines.filter((line) => line.trim().length > 0);
  if (body.length < 3) return false;
  const bullets = body.filter((line) => /^(\s*(?:[-*•·]|\(?\d+[.)]|①|②|③|④|⑤))\s/.test(line));
  return bullets.length >= body.length * 0.5;
}

/**
 * 判读一段识别结果。文字太少、或读不出结构时返回 null——宁可不建议，也不要瞎建议。
 */
export function detectContent(rawText: string): ContentRead | null {
  const text = rawText ?? '';
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 8) return null;

  const lines = text.split(/\r?\n/);
  const bodyLines = lines.filter((line) => line.trim().length > 0);
  const { han, latin, digit } = countScript(text);
  const script = pickScript(han, latin, digit);

  let kind: ContentKind = 'prose';
  if (looksLikeCode(lines)) kind = 'code';
  else if (looksTabular(lines)) kind = 'table';
  else if (looksLikeList(lines)) kind = 'list';

  const suggest: SuggestedAction = script === 'en' && kind !== 'code' ? 'translate' : 'copy';

  const detail: string[] = [];
  if (kind === 'table') {
    const cols = bodyLines.map((line) => line.trim().split(/\t|\s{2,}/).length);
    detail.push(`${bodyLines.length} 行`);
    detail.push(`最多 ${Math.max(...cols)} 列`);
  } else if (kind === 'code') {
    detail.push(`${bodyLines.length} 行`);
    detail.push('保留缩进');
  } else {
    detail.push(`${bodyLines.length} 行`);
    if (compact.length >= 60) detail.push(`${compact.length} 字符`);
  }

  return {
    kind,
    script,
    summary: `${SCRIPT_LABEL[script]}${KIND_LABEL[kind]} · ${detail.join(' · ')}`,
    suggest,
    actionLabel: ACTION_LABEL[suggest],
  };
}
