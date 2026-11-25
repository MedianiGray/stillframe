import { useEffect, useRef, useState } from 'react';
import { Download, Pause, Play, Save, Square, Video } from 'lucide-react';
import type { Rect } from '../../lib/types';
import type { ScreenSession } from '../../lib/capture';
import { RegionRecorder } from '../../lib/recorder';
import { downloadBlob, timestampName } from '../../lib/image';
import { putShot } from '../../lib/storage';
import { writeToDirectory } from '../../lib/autosave';
import { useToast } from '../Toasts';

interface RecordPanelProps {
  session: ScreenSession;
  rect: Rect;
  onClose: () => void;
  onSaved: () => void;
}

function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function RecordPanel({ session, rect, onClose, onSaved }: RecordPanelProps) {
  const toast = useToast();
  const recorderRef = useRef<RegionRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const begin = () => {
    try {
      const audio = session.audioTracks.length
        ? new MediaStream(session.audioTracks)
        : null;
      const recorder = new RegionRecorder(session.video, {
        rect,
        fps: 30,
        audioStream: audio,
        onTick: setSeconds,
      });
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setPaused(false);
      toast(audio ? '开始录制，已收录声音' : '开始录制（无声）', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '无法开始录制', 'warn');
    }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (paused) recorder.resume();
    else recorder.pause();
    setPaused((v) => !v);
  };

  const stop = async () => {
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
      width: Math.round(rect.w),
      height: Math.round(rect.h),
      bytes: blob.size,
      blob,
    });
    const saved = await writeToDirectory(blob, name);
    if (!saved) toast('自动保存目录未授权，视频只存在图库里', 'warn');
    onSaved();
    toast('已存入图库', 'ok');
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="stage-grid relative flex min-w-0 flex-1 items-center justify-center p-6">
        {url ? (
          <video src={url} controls className="max-h-full max-w-full shadow-stage" />
        ) : (
          <div className="relative flex h-[220px] w-[360px] items-center justify-center border border-ink-600 bg-ink-850">
            <span className="frame-corner left-2 top-2 border-l-2 border-t-2" />
            <span className="frame-corner bottom-2 right-2 border-b-2 border-r-2" />
            <div className="flex flex-col items-center gap-3">
              <Video size={26} className={recording ? 'text-signal-rec' : 'text-muted'} />
              <span className="font-mono text-[22px] tabular tracking-widest text-paper">
                {formatClock(seconds)}
              </span>
              <span className="font-mono text-[10px] tracking-wider text-muted">
                {Math.round(rect.w)} × {Math.round(rect.h)} · 30 FPS
              </span>
            </div>
          </div>
        )}
        {recording ? (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 border border-signal-rec/60 bg-ink-900/90 px-3 py-1 font-mono text-[11px] text-signal-rec">
            {paused ? 'PAUSED' : 'REC'} · {formatClock(seconds)}
          </div>
        ) : null}
      </div>

      <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-ink-600/50 bg-ink-900">
        <div className="border-b border-ink-600/50 p-4">
          <span className="label">录制</span>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {!recording ? (
              <button type="button" className="btn btn-accent col-span-2" onClick={begin} disabled={!!blob}>
                <Play size={14} /> 开始录制
              </button>
            ) : (
              <>
                <button type="button" className="btn" onClick={togglePause}>
                  {paused ? <Play size={14} /> : <Pause size={14} />}
                  {paused ? '继续' : '暂停'}
                </button>
                <button type="button" className="btn" onClick={stop}>
                  <Square size={13} /> 停止
                </button>
              </>
            )}
          </div>
          {session.audioTracks.length === 0 ? (
            <p className="mt-2 text-[11px] leading-5 text-muted">
              本次共享没有带上系统声音。要录声音，请在浏览器的共享弹窗里勾选「分享标签页音频 / 系统音频」。
            </p>
          ) : null}
        </div>

        {blob ? (
          <div className="p-4">
            <span className="label">结果</span>
            <p className="mt-2 font-mono text-[11px] text-muted">
              {(blob.size / 1024 / 1024).toFixed(2)} MB · {formatClock(seconds)}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <button type="button" className="btn btn-accent" onClick={() => downloadBlob(blob, timestampName('stillframe', 'webm'))}>
                <Download size={14} /> 下载
              </button>
              <button type="button" className="btn" onClick={save}>
                <Save size={14} /> 存图库
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-auto p-4">
          <button type="button" className="btn btn-ghost w-full" onClick={onClose}>
            返回捕捉台
          </button>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            网页端输出 WebM（VP9 / Opus）。要 MP4，请用仓库 desktop 目录里的本地转码脚本。
          </p>
        </div>
      </aside>
    </div>
  );
}
