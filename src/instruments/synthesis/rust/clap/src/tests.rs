use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

static CALLBACKS: AtomicUsize = AtomicUsize::new(0);
unsafe extern "C" fn request(_: *const clap_host) {
    CALLBACKS.fetch_add(1, Ordering::Relaxed);
}
unsafe extern "C" fn host_extension(_: *const clap_host, _: *const c_char) -> *const c_void {
    ptr::null()
}
struct Fixture {
    plugin: *const clap_plugin,
    _host: Box<clap_host>,
}
impl Fixture {
    unsafe fn new() -> Self {
        let host = Box::new(clap_host {
            clap_version: CLAP_VERSION,
            host_data: ptr::null_mut(),
            name: b"Fixture\0".as_ptr().cast(),
            vendor: b"Tests\0".as_ptr().cast(),
            url: b"\0".as_ptr().cast(),
            version: b"1\0".as_ptr().cast(),
            get_extension: Some(host_extension),
            request_restart: Some(request),
            request_process: Some(request),
            request_callback: Some(request),
        });
        let plugin = create(&FACTORY, &*host, ID.as_ptr().cast());
        assert!(!plugin.is_null());
        assert!(((*plugin).init.unwrap())(plugin));
        assert!(((*plugin).activate.unwrap())(plugin, 48000., 1, 4096));
        assert!(((*plugin).start_processing.unwrap())(plugin));
        Self {
            plugin,
            _host: host,
        }
    }
    unsafe fn flush(&self, events: &[Event]) {
        let list = clap_input_events {
            ctx: (&events as *const &[Event]).cast_mut().cast(),
            size: Some(event_size),
            get: Some(event_get),
        };
        (PARAMS.flush.unwrap())(self.plugin, &list, ptr::null());
    }
    unsafe fn render(&self, frames: usize, events: &[Event]) -> Vec<f32> {
        render_plugin(self.plugin, frames, events)
    }
    unsafe fn value(&self, index: usize) -> f64 {
        let mut value = 0.;
        assert!((PARAMS.get_value.unwrap())(
            self.plugin,
            index as u32,
            &mut value
        ));
        value
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        unsafe {
            ((*self.plugin).stop_processing.unwrap())(self.plugin);
            ((*self.plugin).deactivate.unwrap())(self.plugin);
            ((*self.plugin).destroy.unwrap())(self.plugin);
        }
    }
}
#[derive(Clone, Copy)]
enum Event {
    Note(clap_event_note),
    Midi(clap_event_midi),
    Param(clap_event_param_value),
}
fn header<T>(kind: u16, time: u32) -> clap_event_header {
    clap_event_header {
        size: size_of::<T>() as u32,
        time,
        space_id: CLAP_CORE_EVENT_SPACE_ID,
        type_: kind,
        flags: 0,
    }
}
fn note(kind: u16, time: u32, id: i32, channel: i16, key: i16) -> Event {
    Event::Note(clap_event_note {
        header: header::<clap_event_note>(kind, time),
        note_id: id,
        port_index: 0,
        channel,
        key,
        velocity: 0.8,
    })
}
fn midi(time: u32, data: [u8; 3]) -> Event {
    Event::Midi(clap_event_midi {
        header: header::<clap_event_midi>(CLAP_EVENT_MIDI, time),
        port_index: 0,
        data,
    })
}
fn param(time: u32, index: usize, value: f64) -> Event {
    Event::Param(clap_event_param_value {
        header: header::<clap_event_param_value>(CLAP_EVENT_PARAM_VALUE, time),
        param_id: index as u32,
        cookie: ptr::null_mut(),
        note_id: -1,
        port_index: -1,
        channel: -1,
        key: -1,
        value,
    })
}
unsafe extern "C" fn event_size(list: *const clap_input_events) -> u32 {
    (&*((*list).ctx.cast::<&[Event]>())).len() as u32
}
unsafe extern "C" fn event_get(
    list: *const clap_input_events,
    index: u32,
) -> *const clap_event_header {
    let events = &*((*list).ctx.cast::<&[Event]>());
    match events.get(index as usize) {
        Some(Event::Note(event)) => &event.header,
        Some(Event::Midi(event)) => &event.header,
        Some(Event::Param(event)) => &event.header,
        None => ptr::null(),
    }
}
unsafe fn render_plugin(plugin: *const clap_plugin, frames: usize, events: &[Event]) -> Vec<f32> {
    let mut left = vec![f32::NAN; frames];
    let mut right = vec![f32::NAN; frames];
    let mut channels = [left.as_mut_ptr(), right.as_mut_ptr()];
    let mut output = clap_audio_buffer {
        data32: channels.as_mut_ptr(),
        data64: ptr::null_mut(),
        channel_count: 2,
        latency: 0,
        constant_mask: 0,
    };
    let list = clap_input_events {
        ctx: (&events as *const &[Event]).cast_mut().cast(),
        size: Some(event_size),
        get: Some(event_get),
    };
    let process = clap_process {
        steady_time: -1,
        frames_count: frames as u32,
        transport: ptr::null(),
        audio_inputs: ptr::null(),
        audio_outputs: &mut output,
        audio_inputs_count: 0,
        audio_outputs_count: 1,
        in_events: &list,
        out_events: ptr::null(),
    };
    assert_eq!(
        ((*plugin).process.unwrap())(plugin, &process),
        CLAP_PROCESS_CONTINUE
    );
    assert!(left
        .iter()
        .all(|value| value.is_finite() && value.abs() <= 0.98));
    assert_eq!(left, right);
    left
}
fn energy(samples: &[f32]) -> f32 {
    samples.iter().map(|value| value * value).sum::<f32>() / samples.len().max(1) as f32
}

