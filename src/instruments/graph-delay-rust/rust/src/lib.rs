//! Consolidated, genuinely cyclic graph delay. Delay reads precede all graph
//! writes, so directed cycles retain sample causality at every sample rate.
//! The audio callback allocates/frees no memory and shares pitch histories only
//! between turns of the same incoming edge. Scene storage is initialized in
//! bounded maintenance steps, while the previous scene continues rendering.
#![allow(clippy::missing_safety_doc)]
use std::alloc::{alloc, dealloc, Layout};
use std::f64::consts::{FRAC_PI_2, PI};
use std::slice;

const NODES: usize = 64;
const EDGES: usize = 256;
const SOURCES: usize = EDGES + NODES;
const ROUTES: usize = 512;
const BLOCK: usize = 128;
const WINDOW: usize = 4096;
type Stereo = [f64; 2];

fn finite(x: f64) -> f64 {
    if x.is_finite() {
        x
    } else {
        0.
    }
}
fn smooth(x: f64, target: f64, amount: f64) -> f64 {
    x + (target - x) * amount
}
fn hash(mut value: u32) -> f64 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb352d);
    value ^= value >> 15;
    (f64::from(value) + 0.5) / 4294967296.
}
fn read(history: &[f32], base: usize, length: usize, position: usize, delay: f64) -> Stereo {
    let mut p = position as f64 - delay;
    if p < 0. {
        p += length as f64;
    }
    let first = p as usize % length;
    let next = if first + 1 == length { 0 } else { first + 1 };
    let mix = p.fract();
    let a = base + first * 2;
    let b = base + next * 2;
    [
        f64::from(history[a]) + f64::from(history[b] - history[a]) * mix,
        f64::from(history[a + 1]) + f64::from(history[b + 1] - history[a + 1]) * mix,
    ]
}
#[derive(Clone, Copy, Default)]
struct Edge {
    from: usize,
    to: usize,
    feedback: bool,
    delay: f64,
    target_delay: f64,
    gain: f64,
    target_gain: f64,
    gate: f64,
    target_gate: f64,
    z1: Stereo,
    z2: Stereo,
}
#[derive(Clone, Copy, Default)]
struct Entry {
    node: usize,
    delay: f64,
    target_delay: f64,
    gain: f64,
}
#[derive(Clone, Copy, Default)]
struct Node {
    pan: f64,
    target_pan: f64,
    tap: f64,
    target_tap: f64,
    left: f64,
    right: f64,
}
#[derive(Clone, Copy, Default)]
struct Route {
    source: usize,
    edge: usize,
    target_semitones: f64,
    semitones: f64,
    ratio: f64,
    ratio_delta: f64,
    phase: f64,
    shifted: f64,
    shifted_delta: f64,
    direct: f64,
    direct_delta: f64,
    mix: f64,
}
struct Network {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    entries: Vec<Entry>,
    routes: Vec<Route>,
    history: Vec<f32>,
    history_size: usize,
    delay_length: usize,
    pitch_length: usize,
    pitch_base: usize,
    write: usize,
    pitch_write: usize,
    sources: [Stereo; SOURCES],
    sums: [Stereo; NODES],
    sends: [Stereo; EDGES],
    node_peaks: [f64; NODES],
    edge_peaks: [f64; EDGES],
    rate: f64,
    grain: f64,
    mix: [f64; 4],
    target_mix: [f64; 4],
    damping: f64,
    pitch_slew: f64,
    filter: [f64; 5],
    target_filter: [f64; 5],
    startup_seconds: f64,
    ready: bool,
    age: u64,
    smoothing: f64,
}
impl Network {
    fn counts(plan: &[f64]) -> Option<[usize; 4]> {
        if plan.len() < 16 || plan[0] != 1. || plan.iter().any(|value| !value.is_finite()) {
            return None;
        }
        let c = [
            plan[1] as usize,
            plan[2] as usize,
            plan[3] as usize,
            plan[4] as usize,
        ];
        if c[0] == 0
            || c[0] > NODES
            || c[1] > EDGES
            || c[2] == 0
            || c[2] > c[0]
            || c[3] > ROUTES
            || plan.len() != 16 + c[0] * 2 + c[1] * 6 + c[2] * 3 + c[3] * 4
        {
            return None;
        }
        Some(c)
    }
    fn new(plan: &[f64], rate: f64) -> Option<Self> {
        let [n, e, i, r] = Self::counts(plan)?;
        let delay_length = (rate * 2.01).ceil() as usize + 8;
        let pitch_length = ((rate * 0.11).round() as usize + 8).next_power_of_two();
        let pitch_base = (e + i) * delay_length * 2;
        let history_size = pitch_base + (e + i) * pitch_length * 2;
        // Bound memory on high-rate devices independently of CPU route count.
        if history_size > 64 * 1024 * 1024 {
            return None;
        }
        let mut history = Vec::new();
        history.try_reserve_exact(history_size).ok()?;
        let mut result = Self {
            nodes: vec![Node::default(); n],
            edges: vec![Edge::default(); e],
            entries: vec![Entry::default(); i],
            routes: vec![Route::default(); r],
            history,
            history_size,
            delay_length,
            pitch_length,
            pitch_base,
            write: 0,
            pitch_write: 0,
            sources: [[0.; 2]; SOURCES],
            sums: [[0.; 2]; NODES],
            sends: [[0.; 2]; EDGES],
            node_peaks: [0.; NODES],
            edge_peaks: [0.; EDGES],
            rate,
            grain: (rate * 0.11).round(),
            mix: [0.; 4],
            target_mix: [0.; 4],
            damping: 4800.,
            pitch_slew: 0.165,
            filter: [0.; 5],
            target_filter: [0.; 5],
            startup_seconds: 0.15,
            ready: false,
            age: 0,
            smoothing: 1. - (-1. / (rate * 0.025)).exp(),
        };
        if !result.controls(plan, true) {
            return None;
        }
        Some(result)
    }
    fn controls(&mut self, plan: &[f64], initial: bool) -> bool {
        let Some([n, e, i, r]) = Self::counts(plan) else {
            return false;
        };
        if [n, e, i, r]
            != [
                self.nodes.len(),
                self.edges.len(),
                self.entries.len(),
                self.routes.len(),
            ]
        {
            return false;
        }
        let mut at = 16 + n * 2;
        for edge in &self.edges {
            if plan[at] as usize >= n
                || plan[at + 1] as usize >= n
                || (!initial
                    && (edge.from != plan[at] as usize
                        || edge.to != plan[at + 1] as usize
                        || edge.feedback != (plan[at + 5] != 0.)))
            {
                return false;
            }
            at += 6;
        }
        for entry in &self.entries {
            if plan[at] as usize >= n || (!initial && entry.node != plan[at] as usize) {
                return false;
            }
            at += 3;
        }
        for route in &self.routes {
            if plan[at] as usize >= e + i
                || plan[at + 1] as usize >= e
                || (!initial
                    && (route.source != plan[at] as usize || route.edge != plan[at + 1] as usize))
            {
                return false;
            }
            at += 4;
        }
        self.target_mix = [
            plan[5].clamp(0., 1.5),
            plan[6].clamp(0., 1.5),
            plan[7].clamp(0., 1.),
            plan[8].clamp(0., 0.9),
        ];
        if initial {
            self.mix = self.target_mix;
        }
        self.damping = plan[9].clamp(250., self.rate * 0.45);
        self.pitch_slew = plan[10].clamp(0.01, 0.6);
        let omega = 2. * PI * self.damping / self.rate;
        let cos = omega.cos();
        let alpha = omega.sin() / 0.9;
        self.startup_seconds = plan[11].clamp(0., 40.);
        self.target_filter = [
            (1. - cos) * 0.5 / (1. + alpha),
            (1. - cos) / (1. + alpha),
            (1. - cos) * 0.5 / (1. + alpha),
            -2. * cos / (1. + alpha),
            (1. - alpha) / (1. + alpha),
        ];
        if initial {
            self.filter = self.target_filter;
        }
        at = 16;
        for node in &mut self.nodes {
            node.target_pan = plan[at].clamp(-1., 1.);
            node.target_tap = plan[at + 1].clamp(0., 1.);
            if initial {
                node.pan = node.target_pan;
                node.tap = node.target_tap;
            }
            at += 2;
        }
        for edge in &mut self.edges {
            edge.from = plan[at] as usize;
            edge.to = plan[at + 1] as usize;
            edge.target_delay = plan[at + 2].clamp(0.004, 2.) * self.rate;
            edge.target_gain = plan[at + 3].clamp(0., 1.);
            edge.target_gate = plan[at + 4].clamp(0., 16.);
            edge.feedback = plan[at + 5] != 0.;
            if initial {
                edge.delay = edge.target_delay;
                edge.gain = edge.target_gain;
                edge.gate = edge.target_gate;
            }
            at += 6;
        }
        for entry in &mut self.entries {
            entry.node = plan[at] as usize;
            entry.target_delay = plan[at + 1].clamp(0.004, 2.) * self.rate;
            entry.gain = plan[at + 2].clamp(0., 1.);
            if initial {
                entry.delay = entry.target_delay;
            }
            at += 3;
        }
        for route in &mut self.routes {
            route.source = plan[at] as usize;
            route.edge = plan[at + 1] as usize;
            route.target_semitones = plan[at + 2].clamp(-48., 48.);
            if initial {
                route.phase = hash(plan[at + 3] as u32);
                route.ratio = 1.;
                route.direct = 1.;
            }
            at += 4;
        }
        true
    }
    fn prepare(&mut self, samples: usize) -> bool {
        let count = samples.min(self.history_size - self.history.len());
        self.history.resize(self.history.len() + count, 0.);
        self.ready = self.history.len() == self.history_size;
        self.ready
    }
    fn begin_block(&mut self, frames: usize) {
        self.node_peaks.fill(0.);
        self.edge_peaks.fill(0.);
        let amount = 1. - (-(frames as f64) / (self.rate * 0.025)).exp();
        for (coefficient, target) in self.filter.iter_mut().zip(self.target_filter) {
            *coefficient = smooth(*coefficient, target, amount);
        }
        for node in &mut self.nodes {
            node.pan = smooth(node.pan, node.target_pan, amount);
            node.tap = smooth(node.tap, node.target_tap, amount);
            let angle = if node.pan <= 0. {
                node.pan + 1.
            } else {
                node.pan
            } * FRAC_PI_2;
            node.left = angle.cos();
            node.right = angle.sin();
        }
        let pitch = 1. - (-(frames as f64) / (self.rate * self.pitch_slew)).exp();
        let bypass = 1. - (-(frames as f64) / (self.rate * 0.02)).exp();
        for route in &mut self.routes {
            route.semitones = smooth(route.semitones, route.target_semitones, pitch);
            let end_ratio = 2f64.powf(route.semitones / 12.);
            route.ratio_delta = (end_ratio - route.ratio) / frames as f64;
            let x = ((route.semitones.abs() - 0.08) / 1.12).clamp(0., 1.);
            route.mix = smooth(route.mix, x * x * (3. - 2. * x), bypass);
            let (end_direct, end_shifted) = if route.mix <= 0.0001 {
                (1., 0.)
            } else if route.mix >= 0.9999 {
                (0., 1.)
            } else {
                ((route.mix * FRAC_PI_2).cos(), (route.mix * FRAC_PI_2).sin())
            };
            route.direct_delta = (end_direct - route.direct) / frames as f64;
            route.shifted_delta = (end_shifted - route.shifted) / frames as f64;
        }
    }
    fn frame(&mut self, input: Stereo, window: &[f64; WINDOW]) -> Stereo {
        self.sums.fill([0.; 2]);
        self.sends.fill([0.; 2]);
        let amount = self.smoothing;
        for index in 0..4 {
            self.mix[index] = smooth(self.mix[index], self.target_mix[index], amount);
        }
        let input = [input[0] * self.mix[0], input[1] * self.mix[0]];
        // Read every delayed source first. No cycle can read a future write.
        for (index, edge) in self.edges.iter_mut().enumerate() {
            edge.delay = smooth(edge.delay, edge.target_delay, amount);
            edge.gain = smooth(edge.gain, edge.target_gain, amount);
            edge.gate = smooth(edge.gate, edge.target_gate, amount);
            let mut value = if edge.delay > self.age as f64 {
                [0.; 2]
            } else {
                read(
                    &self.history,
                    index * self.delay_length * 2,
                    self.delay_length,
                    self.write,
                    edge.delay,
                )
            };
            for (channel, sample) in value.iter_mut().enumerate() {
                *sample *= edge.gain;
                if edge.feedback {
                    let output = self.filter[0] * *sample + edge.z1[channel];
                    edge.z1[channel] =
                        self.filter[1] * *sample - self.filter[3] * output + edge.z2[channel];
                    edge.z2[channel] = self.filter[2] * *sample - self.filter[4] * output;
                    *sample = output;
                }
                *sample = finite(*sample).clamp(-32., 32.);
                self.sums[edge.to][channel] += *sample;
            }
            self.sources[index] = value;
            self.edge_peaks[index] = self.edge_peaks[index]
                .max(value[0].abs())
                .max(value[1].abs());
        }
        for (index, entry) in self.entries.iter_mut().enumerate() {
            entry.delay = smooth(entry.delay, entry.target_delay, amount);
            let source = self.edges.len() + index;
            let value = if entry.delay > self.age as f64 {
                [0.; 2]
            } else {
                read(
                    &self.history,
                    source * self.delay_length * 2,
                    self.delay_length,
                    self.write,
                    entry.delay,
                )
            };
            self.sources[source] = [value[0] * entry.gain, value[1] * entry.gain];
            for (channel, sample) in input.iter().enumerate() {
                self.sums[entry.node][channel] += self.sources[source][channel];
                self.history[source * self.delay_length * 2 + self.write * 2 + channel] =
                    *sample as f32;
            }
        }
        // Share a 110 ms history between all turns from this incoming source.
        for index in 0..self.edges.len() + self.entries.len() {
            let base = self.pitch_base + (index * self.pitch_length + self.pitch_write) * 2;
            self.history[base] = self.sources[index][0] as f32;
            self.history[base + 1] = self.sources[index][1] as f32;
        }
        let next_pitch = (self.pitch_write + 1) & (self.pitch_length - 1);
        for route in &mut self.routes {
            let source = self.sources[route.source];
            let mut value = [source[0] * route.direct, source[1] * route.direct];
            if route.shifted > 0. {
                let alternate = (route.phase + 0.5).fract();
                let first = (if route.ratio > 1. {
                    1. - route.phase
                } else {
                    route.phase
                }) * self.grain
                    + 4.;
                let second = (if route.ratio > 1. {
                    1. - alternate
                } else {
                    alternate
                }) * self.grain
                    + 4.;
                let base = self.pitch_base + route.source * self.pitch_length * 2;
                let a = if first > (self.age + 1) as f64 {
                    [0.; 2]
                } else {
                    read(&self.history, base, self.pitch_length, next_pitch, first)
                };
                let b = if second > (self.age + 1) as f64 {
                    [0.; 2]
                } else {
                    read(&self.history, base, self.pitch_length, next_pitch, second)
                };
                let wa = window[(route.phase * WINDOW as f64) as usize % WINDOW];
                let wb = window[(alternate * WINDOW as f64) as usize % WINDOW];
                for channel in 0..2 {
                    value[channel] += (a[channel] * wa + b[channel] * wb) * route.shifted;
                }
                route.phase = (route.phase + (1. - route.ratio).abs() / self.grain).fract();
            }
            route.ratio += route.ratio_delta;
            route.direct += route.direct_delta;
            route.shifted += route.shifted_delta;
            for (channel, sample) in value.iter().enumerate() {
                self.sends[route.edge][channel] += sample;
            }
        }
        for (index, edge) in self.edges.iter().enumerate() {
            let base = (index * self.delay_length + self.write) * 2;
            for channel in 0..2 {
                self.history[base + channel] =
                    finite(self.sends[index][channel] * edge.gate).clamp(-32., 32.) as f32;
            }
        }
        let mut wet = [0.; 2];
        for (index, node) in self.nodes.iter().enumerate() {
            let value = self.sums[index];
            self.node_peaks[index] = self.node_peaks[index]
                .max(value[0].abs())
                .max(value[1].abs());
            // Preserve stereo with the Web Audio equal-power balance law.
            if node.pan <= 0. {
                wet[0] += (value[0] + value[1] * node.left) * node.tap;
                wet[1] += value[1] * node.right * node.tap;
            } else {
                wet[0] += value[0] * node.left * node.tap;
                wet[1] += (value[1] + value[0] * node.right) * node.tap;
            }
        }
        self.write += 1;
        if self.write == self.delay_length {
            self.write = 0;
        }
        self.pitch_write = next_pitch;
        self.age = self.age.saturating_add(1);
        [
            (wet[0] * self.mix[1] + input[0] * self.mix[2]) * self.mix[3],
            (wet[1] * self.mix[1] + input[1] * self.mix[2]) * self.mix[3],
        ]
    }
}

