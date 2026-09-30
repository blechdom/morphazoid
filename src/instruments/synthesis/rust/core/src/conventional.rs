//! Distinct textbook-scale algorithms. These are teaching instruments, not
//! calibrated emulations of particular materials, speech systems or products.
use crate::spectral::{Spectral, PAD_N};
use crate::SAMPLE_CAPACITY;
use std::f32::consts::{PI, TAU};
const TABLE: usize = 2048;
const DELAY: usize = 32768;
const CORPUS: usize = 48;
const BUILTIN_SAMPLES: usize = 65_536;
#[derive(Clone, Copy)]
struct Grain {
    active: bool,
    position: f32,
    step: f32,
    age: f32,
    duration: f32,
    gain: f32,
}
impl Grain {
    const EMPTY: Self = Self {
        active: false,
        position: 0.0,
        step: 1.0,
        age: 0.0,
        duration: 1.0,
        gain: 0.0,
    };
}
fn noise(seed: &mut u32) -> f32 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    *seed as f32 / u32::MAX as f32 * 2.0 - 1.0
}
fn sine(phase: f32) -> f32 {
    (TAU * phase).sin()
}
fn triangle(phase: f32) -> f32 {
    1.0 - 4.0 * (phase.rem_euclid(1.0) - 0.5).abs()
}
fn saw(phase: f32) -> f32 {
    2.0 * phase.rem_euclid(1.0) - 1.0
}
fn square(phase: f32, width: f32) -> f32 {
    if phase.rem_euclid(1.0) < width {
        1.0
    } else {
        -1.0
    }
}
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
fn at(buffer: &[f32], p: f32) -> f32 {
    let pos = p.rem_euclid(buffer.len() as f32);
    let i = pos as usize;
    lerp(buffer[i], buffer[(i + 1) % buffer.len()], pos - i as f32)
}
fn polyblep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        2.0 * x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + 2.0 * x + 1.0
    } else {
        0.0
    }
}
fn blep_saw(t: f32, dt: f32) -> f32 {
    saw(t) - polyblep(t, dt)
}
fn blep_square(t: f32, dt: f32, pw: f32) -> f32 {
    square(t, pw) + polyblep(t, dt) - polyblep((t - pw).rem_euclid(1.0), dt)
}
fn reflected(x: f32) -> f32 {
    let p = (x + 1.0).rem_euclid(4.0);
    if p <= 2.0 {
        p - 1.0
    } else {
        3.0 - p
    }
}
fn parity(mut x: u32) -> f32 {
    x ^= x >> 16;
    x ^= x >> 8;
    x ^= x >> 4;
    x &= 15;
    if (0x6996u32 >> x) & 1 != 0 {
        -1.0
    } else {
        1.0
    }
}