#[test]
fn descriptor_factory_ports_and_lifecycle_are_real_clap_interfaces() {
    unsafe {
        assert!((clap_entry.init.unwrap())(ptr::null()));
        let factory = (clap_entry.get_factory.unwrap())(CLAP_PLUGIN_FACTORY_ID.as_ptr())
            .cast::<clap_plugin_factory>();
        assert!(!factory.is_null());
        assert_eq!(((*factory).get_plugin_count.unwrap())(factory), 1);
        let descriptor = ((*factory).get_plugin_descriptor.unwrap())(factory, 0);
        assert_eq!(CStr::from_ptr((*descriptor).id).to_bytes_with_nul(), ID);
        assert!(((*factory).get_plugin_descriptor.unwrap())(factory, 1).is_null());
        let fixture = Fixture::new();
        assert_eq!((AUDIO_PORTS.count.unwrap())(fixture.plugin, false), 1);
        assert_eq!((AUDIO_PORTS.count.unwrap())(fixture.plugin, true), 0);
        let mut audio: clap_audio_port_info = std::mem::zeroed();
        assert!((AUDIO_PORTS.get.unwrap())(
            fixture.plugin,
            0,
            false,
            &mut audio
        ));
        assert_eq!(audio.channel_count, 2);
        assert!(audio.flags & CLAP_AUDIO_PORT_SUPPORTS_64BITS != 0);
        assert_eq!((NOTE_PORTS.count.unwrap())(fixture.plugin, true), 1);
        let mut notes: clap_note_port_info = std::mem::zeroed();
        assert!((NOTE_PORTS.get.unwrap())(
            fixture.plugin,
            0,
            true,
            &mut notes
        ));
        assert_eq!(
            notes.supported_dialects,
            CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI
        );
        assert_eq!((PARAMS.count.unwrap())(fixture.plugin), COUNT as u32);
        assert!(fixture.render(256, &[]).iter().all(|value| *value == 0.));
        assert!(!((*fixture.plugin).activate.unwrap())(
            fixture.plugin,
            48000.,
            1,
            128
        ));
        assert!(!((*fixture.plugin).start_processing.unwrap())(
            fixture.plugin
        ));
    }
}

#[test]
fn note_and_parameter_events_take_effect_at_sample_offsets() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[
            param(0, METHOD, 2.),
            param(0, ATTACK, 0.001),
            param(0, SUSTAIN, 1.),
            param(0, RELEASE, 0.01),
        ]);
        let samples = fixture.render(
            512,
            &[
                note(CLAP_EVENT_NOTE_ON, 128, 11, 0, 69),
                note(CLAP_EVENT_NOTE_OFF, 384, 11, 0, 69),
            ],
        );
        assert!(samples[..128].iter().all(|value| *value == 0.));
        assert!(energy(&samples[180..380]) > 1e-5);
        assert!(!audio(instance(fixture.plugin))
            .engine
            .as_ref()
            .unwrap()
            .is_held());
        let tail = fixture.render(2048, &[]);
        assert!(energy(&tail[1800..]) < 1e-8);
        ((*fixture.plugin).reset.unwrap())(fixture.plugin);
        fixture.flush(&[param(0, OUTPUT, 0.)]);
        // Settle the output ramp before the offset test, then start a held oscillator.
        fixture.render(4096, &[]);
        let before = fixture.render(
            512,
            &[
                note(CLAP_EVENT_NOTE_ON, 0, 12, 0, 60),
                param(256, OUTPUT, 0.5),
            ],
        );
        assert!(energy(&before[..256]) < 1e-10);
        assert!(energy(&before[300..]) > 1e-6);
    }
}

