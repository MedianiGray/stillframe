# 定格 · Stillframe

把「截一张屏」做成一套完整工具：**区域截图、滚动长截图、区域录屏、提取文字、屏幕翻译、标注编辑、贴图钉屏、自动保存**——一套界面，同时跑在浏览器、桌面壳、Android 壳里。

> 项目缘起：QQ 桌面端右键菜单里的截图模块（截图 / 录屏 / 长截图 / 提取文字 / 屏幕翻译 / 隐藏当前窗口 / 自动保存）用起来顺手，但它被锁在聊天软件里，跨端也不成立。这个仓库把那组能力独立实现成可自托管、可二次开发的开源应用——**不含 QQ 的任何代码、图标或私有资源，全部逻辑重新实现**。

![status](https://img.shields.io/badge/build-source--only-informational)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 目录

- [能力总览](#能力总览)
- [三端能力矩阵](#三端能力矩阵)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [核心实现](#核心实现)
- [快捷键](#快捷键)
- [隐私与数据](#隐私与数据)
- [已知限制](#已知限制)
- [路线图](#路线图)
- [贡献](#贡献)
- [许可](#许可)

---

## 能力总览

| 能力 | 说明 |
| --- | --- |
| 区域截图 | 冻结当前画面 → 拖拽自由选框 → 进入标注台。支持整屏一键取景、实时像素尺寸显示 |
| 标注编辑 | 矩形、椭圆、箭头、画笔、高亮、马赛克、文字、序号，八类元素；撤销/重做、颜色与线宽、导出合成 |
| 滚动长截图 | 逐屏「追加一屏」，用**行亮度签名**自动找重叠区拼接；命中失败可手动指定重叠高度 |
| 区域录屏 | 把屏幕流按选区裁切到 canvas，混入系统声/麦克风 → MediaRecorder（VP9/Opus 优先） |
| 提取文字 | tesseract.js 本地 OCR，中英等多语言包按需下载，结果可编辑后复制/导出 |
| 屏幕翻译 | 原文/译文双栏；支持 OpenAI 兼容接口、DeepL、LibreTranslate 三种 provider |
| 贴图钉屏 | 截图钉在屏幕上，可拖拽、可缩放、可关闭（桌面壳内为真·置顶窗口） |
| 自动保存 | File System Access 直写指定目录；不支持时降级为逐次下载 |
| 图库 | IndexedDB 本地保存截图与录屏，缩略图网格 + 详情抽屉 |
| 隐藏当前窗口 | 桌面壳通过系统接口在截图前收起自身窗口，避免把自己拍进去 |
| 全局热键 | 桌面壳注册系统级快捷键；网页端受浏览器限制，无全局热键 |

## 三端能力矩阵

| 能力 | 网页端 (Web) | 桌面端 (Windows/macOS/Linux) | Android | iOS |
| --- | :---: | :---: | :---: | :---: |
| 区域截图 | ✅ 每次授权屏幕共享 | ✅ 系统截屏接口，免授权 | ✅ MediaProjection + 前台服务 | ⚠️ 仅相册导入 |
| 标注 / 导出 | ✅ | ✅ | ✅ | ✅ |
| 滚动长截图 | ✅ | ✅ | ✅ | ⚠️ 仅拼接相册图 |
| 区域录屏 | ⚠️ 只能 WebM，30fps | ⚠️ 原生连续抓帧 3–5fps，可转 MP4 | ⚠️ 原生抓帧约 3fps | ⚠️ 受限 |
| 提取文字 | ✅ | ✅ | ✅ | ✅ |
| 屏幕翻译 | ✅ 需自备 API Key | ✅ | ✅ | ✅ |
| 贴图钉屏 | ❌ 不能置顶 | ✅ 独立置顶窗口 | ✅ 悬浮窗（需授权） | ❌ |
| 隐藏自身窗口 | ❌ | ✅ | ✅（收起 Activity） | ❌ |
| 全局热键 | ❌ | ✅ | ❌（受系统限制） | ❌ |
| 自动保存目录 | ⚠️ 需浏览器支持 | ✅ 直接写盘 | ✅ SAF 目录 | ⚠️ |

图例：✅ 完整支持 · ⚠️ 支持但受平台限制 · ❌ 平台不提供该能力

平台做不到的部分不装作做得到：网页端每次截图都必须由用户点一次「共享屏幕」，浏览器不允许网页偷偷抓屏，也不允许网页注册全局热键、把自己窗口藏起来或让贴图置顶。这些在桌面壳与 Android 壳里由系统接口补齐，源码分别在 `desktop/` 与 `android/`。

## 快速开始

### 网页端

```bash
npm install
npm run dev        # http://127.0.0.1:24118
npm run build      # 产物在 dist/
npm run typecheck  # tsc --noEmit
```

第一次点「开始捕捉」时浏览器会弹出共享选择器，选要截的屏幕/窗口/标签页即可。刷新页面需要重新授权。

### 桌面端（Tauri 2）

前置：Rust 工具链（`rustup`，含 `cargo`）、Node 18+；Windows 另需 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 一般已内置）。

```bash
npm install
npm run build                 # 先生成前端产物 dist/
cd desktop
cargo tauri dev               # 开发
cargo tauri build             # 打包安装包
```

桌面壳直接复用 `dist/`（`tauri.conf.json` 里 `frontendDist` 指向 `../dist`），一套 UI 不改一行。

### Android 端

前置：JDK 17、Android SDK（compileSdk 34 / minSdk 26）、Gradle 8。

```bash
npm run build
# 把前端产物放进 WebView 的 assets
Copy-Item -Recurse -Force dist/* android/app/src/main/assets/www/
cd android
gradlew assembleDebug
```

Android 壳用 `WebView` 加载 `assets/www/index.html` 并注入 `AndroidBridge`，权限流程为：通知权限 → 屏幕录制授权（MediaProjection）→ 悬浮窗权限（可选）。

> **构建状态说明**：本仓库的网页端已在本机完整跑通（`tsc --noEmit` 零错误、dev server 渲染正常）。`desktop/` 与 `android/` 是可直接导入编译的源码工程，但作者本机没有 Rust / JDK / Android SDK 工具链，**未做编译验证**。首次构建若遇版本号或 API 变更，按报错调整依赖版本即可，README 的目录说明给了每个依赖的用途。

## 目录结构

```
stillframe/
├─ src/                      # 前端（React + Vite + TS + Tailwind），三端共用
│  ├─ App.tsx                # 工作台布局与视图状态
│  ├─ components/            # Rail / TopBar / 选区层 / 编辑器 / 图库 / 设置 / 贴图
│  │  └─ panels/             # 长截图 / 录屏 / OCR / 翻译 四个模式面板
│  └─ lib/                   # 与 UI 无关的核心能力
│     ├─ capture.ts          # getDisplayMedia 开流、抓帧、抓选区
│     ├─ annotate.ts         # 八类标注的统一渲染（含马赛克）
│     ├─ stitch.ts           # 行亮度签名找重叠 → 长图拼接
│     ├─ recorder.ts         # 选区裁切 + 混音 + MediaRecorder
│     ├─ ocr.ts              # tesseract.js worker 单例
│     ├─ translate.ts        # 三种翻译 provider
│     ├─ storage.ts          # IndexedDB 图库
│     ├─ autosave.ts         # File System Access 自动保存
│     ├─ desktop.ts          # Tauri 宿主探测与命令桥
│     └─ image.ts / settings.ts / types.ts
├─ desktop/                  # Tauri 2 原生壳（Rust）
│  ├─ src/lib.rs             # capture_screen / pin_image / save_png / list_windows
│  ├─ tauri.conf.json        # 复用 ../dist，置顶贴图窗口
│  └─ capabilities/          # 权限声明（dialog / fs / global-shortcut）
├─ android/                  # Kotlin 原生壳
│  └─ app/src/main/java/.../ # MainActivity / CaptureService / 悬浮窗 / JS Bridge
├─ docs/
│  ├─ PLATFORM-MATRIX.md     # 三端逐项能力与平台限制的完整说明
│  └─ ARCHITECTURE.md        # 模块边界与数据流
└─ .github/                  # CI（类型检查 + 构建）与 issue 模板
```

## 核心实现

### 抓屏：一套抽象，三种来源

`capture.ts` 只认 `MediaStream`：网页端由 `getDisplayMedia` 拿到，桌面壳由 `capture_screen` 命令直接返回整屏 PNG（再转成 canvas）。拿到流之后统一走 `video → grabFrame / grabRegion`，所以选区、长图、录屏三条链路完全复用同一份代码。

### 长截图：为什么用行亮度签名

不用模板匹配（慢、对缩放敏感），而是把每一帧降采样成 32 列的灰度行签名，然后在 24–2400px 的候选区间里滑窗求平均绝对差，取最小且低于阈值（9）的偏移作为重叠高度。命中就按重叠高度拼，未命中按无重叠直接接并提示用户改手动重叠——宁可拼错让人看见，也不静默吞掉内容。

### 录屏：选区裁切在 canvas 里做

`RegionRecorder` 把整屏流每帧按选区 `drawImage` 到离屏 canvas，`canvas.captureStream(fps)` 得到裁切后的视频轨，再用 `AudioContext` 把系统声与麦克风混成一条音轨，最后交给 `MediaRecorder`。这样既不需要服务端，也不用额外装 FFmpeg。

### OCR 与翻译都在本地做调度

OCR 用 tesseract.js 的单例 worker，换语言时 terminate 重建，避免 worker 泄漏。翻译只做调度：请求发给你自己填的 provider（OpenAI 兼容 / DeepL / LibreTranslate），Key 存在本机 `localStorage`，不上传本项目任何服务器——本项目没有服务器。

### 桌面壳与 Android 壳的接法

前端 `desktop.ts` 探测 `window.__TAURI__.core.invoke`（Tauri 2）或注入的 `AndroidBridge`；探测不到就全部回落浏览器实现。判断逻辑集中在一处，UI 不需要关心自己跑在哪个壳里，只在「网页端限制」提示条上如实标注差异。

## 快捷键

| 动作 | 桌面端 | 网页端 |
| --- | --- | --- |
| 区域截图 | `Ctrl+Alt+S` | 点按钮（无全局热键） |
| 区域录屏 | `Ctrl+Alt+R` | 同上 |
| 滚动长截图 | `Ctrl+Alt+C` | 同上 |
| 提取文字 | `Ctrl+Alt+O` | 同上 |
| 屏幕翻译 | `Ctrl+Alt+F` | 同上 |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z` | 同 |
| 复制到剪贴板 | `Ctrl+C` | 同 |
| 另存为 | `Ctrl+S` | 同 |

桌面端热键在 `desktop/src/lib.rs` 的 `register_shortcuts` 里注册，可在设置面板改键位（改完需重启壳）。

## 隐私与数据

- 截图、录屏、OCR 结果、翻译原文**全部在本机处理**，本项目没有后端，也没有任何埋点。
- 图库存在浏览器/壳的 IndexedDB 里；自动保存写你指定的目录。
- OCR 语言包默认从 `tessdata.projectnaptha.com` 按需下载，可改为自托管地址。
- 翻译请求直接发给你配置的 provider，Key 只存本机。用第三方服务时，原文会离开本机——这是你自己选择的出口。
- 录屏音轨涉及麦克风时，浏览器/系统会单独弹权限，拒绝也能只录画面。

## 已知限制

- **网页端录屏只有 WebM**。浏览器 MediaRecorder 不支持直接出 MP4；要 MP4 请用桌面壳或在本地转码：`ffmpeg -i in.webm -c:v libx264 -crf 20 out.mp4`。
- **网页端每次抓屏都要重新授权**，这是浏览器安全模型的硬约束，不是 bug。
- **长截图的重叠识别依赖画面有横向纹理**。纯色/大面积渐变的页面可能识别失败，此时用面板里的手动重叠输入。
- **OCR 首次识别会等语言包下载**（约 10–20MB），之后走缓存。
- **Android 10+ 录屏必须常驻前台服务通知**，系统强制，无法隐藏。
- **iOS 不做系统级抓屏**：Sandbox 不允许跨 App 读屏，仓库只保证「相册导入 → 标注 → 拼接」这条链路可用；未提供 iOS 工程。
- **desktop/ 与 android/ 未在本机编译验证**（缺工具链），见上文构建状态说明。

## 路线图

- [ ] 长截图接入滚动自动捕获（现在需手动逐屏追加）
- [ ] 标注支持图层顺序与自由变换
- [ ] 录屏直出 MP4（桌面壳内置 FFmpeg sidecar）
- [ ] OCR 语言包自托管一键配置
- [ ] 图库导入/导出 `.stillframe` 归档
- [ ] 托盘常驻与截图后快捷动作

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请保证 `npm run typecheck` 与 `npm run build` 通过；涉及原生壳的改动请在 PR 里写明你验证过的平台与工具链版本。

## 许可

[MIT](LICENSE)。本项目为独立实现，与腾讯 / QQ 无关联，未使用其任何代码或资源；「QQ」「截图」等名称仅用于说明功能对标关系。
