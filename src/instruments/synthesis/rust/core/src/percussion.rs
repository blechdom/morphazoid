//! Small multitimbral percussion bank, independent of the large teaching Engine.
//! Original, deliberately reduced mechanisms; not hardware/ROM emulations.
//! Models: swept analog oscillator/noise, filtered noise/metal, swept membrane
//! partials, two-operator FM, damped modal partials, and cached PCM playback.
//! Modal construction follows the general damped-mode model described in
//! Julius O. Smith, Physical Audio Signal Processing, "Modal Expansion".
//! Allocation and procedural PCM preparation occur only in new(), never render.
use std::f32::consts::{FRAC_PI_4, TAU};

pub const LANES: usize = 8;
pub const MAX_VOICES: usize = 24;
pub const FRAMES: usize = 128;
const PCM_RATE: f32 = 22050.0;
const PCM_FRAMES: usize = 16384;
const REFERENCES: [f32; LANES] = [60.0, 180.0, 4500.0, 3900.0, 140.0, 600.0, 900.0, 560.0];
const METAL: [f32; 6] = [0.271, 0.419, 0.637, 0.893, 1.231, 1.873];

fn bounded(value: f32, low: f32, high: f32, fallback: f32) -> f32 {
    if value.is_finite() { value.clamp(low, high) } else { fallback }
}
fn noise(seed: &mut u32) -> f32 {
    *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    ((*seed >> 8) as f32 / 8388608.0) - 1.0
}
fn protect(value: f32) -> f32 {
    if !value.is_finite() { return 0.0; }
    if value.abs() <= 0.8 { value } else { value.signum() * (0.8 + 0.15 * ((value.abs() - 0.8) / 0.15).tanh()) }
}

#[derive(Clone, Copy, Debug)]
pub struct Settings {
    pub model: u32, pub frequency: f32, pub decay: f32, pub tone: f32,
    pub noise: f32, pub sweep: f32, pub ratio: f32, pub index: f32,
    pub level: f32, pub pan: f32,
}
impl Default for Settings {
    fn default() -> Self {
        Self { model: 0, frequency: 60.0, decay: 0.35, tone: 0.4, noise: 0.05,
            sweep: 16.0, ratio: 1.5, index: 3.0, level: 0.7, pan: 0.0 }
    }
}
impl Settings {
    fn clean(mut self) -> Self {
        self.model = self.model.min(5);
        self.frequency = bounded(self.frequency, 20.0, 8000.0, 60.0);
        self.decay = bounded(self.decay, 0.03, 3.0, 0.35);
        self.tone = bounded(self.tone, 0.0, 1.0, 0.4);
        self.noise = bounded(self.noise, 0.0, 1.0, 0.05);
        self.sweep = bounded(self.sweep, -24.0, 48.0, 0.0);
        self.ratio = bounded(self.ratio, 0.125, 16.0, 1.5);
        self.index = bounded(self.index, 0.0, 20.0, 3.0);
        self.level = bounded(self.level, 0.0, 1.0, 0.7);
        self.pan = bounded(self.pan, -1.0, 1.0, 0.0);
        self
    }
}

#[derive(Clone, Copy)]
struct Voice {
    active: bool, lane: usize, settings: Settings, age: u32, duration: u32,
    serial: u64, phase: [f32; 6], amplitude: [f32; 6], damping: [f32; 6],
    env: f32, env_mul: f32, bend: f32, bend_mul: f32, seed: u32,
    low: f32, filter: f32, gain: f32, pan: [f32; 2], pcm: f32, pcm_step: f32,
    release: u32, release_total: u32, last: [f32; 2],
}
impl Default for Voice {
    fn default() -> Self {
        Self { active: false, lane: 0, settings: Settings::default(), age: 0, duration: 1,
            serial: 0, phase: [0.0; 6], amplitude: [0.0; 6], damping: [0.0; 6],
            env: 1.0, env_mul: 0.0, bend: 0.0, bend_mul: 0.0, seed: 1,
            low: 0.0, filter: 0.0, gain: 0.0, pan: [0.0; 2], pcm: 0.0, pcm_step: 1.0,
            release: 0, release_total: 0, last: [0.0; 2] }
    }
}
#[derive(Clone, Copy, Default)]
struct Retired { sample: [f32; 2], left: u32, total: u32 }

