import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Crop, ImagePlus, Languages, ScanText, ScrollText, ShieldAlert, Timer, Video } from 'lucide-react';
import type { Rect, ToolMode } from '../lib/types';
import type { Settings } from '../lib/settings';
import { canvasFromFile, cropCanvas } from '../lib/image';
import { grabFrame, openNativeSession, openScreenSession, type ScreenSession } from '../lib/capture';
import {
  hostKind,
  isDesktop,
  nativeCaptureScreen,
  nativeCaptureWindow,
  nativeEnterOverlay,
  nativeExitOverlay,
  nativeHideSelf,
  nativeListWindows,
  nativeShowSelf,
  type NativeWindow,
} from '../lib/desktop';
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
  /** 已钉住的贴图张数；到 20 张就把工具栏「钉在桌面上」置灰。 */
  pinCount?: number;
  /** 桌面壳热键 / 快捷浮窗送来的一次「直接开拍」请求；tick 变化即触发。 */
  autoStart?: { mode: ToolMode; tick: number };
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
  pinCount = 0,
  autoStart,
}: WorkspaceProps) {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [loading, setLoading] = useState(false);
  const [delay, setDelay] = useState<0 | 3 | 5>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const cancelCountdownRef = useRef(false);
  const [windows, setWindows] = useState<NativeWindow[]>([]);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [windowsBusy, setWindowsBusy] = useState(false);
  const sessionRef = useRef<ScreenSession | null>(null);
  /** 覆盖层铺在哪块屏：抓帧与录制都钉在这块，鼠标中途挪走也不换屏。 */
  const overlayDisplayRef = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const stopSession = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  useEffect(() => stopSession, [stopSession]);

  /**
   * 收尾必须把窗口亮回来。桌面壳自己都可能在隐藏/显示之间出错，
   * 所以这里重试一次；仍失败就明说，别让用户以为程序没了。
   */
  const showSelfStrict = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await nativeShowSelf();
        return;
      } catch (error) {
        if (attempt === 1) {
          toast(
            error instanceof Error ? `窗口没能自动亮回来：${error.message}` : '窗口没能自动亮回来，请点任务栏里的 Stillframe',
            'warn',
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  }, [toast]);

  /**
   * 单帧类捕捉：延时倒计时结束后先收起自身窗口，抓完再亮出来，避免把自己拍进画面。
   * hide 失败照抓（画面里可能带着本窗口），但收尾一律走 show——藏起来没亮回来才是真事故。
   */
  const grabWithoutSelf = async (display?: number) => {
    if (hostKind() !== 'tauri') return nativeCaptureScreen();
    try {
      await nativeHideSelf();
    } catch (error) {
      toast(error instanceof Error ? `隐藏窗口失败：${error.message}` : '隐藏窗口失败，画面里可能带着本窗口', 'warn');
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
    // 看门狗：抓屏若卡住（DXGI 无响应），finally 永远不会跑到，窗口就会一直藏着
    const watchdog = window.setTimeout(() => {
      void nativeShowSelf().catch(() => undefined);
    }, 5000);
    try {
      return await nativeCaptureScreen(display);
    } finally {
      window.clearTimeout(watchdog);
      await showSelfStrict();
    }
  };

  const singleFrameMode = mode === 'snap' || mode === 'ocr' || mode === 'translate';

  const refreshWindows = useCallback(async () => {
    if (hostKind() !== 'tauri') return;
    setWindowsBusy(true);
    try {
      const rows = await nativeListWindows();
      const visible = rows.filter((row) => row.id > 0 && !row.title.includes('Stillframe'));
      setWindows(visible);
      setWindowId((current) => (current && visible.some((row) => row.id === current) ? current : visible[0]?.id ?? null));
    } catch (error) {
      toast(error instanceof Error ? error.message : '读窗口列表失败', 'warn');
    } finally {
      setWindowsBusy(false);
    }
    // toast 在页面生命周期内稳定，输入只影响提示文案，不需要重建回调。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hostKind() === 'tauri' && singleFrameMode) void refreshWindows();
  }, [singleFrameMode, refreshWindows]);

  /** 窗口截图：不框选，直接把目标窗口整张抓进来，再走原来的标注 / 取字 / 翻译。 */
  const pickWindow = async (id: number) => {
    setLoading(true);
    try {
      const image = await nativeCaptureWindow(id);
      if (!image) throw new Error('窗口画面没有返回');
      const rect: Rect = { x: 0, y: 0, w: image.width, h: image.height };
      if (mode === 'snap') setState({ kind: 'edit', image, rect });
      else setState(mode === 'ocr' ? { kind: 'ocr', image } : { kind: 'translate', image });
    } catch (error) {
      toast(error instanceof Error ? error.message : '窗口截图失败', 'warn');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 打开本地图片：手里已有的截图直接进对应面板，不必再截一遍屏。
   * 三个单帧模式各去各的面板；长图 / 录屏没有「一张图」的语义，统一落到标注台。
   */
  const openLocalImage = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const image = await canvasFromFile(file);
      const rect: Rect = { x: 0, y: 0, w: image.width, h: image.height };
      if (mode === 'ocr') setState({ kind: 'ocr', image });
      else if (mode === 'translate') setState({ kind: 'translate', image });
      else setState({ kind: 'edit', image, rect });
    } catch (error) {
      toast(error instanceof Error ? error.message : '这张图读不出来', 'warn');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [mode]);

  /**
   * 接住 Ctrl+V：浏览器插件、系统截图工具、聊天窗口复制出来的图都能直接落进来。
   * 剪贴板里是文字时不动手，免得抢掉文本框自己的粘贴。
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const file = items
        .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
        .find((entry): entry is File => Boolean(entry && entry.type.startsWith('image/')));
      if (!file) return;
      event.preventDefault();
      void openLocalImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openLocalImage]);

  /**
   * 进截图覆盖层：把主窗铺到鼠标所在那块屏再抓帧。
   * 顺序不能反——先全屏再移动，全屏的是主屏；先抓帧再全屏，画面与选框会差一截。
   * 铺屏失败不影响截图（退回「窗口内框选整屏」的老样子），只是视野小一点。
   */
  const enterOverlay = useCallback(async (): Promise<number | undefined> => {
    if (!isDesktop()) return undefined;
    try {
      const display = await nativeEnterOverlay();
      if (!display) return undefined;
      overlayDisplayRef.current = display.id;
      // 等窗口真正铺开：全屏切换是异步的，WebView 视口尺寸要下一两帧才更新，
      // 视口没更新就抓帧，选区换算会按旧窗口尺寸算，框出来的位置就偏了。
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
      await new Promise((resolve) => setTimeout(resolve, 260));
      return display.id;
    } catch (error) {
      toast(
        error instanceof Error ? `没能铺满屏幕，改为窗口内框选：${error.message}` : '没能铺满屏幕，改为窗口内框选',
        'warn',
      );
      return undefined;
    }
  }, [toast]);

  const exitOverlay = useCallback(() => {
    overlayDisplayRef.current = undefined;
    if (!isDesktop()) return;
    void nativeExitOverlay().catch(() => undefined);
  }, []);

  const start = async (target: ToolMode) => {
    setLoading(true);
    const singleFrame = target === 'snap' || target === 'ocr' || target === 'translate';
    try {
      if (isDesktop()) {
        if (singleFrame && delay > 0) {
          cancelCountdownRef.current = false;
          for (let left = delay; left > 0; left -= 1) {
            if (cancelCountdownRef.current) return;
            setCountdown(left);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          if (cancelCountdownRef.current) return;
          setCountdown(null);
        }
        const display = await enterOverlay();
        if (target === 'scroll' || target === 'record') {
          // 长图与录屏要连续取帧，原生宿主开一个轮询帧源。
          const source = await openNativeSession({ display });
          sessionRef.current = source;
          const frame = grabFrame(source.video);
          setState({ kind: 'selecting', mode: target, frame, session: source });
        } else {
          // 单帧类（截图 / OCR / 翻译）抓一张就够，不轮询。
          const frame = await grabWithoutSelf(display);
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
      exitOverlay();
      const message = error instanceof Error ? error.message : '无法开始捕捉';
      toast(message.includes('Permission') || message.includes('denied') ? '你取消了屏幕授权' : message, 'warn');
    } finally {
      setLoading(false);
      setCountdown(null);
    }
  };

  // 热键 / 快捷浮窗只送「哪一次」与模式：命中当前模式且还停在待机页时直接开拍。
  const autoStartTick = autoStart?.tick ?? 0;
  const lastTickRef = useRef(0);
  useEffect(() => {
    if (!autoStartTick || autoStartTick === lastTickRef.current) return;
    lastTickRef.current = autoStartTick;
    if (autoStart?.mode !== mode) return;
    if (stateRef.current.kind !== 'idle') return;
    void start(mode);
    // start 依赖的 delay/settings 在热键场景下取当前值即可，不额外触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartTick, mode]);

  const confirmRegion = (rect: Rect) => {
    if (state.kind !== 'selecting') return;
    // 选区落定就退出全屏：接下来的标注台 / 长图 / 录屏面板都要在普通窗口里看，
    // 而且长图与录屏的「自身遮挡判断」也依赖窗口回到正常大小。
    exitOverlay();
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
    exitOverlay();
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

  if (countdown !== null) {
    return (
      <div className="stage-grid flex min-h-0 flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="font-mono text-[11px] tracking-[0.3em] text-muted">倒计时结束后自动框选</span>
          <div className="relative flex h-32 w-32 items-center justify-center border border-amber/40 bg-amber/5">
            <span className="frame-corner -left-px -top-px border-l-2 border-t-2" />
            <span className="frame-corner -right-px -bottom-px border-b-2 border-r-2" />
            <span className="text-[64px] font-semibold leading-none text-amber">{countdown}</span>
          </div>
          <button
            type="button"
            className="btn !py-1.5 text-[12px]"
            onClick={() => {
              cancelCountdownRef.current = true;
              setCountdown(null);
            }}
          >
            取消
          </button>
        </div>
      </div>
    );
  }

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
          exitOverlay();
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
        pinFull={pinCount >= 20}
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
    return <OcrPanel image={state.image} settings={settings} onClose={finish} onSaved={onLibraryChanged} onTranslate={() => setState({ kind: 'translate', image: state.image })} />;
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
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        const file = event.dataTransfer?.files?.[0];
        setDragOver(false);
        if (!file) return;
        event.preventDefault();
        void openLocalImage(file);
      }}
    >
      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink-900/70">
          <div className="border border-dashed border-amber/60 bg-ink-850 px-6 py-4 text-[13px] text-paper/85">
            松手就把这张图送进{mode === 'ocr' ? '取字' : mode === 'translate' ? '译屏' : '标注台'}
          </div>
        </div>
      ) : null}
      <div className="stage-grid flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        <div className="w-full max-w-[840px]">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="open-image-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openLocalImage(file);
            }}
          />
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

          <ul className="mt-4 flex flex-wrap gap-1.5">
            {meta.keys.map((key) => (
              <li key={key} className="flex min-w-0 flex-1 basis-[220px] items-start gap-2 break-words border border-ink-600/60 bg-ink-850 px-2.5 py-2 text-[11.5px] leading-5 text-muted">
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
            <button
              type="button"
              className="btn !px-3 !py-2.5 text-[13px]"
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
              title="打开本地图片，直接进标注台 / 取字 / 译屏（也可以把图片拖进窗口）"
            >
              <ImagePlus size={15} />
              打开图片
            </button>
            {mode === 'snap' || mode === 'ocr' || mode === 'translate' ? (
              <div className="flex items-center gap-1.5">
                <Timer size={13} className="text-muted" />
                {( [0, 3, 5] as const).map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    className={`border px-2 py-1 font-mono text-[11px] transition-colors ${
                      delay === seconds
                        ? 'border-amber/60 bg-amber/10 text-amber'
                        : 'border-ink-600/60 text-muted hover:border-ink-500 hover:text-paper/80'
                    }`}
                    onClick={() => setDelay(seconds)}
                    title={seconds === 0 ? '立即取帧' : `等 ${seconds} 秒再取帧，留时间展开菜单/右键`}
                  >
                    {seconds === 0 ? '立即' : `${seconds}s`}
                  </button>
                ))}
              </div>
            ) : null}
            <span className="font-mono text-[10px] tracking-wider text-muted">
              {host === 'web'
                ? '网页端每次需浏览器授权 · 桌面端无此步骤'
                : host === 'android'
                  ? 'Android 壳走系统录屏授权 · 首次会弹一次'
                  : '桌面壳直接调用系统截屏 · 无需授权'}
            </span>
          </div>
          <p className="mt-2 font-mono text-[10px] tracking-wider text-muted/70">
            {host === 'tauri' ? 'Ctrl+Alt+Q 呼出快捷浮窗 · 主键 Ctrl+Alt+S / C / R / O / F（被占用时自动换 Ctrl+Shift+同字母）直接进入对应模式' : ''}
          </p>

          {host === 'tauri' && singleFrameMode ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border border-ink-600/60 bg-ink-850 px-3 py-2">
              <span className="label shrink-0">窗口截图</span>
              <select
                className="field !py-1 min-w-0 max-w-[320px] flex-1 !text-[12px]"
                value={windowId ?? ''}
                disabled={windowsBusy}
                onChange={(event) => setWindowId(Number(event.target.value) || null)}
              >
                {windows.length === 0 ? (
                  <option value="">没有可选窗口</option>
                ) : (
                  windows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.title}
                      {row.app ? ` · ${row.app}` : ''}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="btn !py-1 text-[12px]"
                disabled={!windowId || loading}
                onClick={() => windowId && void pickWindow(windowId)}
              >
                截这个窗口
              </button>
              <button
                type="button"
                className="btn btn-ghost !py-1 text-[12px]"
                disabled={windowsBusy}
                onClick={() => void refreshWindows()}
              >
                {windowsBusy ? '刷新中' : '刷新'}
              </button>
            </div>
          ) : null}

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
                  : '桌面壳已接管系统截屏、置顶贴图与全局热键，截图前会自动收起自身窗口。录屏为原生连续抓帧并按 30fps 排帧，实测 1080p 区域约 20–30fps（抓帧 8–29ms/帧，视桌面内容与机器而定）；点「开始录制」后要先等首帧就绪，按钮显示「准备中…」。'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
