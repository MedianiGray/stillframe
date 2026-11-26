/**
 * QQ 截图模块的规格常量。
 *
 * 全部取自本机安装的 QQ 9.9.38（QQNT）：
 *   I:\Program Files\Tencent\QQNT\versions\9.9.38-54985\resources\app\QQScreenShot\
 *     QQScreenShot.rdb  → 界面 XML（ScreenCaptureWnd / OCRWnd / TranslateWnd / NailToDesktopWnd）
 *     Default.rdb       → 中文文案 StringBundle（Tips_Camera_* / Camera_* / Tips_Record_*）
 * 提取方式与原始行号见 docs/QQ-PARITY.md，不要凭印象改这里的常量。
 */

export interface QqTool {
  id: 'rect' | 'ellipse' | 'arrow' | 'pen' | 'mosaic' | 'text' | 'step';
  label: string;
  tip: string;
}

/** 工具栏前段：七个标注工具，顺序与 ScreenCaptureWnd/CaptureToolbar 一致。 */
export const QQ_TOOLS: QqTool[] = [
  { id: 'rect', label: '矩形', tip: '矩形工具' },
  { id: 'ellipse', label: '椭圆', tip: '椭圆工具' },
  { id: 'arrow', label: '箭头', tip: '箭头工具' },
  { id: 'pen', label: '画刷', tip: '画刷工具' },
  { id: 'mosaic', label: '马赛克', tip: '马赛克工具' },
  { id: 'text', label: '文字', tip: '文字工具' },
  { id: 'step', label: '序号', tip: '序号笔工具' },
];

/** 调色板：CameraPellette*Color 按钮的实际 Brush clrFrom 值。 */
export const QQ_PALETTE = [
  { name: '棕', value: '#800000' },
  { name: '红', value: '#FB3838' },
  { name: '深黄', value: '#F7883A' },
  { name: '黄', value: '#FFFF00' },
  { name: '深绿', value: '#308430' },
  { name: '绿', value: '#99CC00' },
  { name: '深蓝', value: '#385AD3' },
  { name: '蓝', value: '#3894E4' },
  { name: '深粉', value: '#800080' },
  { name: '粉', value: '#F31BF3' },
  { name: '深浅蓝', value: '#009999' },
  { name: '浅蓝', value: '#16DCDC' },
];

/** 线宽三档：CameraPelletteLineWidthBtn{Sigle,Triple,Seven}Pt。 */
export const QQ_WIDTHS = [
  { label: '细', value: 1 },
  { label: '中', value: 3 },
  { label: '粗', value: 7 },
];

/** 滤镜栏十二项，名称取 Tips_Camera_Toolbar_FilterBar_*。 */
export const QQ_FILTERS = [
  { id: 'none', label: '原图' },
  { id: 'sunshine', label: '日光海岸' },
  { id: 'lomo', label: 'LOMO' },
  { id: 'ageing', label: '旧照片' },
  { id: 'gray', label: '黑白照' },
  { id: 'sketch', label: '素描' },
  { id: 'classiclomo', label: '经典LOMO' },
  { id: 'rainbow', label: '彩虹' },
  { id: 'copperplate', label: '铜版画' },
  { id: 'polaroid', label: '拍立得' },
  { id: 'sweet', label: '日系甜美' },
  { id: 'nightfall', label: '黄昏' },
] as const;

export type QqFilterId = (typeof QQ_FILTERS)[number]['id'];

/** 文案全部来自 Default.rdb 的 StringBundle，保持与 QQ 一致。 */
export const QQ_TEXT = {
  windowCaptureTab: '截图',
  windowOcrTab: '识图',
  finish: '完成',
  finishTip: '完成截图',
  exitTip: '退出截图',
  saveTip: '保存 Ctrl+S',
  undo: '撤销编辑 Ctrl+Z',
  clear: '清除',
  long: '长截图',
  longTool: '长截图工具',
  transfer: '转发长截图',
  translate: '翻译',
  translatePanel: '屏幕翻译',
  ocr: '屏幕识图',
  nail: '钉在桌面上',
  record: '屏幕录制',
  filter: '滤镜工具',
  mosaicBlur: '模糊度',
  copyDone: '已复制到粘贴板',
  copied: '已复制',
  doubleClickHint: '双击可以快速完成截图。',
  polygonHint: '鼠标右键自由截图',
  altHint: '按住Alt键吸附直线',
  operTip: '双击快速完成截图 点右键或按ESC退出',
  colorInfo: 'RGB',
  recordStart: '开始录制',
  recordEnd: '结束录制',
  recordPrepare: '准备录制',
  soundOn: '扬声器开启',
  soundOff: '扬声器静音',
  voiceOn: '麦克风开启',
  voiceOff: '麦克风静音',
  selectOcr: '框选识别文字',
  selectTranslate: '框选翻译文字',
  selectRecord: '框选录屏区域',
  discerning: '正在识别',
  translating: '翻译中...',
  noOcr: '无识别结果',
  noTranslate: '无内容可翻译',
  ocrTitle: '屏幕识图',
  ocrEdit: '编辑',
  ocrCopy: '复制',
  ocrToDocx: '转为在线文档',
  ocrDownload: '下载',
  ocrCancel: '取消',
  ocrSave: '确认',
  translateWndTitle: '翻译',
  translateOnly: '仅查看译文',
  translateOrigin: '原文',
  nailLimit: '已达到截图窗口上限，请先关闭多余窗口。',
} as const;