#[test]
fn identity_last_note_priority_sustain_and_all_notes_off_are_bounded() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[param(0, METHOD, 2.)]);
        fixture.render(
            64,
            &[
                note(CLAP_EVENT_NOTE_ON, 0, 1, 0, 60),
                note(CLAP_EVENT_NOTE_ON, 16, 2, 0, 67),
            ],
        );
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().id, 2);
        fixture.render(64, &[note(CLAP_EVENT_NOTE_OFF, 0, 1, 0, 60)]);
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().id, 2);
        fixture.render(
            64,
            &[
                note(CLAP_EVENT_NOTE_ON, 0, 3, 1, 72),
                note(CLAP_EVENT_NOTE_OFF, 32, 3, 1, 72),
            ],
        );
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().id, 2);
        fixture.render(
            64,
            &[
                midi(0, [0x90, 55, 100]),
                midi(4, [0xb0, 64, 127]),
                midi(8, [0x80, 55, 0]),
            ],
        );
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().key, 55);
        fixture.render(64, &[midi(0, [0xb0, 64, 0])]);
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().id, 2);
        fixture.render(64, &[midi(0, [0xb0, 123, 0])]);
        assert!(audio(instance(fixture.plugin)).latest().is_none());
        fixture.render(64, &[midi(0, [0x90, 60, 127]), midi(12, [0x90, 60, 0])]);
        assert!(!audio(instance(fixture.plugin))
            .engine
            .as_ref()
            .unwrap()
            .is_held());
        let events: Vec<_> = (0..400)
            .map(|id| {
                note(
                    CLAP_EVENT_NOTE_ON,
                    0,
                    id,
                    (id % 16) as i16,
                    (id % 128) as i16,
                )
            })
            .collect();
        fixture.render(32, &events);
        assert_eq!(
            audio(instance(fixture.plugin))
                .held
                .iter()
                .flatten()
                .count(),
            MAX_HELD
        );
        fixture.render(32, &[note(CLAP_EVENT_NOTE_CHOKE, 0, -1, -1, -1)]);
        assert!(audio(instance(fixture.plugin)).latest().is_none());
    }
}

#[test]
fn all_methods_and_eight_presets_recall_browser_parameters_and_rescan_names() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[param(0, OUTPUT, 0.19)]);
        for method in 0..METHOD_NAMES.len() {
            fixture.flush(&[param(0, METHOD, method as f64)]);
            for preset in 0..8 {
                fixture.flush(&[param(0, PRESET, preset as f64)]);
                let expected = &PRESETS[method][preset];
                assert_eq!(fixture.value(FREQ), expected.frequency as f64);
                assert_eq!(fixture.value(OUTPUT), 0.19);
                assert_eq!(
                    audio(instance(fixture.plugin))
                        .engine
                        .as_ref()
                        .unwrap()
                        .level_trim_db(),
                    expected.level_trim_db
                );
                for i in 0..16 {
                    assert_eq!(fixture.value(macro_id(i)), expected.params[i] as f64);
                }
                for i in 0..4 {
                    assert_eq!(fixture.value(ATTACK + i), expected.envelope[i] as f64);
                }
                assert_eq!(
                    audio(instance(fixture.plugin))
                        .engine
                        .as_ref()
                        .unwrap()
                        .method(),
                    method as u32
                );
                let mut text = [0 as c_char; 256];
                assert!((PARAMS.value_to_text.unwrap())(
                    fixture.plugin,
                    PRESET as u32,
                    preset as f64,
                    text.as_mut_ptr(),
                    256
                ));
                assert_eq!(
                    CStr::from_ptr(text.as_ptr()).to_str().unwrap(),
                    expected.name
                );
            }
            let mut info: clap_param_info = std::mem::zeroed();
            assert!((PARAMS.get_info.unwrap())(
                fixture.plugin,
                MACRO as u32,
                &mut info
            ));
            assert_eq!(
                CStr::from_ptr(info.name.as_ptr()).to_str().unwrap(),
                PARAM_NAMES[method][0]
            );
        }
        assert!(CALLBACKS.load(Ordering::Relaxed) > 0);
    }
}

