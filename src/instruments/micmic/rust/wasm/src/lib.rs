//! Raw C ABI shared by the topology Worker and the AudioWorklet. Neither instance
//! imports CPAL, DOM, JavaScript DSP, or wasm-bindgen. The native model and
//! mastering implementation are compiled verbatim into this browser target.
//! All preparation is explicit; `lsd_process` and `lsd_observe` allocate nothing.
#![allow(clippy::missing_safety_doc)]

#[path = "../../app/src/adaptive.rs"]
#[allow(dead_code)]
mod adaptive;
#[path = "../../app/src/conditioning.rs"]
mod conditioning;
#[path = "../../app/src/model.rs"]
mod model;
#[path = "../../app/src/performance.rs"]
mod performance;
#[path = "../../app/src/resources.rs"]
mod resources;

use adaptive::Adaptive;
use conditioning::{InputHighpass, OutputConditioner, PreparedMastering};
use l_system_delay_core::{phase_seed, Engine, PoolTarget, PreparedPool};
use performance::{Performance, Source};
use std::{
    alloc::{alloc_zeroed, dealloc, Layout},
    cell::RefCell,
    slice,
};

const BLOCK: usize = 128;
const HEADER: usize = 32;
const RECORD: usize = 48;
const MAGIC: u32 = 0x4c53_4431;
const ENVELOPE_CAPACITY: usize = 4000;
const METRICS: usize = 26;
type Frame = [f32; 2];

thread_local! { static ERROR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) }; }
fn report(error: impl AsRef<str>) {
    ERROR.with(|slot| *slot.borrow_mut() = error.as_ref().as_bytes().to_vec());
}

