//! Actual FFT, LPC analysis, phase-vocoder reconstruction and PADsynth tables.
use std::f32::consts::{PI, TAU};
const FFT_N: usize = 512;
const BINS: usize = FFT_N / 2 + 1;
const FRAMES: usize = 64;
const HOP: usize = 128;
pub const PAD_N: usize = 8192;

pub fn fft(re: &mut [f32], im: &mut [f32], inverse: bool) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let angle = if inverse {
            TAU / len as f32
        } else {
            -TAU / len as f32
        };
        let (wi_step, wr_step) = angle.sin_cos();
        for base in (0..n).step_by(len) {
            let (mut wr, mut wi) = (1.0, 0.0);
            for k in 0..len / 2 {
                let a = base + k;
                let b = a + len / 2;
                let tr = wr * re[b] - wi * im[b];
                let ti = wr * im[b] + wi * re[b];
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let next = wr * wr_step - wi * wi_step;
                wi = wr * wi_step + wi * wr_step;
                wr = next;
            }
        }
        len <<= 1;
    }
    if inverse {
        for i in 0..n {
            re[i] /= n as f32;
            im[i] /= n as f32;
        }
    }
}
fn random(seed: &mut u32) -> f32 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    *seed as f32 / u32::MAX as f32
}
fn phase_wrap(x: f32) -> f32 {
    (x + PI).rem_euclid(TAU) - PI
}
fn source_at(source: &[f32], position: f32) -> f32 {
    if source.len() < 2 {
        return 0.0;
    }
    let p = position.rem_euclid(source.len() as f32);
    let i = p as usize;
    source[i] + (source[(i + 1) % source.len()] - source[i]) * (p - i as f32)
}

