# 三端能力矩阵（详版）

这张表是对外承诺：写 ✅ 的必须真能用，写 ❌ 的是平台不给，不拿"理论上可以"糊过去。

## 1. 抓屏来源

| | 网页端 | Tauri 桌面壳 | Android |
| --- | --- | --- | --- |
| 机制 | `getDisplayMedia` | 系统截屏（`xcap`）→ 整屏 PNG | `MediaProjection` + `ImageReader` |
| 授权 | 每次弹共享选择器 | 系统权限/屏幕录制权限一次 | 每次会话授权（系统强制） |
| 能否静默后台抓屏 | ❌ | ✅ | ⚠️ 会话内可连续抓，结束后需重新授权 |
| 能否指定窗口 | ✅ 用户在系统选择器里选 | ✅ `list_windows` 给列表 | ❌ 只能整屏再裁 |
| 隐藏自身窗口 | ❌ | ✅ `hide_self()` | ✅ `moveTaskToBack` |

## 2. 编辑与导出

| | 网页端 | 桌面壳 | Android |
| --- | --- | --- | --- |
| 八类标注 | ✅ | ✅ | ✅ |
| 撤销/重做 | ✅ 内存历史栈 | ✅ | ✅ |
| 导出 PNG/JPEG | ✅ canvas | ✅ + 系统保存框 | ✅ + SAF |
| 复制到剪贴板 | ✅ `ClipboardItem` | ✅ 原生剪贴板 | ✅ `ClipboardManager` |
| 贴图置顶 | ❌ 网页无法置顶 | ✅ 独立 always-on-top 窗口 | ✅ `TYPE_APPLICATION_OVERLAY` |
| 贴图交互 | 仅页内浮层 | 拖拽/缩放/右键菜单 | 拖拽/缩放/关闭 |
| 全局热键 | ❌ 浏览器禁止 | ✅ `global-shortcut` | ❌（需无障碍或特殊权限，不做） |

## 3. 长截图

| | 网页端 | 桌面壳 | Android |
| --- | --- | --- | --- |
| 逐屏追加 | ✅ | ✅ | ✅ |
| 自动重叠识别 | ✅ 行亮度签名 | ✅ 同算法 | ✅ 同算法（Kotlin 移植） |
| 手动重叠 | ✅ | ✅ | ✅ |
| 自动滚动捕获 | ❌（当前需手动滚动） | ❌ | ❌ |

## 4. 录屏

| | 网页端 | 桌面壳 | Android 壳 |
| --- | --- | --- | --- |
| 容器 | WebM (VP9/Opus) | **MP4（H.264）**，Rust 抓帧线程原始帧直喂 FFmpeg（`h264_qsv` 可用则硬件编码，否则 libx264 CRF 20） | WebM（Android WebView 的 MediaRecorder） |
| 帧率 | 30fps（由 `captureStream(fps)` 决定） | **30fps 目标**，实测 1080p 区域 20–30fps（DXGI 约 6–9ms/帧；退回 BitBlt 时远程/低配会话 20–25fps）。点「开始录制」后要等首帧就绪（界面显示「准备中…」，实测 3–13 秒），`REC` 亮起才是真的在录 | **约 3fps**（原生抓帧 + PNG 回传，`openNativeSession` 默认 320ms 一帧） |
| 区域裁切 | ✅ canvas | ✅ 抓帧侧按选区裁 | ✅ |
| 系统声 | ⚠️ 取决于系统与浏览器（多数只给标签页/窗口声） | ✅ WASAPI 环回（与麦克风可同时，停下再封装进 MP4） | ❌（`AudioPlaybackCapture` 可做，未接） |
| 麦克风 | ✅ | ✅ 录屏条上开关，默认关；设备被占用或无权限时静默退回纯画面 | ❌ |
| 暂停/继续 | ✅ | ✅ | ✅ |
| 前台通知 | — | — | ✅ 系统强制 |
| 录屏条标注进成片 | ✅ 画在 canvas 流里 | ✅ 逐帧用 GDI 烧进画面（撤销只影响后面的帧） | ❌ |

**桌面壳为什么能做到 30fps、Android 还停在 3fps**：桌面壳已把编码器下沉到原生（Desktop Duplication / BitBlt 抓帧 → FFmpeg 直出），帧不进 JS 边界；Android 仍是「系统截屏 → PNG → base64 → JS」的老链路，要提速得走 `MediaCodec` 直连 `VirtualDisplay`，尚未接。

## 5. OCR 与翻译

| | 网页端 | 桌面壳 | Android |
| --- | --- | --- | --- |
| OCR 引擎 | tesseract.js（WASM） | 同 | 同（WebView 内） |
| 离线 | 语言包缓存后离线 | 同 | 同 |
| 翻译 provider | OpenAI 兼容 / DeepL / LibreTranslate | 同 | 同 |
| Key 存放 | `localStorage` | `localStorage`（壳内） | `localStorage`（WebView） |
| 需要联网 | 翻译需要 | 同 | 同 |

## 6. 为什么不给 iOS 原生工程

iOS 的 App Sandbox 不允许跨应用读取屏幕内容。ReplayKit 只能录自己 App 的画面，且系统会显著提示；截图 API 只能截自己。所以 iOS 上"截图工具"的合法形态只有：从相册导入图片 → 标注 → 拼接 → 导出。仓库不提供 iOS 工程，只保证前端这条链路（`LibraryView` 的导入入口 + 标注 + 拼接）可用；如需上架，自行用 SwiftUI 包一层 `WKWebView` 即可。

## 7. 浏览器兼容性基线

- 截图/录屏：Chrome 88+、Edge 88+、Firefox 110+（`getDisplayMedia` 与 `MediaRecorder`）。
- 自动保存目录：Chromium 系（`showDirectoryPicker`）。Safari/Firefox 回落为逐次下载。
- 剪贴板写图：Chromium 系；其余回落为下载。
