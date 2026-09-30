//! Eight additional synthesis mechanisms. Parameters are normalized; coefficient
//! preparation is bounded and audio rendering never allocates. These are small
//! teaching models, not calibrated instruments or alias-free oscillators.
use std::f32::consts::{PI, TAU};

const BANDS: usize = 12;
const SIDE: usize = 16;
const CELLS: usize = SIDE * SIDE;
const LINES: usize = 8;

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
fn log_range(a: f32, b: f32, t: f32) -> f32 {
    a * (b / a).powf(t)
}
fn noise(seed: &mut u32) -> f32 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    *seed as f32 / u32::MAX as f32 * 2.0 - 1.0
}
fn unit(seed: &mut u32) -> f32 {
    0.5 + 0.5 * noise(seed)
}
fn rounded(x: f32, low: usize, high: usize) -> usize {
    (lerp(low as f32, high as f32, x).round() as usize).clamp(low, high)
}

#[derive(Default)]
struct Sync {
    master: f32,
    slave: f32,
    correction: f32,
}
impl Sync {
    fn wave(phase: f32, shape: usize, width: f32) -> f32 {
        let p = phase.rem_euclid(1.0);
        match shape {
            0 => (TAU * p).sin(),
            1 => 2.0 * p - 1.0,
            _ => {
                if p < width {
                    1.0
                } else {
                    -1.0
                }
            }
        }
    }
    // Two-sample polynomial BLEP residual, evaluated on both sides of an
    // event at fractional time t. The next call receives its causal tail.
    fn event(t: f32, jump: f32, before: &mut f32, after: &mut f32) {
        let t = t.clamp(0.0, 1.0);
        *before += 0.5 * jump * (1.0 - t).powi(2);
        *after -= 0.5 * jump * t * t;
    }
    fn segment(
        start: f32,
        step: f32,
        t0: f32,
        t1: f32,
        shape: usize,
        width: f32,
        before: &mut f32,
        after: &mut f32,
    ) -> f32 {
        let end = start + step * (t1 - t0);
        if step > 0.0 && shape != 0 {
            // At most one natural wrap and one pulse edge in each segment.
            for cycle in start.floor() as i32..=end.floor() as i32 {
                let edge = cycle as f32 + 1.0;
                if edge > start && edge <= end {
                    Self::event(
                        t0 + (edge - start) / step,
                        if shape == 1 { -2.0 } else { 2.0 },
                        before,
                        after,
                    );
                }
                let edge = cycle as f32 + width;
                if shape == 2 && edge > start && edge <= end {
                    Self::event(t0 + (edge - start) / step, -2.0, before, after);
                }
            }
        }
        end.rem_euclid(1.0)
    }
    fn next(
        &mut self,
        sr: f32,
        frequency: f32,
        p: &[f32; 16],
        envelope: f32,
        seed: &mut u32,
    ) -> f32 {
        let master_step = (frequency / sr).clamp(0.000001, 0.45);
        let ratio = lerp(1.0, 32.0, p[0]) * (lerp(-24.0, 24.0, p[4]) * envelope / 12.0).exp2();
        let step = (master_step * ratio).min(0.45);
        let shape = rounded(p[1], 0, 2);
        let width = lerp(0.02, 0.98, p[2]);
        let raw = Self::wave(self.slave, shape, width);
        let mut before = 0.0;
        let mut after = 0.0;
        if self.master + master_step >= 1.0 {
            let t = (1.0 - self.master) / master_step;
            let prior = Self::segment(
                self.slave,
                step,
                0.0,
                t,
                shape,
                width,
                &mut before,
                &mut after,
            );
            let target = (p[3] + p[6] * noise(seed) * 0.25).rem_euclid(1.0);
            let reset = lerp(prior, target, p[5]);
            Self::event(
                t,
                Self::wave(reset, shape, width) - Self::wave(prior, shape, width),
                &mut before,
                &mut after,
            );
            self.slave = Self::segment(reset, step, t, 1.0, shape, width, &mut before, &mut after);
        } else {
            self.slave = Self::segment(
                self.slave,
                step,
                0.0,
                1.0,
                shape,
                width,
                &mut before,
                &mut after,
            );
        }
        self.master = (self.master + master_step).rem_euclid(1.0);
        let result = if p[7] >= 0.5 {
            raw + self.correction + before
        } else {
            raw
        };
        self.correction = after;
        result * 0.7
    }
}

