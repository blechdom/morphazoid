//! Persistent native audio. All control messages and their owned buffers are
//! reclaimed on the server thread; callbacks only use numeric preallocated DSP.
use crate::{
    adaptive::Adaptive,
    conditioning::PreparedMastering,
    envelope::{
        History as EnvelopeHistory, Sampler as EnvelopeSampler, Snapshot as EnvelopeSnapshot,
    },
    model::pool_keys,
    performance::{Performance, Source},
};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SampleRate, SizedSample, StreamConfig,
};
use crossbeam_queue::ArrayQueue;
use l_system_delay_core::{Engine, PoolTarget, PreparedPool, TAP_ACTIVITY_CAPACITY};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const BLOCK: usize = 128;
type Frame = [f32; 2];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSnapshot {
    pub sample_rate: u32,
    pub device: String,
    pub input_device: Option<String>,
    pub active_voices: usize,
    pub installed_capacity: usize,
    pub generation_activity: Vec<f32>,
    pub generation_voice_counts: Vec<usize>,
    pub tap_activity: Vec<f32>,
    pub input_envelope: EnvelopeSnapshot,
    pub tap_voice_indices: Vec<i64>,
    pub wet_bus_gain: f32,
    pub topology_revision: u64,
    pub calibrated_voices: usize,
    pub target_voices: usize,
    pub voice_limit: usize,
    pub cpu_load: f32,
    pub peak_load: f32,
    pub input_peak: f32,
    pub output_peak: f32,
    pub output_left_peak: f32,
    pub output_right_peak: f32,
    pub gain_reduction_db: f32,
    pub underruns: usize,
    pub overruns: usize,
    pub deadline_misses: usize,
    pub elapsed_seconds: f64,
    pub automatic: bool,
    pub source: Source,
    pub failure: Option<String>,
}

struct Activity([AtomicU32; 256]);
impl Default for Activity {
    fn default() -> Self {
        Self(std::array::from_fn(|_| AtomicU32::new(0)))
    }
}

struct GenerationCounts([AtomicUsize; 53]);
impl Default for GenerationCounts {
    fn default() -> Self {
        Self(std::array::from_fn(|_| AtomicUsize::new(0)))
    }
}

struct TapTelemetry {
    sequence: AtomicU64,
    revision: AtomicU64,
    count: AtomicUsize,
    levels: [AtomicU32; TAP_ACTIVITY_CAPACITY],
    indices: [AtomicUsize; TAP_ACTIVITY_CAPACITY],
    wet_bus_gain: AtomicU32,
    generation_voice_counts: GenerationCounts,
}

impl Default for TapTelemetry {
    fn default() -> Self {
        Self {
            sequence: AtomicU64::new(0),
            revision: AtomicU64::new(0),
            count: AtomicUsize::new(0),
            levels: std::array::from_fn(|_| AtomicU32::new(0)),
            indices: std::array::from_fn(|_| AtomicUsize::new(usize::MAX)),
            wet_bus_gain: AtomicU32::new(0),
            generation_voice_counts: GenerationCounts::default(),
        }
    }
}

impl TapTelemetry {
    /// Control thread only. A bounded retry avoids waiting on the audio callback.
    /// Never pair levels with indices from a different topology publication.
    fn snapshot(&self) -> (Vec<f32>, Vec<i64>, f32, u64, Vec<usize>) {
        for _ in 0..3 {
            let sequence = self.sequence.load(Ordering::Acquire);
            if !sequence.is_multiple_of(2) {
                continue;
            }
            let count = self
                .count
                .load(Ordering::Relaxed)
                .min(TAP_ACTIVITY_CAPACITY);
            let mut levels: Vec<_> = self
                .levels
                .iter()
                .take(count)
                .map(|level| f32::from_bits(level.load(Ordering::Relaxed)))
                .collect();
            let mut indices: Vec<_> = self
                .indices
                .iter()
                .take(count)
                .map(|index| {
                    let value = index.load(Ordering::Relaxed);
                    if value == usize::MAX {
                        -1
                    } else {
                        value as i64
                    }
                })
                .collect();
            let wet = f32::from_bits(self.wet_bus_gain.load(Ordering::Relaxed));
            let revision = self.revision.load(Ordering::Relaxed);
            let counts = self
                .generation_voice_counts
                .0
                .iter()
                .map(|count| count.load(Ordering::Relaxed))
                .collect();
            std::sync::atomic::fence(Ordering::Acquire);
            if self.sequence.load(Ordering::Relaxed) == sequence {
                let length = indices
                    .iter()
                    .rposition(|index| *index >= 0)
                    .map_or(0, |i| i + 1);
                levels.truncate(length);
                indices.truncate(length);
                return (levels, indices, wet, revision, counts);
            }
        }
        (Vec::new(), Vec::new(), 0., 0, Vec::new())
    }
}

#[derive(Default)]
struct Telemetry {
    activity: Activity,
    taps: TapTelemetry,
    input_envelope: EnvelopeHistory,
    calibrated: AtomicUsize,
    active: AtomicUsize,
    capacity: AtomicUsize,
    target: AtomicUsize,
    limit: AtomicUsize,
    cpu: AtomicU32,
    peak_cpu: AtomicU32,
    input_peak: AtomicU32,
    output_peak: AtomicU32,
    output_left_peak: AtomicU32,
    output_right_peak: AtomicU32,
    gain_reduction_db: AtomicU32,
    underruns: AtomicUsize,
    overruns: AtomicUsize,
    deadline_misses: AtomicUsize,
    frames: AtomicU64,
    automatic: AtomicBool,
    mic: AtomicBool,
    failure: AtomicU8,
    stopping: AtomicBool,
    stopped: AtomicBool,
}

/// Owned control-thread payload. All three buffers return together for
/// reclamation after the callback copies their numeric state into the pool.
pub struct PoolUpdate {
    pub revision: u64,
    pub pitch_offset: f64,
    pub phase_seeds: Vec<u32>,
    pub targets: Vec<PoolTarget>,
    pub ranks: Vec<usize>,
    pub groups: Vec<u8>,
    pub wet_normalization: f64,
    pub growth: Option<PreparedPool>,
}

impl PoolUpdate {
    #[cfg(test)]
    fn plain(targets: Vec<PoolTarget>) -> Self {
        let count = targets.len();
        Self {
            revision: 1,
            pitch_offset: 0.,
            phase_seeds: Vec::new(),
            targets,
            ranks: (0..count).collect(),
            groups: vec![0; count],
            wet_normalization: 1.0,
            growth: None,
        }
    }
}

enum Command {
    Update(PoolUpdate, Performance, PreparedMastering),
    Performance(Performance, PreparedMastering),
    Strike,
}

impl Command {
    // Curve solving and filter coefficients belong on the control thread.
    fn update(pool: PoolUpdate, performance: Performance, rate: u32) -> Self {
        Self::Update(
            pool,
            performance,
            PreparedMastering::new(rate, performance.mastering),
        )
    }

    fn performance(performance: Performance, rate: u32) -> Self {
        Self::Performance(
            performance,
            PreparedMastering::new(rate, performance.mastering),
        )
    }
}

pub struct Session {
    output: Option<cpal::Stream>,
    input: Option<cpal::Stream>,
    commands: Arc<ArrayQueue<Command>>,
    garbage: Arc<ArrayQueue<PoolUpdate>>,
    capture: Arc<ArrayQueue<Frame>>,
    telemetry: Arc<Telemetry>,
    rate: u32,
    device: String,
    input_device: Option<String>,
    capacity: usize,
}

fn validate_targets(targets: &[PoolTarget], capacity: usize) -> Result<(), String> {
    if targets.len() > capacity
        || targets.iter().any(|t| {
            ![t.delay, t.rate, t.gain, t.pan]
                .iter()
                .all(|x| x.is_finite())
        })
    {
        return Err("Delay targets must be finite and fit the installed voice pool".into());
    }
    Ok(())
}

