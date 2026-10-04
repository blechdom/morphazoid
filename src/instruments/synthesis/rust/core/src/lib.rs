//! Portable monophonic synthesis demonstrations. Hosts own transport and output level.
//! All algorithms share one explicit note gate and ADSR; synthesis parameters are
//! normalized, smoothed and finite. Render performs no heap allocation.
mod controls;
mod conventional;
mod expanded;
mod historical;
pub mod polyphony;
pub mod processing;
pub use controls::{
    default_parameters, migrate_legacy_parameter, CONTROL_COUNTS, METHOD_COUNT, PARAM_COUNT,
};
#[cfg(feature = "neural")]
pub mod neural;
mod spectral;
mod spectral_processing;
mod test_signals;
use conventional::Conventional;

pub const BLOCK_FRAMES: usize = 128;
pub const SAMPLE_CAPACITY: usize = 262_144;
/// Static gain calibration operates before this emergency soft knee.
pub const OUTPUT_KNEE: f32 = 0.8;
pub const OUTPUT_CEILING: f32 = 0.95;
const OUTPUT_BASE_GAIN: f32 = 0.22;

fn protect_output(sample: f32) -> f32 {
    if sample.abs() <= OUTPUT_KNEE {
        sample
    } else {
        let width = OUTPUT_CEILING - OUTPUT_KNEE;
        sample.signum() * (OUTPUT_KNEE + width * ((sample.abs() - OUTPUT_KNEE) / width).tanh())
    }
}

fn bounded(value: f32, low: f32, high: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value.clamp(low, high)
    } else {
        fallback
    }
}

