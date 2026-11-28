//! Windows 专用抓帧器：绕开 xcap 那层封装。
//!
//! 实测（1920×1080，本机）：`xcap::Monitor::capture_image()` 每帧约 256ms（≈3.9fps），
//! 而 `BitBlt` + `GetDIBits` 合计约 35ms。差距不在硬件，在封装：每帧重建 DC、
//! 再做一次全尺寸格式转换。这里改成「一次建好、每帧只 BitBlt」：
//!
//! - `CreateDIBSection` 直接给出可写的像素缓冲（top-down、32 位 BGRA），
//!   BitBlt 之后像素就在那块内存里，省掉 `GetDIBits` 的整帧拷贝；
//! - 源区域直接按选区取，小选区比全屏更快，且不用抓完再裁；
//! - 进程先声明 per-monitor DPI aware，否则 125% 缩放下拿到的是被裁过的逻辑尺寸。

use std::ffi::c_void;

use windows::core::Interface as _;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_9_1,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIOutput, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
    DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY,
    HDC, HBITMAP,
};
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// 只调一次：进程级 DPI 感知。Tauri 正常启动时自己会设，但 `--record-probe`
/// 不进 Tauri 那条路，得在这里补上，否则抓到的画面是按缩放后的逻辑尺寸裁的。
pub fn ensure_dpi_aware() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    });
}

/// 主屏物理像素尺寸。
pub fn screen_size() -> (u32, u32) {
    ensure_dpi_aware();
    unsafe {
        let w = GetSystemMetrics(SM_CXSCREEN).max(1) as u32;
        let h = GetSystemMetrics(SM_CYSCREEN).max(1) as u32;
        (w, h)
    }
}

/// 虚拟桌面：多屏拼接后的大矩形，原点可能在负坐标（副屏摆到主屏左侧时）。
/// 所有屏幕绝对坐标都落在这个矩形里，是抓帧与选区换算的统一基准。
pub fn virtual_screen() -> (i32, i32, u32, u32) {
    ensure_dpi_aware();
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) as u32;
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) as u32;
        (x, y, w, h)
    }
}

pub struct TimerResolution;

impl TimerResolution {
    /// 把系统定时器精度提到 1ms。Windows 默认定时器粒度是 15.6ms，
    /// 录制循环里 `sleep(33ms)` 会被拉长到 46ms，帧率直接卡在 20 出头（实测 25.1fps）。
    pub fn new() -> Self {
        unsafe {
            let _ = timeBeginPeriod(1);
        }
        Self
    }
}

impl Drop for TimerResolution {
    fn drop(&mut self) {
        unsafe {
            let _ = timeEndPeriod(1);
        }
    }
}

pub struct ScreenGrabber {
    screen: HDC,
    mem: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
    bits: *mut u8,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    /// 虚拟桌面原点。`GetDC(None)` 的 DC 覆盖整块虚拟桌面，其 (0,0) 就是这里，
    /// 所以 BitBlt 的源坐标要减去它——副屏摆在主屏左侧时 x 为负，这一步不能省。
    vx: i32,
    vy: i32,
}

impl ScreenGrabber {
    /// 抓虚拟桌面上 `(x, y, width, height)` 这块（绝对坐标，可为负），宽高按偶数收。
    pub fn new(x: i32, y: i32, width: u32, height: u32) -> Result<Self, String> {
        ensure_dpi_aware();
        let (vx, vy, vw, vh) = virtual_screen();
        let x = x.max(vx).min(vx + vw as i32 - 2);
        let y = y.max(vy).min(vy + vh as i32 - 2);
        let width = (width.max(2) & !1).min((vx + vw as i32 - x) as u32 & !1);
        let height = (height.max(2) & !1).min((vy + vh as i32 - y) as u32 & !1);

        let mut grabber = Self {
            screen: HDC::default(),
            mem: HDC::default(),
            bitmap: HBITMAP::default(),
            old: HGDIOBJ(std::ptr::null_mut()),
            bits: std::ptr::null_mut(),
            width,
            height,
            x,
            y,
            vx,
            vy,
        };
        grabber.open()?;
        Ok(grabber)
    }

