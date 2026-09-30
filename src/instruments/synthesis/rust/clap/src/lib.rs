//! Native CLAP host boundary for the shared synthesis engine.
//! Engine and held-note state are accessed only on CLAP's mutually exclusive
//! audio/lifecycle callbacks. Main-thread state loading publishes an atomic
//! mailbox; it never touches an active engine. No allocation occurs in process.
use clap_sys::{
    audio_buffer::*,
    entry::*,
    events::*,
    ext::{audio_ports::*, note_ports::*, params::*, state::*},
    factory::plugin_factory::*,
    host::*,
    id::CLAP_INVALID_ID,
    plugin::*,
    process::*,
    stream::*,
    version::*,
};
use std::{
    cell::UnsafeCell,
    ffi::{c_char, c_void, CStr},
    mem::size_of,
    ptr,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};
use synthesis_core::{migrate_legacy_parameter, polyphony::VoiceBank, Engine};
use synthesis_presets::{METHOD_NAMES, PARAM_NAMES, PRESETS};

const COUNT: usize = 26;
const VOICE_MODE: usize = 25;
const METHOD: usize = 0;
const PRESET: usize = 1;
const FREQ: usize = 2;
const ATTACK: usize = 3;
const DECAY: usize = 4;
const SUSTAIN: usize = 5;
const RELEASE: usize = 6;
const OUTPUT: usize = 7;
const MACRO: usize = 8;
const GATE: usize = 16;
const CHUNK: usize = 128;
const MAX_HELD: usize = 256;
const HOLD_VOICE: u32 = MAX_HELD as u32;
const ID: &[u8] = b"org.morphazoid.synthesis\0";
const STATE_MAGIC: [u8; 8] = *b"MSYNCLAP";
const STATE_SIZE: usize = 12 + COUNT * 8;

// CLAP's descriptor and its null-terminated feature pointers live for the DSO lifetime.
struct FeaturePointers([*const c_char; 4]);
unsafe impl Sync for FeaturePointers {}
static FEATURES: FeaturePointers = FeaturePointers([
    b"instrument\0".as_ptr().cast(),
    b"synthesizer\0".as_ptr().cast(),
    b"stereo\0".as_ptr().cast(),
    ptr::null(),
]);
static DESCRIPTOR: clap_plugin_descriptor = clap_plugin_descriptor {
    clap_version: CLAP_VERSION,
    id: ID.as_ptr().cast(),
    name: b"Synthesaurus\0".as_ptr().cast(),
    vendor: b"Morphazoid\0".as_ptr().cast(),
    url: b"https://morphazoid.com/\0".as_ptr().cast(),
    manual_url: b"https://morphazoid.com/synthesis.html\0".as_ptr().cast(),
    support_url: b"https://github.com/blechdom/morphazoid\0".as_ptr().cast(),
    version: b"0.1.0\0".as_ptr().cast(),
    description: b"Expanded synthesis encyclopedia, shared Rust DSP\0"
        .as_ptr()
        .cast(),
    features: FEATURES.0.as_ptr(),
};

// IDs 0..16 are permanent: the original eight macro IDs remain 8..15 and
// Hold remains 16. Macro slots 8..15 use IDs 17..24; Voice mode appends at 25.
fn macro_id(slot: usize) -> usize {
    if slot < 8 {
        MACRO + slot
    } else {
        17 + slot - 8
    }
}
fn macro_slot(id: usize) -> Option<usize> {
    if (MACRO..GATE).contains(&id) {
        Some(id - MACRO)
    } else if (17..VOICE_MODE).contains(&id) {
        Some(id - 17 + 8)
    } else {
        None
    }
}

fn bounds(index: usize) -> (f64, f64) {
    match index {
        METHOD => (0., (METHOD_NAMES.len() - 1) as f64),
        PRESET => (0., 7.),
        FREQ => (20., 8000.),
        ATTACK => (0.001, 12.),
        DECAY => (0.002, 12.),
        RELEASE => (0.003, 16.),
        OUTPUT => (0., 1.),
        _ => (0., 1.),
    }
}
fn bounded(index: usize, value: f64, fallback: f64) -> f64 {
    let (low, high) = bounds(index);
    let value = if value.is_finite() {
        value.clamp(low, high)
    } else {
        fallback
    };
    if matches!(index, METHOD | PRESET | GATE | VOICE_MODE) {
        value.round()
    } else {
        value
    }
}
fn defaults() -> [f64; COUNT] {
    let mut values = [0.; COUNT];
    values[OUTPUT] = 0.7;
    preset_values(&mut values);
    values
}
fn preset_values(values: &mut [f64; COUNT]) {
    let preset = &PRESETS[values[METHOD] as usize][values[PRESET] as usize];
    values[FREQ] = preset.frequency as f64;
    for i in 0..4 {
        values[ATTACK + i] = preset.envelope[i] as f64;
    }
    for i in 0..16 {
        values[macro_id(i)] = preset.params[i] as f64;
    }
}

