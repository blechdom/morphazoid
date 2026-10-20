//! Fixed-memory source excitation, filtering, delay networks and final mixing.
//! f64 state mirrors the previous AudioWorklet arithmetic; delay storage stays f32.
use crate::{BLOCK_SIZE, BUFFERS, MAX_SPATIAL_CHANNELS};
const CHANNELS: usize = MAX_SPATIAL_CHANNELS + 2;
const MAX_DELAY: usize = 22_000; // 384 kHz × 43.7 ms × (1 + 17 × 0.017), rounded.
const SQRT2: f64 = core::f64::consts::SQRT_2;
const PI: f64 = core::f64::consts::PI;
#[inline]
fn finite(x: f64) -> f64 {
    if x.is_finite() {
        x
    } else {
        0.0
    }
}
#[inline]
fn bounded(x: f64, lo: f64, hi: f64) -> f64 {
    finite(x).clamp(lo, hi)
}

#[repr(C)]
struct Excitation {
    next: usize,
    seed: u32,
    age: [usize; 8],
    length: [usize; 8],
    kind: [u32; 8],
    level: [f64; 8],
    pink_a: [f64; 8],
    pink_b: [f64; 8],
    pink_c: [f64; 8],
    lowpass: [f64; 8],
}
impl Excitation {
    fn reset(&mut self) {
        self.next = 0;
        self.seed = 0x12345678;
        self.length.fill(0);
        self.age.fill(0);
        self.pink_a.fill(0.);
        self.pink_b.fill(0.);
        self.pink_c.fill(0.);
        self.lowpass.fill(0.);
    }
    fn trigger(&mut self, rate: f64, kind: u32, strength: f64, duration: f64) {
        let i = self.next;
        self.next = (i + 1) % 8;
        self.age[i] = 0;
        self.kind[i] = kind.min(5);
        self.length[i] = if kind == 0 {
            1
        } else {
            (duration * rate / 1000.).round().max(2.) as usize
        };
        let n = self.length[i] as f64;
        self.level[i] = strength
            * if kind == 0 {
                1.
            } else if kind == 5 {
                6f64.min(24. / n.sqrt())
            } else {
                1f64.min(6. / n.sqrt())
            };
        self.pink_a[i] = 0.;
        self.pink_b[i] = 0.;
        self.pink_c[i] = 0.;
        self.lowpass[i] = 0.;
    }
    fn noise(&mut self) -> f64 {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        x as f64 / 2147483648. - 1.
    }
    fn sample(&mut self, rate: f64) -> f64 {
        let mut result = 0.;
        for i in 0..8 {
            let n = self.length[i];
            let age = self.age[i];
            if age >= n {
                continue;
            }
            let kind = self.kind[i];
            let t = age as f64 / (n - 1).max(1) as f64;
            let mut value = if kind == 0 {
                1.
            } else if kind == 4 {
                (PI * t).sin().powi(2)
            } else if kind == 5 {
                (PI * t).sin() * (-8. * t).exp()
            } else {
                let white = self.noise();
                if kind == 2 {
                    self.pink_a[i] = 0.997 * self.pink_a[i] + 0.03 * white;
                    self.pink_b[i] = 0.95 * self.pink_b[i] + 0.12 * white;
                    self.pink_c[i] = 0.6 * self.pink_c[i] + 0.4 * white;
                    self.pink_a[i] + self.pink_b[i] + self.pink_c[i] + 0.15 * white
                } else if kind == 3 {
                    self.lowpass[i] += 0.35 * (white - self.lowpass[i]);
                    self.lowpass[i]
                } else {
                    white
                }
            };
            if kind > 0 && kind < 4 {
                let attack = 1f64.min(age as f64 / 1f64.max((n as f64 * 0.08).min(rate * 0.0008)));
                value *= attack
                    * if kind == 3 {
                        (-6. * t).exp() * (1. - t)
                    } else {
                        (PI * t).sin()
                    };
            }
            result += value * self.level[i];
            self.age[i] = age + 1;
        }
        result.clamp(-2., 2.)
    }
}

