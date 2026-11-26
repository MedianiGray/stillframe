//! 桌面录制管线的编码侧：Rust 只负责按时抓帧，编码交给 FFmpeg。
//!
//! 为什么不沿用 WebView 里的 `MediaRecorder`：它只会出 WebM，而桌面壳逐帧拉屏的
//! 速率只有个位数，撑不住 30 帧的连续录制（见 docs/UPGRADE-PLAN.md 的 5.2）。
//!
//! 分工：
//! - 抓帧线程按目标帧率循环 `xcap` 抓屏，裁出选区后把 RGBA 原始帧写进 FFmpeg 的 stdin；
//! - FFmpeg 以 rawvideo 读入，libx264 veryfast / CRF 20 编码，`+faststart` 便于直接播放；
//! - 掉帧不做补偿（补帧只会让画面重复、音画更乱），只如实计数，结束时报出来。
//!
//! 本轮只做视频主线：音频（WASAPI 环回 + 麦克风混音）留到下一批，命令行里显式 `-an`，
//! 免得 FFmpeg 在等一条永远不来的音频流上卡住。

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::Instant;

/// 编码参数。宽度与高度为偶数时才安全，奇数会被 libx264 拒绝。
pub struct EncoderSpec {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub out: PathBuf,
    /// FFmpeg 可执行文件：默认走 PATH，Windows 上可传 sidecar 的绝对路径。
    pub ffmpeg: String,
    pub crf: u32,
    /// 输入像素格式：xcap 给 RGBA，Windows 专用抓帧器给 BGRA。
    pub pix_fmt: &'static str,
    /// x264 preset：Windows 抓帧已吃掉不少 CPU，编码让一档给 ultrafast。
    pub preset: &'static str,
    /// 编码器：`h264_qsv`（核显）或 `libx264`（软件）。
    pub codec: &'static str,
}

/// 一次录制的实绩：帧数、时长、实际帧率、估算掉帧数。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStats {
    pub frames: u64,
    pub seconds: f64,
    pub fps: f64,
    pub dropped: u64,
    pub path: String,
    /// 每帧平均花在「写管道」上的毫秒数；远大于抓帧耗时说明编码端是瓶颈。
    pub write_avg_ms: f64,
    /// 每帧平均抓屏耗时（毫秒）。和 write_avg_ms 一起就能定位瓶颈在抓帧还是编码。
    pub grab_avg_ms: f64,
    /// 为对齐时间轴而重复写出的帧数。这些帧不计入真实帧率。
    pub repeats: u64,
    /// 实际走的抓帧 + 编码组合，例如 `dxgi+h264_qsv`。
    pub backend: String,
}

pub struct Encoder {
    child: Child,
    stdin: ChildStdin,
    frames: u64,
    frame_bytes: usize,
    started: Instant,
    target_fps: u32,
    path: String,
    /// 写帧累计耗时（微秒），标定时用来看「是不是卡在管道上」。
    write_micros: u128,
    /// 抓帧累计耗时（微秒）。
    grab_micros: u128,
    /// 重复帧计数（时间轴补齐）。
    repeats: u64,
    /// 抓帧 + 编码后端标识，只用于报表。
    backend: String,
}

impl Encoder {
    pub fn start(spec: &EncoderSpec) -> Result<Self, String> {
        let mut cmd = Command::new(&spec.ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            spec.pix_fmt,
            "-s",
            &format!("{}x{}", spec.width, spec.height),
            "-r",
            &spec.fps.to_string(),
            "-i",
            "-",
            "-an",
        ]);
        // 硬件编码器优先（Windows 上由调用方探测后传入），CPU 让给抓帧；
        // 回退 libx264 时按 preset/crf 走软件编码。
        if spec.codec == "h264_qsv" {
            cmd.args([
                "-c:v",
                "h264_qsv",
                "-preset",
                "veryfast",
                "-global_quality",
                &spec.crf.to_string(),
                "-pix_fmt",
                "nv12",
            ]);
        } else {
            cmd.args([
                "-c:v",
                "libx264",
                "-preset",
                spec.preset,
                "-crf",
                &spec.crf.to_string(),
                "-pix_fmt",
                "yuv420p",
            ]);
        }
        cmd.args(["-movflags", "+faststart", "-y"]);
        cmd.arg(&spec.out);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动 FFmpeg 失败（{}）：{e}", spec.ffmpeg))?;
        let stdin = child.stdin.take().ok_or("拿不到 FFmpeg 的输入管道")?;

