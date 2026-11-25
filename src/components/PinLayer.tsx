import { useRef, useState } from 'react';
import { Copy, Pin, X } from 'lucide-react';
import { useToast } from './Toasts';

export interface PinItem {
  id: string;
  dataUrl: string;
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
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  return (
    <div
      className="pointer-events-auto absolute border border-amber/40 bg-ink-900 shadow-pop"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-ink-600 bg-ink-850 px-2 py-1"
        onPointerDown={(event) => {
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
          <Pin size={10} /> PIN
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className="text-muted hover:text-paper" onClick={onCopy} aria-label="复制贴图">
            <Copy size={12} />
          </button>
          <button type="button" className="text-muted hover:text-signal-warn" onClick={onClose} aria-label="关闭贴图">
            <X size={12} />
          </button>
        </div>
      </div>
      <img src={pin.dataUrl} alt="贴图" className="block max-h-[45vh] max-w-[360px] object-contain" draggable={false} />
    </div>
  );
}
