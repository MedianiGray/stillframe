# 变更记录

## v0.4 贴近系统截图的体验补齐（2026-11-26）

### 已落地

- **快捷浮窗**：桌面壳新增 `quick.html` 无边框置顶动作条（截图 / 长图 / 录屏 / 取字 / 译屏 / 主窗 / 收起，左侧拖动把手）。窗口 520×84、贴主屏底部居中、不进任务栏；`--quick` 参数可开机只起浮窗。真机验证：窗口标题 `Stillframe 快捷浮窗`、可见、PrintWindow 截图渲染正常。
- **全局热键接通**：此前 Rust 用 `stillframe://shortcut` 广播，前端没有监听，热键等于没接。现在 `App` 通过 `onHostEvent`（Tauri event 插件 + `transformCallback`，不引入 `@tauri-apps/api`）订阅热键与浮窗事件，切模式后直接进入捕捉，不需要再点「开始捕捉」。新增 Ctrl+Alt+Q 呼出/收起浮窗。
- **延时截图**：截图 / 取字 / 译屏三模式可选「立即 / 3s / 5s」，桌面壳倒计时结束后先收起自身窗口再抓帧，抓完亮回，避免把自己拍进画面；倒计时可取消。
- **取字即出结果**：进入取字面板自动跑一次识别，不再要求手动点「识别」；失败时保留可操作提示（语言包首次下载、离线走内网目录）并提供重试；新增「复制并收起」。
- **语言包回落顺序**：用户配置 → 站点自带 `./tessdata`（内网/离线镜像）→ 官方 CDN，用一次 HEAD 探测选择，兼容实训室无外网环境。

### 实训室部署

- 新增 `deploy/`：多阶段 `Dockerfile`（node 构建 + nginx 托管 + 语言包内置）、`docker-compose.yml`（健康检查、只读根文件系统、日志上限）、`prewarm.ps1` / `prewarm.sh`（等健康检查 → 解析真实 assets → 连跑多轮首页/浮窗页/语言包）。
- **未验证**：本机未装 Docker，镜像构建与容器健康检查没有真机跑过；预热脚本的 HTTP 逻辑可用任意静态服务器验证。

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
