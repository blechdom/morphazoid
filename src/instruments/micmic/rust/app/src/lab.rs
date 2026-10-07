//! Pure experimental rewrite compilers, shared verbatim by CPAL and WASM.
//! Mathematical definitions/provenance: docs/l-system-labs-models.md.
use super::{hash_unit, LayoutNode, Parameters};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

const KINDS: [&str; 6] = [
    "parametric",
    "context",
    "thue-morse",
    "fibonacci",
    "penrose",
    "sphinx",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct LabParameters {
    pub kind: String,
    pub iterations: u8,
    pub length_ratio: f64,
    pub angle_increment: f64,
    pub delay_ratio: f64,
    pub pitch_ratio: f64,
    pub branch_count: u8,
    pub min_length: f64,
    pub context_strength: f64,
    pub symbol_ratio: f64,
}
impl Default for LabParameters {
    fn default() -> Self {
        Self {
            kind: "parametric".into(),
            iterations: 6,
            length_ratio: 0.72,
            angle_increment: 0.,
            delay_ratio: 0.72,
            pitch_ratio: 1.,
            branch_count: 2,
            min_length: 0.03,
            context_strength: 0.5,
            symbol_ratio: 1.5,
        }
    }
}
impl LabParameters {
    pub fn validate(&self) -> Result<(), String> {
        if !KINDS.contains(&self.kind.as_str()) {
            return Err("lab.kind must name a supported rewrite experiment".into());
        }
        if !(1..=24).contains(&self.iterations) {
            return Err("lab.iterations must be between 1 and 24".into());
        }
        if !(2..=6).contains(&self.branch_count) {
            return Err("lab.branchCount must be between 2 and 6".into());
        }
        for (name, value, low, high) in [
            ("lengthRatio", self.length_ratio, 0.2, 1.25),
            ("angleIncrement", self.angle_increment, -90., 90.),
            ("delayRatio", self.delay_ratio, 0.2, 2.),
            ("pitchRatio", self.pitch_ratio, 0.5, 2.),
            ("minLength", self.min_length, 0.001, 1.),
            ("contextStrength", self.context_strength, 0., 1.),
            ("symbolRatio", self.symbol_ratio, 0.25, 4.),
        ] {
            if !value.is_finite() || !(low..=high).contains(&value) {
                return Err(format!(
                    "lab.{name} must be finite and between {low} and {high}"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Point(f64, f64);
impl Point {
    fn mix(self, other: Self, amount: f64) -> Self {
        Self(
            self.0 + (other.0 - self.0) * amount,
            self.1 + (other.1 - self.1) * amount,
        )
    }
    fn distance(self, other: Self) -> f64 {
        (self.0 - other.0).hypot(self.1 - other.1)
    }
    fn key(self) -> (i64, i64) {
        // Shared algebraic vertices reach the same bucket despite roundoff.
        (
            (self.0 * 1e10).round() as i64,
            (self.1 * 1e10).round() as i64,
        )
    }
}

#[allow(clippy::too_many_arguments)]
fn segment(
    id: String,
    parent: usize,
    generation: u8,
    rule: char,
    start: Point,
    end: Point,
    turn: f64,
    time_scale: f64,
    pitch: f64,
) -> LayoutNode {
    LayoutNode {
        id,
        parent,
        generation,
        rule,
        start_x: start.0,
        start_y: start.1,
        x: end.0,
        y: end.1,
        heading: (end.1 - start.1).atan2(end.0 - start.0).to_degrees(),
        turn,
        length: start.distance(end),
        time_scale,
        module_pitch: Some(pitch),
    }
}

pub(super) fn layout(
    parameters: &Parameters,
    lab: &LabParameters,
) -> Result<Vec<LayoutNode>, String> {
    match lab.kind.as_str() {
        "parametric" => parametric(parameters, lab),
        "context" | "thue-morse" | "fibonacci" => sequence(parameters, lab),
        "penrose" => edges_layout(parameters, lab, &penrose(lab.iterations)?),
        "sphinx" => edges_layout(parameters, lab, &sphinx(lab.iterations)?),
        _ => unreachable!("validated lab kind"),
    }
}

/// Prepare only the caller's measured voice budget. Requested demand is kept
/// separately so a small prepared graph never changes the performer's rule.
/// Parametric demand is an upper bound when mutation prunes unknown descendants;
/// deterministic sequences and canonical tilings have arithmetic exact counts.
pub(super) fn bounded_layout(
    parameters: &Parameters,
    lab: &LabParameters,
    voice_budget: usize,
) -> Result<(Vec<LayoutNode>, u64, LabParameters), String> {
    lab.validate()?;
    match lab.kind.as_str() {
        "parametric" => bounded_parametric(parameters, lab, voice_budget),
        "context" | "thue-morse" | "fibonacci" => {
            let requested = sequence_counts(&lab.kind, lab.iterations)
                .0
                .saturating_sub(1);
            let nodes = if requested <= voice_budget as u64 {
                sequence(parameters, lab)?
            } else {
                bounded_sequence(parameters, lab, voice_budget)?
            };
            Ok((nodes, requested, lab.clone()))
        }
        "penrose" | "sphinx" => {
            let requested = tiling_edge_count(&lab.kind, lab.iterations);
            let mut effective = lab.clone();
            // Keep a complete canonical covering whenever one fits. Choosing
            // its order precedes allocation; no fine tiling is built then cut.
            while effective.iterations > 1
                && tiling_edge_count(&lab.kind, effective.iterations) > voice_budget as u64
            {
                effective.iterations -= 1;
            }
            let mut nodes = layout(parameters, &effective)?;
            // Budgets smaller than the first legal covering still receive a
            // connected prefix of that small covering, including its input root.
            nodes.truncate(voice_budget.saturating_add(1));
            Ok((nodes, requested, effective))
        }
        _ => unreachable!("validated lab kind"),
    }
}

fn parametric_demand(lab: &LabParameters) -> u64 {
    let mut count = 0_u64;
    let mut frontier = 1_u64;
    let mut length = 1.;
    for _ in 0..lab.iterations {
        length *= lab.length_ratio;
        // Mutation only shortens modules. This maximum-length path bounds all
        // branches without visiting any of the unavailable descendants.
        // Segment lengths are measured from their Cartesian endpoints, so
        // retain a small relative roundoff margin at a cutoff equality.
        if length < lab.min_length * (1. - 1e-12) {
            break;
        }
        frontier = frontier.saturating_mul(u64::from(lab.branch_count));
        count = count.saturating_add(frontier);
    }
    count
}

fn parametric_child(
    parameters: &Parameters,
    lab: &LabParameters,
    prior: &LayoutNode,
    parent: usize,
    generation: u8,
    child: u8,
) -> Option<LayoutNode> {
    let id = format!("{}/{child}", prior.id);
    let variation = 1. - parameters.mutation * hash_unit(&id) * 0.25;
    let length = prior.length * lab.length_ratio * variation;
    if length < lab.min_length {
        return None;
    }
    let offset = f64::from(child) / f64::from(lab.branch_count - 1) * 2. - 1.;
    let turn = offset * parameters.angle * (1. + parameters.asymmetry * offset)
        + lab.angle_increment * f64::from(generation);
    let heading = prior.heading + turn;
    let start = Point(prior.x, prior.y);
    let end = Point(
        start.0 + heading.to_radians().cos() * length,
        start.1 + heading.to_radians().sin() * length,
    );
    let duration = prior.time_scale * lab.delay_ratio * parameters.time_ratio * variation;
    let pitch = prior.module_pitch.unwrap_or(0.) + 12. * lab.pitch_ratio.log2() + turn / 180. * 12.;
    Some(segment(
        id,
        parent,
        generation,
        char::from(b'A' + child),
        start,
        end,
        turn,
        duration,
        pitch,
    ))
}

fn parametric_root() -> LayoutNode {
    segment(
        "trunk".into(),
        0,
        0,
        'F',
        Point(0., 0.),
        Point(1., 0.),
        0.,
        1.,
        0.,
    )
}

fn bounded_parametric(
    parameters: &Parameters,
    lab: &LabParameters,
    voice_budget: usize,
) -> Result<(Vec<LayoutNode>, u64, LabParameters), String> {
    let requested = parametric_demand(lab);
    let storage = voice_budget
        .min(requested.min(usize::MAX as u64) as usize)
        .saturating_add(1);
    crate::resources::check_voices(storage)?;
    let mut nodes = crate::resources::reserve(storage)?;
    nodes.push(parametric_root());
    if parameters.pruning_bias >= 0.5 && requested > voice_budget as u64 {
        // A stack holds just one unfinished ancestor per generation. Depth
        // preference retains full-length paths instead of only broad layers.
        let mut stack = vec![(0usize, 0_u8)];
        while let Some((parent, child)) = stack.pop() {
            let generation = nodes[parent].generation + 1;
            if generation > lab.iterations || child >= lab.branch_count {
                continue;
            }
            stack.push((parent, child + 1));
            if let Some(node) =
                parametric_child(parameters, lab, &nodes[parent], parent, generation, child)
            {
                if nodes.len().saturating_sub(1) == voice_budget {
                    return Ok((nodes, requested, lab.clone()));
                }
                let index = nodes.len();
                nodes.push(node);
                stack.push((index, 0));
            }
        }
        // Mutation can make the upper bound conservative. When the complete
        // graph actually fits, reconstruct its original BFS order using the
        // same bounded builder, without reserving a whole unpruned frontier.
        return bounded_parametric(
            &Parameters {
                pruning_bias: 0.,
                ..parameters.clone()
            },
            lab,
            voice_budget,
        );
    }
    let mut first = 0;
    let mut last = 1;
    for generation in 1..=lab.iterations {
        for parent in first..last {
            for child in 0..lab.branch_count {
                if let Some(node) =
                    parametric_child(parameters, lab, &nodes[parent], parent, generation, child)
                {
                    if nodes.len().saturating_sub(1) == voice_budget {
                        return Ok((nodes, requested, lab.clone()));
                    }
                    nodes.push(node);
                }
            }
        }
        if nodes.len() == last {
            break;
        }
        first = last;
        last = nodes.len();
    }
    let requested = nodes.len().saturating_sub(1) as u64;
    Ok((nodes, requested, lab.clone()))
}

/// A(l,t,p,a) : l >= min -> F(l,t,p) [A(l*r,t*d,p*q,a+delta)]...
/// A(l,t,p,a) : l < min -> epsilon. Module values survive each parallel pass.
fn parametric(parameters: &Parameters, lab: &LabParameters) -> Result<Vec<LayoutNode>, String> {
    let mut nodes = crate::resources::reserve(1)?;
    nodes.push(parametric_root());
    let mut frontier = crate::resources::reserve(1)?;
    frontier.push(0usize);
    for generation in 1..=lab.iterations {
        let demand = frontier
            .len()
            .checked_mul(usize::from(lab.branch_count))
            .and_then(|count| count.checked_add(nodes.len()))
            .ok_or("Parametric rewrite exceeds addressable storage")?;
        crate::resources::check_voices(demand)?;
        nodes
            .try_reserve(demand.saturating_sub(nodes.len()))
            .map_err(|e| e.to_string())?;
        let mut next = crate::resources::reserve(demand.saturating_sub(nodes.len()))?;
        for parent in frontier {
            let prior = nodes[parent].clone();
            for child in 0..lab.branch_count {
                if let Some(node) =
                    parametric_child(parameters, lab, &prior, parent, generation, child)
                {
                    let index = nodes.len();
                    nodes.push(node);
                    next.push(index);
                }
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    Ok(nodes)
}

fn rewritten_word(kind: &str, iterations: u8) -> Result<Vec<u8>, String> {
    if kind == "context" {
        // Fixed zero boundary; every centre rewrites in parallel from its OLD
        // left/right neighbours. This is the radius-one XOR context rule.
        let count = usize::from(iterations) * 2 + 3;
        let mut word = crate::resources::filled(count, b'0')?;
        word[count / 2] = b'1';
        for _ in 0..iterations {
            let mut next = crate::resources::filled(count, b'0')?;
            for index in 1..count - 1 {
                next[index] = if word[index - 1] != word[index + 1] {
                    b'1'
                } else {
                    b'0'
                };
            }
            word = next;
        }
        return Ok(word);
    }
    let mut word = vec![if kind == "thue-morse" { b'0' } else { b'A' }];
    for _ in 0..iterations {
        let count = word
            .iter()
            .try_fold(0usize, |n, c| {
                n.checked_add(if kind == "fibonacci" && *c == b'B' {
                    1
                } else {
                    2
                })
            })
            .ok_or("Sequence rewrite exceeds addressable storage")?;
        crate::resources::check_voices(count)?;
        let mut next = crate::resources::reserve(count)?;
        for c in word {
            match (kind, c) {
                ("thue-morse", b'0') => next.extend_from_slice(b"01"),
                ("thue-morse", b'1') => next.extend_from_slice(b"10"),
                ("fibonacci", b'A') => next.extend_from_slice(b"AB"),
                ("fibonacci", b'B') => next.push(b'A'),
                _ => unreachable!("sequence alphabet"),
            }
        }
        word = next;
    }
    Ok(word)
}

/// (word length, count of the second symbol), without expanding the word.
fn sequence_counts(kind: &str, iterations: u8) -> (u64, u64) {
    match kind {
        "context" => (
            u64::from(iterations) * 2 + 3,
            1_u64 << iterations.count_ones(),
        ),
        "thue-morse" => {
            let length = 1_u64 << iterations;
            (length, if iterations == 0 { 0 } else { length / 2 })
        }
        "fibonacci" => {
            let (mut a, mut b) = (1_u64, 0_u64);
            for _ in 0..iterations {
                (a, b) = (a.saturating_add(b), a);
            }
            (a.saturating_add(b), b)
        }
        _ => unreachable!("sequence kind"),
    }
}

fn fibonacci_lengths(iterations: u8) -> [u64; 25] {
    // Supported numeric rule depth, not a voice ceiling. Each slot counts A's
    // descendants at that rewrite depth; B's length is the preceding A length.
    let mut lengths = [1_u64; 25];
    for index in 1..=usize::from(iterations) {
        lengths[index] =
            lengths[index - 1].saturating_add(if index == 1 { 1 } else { lengths[index - 2] });
    }
    lengths
}

fn sequence_symbol(kind: &str, iterations: u8, index: usize, lengths: &[u64; 25]) -> u8 {
    match kind {
        "context" => {
            // Rule 90's nth row is the binomial row modulo two. Its active
            // cone stays inside the existing fixed-zero boundary at every pass.
            let displacement = index as i64 - (i64::from(iterations) + 1);
            let diagonal = i64::from(iterations) + displacement;
            if diagonal < 0 || diagonal % 2 != 0 {
                return b'0';
            }
            let k = diagonal / 2;
            if k > i64::from(iterations) || (k as u64 & !u64::from(iterations)) != 0 {
                b'0'
            } else {
                b'1'
            }
        }
        "thue-morse" => {
            if index.count_ones() & 1 == 0 {
                b'0'
            } else {
                b'1'
            }
        }
        "fibonacci" => {
            let mut index = index as u64;
            let mut symbol = b'A';
            for depth in (1..=usize::from(iterations)).rev() {
                if symbol == b'B' {
                    symbol = b'A';
                } else if index >= lengths[depth - 1] {
                    index -= lengths[depth - 1];
                    symbol = b'B';
                }
            }
            symbol
        }
        _ => unreachable!("sequence kind"),
    }
}

struct SequenceCursor {
    position: Point,
    heading: f64,
    progress: f64,
}
impl SequenceCursor {
    fn new() -> Self {
        Self {
            position: Point(0., 0.),
            heading: 0.,
            progress: 0.,
        }
    }
    fn next(
        &mut self,
        parameters: &Parameters,
        lab: &LabParameters,
        index: usize,
        c: u8,
        weight: f64,
        total: f64,
    ) -> LayoutNode {
        let polarity = if c == b'1' || c == b'B' { 1. } else { -1. };
        let turn = if index == 0 {
            0.
        } else {
            polarity * parameters.angle * (1. + polarity * parameters.asymmetry)
        };
        self.heading += turn;
        let id = if index == 0 {
            "trunk".into()
        } else {
            format!("{}:{index}", lab.kind)
        };
        let variation = 1. - parameters.mutation * hash_unit(&id) * 0.25;
        let length = weight * variation;
        let end = Point(
            self.position.0 + f64::cos(f64::to_radians(self.heading)) * length,
            self.position.1 + f64::sin(f64::to_radians(self.heading)) * length,
        );
        let start = self.progress / total;
        self.progress += weight;
        let end_time = self.progress / total;
        let generation = if index == 0 {
            0
        } else {
            (end_time * f64::from(lab.iterations))
                .ceil()
                .clamp(1., f64::from(lab.iterations)) as u8
        };
        let duration = (super::acoustic_path_time(end_time, lab.iterations, parameters.time_ratio)
            - super::acoustic_path_time(start, lab.iterations, parameters.time_ratio))
        .max(1e-9)
            * variation;
        let pitch = polarity * 12. * lab.symbol_ratio.log2() + self.heading / 180. * 12.;
        let node = segment(
            id,
            index.saturating_sub(1),
            generation,
            char::from(c),
            self.position,
            end,
            turn,
            duration,
            pitch,
        );
        self.position = end;
        node
    }
}

fn bounded_sequence(
    parameters: &Parameters,
    lab: &LabParameters,
    voice_budget: usize,
) -> Result<Vec<LayoutNode>, String> {
    let (length, second_count) = sequence_counts(&lab.kind, lab.iterations);
    let lengths = fibonacci_lengths(lab.iterations);
    let symbol = |index| sequence_symbol(&lab.kind, lab.iterations, index, &lengths);
    let is_second = |c| c == b'1' || c == b'B';
    let weight = |index: usize| {
        let neighbours = if lab.kind == "context" {
            f64::from(index.checked_sub(1).is_some_and(|n| is_second(symbol(n))) as u8)
                + f64::from(((index as u64 + 1) < length && is_second(symbol(index + 1))) as u8)
        } else {
            0.
        };
        (if is_second(symbol(index)) {
            lab.symbol_ratio
        } else {
            1.
        }) * (1. + neighbours * lab.context_strength * 0.5)
    };
    let total = if lab.kind == "context" {
        // Context words are intrinsically just 2*n+3 symbols, including their
        // boundaries, so exact normalization needs at most 51 scalar samples.
        (0..length as usize).map(weight).sum::<f64>()
    } else {
        (length - second_count) as f64 + second_count as f64 * lab.symbol_ratio
    };
    let count = voice_budget.saturating_add(1).min(length as usize);
    crate::resources::check_voices(count)?;
    let mut nodes = crate::resources::reserve(count)?;
    let mut cursor = SequenceCursor::new();
    for index in 0..count {
        nodes.push(cursor.next(parameters, lab, index, symbol(index), weight(index), total));
    }
    Ok(nodes)
}

fn sequence(parameters: &Parameters, lab: &LabParameters) -> Result<Vec<LayoutNode>, String> {
    let word = rewritten_word(&lab.kind, lab.iterations)?;
    let is_second = |c| c == b'1' || c == b'B';
    let weights: Vec<f64> = word
        .iter()
        .enumerate()
        .map(|(index, &c)| {
            let neighbours = if lab.kind == "context" {
                f64::from(index.checked_sub(1).is_some_and(|n| is_second(word[n])) as u8)
                    + f64::from(word.get(index + 1).is_some_and(|&n| is_second(n)) as u8)
            } else {
                0.
            };
            (if is_second(c) { lab.symbol_ratio } else { 1. })
                * (1. + neighbours * lab.context_strength * 0.5)
        })
        .collect();
    let total = weights.iter().sum::<f64>();
    let mut nodes: Vec<LayoutNode> = crate::resources::reserve(word.len())?;
    let mut cursor = SequenceCursor::new();
    for (index, (&c, &weight)) in word.iter().zip(&weights).enumerate() {
        nodes.push(cursor.next(parameters, lab, index, c, weight, total));
    }
    Ok(nodes)
}

#[derive(Clone, Debug)]
struct Tile {
    vertices: Vec<Point>,
    rule: char,
}
#[derive(Clone, Copy)]
struct Triangle {
    a: Point,
    b: Point,
    c: Point,
    thin: bool,
}

fn tiling_edge_count(kind: &str, iterations: u8) -> u64 {
    if kind == "sphinx" {
        // Every rep-4 tile contributes eight unit boundary sections, and the
        // external perimeter has 8*2^n sections. Interior sections appear twice.
        return 4_u64
            .saturating_mul(4_u64.saturating_pow(u32::from(iterations)))
            .saturating_add(4_u64.saturating_mul(2_u64.saturating_pow(u32::from(iterations))));
    }
    let (mut thin, mut thick) = (10_u64, 0_u64);
    // Boundary sections classified by triangle type and local AB/BC/CA side.
    // This ten-triangle disk begins with only each thin triangle's BC outside.
    let [mut tab, mut tbc, mut tca, mut lab, mut lbc, mut lca] = [0, 10_u64, 0, 0, 0, 0];
    for _ in 0..iterations {
        (thin, thick) = (
            thin.saturating_add(thick),
            thin.saturating_add(thick.saturating_mul(2)),
        );
        [tab, tbc, tca, lab, lbc, lca] = [
            0,
            tab.saturating_add(lab),
            tbc,
            lbc,
            tca.saturating_add(lbc).saturating_add(lca),
            tab.saturating_add(lab),
        ];
    }
    let boundary = [tab, tbc, tca, lab, lbc, lca]
        .into_iter()
        .fold(0_u64, u64::saturating_add);
    thin.saturating_add(thick)
        .saturating_mul(3)
        .saturating_add(boundary)
        / 2
}

fn penrose(iterations: u8) -> Result<Vec<Tile>, String> {
    let phi = (1. + 5_f64.sqrt()) / 2.;
    let mut triangles = crate::resources::reserve(10)?;
    for index in 0..10 {
        let first = f64::from(2 * index - 1) * std::f64::consts::PI / 10.;
        let last = f64::from(2 * index + 1) * std::f64::consts::PI / 10.;
        let mut b = Point(first.cos(), first.sin());
        let mut c = Point(last.cos(), last.sin());
        if index % 2 == 0 {
            std::mem::swap(&mut b, &mut c);
        }
        triangles.push(Triangle {
            a: Point(0., 0.),
            b,
            c,
            thin: true,
        });
    }
    for _ in 0..iterations {
        let count = triangles
            .iter()
            .try_fold(0usize, |n, t| n.checked_add(if t.thin { 2 } else { 3 }))
            .ok_or("Penrose subdivision exceeds addressable storage")?;
        crate::resources::check_voices(count.saturating_mul(3))?;
        let mut next = crate::resources::reserve(count)?;
        for Triangle { a, b, c, thin } in triangles {
            if thin {
                let p = a.mix(b, 1. / phi);
                next.push(Triangle {
                    a: c,
                    b: p,
                    c: b,
                    thin: true,
                });
                next.push(Triangle {
                    a: p,
                    b: c,
                    c: a,
                    thin: false,
                });
            } else {
                let q = b.mix(a, 1. / phi);
                let r = b.mix(c, 1. / phi);
                next.push(Triangle {
                    a: r,
                    b: c,
                    c: a,
                    thin: false,
                });
                next.push(Triangle {
                    a: q,
                    b: r,
                    c: b,
                    thin: false,
                });
                next.push(Triangle {
                    a: r,
                    b: q,
                    c: a,
                    thin: true,
                });
            }
        }
        triangles = next;
    }
    Ok(triangles
        .into_iter()
        .map(|t| Tile {
            vertices: vec![t.a, t.b, t.c],
            rule: if t.thin { 'S' } else { 'L' },
        })
        .collect())
}

#[derive(Clone, Copy, Debug)]
struct Affine {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    x: f64,
    y: f64,
}
impl Affine {
    fn identity() -> Self {
        Self {
            a: 1.,
            b: 0.,
            c: 0.,
            d: 1.,
            x: 0.,
            y: 0.,
        }
    }
    fn point(self, p: Point) -> Point {
        Point(
            self.a * p.0 + self.b * p.1 + self.x,
            self.c * p.0 + self.d * p.1 + self.y,
        )
    }
    fn compose(self, next: Self) -> Self {
        let origin = self.point(Point(next.x, next.y));
        Self {
            a: self.a * next.a + self.b * next.c,
            b: self.a * next.b + self.b * next.d,
            c: self.c * next.a + self.d * next.c,
            d: self.c * next.b + self.d * next.d,
            x: origin.0,
            y: origin.1,
        }
    }
}
fn sphinx_maps() -> [Affine; 4] {
    // Exact rep-4 placements in the triangular-lattice basis (e,w),
    // independently derived by covering the parent's 24 elementary triangles.
    [
        (true, 3., 6., 0.),
        (true, 0., 1., 2.),
        (false, 4., 0., 4.),
        (true, 3., 3., 0.),
    ]
    .map(|(mirror, rotation, tx, ty)| {
        let (sin, cos) = (rotation * std::f64::consts::PI / 3.).sin_cos();
        Affine {
            a: cos / 2.,
            b: if mirror { sin / 2. } else { -sin / 2. },
            c: sin / 2.,
            d: if mirror { -cos / 2. } else { cos / 2. },
            x: (tx + ty / 2.) / 2.,
            y: ty * 3_f64.sqrt() / 4.,
        }
    })
}
fn sphinx(iterations: u8) -> Result<Vec<Tile>, String> {
    let base = [
        Point(0., 0.),
        Point(3., 0.),
        Point(2.5, 3_f64.sqrt() / 2.),
        Point(1.5, 3_f64.sqrt() / 2.),
        Point(1., 3_f64.sqrt()),
    ];
    let mut placements = vec![Affine::identity()];
    for _ in 0..iterations {
        let count = placements
            .len()
            .checked_mul(4)
            .ok_or("Sphinx subdivision exceeds addressable storage")?;
        crate::resources::check_voices(count.saturating_mul(8))?;
        let mut next = crate::resources::reserve(count)?;
        for placement in placements {
            for child in sphinx_maps() {
                next.push(placement.compose(child));
            }
        }
        placements = next;
    }
    // Unit-length boundary sections give shared vertices even when one tile's
    // long straight side meets several short sides of its neighbours.
    Ok(placements
        .into_iter()
        .map(|placement| {
            let mut vertices = Vec::with_capacity(8);
            for index in 0..5 {
                let a = base[index];
                let b = base[(index + 1) % 5];
                let count = a.distance(b).round() as usize;
                for step in 0..count {
                    vertices.push(placement.point(a.mix(b, step as f64 / count as f64)));
                }
            }
            Tile {
                vertices,
                rule: if placement.a * placement.d - placement.b * placement.c < 0. {
                    'R'
                } else {
                    'L'
                },
            }
        })
        .collect())
}

#[derive(Clone, Copy)]
struct Edge {
    a: Point,
    b: Point,
    rule: char,
}
fn edges_layout(
    parameters: &Parameters,
    lab: &LabParameters,
    tiles: &[Tile],
) -> Result<Vec<LayoutNode>, String> {
    let count = tiles.iter().map(|t| t.vertices.len()).sum::<usize>();
    crate::resources::check_voices(count)?;
    let mut unique = BTreeMap::new();
    for tile in tiles {
        for index in 0..tile.vertices.len() {
            let a = tile.vertices[index];
            let b = tile.vertices[(index + 1) % tile.vertices.len()];
            let (ka, kb) = (a.key(), b.key());
            let key = if ka < kb { (ka, kb) } else { (kb, ka) };
            unique.entry(key).or_insert(Edge {
                a,
                b,
                rule: tile.rule,
            });
        }
    }
    let edges: Vec<Edge> = unique.into_values().collect();
    let mut adjacent: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
    for (index, edge) in edges.iter().enumerate() {
        adjacent.entry(edge.a.key()).or_default().push(index);
        adjacent.entry(edge.b.key()).or_default().push(index);
    }
    let mut visited = crate::resources::filled(edges.len(), false)?;
    let mut nodes: Vec<LayoutNode> = crate::resources::reserve(edges.len().saturating_add(1))?;
    let mut distance: Vec<f64> = crate::resources::reserve(edges.len().saturating_add(1))?;
    let mut queue = VecDeque::new();
    let start = edges.first().ok_or("Empty tiling")?.a;
    queue.push_back((start, 0usize, 0_f64, 0_f64));
    let (sin, cos) = parameters.angle.to_radians().sin_cos();
    let transform = |p: Point| {
        Point(
            p.0 * (1. + parameters.asymmetry) * cos - p.1 * sin,
            p.0 * (1. + parameters.asymmetry) * sin + p.1 * cos,
        )
    };
    let root = transform(start);
    nodes.push(segment(
        "trunk".into(),
        0,
        0,
        'F',
        Point(root.0 - 0.08, root.1),
        root,
        0.,
        0.,
        0.,
    ));
    distance.push(0.);
    while let Some((vertex, parent, path, prior_heading)) = queue.pop_front() {
        for &index in &adjacent[&vertex.key()] {
            if visited[index] {
                continue;
            }
            visited[index] = true;
            let edge = edges[index];
            let end = if edge.a.key() == vertex.key() {
                edge.b
            } else {
                edge.a
            };
            let a = transform(vertex);
            let b = transform(end);
            let heading = (b.1 - a.1).atan2(b.0 - a.0).to_degrees();
            let id = nodes.len();
            let turn = (heading - prior_heading + 180.).rem_euclid(360.) - 180.;
            let symbol = if edge.rule == 'S' || edge.rule == 'R' {
                1.
            } else {
                -1.
            };
            let pitch = symbol * lab.symbol_ratio.log2() * 12. + heading / 180. * 12.;
            let length = a.distance(b);
            distance.push(path + length);
            nodes.push(segment(
                format!("{}:edge:{index}", lab.kind),
                parent,
                1,
                edge.rule,
                a,
                b,
                turn,
                length,
                pitch,
            ));
            queue.push_back((end, id, path + length, heading));
        }
    }
    if nodes.len() != edges.len() + 1 {
        return Err("Tiling boundaries must form one connected vertex graph".into());
    }
    let longest = distance.iter().copied().fold(0_f64, f64::max).max(1e-9);
    for index in 1..nodes.len() {
        let end = distance[index] / longest;
        let start = (distance[index] - nodes[index].length) / longest;
        let variation = 1. - parameters.mutation * hash_unit(&nodes[index].id) * 0.25;
        nodes[index].time_scale =
            (super::acoustic_path_time(end, lab.iterations, parameters.time_ratio)
                - super::acoustic_path_time(start, lab.iterations, parameters.time_ratio))
            .max(1e-9)
                * variation;
        nodes[index].generation = (end * f64::from(lab.iterations))
            .ceil()
            .clamp(1., f64::from(lab.iterations)) as u8;
    }
    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn area(vertices: &[Point]) -> f64 {
        vertices
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let b = vertices[(i + 1) % vertices.len()];
                a.0 * b.1 - b.0 * a.1
            })
            .sum::<f64>()
            .abs()
            / 2.
    }
    #[test]
    fn exact_sequences_and_parallel_neighbour_rule() {
        assert_eq!(rewritten_word("thue-morse", 3).unwrap(), b"01101001");
        assert_eq!(rewritten_word("fibonacci", 4).unwrap(), b"ABAABABA");
        assert_eq!(rewritten_word("context", 1).unwrap(), b"01010");
        assert_eq!(rewritten_word("context", 2).unwrap(), b"0100010");
    }
    #[test]
    fn lazy_sequence_symbols_and_counts_match_parallel_rewrites() {
        for kind in ["context", "thue-morse", "fibonacci"] {
            for iterations in 0..=10 {
                let word = rewritten_word(kind, iterations).unwrap();
                let lengths = fibonacci_lengths(iterations);
                let (count, second_count) = sequence_counts(kind, iterations);
                assert_eq!(count, word.len() as u64, "{kind} {iterations}");
                assert_eq!(
                    second_count,
                    word.iter().filter(|&&c| c == b'1' || c == b'B').count() as u64,
                    "{kind} {iterations}"
                );
                for (index, &c) in word.iter().enumerate() {
                    assert_eq!(
                        sequence_symbol(kind, iterations, index, &lengths),
                        c,
                        "{kind} {iterations} {index}"
                    );
                }
            }
        }
    }
    #[test]
    fn arithmetic_tiling_counts_match_deduplicated_canonical_edges() {
        for kind in ["penrose", "sphinx"] {
            for iterations in 1..=5 {
                let lab = LabParameters {
                    kind: kind.into(),
                    iterations,
                    ..LabParameters::default()
                };
                let nodes = layout(&Parameters::default(), &lab).unwrap();
                assert_eq!(
                    tiling_edge_count(kind, iterations),
                    nodes.len().saturating_sub(1) as u64,
                    "{kind} {iterations}"
                );
            }
        }
    }
    #[test]
    fn budgets_at_full_demand_preserve_every_unlimited_lab_value_and_order() {
        let p = Parameters {
            mutation: 0.4,
            asymmetry: 0.3,
            pruning_bias: 0.8,
            ..Parameters::default()
        };
        for kind in KINDS {
            let lab = LabParameters {
                kind: kind.into(),
                iterations: 3,
                symbol_ratio: 1.37,
                ..LabParameters::default()
            };
            let original = layout(&p, &lab).unwrap();
            let (prepared, requested, effective) =
                bounded_layout(&p, &lab, original.len().saturating_sub(1)).unwrap();
            assert_eq!(prepared, original, "{kind}");
            assert_eq!(requested, original.len().saturating_sub(1) as u64);
            assert_eq!(effective, lab);
        }
    }
    #[test]
    fn mutation_cutoff_that_fits_budget_retains_exact_full_demand_and_bfs_order() {
        let lab = LabParameters {
            iterations: 8,
            length_ratio: 0.5,
            min_length: 0.2,
            branch_count: 6,
            ..LabParameters::default()
        };
        for pruning_bias in [-1., 1.] {
            let p = Parameters {
                mutation: 1.,
                pruning_bias,
                ..Parameters::default()
            };
            let original = parametric(&p, &lab).unwrap();
            assert!((original.len().saturating_sub(1) as u64) < parametric_demand(&lab));
            let (prepared, requested, _) =
                bounded_layout(&p, &lab, original.len().saturating_sub(1)).unwrap();
            assert_eq!(prepared, original);
            assert_eq!(requested, original.len().saturating_sub(1) as u64);
        }
    }
    #[test]
    fn six_way_budget_keeps_partial_final_frontier_and_original_values() {
        let lab = LabParameters {
            iterations: 24,
            length_ratio: 1.,
            branch_count: 6,
            min_length: 0.001,
            ..LabParameters::default()
        };
        let p = Parameters::default();
        let (prepared, requested, effective) = bounded_layout(&p, &lab, 80).unwrap();
        assert_eq!(prepared.len(), 81);
        assert_eq!(requested, 5_686_057_605_985_940_274);
        assert_eq!(effective, lab);
        let original = parametric(
            &p,
            &LabParameters {
                iterations: 3,
                ..lab
            },
        )
        .unwrap();
        assert_eq!(prepared, original[..81]);
        assert_eq!(prepared.last().unwrap().generation, 3);
        assert_eq!(prepared.last().unwrap().id, "trunk/1/0/1");
    }
    #[test]
    fn bounded_parametric_depth_preference_retains_long_paths_and_module_values() {
        let lab = LabParameters {
            iterations: 6,
            length_ratio: 0.9,
            branch_count: 3,
            min_length: 0.001,
            ..LabParameters::default()
        };
        let p = Parameters {
            pruning_bias: 1.,
            mutation: 0.3,
            ..Parameters::default()
        };
        let original = parametric(&p, &lab).unwrap();
        let (prepared, requested, _) = bounded_layout(&p, &lab, 40).unwrap();
        assert_eq!(prepared.len(), 41);
        assert_eq!(requested, original.len().saturating_sub(1) as u64);
        assert_eq!(prepared.iter().map(|n| n.generation).max(), Some(6));
        for node in prepared.iter().skip(1) {
            let original_node = original.iter().find(|n| n.id == node.id).unwrap();
            assert_eq!(node.x, original_node.x);
            assert_eq!(node.y, original_node.y);
            assert_eq!(node.time_scale, original_node.time_scale);
            assert_eq!(node.module_pitch, original_node.module_pitch);
            assert!(node.parent < prepared.iter().position(|n| n.id == node.id).unwrap());
        }
        let (broad, _, _) = bounded_layout(
            &Parameters {
                pruning_bias: -1.,
                ..p
            },
            &lab,
            40,
        )
        .unwrap();
        assert!(broad.iter().all(|n| n.generation <= 4));
    }
    #[test]
    fn bounded_sequences_preserve_full_word_geometry_and_timing_normalization() {
        let p = Parameters {
            mutation: 0.6,
            asymmetry: -0.4,
            ..Parameters::default()
        };
        for kind in ["context", "thue-morse", "fibonacci"] {
            let lab = LabParameters {
                kind: kind.into(),
                iterations: 9,
                symbol_ratio: 1.37,
                context_strength: 0.73,
                ..LabParameters::default()
            };
            let original = sequence(&p, &lab).unwrap();
            let (prepared, requested, effective) = bounded_layout(&p, &lab, 12).unwrap();
            assert_eq!(prepared.len(), 13);
            assert_eq!(requested, original.len().saturating_sub(1) as u64);
            assert_eq!(effective, lab);
            for (a, b) in prepared.iter().zip(&original) {
                assert_eq!(a.id, b.id);
                assert_eq!(a.parent, b.parent);
                assert_eq!(a.rule, b.rule);
                assert_eq!(a.generation, b.generation);
                assert_eq!(a.x, b.x);
                assert_eq!(a.y, b.y);
                assert_eq!(a.module_pitch, b.module_pitch);
                assert!((a.time_scale - b.time_scale).abs() < 1e-12, "{kind}");
            }
        }
    }
    #[test]
    fn maximum_rule_depth_stays_connected_and_bounded_for_every_lab() {
        for kind in KINDS {
            let lab = LabParameters {
                kind: kind.into(),
                iterations: 24,
                branch_count: 6,
                length_ratio: 1.25,
                min_length: 0.001,
                ..LabParameters::default()
            };
            for budget in [0, 1, 19, 80] {
                let (nodes, requested, effective) =
                    bounded_layout(&Parameters::default(), &lab, budget).unwrap();
                assert!(!nodes.is_empty(), "{kind}");
                assert!(nodes.len() <= budget + 1, "{kind}");
                assert!(requested >= nodes.len().saturating_sub(1) as u64, "{kind}");
                effective.validate().unwrap();
                assert_eq!(nodes[0].id, "trunk");
                for (index, node) in nodes.iter().enumerate().skip(1) {
                    assert!(node.parent < index, "{kind}");
                    let parent = &nodes[node.parent];
                    assert!((node.start_x - parent.x).abs() < 1e-9, "{kind}");
                    assert!((node.start_y - parent.y).abs() < 1e-9, "{kind}");
                    assert!(node.x.is_finite() && node.y.is_finite(), "{kind}");
                    assert!(node.time_scale.is_finite(), "{kind}");
                }
            }
        }
    }
    #[test]
    fn bounded_tilings_choose_largest_complete_covering_that_fits() {
        for kind in ["penrose", "sphinx"] {
            let lab = LabParameters {
                kind: kind.into(),
                iterations: 24,
                ..LabParameters::default()
            };
            let budget = tiling_edge_count(kind, 3) as usize;
            let (nodes, requested, effective) =
                bounded_layout(&Parameters::default(), &lab, budget).unwrap();
            assert_eq!(effective.iterations, 3);
            assert_eq!(requested, tiling_edge_count(kind, 24));
            assert_eq!(nodes.len(), budget + 1);
            assert_eq!(nodes, layout(&Parameters::default(), &effective).unwrap());
        }
    }
    #[test]
    fn parameter_modules_update_values_and_growth_is_conditional() {
        let mut lab = LabParameters {
            iterations: 3,
            length_ratio: 0.5,
            min_length: 0.001,
            delay_ratio: 0.8,
            pitch_ratio: 1.25,
            ..LabParameters::default()
        };
        let p = Parameters {
            time_ratio: 1.,
            angle: 0.,
            ..Parameters::default()
        };
        let nodes = parametric(&p, &lab).unwrap();
        assert_eq!(nodes.len(), 15);
        assert_eq!(nodes[1].length, 0.5);
        assert_eq!(nodes[3].length, 0.25);
        assert!((nodes[3].time_scale - 0.64).abs() < 1e-12);
        assert!((nodes[3].module_pitch.unwrap() - 24. * 1.25_f64.log2()).abs() < 1e-12);
        lab.min_length = 0.2;
        assert_eq!(parametric(&p, &lab).unwrap().len(), 7);
        lab.branch_count = 6;
        lab.iterations = 1;
        assert_eq!(parametric(&p, &lab).unwrap().len(), 7);
    }
    #[test]
    fn penrose_subdivision_preserves_area_and_golden_edge_lengths() {
        let phi = (1. + 5_f64.sqrt()) / 2.;
        let initial_area = penrose(1)
            .unwrap()
            .iter()
            .map(|t| area(&t.vertices))
            .sum::<f64>();
        for iterations in 1..=5 {
            let tiles = penrose(iterations).unwrap();
            assert!(
                (tiles.iter().map(|t| area(&t.vertices)).sum::<f64>() - initial_area).abs() < 1e-10
            );
            assert!(tiles.iter().any(|t| t.rule == 'S') && tiles.iter().any(|t| t.rule == 'L'));
            for tile in &tiles {
                let mut lengths = [
                    tile.vertices[0].distance(tile.vertices[1]),
                    tile.vertices[1].distance(tile.vertices[2]),
                    tile.vertices[2].distance(tile.vertices[0]),
                ];
                lengths.sort_by(f64::total_cmp);
                assert!((lengths[2] / lengths[0] - phi).abs() < 1e-9);
            }
            let lab = LabParameters {
                kind: "penrose".into(),
                iterations,
                ..LabParameters::default()
            };
            let nodes = edges_layout(&Parameters::default(), &lab, &tiles).unwrap();
            assert!(nodes.len() < tiles.len() * 3, "shared edges deduplicated");
        }
    }
    #[test]
    fn sphinx_rep_four_preserves_area_and_has_both_chiralities() {
        let original = 6. * 3_f64.sqrt() / 4.;
        for iterations in 1..=4 {
            let tiles = sphinx(iterations).unwrap();
            assert_eq!(tiles.len(), 4usize.pow(u32::from(iterations)));
            assert!(
                (tiles.iter().map(|t| area(&t.vertices)).sum::<f64>() - original).abs() < 1e-10
            );
            assert!(tiles.iter().any(|t| t.rule == 'R') && tiles.iter().any(|t| t.rule == 'L'));
            let lab = LabParameters {
                kind: "sphinx".into(),
                iterations,
                ..LabParameters::default()
            };
            let nodes = edges_layout(&Parameters::default(), &lab, &tiles).unwrap();
            assert!(nodes.len() < tiles.len() * 8);
        }
    }
    #[test]
    fn sphinx_rep_four_is_a_disjoint_exact_cover_of_parent() {
        fn inside(p: Point, vertices: &[Point]) -> bool {
            let mut result = false;
            for (index, &a) in vertices.iter().enumerate() {
                let b = vertices[(index + 1) % vertices.len()];
                if (a.1 > p.1) != (b.1 > p.1) && p.0 < (b.0 - a.0) * (p.1 - a.1) / (b.1 - a.1) + a.0
                {
                    result = !result;
                }
            }
            result
        }
        let parent = sphinx(0).unwrap();
        let children = sphinx(1).unwrap();
        let mut covered = 0;
        // Centroids of every half-scale elementary lattice triangle in and
        // around the frame establish both coverage and absence of overlaps.
        for x in -2..8 {
            for y in -2..6 {
                for (dx, dy) in [(1. / 3., 1. / 3.), (2. / 3., 2. / 3.)] {
                    let a = (f64::from(x) + dx) / 2.;
                    let b = (f64::from(y) + dy) / 2.;
                    let p = Point(a + b / 2., b * 3_f64.sqrt() / 2.);
                    let expected = usize::from(inside(p, &parent[0].vertices));
                    let actual = children.iter().filter(|t| inside(p, &t.vertices)).count();
                    assert_eq!(actual, expected, "{p:?}");
                    covered += expected;
                }
            }
        }
        assert_eq!(covered, 24);
    }
    #[test]
    fn every_lab_emits_finite_connected_admitted_audio_and_complete_preview() {
        for kind in KINDS {
            let lab = LabParameters {
                kind: kind.into(),
                iterations: 4,
                ..LabParameters::default()
            };
            let p = Parameters {
                interval_ms: 30.,
                generations: 4,
                lab: Some(lab),
                ..Parameters::default()
            };
            let topology = super::super::try_compile(&p, 48_000).unwrap();
            assert!(topology.requested_voices > 0, "{kind}");
            assert_eq!(
                topology.eligible_voices, topology.requested_voices,
                "{kind}"
            );
            assert_eq!(topology.preview.len(), topology.nodes.len() + 1, "{kind}");
            for (node, target) in topology.nodes.iter().zip(&topology.targets) {
                assert!(node.parent < node.id);
                assert!(node.x.is_finite() && node.y.is_finite());
                assert!(target.delay.is_finite() && target.gain > 0. && target.rate.is_finite());
                assert!((0.125..=8.).contains(&target.rate));
                assert_eq!(node.delay, target.delay);
                assert_eq!(node.rate, target.rate);
                let parent = &topology
                    .preview
                    .iter()
                    .find(|n| n.id == node.parent)
                    .unwrap();
                assert!((node.start_x - parent.x).abs() < 1e-9, "{kind} {}", node.id);
                assert!((node.start_y - parent.y).abs() < 1e-9, "{kind} {}", node.id);
            }
        }
    }
    #[test]
    fn symbol_and_context_controls_change_both_geometry_and_audio() {
        for kind in ["context", "thue-morse", "fibonacci", "penrose", "sphinx"] {
            let mut p = Parameters {
                interval_ms: 30.,
                lab: Some(LabParameters {
                    kind: kind.into(),
                    iterations: 3,
                    ..LabParameters::default()
                }),
                ..Parameters::default()
            };
            let original = super::super::try_compile(&p, 48_000).unwrap();
            p.lab.as_mut().unwrap().symbol_ratio = 2.;
            let changed = super::super::try_compile(&p, 48_000).unwrap();
            assert!(
                original
                    .targets
                    .iter()
                    .zip(&changed.targets)
                    .any(|(a, b)| a.rate != b.rate),
                "{kind}"
            );
            if kind != "penrose" && kind != "sphinx" {
                assert!(
                    original
                        .nodes
                        .iter()
                        .zip(&changed.nodes)
                        .any(|(a, b)| a.x != b.x || a.y != b.y),
                    "{kind}"
                );
            }
        }
    }
    #[test]
    fn context_strength_uses_adjacent_modules_and_changes_times_and_shape() {
        let lab = LabParameters {
            kind: "context".into(),
            iterations: 3,
            context_strength: 0.,
            ..LabParameters::default()
        };
        let p = Parameters {
            interval_ms: 30.,
            lab: Some(lab),
            ..Parameters::default()
        };
        let original = super::super::try_compile(&p, 48_000).unwrap();
        let mut p = p;
        p.lab.as_mut().unwrap().context_strength = 1.;
        let changed = super::super::try_compile(&p, 48_000).unwrap();
        assert!(original
            .nodes
            .iter()
            .zip(&changed.nodes)
            .any(|(a, b)| a.x != b.x || a.y != b.y));
        assert!(original
            .targets
            .iter()
            .zip(&changed.targets)
            .any(|(a, b)| a.delay != b.delay));
    }
    #[test]
    fn lab_preview_keeps_more_than_two_thousand_admitted_voices() {
        let p = Parameters {
            interval_ms: 10.,
            lab: Some(LabParameters {
                kind: "thue-morse".into(),
                iterations: 12,
                ..LabParameters::default()
            }),
            ..Parameters::default()
        };
        let topology = super::super::try_compile(&p, 48_000).unwrap();
        assert_eq!(topology.requested_voices, 4095);
        assert_eq!(topology.preview.len(), 4096);
        assert_eq!(topology.eligible_voices, 4095);
    }
    #[test]
    fn conditional_empty_derivation_retains_input_root_and_can_resume() {
        let mut p = Parameters {
            lab: Some(LabParameters {
                min_length: 1.,
                ..LabParameters::default()
            }),
            ..Parameters::default()
        };
        let empty = super::super::try_compile(&p, 48_000).unwrap();
        assert_eq!(empty.requested_voices, 0);
        assert!(empty.targets.is_empty());
        assert_eq!(empty.preview.len(), 1);
        p.lab.as_mut().unwrap().min_length = 0.03;
        assert!(
            super::super::try_compile(&p, 48_000)
                .unwrap()
                .eligible_voices
                > 0
        );
    }
    #[test]
    fn lab_contract_rejects_unknown_nonfinite_and_out_of_range_fields() {
        assert!(
            serde_json::from_str::<LabParameters>(r#"{"kind":"parametric","typo":1}"#).is_err()
        );
        assert!(LabParameters {
            kind: "pretend-tiling".into(),
            ..LabParameters::default()
        }
        .validate()
        .is_err());
        assert!(LabParameters {
            pitch_ratio: f64::NAN,
            ..LabParameters::default()
        }
        .validate()
        .is_err());
        assert!(LabParameters {
            branch_count: 7,
            ..LabParameters::default()
        }
        .validate()
        .is_err());
        assert!(LabParameters {
            iterations: 25,
            ..LabParameters::default()
        }
        .validate()
        .is_err());
    }
}
