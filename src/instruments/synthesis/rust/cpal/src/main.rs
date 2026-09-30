//! CPAL device playback and deterministic WAV rendering of the exact browser DSP.
mod processing;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use std::{
    env,
    fs::File,
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use synthesis_core::{polyphony::VoiceBank, Engine};
use synthesis_presets::{apply_preset, METHOD_IDS, METHOD_NAMES, PARAM_NAMES, PRESETS};

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn macro_overrides(args: &[String]) -> Result<Vec<(usize, f32)>, Box<dyn std::error::Error>> {
    let mut overrides = Vec::new();
    for (i, arg) in args.iter().enumerate() {
        if arg != "--param" {
            continue;
        }
        let (slot, value) = args
            .get(i + 1)
            .and_then(|s| s.split_once('='))
            .ok_or("--param expects slot=value, with slot 0..15 and normalized value 0..1")?;
        let slot = slot.parse::<usize>()?;
        let value = value.parse::<f32>()?;
        if slot >= 16 || !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err("Invalid synthesis parameter override".into());
        }
        overrides.push((slot, value));
    }
    Ok(overrides)
}

enum SynthSource {
    Mono(Engine),
    Poly(VoiceBank),
}
impl SynthSource {
    fn render(&mut self, output: &mut [f32]) {
        match self {
            Self::Mono(engine) => engine.render(output),
            Self::Poly(bank) => bank.render(output),
        }
    }
    fn note_off(&mut self) {
        match self {
            Self::Mono(engine) => engine.note_off(),
            Self::Poly(bank) => bank.all_notes_off(),
        }
    }
}

fn note_frequencies(args: &[String]) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let Some(notes) = flag(args, "--notes") else {
        if args.iter().any(|arg| arg == "--notes") {
            return Err("--notes expects 1..8 comma-separated frequencies in Hz".into());
        }
        return Ok(Vec::new());
    };
    let notes: Vec<f32> = notes
        .split(',')
        .map(|s| s.trim().parse())
        .collect::<Result<_, _>>()?;
    if notes.is_empty()
        || notes.len() > 8
        || notes
            .iter()
            .any(|n| !n.is_finite() || !(20.0..=8000.0).contains(n))
    {
        return Err("--notes expects 1..8 frequencies from 20 to 8000 Hz".into());
    }
    if notes.len() > 1 && !args.iter().any(|arg| arg == "--poly") {
        return Err("Use --poly to render simultaneous --notes".into());
    }
    if args.iter().any(|arg| arg == "--frequency") {
        return Err("Choose --notes or --frequency, not both".into());
    }
    Ok(notes)
}

fn configured(
    sample_rate: f32,
    method: usize,
    preset: usize,
    frequency: Option<f32>,
    overrides: &[(usize, f32)],
    polyphonic: bool,
    notes: &[f32],
) -> SynthSource {
    let p = &PRESETS[method][preset];
    let mut params = p.params;
    for &(slot, value) in overrides {
        params[slot] = value;
    }
    if polyphonic {
        let mut bank = VoiceBank::new(sample_rate);
        bank.set_method(method as u32);
        bank.set_params(params);
        bank.set_level_trim_db(p.level_trim_db);
        bank.set_envelope(p.envelope[0], p.envelope[1], p.envelope[2], p.envelope[3]);
        if notes.is_empty() {
            bank.note_on(0, frequency.unwrap_or(p.frequency), 0.75);
        } else {
            for (id, frequency) in notes.iter().enumerate() {
                bank.note_on(id as u32, *frequency, 0.75);
            }
        }
        SynthSource::Poly(bank)
    } else {
        let mut engine = Engine::new(sample_rate);
        apply_preset(&mut engine, method, preset);
        engine.set_params(params);
        engine.note_on(
            notes.first().copied().or(frequency).unwrap_or(p.frequency),
            0.75,
        );
        SynthSource::Mono(engine)
    }
}