struct Ssb {
    phase: f32,
    shift: f32,
    motion: f32,
    weights: [f32; 32],
    count: usize,
    frequency: f32,
}
impl Default for Ssb {
    fn default() -> Self {
        Self {
            phase: 0.0,
            shift: 0.0,
            motion: 0.0,
            weights: [0.0; 32],
            count: 1,
            frequency: 220.0,
        }
    }
}
impl Ssb {
    fn prepare(&mut self, frequency: f32, p: &[f32; 16]) {
        self.count = rounded(p[3], 1, 32);
        self.frequency = frequency * lerp(0.1, 16.0, p[1]);
        let mut sum = 0.0;
        for i in 0..self.count {
            self.weights[i] = ((i + 1) as f32).powf(-lerp(0.1, 3.5, p[4]));
            sum += self.weights[i];
        }
        for w in &mut self.weights[..self.count] {
            *w /= sum;
        }
    }
    fn next(&mut self, sr: f32, p: &[f32; 16]) -> f32 {
        let shift_hz = lerp(-4000.0, 4000.0, p[0]) + 2000.0 * p[7] * (TAU * self.motion).sin();
        let theta = TAU * (self.phase + p[6]);
        let shift = TAU * self.shift;
        let (ss, cs) = shift.sin_cos();
        let mut wet = 0.0;
        let mut dry = 0.0;
        for h in 1..=self.count {
            let hz = h as f32 * self.frequency;
            let (imag, real) = (h as f32 * theta).sin_cos();
            let upper = if (hz + shift_hz).abs() < sr * 0.48 {
                real * cs - imag * ss
            } else {
                0.0
            };
            let lower = if (hz - shift_hz).abs() < sr * 0.48 {
                real * cs + imag * ss
            } else {
                0.0
            };
            wet += self.weights[h - 1] * lerp(upper, lower, p[2]);
            if hz < sr * 0.48 {
                dry += self.weights[h - 1] * real;
            }
        }
        self.phase = (self.phase + self.frequency / sr).rem_euclid(1.0);
        self.shift = (self.shift + shift_hz / sr).rem_euclid(1.0);
        self.motion = (self.motion + 0.31 / sr).fract();
        0.8 * lerp(dry, wet, p[5])
    }
}

#[derive(Default)]
struct Wavelets {
    phase: f32,
    motion: f32,
}
impl Wavelets {
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        let family = rounded(p[0], 0, 2);
        let count = rounded(p[1], 1, 8);
        let spacing = lerp(1.25, 4.0, p[2]);
        let width = lerp(0.025, 0.5, p[4]);
        let mut scale: f32 = 1.0;
        let mut coefficient: f32 = 1.0;
        let mut total = 0.0;
        let mut norm = 0.0;
        for j in 0..count {
            // Omit sub-sample packets; this is a finite wavelet construction,
            // not an orthonormal transform or an alias-free reconstruction.
            if j > 0 && frequency * scale / width > sr * 0.45 {
                break;
            }
            let moving = p[6] * 0.22 * (TAU * self.motion + j as f32 * 1.7).sin();
            let translation = p[5] + j as f32 * 0.381966 + moving;
            let d = (self.phase - translation + 0.5).rem_euclid(1.0) - 0.5;
            let x = d * scale / width;
            let mother = match family {
                2 => {
                    if (-1.0..0.0).contains(&x) {
                        1.0
                    } else if (0.0..1.0).contains(&x) {
                        -1.0
                    } else {
                        0.0
                    }
                }
                1 => (1.0 - x * x) * (-0.5 * x * x).exp() * (10.0 * p[7] * x * x).cos(),
                _ => {
                    (-0.5 * x * x).exp()
                        * ((5.0 * x + 10.0 * p[7] * x * x).cos() - (-12.5_f32).exp())
                }
            };
            let weight = coefficient * scale.sqrt();
            total += weight * mother;
            norm += weight;
            coefficient *= lerp(0.98, 0.05, p[3]);
            scale *= spacing;
        }
        self.phase = (self.phase + frequency.min(sr * 0.45) / sr).fract();
        self.motion = (self.motion + 0.23 / sr).fract();
        0.9 * total / norm.max(0.001)
    }
}

