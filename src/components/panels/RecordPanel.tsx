import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Brush,
  Circle,
  Eraser,
  Mic,
  MicOff,
  Play,
  Save,
  Square,
  Type,
  Undo2,
  Video,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import type { Rect } from '../../lib/types';
import { snapAngle, squareRect, toNativeAnnotation } from '../../lib/annotate';
import type { ScreenSession } from '../../lib/capture';
import { RegionRecorder } from '../../lib/recorder';
import { downloadBlob, timestampName } from '../../lib/image';
import { putShot } from '../../lib/storage';
import { writeToDirectory } from '../../lib/autosave';
import { QQ_TEXT } from '../../lib/qqspec';
import {
  hostKind,
  nativeClearAnnotation,
  nativePushAnnotation,
  nativePushLaser,
  nativeStartRecording,
  nativeStopRecording,
  nativeUndoAnnotation,
  type NativeRecordingStats,
} from '../../lib/desktop';
import { useToast } from '../Toasts';

type Pt = { x: number; y: number };

type RecAnn =
  | { id: string; kind: 'pen'; color: string; width: number; points: Pt[] }
  | { id: string; kind: 'rect' | 'ellipse'; color: string; width: number; a: Pt; b: Pt }
  | { id: string; kind: 'arrow'; color: string; width: number; a: Pt; b: Pt }
  | { id: string; kind: 'text'; color: string; size: number; pos: Pt; text: string };

type RecTool = 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'laser';

interface RecordPanelProps {
  session: ScreenSession;
  rect: Rect;
  onClose: () => void;
  onSaved: () => void;
}

const BTN =
  'flex h-[30px] w-[30px] items-center justify-center rounded-[2px] text-[#D6DBE0] transition-colors hover:bg-white/10 disabled:opacity-35';
const BTN_ON = 'bg-[#12B7F5]/22 text-[#5FD3FF] ring-1 ring-[#12B7F5]/60';

