# QQ 截图模块对照说明

这份文档记录「定格 / Stillframe」里每个截图能力是从本机 QQ 的哪个文件、哪个控件抄来的。
重点不是"像 QQ"，而是**没有凭空设计**：工具顺序、调色板色值、文案、窗口尺寸都能在下面指到具体文件与控件名。

## 1. 参照物

本机安装的是 QQNT 版 QQ 9.9.38：

```
I:\Program Files\Tencent\QQNT\versions\9.9.38-54985\resources\app\
  QQScreenShot\QQScreenShot.rdb    1,316,549 B   截图模块自己的界面与资源
  QQScreenShot\Default.rdb         4,839,748 B   公共皮肤、类型定义、多语言
  QQScreenShot\Config.rdb             49,777 B   服务注册
  QQScreenShot\QQScreenShot.tpc          934 B   资源包入口（XML）
  QQScreenShot\BinRelease-x64\QQScreenshot.exe  41,512 B  原生壳（ArkUI/GF 框架）
  QQScreenShot\BinRelease-x64\Common.dll / GF.dll / Camera.dll / xImage.dll ...
```

`QQScreenShot.tpc` 里写明了资源映射：

```xml
<file-system name="@default:" path="Default"/>
<file-system name="sysres:" path="@platformres:AppFramework"/>
<core-config file="@default:common.xml"/>
<core-config file="@config:Config.QQScreenShot.xml"/>
<gf-config file="@this:gf-config.xml"/>
<i18n-config file="@default:I18N\Config.xml"/>
```

## 2. 资源是怎么读出来的

`.rdb` 不是加密包，是「16 字节标识 + 索引 + 明文负载」：

```
35 33 31 45 39 38 32 30 34 46 38 35 34 32 46 30   ← "531E98204F8542F0"
5c 01 00 00 24 00 00 00 00 00 00 00 ea 74 00 00   ← 条目表头
67 00 66 00 2d 00 63 00 6f 00 6e 00 66 00 69 00 67 00   ← UTF-16 "gf-config"
```

负载里直接是 UTF-8 的 XML 与 PNG。用 `tools/qq-resource-probe.py` 按 `<?xml` 与 `\x89PNG` 签名切分，得到：

- `QQScreenShot.rdb` → 8 个 XML、339 张 PNG
- `Default.rdb` → 29 个 XML、2823 张 PNG

其中和截图界面直接相关的四个（切分后的序号，按出现顺序）：

| 切分文件（本脚本的编号） | 根节点 | 内容 |
| --- | --- | --- |
| `QQScreenShot_xml006.xml` | `<PopupWindow name="ScreenCaptureWnd">` | 截图主窗口、工具栏、选项条、滤镜栏、长截图条、录屏条（约 99 KB） |
| `QQScreenShot_xml007.xml` | `<PopupWindow name="ScreenCaptureWnd">` | 同一个窗口的另一套尺寸/主题变体 |
| `QQScreenShot_xml004.xml` | `<Window name="NailToDesktopWnd" clientAreaSize="600,500">` | 贴图窗口 |
| `QQScreenShot_xml005.xml` | `<Window name="OCRWnd" clientAreaSize="540,440">` | 屏幕识图结果窗 |
| `QQScreenShot_xml008.xml` | `<Window name="TranslateWnd" clientAreaSize="540,440">` | 屏幕翻译窗 |

编号是按签名切分得到的顺序号，不同实现可能差几号；认窗口名就行。
中文文案来自 `Default.rdb` 里的 `StringBundle`（同一个 id 在多个 locale 包里各有一份，取含中文的那份）。

## 3. 截图窗口的真实结构

`ScreenCaptureWnd` 的窗口属性：

```xml
<PopupWindow name="ScreenCaptureWnd" toolWindow="true" topmost="true" client="true"
             doubleClick="true" fixSize="true" layered="false" aero="false" ...>
```

