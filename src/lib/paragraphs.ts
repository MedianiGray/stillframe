/**
 * OCR 行 → 段落的聚段规则。
 *
 * 单独成文件是为了「能被单独量」：量化脚本只需要纯函数，
 * 不该为了跑一次测准把整个 tesseract worker 一起加载进来。
 */

export interface OcrLineBox {
  text: string;
  x0: number;
  y0: number;
  y1: number;
}

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
const ENDS_WITH_CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]$/;

/** 两行之间该不该断开：行距明显大于中位行高、左侧缩进跳变，或跨到另一列。 */
export function groupParagraphs(lines: OcrLineBox[]): string[] {
  const rows = lines
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.y0 - b.y0);

  if (rows.length === 0) return [];

  const heights = rows.map((row) => Math.max(1, row.y1 - row.y0)).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 20;

  const columns = splitColumns(rows, median);
  // 分成了多列，还要确认它们真是并排的栏：只看 x0 会把「居中标题 + 左对齐正文」也
  // 拆成两列，那样标题会被排到正文后面。两列在纵向大面积重叠，才算并排。
  if (columns.length > 1 && overlapsHorizontally(columns)) {
    return columns.flatMap((column) => groupSingleColumn(column, median));
  }
  return groupSingleColumn(rows, median);
}

/** 按左边界聚类。缩进比三倍行高还夸张，才认为是另一列。 */
function splitColumns(rows: OcrLineBox[], median: number): OcrLineBox[][] {
  const sorted = [...rows].sort((a, b) => a.x0 - b.x0);
  const columns: OcrLineBox[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const column = columns[columns.length - 1];
    if (sorted[i].x0 - column[0].x0 > median * 3) {
      columns.push([sorted[i]]);
    } else {
      column.push(sorted[i]);
    }
  }
  return columns;
}

/** 真的并排吗：两列的纵向跨度有半数以上重叠，才算同一水平带上的两栏。 */
function overlapsHorizontally(columns: OcrLineBox[][]): boolean {
  const span = (column: OcrLineBox[]) => {
    const top = Math.min(...column.map((row) => row.y0));
    const bottom = Math.max(...column.map((row) => row.y1));
    return { top, bottom, length: Math.max(1, bottom - top) };
  };
  const spans = columns.map(span).sort((a, b) => a.top - b.top);
  for (let i = 1; i < spans.length; i += 1) {
    const prev = spans[i - 1];
    const next = spans[i];
    const common = Math.min(prev.bottom, next.bottom) - Math.max(prev.top, next.top);
    if (common / Math.min(prev.length, next.length) > 0.5) return true;
  }
  return false;
}

function groupSingleColumn(input: OcrLineBox[], median: number): string[] {
  // 分列时按 x0 排过序，这里恢复成从上到下的阅读顺序。
  const rows = [...input].sort((a, b) => a.y0 - b.y0);

  const joinLine = (prev: string, next: string) =>
    ENDS_WITH_CJK.test(prev) || CJK.test(next.slice(0, 1)) ? `${prev}${next}` : `${prev} ${next}`;

  const paragraphs: string[] = [];
  let current = rows[0].text;
  let prev = rows[0];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const gap = row.y0 - prev.y1;
    const indent = Math.abs(row.x0 - prev.x0);
    // 阈值贴着行距走。1.4 倍行高是个漂亮数字，但上一段恰好满行时，段间距只剩
    // 「段距 − 行盒余量」，常常不到 1.4 倍，两段就被并成一段（基准里双栏页正是这么掉的纯度）。
    // 行内空隙通常只有 0.2~0.5 倍行高，降到 1.25 倍仍然安全；段首缩进这一路也从 2.2 倍收窄到 1.8 倍，
    // 让「缩进两字」这种最平常的段落信号真正起作用。
    const bigGap = gap > median * 1.25;
    const newIndent = indent > median * 1.8 && gap > median * 0.35;
    // 截图里常见多栏（侧边栏 / 正文 / 详情）：左边界横向跳跃半个行高以上且明显换列，
    // 直接断段，否则两栏的内容会被串成一句。
    const newColumn = indent > median * 6 && Math.abs(gap) <= median * 1.4;
    if (bigGap || newIndent || newColumn) {
      paragraphs.push(current);
      current = row.text;
    } else {
      current = joinLine(current, row.text);
    }
    prev = row;
  }
  paragraphs.push(current);
  return paragraphs;
}

/** 拿不到行坐标时的兜底：按空行切块。 */
export function fallbackParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}
