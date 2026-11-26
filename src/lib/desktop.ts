/**
 * 宿主桥：同一套 UI 跑在三种容器里，这里判断"我在哪"并把能力对齐。
 *
 * - Tauri 桌面壳：window.__TAURI__.core.invoke / __TAURI_INTERNALS__.invoke
 * - Android 壳：window.AndroidBridge（WebView addJavascriptInterface 注入）
 * - 都没有：浏览器，全部回落 getDisplayMedia / 下载
 */

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: Invoke } };
  __TAURI_INTERNALS__?: { invoke?: Invoke };
}

interface AndroidBridgeLike {
  isAndroid?: () => boolean;
  hasCapture?: () => boolean;
  hasOverlay?: () => boolean;
  captureScreen?: () => string;
  pinImage?: (dataUrl: string) => void;
  savePng?: (dataUrl: string, suggestedName: string) => string;
  hideSelf?: () => void;
  showSelf?: () => void;
  requestScreenCapture?: () => void;
  requestOverlayPermission?: () => void;
}

export type HostKind = 'web' | 'tauri' | 'android';

export function desktopInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const global = window as unknown as TauriGlobal;
  return global.__TAURI__?.core?.invoke ?? global.__TAURI_INTERNALS__?.invoke ?? null;
}

export function androidBridge(): AndroidBridgeLike | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { AndroidBridge?: AndroidBridgeLike }).AndroidBridge;
  return bridge && typeof bridge.captureScreen === 'function' ? bridge : null;
}

export function hostKind(): HostKind {
  if (androidBridge()) return 'android';
  if (desktopInvoke()) return 'tauri';
  return 'web';
}

/** 有原生宿主（桌面壳 / Android 壳），可以走系统截屏。 */
export function isDesktop(): boolean {
  return hostKind() !== 'web';
}

function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建画布'));
        return;
      }
      ctx.drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error('无法解码原生命令返回的图像'));
    image.src = dataUrl;
  });
}

/** 原生整屏抓帧。浏览器环境返回 null。 */
export async function nativeCaptureScreen(): Promise<HTMLCanvasElement | null> {
  const bridge = androidBridge();
  if (bridge?.captureScreen) {
    if (bridge.hasCapture && !bridge.hasCapture()) {
      // 首次使用：先拉系统授权，让用户允许后再点一次。
      bridge.requestScreenCapture?.();
      throw new Error('已请求屏幕录制授权，请在系统弹窗里允许后再点一次「开始捕捉」');
    }
    const payload = bridge.captureScreen();
    if (typeof payload !== 'string' || !payload.startsWith('data:image')) {
      throw new Error(payload || 'Android 壳没有返回图像，请检查屏幕录制授权');
    }
    return dataUrlToCanvas(payload);
  }

  const invoke = desktopInvoke();
  if (!invoke) return null;
  const payload = await invoke('capture_screen');
  if (typeof payload !== 'string' || !payload.startsWith('data:image')) {
    throw new Error('原生命令没有返回图像');
  }
  return dataUrlToCanvas(payload);
}

export interface NativeWindow {
  id: number;
  title: string;
  app?: string;
  width?: number;
  height?: number;
}

/** 按窗口抓一张（桌面壳）。浏览器 / Android 返回 null，由 UI 隐藏该入口。 */
export async function nativeCaptureWindow(id: number): Promise<HTMLCanvasElement | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const payload = await invoke('capture_window', { id });
  if (typeof payload !== 'string' || !payload.startsWith('data:image')) {
    throw new Error('原生命令没有返回窗口画面');
  }
  return dataUrlToCanvas(payload);
}

/**
 * 贴图：桌面壳开置顶窗口，Android 添加悬浮窗，浏览器返回 false 由 UI 用页内浮层兜底。
 * width / height 传原图尺寸，桌面壳据此按比例定窗（此前固定 600×500 会把图拉变形）。
 */
export async function nativePin(dataUrl: string, width?: number, height?: number): Promise<boolean> {
  const bridge = androidBridge();
  if (bridge?.pinImage) {
    bridge.pinImage(dataUrl);
    return true;
  }
  const invoke = desktopInvoke();
  if (!invoke) return false;
  await invoke('pin_image', { dataUrl, width, height });
  return true;
}

/** 系统保存。返回最终路径；浏览器或用户取消返回 null。 */
export async function nativeSave(dataUrl: string, suggested: string): Promise<string | null> {
  const bridge = androidBridge();
  if (bridge?.savePng) {
    const saved = bridge.savePng(dataUrl, suggested);
    return typeof saved === 'string' && saved ? saved : null;
  }
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const saved = await invoke('save_png', { dataUrl, suggestedName: suggested });
  return typeof saved === 'string' ? saved : null;
}

/** 静默落盘：桌面壳写到 图片/Stillframe，不弹框。浏览器返回 null。 */
export async function nativeWriteShot(dataUrl: string, suggested: string): Promise<string | null> {
  const bridge = androidBridge();
  if (bridge?.savePng) {
    const saved = bridge.savePng(dataUrl, suggested);
    return typeof saved === 'string' && saved.startsWith('ERR:') ? null : saved || null;
  }
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const saved = await invoke('write_shot', { dataUrl, suggestedName: suggested });
  return typeof saved === 'string' ? saved : null;
}

