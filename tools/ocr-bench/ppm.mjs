/**
 * 基准用的 PPM 读写 + 按栏裁切。
 *
 * 为什么走 PPM：网页端裁栏用的是 canvas，Node 这边没有 canvas，也没有 PNG 解码器。
 * 基准脚本要验证的是「同一个 detectColumns + 同样留 2px 的切法」，
 * 那只要能把像素读进来、按同样区间切出来，用什么格式装像素无关紧要。
 * PPM(P6) 是未压缩的三通道裸数据，十来行就能读写；这些文件是派生物，不进仓库。
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** 读 P6 PPM，返回 RGBA（跟 canvas 的 ImageData 一个形状，好直接喂给 detectColumns）。 */
export function readPpm(path) {
  const raw = readFileSync(path);
  // 头部形如 P6\n<width> <height>\n255\n；注释行以 # 开头，这里没有，但仍逐段解析
  const header = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(raw.subarray(0, 64).toString('latin1'));
  if (!header) throw new Error(`不是 P6 PPM：${path}`);
  const width = Number(header[1]);
  const height = Number(header[2]);
  const offset = header[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = offset; i < width * height; i += 1, p += 3) {
    data[i * 4] = raw[p];
    data[i * 4 + 1] = raw[p + 1];
    data[i * 4 + 2] = raw[p + 2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/**
 * 缩到指定宽度（最近邻）。网页端找栏是在 900 宽的缩略图上做的，
 * 基准也照做——否则测的是「另一条路径」，结论不成立。
 */
export function downscale(image, maxWidth) {
  if (image.width <= maxWidth) return image;
  const scale = maxWidth / image.width;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.round(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.round(x / scale));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = image.data[src];
      data[dst + 1] = image.data[src + 1];
      data[dst + 2] = image.data[src + 2];
      data[dst + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * 按 x 区间裁一条竖条，左右各留 pad，返回新的 PPM；tesseract 直接吃文件。
 */export function cropPpm(image, x0, x1, outPath, pad = 2) {
  const left = Math.max(0, x0 + pad);
  const right = Math.min(image.width, x1 - pad);
  const width = Math.max(1, right - left);
  const header = Buffer.from(`P6\n${width} ${image.height}\n255\n`, 'latin1');
  const body = Buffer.alloc(width * image.height * 3);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * image.width + left + x) * 4;
      const dst = (y * width + x) * 3;
      body[dst] = image.data[src];
      body[dst + 1] = image.data[src + 1];
      body[dst + 2] = image.data[src + 2];
    }
  }
  writeFileSync(outPath, Buffer.concat([header, body]));
  return outPath;
}
