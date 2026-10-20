//! Phase-preserved FFT resynthesis. Fixed dual banks retain the previous voice
//! while topology edits warm a replacement and crossfade over 24 milliseconds.
//! No allocation, imports, clock reads, or JS callbacks occur in rendering.
//! All spectrum/window/overlap arithmetic remains f64, matching the original JS.

const BLOCK_SIZE: usize = 128;
pub const MAX_FFT_SIZE: usize = 4096;
pub const MAX_FFT_BANDS: usize = 1024;
const CHANNELS: usize = 16;
const OLA_SIZE: usize = MAX_FFT_SIZE * 4;
const OLA_MASK: usize = OLA_SIZE - 1;
const TAU: f64 = core::f64::consts::TAU;

#[inline]
fn clamp(x: f64, low: f64, high: f64) -> f64 {
    x.max(low).min(high)
}
#[inline]
fn finite(x: f64, fallback: f64) -> f64 {
    if x.is_finite() {
        x
    } else {
        fallback
    }
}
// JS Math.round rounds negative half-way values toward +infinity.
#[inline]
fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}
#[inline]
fn wrap(x: f64) -> f64 {
    ((x % 1.0) + 1.0) % 1.0
}

#[derive(Clone, Copy)]
struct Configuration {
    size: usize,
    window: u32,
    hop: usize,
    bands: usize,
    low: f64,
    high: f64,
    response: f64,
    detail: f64,
    input_gain: f64,
    gate_db: f64,
}
impl Configuration {
    const fn zero() -> Self {
        Self {
            size: 0,
            window: 0,
            hop: 0,
            bands: 0,
            low: 0.0,
            high: 0.0,
            response: 0.0,
            detail: 0.0,
            input_gain: 0.0,
            gate_db: 0.0,
        }
    }
    const fn defaults() -> Self {
        Self {
            size: 1024,
            window: 0,
            hop: 256,
            bands: 96,
            low: 70.0,
            high: 12000.0,
            response: 0.038,
            detail: 0.9,
            input_gain: 1.4,
            gate_db: -72.0,
        }
    }
    fn from_values(v: &[f64; 11], sample_rate: f64) -> Self {
        let requested = clamp(round(finite(v[0], 1024.0)), 256.0, MAX_FFT_SIZE as f64);
        let size = if requested < 384.0 {
            256
        } else if requested < 768.0 {
            512
        } else if requested < 1536.0 {
            1024
        } else if requested < 3072.0 {
            2048
        } else {
            4096
        };
        let low = clamp(finite(v[4], 70.0), 20.0, sample_rate * 0.22);
        Self {
            size,
            window: clamp(round(finite(v[1], 0.0)), 0.0, 3.0) as u32,
            hop: clamp(
                round(finite(v[2], size as f64 * 0.25) / 32.0) * 32.0,
                32.0,
                size as f64,
            ) as usize,
            bands: clamp(
                round(finite(v[3], 96.0) / 4.0) * 4.0,
                16.0,
                MAX_FFT_BANDS as f64,
            ) as usize,
            low,
            high: clamp(finite(v[5], 12000.0), low * 2.0, sample_rate * 0.45),
            response: clamp(finite(v[6], 0.038), 0.004, 0.8),
            detail: clamp(finite(v[7], 0.9), 0.0, 1.0),
            input_gain: clamp(finite(v[9], 1.4), 0.25, 4.0),
            gate_db: clamp(finite(v[10], -72.0), -96.0, -30.0),
        }
    }
    fn matches(&self, other: &Self) -> bool {
        self.size == other.size
            && self.window == other.window
            && self.hop == other.hop
            && self.bands == other.bands
            && self.low == other.low
            && self.high == other.high
    }
}
#[derive(Clone, Copy)]
struct Spatial {
    enabled: bool,
    count: usize,
    target: u32,
    pattern: u32,
    span: f64,
    offset: f64,
    phase: f64,
}
impl Spatial {
    const fn zero() -> Self {
        Self {
            enabled: false,
            count: 0,
            target: 0,
            pattern: 0,
            span: 0.0,
            offset: 0.0,
            phase: 0.0,
        }
    }
    const fn defaults() -> Self {
        Self {
            enabled: false,
            count: 8,
            target: 0,
            pattern: 0,
            span: 1.0,
            offset: 0.0,
            phase: 0.0,
        }
    }
    fn from_values(v: &[f64; 8]) -> Self {
        Self {
            enabled: v[0].is_finite() && v[0] != 0.0,
            count: clamp(round(finite(v[1], 8.0)), 4.0, 16.0) as usize,
            target: clamp(round(finite(v[2], 0.0)), 0.0, 2.0) as u32,
            pattern: clamp(round(finite(v[3], 0.0)), 0.0, 3.0) as u32,
            span: clamp(finite(v[4], 1.0), 0.0, 4.0),
            offset: clamp(finite(v[5], 0.0), 0.0, 1.0),
            phase: wrap(finite(v[6], 0.0)),
        }
    }
}
fn scattered(index: u32) -> f64 {
    if index == 0 {
        return 0.0;
    }
    let mut value = (index ^ 0x9e3779b9).wrapping_mul(0x85ebca6b);
    value ^= value >> 13;
    value = value.wrapping_mul(0xc2b2ae35);
    value ^= value >> 16;
    value as f64 / 4294967296.0
}
fn spatial_position(index: f64, count: usize, s: Spatial) -> f64 {
    if s.target == 1 {
        return 0.0;
    }
    let denominator = count.max(1) as f64;
    let mut rank = index;
    if s.pattern == 1 {
        rank = -index;
    } else if s.pattern == 2 {
        let whole = index.floor() as usize;
        let part = index - whole as f64;
        let first = if whole % 2 != 0 {
            denominator - 1.0 - (whole / 2) as f64
        } else {
            (whole / 2) as f64
        };
        let second = if (whole + 1) % 2 != 0 {
            denominator - 1.0 - ((whole + 1) / 2) as f64
        } else {
            ((whole + 1) / 2) as f64
        };
        let mut delta = second - first;
        delta -= round(delta / denominator) * denominator;
        rank = first + delta * part;
    } else if s.pattern == 3 {
        let whole = index.floor() as u32;
        let part = index - whole as f64;
        let first = scattered(whole);
        let second = scattered(whole + 1);
        let delta = second - first - round(second - first);
        rank = (first + delta * part) * denominator;
    }
    wrap(rank / denominator * s.span + s.offset + s.phase)
}