- 顶部两个标签：`tab_capture`（截图）/ `tab_ocr`（识图），文案 `Camera_TabTitle_Capture` / `Camera_TabTitle_OCR`。
- 放大镜：`<Frame name="MagnifierFrame" ... size="132,152">`，取景区 `Magnifier` 117×84，下面依次是尺寸、RGB 色号、`Camera_CopyColor`、`Camera_Polygon`、操作提示。
- 尺寸条：`SizeInfoStatic` 高 24。
- 长截图编辑区：`LongCaptureEditCtrl` + `ScrollView`。
- 四个状态提示框：`OcrSelTips` / `TranslateSelTips` / `RecordSelTips` / `RecordTimeCountDownTips`。

对应的真实文案（`Default_xml002.xml`）：

```
Camera_RectTipText       双击可以快速完成截图。
Camera_Rect_Information  $WIDTH$ x $HEIGHT$
Camera_Color_Information RGB:($COLORR,$COLORG$,$COLORB$)
Camera_CopyColor         按c复制色号
Camera_Polygon           鼠标右键自由截图
Camera_Adsorption        按住Alt键吸附直线
Camera_oper_tip          双击快速完成截图 点右键或按ESC退出
Camera_OCR_Tips_Select   框选识别文字
Camera_Translate_Tips_Select 框选翻译文字
Camera_Record_Tips_Select    框选录屏区域
```

## 4. 工具栏：15 个按钮的真实顺序

`ScreenCaptureWnd/CaptureToolbar`（`QQScreenShot_xml006.xml` 里 `<Toolbar name="CaptureToolbar">` 的子节点）按顺序排列，**没有序号工具之外的任何自定义工具**：

| # | 控件名 | 贴图 | 真实 tooltip |
| --- | --- | --- | --- |
| 1 | `ToolbarBtnRectangle` | `Camera\Toolbar\Rectangle.png` | 矩形工具 |
| 2 | `ToolbarBtnCircle` | `Circle.png` | 椭圆工具 |
| 3 | `ToolbarBtnArrow` | `Arrow.png` | 箭头工具 |
| 4 | `ToolbarBtnBrush` | `Brush.png` | 画刷工具 |
| 5 | `ToolbarBtnFilter` | `Mosaic.png` | 马赛克工具 |
| 6 | `ToolbarBtnText` | `Text.png` | 文字工具 |
| 7 | `ToolbarBtnMarker` | `Marker.png` | 序号笔工具 |
| – | 分隔线 | – | – |
| 8 | `ToolbarBtnUndo` | `Undo.png` | 撤销编辑 Ctrl+Z |
| 9 | `ToolbarBtnSave` | `OldSave.png` | 保存 Ctrl+S |
| 10 | `ToolbarBtnLongCaputre` | `Screenshot.png` | 长截图 |
| 11 | `ToolbarBtnTranslate` | `Translate.png` | 翻译 |
| 12 | `ToolbarBtnOcr` | `ocr.png` | 屏幕识图 |
| 13 | `ToolbarBtnNail` | `Nail.png` | 钉在桌面上 |
| – | 分隔线 | – | – |
| 14 | `ToolbarBtnExit` | `OldExit.png` | 退出截图 |
| 15 | `ToolbarBtnFinish` | `OldFinish.png`（56×18，带文字） | 完成截图，按钮文字「完成」 |

另外 `Tips_Camera_Toolbar_ScreenCapture = 屏幕录制`，说明录屏入口也在这一层；本仓库把它放进了同一个工具栏。

## 5. 选项条：调色板与线宽是固定值

`ScreenCaptureWnd/CaptureToolOption` 下十二个 `CameraPellette*Color`，每个按钮的 `Brush clrFrom` 就是真实色值：

