//! Genuine bidirectional digital waveguides: each edge owns two travelling-wave
//! histories; equal-impedance Kirchhoff scattering connects the actual graph.
//! Convex reflection/scattering blending is contractive for 0 <= coupling <= 1.
//! Geometry is an artistic resonator, not an acoustically validated fractal room.
//! Input policy and two-window wet transposition follow L-system Delay's browser
//! instrument, while its shared-history tap renderer is deliberately not reused.
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::f64::consts::TAU;
use std::mem::MaybeUninit;

const MAX_EDGES: usize = 16384;
const WAVEFORM: usize = 32;
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
    level: f32,
    history_source: Option<usize>,
    history_clock: u64,
}
impl Edge {
    fn read(buffer: &[f32], write: usize, delay: f64) -> f64 {
        let size = buffer.len();
        let position = (write as f64 - delay.clamp(1., (size - 2) as f64)).rem_euclid(size as f64);
        let i = position.floor() as usize;
        let fraction = position - i as f64;
        f64::from(buffer[i]) * (1. - fraction) + f64::from(buffer[(i + 1) % size]) * fraction
    }
    fn at(&self, distance_from_a: f64) -> f64 {
        Self::read(&self.ab, self.write, (self.delay * distance_from_a).max(1.))
            + Self::read(
                &self.ba,
                self.write,
                (self.delay * (1. - distance_from_a)).max(1.),
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
    pan: Vec<[f64; 2]>,
    edges: Vec<Edge>,
    reserve_ms: f64,
    bytes: usize,
}
impl Graph {
    fn step(
        &mut self,
        input: f64,
        rate: f64,
        time_ms: f64,
        coupling: f64,
        boundary: f64,
        smooth: f64,
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
            e.incoming_ab = Self::safe(Edge::read(&e.ab, e.write, e.delay) * e.loss);
            e.incoming_ba = Self::safe(Edge::read(&e.ba, e.write, e.delay) * e.loss);
            self.pressure[e.link.b] += e.incoming_ab;
            self.pressure[e.link.a] += e.incoming_ba;
        }
        let mut pickup = [0.; 2];
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
        }
        for e in &mut self.edges {
            let reflected_a = (1. - coupling) * e.incoming_ba
                + coupling * (self.pressure[e.link.a] - e.incoming_ba);
            let reflected_b = (1. - coupling) * e.incoming_ab
                + coupling * (self.pressure[e.link.b] - e.incoming_ab);
            // A leaf may absorb incoming energy without attenuating the external
            // excitation. Per-node 1/sqrt(degree) injection makes a unit-L2 port
            // vector inject at most one source's energy across all directions.
            let a = reflected_a
                * if self.degrees[e.link.a] == 1. {
                    boundary
                } else {
                    1.
                }
                + input * self.input_weights[e.link.a] * self.input_scale[e.link.a];
            let b = reflected_b
                * if self.degrees[e.link.b] == 1. {
                    boundary
                } else {
                    1.
                }
                + input * self.input_weights[e.link.b] * self.input_scale[e.link.b];
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
        pickup
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
}
struct Preparation {
    scene: Scene,
    graph: Graph,
    reuse: HashMap<u32, usize>,
    cursor: usize,
    partial: Option<PartialEdge>,
}

#[derive(Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Parameters {
    time_ms: f64,
    decay: f64,
    coupling: f64,
    boundary: f64,
    pitch_offset: f64,
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
            frozen: false,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Performance {
    input_gain: f64,
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
            delay_gain_db: 24.,
            wet: 0.7,
            dry: 0.3,
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
    mic_gain: f64,
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
            mic_gain: p.input_gain,
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
            self.parameters = p;
            if let Some(g) = &mut self.graph {
                for e in &mut g.edges {
                    e.loss_target = self.parameters.decay.powf(e.link.length);
                }
            }
            if let Some(g) = &mut self.old {
                for e in &mut g.edges {
                    e.loss_target = self.parameters.decay.powf(e.link.length);
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
                    edge.loss_target = self.parameters.decay.powf(edge.link.length);
                }
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
        let graph = Graph {
            nodes: scene.nodes.clone(),
            input_scale: degree.iter().map(|n: &f64| 1. / n.max(1.).sqrt()).collect(),
            degrees: degree,
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
                    level: 0.,
                    history_source: partial.source,
                    history_clock: partial.source_clock,
                };
                if let Some(old) = old {
                    edge.delay = old.delay.min((size - 2) as f64);
                    edge.delay_velocity = old.delay_velocity;
                    edge.loss = old.loss;
                    edge.level = old.level;
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
            p.graph.edges.push(partial.ready.take().unwrap());
            p.partial = None;
            p.cursor += 1;
        }
        if p.cursor != p.scene.edges.len() {
            return 1;
        }
        let p = self.pending.take().unwrap();
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
        let s = self.smooth;
        let ratio_target = 2f64.powf(self.parameters.pitch_offset / 12.);
        let output_target =
            self.performance.output_level * 10f64.powf(self.performance.output_boost_db / 20.);
        let delay_gain_target = 10f64.powf(self.performance.delay_gain_db / 20.);
        self.metrics[3] = 0.;
        self.metrics[4] = 0.;
        self.metrics[5] = 0.;
        for i in 0..out_l.len() {
            follow(&mut self.time, self.parameters.time_ms, s);
            follow(&mut self.decay, self.parameters.decay, s);
            follow(&mut self.coupling, self.parameters.coupling, s);
            follow(&mut self.boundary, self.parameters.boundary, s);
            follow(&mut self.ratio, ratio_target, s);
            follow(&mut self.mic_gain, self.performance.input_gain, s);
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
                (input[0] + input[1]) * 0.5
            };
            let current = self.graph.as_mut().map_or([0.; 2], |g| {
                g.step(
                    injected,
                    self.rate,
                    self.time,
                    self.coupling,
                    self.boundary,
                    s,
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
                        e.at(j as f64 / (WAVEFORM - 1) as f64) as f32;
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
            g.step(0., 48000., 0.05, coupling, 1., 0.001);
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
                g.step(0.1, 48000., 10., coupling, boundary, e.smooth);
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
            g.step(0., 48000., 0.05, 1., boundary, 0.001);
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
