use crate::Result;
use hound::{SampleFormat, WavReader, WavSpec, WavWriter};
use std::f64::consts::TAU;

pub fn read(path: &str, rate: u32) -> Result<Vec<[f32; 2]>> {
    if std::fs::metadata(path)?.len() > 256 * 1024 * 1024 {
        return Err("Input WAV must be smaller than 256 MiB".into());
    }
    let mut reader = WavReader::open(path)?;
    let spec = reader.spec();
    if !(1..=2).contains(&spec.channels) {
        return Err("Input WAV must have one or two channels".into());
    }
    if spec.sample_rate != rate {
        return Err(format!("Input WAV is {} Hz; scene is {rate} Hz. Resample the input explicitly before comparing.", spec.sample_rate).into());
    }
    let samples: Vec<f32> = match spec.sample_format {
        SampleFormat::Float if spec.bits_per_sample == 32 => reader
            .samples::<f32>()
            .collect::<std::result::Result<_, _>>(
        )?,
        SampleFormat::Int if (1..=32).contains(&spec.bits_per_sample) => {
            let scale = 2_f64.powi(spec.bits_per_sample as i32 - 1) as f32;
            reader
                .samples::<i32>()
                .map(|v| v.map(|x| x as f32 / scale))
                .collect::<std::result::Result<_, _>>()?
        }
        _ => return Err("Input WAV must be PCM up to 32 bits or IEEE float32".into()),
    };
    if samples.is_empty() || !samples.len().is_multiple_of(spec.channels as usize) {
        return Err("Input WAV is empty or has an incomplete frame".into());
    }
    if samples.iter().any(|s| !s.is_finite()) {
        return Err("Input WAV contains non-finite samples".into());
    }
    Ok(samples
        .chunks_exact(spec.channels as usize)
        .map(|frame| [frame[0], *frame.get(1).unwrap_or(&frame[0])])
        .collect())
}

pub fn write(path: &str, rate: u32, frames: &[[f32; 2]]) -> Result<()> {
    let mut writer = WavWriter::create(
        path,
        WavSpec {
            channels: 2,
            sample_rate: rate,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        },
    )?;
    for frame in frames {
        for sample in frame {
            writer.write_sample(*sample)?;
        }
    }
    writer.finalize()?;
    Ok(())
}

pub fn demo(rate: u32, seconds: f64) -> Vec<[f32; 2]> {
    let frames = (rate as f64 * seconds).round() as usize;
    let mut seed = 0x65a2_5af1_u32;
    (0..frames)
        .map(|i| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let t = i as f64 / rate as f64;
            let local = t % 0.5;
            let envelope = (-local * 12.0).exp();
            let noise = (seed as f64 / u32::MAX as f64 * 2.0 - 1.0) * (-local * 80.0).exp();
            let chord = [173.0, 259.5, 346.0]
                .iter()
                .map(|f| (TAU * f * t).sin())
                .sum::<f64>();
            [(envelope * chord * 0.07 + noise * 0.025) as f32; 2]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn float_wav_preserves_stereo_and_fails_explicitly_on_rate_mismatch() {
        let path =
            std::env::temp_dir().join(format!("l-delay-cpal-wav-{}.wav", std::process::id()));
        let frames = [[0.25, -0.125], [0.0, 0.75], [-0.5, 0.0]];
        write(path.to_str().unwrap(), 48_000, &frames).unwrap();
        assert_eq!(read(path.to_str().unwrap(), 48_000).unwrap(), frames);
        assert!(read(path.to_str().unwrap(), 44_100).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
