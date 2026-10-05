//! Fixed-capacity polyphony layered over the unchanged monophonic Engine.
//!
//! Hosts select this bank explicitly; the legacy Engine remains the mono path.
//! Every occupied slot owns its oscillator/model, ADSR and release/DC tail. The
//! input source is copied into all eight preallocated engines on source changes.
//! Construction allocates; note events, parameter changes and render do not.
use crate::{
    bounded, default_parameters, protect_output, Engine, EnvelopePoint, BLOCK_FRAMES,
    ENVELOPE_POINT_COUNT, METHOD_COUNT, PARAM_COUNT, SAMPLE_CAPACITY,
};

pub const MAX_VOICES: usize = 8;
const NO_SLOT: u32 = u32::MAX;

struct Voice {
    engine: Engine,
    occupied: bool,
    note_id: u32,
    started: u64,
    released: u64,
    configuration_dirty: bool,
}

pub struct VoiceBank {
    voices: Box<[Voice]>,
    sample_rate: f32,
    method: u32,
    params: [f32; PARAM_COUNT],
    serial: u64,
    mix_gain: f32,
    gain_coefficient: f32,
    parameter_transfer: [f32; PARAM_COUNT],
    transfer: Box<[f32]>,
    output: [f32; BLOCK_FRAMES],
}

