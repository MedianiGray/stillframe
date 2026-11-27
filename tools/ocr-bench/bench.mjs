/**
 * OCR 段落还原率基准。
 *
 * 干什么：拿 `make-pages.py` 画出来的三张图跑真实 OCR（和网页端同一套 fast 语言包），
 * 过一遍 `groupParagraphs`，再和写死的真值段落比对，算出「段落还原率」。
 *
 * 为什么这么算：验收目标写的是「三页中英混排文档段落还原正确率 ≥85%」。
 * 这里把「还原」定义成一个能复算的数：真值段落有多少字被 OCR 完整地归进同一段。
 * 具体是每段真值去 OCR 段里找最长公共子序列（字符级、去空白去标点），
 * 取最好的一条，累加除以真值总字数。串段、断错段都会掉分，认错的字也会掉分。
 *
 * 跑法：npm run ocr-bench
 */

import { createWorker } from 'tesseract.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupParagraphs } from './lib/paragraphs.js';
import { detectColumns } from './lib/columns.js';
import { cropPpm, downscale, readPpm } from './ppm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const TESSDATA = path.join(REPO, 'public', 'tessdata');

/** 标点不进分数：OCR 常把全角逗号读成半角，那不该算段落还原失败。 */
const PUNCT = /[，。、；：！？""''（）《》〈〉…—·．,.;:!?()"'[\]{}<>|/\\\-+=*#·]/g;
const normalize = (text) => text.replace(/\s+/g, '').replace(PUNCT, '');

/** 字符级最长公共子序列长度，O(n*m)，段落这个量级足够。 */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let prev = new Array(m + 1).fill(0);
  let cur = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[m];
}

/**
 * 单页比对。两个方向都算，缺一个都能自欺：
 * recall：每段真值有多少字被完整归进某一段（漏字、错字、段被切碎都会掉）。
 * purity：每个 OCR 段有多纯——它的字有多少来自同一段真值（两段被并成一段时 recall 满分、
 *          purity 直接掉下来，这正是只看 recall 会漏掉的错法）。
 */
function compare(truth, ocr) {
  const normTruth = truth.map(normalize);
  const normOcr = ocr.map(normalize);
  let matched = 0;
  let total = 0;
  let exact = 0;
  const detail = [];

  for (let i = 0; i < truth.length; i += 1) {
    const want = normTruth[i];
    total += want.length;
    let best = 0;
    for (const candidate of normOcr) {
      const hit = lcs(want, candidate);
      if (hit > best) best = hit;
    }
    matched += best;
    const ratio = want.length === 0 ? 1 : best / want.length;
    if (ratio >= 0.95) exact += 1;
    detail.push({ truth: truth[i].slice(0, 22), recall: Number(ratio.toFixed(3)) });
  }

  let pure = 0;
  let ocrChars = 0;
  let pureSum = 0;
  let ocrSum = 0;
  for (const line of normOcr) {
    ocrChars += line.length;
    let best = 0;
    for (const want of normTruth) {
      const hit = lcs(want, line);
      if (hit > best) best = hit;
    }
    pure += best;
  }
  // 纯度按字数加权累计，页与页之间不能用平均糊过去：短页的一次串段被长页稀释才对

  return {
    recall: total === 0 ? 1 : matched / total,
    purity: ocrChars === 0 ? 1 : pure / ocrChars,
    pure,
    ocrChars,
    matched,
    chars: total,
    exact,
    truthCount: truth.length,
    ocrCount: ocr.length,
    detail,
  };
}

