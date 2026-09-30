//! Native processor demos and real stereo WAV processing. Offline output keeps
//! the source rate by default; device-rate conversion uses a windowed-sinc bank.
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, SampleFormat, SizedSample,
};
use std::{
    fs::File,
    io::{BufWriter, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use synthesis_core::processing::{ProcessorBank, FRAMES};
use synthesis_presets::{
    apply_processor_preset, PROCESSOR_IDS, PROCESSOR_NAMES, PROCESSOR_PARAM_NAMES,
    PROCESSOR_PRESETS,
};
type Error = Box<dyn std::error::Error>;
struct Wav {
    rate: u32,
    frames: Vec<[f32; 2]>,
}
fn u16le(bytes: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([bytes[i], bytes[i + 1]])
}
fn u32le(bytes: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]])
}
fn decode_wav(bytes: &[u8]) -> Result<Wav, Error> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Input must be a little-endian RIFF WAV file".into());
    }
    let mut cursor = 12usize;
    let mut format = None;
    let mut data = None;
    while cursor + 8 <= bytes.len() {
        let length = u32le(bytes, cursor + 4) as usize;
        let end = cursor
            .checked_add(8)
            .and_then(|x| x.checked_add(length))
            .ok_or("WAV chunk overflow")?;
        if end > bytes.len() {
            return Err("Truncated WAV chunk".into());
        }
        let chunk = &bytes[cursor + 8..end];
        match &bytes[cursor..cursor + 4] {
            b"fmt " => {
                if length < 16 {
                    return Err("Truncated WAV format".into());
                }
                let mut tag = u16le(chunk, 0);
                if tag == 0xfffe {
                    if length < 40 {
                        return Err("Truncated extensible WAV format".into());
                    }
                    tag = u16le(chunk, 24);
                }
                format = Some((
                    tag,
                    u16le(chunk, 2),
                    u32le(chunk, 4),
                    u16le(chunk, 12),
                    u16le(chunk, 14),
                ));
            }
            b"data" => {
                if data.is_none() {
                    data = Some(chunk);
                }
            }
            _ => {}
        }
        cursor = end + (length & 1);
    }
    let (tag, channels, rate, align, bits) = format.ok_or("WAV format chunk is missing")?;
    let data = data.ok_or("WAV data chunk is missing")?;
    if !(8000..=192000).contains(&rate) || !(1..=2).contains(&channels) {
        return Err("Use mono/stereo WAV at 8–192 kHz".into());
    }
    if !((tag == 1 && [16, 24, 32].contains(&bits)) || (tag == 3 && bits == 32)) {
        return Err("Use PCM16/24/32 or float32 WAV".into());
    }
    let bytes_per_sample = (bits / 8) as usize;
    let expected = bytes_per_sample * channels as usize;
    if align as usize != expected || data.len() % expected != 0 {
        return Err("Invalid WAV block alignment".into());
    }
    let sample = |b: &[u8]| -> f32 {
        let v = match (tag, bits) {
            (3, 32) => f32::from_le_bytes(b[..4].try_into().unwrap()),
            (_, 16) => i16::from_le_bytes(b[..2].try_into().unwrap()) as f32 / 32768.,
            (_, 24) => {
                let raw = b[0] as i32 | ((b[1] as i32) << 8) | ((b[2] as i32) << 16);
                let signed = (raw << 8) >> 8;
                signed as f32 / 8388608.
            }
            _ => i32::from_le_bytes(b[..4].try_into().unwrap()) as f32 / 2147483648.,
        };
        if v.is_finite() {
            v.clamp(-4., 4.)
        } else {
            0.
        }
    };
    let frames = data
        .chunks_exact(expected)
        .map(|frame| {
            let left = sample(frame);
            [
                left,
                if channels == 2 {
                    sample(&frame[bytes_per_sample..])
                } else {
                    left
                },
            ]
        })
        .collect();
    Ok(Wav { rate, frames })
}
fn read_wav(path: &str) -> Result<Wav, Error> {
    if std::fs::metadata(path)?.len() > 64 * 1024 * 1024 {
        return Err("Choose a WAV file smaller than 64 MB".into());
    }
    decode_wav(&std::fs::read(path)?)
}
struct Resampler {
    step: f64,
    taps: usize,
    coefficients: Vec<f32>,
}
impl Resampler {
    fn new(source: u32, target: u32) -> Self {
        if source == target {
            return Self {
                step: 1.,
                taps: 0,
                coefficients: vec![],
            };
        }
        let ratio = (target as f64 / source as f64).min(1.);
        let cutoff = ratio * 0.94;
        let taps = ((24. / ratio).ceil() as usize).clamp(24, 576);
        let taps = taps + (taps & 1);
        let mut coefficients = vec![0.; 256 * taps];
        for phase in 0..256 {
            let fraction = phase as f64 / 256.;
            let mut total = 0.;
            for tap in 0..taps {
                let x = tap as f64 - (taps / 2 - 1) as f64 - fraction;
                let sinc = if x.abs() < 1e-9 {
                    cutoff
                } else {
                    (std::f64::consts::PI * x * cutoff).sin() / (std::f64::consts::PI * x)
                };
                let theta = std::f64::consts::TAU * tap as f64 / (taps - 1) as f64;
                let window = 0.42 - 0.5 * theta.cos() + 0.08 * (theta * 2.).cos();
                let v = (sinc * window) as f32;
                coefficients[phase * taps + tap] = v;
                total += v;
            }
            for v in &mut coefficients[phase * taps..(phase + 1) * taps] {
                *v /= total;
            }
        }
        Self {
            step: source as f64 / target as f64,
            taps,
            coefficients,
        }
    }
    fn sample(&self, wav: &Wav, frame: usize) -> [f32; 2] {
        if self.taps == 0 {
            return wav.frames.get(frame).copied().unwrap_or([0.; 2]);
        }
        let position = frame as f64 * self.step;
        let base = position.floor() as isize;
        let phase = ((position - base as f64) * 256.) as usize;
        let mut out = [0.; 2];
        for i in 0..self.taps {
            let index = base + i as isize - (self.taps / 2 - 1) as isize;
            if index >= 0 {
                if let Some(x) = wav.frames.get(index as usize) {
                    let k = self.coefficients[phase * self.taps + i];
                    out[0] += x[0] * k;
                    out[1] += x[1] * k;
                }
            }
        }
        out
    }
}
struct Runner {
    bank: ProcessorBank,
    wav: Option<Wav>,
    resampler: Option<Resampler>,
    cursor: usize,
    total: usize,
    stop: usize,
    stopped: bool,
    source: u32,
    frequency: f32,
}
impl Runner {
    fn next(&mut self, maximum: usize) -> usize {
        if self.cursor >= self.total {
            return 0;
        }
        if self.cursor >= self.stop && !self.stopped {
            self.bank.set_source(self.source, self.frequency, false);
            self.stopped = true;
        }
        let n = maximum
            .min(FRAMES)
            .min(self.total - self.cursor)
            .min(if self.cursor < self.stop {
                self.stop - self.cursor
            } else {
                FRAMES
            });
        for i in 0..n {
            let frame = match (&self.wav, &self.resampler) {
                (Some(w), Some(r)) if self.cursor + i < self.stop => r.sample(w, self.cursor + i),
                _ => [0.; 2],
            };
            for c in 0..2 {
                self.bank.input_mut(c)[i] = frame[c];
            }
        }
        self.bank.process(n);
        self.cursor += n;
        n
    }
}
fn wav_header(writer: &mut impl Write, rate: u32, frames: usize) -> Result<(), Error> {
    let bytes = frames
        .checked_mul(4)
        .filter(|n| *n <= u32::MAX as usize - 36)
        .ok_or("Output WAV is too large")? as u32;
    writer.write_all(b"RIFF")?;
    writer.write_all(&(bytes + 36).to_le_bytes())?;
    writer.write_all(b"WAVEfmt ")?;
    writer.write_all(&16u32.to_le_bytes())?;
    writer.write_all(&1u16.to_le_bytes())?;
    writer.write_all(&2u16.to_le_bytes())?;
    writer.write_all(&rate.to_le_bytes())?;
    writer.write_all(&(rate * 4).to_le_bytes())?;
    writer.write_all(&4u16.to_le_bytes())?;
    writer.write_all(&16u16.to_le_bytes())?;
    writer.write_all(b"data")?;
    writer.write_all(&bytes.to_le_bytes())?;
    Ok(())
}
fn render_wav(path: &str, mut runner: Runner, rate: u32, gain: f32) -> Result<(), Error> {
    let mut writer = BufWriter::new(File::create(path)?);
    wav_header(&mut writer, rate, runner.total)?;
    loop {
        let n = runner.next(FRAMES);
        if n == 0 {
            break;
        }
        for i in 0..n {
            for c in 0..2 {
                let sample = (runner.bank.output(c)[i] * gain * 32768.)
                    .round()
                    .clamp(-32768., 32767.) as i16;
                writer.write_all(&sample.to_le_bytes())?;
            }
        }
    }
    writer.flush()?;
    println!("Rendered stereo processing output to {path} ({rate} Hz)");
    Ok(())
}
fn stream<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut runner: Runner,
    gain: f32,
    finished: Arc<AtomicBool>,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    let channels = config.channels as usize;
    device.build_output_stream(
        config,
        move |output: &mut [T], _| {
            let frames = output.len() / channels;
            let mut offset = 0;
            while offset < frames {
                let n = runner.next((frames - offset).min(FRAMES));
                if n == 0 {
                    for value in &mut output[offset * channels..] {
                        *value = T::from_sample(0.);
                    }
                    finished.store(true, Ordering::Release);
                    break;
                }
                for i in 0..n {
                    for c in 0..channels {
                        let v = if channels == 1 {
                            (runner.bank.output(0)[i] + runner.bank.output(1)[i]) * 0.5
                        } else {
                            runner.bank.output(c.min(1))[i]
                        };
                        output[(offset + i) * channels + c] = T::from_sample(v * gain);
                    }
                }
                offset += n;
            }
        },
        |e| eprintln!("Processing output error: {e}"),
        None,
    )
}
struct Options {
    method: usize,
    preset: usize,
    frequency: f32,
    source: u32,
    wet: f32,
    bypass: bool,
    input_db: f32,
    output_db: f32,
    seconds: Option<f32>,
    gain: f32,
    overrides: Vec<(usize, f32)>,
}
fn configured(options: &Options, rate: u32, wav: Option<Wav>) -> Runner {
    let mut bank = ProcessorBank::new(rate as f32);
    let p = apply_processor_preset(&mut bank, options.method, options.preset);
    let mut params = p.params;
    for (slot, value) in &options.overrides {
        params[*slot] = *value;
    }
    bank.set_params(params);
    bank.set_mix(
        options.wet,
        options.bypass,
        options.input_db,
        options.output_db,
    );
    let source = if wav.is_some() { 0 } else { options.source };
    bank.set_source(source, options.frequency, true);
    bank.reset();
    let duration = options.seconds.unwrap_or_else(|| {
        wav.as_ref()
            .map_or(4., |w| w.frames.len() as f32 / w.rate as f32 + 2.)
    });
    let total = (duration * rate as f32).ceil() as usize;
    let stop = wav
        .as_ref()
        .map_or_else(
            || total.saturating_sub((rate as usize).min(total / 4)),
            |w| ((w.frames.len() as f64 / w.rate as f64) * rate as f64).ceil() as usize,
        )
        .min(total);
    let resampler = wav.as_ref().map(|w| Resampler::new(w.rate, rate));
    Runner {
        bank,
        wav,
        resampler,
        cursor: 0,
        total,
        stop,
        stopped: false,
        source,
        frequency: options.frequency,
    }
}
pub fn run(args: &[String]) -> Result<(), Error> {
    if args.iter().any(|s| s == "--processors") {
        for (i, name) in PROCESSOR_NAMES.iter().enumerate() {
            println!("{i:2}  {}  {name}", PROCESSOR_IDS[i]);
            for (j, p) in PROCESSOR_PRESETS[i].iter().enumerate() {
                println!("    {j}: {}", p.name);
            }
        }
        return Ok(());
    }
    if args.iter().any(|s| s == "--help") {
        println!("synthesis-cpal --processor <name|index> --preset <0..7> [--input file.wav] [--render output.wav] [--seconds N] [--sample-rate Hz] [--source 1..7] [--frequency Hz] [--wet 0..1] [--bypass] [--input-db dB] [--output-db dB] [--gain 0..1] [--param slot=value]\n--input processes real mono/stereo PCM16/24/32 or float32 WAV. Offline output preserves its sample rate unless --sample-rate is supplied. Device playback uses bounded windowed-sinc resampling. Without --input, an explicit Rust test source demonstrates the processor. --processors lists all effects; --controls lists normalized slots. Native live capture is not implemented; the browser and FX CLAP support live external input.");
        return Ok(());
    }
    let method_arg = super::flag(args, "--processor").unwrap_or_else(|| "biquad".into());
    let method = PROCESSOR_IDS
        .iter()
        .position(|s| *s == method_arg || s.strip_prefix("fx-") == Some(method_arg.as_str()))
        .or_else(|| method_arg.parse::<usize>().ok())
        .filter(|i| *i < PROCESSOR_NAMES.len())
        .ok_or("Unknown processor; use --processors")?;
    let preset = super::flag(args, "--preset")
        .unwrap_or_else(|| "0".into())
        .parse::<usize>()?;
    if preset >= 8 {
        return Err("Preset must be 0 through 7".into());
    }
    let p = &PROCESSOR_PRESETS[method][preset];
    if args.iter().any(|s| s == "--controls") {
        for (i, name) in PROCESSOR_PARAM_NAMES[method].iter().enumerate() {
            if *name != "Unused" {
                println!("{i:2} {name}: {}", p.params[i]);
            }
        }
        return Ok(());
    }
    let number = |name: &str, fallback: f32| -> Result<f32, Error> {
        Ok(super::flag(args, name)
            .map(|v| v.parse::<f32>())
            .transpose()?
            .unwrap_or(fallback))
    };
    let options = Options {
        method,
        preset,
        frequency: number("--frequency", p.frequency)?,
        source: super::flag(args, "--source")
            .map(|v| v.parse::<u32>())
            .transpose()?
            .unwrap_or(p.source),
        wet: number("--wet", p.wet)?,
        bypass: args.iter().any(|s| s == "--bypass"),
        input_db: number("--input-db", p.input_db)?,
        output_db: number("--output-db", p.output_db)?,
        seconds: super::flag(args, "--seconds")
            .map(|v| v.parse::<f32>())
            .transpose()?,
        gain: number("--gain", 1.)?,
        overrides: super::macro_overrides(args)?,
    };
    if options.source > 7
        || !options.frequency.is_finite()
        || !(20.0..=8000.0).contains(&options.frequency)
        || !options.wet.is_finite()
        || !(0.0..=1.0).contains(&options.wet)
        || !options.input_db.is_finite()
        || !(-36.0..=24.0).contains(&options.input_db)
        || !options.output_db.is_finite()
        || !(-36.0..=24.0).contains(&options.output_db)
        || !options.gain.is_finite()
        || !(0.0..=1.0).contains(&options.gain)
        || options
            .seconds
            .is_some_and(|s| !s.is_finite() || !(0.1..=600.0).contains(&s))
    {
        return Err("Invalid processor level, source, frequency or duration".into());
    }
    let wav = super::flag(args, "--input")
        .map(|path| read_wav(&path))
        .transpose()?;
    if wav.is_none() && options.source == 0 {
        return Err("External source 0 requires --input file.wav".into());
    }
    let requested_rate = super::flag(args, "--sample-rate")
        .map(|v| v.parse::<u32>())
        .transpose()?;
    if requested_rate.is_some_and(|r| !(8000..=192000).contains(&r)) {
        return Err("Sample rate must be 8000 through 192000 Hz".into());
    }
    if let Some(path) = super::flag(args, "--render") {
        let rate = requested_rate.unwrap_or_else(|| wav.as_ref().map_or(48000, |w| w.rate));
        return render_wav(&path, configured(&options, rate, wav), rate, options.gain);
    }
    if requested_rate.is_some() {
        return Err(
            "--sample-rate applies to offline --render; device playback uses its configured rate"
                .into(),
        );
    }
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("No audio output device; use --render")?;
    let supported = device.default_output_config()?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let runner = configured(&options, config.sample_rate.0, wav);
    let finished = Arc::new(AtomicBool::new(false));
    let stream = match format {
        SampleFormat::F32 => {
            stream::<f32>(&device, &config, runner, options.gain, finished.clone())?
        }
        SampleFormat::I16 => {
            stream::<i16>(&device, &config, runner, options.gain, finished.clone())?
        }
        SampleFormat::U16 => {
            stream::<u16>(&device, &config, runner, options.gain, finished.clone())?
        }
        _ => return Err(format!("Unsupported output format {format}").into()),
    };
    println!("Playing {} / {}", PROCESSOR_NAMES[method], p.name);
    stream.play()?;
    while !finished.load(Ordering::Acquire) {
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn wav_bytes() -> Vec<u8> {
        let mut data = Vec::new();
        wav_header(&mut data, 48000, 3).unwrap();
        for frame in [[16384i16, -8192i16], [0, 32767], [-32768, 0]] {
            for x in frame {
                data.extend_from_slice(&x.to_le_bytes());
            }
        }
        data
    }
    #[test]
    fn stereo_pcm_decode_is_real_and_rejects_malformed_files() {
        let bytes = wav_bytes();
        let wav = decode_wav(&bytes).unwrap();
        assert_eq!(wav.rate, 48000);
        assert_eq!(wav.frames[0], [0.5, -0.25]);
        assert_eq!(wav.frames[2], [-1., 0.]);
        assert!(decode_wav(&bytes[..bytes.len() - 1]).is_err());
        assert!(decode_wav(b"not wav").is_err());
        let mut wrong = bytes;
        wrong[22] = 7;
        assert!(decode_wav(&wrong).is_err());
    }
    #[test]
    fn rate_conversion_preserves_same_rate_and_rejects_downsample_aliases() {
        let wav = Wav {
            rate: 48000,
            frames: (0..48000)
                .map(|i| [(std::f32::consts::TAU * 12000. * i as f32 / 48000.).cos() * 0.3; 2])
                .collect(),
        };
        let same = Resampler::new(48000, 48000);
        assert_eq!(same.sample(&wav, 101), wav.frames[101]);
        let reduced = Resampler::new(48000, 16000);
        let energy = (100..4000)
            .map(|i| reduced.sample(&wav, i)[0].powi(2))
            .sum::<f32>()
            / 3900.;
        assert!(energy.sqrt() < 0.003, "alias RMS {}", energy.sqrt());
    }
    #[test]
    fn native_file_processing_uses_stereo_pcm_and_preserves_the_file_rate() {
        let wav = decode_wav(&wav_bytes()).unwrap();
        let options = Options {
            method: 0,
            preset: 0,
            frequency: 220.,
            source: 0,
            wet: 0.,
            bypass: false,
            input_db: 0.,
            output_db: 0.,
            seconds: Some(0.1),
            gain: 1.,
            overrides: vec![],
        };
        let mut runner = configured(&options, 48000, Some(wav));
        assert_eq!(runner.next(128), 3);
        assert_eq!(runner.bank.output(0)[0], 0.5);
        assert_eq!(runner.bank.output(1)[0], -0.25);
        assert_eq!(runner.cursor, 3);
        assert!(runner.next(128) > 0);
        assert!(runner.stopped);
    }
}