struct MemoryStream {
    bytes: Vec<u8>,
    offset: usize,
    chunk: usize,
}
unsafe extern "C" fn write(stream: *const clap_ostream, bytes: *const c_void, length: u64) -> i64 {
    let memory = &mut *(*stream).ctx.cast::<MemoryStream>();
    let length = (length as usize).min(memory.chunk);
    memory
        .bytes
        .extend_from_slice(std::slice::from_raw_parts(bytes.cast::<u8>(), length));
    length as i64
}
unsafe extern "C" fn read(stream: *const clap_istream, bytes: *mut c_void, length: u64) -> i64 {
    let memory = &mut *(*stream).ctx.cast::<MemoryStream>();
    let length = (length as usize)
        .min(memory.chunk)
        .min(memory.bytes.len().saturating_sub(memory.offset));
    ptr::copy_nonoverlapping(
        memory.bytes.as_ptr().add(memory.offset),
        bytes.cast::<u8>(),
        length,
    );
    memory.offset += length;
    length as i64
}
unsafe fn save_bytes(plugin: *const clap_plugin) -> Vec<u8> {
    let mut memory = MemoryStream {
        bytes: vec![],
        offset: 0,
        chunk: 7,
    };
    let stream = clap_ostream {
        ctx: (&mut memory as *mut MemoryStream).cast(),
        write: Some(write),
    };
    assert!((STATE.save.unwrap())(plugin, &stream));
    memory.bytes
}
unsafe fn load_bytes(plugin: *const clap_plugin, bytes: Vec<u8>) -> bool {
    let mut memory = MemoryStream {
        bytes,
        offset: 0,
        chunk: 11,
    };
    let stream = clap_istream {
        ctx: (&mut memory as *mut MemoryStream).cast(),
        read: Some(read),
    };
    (STATE.load.unwrap())(plugin, &stream)
}

#[test]
fn state_handles_partial_streams_invalid_versions_and_silent_atomic_restore() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[
            param(0, METHOD, 11.),
            param(0, PRESET, 3.),
            param(0, MACRO + 2, 0.713),
            param(0, OUTPUT, 0.21),
            param(0, GATE, 1.),
        ]);
        fixture.render(128, &[]);
        let saved = save_bytes(fixture.plugin);
        assert_eq!(saved.len(), STATE_SIZE);
        assert_eq!(
            f64::from_le_bytes(saved[12 + GATE * 8..20 + GATE * 8].try_into().unwrap()),
            0.
        );
        fixture.flush(&[param(0, METHOD, 7.), param(0, OUTPUT, 0.5)]);
        assert!(load_bytes(fixture.plugin, saved.clone()));
        assert_eq!(fixture.value(METHOD), 11.);
        assert_eq!(fixture.value(OUTPUT), 0.21);
        // Main-thread load has not touched the audio-owned engine yet.
        assert_eq!(
            audio(instance(fixture.plugin))
                .engine
                .as_ref()
                .unwrap()
                .method(),
            7
        );
        fixture.render(256, &[]);
        assert_eq!(
            audio(instance(fixture.plugin))
                .engine
                .as_ref()
                .unwrap()
                .method(),
            11
        );
        assert_eq!(fixture.value(MACRO + 2), 0.713);
        assert_eq!(
            audio(instance(fixture.plugin))
                .engine
                .as_ref()
                .unwrap()
                .level_trim_db(),
            PRESETS[11][3].level_trim_db
        );
        assert_eq!(fixture.value(GATE), 0.);
        assert!(fixture.render(256, &[]).iter().all(|value| *value == 0.));
        let mut invalid = saved.clone();
        invalid[8] = 77;
        assert!(!load_bytes(fixture.plugin, invalid));
        assert!(!load_bytes(fixture.plugin, saved[..40].to_vec()));
        assert_eq!(fixture.value(METHOD), 11.);
        let mut bounded = saved;
        bounded[12 + FREQ * 8..20 + FREQ * 8].copy_from_slice(&f64::NAN.to_le_bytes());
        bounded[12 + OUTPUT * 8..20 + OUTPUT * 8].copy_from_slice(&99_f64.to_le_bytes());
        assert!(load_bytes(fixture.plugin, bounded));
        fixture.render(32, &[]);
        assert_eq!(fixture.value(FREQ), defaults()[FREQ]);
        assert_eq!(fixture.value(OUTPUT), 1.);
    }
}

