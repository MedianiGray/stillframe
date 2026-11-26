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
| `write_shot` | 静默写入 `%USERPROFILE%\Pictures\Stillframe`，命名 `stillframe-YYYYMMDD-HHMMSS.png`，不弹框 |
| `list_windows` | 遍历可见窗口，返回 `{id, title, app, width, height}` |
| `hide_self` / `show_self` | 截图前收起 / 拍完恢复，对应 QQ 截图里的「隐藏当前窗口」 |
| 全局快捷键 | `Ctrl+Alt+S/R/C/O/F`，触发后向前端发 `stillframe://shortcut` 事件 |

## 权限声明

`capabilities/default.json` 只开了 UI 需要的窗口控制、对话框、文件系统与全局快捷键，没有开 shell 执行。新增能力时同步改这里，否则前端调用会被拒绝。

## 本机编译注意

Windows 上用 VS Build Tools 2022（「使用 C++ 的桌面开发」）+ stable-msvc 工具链。8GB 内存以下的机器编 `windows` 这类大 crate 容易 OOM，实测加这些参数可过：

```powershell
$env:RUSTFLAGS = '-C codegen-units=1 -C debuginfo=0'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_DEV_INCREMENTAL = 'false'
cargo build -j 1
```

`icons/icon.ico` 已提交（由 `icon.png` 生成的多尺寸），没有它 `tauri-build` 会直接报错。WebView2 偶发渲染空白时，用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu` 启动。

## 已验证

- 2026-11 在 Windows 11 + WebView2 158 上编译通过并真机跑通：截图→框选→标注→保存全流程可走；`cargo test --lib` 的 3 条用例（`write_shot` 连写 10 张、坏 data URL、非法字符清洗）全绿。
- 真机开「导出时静默写入 图片\Stillframe」后连续 10 次保存，全部落到 `图片\Stillframe` 且无系统弹框。
- 仍需注意：全局快捷键被其它截图工具占用时只打警告不阻断启动，此时热键不生效，需先用界面按钮。
- `pin.html` 的关闭走 `plugin:window|close`；若 Tauri 2 的窗口插件命令名变化，改成 `getCurrentWindow().close()`（需 `@tauri-apps/api`）或从前端调 `hide_self`。
