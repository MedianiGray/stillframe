import { useState } from 'react';
import { Command, HelpCircle, MonitorSmartphone } from 'lucide-react';
import type { ToolMode } from '../lib/types';

interface TopBarProps {
  mode: ToolMode;
  title: string;
  subtitle: string;
}

export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; isTauri?: boolean };
  return Boolean(w.__TAURI_INTERNALS__ || w.isTauri);
}

export function TopBar({ mode, title, subtitle }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const desktop = isDesktopShell();

  return (
    <header className="relative flex h-[52px] shrink-0 items-center justify-between border-b border-ink-600/50 bg-ink-900 px-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] tracking-[0.2em] text-muted">STILLFRAME</span>
        <span className="h-px w-5 bg-ink-600" />
        <h1 className="text-[15px] font-semibold tracking-wide text-paper">{title}</h1>
        <span className="hidden text-[12px] text-muted sm:inline">{subtitle}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 border border-ink-600 px-2 py-1 font-mono text-[10px] tracking-wider text-muted">
          <MonitorSmartphone size={11} />
          {desktop ? 'DESKTOP' : 'WEB'}
        </span>
        <button
          type="button"
          className="btn btn-ghost !px-2 !py-1.5"
          onClick={() => setOpen((v) => !v)}
          aria-label="快捷键与使用说明"
        >
          <HelpCircle size={15} />
        </button>
      </div>

      {open ? (
        <div className="absolute right-3 top-[50px] z-40 w-[360px] animate-rise border border-ink-600 bg-ink-850 p-4 shadow-pop">
          <div className="flex items-center gap-2">
            <Command size={13} className="text-amber" />
            <span className="label">操作说明</span>
          </div>
          <ul className="mt-3 space-y-2 text-[12px] leading-5 text-paper/85">
            <li>点击「开始捕捉」先授权屏幕共享，浏览器每次都会要求确认，这是浏览器安全策略，不是应用缺陷。</li>
            <li>桌面端由系统级接口截屏，不弹授权框，并支持全局快捷键与贴图置顶。</li>
            <li>长图模式需要你在被截的窗口里滚动内容，每滚一屏点一次「追加一屏」。</li>
            <li>取字使用本地 OCR，首次会下载语言包；译屏需要先在设置里配好翻译接口。</li>
            <li>边缘角标为选区手柄，拖动可重画选区；Esc 取消，Enter 确认。</li>
          </ul>
          <p className="mt-3 border-t border-ink-600 pt-2 font-mono text-[10px] text-muted">
            {mode === 'snap' ? 'MODE · SNAP' : mode === 'scroll' ? 'MODE · SCROLL' : mode === 'record' ? 'MODE · RECORD' : mode === 'ocr' ? 'MODE · OCR' : 'MODE · TRANSLATE'}
          </p>
        </div>
      ) : null}
    </header>
  );
}