struct Colored {
    low: [f32; BANDS],
    high: [f32; BANDS],
    held: [f32; BANDS],
    low_k: [f32; BANDS],
    high_k: [f32; BANDS],
    weight: [f32; BANDS],
    countdown: usize,
    hold: usize,
    norm: f32,
    cut_low: f32,
    cut_high: f32,
    cut_low_k: f32,
    cut_high_k: f32,
    ic1: f32,
    ic2: f32,
    g: f32,
    k: f32,
    flutter: f32,
}
impl Default for Colored {
    fn default() -> Self {
        Self {
            low: [0.0; BANDS],
            high: [0.0; BANDS],
            held: [0.0; BANDS],
            low_k: [0.0; BANDS],
            high_k: [0.0; BANDS],
            weight: [0.0; BANDS],
            countdown: 0,
            hold: 1,
            norm: 1.0,
            cut_low: 0.0,
            cut_high: 0.0,
            cut_low_k: 0.0,
            cut_high_k: 0.0,
            ic1: 0.0,
            ic2: 0.0,
            g: 0.1,
            k: 2.0,
            flutter: 0.0,
        }
    }
}
impl Colored {
    fn prepare(&mut self, sr: f32, p: &[f32; 16]) {
        let alpha = lerp(-2.0, 2.0, p[0]);
        let max = (sr * 0.45).min(22000.0);
        let mut variance = 0.0;
        let mut held_variance = 0.0_f64;
        self.hold = rounded(p[4], 1, 64);
        for i in 0..BANDS {
            let lo = log_range(12.0, max, i as f32 / BANDS as f32);
            let hi = log_range(12.0, max, (i + 1) as f32 / BANDS as f32);
            let al = (-TAU * lo / sr).exp();
            let ah = (-TAU * hi / sr).exp();
            let kl = 1.0 - al;
            let kh = 1.0 - ah;
            self.low_k[i] = kl;
            self.high_k[i] = kh;
            self.weight[i] = ((lo * hi).sqrt() / 1000.0).powf(-0.5 * alpha);
            let energy = kh * kh / (1.0 - ah * ah) + kl * kl / (1.0 - al * al)
                - 2.0 * kh * kl / (1.0 - ah * al);
            variance += self.weight[i].powi(2) * energy.max(0.0) / 3.0;
            if self.hold > 1 {
                // A value held for N samples has time-averaged covariance
                // R[k] = (1 - |k|/N)/3 for |k| < N. Convolve that with the
                // exact autocorrelation of this two-pole difference response.
                // Double precision avoids cancellation in the lowest bands.
                let (al, ah, kl, kh) = (al as f64, ah as f64, kl as f64, kh as f64);
                let high = kh * kh / (1.0 - ah * ah);
                let low = kl * kl / (1.0 - al * al);
                let cross = kh * kl / (1.0 - ah * al);
                let mut held_energy = high + low - 2.0 * cross;
                let (mut high_power, mut low_power) = (1.0, 1.0);
                for lag in 1..self.hold {
                    high_power *= ah;
                    low_power *= al;
                    let correlation = (high - cross) * high_power + (low - cross) * low_power;
                    held_energy += 2.0 * (1.0 - lag as f64 / self.hold as f64) * correlation;
                }
                held_variance += (self.weight[i] as f64).powi(2) * held_energy.max(0.0) / 3.0;
            }
        }
        self.norm = if self.hold == 1 {
            0.25 / variance.max(1e-8).sqrt()
        } else {
            (0.25 / held_variance.max(1e-12).sqrt()) as f32
        };
        let lo = log_range(20.0, 2000.0, p[1]).min(sr * 0.3);
        let hi = log_range(200.0, 20000.0, p[2])
            .max(lo * 1.05)
            .min(sr * 0.45);
        self.cut_low_k = 1.0 - (-TAU * lo / sr).exp();
        self.cut_high_k = 1.0 - (-TAU * hi / sr).exp();
        self.g = (PI * log_range(100.0, 8000.0, p[5]).min(sr * 0.4) / sr).tan();
        self.k = lerp(2.0, 0.1, p[6]);
    }
    fn next(&mut self, sr: f32, p: &[f32; 16], seed: &mut u32) -> f32 {
        if self.countdown == 0 {
            let distribution = rounded(p[3], 0, 2);
            for value in &mut self.held {
                *value = match distribution {
                    // Six independent uniforms approximate a Gaussian with
                    // the same variance as the uniform reference.
                    1 => (0..6).map(|_| noise(seed)).sum::<f32>() / 6.0_f32.sqrt(),
                    2 => {
                        if noise(seed) < 0.0 {
                            -0.57735026
                        } else {
                            0.57735026
                        }
                    }
                    _ => noise(seed),
                };
            }
            self.countdown = self.hold;
        }
        self.countdown -= 1;
        let mut result = 0.0;
        for i in 0..BANDS {
            self.low[i] += self.low_k[i] * (self.held[i] - self.low[i]);
            self.high[i] += self.high_k[i] * (self.held[i] - self.high[i]);
            result += self.weight[i] * (self.high[i] - self.low[i]);
        }
        result *= self.norm;
        self.cut_low += self.cut_low_k * (result - self.cut_low);
        self.cut_high += self.cut_high_k * (result - self.cut_low - self.cut_high);
        let v1 =
            (self.ic1 + self.g * (self.cut_high - self.ic2)) / (1.0 + self.g * (self.g + self.k));
        let v2 = self.ic2 + self.g * v1;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        let gain = 1.0 - p[7] * (0.4 - 0.4 * (TAU * self.flutter).sin());
        self.flutter = (self.flutter + 0.47 / sr).fract();
        (self.cut_high + p[6] * 0.7 * v1) * gain
    }
}

