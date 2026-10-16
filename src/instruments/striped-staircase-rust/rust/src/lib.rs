//! Four artistic sonifications of worker-sampled Mandelbrot stripe geometry.
//! This is not a physical simulation. The raw ABI has no imports or runtime
//! dependencies. Tables are prepared outside process; the sample clock, phase,
//! white-stripe gates, branch voices, mode crossfades and release envelopes live here.
#![allow(clippy::missing_safety_doc)]

use std::{
    alloc::{alloc_zeroed, dealloc, Layout},
    f64::consts::{PI, TAU},
    slice,
};

const POINTS: usize = 256;
const BRANCHES: usize = 512;
const MAX_IDS: usize = 32768;
const STRIDE: usize = 544 + BRANCHES * 6;
const MAX_FRAMES: usize = 64;
const SINE_SIZE: usize = 4096;
const MODES: usize = 4;
const BODIES: usize = 8;
const MAX_BLOCK: usize = 4096;
type Table = Vec<[f32; STRIDE]>;
const FEATURE_STRIDE: usize = BRANCHES * 6;
const STUDY_DEFAULTS: [f64; 10] = [0., 1., 0., 4., 0., 2., 0., 1., 0., -1.];
type Features = Vec<[f32; FEATURE_STRIDE]>;

#[derive(Clone, Copy, Default)]
struct Note {
    epoch: u64,
    x: f64,
    y: f64,
    heading_x: f64,
    heading_y: f64,
    has_heading: bool,
    offset: f64,
    reference_x: f64,
    reference_y: f64,
    has_reference: bool,
}

fn bounded(value: f64, low: f64, high: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(low, high)
    } else {
        fallback
    }
}
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
fn soften(value: f64) -> f64 {
    value / (1. + value.abs())
}
fn advance(phase: &mut f64, increment: f64) {
    *phase += increment;
    *phase -= phase.floor();
}

pub struct Engine {
    rate: f64,
    table: Table,
    previous: Table,
    frames: usize,
    previous_frames: usize,
    table_mix: f64,
    features: Features,
    feature_frames: usize,
    feature_id: [usize; BRANCHES],
    feature_supported: [bool; BRANCHES],
    feature_mix: [f64; BRANCHES],
    feature_target: [[f64; 4]; BRANCHES],
    feature_current: [[f64; 4]; BRANCHES],
    studies: [f64; 10],
    target_studies: [f64; 10],
    study_active: bool,
    branch_accent: [f64; BRANCHES],
    branch_curve: [f64; BRANCHES],
    shepard_phase: [[f64; 3]; BRANCHES],
    shepard_frequency: [[f64; 3]; BRANCHES],
    shepard_gain: [[f64; 3]; BRANCHES],
    branch_harmonics: [[f64; 5]; BRANCHES],
    branch_rotation: [[f64; 2]; BRANCHES],
    branch_sincos: [[f64; 2]; BRANCHES],
    shepard_position: [f64; BRANCHES],
    shepard_harmonics: [[[f64; 5]; 3]; BRANCHES],
    shepard_rotation: [[[f64; 2]; 3]; BRANCHES],
    shepard_sincos: [[[f64; 2]; 3]; BRANCHES],
    shepard_octave: [i32; BRANCHES],
    sample_clock: u64,
    depth: f64,
    direction: f64,
    playing: bool,
    enabled: bool,
    hold: bool,
    mode: usize,
    weights: [f64; MODES],
    base: f64,
    target_base: f64,
    brightness: f64,
    target_brightness: f64,
    body: f64,
    target_body: f64,
    gain: f64,
    target_gain: f64,
    scan_seconds: f64,
    gate: f64,
    smooth: f64,
    release: f64,
    sine: [f64; SINE_SIZE],
    phase: f64,
    scan_phase: f64,
    branch_phase: [f64; BRANCHES],
    branch_envelope: [f64; BRANCHES],
    focus_first: usize,
    focus_second: usize,
    focus_tracking: bool,
    stripe_gate: bool,
    branch_unfocused_envelope: [f64; BRANCHES],
    branch_target: [f64; BRANCHES],
    branch_frequency: [f64; BRANCHES],
    branch_x: [f64; BRANCHES],
    branch_y: [f64; BRANCHES],
    branch_note_x: [f64; BRANCHES],
    branch_note_y: [f64; BRANCHES],
    branch_presence: [f64; BRANCHES],
    branch_reentry: [bool; BRANCHES],
    branch_id: [usize; BRANCHES],
    branch_parent: [usize; BRANCHES],
    pitch_mapping: u32,
    pitch_span: f64,
    note_epoch: u64,
    notes: Vec<Note>,
    pending_notes: [Note; BRANCHES],
    pending_ids: [usize; BRANCHES],
    voice_state: Vec<f64>,
    branch_count: usize,
    branch_attack: f64,
    branch_decay: f64,
    white_gate: bool,
    white_onsets: u64,
    modal_a: [f64; BODIES],
    modal_b: [f64; BODIES],
    modal_drive: [f64; BODIES],
    modal_y1: [f64; BODIES],
    modal_y2: [f64; BODIES],
    spectrum: [f64; 16],
    metadata: [f64; 16],
    last_scan: [f64; 2],
    trace_low: [f64; 2],
    output_low: [f64; 2],
    dc_input: [f64; 2],
    dc_output: [f64; 2],
    filter_coefficient: f64,
    noise: u32,
    state: [f64; 12],
}

impl Engine {
    fn new(rate: f64) -> Self {
        Self {
            rate,
            table: vec![[0.; STRIDE]; MAX_FRAMES],
            previous: vec![[0.; STRIDE]; MAX_FRAMES],
            frames: 0,
            previous_frames: 0,
            table_mix: 1.,
            features: vec![[0.; FEATURE_STRIDE]; MAX_FRAMES],
            feature_frames: 0,
            feature_id: [0; BRANCHES],
            feature_supported: [false; BRANCHES],
            feature_mix: [0.; BRANCHES],
            feature_target: [[0.; 4]; BRANCHES],
            feature_current: [[0.; 4]; BRANCHES],
            studies: STUDY_DEFAULTS,
            target_studies: STUDY_DEFAULTS,
            study_active: false,
            branch_accent: [1.; BRANCHES],
            branch_curve: [0.; BRANCHES],
            shepard_phase: [[0.; 3]; BRANCHES],
            shepard_frequency: [[0.; 3]; BRANCHES],
            shepard_gain: [[0.; 3]; BRANCHES],
            branch_harmonics: [[0.; 5]; BRANCHES],
            branch_rotation: [[0.; 2]; BRANCHES],
            branch_sincos: [[0.; 2]; BRANCHES],
            shepard_position: [0.; BRANCHES],
            shepard_harmonics: [[[0.; 5]; 3]; BRANCHES],
            shepard_rotation: [[[0.; 2]; 3]; BRANCHES],
            shepard_sincos: [[[0.; 2]; 3]; BRANCHES],
            shepard_octave: [0; BRANCHES],
            sample_clock: 0,
            depth: 0.,
            direction: 1.,
            playing: false,
            enabled: false,
            hold: false,
            mode: 0,
            weights: [1., 0., 0., 0.],
            base: 110.,
            target_base: 110.,
            brightness: 0.55,
            target_brightness: 0.55,
            body: 0.5,
            target_body: 0.5,
            gain: 0.5,
            target_gain: 0.5,
            scan_seconds: 24.,
            gate: 0.,
            smooth: 1. - (-1. / (rate * 0.018)).exp(),
            release: 1. - (-1. / (rate * 0.012)).exp(),
            sine: std::array::from_fn(|index| (TAU * index as f64 / SINE_SIZE as f64).sin()),
            phase: 0.,
            scan_phase: 0.,
            branch_phase: [0.; BRANCHES],
            branch_envelope: [0.; BRANCHES],
            focus_first: 0,
            focus_second: 0,
            focus_tracking: false,
            stripe_gate: true,
            branch_unfocused_envelope: [0.; BRANCHES],
            branch_target: [0.; BRANCHES],
            branch_frequency: [0.; BRANCHES],
            branch_x: [0.; BRANCHES],
            branch_y: [0.; BRANCHES],
            branch_note_x: [0.; BRANCHES],
            branch_note_y: [0.; BRANCHES],
            branch_presence: [0.; BRANCHES],
            branch_reentry: [false; BRANCHES],
            branch_id: [0; BRANCHES],
            branch_parent: [0; BRANCHES],
            pitch_mapping: 0,
            pitch_span: 3.,
            note_epoch: 1,
            notes: vec![Note::default(); MAX_IDS + 1],
            pending_notes: [Note::default(); BRANCHES],
            pending_ids: [0; BRANCHES],
            voice_state: vec![0.; BRANCHES * 6],
            branch_count: 0,
            branch_attack: 1. - (-1. / (rate * 0.004)).exp(),
            branch_decay: 0.,
            white_gate: false,
            white_onsets: 0,
            modal_a: [0.; BODIES],
            modal_b: [0.; BODIES],
            modal_drive: [0.; BODIES],
            modal_y1: [0.; BODIES],
            modal_y2: [0.; BODIES],
            spectrum: [0.; 16],
            metadata: [0.; 16],
            last_scan: [0.; 2],
            trace_low: [0.; 2],
            output_low: [0.; 2],
            dc_input: [0.; 2],
            dc_output: [0.; 2],
            filter_coefficient: 0.,
            noise: 0x71a9_4c23,
            state: [0.; 12],
        }
    }