pub struct Spectral {
    pub pad: Box<[f32]>,
    pad_im: Box<[f32]>,
    pad_magnitude: Box<[f32]>,
    pub lpc: [f32; 25],
    lpc_history: [f32; 25],
    lpc_gain: f32,
    pub minblep: [f32; 512],
    pv_magnitude: Box<[f32]>,
    pv_frequency: Box<[f32]>,
    pv_analysis_phase: Box<[f32]>,
    pv_phase: [f32; BINS],
    pv_ola: [f32; FFT_N * 2],
    re: [f32; FFT_N],
    im: [f32; FFT_N],
    pv_frame: f32,
    pv_clock: usize,
    pv_hop: usize,
    pv_analysis_hop: f32,
    sample_rate: f32,
    seed: u32,
}
impl Spectral {
    pub fn new(sr: f32) -> Self {
        let mut s = Self {
            pad: vec![0.0; PAD_N].into_boxed_slice(),
            pad_im: vec![0.0; PAD_N].into_boxed_slice(),
            pad_magnitude: vec![0.0; PAD_N].into_boxed_slice(),
            lpc: [0.0; 25],
            lpc_history: [0.0; 25],
            lpc_gain: 0.05,
            minblep: [0.0; 512],
            pv_magnitude: vec![0.0; FRAMES * BINS].into_boxed_slice(),
            pv_frequency: vec![0.0; FRAMES * BINS].into_boxed_slice(),
            pv_analysis_phase: vec![0.0; FRAMES * BINS].into_boxed_slice(),
            pv_phase: [0.0; BINS],
            pv_ola: [0.0; FFT_N * 2],
            re: [0.0; FFT_N],
            im: [0.0; FFT_N],
            pv_frame: 0.0,
            pv_clock: 0,
            pv_hop: 0,
            pv_analysis_hop: 128.0,
            sample_rate: sr,
            seed: 928173,
        };
        s.make_minblep();
        s.make_pad(&[
            0.5,
            0.5,
            0.5,
            0.5,
            47.0 / 95.0,
            0.5,
            0.5,
            0.0,
            0.5,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
        ]);
        s
    }
    pub fn reset(&mut self) {
        self.lpc_history.fill(0.0);
        self.pv_phase.fill(0.0);
        self.pv_ola.fill(0.0);
        self.pv_frame = 0.0;
        self.pv_clock = 0;
        self.pv_hop = 0;
        self.seed = 928173;
    }
    pub fn analyse_lpc(&mut self, source: &[f32], p: &[f32; 16]) {
        // Autocorrelation + Levinson-Durbin; stable reflection coefficients.
        let order = 2 + (p[4] * 22.0).round() as usize;
        let length = (128.0 * 16.0_f32.powf(p[7])).round() as usize;
        let mut frame = [0.0f64; 2048];
        let start = p[0] * source.len().saturating_sub(2048) as f32;
        let stride = 0.65 + 1.05 * p[2];
        let mut previous = source_at(source, start - stride);
        for (i, x) in frame[..length].iter_mut().enumerate() {
            let raw = source_at(source, start + i as f32 * stride);
            *x = (raw - 0.98 * p[5] * previous) as f64
                * (0.5 - 0.5 * (TAU * i as f32 / (length - 1) as f32).cos()) as f64;
            previous = raw;
        }
        let mut corr = [0.0f64; 25];
        for lag in 0..=order {
            for i in lag..length {
                corr[lag] += frame[i] * frame[i - lag];
            }
        }
        corr[0] = corr[0] * 1.0001 + 1.0e-9;
        let mut a = [0.0f64; 25];
        a[0] = 1.0;
        let mut error = corr[0];
        for n in 1..=order {
            let mut sum = corr[n];
            for j in 1..n {
                sum += a[j] * corr[n - j];
            }
            let reflection = (-sum / error.max(1.0e-12)).clamp(-0.985, 0.985);
            let old = a;
            for j in 1..n {
                a[j] = old[j] + reflection * old[n - j];
            }
            a[n] = reflection;
            error *= 1.0 - reflection * reflection;
        }
        let radius = 0.94 + 0.0595 * p[6];
        for (i, coefficient) in a.iter().enumerate() {
            self.lpc[i] = *coefficient as f32 * radius.powi(i as i32);
        }
        self.lpc_gain = ((error / corr[0]).sqrt() as f32).clamp(0.002, 0.8);
    }
    pub fn lpc_sample(&mut self, excitation: f32) -> f32 {
        // Leave headroom for the unit-power pulse train and resonant peaks.
        let mut y = excitation * self.lpc_gain * 0.5;
        for i in 1..25 {
            y -= self.lpc[i] * self.lpc_history[i - 1];
        }
        y = y.clamp(-4.0, 4.0);
        for i in (1..25).rev() {
            self.lpc_history[i] = self.lpc_history[i - 1];
        }
        self.lpc_history[0] = y;
        y
    }
    pub fn make_pad(&mut self, p: &[f32; 16]) {
        self.pad_magnitude.fill(0.0);
        let cents = (2.0 + 88.0 * p[0]) * 0.1 * 100.0_f32.powf(p[8]);
        let partials = 1 + (p[4] * 95.0).round() as usize;
        for harmonic in 1..=partials {
            let hz = 220.0 * (harmonic as f32).powf(0.8 + p[5] * 0.4);
            if hz >= self.sample_rate * 0.46 {
                break;
            }
            let centre = hz * PAD_N as f32 / self.sample_rate;
            let bandwidth = 220.0
                * ((2.0f32).powf(cents / 1200.0) - 1.0)
                * (harmonic as f32).powf(p[2] * 1.8)
                * PAD_N as f32
                / self.sample_rate;
            let sigma = bandwidth.max(0.42);
            let balance = if harmonic % 2 == 0 {
                2.0 * p[6]
            } else {
                2.0 * (1.0 - p[6])
            };
            let amplitude = (harmonic as f32).powf(-0.4 - p[1] * 2.6) * balance;
            let low = (centre - sigma * 5.0).max(1.0) as usize;
            let high = (centre + sigma * 5.0).min((PAD_N / 2 - 1) as f32) as usize;
            for bin in low..=high {
                let x = (bin as f32 - centre) / sigma;
                let gaussian = (-0.5 * x * x).exp();
                let broad = 1.0 / (1.0 + x * x * 3.0);
                self.pad_magnitude[bin] +=
                    amplitude * (gaussian * (1.0 - p[3]) + broad * p[3]) / sigma.sqrt();
            }
        }
        let mut seed = 771903_u32 ^ ((p[7] * 16_777_215.0) as u32).wrapping_mul(0x9e37_79b9);
        if seed == 0 {
            seed = 1;
        }
        self.pad.fill(0.0);
        self.pad_im.fill(0.0);
        for bin in 1..PAD_N / 2 {
            let angle = TAU * random(&mut seed);
            let (sin, cos) = angle.sin_cos();
            let magnitude = self.pad_magnitude[bin];
            self.pad[bin] = magnitude * cos;
            self.pad_im[bin] = magnitude * sin;
            self.pad[PAD_N - bin] = self.pad[bin];
            self.pad_im[PAD_N - bin] = -self.pad_im[bin];
        }
        fft(&mut self.pad, &mut self.pad_im, true);
        let peak = self
            .pad
            .iter()
            .fold(0.0f32, |a, b| a.max(b.abs()))
            .max(1.0e-6);
        for value in self.pad.iter_mut() {
            *value *= 0.85 / peak;
        }
    }
    pub fn analyse_vocoder(&mut self, source: &[f32], source_sr: f32) {
        self.pv_analysis_hop =
            (source.len().saturating_sub(FFT_N) as f32 / (FRAMES - 1) as f32).max(16.0);
        let mut old_phase = [0.0; BINS];
        for frame in 0..FRAMES {
            for i in 0..FFT_N {
                self.re[i] = source_at(source, frame as f32 * self.pv_analysis_hop + i as f32)
                    * (0.5 - 0.5 * (TAU * i as f32 / FFT_N as f32).cos());
                self.im[i] = 0.0;
            }
            fft(&mut self.re, &mut self.im, false);
            for bin in 0..BINS {
                let phase = self.im[bin].atan2(self.re[bin]);
                self.pv_analysis_phase[frame * BINS + bin] = phase;
                let omega = TAU * bin as f32 / FFT_N as f32;
                let delta = phase_wrap(phase - old_phase[bin] - omega * self.pv_analysis_hop);
                self.pv_frequency[frame * BINS + bin] = if frame == 0 {
                    omega
                } else {
                    omega + delta / self.pv_analysis_hop
                } * source_sr
                    / self.sample_rate;
                self.pv_magnitude[frame * BINS + bin] = self.re[bin].hypot(self.im[bin]);
                old_phase[bin] = phase;
            }
        }
        self.reset();
    }
    fn vocoder_frame(&mut self, frequency: f32, p: &[f32; 16]) {
        let pitch = (frequency / 220.0) * (2.0f32).powf((p[1] * 24.0 - 12.0) / 12.0);
        let position = (self.pv_frame + p[4] * (FRAMES - 1) as f32).rem_euclid(FRAMES as f32);
        let frame = position as usize;
        let next = (frame + 1) % FRAMES;
        let mix = position.fract();
        self.re.fill(0.0);
        self.im.fill(0.0);
        let cutoff_a = 20.0 * 1200.0_f32.powf(p[6]);
        let cutoff_b = 20.0 * 1200.0_f32.powf(p[7]);
        let low = cutoff_a.min(cutoff_b);
        let high = cutoff_a.max(cutoff_b);
        let peak_magnitude = self.pv_magnitude[frame * BINS..(frame + 1) * BINS]
            .iter()
            .copied()
            .fold(0.0_f32, f32::max);
        for bin in 1..BINS - 1 {
            let a = frame * BINS + bin;
            let b = next * BINS + bin;
            let omega = self.pv_frequency[a] + (self.pv_frequency[b] - self.pv_frequency[a]) * mix;
            self.pv_phase[bin] = (self.pv_phase[bin] + omega * HOP as f32 * pitch).rem_euclid(TAU);
        }
        for bin in 1..BINS - 1 {
            let a = frame * BINS + bin;
            let b = next * BINS + bin;
            let magnitude =
                self.pv_magnitude[a] + (self.pv_magnitude[b] - self.pv_magnitude[a]) * mix;
            let hz = bin as f32 * self.sample_rate / FFT_N as f32 * pitch;
            if hz < low || hz > high || magnitude < peak_magnitude * p[8] * p[8] {
                continue;
            }
            let out_bin = (bin as f32 * pitch).round() as usize;
            if out_bin == 0 || out_bin >= BINS - 1 {
                continue;
            }
            let tilt = (bin as f32 / 10.0)
                .powf((p[2] * 2.0 - 1.0) * 1.5)
                .clamp(0.02, 8.0);
            let mut phase = self.pv_phase[bin];
            if p[9] > 0.0 {
                let lo = bin.saturating_sub(6).max(1);
                let hi = (bin + 6).min(BINS - 2);
                let peak = (lo..=hi)
                    .max_by(|x, y| {
                        self.pv_magnitude[frame * BINS + *x]
                            .total_cmp(&self.pv_magnitude[frame * BINS + *y])
                    })
                    .unwrap_or(bin);
                let relative = phase_wrap(
                    self.pv_analysis_phase[a] - self.pv_analysis_phase[frame * BINS + peak],
                );
                phase += phase_wrap(self.pv_phase[peak] + relative - phase) * p[9];
            }
            phase += (random(&mut self.seed) - 0.5) * p[3] * TAU;
            let (sin, cos) = phase.sin_cos();
            self.re[out_bin] += magnitude * tilt * cos;
            self.im[out_bin] += magnitude * tilt * sin;
        }
        for bin in 1..BINS - 1 {
            self.re[FFT_N - bin] = self.re[bin];
            self.im[FFT_N - bin] = -self.im[bin];
        }
        fft(&mut self.re, &mut self.im, true);
        for i in 0..FFT_N {
            let window = 0.5 - 0.5 * (TAU * i as f32 / FFT_N as f32).cos();
            self.pv_ola[(self.pv_clock + i) % (FFT_N * 2)] += self.re[i] * window * (2.0 / 3.0);
        }
        let stretch = 0.25 * 16.0f32.powf(p[0]);
        if p[5] < 0.5 {
            self.pv_frame = (self.pv_frame + HOP as f32 / self.pv_analysis_hop / stretch)
                .rem_euclid(FRAMES as f32);
        }
    }
    pub fn vocoder_sample(&mut self, frequency: f32, p: &[f32; 16]) -> f32 {
        if self.pv_hop == 0 {
            self.vocoder_frame(frequency, p);
        }
        self.pv_hop = (self.pv_hop + 1) % HOP;
        let value = self.pv_ola[self.pv_clock];
        self.pv_ola[self.pv_clock] = 0.0;
        self.pv_clock = (self.pv_clock + 1) % (FFT_N * 2);
        value
    }
    fn make_minblep(&mut self) {
        // Windowed-sinc lowpass -> real cepstrum -> causal minimum-phase impulse
        // -> integrated step residual. 32x oversampling, 16-sample correction.
        for i in 0..FFT_N {
            let x = (i as f32 - (FFT_N - 1) as f32 * 0.5) / 32.0;
            let sinc = if x.abs() < 1.0e-6 {
                1.0
            } else {
                (PI * x).sin() / (PI * x)
            };
            let w = 0.42 - 0.5 * (TAU * i as f32 / (FFT_N - 1) as f32).cos()
                + 0.08 * (2.0 * TAU * i as f32 / (FFT_N - 1) as f32).cos();
            self.re[i] = sinc * w;
            self.im[i] = 0.0;
        }
        fft(&mut self.re, &mut self.im, false);
        for i in 0..FFT_N {
            self.re[i] = self.re[i].hypot(self.im[i]).max(1.0e-9).ln();
            self.im[i] = 0.0;
        }
        fft(&mut self.re, &mut self.im, true);
        for i in 1..FFT_N / 2 {
            self.re[i] *= 2.0;
        }
        for i in FFT_N / 2 + 1..FFT_N {
            self.re[i] = 0.0;
        }
        self.im.fill(0.0);
        fft(&mut self.re, &mut self.im, false);
        for i in 0..FFT_N {
            let magnitude = self.re[i].exp();
            self.re[i] = magnitude * self.im[i].cos();
            self.im[i] = magnitude * self.im[i].sin();
        }
        fft(&mut self.re, &mut self.im, true);
        let sum: f32 = self.re.iter().sum();
        let mut step = 0.0;
        for i in 0..FFT_N {
            step += self.re[i] / sum;
            self.minblep[i] = step - 1.0;
        }
    }
}

