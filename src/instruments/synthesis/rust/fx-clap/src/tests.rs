use super::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
thread_local! {static COUNTING:Cell<bool>=const{Cell::new(false)};static ALLOCATIONS:Cell<usize>=const{Cell::new(0)};}
struct Allocator;
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        COUNTING.with(|c| {
            if c.get() {
                ALLOCATIONS.with(|n| n.set(n.get() + 1))
            }
        });
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        COUNTING.with(|c| {
            if c.get() {
                ALLOCATIONS.with(|n| n.set(n.get() + 1))
            }
        });
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static ALLOCATOR: Allocator = Allocator;
struct Fixture {
    plugin: *const clap_plugin,
    _host: Box<clap_host>,
}
impl Fixture {
    unsafe fn new() -> Self {
        let host = Box::new(clap_host {
            clap_version: CLAP_VERSION,
            host_data: ptr::null_mut(),
            name: b"Tests\0".as_ptr().cast(),
            vendor: b"Tests\0".as_ptr().cast(),
            url: ptr::null(),
            version: b"1\0".as_ptr().cast(),
            get_extension: None,
            request_restart: None,
            request_process: None,
            request_callback: None,
        });
        let plugin = create(&FACTORY, &*host, ID.as_ptr().cast());
        assert!(!plugin.is_null());
        assert!(init(plugin));
        assert!(activate(plugin, 48000., 1, 4096));
        assert!(start(plugin));
        Self {
            plugin,
            _host: host,
        }
    }
    unsafe fn flush(&self, values: &[(usize, f64)]) {
        let s = instance(self.plugin);
        let a = audio(s);
        for (id, value) in values {
            s.parameter(a, *id, *value);
        }
    }
    unsafe fn value(&self, id: usize) -> f64 {
        let mut out = 0.;
        assert!(param_value(self.plugin, id as u32, &mut out));
        out
    }
    unsafe fn restart(&self) {
        stop(self.plugin);
        deactivate(self.plugin);
        assert!(activate(self.plugin, 48000., 1, 4096));
        assert!(start(self.plugin));
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        unsafe {
            stop(self.plugin);
            deactivate(self.plugin);
            destroy(self.plugin);
        }
    }
}
unsafe extern "C" fn event_size(events: *const clap_input_events) -> u32 {
    (&*(*events).ctx.cast::<Vec<clap_event_param_value>>()).len() as u32
}
unsafe extern "C" fn event_get(
    events: *const clap_input_events,
    i: u32,
) -> *const clap_event_header {
    let list = &*(*events).ctx.cast::<Vec<clap_event_param_value>>();
    list.get(i as usize).map_or(ptr::null(), |v| &v.header)
}
fn event(time: u32, id: usize, value: f64) -> clap_event_param_value {
    clap_event_param_value {
        header: clap_event_header {
            size: size_of::<clap_event_param_value>() as u32,
            time,
            space_id: CLAP_CORE_EVENT_SPACE_ID,
            type_: CLAP_EVENT_PARAM_VALUE,
            flags: 0,
        },
        param_id: id as u32,
        cookie: ptr::null_mut(),
        note_id: -1,
        port_index: -1,
        channel: -1,
        key: -1,
        value,
    }
}
unsafe fn render(
    f: &Fixture,
    left: &[f32],
    right: &[f32],
    events: Vec<clap_event_param_value>,
    count_allocations: bool,
) -> [Vec<f32>; 2] {
    assert_eq!(left.len(), right.len());
    let mut input_left = left.to_vec();
    let mut input_right = right.to_vec();
    let mut pointers = [input_left.as_mut_ptr(), input_right.as_mut_ptr()];
    let mut output = [vec![f32::NAN; left.len()], vec![f32::NAN; left.len()]];
    let mut outptr = [output[0].as_mut_ptr(), output[1].as_mut_ptr()];
    let input = clap_audio_buffer {
        data32: pointers.as_mut_ptr(),
        data64: ptr::null_mut(),
        channel_count: 2,
        latency: 0,
        constant_mask: 0,
    };
    let mut out = clap_audio_buffer {
        data32: outptr.as_mut_ptr(),
        data64: ptr::null_mut(),
        channel_count: 2,
        latency: 0,
        constant_mask: 0,
    };
    let list = clap_input_events {
        ctx: (&events as *const Vec<clap_event_param_value>)
            .cast_mut()
            .cast(),
        size: Some(event_size),
        get: Some(event_get),
    };
    let p = clap_process {
        steady_time: -1,
        frames_count: left.len() as u32,
        transport: ptr::null(),
        audio_inputs: &input,
        audio_outputs: &mut out,
        audio_inputs_count: 1,
        audio_outputs_count: 1,
        in_events: &list,
        out_events: ptr::null(),
    };
    if count_allocations {
        ALLOCATIONS.with(|n| n.set(0));
        COUNTING.with(|c| c.set(true));
    }
    let status = process(f.plugin, &p);
    COUNTING.with(|c| c.set(false));
    if count_allocations {
        assert_eq!(
            ALLOCATIONS.with(Cell::get),
            0,
            "CLAP process allocates no heap memory"
        );
    }
    assert_eq!(status, CLAP_PROCESS_CONTINUE);
    assert!(output
        .iter()
        .flatten()
        .all(|v| v.is_finite() && v.abs() <= 1.));
    output
}
#[test]
fn descriptor_stereo_input_and_external_unity_bypass_are_real() {
    unsafe {
        let f = Fixture::new();
        assert_eq!(
            CStr::from_ptr((*(*f.plugin).desc).id).to_bytes_with_nul(),
            ID
        );
        assert_eq!(port_count(f.plugin, true), 1);
        let mut info: clap_audio_port_info = std::mem::zeroed();
        assert!(port_info(f.plugin, 0, true, &mut info));
        assert_eq!(info.channel_count, 2);
        assert_eq!(f.value(SOURCE), 0.);
        f.flush(&[(BYPASS, 1.), (INPUT, 24.), (OUTPUT, 24.)]);
        reset(f.plugin);
        let l: Vec<_> = (0..512).map(|i| (i as f32 * 0.13).sin() * 0.2).collect();
        let r: Vec<_> = (0..512).map(|i| (i as f32 * 0.19).cos() * 0.1).collect();
        let out = render(&f, &l, &r, vec![], true);
        assert_eq!(out[0], l);
        assert_eq!(out[1], r);
    }
}
#[test]
fn every_effect_accepts_pcm_without_allocating_or_enabling_test_sources() {
    unsafe {
        let f = Fixture::new();
        let input: Vec<_> = (0..4096).map(|i| (i as f32 * 0.11).sin() * 0.15).collect();
        for method in 0..PROCESSOR_NAMES.len() {
            f.flush(&[(METHOD, method as f64), (PRESET, 0.)]);
            if instance(f.plugin).restart_pending.load(Ordering::Acquire) {
                f.restart();
            }
            assert_eq!(
                audio(instance(f.plugin)).bank.as_ref().unwrap().method(),
                method
            );
            assert_eq!(f.value(SOURCE), 0.);
            assert_eq!(f.value(TEST_ON), 0.);
            reset(f.plugin);
            render(&f, &input, &input, vec![], true);
            reset(f.plugin);
            let zero = [0.; 4096];
            let out = render(&f, &zero, &zero, vec![], true);
            assert!(
                out.iter().flatten().all(|v| *v == 0.),
                "external mode has no hidden test fixture for method {method}"
            );
        }
    }
}
#[test]
fn sample_offset_bypass_automation_starts_at_its_event() {
    unsafe {
        let a = Fixture::new();
        let b = Fixture::new();
        a.flush(&[(METHOD, 0.), (MACRO + 1, 0.2)]);
        b.flush(&[(METHOD, 0.), (MACRO + 1, 0.2)]);
        reset(a.plugin);
        reset(b.plugin);
        let input: Vec<_> = (0..4096)
            .map(|i| (std::f32::consts::TAU * 8000. * i as f32 / 48000.).sin() * 0.2)
            .collect();
        let changed = render(&a, &input, &input, vec![event(128, BYPASS, 1.)], true);
        let reference = render(&b, &input, &input, vec![], false);
        assert_eq!(&changed[0][..128], &reference[0][..128]);
        assert!(changed[0][3072..]
            .iter()
            .zip(&input[3072..])
            .all(|(a, b)| (a - b).abs() < 0.001));
    }
}
struct Memory {
    bytes: Vec<u8>,
    offset: usize,
}
unsafe extern "C" fn write(stream: *const clap_ostream, data: *const c_void, len: u64) -> i64 {
    let s = &mut *(*stream).ctx.cast::<Memory>();
    let n = (len as usize).min(7);
    s.bytes
        .extend_from_slice(std::slice::from_raw_parts(data.cast::<u8>(), n));
    n as i64
}
unsafe extern "C" fn read(stream: *const clap_istream, data: *mut c_void, len: u64) -> i64 {
    let s = &mut *(*stream).ctx.cast::<Memory>();
    let n = (len as usize).min(11).min(s.bytes.len() - s.offset);
    ptr::copy_nonoverlapping(s.bytes.as_ptr().add(s.offset), data.cast(), n);
    s.offset += n;
    n as i64
}
#[test]
fn state_round_trip_uses_audio_mailbox_and_never_rearms_test_audio() {
    unsafe {
        let f = Fixture::new();
        f.flush(&[
            (METHOD, 8.),
            (PRESET, 3.),
            (MACRO, 0.73),
            (SOURCE, 7.),
            (TEST_ON, 1.),
        ]);
        let mut memory = Memory {
            bytes: vec![],
            offset: 0,
        };
        let stream = clap_ostream {
            ctx: (&mut memory as *mut Memory).cast(),
            write: Some(write),
        };
        assert!(save(f.plugin, &stream));
        assert_eq!(memory.bytes.len(), STATE_SIZE);
        f.flush(&[(METHOD, 1.), (MACRO, 0.2)]);
        let input = clap_istream {
            ctx: (&mut memory as *mut Memory).cast(),
            read: Some(read),
        };
        assert!(load(f.plugin, &input));
        assert_eq!(audio(instance(f.plugin)).bank.as_ref().unwrap().method(), 1);
        let zero = [0.; 128];
        let out = render(&f, &zero, &zero, vec![], true);
        assert_eq!(f.value(METHOD), 8.);
        assert_eq!(f.value(MACRO), 0.73);
        assert_eq!(f.value(SOURCE), 7.);
        assert_eq!(f.value(TEST_ON), 0.);
        assert!(out.iter().flatten().all(|v| *v == 0.));
        memory.offset = 0;
        memory.bytes[8] = 99;
        assert!(!load(f.plugin, &input));
    }
}
#[test]
fn sixty_four_bit_stereo_pcm_reaches_the_processor() {
    unsafe {
        let f = Fixture::new();
        f.flush(&[(WET, 0.), (INPUT, 0.), (OUTPUT, 0.)]);
        reset(f.plugin);
        let mut left = [0.17f64; 128];
        let mut right = [-0.23f64; 128];
        let mut inputs = [left.as_mut_ptr(), right.as_mut_ptr()];
        let mut output_l = [0f64; 128];
        let mut output_r = [0f64; 128];
        let mut outputs = [output_l.as_mut_ptr(), output_r.as_mut_ptr()];
        let input = clap_audio_buffer {
            data32: ptr::null_mut(),
            data64: inputs.as_mut_ptr(),
            channel_count: 2,
            latency: 0,
            constant_mask: 0,
        };
        let mut out = clap_audio_buffer {
            data32: ptr::null_mut(),
            data64: outputs.as_mut_ptr(),
            channel_count: 2,
            latency: 0,
            constant_mask: 0,
        };
        let p = clap_process {
            steady_time: -1,
            frames_count: 128,
            transport: ptr::null(),
            audio_inputs: &input,
            audio_outputs: &mut out,
            audio_inputs_count: 1,
            audio_outputs_count: 1,
            in_events: ptr::null(),
            out_events: ptr::null(),
        };
        assert_eq!(process(f.plugin, &p), CLAP_PROCESS_CONTINUE);
        assert!(output_l.iter().all(|v| (*v - 0.17).abs() < 1e-7));
        assert!(output_r.iter().all(|v| (*v + 0.23).abs() < 1e-7));
    }
}