    fn table_value(table: &Table, count: usize, depth: f64, index: usize) -> f64 {
        if count == 0 {
            return 0.;
        }
        let at = depth * (count - 1) as f64;
        let a = at.floor() as usize;
        let b = (a + 1).min(count - 1);
        lerp(
            table[a][index] as f64,
            table[b][index] as f64,
            at - a as f64,
        )
    }

    fn value(&self, index: usize) -> f64 {
        let next = Self::table_value(&self.table, self.frames, self.depth, index);
        if self.table_mix >= 1. {
            return next;
        }
        lerp(
            Self::table_value(&self.previous, self.previous_frames, self.depth, index),
            next,
            self.table_mix,
        )
    }

    fn branch_value(table: &Table, count: usize, depth: f64, slot: usize, attribute: usize) -> f64 {
        if count == 0 {
            return 0.;
        }
        let at = depth * (count - 1) as f64;
        let a = at.floor() as usize;
        let b = (a + 1).min(count - 1);
        let offset = 544 + slot * 6;
        if table[a][offset + 4] != table[b][offset + 4] {
            return table[at.round() as usize][offset + attribute] as f64;
        }
        lerp(
            table[a][offset + attribute] as f64,
            table[b][offset + attribute] as f64,
            at - a as f64,
        )
    }

    fn contour(&self, phase: f64, channel: usize) -> f64 {
        let at = phase * POINTS as f64;
        let index = at.floor() as usize;
        let offset = channel * POINTS;
        lerp(
            self.value(offset + index % POINTS),
            self.value(offset + (index + 1) % POINTS),
            at - index as f64,
        )
    }

    fn sinusoid(&self, phase: f64) -> f64 {
        let wrapped = phase - phase.floor();
        let at = wrapped * SINE_SIZE as f64;
        let index = at as usize;
        lerp(
            self.sine[index],
            self.sine[(index + 1) % SINE_SIZE],
            at - index as f64,
        )
    }

    fn reset_note_references(&mut self) {
        // The epoch invalidates references without clearing a large ledger on
        // the audio thread. Identity storage is allocated only at construction.
        self.note_epoch = self.note_epoch.wrapping_add(1).max(1);
    }

    fn frame_offset(&self, x: f64, y: f64) -> f64 {
        self.pitch_span * ((0.5 - y) + (x - 0.5)) * 0.5
    }

    fn physical_envelope(&self, index: usize) -> f64 {
        if self.focus_tracking {
            self.branch_unfocused_envelope[index]
        } else {
            self.branch_envelope[index]
        }
    }

    fn focus(&mut self, first: usize, second: usize) -> bool {
        if first > MAX_IDS || second > MAX_IDS || (first == 0 && second != 0) {
            return false;
        }
        if first != 0 && !self.focus_tracking {
            self.branch_unfocused_envelope
                .copy_from_slice(&self.branch_envelope);
            self.focus_tracking = true;
        }
        self.focus_first = first;
        self.focus_second = second;
        true
    }

    fn update_branch_frequencies(&mut self) {
        for index in 0..BRANCHES {
            if self.branch_target[index] == 0. && self.physical_envelope(index) == 0. {
                continue;
            }
            let note = self.notes[self.branch_id[index]];
            let offset = match self.pitch_mapping {
                0 => self.pitch_span * (0.5 - self.branch_y[index]),
                2 if self.branch_id[index] > 0 && note.epoch == self.note_epoch => {
                    (note.offset * self.pitch_span).clamp(-4., 4.)
                }
                _ => self.frame_offset(self.branch_x[index], self.branch_y[index]),
            };
            let previous_frequency = self.branch_frequency[index];
            if self.feature_supported[index]
                && self.feature_mix[index] > 0.
                && (self.studies[0] > 0. || self.studies[4] > 0.)
            {
                let feature = self.feature_current[index];
                let mix = self.feature_mix[index];
                let offset = offset * (1. - mix * self.studies[0].max(self.studies[4]));
                let added = mix
                    * (self.studies[0] * self.studies[1] * feature[0]
                        + self.studies[4] * self.studies[5] * feature[1])
                        .clamp(-6., 6.);
                self.branch_frequency[index] =
                    (self.base * 2_f64.powf(offset + added)).clamp(20., self.rate * 0.42);
            } else {
                // Preserve the original arithmetic, including low registers,
                // exactly when the new pitch studies are disabled.
                self.branch_frequency[index] =
                    (self.base * 2_f64.powf(offset)).min(self.rate * 0.42);
            }
            if previous_frequency > 0.
                && self.feature_mix[index] > 0.
                && self.physical_envelope(index) > 0.
                && (self.studies[0] > 0. || self.studies[4] > 0.)
            {
                // This audio-only transition survives field/identity resets;
                // accepted geometry and note ancestry do not. Bypass keeps its
                // exact historical arithmetic and timing.
                let smoothing = 1. - (-32. / (self.rate * 0.018)).exp();
                self.branch_frequency[index] =
                    lerp(previous_frequency, self.branch_frequency[index], smoothing);
            }
        }
    }