#[test]
fn sixty_four_bit_output_and_reactivation_work() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[param(0, METHOD, 2.), param(0, GATE, 1.)]);
        let mut left = [0_f64; 256];
        let mut right = [0_f64; 256];
        let mut channels = [left.as_mut_ptr(), right.as_mut_ptr()];
        let mut output = clap_audio_buffer {
            data32: ptr::null_mut(),
            data64: channels.as_mut_ptr(),
            channel_count: 2,
            latency: 0,
            constant_mask: 0,
        };
        let process = clap_process {
            steady_time: 0,
            frames_count: 256,
            transport: ptr::null(),
            audio_inputs: ptr::null(),
            audio_outputs: &mut output,
            audio_inputs_count: 0,
            audio_outputs_count: 1,
            in_events: ptr::null(),
            out_events: ptr::null(),
        };
        assert_eq!(
            ((*fixture.plugin).process.unwrap())(fixture.plugin, &process),
            CLAP_PROCESS_CONTINUE
        );
        assert_eq!(left, right);
        assert!(left.iter().any(|value| value.abs() > 0.0001));
        ((*fixture.plugin).stop_processing.unwrap())(fixture.plugin);
        ((*fixture.plugin).deactivate.unwrap())(fixture.plugin);
        assert!(((*fixture.plugin).activate.unwrap())(
            fixture.plugin,
            44100.,
            1,
            4096
        ));
        assert!(((*fixture.plugin).start_processing.unwrap())(
            fixture.plugin
        ));
        assert_eq!(
            audio(instance(fixture.plugin))
                .engine
                .as_ref()
                .unwrap()
                .sample_rate(),
            44100.
        );
        assert!(fixture.render(128, &[]).iter().all(|value| *value == 0.));
    }
}

struct CountAlloc;
thread_local! {
    static TRACK_ALLOC: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static ALLOCATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
fn record_alloc() {
    let _ = TRACK_ALLOC.try_with(|tracking| {
        if tracking.get() {
            let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
        }
    });
}
unsafe impl std::alloc::GlobalAlloc for CountAlloc {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        record_alloc();
        std::alloc::System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
        record_alloc();
        std::alloc::System.alloc_zeroed(layout)
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        record_alloc();
        std::alloc::System.realloc(pointer, layout, size)
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: std::alloc::Layout) {
        std::alloc::System.dealloc(pointer, layout)
    }
}
#[global_allocator]
static ALLOCATOR: CountAlloc = CountAlloc;

#[test]
fn process_allocates_nothing_for_every_method_including_trained_models() {
    unsafe {
        let fixture = Fixture::new();
        let mut left = [0_f32; 128];
        let mut right = [0_f32; 128];
        let mut channels = [left.as_mut_ptr(), right.as_mut_ptr()];
        let mut output = clap_audio_buffer {
            data32: channels.as_mut_ptr(),
            data64: ptr::null_mut(),
            channel_count: 2,
            latency: 0,
            constant_mask: 0,
        };
        for voice_mode in [0., 1.] {
            for method in 0..METHOD_NAMES.len() {
                let event_array = [
                    param(0, VOICE_MODE, voice_mode),
                    param(0, METHOD, method as f64),
                    param(0, PRESET, 1.),
                    midi(24, [0x90, 60, 100]),
                    midi(32, [0x90, 64, 100]),
                    midi(48, [0x90, 67, 100]),
                    midi(100, [0x80, 60, 0]),
                ];
                let events: &[Event] = &event_array;
                let list = clap_input_events {
                    ctx: (&events as *const &[Event]).cast_mut().cast(),
                    size: Some(event_size),
                    get: Some(event_get),
                };
                let process = clap_process {
                    steady_time: -1,
                    frames_count: 128,
                    transport: ptr::null(),
                    audio_inputs: ptr::null(),
                    audio_outputs: &mut output,
                    audio_inputs_count: 0,
                    audio_outputs_count: 1,
                    in_events: &list,
                    out_events: ptr::null(),
                };
                ALLOCATIONS.with(|count| count.set(0));
                TRACK_ALLOC.with(|tracking| tracking.set(true));
                let status = ((*fixture.plugin).process.unwrap())(fixture.plugin, &process);
                TRACK_ALLOC.with(|tracking| tracking.set(false));
                let count = ALLOCATIONS.with(|count| count.get());
                assert_eq!(status, CLAP_PROCESS_CONTINUE);
                assert_eq!(
                    count, 0,
                    "method {method}, mode {voice_mode} allocated inside process"
                );
                assert!(left.iter().all(|value| value.is_finite()));
            }
        }
    }
}

