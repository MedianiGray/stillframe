//! 录屏标注烧进成片。
//!
//! 抓帧器交出来的是 BGRA 像素，正好能直接 memcpy 进 32 位 DIB；于是每帧先把画面
//! 拷进 DIB，再用 GDI 画线、箭头、文字，最后把 DIB 的像素交给编码器。
//! 没有任何标注活动时整段跳过，不增加拷贝开销。
//!
//! 取舍：GDI 没有抗锯齿，线条比 QQ 的 Direct2D 略硬——先保证「标注真的进了成片」，
//! 平滑留给后续换绘制后端。坐标从前端过来是归一化的 0..1，按帧尺寸换算。

#![cfg(windows)]
// GDI 的线 / 多边形 / 文字调用都返回 BOOL，绘制出不出得来只看像素，
// 这里不逐条判返回值（成片是最终裁判），统一豁免这个 lint。
#![allow(unused_must_use)]

use windows::core::HSTRING;
use windows::Win32::Foundation::{COLORREF, POINT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, CreatePen, CreateSolidBrush, DeleteDC,
    DeleteObject, Polygon, Polyline, SelectObject, SetBkMode, SetTextColor, TextOutW, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP, HDC, HFONT, ANTIALIASED_QUALITY,
    CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, OUT_TT_PRECIS, PS_SOLID, TRANSPARENT,
};

/// 一条录屏标注。坐标、线宽、字号都由前端归一化（除以选区宽），
/// 后端按帧尺寸乘回来，DPI 缩放与非整数缩放都不用额外换算。
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecAnnotation {
    /// rect / ellipse / arrow / pen / text
    pub kind: String,
    #[serde(default)]
    pub color: Option<String>,
    /// 线宽，归一化（线宽 / 选区宽）。
    #[serde(default)]
    pub width: Option<f32>,
    /// 出现时刻（相对录制开始的毫秒）。
    pub at_ms: f64,
    #[serde(default)]
    pub points: Option<Vec<[f32; 2]>>,
    #[serde(default)]
    pub a: Option<[f32; 2]>,
    #[serde(default)]
    pub b: Option<[f32; 2]>,
    #[serde(default)]
    pub pos: Option<[f32; 2]>,
    #[serde(default)]
    pub text: Option<String>,
    /// 字号，归一化（字号 / 选区宽）。
    #[serde(default)]
    pub size: Option<f32>,
}

/// 激光笔的一个点，只留最近一小段时间，画成渐隐的红点。
#[derive(Clone)]
pub struct LaserPoint {
    pub x: f32,
    pub y: f32,
    pub at_ms: f64,
}

/// 激光残影保留时长。
const LASER_TAIL_MS: f64 = 1200.0;

/// 离屏画布：一块 DIB + 一个内存 DC，绘制完像素直接在 `bits` 上。
pub struct Layer {
    dc: HDC,
    bitmap: HBITMAP,
    bits: *mut u32,
    width: i32,
    height: i32,
    font: HFONT,
    font_size: i32,
}

