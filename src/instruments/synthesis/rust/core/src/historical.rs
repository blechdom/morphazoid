//! Six bounded historical synthesis demonstrations (method IDs 47..=52).
//! The host owns note amplitude, velocity scaling, ADSR, DC rejection and trim.
//! No allocation occurs in prepare/note_on/sample. See catalog.json for controls.
use std::f32::consts::{PI, TAU};

fn unit(x: f32) -> f32 {
    if x.is_finite() {
        x.clamp(0.0, 1.0)
    } else {
        0.0
    }
}
fn linear(lo: f32, hi: f32, x: f32) -> f32 {
    lo + (hi - lo) * unit(x)
}
fn logarithmic(lo: f32, hi: f32, x: f32) -> f32 {
    lo * (hi / lo).powf(unit(x))
}
fn integer(lo: i32, hi: i32, x: f32) -> i32 {
    linear(lo as f32, hi as f32, x).round() as i32
}
fn noise(seed: &mut u32) -> f32 {
    *seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    ((*seed >> 8) as f32 / 8_388_608.0) - 1.0
}
fn lowpass_coefficient(sr: f32, hz: f32) -> f32 {
    1.0 - (-TAU * hz.min(sr * 0.45) / sr).exp()
}

#[derive(Clone, Copy, Default)]
struct Resonator {
    a1: f32,
    a2: f32,
    gain: f32,
    y1: f32,
    y2: f32,
}
impl Resonator {
    fn coefficients(&mut self, sr: f32, hz: f32, bandwidth: f32, peak_normalized: bool) {
        let radius = (-PI * bandwidth / sr).exp();
        let angle = TAU * hz.min(sr * 0.44) / sr;
        self.a1 = 2.0 * radius * angle.cos();
        self.a2 = -radius * radius;
        self.gain = if peak_normalized {
            (1.0 - radius) * (1.0 + radius * radius - 2.0 * radius * (2.0 * angle).cos()).sqrt()
        } else {
            1.0 - self.a1 - self.a2
        };
    }
    fn response(&self, angle: f32) -> f32 {
        let re = 1.0 - self.a1 * angle.cos() - self.a2 * (2.0 * angle).cos();
        let im = self.a1 * angle.sin() + self.a2 * (2.0 * angle).sin();
        self.gain.abs() / (re * re + im * im).sqrt().max(1.0e-12)
    }
    fn next(&mut self, input: f32) -> f32 {
        let y = self.gain * input + self.a1 * self.y1 + self.a2 * self.y2;
        self.y2 = self.y1;
        self.y1 = if y.abs() < 1.0e-20 { 0.0 } else { y };
        y
    }
}