fn validate_pool(pool: &PoolUpdate, capacity: usize) -> Result<(), String> {
    validate_targets(&pool.targets, capacity)?;
    if !pool.wet_normalization.is_finite()
        || !pool.pitch_offset.is_finite()
        || !(-24.0..=24.0).contains(&pool.pitch_offset)
        || !(0.0..=1.0).contains(&pool.wet_normalization)
        || pool.ranks.len() != pool.targets.len()
        || pool.groups.len() != pool.targets.len()
        || (!pool.phase_seeds.is_empty() && pool.phase_seeds.len() != pool.targets.len())
    {
        return Err("Voice priorities and generation groups must match the installed pool".into());
    }
    Ok(())
}

fn demand(targets: &[PoolTarget], performance: Performance, capacity: usize) -> usize {
    performance.capped(
        targets
            .iter()
            .filter(|target| target.gain > 0.0)
            .count()
            .min(capacity),
    )
}

/// Brief warmed DSP search before device playback. It uses a separate history
/// and seeks the requested demand, rather than a built-in 1024/16384 cap.
fn calibrate_capacity(
    rate: u32,
    keys: &[String],
    pool: &PoolUpdate,
    requested: usize,
) -> Result<usize, String> {
    let mut engine = Engine::new(rate, 40., keys.len(), 1)?;
    engine.install_pool(keys)?;
    engine.set_pool_phase_seeds(&pool.phase_seeds);
    engine.set_pitch_offset(pool.pitch_offset)?;
    engine.prepare_calibration_history();
    let input = [[0.03125; 2]; BLOCK];
    let mut output = [[0.; 2]; BLOCK];
    let deadline = BLOCK as f64 / f64::from(rate);
    let mut measure = |count| {
        engine.update_pool_ranked(&pool.targets, &pool.ranks, &pool.groups, count);
        // Descending candidates retain smoothly releasing voices. Retire
        // them before measuring this candidate rather than timing the old pool.
        for _ in 0..((rate as usize * 3).div_ceil(BLOCK)) {
            if engine.active_voice_count() == engine.target_voice_count() {
                break;
            }
            engine.process_block(&input, &mut output);
        }
        for _ in 0..4 {
            engine.process_block(&input, &mut output);
        }
        let mut mean = 0.;
        let mut peak = 0_f64;
        for _ in 0..8 {
            let start = Instant::now();
            engine.process_block(&input, &mut output);
            let load = start.elapsed().as_secs_f64() / deadline;
            mean += load / 8.;
            peak = peak.max(load);
        }
        // Leave initial transport/jitter headroom; the live controller then
        // explores further against actual callback work up to its deadline.
        mean < 0.8 && peak < 0.9
    };
    let mut good = 0;
    let mut candidate = requested.clamp(1, 48);
    let mut bad;
    loop {
        if measure(candidate) {
            good = candidate;
            if good == requested {
                return Ok(good);
            }
            candidate = good.saturating_mul(2).min(requested);
        } else {
            bad = candidate;
            break;
        }
    }
    for _ in 0..8 {
        if bad <= good + 1 {
            break;
        }
        let middle = good + (bad - good) / 2;
        if measure(middle) {
            good = middle;
        } else {
            bad = middle;
        }
    }
    Ok(good.max(1))
}

impl Session {
    pub fn start(pool: PoolUpdate, performance: Performance) -> Result<Self, String> {
        performance.validate()?;
        let keys = pool_keys(pool.targets.len().max(48))?;
        validate_pool(&pool, keys.len())?;
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or("No default output device")?;
        let (format, config) = output_configuration(&device)?;
        let rate = config.sample_rate.0;
        let commands = Arc::new(ArrayQueue::new(8));
        let garbage = Arc::new(ArrayQueue::new(16));
        let capture = Arc::new(ArrayQueue::new((rate as usize / 4).max(BLOCK * 4)));
        let telemetry = Arc::new(Telemetry::default());
        let mut renderer = Renderer::new(
            rate,
            &keys,
            &pool.targets,
            performance,
            commands.clone(),
            garbage.clone(),
            capture.clone(),
            telemetry.clone(),
        )?;
        renderer.engine.set_pool_phase_seeds(&pool.phase_seeds);
        renderer.engine.set_pitch_offset(pool.pitch_offset)?;
        renderer.engine.update_pool_ranked(
            &pool.targets,
            &pool.ranks,
            &pool.groups,
            renderer.telemetry.limit.load(Ordering::Relaxed),
        );
        renderer.wet_normalization = pool.wet_normalization;
        renderer.topology_revision = pool.revision;
        renderer.target_wet_normalization = pool.wet_normalization;
        if performance.automatic && renderer.demand > 0 {
            let measured = calibrate_capacity(rate, &keys, &pool, renderer.demand)?;
            renderer.adaptive.start_at_measured_limit(measured);
            renderer.engine.set_pool_limit(measured);
            telemetry.limit.store(measured, Ordering::Relaxed);
            telemetry.calibrated.store(measured, Ordering::Relaxed);
        }
        let output = formats!(
            format,
            output_stream,
            &device,
            &config,
            renderer,
            telemetry.clone()
        )
        .map_err(|e| e.to_string())?;
        let mut session = Self {
            output: Some(output),
            input: None,
            commands,
            garbage,
            capture,
            telemetry,
            rate,
            device: device.name().map_err(|e| e.to_string())?,
            input_device: None,
            capacity: keys.len(),
        };
        // Seed mode does not inspect or open an input device.
        if performance.source == Source::Mic {
            let (input, name) = session.open_microphone()?;
            session.input = Some(input);
            session.input_device = Some(name);
            std::thread::sleep(Duration::from_millis(20));
        }
        session
            .output
            .as_ref()
            .unwrap()
            .play()
            .map_err(|e| e.to_string())?;
        Ok(session)
    }

    pub fn update(&mut self, mut pool: PoolUpdate, performance: Performance) -> Result<(), String> {
        performance.validate()?;
        let capacity = self.capacity.max(pool.targets.len());
        validate_pool(&pool, capacity)?;
        if capacity > self.capacity {
            let keys = pool_keys(capacity)?;
            pool.growth = Some(PreparedPool::new(&keys)?);
        }
        self.enqueue_performance(Command::update(pool, performance, self.rate), performance)?;
        self.capacity = capacity;
        Ok(())
    }

    pub fn update_performance(&mut self, performance: Performance) -> Result<(), String> {
        performance.validate()?;
        self.enqueue_performance(Command::performance(performance, self.rate), performance)
    }

    fn enqueue_performance(
        &mut self,
        command: Command,
        performance: Performance,
    ) -> Result<(), String> {
        self.reclaim();
        if self.telemetry.failure.load(Ordering::Acquire) >= 2 {
            return Err("Native audio failed; turn Audio off and on to reconnect".into());
        }
        let mut new_input = None;
        if performance.source == Source::Mic && self.input.is_none() {
            while self.capture.pop().is_some() {}
            new_input = Some(self.open_microphone()?);
            std::thread::sleep(Duration::from_millis(20));
        }
        if self.commands.push(command).is_err() {
            return Err("Audio controls are busy; retry this change".into());
        }
        if let Some((input, name)) = new_input {
            self.input = Some(input);
            self.input_device = Some(name);
        }
        if performance.source == Source::Seed {
            self.input.take();
            self.input_device = None;
            let _ =
                self.telemetry
                    .failure
                    .compare_exchange(1, 0, Ordering::AcqRel, Ordering::Acquire);
        }
        Ok(())
    }

    pub fn strike(&self) -> Result<(), String> {
        if self.telemetry.failure.load(Ordering::Acquire) != 0 {
            return Err("Native audio failed; reconnect Audio before striking".into());
        }
        self.commands
            .push(Command::Strike)
            .map_err(|_| "Audio controls are busy; retry the strike".into())
    }