    /// 建 DC 与 DIB 缓冲。首次创建和「句柄失效后重建」走同一段代码。
    fn open(&mut self) -> Result<(), String> {
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return Err("拿不到屏幕 DC".to_string());
            }
            let mem = CreateCompatibleDC(Some(screen));
            if mem.is_invalid() {
                let _ = ReleaseDC(None, screen);
                return Err("创建内存 DC 失败".to_string());
            }

            let mut info = BITMAPINFO::default();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = self.width as i32;
            // 负高度 = top-down：像素按行从上到下，写 FFmpeg 时不用翻转
            info.bmiHeader.biHeight = -(self.height as i32);
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB.0;

            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = match CreateDIBSection(Some(mem), &info, DIB_RGB_COLORS, &mut bits, None, 0)
            {
                Ok(bitmap) if !bitmap.is_invalid() && !bits.is_null() => bitmap,
                _ => {
                    let _ = DeleteDC(mem);
                    let _ = ReleaseDC(None, screen);
                    return Err("CreateDIBSection 失败".to_string());
                }
            };
            let old = SelectObject(mem, HGDIOBJ(bitmap.0));
            self.old = old;
            self.screen = screen;
            self.mem = mem;
            self.bitmap = bitmap;
            self.bits = bits as *mut u8;
            Ok(())
        }
    }

    /// 释放 GDI 资源并把句柄置为无效，避免 Drop 二次释放。
    fn close(&mut self) {
        unsafe {
            if !self.bitmap.is_invalid() && !self.mem.is_invalid() {
                let _ = SelectObject(self.mem, self.old);
                let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
            }
            if !self.mem.is_invalid() {
                let _ = DeleteDC(self.mem);
            }
            if !self.screen.is_invalid() {
                let _ = ReleaseDC(None, self.screen);
            }
        }
        self.screen = HDC::default();
        self.mem = HDC::default();
        self.bitmap = HBITMAP::default();
        self.old = HGDIOBJ(std::ptr::null_mut());
        self.bits = std::ptr::null_mut();
    }

    fn blt(&self) -> Result<(), String> {
        unsafe {
            BitBlt(
                self.mem,
                0,
                0,
                self.width as i32,
                self.height as i32,
                Some(self.screen),
                self.x - self.vx,
                self.y - self.vy,
                SRCCOPY,
            )
            .map_err(|e| format!("BitBlt 失败：{e}"))
        }
    }

    /// BitBlt 一帧，返回 BGRA 像素（借自 DIB 缓冲，长度 = 宽 × 高 × 4）。
    ///
    /// 句柄会在显示模式切换、锁屏、远程会话重连时失效（实测 46 秒时踩到一次）；
    /// 失效就重建 DC 再抓这一帧，不让整段录制断在这里。
    pub fn grab(&mut self) -> Result<&[u8], String> {
        if let Err(first) = self.blt() {
            self.close();
            self.open()
                .map_err(|rebuild| format!("{first}；重建抓帧器失败：{rebuild}"))?;
            self.blt()?;
        }
        Ok(unsafe {
            std::slice::from_raw_parts(
                self.bits as *const u8,
                (self.width as usize) * (self.height as usize) * 4,
            )
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }
}

impl Drop for ScreenGrabber {
    fn drop(&mut self) {
        self.close();
    }
}

/// DXGI Desktop Duplication 抓帧：直接从桌面合成器拿帧。
///
/// BitBlt 在这类远程会话里每帧要 40–50ms（走 RDP 图形重定向），DXGI 只做一次
/// GPU→CPU 拷贝，通常个位数毫秒。拿不到（旧显卡 / 会话不支持 / 驱动拒绝）就回退 BitBlt。
struct DxgiGrabber {
    context: ID3D11DeviceContext,
    dup: IDXGIOutputDuplication,
    staging: ID3D11Texture2D,
    staging_resource: ID3D11Resource,
    screen_w: u32,
    screen_h: u32,
    whole: Vec<u8>,
    out: Vec<u8>,
    ready: bool,
    crop_x: u32,
    crop_y: u32,
    crop_w: u32,
    crop_h: u32,
    _device: ID3D11Device,
}

impl DxgiGrabber {
    fn new(x: i32, y: i32, width: u32, height: u32) -> Result<Self, String> {
        unsafe {
            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            let mut level = D3D_FEATURE_LEVEL_9_1;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_9_1]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                Some(&mut level),
                Some(&mut context),
            )
            .map_err(|e| format!("D3D11 设备创建失败：{e}"))?;
            let device = device.ok_or("D3D11 设备为空")?;
            let context = context.ok_or("D3D11 上下文为空")?;

            let dxgi: IDXGIDevice = device.cast().map_err(|e| format!("转 IDXGIDevice 失败：{e}"))?;
            let adapter = dxgi.GetAdapter().map_err(|e| format!("取适配器失败：{e}"))?;

            // 按选区的起点挑输出：多屏时 EnumOutputs(0) 只有主屏，录副屏会取错画面。
            // 输出坐标是虚拟桌面物理坐标，正好和 ScreenGrabber 用同一套基准。
            let mut chosen: Option<(IDXGIOutput, windows::Win32::Foundation::RECT)> = None;
            let mut index = 0u32;
            loop {
                let output = match adapter.EnumOutputs(index) {
                    Ok(output) => output,
                    Err(_) => break,
                };
                let desc = match output.GetDesc() {
                    Ok(desc) => desc,
                    Err(_) => break,
                };
                let rect = desc.DesktopCoordinates;
                let inside = x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
                if inside {
                    chosen = Some((output, rect));
                    break;
                }
                index += 1;
            }
            let (output, rect) = match chosen {
                Some(pair) => pair,
                None => {
                    // 选区起点不落在任何输出里（多为屏幕间缝隙）：退回主输出，别整段录不了。
                    let output = adapter
                        .EnumOutputs(0)
                        .map_err(|e| format!("取主输出失败：{e}"))?;
                    let desc = output.GetDesc().map_err(|e| format!("读输出信息失败：{e}"))?;
                    (output, desc.DesktopCoordinates)
                }
            };
            let output1: IDXGIOutput1 = output.cast().map_err(|e| format!("转 IDXGIOutput1 失败：{e}"))?;
            let dup = output1
                .DuplicateOutput(&device)
                .map_err(|e| format!("DuplicateOutput 失败：{e}"))?;

            // 纹理尺寸取这块输出自己的尺寸，而不是主屏的。
            let screen_w = (rect.right - rect.left).max(2) as u32;
            let screen_h = (rect.bottom - rect.top).max(2) as u32;
            let crop_x = ((x - rect.left).max(0) as u32).min(screen_w.saturating_sub(2));
            let crop_y = ((y - rect.top).max(0) as u32).min(screen_h.saturating_sub(2));

            let desc = D3D11_TEXTURE2D_DESC {
                Width: screen_w,
                Height: screen_h,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut staging_opt: Option<ID3D11Texture2D> = None;
            device
                .CreateTexture2D(&desc, None, Some(&mut staging_opt))
                .map_err(|e| format!("建 staging 纹理失败：{e}"))?;
            let staging = staging_opt.ok_or("staging 纹理为空")?;
            let staging_resource: ID3D11Resource = staging
                .cast()
                .map_err(|e| format!("转 ID3D11Resource 失败：{e}"))?;

            let crop_w = (width.max(2) & !1).min(screen_w - crop_x);
            let crop_h = (height.max(2) & !1).min(screen_h - crop_y);

            Ok(Self {
                context,
                dup,
                staging,
                staging_resource,
                screen_w,
                screen_h,
                whole: vec![0u8; (screen_w as usize) * (screen_h as usize) * 4],
                out: vec![0u8; (crop_w as usize) * (crop_h as usize) * 4],
                ready: false,
                crop_x,
                crop_y,
                crop_w,
                crop_h,
                _device: device,
            })
        }
    }

    /// 拉一次帧。桌面没变化时 Duplication 不给新帧（超时），此时沿用上一帧——
    /// 录制必须每拍都有画面，静止画面也要照常出帧。
    fn pump(&mut self) -> Result<(), String> {
        unsafe {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            // 超时给 2ms：我们只是「看看有没有新帧」，没有就沿用上一帧，
            // 没必要在这里干等 20ms——那会直接压低整段录制的帧率。
            if self
                .dup
                .AcquireNextFrame(2, &mut info, &mut resource)
                .is_err()
            {
                return Ok(());
            }
            let released = (|| -> Result<(), String> {
                let tex: ID3D11Texture2D = match resource {
                    Some(res) => res.cast().map_err(|e| format!("转纹理失败：{e}"))?,
                    None => return Ok(()),
                };
                let src: ID3D11Resource = tex.cast().map_err(|e| format!("转资源失败：{e}"))?;
                self.context.CopyResource(&self.staging_resource, &src);
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                self.context
                    .Map(
                        &self.staging_resource,
                        0,
                        D3D11_MAP_READ,
                        0,
                        Some(&mut mapped),
                    )
                    .map_err(|e| format!("Map 失败：{e}"))?;
                let pitch = mapped.RowPitch as usize;
                let dst_row = (self.screen_w as usize) * 4;
                for row in 0..self.screen_h as usize {
                    let src_ptr = (mapped.pData as *const u8).add(row * pitch);
                    std::ptr::copy_nonoverlapping(
                        src_ptr,
                        self.whole.as_mut_ptr().add(row * dst_row),
                        dst_row,
                    );
                }
                self.context.Unmap(&self.staging_resource, 0);
                Ok(())
            })();
            let _ = self.dup.ReleaseFrame();
            released?;
            self.ready = true;
            Ok(())
        }
    }

    fn grab(&mut self) -> Result<&[u8], String> {
        self.pump()?;
        if !self.ready {
            return Err("DXGI 还没拿到第一帧".to_string());
        }
        let full_row = (self.screen_w as usize) * 4;
        let out_row = (self.crop_w as usize) * 4;
        for row in 0..self.crop_h as usize {
            let src_off = (self.crop_y as usize + row) * full_row + (self.crop_x as usize) * 4;
            let dst_off = row * out_row;
            self.out[dst_off..dst_off + out_row]
                .copy_from_slice(&self.whole[src_off..src_off + out_row]);
        }
        Ok(&self.out)
    }
}

