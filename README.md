# 定格 · Stillframe

把「截一张屏」做成一套完整工具：**区域截图、滚动长截图、区域录屏、提取文字、屏幕翻译、标注编辑、贴图钉屏、自动保存**——一套界面，同时跑在浏览器、桌面壳、Android 壳里。

> 项目缘起：QQ 桌面端右键菜单里的截图模块（截图 / 录屏 / 长截图 / 提取文字 / 屏幕翻译 / 隐藏当前窗口 / 自动保存）用起来顺手，但它被锁在聊天软件里，跨端也不成立。这个仓库把那组能力独立实现成可自托管、可二次开发的开源应用。**界面规格不是凭空设计的**：工具顺序、调色板、滤镜名、文案、窗口尺寸逐项对照本机 QQ 9.9.38 的 `QQScreenShot` 资源包，证据与提取脚本见 [docs/QQ-PARITY.md](docs/QQ-PARITY.md) 与 `tools/qq-resource-probe.py`；仓库不含 QQ 的任何代码、图标或私有资源，全部逻辑重新实现。

![Stillframe 工作台](docs/overview.png)

![status](https://img.shields.io/badge/build-source--only-informational)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 目录

- [能力总览](#能力总览)
- [三端能力矩阵](#三端能力矩阵)
- [快速开始](#快速开始)
- [什么叫做智慧截图](docs/SMART-CAPTURE.md)
- [与 QQ 截图模块的对照](#与-qq-截图模块的对照)
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
| 区域截图 | 冻结当前画面 → 拖拽自由选框 → 悬浮工具栏。带 QQ 同款 132×152 放大镜（117×84 取景 + 尺寸 + RGB 色号），双击快速完成、右键退出 |
| 标注编辑 | 七件套：矩形、椭圆、箭头、画刷、马赛克、文字、序号笔；12 色 QQ 原值调色板、1/3/7 三档线宽、模糊度、字号、文字行距；拖动时 `Shift` 等比（方块/正圆）、`Alt` 把箭头吸到 0°/45°/90°，撤销/重做都可点可键 |
| 滤镜 | 原图、日光海岸、LOMO、旧照片、黑白照、素描、经典LOMO、彩虹、铜版画、拍立得、日系甜美、黄昏，十二项名称照搬 QQ 滤镜栏 |
| 滚动长截图 | 逐屏「追加一屏」，行亮度签名自动找重叠；桌面壳支持自动滚动（向目标窗口注入滚轮，逐帧拼接，连续两帧无重叠即判到底），自身窗口压住选区时会自动隐藏再恢复；支持垂直/水平两个方向，命中失败可手动指定重叠 |
| 区域录屏 | 桌面壳由 Rust 抓帧线程按 30 帧抓选区，原始帧管道喂给 FFmpeg（rawvideo → libx264 CRF 20）直出 MP4，落在 `图片/Stillframe`；网页端仍是 canvas 裁切 + MediaRecorder（VP9/Opus 优先，只能 WebM）。录制中可用 QQ 录屏条那六件套（画刷/矩形/椭圆/箭头/文字/激光）标注，**两端都会合进成片**：桌面壳逐帧用 GDI 烧进画面，网页端画在 canvas 流里 |
| 提取文字 | tesseract.js 本地 OCR，识别引擎与中英语言包随站点内置（fast 版，中文包约 1.7MB），断网可用，结果可编辑后复制/导出；识别完会判读内容类型（正文 / 代码 / 表格 / 清单）并预选动作；可一键导出 Markdown（清单补 `-`、代码包代码块、正文按段空行），直接粘进飞书 / Notion / Obsidian |
| 屏幕翻译 | 原文/译文双栏；支持 OpenAI 兼容接口、DeepL、LibreTranslate 三种 provider |
| 贴图钉屏 | 截图钉在屏幕上，可拖拽、可缩放、可关闭（桌面壳内为真·置顶窗口） |
| 自动保存 | File System Access 直写指定目录；不支持时降级为逐次下载 |
| 图库 | IndexedDB 本地保存截图与录屏，缩略图网格 + 详情抽屉 |
| 隐藏当前窗口 | 桌面壳通过系统接口在截图前收起自身窗口，避免把自己拍进去 |
| 全局热键 | 桌面壳注册系统级快捷键；被其他截图工具占用时会在界面顶部点名「哪组键没抢到」并指向替代入口；网页端受浏览器限制，无全局热键 |
| 快捷浮窗 | 桌面壳的一条置顶动作条（截图/长图/录屏/取字/译屏），`Ctrl+Alt+Q` 呼出，主窗最小化也能用 |
| 延时截图 | 立即 / 3s / 5s；倒计时结束先收起自身窗口再抓帧，适合截右键菜单、下拉列表 |
| 窗口截图 | 从真实窗口列表里挑一个，整窗抓进来（含被遮挡部分），再进标注 / 取字 / 翻译 |
| 内网部署 | `deploy/` 提供 Docker Compose + 预热脚本，把网页版、识别引擎与语言包整体放到实训室内网，无需外网 |

## 三端能力矩阵

| 能力 | 网页端 (Web) | 桌面端 (Windows/macOS/Linux) | Android | iOS |
| --- | :---: | :---: | :---: | :---: |
| 区域截图 | ✅ 每次授权屏幕共享 | ✅ 系统截屏接口，免授权 | ✅ MediaProjection + 前台服务 | ⚠️ 仅相册导入 |
| 标注 / 导出 | ✅ | ✅ | ✅ | ✅ |
| 滚动长截图 | ✅ | ✅ | ✅ | ⚠️ 仅拼接相册图 |
| 区域录屏 | ⚠️ 网页端只能 WebM，30fps | ✅ 原生直出 MP4，1080p 60 秒实测 28–30fps、丢帧 <1%；可带麦克风，系统声走 WASAPI 环回（两路可同时）；录屏条标注逐帧烧进成片 | ⚠️ 原生抓帧约 3fps | ⚠️ 受限 |
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

> **构建状态说明**：网页端 `tsc --noEmit` 零错误、`npm run build` 通过；`desktop/` 已在 Windows 上用 Rust 1.100 + MSVC 编译并真机验收（截图、窗口截图、取字、延时、快捷浮窗、1080p 60 秒录屏、带麦克风录制、系统声、录屏标注进成片）；自动滚动代码完成但 20 屏样本未跑够；录制管线编码侧在 Linux 真跑（90 帧合成画面 → h264 MP4，时长 3.000s、帧数 90 与输入吻合），Windows 真机 1080p×60 秒三轮 27.9–29.0fps、丢帧均 <1%、成片时长为整秒；带麦克风 1080p×30 秒成片 29.933 秒、音画差 66ms；系统声（WASAPI 环回）720p×20 秒成片音轨 19.816 秒、`mean_volume -5.0 dB`，麦克风+系统声两路同时 15 秒成片 15.000 秒、单条 AAC；录屏标注 1280×720×12 秒 5 条标注逐条按时出现、丢帧 0、每帧额外开销约 1.5ms；`android/` 仍是未做编译验证的源码工程（本机无 JDK / Android SDK），首次构建若遇版本号或 API 变更，按报错调整依赖版本即可。

## 与 QQ 截图模块的对照

这套界面的每一项都不是"设计出来的"，而是从本机 QQ 9.9.38（QQNT）的 `QQScreenShot` 资源包里读出来再实现的：

```bash
# 只读，不碰 QQ 任何文件；输出可读的 XML/PNG
python tools/qq-resource-probe.py "C:\Program Files\Tencent\QQNT" -o ./qq-dump
```

- 工具条顺序、15 个按钮、tooltip 文案 → `QQScreenShot.rdb` 的 `ScreenCaptureWnd/CaptureToolbar`
- 12 色板色值（`#800000` / `#FB3838` / `#F7883A` …）→ `CameraPellette*Color` 按钮的 `Brush clrFrom`
- 12 个滤镜名、长截图方向条、录屏六件套、识图/翻译窗 540×440 → 同一份 XML
- 全部中文文案 → `Default.rdb` 的 `StringBundle`

逐项对照表、原始 XML 片段、以及"哪些照搬了、哪些只是近似、哪些没做"都写在 **[docs/QQ-PARITY.md](docs/QQ-PARITY.md)**。

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

### 录屏：网页端在 canvas 里裁，桌面壳交给 FFmpeg

网页端 `RegionRecorder` 把整屏流每帧按选区 `drawImage` 到离屏 canvas，`canvas.captureStream(fps)` 得到裁切后的视频轨，再用 `AudioContext` 把系统声与麦克风混成一条音轨，交给 `MediaRecorder`——不依赖服务端，也不用装 FFmpeg，代价是只能出 WebM。

桌面壳改走原生：`start_recording` 起一个抓帧线程，按目标间隔抓选区，原始像素直接写进 `ffmpeg -f rawvideo` 的 stdin，编成 MP4。这样绕开了 WebView 里那条「轮询抓帧只有个位数帧率」的路，也让成片能直接播放和转发。

抓帧与编码各有一条回退链，都是先试快的、不行再退稳的：

- **抓帧**：优先 DXGI Desktop Duplication（桌面合成器直接给帧，1080p 实测 6–9ms/帧）；建不起来（旧显卡、会话不支持、驱动拒绝）自动退 `BitBlt` + `CreateDIBSection`（25fps 量级，够用但吃 CPU）。静态画面时 Duplication 不给新帧，沿用上一帧顶住时间轴。
- **编码**：先真编 5 帧探测 `h264_qsv`（编码器列表里有不代表驱动可用），能用就走核显、把 CPU 留给抓帧；不能用退 libx264 `ultrafast`。
- **节奏**：录制期间 `timeBeginPeriod(1)`（Windows 默认定时器粒度 15.6ms 会把 `sleep(33ms)` 拉成 46ms）；每帧的目标帧数只由「已跑秒数 × 帧率」决定，抓帧追不上就重复当前帧补齐，剩 2ms 以内忙等到点（Windows 的 `sleep(3ms)` 常常只睡 1–2ms，累积会把帧率抬到 31），收尾再按实际秒数补足，成片时长因此精确等于录制时长，不会快放。

结束时的实绩（`秒 · fps · 帧数`，并附带 `grab` / `write` 耗时、补帧数、实际后端如 `dxgi+h264_qsv`）可以在 `--record-probe` 的日志里直接核对。Windows 真机 1080p×60 秒三轮：29.0 / 27.9 / 28.1fps，丢帧 0.44% / 0.72% / 0.75%，`duration` 均为整秒。

### 录屏的声音：麦克风独立进程，系统声走 WASAPI 环回，停下再封装

麦克风**不接进编码器**，而是另起一个 FFmpeg 进程录 48kHz 单声道 WAV，停录时发 `q` 让它正常收尾，视频编完再用有限文件封装（`-c:v copy -c:a aac -b:a 128k`）。

原因很实际：dshow 是无限实时流。把它当编码器的第二个输入后，视频 stdin 已经 EOF，FFmpeg 仍在等音频，`-shortest` 也不生效——停录后进程不退，界面直接卡住。分离之后视频照旧干净收尾，音频进程单独停，两边都不会互相等。

音画起点靠自动校准：WAV 头里读采样率/声道/位深算出它录了多久，比画面多出来的那段用 `-ss` 裁掉，尾部再 `-shortest` 追齐。实测 1080p×30 秒带麦克风：成片 29.933 秒、音频 29.999 秒，音画差 66ms；15 秒样本差 32ms。

麦克风默认**不开**——录进别人的声音不是小事，只有用户在录屏条上点了麦克风才采。设备被别的程序占用或无权限时静默退回纯画面，结果条里的 `backend` 会多一个 `+mic` 或者没有。

系统声（扬声器里放的声音）走**自写的 WASAPI 环回**：本机 `ffmpeg -f dshow -list_devices` 只暴露麦克风阵列、没有立体声混音端点，官方 FFmpeg 构建也没有 `-f wasapi` 输入。所以直接在桌面上写了 `win_audio`：取默认渲染设备的混音格式 → `IAudioClient::Initialize(AUDCLNT_STREAMFLAGS_LOOPBACK)` → `IAudioCaptureClient` 逐包读，混成单声道 16 位 WAV，停止时回填 RIFF 头。系统声和麦克风可以同时开，两条音轨收尾时用 `amix` 合成一条 AAC。

真机实测：720p×20 秒 + 系统声，一边用 `ffplay` 放 440Hz 正弦——成片音轨 19.816 秒、`mean_volume -5.0 dB`（确实采到了声音）；两路同时开（`+mic+sys`）15 秒成片 15.000 秒、单条 AAC 705 帧；`backend` 会写成 `dxgi+h264_qsv+mic+sys`，一眼看得出这次采了几路。

要注意的边界：环回采的是「默认播放设备正在渲染的内容」，如果录制全程设备上什么都没在播，环回不会产出任何音频包，成片就**没有音轨**（不会给你塞一条空音轨）；想录别的程序的系统声，得确认它真的在出声。

probe 的三个开关可以叠加：`--probe-audio`（麦克风）、`--probe-system`（系统声）。

不想开界面也能标定：`stillframe-desktop.exe --record-probe=<mp4 路径>:<秒数> [--probe-rect=x,y,w,h] [--probe-audio] [--probe-system] [--probe-annot=<json>]`，跑完把结果写到 `<mp4 路径>.log`，退出码 0/1。`--probe-annot` 会预置一组标注（见下节），用来核对「画在录屏条上的笔迹到底进没进成片」。

FFmpeg 的查找顺序：命令参数 → 环境变量 `STILLFRAME_FFMPEG` → 应用目录（`ffmpeg.exe`、`sidecars/ffmpeg.exe`、`binaries/ffmpeg.exe`）→ PATH。都找不到时，点开始录制会直接报错退出，不会静默录出一段空文件。

编码这条链路可以脱离 GUI 单独验：`cargo run --manifest-path tools/recorder-check/Cargo.toml`——喂 90 帧合成画面给 FFmpeg，再用 `ffprobe` 核对编码、分辨率、帧数与时长；CI 里也有同名任务。

### 录屏的标注：落定即推，逐帧烧进画面

QQ 录屏条上画的箭头、方框、文字会跟着录像一起出现在成片里，这件事在桌面壳上此前是缺的（原来只有网页端把标绘画进 canvas 流）。现在这条链闭合了：

- **前端只管推**：标注一落定（松开鼠标、文字回车）就把这一条推进桌面壳，坐标、线宽、字号都按选区宽高归一化（`0..1`），附一个 `atMs`（相对录制开始的毫秒）；激光笔按 40ms 节流推轨迹点。
- **后端只管画**：录制线程每帧取一次标注快照，把有内容的条目按出现时刻筛出来。抓帧器交出的本来就是 BGRA，直接 `memcpy` 进一块 32 位 DIB，之后全用 GDI 在这块像素上画：矩形 / 椭圆是手写的多段折线（避开实心画刷的坑），箭头是线 + 实心三角，文字用 `Microsoft YaHei UI` 逐行输出（行距 1.28），激光是一路随时间收缩的红点。
- **没有标注就零成本**：一条活动标注都没有的帧完全不碰 DIB，还是原来的裸缓冲直接喂编码器。实测 1280×720 每帧只多 1.5ms（`write_avg` 2.3ms → 3.8ms），离 33ms 预算还很远。
- **撤销也跟着走**：画布上点「撤销 / 清除」会同时通知桌面壳丢掉最后一条 / 清空，成片里后面的帧不再画它。已经录进去的那几帧保持原样——录像不能倒着改，这一点如实写在限制里。
- **时序对得上**：`atMs` 以开始录制的那一刻为原点，验收中 1s 的方框、2s 的椭圆、3s 的箭头、4s 的画笔、5s 的文字，在成片 2s / 4s / 6s 的抽帧里逐条按序出现，没有提前也没有漏。
- **验收数据**：1280×720 × 12 秒（黑底无缝窗口）+ 5 条标注 → `frames=360 seconds=12 dropped=0`，抽帧画面里五条标注齐全；同条件无标注对照 `write_avg_ms=2.3`。
- **绘制用 GDI 的代价**：没有抗锯齿，斜线和圆比 QQ 的 Direct2D 略硬；标注不可在画布上再选中、拖拽微调（落笔即固定，画错靠撤销）。


### OCR 与翻译都在本地做调度

OCR 用 tesseract.js 的单例 worker，换语言时 terminate 重建，避免 worker 泄漏。识别引擎（worker + WASM 核心）与中英 fast 语言包都随站点内置，主线程预取解压后写进 IndexedDB 给 Worker 命中，整条链路不依赖网络。翻译只做调度：请求发给你自己填的 provider（OpenAI 兼容 / DeepL / LibreTranslate），Key 存在本机 `localStorage`，不上传本项目任何服务器——本项目没有服务器。

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
- OCR 识别引擎与中英语言包默认随站点内置（fast 版），离线可用；设置里也可改填自托管语言包目录，追加日/其他语言。
- 翻译请求直接发给你配置的 provider，Key 只存本机。用第三方服务时，原文会离开本机——这是你自己选择的出口。
- 录屏音轨涉及麦克风时，浏览器/系统会单独弹权限，拒绝也能只录画面。

## 已知限制

- **桌面壳原生录制的音频能到「麦克风 + 系统声」，但系统声有前提**：环回采的是默认播放设备的渲染内容，录制全程设备没出声就不会有音轨；多显示器 / 独占模式播放器的声音也可能取不到。
- **录屏标注用 GDI 画，没有抗锯齿**：斜线与椭圆边缘比 QQ 的 Direct2D 略硬，字重也固定用 600。要更细腻得换 Direct2D / Skia 后端，属后续项。
- **标注撤销只影响后面的帧**：已经录进成片的帧保持原样（录像不能倒着改）；标注也不能在画布上再选中拖拽微调，落笔即固定，画错靠撤销重画。
- **麦克风设备被独占时不出声**。录制前会先空编一小段确认能采，采不动就静默退回纯画面，不阻断录制；`backend` 里有没有 `+mic` 就是结果。
- **网页端录屏只有 WebM**。浏览器 MediaRecorder 不支持直接出 MP4；要 MP4 请用桌面壳或在本地转码：`ffmpeg -i in.webm -c:v libx264 -crf 20 out.mp4`。
- **网页端每次抓屏都要重新授权**，这是浏览器安全模型的硬约束，不是 bug。
- **长截图的重叠识别依赖画面有横向纹理**。纯色/大面积渐变的页面可能识别失败，此时用面板里的手动重叠输入。
- **长截图自动滚动只在桌面壳可用**：它要向目标窗口注入滚轮事件，网页端没有平台级输入注入，请手动滚动后点追加。自动滚动目前只做竖向；`20 屏成功率 ≥90%` 这一项还没有在真机上跑够样本。
- **滤镜是参数近似**。QQ 用自家图像引擎，这里用 Canvas 的 `filter` + 压暗/着色近似十二种观感，同图不同机会有细微差别。
- **修饰键只在按住时生效，不做粘滞**。`Shift` 等比、`Alt` 吸附直线要在拖动过程中一直按住；松手即定稿，不提供「按住一次就锁住」的模式。
- **标注还不能拖拽微调**。落笔即固定，画错了靠撤销重来；选中已画的标注再移动/缩放仍是后续项。
- **OCR 首次识别要等语言包就位**：内置包首次会从站点读入并写入 IndexedDB（约 3–4MB，一次性），之后走缓存；中文包 1.73MB 已随站点分发，不再从外网拉。
- **导出的 Markdown 只搬结构、不改文字**：清单补 `-`、代码包代码块、正文按段空行；表格没有列分隔符可循，按行保真输出而不是硬拼成表格；识别错字仍要自己改。段落还原率（目标 85%）还没对真图做量化。
- **Android 10+ 录屏必须常驻前台服务通知**，系统强制，无法隐藏。
- **iOS 不做系统级抓屏**：Sandbox 不允许跨 App 读屏，仓库只保证「相册导入 → 标注 → 拼接」这条链路可用；未提供 iOS 工程。
- **录屏帧率取决于机器与桌面会话**。抓帧走 DXGI 时 1080p 约 6–9ms/帧；退回 BitBlt 时在远程/低配会话会掉到 20–25fps。`h264_qsv` 不可用会退 libx264，此时编码也会抢 CPU。实际走了哪条路径，看结束统计里的 `backend`（如 `dxgi+h264_qsv`）。
- **静止画面不产生新帧**。Desktop Duplication 只在画面变化时给帧，录制里用上一帧补齐时间轴——成片时长与帧率都正确，但一段完全静止的录屏看起来就是一张静止图，这是预期行为。
- **多显示器与混合 DPI 仍按单屏假设处理**：选区、窗口、滚动注入点用的是同一套坐标，副屏或 125%/150% 混排时可能出现偏移。
- **android/ 未编译验证**（本机缺 JDK / Android SDK），见上文构建状态说明。

## 路线图

升级范围、技术方案、排期与验收口径见 **[docs/UPGRADE-PLAN.md](docs/UPGRADE-PLAN.md)**（同一内容的 Word 版在 `docs/Stillframe-升级项目书-v1.0.docx`）。当前排期：

- [ ] v0.2 可用性补齐（第 1–6 周）：桌面落盘、Alt 吸附与等比、贴图管理、识图段落（已完成主体，剩 E2E；见 [CHANGELOG.md](CHANGELOG.md)）
- [x] 长截图自动滚动（桌面壳注入滚轮 + 逐帧拼接 + 到底判定）
- [ ] v0.3 录制（第 7–14 周）：1080p30 录制直出 MP4（画面链路 1080p 60 秒 28–29fps、丢帧 <1%；麦克风、系统声、标注进成片都已接通，剩 4K 内存峰值与脏矩形优化）
- [ ] v1.0 发布（第 15–20 周）：三端安装包、双语、性能与测试基线
- [ ] 标注支持图层顺序与自由变换
- [x] OCR 引擎与语言包内置、离线可用，语言包目录可改填自托管地址
- [ ] 图库导入/导出 `.stillframe` 归档

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请保证 `npm run typecheck` 与 `npm run build` 通过；涉及原生壳的改动请在 PR 里写明你验证过的平台与工具链版本。

## 许可

[MIT](LICENSE)。本项目为独立实现，与腾讯 / QQ 无关联，未使用其任何代码或资源；「QQ」「截图」等名称仅用于说明功能对标关系。
