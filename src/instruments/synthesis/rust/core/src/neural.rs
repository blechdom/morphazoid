//! Small genuinely trained teaching models; see docs/synthesis-neural-models.md.
//! No inference runtime, allocation, downloaded assets, or external model weights.
#[allow(dead_code)]
#[path = "neural_weights.rs"]
mod weights;
use weights::*;

const TAU: f32 = core::f32::consts::TAU;
const FRAME: usize = 64;
const TABLE: usize = 128;
const LEVELS: usize = 5;

fn finite_unit(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.5
    }
}

fn dense<const IN: usize, const OUT: usize>(
    input: &[f32; IN],
    weights: &[f32],
    biases: &[f32],
    activation: u8,
) -> [f32; OUT] {
    let mut output = [0.0; OUT];
    for row in 0..OUT {
        let mut value = biases[row];
        for col in 0..IN {
            value += input[col] * weights[row * IN + col];
        }
        output[row] = match activation {
            1 => value.tanh(),
            2 => 1.0 / (1.0 + (-value.clamp(-30.0, 30.0)).exp()),
            _ => value,
        };
    }
    output
}

fn random_signed(state: &mut u32) -> f32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    (*state as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32
}

fn gaussian(state: &mut u32) -> f32 {
    // Box–Muller, used only during cached diffusion-frame preparation.
    let a = ((random_signed(state) + 1.0) * 0.5).max(1e-7);
    let b = (random_signed(state) + 1.0) * 0.5;
    (-2.0 * a.ln()).sqrt() * (TAU * b).cos()
}

fn lookup(table: &[f32; TABLE], phase: f32) -> f32 {
    let position = phase * TABLE as f32;
    let index = position as usize;
    let fraction = position - index as f32;
    table[index % TABLE] + fraction * (table[(index + 1) % TABLE] - table[index % TABLE])
}

/// Learned 64-sample encoder retained for reconstruction tests and future input.
/// The current instrument plays the learned decoder through four latent controls.
#[allow(dead_code)]
pub fn encode_frame(frame: &[f32; FRAME]) -> [f32; 4] {
    let hidden = dense::<64, 24>(frame, &AE_W0, &AE_B0, 1);
    dense::<24, 4>(&hidden, &AE_W1, &AE_B1, 1)
}

pub fn decode_latent(latent: &[f32; 4]) -> [f32; FRAME] {
    let hidden = dense::<4, 32>(latent, &AE_W2, &AE_B2, 1);
    dense::<32, 64>(&hidden, &AE_W3, &AE_B3, 0)
}

pub struct NeuralEngine {
    sample_rate: f32,
    method: u32,
    params: [f32; 16],
    prepared: [f32; 16],
    cooldown: usize,
    pending: bool,
    phase: f32,
    rng: u32,
    ar_phase: f32,
    ar_clock: f32,
    ar_history: [f32; 16],
    ar_previous: f32,
    ar_next: f32,
    ar_params: [f32; 4],
    tables: [[f32; TABLE]; LEVELS],
    previous_tables: [[f32; TABLE]; LEVELS],
    table_fade: f32,
    sine: [f32; TABLE],
    ddsp_target: [f32; 9],
    ddsp_current: [f32; 9],
    ddsp_phase: [f32; 8],
    ddsp_noise: f32,
    latent_phase: f32,
    note_age: f32,
    regeneration_phase: f32,
    generation: u32,
    seed_parameter: f32,
    ar_rate: f32,
    orbit_increment: f32,
    attack_duration: f32,
    ddsp_ratio: [f32; 8],
}

