import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileDown, Languages, ScanText, Save, X } from 'lucide-react';
import type { Settings } from '../../lib/settings';
import { recognize, toOcrBlob } from '../../lib/ocr';
import { detectContent } from '../../lib/intent';
import { hostKind, nativeTessdata } from '../../lib/desktop';
import { makeThumbnail, downloadBlob, timestampName } from '../../lib/image';
import { paragraphsToMarkdown } from '../../lib/markdown';
import { putShot } from '../../lib/storage';
import { useToast } from '../Toasts';

interface OcrPanelProps {
  image: HTMLCanvasElement;
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
  /** 带着同一张图转去译屏；识别结果已在本面板展示，翻译面板会再跑一次本地 OCR。 */
  onTranslate?: () => void;
}

const LANGS = [
  { id: 'chi_sim+eng', label: '中文 + 英文' },
  { id: 'eng', label: '仅英文' },
  { id: 'chi_sim', label: '仅中文' },
  { id: 'jpn', label: '日文' },
];

/** tesseract 的状态是英文枚举，面板上直接摊给用户不好读，这里翻一层。 */
const STATUS_TEXT: Record<string, string> = {
  'loading tesseract core': '加载识别内核',
  'initializing tesseract': '初始化识别引擎',
  'loading language traineddata': '首次下载语言包（约 1.7MB）',
  'initializing api': '准备识别接口',
  'recognizing text': '正在识别文字',
};