#[repr(C)]
struct Room<const L: usize> {
    lines: [[f32; MAX_DELAY]; L],
    lengths: [usize; L],
    positions: [usize; L],
    feedback: [f64; L],
    feedback_target: [f64; L],
    memory: [f64; L],
    remaining: [f64; CHANNELS],
    tail_length: f64,
    damping: f64,
    damping_target: f64,
    step: f64,
}
impl<const L: usize> Room<L> {
    fn init(&mut self, rate: f64) {
        for i in 0..L {
            self.lengths[i] =
                (rate * [0.0297, 0.0371, 0.0411, 0.0437][i % 4] * (1. + (i / 4) as f64 * 0.017))
                    .round()
                    .clamp(2., MAX_DELAY as f64) as usize;
        }
        self.step = 1. - (-1. / (rate * 0.025)).exp();
    }
    fn configure(&mut self, rate: f64, time: f64, damping: f64, immediate: bool) {
        self.damping_target = damping;
        self.tail_length = (rate * (time * 2. + 0.5)).ceil();
        for i in 0..L {
            self.feedback_target[i] =
                (-1000f64.ln() * self.lengths[i] as f64 / (rate * time)).exp();
        }
        if immediate {
            self.feedback = self.feedback_target;
            self.damping = damping;
        }
    }
    fn reset(&mut self) {
        for line in &mut self.lines {
            line.fill(0.);
        }
        self.positions.fill(0);
        self.memory.fill(0.);
        self.remaining.fill(0.);
    }
    fn advance(&mut self) {
        self.damping += (self.damping_target - self.damping) * self.step;
    }
    fn process(&mut self, channel: usize, input: f64) -> f64 {
        if input.abs() > 1e-12 {
            self.remaining[channel] = self.tail_length;
        } else if self.remaining[channel] <= 0. {
            return 0.;
        } else {
            self.remaining[channel] -= 1.;
        }
        let offset = channel * 4;
        let mut values = [0.; 4];
        let mut sum = 0.;
        for i in 0..4 {
            let j = offset + i;
            let sample = self.lines[j][self.positions[j]] as f64;
            let value = sample * (1. - self.damping) + self.memory[j] * self.damping;
            values[i] = if value.abs() < 1e-20 { 0. } else { value };
            self.memory[j] = values[i];
            sum += value;
        }
        for i in 0..4 {
            let j = offset + i;
            self.feedback[j] += (self.feedback_target[j] - self.feedback[j]) * self.step;
            self.lines[j][self.positions[j]] = bounded(
                (values[i] - sum * 0.5) * self.feedback[j]
                    + input * if i % 2 != 0 { -0.35 } else { 0.35 },
                -4.,
                4.,
            ) as f32;
            self.positions[j] = (self.positions[j] + 1) % self.lengths[j];
        }
        (values[0] + values[1] - values[2] - values[3]) * 0.7
    }
}