    fn note_events(&mut self, onset: bool) {
        if self.pitch_mapping != 2 {
            return;
        }
        // Read every parent before committing any note from this same onset.
        // A child therefore inherits the parent's previous note regardless of
        // which slot the worker assigned either voice.
        let mut count = 0;
        for index in 0..BRANCHES {
            let id = self.branch_id[index];
            if id == 0 || self.branch_presence[index] <= 0.001 || self.branch_target[index] == 0. {
                continue;
            }
            let previous = self.notes[id];
            if !onset && previous.epoch == self.note_epoch && !self.branch_reentry[index] {
                continue;
            }
            let parent = self.notes[self.branch_parent[index]];
            let reference = if previous.epoch == self.note_epoch {
                previous
            } else if self.branch_parent[index] > 0 && parent.epoch == self.note_epoch {
                parent
            } else {
                Note::default()
            };
            let x = self.branch_note_x[index];
            let y = self.branch_note_y[index];
            let mut next = reference;
            next.epoch = self.note_epoch;
            next.x = x;
            next.y = y;
            next.has_reference = reference.epoch == self.note_epoch;
            next.reference_x = if next.has_reference { reference.x } else { x };
            next.reference_y = if next.has_reference { reference.y } else { y };
            if next.has_reference {
                let dx = x - reference.x;
                let dy = y - reference.y;
                let distance = dx.hypot(dy);
                if distance > 1e-6 {
                    if reference.has_heading {
                        let cross = reference.heading_x * dy - reference.heading_y * dx;
                        let dot = reference.heading_x * dx + reference.heading_y * dy;
                        let turn = cross.atan2(dot);
                        if self.pitch_span > 0. {
                            let current = (reference.offset * self.pitch_span).clamp(-4., 4.);
                            next.offset = (current
                                + turn / PI * (8. * distance).min(1.) * self.pitch_span)
                                .clamp(-4., 4.)
                                / self.pitch_span;
                        }
                    }
                    next.heading_x = dx / distance;
                    next.heading_y = dy / distance;
                    next.has_heading = true;
                }
            } else {
                // Store span-normalized pitch history so live Span edits also
                // retune a held note. Span zero collapses to the register.
                next.offset = ((0.5 - y) + (x - 0.5)) * 0.5;
            }
            self.pending_ids[count] = id;
            self.pending_notes[count] = next;
            self.branch_reentry[index] = false;
            count += 1;
        }
        for index in 0..count {
            self.notes[self.pending_ids[index]] = self.pending_notes[index];
        }
        if count > 0 {
            self.update_branch_frequencies();
        }
    }

    fn observe_voices(&mut self) {
        for index in 0..BRANCHES {
            let at = index * 6;
            let id = self.branch_id[index];
            let note = self.notes[id];
            self.voice_state[at] = id as f64;
            self.voice_state[at + 1] = self.branch_frequency[index];
            self.voice_state[at + 2] = note.reference_x;
            self.voice_state[at + 3] = note.reference_y;
            self.voice_state[at + 4] = (self.pitch_mapping == 2
                && note.epoch == self.note_epoch
                && note.has_reference) as u8 as f64;
            self.voice_state[at + 5] = self.branch_parent[index] as f64;
        }
    }

    fn install(&mut self, data: &[f32], count: usize) -> bool {
        if count > MAX_FRAMES || data.len() != count * STRIDE {
            return false;
        }
        // All storage was reserved at construction; neither upload nor process
        // allocates, destroys a table, or changes the oscillator/sample clocks.
        if self.table_mix >= 1. && self.frames == MAX_FRAMES {
            // Browser fields already have the full 64-frame layout. Once a
            // fade has settled, copying is equivalent to interpolating every
            // value and avoids that extra burst on the audio thread.
            self.previous.copy_from_slice(&self.table);
        } else {
            // Collapse interrupted fades and resample other frame counts into
            // the full-size previous table, preserving the current mixture.
            for frame in 0..MAX_FRAMES {
                let depth = frame as f64 / (MAX_FRAMES - 1) as f64;
                for index in 0..STRIDE {
                    self.previous[frame][index] = lerp(
                        Self::table_value(&self.previous, self.previous_frames, depth, index),
                        Self::table_value(&self.table, self.frames, depth, index),
                        self.table_mix,
                    ) as f32;
                }
            }
        }
        self.previous_frames = MAX_FRAMES;
        for (frame, values) in data.chunks_exact(STRIDE).enumerate() {
            for (index, value) in values.iter().enumerate() {
                // ABI 3 assigns the formerly reserved metadata slot 536 to
                // paired-edge grouping. Only the explicit flag enables it;
                // older zero-filled tables retain independent center voices.
                if index == 536 {
                    self.table[frame][index] = (*value == 1.) as u8 as f32;
                    continue;
                }
                let (low, high) = match index {
                    0..=511 | 530..=531 => (-1., 1.),
                    534 => (0., 1_000_000.),
                    535 => (0.000_001, 1_000_000.),
                    index if index >= 544 && (index - 544) % 6 >= 4 => (0., MAX_IDS as f64),
                    _ => (0., 1.),
                };
                self.table[frame][index] = bounded(*value as f64, low, high, 0.) as f32;
            }
        }
        self.frames = count;
        // The worklet installs the matching sidecar synchronously after this
        // table. A missing sidecar must never reuse the previous scene's IDs.
        self.feature_frames = 0;
        self.feature_id.fill(0);
        self.feature_supported.fill(false);
        self.feature_target.fill([0.; 4]);
        self.feature_current.fill([0.; 4]);
        self.table_mix = 0.;
        self.reset_note_references();
        true
    }

    fn install_features(&mut self, data: &[f32], count: usize) -> bool {
        if count > MAX_FRAMES || count != self.frames || data.len() != count * FEATURE_STRIDE {
            return false;
        }
        for (frame, values) in data.chunks_exact(FEATURE_STRIDE).enumerate() {
            for (slot, record) in values.chunks_exact(6).enumerate() {
                let at = slot * 6;
                let id = record[0];
                self.features[frame][at] =
                    if id.is_finite() && id >= 1. && id <= MAX_IDS as f32 && id.fract() == 0. {
                        id
                    } else {
                        0.
                    };
                for (attribute, (low, high)) in [
                    (-1024., 1024.),
                    (-16., 16.),
                    (0., 1.),
                    (0., 2048.),
                    (0., 1.),
                ]
                .into_iter()
                .enumerate()
                {
                    self.features[frame][at + attribute + 1] =
                        bounded(record[attribute + 1] as f64, low, high, 0.) as f32;
                }
            }
        }
        self.feature_frames = count;
        true
    }

    fn study_controls(&mut self, values: [f64; 10]) {
        for (index, value) in values.into_iter().enumerate() {
            let (low, high) = match index {
                1 => (0., 3.),
                3 => (1., 32.),
                5 | 7 => (0., 4.),
                9 => (-1., 1.),
                _ => (0., 1.),
            };
            self.target_studies[index] = bounded(value, low, high, STUDY_DEFAULTS[index]);
        }
        self.target_studies[9] = if self.target_studies[9] < 0. { -1. } else { 1. };
    }

