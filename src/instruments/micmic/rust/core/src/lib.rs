//! L-system Delay's raw-history, two-grain renderer. The browser topology exporter
//! owns grammar, pruning and gain allocation; this engine owns only sample DSP.
//! Voice installation is a control-thread operation. Rendering and silence do
//! not allocate, lock, perform I/O, or look up string keys.
use serde::Deserialize;
use std::collections::HashMap;

/// Offline scene default, not a processing or allocation ceiling.
pub const DEFAULT_VOICE_CAPACITY: usize = 16_384;
/// Meter the connected preview only; this never limits audio voice admission.
pub const TAP_ACTIVITY_CAPACITY: usize = 2048;
const WINDOW_SIZE: usize = 65_536;
const LIVE_DELAY_SLEW_SAMPLES: f64 = 4.;

fn reserved<T>(count: usize) -> Result<Vec<T>, String> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(count)
        .map_err(|error| format!("Cannot allocate delay storage: {error}"))?;
    Ok(values)
}

fn filled<T: Clone>(count: usize, value: T) -> Result<Vec<T>, String> {
    let mut values = reserved(count)?;
    values.resize(count, value);
    Ok(values)
}

/// Numeric control-thread preparation that can be copied into a persistent
/// sample-thread voice pool without owning or destroying any heap allocation.
#[derive(Clone, Copy, Debug, Default)]
pub struct PoolTarget {
    pub delay: f64,
    pub rate: f64,
    pub gain: f64,
    pub pan: f64,
}

