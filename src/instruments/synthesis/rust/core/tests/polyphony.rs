use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use synthesis_core::polyphony::{VoiceBank, MAX_VOICES};
use synthesis_core::{default_parameters, Engine, METHOD_COUNT, OUTPUT_CEILING};

thread_local! {
    static TRACK_ALLOCATIONS: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}
struct CountAllocator;
unsafe impl GlobalAlloc for CountAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        TRACK_ALLOCATIONS.with(|tracking| {
            if tracking.get() {
                ALLOCATIONS.with(|n| n.set(n.get() + 1));
            }
        });
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        TRACK_ALLOCATIONS.with(|tracking| {
            if tracking.get() {
                ALLOCATIONS.with(|n| n.set(n.get() + 1));
            }
        });
        System.realloc(ptr, layout, size)
    }
}
#[global_allocator]
static ALLOCATOR: CountAllocator = CountAllocator;

fn audible_methods() -> impl Iterator<Item = u32> {
    (0..METHOD_COUNT).filter(|m| cfg!(feature = "neural") || !(33..=36).contains(m))
}
fn patch(method: u32) -> [f32; 16] {
    let mut params = default_parameters(method);
    if method == 24 {
        params[..8].copy_from_slice(&[0.5, 0.85, 1.0, 0.7, 0.5, 0.15, 0.0, 0.3]);
    }
    params
}
fn setup(bank: &mut VoiceBank, method: u32) {
    bank.reset();
    bank.set_method(method);
    bank.set_params(patch(method));
    bank.set_envelope(0.002, 0.02, 0.7, 0.05);
    bank.set_level_trim_db(0.0);
}
fn rms(samples: &[f32]) -> f32 {
    (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt()
}
fn magnitude(samples: &[f32], hz: f32) -> f32 {
    let mut real = 0.0;
    let mut imaginary = 0.0;
    for (i, sample) in samples.iter().enumerate() {
        let angle = std::f32::consts::TAU * hz * i as f32 / 48_000.0;
        real += sample * angle.cos();
        imaginary += sample * angle.sin();
    }
    (real * real + imaginary * imaginary).sqrt() / samples.len() as f32
}
#[test]
fn one_voice_is_exactly_existing_mono_for_every_method() {
    let mut bank = VoiceBank::new(48_000.0);
    let mut mono = Engine::new(48_000.0);
    for method in audible_methods() {
        setup(&mut bank, method);
        mono.set_method(method);
        mono.set_params(patch(method));
        mono.set_envelope(0.002, 0.02, 0.7, 0.05);
        mono.set_level_trim_db(0.0);
        mono.reset();
        bank.note_on(100, 220.0, 0.73);
        mono.note_on(220.0, 0.73);
        let mut a = [0.0; 128];
        let mut b = [0.0; 128];
        for _ in 0..20 {
            bank.render(&mut a);
            mono.render(&mut b);
            assert_eq!(a, b, "method {method}");
        }
    }
}
#[test]
fn chords_contain_independent_pitches_and_release_independently() {
    let mut bank = VoiceBank::new(48_000.0);
    setup(&mut bank, 2);
    bank.set_envelope(0.001, 0.002, 1.0, 0.03);
    let low = bank.note_on(11, 220.0, 0.5);
    let high = bank.note_on(12, 330.0, 0.5);
    let mut output = vec![0.0; 48_000];
    bank.render(&mut output);
    assert!(magnitude(&output[24000..], 220.0) > 0.001);
    assert!(magnitude(&output[24000..], 330.0) > 0.001);
    bank.note_off(11);
    bank.render(&mut output);
    assert!(!bank.voice_is_active(low));
    assert!(bank.voice_is_held(high));
    assert_eq!(bank.voice_count(), 1);
    assert!(magnitude(&output[24000..], 330.0) > 0.001);
    assert!(magnitude(&output[24000..], 220.0) < 0.00001);
    bank.note_off(12);
    bank.render(&mut output);
    assert_eq!(bank.voice_count(), 0);
    assert!(rms(&output[24000..]) < 1.0e-7);
}
#[test]
fn same_pitch_note_ids_and_stale_offs_are_independent() {
    let mut bank = VoiceBank::new(48_000.0);
    let a = bank.note_on(0x10003c, 261.6256, 0.8);
    let b = bank.note_on(0x20003c, 261.6256, 0.8);
    assert_ne!(a, b);
    bank.note_off(0x10003c);
    assert!(!bank.voice_is_held(a));
    assert!(bank.voice_is_held(b));
    assert_eq!(bank.note_on(0x20003c, 261.6256, 0.5), b);
    assert_eq!(bank.voice_count(), 2);
    bank.choke(0x10003c);
    assert_eq!(bank.voice_count(), 1);
    assert_eq!(bank.note_on(u32::MAX, 110.0, 0.5), a);
    bank.note_off(0x10003c);
    assert!(bank.voice_is_held(a));
    assert_eq!(bank.voice_note_id(a), Some(u32::MAX));
}
#[test]
fn voice_stealing_prefers_oldest_release_then_oldest_held_note() {
    let mut bank = VoiceBank::new(48_000.0);
    for id in 0..8 {
        assert_eq!(bank.note_on(id, 220.0 + id as f32, 0.8), id as usize);
    }
    let mut block = [0.0; 128];
    bank.render(&mut block);
    bank.note_off(5);
    bank.note_off(2);
    assert_eq!(bank.note_on(8, 440.0, 0.8), 5);
    bank.note_off(5);
    assert!(bank.voice_is_held(5));
    assert_eq!(bank.note_on(9, 550.0, 0.8), 2);
    assert_eq!(bank.note_on(10, 660.0, 0.8), 0);
    assert_eq!(bank.voice_count(), MAX_VOICES);
    assert_eq!(bank.voice_note_id(0), Some(10));
}
#[test]
fn all_methods_support_eight_finite_audible_voices_and_bounded_release() {
    let mut bank = VoiceBank::new(48_000.0);
    let mut block = [0.0; 128];
    for method in audible_methods() {
        setup(&mut bank, method);
        for id in 0..8 {
            bank.note_on(id, 110.0 * 2.0_f32.powf(id as f32 / 12.0), 0.8);
        }
        let mut peak = 0.0f32;
        for _ in 0..100 {
            bank.render(&mut block);
            for sample in block {
                assert!(
                    sample.is_finite() && sample.abs() <= OUTPUT_CEILING,
                    "method {method}: {sample}"
                );
                peak = peak.max(sample.abs());
            }
        }
        assert!(peak > 0.00001, "method {method} audible");
        bank.all_notes_off();
        for _ in 0..400 {
            bank.render(&mut block);
        }
        assert_eq!(bank.voice_count(), 0, "method {method} completes release");
        assert!(block.iter().all(|x| *x == 0.0));
    }
}
#[test]
fn pitch_bend_and_method_changes_keep_owned_notes() {
    let mut bank = VoiceBank::new(48_000.0);
    setup(&mut bank, 2);
    bank.set_envelope(0.001, 0.002, 1.0, 0.03);
    let a = bank.note_on(5, 220.0, 0.5);
    let b = bank.note_on(6, 440.0, 0.5);
    bank.set_note_frequency(5, 330.0);
    let mut out = vec![0.0; 48_000];
    bank.render(&mut out);
    assert!(magnitude(&out[24000..], 330.0) > 0.001);
    assert!(magnitude(&out[24000..], 440.0) > 0.001);
    assert!(magnitude(&out[24000..], 220.0) < 0.00001);
    bank.set_method(3);
    bank.set_params(default_parameters(3));
    bank.render(&mut out[..128]);
    assert_eq!(bank.voice_note_id(a), Some(5));
    assert_eq!(bank.voice_note_id(b), Some(6));
    assert!(bank.voice_is_held(a) && bank.voice_is_held(b));
}
#[test]
fn rendering_notes_and_parameter_updates_never_allocate() {
    let mut bank = VoiceBank::new(48_000.0);
    let mut block = [0.0; 128];
    ALLOCATIONS.with(|n| n.set(0));
    TRACK_ALLOCATIONS.with(|b| b.set(true));
    for method in audible_methods() {
        setup(&mut bank, method);
        for id in 0..10 {
            bank.note_on(id, 220.0 + id as f32 * 20.0, 0.8);
        }
        bank.render(&mut block);
        bank.set_params(patch(method));
        bank.set_note_frequency(5, 123.0);
        bank.note_off(5);
        bank.choke(6);
        bank.all_notes_off();
        bank.render(&mut block);
    }
    TRACK_ALLOCATIONS.with(|b| b.set(false));
    let count = ALLOCATIONS.with(|n| n.get());
    assert_eq!(count, 0);
}
#[test]
fn source_import_reaches_idle_and_occupied_slots_and_restore_works() {
    let mut bank = VoiceBank::new(48_000.0);
    setup(&mut bank, 0);
    bank.set_envelope(0.001, 0.002, 1.0, 0.03);
    bank.load_sample(&[0.0; 1024], 48_000.0);
    for id in 0..8 {
        bank.note_on(id, 110.0 + 20.0 * id as f32, 0.8);
    }
    let mut block = [0.0; 128];
    for _ in 0..20 {
        bank.render(&mut block);
        assert!(block.iter().all(|x| *x == 0.0));
    }
    bank.restore_source();
    let mut peak = 0.0f32;
    for _ in 0..100 {
        bank.render(&mut block);
        for x in block {
            peak = peak.max(x.abs());
        }
    }
    assert!(peak > 0.001);
    bank.reset();
    bank.load_sample(&[0.0; 1024], 48_000.0);
    bank.note_on(99, 220.0, 0.8);
    for _ in 0..20 {
        bank.render(&mut block);
        assert!(block.iter().all(|x| *x == 0.0));
    }
}
#[test]
fn c_abi_handles_bounds_identity_and_source_transfer() {
    use synthesis_core::polyphony::*;
    unsafe {
        assert_eq!(poly_max_voices(), 8);
        assert_eq!(poly_note_on(std::ptr::null_mut(), 0, 220.0, 0.8), u32::MAX);
        let ptr = poly_new(48_000.0);
        assert!(!ptr.is_null());
        assert_eq!(poly_process(ptr, 129), 0);
        assert_eq!(poly_process(ptr, 128), 128);
        assert_eq!(poly_voice_count(ptr), 0);
        assert_eq!(poly_voice_is_active(ptr, 999), 0);
        let slot = poly_note_on(ptr, 123, 220.0, 0.8);
        assert_eq!(poly_voice_note_id(ptr, slot), 123);
        assert_eq!(poly_voice_is_held(ptr, slot), 1);
        poly_note_off(ptr, 999);
        assert_eq!(poly_voice_is_held(ptr, slot), 1);
        poly_note_off(ptr, 123);
        assert_eq!(poly_voice_is_held(ptr, slot), 0);
        poly_reset(ptr);
        assert_eq!(poly_voice_count(ptr), 0);
        std::slice::from_raw_parts_mut(poly_sample_ptr(ptr), 1024).fill(0.0);
        poly_load_sample(ptr, 1024, 48_000.0);
        poly_note_on(ptr, 1, 220.0, 0.8);
        poly_process(ptr, 128);
        assert!(std::slice::from_raw_parts(poly_output_ptr(ptr), 128)
            .iter()
            .all(|x| *x == 0.0));
        poly_free(ptr);
        poly_free(std::ptr::null_mut());
    }
}
