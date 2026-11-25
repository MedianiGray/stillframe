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

## 索引与存储

- 设置：`localStorage`，键 `stillframe.settings.v1`，写入时广播事件让已挂载的组件同步。
- 图库：IndexedDB `stillframe` 库的 `shots` store，存 `{id, kind, blob, thumb, meta}`，缩略图单独存以减少列表渲染开销。
- 自动保存：`showDirectoryPicker()` 拿句柄后持久化到 IndexedDB，下次启动先 `queryPermission()`，需要时再 `requestPermission()`。

## 原生壳契约

前端只依赖四个命令，桌面壳与 Android 桥都必须提供同名能力：

| 命令 | 入参 | 返回 | 用途 |
| --- | --- | --- | --- |
| `capture_screen` | — | `data:image/png;base64,...` | 整屏抓帧，免授权 |
| `pin_image` | `dataUrl` | — | 开一个置顶窗口贴图 |
| `save_png` | `dataUrl`, `suggestedName` | 保存路径 | 系统保存对话框 |
| `list_windows` | — | `[{title, id}]` | 窗口列表（选区吸附/指定窗口截图） |

新增命令时同步改三处：`src/lib/desktop.ts`、`desktop/src/lib.rs`、`android/.../Bridge.kt`。