pub struct Engine {
    sample_rate: f32,
    method: u32,
    method_pending: bool,
    params: [f32; 16],
    smooth: [f32; 16],
    frequency: f32,
    frequency_target: f32,
    attack: f32,
    decay: f32,
    sustain: f32,
    release: f32,
    envelope: f32,
    envelope_stage: u8,
    release_step: f32,
    velocity: f32,
    gate: bool,
    smooth_coefficient: f32,
    level_trim_db: f32,
    output_gain: f32,
    output_gain_target: f32,
    dc_coefficient: f32,
    previous_input: f32,
    previous_output: f32,
    previous_signal: f32,
    transition_from: f32,
    audition_transition: bool,
    transition_left: u32,
    conventional: Conventional,
    historical: historical::HistoricalEngine,
    #[cfg(feature = "neural")]
    neural: neural::NeuralEngine,
    parameter_transfer: [f32; 16],
    output: [f32; BLOCK_FRAMES],
    transfer: Box<[f32]>,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        let sr = bounded(sample_rate, 8_000.0, 192_000.0, 48_000.0);
        Self {
            sample_rate: sr,
            method: 0,
            method_pending: false,
            params: default_parameters(0),
            smooth: default_parameters(0),
            frequency: 220.0,
            frequency_target: 220.0,
            attack: 0.01,
            decay: 0.25,
            sustain: 0.7,
            release: 0.35,
            envelope: 0.0,
            envelope_stage: 0,
            release_step: 0.0,
            velocity: 0.8,
            gate: false,
            smooth_coefficient: 1.0 - (-1.0 / (sr * 0.008)).exp(),
            level_trim_db: 0.0,
            output_gain: 1.0,
            output_gain_target: 1.0,
            dc_coefficient: (-std::f32::consts::TAU * 8.0 / sr).exp(),
            previous_input: 0.0,
            previous_output: 0.0,
            previous_signal: 0.0,
            transition_from: 0.0,
            audition_transition: false,
            transition_left: 0,
            conventional: Conventional::new(sr),
            historical: historical::HistoricalEngine::new(sr),
            #[cfg(feature = "neural")]
            neural: neural::NeuralEngine::new(sr),
            parameter_transfer: default_parameters(0),
            output: [0.0; BLOCK_FRAMES],
            transfer: vec![0.0; SAMPLE_CAPACITY].into_boxed_slice(),
        }
    }
    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }
    pub fn method(&self) -> u32 {
        self.method
    }
    pub fn is_held(&self) -> bool {
        self.gate
    }
    /// True while ADSR, transition or audible DC-filter release is unfinished.
    /// Polyphonic hosts can stop rendering the voice once this becomes false.
    pub fn is_active(&self) -> bool {
        self.envelope_stage != 0
            || self.transition_left != 0
            || self.previous_output.abs() * OUTPUT_BASE_GAIN > 1.0e-7
    }
    /// The host's static preset calibration, independent of velocity and ADSR.
    pub fn level_trim_db(&self) -> f32 {
        self.level_trim_db
    }
    /// Apply fixed trim after synthesis, before transition crossfades and DC
    /// removal, so saved transition/tail signals keep their original level.
    /// This is not AGC:
    /// held-note changes smooth over 8 ms, while idle/reset/new attacks snap to
    /// the target so a newly selected percussive preset retains its first strike.
    pub fn set_level_trim_db(&mut self, db: f32) {
        self.level_trim_db = bounded(db, -36.0, 48.0, 0.0);
        self.output_gain_target = 10.0_f32.powf(self.level_trim_db / 20.0);
        if self.envelope_stage == 0 {
            self.snap_output_gain();
        }
    }
    fn snap_output_gain(&mut self) {
        self.output_gain = self.output_gain_target;
    }
    pub fn set_method(&mut self, method: u32) {
        let method = method.min(METHOD_COUNT - 1);
        if self.method == method {
            return;
        }
        self.transition_from = self.previous_signal;
        self.audition_transition = false;
        self.transition_left = (self.sample_rate * 0.008) as u32;
        self.method = method;
        self.method_pending = true;
        self.conventional.set_method(method);
        #[cfg(feature = "neural")]
        self.neural.set_method(method);
        // Hosts set the method before its parameters. Excitation is deferred
        // until note_on/render sees the complete new configuration.
    }
    fn settle_method(&mut self) {
        self.smooth = self.params;
        self.frequency = self.frequency_target;
        self.method_pending = false;
        self.conventional
            .prepare(self.method, &self.params, self.frequency_target);
        self.historical
            .prepare(self.method, &self.params, self.frequency_target);
        #[cfg(feature = "neural")]
        self.neural.set_params(self.params);
    }
    /// Start a complete preset audition from its own model/ADSR state. Keep
    /// output histories for an 8 ms fade of the previous audible note. The new
    /// note retains its own ADSR: fading it in again would erase brief plucks.
    /// This is separate from note_on so ordinary held-note/legato excitation
    /// continues to use the instrument's existing model and envelope state.
    pub fn prepare_audition(&mut self) {
        self.transition_from = self.previous_signal;
        self.audition_transition = true;
        self.transition_left =
            if self.previous_signal.abs() > 1.0e-20 || self.previous_output.abs() > 1.0e-20 {
                (self.sample_rate * 0.008) as u32
            } else {
                0
            };
        self.gate = false;
        self.envelope = 0.0;
        self.envelope_stage = 0;
        self.release_step = 0.0;
        self.conventional.reset();
        self.historical.reset();
        #[cfg(feature = "neural")]
        self.neural.reset();
        self.settle_method();
        self.snap_output_gain();
    }
    pub fn set_params(&mut self, params: [f32; 16]) {
        for (i, value) in params.iter().enumerate() {
            self.params[i] = bounded(*value, 0.0, 1.0, 0.5);
        }
        if self.envelope_stage == 0 {
            self.smooth = self.params;
        }
        self.conventional
            .prepare(self.method, &self.params, self.frequency_target);
        self.historical
            .prepare(self.method, &self.params, self.frequency_target);
        #[cfg(feature = "neural")]
        self.neural.set_params(self.params);
    }
    pub fn set_frequency(&mut self, frequency: f32) {
        self.frequency_target = bounded(
            frequency,
            20.0,
            (self.sample_rate * 0.2).min(8_000.0),
            220.0,
        );
    }
    pub fn set_envelope(&mut self, attack: f32, decay: f32, sustain: f32, release: f32) {
        self.attack = bounded(attack, 0.001, 12.0, 0.01);
        self.decay = bounded(decay, 0.002, 12.0, 0.25);
        self.sustain = bounded(sustain, 0.0, 1.0, 0.7);
        self.release = bounded(release, 0.003, 16.0, 0.35);
    }
    pub fn note_on(&mut self, frequency: f32, velocity: f32) {
        self.set_frequency(frequency);
        if self.method_pending {
            self.settle_method();
            self.envelope = 0.0;
        }
        if self.envelope_stage == 0 {
            self.frequency = self.frequency_target;
        }
        self.snap_output_gain();
        self.velocity = bounded(velocity, 0.0, 1.0, 0.8);
        self.gate = true;
        self.envelope_stage = 1;
        self.conventional
            .prepare(self.method, &self.params, self.frequency_target);
        self.historical
            .prepare(self.method, &self.params, self.frequency_target);
        self.conventional
            .note_on(self.frequency_target, self.velocity, &self.params);
        self.historical.note_on(
            self.method,
            self.frequency_target,
            self.velocity,
            &self.params,
        );
        #[cfg(feature = "neural")]
        self.neural.note_on(self.velocity);
    }
    pub fn note_off(&mut self) {
        self.gate = false;
        if self.envelope_stage != 0 {
            self.envelope_stage = 4;
            self.release_step = self.envelope / (self.release * self.sample_rate);
        }
        #[cfg(feature = "neural")]
        self.neural.note_off();
    }
    pub fn reset(&mut self) {
        self.method_pending = false;
        self.gate = false;
        self.envelope = 0.0;
        self.envelope_stage = 0;
        self.frequency = self.frequency_target;
        self.smooth = self.params;
        self.output_gain = self.output_gain_target;
        self.previous_input = 0.0;
        self.previous_output = 0.0;
        self.previous_signal = 0.0;
        self.transition_left = 0;
        self.audition_transition = false;
        self.conventional.reset();
        self.historical.reset();
        #[cfg(feature = "neural")]
        self.neural.reset();
        self.output.fill(0.0);
    }
    pub fn load_sample(&mut self, sample: &[f32], sample_rate: f32) {
        self.conventional.load_sample(
            sample,
            bounded(sample_rate, 8_000.0, 192_000.0, self.sample_rate),
        );
        self.conventional
            .prepare(self.method, &self.params, self.frequency_target);
        self.historical
            .prepare(self.method, &self.params, self.frequency_target);
        self.transition_from = self.previous_signal;
        self.audition_transition = false;
        self.transition_left = (self.sample_rate * 0.008) as u32;
    }
    pub fn restore_source(&mut self) {
        self.transition_from = self.previous_signal;
        self.audition_transition = false;
        self.transition_left = (self.sample_rate * 0.008) as u32;
        self.conventional.restore_source();
        self.conventional
            .prepare(self.method, &self.params, self.frequency_target);
        self.historical
            .prepare(self.method, &self.params, self.frequency_target);
    }
    pub fn render(&mut self, output: &mut [f32]) {
        if self.method_pending {
            self.settle_method();
            if self.gate {
                // A different method is a new excitation, including its ADSR.
                // Keeping an old sustain stage would mute zero-sustain strikes.
                self.envelope = 0.0;
                self.envelope_stage = 1;
                self.conventional
                    .note_on(self.frequency, self.velocity, &self.params);
                self.historical
                    .note_on(self.method, self.frequency, self.velocity, &self.params);
                #[cfg(feature = "neural")]
                self.neural.note_on(self.velocity);
            }
        }
        #[cfg(feature = "neural")]
        self.neural.set_params(self.smooth);
        for out in output {
            self.output_gain +=
                (self.output_gain_target - self.output_gain) * self.smooth_coefficient;
            self.frequency += (self.frequency_target - self.frequency) * self.smooth_coefficient;
            for i in 0..PARAM_COUNT {
                self.smooth[i] += (self.params[i] - self.smooth[i]) * self.smooth_coefficient;
            }
            self.envelope = match self.envelope_stage {
                1 => {
                    let e = self.envelope + 1.0 / (self.attack * self.sample_rate);
                    if e >= 1.0 {
                        self.envelope_stage = 2;
                    }
                    e.min(1.0)
                }
                2 => {
                    let e = self.envelope - (1.0 - self.sustain) / (self.decay * self.sample_rate);
                    if e <= self.sustain {
                        self.envelope_stage = 3;
                    }
                    e.max(self.sustain)
                }
                3 => self.sustain,
                4 => {
                    let e = (self.envelope - self.release_step).max(0.0);
                    if e <= 0.0 {
                        self.envelope_stage = 0;
                    }
                    e
                }
                _ => 0.0,
            };
            let raw = if self.method >= 47 {
                self.historical
                    .sample(self.method, self.frequency, &self.smooth, self.gate)
            } else if (33..=36).contains(&self.method) {
                #[cfg(feature = "neural")]
                {
                    self.neural.sample(self.frequency)
                }
                #[cfg(not(feature = "neural"))]
                {
                    0.0
                }
            } else {
                self.conventional.sample(
                    self.method,
                    self.frequency,
                    &self.smooth,
                    self.gate,
                    self.envelope,
                )
            };
            let mut signal = if raw.is_finite() {
                raw.clamp(-16.0, 16.0) * self.envelope * self.velocity * self.output_gain
            } else {
                0.0
            };
            if self.transition_left > 0 {
                let ratio = self.transition_left as f32 / (self.sample_rate * 0.008);
                // Explicit auditions have an authored attack already. Fade only
                // the outgoing signal; ordinary held method changes crossfade.
                let incoming = if self.audition_transition { 1.0 } else { 1.0 - ratio };
                signal = self.transition_from * ratio + signal * incoming;
                self.transition_left -= 1;
            }
            self.previous_signal = signal;
            let hp = signal - self.previous_input + self.dc_coefficient * self.previous_output;
            self.previous_input = signal;
            self.previous_output = if hp.abs() < 1.0e-20 { 0.0 } else { hp };
            *out = protect_output(hp * OUTPUT_BASE_GAIN);
        }
    }
}