struct Shaker {
    energy: f32,
    energy_loss: f32,
    collision_probability: f32,
    particle_gain: f32,
    contact: f32,
    contact_loss: f32,
    brightness: f32,
    brightness_k: f32,
    re: [f32; 4],
    im: [f32; 4],
    pole_re: [f32; 4],
    pole_im: [f32; 4],
    pole_gain: [f32; 4],
    motion: f32,
    collisions: u64,
}
impl Default for Shaker {
    fn default() -> Self {
        Self {
            energy: 0.0,
            energy_loss: 0.999,
            collision_probability: 0.01,
            particle_gain: 0.1,
            contact: 0.0,
            contact_loss: 0.99,
            brightness: 0.0,
            brightness_k: 0.5,
            re: [0.0; 4],
            im: [0.0; 4],
            pole_re: [0.0; 4],
            pole_im: [0.0; 4],
            pole_gain: [0.0; 4],
            motion: 0.0,
            collisions: 0,
        }
    }
}
impl Shaker {
    fn prepare(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) {
        let particles = log_range(2.0, 256.0, p[0]).round();
        self.particle_gain = 2.0 / particles.sqrt();
        self.contact_loss = (-1.0 / (sr * 0.0015)).exp();
        self.collision_probability = (particles * lerp(0.01, 1.0, p[1]) * 80.0 / sr).min(0.8);
        self.energy_loss = (-1.0 / (sr * log_range(0.05, 4.0, p[3]))).exp();
        self.brightness_k = 1.0 - (-TAU * log_range(20.0, 20000.0, p[7]).min(sr * 0.45) / sr).exp();
        let q = log_range(1.0, 100.0, p[4]);
        for (i, ratio) in [1.0, 1.37, 1.93, 2.61].iter().enumerate() {
            let hz = (frequency * lerp(1.0, *ratio, p[2])).min(sr * 0.44);
            let radius = (-PI * hz / (q * sr)).exp();
            let (s, c) = (TAU * hz / sr).sin_cos();
            self.pole_re[i] = radius * c;
            self.pole_im[i] = radius * s;
            self.pole_gain[i] = 2.0 * (1.0 - radius * radius).sqrt();
        }
    }
    fn next(&mut self, sr: f32, p: &[f32; 16], gate: bool, seed: &mut u32) -> f32 {
        let gesture = if gate {
            p[5] * (0.65 + 0.35 * (TAU * self.motion).sin())
        } else {
            0.0
        };
        self.energy = self.energy * self.energy_loss + gesture * (1.0 - self.energy_loss);
        self.motion = (self.motion + 5.3 / sr).fract();
        let mut hit = 0.0;
        if unit(seed) < self.collision_probability * self.energy.sqrt() {
            hit = self.particle_gain * self.energy.sqrt() * noise(seed);
            self.contact = (self.contact * self.contact + hit * hit).sqrt();
            self.collisions += 1;
        }
        self.contact *= self.contact_loss;
        let input = lerp(hit, self.contact * noise(seed), p[6]);
        self.brightness += self.brightness_k * (input - self.brightness);
        let mut output = 0.0;
        for i in 0..4 {
            let re = self.pole_re[i] * self.re[i] - self.pole_im[i] * self.im[i] + self.brightness;
            self.im[i] = self.pole_im[i] * self.re[i] + self.pole_re[i] * self.im[i];
            self.re[i] = re;
            output += self.pole_gain[i] * self.im[i];
        }
        output * 0.45
    }
}