struct FormantVoice {
    cascade: [Resonator; 4],
    parallel: [Resonator; 4],
    phase: f32,
    vibrato: f32,
    source_low: f32,
    frication_low: f32,
    seed: u32,
    cascade_scale: f32,
    tilt_k: f32,
    frication_k: f32,
    cache: [f32; 16],
    valid: bool,
}
impl Default for FormantVoice {
    fn default() -> Self {
        Self {
            cascade: [Resonator::default(); 4],
            parallel: [Resonator::default(); 4],
            phase: 0.0,
            vibrato: 0.0,
            source_low: 0.0,
            frication_low: 0.0,
            seed: 0x78392a15,
            cascade_scale: 1.0,
            tilt_k: 1.0,
            frication_k: 1.0,
            cache: [0.0; 16],
            valid: false,
        }
    }
}
impl FormantVoice {
    fn prepare(&mut self, sr: f32, p: &[f32; 16]) {
        if self.valid && self.cache == *p {
            return;
        }
        self.cache = *p;
        self.valid = true;
        let shift = 2.0_f32.powf(linear(-12.0, 12.0, p[13]) / 12.0);
        let frequencies = [
            logarithmic(200.0, 1000.0, p[1]),
            logarithmic(600.0, 3000.0, p[2]),
            logarithmic(1500.0, 4000.0, p[3]),
            logarithmic(2500.0, 5500.0, p[4]),
        ]
        .map(|f| (f * shift).min(sr * 0.44));
        let widths = [
            logarithmic(30.0, 300.0, p[5]),
            logarithmic(40.0, 400.0, p[6]),
            logarithmic(50.0, 600.0, p[7]),
            logarithmic(50.0, 800.0, p[8]),
        ];
        for i in 0..4 {
            self.cascade[i].coefficients(sr, frequencies[i], widths[i], false);
            self.parallel[i].coefficients(sr, frequencies[i], widths[i], true);
        }
        // Fixed coefficient-dependent headroom, not an envelope or loudness tracker.
        // Evaluate the four intended peaks and their neighboring bandwidth points.
        let mut largest = 1.0_f32;
        for i in 0..4 {
            for offset in [-0.5_f32, 0.0, 0.5] {
                let hz = (frequencies[i] + offset * widths[i]).clamp(10.0, sr * 0.45);
                let angle = TAU * hz / sr;
                let response: f32 = self.cascade.iter().map(|r| r.response(angle)).product();
                largest = largest.max(response);
            }
        }
        self.cascade_scale = 1.0 / largest;
        self.tilt_k = lowpass_coefficient(sr, logarithmic(16000.0, 600.0, p[10]));
        self.frication_k = lowpass_coefficient(sr, 1800.0);
    }
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        let vibrato = (TAU * self.vibrato).sin() * linear(0.0, 100.0, p[14]);
        self.vibrato = (self.vibrato + logarithmic(0.1, 10.0, p[15]) / sr).fract();
        self.phase = (self.phase + frequency * 2.0_f32.powf(vibrato / 1200.0) / sr).fract();
        let open = linear(0.15, 0.85, p[9]);
        // Derivative of a raised-cosine glottal-flow pulse during its open phase.
        let glottal = if self.phase < open {
            (TAU * self.phase / open).sin()
        } else {
            0.0
        };
        let random = noise(&mut self.seed);
        let aspiration = unit(p[11]);
        let source = glottal * (1.0 - aspiration) + random * aspiration;
        self.source_low += self.tilt_k * (source - self.source_low);
        let mut cascade = self.source_low;
        let mut parallel = 0.0;
        for i in 0..4 {
            cascade = self.cascade[i].next(cascade);
            parallel += [1.0, 0.75, 0.5, 0.3][i] * self.parallel[i].next(self.source_low);
        }
        self.frication_low += self.frication_k * (random - self.frication_low);
        let shaped =
            cascade * self.cascade_scale * (1.0 - unit(p[0])) + parallel * 0.55 * unit(p[0]);
        0.65 * (shaped + 0.28 * unit(p[12]) * (random - self.frication_low))
    }
}

#[derive(Default)]
struct Psg {
    clock_phase: f64,
    step: usize,
    age: f64,
}
impl Psg {
    fn timer(frequency: f32, p: &[f32; 16]) -> (f32, i32) {
        let clock = logarithmic(250000.0, 4000000.0, p[0]);
        let grid = integer(1, 16, p[3]);
        let target = clock / (16.0 * frequency.max(1.0)) - 1.0;
        let timer =
            ((target / grid as f32).round() as i32 * grid + integer(-64, 64, p[2])).clamp(8, 2047);
        (clock, timer)
    }
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        let (clock, timer) = Self::timer(frequency, p);
        let rate = clock / (2.0 * (timer + 1) as f32);
        self.clock_phase += (rate / sr) as f64;
        let ticks = self.clock_phase.floor() as usize;
        self.clock_phase -= ticks as f64;
        self.step = (self.step + ticks) & 7;
        let patterns = [0b00000010_u8, 0b00000110, 0b00011110, 0b11111001];
        let bit = (patterns[integer(0, 3, p[1]) as usize] >> self.step) & 1;
        let elapsed = self.age * logarithmic(0.25, 2000.0, p[4]) as f64;
        self.age += 1.0 / sr as f64;
        let phase = elapsed.fract() as f32;
        let envelope = match integer(0, 3, p[5]) {
            0 => 1.0 - phase,
            1 => 1.0 - (2.0 * phase - 1.0).abs(),
            2 => (1.0 - elapsed as f32).max(0.0),
            _ => (elapsed as f32).min(1.0),
        };
        let levels = ((1_u32 << integer(1, 4, p[7])) - 1) as f32;
        let code = (envelope * levels).round().clamp(0.0, levels);
        let normalized = code / levels;
        let log_gain = if code == 0.0 {
            0.0
        } else {
            10.0_f32.powf((normalized - 1.0) * 24.0 / 20.0)
        };
        let curve = normalized + (log_gain - normalized) * unit(p[8]);
        let volume = 1.0 - unit(p[6]) + unit(p[6]) * curve;
        (2.0 * bit as f32 - 1.0) * 0.55 * volume
    }
}

