//! Input and output routing from the original browser L-system Delay.
//!
//! The highpass follows the normative Web Audio coefficients, including the
//! highpass filter's Q-in-decibels convention. The dynamics retain the original
//! -12 dB threshold, 5 dB knee, 18:1 ratio, 3 ms attack and 180 ms release, with
//! stereo linking, 6 ms lookahead and automatic makeup gain. Web Audio permits
//! different detector/envelope curves: this native exponential-knee and dB-slew
//! implementation is an approximation, not a bit-exact browser compressor.
//!
//! References: https://www.w3.org/TR/webaudio/#filters-characteristics and
//! https://www.w3.org/TR/webaudio/#DynamicsCompressorNode
//! The browser's final 2048-point ceiling curve is reproduced before master
//! gain. Its optional 2x oversampling reconstruction is not reproduced here.

use crate::performance::Mastering;

const LOOKAHEAD_SECONDS: f64 = 0.006;
const CEILING: f64 = 0.94;
const TRANSITION_SECONDS: f64 = 0.04;

#[derive(Clone, Copy, PartialEq)]
struct BiquadCoefficients {
    b: [f64; 3],
    a: [f64; 2],
}

impl BiquadCoefficients {
    fn new(sample_rate: u32, frequency: f64, highpass: bool, q: f64) -> Self {
        if frequency == 0.0 {
            return Self {
                b: [1.0, 0.0, 0.0],
                a: [0.0; 2],
            };
        }
        // Device rates can be lower than the UI's 20 kHz LPF range. Keep both
        // poles strictly inside the unit circle even at those device rates.
        let frequency = frequency.min(f64::from(sample_rate.max(1)) * 0.45);
        let omega = std::f64::consts::TAU * frequency / f64::from(sample_rate.max(1));
        let alpha = omega.sin() / (2.0 * q);
        let cosine = omega.cos();
        let denominator = 1.0 + alpha;
        let numerator = if highpass { 1.0 + cosine } else { 1.0 - cosine };
        Self {
            b: [
                numerator * 0.5 / denominator,
                if highpass { -numerator } else { numerator } / denominator,
                numerator * 0.5 / denominator,
            ],
            a: [-2.0 * cosine / denominator, (1.0 - alpha) / denominator],
        }
    }

    fn approach(&mut self, target: Self, frames: u32) {
        for (current, destination) in self.b.iter_mut().zip(target.b) {
            *current += (destination - *current) / f64::from(frames);
        }
        for (current, destination) in self.a.iter_mut().zip(target.a) {
            *current += (destination - *current) / f64::from(frames);
        }
    }
}

struct Biquad {
    coefficients: BiquadCoefficients,
    target: BiquadCoefficients,
    state: [[f64; 2]; 2],
    remaining: u32,
    transition_frames: u32,
}

impl Biquad {
    fn new(coefficients: BiquadCoefficients, sample_rate: u32) -> Self {
        Self {
            coefficients,
            target: coefficients,
            state: [[0.0; 2]; 2],
            remaining: 0,
            transition_frames: transition_frames(sample_rate),
        }
    }

    fn set(&mut self, target: BiquadCoefficients) {
        if target != self.target {
            self.target = target;
            self.remaining = self.transition_frames;
        }
    }

    fn process(&mut self, input: [f64; 2]) -> [f64; 2] {
        if self.remaining > 0 {
            self.coefficients.approach(self.target, self.remaining);
            self.remaining -= 1;
        }
        let coefficients = self.coefficients;
        std::array::from_fn(|channel| {
            let output = coefficients.b[0] * input[channel] + self.state[channel][0];
            self.state[channel][0] = coefficients.b[1] * input[channel]
                - coefficients.a[0] * output
                + self.state[channel][1];
            self.state[channel][1] =
                coefficients.b[2] * input[channel] - coefficients.a[1] * output;
            output
        })
    }
}

fn transition_frames(sample_rate: u32) -> u32 {
    (f64::from(sample_rate) * TRANSITION_SECONDS)
        .ceil()
        .max(1.0) as u32
}

/// All coefficient, exponential-knee and makeup preparation happens on the
/// control thread. Passing this Copy value never transfers an owned allocation
/// to the real-time callback.
#[derive(Clone, Copy, PartialEq)]
pub struct PreparedMastering {
    input: BiquadCoefficients,
    highpass: BiquadCoefficients,
    lowpass: BiquadCoefficients,
    curve: CompressionCurve,
    compressor_mix: f64,
    attack_step: f64,
    release_step: f64,
    manual_gain: f64,
}

