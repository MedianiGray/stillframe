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
| 容器 | WebM (VP9/Opus) | WebM（可加 FFmpeg 转 MP4） | WebM（Android WebView 的 MediaRecorder） |
| 帧率 | 30fps（由 `captureStream(fps)` 决定） | **3–5fps**（原生抓帧 + PNG 回传，`openNativeSession` 默认 320ms 一帧） | **约 3fps**，同上 |
| 区域裁切 | ✅ canvas | ✅ | ✅ |
| 系统声 | ⚠️ 取决于系统与浏览器（多数只给标签页/窗口声） | ❌ 原生抓帧链路不带音频（要系统声需 WASAPI 采集，未实现） | ❌ 同上（`AudioPlaybackCapture` 可做，未接） |
| 麦克风 | ✅ | ❌（同上） | ❌（同上） |
| 暂停/继续 | ✅ | ✅ | ✅ |
| 前台通知 | — | — | ✅ 系统强制 |

**为什么桌面/Android 只有 3–5fps**：这两种壳的帧来自系统截屏 API，每帧要编码成 PNG、再转 base64 穿过一次 JS 边界。要做到 30fps 必须把编码器下沉到原生（Windows 用 Desktop Duplication API + Media Foundation，Android 用 `MediaCodec` 直连 `VirtualDisplay`），这是 v0.2 的计划，不在当前版本里假装支持。

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
