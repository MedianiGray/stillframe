import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Annotation, AnnotationKind, Point, Rect } from '../lib/types';
import { drawAnnotations, rectFromPoints } from '../lib/annotate';
import { canvasToBlob, copyBlobToClipboard, downloadBlob, makeThumbnail, timestampName } from '../lib/image';
import { putShot } from '../lib/storage';
import { writeToDirectory } from '../lib/autosave';
import { useToast } from './Toasts';
import { EditorTools } from './EditorTools';
import type { Settings } from '../lib/settings';

interface EditorProps {
  image: HTMLCanvasElement;
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
  onPin: (dataUrl: string) => void;
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

export function Editor({ image, settings, onClose, onSaved, onPin }: EditorProps) {
  const toast = useToast();
  const [tool, setTool] = useState<AnnotationKind>('rect');
  const [color, setColor] = useState('#E4A03C');
  const [weight, setWeight] = useState(3);
  const [mosaicBlock, setMosaicBlock] = useState(12);
  const [fontSize, setFontSize] = useState(20);
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
  const dataUrl = useMemo(() => image.toDataURL('image/png'), [image]);

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
      const pad = 40;
      const cw = Math.max(80, wrap.clientWidth - pad);
      const ch = Math.max(80, wrap.clientHeight - pad);
      const ratio = Math.min(cw / image.width, ch / image.height);
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
    drawAnnotations(ctx, draft ? [...annotations, draft] : annotations, { mosaicSource: image });
  }, [annotations, draft, image]);

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
    const rect: Rect = rectFromPoints(drag.start, point);

    switch (drag.kind) {
      case 'pen': {
        setDraft((prev) => {
          if (!prev || prev.kind !== 'pen') {
            return { id: 'draft', kind: 'pen', color, weight, points: [drag.start, point] };
          }
          return { ...prev, points: [...prev.points, point] };
        });
        break;
      }
      case 'rect':
        setDraft({ id: 'draft', kind: 'rect', color, weight, rect });
        break;
      case 'ellipse':
        setDraft({ id: 'draft', kind: 'ellipse', color, weight, rect });
        break;
      case 'arrow':
        setDraft({ id: 'draft', kind: 'arrow', color, weight, from: drag.start, to: point });
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
    const finished = { ...rest, id: nextId() } as Annotation;
    commit([...annotations, finished]);
  };

  const compose = useCallback((): HTMLCanvasElement => {
    const out = document.createElement('canvas');
    out.width = image.width;
    out.height = image.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('无法创建导出画布');
    ctx.drawImage(image, 0, 0);
    drawAnnotations(ctx, annotations, { mosaicSource: image });
    return out;
  }, [annotations, image]);

  const persist = useCallback(
    async (blob: Blob, ext: string, width: number, height: number) => {
      await putShot({
        id: `img_${Date.now()}`,
        kind: 'image',
        createdAt: Date.now(),
        width,
        height,
        bytes: blob.size,
        blob,
        thumb: makeThumbnail(image, 240),
      });
      if (settings.autoSaveEnabled) {
        const saved = await writeToDirectory(blob, timestampName('stillframe', ext));
        if (!saved) toast('自动保存目录未授权，已只存入图库', 'warn');
      }
      onSaved();
      toast('已存入图库', 'ok');
      void width;
      void height;
    },
    [image, onSaved, settings.autoSaveEnabled, toast],
  );

  const handleCopy = async () => {
    setBusy('正在复制');
    try {
      const blob = await canvasToBlob(compose(), 'png');
      await copyBlobToClipboard(blob);
      toast('已复制到剪贴板', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    setBusy('正在导出');
    try {
      const format = settings.imageFormat;
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const blob = await canvasToBlob(compose(), format, settings.jpegQuality);
      downloadBlob(blob, timestampName('stillframe', ext));
      if (settings.autoSaveEnabled) {
        const saved = await writeToDirectory(blob, timestampName('stillframe', ext));
        if (!saved) toast('自动保存目录未授权，文件已走浏览器下载', 'warn');
      }
      toast('已导出图片', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出失败', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setBusy('正在归档');
    try {
      const format = settings.imageFormat;
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const blob = await canvasToBlob(compose(), format, settings.jpegQuality);
      await persist(blob, ext, image.width, image.height);
    } catch (error) {
      toast(error instanceof Error ? error.message : '存入图库失败', 'warn');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div ref={wrapRef} className="stage-grid relative flex min-w-0 flex-1 items-center justify-center p-6">
        <div className="relative shadow-stage" style={{ width: box.w || image.width, height: box.h || image.height }}>
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

        <div className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] tracking-wider text-muted/70">
          {image.width} × {image.height} PX · ESC 不退出 · 拖动落笔
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
              className="w-[280px] border border-amber bg-ink-900 px-2 py-1.5 text-[13px] text-paper outline-none"
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
      </div>

      <EditorTools
        state={{
          tool,
          color,
          weight,
          mosaicBlock,
          fontSize,
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
          onUndo: () => setIndex((prev) => Math.max(0, prev - 1)),
          onRedo: () => setIndex((prev) => Math.min(history.length - 1, prev + 1)),
          onClear: () => commit([]),
          onCopy: handleCopy,
          onDownload: handleDownload,
          onSave: handleSave,
          onPin: () => {
            try {
              onPin(compose().toDataURL('image/png'));
            } catch {
              toast('贴图失败', 'warn');
            }
          },
          onClose,
        }}
        size={{ w: image.width, h: image.height }}
        busy={busy}
      />
    </div>
  );
}
