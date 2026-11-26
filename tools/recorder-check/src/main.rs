//! 录制管线自检：不装 GUI 栈也能验「抓帧 → 写帧 → FFmpeg → MP4」的后半段。
//!
//! 直接复用 `desktop/src/recorder.rs`（不复制逻辑），喂合成画面，再用 ffprobe 核对
//! 编码、分辨率、帧数与时长。CI 的 `recorder` 任务跑它；本地缺 ffmpeg 时明确退出 2。

#[allow(dead_code)] // 复用的是整份录制模块，这个工具只用到编码与裁剪
#[path = "../../../desktop/src/recorder.rs"]
mod recorder;
use recorder::{crop_rgba, Encoder, EncoderSpec};

fn has(bin: &str) -> bool {
    std::process::Command::new(bin)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn frame(w: u32, h: u32, i: u64) -> Vec<u8> {
    // 每帧整体提亮一档：编码后的帧率/帧数对不对是一回事，画面确实在变是另一回事
    let shift = ((i % 32) as u32) * 8;
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            data.push(x.wrapping_add(shift) as u8);
            data.push(y.wrapping_add(shift) as u8);
            data.push(shift as u8);
            data.push(255);
        }
    }
    data
}

fn main() {
    if !has("ffmpeg") || !has("ffprobe") {
        eprintln!("跳过：没有 ffmpeg / ffprobe");
        std::process::exit(2);
    }

    let w = 320u32;
    let h = 240u32;
    let fps = 30u32;
    let frames = 90u64;
    let out = std::env::temp_dir().join("recorder-check.mp4");

    let mut encoder = Encoder::start(&EncoderSpec {
        width: w,
        height: h,
        fps,
        out: out.clone(),
        ffmpeg: "ffmpeg".into(),
        crf: 20,
        pix_fmt: "rgba",
        preset: "veryfast",
        codec: "libx264",
    })
    .expect("编码器启动失败");
    for i in 0..frames {
        encoder.push_frame(&frame(w, h, i)).expect("写帧失败");
    }
    let stats = encoder.finish().expect("编码收尾失败");

    let probe = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,width,height,nb_frames",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1",
        ])
        .arg(&out)
        .output()
        .expect("ffprobe 执行失败");
    let text = String::from_utf8_lossy(&probe.stdout).to_string();
    println!("stats: frames={} seconds={} fps={} dropped={}", stats.frames, stats.seconds, stats.fps, stats.dropped);
    println!("probe: {}", text.replace('\n', " "));

    let mut failures: Vec<String> = Vec::new();
    if stats.frames != frames {
        failures.push(format!("写入帧数 {}，期望 {frames}", stats.frames));
    }
    if !text.contains("codec_name=h264") {
        failures.push("编码不是 h264".into());
    }
    if !text.contains(&format!("width={w}")) || !text.contains(&format!("height={h}")) {
        failures.push("分辨率不符".into());
    }
    if !text.contains(&format!("nb_frames={frames}")) {
        failures.push("成片帧数与输入不符".into());
    }
    let duration: f64 = text
        .lines()
        .find_map(|line| line.strip_prefix("duration="))
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0.0);
    if (duration - frames as f64 / fps as f64).abs() > 0.15 {
        failures.push(format!("时长 {duration}，期望约 {}", frames as f64 / fps as f64));
    }
    let cropped = crop_rgba(&frame(w, h, 0), w, h, 10, 10, 100, 50).expect("裁剪失败");
    if cropped.len() != 100 * 50 * 4 {
        failures.push(format!("裁剪长度 {}，期望 {}", cropped.len(), 100 * 50 * 4));
    }
    let _ = std::fs::remove_file(&out);

    if failures.is_empty() {
        println!("OK：编码管线自检通过");
    } else {
        eprintln!("FAIL：{}", failures.join("；"));
        std::process::exit(1);
    }
}
