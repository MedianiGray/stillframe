# 变更记录

## v0.4 第十五批：录屏「界面路径」也是 0 帧——开始录制要先等到第一帧（2026-11-28）

### 修：界面上录出来的仍然是 262 B 空片

- 现象：解锁屏幕后按真实界面走「录屏 → 框选 1152×540 → 双击 → 开始录制 → 6 秒 → 结束」，界面 `REC · 00:06` 计时正常，成片仍是 262 B。日志只有一行 `[record] frames=0 elapsed=0.003 backend=dxgi`。
- 根因：`start_recording` 只是 `spawn` 一个录制线程就返回，而线程真正就绪（建 DXGI 抓帧器、起 FFmpeg 管线、建标注图层）要十几秒。前端从「invoke 返回」开始跑秒表，用户点停止时线程才刚进循环第一帧，`stop` 已经是 true → 一帧没录。`--record-probe` 看起来正常，是因为它有 `seconds_limit`、会把这段时间算进去，掩盖了启动延迟。
- 修法（`start_recording` 改 `async fn`）：
  - spawn 后**轮询等第一帧真正写进编码器**（`progress: Arc<AtomicU64>` 每帧自增），最多 20 秒；出帧后才把 `Recording` 放进槽位并返回路径。于是前端秒表与真实录制对齐，停止时一定有帧。
  - 等不到就如实报错：线程已退则抛它自己的错误，否则「录制启动超时：20 秒内没录到第一帧……」。
  - 槽位里如果留着已经退出的线程（抓帧失败导致线程提前结束，但槽位没清），下一次开始会被「已经在录制」永久挡住——现在先看 `handle.is_finished()`，已结束就清掉。
- 前端（`RecordPanel`）：新增 `preparing` 态，按钮在这十几秒里显示「准备中…」并禁用，避免用户以为没点上反复点；`catch` 不再只认 `Error` 实例，Tauri 抛回来的 `Err(String)` 会原样显示（原来会被替换成「无法开始原生录制」，把真正原因吞掉）。
- 真机验证（解锁态，两次）：
  - 第一次：准备 13.2s → `REC`，录 8.37 秒，**251 帧 / 21.3 fps / `dxgi+h264_qsv`**，成片 33 KB；`ffprobe` 读出 1152×540、30/1、251 帧、8.3667s，抽帧是真实桌面。
  - 第二次：205 帧 / 6.834 秒 / 24.6 KB，同样有效。
- 顺带把 `record_loop` 的排障日志补上（起录参数、停止信号、到时收尾、抓帧失败原文、每 30 帧的抓帧耗时），下次再出问题不用靠猜。

### 修：验收脚本自己会「关掉被验收的东西」

- `shell-probe.mjs` 取 `context.pages()[0]` 当主窗：只要开着快捷浮窗或贴图，先注册的 target 是 `quick.html` / `pin.html`，所有选择器都落在那两个迷你页上，报出来的错和真实原因对不上。改成按 URL 挑主窗。
- 两个脚本结尾都调了 `browser.close()`：CDP 模式下这会把宿主窗口一起关掉（日志里那句「关窗收进托盘」就是它），壳跟着退出，下一轮直接 `ECONNREFUSED`。删掉，改为只退出 Node。
- `shell-probe` 的 record flow 不再固定 `sleep(4.2s)` 后点停止，改成轮询等「结束录制」出现（最多 40 秒）再录 6 秒，避免又踩在启动延迟上。

### 新增：`tools/shell-shots.mjs`——给每个模块拍界面实况

- 物理屏截图只能拍到显示器上的东西（锁屏/休眠时就是一块纯色），WebView 里的界面却一直在渲染。`page.screenshot()` 拿的是窗口自己画的内容，所以任何面板的样子都能随时留证据。
- 入口只有待机页的「开始捕捉」（左侧导航只是切模式，点了不会开拍）；每轮之间用 `reload` 复位，比去猜编辑器/面板上的退出按钮稳。
- `--only=snap|set|ocr|record|quick|pin`；本轮实拍 9 张：主界面、覆盖层、框选读数、标注台、设置、取字结果、录屏面板、快捷浮窗、贴图窗口。

### 修：窗口截图下拉默认选中一个隐藏窗口

- 现象：主界面「窗口截图」默认选中 `ToolBarHiddenWindow · MSPCManager`，点「截这个窗口」得到 596 B 的空图。
- 根因：`list_windows` 只过滤了空标题，没管窗口是否可见；QQ/Office 这类应用常驻一批 0 尺寸的隐藏辅助窗，标题非空，于是排在列表最前。
- 修法：跳过 `id == 0`、宽或高 < 16 的窗口；Windows 上再用 `IsWindowVisible` 兜一道。最小化窗口保留（点它会提示「先还原再截」，这是有用信息）。
- 真机验证：列表从一堆隐藏窗变成唯一真实可见的「批量获取信息 - 豆包 · Doubao」，`capture_window` 拿到 597 KB 实际画面。

### 修：录屏说明文案里的过时帧率

- 主界面底部原写「帧率受系统截屏耗时限制（约 3–5fps）」，是 PNG 回传时代的口径；原生抓帧实测 20–30fps。改成实测值，并把「开始录制后要等首帧」写进去。
- `docs/PLATFORM-MATRIX.md` 第 4 节整表按现状重写（MP4 / H.264、系统声、麦克风、录屏条标注进成片、起录就绪门控）。

### 验证

- 前端：`tsc --noEmit` 0 错、`vitest run tests` 8 文件 64 条全绿、`vite build` 通过（`main-hCn8oAP2.js`）。
- 桌面壳真机（解锁态）：录屏界面全流程出片（251 帧 / 8.37s、205 帧 / 6.83s）；取字面板置信度 93.0、识别出 84 字符 5 段；设置页三项小节齐；快捷浮窗 6 个按钮齐；贴图窗口正常。
- 录屏的启动延迟与帧率如实暴露：准备 13.2s、实际 21.3 fps（抓帧 8.7–28.9 ms/帧）。界面上原本写着「3–5fps」，实际比文案好，但准备期必须让用户看见。

### 真机复核：长截图走通到面板，自动滚动在本机回退为手动追加

- `shell-probe --flow=scroll` 原来漏了「选区双击收口」这一步，停在选区层自然找不到自动滚动按钮（脚本还按一个不存在的「开始拼接」文案去点）。补上双击，改成按 `title*="自动滚动"` 点真实按钮。
- 顺带补 `process.exit()`：connectOverCDP 之后不显式退出，node 的 event loop 会被 CDP 连接吊住，脚本跑完也不返回（上一轮 scroll 任务就是这么挂住的）。
- 真机结果：长图 → 框选 960×540 → 双击 → 面板「长截图工具 960 × 540 · 1 屏」→ 点自动滚动 → 回退提示「自动滚动失败；已切换为手动追加，滚动后点加号即可」，面板给出「手动重叠 px / 重来」。链路与回退都在；本机当前桌面没有可滚动内容，所以没产出多屏样本，拼接算法本身由 `tests/` 的命中样本覆盖。

### 未做 / 环境限制

- 录屏面板在 1180 CSS px 宽的视口（1.25 缩放窗口刚退出全屏的中间态）下，说明文案会横向溢出被裁；真实窗口尺寸下未复现同样的裁切，留待窗口尺寸稳定后复看。
- 托盘四个菜单项仍未逐项点击；长截图完整滚动仍未逐屏验收；`save_png` 的另存对话框要人点；Android 壳缺 JDK/SDK 未编译；`deploy/` 无 Docker 未真构建。

## v0.4 第十四批：全模块自检，修掉两处「看起来正常其实不通」的地方（2026-11-28）

### 修：录屏在远程会话 / 锁屏前态下直接报废

- 现象：点「开始录制」→ 界面进入 `REC · 00:06` → 点「结束录制」→ 提示「停止录制失败」，成片是 262 B 的空 MP4。
- 根因：`DxgiGrabber` 一张帧都吐不出来（`DXGI 还没拿到第一帧`），录制线程第一帧就在 `grab()?` 上返回 Err。远程会话 / 锁屏 / 显示器休眠时 `AcquireNextFrame` 常驻超时，这不是代码顺序问题。
- 修法：`FrameGrabber` 在 DXGI 建成功时**同时**备一台 BitBlt（`gdi_fallback`）。`grab()` 一旦读到「还没拿到第一帧」，立刻 `take()` 后备换成 `Backend::Gdi` 并锁死在这个后端，不再每帧白等一次超时。
- 真机验证：`--record-probe` 出片 `1920×1080 / 30fps / 90 帧 / 3.000s`，日志 `backend=gdi`，抽帧确认画面是真实桌面（QQ 通知都在）。

