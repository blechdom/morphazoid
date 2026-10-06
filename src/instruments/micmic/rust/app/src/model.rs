//! Original L-system Delay geometry and inherited acoustic rewrites.
//! Compilation and priority sorting run on the control thread. Stable audio
//! slots survive pruning; the Pythagorean canopy has no 128-branch stage cap.
use l_system_delay_core::PoolTarget;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[path = "lab.rs"]
mod lab;
pub use lab::LabParameters;

#[cfg(test)]
pub const POOL_VOICES: usize = (1 << 14) - 2;
pub const MAX_REPRESENTABLE_GENERATIONS: u8 = 52;
pub const L_SYSTEM_TYPES: [&str; 17] = [
    "pythagorean",
    "plant",
    "coral",
    "dragon",
    "koch",
    "sierpinski",
    "hilbert",
    "gosper",
    "cantor",
    "levy",
    "terdragon",
    "bush",
    "fan",
    "fern",
    "whorled",
    "ternary",
    "quaternary",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Parameters {
    /// Optional independent lab compiler. Absence preserves every legacy rule.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lab: Option<LabParameters>,
    pub l_system_type: String,
    pub generations: u8,
    pub interval_ms: f64,
    pub time_ratio: f64,
    pub angle: f64,
    pub curls: f64,
    pub asymmetry: f64,
    pub mutation: f64,
    pub pitch_scale: f64,
    pub pruning_bias: f64,
    /// Generation decay factor; 1 retains equal energy at every audible layer.
    pub depth: f64,
    pub spread: f64,
}
impl Default for Parameters {
    fn default() -> Self {
        Self {
            lab: None,
            l_system_type: "pythagorean".into(),
            generations: 13,
            interval_ms: 240.,
            time_ratio: 0.72,
            angle: 45.,
            curls: 0.,
            asymmetry: 0.,
            mutation: 0.,
            pitch_scale: 1.,
            pruning_bias: 0.,
            depth: 0.72,
            spread: 0.9,
        }
    }
}
impl Parameters {
    pub fn validate(&self) -> Result<(), String> {
        if let Some(lab) = &self.lab {
            lab.validate()?;
        }
        if !L_SYSTEM_TYPES.contains(&self.l_system_type.as_str()) {
            return Err("lSystemType must name a supported L-system grammar".into());
        }
        if !(1..=MAX_REPRESENTABLE_GENERATIONS).contains(&self.generations) {
            return Err("Generations must fit an exactly representable tree (1 through 52)".into());
        }
        for (name, value, low, high) in [
            ("intervalMs", self.interval_ms, 1., 3000.),
            ("timeRatio", self.time_ratio, 0.2, 2.),
            ("angle", self.angle, 0., 180.),
            ("curls", self.curls, -8., 8.),
            ("asymmetry", self.asymmetry, -0.8, 0.8),
            ("mutation", self.mutation, 0., 1.),
            ("pitchScale", self.pitch_scale, 0., 4.),
            ("pruningBias", self.pruning_bias, -1., 1.),
            ("depth", self.depth, 0., 1.),
            ("spread", self.spread, 0., 1.),
        ] {
            if !value.is_finite() || !(low..=high).contains(&value) {
                return Err(format!(
                    "{name} must be finite and between {low} and {high}"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: usize,
    pub parent: usize,
    pub voice_index: usize,
    /// Audible priority; null means beyond history or zero decay amplitude.
    pub priority: Option<usize>,
    pub key: String,
    pub parent_key: String,
    pub generation: u8,
    pub rule: char,
    pub start_x: f64,
    pub start_y: f64,
    pub x: f64,
    pub y: f64,
    pub heading_degrees: f64,
    pub turn_degrees: f64,
    pub length: f64,
    pub time_scale: f64,
    pub delay: f64,
    pub rate: f64,
    /// Display gain for the whole eligible topology. The callback normalizes
    /// raw target gains by the selected count at each generation instead.
    pub gain: f64,
    pub pan: f64,
}
pub struct Topology {
    /// Descendants only. Parent id zero denotes the first painted seed segment.
    pub nodes: Vec<Node>,
    /// Numeric targets indexed by stable slot, with raw per-generation gains.
    pub targets: Vec<PoolTarget>,
    pub ranks: Vec<usize>,
    /// Positive u8 groups normalize each selected generation; zero is unused.
    pub groups: Vec<u8>,
    /// Bounded, authoritative connected preview; never governs audio admission.
    pub preview: Vec<Node>,
    pub requested_voices: usize,
    pub eligible_voices: usize,
}

fn hash_unit(key: &str) -> f64 {
    let mut hash = 2_166_136_261_u32;
    for byte in key.bytes() {
        hash = (hash ^ u32::from(byte)).wrapping_mul(16_777_619);
    }
    f64::from(hash) / f64::from(u32::MAX)
}

pub fn pool_keys(count: usize) -> Result<Vec<String>, String> {
    crate::resources::check_voices(count)?;
    let mut keys: Vec<String> = crate::resources::reserve(count)?;
    for id in 1..=count {
        let parent = (id - 1) / 2;
        let path = if parent == 0 {
            "generation:trunk"
        } else {
            &keys[parent - 1]
        };
        keys.push(format!("{path}/{}", if id % 2 == 1 { 'A' } else { 'B' }));
    }
    Ok(keys)
}

#[derive(Clone)]
#[cfg_attr(test, derive(Debug, PartialEq))]
struct LayoutNode {
    id: String,
    parent: usize,
    generation: u8,
    rule: char,
    start_x: f64,
    start_y: f64,
    x: f64,
    y: f64,
    heading: f64,
    turn: f64,
    length: f64,
    time_scale: f64,
    /// Lab modules carry absolute pitch state; classic rules inherit turns.
    module_pitch: Option<f64>,
}

fn visual_ratio(ratio: f64) -> f64 {
    if ratio <= 1. {
        ratio
    } else {
        1. + ratio.log2() * 0.08
    }
}

fn binary_layout(parameters: &Parameters) -> Result<Vec<LayoutNode>, String> {
    let count = 1usize
        .checked_shl(u32::from(parameters.generations) + 1)
        .and_then(|n| n.checked_sub(2))
        .ok_or("Tree size exceeds addressable storage")?;
    crate::resources::check_voices(count)?;
    let mut layout = crate::resources::reserve(count + 1)?;
    layout.push(LayoutNode {
        id: "trunk".into(),
        parent: 0,
        generation: 0,
        rule: 'T',
        start_x: 0.,
        start_y: 0.,
        x: 1.,
        y: 0.,
        heading: 0.,
        turn: 0.,
        length: 1.,
        time_scale: 1.,
        module_pitch: None,
    });
    let visual_taper = visual_ratio(parameters.time_ratio);
    for id in 1..=count {
        let parent = (id - 1) / 2;
        let prior = &layout[parent];
        let generation = (usize::BITS - (id + 1).leading_zeros() - 1) as u8;
        let rule = if id % 2 == 1 { 'A' } else { 'B' };
        let path = format!("{}/{rule}", prior.id);
        let initial_turn = if rule == 'A' {
            -parameters.angle * (1. - parameters.asymmetry)
        } else {
            parameters.angle * (1. + parameters.asymmetry)
        };
        let turn = initial_turn
            + (hash_unit(&format!("{path}:turn")) * 2. - 1.)
                * parameters.angle
                * parameters.mutation
                * 0.5;
        let variation = hash_unit(&format!("{path}:length")) * parameters.mutation * 0.3;
        let heading = prior.heading + turn;
        let length = (visual_taper.powf(f64::from(generation)) * (1. - variation)).max(0.02);
        layout.push(LayoutNode {
            id: path,
            parent,
            generation,
            rule,
            start_x: prior.x,
            start_y: prior.y,
            x: prior.x + heading.to_radians().cos() * length,
            y: prior.y + heading.to_radians().sin() * length,
            heading,
            turn,
            length,
            time_scale: parameters.time_ratio.powf(f64::from(generation)) * (1. - variation),
            module_pitch: None,
        });
    }
    Ok(layout)
}

struct Grammar {
    axiom: &'static str,
    rules: &'static [(u8, &'static str)],
    iterations: u8,
    draw: &'static [u8],
    pen_up: &'static [u8],
}

fn grammar(id: &str) -> Grammar {
    let (axiom, rules, iterations, draw, pen_up): (_, &[(u8, &str)], _, &[u8], &[u8]) = match id {
        "plant" => (
            "X",
            &[(b'X', "F+[[X]-X]-F[-FX]+X"), (b'F', "FF")],
            5,
            b"F",
            b"",
        ),
        "coral" => ("F", &[(b'F', ">FF+[+F-F-F]-[-F+F+F]<")], 4, b"F", b""),
        "dragon" => ("FX", &[(b'X', "X+YF+"), (b'Y', "-FX-Y")], 12, b"F", b""),
        "koch" => ("F--F--F", &[(b'F', "F+F--F+F")], 4, b"F", b""),
        "sierpinski" => ("F-G-G", &[(b'F', "F-G+F+G-F"), (b'G', "GG")], 5, b"FG", b""),
        "hilbert" => (
            "X",
            &[(b'X', "-YF+XFX+FY-"), (b'Y', "+XF-YFY-FX+")],
            5,
            b"F",
            b"",
        ),
        "gosper" => (
            "X",
            &[(b'X', "X+Y++Y-X--XX-Y+"), (b'Y', "-X+YY++Y+X--X-Y")],
            4,
            b"XY",
            b"",
        ),
        "cantor" => ("F", &[(b'F', "FfF"), (b'f', "fff")], 6, b"F", b"f"),
        "levy" => ("F", &[(b'F', "+F--F+")], 12, b"F", b""),
        "terdragon" => ("F", &[(b'F', "F-F+F")], 7, b"F", b""),
        "bush" => ("F", &[(b'F', "F[+F]F[-F]F")], 5, b"F", b""),
        "fan" => ("F", &[(b'F', "F[+F]F[-F][F]")], 5, b"F", b""),
        "fern" => ("X", &[(b'X', "F[+X]F[-X]+X"), (b'F', "FF")], 7, b"F", b""),
        "whorled" => ("X", &[(b'X', "F[+X][-X]FX"), (b'F', "FF")], 7, b"F", b""),
        // Persistent stems with rewritten buds keep every junction at exactly
        // three or four children across repeated passes.
        "ternary" => ("FX", &[(b'X', "[+FX][FX][-FX]")], 5, b"F", b""),
        "quaternary" => ("FX", &[(b'X', "[++FX][+FX][-FX][--FX]")], 4, b"F", b""),
        _ => unreachable!("validated grammar"),
    };
    Grammar {
        axiom,
        rules,
        iterations,
        draw,
        pen_up,
    }
}

/// Counts rewrite instructions without allocating their exponentially growing strings.
pub fn generation_limit(id: &str, memory_capacity: usize) -> u8 {
    let mut limit = 1;
    for generations in 1..=MAX_REPRESENTABLE_GENERATIONS {
        let fits = if id == "pythagorean" {
            1usize
                .checked_shl(u32::from(generations) + 1)
                .and_then(|n| n.checked_sub(2))
                .is_some_and(|n| n <= memory_capacity)
        } else {
            let grammar = grammar(id);
            let iterations =
                ((f64::from(grammar.iterations) * f64::from(generations) / 13.).round() as u8)
                    .max(1);
            let mut counts = [0usize; 128];
            for symbol in grammar.axiom.bytes() {
                counts[usize::from(symbol)] += 1;
            }
            let mut fits = true;
            for _ in 0..iterations {
                let mut next = [0usize; 128];
                for (symbol, &count) in counts.iter().enumerate().filter(|(_, count)| **count > 0) {
                    if let Some((_, replacement)) = grammar
                        .rules
                        .iter()
                        .find(|(key, _)| usize::from(*key) == symbol)
                    {
                        for child in replacement.bytes() {
                            next[usize::from(child)] =
                                next[usize::from(child)].saturating_add(count);
                        }
                    } else {
                        next[symbol] = next[symbol].saturating_add(count);
                    }
                }
                let exceeds_memory = {
                    let symbols = next.iter().fold(0usize, |sum, n| sum.saturating_add(*n));
                    let paints = next
                        .iter()
                        .enumerate()
                        .filter(|(symbol, _)| {
                            grammar.draw.contains(&(*symbol as u8)) || *symbol == usize::from(b'B')
                        })
                        .fold(0usize, |sum, (_, n)| sum.saturating_add(*n));
                    let bytes = paints
                        .saturating_mul(2048)
                        .saturating_add(symbols.saturating_mul(2))
                        .saturating_add(
                            next[usize::from(b'[')].saturating_mul(std::mem::size_of::<(
                                Turtle,
                                f64,
                            )>(
                            )),
                        );
                    bytes > memory_capacity.saturating_mul(2048)
                };
                if exceeds_memory {
                    fits = false;
                    break;
                }
                counts = next;
            }
            fits
        };
        if !fits {
            break;
        }
        limit = generations;
    }
    limit
}

#[derive(Clone, Copy, Default)]
struct Turtle {
    x: f64,
    y: f64,
    heading: f64,
    turn_total: f64,
    path_distance: f64,
    parent: Option<usize>,
}
struct Segment {
    start_x: f64,
    start_y: f64,
    x: f64,
    y: f64,
    heading: f64,
    turn_total: f64,
    turn: f64,
    start_distance: f64,
    end_distance: f64,
    parent: usize,
    rule: char,
}

fn acoustic_path_time(progress: f64, count: u8, ratio: f64) -> f64 {
    let position = progress.clamp(0., 1.) * f64::from(count);
    let complete = (position.floor() as u8).min(count);
    let mut time = 0.;
    for generation in 1..=complete {
        time += ratio.powf(f64::from(generation));
    }
    if complete < count {
        time += (position - f64::from(complete)) * ratio.powf(f64::from(complete + 1));
    }
    time
}

fn classic_layout(parameters: &Parameters) -> Result<Vec<LayoutNode>, String> {
    let grammar = grammar(&parameters.l_system_type);
    // The original's requested 1..13 acoustic generations rescale the preset's
    // default rewrite iterations. Those defaults are below every preset max.
    let iterations = ((f64::from(grammar.iterations) * f64::from(parameters.generations) / 13.)
        .round() as u8)
        .max(1);
    let mut instructions = grammar.axiom.as_bytes().to_vec();
    for _ in 0..iterations {
        let next_size = instructions
            .iter()
            .try_fold(0usize, |count, symbol| {
                count.checked_add(
                    grammar
                        .rules
                        .iter()
                        .find(|(key, _)| key == symbol)
                        .map_or(1, |(_, replacement)| replacement.len()),
                )
            })
            .ok_or("Grammar size exceeds addressable storage")?;
        crate::resources::check_bytes(next_size.saturating_mul(2))?;
        let mut next = crate::resources::reserve(next_size)?;
        for symbol in instructions {
            if let Some((_, replacement)) = grammar.rules.iter().find(|(key, _)| *key == symbol) {
                next.extend_from_slice(replacement.as_bytes());
            } else {
                next.push(symbol);
            }
        }
        instructions = next;
    }
    let mut state = Turtle::default();
    let paints = instructions
        .iter()
        .filter(|command| grammar.draw.contains(command) || **command == b'B')
        .count();
    crate::resources::check_voices(paints)?;
    let mut stack = crate::resources::reserve(
        instructions
            .iter()
            .filter(|command| **command == b'[')
            .count(),
    )?;
    let mut segments: Vec<Segment> = crate::resources::reserve(paints)?;
    let mut distance = 1.;
    let mut duration = 0_f64;
    let turn = parameters.angle * std::f64::consts::PI / 180.;
    let taper = visual_ratio(parameters.time_ratio).max(0.05);
    for command in instructions {
        let paintable = grammar.draw.contains(&command) || command == b'B';
        if paintable || grammar.pen_up.contains(&command) {
            let signed_distance = if command == b'B' { -distance } else { distance };
            let start_x = state.x;
            let start_y = state.y;
            let start_distance = state.path_distance;
            state.x += state.heading.cos() * signed_distance;
            state.y += state.heading.sin() * signed_distance;
            state.path_distance += signed_distance.abs();
            duration = duration.max(state.path_distance);
            if !paintable {
                continue;
            }
            let local_turn = state
                .parent
                .map_or(0., |index| state.turn_total - segments[index].turn_total);
            let index = segments.len();
            segments.push(Segment {
                start_x,
                start_y,
                x: state.x,
                y: state.y,
                heading: state.heading,
                turn_total: state.turn_total,
                turn: local_turn,
                start_distance,
                end_distance: state.path_distance,
                parent: state.parent.unwrap_or(0),
                rule: char::from(command),
            });
            state.parent = Some(index);
        } else {
            match command {
                b'+' => {
                    let amount = turn * (1. + parameters.asymmetry);
                    state.heading += amount;
                    state.turn_total += amount;
                }
                b'-' => {
                    let amount = turn * (1. - parameters.asymmetry);
                    state.heading -= amount;
                    state.turn_total -= amount;
                }
                b'[' => stack.push((state, distance)),
                b']' => {
                    if let Some((prior, step)) = stack.pop() {
                        state = prior;
                        distance = step;
                    }
                }
                b'>' => distance *= taper,
                b'<' => distance /= taper,
                _ => (),
            }
        }
    }
    let duration = duration.max(1e-9);
    let mut layout = crate::resources::reserve(segments.len())?;
    layout.extend(segments.into_iter().enumerate().map(|(index, segment)| {
        let start = segment.start_distance / duration;
        let end = segment.end_distance / duration;
        let id = if index == 0 {
            "trunk".to_string()
        } else {
            format!("{}:{index}", parameters.l_system_type)
        };
        let variation = hash_unit(&format!("{id}:length")) * parameters.mutation * 0.3;
        LayoutNode {
            id,
            parent: segment.parent,
            generation: if index == 0 {
                0
            } else {
                (end * f64::from(parameters.generations))
                    .ceil()
                    .clamp(1., f64::from(parameters.generations)) as u8
            },
            rule: segment.rule,
            start_x: segment.start_x,
            start_y: segment.start_y,
            x: segment.x,
            y: segment.y,
            heading: segment.heading * 180. / std::f64::consts::PI,
            turn: segment.turn * 180. / std::f64::consts::PI,
            length: (segment.x - segment.start_x).hypot(segment.y - segment.start_y),
            time_scale: (acoustic_path_time(end, parameters.generations, parameters.time_ratio)
                - acoustic_path_time(start, parameters.generations, parameters.time_ratio))
            .max(1e-9)
                * (1. - variation),
            module_pitch: None,
        }
    }));
    Ok(layout)
}

/// Distribute signed winding over the original descendant path distance.
/// Segment identities, gaps, lengths and delay intervals remain unchanged;
/// the same added relative turn drives each segment's inherited pitch.
fn apply_curls(layout: &mut [LayoutNode], curls: f64) -> Result<(), String> {
    // Preserve every original coordinate and acoustic turn exactly at zero.
    if curls == 0. || layout.len() <= 1 {
        return Ok(());
    }
    // Snapshot numeric parent tips before moving them, without copying any
    // strings or the full layout. The root contributes no winding distance.
    let mut paths: Vec<(f64, f64, f64)> = crate::resources::reserve(layout.len())?;
    let mut longest = 0_f64;
    for (index, node) in layout.iter().enumerate() {
        let path = if index == 0 {
            0.
        } else {
            let (parent_x, parent_y, parent_path) = paths[node.parent];
            parent_path + node.length + (node.start_x - parent_x).hypot(node.start_y - parent_y)
        };
        if !path.is_finite() {
            return Err("Curls require finite branch path distances".into());
        }
        longest = longest.max(path);
        paths.push((node.x, node.y, path));
    }
    if longest == 0. {
        return Ok(());
    }
    for index in 1..layout.len() {
        let parent = layout[index].parent;
        let (original_parent_x, original_parent_y, parent_path) = paths[parent];
        let parent_phase = 360. * curls * (parent_path / longest);
        let phase = 360. * curls * (paths[index].2 / longest);
        let (parent_sin, parent_cos) = parent_phase.to_radians().sin_cos();
        let (sin, cos) = phase.to_radians().sin_cos();
        let parent_x = layout[parent].x;
        let parent_y = layout[parent].y;
        let node = &mut layout[index];
        let gap_x = node.start_x - original_parent_x;
        let gap_y = node.start_y - original_parent_y;
        let segment_x = node.x - node.start_x;
        let segment_y = node.y - node.start_y;
        node.start_x = parent_x + gap_x * parent_cos - gap_y * parent_sin;
        node.start_y = parent_y + gap_x * parent_sin + gap_y * parent_cos;
        node.x = node.start_x + segment_x * cos - segment_y * sin;
        node.y = node.start_y + segment_x * sin + segment_y * cos;
        node.heading += phase;
        node.turn += phase - parent_phase;
        if let Some(pitch) = &mut node.module_pitch {
            *pitch += phase / 180. * 12.;
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct Candidate {
    priority: f64,
    breadth: usize,
    index: usize,
}
impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.breadth == other.breadth
    }
}
impl Eq for Candidate {}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap is a max heap; reverse the original min-priority ordering.
        other
            .priority
            .total_cmp(&self.priority)
            .then_with(|| other.breadth.cmp(&self.breadth))
    }
}

fn connected_order(
    nodes: &[Node],
    breadth: &[usize],
    deepest_generation: u8,
    bias: f64,
) -> Result<Vec<usize>, String> {
    if bias <= 0. {
        return crate::resources::copied(breadth);
    }
    let mut included = crate::resources::filled(nodes.len(), false)?;
    let mut eligible = crate::resources::filled(nodes.len(), false)?;
    for &index in breadth {
        eligible[index] = true;
    }
    let mut deepest = crate::resources::reserve(breadth.len())?;
    deepest.extend(
        breadth
            .iter()
            .copied()
            .filter(|&index| nodes[index].generation == deepest_generation),
    );
    deepest.sort_by(|&left, &right| {
        hash_unit(&format!(
            "audible:{}",
            nodes[left].key.trim_start_matches("generation:")
        ))
        .total_cmp(&hash_unit(&format!(
            "audible:{}",
            nodes[right].key.trim_start_matches("generation:")
        )))
    });
    let mut depth_order = crate::resources::reserve(breadth.len())?;
    let mut path = crate::resources::reserve(breadth.len())?;
    for target in deepest {
        path.clear();
        let mut cursor = Some(target);
        while let Some(index) = cursor {
            if included[index] {
                break;
            }
            if !eligible[index] {
                break;
            }
            path.push(index);
            cursor = nodes[index].parent.checked_sub(1);
        }
        for &index in path.iter().rev() {
            if !included[index] {
                included[index] = true;
                depth_order.push(index);
            }
        }
    }
    for &index in breadth {
        if !included[index] && (nodes[index].parent == 0 || included[nodes[index].parent - 1]) {
            included[index] = true;
            depth_order.push(index);
        }
    }
    if bias >= 1. {
        return Ok(depth_order);
    }
    let mut breadth_rank = crate::resources::filled(nodes.len(), usize::MAX)?;
    let mut depth_rank = crate::resources::filled(nodes.len(), usize::MAX)?;
    for (rank, &index) in breadth.iter().enumerate() {
        breadth_rank[index] = rank;
    }
    for (rank, &index) in depth_order.iter().enumerate() {
        depth_rank[index] = rank;
    }
    let scale = 1. / breadth.len().saturating_sub(1).max(1) as f64;
    let mut child_counts = crate::resources::filled(nodes.len() + 1, 0usize)?;
    for &index in breadth {
        child_counts[nodes[index].parent] += 1;
    }
    let mut children = crate::resources::reserve(nodes.len() + 1)?;
    for count in child_counts {
        children.push(crate::resources::reserve(count)?);
    }
    for &index in breadth {
        children[nodes[index].parent].push(index);
    }
    let candidate = |index: usize| Candidate {
        priority: (1. - bias) * (breadth_rank[index] as f64 * scale)
            + bias * (depth_rank[index] as f64 * scale),
        breadth: breadth_rank[index],
        index,
    };
    let mut heap = BinaryHeap::new();
    heap.try_reserve(breadth.len())
        .map_err(|error| error.to_string())?;
    for &index in &children[0] {
        heap.push(candidate(index));
    }
    let mut order = crate::resources::reserve(breadth.len())?;
    while let Some(next) = heap.pop() {
        order.push(next.index);
        for &index in &children[nodes[next.index].id] {
            heap.push(candidate(index));
        }
    }
    Ok(order)
}

pub fn try_compile(parameters: &Parameters, sample_rate: u32) -> Result<Topology, String> {
    parameters.validate()?;
    assert!(
        (8_000..=192_000).contains(&sample_rate),
        "unsupported sample rate"
    );
    let mut layout = if let Some(lab) = &parameters.lab {
        lab::layout(parameters, lab)?
    } else if parameters.l_system_type == "pythagorean" {
        binary_layout(parameters)?
    } else {
        classic_layout(parameters)?
    };
    apply_curls(&mut layout, parameters.curls)?;
    let requested_voices = layout.len().saturating_sub(1);
    let mut nodes: Vec<Node> = crate::resources::reserve(requested_voices)?;
    nodes.extend(layout.iter().enumerate().skip(1).map(|(id, node)| Node {
        id,
        parent: node.parent,
        voice_index: id - 1,
        priority: None,
        key: format!("generation:{}", node.id),
        parent_key: format!("generation:{}", layout[node.parent].id),
        generation: node.generation,
        rule: node.rule,
        start_x: node.start_x,
        start_y: node.start_y,
        x: node.x,
        y: node.y,
        heading_degrees: node.heading,
        turn_degrees: node.turn,
        length: node.length,
        time_scale: node.time_scale,
        delay: 0.,
        rate: 1.,
        gain: 0.,
        pan: 0.,
    }));
    // Preserve the original generation-grouped lineage evaluation, including
    // sequential classic segments in the same acoustic generation.
    let mut lineage = crate::resources::filled(layout.len(), (0_f64, 0_f64))?;
    let mut breadth = crate::resources::reserve(nodes.len())?;
    breadth.extend(0..nodes.len());
    breadth.sort_by_key(|&index| nodes[index].generation);
    let mut maximum_y = 0.001_f64;
    for node in &layout {
        maximum_y = maximum_y.max(node.y.abs());
    }
    let mut counts = [0_usize; 256];
    let base = parameters.interval_ms / 1000.;
    let mut targets = crate::resources::filled(nodes.len(), PoolTarget::default())?;
    let mut groups = crate::resources::filled(nodes.len(), 0)?;
    for &index in &breadth {
        let node = &mut nodes[index];
        let (parent_delay, parent_semitones) = lineage[node.parent];
        node.delay = parent_delay + base * node.time_scale;
        let semitones = layout[node.id].module_pitch.map_or(
            parent_semitones + node.turn_degrees / 180. * 12. * parameters.pitch_scale,
            |pitch| pitch * parameters.pitch_scale,
        );
        lineage[node.id] = (node.delay, semitones);
        node.rate = 2_f64.powf(semitones / 12.).clamp(0.125, 8.);
        node.pan = (node.y / maximum_y * parameters.spread).clamp(-1., 1.);
        let amplitude = if node.delay <= 39. + 1e-9 {
            0.5 * parameters.depth.powf(f64::from(node.generation) * 0.72)
        } else {
            0.
        };
        if amplitude > 0. {
            counts[usize::from(node.generation)] += 1;
        }
        targets[index] = PoolTarget {
            delay: node.delay,
            rate: node.rate,
            gain: amplitude,
            pan: node.pan,
        };
        groups[index] = node.generation;
        node.gain = amplitude;
    }
    breadth.retain(|&index| targets[index].gain > 0.);
    let eligible_voices = breadth.len();
    let deepest = layout.iter().map(|node| node.generation).max().unwrap_or(0);
    let order = connected_order(&nodes, &breadth, deepest, parameters.pruning_bias)?;
    assert_eq!(order.len(), eligible_voices, "connected audible priority");
    let mut ranks = crate::resources::filled(nodes.len(), usize::MAX)?;
    let trunk = &layout[0];
    let preview_limit = if parameters.lab.is_some() {
        requested_voices
    } else {
        2048
    };
    let mut preview = crate::resources::reserve(preview_limit.saturating_add(1))?;
    preview.push(Node {
        id: 0,
        parent: 0,
        voice_index: 0,
        priority: None,
        key: "generation:trunk".into(),
        parent_key: "".into(),
        generation: 0,
        rule: trunk.rule,
        start_x: trunk.start_x,
        start_y: trunk.start_y,
        x: trunk.x,
        y: trunk.y,
        heading_degrees: trunk.heading,
        turn_degrees: trunk.turn,
        length: trunk.length,
        time_scale: 0.,
        delay: 0.,
        rate: 1.,
        gain: 1.,
        pan: 0.,
    });
    for (rank, index) in order.into_iter().enumerate() {
        ranks[index] = rank;
        nodes[index].priority = Some(rank);
        if rank < preview_limit {
            preview.push(nodes[index].clone());
        }
    }
    for node in &mut nodes {
        node.gain /= (counts[usize::from(node.generation)].max(1) as f64).sqrt();
    }
    for node in preview.iter_mut().skip(1) {
        node.gain /= (counts[usize::from(node.generation)].max(1) as f64).sqrt();
    }
    Ok(Topology {
        preview,
        nodes,
        targets,
        ranks,
        groups,
        requested_voices,
        eligible_voices,
    })
}

#[cfg(test)]
fn compile(parameters: &Parameters, sample_rate: u32) -> Topology {
    try_compile(parameters, sample_rate).expect("Test tree must fit available resources")
}

#[cfg(test)]
mod tests {
    use super::*;

    const BRANCHING_TYPES: [&str; 6] = ["bush", "fan", "fern", "whorled", "ternary", "quaternary"];

    fn test_segment(parent: usize, start: (f64, f64), end: (f64, f64)) -> LayoutNode {
        let dx = end.0 - start.0;
        let dy = end.1 - start.1;
        LayoutNode {
            id: format!("segment:{parent}"),
            parent,
            generation: 1,
            rule: 'F',
            start_x: start.0,
            start_y: start.1,
            x: end.0,
            y: end.1,
            heading: dy.atan2(dx).to_degrees(),
            turn: 0.,
            length: dx.hypot(dy),
            time_scale: 1.,
            module_pitch: None,
        }
    }

    fn assert_near(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-11 * (1. + expected.abs()),
            "actual={actual}, expected={expected}"
        );
    }

    #[test]
    fn depth_one_keeps_equal_generation_energy_and_preserves_branch_identity() {
        for id in L_SYSTEM_TYPES {
            let parameters = Parameters {
                l_system_type: id.into(),
                generations: 6,
                interval_ms: 2.,
                depth: 0.96,
                ..Parameters::default()
            };
            let decaying = compile(&parameters, 8000);
            let full = compile(
                &Parameters {
                    depth: 1.,
                    ..parameters
                },
                8000,
            );
            assert_eq!(full.requested_voices, decaying.requested_voices, "{id}");
            assert_eq!(full.eligible_voices, decaying.eligible_voices, "{id}");
            assert_eq!(full.ranks, decaying.ranks, "{id}");
            assert_eq!(full.groups, decaying.groups, "{id}");
            let mut energy = [0.; 256];
            for ((node, old), target) in full.nodes.iter().zip(&decaying.nodes).zip(&full.targets) {
                assert_eq!(
                    (
                        node.id,
                        node.parent,
                        node.voice_index,
                        &node.key,
                        &node.parent_key,
                        node.generation,
                        node.rule,
                        node.delay,
                        node.rate,
                        node.pan,
                        node.priority
                    ),
                    (
                        old.id,
                        old.parent,
                        old.voice_index,
                        &old.key,
                        &old.parent_key,
                        old.generation,
                        old.rule,
                        old.delay,
                        old.rate,
                        old.pan,
                        old.priority
                    ),
                    "{id}"
                );
                assert_eq!(
                    target.gain,
                    if node.delay <= 39. + 1e-9 { 0.5 } else { 0. },
                    "{id}: generation {} retains the history boundary",
                    node.generation
                );
                energy[usize::from(node.generation)] += node.gain * node.gain;
            }
            let audible: Vec<_> = energy.into_iter().filter(|energy| *energy > 0.).collect();
            assert!(audible.len() >= 2, "{id} has multiple audible layers");
            for energy in audible {
                assert_near(energy, 0.25);
            }
        }
        let limited_history = compile(
            &Parameters {
                generations: 6,
                interval_ms: 3000.,
                time_ratio: 2.,
                depth: 1.,
                ..Parameters::default()
            },
            8000,
        );
        assert!(limited_history.nodes.iter().any(|node| node.delay > 39.));
        for (node, target) in limited_history.nodes.iter().zip(&limited_history.targets) {
            if node.delay > 39. + 1e-9 {
                assert_eq!(target.gain, 0.);
                assert_eq!(node.priority, None);
            }
        }
    }

    #[test]
    fn depth_validates_the_inclusive_no_decay_endpoint() {
        for depth in [0., 0.96, 1.] {
            assert!(Parameters {
                depth,
                ..Parameters::default()
            }
            .validate()
            .is_ok());
        }
        for depth in [-0.001, 1.0001, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(Parameters {
                depth,
                ..Parameters::default()
            }
            .validate()
            .is_err());
        }
    }

    #[test]
    fn curls_zero_preserves_every_layout_field_exactly_in_all_grammars() {
        for id in L_SYSTEM_TYPES {
            let parameters = Parameters {
                l_system_type: id.into(),
                angle: 37.,
                asymmetry: -0.23,
                mutation: 0.37,
                time_ratio: 1.1,
                ..Parameters::default()
            };
            let mut layout = if id == "pythagorean" {
                binary_layout(&parameters).unwrap()
            } else {
                classic_layout(&parameters).unwrap()
            };
            let original = layout.clone();
            for zero in [0., -0.] {
                apply_curls(&mut layout, zero).unwrap();
                assert_eq!(layout, original, "{id}");
            }
        }
    }

    #[test]
    fn curls_wind_a_straight_path_in_both_directions_without_moving_the_root() {
        for sign in [-1., 1.] {
            let mut layout = vec![
                test_segment(0, (0., 0.), (1., 0.)),
                test_segment(0, (1., 0.), (2., 0.)),
                test_segment(1, (2., 0.), (3., 0.)),
                test_segment(2, (3., 0.), (4., 0.)),
            ];
            let root = layout[0].clone();
            apply_curls(&mut layout, sign * 0.25).unwrap();
            assert_eq!(layout[0], root);
            let h = 3_f64.sqrt() / 2.;
            for (index, expected) in [
                (1, (1. + h, 0.5)),
                (2, (1.5 + h, 0.5 + h)),
                (3, (1.5 + h, 1.5 + h)),
            ] {
                let node = &layout[index];
                assert_near(node.x, expected.0);
                assert_near(node.y, sign * expected.1);
                assert_near(node.heading, sign * index as f64 * 30.);
                assert_near(node.turn, sign * 30.);
                assert_eq!(
                    (node.start_x, node.start_y),
                    (layout[index - 1].x, layout[index - 1].y)
                );
                assert_near((node.x - node.start_x).hypot(node.y - node.start_y), 1.);
            }
        }
    }

    #[test]
    fn curls_keep_pen_up_gaps_backward_segments_and_forks_attached_to_their_parent() {
        let mut layout = vec![
            test_segment(0, (0., 0.), (1., 0.)),
            test_segment(0, (2., 0.), (3., 0.)),
            test_segment(1, (3., 0.), (2., 0.)),
            test_segment(1, (3., 0.), (3., 1.)),
        ];
        apply_curls(&mut layout, 0.25).unwrap();
        // The gap counts toward winding, but rotates with its parent's phase.
        assert_eq!((layout[1].start_x, layout[1].start_y), (2., 0.));
        assert_near(layout[1].heading, 60.);
        let parent_tip = (2.5, 3_f64.sqrt() / 2.);
        assert_near(layout[1].x, parent_tip.0);
        assert_near(layout[1].y, parent_tip.1);
        for node in &layout[2..] {
            assert_eq!((node.start_x, node.start_y), (layout[1].x, layout[1].y));
            assert_near(node.turn, 30.);
        }
        assert_near(layout[2].x, parent_tip.0);
        assert_near(layout[2].y, parent_tip.1 - 1.);
        assert_near(layout[3].x, parent_tip.0 - 1.);
        assert_near(layout[3].y, parent_tip.1);

        // A later pen-up gap follows the deformed parent, including its bearing.
        let mut gap = vec![
            test_segment(0, (0., 0.), (1., 0.)),
            test_segment(0, (1., 0.), (2., 0.)),
            test_segment(1, (3., 0.), (4., 0.)),
        ];
        apply_curls(&mut gap, 0.25).unwrap();
        assert_near(gap[1].heading, 30.);
        assert_near(gap[2].start_x - gap[1].x, 3_f64.sqrt() / 2.);
        assert_near(gap[2].start_y - gap[1].y, 0.5);
        assert_near(gap[2].x - gap[2].start_x, 0.);
        assert_near(gap[2].y - gap[2].start_y, 1.);
    }

    #[test]
    fn curls_change_audio_pitch_and_pan_without_changing_voices_delays_or_admission() {
        for id in L_SYSTEM_TYPES {
            let parameters = Parameters {
                l_system_type: id.into(),
                angle: 0.,
                pitch_scale: 0.25,
                pruning_bias: 0.65,
                ..Parameters::default()
            };
            let original = compile(&parameters, 48_000);
            let curled = compile(
                &Parameters {
                    curls: 0.125,
                    ..parameters
                },
                48_000,
            );
            assert_eq!(curled.preview[0], original.preview[0], "{id} root");
            assert_eq!(curled.requested_voices, original.requested_voices, "{id}");
            assert_eq!(curled.eligible_voices, original.eligible_voices, "{id}");
            assert_eq!(curled.ranks, original.ranks, "{id}");
            assert_eq!(curled.groups, original.groups, "{id}");
            assert!(
                curled
                    .targets
                    .iter()
                    .zip(&original.targets)
                    .any(|(a, b)| (a.rate - b.rate).abs() > 1e-6),
                "{id} pitch"
            );
            assert!(
                curled
                    .targets
                    .iter()
                    .zip(&original.targets)
                    .any(|(a, b)| (a.pan - b.pan).abs() > 1e-6),
                "{id} pan"
            );
            let mut pitch = vec![0_f64; curled.nodes.len() + 1];
            for (node, old) in curled.nodes.iter().zip(&original.nodes) {
                assert_eq!(
                    (
                        node.id,
                        node.parent,
                        node.voice_index,
                        &node.key,
                        &node.parent_key,
                        node.generation,
                        node.rule
                    ),
                    (
                        old.id,
                        old.parent,
                        old.voice_index,
                        &old.key,
                        &old.parent_key,
                        old.generation,
                        old.rule
                    ),
                    "{id} identity"
                );
                assert_eq!(
                    (
                        node.length,
                        node.time_scale,
                        node.delay,
                        node.gain,
                        node.priority
                    ),
                    (
                        old.length,
                        old.time_scale,
                        old.delay,
                        old.gain,
                        old.priority
                    ),
                    "{id} timing and admission"
                );
                let target = curled.targets[node.voice_index];
                assert_eq!(
                    target.delay, original.targets[node.voice_index].delay,
                    "{id}"
                );
                assert_eq!(target.gain, original.targets[node.voice_index].gain, "{id}");
                pitch[node.id] = pitch[node.parent] + node.turn_degrees / 180. * 12. * 0.25;
                assert_near(
                    target.rate,
                    2_f64.powf(pitch[node.id] / 12.).clamp(0.125, 8.),
                );
            }
        }
        let large = compile(
            &Parameters {
                generations: 14,
                curls: 1.25,
                ..Parameters::default()
            },
            48_000,
        );
        assert_eq!(large.requested_voices, 32_766);
        assert_eq!(large.eligible_voices, 32_766);
        assert_eq!(
            large.targets.len(),
            32_766,
            "Curls preserve the full audio pool beyond preview capacity"
        );
    }

    #[test]
    fn curls_are_finite_and_bounded_in_all_grammars_at_control_extremes() {
        for id in L_SYSTEM_TYPES {
            for (interval_ms, time_ratio, depth, angle, asymmetry, pitch_scale) in [
                (1., 0.2, 0., 0., -0.8, 0.),
                (240., 0.72, 0.72, 45., 0., 1.),
                (3000., 2., 0.96, 180., 0.8, 4.),
            ] {
                for curls in [-8., -0.15, 0.15, 8.] {
                    let topology = compile(
                        &Parameters {
                            l_system_type: id.into(),
                            interval_ms,
                            time_ratio,
                            depth,
                            angle,
                            asymmetry,
                            pitch_scale,
                            mutation: 1.,
                            pruning_bias: 0.65,
                            curls,
                            ..Parameters::default()
                        },
                        8_000,
                    );
                    for (node, target) in topology.nodes.iter().zip(&topology.targets) {
                        assert!(
                            [
                                node.start_x,
                                node.start_y,
                                node.x,
                                node.y,
                                node.heading_degrees,
                                node.turn_degrees,
                                node.length,
                                node.time_scale,
                                node.delay
                            ]
                            .into_iter()
                            .all(f64::is_finite),
                            "{id}/{curls}"
                        );
                        assert!(
                            target.delay.is_finite() && target.delay > 0.,
                            "{id}/{curls}"
                        );
                        assert!((0.125..=8.).contains(&target.rate), "{id}/{curls}");
                        assert!((0. ..=0.5).contains(&target.gain), "{id}/{curls}");
                        assert!((-1. ..=1.).contains(&target.pan), "{id}/{curls}");
                        assert_eq!(node.priority.is_some(), target.gain > 0., "{id}/{curls}");
                        if target.delay > 39. + 1e-9 || depth == 0. {
                            assert_eq!(target.gain, 0., "{id}/{curls}");
                            assert_eq!(
                                topology.ranks[node.voice_index],
                                usize::MAX,
                                "{id}/{curls}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn curls_validate_signed_bounds_and_default_for_legacy_parameter_json() {
        for curls in [-8., 0., 8.] {
            assert!(Parameters {
                curls,
                ..Parameters::default()
            }
            .validate()
            .is_ok());
        }
        for curls in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -8.01, 8.01] {
            assert!(Parameters {
                curls,
                ..Parameters::default()
            }
            .validate()
            .is_err());
        }
        assert_eq!(
            serde_json::from_str::<Parameters>(r#"{"angle":35,"pitchScale":0.75}"#)
                .unwrap()
                .curls,
            0.
        );
        let parsed: Parameters = serde_json::from_str(r#"{"curls":-1.25}"#).unwrap();
        assert_eq!(parsed.curls, -1.25);
        assert_eq!(serde_json::to_value(parsed).unwrap()["curls"], -1.25);
    }

    #[test]
    fn branching_grammars_append_stable_ids_and_have_exact_default_rewrite_counts() {
        assert_eq!(
            &L_SYSTEM_TYPES[..11],
            &[
                "pythagorean",
                "plant",
                "coral",
                "dragon",
                "koch",
                "sierpinski",
                "hilbert",
                "gosper",
                "cantor",
                "levy",
                "terdragon",
            ]
        );
        assert_eq!(&L_SYSTEM_TYPES[11..], &BRANCHING_TYPES);
        // Bush/fan draw 5^5 segments. Fern/whorled draw 2 * (3^7 - 2^7).
        // Persistent buds add sum(3^1..3^5) or sum(4^1..4^4) descendants.
        // The first segment owns the input rather than a delay voice.
        for (id, expected) in BRANCHING_TYPES
            .into_iter()
            .zip([3124, 3124, 4117, 4117, 363, 340])
        {
            let topology = compile(
                &Parameters {
                    l_system_type: id.into(),
                    ..Parameters::default()
                },
                48_000,
            );
            assert_eq!(topology.requested_voices, expected, "{id}");
            assert_eq!(topology.nodes.len(), expected, "{id}");
            assert_eq!(topology.targets.len(), expected, "{id}");
            assert_eq!(topology.eligible_voices, expected, "{id}");
        }
    }

    #[test]
    fn three_and_four_way_forks_have_distinct_rays_with_shared_parent_ownership() {
        for (id, degree) in [("whorled", 3), ("ternary", 3), ("quaternary", 4)] {
            for generations in [5, 9, 13] {
                let topology = compile(
                    &Parameters {
                        l_system_type: id.into(),
                        generations,
                        angle: 37.,
                        asymmetry: 0.15,
                        ..Parameters::default()
                    },
                    48_000,
                );
                let mut children = vec![Vec::new(); topology.nodes.len() + 1];
                for node in &topology.nodes {
                    children[node.parent].push(node);
                }
                assert_eq!(children.iter().map(Vec::len).max(), Some(degree), "{id}");
                let forks: Vec<_> = children
                    .iter()
                    .filter(|children| children.len() == degree)
                    .collect();
                assert!(forks.len() > 1, "{id} must fork recursively");
                for fork in forks {
                    for (index, child) in fork.iter().enumerate() {
                        let parent = if child.parent == 0 {
                            &topology.preview[0]
                        } else {
                            &topology.nodes[child.parent - 1]
                        };
                        assert_eq!((child.start_x, child.start_y), (parent.x, parent.y), "{id}");
                        assert_eq!(child.parent_key, parent.key, "{id}");
                        for sibling in &fork[..index] {
                            assert!(
                                (child.heading_degrees - sibling.heading_degrees).abs() > 1.,
                                "{id} siblings must form distinct rays"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn branching_segment_identity_and_acoustics_follow_the_connected_turtle_parent() {
        for id in BRANCHING_TYPES {
            let parameters = Parameters {
                l_system_type: id.into(),
                angle: 29.,
                asymmetry: -0.17,
                mutation: 0.2,
                time_ratio: 1.1,
                ..Parameters::default()
            };
            let topology = compile(&parameters, 48_000);
            let mut pitches = vec![0_f64; topology.nodes.len() + 1];
            let mut keys = std::collections::BTreeSet::new();
            keys.insert(topology.preview[0].key.as_str());
            for node in &topology.nodes {
                let parent = if node.parent == 0 {
                    &topology.preview[0]
                } else {
                    &topology.nodes[node.parent - 1]
                };
                assert!(node.parent < node.id, "{id}/{}", node.id);
                assert_eq!(node.voice_index, node.id - 1, "{id}");
                assert!(
                    keys.insert(node.key.as_str()),
                    "{id} duplicate segment identity"
                );
                assert_eq!(node.parent_key, parent.key, "{id}");
                assert_eq!((node.start_x, node.start_y), (parent.x, parent.y), "{id}");
                assert_eq!(node.rule, 'F', "{id}");
                assert!(parent.generation <= node.generation, "{id}");
                assert_eq!(
                    node.delay,
                    parent.delay + parameters.interval_ms / 1000. * node.time_scale,
                    "{id} inherited delay"
                );
                pitches[node.id] =
                    pitches[node.parent] + node.turn_degrees / 180. * 12. * parameters.pitch_scale;
                assert_eq!(
                    node.rate,
                    2_f64.powf(pitches[node.id] / 12.).clamp(0.125, 8.),
                    "{id}"
                );
                assert_eq!(topology.groups[node.voice_index], node.generation, "{id}");
            }
        }
    }

    #[test]
    fn branching_generation_limits_scale_with_resource_capacity_beyond_the_old_pool() {
        for id in BRANCHING_TYPES {
            let limits: Vec<_> = [64, 1024, 16_384, 262_144]
                .map(|capacity| generation_limit(id, capacity))
                .into();
            assert!(
                limits.windows(2).all(|pair| pair[1] > pair[0]),
                "{id}: {limits:?}"
            );
            assert!(limits.iter().all(|limit| (1..=52).contains(limit)), "{id}");
        }
        let large = compile(
            &Parameters {
                l_system_type: "ternary".into(),
                generations: 24,
                ..Parameters::default()
            },
            48_000,
        );
        assert_eq!(large.requested_voices, 29_523);
        assert_eq!(large.eligible_voices, 29_523);
        assert_eq!(
            large.targets.len(),
            29_523,
            "full audio pool survives preview sampling"
        );
        assert_eq!(large.preview.len(), 2049);
    }

    #[test]
    fn branching_audio_targets_stay_finite_and_respect_history_at_control_extremes() {
        for id in BRANCHING_TYPES {
            for (interval_ms, time_ratio, depth) in
                [(1., 0.2, 0.), (240., 0.72, 0.72), (3000., 2., 0.96)]
            {
                let parameters = Parameters {
                    l_system_type: id.into(),
                    interval_ms,
                    time_ratio,
                    depth,
                    angle: 180.,
                    asymmetry: 0.8,
                    pitch_scale: 4.,
                    pruning_bias: 0.65,
                    ..Parameters::default()
                };
                let topology = compile(&parameters, 8_000);
                for (node, target) in topology.nodes.iter().zip(&topology.targets) {
                    assert!(node.x.is_finite() && node.y.is_finite(), "{id}");
                    assert!(target.delay.is_finite() && target.delay > 0., "{id}");
                    assert!((0.125..=8.).contains(&target.rate), "{id}");
                    assert!((0. ..=0.5).contains(&target.gain), "{id}");
                    assert!((-1. ..=1.).contains(&target.pan), "{id}");
                    assert_eq!(node.priority.is_some(), target.gain > 0., "{id}");
                    if target.delay > 39. + 1e-9 || depth == 0. {
                        assert_eq!(target.gain, 0., "{id}");
                        assert_eq!(topology.ranks[node.voice_index], usize::MAX, "{id}");
                    }
                }
                if depth == 0. {
                    assert_eq!(topology.eligible_voices, 0, "{id}");
                } else if time_ratio == 2. {
                    assert!(topology.eligible_voices < topology.requested_voices, "{id}");
                }
            }
        }
    }

    // Captured from unmodified micmic.js generationTopology/generationVoiceSpecs
    // and l-system.js on the fresh-main checkout. All small binary stages fit
    // the original browser cap, so these compare the original numeric rewrite.
    const ORIGINAL_JS_FIXTURES: &str = r#"{"cases":[{"id":"pythagorean","count":62,"samples":[{"index":0,"key":"generation:trunk/A","parentKey":"generation:trunk","generation":1,"rule":"A","startX":1,"startY":0,"x":1.5951164193179974,"y":-0.7661567254110535,"headingDegrees":-52.16153086668498,"turnDegrees":-52.16153086668498,"length":0.9701338466595539,"timeScale":1.1401683359281551,"delay":0.3545923524736562,"rate":0.7701854814309341,"gain":0.29290604087048555,"pan":-0.13763464554021962},{"index":1,"key":"generation:trunk/B","parentKey":"generation:trunk","generation":1,"rule":"B","startX":1,"startY":0,"x":1.8895032807250063,"y":0.39998553585607055,"headingDegrees":24.212158865466986,"turnDegrees":24.212158865466986,"length":0.9752971420621601,"timeScale":1.1462365974854296,"delay":0.3564795818179686,"rate":1.1288592301198737,"gain":0.29290604087048555,"pan":0.07185457703739272},{"index":30,"key":"generation:trunk/A/A/A/A/A","parentKey":"generation:trunk/A/A/A/A","generation":5,"rule":"A","startX":-0.312424666749447,"startY":-2.2305063371728533,"x":-1.0564436874010974,"y":-1.4309372759009982,"headingDegrees":-227.06104851910516,"turnDegrees":-40.59490641062611,"length":1.092188164573576,"timeScale":2.4489733628001886,"delay":2.6100909548408215,"rate":0.32088197355864606,"gain":0.03449543498953537,"pan":-0.257057777118979},{"index":61,"key":"generation:trunk/B/B/B/B/B","parentKey":"generation:trunk/B/B/B/B","generation":5,"rule":"B","startX":1.9112359494537192,"startY":3.0821614262052743,"x":0.9535308046286324,"y":3.489075191439766,"headingDegrees":156.9801289703942,"turnDegrees":34.69276608756226,"length":1.0405661712557022,"timeScale":2.3332232652705374,"delay":2.616344922272815,"rate":2.194276568767391,"gain":0.03449543498953537,"pan":0.6267877202009065}]},
{"id":"plant","count":17,"samples":[{"index":0,"key":"generation:plant:1","parentKey":"generation:trunk","generation":2,"rule":"F","startX":1,"startY":0,"x":2,"y":0,"headingDegrees":0,"turnDegrees":0,"length":1,"timeScale":0.6682797008614895,"delay":0.2078349869679232,"rate":1,"gain":0.1715878975568451,"pan":0},{"index":1,"key":"generation:plant:2","parentKey":"generation:plant:1","generation":2,"rule":"F","startX":2,"startY":0,"x":2.878900379190605,"y":0.47700537047145547,"headingDegrees":28.490000000000002,"turnDegrees":28.490000000000002,"length":0.9999999999999998,"timeScale":0.7545582595123342,"delay":0.44250260567625915,"rate":1.1532946207742993,"gain":0.1715878975568451,"pan":0.07841236518900345},{"index":8,"key":"generation:plant:9","parentKey":"generation:plant:8","generation":3,"rule":"F","startX":2.95620264072595,"startY":-0.2927055002365357,"x":3.9124052814518997,"y":-0.5854110004730714,"headingDegrees":-17.019999999999996,"turnDegrees":0,"length":1.0000000000000004,"timeScale":0.8471110367909764,"delay":0.7057081155667912,"rate":0.9183256692324083,"gain":0.10745854371877567,"pan":-0.09623258771570006},{"index":16,"key":"generation:plant:17","parentKey":"generation:plant:16","generation":4,"rule":"F","startX":5.887746418709622,"startY":-0.48327054370265665,"x":6.516252639496957,"y":-1.2610751016936863,"headingDegrees":-51.059999999999995,"turnDegrees":-45.510000000000005,"length":1,"timeScale":1.0245828207662868,"delay":1.6304395930564137,"rate":0.774444271959653,"gain":0.11776962635191345,"pan":-0.20730140062580768}]},
{"id":"coral","count":63,"samples":[{"index":0,"key":"generation:coral:1","parentKey":"generation:trunk","generation":1,"rule":"F","startX":1.0425283023647822,"startY":0,"x":2.0850566047295644,"y":0,"headingDegrees":0,"turnDegrees":0,"length":1.0425283023647822,"timeScale":0.41862994744550186,"delay":0.13019391365555108,"rate":1,"gain":0.41423169550004874,"pan":0},{"index":1,"key":"generation:coral:2","parentKey":"generation:coral:1","generation":2,"rule":"F","startX":2.0850566047295644,"startY":0,"x":2.6531633801756187,"y":0.8741395500284157,"headingDegrees":56.980000000000004,"turnDegrees":56.980000000000004,"length":1.042528302364782,"timeScale":0.44675230387364073,"delay":0.26913388016025336,"rate":1.3300884823069348,"gain":0.09906631884412645,"pan":0.07637959063241495},{"index":31,"key":"generation:coral:32","parentKey":"generation:coral:25","generation":4,"rule":"F","startX":7.605745723310492,"startY":-1.1264060352567768,"x":7.38685662599999,"y":-2.1456963885468436,"headingDegrees":-102.11999999999999,"turnDegrees":-62.53,"length":1.0425283023647824,"timeScale":0.7457333265831005,"delay":1.4243696224880116,"rate":0.5997639303711171,"gain":0.05021713740632104,"pan":-0.18748426583985545},{"index":62,"key":"generation:coral:63","parentKey":"generation:coral:62","generation":5,"rule":"F","startX":3.5375824195213053,"startY":-8.475085792773845,"x":3.7332901965661875,"y":-9.49907980019564,"headingDegrees":-79.17999999999996,"turnDegrees":28.490000000000006,"length":1.0425283023647829,"timeScale":0.8895788315163027,"delay":2.4972673759568638,"rate":0.6727509575622516,"gain":0.048783912002160326,"pan":-0.83}]},
{"id":"dragon","count":31,"samples":[{"index":0,"key":"generation:dragon:1","parentKey":"generation:trunk","generation":1,"rule":"F","startX":1,"startY":0,"x":1.8789003791906052,"y":0.47700537047145547,"headingDegrees":28.490000000000002,"turnDegrees":28.490000000000002,"length":1,"timeScale":0.17655795283787196,"delay":0.054909523332578175,"rate":1.1532946207742993,"gain":0.18525004591462052,"pan":0.08807699779959972},{"index":1,"key":"generation:dragon:2","parentKey":"generation:dragon:1","generation":1,"rule":"F","startX":1.8789003791906052,"startY":0.47700537047145547,"x":2.645393385999955,"y":1.1192580236480398,"headingDegrees":39.96,"turnDegrees":11.47,"length":1,"timeScale":0.18619476514122094,"delay":0.11281609529149789,"rate":1.221454395652834,"gain":0.18525004591462052,"pan":0.2066661983042221},{"index":15,"key":"generation:dragon:16","parentKey":"generation:dragon:15","generation":3,"rule":"F","startX":6.548520783311555,"startY":-3.998272330642743,"x":5.599204967553393,"y":-3.6839484817998405,"headingDegrees":-198.31999999999994,"turnDegrees":11.470000000000026,"length":1,"timeScale":0.24906406200193665,"delay":1.0552335482805348,"rate":0.3705368391253177,"gain":0.10745854371877567,"pan":-0.6802253022950818},{"index":30,"key":"generation:dragon:31","parentKey":"generation:dragon:30","generation":5,"rule":"F","startX":4.961623497001431,"startY":-1.5639209246288335,"x":4.430077074910824,"y":-2.410950086560508,"headingDegrees":-482.10999999999984,"turnDegrees":-45.50999999999997,"length":0.9999999999999998,"timeScale":0.38564788373096864,"delay":2.601433394354626,"rate":0.125,"gain":0.07375434236490017,"pan":-0.4451716031185477}]},
{"id":"koch","count":47,"samples":[{"index":0,"key":"generation:koch:1","parentKey":"generation:trunk","generation":1,"rule":"F","startX":1,"startY":0,"x":1.8789003791906052,"y":0.47700537047145547,"headingDegrees":28.490000000000002,"turnDegrees":28.490000000000002,"length":1,"timeScale":0.12489929726464306,"delay":0.038843681449303995,"rate":1.1532946207742993,"gain":0.14645302043524278,"pan":0.06992879236586619},{"index":1,"key":"generation:koch:2","parentKey":"generation:koch:1","generation":1,"rule":"F","startX":1.8789003791906052,"startY":0.47700537047145547,"x":2.3401844913651653,"y":-0.4102471121147178,"headingDegrees":-62.53,"turnDegrees":-91.02000000000001,"length":1,"timeScale":0.11310634290342136,"delay":0.07401975409226805,"rate":0.7312286206667302,"gain":0.14645302043524278,"pan":-0.060142058973910555},{"index":23,"key":"generation:koch:24","parentKey":"generation:koch:23","generation":3,"rule":"F","startX":1.737387930016075,"startY":0.9867731766031831,"x":2.587004593104779,"y":0.4593724505873612,"headingDegrees":-391.83,"turnDegrees":-91.02000000000004,"length":1,"timeScale":0.16236823584800833,"delay":1.0394951565519066,"rate":0.14064368358306334,"gain":0.09476952764301412,"pan":0.06734381351717926},{"index":46,"key":"generation:koch:47","parentKey":"generation:koch:46","generation":5,"rule":"F","startX":2.845790106546812,"startY":0.4492725938511367,"x":3.7339265553603527,"y":0.9088524544726317,"headingDegrees":-692.6399999999995,"turnDegrees":28.490000000000006,"length":0.9999999999999999,"timeScale":0.24657525559943905,"delay":2.587117061754569,"rate":0.125,"gain":0.06170731004002067,"pan":0.13323739839073304}]},
{"id":"sierpinski","count":26,"samples":[{"index":0,"key":"generation:sierpinski:1","parentKey":"generation:trunk","generation":1,"rule":"G","startX":1,"startY":0,"x":1.7007847679377337,"y":-0.7133727700343325,"headingDegrees":-45.510000000000005,"turnDegrees":-45.510000000000005,"length":0.9999999999999999,"timeScale":0.21085731497489008,"delay":0.06557662495719081,"rate":0.7962628565941481,"gain":0.20711584775002437,"pan":-0.044135806314792324},{"index":1,"key":"generation:sierpinski:2","parentKey":"generation:sierpinski:1","generation":1,"rule":"F","startX":1.7007847679377337,"startY":-0.7133727700343325,"x":2.6569874086636833,"y":-1.0060782702708682,"headingDegrees":-17.019999999999996,"turnDegrees":28.490000000000002,"length":1.0000000000000002,"timeScale":0.2061047794851718,"delay":0.12967521137707924,"rate":0.9183256692324083,"gain":0.20711584775002437,"pan":-0.06224526298089467},{"index":12,"key":"generation:sierpinski:13","parentKey":"generation:sierpinski:12","generation":3,"rule":"G","startX":7.1221954363908155,"startY":-8.501344214697061,"x":7.672530459652578,"y":-9.336288142258352,"headingDegrees":-56.60999999999998,"turnDegrees":0,"length":0.9999999999999997,"timeScale":0.3114354701995283,"delay":1.0005933439732035,"rate":0.7532235434621237,"gain":0.11606849294498499,"pan":-0.5776287271603814},{"index":25,"key":"generation:sierpinski:26","parentKey":"generation:sierpinski:25","generation":5,"rule":"G","startX":-0.6389974550588766,"startY":-11.098348367302682,"x":-1.3186948379603776,"y":-10.364855717253038,"headingDegrees":-227.17999999999995,"turnDegrees":0,"length":0.9999999999999998,"timeScale":0.4409548407152946,"delay":2.5382696427590195,"rate":0.32069095208928416,"gain":0.07966379470808593,"pan":-0.6412653855507152}]},
{"id":"hilbert","count":14,"samples":[{"index":0,"key":"generation:hilbert:1","parentKey":"generation:trunk","generation":1,"rule":"F","startX":0.9562026407259496,"startY":-0.2927055002365357,"x":1.4174867529005097,"y":-1.179957982822709,"headingDegrees":-62.53,"turnDegrees":-45.510000000000005,"length":0.9999999999999999,"timeScale":0.3560148080859368,"delay":0.11072060531472634,"rate":0.7962628565941481,"gain":0.29290604087048555,"pan":-0.07739865832732866},{"index":1,"key":"generation:hilbert:2","parentKey":"generation:hilbert:1","generation":1,"rule":"F","startX":1.4174867529005097,"startY":-1.179957982822709,"x":1.1078058711817858,"y":-2.130798532808832,"headingDegrees":-108.03999999999999,"turnDegrees":-45.51,"length":0.9999999999999998,"timeScale":0.3938712786832525,"delay":0.23321457298521786,"rate":0.6340345367914729,"gain":0.29290604087048555,"pan":-0.13976849176503578},{"index":6,"key":"generation:hilbert:7","parentKey":"generation:hilbert:6","generation":3,"rule":"F","startX":2.3187023879286914,"startY":-5.672640407020851,"x":2.4041193110660593,"y":-6.668985703211757,"headingDegrees":-85.09999999999998,"turnDegrees":-45.510000000000005,"length":0.9999999999999999,"timeScale":0.5526764977002077,"delay":1.005281886171524,"rate":0.7111920543305537,"gain":0.16414563688700368,"pan":-0.43744824251956616},{"index":13,"key":"generation:hilbert:14","parentKey":"generation:hilbert:13","generation":5,"rule":"F","startX":1.9772173245203384,"startY":-12.202326453269286,"x":1.0847889463966212,"y":-12.653515537711133,"headingDegrees":-153.17999999999992,"turnDegrees":-45.51,"length":1,"timeScale":0.7537235685855765,"delay":2.493454789518992,"rate":0.5057941381429132,"gain":0.11266161890628112,"pan":-0.83}]},
{"id":"gosper","count":48,"samples":[{"index":0,"key":"generation:gosper:1","parentKey":"generation:trunk","generation":1,"rule":"Y","startX":1,"startY":0,"x":1.8789003791906052,"y":0.47700537047145547,"headingDegrees":28.490000000000002,"turnDegrees":28.490000000000002,"length":1,"timeScale":0.11554397598785962,"delay":0.03593417653222434,"rate":1.1532946207742993,"gain":0.14645302043524278,"pan":0.03129390714363065},{"index":1,"key":"generation:gosper:2","parentKey":"generation:gosper:1","generation":1,"rule":"Y","startX":1.8789003791906052,"startY":0.47700537047145547,"x":1.9578814488349117,"y":1.4738814864647323,"headingDegrees":85.47,"turnDegrees":56.98,"length":1,"timeScale":0.11626166128379936,"delay":0.07209155319148594,"rate":1.5339838917984394,"gain":0.14645302043524278,"pan":0.09669390164843798},{"index":23,"key":"generation:gosper:24","parentKey":"generation:gosper:23","generation":3,"rule":"X","startX":7.999166959492309,"startY":-10.956337466007376,"x":7.435352582188884,"y":-11.782239002478857,"headingDegrees":-124.31999999999991,"turnDegrees":-45.51,"length":1.0000000000000009,"timeScale":0.16567296840669532,"delay":1.0178608821431674,"rate":0.5366797406446816,"gain":0.08990626803906397,"pan":-0.7729730441466819},{"index":47,"key":"generation:gosper:48","parentKey":"generation:gosper:47","generation":5,"rule":"Y","startX":8.188104828203725,"startY":-12.651486938788652,"x":7.350672164721027,"y":-12.104946424158426,"headingDegrees":-573.1299999999999,"turnDegrees":-45.50999999999997,"length":0.9999999999999992,"timeScale":0.24174214899804355,"delay":2.5929120680029945,"rate":0.125,"gain":0.06170731004002067,"pan":-0.7941442441241992}]},
{"id":"cantor","count":3,"samples":[{"index":0,"key":"generation:cantor:1","parentKey":"generation:trunk","generation":2,"rule":"F","startX":2,"startY":0,"x":3,"y":0,"headingDegrees":0,"turnDegrees":0,"length":1,"timeScale":0.7320324165802521,"delay":0.2276620815564584,"rate":1,"gain":0.3431757951136902,"pan":0},{"index":1,"key":"generation:cantor:2","parentKey":"generation:cantor:1","generation":4,"rule":"F","startX":6,"startY":0,"x":7,"y":0,"headingDegrees":0,"turnDegrees":0,"length":1,"timeScale":1.1346073486979045,"delay":0.5805249670015067,"rate":1,"gain":0.2355392527038269,"pan":0},{"index":2,"key":"generation:cantor:3","parentKey":"generation:cantor:2","generation":5,"rule":"F","startX":8,"startY":0,"x":9,"y":0,"headingDegrees":0,"turnDegrees":0,"length":1,"timeScale":1.2600121540565083,"delay":0.9723887469130807,"rate":1,"gain":0.1951356480086413,"pan":0}]},
{"id":"levy","count":31,"samples":[{"index":0,"key":"generation:levy:1","parentKey":"generation:trunk","generation":1,"rule":"F","startX":-0.7928217937073554,"startY":0.6094535285176809,"x":-0.16935148566180036,"y":1.3913005563853966,"headingDegrees":51.43000000000003,"turnDegrees":-91.02,"length":0.9999999999999999,"timeScale":0.18040265948550138,"delay":0.05610522709999093,"rate":0.6340345367914729,"gain":0.18525004591462052,"pan":0.5458166802998013},{"index":1,"key":"generation:levy:2","parentKey":"generation:levy:1","generation":1,"rule":"F","startX":-0.16935148566180036,"startY":1.3913005563853966,"x":0.7849410207845264,"y":1.6901747977317985,"headingDegrees":17.390000000000033,"turnDegrees":-34.03999999999999,"length":0.9999999999999999,"timeScale":0.17774606010226032,"delay":0.1113842517917939,"rate":0.5346952956821689,"gain":0.18525004591462052,"pan":0.6630670799277785},{"index":15,"key":"generation:levy:16","parentKey":"generation:levy:15","generation":3,"rule":"F","startX":-0.3905804902168417,"startY":0.41607147667765754,"x":-0.5499447926763796,"y":-0.57114836667112,"headingDegrees":-459.1699999999997,"turnDegrees":136.90000000000015,"length":1.0000000000000002,"timeScale":0.26235440530394544,"delay":1.0527049870338194,"rate":0.125,"gain":0.10745854371877567,"pan":-0.22406539264599445},{"index":30,"key":"generation:levy:31","parentKey":"generation:levy:30","generation":5,"rule":"F","startX":-0.10630912258112335,"startY":0.760141925496098,"x":-0.5709966308871101,"y":-0.12533281701459242,"headingDegrees":-1197.6899999999994,"turnDegrees":-91.01999999999994,"length":1,"timeScale":0.3741536774664352,"delay":2.565625355533493,"rate":0.125,"gain":0.07375434236490017,"pan":-0.04916891738565349}]},
{"id":"terdragon","count":26,"samples":[{"index":0,"key":"generation:terdragon:1","parentKey":"generation:trunk","generation":1,"rule":"F","startX":1,"startY":0,"x":1.7007847679377337,"y":-0.7133727700343325,"headingDegrees":-45.510000000000005,"turnDegrees":-45.510000000000005,"length":0.9999999999999999,"timeScale":0.20938837491877416,"delay":0.06511978459973876,"rate":0.7962628565941481,"gain":0.20711584775002437,"pan":-0.06863708126634126},{"index":1,"key":"generation:terdragon:2","parentKey":"generation:terdragon:1","generation":1,"rule":"F","startX":1.7007847679377337,"startY":-0.7133727700343325,"x":2.6569874086636833,"y":-1.0060782702708682,"headingDegrees":-17.019999999999996,"turnDegrees":28.490000000000002,"length":1.0000000000000002,"timeScale":0.19799646220387188,"delay":0.12669668434514292,"rate":0.9183256692324083,"gain":0.20711584775002437,"pan":-0.09679970822766087},{"index":12,"key":"generation:terdragon:13","parentKey":"generation:terdragon:12","generation":3,"rule":"F","startX":0.894360643763657,"startY":-8.626523567208473,"x":0.14691028670781647,"y":-7.962205899419112,"headingDegrees":-221.62999999999997,"turnDegrees":-45.51,"length":0.9999999999999998,"timeScale":0.30988269231314863,"delay":1.0200581044075487,"rate":0.3297258470882124,"gain":0.11606849294498499,"pan":-0.7660827499085362},{"index":25,"key":"generation:terdragon:26","parentKey":"generation:terdragon:25","generation":5,"rule":"F","startX":-9.308682625106558,"startY":-4.052474589878296,"x":-10.060407343581119,"y":-3.3929975640204253,"headingDegrees":-221.25999999999988,"turnDegrees":28.490000000000006,"length":1.0000000000000002,"timeScale":0.43354146734259924,"delay":2.5501028982171734,"rate":0.3303371455410034,"gain":0.07966379470808593,"pan":-0.3264568810594771}]}],"pruning":[{"bias":0,"voices":[{"key":"generation:trunk/A","gain":0.29290604087048555},{"key":"generation:trunk/B","gain":0.29290604087048555},{"key":"generation:trunk/A/A","gain":0.1715878975568451},{"key":"generation:trunk/A/B","gain":0.1715878975568451},{"key":"generation:trunk/B/A","gain":0.1715878975568451},{"key":"generation:trunk/B/B","gain":0.1715878975568451},{"key":"generation:trunk/A/A/A","gain":0.11606849294498499},{"key":"generation:trunk/A/A/B","gain":0.11606849294498499},{"key":"generation:trunk/A/B/A","gain":0.11606849294498499},{"key":"generation:trunk/A/B/B","gain":0.11606849294498499},{"key":"generation:trunk/B/A/A","gain":0.11606849294498499},{"key":"generation:trunk/B/A/B","gain":0.11606849294498499}]},
{"bias":0.35,"voices":[{"key":"generation:trunk/B","gain":0.29290604087048555},{"key":"generation:trunk/B/B","gain":0.1715878975568451},{"key":"generation:trunk/B/A","gain":0.1715878975568451},{"key":"generation:trunk/A","gain":0.29290604087048555},{"key":"generation:trunk/A/B","gain":0.1715878975568451},{"key":"generation:trunk/B/B/B","gain":0.127146663603195},{"key":"generation:trunk/B/A/B","gain":0.127146663603195},{"key":"generation:trunk/B/A/A","gain":0.127146663603195},{"key":"generation:trunk/A/A","gain":0.1715878975568451},{"key":"generation:trunk/A/B/B","gain":0.127146663603195},{"key":"generation:trunk/A/A/A","gain":0.127146663603195},{"key":"generation:trunk/B/A/A/A","gain":0.2355392527038269}]},
{"bias":0.65,"voices":[{"key":"generation:trunk/B","gain":0.29290604087048555},{"key":"generation:trunk/B/B","gain":0.1981326376882529},{"key":"generation:trunk/B/A","gain":0.1981326376882529},{"key":"generation:trunk/B/B/B","gain":0.1421542914645212},{"key":"generation:trunk/B/A/B","gain":0.1421542914645212},{"key":"generation:trunk/B/A/A","gain":0.1421542914645212},{"key":"generation:trunk/A","gain":0.29290604087048555},{"key":"generation:trunk/B/B/B/B","gain":0.13598865095327775},{"key":"generation:trunk/A/B","gain":0.1981326376882529},{"key":"generation:trunk/B/A/B/B","gain":0.13598865095327775},{"key":"generation:trunk/B/A/A/A","gain":0.13598865095327775},{"key":"generation:trunk/A/B/B","gain":0.1421542914645212}]},
{"bias":1,"voices":[{"key":"generation:trunk/B","gain":0.41423169550004874},{"key":"generation:trunk/B/B","gain":0.24266193186397556},{"key":"generation:trunk/B/B/B","gain":0.16414563688700368},{"key":"generation:trunk/B/B/B/B","gain":0.16655140282248784},{"key":"generation:trunk/B/B/B/B/B","gain":0.09756782400432065},{"key":"generation:trunk/B/B/B/B/A","gain":0.09756782400432065},{"key":"generation:trunk/B/A","gain":0.24266193186397556},{"key":"generation:trunk/B/A/B","gain":0.16414563688700368},{"key":"generation:trunk/B/A/B/B","gain":0.16655140282248784},{"key":"generation:trunk/B/A/B/B/A","gain":0.09756782400432065},{"key":"generation:trunk/B/A/B/B/B","gain":0.09756782400432065},{"key":"generation:trunk/B/A/A","gain":0.16414563688700368}]}]}"#;

    fn golden_parameters() -> Parameters {
        Parameters {
            generations: 5,
            interval_ms: 311.,
            time_ratio: 1.2,
            angle: 37.,
            asymmetry: -0.23,
            mutation: 0.37,
            pitch_scale: 1.3,
            depth: 0.77,
            spread: 0.83,
            ..Parameters::default()
        }
    }

    #[test]
    fn original_javascript_golden_geometry_and_audio_match_all_eleven_grammars() {
        let fixtures: serde_json::Value = serde_json::from_str(ORIGINAL_JS_FIXTURES).unwrap();
        for fixture in fixtures["cases"].as_array().unwrap() {
            let id = fixture["id"].as_str().unwrap();
            let topology = compile(
                &Parameters {
                    l_system_type: id.into(),
                    ..golden_parameters()
                },
                48_000,
            );
            assert_eq!(
                topology.nodes.len(),
                fixture["count"].as_u64().unwrap() as usize,
                "{id}"
            );
            for sample in fixture["samples"].as_array().unwrap() {
                let index = sample["index"].as_u64().unwrap() as usize;
                let actual = serde_json::to_value(&topology.nodes[index]).unwrap();
                for (field, expected) in sample.as_object().unwrap() {
                    if field == "index" {
                        continue;
                    }
                    if expected.is_number() && field != "generation" {
                        let expected = expected.as_f64().unwrap();
                        let actual = actual[field].as_f64().unwrap();
                        assert!(
                            (actual - expected).abs() <= 1e-11 * (1. + expected.abs()),
                            "{id}/{index}/{field}: native={actual}, original={expected}"
                        );
                    } else {
                        assert_eq!(&actual[field], expected, "{id}/{index}/{field}");
                    }
                }
            }
        }
    }

    #[test]
    fn original_continuous_pruning_order_and_selected_generation_gain_match() {
        let fixtures: serde_json::Value = serde_json::from_str(ORIGINAL_JS_FIXTURES).unwrap();
        let mut distinct_orders = Vec::new();
        for fixture in fixtures["pruning"].as_array().unwrap() {
            let topology = compile(
                &Parameters {
                    pruning_bias: fixture["bias"].as_f64().unwrap(),
                    ..golden_parameters()
                },
                48_000,
            );
            let expected = fixture["voices"].as_array().unwrap();
            let mut order: Vec<usize> = (0..topology.nodes.len())
                .filter(|&index| topology.ranks[index] < expected.len())
                .collect();
            order.sort_by_key(|&index| topology.ranks[index]);
            let mut counts = [0_usize; 256];
            for &index in &order {
                counts[usize::from(topology.groups[index])] += 1;
            }
            assert_eq!(order.len(), expected.len());
            for (&index, expected) in order.iter().zip(expected) {
                assert_eq!(topology.nodes[index].key, expected["key"].as_str().unwrap());
                let gain = topology.targets[index].gain
                    / (counts[usize::from(topology.groups[index])] as f64).sqrt();
                assert!((gain - expected["gain"].as_f64().unwrap()).abs() < 1e-13);
            }
            distinct_orders.push(order);
        }
        assert_ne!(distinct_orders[0], distinct_orders[1]);
        assert_ne!(distinct_orders[1], distinct_orders[2]);
        assert_ne!(distinct_orders[2], distinct_orders[3]);
    }

    #[test]
    fn complete_tree_has_uncapped_stable_indices_and_literal_inherited_timing() {
        let full = compile(&Parameters::default(), 48_000);
        assert_eq!(full.requested_voices, 16_382);
        assert_eq!(full.eligible_voices, full.requested_voices);
        let last = full.nodes.last().unwrap();
        assert_eq!(last.generation, 13);
        assert_eq!(last.voice_index, 16_381);
        assert_eq!(last.key, format!("generation:trunk{}", "/B".repeat(13)));
        assert!((last.turn_degrees - 45.).abs() < 1e-14);
        assert_eq!(last.rate, 8.);
        let expected_delay = 0.24 * (1..=13).map(|g| 0.72_f64.powi(g)).sum::<f64>();
        let expected_x = 1.
            + (1..=13)
                .map(|g| 0.72_f64.powi(g).max(0.02) * (f64::from(g) * 45.).to_radians().cos())
                .sum::<f64>();
        let expected_y = (1..=13)
            .map(|g| 0.72_f64.powi(g).max(0.02) * (f64::from(g) * 45.).to_radians().sin())
            .sum::<f64>();
        assert!((last.delay - expected_delay).abs() < 1e-14);
        assert!((last.x - expected_x).abs() < 1e-14);
        assert!((last.y - expected_y).abs() < 1e-14);
        assert_eq!(full.nodes[0].parent, 0);
        assert!((full.nodes[0].delay - 0.24 * 0.72).abs() < 1e-14);
        assert!((full.nodes[2].delay - 0.24 * (0.72 + 0.72_f64.powi(2))).abs() < 1e-14);
        let keys = pool_keys(POOL_VOICES).unwrap();
        assert_eq!(
            &keys[..6],
            [
                "generation:trunk/A",
                "generation:trunk/B",
                "generation:trunk/A/A",
                "generation:trunk/A/B",
                "generation:trunk/B/A",
                "generation:trunk/B/B"
            ]
        );
        assert_eq!(keys.len(), full.targets.len());
        assert_eq!(full.ranks, (0..POOL_VOICES).collect::<Vec<_>>());
        assert!((last.gain - full.targets[last.voice_index].gain / 8192_f64.sqrt()).abs() < 1e-14);
    }

    #[test]
    fn edits_change_acoustics_but_preserve_slots_and_classic_mutation_only_changes_timing() {
        let original = Parameters {
            generations: 5,
            ..Parameters::default()
        };
        let plain = compile(&original, 48_000);
        let changed = Parameters {
            mutation: 0.4,
            asymmetry: 0.2,
            pitch_scale: 1.5,
            spread: 0.2,
            depth: 0.9,
            ..original.clone()
        };
        let first = compile(&changed, 48_000);
        assert_eq!(first.nodes, compile(&changed, 48_000).nodes);
        assert_eq!(first.nodes.len(), plain.nodes.len());
        assert_eq!(first.nodes[20].voice_index, plain.nodes[20].voice_index);
        assert_ne!(first.nodes[20].delay, plain.nodes[20].delay);
        assert_ne!(first.nodes[20].rate, plain.nodes[20].rate);
        assert_ne!(first.nodes[20].pan, plain.nodes[20].pan);
        assert_ne!(first.nodes[20].gain, plain.nodes[20].gain);
        let classic = Parameters {
            l_system_type: "coral".into(),
            ..original.clone()
        };
        let a = compile(&classic, 48_000);
        let b = compile(
            &Parameters {
                mutation: 0.8,
                ..classic
            },
            48_000,
        );
        assert_eq!(a.nodes[10].x, b.nodes[10].x);
        assert_eq!(a.nodes[10].y, b.nodes[10].y);
        assert_eq!(a.nodes[10].rate, b.nodes[10].rate);
        assert_ne!(a.nodes[10].delay, b.nodes[10].delay);
        let long = compile(
            &Parameters {
                interval_ms: 3000.,
                time_ratio: 2.,
                ..original
            },
            48_000,
        );
        assert!(long.eligible_voices < long.requested_voices);
        assert!(long
            .nodes
            .iter()
            .filter(|n| n.delay > 39.)
            .all(|n| n.gain == 0. && n.priority.is_none()));
    }

    #[test]
    fn every_grammar_and_pruning_prefix_is_bounded_connected_and_ranked_once() {
        for id in L_SYSTEM_TYPES {
            for bias in [0., 0.35, 0.65, 1.] {
                let full = compile(
                    &Parameters {
                        l_system_type: id.into(),
                        pruning_bias: bias,
                        ..Parameters::default()
                    },
                    48_000,
                );
                assert!(full.requested_voices <= POOL_VOICES, "{id}");
                let mut ranks: Vec<usize> = full
                    .ranks
                    .iter()
                    .copied()
                    .filter(|&r| r != usize::MAX)
                    .collect();
                ranks.sort_unstable();
                assert_eq!(
                    ranks,
                    (0..full.eligible_voices).collect::<Vec<_>>(),
                    "{id}/{bias}"
                );
                for node in &full.nodes {
                    if let Some(priority) = node.priority {
                        if node.parent > 0 {
                            assert!(
                                full.ranks[node.parent - 1] < priority,
                                "{id}/{bias}/{}",
                                node.id
                            );
                        }
                        assert_eq!(full.groups[node.voice_index], node.generation);
                    }
                    assert!(node.x.is_finite() && node.y.is_finite() && node.delay.is_finite());
                    assert!((0.125..=8.).contains(&node.rate));
                }
            }
        }
        let zero = compile(
            &Parameters {
                depth: 0.,
                pruning_bias: 1.,
                ..Parameters::default()
            },
            48_000,
        );
        assert_eq!(zero.eligible_voices, 0);
        assert!(zero.ranks.iter().all(|&rank| rank == usize::MAX));
    }

    #[test]
    fn depth_pruning_reaches_the_full_native_crown_without_changing_stable_slots() {
        let breadth = compile(&Parameters::default(), 48_000);
        let depth = compile(
            &Parameters {
                pruning_bias: 1.,
                ..Parameters::default()
            },
            48_000,
        );
        let crown = |topology: &Topology| {
            topology
                .nodes
                .iter()
                .filter(|node| node.priority.is_some_and(|rank| rank < 48))
                .map(|node| node.generation)
                .max()
                .unwrap()
        };
        assert_eq!(crown(&breadth), 5);
        assert_eq!(crown(&depth), 13);
        for (a, b) in breadth.nodes.iter().zip(&depth.nodes) {
            assert_eq!(
                (a.voice_index, &a.key, a.delay, a.rate, a.x, a.y),
                (b.voice_index, &b.key, b.delay, b.rate, b.x, b.y)
            );
        }
    }

    #[test]
    fn cantor_pen_up_distance_preserves_gaps_and_acoustic_tail() {
        let topology = compile(
            &Parameters {
                l_system_type: "cantor".into(),
                generations: 13,
                angle: 0.,
                ..Parameters::default()
            },
            48_000,
        );
        assert_eq!(topology.nodes.len(), 63);
        assert_eq!(topology.nodes[0].start_x, 2.);
        assert_eq!(topology.nodes[0].x, 3.);
        assert!(topology
            .nodes
            .windows(2)
            .any(|nodes| nodes[1].start_x > nodes[0].x));
        assert!(
            topology.nodes.last().unwrap().delay
                < 0.24 * (1..=13).map(|g| 0.72_f64.powi(g)).sum::<f64>()
        );
    }

    #[test]
    fn larger_binary_and_classic_trees_are_not_limited_by_the_old_pool() {
        let larger = compile(
            &Parameters {
                generations: 14,
                ..Parameters::default()
            },
            48000,
        );
        assert_eq!(larger.requested_voices, 32766);
        assert_eq!(larger.eligible_voices, 32766);
        assert_eq!(larger.groups.last(), Some(&14));
        let classic = compile(
            &Parameters {
                generations: 17,
                l_system_type: "dragon".into(),
                ..Parameters::default()
            },
            48000,
        );
        assert!(classic.requested_voices > 16384);
        assert!(try_compile(
            &Parameters {
                generations: 52,
                ..Parameters::default()
            },
            48000
        )
        .is_err());
        assert!(generation_limit("pythagorean", 100000) >= 15);
        assert!(
            generation_limit("cantor", 200000) >= 35,
            "Rewrite characters are bytes, not 2 KiB voices"
        );
        for (rank, node) in larger.preview.iter().skip(1).enumerate() {
            assert_eq!(node.priority, Some(rank));
        }
        assert_eq!(larger.preview.len(), 2049);
    }
    #[test]
    fn parameter_boundary_rejects_nonfinite_unknown_grammar_and_out_of_range_pruning() {
        for parameters in [
            Parameters {
                time_ratio: f64::NAN,
                ..Parameters::default()
            },
            Parameters {
                generations: 53,
                ..Parameters::default()
            },
            Parameters {
                l_system_type: "unknown".into(),
                ..Parameters::default()
            },
            Parameters {
                pruning_bias: -1.1,
                ..Parameters::default()
            },
            Parameters {
                pruning_bias: 1.1,
                ..Parameters::default()
            },
        ] {
            assert!(parameters.validate().is_err());
        }
        assert!(Parameters {
            pruning_bias: -0.35,
            ..Parameters::default()
        }
        .validate()
        .is_ok());
        assert!(serde_json::from_str::<Parameters>(r#"{"typo":1}"#).is_err());
        assert_eq!(
            serde_json::from_str::<Parameters>("{}").unwrap(),
            Parameters::default()
        );
        let json = serde_json::to_value(Parameters::default()).unwrap();
        assert_eq!(json["lSystemType"], "pythagorean");
        assert_eq!(json["pruningBias"], 0.);
    }
}
