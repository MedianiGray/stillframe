import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, Trash2, X } from 'lucide-react';
import { getShot, listShots, deleteShot, clearShots } from '../lib/storage';
import { copyBlobToClipboard, downloadBlob, timestampName } from '../lib/image';
import type { ShotMeta, ShotRecord } from '../lib/types';
import { useToast } from './Toasts';

interface LibraryViewProps {
  refreshKey: number;
  onOpenCapture: () => void;
}

export function LibraryView({ refreshKey, onOpenCapture }: LibraryViewProps) {
  const toast = useToast();
  const [items, setItems] = useState<ShotMeta[]>([]);
  const [selected, setSelected] = useState<ShotRecord | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listShots());
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取图库失败', 'warn');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!selected) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(selected.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [selected]);

  const open = async (id: string) => {
    const record = await getShot(id);
    if (record) setSelected(record);
  };

  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-600/50 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="label">本地图库</span>
          <span className="font-mono text-[11px] text-muted">
            {items.length} 项 · {(totalBytes / 1024 / 1024).toFixed(1)} MB
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn !py-1.5 text-[12px]"
            disabled={items.length === 0}
            onClick={async () => {
              if (!window.confirm('清空图库？这会删除本机所有捕捉记录。')) return;
              await clearShots();
              setSelected(null);
              await load();
              toast('图库已清空', 'ok');
            }}
          >
            <Trash2 size={13} /> 清空
          </button>
          <button type="button" className="btn btn-accent !py-1.5 text-[12px]" onClick={onOpenCapture}>
            去捕捉
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center border border-ink-600">
            <span className="font-mono text-[11px] text-muted">EMPTY</span>
          </div>
          <p className="text-[13px] text-muted">还没有存下来的画面</p>
          <button type="button" className="btn btn-accent" onClick={onOpenCapture}>
            截一张试试
          </button>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 overflow-y-auto p-5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="group relative flex flex-col border border-ink-600/60 bg-ink-850 text-left transition-colors hover:border-amber/60"
              onClick={() => open(item.id)}
            >
              <div className="flex h-[120px] items-center justify-center overflow-hidden bg-ink-900">
                {item.thumb ? (
                  <img src={item.thumb} alt="" className="h-full w-full object-cover opacity-90" />
                ) : (
                  <span className="font-mono text-[10px] text-muted">{item.kind === 'video' ? 'VIDEO' : 'IMAGE'}</span>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-ink-600/60 px-2 py-1.5">
                <span className="font-mono text-[10px] text-muted">
                  {new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}
                </span>
                <span className="font-mono text-[10px] text-muted">{(item.bytes / 1024).toFixed(0)}K</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && url ? (
        <div className="absolute inset-0 z-40 flex bg-ink-950/70">
          <div className="ml-auto flex w-[520px] flex-col border-l border-ink-600 bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-600 px-4 py-2.5">
              <span className="font-mono text-[11px] text-muted">
                {selected.kind.toUpperCase()} · {selected.width} × {selected.height}
              </span>
              <button type="button" className="text-muted hover:text-paper" onClick={() => setSelected(null)} aria-label="关闭">
                <X size={15} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-ink-950 p-4">
              {selected.kind === 'video' ? (
                <video src={url} controls className="max-h-full max-w-full" />
              ) : (
                <img src={url} alt="" className="max-h-full max-w-full" />
              )}
            </div>

            {selected.text ? (
              <div className="max-h-[140px] overflow-y-auto border-t border-ink-600 p-3">
                <span className="label">附带的文字</span>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-paper/80">{selected.text}</p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1.5 border-t border-ink-600 p-3">
              <button
                type="button"
                className="btn btn-accent"
                onClick={async () => {
                  try {
                    await copyBlobToClipboard(selected.blob);
                    toast('已复制到剪贴板', 'ok');
                  } catch {
                    toast('该类型不支持直接复制，请下载', 'warn');
                  }
                }}
              >
                <Copy size={14} /> 复制
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => downloadBlob(selected.blob, timestampName('stillframe', selected.kind === 'video' ? 'webm' : 'png'))}
              >
                <Download size={14} /> 下载
              </button>
              <button
                type="button"
                className="btn col-span-2"
                onClick={async () => {
                  await deleteShot(selected.id);
                  setSelected(null);
                  await load();
                  toast('已删除', 'ok');
                }}
              >
                <Trash2 size={14} /> 删除这一项
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
