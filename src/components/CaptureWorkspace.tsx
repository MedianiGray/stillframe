import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Crop, Languages, ScanText, ScrollText, ShieldAlert, Video } from 'lucide-react';
import type { Rect, ToolMode } from '../lib/types';
import type { Settings } from '../lib/settings';
import { cropCanvas } from '../lib/image';
import { grabFrame, openNativeSession, openScreenSession, type ScreenSession } from '../lib/capture';
import { hostKind, isDesktop, nativeCaptureScreen } from '../lib/desktop';
import { useToast } from './Toasts';
import { SelectionOverlay } from './SelectionOverlay';
import { Editor } from './Editor';
import { ScrollPanel } from './panels/ScrollPanel';
import { RecordPanel } from './panels/RecordPanel';
import { OcrPanel } from './panels/OcrPanel';
import { TranslatePanel } from './panels/TranslatePanel';

interface WorkspaceProps {
  mode: ToolMode;
  settings: Settings;
  onMode: (mode: ToolMode) => void;
  onOpenSettings: () => void;
  onPin: (dataUrl: string, width: number, height: number) => void;
  onLibraryChanged: () => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'selecting'; mode: ToolMode; frame: HTMLCanvasElement; session: ScreenSession | null }
  | { kind: 'edit'; image: HTMLCanvasElement; rect: Rect }
  | { kind: 'scroll'; image: HTMLCanvasElement; rect: Rect; session: ScreenSession }
  | { kind: 'record'; rect: Rect; session: ScreenSession }
  | { kind: 'ocr'; image: HTMLCanvasElement }
  | { kind: 'translate'; image: HTMLCanvasElement };

const MODE_META: Record<
  ToolMode,
  { title: string; tagline: string; detail: string; keys: string[]; icon: typeof Crop; accent: string }
> = {
  snap: {
    title: '区域截图',
    tagline: '框一块屏幕，立刻落笔标注',
    detail: '冻结当前画面后自由框选，随后进入标注台：矩形、椭圆、箭头、画刷、马赛克、文字、序号笔，配 12 色 QQ 原值色板、三档线宽与 12 款滤镜，一次成图。',
    keys: ['框选时带 8 倍放大镜与色号', '工具栏顺序对齐 QQ 截图', '导出 PNG / JPEG 并可复制到剪贴板'],
    icon: Crop,
    accent: 'Ctrl + Alt + S',
  },
  scroll: {
    title: '滚动长图',
    tagline: '一边滚，一边把画面缝起来',
    detail: '锁定一个区域后，你在目标窗口里滚动内容，每滚一屏点一次追加，程序自动寻找重叠行并拼接成整页长图；纵向、横向都成立。',
    keys: ['按行特征自动对重叠', '可手动指定重叠像素', '拼接结果可继续标注导出'],
    icon: ScrollText,
    accent: 'Ctrl + Alt + C',
  },
  record: {
    title: '区域录屏',
    tagline: '只录你要的那一块',
    detail: '框定区域后按帧裁切录制，可同时收录系统声音与麦克风；录制中用 QQ 录屏条那六件套边讲边画，标注会合进成片。',
    keys: ['区域裁切录制', '系统声 + 麦克风混音', '录制中可标注、可激光笔'],
    icon: Video,
    accent: 'Ctrl + Alt + R',
  },
  ocr: {
    title: '提取文字',
    tagline: '画面里的字，直接变成可选文本',
    detail: '对框选区域做本地文字识别，中英混排自动分段，结果可复制、可存进图库备注。',
    keys: ['本地识别，不上传图片', '中英混排', '识别结果可二次编辑'],
    icon: ScanText,
    accent: 'Ctrl + Alt + O',
  },
  translate: {
    title: '屏幕翻译',
    tagline: '取字之后顺手译成你的语言',
    detail: '先识别画面文字，再调用你配置的翻译接口输出译文，原文与译文左右对照。',
    keys: ['支持 OpenAI 兼容 / DeepL / LibreTranslate', '原文译文对照', '可复制译文'],
    icon: Languages,
    accent: 'Ctrl + Alt + F',
  },
};