struct Membrane {
    current: [f32; CELLS],
    previous: [f32; CELLS],
    scratch: [f32; CELLS],
    n: usize,
    lx2: f32,
    ly2: f32,
    damping: f32,
}
impl Default for Membrane {
    fn default() -> Self {
        Self {
            current: [0.0; CELLS],
            previous: [0.0; CELLS],
            scratch: [0.0; CELLS],
            n: 12,
            lx2: 0.01,
            ly2: 0.01,
            damping: 0.001,
        }
    }
}
impl Membrane {
    fn at(plane: &[f32; CELLS], n: usize, x: f32, y: f32) -> f32 {
        let x = x.clamp(0.0, (n - 1) as f32);
        let y = y.clamp(0.0, (n - 1) as f32);
        let ix = x as usize;
        let iy = y as usize;
        let jx = (ix + 1).min(n - 1);
        let jy = (iy + 1).min(n - 1);
        lerp(
            lerp(plane[iy * SIDE + ix], plane[iy * SIDE + jx], x - ix as f32),
            lerp(plane[jy * SIDE + ix], plane[jy * SIDE + jx], x - ix as f32),
            y - iy as f32,
        )
    }
    fn resize(&mut self, n: usize) {
        if n == self.n {
            return;
        }
        for plane in [&mut self.current, &mut self.previous] {
            for y in 0..n {
                for x in 0..n {
                    self.scratch[y * SIDE + x] = Self::at(
                        plane,
                        self.n,
                        x as f32 * (self.n - 1) as f32 / (n - 1) as f32,
                        y as f32 * (self.n - 1) as f32 / (n - 1) as f32,
                    );
                }
            }
            *plane = self.scratch;
        }
        self.n = n;
    }
    fn prepare(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) {
        self.resize(rounded(p[9], 6, 16));
        let aspect = lerp(0.5, 2.0, p[4]);
        let lambda = frequency * lerp(0.35, 3.0, p[0]) * (self.n + 1) as f32 * 2.0_f32.sqrt() / sr;
        let x = lambda * lambda / aspect;
        let y = lambda * lambda * aspect;
        // Conservative generalized CFL margin, including non-square spacing.
        let scale = (0.49 / (x + y).max(1e-12)).min(1.0);
        self.lx2 = x * scale;
        self.ly2 = y * scale;
        self.damping = (0.15 + 80.0 * p[1] * p[1]) / sr;
    }
    fn strike(&mut self, velocity: f32, p: &[f32; 16]) {
        self.current.fill(0.0);
        self.previous.fill(0.0);
        let x0 = 1.0 + p[2] * (self.n - 3) as f32;
        let y0 = 1.0 + p[3] * (self.n - 3) as f32;
        let width = lerp(2.8, 0.35, p[8]);
        for y in 0..self.n {
            for x in 0..self.n {
                let d2 = (x as f32 - x0).powi(2) + (y as f32 - y0).powi(2);
                let value = 0.4 * velocity * (-0.5 * d2 / (width * width)).exp();
                self.current[y * SIDE + x] = value;
                self.previous[y * SIDE + x] = value;
            }
        }
    }
    fn next(&mut self, p: &[f32; 16]) -> f32 {
        for y in 0..self.n {
            for x in 0..self.n {
                let i = y * SIDE + x;
                let u = self.current[i];
                let left = if x > 0 { self.current[i - 1] } else { p[7] * u };
                let right = if x + 1 < self.n {
                    self.current[i + 1]
                } else {
                    p[7] * u
                };
                let up = if y > 0 {
                    self.current[i - SIDE]
                } else {
                    p[7] * u
                };
                let down = if y + 1 < self.n {
                    self.current[i + SIDE]
                } else {
                    p[7] * u
                };
                self.scratch[i] = (2.0 * u - (1.0 - self.damping) * self.previous[i]
                    + self.lx2 * (left + right - 2.0 * u)
                    + self.ly2 * (up + down - 2.0 * u))
                    / (1.0 + self.damping);
            }
        }
        std::mem::swap(&mut self.previous, &mut self.current);
        std::mem::swap(&mut self.current, &mut self.scratch);
        2.5 * Self::at(
            &self.current,
            self.n,
            p[5] * (self.n - 1) as f32,
            p[6] * (self.n - 1) as f32,
        )
    }
}