    pub fn reclaim(&mut self) {
        while let Some(buffer) = self.garbage.pop() {
            drop(buffer);
        }
    }

    pub fn snapshot(&self) -> AudioSnapshot {
        let t = &self.telemetry;
        let (
            tap_activity,
            tap_voice_indices,
            wet_bus_gain,
            topology_revision,
            generation_voice_counts,
        ) = t.taps.snapshot();
        AudioSnapshot {
            input_envelope: t.input_envelope.snapshot(),
            generation_voice_counts,
            tap_activity,
            tap_voice_indices,
            wet_bus_gain,
            topology_revision,
            sample_rate: self.rate,
            installed_capacity: t.capacity.load(Ordering::Relaxed),
            calibrated_voices: t.calibrated.load(Ordering::Relaxed),
            generation_activity: t
                .activity
                .0
                .iter()
                .take(53)
                .map(|level| f32::from_bits(level.load(Ordering::Relaxed)))
                .collect(),
            device: self.device.clone(),
            input_device: self.input_device.clone(),
            active_voices: t.active.load(Ordering::Relaxed),
            target_voices: t.target.load(Ordering::Relaxed),
            voice_limit: t.limit.load(Ordering::Relaxed),
            cpu_load: f32::from_bits(t.cpu.load(Ordering::Relaxed)),
            peak_load: f32::from_bits(t.peak_cpu.load(Ordering::Relaxed)),
            input_peak: f32::from_bits(t.input_peak.load(Ordering::Relaxed)),
            output_peak: f32::from_bits(t.output_peak.load(Ordering::Relaxed)),
            output_left_peak: f32::from_bits(t.output_left_peak.load(Ordering::Relaxed)),
            output_right_peak: f32::from_bits(t.output_right_peak.load(Ordering::Relaxed)),
            gain_reduction_db: f32::from_bits(t.gain_reduction_db.load(Ordering::Relaxed)),
            underruns: t.underruns.load(Ordering::Relaxed),
            overruns: t.overruns.load(Ordering::Relaxed),
            deadline_misses: t.deadline_misses.load(Ordering::Relaxed),
            elapsed_seconds: t.frames.load(Ordering::Relaxed) as f64 / self.rate as f64,
            automatic: t.automatic.load(Ordering::Relaxed),
            source: if t.mic.load(Ordering::Relaxed) {
                Source::Mic
            } else {
                Source::Seed
            },
            failure: match t.failure.load(Ordering::Acquire) {
                0 => None,
                1 => Some("Microphone stream failed; select Seed or reconnect Audio".into()),
                2 => Some("Output stream failed; reconnect Audio".into()),
                _ => Some("Audio produced non-finite output and was muted".into()),
            },
        }
    }

    pub fn stop(mut self) {
        self.shutdown();
    }

    fn open_microphone(&self) -> Result<(cpal::Stream, String), String> {
        let input = cpal::default_host()
            .default_input_device()
            .ok_or("No default microphone device")?;
        let (format, config) = configuration_at(&input, self.rate, true)?;
        let name = input.name().map_err(|e| e.to_string())?;
        let stream = formats!(
            format,
            input_stream,
            &input,
            &config,
            self.capture.clone(),
            self.telemetry.clone()
        )
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok((stream, name))
    }

    fn shutdown(&mut self) {
        if self.output.is_none() {
            return;
        }
        self.telemetry.stopping.store(true, Ordering::Release);
        let deadline = Instant::now() + Duration::from_millis(100);
        while !self.telemetry.stopped.load(Ordering::Acquire)
            && self.telemetry.failure.load(Ordering::Acquire) == 0
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(2));
        }
        self.output.take();
        self.input.take();
        self.reclaim();
        // Pending commands and their Vec payloads are also dropped here, outside
        // the callbacks, after the device threads have stopped.
        while self.commands.pop().is_some() {}
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Seed {
    phases: [f64; 3],
    pulse_phase: f64,
    envelope: f64,
    transient: f64,
    rng: u32,
    decay: f64,
    transient_decay: f64,
    rate: f64,
}
impl Seed {
    fn new(rate: u32) -> Self {
        Self {
            phases: [0.0; 3],
            pulse_phase: 1.0,
            envelope: 0.0,
            transient: 0.0,
            rng: 0x65a2_5af1,
            decay: (-1.0 / (rate as f64 * 0.12)).exp(),
            transient_decay: (-1.0 / (rate as f64 * 0.008)).exp(),
            rate: rate as f64,
        }
    }
    fn strike(&mut self) {
        self.envelope = 1.0;
        self.transient = 1.0;
    }
    fn next(&mut self, frequency: f64, pulse_rate: f64) -> f32 {
        self.pulse_phase += pulse_rate / self.rate;
        if self.pulse_phase >= 1.0 {
            self.pulse_phase -= self.pulse_phase.floor();
            self.strike();
        }
        let mut tone = 0.0;
        for (i, (ratio, gain)) in [(1.0, 1.0), (1.5, 0.45), (2.0, 0.2)]
            .into_iter()
            .enumerate()
        {
            self.phases[i] += frequency * ratio / self.rate;
            if self.phases[i] >= 1.0 {
                self.phases[i] -= self.phases[i].floor();
            }
            tone += (std::f64::consts::TAU * self.phases[i]).sin() * gain;
        }
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        let noise = self.rng as f64 / u32::MAX as f64 * 2.0 - 1.0;
        let output = tone * self.envelope * 0.14 + noise * self.transient * 0.025;
        self.envelope *= self.decay;
        self.transient *= self.transient_decay;
        output as f32
    }
}

struct Renderer {
    engine: Engine,
    adaptive: Adaptive,
    performance: Performance,
    commands: Arc<ArrayQueue<Command>>,
    garbage: Arc<ArrayQueue<PoolUpdate>>,
    capture: Arc<ArrayQueue<Frame>>,
    telemetry: Arc<Telemetry>,
    source: [Frame; BLOCK],
    wet: [Frame; BLOCK],
    output: [Frame; BLOCK],
    index: usize,
    seed: Seed,
    rate: u32,
    capacity: usize,
    demand: usize,
    available: usize,
    smooth: f64,
    level: f64,
    wet_mix: f64,
    wet_normalization: f64,
    target_wet_normalization: f64,
    dry_mix: f64,
    input_gate: f64,
    input_gain: f64,
    frequency: f64,
    pulse_rate: f64,
    mic_mix: f64,
    cpu_load: f64,
    adjustment_seconds: f64,
    peak_load: f64,
    input_peak: f32,
    output_peak: f32,
    output_channel_peaks: Frame,
    stopping: bool,
    stop_frames: usize,
    frames: u64,
    topology_revision: u64,
    visual_frames: usize,
    input_envelope: EnvelopeSampler,
    input_highpass: crate::conditioning::InputHighpass,
    output_conditioner: crate::conditioning::OutputConditioner,
}