#[cfg(test)]
mod expanded_tests {
    use super::*;
    fn source() -> Vec<f32> {
        (0..32768)
            .map(|i| {
                let t = i as f32 / 48000.0;
                (TAU * 220.0 * t).sin() * 0.35
                    + (TAU * (700.0 * t + 800.0 * t * t)).sin() * 0.23
                    + (TAU * 2713.0 * t).sin() * 0.12
            })
            .collect()
    }
    fn defaults(method: u32) -> [f32; 16] {
        let mut p = [0.0; 16];
        p[..4].copy_from_slice(&[0.5, 0.5, 0.5, 0.25]);
        match method {
            8 => {
                p[4] = 10.0 / 22.0;
                p[6] = 0.055 / 0.0595;
                p[7] = 0.75;
            }
            28 => p[7] = 1.0,
            31 => {
                p[4] = 47.0 / 95.0;
                p[5] = 0.5;
                p[6] = 0.5;
                p[8] = 0.5;
            }
            _ => {}
        }
        p
    }
    fn render(method: u32, p: [f32; 16]) -> Vec<f32> {
        let mut s = Spectral::new(48000.0);
        let source = source();
        match method {
            8 => s.analyse_lpc(&source, &p),
            28 => s.analyse_vocoder(&source, 48000.0),
            31 => s.make_pad(&p),
            _ => {}
        }
        (0..24000)
            .map(|i| match method {
                8 => s.lpc_sample(((i * 73 % 997) as f32 / 997.0 - 0.5) * 0.12),
                28 => s.vocoder_sample(220.0, &p),
                31 => s.pad[i % PAD_N],
                _ => 0.0,
            })
            .collect()
    }
    #[test]
    fn expanded_spectral_controls_change_their_analysis_or_resynthesis() {
        for (method, count) in [(8, 8), (28, 10), (31, 9)] {
            for slot in 4..count {
                let mut low = defaults(method);
                let mut high = low;
                low[slot] = 0.0;
                high[slot] = 1.0;
                let a = render(method, low);
                let b = render(method, high);
                assert!(a.iter().chain(b.iter()).all(|v| v.is_finite()));
                let distance = (a.iter().zip(&b).map(|(x, y)| (x - y).powi(2)).sum::<f32>()
                    / a.len() as f32)
                    .sqrt();
                assert!(distance > 1e-5, "method {method}, slot {slot}: {distance}");
            }
        }
    }
    #[test]
    fn spectral_extreme_combinations_remain_finite() {
        for method in [8, 28, 31] {
            for extreme in [0.0, 1.0] {
                assert!(render(method, [extreme; 16])
                    .iter()
                    .all(|v| v.is_finite() && v.abs() <= 100.0));
            }
        }
    }
}
