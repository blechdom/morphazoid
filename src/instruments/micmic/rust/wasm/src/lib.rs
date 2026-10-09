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
use l_system_delay_core::{phase_seed, Engine, PoolTarget, PreparedPool, PreparedPoolControls};
use performance::{Performance, Source};
use std::{
    alloc::{alloc, alloc_zeroed, dealloc, Layout},
    cell::RefCell,
    collections::VecDeque,
    slice,
};

const BLOCK: usize = 128;
const HEADER: usize = 32;
const RECORD: usize = 48;
const MAGIC: u32 = 0x4c53_4431;
const ENVELOPE_CAPACITY: usize = 4000;
const METRICS: usize = 26;
type Frame = [f32; 2];

fn depth_normalization(depth: f64) -> f64 {
    0.36 + 0.64 * (1.0 - depth * depth).max(0.08).sqrt()
}

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
/// Caller-owned upload storage, freed by lsd_free with the original length.
/// The caller must write all 32 header bytes before install_begin, then write
/// each complete record batch before install_step is allowed to consume it.
/// PCM buffers continue using the zero-initialized lsd_alloc entry point.
#[no_mangle]
pub extern "C" fn lsd_alloc_uninitialized(bytes: usize) -> *mut u8 {
    let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) else {
        return std::ptr::null_mut();
    };
    unsafe { alloc(layout) }
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
    compile_with_budget(bytes, rate, None)
}