impl VoiceBank {
    pub fn new(sample_rate: f32) -> Self {
        let sr = bounded(sample_rate, 8_000.0, 192_000.0, 48_000.0);
        let voices = (0..MAX_VOICES)
            .map(|_| Voice {
                engine: Engine::new(sr),
                occupied: false,
                note_id: 0,
                started: 0,
                released: 0,
                configuration_dirty: false,
            })
            .collect::<Vec<_>>()
            .into_boxed_slice();
        Self {
            voices,
            sample_rate: sr,
            method: 0,
            params: default_parameters(0),
            serial: 0,
            mix_gain: 1.0,
            gain_coefficient: 1.0 - (-1.0 / (sr * 0.020)).exp(),
            parameter_transfer: default_parameters(0),
            transfer: vec![0.0; SAMPLE_CAPACITY].into_boxed_slice(),
            output: [0.0; BLOCK_FRAMES],
        }
    }
    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }
    pub fn method(&self) -> u32 {
        self.method
    }
    pub fn voice_count(&self) -> usize {
        self.voices.iter().filter(|v| v.occupied).count()
    }
    pub fn voice_is_active(&self, slot: usize) -> bool {
        self.voices.get(slot).is_some_and(|v| v.occupied)
    }
    pub fn voice_is_held(&self, slot: usize) -> bool {
        self.voices
            .get(slot)
            .is_some_and(|v| v.occupied && v.engine.is_held())
    }
    pub fn voice_note_id(&self, slot: usize) -> Option<u32> {
        self.voices
            .get(slot)
            .filter(|v| v.occupied)
            .map(|v| v.note_id)
    }
    pub fn set_method(&mut self, method: u32) {
        self.method = method.min(METHOD_COUNT - 1);
        for voice in &mut self.voices {
            if voice.occupied {
                voice.engine.set_method(self.method);
            } else {
                voice.configuration_dirty = true;
            }
        }
    }
    pub fn set_params(&mut self, params: [f32; PARAM_COUNT]) {
        for (target, value) in self.params.iter_mut().zip(params) {
            *target = bounded(value, 0.0, 1.0, 0.5);
        }
        for voice in &mut self.voices {
            if voice.occupied {
                voice.engine.set_params(self.params);
            } else {
                voice.configuration_dirty = true;
            }
        }
    }
    pub fn set_envelope(&mut self, attack: f32, decay: f32, sustain: f32, release: f32) {
        for voice in &mut self.voices {
            voice.engine.set_envelope(attack, decay, sustain, release);
        }
    }
    pub fn set_envelope_points(&mut self, points: [EnvelopePoint; ENVELOPE_POINT_COUNT]) {
        for voice in &mut self.voices {
            voice.engine.set_envelope_points(points);
        }
    }
    pub fn clear_envelope_points(&mut self) {
        for voice in &mut self.voices {
            voice.engine.clear_envelope_points();
        }
    }
    pub fn set_level_trim_db(&mut self, db: f32) {
        for voice in &mut self.voices {
            voice.engine.set_level_trim_db(db);
        }
    }
    fn next_serial(&mut self) -> u64 {
        self.serial = self.serial.wrapping_add(1);
        self.serial
    }
    /// Return the owned slot. A repeated ID retriggers that ID's slot. A new ID
    /// takes an idle slot, then the earliest released slot, then the oldest held
    /// note. Stale offs for a stolen ID cannot release its replacement.
    pub fn note_on(&mut self, id: u32, frequency: f32, velocity: f32) -> usize {
        let slot = self
            .voices
            .iter()
            .position(|v| v.occupied && v.note_id == id)
            .or_else(|| self.voices.iter().position(|v| !v.occupied))
            .or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| !v.engine.is_held())
                    .min_by_key(|(_, v)| v.released)
                    .map(|(i, _)| i)
            })
            .unwrap_or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, v)| v.started)
                    .unwrap()
                    .0
            });
        let started = self.next_serial();
        let was_silent = self.voice_count() == 0;
        let voice = &mut self.voices[slot];
        if voice.configuration_dirty {
            voice.engine.set_method(self.method);
            voice.engine.set_params(self.params);
            voice.configuration_dirty = false;
        }
        if voice.occupied {
            voice.engine.prepare_audition();
        } else {
            voice.engine.reset();
        }
        voice.engine.note_on(frequency, velocity);
        voice.occupied = true;
        voice.note_id = id;
        voice.started = started;
        voice.released = 0;
        // A note after true silence has exactly the mono path's level/attack.
        if was_silent {
            self.mix_gain = 1.0;
        }
        slot
    }
    pub fn note_off(&mut self, id: u32) {
        let released = self.next_serial();
        for voice in &mut self.voices {
            if voice.occupied && voice.note_id == id && voice.engine.is_held() {
                voice.engine.note_off();
                voice.released = released;
            }
        }
    }
    /// Immediate CLAP note-choke; unlike note_off, there is no release tail.
    pub fn choke(&mut self, id: u32) {
        for voice in &mut self.voices {
            if voice.occupied && voice.note_id == id {
                voice.engine.reset();
                voice.occupied = false;
            }
        }
    }
    pub fn set_note_frequency(&mut self, id: u32, frequency: f32) {
        for voice in &mut self.voices {
            if voice.occupied && voice.note_id == id {
                voice.engine.set_frequency(frequency);
            }
        }
    }
    pub fn all_notes_off(&mut self) {
        let released = self.next_serial();
        for voice in &mut self.voices {
            if voice.occupied && voice.engine.is_held() {
                voice.engine.note_off();
                voice.released = released;
            }
        }
    }
    pub fn reset(&mut self) {
        for voice in &mut self.voices {
            if voice.occupied {
                voice.engine.reset();
            }
            voice.occupied = false;
        }
        self.mix_gain = 1.0;
        self.output.fill(0.0);
    }
    /// Source import/analysis is a control operation. All slots receive the same
    /// bounded mono source, while read heads, grains and model state stay local.
    pub fn load_sample(&mut self, samples: &[f32], sample_rate: f32) {
        for voice in &mut self.voices {
            voice.engine.load_sample(samples, sample_rate);
        }
    }
    pub fn restore_source(&mut self) {
        for voice in &mut self.voices {
            voice.engine.restore_source();
        }
    }
    pub fn render(&mut self, output: &mut [f32]) {
        for block in output.chunks_mut(BLOCK_FRAMES) {
            block.fill(0.0);
            let count = self.voice_count();
            if count == 0 {
                self.mix_gain = 1.0;
                continue;
            }
            let mut scratch = [0.0; BLOCK_FRAMES];
            for voice in &mut self.voices {
                if !voice.occupied {
                    continue;
                }
                voice.engine.render(&mut scratch[..block.len()]);
                for (sum, sample) in block.iter_mut().zip(&scratch) {
                    *sum += *sample;
                }
                if !voice.engine.is_active() {
                    voice.occupied = false;
                }
            }
            // Count-based, velocity-independent headroom, smoothed over 20 ms.
            // One voice receives no second nonlinear knee: it is bit-identical
            // to Engine output after silence. Chords use the same .8/.95 knee.
            let target = 1.0 / (count as f32).sqrt();
            for sum in block {
                self.mix_gain += (target - self.mix_gain) * self.gain_coefficient;
                let sample = *sum * self.mix_gain;
                *sum = if count > 1 {
                    protect_output(sample)
                } else {
                    sample
                };
            }
        }
    }
}

