import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';

type ToastKind = 'ok' | 'warn' | 'info';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type PushToast = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<PushToast>(() => undefined);

export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback<PushToast>((message, kind = 'info') => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev.slice(-3), { id, message, kind }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, kind === 'warn' ? 5200 : 3200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex w-[min(560px,90vw)] -translate-x-1/2 flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex animate-rise items-start gap-3 border border-ink-600 bg-ink-800/95 px-3 py-2.5 shadow-pop backdrop-blur"
          >
            <span className="mt-0.5 shrink-0">
              {item.kind === 'ok' ? (
                <Check size={14} className="text-signal-ok" />
              ) : item.kind === 'warn' ? (
                <AlertTriangle size={14} className="text-signal-warn" />
              ) : (
                <Info size={14} className="text-muted" />
              )}
            </span>
            <p className="flex-1 text-[12.5px] leading-5 text-paper/90">{item.message}</p>
            <button
              type="button"
              aria-label="关闭提示"
              className="text-muted hover:text-paper"
              onClick={() => setItems((prev) => prev.filter((row) => row.id !== item.id))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
