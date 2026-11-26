import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Circle,
  Grid3x3,
  Hash,
  Highlighter,
  Languages,
  PenLine,
  Pin,
  Save,
  ScanText,
  ScrollText,
  Sparkles,
  Square,
  Type,
  Undo2,
  Video,
  X,
} from 'lucide-react';
import type { AnnotationKind } from '../lib/types';
import { QQ_FILTERS, QQ_PALETTE, QQ_TEXT, QQ_TOOLS, QQ_WIDTHS, type QqFilterId } from '../lib/qqspec';

export interface QqToolbarState {
  tool: AnnotationKind;
  color: string;
  weight: number;
  mosaicBlock: number;
  fontSize: number;
  filter: QqFilterId;
  count: number;
  canUndo: boolean;
}

export interface QqToolbarActions {
  onTool: (tool: AnnotationKind) => void;
  onColor: (color: string) => void;
  onWeight: (weight: number) => void;
  onMosaicBlock: (block: number) => void;
  onFontSize: (size: number) => void;
  onFilter: (filter: QqFilterId) => void;
  onUndo: () => void;
  onSave: () => void;
  onLong: () => void;
  onTranslate: () => void;
  onOcr: () => void;
  onPin: () => void;
  onRecord: () => void;
  onExit: () => void;
  onFinish: () => void;
}

const ICONS: Record<AnnotationKind, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  pen: PenLine,
  mosaic: Grid3x3,
  text: Type,
  step: Hash,
  highlight: Highlighter,
};

const BAR = 'flex items-center gap-0.5 rounded-[3px] bg-[#1F2226]/95 px-1.5 py-1 shadow-[0_6px_22px_rgba(0,0,0,0.45)] ring-1 ring-white/10';
const BTN =
  'flex h-[30px] w-[30px] items-center justify-center rounded-[2px] text-[#D6DBE0] transition-colors hover:bg-white/10 disabled:opacity-35';
const BTN_ON = 'bg-[#12B7F5]/22 text-[#5FD3FF] ring-1 ring-[#12B7F5]/60';

interface Props {
  state: QqToolbarState;
  actions: QqToolbarActions;
  busy: string | null;
  /** 编辑器里显示“屏幕录制”入口；网页端点了会重新走一次屏幕授权。 */
  allowRecord?: boolean;
}

