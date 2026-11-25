import { useState } from 'react';
import { Rail } from './components/Rail';
import { TopBar } from './components/TopBar';
import { CaptureWorkspace } from './components/CaptureWorkspace';
import { LibraryView } from './components/LibraryView';
import { SettingsView } from './components/SettingsView';
import { PinLayer, type PinItem } from './components/PinLayer';
import { loadSettings, saveSettings } from './lib/settings';
import { nativePin } from './lib/desktop';
import type { Settings } from './lib/settings';
import type { ToolMode, ViewId } from './lib/types';

const TITLES: Record<ToolMode, { title: string; subtitle: string }> = {
  snap: { title: '捕捉台 · 截图', subtitle: '框选、标注、导出一步到位' },
  scroll: { title: '捕捉台 · 长图', subtitle: '滚动采集后自动拼接' },
  record: { title: '捕捉台 · 录屏', subtitle: '区域裁切录制' },
  ocr: { title: '捕捉台 · 取字', subtitle: '本地 OCR' },
  translate: { title: '捕捉台 · 译屏', subtitle: '识别后翻译' },
};

export default function App() {
  const [view, setView] = useState<ViewId>('capture');
  const [mode, setMode] = useState<ToolMode>('snap');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [pins, setPins] = useState<PinItem[]>([]);
  const [libraryKey, setLibraryKey] = useState(0);

  const bumpLibrary = () => setLibraryKey((n) => n + 1);

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
              onOpenSettings={() => setView('settings')}
              onPin={async (dataUrl) => {
                try {
                  const pinned = await nativePin(dataUrl);
                  if (pinned) return;
                } catch {
                  // fall through to in-app pin
                }
                setPins((prev) => [...prev.slice(-2), { id: `pin_${Date.now()}`, dataUrl }]);
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
