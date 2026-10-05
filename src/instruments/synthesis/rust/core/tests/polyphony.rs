use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use synthesis_core::polyphony::{VoiceBank, MAX_VOICES};
use synthesis_core::{default_parameters, Engine, EnvelopePoint, METHOD_COUNT, OUTPUT_CEILING};

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
fn point_shape(level: f32) -> [EnvelopePoint; 5] {
    [
        (0.005, 0.0),
        (0.01, 1.0),
        (0.02, 0.2),
        (0.03, level),
        (0.05, 0.4),
    ]
    .map(|(time, level)| EnvelopePoint { time, level })
}
#[test]
fn point_envelopes_update_held_and_future_voices_and_reclaim_nonzero_release_tails() {
    let mut bank = VoiceBank::new(48_000.0);
    setup(&mut bank, 2);
    let points = point_shape(0.6);
    bank.set_envelope_points(points);
    let slot = bank.note_on(1, 220.0, 0.7);
    let mut output = vec![0.0; 48_000];
    bank.render(&mut output);
    let original = rms(&output[24000..]);
    assert!(original > 0.01);
    bank.set_envelope_points(point_shape(0.12));
    bank.render(&mut output);
    assert!((rms(&output[24000..]) / original - 0.2).abs() < 0.01);
    assert!(bank.voice_is_held(slot));
    bank.all_notes_off();
    bank.render(&mut output);
    assert_eq!(bank.voice_count(), 0);
    assert!(rms(&output[24000..]) < 1.0e-7);
    let mut mono = Engine::new(48_000.0);
    mono.set_method(2);
    mono.set_params(patch(2));
    mono.set_envelope_points(point_shape(0.12));
    mono.reset();
    mono.note_on(330.0, 0.7);
    bank.note_on(2, 330.0, 0.7);
    let mut expected = vec![0.0; 4800];
    bank.render(&mut output[..4800]);
    mono.render(&mut expected);
    assert_eq!(&output[..4800], &expected);
}
#[test]
fn point_voice_stealing_stale_off_reset_and_scalar_restore_are_safe() {
    let mut bank = VoiceBank::new(48_000.0);
    setup(&mut bank, 2);
    bank.set_envelope_points(point_shape(0.6));
    for id in 0..MAX_VOICES as u32 {
        bank.note_on(id, 180.0 + id as f32 * 30.0, 0.6);
    }
    let mut output = vec![0.0; 4800];
    bank.render(&mut output);
    let replacement = bank.note_on(100, 440.0, 0.7);
    assert_eq!(replacement, 0);
    bank.note_off(0);
    assert!(bank.voice_is_held(replacement));
    bank.all_notes_off();
    for _ in 0..10 {
        bank.render(&mut output);
    }
    assert_eq!(bank.voice_count(), 0);
    bank.note_on(200, 330.0, 0.7);
    bank.render(&mut output);
    bank.reset();
    bank.render(&mut output);
    assert!(output.iter().all(|sample| *sample == 0.0));
    bank.set_envelope(0.002, 0.02, 0.7, 0.05);
    let mut mono = Engine::new(48_000.0);
    mono.set_method(2);
    mono.set_params(patch(2));
    mono.set_envelope(0.002, 0.02, 0.7, 0.05);
    mono.reset();
    mono.note_on(220.0, 0.7);
    bank.note_on(300, 220.0, 0.7);
    let mut expected = vec![0.0; output.len()];
    bank.render(&mut output);
    mono.render(&mut expected);
    assert_eq!(output, expected);
}
#[test]
fn point_configuration_and_render_are_allocation_free() {
    let mut bank = VoiceBank::new(48_000.0);
    setup(&mut bank, 2);
    let mut output = [0.0; 128];
    ALLOCATIONS.with(|count| count.set(0));
    TRACK_ALLOCATIONS.with(|tracking| tracking.set(true));
    bank.set_envelope_points(point_shape(0.6));
    for id in 0..20 {
        bank.note_on(id, 220.0 + id as f32, 0.7);
        bank.render(&mut output);
        bank.set_envelope_points(point_shape(0.3));
        bank.note_off(id);
    }
    bank.all_notes_off();
    bank.clear_envelope_points();
    bank.reset();
    TRACK_ALLOCATIONS.with(|tracking| tracking.set(false));
    assert_eq!(ALLOCATIONS.with(|count| count.get()), 0);
}
#[test]
fn point_updates_and_clear_handle_held_releasing_and_idle_slots_together() {
    let mut bank = VoiceBank::new(48_000.0);
    setup(&mut bank, 2);
    bank.set_envelope_points(point_shape(0.6));
    let held = bank.note_on(1, 220.0, 0.5);
    let released = bank.note_on(2, 330.0, 0.5);
    let mut output = vec![0.0; 4800];
    bank.render(&mut output);
    bank.note_off(2);
    bank.render(&mut output[..128]);
    bank.set_envelope_points(point_shape(0.2));
    let future = bank.note_on(3, 440.0, 0.5);
    assert!(bank.voice_is_held(held));
    assert!(!bank.voice_is_held(released));
    assert!(bank.voice_is_held(future));
    bank.render(&mut output[..128]);
    bank.clear_envelope_points();
    assert!(bank.voice_is_held(held) && bank.voice_is_held(future));
    bank.all_notes_off();
    for _ in 0..10 {
        bank.render(&mut output);
        assert!(output
            .iter()
            .all(|value| value.is_finite() && value.abs() <= OUTPUT_CEILING));
    }
    assert_eq!(bank.voice_count(), 0);
}
#[test]
fn point_poly_abi_is_null_safe_and_preserves_additive_version_two_contract() {
    use synthesis_core::polyphony::*;
    unsafe {
        poly_set_envelope_points(
            std::ptr::null_mut(),
            0.0,
            0.0,
            0.01,
            1.0,
            0.02,
            0.3,
            0.03,
            0.6,
            0.05,
            0.4,
        );
        poly_clear_envelope_points(std::ptr::null_mut());
        let bank = poly_new(48_000.0);
        poly_set_envelope_points(bank, 0.0, 0.0, 0.01, 1.0, 0.02, 0.3, 0.03, 0.6, 0.05, 0.4);
        assert_eq!(poly_note_on(bank, 1, 220.0, 0.7), 0);
        assert_eq!(poly_process(bank, 128), 128);
        poly_note_off(bank, 1);
        for _ in 0..500 {
            poly_process(bank, 128);
        }
        assert_eq!((*bank).voice_count(), 0);
        poly_clear_envelope_points(bank);
        poly_free(bank);
    }
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