struct Fdn {
    buffer: Box<[f32]>,
    capacity: usize,
    clock: usize,
    lengths: [f32; LINES],
    gains: [f32; LINES],
    injection: [f32; LINES],
    low: [f32; LINES],
    ap_x: [f32; LINES],
    ap_y: [f32; LINES],
    count: usize,
    damping: f32,
    age: usize,
    velocity: f32,
    phase: f32,
}
impl Fdn {
    fn new(sr: f32) -> Self {
        let capacity = (sr * 0.4).ceil() as usize + 4;
        Self {
            buffer: vec![0.0; capacity * LINES].into_boxed_slice(),
            capacity,
            clock: 0,
            lengths: [100.0; LINES],
            gains: [0.9; LINES],
            injection: [0.0; LINES],
            low: [0.0; LINES],
            ap_x: [0.0; LINES],
            ap_y: [0.0; LINES],
            count: LINES,
            damping: 0.5,
            age: usize::MAX,
            velocity: 0.0,
            phase: 0.0,
        }
    }
    fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.clock = 0;
        self.low.fill(0.0);
        self.ap_x.fill(0.0);
        self.ap_y.fill(0.0);
        self.age = usize::MAX;
        self.velocity = 0.0;
        self.phase = 0.0;
    }
    fn prepare(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) {
        self.count = rounded(p[4], 2, LINES);
        let size =
            log_range(0.002, 0.2, p[0]) * sr * (220.0 / frequency.max(20.0)).clamp(0.25, 4.0);
        let decay = log_range(0.05, 10.0, p[1]);
        let ratios = [0.719, 0.839, 1.0, 1.113, 1.229, 1.313, 1.421, 1.543];
        // Preserve the network's unequal delay ratios when its requested size
        // exceeds storage. Independent line clamps would collapse low notes.
        let size = size.min((self.capacity - 2) as f32 / ratios[self.count - 1]);
        let mut norm = 0.0;
        for (i, ratio) in ratios.iter().enumerate().take(self.count) {
            self.lengths[i] = (size * ratio).clamp(2.0, (self.capacity - 2) as f32);
            self.gains[i] = 10.0_f32
                .powf(-3.0 * self.lengths[i] / (sr * decay))
                .min(0.99995);
            let d = i as f32 / (self.count - 1) as f32 - p[6];
            self.injection[i] = (-18.0 * d * d).exp();
            norm += self.injection[i].powi(2);
        }
        for x in &mut self.injection[..self.count] {
            *x /= norm.max(1e-9).sqrt();
        }
        self.damping = lerp(1.0, 0.025, p[2] * p[2]);
    }
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16], seed: &mut u32) -> f32 {
        let mut values = [0.0; LINES];
        let mut sum = 0.0;
        let mut output = 0.0;
        for (i, v) in values.iter_mut().enumerate().take(self.count) {
            let position = (self.clock as f32 - self.lengths[i]).rem_euclid(self.capacity as f32);
            let a = position as usize;
            let b = (a + 1) % self.capacity;
            let read = lerp(
                self.buffer[i * self.capacity + a],
                self.buffer[i * self.capacity + b],
                position - a as f32,
            );
            self.low[i] += self.damping * (read - self.low[i]);
            let coefficient = p[5] * (0.35 + i as f32 * 0.045);
            *v = -coefficient * self.low[i] + self.ap_x[i] + coefficient * self.ap_y[i];
            self.ap_x[i] = self.low[i];
            self.ap_y[i] = *v;
            sum += *v;
            output += read * if i % 2 == 0 { 1.0 } else { -0.7 };
        }
        let duration = (sr * 0.012) as usize;
        let input = if self.age < duration {
            let window = (PI * self.age as f32 / duration as f32).sin().powi(2);
            let pitched = (TAU * self.phase).sin();
            self.age += 1;
            0.7 * self.velocity * window * lerp(pitched, noise(seed), p[7])
        } else {
            0.0
        };
        self.phase = (self.phase + frequency / sr).fract();
        for (i, value) in values.iter().enumerate().take(self.count) {
            // H = I - 2 uu^T is orthogonal. Its convex blend with I is
            // contractive; loss, damping, inversion and saturation cannot add gain.
            let mixed = value - p[3] * 2.0 * sum / self.count as f32;
            let drive = 1.0 + 8.0 * p[8];
            let saturated = lerp(mixed, (drive * mixed).tanh() / drive, p[8]);
            self.buffer[i * self.capacity + self.clock] =
                self.injection[i] * input + self.gains[i] * (1.0 - 2.0 * p[9]) * saturated;
        }
        self.clock = (self.clock + 1) % self.capacity;
        1.2 * output / (self.count as f32).sqrt()
    }
}