async function main() {
  const truth = JSON.parse(await readFile(path.join(HERE, 'pages', 'truth.json'), 'utf8'));
  const cachePath = path.join(tmpdir(), 'stillframe-ocr-bench');
  await mkdir(cachePath, { recursive: true });

  // 和网页端同一套参数：fast 语言包、gzip、默认 OEM。
  const worker = await createWorker('chi_sim+eng', 1, {
    langPath: TESSDATA,
    gzip: true,
    cachePath,
    logger: () => {},
  });

  const pages = [];
  const work = path.join(tmpdir(), 'stillframe-ocr-bench');
  try {
    for (const [file, page] of Object.entries(truth)) {
      // 和网页端同一条路：先用像素找栏，是双栏就逐栏裁开再识别，不是就整图识别。
      const ppmPath = path.join(HERE, 'pages', 'ppm', file.replace('.png', '.ppm'));
      const image = readPpm(ppmPath);
      // 网页端在 900 宽的缩略图上找栏，这里照做，切口再按比例换算回原图
      const probe = downscale(image, 900);
      const probeBands = detectColumns(probe);
      const ratio = image.width / probe.width;
      const bands =
        probeBands.length <= 1
          ? [{ x0: 0, x1: image.width }]
          : probeBands.map((band) => ({
              x0: Math.round(band.x0 * ratio),
              x1: Math.round(band.x1 * ratio),
            }));
      const recognized = [];

      if (bands.length > 1) {
        for (let i = 0; i < bands.length; i += 1) {
          const cropPath = path.join(work, `${file}-band${i}.ppm`);
          cropPpm(image, bands[i].x0, bands[i].x1, cropPath);
          recognized.push({ offsetX: bands[i].x0, result: await worker.recognize(cropPath) });
        }
      } else {
        recognized.push({ offsetX: 0, result: await worker.recognize(ppmPath) });
      }

      const lines = recognized
        .flatMap(({ offsetX, result }) =>
          (result.data.lines ?? []).map((line) => ({
            text: line.text ?? '',
            x0: (line.bbox?.x0 ?? 0) + offsetX,
            y0: line.bbox?.y0 ?? 0,
            y1: line.bbox?.y1 ?? 0,
            words: (line.words ?? []).map((word) => ({
              text: word.text ?? '',
              x0: word.bbox?.x0 ?? 0,
              x1: word.bbox?.x1 ?? 0,
            })),
          })),
        )
        .filter((line) => line.text.trim().length > 0 && line.y1 > line.y0);

      const paragraphs = groupParagraphs(lines);
      const scored = compare(page.paragraphs, paragraphs);
      pages.push({
        file,
        title: page.title,
        bands: bands.length,
        lines,
        paragraphs,
        ...scored,
      });
      const pct = (scored.recall * 100).toFixed(1);
      console.log(
        `${file}: 栏=${bands.length} 行=${lines.length} 段=${paragraphs.length}/真值${scored.truthCount} ` +
          `还原率=${pct}% 纯度=${(scored.purity * 100).toFixed(1)}% 整段正确=${scored.exact}/${scored.truthCount}`,
      );
      for (const row of scored.detail) {
        console.log(`    ${(row.recall * 100).toFixed(1).padStart(5)}%  ${row.truth}…`);
      }
      const wantDump = process.env.DUMP === '1' || process.env.DUMP === file;
      if (wantDump) {
        console.log(JSON.stringify({ lines, paragraphs }, null, 1));
      }
    }
  } finally {
    await worker.terminate();
  }

  const totalTruth = pages.reduce((sum, page) => sum + page.truthCount, 0);
  const totalExact = pages.reduce((sum, page) => sum + page.exact, 0);
  const totalMatched = pages.reduce((sum, page) => sum + page.matched, 0);
  const totalChars = pages.reduce((sum, page) => sum + page.chars, 0);
  const totalPure = pages.reduce((sum, page) => sum + page.pure, 0);
  const totalOcrChars = pages.reduce((sum, page) => sum + page.ocrChars, 0);
  const overall = totalChars === 0 ? 1 : totalMatched / totalChars;
  const overallPurity = totalOcrChars === 0 ? 1 : totalPure / totalOcrChars;
  const PASS = 0.85;
  const pass = overall >= PASS && overallPurity >= PASS;

  const report = {
    generatedAt: new Date().toISOString(),
    engine: 'tesseract.js chi_sim+eng fast',
    metric: 'recall=真值段落被完整归段的比例（字级）；purity=OCR 段落纯度，用来抓串段',
    overallRecall: Number(overall.toFixed(4)),
    overallPurity: Number(overallPurity.toFixed(4)),
    exactParagraphs: `${totalExact}/${totalTruth}`,
    pass,
    pages: pages.map(({ lines, paragraphs, detail, matched, chars, ...rest }) => ({
      ...rest,
      recall: Number(rest.recall.toFixed(4)),
      purity: Number(rest.purity.toFixed(4)),
      lines: lines.length,
      ocrCount: paragraphs.length,
      chars,
    })),
  };

  await writeFile(path.join(HERE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `\n总体还原率 ${(overall * 100).toFixed(1)}%，段落纯度 ${(overallPurity * 100).toFixed(1)}%，` +
      `整段正确 ${totalExact}/${totalTruth}，${pass ? '达到 85% 目标' : '未达 85% 目标'}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
