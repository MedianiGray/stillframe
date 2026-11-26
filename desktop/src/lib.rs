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

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// GUI 子系统没有控制台，eprintln 看不见；把关键诊断落到临时目录，方便现场排查。
fn log_line(message: &str) {
    use std::io::Write;
    let path = std::path::PathBuf::from("C:\\Users\\35342\\AppData\\Local\\Temp\\stillframe-boot.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{message}");
    }
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

/// 截图前把自己藏起来，避免把 Stillframe 自己拍进画面。
#[tauri::command]
fn hide_self(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(err)
}

/// 拍完再露出来。
#[tauri::command]
fn show_self(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(err)?;
    window.set_focus().map_err(err)
}

/// 一档滚轮的 delta 值（Windows 的 WHEEL_DELTA）。
const WHEEL_DELTA: i32 = 120;

/// 把界面传来的「档数」折算成 SendInput 需要的 delta，并夹在 ±20 档内，
/// 避免一次注入把目标窗口甩出太远、重叠区不够。
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

fn shortcuts() -> Vec<(Shortcut, &'static str)> {
    vec![
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS),
            "snap",
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR),
            "record",
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyC),
            "scroll",
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyO),
            "ocr",
        ),
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyF),
            "translate",
        ),
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // --quick：只把快捷浮窗叫出来（可配合开机自启，日常不用展开主窗）。
    let start_quick = std::env::args().any(|arg| arg == "--quick");
    log_line(&format!("[boot] run start_quick={start_quick}"));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            pin_image,
            save_png,
            write_shot,
            list_windows,
            hide_self,
            show_self,
            scroll_at,
            open_quick,
            close_quick,
            quick_action,
            quick_main
        ])
        .setup(move |app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                for (shortcut, mode) in shortcuts() {
                    let handle = app.handle().clone();
                    // 快捷键可能被别的截图工具（QQ/微信）先注册：注册失败只提示，不让整个壳起不来。
                    let result = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            // 前端监听 "stillframe://shortcut" 决定是直接开拍还是先显示窗口。
                            let _ = handle.emit("stillframe://shortcut", mode);
                        }
                    });
                    if let Err(err) = result {
                        eprintln!("[stillframe] 快捷键 {mode} 注册失败：{err}");
                    }
                }

                // Ctrl+Alt+Q 只负责叫出/收起快捷浮窗：作为主窗最小化时的常驻入口。
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
                    eprintln!("[stillframe] 快捷键 quick 注册失败：{err}");
                }
            }
            let _ = app.get_webview_window("main");
            log_line(&format!("[boot] start_quick={start_quick}"));
            if start_quick {
                if let Err(error) = show_quick(app.handle()) {
                    log_line(&format!("[quick] --quick 启动失败：{error}"));
                    eprintln!("[stillframe] --quick 启动失败：{error}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Stillframe 桌面壳失败");
}
