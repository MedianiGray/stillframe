# 贡献指南

## 环境

- Node 18+
- （改原生壳时）Rust 1.77+ / `cargo-tauri`、JDK 17、Android SDK 34
- 建议 Windows 10/11 或 macOS 13+；Linux 需自行验证 WebKitGTK 依赖

## 提交前必须通过

```bash
npm run typecheck
npm test
npm run build
```

改到页面交互、图库或设置页时，再跑一遍端到端冒烟（首次需 `npx playwright install chromium`）：

```bash
npm run test:e2e
```

涉及 `desktop/` 的改动，额外跑：

```bash
cd desktop
cargo fmt --check
cargo clippy -- -D warnings
```

涉及 `android/` 的改动，额外跑 `gradlew assembleDebug`。

## 代码约定

- 与 UI 无关的能力放 `src/lib/`，UI 只做编排；新能力先写库函数再接面板。
- 平台差异一律在 `src/lib/desktop.ts` 里收敛，不要散落在组件判断 `__TAURI__`。
- 平台做不到的能力，UI 上如实标注，不允许假装支持。
- 注释写"为什么"，不写"是什么"；不写 XX 风格的营销文案。
- 中文文案统一用简体；变量、函数、文件名用英文。

## PR

- 一个 PR 只做一件事，标题写清动作与范围（例：`feat(stitch): 支持手动指定重叠高度`）。
- 描述里写：改了什么、为什么、怎么验证的（平台 + 工具链版本）。
- 新增依赖请在描述里说明为什么现有实现不够，以及许可证是否兼容 MIT。

## 报告问题

用 `.github/ISSUE_TEMPLATE/` 里的模板，附上：运行平台、浏览器/壳版本、复现步骤、控制台报错。截图相关的问题请说明是网页端还是桌面端——两者的抓屏机制完全不同。