#[derive(Clone, Copy, Debug)]
struct Note {
    id: i32,
    channel: i16,
    key: i16,
    velocity: f32,
    order: u64,
}
struct AudioState {
    engine: Option<Engine>,
    poly: Option<VoiceBank>,
    polyphonic: bool,
    hold_voice: bool,
    last_sample: f32,
    transition_from: f32,
    transition_left: u32,
    transition_frames: u32,
    values: [f64; COUNT],
    held: [Option<Note>; MAX_HELD],
    serial: u64,
    sustain: [bool; 16],
    released: [bool; MAX_HELD],
    scratch: [f32; CHUNK],
    level: f32,
    max_frames: u32,
}
impl AudioState {
    fn new() -> Self {
        Self {
            engine: None,
            poly: None,
            polyphonic: false,
            hold_voice: false,
            last_sample: 0.,
            transition_from: 0.,
            transition_left: 0,
            transition_frames: 1,
            values: defaults(),
            held: [None; MAX_HELD],
            serial: 0,
            sustain: [false; 16],
            released: [false; MAX_HELD],
            scratch: [0.; CHUNK],
            level: 0.7,
            max_frames: 0,
        }
    }
    fn latest(&self) -> Option<Note> {
        self.held
            .iter()
            .flatten()
            .max_by_key(|note| note.order)
            .copied()
    }
    fn note_frequency(note: Note) -> f32 {
        (440.0 * 2_f32.powf((note.key as f32 - 69.) / 12.)).clamp(20., 8000.)
    }
    fn apply(&mut self) {
        let frequency = self
            .latest()
            .map(Self::note_frequency)
            .unwrap_or(self.values[FREQ] as f32);
        if let Some(engine) = self.engine.as_mut() {
            engine.set_method(self.values[METHOD] as u32);
            // The selected preset remains the calibration reference after macro
            // edits and state recall. Output stays an independent host control.
            engine.set_level_trim_db(
                PRESETS[self.values[METHOD] as usize][self.values[PRESET] as usize].level_trim_db,
            );
            engine.set_params(std::array::from_fn(|i| self.values[macro_id(i)] as f32));
            engine.set_frequency(frequency);
            engine.set_envelope(
                self.values[ATTACK] as f32,
                self.values[DECAY] as f32,
                self.values[SUSTAIN] as f32,
                self.values[RELEASE] as f32,
            );
        }
        if let Some(poly) = self.poly.as_mut() {
            poly.set_method(self.values[METHOD] as u32);
            poly.set_level_trim_db(
                PRESETS[self.values[METHOD] as usize][self.values[PRESET] as usize].level_trim_db,
            );
            poly.set_params(std::array::from_fn(|i| self.values[macro_id(i)] as f32));
            poly.set_envelope(
                self.values[ATTACK] as f32,
                self.values[DECAY] as f32,
                self.values[SUSTAIN] as f32,
                self.values[RELEASE] as f32,
            );
            if self.hold_voice {
                poly.set_note_frequency(HOLD_VOICE, self.values[FREQ] as f32);
            }
        }
        let polyphonic = self.values[VOICE_MODE] > 0.5;
        if self.polyphonic != polyphonic {
            self.transition_from = self.last_sample;
            self.transition_left = self.transition_frames;
            if let Some(engine) = self.engine.as_mut() {
                engine.reset();
            }
            if let Some(poly) = self.poly.as_mut() {
                poly.reset();
            }
            self.hold_voice = false;
            self.polyphonic = polyphonic;
            if self.polyphonic {
                // Select only the newest eight, then excite oldest first. A full
                // held-note table must not run hundreds of model initializations.
                let mut selected = [None; 8];
                let mut before = u64::MAX;
                for slot in &mut selected {
                    *slot = self
                        .held
                        .iter()
                        .enumerate()
                        .filter_map(|(index, note)| note.map(|note| (index, note)))
                        .filter(|(_, note)| note.order < before)
                        .max_by_key(|(_, note)| note.order);
                    let Some((_, note)) = slot else { break };
                    before = note.order;
                }
                for (index, note) in selected.into_iter().rev().flatten() {
                    if let Some(poly) = self.poly.as_mut() {
                        poly.note_on(index as u32, Self::note_frequency(note), note.velocity);
                    }
                }
                self.sync_hold_voice();
            } else {
                self.retrigger_latest();
            }
        }
    }
    fn sync_hold_voice(&mut self) {
        if !self.polyphonic {
            return;
        }
        let wanted = self.latest().is_none() && self.values[GATE] > 0.5;
        if let Some(poly) = self.poly.as_mut() {
            if wanted && !self.hold_voice {
                poly.note_on(HOLD_VOICE, self.values[FREQ] as f32, 0.8);
            } else if !wanted && self.hold_voice {
                poly.note_off(HOLD_VOICE);
            }
        }
        self.hold_voice = wanted;
    }
    fn clear_notes(&mut self, hard: bool) {
        self.held.fill(None);
        self.released.fill(false);
        self.sustain.fill(false);
        self.values[GATE] = 0.;
        self.hold_voice = false;
        if hard {
            self.last_sample = 0.;
            self.transition_left = 0;
        }
        if let Some(poly) = self.poly.as_mut() {
            if hard {
                poly.reset();
            } else {
                poly.all_notes_off();
            }
        }
        if let Some(engine) = self.engine.as_mut() {
            if hard {
                engine.reset();
            } else {
                engine.note_off();
            }
        }
    }
    fn retrigger_latest(&mut self) {
        if self.polyphonic {
            self.sync_hold_voice();
            return;
        }
        let latest = self.latest();
        if let Some(engine) = self.engine.as_mut() {
            if let Some(note) = latest {
                engine.note_on(Self::note_frequency(note), note.velocity);
            } else if self.values[GATE] > 0.5 {
                engine.note_on(self.values[FREQ] as f32, 0.8);
            } else {
                engine.note_off();
            }
        }
    }
    fn on(&mut self, id: i32, channel: i16, key: i16, velocity: f64) {
        if !(0..16).contains(&channel) || !(0..128).contains(&key) || !velocity.is_finite() {
            return;
        }
        if velocity <= 0. {
            self.off(id, channel, key, false);
            return;
        }
        let same = self.held.iter().position(|slot| {
            slot.is_some_and(|note| {
                if id >= 0 {
                    note.id == id
                } else {
                    note.id == -1 && note.channel == channel && note.key == key
                }
            })
        });
        let index = same
            .or_else(|| self.held.iter().position(Option::is_none))
            .unwrap_or_else(|| {
                self.held
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, note)| note.unwrap().order)
                    .unwrap()
                    .0
            });
        self.serial = self.serial.wrapping_add(1);
        self.held[index] = Some(Note {
            id,
            channel,
            key,
            velocity: velocity.clamp(0., 1.) as f32,
            order: self.serial,
        });
        self.released[index] = false;
        if self.polyphonic {
            self.sync_hold_voice();
            if let Some(poly) = self.poly.as_mut() {
                poly.note_on(
                    index as u32,
                    Self::note_frequency(self.held[index].unwrap()),
                    velocity.clamp(0., 1.) as f32,
                );
            }
        } else {
            self.retrigger_latest();
        }
    }
    fn off(&mut self, id: i32, channel: i16, key: i16, choke: bool) {
        self.off_matching(id, channel, key, choke, false);
    }
    fn off_matching(&mut self, id: i32, channel: i16, key: i16, choke: bool, midi_only: bool) {
        let before = self.latest().map(|note| note.order);
        for index in 0..MAX_HELD {
            if let Some(note) = self.held[index] {
                if (!midi_only || note.id == -1)
                    && (id < 0 || id == note.id)
                    && (channel < 0 || channel == note.channel)
                    && (key < 0 || key == note.key)
                {
                    if !choke && self.sustain[note.channel as usize] {
                        self.released[index] = true;
                    } else {
                        if self.polyphonic {
                            if let Some(poly) = self.poly.as_mut() {
                                if choke {
                                    poly.choke(index as u32);
                                } else {
                                    poly.note_off(index as u32);
                                }
                            }
                        }
                        self.held[index] = None;
                        self.released[index] = false;
                    }
                }
            }
        }
        if self.polyphonic {
            self.sync_hold_voice();
        } else if before != self.latest().map(|note| note.order) {
            if choke && self.latest().is_none() && self.values[GATE] < 0.5 {
                if let Some(engine) = self.engine.as_mut() {
                    engine.reset();
                }
            } else {
                self.retrigger_latest();
            }
        }
    }
    fn midi(&mut self, data: [u8; 3]) {
        let channel = (data[0] & 15) as i16;
        let key = (data[1] & 127) as i16;
        match data[0] & 0xf0 {
            0x90 if data[2] & 127 != 0 => self.on(-1, channel, key, (data[2] & 127) as f64 / 127.),
            0x80 | 0x90 => self.off_matching(-1, channel, key, false, true),
            0xb0 if key == 120 => self.off(-1, channel, -1, true),
            0xb0 if key == 123 => {
                self.sustain[channel as usize] = false;
                self.off(-1, channel, -1, false);
            }
            0xb0 if key == 64 => {
                self.sustain[channel as usize] = data[2] >= 64;
                if data[2] < 64 {
                    let before = self.latest().map(|note| note.order);
                    for i in 0..MAX_HELD {
                        if self.released[i]
                            && self.held[i].is_some_and(|note| note.channel == channel)
                        {
                            if self.polyphonic {
                                if let Some(poly) = self.poly.as_mut() {
                                    poly.note_off(i as u32);
                                }
                            }
                            self.held[i] = None;
                            self.released[i] = false;
                        }
                    }
                    if self.polyphonic {
                        self.sync_hold_voice();
                    } else if before != self.latest().map(|note| note.order) {
                        self.retrigger_latest();
                    }
                }
            }
            _ => (),
        }
    }
}