### 新增：录制前先确认「这一屏有内容」

- `win_capture::probe_recording_frame()`：整屏抓一帧（最多 12 次、每次 100ms，等屏幕切过全屏后合成器重绘），按 48×48 网格采样，全部同色就拒绝录制，回「整屏是一块纯色（多半是锁屏、远程会话断开或显示器休眠），先解锁屏幕再录」。
- `start_recording` 先跑这一步：与其让用户录完 10 秒才发现是一段纯色，不如点下去就讲清楚。
- 只按**整屏**判断、不看框选区域：框选正好落在纯色壁纸、或窗口刚退出全屏还没重绘，都是正常录制，按选区判会把它们误杀（第一版就是这么误杀的，真机复现后改掉）。

### 修：快捷浮窗在主线程同步建窗会自锁

- `open_quick()` 原来是同步命令，`WebviewWindowBuilder::build()` 在主线程等 WebView2 初始化 → 自锁，浮窗永远出不来，界面上表现为点了没反应、8 秒后前端超时。
- 现在 `open_quick` 是 `async fn`；`toggle_quick()`（热键 Ctrl+Alt+Q、托盘「快捷浮窗」）与 setup 里的 `--quick` 启动都改成 `tauri::async_runtime::spawn` 后台建窗。
- 真机验证：`invoke('open_quick')` 返回 ok（首建约 9 秒，低内存 + 远端会话下 WebView2 建窗慢），`/json` 里 1 秒内出现 `quick.html` target，`quick_action('snap')` 返回 ok。

### 新增：`tools/shell-selfcheck.mjs`——不点界面，把命令一条条过一遍

- 覆盖 `app_info`、`hotkey_status`、`displays`、`autostart_enabled`（含 `set_autostart(true/false)` 往返）、`capture_screen`、`capture_frame`、`capture_window`、`list_windows`、`write_shot`、`scroll_at`。
- 建窗类（`open_quick` / `pin_image`）单独跑：这类窗口顶到最前遮住主窗后，WebView2 会挂起主窗 JS，后续 invoke 全部超时——不是命令坏了，是一次只能验一项，所以拆成 `--windows=quick` / `--windows=pin`。
- `save_png` 自动跳过：它会弹系统「另存为」对话框占住主线程，落盘能力由 `write_shot` 证明（同一条写文件路径）。
- 本轮实测：core 9 项 + pin 全通过；`write_shot` 落盘 `C:\Users\35342\Pictures\Stillframe\selfcheck.png`；`scroll_at` 26ms 返回 Ok。

### 新增：`tools/sync-android-assets.ps1`——把前端产物整包同步进 Android assets

- `android/app/src/main/assets/www/` 是 gitignore 的，本机残留副本会随前端迭代悄悄过期（本轮发现里面还是 `index-DGw2NPIL.js` 那一版，且缺 `tessdata`、`tesseract`、`quick.html`——手机上等于没有离线取字）。
- 脚本先清空再整包拷贝，校验文件数一致，输出体积；`android/README.md` 的构建第 2 步改成调它。已同步 13 个文件 11.5 MB。
- `tools/shell-probe.mjs` 的 record flow 停止按钮正则从 `/停止/` 改成 `/结束录制|停止录制/`（实际文案是「结束录制」）。

### 验证

- 前端：`tsc --noEmit` 通过，`vitest run tests` 8 文件 64 条通过，`vite build` 通过。
- 网页端 E2E：6 条全绿（标注保存 → 图库、本地取字出中文、贴图、Ctrl+V 粘贴、五种模式切换、图库与设置往返）。
- 桌面壳真机（CDP）：`snap` 覆盖层 1920×1080 → 框 960×497 → 双击进标注台；`ocr` 走通并给出置信度/段落视图；`settings` 显示器小节在；`pin` 出 `pin.html` target；`quick` 修好后 1 秒出窗。
- 录屏：`--record-probe` 30fps 90 帧出片（`backend=gdi`）。

### 未做 / 环境限制

- 本轮物理屏处于 Windows 锁屏（`--capture-probe` 抓到整屏纯色），录屏的**界面全流程**没能在锁屏态走完；链路本身由 `--record-probe` 与抽帧验证。
- 长截图完整滚动、托盘菜单逐项点击仍需有桌面内容的环境；`save_png` 的另存为对话框要人点。
- 安装包（NSIS/MSI）、混合 DPI 双屏仍缺真机样本。

## v0.4 第十三批：覆盖层跟随鼠标屏 + 一次全模块真机自检（2026-11-28）

### 新增：框选时主窗铺满鼠标所在的那块屏

- `enter_overlay(display?)` / `exit_overlay()`：先记下窗口原来的位置与尺寸，再 `set_position` 到该屏原点并 `set_fullscreen(true)`；退出时按记录还原。原来的实现是「窗口内缩放视图」，副屏上按热键只会在主屏那一块里看到整屏缩略图。
- 前端 `CaptureWorkspace` 在延迟结束后进出覆盖层：`start()` 先 `enterOverlay()`（等一帧 rAF + 260ms 让视口尺寸更新），再按同一 display 抓帧；`confirmRegion`/`onCancel`/`finish`/异常分支都 `exitOverlay()`，不把用户窗口留在全屏。
- 设置页「桌面壳」panel 新增「显示器」小节：列 `#id 名称 · WxH · 主屏 · 原点`，并说明「在哪块屏按下就用哪块屏」。
- `--overlay-probe`：不开界面，直接跑一遍「进全屏 → 打印 outer 位置尺寸 → 退出 → 再打印」。

### 修：debug 构建白屏（构建链路的坑，不是界面代码）

- `desktop/Cargo.toml` 增加 `[features] custom-protocol = ["tauri/custom-protocol"]`。`cargo build` 不经过 tauri CLI 时，`build.devUrl` 仍指向 `http://127.0.0.1:24118`，没有 dev server 就整窗白屏——这就是截图里那块白板的成因。
- 构建脚本改为 `cargo build --features custom-protocol`，并在注释里写死「改前端后必须先 `npm run build`」。真机核对：窗口 URL 是 `http://tauri.localhost/`（嵌入资源），DOM、`__TAURI_INTERNALS__` 都在。

### 修：双击「快速完成」失效

- 双击的第二下 `pointerdown` 会先把拖框起点重置到双击处，选区瞬间变 0×0，等 `dblclick` 到达时 `rect` 已经不可用，于是「双击快速完成」怎么也收不了口（提示语与行为不一致）。
- 现在留一份「最近一次可用选区」快照：第二次按下（`detail >= 2`）且落在该块内就直接收口；`dblclick` 兜底时也用快照而不是当前 rect，空白处双击仍然不会吞掉整屏。

### 修：主键被 QQ 占满时自动换备用键位

- 真机日志里 `Ctrl+Alt+S/R/C/O/F` 五组**全被其他程序占用**（QQ 客户端常年占着这一套）。原来只弹一条「已被占用，请从模式卡进入」——热键等于没有。
- `shortcuts()` 每组模式给两档候选：主键 `Ctrl+Alt+X`，备用 `Ctrl+Shift+X`；注册循环按模式锁第一个能抢到的键，两档都抢不到才上报失败。
- 走备用键时广播 `stillframe://shortcut-remap`，界面顶部出现蓝色提示「主键被占，已自动改用备用键位：截图 Ctrl+Shift+S」，不再让用户对着主键按半天没反应。

### 新增：`tools/shell-probe.mjs`——用 CDP 接管真机窗口做验收

- WebView2 开 `--remote-debugging-port=9223` 后，Playwright 可以 `connectOverCDP` 连上真实桌面壳，用同一套选择器点按钮、量视口、读 DOM。肉眼验收变成可复现的脚本。
- 七条 flow：只读检查、`snap`（全屏→抓帧→拖框→双击→标注台）、`full`（整屏）、`ocr`（整屏离线识别）、`settings`（含显示器小节）、`quick`（快捷浮窗窗口）、`record`（框选录 4 秒出片）、`pin`（钉图窗口）。

### 验证