impl PreparedMastering {
    pub fn new(sample_rate: u32, settings: Mastering) -> Self {
        // API validation reports bad settings; defensive construction also
        // prevents non-finite coefficients from any internal caller.
        let settings = if settings.validate().is_ok() {
            settings
        } else {
            Mastering::default()
        };
        let rate = f64::from(sample_rate.max(1));
        Self {
            input: BiquadCoefficients::new(
                sample_rate,
                settings.input_highpass_hz,
                true,
                10_f64.powf(f64::from(0.707_f32) / 20.0),
            ),
            highpass: BiquadCoefficients::new(
                sample_rate,
                settings.highpass_hz,
                true,
                std::f64::consts::FRAC_1_SQRT_2,
            ),
            lowpass: BiquadCoefficients::new(
                sample_rate,
                settings.lowpass_hz,
                false,
                std::f64::consts::FRAC_1_SQRT_2,
            ),
            curve: CompressionCurve::configured(settings),
            compressor_mix: if settings.compressor_enabled {
                1.0
            } else {
                0.0
            },
            attack_step: 10.0 / (rate * (settings.attack_ms / 1000.0)),
            release_step: 10.0 / (rate * (settings.release_ms / 1000.0)),
            manual_gain: to_linear(settings.makeup_db),
        }
    }
}

pub struct InputHighpass {
    filter: Biquad,
}

impl InputHighpass {
    #[cfg(test)]
    pub fn new(sample_rate: u32) -> Self {
        Self::new_with_mastering(
            sample_rate,
            PreparedMastering::new(sample_rate, Mastering::default()),
        )
    }

    pub fn new_with_mastering(sample_rate: u32, settings: PreparedMastering) -> Self {
        Self {
            filter: Biquad::new(settings.input, sample_rate),
        }
    }

    pub fn set_mastering(&mut self, settings: PreparedMastering) {
        self.filter.set(settings.input);
    }

    /// Apply after input trim and before input-pause gating. Independent state
    /// keeps stereo capture independent; mono capture supplies equal channels.
    pub fn process(&mut self, input: [f32; 2]) -> [f32; 2] {
        self.filter
            .process(input.map(f64::from))
            .map(|sample| sample as f32)
    }
}

#[derive(Clone, Copy, PartialEq)]
struct CompressionCurve {
    threshold: f64,
    threshold_db: f64,
    knee_db: f64,
    knee_end: f64,
    knee_factor: f64,
    knee_output_db: f64,
    makeup: f64,
    ratio: f64,
}

fn to_linear(decibels: f64) -> f64 {
    10_f64.powf(decibels / 20.0)
}

impl CompressionCurve {
    #[cfg(test)]
    fn new() -> Self {
        Self::configured(Mastering::default())
    }

    fn configured(settings: Mastering) -> Self {
        let threshold = to_linear(settings.threshold_db);
        let knee_end = to_linear(settings.threshold_db + settings.knee_db);
        // Solve the exponential knee's logarithmic derivative at its end.
        // Both transitions match first derivatives, so the static transfer
        // curve remains continuous through the soft knee and ratio region.
        let mut low: f64 = 0.1;
        let mut high: f64 = 10_000.0;
        let slope_at = |factor: f64| {
            let output = threshold - (-factor * (knee_end - threshold)).exp_m1() / factor;
            knee_end * (-factor * (knee_end - threshold)).exp() / output
        };
        // Preserve the original bracket for the original curve, but expand it
        // for narrow knees at -60 dB and gentle ratios with wide knees.
        if knee_end > threshold && settings.ratio > 1.0 {
            for _ in 0..32 {
                if slope_at(low) >= 1.0 / settings.ratio {
                    break;
                }
                low *= 0.1;
            }
            for _ in 0..32 {
                if slope_at(high) <= 1.0 / settings.ratio {
                    break;
                }
                high *= 10.0;
            }
        }
        for _ in 0..40 {
            let factor = (low * high).sqrt();
            let slope = slope_at(factor);
            if slope < 1.0 / settings.ratio {
                high = factor;
            } else {
                low = factor;
            }
        }
        let knee_factor = (low * high).sqrt();
        let knee_output =
            threshold - (-knee_factor * (knee_end - threshold)).exp_m1() / knee_factor;
        let mut curve = Self {
            threshold,
            threshold_db: settings.threshold_db,
            knee_db: settings.knee_db,
            knee_end,
            knee_factor,
            knee_output_db: 20.0 * knee_output.log10(),
            makeup: 1.0,
            ratio: settings.ratio,
        };
        if settings.auto_makeup {
            curve.makeup = curve.shape(1.0).powf(-0.6);
        }
        curve
    }

    fn shape(&self, amplitude: f64) -> f64 {
        if amplitude <= self.threshold || self.ratio == 1.0 {
            amplitude
        } else if amplitude < self.knee_end {
            self.threshold
                - (-self.knee_factor * (amplitude - self.threshold)).exp_m1() / self.knee_factor
        } else {
            to_linear(
                self.knee_output_db
                    + (20.0 * amplitude.log10() - self.threshold_db - self.knee_db) / self.ratio,
            )
        }
    }
}