export async function nativeListWindows(): Promise<NativeWindow[]> {
  const invoke = desktopInvoke();
  if (!invoke) return [];
  const rows = await invoke('list_windows');
  return Array.isArray(rows) ? (rows as NativeWindow[]) : [];
}

/** 读桌面壳内置的 OCR 语言包（gz 的 base64），让取字不依赖网络。 */
export async function nativeTessdata(lang: string): Promise<string | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  try {
    const data = await invoke('read_tessdata', { lang });
    return typeof data === 'string' && data ? data : null;
  } catch {
    return null;
  }
}

/** 截图前藏起自己（对应「隐藏当前窗口」）。 */
export async function nativeHideSelf(): Promise<void> {
  const bridge = androidBridge();
  if (bridge?.hideSelf) {
    bridge.hideSelf();
    return;
  }
  const invoke = desktopInvoke();
  if (invoke) await invoke('hide_self');
}

/** 恢复自身窗口（自动滚动结束时一定要调用）。 */
export async function nativeShowSelf(): Promise<void> {
  const bridge = androidBridge();
  if (bridge?.showSelf) {
    bridge.showSelf();
    return;
  }
  const invoke = desktopInvoke();
  if (invoke) await invoke('show_self');
}

/**
 * 向屏幕坐标注入滚轮事件（自动滚动长截图）。notches 为「档」数，正数向下。
 * 非 Windows 桌面壳会抛错，调用方据此回退手动模式。
 */
export async function nativeScroll(x: number, y: number, notches: number): Promise<void> {
  const invoke = desktopInvoke();
  if (!invoke) throw new Error('自动滚动需要桌面壳');
  await invoke('scroll_at', { x: Math.round(x), y: Math.round(y), notches });
}

/** 桌面壳自身窗口的屏幕矩形（物理像素），用于判断它会不会挡在截取区域上。 */
export interface HostRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function nativeSelfRect(): Promise<HostRect | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  try {
    const rect = (await invoke('self_rect')) as HostRect | null;
    if (!rect || typeof rect.width !== 'number' || rect.width <= 0) return null;
    return rect;
  } catch {
    return null;
  }
}

/** 打开快捷浮窗（桌面壳）。浏览器没有这个能力。 */
export async function nativeOpenQuick(): Promise<boolean> {
  const invoke = desktopInvoke();
  if (!invoke) return false;
  await invoke('open_quick');
  return true;
}

interface TauriInternals extends TauriGlobal {
  __TAURI_INTERNALS__?: {
    invoke?: Invoke;
    transformCallback?: (callback: (payload: unknown) => void, once?: boolean) => number;
  };
}

/**
 * 监听桌面壳发来的事件（热键、浮窗动作）。不引入 @tauri-apps/api，
 * 直接走 Tauri 2 的 event 插件与内部 transformCallback，保持零运行时依赖。
 * 返回取消监听的函数；浏览器环境返回 null。
 */
export async function onHostEvent(
  event: string,
  handler: (payload: string) => void,
): Promise<(() => void) | null> {
  if (typeof window === 'undefined') return null;
  const internals = (window as unknown as TauriInternals).__TAURI_INTERNALS__;
  if (!internals?.invoke || typeof internals.transformCallback !== 'function') return null;

  const id = internals.transformCallback((payload) => handler(String(payload ?? '')));
  await internals.invoke('plugin:event|listen', {
    event,
    target: { kind: 'WebviewWindow', label: 'main' },
    handler: id,
  });

  return () => {
    void internals.invoke?.('plugin:event|unlisten', { event, eventId: id });
  };
}

export interface NativeRecordingStats {
  path: string;
  frames: number;
  seconds: number;
  /** 内容更新率：为对齐时间轴补出来的重复帧不计入。 */
  fps: number;
  dropped: number;
  /** 每帧写管道的平均毫秒数，远大于 grabAvgMs 说明编码端是瓶颈。 */
  writeAvgMs?: number;
  /** 每帧抓屏的平均毫秒数。 */
  grabAvgMs?: number;
  /** 为对齐时间轴重复写出的帧数。 */
  repeats?: number;
  /** 实际走的抓帧 + 编码组合，如 `dxgi+h264_qsv`。 */
  backend?: string;
}

/**
 * 原生录制：录像由桌面壳的抓帧线程 + FFmpeg 完成，绕开 WebView 那套
 * 「轮询抓帧再喂 MediaRecorder」的低帧率路径。返回即将写入的 MP4 路径。
 *
 * rect 用全屏冻结图的坐标（物理像素），与 capture_screen 的取景一致。
 */
export async function nativeStartRecording(
  rect: { x: number; y: number; width: number; height: number },
  fps = 30,
): Promise<string | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const path = await invoke('start_recording', { rect, fps });
  return typeof path === 'string' ? path : null;
}

/** 结束原生录制，等 FFmpeg 收尾后拿到实绩（帧数、时长、实际帧率、掉帧）。 */
export async function nativeStopRecording(): Promise<NativeRecordingStats | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const stats = await invoke('stop_recording');
  return stats && typeof stats === 'object' ? (stats as NativeRecordingStats) : null;
}