- 前端：`tsc --noEmit` 通过、`vitest run tests` 8 文件 64 条通过、`npm run build` 通过。
- 桌面壳：`cargo build --features custom-protocol` 通过（余 3 条历史警告）。
- 真机（单屏 1920×1080 @125%）：`snap` → 覆盖层视口 1920×1080、抓帧 `1920x1080`、拖框读数 `960 × 497`、双击进标注台后窗口回到 1180×780（覆盖层退出）；`full` 整屏进标注台；`ocr` 整屏识别出 16 段 560 字符（整屏含大量界面文字，置信度 43，框选小区域的精度仍以 OCR 基准为准）；`settings` 显示「显示器 · #65537 S2719DGF · 1920×1080 · 主屏 · 原点 (0, 0)」；`pin` 出现 `Stillframe Pin` 窗口（`http://tauri.localhost/pin.html`）；`quick` 出现 `quick.html` 窗口。
- `--overlay-probe`：`enter=Ok(...) fullscreen=true outer=(0,0) 1920x1080`，`exit` 后回到 1493×1022（约 1180×780 逻辑 @125%）。

### 未做

- 安装包（NSIS/MSI）仍等 bundler 联网；混合 DPI 双屏没有真机样本。
- 整屏 OCR 的版面质量一般（界面元素多），「框选后再识别」是正确用法，文档里再强调一次。

## v0.4 第十二批：多屏与混合 DPI——抓帧带几何、录制按虚拟桌面（2026-11-28）

### 新增：抓屏知道自己抓的是哪块屏

- `capture_frame`：选屏顺序「显式 display id → 鼠标所在屏 → 主屏」，返回 `{ dataUrl, display }`，`display` 带 id / 名称 / 原点（副屏在左时为负）/ 物理尺寸 / 缩放 / 是否主屏。`capture_screen` 保留原签名（只回图像），Android 桥与旧调用不用改。
- `displays`：列全部显示器，前端的诊断面板与后续「选屏截图」都靠它。
- 前端 `nativeCaptureFrame` / `nativeDisplays`：`CaptureSource` 新增 `origin`；长图与录屏会话**首帧按鼠标屏抓、之后钉住这个 display id**——轮询中途鼠标挪到别的屏，画面不再跟着跳。

### 修：录制与滚轮注入的坐标系

- `ScreenGrabber` 按虚拟桌面 clamp，`BitBlt` 源坐标减去虚拟桌面原点：以前 `x.max(0)` 把副屏的负坐标夹成 0，录出来是主屏左上角那块。
- `DxgiGrabber` 按选区起点遍历 `EnumOutputs` 匹配输出，用该输出的 `DesktopCoordinates` 算局部裁剪与 staging 纹理尺寸；以前恒用 `EnumOutputs(0)`（主输出），录副屏必错。
- `RecordRect.x/y` 改 `i32`（负坐标合法），`record_loop` 按虚拟桌面 clamp；非 Windows 路径仍只按主屏局部坐标裁，代码里注明了限制。
- 前端三处补原点：`RecordPanel` 的录制 rect、`ScrollPanel` 的遮挡判断（`shadowsCapture` 新增 `offset`）与滚轮注入点。

### 新增：两条自检入口

- `--displays-probe`：不开窗，把每块屏的 id / 名称 / 原点 / 尺寸 / 缩放 / 主屏标记写进 boot 日志。
- `--capture-probe=<png>`：不开窗，抓一张屏落盘，同时打印「显示器报告尺寸、虚拟桌面、实际图像像素」三者，高 DPI 与多屏偏移的回归全靠这一条。

### 验证

- `cargo build` 通过（余 3 条历史警告：`ScreenGrabber::width/height`、`DxgiGrabber::staging`、`recorder::crop_rgba`，均属预留/旧路径，不影响运行）。
- 本机（单屏 1920×1080）：`--displays-probe` → `count=1 origin=(0,0) size=1920x1080 primary=true`；`--capture-probe` → 报告 1920×1080、虚拟桌面 1920×1080、实图 1920×1080，三者一致，画面正常（非黑屏）。
- 录制回归：`--probe-rect=200,150,640,360` 5 秒 → 640×360 / 30fps / dxgi；`--probe-rect=-150,-120,640,360`（故意给负坐标）4 秒 → 正常出片，clamp 未崩。
- 前端 `tsc --noEmit`、`vitest run tests`（8 文件 64 条）、`npm run build` 通过。

### 未做

- 截图覆盖层仍是主窗内容区的缩放视图（窗口内看整屏），副屏上按快捷键不会把窗口挪到副屏全屏——下一批做「窗口跟随鼠标所在屏」。
- 混合 DPI（125%/150% 混排）只有坐标换算通路自洽（选区按 frame 物理像素 → 加屏原点），本机单屏无法真机复现，需双屏机器验收。
- 正式安装包（NSIS/MSI）仍等 bundler 联网下载。

## v0.4 第十一批：桌面壳专业化——托盘常驻、开机自启、版本关于、崩溃日志（2026-11-28）

### 新增：托盘常驻与「关窗不退出」

- 托盘图标带四项菜单：显示主窗口 / 截一张 / 快捷浮窗 / 退出 定格；左键点图标直接唤回主窗，右键出菜单。
- 关窗不再杀进程：主窗收起进托盘（截图、全局热键、录屏都要壳活着）。托盘没建起来的环境（无 shell、远程会话异常）就退回「关窗即退出」，不留幽灵进程。
- 托盘构建放到独立线程，并在外面套 `catch_unwind`：初始化卡住或崩掉只少一个入口，不会把主窗一起拖死（这条是踩出来的——把初始化放在 setup 里，某些会话会卡到窗口始终不出现）。

### 新增：设置面板「桌面壳」一节

