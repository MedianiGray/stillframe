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

/** 一块显示器：origin 是它在虚拟桌面上的物理坐标（副屏在左时为负）。 */
export interface HostDisplay {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

/** 桌面上所有显示器；浏览器与 Android 返回空数组。 */
export async function nativeDisplays(): Promise<HostDisplay[]> {
  const invoke = desktopInvoke();
  if (!invoke) return [];
  try {
    const rows = await invoke('displays');
    return Array.isArray(rows) ? (rows as HostDisplay[]) : [];
  } catch {
    return [];
  }
}

export interface HostHotkey {
  mode: string;
  keys: string;
  /** primary：主键拿到；fallback：主键被占、走备用键；unavailable：两档都抢不到。 */
  state: 'primary' | 'fallback' | 'unavailable';
}

/**
 * 全局热键的落地结果。setup 里发的事件常常早于前端订阅，
 * 所以界面启动时要主动问一次，不能靠「没收到就是没事」。
 */
export async function nativeHotkeyStatus(): Promise<HostHotkey[]> {
  const invoke = desktopInvoke();
  if (!invoke) return [];
  try {
    const rows = await invoke('hotkey_status');
    return Array.isArray(rows) ? (rows as HostHotkey[]) : [];
  } catch {
    return [];
  }
}

/**
 * 抓一块屏（不给 id 就是鼠标所在屏），并带回这块屏的几何。
 * 前端靠 display 的 x/y 把「图内坐标」换成「屏幕绝对坐标」：
 * 副屏不是从 (0,0) 起算的，录制选区、滚轮注入、遮挡判断都要加这个原点。
 */
export async function nativeCaptureFrame(
  display?: number,
): Promise<{ canvas: HTMLCanvasElement; display: HostDisplay } | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const payload = (await invoke('capture_frame', { display })) as
    | { dataUrl?: string; display?: HostDisplay }
    | null;
  if (!payload || typeof payload.dataUrl !== 'string' || !payload.dataUrl.startsWith('data:image')) {
    throw new Error('原生命令没有返回图像');
  }
  const displayInfo: HostDisplay = payload.display ?? {
    id: 0,
    name: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    scale: 1,
    primary: true,
  };
  return { canvas: await dataUrlToCanvas(payload.dataUrl), display: displayInfo };
}

/**
 * 进入截图覆盖层：主窗铺满鼠标所在那块屏并全屏，返回那块屏的几何。
 * 全屏只覆盖窗口所在显示器，所以移动 + 全屏这一步必须由壳来做，前端只等结果。
 */
export async function nativeEnterOverlay(display?: number): Promise<HostDisplay | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const info = (await invoke('enter_overlay', { display })) as HostDisplay | null;
  return info ?? null;
}

/** 退出覆盖层，回到普通窗口。没进过全屏时壳里直接返回，不碰窗口状态。 */
export async function nativeExitOverlay(): Promise<void> {
  const invoke = desktopInvoke();
  if (!invoke) return;
  await invoke('exit_overlay');
}

/** 原生整屏抓帧。不给 display 就抓鼠标所在屏；浏览器环境返回 null。 */
export async function nativeCaptureScreen(display?: number): Promise<HTMLCanvasElement | null> {
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
  const payload = await invoke('capture_screen', { display });
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
  mic = false,
  system = false,
): Promise<string | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  // mic 默认 false：录进别人的声音不是小事，只有用户点了麦克风开关才采
  // system 同理：系统声走 WASAPI 环回，也要开关打开才采
  const path = await invoke('start_recording', { rect, fps, mic, system });
  return typeof path === 'string' ? path : null;
}

/** 结束原生录制，等 FFmpeg 收尾后拿到实绩（帧数、时长、实际帧率、掉帧）。 */
export async function nativeStopRecording(): Promise<NativeRecordingStats | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  const stats = await invoke('stop_recording');
  return stats && typeof stats === 'object' ? (stats as NativeRecordingStats) : null;
}

/** 一条推进成片的标注。坐标、线宽、字号都已归一化到选区（0..1）。 */
export interface NativeRecAnnotation {
  kind: 'rect' | 'ellipse' | 'arrow' | 'pen' | 'text';
  color?: string;
  /** 线宽 / 选区宽。 */
  width?: number;
  /** 出现时刻，相对录制开始的毫秒。 */
  atMs: number;
  points?: [number, number][];
  a?: [number, number];
  b?: [number, number];
  pos?: [number, number];
  text?: string;
  /** 字号 / 选区宽。 */
  size?: number;
}

/**
 * 把一条已落定的标注推进成片。桌面壳按 `atMs` 决定它从第几帧开始出现，
 * 因此可以在录制中途随时画、随时推，不用等录完再合成。
 */
export async function nativePushAnnotation(item: NativeRecAnnotation): Promise<void> {
  const invoke = desktopInvoke();
  if (!invoke) return;
  try {
    await invoke('push_record_annotation', { annotation: item });
  } catch {
    // 标注进不了成片不该影响录制本身
  }
}

/** 激光笔轨迹点：只留最近 1.5 秒，画成一路渐隐的红点。 */
export async function nativePushLaser(x: number, y: number, atMs: number): Promise<void> {
  const invoke = desktopInvoke();
  if (!invoke) return;
  try {
    await invoke('push_record_laser', { x, y, atMs });
  } catch {
    // 同上：激光掉帧不影响画面录制
  }
}

/** 撤销最后一条标注：成片后面的帧不再画它（已录进去的帧保持原样）。 */
export async function nativeUndoAnnotation(): Promise<void> {
  const invoke = desktopInvoke();
  if (!invoke) return;
  try {
    await invoke('undo_record_annotation');
  } catch {
    // 忽略
  }
}

/** 清空标注与激光残影。 */
export async function nativeClearAnnotation(): Promise<void> {
  const invoke = desktopInvoke();
  if (!invoke) return;
  try {
    await invoke('clear_record_annotation');
  } catch {
    // 忽略
  }
}

export interface HostInfo {
  version: string;
  platform: string;
  exe: string;
}

/** 桌面壳的版本与程序路径；网页端返回 null。 */
export async function nativeAppInfo(): Promise<HostInfo | null> {
  const invoke = desktopInvoke();
  if (!invoke) return null;
  try {
    return (await invoke('app_info')) as HostInfo;
  } catch {
    return null;
  }
}

/** 开机自启是否已写进注册表；非 Windows 恒为 false。 */
export async function nativeAutostartEnabled(): Promise<boolean> {
  const invoke = desktopInvoke();
  if (!invoke) return false;
  try {
    return Boolean(await invoke('autostart_enabled'));
  } catch {
    return false;
  }
}

export async function nativeSetAutostart(enabled: boolean): Promise<void> {
  const invoke = desktopInvoke();
  if (!invoke) throw new Error('只有桌面端才能设置开机自启');
  await invoke('set_autostart', { enabled });
}
