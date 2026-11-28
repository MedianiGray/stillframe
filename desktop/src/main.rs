#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 单实例：一台机器只留一个定格窗口，第二次双击图标时把已有窗口叫回前台再退出。
/// 用命名互斥体判断，不引第三方插件；互斥体随进程退出自动释放。
#[cfg(windows)]
fn already_running() -> bool {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    unsafe {
        if CreateMutexW(None, true, w!("Local\\stillframe-desktop")).is_err() {
            // 连互斥体都建不出来时不要拦着用户，照常启动
            return false;
        }
        if GetLastError() != ERROR_ALREADY_EXISTS {
            return false;
        }
        // 已有实例：把它的主窗叫到前台，用户看起来就是「点了就出来」
        if let Ok(hwnd) = FindWindowW(PCWSTR::null(), w!("Stillframe / 定格")) {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
        true
    }
}

fn main() {
    // 自检入口（--record-probe / --autostart-probe / --displays-probe）不是给人用的窗口，
    // 不受单实例限制：主程序开着时也能跑，否则 CI / 脚本会静默什么都不做
    let probe = std::env::args().any(|arg| {
        arg.starts_with("--record-probe")
            || arg.starts_with("--autostart-probe")
            || arg.starts_with("--displays-probe")
            || arg.starts_with("--capture-probe")
            || arg.starts_with("--overlay-probe")
    });
    #[cfg(windows)]
    if !probe && already_running() {
        return;
    }
    let _ = probe;
    stillframe_lib::run();
}
