import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRightLeft,
  Check,
  Copy,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Share2,
  X,
} from 'lucide-react';
import type { Rect } from '../../lib/types';
import type { ScreenSession } from '../../lib/capture';
import { grabRegion } from '../../lib/capture';
import { stitchHorizontal, stitchVertical } from '../../lib/stitch';
import { judgeScroll, sampledDifference, wheelNotches, type ScrollSample } from '../../lib/autoscroll';
import { hostKind, nativeScroll } from '../../lib/desktop';
import { canvasToBlob, copyBlobToClipboard, downloadBlob, timestampName } from '../../lib/image';
import { QQ_TEXT } from '../../lib/qqspec';
import { useToast } from '../Toasts';

interface ScrollPanelProps {
  seed: HTMLCanvasElement;
  rect: Rect;
  session: ScreenSession;
  onClose: () => void;
  onFinish: (image: HTMLCanvasElement) => void;
}

const BTN =
  'flex h-[30px] w-[30px] items-center justify-center rounded-[2px] text-[#D6DBE0] transition-colors hover:bg-white/10 disabled:opacity-35';
const BTN_ON = 'bg-[#12B7F5]/22 text-[#5FD3FF] ring-1 ring-[#12B7F5]/60';

export function ScrollPanel({ seed, rect, session, onClose, onFinish }: ScrollPanelProps) {
  const toast = useToast();
  const [result, setResult] = useState<HTMLCanvasElement>(seed);
  const [frames, setFrames] = useState(1);
  const [lastOverlap, setLastOverlap] = useState<number | null>(null);
  const [manualOverlap, setManualOverlap] = useState('');
  const [direction, setDirection] = useState<'v' | 'h'>('v');
  const [autoScroll, setAutoScroll] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef(seed);
  const runningRef = useRef(false);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    holder.replaceChildren(result);
    result.className = 'max-h-full max-w-full object-contain shadow-stage';
    result.style.width = 'auto';
    result.style.height = 'auto';
  }, [result]);

  // 卸载时别把自动滚动留在后台继续注入滚轮。
  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

  const applyStitched = (canvas: HTMLCanvasElement, overlap: number) => {
    resultRef.current = canvas;
    setResult(canvas);
    setFrames((n) => n + 1);
    setLastOverlap(overlap);
  };

  const append = () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = grabRegion(session.video, rect);
      const manual = manualOverlap.trim() ? Number(manualOverlap) : undefined;
      const stitch = direction === 'v' ? stitchVertical : stitchHorizontal;
      const stitched = stitch(resultRef.current, next, { autoDetect: manual === undefined, overlap: manual });
      applyStitched(stitched.canvas, stitched.overlap);
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

  /** 隐藏自身 → 注入滚轮 → 抓帧拼接 → 判定，直到到底或该回退手动。 */
  const runAuto = async () => {
    if (busy || runningRef.current) return;
    if (hostKind() !== 'tauri') {
      toast('自动滚动需要向目标窗口发送滚轮事件，仅桌面壳支持；网页端请手动滚动后点追加', 'warn');
      return;
    }
    if (direction !== 'v') {
      toast('自动滚动目前只做竖向，横向请手动滚动后点追加', 'warn');
      return;
    }

    runningRef.current = true;
    setAutoScroll(true);
    setBusy(true);
    const notches = wheelNotches(rect.h);
    let base = resultRef.current;
    let lastFrame = grabRegion(session.video, rect);
    const samples: ScrollSample[] = [];
    try {
      for (let frame = 0; frame < 30 && runningRef.current; frame += 1) {
        await nativeScroll(rect.x + rect.w / 2, rect.y + rect.h / 2, notches);
        // 原生会话 320ms 抓一次帧，等它刷新并让目标窗口滚稳。
        await new Promise((r) => setTimeout(r, 620));
        const next = grabRegion(session.video, rect);
        const stitched = stitchVertical(base, next);
        samples.push({ overlap: stitched.overlap, difference: sampledDifference(lastFrame, next) });
        if (stitched.overlap > 0 && stitched.canvas.height > base.height) {
          base = stitched.canvas;
          applyStitched(base, stitched.overlap);
        }
        lastFrame = next;

        const verdict = judgeScroll(samples);
        if (verdict === 'end') {
          toast(`已滚到底，共 ${samples.length} 屏，自动滚动结束`, 'ok');
          break;
        }
        if (verdict === 'fallback') {
          setShowManual(true);
          toast('滚过去没找到重叠区，已停下：请手动滚动一屏并填写重叠像素', 'warn');
          break;
        }
      }
    } catch (error) {
      setShowManual(true);
      toast(
        `${error instanceof Error ? error.message : '自动滚动失败'}；已切换为手动追加，滚动后点加号即可`,
        'warn',
      );
    } finally {
      runningRef.current = false;
      setAutoScroll(false);
      setBusy(false);
    }
  };

  const reset = () => {
    resultRef.current = seed;
    setResult(seed);
    setFrames(1);
    setLastOverlap(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      const blob = await canvasToBlob(result, 'png');
      downloadBlob(blob, timestampName('stillframe-long', 'png'));
      toast('长截图已保存', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setBusy(true);
    try {
      const blob = await canvasToBlob(result, 'png');
      await copyBlobToClipboard(blob);
      toast(QQ_TEXT.copyDone, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败', 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-ink-950">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-6 pb-16">
        <div ref={holderRef} className="flex max-h-full items-center justify-center" />
        <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 font-mono text-[10px] tracking-wider text-muted/70">
          <span className="border border-white/10 bg-black/40 px-1.5 py-0.5 text-paper/70">{QQ_TEXT.longTool}</span>
          <span>
            {result.width} × {result.height} · {frames} 屏
          </span>
          {lastOverlap !== null ? <span className="text-muted/50">重叠 {lastOverlap}px</span> : null}
        </div>
      </div>

      {/* QQ 长截图工具栏：方向选择 / 自动滚动 / 编辑 / 转发 / 保存 / 退出 / 完成 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-0.5 rounded-[3px] bg-[#1F2226]/95 px-1.5 py-1 shadow-[0_6px_22px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
          <button
            type="button"
            title="选择滚动方向"
            className={`${BTN} ${direction === 'v' ? BTN_ON : ''}`}
            onClick={() => setDirection((d) => (d === 'v' ? 'h' : 'v'))}
          >
            {direction === 'v' ? <ArrowDownUp size={16} strokeWidth={1.7} /> : <ArrowRightLeft size={16} strokeWidth={1.7} />}
          </button>
          <button type="button" title="追加一屏" className={`${BTN} bg-white/5`} disabled={busy} onClick={append}>
            <Plus size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            title={autoScroll ? '正在自动滚动' : '自动滚动（桌面壳，网页端不可用）'}
            className={`${BTN} ${autoScroll ? BTN_ON : ''}`}
            disabled={busy}
            onClick={() => void runAuto()}
          >
            <Layers size={16} strokeWidth={1.7} />
          </button>
          <button type="button" title="手动重叠" className={BTN} onClick={() => setShowManual((v) => !v)}>
            <RotateCcw size={16} strokeWidth={1.7} />
          </button>

          <span className="mx-1 h-[16px] w-px bg-white/15" />

          <button type="button" title={QQ_TEXT.ocrEdit} className={BTN} onClick={() => onFinish(result)}>
            <Pencil size={16} strokeWidth={1.7} />
          </button>
          <button type="button" title={QQ_TEXT.transfer} className={BTN} onClick={() => void copy()}>
            <Share2 size={16} strokeWidth={1.7} />
          </button>
          <button type="button" title={QQ_TEXT.saveTip} className={BTN} onClick={() => void save()}>
            <Save size={16} strokeWidth={1.7} />
          </button>

          <span className="mx-1 h-[16px] w-px bg-white/15" />

          <button type="button" title={QQ_TEXT.exitTip} className={BTN} onClick={onClose}>
            <X size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            title={QQ_TEXT.transfer}
            className="ml-0.5 flex h-[30px] items-center gap-1 rounded-[2px] bg-[#12B7F5] px-2.5 text-[12px] font-medium text-[#04212E] hover:bg-[#3AC5FA]"
            onClick={() => {
              session.stop();
              onFinish(result);
            }}
          >
            <Check size={14} strokeWidth={2.2} />
            {QQ_TEXT.finish}
          </button>
        </div>

        {showManual ? (
          <div className="mt-1.5 flex items-center gap-2 rounded-[3px] bg-[#1F2226]/95 px-2 py-1.5 ring-1 ring-white/10">
            <span className="text-[11px] text-[#98A2AC]">手动重叠</span>
            <input
              className="w-[92px] rounded-[2px] border border-white/15 bg-black/30 px-1.5 py-1 font-mono text-[11px] text-white outline-none"
              inputMode="numeric"
              placeholder="自动"
              value={manualOverlap}
              onChange={(event) => setManualOverlap(event.target.value.replace(/[^\d]/g, ''))}
            />
            <span className="font-mono text-[11px] text-[#98A2AC]">px</span>
            <button type="button" className="text-[11px] text-[#5FD3FF]" onClick={reset}>
              重来
            </button>
            <button type="button" className="text-[11px] text-[#98A2AC] hover:text-white" onClick={() => void copy()}>
              <Copy size={12} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
