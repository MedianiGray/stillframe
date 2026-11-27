import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Annotation, AnnotationKind, Point, Rect } from '../lib/types';
import { drawAnnotations, rectFromPoints, snapAngle, squareRect } from '../lib/annotate';
import { canvasToBlob, copyBlobToClipboard, makeThumbnail, timestampName } from '../lib/image';
import { putShot } from '../lib/storage';
import { describeSave, saveBlob } from '../lib/save';
import { applyFilter } from '../lib/filters';
import { QQ_TEXT, type QqFilterId } from '../lib/qqspec';
import { useToast } from './Toasts';
import { QqToolbar } from './QqToolbar';
import type { Settings } from '../lib/settings';

interface EditorProps {
  image: HTMLCanvasElement;
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
  onPin: (dataUrl: string, width: number, height: number) => void;
  /** 从工具栏继续做长截图 / 识图 / 翻译 / 录屏，都会把当前成图带过去。 */
  onLong?: (image: HTMLCanvasElement) => void;
  onOcr?: (image: HTMLCanvasElement) => void;
  onTranslate?: (image: HTMLCanvasElement) => void;
  onRecord?: () => void;
}

interface TextDraft {
  point: Point;
  screenX: number;
  screenY: number;
  value: string;
}

let seq = 0;
const nextId = () => {
  seq += 1;
  return `a${seq}`;
};

