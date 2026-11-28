//! 桌面壳：把网页端那套 UI 装进系统里，补上浏览器给不了的能力。
//!
//! 契约见 docs/ARCHITECTURE.md：前端只调 `capture_screen` / `pin_image` /
//! `save_png` / `write_shot` / `list_windows`，
//! 其余（隐藏窗口、热键）走这里的 `hide_self` 与全局快捷键事件。

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

mod recorder;

use recorder::log_line;

#[cfg(windows)]
mod win_capture;

#[cfg(windows)]
mod win_audio;

#[cfg(windows)]
mod win_annot;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn decode_data_url(data: &str) -> Result<Vec<u8>, String> {
    let (_, payload) = data
        .split_once(',')
        .ok_or_else(|| "data URL 格式不正确".to_string())?;
    STANDARD.decode(payload).map_err(err)
}

fn encode_png(rgba: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buffer, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(err)?;
        writer.write_image_data(&rgba).map_err(err)?;
    }
    Ok(buffer)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowInfo {
    id: u32,
    title: String,
    app: String,
    width: u32,
    height: u32,
}

/// 抓主显示器整屏，返回 PNG 的 data URL。前端拿到后直接转 canvas 当冻结帧。
#[tauri::command]
fn capture_screen() -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(err)?;
    let monitor = monitors.into_iter().next().ok_or("没有检测到显示器")?;
    let image = monitor.capture_image().map_err(err)?;
    let width = image.width();
    let height = image.height();
    let png_bytes = encode_png(image.into_raw(), width, height)?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png_bytes)))
}

/// 把贴图钉在屏幕上：独立、无边框、置顶、不进任务栏的窗口。
/// 按原图比例定窗（上限 600×500），并限制同时存在 20 张（对应 QQ 的 nailLimit）。
#[tauri::command]
async fn pin_image(
    app: AppHandle,
    data_url: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    let pins = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("pin-"))
        .count();
    if pins >= 20 {
        return Err("贴图已达 20 张上限，请先关掉几张再钉新的".to_string());
    }

    let source_w = width.unwrap_or(600).max(1) as f64;
    let source_h = height.unwrap_or(500).max(1) as f64;
    let scale = (600.0 / source_w).min(500.0 / source_h).min(1.0);
    let win_w = (source_w * scale).max(80.0);
    let win_h = (source_h * scale).max(60.0);

    let label = format!(
        "pin-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let payload = serde_json::to_string(&data_url).map_err(err)?;
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("pin.html".into()))
        .title("Stillframe Pin")
        .inner_size(win_w, win_h)
        .min_inner_size(80.0, 60.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .build()
        .map_err(err)?;

    // 页面可能还没加载完；pin.html 里也会在 onload 时检查这个全局变量。
    let script = format!(
        "window.__STILLFRAME_PIN__ = {payload}; window.__stillframeShowPin && window.__stillframeShowPin();"
    );
    window.eval(&script).map_err(err)?;
    Ok(())
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect()
}

/// 静默落盘：写到 图片/Stillframe 目录，不弹系统对话框。
#[tauri::command]
async fn write_shot(data_url: String, suggested_name: String) -> Result<String, String> {
    let bytes = decode_data_url(&data_url)?;
    let target = write_png_bytes(&bytes, &shot_dir()?, &suggested_name)?;
    Ok(target.to_string_lossy().to_string())
}

/// 桌面自动保存的固定目录：`%USERPROFILE%\Pictures\Stillframe`。
fn shot_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "找不到用户目录，无法静默保存".to_string())?;
    Ok(std::path::PathBuf::from(home).join("Pictures").join("Stillframe"))
}