fn clamp(value: f64, low: f64, high: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(low, high)
    } else {
        fallback
    }
}
/// Control-thread seed preparation matching the original JS branch key hash.
pub fn phase_seed(key: &str) -> u32 {
    let mut hash = 2_166_136_261u32;
    // Match JS charCodeAt (UTF-16), including supplementary Unicode characters.
    for character in key.encode_utf16() {
        hash = (hash ^ u32::from(character)).wrapping_mul(16_777_619);
    }
    hash
}
fn phase_hash(key: &str) -> f64 {
    f64::from(phase_seed(key)) / f64::from(u32::MAX)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceSpec {
    pub key: String,
    pub delay: f64,
    pub rate: f64,
    pub gain: f64,
    pub pan: f64,
}
impl Default for VoiceSpec {
    fn default() -> Self {
        Self {
            key: String::new(),
            delay: 0.2,
            rate: 1.,
            gain: 0.,
            pan: 0.,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceEvent {
    pub time: f64,
    pub voices: Vec<VoiceSpec>,
    pub limit: Option<usize>,
}
impl Default for VoiceEvent {
    fn default() -> Self {
        Self {
            time: 0.,
            voices: Vec::new(),
            limit: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Scene {
    pub sample_rate: u32,
    pub history_seconds: f64,
    pub channels: usize,
    pub max_voices: usize,
    pub events: Vec<VoiceEvent>,
}
impl Default for Scene {
    fn default() -> Self {
        Self {
            sample_rate: 48_000,
            history_seconds: 40.,
            channels: 1,
            max_voices: DEFAULT_VOICE_CAPACITY,
            events: Vec::new(),
        }
    }
}
impl Scene {
    pub fn validate(&self) -> Result<(), String> {
        if !(8_000..=192_000).contains(&self.sample_rate)
            || !self.history_seconds.is_finite()
            || !(4.0..=64.0).contains(&self.history_seconds)
            || !(1..=2).contains(&self.channels)
            || self.max_voices == 0
        {
            return Err(
                "Scene needs 8–192 kHz, 4–64 s history, 1–2 channels, and positive voice capacity"
                    .into(),
            );
        }
        let mut previous_time = 0.;
        for event in &self.events {
            if !event.time.is_finite()
                || event.time < previous_time
                || event.time > 3600.
                || event.voices.len() > self.max_voices
                || event.limit.is_some_and(|limit| limit > self.max_voices)
            {
                return Err(
                    "Scene events must be ordered, bounded, and fit the voice capacity".into(),
                );
            }
            let mut keys = std::collections::HashSet::new();
            for voice in &event.voices {
                if voice.key.len() > 4096 || !keys.insert(&voice.key) {
                    return Err("Scene voice keys must be unique and at most 4096 bytes".into());
                }
                if ![voice.rate, voice.delay, voice.gain, voice.pan]
                    .iter()
                    .all(|x| x.is_finite())
                {
                    return Err("Scene voice parameters must be finite".into());
                }
            }
            previous_time = event.time;
        }
        Ok(())
    }
}

struct Voice {
    target: VoiceSpec,
    raw_base_delay: f64,
    live_delay: f64,
    live_delay_step: f64,
    live_following: bool,
    desired_gain: f64,
    pool_rank: usize,
    pool_group: u8,
    gain: f64,
    rate: f64,
    pitch_mix: f64,
    pan: f64,
    pan_left: f64,
    pan_right: f64,
    phase: f64,
    phase_seed: u32,
    seed_epoch: u64,
    growth_epoch: u64,
    delays: [f64; 2],
    from: usize,
    to: usize,
    fade: f64,
    releasing: bool,
    inactive: bool,
}
impl Voice {
    fn new(target: VoiceSpec) -> Self {
        Self {
            raw_base_delay: target.delay,
            live_delay: target.delay,
            live_delay_step: 0.,
            live_following: false,
            desired_gain: target.gain,
            pool_rank: usize::MAX,
            pool_group: 0,
            gain: 0.,
            rate: target.rate,
            pitch_mix: f64::from((target.rate - 1.).abs() >= 0.0005),
            pan: target.pan,
            pan_left: ((1. - target.pan) * 0.5).sqrt(),
            pan_right: ((1. + target.pan) * 0.5).sqrt(),
            phase: phase_hash(&target.key),
            phase_seed: phase_seed(&target.key),
            seed_epoch: 0,
            growth_epoch: 0,
            delays: [target.delay; 2],
            from: 0,
            to: 0,
            fade: 1.,
            releasing: false,
            inactive: false,
            target,
        }
    }

    fn numeric_copy(&self) -> Self {
        Self {
            target: VoiceSpec {
                key: String::new(),
                delay: self.target.delay,
                rate: self.target.rate,
                gain: self.target.gain,
                pan: self.target.pan,
            },
            raw_base_delay: self.raw_base_delay,
            live_delay: self.live_delay,
            live_delay_step: self.live_delay_step,
            live_following: self.live_following,
            desired_gain: self.desired_gain,
            pool_rank: self.pool_rank,
            pool_group: self.pool_group,
            gain: self.gain,
            rate: self.rate,
            pitch_mix: self.pitch_mix,
            pan: self.pan,
            pan_left: self.pan_left,
            pan_right: self.pan_right,
            phase: self.phase,
            phase_seed: self.phase_seed,
            seed_epoch: self.seed_epoch,
            growth_epoch: self.growth_epoch,
            delays: self.delays,
            from: self.from,
            to: self.to,
            fade: self.fade,
            releasing: self.releasing,
            inactive: self.inactive,
        }
    }
}

fn pool_gain(voice: &Voice, groups: Option<&[f64; 256]>) -> f64 {
    if voice.pool_rank != usize::MAX && voice.pool_group != 0 {
        if let Some(groups) = groups {
            return groups[usize::from(voice.pool_group)];
        }
    }
    voice.desired_gain
}

#[derive(Clone, Copy)]
pub struct PoolControl {
    target: PoolTarget,
    rank: usize,
    seed: u32,
    seed_epoch: u64,
    group: u8,
}

/// Numeric preparation can be filled in bounded batches while the previous
/// scene renders. No branch String, history buffer, or audible state is owned.
pub struct PreparedPoolControls {
    records: Vec<PoolControl>,
    rank_to_slot: Vec<usize>,
    groups: [usize; 256],
}

impl PreparedPoolControls {
    pub fn new(count: usize) -> Result<Self, String> {
        let mut controls = Self {
            records: Vec::new(),
            rank_to_slot: Vec::new(),
            groups: [0; 256],
        };
        controls.prepare(count)?;
        Ok(controls)
    }

    /// Reuse the previous control buffers at their retained high-water size.
    /// Only genuinely larger scenes reserve more memory; ordinary live edits
    /// clear numeric records without freeing their allocations.
    pub fn prepare(&mut self, count: usize) -> Result<(), String> {
        if self.records.capacity() < count {
            self.records
                .try_reserve_exact(count - self.records.len())
                .map_err(|error| format!("Cannot allocate delay controls: {error}"))?;
        }
        if self.rank_to_slot.capacity() < count {
            self.rank_to_slot
                .try_reserve_exact(count - self.rank_to_slot.len())
                .map_err(|error| format!("Cannot allocate delay ranks: {error}"))?;
        }
        self.records.clear();
        let retained = self.rank_to_slot.len().min(count);
        self.rank_to_slot[..retained].fill(usize::MAX);
        self.rank_to_slot.resize(count, usize::MAX);
        self.groups.fill(0);
        Ok(())
    }

    pub fn push(&mut self, target: PoolTarget, rank: usize, seed: u32, seed_epoch: u64, group: u8) {
        let index = self.records.len();
        let rank = if rank < self.rank_to_slot.len() && self.rank_to_slot[rank] == usize::MAX {
            self.rank_to_slot[rank] = index;
            self.groups[usize::from(group)] += 1;
            rank
        } else {
            usize::MAX
        };
        self.records.push(PoolControl {
            target,
            rank,
            seed,
            seed_epoch,
            group,
        });
    }

    pub fn group_counts(&self) -> &[usize; 256] {
        &self.groups
    }

    pub fn allocated_bytes(&self) -> usize {
        self.records.capacity() * std::mem::size_of::<PoolControl>()
            + self.rank_to_slot.capacity() * std::mem::size_of::<usize>()
    }
}

fn control_gain(control: &PoolControl, groups: Option<&[f64; 256]>) -> f64 {
    if control.rank != usize::MAX && control.group != 0 {
        if let Some(groups) = groups {
            return groups[usize::from(control.group)];
        }
    }
    control.target.gain
}

fn adopt_pool_control(voice: &mut Voice, control: Option<&PoolControl>, rate: f64, maximum: f64) {
    let Some(control) = control else {
        voice.desired_gain = 0.;
        voice.pool_rank = usize::MAX;
        voice.pool_group = 0;
        return;
    };
    if voice.phase_seed != control.seed || voice.seed_epoch != control.seed_epoch {
        voice.phase_seed = control.seed;
        voice.seed_epoch = control.seed_epoch;
        voice.phase = f64::from(control.seed) / f64::from(u32::MAX);
    }
    let delay = clamp(control.target.delay, 0.000005, maximum, 0.2);
    voice.raw_base_delay = if control.target.delay.is_finite() {
        control.target.delay.max(0.)
    } else {
        0.2
    };
    voice.target.delay = delay;
    voice.target.rate = clamp(control.target.rate, 0.125, 8., 1.);
    voice.target.pan = clamp(control.target.pan, -1., 1., 0.);
    voice.desired_gain = clamp(control.target.gain, 0., 1., 0.);
    voice.pool_rank = control.rank;
    voice.pool_group = control.group;
    if voice.inactive {
        voice.rate = voice.target.rate;
        voice.pitch_mix = f64::from((voice.rate - 1.).abs() >= 0.0005);
        voice.pan = voice.target.pan;
        voice.pan_left = ((1. - voice.pan) * 0.5).sqrt();
        voice.pan_right = ((1. + voice.pan) * 0.5).sqrt();
        voice.delays = [delay; 2];
        voice.from = 0;
        voice.to = 0;
        voice.fade = 1.;
        voice.live_delay = delay;
        voice.live_following = false;
    } else if voice.fade == 0. {
        if (delay - voice.delays[voice.from]).abs() <= 1. / rate {
            voice.to = voice.from;
            voice.fade = 1.;
        } else {
            voice.delays[voice.to] = delay;
        }
    } else if voice.fade < 1. && (delay - voice.delays[voice.from]).abs() <= 1. / rate {
        std::mem::swap(&mut voice.from, &mut voice.to);
        voice.fade = 1. - voice.fade;
    }
}

pub struct Engine {
    sample_rate: f64,
    history: Vec<f32>,
    history_right: Option<Vec<f32>>,
    window: Vec<f64>,
    voices: Vec<Voice>,
    active_indices: Vec<usize>,
    rank_to_slot: Vec<usize>,
    admission_scratch: Vec<usize>,
    pool_admission_dirty: bool,
    #[cfg(test)]
    last_admission_visits: usize,
    #[cfg(test)]
    last_meter_evaluations: usize,
    pool_group_counts: [usize; 256],
    pool_group_gains: Option<[f64; 256]>,
    pool_controls: Option<PreparedPoolControls>,
    growth_tracking: bool,
    #[cfg(test)]
    growth_tracking_passes: usize,
    growth_epoch: u64,
    growth_dirty_indices: Vec<usize>,
    activity_energy: [f64; 256],
    activity: [f32; 256],
    activity_samples: usize,
    activity_phase: usize,
    tap_energy: [f64; TAP_ACTIVITY_CAPACITY],
    tap_activity: [f32; TAP_ACTIVITY_CAPACITY],
    tap_remap: [f32; TAP_ACTIVITY_CAPACITY],
    tap_voice_indices: [usize; TAP_ACTIVITY_CAPACITY],
    tap_count: usize,
    max_voices: usize,
    runtime_limit: usize,
    target_count: usize,
    pool_mode: bool,
    write: usize,
    recorded: usize,
    grain: f64,
    grain_step: f64,
    delay_fade_step: f64,
    gain_smoothing: f64,
    parameter_smoothing: f64,
    live_delay_smoothing: f64,
    time_fold_scale: f64,
    target_time_fold_scale: f64,
    live_time_fold: bool,
    pitch_offset: f64,
    pitch_ratio: f64,
}

/// Allocate on the control thread; swap into the callback and return the old
/// storage for control-thread reclamation. Stable-prefix voices retain state.
pub struct PreparedPool {
    voices: Vec<Voice>,
    active_indices: Vec<usize>,
    rank_to_slot: Vec<usize>,
    admission_scratch: Vec<usize>,
}

impl PreparedPool {
    /// Reserve numeric browser pool storage without constructing branch keys.
    /// Fill with prepare_numeric_growth_until, then commit_numeric_growth.
    pub fn numeric(capacity: usize) -> Result<Self, String> {
        Ok(Self {
            voices: reserved(capacity)?,
            active_indices: reserved(capacity)?,
            rank_to_slot: Vec::new(),
            admission_scratch: reserved(capacity)?,
        })
    }

    pub fn new(keys: &[String]) -> Result<Self, String> {
        if keys.is_empty() {
            return Err("A voice pool needs at least one slot".into());
        }
        let mut unique = std::collections::HashSet::new();
        unique
            .try_reserve(keys.len())
            .map_err(|error| error.to_string())?;
        let mut voices = reserved(keys.len())?;
        for key in keys {
            if key.len() > 4096 || !unique.insert(key) {
                return Err("Voice pool keys must be unique and at most 4096 bytes".into());
            }
            let mut owned_key = String::new();
            owned_key
                .try_reserve_exact(key.len())
                .map_err(|error| error.to_string())?;
            owned_key.push_str(key);
            let mut voice = Voice::new(VoiceSpec {
                key: owned_key,
                ..VoiceSpec::default()
            });
            voice.inactive = true;
            voices.push(voice);
        }
        Ok(Self {
            voices,
            active_indices: reserved(keys.len())?,
            rank_to_slot: filled(keys.len(), usize::MAX)?,
            admission_scratch: reserved(keys.len())?,
        })
    }
    pub fn capacity(&self) -> usize {
        self.voices.len()
    }

    /// Reclaim old numeric slots in a bounded control step. The browser calls
    /// this after rendering; native hosts keep their control-thread disposal.
    /// No current voice or recording buffer belongs to this retired storage.
    pub fn retire_numeric_slots(&mut self, maximum: usize) -> usize {
        let count = maximum.min(self.voices.len());
        self.voices.truncate(self.voices.len() - count);
        count
    }
}

impl Engine {
    pub fn new(
        sample_rate: u32,
        history_seconds: f64,
        max_voices: usize,
        channels: usize,
    ) -> Result<Self, String> {
        Scene {
            sample_rate,
            history_seconds,
            max_voices,
            channels,
            events: Vec::new(),
        }
        .validate()?;
        let rate = f64::from(sample_rate);
        let length = (history_seconds * rate).ceil() as usize;
        let mut window = reserved(WINDOW_SIZE + 1)?;
        for index in 0..=WINDOW_SIZE {
            window.push(
                (std::f64::consts::PI * index as f64 / WINDOW_SIZE as f64)
                    .sin()
                    .powi(2),
            );
        }
        let grain = (rate * 0.11).round().max(64.);
        Ok(Self {
            sample_rate: rate,
            history: filled(length, 0.)?,
            history_right: if channels == 2 {
                Some(filled(length, 0.)?)
            } else {
                None
            },
            window,
            voices: reserved(max_voices)?,
            active_indices: reserved(max_voices)?,
            rank_to_slot: filled(max_voices, usize::MAX)?,
            admission_scratch: reserved(max_voices)?,
            pool_admission_dirty: true,
            #[cfg(test)]
            last_admission_visits: 0,
            #[cfg(test)]
            last_meter_evaluations: 0,
            pool_group_counts: [0; 256],
            pool_group_gains: None,
            pool_controls: None,
            growth_tracking: false,
            #[cfg(test)]
            growth_tracking_passes: 0,
            growth_epoch: 0,
            growth_dirty_indices: Vec::new(),
            activity_energy: [0.; 256],
            activity: [0.; 256],
            activity_samples: 0,
            activity_phase: 0,
            tap_energy: [0.; TAP_ACTIVITY_CAPACITY],
            tap_activity: [0.; TAP_ACTIVITY_CAPACITY],
            tap_remap: [0.; TAP_ACTIVITY_CAPACITY],
            tap_voice_indices: [usize::MAX; TAP_ACTIVITY_CAPACITY],
            tap_count: 0,
            max_voices,
            runtime_limit: max_voices,
            target_count: 0,
            pool_mode: false,
            write: 0,
            recorded: 0,
            grain,
            grain_step: 1. / grain,
            delay_fade_step: 1. / (rate * 0.065),
            gain_smoothing: 1. - (-1. / (rate * 0.015)).exp(),
            parameter_smoothing: 1. - (-1. / (rate * 0.035)).exp(),
            live_delay_smoothing: 1. - (-1. / (rate * 0.008)).exp(),
            time_fold_scale: 1.,
            target_time_fold_scale: 1.,
            live_time_fold: false,
            pitch_offset: 0.,
            pitch_ratio: 1.,
        })
    }

    /// O(1) live timing control. Immutable pool delays remain in their compiled
    /// base units; admitted and future voices derive their own scaled target.
    /// A 35 ms follower and an 8 ms read-velocity follower produce a tape-like
    /// pitch glide without allocating or adding a delay lane during a gesture.
    pub fn set_time_fold_scale(&mut self, scale: f64) -> Result<(), String> {
        if !scale.is_finite() || scale <= 0. {
            return Err("Time fold scale must be positive and finite".into());
        }
        self.target_time_fold_scale = scale;
        self.live_time_fold = true;
        Ok(())
    }

    /// Nominal smoothed scale. Individual readable heads may trail this value
    /// during extreme sweeps or while waiting for sufficient recorded history.
    pub fn time_fold_scale(&self) -> f64 {
        self.time_fold_scale
    }

    /// O(1) live transposition; the existing per-voice rate follower smooths
    /// base-rate times this coefficient, retaining phase, history and bounds.
    pub fn set_pitch_offset(&mut self, semitones: f64) -> Result<(), String> {
        if !semitones.is_finite() || !(-24.0..=24.0).contains(&semitones) {
            return Err("Pitch offset must be finite and between -24 and 24 semitones".into());
        }
        self.pitch_offset = semitones;
        self.pitch_ratio = 2f64.powf(semitones / 12.);
        Ok(())
    }

    pub fn pitch_offset(&self) -> f64 {
        self.pitch_offset
    }

    /// Call atomically before adopting a new base pool. Fixed and moving read
    /// heads stay in physical seconds; only their nominal control units change.
    /// Pool adoption then restores scale 1 and ordinary preset crossfades.
    pub fn rebase_time_fold_scale(&mut self, base_ratio: f64) -> Result<(), String> {
        let current = self.time_fold_scale * base_ratio;
        let target = self.target_time_fold_scale * base_ratio;
        if !base_ratio.is_finite()
            || base_ratio <= 0.
            || !current.is_finite()
            || !target.is_finite()
            || current <= 0.
            || target <= 0.
        {
            return Err("Time fold base ratio must retain positive finite scales".into());
        }
        self.time_fold_scale = current;
        self.target_time_fold_scale = target;
        Ok(())
    }

    #[inline(always)]
    fn advance_time_fold_scale(&mut self) -> f64 {
        let delta = self.target_time_fold_scale - self.time_fold_scale;
        if delta != 0. {
            self.time_fold_scale += delta * self.parameter_smoothing;
            if (self.target_time_fold_scale - self.time_fold_scale).abs()
                <= self.target_time_fold_scale.max(1.) * 1e-12
            {
                self.time_fold_scale = self.target_time_fold_scale;
            }
        }
        self.time_fold_scale
    }

    /// Control-thread only: stable keys preserve phase, rate and raw recording.
    pub fn set_voices(&mut self, specs: &[VoiceSpec], limit: usize) {
        self.pool_mode = false;
        self.pool_group_counts.fill(0);
        self.runtime_limit = limit.min(self.max_voices);
        let ordered_old: Vec<String> = self
            .voices
            .iter()
            .filter(|voice| !voice.inactive)
            .map(|voice| voice.target.key.clone())
            .collect();
        let mut old: HashMap<String, Voice> = self
            .voices
            .drain(..)
            .filter(|voice| !voice.inactive)
            .map(|voice| (voice.target.key.clone(), voice))
            .collect();
        let old_count = old.len();
        let count = specs.len().min(self.runtime_limit);
        let nested_shrink = count <= self.target_count
            && specs
                .iter()
                .take(count)
                .all(|spec| old.contains_key(&spec.key));
        let allowance = if nested_shrink {
            old_count
        } else {
            self.runtime_limit.min(256)
        };
        let maximum_delay = (self.history.len() - 3) as f64 / self.sample_rate;
        for spec in specs.iter().take(count) {
            let mut target = spec.clone();
            target.delay = clamp(target.delay, 0.000005, maximum_delay, 0.2);
            target.rate = clamp(target.rate, 0.125, 8., 1.);
            target.gain = clamp(target.gain, 0., 1., 0.);
            target.pan = clamp(target.pan, -1., 1., 0.);
            let voice = if let Some(mut voice) = old.remove(&target.key) {
                let current = if voice.fade >= 0.5 {
                    voice.to
                } else {
                    voice.from
                };
                if (target.delay - voice.delays[current]).abs() > 1. / self.sample_rate {
                    voice.delays[1 - current] = target.delay;
                    voice.from = current;
                    voice.to = 1 - current;
                    voice.fade = 0.;
                }
                voice.target = target;
                voice.releasing = false;
                voice.inactive = false;
                voice
            } else {
                Voice::new(target)
            };
            self.voices.push(voice);
        }
        let total_limit = self
            .max_voices
            .min(self.runtime_limit.saturating_add(allowance));
        for key in ordered_old {
            if self.voices.len() >= total_limit {
                break;
            }
            if let Some(mut voice) = old.remove(&key) {
                voice.target.gain = 0.;
                voice.releasing = true;
                self.voices.push(voice);
            }
        }
        self.target_count = count;
        self.active_indices.clear();
        self.active_indices.extend(
            self.voices
                .iter()
                .enumerate()
                .filter_map(|(index, voice)| (!voice.inactive).then_some(index)),
        );
    }

    /// Startup/control-thread only. Reserve one stable phase and String for
    /// every possible branch. Later pool controls touch numeric state only.
    pub fn install_pool(&mut self, keys: &[String]) -> Result<(), String> {
        if keys.is_empty() || keys.len() > self.max_voices {
            return Err("Voice pool must contain 1..=engine capacity keys".into());
        }
        let prepared = PreparedPool::new(keys)?;
        self.voices = prepared.voices;
        self.active_indices = prepared.active_indices;
        self.rank_to_slot = prepared.rank_to_slot;
        self.admission_scratch = prepared.admission_scratch;
        self.pool_admission_dirty = true;
        self.pool_mode = true;
        self.runtime_limit = 0;
        self.target_count = 0;
        self.pool_group_counts.fill(0);
        self.pool_group_gains = None;
        self.pool_controls = None;
        Ok(())
    }

    /// Sample-thread safe: identify the actual grammar branch independently of
    /// its reserved storage key. Only a changed branch identity reseeds grains;
    /// ordinary controls and budget changes preserve their advancing phase.
    /// Numeric seeds are prepared on the control thread. History, gains, delay
    /// crossfades and allocation remain untouched. Omitted slots keep their seed.
    pub fn set_pool_phase_seeds(&mut self, seeds: &[u32]) {
        if !self.pool_mode {
            return;
        }
        for (voice, &seed) in self.voices.iter_mut().zip(seeds) {
            if voice.phase_seed != seed {
                voice.phase_seed = seed;
                voice.seed_epoch = voice.seed_epoch.wrapping_add(1);
                voice.phase = f64::from(seed) / f64::from(u32::MAX);
            }
        }
    }

    /// Callback-safe growth: no allocation, deallocation, or history reset.
    pub fn grow_pool(&mut self, prepared: &mut PreparedPool) {
        assert!(self.pool_mode && prepared.voices.len() >= self.voices.len());
        for (old, next) in self.voices.iter_mut().zip(&mut prepared.voices) {
            std::mem::swap(old, next);
        }
        prepared.active_indices.clear();
        prepared
            .active_indices
            .extend_from_slice(&self.active_indices);
        prepared.rank_to_slot[..self.rank_to_slot.len()].copy_from_slice(&self.rank_to_slot);
        prepared.rank_to_slot[self.rank_to_slot.len()..].fill(usize::MAX);
        prepared.admission_scratch.clear();
        std::mem::swap(&mut self.voices, &mut prepared.voices);
        std::mem::swap(&mut self.active_indices, &mut prepared.active_indices);
        std::mem::swap(&mut self.rank_to_slot, &mut prepared.rank_to_slot);
        std::mem::swap(&mut self.admission_scratch, &mut prepared.admission_scratch);
        self.max_voices = self.voices.len();
    }

    pub fn begin_numeric_growth(&mut self) -> Result<(), String> {
        if self.growth_dirty_indices.capacity() < self.voices.len() {
            self.growth_dirty_indices
                .try_reserve_exact(self.voices.len() - self.growth_dirty_indices.len())
                .map_err(|error| error.to_string())?;
        }
        self.growth_dirty_indices.clear();
        self.growth_epoch = self.growth_epoch.wrapping_add(1).max(1);
        self.growth_tracking = true;
        Ok(())
    }

    pub fn abort_numeric_growth(&mut self) {
        self.growth_tracking = false;
        self.growth_dirty_indices.clear();
    }

    pub fn prepare_numeric_growth_until(&self, prepared: &mut PreparedPool, count: usize) {
        while prepared.voices.len() < count {
            let index = prepared.voices.len();
            let voice = self.voices.get(index).map_or_else(
                || {
                    let mut voice = Voice::new(VoiceSpec::default());
                    voice.inactive = true;
                    voice
                },
                Voice::numeric_copy,
            );
            prepared.voices.push(voice);
        }
    }

    fn track_numeric_growth(&mut self) {
        if self.growth_tracking {
            #[cfg(test)]
            {
                self.growth_tracking_passes += 1;
            }
            for &index in &self.active_indices {
                let voice = &mut self.voices[index];
                if voice.growth_epoch != self.growth_epoch {
                    voice.growth_epoch = self.growth_epoch;
                    self.growth_dirty_indices.push(index);
                }
            }
        }
    }

    /// Numeric inactive state was copied in preparation batches. Refresh only
    /// slots that rendered during preparation, including tails that retired.
    pub fn commit_numeric_growth(&mut self, prepared: &mut PreparedPool) {
        for &index in self
            .growth_dirty_indices
            .iter()
            .chain(self.active_indices.iter())
        {
            prepared.voices[index] = self.voices[index].numeric_copy();
        }
        prepared
            .active_indices
            .extend_from_slice(&self.active_indices);
        std::mem::swap(&mut self.voices, &mut prepared.voices);
        std::mem::swap(&mut self.active_indices, &mut prepared.active_indices);
        std::mem::swap(&mut self.admission_scratch, &mut prepared.admission_scratch);
        self.max_voices = self.voices.len();
        self.abort_numeric_growth();
    }

    /// Sample-thread safe. Targets use the installed pool's stable numeric
    /// indices; omitted descendants release without losing phase or history.
    pub fn update_pool(&mut self, targets: &[PoolTarget], limit: usize) {
        self.update_pool_controls(targets, None, None, limit);
    }

    /// Sample-thread safe. Ranks are indexed by stable pool slot; rank < limit
    /// selects a branch. Missing ranks exclude a branch. Nonzero u8 groups divide
    /// raw gains by sqrt(selected positive-gain branches in that generation);
    /// group 0 leaves the gain unchanged. Budget changes reuse these controls.
    pub fn update_pool_ranked(
        &mut self,
        targets: &[PoolTarget],
        ranks: &[usize],
        groups: &[u8],
        limit: usize,
    ) {
        self.update_pool_controls(targets, Some(ranks), Some(groups), limit);
    }

    fn update_pool_controls(
        &mut self,
        targets: &[PoolTarget],
        ranks: Option<&[usize]>,
        groups: Option<&[u8]>,
        limit: usize,
    ) {
        if !self.pool_mode {
            return;
        }
        let maximum_delay = (self.history.len() - 3) as f64 / self.sample_rate;
        self.rank_to_slot.resize(self.voices.len(), usize::MAX);
        self.rank_to_slot.fill(usize::MAX);
        self.pool_group_gains = None;
        self.pool_controls = None;
        self.pool_admission_dirty = true;
        self.tap_remap.fill(0.);
        self.tap_voice_indices.fill(usize::MAX);
        self.tap_count = 0;
        let rank_to_slot = &mut self.rank_to_slot;
        let pool_length = self.voices.len();
        for (index, voice) in self.voices.iter_mut().enumerate() {
            let old_rank = voice.pool_rank;
            if let Some(target) = targets.get(index) {
                let delay = clamp(target.delay, 0.000005, maximum_delay, 0.2);
                voice.raw_base_delay = if target.delay.is_finite() {
                    target.delay.max(0.)
                } else {
                    0.2
                };
                voice.target.delay = delay;
                voice.target.rate = clamp(target.rate, 0.125, 8., 1.);
                voice.target.pan = clamp(target.pan, -1., 1., 0.);
                voice.desired_gain = clamp(target.gain, 0., 1., 0.);
                let rank = ranks.map_or(index, |ranks| {
                    ranks.get(index).copied().unwrap_or(usize::MAX)
                });
                // A malformed duplicate rank must not let two branches spend
                // one budget slot. The first slot reserves its rank even when
                // its desired gain is zero. This map also makes later budget
                // changes independent of unadmitted pool storage.
                voice.pool_rank = if rank < pool_length && rank_to_slot[rank] == usize::MAX {
                    rank_to_slot[rank] = index;
                    rank
                } else {
                    usize::MAX
                };
                voice.pool_group = groups
                    .and_then(|groups| groups.get(index))
                    .copied()
                    .unwrap_or(0);
                if voice.pool_rank < TAP_ACTIVITY_CAPACITY {
                    self.tap_count = self.tap_count.max(voice.pool_rank + 1);
                    self.tap_voice_indices[voice.pool_rank] = index;
                    if old_rank < TAP_ACTIVITY_CAPACITY {
                        self.tap_remap[voice.pool_rank] = self.tap_activity[old_rank];
                    }
                }
                if voice.inactive {
                    // An inaudible branch can adopt its prepared controls now.
                    // Subsequent budget growth then fades in the intended pitch
                    // and position, with its stable phase and raw history intact.
                    voice.rate = voice.target.rate;
                    voice.pitch_mix = f64::from((voice.rate - 1.).abs() >= 0.0005);
                    voice.pan = voice.target.pan;
                    voice.pan_left = ((1. - voice.pan) * 0.5).sqrt();
                    voice.pan_right = ((1. + voice.pan) * 0.5).sqrt();
                    voice.delays = [delay; 2];
                    voice.from = 0;
                    voice.to = 0;
                    voice.fade = 1.;
                    voice.live_delay = delay;
                    voice.live_following = false;
                } else if voice.fade == 0. {
                    // No destination sample has been heard yet: coalesce
                    // controls received before the next sample into one fade.
                    if (delay - voice.delays[voice.from]).abs() <= 1. / self.sample_rate {
                        voice.to = voice.from;
                        voice.fade = 1.;
                    } else {
                        voice.delays[voice.to] = delay;
                    }
                } else if voice.fade < 1.
                    && (delay - voice.delays[voice.from]).abs() <= 1. / self.sample_rate
                {
                    // Reverse a return to source with exactly the current
                    // equal-power weights. Other edits remain numeric pending
                    // targets until the audible two-head fade has completed.
                    std::mem::swap(&mut voice.from, &mut voice.to);
                    voice.fade = 1. - voice.fade;
                }
            } else {
                voice.desired_gain = 0.;
                voice.pool_rank = usize::MAX;
                voice.pool_group = 0;
            }
            if voice.inactive {
                voice.target.gain = 0.;
                voice.releasing = true;
            }
        }
        std::mem::swap(&mut self.tap_activity, &mut self.tap_remap);
        self.tap_energy.fill(0.);
        self.set_pool_limit(limit);
    }

    /// Preserve identity changes that occurred while a slot was inaudible.
    /// A grammar round trip must not recover an earlier branch's grain phase.
    pub fn prepared_seed_epoch(&self, index: usize, seed: u32) -> u64 {
        if let Some(control) = self
            .pool_controls
            .as_ref()
            .and_then(|controls| controls.records.get(index))
        {
            control
                .seed_epoch
                .wrapping_add(u64::from(control.seed != seed))
        } else if let Some(voice) = self.voices.get(index) {
            voice
                .seed_epoch
                .wrapping_add(u64::from(voice.phase_seed != seed))
        } else {
            0
        }
    }

    /// Atomically adopt prepared controls for audible voices only. Inactive
    /// storage takes the latest controls and stable seed upon future admission.
    /// Return the old numeric records and rank map for the next preparation;
    /// callers retain them instead of freeing storage in the audio callback.
    pub fn install_prepared_pool_controls(
        &mut self,
        prepared: PreparedPoolControls,
        limit: usize,
    ) -> PreparedPoolControls {
        self.install_prepared_pool_controls_live(prepared, limit, false)
    }

    /// A timing-only pool rebuild keeps a single moving readhead, including
    /// when history eligibility changes and the new base already is the live
    /// fold. Full presets retain their ordinary fixed-head transition.
    pub fn install_prepared_pool_controls_live(
        &mut self,
        mut prepared: PreparedPoolControls,
        limit: usize,
        live: bool,
    ) -> PreparedPoolControls {
        let maximum_delay = (self.history.len() - 3) as f64 / self.sample_rate;
        self.time_fold_scale = 1.;
        self.target_time_fold_scale = 1.;
        self.live_time_fold = live;
        std::mem::swap(&mut self.rank_to_slot, &mut prepared.rank_to_slot);
        self.pool_group_gains = None;
        self.pool_admission_dirty = true;
        self.tap_remap.fill(0.);
        self.tap_voice_indices.fill(usize::MAX);
        self.tap_count = 0;
        for (rank, &index) in self
            .rank_to_slot
            .iter()
            .take(TAP_ACTIVITY_CAPACITY)
            .enumerate()
        {
            if index != usize::MAX {
                self.tap_voice_indices[rank] = index;
                self.tap_count = rank + 1;
            }
        }
        for &index in &self.active_indices {
            let voice = &mut self.voices[index];
            if voice.live_following {
                // Freeze the exact physical read heard last before rebasing
                // controls. Neither adoption mode changes phase or history.
                voice.delays = [voice.live_delay; 2];
                voice.from = 0;
                voice.to = 0;
                voice.fade = 1.;
                voice.live_following = false;
            }
            if live && voice.fade == 0. {
                // No sample of this destination has been heard yet, so the
                // unchanged source can enter live following without a jump.
                voice.to = voice.from;
                voice.fade = 1.;
            }
            let heads = (voice.delays, voice.from, voice.to, voice.fade);
            let old_rank = voice.pool_rank;
            adopt_pool_control(
                voice,
                prepared.records.get(index),
                self.sample_rate,
                maximum_delay,
            );
            if live {
                // An already audible preset fade may finish, but a timing
                // rebuild must never create or redirect a second delay lane.
                (voice.delays, voice.from, voice.to, voice.fade) = heads;
                voice.live_delay = voice.delays[voice.from];
                voice.live_following = voice.fade >= 1.;
                if prepared.records.get(index).is_none() {
                    // Retiring branches have no coefficient in the new base.
                    // Keep their existing physical tail instead of rescaling
                    // an obsolete coefficient into the new pool's units.
                    voice.raw_base_delay = voice.live_delay;
                }
            }
            if voice.pool_rank < TAP_ACTIVITY_CAPACITY && old_rank < TAP_ACTIVITY_CAPACITY {
                self.tap_remap[voice.pool_rank] = self.tap_activity[old_rank];
            }
        }
        std::mem::swap(&mut self.tap_activity, &mut self.tap_remap);
        self.tap_energy.fill(0.);
        let mut recycled =
            self.pool_controls
                .replace(prepared)
                .unwrap_or_else(|| PreparedPoolControls {
                    records: Vec::new(),
                    rank_to_slot: Vec::new(),
                    groups: [0; 256],
                });
        // Installed controls do not need a second rank map. Keep the old map
        // with the retired records so both allocations can be reused together.
        std::mem::swap(
            &mut recycled.rank_to_slot,
            &mut self.pool_controls.as_mut().unwrap().rank_to_slot,
        );
        self.set_pool_limit(limit);
        recycled
    }

    /// Sample-thread safe generation gain update. Stable structural ranks are
    /// retained even while every generation is muted. Touch only admitted and
    /// releasing voices; reserved slots read these gains when later admitted.
    pub fn update_pool_group_gains(&mut self, gains: &[f64; 256], limit: usize) {
        if !self.pool_mode {
            return;
        }
        self.pool_group_gains = Some(*gains);
        self.pool_admission_dirty = true;
        self.set_pool_limit(limit);
    }

    /// Sample-thread safe. Visit changed ranks and audible/releasing slots;
    /// unadmitted storage never adds work to an audio-thread budget probe.
    pub fn set_pool_limit(&mut self, limit: usize) {
        if !self.pool_mode {
            return;
        }
        #[cfg(test)]
        {
            self.last_admission_visits = 0;
        }
        let previous_limit = if self.pool_admission_dirty {
            self.pool_group_counts.fill(0);
            0
        } else {
            self.runtime_limit
        };
        self.runtime_limit = limit
            .min(self.max_voices)
            .min(self.voices.len())
            .min(self.rank_to_slot.len());
        self.pool_admission_dirty = false;
        let group_gains = self.pool_group_gains.as_ref();
        for rank in previous_limit.min(self.runtime_limit)..previous_limit.max(self.runtime_limit) {
            #[cfg(test)]
            {
                self.last_admission_visits += 1;
            }
            if let Some(voice) = self.voices.get(self.rank_to_slot[rank]) {
                let control = self
                    .pool_controls
                    .as_ref()
                    .and_then(|controls| controls.records.get(self.rank_to_slot[rank]));
                let gain = control.map_or_else(
                    || pool_gain(voice, group_gains),
                    |control| control_gain(control, group_gains),
                );
                if gain > 0. {
                    let group = control.map_or(voice.pool_group, |control| control.group);
                    let count = &mut self.pool_group_counts[usize::from(group)];
                    if previous_limit < self.runtime_limit {
                        *count += 1;
                    } else {
                        *count -= 1;
                    }
                }
            }
        }
        self.target_count = self.pool_group_counts.iter().sum();
        let mut normalizers = [1.; 256];
        for (group, count) in self.pool_group_counts.iter().enumerate().skip(1) {
            if *count > 0 {
                normalizers[group] = (*count as f64).sqrt();
            }
        }
        for &index in &self.active_indices {
            #[cfg(test)]
            {
                self.last_admission_visits += 1;
            }
            let voice = &mut self.voices[index];
            voice.target.gain = if voice.pool_rank < self.runtime_limit {
                pool_gain(voice, group_gains) / normalizers[usize::from(voice.pool_group)]
            } else {
                0.
            };
            voice.releasing = voice.target.gain <= 0.;
        }
        self.admission_scratch.clear();
        for rank in previous_limit..self.runtime_limit {
            #[cfg(test)]
            {
                self.last_admission_visits += 1;
            }
            let index = self.rank_to_slot[rank];
            if let Some(voice) = self.voices.get_mut(index) {
                if voice.inactive {
                    if let Some(controls) = &self.pool_controls {
                        let maximum_delay = (self.history.len() - 3) as f64 / self.sample_rate;
                        adopt_pool_control(
                            voice,
                            controls.records.get(index),
                            self.sample_rate,
                            maximum_delay,
                        );
                    }
                }
                let gain = pool_gain(voice, group_gains);
                if voice.inactive && gain > 0. {
                    voice.target.gain = gain / normalizers[usize::from(voice.pool_group)];
                    voice.inactive = false;
                    voice.releasing = false;
                    self.admission_scratch.push(index);
                }
            }
        }
        // Pruning priorities can differ from stable slot order. Merge only
        // newly admitted slots so DSP retains its exact original summing order.
        self.admission_scratch.sort_unstable();
        let mut old = self.active_indices.len();
        let mut added = self.admission_scratch.len();
        self.active_indices.resize(old + added, 0);
        while added > 0 {
            let destination = old + added - 1;
            if old > 0 && self.active_indices[old - 1] > self.admission_scratch[added - 1] {
                old -= 1;
                self.active_indices[destination] = self.active_indices[old];
            } else {
                added -= 1;
                self.active_indices[destination] = self.admission_scratch[added];
            }
        }
    }

    /// Sample-thread safe: smooth release without a new collection or key map.
    pub fn silence(&mut self) {
        for &index in &self.active_indices {
            let voice = &mut self.voices[index];
            voice.target.gain = 0.;
            voice.releasing = true;
        }
        self.target_count = 0;
        self.pool_group_counts.fill(0);
        self.pool_admission_dirty = true;
    }
    pub fn active_voice_count(&self) -> usize {
        self.active_indices.len()
    }
    /// Exact slots visited by DSP, including release tails until retirement.
    /// Borrow the existing active list without allocating or scanning capacity.
    pub fn active_voice_indices(&self) -> &[usize] {
        &self.active_indices
    }
    pub fn target_voice_count(&self) -> usize {
        self.target_count
    }
    /// Counts of admitted positive-gain taps used for generation normalization.
    /// These are cached during control changes, independently of preview size
    /// and smoothly releasing old taps. Reading them performs no pool scan.
    pub fn pool_group_counts(&self) -> &[usize; 256] {
        &self.pool_group_counts
    }
    /// Sampled energy of actual rendered taps, grouped by acoustic generation.
    /// Display telemetry does not add voices, delay their admission, or gate DSP.
    pub fn generation_activity(&self) -> &[f32; 256] {
        &self.activity
    }
    /// RMS of every rendered sample of each preview tap, after gain and pan.
    /// Stable pool slots identify these meters even when priorities change.
    pub fn tap_activity(&self) -> &[f32; TAP_ACTIVITY_CAPACITY] {
        &self.tap_activity
    }
    pub fn tap_voice_indices(&self) -> &[usize; TAP_ACTIVITY_CAPACITY] {
        &self.tap_voice_indices
    }
    pub fn tap_meter_count(&self) -> usize {
        self.tap_count
    }
    /// Control-thread benchmark preparation on a separate engine. Live engines
    /// must retain their actual captured history; calibration never touches it.
    pub fn prepare_calibration_history(&mut self) {
        self.history.fill(0.03125);
        if let Some(right) = &mut self.history_right {
            right.fill(0.03125);
        }
        self.recorded = self.history.len();
    }
    pub fn allocated_bytes(&self) -> usize {
        (self.history.len() + self.history_right.as_ref().map_or(0, Vec::len)) * 4
            + self.window.len() * 8
            + self.voices.capacity() * std::mem::size_of::<Voice>()
            + self.active_indices.capacity() * std::mem::size_of::<usize>()
            + (self.rank_to_slot.capacity() + self.admission_scratch.capacity())
                * std::mem::size_of::<usize>()
            + self.growth_dirty_indices.capacity() * std::mem::size_of::<usize>()
            + self
                .pool_controls
                .as_ref()
                .map_or(0, PreparedPoolControls::allocated_bytes)
            + self
                .voices
                .iter()
                .map(|voice| voice.target.key.capacity())
                .sum::<usize>()
    }
    pub fn finish_block(&mut self) {
        #[cfg(test)]
        {
            self.last_meter_evaluations = 0;
        }
        let release = (-(self.activity_phase as f64) / (self.sample_rate * 0.18)).exp();
        for (level, energy) in self
            .activity
            .iter_mut()
            .zip(self.activity_energy.iter_mut())
        {
            // Prepared but silent slots have no new energy or decaying meter.
            // Preserve every nonzero transient and release while omitting the
            // square root/division for a display value that is exactly zero.
            if *energy == 0. && *level == 0. {
                continue;
            }
            #[cfg(test)]
            {
                self.last_meter_evaluations += 1;
            }
            let measured = (*energy / self.activity_samples.max(1) as f64).sqrt() as f32;
            *level = measured.max(*level * release as f32);
            *energy = 0.;
        }
        self.activity_samples = 0;
        let tap_release = (-(self.activity_phase as f64) / (self.sample_rate * 0.1)).exp();
        for (level, energy) in self
            .tap_activity
            .iter_mut()
            .zip(&mut self.tap_energy)
            .take(self.tap_count)
        {
            if *energy == 0. && *level == 0. {
                continue;
            }
            #[cfg(test)]
            {
                self.last_meter_evaluations += 1;
            }
            let measured = (*energy / self.activity_phase.max(1) as f64).sqrt() as f32;
            *level = measured.max(*level * tap_release as f32);
            *energy = 0.;
        }
        self.activity_phase = 0;
        // Retire records without dropping their String allocations on the
        // sample thread. The next control-thread installation reclaims them.
        // Preserve the browser threshold within its supported 1024-voice pool.
        // At higher native counts, bound the sum of discarded coherent tails.
        let threshold = if self.voices.len() > 1024 {
            0.0001 / self.voices.len() as f64
        } else {
            0.0001
        };
        let voices = &mut self.voices;
        self.active_indices.retain(|&index| {
            let voice = &mut voices[index];
            if voice.releasing && voice.gain < threshold {
                voice.inactive = true;
            }
            !voice.inactive
        });
    }

    pub fn process_frame(&mut self, input: [f32; 2]) -> [f32; 2] {
        self.track_numeric_growth();
        self.process_frame_inner(input)
    }

    /// The block entry point already tracks its complete active list. Audio
    /// controls and retirement cannot change that list inside a render block.
    fn process_frame_inner(&mut self, input: [f32; 2]) -> [f32; 2] {
        let left_in = if input[0].is_finite() {
            f64::from(input[0])
        } else {
            0.
        };
        let right_in = if input[1].is_finite() {
            f64::from(input[1])
        } else {
            0.
        };
        self.history[self.write] = if let Some(right) = &mut self.history_right {
            right[self.write] = right_in.tanh() as f32;
            left_in.tanh() as f32
        } else {
            ((left_in + right_in) * 0.5).tanh() as f32
        };
        let position = self.write as f64;
        self.write += 1;
        if self.write == self.history.len() {
            self.write = 0;
        }
        self.recorded = (self.recorded + 1).min(self.history.len());
        let time_fold_scale = self.advance_time_fold_scale();
        let view = RenderView {
            pool_mode: self.pool_mode,
            sample_rate: self.sample_rate,
            grain: self.grain,
            grain_step: self.grain_step,
            delay_fade_step: self.delay_fade_step,
            gain_smoothing: self.gain_smoothing,
            parameter_smoothing: self.parameter_smoothing,
            live_delay_smoothing: self.live_delay_smoothing,
            pitch_ratio: self.pitch_ratio,
            live_time_fold: self.live_time_fold,
            history: &self.history,
            history_right: self.history_right.as_deref(),
            window: &self.window,
        };
        let mut left = 0.;
        let mut right = 0.;
        let sample_activity = self.activity_phase.is_multiple_of(32);
        if sample_activity {
            self.activity_samples += 1;
        }
        self.activity_phase += 1;
        for &index in &self.active_indices {
            let voice = &mut self.voices[index];
            let wet = render_voice(voice, &view, position, self.recorded, time_fold_scale);
            left += wet[0];
            right += wet[1];
            if sample_activity {
                self.activity_energy[usize::from(voice.pool_group)] +=
                    (wet[0] * wet[0] + wet[1] * wet[1]) * 0.5;
            }
            if voice.pool_rank < TAP_ACTIVITY_CAPACITY {
                self.tap_energy[voice.pool_rank] += (wet[0] * wet[0] + wet[1] * wet[1]) * 0.5;
            }
        }
        [left.tanh() as f32, right.tanh() as f32]
    }

    /// Render at most 128 frames, visiting each voice once per block. Since
    /// this raw-history model has no feedback, input can be recorded in advance.
    /// Very long taps fall back to sample order to preserve data that a future
    /// write in this block could overwrite at the old end of the history ring.
    /// Output summing order and per-sample state updates remain unchanged.
    pub fn process_block(&mut self, input: &[[f32; 2]], output: &mut [[f32; 2]]) {
        self.track_numeric_growth();
        assert_eq!(input.len(), output.len());
        assert!(input.len() <= 128);
        self.activity_energy.fill(0.);
        self.tap_energy.fill(0.);
        self.activity_samples = 0;
        self.activity_phase = 0;
        let boundary = self.history.len() as f64 - input.len() as f64 - self.grain * 8.;
        let needs_sample_order = self.active_indices.iter().any(|&index| {
            let voice = &self.voices[index];
            !voice.inactive
                && ((self.pool_mode && voice.target.delay * self.sample_rate >= boundary)
                    || (self.live_time_fold
                        && voice.live_delay * self.sample_rate
                            + LIVE_DELAY_SLEW_SAMPLES * input.len() as f64
                            >= boundary)
                    || (self.live_time_fold
                        && voice.gain == 0.
                        && !voice.live_following
                        && voice.raw_base_delay
                            * self.time_fold_scale.max(self.target_time_fold_scale)
                            * self.sample_rate
                            >= boundary)
                    || voice
                        .delays
                        .iter()
                        .any(|delay| delay * self.sample_rate >= boundary))
        });
        if needs_sample_order {
            for (frame, result) in input.iter().zip(output.iter_mut()) {
                *result = self.process_frame_inner(*frame);
            }
            self.finish_block();
            return;
        }
        let mut positions = [0.; 128];
        let mut recorded_at = [0usize; 128];
        let mut time_fold_scales = [1.; 128];
        let mut wet = [[0f64; 2]; 128];
        for (index, frame) in input.iter().enumerate() {
            let left = if frame[0].is_finite() {
                f64::from(frame[0])
            } else {
                0.
            };
            let right = if frame[1].is_finite() {
                f64::from(frame[1])
            } else {
                0.
            };
            self.history[self.write] = if let Some(history_right) = &mut self.history_right {
                history_right[self.write] = right.tanh() as f32;
                left.tanh() as f32
            } else {
                ((left + right) * 0.5).tanh() as f32
            };
            positions[index] = self.write as f64;
            self.write += 1;
            if self.write == self.history.len() {
                self.write = 0;
            }
            self.recorded = (self.recorded + 1).min(self.history.len());
            recorded_at[index] = self.recorded;
            time_fold_scales[index] = self.advance_time_fold_scale();
        }
        let view = RenderView {
            pool_mode: self.pool_mode,
            sample_rate: self.sample_rate,
            grain: self.grain,
            grain_step: self.grain_step,
            delay_fade_step: self.delay_fade_step,
            gain_smoothing: self.gain_smoothing,
            parameter_smoothing: self.parameter_smoothing,
            live_delay_smoothing: self.live_delay_smoothing,
            pitch_ratio: self.pitch_ratio,
            live_time_fold: self.live_time_fold,
            history: &self.history,
            history_right: self.history_right.as_deref(),
            window: &self.window,
        };
        for &index in &self.active_indices {
            let voice = &mut self.voices[index];
            let mut tap_energy = 0.;
            for frame in 0..input.len() {
                let sample = render_voice(
                    voice,
                    &view,
                    positions[frame],
                    recorded_at[frame],
                    time_fold_scales[frame],
                );
                wet[frame][0] += sample[0];
                wet[frame][1] += sample[1];
                if frame.is_multiple_of(32) {
                    self.activity_energy[usize::from(voice.pool_group)] +=
                        (sample[0] * sample[0] + sample[1] * sample[1]) * 0.5;
                }
                // This is bounded by preview detail, not total audio capacity.
                // Every sample is included: sparse probes alias tones and miss transients.
                if voice.pool_rank < TAP_ACTIVITY_CAPACITY {
                    tap_energy += (sample[0] * sample[0] + sample[1] * sample[1]) * 0.5;
                }
            }
            if voice.pool_rank < TAP_ACTIVITY_CAPACITY {
                self.tap_energy[voice.pool_rank] += tap_energy;
            }
        }
        for (frame, result) in output.iter_mut().enumerate() {
            *result = [wet[frame][0].tanh() as f32, wet[frame][1].tanh() as f32];
        }
        self.activity_samples = input.len().div_ceil(32);
        self.activity_phase = input.len();
        self.finish_block();
    }

    pub fn process(
        &mut self,
        input_left: &[f32],
        input_right: &[f32],
        output_left: &mut [f32],
        output_right: &mut [f32],
    ) {
        assert_eq!(output_left.len(), output_right.len());
        for (frame, (left, right)) in output_left
            .iter_mut()
            .zip(output_right.iter_mut())
            .enumerate()
        {
            let input_l = input_left.get(frame).copied().unwrap_or(0.);
            let input_r = input_right.get(frame).copied().unwrap_or(input_l);
            let output = self.process_frame([input_l, input_r]);
            *left = output[0];
            *right = output[1];
        }
        self.finish_block();
    }
}

struct RenderView<'a> {
    pool_mode: bool,
    sample_rate: f64,
    grain: f64,
    grain_step: f64,
    delay_fade_step: f64,
    gain_smoothing: f64,
    parameter_smoothing: f64,
    live_delay_smoothing: f64,
    pitch_ratio: f64,
    live_time_fold: bool,
    history: &'a [f32],
    history_right: Option<&'a [f32]>,
    window: &'a [f64],
}

#[inline(always)]
fn render_voice(
    voice: &mut Voice,
    view: &RenderView<'_>,
    position: f64,
    recorded: usize,
    time_fold_scale: f64,
) -> [f64; 2] {
    let silent = voice.gain == 0.;
    voice.gain += (voice.target.gain - voice.gain) * view.gain_smoothing;
    let rate_target = (voice.target.rate * view.pitch_ratio).clamp(0.125, 8.);
    voice.rate += (rate_target - voice.rate) * view.parameter_smoothing;
    let pan_delta = voice.target.pan - voice.pan;
    if pan_delta.abs() > 1e-14 {
        voice.pan += pan_delta * view.parameter_smoothing;
        voice.pan_left = ((1. - voice.pan) * 0.5).sqrt();
        voice.pan_right = ((1. + voice.pan) * 0.5).sqrt();
    }
    let pitched = (voice.rate - 1.).abs() >= 0.0005;
    // Preserve the plain read until the new grain's history exists. Legacy
    // voices initialized in pitch mode retain their original delayed onset.
    let grain_ready = if pitched && voice.pitch_mix < 1. {
        let physical_delay = if voice.live_following { voice.live_delay } else { voice.delays[voice.from] };
        let grain_delay = (view.grain * 1.25)
            .max(physical_delay * view.sample_rate + (voice.rate - 1.).max(0.) * view.grain);
        recorded as f64 >= grain_delay + view.grain
    } else { true };
    let mix_target = f64::from(pitched && grain_ready);
    voice.pitch_mix += (mix_target - voice.pitch_mix) * view.parameter_smoothing;
    if (mix_target - voice.pitch_mix).abs() < 1e-12 {
        voice.pitch_mix = mix_target;
    }
    let shifted = pitched || voice.pitch_mix > 0.;
    if shifted {
        voice.phase += view.grain_step;
        if voice.phase >= 1. {
            voice.phase -= 1.;
        }
    }
    let mut other = voice.phase + 0.5;
    if other >= 1. {
        other -= 1.;
    }
    let window_a = if shifted {
        window_value(view.window, voice.phase)
    } else {
        0.
    };
    let geometry = GrainGeometry {
        shifted,
        grain: view.grain,
        span: view.grain * (voice.rate - 1.),
        headroom: (voice.rate - 1.).max(0.) * view.grain,
        phase: voice.phase,
        other,
        window_a,
        pitch_mix: voice.pitch_mix,
    };
    if view.pool_mode && view.live_time_fold && voice.fade == 0. {
        // The source still has unit weight before the first fade sample.
        voice.to = voice.from;
        voice.fade = 1.;
    }
    if view.pool_mode && view.live_time_fold && voice.fade >= 1. {
        let maximum = (view.history.len() - 3) as f64 / view.sample_rate;
        // Scale the raw coefficient before applying the read floor, including
        // previously unadmitted branches shorter than five microseconds.
        let target = if voice.pool_rank == usize::MAX {
            voice.live_delay
        } else {
            (voice.raw_base_delay * time_fold_scale)
                .min(maximum)
                .max(0.000005)
        };
        if !voice.live_following {
            voice.live_delay = if silent {
                target
            } else {
                voice.delays[voice.from]
            };
            voice.live_following = true;
            voice.live_delay_step = 0.;
        }
        let step = LIVE_DELAY_SLEW_SAMPLES / view.sample_rate;
        // Follow position as well as velocity: smoothing only the global knob
        // still jumps the read speed at each UI update and reversal. Keep the
        // velocity in physical seconds so a timing-only pool rebase cannot
        // restart it. The two followers are overdamped (35 ms / 8 ms).
        let desired_step = ((target - voice.live_delay) * view.parameter_smoothing)
            .clamp(-step, step);
        voice.live_delay_step += (desired_step - voice.live_delay_step) * view.live_delay_smoothing;
        let candidate = voice.live_delay + voice.live_delay_step;
        let next = geometry.head(position, candidate * view.sample_rate, recorded);
        let head = if next.ready {
            voice.live_delay = candidate;
            next
        } else {
            geometry.head(position, voice.live_delay * view.sample_rate, recorded)
        };
        let sample = head.sample(view.history);
        let right_sample = view
            .history_right
            .as_ref()
            .map_or(sample, |history| head.sample(history));
        return [
            sample * voice.gain * voice.pan_left,
            right_sample * voice.gain * voice.pan_right,
        ];
    }
    if view.pool_mode
        && voice.fade >= 1.
        && (voice.target.delay - voice.delays[voice.from]).abs() > 1. / view.sample_rate
    {
        let previous = geometry.delay(voice.delays[voice.from] * view.sample_rate);
        let destination = geometry.head(position, voice.target.delay * view.sample_rate, recorded);
        if previous == geometry.delay(voice.target.delay * view.sample_rate) {
            // Different nominal folds can have identical grain anchors. Do
            // not create a +3 dB equal-power bump for the exact same read.
            voice.delays[voice.from] = voice.target.delay;
        } else if destination.ready {
            voice.to = 1 - voice.from;
            voice.delays[voice.to] = voice.target.delay;
            voice.fade = 0.;
        }
    }
    // Compute positions once per delay lane and reuse them for stereo.
    let from = geometry.head(
        position,
        voice.delays[voice.from] * view.sample_rate,
        recorded,
    );
    let mut sample = from.sample(view.history);
    let mut right_sample = view
        .history_right
        .as_ref()
        .map_or(sample, |history| from.sample(history));
    if voice.fade < 1. {
        let to_head = geometry.head(
            position,
            voice.delays[voice.to] * view.sample_rate,
            recorded,
        );
        if to_head.ready {
            let to = to_head.sample(view.history);
            let from_gain = (voice.fade * std::f64::consts::FRAC_PI_2).cos();
            let to_gain = (voice.fade * std::f64::consts::FRAC_PI_2).sin();
            sample = sample * from_gain + to * to_gain;
            right_sample = view.history_right.as_ref().map_or(sample, |history| {
                right_sample * from_gain + to_head.sample(history) * to_gain
            });
            voice.fade = (voice.fade + view.delay_fade_step).min(1.);
            if voice.fade >= 1. {
                voice.from = voice.to;
            }
        }
    }
    if voice.fade >= 1. {
        voice.live_delay = voice.delays[voice.from];
    }
    [
        sample * voice.gain * voice.pan_left,
        right_sample * voice.gain * voice.pan_right,
    ]
}

struct GrainGeometry {
    shifted: bool,
    grain: f64,
    span: f64,
    headroom: f64,
    phase: f64,
    other: f64,
    window_a: f64,
    pitch_mix: f64,
}
struct ReadHead {
    ready: bool,
    shifted: bool,
    first: f64,
    second: f64,
    window_a: f64,
    pitch_mix: f64,
    direct_ready: bool,
    direct: f64,
}
impl GrainGeometry {
    #[inline(always)]
    fn delay(&self, requested: f64) -> f64 {
        if self.shifted {
            (self.grain * 1.25).max(requested + self.headroom)
        } else {
            requested.max(1.)
        }
    }
    #[inline(always)]
    fn head(&self, position: f64, requested: f64, recorded: usize) -> ReadHead {
        if !self.shifted {
            let delay = self.delay(requested);
            let truncated = delay as usize;
            let ceiling = truncated + usize::from(delay > truncated as f64);
            return ReadHead {
                ready: recorded >= ceiling + 2,
                shifted: false,
                first: position - delay,
                second: 0.,
                window_a: 0.,
                pitch_mix: 0.,
                direct_ready: false,
                direct: 0.,
            };
        }
        let delay = self.delay(requested);
        let anchor = position - delay;
        ReadHead {
            ready: recorded as f64 >= delay + self.grain,
            shifted: true,
            first: anchor + self.phase * self.span,
            second: anchor + self.other * self.span,
            window_a: self.window_a,
            pitch_mix: self.pitch_mix,
            direct_ready: recorded as f64 >= requested.max(1.).ceil() + 2.,
            direct: position - requested.max(1.),
        }
    }
}
impl ReadHead {
    #[inline(always)]
    fn sample(&self, history: &[f32]) -> f64 {
        if !self.ready {
            if self.pitch_mix < 1. && self.direct_ready {
                return read(history, self.direct);
            }
            return 0.;
        }
        if !self.shifted {
            return read(history, self.first);
        }
        let grain = read(history, self.first) * self.window_a
            + read(history, self.second) * (1. - self.window_a);
        if self.pitch_mix >= 1. || !self.direct_ready {
            return grain;
        }
        // A short unit-rate tap and a pitched grain have different anchors.
        // Blend their actual reads at the mode boundary instead of jumping
        // 137.5 ms into history as soon as a smoothed rate leaves unity.
        grain * self.pitch_mix + read(history, self.direct) * (1. - self.pitch_mix)
    }
}

#[inline(always)]
fn window_value(table: &[f64], phase: f64) -> f64 {
    let position = phase * WINDOW_SIZE as f64;
    let index = (position as usize).min(WINDOW_SIZE - 1);
    let fraction = position - index as f64;
    table[index] + (table[index + 1] - table[index]) * fraction
}
#[inline(always)]
fn read(history: &[f32], position: f64) -> f64 {
    // Positions are finite and within ~13 million samples. Truncation plus
    // negative-fraction correction equals floor without a portable libm call.
    let truncated = position as i64;
    let floor = truncated - i64::from(position < truncated as f64);
    let fraction = position - floor as f64;
    let length = history.len() as i64;
    let mut index = floor;
    // Ordinary history positions need at most one wrap; retain a defensive
    // remainder for unusual but legal maximum delays and extreme rates.
    if index < 0 {
        index += length;
    }
    if index >= length {
        index -= length;
    }
    if index < 0 || index >= length {
        index = index.rem_euclid(length);
    }
    let next = if index + 1 == length { 0 } else { index + 1 } as usize;
    f64::from(history[index as usize]) * (1. - fraction) + f64::from(history[next]) * fraction
}

#[cfg(test)]
mod arithmetic_tests {
    use super::*;

    // The original admission implementation is deliberately retained only as
    // a test oracle. It discovers selected voices by scanning every pool slot.
    fn full_scan_limit(engine: &mut Engine, limit: usize) {
        engine.runtime_limit = limit.min(engine.max_voices).min(engine.voices.len());
        let mut counts = [0usize; 256];
        engine.target_count = 0;
        for voice in &engine.voices {
            if voice.pool_rank < engine.runtime_limit && voice.desired_gain > 0. {
                engine.target_count += 1;
                counts[usize::from(voice.pool_group)] += 1;
            }
        }
        engine.pool_group_counts = counts;
        let mut normalizers = [1.; 256];
        for (group, count) in counts.iter().enumerate().skip(1) {
            if *count > 0 {
                normalizers[group] = (*count as f64).sqrt();
            }
        }
        engine.active_indices.clear();
        for (index, voice) in engine.voices.iter_mut().enumerate() {
            voice.target.gain = if voice.pool_rank < engine.runtime_limit {
                voice.desired_gain / normalizers[usize::from(voice.pool_group)]
            } else {
                0.
            };
            if voice.target.gain > 0. {
                voice.inactive = false;
                voice.releasing = false;
            } else {
                voice.releasing = true;
            }
            if !voice.inactive {
                engine.active_indices.push(index);
            }
        }
    }

    fn assert_admission_matches(actual: &Engine, reference: &Engine) {
        assert_eq!(actual.runtime_limit, reference.runtime_limit);
        assert_eq!(actual.target_count, reference.target_count);
        assert_eq!(actual.pool_group_counts, reference.pool_group_counts);
        assert_eq!(actual.active_indices, reference.active_indices);
        for (a, b) in actual.voices.iter().zip(&reference.voices) {
            assert_eq!(a.target.gain, b.target.gain);
            assert_eq!(a.inactive, b.inactive);
            if !a.inactive {
                assert_eq!(a.releasing, b.releasing);
            }
            assert_eq!(a.phase, b.phase);
            assert_eq!(a.delays, b.delays);
            assert_eq!(a.fade, b.fade);
            assert_eq!(a.gain, b.gain);
        }
    }

    fn render_matching(actual: &mut Engine, reference: &mut Engine, frames: usize) {
        for frame in 0..frames {
            let input = [(frame as f32 * 0.137).sin() * 0.05; 2];
            assert_eq!(actual.process_frame(input), reference.process_frame(input));
        }
        actual.finish_block();
        reference.finish_block();
        assert_admission_matches(actual, reference);
    }

    // The former full meter pass is an exact numerical oracle. It includes
    // silent slots so zero-work optimization cannot hide a transient or round
    // away the decay of a previously sounding branch.
    fn finish_meters_against_full_pass(engine: &mut Engine) {
        let mut generations = engine.activity;
        let mut taps = engine.tap_activity;
        let generation_release =
            (-(engine.activity_phase as f64) / (engine.sample_rate * 0.18)).exp() as f32;
        let tap_release =
            (-(engine.activity_phase as f64) / (engine.sample_rate * 0.1)).exp() as f32;
        let mut expected_evaluations = 0;
        for (level, energy) in generations.iter_mut().zip(engine.activity_energy) {
            expected_evaluations += usize::from(energy != 0. || *level != 0.);
            let measured = (energy / engine.activity_samples.max(1) as f64).sqrt() as f32;
            *level = measured.max(*level * generation_release);
        }
        for (level, energy) in taps
            .iter_mut()
            .zip(engine.tap_energy)
            .take(engine.tap_count)
        {
            expected_evaluations += usize::from(energy != 0. || *level != 0.);
            let measured = (energy / engine.activity_phase.max(1) as f64).sqrt() as f32;
            *level = measured.max(*level * tap_release);
        }
        engine.finish_block();
        assert_eq!(
            engine.activity.map(f32::to_bits),
            generations.map(f32::to_bits)
        );
        assert_eq!(
            engine.tap_activity.map(f32::to_bits),
            taps.map(f32::to_bits)
        );
        assert_eq!(engine.activity_energy, [0.; 256]);
        assert_eq!(engine.tap_energy, [0.; TAP_ACTIVITY_CAPACITY]);
        assert_eq!(engine.last_meter_evaluations, expected_evaluations);
    }

    #[test]
    fn silent_prepared_meters_skip_work_without_losing_transients_or_releases() {
        let count = TAP_ACTIVITY_CAPACITY;
        let keys: Vec<_> = (0..count).map(|index| format!("meter:{index}")).collect();
        let mut engine = Engine::new(8000, 4., count, 1).unwrap();
        engine.install_pool(&keys).unwrap();
        let targets = vec![
            PoolTarget {
                delay: 0.004,
                gain: 0.4,
                ..PoolTarget::default()
            };
            count
        ];
        let ranks: Vec<_> = (0..count).collect();
        let groups = vec![1; count];
        engine.update_pool_ranked(&targets, &ranks, &groups, 1);
        assert_eq!(engine.tap_count, count);
        finish_meters_against_full_pass(&mut engine);
        assert_eq!(engine.last_meter_evaluations, 0);
        let mut heard_impulse = false;
        let mut retained_release = false;
        for block in 0..48 {
            match block {
                14 => engine.set_pool_limit(5),
                18 => engine.set_pool_limit(1),
                24 => engine.set_pool_limit(0),
                32 => engine.update_pool_ranked(&targets, &ranks, &groups, 2),
                _ => {}
            }
            for frame in 0..128 {
                let input = if block == 2 && frame == 64 {
                    0.25
                } else if block == 10 {
                    1e-15
                } else {
                    0.
                };
                engine.process_frame([input; 2]);
            }
            let before = engine.tap_activity;
            finish_meters_against_full_pass(&mut engine);
            heard_impulse |= engine.tap_activity[0] > 0.;
            if block == 25 {
                retained_release = before[0] > 0. && engine.tap_activity[0] > 0.;
            }
            assert!(
                engine.last_meter_evaluations <= 6,
                "one generation and at most five live/decaying tap meters need evaluation"
            );
        }
        assert!(heard_impulse);
        assert!(retained_release);
    }

    #[test]
    fn meter_fast_path_preserves_tiny_energy_and_nonzero_decay_exactly() {
        let mut engine = Engine::new(8000, 4., 1, 1).unwrap();
        engine.tap_count = TAP_ACTIVITY_CAPACITY;
        engine.activity_phase = 128;
        engine.activity_samples = 4;
        engine.activity_energy[9] = 1e-60;
        engine.activity[10] = 1e-20;
        engine.tap_energy[2046] = 1e-60;
        engine.tap_activity[2047] = 1e-20;
        finish_meters_against_full_pass(&mut engine);
        assert_eq!(engine.last_meter_evaluations, 4);
        assert!(engine.activity[9] > 0.);
        assert!(engine.activity[10] > 0.);
        assert!(engine.tap_activity[2046] > 0.);
        assert!(engine.tap_activity[2047] > 0.);
    }

    #[test]
    fn incremental_admission_matches_full_scan_through_rank_controls_and_retirement() {
        let keys: Vec<_> = (0..64)
            .map(|index| format!("differential:{index}"))
            .collect();
        let mut actual = Engine::new(8000, 4., 64, 2).unwrap();
        let mut reference = Engine::new(8000, 4., 64, 2).unwrap();
        actual.install_pool(&keys).unwrap();
        reference.install_pool(&keys).unwrap();
        for stage in 0..12 {
            let length = if stage % 3 == 0 { 41 } else { 64 };
            let targets: Vec<_> = (0..length)
                .map(|index| PoolTarget {
                    delay: 0.013 + (index % 7 + stage) as f64 * 0.002,
                    rate: 0.5 + (index % 5) as f64 * 0.4,
                    gain: if (index + stage) % 5 == 0 { 0. } else { 0.23 },
                    pan: (index % 3) as f64 * 0.7 - 0.7,
                })
                .collect();
            let mut ranks: Vec<_> = (0..length).map(|index| (index * 37 + stage) % 64).collect();
            ranks[7] = ranks[2];
            ranks[11] = usize::MAX;
            ranks[14] = 64;
            if stage % 2 == 0 {
                ranks.truncate(29);
            }
            let groups: Vec<_> = (0..length.saturating_sub(3))
                .map(|index| [0, 1, 2, 255][(index + stage) % 4])
                .collect();
            let initial = 5 + stage;
            actual.update_pool_ranked(&targets, &ranks, &groups, initial);
            reference.update_pool_ranked(&targets, &ranks, &groups, initial);
            full_scan_limit(&mut reference, initial);
            assert_admission_matches(&actual, &reference);
            for limit in [64, 3, 47, 47, 0, 22, 65] {
                actual.set_pool_limit(limit);
                full_scan_limit(&mut reference, limit);
                assert_admission_matches(&actual, &reference);
                render_matching(&mut actual, &mut reference, 128);
            }
            actual.silence();
            reference.silence();
            render_matching(&mut actual, &mut reference, 1800);
            actual.set_pool_limit(64);
            full_scan_limit(&mut reference, 64);
            render_matching(&mut actual, &mut reference, 256);
        }
    }

    #[test]
    fn admission_lookup_survives_growth_without_readmitting_rejected_ranks() {
        let keys: Vec<_> = (0..16).map(|index| format!("grow:{index}")).collect();
        let mut actual = Engine::new(8000, 4., 8, 1).unwrap();
        let mut reference = Engine::new(8000, 4., 8, 1).unwrap();
        actual.install_pool(&keys[..8]).unwrap();
        reference.install_pool(&keys[..8]).unwrap();
        let mut targets = [PoolTarget {
            delay: 0.02,
            rate: 1.4,
            gain: 0.2,
            pan: 0.,
        }; 16];
        targets[0].gain = 0.;
        let ranks = [0, 0, 3, usize::MAX, 1, 7, 12, 5];
        for engine in [&mut actual, &mut reference] {
            engine.update_pool_ranked(&targets[..8], &ranks, &[2; 8], 5);
        }
        full_scan_limit(&mut reference, 5);
        render_matching(&mut actual, &mut reference, 400);
        actual.grow_pool(&mut PreparedPool::new(&keys).unwrap());
        reference.grow_pool(&mut PreparedPool::new(&keys).unwrap());
        actual.set_pool_limit(16);
        full_scan_limit(&mut reference, 16);
        assert_eq!(
            actual.target_count, 4,
            "zero first-winner and invalid rank stay excluded"
        );
        render_matching(&mut actual, &mut reference, 256);
        let reordered: Vec<_> = (0..16).rev().collect();
        actual.update_pool_ranked(&targets, &reordered, &[3; 16], 11);
        reference.update_pool_ranked(&targets, &reordered, &[3; 16], 11);
        full_scan_limit(&mut reference, 11);
        render_matching(&mut actual, &mut reference, 256);
    }

    #[test]
    fn tiny_admission_changes_do_not_visit_the_unadmitted_pool() {
        let count = 131_072;
        let keys: Vec<_> = (0..count).map(|index| format!("sparse:{index}")).collect();
        let mut engine = Engine::new(8000, 4., count, 1).unwrap();
        engine.install_pool(&keys).unwrap();
        let targets = vec![
            PoolTarget {
                gain: 0.2,
                ..PoolTarget::default()
            };
            count
        ];
        engine.update_pool(&targets, 48);
        assert_eq!(engine.last_admission_visits, 96);
        for _ in 0..100 {
            engine.set_pool_limit(49);
            assert_eq!(engine.target_count, 49);
            assert!(engine.last_admission_visits <= 51);
            engine.set_pool_limit(48);
            assert_eq!(engine.target_count, 48);
            assert_eq!(engine.active_indices.len(), 49, "release tail is retained");
            assert!(engine.last_admission_visits <= 51);
        }
    }
    #[test]
    fn generation_gain_controls_touch_only_audible_ranks_and_resume_reserved_silent_branches() {
        let count = 131_072;
        let keys: Vec<_> = (0..count).map(|index| format!("depth:{index}")).collect();
        let mut engine = Engine::new(8000, 4., count, 1).unwrap();
        engine.install_pool(&keys).unwrap();
        let targets = vec![
            PoolTarget {
                gain: 0.,
                ..PoolTarget::default()
            };
            count
        ];
        let ranks: Vec<_> = (0..count).collect();
        engine.update_pool_ranked(&targets, &ranks, &vec![3; count], 0);
        let mut gains = [0.; 256];
        gains[3] = 0.37;
        engine.update_pool_group_gains(&gains, 48);
        assert_eq!(engine.target_count, 48);
        assert_eq!(engine.last_admission_visits, 96);
        let silent_phase = engine.voices[100].phase;
        for _ in 0..256 {
            engine.process_frame([0.07; 2]);
        }
        engine.finish_block();
        let live_phase = engine.voices[0].phase;
        let live_gain = engine.voices[0].gain;
        gains[3] = 0.18;
        engine.update_pool_group_gains(&gains, 48);
        assert_eq!(engine.last_admission_visits, 144);
        assert_eq!(engine.voices[0].phase, live_phase);
        assert_eq!(engine.voices[0].gain, live_gain);
        assert_eq!(engine.voices[100].phase, silent_phase);
        assert!(engine.voices[100].inactive);
        engine.set_pool_limit(101);
        assert_eq!(engine.target_count, 101);
        assert_eq!(engine.voices[100].phase, silent_phase);
        assert_eq!(engine.voices[100].target.gain, 0.18 / 101f64.sqrt());
        gains[3] = 0.;
        engine.update_pool_group_gains(&gains, 0);
        assert_eq!(engine.target_count, 0);
        assert_eq!(
            engine.active_indices.len(),
            101,
            "the existing release remains audible"
        );
        assert!(engine.voices[0].releasing);
    }

    #[test]
    fn no_decay_generation_gains_keep_normalization_smoothing_and_raw_history() {
        let groups: Vec<_> = (1u8..=3)
            .flat_map(|generation| std::iter::repeat_n(generation, 1 << generation))
            .collect();
        let keys: Vec<_> = (0..groups.len())
            .map(|index| format!("no-decay:{index}"))
            .collect();
        let targets: Vec<_> = groups
            .iter()
            .map(|&generation| PoolTarget {
                delay: f64::from(generation) * 0.016,
                rate: 1. + f64::from(generation) * 0.1,
                gain: 0.5 * 0.96f64.powf(f64::from(generation) * 0.72),
                pan: 0.,
            })
            .collect();
        let ranks: Vec<_> = (0..keys.len()).collect();
        let mut engine = Engine::new(8000, 4., keys.len(), 1).unwrap();
        engine.install_pool(&keys).unwrap();
        engine.update_pool_ranked(&targets, &ranks, &groups, keys.len());
        let input = [[0.07; 2]; 128];
        let mut output = [[0.; 2]; 128];
        for _ in 0..16 {
            engine.process_block(&input, &mut output);
        }
        let history = engine.history.clone();
        let write = engine.write;
        let recorded = engine.recorded;
        let allocated = engine.allocated_bytes();
        let history_pointer = engine.history.as_ptr();
        let voice_pointer = engine.voices.as_ptr();
        let identities: Vec<_> = engine
            .voices
            .iter()
            .map(|voice| {
                (
                    voice.target.key.clone(),
                    voice.phase,
                    voice.phase_seed,
                    voice.pool_rank,
                    voice.gain,
                )
            })
            .collect();
        let mut gains = [0.; 256];
        gains[1..=3].fill(0.5);
        engine.update_pool_group_gains(&gains, keys.len());
        assert_eq!(
            engine.history, history,
            "Generation gains never write wet output into history"
        );
        assert_eq!((engine.write, engine.recorded), (write, recorded));
        assert_eq!(engine.allocated_bytes(), allocated);
        assert_eq!(engine.history.as_ptr(), history_pointer);
        assert_eq!(engine.voices.as_ptr(), voice_pointer);
        let mut energy = [0.; 4];
        for (voice, (key, phase, seed, rank, gain)) in engine.voices.iter().zip(identities) {
            assert_eq!(voice.target.key, key);
            assert_eq!(voice.phase, phase);
            assert_eq!(voice.phase_seed, seed);
            assert_eq!(voice.pool_rank, rank);
            assert_eq!(
                voice.gain, gain,
                "Live amplitude changes wait for sample smoothing"
            );
            let group = usize::from(voice.pool_group);
            energy[group] += voice.target.gain * voice.target.gain;
        }
        for energy in &energy[1..] {
            assert!(
                (energy - 0.25).abs() < 1e-14,
                "Each generation retains normalized energy"
            );
        }
        let gain = engine.voices[0].gain;
        let target = engine.voices[0].target.gain;
        engine.process_frame([0.; 2]);
        assert!(engine.voices[0].gain > gain && engine.voices[0].gain < target);

        let silence = [[0.; 2]; 128];
        let mut tail_energy = 0.;
        for _ in 0..260 {
            engine.process_block(&silence, &mut output);
            for sample in output.iter().flatten() {
                assert!(sample.is_finite() && sample.abs() <= 1.);
                tail_energy += f64::from(*sample).powi(2);
            }
        }
        assert!(
            tail_energy > 0.,
            "The existing input history remains audible"
        );
        assert!(engine.history.iter().all(|sample| *sample == 0.));
        assert!(
            output.iter().flatten().all(|sample| *sample == 0.),
            "No-decay layers end when captured history has passed"
        );
    }

    #[test]
    fn staged_numeric_growth_preserves_phases_of_tails_that_retire_during_preparation() {
        let keys: Vec<_> = (0..4096).map(|index| format!("growth:{index}")).collect();
        let mut engine = Engine::new(8000, 4., 4096, 1).unwrap();
        engine.install_pool(&keys).unwrap();
        let targets = vec![
            PoolTarget {
                rate: 1.7,
                gain: 0.01,
                ..PoolTarget::default()
            };
            4096
        ];
        engine.update_pool(&targets, 64);
        for _ in 0..256 {
            engine.process_frame([0.1; 2]);
        }
        engine.finish_block();
        engine.begin_numeric_growth().unwrap();
        let mut growth = PreparedPool::numeric(8192).unwrap();
        engine.prepare_numeric_growth_until(&mut growth, 4096);
        let original_phase = growth.voices[0].phase;
        engine.silence();
        for _ in 0..80 {
            for _ in 0..128 {
                engine.process_frame([0.1; 2]);
            }
            engine.finish_block();
        }
        assert_eq!(engine.active_voice_count(), 0);
        let retired_phase = engine.voices[0].phase;
        assert_ne!(retired_phase, original_phase);
        engine.prepare_numeric_growth_until(&mut growth, 8192);
        engine.commit_numeric_growth(&mut growth);
        assert_eq!(engine.voices[0].phase, retired_phase);
        assert!(engine.voices[0].inactive);
        assert_eq!(engine.voices.len(), 8192);
        assert!(!engine.growth_tracking);
    }

    #[test]
    fn long_history_blocks_track_growth_once_and_match_public_sample_rendering() {
        let keys: Vec<_> = (0..8).map(|index| format!("long-growth:{index}")).collect();
        let targets = vec![
            PoolTarget {
                delay: 3.99,
                rate: 1.7,
                gain: 0.1,
                pan: -0.25,
            };
            keys.len()
        ];
        let mut block = Engine::new(8000, 4., keys.len(), 2).unwrap();
        let mut samples = Engine::new(8000, 4., keys.len(), 2).unwrap();
        for engine in [&mut block, &mut samples] {
            engine.install_pool(&keys).unwrap();
            engine.update_pool(&targets, 3);
            engine.prepare_calibration_history();
            engine.write = engine.history.len() - 100;
            engine.begin_numeric_growth().unwrap();
        }
        let mut block_growth = PreparedPool::numeric(16).unwrap();
        let mut sample_growth = PreparedPool::numeric(16).unwrap();
        block.prepare_numeric_growth_until(&mut block_growth, keys.len());
        samples.prepare_numeric_growth_until(&mut sample_growth, keys.len());
        let original_phase = block_growth.voices[0].phase;
        for index in 0..64 {
            match index {
                3 => {
                    block.set_pool_limit(6);
                    samples.set_pool_limit(6);
                }
                8 => {
                    block.set_pool_limit(1);
                    samples.set_pool_limit(1);
                }
                20 => {
                    block.silence();
                    samples.silence();
                }
                _ => {}
            }
            let input: [[f32; 2]; 128] = std::array::from_fn(|frame| {
                let phase = (index * 128 + frame) as f32;
                [(phase * 0.13).sin() * 0.05, (phase * 0.17).cos() * 0.08]
            });
            let mut output = [[0.; 2]; 128];
            block.growth_tracking_passes = 0;
            samples.growth_tracking_passes = 0;
            block.process_block(&input, &mut output);
            for (frame, rendered) in input.iter().zip(output) {
                assert_eq!(
                    rendered.map(f32::to_bits),
                    samples.process_frame(*frame).map(f32::to_bits)
                );
            }
            samples.finish_block();
            assert_eq!(
                block.growth_tracking_passes, 1,
                "history-safe sample order must not repeat the growth scan per frame"
            );
            assert_eq!(
                samples.growth_tracking_passes, 128,
                "the public sample entry point still tracks each independent call"
            );
            assert_eq!(block.growth_dirty_indices, samples.growth_dirty_indices);
            assert_admission_matches(&block, &samples);
            assert_eq!(
                block.activity.map(f32::to_bits),
                samples.activity.map(f32::to_bits)
            );
            assert_eq!(
                block.tap_activity.map(f32::to_bits),
                samples.tap_activity.map(f32::to_bits)
            );
        }
        assert_eq!(
            block.active_voice_count(),
            0,
            "all releasing branches retired while growth was staged"
        );
        let retired_phase = block.voices[0].phase;
        assert_ne!(retired_phase, original_phase);
        block.prepare_numeric_growth_until(&mut block_growth, 16);
        samples.prepare_numeric_growth_until(&mut sample_growth, 16);
        block.commit_numeric_growth(&mut block_growth);
        samples.commit_numeric_growth(&mut sample_growth);
        assert_admission_matches(&block, &samples);
        assert_eq!(block.voices[0].phase, retired_phase);
        assert!(block.voices[0].inactive);
        assert_eq!(block.history, samples.history);
        assert_eq!(block.history_right, samples.history_right);
        assert_eq!(block.write, samples.write);
        assert_eq!(block.recorded, samples.recorded);
        assert!(!block.growth_tracking);
    }

    #[test]
    fn optimized_wrapping_interpolation_matches_floor_at_boundaries() {
        let history: Vec<f32> = (0..17).map(|i| i as f32 * 0.03 - 0.2).collect();
        for whole in [-12_288_000., -51., -17., -1., 0., 1., 17., 51., 12_288_000.] {
            for offset in [-0.999999, -0.5, -1e-9, 0., 1e-9, 0.5, 0.999999] {
                let position: f64 = whole + offset;
                let floor = position.floor();
                let fraction = position - floor;
                let index = (floor as i64).rem_euclid(history.len() as i64) as usize;
                let next = (index + 1) % history.len();
                let expected = f64::from(history[index]) * (1. - fraction)
                    + f64::from(history[next]) * fraction;
                assert_eq!(read(&history, position), expected);
            }
        }
    }
    #[test]
    fn phase_wrapping_keeps_original_operation_order() {
        let step = 1. / 5280.;
        for phase in [0., 0.5 - step, 0.5, 1. - step, 1.] {
            let mut next = phase + step;
            if next >= 1. {
                next -= 1.;
            }
            assert_eq!(next, (phase + step) % 1.);
            let mut other = next + 0.5;
            if other >= 1. {
                other -= 1.;
            }
            assert_eq!(other, (next + 0.5) % 1.);
        }
    }

    #[test]
    fn new_branch_identity_reseeds_only_that_slot_and_preserves_recording() {
        let mut engine = Engine::new(8000, 4.0, 2, 1).unwrap();
        engine
            .install_pool(&["reserved/a".into(), "reserved/b".into()])
            .unwrap();
        let seeds = [
            phase_seed("generation:coral:1"),
            phase_seed("generation:coral:2"),
        ];
        engine.set_pool_phase_seeds(&seeds);
        engine.update_pool(
            &[PoolTarget {
                rate: 1.5,
                gain: 0.4,
                ..PoolTarget::default()
            }; 2],
            2,
        );
        for _ in 0..400 {
            engine.process_frame([0.03; 2]);
        }
        let retained_phase = engine.voices[1].phase;
        let recorded = engine.recorded;
        let write = engine.write;
        let changed = [phase_seed("generation:dragon:1"), seeds[1]];
        engine.set_pool_phase_seeds(&changed);
        assert_eq!(
            engine.voices[0].phase,
            f64::from(changed[0]) / f64::from(u32::MAX)
        );
        assert_eq!(engine.voices[1].phase, retained_phase);
        assert_eq!(engine.recorded, recorded);
        assert_eq!(engine.write, write);
    }

    #[test]
    fn cached_generation_counts_follow_admission_budget_and_exclude_zero_gain_taps() {
        let mut engine = Engine::new(8000, 4.0, 6, 1).unwrap();
        let keys: Vec<_> = (0..6).map(|index| format!("generation:{index}")).collect();
        engine.install_pool(&keys).unwrap();
        assert_eq!(engine.pool_group_counts(), &[0; 256]);
        let mut targets = [PoolTarget {
            gain: 0.4,
            ..PoolTarget::default()
        }; 6];
        targets[4].gain = 0.0;
        engine.update_pool_ranked(&targets, &[0, 1, 2, 3, 4, 5], &[1, 2, 2, 3, 3, 3], 6);
        assert_eq!(&engine.pool_group_counts()[1..4], &[1, 2, 2]);
        assert_eq!(
            engine.pool_group_counts().iter().sum::<usize>(),
            engine.target_voice_count()
        );
        for _ in 0..400 {
            engine.process_frame([0.03; 2]);
        }
        engine.set_pool_limit(2);
        assert_eq!(&engine.pool_group_counts()[1..4], &[1, 1, 0]);
        assert!(
            engine.active_voice_count() > engine.target_voice_count(),
            "Released tails remain audible while admission counts shrink"
        );
        engine.set_pool_limit(4);
        assert_eq!(&engine.pool_group_counts()[1..4], &[1, 2, 1]);
        engine.silence();
        assert_eq!(engine.pool_group_counts(), &[0; 256]);
    }
}

#[cfg(test)]
mod live_time_fold_tests {
    use super::*;

    const RATE: f64 = 8000.;

    fn prepared(targets: &[PoolTarget]) -> PreparedPoolControls {
        let mut controls = PreparedPoolControls::new(targets.len()).unwrap();
        for (index, target) in targets.iter().enumerate() {
            controls.push(*target, index, phase_seed(&format!("fold/{index}")), 0, 1);
        }
        controls
    }

    fn pool(targets: &[PoolTarget], limit: usize, ready: bool) -> Engine {
        let mut engine = Engine::new(RATE as u32, 4., targets.len(), 2).unwrap();
        let keys: Vec<_> = (0..targets.len())
            .map(|index| format!("fold/{index}"))
            .collect();
        engine.install_pool(&keys).unwrap();
        engine.install_prepared_pool_controls(prepared(targets), limit);
        if ready {
            engine.prepare_calibration_history();
            let constant = 0.08f64.tanh() as f32;
            engine.history.fill(constant);
            engine.history_right.as_mut().unwrap().fill(constant);
        }
        engine
    }

    fn target(delay: f64, rate: f64) -> PoolTarget {
        PoolTarget {
            delay,
            rate,
            gain: 0.25,
            pan: 0.,
        }
    }

    #[test]
    fn live_sweeps_keep_one_lane_phase_and_constant_level_without_capacity_loss() {
        let targets: Vec<_> = (0..32)
            .map(|index| target(0.15 + index as f64 * 0.002, 0.7 + index as f64 * 0.04))
            .collect();
        let mut engine = pool(&targets, targets.len(), true);
        for _ in 0..4000 {
            engine.process_frame([0.08; 2]);
        }
        let steady = engine.process_frame([0.08; 2]);
        let history_pointer = engine.history.as_ptr();
        let mut phases: Vec<_> = engine.voices.iter().map(|voice| voice.phase).collect();
        for scale in [0.2, 1.7, 4., 0.5, 1., 12., 0.75] {
            engine.set_time_fold_scale(scale).unwrap();
            for _ in 0..320 {
                let delays: Vec<_> = engine.voices.iter().map(|voice| voice.live_delay).collect();
                let output = engine.process_frame([0.08; 2]);
                for sample in output.iter().zip(steady) {
                    assert!(
                        (sample.0 - sample.1).abs() < 1e-7,
                        "no equal-power pump or hole on DC"
                    );
                }
                for (index, voice) in engine.voices.iter().enumerate() {
                    assert_eq!(
                        voice.fade, 1.,
                        "live movement never adds a second delay lane"
                    );
                    assert!(voice.live_following);
                    assert!(
                        (voice.live_delay - delays[index]).abs()
                            <= LIVE_DELAY_SLEW_SAMPLES / RATE + 1e-14
                    );
                    phases[index] += engine.grain_step;
                    if phases[index] >= 1. {
                        phases[index] -= 1.;
                    }
                    assert_eq!(
                        voice.phase, phases[index],
                        "grain phase continues through the gesture"
                    );
                }
                assert_eq!(engine.active_voice_count(), targets.len());
                assert_eq!(engine.target_voice_count(), targets.len());
            }
        }
        assert_eq!(engine.history.as_ptr(), history_pointer);
    }

    #[test]
    fn live_scale_is_shared_once_per_frame_and_settles_while_pool_is_unadmitted() {
        let mut engine = pool(&[target(0.2, 1.); 8], 0, true);
        engine.set_time_fold_scale(2.).unwrap();
        for _ in 0..280 {
            engine.process_frame([0.08; 2]);
        }
        let expected = 2. - (-1f64).exp();
        assert!(
            (engine.time_fold_scale() - expected).abs() < 1e-13,
            "35 ms is independent of voice count"
        );
        for _ in 0..8000 {
            engine.process_frame([0.08; 2]);
        }
        assert_eq!(engine.time_fold_scale(), 2.);
        engine.set_pool_limit(8);
        engine.process_frame([0.08; 2]);
        for voice in &engine.voices {
            assert_eq!(
                voice.live_delay, 0.4,
                "newly admitted slots use the current shared scale"
            );
            assert_eq!(voice.fade, 1.);
        }
        for invalid in [0., -1., f64::NAN, f64::INFINITY] {
            assert!(engine.set_time_fold_scale(invalid).is_err());
            assert!(engine.rebase_time_fold_scale(invalid).is_err());
            assert_eq!(engine.time_fold_scale(), 2.);
        }
    }

    #[test]
    fn live_scale_multiplies_tiny_raw_coefficients_before_the_read_floor() {
        let mut engine = pool(&[target(0.0000001, 1.)], 0, true);
        engine.set_time_fold_scale(100_000.).unwrap();
        for _ in 0..9000 {
            engine.process_frame([0.08; 2]);
        }
        engine.set_pool_limit(1);
        engine.process_frame([0.08; 2]);
        assert_eq!(engine.voices[0].raw_base_delay, 0.0000001);
        assert!(
            (engine.voices[0].live_delay - 0.01).abs() < 1e-14,
            "the 5 us floor is applied after scaling"
        );
    }

    #[test]
    fn short_pitched_delays_with_the_same_effective_anchor_never_crossfade() {
        let mut changed = pool(&[target(0.005, 0.7)], 1, true);
        let mut stationary = pool(&[target(0.005, 0.7)], 1, true);
        for _ in 0..1600 {
            assert_eq!(
                changed.process_frame([0.08; 2]),
                stationary.process_frame([0.08; 2])
            );
        }
        changed.install_prepared_pool_controls(prepared(&[target(0.006, 0.7)]), 1);
        for frame in 0..800 {
            let input = [((frame as f64 * 0.31).sin() * 0.08) as f32; 2];
            assert_eq!(
                changed.process_frame(input),
                stationary.process_frame(input)
            );
            assert_eq!(changed.voices[0].fade, 1.);
        }
    }

    #[test]
    fn discrete_delay_change_waits_for_destination_history_then_completes() {
        let mut engine = pool(&[target(0.02, 1.)], 1, false);
        for _ in 0..1200 {
            engine.process_frame([0.08; 2]);
        }
        engine.install_prepared_pool_controls(prepared(&[target(0.8, 1.)]), 1);
        for _ in 0..4000 {
            assert!(
                engine.process_frame([0.08; 2])[0] > 0.01,
                "the readable source survives an unavailable destination"
            );
            assert_eq!(engine.voices[0].fade, 1.);
            assert_eq!(engine.voices[0].delays[engine.voices[0].from], 0.02);
        }
        for _ in 0..2400 {
            engine.process_frame([0.08; 2]);
        }
        assert_eq!(engine.voices[0].fade, 1.);
        assert_eq!(engine.voices[0].delays[engine.voices[0].from], 0.8);
    }

    #[test]
    fn live_increase_waits_on_the_readable_head_and_initial_long_voice_eventually_plays() {
        let mut moving = pool(&[target(0.02, 1.)], 1, false);
        for _ in 0..1200 {
            moving.process_frame([0.08; 2]);
        }
        moving.set_time_fold_scale(40.).unwrap();
        let mut audible = false;
        for _ in 0..8000 {
            let output = moving.process_frame([0.08; 2]);
            assert!(
                output[0] > 0.01,
                "a live increase never advances into unread history"
            );
            assert_eq!(moving.voices[0].fade, 1.);
            audible |= moving.voices[0].live_delay > 0.799;
        }
        assert!(
            audible,
            "history readiness eventually allows the requested fold"
        );

        let mut initial = pool(&[target(0.8, 1.)], 1, false);
        initial.set_time_fold_scale(1.).unwrap();
        for _ in 0..6401 {
            assert_eq!(initial.process_frame([0.08; 2]), [0.; 2]);
        }
        assert!(
            initial.process_frame([0.08; 2])[0] > 0.01,
            "a voice waiting for its first history is not stuck"
        );
    }

    #[test]
    fn live_pool_rebase_preserves_physical_head_and_presets_keep_discrete_fades() {
        let mut engine = pool(&[target(0.2, 1.7)], 1, true);
        for _ in 0..4000 {
            engine.process_frame([0.08; 2]);
        }
        engine.set_time_fold_scale(3.).unwrap();
        for _ in 0..80 {
            engine.process_frame([0.08; 2]);
        }
        let physical = engine.voices[0].live_delay;
        let velocity = engine.voices[0].live_delay_step;
        let phase = engine.voices[0].phase;
        let gain = engine.voices[0].gain;
        let history_pointer = engine.history.as_ptr();
        engine.rebase_time_fold_scale(1. / 3.).unwrap();
        engine.install_prepared_pool_controls_live(prepared(&[target(0.6, 1.7)]), 1, true);
        engine.set_time_fold_scale(1.).unwrap();
        assert_eq!(engine.time_fold_scale(), 1.);
        assert_eq!(engine.voices[0].live_delay, physical);
        assert_eq!(engine.voices[0].live_delay_step, velocity);
        assert_eq!(engine.voices[0].phase, phase);
        assert_eq!(engine.voices[0].gain, gain);
        assert_eq!(engine.history.as_ptr(), history_pointer);
        engine.process_frame([0.08; 2]);
        assert_eq!(
            engine.voices[0].fade, 1.,
            "eligibility fallback stays a single lane at scale 1"
        );
        assert!(engine.voices[0].live_delay > physical);
        let physical = engine.voices[0].live_delay;
        engine.install_prepared_pool_controls(prepared(&[target(0.9, 1.7)]), 1);
        assert!(!engine.live_time_fold);
        assert_eq!(engine.voices[0].delays[engine.voices[0].from], physical);
        engine.process_frame([0.08; 2]);
        assert!(engine.voices[0].fade > 0. && engine.voices[0].fade < 1.);
    }

    #[test]
    fn entering_live_mode_aborts_an_unheard_fade_but_finishes_an_audible_one() {
        let mut engine = pool(&[target(0.2, 1.)], 1, true);
        for _ in 0..1600 {
            engine.process_frame([0.08; 2]);
        }
        engine.voices[0].to = 1;
        engine.voices[0].delays[1] = 0.7;
        engine.voices[0].fade = 0.;
        engine.set_time_fold_scale(1.).unwrap();
        engine.process_frame([0.08; 2]);
        assert_eq!(engine.voices[0].fade, 1.);
        assert_eq!(engine.voices[0].live_delay, 0.2);
        engine.live_time_fold = false;
        engine.install_prepared_pool_controls(prepared(&[target(0.7, 1.)]), 1);
        engine.process_frame([0.08; 2]);
        let audible_fade = engine.voices[0].fade;
        engine.install_prepared_pool_controls_live(prepared(&[target(0.3, 1.)]), 1, true);
        assert_eq!(engine.voices[0].fade, audible_fade);
        for _ in 0..600 {
            engine.process_frame([0.08; 2]);
        }
        assert_eq!(engine.voices[0].fade, 1.);
        assert!(engine.voices[0].live_following);
        assert!(engine.voices[0].live_delay < 0.7);
    }

    #[test]
    fn live_pitch_keeps_base_rates_phases_history_and_existing_rate_bounds() {
        let rates = [0.125, 0.7, 1., 7.9];
        let targets: Vec<_> = rates.iter().map(|&rate| target(0.2, rate)).collect();
        let mut engine = pool(&targets, targets.len(), true);
        for _ in 0..1600 { engine.process_frame([0.08; 2]); }
        let phases: Vec<_> = engine.voices.iter().map(|voice| voice.phase).collect();
        let write = engine.write;
        let history = engine.history.as_ptr();
        engine.set_pitch_offset(24.).unwrap();
        for (voice, phase) in engine.voices.iter().zip(phases) { assert_eq!(voice.phase, phase); }
        assert_eq!(engine.write, write);
        assert_eq!(engine.history.as_ptr(), history);
        for _ in 0..RATE as usize { engine.process_frame([0.08; 2]); }
        for (voice, rate) in engine.voices.iter().zip(rates) {
            assert_eq!(voice.target.rate, rate, "the prepared coefficient is never multiplied in place");
            assert!((voice.rate - (rate * 4.).clamp(0.125, 8.)).abs() < 1e-10);
        }
        engine.set_pitch_offset(-24.).unwrap();
        for _ in 0..RATE as usize { engine.process_frame([0.08; 2]); }
        for (voice, rate) in engine.voices.iter().zip(rates) {
            assert!((voice.rate - (rate * 0.25).clamp(0.125, 8.)).abs() < 1e-10);
        }
        for invalid in [-25., 25., f64::NAN, f64::INFINITY] { assert!(engine.set_pitch_offset(invalid).is_err()); }
        assert_eq!(engine.pitch_offset(), -24.);
        assert_eq!(engine.active_voice_count(), rates.len());
        assert_eq!(engine.history.as_ptr(), history);
    }
}