export function Editor({ image, settings, onClose, onSaved, onPin, onLong, onOcr, onTranslate, onRecord }: EditorProps) {
  const toast = useToast();
  const [tool, setTool] = useState<AnnotationKind>('rect');
  const [color, setColor] = useState('#FB3838');
  const [weight, setWeight] = useState(3);
  const [mosaicBlock, setMosaicBlock] = useState(12);
  const [fontSize, setFontSize] = useState(18);
  const [filter, setFilter] = useState<QqFilterId>('none');
  const [history, setHistory] = useState<Annotation[][]>([[]]);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ start: Point; kind: AnnotationKind } | null>(null);

  const annotations = history[index];
  /** QQ 的滤镜作用在底图上，标注永远画在滤镜之上。 */
  const base = useMemo(() => (filter === 'none' ? image : applyFilter(image, filter)), [filter, image]);
  const dataUrl = useMemo(() => base.toDataURL('image/png'), [base]);

  const commit = useCallback(
    (next: Annotation[]) => {
      setHistory((prev) => [...prev.slice(0, index + 1), next]);
      setIndex((prev) => prev + 1);
    },
    [index],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => {
      const cw = Math.max(120, wrap.clientWidth - 96);
      const ch = Math.max(120, wrap.clientHeight - 118);
      const ratio = Math.min(cw / image.width, ch / image.height, 1);
      setBox({ w: Math.round(image.width * ratio), h: Math.round(image.height * ratio) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [image]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAnnotations(ctx, draft ? [...annotations, draft] : annotations, { mosaicSource: base });
  }, [annotations, draft, base, image]);

  const toImagePoint = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(image.width, ((event.clientX - rect.left) / rect.width) * image.width)),
        y: Math.max(0, Math.min(image.height, ((event.clientY - rect.top) / rect.height) * image.height)),
      };
    },
    [image],
  );

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toImagePoint(event);

    if (tool === 'text') {
      setTextDraft({ point, screenX: event.clientX, screenY: event.clientY, value: '' });
      return;
    }

    if (tool === 'step') {
      const stepCount = annotations.filter((item) => item.kind === 'step').length + 1;
      commit([...annotations, { id: nextId(), kind: 'step', color, pos: point, index: stepCount }]);
      return;
    }

    dragRef.current = { start: point, kind: tool };
    if (tool === 'pen') {
      setDraft({ id: 'draft', kind: 'pen', color, weight, points: [point] });
    }
  };

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toImagePoint(event);
    // Shift 等比：矩形 / 椭圆 / 荧光 / 马赛克都变正方形（分别得到正方形、正圆、方块）
    const rect: Rect = event.shiftKey ? squareRect(drag.start, point) : rectFromPoints(drag.start, point);
    // Alt 吸附：箭头吸到 0/45/90°，要画垂直指示线时不用手抖
    const arrowTo = event.altKey ? snapAngle(drag.start, point) : point;

    switch (drag.kind) {
      case 'pen':
        setDraft((prev) =>
          prev && prev.kind === 'pen'
            ? { ...prev, points: [...prev.points, point] }
            : { id: 'draft', kind: 'pen', color, weight, points: [drag.start, point] },
        );
        break;
      case 'rect':
        setDraft({ id: 'draft', kind: 'rect', color, weight, rect });
        break;
      case 'ellipse':
        setDraft({ id: 'draft', kind: 'ellipse', color, weight, rect });
        break;
      case 'arrow':
        setDraft({ id: 'draft', kind: 'arrow', color, weight, from: drag.start, to: arrowTo });
        break;
      case 'highlight':
        setDraft({ id: 'draft', kind: 'highlight', color, rect });
        break;
      case 'mosaic':
        setDraft({ id: 'draft', kind: 'mosaic', rect, block: mosaicBlock });
        break;
      default:
        break;
    }
  };

  const handleUp = () => {
    const current = draft;
    dragRef.current = null;
    setDraft(null);
    if (!current) return;

    if (current.kind === 'mosaic') {
      if (current.rect.w < 4 || current.rect.h < 4) return;
    } else if ('rect' in current) {
      if (current.rect.w < 3 || current.rect.h < 3) return;
    } else if (current.kind === 'pen') {
      if (current.points.length < 2) return;
    }
    const { id: _draftId, ...rest } = current;
    commit([...annotations, { ...rest, id: nextId() } as Annotation]);
  };

  const compose = useCallback((): HTMLCanvasElement => {
    const out = document.createElement('canvas');
    out.width = image.width;
    out.height = image.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('无法创建导出画布');
    ctx.drawImage(base, 0, 0);
    drawAnnotations(ctx, annotations, { mosaicSource: base });
    return out;
  }, [annotations, base, image]);

  /** 只负责入图库；是否落盘由 handleSave 按「自动保存」开关决定。 */
  const persist = useCallback(
    async (blob: Blob, filename: string) => {
      await putShot({
        id: `img_${Date.now()}`,
        kind: 'image',
        createdAt: Date.now(),
        width: image.width,
        height: image.height,
        bytes: blob.size,
        blob,
        thumb: makeThumbnail(base, 240),
      });
      onSaved();
    },
    [base, image, onSaved],
  );

  const copyOut = useCallback(async () => {
    const blob = await canvasToBlob(compose(), 'png');
    await copyBlobToClipboard(blob);
  }, [compose]);

  const handleFinish = useCallback(async () => {
    setBusy('正在复制');
    try {
      await copyOut();
      toast(QQ_TEXT.copyDone, 'ok');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败', 'warn');
    } finally {
      setBusy(null);
    }
  }, [copyOut, onClose, toast]);

  const handleSave = async () => {
    setBusy('正在保存');
    try {
      const format = settings.imageFormat;
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const filename = timestampName('stillframe', ext);
      const blob = await canvasToBlob(compose(), format, settings.jpegQuality);
      // 自动保存开关就是 QQ 的「自动保存」：桌面端直接静默落盘，不弹系统对话框。
      const mode = settings.autoSaveEnabled ? 'auto' : 'manual';
      const result = await saveBlob(blob, filename, mode);
      if (result.via !== 'canceled') await persist(blob, filename);
      toast(result.ok ? `${describeSave(result)} · 已存入图库` : describeSave(result), result.ok ? 'ok' : 'warn');
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存截图失败', 'warn');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'Enter' && !textDraft) {
        event.preventDefault();
        void handleFinish();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) setIndex((prev) => Math.min(history.length - 1, prev + 1));
        else setIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        // Ctrl+Y 重做：和 Ctrl+Shift+Z 等价，照顾 Windows 习惯。
        event.preventDefault();
        setIndex((prev) => Math.min(history.length - 1, prev + 1));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const size = { w: image.width, h: image.height };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-ink-950">
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center p-6 pb-10">
        <div
          className="relative shadow-stage ring-1 ring-white/10"
          style={{ width: box.w || image.width, height: box.h || image.height }}
        >
          <img src={dataUrl} alt="截图预览" className="absolute inset-0 h-full w-full" draggable={false} />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none"
            style={{ cursor: tool === 'text' || tool === 'step' ? 'crosshair' : 'crosshair' }}
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
            onPointerCancel={handleUp}
          />
        </div>

        <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 font-mono text-[10px] tracking-wider text-muted/70">
          <span className="border border-white/10 bg-black/40 px-1.5 py-0.5 text-paper/70">{QQ_TEXT.windowCaptureTab}</span>
          <span>
            {size.w} × {size.h}
          </span>
          <span className="text-muted/50">{QQ_TEXT.operTip}</span>
        </div>

        {textDraft ? (
          <div
            className="absolute z-30"
            style={{
              left: Math.min(textDraft.screenX, window.innerWidth - 320),
              top: Math.min(textDraft.screenY, window.innerHeight - 120),
            }}
          >
            <input
              autoFocus
              value={textDraft.value}
              placeholder="输入文字，回车确认"
              className="w-[280px] border border-[#12B7F5] bg-ink-900 px-2 py-1.5 text-[13px] text-paper outline-none"
              onChange={(event) => setTextDraft({ ...textDraft, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setTextDraft(null);
                if (event.key === 'Enter' && textDraft.value.trim()) {
                  commit([
                    ...annotations,
                    {
                      id: nextId(),
                      kind: 'text',
                      color,
                      size: fontSize,
                      pos: textDraft.point,
                      text: textDraft.value.trim(),
                    },
                  ]);
                  setTextDraft(null);
                }
              }}
              onBlur={() => setTextDraft(null)}
            />
          </div>
        ) : null}

        <div className="absolute bottom-4 right-4 z-20">
          <QqToolbar
            state={{
              tool,
              color,
              weight,
              mosaicBlock,
              fontSize,
              filter,
              count: annotations.length,
              canUndo: index > 0,
              canRedo: index < history.length - 1,
            }}
            actions={{
              onTool: setTool,
              onColor: setColor,
              onWeight: setWeight,
              onMosaicBlock: setMosaicBlock,
              onFontSize: setFontSize,
              onFilter: setFilter,
              onUndo: () => setIndex((prev) => Math.max(0, prev - 1)),
              onRedo: () => setIndex((prev) => Math.min(history.length - 1, prev + 1)),
              onSave: () => void handleSave(),
              onLong: () => onLong?.(compose()),
              onTranslate: () => onTranslate?.(compose()),
              onOcr: () => onOcr?.(compose()),
              onPin: () => {
                try {
                  const out = compose();
                  onPin(out.toDataURL('image/png'), out.width, out.height);
                } catch {
                  toast('贴图失败', 'warn');
                }
              },
              onRecord: () => onRecord?.(),
              onExit: onClose,
              onFinish: () => void handleFinish(),
            }}
            busy={busy}
            allowRecord={Boolean(onRecord)}
          />
        </div>
      </div>
    </div>
  );
}