- 版本号、当前 exe 路径、开机自启勾选、关窗收托盘说明；「关于」里的版本号改成读宿主真实版本（以前是写死 `0.1.0`）。
- 开机自启走 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`（值名 `Stillframe`，内容 `"<exe>" --quick`），开/关都不弹 UAC；勾选失败会把 checkbox 回读成真实状态并 toast，不装作成功。非 Windows 平台不显示这一项。
- `--autostart-probe=on|off`：不开窗、不起事件循环，直接读写一次自启并写日志，方便脚本验证。

### 新增：崩溃可见

- `run()` 开头装 panic hook：GUI 子系统没有控制台，之前 panic 是「窗口一闪就没了」且无迹可查；现在把「位置 + 信息」写进 `%LOCALAPPDATA%\Temp\stillframe-boot.log`。

### 修：单实例的写法把壳卡死

- 把 `Builder::build()` 与 `App::run()` 拆成两步调用时，Windows 上事件循环初始化会卡住——`setup` 一行都没执行，日志停在 `[boot] run start`，进程却活着。改回链式 `builder.run(context)` 后一切正常。现已按链式保留，并在启动链路上留了三段日志（`run start` / `setup begin` / `start_quick`）便于下次定位。

### 验证

- `cargo build` 通过；真机链路：启动 → 主窗可见（标题 `Stillframe / 定格`）→ 发 `WM_CLOSE` → 进程存活、窗口隐藏（日志 `[win] 已收进托盘`）→ 再次启动 exe → 第二个进程立即退出、原窗口恢复可见、只剩 1 个进程。
- 自启：`--autostart-probe=on` 后注册表出现 `"…stillframe-desktop.exe" --quick`，`now=true`；`--autostart-probe=off` 后值被删净，`now=false`。
- 前端 `tsc --noEmit`、`vitest`（8 文件 64 条）、`npm run build` 均通过。

### 未做

- 正式安装包（NSIS/MSI）：需要 bundler 下载 NSIS 与 WiX，本机网络风险高，留到 v1.0。
- 多屏 / 高 DPI 适配：当前按单屏主显示器坐标工作，混合 DPI 多屏下选区可能偏移。

## v0.4 第十批：浏览器插件 + 粘贴接图 + 隐藏窗口兜底 + 贴图上限可见（2026-11-28）

### 新增：浏览器插件（`extension/`）

- MV3 插件，零构建：点工具栏图标即 `captureVisibleTab` 截当前标签页可视区；预览图上按住拖框只留一块（不足 8px 算误触、自动回整张）；三个出口——写剪贴板、交给浏览器下载（文件名 `stillframe-年月日-时分秒.png`）、送进编辑台。
- 「送编辑台」的做法是**先把图放进剪贴板再打开网页版**，到页面按 `Ctrl+V` 就接上；页面地址可在插件底部改，默认线上 Pages。剪贴板写失败时明确提示改走「存 PNG + 打开图片」。
- 只申请 `activeTab`、`storage`、`clipboardWrite`，不碰站点数据；不做「全页长截图」——滚动拼接碰上吸顶导航与懒加载会错位，这条留给桌面壳的自动滚动。

### 新增：页面内 `Ctrl+V` 接图

- `CaptureWorkspace` 监听 `paste`：剪贴板里是图片就按当前模式进标注台 / 取字 / 译屏；是文字则不动，不抢文本框自己的粘贴。插件、QQ / 微信截图、聊天窗口里复制的图都能直接落进来。

### 新增：桌面壳单实例

- Windows 启动时先建命名互斥体；已有实例在跑就找到主窗（`Stillframe / 定格`）`ShowWindow(SW_RESTORE)` + 置前，然后自己退出。不再出现「双击两次删两次图标」的两份程序各抢一份全局热键。

### 已落地

- **隐藏窗口的三段式兜底（G9）**：以前 `grabWithoutSelf` 把 `hide_self` 放在 try 之外，hide 一抛错就直接跳走——既不抓屏，也不恢复窗口，用户会以为程序没了。现在拆成三段：hide 失败只警告并照抓（画面里可能带着本窗口）；抓屏成功与否都在 `finally` 里把窗口亮回来，`show_self` 失败重试一次，仍失败就明确提示「点任务栏里的 Stillframe」；另加 5 秒看门狗，抓屏若卡住（DXGI 无响应）也会强制亮回窗口。
- **Rust 侧恢复容错**：`show_self` 不再让 `set_focus` 失败把整条命令判成失败（那会让前端误以为窗口还藏着又去重试，窗口闪一下）；show 成功后顺手 `unminimize`（隐藏前若已被最小化，show 出来仍是收起的），聚焦失败只写日志。`hide_self` 的错误文案改成「隐藏窗口失败：<原因>」。
- **贴图上限提前可见（G4）**：钉到 20 张时，工具栏「钉在桌面上」直接置灰，title 换成 QQ 原文「已达到截图窗口上限，请先关闭多余窗口」——不再等点了才被拒。截图编辑台通过 `pinCount` 拿到当前张数，App 每次贴图成功即刷新。

### 验证

- `cargo build`（desktop）通过；`--record-probe` 抓帧回归 `frames=180 / seconds=6 / dropped=0 / dxgi+h264_qsv`；单测 64 条、`tsc --noEmit`、`npm run build`、E2E 6 条（新增「粘贴链路」）全绿。
- 未验：隐藏/恢复的真实时序（本机 GUI 会话两个桌面截到同一物理屏，无法做真机窗口时序验收），已按「代码 + 编译 + 同路径回归」记录，真机项保留在 UPGRADE-PLAN 的待办里。

## v0.4 第九批：本地图片入口 + 三条主链路 E2E（2026-11-27）

### 已落地

- **打开本地图片**：网页端此前只有「开始捕捉」（要屏幕共享授权）能进编辑台，已有的 PNG/JPEG 完全没有入口。现在待机页多一个「打开图片」按钮，也支持把图片直接拖进窗口（拖动时有整窗提示条）；按当前模式进标注台 / 取字 / 译屏，标注台以整图为初始选区。用 `createImageBitmap` 解码，不依赖 DOM 挂载，顺带处理 EXIF 方向；同一次选同一张图会清空 input，不会失灵。
- **Playwright 三条主链路**（`e2e/flows.spec.ts`，输入直接复用 OCR 基准里的中文版面图）：截图 → 标注 → 保存（等 `download` 事件确认成品真的交出来）→ 图库留档；取字 → 本地识别出中文；贴图 → 成图钉到桌面。加上原有两条冒烟用例，E2E 共 5 条，headless 全绿（16.8 秒）。

### 由 E2E 暴露并修掉的三处真实缺陷

1. **语言包目录探测顺序反了**：默认 `tessdataPath` 指向 `tessdata.projectnaptha.com`，弱网/内网下每轮识别先为一个外网 HEAD 白等半分钟。现在站点自带的 `./tessdata` 排第一（同源、一定最快），用户配置次之，CDN 兜底；每次探测都带 3 秒超时。设置项默认值改为留空 = 用内置包，输入框提示同步改写。
2. **`.gz` 被服务器解压过一层，再解一次就崩**：vite dev/preview 会对 `.gz` 发 `Content-Encoding: gzip`，浏览器替我们解压过，`DecompressionStream` 再解就抛错（对外只表现为 `TypeError: Failed to fetch`）。改为按 gzip magic（`1F 8B`）判断要不要解，两种服务器行为都能用。
3. **tesseract 默认用 blob worker**：`workerBlobURL` 默认 true 时脚本被包进 blob 再 `importScripts`，来源被判跨域，内网部署直接起不来（错误同样只是 `Failed to fetch`）。改为直连同源 `worker.min.js`。

顺带：`playwright.config.ts` 的 webServer 超时放宽到 180 秒（Windows 上 npm 起 preview 偶发要等一分多钟）；PinCard 加 `data-testid="pin-card"` 供 E2E 断言；取字失败时把原始错误打到控制台（页面仍只显示一句话）。

## v0.4 贴近系统截图的体验补齐（2026-11-26）

### 已落地

- **快捷浮窗**：桌面壳新增 `quick.html` 无边框置顶动作条（截图 / 长图 / 录屏 / 取字 / 译屏 / 主窗 / 收起，左侧拖动把手）。窗口 520×84、贴主屏底部居中、不进任务栏；`--quick` 参数可开机只起浮窗。真机验证：窗口标题 `Stillframe 快捷浮窗`、可见、PrintWindow 截图渲染正常。
- **全局热键接通**：此前 Rust 用 `stillframe://shortcut` 广播，前端没有监听，热键等于没接。现在 `App` 通过 `onHostEvent`（Tauri event 插件 + `transformCallback`，不引入 `@tauri-apps/api`）订阅热键与浮窗事件，切模式后直接进入捕捉，不需要再点「开始捕捉」。新增 Ctrl+Alt+Q 呼出/收起浮窗。
- **延时截图**：截图 / 取字 / 译屏三模式可选「立即 / 3s / 5s」，桌面壳倒计时结束后先收起自身窗口再抓帧，抓完亮回，避免把自己拍进画面；倒计时可取消。
- **取字即出结果**：进入取字面板自动跑一次识别，不再要求手动点「识别」；失败时保留可操作提示（语言包首次下载、离线走内网目录）并提供重试；新增「复制并收起」。
- **语言包回落顺序**：站点自带 `./tessdata`（内网/离线镜像）→ 用户配置 → 官方 CDN，用一次带 3 秒超时的 HEAD 探测选择，兼容实训室无外网环境（第九批把内置包提到最前）。

### 第二批：窗口截图与取字直达译屏

- **窗口截图**：Rust 新增 `capture_window(id)`，按 `list_windows` 返回的真实窗口 id 抓整窗（含被遮挡部分），最小化时明确报错而不是给黑图；前端捕捉台待机页多了「窗口截图」行：下拉列出真实窗口、「截这个窗口」、「刷新」。真机验收：选中豆包窗口后点「截这个窗口」，1920×1030 画面完整进入标注台，可继续框选、保存、取字。
- **取字直达译屏**：取字面板新增「译屏 · 把这张图转成译文」，识别完直接带着图进翻译面板，不用退回主界面重来。
- **待机页布局收敛**：要点卡改弹性换行、容器收窄到 840，窄窗下不再横向溢出。
- 顺带修了验收方法上的一个坑：PrintWindow 截图前必须先做 DPI 感知（`SetProcessDpiAwareness`），否则 125% 缩放下拿到的是被裁过的逻辑尺寸位图，会误判成界面溢出。

### 第三批：取字全链路离线化