export function CaptureWorkspace({
  mode,
  settings,
  onMode,
  onOpenSettings,
  onPin,
  onLibraryChanged,
}: WorkspaceProps) {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef<ScreenSession | null>(null);

  const stopSession = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  useEffect(() => stopSession, [stopSession]);

  const start = async (target: ToolMode) => {
    setLoading(true);
    try {
      if (isDesktop()) {
        if (target === 'scroll' || target === 'record') {
          // 长图与录屏要连续取帧，原生宿主开一个轮询帧源。
          const source = await openNativeSession();
          sessionRef.current = source;
          const frame = grabFrame(source.video);
          setState({ kind: 'selecting', mode: target, frame, session: source });
        } else {
          // 单帧类（截图 / OCR / 翻译）抓一张就够，不轮询。
          const frame = await nativeCaptureScreen();
          if (!frame) throw new Error('原生抓帧没有返回画面');
          setState({ kind: 'selecting', mode: target, frame, session: null });
        }
        return;
      }
      const session = await openScreenSession({ audio: target === 'record' });
      sessionRef.current = session;
      const frame = grabFrame(session.video);
      setState({ kind: 'selecting', mode: target, frame, session });
    } catch (error) {
      stopSession();
      const message = error instanceof Error ? error.message : '无法开始捕捉';
      toast(message.includes('Permission') || message.includes('denied') ? '你取消了屏幕授权' : message, 'warn');
    } finally {
      setLoading(false);
    }
  };

  const confirmRegion = (rect: Rect) => {
    if (state.kind !== 'selecting') return;
    const { mode: target, frame, session } = state;
    const image = cropCanvas(frame, rect);

    if (target === 'snap') {
      session?.stop();
      sessionRef.current = null;
      setState({ kind: 'edit', image, rect });
      return;
    }
    if (target === 'scroll') {
      if (!session) {
        toast('长图需要持续抓帧，请改用浏览器屏幕共享', 'warn');
        return;
      }
      setState({ kind: 'scroll', image, rect, session });
      return;
    }
    if (target === 'record') {
      if (!session) {
        toast('录屏需要持续抓帧，请改用浏览器屏幕共享', 'warn');
        return;
      }
      setState({ kind: 'record', rect, session });
      return;
    }
    session?.stop();
    sessionRef.current = null;
    setState(target === 'ocr' ? { kind: 'ocr', image } : { kind: 'translate', image });
  };

  const finish = () => {
    stopSession();
    setState({ kind: 'idle' });
  };

  /**
   * QQ 工具栏里的「长截图 / 屏幕录制」是接着当前这块选区继续做，
   * 网页端必须重新走一次屏幕授权，桌面壳则直接开原生帧源。
   */
  const reopenSession = async (audio: boolean) => {
    const session = isDesktop() ? await openNativeSession() : await openScreenSession({ audio });
    sessionRef.current = session;
    return session;
  };

  const longFromEditor = async (canvas: HTMLCanvasElement, rect: Rect) => {
    setLoading(true);
    try {
      const session = await reopenSession(false);
      setState({ kind: 'scroll', image: canvas, rect, session });
    } catch (error) {
      toast(error instanceof Error ? error.message : '长截图需要再授权一次屏幕捕捉', 'warn');
    } finally {
      setLoading(false);
    }
  };

  const recordFromEditor = async (rect: Rect) => {
    setLoading(true);
    try {
      const session = await reopenSession(true);
      setState({ kind: 'record', rect, session });
    } catch (error) {
      toast(error instanceof Error ? error.message : '录屏需要再授权一次屏幕捕捉', 'warn');
    } finally {
      setLoading(false);
    }
  };

  if (state.kind === 'selecting') {
    return (
      <SelectionOverlay
        frame={state.frame}
        hint={
          state.mode === 'ocr'
            ? '框选识别文字 · 双击快速完成 · 右键退出'
            : state.mode === 'translate'
              ? '框选翻译文字 · 双击快速完成 · 右键退出'
              : state.mode === 'record'
                ? '框选录屏区域 · 双击快速开始 · 右键退出'
                : state.mode === 'scroll'
                  ? '框选长截图区域 · 双击快速完成 · 右键退出'
                  : '拖动框选区域 · 双击快速完成 · 右键退出'
        }
        onCancel={() => {
          stopSession();
          setState({ kind: 'idle' });
        }}
        onConfirm={confirmRegion}
      />
    );
  }

  if (state.kind === 'edit') {
    return (
      <Editor
        image={state.image}
        settings={settings}
        onClose={() => setState({ kind: 'idle' })}
        onSaved={onLibraryChanged}
        onPin={onPin}
        onLong={(canvas) => void longFromEditor(canvas, state.rect)}
        onOcr={(canvas) => setState({ kind: 'ocr', image: canvas })}
        onTranslate={(canvas) => setState({ kind: 'translate', image: canvas })}
        onRecord={() => void recordFromEditor(state.rect)}
      />
    );
  }

  if (state.kind === 'scroll') {
    return (
      <ScrollPanel
        seed={state.image}
        rect={state.rect}
        session={state.session}
        onClose={finish}
        onFinish={(image) =>
          setState({ kind: 'edit', image, rect: { x: 0, y: 0, w: image.width, h: image.height } })
        }
      />
    );
  }

  if (state.kind === 'record') {
    return <RecordPanel session={state.session} rect={state.rect} onClose={finish} onSaved={onLibraryChanged} />;
  }

  if (state.kind === 'ocr') {
    return <OcrPanel image={state.image} settings={settings} onClose={finish} onSaved={onLibraryChanged} />;
  }

  if (state.kind === 'translate') {
    return (
      <TranslatePanel
        image={state.image}
        settings={settings}
        onClose={finish}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  const meta = MODE_META[mode];
  const Icon = meta.icon;
  const host = hostKind();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="stage-grid flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        <div className="w-full max-w-[880px]">
          <div className="flex items-start gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center border border-amber/40 bg-amber/10">
              <span className="frame-corner -left-px -top-px border-l-2 border-t-2" />
              <span className="frame-corner -right-px -bottom-px border-b-2 border-r-2" />
              <Icon size={22} className="text-amber" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-[26px] font-semibold tracking-tight text-paper">{meta.title}</h2>
                <span className="font-mono text-[11px] text-muted">{meta.accent}</span>
              </div>
              <p className="mt-1 text-[13px] text-paper/70">{meta.tagline}</p>
            </div>
          </div>

          <p className="mt-5 max-w-[640px] text-[13px] leading-6 text-paper/75">{meta.detail}</p>

          <ul className="mt-4 grid gap-1.5 sm:grid-cols-3">
            {meta.keys.map((key) => (
              <li key={key} className="flex items-start gap-2 border border-ink-600/60 bg-ink-850 px-2.5 py-2 text-[11.5px] leading-5 text-muted">
                <span className="mt-2 h-1 w-1 shrink-0 bg-amber/70" />
                {key}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-accent !px-4 !py-2.5 text-[13px]" disabled={loading} onClick={() => start(mode)}>
              {loading ? '正在请求屏幕授权' : '开始捕捉'}
              <ArrowRight size={15} />
            </button>
            <span className="font-mono text-[10px] tracking-wider text-muted">
              {host === 'web'
                ? '网页端每次需浏览器授权 · 桌面端无此步骤'
                : host === 'android'
                  ? 'Android 壳走系统录屏授权 · 首次会弹一次'
                  : '桌面壳直接调用系统截屏 · 无需授权'}
            </span>
          </div>

          <div className="mt-8 sprocket opacity-30" />

          <div className="mt-6 grid gap-2 sm:grid-cols-5">
            {(Object.keys(MODE_META) as ToolMode[]).map((key) => {
              const item = MODE_META[key];
              const ItemIcon = item.icon;
              return (
                <button
                  key={key}
                  type="button"
                  className={`group flex flex-col items-start gap-2 border p-3 text-left transition-colors ${
                    key === mode ? 'border-amber/60 bg-amber/5' : 'border-ink-600/60 bg-ink-850 hover:border-ink-500'
                  }`}
                  onClick={() => onMode(key)}
                >
                  <ItemIcon size={15} className={key === mode ? 'text-amber' : 'text-muted'} />
                  <span className="text-[12px] text-paper/85">{item.title}</span>
                  <span className="font-mono text-[9.5px] tracking-wider text-muted/70">{item.accent}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-start gap-2 border-l-2 border-signal-warn/50 bg-ink-850 px-3 py-2.5">
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-signal-warn/80" />
            <p className="text-[11.5px] leading-5 text-muted">
              {host === 'web'
                ? '网页端受浏览器沙箱限制：截屏必须由你逐次授权，无法全局热键，也无法隐藏自身窗口或让贴图常驻最前。这三项在桌面端由系统接口实现，源码见仓库 desktop 目录。'
                : host === 'android'
                  ? 'Android 壳已接管系统截屏与悬浮窗。录屏需要一次 MediaProjection 授权，且系统要求常驻一条前台通知；连续取帧走 PNG 回传，帧率受限于系统截屏耗时。'
                  : '桌面壳已接管系统截屏、置顶贴图与全局热键，截图前会自动收起自身窗口。录屏为原生连续抓帧，帧率受系统截屏耗时限制（约 3–5fps），要 30fps 请用网页端或在目标机录。'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