struct Instance {
    plugin: clap_plugin,
    host: *const clap_host,
    audio: UnsafeCell<AudioState>,
    active: AtomicBool,
    processing: AtomicBool,
    values: [AtomicU64; COUNT],
    published_version: AtomicU64,
    pending: [AtomicU64; COUNT],
    pending_version: AtomicU64,
    applied_version: AtomicU64,
    rescan: AtomicBool,
}
impl Instance {
    fn publish(&self, values: &[f64; COUNT]) {
        self.published_version.fetch_add(1, Ordering::AcqRel);
        for (atomic, value) in self.values.iter().zip(values) {
            atomic.store(value.to_bits(), Ordering::Release);
        }
        self.published_version.fetch_add(1, Ordering::Release);
    }
    fn snapshot(&self) -> Option<[f64; COUNT]> {
        if let Some((values, _)) = self.pending_snapshot() {
            return Some(values);
        }
        for _ in 0..128 {
            let version = self.published_version.load(Ordering::Acquire);
            if version & 1 != 0 {
                continue;
            }
            let values =
                std::array::from_fn(|i| f64::from_bits(self.values[i].load(Ordering::Acquire)));
            if version == self.published_version.load(Ordering::Acquire) {
                return Some(values);
            }
        }
        None
    }
    fn pending_snapshot(&self) -> Option<([f64; COUNT], u64)> {
        let version = self.pending_version.load(Ordering::Acquire);
        if version & 1 != 0 || version == self.applied_version.load(Ordering::Acquire) {
            return None;
        }
        let values =
            std::array::from_fn(|i| f64::from_bits(self.pending[i].load(Ordering::Relaxed)));
        (version == self.pending_version.load(Ordering::Acquire)).then_some((values, version))
    }
    fn value(&self, index: usize) -> f64 {
        self.pending_snapshot()
            .map(|(values, _)| values[index])
            .unwrap_or_else(|| f64::from_bits(self.values[index].load(Ordering::Acquire)))
    }
    // Caller holds CLAP's audio/lifecycle exclusivity. At most one mailbox read,
    // with no spinning if the main thread is currently writing a new state.
    unsafe fn consume_pending(&self, audio: &mut AudioState) {
        if let Some((values, version)) = self.pending_snapshot() {
            audio.clear_notes(true);
            audio.values = values;
            audio.values[GATE] = 0.;
            audio.apply();
            self.publish(&audio.values);
            self.applied_version.store(version, Ordering::Release);
        }
    }
    unsafe fn request_rescan(&self) {
        if !self.rescan.swap(true, Ordering::AcqRel) && !self.host.is_null() {
            if let Some(callback) = (*self.host).request_callback {
                callback(self.host);
            }
        }
    }
    unsafe fn parameter(&self, audio: &mut AudioState, index: usize, value: f64) {
        if index >= COUNT {
            return;
        }
        let old = audio.values[index];
        let value = bounded(index, value, old);
        if value == old {
            return;
        }
        audio.values[index] = value;
        if index == METHOD || index == PRESET {
            preset_values(&mut audio.values);
            self.request_rescan();
        }
        if index != OUTPUT && index != GATE {
            audio.apply();
        }
        if index == GATE {
            audio.retrigger_latest();
        }
        self.publish(&audio.values);
    }
    unsafe fn event(
        &self,
        audio: &mut AudioState,
        header: *const clap_event_header,
        params_only: bool,
    ) {
        if header.is_null() || (*header).space_id != CLAP_CORE_EVENT_SPACE_ID {
            return;
        }
        match (*header).type_ {
            CLAP_EVENT_PARAM_VALUE
                if (*header).size as usize >= size_of::<clap_event_param_value>() =>
            {
                let event = &*header.cast::<clap_event_param_value>();
                // Only global parameters are advertised. Ignore per-note automation.
                if event.note_id == -1
                    && event.port_index == -1
                    && event.channel == -1
                    && event.key == -1
                {
                    self.parameter(audio, event.param_id as usize, event.value);
                }
            }
            CLAP_EVENT_NOTE_ON | CLAP_EVENT_NOTE_OFF | CLAP_EVENT_NOTE_CHOKE
                if !params_only && (*header).size as usize >= size_of::<clap_event_note>() =>
            {
                let event = &*header.cast::<clap_event_note>();
                if event.port_index != 0
                    && !(event.port_index == -1 && event.header.type_ != CLAP_EVENT_NOTE_ON)
                {
                    return;
                }
                match event.header.type_ {
                    CLAP_EVENT_NOTE_ON => {
                        audio.on(event.note_id, event.channel, event.key, event.velocity)
                    }
                    CLAP_EVENT_NOTE_CHOKE => {
                        audio.off(event.note_id, event.channel, event.key, true)
                    }
                    _ => audio.off(event.note_id, event.channel, event.key, false),
                }
            }
            CLAP_EVENT_MIDI
                if !params_only && (*header).size as usize >= size_of::<clap_event_midi>() =>
            {
                let event = &*header.cast::<clap_event_midi>();
                if event.port_index == 0 {
                    audio.midi(event.data);
                }
            }
            _ => (),
        }
    }
}
unsafe fn instance<'a>(plugin: *const clap_plugin) -> &'a Instance {
    &*((*plugin).plugin_data.cast::<Instance>())
}
unsafe fn audio<'a>(this: &'a Instance) -> &'a mut AudioState {
    &mut *this.audio.get()
}
unsafe fn cstr_matches(pointer: *const c_char, expected: &CStr) -> bool {
    !pointer.is_null() && CStr::from_ptr(pointer) == expected
}
fn copy_name<const N: usize>(target: &mut [c_char; N], name: &str) {
    target.fill(0);
    for (output, byte) in target
        .iter_mut()
        .take(N.saturating_sub(1))
        .zip(name.as_bytes())
    {
        *output = *byte as c_char;
    }
}

