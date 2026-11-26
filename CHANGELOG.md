# 变更记录

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

## v0.1 初始开源版

QQ 9.9.38 截图模块的界面与交互对标：框选、标注、12 色板、12 滤镜、长截图、录屏、识图、翻译、贴图，三端（网页 / Tauri 桌面 / Android WebView）。
