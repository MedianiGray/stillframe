import type { Rect } from './types';

export interface RecorderOptions {
  rect: Rect;
  fps?: number;
  audioStream?: MediaStream | null;
  bitrate?: number;
  onTick?: (seconds: number) => void;
}

export class RegionRecorder {
  /** 浏览器是 video 元素；原生宿主是持续更新的 canvas。两者都能被 drawImage 消费。 */
  private video: HTMLVideoElement | HTMLCanvasElement;
  private rect: Rect;
  private fps: number;
  private bitrate: number;
  private onTick?: (seconds: number) => void;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private rafId = 0;
  private startedAt = 0;
  private tickId = 0;
  private audioContext: AudioContext | null = null;
  private mixedStream: MediaStream | null = null;
  private paused = false;

  constructor(video: HTMLVideoElement | HTMLCanvasElement, options: RecorderOptions) {
    this.video = video;
    this.rect = options.rect;
    this.fps = options.fps ?? 30;
    this.bitrate = options.bitrate ?? 8_000_000;
    this.onTick = options.onTick;
    this.pendingAudio = options.audioStream ?? null;
  }

  private pendingAudio: MediaStream | null;

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  static pickMimeType(): string {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
  }

  start(): void {
    if (this.recorder) return;
    const w = Math.max(2, Math.round(this.rect.w));
    const h = Math.max(2, Math.round(this.rect.h));
    const canvas = document.createElement('canvas');
    canvas.width = w - (w % 2);
    canvas.height = h - (h % 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建录制画布');
    this.canvas = canvas;
    this.ctx = ctx;

    const draw = () => {
      if (!this.canvas || !this.ctx) return;
      if (!this.paused) {
        try {
          this.ctx.drawImage(
            this.video,
            Math.round(this.rect.x),
            Math.round(this.rect.y),
            this.canvas.width,
            this.canvas.height,
            0,
            0,
            this.canvas.width,
            this.canvas.height,
          );
        } catch {
          // frame not ready yet
        }
      }
      this.rafId = window.requestAnimationFrame(draw);
    };
    draw();

    const videoStream = canvas.captureStream(this.fps);
    let stream = videoStream;

    if (this.pendingAudio) {
      const mixed = this.mixAudio(this.pendingAudio);
      if (mixed) {
        stream = new MediaStream([...videoStream.getVideoTracks(), ...mixed.getAudioTracks()]);
        this.mixedStream = mixed;
      } else {
        this.pendingAudio.getAudioTracks().forEach((track) => stream.addTrack(track));
      }
    }

    const mimeType = RegionRecorder.pickMimeType();
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: this.bitrate });
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(1000);
    this.startedAt = Date.now();
    this.tickId = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
      this.onTick?.(seconds);
    }, 500);
  }

  private mixAudio(source: MediaStream): MediaStream | null {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const destination = ctx.createMediaStreamDestination();
    const sources = source.getAudioTracks().map((track) => {
      const node = ctx.createMediaStreamSource(new MediaStream([track]));
      node.connect(destination);
      return node;
    });
    this.audioContext = ctx;
    if (!sources.length) return null;
    return destination.stream;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): Promise<Blob> {
    window.clearInterval(this.tickId);
    window.cancelAnimationFrame(this.rafId);
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) {
        reject(new Error('录制尚未开始'));
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.cleanup();
        resolve(blob);
      };
      try {
        recorder.stop();
      } catch (error) {
        this.cleanup();
        reject(error instanceof Error ? error : new Error('停止录制失败'));
      }
    });
  }

  private cleanup(): void {
    this.recorder = null;
    this.chunks = [];
    this.mixedStream?.getTracks().forEach((track) => track.stop());
    this.audioContext?.close().catch(() => undefined);
    this.mixedStream = null;
    this.audioContext = null;
  }
}