        Ok(Self {
            child,
            stdin,
            frames: 0,
            frame_bytes: (spec.width as usize) * (spec.height as usize) * 4,
            started: Instant::now(),
            target_fps: spec.fps,
            path: spec.out.to_string_lossy().to_string(),
            write_micros: 0,
            grab_micros: 0,
            repeats: 0,
            backend: "unknown".to_string(),
        })
    }

    /// 记下本次走的后端（例如 `dxgi+h264_qsv`），只用于报表和标定。
    pub fn set_backend(&mut self, name: String) {
        self.backend = name;
    }

    /// 已写出的帧数（含重复帧）。
    pub fn frames(&self) -> u64 {
        self.frames
    }

    /// 收尾补齐：让成片时长对上真实录制时长。抓帧追不上节拍时中间已经补帧，
    /// 但尾巴上还会差几帧，这里按实际秒数把缺的补上，成片才不会被快放。
    pub fn pad_to(&mut self, elapsed: f64, frame: &[u8]) -> Result<u64, String> {
        let expected = (elapsed * self.target_fps as f64).round() as u64;
        let mut padded = 0;
        while self.frames < expected {
            self.push_repeat(frame)?;
            padded += 1;
        }
        Ok(padded)
    }

    pub fn note_grab(&mut self, spent: std::time::Duration) {
        self.grab_micros += spent.as_micros();
    }

    /// 重复写上一帧来补齐时间轴：抓帧跟不上 30fps 时，成片时长才不会缩水成快放。
    pub fn push_repeat(&mut self, frame: &[u8]) -> Result<(), String> {
        self.stdin
            .write_all(frame)
            .map_err(|e| format!("写入编码器失败：{e}"))?;
        self.frames += 1;
        self.repeats += 1;
        Ok(())
    }

    /// 写入一帧 RGBA。长度不符直接报错——宁可不录，也不要写歪掉的画面。
    pub fn push_frame(&mut self, frame: &[u8]) -> Result<(), String> {
        if frame.len() != self.frame_bytes {
            return Err(format!(
                "帧大小不符：期望 {} 字节，实际 {} 字节",
                self.frame_bytes,
                frame.len()
            ));
        }
        let t0 = Instant::now();
        self.stdin
            .write_all(frame)
            .map_err(|e| format!("写入编码器失败：{e}"))?;
        self.write_micros += t0.elapsed().as_micros();
        self.frames += 1;
        Ok(())
    }


    /// 关闭输入管道等 FFmpeg 收尾，返回实绩。
    pub fn finish(mut self) -> Result<RecordingStats, String> {
        let frames = self.frames;
        let target_fps = self.target_fps;
        let path = self.path.clone();
        let started = self.started;
        // 先关 stdin：FFmpeg 收到 EOF 才会刷出文件尾。
        drop(self.stdin);
        let seconds = started.elapsed().as_secs_f64();
        let status = self.child.wait().map_err(|e| format!("等待 FFmpeg 结束失败：{e}"))?;
        if !status.success() {
            return Err(format!("FFmpeg 编码失败（退出码 {status}），文件可能不完整"));
        }
        if frames == 0 {
            return Err("一帧都没录到：目标窗口或显示器可能不可见".to_string());
        }
        // 真实帧率要把「补齐用的重复帧」剔掉，否则会虚高。
        let real_frames = frames.saturating_sub(self.repeats);
        let fps = if seconds > 0.0 {
            real_frames as f64 / seconds
        } else {
            0.0
        };
        let expected = (seconds * target_fps as f64).round() as u64;
        let write_avg_ms = if real_frames > 0 {
            ((self.write_micros as f64 / real_frames as f64) / 1000.0 * 10.0).round() / 10.0
        } else {
            0.0
        };
        let grab_avg_ms = if real_frames > 0 {
            ((self.grab_micros as f64 / real_frames as f64) / 1000.0 * 10.0).round() / 10.0
        } else {
            0.0
        };
        Ok(RecordingStats {
            frames,
            seconds: (seconds * 100.0).round() / 100.0,
            fps: (fps * 10.0).round() / 10.0,
            dropped: expected.saturating_sub(frames),
            path,
            write_avg_ms,
            grab_avg_ms,
            repeats: self.repeats,
            backend: self.backend,
        })
    }
}