unsafe extern "C" fn plugin_init(_: *const clap_plugin) -> bool {
    true
}
unsafe extern "C" fn destroy(plugin: *const clap_plugin) {
    if !plugin.is_null() {
        drop(Box::from_raw((*plugin).plugin_data.cast::<Instance>()));
    }
}
unsafe extern "C" fn activate(plugin: *const clap_plugin, sr: f64, min: u32, max: u32) -> bool {
    let this = instance(plugin);
    if this.active.load(Ordering::Acquire)
        || !sr.is_finite()
        || !(8000.0..=192000.0).contains(&sr)
        || min == 0
        || max < min
        || max > 1_048_576
    {
        return false;
    }
    let audio = audio(this);
    this.consume_pending(audio);
    audio.engine = Some(Engine::new(sr as f32));
    audio.poly = Some(VoiceBank::new(sr as f32));
    audio.polyphonic = audio.values[VOICE_MODE] > 0.5;
    audio.transition_frames = (sr * 0.008).round().max(1.) as u32;
    audio.max_frames = max;
    audio.level = audio.values[OUTPUT] as f32;
    audio.clear_notes(true);
    audio.apply();
    this.publish(&audio.values);
    this.active.store(true, Ordering::Release);
    true
}
unsafe extern "C" fn deactivate(plugin: *const clap_plugin) {
    let this = instance(plugin);
    this.processing.store(false, Ordering::Release);
    let audio = audio(this);
    audio.clear_notes(true);
    audio.engine = None;
    audio.poly = None;
    this.publish(&audio.values);
    this.active.store(false, Ordering::Release);
}
unsafe extern "C" fn start(plugin: *const clap_plugin) -> bool {
    let this = instance(plugin);
    if !this.active.load(Ordering::Acquire) {
        return false;
    }
    !this.processing.swap(true, Ordering::AcqRel)
}
unsafe extern "C" fn stop(plugin: *const clap_plugin) {
    instance(plugin).processing.store(false, Ordering::Release);
}
unsafe extern "C" fn reset(plugin: *const clap_plugin) {
    let this = instance(plugin);
    let audio = audio(this);
    this.consume_pending(audio);
    audio.clear_notes(true);
    this.publish(&audio.values);
}
unsafe fn render_span(
    audio: &mut AudioState,
    output: &mut clap_audio_buffer,
    from: usize,
    to: usize,
) {
    let Some(engine) = audio.engine.as_mut() else {
        return;
    };
    let coefficient = 1.0 - (-1.0 / (engine.sample_rate() * 0.005)).exp();
    let target = audio.values[OUTPUT] as f32;
    for start in (from..to).step_by(CHUNK) {
        let length = (to - start).min(CHUNK);
        if audio.polyphonic {
            if let Some(poly) = audio.poly.as_mut() {
                poly.render(&mut audio.scratch[..length]);
            } else {
                audio.scratch[..length].fill(0.);
            }
        } else {
            engine.render(&mut audio.scratch[..length]);
        }
        for index in 0..length {
            let mut signal = audio.scratch[index];
            if audio.transition_left > 0 {
                let prior = audio.transition_left as f32 / audio.transition_frames as f32;
                signal = signal * (1. - prior) + audio.transition_from * prior;
                audio.transition_left -= 1;
            }
            audio.last_sample = signal;
            audio.level += (target - audio.level) * coefficient;
            let sample = (signal * audio.level).clamp(-0.98, 0.98);
            if !output.data32.is_null() {
                for channel in 0..2 {
                    *(*output.data32.add(channel)).add(start + index) = sample;
                }
            } else {
                for channel in 0..2 {
                    *(*output.data64.add(channel)).add(start + index) = sample as f64;
                }
            }
        }
    }
}
unsafe extern "C" fn process(
    plugin: *const clap_plugin,
    process: *const clap_process,
) -> clap_process_status {
    if process.is_null() {
        return CLAP_PROCESS_ERROR;
    }
    let this = instance(plugin);
    if !this.processing.load(Ordering::Acquire) {
        return CLAP_PROCESS_ERROR;
    }
    let process = &*process;
    let audio = audio(this);
    if process.frames_count > audio.max_frames
        || process.audio_outputs_count != 1
        || process.audio_outputs.is_null()
    {
        return CLAP_PROCESS_ERROR;
    }
    let output = &mut *process.audio_outputs;
    if output.channel_count != 2 || (output.data32.is_null() && output.data64.is_null()) {
        return CLAP_PROCESS_ERROR;
    }
    for channel in 0..2 {
        if (!output.data32.is_null() && (*output.data32.add(channel)).is_null())
            || (output.data32.is_null() && (*output.data64.add(channel)).is_null())
        {
            return CLAP_PROCESS_ERROR;
        }
    }
    this.consume_pending(audio);
    output.constant_mask = 0;
    let mut cursor = 0;
    if !process.in_events.is_null() {
        let list = &*process.in_events;
        if let (Some(size), Some(get)) = (list.size, list.get) {
            for index in 0..size(process.in_events) {
                let event = get(process.in_events, index);
                if event.is_null() || (*event).size < size_of::<clap_event_header>() as u32 {
                    continue;
                }
                // CLAP events are sorted; malformed/backward events are bounded to the cursor.
                let offset = ((*event).time as usize)
                    .min(process.frames_count as usize)
                    .max(cursor);
                render_span(audio, output, cursor, offset);
                cursor = offset;
                this.event(audio, event, false);
            }
        }
    }
    render_span(audio, output, cursor, process.frames_count as usize);
    CLAP_PROCESS_CONTINUE
}