pub struct Engine {
    rate: f64,
    active: Option<Network>,
    pending: Option<Network>,
    old: Option<Network>,
    retired: Option<Network>,
    window: [f64; WINDOW],
    fade: f64,
    warm: usize,
    enabled: f64,
    target_enabled: f64,
    elapsed: u64,
    envelope: f64,
    metrics: [f64; 16],
    node_levels: [f32; NODES],
    edge_levels: [f32; EDGES],
}
impl Engine {
    fn new(rate: f64) -> Self {
        Self {
            rate,
            active: None,
            pending: None,
            old: None,
            retired: None,
            window: std::array::from_fn(|i| (PI * i as f64 / WINDOW as f64).sin().powi(2)),
            fade: 1.,
            warm: 0,
            enabled: 0.,
            target_enabled: 0.,
            elapsed: 0,
            envelope: 0.,
            metrics: [0.; 16],
            node_levels: [0.; NODES],
            edge_levels: [0.; EDGES],
        }
    }
    fn plan(&mut self, plan: &[f64]) -> bool {
        if let Some(active) = &mut self.active {
            if active.controls(plan, false) {
                self.pending = None;
                return true;
            }
        }
        if let Some(pending) = &mut self.pending {
            if pending.controls(plan, false) {
                return true;
            }
        }
        let Some(next) = Network::new(plan, self.rate) else {
            return false;
        };
        self.pending = Some(next);
        true
    }
    fn prepare(&mut self, samples: usize) -> bool {
        self.retired = None;
        if let Some(pending) = &mut self.pending {
            if !pending.prepare(samples) {
                return false;
            }
        } else {
            return true;
        }
        if self.old.is_some() {
            return false;
        }
        self.old = self.active.take();
        self.active = self.pending.take();
        self.fade = if self.old.is_some() { 0. } else { 1. };
        self.warm = if self.old.is_some() {
            (self.rate * self.active.as_ref().map_or(0.15, |net| net.startup_seconds)) as usize
        } else {
            0
        };
        true
    }
    fn process(
        &mut self,
        left: &[f32],
        right: &[f32],
        out_left: &mut [f32],
        out_right: &mut [f32],
    ) {
        if let Some(net) = &mut self.active {
            net.begin_block(left.len());
        }
        if let Some(net) = &mut self.old {
            net.begin_block(left.len());
        }
        let smoothing = 1. - (-1. / (self.rate * 0.025)).exp();
        let attack = 1. - (-1. / (self.rate * 0.008)).exp();
        let release = 1. - (-1. / (self.rate * 0.18)).exp();
        let mut input_peak = 0f64;
        let mut output_peak = 0f64;
        for i in 0..left.len() {
            let input = [finite(f64::from(left[i])), finite(f64::from(right[i]))];
            input_peak = input_peak.max(input[0].abs()).max(input[1].abs());
            let mut value = self
                .active
                .as_mut()
                .map_or([0.; 2], |net| net.frame(input, &self.window));
            if let Some(old) = &mut self.old {
                let old_value = old.frame(input, &self.window);
                for channel in 0..2 {
                    value[channel] =
                        value[channel] * self.fade + old_value[channel] * (1. - self.fade);
                }
                if self.warm > 0 {
                    self.warm -= 1;
                } else {
                    self.fade = (self.fade + 1. / (self.rate * 0.3)).min(1.);
                }
            }
            self.enabled = smooth(self.enabled, self.target_enabled, smoothing);
            let peak = value[0].abs().max(value[1].abs());
            self.envelope = smooth(
                self.envelope,
                peak,
                if peak > self.envelope {
                    attack
                } else {
                    release
                },
            );
            let threshold = 10f64.powf(-10. / 20.);
            let gain = if self.envelope > threshold {
                (self.envelope / threshold).powf(1. / 6. - 1.)
            } else {
                1.
            };
            for sample in &mut value {
                *sample =
                    ((*sample * gain * self.enabled * 1.65).tanh() / 1.65f64.tanh()).clamp(-1., 1.);
                output_peak = output_peak.max(sample.abs());
            }
            out_left[i] = value[0] as f32;
            out_right[i] = value[1] as f32;
        }
        if self.old.is_some() && self.fade >= 1. {
            self.retired = self.old.take();
        }
        self.elapsed += left.len() as u64;
        self.metrics[0] = self.elapsed as f64 / self.rate;
        self.metrics[1] = input_peak;
        self.metrics[2] = output_peak;
        if let Some(net) = &self.active {
            self.metrics[3] = net.nodes.len() as f64;
            self.metrics[4] = net.edges.len() as f64;
            self.metrics[5] = net.routes.len() as f64;
            for i in 0..NODES {
                self.node_levels[i] =
                    (f64::from(self.node_levels[i]) * 0.8).max(net.node_peaks[i]) as f32;
            }
            for i in 0..EDGES {
                self.edge_levels[i] =
                    (f64::from(self.edge_levels[i]) * 0.8).max(net.edge_peaks[i]) as f32;
            }
        }
    }
}
#[no_mangle]
pub extern "C" fn gdr_abi_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn gdr_alloc(bytes: usize) -> *mut u8 {
    Layout::from_size_align(bytes.max(1), 8)
        .ok()
        .map_or(std::ptr::null_mut(), |layout| unsafe { alloc(layout) })
}
#[no_mangle]
pub unsafe extern "C" fn gdr_free(pointer: *mut u8, bytes: usize) {
    if !pointer.is_null() {
        if let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) {
            dealloc(pointer, layout)
        }
    }
}
#[no_mangle]
pub extern "C" fn gdr_new(rate: f64) -> *mut Engine {
    if !(8000. ..=192000.).contains(&rate) {
        return std::ptr::null_mut();
    }
    Box::into_raw(Box::new(Engine::new(rate)))
}
#[no_mangle]
pub unsafe extern "C" fn gdr_drop(engine: *mut Engine) {
    if !engine.is_null() {
        drop(Box::from_raw(engine));
    }
}
#[no_mangle]
pub unsafe extern "C" fn gdr_plan(engine: *mut Engine, plan: *const f64, count: usize) -> u32 {
    if engine.is_null() || plan.is_null() || count > 8192 {
        return 0;
    }
    u32::from((*engine).plan(slice::from_raw_parts(plan, count)))
}
#[no_mangle]
pub unsafe extern "C" fn gdr_prepare(engine: *mut Engine, samples: usize) -> u32 {
    u32::from((*engine).prepare(samples.min(65536)))
}
#[no_mangle]
pub unsafe extern "C" fn gdr_enabled(engine: *mut Engine, enabled: u32) {
    (*engine).target_enabled = f64::from(enabled != 0);
}
#[no_mangle]
pub unsafe extern "C" fn gdr_clear(engine: *mut Engine) {
    let engine = &mut *engine;
    for network in [&mut engine.active, &mut engine.pending, &mut engine.old]
        .into_iter()
        .flatten()
    {
        // Logical history reset is constant-time in history length. Older
        // samples cannot be read until overwritten after this epoch.
        network.age = 0;
        for edge in &mut network.edges {
            edge.z1 = [0.; 2];
            edge.z2 = [0.; 2];
        }
    }
    engine.envelope = 0.;
    engine.node_levels.fill(0.);
    engine.edge_levels.fill(0.);
}
#[no_mangle]
pub unsafe extern "C" fn gdr_process(
    engine: *mut Engine,
    left: *const f32,
    right: *const f32,
    out_left: *mut f32,
    out_right: *mut f32,
    frames: usize,
) -> u32 {
    if engine.is_null() || frames == 0 || frames > BLOCK {
        return 0;
    }
    (*engine).process(
        slice::from_raw_parts(left, frames),
        slice::from_raw_parts(right, frames),
        slice::from_raw_parts_mut(out_left, frames),
        slice::from_raw_parts_mut(out_right, frames),
    );
    1
}
#[no_mangle]
pub unsafe extern "C" fn gdr_metrics(engine: *mut Engine) -> *const f64 {
    (*engine).metrics.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn gdr_node_levels(engine: *mut Engine) -> *const f32 {
    (*engine).node_levels.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn gdr_edge_levels(engine: *mut Engine) -> *const f32 {
    (*engine).edge_levels.as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::{GlobalAlloc, System};
    use std::cell::Cell;
    thread_local! {
        static TRACK: Cell<bool> = const { Cell::new(false) };
        static OPERATIONS: Cell<usize> = const { Cell::new(0) };
    }
    struct CountAllocator;
    fn allocation() {
        if TRACK.try_with(Cell::get).unwrap_or(false) {
            let _ = OPERATIONS.try_with(|count| count.set(count.get() + 1));
        }
    }
    unsafe impl GlobalAlloc for CountAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            allocation();
            System.alloc(layout)
        }
        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            allocation();
            System.alloc_zeroed(layout)
        }
        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            allocation();
            System.dealloc(pointer, layout)
        }
        unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            allocation();
            System.realloc(pointer, layout, size)
        }
    }
    #[global_allocator]
    static ALLOCATOR: CountAllocator = CountAllocator;
    fn plan() -> Vec<f64> {
        let mut plan = vec![
            1., 2., 1., 1., 1., 1., 1., 0., 0.5, 4800., 0.03, 0.144, 0., 0., 0., 0.,
        ];
        plan.extend([0., 0., 0., 0.9]); // nodes
        plan.extend([0., 1., 0.02, 1., 1., 0.]); // edge
        plan.extend([0., 0.004, 1.]); // input
        plan.extend([1., 0., 12., 17.]); // one independently pitched turn
        plan
    }
    fn engine() -> Engine {
        let mut engine = Engine::new(48000.);
        assert!(engine.plan(&plan()));
        while !engine.prepare(65536) {}
        engine.target_enabled = 1.;
        engine
    }
    #[test]
    fn process_and_clear_neither_allocate_nor_free() {
        let mut engine = engine();
        let left = [0.08; 128];
        let right = [0.04; 128];
        let mut a = [0.; 128];
        let mut b = [0.; 128];
        engine.process(&left, &right, &mut a, &mut b);
        OPERATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for _ in 0..64 {
            engine.process(&left, &right, &mut a, &mut b);
        }
        unsafe {
            gdr_clear(&mut engine);
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(OPERATIONS.with(Cell::get), 0);
        assert!(a.iter().all(|value| value.is_finite()));
    }
    #[test]
    fn all_silence_is_exact_silence_with_pitch_enabled() {
        let mut engine = engine();
        let mut a = [0.; 128];
        let mut b = [0.; 128];
        for _ in 0..100 {
            engine.process(&[0.; 128], &[0.; 128], &mut a, &mut b);
            assert_eq!(a, [0.; 128]);
            assert_eq!(b, [0.; 128]);
        }
    }
    #[test]
    fn coefficient_edit_keeps_storage_and_sample_clock() {
        let mut engine = engine();
        let pointer = engine.active.as_ref().unwrap().history.as_ptr();
        let mut a = [0.; 128];
        let mut b = [0.; 128];
        engine.process(&[0.1; 128], &[0.; 128], &mut a, &mut b);
        let mut next = plan();
        next[22] = 0.2;
        assert!(engine.plan(&next));
        assert_eq!(engine.active.as_ref().unwrap().history.as_ptr(), pointer);
        assert_eq!(engine.elapsed, 128);
        assert!(engine.pending.is_none());
    }
    #[test]
    fn rejected_controls_leave_the_playing_scene_intact() {
        let mut engine = engine();
        let mut invalid = plan();
        invalid[20] = 999.;
        assert!(!engine.plan(&invalid));
        assert_eq!(engine.active.as_ref().unwrap().edges[0].from, 0);
        invalid = plan();
        invalid[5] = f64::NAN;
        assert!(!engine.plan(&invalid));
    }
    #[test]
    fn preparer_never_initializes_more_than_its_allowance() {
        let mut engine = Engine::new(48000.);
        assert!(engine.plan(&plan()));
        assert!(!engine.prepare(7));
        assert_eq!(engine.pending.as_ref().unwrap().history.len(), 7);
        assert!(engine.active.is_none());
    }
}
