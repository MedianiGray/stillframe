//! 桌面壳：把网页端那套 UI 装进系统里，补上浏览器给不了的能力。
//!
//! 契约见 docs/ARCHITECTURE.md：前端只调四个命令
//! `capture_screen` / `pin_image` / `save_png` / `list_windows`，
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
#[tauri::command]
async fn pin_image(app: AppHandle, data_url: String) -> Result<(), String> {
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
        .inner_size(600.0, 500.0)
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
            id: window.id(),
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            pin_image,
            save_png,
            list_windows,
            hide_self,
            show_self
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                for (shortcut, mode) in shortcuts() {
                    let handle = app.handle().clone();
                    app.global_shortcut()
                        .on_shortcut(shortcut, move |_app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                // 前端监听 "stillframe://shortcut" 决定是直接开拍还是先显示窗口。
                                let _ = handle.emit("stillframe://shortcut", mode);
                            }
                        })?;
                }
            }
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Stillframe 桌面壳失败");
}
