import { useEffect, useState } from 'react';
import { Rail } from './components/Rail';
import { TopBar } from './components/TopBar';
import { CaptureWorkspace } from './components/CaptureWorkspace';
import { LibraryView } from './components/LibraryView';
import { SettingsView } from './components/SettingsView';
import { PinLayer, type PinItem } from './components/PinLayer';
import { loadSettings, saveSettings } from './lib/settings';
import { hostKind, nativeOpenQuick, nativePin, onHostEvent } from './lib/desktop';
import { QQ_TEXT } from './lib/qqspec';
import { useToast } from './components/Toasts';
import type { Settings } from './lib/settings';
import type { ToolMode, ViewId } from './lib/types';

const PIN_LIMIT = 20;

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

    void Promise.all([
      onHostEvent('stillframe://shortcut', handle),
      onHostEvent('stillframe://quick', handle),
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