#[derive(Default)]
struct Rossler {
    state: [f64; 3],
    dc: f32,
    dc_k: f32,
    resets: u64,
}
impl Rossler {
    fn initialize(&mut self, p: &[f32; 16]) {
        self.state = [
            1.0 + 10.0 * p[7] as f64,
            -2.0 + 4.0 * p[7] as f64,
            0.1 + 0.2 * p[7] as f64,
        ];
        self.dc = 0.0;
    }
    // Rodrigues rotation around the (1,1,1) diagonal preserves projection
    // energy and remains a real coordinate rotation at the X/Y/Z endpoints.
    fn project(axes: [f32; 3], axis: f32, rotation: f32) -> f32 {
        let (s, c) = (TAU * rotation).sin_cos();
        let diagonal = (axes[0] + axes[1] + axes[2]) / 3.0;
        let cross = [axes[2] - axes[1], axes[0] - axes[2], axes[1] - axes[0]];
        let rotated: [f32; 3] = std::array::from_fn(|i| {
            axes[i] * c + cross[i] * s / 3.0_f32.sqrt() + diagonal * (1.0 - c)
        });
        let axis = (axis * 2.0).clamp(0.0, 2.0);
        let index = (axis as usize).min(1);
        lerp(rotated[index], rotated[index + 1], axis - index as f32)
    }
    fn derivative(v: [f64; 3], a: f64, b: f64, c: f64) -> [f64; 3] {
        [-v[1] - v[2], v[0] + a * v[1], b + v[2] * (v[0] - c)]
    }
    fn step(&mut self, dt: f64, a: f64, b: f64, c: f64) {
        let x = self.state;
        let k1 = Self::derivative(x, a, b, c);
        let k2 = Self::derivative(std::array::from_fn(|i| x[i] + 0.5 * dt * k1[i]), a, b, c);
        let k3 = Self::derivative(std::array::from_fn(|i| x[i] + 0.5 * dt * k2[i]), a, b, c);
        let k4 = Self::derivative(std::array::from_fn(|i| x[i] + dt * k3[i]), a, b, c);
        for i in 0..3 {
            self.state[i] += dt * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]) / 6.0;
        }
    }
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        let a = lerp(0.05, 0.5, p[0]) as f64;
        let b = lerp(0.05, 1.0, p[1]) as f64;
        let c = lerp(2.0, 16.0, p[2]) as f64;
        let dt = (TAU * frequency * lerp(0.2, 2.0, p[3]) / sr).min(0.32) as f64;
        let steps = rounded(p[6], 1, 8).max((dt / 0.04).ceil() as usize);
        for _ in 0..steps {
            self.step(dt / steps as f64, a, b, c);
        }
        // Some parameter combinations do not have a bounded attractor. An
        // escaped trajectory restarts at its chosen deterministic initial state;
        // it is never replaced by random noise or a different differential equation.
        if self.state.iter().any(|v| !v.is_finite() || v.abs() > 128.0) {
            self.resets += 1;
            self.initialize(p);
        }
        let axes = [
            self.state[0] as f32,
            self.state[1] as f32,
            self.state[2] as f32 * 0.4,
        ];
        let value = Self::project(axes, p[4], p[5]) * 0.12;
        self.dc += self.dc_k * (value - self.dc);
        0.7 * (value - self.dc).tanh()
    }
}