- **识别引擎随站点分发**：`public/tesseract/` 内置 worker 脚本与 SIMD / 非 SIMD 两档 LSTM WASM 核心（WASM 以 base64 内嵌，单文件自足），`ocr.ts` 显式指定 `workerPath` / `corePath`，不再从 jsdelivr 拉引擎，内网断网也能完整取字。
- **语言包切 fast 版并内置**：默认从 4.0.0（best，中文包 20MB）切到 4.0.0_fast（中文包 1.73MB、英文 1.98MB），`public/tessdata/` 与桌面壳 `desktop/tessdata/` 双端打包；Rust `read_tessdata` 按 base64 读取内置 gz，桌面壳取字零网络。
- **预取 + 缓存预热**：主线程预取 gz → `DecompressionStream` 流式解压 → 写入 tesseract 的 IndexedDB 缓存（idb-keyval 默认 store），Worker 启动直接命中；相对路径统一按绝对 URL 解析，修掉 Worker 内相对路径指错目录的坑。
- **识别图降采样**：新增 `toOcrBlob`，超尺寸画布先压到最长边 2400px 再出 PNG，降低识别开销并规避大画布结构化克隆在 WebView 卡住；1080p/1440p 屏的整窗截图不再降采样，小字号中文不被压糊（同一张 1938×1048 真图：1600px 置信度 65，原生 2400 上限 75）。
- **小图放大识别**：长边不足 1200 的框选区（多为几百像素宽、12px 级字号）放大 2 倍再喂引擎；实测同一块 390×116 区域，「日常」不会再被读成「日党」，置信度 82 → 89。
- **结果结构与段落归并**：可编辑区改为保留识别原始行结构（复制出去能对行，贴合 QQ 提取文字的行为）；「段落视图」才做归并，且左边界跨列时强制断段，修掉多栏截图被串成一两句长文的问题（整窗 200+ 行不再只剩「2 段」）。新增 `tests/ocr-paragraphs.test.ts` 4 条用例。
- **选区工具条点击失效**：工具条原本挂在框选根节点内，点「完成」会先被根节点的 `pointerdown` 当成新选区起点，把已有选区重置成 0×0 导致 `commit` 判不可用、按钮像坏了一样。现让工具条自己吃掉 pointer 事件；空白处双击也不再直接吞整屏。
- **真机验收（Windows + WebView2）**：整窗取字 1938×1048 → 2041 字符 / 7 段 / 置信度 75；框选 391×116 → 置信度 92、文字逐字正确（「打一句，比如：课表在哪」）。全程零网络请求，语言包走 `read_tessdata` + IDB 缓存。
- 补站点 favicon（取景框 SVG），三个 HTML 入口统一引用，消除 favicon 404。

### 实训室部署

- 新增 `deploy/`：多阶段 `Dockerfile`（node 构建 + nginx 托管 + 语言包内置）、`docker-compose.yml`（健康检查、只读根文件系统、日志上限）、`prewarm.ps1` / `prewarm.sh`（等健康检查 → 解析真实 assets → 连跑多轮首页/浮窗页/语言包）。
- 镜像与 compose 的语言包源同步切到 4.0.0_fast，与前端内置版本一致。
- **未验证**：本机未装 Docker，镜像构建与容器健康检查没有真机跑过；预热脚本的 HTTP 逻辑可用任意静态服务器验证。

### 第四批：让失败可见、让长图不拍到自己

- **热键注册失败不再静默**：`shortcuts()` 同时返回键位文案，注册失败时向界面广播 `stillframe://shortcut-failed`（`模式|键位`）；界面顶部出现一条可关闭提示，点名「以下快捷键已被其他程序占用：截图 Ctrl+Alt+S」并指向模式卡与快捷浮窗这两个替代入口。Ctrl+Alt+Q 的失败走同一套上报。原先只写一行 `eprintln`，而 GUI 子系统没有控制台，用户按不出反应也无从得知。
- **热键占用改成「先探测再注册」**：真机上验一次就露出问题——Ctrl+Alt+S 被别的工具占用（`RegisterHotKey` 返回 1409 `ERROR_HOTKEY_ALREADY_REGISTERED`）时，`tauri-plugin-global-shortcut` 的 `on_shortcut` 仍返回 `Ok`，失败被插件吞掉，上面那条基于 `Err` 的上报根本不会触发。现在注册前先用 `RegisterHotKey` 自探一次（成功立刻 `UnregisterHotKey`），探不到就直接记账、广播事件并跳过硬注册；Ctrl+Alt+Q 同套。真机验证：另一进程占住 Ctrl+Alt+S 后重启壳，日志出现 `[hotkey] Ctrl+Alt+S -> snap 已被其他程序占用`。
- **长图自动滚动不再把自己拼进画面**：新增命令 `self_rect`（自身窗口的屏幕矩形，物理像素）。滚动前用 `shadowsCapture` 判断自身窗口是否压住选区（重叠宽高都需超过 8px，贴边蹭到不算），确实遮挡才隐藏自身、结束后恢复；判定为纯函数，补了两条单测（含 margin 放宽）。
- **隐藏期间的结果不再丢**：滚动结论（到底 / 需手动重叠 / 失败）先记账，等窗口恢复后再弹 toast，避免在窗口藏起来的几秒里弹一条用户看不见的提示。
- **文档对齐现实**：README 原先写着「自动滚动尚未实现」「desktop 未编译验证」，实际都已跑通；改为如实描述，并把路线图的长截图条目勾掉、录制单列。新增 [docs/SMART-CAPTURE.md](docs/SMART-CAPTURE.md)，给出「智慧截图」的四层定义与可测口径。

### 第五批：识别之后先说清楚「这是什么」

- **内容判读**：新增 `src/lib/intent.ts`，按行结构、语言占比、缩进形态判出 `正文 / 代码 / 表格 / 清单` 与 `中文 / 英文 / 中英混排 / 数字为主`；英文正文才预选翻译，代码一律不推翻译，字数太少直接不给建议。
- **建议不夺权**：取字面板结果区多一行「检测到 中文正文 · 4 行 · 32 字符」+「按建议复制文字」，只高亮不自动执行；判读随可编辑区的改动实时重算，判错改一个字就跟着变。
- **可解释**：判据不是黑箱——代码靠特征记号与缩进，表格靠「多数行能按两个以上空格切成同样列数」，清单靠行首符号，都能在界面上用一句话讲清，并写进 `docs/SMART-CAPTURE.md` 的 L2 一节。
- **单测**：`tests/intent.test.ts` 8 条（太短不猜、中文正文、英文翻译、代码、英文代码不翻译、表格列数、清单、纯数字），全套 37 条通过。

## v0.3 第三批：录制真机达标，抓帧换 DXGI（2026-11-27）

上一批把录制接到 FFmpeg 之后，真机只跑到 3.9fps——「接对了」和「跑得动」是两件事。这一批把每一层都量了一遍，逐层换掉：

- **`xcap` 不能再当录制抓帧源**：`Monitor::capture_image()` 每帧约 256ms（60 秒只有 236 帧，3.9fps）。它的封装每帧重建 DC、再做整帧格式转换，成本花在封装不在硬件。
- **自建 `BitBlt` 抓帧器**（`desktop/src/win_capture.rs`）：`CreateDIBSection` 一次建好 top-down 32 位 DIB，每帧只 `BitBlt`，像素直接在 DIB 内存里，省掉整帧拷贝；按选区取源，不用抓完再裁。实测提到 25.1fps，但单帧 38ms 且随会话负载漂到 40–56ms，仍达不到 30。
- **换 DXGI Desktop Duplication**：直接从桌面合成器取帧，`CopyResource` 到 staging 纹理再 `Map` 读回，抓帧降到 **6–9ms**。静态画面时 Duplication 不给新帧，就沿用上一帧顶住时间轴。
- **编码让给核显**：libx264 在真实桌面画面下写入阻塞 28ms（帧率掉回 15.4fps）。现在先真编 5 帧探测 `h264_qsv` 是否可用（列表里有不代表驱动能用），可用就用核显编码，写入降到 1.4–3.2ms，CPU 全留给抓帧；不可用回退 libx264 `ultrafast`。
- **时长不再被快放**：此前按固定 `-r` 解释每帧，抓帧慢于目标帧率时 60 秒会录成 47 秒。现在落后节拍就重复当前帧补齐时间轴，收尾再按实际秒数 `pad_to`，成片时长精确对上。
- **补上 1ms 定时器精度**：Windows 默认定时器粒度 15.6ms，`sleep(33ms)` 会被拉成 46ms，帧率天然卡在 20 出头；录制期间 `timeBeginPeriod(1)`，结束恢复。
- **真机达标数据**（`--record-probe` 跑满，ffprobe 核对）：1080p×60 秒 → 1800 帧 / `duration=60.000000` / 29.0fps / 丢帧 0.44%；复测 27.9fps / 0.72%；720p×40 秒 → 1200 帧 / `duration=40.000000` / 28.1fps / 0.75%。三轮均值 28.3fps、丢帧均 <1%，达到蓝图「≥28fps、丢帧 <2%」。抽帧核对画面为真实桌面，非黑屏。
- **可诊断**：结束统计新增 `grab_avg_ms`（抓帧耗时）、`write_avg_ms`（写入耗时）、`repeats`（补帧数）、`backend`（如 `dxgi+h264_qsv`），一眼看出瓶颈在抓帧还是编码、走的是哪条回退路径。
- **无 GUI 标定入口**：`stillframe-desktop.exe --record-probe=<路径>:<秒数> [--probe-rect=x,y,w,h]`，不弹窗、不进 Tauri，跑完把结果写到 `<路径>.log`，退出码 0/1。

