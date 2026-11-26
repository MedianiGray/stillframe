# 架构

## 一句话

一个 React 前端工程 + 两个原生壳（Tauri / Kotlin WebView）。前端不感知自己跑在哪，平台差异在 `src/lib/desktop.ts` 一处收敛。

## 分层

```
┌──────────────────────────────────────────────────────────┐
│ UI 层  src/App.tsx · components/* · components/panels/*   │
│  只做：视图状态、交互编排、把结果画出来                     │
└───────────────▲──────────────────────────┬───────────────┘
                │                          │
┌───────────────┴──────────────────────────▼───────────────┐
│ 能力层  src/lib/*                                        │
│  capture / annotate / stitch / recorder / ocr /           │
│  translate / storage / autosave / image / settings        │
│  只做：纯函数或可独立实例化的类，不依赖 React             │
└───────────────▲──────────────────────────┬───────────────┘
                │                          │
┌───────────────┴──────────────────────────▼───────────────┐
│ 宿主层  desktop.ts                                        │
│  探测 __TAURI__.core.invoke / AndroidBridge → 有就用原生   │
│  没有就回落浏览器 API                                     │
└──────────────────────────────────────────────────────────┘
```

## 一条截图的完整数据流

1. `CaptureWorkspace` 进入 `selecting`，调 `capture.ts` 的 `startDisplayStream()`。
   - 网页端：`navigator.mediaDevices.getDisplayMedia({video: {frameRate}})`。
   - 桌面端：先 `invoke('capture_screen')` 拿整屏 dataURL，画进 canvas 当静态帧，完全绕过授权弹窗。
   - Android：`AndroidBridge.startCapture()` 触发 MediaProjection，帧经 ImageReader 转 PNG 回传。
2. 冻结帧交给 `SelectionOverlay` 做 DOM 四块遮罩 + 实时尺寸，拖出 `rect`。
3. 确认后 `crop()`（`image.ts`）得到选区 canvas，进入 `edit`。
4. `Editor` 在底图上叠一层 canvas，`drawAnnotations()` 每次重绘全部元素（马赛克用缩块放大实现），历史栈保留快照。
5. 导出：`canvasToBlob` → 复制剪贴板 / 下载 / `nativeSave` / 自动保存目录 / 写入 IndexedDB。

## 长截图

`ScrollPanel` 每次「追加一屏」都走一次第 1–3 步，得到同尺寸或近尺寸的帧，交给 `stitch.ts`：

- `rowSignature()`：降采样到 32 列灰度，得到每帧的行签名。
- `findOverlap(a, b)`：在 24–2400px 偏移区间滑窗，求两帧重叠段签名差的平均绝对值，取最优且 < 9。
- 命中按重叠拼；未命中按无重叠接，并把 `matched: false` 回传给 UI 提示改手动重叠。

## 录屏

`RegionRecorder`：

```
displayStream.video ──► drawImage(rect) ──► offscreen canvas
                                              │
                                     captureStream(fps)
                                              │
systemAudio / mic ──► AudioContext 混音 ──► audio track
                                              │
                                     MediaRecorder(webm/vp9+opus)
```

停止后返回 Blob，与截图走同一套保存/图库链路。

桌面壳不走上面这条，改成原生管线（`desktop/src/lib.rs` + `recorder.rs` + `win_capture.rs`）：

```
FrameGrabber::grab() ──► Encoder::push_frame() ──► ffmpeg stdin (rawvideo)
      │                        │                        │
 DXGI Dup.  ─失败回退→ BitBlt    h264_qsv ─不可用→ libx264   └─► MP4 (+faststart)

ffmpeg -f dshow (麦克风) ──► WAV(48k/mono) ─┐
                                            ├─► stop_recording 时封装 ─► MP4 带 aac
                          MP4（画面）────────┘
```

