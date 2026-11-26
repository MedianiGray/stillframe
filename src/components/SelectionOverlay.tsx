import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { Rect } from '../lib/types';
import { isSelectionUsable, resolveSelection } from '../lib/selection';
import { QQ_TEXT } from '../lib/qqspec';

interface SelectionOverlayProps {
  frame: HTMLCanvasElement;
  hint: string;
  onCancel: () => void;
  onConfirm: (rect: Rect) => void;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/** QQ 的尺寸放大镜：外框 132×152，取景区 117×84，下面是尺寸与色值（ScreenCaptureWnd/MagnifierFrame）。 */
const MAG_W = 132;
const MAG_H = 152;
const MAG_ZOOM = 8;

export function SelectionOverlay({ frame, hint, onCancel, onConfirm }: SelectionOverlayProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [mods, setMods] = useState({ alt: false, shift: false });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [probe, setProbe] = useState<{ hex: string; r: number; g: number; b: number } | null>(null);
  const magRef = useRef<HTMLCanvasElement | null>(null);
  const probeRef = useRef<HTMLCanvasElement | null>(null);
  const dataUrl = useMemo(() => frame.toDataURL('image/png'), [frame]);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rect = useMemo<Rect | null>(() => {
    if (!drag) return null;
    return resolveSelection(drag.startX, drag.startY, drag.currentX, drag.currentY, mods);
  }, [drag, mods]);

  const scaleX = frame.width / Math.max(1, viewport.w);
  const scaleY = frame.height / Math.max(1, viewport.h);

  const toScreen = useCallback(
    (clientX: number, clientY: number) => ({
      x: Math.max(0, Math.min(viewport.w, clientX)),
      y: Math.max(0, Math.min(viewport.h, clientY)),
    }),
    [viewport],
  );

  const commit = useCallback(
    (area: Rect) => {
      // 直线选区（Alt 吸附）允许只有 1px 的另一边，只要长边够长。
      if (!isSelectionUsable(area)) return;
      onConfirm({
        x: Math.round(area.x * scaleX),
        y: Math.round(area.y * scaleY),
        w: Math.max(1, Math.round(area.w * scaleX)),
        h: Math.max(1, Math.round(area.h * scaleY)),
      });
    },
    [onConfirm, scaleX, scaleY],
  );

  /** 放大镜取景 + 像素色号，对应 QQ 的 Camera_Rect_Information / Camera_Color_Information。 */
  useEffect(() => {
    if (!cursor) {
      setProbe(null);
      return;
    }
    const px = Math.min(frame.width - 1, Math.max(0, Math.round(cursor.x * scaleX)));
    const py = Math.min(frame.height - 1, Math.max(0, Math.round(cursor.y * scaleY)));
    const srcW = MAG_W / MAG_ZOOM;
    const srcH = 84 / MAG_ZOOM;
    const sx = Math.max(0, Math.min(frame.width - srcW, px - srcW / 2));
    const sy = Math.max(0, Math.min(frame.height - srcH, py - srcH / 2));

    const mag = magRef.current;
    if (mag) {
      const ctx = mag.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, mag.width, mag.height);
        ctx.drawImage(frame, sx, sy, srcW, srcH, 0, 0, mag.width, mag.height);
      }
    }

    const probeCanvas = probeRef.current ?? document.createElement('canvas');
    probeRef.current = probeCanvas;
    probeCanvas.width = 1;
    probeCanvas.height = 1;
    const pctx = probeCanvas.getContext('2d');
    if (pctx) {
      pctx.drawImage(frame, px, py, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
      setProbe({ hex, r, g, b });
    }
  }, [cursor, frame, scaleX, scaleY]);