// One Engine per host/worklet. Pointers are valid only until synth_free; callers
// must serialize access. The fixed transfer buffer avoids allocator calls in audio.
#[no_mangle]
pub extern "C" fn synth_abi_version() -> u32 {
    2
}
#[no_mangle]
pub extern "C" fn synth_param_count() -> u32 {
    PARAM_COUNT as u32
}
#[no_mangle]
pub extern "C" fn synth_new(sr: f32) -> *mut Engine {
    Box::into_raw(Box::new(Engine::new(sr)))
}
#[no_mangle]
pub unsafe extern "C" fn synth_free(ptr: *mut Engine) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_set_method(ptr: *mut Engine, method: u32) {
    if let Some(e) = ptr.as_mut() {
        e.set_method(method);
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_set_param(ptr: *mut Engine, index: u32, value: f32) {
    if let Some(e) = ptr.as_mut() {
        if index < PARAM_COUNT as u32 {
            let mut p = e.params;
            p[index as usize] = value;
            e.set_params(p);
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_set_frequency(ptr: *mut Engine, hz: f32) {
    if let Some(e) = ptr.as_mut() {
        e.set_frequency(hz);
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_set_envelope(ptr: *mut Engine, a: f32, d: f32, s: f32, r: f32) {
    if let Some(e) = ptr.as_mut() {
        e.set_envelope(a, d, s, r);
    }
}
/// Additive ABI 2 extension; older hosts retain neutral 0 dB trim.
#[no_mangle]
pub unsafe extern "C" fn synth_set_level_trim_db(ptr: *mut Engine, db: f32) {
    if let Some(e) = ptr.as_mut() {
        e.set_level_trim_db(db);
    }
}
/// Additive ABI 2 extension for complete, independently calibrated auditions.
#[no_mangle]
pub unsafe extern "C" fn synth_prepare_audition(ptr: *mut Engine) {
    if let Some(e) = ptr.as_mut() {
        e.prepare_audition();
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_note_on(ptr: *mut Engine, hz: f32, velocity: f32) {
    if let Some(e) = ptr.as_mut() {
        e.note_on(hz, velocity);
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_note_off(ptr: *mut Engine) {
    if let Some(e) = ptr.as_mut() {
        e.note_off();
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_reset(ptr: *mut Engine) {
    if let Some(e) = ptr.as_mut() {
        e.reset();
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_output_ptr(ptr: *mut Engine) -> *mut f32 {
    ptr.as_mut()
        .map_or(std::ptr::null_mut(), |e| e.output.as_mut_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn synth_sample_ptr(ptr: *mut Engine) -> *mut f32 {
    ptr.as_mut()
        .map_or(std::ptr::null_mut(), |e| e.transfer.as_mut_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn synth_process(ptr: *mut Engine, frames: u32) -> u32 {
    if frames as usize > BLOCK_FRAMES {
        return 0;
    }
    if let Some(e) = ptr.as_mut() {
        let mut block = [0.0; BLOCK_FRAMES];
        e.render(&mut block[..frames as usize]);
        e.output[..frames as usize].copy_from_slice(&block[..frames as usize]);
        frames
    } else {
        0
    }
}
#[no_mangle]
pub unsafe extern "C" fn synth_load_sample(ptr: *mut Engine, len: u32, sr: f32) {
    if let Some(e) = ptr.as_mut() {
        let n = (len as usize).min(SAMPLE_CAPACITY);
        e.conventional.load_sample(
            &e.transfer[..n],
            bounded(sr, 8000.0, 192000.0, e.sample_rate),
        );
        e.conventional
            .prepare(e.method, &e.params, e.frequency_target);
        e.transition_from = e.previous_signal;
        e.audition_transition = false;
        e.transition_left = (e.sample_rate * 0.008) as u32;
    }
}

#[no_mangle]
pub unsafe extern "C" fn synth_restore_source(ptr: *mut Engine) {
    if let Some(e) = ptr.as_mut() {
        e.restore_source();
    }
}

#[no_mangle]
pub unsafe extern "C" fn synth_params_ptr(ptr: *mut Engine) -> *mut f32 {
    ptr.as_mut()
        .map_or(std::ptr::null_mut(), |e| e.parameter_transfer.as_mut_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn synth_apply_params(ptr: *mut Engine) {
    if let Some(e) = ptr.as_mut() {
        e.set_params(e.parameter_transfer);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rms(values: &[f32]) -> f32 {
        (values.iter().map(|x| x * x).sum::<f32>() / values.len() as f32).sqrt()
    }
    fn render(engine: &mut Engine, frames: usize) -> Vec<f32> {
        let mut out = vec![0.0; frames];
        engine.render(&mut out);
        out
    }
    fn patch(method: u32) -> [f32; 16] {
        let mut p = default_parameters(method);
        if method == 24 {
            p[..8].copy_from_slice(&[0.5, 0.85, 1.0, 0.7, 0.5, 0.15, 0.0, 0.3]);
        }
        p
    }
    fn active_methods() -> Vec<u32> {
        (0..METHOD_COUNT)
            .filter(|m| cfg!(feature = "neural") || !(33..=36).contains(m))
            .collect()
    }
    fn level_reference(trim_db: f32, velocity: f32, method: u32) -> Vec<f32> {
        let mut engine = Engine::new(48_000.0);
        engine.set_method(method);
        engine.set_params(patch(method));
        engine.set_envelope(0.002, 0.02, 0.4, 0.04);
        engine.set_level_trim_db(trim_db);
        engine.reset();
        engine.note_on(220.0, velocity);
        let mut samples = render(&mut engine, 6000);
        engine.note_off();
        samples.extend(render(&mut engine, 18_000));
        samples
    }
    #[test]
    fn static_trim_preserves_note_dynamics_release_and_struck_waveforms() {
        // Compare entire notes, including attacks and tails. A changing gain
        // envelope (AGC) would fail this samplewise fixed-ratio comparison.
        for method in [2, 16, 17, 19] {
            let original = level_reference(-6.0, 0.8, method);
            let louder = level_reference(0.0, 0.8, method);
            let ratio = 10.0_f32.powf(6.0 / 20.0);
            assert!(
                rms(&original) > 1.0e-5,
                "method {method} reference is audible"
            );
            assert!(louder.iter().all(|x| x.abs() < OUTPUT_KNEE));
            for (quiet, loud) in original.iter().zip(&louder) {
                assert!(
                    (loud - quiet * ratio).abs() < 2.0e-6,
                    "method {method} fixed trim"
                );
            }
            assert!(rms(&louder[20_000..]) < 1.0e-7, "method {method} releases");
        }
        let soft = level_reference(6.0, 0.4, 2);
        let hard = level_reference(6.0, 0.8, 2);
        assert!(hard.iter().all(|x| x.abs() < OUTPUT_KNEE));
        assert!(soft
            .iter()
            .zip(&hard)
            .all(|(a, b)| (b - 2.0 * a).abs() < 2.0e-6));
    }
    #[test]
    fn trim_changes_smooth_live_but_new_attacks_and_reset_use_the_target() {
        let mut engine = Engine::new(48_000.0);
        engine.set_level_trim_db(-12.0);
        assert_eq!(engine.output_gain, engine.output_gain_target);
        engine.note_on(220.0, 0.8);
        render(&mut engine, 128);
        let previous_gain = engine.output_gain;
        engine.set_level_trim_db(12.0);
        assert_eq!(
            engine.output_gain, previous_gain,
            "held sound does not jump"
        );
        render(&mut engine, 1);
        assert!(engine.output_gain > previous_gain);
        assert!(engine.output_gain - previous_gain < engine.output_gain_target * 0.01);
        render(&mut engine, 1920);
        assert!((engine.output_gain / engine.output_gain_target - 1.0).abs() < 0.01);
        // A preset audition releases the previous note immediately before it
        // sets the next trim and triggers a potentially very short strike.
        engine.note_off();
        engine.set_level_trim_db(30.0);
        assert_ne!(engine.output_gain, engine.output_gain_target);
        engine.note_on(220.0, 0.8);
        assert_eq!(engine.output_gain, engine.output_gain_target);
        engine.set_level_trim_db(-24.0);
        engine.reset();
        assert_eq!(engine.output_gain, engine.output_gain_target);
        assert!(render(&mut engine, 1024).iter().all(|x| *x == 0.0));
    }
    #[test]
    fn new_preset_trim_preserves_the_previous_method_transition_level() {
        let mut engine = Engine::new(48_000.0);
        engine.set_method(2);
        engine.set_params(patch(2));
        engine.set_envelope(0.001, 0.01, 1.0, 0.1);
        engine.reset();
        engine.note_on(220.0, 0.8);
        render(&mut engine, 4096);
        let expected_first =
            protect_output(engine.previous_output * engine.dc_coefficient * OUTPUT_BASE_GAIN);
        engine.note_off();
        engine.set_method(17);
        engine.set_params(patch(17));
        engine.set_level_trim_db(36.0);
        engine.note_on(220.0, 0.8);
        let first = render(&mut engine, 1)[0];
        assert!(
            (first - expected_first).abs() < 2.0e-6,
            "old tail: {first} vs {expected_first}"
        );
        assert_eq!(engine.output_gain, engine.output_gain_target);
        assert!(render(&mut engine, 4096)
            .iter()
            .all(|x| x.is_finite() && x.abs() <= OUTPUT_CEILING));
    }
    #[test]
    fn no_note_method_change_cannot_amplify_the_previous_method_tail() {
        fn transition(trim_db: f32) -> Vec<f32> {
            let mut engine = Engine::new(48_000.0);
            // A silent sampling target isolates the old method's crossfade/DC
            // tail from any intentional new-method gain. The note stays held.
            engine.load_sample(&[0.0; 256], 48_000.0);
            engine.set_method(2);
            engine.set_params(patch(2));
            engine.set_envelope(0.001, 0.01, 1.0, 0.1);
            engine.reset();
            engine.note_on(220.0, 0.8);
            render(&mut engine, 3982);
            engine.set_method(0);
            engine.set_params(patch(0));
            engine.set_level_trim_db(trim_db);
            assert!(engine.is_held());
            render(&mut engine, 4096)
        }
        let neutral = transition(0.0);
        assert!(rms(&neutral[..384]) > 0.001, "old tail remains measurable");
        for trim_db in [-36.0, 36.0, 48.0] {
            assert_eq!(
                neutral,
                transition(trim_db),
                "old tail is independent of new trim {trim_db}"
            );
        }
    }
    #[test]
    fn complete_audition_replaces_same_method_resonance_with_the_authored_note() {
        fn target(engine: &mut Engine) {
            let mut p = patch(17);
            p[0] = 0.8;
            p[1] = 0.65;
            p[2] = 0.37;
            engine.set_method(17);
            engine.set_params(p);
            engine.set_frequency(317.0);
            engine.set_envelope(0.004, 0.04, 0.7, 0.2);
            engine.set_level_trim_db(6.0);
        }
        let mut changed = Engine::new(48_000.0);
        changed.set_method(17);
        changed.set_params(patch(17));
        changed.set_envelope(0.001, 0.01, 1.0, 0.2);
        changed.reset();
        changed.note_on(173.0, 0.8);
        render(&mut changed, 8304);
        changed.note_off();
        target(&mut changed);
        changed.prepare_audition();
        changed.note_on(317.0, 0.8);
        let actual = render(&mut changed, 24_000);
        let mut fresh = Engine::new(48_000.0);
        target(&mut fresh);
        fresh.prepare_audition();
        fresh.note_on(317.0, 0.8);
        let expected = render(&mut fresh, 24_000);
        assert!(rms(&expected[12_000..]) > 0.001);
        let error = actual[12_000..]
            .iter()
            .zip(&expected[12_000..])
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(
            error < 2.0e-6,
            "old resonator state must not change the new preset: {error}"
        );
        // Same-method live macro edits and ordinary held-note attacks retain
        // their normal smoothing; complete audition preparation is explicit.
        let previous = changed.smooth;
        let mut edited = changed.params;
        edited[0] = 0.1;
        changed.set_params(edited);
        assert_eq!(changed.smooth, previous);
        changed.note_on(317.0, 0.8);
        assert_eq!(changed.smooth, previous);
    }
    #[test]
    fn audition_preserves_a_short_new_attack_over_a_quiet_previous_tail() {
        fn target(engine: &mut Engine) {
            engine.set_method(19);
            let mut params = default_parameters(19);
            params[0] = 0.2;
            params[1] = 0.17;
            params[2] = 0.84;
            params[3] = 0.85;
            params[4] = 0.65;
            params[5] = 0.25;
            params[6] = 0.25;
            params[7] = 0.9;
            params[8] = 0.45;
            engine.set_params(params);
            engine.set_frequency(947.0);
            engine.set_envelope(0.001, 0.2, 0.0, 0.2);
            engine.set_level_trim_db(12.0);
            engine.prepare_audition();
            engine.note_on(947.0, 0.8);
        }
        let mut fresh = Engine::new(48_000.0);
        target(&mut fresh);
        let expected = render(&mut fresh, 480);
        let mut used = Engine::new(48_000.0);
        used.set_method(2);
        used.set_params(patch(2));
        used.set_level_trim_db(-36.0);
        used.set_envelope(0.001, 0.01, 1.0, 0.1);
        used.note_on(220.0, 0.8);
        render(&mut used, 9600);
        used.note_off();
        target(&mut used);
        let actual = render(&mut used, 480);
        let ratio = rms(&actual) / rms(&expected);
        assert!(ratio > 0.98 && ratio < 1.02, "new attack energy must survive recall: {ratio}");
        assert!(actual.iter().all(|sample| sample.is_finite() && sample.abs() <= OUTPUT_CEILING));
    }
    #[test]
    fn sample_changes_keep_their_crossfade_after_a_preset_audition() {
        let source: Vec<_> = (0..4096)
            .map(|i| (i as f32 * std::f32::consts::TAU * 731.0 / 48_000.0).sin() * 0.6)
            .collect();
        for change in 0..3 {
            let mut ordinary = Engine::new(48_000.0);
            let mut auditioned = Engine::new(48_000.0);
            for engine in [&mut ordinary, &mut auditioned] {
                engine.set_params(patch(0));
                engine.set_envelope(0.001, 0.01, 1.0, 0.1);
                engine.reset();
            }
            auditioned.prepare_audition();
            for engine in [&mut ordinary, &mut auditioned] {
                engine.note_on(317.0, 0.8);
                render(engine, 4096);
                match change {
                    0 => engine.load_sample(&source, 48_000.0),
                    1 => engine.restore_source(),
                    _ => {
                        engine.transfer[..source.len()].copy_from_slice(&source);
                        unsafe { synth_load_sample(engine, source.len() as u32, 48_000.0); }
                    }
                }
            }
            let expected = render(&mut ordinary, 512);
            let actual = render(&mut auditioned, 512);
            let error = actual.iter().zip(&expected)
                .map(|(a, b)| (a - b).abs()).fold(0.0_f32, f32::max);
            assert!(error < 2.0e-6, "sample change {change} must keep its normal crossfade: {error}");
        }
    }
    #[test]
    fn held_method_changes_prepare_the_new_exciter_after_all_controls_arrive() {
        fn changed(previous_method: u32) -> Vec<f32> {
            let mut engine = Engine::new(48_000.0);
            engine.set_method(previous_method);
            engine.set_params(patch(previous_method));
            engine.set_envelope(0.001, 0.01, 1.0, 0.1);
            engine.reset();
            engine.note_on(220.0, 0.8);
            render(&mut engine, 8192);
            engine.set_method(44);
            engine.set_params(patch(44));
            engine.set_frequency(587.0);
            // No explicit note-on: a held CLAP method edit must initialize the
            // new membrane with its own controls, independent of the source.
            render(&mut engine, 24_000)
        }
        let from_pm = changed(12);
        let from_walsh = changed(3);
        let error = from_pm[12_000..]
            .iter()
            .zip(&from_walsh[12_000..])
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(
            error < 2.0e-6,
            "new model cannot inherit previous-method control mappings: {error}"
        );
    }
    #[test]
    fn held_method_change_starts_a_zero_sustain_strike_envelope() {
        let mut engine = Engine::new(48_000.0);
        engine.set_method(2);
        engine.set_params(patch(2));
        engine.set_envelope(0.001, 0.01, 0.8, 0.03);
        engine.reset();
        engine.note_on(220.0, 0.8);
        render(&mut engine, 8192);
        engine.set_method(17);
        engine.set_params(patch(17));
        engine.set_envelope(0.001, 0.04, 0.0, 0.03);
        let strike = render(&mut engine, 8192);
        assert!(
            engine.is_held(),
            "method selection preserves the host-held gate"
        );
        assert!(
            rms(&strike[512..1536]) > 0.001,
            "the new zero-sustain preset receives its attack"
        );
        assert!(
            rms(&strike[7680..]) < 0.00001,
            "the new strike follows its zero-sustain decay"
        );
    }
    #[test]
    fn calibrated_reset_is_deterministic_and_silence_stays_silent() {
        let mut engine = Engine::new(48_000.0);
        engine.set_method(17);
        engine.set_params(patch(17));
        engine.set_level_trim_db(24.0);
        engine.reset();
        assert!(render(&mut engine, 4096).iter().all(|x| *x == 0.0));
        engine.note_on(173.0, 0.7);
        let first = render(&mut engine, 4096);
        engine.set_level_trim_db(-12.0);
        render(&mut engine, 512);
        engine.set_level_trim_db(24.0);
        engine.reset();
        engine.note_on(173.0, 0.7);
        assert_eq!(first, render(&mut engine, 4096));
        engine.reset();
        engine.note_on(173.0, 0.0);
        assert!(render(&mut engine, 4096).iter().all(|x| *x == 0.0));
    }
    #[test]
    fn output_protection_is_linear_below_the_knee_and_bounds_extreme_trim() {
        for value in [-0.8, -0.6, -0.1, 0.0, 0.1, 0.6, 0.8] {
            assert_eq!(protect_output(value), value);
        }
        let mut previous = OUTPUT_KNEE;
        for i in 1..=1000 {
            let input = OUTPUT_KNEE + i as f32 * 0.01;
            let value = protect_output(input);
            assert!(value >= previous && value <= OUTPUT_CEILING);
            assert_eq!(protect_output(-input), -value);
            previous = value;
        }
        let mut engine = Engine::new(48_000.0);
        assert_eq!(engine.level_trim_db(), 0.0);
        engine.set_level_trim_db(99.0);
        assert_eq!(engine.level_trim_db(), 48.0);
        engine.note_on(220.0, 1.0);
        let loud = render(&mut engine, 4096);
        assert!(loud
            .iter()
            .all(|x| x.is_finite() && x.abs() <= OUTPUT_CEILING));
        assert!(loud.iter().any(|x| x.abs() > OUTPUT_KNEE));
        engine.set_level_trim_db(-99.0);
        assert_eq!(engine.level_trim_db(), -36.0);
        engine.set_level_trim_db(f32::NAN);
        assert_eq!(engine.level_trim_db(), 0.0);
        unsafe {
            let ptr = synth_new(48_000.0);
            synth_set_level_trim_db(ptr, 18.0);
            assert_eq!((*ptr).level_trim_db(), 18.0);
            assert_eq!(synth_abi_version(), 2);
            synth_set_level_trim_db(std::ptr::null_mut(), 18.0);
            synth_prepare_audition(ptr);
            synth_prepare_audition(std::ptr::null_mut());
            synth_free(ptr);
        }
    }
    #[test]
    fn every_algorithm_is_finite_bounded_playable_and_releases() {
        let mut engine = Engine::new(48000.0);
        let mut block = [0.0; 128];
        for method in active_methods() {
            engine.set_method(method);
            engine.set_params(patch(method));
            engine.reset();
            engine.set_envelope(0.004, 0.12, 0.7, 0.04);
            engine.note_on(220.0, 0.8);
            let output = render(&mut engine, 8192);
            assert!(
                output
                    .iter()
                    .all(|s| s.is_finite() && s.abs() <= OUTPUT_CEILING),
                "method {method}: finite bounded output"
            );
            assert!(
                rms(&output) > 0.00008,
                "method {method}: silent, RMS {}",
                rms(&output)
            );
            engine.note_off();
            for _ in 0..200 {
                engine.render(&mut block);
            }
            assert!(
                rms(&block) < 1.0e-6,
                "method {method}: did not release, {}",
                rms(&block)
            );
            engine.reset();
            engine.render(&mut block);
            assert_eq!(rms(&block), 0.0, "reset silence {method}");
        }
    }
    #[test]
    fn deterministic_reset_and_method_identity() {
        let mut engine = Engine::new(44100.0);
        let mut fingerprints = Vec::new();
        for method in active_methods() {
            engine.set_method(method);
            engine.set_params(patch(method));
            engine.reset();
            engine.note_on(173.0, 0.7);
            let first = render(&mut engine, 4096);
            engine.reset();
            engine.note_on(173.0, 0.7);
            let second = render(&mut engine, 4096);
            assert!(first == second, "method {method}: deterministic reset");
            let finger: Vec<_> = first
                .iter()
                .step_by(37)
                .map(|v| (*v * 100000.0) as i32)
                .collect();
            assert!(
                !fingerprints.contains(&finger),
                "method {method}: duplicate output"
            );
            fingerprints.push(finger);
        }
    }
    #[test]
    fn preset_parameter_changes_are_audible_and_controls_stay_bounded() {
        let mut engine = Engine::new(48000.0);
        for method in active_methods() {
            engine.set_method(method);
            let mut controls = patch(method);
            controls[0] = 0.2;
            engine.set_params(controls);
            engine.reset();
            engine.note_on(220.0, 0.7);
            let low = render(&mut engine, 4096);
            controls[0] = 0.8;
            engine.set_params(controls);
            engine.reset();
            engine.note_on(220.0, 0.7);
            let high = render(&mut engine, 4096);
            let distance = low
                .iter()
                .zip(&high)
                .map(|(a, b)| (a - b).abs())
                .sum::<f32>()
                / low.len() as f32;
            // Equal additive gain ratios intentionally change neither normalized spectrum nor gain.
            if method != 2 {
                assert!(
                    distance > 0.00001,
                    "method {method}: insensitive controls, {distance}"
                );
            }
            assert!(high
                .iter()
                .all(|v| v.is_finite() && v.abs() <= OUTPUT_CEILING));
        }
        engine.set_params([f32::NAN; 16]);
        engine.set_frequency(f32::INFINITY);
        assert!(render(&mut engine, 512).iter().all(|v| v.is_finite()));
    }
    #[test]
    fn holds_survive_method_changes_and_abi_is_bounded() {
        let mut engine = Engine::new(48000.0);
        engine.set_envelope(0.001, 0.01, 0.8, 0.08);
        engine.note_on(220.0, 0.8);
        let mut block = [0.0; 4096];
        engine.render(&mut block);
        for method in [2, 11, 16, 17, 19, 29, 31, 38] {
            engine.set_method(method);
            engine.set_params(patch(method));
            assert!(engine.is_held());
            engine.render(&mut block);
            assert!(rms(&block) > 0.00008, "held method {method}");
        }
        unsafe {
            let ptr = synth_new(48000.0);
            assert_eq!(synth_process(ptr, 129), 0);
            assert_eq!(synth_process(ptr, 128), 128);
            assert!(!synth_output_ptr(ptr).is_null());
            assert!(!synth_sample_ptr(ptr).is_null());
            assert!(!synth_params_ptr(ptr).is_null());
            synth_apply_params(ptr);
            synth_free(ptr);
        }
    }
    #[test]
    fn uploaded_source_changes_sampling_lpc_granular_vocoder_and_corpus() {
        let source: Vec<_> = (0..16384)
            .map(|i| (i as f32 * std::f32::consts::TAU * 731.0 / 48000.0).sin() * 0.6)
            .collect();
        for method in [0, 6, 8, 28, 30] {
            let mut engine = Engine::new(48000.0);
            engine.set_method(method);
            engine.set_params(patch(method));
            engine.reset();
            engine.note_on(220.0, 0.8);
            let before = render(&mut engine, 4096);
            engine.load_sample(&source, 48000.0);
            engine.reset();
            engine.note_on(220.0, 0.8);
            let after = render(&mut engine, 4096);
            assert!(after.iter().all(|s| s.is_finite()));
            assert!(before != after, "uploaded source changes method {method}");
            assert!(rms(&after) > 0.00001, "uploaded source method {method}");
        }
    }
    fn alias_fraction(engine: &mut Engine, method: u32, parameters: [f32; 16]) -> f32 {
        const N: usize = 4096;
        const BIN: usize = 401;
        engine.set_method(method);
        engine.set_params(parameters);
        engine.set_envelope(0.001, 0.01, 0.7, 0.02);
        engine.reset();
        engine.note_on(48000.0 * BIN as f32 / N as f32, 0.7);
        render(engine, 4096);
        let mut re = render(engine, N);
        let mut im = vec![0.0; N];
        for (i, x) in re.iter_mut().enumerate() {
            *x *= 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / N as f32).cos();
        }
        spectral::fft(&mut re, &mut im, false);
        let mut alias = 0.0;
        let mut total = 0.0;
        for k in 3..N / 2 {
            let energy = re[k] * re[k] + im[k] * im[k];
            total += energy;
            if !(1..=N / 2 / BIN).any(|h| k.abs_diff(h * BIN) <= 2) {
                alias += energy;
            }
        }
        alias / total.max(1.0e-12)
    }
    #[test]
    fn antialias_algorithms_reduce_out_of_band_foldback() {
        let mut engine = Engine::new(48000.0);
        let mut p = default_parameters(37);
        p[0] = 0.0;
        p[2] = 0.0;
        p[3] = 0.0;
        p[1] = 0.5;
        let naive = alias_fraction(&mut engine, 37, p);
        for (index, name) in [(1, "polyBLEP"), (2, "DPW"), (3, "minBLEP")] {
            p[0] = index as f32 / 3.0;
            let filtered = alias_fraction(&mut engine, 37, p);
            assert!(
                filtered < naive * 0.92,
                "{name} alias {filtered} versus naive {naive}"
            );
        }
        p = default_parameters(38);
        p[2] = 0.0;
        p[3] = 0.0;
        p[0] = 0.85;
        p[1] = 0.5;
        let direct = alias_fraction(&mut engine, 38, p);
        p[2] = 1.0;
        let adaa = alias_fraction(&mut engine, 38, p);
        assert!(adaa < direct, "ADAA alias {adaa} versus direct {direct}");
    }
    #[test]
    fn extreme_parameters_are_finite_at_supported_sample_rates() {
        for sr in [8000.0, 44100.0, 96000.0, 192000.0] {
            let mut engine = Engine::new(sr);
            for method in active_methods() {
                engine.set_method(method);
                for extreme in [0.0, 1.0] {
                    engine.set_params([extreme; 16]);
                    engine.reset();
                    engine.note_on((sr * 0.12).min(6000.0), 1.0);
                    let output = render(&mut engine, 2048);
                    assert!(
                        output
                            .iter()
                            .all(|v| v.is_finite() && v.abs() <= OUTPUT_CEILING),
                        "method {method}, sample rate {sr}, extreme {extreme}"
                    );
                }
            }
        }
    }
    #[test]
    fn uploaded_source_can_be_restored_exactly_without_losing_held_gate() {
        let mut engine = Engine::new(48_000.0);
        let source: Vec<_> = (0..16_384)
            .map(|i| (i as f32 * std::f32::consts::TAU * 731.0 / 48_000.0).sin() * 0.6)
            .collect();
        for method in [0, 6, 8, 28, 30] {
            engine.set_method(method);
            engine.set_params(patch(method));
            engine.reset();
            engine.note_on(220.0, 0.8);
            let original = render(&mut engine, 4096);
            engine.load_sample(&source, 48_000.0);
            engine.reset();
            engine.note_on(220.0, 0.8);
            let uploaded = render(&mut engine, 4096);
            assert!(original != uploaded, "upload changes method {method}");
            engine.restore_source();
            assert!(engine.is_held(), "restore preserves the held gate");
            assert!(render(&mut engine, 512).iter().all(|v| v.is_finite()));
            engine.reset();
            engine.note_on(220.0, 0.8);
            let restored = render(&mut engine, 4096);
            assert!(
                original == restored,
                "restore recovers exact original source for method {method}"
            );
        }
    }
}