impl Renderer {
    #[allow(clippy::too_many_arguments)]
    fn new(
        rate: u32,
        keys: &[String],
        targets: &[PoolTarget],
        performance: Performance,
        commands: Arc<ArrayQueue<Command>>,
        garbage: Arc<ArrayQueue<PoolUpdate>>,
        capture: Arc<ArrayQueue<Frame>>,
        telemetry: Arc<Telemetry>,
    ) -> Result<Self, String> {
        let mut engine = Engine::new(rate, 40.0, keys.len(), 1)?;
        engine.install_pool(keys)?;
        let mut adaptive = Adaptive::new(rate, keys.len());
        let demand = demand(targets, performance, keys.len());
        adaptive.set_demand(demand);
        let limit = if performance.automatic {
            adaptive.limit().min(demand)
        } else {
            demand
        };
        engine.update_pool(targets, limit);
        telemetry.capacity.store(keys.len(), Ordering::Relaxed);
        telemetry.limit.store(limit, Ordering::Relaxed);
        telemetry.target.store(targets.len(), Ordering::Relaxed);
        telemetry
            .automatic
            .store(performance.automatic, Ordering::Relaxed);
        telemetry
            .mic
            .store(performance.source == Source::Mic, Ordering::Relaxed);
        Ok(Self {
            engine,
            adaptive,
            performance,
            commands,
            garbage,
            capture,
            input_envelope: EnvelopeSampler::new(rate, &telemetry.input_envelope),
            input_highpass: crate::conditioning::InputHighpass::new_with_mastering(
                rate,
                PreparedMastering::new(rate, performance.mastering),
            ),
            output_conditioner: crate::conditioning::OutputConditioner::new_with_mastering(
                rate,
                PreparedMastering::new(rate, performance.mastering),
            )?,
            telemetry,
            source: [[0.0; 2]; BLOCK],
            wet: [[0.0; 2]; BLOCK],
            output: [[0.0; 2]; BLOCK],
            index: BLOCK,
            seed: Seed::new(rate),
            rate,
            capacity: keys.len(),
            demand,
            available: targets
                .iter()
                .filter(|target| target.gain > 0.0)
                .count()
                .min(keys.len()),
            smooth: 1.0 - (-1.0 / (rate as f64 * 0.02)).exp(),
            level: 0.0,
            wet_mix: performance.wet as f64,
            wet_normalization: 1.0,
            target_wet_normalization: 1.0,
            dry_mix: performance.dry as f64,
            input_gate: if performance.frozen { 0.0 } else { 1.0 },
            input_gain: performance.input_gain as f64,
            frequency: performance.frequency,
            pulse_rate: performance.pulse_rate,
            mic_mix: if performance.source == Source::Mic {
                1.0
            } else {
                0.0
            },
            cpu_load: 0.0,
            adjustment_seconds: 0.0,
            peak_load: 0.0,
            input_peak: 0.0,
            output_peak: 0.0,
            output_channel_peaks: [0.0; 2],
            stopping: false,
            stop_frames: 0,
            frames: 0,
            topology_revision: 0,
            visual_frames: 0,
        })
    }

    fn controls(&mut self) {
        // The callback is the sole garbage producer; the server only removes
        // buffers. A free garbage slot cannot disappear between this check and
        // push. Defer updates if reclamation is behind instead of dropping Vecs.
        while !self.garbage.is_full() {
            match self.commands.pop() {
                Some(Command::Update(mut pool, performance, mastering)) => {
                    self.input_highpass.set_mastering(mastering);
                    self.output_conditioner.set_mastering(mastering);
                    self.topology_revision = pool.revision;
                    if let Some(growth) = &mut pool.growth {
                        let capacity = growth.capacity();
                        self.engine.grow_pool(growth);
                        self.capacity = capacity;
                        self.adaptive.set_capacity(capacity);
                        self.telemetry.capacity.store(capacity, Ordering::Relaxed);
                    }
                    self.engine.set_pool_phase_seeds(&pool.phase_seeds);
                    // Validated on the control thread with the other pool values.
                    let _ = self.engine.set_pitch_offset(pool.pitch_offset);
                    self.target_wet_normalization = pool.wet_normalization;
                    self.available = pool
                        .targets
                        .iter()
                        .filter(|target| target.gain > 0.0)
                        .count()
                        .min(self.capacity);
                    self.demand = demand(&pool.targets, performance, self.capacity);
                    self.adaptive.set_demand(self.demand);
                    let limit = if performance.automatic {
                        self.adaptive.limit().min(self.demand)
                    } else {
                        self.demand
                    };
                    self.engine
                        .update_pool_ranked(&pool.targets, &pool.ranks, &pool.groups, limit);
                    self.performance = performance;
                    self.telemetry
                        .target
                        .store(pool.targets.len(), Ordering::Relaxed);
                    self.telemetry.limit.store(limit, Ordering::Relaxed);
                    self.telemetry
                        .automatic
                        .store(performance.automatic, Ordering::Relaxed);
                    self.telemetry
                        .mic
                        .store(performance.source == Source::Mic, Ordering::Relaxed);
                    // This push cannot fail under the private single-producer
                    // invariant; avoid any fallback that could free the payload.
                    if let Err(buffer) = self.garbage.push(pool) {
                        std::mem::forget(buffer);
                        self.telemetry.failure.fetch_max(3, Ordering::Release);
                    }
                    break;
                }
                Some(Command::Performance(performance, mastering)) => {
                    self.input_highpass.set_mastering(mastering);
                    self.output_conditioner.set_mastering(mastering);
                    self.performance = performance;
                    self.demand = performance.capped(self.available);
                    self.adaptive.set_demand(self.demand);
                    let limit = if performance.automatic {
                        self.adaptive.limit().min(self.demand)
                    } else {
                        self.demand
                    };
                    self.engine.set_pool_limit(limit);
                    self.telemetry.limit.store(limit, Ordering::Relaxed);
                    self.telemetry
                        .automatic
                        .store(performance.automatic, Ordering::Relaxed);
                    self.telemetry
                        .mic
                        .store(performance.source == Source::Mic, Ordering::Relaxed);
                }
                Some(Command::Strike) => self.seed.strike(),
                None => break,
            }
        }
    }

