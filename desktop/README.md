# Stillframe 桌面壳（Tauri 2）

## 前置

| 依赖 | 用途 |
| --- | --- |
| Rust 1.77+ + `cargo` | 编译壳 |
| `cargo install tauri-cli --version "^2"` | `cargo tauri` 命令 |
| Node 18+ | 构建前端（壳直接复用 `../dist`） |
| Windows：WebView2 | 运行时（Win10/11 一般已内置） |
| macOS：Xcode CLT | 编译 |
| Linux：webkit2gtk-4.1、gtk-3、libayatana-appindicator3、librsvg2 | 编译 |

## 跑起来

```bash
# 在仓库根目录
npm install
npm run build

cd desktop
cargo tauri dev
```

`cargo tauri dev` 会先执行 `npm --prefix .. run dev` 起 Vite（端口固定 24118），窗口加载 `http://127.0.0.1:24118`。

打包：

```bash
cargo tauri build
```

## 图标

仓库里只放了 `icons/icon.png`（1024×1024）。生成全套平台图标：

```bash
cargo tauri icon icons/icon.png
```

## 提供的能力

| 命令 | 说明 |
| --- | --- |
| `capture_screen` | 抓主显示器整屏 → `data:image/png;base64,...`。**不触发系统授权弹窗** |
| `pin_image` | 开无边框置顶窗口贴图，加载 `pin.html` 并通过 `eval` 注入图像 |
| `save_png` | 系统保存对话框 → 写盘，返回最终路径 |
| `list_windows` | 遍历可见窗口，返回 `{id, title, app, width, height}` |
| `hide_self` / `show_self` | 截图前收起 / 拍完恢复，对应 QQ 截图里的「隐藏当前窗口」 |
| 全局快捷键 | `Ctrl+Alt+S/R/C/O/F`，触发后向前端发 `stillframe://shortcut` 事件 |

## 权限声明

`capabilities/default.json` 只开了 UI 需要的窗口控制、对话框、文件系统与全局快捷键，没有开 shell 执行。新增能力时同步改这里，否则前端调用会被拒绝。

## 已知未验证项

- 本仓库作者没有 Rust 工具链，**未在本机编译验证**。
- 若 `xcap` 版本与 crates.io 当前不一致，先改 `Cargo.toml` 的版本号；`xcap` 0.3 → 0.4 的方法返回值从裸值改成了 `Result`，`lib.rs` 的 `list_windows` 已按 0.4 的 `Result` 签名处理。
- `pin.html` 的关闭走 `plugin:window|close`；若 Tauri 2 的窗口插件命令名变化，改成 `getCurrentWindow().close()`（需 `@tauri-apps/api`）或从前端调 `hide_self`。