// config: body/processing/fft/reverb enabled, body/fft/wet mixes, filter index,
// cutoff,drive,time,damping,room mix,stage order index.
#[repr(C)]
struct Signal {
    rate: f64,
    config: [f64; 14],
    excitation: Excitation,
    room: Room<72>,
    early: Room<4>,
    step: f64,
    body_mix: f64,
    fft_mix: f64,
    wet_mix: f64,
    processing_mix: f64,
    reverb_mix: f64,
    source_reverb_mix: f64,
    drive: f64,
    g: f64,
    g_target: f64,
    ic1: [f64; 38],
    ic2: [f64; 38],
    composite: [f64; CHANNELS],
    weights: [f64; 4],
    target_weights: [f64; 4],
    post_weights: [f64; 4],
    post_g: f64,
    post_drive: f64,
    post_processing: f64,
    positions: [f64; 4],
    target_positions: [f64; 4],
    output_positions: [f64; 4],
    room_before: f64,
    room_before_target: f64,
    output_room_before: f64,
    order_remaining: usize,
    order_target: usize,
    order_frames: usize,
    history: [f64; 128 * 12],
    history_write: usize,
    history_read: usize,
    external: [f32; BLOCK_SIZE],
    source: [f32; BLOCK_SIZE],
    processed: [f32; BLOCK_SIZE],
    fft_input: [f64; BLOCK_SIZE],
    spectral: [f32; BLOCK_SIZE],
    spectral_spatial: [f32; BLOCK_SIZE * MAX_SPATIAL_CHANNELS],
    output_left: [f32; BLOCK_SIZE],
    output_right: [f32; BLOCK_SIZE],
    output_spatial: [f32; BLOCK_SIZE * MAX_SPATIAL_CHANNELS],
    stats: [f64; 36],
    legacy_mix: f64,
    legacy_step: f64,
}
// Every field is a primitive number or fixed array thereof. An all-zero
// initializer is valid and keeps the large delay storage in Wasm .bss.
static mut SIGNAL: Signal = unsafe { core::mem::zeroed() };
fn state() -> &'static mut Signal {
    unsafe { &mut *core::ptr::addr_of_mut!(SIGNAL) }
}
impl Signal {
    fn configure(&mut self, immediate: bool) {
        let s = &mut self.config;
        for x in s.iter_mut() {
            *x = finite(*x);
        }
        for i in 0..4 {
            s[i] = if s[i] != 0. { 1. } else { 0. };
        }
        for i in [4, 5, 6, 12] {
            s[i] = s[i].clamp(0., 1.);
        }
        s[7] = s[7].round().clamp(0., 3.);
        s[8] = s[8].clamp(20., 20000.);
        s[9] = s[9].clamp(1., 24.);
        s[10] = s[10].clamp(0.12, 12.);
        s[11] = s[11].clamp(0., 0.98);
        s[13] = s[13].round().clamp(0., 5.);
        self.g_target = (PI * s[8].min(self.rate * 0.45) / self.rate).tan();
        self.target_weights.fill(0.);
        self.target_weights[s[7] as usize] = 1.;
        self.room.configure(self.rate, s[10], s[11], immediate);
        self.early.configure(self.rate, s[10], s[11], immediate);
        let order = s[13] as usize;
        if order != self.order_target || immediate {
            self.target_positions.fill(0.);
            self.target_positions[[0, 0, 1, 2, 3, 3][order]] = 1.;
            self.room_before_target = if [1, 2, 5].contains(&order) { 1. } else { 0. };
            self.order_target = order;
            self.order_remaining = self.order_frames;
        }
        if immediate {
            self.body_mix = s[0] * s[4];
            self.fft_mix = s[2] * s[5];
            self.processing_mix = s[1];
            self.wet_mix = s[6];
            self.reverb_mix = s[3] * s[12];
            self.source_reverb_mix = self.reverb_mix;
            self.drive = s[9];
            self.g = self.g_target;
            self.weights = self.target_weights;
            self.positions = self.target_positions;
            self.output_positions = self.positions;
            self.room_before = self.room_before_target;
            self.output_room_before = self.room_before_target;
            self.order_remaining = 0;
        }
    }
    fn filter(&mut self, slot: usize, raw: f64, placement: f64, post: bool) -> f64 {
        if placement == 0. && slot != 0 {
            self.ic1[slot] = 0.;
            self.ic2[slot] = 0.;
            return raw;
        }
        let g = if post { self.post_g } else { self.g };
        let drive = if post { self.post_drive } else { self.drive };
        let weights = if post {
            self.post_weights
        } else {
            self.weights
        };
        let v1 = (self.ic1[slot] + g * (raw - self.ic2[slot])) / (1. + g * (g + SQRT2));
        let low = self.ic2[slot] + g * v1;
        self.ic1[slot] = bounded(2. * v1 - self.ic1[slot], -8., 8.);
        self.ic2[slot] = bounded(2. * low - self.ic2[slot], -8., 8.);
        let high = raw - SQRT2 * v1 - low;
        let filtered =
            low * weights[0] + high * weights[1] + v1 * SQRT2 * weights[2] + raw * weights[3];
        let saturated = (filtered * drive).tanh() / drive.tanh();
        let driven = filtered + (saturated - filtered) * 1f64.min(drive - 1.);
        raw + (driven - raw)
            * (placement
                * if post {
                    self.post_processing
                } else {
                    self.processing_mix
                })
    }
    fn prepare_sample(&mut self, raw: f64) -> f64 {
        let s = self.config;
        let step = self.step;
        self.processing_mix += (s[1] - self.processing_mix) * step;
        self.drive += (s[9] - self.drive) * step;
        self.g += (self.g_target - self.g) * step;
        for i in 0..4 {
            self.weights[i] += (self.target_weights[i] - self.weights[i]) * step;
        }
        if self.order_remaining > 0 {
            let amount = 1. / self.order_remaining as f64;
            for i in 0..4 {
                self.positions[i] += (self.target_positions[i] - self.positions[i]) * amount;
            }
            self.room_before += (self.room_before_target - self.room_before) * amount;
            self.order_remaining -= 1;
            if self.order_remaining == 0 {
                self.positions = self.target_positions;
                self.room_before = self.room_before_target;
            }
        }
        self.source_reverb_mix += (s[3] * s[12] - self.source_reverb_mix) * step;
        let before = self.filter(0, raw, self.positions[0], false);
        self.early.advance();
        let room = self.early.process(
            0,
            if s[3] != 0. || self.source_reverb_mix > 1e-6 {
                before
            } else {
                0.
            },
        );
        let wet = before + (room - before) * (self.source_reverb_mix * self.room_before);
        let prepared = self.filter(1, wet, self.positions[1], false);
        let offset = self.history_write;
        for i in 0..4 {
            self.history[offset + i] = self.positions[i];
            self.history[offset + 8 + i] = self.weights[i];
        }
        self.history[offset + 4] = self.room_before;
        self.history[offset + 5] = self.g;
        self.history[offset + 6] = self.drive;
        self.history[offset + 7] = self.processing_mix;
        self.history_write = (offset + 12) % self.history.len();
        prepared
    }
    fn advance_mix(&mut self) {
        let o = self.history_read;
        for i in 0..4 {
            self.output_positions[i] = self.history[o + i];
            self.post_weights[i] = self.history[o + 8 + i];
        }
        self.output_room_before = self.history[o + 4];
        self.post_g = self.history[o + 5];
        self.post_drive = self.history[o + 6];
        self.post_processing = self.history[o + 7];
        self.history_read = (o + 12) % self.history.len();
        let s = self.config;
        self.body_mix += (s[0] * s[4] - self.body_mix) * self.step;
        self.fft_mix += (s[2] * s[5] - self.fft_mix) * self.step;
        self.wet_mix += (s[6] - self.wet_mix) * self.step;
        self.reverb_mix += (s[3] * s[12] - self.reverb_mix) * self.step;
        self.room.advance();
    }
    fn mix(
        &mut self,
        ch: usize,
        raw: f64,
        processed: f64,
        modal: f64,
        spectral: f64,
        room_send: f64,
    ) -> f64 {
        let body = processed + (modal - processed) * self.body_mix;
        let combined = body + (spectral - body) * self.fft_mix;
        let before = self.filter(2 + ch, combined, self.output_positions[2], true);
        self.composite[ch] = before;
        let late = 1. - self.output_room_before;
        let room = self.room.process(
            ch,
            if self.config[3] != 0. || self.reverb_mix > 1e-6 {
                (before + room_send) * late
            } else {
                0.
            },
        );
        let wet = before + (room - before) * (self.reverb_mix * late);
        let after = self.filter(20 + ch, wet, self.output_positions[3], true);
        finite(raw + (after - raw) * self.wet_mix)
    }
    fn age(&mut self, ch: usize) {
        self.room.process(ch, 0.);
        self.ic1[ch + 2] = 0.;
        self.ic2[ch + 2] = 0.;
        self.ic1[ch + 20] = 0.;
        self.ic2[ch + 20] = 0.;
    }
}
macro_rules! pointer {
    ($name:ident,$field:ident,$t:ty) => {
        #[no_mangle]
        pub extern "C" fn $name() -> *mut $t {
            unsafe { core::ptr::addr_of_mut!(SIGNAL.$field).cast() }
        }
    };
}
pointer!(signal_config_ptr, config, f64);
pointer!(signal_external_ptr, external, f32);
pointer!(signal_source_ptr, source, f32);
pointer!(signal_processed_ptr, processed, f32);
pointer!(signal_fft_input_ptr, fft_input, f64);
pointer!(signal_spectral_ptr, spectral, f32);
pointer!(signal_spectral_spatial_ptr, spectral_spatial, f32);
pointer!(signal_output_left_ptr, output_left, f32);
pointer!(signal_output_right_ptr, output_right, f32);
pointer!(signal_output_spatial_ptr, output_spatial, f32);
pointer!(signal_stats_ptr, stats, f64);
#[no_mangle]
pub extern "C" fn signal_state_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(SIGNAL).cast()
}
#[no_mangle]
pub extern "C" fn signal_state_bytes() -> usize {
    core::mem::size_of::<Signal>()
}
#[no_mangle]
pub extern "C" fn signal_init(rate: f64) {
    let s = state();
    s.rate = bounded(rate, 8000., 384000.);
    s.config = [
        1., 0., 0., 0., 1., 0.94, 1., 0., 8000., 1., 1.8, 0.45, 0.4, 0.,
    ];
    s.excitation.reset();
    s.step = 1. - (-1. / (s.rate * 0.02)).exp();
    s.legacy_step = 1. - (-1. / (s.rate * 0.012)).exp();
    s.order_frames = (s.rate * 0.025).round().max(1.) as usize;
    s.room.init(s.rate);
    s.early.init(s.rate);
    s.configure(true);
}
#[no_mangle]
pub extern "C" fn signal_configure(immediate: u32) {
    state().configure(immediate != 0);
}
#[no_mangle]
pub extern "C" fn signal_reset() {
    let s = state();
    s.excitation.reset();
    s.room.reset();
    s.early.reset();
    s.ic1.fill(0.);
    s.ic2.fill(0.);
    s.history.fill(0.);
    s.history_read = 0;
    s.history_write = 0;
    s.configure(true);
}
#[no_mangle]
pub extern "C" fn signal_excite(kind: u32, strength: f64, duration: f64) {
    let s = state();
    s.excitation.trigger(
        s.rate,
        kind.min(5),
        bounded(strength, 0., 1.5),
        bounded(duration, 1., 300.),
    );
}
#[no_mangle]
pub extern "C" fn signal_legacy_mix(value: f64) {
    state().legacy_mix = bounded(value, 0., 1.);
}
#[no_mangle]
pub extern "C" fn signal_fft_mix() -> f64 {
    state().fft_mix
}
#[no_mangle]
pub extern "C" fn signal_prepare(frames: u32, enabled: u32, input_active: u32, excite: u32) {
    let frames = (frames as usize).min(BLOCK_SIZE);
    let s = state();
    let b = unsafe { &mut *core::ptr::addr_of_mut!(BUFFERS) };
    for frame in 0..BLOCK_SIZE {
        let external = if frame < frames && input_active != 0 {
            finite(s.external[frame] as f64)
        } else {
            0.
        };
        let excitation = if enabled != 0 && frame < frames && excite != 0 {
            s.excitation.sample(s.rate)
        } else {
            0.
        };
        let raw = if enabled != 0 {
            (external + excitation).clamp(-2., 2.)
        } else {
            external
        };
        let processed = if enabled != 0 && frame < frames {
            s.prepare_sample(raw)
        } else {
            raw
        };
        s.source[frame] = raw as f32;
        s.processed[frame] = processed as f32;
        s.fft_input[frame] = processed;
        b.input[frame] = (processed * 0.34) as f32;
    }
}
#[no_mangle]
pub extern "C" fn signal_mix_block(
    frames: u32,
    enabled: u32,
    spatial: u32,
    speakers: u32,
    transition: i32,
    target_mix: f64,
) {
    let n = (frames as usize).min(BLOCK_SIZE);
    if n == 0 {
        return;
    }
    let s = state();
    let b = unsafe { &*core::ptr::addr_of!(BUFFERS) };
    let count = (speakers as usize).clamp(4, 16);
    s.stats.fill(0.);
    s.output_spatial.fill(0.);
    for f in 0..n {
        s.legacy_mix += (target_mix - s.legacy_mix) * s.legacy_step;
        let modal_gain = (s.legacy_mix * PI * 0.5).cos();
        let spectral_gain = (s.legacy_mix * PI * 0.5).sin() * 0.5;
        let tg = if transition < 0 {
            1. - (f + 1) as f64 / n as f64
        } else if transition > 0 {
            (f + 1) as f64 / n as f64
        } else {
            1.
        };
        let mut a;
        let mut z;
        if enabled != 0 {
            s.advance_mix();
            let raw = s.source[f] as f64;
            let processed = s.processed[f] as f64;
            let fft = s.spectral[f] as f64 * 0.5;
            a = s.mix(
                0,
                raw,
                processed,
                finite(b.output_left[f] as f64) * tg,
                fft,
                0.,
            );
            z = s.mix(
                1,
                raw,
                processed,
                finite(b.output_right[f] as f64) * tg,
                fft,
                0.,
            );
            let scale = 1. / 1f64.max(a.abs() / 0.95).max(z.abs() / 0.95);
            a *= scale;
            z *= scale;
        } else {
            let spectral = s.spectral[f] as f64 * spectral_gain;
            a = (finite(b.output_left[f] as f64) * modal_gain * tg + spectral).clamp(-1., 1.);
            z = (finite(b.output_right[f] as f64) * modal_gain * tg + spectral).clamp(-1., 1.);
        }
        s.output_left[f] = a as f32;
        s.output_right[f] = z as f32;
        let a = s.output_left[f] as f64;
        let z = s.output_right[f] as f64;
        s.stats[0] = s.stats[0].max(a.abs()).max(z.abs());
        s.stats[1] += a * a + z * z;
        if enabled != 0 && spatial == 0 {
            for ch in 2..CHANNELS {
                s.age(ch);
            }
        }
        if spatial != 0 {
            let mut vals = [0f32; 16];
            let mut peak = 0f64;
            let mut total = 0.;
            for ch in 0..16 {
                let i = ch * BLOCK_SIZE + f;
                let mut value = finite(b.spatial_output[i] as f64) * modal_gain * tg
                    + s.spectral_spatial[i] as f64 * spectral_gain;
                if enabled != 0 {
                    let direct = if ch == 0 { 1. } else { 0. };
                    let active = ch < count;
                    value = s.mix(
                        ch + 2,
                        s.source[f] as f64 * direct,
                        s.processed[f] as f64 * direct,
                        if active {
                            finite(b.spatial_output[i] as f64) * tg
                        } else {
                            0.
                        },
                        if active {
                            s.spectral_spatial[i] as f64 * 0.5
                        } else {
                            0.
                        },
                        if active {
                            (s.composite[0] + s.composite[1]) * 0.2 / (count as f64).sqrt()
                        } else {
                            0.
                        },
                    );
                    if !active {
                        value = 0.;
                    }
                }
                vals[ch] = value as f32;
                peak = peak.max(value.abs());
                total += value.abs();
            }
            let scale = 1. / 1f64.max(peak / 0.95).max(total / (0.95 * SQRT2));
            for ch in 0..16 {
                let value = vals[ch] as f64 * scale;
                s.output_spatial[ch * BLOCK_SIZE + f] = value as f32;
                s.stats[2 + ch] = s.stats[2 + ch].max(value.abs());
                s.stats[18 + ch] += value * value / n as f64;
            }
        }
    }
    s.stats[34] = s.legacy_mix;
    s.stats[35] = s.fft_mix;
}

#[no_mangle]
pub extern "C" fn signal_excitation_age_ptr() -> *mut u32 {
    unsafe { core::ptr::addr_of_mut!(SIGNAL.excitation.age).cast() }
}
#[no_mangle]
pub extern "C" fn signal_positions_ptr() -> *mut f64 {
    unsafe { core::ptr::addr_of_mut!(SIGNAL.positions).cast() }
}
#[no_mangle]
pub extern "C" fn signal_target_positions_ptr() -> *mut f64 {
    unsafe { core::ptr::addr_of_mut!(SIGNAL.target_positions).cast() }
}
#[no_mangle]
pub extern "C" fn signal_order_remaining() -> usize {
    state().order_remaining
}
#[no_mangle]
pub extern "C" fn signal_body_mix() -> f64 {
    state().body_mix
}