unsafe extern "C" fn requested_restart(host: *const clap_host) {
    let counts = &*(*host).host_data.cast::<[AtomicU32; 2]>();
    counts[0].fetch_add(1, Ordering::Relaxed);
}
unsafe extern "C" fn latency_changed(host: *const clap_host) {
    let counts = &*(*host).host_data.cast::<[AtomicU32; 2]>();
    counts[1].fetch_add(1, Ordering::Relaxed);
}
static HOST_LATENCY: clap_host_latency = clap_host_latency {
    changed: Some(latency_changed),
};
unsafe extern "C" fn host_extension(_: *const clap_host, id: *const c_char) -> *const c_void {
    if CStr::from_ptr(id) == CLAP_EXT_LATENCY {
        (&HOST_LATENCY as *const clap_host_latency).cast()
    } else {
        ptr::null()
    }
}

#[test]
fn spectral_latency_changes_only_on_reactivation_and_bypass_remains_immediate() {
    unsafe {
        let counts = Box::new([AtomicU32::new(0), AtomicU32::new(0)]);
        let mut f = Fixture::new();
        f._host.host_data = (&*counts as *const [AtomicU32; 2]).cast_mut().cast();
        f._host.get_extension = Some(host_extension);
        f._host.request_restart = Some(requested_restart);
        let latency = extension(f.plugin, CLAP_EXT_LATENCY.as_ptr()).cast::<clap_plugin_latency>();
        assert!(!latency.is_null());
        assert_eq!(((*latency).get.unwrap())(f.plugin), 0);
        f.flush(&[
            (METHOD, 16.),
            (PRESET, 0.),
            (INPUT, 0.),
            (OUTPUT, 0.),
            (WET, 0.5),
        ]);
        assert_eq!(
            counts[0].load(Ordering::Relaxed),
            1,
            "coalesce restart requests"
        );
        assert_eq!(
            counts[1].load(Ordering::Relaxed),
            0,
            "no active latency notification"
        );
        assert_eq!(get_latency(f.plugin), 0);
        assert_eq!(
            audio(instance(f.plugin)).bank.as_ref().unwrap().method(),
            0,
            "old DSP stays active until restart"
        );
        f.restart();
        assert_eq!(counts[1].load(Ordering::Relaxed), 1);
        assert_eq!(get_latency(f.plugin), 1024);
        let input: Vec<_> = (0..4096).map(|i| (i as f32 * 0.071).sin() * 0.2).collect();
        let right: Vec<_> = input.iter().map(|x| -*x * 0.5).collect();
        let out = render(&f, &input, &right, vec![], true);
        for i in 1024..4096 {
            assert!((out[0][i] - input[i - 1024]).abs() < 5e-6);
            assert!((out[1][i] - right[i - 1024]).abs() < 5e-6);
        }
        f.flush(&[(BYPASS, 1.)]);
        assert_eq!(
            get_latency(f.plugin),
            1024,
            "bypass cannot change active latency"
        );
        assert_eq!(counts[0].load(Ordering::Relaxed), 2);
        f.restart();
        assert_eq!(get_latency(f.plugin), 0);
        assert_eq!(counts[1].load(Ordering::Relaxed), 2);
        let out = render(&f, &input, &right, vec![], true);
        assert_eq!(out[0], input);
        assert_eq!(out[1], right);
    }
}

