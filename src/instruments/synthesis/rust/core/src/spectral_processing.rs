//! Live stereo STFT processing, not a source oscillator. Fixed 1024-point FFT,
//! 256-sample hop, periodic Hann analysis/synthesis windows, normalized WOLA.
//! Wet and the supplied alignment tap have exactly 1024 samples of latency.
//! Reference: Julius O. Smith, Spectral Audio Signal Processing, WOLA and Phase
//! Vocoder chapters. No allocation in next(), frame(), or reset().
use crate::spectral::fft;
use std::f32::consts::{PI, TAU};

pub const FFT_SIZE: usize = 1024;
pub const HOP: usize = FFT_SIZE / 4;
const BINS: usize = FFT_SIZE / 2 + 1;

fn wrap(phase: f32) -> f32 {
    (phase + PI).rem_euclid(TAU) - PI
}

pub struct SpectralProcessor {
    sr: f32,
    window: [f32; FFT_SIZE],
    input: [[f32; FFT_SIZE]; 2],
    ola: [[f32; FFT_SIZE]; 2],
    re: [[f32; FFT_SIZE]; 2],
    im: [[f32; FFT_SIZE]; 2],
    previous_phase: [[f32; BINS]; 2],
    frozen_phase: [[f32; BINS]; 2],
    frozen_step: [[f32; BINS]; 2],
    frozen_magnitude: [[f32; BINS]; 2],
    gains: [[f32; BINS]; 2],
    cursor: usize,
    filled: usize,
    hop: usize,
    mode: u32,
    captured: bool,
    audible_frames: usize,
    dry: [f32; 2],
}