    fn refresh_features(&mut self) {
        let count = self.feature_frames;
        let position = self.depth * count.saturating_sub(1) as f64;
        let a = position.floor() as usize;
        let b = (a + 1).min(count.saturating_sub(1));
        let nearest = position.round() as usize;
        // Geometry is sampled every 32 audio samples, independently of render
        // cadence. This small slew rounds scene/ID changes and control edits.
        let smoothing = 1. - (-32. / (self.rate * 0.018)).exp();
        for index in 0..BRANCHES {
            let id = self.branch_id[index];
            if self.feature_id[index] != id {
                self.feature_id[index] = id;
                self.feature_supported[index] = false;
                self.feature_target[index] = [0.; 4];
                self.feature_current[index] = [0.; 4];
            }
            if count > 0 && id > 0 {
                let at = index * 6;
                let current = &self.features[nearest];
                if current[at] as usize == id && current[at + 5] > 0. {
                    let first_supported = !self.feature_supported[index];
                    self.feature_supported[index] = true;
                    let interpolate = self.features[a][at] as usize == id
                        && self.features[b][at] as usize == id
                        && self.features[a][at + 5] > 0.
                        && self.features[b][at + 5] > 0.;
                    for attribute in 0..4 {
                        self.feature_target[index][attribute] = if interpolate {
                            lerp(
                                self.features[a][at + attribute + 1] as f64,
                                self.features[b][at + attribute + 1] as f64,
                                position - a as f64,
                            )
                        } else {
                            current[at + attribute + 1] as f64
                        };
                    }
                    if first_supported {
                        // A newborn certified child starts at the inherited
                        // feature/pitch, rather than scooping up from zero.
                        // Audible outgoing oscillators have separate slews.
                        self.feature_current[index] = self.feature_target[index];
                        self.feature_mix[index] = 1.;
                    }
                }
                // Uncertain geometry holds the last accepted values for this
                // identity. It cannot invent turning or borrow a nearby ID.
            } else {
                self.feature_target[index] = [0.; 4];
                self.feature_supported[index] = false;
            }
            self.feature_mix[index] += ((self.feature_supported[index] as u8 as f64)
                - self.feature_mix[index])
                * smoothing;
            if self.feature_mix[index] > 1. - 1e-9 {
                self.feature_mix[index] = 1.;
            } else if !self.feature_supported[index] && self.feature_mix[index] < 1e-9 {
                self.feature_mix[index] = 0.;
            }
            for attribute in 0..4 {
                self.feature_current[index][attribute] += (self.feature_target[index][attribute]
                    - self.feature_current[index][attribute])
                    * smoothing;
            }
            if !self.study_active {
                continue;
            }
            let feature = self.feature_current[index];
            let amount = self.studies[2]
                * self.feature_mix[index]
                * self.feature_supported[index] as u8 as f64;
            let mean = 1. - 0.325 * amount;
            let swing = 0.325 * amount;
            // A full accent keeps ~49% sustain at its trough. Normalize cycle
            // power, not instantaneous audio: black rests remain untouched.
            let accent = (mean + swing * self.sinusoid(feature[3] * self.studies[3] + 0.25))
                / (mean * mean + swing * swing * 0.5).sqrt();
            self.branch_accent[index] += (accent - self.branch_accent[index]) * smoothing;
            let curve =
                self.studies[6] * self.feature_mix[index] * (feature[2] * self.studies[7]).min(1.);
            self.branch_curve[index] += (curve - self.branch_curve[index]) * smoothing;
        }
    }

    fn refresh_shepard(&mut self) {
        if !self.study_active {
            return;
        }
        for index in 0..BRANCHES {
            if self.branch_target[index] == 0. && self.physical_envelope(index) == 0. {
                continue;
            }
            self.branch_harmonics[index] =
                self.harmonics(self.branch_frequency[index], self.branch_curve[index]);
            if self.branch_curve[index] > 0. {
                let (sine, cosine) = (TAU * self.branch_frequency[index] / self.rate).sin_cos();
                self.branch_rotation[index] = [sine, cosine];
                let phase = self.branch_phase[index];
                self.branch_sincos[index] = [self.sinusoid(phase), self.sinusoid(phase + 0.25)];
            }
            if self.studies[8] == 0. {
                continue;
            }
            // Measured absolute turning drives the illusion. No elapsed-time
            // LFO is involved; pausing geometry holds this octave position.
            let position_target = self.studies[9] * self.feature_current[index][3];
            let smoothing = 1. - (-32. / (self.rate * 0.018)).exp();
            self.shepard_position[index] +=
                (position_target - self.shepard_position[index]) * smoothing;
            let position = self.shepard_position[index];
            let octave = position.floor() as i32;
            let shift = octave - self.shepard_octave[index];
            if shift != 0 {
                let previous = self.shepard_phase[index];
                for lane in 0..3 {
                    let from = lane as i32 - shift;
                    self.shepard_phase[index][lane] = if (0..3).contains(&from) {
                        previous[from as usize]
                    } else {
                        0.
                    };
                }
                self.shepard_octave[index] = octave;
            }
            let fraction = position - octave as f64;
            for lane in 0..3 {
                let at = fraction + lane as f64;
                let raw_frequency = self.branch_frequency[index] * 2_f64.powf(at - 1.5);
                self.shepard_frequency[index][lane] = raw_frequency.clamp(20., self.rate * 0.42);
                let frequency = self.shepard_frequency[index][lane];
                self.shepard_harmonics[index][lane] =
                    self.harmonics(frequency, self.branch_curve[index]);
                let increment = TAU * frequency / self.rate;
                let (sine, cosine) = increment.sin_cos();
                self.shepard_rotation[index][lane] = [sine, cosine];
                let phase = self.shepard_phase[index][lane];
                self.shepard_sincos[index][lane] =
                    [self.sinusoid(phase), self.sinusoid(phase + 0.25)];
                // Squared-sine windows have constant sum-of-squares (9/8)
                // across these three overlapping octaves. Outgoing/incoming
                // lanes are zero at wrap, while interior phases are retained.
                let window = self.sinusoid(at / 6.);
                let low = ((raw_frequency - 16.) / 4.).clamp(0., 1.);
                let high = ((self.rate * 0.45 - raw_frequency) / (self.rate * 0.05)).clamp(0., 1.);
                self.shepard_gain[index][lane] = window * window / 1.125_f64.sqrt() * low * high;
            }
        }
    }

    fn harmonics(&self, frequency: f64, curve: f64) -> [f64; 5] {
        let brightness = self.brightness + (1. - self.brightness) * curve;
        let mut coefficients = [
            1.,
            brightness * 0.15,
            brightness * 0.1,
            curve * 0.14,
            curve * 0.112,
        ];
        for (index, coefficient) in coefficients.iter_mut().enumerate() {
            let harmonic = (index + 1) as f64;
            let antialias = if index == 0 {
                1.
            } else {
                ((self.rate * 0.45 - frequency * harmonic) / (self.rate * 0.05)).clamp(0., 1.)
            };
            *coefficient *= antialias / (1. + 0.035 * curve);
        }
        coefficients
    }

    fn harmonic_wave(sine: f64, cosine: f64, coefficients: [f64; 5]) -> f64 {
        // Trigonometric identities evaluate all five harmonics from one phase
        // pair. Octave oscillators rotate this pair per sample and re-anchor
        // every geometry refresh to keep cost bounded without phase drift.
        let square = sine * sine;
        sine * coefficients[0]
            + 2. * sine * cosine * coefficients[1]
            + sine * (3. - 4. * square) * coefficients[2]
            + 4. * sine * cosine * (1. - 2. * square) * coefficients[3]
            + sine * (16. * square * square - 20. * square + 5.) * coefficients[4]
    }

    fn controls(
        &mut self,
        mode: u32,
        base: f64,
        brightness: f64,
        body: f64,
        gain: f64,
        seconds: f64,
    ) {
        self.mode = (mode as usize).min(MODES - 1);
        if self.gate == 0. {
            self.weights = std::array::from_fn(|index| (index == self.mode) as u8 as f64);
        }
        self.target_base = bounded(base, 20., 1200., 110.);
        self.target_brightness = bounded(brightness, 0., 1., 0.55);
        self.target_body = bounded(body, 0., 1., 0.5);
        self.target_gain = bounded(gain, 0., 1., 0.5);
        self.scan_seconds = bounded(seconds, 2., 200., 24.);
    }