pub struct OutputConditioner {
    curve: CompressionCurve,
    next_curve: CompressionCurve,
    curve_blend: f64,
    curve_remaining: u32,
    makeup: f64,
    lookahead: Vec<[f64; 2]>,
    cursor: usize,
    gain_db: f64,
    attack_step: f64,
    release_step: f64,
    highpass: Biquad,
    lowpass: Biquad,
    compressor_mix: f64,
    manual_gain: f64,
    target: PreparedMastering,
    remaining: u32,
    transition_frames: u32,
}

impl OutputConditioner {
    /// Control-thread construction only. Processing reuses all delay storage.
    #[cfg(test)]
    pub fn new(sample_rate: u32) -> Result<Self, String> {
        Self::new_with_mastering(
            sample_rate,
            PreparedMastering::new(sample_rate, Mastering::default()),
        )
    }

    pub fn new_with_mastering(
        sample_rate: u32,
        settings: PreparedMastering,
    ) -> Result<Self, String> {
        let frames = (f64::from(sample_rate) * LOOKAHEAD_SECONDS).floor() as usize;
        let mut lookahead = Vec::new();
        lookahead
            .try_reserve_exact(frames.max(1))
            .map_err(|error| format!("Cannot allocate output lookahead: {error}"))?;
        lookahead.resize(frames.max(1), [0.0; 2]);
        Ok(Self {
            curve: settings.curve,
            next_curve: settings.curve,
            curve_blend: 0.0,
            curve_remaining: 0,
            makeup: settings.curve.makeup,
            lookahead,
            cursor: 0,
            gain_db: 0.0,
            attack_step: settings.attack_step,
            release_step: settings.release_step,
            highpass: Biquad::new(settings.highpass, sample_rate),
            lowpass: Biquad::new(settings.lowpass, sample_rate),
            compressor_mix: settings.compressor_mix,
            manual_gain: settings.manual_gain,
            target: settings,
            remaining: 0,
            transition_frames: transition_frames(sample_rate),
        })
    }

    pub fn set_mastering(&mut self, settings: PreparedMastering) {
        self.highpass.set(settings.highpass);
        self.lowpass.set(settings.lowpass);
        if settings != self.target {
            self.target = settings;
            self.remaining = self.transition_frames;
            if self.curve_remaining == 0 && self.curve != settings.curve {
                self.start_curve_transition(settings.curve);
            }
        }
    }

    fn start_curve_transition(&mut self, curve: CompressionCurve) {
        self.next_curve = curve;
        self.curve_remaining = self.transition_frames;
        self.curve_blend = 0.0;
    }

    /// Positive attenuation, measured before makeup gain and master volume.
    pub fn gain_reduction_db(&self) -> f64 {
        -self.gain_db.min(0.0) * self.compressor_mix
    }

    /// Compress the complete wet + unsaturated dry mix, apply the browser's
    /// ceiling transfer, then apply the already-smoothed sqrt(master level).
    /// A shared detector preserves the input's stereo balance.
    pub fn process(&mut self, mix: [f64; 2], master_gain: f64) -> [f32; 2] {
        if self.remaining > 0 {
            let fraction = 1.0 / f64::from(self.remaining);
            self.makeup += (self.target.curve.makeup - self.makeup) * fraction;
            self.attack_step += (self.target.attack_step - self.attack_step) * fraction;
            self.release_step += (self.target.release_step - self.release_step) * fraction;
            self.compressor_mix += (self.target.compressor_mix - self.compressor_mix) * fraction;
            self.manual_gain += (self.target.manual_gain - self.manual_gain) * fraction;
            self.remaining -= 1;
        }
        if self.curve_remaining > 0 {
            self.curve_blend += (1.0 - self.curve_blend) / f64::from(self.curve_remaining);
            self.curve_remaining -= 1;
        }
        let mix = self.lowpass.process(self.highpass.process(mix));
        let peak = mix[0].abs().max(mix[1].abs());
        let target_db = if peak <= 0.0001 {
            0.0
        } else {
            let current = 20.0 * (self.curve.shape(peak) / peak).log10();
            let reduction = if self.curve_blend > 0.0 {
                let next = 20.0 * (self.next_curve.shape(peak) / peak).log10();
                current + (next - current) * self.curve_blend
            } else {
                current
            };
            reduction.min(0.0)
        };
        if self.curve_remaining == 0 && self.curve_blend > 0.0 {
            self.curve = self.next_curve;
            self.curve_blend = 0.0;
            // Rapid gestures replace the pending target rather than growing a
            // queue or interrupting an in-flight coherent transfer-curve fade.
            if self.curve != self.target.curve {
                self.start_curve_transition(self.target.curve);
            }
        }
        let difference = target_db - self.gain_db;
        self.gain_db += difference.clamp(-self.attack_step, self.release_step);
        // Keep detection warm while bypassed. The audible attenuation and
        // automatic makeup fade together, independent of the release time.
        let gain = to_linear(self.gain_db * self.compressor_mix)
            * (1.0 + (self.makeup - 1.0) * self.compressor_mix)
            * self.manual_gain;
        let delayed = std::mem::replace(&mut self.lookahead[self.cursor], mix);
        self.cursor += 1;
        if self.cursor == self.lookahead.len() {
            self.cursor = 0;
        }
        delayed.map(|sample| (ceiling_curve(sample * gain) * master_gain) as f32)
    }
}