// Every transform uses the same stage twiddles. Compute the historical f64
// recurrence once at initialization rather than inside every butterfly of each
// spatial inverse transform. The tables are immutable during rendering.
struct TransformTables {
    real: [f64; MAX_FFT_SIZE],
    imaginary: [f64; MAX_FFT_SIZE],
    reversed: [u32; MAX_FFT_SIZE],
}
static mut TABLES: TransformTables = TransformTables {
    real: [0.0; MAX_FFT_SIZE],
    imaginary: [0.0; MAX_FFT_SIZE],
    reversed: [0; MAX_FFT_SIZE],
};
fn initialize_tables() {
    let t = unsafe { &mut *core::ptr::addr_of_mut!(TABLES) };
    for index in 0..MAX_FFT_SIZE {
        t.reversed[index] = (index as u32).reverse_bits() >> (32 - MAX_FFT_SIZE.trailing_zeros());
    }
    let mut width = 2;
    while width <= MAX_FFT_SIZE {
        let half = width / 2;
        let root_real = (-TAU / width as f64).cos();
        let root_imaginary = (-TAU / width as f64).sin();
        let mut real = 1.0;
        let mut imaginary = 0.0;
        for index in 0..half {
            t.real[half - 1 + index] = real;
            t.imaginary[half - 1 + index] = imaginary;
            let next = real * root_real - imaginary * root_imaginary;
            imaginary = real * root_imaginary + imaginary * root_real;
            real = next;
        }
        width *= 2;
    }
}
fn transform(
    real: &mut [f64; MAX_FFT_SIZE],
    imaginary: &mut [f64; MAX_FFT_SIZE],
    size: usize,
    inverse: bool,
) {
    let tables = unsafe { &*core::ptr::addr_of!(TABLES) };
    let shift = MAX_FFT_SIZE.trailing_zeros() - size.trailing_zeros();
    for index in 1..size {
        let reversed = (tables.reversed[index] >> shift) as usize;
        if index < reversed {
            real.swap(index, reversed);
            imaginary.swap(index, reversed);
        }
    }
    let direction = if inverse { -1.0 } else { 1.0 };
    let mut width = 2;
    while width <= size {
        let half = width >> 1;
        let table_start = half - 1;
        let mut offset = 0;
        while offset < size {
            let mut index = 0;
            #[cfg(feature = "simd")]
            if half >= 2 {
                use core::arch::wasm32::*;
                // SAFETY: every stage partitions the bounded power-of-two size;
                // half>=2 is even, so both neighboring butterflies are complete.
                // Arrays are disjoint; unaligned Wasm loads are permitted.
                unsafe {
                    let sign = f64x2_splat(direction);
                    while index < half {
                        let even = offset + index;
                        let odd = even + half;
                        let tr = v128_load(tables.real.as_ptr().add(table_start + index).cast());
                        let ti = f64x2_mul(
                            v128_load(tables.imaginary.as_ptr().add(table_start + index).cast()),
                            sign,
                        );
                        let r = v128_load(real.as_ptr().add(odd).cast());
                        let im = v128_load(imaginary.as_ptr().add(odd).cast());
                        let or = f64x2_sub(f64x2_mul(r, tr), f64x2_mul(im, ti));
                        let oi = f64x2_add(f64x2_mul(r, ti), f64x2_mul(im, tr));
                        let er = v128_load(real.as_ptr().add(even).cast());
                        let ei = v128_load(imaginary.as_ptr().add(even).cast());
                        v128_store(real.as_mut_ptr().add(even).cast(), f64x2_add(er, or));
                        v128_store(imaginary.as_mut_ptr().add(even).cast(), f64x2_add(ei, oi));
                        v128_store(real.as_mut_ptr().add(odd).cast(), f64x2_sub(er, or));
                        v128_store(imaginary.as_mut_ptr().add(odd).cast(), f64x2_sub(ei, oi));
                        index += 2;
                    }
                }
            }
            while index < half {
                let tr = tables.real[table_start + index];
                let ti = tables.imaginary[table_start + index] * direction;
                let even = offset + index;
                let odd = even + half;
                let or = real[odd] * tr - imaginary[odd] * ti;
                let oi = real[odd] * ti + imaginary[odd] * tr;
                let er = real[even];
                let ei = imaginary[even];
                real[even] = er + or;
                imaginary[even] = ei + oi;
                real[odd] = er - or;
                imaginary[odd] = ei - oi;
                index += 1;
            }
            offset += width;
        }
        width *= 2;
    }
    if inverse {
        let scale = 1.0 / size as f64;
        for index in 0..size {
            real[index] *= scale;
            imaginary[index] *= scale;
        }
    }
}

