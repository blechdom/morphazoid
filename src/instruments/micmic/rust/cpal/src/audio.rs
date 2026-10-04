use crate::{apply_initial, new_engine, Result, BLOCK};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SampleRate, SizedSample, StreamConfig,
};
use l_system_delay_core::{Engine, Scene};
use rtrb::{Consumer, Producer, RingBuffer};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[derive(Default)]
struct Status {
    finished: AtomicBool,
    failure: AtomicU8,
    overflow: AtomicUsize,
    underflow: AtomicUsize,
    captured: AtomicUsize,
    rendered: AtomicUsize,
}

pub fn devices() -> Result<()> {
    let host = cpal::default_host();
    println!("Host: {:?}", host.id());
    for device in host.input_devices()? {
        match device.default_input_config() {
            Ok(config) => println!(
                "Input: {} | {} channels | {} Hz | {}",
                device.name()?,
                config.channels(),
                config.sample_rate().0,
                config.sample_format()
            ),
            Err(error) => println!("Input: {} | unavailable: {error}", device.name()?),
        }
    }
    for device in host.output_devices()? {
        match device.default_output_config() {
            Ok(config) => println!(
                "Output: {} | {} channels | {} Hz | {}",
                device.name()?,
                config.channels(),
                config.sample_rate().0,
                config.sample_format()
            ),
            Err(error) => println!("Output: {} | unavailable: {error}", device.name()?),
        }
    }
    Ok(())
}

// Negotiate the scene rate, instead of silently changing pitch/time or capturing
// on a different clock rate. No device setting is changed outside this stream.
fn configuration(
    device: &cpal::Device,
    rate: u32,
    input: bool,
) -> Result<(SampleFormat, StreamConfig)> {
    let default = if input {
        device.default_input_config()?
    } else {
        device.default_output_config()?
    };
    let mut configs: Vec<_> = if input {
        device.supported_input_configs()?.collect()
    } else {
        device.supported_output_configs()?.collect()
    };
    configs.retain(|c| {
        c.min_sample_rate().0 <= rate
            && c.max_sample_rate().0 >= rate
            && (1..=2).contains(&c.channels())
    });
    configs.sort_by_key(|c| {
        (
            c.sample_format() != default.sample_format(),
            c.channels() != default.channels(),
            c.channels() != 2,
        )
    });
    let supported = configs
        .into_iter()
        .next()
        .ok_or_else(|| {
            format!(
                "{} {} cannot supply mono/stereo at {rate} Hz; choose a matching scene rate",
                device.name().unwrap_or_default(),
                if input { "input" } else { "output" }
            )
        })?
        .with_sample_rate(SampleRate(rate));
    Ok((supported.sample_format(), supported.config()))
}

fn wait(status: &Status, seconds: f64) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs_f64(seconds + 5.0);
    while !status.finished.load(Ordering::Acquire) {
        match status.failure.load(Ordering::Acquire) {
            1 => return Err("CPAL input stream failed; capture stopped".into()),
            2 => return Err("CPAL output stream failed; playback stopped".into()),
            3 => return Err("DSP produced non-finite output; playback stopped".into()),
            _ => (),
        }
        if Instant::now() >= deadline {
            return Err("Audio callback stopped responding before completion".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if status.failure.load(Ordering::Acquire) != 0 {
        return Err("Audio stream failed before completion".into());
    }
    Ok(())
}

fn write_frame<T: SizedSample + FromSample<f32>>(frame: &mut [T], stereo: [f32; 2]) {
    if frame.len() == 1 {
        frame[0] = T::from_sample((stereo[0] + stereo[1]) * 0.5);
    } else {
        for (channel, sample) in frame.iter_mut().enumerate() {
            *sample = T::from_sample(stereo.get(channel).copied().unwrap_or(0.0));
        }
    }
}

fn playback_stream<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: &StreamConfig,
    audio: Vec<[f32; 2]>,
    status: Arc<Status>,
) -> std::result::Result<cpal::Stream, cpal::BuildStreamError> {
    let channels = config.channels as usize;
    let errors = status.clone();
    let mut cursor = 0;
    device.build_output_stream(
        config,
        move |output: &mut [T], _| {
            for frame in output.chunks_exact_mut(channels) {
                write_frame(frame, audio.get(cursor).copied().unwrap_or([0.0; 2]));
                cursor += 1;
            }
            if cursor >= audio.len() {
                status.finished.store(true, Ordering::Release);
            }
        },
        move |_| {
            errors.failure.store(2, Ordering::Release);
        },
        None,
    )
}

macro_rules! output_formats {
    ($format:expr, $function:ident, $($argument:expr),+) => {
        match $format {
            SampleFormat::F32 => $function::<f32>($($argument),+),
            SampleFormat::F64 => $function::<f64>($($argument),+),
            SampleFormat::I8 => $function::<i8>($($argument),+),
            SampleFormat::I16 => $function::<i16>($($argument),+),
            SampleFormat::I32 => $function::<i32>($($argument),+),
            SampleFormat::I64 => $function::<i64>($($argument),+),
            SampleFormat::U8 => $function::<u8>($($argument),+),
            SampleFormat::U16 => $function::<u16>($($argument),+),
            SampleFormat::U32 => $function::<u32>($($argument),+),
            SampleFormat::U64 => $function::<u64>($($argument),+),
            _ => return Err(format!("Unsupported device format {}", $format).into()),
        }
    };
}

pub fn play(audio: Vec<[f32; 2]>, rate: u32) -> Result<()> {
    let seconds = audio.len() as f64 / rate as f64;
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("No default output device; use --render")?;
    let (format, config) = configuration(&device, rate, false)?;
    let status = Arc::new(Status::default());
    let stream = output_formats!(
        format,
        playback_stream,
        &device,
        &config,
        audio,
        status.clone()
    )?;
    println!(
        "Playing {} at {rate} Hz for {seconds:.3} seconds",
        device.name()?
    );
    stream.play()?;
    let result = wait(&status, seconds);
    drop(stream);
    result
}

fn input_stream<T: SizedSample>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut producer: Producer<[f32; 2]>,
    status: Arc<Status>,
) -> std::result::Result<cpal::Stream, cpal::BuildStreamError>
where
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let errors = status.clone();
    device.build_input_stream(
        config,
        move |input: &[T], _| {
            let mut overflow = 0;
            for frame in input.chunks_exact(channels) {
                let left = f32::from_sample(frame[0]);
                let right = frame
                    .get(1)
                    .map_or(left, |sample| f32::from_sample(*sample));
                if producer.push([left, right]).is_err() {
                    overflow += 1;
                }
            }
            status
                .captured
                .fetch_add(input.len() / channels, Ordering::Relaxed);
            status.overflow.fetch_add(overflow, Ordering::Relaxed);
        },
        move |_| {
            errors.failure.store(1, Ordering::Release);
        },
        None,
    )
}