unsafe extern "C" fn audio_count(_: *const clap_plugin, input: bool) -> u32 {
    if input {
        0
    } else {
        1
    }
}
unsafe extern "C" fn audio_info(
    _: *const clap_plugin,
    index: u32,
    input: bool,
    info: *mut clap_audio_port_info,
) -> bool {
    if input || index != 0 || info.is_null() {
        return false;
    }
    let mut result = clap_audio_port_info {
        id: 0,
        name: [0; 256],
        flags: CLAP_AUDIO_PORT_IS_MAIN | CLAP_AUDIO_PORT_SUPPORTS_64BITS,
        channel_count: 2,
        port_type: CLAP_PORT_STEREO.as_ptr(),
        in_place_pair: CLAP_INVALID_ID,
    };
    copy_name(&mut result.name, "Synthesis stereo output");
    *info = result;
    true
}
unsafe extern "C" fn note_count(_: *const clap_plugin, input: bool) -> u32 {
    if input {
        1
    } else {
        0
    }
}
unsafe extern "C" fn note_info(
    _: *const clap_plugin,
    index: u32,
    input: bool,
    info: *mut clap_note_port_info,
) -> bool {
    if !input || index != 0 || info.is_null() {
        return false;
    }
    let mut result = clap_note_port_info {
        id: 0,
        supported_dialects: CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI,
        preferred_dialect: CLAP_NOTE_DIALECT_CLAP,
        name: [0; 256],
    };
    copy_name(&mut result.name, "Notes / MIDI");
    *info = result;
    true
}
unsafe extern "C" fn param_count(_: *const clap_plugin) -> u32 {
    COUNT as u32
}
unsafe extern "C" fn param_info(
    plugin: *const clap_plugin,
    index: u32,
    info: *mut clap_param_info,
) -> bool {
    let index = index as usize;
    if index >= COUNT || info.is_null() {
        return false;
    }
    let this = instance(plugin);
    let method = this.value(METHOD) as usize;
    let fixed = [
        "Synthesis method",
        "Method preset",
        "Frequency (Hz)",
        "Attack (seconds)",
        "Decay (seconds)",
        "Sustain",
        "Release (seconds)",
        "Output",
    ];
    let name = if index < MACRO {
        fixed[index]
    } else if let Some(slot) = macro_slot(index) {
        PARAM_NAMES[method][slot]
    } else if index == VOICE_MODE {
        "Voice mode"
    } else {
        "Hold note"
    };
    let (min_value, max_value) = bounds(index);
    let flags = CLAP_PARAM_IS_AUTOMATABLE
        | CLAP_PARAM_REQUIRES_PROCESS
        | if matches!(index, METHOD | PRESET | GATE | VOICE_MODE) {
            CLAP_PARAM_IS_STEPPED
        } else {
            0
        }
        | if matches!(index, METHOD | PRESET | VOICE_MODE) {
            CLAP_PARAM_IS_ENUM
        } else {
            0
        }
        | if macro_slot(index).is_some() && (name.is_empty() || name == "Unused") {
            CLAP_PARAM_IS_HIDDEN
        } else {
            0
        };
    let mut result = clap_param_info {
        id: index as u32,
        flags,
        cookie: ptr::null_mut(),
        name: [0; 256],
        module: [0; 1024],
        min_value,
        max_value,
        default_value: defaults()[index],
    };
    copy_name(
        &mut result.name,
        if name.is_empty() {
            "Unused macro"
        } else {
            name
        },
    );
    copy_name(
        &mut result.module,
        if macro_slot(index).is_some() {
            "Synthesis controls"
        } else {
            "Performance"
        },
    );
    *info = result;
    true
}
unsafe extern "C" fn param_get(plugin: *const clap_plugin, index: u32, out: *mut f64) -> bool {
    if index as usize >= COUNT || out.is_null() {
        return false;
    }
    *out = instance(plugin).value(index as usize);
    true
}
unsafe extern "C" fn param_text(
    plugin: *const clap_plugin,
    index: u32,
    value: f64,
    out: *mut c_char,
    capacity: u32,
) -> bool {
    if index as usize >= COUNT || out.is_null() || capacity == 0 {
        return false;
    }
    let index = index as usize;
    let value = bounded(index, value, defaults()[index]);
    let text = match index {
        METHOD => METHOD_NAMES[value as usize].to_owned(),
        PRESET => PRESETS[instance(plugin).value(METHOD) as usize][value as usize]
            .name
            .to_owned(),
        GATE => if value > 0.5 { "Held" } else { "Off" }.to_owned(),
        VOICE_MODE => if value > 0.5 {
            "Poly (8 voices)"
        } else {
            "Mono"
        }
        .to_owned(),
        FREQ => format!("{value:.2} Hz"),
        ATTACK | DECAY | RELEASE => format!("{value:.3} s"),
        _ => format!("{:.1}%", value * 100.),
    };
    let bytes = text.as_bytes();
    let length = bytes.len().min(capacity as usize - 1);
    ptr::copy_nonoverlapping(bytes.as_ptr().cast::<c_char>(), out, length);
    *out.add(length) = 0;
    true
}
unsafe extern "C" fn param_parse(
    plugin: *const clap_plugin,
    index: u32,
    text: *const c_char,
    out: *mut f64,
) -> bool {
    if index as usize >= COUNT || text.is_null() || out.is_null() {
        return false;
    }
    let Ok(text) = CStr::from_ptr(text).to_str() else {
        return false;
    };
    let text = text.trim();
    let index = index as usize;
    let named = match index {
        METHOD => METHOD_NAMES
            .iter()
            .position(|name| name.eq_ignore_ascii_case(text)),
        PRESET => PRESETS[instance(plugin).value(METHOD) as usize]
            .iter()
            .position(|preset| preset.name.eq_ignore_ascii_case(text)),
        GATE if text.eq_ignore_ascii_case("held") => Some(1),
        GATE if text.eq_ignore_ascii_case("off") => Some(0),
        VOICE_MODE if text.eq_ignore_ascii_case("mono") => Some(0),
        VOICE_MODE
            if text.eq_ignore_ascii_case("poly")
                || text.eq_ignore_ascii_case("poly (8 voices)") =>
        {
            Some(1)
        }
        _ => None,
    };
    let number = if let Some(named) = named {
        named as f64
    } else {
        let number = text
            .trim_end_matches("Hz")
            .trim_end_matches('s')
            .trim_end_matches('%')
            .trim();
        let Ok(mut value) = number.parse::<f64>() else {
            return false;
        };
        if text.ends_with('%') {
            value *= 0.01;
        }
        value
    };
    if !number.is_finite() {
        return false;
    }
    *out = bounded(index, number, defaults()[index]);
    true
}
unsafe extern "C" fn flush(
    plugin: *const clap_plugin,
    input: *const clap_input_events,
    _: *const clap_output_events,
) {
    let this = instance(plugin);
    let audio = audio(this);
    this.consume_pending(audio);
    if input.is_null() {
        return;
    }
    if let (Some(size), Some(get)) = ((*input).size, (*input).get) {
        for i in 0..size(input) {
            this.event(audio, get(input, i), true);
        }
    }
}