pub struct NewMethods {
    sr: f32,
    seed: u32,
    params: [f32; 16],
    method: u32,
    prepare_left: usize,
    prepared_frequency: f32,
    sync: Sync,
    ssb: Ssb,
    wavelets: Wavelets,
    colored: Colored,
    shaker: Shaker,
    membrane: Membrane,
    fdn: Fdn,
    rossler: Rossler,
}
impl NewMethods {
    pub fn new(sample_rate: f32) -> Self {
        let sr = if sample_rate.is_finite() {
            sample_rate.clamp(8000.0, 192000.0)
        } else {
            48000.0
        };
        Self {
            sr,
            seed: 0x713ac849,
            params: [0.0; 16],
            method: u32::MAX,
            prepare_left: 0,
            prepared_frequency: 0.0,
            sync: Sync::default(),
            ssb: Ssb::default(),
            wavelets: Wavelets::default(),
            colored: Colored::default(),
            shaker: Shaker::default(),
            membrane: Membrane::default(),
            fdn: Fdn::new(sr),
            rossler: Rossler::default(),
        }
    }
    pub fn reset(&mut self) {
        self.seed = 0x713ac849;
        self.method = u32::MAX;
        self.prepare_left = 0;
        self.sync = Sync::default();
        self.ssb = Ssb::default();
        self.wavelets = Wavelets::default();
        self.colored = Colored::default();
        self.shaker = Shaker::default();
        self.membrane = Membrane::default();
        self.fdn.reset();
        self.rossler = Rossler::default();
    }
    fn prepare(&mut self, method: u32, frequency: f32, p: &[f32; 16]) {
        let clean = p.map(|x| {
            if x.is_finite() {
                x.clamp(0.0, 1.0)
            } else {
                0.0
            }
        });
        if self.method == method && self.params == clean && self.prepared_frequency == frequency {
            self.prepare_left = 32;
            return;
        }
        self.params = clean;
        self.prepared_frequency = frequency;
        self.method = method;
        self.prepare_left = 32;
        match method {
            40 => self.ssb.prepare(frequency, &self.params),
            42 => self.colored.prepare(self.sr, &self.params),
            43 => self.shaker.prepare(self.sr, frequency, &self.params),
            44 => self.membrane.prepare(self.sr, frequency, &self.params),
            45 => self.fdn.prepare(self.sr, frequency, &self.params),
            46 => self.rossler.dc_k = 1.0 - (-TAU * 8.0 / self.sr).exp(),
            _ => {}
        }
    }
    pub fn note_on(&mut self, method: u32, frequency: f32, velocity: f32, params: &[f32; 16]) {
        self.prepare(method, frequency, params);
        match method {
            39 => self.sync = Sync::default(),
            40 => {
                self.ssb.phase = 0.0;
                self.ssb.shift = 0.0;
            }
            41 => self.wavelets.phase = 0.0,
            43 => self.shaker.energy = velocity.clamp(0.0, 1.0),
            44 => self.membrane.strike(velocity, &self.params),
            45 => {
                self.fdn.age = 0;
                self.fdn.velocity = velocity;
                self.fdn.phase = 0.0;
            }
            46 => self.rossler.initialize(&self.params),
            _ => {}
        }
    }
    pub fn next(
        &mut self,
        method: u32,
        frequency: f32,
        params: &[f32; 16],
        gate: bool,
        envelope: f32,
    ) -> f32 {
        if self.method != method || self.prepare_left == 0 {
            self.prepare(method, frequency, params);
        }
        self.prepare_left -= 1;
        match method {
            39 => self
                .sync
                .next(self.sr, frequency, &self.params, envelope, &mut self.seed),
            40 => self.ssb.next(self.sr, &self.params),
            41 => self.wavelets.next(self.sr, frequency, &self.params),
            42 => self.colored.next(self.sr, &self.params, &mut self.seed),
            43 => self
                .shaker
                .next(self.sr, &self.params, gate, &mut self.seed),
            44 => self.membrane.next(&self.params),
            45 => self
                .fdn
                .next(self.sr, frequency, &self.params, &mut self.seed),
            46 => self.rossler.next(self.sr, frequency, &self.params),
            _ => 0.0,
        }
    }
}

#[cfg(test)]
#[path = "expanded_tests.rs"]
mod expanded_tests;
