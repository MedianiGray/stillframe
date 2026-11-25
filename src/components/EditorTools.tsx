import {
  ArrowUpRight,
  Circle,
  Copy,
  Download,
  Eraser,
  Highlighter,
  Hash,
  MousePointerSquareDashed,
  PenLine,
  Pin,
  Redo2,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import type { AnnotationKind } from '../lib/types';
import { PALETTE } from '../lib/annotate';

export interface EditorToolsState {
  tool: AnnotationKind;
  color: string;
  weight: number;
  mosaicBlock: number;
  fontSize: number;
  count: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditorToolsActions {
  onTool: (tool: AnnotationKind) => void;
  onColor: (color: string) => void;
  onWeight: (weight: number) => void;
  onMosaicBlock: (block: number) => void;
  onFontSize: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onSave: () => void;
  onPin: () => void;
  onClose: () => void;
}

const TOOLS: Array<{ id: AnnotationKind; label: string; icon: typeof Square }> = [
  { id: 'rect', label: '矩形', icon: Square },
  { id: 'ellipse', label: '椭圆', icon: Circle },
  { id: 'arrow', label: '箭头', icon: ArrowUpRight },
  { id: 'pen', label: '画笔', icon: PenLine },
  { id: 'highlight', label: '高亮', icon: Highlighter },
  { id: 'mosaic', label: '马赛克', icon: Eraser },
  { id: 'text', label: '文字', icon: Type },
  { id: 'step', label: '序号', icon: Hash },
];

interface EditorToolsProps {
  state: EditorToolsState;
  actions: EditorToolsActions;
  size: { w: number; h: number };
  busy: string | null;
}

export function EditorTools({ state, actions, size, busy }: EditorToolsProps) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-ink-600/50 bg-ink-900">
      <div className="border-b border-ink-600/50 p-4">
        <div className="flex items-center justify-between">
          <span className="label">标注工具</span>
          <span className="font-mono text-[10px] text-muted">{state.count} 个标记</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-pressed={state.tool === id}
              className={`flex h-14 flex-col items-center justify-center gap-1 rounded-sm border text-[11px] transition-colors ${
                state.tool === id
                  ? 'border-amber/70 bg-amber/10 text-amber'
                  : 'border-ink-600 text-muted hover:border-ink-500 hover:text-paper'
              }`}
              onClick={() => actions.onTool(id)}
            >
              <Icon size={15} strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-ink-600/50 p-4">
        <span className="label">颜色与粗细</span>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`颜色 ${color}`}
              className={`h-7 w-7 rounded-sm border-2 ${
                state.color === color ? 'border-paper' : 'border-transparent'
              }`}
              style={{ backgroundColor: color }}
              onClick={() => actions.onColor(color)}
            />
          ))}
        </div>

        {state.tool === 'mosaic' ? (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="label">像素块</span>
              <span className="font-mono text-[11px] tabular text-paper/80">{state.mosaicBlock}px</span>
            </div>
            <input
              type="range"
              min={4}
              max={40}
              step={2}
              value={state.mosaicBlock}
              className="mt-2 w-full accent-amber"
              onChange={(e) => actions.onMosaicBlock(Number(e.target.value))}
            />
          </div>
        ) : null}

        {state.tool === 'text' ? (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="label">字号</span>
              <span className="font-mono text-[11px] tabular text-paper/80">{state.fontSize}px</span>
            </div>
            <input
              type="range"
              min={12}
              max={48}
              step={2}
              value={state.fontSize}
              className="mt-2 w-full accent-amber"
              onChange={(e) => actions.onFontSize(Number(e.target.value))}
            />
          </div>
        ) : null}

        {state.tool !== 'mosaic' && state.tool !== 'text' && state.tool !== 'step' ? (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="label">线宽</span>
              <span className="font-mono text-[11px] tabular text-paper/80">{state.weight}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={state.weight}
              className="mt-2 w-full accent-amber"
              onChange={(e) => actions.onWeight(Number(e.target.value))}
            />
          </div>
        ) : null}
      </div>

      <div className="border-b border-ink-600/50 p-4">
        <span className="label">历史</span>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <button type="button" className="btn !px-2 !py-1.5 text-[12px]" disabled={!state.canUndo} onClick={actions.onUndo}>
            <Undo2 size={13} /> 撤销
          </button>
          <button type="button" className="btn !px-2 !py-1.5 text-[12px]" disabled={!state.canRedo} onClick={actions.onRedo}>
            <Redo2 size={13} /> 重做
          </button>
          <button type="button" className="btn !px-2 !py-1.5 text-[12px]" disabled={state.count === 0} onClick={actions.onClear}>
            <Trash2 size={13} /> 清空
          </button>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="label">导出</span>
          <span className="font-mono text-[10px] tabular text-muted">
            {size.w} × {size.h}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={actions.onCopy}>
            <Copy size={14} /> 复制
          </button>
          <button type="button" className="btn" disabled={busy !== null} onClick={actions.onDownload}>
            <Download size={14} /> 下载
          </button>
          <button type="button" className="btn" disabled={busy !== null} onClick={actions.onSave}>
            <Save size={14} /> 存图库
          </button>
          <button type="button" className="btn" onClick={actions.onPin}>
            <Pin size={14} /> 贴图
          </button>
        </div>

        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={actions.onClose}>
          <RotateCcw size={14} /> 返回捕捉台
        </button>

        <div className="mt-4 flex items-start gap-2 border-t border-ink-600 pt-3 text-[11px] leading-5 text-muted">
          <MousePointerSquareDashed size={13} className="mt-1 shrink-0 text-amber/70" />
          <p>选中工具后在画面上拖动即可落笔；文字工具点一下会出现输入框；序号工具每次点击自动加一。</p>
        </div>
        {busy ? <p className="mt-2 font-mono text-[11px] text-amber">{busy}</p> : null}
      </div>
    </aside>
  );
}