    fn refresh(&mut self) {
        for index in 0..16 {
            self.metadata[index] = self.value(528 + index);
        }
        let mut total = 0.;
        for index in 0..16 {
            let harmonic = (index + 1) as f64;
            let tilt = (-(index as f64) * (1. - self.brightness) * 0.65).exp();
            let antialias =
                ((self.rate * 0.45 - harmonic * self.base) / (self.rate * 0.05)).clamp(0., 1.);
            self.spectrum[index] = self.value(512 + index) * tilt * antialias;
            total += self.spectrum[index] * self.spectrum[index];
        }
        // Preserve relative band areas while keeping comparisons at a useful
        // level. Empty spectra remain silent rather than inventing a fundamental.
        let norm = total.sqrt().max(0.12);
        for amplitude in &mut self.spectrum {
            *amplitude /= norm;
        }
        let mass = self.metadata[0];
        let perimeter = self.metadata[1];
        let roughness = self.metadata[5];
        for index in 0..BODIES {
            let n = index as f64;
            let ratio = 1. + n * (0.37 + perimeter * 0.83) + n * n * (0.013 + roughness * 0.047);
            let frequency = (self.base * (0.75 + mass * 0.8) * ratio).min(self.rate * 0.42);
            let decay = 0.035 + self.body * 1.4 / (1. + n * 0.19);
            let radius = (-1. / (self.rate * decay)).exp();
            let angle = TAU * frequency / self.rate;
            self.modal_a[index] = 2. * radius * angle.cos();
            self.modal_b[index] = radius * radius;
            self.modal_drive[index] =
                angle.sin() * (1. - radius).sqrt() * (0.4 + self.spectrum[index] * 0.6);
        }
        let mut branch_weight = 0.;
        self.branch_count = 0;
        for index in 0..BRANCHES {
            let at = 544 + index * 6;
            let previous_id = self.branch_id[index];
            let was_present = self.branch_presence[index] > 0.001;
            let raw: [f64; 4] = std::array::from_fn(|attribute| {
                Self::branch_value(&self.table, self.frames, self.depth, index, attribute)
            });
            let shape: [f64; 4] = if self.table_mix >= 1. {
                raw
            } else {
                std::array::from_fn(|attribute| {
                    lerp(
                        Self::branch_value(
                            &self.previous,
                            self.previous_frames,
                            self.depth,
                            index,
                            attribute,
                        ),
                        raw[attribute],
                        self.table_mix,
                    )
                })
            };
            let presence = shape[0];
            let length = shape[3];
            self.branch_target[index] = presence * length;
            branch_weight += self.branch_target[index];
            self.branch_x[index] = shape[1];
            self.branch_y[index] = shape[2];
            self.branch_note_x[index] = raw[1];
            self.branch_note_y[index] = raw[2];
            self.branch_presence[index] = raw[0];
            // Identity is categorical, never interpolated with geometry or
            // across a scene replacement. Zero is the empty/unknown identity.
            let frame = (self.depth * self.frames.saturating_sub(1) as f64).round() as usize;
            self.branch_id[index] = if self.frames > 0 {
                self.table[frame][at + 4] as usize
            } else {
                0
            };
            self.branch_parent[index] = if self.frames > 0 {
                self.table[frame][at + 5] as usize
            } else {
                0
            };
            // Certification can disappear while the physical tendril ID
            // persists. Its return during an already-white stripe is another
            // note using its own prior reference, not a continuation of the old
            // pitch. Latch until noted so a paused return is not lost.
            self.branch_reentry[index] = raw[0] > 0.001
                && (self.branch_reentry[index]
                    || !was_present
                    || previous_id != self.branch_id[index]);
            self.branch_count += (presence > 0.5 && length > 0.) as usize;
        }
        // Normalize predicted power rather than coherent peak amplitude, so
        // independent tones do not disappear as the field becomes denser.
        // Pair weights combine before squaring: coincident edges retain their
        // original tendril level, and each edge still receives half its weight.
        // The incoming categorical flag is never blended during scene changes.
        let frame = (self.depth * self.frames.saturating_sub(1) as f64).round() as usize;
        let paired = self.frames > 0 && self.table[frame][536] == 1.;
        let power = if paired {
            self.branch_target
                .chunks_exact(2)
                .map(|pair| (pair[0] + pair[1]).powi(2))
                .sum::<f64>()
        } else {
            self.branch_target
                .iter()
                .map(|weight| weight * weight)
                .sum::<f64>()
        };
        // Preserve vanishing-field attenuation and cap density compensation at
        // 12 dB. This depends only on geometry, never audio level or stripe rests.
        let norm = power.sqrt().max(branch_weight / 4.).max(0.08);
        for target in &mut self.branch_target {
            *target /= norm;
        }
        self.refresh_features();
        self.update_branch_frequencies();
        self.refresh_shepard();
        // Release is the time to -80 dB, keeping black stripes perceptible even
        // at the longest setting. Attack remains a short 4 ms smoothing time.
        self.branch_decay = (-9.210_340_372 / (self.rate * (0.008 + self.body * 0.152))).exp();
        let cutoff = 180. * (60_f64).powf(self.brightness);
        self.filter_coefficient = 1. - (-TAU * cutoff.min(self.rate * 0.4) / self.rate).exp();
    }