#[test]
fn state_loading_during_processing_uses_the_audio_mailbox() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[param(0, METHOD, 2.)]);
        let baseline = save_bytes(fixture.plugin);
        let address = fixture.plugin as usize;
        let thread = std::thread::spawn(move || {
            let plugin = address as *const clap_plugin;
            for _ in 0..128 {
                render_plugin(plugin, 128, &[]);
            }
        });
        for index in 0..32 {
            let mut state = baseline.clone();
            state[12 + FREQ * 8..20 + FREQ * 8]
                .copy_from_slice(&(100. + index as f64 * 17.).to_le_bytes());
            state[12 + MACRO * 8..20 + MACRO * 8]
                .copy_from_slice(&(index as f64 / 32.).to_le_bytes());
            assert!(load_bytes(fixture.plugin, state));
        }
        thread.join().unwrap();
        fixture.render(128, &[]);
        assert_eq!(fixture.value(FREQ), 627.);
        assert_eq!(fixture.value(MACRO), 31. / 32.);
        assert!(fixture.render(128, &[]).iter().all(|sample| *sample == 0.));
    }
}

#[test]
fn expanded_macro_ids_and_legacy_state_migration_preserve_old_automation() {
    unsafe {
        assert_eq!(GATE, 16);
        assert_eq!(macro_id(0), 8);
        assert_eq!(macro_id(7), 15);
        assert_eq!(macro_id(8), 17);
        assert_eq!(macro_id(15), 24);
        let fixture = Fixture::new();
        fixture.flush(&[param(0, METHOD, 31.), param(0, macro_id(8), 0.73)]);
        assert_eq!(fixture.value(17), 0.73);
        let saved = save_bytes(fixture.plugin);
        assert!(load_bytes(fixture.plugin, saved.clone()));
        assert_eq!(fixture.value(17), 0.73);
        let mut legacy = saved[..12 + 17 * 8].to_vec();
        legacy[8..12].copy_from_slice(&1_u32.to_le_bytes());
        legacy[12 + MACRO * 8..20 + MACRO * 8].copy_from_slice(&0.41_f64.to_le_bytes());
        for slot in 4..8 {
            legacy[12 + (MACRO + slot) * 8..20 + (MACRO + slot) * 8]
                .copy_from_slice(&0_f64.to_le_bytes());
        }
        assert!(load_bytes(fixture.plugin, legacy));
        assert!((fixture.value(MACRO) - 0.41).abs() < 1e-6);
        for slot in 4..16 {
            assert_eq!(
                fixture.value(macro_id(slot)),
                PRESETS[31][0].params[slot] as f64
            );
        }
        assert_eq!(fixture.value(GATE), 0.0);
    }
}

#[test]
fn legacy_state_keeps_physical_values_when_parameter_ranges_expand() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[param(0, METHOD, 11.)]);
        let mut legacy = save_bytes(fixture.plugin)[..12 + 17 * 8].to_vec();
        legacy[8..12].copy_from_slice(&1_u32.to_le_bytes());
        legacy[12 + (MACRO + 1) * 8..20 + (MACRO + 1) * 8].copy_from_slice(&0.5_f64.to_le_bytes());
        assert!(load_bytes(fixture.plugin, legacy));
        assert_eq!(fixture.value(MACRO + 1), 0.25); // old index8 in range0..16 remains8 in range0..32.
    }
}

#[test]
fn output_headroom_and_preset_trim_stay_independent_of_macro_edits() {
    unsafe {
        let fixture = Fixture::new();
        assert_eq!(fixture.value(OUTPUT), 0.7);
        let mut info: clap_param_info = std::mem::zeroed();
        assert!((PARAMS.get_info.unwrap())(
            fixture.plugin,
            OUTPUT as u32,
            &mut info
        ));
        assert_eq!(info.min_value, 0.0);
        assert_eq!(info.max_value, 1.0);
        fixture.flush(&[
            param(0, METHOD, 17.),
            param(0, PRESET, 4.),
            param(0, OUTPUT, 1.),
            param(0, MACRO, 0.173),
        ]);
        assert_eq!(fixture.value(MACRO), 0.173);
        assert_eq!(fixture.value(OUTPUT), 1.0);
        assert_eq!(
            audio(instance(fixture.plugin))
                .engine
                .as_ref()
                .unwrap()
                .level_trim_db(),
            PRESETS[17][4].level_trim_db
        );
        let sound = fixture.render(4096, &[note(CLAP_EVENT_NOTE_ON, 0, 22, 0, 60)]);
        assert!(energy(&sound) > 1.0e-9);
        fixture.render(4096, &[param(0, OUTPUT, 0.)]);
        let silent = fixture.render(4096, &[]);
        assert!(energy(&silent[2048..]) < 1.0e-16);
    }
}

