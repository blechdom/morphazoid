//! The portable core owns the sound; CPAL only transports device samples.
mod audio;
mod bench;
mod options;
mod wav;

use l_system_delay_core::{Engine, Scene};
use options::Options;
use std::{error::Error, fs};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const BLOCK: usize = 128;

fn read_scene(path: &str) -> Result<Scene> {
    if fs::metadata(path)?.len() > 64 * 1024 * 1024 {
        return Err("Scene must be smaller than 64 MiB".into());
    }
    let data = fs::read(path)?;
    let scene: Scene = serde_json::from_slice(&data)?;
    scene.validate()?;
    for event in &scene.events {
        for voice in &event.voices {
            if !voice.delay.is_finite()
                || voice.delay < 0.0
                || !voice.rate.is_finite()
                || voice.rate <= 0.0
                || !voice.gain.is_finite()
                || voice.gain < 0.0
                || !voice.pan.is_finite()
                || !(-1.0..=1.0).contains(&voice.pan)
            {
                return Err("Scene contains a non-finite or invalid voice descriptor".into());
            }
        }
    }
    Ok(scene)
}

fn new_engine(scene: &Scene) -> Result<Engine> {
    Engine::new(
        scene.sample_rate,
        scene.history_seconds,
        scene.max_voices,
        scene.channels,
    )
    .map_err(Into::into)
}

fn apply_initial(engine: &mut Engine, scene: &Scene) -> Result<()> {
    check_stationary(scene)?;
    if let Some(event) = scene.events.first() {
        engine.set_voices(&event.voices, event.limit.unwrap_or(scene.max_voices));
    }
    Ok(())
}

fn check_stationary(scene: &Scene) -> Result<()> {
    if scene.events.len() > 1 || scene.events.first().is_some_and(|e| e.time != 0.0) {
        return Err(
            "Live capture and stationary benchmarks require at most one event at time zero".into(),
        );
    }
    Ok(())
}

fn render(scene: &Scene, source: &[[f32; 2]], seconds: f64, level: f32) -> Result<Vec<[f32; 2]>> {
    let frames = (seconds * scene.sample_rate as f64).round() as usize;
    let mut engine = new_engine(scene)?;
    let mut output = Vec::with_capacity(frames);
    let event_frames: Vec<usize> = scene
        .events
        .iter()
        .map(|e| (e.time * scene.sample_rate as f64).round() as usize)
        .collect();
    let mut event_index = 0;
    let mut cursor = 0;
    let mut block_input = [[0.0; 2]; BLOCK];
    let mut block_output = [[0.0; 2]; BLOCK];
    while cursor < frames {
        while event_index < scene.events.len() && event_frames[event_index] <= cursor {
            let event = &scene.events[event_index];
            engine.set_voices(&event.voices, event.limit.unwrap_or(scene.max_voices));
            event_index += 1;
        }
        let count = BLOCK.min(frames - cursor).min(
            event_frames
                .get(event_index)
                .map_or(BLOCK, |next| next - cursor),
        );
        for (offset, input) in block_input[..count].iter_mut().enumerate() {
            *input = source.get(cursor + offset).copied().unwrap_or([0.0; 2]);
        }
        engine.process_block(&block_input[..count], &mut block_output[..count]);
        for (offset, sample) in block_output[..count].iter().enumerate() {
            if sample.iter().any(|s| !s.is_finite()) {
                return Err(format!(
                    "Core produced non-finite output at frame {}",
                    cursor + offset
                )
                .into());
            }
            output.push([sample[0] * level, sample[1] * level]);
        }
        cursor += count;
    }
    Ok(output)
}

fn main() -> Result<()> {
    let options = Options::parse(std::env::args().skip(1))?;
    if options.help {
        println!("{}", options::HELP);
        return Ok(());
    }
    if options.devices {
        return audio::devices();
    }
    let scene = read_scene(options.scene.as_deref().ok_or("--scene is required")?)?;
    if options.live {
        return audio::live(&scene, options.seconds, options.level.unwrap_or(0.58));
    }
    let source = match options.input.as_deref() {
        Some(path) => wav::read(path, scene.sample_rate)?,
        None => wav::demo(scene.sample_rate, options.seconds),
    };
    if let Some(path) = options.bench.as_deref() {
        return bench::run(
            path,
            &scene,
            &source,
            options.bench_blocks,
            options.bench_warmup,
            options.bench_repetitions,
        );
    }
    let offline = options.render.is_some();
    let output = render(
        &scene,
        &source,
        options.seconds,
        options.level.unwrap_or(if offline { 1.0 } else { 0.58 }),
    )?;
    if let Some(path) = options.render.as_deref() {
        wav::write(path, scene.sample_rate, &output)?;
        println!(
            "Rendered {path}: {} stereo frames at {} Hz",
            output.len(),
            scene.sample_rate
        );
        Ok(())
    } else {
        audio::play(output, scene.sample_rate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use l_system_delay_core::{VoiceEvent, VoiceSpec};

    #[test]
    fn timeline_has_exact_silent_prefix_smooth_release_and_repeatable_output() {
        let scene = Scene {
            sample_rate: 8000,
            history_seconds: 4.0,
            channels: 1,
            max_voices: 4,
            events: vec![
                VoiceEvent {
                    time: 0.301125,
                    voices: vec![VoiceSpec {
                        key: "one".into(),
                        delay: 0.05,
                        rate: 1.0,
                        gain: 0.5,
                        pan: 1.0,
                    }],
                    limit: None,
                },
                VoiceEvent {
                    time: 0.55,
                    voices: vec![],
                    limit: None,
                },
            ],
        };
        let source = vec![[0.2; 2]; 8000];
        let output = render(&scene, &source, 1.0, 1.0).unwrap();
        assert_eq!(output.len(), 8000);
        assert!(output[..2409].iter().flatten().all(|x| *x == 0.0));
        assert!(output.iter().all(|x| x[0] == 0.0));
        assert!(output[3000..4000].iter().any(|x| x[1] > 0.08));
        assert!(output[7000..].iter().flatten().all(|x| x.abs() < 0.0001));
        assert_eq!(output, render(&scene, &source, 1.0, 1.0).unwrap());
    }
}