/// WaveShaper interpolation of the original 2048-point Float32 ceiling table.
fn ceiling_curve(sample: f64) -> f64 {
    let position = (sample.clamp(-1.0, 1.0) + 1.0) * 0.5 * 2047.0;
    let index = position.floor() as usize;
    let fraction = position - index as f64;
    let table_value = |point: usize| {
        f64::from(((point as f64 / 2047.0 * 2.0 - 1.0).clamp(-CEILING, CEILING)) as f32)
    };
    table_value(index) * (1.0 - fraction) + table_value((index + 1).min(2047)) * fraction
}

#[cfg(test)]
mod tests {
    use super::*;

    fn highpass_magnitude(frequency: f64, sample_rate: u32) -> f64 {
        let mut filter = InputHighpass::new(sample_rate);
        let mut input_energy = 0.0;
        let mut output_energy = 0.0;
        for frame in 0..sample_rate * 2 {
            let sample = (std::f64::consts::TAU * frequency * f64::from(frame)
                / f64::from(sample_rate))
            .sin() as f32;
            let output = filter.process([sample, 0.0]);
            assert_eq!(output[1], 0.0, "Channel state must remain independent");
            if frame >= sample_rate {
                input_energy += f64::from(sample).powi(2);
                output_energy += f64::from(output[0]).powi(2);
            }
        }
        (output_energy / input_energy).sqrt()
    }

    #[test]
    fn input_highpass_matches_chromium_frequency_response_and_q_units() {
        // OfflineAudioContext 48k, BiquadFilter highpass frequency=55 Q=.707,
        // Chromium151 getFrequencyResponse. The resonant 55Hz gain is above1;
        // a conventional linear-Q=.707 implementation would fail this check.
        for (frequency, expected) in [
            (10.0, 0.033_685_449_510_812_76),
            (20.0, 0.142_143_055_796_623_23),
            (55.0, 1.084_800_839_424_133_3),
            (100.0, 1.159_687_042_236_328_1),
            (1000.0, 1.001_734_733_581_543),
        ] {
            let measured = highpass_magnitude(frequency, 48_000);
            assert!(
                (measured - expected).abs() < 1e-6,
                "{frequency} Hz: {measured}"
            );
        }
    }

    #[test]
    fn highpass_rejects_dc_and_preserves_equal_mono_channels_at_all_device_rates() {
        for rate in [8000, 44_100, 48_000, 96_000, 192_000] {
            let mut filter = InputHighpass::new(rate);
            let mut tail = [0.0; 2];
            for _ in 0..rate {
                tail = filter.process([0.75; 2]);
                assert_eq!(tail[0], tail[1]);
                assert!(tail[0].is_finite());
            }
            assert!(tail[0].abs() < 1e-10, "DC residue at {rate} Hz: {tail:?}");
        }
    }

    #[test]
    fn static_curve_has_identity_soft_knee_and_eighteen_to_one_upper_slope() {
        let curve = CompressionCurve::new();
        assert_eq!(curve.shape(0.1), 0.1);
        assert!((curve.shape(curve.threshold) - curve.threshold).abs() < 1e-14);
        let epsilon = 1e-6;
        let knee_left = curve.shape(curve.knee_end - epsilon);
        let knee_right = curve.shape(curve.knee_end + epsilon);
        assert!((knee_left - knee_right).abs() < epsilon);
        let output_db_difference = 20.0 * (curve.shape(1.0) / curve.shape(0.5)).log10();
        assert!((output_db_difference - 20.0 * 2_f64.log10() / 18.0).abs() < 1e-12);
        assert!(curve.makeup > 1.0);
    }

    #[test]
    fn quiet_signal_keeps_stereo_balance_and_receives_original_makeup_gain() {
        let mut conditioner = OutputConditioner::new(48_000).unwrap();
        let expected = [
            0.04 * conditioner.curve.makeup,
            -0.01 * conditioner.curve.makeup,
        ];
        let mut output = [0.0; 2];
        for _ in 0..1000 {
            output = conditioner.process([0.04, -0.01], 1.0);
        }
        for channel in 0..2 {
            assert!((f64::from(output[channel]) - expected[channel]).abs() < 1e-7);
        }
        assert!((output[0] / output[1] + 4.0).abs() < 1e-5);
    }

