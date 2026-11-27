//! 系统声采集：WASAPI 环回。
//!
//! 为什么不用 FFmpeg：本机 `-f dshow` 只有麦克风阵列，没有「立体声混音」端点；
//! `-f wasapi` 这个输入格式在官方构建里也不存在（实测 `Unknown input format`）。
//! 所以扬声器里放的声音只能自己走 WASAPI 环回采。
//!
//! 采到的数据统一混成单声道 16 位 WAV，和麦克风那条保持同一种封装，
//! 停止后由 `recorder` 一起封装进 MP4。
#![cfg(windows)]

use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};

use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// 采集句柄。`stop()` 之后 WAV 头会被回填，文件才能被 FFmpeg 正常读。
pub struct LoopbackHandle {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl LoopbackHandle {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn stop(mut self) {
        self.halt();
    }

    fn halt(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for LoopbackHandle {
    fn drop(&mut self) {
        self.halt();
    }
}

struct Format {
    rate: u32,
    channels: u16,
    bits: u16,
}

/// 起一路环回采集。设备打不开会立刻返回错误，调用方据此静默退回纯画面。
pub fn start(path: &Path) -> Result<LoopbackHandle, String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let out = path.to_path_buf();
    let handle = std::thread::spawn(move || {
        if let Err(message) = capture_loop(&out, &thread_stop, &tx) {
            // 初始化阶段的失败要回给调用方；录制中途的失败只能留日志
            let _ = tx.send(Err(message));
        }
    });
    match rx.recv_timeout(std::time::Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(LoopbackHandle {
            path: path.to_path_buf(),
            stop,
            handle: Some(handle),
        }),
        Ok(Err(message)) => {
            let _ = handle.join();
            Err(message)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("系统声音设备 8 秒内没有响应".to_string())
        }
    }
}

fn capture_loop(
    path: &Path,
    stop: &Arc<AtomicBool>,
    ready: &mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    unsafe {
        // 多线程单元：采集循环跑在自己的线程里，简单直接
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let (client, capture, format) = unsafe { open_stream()? };

    let mut file =
        std::fs::File::create(path).map_err(|e| format!("无法创建系统声临时文件：{e}"))?;
    write_header(&mut file, format.rate).map_err(|e| format!("写 WAV 头失败：{e}"))?;
    let mut written: u64 = 0;
    // 到这里设备已经在采，通知调用方可以继续
    let _ = ready.send(Ok(()));

    while !stop.load(Ordering::Relaxed) {
        let mut drained = 0;
        loop {
            let packet = match unsafe { capture.GetNextPacketSize() } {
                Ok(packet) => packet,
                Err(_) => break,
            };
            if packet == 0 {
                // 一次读完继续读没意义，交给外层 sleep 等下一轮
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            if unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }.is_err()
            {
                break;
            }
            if frames > 0 {
                let samples = mix_down(
                    data,
                    frames as usize,
                    format.channels as usize,
                    format.bits,
                    flags,
                );
                let mut buffer = Vec::with_capacity(samples.len() * 2);
                for sample in &samples {
                    buffer.extend_from_slice(&sample.to_le_bytes());
                }
                if file.write_all(&buffer).is_err() {
                    break;
                }
                written += buffer.len() as u64;
            }
            let _ = unsafe { capture.ReleaseBuffer(frames) };
            drained += 1;
            if drained > 64 {
                // 一次攒太多会让内存越滚越大，也让停止响应变慢
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    unsafe {
        let _ = client.Stop();
    }
    // 回填 RIFF 与 data 长度，收尾后文件才自洽
    let data_bytes = written as u32;
    let _ = file.seek(SeekFrom::Start(4));
    let _ = file.write_all(&(36 + data_bytes).to_le_bytes());
    let _ = file.seek(SeekFrom::Start(40));
    let _ = file.write_all(&data_bytes.to_le_bytes());
    let _ = file.flush();
    Ok(())
}

fn write_header(file: &mut std::fs::File, rate: u32) -> std::io::Result<()> {
    file.write_all(b"RIFF")?;
    file.write_all(&36u32.to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?; // PCM
    file.write_all(&1u16.to_le_bytes())?; // 单声道
    file.write_all(&rate.to_le_bytes())?;
    file.write_all(&(rate * 2).to_le_bytes())?; // 每秒字节数
    file.write_all(&2u16.to_le_bytes())?; // 块对齐
    file.write_all(&16u16.to_le_bytes())?; // 位深
    file.write_all(b"data")?;
    file.write_all(&0u32.to_le_bytes())?; // 长度先占位，收尾回填
    Ok(())
}

unsafe fn open_stream() -> Result<(IAudioClient, IAudioCaptureClient, Format), String> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
        .map_err(|e| format!("取音频设备枚举器失败：{e:?}"))?;
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .map_err(|e| format!("没有默认播放设备：{e:?}"))?;
    let client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("打开音频客户端失败：{e:?}"))?;

    let mix = client
        .GetMixFormat()
        .map_err(|e| format!("取不到混音格式：{e:?}"))?;
    let wave = std::ptr::read_unaligned(mix);
    let format = Format {
        rate: wave.nSamplesPerSec,
        channels: wave.nChannels,
        bits: wave.wBitsPerSample,
    };

    let init = client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        // 环回：要的是「渲染设备正在播放的内容」，不是某个输入设备
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        0,
        0,
        mix as *const _,
        None,
    );
    CoTaskMemFree(Some(mix as *const _));
    init.map_err(|e| {
        format!(
            "初始化环回采集失败：{e:?}（{} 声道 / {} 位 / {}Hz）",
            format.channels, format.bits, format.rate
        )
    })?;

    let capture: IAudioCaptureClient = client
        .GetService()
        .map_err(|e| format!("取不到采集接口：{e:?}"))?;
    client
        .Start()
        .map_err(|e| format!("启动环回采集失败：{e:?}"))?;
    Ok((client, capture, format))
}

/// f32 / s16 → 单声道 i16。多声道取平均，比只取第一声道更接近听感。
fn mix_down(data: *mut u8, frames: usize, channels: usize, bits: u16, flags: u32) -> Vec<i16> {
    let mut out = vec![0i16; frames];
    if frames == 0 || channels == 0 {
        return out;
    }
    if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
        return out;
    }
    unsafe {
        if bits == 32 {
            // WASAPI 混音格式基本是 32 位浮点
            let samples = std::slice::from_raw_parts(data as *const f32, frames * channels);
            for (index, slot) in out.iter_mut().enumerate() {
                let mut sum = 0f32;
                for channel in 0..channels {
                    sum += samples[index * channels + channel];
                }
                let value = (sum / channels as f32).clamp(-1.0, 1.0);
                *slot = (value * 32767.0) as i16;
            }
        } else {
            let samples = std::slice::from_raw_parts(data as *const i16, frames * channels);
            for (index, slot) in out.iter_mut().enumerate() {
                let mut sum = 0i32;
                for channel in 0..channels {
                    sum += samples[index * channels + channel] as i32;
                }
                *slot = (sum / channels as i32) as i16;
            }
        }
    }
    out
}
