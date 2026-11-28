import { canvasFromSource } from './image';
import { nativeCaptureFrame, nativeCaptureScreen } from './desktop';

/**
 * 帧来源。浏览器是真实的 MediaStream + video 元素；
 * 桌面壳 / Android 壳是「一次性抓帧后画进 canvas」的轮询源。
 * 两者都满足 `grabFrame / grabRegion` 与录屏的 drawImage 要求。
 */
export interface CaptureSource {
  video: HTMLVideoElement | HTMLCanvasElement;
  audioTracks: MediaStreamTrack[];
  stop: () => void;
  stream?: MediaStream;
  /**
   * 画面左上角在虚拟桌面上的物理坐标（默认 0,0）。
   * 副屏不是从主屏原点起算的：选区换算成屏幕坐标、注入滚轮、判断自身窗口遮挡都要用它。
   */
  origin?: { x: number; y: number };
}

/** 兼容旧名字：滚动拼接与录屏面板都按这个契约取帧。 */
export type ScreenSession = CaptureSource;

interface ScreenOptions {
  audio?: boolean;
  frameRate?: number;
}

interface NativeOptions {
  /** 抓帧间隔（毫秒）。桌面/Android 走 PNG 回传，太快会打满 CPU。 */
  intervalMs?: number;
  /** 抓帧失败时的回调，默认静默（用户可能中途取消了授权）。 */
  onError?: (error: unknown) => void;
}

export function displayCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

export async function openScreenSession(options: ScreenOptions = {}): Promise<CaptureSource> {
  if (!displayCaptureSupported()) {
    throw new Error('当前浏览器不支持屏幕捕捉，请使用桌面端或 Chrome / Edge');
  }
  const audio = options.audio ?? false;
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: options.frameRate ?? 30 },
    audio,
  });

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    const done = () => resolve();
    video.onloadedmetadata = done;
    video.onerror = () => reject(new Error('无法读取屏幕画面'));
    window.setTimeout(done, 1500);
  });

  await video.play().catch(() => undefined);
  await waitForFrames(video, 2);

  const audioTracks = stream.getAudioTracks();
  const stop = () => {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };

  if (!video.videoWidth) {
    stop();
    throw new Error('屏幕捕捉没有返回画面，请重新授权');
  }

  return { stream, video, audioTracks, stop };
}

/**
 * 原生宿主（Tauri / Android）的帧来源：一个常驻 canvas，定时把系统截图画进去。
 * 抓帧间隔默认 320ms —— 桌面壳与 Android 都要走一次 PNG 编码 + base64 回传，
 * 再快就会明显占 CPU。录屏因此是「原生帧率上限」而不是 30fps，README 已注明。
 */
export async function openNativeSession(options: NativeOptions = {}): Promise<CaptureSource> {
  const intervalMs = Math.max(120, options.intervalMs ?? 320);
  // 先按鼠标所在屏抓第一帧，之后钉住这块屏（display id）：轮询途中鼠标挪到别的屏，
  // 画面不能跟着跳，否则长图拼接与录制选区全错位。
  // capture_frame 是后加的命令，老壳没有就退回只抓画面（origin 按 0,0 处理）。
  const first = await nativeCaptureFrame().catch(() => null);
  const fallback = first ? null : await nativeCaptureScreen();
  if (!first && !fallback) throw new Error('原生宿主不可用');
  const canvas = document.createElement('canvas');
  const image = first?.canvas ?? fallback!;
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(image, 0, 0);
  const displayId = first?.display?.id;
  const origin = { x: first?.display?.x ?? 0, y: first?.display?.y ?? 0 };

  let stopped = false;
  let busy = false;
  const timer = window.setInterval(async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const grabbed = await nativeCaptureFrame(displayId);
      const frame = grabbed?.canvas ?? null;
      if (!frame || stopped) return;
      // 分辨率变化（换屏/旋转）时按新尺寸重置，避免拉伸。
      if (frame.width !== canvas.width || frame.height !== canvas.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    } catch (error) {
      options.onError?.(error);
    } finally {
      busy = false;
    }
  }, intervalMs);

  return {
    video: canvas,
    audioTracks: [],
    origin,
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
    },
  };
}

async function waitForFrames(video: HTMLVideoElement, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => {
      if ('requestVideoFrameCallback' in video) {
        (video as HTMLVideoElement & {
          requestVideoFrameCallback: (cb: () => void) => number;
        }).requestVideoFrameCallback(() => resolve());
        window.setTimeout(resolve, 220);
      } else {
        window.setTimeout(resolve, 120);
      }
    });
  }
}

function frameSize(source: HTMLVideoElement | HTMLCanvasElement): { width: number; height: number } {
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  return { width: source.videoWidth, height: source.videoHeight };
}

export function grabFrame(source: HTMLVideoElement | HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = frameSize(source);
  if (!width || !height) {
    throw new Error('画面尚未就绪，请稍后重试');
  }
  return canvasFromSource(source, width, height);
}

export function grabRegion(
  source: HTMLVideoElement | HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const frame = grabFrame(source);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w));
  canvas.height = Math.max(1, Math.round(rect.h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(frame, Math.round(rect.x), Math.round(rect.y), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