impl SpectralProcessor {
    pub fn new(sr: f32) -> Self {
        Self {
            sr,
            window: std::array::from_fn(|i| 0.5 - 0.5 * (TAU * i as f32 / FFT_SIZE as f32).cos()),
            input: [[0.0; FFT_SIZE]; 2],
            ola: [[0.0; FFT_SIZE]; 2],
            re: [[0.0; FFT_SIZE]; 2],
            im: [[0.0; FFT_SIZE]; 2],
            previous_phase: [[0.0; BINS]; 2],
            frozen_phase: [[0.0; BINS]; 2],
            frozen_step: [[0.0; BINS]; 2],
            frozen_magnitude: [[0.0; BINS]; 2],
            gains: [[1.0; BINS]; 2],
            cursor: 0,
            filled: 0,
            hop: 0,
            mode: 0,
            captured: false,
            audible_frames: 0,
            dry: [0.0; 2],
        }
    }
    pub fn reset(&mut self) {
        self.input.fill([0.0; FFT_SIZE]);
        self.ola.fill([0.0; FFT_SIZE]);
        self.re.fill([0.0; FFT_SIZE]);
        self.im.fill([0.0; FFT_SIZE]);
        self.previous_phase.fill([0.0; BINS]);
        self.frozen_phase.fill([0.0; BINS]);
        self.frozen_step.fill([0.0; BINS]);
        self.frozen_magnitude.fill([0.0; BINS]);
        self.gains.fill([1.0; BINS]);
        self.cursor = 0;
        self.filled = 0;
        self.hop = 0;
        self.mode = 0;
        self.captured = false;
        self.audible_frames = 0;
        self.dry = [0.0; 2];
    }
    pub fn clear_capture(&mut self) {
        self.captured = false;
        self.audible_frames = 0;
    }
    pub fn aligned_dry(&self) -> [f32; 2] {
        self.dry
    }
    /// p: mode (0=resynthesis,1=gate,2=freeze,3=tilt), threshold dBFS per bin,
    /// reduction dB, response seconds, tilt dB/octave around 1 kHz.
    /// Disarming the input clears freeze and drains finite overlap-add frames.
    pub fn next(&mut self, input: [f32; 2], p: &[f32; 16], active: bool) -> [f32; 2] {
        let mode = p[0].round().clamp(0.0, 3.0) as u32;
        if mode != self.mode || !active {
            self.clear_capture();
            self.mode = mode;
        }
        let mut out = [0.0; 2];
        for c in 0..2 {
            out[c] = self.ola[c][self.cursor];
            self.ola[c][self.cursor] = 0.0;
            self.dry[c] = self.input[c][self.cursor];
            self.input[c][self.cursor] = if input[c].is_finite() {
                input[c].clamp(-16.0, 16.0)
            } else {
                0.0
            };
        }
        self.cursor = (self.cursor + 1) % FFT_SIZE;
        self.filled = (self.filled + 1).min(FFT_SIZE);
        self.hop += 1;
        if self.hop == HOP {
            self.hop = 0;
            self.frame(p, active);
        }
        out
    }
    fn frame(&mut self, p: &[f32; 16], active: bool) {
        let mut power = 0.0;
        for c in 0..2 {
            for i in 0..FFT_SIZE {
                self.re[c][i] = self.input[c][(self.cursor + i) % FFT_SIZE] * self.window[i];
                self.im[c][i] = 0.0;
                power += self.re[c][i] * self.re[c][i];
            }
            fft(&mut self.re[c], &mut self.im[c], false);
        }
        self.audible_frames = if power > 1.0e-10 {
            (self.audible_frames + 1).min(4)
        } else {
            0
        };
        // Wait a complete window after silence, not a tiny onset fragment.
        let capture = self.mode == 2
            && active
            && !self.captured
            && self.filled == FFT_SIZE
            && self.audible_frames == 4;
        let threshold = 10.0_f32.powf(p[1].clamp(-90.0, -12.0) / 20.0);
        let floor = 10.0_f32.powf(-p[2].clamp(0.0, 96.0) / 20.0);
        let smoothing = 1.0 - (-(HOP as f32) / (self.sr * p[3].clamp(0.005, 0.5))).exp();
        for c in 0..2 {
            for k in 0..BINS {
                let re = self.re[c][k];
                let im = self.im[c][k];
                let magnitude = re.hypot(im);
                let phase = im.atan2(re);
                let expected = TAU * k as f32 * HOP as f32 / FFT_SIZE as f32;
                let step = expected + wrap(phase - self.previous_phase[c][k] - expected);
                self.previous_phase[c][k] = phase;
                if capture {
                    self.frozen_magnitude[c][k] = magnitude;
                    self.frozen_phase[c][k] = phase;
                    self.frozen_step[c][k] = step;
                }
                if self.mode == 2 && (self.captured || capture) {
                    if !capture {
                        self.frozen_phase[c][k] =
                            wrap(self.frozen_phase[c][k] + self.frozen_step[c][k]);
                    }
                    let (s, co) = self.frozen_phase[c][k].sin_cos();
                    self.re[c][k] = self.frozen_magnitude[c][k] * co;
                    self.im[c][k] = self.frozen_magnitude[c][k] * s;
                }
                // Hann coherent gain = N/2. Real-signal interior bins contain
                // half the sinusoid amplitude; DC/Nyquist are single sided.
                let amplitude =
                    magnitude * if k == 0 || k == BINS - 1 { 2.0 } else { 4.0 } / FFT_SIZE as f32;
                let target = match self.mode {
                    1 if amplitude < threshold => floor,
                    3 => {
                        let hz = (k as f32 * self.sr / FFT_SIZE as f32).max(20.0);
                        // Bounded +/-24 dB shelving limits extreme edge bins.
                        10.0_f32.powf(
                            (p[4].clamp(-12.0, 12.0) * (hz / 1000.0).log2()).clamp(-24.0, 24.0)
                                / 20.0,
                        )
                    }
                    _ => 1.0,
                };
                self.gains[c][k] += smoothing * (target - self.gains[c][k]);
                let gain = self.gains[c][k];
                self.re[c][k] *= gain;
                self.im[c][k] *= gain;
                if k == 0 || k == BINS - 1 {
                    self.im[c][k] = 0.0;
                } else {
                    self.re[c][FFT_SIZE - k] = self.re[c][k];
                    self.im[c][FFT_SIZE - k] = -self.im[c][k];
                }
            }
            fft(&mut self.re[c], &mut self.im[c], true);
            for i in 0..FFT_SIZE {
                // Four shifted Hann^2 windows sum to 3/2.
                self.ola[c][(self.cursor + i) % FFT_SIZE] +=
                    self.re[c][i] * self.window[i] * (2.0 / 3.0);
            }
        }
        if capture {
            self.captured = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn params(mode: f32) -> [f32; 16] {
        let mut p = [0.0; 16];
        p[..5].copy_from_slice(&[mode, -36.0, 72.0, 0.01, 0.0]);
        p
    }
    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }
    fn tone(i: usize, hz: f32) -> f32 {
        (TAU * hz * i as f32 / 48000.0).sin()
    }
    #[test]
    fn resynthesis_reconstructs_stereo_with_declared_delay() {
        let mut fx = SpectralProcessor::new(48000.0);
        let p = params(0.0);
        for i in 0..16384 {
            let input = [tone(i, 731.0) * 0.13, tone(i, 1597.0) * 0.2];
            let out = fx.next(input, &p, true);
            if i >= FFT_SIZE {
                let expected = [
                    tone(i - FFT_SIZE, 731.0) * 0.13,
                    tone(i - FFT_SIZE, 1597.0) * 0.2,
                ];
                for c in 0..2 {
                    assert!(
                        (out[c] - expected[c]).abs() < 4e-6,
                        "{i}/{c}: {} vs {}",
                        out[c],
                        expected[c]
                    );
                    assert_eq!(fx.aligned_dry()[c], expected[c]);
                }
            }
        }
    }
    #[test]
    fn bin_gate_removes_quiet_component_but_retains_loud_component() {
        let mut fx = SpectralProcessor::new(48000.0);
        let p = params(1.0);
        let mut left = Vec::new();
        let mut right = Vec::new();
        for i in 0..24000 {
            let out = fx.next([tone(i, 750.0) * 0.2, tone(i, 3000.0) * 0.003], &p, true);
            if i > 12000 {
                left.push(out[0]);
                right.push(out[1]);
            }
        }
        assert!(rms(&left) > 0.1);
        assert!(rms(&right) < 0.00001);
    }
    #[test]
    fn freeze_requires_input_preserves_channels_and_releases_when_disarmed() {
        let mut fx = SpectralProcessor::new(48000.0);
        let p = params(2.0);
        for _ in 0..4096 {
            assert_eq!(fx.next([0.0; 2], &p, true), [0.0; 2]);
        }
        for i in 0..4096 {
            fx.next([tone(i, 731.0) * 0.2, 0.0], &p, true);
        }
        let mut tail = Vec::new();
        for i in 0..12000 {
            let out = fx.next([0.0; 2], &p, true);
            if i > 4096 {
                tail.push(out[0]);
            }
            assert_eq!(out[1], 0.0, "freeze must not invent a right-channel source");
        }
        assert!(rms(&tail) > 0.02, "captured input remains audible");
        for i in 0..FFT_SIZE * 3 {
            let out = fx.next([0.0; 2], &p, false);
            if i > FFT_SIZE * 2 {
                assert!(out.iter().all(|v| v.abs() < 1e-7));
            }
        }
        fx.reset();
        for _ in 0..4096 {
            assert_eq!(fx.next([0.0; 2], &p, true), [0.0; 2]);
        }
    }
    #[test]
    fn tilt_changes_relative_frequency_levels_in_the_requested_direction() {
        let mut fx = SpectralProcessor::new(48000.0);
        let mut p = params(3.0);
        p[4] = 6.0;
        let mut low = Vec::new();
        let mut high = Vec::new();
        for i in 0..24000 {
            let out = fx.next([tone(i, 375.0) * 0.03, tone(i, 3000.0) * 0.03], &p, true);
            if i > 12000 {
                low.push(out[0]);
                high.push(out[1]);
            }
        }
        assert!(rms(&high) > rms(&low) * 6.0);
    }
}
