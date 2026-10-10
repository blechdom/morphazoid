//! Two-way travelling histories follow the actual drawn graph. Resonance retains
//! equal-impedance Kirchhoff scattering. Path echoes uses positive, nonbacktracking
//! routing, geometry-pitched arrivals and turn-dependent tonal loss. Both are
//! artistic interpretations rather than acoustically validated fractal rooms.
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::f64::consts::TAU;
use std::mem::MaybeUninit;

const MAX_EDGES: usize = 16384;
const WAVEFORM: usize = 32;
const PITCH_WINDOW: usize = 2048;
const METRICS: usize = 14;
const MAX_RESERVE_MS: f64 = 2000.;
const FADE_SECONDS: f64 = 0.064;
const PREPARE_FRAMES: usize = 8192;
// These floors are far below useful modulation precision or audible pressure.
// They bound follower release and prevent silent histories retaining denormals.
const FOLLOW_EPSILON: f64 = 1e-12;
const WAVE_FLOOR: f64 = 1e-20;
fn follow(current: &mut f64, target: f64, coefficient: f64) {
    let difference = target - *current;
    if difference.abs() <= FOLLOW_EPSILON {
        *current = target;
    } else {
        *current += difference * coefficient;
    }
}
fn flush_small(value: f64) -> f64 {
    if value.abs() < WAVE_FLOOR {
        0.
    } else {
        value
    }
}

#[derive(Clone, Deserialize)]
struct Point {
    id: u32,
    x: f64,
    y: f64,
}
#[derive(Clone, Deserialize)]
struct Link {
    id: u32,
    a: usize,
    b: usize,
    length: f64,
}
#[derive(Clone, Deserialize)]
struct Port {
    node: usize,
    weight: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scene {
    nodes: Vec<Point>,
    edges: Vec<Link>,
    input_node: usize,
    pickup_node: usize,
    #[serde(default)]
    input_ports: Option<Vec<Port>>,
    #[serde(default)]
    pickup_ports: Option<Vec<Port>>,
    #[serde(default = "reserve_default")]
    reserve_time_ms: f64,
    #[serde(default = "memory_default")]
    memory_budget_bytes: usize,
}
fn reserve_default() -> f64 {
    MAX_RESERVE_MS
}
fn memory_default() -> usize {
    256 * 1024 * 1024
}
fn ring_size(length: f64, rate: f64, reserve: f64) -> usize {
    (length * rate * reserve * 1.25 / 1000.).ceil().max(1.) as usize + 4
}
fn validate_ports(
    ports: Option<&[Port]>,
    legacy: usize,
    degrees: &[usize],
    input: bool,
) -> Result<(), &'static str> {
    let Some(ports) = ports else {
        return if degrees[legacy] > 0 {
            Ok(())
        } else {
            Err("Disconnected input or pickup")
        };
    };
    if ports.is_empty() {
        return Err("Input and pickup ports must be nonempty");
    }
    let mut nodes = HashSet::new();
    let mut norm = 0.;
    for port in ports {
        if port.node >= degrees.len()
            || degrees[port.node] == 0
            || !port.weight.is_finite()
            || !nodes.insert(port.node)
        {
            return Err("Invalid, disconnected or duplicate input/pickup port");
        }
        norm += if input {
            port.weight * port.weight
        } else {
            port.weight.abs()
        };
    }
    if !norm.is_finite() || norm <= 0. || norm > 1. + 1e-6 {
        return Err("Input ports exceed L2 or pickup ports exceed L1 normalization");
    }
    Ok(())
}
fn set_port_targets(targets: &mut [f64], ports: Option<&[Port]>, legacy: usize) {
    targets.fill(0.);
    if let Some(ports) = ports {
        for port in ports {
            targets[port.node] = port.weight;
        }
    } else {
        targets[legacy] = 1.;
    }
}
fn validate(scene: &Scene, rate: f64) -> Result<usize, &'static str> {
    if scene.nodes.is_empty()
        || scene.nodes.len() > MAX_EDGES + 1
        || scene.edges.is_empty()
        || scene.edges.len() > MAX_EDGES
        || scene.input_node >= scene.nodes.len()
        || scene.pickup_node >= scene.nodes.len()
        || !scene.reserve_time_ms.is_finite()
        || !(0.05..=MAX_RESERVE_MS).contains(&scene.reserve_time_ms)
    {
        return Err("Invalid complete graph or delay reservation");
    }
    let mut ids = HashSet::new();
    if scene
        .nodes
        .iter()
        .any(|p| !p.x.is_finite() || !p.y.is_finite() || !ids.insert(p.id))
    {
        return Err("Invalid or duplicate node");
    }
    ids.clear();
    let mut degrees = vec![0; scene.nodes.len()];
    let mut bytes = 0usize;
    for e in &scene.edges {
        if e.a >= scene.nodes.len()
            || e.b >= scene.nodes.len()
            || e.a == e.b
            || !e.length.is_finite()
            || !(0.00001..=16.).contains(&e.length)
            || !ids.insert(e.id)
        {
            return Err("Invalid or duplicate edge");
        }
        degrees[e.a] += 1;
        degrees[e.b] += 1;
        bytes = bytes
            .checked_add(ring_size(e.length, rate, scene.reserve_time_ms) * 8)
            .ok_or("Delay memory overflow")?;
    }
    validate_ports(
        scene.input_ports.as_deref(),
        scene.input_node,
        &degrees,
        true,
    )?;
    validate_ports(
        scene.pickup_ports.as_deref(),
        scene.pickup_node,
        &degrees,
        false,
    )?;
    if bytes > scene.memory_budget_bytes {
        return Err("Complete graph exceeds reserved delay memory budget");
    }
    Ok(bytes)
}

#[derive(Clone)]
struct Direction {
    ratio: f64,
    ratio_target: f64,
    phase: f64,
    mix: f64,
    coefficient: f64,
    coefficient_target: f64,
    tone: f64,
}
impl Direction {
    fn new(phase: f64) -> Self {
        Self {
            ratio: 1.,
            ratio_target: 1.,
            phase,
            mix: 0.,
            coefficient: 1.,
            coefficient_target: 1.,
            tone: 0.,
        }
    }
    fn inherit(&mut self, old: &Self) {
        self.ratio = old.ratio;
        self.phase = old.phase;
        self.mix = old.mix;
        self.coefficient = old.coefficient;
        self.tone = old.tone;
    }
    fn window(window: &[f64; PITCH_WINDOW], phase: f64) -> f64 {
        let position = phase * PITCH_WINDOW as f64;
        let first = position as usize;
        let fraction = position - first as f64;
        let a = window[first & (PITCH_WINDOW - 1)];
        a + (window[(first + 1) & (PITCH_WINDOW - 1)] - a) * fraction
    }
    fn sample(
        &self,
        history: &[f32],
        write: usize,
        delay: f64,
        grain: f64,
        window: &[f64; PITCH_WINDOW],
    ) -> f64 {
        if self.mix == 0. || grain < 1. {
            return Edge::read(history, write, delay);
        }
        let other = (self.phase + 0.5).fract();
        // One orientation for both directions of transposition: crossing unity
        // never flips either read head to another location in the history.
        let first = 1. - self.phase;
        let second = 1. - other;
        let weight = Self::window(window, self.phase);
        // Every grain lies BEHIND the geometric arrival, never ahead of it.
        // The adaptive span uses existing 25% reserved history headroom.
        let pitched = Edge::read(history, write, delay + grain * (0.25 + first)) * weight
            + Edge::read(history, write, delay + grain * (0.25 + second)) * (1. - weight);
        if self.mix == 1. {
            pitched
        } else {
            Edge::read(history, write, delay) * (1. - self.mix) + pitched * self.mix
        }
    }
    fn advance(&mut self, path_mix: f64, grain: f64, smooth: f64) {
        follow(&mut self.ratio, self.ratio_target, smooth);
        let target = if grain >= 1. && (self.ratio_target - 1.).abs() > 0.0005 {
            path_mix
        } else {
            0.
        };
        follow(&mut self.mix, target, smooth);
        if grain >= 1. && self.mix > 0. {
            let phase = self.phase + (self.ratio - 1.) / grain;
            self.phase = phase - phase.floor();
        }
    }
    fn color(&mut self, value: f64, path_mix: f64, smooth: f64) -> f64 {
        follow(&mut self.coefficient, self.coefficient_target, smooth);
        self.tone = if self.coefficient == 1. {
            value
        } else {
            flush_small(self.tone + (value - self.tone) * self.coefficient)
        };
        if path_mix == 0. {
            value
        } else {
            value * (1. - path_mix) + self.tone * path_mix
        }
    }
}

