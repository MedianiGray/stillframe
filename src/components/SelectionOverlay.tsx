import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Maximize2, X } from 'lucide-react';
import type { Rect } from '../lib/types';

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

export function SelectionOverlay({ frame, hint, onCancel, onConfirm }: SelectionOverlayProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dataUrl = useMemo(() => frame.toDataURL('image/png'), [frame]);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rect = useMemo<Rect | null>(() => {
    if (!drag) return null;
    return {
      x: Math.min(drag.startX, drag.currentX),
      y: Math.min(drag.startY, drag.currentY),
      w: Math.abs(drag.currentX - drag.startX),
      h: Math.abs(drag.currentY - drag.startY),
    };
  }, [drag]);

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
      if (area.w < 6 || area.h < 6) return;
      onConfirm({
        x: Math.round(area.x * scaleX),
        y: Math.round(area.y * scaleY),
        w: Math.round(area.w * scaleX),
        h: Math.round(area.h * scaleY),
      });
    },
    [onConfirm, scaleX, scaleY],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter' && rect && rect.w > 6) commit(rect);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, commit, rect]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const point = toScreen(event.clientX, event.clientY);
    const next = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y };
    dragRef.current = next;
    setDrag(next);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state) return;
    const point = toScreen(event.clientX, event.clientY);
    const next = { ...state, currentX: point.x, currentY: point.y };
    dragRef.current = next;
    setDrag(next);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const actual = rect
    ? { w: Math.round(rect.w * scaleX), h: Math.round(rect.h * scaleY) }
    : null;

  return (
    <div
      className="fixed inset-0 z-[70] cursor-crosshair select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <img
        src={dataUrl}
        alt="屏幕冻结帧"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {rect ? (
        <>
          <div className="pointer-events-none absolute bg-ink-950/62" style={{ left: 0, top: 0, width: '100%', height: rect.y }} />
          <div className="pointer-events-none absolute bg-ink-950/62" style={{ left: 0, top: rect.y + rect.h, width: '100%', height: Math.max(0, viewport.h - rect.y - rect.h) }} />
          <div className="pointer-events-none absolute bg-ink-950/62" style={{ left: 0, top: rect.y, width: rect.x, height: rect.h }} />
          <div className="pointer-events-none absolute bg-ink-950/62" style={{ left: rect.x + rect.w, top: rect.y, width: Math.max(0, viewport.w - rect.x - rect.w), height: rect.h }} />

          <div
            className="pointer-events-none absolute border border-amber"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          >
            <span className="frame-corner -left-px -top-px border-l-2 border-t-2" />
            <span className="frame-corner -right-px -top-px border-r-2 border-t-2" />
            <span className="frame-corner -bottom-px -left-px border-b-2 border-l-2" />
            <span className="frame-corner -bottom-px -right-px border-b-2 border-r-2" />
            {actual ? (
              <span className="absolute -top-7 left-0 bg-ink-900/90 px-1.5 py-0.5 font-mono text-[11px] tabular text-amber">
                {actual.w} × {actual.h}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-ink-950/62" />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center">
        <span className="border border-ink-600 bg-ink-900/90 px-3 py-1.5 font-mono text-[11px] tracking-wide text-paper/80">
          {hint}
        </span>
      </div>

      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 border border-ink-600 bg-ink-900/95 px-2 py-2 shadow-pop">
        <button
          type="button"
          className="btn btn-ghost !py-1.5"
          onClick={() => {
            const full = { x: 0, y: 0, w: viewport.w, h: viewport.h };
            setDrag({ startX: 0, startY: 0, currentX: viewport.w, currentY: viewport.h });
            dragRef.current = { startX: 0, startY: 0, currentX: viewport.w, currentY: viewport.h };
            commit(full);
          }}
        >
          <Maximize2 size={14} /> 整屏
        </button>
        <span className="sprocket w-10 opacity-40" />
        <button type="button" className="btn btn-ghost !py-1.5" onClick={onCancel}>
          <X size={14} /> 取消
        </button>
        <button
          type="button"
          className="btn btn-accent !py-1.5"
          disabled={!rect || rect.w < 6 || rect.h < 6}
          onClick={() => rect && commit(rect)}
        >
          <Check size={14} /> 确认
        </button>
      </div>
    </div>
  );
}