    #[test]
    fn settled_dynamics_match_browser_level_across_identity_knee_and_ratio_regions() {
        // Independent Chromium151 OfflineAudioContext 48k/2seconds, same
        // compressor parameters. This checks settled gain and stereo linking;
        // browser-specific onset/release envelopes remain an approximation.
        for (amplitude, expected) in [
            (0.04, 0.078_787_729_144_096_37),
            (0.25, 0.492_423_295_974_731_45),
            (0.4, 0.603_159_844_875_335_7),
            (1.0, 0.636_400_938_034_057_6),
        ] {
            let mut conditioner = OutputConditioner::new(48_000).unwrap();
            let mut output = [0.0; 2];
            for _ in 0..96_000 {
                output = conditioner.process([amplitude, amplitude * 0.5], 1.0);
            }
            assert!((f64::from(output[0]) - expected).abs() < 0.0002);
            assert!((output[0] / output[1] - 2.0).abs() < 1e-5);
        }
    }

    #[test]
    fn lookahead_delays_audio_by_six_milliseconds_without_resetting() {
        for rate in [8000, 48_000, 96_000, 192_000] {
            let mut conditioner = OutputConditioner::new(rate).unwrap();
            let expected = (f64::from(rate) * 0.006).floor() as usize;
            let mut onset = None;
            for frame in 0..expected + 4 {
                let output =
                    conditioner.process(if frame == 0 { [0.02; 2] } else { [0.0; 2] }, 1.0);
                if output[0] != 0.0 {
                    onset.get_or_insert(frame);
                }
            }
            assert_eq!(onset, Some(expected));
        }
    }

    #[test]
    fn loud_signal_compresses_and_release_recovers_smoothly() {
        let mut conditioner = OutputConditioner::new(48_000).unwrap();
        let mut output = [0.0; 2];
        for _ in 0..48_000 {
            output = conditioner.process([1.0, 0.5], 1.0);
        }
        assert!(output[0] > 0.3 && output[0] < 0.8);
        assert!((output[0] / output[1] - 2.0).abs() < 1e-6);
        let initial_gain_db = conditioner.gain_db;
        for _ in 0..480 {
            conditioner.process([0.0; 2], 1.0);
        }
        assert!(conditioner.gain_db > initial_gain_db);
        assert!(
            conditioner.gain_db < 0.0,
            "Release must not jump immediately to unity"
        );
        for _ in 0..48_000 {
            conditioner.process([0.0; 2], 1.0);
        }
        assert_eq!(conditioner.gain_db, 0.0);
    }

    #[test]
    fn ceiling_precedes_master_gain_and_muting_does_not_erase_dynamics() {
        let mut conditioner = OutputConditioner::new(48_000).unwrap();
        for _ in 0..1000 {
            let output = conditioner.process([100.0, -100.0], 0.25);
            assert!(output.iter().all(|sample| sample.abs() <= 0.235_001));
        }
        let gain_db = conditioner.gain_db;
        assert!(gain_db < 0.0);
        assert_eq!(conditioner.process([100.0, -100.0], 0.0), [0.0; 2]);
        assert_eq!(conditioner.gain_db, gain_db);
        assert!(ceiling_curve(0.7).abs() < 0.701);
        assert!((ceiling_curve(100.0) - f64::from(0.94_f32)).abs() < 1e-14);
        assert!((ceiling_curve(-100.0) + f64::from(0.94_f32)).abs() < 1e-14);
    }

    fn bypassed_mastering() -> Mastering {
        Mastering {
            input_highpass_hz: 0.0,
            compressor_enabled: false,
            auto_makeup: false,
            ..Mastering::default()
        }
    }

    fn output_filter_magnitude(rate: u32, frequency: f64, settings: Mastering) -> f64 {
        let mut conditioner =
            OutputConditioner::new_with_mastering(rate, PreparedMastering::new(rate, settings))
                .unwrap();
        let mut input_energy = 0.0;
        let mut output_energy = 0.0;
        for frame in 0..rate * 2 {
            let sample = 0.04
                * (std::f64::consts::TAU * frequency * f64::from(frame) / f64::from(rate)).sin();
            let output = conditioner.process([sample, 0.0], 1.0);
            assert_eq!(output[1], 0.0);
            if frame >= rate {
                input_energy += sample * sample;
                output_energy += f64::from(output[0]).powi(2);
            }
        }
        (output_energy / input_energy).sqrt()
    }