#[derive(Clone)]
struct Edge {
    link: Link,
    ab: Vec<f32>,
    ba: Vec<f32>,
    write: usize,
    delay: f64,
    delay_velocity: f64,
    incoming_ab: f64,
    incoming_ba: f64,
    loss: f64,
    loss_target: f64,
    direction: [f64; 2],
    turn: [f64; 2],
    travel: [Direction; 2],
    grain: f64,
    level: f32,
    history_source: Option<usize>,
    history_clock: u64,
}
impl Edge {
    fn cache_direction(&mut self, nodes: &[Point]) {
        let a = &nodes[self.link.a];
        let b = &nodes[self.link.b];
        let length = (b.x - a.x).hypot(b.y - a.y);
        self.direction = if length > 1e-12 {
            [(b.x - a.x) / length, (b.y - a.y) / length]
        } else {
            [0.; 2]
        };
    }
    fn read(buffer: &[f32], write: usize, delay: f64) -> f64 {
        let size = buffer.len();
        let position = (write as f64 - delay.clamp(1., (size - 2) as f64)).rem_euclid(size as f64);
        let i = position.floor() as usize;
        let fraction = position - i as f64;
        f64::from(buffer[i]) * (1. - fraction) + f64::from(buffer[(i + 1) % size]) * fraction
    }
    fn at(&self, distance_from_a: f64, window: &[f64; PITCH_WINDOW]) -> f64 {
        // Endpoints use the arrivals actually routed by the previous sample.
        // Interior traces sample those same travelling histories/read laws.
        if distance_from_a == 0. {
            return Self::read(&self.ab, self.write, 1.) + self.incoming_ba;
        }
        if distance_from_a == 1. {
            return self.incoming_ab + Self::read(&self.ba, self.write, 1.);
        }
        self.travel[0].sample(
            &self.ab,
            self.write,
            (self.delay * distance_from_a).max(1.),
            self.grain * distance_from_a,
            window,
        ) + self.travel[1].sample(
            &self.ba,
            self.write,
            (self.delay * (1. - distance_from_a)).max(1.),
            self.grain * (1. - distance_from_a),
            window,
        )
    }
}
struct Graph {
    nodes: Vec<Point>,
    degrees: Vec<f64>,
    pressure: Vec<f64>,
    input_weights: Vec<f64>,
    pickup_weights: Vec<f64>,
    input_targets: Vec<f64>,
    pickup_targets: Vec<f64>,
    input_scale: Vec<f64>,
    direction_sums: Vec<[f64; 2]>,
    connected_scale: f64,
    target_cursor: usize,
    targets_remaining: usize,
    pan: Vec<[f64; 2]>,
    edges: Vec<Edge>,
    reserve_ms: f64,
    bytes: usize,
}
impl Graph {
    fn geometry_targets(&mut self) {
        self.direction_sums.fill([0.; 2]);
        for edge in &mut self.edges {
            edge.cache_direction(&self.nodes);
            for axis in 0..2 {
                self.direction_sums[edge.link.a][axis] += edge.direction[axis];
                self.direction_sums[edge.link.b][axis] -= edge.direction[axis];
            }
        }
        for index in 0..self.edges.len() {
            self.cache_turn(index);
        }
        self.mark_controls();
        // Retargeting is bounded inside process(), even for dense live edits.
    }
    fn cache_turn(&mut self, index: usize) {
        let edge = &mut self.edges[index];
        for (direction, node, sign) in [(0, edge.link.a, 1.), (1, edge.link.b, -1.)] {
            let degree = self.degrees[node];
            edge.turn[direction] = if degree <= 1. {
                1.
            } else {
                let dot = sign
                    * (edge.direction[0] * self.direction_sums[node][0]
                        + edge.direction[1] * self.direction_sums[node][1]);
                (0.5 * (1. - (1. - dot) / (degree - 1.))).clamp(0., 1.)
            };
        }
    }
    fn control_target(edge: &mut Edge, rate: f64, parameters: &Parameters) {
        let paths = parameters.propagation == Propagation::Paths;
        edge.loss_target = parameters.decay.powf(edge.link.length);
        let semitones = if paths {
            parameters.geometry_pitch * edge.direction[1]
        } else {
            0.
        };
        let ratio = 2f64.powf(semitones / 12.);
        edge.travel[0].ratio_target = ratio;
        edge.travel[1].ratio_target = 1. / ratio;
        for (index, direction) in edge.travel.iter_mut().enumerate() {
            direction.coefficient_target =
                if paths && parameters.turn_tone > 0. && edge.turn[index] > 0. {
                    let cutoff = (18000. * 0.045f64.powf(parameters.turn_tone * edge.turn[index]))
                        .min(rate * 0.45);
                    1. - (-TAU * cutoff / rate).exp()
                } else {
                    1.
                };
        }
    }
    fn mark_controls(&mut self) {
        // Continuous gestures must not keep restarting at edge zero. Retain the
        // rolling position and dirty one complete sweep of the latest controls.
        self.targets_remaining = self.edges.len();
    }
    fn update_control_targets(&mut self, rate: f64, parameters: &Parameters, records: usize) {
        let count = records.min(self.targets_remaining);
        for _ in 0..count {
            Self::control_target(&mut self.edges[self.target_cursor], rate, parameters);
            self.target_cursor += 1;
            if self.target_cursor == self.edges.len() {
                self.target_cursor = 0;
            }
        }
        self.targets_remaining -= count;
    }
    fn step(
        &mut self,
        input: f64,
        rate: f64,
        time_ms: f64,
        coupling: f64,
        boundary: f64,
        smooth: f64,
        path_mix: f64,
        tap_coverage: f64,
        window: &[f64; PITCH_WINDOW],
    ) -> [f64; 2] {
        self.pressure.fill(0.);
        for e in &mut self.edges {
            let target = (e.link.length * rate * time_ms / 1000.).max(1.);
            // Moving read heads accelerate smoothly rather than teleport. This
            // retains ordinary tape Doppler motion when travel speed changes.
            let desired = ((target - e.delay) * smooth).clamp(-0.25, 0.25);
            follow(&mut e.delay_velocity, desired, smooth);
            if (target - e.delay).abs() <= FOLLOW_EPSILON {
                e.delay = target.clamp(1., (e.ab.len() - 2) as f64);
                e.delay_velocity = 0.;
            } else {
                e.delay = (e.delay + e.delay_velocity).clamp(1., (e.ab.len() - 2) as f64);
            }
            follow(&mut e.loss, e.loss_target, smooth);
            e.grain = (rate * 0.11)
                .min(e.delay * 0.20)
                .min(((e.ab.len() - 2) as f64 - e.delay).max(0.) / 1.25);
            e.travel[0].advance(path_mix, e.grain, smooth);
            e.travel[1].advance(path_mix, e.grain, smooth);
            e.incoming_ab =
                Self::safe(e.travel[0].sample(&e.ab, e.write, e.delay, e.grain, window) * e.loss);
            e.incoming_ba =
                Self::safe(e.travel[1].sample(&e.ba, e.write, e.delay, e.grain, window) * e.loss);
            self.pressure[e.link.b] += e.incoming_ab;
            self.pressure[e.link.a] += e.incoming_ba;
        }
        let mut pickup = [0.; 2];
        let mut path_pickup = [0.; 2];
        let mut whole_pickup = [0.; 2];
        for index in 0..self.pressure.len() {
            self.pressure[index] *= 2. / self.degrees[index].max(1.);
            follow(
                &mut self.input_weights[index],
                self.input_targets[index],
                smooth,
            );
            follow(
                &mut self.pickup_weights[index],
                self.pickup_targets[index],
                smooth,
            );
            let pressure = self.pressure[index] * 0.5 * self.pickup_weights[index];
            pickup[0] += pressure * self.pan[index][0];
            pickup[1] += pressure * self.pan[index][1];
            if path_mix > 0. && self.degrees[index] > 0. {
                // Both tap vectors have L2 norm <= 1 across incoming channels:
                // node arrivals /sqrt(degree), whole-network taps /sqrt(nodes).
                let arrival =
                    self.pressure[index] * 0.5 * self.degrees[index] * self.input_scale[index];
                for channel in 0..2 {
                    path_pickup[channel] +=
                        arrival * self.pickup_weights[index] * self.pan[index][channel];
                    whole_pickup[channel] +=
                        arrival * self.connected_scale * self.pan[index][channel];
                }
            }
        }
        for e in &mut self.edges {
            let mut reflected_a = (1. - coupling) * e.incoming_ba
                + coupling * (self.pressure[e.link.a] - e.incoming_ba);
            let mut reflected_b = (1. - coupling) * e.incoming_ab
                + coupling * (self.pressure[e.link.b] - e.incoming_ab);
            if path_mix > 0. {
                let degree_a = self.degrees[e.link.a];
                let degree_b = self.degrees[e.link.b];
                let onward_a = if degree_a <= 1. {
                    e.incoming_ba
                } else {
                    (1. - coupling) * e.incoming_ba
                        + coupling * (self.pressure[e.link.a] * degree_a * 0.5 - e.incoming_ba)
                            / (degree_a - 1.)
                };
                let onward_b = if degree_b <= 1. {
                    e.incoming_ab
                } else {
                    (1. - coupling) * e.incoming_ab
                        + coupling * (self.pressure[e.link.b] * degree_b * 0.5 - e.incoming_ab)
                            / (degree_b - 1.)
                };
                reflected_a += (onward_a - reflected_a) * path_mix;
                reflected_b += (onward_b - reflected_b) * path_mix;
            }
            // A leaf may absorb incoming energy without attenuating the external
            // excitation. Per-node 1/sqrt(degree) injection makes a unit-L2 port
            // vector inject at most one source's energy across all directions.
            let a = e.travel[0].color(
                reflected_a
                    * if self.degrees[e.link.a] == 1. {
                        boundary
                    } else {
                        1.
                    },
                path_mix,
                smooth,
            ) + input * self.input_weights[e.link.a] * self.input_scale[e.link.a];
            let b = e.travel[1].color(
                reflected_b
                    * if self.degrees[e.link.b] == 1. {
                        boundary
                    } else {
                        1.
                    },
                path_mix,
                smooth,
            ) + input * self.input_weights[e.link.b] * self.input_scale[e.link.b];
            e.ab[e.write] = Self::safe(a) as f32;
            e.ba[e.write] = Self::safe(b) as f32;
            let amplitude = ((a * a + b * b) * 0.5).sqrt() as f32;
            e.level += (amplitude - e.level) * 0.012;
            if e.level.abs() < WAVE_FLOOR as f32 {
                e.level = 0.;
            }
            e.write += 1;
            if e.write == e.ab.len() {
                e.write = 0;
            }
        }
        std::array::from_fn(|channel| {
            pickup[channel] * (1. - path_mix)
                + (path_pickup[channel] * (1. - tap_coverage)
                    + whole_pickup[channel] * tap_coverage)
                    * path_mix
        })
    }
    fn safe(value: f64) -> f64 {
        if value.is_finite() {
            flush_small(value.clamp(-64., 64.))
        } else {
            0.
        }
    }
}
struct PartialEdge {
    link: Link,
    ab: Vec<MaybeUninit<f32>>,
    ba: Vec<MaybeUninit<f32>>,
    cursor: usize,
    source: Option<usize>,
    source_write: usize,
    source_clock: u64,
    ready: Option<Edge>,
}
fn uninitialized(size: usize) -> Vec<MaybeUninit<f32>> {
    let mut values = Vec::with_capacity(size);
    // MaybeUninit is valid without initializing the large reserved storage.
    unsafe {
        values.set_len(size);
    }
    values
}
unsafe fn initialized(mut values: Vec<MaybeUninit<f32>>) -> Vec<f32> {
    let pointer = values.as_mut_ptr() as *mut f32;
    let len = values.len();
    let capacity = values.capacity();
    std::mem::forget(values);
    Vec::from_raw_parts(pointer, len, capacity)
}
fn synchronize(edge: &mut Edge, old: &Edge, clock: u64, maximum: usize) {
    let backlog = (clock - edge.history_clock) as usize;
    let capacity = old.ab.len().min(edge.ab.len());
    if backlog > capacity {
        let skipped = backlog - capacity;
        edge.write = (edge.write + skipped) % edge.ab.len();
        edge.history_clock += skipped as u64;
    }
    let backlog = (clock - edge.history_clock) as usize;
    let frames = backlog.min(maximum);
    let mut source = (old.write + old.ab.len() - backlog) % old.ab.len();
    let mut destination = edge.write;
    let mut remaining = frames;
    while remaining > 0 {
        let count = remaining
            .min(old.ab.len() - source)
            .min(edge.ab.len() - destination);
        edge.ab[destination..destination + count].copy_from_slice(&old.ab[source..source + count]);
        edge.ba[destination..destination + count].copy_from_slice(&old.ba[source..source + count]);
        source += count;
        destination += count;
        remaining -= count;
        if source == old.ab.len() {
            source = 0;
        }
        if destination == edge.ab.len() {
            destination = 0;
        }
    }
    edge.write = destination;
    edge.history_clock += frames as u64;
    edge.delay = old.delay.min((edge.ab.len() - 2) as f64);
    edge.delay_velocity = old.delay_velocity;
    edge.level = old.level;
    for (direction, previous) in edge.travel.iter_mut().zip(&old.travel) {
        direction.inherit(previous);
    }
}
struct Preparation {
    scene: Scene,
    graph: Graph,
    reuse: HashMap<u32, usize>,
    cursor: usize,
    partial: Option<PartialEdge>,
    coefficients_prepared: usize,
    coefficients_dirty: bool,
}

#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Propagation {
    Resonance,
    Paths,
}