- `FrameGrabber` 先试 DXGI Desktop Duplication（`CopyResource` 到 staging 纹理 → `Map` 读回），拿不到就退 `BitBlt` + `CreateDIBSection`（DIB 内存即帧缓冲，零拷贝）。两条路径对外都是「选区 BGRA」。
- `pick_encoder` 先真编 5 帧探测 `h264_qsv`，能用就交给核显，`write_avg_ms` 落到 1–3ms；否则 libx264 `ultrafast`。
- 节奏由 `pace_frame` 保证：目标帧数只由「已跑秒数 × 帧率」决定，落后就重复当前帧补齐，剩 2ms 以内忙等到点；收尾 `pad_to` 按真实秒数补足，成片时长因此与录制时长一致；录制期 `timeBeginPeriod(1)` 提高 sleep 精度。
- 音频是**独立进程**：`Encoder::start` 另起一个 ffmpeg 录 `dshow` 麦克风到 WAV（先等文件落盘再开始抓帧），`mark_end` 发 `q` 让它收尾，`finish` 按字节数算出音频比画面多录了多久、用 `-ss` 裁掉、再用 `-shortest` 追尾，两轨对齐后封装。分离是必须的：同一进程里 dshow 是无限流，视频 stdin EOF 后 FFmpeg 不退出。
- 统计口径：`fps` 是内容更新率（重复帧不计），`frames` 是成片总帧数，`backend` 记实际路径（如 `dxgi+h264_qsv+mic`）。

## 索引与存储

- 设置：`localStorage`，键 `stillframe.settings.v1`，写入时广播事件让已挂载的组件同步。
- 图库：IndexedDB `stillframe` 库的 `shots` store，存 `{id, kind, blob, thumb, meta}`，缩略图单独存以减少列表渲染开销。
- 自动保存：`showDirectoryPicker()` 拿句柄后持久化到 IndexedDB，下次启动先 `queryPermission()`，需要时再 `requestPermission()`。

## 原生壳契约

前端只依赖这些命令，桌面壳与 Android 桥都必须提供同名能力：

| 命令 | 入参 | 返回 | 用途 |
| --- | --- | --- | --- |
| `capture_screen` | — | `data:image/png;base64,...` | 整屏抓帧，免授权 |
| `capture_window` | `id` | `data:image/png;base64,...` | 按窗口 id 抓整窗（含被遮挡部分），最小化报错 |
| `read_tessdata` | `lang` | base64 字符串 | 读取随壳内置的 gz 语言包，离线取字零网络 |
| `self_rect` | — | `{x,y,width,height}` | 自身窗口的屏幕矩形（物理像素）；自动滚动据此判断会不会把自己拍进长图 |
| `pin_image` | `dataUrl`, `width?`, `height?` | — | 按原图比例开置顶贴图窗口（上限 20 张） |
| `save_png` | `dataUrl`, `suggestedName` | 保存路径 | 系统保存对话框 |
| `write_shot` | `dataUrl`, `suggestedName` | 落盘路径 | 静默写入 `图片/Stillframe`，供自动保存 |
| `scroll_at` | `x`, `y`, `notches` | — | 向目标窗口注入竖向滚轮，光标用完即复位（自动滚动长截图用） |
| `start_recording` | `rect?`, `fps?`, `ffmpeg?`, `mic?` | 即将写入的 MP4 路径 | 起抓帧线程 + FFmpeg；`rect` 为全屏冻结图坐标，缺省录整屏；`mic` 默认 `false`，为 `true` 时另起 FFmpeg 进程录麦克风 WAV（设备打不开则静默退回纯画面） |
| `stop_recording` | — | `{path,frames,seconds,fps,dropped,writeAvgMs,grabAvgMs,repeats,backend}` | 停录、停麦克风、等 FFmpeg 收尾（有音轨则再封装一次），回传实绩（`fps` 为内容更新率，重复帧不计；`backend` 带 `+mic` 表示采到了麦克风） |
| `list_windows` | — | `[{title, id}]` | 窗口列表（选区吸附/指定窗口截图） |

保存策略（`src/lib/save.ts`）：桌面端手动保存走 `save_png`、自动保存走 `write_shot`；Android 两端都走 `Bridge.savePng`（相册，无弹窗）；网页端优先写已授权目录，未授权时手动保存退回下载、自动保存直接放弃。

新增命令时同步改三处：`src/lib/desktop.ts`、`desktop/src/lib.rs`、`android/.../Bridge.kt`。