struct LiveRenderer {
    engine: Engine,
    consumer: Consumer<[f32; 2]>,
    cursor: usize,
    total: usize,
    block_input: [[f32; 2]; BLOCK],
    block_output: [[f32; 2]; BLOCK],
    cache_index: usize,
    cache_len: usize,
    fade_frames: usize,
    level: f32,
}

impl LiveRenderer {
    fn next(&mut self, status: &Status) -> [f32; 2] {
        if self.cursor >= self.total || status.failure.load(Ordering::Relaxed) != 0 {
            return [0.0; 2];
        }
        if self.cache_index == self.cache_len {
            let silence_at = self.total.saturating_sub(self.fade_frames);
            if self.cursor == silence_at {
                self.engine.silence();
            }
            let mut count = BLOCK.min(self.total - self.cursor);
            if self.cursor < silence_at {
                count = count.min(silence_at - self.cursor);
            }
            let mut underflow = 0;
            for frame in &mut self.block_input[..count] {
                *frame = self.consumer.pop().unwrap_or_else(|_| {
                    underflow += 1;
                    [0.0; 2]
                });
            }
            status.underflow.fetch_add(underflow, Ordering::Relaxed);
            self.engine
                .process_block(&self.block_input[..count], &mut self.block_output[..count]);
            self.cache_index = 0;
            self.cache_len = count;
        }
        let mut sample = self.block_output[self.cache_index];
        self.cache_index += 1;
        // Fade the final 20 ms independently of voices, so the device closes quietly.
        let fade = ((self.total - self.cursor) as f32 / self.fade_frames as f32).min(1.0);
        for value in &mut sample {
            *value *= self.level * fade;
        }
        if sample.iter().any(|s| !s.is_finite()) {
            status.failure.store(3, Ordering::Release);
            sample = [0.0; 2];
        }
        self.cursor += 1;
        sample
    }
}

fn live_stream<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut renderer: LiveRenderer,
    status: Arc<Status>,
) -> std::result::Result<cpal::Stream, cpal::BuildStreamError> {
    let channels = config.channels as usize;
    let errors = status.clone();
    device.build_output_stream(
        config,
        move |output: &mut [T], _| {
            for frame in output.chunks_exact_mut(channels) {
                write_frame(frame, renderer.next(&status));
            }
            status.rendered.store(renderer.cursor, Ordering::Relaxed);
            if renderer.cursor >= renderer.total {
                status.finished.store(true, Ordering::Release);
            }
        },
        move |_| {
            errors.failure.store(2, Ordering::Release);
        },
        None,
    )
}

