//! Original, deterministic demonstration noise generators. Pink is an
//! octave-spaced low-pass sum (approximate 1/f, not a calibrated measurement
//! source); brown is a leaky integrator with an 8 Hz low-frequency limit.
//! Gaussian is Box–Muller white noise bounded at four standard deviations.
use std::f32::consts::TAU;

pub struct TestNoise {
    seed: u32,
    pink: [f32; 9],
    pink_a: [f32; 9],
    pink_gain: [f32; 9],
    brown: f32,
    brown_a: f32,
    brown_gain: f32,
}
impl TestNoise {
    pub fn new(sr: f32) -> Self {
        let pink_a = std::array::from_fn(|i| {
            1.0 - (-TAU * (40.0 * 2.0_f32.powi(i as i32)).min(sr * 0.4) / sr).exp()
        });
        let brown_a = 1.0 - (-TAU * 8.0 / sr).exp();
        Self {
            seed: 0x8be319a5,
            pink: [0.0; 9],
            pink_a,
            pink_gain: pink_a.map(|a| ((2.0 - a) / a).sqrt() * 0.06),
            brown: 0.0,
            brown_a,
            brown_gain: ((2.0 - brown_a) / brown_a).sqrt() * 0.18,
        }
    }
    pub fn reset(&mut self) {
        self.seed = 0x8be319a5;
        self.pink.fill(0.0);
        self.brown = 0.0;
    }
    fn uniform(&mut self) -> f32 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        // Open interval, avoiding log(0) in Box–Muller.
        ((self.seed >> 9) as f32 + 0.5) / 8388608.0
    }
    pub fn next(&mut self, source: u32) -> f32 {
        match source {
            8 => {
                let mut sum = 0.0;
                for i in 0..9 {
                    let white = self.uniform() * 2.0 - 1.0;
                    self.pink[i] += self.pink_a[i] * (white - self.pink[i]);
                    sum += self.pink[i] * self.pink_gain[i];
                }
                sum.clamp(-0.65, 0.65)
            }
            9 => {
                let white = self.uniform() * 2.0 - 1.0;
                self.brown += self.brown_a * (white - self.brown);
                (self.brown * self.brown_gain).clamp(-0.65, 0.65)
            }
            10 => {
                let radius = (-2.0 * self.uniform().ln()).sqrt();
                let phase = TAU * self.uniform();
                (radius * phase.cos()).clamp(-4.0, 4.0) * 0.1
            }
            _ => 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn noises_are_bounded_audible_and_reset_deterministically_at_all_rates() {
        for sr in [8000.0, 44100.0, 48000.0, 96000.0, 192000.0] {
            for source in 8..=10 {
                let mut noise = TestNoise::new(sr);
                let first: Vec<_> = (0..sr as usize).map(|_| noise.next(source)).collect();
                assert!(first.iter().all(|x| x.is_finite() && x.abs() <= 0.65));
                let rms = (first.iter().map(|x| x * x).sum::<f32>() / sr).sqrt();
                assert!(rms > 0.04 && rms < 0.2, "{sr}/{source}: {rms}");
                noise.reset();
                for expected in first {
                    assert_eq!(noise.next(source), expected);
                }
            }
        }
    }
    #[test]
    fn colors_have_distinct_low_to_high_band_energy() {
        let mut ratios = Vec::new();
        for source in 8..=10 {
            let mut noise = TestNoise::new(48000.0);
            let (mut low, mut high_low) = (0.0, 0.0);
            let (mut low_energy, mut high_energy) = (0.0, 0.0);
            let a = 1.0 - (-TAU * 400.0 / 48000.0).exp();
            let b = 1.0 - (-TAU * 4000.0 / 48000.0).exp();
            for i in 0..96000 {
                let x = noise.next(source);
                low += a * (x - low);
                high_low += b * (x - high_low);
                if i > 48000 {
                    low_energy += low * low;
                    high_energy += (x - high_low).powi(2);
                }
            }
            ratios.push(low_energy / high_energy);
        }
        assert!(ratios[1] > ratios[0] * 5.0, "brown versus pink: {ratios:?}");
        assert!(
            ratios[0] > ratios[2] * 5.0,
            "pink versus Gaussian white: {ratios:?}"
        );
    }
}
