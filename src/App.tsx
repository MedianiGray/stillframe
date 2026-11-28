import { useEffect, useState } from 'react';
import { AlertTriangle, Keyboard, X } from 'lucide-react';
import { Rail } from './components/Rail';
import { TopBar } from './components/TopBar';
import { CaptureWorkspace } from './components/CaptureWorkspace';
import { LibraryView } from './components/LibraryView';
import { SettingsView } from './components/SettingsView';
import { PinLayer, type PinItem } from './components/PinLayer';
import { loadSettings, saveSettings } from './lib/settings';
import { hostKind, nativeHotkeyStatus, nativeOpenQuick, nativePin, onHostEvent } from './lib/desktop';
import { QQ_TEXT } from './lib/qqspec';
import { useToast } from './components/Toasts';
import type { Settings } from './lib/settings';
import type { ToolMode, ViewId } from './lib/types';

const PIN_LIMIT = 20;

/** 热键没抢到时用中文点名，别让用户面对一个裸模式名。 */
const MODE_LABEL: Record<string, string> = {
  snap: '截图',
  record: '录屏',
  scroll: '长图',
  ocr: '取字',
  translate: '译屏',
  quick: '快捷浮窗',
};

interface HotkeyIssue {
  mode: string;
  keys: string;
}

const TITLES: Record<ToolMode, { title: string; subtitle: string }> = {
  snap: { title: '捕捉台 · 截图', subtitle: '框选、标注、导出一步到位' },
  scroll: { title: '捕捉台 · 长图', subtitle: '滚动采集后自动拼接' },
  record: { title: '捕捉台 · 录屏', subtitle: '区域裁切录制' },
  ocr: { title: '捕捉台 · 取字', subtitle: '本地 OCR' },
  translate: { title: '捕捉台 · 译屏', subtitle: '识别后翻译' },
};

