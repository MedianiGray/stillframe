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
            write_shot,
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
            }
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Stillframe 桌面壳失败");
}