  useEffect(() => {
    const syncMods = (event: KeyboardEvent) => {
      setMods({ alt: event.altKey, shift: event.shiftKey });
    };
    const onKey = (event: KeyboardEvent) => {
      syncMods(event);
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter' && rect && isSelectionUsable(rect)) commit(rect);
      if (!probe) return;
      const plainC = event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey;
      const withModifier = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
      // QQ 的提示是「按 c 复制色号」，这里兼容裸按 c 与 Ctrl/Cmd+C 两种习惯。
      if (plainC || withModifier) {
        void navigator.clipboard?.writeText(probe.hex).catch(() => undefined);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => syncMods(event);
    const onBlur = () => setMods({ alt: false, shift: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [commit, onCancel, probe, rect]);

  const full = { x: 0, y: 0, w: viewport.w, h: viewport.h };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const point = toScreen(event.clientX, event.clientY);
    const next = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y };
    dragRef.current = next;
    setDrag(next);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = toScreen(event.clientX, event.clientY);
    setCursor(point);
    const state = dragRef.current;
    if (!state) return;
    const next = { ...state, currentX: point.x, currentY: point.y };
    dragRef.current = next;
    setDrag(next);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const actual = rect ? { w: Math.round(rect.w * scaleX), h: Math.round(rect.h * scaleY) } : null;

  const magLeft = cursor ? (cursor.x + MAG_W + 24 > viewport.w ? cursor.x - MAG_W - 18 : cursor.x + 18) : 0;
  const magTop = cursor ? (cursor.y + MAG_H + 24 > viewport.h ? cursor.y - MAG_H - 18 : cursor.y + 18) : 0;

  return (
    <div
      className="fixed inset-0 z-[70] cursor-crosshair select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => {
        // 只有已经框出可用选区时双击才收口；空白处双击不该直接吞掉整屏。
        if (rect && isSelectionUsable(rect)) commit(rect);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <img
        src={dataUrl}
        alt="屏幕冻结帧"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {rect ? (
        <>
          <div className="pointer-events-none absolute bg-black/55" style={{ left: 0, top: 0, width: '100%', height: rect.y }} />
          <div
            className="pointer-events-none absolute bg-black/55"
            style={{ left: 0, top: rect.y + rect.h, width: '100%', height: Math.max(0, viewport.h - rect.y - rect.h) }}
          />
          <div className="pointer-events-none absolute bg-black/55" style={{ left: 0, top: rect.y, width: rect.x, height: rect.h }} />
          <div
            className="pointer-events-none absolute bg-black/55"
            style={{ left: rect.x + rect.w, top: rect.y, width: Math.max(0, viewport.w - rect.x - rect.w), height: rect.h }}
          />

          <div
            className="pointer-events-none absolute border border-[#12B7F5]"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          >
            {[
              'left-0 top-0',
              'right-0 top-0',
              'bottom-0 left-0',
              'bottom-0 right-0',
            ].map((pos) => (
              <span key={pos} className={`absolute ${pos} h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 bg-[#12B7F5]`} />
            ))}
            {actual ? (
              <span className="absolute -top-[22px] left-0 whitespace-nowrap bg-[#12B7F5] px-1.5 py-0.5 font-mono text-[11px] tabular text-[#04212E]">
                {actual.w} × {actual.h}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/45" />
      )}

      {/* 放大镜：QQ 取景区 117×84 + 尺寸/色号明细 */}
      {cursor ? (
        <div
          className="pointer-events-none absolute overflow-hidden rounded-[2px] bg-[#1B1E22] ring-1 ring-white/15"
          style={{ left: magLeft, top: magTop, width: MAG_W, height: MAG_H }}
        >
          <canvas ref={magRef} width={117} height={84} className="absolute left-[7px] top-[7px] h-[84px] w-[117px]" />
          <div className="absolute left-[7px] top-[93px] h-px w-[117px] bg-white/15" />
          <div className="absolute left-[9px] top-[99px] font-mono text-[11px] text-white/90">
            {actual ? `${actual.w} x ${actual.h}` : `${frame.width} x ${frame.height}`}
          </div>
          <div className="absolute left-[9px] top-[115px] font-mono text-[11px] text-white/70">
            {probe ? `RGB(${probe.r},${probe.g},${probe.b})` : 'RGB(--,--,--)'}
          </div>
          <div className="absolute left-[9px] top-[131px] text-[10px] text-white/45">{QQ_TEXT.altHint}</div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
        <span className="rounded-[2px] border border-white/10 bg-[#1F2226]/90 px-3 py-1.5 text-[11.5px] tracking-wide text-white/80">
          {hint}
        </span>
      </div>

      <div
        className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-[3px] bg-[#1F2226]/95 px-1.5 py-1 ring-1 ring-white/10"
        // 工具条自身要挡住框选：否则按下「完成」会先被根节点当成新选区起点，
        // 把已有选区重置成 0×0，看起来就是按钮点了没反应。
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="flex items-center gap-1 rounded-[2px] px-2 py-1 text-[11.5px] text-white/80 hover:bg-white/10"
          onClick={() => {
            setDrag({ startX: 0, startY: 0, currentX: viewport.w, currentY: viewport.h });
            dragRef.current = { startX: 0, startY: 0, currentX: viewport.w, currentY: viewport.h };
            commit(full);
          }}
        >
          <Maximize2 size={13} /> 整屏
        </button>
        <span className="h-[14px] w-px bg-white/15" />
        <button
          type="button"
          className="flex items-center gap-1 rounded-[2px] px-2 py-1 text-[11.5px] text-white/80 hover:bg-white/10"
          onClick={onCancel}
        >
          <X size={13} /> {QQ_TEXT.exitTip}
        </button>
        <button
          type="button"
          className="rounded-[2px] bg-[#12B7F5] px-2.5 py-1 text-[11.5px] font-medium text-[#04212E] hover:bg-[#3AC5FA] disabled:opacity-40"
          disabled={!rect || !isSelectionUsable(rect)}
          onClick={() => rect && commit(rect)}
        >
          {QQ_TEXT.finish}
        </button>
      </div>
    </div>
  );
}