unsafe extern "C" fn save(plugin: *const clap_plugin, stream: *const clap_ostream) -> bool {
    if stream.is_null() {
        return false;
    }
    let Some(write) = (*stream).write else {
        return false;
    };
    let this = instance(plugin);
    let Some(values) = this.snapshot() else {
        return false;
    };
    let mut bytes = [0_u8; STATE_SIZE];
    bytes[..8].copy_from_slice(&STATE_MAGIC);
    bytes[8..12].copy_from_slice(&3_u32.to_le_bytes());
    for i in 0..COUNT {
        bytes[12 + i * 8..20 + i * 8]
            .copy_from_slice(&if i == GATE { 0_f64 } else { values[i] }.to_le_bytes());
    }
    let mut offset = 0;
    while offset < bytes.len() {
        let written = write(
            stream,
            bytes.as_ptr().add(offset).cast(),
            (bytes.len() - offset) as u64,
        );
        if written <= 0 || written as usize > bytes.len() - offset {
            return false;
        }
        offset += written as usize;
    }
    true
}
unsafe extern "C" fn load_state(plugin: *const clap_plugin, stream: *const clap_istream) -> bool {
    if stream.is_null() {
        return false;
    }
    let Some(read) = (*stream).read else {
        return false;
    };
    let mut bytes = [0_u8; STATE_SIZE];
    let mut offset = 0;
    while offset < 12 {
        let count = read(
            stream,
            bytes.as_mut_ptr().add(offset).cast(),
            (12 - offset) as u64,
        );
        if count <= 0 || count as usize > 12 - offset {
            return false;
        }
        offset += count as usize;
    }
    if bytes[..8] != STATE_MAGIC {
        return false;
    }
    let version = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
    let stored_count = match version {
        1 => 17,
        2 => 25,
        3 => COUNT,
        _ => return false,
    };
    let size = 12 + stored_count * 8;
    while offset < size {
        let count = read(
            stream,
            bytes.as_mut_ptr().add(offset).cast(),
            (size - offset) as u64,
        );
        if count <= 0 || count as usize > size - offset {
            return false;
        }
        offset += count as usize;
    }
    let defaults = defaults();
    let mut values = defaults;
    for i in 0..stored_count {
        values[i] = bounded(
            i,
            f64::from_le_bytes(bytes[12 + i * 8..20 + i * 8].try_into().unwrap()),
            defaults[i],
        );
    }
    if version == 1 {
        let saved = values;
        preset_values(&mut values);
        // Restore performance overrides and formerly meaningful synthesis slots.
        values[..MACRO].copy_from_slice(&saved[..MACRO]);
        let old_slots = if matches!(saved[METHOD] as usize, 2 | 24) {
            8
        } else {
            4
        };
        for slot in 0..old_slots {
            values[macro_id(slot)] =
                migrate_legacy_parameter(saved[METHOD] as u32, slot, saved[MACRO + slot] as f32)
                    as f64;
        }
    }
    values[GATE] = 0.;
    let this = instance(plugin);
    // CLAP state.load has one main-thread writer; odd marks an incomplete mailbox.
    this.pending_version.fetch_add(1, Ordering::AcqRel);
    for (atomic, value) in this.pending.iter().zip(values) {
        atomic.store(value.to_bits(), Ordering::Relaxed);
    }
    this.pending_version.fetch_add(1, Ordering::Release);
    this.request_rescan();
    if !this.host.is_null() {
        if let Some(request) = (*this.host).request_process {
            request(this.host);
        }
    }
    true
}
unsafe extern "C" fn on_main_thread(plugin: *const clap_plugin) {
    let this = instance(plugin);
    if this.rescan.swap(false, Ordering::AcqRel) && !this.host.is_null() {
        if let Some(get) = (*this.host).get_extension {
            let extension = get(this.host, CLAP_EXT_PARAMS.as_ptr()).cast::<clap_host_params>();
            if !extension.is_null() {
                if let Some(rescan) = (*extension).rescan {
                    rescan(
                        this.host,
                        CLAP_PARAM_RESCAN_VALUES | CLAP_PARAM_RESCAN_TEXT | CLAP_PARAM_RESCAN_INFO,
                    );
                }
            }
        }
    }
}
static AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports {
    count: Some(audio_count),
    get: Some(audio_info),
};
static NOTE_PORTS: clap_plugin_note_ports = clap_plugin_note_ports {
    count: Some(note_count),
    get: Some(note_info),
};
static PARAMS: clap_plugin_params = clap_plugin_params {
    count: Some(param_count),
    get_info: Some(param_info),
    get_value: Some(param_get),
    value_to_text: Some(param_text),
    text_to_value: Some(param_parse),
    flush: Some(flush),
};
static STATE: clap_plugin_state = clap_plugin_state {
    save: Some(save),
    load: Some(load_state),
};
unsafe extern "C" fn extension(_: *const clap_plugin, id: *const c_char) -> *const c_void {
    if cstr_matches(id, CLAP_EXT_AUDIO_PORTS) {
        (&AUDIO_PORTS as *const clap_plugin_audio_ports).cast()
    } else if cstr_matches(id, CLAP_EXT_NOTE_PORTS) {
        (&NOTE_PORTS as *const clap_plugin_note_ports).cast()
    } else if cstr_matches(id, CLAP_EXT_PARAMS) {
        (&PARAMS as *const clap_plugin_params).cast()
    } else if cstr_matches(id, CLAP_EXT_STATE) {
        (&STATE as *const clap_plugin_state).cast()
    } else {
        ptr::null()
    }
}
unsafe extern "C" fn plugin_count(_: *const clap_plugin_factory) -> u32 {
    1
}
unsafe extern "C" fn descriptor(
    _: *const clap_plugin_factory,
    index: u32,
) -> *const clap_plugin_descriptor {
    if index == 0 {
        &DESCRIPTOR
    } else {
        ptr::null()
    }
}
unsafe extern "C" fn create(
    _: *const clap_plugin_factory,
    host: *const clap_host,
    id: *const c_char,
) -> *const clap_plugin {
    if host.is_null()
        || !clap_version_is_compatible((*host).clap_version)
        || id.is_null()
        || CStr::from_ptr(id).to_bytes_with_nul() != ID
    {
        return ptr::null();
    }
    let values = defaults();
    let mut instance = Box::new(Instance {
        plugin: clap_plugin {
            desc: &DESCRIPTOR,
            plugin_data: ptr::null_mut(),
            init: Some(plugin_init),
            destroy: Some(destroy),
            activate: Some(activate),
            deactivate: Some(deactivate),
            start_processing: Some(start),
            stop_processing: Some(stop),
            reset: Some(reset),
            process: Some(process),
            get_extension: Some(extension),
            on_main_thread: Some(on_main_thread),
        },
        host,
        audio: UnsafeCell::new(AudioState::new()),
        active: AtomicBool::new(false),
        processing: AtomicBool::new(false),
        values: std::array::from_fn(|i| AtomicU64::new(values[i].to_bits())),
        pending: std::array::from_fn(|i| AtomicU64::new(values[i].to_bits())),
        published_version: AtomicU64::new(0),
        pending_version: AtomicU64::new(0),
        applied_version: AtomicU64::new(0),
        rescan: AtomicBool::new(false),
    });
    instance.plugin.plugin_data = (&mut *instance as *mut Instance).cast();
    let pointer = &instance.plugin as *const clap_plugin;
    let _ = Box::into_raw(instance);
    pointer
}
static FACTORY: clap_plugin_factory = clap_plugin_factory {
    get_plugin_count: Some(plugin_count),
    get_plugin_descriptor: Some(descriptor),
    create_plugin: Some(create),
};
unsafe extern "C" fn entry_init(_: *const c_char) -> bool {
    true
}
unsafe extern "C" fn entry_deinit() {}
unsafe extern "C" fn factory(id: *const c_char) -> *const c_void {
    if cstr_matches(id, CLAP_PLUGIN_FACTORY_ID) {
        (&FACTORY as *const clap_plugin_factory).cast()
    } else {
        ptr::null()
    }
}
#[no_mangle]
pub static clap_entry: clap_plugin_entry = clap_plugin_entry {
    clap_version: CLAP_VERSION,
    init: Some(entry_init),
    deinit: Some(entry_deinit),
    get_factory: Some(factory),
};

#[cfg(test)]
mod tests;