/// 抓帧门面：优先 DXGI，不可用则回退 BitBlt。两条路径对外都是「选区 BGRA」。
pub struct FrameGrabber {
    backend: Backend,
    width: u32,
    height: u32,
}

enum Backend {
    Dxgi(DxgiGrabber),
    Gdi(ScreenGrabber),
}

impl FrameGrabber {
    pub fn new(x: i32, y: i32, width: u32, height: u32) -> Result<Self, String> {
        ensure_dpi_aware();
        // 选区按虚拟桌面收口：多屏时绝对坐标可能为负，不能再用主屏的 0..w/h 去夹。
        let (vx, vy, vw, vh) = virtual_screen();
        let cx = x.max(vx).min(vx + vw as i32 - 2);
        let cy = y.max(vy).min(vy + vh as i32 - 2);
        let cw = (width.max(2) & !1).min((vx + vw as i32 - cx) as u32 & !1);
        let ch = (height.max(2) & !1).min((vy + vh as i32 - cy) as u32 & !1);

        // 先试 DXGI；能建起来就用它，建不起来退回 BitBlt，不给用户报错。
        let backend = match DxgiGrabber::new(cx, cy, cw, ch) {
            Ok(grabber) => Backend::Dxgi(grabber),
            Err(_) => Backend::Gdi(ScreenGrabber::new(cx, cy, cw, ch)?),
        };
        Ok(Self {
            backend,
            width: cw,
            height: ch,
        })
    }

    /// 本次录制实际走的抓帧后端：`dxgi` 或 `gdi`，标定时要能一眼看出来。
    pub fn backend(&self) -> &'static str {
        match self.backend {
            Backend::Dxgi(_) => "dxgi",
            Backend::Gdi(_) => "gdi",
        }
    }

    pub fn grab(&mut self) -> Result<&[u8], String> {
        match &mut self.backend {
            Backend::Dxgi(grabber) => grabber.grab(),
            Backend::Gdi(grabber) => grabber.grab(),
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }
}