| 控件名 | 色值 | 名称 |
| --- | --- | --- |
| `CameraPelletteBrownColor` | `0x800000` | 棕 |
| `CameraPelletteRedColor` | `0xFB3838` | 红 |
| `CameraPelletteHeavyYellowColor` | `0xF7883A` | 深黄 |
| `CameraPelletteYellowColor` | `0xFFFF00` | 黄 |
| `CameraPelletteHeavyGreenColor` | `0x308430` | 深绿 |
| `CameraPelletteGreenColor` | `0x99CC00` | 绿 |
| `CameraPelletteHeavyBlueColor` | `0x385AD3` | 深蓝 |
| `CameraPelletteBlueColor` | `0x3894E4` | 蓝 |
| `CameraPelletteHeavyPinkColor` | `0x800080` | 深粉 |
| `CameraPellettePinkColor` | `0xF31BF3` | 粉 |
| `CameraPelletteHeavyLightBlueColor` | `0x009999` | 深浅蓝 |
| `CameraPelletteLightBlueColor` | `0x16DCDC` | 浅蓝 |

线宽三档：`CameraPelletteLineWidthBtnSiglePt` / `TriplePt` / `SevenPt`（1 / 3 / 7 pt）。
马赛克的选项条标签是 `Menu_Camera_ToolBar_MosaicBar_Trans = 模糊度`。
文字用 `CaptureTextEdit` 的 `RichEdit`，序号笔用 `CaptureMarkerEdit`。

## 6. 滤镜栏：十二项，名字不是编的

`CaptureFilterBarFrame` 里两行各六个按钮，tooltip 一一对应：

| 控件名 | 文案 |
| --- | --- |
| `CameraFilterBarBtnOriginal` | 原图 |
| `CameraFilterBarBtnPolaroid` | 拍立得 |
| `CameraFilterBarBtnClassicLomo` | 经典LOMO |
| `CameraFilterBarBtnLOMO` | LOMO |
| `CameraFilterBarBtnSunshine` | 日光海岸 |
| `CameraFilterBarBtnNightfall` | 黄昏 |
| `CameraFilterBarBtnSweet` | 日系甜美 |
| `CameraFilterBarBtnRainbow` | 彩虹 |
| `CameraFilterBarBtnCopperplate` | 铜版画 |
| `CameraFilterBarBtnAgeing` | 旧照片 |
| `CameraFilterBarBtnGraying` | 黑白照 |
| `CameraFilterBarBtnSketch` | 素描 |

## 7. 长截图工具栏

```xml
<Toolbar size="459, 40" name="LongCaptureToolbar" ...>
```

| 控件名 | 尺寸 | 含义 |
| --- | --- | --- |
| `LongToolbarBtnChooseDirection` | 48×16 | 选择方向 |
| `LongToolbarBtnSetDirectionV` | 46×16 | 垂直（`choose_direction_vertical_ok_btn.png`） |
| `LongToolbarBtnSetDirectionH` | 46×16 | 水平（`choose_direction_horizontal_normal_btn.png`） |
| `LongToolbarBtnAutoScroll` | 72×28 | 自动滚动 |
| `LongToolbarLine` | 1×16 | 分隔线 |
| `LongToolbarBtnEdit` | 32×32 | 编辑工具 |
| `LongToolbarBtnTransfer` | 32×32 | 转发长截图 |
| `LongToolbarBtnSave` | 32×32 | 保存 |
| `LongToolbarBtnExit` | 32×32 | 退出 |
| `LongToolbarBtnFinish` | 32×32 | 完成 |

转发面板 `CaptureTransferPanelFrame` 的选项是 转发 / 发送到手机 / 收藏 / 保存到表情，这是 QQ 内部生态，本仓库只保留「复制」与「保存」。

## 8. 录屏工具栏

```xml
<Toolbar size="0, 32" name="CaptureRecordToolbar" ...>
```

