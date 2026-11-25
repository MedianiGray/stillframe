import {
  Crop,
  Images,
  Languages,
  ScanText,
  ScrollText,
  Settings as SettingsIcon,
  Video,
} from 'lucide-react';
import type { ToolMode, ViewId } from '../lib/types';

interface RailProps {
  view: ViewId;
  mode: ToolMode;
  onMode: (mode: ToolMode) => void;
  onView: (view: ViewId) => void;
  busy: boolean;
}

const MODES: Array<{ id: ToolMode; label: string; hint: string; icon: typeof Crop }> = [
  { id: 'snap', label: '截图', hint: '区域截图与标注', icon: Crop },
  { id: 'scroll', label: '长图', hint: '滚动拼接长截图', icon: ScrollText },
  { id: 'record', label: '录屏', hint: '区域录制与声音', icon: Video },
  { id: 'ocr', label: '取字', hint: '识别画面文字', icon: ScanText },
  { id: 'translate', label: '译屏', hint: '取字后翻译', icon: Languages },
];

export function Rail({ view, mode, onMode, onView, busy }: RailProps) {
  return (
    <aside className="flex w-[56px] shrink-0 flex-col items-center border-r border-ink-600/50 bg-ink-900 py-3">
      <div className="mb-4 flex h-9 w-9 items-center justify-center border border-amber/40 bg-amber/10">
        <span className="font-mono text-[13px] font-bold text-amber">SF</span>
      </div>

      <nav className="flex flex-col items-center gap-1">
        {MODES.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={`${label} · ${hint}`}
            aria-label={label}
            disabled={busy}
            className={`rail-btn ${view === 'capture' && mode === id ? 'rail-btn-active' : ''} disabled:opacity-40`}
            onClick={() => {
              onView('capture');
              onMode(id);
            }}
          >
            <Icon size={17} strokeWidth={1.7} />
          </button>
        ))}
      </nav>

      <div className="my-3 h-px w-6 bg-ink-600" />

      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          title="图库"
          aria-label="图库"
          className={`rail-btn ${view === 'library' ? 'rail-btn-active' : ''}`}
          onClick={() => onView('library')}
        >
          <Images size={17} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          title="设置"
          aria-label="设置"
          className={`rail-btn ${view === 'settings' ? 'rail-btn-active' : ''}`}
          onClick={() => onView('settings')}
        >
          <SettingsIcon size={17} strokeWidth={1.7} />
        </button>
      </div>

      <div className="mt-auto flex flex-col items-center gap-2">
        <span className="font-mono text-[9px] tracking-[0.18em] text-muted/60 [writing-mode:vertical-rl]">
          STILLFRAME
        </span>
      </div>
    </aside>
  );
}