## v0.3 第四批：录屏有声音了（2026-11-27）

画面这一格达标之后，接着补「声音」——这是 QQ 录屏条上麦克风按钮对应的那一格。

- **麦克风接进来，但不接进编码器**：另起一个 FFmpeg 进程录 `48kHz / 单声道 / WAV`，停录时发 `q` 让它正常收尾，视频编完再用两段有限文件封装（`-c:v copy -c:a aac -b:a 128k -movflags +faststart`）。之所以绕这一步：dshow 是无限实时流，把它当编码器的第二个输入后，视频 stdin 已 EOF、FFmpeg 仍在等音频，`-shortest` 也不生效——实测停录后进程不退出，界面会卡死（第一版 `sf-mic2` 就是这么挂住的）。
- **音画起点自动校准**：WAV 是 48kHz/16 位，按文件字节数就能算出它录了多久；比画面多出来的那段用 `-ss` 裁掉，尾部再 `-shortest` 追齐。实测 1080p×30 秒：成片 29.933 秒、音频 29.999 秒，差 66ms；15 秒样本差 32ms，均落在蓝图「<100ms」内。
- **等麦克风真的开始落盘再抓帧**：dshow 打开设备要 1 秒上下，原来固定 `sleep(900ms)` 靠不住（实测差 1.35 秒，音轨比画面短一截）。改为轮询 WAV 文件出现即启抓帧，上限 3 秒，设备打不开就退回纯画面。
- **麦克风默认关**：录进别人的声音不是小事，只有用户在录屏条上点了麦克风才采（`start_recording` 的 `mic` 参数默认 `false`）。前端 `nativeStartRecording` 透传 `voiceOn`，桌面壳里点麦克风不再走 `getUserMedia` 授权（真正采声的是 Rust 的 dshow），设备不可用会静默退回无声，结果条 `backend` 里的 `+mic` 就是是否采到。
- **顺手修掉三个时长问题**：
  - 统计秒数原先在补帧、等 FFmpeg 收尾之后才取，20 秒被记成 43 秒 → 录制线程停下即 `mark_end()` 钉住结束时刻，补帧和收尾不再计入。
  - 补帧用「节拍累加器」（`next += interval`）会补超前，15 秒录出 466 帧、成片变长 3% → 改为「已跑秒数 × 帧率」绝对对账，目标帧数不再累积漂移。
  - `sleep(3ms)` 在 Windows 上常常只睡 1–2ms，每帧欠一点、帧率就抬到 31 → 剩 2ms 以内改为忙等到点。
  - 补帧用的时长要在停麦克风之前取：`mark_end` 里等音频退出最多半秒，算进去会多补十几帧。
- **复验数据**：无麦克风 1280×720×60 秒 → 1800 帧 / `duration=60.000000` / 29.8fps / 丢帧 0；带麦克风 1920×1080×30 秒 → 900 帧 / 29.933 秒 / 29.5fps / 音频 aac 29.999 秒；带麦克风 15 秒 → 450 帧 / 14.967 秒 / 29.0fps。`--probe-audio` 是标定开关。
- **系统声还没接**：本机 `ffmpeg -f dshow` 只有麦克风阵列，没有立体声混音端点，得走 WASAPI 环回——见下一批。

## v0.3 第五批：系统声也来了（WASAPI 环回）（2026-11-27）

麦克风那格做完，录屏条上另一个声音开关是「系统声音」——录课件视频、录别人共享的网页，要的是扬声器里正在放的声音。

- **FFmpeg 这条路走不通，就先确认到底哪不通**：`ffmpeg -hide_banner -devices` 只有 `dshow` 与 `openal`，`-f wasapi` 直接报 `Unknown input format`；`-f dshow -list_devices` 只有「Integrated Camera」与「麦克风阵列」，**没有立体声混音**。所以不是配置问题，是官方构建根本没这能力。
- **自写 `desktop/src/win_audio.rs` 走 WASAPI 环回**：`MMDeviceEnumerator` → 默认渲染端点（`eRender/eConsole`）→ `IAudioClient` → `GetMixFormat()` 拿真实混音格式（44.1k/48k、立体声、32 位浮点，都按头里的字段来，不写死）→ `Initialize(AUDCLNT_STREAMFLAGS_LOOPBACK)` → `IAudioCaptureClient` 每 10ms 读一次包，混成单声道 16 位写 WAV；停止时 `Stop()` 并回填 RIFF / data 长度，文件才自洽可读。
- **零拷贝降混**：混音格式基本是 32 位浮点，直接按 `f32` 切片多声道取平均（比只取第一声道更接近听感），`AUDCLNT_BUFFERFLAGS_SILENT` 的包标记为静音写零，不误当真实数据。
- **接口失败就退回**：`start()` 用 mpsc 等初始化结果（8 秒超时），设备打不开（无默认播放设备 / 客户端拒绝）立即返回错误，录制静默退回纯画面，`backend` 里没有 `+sys` 就是没采到。句柄带 `Drop` 兜底，异常路径也会 `Stop()`。
- **两路音源可同时**：`EncoderSpec` 加 `system_audio`，收尾时把 0/1/2 条音轨收一起——1 条直接 `-map 1:a:0`；2 条用 `-filter_complex "[1:a][2:a]amix=inputs=2:duration=longest[a]"` 合成一条 AAC。每条音轨都按自己的 WAV 头算时长、裁掉比画面多出的头，尾部 `-shortest` 追齐。封装失败只留日志，不废掉画面（MP4 本身完整可播）。
- **空数据不留痕**：WAV 不足 2KB（只有 44 字节头、环回一个包都没出）就删掉，不给成片塞空音轨，也不在录制目录留 0 字节文件。
- **真机验收**：
  - 720p×20 秒 + 系统声，同时 `ffplay` 放 440Hz 正弦 → `backend=dxgi+h264_qsv+sys`，600 帧 / 20.01 秒 / 28.8fps，成片音轨 aac 19.816 秒、`mean_volume -5.0 dB`（确实采到了声音，不是静音）。
  - 麦克风 + 系统声同时开 → `backend=dxgi+h264_qsv+mic+sys`，450 帧 / **15.000000 秒** / 29.1fps，成片单条 AAC 15.000 秒 705 帧，`mean_volume -10.2 dB`。
  - 系统声开关打开但设备**全程没出声** → 成片没有音轨（环回不产出包，按上面的规则删掉），画面 `duration=10.000000`、300 帧不受影响。
- **接线**：`start_recording(rect, fps, ffmpeg, mic, system)`；前端 `nativeStartRecording(rect, fps, mic, system)` 透传 `soundOn`；桌面壳里系统声按钮直接 toggle（不再提示「等下一批」），开始录制时 toast 点名采了哪几路（「采麦克风 + 系统声」）；`--probe-system` 是新的标定开关，可与 `--probe-audio` 叠加。
- **顺手把日志收口**：`log_line` 从 `lib.rs` 挪进 `recorder.rs` 并改为读 `LOCALAPPDATA`，这样 `tools/recorder-check` 单独编译这份代码时不再因找不到 crate 根函数失败（原先是 `crate::log_line`）。

## v0.4 第六批：标注手感对齐 QQ（2026-11-27）

对照 QQ 截图/录屏的标注面板（蓝图 G5「Alt 吸附直线、Shift 等比、文字样式、重做栈」），把缺的补上：

- **`Shift` 等比**：拖动矩形 / 椭圆 / 荧光 / 马赛克时按住 `Shift` 一律约束成正方形（分别得到方块、正圆、方形荧光、方形马赛克）。实现直接复用选框那套 `resolveSelection(..., { shift: true })`，选区和画标注是同一种手感，不再写第二份逻辑。
- **`Alt` 吸附直线**：画箭头时按住 `Alt` 把线段吸到最近的 0° / 45° / 90° 方向，长度保持不变——画垂直指向线不用再靠手稳。
- **录屏条同步**：`RecordPanel` 的矩形 / 椭圆 / 箭头也接上同样两个修饰键，录着的时候随手画方块和直箭头一致。
- **文字行距可调**：`Annotation` 的 text 分支加了可选 `lineHeight`（按字号倍数，默认 1.28），多行文字不再只能吃固定行高；调紧到 1.0 也不叠字。
- **重做栈本来就是齐的**：`Editor` 的 `canRedo / onRedo` 已有按钮与 `Ctrl+Shift+Z` / `Ctrl+Y` 两条快捷键，这一条核对后确认无需改。
- **清理过期说明**：README 原先写着「选框的 Alt 直线吸附未做」，实际 `SelectionOverlay` 早已接了修饰键；改为如实说明「修饰键只在按住时生效，不做粘滞」和「标注还不能拖拽微调」这两条真实边界。
- 单测：`tests/annotate.test.ts` 6 条（正向/反向等比、水平/垂直/45° 吸附、几乎没动不闪），全套 43 条通过；`npx tsc --noEmit` 零错误。