export default function App() {
  const toast = useToast();
  const [view, setView] = useState<ViewId>('capture');
  const [mode, setMode] = useState<ToolMode>('snap');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [pins, setPins] = useState<PinItem[]>([]);
  const [libraryKey, setLibraryKey] = useState(0);
  const [autoStart, setAutoStart] = useState<{ mode: ToolMode; tick: number }>({ mode: 'snap', tick: 0 });
  // 全局热键被别的截图工具先注册时，桌面壳会上报：静默失效比报错更糟。
  const [hotkeyIssues, setHotkeyIssues] = useState<HotkeyIssue[]>([]);
  // 主键被占、壳自己改走备用键（Ctrl+Shift+X）时，把「现在按哪个」说清楚。
  const [hotkeyRemaps, setHotkeyRemaps] = useState<HotkeyIssue[]>([]);

  const bumpLibrary = () => setLibraryKey((n) => n + 1);

  // 桌面壳的全局热键与快捷浮窗都通过事件唤前端：切到对应模式，直接开拍。
  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];

    const handle = (mode: string) => {
      if (!['snap', 'scroll', 'record', 'ocr', 'translate'].includes(mode)) return;
      setView('capture');
      setMode(mode as ToolMode);
      setAutoStart((prev) => ({ mode: mode as ToolMode, tick: prev.tick + 1 }));
    };

    const onConflict = (payload: string) => {
      const [mode, keys] = payload.split('|');
      if (!mode || !keys) return;
      setHotkeyIssues((prev) =>
        prev.some((item) => item.mode === mode && item.keys === keys)
          ? prev
          : [...prev, { mode, keys }],
      );
    };

    const onRemap = (payload: string) => {
      const [mode, keys] = payload.split('|');
      if (!mode || !keys) return;
      setHotkeyRemaps((prev) =>
        prev.some((item) => item.mode === mode && item.keys === keys)
          ? prev
          : [...prev, { mode, keys }],
      );
    };

    void Promise.all([
      onHostEvent('stillframe://shortcut', handle),
      onHostEvent('stillframe://quick', handle),
      onHostEvent('stillframe://shortcut-failed', onConflict),
      onHostEvent('stillframe://shortcut-remap', onRemap),
    ]).then((results) => {
      results.forEach((off) => {
        if (!off) return;
        if (disposed) off();
        else offs.push(off);
      });
    });

    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, []);

  // 热键注册发生在 setup 里，通常早于这里的订阅；主动拉一次当前状态，
  // 否则「主键被占、已换备用键」这条关键信息永远到不了界面。
  useEffect(() => {
    void nativeHotkeyStatus().then((rows) => {
      if (!rows.length) return;
      setHotkeyRemaps(
        rows
          .filter((row) => row.state === 'fallback')
          .map((row) => ({ mode: row.mode, keys: row.keys })),
      );
      setHotkeyIssues(
        rows
          .filter((row) => row.state === 'unavailable')
          .map((row) => ({ mode: row.mode, keys: row.keys })),
      );
    });
  }, []);

  const header =
    view === 'capture'
      ? TITLES[mode]
      : view === 'library'
        ? { title: '图库', subtitle: '本机存下的捕捉记录' }
        : { title: '设置', subtitle: '识别、翻译与导出' };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-950">
      <Rail
        view={view}
        mode={mode}
        onMode={(next) => setMode(next)}
        onView={(next) => setView(next)}
        busy={false}
        onQuick={hostKind() === 'tauri' ? () => void nativeOpenQuick() : undefined}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar mode={mode} title={header.title} subtitle={header.subtitle} />

        {hotkeyRemaps.length > 0 ? (
          <div className="flex items-center gap-2 border-b border-sky-400/20 bg-sky-400/[0.07] px-4 py-1.5 text-[11px] leading-none text-sky-200/85">
            <Keyboard className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              主键被其他程序占着，已自动改用备用键位：
              {hotkeyRemaps
                .map((item) => `${MODE_LABEL[item.mode] ?? item.mode} ${item.keys}`)
                .join('、')}
              ，按这组就能直接开拍
            </span>
            <button
              type="button"
              onClick={() => setHotkeyRemaps([])}
              className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-sky-200/60 transition-colors hover:bg-white/10 hover:text-sky-100"
              title="知道了"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        {hotkeyIssues.length > 0 ? (
          <div className="flex items-center gap-2 border-b border-amber-400/20 bg-amber-400/[0.07] px-4 py-1.5 text-[11px] leading-none text-amber-200/85">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              这些快捷键连备用键位都被占用了：
              {hotkeyIssues
                .map((item) => `${MODE_LABEL[item.mode] ?? item.mode} ${item.keys}`)
                .join('、')}
              。从左侧模式卡或快捷浮窗进入
            </span>
            <button
              type="button"
              onClick={() => setHotkeyIssues([])}
              className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-amber-200/60 transition-colors hover:bg-white/10 hover:text-amber-100"
              title="知道了"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <main className="relative flex min-h-0 flex-1">
          {view === 'capture' ? (
            <CaptureWorkspace
              key={mode}
              mode={mode}
              settings={settings}
              onMode={(next) => setMode(next)}
              autoStart={autoStart}
              onOpenSettings={() => setView('settings')}
              onPin={async (dataUrl, width, height) => {
                try {
                  const pinned = await nativePin(dataUrl, width, height);
                  if (pinned) return;
                } catch (error) {
                  // 桌面壳拒绝（例如到了 20 张上限）时如实提示，不再静默退回页内贴图。
                  toast(error instanceof Error ? error.message : QQ_TEXT.nailLimit, 'warn');
                  return;
                }
                setPins((prev) => {
                  if (prev.length >= PIN_LIMIT) {
                    toast(QQ_TEXT.nailLimit, 'warn');
                    return prev;
                  }
                  return [...prev, { id: `pin_${Date.now()}`, dataUrl, width, height }];
                });
              }}
              onLibraryChanged={bumpLibrary}
              pinCount={pins.length}
            />
          ) : null}

          {view === 'library' ? (
            <LibraryView refreshKey={libraryKey} onOpenCapture={() => setView('capture')} />
          ) : null}

          {view === 'settings' ? (
            <SettingsView
              settings={settings}
              onSave={(next) => {
                saveSettings(next);
                setSettings(next);
              }}
            />
          ) : null}
        </main>
      </div>

      <PinLayer pins={pins} onClose={(id) => setPins((prev) => prev.filter((pin) => pin.id !== id))} />
    </div>
  );
}