export function OcrPanel({ image, settings, onClose, onSaved, onTranslate }: OcrPanelProps) {
  const toast = useToast();
  const [lang, setLang] = useState(settings.ocrLang || 'chi_sim+eng');
  const [text, setText] = useState('');
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'flow' | 'para'>('flow');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoRanRef = useRef(false);
  const preview = useMemo(() => image.toDataURL('image/png'), [image]);
  // 识别结果一出来就说清楚「这是什么」，并预选一个动作；判读随编辑实时更新。
  const read = useMemo(() => detectContent(text), [text]);

  const run = async () => {
    setBusy(true);
    setError('');
    setProgress(0);
    setStatus('准备语言包');
    try {
      const blob = await toOcrBlob(image);
      const result = await recognize(blob, {
        lang,
        langPath: settings.tessdataPath,
        // 桌面壳内置了语言包：离线也能取字，不依赖 WebView 的网络栈。
        loadGzBase64: hostKind() === 'tauri' ? (code) => nativeTessdata(code) : undefined,
        onProgress: (value, state) => {
          setProgress(Math.round(value * 100));
          setStatus(STATUS_TEXT[state] ?? state);
        },
      });
      setText(result.text);
      setParagraphs(result.paragraphs);
      setConfidence(result.confidence);
      toast(result.text ? `识别完成 · ${result.paragraphs.length} 段` : '没有识别到文字', result.text ? 'ok' : 'warn');
    } catch (error) {
      const message = error instanceof Error ? error.message : '识别失败，可能是语言包下载失败';
      setError(message);
      toast(message, 'warn');
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  // 系统截图的取字是「框完立刻出字」，不该再让用户点一次识别：进面板即自动跑一次。
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    void run();
    // 仅首帧自动识别，换语言由用户点「识别」触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制文字', 'ok');
    } catch {
      toast('复制失败，请手动选中', 'warn');
    }
  };

  const exportDocs = () => {
    // 以当前可编辑的内容为准：段落视图用聚好的段落，行视图保持逐行结构
    const source =
      viewMode === 'para' && paragraphs.length
        ? paragraphs
        : text
            .split('\n')
            .map((line) => line.trimEnd())
            .filter((line) => line.trim().length > 0);
    if (!source.length) return;
    const doc = paragraphsToMarkdown(source, {
      kind: read?.kind,
      footer: '本地识别 · stillframe',
    });
    downloadBlob(new Blob([doc], { type: 'text/markdown;charset=utf-8' }), timestampName('取字', 'md'));
    toast(`已导出 Markdown · ${source.length} 段`, 'ok');
  };

  const save = async () => {
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        image.toBlob((value) => (value ? resolve(value) : reject(new Error('导出失败'))), 'image/png');
      });
      await putShot({
        id: `img_${Date.now()}`,
        kind: 'image',
        createdAt: Date.now(),
        width: image.width,
        height: image.height,
        bytes: blob.size,
        blob,
        text,
        thumb: makeThumbnail(image, 240),
      });
      onSaved();
      toast('已连同识别文本存入图库', 'ok');
    } catch {
      toast('存入图库失败', 'warn');
    }
  };

  const applySuggested = () => {
    if (!read) return;
    if (read.suggest === 'translate' && onTranslate) {
      onTranslate();
      return;
    }
    // 没有译屏入口时退回复制，别让按钮点了像坏了。
    if (read.suggest === 'keep') {
      void save();
      return;
    }
    void copy();
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="stage-grid flex min-w-0 flex-1 items-center justify-center p-6">
        <img src={preview} alt="待识别区域" className="max-h-full max-w-full shadow-stage" />
      </div>

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-ink-600/50 bg-ink-900">
        <div className="border-b border-ink-600/50 p-4">
          <div className="flex items-center gap-2">
            <ScanText size={13} className="text-amber" />
            <span className="label">提取文字</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <select className="field !py-1.5" value={lang} onChange={(event) => setLang(event.target.value)}>
              {LANGS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-accent shrink-0" disabled={busy} onClick={run}>
              识别
            </button>
          </div>
          {busy ? (
            <div className="mt-3">
              <div className="h-1 w-full bg-ink-700">
                <div className="h-1 bg-amber transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
              </div>
              <p className="mt-1.5 font-mono text-[10px] text-muted">
                {status || '准备中'} · {progress}%
              </p>
              {status.startsWith('首次下载') ? (
                <p className="mt-1 text-[10.5px] leading-4 text-muted/80">
                  只有第一次需要下载，之后读本地缓存；内网可把 tessdata 放进站点目录或设置里指定。
                </p>
              ) : null}
            </div>
          ) : null}
          {confidence !== null ? (
            <p className="mt-2 font-mono text-[10px] text-muted">置信度 {confidence.toFixed(1)}</p>
          ) : null}
          {error ? (
            <div className="mt-2 border-l-2 border-signal-warn/60 bg-ink-850 px-2 py-1.5">
              <p className="text-[11px] leading-4 text-signal-warn/90">{error}</p>
              <p className="mt-1 text-[10.5px] leading-4 text-muted">
                语言包只在第一次识别时下载，之后走本地缓存。离线或内网环境可在设置里填内网 language-data 目录。
              </p>
              <button type="button" className="mt-1.5 text-[11px] text-amber hover:underline" onClick={() => void run()}>
                重试识别
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="flex items-center justify-between">
            <span className="label">识别结果</span>
            {paragraphs.length > 0 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] ${viewMode === 'para' ? 'bg-amber/20 text-amber' : 'text-muted hover:text-paper'}`}
                  onClick={() => setViewMode('para')}
                >
                  段落视图
                </button>
                <button
                  type="button"
                  className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] ${viewMode === 'flow' ? 'bg-amber/20 text-amber' : 'text-muted hover:text-paper'}`}
                  onClick={() => setViewMode('flow')}
                >
                  可编辑
                </button>
              </div>
            ) : null}
          </div>

          {read ? (
            <div className="mt-2 flex items-center gap-2 border-l-2 border-amber/50 bg-ink-850 px-2 py-1.5">
              <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-muted/60">
                检测到
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-paper/85" title={read.summary}>
                {read.summary}
              </span>
              <button
                type="button"
                className="shrink-0 font-mono text-[10px] text-amber hover:underline"
                onClick={applySuggested}
                title="只是建议，点不点由你决定"
              >
                按建议{read.actionLabel}
              </button>
            </div>
          ) : null}

          {viewMode === 'para' && paragraphs.length > 0 ? (
            <div className="mt-2 min-h-[200px] flex-1 space-y-1.5 overflow-auto border border-ink-600/40 bg-ink-950 p-2">
              {paragraphs.map((paragraph, index) => (
                <div
                  key={`${index}-${paragraph.slice(0, 8)}`}
                  className="group flex items-start gap-1.5 border-l border-amber/30 bg-ink-900/60 px-2 py-1.5"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[9px] text-muted/70">{index + 1}</span>
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] leading-5 text-paper/85">
                    {paragraph}
                  </p>
                  <button
                    type="button"
                    className="shrink-0 font-mono text-[9px] text-muted opacity-0 transition group-hover:opacity-100 hover:text-paper"
                    onClick={() => {
                      void navigator.clipboard?.writeText(paragraph);
                      toast(`已复制第 ${index + 1} 段`, 'ok');
                    }}
                  >
                    复制
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <textarea
              className="field mt-2 min-h-[200px] flex-1 resize-none !leading-6"
              placeholder="识别结果会出现在这里，也可以直接改"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted">
            <span>
              {text.length} 字符{paragraphs.length > 0 ? ` · ${paragraphs.length} 段` : ''}
            </span>
            <span>本地识别 · 不上传图片</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button type="button" className="btn" disabled={!text} onClick={copy}>
              <Copy size={14} /> 复制
            </button>
            <button type="button" className="btn" disabled={!text} onClick={save}>
              <Save size={14} /> 存图库
            </button>
          </div>
          <button
            type="button"
            className="btn mt-1.5 w-full"
            disabled={!text}
            onClick={exportDocs}
            title="按当前视图导出 Markdown：清单补「-」，代码包代码块"
          >
            <FileDown size={14} /> 导出 Markdown
          </button>
          <button
            type="button"
            className="btn btn-accent mt-2 w-full"
            disabled={!text}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                toast('已复制，已收起取字台', 'ok');
                onClose();
              } catch {
                toast('复制失败，请手动选中', 'warn');
              }
            }}
          >
            复制并收起
          </button>
          <button type="button" className="btn btn-ghost mt-2 w-full" onClick={onClose}>
            <X size={14} /> 返回捕捉台
          </button>
          {onTranslate ? (
            <button
              type="button"
              className="btn btn-ghost mt-1.5 w-full"
              onClick={() => {
                onTranslate();
              }}
            >
              <Languages size={14} /> 译屏 · 把这张图转成译文
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