// Additive ABI 2 exports. Callers serialize access and never use pointers after
// poly_free. Source and parameter pointers stay stable throughout bank lifetime.
#[no_mangle]
pub extern "C" fn poly_new(sr: f32) -> *mut VoiceBank {
    Box::into_raw(Box::new(VoiceBank::new(sr)))
}
#[no_mangle]
pub unsafe extern "C" fn poly_free(ptr: *mut VoiceBank) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}
#[no_mangle]
pub extern "C" fn poly_max_voices() -> u32 {
    MAX_VOICES as u32
}
#[no_mangle]
pub unsafe extern "C" fn poly_set_method(ptr: *mut VoiceBank, method: u32) {
    if let Some(b) = ptr.as_mut() {
        b.set_method(method);
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_params_ptr(ptr: *mut VoiceBank) -> *mut f32 {
    ptr.as_mut()
        .map_or(std::ptr::null_mut(), |b| b.parameter_transfer.as_mut_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn poly_apply_params(ptr: *mut VoiceBank) {
    if let Some(b) = ptr.as_mut() {
        b.set_params(b.parameter_transfer);
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_set_envelope(ptr: *mut VoiceBank, a: f32, d: f32, s: f32, r: f32) {
    if let Some(b) = ptr.as_mut() {
        b.set_envelope(a, d, s, r);
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_set_envelope_points(
    ptr: *mut VoiceBank,
    t0: f32,
    l0: f32,
    t1: f32,
    l1: f32,
    t2: f32,
    l2: f32,
    t3: f32,
    l3: f32,
    t4: f32,
    l4: f32,
) {
    if let Some(b) = ptr.as_mut() {
        b.set_envelope_points(
            [(t0, l0), (t1, l1), (t2, l2), (t3, l3), (t4, l4)]
                .map(|(time, level)| EnvelopePoint { time, level }),
        );
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_clear_envelope_points(ptr: *mut VoiceBank) {
    if let Some(b) = ptr.as_mut() {
        b.clear_envelope_points();
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_set_level_trim_db(ptr: *mut VoiceBank, db: f32) {
    if let Some(b) = ptr.as_mut() {
        b.set_level_trim_db(db);
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_note_on(ptr: *mut VoiceBank, id: u32, hz: f32, velocity: f32) -> u32 {
    ptr.as_mut()
        .map_or(NO_SLOT, |b| b.note_on(id, hz, velocity) as u32)
}
#[no_mangle]
pub unsafe extern "C" fn poly_note_off(ptr: *mut VoiceBank, id: u32) {
    if let Some(b) = ptr.as_mut() {
        b.note_off(id);
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_note_choke(ptr: *mut VoiceBank, id: u32) {
    if let Some(b) = ptr.as_mut() {
        b.choke(id);
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_set_note_frequency(ptr: *mut VoiceBank, id: u32, hz: f32) {
    if let Some(b) = ptr.as_mut() {
        b.set_note_frequency(id, hz);
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_all_notes_off(ptr: *mut VoiceBank) {
    if let Some(b) = ptr.as_mut() {
        b.all_notes_off();
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_reset(ptr: *mut VoiceBank) {
    if let Some(b) = ptr.as_mut() {
        b.reset();
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_voice_count(ptr: *const VoiceBank) -> u32 {
    ptr.as_ref().map_or(0, |b| b.voice_count() as u32)
}
#[no_mangle]
pub unsafe extern "C" fn poly_voice_is_active(ptr: *const VoiceBank, slot: u32) -> u32 {
    ptr.as_ref()
        .is_some_and(|b| b.voice_is_active(slot as usize)) as u32
}
#[no_mangle]
pub unsafe extern "C" fn poly_voice_is_held(ptr: *const VoiceBank, slot: u32) -> u32 {
    ptr.as_ref().is_some_and(|b| b.voice_is_held(slot as usize)) as u32
}
#[no_mangle]
pub unsafe extern "C" fn poly_voice_note_id(ptr: *const VoiceBank, slot: u32) -> u32 {
    ptr.as_ref()
        .and_then(|b| b.voice_note_id(slot as usize))
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn poly_output_ptr(ptr: *mut VoiceBank) -> *mut f32 {
    ptr.as_mut()
        .map_or(std::ptr::null_mut(), |b| b.output.as_mut_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn poly_sample_ptr(ptr: *mut VoiceBank) -> *mut f32 {
    ptr.as_mut()
        .map_or(std::ptr::null_mut(), |b| b.transfer.as_mut_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn poly_load_sample(ptr: *mut VoiceBank, len: u32, sr: f32) {
    if let Some(b) = ptr.as_mut() {
        let source = &b.transfer[..(len as usize).min(SAMPLE_CAPACITY)];
        for voice in &mut b.voices {
            voice.engine.load_sample(source, sr);
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_restore_source(ptr: *mut VoiceBank) {
    if let Some(b) = ptr.as_mut() {
        b.restore_source();
    }
}
#[no_mangle]
pub unsafe extern "C" fn poly_process(ptr: *mut VoiceBank, frames: u32) -> u32 {
    if frames as usize > BLOCK_FRAMES {
        return 0;
    }
    if let Some(b) = ptr.as_mut() {
        let mut block = [0.0; BLOCK_FRAMES];
        b.render(&mut block[..frames as usize]);
        b.output[..frames as usize].copy_from_slice(&block[..frames as usize]);
        frames
    } else {
        0
    }
}