fn render_wav(
    path: &str,
    mut engine: SynthSource,
    sample_rate: u32,
    seconds: f32,
    gain: f32,
) -> Result<(), Box<dyn std::error::Error>> {
    let count = (sample_rate as f32 * seconds) as usize;
    let release = count.saturating_sub((sample_rate as usize).min(count / 4));
    let mut file = File::create(path)?;
    let byte_count = (count * 2) as u32;
    file.write_all(b"RIFF")?;
    file.write_all(&(byte_count + 36).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&(sample_rate * 2).to_le_bytes())?;
    file.write_all(&2u16.to_le_bytes())?;
    file.write_all(&16u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&byte_count.to_le_bytes())?;
    let mut block = [0.0; 128];
    let mut cursor = 0;
    let mut released = false;
    while cursor < count {
        if cursor >= release && !released {
            engine.note_off();
            released = true;
        }
        let len = (count - cursor).min(128).min(if cursor < release {
            release - cursor
        } else {
            128
        });
        engine.render(&mut block[..len]);
        for sample in &block[..len] {
            let pcm = ((sample * gain).clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            file.write_all(&pcm.to_le_bytes())?;
        }
        cursor += len;
    }
    println!("Rendered {path} ({seconds:.1} s, {sample_rate} Hz)");
    Ok(())
}

fn stream<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut engine: SynthSource,
    seconds: f32,
    gain: f32,
    finished: Arc<AtomicBool>,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    let channels = config.channels as usize;
    let total = (seconds * config.sample_rate.0 as f32) as usize;
    let release = total.saturating_sub((config.sample_rate.0 as usize).min(total / 4));
    let mut cursor = 0usize;
    let mut released = false;
    let mut block = [0.0f32; 128];
    device.build_output_stream(
        config,
        move |output: &mut [T], _| {
            for chunk in output.chunks_mut(channels * 128) {
                let length = chunk.len() / channels;
                if cursor >= release && !released {
                    engine.note_off();
                    released = true;
                }
                if cursor >= total {
                    block.fill(0.0);
                    finished.store(true, Ordering::Release);
                } else {
                    engine.render(&mut block[..length]);
                }
                for (frame, sample) in chunk.chunks_mut(channels).zip(block.iter()) {
                    for channel in frame {
                        *channel = T::from_sample(*sample * gain);
                    }
                }
                cursor += length;
            }
        },
        |error| eprintln!("Audio stream error: {error}"),
        None,
    )
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args
        .iter()
        .any(|s| s == "--processor" || s == "--processors" || s == "--input")
    {
        return processing::run(&args);
    }
    if args.iter().any(|a| a == "--list") {
        for (i, name) in METHOD_NAMES.iter().enumerate() {
            println!("{i:2}  {}  {name}", METHOD_IDS[i]);
            for (j, p) in PRESETS[i].iter().enumerate() {
                println!("    {j}: {}", p.name);
            }
        }
        return Ok(());
    }
    if args.iter().any(|a| a == "--help") {
        println!("synthesis-cpal --method <name|index> --preset <0..7> [--frequency Hz | --notes 220,277.18,329.63] [--poly] [--seconds 4] [--gain 0.7] [--render file.wav] [--param slot=value]\nMono is the default. --poly enables eight independent voices; --notes plays up to eight frequencies together.\n--param may repeat for normalized synthesis slots 0..15; --controls lists their names.\n--list lists every synthesis method and preset. --processors lists the stereo FX bank. Device playback uses CPAL; --render does not open an audio device.");
        return Ok(());
    }
    let method_arg = flag(&args, "--method").unwrap_or_else(|| "additive".into());
    let method = METHOD_IDS
        .iter()
        .position(|id| *id == method_arg)
        .or_else(|| method_arg.parse::<usize>().ok())
        .filter(|m| *m < METHOD_NAMES.len())
        .ok_or("Unknown method; use --list")?;
    let preset = flag(&args, "--preset")
        .unwrap_or_else(|| "0".into())
        .parse::<usize>()?;
    if preset >= 8 {
        return Err("Preset must be 0 through 7".into());
    }
    if args.iter().any(|a| a == "--controls") {
        for (slot, name) in PARAM_NAMES[method].iter().enumerate() {
            if *name != "Unused" {
                println!("{slot:2}  {name}: {}", PRESETS[method][preset].params[slot]);
            }
        }
        return Ok(());
    }
    let overrides = macro_overrides(&args)?;
    let polyphonic = args.iter().any(|arg| arg == "--poly");
    let notes = note_frequencies(&args)?;
    let seconds = flag(&args, "--seconds")
        .unwrap_or_else(|| "4".into())
        .parse::<f32>()?;
    let gain = flag(&args, "--gain")
        .unwrap_or_else(|| "0.7".into())
        .parse::<f32>()?;
    let frequency = flag(&args, "--frequency")
        .map(|s| s.parse::<f32>())
        .transpose()?;
    if !seconds.is_finite()
        || !(1.0..=120.0).contains(&seconds)
        || !gain.is_finite()
        || !(0.0..=1.0).contains(&gain)
        || frequency.is_some_and(|f| !f.is_finite() || !(20.0..=8000.0).contains(&f))
    {
        return Err("Invalid duration, gain, or frequency".into());
    }
    if let Some(path) = flag(&args, "--render") {
        return render_wav(
            &path,
            configured(
                48000.0, method, preset, frequency, &overrides, polyphonic, &notes,
            ),
            48000,
            seconds,
            gain,
        );
    }
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No audio output device. Use --render file.wav for offline output.")?;
    let supported = device.default_output_config()?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let engine = configured(
        config.sample_rate.0 as f32,
        method,
        preset,
        frequency,
        &overrides,
        polyphonic,
        &notes,
    );
    let finished = Arc::new(AtomicBool::new(false));
    let stream = match format {
        SampleFormat::F32 => {
            stream::<f32>(&device, &config, engine, seconds, gain, finished.clone())?
        }
        SampleFormat::I16 => {
            stream::<i16>(&device, &config, engine, seconds, gain, finished.clone())?
        }
        SampleFormat::U16 => {
            stream::<u16>(&device, &config, engine, seconds, gain, finished.clone())?
        }
        _ => return Err(format!("Unsupported output format {format}").into()),
    };
    println!(
        "Playing {} / {} ({}, {} note{}) for {seconds:.1} seconds",
        METHOD_NAMES[method],
        PRESETS[method][preset].name,
        if polyphonic { "Poly" } else { "Mono" },
        notes.len().max(1),
        if notes.len() > 1 { "s" } else { "" }
    );
    stream.play()?;
    while !finished.load(Ordering::Acquire) {
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalized_macro_overrides_accept_new_slots_and_reject_invalid_values() {
        let args = ["--param", "0=0.4", "--param", "15=1"].map(str::to_owned);
        assert_eq!(macro_overrides(&args).unwrap(), vec![(0, 0.4), (15, 1.0)]);
        for bad in ["16=0.5", "8=NaN", "3=-0.1", "1=1.1", "missing"] {
            assert!(macro_overrides(&["--param".into(), bad.into()]).is_err());
        }
    }
    #[test]
    fn wav_release_matches_a_single_note_off() {
        fn source() -> Engine {
            let mut engine = Engine::new(8000.0);
            engine.set_method(2);
            engine.set_envelope(0.001, 0.01, 1.0, 0.05);
            engine.set_level_trim_db(6.0);
            engine.reset();
            engine.note_on(220.0, 0.75);
            engine
        }
        let path =
            env::temp_dir().join(format!("synthesis-cpal-release-{}.wav", std::process::id()));
        render_wav(
            path.to_str().unwrap(),
            SynthSource::Mono(source()),
            8000,
            1.0,
            0.7,
        )
        .unwrap();
        let actual = std::fs::read(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        let mut reference = source();
        let mut samples = vec![0.0; 8000];
        reference.render(&mut samples[..6000]);
        reference.note_off();
        reference.render(&mut samples[6000..]);
        let expected: Vec<u8> = samples
            .iter()
            .flat_map(|sample| {
                (((sample * 0.7).clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16).to_le_bytes()
            })
            .collect();
        assert_eq!(&actual[44..], expected);
    }
    #[test]
    fn poly_note_argument_validation_and_default_mono_are_explicit() {
        let args = ["--poly", "--notes", "220, 277.18,329.63"].map(str::to_owned);
        assert_eq!(note_frequencies(&args).unwrap(), vec![220., 277.18, 329.63]);
        assert!(note_frequencies(&[]).unwrap().is_empty());
        for args in [
            vec!["--notes", "220,330"],
            vec!["--poly", "--notes", "NaN"],
            vec!["--poly", "--notes", "19"],
            vec!["--notes"],
            vec!["--poly", "--notes", "20,30,40,50,60,70,80,90,100"],
            vec!["--poly", "--notes", "220", "--frequency", "330"],
        ] {
            assert!(
                note_frequencies(&args.into_iter().map(str::to_owned).collect::<Vec<_>>()).is_err()
            );
        }
        assert!(matches!(
            configured(8000., 2, 0, None, &[], false, &[]),
            SynthSource::Mono(_)
        ));
        let mut poly = configured(8000., 2, 0, None, &[], true, &[220., 277.18, 329.63]);
        let SynthSource::Poly(bank) = &poly else {
            panic!("expected Poly")
        };
        assert_eq!(bank.voice_count(), 3);
        let mut samples = [0.; 2048];
        poly.render(&mut samples);
        assert!(samples
            .iter()
            .all(|sample| sample.is_finite() && sample.abs() <= 0.98));
        assert!(samples.iter().any(|sample| sample.abs() > 0.001));
        poly.note_off();
        for _ in 0..16 {
            poly.render(&mut samples);
        }
        let SynthSource::Poly(bank) = &poly else {
            unreachable!()
        };
        assert_eq!(bank.voice_count(), 0);
    }
}