pub struct Conventional {
    sr: f32,
    method: u32,
    phase: [f32; 16],
    seed: u32,
    age: f32,
    source: Box<[f32]>,
    builtin_source: Box<[f32]>,
    source_is_builtin: bool,
    source_len: usize,
    source_sr: f32,
    sample_position: f32,
    tables: Box<[f32]>,
    delay: Box<[f32]>,
    delay_clock: usize,
    delay_low: f32,
    previous_delay: f32,
    filter_low: f32,
    filter_band: f32,
    smoothed_noise: f32,
    noise_countdown: f32,
    random_target: f32,
    mass: [f32; 32],
    velocity: [f32; 32],
    scan: [f32; 64],
    scan_velocity: [f32; 64],
    scan_clock: usize,
    modes_re: [f32; 16],
    modes_im: [f32; 16],
    grains: [Grain; 128],
    grain_countdown: f32,
    corpus_brightness: [f32; CORPUS],
    corpus_noise: [f32; CORPUS],
    corpus_current: usize,
    stochastic_amp: [f32; 32],
    stochastic_duration: [f32; 32],
    stochastic_index: usize,
    stochastic_progress: f32,
    stochastic_previous: f32,
    feedback: f32,
    dpw_previous: f32,
    dpw_square_previous: f32,
    dpw_valid: bool,
    blep_ring: [f32; 32],
    blep_clock: usize,
    adaa_previous: f32,
    last_prepared: [f32; 16],
    prepared_method: u32,
    aux: [f32; 128],
    clock: usize,
    expanded: crate::expanded::NewMethods,
    spectral: Spectral,
}
impl Conventional {
    pub fn new(sr: f32) -> Self {
        let mut s = Self {
            sr,
            method: 0,
            phase: [0.0; 16],
            seed: 783921,
            age: 0.0,
            source: vec![0.0; SAMPLE_CAPACITY].into_boxed_slice(),
            builtin_source: vec![0.0; BUILTIN_SAMPLES].into_boxed_slice(),
            source_is_builtin: true,
            source_len: BUILTIN_SAMPLES,
            source_sr: sr,
            sample_position: 0.0,
            tables: vec![0.0; TABLE * 4].into_boxed_slice(),
            delay: vec![0.0; DELAY].into_boxed_slice(),
            delay_clock: 0,
            delay_low: 0.0,
            previous_delay: 0.0,
            filter_low: 0.0,
            filter_band: 0.0,
            smoothed_noise: 0.0,
            noise_countdown: 0.0,
            random_target: 0.0,
            mass: [0.0; 32],
            velocity: [0.0; 32],
            scan: [0.0; 64],
            scan_velocity: [0.0; 64],
            scan_clock: 0,
            modes_re: [0.0; 16],
            modes_im: [0.0; 16],
            grains: [Grain::EMPTY; 128],
            grain_countdown: 0.0,
            corpus_brightness: [0.0; CORPUS],
            corpus_noise: [0.0; CORPUS],
            corpus_current: 0,
            stochastic_amp: [0.0; 32],
            stochastic_duration: [1.0; 32],
            stochastic_index: 0,
            stochastic_progress: 0.0,
            stochastic_previous: 0.0,
            feedback: 0.0,
            dpw_previous: 0.0,
            dpw_square_previous: 0.0,
            dpw_valid: false,
            blep_ring: [0.0; 32],
            blep_clock: 0,
            adaa_previous: 0.0,
            last_prepared: [-1.0; 16],
            prepared_method: u32::MAX,
            aux: [0.0; 128],
            clock: 0,
            expanded: crate::expanded::NewMethods::new(sr),
            spectral: Spectral::new(sr),
        };
        s.make_tables();
        s.make_source();
        s.builtin_source
            .copy_from_slice(&s.source[..BUILTIN_SAMPLES]);
        s.analyse_source();
        s.reset();
        s
    }
    fn make_tables(&mut self) {
        // Harmonic-limited source tables; oscillator antialiasing comparisons
        // live in method 37 and intentionally include a naive oscillator.
        for i in 0..TABLE {
            let phase = i as f32 / TABLE as f32;
            self.tables[i] = sine(phase);
            let (mut tri, mut saw_sum, mut sq) = (0.0, 0.0, 0.0);
            for h in 1..=64 {
                let v = sine(phase * h as f32);
                saw_sum -= v / h as f32 * 2.0 / PI;
                if h % 2 == 1 {
                    sq += v / h as f32 * 4.0 / PI;
                    tri += v * if (h - 1) % 4 == 0 { 1.0 } else { -1.0 } / (h * h) as f32 * 8.0
                        / (PI * PI);
                }
            }
            self.tables[TABLE + i] = tri;
            self.tables[TABLE * 2 + i] = saw_sum;
            self.tables[TABLE * 3 + i] = sq;
        }
    }
    fn make_source(&mut self) {
        // An original synthetic corpus: pitched vowel-like clusters, harmonic
        // tones and noisy transients. No recordings or pretrained assets.
        let mut seed = 611209;
        for i in 0..self.source_len {
            let t = i as f32 / self.sr;
            let local = (i as f32 / self.source_len as f32 * CORPUS as f32).fract();
            let slice = (i * CORPUS / self.source_len) as f32;
            let bright = (slice * 0.173).fract();
            let noise_mix = (slice * 0.319).fract().powi(3);
            let formant = 350.0 + 2600.0 * (slice * 0.111).fract();
            let mut tone = 0.0;
            for h in 1..=24 {
                let hz = 220.0 * h as f32;
                let gain = (h as f32).powf(-1.9 + bright * 1.4)
                    * (0.15 + (-((hz - formant) / 550.0).powi(2)).exp());
                tone += (TAU * hz * t + (h * h) as f32 * 0.27).sin() * gain;
            }
            let transient = (-(local * 7.0)).exp();
            self.source[i] = ((tone * (1.0 - noise_mix)
                + noise(&mut seed) * noise_mix * (0.2 + 0.8 * transient))
                * 0.8)
                .tanh();
        }
    }
    fn analyse_source(&mut self) {
        let source = &self.source[..self.source_len];
        self.spectral
            .analyse_lpc(source, &crate::default_parameters(8));
        self.spectral.analyse_vocoder(source, self.source_sr);
        for segment in 0..CORPUS {
            let start = segment * self.source_len / CORPUS;
            let end = ((segment + 1) * self.source_len / CORPUS)
                .max(start + 2)
                .min(self.source_len);
            let mut energy = 1.0e-9;
            let mut difference = 0.0;
            let mut corr = 0.0;
            for i in start + 1..end {
                let x = self.source[i];
                let prev = self.source[i - 1];
                energy += x * x;
                difference += (x - prev) * (x - prev);
                corr += x * prev;
            }
            self.corpus_brightness[segment] = (difference / energy * 2.0).sqrt().min(1.0);
            self.corpus_noise[segment] = (1.0 - (corr / energy).abs()).clamp(0.0, 1.0);
        }
        // Descriptor normalization makes a small self-contained corpus useful.
        let max_b = self
            .corpus_brightness
            .iter()
            .copied()
            .fold(0.001f32, f32::max);
        let max_n = self.corpus_noise.iter().copied().fold(0.001f32, f32::max);
        for i in 0..CORPUS {
            self.corpus_brightness[i] /= max_b;
            self.corpus_noise[i] /= max_n;
        }
    }
    pub fn load_sample(&mut self, source: &[f32], source_sr: f32) {
        if source.len() < 16 {
            return;
        }
        self.source_is_builtin = false;
        self.source_len = source.len().min(SAMPLE_CAPACITY);
        self.source_sr = source_sr;
        for (target, input) in self.source[..self.source_len].iter_mut().zip(source) {
            *target = if input.is_finite() {
                input.clamp(-1.0, 1.0)
            } else {
                0.0
            };
        }
        self.analyse_source();
        self.sample_position = 0.0;
        self.prepared_method = u32::MAX;
    }
    pub fn restore_source(&mut self) {
        if self.source_is_builtin {
            return;
        }
        self.source[..BUILTIN_SAMPLES].copy_from_slice(&self.builtin_source);
        self.source_len = BUILTIN_SAMPLES;
        self.source_sr = self.sr;
        self.source_is_builtin = true;
        // Reuse cached audio: no oscillator generation or allocation here.
        // Refresh descriptors and analysis because later method changes can use
        // any of the sample, LPC, vocoder or corpus views of this source.
        self.analyse_source();
        self.sample_position = 0.0;
        self.prepared_method = u32::MAX;
    }
    pub fn set_method(&mut self, method: u32) {
        self.method = method;
        self.reset();
        self.prepared_method = u32::MAX;
    }
    pub fn prepare(&mut self, method: u32, p: &[f32; 16], _frequency: f32) {
        if self.prepared_method == method && self.last_prepared == *p {
            return;
        }
        if method == 31 {
            self.spectral.make_pad(p);
        }
        if method == 8 {
            self.spectral
                .analyse_lpc(&self.source[..self.source_len], p);
        }
        self.last_prepared = *p;
        self.prepared_method = method;
    }
    pub fn reset(&mut self) {
        self.aux.fill(0.0);
        self.clock = 0;
        self.expanded.reset();
        self.phase.fill(0.0);
        self.seed = 783921;
        self.age = 0.0;
        self.sample_position = 0.0;
        self.delay.fill(0.0);
        self.delay_clock = 0;
        self.delay_low = 0.0;
        self.previous_delay = 0.0;
        self.filter_low = 0.0;
        self.filter_band = 0.0;
        self.smoothed_noise = 0.0;
        self.noise_countdown = 0.0;
        self.random_target = 0.0;
        self.mass.fill(0.0);
        self.velocity.fill(0.0);
        self.scan.fill(0.0);
        self.scan_velocity.fill(0.0);
        self.scan_clock = 0;
        self.modes_re.fill(0.0);
        self.modes_im.fill(0.0);
        self.grains.fill(Grain::EMPTY);
        self.grain_countdown = 0.0;
        self.corpus_current = 0;
        self.stochastic_index = 0;
        self.stochastic_progress = 0.0;
        self.stochastic_previous = 0.0;
        for i in 0..32 {
            self.stochastic_amp[i] = sine(i as f32 / 32.0);
            self.stochastic_duration[i] = 1.0;
        }
        self.feedback = 0.0;
        self.dpw_previous = 0.0;
        self.dpw_square_previous = 0.0;
        self.dpw_valid = false;
        self.blep_ring.fill(0.0);
        self.blep_clock = 0;
        self.adaa_previous = 0.0;
        self.spectral.reset();
    }
    pub fn note_on(&mut self, frequency: f32, velocity: f32, p: &[f32; 16]) {
        self.age = 0.0;
        self.grain_countdown = 0.0;
        if self.method == 0 {
            self.sample_position = (p[0]
                + if p[4] > 0.0 {
                    noise(&mut self.seed) * p[4]
                } else {
                    0.0
                })
                * self.source_len as f32;
        }
        if self.method == 25 || self.method == 26 {
            let slot = if self.method == 25 { 7 } else { 8 };
            self.seed = 783921u32
                .wrapping_add((p[slot] * 4_000_000_000.0) as u32)
                .max(1);
        }
        if self.method == 16 {
            let count = 8 + (p[9] * 24.0).round() as usize;
            for i in 0..count {
                let x = i as f32 / (count - 1) as f32;
                self.velocity[i] +=
                    velocity * 0.06 * (-((x - p[2]) / (0.01 + 0.39 * p[8])).powi(2)).exp();
            }
        }
        if self.method == 29 {
            for i in 0..64 {
                let x = i as f32 / 64.0;
                self.scan[i] += velocity * (sine(x) + p[2] * sine(3.0 * x) * 0.5) * (PI * x).sin();
            }
        }
        if self.method == 17 {
            for i in 0..16 {
                let h = (i + 1) as f32;
                let positional = (PI * h * (0.03 + 0.94 * p[2])).sin() / (1.0 + i as f32 * 0.3);
                let excitation = lerp(positional, positional * h.sqrt(), p[8]);
                let excitation = lerp(excitation, noise(&mut self.seed), p[9]);
                self.modes_re[i] += velocity * excitation;
            }
        }
        if self.method == 18 || self.method == 19 {
            let period = (self.sr / frequency).clamp(4.0, (DELAY - 2) as f32) as usize;
            let mut low = 0.0;
            let length = if self.method == 19 {
                0.1 + 0.9 * p[6]
            } else {
                1.0
            };
            let mix = if self.method == 19 { p[7] } else { 0.65 };
            for i in 0..period {
                let n = noise(&mut self.seed);
                low += (n - low) * (0.02 + 0.98 * p[3]);
                let position = i as f32 / period as f32;
                let pick = 0.02 + 0.96 * p[2];
                let triangle = if position < pick {
                    position / pick
                } else {
                    (1.0 - position) / (1.0 - pick)
                };
                self.delay[(self.delay_clock + DELAY - period + i) % DELAY] = if position <= length
                {
                    velocity * lerp(triangle * 2.0 - 1.0, low, mix)
                } else {
                    0.0
                };
            }
        }
        if self.method >= 39 {
            self.expanded.note_on(self.method, frequency, velocity, p);
        }
    }
    fn table(&self, wave: usize, phase: f32, interpolation: f32) -> f32 {
        let pos = phase.rem_euclid(1.0) * TABLE as f32;
        let i = pos as usize;
        let a = self.tables[wave * TABLE + i];
        let b = self.tables[wave * TABLE + (i + 1) % TABLE];
        lerp(a, b, (pos - i as f32) * interpolation)
    }
    fn shaped(&self, phase: f32, shape: f32) -> f32 {
        let x = shape.clamp(0.0, 1.0) * 3.0;
        let a = (x as usize).min(3);
        let b = (a + 1).min(3);
        lerp(
            self.table(a, phase, 1.0),
            self.table(b, phase, 1.0),
            x - a as f32,
        )
    }
    fn random_distribution(&mut self, shape: f32) -> f32 {
        match (shape * 2.0).round() as u32 {
            1 => (0..6).map(|_| noise(&mut self.seed)).sum::<f32>() * 0.4082483,
            2 => noise(&mut self.seed).signum(),
            _ => noise(&mut self.seed),
        }
    }
    fn add_grain(&mut self, position: f32, step: f32, duration: f32, gain: f32) {
        if let Some(grain) = self.grains.iter_mut().find(|grain| !grain.active) {
            *grain = Grain {
                active: true,
                position,
                step,
                age: 0.0,
                duration: duration.max(2.0),
                gain,
            };
        }
    }
    fn sampled_grains(&mut self, shape: f32) -> f32 {
        let source = &self.source[..self.source_len];
        let mut out = 0.0;
        for grain in &mut self.grains {
            if !grain.active {
                continue;
            }
            let t = grain.age / grain.duration;
            let window = match (shape * 2.0).round() as u32 {
                1 => 1.0 - (t * 2.0 - 1.0).abs(),
                2 => 0.42 - 0.5 * (TAU * t).cos() + 0.08 * (2.0 * TAU * t).cos(),
                _ => 0.5 - 0.5 * (TAU * t).cos(),
            };
            out += at(source, grain.position) * window * grain.gain;
            grain.position += grain.step;
            grain.age += 1.0;
            if grain.age >= grain.duration {
                grain.active = false;
            }
        }
        out
    }
    fn svf(&mut self, input: f32, cutoff: f32, resonance: f32) -> f32 {
        // Topology-preserving state-variable lowpass, stable at high cutoff/Q.
        let g = (PI * cutoff.min(self.sr * 0.44) / self.sr).tan();
        let k = 2.0 - resonance * 1.9;
        let a = 1.0 / (1.0 + g * (g + k));
        let v1 = a * (self.filter_band + g * (input - self.filter_low));
        let v2 = self.filter_low + g * v1;
        self.filter_band = 2.0 * v1 - self.filter_band;
        self.filter_low = 2.0 * v2 - self.filter_low;
        self.aux[100] = v2;
        self.aux[101] = v1;
        self.aux[102] = input - k * v1 - v2;
        v2
    }
    fn minblep_event(&mut self, jump: f32, fraction: f32) {
        for n in 0..16 {
            let x = ((n as f32 + fraction) * 32.0).min(511.0);
            let i = x as usize;
            let correction = lerp(
                self.spectral.minblep[i],
                self.spectral.minblep[(i + 1).min(511)],
                x - i as f32,
            );
            self.blep_ring[(self.blep_clock + n) % 32] += jump * correction;
        }
    }
    fn antialias_sample(&mut self, t: f32, dt: f32, p: &[f32; 16]) -> f32 {
        let algorithm = (p[0] * 3.0).round() as u32;
        let pw = 0.05 + 0.9 * p[1];
        let raw_saw = saw(t);
        let raw_square = square(t, pw);
        let value = match algorithm {
            0 => lerp(raw_saw, raw_square, p[2]),
            1 => lerp(blep_saw(t, dt), blep_square(t, dt, pw), p[2]),
            2 => {
                let polynomial = raw_saw * raw_saw;
                let shifted = saw((t - pw).rem_euclid(1.0));
                let poly_shift = shifted * shifted;
                let a = if self.dpw_valid {
                    (polynomial - self.dpw_previous) / (4.0 * dt)
                } else {
                    raw_saw
                };
                let b = if self.dpw_valid {
                    (poly_shift - self.dpw_square_previous) / (4.0 * dt)
                } else {
                    shifted
                };
                self.dpw_previous = polynomial;
                self.dpw_square_previous = poly_shift;
                self.dpw_valid = true;
                lerp(a, b - a + (2.0 * pw - 1.0), p[2])
            }
            _ => {
                // Correct the discontinuity at the beginning of this sample.
                if t < dt {
                    self.minblep_event(-2.0 * (1.0 - p[2]) + 2.0 * p[2], t / dt);
                }
                let edge = (t - pw).rem_euclid(1.0);
                if edge < dt {
                    self.minblep_event(-2.0 * p[2], edge / dt);
                }
                let residual = self.blep_ring[self.blep_clock];
                self.blep_ring[self.blep_clock] = 0.0;
                self.blep_clock = (self.blep_clock + 1) % 32;
                lerp(raw_saw, raw_square, p[2]) + residual
            }
        };
        if p[3] < 0.001 {
            value
        } else {
            (value * (1.0 + 3.0 * p[3])).tanh()
        }
    }
    pub fn sample(
        &mut self,
        method: u32,
        frequency: f32,
        p: &[f32; 16],
        gate: bool,
        envelope: f32,
    ) -> f32 {
        let dt = (frequency / self.sr).min(0.24);
        let t = self.phase[0];
        let previous = t;
        self.phase[0] = (t + dt).fract();
        let wrapped = self.phase[0] < previous;
        self.age += 1.0 / self.sr;
        self.clock = self.clock.wrapping_add(1);
        match method {
            0 => {
                let length = (0.03 + 0.97 * p[1]) * self.source_len as f32;
                let start = p[0] * (self.source_len as f32 - length);
                let pos = (self.sample_position - start).rem_euclid(length);
                let direction = if p[3] >= 0.5 { -1.0 } else { 1.0 };
                let drift = 1.0 + sine(self.age * 0.71) * p[2] * 0.02;
                self.sample_position = start
                    + pos
                    + direction * frequency / 220.0 * self.source_sr / self.sr
                        * drift
                        * 2.0f32.powf((p[6] * 200.0 - 100.0) / 1200.0);
                let source = &self.source[..self.source_len];
                let nearest = source[((start + pos) as usize) % self.source_len];
                let value = lerp(nearest, at(source, start + pos), p[7]);
                let fade = if p[5] < 0.00001 {
                    1.0
                } else {
                    (pos.min(length - pos) / (p[5] * 256.0)).clamp(0.0, 1.0)
                };
                value * fade
            }
            1 => {
                let pw = 0.05 + 0.9 * p[2];
                let shifted = (t + p[5]).fract();
                let phase = if shifted < pw {
                    shifted / pw * 0.5
                } else {
                    0.5 + (shifted - pw) / (1.0 - pw) * 0.5
                };
                let resolution = 16.0 * 128.0f32.powf(p[4]);
                let location = p[0] * 3.0;
                let a = (location as usize).min(3);
                let b = (a + 1).min(3);
                let resolution = resolution.round();
                let quantized = if p[4] >= 0.99999 {
                    phase
                } else {
                    (phase * resolution).floor() / resolution
                };
                let wave = lerp(
                    self.table(a, quantized, p[3]),
                    self.table(b, quantized, p[3]),
                    location - a as f32,
                );
                self.phase[1] = (self.phase[1] + dt * 2.0f32.powf(7.0 / 1200.0)).fract();
                let unison = self.shaped(self.phase[1], p[0]);
                let mixed = lerp(wave, (wave + unison) * 0.5, p[7]);
                self.svf(
                    lerp(mixed, reflected(mixed * (1.0 + p[6] * 8.0)), p[6]),
                    180.0 * 80.0f32.powf(p[1]),
                    0.0,
                )
            }
            2 => {
                let mut sum = 0.0;
                let mut gain = 0.0;
                for i in 0..8 {
                    let h = (i + 1) as f32;
                    let ratio = (h.powf(1.0 + p[8] * 0.8) + p[13] * 2.0 - 1.0).max(0.0);
                    let detune = 2.0f32.powf((i as f32 * 2.39996).sin() * p[11] * 60.0 / 1200.0);
                    let hz = frequency * ratio * detune;
                    let phase = self.phase[i + 2];
                    self.phase[i + 2] = (phase + hz / self.sr).fract();
                    if hz >= self.sr * 0.46 {
                        continue;
                    }
                    let odd = if i % 2 == 0 {
                        p[10] * 2.0
                    } else {
                        2.0 - p[10] * 2.0
                    };
                    let tilt = 2.0f32.powf((p[9] * 48.0 - 24.0) * h.log2() / 6.0206);
                    let motion =
                        1.0 + sine(self.age * (0.1 + p[15] * 11.9) + h * 0.17) * p[14] * 0.7;
                    let amp = p[i] * odd * tilt * motion;
                    sum += sine(phase + p[12] * i as f32 / 8.0) * amp;
                    gain += amp;
                }
                sum / gain.max(1.0) * 1.5
            }
            3 => {
                let motion = (sine(self.age * (0.1 + 9.9 * p[7])) * p[6] * 8.0).round() as i32;
                let order = (1 + (p[0] * 15.0).round() as i32 + motion).clamp(1, 32) as u32;
                let seq = 1 + (p[2] * 7.0).round() as u32;
                let index = (((t + p[4]).fract()) * 1024.0) as u32;
                let walsh = |n: u32| {
                    let gray = n ^ (n >> 1);
                    parity(index & (gray.reverse_bits() >> 22))
                };
                let a = walsh(order * seq);
                let b = walsh((order + 1 + (p[5] * 15.0).round() as u32) * seq);
                let input = lerp(a, b, p[1]);
                self.filter_low += (input - self.filter_low) * (1.0 - p[3] * 0.98);
                self.filter_low
            }
            4 => {
                let detune = 2.0f32.powf(p[2] * 40.0 / 1200.0);
                self.phase[1] = (self.phase[1] + dt * detune).fract();
                self.phase[2] = (self.phase[2] + dt / detune).fract();
                let orbit = self.age * (0.02 + 9.98 * p[5]);
                let x = (p[0] + sine(self.age * 0.13) * p[3] * 0.16 + sine(orbit) * p[4] * 0.5)
                    .clamp(0.0, 1.0);
                let y =
                    (p[1] + sine(self.age * 0.19) * p[3] * 0.16 + sine(orbit + 0.25) * p[4] * 0.5)
                        .clamp(0.0, 1.0);
                lerp(
                    lerp(self.shaped(t, p[6]), self.shaped(self.phase[1], p[7]), x),
                    lerp(self.shaped(self.phase[2], p[8]), self.shaped(t, p[9]), x),
                    y,
                )
            }
            5 => {
                self.phase[1] = (self.phase[1] + dt * (0.25 + 3.75 * p[2])).fract();
                let x = sine(t) * (0.05 + 0.95 * p[0]) + p[5] * 2.0 - 1.0;
                let y = sine(self.phase[1]) * (0.05 + 0.95 * p[1]) + p[6] * 2.0 - 1.0;
                let (si, co) = (p[7] * TAU).sin_cos();
                let (x, y) = (x * co - y * si, x * si + y * co);
                let ripples = 1.0 + 11.0 * p[4];
                ((PI * x * (1.0 + p[3] * 5.0) * ripples).sin() * (PI * y * ripples).cos()
                    + ((x * x - y * y) * PI * (1.0 + 3.0 * p[3])).sin() * 0.5)
                    / 1.5
            }
            6 => {
                self.grain_countdown -= 1.0;
                let duration = (0.001 + 0.499 * p[0]) * self.sr;
                let density = 1.0 + 199.0 * p[1];
                if self.grain_countdown <= 0.0 {
                    let spread = noise(&mut self.seed) * p[3] * 24.0;
                    let position = (self.sample_position
                        + p[4] * self.source_len as f32
                        + noise(&mut self.seed) * p[2] * self.source_len as f32 * 0.5)
                        .rem_euclid(self.source_len as f32);
                    let reverse = if p[6] > 0.0 && (noise(&mut self.seed) + 1.0) * 0.5 < p[6] {
                        -1.0
                    } else {
                        1.0
                    };
                    let step = frequency / 220.0 * self.source_sr / self.sr
                        * 2.0f32.powf(spread / 12.0)
                        * reverse;
                    let gain = 1.5 / (density * duration / self.sr).sqrt().max(1.0);
                    self.add_grain(position, step, duration, gain);
                    self.grain_countdown += self.sr / density;
                }
                self.sample_position = (self.sample_position
                    + self.source_sr / self.sr * (p[5] * 4.0 - 2.0))
                    .rem_euclid(self.source_len as f32);
                self.sampled_grains(p[7])
            }
            7 => {
                let oscillator = if p[2] < 0.5 {
                    lerp(sine(t), blep_saw(t, dt), p[2] * 2.0)
                } else {
                    lerp(
                        blep_saw(t, dt),
                        blep_square(t, dt, 0.02 + 0.96 * p[7]),
                        p[2] * 2.0 - 1.0,
                    )
                };
                let mut input = lerp(oscillator, noise(&mut self.seed), p[3]);
                if p[6] > 0.00001 {
                    input = (input * (1.0 + 11.0 * p[6])).tanh();
                }
                self.svf(
                    input,
                    20.0 * 1000.0f32.powf(p[0]) * 2.0f32.powf((p[5] * 16.0 - 8.0) * envelope),
                    p[1],
                );
                let out = match (p[4] * 3.0).round() as u32 {
                    1 => self.aux[101],
                    2 => self.aux[102],
                    3 => self.aux[100] + self.aux[102],
                    _ => self.aux[100],
                };
                out * 0.8
            }
            8 => {
                let pulse = if wrapped {
                    1.0 / (dt.sqrt().max(0.03))
                } else {
                    0.0
                };
                let excitation = lerp(pulse, blep_saw(t, dt), p[3]) * (1.0 - p[1])
                    + noise(&mut self.seed) * p[1];
                self.spectral.lpc_sample(excitation)
            }
            9 | 10 => {
                let ratio = 0.0625 + 31.9375 * p[0];
                let offset = if method == 9 { p[7] * 48.0 - 24.0 } else { 0.0 };
                self.phase[1] =
                    (self.phase[1] + (frequency * ratio + offset) / self.sr).rem_euclid(1.0);
                let mp = (self.phase[1] + p[5]).fract();
                let modulator = lerp(sine(mp), square(mp, 0.5), p[2]);
                if method == 9 {
                    let carrier = self.shaped(t * (1.0 + (p[6] * 7.0).round()), p[4]);
                    carrier * (1.0 - p[1] + p[1] * (modulator + p[3])) / (1.0 + p[1] * p[3])
                } else {
                    let ct = self.phase[2];
                    let cdt = (dt * 2.0f32.powf((p[4] * 48.0 - 24.0) / 12.0)).min(0.45);
                    self.phase[2] = (ct + cdt).fract();
                    let carrier = lerp(sine(ct), blep_saw(ct, cdt), p[1]);
                    let value = carrier * (modulator + p[3]) / (1.0 + p[3]);
                    let value = lerp(value, value.abs() * 2.0 - 0.5, p[6]);
                    if p[7] > 0.00001 {
                        (value * (1.0 + 7.0 * p[7])).tanh()
                    } else {
                        value
                    }
                }
            }
            11 => {
                let ratio = 0.0625 + 31.9375 * p[0];
                self.phase[1] = (self.phase[1] + dt * ratio).fract();
                self.phase[3] = (self.phase[3] + dt * (0.1 + 11.9 * p[4])).fract();
                let second = sine(self.phase[3]) * p[5] * 8.0;
                let delay = 1 + (p[7] * 63.0).round() as usize;
                let feedback = self.aux[(self.clock + 64 - delay) % 64];
                let modulation =
                    (TAU * self.phase[1] + feedback * p[2] * 3.0 + second * p[6]).sin();
                self.aux[self.clock % 64] = modulation;
                let index = p[1] * 32.0 * (1.0 - p[3] + p[3] * (-self.age * 5.0).exp());
                self.phase[2] = (self.phase[2]
                    + dt * (1.0 + (modulation * ratio * index) + second * (1.0 - p[6])))
                    .rem_euclid(1.0);
                sine(self.phase[2])
            }
            12 => {
                self.phase[1] = (self.phase[1] + dt * (0.0625 + 31.9375 * p[0])).fract();
                self.phase[3] = (self.phase[3] + dt * (0.1 + 11.9 * p[4])).fract();
                let second = sine(self.phase[3]) * p[5] * 8.0;
                let modphase = self.phase[1] + second * p[6] / TAU;
                let modulator = lerp(sine(modphase), triangle(modphase), p[3]);
                let delay = 1 + (p[7] * 63.0).round() as usize;
                let feedback = self.aux[(self.clock + 64 - delay) % 64];
                let out = (TAU * t
                    + p[1] * 32.0 * (modulator + feedback * p[2] * 0.8)
                    + second * (1.0 - p[6]))
                    .sin();
                self.aux[self.clock % 64] = out;
                out
            }
            13 => {
                let t = (t + p[4]).fract();
                let point = 0.02 + 0.96 * p[0];
                let warp = |x: f32, k: f32| {
                    if x < k {
                        0.5 * x / k
                    } else {
                        0.5 + 0.5 * (x - k) / (1.0 - k)
                    }
                };
                let phase = lerp(t, warp(t, point), p[1]);
                let phase = lerp(phase, warp(phase, 0.02 + 0.96 * p[5]), p[6]);
                let resonance = 1.0 + 7.0 * p[2];
                let window = lerp(1.0, (PI * t).sin().powi(2), p[3]) * (-t * p[7] * 8.0).exp();
                (TAU * phase * resonance).cos() * window
            }
            14 => {
                let source = self.shaped(t, p[4]);
                let x = source * (1.0 + 11.0 * p[0]) + (p[2] * 2.0 - 1.0);
                let folded = reflected(x * (1.0 + 7.0 * p[6]));
                let shaped = lerp(x.sin(), x.tanh(), p[3]);
                let value = lerp(source, lerp(shaped, folded, p[1]), p[5]);
                if p[7] < 0.9999 {
                    let q = 2.0f32.powf(3.0 + (p[7] * 20.0).round());
                    (value * q).round() / q
                } else {
                    value
                }
            }
            15 => {
                // Closed finite geometric series of complex sinusoids; O(1)
                // per sample even for 2048 potential partials.
                let ratio =
                    (0.03125 + 15.96875 * p[0]) * 2.0f32.powf((p[7] * 100.0 - 50.0) / 1200.0);
                let carrier_ratio = (1.0 + p[4] * 4.0 - 2.0).max(0.01);
                let roll = p[1] * 0.98;
                self.phase[1] = (self.phase[1] + dt * ratio).fract();
                let carrier_phase = self.phase[2];
                self.phase[2] = (self.phase[2] + dt * carrier_ratio).fract();
                let audible =
                    ((self.sr * 0.46 / frequency - carrier_ratio) / ratio + 1.0).max(1.0) as usize;
                let count = ((1 + (p[2] * 255.0 + 0.00001).floor() as usize)
                    * (1 + (p[8] * 7.0).round() as usize))
                    .min(audible);
                let spacing = TAU * (self.phase[1] + p[5]) + p[6] * PI;
                let carrier = TAU * carrier_phase;
                let finite = |step: f32, radius: f32, n: usize| {
                    let rn = radius.powi(n as i32);
                    let nr = 1.0 - rn * (step * n as f32).cos();
                    let ni = -rn * (step * n as f32).sin();
                    let dr = 1.0 - radius * step.cos();
                    let di = -radius * step.sin();
                    let den = (dr * dr + di * di).max(1e-7);
                    (nr * dr + ni * di) / den * carrier.sin()
                        + (ni * dr - nr * di) / den * carrier.cos()
                };
                let all = finite(spacing, roll, count);
                let odd = finite(spacing * 2.0, roll * roll, (count + 1) / 2);
                let norm = lerp(
                    (1.0 - roll.powi(count as i32)) / (1.0 - roll),
                    (1.0 - (roll * roll).powi(((count + 1) / 2) as i32)) / (1.0 - roll * roll),
                    p[3],
                );
                lerp(all, odd, p[3]) / norm.max(1.0) * 1.5
            }
            16 => {
                // Symplectic finite differences, two substeps; cubic spring
                // stiffness is bounded to keep the explicit update stable.
                let count = 8 + (p[9] * 24.0).round() as usize;
                let stiffness =
                    (TAU * frequency / (self.sr * 2.0 * (PI / (count + 1) as f32).sin())).powi(2)
                        * (0.3 + 1.7 * p[0])
                        * 2.0f32.powf((p[5] * 4.0 - 2.0) * envelope * 2.0);
                let k = stiffness.min(3.2) / (1.0 + 2.0 * p[4]);
                let damping = 0.99998 - p[1] * 0.006;
                for _ in 0..2 {
                    for i in 0..count {
                        let x = self.mass[i];
                        let left = if i == 0 { x * p[7] } else { self.mass[i - 1] };
                        let right = if i == count - 1 {
                            x * p[7]
                        } else {
                            self.mass[i + 1]
                        };
                        let dl = left - x;
                        let dr = right - x;
                        let force = dl
                            + dr
                            + 2.0 * p[4] * (dl.powi(3) + dr.powi(3)) / (1.0 + dl * dl + dr * dr);
                        self.velocity[i] = (self.velocity[i]
                            + force * k * 0.5 / (1.0 + p[3] * i as f32 / 8.0))
                            * damping;
                    }
                    for i in 0..count {
                        self.mass[i] = (self.mass[i] + self.velocity[i] * 0.5).clamp(-8.0, 8.0);
                    }
                }
                let pickup = p[6] * (count - 1) as f32;
                let i = pickup.floor() as usize;
                let out = lerp(
                    self.mass[i],
                    self.mass[(i + 1).min(count - 1)],
                    pickup.fract(),
                );
                let second = (count - 1) - i;
                (out + self.mass[second] * 0.4) * 0.8
            }
            17 => {
                let mut out = 0.0;
                let count = 1 + (p[4] * 15.0).round() as usize;
                for i in 0..count {
                    let h = (i + 1) as f32;
                    let ratio = h
                        * (1.0 + p[0] * h * h * 0.045).sqrt()
                        * 2.0f32.powf((h * 2.39996).sin() * p[5] * 50.0 / 1200.0);
                    let hz = frequency * ratio;
                    if hz > self.sr * 0.46 {
                        continue;
                    }
                    let decay = (0.01 + 29.99 * p[1])
                        / (1.0 + i as f32 * (0.18 + 0.5 * (1.0 - p[3])))
                        * h.powf(p[6] * 4.0 - 2.0);
                    let radius = (-6.9078 / (decay.max(0.001) * self.sr)).exp();
                    let (si, co) = (TAU * hz / self.sr).sin_cos();
                    let r = self.modes_re[i];
                    let im = self.modes_im[i];
                    self.modes_re[i] = (r * co - im * si) * radius;
                    self.modes_im[i] = (r * si + im * co) * radius;
                    out += self.modes_re[i] * h.powf(-1.7 + 1.3 * p[3] + p[7] * 4.0 - 2.0);
                }
                out * 0.6
            }
            18 | 19 => {
                let period = if method == 18 {
                    self.sr / (2.0 * frequency)
                } else {
                    self.sr / frequency
                };
                let length = (period - 0.5).clamp(3.0, (DELAY - 4) as f32);
                let read = (self.delay_clock as f32 - length).rem_euclid(DELAY as f32);
                let incoming = at(&self.delay, read);
                let next;
                if method == 19 {
                    self.delay_low = lerp(incoming, self.delay_low, p[0] * 0.95);
                    let loss = (-6.9078 / ((0.01 + 29.99 * p[1]) * frequency)).exp();
                    let a = p[4] * 0.8;
                    let allpass = -a * self.delay_low + self.aux[0];
                    self.aux[0] = self.delay_low + a * allpass;
                    let dispersed = if p[4] > 0.000001 {
                        allpass
                    } else {
                        self.delay_low
                    };
                    let burst = if self.age < p[8] * 0.02 {
                        noise(&mut self.seed) * (1.0 - self.age / (p[8] * 0.02)) * 0.08
                    } else {
                        0.0
                    };
                    next = dispersed * loss * (1.0 - 2.0 * p[5]) + burst;
                } else {
                    let pressure = if gate {
                        (0.08 + 1.04 * p[0])
                            * envelope
                            * (1.0 + sine(self.age * (0.1 + p[7] * 11.9)) * p[6] * 0.1)
                            + noise(&mut self.seed) * p[8] * 0.3 * envelope
                    } else {
                        0.0
                    };
                    self.delay_low = lerp(incoming, self.delay_low, 0.02 + p[2] * 0.75);
                    let reflection = -self.delay_low * (0.999 - p[2] * 0.025);
                    let difference = reflection - pressure;
                    let reed =
                        (0.1 + 1.1 * p[4] - (0.12 + 0.88 * p[1]) * difference).clamp(-1.0, 1.0);
                    let reed = lerp(-1.0 + p[9], 1.0, (reed + 1.0) * 0.5);
                    let reed = reed.signum() * reed.abs().powf(0.5 + 1.5 * p[5]);
                    let wave = pressure + difference * reed;
                    next = lerp(wave, self.previous_delay, p[3] * 0.3).clamp(-2.0, 2.0);
                    self.previous_delay = wave;
                }
                self.delay[self.delay_clock] = next;
                self.delay_clock = (self.delay_clock + 1) % DELAY;
                incoming
            }
            20 => {
                if wrapped || self.age <= 1.1 / self.sr {
                    let bandwidth = 30.0 + 570.0 * p[1];
                    let jitter = if p[7] > 0.0 {
                        1.0 + noise(&mut self.seed) * p[7] * 0.4
                    } else {
                        1.0
                    };
                    self.add_grain(
                        0.0,
                        jitter,
                        (3.0 + 5.0 * p[2]) * self.sr / (PI * bandwidth),
                        1.0,
                    );
                }
                let formant = 80.0 + 11920.0 * p[0];
                let bandwidth = 30.0 + 570.0 * p[1];
                let mut out = 0.0;
                for grain in &mut self.grains {
                    if !grain.active {
                        continue;
                    }
                    let time = grain.age / self.sr;
                    let attack = (time / ((0.1 + 9.9 * p[4]) * 0.001)).clamp(0.0, 1.0);
                    let window = attack * (-PI * bandwidth * time).exp();
                    let phase = formant * time * grain.step + p[6];
                    out += window
                        * (sine(phase)
                            + p[3]
                                * 0.5
                                * sine(formant * (1.0 + 3.0 * p[5]) * time * grain.step + p[6]));
                    grain.age += 1.0;
                    if grain.age >= grain.duration {
                        grain.active = false;
                    }
                }
                out
            }
            21 => {
                if wrapped {
                    self.random_target = noise(&mut self.seed);
                }
                let formant = (80.0 + 11920.0 * p[0])
                    * (1.0 + self.random_target * p[7] * 0.4)
                    * 2.0f32.powf((p[6] * 48.0 - 24.0) * t / 12.0);
                let pulses = 1.0 + (p[1] * 31.0 + 0.00001).floor();
                let cycles = t / frequency * formant;
                let active = (1.0 - p[3] * 0.95).min(pulses * frequency / formant);
                if t < active && cycles < pulses {
                    let alternate = if cycles.floor() as u32 % 2 == 1 {
                        1.0 - 2.0 * p[5]
                    } else {
                        1.0
                    };
                    (PI * cycles).sin().powi(2).powf(0.2 + 3.8 * p[4])
                        * (1.0 - p[2] * 0.95).powf(cycles.floor())
                        * 2.0
                        * alternate
                        - 0.25
                } else {
                    0.0
                }
            }
            22 => {
                let formant = 80.0 + 11920.0 * p[0];
                let width = 0.015 + 0.985 * p[1];
                let centre = 0.05 + 0.9 * p[2] + sine(self.age * 0.37) * p[7] * 0.25;
                let distance = (t - centre) / width;
                let gaussian = (-distance * distance * 8.0).exp();
                let local = distance * 2.0;
                let hann = if local.abs() < 1.0 {
                    0.5 + 0.5 * (PI * local).cos()
                } else {
                    0.0
                };
                let tri = (1.0 - local.abs()).max(0.0);
                let shape = p[4] * 2.0;
                let window = if shape < 1.0 {
                    lerp(gaussian, hann, shape)
                } else {
                    lerp(hann, tri, shape - 1.0)
                };
                window
                    * (sine(formant * t / frequency + p[5])
                        + p[3] * 0.5 * sine(formant * (1.0 + 4.0 * p[6]) * t / frequency + p[5]))
            }
            23 => {
                let point = 0.05 + 0.9 * p[0];
                let level = p[1] * 2.0 - 1.0;
                let steps = 2.0 + (p[3] * 30.0).round();
                let phase = (t * steps).floor() / steps;
                let exponent = 0.15 + 3.85 * p[2];
                let value = if phase < point {
                    lerp(p[4] * 2.0 - 1.0, level, (phase / point).powf(exponent))
                } else {
                    lerp(
                        level,
                        p[5] * 2.0 - 1.0,
                        ((phase - point) / (1.0 - point))
                            .powf(exponent * 2.0f32.powf(p[6] * 4.0 - 2.0)),
                    )
                };
                lerp(value, value.abs() * 2.0 - 1.0, p[7])
            }
            24 => {
                // Eight legacy points plus editable midpoint offsets: neutral
                // midpoint offsets retain the original piecewise-linear waveform.
                let pos = t * 8.0;
                let i = pos as usize % 8;
                let f = pos.fract();
                let a = p[i] * 2.0 - 1.0;
                let b = p[(i + 1) % 8] * 2.0 - 1.0;
                let mid = ((a + b) * 0.5 + p[i + 8] * 2.0 - 1.0).clamp(-1.0, 1.0);
                if f < 0.5 {
                    lerp(a, mid, f * 2.0)
                } else {
                    lerp(mid, b, f * 2.0 - 1.0)
                }
            }
            25 => {
                let rate = 0.2 * 10000.0f32.powf(p[1]);
                self.noise_countdown -= 1.0;
                if self.noise_countdown <= 0.0 {
                    self.random_target = self.random_distribution(p[6]);
                    self.noise_countdown += self.sr / rate;
                }
                self.smoothed_noise +=
                    (self.random_target - self.smoothed_noise) * (1.0 - p[2] * 0.999);
                let depth = (p[0] + (p[5] * 2.0 - 1.0) * envelope).clamp(0.0, 1.0);
                let amplitude = self.shaped(t, p[4]) * (1.0 - depth + depth * self.smoothed_noise);
                self.phase[1] = (self.phase[1] + dt * (1.0 + self.smoothed_noise * depth * 10.0))
                    .rem_euclid(1.0);
                lerp(amplitude, self.shaped(self.phase[1], p[4]), p[3])
            }
            26 => {
                let count = 3 + (p[2] * 29.0).floor() as usize;
                let i = self.stochastic_index % count;
                self.stochastic_progress +=
                    dt * count as f32 / (self.stochastic_duration[i] * 0.25 * 16.0f32.powf(p[5]));
                if self.stochastic_progress >= 1.0 {
                    self.stochastic_progress = self.stochastic_progress.fract();
                    self.stochastic_previous = self.stochastic_amp[i];
                    self.stochastic_index = (i + 1) % count;
                    let j = self.stochastic_index;
                    let n = noise(&mut self.seed);
                    let distribution = lerp(n, (n * 1.45).tan().clamp(-5.0, 5.0) / 5.0, p[3]);
                    self.stochastic_amp[j] = lerp(
                        reflected(self.stochastic_amp[j] + distribution * p[0] * 1.5),
                        sine(j as f32 / count as f32),
                        p[6] * 0.5,
                    );
                    self.stochastic_duration[j] = (self.stochastic_duration[j]
                        + noise(&mut self.seed) * p[1] * 0.6)
                        .clamp(0.2, 1.0 + 7.0 * p[7]);
                }
                let f = self.stochastic_progress.clamp(0.0, 1.0);
                let cosine = 0.5 - 0.5 * (PI * f).cos();
                let cubic = f * f * (3.0 - 2.0 * f);
                let shape = p[4] * 2.0;
                let f = if shape < 1.0 {
                    lerp(f, cosine, shape)
                } else {
                    lerp(cosine, cubic, shape - 1.0)
                };
                lerp(
                    self.stochastic_previous,
                    self.stochastic_amp[self.stochastic_index % count],
                    f,
                )
            }
            27 => {
                if wrapped {
                    self.random_target = noise(&mut self.seed);
                }
                if wrapped || self.age <= 1.1 / self.sr {
                    self.aux[0] = if p[5] > 0.0 && (noise(&mut self.seed) + 1.0) * 0.5 < p[5] {
                        0.0
                    } else {
                        1.0
                    };
                }
                let duty = (0.02 + 0.98 * p[0]) * (1.0 + self.random_target * p[2] * 0.8);
                let phase = t / duty.max(0.005);
                if phase < 1.0 {
                    let local = phase.powf(0.1 + 3.9 * p[7]);
                    let window =
                        lerp(1.0, (PI * local).sin().powi(2), p[3]) * (-local * p[6] * 10.0).exp();
                    sine(local * (1.0 + 11.0 * p[1]) + p[4]) * window * self.aux[0]
                } else {
                    0.0
                }
            }
            28 => self.spectral.vocoder_sample(frequency, p),
            29 => {
                if self.scan_clock == 0 {
                    let k = 0.003 + 0.16 * p[0];
                    let damping = 0.9999 - p[1] * 0.015;
                    for i in 0..64 {
                        let left = self.scan[(i + 63) % 64];
                        let right = self.scan[(i + 1) % 64];
                        let mass = 1.0 + p[3] * i as f32 / 16.0;
                        let relative = 0.08 - self.scan_velocity[i];
                        let bow = if gate && i == 12 {
                            p[7] * 0.05 * relative * (-relative * relative * 90.0).exp()
                        } else {
                            0.0
                        };
                        self.scan_velocity[i] = (self.scan_velocity[i]
                            + (left + right - 2.0 * self.scan[i]) * k / mass
                            - self.scan[i] * p[5] * 0.004
                            + bow)
                            * damping;
                    }
                    for i in 0..64 {
                        self.scan[i] = (self.scan[i] + self.scan_velocity[i]).clamp(-4.0, 4.0);
                    }
                }
                self.scan_clock = (self.scan_clock + 1) % (8 + (p[4] * 120.0).round() as usize);
                let trajectory = lerp(t, 0.5 - 0.5 * (TAU * t).cos(), p[2]);
                at(&self.scan, (trajectory + p[6]) * 64.0)
            }
            30 => {
                self.grain_countdown -= 1.0;
                if self.grain_countdown <= 0.0 {
                    let mut best = 0;
                    let mut distance = f32::INFINITY;
                    for i in 0..CORPUS {
                        let continuity =
                            ((i as f32 - self.corpus_current as f32) / CORPUS as f32).abs();
                        let d = ((self.corpus_brightness[i] - p[0]).powi(2)
                            + (self.corpus_noise[i] - p[1]).powi(2))
                            * p[4]
                            * 8.0
                            + continuity * p[3] * 0.45
                            + (noise(&mut self.seed) * 0.5 + 0.5) * (0.015 + 0.16 * (1.0 - p[3]));
                        if d < distance {
                            distance = d;
                            best = i;
                        }
                    }
                    self.corpus_current = best;
                    let duration = (0.020 + 0.230 * p[2]) * self.sr;
                    let reverse = if p[7] > 0.0 && (noise(&mut self.seed) + 1.0) * 0.5 < p[7] {
                        -1.0
                    } else {
                        1.0
                    };
                    self.add_grain(
                        best as f32 * self.source_len as f32 / CORPUS as f32,
                        frequency / 220.0 * self.source_sr / self.sr * reverse,
                        duration,
                        1.0,
                    );
                    self.grain_countdown += duration * (1.0 - p[5] * 0.95);
                }
                self.sampled_grains(p[6]) * 1.5
            }
            31 => {
                let value = at(&self.spectral.pad, self.sample_position);
                self.sample_position =
                    (self.sample_position + frequency / 220.0).rem_euclid(PAD_N as f32);
                value
            }
            32 => {
                self.phase[1] = (self.phase[1] + (0.1 + 19.9 * p[3]) / self.sr).fract();
                self.phase[2] =
                    (self.phase[2] + (0.1 + 19.9 * p[3]) * (0.25 + 3.75 * p[7]) / self.sr).fract();
                let motion = |phase: f32| {
                    let x = p[4] * 2.0;
                    if x < 1.0 {
                        lerp(sine(phase), triangle(phase), x)
                    } else {
                        lerp(triangle(phase), saw(phase), x - 1.0)
                    }
                };
                let x = (0.02 + 0.96 * p[0] + motion(self.phase[1] + p[5]) * p[2] * 0.25)
                    .clamp(0.015, 0.985);
                let y = (0.02 + 1.96 * p[1] + motion(self.phase[2] + p[5]) * p[6] * 0.8)
                    .clamp(0.01, 3.0);
                let phase = if t < x {
                    y * t / x
                } else {
                    y + (1.0 - y) * (t - x) / (1.0 - x)
                };
                (TAU * phase).cos()
            }
            37 => {
                let factor = match (p[7] * 2.0).round() as u32 {
                    1 => 2,
                    2 => 4,
                    _ => 1,
                };
                let mut value = 0.0;
                for sub in 0..factor {
                    value += self.antialias_sample(
                        (t + p[6] + dt * sub as f32 / factor as f32).fract(),
                        dt / factor as f32,
                        p,
                    );
                }
                let value = value / factor as f32;
                if p[4] < 0.99999 || p[5] > 0.0 {
                    let q = 2.0f32.powf(3.0 + (p[4] * 20.0).round());
                    let dither = noise(&mut self.seed) * p[5] / q;
                    (value * q + dither * q).round() / q
                } else {
                    value
                }
            }
            38 => {
                let source = lerp(sine(t), blep_saw(t, dt), p[4]);
                let emphasis = source + (source - self.aux[0]) * p[6] * 6.0;
                self.aux[0] = source;
                let mut input = emphasis * (1.0 + 11.0 * p[0]) + (p[1] * 2.0 - 1.0);
                if p[7] < 0.99999 {
                    let q = 2.0f32.powf(3.0 + (p[7] * 20.0).round());
                    input = (input * q).round() / q;
                }
                // First-order divided-difference antialiasing using exact
                // antiderivatives of tanh and x/sqrt(1+x²).
                let f = |x: f32| lerp(x.tanh(), x / (1.0 + x * x).sqrt(), p[3]);
                let primitive = |x: f32| {
                    let ax = x.abs();
                    lerp(
                        ax + (-2.0 * ax).exp().ln_1p() - 2.0f32.ln(),
                        (1.0 + x * x).sqrt(),
                        p[3],
                    )
                };
                let delta = input - self.adaa_previous;
                let aa = if delta.abs() < 1e-4 {
                    f((input + self.adaa_previous) * 0.5)
                } else {
                    (primitive(input) - primitive(self.adaa_previous)) / delta
                };
                self.adaa_previous = input;
                lerp(source, lerp(f(input), aa, p[2]), p[5])
            }
            39..=46 => self.expanded.next(method, frequency, p, gate, envelope),
            _ => 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn walsh_basis_is_sequency_ordered() {
        let mut dsp = Conventional::new(48_000.0);
        for order in 1..=16 {
            dsp.reset();
            let mut p = [0.0; 16];
            p[0] = (order - 1) as f32 / 15.0;
            let mut changes = 0;
            let mut previous = dsp.sample(3, 48_000.0 / 4096.0, &p, true, 1.0);
            for _ in 1..4096 {
                let next = dsp.sample(3, 48_000.0 / 4096.0, &p, true, 1.0);
                if previous.signum() != next.signum() {
                    changes += 1;
                }
                previous = next;
            }
            assert_eq!(changes, order, "Walsh order {order}");
        }
    }
    #[test]
    fn corpus_continuity_changes_fragment_selection() {
        let mut engine = crate::Engine::new(48_000.0);
        engine.set_method(30);
        let mut p = [0.5; 16];
        let mut a = vec![0.0; 48_000];
        let mut b = vec![0.0; 48_000];
        p[3] = 0.15;
        engine.set_params(p);
        engine.reset();
        engine.note_on(220.0, 0.8);
        engine.render(&mut a);
        p[3] = 0.85;
        engine.set_params(p);
        engine.reset();
        engine.note_on(220.0, 0.8);
        engine.render(&mut b);
        let difference = a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum::<f32>() / a.len() as f32;
        assert!(
            difference > 0.002,
            "continuity changes the mosaic, difference {difference}"
        );
    }
    #[test]
    fn added_conventional_controls_have_an_audible_context() {
        let mut dsp = Conventional::new(48_000.0);
        let mut failures = Vec::new();
        for method in 0..39u32 {
            if [8, 28, 31, 33, 34, 35, 36].contains(&method) {
                continue;
            }
            let mut p = crate::default_parameters(method);
            p[..4].copy_from_slice(&[0.37, 0.6, 0.61, 0.42]);
            match method {
                0 => p[1] = 0.04,
                2 => {
                    p[..8].copy_from_slice(&[0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.07]);
                    p[14] = 0.7;
                }
                3 => p[6] = 0.7,
                4 => p[4] = 0.5,
                7 => p[2] = 0.85,
                11 | 12 => p[5] = 0.6,
                13 => {
                    p[5] = 0.23;
                    p[6] = 0.6;
                }
                15 => {
                    p[0] = 0.01;
                    p[2] = 0.008;
                }
                18 => {
                    p[0] = 0.85;
                    p[1] = 0.45;
                    p[2] = 0.12;
                    p[3] = 0.25;
                    p[6] = 0.6;
                }
                24 => p[..8].copy_from_slice(&[0.5, 0.9, 0.6, 0.3, 0.1, 0.8, 0.7, 0.4]),
                32 => p[6] = 0.6,
                37 => p[4] = 0.2,
                _ => {}
            }
            let first = if method == 2 || method == 24 { 8 } else { 4 };
            for slot in first..crate::CONTROL_COUNTS[method as usize] {
                let mut renders = Vec::new();
                for value in [0.1, 0.8] {
                    let mut params = p;
                    params[slot] = value;
                    dsp.set_method(method);
                    dsp.prepare(method, &params, 173.0);
                    dsp.note_on(173.0, 0.8, &params);
                    let values: Vec<_> = (0..16_384)
                        .map(|n| {
                            dsp.sample(method, 173.0, &params, true, (-n as f32 / 48_000.0).exp())
                        })
                        .collect();
                    assert!(
                        values.iter().all(|x| x.is_finite()),
                        "nonfinite raw DSP method {method} control {slot}"
                    );
                    renders.push(values);
                }
                let difference = renders[0]
                    .iter()
                    .zip(&renders[1])
                    .map(|(a, b)| (a - b).abs())
                    .sum::<f32>()
                    / renders[0].len() as f32;
                if difference <= 0.000001 {
                    failures.push((method, slot, difference));
                }
            }
        }
        assert!(
            failures.is_empty(),
            "inaudible control contexts {failures:?}"
        );
    }
    #[test]
    fn conventional_raw_dsp_survives_live_extreme_changes() {
        let mut dsp = Conventional::new(48_000.0);
        for method in 0..39u32 {
            if (33..=36).contains(&method) {
                continue;
            }
            dsp.set_method(method);
            let mut p = crate::default_parameters(method);
            dsp.prepare(method, &p, 220.0);
            dsp.note_on(220.0, 0.8, &p);
            for n in 0..16_384 {
                if n % 2048 == 0 {
                    for i in 0..crate::CONTROL_COUNTS[method as usize] {
                        p[i] = if (n / 2048 + i) % 2 == 0 { 0.0 } else { 1.0 };
                    }
                    dsp.prepare(method, &p, 220.0);
                }
                let value = dsp.sample(method, 220.0, &p, true, 0.8);
                assert!(
                    value.is_finite() && value.abs() < 1e6,
                    "unbounded raw DSP {method} at {n}: {value}"
                );
            }
        }
    }
}