pub fn live(scene: &Scene, seconds: f64, level: f32) -> Result<()> {
    let mut engine = new_engine(scene)?;
    apply_initial(&mut engine, scene)?;
    let host = cpal::default_host();
    let input = host
        .default_input_device()
        .ok_or("No default input device")?;
    let output = host
        .default_output_device()
        .ok_or("No default output device")?;
    let (input_format, input_config) = configuration(&input, scene.sample_rate, true)?;
    let (output_format, output_config) = configuration(&output, scene.sample_rate, false)?;
    if input_config.sample_rate != output_config.sample_rate {
        return Err("Live input/output sample rates differ; choose matching devices".into());
    }
    let capacity = (scene.sample_rate as usize / 4).max(BLOCK * 4);
    let (producer, consumer) = RingBuffer::new(capacity);
    let status = Arc::new(Status::default());
    let input_stream = output_formats!(
        input_format,
        input_stream,
        &input,
        &input_config,
        producer,
        status.clone()
    )?;
    let renderer = LiveRenderer {
        engine,
        consumer,
        cursor: 0,
        total: (seconds * scene.sample_rate as f64).round() as usize,
        block_input: [[0.0; 2]; BLOCK],
        block_output: [[0.0; 2]; BLOCK],
        cache_index: 0,
        cache_len: 0,
        fade_frames: (scene.sample_rate as usize / 50).max(1),
        level,
    };
    let output_stream = output_formats!(
        output_format,
        live_stream,
        &output,
        &output_config,
        renderer,
        status.clone()
    )?;
    println!(
        "Live {} → {} | {} Hz | level {level:.2} | {seconds:.3} seconds",
        input.name()?,
        output.name()?,
        scene.sample_rate
    );
    input_stream.play()?;
    // A short bounded prefill absorbs callback startup jitter. Independent device
    // clocks may still drift; the reported counters make this observable.
    std::thread::sleep(Duration::from_millis(20));
    output_stream.play()?;
    let result = wait(&status, seconds);
    drop(output_stream);
    drop(input_stream);
    println!(
        "Capture frames: {}, rendered frames: {}, ring overflow: {}, ring underflow: {}",
        status.captured.load(Ordering::Relaxed),
        status.rendered.load(Ordering::Relaxed),
        status.overflow.load(Ordering::Relaxed),
        status.underflow.load(Ordering::Relaxed)
    );
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use l_system_delay_core::VoiceSpec;
    #[test]
    fn bounded_ring_underflow_is_silent_and_completion_stays_bounded() {
        let (mut producer, consumer) = RingBuffer::new(2);
        producer.push([0.1, -0.1]).unwrap();
        producer.push([0.2, -0.2]).unwrap();
        assert!(producer.push([0.3, -0.3]).is_err());
        let status = Status::default();
        let mut renderer = LiveRenderer {
            engine: Engine::new(8000, 4.0, 1, 1).unwrap(),
            consumer,
            cursor: 0,
            total: 4,
            block_input: [[0.0; 2]; BLOCK],
            block_output: [[0.0; 2]; BLOCK],
            cache_index: 0,
            cache_len: 0,
            fade_frames: 1,
            level: 0.58,
        };
        for _ in 0..4 {
            assert_eq!(renderer.next(&status), [0.0; 2]);
        }
        assert_eq!(status.underflow.load(Ordering::Relaxed), 2);
        assert_eq!(renderer.next(&status), [0.0; 2]);
        assert_eq!(renderer.cursor, 4);
        let mut mono = [0.0_f32];
        write_frame(&mut mono, [0.5, -0.25]);
        assert_eq!(mono, [0.125]);
        let mut stereo = [0.0_f32; 2];
        write_frame(&mut stereo, [0.5, -0.25]);
        assert_eq!(stereo, [0.5, -0.25]);
    }
    #[test]
    fn callback_failure_exits_without_waiting_for_completion() {
        let status = Status::default();
        status.failure.store(1, Ordering::Release);
        assert!(wait(&status, 8.0).is_err());
    }

    #[test]
    fn live_cache_refills_in_bounded_blocks_and_silences_at_the_exact_fade_boundary() {
        let (_producer, consumer) = RingBuffer::new(BLOCK * 2);
        let status = Status::default();
        let mut engine = Engine::new(8000, 4.0, 1, 1).unwrap();
        engine.set_voices(
            &[VoiceSpec {
                key: "live".into(),
                delay: 0.05,
                rate: 1.0,
                gain: 0.5,
                pan: 0.0,
            }],
            1,
        );
        let mut renderer = LiveRenderer {
            engine,
            consumer,
            cursor: 0,
            total: 300,
            block_input: [[0.0; 2]; BLOCK],
            block_output: [[0.0; 2]; BLOCK],
            cache_index: 0,
            cache_len: 0,
            fade_frames: 21,
            level: 0.58,
        };
        renderer.next(&status);
        assert_eq!(status.underflow.load(Ordering::Relaxed), BLOCK);
        assert_eq!(renderer.cache_len, BLOCK);
        for _ in 1..279 {
            renderer.next(&status);
        }
        assert_eq!(renderer.cursor, 279);
        assert_eq!(renderer.engine.target_voice_count(), 1);
        assert_eq!(status.underflow.load(Ordering::Relaxed), 279);
        renderer.next(&status);
        assert_eq!(renderer.engine.target_voice_count(), 0);
        assert_eq!(renderer.cache_len, 21);
        for _ in 280..300 {
            renderer.next(&status);
        }
        assert_eq!(renderer.cursor, 300);
        assert_eq!(status.underflow.load(Ordering::Relaxed), 300);
        assert_eq!(renderer.next(&status), [0.0; 2]);
    }
}