struct Bank {
    sample_rate: f64,
    configuration: Configuration,
    configured: bool,
    analysis_ring: [f64; MAX_FFT_SIZE],
    real: [f64; MAX_FFT_SIZE],
    imaginary: [f64; MAX_FFT_SIZE],
    window: [f64; MAX_FFT_SIZE],
    window_sum: f64,
    ola: [f64; OLA_SIZE],
    normalization: [f64; OLA_SIZE],
    power: [f64; MAX_FFT_BANDS],
    weight: [f64; MAX_FFT_BANDS],
    magnitude: [f64; MAX_FFT_BANDS],
    envelope: [f64; MAX_FFT_BANDS],
    input_telemetry: [f32; MAX_FFT_BANDS],
    output_telemetry: [f32; MAX_FFT_BANDS],
    write: usize,
    fill: usize,
    hop_counter: usize,
    read: usize,
    frames: u32,
    age: usize,
    has_frame: bool,
    detail: f64,
    response: f64,
    gate_db: f64,
    input_gain: f64,
    input_gain_step: f64,
    spatial: Spatial,
    spatial_ola: [f64; OLA_SIZE * CHANNELS],
    spatial_sample: [f32; CHANNELS],
    spatial_real: [f64; MAX_FFT_SIZE],
    spatial_imaginary: [f64; MAX_FFT_SIZE],
    positions: [f64; MAX_FFT_SIZE / 2],
    positions_ready: bool,
    left: [usize; MAX_FFT_SIZE / 2],
    right: [usize; MAX_FFT_SIZE / 2],
    left_gain: [f64; MAX_FFT_SIZE / 2],
    right_gain: [f64; MAX_FFT_SIZE / 2],
    // Topology-only bin geometry avoids repeating logarithms in every analysis.
    bin_left: [usize; MAX_FFT_SIZE / 2],
    bin_right: [usize; MAX_FFT_SIZE / 2],
    bin_right_weight: [f64; MAX_FFT_SIZE / 2],
    bin_active: [bool; MAX_FFT_SIZE / 2],
}
impl Bank {
    const fn new() -> Self {
        Self {
            sample_rate: 0.0,
            configuration: Configuration::zero(),
            configured: false,
            analysis_ring: [0.0; MAX_FFT_SIZE],
            real: [0.0; MAX_FFT_SIZE],
            imaginary: [0.0; MAX_FFT_SIZE],
            window: [0.0; MAX_FFT_SIZE],
            window_sum: 0.0,
            ola: [0.0; OLA_SIZE],
            normalization: [0.0; OLA_SIZE],
            power: [0.0; MAX_FFT_BANDS],
            weight: [0.0; MAX_FFT_BANDS],
            magnitude: [0.0; MAX_FFT_BANDS],
            envelope: [0.0; MAX_FFT_BANDS],
            input_telemetry: [0.0; MAX_FFT_BANDS],
            output_telemetry: [0.0; MAX_FFT_BANDS],
            write: 0,
            fill: 0,
            hop_counter: 0,
            read: 0,
            frames: 0,
            age: 0,
            has_frame: false,
            detail: 0.0,
            response: 0.0,
            gate_db: 0.0,
            input_gain: 0.0,
            input_gain_step: 0.0,
            spatial: Spatial::zero(),
            spatial_ola: [0.0; OLA_SIZE * CHANNELS],
            spatial_sample: [0.0; CHANNELS],
            spatial_real: [0.0; MAX_FFT_SIZE],
            spatial_imaginary: [0.0; MAX_FFT_SIZE],
            positions: [0.0; MAX_FFT_SIZE / 2],
            positions_ready: false,
            left: [0; MAX_FFT_SIZE / 2],
            right: [0; MAX_FFT_SIZE / 2],
            left_gain: [0.0; MAX_FFT_SIZE / 2],
            right_gain: [0.0; MAX_FFT_SIZE / 2],
            bin_left: [0; MAX_FFT_SIZE / 2],
            bin_right: [0; MAX_FFT_SIZE / 2],
            bin_right_weight: [0.0; MAX_FFT_SIZE / 2],
            bin_active: [false; MAX_FFT_SIZE / 2],
        }
    }
    fn reset(&mut self) {
        self.spatial_ola.fill(0.0);
        self.spatial_sample.fill(0.0);
        self.positions_ready = false;
        self.analysis_ring.fill(0.0);
        self.real.fill(0.0);
        self.imaginary.fill(0.0);
        self.ola.fill(0.0);
        self.normalization.fill(0.0);
        self.power.fill(0.0);
        self.weight.fill(0.0);
        self.magnitude.fill(0.0);
        self.envelope.fill(0.0);
        self.input_telemetry.fill(0.0);
        self.output_telemetry.fill(0.0);
        self.write = 0;
        self.fill = 0;
        self.hop_counter = 0;
        self.read = 0;
        self.frames = 0;
        self.age = 0;
        self.has_frame = false;
    }
    fn configure(&mut self, next: Configuration) {
        let rebuild = !self.configured || !self.configuration.matches(&next);
        self.configuration = next;
        if rebuild {
            let mut sum = 0.0;
            for index in 0..next.size {
                let phase = TAU * index as f64 / next.size as f64;
                let value = match next.window {
                    1 => (0.42 - 0.5 * phase.cos() + 0.08 * (phase * 2.0).cos()).max(0.0),
                    2 => (core::f64::consts::PI * (index as f64 + 0.5) / next.size as f64).sin(),
                    3 => 1.0,
                    _ => 0.5 - 0.5 * phase.cos(),
                };
                self.window[index] = value;
                sum += value;
            }
            self.window_sum = sum.max(1e-9);
            let log_low = next.low.ln();
            let log_scale = (next.bands - 1) as f64 / (next.high / next.low).ln();
            for bin in 1..next.size / 2 {
                let frequency = bin as f64 * self.sample_rate / next.size as f64;
                self.bin_active[bin] = frequency >= next.low && frequency <= next.high;
                let position = clamp(
                    (frequency.ln() - log_low) * log_scale,
                    0.0,
                    (next.bands - 1) as f64,
                );
                self.bin_left[bin] = position.floor() as usize;
                self.bin_right[bin] = (self.bin_left[bin] + 1).min(next.bands - 1);
                self.bin_right_weight[bin] = position - self.bin_left[bin] as f64;
            }
            self.reset();
            self.detail = next.detail;
            self.response = next.response;
            self.gate_db = next.gate_db;
            self.input_gain = next.input_gain;
        }
        self.configured = true;
    }
    fn configure_spatial(&mut self, spatial: Spatial) {
        if spatial.enabled && !self.spatial.enabled {
            self.spatial_ola.fill(0.0);
            self.spatial_ola[..OLA_SIZE].copy_from_slice(&self.ola);
            self.positions_ready = false;
        } else if !spatial.enabled && self.spatial.enabled {
            self.spatial_ola.fill(0.0);
            self.spatial_sample.fill(0.0);
        }
        self.spatial = spatial;
    }
    fn prime_input(&mut self, history: &[f32; MAX_FFT_SIZE], write: usize, fill: usize) {
        let count = self.configuration.size.min(fill);
        let start = (write + MAX_FFT_SIZE - count) % MAX_FFT_SIZE;
        for index in 0..count {
            self.analysis_ring[index] =
                history[(start + index) % MAX_FFT_SIZE] as f64 * self.configuration.input_gain;
        }
        self.fill = count;
        self.write = count % self.configuration.size;
        self.hop_counter = self.configuration.hop - 1;
    }
    fn analyze(&mut self) {
        let c = self.configuration;
        let size = c.size;
        let half = size / 2;
        if self.fill < size {
            return;
        }
        for index in 0..size {
            self.real[index] = self.analysis_ring[(self.write + index) % size] * self.window[index];
            self.imaginary[index] = 0.0;
        }
        transform(&mut self.real, &mut self.imaginary, size, false);
        self.power[..c.bands].fill(0.0);
        self.weight[..c.bands].fill(0.0);
        for bin in 1..half {
            if !self.bin_active[bin] {
                continue;
            }
            let left = self.bin_left[bin];
            let right = self.bin_right[bin];
            let rw = self.bin_right_weight[bin];
            let lw = 1.0 - rw;
            let power = self.real[bin] * self.real[bin] + self.imaginary[bin] * self.imaginary[bin];
            self.power[left] += power * lw;
            self.weight[left] += lw;
            if right != left {
                self.power[right] += power * rw;
                self.weight[right] += rw;
            }
        }
        let parameter_step = 1.0 - (-(c.hop as f64) / (self.sample_rate * 0.02)).exp();
        self.detail += (c.detail - self.detail) * parameter_step;
        self.response += (c.response - self.response) * parameter_step;
        self.gate_db += (c.gate_db - self.gate_db) * parameter_step;
        let attack_retention = (-(c.hop as f64) / (self.sample_rate * 0.004)).exp();
        let release_retention = (-(c.hop as f64) / (self.sample_rate * self.response)).exp();
        for band in 0..c.bands {
            let magnitude = if self.weight[band] > 1e-9 {
                (self.power[band] / self.weight[band]).sqrt()
            } else {
                0.0
            };
            let normalized = magnitude * 2.0 / self.window_sum;
            let db = 20.0 * normalized.max(1e-12).log10();
            let gate_position = clamp((db - (self.gate_db - 4.0)) / 8.0, 0.0, 1.0);
            let gate = gate_position * gate_position * (3.0 - 2.0 * gate_position);
            let target = magnitude * gate;
            let previous = self.envelope[band];
            let retention = if target > previous {
                attack_retention
            } else {
                release_retention
            };
            let envelope = target + (previous - target) * retention;
            self.magnitude[band] = magnitude;
            self.envelope[band] = envelope;
            self.input_telemetry[band] = clamp((db + 84.0) / 72.0, 0.0, 1.0) as f32;
            let output_db = 20.0 * (envelope * 2.0 / self.window_sum).max(1e-12).log10();
            self.output_telemetry[band] = clamp((output_db + 84.0) / 72.0, 0.0, 1.0) as f32;
        }
        self.input_telemetry[c.bands..].fill(0.0);
        self.output_telemetry[c.bands..].fill(0.0);
        self.real[0] = 0.0;
        self.imaginary[0] = 0.0;
        self.real[half] = 0.0;
        self.imaginary[half] = 0.0;
        for bin in 1..half {
            if !self.bin_active[bin] {
                self.real[bin] = 0.0;
                self.imaginary[bin] = 0.0;
            } else {
                let left = self.bin_left[bin];
                let right = self.bin_right[bin];
                let rw = self.bin_right_weight[bin];
                let lw = 1.0 - rw;
                let raw_band = self.magnitude[left] * lw + self.magnitude[right] * rw;
                let envelope = self.envelope[left] * lw + self.envelope[right] * rw;
                let real = self.real[bin];
                let imaginary = self.imaginary[bin];
                let magnitude = real.hypot(imaginary);
                let detailed = magnitude * envelope / raw_band.max(1e-12);
                let target = detailed * self.detail + envelope * (1.0 - self.detail);
                let gain = if magnitude > 1e-12 {
                    target / magnitude
                } else {
                    0.0
                };
                self.real[bin] = real * gain;
                self.imaginary[bin] = imaginary * gain;
            }
            self.real[size - bin] = self.real[bin];
            self.imaginary[size - bin] = -self.imaginary[bin];
        }
        if self.spatial.enabled && self.spatial.target != 1 {
            self.spatialize(size);
        }
        transform(&mut self.real, &mut self.imaginary, size, true);
        let start = (self.read + 1) & OLA_MASK;
        for index in 0..size {
            let destination = (start + index) & OLA_MASK;
            let window = self.window[index];
            self.ola[destination] += self.real[index] * window;
            if self.spatial.enabled && self.spatial.target == 1 {
                self.spatial_ola[destination] += self.real[index] * window;
            }
            self.normalization[destination] += window * window;
        }
        self.has_frame = true;
        self.frames = self.frames.wrapping_add(1);
    }
    fn spatialize(&mut self, size: usize) {
        let half = size / 2;
        let c = self.configuration;
        let s = self.spatial;
        let log_low = c.low.ln();
        let log_range = (c.high / c.low).ln();
        let approach = 1.0 - (-(c.hop as f64) / (self.sample_rate * 0.025)).exp();
        let mut active = 0u32;
        for bin in 1..half {
            if !self.bin_active[bin] {
                self.left_gain[bin] = 0.0;
                self.right_gain[bin] = 0.0;
                continue;
            }
            // Match the reference's division-then-multiply evaluation order.
            let frequency = bin as f64 * self.sample_rate / size as f64;
            let band =
                clamp((frequency.ln() - log_low) / log_range, 0.0, 1.0) * (c.bands - 1) as f64;
            let target = spatial_position(band, c.bands, s);
            if !self.positions_ready {
                self.positions[bin] = target;
            }
            let mut delta = target - self.positions[bin];
            delta -= round(delta);
            self.positions[bin] = wrap(self.positions[bin] + delta * approach);
            let position = wrap(self.positions[bin]) * s.count as f64;
            let left = (position.floor() as usize).min(s.count - 1);
            let mix = position - left as f64;
            self.left[bin] = left;
            self.right[bin] = (left + 1) % s.count;
            self.left_gain[bin] = (mix * core::f64::consts::PI * 0.5).cos();
            self.right_gain[bin] = (mix * core::f64::consts::PI * 0.5).sin();
            active |= (1 << self.left[bin]) | (1 << self.right[bin]);
        }
        self.positions_ready = true;
        let start = (self.read + 1) & OLA_MASK;
        for channel in (0..s.count).step_by(2) {
            if active & (3 << channel) == 0 {
                continue;
            }
            self.spatial_real[..size].fill(0.0);
            self.spatial_imaginary[..size].fill(0.0);
            for bin in 1..half {
                let gain_a = (if self.left[bin] == channel {
                    self.left_gain[bin]
                } else {
                    0.0
                }) + (if self.right[bin] == channel {
                    self.right_gain[bin]
                } else {
                    0.0
                });
                let gain_b = (if self.left[bin] == channel + 1 {
                    self.left_gain[bin]
                } else {
                    0.0
                }) + (if self.right[bin] == channel + 1 {
                    self.right_gain[bin]
                } else {
                    0.0
                });
                let real = self.real[bin];
                let imaginary = self.imaginary[bin];
                let ar = real * gain_a;
                let ai = imaginary * gain_a;
                let br = real * gain_b;
                let bi = imaginary * gain_b;
                self.spatial_real[bin] = ar - bi;
                self.spatial_imaginary[bin] = ai + br;
                self.spatial_real[size - bin] = ar + bi;
                self.spatial_imaginary[size - bin] = -ai + br;
            }
            transform(
                &mut self.spatial_real,
                &mut self.spatial_imaginary,
                size,
                true,
            );
            let offset_a = channel * OLA_SIZE;
            let offset_b = (channel + 1) * OLA_SIZE;
            for index in 0..size {
                let destination = (start + index) & OLA_MASK;
                let window = self.window[index];
                self.spatial_ola[offset_a + destination] += self.spatial_real[index] * window;
                if channel + 1 < s.count {
                    self.spatial_ola[offset_b + destination] +=
                        self.spatial_imaginary[index] * window;
                }
            }
        }
    }
    fn sample(&mut self, input: f64) -> f64 {
        let c = self.configuration;
        self.input_gain += (c.input_gain - self.input_gain) * self.input_gain_step;
        self.analysis_ring[self.write] = input * self.input_gain;
        self.write = (self.write + 1) % c.size;
        if self.fill < c.size {
            self.fill += 1;
        }
        self.hop_counter += 1;
        if self.fill == c.size && self.hop_counter >= c.hop {
            self.hop_counter = 0;
            self.analyze();
        }
        let normalization = self.normalization[self.read].max(0.05);
        let output = self.ola[self.read] / normalization;
        if self.has_frame {
            self.age = (self.age + 1).min(c.size);
        }
        let warm = self.age as f64 / c.size as f64;
        let startup_gain = warm * warm * (3.0 - 2.0 * warm);
        if self.spatial.enabled {
            for channel in 0..CHANNELS {
                let index = channel * OLA_SIZE + self.read;
                let spatial = self.spatial_ola[index] / normalization;
                self.spatial_sample[channel] =
                    clamp(finite(spatial * startup_gain, 0.0), -2.0, 2.0) as f32;
                self.spatial_ola[index] = 0.0;
            }
        }
        self.ola[self.read] = 0.0;
        self.normalization[self.read] = 0.0;
        self.read = (self.read + 1) & OLA_MASK;
        clamp(finite(output * startup_gain, 0.0), -2.0, 2.0)
    }
}