function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function RecordPanel({ session, rect, onClose, onSaved }: RecordPanelProps) {
  const toast = useToast();
  const recorderRef = useRef<RegionRecorder | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const micRef = useRef<MediaStream | null>(null);
  const dragRef = useRef<{ a: Pt; kind: RecTool } | null>(null);
  /** 原生录制的起算时刻：标注的 atMs 都相对它，和成片的第一帧对得上。 */
  const nativeClockRef = useRef(0);
  /** 激光点推送节流，别把指针事件一条不落地塞给桌面壳。 */
  const laserPushRef = useRef(0);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [tool, setTool] = useState<RecTool>('pen');
  const [color, setColor] = useState('#FB3838');
  const [anns, setAnns] = useState<RecAnn[]>([]);
  const [draft, setDraft] = useState<RecAnn | null>(null);
  const [laser, setLaser] = useState<{ x: number; y: number; t: number }[]>([]);
  const [textDraft, setTextDraft] = useState<{ pos: Pt; sx: number; sy: number; value: string } | null>(null);
  const [soundOn, setSoundOn] = useState(session.audioTracks.length > 0);
  const [voiceOn, setVoiceOn] = useState(false);
  // 桌面壳走原生 30 帧管线；网页端仍用画布 + MediaRecorder
  const [nativeRecording, setNativeRecording] = useState(false);
  const [nativeDone, setNativeDone] = useState<NativeRecordingStats | null>(null);

  const nativeCapable = hostKind() === 'tauri';

  const w = Math.max(2, Math.round(rect.w));
  const h = Math.max(2, Math.round(rect.h));

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    return () => {
      micRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // 面板被关掉时不能让录制线程在后台空转：卸载时兜底停一次
  const nativeLiveRef = useRef(false);
  useEffect(() => {
    nativeLiveRef.current = nativeRecording;
  }, [nativeRecording]);
  useEffect(() => {
    return () => {
      if (nativeLiveRef.current) void nativeStopRecording().catch(() => {});
    };
  }, []);

  // 原生录制没有 RegionRecorder 的 onTick，秒表自己走
  useEffect(() => {
    if (!nativeRecording) return;
    const timer = window.setInterval(() => setSeconds((prev) => prev + 1), 1000);
    return () => window.clearInterval(timer);
  }, [nativeRecording]);

  /** 录制叠加层：箭头、方框、文字、激光都会进成片。 */
  const drawOverlay = (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
    const s = cw / w;
    const all = draft ? [...anns, draft] : anns;
    for (const item of all) {
      ctx.save();
      if (item.kind === 'pen') {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = Math.max(1, item.width * s);
        ctx.lineCap = 'round';
        ctx.beginPath();
        item.points.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)));
        ctx.stroke();
      } else if (item.kind === 'rect' || item.kind === 'ellipse') {
        const x = Math.min(item.a.x, item.b.x) * s;
        const y = Math.min(item.a.y, item.b.y) * s;
        const rw = Math.abs(item.b.x - item.a.x) * s;
        const rh = Math.abs(item.b.y - item.a.y) * s;
        ctx.strokeStyle = item.color;
        ctx.lineWidth = Math.max(1, item.width * s);
        if (item.kind === 'rect') ctx.strokeRect(x, y, rw, rh);
        else {
          ctx.beginPath();
          ctx.ellipse(x + rw / 2, y + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (item.kind === 'arrow') {
        const ax = item.a.x * s;
        const ay = item.a.y * s;
        const bx = item.b.x * s;
        const by = item.b.y * s;
        const angle = Math.atan2(by - ay, bx - ax);
        const head = Math.max(8, item.width * s * 3);
        ctx.strokeStyle = item.color;
        ctx.fillStyle = item.color;
        ctx.lineWidth = Math.max(1, item.width * s);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - head * Math.cos(angle - Math.PI / 7), by - head * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(bx - head * Math.cos(angle + Math.PI / 7), by - head * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      } else if (item.kind === 'text') {
        ctx.fillStyle = item.color;
        ctx.font = `600 ${item.size * s}px "Microsoft YaHei UI", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(item.text, item.pos.x * s, item.pos.y * s);
      }
      ctx.restore();
    }

    const now = performance.now();
    for (const dot of laser) {
      const age = now - dot.t;
      if (age > 620) continue;
      const alpha = 1 - age / 620;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#FF4D4F';
      ctx.beginPath();
      ctx.arc(dot.x * s, dot.y * s, 6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.35;
      ctx.beginPath();
      ctx.arc(dot.x * s, dot.y * s, 12 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  // 预览循环：一直显示选区实时画面 + 标注
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const loop = () => {
      try {
        ctx.drawImage(session.video, Math.round(rect.x), Math.round(rect.y), w, h, 0, 0, w, h);
        drawOverlay(ctx, w, h);
      } catch {
        // 首帧未就绪
      }
      rafRef.current = window.requestAnimationFrame(loop);
    };
    loop();
    return () => window.cancelAnimationFrame(rafRef.current);
  });

  // 激光轨迹自动清理
  useEffect(() => {
    if (!laser.length) return;
    const timer = window.setTimeout(() => setLaser((prev) => prev.filter((d) => performance.now() - d.t < 620)), 320);
    return () => window.clearTimeout(timer);
  }, [laser]);

  const ensureMic = async (): Promise<MediaStream | null> => {
    if (micRef.current) return micRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = stream;
      return stream;
    } catch {
      toast('麦克风没有授权，无法开启麦克风', 'warn');
      return null;
    }
  };

  const buildAudio = async (): Promise<MediaStream | null> => {
    const system = soundOn && session.audioTracks.length ? new MediaStream(session.audioTracks) : null;
    const mic = voiceOn ? await ensureMic() : null;
    if (system && mic) {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const dest = ctx.createMediaStreamDestination();
        [system, mic].forEach((stream) => {
          stream.getAudioTracks().forEach((track) => {
            ctx.createMediaStreamSource(new MediaStream([track])).connect(dest);
          });
        });
        return dest.stream;
      }
    }
    return system ?? mic;
  };

  const begin = async () => {
    // 桌面壳：交给 Rust 抓帧 + FFmpeg。WebView 里轮询抓屏只有个位数帧率，
    // 那条路在桌面端录不出可交付的片子（见 docs/UPGRADE-PLAN.md 5.2）。
    if (nativeCapable) {
      try {
        const path = await nativeStartRecording(
          { x: Math.round(rect.x), y: Math.round(rect.y), width: w, height: h },
          30,
          voiceOn,
          soundOn,
        );
        if (!path) throw new Error('桌面壳没有返回录制路径');
        session.stop(); // 停掉预览轮询，把 CPU 让给录制线程
        setSeconds(0);
        setNativeDone(null);
        setNativeRecording(true);
        setRecording(true);
        // 标注的时间基准跟着开始录制走，和第一帧对齐
        nativeClockRef.current = performance.now();
        // 声音来源分开报，别一律说成「有声」，参数在 backend 里也看得见
        const sources = [voiceOn ? '麦克风' : '', soundOn ? '系统声' : ''].filter(Boolean);
        toast(
          sources.length
            ? `开始录制（原生 30 帧，采${sources.join(' + ')}）`
            : '开始录制（原生 30 帧，无声）',
          'ok',
        );
      } catch (error) {
        toast(error instanceof Error ? error.message : '无法开始原生录制', 'warn');
      }
      return;
    }
    try {
      const audio = await buildAudio();
      const recorder = new RegionRecorder(session.video, {
        rect,
        fps: 30,
        audioStream: audio,
        onTick: setSeconds,
      });
      recorder.setOverlay(drawOverlay);
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      toast(audio ? '开始录制，已收录声音' : '开始录制（无声）', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '无法开始录制', 'warn');
    }
  };

  const stop = async () => {
    if (nativeRecording) {
      try {
        const stats = await nativeStopRecording();
        setNativeRecording(false);
        setRecording(false);
        // 录完了就不再往后端推标注，避免下一段录制被上一段的笔迹串进来
        nativeClockRef.current = 0;
        if (!stats) throw new Error('没有拿到录制结果');
        setNativeDone(stats);
        const droppedNote = stats.dropped ? `，补 ${stats.dropped} 帧` : '';
        const backendNote = stats.backend ? `（${stats.backend}）` : '';
        toast(
          `录制完成：${stats.seconds} 秒，内容 ${stats.fps} 帧/秒${droppedNote}${backendNote}`,
          stats.fps >= 24 ? 'ok' : 'warn',
        );
      } catch (error) {
        setNativeRecording(false);
        setRecording(false);
        nativeClockRef.current = 0;
        toast(error instanceof Error ? error.message : '停止录制失败', 'warn');
      }
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      const next = await recorder.stop();
      setBlob(next);
      setUrl(URL.createObjectURL(next));
      setRecording(false);
      session.stop();
      toast('录制完成', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '停止录制失败', 'warn');
    }
  };

  const save = async () => {
    if (!blob) return;
    const name = timestampName('stillframe', 'webm');
    await putShot({
      id: `vid_${Date.now()}`,
      kind: 'video',
      createdAt: Date.now(),
      width: w,
      height: h,
      bytes: blob.size,
      blob,
    });
    const saved = await writeToDirectory(blob, name);
    if (!saved) toast('自动保存目录未授权，视频只存在图库里', 'warn');
    onSaved();
    toast('已存入图库', 'ok');
  };

  const toPoint = (event: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(w, ((event.clientX - box.left) / box.width) * w)),
      y: Math.max(0, Math.min(h, ((event.clientY - box.top) / box.height) * h)),
    };
  };

  /**
   * 标注一落定就推给桌面壳：坐标、线宽、字号统一归一化，
   * 后端按帧尺寸乘回来，DPI 缩放和整数缩放都不用单独换算。
   */
  const pushNativeAnn = (item: RecAnn) => {
    if (!nativeCapable || !nativeClockRef.current) return;
    const payload = toNativeAnnotation(item, w, h, performance.now() - nativeClockRef.current);
    void nativePushAnnotation(payload);
  };

  /** 激光点：40ms 一次就够画出连贯的尾巴，别把指针事件一条不落地塞给桌面壳。 */
  const pushNativeLaser = (p: Pt, force = false) => {
    if (!nativeCapable || !nativeClockRef.current) return;
    const now = performance.now();
    if (!force && now - laserPushRef.current < 40) return;
    laserPushRef.current = now;
    void nativePushLaser(p.x / w, p.y / h, now - nativeClockRef.current);
  };

  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toPoint(event);
    if (tool === 'laser') {
      setLaser((prev) => [...prev.slice(-40), { x: p.x, y: p.y, t: performance.now() }]);
      pushNativeLaser(p, true);
      return;
    }
    if (tool === 'text') {
      setTextDraft({ pos: p, sx: event.clientX, sy: event.clientY, value: '' });
      return;
    }
    dragRef.current = { a: p, kind: tool };
    if (tool === 'pen') {
      setDraft({ id: 'd', kind: 'pen', color, width: 3, points: [p] });
    }
  };

  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPoint(event);
    if (tool === 'laser' && event.buttons === 1) {
      setLaser((prev) => [...prev.slice(-40), { x: p.x, y: p.y, t: performance.now() }]);
      pushNativeLaser(p);
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pen') {
      setDraft((prev) =>
        prev && prev.kind === 'pen'
          ? { ...prev, points: [...prev.points, p] }
          : { id: 'd', kind: 'pen', color, width: 3, points: [drag.a, p] },
      );
    } else if (drag.kind === 'rect' || drag.kind === 'ellipse') {
      // Shift 等比：录屏标注也跟截图编辑器同一套手感（方块 / 正圆）
      if (event.shiftKey) {
        const box = squareRect(drag.a, p);
        setDraft({
          id: 'd',
          kind: drag.kind,
          color,
          width: 3,
          a: { x: box.x, y: box.y },
          b: { x: box.x + box.w, y: box.y + box.h },
        });
        return;
      }
      setDraft({ id: 'd', kind: drag.kind, color, width: 3, a: drag.a, b: p });
    } else if (drag.kind === 'arrow') {
      // Alt 吸附：箭头吸到 0/45/90°，画垂直指向不会歪
      const to = event.altKey ? snapAngle(drag.a, p) : p;
      setDraft({ id: 'd', kind: 'arrow', color, width: 3, a: drag.a, b: to });
    }
  };

  const onUp = () => {
    const current = draft;
    dragRef.current = null;
    setDraft(null);
    if (!current) return;
    if ('points' in current && current.points.length < 2) return;
    if ('b' in current && Math.hypot(current.b.x - current.a.x, current.b.y - current.a.y) < 4) return;
    setAnns((prev) => [...prev, { ...current, id: `r${prev.length + 1}` } as RecAnn]);
    // 边录边推：桌面壳按 atMs 决定这条从第几帧开始出现，不用等录完再合成
    pushNativeAnn(current);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-ink-950">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-6 pb-20">
        {url ? (
          <video src={url} controls className="max-h-full max-w-full shadow-stage" />
        ) : (
          <div className="relative max-h-full max-w-full">
            <canvas
              ref={previewRef}
              className="max-h-full max-w-full touch-none shadow-stage ring-1 ring-white/10"
              style={{ aspectRatio: `${w} / ${h}` }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            {textDraft ? (
              <input
                autoFocus
                value={textDraft.value}
                className="absolute z-20 w-[220px] border border-[#12B7F5] bg-ink-900 px-2 py-1 text-[12px] text-paper outline-none"
                style={{ left: Math.min(textDraft.sx, window.innerWidth - 260), top: textDraft.sy }}
                onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setTextDraft(null);
                  if (e.key === 'Enter' && textDraft.value.trim()) {
                    const item: RecAnn = {
                      id: `t${anns.length + 1}`,
                      kind: 'text',
                      color,
                      size: 18,
                      pos: textDraft.pos,
                      text: textDraft.value.trim(),
                    };
                    setAnns((prev) => [...prev, item]);
                    pushNativeAnn(item);
                    setTextDraft(null);
                  }
                }}
                onBlur={() => setTextDraft(null)}
              />
            ) : null}
          </div>
        )}

        {recording ? (
          <div className="absolute left-4 top-3 flex items-center gap-2 rounded-[2px] bg-black/60 px-2 py-1 font-mono text-[11px] text-[#FF5A5F]">
            <span className="h-2 w-2 rounded-full bg-[#FF5A5F]" /> REC · {formatClock(seconds)}
          </div>
        ) : null}
        {!recording && !url ? (
          <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 font-mono text-[10px] tracking-wider text-muted/70">
            <span className="border border-white/10 bg-black/40 px-1.5 py-0.5 text-paper/70">{QQ_TEXT.record}</span>
            <span>
              {w} × {h}
            </span>
          </div>
        ) : null}
      </div>

      {/* QQ 录屏工具栏：画笔 / 矩形 / 椭圆 / 箭头 / 文字 / 激光 | 撤销 / 清除 | 声音 / 麦克风 | 退出 / 开始-结束 */}
      {!url ? (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-0.5 rounded-[3px] bg-[#1F2226]/95 px-1.5 py-1 shadow-[0_6px_22px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
            {(
              [
                ['pen', Brush, '画刷工具'],
                ['rect', Square, '矩形工具'],
                ['ellipse', Circle, '椭圆工具'],
                ['arrow', ArrowUpRight, '箭头工具'],
                ['text', Type, '文字工具'],
                ['laser', Zap, '激光工具'],
              ] as const
            ).map(([id, Icon, tip]) => (
              <button
                key={id}
                type="button"
                title={tip}
                aria-pressed={tool === id}
                className={`${BTN} ${tool === id ? BTN_ON : ''}`}
                onClick={() => setTool(id)}
              >
                <Icon size={16} strokeWidth={1.7} />
              </button>
            ))}

            <span className="mx-1 h-[16px] w-px bg-white/15" />

            <button
              type="button"
              title="撤销"
              className={BTN}
              disabled={!anns.length}
              onClick={() => {
                setAnns((prev) => prev.slice(0, -1));
                // 成片里后面的帧也得跟着撤，否则画布上没了、片子里还挂着
                if (nativeRecording) void nativeUndoAnnotation();
              }}
            >
              <Undo2 size={16} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              title={QQ_TEXT.clear}
              className={BTN}
              disabled={!anns.length}
              onClick={() => {
                setAnns([]);
                setLaser([]);
                if (nativeRecording) void nativeClearAnnotation();
              }}
            >
              <Eraser size={16} strokeWidth={1.7} />
            </button>

            <span className="mx-1 h-[16px] w-px bg-white/15" />

            <button
              type="button"
              title={nativeCapable ? (soundOn ? '系统声已开（WASAPI 环回）' : '录系统声：扬声器里放什么就录什么') : soundOn ? QQ_TEXT.soundOff : QQ_TEXT.soundOn}
              disabled={nativeRecording}
              className={`${BTN} ${soundOn ? BTN_ON : ''} disabled:opacity-35`}
              onClick={() => {
                const next = !soundOn;
                // 桌面壳里系统声由 Rust 的 WASAPI 环回采，WebView 这层没有音轨可开关
                if (nativeCapable) {
                  setSoundOn(next);
                  return;
                }
                session.audioTracks.forEach((track) => {
                  track.enabled = next;
                });
                setSoundOn(next);
                if (!session.audioTracks.length) toast('本次共享没有系统声音，浏览器弹窗里要勾选音频', 'warn');
              }}
            >
              {soundOn ? <Volume2 size={16} strokeWidth={1.7} /> : <VolumeX size={16} strokeWidth={1.7} />}
            </button>
            <button
              type="button"
              title={voiceOn ? QQ_TEXT.voiceOff : QQ_TEXT.voiceOn}
              disabled={nativeRecording}
              className={`${BTN} ${voiceOn ? BTN_ON : ''} disabled:opacity-35`}
              onClick={async () => {
                // 桌面壳里真正采声的是 Rust 的 dshow，不经 WebView，所以别在这一步
                // 卡 getUserMedia 授权；设备不可用那边会静默退回无声，结果条看得出来。
                if (nativeCapable) {
                  setVoiceOn(!voiceOn);
                  return;
                }
                if (voiceOn) {
                  micRef.current?.getTracks().forEach((track) => track.stop());
                  micRef.current = null;
                  setVoiceOn(false);
                  return;
                }
                const mic = await ensureMic();
                if (mic) setVoiceOn(true);
              }}
            >
              {voiceOn ? <Mic size={16} strokeWidth={1.7} /> : <MicOff size={16} strokeWidth={1.7} />}
            </button>

            <span className="mx-1 h-[16px] w-px bg-white/15" />

            <button type="button" title={QQ_TEXT.exitTip} className={BTN} onClick={onClose}>
              <X size={16} strokeWidth={1.8} />
            </button>
            {!recording ? (
              <button
                type="button"
                className="ml-0.5 flex h-[30px] items-center gap-1 rounded-[2px] bg-[#12B7F5] px-2.5 text-[12px] font-medium text-[#04212E] hover:bg-[#3AC5FA]"
                onClick={() => void begin()}
              >
                <Play size={13} strokeWidth={2.2} />
                {QQ_TEXT.recordStart}
              </button>
            ) : (
              <button
                type="button"
                className="ml-0.5 flex h-[30px] items-center gap-1 rounded-[2px] bg-[#FF5A5F] px-2.5 text-[12px] font-medium text-white hover:bg-[#FF7378]"
                onClick={() => void stop()}
              >
                <Square size={12} strokeWidth={2.2} />
                {QQ_TEXT.recordEnd}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {nativeDone ? (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[3px] bg-[#1F2226]/95 px-2.5 py-1.5 ring-1 ring-white/10">
          <Video size={14} className="text-[#5FD3FF]" />
          <span className="font-mono text-[11px] text-[#C7CDD3]">
            {nativeDone.seconds.toFixed(1)}s · {nativeDone.fps}fps · {nativeDone.frames} 帧
          </span>
          {nativeDone.backend ? (
            <span className="font-mono text-[10px] text-[#5FD3FF]/80" title="实际走的抓帧 + 编码组合">
              {nativeDone.backend}
            </span>
          ) : null}
          <span className="max-w-[240px] truncate text-[11px] text-[#8A9199]" title={nativeDone.path}>
            {nativeDone.path}
          </span>
          <button
            type="button"
            className="rounded-[2px] bg-[#12B7F5] px-2 py-1 text-[11.5px] text-[#04212E]"
            onClick={() => {
              navigator.clipboard
                ?.writeText(nativeDone.path)
                .then(() => toast('路径已复制，可直接粘到资源管理器', 'ok'))
                .catch(() => toast('复制失败，请手动选中路径', 'warn'));
            }}
          >
            复制路径
          </button>
        </div>
      ) : null}

      {url ? (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-[3px] bg-[#1F2226]/95 px-2 py-1.5 ring-1 ring-white/10">
          <Video size={14} className="text-[#5FD3FF]" />
          <span className="font-mono text-[11px] text-[#C7CDD3]">
            {blob ? `${(blob.size / 1024 / 1024).toFixed(2)} MB` : ''} · {formatClock(seconds)}
          </span>
          <button
            type="button"
            className="ml-1 rounded-[2px] bg-[#12B7F5] px-2 py-1 text-[11.5px] text-[#04212E]"
            onClick={() => blob && downloadBlob(blob, timestampName('stillframe', 'webm'))}
          >
            下载
          </button>
          <button type="button" className="rounded-[2px] px-2 py-1 text-[11.5px] text-[#C7CDD3] hover:bg-white/10" onClick={() => void save()}>
            <Save size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