    fn observe(&mut self) {
        self.state = [
            self.sample_clock as f64,
            self.depth,
            self.direction,
            self.playing as u8 as f64,
            self.enabled as u8 as f64,
            self.hold as u8 as f64,
            self.mode as f64,
            self.frames as f64,
            self.white_onsets as f64,
            self.table_mix,
            self.branch_count as f64,
            self.white_gate as u8 as f64,
        ];
    }

    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (left, right) in left.iter_mut().zip(right) {
            self.base += (self.target_base - self.base) * self.smooth;
            self.brightness += (self.target_brightness - self.brightness) * self.smooth;
            self.body += (self.target_body - self.body) * self.smooth;
            self.gain += (self.target_gain - self.gain) * self.smooth;
            self.study_active = false;
            for index in 0..10 {
                self.studies[index] +=
                    (self.target_studies[index] - self.studies[index]) * self.smooth;
                if (self.target_studies[index] - self.studies[index]).abs() < 1e-9 {
                    self.studies[index] = self.target_studies[index];
                }
                if index % 2 == 0 {
                    if self.target_studies[index] == 0. && self.studies[index] < 1e-9 {
                        self.studies[index] = 0.;
                    }
                    self.study_active |= self.studies[index] > 0.;
                }
            }
            for index in 0..MODES {
                self.weights[index] +=
                    ((index == self.mode) as u8 as f64 - self.weights[index]) * self.smooth;
            }
            if self.playing && !self.hold {
                self.depth += self.direction / (self.rate * self.scan_seconds);
                if self.depth > 1. {
                    self.depth = 2. - self.depth;
                    self.direction = -1.;
                }
                if self.depth < 0. {
                    self.depth = -self.depth;
                    self.direction = 1.;
                }
            }
            self.table_mix = (self.table_mix + 1. / (self.rate * 0.06)).min(1.);
            // Evaluate the gate before refreshing branch geometry. An onset
            // must read identities/coordinates from this exact sample, rather
            // than first noting a stale parent and then treating its successor
            // as a child on the next periodic refresh.
            let threshold = Self::table_value(&self.table, self.frames, self.depth, 534);
            let period =
                Self::table_value(&self.table, self.frames, self.depth, 535).max(0.000_001);
            let bucket = (threshold / period * 2.).floor() as i64;
            let white = self.frames > 0 && bucket.rem_euclid(2) == 1;
            let onset = white && !self.white_gate;
            let refreshed = self.sample_clock % 32 == 0 || onset;
            if refreshed {
                self.refresh();
            }
            let valid = self.metadata[4].clamp(0., 1.);
            let gate_target = if self.playing && self.enabled {
                valid
            } else {
                0.
            };
            self.gate += (gate_target - self.gate) * self.release;
            if self.gate < 1e-9 && gate_target == 0. {
                self.gate = 0.;
            }

            advance(&mut self.phase, self.base / self.rate);
            advance(&mut self.scan_phase, self.base / (self.rate * 64.));
            let x = self.contour(self.phase, 0);
            let y = self.contour(self.phase, 1);
            let contour_scale = 0.7 / (0.15 + self.metadata[1] * 2.);
            for (channel, sample) in [x, y].into_iter().enumerate() {
                self.trace_low[channel] +=
                    (sample - self.trace_low[channel]) * self.filter_coefficient;
            }
            let trace = [
                self.trace_low[0] * contour_scale,
                self.trace_low[1] * contour_scale,
            ];
            let mut harmonic = [0.; 2];
            for index in 0..16 {
                let amplitude = self.spectrum[index] * 0.24;
                harmonic[0] += amplitude * self.sinusoid(self.phase * (index + 1) as f64);
                harmonic[1] += amplitude
                    * self.sinusoid(
                        self.phase * (index + 1) as f64 + self.metadata[2] * index as f64 * 0.04,
                    );
            }

            // White sustains; black releases. The gate uses incoming scene
            // thresholds directly, without inventing runs between scene depths.
            if onset && self.playing && valid > 0.5 && self.table_mix >= 1. {
                self.white_onsets += 1;
            }
            if white && self.playing && (onset || refreshed) {
                self.note_events(onset);
                if self.pitch_mapping == 2 {
                    self.refresh_shepard();
                }
            }
            self.white_gate = white;
            let mut rhythm = [0.; 2];
            for index in 0..BRANCHES {
                let physical_target = if white || !self.stripe_gate {
                    self.branch_target[index]
                } else {
                    0.
                };
                let physical_active = physical_target != 0. || self.physical_envelope(index) != 0.;
                let id = self.branch_id[index];
                let selected = self.focus_first == 0
                    || id == self.focus_first
                    || (self.focus_second != 0 && id == self.focus_second);
                // Selection follows normalization. It never boosts a surviving
                // pair or substitutes a nearby ID when the selected one ends.
                let target = if selected { physical_target } else { 0. };
                if self.focus_tracking {
                    if physical_target > self.branch_unfocused_envelope[index] {
                        self.branch_unfocused_envelope[index] += (physical_target
                            - self.branch_unfocused_envelope[index])
                            * self.branch_attack;
                    } else {
                        self.branch_unfocused_envelope[index] = physical_target
                            + (self.branch_unfocused_envelope[index] - physical_target)
                                * self.branch_decay;
                    }
                    if physical_target == 0. && self.branch_unfocused_envelope[index] < 1e-9 {
                        self.branch_unfocused_envelope[index] = 0.;
                    }
                }
                if !physical_active && target == 0. && self.branch_envelope[index] == 0. {
                    continue;
                }
                if target > self.branch_envelope[index] {
                    self.branch_envelope[index] +=
                        (target - self.branch_envelope[index]) * self.branch_attack;
                } else {
                    self.branch_envelope[index] =
                        target + (self.branch_envelope[index] - target) * self.branch_decay;
                }
                if target == 0. && self.branch_envelope[index] < 1e-9 {
                    self.branch_envelope[index] = 0.;
                }
                advance(
                    &mut self.branch_phase[index],
                    self.branch_frequency[index] / self.rate,
                );
                let audible = self.branch_envelope[index] != 0.;
                let phase = self.branch_phase[index];
                let endless = self.studies[8] * self.feature_mix[index];
                let mut wave = 0.;
                if endless < 1. {
                    if self.study_active && self.branch_curve[index] > 0. {
                        let [sine, cosine] = self.branch_sincos[index];
                        let [rotation_sine, rotation_cosine] = self.branch_rotation[index];
                        let next_sine = sine * rotation_cosine + cosine * rotation_sine;
                        let next_cosine = cosine * rotation_cosine - sine * rotation_sine;
                        self.branch_sincos[index] = [next_sine, next_cosine];
                        if audible {
                            wave = Self::harmonic_wave(
                                next_sine,
                                next_cosine,
                                self.branch_harmonics[index],
                            );
                        }
                    } else if audible {
                        // Deliberately retain the exact legacy arithmetic in
                        // bypass, rather than changing the original waveform.
                        wave = self.sinusoid(phase);
                        for harmonic in 2..=3 {
                            let antialias = ((self.rate * 0.45
                                - self.branch_frequency[index] * harmonic as f64)
                                / (self.rate * 0.05))
                                .clamp(0., 1.);
                            wave += self.sinusoid(phase * harmonic as f64) * self.brightness * 0.3
                                / harmonic as f64
                                * antialias;
                        }
                    }
                }
                if self.study_active {
                    if endless > 0. {
                        let mut bank = 0.;
                        for lane in 0..3 {
                            advance(
                                &mut self.shepard_phase[index][lane],
                                self.shepard_frequency[index][lane] / self.rate,
                            );
                            let [sine, cosine] = self.shepard_sincos[index][lane];
                            let [rotation_sine, rotation_cosine] =
                                self.shepard_rotation[index][lane];
                            let next_sine = sine * rotation_cosine + cosine * rotation_sine;
                            let next_cosine = cosine * rotation_cosine - sine * rotation_sine;
                            self.shepard_sincos[index][lane] = [next_sine, next_cosine];
                            if audible {
                                bank += Self::harmonic_wave(
                                    next_sine,
                                    next_cosine,
                                    self.shepard_harmonics[index][lane],
                                ) * self.shepard_gain[index][lane];
                            }
                        }
                        wave = lerp(wave, bank, endless);
                    }
                    wave *= self.branch_accent[index];
                }
                let sample = wave * self.branch_envelope[index] * 0.65;
                // Every branch stays centered at the former center-pan level.
                // Position contributes to pitch and note history only.
                rhythm[0] += sample * 0.5;
                rhythm[1] += sample * 0.5;
            }

            let scan = [
                self.contour(self.scan_phase, 0),
                self.contour(self.scan_phase, 1),
            ];
            self.noise ^= self.noise << 13;
            self.noise ^= self.noise >> 17;
            self.noise ^= self.noise << 5;
            let noise = self.noise as f64 / u32::MAX as f64 * 2. - 1.;
            let motion = ((scan[0] - self.last_scan[0]).abs()
                + (scan[1] - self.last_scan[1]).abs())
                * self.rate
                / self.base;
            self.last_scan = scan;
            let excitation = noise * (0.035 + motion.min(3.) * 0.14) * valid;
            let mut resonant = [0.; 2];
            for index in 0..BODIES {
                let value = (self.modal_a[index] * self.modal_y1[index]
                    - self.modal_b[index] * self.modal_y2[index]
                    + excitation * self.modal_drive[index])
                    .clamp(-3., 3.);
                self.modal_y2[index] = self.modal_y1[index];
                self.modal_y1[index] = value;
                resonant[index % 2] += value * 0.7;
                resonant[(index + 1) % 2] += value * 0.3;
            }
            let mut output = [0.; 2];
            for channel in 0..2 {
                let mixed = trace[channel] * self.weights[0]
                    + harmonic[channel] * self.weights[1]
                    + rhythm[channel] * self.weights[2] * 6.
                    + resonant[channel] * self.weights[3] * 8.;
                self.output_low[channel] +=
                    (mixed - self.output_low[channel]) * self.filter_coefficient;
                let high = self.output_low[channel] - self.dc_input[channel]
                    + 0.997 * self.dc_output[channel];
                self.dc_input[channel] = self.output_low[channel];
                self.dc_output[channel] = high;
                output[channel] = soften(high * 1.6) * 0.89 * self.gain * self.gate;
            }
            *left = output[0] as f32;
            *right = output[1] as f32;
            self.sample_clock += 1;
        }
        self.observe();
    }
}

