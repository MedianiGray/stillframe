import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Copy, Languages, Settings2, Upload, X } from 'lucide-react';
import type { Settings } from '../../lib/settings';
import { recognize } from '../../lib/ocr';
import { GLOSSARY_KEY, loadGlossary, parseGlossary, type Glossary } from '../../lib/glossary';
import { providerReady, translateText } from '../../lib/translate';
import { useToast } from '../Toasts';

interface TranslatePanelProps {
  image: HTMLCanvasElement;
  settings: Settings;
  onClose: () => void;
  onOpenSettings: () => void;
}

const TARGETS = [
  { id: 'zh', label: '简体中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'ru', label: 'Русский' },
];

export function TranslatePanel({ image, settings, onClose, onOpenSettings }: TranslatePanelProps) {
  const toast = useToast();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState(settings.translateTarget || 'zh');
  const [translated, setTranslated] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [glossary, setGlossary] = useState<Glossary>(() => loadGlossary());
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const targetRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const syncLock = useRef(false);
  const preview = useMemo(() => image.toDataURL('image/png'), [image]);
  const ready = providerReady(settings);
  const glossaryCount = Object.keys(glossary).length;

  /** 双栏同步滚动：按滚动比例对齐，用锁避免来回触发。 */
  const syncScroll = (from: 'source' | 'target') => {
    if (syncLock.current) return;
    const fromEl = from === 'source' ? sourceRef.current : targetRef.current;
    const toEl = from === 'source' ? targetRef.current : sourceRef.current;
    if (!fromEl || !toEl) return;
    const fromMax = fromEl.scrollHeight - fromEl.clientHeight;
    const toMax = toEl.scrollHeight - toEl.clientHeight;
    if (fromMax <= 0 || toMax <= 0) return;
    syncLock.current = true;
    toEl.scrollTop = (fromEl.scrollTop / fromMax) * toMax;
    requestAnimationFrame(() => {
      syncLock.current = false;
    });
  };

  const importGlossary = async (file: File) => {
    const parsed = parseGlossary(await file.text());
    const count = Object.keys(parsed).length;
    if (count === 0) {
      toast('没有解析到术语，请用「原词,译词」或 JSON 格式', 'warn');
      return;
    }
    const next = { ...glossary, ...parsed };
    setGlossary(next);
    localStorage.setItem(GLOSSARY_KEY, JSON.stringify(next));
    toast(`已导入 ${count} 条术语`, 'ok');
  };

  const run = async () => {
    setBusy(true);
    setTranslated('');
    try {
      setStage('识别画面文字');
      const ocr = await recognize(image, { lang: settings.ocrLang, langPath: settings.tessdataPath });
      setSource(ocr.text);
      if (!ocr.text) {
        toast('画面里没有识别到文字', 'warn');
        return;
      }
      setStage('翻译中');
      const result = await translateText(ocr.text, { ...settings, translateTarget: target }, glossary);
      setTranslated(result.text);
      toast(`已用 ${result.provider} 完成翻译`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '翻译失败', 'warn');
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast('已复制', 'ok');
    } catch {
      toast('复制失败', 'warn');
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="stage-grid flex w-[300px] shrink-0 items-center justify-center border-r border-ink-600/50 p-5">
        <img src={preview} alt="待翻译区域" className="max-h-full max-w-full shadow-stage" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Languages size={14} className="text-amber" />
          <span className="label">屏幕翻译</span>
          <select className="field !w-auto !py-1.5" value={target} onChange={(event) => setTarget(event.target.value)}>
            {TARGETS.map((item) => (
              <option key={item.id} value={item.id}>
                译为 {item.label}
              </option>
            ))}
          </select>
          {ready ? (
            <button type="button" className="btn btn-accent" disabled={busy} onClick={run}>
              识别并翻译 <ArrowRight size={14} />
            </button>
          ) : (
            <button type="button" className="btn btn-accent" onClick={onOpenSettings}>
              <Settings2 size={14} /> 先去配置翻译接口
            </button>
          )}
          {busy ? <span className="font-mono text-[11px] text-amber">{stage}</span> : null}
          <span className="mx-1 h-[14px] w-px bg-white/15" />
          <button type="button" className="btn btn-ghost !py-1.5" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> 术语表 {glossaryCount > 0 ? `· ${glossaryCount}` : ''}
          </button>
          {glossaryCount > 0 ? (
            <button
              type="button"
              className="font-mono text-[10px] text-muted hover:text-signal-warn"
              onClick={() => {
                setGlossary({});
                localStorage.removeItem(GLOSSARY_KEY);
                toast('已清空术语表', 'ok');
              }}
            >
              清空
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importGlossary(file);
            }}
          />
        </div>

        {!ready ? (
          <p className="mt-3 border-l-2 border-signal-warn/50 bg-ink-850 px-3 py-2 text-[12px] leading-5 text-muted">
            翻译需要一个接口：OpenAI 兼容端点、DeepL Key 或自建 LibreTranslate 都行。填好之后回到这里即可。
          </p>
        ) : null}

        <div className="mt-4 grid min-h-0 flex-1 gap-3 md:grid-cols-2">
          <div className="flex min-h-0 flex-col border border-ink-600 bg-ink-850">
            <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
              <span className="label">原文</span>
              <button type="button" className="text-muted hover:text-paper" disabled={!source} onClick={() => copy(source)} aria-label="复制原文">
                <Copy size={13} />
              </button>
            </div>
            <textarea
              ref={sourceRef}
              className="min-h-[180px] flex-1 resize-none bg-transparent p-3 text-[13px] leading-6 text-paper/85 outline-none"
              value={source}
              placeholder="识别到的原文"
              onChange={(event) => setSource(event.target.value)}
              onScroll={() => syncScroll('source')}
            />
          </div>

          <div className="flex min-h-0 flex-col border border-ink-600 bg-ink-850">
            <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
              <span className="label">译文</span>
              <button type="button" className="text-muted hover:text-paper" disabled={!translated} onClick={() => copy(translated)} aria-label="复制译文">
                <Copy size={13} />
              </button>
            </div>
            <textarea
              ref={targetRef}
              className="min-h-[180px] flex-1 resize-none bg-transparent p-3 text-[13px] leading-6 text-paper outline-none"
              value={translated}
              placeholder="翻译结果"
              onChange={(event) => setTranslated(event.target.value)}
              onScroll={() => syncScroll('target')}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[10px] text-muted">
            {settings.translateProvider === 'none' ? '未配置接口' : `接口 · ${settings.translateProvider}`}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            <X size={14} /> 返回捕捉台
          </button>
        </div>
      </div>
    </div>
  );
}