## v0.4 第八批：多栏切栏 + 段落还原率量化（2026-11-27）

上一批留了一句「段落还原率还没对真图量化」。这一批把那句话兑现，并且顺手修掉了量化过程中暴露的真问题：双栏截图的左右两栏会被 tesseract 拼成一行。

- **量化基准 `tools/ocr-bench/`**：`make-pages.py` 用 PIL 画七张版面（中文正文 / 中英混排 / 清单+代码 / 双栏窄栏距 / 双栏宽栏距 / 13px 小字号 / 深色反相），真值段落与图一起写死在仓库里，谁跑都是同一组输入。`bench.mjs` 走**和网页端同一条管线**：按 `toOcrBlob` 规则先缩放（长边 <1200 放大 2 倍），再在 900 宽缩略图上找栏、逐栏识别、合并坐标、聚段，最后对齐真值算分。
- **指标不是一个数**：`recall`（每段真值有多少字被完整归进某一段，漏字错字切碎都掉分）+ `purity`（每个 OCR 段有多纯，两段被并成一段时 recall 满分而 purity 掉——只看 recall 会自欺）+ 整段正确数。两条都过 85% 才算过。
- **第一次跑就发现两处真问题**：① 段距 34px 时，上一段若恰好满行，两段之间只剩不到 1.4 倍行高的间隙，被并成一段——把断段阈值从 1.4 收到 1.25 倍、段首缩进信号从 2.2 收到 1.8 倍；② 双栏页纯度只有 85.1%，查下来是 tesseract 在**行级**就把左右两栏拼成了一条 line（`机柜重新整理…图纸上。 = - 上行端口 24个`），行以下再怎么聚段都救不回来。
- **新增 `src/lib/columns.ts`**：按像素找栏——逐列统计「有墨的行占比」，整列几乎没墨且宽度 ≥ 图像 4% 就是切口；只认内部切口（页边距不切）、每栏宽度 ≥ 18%、最多 3 栏，否则回退整图。`recognize()` 里若切出多栏，就逐栏裁切（左右各留 2px，留多了引擎又会拼回去）分别识别，再把行坐标按栏偏移拼回。检测跑在 900 宽缩略图上，整图取像素太重（2000×1500 就是 12MB）。
- **聚段补一个分列前置**：`splitColumns()` 按左边界聚类，并要求两列在纵向跨度重叠过半才算「并排」——只按 x0 分列会把「居中标题 + 左对齐正文」拆成两列，标题反而排到正文后面去。
- **结果（`npm run ocr-bench` 实跑，report.json 在仓库里）**：总体还原率 **99.6%**、段落纯度 **99.5%**、整段正确 **30/30**，七页全部过线。双栏页从「纯度 85.1% / 3 段」变成「纯度 100% / 4 段」，其余五页均未被误切（`栏=1`）。
- **单测**：新增 `tests/columns.test.ts` 4 条（两栏切开、满宽不切、页边距不切、窄缝隙不当栏）+ `tests/ocr-paragraphs.test.ts` 2 条（并排双栏各归各段、居中标题不跑尾），全套 **64 条**通过；`tsc --noEmit` 零错误、`npm run build` 通过。
- **如实标注**：七页都是合成图，字号统一、无 JPEG 噪声、无缩放糊字，只能说明「管线本身」分得对；带噪声的真实截图样本还没进基准。栏间没有可见竖向空白的版面（只靠一条细线或底色区分侧边栏）切不开，这类版面仍会串行。

## v0.4 第七批：取字结果能导出 Markdown（2026-11-27）

取字取完，文字躺在面板里，用户还得自己整理成能粘进文档的样子。蓝图 G7 里「可转为在线文档」这一格，落成一个离线的 Markdown 导出——开源工具不该绑死哪家在线文档。