#[no_mangle]
pub extern "C" fn stair_abi_version() -> u32 {
    3
}
#[no_mangle]
pub extern "C" fn stair_state_len() -> usize {
    12
}
#[no_mangle]
pub extern "C" fn stair_voice_capacity() -> usize {
    BRANCHES
}
#[no_mangle]
pub unsafe extern "C" fn stair_voice_state(engine: *mut Engine) -> *const f64 {
    let Some(engine) = engine.as_mut() else {
        return std::ptr::null();
    };
    engine.observe_voices();
    engine.voice_state.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn stair_pitch(engine: *mut Engine, mapping: u32, span: f64) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    let mapping = mapping.min(2);
    if mapping != engine.pitch_mapping {
        engine.pitch_mapping = mapping;
        engine.reset_note_references();
    }
    engine.pitch_span = bounded(span, 0., 6., 3.);
    1
}
#[no_mangle]
pub extern "C" fn stair_alloc(bytes: usize) -> *mut u8 {
    let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) else {
        return std::ptr::null_mut();
    };
    unsafe { alloc_zeroed(layout) }
}
#[no_mangle]
pub unsafe extern "C" fn stair_free(pointer: *mut u8, bytes: usize) {
    if !pointer.is_null() {
        if let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) {
            dealloc(pointer, layout);
        }
    }
}
#[no_mangle]
pub extern "C" fn stair_new(rate: f64) -> *mut Engine {
    if !rate.is_finite() || !(8000. ..=192000.).contains(&rate) {
        return std::ptr::null_mut();
    }
    Box::into_raw(Box::new(Engine::new(rate)))
}
#[no_mangle]
pub unsafe extern "C" fn stair_drop(engine: *mut Engine) {
    if !engine.is_null() {
        drop(Box::from_raw(engine));
    }
}
#[no_mangle]
pub unsafe extern "C" fn stair_table(
    engine: *mut Engine,
    pointer: *const f32,
    length: usize,
    count: usize,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    if length > MAX_FRAMES * STRIDE || (pointer.is_null() && length != 0) {
        return 0;
    }
    let data = if length == 0 {
        &[]
    } else {
        slice::from_raw_parts(pointer, length)
    };
    engine.install(data, count) as u32
}
#[no_mangle]
pub unsafe extern "C" fn stair_features(
    engine: *mut Engine,
    pointer: *const f32,
    length: usize,
    count: usize,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    if length > MAX_FRAMES * FEATURE_STRIDE || (pointer.is_null() && length != 0) {
        return 0;
    }
    let data = if length == 0 {
        &[]
    } else {
        slice::from_raw_parts(pointer, length)
    };
    engine.install_features(data, count) as u32
}

#[no_mangle]
pub unsafe extern "C" fn stair_studies(
    engine: *mut Engine,
    turn_amount: f64,
    turn_span: f64,
    accent_amount: f64,
    accent_rate: f64,
    fork_amount: f64,
    fork_span: f64,
    curvature_amount: f64,
    curvature_drive: f64,
    endless_amount: f64,
    endless_direction: f64,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    engine.study_controls([
        turn_amount,
        turn_span,
        accent_amount,
        accent_rate,
        fork_amount,
        fork_span,
        curvature_amount,
        curvature_drive,
        endless_amount,
        endless_direction,
    ]);
    1
}

#[no_mangle]
pub unsafe extern "C" fn stair_gate(engine: *mut Engine, enabled: u32) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    engine.stripe_gate = enabled != 0;
    1
}

#[no_mangle]
pub unsafe extern "C" fn stair_focus(engine: *mut Engine, first_id: u32, second_id: u32) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    engine.focus(first_id as usize, second_id as usize) as u32
}