pub struct DrumBank {
    sr: f32, settings: [Settings; LANES], voices: [Voice; MAX_VOICES],
    retired: [Retired; MAX_VOICES], pcm: Box<[f32]>, output: [[f32; FRAMES]; 2],
    serial: u64, previous_input: [f32; 2], previous_output: [f32; 2], dc: f32,
}
impl DrumBank {
    pub fn new(sr: f32) -> Self {
        let sr = bounded(sr, 8000.0, 192000.0, 48000.0);
        let mut pcm = vec![0.0; LANES * PCM_FRAMES].into_boxed_slice();
        // Eight original synthetic one-shots. These immutable, low-rate PCM
        // sources are actually read/resampled by model 5, not regenerated per hit.
        // No manufacturer samples, recordings, or third-party ROM data are used.
        for lane in 0..LANES {
            let mut seed = 0x6f21_ab19 ^ lane as u32;
            let mut low = 0.0;
            for i in 0..PCM_FRAMES {
                let t = i as f32 / PCM_RATE;
                let white = noise(&mut seed);
                low += (white - low) * 0.2;
                let high = white - low;
                let phase = TAU * REFERENCES[lane] * t;
                let attack = (t / 0.001).min(1.0);
                let value = match lane {
                    0 => (TAU * 60.0 * (t + 0.035 * (1.0 - (-t / 0.018).exp()))).sin() * (-t * 14.0).exp(),
                    1 => (phase.sin() * 0.35 + high * 0.8) * (-t * 28.0).exp(),
                    2 | 3 => { let metal = METAL.iter().map(|r| (phase * r).sin()).sum::<f32>() / 6.0;
                        (high * 0.65 + metal * 0.35) * (-t * if lane == 2 { 90.0 } else { 14.0 }).exp() },
                    4 => (phase.sin() + 0.3 * (phase * 1.593).sin()) * (-t * 17.0).exp(),
                    5 => ((phase * 1.0).sin() + 0.7 * (phase * 1.47).sin()) * (-t * 70.0).exp(),
                    6 => { let pulses = [0.0, 0.011, 0.023].iter().map(|start| if t >= *start { (-(t - start) * 90.0).exp() } else { 0.0 }).sum::<f32>();
                        high * (pulses * 0.55 + (-t * 18.0).exp() * 0.25) },
                    _ => (phase.sin() + 0.5 * (phase * 1.483).sin() + 0.25 * (phase * 2.718).sin()) * (-t * 11.0).exp(),
                };
                let fade = ((PCM_FRAMES - 1 - i) as f32 / 220.0).min(1.0);
                pcm[lane * PCM_FRAMES + i] = ((value * attack * fade).clamp(-1.0, 1.0) * 2047.0).round() / 2047.0;
            }
        }
        Self { sr, settings: [Settings::default(); LANES], voices: [Voice::default(); MAX_VOICES],
            retired: [Retired::default(); MAX_VOICES], pcm, output: [[0.0; FRAMES]; 2],
            serial: 0, previous_input: [0.0; 2], previous_output: [0.0; 2], dc: (-TAU * 8.0 / sr).exp() }
    }
    pub fn set_voice(&mut self, lane: usize, settings: Settings) {
        if lane < LANES { self.settings[lane] = settings.clean(); }
    }
    pub fn note(&mut self, lane: usize, velocity: f32, ratio: f32) {
        if lane >= LANES { return; }
        let velocity = bounded(velocity, 0.0, 1.0, 0.0);
        let mut settings = self.settings[lane];
        if velocity <= 0.0 || settings.level <= 0.0 { return; }
        settings.frequency = (settings.frequency * bounded(ratio, 0.0625, 16.0, 1.0)).clamp(20.0, (self.sr * 0.42).min(12000.0));
        // Fixed kit contract: closed hat (2) chokes open hat (3), with a 6ms
        // release rather than a waveform discontinuity. Other lanes overlap.
        if lane == 2 {
            for voice in &mut self.voices {
                if voice.active && voice.lane == 3 { voice.release = (self.sr * 0.006) as u32; voice.release_total = voice.release; }
            }
        }
        let slot = self.voices.iter().position(|v| !v.active).unwrap_or_else(|| {
            self.voices.iter().enumerate().min_by_key(|(_, v)| v.serial).map(|(i, _)| i).unwrap_or(0)
        });
        if self.voices[slot].active {
            self.retired[slot] = Retired { sample: self.voices[slot].last, left: (self.sr * 0.004) as u32, total: (self.sr * 0.004) as u32 };
        }
        self.serial = self.serial.wrapping_add(1);
        let env_mul = (-6.907755 / (self.sr * settings.decay)).exp();
        self.voices[slot] = Voice { active: true, lane, settings, serial: self.serial,
            duration: (self.sr * settings.decay).ceil() as u32, env_mul,
            damping: std::array::from_fn(|i| (-6.907755 * (1.0 + i as f32 * (1.0 - settings.tone) * 0.8) / (self.sr * settings.decay)).exp()),
            amplitude: std::array::from_fn(|i| 1.0 / (1.0 + i as f32 * (1.4 - settings.tone))),
            bend: 2.0_f32.powf(settings.sweep / 12.0) - 1.0,
            bend_mul: (-1.0 / (self.sr * (0.009 + settings.decay * 0.085))).exp(),
            seed: 0x63af_216d ^ (self.serial as u32).wrapping_mul(0x9e37_79b9) ^ lane as u32,
            filter: 1.0 - (-TAU * (300.0 + settings.tone * settings.tone * 14500.0).min(self.sr * 0.42) / self.sr).exp(),
            gain: velocity * settings.level * 0.45,
            pan: [((settings.pan + 1.0) * FRAC_PI_4).cos(), ((settings.pan + 1.0) * FRAC_PI_4).sin()],
            pcm_step: PCM_RATE / self.sr * settings.frequency / REFERENCES[lane],
            ..Voice::default() };
    }
    pub fn active(&self) -> bool {
        self.voices.iter().any(|v| v.active) || self.retired.iter().any(|v| v.left > 0)
            || self.previous_output.iter().any(|v| v.abs() > 1e-7)
    }
    pub fn reset(&mut self) {
        self.voices.fill(Voice::default()); self.retired.fill(Retired::default());
        self.output.fill([0.0; FRAMES]); self.previous_input = [0.0; 2]; self.previous_output = [0.0; 2]; self.serial = 0;
    }
    fn oscillator(voice: &mut Voice, index: usize, frequency: f32, sr: f32) -> f32 {
        if frequency >= sr * 0.47 { return 0.0; }
        voice.phase[index] = (voice.phase[index] + frequency / sr).fract();
        (TAU * voice.phase[index]).sin()
    }
    pub fn process(&mut self, frames: usize) -> usize {
        if frames > FRAMES { return 0; }
        for i in 0..frames {
            let mut mixed = [0.0; 2];
            for v in &mut self.voices {
                if !v.active { continue; }
                let s = v.settings;
                let frequency = (s.frequency * (1.0 + v.bend)).clamp(20.0, self.sr * 0.44);
                let white = noise(&mut v.seed);
                v.low += (white - v.low) * (0.06 + s.tone * 0.55);
                let colored = if s.frequency > 1200.0 { white - v.low } else { v.low };
                let sample = match s.model {
                    0 => { let sine = Self::oscillator(v, 0, frequency, self.sr);
                        let overtone = Self::oscillator(v, 1, frequency * 2.0, self.sr);
                        ((sine + s.tone * 0.3 * overtone) * (1.0 - s.noise * 0.65) + colored * s.noise) * v.env },
                    1 => { let metal = METAL.iter().enumerate().map(|(n, ratio)| Self::oscillator(v, n, frequency * ratio, self.sr)).sum::<f32>() / 6.0;
                        (colored * (1.0 - s.tone * 0.7) * (0.35 + s.noise * 0.65) + metal * s.tone * 0.9) * v.env },
                    2 => { let mut body = 0.0;
                        for (n, ratio) in [1.0, 1.593, 2.136, 2.296].iter().enumerate() {
                            body += Self::oscillator(v, n, frequency * ratio, self.sr) * v.amplitude[n]; v.amplitude[n] *= v.damping[n];
                        }
                        body * 0.58 + colored * s.noise * v.env * 0.55 },
                    3 => { let modulator = Self::oscillator(v, 1, frequency * s.ratio, self.sr);
                        v.phase[0] = (v.phase[0] + frequency / self.sr).fract();
                        let index = s.index.min((self.sr * 0.44 / frequency - 1.0).max(0.0)) * v.env;
                        ((TAU * v.phase[0] + modulator * index).sin() + colored * s.noise * 0.45) * v.env },
                    4 => { let mut body = 0.0;
                        for n in 0..6 {
                            let harmonic = n as f32 + 1.0;
                            let ratio = harmonic + s.tone * (harmonic * harmonic * 0.27 - harmonic + 1.0);
                            body += Self::oscillator(v, n, frequency * ratio, self.sr) * v.amplitude[n]; v.amplitude[n] *= v.damping[n];
                        }
                        body * 0.45 + colored * s.noise * v.env * 0.25 },
                    _ => { let position = v.pcm.floor() as usize;
                        if position >= PCM_FRAMES - 1 { v.active = false; v.last = [0.0; 2]; continue; }
                        let fraction = v.pcm - position as f32; let base = v.lane * PCM_FRAMES + position;
                        let raw = self.pcm[base] + (self.pcm[base + 1] - self.pcm[base]) * fraction;
                        v.pcm += v.pcm_step * (1.0 + v.bend).max(0.0625);
                        v.filter = v.filter.clamp(0.0, 1.0);
                        // `phase[5]` is unused by PCM and owns its reconstruction filter.
                        v.phase[5] += (raw - v.phase[5]) * v.filter;
                        (v.phase[5] + colored * s.noise * 0.15) * v.env },
                };
                let attack = (v.age as f32 / (self.sr * 0.0012)).min(1.0);
                let ending = ((v.duration.saturating_sub(v.age)) as f32 / (self.sr * 0.004)).min(1.0);
                let release = if v.release_total > 0 { v.release as f32 / v.release_total as f32 } else { 1.0 };
                let value = if sample.is_finite() { sample * v.gain * attack * ending * release } else { 0.0 };
                v.last = [value * v.pan[0], value * v.pan[1]];
                mixed[0] += v.last[0]; mixed[1] += v.last[1];
                v.env *= v.env_mul; v.bend *= v.bend_mul; v.age += 1;
                if v.release_total > 0 { v.release = v.release.saturating_sub(1); }
                if v.age >= v.duration || v.release_total > 0 && v.release == 0 { v.active = false; }
            }
            for retired in &mut self.retired {
                if retired.left == 0 { continue; }
                let gain = retired.left as f32 / retired.total.max(1) as f32;
                mixed[0] += retired.sample[0] * gain; mixed[1] += retired.sample[1] * gain; retired.left -= 1;
            }
            for c in 0..2 {
                let value = mixed[c] - self.previous_input[c] + self.dc * self.previous_output[c];
                self.previous_input[c] = mixed[c];
                self.previous_output[c] = if value.is_finite() && value.abs() > 1e-20 { value } else { 0.0 };
                self.output[c][i] = protect(self.previous_output[c]);
            }
        }
        frames
    }
}