    fn block(&mut self) {
        let started = Instant::now();
        self.controls();
        if self.telemetry.stopping.load(Ordering::Acquire) && !self.stopping {
            self.stopping = true;
            self.engine.silence();
        }
        let mut underflow = 0;
        let mut input_peak = 0_f32;
        let mut output_peak = 0_f32;
        let mut output_channel_peaks = [0_f32; 2];
        for frame in &mut self.source {
            let gate_target = if self.performance.frozen { 0.0 } else { 1.0 };
            self.input_gate += (gate_target - self.input_gate) * self.smooth;
            self.frequency += (self.performance.frequency - self.frequency) * self.smooth;
            self.pulse_rate += (self.performance.pulse_rate - self.pulse_rate) * self.smooth;
            self.input_gain += (self.performance.input_gain as f64 - self.input_gain) * self.smooth;
            let target_mix = if self.performance.source == Source::Mic {
                1.0
            } else {
                0.0
            };
            self.mic_mix += (target_mix - self.mic_mix) * self.smooth;
            let seed = self.seed.next(self.frequency, self.pulse_rate);
            let mic = if self.performance.source == Source::Mic || self.mic_mix > 0.0001 {
                self.capture.pop().unwrap_or_else(|| {
                    if self.performance.source == Source::Mic {
                        underflow += 1;
                    }
                    [0.0; 2]
                })
            } else {
                [0.0; 2]
            };
            for c in 0..2 {
                let value = (seed as f64 * (1.0 - self.mic_mix) + mic[c] as f64 * self.mic_mix)
                    * self.input_gain;
                frame[c] = if value.is_finite() {
                    value.clamp(-16.0, 16.0) as f32
                } else {
                    0.0
                };
            }
            *frame = self.input_highpass.process(*frame);
            for sample in frame.iter_mut() {
                *sample *= self.input_gate as f32;
                input_peak = input_peak.max(sample.abs());
            }
            self.input_envelope
                .sample(*frame, &self.telemetry.input_envelope);
        }
        self.engine.process_block(&self.source, &mut self.wet);
        let target_level = if self.stopping {
            0.0
        } else {
            (self.performance.level as f64).sqrt()
        };
        for frame in 0..BLOCK {
            self.level += (target_level - self.level) * self.smooth;
            self.wet_mix += (self.performance.wet as f64 - self.wet_mix) * self.smooth;
            self.dry_mix += (self.performance.dry as f64 - self.dry_mix) * self.smooth;
            self.wet_normalization +=
                (self.target_wet_normalization - self.wet_normalization) * self.smooth;
            let stop_fade = if self.stopping {
                self.stop_frames += 1;
                (1.0 - self.stop_frames as f64 / (self.rate as f64 * 0.06)).max(0.0)
            } else {
                1.0
            };
            let mix = std::array::from_fn(|c| {
                self.wet[frame][c] as f64 * self.wet_mix * self.wet_normalization
                    + self.source[frame][c] as f64 * self.dry_mix
            });
            let conditioned = self.output_conditioner.process(mix, self.level * stop_fade);
            for (c, channel_peak) in output_channel_peaks.iter_mut().enumerate() {
                self.output[frame][c] = if conditioned[c].is_finite() {
                    conditioned[c]
                } else {
                    self.telemetry.failure.fetch_max(3, Ordering::Release);
                    0.0
                };
                output_peak = output_peak.max(self.output[frame][c].abs());
                *channel_peak = channel_peak.max(self.output[frame][c].abs());
            }
        }
        self.visual_frames += BLOCK;
        // Bound display publication to 40 Hz. DSP and admission are independent
        // of browser drawing and network polling; all storage is preallocated.
        if self.visual_frames >= (self.rate as usize / 40).max(BLOCK) {
            self.visual_frames = 0;
            let stop_fade = if self.stopping {
                (1.0 - self.stop_frames as f64 / (self.rate as f64 * 0.06)).max(0.0)
            } else {
                1.0
            };
            self.publish_activity(
                (self.wet_mix * self.wet_normalization * self.level * stop_fade) as f32,
            );
        }
        self.telemetry
            .underruns
            .fetch_add(underflow, Ordering::Relaxed);
        // Active counts are O(1); inactive reserved slots do not consume DSP time.
        let active_voices = self.engine.active_voice_count();
        let process_seconds = started.elapsed().as_secs_f64();
        if self.performance.automatic && !self.stopping {
            // Capture loss may be startup jitter or independent-device clock
            // drift. It does not establish a CPU limit; measured DSP load does.
            if let Some(limit) = self.adaptive.observe_active(
                process_seconds + self.adjustment_seconds,
                BLOCK,
                false,
                active_voices,
                self.engine.target_voice_count(),
            ) {
                let limit = limit.min(self.demand);
                self.engine.set_pool_limit(limit);
                self.telemetry.limit.store(limit, Ordering::Relaxed);
            }
        }
        let elapsed = started.elapsed().as_secs_f64();
        self.adjustment_seconds = (elapsed - process_seconds).max(0.);
        let load = elapsed / (BLOCK as f64 / self.rate as f64);
        if load > 1. {
            self.telemetry
                .deadline_misses
                .fetch_add(1, Ordering::Relaxed);
        }
        self.cpu_load += (load - self.cpu_load) * 0.04;
        self.peak_load = load.max(self.peak_load * 0.995);
        self.input_peak = input_peak.max(self.input_peak * 0.94);
        self.output_peak = output_peak.max(self.output_peak * 0.94);
        for (channel, value) in output_channel_peaks.into_iter().enumerate() {
            self.output_channel_peaks[channel] =
                value.max(self.output_channel_peaks[channel] * 0.94);
        }
        self.telemetry
            .output_left_peak
            .store(self.output_channel_peaks[0].to_bits(), Ordering::Relaxed);
        self.telemetry
            .output_right_peak
            .store(self.output_channel_peaks[1].to_bits(), Ordering::Relaxed);
        self.telemetry.gain_reduction_db.store(
            (self.output_conditioner.gain_reduction_db() as f32).to_bits(),
            Ordering::Relaxed,
        );
        self.telemetry
            .cpu
            .store((self.cpu_load as f32).to_bits(), Ordering::Relaxed);
        self.telemetry
            .peak_cpu
            .store((self.peak_load as f32).to_bits(), Ordering::Relaxed);
        self.telemetry
            .input_peak
            .store(self.input_peak.to_bits(), Ordering::Relaxed);
        self.telemetry
            .output_peak
            .store(self.output_peak.to_bits(), Ordering::Relaxed);
        self.telemetry
            .active
            .store(active_voices, Ordering::Relaxed);
        self.index = 0;
    }

    fn publish_activity(&self, wet_bus_gain: f32) {
        for (value, level) in self
            .telemetry
            .activity
            .0
            .iter()
            .zip(self.engine.generation_activity())
        {
            value.store(level.to_bits(), Ordering::Relaxed);
        }
        let taps = &self.telemetry.taps;
        taps.sequence.fetch_add(1, Ordering::AcqRel);
        for (target, count) in taps
            .generation_voice_counts
            .0
            .iter()
            .zip(self.engine.pool_group_counts())
        {
            target.store(*count, Ordering::Relaxed);
        }
        let count = self.engine.tap_meter_count();
        for ((level, index), (activity, voice_index)) in taps
            .levels
            .iter()
            .zip(&taps.indices)
            .zip(
                self.engine
                    .tap_activity()
                    .iter()
                    .zip(self.engine.tap_voice_indices()),
            )
            .take(count)
        {
            level.store(activity.to_bits(), Ordering::Relaxed);
            index.store(*voice_index, Ordering::Relaxed);
        }
        taps.wet_bus_gain
            .store(wet_bus_gain.to_bits(), Ordering::Relaxed);
        taps.revision
            .store(self.topology_revision, Ordering::Relaxed);
        taps.count.store(count, Ordering::Relaxed);
        taps.sequence.fetch_add(1, Ordering::Release);
    }

    fn next(&mut self) -> Frame {
        if self.telemetry.failure.load(Ordering::Acquire) != 0
            || self.telemetry.stopped.load(Ordering::Acquire)
        {
            return [0.0; 2];
        }
        if self.index == BLOCK {
            self.block();
        }
        let sample = self.output[self.index];
        self.index += 1;
        self.frames += 1;
        if self.index == BLOCK && self.stop_frames >= (self.rate as usize * 6 / 100) {
            self.telemetry.stopped.store(true, Ordering::Release);
        }
        sample
    }
}

fn output_stream<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut renderer: Renderer,
    telemetry: Arc<Telemetry>,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    let channels = config.channels as usize;
    let errors = telemetry.clone();
    device.build_output_stream(
        config,
        move |output: &mut [T], _| {
            for frame in output.chunks_exact_mut(channels) {
                let sample = renderer.next();
                if channels == 1 {
                    frame[0] = T::from_sample((sample[0] + sample[1]) * 0.5);
                } else {
                    frame[0] = T::from_sample(sample[0]);
                    frame[1] = T::from_sample(sample[1]);
                }
            }
            telemetry.frames.store(renderer.frames, Ordering::Relaxed);
        },
        move |_| {
            errors.failure.fetch_max(2, Ordering::Release);
        },
        None,
    )
}

fn input_stream<T: SizedSample>(
    device: &cpal::Device,
    config: &StreamConfig,
    capture: Arc<ArrayQueue<Frame>>,
    telemetry: Arc<Telemetry>,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let errors = telemetry.clone();
    device.build_input_stream(
        config,
        move |input: &[T], _| {
            let mut overflow = 0;
            for frame in input.chunks_exact(channels) {
                let left = f32::from_sample(frame[0]);
                let right = frame.get(1).map_or(left, |value| f32::from_sample(*value));
                if capture
                    .push([
                        if left.is_finite() { left } else { 0.0 },
                        if right.is_finite() { right } else { 0.0 },
                    ])
                    .is_err()
                {
                    overflow += 1;
                }
            }
            telemetry.overruns.fetch_add(overflow, Ordering::Relaxed);
        },
        move |_| {
            errors.failure.fetch_max(1, Ordering::Release);
        },
        None,
    )
}

macro_rules! formats {
    ($format:expr, $function:ident, $($argument:expr),+) => {
        match $format {
            SampleFormat::F32 => $function::<f32>($($argument),+), SampleFormat::F64 => $function::<f64>($($argument),+),
            SampleFormat::I8 => $function::<i8>($($argument),+), SampleFormat::I16 => $function::<i16>($($argument),+),
            SampleFormat::I32 => $function::<i32>($($argument),+), SampleFormat::I64 => $function::<i64>($($argument),+),
            SampleFormat::U8 => $function::<u8>($($argument),+), SampleFormat::U16 => $function::<u16>($($argument),+),
            SampleFormat::U32 => $function::<u32>($($argument),+), SampleFormat::U64 => $function::<u64>($($argument),+),
            _ => return Err(format!("Unsupported device format {}", $format)),
        }
    };
}
use formats;