#[test]
fn mono_default_matches_the_existing_single_engine_sample_for_sample() {
    unsafe {
        let fixture = Fixture::new();
        assert_eq!(fixture.value(VOICE_MODE), 0.);
        fixture.flush(&[param(0, METHOD, 2.), param(0, PRESET, 1.)]);
        let expected_preset = &PRESETS[2][1];
        let mut reference = Engine::new(48000.);
        reference.set_method(2);
        reference.set_level_trim_db(expected_preset.level_trim_db);
        reference.set_params(expected_preset.params);
        reference.set_frequency(expected_preset.frequency);
        let envelope = expected_preset.envelope;
        reference.set_envelope(envelope[0], envelope[1], envelope[2], envelope[3]);
        reference.note_on(440., 0.8);
        let actual = fixture.render(4096, &[note(CLAP_EVENT_NOTE_ON, 0, 21, 0, 69)]);
        let mut expected = vec![0.; 4096];
        reference.render(&mut expected);
        expected
            .iter_mut()
            .for_each(|sample| *sample = (*sample * 0.7).clamp(-0.98, 0.98));
        assert_eq!(actual, expected);
    }
}

#[test]
fn voice_mode_appends_an_enum_and_survives_presets_and_v3_state() {
    unsafe {
        let fixture = Fixture::new();
        assert_eq!(VOICE_MODE, 25);
        assert_eq!(macro_slot(VOICE_MODE), None);
        let mut info: clap_param_info = std::mem::zeroed();
        assert!((PARAMS.get_info.unwrap())(
            fixture.plugin,
            VOICE_MODE as u32,
            &mut info
        ));
        assert_eq!(info.default_value, 0.);
        assert_eq!(info.max_value, 1.);
        assert_ne!(info.flags & CLAP_PARAM_IS_ENUM, 0);
        fixture.flush(&[
            param(0, VOICE_MODE, 1.),
            param(0, METHOD, 2.),
            param(0, PRESET, 3.),
        ]);
        assert_eq!(fixture.value(VOICE_MODE), 1.);
        let saved = save_bytes(fixture.plugin);
        assert_eq!(&saved[8..12], &3_u32.to_le_bytes());
        fixture.flush(&[param(0, VOICE_MODE, 0.)]);
        assert!(load_bytes(fixture.plugin, saved.clone()));
        fixture.render(128, &[]);
        assert_eq!(fixture.value(VOICE_MODE), 1.);
        assert!(audio(instance(fixture.plugin)).polyphonic);
        for (version, count) in [(1, 17), (2, 25)] {
            let mut old = saved[..12 + count * 8].to_vec();
            old[8..12].copy_from_slice(&(version as u32).to_le_bytes());
            assert!(load_bytes(fixture.plugin, old));
            fixture.render(128, &[]);
            assert_eq!(fixture.value(VOICE_MODE), 0., "version {version}");
            assert!(!audio(instance(fixture.plugin)).polyphonic);
        }
    }
}

#[test]
fn polyphonic_note_ids_channel_keys_sustain_and_chokes_are_independent() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[
            param(0, METHOD, 2.),
            param(0, SUSTAIN, 1.),
            param(0, RELEASE, 0.01),
            param(0, VOICE_MODE, 1.),
        ]);
        let initial = fixture.render(
            4096,
            &[
                note(CLAP_EVENT_NOTE_ON, 0, 10, 0, 60),
                note(CLAP_EVENT_NOTE_ON, 0, 11, 0, 60),
                midi(0, [0x91, 60, 100]),
            ],
        );
        assert!(energy(&initial) > 1.0e-6);
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            3
        );
        fixture.render(4096, &[note(CLAP_EVENT_NOTE_OFF, 0, 10, 0, 60)]);
        for _ in 0..8 {
            fixture.render(4096, &[]);
        }
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            2
        );
        fixture.render(4096, &[midi(0, [0xb1, 64, 127]), midi(1, [0x81, 60, 0])]);
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            2
        );
        fixture.render(4096, &[midi(0, [0xb1, 64, 0])]);
        for _ in 0..8 {
            fixture.render(4096, &[]);
        }
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            1
        );
        assert!(energy(&fixture.render(2048, &[])) > 1.0e-6);
        fixture.render(128, &[note(CLAP_EVENT_NOTE_CHOKE, 0, 11, -1, -1)]);
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            0
        );
        assert!(fixture.render(2048, &[]).iter().all(|sample| *sample == 0.));
    }
}