#[no_mangle]
pub unsafe extern "C" fn stair_controls(
    engine: *mut Engine,
    mode: u32,
    base: f64,
    brightness: f64,
    body: f64,
    gain: f64,
    seconds: f64,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    engine.controls(mode, base, brightness, body, gain, seconds);
    1
}
#[no_mangle]
pub unsafe extern "C" fn stair_transport(
    engine: *mut Engine,
    playing: u32,
    enabled: u32,
    hold: u32,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    engine.playing = playing != 0;
    engine.enabled = enabled != 0;
    engine.hold = hold != 0;
    engine.observe();
    1
}
#[no_mangle]
pub unsafe extern "C" fn stair_seek(engine: *mut Engine, depth: f64, direction: f64) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    engine.depth = bounded(depth, 0., 1., engine.depth);
    engine.direction = if direction.is_finite() && direction < 0. {
        -1.
    } else {
        1.
    };
    engine.reset_note_references();
    engine.observe();
    1
}
#[no_mangle]
pub unsafe extern "C" fn stair_process(
    engine: *mut Engine,
    left: *mut f32,
    right: *mut f32,
    frames: usize,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };
    if left.is_null() || right.is_null() || frames > MAX_BLOCK || left == right {
        return 0;
    }
    engine.process(
        slice::from_raw_parts_mut(left, frames),
        slice::from_raw_parts_mut(right, frames),
    );
    1
}
#[no_mangle]
pub unsafe extern "C" fn stair_state(engine: *mut Engine) -> *const f64 {
    let Some(engine) = engine.as_mut() else {
        return std::ptr::null();
    };
    engine.observe();
    engine.state.as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{alloc::System, cell::Cell};
    struct Counting;
    thread_local! { static TRACK: Cell<bool> = const { Cell::new(false) }; static OPS: Cell<usize> = const { Cell::new(0) }; }
    unsafe impl std::alloc::GlobalAlloc for Counting {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            TRACK.with(|t| {
                if t.get() {
                    OPS.with(|n| n.set(n.get() + 1));
                }
            });
            System.alloc(layout)
        }
        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            TRACK.with(|t| {
                if t.get() {
                    OPS.with(|n| n.set(n.get() + 1));
                }
            });
            System.dealloc(pointer, layout)
        }
    }
    #[global_allocator]
    static ALLOCATOR: Counting = Counting;

    #[test]
    fn octave_wrap_preserves_interior_phase_and_wave_in_both_directions() {
        let mut engine = Engine::new(48000.);
        engine.study_active = true;
        engine.studies[8] = 1.;
        engine.branch_target[0] = 1.;
        engine.branch_frequency[0] = 73.;
        for direction in [-1., 1.] {
            engine.studies[9] = direction;
            let before = direction * (1. - 1e-7);
            let after = direction * (1. + 1e-7);
            engine.shepard_octave[0] = before.floor() as i32;
            engine.shepard_phase[0] = [0.13, 0.37, 0.71];
            let mut samples = [0.; 2];
            for (index, position) in [before, after].into_iter().enumerate() {
                engine.feature_current[0][3] = position * direction;
                engine.shepard_position[0] = position;
                engine.refresh_shepard();
                for lane in 0..3 {
                    let phase = engine.shepard_phase[0][lane];
                    samples[index] += Engine::harmonic_wave(
                        engine.sinusoid(phase),
                        engine.sinusoid(phase + 0.25),
                        engine.shepard_harmonics[0][lane],
                    ) * engine.shepard_gain[0][lane];
                }
            }
            assert!(
                (samples[1] - samples[0]).abs() < 1e-5,
                "octave wrap changed waveform: {samples:?}"
            );
            if direction > 0. {
                assert_eq!(engine.shepard_phase[0], [0., 0.13, 0.37]);
            } else {
                assert_eq!(engine.shepard_phase[0], [0.37, 0.71, 0.]);
            }
        }
    }

    #[test]
    fn octave_components_outside_the_audible_band_fade_before_frequency_clamping() {
        let mut engine = Engine::new(48000.);
        engine.study_active = true;
        engine.studies[8] = 1.;
        engine.branch_target[0] = 1.;
        engine.branch_frequency[0] = 20.;
        engine.refresh_shepard();
        assert_eq!(engine.shepard_gain[0][0], 0.);
        assert_eq!(engine.shepard_gain[0][1], 0.);
        assert!(engine.shepard_gain[0][2] > 0.);
        engine.branch_frequency[0] = engine.rate * 0.42;
        engine.refresh_shepard();
        assert_eq!(engine.shepard_gain[0][2], 0.);
        assert!(engine.shepard_gain[0][1] > 0.);
    }

    #[test]
    fn focus_preserves_normalization_note_history_and_all_oscillator_phases() {
        let mut a = Engine::new(48000.);
        let mut b = Engine::new(48000.);
        let mut table = vec![0.; MAX_FRAMES * STRIDE];
        let mut features = vec![0.; MAX_FRAMES * FEATURE_STRIDE];
        for frame in 0..MAX_FRAMES {
            let depth = frame as f32 / 63.;
            table[frame * STRIDE + 532] = 1.;
            table[frame * STRIDE + 534] = 0.25 + depth * 4.;
            table[frame * STRIDE + 535] = 1.;
            table[frame * STRIDE + 536] = 1.;
            for slot in 0..4 {
                let at = frame * STRIDE + 544 + slot * 6;
                table[at..at + 6].copy_from_slice(&[
                    1.,
                    0.2 + slot as f32 * 0.2,
                    depth,
                    0.2,
                    (slot + 1) as f32,
                    0.,
                ]);
                let at = frame * FEATURE_STRIDE + slot * 6;
                features[at..at + 6].copy_from_slice(&[
                    (slot + 1) as f32,
                    depth * 0.5,
                    depth * 0.2,
                    0.8,
                    depth * 4.,
                    1.,
                ]);
            }
        }
        for engine in [&mut a, &mut b] {
            assert!(engine.install(&table, MAX_FRAMES));
            assert!(engine.install_features(&features, MAX_FRAMES));
            engine.controls(2, 73., 0.55, 0.15, 0.75, 2.);
            engine.study_controls([1., 1., 1., 4., 1., 2., 1., 1., 1., -1.]);
            engine.pitch_mapping = 2;
            engine.playing = true;
            engine.enabled = true;
        }
        let mut left = [0.; 128];
        let mut right = [0.; 128];
        for block in 0..400 {
            if block == 64 {
                assert!(b.focus(1, 2));
            }
            if block == 164 {
                assert!(b.focus(3, 4));
            }
            if block == 264 {
                assert!(b.focus(30000, 0));
            }
            if block == 364 {
                assert!(b.focus(0, 0));
            }
            a.process(&mut left, &mut right);
            b.process(&mut left, &mut right);
            assert_eq!(
                a.branch_target, b.branch_target,
                "focus changed global normalization"
            );
            assert_eq!(
                a.branch_frequency, b.branch_frequency,
                "focus changed carrier history"
            );
            assert_eq!(
                a.branch_phase, b.branch_phase,
                "focus stopped an underlying oscillator"
            );
            assert_eq!(
                a.shepard_phase, b.shepard_phase,
                "focus stopped an octave oscillator"
            );
            assert_eq!(a.sample_clock, b.sample_clock);
            assert_eq!(a.white_onsets, b.white_onsets);
            if (64..164).contains(&block) {
                assert_eq!(a.branch_envelope[0], b.branch_envelope[0]);
                assert_eq!(a.branch_envelope[1], b.branch_envelope[1]);
            }
            for id in 1..=4 {
                assert_eq!(a.notes[id].offset, b.notes[id].offset);
            }
        }
    }

    #[test]
    fn callback_and_recall_do_not_allocate_or_deallocate() {
        let mut engine = Engine::new(48000.);
        let mut table = vec![0.; MAX_FRAMES * STRIDE];
        for frame in 0..MAX_FRAMES {
            table[frame * STRIDE + 532] = 1.;
            table[frame * STRIDE + 534] = frame as f32 * 4.;
            table[frame * STRIDE + 535] = 1.;
            for index in 0..BRANCHES {
                let at = frame * STRIDE + 544 + index * 6;
                table[at] = if index % 2 == 0 || frame >= 16 {
                    1.
                } else {
                    0.
                };
                table[at + 1] = index as f32 / BRANCHES as f32;
                table[at + 2] = frame as f32 / MAX_FRAMES as f32;
                table[at + 3] = 0.2;
                table[at + 4] = (index + 1) as f32;
                table[at + 5] = if index % 2 == 1 { index as f32 } else { 0. };
            }
        }
        let mut features = vec![0.; MAX_FRAMES * FEATURE_STRIDE];
        for frame in 0..MAX_FRAMES {
            for index in 0..BRANCHES {
                let at = frame * FEATURE_STRIDE + index * 6;
                features[at..at + 6].copy_from_slice(&[
                    (index + 1) as f32,
                    frame as f32 / 32.,
                    index as f32 / 512.,
                    0.8,
                    frame as f32 / 16.,
                    1.,
                ]);
            }
        }
        let mut left = [0.; 128];
        let mut right = [0.; 128];
        OPS.with(|n| n.set(0));
        TRACK.with(|t| t.set(true));
        engine.install(&table, MAX_FRAMES);
        engine.install_features(&features, MAX_FRAMES);
        engine.study_controls([1., 1., 1., 4., 1., 2., 1., 1., 1., -1.]);
        engine.controls(2, 220., 0.8, 0.6, 0.5, 2.);
        engine.pitch_mapping = 2;
        engine.playing = true;
        engine.enabled = true;
        for block in 0..1000 {
            if block == 200 {
                assert!(engine.focus(1, 2));
            }
            if block == 500 {
                assert!(engine.focus(3, 4));
                engine.stripe_gate = false;
            }
            if block == 800 {
                assert!(engine.focus(0, 0));
            }
            engine.process(&mut left, &mut right);
        }
        engine.observe_voices();
        engine.reset_note_references();
        engine.install(&table, MAX_FRAMES);
        TRACK.with(|t| t.set(false));
        assert_eq!(OPS.with(Cell::get), 0);
    }
}
