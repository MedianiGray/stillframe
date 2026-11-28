# Stillframe Android 壳

一个 `WebView` + 一层原生桥，把和网页端/桌面端**完全相同的那套 UI** 跑在手机上，再用系统接口补上浏览器给不了的能力。

## 构建

前置：JDK 17、Android SDK（compileSdk 34、build-tools 34）、Gradle 8.7（或用 Android Studio 打开让 IDE 补 wrapper）。

```bash
# 1) 在仓库根目录构建前端
npm install
npm run build

# 2) 把产物整包同步进 WebView 的 assets（会先清空旧副本再拷，含 OCR 语言包）
powershell -NoProfile -File tools\sync-android-assets.ps1

# 3) 编译
cd android
gradlew assembleDebug      # Windows
./gradlew assembleDebug    # macOS / Linux
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

> 本仓库没有提交 `gradle-wrapper.jar`（二进制不便入库）。首次用命令行构建先执行一次 `gradle wrapper --gradle-version 8.7`，或直接用 Android Studio 打开 `android/` 目录，它会自动补齐。

## 结构

```
android/
├─ app/src/main/
│  ├─ AndroidManifest.xml        # 权限 + Activity + 前台服务声明
│  ├─ java/app/stillframe/android/
│  │  ├─ MainActivity.kt         # WebView + AssetLoader + 授权结果转发
│  │  ├─ CaptureService.kt       # 前台服务（Android 14 要求先前台后取投影）
│  │  ├─ ScreenGrabber.kt        # MediaProjection + ImageReader → Bitmap
│  │  ├─ PinOverlay.kt           # 贴图悬浮窗（拖动移动，双击关闭）
│  │  └─ Bridge.kt               # window.AndroidBridge 注入的 JS 接口
│  ├─ res/                       # 主题、字符串、矢量图标
│  └─ assets/www/               # 前端产物（构建时复制进来，已 gitignore）
```

## 为什么用 WebViewAssetLoader 而不是 file://

`file://` 下 WebView 的 IndexedDB、跨域、相对路径都容易出问题。AssetLoader 把 `assets/` 映射到 `https://appassets.androidplatform.net/assets/`，前端就能像在正常站点里一样用 IndexedDB 存图库。配合 Vite 的 `base: './'`，产物里的相对引用会落在 `/assets/www/...`。

## 权限

| 权限 | 何时要 | 不给会怎样 |
| --- | --- | --- |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PROJECTION` | 抓屏期间 | 无法抓屏（系统硬性要求常驻通知） |
| `POST_NOTIFICATIONS` | Android 13+ | 前台通知不可见，抓屏会被系统掐断 |
| `SYSTEM_ALERT_WINDOW` | 用「贴图」时 | 贴图会跳到设置页让你授权 |
| `RECORD_AUDIO` | 录屏要收麦克风 | 只能录画面 |
| `WRITE_EXTERNAL_STORAGE` | Android 9 及以下保存到相册 | 只能用系统分享保存 |

## 桥接接口

`window.AndroidBridge` 暴露的方法与桌面壳命令一一对应：

| 方法 | 返回 | 对应桌面命令 |
| --- | --- | --- |
| `captureScreen()` | `data:image/png;base64,...` 或 `ERR:...` | `capture_screen` |
| `pinImage(dataUrl)` | — | `pin_image` |
| `savePng(dataUrl, name)` | `content://` 地址或 `ERR:...` | `save_png` |
| `hideSelf()` | — | `hide_self` |
| `hasCapture()` / `requestScreenCapture()` | 是否已授权 / 拉起授权弹窗 | — |
| `hasOverlay()` / `requestOverlayPermission()` | 悬浮窗权限状态 / 去设置页 | — |

前端 `src/lib/desktop.ts` 探测到 `AndroidBridge` 就判定宿主为 `android`，截图、贴图、保存全部走原生；探测不到则回落到浏览器实现。

## 与桌面端的能力差异

- **没有全局热键**：Android 不允许普通应用抢占全局按键（除非走无障碍，本仓库不做）。
- **录屏是原生连续抓帧**（约 3fps，PNG 回传的代价），不是系统级 30fps 编码；要高质量录制请用系统自带录屏。
- **长截图同样靠原生帧**：在目标应用里滚动一屏，回「定格」点一次「追加一屏」。
- **首次抓屏必须授权一次**，授权后本次会话内可以连续抓；进程被杀需重新授权。

## 未验证声明

本仓库作者没有 JDK / Android SDK 环境，**未在本机编译验证**。代码按 Android 14 的 MediaProjection 规则（先 `startForeground` 再 `getMediaProjection`、注册 `MediaProjection.Callback`）编写；首次构建若报版本或 API 变更，按 Gradle 提示调整 `compileSdk` / AGP 版本即可。
