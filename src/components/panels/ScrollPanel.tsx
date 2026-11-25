import { useEffect, useRef, useState } from 'react';
import { Check, Layers, Plus, RotateCcw, X } from 'lucide-react';
import type { Rect } from '../../lib/types';
import type { ScreenSession } from '../../lib/capture';
import { grabRegion } from '../../lib/capture';
import { stitchVertical } from '../../lib/stitch';
import { useToast } from '../Toasts';

interface ScrollPanelProps {
  seed: HTMLCanvasElement;
  rect: Rect;
  session: ScreenSession;
  onClose: () => void;
  onFinish: (image: HTMLCanvasElement) => void;
}

export function ScrollPanel({ seed, rect, session, onClose, onFinish }: ScrollPanelProps) {
  const toast = useToast();
  const [result, setResult] = useState<HTMLCanvasElement>(seed);
  const [frames, setFrames] = useState(1);
  const [lastOverlap, setLastOverlap] = useState<number | null>(null);
  const [manualOverlap, setManualOverlap] = useState('');
  const [busy, setBusy] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    holder.replaceChildren(result);
    result.className = 'max-h-full max-w-full object-contain shadow-stage';
    result.style.width = 'auto';
    result.style.height = 'auto';
  }, [result]);

  const append = () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = grabRegion(session.video, rect);
      const manual = manualOverlap.trim() ? Number(manualOverlap) : undefined;
      const stitched = stitchVertical(result, next, {
        autoDetect: manual === undefined,
        overlap: manual,
      });
      setResult(stitched.canvas);
      setFrames((n) => n + 1);
      setLastOverlap(stitched.overlap);
      if (manual === undefined && stitched.overlap === 0) {
        toast('没找到重叠区，按无重叠直接接上了，可用手动重叠再试', 'warn');
      } else {
        toast(`拼接成功，重叠 ${stitched.overlap}px`, 'ok');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '追加失败', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(seed);
    setFrames(1);
    setLastOverlap(null);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="stage-grid relative flex min-w-0 flex-1 items-center justify-center overflow-auto p-6">
        <div ref={holderRef} className="flex max-h-full items-center justify-center" />
        <div className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] tracking-wider text-muted/70">
          {result.width} × {result.height} PX · {frames} 屏
        </div>
      </div>

      <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-ink-600/50 bg-ink-900">
        <div className="border-b border-ink-600/50 p-4">
          <div className="flex items-center gap-2">
            <Layers size={13} className="text-amber" />
            <span className="label">滚动拼接</span>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            现在切到你要截的窗口，把它滚动一屏，然后回到这里点「追加一屏」。重复到内容截完为止。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button type="button" className="btn btn-accent" disabled={busy} onClick={append}>
              <Plus size={14} /> 追加一屏
            </button>
            <button type="button" className="btn" disabled={busy || frames === 1} onClick={reset}>
              <RotateCcw size={14} /> 重来
            </button>
          </div>
          {lastOverlap !== null ? (
            <p className="mt-2 font-mono text-[11px] text-muted">上次重叠 {lastOverlap}px</p>
          ) : null}
        </div>

        <div className="border-b border-ink-600/50 p-4">
          <span className="label">手动重叠（可选）</span>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="field !py-1.5"
              inputMode="numeric"
              placeholder="例如 120，留空为自动"
              value={manualOverlap}
              onChange={(event) => setManualOverlap(event.target.value.replace(/[^\d]/g, ''))}
            />
            <span className="font-mono text-[11px] text-muted">px</span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            自动匹配在纯色区域可能失败。此时手动填入两屏之间的重复高度，通常是一屏高度的 10%–30%。
          </p>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => {
                session.stop();
                onFinish(result);
              }}
            >
              <Check size={14} /> 完成拼接
            </button>
            <button type="button" className="btn" onClick={onClose}>
              <X size={14} /> 放弃
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted">
            完成后会进入标注台，可继续加箭头、马赛克或文字，再导出。
          </p>
        </div>
      </aside>
    </div>
  );
}