- 标注六件套：`CaptureRecordBtnBrush` 画刷 / `Rectangle` 矩形 / `Circle` 椭圆 / `Arrow` 箭头 / `Text` 文字 / `Laser` 激光（`Laser.png`）。
- `CaptureRecordBtnUndo` 撤销、`CaptureRecordBtnClear` 清除。
- `CaptureRecordSoundCtrl` 扬声器（`sound_on.png`）、`CaptureRecordVoiceCtrl` 麦克风（`noMute.png`）、`CaptureRecordExitCtrl` 退出。
- `CaptureRecordCtrl` 文本 `Camera_Record_Start = 开始录制` / `Camera_Record_End = 结束录制`；`Camera_Record_Prepare = 准备录制`。
- 静音文案：`扬声器静音 / 扬声器开启 / 麦克风静音 / 麦克风开启`。

## 9. 识图与翻译窗

- `OCRWnd` 客户区 540×440，标题 `Camera_OCR_WndTitle = 屏幕识图`。
- 按钮文案：`编辑`、`复制`、`转为在线文档`、`下载`、`取消`、`确认`。
- 进程提示：`正在识别`、`无识别结果`、`图片过大`、`已复制到粘贴板`。
- 翻译：`Camera_Translate_WndTitle = 翻译`，按钮 `翻译` / `原文` / `仅查看译文` / `查看原文` / `退出翻译`，提示 `翻译中...`、`无内容可翻译`。
- 贴图：`NailToDesktopWnd` 600×500，超限文案 `已达到截图窗口上限，请先关闭多余窗口。`

## 10. 本仓库的落点

| QQ 控件 | 本仓库位置 | 状态 |
| --- | --- | --- |
| 十五键工具栏 | `src/lib/qqspec.ts` + `src/components/QqToolbar.tsx` | 顺序、文案照搬；图标用 lucide 重画 |
| 十二色调色板 | `QQ_PALETTE` | 色值逐项照搬 |
| 线宽 1/3/7 | `QQ_WIDTHS` | 照搬 |
| 十二个滤镜 | `src/lib/filters.ts` | 名称照搬；色彩用 Canvas 调色近似 |
| 放大镜 132×152 | `src/components/SelectionOverlay.tsx` | 117×84 取景区 + 尺寸 + RGB |
| 双击完成 / 右键退出 / Alt 吸附 | `SelectionOverlay.tsx` | 双击、右键已实现；Alt 直线吸附未做 |
| 长截图方向/自动滚动/编辑/转发/保存/退出/完成 | `src/components/panels/ScrollPanel.tsx` | 除自动滚动外均已实现；自动滚动需向目标窗口注入滚轮，标为桌面壳后续 |
| 录屏六工具 + 撤销/清除/声音/麦克风 | `src/components/panels/RecordPanel.tsx` + `src/lib/recorder.ts` | 标注会真实合成进成片；激光是衰减轨迹 |
| 识图窗 540×440 | `src/components/panels/OcrPanel.tsx` | 引擎换 tesseract.js，布局沿用 |
| 翻译窗 540×440 | `src/components/panels/TranslatePanel.tsx` | 引擎换 OpenAI/DeepL/LibreTranslate |
| 贴图 600×500 | `public/pin.html` + `desktop/src/lib.rs` | 窗口尺寸按 600×500 设定 |

## 11. 明确没有照搬的东西

- **没有复制腾讯的任何二进制或图片资源进仓库**。`Camera\Toolbar\*.png`、`*.gft` 只用来看形状，仓库里的图标是用 lucide 按同一图形语言重画的；`QQScreenshot.exe`、`*.dll` 完全没有分发。
- 滤镜是参数近似，不是 QQ 的图像引擎；马赛克用像素块近似「模糊度」。
- QQ 的「转发到手机 / 收藏 / 保存到表情」依赖 QQ 账号体系，本仓库不实现。
- 序号笔的自动避让、箭头样式切换（`ArrowStyle`）等细节未复刻。

如果你在自己的机器上复核，先跑：

```bash
python tools/qq-resource-probe.py "C:\Program Files\Tencent\QQNT" -o ./qq-dump
```

它会打印版本目录、切分出的 XML/PNG 数量，并列出包含 `ScreenCaptureWnd` 的那份 XML 路径。