#[test]
fn switching_modes_revoices_held_keys_without_losing_note_offs() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[
            param(0, METHOD, 2.),
            param(0, SUSTAIN, 1.),
            param(0, RELEASE, 0.01),
        ]);
        fixture.render(4096, &[midi(0, [0x90, 60, 100]), midi(0, [0x90, 67, 100])]);
        fixture.render(4096, &[param(0, VOICE_MODE, 1.)]);
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            2
        );
        fixture.render(4096, &[param(0, VOICE_MODE, 0.)]);
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().key, 67);
        assert!(audio(instance(fixture.plugin))
            .engine
            .as_ref()
            .unwrap()
            .is_held());
        fixture.render(4096, &[midi(0, [0x80, 67, 0])]);
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().key, 60);
        fixture.render(4096, &[param(0, VOICE_MODE, 1.), midi(128, [0x80, 60, 0])]);
        assert!(audio(instance(fixture.plugin)).latest().is_none());
        for _ in 0..8 {
            fixture.render(4096, &[]);
        }
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            0
        );
    }
}

#[test]
fn polyphonic_voice_stealing_and_wildcard_release_stay_bounded() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[
            param(0, METHOD, 2.),
            param(0, VOICE_MODE, 1.),
            param(0, RELEASE, 0.01),
        ]);
        let events: Vec<_> = (0..300)
            .map(|id| {
                note(
                    CLAP_EVENT_NOTE_ON,
                    0,
                    id,
                    (id % 16) as i16,
                    (40 + id % 60) as i16,
                )
            })
            .collect();
        fixture.render(4096, &events);
        assert_eq!(
            audio(instance(fixture.plugin))
                .held
                .iter()
                .flatten()
                .count(),
            MAX_HELD
        );
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            8
        );
        fixture.render(4096, &[note(CLAP_EVENT_NOTE_OFF, 0, -1, -1, -1)]);
        for _ in 0..8 {
            fixture.render(4096, &[]);
        }
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            0
        );
        assert!(audio(instance(fixture.plugin)).latest().is_none());
    }
}

#[test]
fn performance_ranges_match_core_and_bound_state_endpoints() {
    unsafe {
        let fixture = Fixture::new();
        for (index, lo, hi) in [
            (FREQ, 20., 8000.),
            (ATTACK, 0.001, 12.),
            (DECAY, 0.002, 12.),
            (RELEASE, 0.003, 16.),
        ] {
            let mut info: clap_param_info = std::mem::zeroed();
            assert!((PARAMS.get_info.unwrap())(
                fixture.plugin,
                index as u32,
                &mut info
            ));
            assert_eq!((info.min_value, info.max_value), (lo, hi));
            fixture.flush(&[param(0, index, hi + 100.)]);
            assert_eq!(fixture.value(index), hi);
            fixture.flush(&[param(0, index, -10.)]);
            assert_eq!(fixture.value(index), lo);
            let mut state = save_bytes(fixture.plugin);
            state[12 + index * 8..20 + index * 8].copy_from_slice(&f64::NAN.to_le_bytes());
            assert!(load_bytes(fixture.plugin, state));
            fixture.render(8, &[]);
            assert_eq!(fixture.value(index), defaults()[index]);
        }
    }
}

#[test]
fn raw_midi_note_off_does_not_release_same_pitch_clap_note_id() {
    unsafe {
        let fixture = Fixture::new();
        fixture.flush(&[
            param(0, METHOD, 2.),
            param(0, VOICE_MODE, 1.),
            param(0, SUSTAIN, 1.),
            param(0, RELEASE, 0.01),
        ]);
        fixture.render(
            4096,
            &[
                note(CLAP_EVENT_NOTE_ON, 0, 10, 0, 60),
                midi(0, [0x90, 60, 100]),
            ],
        );
        fixture.render(4096, &[midi(0, [0x80, 60, 0])]);
        for _ in 0..8 {
            fixture.render(4096, &[]);
        }
        assert_eq!(audio(instance(fixture.plugin)).latest().unwrap().id, 10);
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            1
        );
        assert!(energy(&fixture.render(2048, &[])) > 1.0e-6);
        fixture.render(4096, &[note(CLAP_EVENT_NOTE_OFF, 0, -1, 0, 60)]);
        for _ in 0..8 {
            fixture.render(4096, &[]);
        }
        assert!(audio(instance(fixture.plugin)).latest().is_none());
        assert_eq!(
            audio(instance(fixture.plugin))
                .poly
                .as_ref()
                .unwrap()
                .voice_count(),
            0
        );
    }
}