#[test]
fn hosts_without_restart_keep_old_dsp_and_new_noise_sources_have_names() {
    unsafe {
        let f = Fixture::new();
        f.flush(&[(METHOD, 16.)]);
        assert_eq!(
            f.value(METHOD),
            16.,
            "requested selection is retained for next activation"
        );
        assert_eq!(audio(instance(f.plugin)).bank.as_ref().unwrap().method(), 0);
        assert_eq!(get_latency(f.plugin), 0);
        f.restart();
        assert_eq!(
            audio(instance(f.plugin)).bank.as_ref().unwrap().method(),
            16
        );
        for source in 8..=10 {
            f.flush(&[(SOURCE, source as f64), (TEST_ON, 1.)]);
            assert_eq!(f.value(SOURCE), source as f64);
            let mut name = [0; 64];
            assert!(value_text(
                f.plugin,
                SOURCE as u32,
                source as f64,
                name.as_mut_ptr(),
                name.len() as u32
            ));
            assert_eq!(
                CStr::from_ptr(name.as_ptr()).to_str().unwrap(),
                SOURCE_NAMES[source]
            );
            reset(f.plugin);
            let zero = [0.; 4096];
            let out = render(&f, &zero, &zero, vec![], true);
            assert!(out[0].iter().any(|x| x.abs() > 0.01));
        }
    }
}