fn compile_with_budget(
    bytes: &[u8],
    rate: u32,
    budget: Option<usize>,
) -> Result<Compilation, String> {
    if !(8_000..=192_000).contains(&rate) {
        return Err("Unsupported audio sample rate".into());
    }
    let parameters: model::Parameters = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    parameters.validate()?;
    // Silent recursion still retains the structural priorities needed to
    // resume the same live branches. Its gains and audible count remain zero.
    let mut structural_parameters = parameters.clone();
    if structural_parameters.depth == 0. {
        structural_parameters.depth = 0.72;
    }
    let (mut topology, effective_parameters, requested_voices, requested_exact) =
        if let Some(budget) = budget {
            let result = model::try_compile_bounded(&structural_parameters, rate, budget)?;
            let mut effective = result.effective_parameters;
            effective.depth = parameters.depth;
            (
                result.topology,
                effective,
                result.requested_voices,
                result.requested_voices_exact,
            )
        } else {
            let topology = model::try_compile(&structural_parameters, rate)?;
            let requested = topology.requested_voices as u64;
            (topology, parameters.clone(), requested, true)
        };
    let structural_eligible = topology.eligible_voices;
    if parameters.depth == 0. {
        topology.eligible_voices = 0;
        for target in &mut topology.targets {
            target.gain = 0.;
        }
        for node in &mut topology.nodes {
            node.gain = 0.;
        }
        for node in topology.preview.iter_mut().skip(1) {
            node.gain = 0.;
        }
    }
    let count = topology.targets.len();
    let bytes = count
        .checked_mul(RECORD)
        .and_then(|n| n.checked_add(HEADER))
        .ok_or("Pool size overflow")?;
    let mut pool = resources::filled(bytes, 0u8)?;
    pool[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    pool[4..8].copy_from_slice(&2u32.to_le_bytes());
    pool[8..12].copy_from_slice(&(count as u32).to_le_bytes());
    pool[12..16].copy_from_slice(&(structural_eligible as u32).to_le_bytes());
    let normalization = depth_normalization(parameters.depth);
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
        .map(|id| {
            let limit = if budget.is_some() {
                model::MAX_REPRESENTABLE_GENERATIONS
            } else if *id == "stochastic" && parameters.l_system_type == "stochastic" {
                model::stochastic_generation_limit(&parameters, capacity)
            } else {
                model::generation_limit(id, capacity)
            };
            ((*id).to_string(), limit)
        })
        .collect();
    // Legacy deep trees keep a sampled control preview independent of audio.
    // Labs retain their complete authoritative segment graph for the renderer.
    let json = serde_json::to_vec(&serde_json::json!({
        "parameters": parameters, "nodes": topology.preview,
        "effectiveParameters": effective_parameters,
        "previewSampled": budget.is_none() && parameters.lab.is_none() && topology.nodes.len() > 2048,
        "requestedVoices": requested_voices,
        "requestedVoicesExact": requested_exact && requested_voices < (1_u64 << 53),
        "requestedVoicesDecimal": requested_voices.to_string(),
        "preparedVoices": count,
        "eligibleVoices": topology.eligible_voices,
        "structuralEligibleVoices": structural_eligible,
        "counts": {"requestedVoices":requested_voices,"preparedVoices":count,"eligibleVoices":topology.eligible_voices},
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

/// Additive ABI-1 entry point: device admission is runtime-only and the caller
/// owns the same compilation handle/JSON/pool lifecycle as lsd_compile.
#[no_mangle]
pub unsafe extern "C" fn lsd_compile_bounded(
    pointer: *const u8,
    bytes: usize,
    rate: u32,
    voice_budget: usize,
) -> *mut Compilation {
    if pointer.is_null() {
        report("Missing parameters");
        return std::ptr::null_mut();
    }
    match compile_with_budget(
        slice::from_raw_parts(pointer, bytes),
        rate,
        Some(voice_budget),
    ) {
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

struct StagedInstall {
    pointer: *const u8,
    bytes: usize,
    count: usize,
    next: usize,
    available: usize,
    revision: u64,
    normalization: f64,
    depth_controls: bool,
    whole_scene_admission: bool,
    depth_override: Option<f64>,
    fold_base_ms: Option<f64>,
    fold_interval_ms: Option<f64>,
    fold_override: bool,
    eligible_delay_maximum: f64,
    excluded_delay_minimum: f64,
    controls: PreparedPoolControls,
    growth: Option<PreparedPool>,
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
    structural_group_counts: [usize; 256],
    depth_controls: bool,
    live_depth: Option<f64>,
    fold_base_ms: Option<f64>,
    fold_interval_ms: f64,
    eligible_delay_maximum: f64,
    excluded_delay_minimum: f64,
    pending_install: Option<StagedInstall>,
    spare_controls: Option<PreparedPoolControls>,
    retired_pools: VecDeque<PreparedPool>,
    retired_slots: usize,
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
    calibration: bool,
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
            structural_group_counts: [0; 256],
            depth_controls: false,
            live_depth: None,
            fold_base_ms: None,
            fold_interval_ms: 0.,
            eligible_delay_maximum: 0.,
            excluded_delay_minimum: f64::INFINITY,
            pending_install: None,
            spare_controls: None,
            retired_pools: VecDeque::new(),
            retired_slots: 0,
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
            calibration: false,
        })
    }
    fn set_performance(&mut self, settings: Performance) -> Result<(), String> {
        settings.validate()?;
        if settings.mastering != self.performance.mastering {
            let mastering = PreparedMastering::new(self.rate, settings.mastering);
            self.input_highpass.set_mastering(mastering);
            self.output_conditioner.set_mastering(mastering);
        }
        let demand = settings.capped(self.available);
        let admission_changed =
            demand != self.demand || settings.automatic != self.performance.automatic;
        self.performance = settings;
        if admission_changed {
            self.demand = demand;
            self.adaptive.set_demand(self.demand);
            self.engine.set_pool_limit(self.current_limit());
        }
        self.update_metrics();
        Ok(())
    }

    fn current_limit(&self) -> usize {
        if self.performance.automatic {
            self.adaptive.limit().min(self.demand)
        } else {
            self.demand
        }
    }

    fn seed_capacity(&mut self, limit: usize) {
        if limit > 0 {
            self.adaptive.seed_measured_capacity(limit);
            self.engine.set_pool_limit(self.current_limit());
        }
        self.update_metrics();
    }

    fn validate_depth(depth: f64) -> Result<(), String> {
        if !depth.is_finite() || !(0.0..=1.0).contains(&depth) {
            return Err("Recursion is outside its supported range".into());
        }
        Ok(())
    }

    fn set_depth(&mut self, depth: f64) -> Result<(), String> {
        Self::validate_depth(depth)?;
        if !self.depth_controls {
            return Err("This pool requires a complete topology update".into());
        }
        if self.live_depth == Some(depth) {
            if let Some(pending) = &mut self.pending_install {
                pending.depth_override = Some(depth);
            }
            return Ok(());
        }
        let mut gains = [0.; 256];
        for (generation, gain) in gains.iter_mut().enumerate().skip(1) {
            *gain = 0.5 * depth.powf(generation as f64 * 0.72);
        }
        self.available = self
            .structural_group_counts
            .iter()
            .zip(gains)
            .filter_map(|(&count, gain)| (gain > 0.).then_some(count))
            .sum();
        let demand = self.performance.capped(self.available);
        if demand != self.demand {
            self.demand = demand;
            self.adaptive.set_demand(demand);
        }
        self.target_normalization = depth_normalization(depth);
        self.live_depth = Some(depth);
        if let Some(pending) = &mut self.pending_install {
            pending.depth_override = Some(depth);
        }
        self.engine
            .update_pool_group_gains(&gains, self.current_limit());
        self.update_metrics();
        Ok(())
    }

    fn validate_fold(interval_ms: f64) -> Result<(), String> {
        if !interval_ms.is_finite() || !(0.05..=3000.).contains(&interval_ms) {
            return Err("Time fold is outside its supported range".into());
        }
        Ok(())
    }

    fn unchanged_fold_eligibility(maximum: f64, minimum: f64, scale: f64) -> bool {
        maximum * scale <= 39. + 1e-9 && minimum * scale > 39. + 1e-9
    }

    fn set_time_fold(&mut self, interval_ms: f64) -> Result<(), String> {
        Self::validate_fold(interval_ms)?;
        let base = self
            .fold_base_ms
            .ok_or("This pool requires a complete timing update")?;
        let scale = interval_ms / base;
        if !Self::unchanged_fold_eligibility(
            self.eligible_delay_maximum,
            self.excluded_delay_minimum,
            scale,
        ) {
            return Err("Time fold requires updated history eligibility".into());
        }
        self.engine.set_time_fold_scale(scale)?;
        self.fold_interval_ms = interval_ms;
        if let Some(pending) = &mut self.pending_install {
            if pending.fold_base_ms.is_some() {
                pending.fold_interval_ms = Some(interval_ms);
                pending.fold_override = true;
            }
        }
        Ok(())
    }

    fn configure_install_time_fold(
        &mut self,
        base_ms: f64,
        interval_ms: f64,
        live: bool,
    ) -> Result<(), String> {
        Self::validate_fold(base_ms)?;
        Self::validate_fold(interval_ms)?;
        let pending = self
            .pending_install
            .as_mut()
            .ok_or("No delay pool is being prepared")?;
        pending.fold_base_ms = Some(base_ms);
        pending.fold_interval_ms = Some(interval_ms);
        pending.fold_override = live || interval_ms != base_ms;
        Ok(())
    }

    fn configure_install_scene_admission(&mut self, whole_scene: bool) -> Result<(), String> {
        let pending = self
            .pending_install
            .as_mut()
            .ok_or("No delay pool is being prepared")?;
        pending.whole_scene_admission = whole_scene;
        Ok(())
    }

    fn configure_install_depth(&mut self, depth: f64) -> Result<(), String> {
        Self::validate_depth(depth)?;
        let pending = self
            .pending_install
            .as_mut()
            .ok_or("No delay pool is being prepared")?;
        if !pending.depth_controls {
            return Err("This pool requires a complete topology update".into());
        }
        pending.depth_override = Some(depth);
        Ok(())
    }

    /// The caller retains this byte allocation until commit, rejection or abort.
    /// Reserve numeric storage once; validation and voice construction then run
    /// in bounded batches while the old recording and scene continue rendering.
    #[cfg(test)]
    fn begin_install(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.begin_install_header(&bytes[..bytes.len().min(HEADER)], bytes.len())
    }

    fn begin_install_header(&mut self, header: &[u8], total_bytes: usize) -> Result<(), String> {
        if header.len() < HEADER
            || read_u32(header, 0) != MAGIC
            || !matches!(read_u32(header, 4), 1 | 2)
        {
            return Err("Invalid delay pool format".into());
        }
        let count = read_u32(header, 8) as usize;
        let expected = count
            .checked_mul(RECORD)
            .and_then(|n| n.checked_add(HEADER))
            .ok_or("Pool size overflow")?;
        if total_bytes != expected {
            return Err("Truncated delay pool".into());
        }
        let normalization = read_f64(header, 24);
        if !normalization.is_finite() || !(0.0..=1.0).contains(&normalization) {
            return Err("Invalid wet normalization".into());
        }
        self.abort_install();
        let mut controls = match self.spare_controls.take() {
            Some(controls) => controls,
            None => PreparedPoolControls::new(0)?,
        };
        if let Err(error) = controls.prepare(count) {
            self.spare_controls = Some(controls);
            return Err(error);
        }
        let growth = (|| {
            if count <= self.capacity {
                return Ok(None);
            }
            let growth = PreparedPool::numeric(count)?;
            self.retired_pools
                .try_reserve(1)
                .map_err(|error| error.to_string())?;
            self.engine.begin_numeric_growth()?;
            Ok::<_, String>(Some(growth))
        })();
        let growth = match growth {
            Ok(growth) => growth,
            Err(error) => {
                self.spare_controls = Some(controls);
                return Err(error);
            }
        };
        let pending = StagedInstall {
            pointer: header.as_ptr(),
            bytes: total_bytes,
            count,
            next: 0,
            available: 0,
            revision: u64::from(read_u32(header, 16)) | u64::from(read_u32(header, 20)) << 32,
            normalization,
            depth_controls: read_u32(header, 4) == 2,
            whole_scene_admission: false,
            depth_override: None,
            fold_base_ms: None,
            fold_interval_ms: None,
            fold_override: false,
            eligible_delay_maximum: 0.,
            excluded_delay_minimum: f64::INFINITY,
            controls,
            growth,
        };
        self.pending_install = Some(pending);
        Ok(())
    }

    fn abort_install(&mut self) {
        if let Some(pending) = self.pending_install.take() {
            self.spare_controls = Some(pending.controls);
        }
        self.engine.abort_numeric_growth();
    }

    fn step_install(&mut self, maximum_records: usize) -> Result<bool, String> {
        let mut pending = self
            .pending_install
            .take()
            .ok_or("No delay pool is being prepared")?;
        let end = pending
            .next
            .saturating_add(maximum_records)
            .min(pending.count);
        // Future upload batches may still be uninitialized. Form a slice only
        // over the initialized header and complete records consumed so far.
        let initialized_bytes = HEADER + end * RECORD;
        debug_assert!(initialized_bytes <= pending.bytes);
        let bytes = unsafe { slice::from_raw_parts(pending.pointer, initialized_bytes) };
        for index in pending.next..end {
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
                || (rank != u32::MAX && rank as usize >= pending.count)
            {
                self.engine.abort_numeric_growth();
                self.spare_controls = Some(pending.controls);
                return Err("Invalid delay target".into());
            }
            pending.available += usize::from(target.gain > 0.);
            if target.delay <= 39. + 1e-9 {
                pending.eligible_delay_maximum = pending.eligible_delay_maximum.max(target.delay);
            } else {
                pending.excluded_delay_minimum = pending.excluded_delay_minimum.min(target.delay);
            }
            let seed = read_u32(bytes, base + 36);
            pending.controls.push(
                target,
                if rank == u32::MAX {
                    usize::MAX
                } else {
                    rank as usize
                },
                seed,
                self.engine.prepared_seed_epoch(index, seed),
                group as u8,
            );
        }
        if let Some(growth) = &mut pending.growth {
            self.engine.prepare_numeric_growth_until(growth, end);
        }
        pending.next = end;
        if end < pending.count {
            self.pending_install = Some(pending);
            return Ok(false);
        }
        if let (Some(base), Some(interval)) = (pending.fold_base_ms, pending.fold_interval_ms) {
            if !Self::unchanged_fold_eligibility(
                pending.eligible_delay_maximum,
                pending.excluded_delay_minimum,
                interval / base,
            ) {
                self.engine.abort_numeric_growth();
                self.spare_controls = Some(pending.controls);
                return Err("Time fold requires updated history eligibility".into());
            }
        }
        if let Some(mut growth) = pending.growth {
            self.engine.commit_numeric_growth(&mut growth);
            self.capacity = pending.count;
            self.adaptive.set_capacity(self.capacity);
            self.retired_slots += growth.capacity();
            self.retired_pools.push_back(growth);
        }
        self.structural_group_counts = *pending.controls.group_counts();
        self.available = pending.available;
        self.depth_controls = pending.depth_controls;
        self.live_depth = None;
        let override_gains = pending
            .depth_override
            .filter(|_| pending.depth_controls)
            .map(|depth| {
                let mut gains = [0.; 256];
                for (generation, gain) in gains.iter_mut().enumerate().skip(1) {
                    *gain = 0.5 * depth.powf(generation as f64 * 0.72);
                }
                self.available = self
                    .structural_group_counts
                    .iter()
                    .zip(gains)
                    .filter_map(|(&count, gain)| (gain > 0.).then_some(count))
                    .sum();
                self.live_depth = Some(depth);
                gains
            });
        self.demand = self.performance.capped(self.available);
        if pending.whole_scene_admission {
            self.adaptive
                .begin_bounded_scene(self.demand, self.structural_group_counts.iter().sum());
        } else {
            self.adaptive.begin_adaptive_scene(self.demand);
        }
        self.revision = pending.revision;
        self.requested = pending.count;
        self.target_normalization = self
            .live_depth
            .map_or(pending.normalization, depth_normalization);
        if let (Some(old_base), Some(new_base)) = (self.fold_base_ms, pending.fold_base_ms) {
            self.engine.rebase_time_fold_scale(old_base / new_base)?;
        }
        self.spare_controls = Some(self.engine.install_prepared_pool_controls_live(
            pending.controls,
            self.current_limit(),
            pending.fold_override,
        ));
        self.fold_base_ms = pending.fold_base_ms;
        self.fold_interval_ms = pending.fold_interval_ms.unwrap_or(0.);
        self.eligible_delay_maximum = pending.eligible_delay_maximum;
        self.excluded_delay_minimum = pending.excluded_delay_minimum;
        if pending.fold_override {
            self.engine
                .set_time_fold_scale(self.fold_interval_ms / self.fold_base_ms.unwrap())?;
        }
        if let Some(gains) = override_gains {
            self.engine
                .update_pool_group_gains(&gains, self.current_limit());
        }
        self.update_metrics();
        Ok(true)
    }

    fn collect_retired(&mut self, maximum_slots: usize) -> usize {
        let mut remaining = maximum_slots;
        while remaining > 0 {
            let Some(pool) = self.retired_pools.front_mut() else {
                break;
            };
            let count = pool.retire_numeric_slots(remaining);
            self.retired_slots -= count;
            remaining -= count;
            if pool.capacity() == 0 {
                self.retired_pools.pop_front();
            }
        }
        self.retired_slots
    }
    /// Control-message preparation only. Validation/allocation complete before
    /// any live pool is replaced. Growth swaps storage while preserving existing
    /// phases, gains, fades, recording cursor and all forty seconds of history.
    fn install(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() < HEADER
            || read_u32(bytes, 0) != MAGIC
            || !matches!(read_u32(bytes, 4), 1 | 2)
        {
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
        let mut structural_group_counts = [0; 256];
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
            if rank != u32::MAX {
                structural_group_counts[group as usize] += 1;
            }
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
        self.structural_group_counts = structural_group_counts;
        self.depth_controls = read_u32(bytes, 4) == 2;
        self.live_depth = None;
        self.demand = self.performance.capped(available);
        self.adaptive.begin_adaptive_scene(self.demand);
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
            // Preserve the hidden source's clock/state while its contribution
            // is exactly zero, without spending the audio deadline on three
            // inaudible sine evaluations. Source fades still evaluate every
            // sample as soon as the seed has a nonzero mix weight.
            let seed = f64::from(self.seed.next(
                self.frequency,
                self.pulse_rate,
                self.mic_mix != 1.,
            ));
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
        self.observe_with_maintenance(seconds, 0., frames, underrun)
    }
    fn observe_with_maintenance(
        &mut self,
        seconds: f64,
        maintenance_seconds: f64,
        frames: usize,
        underrun: bool,
    ) -> usize {
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
            if let Some(limit) = self.adaptive.observe_active_with_maintenance(
                seconds,
                maintenance_seconds,
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

/// Disposable worker calibration owns an independent recording. Ordinary
/// audio renderers never permit the calibration history preparation export.
#[no_mangle]
pub extern "C" fn lsd_new_calibration(rate: u32, capacity: usize) -> *mut Renderer {
    let handle = lsd_new(rate, capacity);
    if !handle.is_null() {
        unsafe {
            (*handle).calibration = true;
        }
    }
    handle
}

#[no_mangle]
pub unsafe extern "C" fn lsd_prepare_calibration_history(handle: *mut Renderer) -> u32 {
    if handle.is_null() {
        return 0;
    }
    if !(*handle).calibration {
        report("Recording history can only be prepared on a calibration renderer");
        return 0;
    }
    (*handle).engine.prepare_calibration_history();
    1
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
pub unsafe extern "C" fn lsd_install_begin(
    handle: *mut Renderer,
    pointer: *const u8,
    bytes: usize,
) -> u32 {
    if handle.is_null() || pointer.is_null() {
        return 0;
    }
    match (*handle).begin_install_header(slice::from_raw_parts(pointer, bytes.min(HEADER)), bytes) {
        Ok(()) => 1,
        Err(error) => {
            report(error);
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_install_step(handle: *mut Renderer, maximum_records: usize) -> u32 {
    if handle.is_null() {
        return 0;
    }
    match (*handle).step_install(maximum_records) {
        Ok(false) => 1,
        Ok(true) => 2,
        Err(error) => {
            report(error);
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn lsd_install_abort(handle: *mut Renderer) {
    if !handle.is_null() {
        (*handle).abort_install();
    }
}

/// Optional staging policy. The caller must preflight the complete prepared
/// scene within a device-reliable budget before selecting whole membership.
/// Omission leaves the historical automatic admission search unchanged.
#[no_mangle]
pub unsafe extern "C" fn lsd_install_scene_admission(
    handle: *mut Renderer,
    whole_scene: u32,
) -> u32 {
    if handle.is_null() || whole_scene > 1 {
        return 0;
    }
    match (*handle).configure_install_scene_admission(whole_scene != 0) {
        Ok(()) => 1,
        Err(error) => {
            report(error);
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn lsd_install_depth(handle: *mut Renderer, depth: f64) -> u32 {
    if handle.is_null() {
        return 0;
    }
    match (*handle).configure_install_depth(depth) {
        Ok(()) => 1,
        Err(error) => {
            report(error);
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn lsd_install_time_fold(
    handle: *mut Renderer,
    base_ms: f64,
    interval_ms: f64,
    live: u32,
) -> u32 {
    if handle.is_null() {
        return 0;
    }
    match (*handle).configure_install_time_fold(base_ms, interval_ms, live != 0) {
        Ok(()) => 1,
        Err(error) => {
            report(error);
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn lsd_time_fold(handle: *mut Renderer, interval_ms: f64) -> u32 {
    if handle.is_null() {
        return 0;
    }
    match (*handle).set_time_fold(interval_ms) {
        Ok(()) => 1,
        Err(error) => {
            report(error);
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn lsd_time_fold_value(handle: *const Renderer) -> f64 {
    if handle.is_null() {
        return 0.;
    }
    (*handle)
        .fold_base_ms
        .map_or(0., |base| base * (*handle).engine.time_fold_scale())
}

#[no_mangle]
pub unsafe extern "C" fn lsd_time_fold_target(handle: *const Renderer) -> f64 {
    if handle.is_null() {
        return 0.;
    }
    (*handle).fold_interval_ms
}
#[no_mangle]
pub unsafe extern "C" fn lsd_collect_retired(handle: *mut Renderer, maximum_slots: usize) -> usize {
    if handle.is_null() {
        return 0;
    }
    (*handle).collect_retired(maximum_slots)
}
#[no_mangle]
pub unsafe extern "C" fn lsd_capacity_hint(handle: *mut Renderer, limit: usize) -> u32 {
    if handle.is_null() {
        return 0;
    }
    (*handle).seed_capacity(limit);
    1
}
#[no_mangle]
pub unsafe extern "C" fn lsd_depth(handle: *mut Renderer, depth: f64) -> u32 {
    if handle.is_null() {
        return 0;
    }
    match (*handle).set_depth(depth) {
        Ok(()) => 1,
        Err(error) => {
            report(error);
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
/// Total work still owns CPU/miss telemetry. Only explicitly measured, finite
/// topology preparation/reclamation is excluded from the recurring voice cost.
#[no_mangle]
pub unsafe extern "C" fn lsd_observe_maintenance(
    handle: *mut Renderer,
    seconds: f64,
    maintenance_seconds: f64,
    frames: usize,
    underrun: u32,
) -> usize {
    if handle.is_null() {
        return 0;
    }
    (*handle).observe_with_maintenance(seconds, maintenance_seconds, frames, underrun != 0)
}
#[no_mangle]
pub extern "C" fn lsd_metrics_len() -> usize {
    METRICS
}
#[no_mangle]
pub unsafe extern "C" fn lsd_metrics_ptr(handle: *const Renderer) -> *const f64 {
    (*handle).metrics.as_ptr()
}
/// Borrowed active DSP slots. Read count/pointer together without intervening
/// processing or controls, and copy before the next mutation or memory growth.
#[no_mangle]
pub unsafe extern "C" fn lsd_active_indices_ptr(handle: *const Renderer) -> *const usize {
    (*handle).engine.active_voice_indices().as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn lsd_active_indices_count(handle: *const Renderer) -> usize {
    (*handle).engine.active_voice_indices().len()
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
    #[cfg(test)]
    evaluate_muted: bool,
    #[cfg(test)]
    output_evaluations: usize,
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
            #[cfg(test)]
            evaluate_muted: false,
            #[cfg(test)]
            output_evaluations: 0,
        }
    }
    fn strike(&mut self) {
        self.envelope = 1.0;
        self.transient = 1.0;
    }
    fn next(&mut self, frequency: f64, pulse_rate: f64, evaluate_output: bool) -> f32 {
        #[cfg(test)]
        let evaluate_output = evaluate_output || self.evaluate_muted;
        #[cfg(test)]
        if evaluate_output {
            self.output_evaluations += 1;
        }
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
            if evaluate_output {
                tone += (std::f64::consts::TAU * self.phases[i]).sin() * gain;
            }
        }
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        let output = if evaluate_output {
            let noise = self.rng as f64 / u32::MAX as f64 * 2.0 - 1.0;
            tone * self.envelope * 0.14 + noise * self.transient * 0.025
        } else {
            0.
        };
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

    fn install_bounded(renderer: &mut Renderer, compiled: &Compilation) {
        renderer.begin_install(&compiled.pool).unwrap();
        assert_eq!(unsafe { lsd_install_scene_admission(renderer, 1) }, 1);
        while !renderer.step_install(32).unwrap() {}
    }

    #[test]
    fn install_depth_is_staging_only_and_rejection_or_abort_preserves_exact_live_pcm() {
        let old = scene(4);
        let next = scene(7);
        let mut live = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        for renderer in [&mut live, &mut reference] {
            install_bounded(renderer, &old);
            renderer.set_depth(0.63).unwrap();
        }
        let compare_block = |live: &mut Renderer, reference: &mut Renderer| {
            let mut left = [0.; BLOCK];
            let mut right = [0.; BLOCK];
            let mut reference_l = [0.; BLOCK];
            let mut reference_r = [0.; BLOCK];
            let input = signal(live.frames as usize);
            live.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            assert_eq!(left.map(f32::to_bits), reference_l.map(f32::to_bits));
            assert_eq!(right.map(f32::to_bits), reference_r.map(f32::to_bits));
            assert_eq!(live.frames, reference.frames);
            assert_eq!(live.current_limit(), reference.current_limit());
            assert_eq!(live.live_depth, reference.live_depth);
        };
        for _ in 0..20 {
            compare_block(&mut live, &mut reference);
        }
        assert_eq!(unsafe { lsd_install_depth(std::ptr::null_mut(), 0.) }, 0);
        assert_eq!(unsafe { lsd_install_depth(&mut live, 0.) }, 0);
        for reject in [false, true] {
            let mut candidate = next.pool.clone();
            if reject {
                let last = candidate.len() - RECORD;
                candidate[last..last + 8].copy_from_slice(&f64::NAN.to_le_bytes());
            }
            live.begin_install(&candidate).unwrap();
            assert_eq!(unsafe { lsd_install_scene_admission(&mut live, 1) }, 1);
            assert_eq!(unsafe { lsd_install_depth(&mut live, 0.) }, 1);
            for invalid in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
                assert_eq!(unsafe { lsd_install_depth(&mut live, invalid) }, 0);
            }
            assert_eq!(
                live.pending_install.as_ref().unwrap().depth_override,
                Some(0.)
            );
            assert_eq!(live.live_depth, Some(0.63));
            assert!(!live.step_install(32).unwrap());
            for _ in 0..5 {
                compare_block(&mut live, &mut reference);
            }
            if reject {
                loop {
                    match live.step_install(32) {
                        Ok(false) => compare_block(&mut live, &mut reference),
                        Ok(true) => panic!("the malformed final record must reject"),
                        Err(_) => break,
                    }
                }
            } else {
                live.abort_install();
            }
            assert!(live.pending_install.is_none());
            assert_eq!(live.requested, reference.requested);
            assert_eq!(live.revision, reference.revision);
            assert_eq!(live.target_normalization, reference.target_normalization);
            for _ in 0..32 {
                compare_block(&mut live, &mut reference);
            }
        }
        let mut legacy = next.pool.clone();
        legacy[4..8].copy_from_slice(&1u32.to_le_bytes());
        live.begin_install(&legacy).unwrap();
        assert_eq!(unsafe { lsd_install_depth(&mut live, 0.9) }, 0);
        assert_eq!(live.pending_install.as_ref().unwrap().depth_override, None);
        live.abort_install();
        compare_block(&mut live, &mut reference);
    }

    #[test]
    fn install_depth_commits_latest_zero_or_live_override_with_complete_restoration() {
        let old = scene(2);
        let dense = scene(7);
        let denser = scene(8);
        let mut live = Renderer::new(8000, 1).unwrap();
        install_bounded(&mut live, &old);
        live.set_depth(0.48).unwrap();
        let old_limit = live.current_limit();
        live.begin_install(&dense.pool).unwrap();
        assert_eq!(unsafe { lsd_install_scene_admission(&mut live, 1) }, 1);
        assert_eq!(unsafe { lsd_install_depth(&mut live, 0.9) }, 1);
        assert!(!live.step_install(32).unwrap());
        assert_eq!(live.current_limit(), old_limit);
        assert_eq!(live.live_depth, Some(0.48));
        assert_eq!(unsafe { lsd_install_depth(&mut live, 0.) }, 1);
        while !live.step_install(32).unwrap() {}
        assert_eq!(live.requested, 254);
        assert_eq!(live.live_depth, Some(0.));
        assert_eq!(live.engine.target_voice_count(), 0);
        assert_eq!(
            live.current_limit(),
            0,
            "commit never arms the stale compiled depth"
        );
        live.set_depth(0.91).unwrap();
        assert_eq!(live.current_limit(), 254);
        assert_eq!(live.engine.target_voice_count(), 254);
        assert_eq!(
            live.engine.active_voice_indices(),
            &(0..254).collect::<Vec<_>>()
        );

        live.begin_install(&denser.pool).unwrap();
        assert_eq!(unsafe { lsd_install_scene_admission(&mut live, 1) }, 1);
        assert_eq!(unsafe { lsd_install_depth(&mut live, 0.) }, 1);
        assert!(!live.step_install(32).unwrap());
        live.set_depth(0.83).unwrap();
        assert_eq!(
            live.pending_install.as_ref().unwrap().depth_override,
            Some(0.83)
        );
        while !live.step_install(32).unwrap() {}
        assert_eq!(live.requested, 510);
        assert_eq!(
            live.live_depth,
            Some(0.83),
            "the later live gesture owns the commit"
        );
        assert_eq!(live.current_limit(), 510);
        assert_eq!(live.engine.target_voice_count(), 510);

        live.begin_install(&dense.pool).unwrap();
        assert_eq!(unsafe { lsd_install_scene_admission(&mut live, 1) }, 1);
        while !live.step_install(32).unwrap() {}
        assert_eq!(
            live.live_depth, None,
            "omitting staged depth keeps the pool's authored gains"
        );
        assert_eq!(live.current_limit(), 254);
        assert_eq!(live.engine.target_voice_count(), 254);
    }

    #[test]
    fn bounded_staging_commits_every_prepared_voice_together_after_tiny_scene_and_backoff() {
        let small = scene(2);
        let dense = scene(7);
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&small.pool).unwrap();
        renderer.seed_capacity(1000);
        renderer.observe(2. * BLOCK as f64 / 8000., BLOCK, false);
        let old_limit = renderer.current_limit();
        assert_eq!(old_limit, 2);
        let old_clock = renderer.frames;
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        renderer.begin_install(&dense.pool).unwrap();
        assert_eq!(unsafe { lsd_install_scene_admission(&mut renderer, 1) }, 1);
        while !renderer.step_install(32).unwrap() {
            assert_eq!(
                renderer.current_limit(),
                old_limit,
                "staging policy does not change the committed old scene"
            );
            let input = signal(renderer.frames as usize);
            renderer.process(&input, None, &mut left, &mut right);
        }
        let count = renderer.requested;
        assert_eq!(count, 254);
        assert_eq!(renderer.current_limit(), count);
        assert_eq!(renderer.engine.target_voice_count(), count);
        assert_eq!(
            renderer.engine.active_voice_indices(),
            &(0..count).collect::<Vec<_>>(),
            "every available branch is admitted in the atomic commit, before its gain attack"
        );
        assert!(
            renderer.frames > old_clock,
            "old playback ran throughout preparation"
        );
        for _ in 0..3 {
            let input = signal(renderer.frames as usize);
            renderer.process(&input, None, &mut left, &mut right);
        }
        assert!(
            renderer.engine.tap_activity()[..count]
                .iter()
                .all(|level| *level > 0.),
            "all prepared taps produce measured sound without waiting for admission generations"
        );
        for _ in 0..8000 / BLOCK * 10 {
            renderer.observe(0.2 * BLOCK as f64 / 8000., BLOCK, false);
            assert_eq!(renderer.current_limit(), count);
            assert_eq!(renderer.engine.target_voice_count(), count);
        }
    }

    #[test]
    fn bounded_zero_depth_and_manual_caps_restore_the_whole_structural_scene() {
        let parameters = model::Parameters {
            generations: 6,
            depth: 0.,
            interval_ms: 2.,
            pitch_scale: 0.,
            ..model::Parameters::default()
        };
        let compiled = compile(&serde_json::to_vec(&parameters).unwrap(), 8000).unwrap();
        let mut renderer = Renderer::new(8000, 1).unwrap();
        install_bounded(&mut renderer, &compiled);
        let count = renderer.structural_group_counts.iter().sum::<usize>();
        assert_eq!(count, 126);
        assert_eq!(renderer.current_limit(), 0);
        assert_eq!(unsafe { lsd_capacity_hint(&mut renderer, 1000) }, 1);
        assert_eq!(
            renderer.current_limit(),
            0,
            "a first-install worker hint cannot arm a zero-depth scene"
        );
        assert_eq!(renderer.adaptive.measured_limit(), 1000);
        renderer.set_depth(0.8).unwrap();
        assert_eq!(renderer.current_limit(), count);
        assert_eq!(renderer.engine.target_voice_count(), count);
        let mut settings = renderer.performance;
        settings.voice_ceiling = 3;
        renderer.set_performance(settings).unwrap();
        assert_eq!(renderer.engine.target_voice_count(), 3);
        renderer.set_depth(0.).unwrap();
        assert_eq!(renderer.engine.target_voice_count(), 0);
        renderer.set_depth(0.8).unwrap();
        assert_eq!(renderer.engine.target_voice_count(), 3);
        settings.voice_ceiling = 0;
        renderer.set_performance(settings).unwrap();
        assert_eq!(renderer.engine.target_voice_count(), count);
        renderer.observe(2. * BLOCK as f64 / 8000., BLOCK, false);
        let safe = renderer.current_limit();
        assert!(safe < count);
        assert_eq!(unsafe { lsd_capacity_hint(&mut renderer, 2000) }, 1);
        assert_eq!(
            renderer.current_limit(),
            safe,
            "a later worker hint cannot regrow an unchanged scene after real overload"
        );
        renderer.set_depth(0.).unwrap();
        renderer.set_depth(0.8).unwrap();
        assert_eq!(
            renderer.engine.target_voice_count(),
            safe,
            "live coefficient restoration cannot undo an actual deadline backoff"
        );
        for _ in 0..8000 / BLOCK * 10 {
            renderer.observe(0.2 * BLOCK as f64 / 8000., BLOCK, false);
        }
        assert_eq!(
            renderer.current_limit(),
            safe,
            "quiet playback retains fixed scene membership"
        );
    }

    #[test]
    fn scene_admission_policy_is_atomic_abortable_and_resets_when_omitted() {
        let first = scene(6);
        let next = scene(7);
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&first.pool).unwrap();
        let old_limit = renderer.current_limit();
        assert_eq!(
            unsafe { lsd_install_scene_admission(&mut renderer, 1) },
            0,
            "policy configuration requires a staged pool"
        );
        renderer.begin_install(&next.pool).unwrap();
        assert_eq!(
            unsafe { lsd_install_scene_admission(&mut renderer, 2) },
            0,
            "unsupported flags cannot change the pending scene"
        );
        assert_eq!(unsafe { lsd_install_scene_admission(&mut renderer, 1) }, 1);
        assert!(!renderer.step_install(1).unwrap());
        assert_eq!(renderer.current_limit(), old_limit);
        renderer.abort_install();
        for _ in 0..8000 / BLOCK * 4 {
            renderer.observe(0.1 * BLOCK as f64 / 8000., BLOCK, false);
        }
        assert_eq!(
            renderer.current_limit(),
            126,
            "aborted policy must not freeze the previous adaptive scene"
        );
        install_bounded(&mut renderer, &next);
        assert_eq!(renderer.current_limit(), 254);
        renderer.observe(2. * BLOCK as f64 / 8000., BLOCK, false);
        let reduced = renderer.current_limit();
        for _ in 0..8000 / BLOCK * 10 {
            renderer.observe(0.1 * BLOCK as f64 / 8000., BLOCK, false);
        }
        assert_eq!(renderer.current_limit(), reduced);
        renderer.begin_install(&next.pool).unwrap();
        while !renderer.step_install(32).unwrap() {}
        for _ in 0..8000 / BLOCK * 15 {
            renderer.observe(0.1 * BLOCK as f64 / 8000., BLOCK, false);
        }
        assert_eq!(
            renderer.current_limit(),
            254,
            "omitting the optional flag restores legacy search"
        );
    }

    #[test]
    fn calibration_history_is_ready_for_long_heads_and_cannot_mutate_live_recording() {
        let mut live = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        let compiled = scene(3);
        for renderer in [&mut live, &mut reference] {
            renderer.install(&compiled.pool).unwrap();
            renderer.seed_capacity(100);
        }
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        for block in 0..64 {
            let input = signal(block * BLOCK);
            live.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
        }
        let frames = live.frames;
        assert_eq!(unsafe { lsd_prepare_calibration_history(&mut live) }, 0);
        assert_eq!(live.frames, frames);
        for block in 64..96 {
            let input = signal(block * BLOCK);
            live.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            assert_eq!(left.map(f32::to_bits), reference_l.map(f32::to_bits));
            assert_eq!(right.map(f32::to_bits), reference_r.map(f32::to_bits));
        }
        unsafe {
            assert_eq!(lsd_prepare_calibration_history(std::ptr::null_mut()), 0);
            let calibration = lsd_new_calibration(8000, 1);
            assert!(!calibration.is_null());
            let mut long = scene(2);
            for record in long.pool[HEADER..].chunks_exact_mut(RECORD) {
                record[..8].copy_from_slice(&30f64.to_le_bytes());
            }
            (*calibration).install(&long.pool).unwrap();
            (*calibration).seed_capacity(100);
            (*calibration).process(&[0.; BLOCK], None, &mut left, &mut right);
            assert_eq!(
                (*calibration).engine.tap_activity()[0],
                0.,
                "the long head initially lacks recorded history"
            );
            let before = (*calibration).frames;
            assert_eq!(lsd_prepare_calibration_history(calibration), 1);
            assert_eq!(
                (*calibration).frames,
                before,
                "history preparation never advances the clock"
            );
            (*calibration).process(&[0.; BLOCK], None, &mut left, &mut right);
            assert!(
                (*calibration).engine.tap_activity()[0] > 0.,
                "timed calibration includes real 30-second history reads"
            );
            assert_eq!(
                lsd_prepare_calibration_history(calibration),
                1,
                "worker preflight can reuse its independent renderer"
            );
            lsd_drop(calibration);
        }
    }

    fn assert_same_seed_state(actual: &Seed, reference: &Seed) {
        assert_eq!(
            actual.phases.map(f64::to_bits),
            reference.phases.map(f64::to_bits)
        );
        assert_eq!(
            actual.pulse_phase.to_bits(),
            reference.pulse_phase.to_bits()
        );
        assert_eq!(actual.envelope.to_bits(), reference.envelope.to_bits());
        assert_eq!(actual.transient.to_bits(), reference.transient.to_bits());
        assert_eq!(actual.rng, reference.rng);
    }

    #[test]
    fn muted_seed_retains_exact_clock_state_and_future_sound() {
        for rate in [8000, 48000] {
            let mut muted = Seed::new(rate);
            let mut evaluated = Seed::new(rate);
            // Changing frequency, pulse timing and strikes must continue to
            // affect the hidden source while microphone audio is selected.
            for frame in 0..rate * 3 {
                let frequency = if frame < rate { 117. } else { 713.25 };
                let pulse_rate = if frame < rate * 2 { 0.7 } else { 13.125 };
                if frame % 1379 == 0 {
                    muted.strike();
                    evaluated.strike();
                }
                assert_eq!(muted.next(frequency, pulse_rate, false), 0.);
                evaluated.next(frequency, pulse_rate, true);
                if frame % 128 == 0 {
                    assert_same_seed_state(&muted, &evaluated);
                }
            }
            assert_eq!(muted.output_evaluations, 0);
            assert_eq!(evaluated.output_evaluations, (rate * 3) as usize);
            assert_same_seed_state(&muted, &evaluated);
            // Reactivation must start at the exact phase/noise/envelope that
            // the former continuously evaluated implementation would produce.
            for _ in 0..4096 {
                assert_eq!(
                    muted.next(391.75, 2.3, true).to_bits(),
                    evaluated.next(391.75, 2.3, true).to_bits()
                );
            }
            assert_same_seed_state(&muted, &evaluated);
        }
    }

    #[test]
    fn microphone_pcm_and_source_crossfades_match_continuous_seed_evaluation() {
        let compiled = scene(4);
        let mut actual = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        // The reference follows the former render path: all seed output math
        // executes even when it is multiplied by an exactly zero mix weight.
        reference.seed.evaluate_muted = true;
        let mut settings = Performance {
            automatic: false,
            voice_ceiling: 8,
            source: Source::Mic,
            ..Performance::default()
        };
        actual.set_performance(settings).unwrap();
        reference.set_performance(settings).unwrap();
        actual.install(&compiled.pool).unwrap();
        reference.install(&compiled.pool).unwrap();
        let mut actual_l = [0.; BLOCK];
        let mut actual_r = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        for block in 0..240 {
            if block % 19 == 0 {
                settings.frequency = 117. + block as f64 * 1.5;
                settings.pulse_rate = 0.7 + block as f64 * 0.0125;
                settings.input_gain = 0.3 + (block % 5) as f32 * 0.1;
                actual.set_performance(settings).unwrap();
                reference.set_performance(settings).unwrap();
                actual.seed.strike();
                reference.seed.strike();
            }
            if block == 120 || block == 176 {
                settings.source = if block == 120 {
                    Source::Seed
                } else {
                    Source::Mic
                };
                actual.set_performance(settings).unwrap();
                reference.set_performance(settings).unwrap();
            }
            let input = signal(block * BLOCK);
            actual.process(&input, None, &mut actual_l, &mut actual_r);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            assert_eq!(
                actual_l.map(f32::to_bits),
                reference_l.map(f32::to_bits),
                "left PCM block {block}"
            );
            assert_eq!(
                actual_r.map(f32::to_bits),
                reference_r.map(f32::to_bits),
                "right PCM block {block}"
            );
            assert_same_seed_state(&actual.seed, &reference.seed);
            if block == 119 {
                assert_eq!(actual.seed.output_evaluations, 0);
                assert_eq!(reference.seed.output_evaluations, 120 * BLOCK);
            }
        }
        assert_eq!(
            actual.seed.output_evaluations,
            120 * BLOCK,
            "both source fades remain evaluated whenever their contribution is nonzero"
        );
        assert_eq!(reference.seed.output_evaluations, 240 * BLOCK);
        assert_eq!(actual.frames, reference.frames);
    }

    #[test]
    fn bounded_api_retains_requested_scene_and_limits_every_prepared_record() {
        let parameters = model::Parameters {
            generations: 52,
            depth: 0.,
            ..model::Parameters::default()
        };
        let result =
            compile_with_budget(&serde_json::to_vec(&parameters).unwrap(), 8000, Some(37)).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&result.json).unwrap();
        assert_eq!(
            json["parameters"],
            serde_json::to_value(&parameters).unwrap()
        );
        assert_eq!(json["requestedVoices"], (1_u64 << 53) - 2);
        assert_eq!(json["preparedVoices"], 37);
        assert_eq!(json["nodes"].as_array().unwrap().len(), 38);
        assert_eq!(json["previewSampled"], false);
        assert_eq!(json["eligibleVoices"], 0);
        assert_eq!(json["structuralEligibleVoices"], 37);
        assert_eq!(read_u32(&result.pool, 8), 37);
        assert_eq!(result.pool.len(), HEADER + 37 * RECORD);
    }

    #[test]
    fn measured_capacity_hint_obeys_automatic_demand_and_retains_live_clock() {
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&scene(6).pool).unwrap();
        renderer.seed_capacity(91);
        assert_eq!(renderer.current_limit(), 91);
        assert_eq!(renderer.adaptive.measured_limit(), 91);
        renderer.seed_capacity(usize::MAX);
        assert_eq!(renderer.current_limit(), renderer.demand);
        let mut manual = renderer.performance;
        manual.automatic = false;
        manual.voice_ceiling = 17;
        renderer.set_performance(manual).unwrap();
        renderer.seed_capacity(3);
        assert_eq!(renderer.current_limit(), 17);
        assert_eq!(renderer.frames, 0);
        assert_eq!(renderer.revision, 0);
    }

    #[test]
    fn measured_capacity_hint_survives_a_small_first_scene_and_later_growth() {
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&scene(3).pool).unwrap();
        renderer.set_depth(0.).unwrap();
        renderer.seed_capacity(1024);
        assert_eq!(renderer.current_limit(), 0);
        assert_eq!(renderer.adaptive.measured_limit(), 1024);
        renderer.set_depth(1.).unwrap();
        assert_eq!(renderer.current_limit(), 14);
        assert_eq!(renderer.adaptive.measured_limit(), 1024);
        renderer.install(&scene(10).pool).unwrap();
        assert_eq!(renderer.current_limit(), 1024);
        assert_eq!(renderer.adaptive.measured_limit(), 1024);
    }

    #[test]
    fn measured_capacity_hint_retains_proof_through_initial_manual_admission() {
        let mut renderer = Renderer::new(8000, 1).unwrap();
        let manual = Performance {
            automatic: false,
            voice_ceiling: 7,
            ..Performance::default()
        };
        renderer.set_performance(manual).unwrap();
        renderer.install(&scene(3).pool).unwrap();
        renderer.seed_capacity(1024);
        assert_eq!(renderer.current_limit(), 7);
        assert_eq!(renderer.adaptive.measured_limit(), 1024);
        renderer.install(&scene(10).pool).unwrap();
        assert_eq!(renderer.current_limit(), 7);
        renderer
            .set_performance(Performance {
                automatic: true,
                voice_ceiling: 0,
                ..manual
            })
            .unwrap();
        assert_eq!(renderer.current_limit(), 1024);
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
    fn branching_grammar_pools_preserve_live_pcm_and_latest_controls_through_staging() {
        let settings = Performance {
            automatic: false,
            voice_ceiling: 64,
            ..Performance::default()
        };
        let first = scene(4);
        let mut staged = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        for renderer in [&mut staged, &mut reference] {
            renderer.set_performance(settings).unwrap();
            renderer.install(&first.pool).unwrap();
        }
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        let mut block = 0;
        for (edit, (id, expected)) in [
            ("bush", 3124),
            ("fan", 3124),
            ("fern", 4117),
            ("whorled", 4117),
            ("ternary", 363),
            ("quaternary", 340),
        ]
        .into_iter()
        .enumerate()
        {
            let parameters = model::Parameters {
                l_system_type: id.into(),
                interval_ms: 2.,
                angle: 31.,
                ..model::Parameters::default()
            };
            let compiled = compile(&serde_json::to_vec(&parameters).unwrap(), 8000).unwrap();
            let result: serde_json::Value = serde_json::from_slice(&compiled.json).unwrap();
            assert_eq!(result["requestedVoices"], expected, "{id}");
            assert_eq!(read_u32(&compiled.pool, 8), expected, "{id}");
            assert_eq!(
                compiled.pool.len(),
                HEADER + expected as usize * RECORD,
                "{id}"
            );
            assert_eq!(
                result["generationLimits"].as_object().unwrap().len(),
                model::L_SYSTEM_TYPES.len()
            );
            assert!(result["generationLimits"][id].as_u64().unwrap() >= 13);
            staged.begin_install(&compiled.pool).unwrap();
            let depth = 0.5 + edit as f64 * 0.035;
            let performance = Performance {
                wet: 0.4 + edit as f32 * 0.07,
                ..settings
            };
            for renderer in [&mut staged, &mut reference] {
                renderer.set_depth(depth).unwrap();
                renderer.set_performance(performance).unwrap();
            }
            loop {
                let input = signal(block * BLOCK);
                staged.process(&input, None, &mut left, &mut right);
                reference.process(&input, None, &mut reference_l, &mut reference_r);
                assert_eq!(
                    left, reference_l,
                    "{id} old audio stays live during staging"
                );
                assert_eq!(right, reference_r, "{id}");
                assert_eq!(staged.frames, reference.frames, "{id} sample clock");
                block += 1;
                if staged.step_install(256).unwrap() {
                    break;
                }
            }
            reference.install(&compiled.pool).unwrap();
            reference.set_depth(depth).unwrap();
            assert_eq!(staged.live_depth, Some(depth), "{id}");
            assert_eq!(staged.performance.wet, performance.wet, "{id}");
            let mut energy = 0_f64;
            for _ in 0..32 {
                let input = signal(block * BLOCK);
                staged.process(&input, None, &mut left, &mut right);
                reference.process(&input, None, &mut reference_l, &mut reference_r);
                assert_eq!(
                    left, reference_l,
                    "{id} committed audio matches ordinary install"
                );
                assert_eq!(right, reference_r, "{id}");
                assert_eq!(staged.frames, reference.frames, "{id}");
                for &sample in left.iter().chain(&right) {
                    assert!(
                        sample.is_finite() && sample.abs() < 1.,
                        "{id} finite bounded PCM"
                    );
                    energy += f64::from(sample) * f64::from(sample);
                }
                block += 1;
            }
            assert!(energy > 1e-5, "{id} must retain audible signal");
        }
        assert_eq!(staged.frames, (block * BLOCK) as u64);
    }

    #[test]
    fn warmed_staged_control_edits_reuse_storage_without_allocating_or_freeing() {
        let large = scene(10);
        let small = scene(6);
        let settings = Performance {
            automatic: false,
            voice_ceiling: 256,
            ..Performance::default()
        };
        let mut live = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        live.set_performance(settings).unwrap();
        reference.set_performance(settings).unwrap();
        // Warm both retained control buffers and the voice-storage high water.
        for _ in 0..2 {
            live.begin_install(&large.pool).unwrap();
            while !live.step_install(73).unwrap() {}
        }
        while live.collect_retired(256) != 0 {}
        reference.install(&large.pool).unwrap();
        let retained_bytes =
            live.engine.allocated_bytes() + live.spare_controls.as_ref().unwrap().allocated_bytes();
        let edits: Vec<_> = (0..8)
            .map(|edit| {
                let mut bytes = if edit % 3 == 1 {
                    small.pool.clone()
                } else {
                    large.pool.clone()
                };
                let count = read_u32(&bytes, 8) as usize;
                bytes[16..20].copy_from_slice(&(edit as u32 + 20).to_le_bytes());
                for index in 0..count {
                    let base = HEADER + index * RECORD;
                    for (offset, value) in [
                        (0, 0.003 + index as f64 * 0.00004 + edit as f64 * 0.0001),
                        (8, 0.91 + edit as f64 * 0.03),
                        (24, (index as f64 * 0.03 + edit as f64).sin() * 0.7),
                    ] {
                        bytes[base + offset..base + offset + 8]
                            .copy_from_slice(&value.to_le_bytes());
                    }
                }
                bytes
            })
            .collect();
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        let mut block = 0;
        for bytes in &edits {
            ALLOCATIONS.with(|n| n.set(0));
            FREES.with(|n| n.set(0));
            TRACK.with(|n| n.set(true));
            let begin = live.begin_install(bytes);
            TRACK.with(|n| n.set(false));
            begin.unwrap();
            assert_eq!(
                ALLOCATIONS.with(Cell::get),
                0,
                "warm begin reserves nothing"
            );
            assert_eq!(FREES.with(Cell::get), 0, "warm begin releases nothing");
            loop {
                let input = signal(block * BLOCK);
                live.process(&input, None, &mut left, &mut right);
                reference.process(&input, None, &mut reference_l, &mut reference_r);
                assert_eq!(left, reference_l, "old scene stays live during preparation");
                assert_eq!(right, reference_r);
                block += 1;
                ALLOCATIONS.with(|n| n.set(0));
                FREES.with(|n| n.set(0));
                TRACK.with(|n| n.set(true));
                let committed = live.step_install(73);
                TRACK.with(|n| n.set(false));
                assert_eq!(ALLOCATIONS.with(Cell::get), 0, "warm step reserves nothing");
                assert_eq!(
                    FREES.with(Cell::get),
                    0,
                    "atomic commit retains old buffers"
                );
                if committed.unwrap() {
                    break;
                }
            }
            reference.install(bytes).unwrap();
            for _ in 0..10 {
                let input = signal(block * BLOCK);
                live.process(&input, None, &mut left, &mut right);
                reference.process(&input, None, &mut reference_l, &mut reference_r);
                assert_eq!(
                    left, reference_l,
                    "live timing/pitch/pan edits preserve PCM"
                );
                assert_eq!(right, reference_r);
                assert_eq!(live.frames, reference.frames);
                block += 1;
            }
            assert_eq!(live.capacity, read_u32(&large.pool, 8) as usize);
            assert_eq!(live.requested, read_u32(bytes, 8) as usize);
            assert_eq!(
                live.engine.allocated_bytes()
                    + live.spare_controls.as_ref().unwrap().allocated_bytes(),
                retained_bytes,
                "shrinking and restoring a scene retain exactly the warmed heap storage"
            );
        }
    }

    #[test]
    fn staged_control_storage_survives_abort_replacement_and_late_rejection() {
        let compiled = scene(9);
        let mut live = Renderer::new(8000, 1).unwrap();
        for _ in 0..2 {
            live.begin_install(&compiled.pool).unwrap();
            while !live.step_install(73).unwrap() {}
        }
        while live.collect_retired(256) != 0 {}
        let mut invalid = compiled.pool.clone();
        let end = invalid.len();
        invalid[end - RECORD..end - RECORD + 8].copy_from_slice(&f64::NAN.to_le_bytes());
        let revision = live.revision;
        for action in 0..3 {
            ALLOCATIONS.with(|n| n.set(0));
            FREES.with(|n| n.set(0));
            TRACK.with(|n| n.set(true));
            let result = (|| -> Result<(), String> {
                live.begin_install(if action == 2 {
                    &invalid
                } else {
                    &compiled.pool
                })?;
                if action == 2 {
                    loop {
                        match live.step_install(73) {
                            Ok(false) => {}
                            Ok(true) => panic!("invalid last record must reject"),
                            Err(_) => break,
                        }
                    }
                } else {
                    assert!(!live.step_install(73)?);
                    if action == 0 {
                        live.abort_install();
                    } else {
                        live.begin_install(&compiled.pool)?;
                        live.abort_install();
                    }
                }
                live.begin_install(&compiled.pool)?;
                while !live.step_install(73)? {}
                Ok(())
            })();
            TRACK.with(|n| n.set(false));
            result.unwrap();
            assert_eq!(
                ALLOCATIONS.with(Cell::get),
                if action == 2 { 1 } else { 0 },
                "only the rejected record's error String allocates"
            );
            assert_eq!(
                FREES.with(Cell::get),
                if action == 2 { 1 } else { 0 },
                "only the rejection error is freed; numeric buffers are retained"
            );
            assert_eq!(live.revision, revision);
            assert!(live.pending_install.is_none());
            assert!(live.spare_controls.is_some());
        }
    }

    #[test]
    fn scalar_time_fold_keeps_pool_history_admission_and_allocations_through_live_reversals() {
        let compiled = scene(7);
        let mut live = Renderer::new(8000, 1).unwrap();
        live.set_performance(Performance {
            automatic: false,
            voice_ceiling: 0,
            ..Performance::default()
        })
        .unwrap();
        live.begin_install(&compiled.pool).unwrap();
        live.configure_install_time_fold(2., 2., false).unwrap();
        while !live.step_install(73).unwrap() {}
        let revision = live.revision;
        let admitted = live.engine.target_voice_count();
        let retained = live.engine.allocated_bytes();
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        for block in 0..40 {
            live.process(&signal(block * BLOCK), None, &mut left, &mut right);
        }
        let before = live.frames;
        for interval in [0.05, 0.075, 2., 73., 2.] {
            ALLOCATIONS.with(|n| n.set(0));
            FREES.with(|n| n.set(0));
            TRACK.with(|n| n.set(true));
            let updated = live.set_time_fold(interval);
            for block in 0..40 {
                live.process(
                    &signal((before as usize) + block * BLOCK),
                    None,
                    &mut left,
                    &mut right,
                );
            }
            TRACK.with(|n| n.set(false));
            updated.unwrap();
            assert_eq!(ALLOCATIONS.with(Cell::get), 0);
            assert_eq!(FREES.with(Cell::get), 0);
            assert_eq!(live.fold_interval_ms, interval);
            assert_eq!(live.revision, revision);
            assert_eq!(live.engine.target_voice_count(), admitted);
            assert_eq!(live.engine.allocated_bytes(), retained);
            assert!(left.iter().chain(&right).all(|sample| sample.is_finite()));
            assert!(left.iter().chain(&right).any(|sample| sample.abs() > 1e-5));
        }
        assert_eq!(live.frames, before + 5 * 40 * BLOCK as u64);
        assert!((unsafe { lsd_time_fold_value(&live) } - 2.).abs() < 0.001);
    }

    #[test]
    fn latest_live_fold_survives_staging_rebase_and_abort_but_complete_presets_own_their_fold() {
        let first = scene(6);
        let second = scene(8);
        let mut live = Renderer::new(8000, 1).unwrap();
        live.begin_install(&first.pool).unwrap();
        live.configure_install_time_fold(2., 2., false).unwrap();
        while !live.step_install(73).unwrap() {}
        live.set_time_fold(73.).unwrap();
        live.begin_install(&second.pool).unwrap();
        live.configure_install_time_fold(2., 73., true).unwrap();
        assert!(!live.step_install(73).unwrap());
        live.set_time_fold(0.075).unwrap();
        live.set_depth(0.9).unwrap();
        while !live.step_install(73).unwrap() {}
        assert_eq!(live.fold_interval_ms, 0.075);
        assert_eq!(live.fold_base_ms, Some(2.));
        assert_eq!(live.live_depth, Some(0.9));
        live.begin_install(&first.pool).unwrap();
        live.configure_install_time_fold(2., 0.05, true).unwrap();
        assert!(!live.step_install(73).unwrap());
        live.abort_install();
        assert_eq!(live.fold_interval_ms, 0.075);
        live.begin_install(&first.pool).unwrap();
        live.configure_install_time_fold(2., 2., false).unwrap();
        while !live.step_install(73).unwrap() {}
        assert_eq!(live.fold_interval_ms, 2.);
        assert_eq!(live.engine.time_fold_scale(), 1.);
    }

    #[test]
    fn live_fold_eligibility_guard_uses_raw_prepared_delays_even_at_zero_depth() {
        let mut pool = vec![0u8; HEADER + 2 * RECORD];
        pool[0..4].copy_from_slice(&MAGIC.to_le_bytes());
        pool[4..8].copy_from_slice(&2u32.to_le_bytes());
        pool[8..12].copy_from_slice(&2u32.to_le_bytes());
        pool[12..16].copy_from_slice(&1u32.to_le_bytes());
        pool[24..32].copy_from_slice(&1f64.to_le_bytes());
        for (index, delay) in [38f64, 80.].into_iter().enumerate() {
            let base = HEADER + index * RECORD;
            pool[base..base + 8].copy_from_slice(&delay.to_le_bytes());
            pool[base + 8..base + 16].copy_from_slice(&1f64.to_le_bytes());
            pool[base + 16..base + 24]
                .copy_from_slice(&(if index == 0 { 0.5f64 } else { 0. }).to_le_bytes());
            pool[base + 32..base + 36]
                .copy_from_slice(&(if index == 0 { 0u32 } else { u32::MAX }).to_le_bytes());
            pool[base + 40..base + 44].copy_from_slice(&1u32.to_le_bytes());
        }
        let mut live = Renderer::new(8000, 1).unwrap();
        live.begin_install(&pool).unwrap();
        live.configure_install_time_fold(240., 240., false).unwrap();
        while !live.step_install(1).unwrap() {}
        live.set_depth(0.).unwrap();
        live.set_time_fold(200.).unwrap();
        assert_eq!(live.engine.target_voice_count(), 0);
        assert!(
            live.set_time_fold(300.).is_err(),
            "a prepared eligible slot would exceed history"
        );
        assert!(
            live.set_time_fold(50.).is_err(),
            "an excluded prepared slot would become eligible"
        );
        assert_eq!(live.fold_interval_ms, 200.);
        live.begin_install(&pool).unwrap();
        live.configure_install_time_fold(240., 50., true).unwrap();
        assert!(!live.step_install(1).unwrap());
        assert!(
            live.step_install(1).is_err(),
            "late invalid timing rejects before atomic adoption"
        );
        assert_eq!(live.fold_interval_ms, 200.);
        assert!(live.pending_install.is_none());
    }

    #[test]
    fn repeated_full_capacity_control_commits_retain_every_voice_and_numeric_allocation() {
        const EDITS: usize = 12;
        let compiled = scene(11);
        let count = read_u32(&compiled.pool, 8) as usize;
        assert!(count > l_system_delay_core::TAP_ACTIVITY_CAPACITY);
        let mut live = Renderer::new(8000, 1).unwrap();
        live.set_performance(Performance {
            automatic: false,
            voice_ceiling: 0,
            ..Performance::default()
        })
        .unwrap();
        for _ in 0..2 {
            live.begin_install(&compiled.pool).unwrap();
            while !live.step_install(256).unwrap() {}
        }
        while live.collect_retired(256) != 0 {}
        let retained_bytes =
            live.engine.allocated_bytes() + live.spare_controls.as_ref().unwrap().allocated_bytes();
        let mut begin_micros = [0.; EDITS];
        let mut commit_micros = [0.; EDITS];
        for edit in 0..EDITS {
            ALLOCATIONS.with(|n| n.set(0));
            FREES.with(|n| n.set(0));
            TRACK.with(|n| n.set(true));
            let started = std::time::Instant::now();
            let began = live.begin_install(&compiled.pool);
            begin_micros[edit] = started.elapsed().as_secs_f64() * 1e6;
            TRACK.with(|n| n.set(false));
            began.unwrap();
            loop {
                let started = std::time::Instant::now();
                TRACK.with(|n| n.set(true));
                let result = live.step_install(256);
                TRACK.with(|n| n.set(false));
                let micros = started.elapsed().as_secs_f64() * 1e6;
                if result.unwrap() {
                    commit_micros[edit] = micros;
                    break;
                }
            }
            assert_eq!(ALLOCATIONS.with(Cell::get), 0);
            assert_eq!(FREES.with(Cell::get), 0);
            assert_eq!(live.engine.active_voice_count(), count);
            assert_eq!(live.engine.target_voice_count(), count);
            assert_eq!(live.capacity, count);
            assert_eq!(
                live.engine.allocated_bytes()
                    + live.spare_controls.as_ref().unwrap().allocated_bytes(),
                retained_bytes
            );
        }
        // Characterization only: host timings do not prove browser deadlines.
        // The commit includes its final record batch and retains O(active) work.
        eprintln!("numeric control reuse: {count} active voices, {EDITS} edits; begin mean/max {:.1}/{:.1} us; final step mean/max {:.1}/{:.1} us; retained two-buffer controls ~{} bytes",
            begin_micros.iter().sum::<f64>() / EDITS as f64,
            begin_micros.iter().copied().fold(0., f64::max),
            commit_micros.iter().sum::<f64>() / EDITS as f64,
            commit_micros.iter().copied().fold(0., f64::max),
            2 * count * (std::mem::size_of::<l_system_delay_core::PoolControl>() + std::mem::size_of::<usize>()));
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
            renderer.metrics[3], 172.,
            "Unsafe restored capacity uses proportional deadline backoff, not the tiny prior scene"
        );
        assert_eq!(renderer.metrics[19], 172.);
    }
    #[test]
    fn maintenance_observation_counts_total_misses_and_revalidates_retained_capacity() {
        let large = scene(7);
        let small = scene(1);
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&large.pool).unwrap();
        for _ in 0..200 {
            renderer.observe(0.001, BLOCK, false);
        }
        renderer.install(&small.pool).unwrap();
        renderer.install(&large.pool).unwrap();
        let misses = renderer.metrics[13];
        unsafe {
            lsd_observe_maintenance(&mut renderer, 0.02, 0.019, BLOCK, 0);
        }
        assert_eq!(
            renderer.metrics[13],
            misses + 1.,
            "full callback work still missed its real deadline"
        );
        assert_eq!(
            renderer.metrics[3], 172.,
            "the immediate target protects against the overrun"
        );
        assert_eq!(
            renderer.metrics[19], 254.,
            "finite preparation does not erase device evidence"
        );
        assert!(
            renderer.metrics[6] > 0.0625,
            "CPU telemetry includes the full preparation burst"
        );
        for _ in 0..15 {
            renderer.observe(0.001, BLOCK, false);
            if renderer.metrics[3] >= 254. {
                break;
            }
        }
        assert_eq!(
            renderer.metrics[3], 254.,
            "previous device capacity returns as a measured trial"
        );
        renderer.observe(0.02, BLOCK, false);
        assert_eq!(
            renderer.metrics[19], 172.,
            "a genuine recurring DSP overrun invalidates unsafe capacity"
        );
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
    fn live_recursion_matches_complete_scene_updates_without_allocating_or_resetting_audio() {
        let mut parameters = model::Parameters {
            generations: 13,
            interval_ms: 2.,
            mutation: 0.28,
            pruning_bias: 0.43,
            ..model::Parameters::default()
        };
        let first = compile(&serde_json::to_vec(&parameters).unwrap(), 8000).unwrap();
        let mut live = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        let settings = Performance {
            automatic: false,
            voice_ceiling: 64,
            ..Performance::default()
        };
        for renderer in [&mut live, &mut reference] {
            renderer.set_performance(settings).unwrap();
            renderer.install(&first.pool).unwrap();
        }
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        let mut block = 0;
        for _ in 0..64 {
            let input = signal(block * BLOCK);
            live.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            block += 1;
        }
        let capacity = live.capacity;
        let allocated_bytes = live.engine.allocated_bytes();
        let revision = live.revision;
        let group_counts = live.structural_group_counts;
        for depth in [0.91, 0.34, 0.65, 0., 0.48, 0.96, 1., 0., 1.] {
            parameters.depth = depth;
            let compiled = compile(&serde_json::to_vec(&parameters).unwrap(), 8000).unwrap();
            let frames = live.frames;
            let normalization = live.wet_normalization;
            let envelope_end = live.envelope.end_time();
            ALLOCATIONS.with(|n| n.set(0));
            FREES.with(|n| n.set(0));
            TRACK.with(|enabled| enabled.set(true));
            live.set_depth(depth).unwrap();
            TRACK.with(|enabled| enabled.set(false));
            assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
            assert_eq!(FREES.with(|n| n.get()), 0);
            assert_eq!(live.live_depth, Some(depth));
            assert_eq!(live.frames, frames, "Depth edits preserve the audio clock");
            assert_eq!(live.envelope.end_time(), envelope_end);
            assert_eq!(live.capacity, capacity);
            assert_eq!(live.engine.allocated_bytes(), allocated_bytes);
            assert_eq!(live.revision, revision);
            assert_eq!(live.structural_group_counts, group_counts);
            assert_eq!(
                live.wet_normalization, normalization,
                "Bus gain ramps at sample rate"
            );
            assert_eq!(live.target_normalization, depth_normalization(depth));
            reference.install(&compiled.pool).unwrap();
            assert_eq!(live.available, reference.available);
            assert_eq!(
                live.engine.target_voice_count(),
                reference.engine.target_voice_count()
            );
            for _ in 0..32 {
                let input = signal(block * BLOCK);
                live.process(&input, None, &mut left, &mut right);
                reference.process(&input, None, &mut reference_l, &mut reference_r);
                assert_eq!(left, reference_l, "Recursion {depth}");
                assert_eq!(right, reference_r, "Recursion {depth}");
                assert_eq!(live.frames, reference.frames);
                assert!(left
                    .iter()
                    .chain(&right)
                    .all(|sample| sample.is_finite() && sample.abs() <= 1.));
                block += 1;
            }
            assert!((live.wet_normalization - live.target_normalization).abs() < 1e-10);
            assert_eq!(live.metrics[2], if depth == 0. { 0. } else { 64. });
            assert_eq!(live.metrics[4], capacity as f64);
            assert_eq!(live.metrics[16], revision as f64);
            assert_eq!(live.metrics[14], live.frames as f64 / 8000.);
        }
        let metrics = live.metrics;
        for invalid in [-0.001, 1.0001, f64::NAN, f64::INFINITY] {
            assert!(live.set_depth(invalid).is_err());
            assert_eq!(live.live_depth, Some(1.));
            assert_eq!(live.metrics, metrics);
        }
    }
    #[test]
    fn a_silent_compiled_scene_resumes_recursion_without_a_new_pool_or_capacity_probe() {
        let parameters = model::Parameters {
            generations: 12,
            interval_ms: 2.,
            depth: 0.,
            ..model::Parameters::default()
        };
        let compiled = compile(&serde_json::to_vec(&parameters).unwrap(), 8000).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&compiled.json).unwrap();
        assert_eq!(json["parameters"]["depth"], 0.);
        assert_eq!(json["eligibleVoices"], 0);
        assert_eq!(json["structuralEligibleVoices"], 8190);
        assert!(json["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .skip(1)
            .all(|node| node["gain"] == 0. && node["priority"].is_number()));
        let mut renderer = Renderer::new(8000, 1).unwrap();
        renderer.install(&compiled.pool).unwrap();
        for _ in 0..100 {
            renderer.observe(0.00001, BLOCK, false);
        }
        assert_eq!(renderer.engine.target_voice_count(), 0);
        assert_eq!(renderer.adaptive.measured_limit(), 0);
        renderer.set_depth(0.72).unwrap();
        assert_eq!(renderer.available, 8190);
        assert_eq!(renderer.engine.target_voice_count(), 48);
        renderer.set_depth(0.).unwrap();
        assert_eq!(renderer.engine.target_voice_count(), 0);
        assert!(renderer.set_depth(f64::NAN).is_err());
        renderer.set_depth(1.).unwrap();
        assert_eq!(renderer.engine.target_voice_count(), 48);
        assert!(renderer.set_depth(1.0001).is_err());
    }
    #[test]
    fn staged_scene_edits_preserve_sample_exact_live_flow_and_current_depth_and_mix() {
        let mut parameters = model::Parameters {
            generations: 12,
            interval_ms: 2.,
            ..model::Parameters::default()
        };
        let first = compile(&serde_json::to_vec(&parameters).unwrap(), 8000).unwrap();
        let settings = Performance {
            automatic: false,
            voice_ceiling: 64,
            ..Performance::default()
        };
        let mut staged = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        staged.set_performance(settings).unwrap();
        reference.set_performance(settings).unwrap();
        staged.begin_install(&first.pool).unwrap();
        while !staged.step_install(1024).unwrap() {}
        reference.install(&first.pool).unwrap();
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        let mut block = 0;
        for edit in 0..6 {
            parameters.angle = 28. + edit as f64 * 11.;
            parameters.pitch_scale = 0.3 + edit as f64 * 0.24;
            parameters.mutation = edit as f64 * 0.12;
            parameters.time_ratio = 0.68 + edit as f64 * 0.055;
            parameters.pruning_bias = edit as f64 * 0.18;
            parameters.generations = [12, 14, 10, 13, 12, 14][edit];
            parameters.l_system_type = if edit == 4 { "coral" } else { "pythagorean" }.into();
            let compiled = compile(&serde_json::to_vec(&parameters).unwrap(), 8000).unwrap();
            staged.begin_install(&compiled.pool).unwrap();
            let depth = 0.38 + edit as f64 * 0.06;
            for renderer in [&mut staged, &mut reference] {
                renderer.set_depth(depth).unwrap();
                renderer
                    .set_performance(Performance {
                        wet: 0.4 + edit as f32 * 0.08,
                        ..settings
                    })
                    .unwrap();
            }
            loop {
                let input = signal(block * BLOCK);
                staged.process(&input, None, &mut left, &mut right);
                reference.process(&input, None, &mut reference_l, &mut reference_r);
                assert_eq!(
                    left, reference_l,
                    "old scene stays live during preparation {edit}"
                );
                assert_eq!(right, reference_r);
                block += 1;
                ALLOCATIONS.with(|n| n.set(0));
                TRACK.with(|enabled| enabled.set(true));
                let committed = staged.step_install(1024).unwrap();
                TRACK.with(|enabled| enabled.set(false));
                assert_eq!(
                    ALLOCATIONS.with(|n| n.get()),
                    0,
                    "staging steps allocate nothing"
                );
                if committed {
                    break;
                }
            }
            reference.install(&compiled.pool).unwrap();
            reference.set_depth(depth).unwrap();
            assert_eq!(staged.live_depth, Some(depth));
            assert_eq!(staged.performance.wet, reference.performance.wet);
            for _ in 0..32 {
                let input = signal(block * BLOCK);
                staged.process(&input, None, &mut left, &mut right);
                reference.process(&input, None, &mut reference_l, &mut reference_r);
                assert_eq!(
                    left, reference_l,
                    "new scene matches complete install {edit}"
                );
                assert_eq!(right, reference_r);
                block += 1;
            }
        }
    }
    #[test]
    fn rejected_or_aborted_staging_does_not_change_the_live_scene_or_clock() {
        let first = scene(7);
        let second = scene(12);
        let mut staged = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        staged.install(&first.pool).unwrap();
        reference.install(&first.pool).unwrap();
        let mut malformed = second.pool.clone();
        let base = HEADER + 1000 * RECORD;
        malformed[base..base + 8].copy_from_slice(&f64::NAN.to_le_bytes());
        staged.begin_install(&malformed).unwrap();
        assert!(!staged.step_install(512).unwrap());
        assert!(staged.step_install(512).is_err());
        assert!(staged.pending_install.is_none());
        staged.begin_install(&second.pool).unwrap();
        assert!(!staged.step_install(512).unwrap());
        unsafe {
            lsd_install_abort(&mut staged);
        }
        assert_eq!(staged.requested, reference.requested);
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        for block in 0..32 {
            let input = signal(block * BLOCK);
            staged.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            assert_eq!(left, reference_l);
            assert_eq!(right, reference_r);
            assert_eq!(staged.frames, reference.frames);
        }
    }
    #[test]
    fn staged_legacy_pool_controls_keep_the_original_signal_and_gain_contract() {
        let mut first = scene(6);
        first.pool[4..8].copy_from_slice(&1u32.to_le_bytes());
        let mut staged = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        let settings = Performance {
            automatic: false,
            ..Performance::default()
        };
        staged.set_performance(settings).unwrap();
        reference.set_performance(settings).unwrap();
        staged.begin_install(&first.pool).unwrap();
        while !staged.step_install(19).unwrap() {}
        reference.install(&first.pool).unwrap();
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        assert!(
            staged.set_depth(0.8).is_err(),
            "legacy pools retain their authored raw gains"
        );
        for block in 0..40 {
            let input = signal(block * BLOCK);
            staged.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            assert_eq!(left, reference_l);
            assert_eq!(right, reference_r);
        }
    }
    #[test]
    fn incremental_raw_upload_reads_only_initialized_batches_and_keeps_caller_cleanup() {
        let compiled = scene(7);
        let mut uploaded = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        reference.install(&compiled.pool).unwrap();
        let pointer = lsd_alloc_uninitialized(compiled.pool.len());
        assert!(!pointer.is_null());
        unsafe {
            std::ptr::copy_nonoverlapping(compiled.pool.as_ptr(), pointer, HEADER);
            assert_eq!(
                lsd_install_begin(&mut uploaded, pointer, compiled.pool.len()),
                1
            );
            assert_eq!(lsd_install_step(&mut uploaded, 0), 1);
            assert_eq!(uploaded.pending_install.as_ref().unwrap().next, 0);
            let count = read_u32(&compiled.pool, 8) as usize;
            let mut copied = 0;
            while copied < count {
                let batch = (count - copied).min(19);
                let offset = HEADER + copied * RECORD;
                std::ptr::copy_nonoverlapping(
                    compiled.pool.as_ptr().add(offset),
                    pointer.add(offset),
                    batch * RECORD,
                );
                copied += batch;
                assert_eq!(
                    lsd_install_step(&mut uploaded, batch),
                    if copied == count { 2 } else { 1 }
                );
            }
            lsd_free(pointer, compiled.pool.len());
        }
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        for block in 0..32 {
            let input = signal(block * BLOCK);
            uploaded.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            assert_eq!(left, reference_l);
            assert_eq!(right, reference_r);
        }
        unsafe {
            let pointer = lsd_alloc_uninitialized(compiled.pool.len());
            std::ptr::copy_nonoverlapping(compiled.pool.as_ptr(), pointer, HEADER);
            assert_eq!(
                lsd_install_begin(&mut uploaded, pointer, compiled.pool.len()),
                1
            );
            lsd_install_abort(&mut uploaded);
            lsd_free(pointer, compiled.pool.len());
            assert!(uploaded.pending_install.is_none());
            let short = lsd_alloc_uninitialized(7);
            std::ptr::write_bytes(short, 0, 7);
            assert_eq!(lsd_install_begin(&mut uploaded, short, 7), 0);
            lsd_free(short, 7);
            let truncated = lsd_alloc_uninitialized(HEADER);
            std::ptr::copy_nonoverlapping(compiled.pool.as_ptr(), truncated, HEADER);
            assert_eq!(lsd_install_begin(&mut uploaded, truncated, HEADER), 0);
            lsd_free(truncated, HEADER);
        }
        assert_eq!(uploaded.frames, reference.frames);
        assert_eq!(uploaded.requested, reference.requested);
    }
    #[test]
    fn retired_numeric_storage_is_collected_in_bounded_allocation_free_steps() {
        let first = scene(6);
        let second = scene(8);
        let third = scene(10);
        let fourth = scene(11);
        let mut renderer = Renderer::new(8000, 1).unwrap();
        let mut reference = Renderer::new(8000, 1).unwrap();
        let settings = Performance {
            automatic: false,
            voice_ceiling: 64,
            ..Performance::default()
        };
        renderer.set_performance(settings).unwrap();
        reference.set_performance(settings).unwrap();
        renderer.install(&first.pool).unwrap();
        reference.install(&first.pool).unwrap();
        renderer.begin_install(&second.pool).unwrap();
        while !renderer.step_install(128).unwrap() {}
        reference.install(&second.pool).unwrap();
        assert_eq!(renderer.retired_slots, 126);
        ALLOCATIONS.with(|n| n.set(0));
        FREES.with(|n| n.set(0));
        TRACK.with(|n| n.set(true));
        assert_eq!(renderer.collect_retired(0), 126);
        TRACK.with(|n| n.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert_eq!(FREES.with(|n| n.get()), 0);
        ALLOCATIONS.with(|n| n.set(0));
        FREES.with(|n| n.set(0));
        TRACK.with(|n| n.set(true));
        assert_eq!(renderer.collect_retired(7), 119);
        TRACK.with(|n| n.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert_eq!(
            FREES.with(|n| n.get()),
            7,
            "only seven retired branch keys were freed"
        );
        renderer.begin_install(&third.pool).unwrap();
        while !renderer.step_install(128).unwrap() {}
        reference.install(&third.pool).unwrap();
        assert_eq!(renderer.retired_slots, 119 + 510);
        assert_eq!(
            renderer.retired_pools.len(),
            2,
            "rapid growth retains each old allocation until collected"
        );
        renderer.begin_install(&fourth.pool).unwrap();
        assert!(!renderer.step_install(128).unwrap());
        unsafe {
            lsd_install_abort(&mut renderer);
        }
        assert_eq!(
            renderer.retired_slots, 629,
            "abort never discards current or queued old storage"
        );
        let mut left = [0.; BLOCK];
        let mut right = [0.; BLOCK];
        let mut reference_l = [0.; BLOCK];
        let mut reference_r = [0.; BLOCK];
        let mut blocks = 0;
        while renderer.retired_slots > 0 {
            let before = renderer.retired_slots;
            ALLOCATIONS.with(|n| n.set(0));
            FREES.with(|n| n.set(0));
            TRACK.with(|n| n.set(true));
            let remaining = renderer.collect_retired(7);
            TRACK.with(|n| n.set(false));
            assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
            assert!(
                FREES.with(|n| n.get()) <= 11,
                "seven keys plus empty numeric vectors at most"
            );
            assert_eq!(before - remaining, before.min(7));
            let input = signal(blocks * BLOCK);
            renderer.process(&input, None, &mut left, &mut right);
            reference.process(&input, None, &mut reference_l, &mut reference_r);
            assert_eq!(left, reference_l);
            assert_eq!(right, reference_r);
            blocks += 1;
        }
        assert!(
            renderer.retired_pools.is_empty(),
            "all retired numeric buffers are released"
        );
        assert_eq!(renderer.frames, reference.frames);
        renderer.begin_install(&fourth.pool).unwrap();
        while !renderer.step_install(128).unwrap() {}
        assert!(renderer.retired_slots > 0);
        ALLOCATIONS.with(|n| n.set(0));
        FREES.with(|n| n.set(0));
        TRACK.with(|n| n.set(true));
        drop(renderer);
        TRACK.with(|n| n.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert!(
            FREES.with(|n| n.get()) > 0,
            "dispose releases current and pending retired allocations"
        );
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