impl Layer {
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        let (width, height) = (width as i32, height as i32);
        let dc = unsafe { CreateCompatibleDC(None) };
        if dc.is_invalid() {
            return Err("建不出内存 DC".to_string());
        }
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // 负高度 = top-down，和抓帧缓冲的方向一致
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0, // BI_RGB
            biSizeImage: (width * height * 4) as u32,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let bitmap = unsafe { CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) }
            .map_err(|e| format!("建 DIB 失败：{e}"))?;
        unsafe {
            SelectObject(dc, bitmap.into());
        }
        Ok(Self {
            dc,
            bitmap,
            bits: bits as *mut u32,
            width,
            height,
            font: HFONT::default(),
            font_size: 0,
        })
    }

    /// 把这一帧的画面拷进 DIB，之后所有绘制都在这块像素上。
    fn load(&mut self, frame: &[u8]) {
        let len = (self.width * self.height * 4) as usize;
        if frame.len() < len {
            return;
        }
        unsafe {
            std::ptr::copy_nonoverlapping(frame.as_ptr(), self.bits as *mut u8, len);
        }
    }

    /// 合成一帧：画面 + 所有已出现且未撤销的标注 + 激光残影。
    pub fn draw(&mut self, frame: &[u8], anns: &[RecAnnotation], laser: &[LaserPoint], now_ms: f64) {
        self.load(frame);
        for item in anns {
            if item.at_ms > now_ms {
                continue;
            }
            self.paint(item);
        }
        self.paint_laser(laser, now_ms);
        unsafe {
            windows::Win32::Graphics::Gdi::GdiFlush();
        }
    }

    pub fn pixels(&self) -> &[u8] {
        let len = (self.width * self.height * 4) as usize;
        unsafe { std::slice::from_raw_parts(self.bits as *const u8, len) }
    }

    /// 归一化长度（线宽、字号都按选区宽归一化）换算成帧像素。
    fn norm_px(&self, value: f32) -> f32 {
        value * self.width as f32
    }

    fn px(&self, p: [f32; 2]) -> POINT {
        POINT {
            x: (p[0].clamp(0.0, 1.0) * self.width as f32).round() as i32,
            y: (p[1].clamp(0.0, 1.0) * self.height as f32).round() as i32,
        }
    }

    fn paint(&mut self, item: &RecAnnotation) {
        let color = color_ref(item.color.as_deref().unwrap_or("#FB3838"));
        let width_px = self.norm_px(item.width.unwrap_or(0.003)).max(1.0).round() as i32;
        let pen = unsafe { CreatePen(PS_SOLID, width_px, color) };
        let old = unsafe { SelectObject(self.dc, pen.into()) };
        match item.kind.as_str() {
            "rect" => {
                if let (Some(a), Some(b)) = (item.a, item.b) {
                    let pa = self.px(a);
                    let pb = self.px(b);
                    let box_pts = [
                        POINT { x: pa.x, y: pa.y },
                        POINT { x: pb.x, y: pa.y },
                        POINT { x: pb.x, y: pb.y },
                        POINT { x: pa.x, y: pb.y },
                        POINT { x: pa.x, y: pa.y },
                    ];
                    unsafe {
                        Polyline(self.dc, &box_pts);
                    }
                }
            }
            "ellipse" => {
                if let (Some(a), Some(b)) = (item.a, item.b) {
                    let pa = self.px(a);
                    let pb = self.px(b);
                    let (cx, cy) = ((pa.x + pb.x) as f32 / 2.0, (pa.y + pb.y) as f32 / 2.0);
                    let (rx, ry) = (
                        (pb.x - pa.x).abs() as f32 / 2.0,
                        (pb.y - pa.y).abs() as f32 / 2.0,
                    );
                    let mut pts = Vec::with_capacity(49);
                    for step in 0..=48 {
                        let angle = step as f32 / 48.0 * std::f32::consts::PI * 2.0;
                        pts.push(POINT {
                            x: (cx + rx * angle.cos()).round() as i32,
                            y: (cy + ry * angle.sin()).round() as i32,
                        });
                    }
                    unsafe {
                        Polyline(self.dc, &pts);
                    }
                }
            }
            "arrow" => {
                if let (Some(a), Some(b)) = (item.a, item.b) {
                    let pa = self.px(a);
                    let pb = self.px(b);
                    let line = [pa, pb];
                    unsafe {
                        Polyline(self.dc, &line);
                    }
                    // 实心三角箭头：GDI 里只能靠刷子填充多边形
                    let angle = ((pb.y - pa.y) as f32).atan2((pb.x - pa.x) as f32);
                    let head = (width_px as f32 * 3.4).max(10.0);
                    let spread = std::f32::consts::PI / 7.0;
                    let tri = [
                        pb,
                        POINT {
                            x: (pb.x as f32 - head * (angle - spread).cos()).round() as i32,
                            y: (pb.y as f32 - head * (angle - spread).sin()).round() as i32,
                        },
                        POINT {
                            x: (pb.x as f32 - head * (angle + spread).cos()).round() as i32,
                            y: (pb.y as f32 - head * (angle + spread).sin()).round() as i32,
                        },
                    ];
                    let brush = unsafe { CreateSolidBrush(color) };
                    let old_brush = unsafe { SelectObject(self.dc, brush.into()) };
                    unsafe {
                        Polygon(self.dc, &tri);
                    }
                    unsafe {
                        SelectObject(self.dc, old_brush);
                        DeleteObject(brush.into());
                    }
                }
            }
            "pen" => {
                if let Some(points) = item.points.as_ref() {
                    if points.len() > 1 {
                        let pts: Vec<POINT> = points.iter().map(|p| self.px(*p)).collect();
                        unsafe {
                            Polyline(self.dc, &pts);
                        }
                    }
                }
            }
            "text" => {
                if let (Some(pos), Some(text)) = (item.pos, item.text.as_deref()) {
                    self.paint_text(pos, text, color, item.size.unwrap_or(0.014));
                }
            }
            _ => {}
        }
        unsafe {
            SelectObject(self.dc, old);
            DeleteObject(pen.into());
        }
    }

    fn paint_text(&mut self, pos: [f32; 2], text: &str, color: COLORREF, size_norm: f32) {
        let size_px = self.norm_px(size_norm).max(8.0).round() as i32;
        if self.font.is_invalid() || self.font_size != size_px {
            if !self.font.is_invalid() {
                unsafe {
                    DeleteObject(self.font.into());
                }
            }
            self.font = unsafe {
                CreateFontW(
                    -size_px,
                    0,
                    0,
                    0,
                    600,
                    0,
                    0,
                    0,
                    DEFAULT_CHARSET,
                    OUT_TT_PRECIS,
                    CLIP_DEFAULT_PRECIS,
                    ANTIALIASED_QUALITY,
                    0,
                    &HSTRING::from("Microsoft YaHei UI"),
                )
            };
            self.font_size = size_px;
        }
        let anchor = self.px(pos);
        let old_font = unsafe { SelectObject(self.dc, self.font.into()) };
        unsafe {
            SetBkMode(self.dc, TRANSPARENT);
            SetTextColor(self.dc, color);
        }
        let step = (size_px as f32 * 1.28).round() as i32;
        for (index, line) in text.split('\n').enumerate() {
            let wide: Vec<u16> = line.encode_utf16().collect();
            if wide.is_empty() {
                continue;
            }
            unsafe {
                TextOutW(self.dc, anchor.x, anchor.y + index as i32 * step, &wide);
            }
        }
        unsafe {
            SelectObject(self.dc, old_font);
        }
    }

    fn paint_laser(&mut self, laser: &[LaserPoint], now_ms: f64) {
        if laser.is_empty() {
            return;
        }
        let brush = unsafe { CreateSolidBrush(color_ref("#FF4D4F")) };
        let old_brush = unsafe { SelectObject(self.dc, brush.into()) };
        let radius = self.norm_px(0.011).max(6.0);
        for point in laser {
            let age = now_ms - point.at_ms;
            if age < 0.0 || age > LASER_TAIL_MS {
                continue;
            }
            // 越旧越小，最后收成一个点；不做透明度（GDI 没有 alpha 笔刷）
            let shrink = 1.0 - age / LASER_TAIL_MS;
            let r = (radius * (0.4 + 0.6 * shrink as f32)).round() as i32;
            let center = self.px([point.x, point.y]);
            let mut pts = Vec::with_capacity(13);
            for step in 0..=12 {
                let angle = step as f32 / 12.0 * std::f32::consts::PI * 2.0;
                pts.push(POINT {
                    x: center.x + (r as f32 * angle.cos()).round() as i32,
                    y: center.y + (r as f32 * angle.sin()).round() as i32,
                });
            }
            unsafe {
                Polygon(self.dc, &pts);
            }
        }
        unsafe {
            SelectObject(self.dc, old_brush);
            DeleteObject(brush.into());
        }
    }

    /// 有没有值得画的东西：没有就整段跳过，别白拷一遍 4K 像素。
    pub fn has_activity(anns: &[RecAnnotation], laser: &[LaserPoint], now_ms: f64) -> bool {
        let drawn = anns.iter().any(|item| item.at_ms <= now_ms);
        let lit = laser
            .iter()
            .any(|point| now_ms - point.at_ms >= 0.0 && now_ms - point.at_ms <= LASER_TAIL_MS);
        drawn || lit
    }
}

impl Drop for Layer {
    fn drop(&mut self) {
        unsafe {
            if !self.font.is_invalid() {
                let _ = DeleteObject(self.font.into());
            }
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

/// `#RRGGBB` → COLORREF（0x00BBGGRR）。
fn color_ref(value: &str) -> COLORREF {
    let hex = value.trim_start_matches('#');
    if hex.len() < 6 {
        return COLORREF(0x0000_3838); // 兜底红
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0xFB);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0x38);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0x38);
    COLORREF((r as u32) | ((g as u32) << 8) | ((b as u32) << 16))
}