/// 落盘本体，抽出来是为了能脱离窗口系统做连续保存测试。
fn write_png_bytes(
    bytes: &[u8],
    dir: &std::path::Path,
    suggested_name: &str,
) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(err)?;
    let mut name = sanitize_file_name(suggested_name);
    if !name.to_lowercase().ends_with(".png") {
        name.push_str(".png");
    }
    let target = dir.join(name);
    std::fs::write(&target, bytes).map_err(err)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_ten_shots_without_dialog() {
        let dir = std::env::temp_dir().join(format!("stillframe-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data_url = "data:image/png;base64,aGVsbG8=";
        let bytes = decode_data_url(data_url).expect("data URL 应能解码");

        for index in 1..=10 {
            let name = format!("stillframe-{index:02}");
            let target = write_png_bytes(&bytes, &dir, &name).expect("第 N 张应落盘成功");
            assert!(target.exists(), "文件应存在: {}", target.display());
            assert_eq!(target.file_name().unwrap().to_string_lossy(), format!("{name}.png"));
        }

        let count = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(count, 10, "应当正好写入 10 张，实际 {count}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_data_url_without_payload() {
        assert!(decode_data_url("not-a-data-url").is_err());
    }

    #[test]
    fn sanitizes_windows_forbidden_chars() {
        assert_eq!(sanitize_file_name("a:b*c?.png"), "a_b_c_.png");
    }

    #[test]
    #[cfg(windows)]
    fn clamps_wheel_notches() {
        assert_eq!(wheel_delta(3), 360);
        assert_eq!(wheel_delta(-2), -240);
        assert_eq!(wheel_delta(99), 20 * WHEEL_DELTA);
        assert_eq!(wheel_delta(-99), -20 * WHEEL_DELTA);
        assert_eq!(wheel_delta(0), 0);
    }
}

/// 弹系统保存框，写 PNG。用户取消返回 None。
#[tauri::command]
async fn save_png(app: AppHandle, data_url: String, suggested_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let bytes = decode_data_url(&data_url)?;
    let name = if suggested_name.ends_with(".png") {
        suggested_name
    } else {
        format!("{suggested_name}.png")
    };

    let (tx, rx) = mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(&name)
        .add_filter("PNG 图片", &["png"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let chosen = rx
        .recv_timeout(Duration::from_secs(180))
        .map_err(|_| "保存对话框超时".to_string())?;

    match chosen {
        Some(path) => {
            let target = path.into_path().map_err(err)?;
            std::fs::write(&target, bytes).map_err(err)?;
            Ok(Some(target.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

/// 窗口列表：给「指定窗口截图」和选区吸附用。
#[tauri::command]
fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = xcap::Window::all().map_err(err)?;
    let mut rows = Vec::new();
    for window in windows {
        let title = window.title().unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }
        rows.push(WindowInfo {
            id: window.id().unwrap_or(0),
            title,
            app: window.app_name().unwrap_or_default(),
            width: window.width().unwrap_or(0),
            height: window.height().unwrap_or(0),
        });
    }
    Ok(rows)
}

/// 按窗口句柄抓一张：对应系统截图工具里的「窗口截图」，不受窗口是否被遮挡影响。
#[tauri::command]
fn capture_window(id: u32) -> Result<String, String> {
    let windows = xcap::Window::all().map_err(err)?;
    let target = windows
        .into_iter()
        .find(|window| window.id().unwrap_or(0) == id)
        .ok_or("窗口已关闭，请刷新列表")?;
    if target.is_minimized().unwrap_or(false) {
        return Err("窗口已最小化，先还原再截".to_string());
    }
    let image = target.capture_image().map_err(err)?;
    let width = image.width();
    let height = image.height();
    let png_bytes = encode_png(image.into_raw(), width, height)?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png_bytes)))
}

/// 把随应用打包的 OCR 语言包读给前端。
/// 桌面壳不依赖网络取 language data：离线机房、内网、代理环境都能直接取字。
#[tauri::command]
fn read_tessdata(app: AppHandle, lang: String) -> Result<String, String> {
    let file = format!("{lang}.traineddata.gz");
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("tessdata").join(&file));
        candidates.push(dir.join(&file));
    }
    if let Ok(dir) = app.path().app_config_dir() {
        candidates.push(dir.join("tessdata").join(&file));
    }
    candidates.push(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tessdata")
            .join(&file),
    );
    for path in candidates {
        if let Ok(bytes) = std::fs::read(&path) {
            return Ok(STANDARD.encode(bytes));
        }
    }
    Err(format!("没有找到内置语言包 {file}，可改用在线源或把 tessdata 放到应用资源目录"))
}

/// 截图前把自己藏起来，避免把 Stillframe 自己拍进画面。
#[tauri::command]
fn hide_self(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| format!("隐藏窗口失败：{error}"))
}

/// 拍完再露出来。
///
/// show 与「还原 + 聚焦」分开算：show 成功就算成功，聚焦失败只影响手感，
/// 不能让前端以为窗口还藏着又去重试（那会让窗口闪一下）。
#[tauri::command]
fn show_self(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| format!("恢复窗口失败：{error}"))?;
    // 隐藏前若已被最小化，show 出来依旧是收起的，顺手还原
    if let Err(error) = window.unminimize() {
        log_line(&format!("show_self: 还原窗口失败 {error}"));
    }
    if let Err(error) = window.set_focus() {
        log_line(&format!("show_self: 聚焦失败 {error}"));
    }
    Ok(())
}

/// 一档滚轮的 delta 值（Windows 的 WHEEL_DELTA）。
#[cfg(windows)]
const WHEEL_DELTA: i32 = 120;

/// 把界面传来的「档数」折算成 SendInput 需要的 delta，并夹在 ±20 档内，
/// 避免一次注入把目标窗口甩出太远、重叠区不够。
#[cfg(windows)]
fn wheel_delta(notches: i32) -> i32 {
    notches.clamp(-20, 20) * WHEEL_DELTA
}

/// 向指定屏幕坐标注入滚轮事件（长截图自动滚动用）。
///
/// 只发竖向滚轮：横向自动滚动目标窗口命中率低，仍走手动追加。
/// 注入前把光标挪到目标点，注入后立刻挪回原处，避免抢用户的鼠标。
#[tauri::command]
fn scroll_at(x: i32, y: i32, notches: i32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT,
        };
        use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

        let mut origin = POINT::default();
        unsafe { GetCursorPos(&mut origin) }.map_err(err)?;

        unsafe { SetCursorPos(x, y) }.map_err(err)?;
        let wheel = MOUSEINPUT {
            dx: 0,
            dy: 0,
            mouseData: wheel_delta(notches) as u32,
            dwFlags: MOUSEEVENTF_WHEEL,
            time: 0,
            dwExtraInfo: 0,
        };
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 { mi: wheel },
        };
        let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
        // 先复位光标，再汇报结果：即使注入失败也不能把鼠标留在原地。
        unsafe { SetCursorPos(origin.x, origin.y) }.map_err(err)?;
        if sent == 0 {
            return Err("滚轮事件没有送达目标窗口".to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (x, y, notches);
        Err("自动滚动目前只在 Windows 桌面壳实现".to_string())
    }
}

/// 快捷浮窗：无边框、置顶、不进任务栏的一条动作栏。
/// 位置贴主屏底部居中，和 QQ 的截图浮条一样随叫随到，再点「收起」隐藏。
fn show_quick(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick") {
        window.show().map_err(err)?;
        let _ = window.set_focus();
        return Ok(());
    }

    let width = 520.0_f64;
    let height = 84.0_f64;
    let builder = WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("quick.html".into()))
        .title("Stillframe 快捷浮窗")
        .inner_size(width, height)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(true);
    let window = builder.build().map_err(|error| {
        log_line(&format!("[quick] 创建窗口失败：{error}"));
        err(error)
    })?;
    log_line("[quick] 窗口已创建");

    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let area = monitor.size();
        let origin = monitor.position();
        let x = origin.x + (area.width as f64 - width * scale) as i32 / 2;
        let y = origin.y + (area.height as f64 - height * scale) as i32 - (28.0 * scale) as i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }

    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn open_quick(app: AppHandle) -> Result<(), String> {
    show_quick(&app)
}

