import { useMemo, useState } from 'react';
import { Copy, ScanText, Save, X } from 'lucide-react';
import type { Settings } from '../../lib/settings';
import { recognize } from '../../lib/ocr';
import { makeThumbnail } from '../../lib/image';
import { putShot } from '../../lib/storage';
import { useToast } from '../Toasts';

interface OcrPanelProps {
  image: HTMLCanvasElement;
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}

const LANGS = [
  { id: 'chi_sim+eng', label: '中文 + 英文' },
  { id: 'eng', label: '仅英文' },
  { id: 'chi_sim', label: '仅中文' },
  { id: 'jpn', label: '日文' },
];

export function OcrPanel({ image, settings, onClose, onSaved }: OcrPanelProps) {
  const toast = useToast();
  const [lang, setLang] = useState(settings.ocrLang || 'chi_sim+eng');
  const [text, setText] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => image.toDataURL('image/png'), [image]);

  const run = async () => {
    setBusy(true);
    setProgress(0);
    setStatus('准备语言包');
    try {
      const result = await recognize(image, {
        lang,
        langPath: settings.tessdataPath,
        onProgress: (value, state) => {
          setProgress(Math.round(value * 100));
          setStatus(state === 'recognizing text' ? '正在识别' : state);
        },
      });
      setText(result.text);
      setConfidence(result.confidence);
      toast(result.text ? '识别完成' : '没有识别到文字', result.text ? 'ok' : 'warn');
    } catch (error) {
      toast(error instanceof Error ? error.message : '识别失败，可能是语言包下载失败', 'warn');
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制文字', 'ok');
    } catch {
      toast('复制失败，请手动选中', 'warn');
    }
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
                {status} · {progress}%
              </p>
            </div>
          ) : null}
          {confidence !== null ? (
            <p className="mt-2 font-mono text-[10px] text-muted">置信度 {confidence.toFixed(1)}</p>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <span className="label">识别结果</span>
          <textarea
            className="field mt-2 min-h-[200px] flex-1 resize-none !leading-6"
            placeholder="识别结果会出现在这里，也可以直接改"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted">
            <span>{text.length} 字符</span>
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
          <button type="button" className="btn btn-ghost mt-2 w-full" onClick={onClose}>
            <X size={14} /> 返回捕捉台
          </button>
        </div>
      </aside>
    </div>
  );
}