struct Lfsr {
    state: u16,
    phase: f64,
    low: f32,
    output: f32,
    seed_code: u16,
    mode: i32,
    reconstruction: f32,
}
impl Default for Lfsr {
    fn default() -> Self {
        Self {
            state: 1,
            phase: 0.0,
            low: 0.0,
            output: 0.0,
            seed_code: 1,
            mode: 0,
            reconstruction: 1.0,
        }
    }
}
impl Lfsr {
    fn set_seed(&mut self, p: &[f32; 16]) {
        self.mode = integer(0, 2, p[1]);
        self.seed_code = integer(1, 32767, p[2]) as u16;
        let mask = if self.mode == 2 { 127 } else { 32767 };
        self.state = (self.seed_code & mask).max(1);
        self.phase = 0.0;
    }
    fn tick(&mut self) {
        let tap = if self.mode == 1 { 6 } else { 1 };
        let feedback = (self.state ^ (self.state >> tap)) & 1;
        let top = if self.mode == 2 { 6 } else { 14 };
        self.state = (self.state >> 1) | (feedback << top);
    }
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        if self.mode != integer(0, 2, p[1]) || self.seed_code != integer(1, 32767, p[2]) as u16 {
            self.set_seed(p);
        }
        let clock = (frequency * logarithmic(0.25, 256.0, p[0]))
            .min(sr * 8.0)
            .min(192000.0);
        self.phase += (clock / sr) as f64;
        while self.phase >= 1.0 {
            self.phase -= 1.0;
            self.tick();
            let width = if self.mode == 2 { 7 } else { 15 };
            let first = integer(0, 14, p[3]) as usize % width;
            let bits = (integer(1, 8, p[4]) as usize).min(width);
            let mut code = 0_u32;
            for i in 0..bits {
                code |= (((self.state >> ((first + i) % width)) & 1) as u32) << i;
            }
            self.output = 2.0 * code as f32 / ((1_u32 << bits) - 1) as f32 - 1.0;
        }
        self.low += self.reconstruction * (self.output - self.low);
        0.45 * self.low
    }
}

const DELTA_BITS: usize = 2048;
struct Dpcm {
    bits: [u8; DELTA_BITS],
    reference: [f32; DELTA_BITS],
    cache: [f32; 16],
    valid: bool,
    index: usize,
    phase: f64,
    level: i32,
    held: f32,
    low: f32,
    finished: bool,
    reconstruction: f32,
}
impl Default for Dpcm {
    fn default() -> Self {
        Self {
            bits: [0; DELTA_BITS],
            reference: [0.0; DELTA_BITS],
            cache: [0.0; 16],
            valid: false,
            index: 0,
            phase: 0.0,
            level: 64,
            held: 0.0,
            low: 0.0,
            finished: false,
            reconstruction: 1.0,
        }
    }
}
impl Dpcm {
    fn step(level: i32, bit: u8, amount: i32) -> i32 {
        let target = if bit != 0 {
            level + amount
        } else {
            level - amount
        };
        if (0..=127).contains(&target) {
            target
        } else {
            level
        }
    }
    fn prepare(&mut self, sr: f32, p: &[f32; 16]) {
        self.reconstruction = lowpass_coefficient(sr, logarithmic(100.0, 20000.0, p[10]));
        let changed = !self.valid || [0, 2, 3, 5, 6, 7].iter().any(|i| self.cache[*i] != p[*i]);
        self.cache = *p;
        if !changed {
            return;
        }
        self.valid = true;
        let source = integer(0, 4, p[0]);
        let period = integer(16, 256, p[2]) as usize;
        let amount = integer(1, 16, p[3]);
        let mut accumulator = integer(0, 127, p[5]);
        let amplitude = linear(0.05, 1.0, p[6]);
        let bias = linear(-0.5, 0.5, p[7]);
        let mut seed = 0x49283715;
        for i in 0..DELTA_BITS {
            let phase = (i % period) as f32 / period as f32;
            let raw = match source {
                0 => (TAU * phase).sin(),
                1 => 1.0 - 4.0 * (phase - 0.5).abs(),
                2 => 2.0 * phase - 1.0,
                3 => {
                    if phase < 0.2 {
                        1.0
                    } else {
                        -0.25
                    }
                }
                _ => noise(&mut seed) * (-6.0 * i as f32 / DELTA_BITS as f32).exp(),
            };
            let target = (63.5 + 63.5 * (amplitude * raw + bias)).clamp(0.0, 127.0);
            self.reference[i] = 2.0 * target / 127.0 - 1.0;
            let bit = u8::from(target >= accumulator as f32);
            self.bits[i] = bit;
            accumulator = Self::step(accumulator, bit, amount);
        }
    }
    fn trigger(&mut self, p: &[f32; 16]) {
        self.index = 0;
        self.phase = 0.0;
        self.level = integer(0, 127, p[5]);
        self.held = 2.0 * self.level as f32 / 127.0 - 1.0;
        self.finished = false;
    }
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        let clock = (frequency * logarithmic(8.0, 512.0, p[1]))
            .min(sr * 8.0)
            .min(192000.0);
        self.phase += (clock / sr) as f64;
        while self.phase >= 1.0 {
            self.phase -= 1.0;
            if self.finished {
                self.held = 0.0;
                continue;
            }
            self.level = Self::step(self.level, self.bits[self.index], integer(1, 16, p[4]));
            let decoded = 2.0 * self.level as f32 / 127.0 - 1.0;
            self.held = decoded + (self.reference[self.index] - decoded) * unit(p[11]);
            self.index += 1;
            if self.index == DELTA_BITS {
                self.index = 0;
                if p[8] >= 0.5 {
                    self.finished = true;
                } else if p[9] >= 0.5 {
                    self.level = integer(0, 127, p[5]);
                }
            }
        }
        self.low += self.reconstruction * (self.held - self.low);
        0.6 * self.low
    }
}