#[tauri::command]
fn close_quick(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick") {
        window.hide().map_err(err)?;
    }
    Ok(())
}

fn toggle_quick(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
    }
    if let Err(error) = show_quick(app) {
        log_line(&format!("[quick] 打开失败：{error}"));
        eprintln!("[stillframe] 快捷浮窗打开失败：{error}");
    }
}

/// 浮窗里选了一个动作：收起浮窗、亮出主窗，并让前端直接进入该模式的捕捉。
#[tauri::command]
fn quick_action(app: AppHandle, mode: String) -> Result<(), String> {
    log_line(&format!("[quick] action={mode}"));
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    app.emit_to("main", "stillframe://quick", mode)
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
fn quick_main(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    Ok(())
}

/// 全局热键表：(快捷键, 前端模式名, 给用户看键位, 虚拟键码)。
/// 后两项分别用于「告诉用户是哪一组」和「注册前先自己探一次」。
fn shortcuts() -> Vec<(Shortcut, &'static str, &'static str, u32)> {
    vec![
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS),
            "snap",
            "Ctrl+Alt+S",
            0x53,
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR),
            "record",
            "Ctrl+Alt+R",
            0x52,
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyC),
            "scroll",
            "Ctrl+Alt+C",
            0x43,
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyO),
            "ocr",
            "Ctrl+Alt+O",
            0x4F,
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyF),
            "translate",
            "Ctrl+Alt+F",
            0x46,
        ),
    ]
}

/// 注册前先自己探一次：`RegisterHotKey` 成功就立刻注销，能真拿到才算可用。
///
/// 不能只看插件的返回值——实测 Ctrl+Alt+S 被别的工具占用（系统错误 1409）时，
/// `on_shortcut` 依然返回 Ok，失败被吞掉了，界面上就永远等不到提示。
#[cfg(windows)]
fn hotkey_available(vk: u32) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL,
    };
    const PROBE_ID: i32 = 0x5350;
    let mods = MOD_ALT | MOD_CONTROL;
    let taken = unsafe { RegisterHotKey(None, PROBE_ID, mods, vk) }.is_ok();
    if taken {
        let _ = unsafe { UnregisterHotKey(None, PROBE_ID) };
    }
    taken
}

#[cfg(not(windows))]
fn hotkey_available(_vk: u32) -> bool {
    true
}


/// 把自己窗口在屏幕上的位置和大小交给前端：长图自动滚动要用它判断「本窗口会不会被拍进去」。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelfRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[tauri::command]
fn self_rect(window: tauri::WebviewWindow) -> Result<SelfRect, String> {
    let position = window.outer_position().map_err(err)?;
    let size = window.outer_size().map_err(err)?;
    Ok(SelfRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

// ---------- 桌面录制：抓帧线程 + FFmpeg 编码 ----------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

struct Recording {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: std::thread::JoinHandle<Result<recorder::RecordingStats, String>>,
}

static RECORDING: std::sync::OnceLock<std::sync::Mutex<Option<Recording>>> =
    std::sync::OnceLock::new();

fn recording_slot() -> &'static std::sync::Mutex<Option<Recording>> {
    RECORDING.get_or_init(|| std::sync::Mutex::new(None))
}

// ---- 录屏标注：前端把落定的标注与激光轨迹推进来，录制线程每帧取快照合成 ----

/// 当前这一段录像的标注清单（按出现时刻排进成片，已撤销的不再推）。
static RECORD_ANNS: std::sync::OnceLock<std::sync::Mutex<Vec<win_annot_any::AnnotItem>>> =
    std::sync::OnceLock::new();

fn record_ann_slot() -> &'static std::sync::Mutex<Vec<win_annot_any::AnnotItem>> {
    RECORD_ANNS.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// 激光轨迹（只留最近一小段，画成渐隐的点）。
static RECORD_LASER: std::sync::OnceLock<std::sync::Mutex<Vec<win_annot_any::LaserItem>>> =
    std::sync::OnceLock::new();

fn record_laser_slot() -> &'static std::sync::Mutex<Vec<win_annot_any::LaserItem>> {
    RECORD_LASER.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// 跨平台的承载类型：Windows 下就是 GDI 绘制用的那份结构，别处只做占位。
mod win_annot_any {
    #[cfg(windows)]
    pub use super::win_annot::{LaserPoint as LaserItem, RecAnnotation as AnnotItem};

    #[cfg(not(windows))]
    #[derive(Clone, Default)]
    pub struct AnnotItem {
        pub at_ms: f64,
    }

    #[cfg(not(windows))]
    #[derive(Clone, Default)]
    pub struct LaserItem {
        pub x: f32,
        pub y: f32,
        pub at_ms: f64,
    }
}

fn clear_record_annotations() {
    if let Ok(mut list) = record_ann_slot().lock() {
        list.clear();
    }
    if let Ok(mut list) = record_laser_slot().lock() {
        list.clear();
    }
}

/// 标注落定（松开鼠标 / 定稿文字）时推一条：坐标、线宽、字号都由前端归一化。
#[tauri::command]
fn push_record_annotation(annotation: serde_json::Value) -> Result<(), String> {
    #[cfg(windows)]
    {
        let item: win_annot::RecAnnotation =
            serde_json::from_value(annotation).map_err(|e| format!("标注格式不对：{e}"))?;
        let mut list = record_ann_slot().lock().map_err(err)?;
        // 一段录像里标注数量有天花板，超了丢最老的，防止长时间录制无限吃内存。
        if list.len() >= 256 {
            list.remove(0);
        }
        list.push(item);
    }
    #[cfg(not(windows))]
    {
        let _ = annotation;
    }
    Ok(())
}

/// 撤销一条标注：画布上撤了，成片后面的帧也就不该再画它。
/// 已经录进去的帧保持原样——录像没法倒着改。
#[tauri::command]
fn undo_record_annotation() -> Result<(), String> {
    if let Ok(mut list) = record_ann_slot().lock() {
        list.pop();
    }
    Ok(())
}

/// 清空所有标注（画布「清除」按钮）。
#[tauri::command]
fn clear_record_annotation() -> Result<(), String> {
    clear_record_annotations();
    Ok(())
}

/// 激光笔移动：只留最近 1.5 秒的点，画成一路渐隐的红点。
#[tauri::command]
fn push_record_laser(x: f32, y: f32, at_ms: f64) -> Result<(), String> {
    let mut list = record_laser_slot().lock().map_err(err)?;
    list.push(win_annot_any::LaserItem { x, y, at_ms });
    list.retain(|point| at_ms - point.at_ms <= 1600.0);
    Ok(())
}

/// 抓帧循环：先抓一帧量尺寸、顺便当首帧（首帧到了才启动编码，避免片头空白），
/// 之后按目标间隔抓屏、裁剪、写进编码器。落后三帧以上就重设基准，不做追赶式狂抓。
/// 挑编码器：能跑 h264_qsv 就用核显，把 CPU 留给抓帧；不行再回退 libx264。
/// 探测方式真编一小段（640×360、5 帧），比查 -encoders 靠谱——编码器列表里有，
/// 不代表这台机器的驱动能用。
#[cfg(windows)]
fn pick_encoder(ffmpeg: &str) -> &'static str {
    let ok = std::process::Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=5:duration=1",
            "-c:v",
            "h264_qsv",
            "-f",
            "null",
            "-",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if ok {
        "h264_qsv"
    } else {
        "libx264"
    }
}