fn output_configuration(device: &cpal::Device) -> Result<(SampleFormat, StreamConfig), String> {
    match configuration_at(device, 48_000, false) {
        Ok(config) => Ok(config),
        Err(_) => {
            let default = device.default_output_config().map_err(|e| e.to_string())?;
            configuration_at(device, default.sample_rate().0, false)
        }
    }
}

fn configuration_at(
    device: &cpal::Device,
    rate: u32,
    input: bool,
) -> Result<(SampleFormat, StreamConfig), String> {
    if !(8_000..=192_000).contains(&rate) {
        return Err("Device sample rate is outside 8–192 kHz".into());
    }
    let default = if input {
        device.default_input_config()
    } else {
        device.default_output_config()
    }
    .map_err(|e| e.to_string())?;
    let mut configs: Vec<_> = if input {
        device
            .supported_input_configs()
            .map_err(|e| e.to_string())?
            .collect()
    } else {
        device
            .supported_output_configs()
            .map_err(|e| e.to_string())?
            .collect()
    };
    configs.retain(|c| {
        c.min_sample_rate().0 <= rate
            && c.max_sample_rate().0 >= rate
            && (1..=2).contains(&c.channels())
    });
    configs.sort_by_key(|c| {
        (
            c.channels() != 2,
            c.sample_format() != default.sample_format(),
        )
    });
    let selected = configs
        .into_iter()
        .next()
        .ok_or_else(|| {
            format!(
                "{} does not support mono/stereo at {rate} Hz",
                if input { "Microphone" } else { "Output" }
            )
        })?
        .with_sample_rate(SampleRate(rate));
    Ok((selected.sample_format(), selected.config()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        alloc::{GlobalAlloc, Layout, System},
        cell::Cell,
    };

    thread_local! {
        static COUNTING: Cell<bool> = const { Cell::new(false) };
        static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
        static FREES: Cell<usize> = const { Cell::new(0) };
    }
    struct CheckedAllocator;
    #[global_allocator]
    static ALLOCATOR: CheckedAllocator = CheckedAllocator;
    unsafe impl GlobalAlloc for CheckedAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            if COUNTING.try_with(Cell::get).unwrap_or(false) {
                ALLOCATIONS.with(|c| c.set(c.get() + 1));
            }
            System.alloc(layout)
        }
        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            if COUNTING.try_with(Cell::get).unwrap_or(false) {
                ALLOCATIONS.with(|c| c.set(c.get() + 1));
            }
            System.alloc_zeroed(layout)
        }
        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            if COUNTING.try_with(Cell::get).unwrap_or(false) {
                FREES.with(|c| c.set(c.get() + 1));
            }
            System.dealloc(pointer, layout)
        }
        unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            if COUNTING.try_with(Cell::get).unwrap_or(false) {
                ALLOCATIONS.with(|c| c.set(c.get() + 1));
                FREES.with(|c| c.set(c.get() + 1));
            }
            System.realloc(pointer, layout, size)
        }
    }

    fn seed_defaults() -> Performance {
        Performance {
            source: Source::Seed,
            ..Performance::default()
        }
    }

    fn renderer(count: usize) -> Renderer {
        let keys: Vec<String> = (0..count).map(|i| format!("pool:{i}")).collect();
        let targets = vec![
            PoolTarget {
                delay: 0.02,
                rate: 1.3,
                gain: 0.02,
                pan: 0.0
            };
            count
        ];
        Renderer::new(
            8000,
            &keys,
            &targets,
            Performance {
                source: Source::Seed,
                level: 0.5,
                ..seed_defaults()
            },
            Arc::new(ArrayQueue::new(8)),
            Arc::new(ArrayQueue::new(16)),
            Arc::new(ArrayQueue::new(256)),
            Arc::new(Telemetry::default()),
        )
        .unwrap()
    }
    #[test]
    fn tap_publication_tracks_rendered_revision_and_actual_master_and_wet_gain() {
        let mut renderer = renderer(8);
        let targets = vec![
            PoolTarget {
                delay: 0.02,
                rate: 1.,
                gain: 0.2,
                pan: 0.
            };
            8
        ];
        let mut pool = PoolUpdate::plain(targets);
        pool.revision = 19;
        pool.ranks.reverse();
        pool.wet_normalization = 0.75;
        renderer
            .commands
            .push(Command::update(
                pool,
                Performance {
                    automatic: false,
                    level: 0.64,
                    wet: 0.8,
                    pulse_rate: 8.,
                    ..renderer.performance
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        for _ in 0..8000 {
            renderer.next();
        }
        let (activity, indices, wet, revision, counts) = renderer.telemetry.taps.snapshot();
        assert_eq!(revision, 19);
        assert_eq!(counts.iter().sum::<usize>(), 8);
        assert_eq!(indices, vec![7, 6, 5, 4, 3, 2, 1, 0]);
        assert!(activity.iter().any(|level| *level > 0.001));
        assert!((wet - 0.8 * 0.75 * 0.8).abs() < 0.0001);
        for performance in [
            Performance {
                level: 0.,
                ..renderer.performance
            },
            Performance {
                wet: 0.,
                ..renderer.performance
            },
        ] {
            renderer
                .commands
                .push(Command::performance(performance, renderer.rate))
                .ok()
                .unwrap();
            for _ in 0..8000 {
                renderer.next();
            }
            let (activity, _, wet, revision, _) = renderer.telemetry.taps.snapshot();
            assert_eq!(revision, 19);
            assert!(activity.iter().any(|level| *level > 0.001));
            assert!(
                wet < 0.000001,
                "A muted wet bus must not light audible descendant activity"
            );
        }
    }

    #[test]
    fn partial_tap_publication_is_discarded_without_waiting_on_the_callback() {
        let taps = TapTelemetry::default();
        taps.sequence.store(1, Ordering::Release);
        taps.levels[0].store(0.5_f32.to_bits(), Ordering::Relaxed);
        taps.indices[0].store(17, Ordering::Relaxed);
        let (activity, indices, wet, revision, counts) = taps.snapshot();
        assert!(activity.is_empty() && indices.is_empty());
        assert!(counts.is_empty());
        assert_eq!((wet, revision), (0., 0));
    }
    #[test]
    fn queued_growth_preserves_clock_reclaims_storage_and_updates_capacity() {
        let mut renderer = renderer(64);
        for _ in 0..3200 {
            renderer.next();
        }
        let frames = renderer.frames;
        let keys: Vec<_> = (0..32768).map(|i| format!("pool:{i}")).collect();
        let mut pool = PoolUpdate::plain(vec![
            PoolTarget {
                delay: 0.02,
                rate: 1.3,
                gain: 0.02,
                pan: 0.
            };
            keys.len()
        ]);
        pool.growth = Some(PreparedPool::new(&keys).unwrap());
        renderer
            .commands
            .push(Command::update(pool, seed_defaults(), renderer.rate))
            .ok()
            .unwrap();
        ALLOCATIONS.with(|n| n.set(0));
        FREES.with(|n| n.set(0));
        COUNTING.with(|n| n.set(true));
        renderer.block();
        COUNTING.with(|n| n.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
        assert_eq!(FREES.with(Cell::get), 0);
        assert_eq!(renderer.capacity, 32768);
        assert_eq!(renderer.telemetry.capacity.load(Ordering::Relaxed), 32768);
        assert_eq!(
            renderer.frames, frames,
            "Preparing a block does not reset or advance the device clock"
        );
        for _ in 0..BLOCK {
            renderer.next();
        }
        assert_eq!(renderer.frames, frames + BLOCK as u64);
        assert!(renderer.output.iter().flatten().any(|x| x.abs() > 0.0001));
        let retired = renderer.garbage.pop().unwrap();
        assert_eq!(retired.growth.as_ref().unwrap().capacity(), 64);
    }
    #[test]
    fn stereo_telemetry_distinguishes_a_hard_panned_descendant() {
        let mut renderer = renderer(1);
        renderer.engine.update_pool(
            &[PoolTarget {
                delay: 0.02,
                rate: 1.0,
                gain: 0.25,
                pan: 1.0,
            }],
            1,
        );
        // Let the original center-pan fade and the held meter peak settle.
        for _ in 0..32000 {
            renderer.next();
        }
        let left = f32::from_bits(renderer.telemetry.output_left_peak.load(Ordering::Relaxed));
        let right = f32::from_bits(renderer.telemetry.output_right_peak.load(Ordering::Relaxed));
        assert!(right > 0.001, "The right descendant must reach the meter");
        assert!(
            left < right * 0.0001,
            "The left meter must retain the pan separation"
        );
    }
    #[test]
    fn failed_session_cannot_queue_a_strike_or_open_input_for_an_update() {
        let telemetry = Arc::new(Telemetry::default());
        let mut session = Session {
            output: None,
            input: None,
            commands: Arc::new(ArrayQueue::new(8)),
            garbage: Arc::new(ArrayQueue::new(16)),
            capture: Arc::new(ArrayQueue::new(256)),
            telemetry: telemetry.clone(),
            rate: 8000,
            device: "test".into(),
            input_device: None,
            capacity: 1,
        };
        for failure in [2, 3] {
            telemetry.failure.store(failure, Ordering::Release);
            assert!(session
                .update(
                    PoolUpdate::plain(Vec::new()),
                    Performance {
                        source: Source::Mic,
                        ..seed_defaults()
                    }
                )
                .is_err());
            assert!(session.strike().is_err());
            assert!(session.commands.is_empty());
            assert!(session.input.is_none());
        }
        telemetry.failure.store(1, Ordering::Release);
        assert!(session.strike().is_err());
        assert!(session.commands.is_empty());
    }
    #[test]
    fn controls_change_sound_without_resetting_audio_time_and_return_owned_buffers() {
        let mut renderer = renderer(80);
        for _ in 0..8000 {
            assert!(renderer
                .next()
                .iter()
                .all(|s| s.is_finite() && s.abs() <= 1.0));
        }
        let before = renderer.frames;
        let targets = vec![
            PoolTarget {
                delay: 0.04,
                rate: 0.7,
                gain: 0.025,
                pan: 0.4
            };
            80
        ];
        renderer
            .commands
            .push(Command::update(
                PoolUpdate::plain(targets),
                Performance {
                    frequency: 217.0,
                    pulse_rate: 3.5,
                    wet: 0.95,
                    level: 0.7,
                    automatic: false,
                    voice_ceiling: 65,
                    ..seed_defaults()
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        for _ in 0..BLOCK {
            renderer.next();
        }
        assert_eq!(renderer.frames, before + BLOCK as u64);
        assert_eq!(renderer.telemetry.limit.load(Ordering::Relaxed), 65);
        assert_eq!(renderer.performance.frequency, 217.0);
        assert_eq!(renderer.garbage.pop().unwrap().targets.len(), 80);
        assert!(renderer.output.iter().flatten().any(|x| x.abs() > 0.001));
    }
    #[test]
    fn full_reclamation_queue_defers_updates_without_dropping_the_payload() {
        let mut renderer = renderer(8);
        for _ in 0..16 {
            renderer
                .garbage
                .push(PoolUpdate::plain(Vec::new()))
                .ok()
                .unwrap();
        }
        renderer
            .commands
            .push(Command::update(
                PoolUpdate::plain(vec![PoolTarget::default(); 8]),
                Performance {
                    level: 0.1,
                    ..seed_defaults()
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        renderer.block();
        assert_eq!(renderer.performance.level, 0.5);
        assert_eq!(renderer.commands.len(), 1);
        drop(renderer.garbage.pop());
        renderer.block();
        assert_eq!(renderer.performance.level, 0.1);
    }
    #[test]
    fn source_changes_underflow_safely_and_stopping_finishes_a_bounded_fade() {
        let mut renderer = renderer(8);
        renderer
            .commands
            .push(Command::update(
                PoolUpdate::plain(vec![PoolTarget::default(); 8]),
                Performance {
                    source: Source::Mic,
                    ..seed_defaults()
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        for _ in 0..BLOCK {
            assert!(renderer.next().iter().all(|x| x.is_finite()));
        }
        assert_eq!(renderer.telemetry.underruns.load(Ordering::Relaxed), BLOCK);
        renderer.telemetry.stopping.store(true, Ordering::Release);
        for _ in 0..800 {
            renderer.next();
        }
        assert!(renderer.telemetry.stopped.load(Ordering::Acquire));
        assert_eq!(renderer.next(), [0.0; 2]);
    }

    #[test]
    fn callback_updates_adaptation_and_retiring_voices_do_not_allocate_or_free() {
        let mut renderer = renderer(512);
        let targets = vec![
            PoolTarget {
                delay: 0.025,
                rate: 0.9,
                gain: 0.015,
                pan: 0.6
            };
            512
        ];
        renderer
            .commands
            .push(Command::update(
                PoolUpdate::plain(targets),
                Performance {
                    voice_ceiling: 12,
                    source: Source::Mic,
                    ..seed_defaults()
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        renderer.commands.push(Command::Strike).ok().unwrap();
        // TLS and the real-time clock are initialized before entering the guard.
        ALLOCATIONS.with(|c| c.set(0));
        FREES.with(|c| c.set(0));
        let _ = Instant::now();
        COUNTING.with(|c| c.set(true));
        for _ in 0..40 {
            renderer.block();
        }
        COUNTING.with(|c| c.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
        assert_eq!(FREES.with(Cell::get), 0);
        assert_eq!(renderer.garbage.pop().unwrap().targets.len(), 512);
        assert!(renderer.telemetry.limit.load(Ordering::Relaxed) <= 12);
    }

    #[test]
    fn inaudible_topology_does_not_grow_a_large_hidden_budget() {
        let performance = seed_defaults();
        assert_eq!(
            demand(&vec![PoolTarget::default(); 512], performance, 512),
            0
        );
        let targets = [PoolTarget {
            gain: 0.01,
            ..PoolTarget::default()
        }; 128];
        assert_eq!(
            demand(
                &targets,
                Performance {
                    voice_ceiling: 96,
                    ..performance
                },
                512
            ),
            96
        );
    }

    #[test]
    fn conditional_lab_can_release_all_voices_and_resume_without_restarting_native_audio() {
        use crate::model::{try_compile, LabParameters, Parameters};
        let mut renderer = renderer(8);
        let mut parameters = Parameters {
            interval_ms: 20.,
            lab: Some(LabParameters {
                iterations: 2,
                min_length: 1.,
                ..LabParameters::default()
            }),
            ..Parameters::default()
        };
        for minimum in [1., 0.03] {
            parameters.lab.as_mut().unwrap().min_length = minimum;
            let topology = try_compile(&parameters, 8000).unwrap();
            let pool = PoolUpdate {
                revision: 2,
                pitch_offset: parameters.pitch_offset,
                phase_seeds: Vec::new(),
                targets: topology.targets,
                ranks: topology.ranks,
                groups: topology.groups,
                wet_normalization: 1.,
                growth: None,
            };
            validate_pool(&pool, 8).unwrap();
            // Session::start keeps at least48 allocated slots even when this
            // valid conditional grammar has zero requested descendants.
            let prepared =
                PreparedPool::new(&pool_keys(pool.targets.len().max(48)).unwrap()).unwrap();
            assert!(prepared.capacity() >= 48);
            let before = renderer.frames;
            renderer
                .commands
                .push(Command::update(
                    pool,
                    Performance {
                        automatic: false,
                        voice_ceiling: 8,
                        dry: 0.,
                        wet: 0.8,
                        ..renderer.performance
                    },
                    renderer.rate,
                ))
                .ok()
                .unwrap();
            let mut peak = 0_f32;
            for frame in 0..8000 {
                let sample = renderer.next();
                assert!(sample.iter().all(|value| value.is_finite()));
                if frame >= 4000 {
                    peak = peak.max(sample[0].abs()).max(sample[1].abs());
                }
            }
            assert_eq!(renderer.frames, before + 8000);
            if minimum == 1. {
                assert_eq!(renderer.engine.target_voice_count(), 0);
                assert_eq!(renderer.engine.active_voice_count(), 0);
                assert!(peak < 1e-5);
            } else {
                assert_eq!(renderer.engine.target_voice_count(), 6);
                assert!(peak > 1e-4);
            }
        }
    }

    #[test]
    fn performance_edits_keep_voice_history_and_can_restore_a_lowered_ceiling() {
        let mut renderer = renderer(80);
        for _ in 0..8000 {
            renderer.next();
        }
        let start = renderer.frames;
        for ceiling in [12, 65] {
            renderer
                .commands
                .push(Command::performance(
                    Performance {
                        automatic: false,
                        voice_ceiling: ceiling,
                        frequency: 217.0,
                        wet: 0.76,
                        dry: 0.15,
                        ..renderer.performance
                    },
                    renderer.rate,
                ))
                .ok()
                .unwrap();
            renderer.block();
            assert_eq!(renderer.telemetry.limit.load(Ordering::Relaxed), ceiling);
            assert!(
                renderer.garbage.is_empty(),
                "Performance changes carry no owned topology buffers"
            );
            assert_eq!(
                renderer.frames, start,
                "Controls do not reset the source clock"
            );
        }
    }

    #[test]
    fn mastering_edits_preserve_recording_and_allocate_nothing_on_the_callback() {
        let mut renderer = renderer(8);
        for _ in 0..16 * BLOCK {
            renderer.next();
        }
        let before = renderer.frames;
        let limit = renderer.telemetry.limit.load(Ordering::Relaxed);
        let revision = renderer.topology_revision;
        for index in 0..6 {
            let mut performance = renderer.performance;
            performance.mastering = crate::performance::Mastering {
                input_highpass_hz: 20.0 + 30.0 * f64::from(index),
                highpass_hz: 80.0 * f64::from(index),
                lowpass_hz: if index % 2 == 0 { 0.0 } else { 1200.0 },
                threshold_db: -12.0 - f64::from(index) * 3.0,
                ratio: 1.0 + f64::from(index),
                compressor_enabled: index % 2 == 0,
                makeup_db: f64::from(index),
                ..crate::performance::Mastering::default()
            };
            renderer
                .commands
                .push(Command::performance(performance, renderer.rate))
                .ok()
                .unwrap();
        }
        ALLOCATIONS.with(|c| c.set(0));
        FREES.with(|c| c.set(0));
        let _ = Instant::now();
        COUNTING.with(|c| c.set(true));
        for _ in 0..40 * BLOCK {
            renderer.next();
        }
        COUNTING.with(|c| c.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
        assert_eq!(FREES.with(Cell::get), 0);
        assert_eq!(renderer.frames, before + 40 * BLOCK as u64);
        assert_eq!(renderer.topology_revision, revision);
        assert_eq!(renderer.telemetry.limit.load(Ordering::Relaxed), limit);
        assert!(renderer.garbage.is_empty());
        assert_eq!(renderer.performance.mastering.ratio, 6.0);
        assert!(renderer
            .output
            .iter()
            .flatten()
            .all(|sample| sample.is_finite() && sample.abs() <= 0.94));
        assert!(
            f32::from_bits(renderer.telemetry.gain_reduction_db.load(Ordering::Relaxed))
                .is_finite()
        );
    }

    #[test]
    fn mastering_lowpass_changes_actual_output_without_changing_voice_admission() {
        let render = |lowpass_hz| {
            let mut renderer = renderer(8);
            let performance = Performance {
                source: Source::Seed,
                frequency: 1000.0,
                pulse_rate: 12.0,
                wet: 0.0,
                dry: 0.5,
                level: 0.5,
                mastering: crate::performance::Mastering {
                    input_highpass_hz: 0.0,
                    lowpass_hz,
                    compressor_enabled: false,
                    auto_makeup: false,
                    ..crate::performance::Mastering::default()
                },
                ..renderer.performance
            };
            renderer
                .commands
                .push(Command::performance(performance, renderer.rate))
                .ok()
                .unwrap();
            let mut power = 0.0;
            for frame in 0..8000 {
                let sample = renderer.next();
                assert!(sample
                    .iter()
                    .all(|value| value.is_finite() && value.abs() <= 0.94));
                if frame >= 4000 {
                    power += f64::from(sample[0]).powi(2);
                }
            }
            (power, renderer.telemetry.limit.load(Ordering::Relaxed))
        };
        let (open, open_voices) = render(0.0);
        let (dark, dark_voices) = render(200.0);
        assert!(open > 0.01, "The source produces a measurable signal");
        assert!(
            dark > 0.0 && dark < open * 0.05,
            "Output LPF attenuates the actual high-frequency mix"
        );
        assert_eq!(dark_voices, open_voices);
    }

    #[test]
    fn paused_input_releases_smoothly_while_the_recorded_descendants_continue() {
        let mut renderer = renderer(8);
        renderer.engine.update_pool(
            &[PoolTarget {
                delay: 0.5,
                rate: 1.3,
                gain: 0.02,
                pan: 0.0,
            }; 8],
            8,
        );
        for _ in 0..12000 {
            renderer.next();
        }
        let start = renderer.frames;
        renderer
            .commands
            .push(Command::performance(
                Performance {
                    frozen: true,
                    dry: 0.0,
                    ..renderer.performance
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        for _ in 0..16 {
            renderer.block();
        }
        assert!(renderer
            .source
            .iter()
            .flatten()
            .all(|value| value.abs() < 1e-5));
        assert!(
            renderer
                .output
                .iter()
                .flatten()
                .any(|value| value.abs() > 1e-5),
            "Pause gates new recording rather than erasing the delayed history"
        );
        assert_eq!(renderer.frames, start);
        renderer
            .commands
            .push(Command::performance(
                Performance {
                    frozen: false,
                    ..renderer.performance
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        for _ in 0..80 {
            renderer.block();
        }
        assert!(renderer
            .source
            .iter()
            .flatten()
            .any(|value| value.abs() > 0.01));
    }

    #[test]
    fn original_voice_and_descendants_are_independent_mix_levels() {
        let mut renderer = renderer(8);
        renderer
            .commands
            .push(Command::performance(
                Performance {
                    wet: 0.0,
                    dry: 0.0,
                    ..renderer.performance
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        for _ in 0..64 {
            renderer.block();
        }
        assert!(renderer
            .output
            .iter()
            .flatten()
            .all(|value| value.abs() < 1e-6));
        renderer
            .commands
            .push(Command::performance(
                Performance {
                    wet: 0.0,
                    dry: 0.2,
                    ..renderer.performance
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        for _ in 0..32 {
            renderer.block();
        }
        assert!(renderer
            .output
            .iter()
            .flatten()
            .any(|value| value.abs() > 0.001));
        renderer
            .commands
            .push(Command::performance(
                Performance {
                    wet: 0.76,
                    dry: 0.0,
                    ..renderer.performance
                },
                renderer.rate,
            ))
            .ok()
            .unwrap();
        let mut delayed_peak = 0.0_f32;
        for _ in 0..32 {
            renderer.block();
            for value in renderer.output.iter().flatten() {
                delayed_peak = delayed_peak.max(value.abs());
            }
        }
        assert!(
            delayed_peak > 0.001,
            "Measure a complete seed pulse, including its delayed onset"
        );
    }
}