#[derive(Default)]
struct Bytebeat {
    counter: u32,
    phase: f64,
    held: f32,
    low: f32,
    reconstruction: f32,
}
impl Bytebeat {
    fn expression(formula: i32, t: u32, a: u32, b: u32) -> u32 {
        let sa = t.wrapping_shr(a & 31);
        let sb = t.wrapping_shr(b & 31);
        match formula {
            0 => t,
            1 => t & sa,
            2 => t.wrapping_mul(sa | sb),
            3 => t.wrapping_mul(sa & 7) ^ sb,
            4 => sa ^ sb ^ t,
            5 => t.wrapping_mul(sa | sb) & t.wrapping_shr(3),
            6 => (t.wrapping_mul(3) & sa) | (t.wrapping_mul(5) & sb),
            _ => t.wrapping_mul(sa).wrapping_add(sb | t),
        }
    }
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        let clock = (logarithmic(1000.0, 48000.0, p[1]) * frequency / 220.0)
            .min(sr * 8.0)
            .min(192000.0);
        self.phase += (clock / sr) as f64;
        while self.phase >= 1.0 {
            self.phase -= 1.0;
            let t = self.counter.wrapping_mul(integer(1, 16, p[2]) as u32);
            let value = Self::expression(
                integer(0, 7, p[0]),
                t,
                integer(0, 15, p[3]) as u32,
                integer(0, 15, p[4]) as u32,
            );
            let code =
                ((value & integer(0, 255, p[5]) as u32) ^ integer(0, 255, p[6]) as u32) & 255;
            let bits = integer(1, 8, p[7]) as u32;
            let quantized = code >> (8 - bits);
            self.held = 2.0 * quantized as f32 / ((1_u32 << bits) - 1) as f32 - 1.0;
            self.counter = self.counter.wrapping_add(1);
        }
        self.low += self.reconstruction * (self.held - self.low);
        0.5 * self.low
    }
}

#[derive(Default)]
struct Chebyshev {
    phase: f32,
    age: f32,
}
impl Chebyshev {
    fn next(&mut self, sr: f32, frequency: f32, p: &[f32; 16]) -> f32 {
        let phase = self.phase + unit(p[10]);
        self.phase = (self.phase + frequency / sr).fract();
        let envelope = (-self.age / logarithmic(0.005, 4.0, p[12])).exp();
        self.age += 1.0 / sr;
        let index = unit(p[8]) + (1.0 - unit(p[8])) * unit(p[11]) * envelope;
        let bias = linear(-0.5, 0.5, p[9]);
        let x = (((TAU * phase).cos() + bias) * index / (1.0 + bias.abs())).clamp(-1.0, 1.0);
        let mut previous = 1.0;
        let mut current = x;
        let mut output = 0.0;
        let mut sum = 0.0;
        for value in p.iter().take(8) {
            let coefficient = linear(-1.0, 1.0, *value);
            output += coefficient * current;
            sum += coefficient.abs();
            let next = 2.0 * x * current - previous;
            previous = current;
            current = next;
        }
        0.65 * output / sum.max(1.0)
    }
}