struct FftState {
    banks: [Bank; 2],
    current: usize,
    transition: bool,
    crossfade: usize,
    crossfade_length: usize,
    configuration: Option<Configuration>,
    queued: Option<Configuration>,
    history: [f32; MAX_FFT_SIZE],
    history_write: usize,
    history_fill: usize,
    spatial: Spatial,
    sample: [f32; CHANNELS],
    config_values: [f64; 11],
    spatial_values: [f64; 8],
    input: [f64; BLOCK_SIZE],
    output: [f64; BLOCK_SIZE],
    spatial_output: [f32; CHANNELS * BLOCK_SIZE],
    status: [f64; 8],
}
impl FftState {
    const fn new() -> Self {
        Self {
            banks: [Bank::new(), Bank::new()],
            current: 0,
            transition: false,
            crossfade: 0,
            crossfade_length: 0,
            configuration: None,
            queued: None,
            history: [0.0; MAX_FFT_SIZE],
            history_write: 0,
            history_fill: 0,
            spatial: Spatial::zero(),
            sample: [0.0; CHANNELS],
            config_values: [0.0; 11],
            spatial_values: [0.0; 8],
            input: [0.0; BLOCK_SIZE],
            output: [0.0; BLOCK_SIZE],
            spatial_output: [0.0; CHANNELS * BLOCK_SIZE],
            status: [0.0; 8],
        }
    }
    fn init(&mut self, sample_rate: f64) {
        let rate = clamp(finite(sample_rate, 48000.0), 8000.0, 384000.0);
        self.current = 0;
        self.configuration = None;
        self.queued = None;
        self.spatial = Spatial::defaults();
        self.crossfade_length = round(rate * 0.024) as usize;
        self.config_values = [
            1024.0, 0.0, 256.0, 96.0, 70.0, 12000.0, 0.038, 0.9, 0.94, 1.4, -72.0,
        ];
        self.spatial_values = [0.0, 8.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
        for bank in &mut self.banks {
            bank.sample_rate = rate;
            bank.configured = false;
            bank.configuration = Configuration::defaults();
            bank.spatial = Spatial::defaults();
            bank.input_gain_step = 1.0 - (-1.0 / (rate * 0.012)).exp();
        }
        self.reset();
    }
    fn reset(&mut self) {
        self.banks[0].reset();
        self.banks[1].reset();
        self.transition = false;
        self.crossfade = 0;
        self.queued = None;
        self.history.fill(0.0);
        self.history_fill = 0;
        self.history_write = 0;
        self.sample.fill(0.0);
        self.input.fill(0.0);
        self.output.fill(0.0);
        self.spatial_output.fill(0.0);
        if let Some(configuration) = self.configuration {
            self.banks[self.current].configure(configuration);
        }
    }
    fn configure(&mut self) {
        let next =
            Configuration::from_values(&self.config_values, self.banks[self.current].sample_rate);
        self.configuration = Some(next);
        if !self.banks[self.current].configured || self.history_fill == 0 {
            self.banks[self.current].configure(next);
            self.queued = None;
            return;
        }
        let destination = if self.transition {
            1 - self.current
        } else {
            self.current
        };
        if self.banks[destination].configuration.matches(&next) {
            self.banks[destination].configure(next);
            self.queued = None;
        } else {
            self.queued = Some(next);
            self.begin_transition();
        }
    }
    fn begin_transition(&mut self) {
        if self.transition {
            return;
        }
        if let Some(next) = self.queued.take() {
            let spare = &mut self.banks[1 - self.current];
            spare.configure(next);
            spare.reset();
            spare.prime_input(&self.history, self.history_write, self.history_fill);
            spare.configure_spatial(self.spatial);
            self.transition = true;
            self.crossfade = 0;
        }
    }
    fn sample(&mut self, input: f64) -> f64 {
        self.history[self.history_write] = input as f32;
        self.history_write = (self.history_write + 1) % MAX_FFT_SIZE;
        self.history_fill = (self.history_fill + 1).min(MAX_FFT_SIZE);
        let previous = self.banks[self.current].sample(input);
        self.sample
            .copy_from_slice(&self.banks[self.current].spatial_sample);
        if !self.transition {
            return previous;
        }
        let spare = &mut self.banks[1 - self.current];
        let next = spare.sample(input);
        if spare.age < spare.configuration.size {
            return previous;
        }
        self.crossfade += 1;
        let fraction = (self.crossfade as f64 / self.crossfade_length as f64).min(1.0);
        let blend = fraction * fraction * (3.0 - 2.0 * fraction);
        let output = previous + (next - previous) * blend;
        for channel in 0..CHANNELS {
            self.sample[channel] = (self.sample[channel] as f64
                + (spare.spatial_sample[channel] as f64 - self.sample[channel] as f64) * blend)
                as f32;
        }
        if fraction >= 1.0 {
            self.current = 1 - self.current;
            self.transition = false;
        }
        output
    }
    fn update_status(&mut self) {
        let c = self.queued.unwrap_or(
            self.banks[if self.transition {
                1 - self.current
            } else {
                self.current
            }]
            .configuration,
        );
        self.status = [
            c.size as f64,
            c.hop as f64,
            c.bands as f64,
            self.banks[self.current].fill as f64,
            (self.banks[0].frames as f64 + self.banks[1].frames as f64),
            self.current as f64,
            if self.transition { 1.0 } else { 0.0 },
            self.crossfade as f64,
        ];
    }
}
// Every byte starts at zero so the 10 MiB fixed arrays occupy Wasm BSS,
// not an equally large downloaded data segment. fft_init supplies defaults.
static mut STATE: FftState = FftState::new();
// Every entry is synchronous and exclusively owned by its AudioWorklet instance.
#[inline]
fn state() -> &'static mut FftState {
    unsafe { &mut *core::ptr::addr_of_mut!(STATE) }
}
#[no_mangle]
pub extern "C" fn fft_max_size() -> u32 {
    MAX_FFT_SIZE as u32
}
#[no_mangle]
pub extern "C" fn fft_max_bands() -> u32 {
    MAX_FFT_BANDS as u32
}
#[no_mangle]
pub extern "C" fn fft_init(sample_rate: f64) {
    initialize_tables();
    state().init(sample_rate);
}
#[no_mangle]
pub extern "C" fn fft_reset() {
    state().reset();
}
#[no_mangle]
pub extern "C" fn fft_config_ptr() -> *mut f64 {
    state().config_values.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_configure() {
    state().configure();
}
#[no_mangle]
pub extern "C" fn fft_spatial_config_ptr() -> *mut f64 {
    state().spatial_values.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_configure_spatial() {
    let s = state();
    s.spatial = Spatial::from_values(&s.spatial_values);
    s.banks[0].configure_spatial(s.spatial);
    s.banks[1].configure_spatial(s.spatial);
}
#[no_mangle]
pub extern "C" fn fft_begin_transition() {
    state().begin_transition();
}
#[no_mangle]
pub extern "C" fn fft_prime_silence() {
    let s = state();
    let bank = &mut s.banks[s.current];
    if s.history_fill != 0 || !bank.configured {
        return;
    }
    s.history_fill = MAX_FFT_SIZE;
    bank.fill = bank.configuration.size;
    bank.age = bank.configuration.size;
    bank.has_frame = true;
}
#[no_mangle]
pub extern "C" fn fft_input_ptr() -> *mut f64 {
    state().input.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_output_ptr() -> *mut f64 {
    state().output.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_spatial_output_ptr() -> *mut f32 {
    state().spatial_output.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_status_ptr() -> *mut f64 {
    let s = state();
    s.update_status();
    s.status.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_input_telemetry_ptr(which: u32) -> *mut f32 {
    let s = state();
    let bank = if which == 1 || which == 2 {
        (which - 1) as usize
    } else {
        s.current
    };
    s.banks[bank].input_telemetry.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_output_telemetry_ptr(which: u32) -> *mut f32 {
    let s = state();
    let bank = if which == 1 || which == 2 {
        (which - 1) as usize
    } else {
        s.current
    };
    s.banks[bank].output_telemetry.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn fft_process(frames: u32) {
    let s = state();
    s.begin_transition();
    for frame in 0..(frames as usize).min(BLOCK_SIZE) {
        s.output[frame] = s.sample(finite(s.input[frame], 0.0));
        for channel in 0..CHANNELS {
            s.spatial_output[channel * BLOCK_SIZE + frame] = s.sample[channel];
        }
    }
}
#[no_mangle]
pub extern "C" fn fft_state_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(STATE).cast()
}
#[no_mangle]
pub extern "C" fn fft_state_bytes() -> u32 {
    core::mem::size_of::<FftState>() as u32
}

#[no_mangle]
pub extern "C" fn fft_history_fill() -> u32 {
    state().history_fill as u32
}