- **新增 `src/lib/markdown.ts`**：`paragraphsToMarkdown()` 把段落数组转成 Markdown——清单段落（过半行带 `-` / `•` / `1.` / `①` 之类）统一成 `- ` 列表并剥掉原符号；代码段落（有 `{ } ;`、`=>`、HTML 标签或 `def/const/function` 开头）包进代码块；正文段落之间空一行，段内换行保留成两空格断行。不给表格硬猜列分隔符——识别结果里没有，猜错比不猜更糟，所以表格按行保真输出。
- **围栏加长防提前闭合**：正文里自带 ```` ` 时用四反引号包，不会被自己的示例代码截断。
- **面板入口**：取字面板「复制 / 存图库」下面新增「导出 Markdown」，按**当前视图**导出（段落视图用聚好的段落，行视图保持逐行结构），文件名走已有的 `timestampName('取字','md')`，末尾带一行「本地识别 · stillframe」。
- **单测**：`tests/markdown.test.ts` 12 条（项目符号识别与剥离、代码记号命中、正文不误判、段落 / 清单 / 代码 / 标题页脚 / 空段处理、反引号加长），全套 58 条通过；`tsc --noEmit` 零错误、`npm run build` 通过。
- **如实标注未做**：段落还原率还没对着真图量化（现有证据是取字验收图 7 段 / 2041 字符的定性观察）；导出按钮也没做界面点击验证，只验了转换函数与构建。

## v0.3 第六批：录屏标注进成片（2026-11-27）

录屏条上画的箭头、方框、文字在 QQ 里是会跟着录像进成片的；此前桌面壳只有画面，标注只在网页端（画在 canvas 流里）成立。这一批把桌面这条链闭合。

- **新增 `desktop/src/win_annot.rs`（约 350 行）**：离屏画布 = 一块 32 位 top-down `CreateDIBSection` + 一个 `CreateCompatibleDC`。抓帧器交出来的本来就是 BGRA，直接 `memcpy` 进去就能画、能交给编码器，不需要再做一次格式转换。
- **GDI 绘制取舍**：矩形 / 椭圆用 `Polyline` 手写多段折线（矩形 5 点闭合、椭圆 48 边形），避开 `HOLLOW_BRUSH` 那套状态；箭头 = 线 + `CreateSolidBrush` 填充三角；文字用 `CreateFontW("Microsoft YaHei UI")` + `SetBkMode(TRANSPARENT)` + `TextOutW`，行距 1.28；激光是随时间收缩的红点（1.2 秒残影，1.5 秒后清点）。字体句柄按字号缓存，只在字号变化时重建。
- **零成本跳过**：`Layer::has_activity` 先看有没有已出现且未撤销的标注、有没有 1.2 秒内的激光点；一条都没有就完全不碰 DIB，直接用抓帧原始缓冲喂编码器。
- **坐标与时间统一归一化**：前端把画布坐标、线宽、字号全部按选区宽高归一（`0..1`），桌面壳按帧尺寸乘回来——DPI 缩放、非整数缩放都不用在两个模块之间来回约定；`atMs` 以开始录制那一刻为原点，标注落定即推、边录边推，不用等录完再合成。
- **撤销 / 清除同步**：新增命令 `undo_record_annotation` / `clear_record_annotation`。画布上撤一条，成片后面的帧就不再画它（已录进去的帧保持原样，录像不能倒着改）。
- **新命令**：`push_record_annotation(annotation)`、`push_record_laser(x, y, atMs)`；`start_recording` 前清空上一段的标注，避免笔迹串段；标注上限 256 条，超了丢最老的，长时间录制不会无限吃内存。
- **前端**：`toNativeAnnotation()` 抽到 `src/lib/annotate.ts`（纯函数，可测）；`RecordPanel` 在标注落定、文字回车时推一条，激光按下 / 拖动按 40ms 节流推送，`nativeClockRef` 记开始录制的时刻；撤销 / 清除按钮同时通知桌面壳。
- **新标定入口**：`--probe-annot=<json>`，可预置一组归一化标注数组，和 `--probe-audio` / `--probe-system` 叠加。
- **真机验收**：1280×720 × 12 秒（`ffplay` 全屏黑底，保证 DXGI 有帧）预置 5 条标注（1s 方框 / 2s 椭圆 / 3s 箭头 / 4s 画笔 / 5s 中文文字）→ `frames=360 seconds=12 dropped=0 fps=25.1 write_avg_ms=3.8`；抽 2s / 4s / 6s 三帧核对：2s 只有方框+椭圆、4s 已有四条、6s 五条齐全，中文「标注进成片」逐字正确。
- **开销对照**：同条件无标注 `write_avg_ms=2.3`，带标注 `3.8`——每帧约多 1.5ms（含 3.6MB memcpy 与 5 条 GDI 绘制），离 33ms 预算仍很远。
- **已知边界**：GDI 无抗锯齿，斜线 / 椭圆比 QQ 的 Direct2D 略硬；标注不能在画布上再选中拖拽微调。两条都写进 README「已知限制」。
- 单测：`tests/annotate.test.ts` 加 3 条（矩形归一化、画笔逐点 + 字号归一化、选区为 0 不产生 Inf/NaN），全套 46 条通过；`tsc --noEmit` 零错误；`tools/recorder-check` 回归 `CHECK_EXIT=0`。

## v0.3 第二批：桌面录制改走原生 30 帧管线（2026-11-27）

- **换掉那条跑不动的路**：桌面壳里录屏原本是「`capture_screen` 每 320ms 轮询一次 → 画进 canvas → `canvas.captureStream` → MediaRecorder」，实测个位数帧率、只能出 WebM，撑不起「可交付录像」（蓝图 G2 / 5.2）。现在桌面壳点开始录制，直接交给 Rust：抓帧线程按目标间隔抓选区，RGBA 原始帧写进 FFmpeg 的 stdin，libx264 `veryfast` / CRF 20 编码成 MP4（`+faststart`），落在 `图片/Stillframe/录屏-<时间戳>.mp4`。
- **首帧到达才开编码**：先抓一帧量尺寸、顺便当首帧，避免片头黑屏；选区宽高收成偶数（libx264 的 yuv420p 不接受奇数）。
- **掉帧如实报**：不做补帧（补出来的重复帧只会让音画更乱），只按「目标帧率 × 实际时长」与已写帧数算差额，结束页显示 `3.0s · 30fps · 90 帧`，低于 24fps 时提示。
- **编码侧已在 Linux 真跑**：独立 crate 喂 90 帧合成画面 → `ffprobe` 核对 `codec_name=h264 / 320x240 / nb_frames=90 / duration=3.000000`；`crop_rgba` 的裁剪长度与预期一致（20000 字节）。抓帧线程与 1080p 真机帧率仍要在 Windows 上跑满 60 秒才算验收。
- **本轮只做画面**：WASAPI 环回与麦克风混音留到下一批，命令行显式 `-an`；原生录制期间声音与麦克风按钮置灰并注明原因，不再让人以为开了却录不进去。录屏标注（箭头/激光）目前也只进网页端成片。
- **省 CPU 的一个决定**：原生录制开始时停掉预览轮的 320ms 抓屏轮询，把抓屏让给录制线程，界面停在最后一帧。
- **FFmpeg 不用非得进 PATH**：查找顺序是命令参数 → `STILLFRAME_FFMPEG` → 应用目录（`ffmpeg.exe` / `sidecars/ffmpeg.exe` / `binaries/ffmpeg.exe`）→ PATH；找不到就报错，不静默录空片。录到一半关面板也会兜底收尾，不留后台空转的录制线程。
- **可脱离 GUI 复验**：新增 `tools/recorder-check`（直接复用 `recorder.rs`，不复制逻辑），喂合成帧跑一遍 FFmpeg 并用 `ffprobe` 断言 h264 / 分辨率 / 帧数 / 时长；CI 增加 `Recorder pipeline` 任务跑它，编码链不再只靠一次性手验。

## v0.3 第一批：自动滚动长截图（2026-11-26）

- Rust：`scroll_at(x, y, notches)` 用 `SendInput` 注入滚轮，注入前记录光标位置、注入后立即复位；单次最多 20 档，`wheel_delta` 有单测；非 Windows 返回明确错误。
- 前端：`src/lib/autoscroll.ts` 计算滚动量（视口 70%、约 50px/档）与停止判定（连续两帧无重叠且差异 ≤0.004 判到底；单帧无重叠且差异 >0.02 判断层回退）；`ScrollPanel` 逐帧「注入 → 等 620ms → 抓帧 → 拼接」，结束/回退都切回手动拼接，异常同样回退。
- 单测：`tests/autoscroll.test.ts` 6 条、Rust 4 条全部通过，`npm run build` 通过。
- **未验收**：20 屏成功率的真机测试因本机 GUI 会话异常未做，代码已合入但不算验收完成。

## v0.2 可用性补齐（进行中）

对应 [docs/UPGRADE-PLAN.md](UPGRADE-PLAN.md) 表6。

### 已落地

- **宿主落盘抽象**：新增 `src/lib/save.ts` 统一保存出口。桌面手动保存走 `save_png` 对话框、自动保存走新增的 `write_shot` 命令（静默写入 `图片/Stillframe`，不再退化成浏览器下载）；Android 两端都写相册；网页端优先写已授权目录，未授权时手动保存才退回下载。`docs/ARCHITECTURE.md` 的原生命令表同步补上 `write_shot`。
- **标注细节**：`src/lib/selection.ts` 抽出选区几何，Shift 等比、Alt 吸附直线（允许 1px 直线选区）；工具栏新增「重做」键，Ctrl+Y 与 Ctrl+Shift+Z 都能重做。
- **贴图管理**：贴图按原图比例定窗（桌面 `pin_image` 接收宽高，窗口上限 600×500）；页内贴图支持等比缩放、滚轮缩放、右下角拖拽缩放，数量上限 20 张，超出用 QQ 的 `nailLimit` 文案提示。
- **识图版面**：`recognize()` 用 tesseract 的行框做段落聚类（行距 + 缩进），返回 `paragraphs`；识图面板新增「段落视图 / 可编辑」切换，可逐段复制，连续文本仍按空行分段。
- **翻译对照**：原文与译文双栏滚动按比例同步；支持导入 CSV / TSV / JSON 术语表（持久化在 `stillframe.glossary.v1`），OpenAI 兼容接口会把命中的术语写进提示。
- **测试起步**：接入 vitest，新增 `tests/selection.test.ts`、`tests/glossary.test.ts`（17 条），CI 的 web 任务增加 `npm test`；接入 Playwright，`e2e/smoke.spec.ts` 覆盖首页加载、五种模式切换、图库与设置往返，CI 新增独立 e2e 任务。

### 待补

- stitch 单测（需要 canvas 环境，计划引入 jsdom + node-canvas 或改用纯函数签名）

### 桌面壳真机验收（v0.2 第一批收口）

- **能编译、能跑**：补齐 `desktop/icons/icon.ico`、去掉 tauri 的 `protocol-asset` 特性（前端未用 `convertFileSrc`），按 xcap 0.4 的 `window.id()` 返回 `Result` 改写调用；Windows 下用 VS Build Tools 2022 + stable-msvc 工具链，低内存机器（7.4GB）用 `-j 1` 加 `codegen-units=1` 编译通过。
- **热键容错**：setup 里逐条注册 Ctrl+Alt+S/R/C/O/F，被别的截图工具占用时只打警告、不再让壳起不来。
- **静默落盘验收**：新增 `write_shot` 的 3 条 Rust 单测（临时目录连写 10 张、坏 data URL 报错、非法字符清洗）全通过；真机开「导出时静默写入 图片\Stillframe」后连续 10 次截图保存，全部落到 `%USERPROFILE%\Pictures\Stillframe`，命名 `stillframe-YYYYMMDD-HHMMSS.png`，全程无系统「另存为」弹窗；关掉该开关则回到「另存为」对话框。
- **保存语义对齐 QQ**：`Editor.persist()` 只写图库，`handleSave()` 按 `autoSaveEnabled` 选自动/手动；设置页在桌面端隐藏「选择自动保存目录」按钮，文案改为桌面直写 `图片\Stillframe`，不再提示浏览器授权。

## v0.1 初始开源版

QQ 9.9.38 截图模块的界面与交互对标：框选、标注、12 色板、12 滤镜、长截图、录屏、识图、翻译、贴图，三端（网页 / Tauri 桌面 / Android WebView）。