export function QqToolbar({ state, actions, busy, allowRecord = true }: Props) {
  const [filterOpen, setFilterOpen] = useState(false);
  const active = state.tool;

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      {filterOpen ? (
        <div className="rounded-[3px] bg-[#1F2226]/97 p-2 shadow-[0_10px_28px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <span className="text-[11px] text-[#98A2AC]">{QQ_TEXT.filter}</span>
            <button type="button" className="text-[11px] text-[#98A2AC] hover:text-white" onClick={() => setFilterOpen(false)}>
              <X size={12} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {QQ_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.label}
                className={`h-[46px] w-[64px] rounded-[2px] border px-1 text-[11px] transition-colors ${
                  state.filter === item.id
                    ? 'border-[#12B7F5] bg-[#12B7F5]/15 text-[#8FDDFF]'
                    : 'border-white/10 bg-white/5 text-[#C7CDD3] hover:border-white/25'
                }`}
                onClick={() => {
                  actions.onFilter(item.id);
                  setFilterOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 选项条：颜色 / 线宽 / 模糊度 / 字号，QQ 的 CaptureToolOption */}
      <div className={BAR}>
        {active === 'mosaic' ? (
          <>
            <span className="px-1.5 text-[11px] text-[#98A2AC]">{QQ_TEXT.mosaicBlur}</span>
            <input
              type="range"
              min={4}
              max={40}
              step={2}
              value={state.mosaicBlock}
              className="h-1 w-[118px] accent-[#12B7F5]"
              onChange={(e) => actions.onMosaicBlock(Number(e.target.value))}
            />
            <span className="w-8 text-right font-mono text-[11px] text-[#C7CDD3]">{state.mosaicBlock}</span>
          </>
        ) : active === 'text' ? (
          <>
            <span className="px-1.5 text-[11px] text-[#98A2AC]">字号</span>
            {[14, 18, 22, 28, 36].map((size) => (
              <button
                key={size}
                type="button"
                className={`h-[24px] min-w-[28px] rounded-[2px] px-1 font-mono text-[11px] ${
                  state.fontSize === size ? BTN_ON : 'text-[#C7CDD3] hover:bg-white/10'
                }`}
                onClick={() => actions.onFontSize(size)}
              >
                {size}
              </button>
            ))}
          </>
        ) : active === 'step' ? (
          <span className="px-2 text-[11px] text-[#98A2AC]">点击画面依次编号</span>
        ) : (
          <>
            {QQ_PALETTE.map((item) => (
              <button
                key={item.value}
                type="button"
                title={item.name}
                aria-label={item.name}
                className={`h-[18px] w-[18px] rounded-[2px] border ${
                  state.color.toLowerCase() === item.value.toLowerCase() ? 'border-white' : 'border-black/40'
                }`}
                style={{ backgroundColor: item.value }}
                onClick={() => actions.onColor(item.value)}
              />
            ))}
            <span className="mx-1 h-[14px] w-px bg-white/15" />
            {QQ_WIDTHS.map((item) => (
              <button
                key={item.value}
                type="button"
                title={`${item.label}线宽`}
                className={`flex h-[24px] w-[24px] items-center justify-center rounded-[2px] ${
                  state.weight === item.value ? BTN_ON : 'hover:bg-white/10'
                }`}
                onClick={() => actions.onWeight(item.value)}
              >
                <span className="rounded-full bg-[#D6DBE0]" style={{ width: 4 + item.value, height: 4 + item.value }} />
              </button>
            ))}
          </>
        )}
      </div>

      {/* 工具条：七个标注工具 + 撤销 / 保存 / 长截图 / 翻译 / 识图 / 贴图 / 录屏 / 退出 / 完成 */}
      <div className={BAR}>
        {QQ_TOOLS.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              title={item.tip}
              aria-pressed={active === item.id}
              className={`${BTN} ${active === item.id ? BTN_ON : ''}`}
              onClick={() => actions.onTool(item.id)}
            >
              <Icon size={16} strokeWidth={1.7} />
            </button>
          );
        })}

        <span className="mx-1 h-[16px] w-px bg-white/15" />

        <button
          type="button"
          title={QQ_TEXT.filter}
          className={`${BTN} ${filterOpen ? BTN_ON : ''}`}
          onClick={() => setFilterOpen((v) => !v)}
        >
          <Sparkles size={16} strokeWidth={1.7} />
        </button>
        <button type="button" title={QQ_TEXT.undo} className={BTN} disabled={!state.canUndo} onClick={actions.onUndo}>
          <Undo2 size={16} strokeWidth={1.7} />
        </button>

        <span className="mx-1 h-[16px] w-px bg-white/15" />

        <button type="button" title={QQ_TEXT.saveTip} className={BTN} disabled={busy !== null} onClick={actions.onSave}>
          <Save size={16} strokeWidth={1.7} />
        </button>
        <button type="button" title={QQ_TEXT.longTool} className={BTN} onClick={actions.onLong}>
          <ScrollText size={16} strokeWidth={1.7} />
        </button>
        <button type="button" title={QQ_TEXT.translate} className={BTN} onClick={actions.onTranslate}>
          <Languages size={16} strokeWidth={1.7} />
        </button>
        <button type="button" title={QQ_TEXT.ocr} className={BTN} onClick={actions.onOcr}>
          <ScanText size={16} strokeWidth={1.7} />
        </button>
        <button type="button" title={QQ_TEXT.nail} className={BTN} onClick={actions.onPin}>
          <Pin size={16} strokeWidth={1.7} />
        </button>
        {allowRecord ? (
          <button type="button" title={QQ_TEXT.record} className={BTN} onClick={actions.onRecord}>
            <Video size={16} strokeWidth={1.7} />
          </button>
        ) : null}

        <span className="mx-1 h-[16px] w-px bg-white/15" />

        <button type="button" title={QQ_TEXT.exitTip} className={BTN} onClick={actions.onExit}>
          <X size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          title={QQ_TEXT.finishTip}
          className="ml-0.5 flex h-[30px] items-center gap-1 rounded-[2px] bg-[#12B7F5] px-2.5 text-[12px] font-medium text-[#04212E] transition-colors hover:bg-[#3AC5FA]"
          onClick={actions.onFinish}
        >
          <Check size={14} strokeWidth={2.2} />
          {QQ_TEXT.finish}
        </button>
      </div>
    </div>
  );
}