/// 按目标节奏走一拍。抓帧比节拍慢时，用同一帧补齐时间轴——
/// 这样成片时长才等于真实录制时长，否则慢于目标帧率就会变成快放。
fn pace_frame(
    encoder: &mut recorder::Encoder,
    frame: &[u8],
    started: std::time::Instant,
    fps: u32,
) -> Result<(), String> {
    let fps = fps.max(1) as f64;
    // 绝对对账：目标帧数只由「已跑秒数 × 帧率」决定，不再维护节拍累加器。
    // 累加器版本在忙时会连续补帧、把时间轴补超前——实测 15 秒录出 466 帧。
    let target = (started.elapsed().as_secs_f64() * fps).floor() as u64;
    let mut filled = 0u8;
    while encoder.frames() < target && filled < 8 {
        encoder.push_repeat(frame)?;
        filled += 1;
    }
    // 睡到下一个节拍点，帧率锁在 fps 上。
    // 只剩几毫秒时不能用 sleep：Windows 的 sleep 粒度偏粗，3ms 常常只睡 1–2ms，
    // 每帧欠一点累积下来帧率就偏高——实测 15 秒录出 465 帧、成片变长 3%。
    let next_at = started + Duration::from_secs_f64(encoder.frames() as f64 / fps);
    loop {
        let now = std::time::Instant::now();
        if now >= next_at {
            break;
        }
        let rest = next_at - now;
        if rest > Duration::from_millis(2) {
            std::thread::sleep(rest - Duration::from_millis(1));
        } else {
            std::hint::spin_loop();
        }
    }
    Ok(())
}

