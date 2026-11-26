import { useMemo, useRef, useState } from 'react';
import { Copy, Minus, Pin, Plus, X } from 'lucide-react';
import { useToast } from './Toasts';

export interface PinItem {
  id: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

interface PinLayerProps {
  pins: PinItem[];
  onClose: (id: string) => void;
}

export function PinLayer({ pins, onClose }: PinLayerProps) {
  const toast = useToast();

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div className="absolute inset-0">
        {pins.map((pin, order) => (
          <PinCard
            key={pin.id}
            pin={pin}
            order={order}
            onClose={() => onClose(pin.id)}
            onCopy={async () => {
              try {
                const response = await fetch(pin.dataUrl);
                const blob = await response.blob();
                if (typeof ClipboardItem === 'undefined' || !navigator.clipboard) {
                  throw new Error('不支持');
                }
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                toast('贴图已复制', 'ok');
              } catch {
                toast('复制失败，请用下载', 'warn');
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function clampScale(value: number): number {
  return Math.max(0.2, Math.min(4, value));
}

function PinCard({
  pin,
  order,
  onClose,
  onCopy,
}: {
  pin: PinItem;
  order: number;
  onClose: () => void;
  onCopy: () => void;
}) {
  const [pos, setPos] = useState({ x: 24 + order * 18, y: 24 + order * 18 });
  const [scale, setScale] = useState(1);
  const [nat, setNat] = useState({
    w: pin.width && pin.height ? pin.width : 0,
    h: pin.width && pin.height ? pin.height : 0,
  });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startScale: number } | null>(null);

  /** 原始宽高决定基准显示宽度：不超过 360px，也不超过视口 45% 高。 */
  const baseWidth = useMemo(() => {
    if (!nat.w || !nat.h) return 360;
    const cap = Math.min(360, nat.w);
    const maxH = window.innerHeight * 0.45;
    const byHeight = nat.w * (maxH / nat.h);
    return Math.max(80, Math.min(cap, byHeight));
  }, [nat.w, nat.h]);

  const width = Math.round(baseWidth * scale);

  return (
    <div
      className="pointer-events-auto absolute border border-amber/40 bg-ink-900 shadow-pop"
      style={{ left: pos.x, top: pos.y, width }}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-ink-600 bg-ink-850 px-2 py-1"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          setPos({
            x: Math.max(0, Math.min(window.innerWidth - 120, event.clientX - drag.dx)),
            y: Math.max(0, Math.min(window.innerHeight - 80, event.clientY - drag.dy)),
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        <span className="flex items-center gap-1 font-mono text-[10px] tracking-wider text-muted">
          <Pin size={10} /> PIN <span className="text-muted/60">{Math.round(scale * 100)}%</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-muted hover:text-paper"
            aria-label="缩小贴图"
            onClick={() => setScale((value) => clampScale(value * 0.85))}
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            className="text-muted hover:text-paper"
            aria-label="放大贴图"
            onClick={() => setScale((value) => clampScale(value * 1.18))}
          >
            <Plus size={12} />
          </button>
          <button type="button" className="text-muted hover:text-paper" onClick={onCopy} aria-label="复制贴图">
            <Copy size={12} />
          </button>
          <button type="button" className="text-muted hover:text-signal-warn" onClick={onClose} aria-label="关闭贴图">
            <X size={12} />
          </button>
        </div>
      </div>

      <img
        src={pin.dataUrl}
        alt="贴图"
        className="block w-full select-none"
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (!nat.w || !nat.h) setNat({ w: image.naturalWidth, h: image.naturalHeight });
        }}
        onWheel={(event) => {
          event.stopPropagation();
          // 滚轮微调缩放，向上放大、向下缩小。
          setScale((value) => clampScale(value * (event.deltaY > 0 ? 0.94 : 1.06)));
        }}
      />

      {/* 右下角拖拽缩放：按宽度比例换算，保持原图长宽比。 */}
      <div
        className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize border-b border-r border-amber/70 bg-ink-950/80"
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = { startX: event.clientX, startScale: scale };
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize) return;
          const next = resize.startScale + (event.clientX - resize.startX) / Math.max(80, baseWidth);
          setScale(clampScale(next));
        }}
        onPointerUp={() => {
          resizeRef.current = null;
        }}
      />
    </div>
  );
}