/// 从整屏 RGBA 里裁出选区。坐标是相对该显示器的左上角。
pub fn crop_rgba(src: &[u8], src_w: u32, src_h: u32, x: u32, y: u32, w: u32, h: u32) -> Result<Vec<u8>, String> {
    // 先按显示器边界收窄，避免越界读
    let x = x.min(src_w.saturating_sub(1));
    let y = y.min(src_h.saturating_sub(1));
    let w = w.min(src_w - x).max(1);
    let h = h.min(src_h - y).max(1);
    if src.len() < (src_w as usize) * (src_h as usize) * 4 {
        return Err("源帧长度与宽高不符".to_string());
    }
    let mut out = Vec::with_capacity((w as usize) * (h as usize) * 4);
    let row_bytes = (w as usize) * 4;
    let stride = (src_w as usize) * 4;
    for row in 0..h as usize {
        let start = (y as usize + row) * stride + (x as usize) * 4;
        out.extend_from_slice(&src[start..start + row_bytes]);
    }
    Ok(out)
}

/// 默认录制目录：Windows 走「图片」，其他平台走「视频」。
pub fn recordings_dir() -> PathBuf {
    let base = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    let dir = if cfg!(windows) {
        base.join("Pictures").join("Stillframe")
    } else {
        base.join("Videos").join("Stillframe")
    };
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn ffmpeg_available(bin: &str) -> bool {
        Command::new(bin)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn synthetic_frame(width: u32, height: u32, index: u64) -> Vec<u8> {
        // 每帧整体偏移一点亮度，编码后再解码也能看出不是同一帧
        let shift = (index % 32) as u8 * 8;
        let mut frame = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                frame.push(x.wrapping_add(shift) as u8);
                frame.push(y.wrapping_add(shift) as u8);
                frame.push(shift);
                frame.push(255);
            }
        }
        frame
    }

    #[test]
    fn crop_takes_requested_region() {
        // 4x4 图，左上角放标记，裁右下 2x2
        let mut src = vec![0u8; 4 * 4 * 4];
        for i in 0..16 {
            src[i * 4] = i as u8; // R 通道记序号
        }
        let out = crop_rgba(&src, 4, 4, 2, 2, 2, 2).unwrap();
        assert_eq!(out.len(), 2 * 2 * 4);
        assert_eq!(out[0], 10); // (2,2)
        assert_eq!(out[4], 11); // (3,2)
        assert_eq!(out[8], 14); // (2,3)
    }

    #[test]
    fn crop_clamps_oversized_region() {
        let src = vec![7u8; 4 * 4 * 4];
        let out = crop_rgba(&src, 4, 4, 3, 3, 10, 10).unwrap();
        assert_eq!(out.len(), 1 * 1 * 4); // 只裁到右下最后一格
    }

    #[test]
    fn encoder_writes_playable_mp4() {
        if !ffmpeg_available("ffmpeg") {
            eprintln!("跳过：本机没有 ffmpeg");
            return;
        }
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let out = std::env::temp_dir().join(format!("stillframe-encoder-{stamp}.mp4"));
        let spec = EncoderSpec {
            width: 320,
            height: 240,
            fps: 30,
            out: out.clone(),
            ffmpeg: "ffmpeg".to_string(),
            crf: 20,
        };
        let mut encoder = Encoder::start(&spec).unwrap();
        for index in 0..60u64 {
            encoder.push_frame(&synthetic_frame(320, 240, index)).unwrap();
        }
        let stats = encoder.finish().unwrap();
        assert!(stats.frames >= 60);
        assert!(out.exists(), "编码产物不存在");

        // 用 ffprobe 交叉核对：容器、编码、分辨率、时长都得对
        let probe = Command::new("ffprobe")
            .args([
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_name,width,height",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1",
            ])
            .arg(&out)
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&probe.stdout).to_string();
        assert!(text.contains("codec_name=h264"), "编码不是 h264：{text}");
        assert!(text.contains("width=320") && text.contains("height=240"), "分辨率不对：{text}");
        let duration: f64 = text
            .lines()
            .find_map(|line| line.strip_prefix("duration="))
            .and_then(|value| value.trim().parse().ok())
            .unwrap_or(0.0);
        assert!(duration >= 1.8, "60 帧 30fps 应接近 2 秒，实际 {duration}");
        let _ = std::fs::remove_file(&out);
    }
}