#[derive(Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Parameters {
    time_ms: f64,
    decay: f64,
    coupling: f64,
    boundary: f64,
    pitch_offset: f64,
    propagation: Propagation,
    geometry_pitch: f64,
    tap_coverage: f64,
    turn_tone: f64,
    frozen: bool,
}
impl Default for Parameters {
    fn default() -> Self {
        Self {
            time_ms: 140.,
            decay: 0.84,
            coupling: 0.82,
            boundary: 1.,
            pitch_offset: 0.,
            // Legacy JSON retains its previous resonator interpretation.
            // The browser explicitly sends its new Path echoes defaults.
            propagation: Propagation::Resonance,
            geometry_pitch: 0.,
            tap_coverage: 0.,
            turn_tone: 0.,
            frozen: false,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Performance {
    input_gain: f64,
    input_drive_db: f64,
    delay_gain_db: f64,
    wet: f64,
    dry: f64,
    output_level: f64,
    output_boost_db: f64,
    hpf_hz: f64,
    lpf_hz: f64,
    compressor_threshold_db: f64,
    compressor_ratio: f64,
    compressor_attack_ms: f64,
    compressor_release_ms: f64,
    compressor_makeup_db: f64,
}
impl Default for Performance {
    fn default() -> Self {
        Self {
            input_gain: 0.85,
            input_drive_db: 12.,
            delay_gain_db: 24.,
            wet: 0.7,
            dry: 0.,
            output_level: 1.,
            output_boost_db: 6.,
            hpf_hz: 30.,
            lpf_hz: 18000.,
            compressor_threshold_db: -12.,
            compressor_ratio: 3.,
            compressor_attack_ms: 5.,
            compressor_release_ms: 120.,
            compressor_makeup_db: 0.,
        }
    }
}
#[derive(Deserialize)]
struct Controls {
    #[serde(default)]
    parameters: Option<Parameters>,
    #[serde(default)]
    performance: Option<Performance>,
    #[serde(default, rename = "inputMode")]
    input_mode: Option<String>,
}

struct Engine {
    rate: f64,
    graph: Option<Graph>,
    old: Option<Graph>,
    pending: Option<Preparation>,
    retired: Vec<Graph>,
    revision: u32,
    pending_revision: u32,
    clock: u64,
    fade: f64,
    parameters: Parameters,
    performance: Performance,
    media: bool,
    smooth: f64,
    time: f64,
    decay: f64,
    coupling: f64,
    boundary: f64,
    ratio: f64,
    path_mix: f64,
    tap_coverage: f64,
    pitch_window: [f64; PITCH_WINDOW],
    mic_gain: f64,
    input_drive: f64,
    delay_gain: f64,
    wet: f64,
    dry: f64,
    output: f64,
    hp_coefficient: f64,
    lp_coefficient: f64,
    hp_last_input: [f64; 2],
    hp_last_output: [f64; 2],
    lp_last: [f64; 2],
    compressor_envelope: f64,
    compressor_gain: f64,
    compressor_threshold: f64,
    compressor_attack: f64,
    compressor_release: f64,
    makeup: f64,
    gain_reduction: f64,
    pitch_left: Vec<f32>,
    pitch_right: Vec<f32>,
    pitch_write: usize,
    pitch_phase: f64,
    pitch_mix: f64,
    metrics: [f64; METRICS],
    levels: Vec<f32>,
    waveforms: Vec<f32>,
    error: String,
}
impl Engine {
    fn new(rate: f64) -> Self {
        let p = Performance::default();
        let parameters = Parameters::default();
        let mut e = Self {
            rate,
            graph: None,
            old: None,
            pending: None,
            retired: Vec::with_capacity(8),
            revision: 0,
            pending_revision: 0,
            clock: 0,
            fade: 1.,
            parameters,
            performance: p.clone(),
            media: false,
            smooth: 1. - (-1. / (rate * 0.035)).exp(),
            time: 140.,
            decay: 0.84,
            coupling: 0.82,
            boundary: 1.,
            ratio: 1.,
            path_mix: 0.,
            tap_coverage: 0.,
            pitch_window: std::array::from_fn(|i| {
                0.5 - 0.5 * (TAU * i as f64 / PITCH_WINDOW as f64).cos()
            }),
            mic_gain: p.input_gain,
            input_drive: 10f64.powf(p.input_drive_db / 20.),
            delay_gain: 10f64.powf(p.delay_gain_db / 20.),
            wet: p.wet,
            dry: p.dry,
            output: 10f64.powf(p.output_boost_db / 20.),
            hp_coefficient: 0.,
            lp_coefficient: 0.,
            hp_last_input: [0.; 2],
            hp_last_output: [0.; 2],
            lp_last: [0.; 2],
            compressor_envelope: 0.,
            compressor_gain: 1.,
            compressor_threshold: 0.,
            compressor_attack: 0.,
            compressor_release: 0.,
            makeup: 1.,
            gain_reduction: 0.,
            pitch_left: vec![0.; (rate * 0.4).ceil() as usize],
            pitch_right: vec![0.; (rate * 0.4).ceil() as usize],
            pitch_write: 0,
            pitch_phase: 0.,
            pitch_mix: 0.,
            metrics: [0.; METRICS],
            levels: Vec::new(),
            waveforms: Vec::new(),
            error: String::new(),
        };
        e.coefficients();
        e
    }
    fn coefficients(&mut self) {
        self.hp_coefficient =
            (-TAU * self.performance.hpf_hz.min(self.rate * 0.45) / self.rate).exp();
        self.lp_coefficient =
            1. - (-TAU * self.performance.lpf_hz.min(self.rate * 0.45) / self.rate).exp();
        self.compressor_threshold = 10f64.powf(self.performance.compressor_threshold_db / 20.);
        self.compressor_attack =
            1. - (-1. / (self.rate * self.performance.compressor_attack_ms / 1000.)).exp();
        self.compressor_release =
            1. - (-1. / (self.rate * self.performance.compressor_release_ms / 1000.)).exp();
        self.makeup = 10f64.powf(self.performance.compressor_makeup_db / 20.);
    }
    fn controls(&mut self, controls: Controls) -> Result<(), &'static str> {
        if let Some(p) = &controls.parameters {
            if !p.time_ms.is_finite()
                || !(0.05..=2000.).contains(&p.time_ms)
                || !p.decay.is_finite()
                || !(0.0..=1.).contains(&p.decay)
                || !p.coupling.is_finite()
                || !(0.0..=1.).contains(&p.coupling)
                || !p.boundary.is_finite()
                || !(0.0..=1.).contains(&p.boundary)
                || !p.pitch_offset.is_finite()
                || !(-24.0..=24.).contains(&p.pitch_offset)
                || !p.geometry_pitch.is_finite()
                || !(0.0..=24.).contains(&p.geometry_pitch)
                || !p.tap_coverage.is_finite()
                || !(0.0..=1.).contains(&p.tap_coverage)
                || !p.turn_tone.is_finite()
                || !(0.0..=1.).contains(&p.turn_tone)
            {
                return Err("Invalid live network parameters");
            }
            if self
                .graph
                .as_ref()
                .is_some_and(|g| p.time_ms > g.reserve_ms)
            {
                return Err("Travel time exceeds graph reservation");
            }
        }
        if let Some(p) = &controls.performance {
            let values = [
                p.input_gain,
                p.input_drive_db,
                p.delay_gain_db,
                p.wet,
                p.dry,
                p.output_level,
                p.output_boost_db,
                p.hpf_hz,
                p.lpf_hz,
                p.compressor_threshold_db,
                p.compressor_ratio,
                p.compressor_attack_ms,
                p.compressor_release_ms,
                p.compressor_makeup_db,
            ];
            if values.iter().any(|v| !v.is_finite())
                || !(0.0..=4.).contains(&p.input_gain)
                || !(-12.0..=24.).contains(&p.input_drive_db)
                || !(-12.0..=48.).contains(&p.delay_gain_db)
                || !(0.0..=1.).contains(&p.wet)
                || !(0.0..=1.).contains(&p.dry)
                || !(0.0..=2.).contains(&p.output_level)
                || !(0.0..=24.).contains(&p.output_boost_db)
                || !(0.0..=20000.).contains(&p.hpf_hz)
                || !(20.0..=22000.).contains(&p.lpf_hz)
                || !(-60.0..=0.).contains(&p.compressor_threshold_db)
                || !(1.0..=40.).contains(&p.compressor_ratio)
                || !(0.1..=1000.).contains(&p.compressor_attack_ms)
                || !(1.0..=5000.).contains(&p.compressor_release_ms)
                || !(0.0..=24.).contains(&p.compressor_makeup_db)
            {
                return Err("Invalid mastering parameters");
            }
        }
        if let Some(mode) = &controls.input_mode {
            if mode != "media" && mode != "mic" {
                return Err("Invalid source mode");
            }
        }
        if let Some(p) = controls.parameters {
            let retarget = p.decay != self.parameters.decay
                || p.propagation != self.parameters.propagation
                || p.geometry_pitch != self.parameters.geometry_pitch
                || p.turn_tone != self.parameters.turn_tone;
            self.parameters = p;
            if retarget {
                if let Some(g) = &mut self.graph {
                    g.mark_controls();
                }
                if let Some(g) = &mut self.old {
                    g.mark_controls();
                }
                if let Some(p) = &mut self.pending {
                    // Complete initial preparation without restarting it under
                    // a gesture, then fairly refresh any coefficients prepared
                    // before the latest controls after atomic installation.
                    p.coefficients_dirty |= p.coefficients_prepared > 0;
                }
            }
        }
        if let Some(p) = controls.performance {
            self.performance = p;
            self.coefficients();
        }
        if let Some(mode) = controls.input_mode {
            self.media = mode == "media";
        }
        Ok(())
    }
    fn begin(&mut self, scene: Scene, revision: u32) -> Result<(), &'static str> {
        let bytes = validate(&scene, self.rate)?;
        if self.parameters.time_ms > scene.reserve_time_ms {
            return Err("Graph reservation below current travel time");
        }
        // A pure geometry/pickup update does not allocate wave histories, replace
        // the graph, reset its clock, or restart the source.
        if let Some(g) = &mut self.graph {
            if scene.edges.len() == g.edges.len()
                && scene.nodes.len() == g.nodes.len()
                && scene.edges.iter().zip(&g.edges).all(|(a, b)| {
                    a.id == b.link.id
                        && a.a == b.link.a
                        && a.b == b.link.b
                        && (a.length * self.rate * scene.reserve_time_ms / 1000.)
                            .ceil()
                            .max(1.) as usize
                            + 4
                            <= b.ab.len()
                })
            {
                g.pan = scene
                    .nodes
                    .iter()
                    .map(|p| {
                        let pan = p.x.clamp(-1., 1.) * 0.5;
                        [(1. - pan).sqrt(), (1. + pan).sqrt()]
                    })
                    .collect();
                g.nodes = scene.nodes;
                set_port_targets(
                    &mut g.input_targets,
                    scene.input_ports.as_deref(),
                    scene.input_node,
                );
                set_port_targets(
                    &mut g.pickup_targets,
                    scene.pickup_ports.as_deref(),
                    scene.pickup_node,
                );
                for (edge, link) in g.edges.iter_mut().zip(scene.edges) {
                    edge.link = link;
                }
                g.geometry_targets();
                g.reserve_ms = scene.reserve_time_ms;
                self.revision = revision;
                if let Some(previous) = self.pending.take() {
                    self.retired.push(previous.graph);
                }
                return Ok(());
            }
        }
        let mut degree = vec![0.; scene.nodes.len()];
        for e in &scene.edges {
            degree[e.a] += 1.;
            degree[e.b] += 1.;
        }
        let mut input_targets = vec![0.; scene.nodes.len()];
        let mut pickup_targets = vec![0.; scene.nodes.len()];
        set_port_targets(
            &mut input_targets,
            scene.input_ports.as_deref(),
            scene.input_node,
        );
        set_port_targets(
            &mut pickup_targets,
            scene.pickup_ports.as_deref(),
            scene.pickup_node,
        );
        let connected_scale =
            1. / (degree.iter().filter(|degree| **degree > 0.).count().max(1) as f64).sqrt();
        let graph = Graph {
            nodes: scene.nodes.clone(),
            input_scale: degree.iter().map(|n: &f64| 1. / n.max(1.).sqrt()).collect(),
            degrees: degree,
            direction_sums: vec![[0.; 2]; scene.nodes.len()],
            connected_scale,
            target_cursor: 0,
            targets_remaining: 0,
            pressure: vec![0.; scene.nodes.len()],
            input_weights: input_targets.clone(),
            pickup_weights: pickup_targets.clone(),
            input_targets,
            pickup_targets,
            pan: scene
                .nodes
                .iter()
                .map(|p| {
                    let pan = p.x.clamp(-1., 1.) * 0.5;
                    [(1. - pan).sqrt(), (1. + pan).sqrt()]
                })
                .collect(),
            edges: Vec::with_capacity(scene.edges.len()),
            reserve_ms: scene.reserve_time_ms,
            bytes,
        };
        let reuse = self
            .graph
            .as_ref()
            .map(|g| {
                g.edges
                    .iter()
                    .enumerate()
                    .map(|(i, e)| (e.link.id, i))
                    .collect()
            })
            .unwrap_or_default();
        if let Some(previous) = self.pending.take() {
            self.retired.push(previous.graph);
        }
        self.pending = Some(Preparation {
            scene,
            graph,
            reuse,
            cursor: 0,
            partial: None,
            coefficients_prepared: 0,
            coefficients_dirty: false,
        });
        self.pending_revision = revision;
        Ok(())
    }
    fn prepare(&mut self, records: usize) -> i32 {
        let Some(p) = &mut self.pending else {
            return 2;
        };
        for _ in 0..records.max(1) {
            if p.cursor == p.scene.edges.len() {
                break;
            }
            if p.partial.is_none() {
                let link = p.scene.edges[p.cursor].clone();
                let size = ring_size(link.length, self.rate, p.scene.reserve_time_ms);
                let source = p.reuse.get(&link.id).copied();
                let source_write = source
                    .and_then(|index| self.graph.as_ref().and_then(|g| g.edges.get(index)))
                    .map_or(0, |edge| edge.write);
                p.partial = Some(PartialEdge {
                    link,
                    ab: uninitialized(size),
                    ba: uninitialized(size),
                    cursor: 0,
                    source,
                    source_write,
                    source_clock: self.clock,
                    ready: None,
                });
            }
            let partial = p.partial.as_mut().unwrap();
            if partial.ready.is_none() {
                let size = partial.ab.len();
                let end = (partial.cursor + PREPARE_FRAMES).min(size);
                let old = partial
                    .source
                    .and_then(|index| self.graph.as_ref().and_then(|g| g.edges.get(index)));
                for destination in partial.cursor..end {
                    let distance = size - destination;
                    let (ab, ba) = if let Some(edge) = old {
                        if distance < edge.ab.len() {
                            let source =
                                (partial.source_write + edge.ab.len() - distance) % edge.ab.len();
                            (edge.ab[source], edge.ba[source])
                        } else {
                            (0., 0.)
                        }
                    } else {
                        (0., 0.)
                    };
                    partial.ab[destination].write(ab);
                    partial.ba[destination].write(ba);
                }
                partial.cursor = end;
                if end < size {
                    continue;
                }
                // Every element has now been initialized in bounded chunks.
                let ab = unsafe { initialized(std::mem::take(&mut partial.ab)) };
                let ba = unsafe { initialized(std::mem::take(&mut partial.ba)) };
                let mut edge = Edge {
                    link: partial.link.clone(),
                    ab,
                    ba,
                    write: 0,
                    delay: (partial.link.length * self.rate * self.time / 1000.).max(1.),
                    delay_velocity: 0.,
                    incoming_ab: 0.,
                    incoming_ba: 0.,
                    loss: self.decay.powf(partial.link.length),
                    loss_target: self.parameters.decay.powf(partial.link.length),
                    direction: [0.; 2],
                    turn: [0.; 2],
                    travel: [Direction::new(0.25), Direction::new(0.25)],
                    grain: 0.,
                    level: 0.,
                    history_source: partial.source,
                    history_clock: partial.source_clock,
                };
                if let Some(old) = old {
                    edge.delay = old.delay.min((size - 2) as f64);
                    edge.delay_velocity = old.delay_velocity;
                    edge.loss = old.loss;
                    edge.level = old.level;
                    for (direction, previous) in edge.travel.iter_mut().zip(&old.travel) {
                        direction.inherit(previous);
                    }
                }
                partial.ready = Some(edge);
                // The copying budget is already consumed by initialization.
                if partial.source.is_some() {
                    continue;
                }
            }
            let edge = partial.ready.as_mut().unwrap();
            if let Some(index) = edge.history_source {
                if let Some(old) = self.graph.as_ref().and_then(|g| g.edges.get(index)) {
                    synchronize(edge, old, self.clock, PREPARE_FRAMES);
                }
                if edge.history_clock != self.clock {
                    continue;
                }
            }
            let mut ready = partial.ready.take().unwrap();
            ready.cache_direction(&p.graph.nodes);
            for axis in 0..2 {
                p.graph.direction_sums[ready.link.a][axis] += ready.direction[axis];
                p.graph.direction_sums[ready.link.b][axis] -= ready.direction[axis];
            }
            p.graph.edges.push(ready);
            p.partial = None;
            p.cursor += 1;
        }
        if p.cursor != p.scene.edges.len() {
            return 1;
        }
        // Turn and coefficient preparation is also incremental; activating the
        // complete graph never ends with a graph-wide exponential/pow burst.
        let target_end = (p.coefficients_prepared + records).min(p.graph.edges.len());
        for index in p.coefficients_prepared..target_end {
            p.graph.cache_turn(index);
            Graph::control_target(&mut p.graph.edges[index], self.rate, &self.parameters);
        }
        p.coefficients_prepared = target_end;
        if p.coefficients_prepared < p.graph.edges.len() {
            return 1;
        }
        let mut p = self.pending.take().unwrap();
        if p.coefficients_dirty {
            p.graph.mark_controls();
        }
        if let Some(previous) = self.old.take() {
            self.retired.push(previous);
        }
        self.old = self.graph.replace(p.graph);
        self.fade = if self.old.is_some() { 0. } else { 1. };
        self.revision = self.pending_revision;
        let count = self.graph.as_ref().map_or(0, |g| g.edges.len());
        self.levels.resize(count, 0.);
        self.waveforms.resize(count * WAVEFORM, 0.);
        2
    }
    fn pitch(&mut self, wet: [f64; 2]) -> [f64; 2] {
        self.pitch_left[self.pitch_write] = flush_small(wet[0]) as f32;
        self.pitch_right[self.pitch_write] = flush_small(wet[1]) as f32;
        let grain = self.rate * 0.11;
        let p0 = self.pitch_phase;
        let p1 = (p0 + 0.5).fract();
        let target = if (self.ratio - 1.).abs() > 0.0005 && self.clock as f64 > grain * 2. {
            1.
        } else {
            0.
        };
        follow(&mut self.pitch_mix, target, self.smooth);
        let window0 = 0.5 - 0.5 * (TAU * p0).cos();
        let window1 = 1. - window0;
        let delay0 = grain * 0.25
            + if self.ratio >= 1. {
                (1. - p0) * grain
            } else {
                p0 * grain
            };
        let delay1 = grain * 0.25
            + if self.ratio >= 1. {
                (1. - p1) * grain
            } else {
                p1 * grain
            };
        let pitched = [
            Edge::read(&self.pitch_left, self.pitch_write, delay0) * window0
                + Edge::read(&self.pitch_left, self.pitch_write, delay1) * window1,
            Edge::read(&self.pitch_right, self.pitch_write, delay0) * window0
                + Edge::read(&self.pitch_right, self.pitch_write, delay1) * window1,
        ];
        self.pitch_phase = (self.pitch_phase + (self.ratio - 1.).abs() / grain).fract();
        self.pitch_write = (self.pitch_write + 1) % self.pitch_left.len();
        std::array::from_fn(|i| wet[i] * (1. - self.pitch_mix) + pitched[i] * self.pitch_mix)
    }
    fn process(&mut self, left: &[f32], right: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        // Controls only mark changed coefficients. Spread their preparation
        // over quanta, retaining every edge's phase and already travelling audio.
        if let Some(graph) = &mut self.graph {
            graph.update_control_targets(self.rate, &self.parameters, 64);
        }
        if let Some(graph) = &mut self.old {
            graph.update_control_targets(self.rate, &self.parameters, 64);
        }
        let s = self.smooth;
        let ratio_target = 2f64.powf(self.parameters.pitch_offset / 12.);
        let output_target =
            self.performance.output_level * 10f64.powf(self.performance.output_boost_db / 20.);
        let delay_gain_target = 10f64.powf(self.performance.delay_gain_db / 20.);
        let input_drive_target = 10f64.powf(self.performance.input_drive_db / 20.);
        let path_target = if self.parameters.propagation == Propagation::Paths {
            1.
        } else {
            0.
        };
        self.metrics[3] = 0.;
        self.metrics[4] = 0.;
        self.metrics[5] = 0.;
        for i in 0..out_l.len() {
            follow(&mut self.time, self.parameters.time_ms, s);
            follow(&mut self.decay, self.parameters.decay, s);
            follow(&mut self.coupling, self.parameters.coupling, s);
            follow(&mut self.boundary, self.parameters.boundary, s);
            follow(&mut self.ratio, ratio_target, s);
            follow(&mut self.path_mix, path_target, s);
            follow(&mut self.tap_coverage, self.parameters.tap_coverage, s);
            follow(&mut self.mic_gain, self.performance.input_gain, s);
            follow(&mut self.input_drive, input_drive_target, s);
            follow(&mut self.delay_gain, delay_gain_target, s);
            follow(&mut self.wet, self.performance.wet, s);
            follow(&mut self.dry, self.performance.dry, s);
            follow(&mut self.output, output_target, s);
            let gain = if self.media { 1. } else { self.mic_gain };
            let input = [
                if left[i].is_finite() {
                    f64::from(left[i]).clamp(-4., 4.) * gain
                } else {
                    0.
                },
                if right[i].is_finite() {
                    f64::from(right[i]).clamp(-4., 4.) * gain
                } else {
                    0.
                },
            ];
            self.metrics[3] = self.metrics[3].max(input[0].abs()).max(input[1].abs());
            let injected = if self.parameters.frozen {
                0.
            } else {
                // Drive only new excitation. Returning travelling waves and
                // direct stereo playback retain their existing gain structure.
                (input[0] + input[1]) * 0.5 * self.input_drive
            };
            let current = self.graph.as_mut().map_or([0.; 2], |g| {
                g.step(
                    injected,
                    self.rate,
                    self.time,
                    self.coupling,
                    self.boundary,
                    s,
                    self.path_mix,
                    self.tap_coverage,
                    &self.pitch_window,
                )
            });
            let old = self.old.as_mut().map_or([0.; 2], |g| {
                g.step(
                    injected,
                    self.rate,
                    self.time,
                    self.coupling,
                    self.boundary,
                    s,
                    self.path_mix,
                    self.tap_coverage,
                    &self.pitch_window,
                )
            });
            let wet = self.pitch(std::array::from_fn(|ch| {
                // Receiver gain is outside the bidirectional feedback network.
                // It changes wet audibility before pitch and mixing while dry
                // unity, wave histories and their telemetry remain unchanged.
                (current[ch] * self.fade + old[ch] * (1. - self.fade)) * self.delay_gain
            }));
            self.fade = (self.fade + 1. / (self.rate * FADE_SECONDS)).min(1.);
            let mut output =
                std::array::from_fn::<_, 2, _>(|ch| input[ch] * self.dry + wet[ch] * self.wet);
            for ch in 0..2 {
                let hp = if self.performance.hpf_hz == 0. {
                    output[ch]
                } else {
                    self.hp_coefficient
                        * (self.hp_last_output[ch] + output[ch] - self.hp_last_input[ch])
                };
                self.hp_last_input[ch] = flush_small(output[ch]);
                self.hp_last_output[ch] = flush_small(hp);
                self.lp_last[ch] += (hp - self.lp_last[ch]) * self.lp_coefficient;
                self.lp_last[ch] = flush_small(self.lp_last[ch]);
                output[ch] = self.lp_last[ch];
            }
            let peak = output[0].abs().max(output[1].abs());
            let coefficient = if peak > self.compressor_envelope {
                self.compressor_attack
            } else {
                self.compressor_release
            };
            self.compressor_envelope += (peak - self.compressor_envelope) * coefficient;
            self.compressor_envelope = flush_small(self.compressor_envelope);
            let gain_target = if self.compressor_envelope > self.compressor_threshold {
                (self.compressor_envelope / self.compressor_threshold)
                    .powf(1. / self.performance.compressor_ratio - 1.)
            } else {
                1.
            };
            follow(&mut self.compressor_gain, gain_target, coefficient);
            for ch in 0..2 {
                output[ch] = 0.94
                    * (output[ch] * self.compressor_gain * self.makeup * self.output / 0.94).tanh();
            }
            out_l[i] = output[0] as f32;
            out_r[i] = output[1] as f32;
            self.metrics[4] = self.metrics[4].max(output[0].abs());
            self.metrics[5] = self.metrics[5].max(output[1].abs());
            self.clock += 1;
        }
        // Preparation may span many blocks. Keep already-copied common edge
        // histories synchronized to THIS sample clock, instead of committing
        // old snapshots from progressively different preparation times. Copy
        // only the newly written samples in contiguous circular-buffer chunks.
        // This adds no allocation and performs no extra scattering graph.
        if let (Some(pending), Some(current)) = (&mut self.pending, &self.graph) {
            for edge in &mut pending.graph.edges {
                let Some(index) = edge.history_source else {
                    continue;
                };
                synchronize(edge, &current.edges[index], self.clock, out_l.len());
            }
        }
        self.gain_reduction = -20. * self.compressor_gain.max(1e-12).log10();
        // No Vec resize, ring allocation, JSON parsing, collection or deallocation
        // occurs in this rendering method. Maintenance owns retired storage.
    }
    fn collect(&mut self, records: usize) -> usize {
        if self.fade >= 1. {
            if let Some(g) = self.old.take() {
                self.retired.push(g);
            }
        }
        for _ in 0..records {
            if let Some(g) = self.retired.last_mut() {
                if g.edges.pop().is_none() {
                    self.retired.pop();
                }
            } else {
                break;
            }
        }
        self.retired.len()
    }
    fn snapshot(&mut self) {
        self.metrics[0] = self.clock as f64;
        self.metrics[1] = self.graph.as_ref().map_or(0., |g| g.edges.len() as f64);
        self.metrics[2] = self.revision as f64;
        self.metrics[6] = self.gain_reduction;
        self.metrics[7] = self.time;
        self.metrics[8] = self.parameters.time_ms;
        self.metrics[9] = self.graph.as_ref().map_or(0., |g| g.bytes as f64);
        self.metrics[10] = self.pending.as_ref().map_or(0., |p| p.cursor as f64);
        self.metrics[11] = self.parameters.pitch_offset;
        self.metrics[12] = self.rate;
        self.metrics[13] = self.old.as_ref().map_or(0., |g| g.edges.len() as f64);
        if let Some(g) = &self.graph {
            for (i, e) in g.edges.iter().enumerate() {
                self.levels[i] = e.level;
                for j in 0..WAVEFORM {
                    self.waveforms[i * WAVEFORM + j] =
                        e.at(j as f64 / (WAVEFORM - 1) as f64, &self.pitch_window) as f32;
                }
            }
        }
    }
}

unsafe fn engine<'a>(ptr: usize) -> &'a mut Engine {
    &mut *(ptr as *mut Engine)
}
unsafe fn json<'a>(ptr: usize, len: usize) -> &'a [u8] {
    std::slice::from_raw_parts(ptr as *const u8, len)
}
#[no_mangle]
pub extern "C" fn fd_abi_version() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn fd_alloc(len: usize) -> usize {
    let bytes = vec![0u8; len].into_boxed_slice();
    Box::into_raw(bytes) as *mut u8 as usize
}
#[no_mangle]
pub unsafe extern "C" fn fd_free(ptr: usize, len: usize) {
    if ptr != 0 {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            ptr as *mut u8,
            len,
        )));
    }
}
#[no_mangle]
pub extern "C" fn fd_new(rate: f64) -> usize {
    if !rate.is_finite() || !(8000.0..=192000.).contains(&rate) {
        return 0;
    }
    Box::into_raw(Box::new(Engine::new(rate))) as usize
}
#[no_mangle]
pub unsafe extern "C" fn fd_drop(ptr: usize) {
    if ptr != 0 {
        drop(Box::from_raw(ptr as *mut Engine));
    }
}
#[no_mangle]
pub unsafe extern "C" fn fd_scene_begin(ptr: usize, data: usize, len: usize, revision: u32) -> i32 {
    let e = engine(ptr);
    match serde_json::from_slice::<Scene>(json(data, len)) {
        Ok(s) => match e.begin(s, revision) {
            Ok(()) => 1,
            Err(err) => {
                e.error = err.into();
                0
            }
        },
        Err(err) => {
            e.error = err.to_string();
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn fd_scene_step(ptr: usize, records: usize) -> i32 {
    engine(ptr).prepare(records)
}
#[no_mangle]
pub unsafe extern "C" fn fd_scene_abort(ptr: usize) {
    let e = engine(ptr);
    if let Some(p) = e.pending.take() {
        e.retired.push(p.graph);
    }
}
#[no_mangle]
pub unsafe extern "C" fn fd_controls(ptr: usize, data: usize, len: usize) -> i32 {
    let e = engine(ptr);
    match serde_json::from_slice::<Controls>(json(data, len)) {
        Ok(c) => match e.controls(c) {
            Ok(()) => 1,
            Err(err) => {
                e.error = err.into();
                0
            }
        },
        Err(err) => {
            e.error = err.to_string();
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn fd_estimated_bytes(data: usize, len: usize, rate: f64) -> f64 {
    serde_json::from_slice::<Scene>(json(data, len))
        .ok()
        .and_then(|s| validate(&s, rate).ok())
        .map_or(-1., |n| n as f64)
}
#[no_mangle]
pub unsafe extern "C" fn fd_process(
    ptr: usize,
    left: usize,
    right: usize,
    out_l: usize,
    out_r: usize,
    frames: usize,
) {
    engine(ptr).process(
        std::slice::from_raw_parts(left as *const f32, frames),
        std::slice::from_raw_parts(right as *const f32, frames),
        std::slice::from_raw_parts_mut(out_l as *mut f32, frames),
        std::slice::from_raw_parts_mut(out_r as *mut f32, frames),
    );
}
#[no_mangle]
pub unsafe extern "C" fn fd_collect(ptr: usize, records: usize) -> usize {
    engine(ptr).collect(records)
}
#[no_mangle]
pub unsafe extern "C" fn fd_metrics_ptr(ptr: usize) -> usize {
    let e = engine(ptr);
    e.snapshot();
    e.metrics.as_ptr() as usize
}
#[no_mangle]
pub extern "C" fn fd_metrics_len() -> usize {
    METRICS
}
#[no_mangle]
pub unsafe extern "C" fn fd_edge_levels_ptr(ptr: usize) -> usize {
    engine(ptr).levels.as_ptr() as usize
}
#[no_mangle]
pub unsafe extern "C" fn fd_edge_waveforms_ptr(ptr: usize) -> usize {
    engine(ptr).waveforms.as_ptr() as usize
}
#[no_mangle]
pub unsafe extern "C" fn fd_edge_count(ptr: usize) -> usize {
    engine(ptr).levels.len()
}
#[no_mangle]
pub unsafe extern "C" fn fd_error_ptr(ptr: usize) -> usize {
    engine(ptr).error.as_ptr() as usize
}
#[no_mangle]
pub unsafe extern "C" fn fd_error_len(ptr: usize) -> usize {
    engine(ptr).error.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    thread_local! { static WATCH: Cell<bool> = const { Cell::new(false) }; static ALLOCATIONS: Cell<usize> = const { Cell::new(0) }; }
    struct CountingAllocator;
    unsafe impl GlobalAlloc for CountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            if WATCH.try_with(|value| value.get()).unwrap_or(false) {
                let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
            }
            System.alloc(layout)
        }
        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            System.dealloc(ptr, layout)
        }
        unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            if WATCH.try_with(|value| value.get()).unwrap_or(false) {
                let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
            }
            System.realloc(ptr, layout, size)
        }
    }
    #[global_allocator]
    static ALLOCATOR: CountingAllocator = CountingAllocator;
    fn scene() -> Scene {
        Scene {
            nodes: vec![
                Point {
                    id: 0,
                    x: 0.,
                    y: 0.,
                },
                Point {
                    id: 1,
                    x: 0.,
                    y: 0.,
                },
                Point {
                    id: 2,
                    x: 0.,
                    y: 0.,
                },
            ],
            edges: vec![
                Link {
                    id: 0,
                    a: 0,
                    b: 1,
                    length: 0.1,
                },
                Link {
                    id: 1,
                    a: 1,
                    b: 2,
                    length: 0.2,
                },
            ],
            input_node: 0,
            pickup_node: 2,
            input_ports: None,
            pickup_ports: None,
            reserve_time_ms: 2000.,
            memory_budget_bytes: 1024 * 1024,
        }
    }
    #[test]
    fn callback_allocates_nothing_after_preparation_including_crossfade_and_pitch() {
        let mut e = Engine::new(48000.);
        e.begin(scene(), 1).unwrap();
        e.prepare(16);
        e.parameters.pitch_offset = 12.;
        let input = [0.02f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        let mut changed = scene();
        changed.edges.push(Link {
            id: 2,
            a: 0,
            b: 2,
            length: 0.2,
        });
        e.begin(changed, 2).unwrap();
        e.prepare(1);
        ALLOCATIONS.with(|n| n.set(0));
        WATCH.with(|flag| flag.set(true));
        for _ in 0..100 {
            e.process(&input, &input, &mut left, &mut right);
        }
        WATCH.with(|flag| flag.set(false));
        e.prepare(16);
        WATCH.with(|flag| flag.set(true));
        for _ in 0..100 {
            e.process(&input, &input, &mut left, &mut right);
        }
        WATCH.with(|flag| flag.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert!(left
            .iter()
            .all(|value| value.is_finite() && value.abs() <= 0.94));
    }
    #[test]
    fn one_preparation_record_writes_only_a_bounded_float_chunk() {
        let mut e = Engine::new(48000.);
        let mut s = scene();
        s.edges = vec![Link {
            id: 0,
            a: 0,
            b: 2,
            length: 4.,
        }];
        s.memory_budget_bytes = 32 * 1024 * 1024;
        e.begin(s, 1).unwrap();
        let mut steps = 0;
        loop {
            let before = e
                .pending
                .as_ref()
                .and_then(|p| p.partial.as_ref())
                .map_or(0, |p| p.cursor);
            let result = e.prepare(1);
            steps += 1;
            if result == 2 {
                break;
            }
            let partial = e.pending.as_ref().unwrap().partial.as_ref().unwrap();
            assert!(partial.cursor - before <= PREPARE_FRAMES);
            assert_eq!(e.graph.as_ref().map_or(0, |g| g.edges.len()), 0);
        }
        assert!(steps > 50);
        assert_eq!(e.graph.as_ref().unwrap().edges.len(), 1);
    }
    #[test]
    fn scattering_is_lossless_at_full_coupling_and_contractive_for_blended_reflection() {
        // Verify the actual graph step at a degree-three junction, including
        // unequal arrivals. Integer one-sample waves avoid interpolation loss.
        for coupling in [0., 0.2, 0.82, 1.] {
            let arrivals = [0.03, -0.1, 0.07];
            let mut e = Engine::new(48000.);
            let mut s = scene();
            s.nodes.push(Point {
                id: 3,
                x: 0.,
                y: 0.,
            });
            s.edges = vec![
                Link {
                    id: 0,
                    a: 0,
                    b: 1,
                    length: 0.0001,
                },
                Link {
                    id: 1,
                    a: 2,
                    b: 1,
                    length: 0.0001,
                },
                Link {
                    id: 2,
                    a: 3,
                    b: 1,
                    length: 0.0001,
                },
            ];
            e.begin(s, 1).unwrap();
            e.prepare(16);
            let g = e.graph.as_mut().unwrap();
            for (edge, amplitude) in g.edges.iter_mut().zip(arrivals) {
                edge.delay = 1.;
                let last = edge.ab.len() - 1;
                edge.ab[last] = amplitude as f32;
                edge.loss = 1.;
                edge.loss_target = 1.;
            }
            g.step(
                0.,
                48000.,
                0.05,
                coupling,
                1.,
                0.001,
                0.,
                0.,
                &e.pitch_window,
            );
            let outgoing: f64 = g
                .edges
                .iter()
                .map(|edge| f64::from(edge.ba[0]).powi(2))
                .sum();
            let incoming: f64 = arrivals.iter().map(|value| value * value).sum();
            assert!(outgoing <= incoming + 1e-8);
            if coupling == 0. || coupling == 1. {
                assert!((outgoing - incoming).abs() < 1e-8);
            }
        }
    }
    #[test]
    fn normalized_multiport_excitation_injects_one_sources_energy_at_any_coupling_or_boundary() {
        for coupling in [0., 0.3, 1.] {
            for boundary in [0., 0.5, 1.] {
                let mut e = Engine::new(48000.);
                let mut s = scene();
                s.edges[1].a = 0;
                s.input_ports = Some(vec![
                    Port {
                        node: 0,
                        weight: 0.6,
                    },
                    Port {
                        node: 1,
                        weight: 0.8,
                    },
                ]);
                e.begin(s, 1).unwrap();
                while e.prepare(16) == 1 {}
                let g = e.graph.as_mut().unwrap();
                g.step(
                    0.1,
                    48000.,
                    10.,
                    coupling,
                    boundary,
                    e.smooth,
                    0.,
                    0.,
                    &e.pitch_window,
                );
                let injected: f64 = g
                    .edges
                    .iter()
                    .map(|edge| f64::from(edge.ab[0]).powi(2) + f64::from(edge.ba[0]).powi(2))
                    .sum();
                assert!((injected - 0.01).abs() < 1e-8);
                assert!((f64::from(g.edges[0].ab[0]) - 0.06 / 2f64.sqrt()).abs() < 1e-8);
                assert!((f64::from(g.edges[0].ba[0]) - 0.08).abs() < 1e-8);
            }
        }
    }
    #[test]
    fn compatible_port_moves_keep_instantaneous_state_and_callback_allocation_free() {
        let mut e = Engine::new(48000.);
        e.begin(scene(), 1).unwrap();
        while e.prepare(16) == 1 {}
        let input = [0.02f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        e.parameters.pitch_offset = 12.;
        for _ in 0..100 {
            e.process(&input, &input, &mut left, &mut right);
        }
        let ring_pointers: Vec<_> = e
            .graph
            .as_ref()
            .unwrap()
            .edges
            .iter()
            .map(|edge| (edge.ab.as_ptr(), edge.ba.as_ptr()))
            .collect();
        let first_clock = e.clock;
        ALLOCATIONS.with(|n| n.set(0));
        for revision in 2..102 {
            let mut changed = scene();
            changed.input_ports = Some(vec![
                Port {
                    node: if revision % 2 == 0 { 0 } else { 1 },
                    weight: 1. / 2f64.sqrt(),
                },
                Port {
                    node: 2,
                    weight: 1. / 2f64.sqrt(),
                },
            ]);
            changed.pickup_ports = Some(vec![
                Port {
                    node: 0,
                    weight: 0.25,
                },
                Port {
                    node: 1,
                    weight: 0.75,
                },
            ]);
            let clock = e.clock;
            let phase = e.pitch_phase;
            let weights = e.graph.as_ref().unwrap().input_weights.clone();
            let write: Vec<_> = e
                .graph
                .as_ref()
                .unwrap()
                .edges
                .iter()
                .map(|edge| edge.write)
                .collect();
            e.begin(changed, revision).unwrap();
            assert_eq!(e.clock, clock);
            assert_eq!(e.pitch_phase, phase);
            let g = e.graph.as_ref().unwrap();
            assert_eq!(g.input_weights, weights);
            for (index, edge) in g.edges.iter().enumerate() {
                assert_eq!((edge.ab.as_ptr(), edge.ba.as_ptr()), ring_pointers[index]);
                assert_eq!(edge.write, write[index]);
            }
            assert!(e.old.is_none() && e.pending.is_none());
            WATCH.with(|flag| flag.set(true));
            e.process(&input, &input, &mut left, &mut right);
            WATCH.with(|flag| flag.set(false));
            let g = e.graph.as_ref().unwrap();
            assert!(
                g.input_weights
                    .iter()
                    .map(|weight| weight * weight)
                    .sum::<f64>()
                    <= 1. + 1e-9
            );
            assert!(
                g.pickup_weights
                    .iter()
                    .map(|weight| weight.abs())
                    .sum::<f64>()
                    <= 1. + 1e-9
            );
        }
        assert_eq!(e.clock, first_clock + 100 * 128);
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert!(left
            .iter()
            .all(|value| value.is_finite() && value.abs() <= 0.94));
    }
    #[test]
    fn boundary_absorbs_only_leaf_reflections_and_leaves_junction_scattering_unchanged() {
        for boundary in [0., 0.3, 1.] {
            let mut e = Engine::new(48000.);
            let mut s = scene();
            s.edges[0].length = 0.0001;
            s.edges[1].length = 0.0001;
            e.begin(s, 1).unwrap();
            while e.prepare(16) == 1 {}
            let g = e.graph.as_mut().unwrap();
            for edge in &mut g.edges {
                edge.delay = 1.;
                edge.loss = 1.;
                edge.loss_target = 1.;
            }
            let last = g.edges[0].ab.len() - 1;
            g.edges[0].ab[last] = 0.1;
            g.edges[0].ba[last] = 0.2;
            g.step(
                0.,
                48000.,
                0.05,
                1.,
                boundary,
                0.001,
                0.,
                0.,
                &e.pitch_window,
            );
            assert!((f64::from(g.edges[0].ab[0]) - 0.2 * boundary).abs() < 1e-8);
            assert!((f64::from(g.edges[1].ab[0]) - 0.1).abs() < 1e-8);
            assert!(g.edges[0].ba[0].abs() < 1e-8);
        }
    }
    #[test]
    fn released_many_ports_converge_exactly_without_callback_allocation() {
        const PORTS: usize = 1024;
        let make_scene = |spread| Scene {
            nodes: (0..=PORTS)
                .map(|id| Point {
                    id: id as u32,
                    x: 0.,
                    y: 0.,
                })
                .collect(),
            edges: (1..=PORTS)
                .map(|node| Link {
                    id: node as u32,
                    a: 0,
                    b: node,
                    length: 0.0001,
                })
                .collect(),
            input_node: 1,
            pickup_node: 1,
            input_ports: if spread {
                Some(
                    (1..=PORTS)
                        .map(|node| Port {
                            node,
                            weight: 1. / (PORTS as f64).sqrt(),
                        })
                        .collect(),
                )
            } else {
                None
            },
            pickup_ports: if spread {
                Some(
                    (1..=PORTS)
                        .map(|node| Port {
                            node,
                            weight: 1. / PORTS as f64,
                        })
                        .collect(),
                )
            } else {
                None
            },
            reserve_time_ms: 0.05,
            memory_budget_bytes: 1024 * 1024,
        };
        let mut e = Engine::new(48000.);
        e.parameters.time_ms = 0.05;
        e.time = 0.05;
        e.begin(make_scene(true), 1).unwrap();
        while e.prepare(16) == 1 {}
        e.begin(make_scene(false), 2).unwrap();
        let zero = [0f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        ALLOCATIONS.with(|n| n.set(0));
        WATCH.with(|flag| flag.set(true));
        for _ in 0..400 {
            e.process(&zero, &zero, &mut left, &mut right);
        }
        WATCH.with(|flag| flag.set(false));
        let g = e.graph.as_ref().unwrap();
        assert_eq!(g.input_weights, g.input_targets);
        assert_eq!(g.pickup_weights, g.pickup_targets);
        assert!(g.input_weights[2..].iter().all(|value| *value == 0.));
        assert!(g.pickup_weights[2..].iter().all(|value| *value == 0.));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert_eq!(e.clock, 400 * 128);
    }
    #[test]
    fn silent_waveguide_and_pitch_histories_flush_denormals_without_resetting_clock() {
        let mut e = Engine::new(48000.);
        let mut s = scene();
        s.edges[0].length = 0.0001;
        s.edges[1].length = 0.0001;
        s.reserve_time_ms = 0.05;
        e.parameters.time_ms = 0.05;
        e.time = 0.05;
        e.begin(s, 1).unwrap();
        while e.prepare(16) == 1 {}
        for edge in &mut e.graph.as_mut().unwrap().edges {
            edge.ab.fill(1e-40);
            edge.ba.fill(-1e-40);
            edge.level = 1e-40;
        }
        e.pitch_left.fill(1e-40);
        e.pitch_right.fill(-1e-40);
        e.hp_last_output = [1e-310; 2];
        e.lp_last = [1e-310; 2];
        e.compressor_envelope = 1e-310;
        let zero = [0f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        for _ in 0..160 {
            e.process(&zero, &zero, &mut left, &mut right);
        }
        for edge in &e.graph.as_ref().unwrap().edges {
            assert!(edge.ab.iter().chain(&edge.ba).all(|value| *value == 0.));
            assert_eq!(edge.level, 0.);
        }
        assert!(e
            .pitch_left
            .iter()
            .chain(&e.pitch_right)
            .all(|value| *value == 0.));
        assert_eq!(e.hp_last_output, [0.; 2]);
        assert_eq!(e.lp_last, [0.; 2]);
        assert_eq!(e.compressor_envelope, 0.);
        assert!(left.iter().chain(&right).all(|value| *value == 0.));
        assert_eq!(e.clock, 160 * 128);
    }
    #[test]
    fn cleanup_preserves_follower_arithmetic_and_wave_samples_above_inaudible_thresholds() {
        let coefficient = 1. - (-1. / (48000. * 0.035f64)).exp();
        let mut actual = 0.8;
        let mut original = actual;
        for _ in 0..10000 {
            original += (0.1 - original) * coefficient;
            follow(&mut actual, 0.1, coefficient);
            assert_eq!(actual, original);
        }
        for value in [-0.7, -WAVE_FLOOR, WAVE_FLOOR, 0.7] {
            assert_eq!(Graph::safe(value), value);
        }
        assert_eq!(Graph::safe(WAVE_FLOOR * 0.5), 0.);
        assert_eq!(Graph::safe(-WAVE_FLOOR * 0.5), 0.);
        let mut current = FOLLOW_EPSILON * 0.5;
        follow(&mut current, 0., coefficient);
        assert_eq!(current, 0.);
    }
    fn delay_gain_engine(db: f64, wet: f64, dry: f64) -> Engine {
        let mut e = Engine::new(48000.);
        e.controls(Controls {
            parameters: Some(Parameters {
                time_ms: 10.,
                decay: 1.,
                coupling: 1.,
                boundary: 0.,
                ..Parameters::default()
            }),
            performance: Some(Performance {
                input_drive_db: 0.,
                delay_gain_db: db,
                wet,
                dry,
                hpf_hz: 0.,
                lpf_hz: 22000.,
                compressor_ratio: 1.,
                output_boost_db: 0.,
                output_level: 1.,
                ..Performance::default()
            }),
            input_mode: Some("media".into()),
        })
        .unwrap();
        let zero = [0f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        for _ in 0..400 {
            e.process(&zero, &zero, &mut left, &mut right);
        }
        e.begin(scene(), 1).unwrap();
        while e.prepare(16) == 1 {}
        e
    }
    #[test]
    fn receiver_gain_obeys_decibel_law_on_real_delayed_pressure() {
        let mut reference = delay_gain_engine(0., 1., 0.);
        let mut impulse = [0f32; 512];
        impulse[0] = 0.0001;
        let mut baseline = [0f32; 512];
        let mut right = [0f32; 512];
        reference.process(&impulse, &impulse, &mut baseline, &mut right);
        let onset = baseline.iter().position(|v| v.abs() > 1e-6).unwrap();
        assert_eq!(onset, 144);
        for db in [-12., 12., 24.] {
            let mut e = delay_gain_engine(db, 1., 0.);
            let mut pcm = [0f32; 512];
            e.process(&impulse, &impulse, &mut pcm, &mut right);
            assert_eq!(pcm.iter().position(|v| v.abs() > 1e-6).unwrap(), onset);
            // Undo only the shared final safety ceiling to inspect linear gain.
            let pressure = 0.94 * (f64::from(pcm[onset]) / 0.94).atanh();
            let original = 0.94 * (f64::from(baseline[onset]) / 0.94).atanh();
            assert!((pressure / original - 10f64.powf(db / 20.)).abs() < 1e-5);
        }
    }
    #[test]
    fn receiver_gain_leaves_dry_pcm_and_feedback_histories_identical() {
        let mut quiet = delay_gain_engine(-12., 0., 1.);
        let mut loud = delay_gain_engine(48., 0., 1.);
        let mut a = [0f32; 128];
        let mut b = [0f32; 128];
        let mut right = [0f32; 128];
        for block in 0..100 {
            let input: [f32; 128] = std::array::from_fn(|i| {
                (0.03 * (TAU * 173. * (block * 128 + i) as f64 / 48000.).sin()) as f32
            });
            quiet.process(&input, &input, &mut a, &mut right);
            loud.process(&input, &input, &mut b, &mut right);
            assert_eq!(a, b);
        }
        assert_eq!(quiet.clock, loud.clock);
        for (a, b) in quiet
            .graph
            .as_ref()
            .unwrap()
            .edges
            .iter()
            .zip(&loud.graph.as_ref().unwrap().edges)
        {
            assert_eq!(a.ab, b.ab);
            assert_eq!(a.ba, b.ba);
            assert_eq!(a.write, b.write);
        }
    }
    #[test]
    fn live_receiver_gain_is_smoothed_bounded_and_allocation_free_without_resetting_state() {
        let mut e = delay_gain_engine(0., 1., 0.);
        e.parameters.pitch_offset = 12.;
        let input = [0.2f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        for _ in 0..100 {
            e.process(&input, &input, &mut left, &mut right);
        }
        let clock = e.clock;
        let phase = e.pitch_phase;
        let pointer = e.graph.as_ref().unwrap().edges[0].ab.as_ptr();
        let write = e.graph.as_ref().unwrap().edges[0].write;
        let before = e.delay_gain;
        let mut p = e.performance.clone();
        p.delay_gain_db = 48.;
        e.controls(Controls {
            parameters: None,
            performance: Some(p),
            input_mode: None,
        })
        .unwrap();
        assert_eq!(e.clock, clock);
        assert_eq!(e.pitch_phase, phase);
        assert_eq!(e.delay_gain, before);
        assert_eq!(e.graph.as_ref().unwrap().edges[0].write, write);
        ALLOCATIONS.with(|n| n.set(0));
        WATCH.with(|flag| flag.set(true));
        e.process(&input[..1], &input[..1], &mut left[..1], &mut right[..1]);
        WATCH.with(|flag| flag.set(false));
        assert_eq!(
            e.delay_gain,
            before + (10f64.powf(48. / 20.) - before) * e.smooth
        );
        WATCH.with(|flag| flag.set(true));
        for _ in 0..400 {
            e.process(&input, &input, &mut left, &mut right);
            assert!(left
                .iter()
                .chain(&right)
                .all(|v| v.is_finite() && v.abs() <= 0.94));
        }
        WATCH.with(|flag| flag.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert_eq!(e.graph.as_ref().unwrap().edges[0].ab.as_ptr(), pointer);
        assert_eq!(e.clock, clock + 1 + 400 * 128);
        assert_eq!(e.revision, 1);
        assert!(e.pending.is_none() && e.old.is_none());
    }
    #[test]
    fn legacy_performance_defaults_receiver_gain_and_invalid_edits_are_transactional() {
        let legacy: Performance =
            serde_json::from_str(r#"{"inputGain":0.85,"wet":0.7,"dry":0.3}"#).unwrap();
        assert_eq!(legacy.delay_gain_db, 24.);
        let mut e = delay_gain_engine(0., 1., 0.);
        for db in [-12.1, 48.1, f64::NAN, f64::INFINITY] {
            let mut p = e.performance.clone();
            p.delay_gain_db = db;
            let clock = e.clock;
            assert!(e
                .controls(Controls {
                    parameters: None,
                    performance: Some(p),
                    input_mode: None
                })
                .is_err());
            assert_eq!(e.performance.delay_gain_db, 0.);
            assert_eq!(e.clock, clock);
        }
    }
    fn input_drive_engine(db: f64, wet: f64, dry: f64) -> Engine {
        let mut e = delay_gain_engine(0., wet, dry);
        let mut p = e.performance.clone();
        p.input_drive_db = db;
        e.controls(Controls {
            parameters: None,
            performance: Some(p),
            input_mode: None,
        })
        .unwrap();
        let zero = [0f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        for _ in 0..400 {
            e.process(&zero, &zero, &mut left, &mut right);
        }
        e
    }
    #[test]
    fn input_drive_changes_real_wave_pressure_and_delay_pcm_by_the_decibel_law() {
        let mut baseline = input_drive_engine(0., 1., 0.);
        let mut impulse = [0f32; 512];
        impulse[0] = 0.0001;
        let mut original = [0f32; 512];
        let mut right = [0f32; 512];
        let write = baseline.graph.as_ref().unwrap().edges[0].write;
        baseline.process(&impulse, &impulse, &mut original, &mut right);
        let wave = baseline.graph.as_ref().unwrap().edges[0].ab[write];
        let onset = original.iter().position(|v| v.abs() > 1e-6).unwrap();
        assert_eq!(onset, 144);
        for db in [-12., 12., 24.] {
            let mut e = input_drive_engine(db, 1., 0.);
            let write = e.graph.as_ref().unwrap().edges[0].write;
            let mut pcm = [0f32; 512];
            e.process(&impulse, &impulse, &mut pcm, &mut right);
            let ratio = 10f64.powf(db / 20.);
            assert!(
                (f64::from(e.graph.as_ref().unwrap().edges[0].ab[write]) / f64::from(wave) - ratio)
                    .abs()
                    < 1e-5
            );
            let pressure = 0.94 * (f64::from(pcm[onset]) / 0.94).atanh();
            let reference = 0.94 * (f64::from(original[onset]) / 0.94).atanh();
            assert!((pressure / reference - ratio).abs() < 1e-5);
            assert_eq!(
                e.metrics[3], baseline.metrics[3],
                "source metering is before network-only drive"
            );
            assert_eq!(pcm.iter().position(|v| v.abs() > 1e-6).unwrap(), onset);
        }
    }
    #[test]
    fn input_drive_preserves_direct_stereo_media_pcm_and_source_metering() {
        let mut quiet = input_drive_engine(-12., 0., 1.);
        let mut loud = input_drive_engine(24., 0., 1.);
        let mut a_left = [0f32; 128];
        let mut a_right = [0f32; 128];
        let mut b_left = [0f32; 128];
        let mut b_right = [0f32; 128];
        for block in 0..100 {
            let left = std::array::from_fn::<_, 128, _>(|i| {
                (0.03 * (TAU * 173. * (block * 128 + i) as f64 / 48000.).sin()) as f32
            });
            let right = std::array::from_fn::<_, 128, _>(|i| {
                (0.02 * (TAU * 271. * (block * 128 + i) as f64 / 48000.).cos()) as f32
            });
            quiet.process(&left, &right, &mut a_left, &mut a_right);
            loud.process(&left, &right, &mut b_left, &mut b_right);
            assert_eq!(a_left, b_left);
            assert_eq!(a_right, b_right);
            assert_eq!(quiet.metrics[3], loud.metrics[3]);
        }
        assert_ne!(a_left, a_right);
    }
    #[test]
    fn drive_edits_do_not_amplify_existing_feedback_waves_when_excitation_stops() {
        let mut baseline = input_drive_engine(0., 1., 0.);
        let mut changed = input_drive_engine(0., 1., 0.);
        for e in [&mut baseline, &mut changed] {
            e.parameters.boundary = 1.;
            e.boundary = 1.;
        }
        let mut impulse = [0f32; 128];
        impulse[0] = 0.01;
        let zero = [0f32; 128];
        let mut a = [0f32; 128];
        let mut b = [0f32; 128];
        let mut right = [0f32; 128];
        baseline.process(&impulse, &impulse, &mut a, &mut right);
        changed.process(&impulse, &impulse, &mut b, &mut right);
        let mut p = changed.performance.clone();
        p.input_drive_db = 24.;
        changed
            .controls(Controls {
                parameters: None,
                performance: Some(p),
                input_mode: None,
            })
            .unwrap();
        let mut tail_energy = 0.;
        for _ in 0..100 {
            baseline.process(&zero, &zero, &mut a, &mut right);
            changed.process(&zero, &zero, &mut b, &mut right);
            assert_eq!(a, b);
            tail_energy += a.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>();
        }
        assert!(tail_energy > 0.001);
        for (a, b) in baseline
            .graph
            .as_ref()
            .unwrap()
            .edges
            .iter()
            .zip(&changed.graph.as_ref().unwrap().edges)
        {
            assert_eq!(a.ab, b.ab);
            assert_eq!(a.ba, b.ba);
            assert_eq!(a.write, b.write);
        }
    }
    #[test]
    fn live_drive_is_smoothed_bounded_and_allocation_free_without_rebuilding_histories() {
        let mut e = input_drive_engine(0., 1., 0.);
        let input = [4f32; 128];
        let mut left = [0f32; 128];
        let mut right = [0f32; 128];
        e.parameters.pitch_offset = 12.;
        for _ in 0..100 {
            e.process(&input, &input, &mut left, &mut right);
        }
        let clock = e.clock;
        let phase = e.pitch_phase;
        let pointer = e.graph.as_ref().unwrap().edges[0].ab.as_ptr();
        let capacity = e.graph.as_ref().unwrap().edges[0].ab.capacity();
        let write = e.graph.as_ref().unwrap().edges[0].write;
        let before = e.input_drive;
        let mut p = e.performance.clone();
        p.input_drive_db = 24.;
        p.delay_gain_db = 48.;
        e.controls(Controls {
            parameters: None,
            performance: Some(p),
            input_mode: None,
        })
        .unwrap();
        assert_eq!(e.clock, clock);
        assert_eq!(e.pitch_phase, phase);
        assert_eq!(e.input_drive, before);
        assert_eq!(e.graph.as_ref().unwrap().edges[0].write, write);
        ALLOCATIONS.with(|n| n.set(0));
        WATCH.with(|flag| flag.set(true));
        e.process(&input[..1], &input[..1], &mut left[..1], &mut right[..1]);
        WATCH.with(|flag| flag.set(false));
        assert_eq!(
            e.input_drive,
            before + (10f64.powf(24. / 20.) - before) * e.smooth
        );
        WATCH.with(|flag| flag.set(true));
        for _ in 0..400 {
            e.process(&input, &input, &mut left, &mut right);
            assert!(left
                .iter()
                .chain(&right)
                .all(|v| v.is_finite() && v.abs() <= 0.94));
        }
        WATCH.with(|flag| flag.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        let edge = &e.graph.as_ref().unwrap().edges[0];
        assert_eq!(edge.ab.as_ptr(), pointer);
        assert_eq!(edge.ab.capacity(), capacity);
        assert_eq!(e.clock, clock + 1 + 400 * 128);
        assert_eq!(e.revision, 1);
        assert!(e.pending.is_none() && e.old.is_none());
    }
    #[test]
    fn legacy_drive_defaults_to_twelve_db_and_direct_output_defaults_off() {
        let legacy: Performance =
            serde_json::from_str(r#"{"inputGain":0.85,"wet":0.7,"delayGainDb":24}"#).unwrap();
        assert_eq!(legacy.input_drive_db, 12.);
        assert_eq!(legacy.dry, 0.);
        assert_eq!(Performance::default().dry, 0.);
        let mut e = input_drive_engine(0., 1., 0.);
        for db in [-12.1, 24.1, f64::NAN, f64::INFINITY] {
            let mut p = e.performance.clone();
            p.input_drive_db = db;
            let clock = e.clock;
            assert!(e
                .controls(Controls {
                    parameters: None,
                    performance: Some(p),
                    input_mode: None
                })
                .is_err());
            assert_eq!(e.performance.input_drive_db, 0.);
            assert_eq!(e.clock, clock);
        }
    }
    fn path_engine(mut s: Scene, time: f64, pitch: f64, tone: f64) -> Engine {
        let mut e = Engine::new(48000.);
        e.parameters.time_ms = time;
        e.parameters.decay = 1.;
        e.parameters.propagation = Propagation::Paths;
        e.parameters.geometry_pitch = pitch;
        e.parameters.turn_tone = tone;
        e.time = time;
        e.decay = 1.;
        e.path_mix = 1.;
        s.memory_budget_bytes = 64 * 1024 * 1024;
        e.begin(s, 1).unwrap();
        while e.prepare(16) != 2 {}
        e
    }
    #[test]
    fn path_impulses_arrive_at_exact_sum_of_line_lengths_without_instantaneous_pickup() {
        for (second_length, expected) in [(0.2, 144), (0.4, 240)] {
            let mut s = scene();
            s.edges[1].length = second_length;
            let mut e = path_engine(s, 10., 0., 0.);
            let g = e.graph.as_mut().unwrap();
            let mut onsets = Vec::new();
            for frame in 0..400 {
                let output = g.step(
                    if frame == 0 { 1. } else { 0. },
                    48000.,
                    10.,
                    1.,
                    0.,
                    e.smooth,
                    1.,
                    0.,
                    &e.pitch_window,
                );
                if output[0].abs() > 1e-8 {
                    onsets.push(frame);
                }
            }
            assert_eq!(onsets, vec![expected], "all travel is causal and additive");
        }
        let mut e = path_engine(scene(), 10., 0., 0.);
        let g = e.graph.as_mut().unwrap();
        let mut onsets = Vec::new();
        for frame in 0..200 {
            let output = g.step(
                if frame == 0 { 1. } else { 0. },
                48000.,
                10.,
                1.,
                0.,
                e.smooth,
                1.,
                1.,
                &e.pitch_window,
            );
            if output[0].abs() > 1e-8 {
                onsets.push(frame);
            }
        }
        assert_eq!(
            onsets,
            vec![48, 144],
            "whole-network taps expose successive real arrivals"
        );
    }
    #[test]
    fn path_junctions_split_without_polarity_reversal_and_remain_contractive() {
        for coupling in [0., 0.2, 0.82, 1.] {
            for arrivals in [[0.03, -0.1, 0.07], [0.1, 0., 0.]] {
                let mut s = scene();
                s.nodes.push(Point {
                    id: 3,
                    x: 0.,
                    y: 0.,
                });
                s.edges = vec![
                    Link {
                        id: 0,
                        a: 0,
                        b: 1,
                        length: 0.0001,
                    },
                    Link {
                        id: 1,
                        a: 2,
                        b: 1,
                        length: 0.0001,
                    },
                    Link {
                        id: 2,
                        a: 3,
                        b: 1,
                        length: 0.0001,
                    },
                ];
                let mut e = path_engine(s, 0.05, 0., 0.);
                let g = e.graph.as_mut().unwrap();
                for (edge, amplitude) in g.edges.iter_mut().zip(arrivals) {
                    let last = edge.ab.len() - 1;
                    edge.ab[last] = amplitude as f32;
                }
                g.step(
                    0.,
                    48000.,
                    0.05,
                    coupling,
                    1.,
                    e.smooth,
                    1.,
                    0.,
                    &e.pitch_window,
                );
                let outgoing: Vec<f64> = g.edges.iter().map(|edge| f64::from(edge.ba[0])).collect();
                let energy: f64 = outgoing.iter().map(|v| v * v).sum();
                let original: f64 = arrivals.iter().map(|v| v * v).sum();
                assert!(energy <= original + 1e-8);
                if arrivals[1] == 0. {
                    assert!(outgoing.iter().all(|v| *v >= 0.));
                    assert!((outgoing[0] - 0.1 * (1. - coupling)).abs() < 1e-7);
                    assert!((outgoing[1] - 0.05 * coupling).abs() < 1e-7);
                    assert!((outgoing[2] - 0.05 * coupling).abs() < 1e-7);
                }
            }
        }
    }
    #[test]
    fn an_impulse_circulates_the_complete_triangle_with_geometry_timed_feedback() {
        let mut s = scene();
        s.edges.push(Link {
            id: 2,
            a: 2,
            b: 0,
            length: 0.3,
        });
        s.pickup_node = 0;
        let mut e = path_engine(s, 10., 0., 0.);
        let g = e.graph.as_mut().unwrap();
        for edge in &mut g.edges {
            edge.loss = 0.8f64.powf(edge.link.length);
            edge.loss_target = edge.loss;
        }
        let mut arrivals = Vec::new();
        for frame in 0..900 {
            let output = g.step(
                if frame == 0 { 1. } else { 0. },
                48000.,
                10.,
                1.,
                1.,
                e.smooth,
                1.,
                0.,
                &e.pitch_window,
            );
            if output[0].abs() > 1e-6 {
                arrivals.push((frame, output[0]));
            }
        }
        assert_eq!(
            arrivals.iter().map(|a| a.0).collect::<Vec<_>>(),
            vec![288, 576, 864]
        );
        let expected_loss = 0.8f64.powf(0.6);
        assert!((arrivals[1].1 / arrivals[0].1 - expected_loss).abs() < 1e-6);
        assert!((arrivals[2].1 / arrivals[1].1 - expected_loss).abs() < 1e-6);
    }
    fn single_line(up: bool) -> Scene {
        let mut s = scene();
        s.nodes.truncate(2);
        s.nodes[1].y = if up { 1. } else { -1. };
        s.edges = vec![Link {
            id: 0,
            a: 0,
            b: 1,
            length: 1.,
        }];
        s.pickup_node = 1;
        s
    }
    #[test]
    fn angle_pitch_changes_real_arrivals_continuously_and_reverse_travel_is_reciprocal() {
        for (pitch, expected_ratio) in [(0., 1.), (7.2, 2f64.powf(0.6)), (12., 2.)] {
            for reverse in [false, true] {
                let mut s = single_line(true);
                if reverse {
                    s.input_node = 1;
                    s.pickup_node = 0;
                }
                let mut e = path_engine(s, 100., pitch, 0.);
                let g = e.graph.as_mut().unwrap();
                let mut previous = 0.;
                let mut crossings = 0;
                for frame in 0..48000 {
                    let input = 0.1 * (TAU * 440. * frame as f64 / 48000.).sin();
                    let value = g.step(
                        input,
                        48000.,
                        100.,
                        1.,
                        0.,
                        e.smooth,
                        1.,
                        0.,
                        &e.pitch_window,
                    )[0];
                    if frame >= 24000 && previous <= 0. && value > 0. {
                        crossings += 1;
                    }
                    previous = value;
                }
                let ratio = if reverse {
                    1. / expected_ratio
                } else {
                    expected_ratio
                };
                // Window wraps introduce carrier sidebands spaced by the grain
                // hop frequency. Check its derived resolution, not an invented
                // claim that this bounded granular effect is an exact FFT shift.
                let hop_hz = (ratio - 1.).abs() / 0.020;
                assert!(
                    (crossings as f64 * 2. - 440. * ratio).abs() <= hop_hz * 2. + 4.,
                    "continuous geometry ratio {ratio}, measured {} Hz",
                    crossings * 2
                );
                if pitch > 0. {
                    assert!(if reverse {
                        crossings * 2 < 440
                    } else {
                        crossings * 2 > 440
                    });
                }
                assert!((g.edges[0].travel[usize::from(reverse)].ratio - ratio).abs() < 1e-9);
                assert!(
                    (g.edges[0].travel[0].ratio_target * g.edges[0].travel[1].ratio_target - 1.)
                        .abs()
                        < 1e-12
                );
            }
        }
    }
    fn tone_rms(bent: bool, frequency: f64) -> f64 {
        let mut s = scene();
        s.nodes[1].x = 0.1;
        s.nodes[2].x = if bent { 0.1 } else { 0.3 };
        s.nodes[2].y = if bent { 0.2 } else { 0. };
        let mut e = path_engine(s, 10., 0., 0.8);
        let g = e.graph.as_mut().unwrap();
        let mut energy = 0.;
        for frame in 0..24000 {
            let input = 0.1 * (TAU * frequency * frame as f64 / 48000.).sin();
            let value = g.step(
                input,
                48000.,
                10.,
                1.,
                0.,
                e.smooth,
                1.,
                0.,
                &e.pitch_window,
            )[0];
            if frame >= 12000 {
                energy += value * value;
            }
        }
        (energy / 12000.).sqrt()
    }
    #[test]
    fn actual_junction_turns_darken_arrivals_while_retaining_low_frequency_energy() {
        let high = tone_rms(true, 6000.) / tone_rms(false, 6000.);
        let low = tone_rms(true, 220.) / tone_rms(false, 220.);
        assert!(high < 0.85, "bent/straight high-frequency RMS {high}");
        assert!(low > 0.95, "bent/straight low-frequency RMS {low}");
    }
    #[test]
    fn resonance_is_bit_identical_when_retained_path_controls_are_changed() {
        let mut reference = delay_gain_engine(0., 1., 0.);
        let mut changed = delay_gain_engine(0., 1., 0.);
        let mut parameters = changed.parameters.clone();
        parameters.geometry_pitch = 24.;
        parameters.tap_coverage = 1.;
        parameters.turn_tone = 1.;
        changed
            .controls(Controls {
                parameters: Some(parameters),
                performance: None,
                input_mode: None,
            })
            .unwrap();
        for block in 0..100 {
            let input = std::array::from_fn::<_, 128, _>(|frame| {
                (0.1 * (TAU * 731. * (block * 128 + frame) as f64 / 48000.).sin()) as f32
            });
            let mut a = [0.; 128];
            let mut ar = [0.; 128];
            let mut b = [0.; 128];
            let mut br = [0.; 128];
            reference.process(&input, &input, &mut a, &mut ar);
            changed.process(&input, &input, &mut b, &mut br);
            assert_eq!(a, b);
            assert_eq!(ar, br);
        }
    }
    #[test]
    fn adaptive_pitch_uses_only_existing_delay_reservation_and_never_reads_before_arrival() {
        for length in [0.00001, 0.0001, 0.01, 1., 16.] {
            let mut s = single_line(true);
            s.edges[0].length = length;
            let mut e = path_engine(s, 2000., 24., 0.);
            let g = e.graph.as_mut().unwrap();
            g.step(0., 48000., 2000., 1., 0., e.smooth, 1., 0., &e.pitch_window);
            let edge = &g.edges[0];
            assert_eq!(edge.ab.len(), ring_size(length, 48000., 2000.));
            assert_eq!(g.bytes, edge.ab.len() * 8);
            assert!(edge.grain * 1.25 <= edge.delay * 0.25 + 1e-9);
            assert!(edge.delay + edge.grain * 1.25 <= (edge.ab.len() - 2) as f64 + 1e-9);
            if edge.grain < 1. {
                assert_eq!(edge.travel[0].mix, 0.);
            }
        }
    }
    #[test]
    fn path_live_controls_preserve_phase_history_clock_and_allocate_nothing() {
        let mut e = path_engine(single_line(true), 100., 8., 0.3);
        let input = [0.02; 128];
        let mut left = [0.; 128];
        let mut right = [0.; 128];
        for _ in 0..100 {
            e.process(&input, &input, &mut left, &mut right);
        }
        let edge = &e.graph.as_ref().unwrap().edges[0];
        let pointer = edge.ab.as_ptr();
        let phase = edge.travel[0].phase;
        let write = edge.write;
        let clock = e.clock;
        let mut parameters = e.parameters.clone();
        parameters.geometry_pitch = 19.3;
        parameters.turn_tone = 0.9;
        parameters.tap_coverage = 1.;
        parameters.time_ms = 170.;
        e.controls(Controls {
            parameters: Some(parameters),
            performance: None,
            input_mode: None,
        })
        .unwrap();
        let edge = &e.graph.as_ref().unwrap().edges[0];
        assert_eq!(edge.travel[0].phase, phase);
        assert_eq!(edge.write, write);
        assert_eq!(edge.ab.as_ptr(), pointer);
        assert_eq!(e.clock, clock);
        ALLOCATIONS.with(|n| n.set(0));
        WATCH.with(|flag| flag.set(true));
        for _ in 0..200 {
            e.process(&input, &input, &mut left, &mut right);
        }
        WATCH.with(|flag| flag.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert_eq!(e.clock, clock + 200 * 128);
        assert_eq!(e.graph.as_ref().unwrap().edges[0].ab.as_ptr(), pointer);
        assert!(left
            .iter()
            .chain(&right)
            .all(|v| v.is_finite() && v.abs() <= 0.94));
        assert_eq!(e.graph.as_ref().unwrap().targets_remaining, 0);
    }
    #[test]
    fn legacy_propagation_defaults_and_path_control_validation_are_transactional() {
        let legacy: Parameters = serde_json::from_str(r#"{"timeMs":140}"#).unwrap();
        assert!(legacy.propagation == Propagation::Resonance);
        assert_eq!(legacy.geometry_pitch, 0.);
        assert_eq!(legacy.tap_coverage, 0.);
        assert_eq!(legacy.turn_tone, 0.);
        let mut e = Engine::new(48000.);
        for (pitch, coverage, tone) in [
            (-0.1, 0., 0.),
            (24.1, 0., 0.),
            (0., -0.1, 0.),
            (0., 1.1, 0.),
            (0., 0., 1.1),
            (f64::NAN, 0., 0.),
        ] {
            let mut parameters = e.parameters.clone();
            parameters.geometry_pitch = pitch;
            parameters.tap_coverage = coverage;
            parameters.turn_tone = tone;
            assert!(e
                .controls(Controls {
                    parameters: Some(parameters),
                    performance: None,
                    input_mode: None
                })
                .is_err());
            assert_eq!(e.parameters.geometry_pitch, 0.);
            assert_eq!(e.parameters.tap_coverage, 0.);
            assert_eq!(e.parameters.turn_tone, 0.);
        }
        assert!(serde_json::from_str::<Parameters>(r#"{"propagation":"unknown"}"#).is_err());
    }
    #[test]
    fn path_waveform_endpoints_are_the_actual_pitched_arrivals_and_outgoing_waves() {
        let mut e = path_engine(single_line(true), 100., 13., 0.7);
        let mut left = [0.; 128];
        let mut right = [0.; 128];
        for block in 0..200 {
            let input = std::array::from_fn::<_, 128, _>(|frame| {
                (0.1 * (TAU * 337. * (block * 128 + frame) as f64 / 48000.).sin()) as f32
            });
            e.process(&input, &input, &mut left, &mut right);
        }
        e.snapshot();
        let edge = &e.graph.as_ref().unwrap().edges[0];
        assert!(edge.travel[0].mix > 0.999);
        let a = Edge::read(&edge.ab, edge.write, 1.) + edge.incoming_ba;
        let b = edge.incoming_ab + Edge::read(&edge.ba, edge.write, 1.);
        assert_eq!(e.waveforms[0], a as f32);
        assert_eq!(e.waveforms[WAVEFORM - 1], b as f32);
        assert!(e.waveforms.iter().all(|v| v.is_finite()));
        assert!(e.waveforms.iter().any(|v| v.abs() > 1e-4));
    }
    #[test]
    fn expensive_live_targets_are_prepared_in_bounded_batches_and_scalar_edits_skip_them() {
        let mut e = path_engine(vertical_chain(73), 100., 8., 0.3);
        assert_eq!(e.graph.as_ref().unwrap().targets_remaining, 0);
        let previous = e.graph.as_ref().unwrap().edges[72].travel[0].ratio_target;
        let mut parameters = e.parameters.clone();
        parameters.geometry_pitch = 16.;
        ALLOCATIONS.with(|n| n.set(0));
        WATCH.with(|flag| flag.set(true));
        e.controls(Controls {
            parameters: Some(parameters),
            performance: None,
            input_mode: None,
        })
        .unwrap();
        WATCH.with(|flag| flag.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert_eq!(e.graph.as_ref().unwrap().target_cursor, 0);
        assert_eq!(e.graph.as_ref().unwrap().targets_remaining, 73);
        assert_eq!(
            e.graph.as_ref().unwrap().edges[72].travel[0].ratio_target,
            previous
        );
        let mut left = [0.; 128];
        let mut right = [0.; 128];
        let zero = [0.; 128];
        e.process(&zero, &zero, &mut left, &mut right);
        assert_eq!(e.graph.as_ref().unwrap().target_cursor, 64);
        assert_eq!(
            e.graph.as_ref().unwrap().edges[72].travel[0].ratio_target,
            previous
        );
        e.process(&zero, &zero, &mut left, &mut right);
        assert_eq!(e.graph.as_ref().unwrap().target_cursor, 0);
        assert_eq!(e.graph.as_ref().unwrap().targets_remaining, 0);
        assert_ne!(
            e.graph.as_ref().unwrap().edges[72].travel[0].ratio_target,
            previous
        );
        let mut parameters = e.parameters.clone();
        parameters.time_ms = 200.;
        parameters.tap_coverage = 0.9;
        parameters.coupling = 0.7;
        e.controls(Controls {
            parameters: Some(parameters),
            performance: None,
            input_mode: None,
        })
        .unwrap();
        assert_eq!(
            e.graph.as_ref().unwrap().targets_remaining,
            0,
            "timing, coverage and coupling do not recalculate per-edge pitch/filter coefficients"
        );
    }
    fn vertical_chain(count: usize) -> Scene {
        let mut s = scene();
        s.nodes = (0..=count)
            .map(|index| Point {
                id: index as u32,
                x: 0.,
                y: index as f64 * 0.002,
            })
            .collect();
        s.edges = (0..count)
            .map(|index| Link {
                id: index as u32,
                a: index,
                b: index + 1,
                length: 0.002,
            })
            .collect();
        s.pickup_node = count;
        s.memory_budget_bytes = 64 * 1024 * 1024;
        s
    }
    #[test]
    fn continuous_dense_control_edits_visit_late_edges_without_starving_or_allocating() {
        const EDGES: usize = 1025; // More than 384 targets fit between 60 Hz edits.
        let mut e = path_engine(vertical_chain(EDGES), 100., 8., 0.3);
        let zero = [0.; 128];
        let mut left = [0.; 128];
        let mut right = [0.; 128];
        let mut late_updates = 0;
        let mut previous_late = e.graph.as_ref().unwrap().edges[EDGES - 1].travel[0].ratio_target;
        ALLOCATIONS.with(|n| n.set(0));
        WATCH.with(|flag| flag.set(true));
        for edit in 0..12 {
            let mut parameters = e.parameters.clone();
            parameters.geometry_pitch = 2. + edit as f64 * 1.3;
            parameters.decay = 0.7 + edit as f64 * 0.01;
            parameters.turn_tone = 0.25 + edit as f64 * 0.03;
            let cursor = e.graph.as_ref().unwrap().target_cursor;
            e.controls(Controls {
                parameters: Some(parameters),
                performance: None,
                input_mode: None,
            })
            .unwrap();
            assert_eq!(e.graph.as_ref().unwrap().target_cursor, cursor);
            assert_eq!(e.graph.as_ref().unwrap().targets_remaining, EDGES);
            // Six 128-frame blocks at 48 kHz = 16 ms: a continuous ~60 Hz drag.
            for _ in 0..6 {
                let graph = e.graph.as_ref().unwrap();
                let cursor = graph.target_cursor;
                let remaining = graph.targets_remaining;
                e.process(&zero, &zero, &mut left, &mut right);
                let graph = e.graph.as_ref().unwrap();
                let changed = remaining.min(64);
                assert_eq!(graph.target_cursor, (cursor + changed) % EDGES);
                assert_eq!(graph.targets_remaining, remaining - changed);
                let late = graph.edges[EDGES - 1].travel[0].ratio_target;
                if late != previous_late {
                    late_updates += 1;
                    assert!((late - 2f64.powf(e.parameters.geometry_pitch / 12.)).abs() < 1e-12);
                    previous_late = late;
                }
            }
        }
        WATCH.with(|flag| flag.set(false));
        assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
        assert!(
            late_updates >= 4,
            "the final edge must follow the ongoing gesture"
        );
        let mut blocks = 0;
        while e.graph.as_ref().unwrap().targets_remaining > 0 {
            let remaining = e.graph.as_ref().unwrap().targets_remaining;
            e.process(&zero, &zero, &mut left, &mut right);
            assert_eq!(
                e.graph.as_ref().unwrap().targets_remaining,
                remaining - remaining.min(64)
            );
            blocks += 1;
            assert!(blocks <= EDGES.div_ceil(64));
        }
        let ratio = 2f64.powf(e.parameters.geometry_pitch / 12.);
        let loss = e.parameters.decay.powf(0.002);
        for edge in &e.graph.as_ref().unwrap().edges {
            assert!((edge.travel[0].ratio_target - ratio).abs() < 1e-12);
            assert!((edge.travel[1].ratio_target - 1. / ratio).abs() < 1e-12);
            assert!((edge.loss_target - loss).abs() < 1e-12);
        }
    }
    #[test]
    fn continuous_control_edits_do_not_restart_atomic_coefficient_preparation() {
        const EDGES: usize = 1025;
        let mut e = path_engine(scene(), 100., 8., 0.3);
        e.begin(vertical_chain(EDGES), 2).unwrap();
        let zero = [0.; 128];
        let mut left = [0.; 128];
        let mut right = [0.; 128];
        let mut previous_prepared = 0;
        let maximum_steps = 2 * EDGES.div_ceil(16) + 2;
        let mut installed = false;
        for edit in 0..maximum_steps {
            let mut parameters = e.parameters.clone();
            parameters.geometry_pitch = 2. + (edit % 20) as f64;
            parameters.decay = 0.7 + (edit % 20) as f64 * 0.01;
            e.controls(Controls {
                parameters: Some(parameters),
                performance: None,
                input_mode: None,
            })
            .unwrap();
            assert_eq!(
                e.pending.as_ref().unwrap().coefficients_prepared,
                previous_prepared
            );
            e.process(&zero, &zero, &mut left, &mut right);
            if e.prepare(16) == 2 {
                installed = true;
                break;
            }
            let prepared = e.pending.as_ref().unwrap().coefficients_prepared;
            assert!(prepared >= previous_prepared);
            assert!(prepared - previous_prepared <= 16);
            previous_prepared = prepared;
        }
        assert!(
            installed,
            "one complete graph must install during an ongoing gesture"
        );
        assert_eq!(e.revision, 2);
        assert_eq!(e.graph.as_ref().unwrap().edges.len(), EDGES);
        assert_eq!(e.graph.as_ref().unwrap().targets_remaining, EDGES);
        for _ in 0..EDGES.div_ceil(64) {
            e.process(&zero, &zero, &mut left, &mut right);
        }
        let graph = e.graph.as_ref().unwrap();
        assert_eq!(graph.targets_remaining, 0);
        let ratio = 2f64.powf(e.parameters.geometry_pitch / 12.);
        assert!(graph
            .edges
            .iter()
            .all(|edge| (edge.travel[0].ratio_target - ratio).abs() < 1e-12));
        assert!(left.iter().chain(&right).all(|value| value.is_finite()));
    }
    #[test]
    fn geometry_pitch_crossing_unity_preserves_read_heads_and_actual_pcm() {
        let window =
            std::array::from_fn(|i| 0.5 - 0.5 * (TAU * i as f64 / PITCH_WINDOW as f64).cos());
        let history: Vec<f32> = (0..8192).map(|index| index as f32 / 8192.).collect();
        let mut direction = Direction::new(0.37);
        direction.mix = 1.;
        direction.ratio = 1. - 1e-6;
        let before = direction.sample(&history, 6000, 2400., 480., &window);
        direction.ratio = 1. + 1e-6;
        let after = direction.sample(&history, 6000, 2400., 480., &window);
        assert_eq!(
            before, after,
            "changing pitch direction must not relocate the read heads"
        );
        // A real live crossing has a target farther beyond unity while the
        // current smoothed ratio passes through it; keep the pitch mix active.
        let smoothing = 1. - (-1f64 / (48000. * 0.035)).exp();
        direction.ratio = 1. - 1e-6;
        direction.ratio_target = direction.ratio + 2e-6 / smoothing;
        let phase = direction.phase;
        direction.advance(1., 480., smoothing);
        assert!((direction.ratio - (1. + 1e-6)).abs() < 1e-12);
        assert!((direction.phase - phase - 1e-6 / 480.).abs() < 1e-15);
        let next = direction.sample(&history, 6000, 2400., 480., &window);
        assert!(
            (next - after).abs() < 1e-9,
            "only the continuous read motion changes PCM"
        );
    }
    #[test]
    fn signed_grain_motion_retains_forward_and_reverse_pitch_rate_and_causal_lookback() {
        for ratio in [0.25, 0.5, 0.999, 1.001, 2., 4.] {
            let mut direction = Direction::new(0.37);
            direction.mix = 1.;
            direction.ratio = ratio;
            direction.ratio_target = ratio;
            let grain = 480.;
            let base = 2400.;
            let previous_delay = base + grain * (0.25 + 1. - direction.phase);
            direction.advance(1., grain, 1.);
            let next_delay = base + grain * (0.25 + 1. - direction.phase);
            let read_rate = 1. - (next_delay - previous_delay);
            assert!(
                (read_rate - ratio).abs() < 1e-10,
                "one sample of write motion must produce the declared fractional read rate"
            );
            assert!(next_delay >= base && next_delay <= base + grain * 1.25);
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn fd_retired_count(ptr: usize) -> usize {
    let e = engine(ptr);
    e.retired.len() + usize::from(e.old.is_some())
}
#[no_mangle]
pub unsafe extern "C" fn fd_reserve_memory(ptr: usize, bytes: usize) -> i32 {
    if bytes > 512 * 1024 * 1024 {
        return 0;
    }
    let values = Vec::<MaybeUninit<u8>>::with_capacity(bytes);
    std::hint::black_box(values.as_ptr());
    drop(values);
    let _ = engine(ptr);
    1
}