    #[test]
    fn bypass_preserves_capture_and_mix_with_fixed_latency_and_ceiling() {
        for rate in [8000, 44_100, 48_000, 96_000, 192_000] {
            let prepared = PreparedMastering::new(rate, bypassed_mastering());
            let mut input = InputHighpass::new_with_mastering(rate, prepared);
            assert_eq!(input.process([0.3, -0.2]), [0.3, -0.2]);
            let mut output = OutputConditioner::new_with_mastering(rate, prepared).unwrap();
            for _ in 0..rate / 10 {
                output.process([0.3, -0.2], 1.0);
            }
            let result = output.process([0.3, -0.2], 1.0);
            assert!((result[0] - 0.3).abs() < 1e-7);
            assert!((result[1] + 0.2).abs() < 1e-7);
            assert_eq!(output.gain_reduction_db(), 0.0);
            assert_eq!(
                output.lookahead.len(),
                (f64::from(rate) * 0.006).floor() as usize
            );
            for _ in 0..rate / 10 {
                let result = output.process([100.0, -100.0], 0.5);
                assert!(result.iter().all(|sample| sample.abs() <= 0.470_001));
            }
        }
    }

    #[test]
    fn master_filters_have_butterworth_cutoff_and_twelve_db_stopband() {
        for rate in [8000, 44_100, 48_000, 96_000, 192_000] {
            let highpass = Mastering {
                highpass_hz: 100.0,
                ..bypassed_mastering()
            };
            let lowpass = Mastering {
                lowpass_hz: 100.0,
                ..bypassed_mastering()
            };
            for settings in [highpass, lowpass] {
                let response = output_filter_magnitude(rate, 100.0, settings);
                assert!(
                    (response - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-6,
                    "Cutoff response at {rate} Hz: {response}"
                );
            }
            assert!(output_filter_magnitude(rate, 10.0, highpass) < 0.011);
            assert!(output_filter_magnitude(rate, 1000.0, highpass) > 0.999);
            assert!(output_filter_magnitude(rate, 1000.0, lowpass) < 0.011);
            assert!(output_filter_magnitude(rate, 10.0, lowpass) > 0.999);
        }
    }

    #[test]
    fn high_lpf_cutoffs_clamp_to_device_rate_and_crossed_filters_remain_finite() {
        for rate in [8000, 16_000, 44_100, 48_000, 96_000, 192_000] {
            let settings = Mastering {
                highpass_hz: 2000.0,
                lowpass_hz: 20_000.0,
                ..bypassed_mastering()
            };
            let prepared = PreparedMastering::new(rate, settings);
            let expected = BiquadCoefficients::new(
                rate,
                20_000_f64.min(f64::from(rate) * 0.45),
                false,
                std::f64::consts::FRAC_1_SQRT_2,
            );
            assert!(prepared.lowpass == expected);
            let mut conditioner = OutputConditioner::new_with_mastering(rate, prepared).unwrap();
            conditioner.set_mastering(PreparedMastering::new(
                rate,
                Mastering {
                    lowpass_hz: 1.0,
                    ..settings
                },
            ));
            for frame in 0..rate {
                let impulse = if frame == 0 { [1.0, -0.5] } else { [0.0; 2] };
                let output = conditioner.process(impulse, 1.0);
                assert!(output
                    .iter()
                    .all(|sample| sample.is_finite() && sample.abs() <= 0.940_001));
            }
        }
    }

    #[test]
    fn threshold_ratio_and_hard_knee_have_the_requested_transfer() {
        for threshold in [-60.0, -24.0, -12.0, 0.0] {
            for ratio in [1.0, 2.0, 4.0, 20.0] {
                let curve = CompressionCurve::configured(Mastering {
                    threshold_db: threshold,
                    knee_db: 0.0,
                    ratio,
                    auto_makeup: false,
                    ..Mastering::default()
                });
                let quiet = to_linear(threshold - 6.0);
                assert_eq!(curve.shape(quiet), quiet);
                for input_db in [threshold, threshold + 6.0, threshold + 20.0] {
                    let expected_db = threshold + (input_db - threshold) / ratio;
                    let actual_db = 20.0 * curve.shape(to_linear(input_db)).log10();
                    assert!((actual_db - expected_db).abs() < 1e-10);
                }
                assert_eq!(curve.makeup, 1.0);
            }
        }
    }

    #[test]
    fn soft_knee_matches_the_requested_ratio_at_extreme_thresholds_and_widths() {
        for threshold_db in [-60.0, -12.0, 0.0] {
            for knee_db in [0.01, 0.1, 5.0, 40.0] {
                for ratio in [1.01, 2.0, 20.0] {
                    let curve = CompressionCurve::configured(Mastering {
                        threshold_db,
                        knee_db,
                        ratio,
                        auto_makeup: false,
                        ..Mastering::default()
                    });
                    let knee_output = curve.threshold
                        - (-curve.knee_factor * (curve.knee_end - curve.threshold)).exp_m1()
                            / curve.knee_factor;
                    assert!((curve.shape(curve.knee_end) - knee_output).abs() < 1e-10);
                    let knee_slope = curve.knee_end
                        * (-curve.knee_factor * (curve.knee_end - curve.threshold)).exp()
                        / knee_output;
                    assert!((knee_slope - 1.0 / ratio).abs() < 1e-8,
                        "Threshold {threshold_db}, knee {knee_db}, ratio {ratio}: slope {knee_slope}");
                }
            }
        }
    }

    #[test]
    fn configurable_attack_release_and_reduction_meter_follow_the_signal() {
        let mut fast = OutputConditioner::new_with_mastering(
            48_000,
            PreparedMastering::new(
                48_000,
                Mastering {
                    attack_ms: 0.1,
                    release_ms: 10.0,
                    ..Mastering::default()
                },
            ),
        )
        .unwrap();
        let mut slow = OutputConditioner::new_with_mastering(
            48_000,
            PreparedMastering::new(
                48_000,
                Mastering {
                    attack_ms: 100.0,
                    release_ms: 1500.0,
                    ..Mastering::default()
                },
            ),
        )
        .unwrap();
        for _ in 0..1000 {
            fast.process([1.0; 2], 1.0);
            slow.process([1.0; 2], 1.0);
        }
        assert!(fast.gain_reduction_db() > slow.gain_reduction_db() + 5.0);
        for _ in 0..48_000 {
            fast.process([1.0; 2], 1.0);
            slow.process([1.0; 2], 1.0);
        }
        assert!((fast.gain_reduction_db() - slow.gain_reduction_db()).abs() < 1e-10);
        for _ in 0..1000 {
            fast.process([0.0; 2], 1.0);
            slow.process([0.0; 2], 1.0);
        }
        assert!(fast.gain_reduction_db() < slow.gain_reduction_db() - 5.0);
    }

    #[test]
    fn manual_makeup_applies_with_bypass_or_automatic_makeup_and_stays_before_ceiling() {
        for compressor_enabled in [false, true] {
            for auto_makeup in [false, true] {
                for makeup_db in [6.0, 12.0, 24.0] {
                    let settings = Mastering {
                        compressor_enabled,
                        auto_makeup,
                        makeup_db,
                        ..Mastering::default()
                    };
                    let mut conditioner = OutputConditioner::new_with_mastering(
                        48_000,
                        PreparedMastering::new(48_000, settings),
                    )
                    .unwrap();
                    let auto_gain = if compressor_enabled && auto_makeup {
                        conditioner.curve.makeup
                    } else {
                        1.0
                    };
                    let input = 0.02 / to_linear(makeup_db);
                    let expected = input * to_linear(makeup_db) * auto_gain;
                    for _ in 0..1000 {
                        conditioner.process([input; 2], 1.0);
                    }
                    assert!(
                        (f64::from(conditioner.process([input; 2], 1.0)[0]) - expected).abs()
                            < 1e-7
                    );
                    for _ in 0..48_000 {
                        let output = conditioner.process([10.0; 2], 0.5);
                        assert!(output[0] <= 0.470_001);
                    }
                }
            }
        }
    }

    #[test]
    fn live_mastering_edits_preserve_history_and_ramp_without_gain_steps() {
        let rate = 48_000;
        let initial = bypassed_mastering();
        let mut conditioner =
            OutputConditioner::new_with_mastering(rate, PreparedMastering::new(rate, initial))
                .unwrap();
        for _ in 0..1000 {
            conditioner.process([0.02; 2], 1.0);
        }
        let buffer_address = conditioner.lookahead.as_ptr();
        let mut previous = conditioner.process([0.02; 2], 1.0)[0];
        for makeup_db in [12.0, -12.0, 6.0, 0.0] {
            conditioner.set_mastering(PreparedMastering::new(
                rate,
                Mastering {
                    makeup_db,
                    ..initial
                },
            ));
            for _ in 0..transition_frames(rate) + 10 {
                let output = conditioner.process([0.02; 2], 1.0)[0];
                assert!(
                    (output - previous).abs() < 0.0001,
                    "Manual gain jumped from {previous} to {output}"
                );
                assert!(output > 0.0, "Editing must not empty the lookahead");
                previous = output;
            }
        }
        assert_eq!(buffer_address, conditioner.lookahead.as_ptr());
        assert_eq!(conditioner.remaining, 0);
    }

    #[test]
    fn rapid_compressor_edits_blend_coherent_curves_without_knee_gain_jumps() {
        let rate = 48_000;
        let initial = Mastering {
            ratio: 1.0,
            auto_makeup: false,
            attack_ms: 0.1,
            release_ms: 10.0,
            ..Mastering::default()
        };
        let mut conditioner =
            OutputConditioner::new_with_mastering(rate, PreparedMastering::new(rate, initial))
                .unwrap();
        for _ in 0..1000 {
            conditioner.process([0.2; 2], 1.0);
        }
        let mut previous = conditioner.process([0.2; 2], 1.0)[0];
        for frame in 0..rate {
            if frame % 480 == 0 {
                let t = f64::from(frame) / f64::from(rate);
                conditioner.set_mastering(PreparedMastering::new(
                    rate,
                    Mastering {
                        threshold_db: -60.0 * t,
                        knee_db: 40.0 * (1.0 - t),
                        ratio: 1.0 + 19.0 * t,
                        ..initial
                    },
                ));
            }
            let sample = 0.2
                + 0.02 * (std::f64::consts::TAU * 2.0 * f64::from(frame) / f64::from(rate)).sin();
            let output = conditioner.process([sample; 2], 1.0)[0];
            assert!(
                (output - previous).abs() < 0.001,
                "Compressor edit jumped from {previous} to {output}"
            );
            previous = output;
        }
        for _ in 0..transition_frames(rate) * 2 {
            conditioner.process([0.2; 2], 1.0);
        }
        assert_eq!(conditioner.curve_remaining, 0);
        assert!(conditioner.curve == conditioner.target.curve);
        let expected = conditioner.target.curve.shape(0.2);
        assert!((f64::from(conditioner.process([0.2; 2], 1.0)[0]) - expected).abs() < 1e-6);
    }

    #[test]
    fn live_compressor_bypass_finishes_its_fade_even_with_a_long_release() {
        let rate = 48_000;
        let settings = Mastering {
            threshold_db: -40.0,
            knee_db: 0.0,
            ratio: 20.0,
            attack_ms: 0.1,
            release_ms: 1500.0,
            auto_makeup: false,
            ..Mastering::default()
        };
        let mut conditioner =
            OutputConditioner::new_with_mastering(rate, PreparedMastering::new(rate, settings))
                .unwrap();
        for _ in 0..1000 {
            conditioner.process([0.1; 2], 1.0);
        }
        assert!(conditioner.gain_reduction_db() > 18.0);
        let mut previous = conditioner.process([0.1; 2], 1.0)[0];
        conditioner.set_mastering(PreparedMastering::new(
            rate,
            Mastering {
                compressor_enabled: false,
                ..settings
            },
        ));
        for _ in 0..transition_frames(rate) {
            let sample = conditioner.process([0.1; 2], 1.0)[0];
            assert!((sample - previous).abs() < 0.0002);
            previous = sample;
        }
        assert_eq!(conditioner.gain_reduction_db(), 0.0);
        assert!((previous - 0.1).abs() < 1e-7);
        assert!(
            conditioner.gain_db < -18.0,
            "The detector remains warm during bypass"
        );
    }

    #[test]
    fn frequent_filter_and_dynamics_sweeps_stay_bounded_at_every_device_rate() {
        for rate in [8000, 44_100, 48_000, 96_000, 192_000] {
            let prepared = PreparedMastering::new(rate, Mastering::default());
            let mut input = InputHighpass::new_with_mastering(rate, prepared);
            let mut output = OutputConditioner::new_with_mastering(rate, prepared).unwrap();
            for frame in 0..rate {
                if frame % (rate / 100) == 0 {
                    let t = f64::from(frame) / f64::from(rate);
                    let settings = Mastering {
                        input_highpass_hz: t * 2000.0,
                        highpass_hz: (1.0 - t) * 2000.0,
                        lowpass_hz: 1.0 + t * 19_999.0,
                        threshold_db: -60.0 * t,
                        knee_db: 40.0 * t,
                        ratio: 1.0 + 19.0 * t,
                        attack_ms: 0.1 + 99.9 * t,
                        release_ms: 10.0 + 1490.0 * t,
                        makeup_db: -12.0 + 36.0 * t,
                        compressor_enabled: frame % 2 == 0,
                        auto_makeup: frame % 3 != 0,
                    };
                    let prepared = PreparedMastering::new(rate, settings);
                    input.set_mastering(prepared);
                    output.set_mastering(prepared);
                }
                let signal = (std::f64::consts::TAU * 123.0 * f64::from(frame) / f64::from(rate))
                    .sin() as f32
                    * 0.3;
                let captured = input.process([signal, -signal * 0.5]);
                assert!(captured
                    .iter()
                    .all(|sample| sample.is_finite() && sample.abs() < 2.0));
                let processed = output.process(captured.map(f64::from), 1.0);
                assert!(processed
                    .iter()
                    .all(|sample| sample.is_finite() && sample.abs() <= 0.940_001));
            }
        }
    }
}
