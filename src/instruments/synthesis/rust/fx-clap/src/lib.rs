//! Native stereo effect adapter for the shared ProcessorBank. Audio/lifecycle
//! callbacks own the DSP; main-thread state loading uses an atomic mailbox.
use clap_sys::{
    audio_buffer::*,
    entry::*,
    events::*,
    ext::{audio_ports::*, latency::*, params::*, state::*},
    factory::plugin_factory::*,
    host::*,
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
    sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
};
use synthesis_core::processing::{ProcessorBank, FRAMES};
use synthesis_presets::{PROCESSOR_NAMES, PROCESSOR_PARAM_NAMES, PROCESSOR_PRESETS};
const COUNT: usize = 25;
const METHOD: usize = 0;
const PRESET: usize = 1;
const WET: usize = 2;
const BYPASS: usize = 3;
const INPUT: usize = 4;
const OUTPUT: usize = 5;
const SOURCE: usize = 6;
const FREQ: usize = 7;
const MACRO: usize = 8;
const TEST_ON: usize = 24;
const SOURCE_NAMES: [&str; 11] = [
    "External input",
    "Sine",
    "Two-tone",
    "Noise",
    "Impulses",
    "Pulse / saw",
    "Drum pattern",
    "Voiced phrase",
    "Pink noise",
    "Brown noise",
    "Gaussian white noise",
];
// Shared-core spectral processing has fixed latency; bank bypass is immediate.
fn requested_latency(values: &[f64; COUNT]) -> u32 {
    if values[METHOD] == 16.0 && values[BYPASS] < 0.5 {
        1024
    } else {
        0
    }
}
const ID: &[u8] = b"org.morphazoid.synthesaurus.fx\0";
const MAGIC: [u8; 8] = *b"SYNFXCLP";
const STATE_SIZE: usize = 12 + COUNT * 8;
struct Features([*const c_char; 3]);
unsafe impl Sync for Features {}
static FEATURES: Features = Features([
    b"audio-effect\0".as_ptr().cast(),
    b"stereo\0".as_ptr().cast(),
    ptr::null(),
]);
static DESCRIPTOR: clap_plugin_descriptor = clap_plugin_descriptor {
    clap_version: CLAP_VERSION,
    id: ID.as_ptr().cast(),
    name: b"Synthesaurus FX\0".as_ptr().cast(),
    vendor: b"Morphazoid\0".as_ptr().cast(),
    url: b"https://morphazoid.com/\0".as_ptr().cast(),
    manual_url: b"https://morphazoid.com/synthesis.html\0".as_ptr().cast(),
    support_url: ptr::null(),
    version: b"0.1.0\0".as_ptr().cast(),
    description: b"Stereo Rust DSP processing compendium\0".as_ptr().cast(),
    features: FEATURES.0.as_ptr(),
};
fn limits(i: usize) -> (f64, f64) {
    match i {
        METHOD => (0., (PROCESSOR_NAMES.len() - 1) as f64),
        PRESET => (0., 7.),
        INPUT | OUTPUT => (-36., 24.),
        SOURCE => (0., (SOURCE_NAMES.len() - 1) as f64),
        FREQ => (20., 8000.),
        _ => (0., 1.),
    }
}
fn bounded(i: usize, v: f64, fallback: f64) -> f64 {
    let (a, b) = limits(i);
    let v = if v.is_finite() {
        v.clamp(a, b)
    } else {
        fallback
    };
    if matches!(i, METHOD | PRESET | BYPASS | SOURCE | TEST_ON) {
        v.round()
    } else {
        v
    }
}
fn preset(v: &mut [f64; COUNT]) {
    let p = &PROCESSOR_PRESETS[v[METHOD] as usize][v[PRESET] as usize];
    v[WET] = p.wet as f64;
    v[INPUT] = p.input_db as f64;
    v[OUTPUT] = p.output_db as f64;
    v[FREQ] = p.frequency as f64;
    for i in 0..16 {
        v[MACRO + i] = p.params[i] as f64;
    }
}
fn defaults() -> [f64; COUNT] {
    let mut v = [0.; COUNT];
    preset(&mut v);
    v[SOURCE] = 0.;
    v[TEST_ON] = 0.;
    v
}
struct Audio {
    bank: Option<ProcessorBank>,
    values: [f64; COUNT],
    max_frames: u32,
}
impl Audio {
    fn new() -> Self {
        Self {
            bank: None,
            values: defaults(),
            max_frames: 0,
        }
    }
    fn apply(&mut self) {
        if let Some(b) = self.bank.as_mut() {
            b.set_method(self.values[METHOD] as usize);
            b.set_params(std::array::from_fn(|i| self.values[MACRO + i] as f32));
            b.set_mix(
                self.values[WET] as f32,
                self.values[BYPASS] > 0.5,
                self.values[INPUT] as f32,
                self.values[OUTPUT] as f32,
            );
            b.set_source(
                self.values[SOURCE] as u32,
                self.values[FREQ] as f32,
                self.values[SOURCE] == 0. || self.values[TEST_ON] > 0.5,
            );
        }
    }
}
struct Plugin {
    plugin: clap_plugin,
    host: *const clap_host,
    audio: UnsafeCell<Audio>,
    active: AtomicBool,
    processing: AtomicBool,
    published: [AtomicU64; COUNT],
    published_version: AtomicU64,
    pending: [AtomicU64; COUNT],
    pending_version: AtomicU64,
    applied_version: AtomicU64,
    rescan: AtomicBool,
    latency: AtomicU32,
    restart_pending: AtomicBool,
}
unsafe impl Sync for Plugin {}
unsafe fn instance<'a>(p: *const clap_plugin) -> &'a Plugin {
    &*((*p).plugin_data.cast::<Plugin>())
}
unsafe fn audio<'a>(p: &'a Plugin) -> &'a mut Audio {
    &mut *p.audio.get()
}
fn atomic_values(v: &[f64; COUNT]) -> [AtomicU64; COUNT] {
    std::array::from_fn(|i| AtomicU64::new(v[i].to_bits()))
}
impl Plugin {
    unsafe fn apply(&self, a: &mut Audio) -> bool {
        if self.active.load(Ordering::Acquire)
            && requested_latency(&a.values) != self.latency.load(Ordering::Acquire)
        {
            // CLAP latency may only change during activate(). Retain the old
            // complete DSP state until the host honors the restart request.
            if !self.restart_pending.swap(true, Ordering::AcqRel) && !self.host.is_null() {
                if let Some(restart) = (*self.host).request_restart {
                    restart(self.host);
                }
            }
            return false;
        }
        a.apply();
        true
    }
    fn publish(&self, v: &[f64; COUNT]) {
        self.published_version.fetch_add(1, Ordering::AcqRel);
        for (i, value) in v.iter().enumerate() {
            self.published[i].store(value.to_bits(), Ordering::Relaxed);
        }
        self.published_version.fetch_add(1, Ordering::Release);
    }
    fn snapshot(&self) -> Option<[f64; COUNT]> {
        for _ in 0..3 {
            let version = self.published_version.load(Ordering::Acquire);
            if version & 1 != 0 {
                continue;
            }
            let values =
                std::array::from_fn(|i| f64::from_bits(self.published[i].load(Ordering::Relaxed)));
            if self.published_version.load(Ordering::Acquire) == version {
                return Some(values);
            }
        }
        None
    }
    unsafe fn pending(&self, a: &mut Audio) {
        let version = self.pending_version.load(Ordering::Acquire);
        if version == self.applied_version.load(Ordering::Relaxed) || version & 1 != 0 {
            return;
        }
        let values =
            std::array::from_fn(|i| f64::from_bits(self.pending[i].load(Ordering::Relaxed)));
        if self.pending_version.load(Ordering::Acquire) != version {
            return;
        }
        a.values = values;
        if self.apply(a) {
            if let Some(b) = a.bank.as_mut() {
                b.reset();
            }
        }
        self.applied_version.store(version, Ordering::Release);
        self.publish(&a.values);
    }
    unsafe fn rescan(&self) {
        if !self.rescan.swap(true, Ordering::AcqRel) && !self.host.is_null() {
            if let Some(f) = (*self.host).request_callback {
                f(self.host);
            }
        }
    }
    unsafe fn parameter(&self, a: &mut Audio, id: usize, value: f64) {
        if id >= COUNT {
            return;
        }
        let v = bounded(id, value, a.values[id]);
        if v == a.values[id] {
            return;
        }
        a.values[id] = v;
        if id == METHOD || id == PRESET {
            preset(&mut a.values);
            self.rescan();
        }
        self.apply(a);
        self.publish(&a.values);
    }
}
unsafe extern "C" fn init(_: *const clap_plugin) -> bool {
    true
}
unsafe extern "C" fn destroy(p: *const clap_plugin) {
    if !p.is_null() {
        drop(Box::from_raw((*p).plugin_data.cast::<Plugin>()));
    }
}
unsafe extern "C" fn activate(p: *const clap_plugin, sr: f64, min: u32, max: u32) -> bool {
    let s = instance(p);
    if s.active.load(Ordering::Acquire)
        || !sr.is_finite()
        || !(8000.0..=192000.0).contains(&sr)
        || min == 0
        || max < min
        || max > 65536
    {
        return false;
    }
    let a = audio(s);
    a.bank = Some(ProcessorBank::new(sr as f32));
    a.max_frames = max;
    s.pending(a);
    a.apply();
    a.bank.as_mut().unwrap().reset();
    let latency = requested_latency(&a.values);
    let previous_latency = s.latency.swap(latency, Ordering::AcqRel);
    s.restart_pending.store(false, Ordering::Release);
    if latency != previous_latency && !s.host.is_null() {
        if let Some(get) = (*s.host).get_extension {
            let extension = get(s.host, CLAP_EXT_LATENCY.as_ptr()).cast::<clap_host_latency>();
            if let Some(extension) = extension.as_ref() {
                if let Some(changed) = extension.changed {
                    changed(s.host);
                }
            }
        }
    }
    s.active.store(true, Ordering::Release);
    true
}
unsafe extern "C" fn deactivate(p: *const clap_plugin) {
    let s = instance(p);
    s.processing.store(false, Ordering::Release);
    s.active.store(false, Ordering::Release);
    audio(s).bank = None;
}
unsafe extern "C" fn start(p: *const clap_plugin) -> bool {
    let s = instance(p);
    if !s.active.load(Ordering::Acquire) || s.processing.swap(true, Ordering::AcqRel) {
        return false;
    }
    if let Some(bank) = audio(s).bank.as_mut() {
        bank.set_freeze_allowed(true);
    }
    true
}
unsafe extern "C" fn stop(p: *const clap_plugin) {
    let s = instance(p);
    s.processing.store(false, Ordering::Release);
    if let Some(bank) = audio(s).bank.as_mut() {
        bank.set_freeze_allowed(false);
    }
}
unsafe extern "C" fn reset(p: *const clap_plugin) {
    let s = instance(p);
    if let Some(b) = audio(s).bank.as_mut() {
        b.reset();
    }
}
unsafe fn input_sample(buffer: Option<&clap_audio_buffer>, channel: usize, index: usize) -> f32 {
    let Some(b) = buffer else {
        return 0.;
    };
    if b.channel_count == 0 {
        return 0.;
    }
    let channel = channel.min(b.channel_count as usize - 1);
    if !b.data32.is_null() {
        let p = *b.data32.add(channel);
        if !p.is_null() {
            return *p.add(index);
        }
    }
    if !b.data64.is_null() {
        let p = *b.data64.add(channel);
        if !p.is_null() {
            return *p.add(index) as f32;
        }
    }
    0.
}
unsafe fn output_sample(b: &clap_audio_buffer, channel: usize, index: usize, value: f32) {
    if channel >= b.channel_count as usize {
        return;
    }
    if !b.data32.is_null() {
        let p = *b.data32.add(channel);
        if !p.is_null() {
            *p.add(index) = value;
        }
    }
    if !b.data64.is_null() {
        let p = *b.data64.add(channel);
        if !p.is_null() {
            *p.add(index) = value as f64;
        }
    }
}
unsafe fn render_span(
    a: &mut Audio,
    input: Option<&clap_audio_buffer>,
    output: &clap_audio_buffer,
    start: usize,
    end: usize,
) {
    let Some(b) = a.bank.as_mut() else {
        return;
    };
    let mut cursor = start;
    while cursor < end {
        let n = (end - cursor).min(FRAMES);
        for c in 0..2 {
            for i in 0..n {
                b.input_mut(c)[i] = input_sample(input, c, cursor + i);
            }
        }
        b.process(n);
        for c in 0..output.channel_count as usize {
            for i in 0..n {
                output_sample(
                    output,
                    c,
                    cursor + i,
                    if c < 2 { b.output(c)[i] } else { 0. },
                );
            }
        }
        cursor += n;
    }
}
unsafe fn handle_event(s: &Plugin, a: &mut Audio, h: *const clap_event_header) {
    if h.is_null() {
        return;
    }
    if (*h).space_id != CLAP_CORE_EVENT_SPACE_ID
        || (*h).type_ != CLAP_EVENT_PARAM_VALUE
        || (*h).size < (size_of::<clap_event_param_value>() as u32)
    {
        return;
    }
    let v = &*h.cast::<clap_event_param_value>();
    s.parameter(a, v.param_id as usize, v.value);
}
unsafe extern "C" fn process(
    p: *const clap_plugin,
    process: *const clap_process,
) -> clap_process_status {
    let s = instance(p);
    if process.is_null() || !s.processing.load(Ordering::Acquire) {
        return CLAP_PROCESS_ERROR;
    }
    let process = &*process;
    let a = audio(s);
    if process.frames_count > a.max_frames
        || process.audio_outputs_count < 1
        || process.audio_outputs.is_null()
    {
        return CLAP_PROCESS_ERROR;
    }
    s.pending(a);
    let out = &*process.audio_outputs;
    let input = if process.audio_inputs_count > 0 && !process.audio_inputs.is_null() {
        Some(&*process.audio_inputs)
    } else {
        None
    };
    let mut cursor = 0usize;
    if let Some(events) = process.in_events.as_ref() {
        if let (Some(size), Some(get)) = (events.size, events.get) {
            for i in 0..size(events).min(65536) {
                let h = get(events, i);
                if h.is_null() {
                    continue;
                }
                let frame = ((*h).time as usize).clamp(cursor, process.frames_count as usize);
                render_span(a, input, out, cursor, frame);
                cursor = frame;
                handle_event(s, a, h);
            }
        }
    }
    render_span(a, input, out, cursor, process.frames_count as usize);
    CLAP_PROCESS_CONTINUE
}
unsafe extern "C" fn main_thread(p: *const clap_plugin) {
    let s = instance(p);
    if s.rescan.swap(false, Ordering::AcqRel) && !s.host.is_null() {
        if let Some(get) = (*s.host).get_extension {
            let params = get(s.host, CLAP_EXT_PARAMS.as_ptr()).cast::<clap_host_params>();
            if !params.is_null() {
                if let Some(f) = (*params).rescan {
                    f(
                        s.host,
                        CLAP_PARAM_RESCAN_INFO | CLAP_PARAM_RESCAN_VALUES | CLAP_PARAM_RESCAN_TEXT,
                    );
                }
            }
        }
    }
}
unsafe fn copy_text(target: &mut [c_char], value: &str) {
    target.fill(0);
    let capacity = target.len().saturating_sub(1);
    for (out, byte) in target.iter_mut().take(capacity).zip(value.bytes()) {
        *out = byte as c_char;
    }
}
unsafe extern "C" fn port_count(_: *const clap_plugin, _: bool) -> u32 {
    1
}
unsafe extern "C" fn port_info(
    _: *const clap_plugin,
    index: u32,
    input: bool,
    info: *mut clap_audio_port_info,
) -> bool {
    if index != 0 || info.is_null() {
        return false;
    }
    let p = &mut *info;
    *p = std::mem::zeroed();
    p.id = if input { 0 } else { 1 };
    copy_text(
        &mut p.name,
        if input {
            "Stereo input"
        } else {
            "Stereo output"
        },
    );
    p.flags = CLAP_AUDIO_PORT_IS_MAIN | CLAP_AUDIO_PORT_SUPPORTS_64BITS;
    p.channel_count = 2;
    p.port_type = CLAP_PORT_STEREO.as_ptr();
    p.in_place_pair = if input { 1 } else { 0 };
    true
}
unsafe extern "C" fn param_count(_: *const clap_plugin) -> u32 {
    COUNT as u32
}
unsafe extern "C" fn param_info(
    p: *const clap_plugin,
    index: u32,
    out: *mut clap_param_info,
) -> bool {
    let index = index as usize;
    if index >= COUNT || out.is_null() {
        return false;
    }
    let s = instance(p);
    let values = s.snapshot().unwrap_or_else(defaults);
    let name = match index {
        METHOD => "Processor",
        PRESET => "Preset",
        WET => "Dry / wet",
        BYPASS => "Bypass",
        INPUT => "Input gain (dB)",
        OUTPUT => "Output gain (dB)",
        SOURCE => "Input / test source",
        FREQ => "Test frequency",
        TEST_ON => "Test source on",
        _ => PROCESSOR_PARAM_NAMES[values[METHOD] as usize][index - MACRO],
    };
    let info = &mut *out;
    *info = std::mem::zeroed();
    info.id = index as u32;
    info.flags = CLAP_PARAM_IS_AUTOMATABLE
        | if matches!(index, METHOD | PRESET | BYPASS | SOURCE | TEST_ON) {
            CLAP_PARAM_IS_STEPPED
        } else {
            0
        }
        | if index == BYPASS {
            CLAP_PARAM_IS_BYPASS
        } else {
            0
        }
        | if name == "Unused" {
            CLAP_PARAM_IS_HIDDEN
        } else {
            0
        };
    copy_text(&mut info.name, name);
    copy_text(
        &mut info.module,
        if index >= MACRO && index < TEST_ON {
            "Processing"
        } else {
            "Routing"
        },
    );
    let (lo, hi) = limits(index);
    info.min_value = lo;
    info.max_value = hi;
    info.default_value = defaults()[index];
    true
}
unsafe extern "C" fn param_value(p: *const clap_plugin, id: u32, out: *mut f64) -> bool {
    if id as usize >= COUNT || out.is_null() {
        return false;
    }
    *out = f64::from_bits(instance(p).published[id as usize].load(Ordering::Acquire));
    true
}
unsafe extern "C" fn value_text(
    p: *const clap_plugin,
    id: u32,
    value: f64,
    out: *mut c_char,
    size: u32,
) -> bool {
    if id as usize >= COUNT || out.is_null() || size == 0 {
        return false;
    }
    let v = bounded(id as usize, value, 0.);
    let text = match id as usize {
        METHOD => PROCESSOR_NAMES[v as usize].to_owned(),
        PRESET => {
            let m = f64::from_bits(instance(p).published[METHOD].load(Ordering::Acquire)) as usize;
            PROCESSOR_PRESETS[m][v as usize].name.to_owned()
        }
        SOURCE => SOURCE_NAMES[v as usize].to_owned(),
        BYPASS | TEST_ON => {
            if v > 0.5 {
                "On".to_owned()
            } else {
                "Off".to_owned()
            }
        }
        _ => format!("{v:0.3}"),
    };
    copy_text(std::slice::from_raw_parts_mut(out, size as usize), &text);
    true
}
unsafe extern "C" fn text_value(
    _: *const clap_plugin,
    id: u32,
    text: *const c_char,
    out: *mut f64,
) -> bool {
    if id as usize >= COUNT || text.is_null() || out.is_null() {
        return false;
    }
    let Ok(text) = CStr::from_ptr(text).to_str() else {
        return false;
    };
    let Ok(value) = text.trim().parse::<f64>() else {
        return false;
    };
    if !value.is_finite() {
        return false;
    }
    *out = bounded(id as usize, value, 0.);
    true
}
unsafe extern "C" fn flush(
    p: *const clap_plugin,
    events: *const clap_input_events,
    _: *const clap_output_events,
) {
    let s = instance(p);
    let a = audio(s);
    s.pending(a);
    if let Some(events) = events.as_ref() {
        if let (Some(size), Some(get)) = (events.size, events.get) {
            for i in 0..size(events).min(65536) {
                handle_event(s, a, get(events, i));
            }
        }
    }
}
unsafe extern "C" fn save(p: *const clap_plugin, stream: *const clap_ostream) -> bool {
    let Some(stream) = stream.as_ref() else {
        return false;
    };
    let Some(write) = stream.write else {
        return false;
    };
    let Some(mut values) = instance(p).snapshot() else {
        return false;
    };
    values[TEST_ON] = 0.;
    let mut bytes = [0u8; STATE_SIZE];
    bytes[..8].copy_from_slice(&MAGIC);
    bytes[8..12].copy_from_slice(&1u32.to_le_bytes());
    for (i, v) in values.iter().enumerate() {
        bytes[12 + i * 8..20 + i * 8].copy_from_slice(&v.to_le_bytes());
    }
    let mut offset = 0;
    while offset < bytes.len() {
        let n = write(
            stream,
            bytes.as_ptr().add(offset).cast(),
            (bytes.len() - offset) as u64,
        );
        if n <= 0 || n as usize > bytes.len() - offset {
            return false;
        }
        offset += n as usize;
    }
    true
}
unsafe extern "C" fn load(p: *const clap_plugin, stream: *const clap_istream) -> bool {
    let Some(stream) = stream.as_ref() else {
        return false;
    };
    let Some(read) = stream.read else {
        return false;
    };
    let mut bytes = [0u8; STATE_SIZE];
    let mut offset = 0;
    while offset < bytes.len() {
        let n = read(
            stream,
            bytes.as_mut_ptr().add(offset).cast(),
            (bytes.len() - offset) as u64,
        );
        if n <= 0 || n as usize > bytes.len() - offset {
            return false;
        }
        offset += n as usize;
    }
    if bytes[..8] != MAGIC || u32::from_le_bytes(bytes[8..12].try_into().unwrap()) != 1 {
        return false;
    }
    let defaults = defaults();
    let mut values: [f64; COUNT] = std::array::from_fn(|i| {
        bounded(
            i,
            f64::from_le_bytes(bytes[12 + i * 8..20 + i * 8].try_into().unwrap()),
            defaults[i],
        )
    });
    values[TEST_ON] = 0.;
    let s = instance(p);
    s.pending_version.fetch_add(1, Ordering::AcqRel);
    for (i, v) in values.iter().enumerate() {
        s.pending[i].store(v.to_bits(), Ordering::Relaxed);
    }
    s.pending_version.fetch_add(1, Ordering::Release);
    s.rescan();
    if !s.active.load(Ordering::Acquire) {
        let a = audio(s);
        s.pending(a);
    }
    true
}
static PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports {
    count: Some(port_count),
    get: Some(port_info),
};
static PARAMS: clap_plugin_params = clap_plugin_params {
    count: Some(param_count),
    get_info: Some(param_info),
    get_value: Some(param_value),
    value_to_text: Some(value_text),
    text_to_value: Some(text_value),
    flush: Some(flush),
};
static STATE: clap_plugin_state = clap_plugin_state {
    save: Some(save),
    load: Some(load),
};
unsafe extern "C" fn get_latency(p: *const clap_plugin) -> u32 {
    instance(p).latency.load(Ordering::Acquire)
}
static LATENCY: clap_plugin_latency = clap_plugin_latency {
    get: Some(get_latency),
};
unsafe extern "C" fn extension(_: *const clap_plugin, id: *const c_char) -> *const c_void {
    if id.is_null() {
        return ptr::null();
    }
    let id = CStr::from_ptr(id);
    if id == CLAP_EXT_AUDIO_PORTS {
        (&PORTS as *const clap_plugin_audio_ports).cast()
    } else if id == CLAP_EXT_PARAMS {
        (&PARAMS as *const clap_plugin_params).cast()
    } else if id == CLAP_EXT_STATE {
        (&STATE as *const clap_plugin_state).cast()
    } else if id == CLAP_EXT_LATENCY {
        (&LATENCY as *const clap_plugin_latency).cast()
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
        || id.is_null()
        || CStr::from_ptr(id).to_bytes_with_nul() != ID
        || !clap_version_is_compatible((*host).clap_version)
    {
        return ptr::null();
    }
    let values = defaults();
    let mut s = Box::new(Plugin {
        plugin: clap_plugin {
            desc: &DESCRIPTOR,
            plugin_data: ptr::null_mut(),
            init: Some(init),
            destroy: Some(destroy),
            activate: Some(activate),
            deactivate: Some(deactivate),
            start_processing: Some(start),
            stop_processing: Some(stop),
            reset: Some(reset),
            process: Some(process),
            get_extension: Some(extension),
            on_main_thread: Some(main_thread),
        },
        host,
        audio: UnsafeCell::new(Audio::new()),
        active: AtomicBool::new(false),
        processing: AtomicBool::new(false),
        published: atomic_values(&values),
        published_version: AtomicU64::new(0),
        pending: atomic_values(&values),
        pending_version: AtomicU64::new(0),
        applied_version: AtomicU64::new(0),
        rescan: AtomicBool::new(false),
        latency: AtomicU32::new(0),
        restart_pending: AtomicBool::new(false),
    });
    s.plugin.plugin_data = (&mut *s as *mut Plugin).cast();
    let raw = Box::into_raw(s);
    &(*raw).plugin
}
unsafe extern "C" fn count(_: *const clap_plugin_factory) -> u32 {
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
static FACTORY: clap_plugin_factory = clap_plugin_factory {
    get_plugin_count: Some(count),
    get_plugin_descriptor: Some(descriptor),
    create_plugin: Some(create),
};
unsafe extern "C" fn entry_init(_: *const c_char) -> bool {
    true
}
unsafe extern "C" fn entry_deinit() {}
unsafe extern "C" fn factory(id: *const c_char) -> *const c_void {
    if !id.is_null() && CStr::from_ptr(id) == CLAP_PLUGIN_FACTORY_ID {
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
