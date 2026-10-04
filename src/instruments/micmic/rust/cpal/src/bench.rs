use crate::{apply_initial, check_stationary, new_engine, Result, BLOCK};
use l_system_delay_core::{Engine, Scene};
use serde_json::json;
use std::{fs, time::Instant};

fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * fraction).ceil() as usize]
}

fn prepared(scene: &Scene, input: &[[f32; 2]], warmup: usize) -> Result<(Engine, usize)> {
    let mut engine = new_engine(scene)?;
    let prefill = (scene.sample_rate as f64 * scene.history_seconds).ceil() as usize;
    let mut cursor = 0;
    for start in (0..prefill).step_by(BLOCK) {
        for _ in start..(start + BLOCK).min(prefill) {
            let _ = engine.process_frame(input[cursor % input.len()]);
            cursor += 1;
        }
        engine.finish_block();
    }
    apply_initial(&mut engine, scene)?;
    let mut source = [[0.0; 2]; BLOCK];
    let mut output = [[0.0; 2]; BLOCK];
    for _ in 0..warmup {
        for frame in &mut source {
            *frame = input[cursor % input.len()];
            cursor += 1;
        }
        engine.process_block(&source, &mut output);
    }
    Ok((engine, cursor))
}

pub fn run(
    path: &str,
    scene: &Scene,
    input: &[[f32; 2]],
    blocks: usize,
    warmup: usize,
    repetitions: usize,
) -> Result<()> {
    // Check stationary configuration before doing a potentially large prefill.
    check_stationary(scene)?;
    let prefill = (scene.sample_rate as f64 * scene.history_seconds).ceil() as usize;
    let mut durations = Vec::with_capacity(blocks * repetitions);
    let mut peak = 0_f32;
    let mut energy = 0_f64;
    let mut active = 0;
    let mut allocated_bytes = 0;
    let mut target_voices = 0;
    let mut source = [[0_f32; 2]; BLOCK];
    let mut output = [[0_f32; 2]; BLOCK];
    let mut repetition_reports = Vec::with_capacity(repetitions);
    for rep in 0..repetitions {
        let (mut engine, mut cursor) = prepared(scene, input, warmup)?;
        active = active.max(engine.active_voice_count());
        allocated_bytes = engine.allocated_bytes();
        target_voices = engine.target_voice_count();
        let mut total_ms = 0.0;
        for _ in 0..blocks {
            for frame in &mut source {
                *frame = input[cursor % input.len()];
                cursor += 1;
            }
            let start = Instant::now();
            engine.process_block(&source, &mut output);
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            durations.push(ms);
            total_ms += ms;
            active = active.max(engine.active_voice_count());
            for sample in output.iter().flatten() {
                if !sample.is_finite() {
                    return Err("Core produced non-finite benchmark output".into());
                }
                peak = peak.max(sample.abs());
                energy += (*sample as f64).powi(2);
            }
        }
        repetition_reports.push(
            json!({"repetition": rep, "totalMs": total_ms, "meanMs": total_ms / blocks as f64}),
        );
    }
    durations.sort_by(f64::total_cmp);
    let total_ms: f64 = durations.iter().sum();
    let deadline_ms = BLOCK as f64 / scene.sample_rate as f64 * 1000.0;
    let report = json!({
        "engine": "l-system-delay-core", "sampleRate": scene.sample_rate, "channels": scene.channels,
        "blockFrames": BLOCK, "maxVoices": scene.max_voices, "activeVoices": active,
        "allocatedBytes": allocated_bytes, "targetVoices": target_voices,
        "requestedVoices": scene.events.first().map_or(0, |e| e.voices.len()),
        "prefillFrames": prefill, "warmupBlocks": warmup, "repetitions": repetitions,
        "blocksPerRepetition": blocks, "peak": peak, "rms": (energy / (durations.len() * BLOCK * 2) as f64).sqrt(),
        "timing": {"blocks": durations.len(), "meanMs": total_ms / durations.len() as f64,
            "medianMs": percentile(&durations, 0.5), "p50Ms": percentile(&durations, 0.5), "p95Ms": percentile(&durations, 0.95),
            "p99Ms": percentile(&durations, 0.99), "maxMs": durations[durations.len() - 1],
            "deadlineMs": deadline_ms, "deadlineMisses": durations.iter().filter(|t| **t > deadline_ms).count(),
            "realtimeFactor": total_ms / (durations.len() as f64 * deadline_ms)},
        "runs": repetition_reports,
        "memoryMeasurement": "History, window, reserved voice structs and installed key capacities; excludes allocator overhead, control-thread temporary maps, source/render buffers and CPAL/ring buffers.",
        "method": "Each repetition uses a fresh engine and identical periodic-source history prefill with voices disabled; voice warmup and source preparation are untimed. Process_block (including internal finish_block) timed for stationary 128-frame blocks. Offline CPU measurement; no device underrun guarantee."
    });
    let json = serde_json::to_string_pretty(&report)?;
    fs::write(path, json.clone() + "\n")?;
    println!("{json}");
    Ok(())
}