#[no_mangle]
pub extern "C" fn lsd_abi_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn lsd_error_ptr() -> *const u8 {
    ERROR.with(|slot| slot.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn lsd_error_len() -> usize {
    ERROR.with(|slot| slot.borrow().len())
}
/// Caller owns the bytes; always free with the original length. Eight-byte
/// alignment supports every exported PCM, f64 and binary pool buffer.
#[no_mangle]
pub extern "C" fn lsd_alloc(bytes: usize) -> *mut u8 {
    let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) else {
        return std::ptr::null_mut();
    };
    unsafe { alloc_zeroed(layout) }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_free(pointer: *mut u8, bytes: usize) {
    if !pointer.is_null() {
        if let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) {
            dealloc(pointer, layout);
        }
    }
}

pub struct Compilation {
    json: Vec<u8>,
    pool: Vec<u8>,
}
fn compile(bytes: &[u8], rate: u32) -> Result<Compilation, String> {
    if !(8_000..=192_000).contains(&rate) {
        return Err("Unsupported audio sample rate".into());
    }
    let parameters: model::Parameters = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let topology = model::try_compile(&parameters, rate)?;
    let count = topology.targets.len();
    let bytes = count
        .checked_mul(RECORD)
        .and_then(|n| n.checked_add(HEADER))
        .ok_or("Pool size overflow")?;
    let mut pool = resources::filled(bytes, 0u8)?;
    pool[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    pool[4..8].copy_from_slice(&1u32.to_le_bytes());
    pool[8..12].copy_from_slice(&(count as u32).to_le_bytes());
    pool[12..16].copy_from_slice(&(topology.eligible_voices as u32).to_le_bytes());
    let normalization = 0.36 + 0.64 * (1.0 - parameters.depth * parameters.depth).max(0.08).sqrt();
    pool[24..32].copy_from_slice(&normalization.to_le_bytes());
    for index in 0..count {
        let base = HEADER + index * RECORD;
        let target = topology.targets[index];
        for (offset, value) in [
            (0, target.delay),
            (8, target.rate),
            (16, target.gain),
            (24, target.pan),
        ] {
            pool[base + offset..base + offset + 8].copy_from_slice(&value.to_le_bytes());
        }
        let rank = topology.ranks[index];
        let rank = if rank == usize::MAX {
            u32::MAX
        } else {
            rank as u32
        };
        for (offset, value) in [
            (32, rank),
            (36, phase_seed(&topology.nodes[index].key)),
            (40, u32::from(topology.groups[index])),
        ] {
            pool[base + offset..base + offset + 4].copy_from_slice(&value.to_le_bytes());
        }
    }
    let capacity = resources::voice_capacity();
    let generation_limits: std::collections::BTreeMap<_, _> = model::L_SYSTEM_TYPES
        .iter()
        .map(|id| ((*id).to_string(), model::generation_limit(id, capacity)))
        .collect();
    // The connected preview is bounded independently of all requested audio
    // voices. Deep trees keep every audio record, not merely visible branches.
    let json = serde_json::to_vec(&serde_json::json!({
        "parameters": parameters, "nodes": topology.preview,
        "previewSampled": topology.nodes.len() > 2048,
        "requestedVoices": topology.requested_voices,
        "eligibleVoices": topology.eligible_voices,
        "counts": {"requestedVoices":topology.requested_voices,"eligibleVoices":topology.eligible_voices},
        "memoryVoiceCapacity": capacity, "generationLimits": generation_limits
    })).map_err(|e| e.to_string())?;
    Ok(Compilation { json, pool })
}

#[no_mangle]
pub unsafe extern "C" fn lsd_compile(
    pointer: *const u8,
    bytes: usize,
    rate: u32,
) -> *mut Compilation {
    if pointer.is_null() {
        report("Missing parameters");
        return std::ptr::null_mut();
    }
    match compile(slice::from_raw_parts(pointer, bytes), rate) {
        Ok(result) => Box::into_raw(Box::new(result)),
        Err(error) => {
            report(error);
            std::ptr::null_mut()
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_compile_json_ptr(handle: *const Compilation) -> *const u8 {
    (*handle).json.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_compile_json_len(handle: *const Compilation) -> usize {
    (*handle).json.len()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_compile_pool_ptr(handle: *const Compilation) -> *const u8 {
    (*handle).pool.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_compile_pool_len(handle: *const Compilation) -> usize {
    (*handle).pool.len()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_compile_free(handle: *mut Compilation) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

// Native envelope equations, with a fixed ring instead of cross-thread atomics.
// Reading this ring never changes DSP time or requires a snapshot allocation.
struct Envelope {
    values: [f32; ENVELOPE_CAPACITY],
    ticks: u64,
    window: usize,
    count: usize,
    sum: f64,
    peak: f64,
    level: f64,
    release: f64,
    interval: f64,
}
impl Envelope {
    fn new(rate: u32) -> Self {
        let window = (rate as usize / 100).max(1);
        let interval = window as f64 / f64::from(rate);
        Self {
            values: [0.; ENVELOPE_CAPACITY],
            ticks: 0,
            window,
            count: 0,
            sum: 0.,
            peak: 0.,
            level: 0.,
            release: (-interval / 0.16).exp(),
            interval,
        }
    }
    fn sample(&mut self, frame: Frame) {
        let mono = (f64::from(frame[0]) + f64::from(frame[1])) * 0.5;
        self.sum += mono * mono;
        self.peak = self.peak.max(mono.abs());
        self.count += 1;
        if self.count == self.window {
            let next = ((self.sum / self.count as f64).sqrt() * 5.5)
                .max(self.peak * 0.9)
                .clamp(0., 1.);
            self.level = next.max(self.level * self.release);
            self.values[self.ticks as usize % ENVELOPE_CAPACITY] = self.level as f32;
            self.ticks += 1;
            self.count = 0;
            self.sum = 0.;
            self.peak = 0.;
        }
    }
    fn count(&self) -> usize {
        (self.ticks as usize).min(ENVELOPE_CAPACITY)
    }
    fn offset(&self) -> usize {
        (self.ticks as usize - self.count()) % ENVELOPE_CAPACITY
    }
    fn end_time(&self) -> f64 {
        self.ticks as f64 * self.interval
    }
}

pub struct Renderer {
    engine: Engine,
    adaptive: Adaptive,
    performance: Performance,
    input_highpass: InputHighpass,
    output_conditioner: OutputConditioner,
    source: [Frame; BLOCK],
    wet: [Frame; BLOCK],
    envelope: Envelope,
    seed: Seed,
    rate: u32,
    capacity: usize,
    available: usize,
    demand: usize,
    requested: usize,
    revision: u64,
    smooth: f64,
    level: f64,
    wet_mix: f64,
    wet_normalization: f64,
    target_normalization: f64,
    dry_mix: f64,
    input_gate: f64,
    input_gain: f64,
    mic_mix: f64,
    frequency: f64,
    pulse_rate: f64,
    frames: u64,
    blocks: u64,
    deadline_misses: u64,
    cpu_load: f64,
    peak_load: f64,
    input_peak: f32,
    output_peak: f32,
    channel_peaks: Frame,
    metrics: [f64; METRICS],
}
impl Renderer {
    fn new(rate: u32, capacity: usize) -> Result<Self, String> {
        if !(8_000..=192_000).contains(&rate) {
            return Err("Unsupported audio sample rate".into());
        }
        let capacity = capacity.max(1);
        let keys = model::pool_keys(capacity)?;
        let mut engine = Engine::new(rate, 40., capacity, 1)?;
        engine.install_pool(&keys)?;
        let performance = Performance::default();
        let mastering = PreparedMastering::new(rate, performance.mastering);
        let mut adaptive = Adaptive::new(rate, capacity);
        adaptive.set_demand(0);
        Ok(Self {
            engine,
            adaptive,
            performance,
            input_highpass: InputHighpass::new_with_mastering(rate, mastering),
            output_conditioner: OutputConditioner::new_with_mastering(rate, mastering)?,
            source: [[0.; 2]; BLOCK],
            wet: [[0.; 2]; BLOCK],
            envelope: Envelope::new(rate),
            seed: Seed::new(rate),
            rate,
            capacity,
            available: 0,
            demand: 0,
            requested: 0,
            revision: 0,
            smooth: 1. - (-1. / (f64::from(rate) * 0.02)).exp(),
            level: 0.,
            wet_mix: f64::from(performance.wet),
            wet_normalization: 1.,
            target_normalization: 1.,
            dry_mix: f64::from(performance.dry),
            input_gate: 1.,
            input_gain: f64::from(performance.input_gain),
            mic_mix: 1.,
            frequency: performance.frequency,
            pulse_rate: performance.pulse_rate,
            frames: 0,
            blocks: 0,
            deadline_misses: 0,
            cpu_load: 0.,
            peak_load: 0.,
            input_peak: 0.,
            output_peak: 0.,
            channel_peaks: [0.; 2],
            metrics: [0.; METRICS],
        })
    }
    fn set_performance(&mut self, settings: Performance) -> Result<(), String> {
        settings.validate()?;
        let mastering = PreparedMastering::new(self.rate, settings.mastering);
        self.input_highpass.set_mastering(mastering);
        self.output_conditioner.set_mastering(mastering);
        self.performance = settings;
        self.demand = settings.capped(self.available);
        self.adaptive.set_demand(self.demand);
        let limit = if settings.automatic {
            self.adaptive.limit().min(self.demand)
        } else {
            self.demand
        };
        self.engine.set_pool_limit(limit);
        self.update_metrics();
        Ok(())
    }
    /// Control-message preparation only. Validation/allocation complete before
    /// any live pool is replaced. Growth swaps storage while preserving existing
    /// phases, gains, fades, recording cursor and all forty seconds of history.
    fn install(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() < HEADER || read_u32(bytes, 0) != MAGIC || read_u32(bytes, 4) != 1 {
            return Err("Invalid delay pool format".into());
        }
        let count = read_u32(bytes, 8) as usize;
        let expected = count
            .checked_mul(RECORD)
            .and_then(|n| n.checked_add(HEADER))
            .ok_or("Pool size overflow")?;
        if expected != bytes.len() {
            return Err("Truncated delay pool".into());
        }
        let normalization = read_f64(bytes, 24);
        if !normalization.is_finite() || !(0.0..=1.0).contains(&normalization) {
            return Err("Invalid wet normalization".into());
        }
        let mut targets = resources::reserve(count)?;
        let mut ranks = resources::reserve(count)?;
        let mut groups = resources::reserve(count)?;
        let mut seeds = resources::reserve(count)?;
        let mut available = 0;
        for index in 0..count {
            let base = HEADER + index * RECORD;
            let target = PoolTarget {
                delay: read_f64(bytes, base),
                rate: read_f64(bytes, base + 8),
                gain: read_f64(bytes, base + 16),
                pan: read_f64(bytes, base + 24),
            };
            let rank = read_u32(bytes, base + 32);
            let group = read_u32(bytes, base + 40);
            if ![target.delay, target.rate, target.gain, target.pan]
                .iter()
                .all(|x| x.is_finite())
                || target.delay < 0.
                || !(0.125..=8.).contains(&target.rate)
                || !(0.0..=1.0).contains(&target.gain)
                || !(-1.0..=1.0).contains(&target.pan)
                || group > 255
                || (rank != u32::MAX && rank as usize >= count)
            {
                return Err("Invalid delay target".into());
            }
            available += usize::from(target.gain > 0.);
            targets.push(target);
            ranks.push(if rank == u32::MAX {
                usize::MAX
            } else {
                rank as usize
            });
            seeds.push(read_u32(bytes, base + 36));
            groups.push(group as u8);
        }
        if count > self.capacity {
            let keys = model::pool_keys(count)?;
            let mut prepared = PreparedPool::new(&keys)?;
            self.engine.grow_pool(&mut prepared);
            self.capacity = count;
            self.adaptive.set_capacity(count);
        }
        self.revision = u64::from(read_u32(bytes, 16)) | u64::from(read_u32(bytes, 20)) << 32;
        self.requested = count;
        self.available = available;
        self.demand = self.performance.capped(available);
        self.adaptive.set_demand(self.demand);
        self.target_normalization = normalization;
        let limit = if self.performance.automatic {
            self.adaptive.limit().min(self.demand)
        } else {
            self.demand
        };
        self.engine.set_pool_phase_seeds(&seeds);
        self.engine
            .update_pool_ranked(&targets, &ranks, &groups, limit);
        self.update_metrics();
        Ok(())
    }
    fn process(
        &mut self,
        left: &[f32],
        right: Option<&[f32]>,
        out_left: &mut [f32],
        out_right: &mut [f32],
    ) {
        let frames = left.len();
        let mut input_peak = 0f32;
        let mut peaks = [0f32; 2];
        for index in 0..frames {
            self.input_gate +=
                ((if self.performance.frozen { 0. } else { 1. }) - self.input_gate) * self.smooth;
            self.input_gain +=
                (f64::from(self.performance.input_gain) - self.input_gain) * self.smooth;
            self.frequency += (self.performance.frequency - self.frequency) * self.smooth;
            self.pulse_rate += (self.performance.pulse_rate - self.pulse_rate) * self.smooth;
            self.mic_mix += ((if self.performance.source == Source::Mic {
                1.
            } else {
                0.
            }) - self.mic_mix)
                * self.smooth;
            let seed = f64::from(self.seed.next(self.frequency, self.pulse_rate));
            let mic = [
                left[index],
                right.map_or(left[index], |values| values[index]),
            ];
            let mut frame = std::array::from_fn(|channel| {
                let value = (seed * (1. - self.mic_mix) + f64::from(mic[channel]) * self.mic_mix)
                    * self.input_gain;
                if value.is_finite() {
                    value.clamp(-16., 16.) as f32
                } else {
                    0.
                }
            });
            frame = self.input_highpass.process(frame);
            for value in &mut frame {
                *value *= self.input_gate as f32;
                input_peak = input_peak.max(value.abs());
            }
            self.envelope.sample(frame);
            self.source[index] = frame;
        }
        self.engine
            .process_block(&self.source[..frames], &mut self.wet[..frames]);
        for index in 0..frames {
            self.level += (f64::from(self.performance.level).sqrt() - self.level) * self.smooth;
            self.wet_mix += (f64::from(self.performance.wet) - self.wet_mix) * self.smooth;
            self.dry_mix += (f64::from(self.performance.dry) - self.dry_mix) * self.smooth;
            self.wet_normalization +=
                (self.target_normalization - self.wet_normalization) * self.smooth;
            let mix = std::array::from_fn(|channel| {
                f64::from(self.wet[index][channel]) * self.wet_mix * self.wet_normalization
                    + f64::from(self.source[index][channel]) * self.dry_mix
            });
            let output = self.output_conditioner.process(mix, self.level);
            out_left[index] = output[0];
            out_right[index] = output[1];
            for c in 0..2 {
                peaks[c] = peaks[c].max(output[c].abs());
            }
        }
        self.frames += frames as u64;
        self.blocks += 1;
        self.input_peak = input_peak.max(self.input_peak * 0.94);
        self.output_peak = peaks[0].max(peaks[1]).max(self.output_peak * 0.94);
        for (stored, peak) in self.channel_peaks.iter_mut().zip(peaks) {
            *stored = peak.max(*stored * 0.94);
        }
        self.update_metrics();
    }
    fn observe(&mut self, seconds: f64, frames: usize, underrun: bool) -> usize {
        if frames == 0 {
            return self.engine.target_voice_count();
        }
        let load = if seconds.is_finite() && seconds >= 0. {
            seconds / (frames as f64 / f64::from(self.rate))
        } else {
            2.
        };
        if load > 1. || underrun {
            self.deadline_misses += 1;
        }
        // Duration-aware smoothing remains consistent for 128-frame timers and
        // accumulated coarse timers, rather than treating a batch as one block.
        self.cpu_load +=
            (load - self.cpu_load) * (1. - (-(frames as f64) / f64::from(self.rate) / 0.065).exp());
        self.peak_load =
            load.max(self.peak_load * (-(frames as f64) / f64::from(self.rate) / 0.53).exp());
        if self.performance.automatic {
            if let Some(limit) = self.adaptive.observe_active(
                seconds,
                frames,
                underrun,
                self.engine.active_voice_count(),
                self.engine.target_voice_count(),
            ) {
                self.engine.set_pool_limit(limit.min(self.demand));
            }
        }
        self.update_metrics();
        self.engine.target_voice_count()
    }
    fn update_metrics(&mut self) {
        self.metrics = [
            f64::from(self.rate),
            self.engine.active_voice_count() as f64,
            self.engine.target_voice_count() as f64,
            (if self.performance.automatic {
                self.adaptive.limit().min(self.demand)
            } else {
                self.demand
            }) as f64,
            self.capacity as f64,
            self.requested as f64,
            self.cpu_load,
            self.peak_load,
            f64::from(self.input_peak),
            f64::from(self.output_peak),
            f64::from(self.channel_peaks[0]),
            f64::from(self.channel_peaks[1]),
            self.output_conditioner.gain_reduction_db(),
            self.deadline_misses as f64,
            self.frames as f64 / f64::from(self.rate),
            self.wet_mix * self.wet_normalization * self.level,
            self.revision as f64,
            f64::from(self.performance.automatic),
            f64::from(self.performance.source == Source::Mic),
            self.adaptive.measured_limit() as f64,
            self.envelope.count() as f64,
            self.envelope.end_time(),
            self.envelope.interval,
            self.blocks as f64,
            0.,
            0.,
        ];
    }
}
fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn read_f64(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

#[no_mangle]
pub extern "C" fn lsd_new(rate: u32, capacity: usize) -> *mut Renderer {
    match Renderer::new(rate, capacity) {
        Ok(mut r) => {
            r.update_metrics();
            Box::into_raw(Box::new(r))
        }
        Err(e) => {
            report(e);
            std::ptr::null_mut()
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_drop(handle: *mut Renderer) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_install(
    handle: *mut Renderer,
    pointer: *const u8,
    bytes: usize,
) -> u32 {
    if handle.is_null() || pointer.is_null() {
        return 0;
    }
    match (*handle).install(slice::from_raw_parts(pointer, bytes)) {
        Ok(()) => 1,
        Err(e) => {
            report(e);
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_performance(
    handle: *mut Renderer,
    pointer: *const u8,
    bytes: usize,
) -> u32 {
    if handle.is_null() || pointer.is_null() {
        return 0;
    }
    let result = serde_json::from_slice::<Performance>(slice::from_raw_parts(pointer, bytes))
        .map_err(|e| e.to_string())
        .and_then(|settings| (*handle).set_performance(settings));
    match result {
        Ok(()) => 1,
        Err(e) => {
            report(e);
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_strike(handle: *mut Renderer) {
    if !handle.is_null() {
        (*handle).seed.strike();
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_process(
    handle: *mut Renderer,
    left: *const f32,
    right: *const f32,
    out_left: *mut f32,
    out_right: *mut f32,
    frames: usize,
) -> u32 {
    if handle.is_null()
        || left.is_null()
        || out_left.is_null()
        || out_right.is_null()
        || frames == 0
        || frames > BLOCK
    {
        return 0;
    }
    (*handle).process(
        slice::from_raw_parts(left, frames),
        if right.is_null() {
            None
        } else {
            Some(slice::from_raw_parts(right, frames))
        },
        slice::from_raw_parts_mut(out_left, frames),
        slice::from_raw_parts_mut(out_right, frames),
    );
    1
}
#[no_mangle]
pub unsafe extern "C" fn lsd_observe(
    handle: *mut Renderer,
    seconds: f64,
    frames: usize,
    underrun: u32,
) -> usize {
    if handle.is_null() {
        return 0;
    }
    (*handle).observe(seconds, frames, underrun != 0)
}
#[no_mangle]
pub extern "C" fn lsd_metrics_len() -> usize {
    METRICS
}
#[no_mangle]
pub unsafe extern "C" fn lsd_metrics_ptr(handle: *const Renderer) -> *const f64 {
    (*handle).metrics.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_taps_ptr(handle: *const Renderer) -> *const f32 {
    (*handle).engine.tap_activity().as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_taps_count(handle: *const Renderer) -> usize {
    (*handle).engine.tap_meter_count()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_tap_indices_ptr(handle: *const Renderer) -> *const usize {
    (*handle).engine.tap_voice_indices().as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_generations_ptr(handle: *const Renderer) -> *const f32 {
    (*handle).engine.generation_activity().as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_generation_counts_ptr(handle: *const Renderer) -> *const usize {
    (*handle).engine.pool_group_counts().as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_envelope_ptr(handle: *const Renderer) -> *const f32 {
    (*handle).envelope.values.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_envelope_count(handle: *const Renderer) -> usize {
    (*handle).envelope.count()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_envelope_offset(handle: *const Renderer) -> usize {
    (*handle).envelope.offset()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_envelope_end_time(handle: *const Renderer) -> f64 {
    (*handle).envelope.end_time()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_envelope_interval(handle: *const Renderer) -> f64 {
    (*handle).envelope.interval
}

// Preserve native optional seed-source sound for stored scenes.
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

#[cfg(test)]
mod browser_tests {
    use super::*;
    use std::alloc::{GlobalAlloc, System};
    use std::cell::Cell;
    thread_local! {
        static TRACK: Cell<bool> = const { Cell::new(false) };
        static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
        static FREES: Cell<usize> = const { Cell::new(0) };
    }
    struct Checked;
    unsafe impl GlobalAlloc for Checked {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            TRACK.with(|enabled| {
                if enabled.get() {
                    ALLOCATIONS.with(|n| n.set(n.get() + 1));
                }
            });
            System.alloc(layout)
        }
        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            TRACK.with(|enabled| {
                if enabled.get() {
                    FREES.with(|n| n.set(n.get() + 1));
                }
            });
            System.dealloc(pointer, layout)
        }
        unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, bytes: usize) -> *mut u8 {
            TRACK.with(|enabled| {
                if enabled.get() {
                    ALLOCATIONS.with(|n| n.set(n.get() + 1));
                }
            });
            System.realloc(pointer, layout, bytes)
        }
    }
    #[global_allocator]
    static ALLOCATOR: Checked = Checked;

    fn scene(generations: u8) -> Compilation {
        let params = model::Parameters {
            generations,
            interval_ms: 2.,
            pitch_scale: 0.,
            ..model::Parameters::default()
        };
        compile(&serde_json::to_vec(&params).unwrap(), 8000).unwrap()
    }
    fn signal(offset: usize) -> [f32; BLOCK] {
        std::array::from_fn(|i| {
            ((offset + i) as f64 * std::f64::consts::TAU * 177. / 8000.).sin() as f32 * 0.08
        })
    }
    #[test]
    fn worker_compiles_all_deep_audio_voices_independently_of_preview() {
        let result = scene(15);
        let json: serde_json::Value = serde_json::from_slice(&result.json).unwrap();
        assert_eq!(json["requestedVoices"], 65534);
        assert_eq!(read_u32(&result.pool, 8), 65534);
        assert_eq!(result.pool.len(), HEADER + 65534 * RECORD);
        assert!(json["nodes"].as_array().unwrap().len() <= 2049);
        let topology = model::try_compile(
            &model::Parameters {
                generations: 15,
                interval_ms: 2.,
                pitch_scale: 0.,
                ..model::Parameters::default()
            },
            8000,
        )
        .unwrap();
        for (i, target) in topology.targets.iter().enumerate() {
            let base = HEADER + i * RECORD;
            assert_eq!(read_f64(&result.pool, base), target.delay);
            assert_eq!(read_f64(&result.pool, base + 8), target.rate);
            assert_eq!(read_f64(&result.pool, base + 16), target.gain);
            assert_eq!(read_f64(&result.pool, base + 24), target.pan);
            assert_eq!(
                read_u32(&result.pool, base + 36),
                phase_seed(&topology.nodes[i].key)
            );
        }
    }
    #[test]
    fn processing_and_admission_search_allocate_and_free_nothing() {
        let compiled = scene(7);
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&compiled.pool).unwrap();
        let input = signal(0);
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        TRACK.with(|enabled| enabled.set(true));
        for _ in 0..600 {
            renderer.process(&input, None, &mut left, &mut right);
            renderer.observe(0.0001, BLOCK, false);
        }
        TRACK.with(|enabled| enabled.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
        assert_eq!(FREES.with(Cell::get), 0);
        assert_eq!(renderer.metrics[2], 254.);
        assert!(left.iter().any(|value| value.abs() > 1e-5));
    }
    #[test]
    fn calibration_metric_retains_proved_device_capacity_through_small_topologies() {
        let large = scene(7);
        let small = scene(1);
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&large.pool).unwrap();
        assert_eq!(renderer.metrics[19], 0.);
        for _ in 0..200 {
            renderer.observe(0.001, BLOCK, false);
        }
        assert_eq!(renderer.metrics[19], 254.);
        renderer.install(&small.pool).unwrap();
        assert_eq!(renderer.metrics[3], 2.);
        assert_eq!(renderer.metrics[19], 254.);
        renderer.install(&large.pool).unwrap();
        assert_eq!(renderer.metrics[3], 254.);
        renderer.observe(0.02, BLOCK, false);
        assert_eq!(
            renderer.metrics[3], 2.,
            "Restored device evidence must still survive current callback validation"
        );
        assert_eq!(renderer.metrics[19], 2.);
    }
    #[test]
    fn manual_scene_is_not_fabricated_capacity_evidence_on_automatic_restart() {
        let compiled = scene(7);
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer
            .set_performance(Performance {
                automatic: false,
                ..Performance::default()
            })
            .unwrap();
        renderer.install(&compiled.pool).unwrap();
        for _ in 0..200 {
            renderer.observe(0.0001, BLOCK, false);
        }
        assert_eq!(renderer.metrics[3], 254.);
        assert_eq!(
            renderer.metrics[19], 0.,
            "Manual admission has not passed automatic trial validation"
        );
        renderer.set_performance(Performance::default()).unwrap();
        assert_eq!(renderer.metrics[3], 48.);
        for _ in 0..200 {
            renderer.observe(0.001, BLOCK, false);
        }
        assert_eq!(renderer.metrics[19], 254.);
        renderer.observe(0.032, BLOCK, false);
        assert!(renderer.metrics[3] < 254.);
        assert!(
            renderer.metrics[19] < 254.,
            "Real overload must invalidate previously proved processing cost"
        );
    }
    #[test]
    fn growing_reserved_storage_preserves_the_live_recording_and_voice_state() {
        let compiled = scene(4);
        let mut small = Renderer::new(8000, 1).unwrap();
        let mut big = Renderer::new(8000, 100).unwrap();
        let settings = Performance {
            automatic: false,
            ..Performance::default()
        };
        small.set_performance(settings).unwrap();
        big.set_performance(settings).unwrap();
        small.install(&compiled.pool).unwrap();
        big.install(&compiled.pool).unwrap();
        let mut small_l = [0.; BLOCK];
        let mut small_r = [0.; BLOCK];
        let mut big_l = [0.; BLOCK];
        let mut big_r = [0.; BLOCK];
        for block in 0..30 {
            let input = signal(block * BLOCK);
            small.process(&input, None, &mut small_l, &mut small_r);
            big.process(&input, None, &mut big_l, &mut big_r);
            assert_eq!(small_l, big_l);
        }
        // Add only silent reserved slots. An engine reset would make the next
        // delay block silent; phase/fade changes would differ from the baseline.
        let mut expanded = compiled.pool.clone();
        expanded.resize(HEADER + 100 * RECORD, 0);
        expanded[8..12].copy_from_slice(&100u32.to_le_bytes());
        for index in 30..100 {
            let base = HEADER + index * RECORD;
            expanded[base + 8..base + 16].copy_from_slice(&1f64.to_le_bytes());
            expanded[base + 32..base + 36].copy_from_slice(&u32::MAX.to_le_bytes());
        }
        small.install(&expanded).unwrap();
        big.install(&expanded).unwrap();
        for block in 30..60 {
            let input = signal(block * BLOCK);
            small.process(&input, None, &mut small_l, &mut small_r);
            big.process(&input, None, &mut big_l, &mut big_r);
            assert_eq!(small_l, big_l);
            assert_eq!(small_r, big_r);
        }
        assert_eq!(small.capacity, 100);
        assert_eq!(small.frames, 7680);
    }
    #[test]
    fn rejected_pool_retains_audio_and_sample_clock() {
        let compiled = scene(3);
        let mut a = Renderer::new(8000, 1).unwrap();
        let mut b = Renderer::new(8000, 1).unwrap();
        a.install(&compiled.pool).unwrap();
        b.install(&compiled.pool).unwrap();
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        for block in 0..20 {
            let input = signal(block * BLOCK);
            a.process(&input, None, &mut left, &mut right);
            b.process(&input, None, &mut reference_l, &mut reference_r);
        }
        let mut malformed = compiled.pool.clone();
        malformed[HEADER..HEADER + 8].copy_from_slice(&f64::NAN.to_le_bytes());
        assert!(a.install(&malformed).is_err());
        assert_eq!(a.frames, b.frames);
        let input = signal(20 * BLOCK);
        a.process(&input, None, &mut left, &mut right);
        b.process(&input, None, &mut reference_l, &mut reference_r);
        assert_eq!(left, reference_l);
        assert_eq!(right, reference_r);
    }
    #[test]
    fn envelope_follows_native_attack_release_and_chronological_wrap() {
        let mut envelope = Envelope::new(48000);
        for _ in 0..480 {
            envelope.sample([0.1; 2]);
        }
        for _ in 0..7680 {
            envelope.sample([0.; 2]);
        }
        assert_eq!(envelope.count(), 17);
        assert_eq!(envelope.end_time(), 0.17);
        assert!((envelope.values[0] - 0.55).abs() < 1e-5);
        assert!((envelope.values[16] - 0.55 / std::f32::consts::E).abs() < 1e-5);
        for _ in 0..480 * 4000 {
            envelope.sample([0.; 2]);
        }
        assert_eq!(envelope.count(), 4000);
        assert_eq!(envelope.offset(), 17);
        assert!((envelope.end_time() - 40.17).abs() < 1e-10);
    }
}