#[no_mangle] pub extern "C" fn drum_abi_version() -> u32 { 1 }
#[no_mangle] pub extern "C" fn drum_new(sr: f32) -> *mut DrumBank { Box::into_raw(Box::new(DrumBank::new(sr))) }
#[no_mangle] pub unsafe extern "C" fn drum_free(ptr: *mut DrumBank) { if !ptr.is_null() { drop(Box::from_raw(ptr)); } }
#[no_mangle] pub unsafe extern "C" fn drum_set_voice(ptr: *mut DrumBank, lane: u32, model: u32, frequency: f32, decay: f32, tone: f32, noise: f32, sweep: f32, ratio: f32, index: f32, level: f32, pan: f32) {
    if let Some(bank) = ptr.as_mut() { bank.set_voice(lane as usize, Settings { model, frequency, decay, tone, noise, sweep, ratio, index, level, pan }); }
}
#[no_mangle] pub unsafe extern "C" fn drum_note(ptr: *mut DrumBank, lane: u32, velocity: f32, ratio: f32) { if let Some(bank) = ptr.as_mut() { bank.note(lane as usize, velocity, ratio); } }
#[no_mangle] pub unsafe extern "C" fn drum_reset(ptr: *mut DrumBank) { if let Some(bank) = ptr.as_mut() { bank.reset(); } }
#[no_mangle] pub unsafe extern "C" fn drum_active(ptr: *const DrumBank) -> u32 { ptr.as_ref().map_or(0, |bank| bank.active() as u32) }
#[no_mangle] pub unsafe extern "C" fn drum_process(ptr: *mut DrumBank, frames: u32) -> u32 { ptr.as_mut().map_or(0, |bank| bank.process(frames as usize) as u32) }
#[no_mangle] pub unsafe extern "C" fn drum_output_ptr(ptr: *mut DrumBank, channel: u32) -> *mut f32 { ptr.as_mut().filter(|_| channel < 2).map_or(std::ptr::null_mut(), |bank| bank.output[channel as usize].as_mut_ptr()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn render(bank: &mut DrumBank, frames: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(frames);
        for offset in (0..frames).step_by(FRAMES) {
            let n = (frames - offset).min(FRAMES); assert_eq!(bank.process(n), n);
            for c in 0..2 { assert!(bank.output[c][..n].iter().all(|x| x.is_finite() && x.abs() <= 0.950001)); }
            out.extend_from_slice(&bank.output[0][..n]);
        }
        out
    }
    fn rms(samples: &[f32]) -> f32 { (samples.iter().map(|x| x * x).sum::<f32>() / samples.len().max(1) as f32).sqrt() }
    #[test] fn six_mechanisms_sound_differently_and_reset_reproducibly() {
        let mut bank = DrumBank::new(48000.0); let mut signatures = Vec::new();
        for model in 0..6 {
            let settings = Settings { model, frequency: 180.0, noise: 0.3, tone: 0.6, ..Settings::default() };
            bank.reset(); bank.set_voice(1, settings); bank.note(1, 0.8, 1.0); let first = render(&mut bank, 12000);
            assert!(rms(&first) > 0.002, "silent model {model}");
            bank.reset(); bank.note(1, 0.8, 1.0); assert_eq!(first, render(&mut bank, 12000));
            for previous in &signatures { assert_ne!(&first, previous, "duplicate mechanism"); }
            signatures.push(first);
        }
    }
    #[test] fn invalid_values_and_dense_hits_stay_bounded_at_all_rates() {
        for sr in [8000.0, 44100.0, 48000.0, 96000.0, 192000.0] {
            let mut bank = DrumBank::new(sr);
            for model in 0..6 {
                bank.set_voice(0, Settings { model, frequency: f32::NAN, decay: f32::INFINITY, tone: 99.0, noise: 99.0, sweep: 999.0, ratio: 99.0, index: 999.0, level: 99.0, pan: -99.0 });
                for _ in 0..64 { bank.note(0, 5.0, f32::INFINITY); render(&mut bank, 19); }
                assert!(bank.voices.iter().filter(|v| v.active).count() <= MAX_VOICES);
                bank.reset(); assert_eq!(rms(&render(&mut bank, 1024)), 0.0);
            }
        }
    }
    #[test] fn lane_edits_do_not_rewrite_ringing_hits_and_closed_hat_chokes_open_hat() {
        let mut bank = DrumBank::new(48000.0); bank.set_voice(3, Settings { model: 1, decay: 3.0, ..Settings::default() });
        bank.note(3, 1.0, 1.0); render(&mut bank, 1000);
        bank.set_voice(3, Settings { frequency: 8000.0, ..Settings::default() });
        assert_eq!(bank.voices[0].settings.frequency, 60.0);
        bank.note(2, 1.0, 1.0); render(&mut bank, 400);
        assert!(!bank.voices.iter().any(|v| v.active && v.lane == 3));
    }
    #[test] fn pan_velocity_pitch_and_decay_have_actual_destinations() {
        let mut bank = DrumBank::new(48000.0);
        bank.set_voice(0, Settings { pan: -1.0, ..Settings::default() }); bank.note(0, 1.0, 1.0);
        let loud = render(&mut bank, 8000); assert!(rms(&bank.output[1]) < 1e-7);
        bank.reset(); bank.note(0, 0.25, 1.0); let soft = render(&mut bank, 8000); assert!((rms(&loud) / rms(&soft) - 4.0).abs() < 0.01);
        bank.reset(); bank.note(0, 1.0, 2.0); assert_ne!(loud, render(&mut bank, 8000));
        bank.reset(); bank.set_voice(0, Settings { decay: 0.03, ..Settings::default() }); bank.note(0, 1.0, 1.0);
        render(&mut bank, 48000); assert!(!bank.active());
    }
    #[test] fn pcm_is_cached_and_memory_is_bounded() {
        let mut bank = DrumBank::new(48000.0); let pointer = bank.pcm.as_ptr();
        bank.set_voice(7, Settings { model: 5, frequency: REFERENCES[7], ..Settings::default() });
        for _ in 0..100 { bank.note(7, 0.8, 1.0); render(&mut bank, 64); }
        assert_eq!(pointer, bank.pcm.as_ptr()); assert_eq!(bank.pcm.len(), LANES * PCM_FRAMES);
        assert!(std::mem::size_of::<DrumBank>() < 32768);
        assert_eq!(bank.process(129), 0);
    }
}
