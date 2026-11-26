import { downloadBlob } from './image';
import { hostKind, nativeSave, nativeWriteShot } from './desktop';
import { writeToDirectory } from './autosave';

export type SaveMode = 'manual' | 'auto';
export type SaveVia = 'native' | 'directory' | 'download' | 'canceled' | 'failed';

export interface SaveResult {
  ok: boolean;
  via: SaveVia;
  path?: string;
  message?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (value) resolve(value);
      else reject(new Error('无法读取图像数据'));
    };
    reader.onerror = () => reject(new Error('无法读取图像数据'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 统一的保存出口。对应升级项目书 G3：桌面端不再退化成浏览器下载。
 *
 * - 桌面壳：manual 弹系统保存框，auto 静默写入 图片/Stillframe
 * - Android：写入相册 Pictures/Stillframe（系统无弹窗）
 * - 网页：已授权目录则直写，未授权时 manual 退回下载，auto 放弃（不偷偷下载）
 */
export async function saveBlob(blob: Blob, filename: string, mode: SaveMode): Promise<SaveResult> {
  const host = hostKind();

  if (host !== 'web') {
    try {
      const dataUrl = await blobToDataUrl(blob);
      if (host === 'tauri' && mode === 'auto') {
        const path = await nativeWriteShot(dataUrl, filename);
        return { ok: true, via: 'native', path: path ?? undefined };
      }
      const path = await nativeSave(dataUrl, filename);
      if (!path) return { ok: false, via: 'canceled' };
      return { ok: true, via: 'native', path };
    } catch (error) {
      return {
        ok: false,
        via: 'failed',
        message: error instanceof Error ? error.message : '系统保存失败',
      };
    }
  }

  if (await writeToDirectory(blob, filename)) {
    return { ok: true, via: 'directory' };
  }

  if (mode === 'manual') {
    downloadBlob(blob, filename);
    return { ok: true, via: 'download' };
  }

  return { ok: false, via: 'failed', message: '自动保存目录未授权' };
}

/** 把保存结果说成人话，界面与 toast 共用。 */
export function describeSave(result: SaveResult): string {
  if (result.ok) {
    if (result.via === 'native') return result.path ? `已保存到 ${result.path}` : '已保存';
    if (result.via === 'directory') return '已写入自动保存目录';
    return '已下载';
  }
  if (result.via === 'canceled') return '已取消保存';
  return result.message ?? '保存失败';
}