#[test]
fn spectral_state_restore_queues_latency_and_lifecycle_stop_releases_freeze() {
    unsafe {
        let f = Fixture::new();
        f.flush(&[(METHOD, 16.), (PRESET, 4.), (INPUT, 0.), (OUTPUT, 0.)]);
        f.restart();
        let mut memory = Memory {
            bytes: vec![],
            offset: 0,
        };
        let stream = clap_ostream {
            ctx: (&mut memory as *mut Memory).cast(),
            write: Some(write),
        };
        assert!(save(f.plugin, &stream));
        f.flush(&[(METHOD, 0.)]);
        f.restart();
        let stream = clap_istream {
            ctx: (&mut memory as *mut Memory).cast(),
            read: Some(read),
        };
        assert!(load(f.plugin, &stream));
        let zero = [0.; 4096];
        render(&f, &zero, &zero, vec![], true);
        assert_eq!(f.value(METHOD), 16.);
        assert_eq!(get_latency(f.plugin), 0);
        assert_eq!(audio(instance(f.plugin)).bank.as_ref().unwrap().method(), 0);
        f.restart();
        assert_eq!(get_latency(f.plugin), 1024);
        let input: Vec<_> = (0..4096).map(|i| (i as f32 * 0.057).sin() * 0.2).collect();
        render(&f, &input, &input, vec![], true);
        let held = render(&f, &zero, &zero, vec![], true);
        assert!(held[0][2048..].iter().any(|x| x.abs() > 0.02));
        stop(f.plugin);
        assert!(start(f.plugin));
        let released = render(&f, &zero, &zero, vec![], true);
        assert!(released
            .iter()
            .all(|channel| channel[2048..].iter().all(|x| x.abs() < 1e-7)));
    }
}