pub struct HistoricalEngine {
    sr: f32,
    method: u32,
    params: [f32; 16],
    frequency: f32,
    voice: FormantVoice,
    psg: Psg,
    lfsr: Lfsr,
    dpcm: Dpcm,
    bytebeat: Bytebeat,
    chebyshev: Chebyshev,
}
impl HistoricalEngine {
    pub fn new(sample_rate: f32) -> Self {
        let sr = if sample_rate.is_finite() {
            sample_rate.clamp(8000.0, 192000.0)
        } else {
            48000.0
        };
        Self {
            sr,
            method: 47,
            params: [0.0; 16],
            frequency: 220.0,
            voice: FormantVoice::default(),
            psg: Psg::default(),
            lfsr: Lfsr::default(),
            dpcm: Dpcm::default(),
            bytebeat: Bytebeat::default(),
            chebyshev: Chebyshev::default(),
        }
    }
    pub fn reset(&mut self) {
        self.voice = FormantVoice::default();
        self.psg = Psg::default();
        self.lfsr = Lfsr::default();
        self.dpcm = Dpcm::default();
        self.bytebeat = Bytebeat::default();
        self.chebyshev = Chebyshev::default();
        let p = self.params;
        self.prepare(self.method, &p, self.frequency);
    }
    pub fn prepare(&mut self, method: u32, params: &[f32; 16], frequency: f32) {
        self.method = method;
        self.params = params.map(unit);
        self.frequency = if frequency.is_finite() {
            frequency.clamp(20.0, self.sr * 0.2)
        } else {
            220.0
        };
        match method {
            47 => self.voice.prepare(self.sr, &self.params),
            49 => {
                self.lfsr.reconstruction =
                    lowpass_coefficient(self.sr, logarithmic(100.0, 20000.0, self.params[5]))
            }
            50 => self.dpcm.prepare(self.sr, &self.params),
            51 => {
                self.bytebeat.reconstruction =
                    lowpass_coefficient(self.sr, logarithmic(100.0, 20000.0, self.params[8]))
            }
            _ => (),
        }
    }
    pub fn note_on(&mut self, method: u32, frequency: f32, _velocity: f32, params: &[f32; 16]) {
        self.prepare(method, params, frequency);
        match method {
            47 => {
                self.voice.phase = 0.0;
                self.voice.vibrato = 0.0;
            }
            48 => {
                self.psg.age = 0.0;
                if self.params[9] >= 0.5 {
                    self.psg.clock_phase = 0.0;
                    self.psg.step = 0;
                }
            }
            49 => self.lfsr.set_seed(&self.params),
            50 => self.dpcm.trigger(&self.params),
            51 => {
                self.bytebeat.counter = 0;
                self.bytebeat.phase = 0.0;
                self.bytebeat.held = 0.0;
            }
            52 => {
                self.chebyshev.phase = 0.0;
                self.chebyshev.age = 0.0;
            }
            _ => (),
        }
    }
    pub fn sample(&mut self, method: u32, frequency: f32, params: &[f32; 16], _gate: bool) -> f32 {
        // Hosts prepare coefficient/bitstream changes from target controls before
        // rendering. Continuous excitation/readout controls use the smoothed array.
        let frequency = if frequency.is_finite() {
            frequency.clamp(20.0, self.sr * 0.2)
        } else {
            220.0
        };
        let p = params.map(unit);
        let output = match method {
            47 => self.voice.next(self.sr, frequency, &p),
            48 => self.psg.next(self.sr, frequency, &p),
            49 => self.lfsr.next(self.sr, frequency, &p),
            50 => self.dpcm.next(self.sr, frequency, &p),
            51 => self.bytebeat.next(self.sr, frequency, &p),
            52 => self.chebyshev.next(self.sr, frequency, &p),
            _ => 0.0,
        };
        if output.is_finite() {
            output
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod historical_tests;