/// 找可用的麦克风：解析 `ffmpeg -f dshow -list_devices true` 的输出，取第一路 `(audio)`。
/// 本机实测只有「麦克风阵列 (Synaptics SmartAudio HD)」，没有立体声混音端点——
/// 系统声得另走 WASAPI 环回，见 docs/UPGRADE-PLAN.md §5.2。
#[cfg(windows)]
fn pick_microphone(ffmpeg: &str) -> Option<String> {
    let output = std::process::Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-f",
            "dshow",
            "-list_devices",
            "true",
            "-i",
            "dummy",
        ])
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;
    // list_devices 的退出码非 0（dummy 输入必然失败），只看输出
    let text = String::from_utf8_lossy(&output.stderr);
    for line in text.lines() {
        if !line.contains("(audio)") || line.contains("Alternative name") {
            continue;
        }
        if let Some(start) = line.find('"') {
            let rest = &line[start + 1..];
            if let Some(end) = rest.find('"') {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

/// 麦克风能不能真采：空编码跑 0.4 秒。设备被别的程序独占时这里失败，
/// 那就当没有麦克风——不能让整段录制因为音频起不来。
#[cfg(windows)]
fn microphone_works(ffmpeg: &str, device: &str) -> bool {
    std::process::Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "dshow",
            "-i",
            &format!("audio={device}"),
            "-t",
            "0.4",
            "-f",
            "null",
            "-",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// 每帧取一次标注快照。条目不多（上限 256），拷一份比长期持锁更省心。
#[cfg(windows)]
fn snapshot_record_annotations() -> (
    Vec<win_annot_any::AnnotItem>,
    Vec<win_annot_any::LaserItem>,
) {
    let anns = record_ann_slot()
        .lock()
        .map(|list| list.clone())
        .unwrap_or_default();
    let laser = record_laser_slot()
        .lock()
        .map(|list| list.clone())
        .unwrap_or_default();
    (anns, laser)
}

/// Windows 专用抓帧循环：直接 BitBlt 到 DIB 缓冲，像素零拷贝交给 FFmpeg。
/// 实测 xcap 的 `capture_image` 在本机 1080p 下约 256ms/帧（3.9fps），
/// 换成 BitBlt 后每帧约 33ms，才够 30 帧的预算。
#[cfg(windows)]
fn record_loop(
    rect: Option<RecordRect>,
    fps: u32,
    out: std::path::PathBuf,
    ffmpeg: String,
    audio: Option<String>,
    system: bool,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    seconds_limit: Option<f64>,
) -> Result<recorder::RecordingStats, String> {
    let _timer = win_capture::TimerResolution::new();
    let (screen_w, screen_h) = win_capture::screen_size();
    let crop = match rect {
        Some(r) => (
            r.x.min(screen_w.saturating_sub(2)) as i32,
            r.y.min(screen_h.saturating_sub(2)) as i32,
            r.width.min(screen_w).max(2),
            r.height.min(screen_h).max(2),
        ),
        None => (0, 0, screen_w, screen_h),
    };
    let mut grabber = win_capture::FrameGrabber::new(crop.0, crop.1, crop.2, crop.3)?;
    let (width, height) = (grabber.width(), grabber.height());
    if width < 16 || height < 16 {
        return Err(format!("录制区域太小：{width}×{height}"));
    }

    let codec = pick_encoder(&ffmpeg);
    // 系统声：WASAPI 环回采到 WAV，和麦克风那条并行。设备打不开就退成没有系统声。
    let system_handle = if system {
        let wav = std::path::PathBuf::from(format!("{}.sys.wav", out.to_string_lossy()));
        win_audio::start(&wav).ok()
    } else {
        None
    };
    let mut encoder = recorder::Encoder::start(&recorder::EncoderSpec {
        width,
        height,
        fps,
        out,
        ffmpeg,
        crf: 20,
        pix_fmt: "bgra",
        preset: "ultrafast",
        codec,
        audio: audio.clone(),
        system_audio: system_handle.as_ref().map(|handle| handle.path().to_path_buf()),
    })?;
    let audio_tag = if audio.is_some() { "+mic" } else { "" };
    let system_tag = if system_handle.is_some() { "+sys" } else { "" };
    encoder.set_backend(format!(
        "{}+{}{}{}",
        grabber.backend(),
        codec,
        audio_tag,
        system_tag
    ));

    let started = std::time::Instant::now();
    // 标注画布：抓帧缓冲本来就是 BGRA，拷进 32 位 DIB 后直接用 GDI 画，
    // 没有标注活动时整段跳过，不白拷一遍像素。
    let mut layer = win_annot::Layer::new(width, height).ok();
    loop {
        if stop.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        if let Some(limit) = seconds_limit {
            // 时间与帧数双闸：补帧会让帧数偶尔超前节拍，只看时钟会实录超长
            let max_frames = (limit * fps as f64).round().max(1.0) as u64;
            if encoder.frames() >= max_frames || started.elapsed().as_secs_f64() >= limit {
                break;
            }
        }
        let t0 = std::time::Instant::now();
        let frame = grabber.grab()?;
        encoder.note_grab(t0.elapsed());
        let now_ms = started.elapsed().as_secs_f64() * 1000.0;
        let (anns, laser) = snapshot_record_annotations();
        let mut composed = false;
        if let Some(canvas) = layer.as_mut() {
            if win_annot::Layer::has_activity(&anns, &laser, now_ms) {
                canvas.draw(frame, &anns, &laser, now_ms);
                composed = true;
            }
        }
        let pixels: &[u8] = match layer.as_ref() {
            Some(canvas) if composed => canvas.pixels(),
            _ => frame,
        };
        encoder.push_frame(pixels)?;
        pace_frame(&mut encoder, pixels, started, fps)?;
    }
    // 尾巴补齐：按真实跑秒数把缺的帧补上，避免成片比实际录制短
    // 时间要先取：停麦克风 / 停环回最多要等半秒，算进去会多补十几帧。
    let elapsed = started.elapsed().as_secs_f64();
    if let Some(handle) = system_handle {
        handle.stop();
    }
    encoder.mark_end();
    log_line(&format!(
        "[record] frames={} elapsed={elapsed:.3} fps={fps} budget={:.0} backend={}",
        encoder.frames(),
        elapsed * fps as f64,
        grabber.backend()
    ));
    if let Ok(tail) = grabber.grab() {
        let _ = encoder.pad_to(elapsed, tail);
    }
    encoder.finish()
}

/// 其他平台的抓帧循环：xcap 抓整屏再裁选区。
#[cfg(not(windows))]
fn record_loop(
    rect: Option<RecordRect>,
    fps: u32,
    out: std::path::PathBuf,
    ffmpeg: String,
    _audio: Option<String>,
    _system: bool,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    seconds_limit: Option<f64>,
) -> Result<recorder::RecordingStats, String> {
    let monitors = xcap::Monitor::all().map_err(err)?;
    let monitor = monitors.into_iter().next().ok_or("没有检测到显示器")?;
    let started = std::time::Instant::now();

    let first = monitor.capture_image().map_err(err)?;
    let (screen_w, screen_h) = (first.width(), first.height());

    // libx264 的 yuv420p 不接受奇数宽高，选区统一收成偶数
    let crop = match rect {
        Some(r) => (
            r.x.min(screen_w.saturating_sub(2)),
            r.y.min(screen_h.saturating_sub(2)),
            (r.width.max(2)) & !1,
            (r.height.max(2)) & !1,
        ),
        None => (0, 0, screen_w & !1, screen_h & !1),
    };
    let (width, height) = (crop.2, crop.3);
    if width < 16 || height < 16 {
        return Err(format!("录制区域太小：{width}×{height}"));
    }

    let mut encoder = recorder::Encoder::start(&recorder::EncoderSpec {
        width,
        height,
        fps,
        out,
        ffmpeg,
        crf: 20,
        pix_fmt: "rgba",
        preset: "veryfast",
        codec: "libx264",
        audio: None,
        system_audio: None,
    })?;

    let started = std::time::Instant::now();
    let mut pending = Some(first);
    loop {
        if stop.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        if let Some(limit) = seconds_limit {
            // 时间与帧数双闸：补帧会让帧数偶尔超前节拍，只看时钟会实录超长
            let max_frames = (limit * fps as f64).round().max(1.0) as u64;
            if encoder.frames() >= max_frames || started.elapsed().as_secs_f64() >= limit {
                break;
            }
        }
        let t0 = std::time::Instant::now();
        let image = match pending.take() {
            Some(frame) => frame,
            None => monitor.capture_image().map_err(err)?,
        };
        let raw = image.into_raw();
        let frame = recorder::crop_rgba(&raw, screen_w, screen_h, crop.0, crop.1, width, height)?;
        encoder.note_grab(t0.elapsed());
        encoder.push_frame(&frame)?;
        pace_frame(&mut encoder, &frame, started, fps)?;
    }
    encoder.mark_end();
    encoder.finish()
}

/// FFmpeg 在哪：显式参数 → 环境变量 → 应用目录（含 sidecars/）→ PATH。
/// Windows 上大多数人不会把 ffmpeg 加进 PATH，所以把「和 exe 放一起」当作一等公民。
fn resolve_ffmpeg(explicit: Option<String>) -> String {
    if let Some(path) = explicit {
        if !path.trim().is_empty() {
            return path;
        }
    }
    if let Ok(path) = std::env::var("STILLFRAME_FFMPEG") {
        if !path.trim().is_empty() {
            return path;
        }
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.to_path_buf()))
    {
        for name in ["ffmpeg.exe", "ffmpeg", "sidecars/ffmpeg.exe", "binaries/ffmpeg.exe"] {
            let candidate = dir.join(name);
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }
    "ffmpeg".to_string()
}

#[tauri::command]
fn start_recording(
    rect: Option<RecordRect>,
    fps: Option<u32>,
    ffmpeg: Option<String>,
    mic: Option<bool>,
    system: Option<bool>,
) -> Result<String, String> {
    let mut slot = recording_slot().lock().map_err(err)?;
    if slot.is_some() {
        return Err("已经在录制，先结束当前这段".to_string());
    }
    let fps = fps.unwrap_or(30).clamp(5, 60);
    // 新的一段录像从空白标注开始：上一段画过的内容不能跟过来。
    clear_record_annotations();
    let out = recorder::recordings_dir().join(format!(
        "录屏-{}.mp4",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ));
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_out = out.clone();
    let ffmpeg_bin = resolve_ffmpeg(ffmpeg);
    // 麦克风默认不带：录进别人的声音不是小事，只有用户勾了才采。
    // 勾了但设备采不动（被占用 / 无权限）时静默退回纯画面，并在 backend 里看得出来。
    let audio = if mic.unwrap_or(false) {
        pick_microphone(&ffmpeg_bin).filter(|device| microphone_works(&ffmpeg_bin, device))
    } else {
        None
    };
    let handle = std::thread::spawn(move || {
        record_loop(
            rect,
            fps,
            thread_out,
            ffmpeg_bin,
            audio,
            system.unwrap_or(false),
            thread_stop,
            None,
        )
    });
    *slot = Some(Recording { stop, handle });
    Ok(out.to_string_lossy().to_string())
}

#[tauri::command]
fn stop_recording() -> Result<recorder::RecordingStats, String> {
    let recording = recording_slot().lock().map_err(err)?.take();
    let Some(rec) = recording else {
        return Err("当前没有在录制".to_string());
    };
    rec.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    rec.handle
        .join()
        .map_err(|_| "录制线程异常退出".to_string())?
}

/// 托盘是否真的建起来了。建不起来就不拦「关闭窗口」——否则用户关掉窗口后既没有托盘
/// 入口、也退不出去，程序会变成看不见的幽灵进程。
static TRAY_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 开机自启：写 HKCU 的 Run 键，登录后拉起快捷浮窗（--quick），不展开主窗。
const AUTOSTART_KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const AUTOSTART_VALUE: &str = "Stillframe";

#[derive(Serialize)]
struct AppInfo {
    version: String,
    platform: String,
    exe: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        exe: std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
    }
}

#[tauri::command]
fn autostart_enabled() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        match std::process::Command::new("reg")
            .args(["query", AUTOSTART_KEY, "/v", AUTOSTART_VALUE])
            // CREATE_NO_WINDOW：注册表查询别在用户面前闪一个黑框
            .creation_flags(0x0800_0000)
            .output()
        {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let status = if enabled {
            let exe = std::env::current_exe().map_err(err)?;
            let value = format!("\"{}\" --quick", exe.display());
            std::process::Command::new("reg")
                .args([
                    "add",
                    AUTOSTART_KEY,
                    "/v",
                    AUTOSTART_VALUE,
                    "/t",
                    "REG_SZ",
                    "/d",
                    &value,
                    "/f",
                ])
                .creation_flags(0x0800_0000)
                .status()
                .map_err(err)?
        } else {
            std::process::Command::new("reg")
                .args(["delete", AUTOSTART_KEY, "/v", AUTOSTART_VALUE, "/f"])
                .creation_flags(0x0800_0000)
                .status()
                .map_err(err)?
        };
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "{}开机自启失败（注册表退出码 {:?}）",
                if enabled { "写入" } else { "删除" },
                status.code()
            ))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("开机自启目前只支持 Windows".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 崩溃也要留证据：GUI 子系统没有控制台，panic 默认静默消失。
    // 把 panic 信息写进 boot 日志，出事时至少能查到哪一行炸的。
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}", loc.file(), loc.line()))
            .unwrap_or_else(|| "未知位置".to_string());
        log_line(&format!("[panic] {location} :: {info}"));
    }));

    // --autostart-probe=on|off：不开窗口，只读写一次开机自启并记日志，方便回归。
    if let Some(value) = std::env::args().find_map(|arg| {
        arg.strip_prefix("--autostart-probe=")
            .map(str::to_string)
    }) {
        let enable = value.trim() != "off";
        let set = set_autostart(enable);
        log_line(&format!(
            "[autostart-probe] set({enable}) => {set:?}；now={}",
            autostart_enabled()
        ));
        return;
    }

    // --record-probe=<路径>:<秒数>：不开窗口，直接跑一次录制做帧率标定。
    // GUI 子系统没有控制台，结果写到 <路径>.log，退出码 0/1 表示成败。
    if let Some(value) = std::env::args().find_map(|arg| arg.strip_prefix("--record-probe=").map(str::to_string)) {
        let (out, seconds) = match value.rsplit_once(':') {
            Some((path, secs)) => (path.to_string(), secs.parse::<f64>().unwrap_or(60.0)),
            None => (value, 60.0),
        };
        // 可选：--probe-rect=x,y,width,height —— 只录一块选区，量小面积的抓帧上限
        let probe_rect = std::env::args()
            .find_map(|arg| arg.strip_prefix("--probe-rect=").map(str::to_string))
            .and_then(|value| {
                let parts: Vec<u32> = value.split(',').filter_map(|s| s.trim().parse().ok()).collect();
                if parts.len() == 4 {
                    Some(RecordRect {
                        x: parts[0],
                        y: parts[1],
                        width: parts[2],
                        height: parts[3],
                    })
                } else {
                    None
                }
            });
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        // 可选：--probe-audio —— 同时采麦克风，验证音轨能不能进成片
        let probe_audio = std::env::args().any(|arg| arg == "--probe-audio");
        // 可选：--probe-system —— 同时采系统声（WASAPI 环回），验证系统声能不能进成片
        let probe_system = std::env::args().any(|arg| arg == "--probe-system");
        // 可选：--probe-annot=<json> —— 预置几条标注（坐标已归一化），验证标注能不能烧进成片
        clear_record_annotations();
        if let Some(path) = std::env::args().find_map(|arg| {
            arg.strip_prefix("--probe-annot=")
                .map(str::to_string)
        }) {
            #[cfg(windows)]
            {
                match std::fs::read_to_string(&path)
                    .map_err(err)
                    .and_then(|text| {
                        serde_json::from_str::<Vec<win_annot::RecAnnotation>>(&text)
                            .map_err(|e| format!("标注 JSON 读不懂：{e}"))
                    }) {
                    Ok(items) => {
                        if let Ok(mut list) = record_ann_slot().lock() {
                            *list = items;
                        }
                    }
                    Err(e) => log_line(&format!("[probe] 标注预置失败：{e}")),
                }
            }
            #[cfg(not(windows))]
            {
                let _ = path;
            }
        }
        let ffmpeg_bin = resolve_ffmpeg(None);
        let audio = if probe_audio {
            pick_microphone(&ffmpeg_bin).filter(|device| microphone_works(&ffmpeg_bin, device))
        } else {
            None
        };
        let result = record_loop(
            probe_rect,
            30,
            std::path::PathBuf::from(&out),
            ffmpeg_bin,
            audio,
            probe_system,
            stop,
            Some(seconds),
        );
        let report = match &result {
            Ok(stats) => format!(
                "OK path={} frames={} seconds={} fps={} dropped={} write_avg_ms={} grab_avg_ms={} repeats={} backend={}",
                stats.path,
                stats.frames,
                stats.seconds,
                stats.fps,
                stats.dropped,
                stats.write_avg_ms,
                stats.grab_avg_ms,
                stats.repeats,
                stats.backend
            ),
            Err(e) => format!("FAIL {e}"),
        };
        let _ = std::fs::write(format!("{out}.log"), report.as_bytes());
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }

    // --quick：只把快捷浮窗叫出来（可配合开机自启，日常不用展开主窗）。
    let start_quick = std::env::args().any(|arg| arg == "--quick");
    log_line(&format!("[boot] run start_quick={start_quick}"));
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            capture_window,
            read_tessdata,
            pin_image,
            save_png,
            write_shot,
            list_windows,
            hide_self,
            show_self,
            self_rect,
            scroll_at,
            start_recording,
            stop_recording,
            push_record_annotation,
            push_record_laser,
            undo_record_annotation,
            clear_record_annotation,
            open_quick,
            close_quick,
            quick_action,
            quick_main,
            app_info,
            autostart_enabled,
            set_autostart
        ])
        .on_window_event(|window, event| {
            // 关窗只收进托盘，不杀进程：抓屏、热键、录屏都要壳活着。
            // 托盘没建起来时不拦，让用户的「关闭」真的关掉。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let ready = TRAY_READY.load(std::sync::atomic::Ordering::Relaxed);
                log_line(&format!(
                    "[win] close label={} tray={ready}",
                    window.label()
                ));
                if window.label() == "main" && ready {
                    api.prevent_close();
                    match window.hide() {
                        Ok(()) => log_line("[win] 已收进托盘"),
                        Err(error) => log_line(&format!("[win] 隐藏失败：{error}")),
                    }
                    let _ = window
                        .app_handle()
                        .emit("stillframe://tray-hint", "窗口已收进托盘，右键托盘图标可以退出");
                }
            }
        })
        .setup(move |app| {
            log_line("[setup] begin");
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                for (shortcut, mode, keys, vk) in shortcuts() {
                    // 插件被占用时不一定报错，所以先自己探：探不到就直接记账，别再指望返回值。
                    if !hotkey_available(vk) {
                        log_line(&format!("[hotkey] {keys} -> {mode} 已被其他程序占用"));
                        let _ = app
                            .handle()
                            .emit("stillframe://shortcut-failed", format!("{mode}|{keys}"));
                        continue;
                    }
                    let handle = app.handle().clone();
                    // 快捷键可能被别的截图工具（QQ/微信）先注册：注册失败只提示，不让整个壳起不来。
                    let result = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            // 前端监听 "stillframe://shortcut" 决定是直接开拍还是先显示窗口。
                            let _ = handle.emit("stillframe://shortcut", mode);
                        }
                    });
                    if let Err(err) = result {
                        log_line(&format!("[hotkey] {keys} -> {mode} 注册失败：{err}"));
                        // 静默失败等于骗人：把「哪组键没抢到」明确告诉界面。
                        let _ = app
                            .handle()
                            .emit("stillframe://shortcut-failed", format!("{mode}|{keys}"));
                    }
                }

                // Ctrl+Alt+Q 只负责叫出/收起快捷浮窗：作为主窗最小化时的常驻入口。
                if !hotkey_available(0x51) {
                    log_line("[hotkey] Ctrl+Alt+Q -> quick 已被其他程序占用");
                    let _ = app
                        .handle()
                        .emit("stillframe://shortcut-failed", "quick|Ctrl+Alt+Q");
                } else {
                    let quick_handle = app.handle().clone();
                    let quick_shortcut =
                        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyQ);
                    let quick_result = app.global_shortcut().on_shortcut(
                        quick_shortcut,
                        move |_app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                toggle_quick(&quick_handle);
                            }
                        },
                    );
                    if let Err(err) = quick_result {
                        log_line(&format!("[hotkey] Ctrl+Alt+Q -> quick 注册失败：{err}"));
                        let _ = app
                            .handle()
                            .emit("stillframe://shortcut-failed", "quick|Ctrl+Alt+Q");
                    }
                }
                log_line("[hotkey] 主键表注册完毕");
            }
            let _ = app.get_webview_window("main");
            log_line(&format!("[boot] start_quick={start_quick}"));
            if start_quick {
                if let Err(error) = show_quick(app.handle()) {
                    log_line(&format!("[quick] --quick 启动失败：{error}"));
                    eprintln!("[stillframe] --quick 启动失败：{error}");
                }
            }

            // 托盘常驻：关窗不退出，左键点托盘或菜单「显示主窗口」都回到界面。
            // 放到独立线程建：某些远程会话 / 无任务栏环境里托盘初始化会卡住系统调用，
            // 卡在 setup 里就会让主窗永远不出来。建不起来就退化成「关窗即退出」。
            #[cfg(desktop)]
            {
                let tray_handle = app.handle().clone();
                std::thread::spawn(move || {
                    use tauri::menu::{Menu, MenuItem};
                    use tauri::tray::{
                        MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent,
                    };

                    // 这句要留：没有它，日志里看不到托盘线程是没跑到，还是卡在系统调用。
                    log_line("[tray] 开始构建");
                    let started = std::time::Instant::now();

                    let tray = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                        || -> Result<(), String> {
                            let app = &tray_handle;
                            let show_item =
                                MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)
                                    .map_err(err)?;
                            let snap_item =
                                MenuItem::with_id(app, "tray-snap", "截一张", true, None::<&str>)
                                    .map_err(err)?;
                            let quick_item =
                                MenuItem::with_id(app, "tray-quick", "快捷浮窗", true, None::<&str>)
                                    .map_err(err)?;
                            let quit_item =
                                MenuItem::with_id(app, "tray-quit", "退出 定格", true, None::<&str>)
                                    .map_err(err)?;
                            let menu = Menu::with_items(
                                app,
                                &[&show_item, &snap_item, &quick_item, &quit_item],
                            )
                            .map_err(err)?;
                            let icon = app
                                .default_window_icon()
                                .cloned()
                                .ok_or("缺少应用图标，托盘图标无从取")?;

                            let tray = TrayIconBuilder::with_id("stillframe-tray")
                                .icon(icon)
                                .tooltip("定格 Stillframe")
                                .menu(&menu)
                                .show_menu_on_left_click(false)
                                .on_menu_event(|app, event| match event.id().as_ref() {
                                    "tray-show" => {
                                        if let Some(win) = app.get_webview_window("main") {
                                            let _ = win.show();
                                            let _ = win.unminimize();
                                            let _ = win.set_focus();
                                        }
                                    }
                                    // 托盘里点「截一张」：和全局热键同一条事件，前端自己开始拍
                                    "tray-snap" => {
                                        let _ = app.emit("stillframe://shortcut", "snap");
                                    }
                                    "tray-quick" => {
                                        if let Err(error) = show_quick(app) {
                                            log_line(&format!("[tray] 快捷浮窗失败：{error}"));
                                        }
                                    }
                                    "tray-quit" => app.exit(0),
                                    _ => {}
                                })
                                .on_tray_icon_event(|tray, event| {
                                    if let TrayIconEvent::Click {
                                        button: MouseButton::Left,
                                        button_state: MouseButtonState::Up,
                                        ..
                                    } = event
                                    {
                                        let app = tray.app_handle();
                                        if let Some(win) = app.get_webview_window("main") {
                                            let _ = win.show();
                                            let _ = win.unminimize();
                                            let _ = win.set_focus();
                                        }
                                    }
                                })
                                .build(app)
                                .map_err(err)?;
                            // 托盘图标要活到进程结束：交给进程生命周期，不随函数栈回收
                            std::mem::forget(tray);
                            Ok(())
                        },
                    ));

                    match tray {
                        Ok(Ok(())) => {
                            TRAY_READY.store(true, std::sync::atomic::Ordering::Relaxed);
                            log_line(&format!(
                                "[tray] 已就绪（{}ms）：关窗收进托盘",
                                started.elapsed().as_millis()
                            ));
                        }
                        Ok(Err(error)) => log_line(&format!(
                            "[tray] 建不起来（{}ms）：{error}；关窗即退出",
                            started.elapsed().as_millis()
                        )),
                        Err(_) => log_line("[tray] 构建时崩溃，已跳过；关窗即退出"),
                    }
                });
            }
            Ok(())
        });
    builder
        .run(tauri::generate_context!())
        .expect("启动 Stillframe 桌面壳失败");
}