impl NeuralEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut engine = Self {
            sample_rate: if sample_rate.is_finite() {
                sample_rate.clamp(8_000.0, 384_000.0)
            } else {
                48_000.0
            },
            method: 33,
            params: [
                0.5,
                0.5,
                0.5,
                0.5,
                2.0 / 3.0,
                2.0 / 3.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
            ],
            prepared: [-1.0; 16],
            cooldown: 0,
            pending: false,
            phase: 0.0,
            rng: 0x35ba_78d9,
            ar_phase: 0.0,
            ar_clock: 0.0,
            ar_history: [0.0; 16],
            ar_previous: 0.0,
            ar_next: 0.0,
            ar_params: [0.5; 4],
            tables: [[0.0; TABLE]; LEVELS],
            previous_tables: [[0.0; TABLE]; LEVELS],
            table_fade: 1.0,
            sine: [0.0; TABLE],
            ddsp_target: [0.0; 9],
            ddsp_current: [0.0; 9],
            ddsp_phase: [0.0; 8],
            ddsp_noise: 0.0,
            latent_phase: 0.0,
            note_age: 1000.0,
            regeneration_phase: 0.0,
            generation: 0,
            seed_parameter: -1.0,
            ar_rate: 12000.0,
            orbit_increment: 0.0,
            attack_duration: 0.1,
            ddsp_ratio: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0],
        };
        for i in 0..TABLE {
            engine.sine[i] = (TAU * i as f32 / TABLE as f32).sin();
        }
        engine.prepare();
        engine
    }

    /// Preserve selected model and controls; restart all stochastic/dynamic state.
    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.rng = 0x35ba_78d9;
        self.seed_parameter = -1.0;
        self.ddsp_phase.fill(0.0);
        self.ddsp_noise = 0.0;
        self.latent_phase = 0.0;
        self.note_age = 1000.0;
        self.regeneration_phase = 0.0;
        self.generation = 0;
        self.ar_phase = 0.0;
        self.ar_clock = 0.0;
        self.ar_history = [0.0; 16];
        self.ar_previous = 0.0;
        self.ar_next = 0.0;
        self.ar_params.copy_from_slice(&self.params[..4]);
        self.cooldown = 0;
        self.prepare();
        self.previous_tables = self.tables;
        self.table_fade = 1.0;
        self.ddsp_current = self.ddsp_target;
    }

    pub fn set_method(&mut self, method: u32) {
        let method = method.clamp(33, 36);
        if method != self.method {
            self.method = method;
            self.cooldown = 0;
            self.prepare();
        }
    }

    pub fn set_params(&mut self, params: [f32; 16]) {
        for (target, value) in self.params.iter_mut().zip(params) {
            *target = finite_unit(value);
        }
        let difference = (0..16)
            .map(|i| (self.params[i] - self.prepared[i]).abs())
            .fold(0.0_f32, f32::max);
        // The host sends smoothed controls every block. Expensive preparation is
        // rate-limited to 30 Hz, while AR controls smooth at its own sample clock.
        self.pending = difference > 0.001;
        if self.pending && self.cooldown == 0 {
            self.prepare();
        }
    }

    /// The shared synthesis core owns velocity, ADSR and note release.
    pub fn note_on(&mut self, _velocity: f32) {
        self.note_age = 0.0;
        if self.method == 35 && self.params[7] > 0.0 {
            self.cooldown = 0;
            self.prepare();
        }
    }
    pub fn note_off(&mut self) {}

    fn prepare(&mut self) {
        self.pending = false;
        self.ar_rate = (3000.0 * 8.0_f32.powf(self.params[5])).min(self.sample_rate);
        self.orbit_increment = 0.01 * 800.0_f32.powf(self.params[6]) / self.sample_rate;
        self.attack_duration = 0.005 * 400.0_f32.powf(self.params[8]);
        if self.method == 35 {
            for i in 0..8 {
                self.ddsp_ratio[i] = ((i + 1) as f32).powf(0.8 + 0.4 * self.params[5]);
            }
        }
        if self.method == 33 && self.params[7] != self.seed_parameter {
            self.rng =
                0x35ba_78d9 ^ ((self.params[7] * 16_777_215.0) as u32).wrapping_mul(0x9e37_79b9);
            if self.rng == 0 {
                self.rng = 1;
            }
            self.seed_parameter = self.params[7];
        }
        self.prepared = self.params;
        self.cooldown = (self.sample_rate / 30.0) as usize;
        match self.method {
            34 => {
                let mut latent = [0.0; 4];
                let planes = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)];
                let plane = planes[(self.params[7] * 5.0).round() as usize];
                let mut coordinates = [
                    self.params[0],
                    self.params[1],
                    self.params[2],
                    self.params[3],
                ];
                coordinates[plane.0] += 0.35 * self.params[5] * (TAU * self.latent_phase).cos();
                coordinates[plane.1] += 0.35 * self.params[5] * (TAU * self.latent_phase).sin();
                for i in 0..4 {
                    let range = AE_LATENT_HIGH[i] - AE_LATENT_LOW[i];
                    latent[i] = (AE_LATENT_LOW[i] + AE_LATENT_HIGH[i]) * 0.5
                        + (coordinates[i] - 0.5) * range * (self.params[4] * 2.0);
                }
                let frame = decode_latent(&latent);
                self.install_frame(&frame);
            }
            35 => {
                let mut input = [0.0; 4];
                for i in 0..4 {
                    input[i] = self.params[i] * 2.0 - 1.0;
                }
                let transient_time = self.attack_duration;
                input[0] = (input[0]
                    + 2.0 * self.params[7] * (-self.note_age / transient_time).exp())
                .clamp(-1.0, 1.0);
                let hidden = dense::<4, 24>(&input, &DDSP_W0, &DDSP_B0, 1);
                self.ddsp_target = dense::<24, 9>(&hidden, &DDSP_W1, &DDSP_B1, 2);
                for value in &mut self.ddsp_target {
                    *value *= 0.8;
                }
                let sum: f32 = self.ddsp_target.iter().sum();
                if sum > 0.85 {
                    for value in &mut self.ddsp_target {
                        *value *= 0.85 / sum;
                    }
                }
            }
            36 => {
                let frame = self.diffusion_frame();
                self.install_frame(&frame);
            }
            _ => {}
        }
    }

    fn diffusion_frame(&self) -> [f32; FRAME] {
        let mut seed = 0x4cdf_518bu32
            ^ ((self.params[3] * 16_777_215.0) as u32).wrapping_mul(0x9e37_79b9)
            ^ self.generation.wrapping_mul(0x85eb_ca6b);
        if seed == 0 {
            seed = 1;
        }
        let mut frame = [0.0; FRAME];
        for sample in &mut frame {
            *sample = gaussian(&mut seed);
        }
        let steps = 4 + (self.params[2] * 16.0).round() as usize;
        for step in (1..=steps).rev() {
            let endpoint = self.params[5] * 0.8;
            let time = endpoint + step as f32 / steps as f32 * (0.995 - endpoint);
            let next_time = endpoint + (step - 1) as f32 / steps as f32 * (0.995 - endpoint);
            let mut input = [0.0; 67];
            input[..FRAME].copy_from_slice(&frame);
            input[64] = self.params[0] * 2.0 - 1.0;
            input[65] = self.params[1] * 2.0 - 1.0;
            input[66] = time * 2.0 - 1.0;
            let hidden = dense::<67, 64>(&input, &DIFF_W0, &DIFF_B0, 1);
            let mut clean = dense::<64, 64>(&hidden, &DIFF_W1, &DIFF_B1, 0);
            let contrast = self.params[4] * 2.0;
            if (contrast - 1.0).abs() > 1e-6 {
                // Neutral-condition reference, not an untrained unconditional branch.
                input[64] = 0.0;
                input[65] = 0.0;
                let neutral_hidden = dense::<67, 64>(&input, &DIFF_W0, &DIFF_B0, 1);
                let neutral = dense::<64, 64>(&neutral_hidden, &DIFF_W1, &DIFF_B1, 0);
                for n in 0..FRAME {
                    clean[n] = neutral[n] + contrast * (clean[n] - neutral[n]);
                }
            }
            let (sigma, alpha) = (time * core::f32::consts::FRAC_PI_2).sin_cos();
            let (next_sigma, next_alpha) = (next_time * core::f32::consts::FRAC_PI_2).sin_cos();
            let variance = self.params[6].powi(2)
                * (next_sigma * next_sigma / (sigma * sigma).max(1e-8))
                * (1.0 - alpha * alpha / (next_alpha * next_alpha).max(1e-8)).max(0.0);
            let stochastic_sigma = variance.max(0.0).sqrt();
            let retained_sigma = (next_sigma * next_sigma - variance).max(0.0).sqrt();
            for n in 0..FRAME {
                let estimated_noise = (frame[n] - alpha * clean[n]) / sigma.max(0.001);
                let innovation = if stochastic_sigma > 0.0 {
                    gaussian(&mut seed) * stochastic_sigma
                } else {
                    0.0
                };
                frame[n] = (next_alpha * clean[n] + retained_sigma * estimated_noise + innovation)
                    .clamp(-6.0, 6.0);
            }
        }
        frame
    }

    fn install_frame(&mut self, frame: &[f32; FRAME]) {
        // Capture the currently audible morph, so a second edit cannot jump back
        // to the preceding target table while the 25 ms crossfade is unfinished.
        for level in 0..LEVELS {
            for n in 0..TABLE {
                self.previous_tables[level][n] +=
                    self.table_fade * (self.tables[level][n] - self.previous_tables[level][n]);
                self.tables[level][n] = 0.0;
            }
        }
        let peak = frame
            .iter()
            .fold(0.4_f32, |peak, value| peak.max(value.abs()));
        let scale = 0.68 / peak;
        // Project the learned frame into five increasingly band-limited tables.
        // Recurrences avoid per-bin/per-sample trigonometric calls in preparation.
        for harmonic in 1..=16 {
            let (ds, dc) = (TAU * harmonic as f32 / FRAME as f32).sin_cos();
            let (mut s, mut c) = (0.0, 1.0);
            let (mut sine, mut cosine) = (0.0, 0.0);
            for value in frame {
                sine += value * s;
                cosine += value * c;
                let next_s = s * dc + c * ds;
                c = c * dc - s * ds;
                s = next_s;
            }
            sine *= 2.0 / FRAME as f32 * scale;
            cosine *= 2.0 / FRAME as f32 * scale;
            let (ds, dc) = (TAU * harmonic as f32 / TABLE as f32).sin_cos();
            let (mut s, mut c) = (0.0, 1.0);
            for n in 0..TABLE {
                let value = sine * s + cosine * c;
                for level in 0..LEVELS {
                    if harmonic <= 16 >> level {
                        self.tables[level][n] += value;
                    }
                }
                let next_s = s * dc + c * ds;
                c = c * dc - s * ds;
                s = next_s;
            }
        }
        self.table_fade = 0.0;
    }

    fn table_sample(&self, frequency: f32) -> f32 {
        let harmonic_limit = self.sample_rate * 0.44 / frequency.max(1.0);
        let level = (16.0 / harmonic_limit).log2().clamp(0.0, 4.0);
        let a = level as usize;
        let b = (a + 1).min(LEVELS - 1);
        let mix = level - a as f32;
        let old_a = lookup(&self.previous_tables[a], self.phase);
        let old = old_a + mix * (lookup(&self.previous_tables[b], self.phase) - old_a);
        let new_a = lookup(&self.tables[a], self.phase);
        let new = new_a + mix * (lookup(&self.tables[b], self.phase) - new_a);
        old + self.table_fade * (new - old)
    }

    fn ar_sample(&mut self, frequency: f32) -> f32 {
        let rate = self.ar_rate;
        self.ar_clock += rate / self.sample_rate;
        if self.ar_clock >= 1.0 {
            self.ar_clock -= 1.0;
            self.ar_previous = self.ar_next;
            let step = (frequency / rate).clamp(0.0001, 0.4);
            self.ar_phase = (self.ar_phase + step).fract();
            for i in 0..4 {
                self.ar_params[i] += 0.02 * (self.params[i] - self.ar_params[i]);
            }
            let (sine, cosine) = (TAU * self.ar_phase).sin_cos();
            let stride = 1 + (self.params[6] * 7.0).round() as usize;
            let history_amount = self.params[4] * 1.5;
            let input = [
                self.ar_history[stride - 1] * history_amount,
                self.ar_history[stride * 2 - 1] * history_amount,
                sine,
                cosine,
                2.0 * self.ar_params[0] - 1.0,
                2.0 * self.ar_params[1] - 1.0,
                2.0 * self.ar_params[2] - 1.0,
                step / 0.075 - 1.0,
            ];
            let hidden = dense::<8, 24>(&input, &AR_W0, &AR_B0, 1);
            let predicted = dense::<24, 1>(&hidden, &AR_W1, &AR_B1, 1)[0];
            let temperature = self.ar_params[3] * self.ar_params[3] * 0.11;
            self.ar_next = (predicted + temperature * gaussian(&mut self.rng)).clamp(-0.9, 0.9);
            for i in (1..16).rev() {
                self.ar_history[i] = self.ar_history[i - 1];
            }
            self.ar_history[0] = self.ar_next;
        }
        self.ar_previous + self.ar_clock * (self.ar_next - self.ar_previous)
    }

    pub fn sample(&mut self, frequency: f32) -> f32 {
        let frequency = if frequency.is_finite() {
            frequency.clamp(1.0, self.sample_rate * 0.4)
        } else {
            220.0
        };
        self.note_age += 1.0 / self.sample_rate;
        if self.method == 34 {
            self.latent_phase = (self.latent_phase + self.orbit_increment).fract();
        }
        if self.method == 36 && self.params[7] > 0.0 {
            self.regeneration_phase += self.params[7] * 4.0 / self.sample_rate;
            if self.regeneration_phase >= 1.0 {
                self.regeneration_phase -= 1.0;
                self.generation = self.generation.wrapping_add(1);
                self.pending = true;
            }
        }
        self.cooldown = self.cooldown.saturating_sub(1);
        let animated = (self.method == 34 && self.params[5] > 0.0)
            || (self.method == 35
                && self.params[7] > 0.0
                && self.note_age < 6.0 * self.attack_duration);
        if self.cooldown == 0 && (self.pending || animated) {
            self.prepare();
        }
        self.table_fade = (self.table_fade + 1.0 / (self.sample_rate * 0.025)).min(1.0);
        let output = match self.method {
            33 => self.ar_sample(frequency),
            35 => {
                let mut output = 0.0;
                let partials = 1 + (self.params[4] * 7.0).round() as usize;
                for harmonic in 0..9 {
                    self.ddsp_current[harmonic] +=
                        0.002 * (self.ddsp_target[harmonic] - self.ddsp_current[harmonic]);
                    if harmonic < 8 {
                        let hz = frequency * self.ddsp_ratio[harmonic];
                        if harmonic < partials && hz < self.sample_rate * 0.45 {
                            output += self.ddsp_current[harmonic]
                                * lookup(&self.sine, self.ddsp_phase[harmonic]);
                        }
                        self.ddsp_phase[harmonic] =
                            (self.ddsp_phase[harmonic] + hz / self.sample_rate).fract();
                    }
                }
                let white = random_signed(&mut self.rng);
                self.ddsp_noise += 0.03 * (white - self.ddsp_noise);
                let color = self.params[6] * 2.0 - 1.0;
                let filtered = if color < 0.0 {
                    self.ddsp_noise * 4.5
                } else {
                    (white - self.ddsp_noise) * 1.035
                };
                output + self.ddsp_current[8] * (white + color.abs() * (filtered - white))
            }
            _ => self.table_sample(frequency),
        };
        self.phase = (self.phase + frequency / self.sample_rate).fract();
        if output.is_finite() {
            output.clamp(-0.95, 0.95)
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(method: u32, parameters: [f32; 4], frequency: f32) -> Vec<f32> {
        let mut engine = NeuralEngine::new(48_000.0);
        engine.set_method(method);
        let mut p = [0.5; 16];
        p[..4].copy_from_slice(&parameters);
        engine.set_params(p);
        engine.reset();
        engine.note_on(0.8);
        (0..12_000).map(|_| engine.sample(frequency)).collect()
    }

    #[test]
    fn trained_autoencoder_reconstructs_unseen_waveform() {
        let mut frame = [0.0; FRAME];
        for i in 0..FRAME {
            let p = TAU * i as f32 / FRAME as f32;
            frame[i] = 0.34 * p.sin()
                + (0.015 + 0.095 * 1.3) * (2.0 * p).sin()
                + (0.015 + 0.08 * 0.3) * (3.0 * p + 0.4).sin()
                + (0.005 + 0.0725 * 1.5) * (5.0 * p - 0.7).sin()
                + (0.005 + 0.0675 * 0.8) * (7.0 * p + 0.9).sin()
                + 0.01 * 1.3 * 0.3 * (4.0 * p + 0.5).sin();
        }
        let decoded = decode_latent(&encode_frame(&frame));
        let mse: f32 = frame
            .iter()
            .zip(decoded)
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f32>()
            / FRAME as f32;
        assert!(mse < 0.001, "unseen reconstruction MSE {mse}");
    }

    #[test]
    fn all_models_are_audible_finite_bounded_and_deterministic() {
        for method in 33..=36 {
            for frequency in [55.0, 220.0, 880.0, 1760.0] {
                let a = render(method, [0.4, 0.6, 0.3, 0.25], frequency);
                let b = render(method, [0.4, 0.6, 0.3, 0.25], frequency);
                assert_eq!(a, b, "method {method} reset must repeat exactly");
                assert!(a.iter().all(|v| v.is_finite() && v.abs() <= 0.951));
                let rms = (a.iter().map(|v| v * v).sum::<f32>() / a.len() as f32).sqrt();
                assert!(
                    rms > 0.035 && rms < 0.7,
                    "method {method}, {frequency} Hz RMS {rms}"
                );
            }
        }
    }

    #[test]
    fn every_neural_control_changes_the_generated_signal() {
        for method in 33..=36 {
            for control in 0..4 {
                let mut low = [0.5; 4];
                let mut high = low;
                low[control] = 0.05;
                high[control] = 0.95;
                let a = render(method, low, 220.0);
                let b = render(method, high, 220.0);
                let distance = (a.iter().zip(b).map(|(a, b)| (a - b).powi(2)).sum::<f32>()
                    / a.len() as f32)
                    .sqrt();
                assert!(
                    distance > 0.001,
                    "method {method}, control {control} distance {distance}"
                );
            }
        }
    }

    #[test]
    fn a_single_parameter_update_is_applied_without_another_host_message() {
        for method in 34..=36 {
            let mut engine = NeuralEngine::new(48_000.0);
            engine.set_method(method);
            engine.set_params([0.1; 16]);
            for _ in 0..2000 {
                engine.sample(220.0);
            }
            assert_eq!(engine.prepared, [0.1; 16]);
            engine.set_params([0.9; 16]);
            for _ in 0..2000 {
                engine.sample(220.0);
            }
            assert_eq!(engine.prepared, [0.9; 16]);
        }
    }

    #[test]
    fn adversarial_controls_and_live_edits_stay_finite() {
        let mut engine = NeuralEngine::new(f32::NAN);
        for method in 33..=36 {
            engine.set_method(method);
            for block in 0..20 {
                engine.set_params(if block % 2 == 0 {
                    [f32::NAN; 16]
                } else {
                    [f32::INFINITY; 16]
                });
                for _ in 0..128 {
                    assert!(engine.sample(f32::NAN).is_finite());
                }
            }
        }
    }
}

#[cfg(test)]
mod expanded_tests {
    use super::*;
    fn defaults(method: u32) -> [f32; 16] {
        let mut p = [0.0; 16];
        p[..4].copy_from_slice(&[0.25, 0.8, 0.4, 0.7]);
        match method {
            33 => {
                p[4] = 2.0 / 3.0;
                p[5] = 2.0 / 3.0;
            }
            34 => {
                p[4] = 0.5;
                p[6] = 0.5;
            }
            35 => {
                p[4] = 1.0;
                p[5] = 0.5;
                p[6] = 0.5;
                p[8] = 0.5;
            }
            36 => p[4] = 0.5,
            _ => {}
        }
        p
    }
    fn render(method: u32, p: [f32; 16]) -> Vec<f32> {
        let mut e = NeuralEngine::new(48000.0);
        e.set_method(method);
        e.set_params(p);
        e.reset();
        e.note_on(0.8);
        (0..32000).map(|_| e.sample(220.0)).collect()
    }
    #[test]
    fn expanded_inference_controls_have_measurable_effect() {
        for (method, count) in [(33, 8), (34, 8), (35, 9), (36, 8)] {
            for slot in 4..count {
                let mut low = defaults(method);
                if method == 34 && slot >= 6 {
                    low[5] = 0.6;
                }
                if method == 35 && slot == 8 {
                    low[7] = 0.8;
                }
                let mut high = low;
                low[slot] = 0.0;
                high[slot] = 1.0;
                let a = render(method, low);
                let b = render(method, high);
                let distance = (a.iter().zip(&b).map(|(x, y)| (x - y).powi(2)).sum::<f32>()
                    / a.len() as f32)
                    .sqrt();
                assert!(distance > 1e-4, "method {method}, slot {slot}: {distance}");
            }
        }
    }
    #[test]
    fn expanded_neural_extremes_are_finite_and_bounded() {
        for method in 33..=36 {
            for extreme in [0.0, 1.0] {
                assert!(render(method, [extreme; 16])
                    .iter()
                    .all(|v| v.is_finite() && v.abs() <= 0.951));
            }
        }
    }
}
