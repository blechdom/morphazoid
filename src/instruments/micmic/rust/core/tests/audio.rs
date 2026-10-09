use l_system_delay_core::{
    phase_seed, Engine, PoolTarget, Scene, VoiceEvent, VoiceSpec, DEFAULT_VOICE_CAPACITY,
    TAP_ACTIVITY_CAPACITY,
};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

// Count only this test thread while rendering; concurrent test setup is irrelevant.
thread_local! { static TRACK: Cell<bool> = const { Cell::new(false) }; static ALLOCS: Cell<usize> = const { Cell::new(0) }; static DEALLOCS: Cell<usize> = const { Cell::new(0) }; }
struct TrackingAllocator;
unsafe impl GlobalAlloc for TrackingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        TRACK.with(|track| {
            if track.get() {
                ALLOCS.with(|n| n.set(n.get() + 1));
            }
        });
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        TRACK.with(|track| {
            if track.get() {
                DEALLOCS.with(|n| n.set(n.get() + 1));
            }
        });
        System.dealloc(pointer, layout);
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        TRACK.with(|track| {
            if track.get() {
                ALLOCS.with(|n| n.set(n.get() + 1));
            }
        });
        System.realloc(pointer, layout, size)
    }
}
#[global_allocator]
static ALLOCATOR: TrackingAllocator = TrackingAllocator;
const RATE: u32 = 8000;

#[test]
fn active_voice_indices_borrow_exact_rendered_slots_and_retire_tails_without_allocation() {
    let count = TAP_ACTIVITY_CAPACITY + 9;
    let keys: Vec<_> = (0..count).map(|index| format!("active:{index}")).collect();
    let targets = vec![
        PoolTarget {
            delay: 0.01,
            rate: 1.,
            gain: 0.2,
            pan: 0.
        };
        count
    ];
    let ranks: Vec<_> = (0..count).rev().collect();
    let mut dsp = Engine::new(RATE, 4., count, 1).unwrap();
    dsp.install_pool(&keys).unwrap();
    dsp.update_pool_ranked(&targets, &ranks, &vec![1; count], 3);
    assert_eq!(
        dsp.active_voice_indices(),
        &[count - 3, count - 2, count - 1]
    );
    assert_eq!(dsp.active_voice_indices().len(), dsp.active_voice_count());
    let pointer = dsp.active_voice_indices().as_ptr();
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|track| track.set(true));
    for _ in 0..1000 {
        std::hint::black_box(dsp.active_voice_indices());
    }
    TRACK.with(|track| track.set(false));
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
    assert_eq!(
        dsp.active_voice_indices().as_ptr(),
        pointer,
        "getter borrows persistent storage"
    );
    let mut output = [[0.; 2]; 128];
    for _ in 0..8 {
        dsp.process_block(&[[0.05; 2]; 128], &mut output);
    }
    dsp.set_pool_limit(1);
    assert_eq!(dsp.target_voice_count(), 1);
    assert_eq!(
        dsp.active_voice_indices(),
        &[count - 3, count - 2, count - 1],
        "actual release tails remain in the DSP list"
    );
    for _ in 0..250 {
        dsp.process_block(&[[0.05; 2]; 128], &mut output);
    }
    assert_eq!(
        dsp.active_voice_indices(),
        &[count - 1],
        "retired slots disappear instead of following stale energy"
    );
    assert_eq!(dsp.active_voice_indices().len(), dsp.active_voice_count());
    assert!(
        dsp.active_voice_indices()[0] >= TAP_ACTIVITY_CAPACITY,
        "meter capacity does not truncate active telemetry"
    );
    assert!(output.iter().flatten().all(|sample| sample.is_finite()));
}

fn spec(key: &str, rate: f64, delay: f64, pan: f64) -> VoiceSpec {
    VoiceSpec {
        key: key.into(),
        rate,
        delay,
        pan,
        gain: 0.5,
    }
}
fn engine(channels: usize) -> Engine {
    Engine::new(RATE, 4., 64, channels).unwrap()
}

#[test]
fn live_fold_and_pitch_block_match_sample_order_through_sweeps_admission_and_history_wrap() {
    let targets = [
        PoolTarget {
            delay: 0.0000001,
            rate: 1.,
            gain: 0.2,
            pan: -0.3,
        },
        PoolTarget {
            delay: 0.18,
            rate: 1.7,
            gain: 0.2,
            pan: 0.4,
        },
        PoolTarget {
            delay: 0.51,
            rate: 0.65,
            gain: 0.2,
            pan: 0.,
        },
    ];
    let keys = ["live/a".into(), "live/b".into(), "live/c".into()];
    let mut block = engine(2);
    let mut sample = engine(2);
    for dsp in [&mut block, &mut sample] {
        dsp.install_pool(&keys).unwrap();
        dsp.update_pool(&targets, 1);
        dsp.set_time_fold_scale(15.).unwrap();
    }
    let mut input = [[0.; 2]; 128];
    let mut output = [[0.; 2]; 128];
    for quantum in 0..400 {
        if quantum % 19 == 0 {
            let scale = [0.2, 1., 3., 7., 15.][(quantum / 19) % 5];
            block.set_time_fold_scale(scale).unwrap();
            sample.set_time_fold_scale(scale).unwrap();
        }
        if quantum % 13 == 0 {
            let limit = [1, 3, 2, 0, 3][(quantum / 13) % 5];
            block.set_pool_limit(limit);
            sample.set_pool_limit(limit);
        }
        if quantum % 17 == 0 {
            let offset = [-24., 0., 7.25, 24., -3.][(quantum / 17) % 5];
            block.set_pitch_offset(offset).unwrap();
            sample.set_pitch_offset(offset).unwrap();
        }
        for (offset, frame) in input.iter_mut().enumerate() {
            *frame = [
                tone(quantum * 128 + offset, 173.),
                tone(quantum * 128 + offset, 211.),
            ];
        }
        block.process_block(&input, &mut output);
        for (frame, expected) in input.iter().zip(output) {
            assert_eq!(sample.process_frame(*frame), expected, "quantum {quantum}");
        }
        sample.finish_block();
        assert_eq!(sample.time_fold_scale(), block.time_fold_scale());
        assert_eq!(sample.active_voice_indices(), block.active_voice_indices());
    }
}

#[test]
fn live_fold_and_pitch_setters_and_dense_render_have_no_callback_heap_activity() {
    let count = 128;
    let keys: Vec<_> = (0..count).map(|index| format!("live:{index}")).collect();
    let targets: Vec<_> = (0..count)
        .map(|index| PoolTarget {
            delay: 0.04 + index as f64 * 0.001,
            rate: 0.7 + (index % 5) as f64 * 0.3,
            gain: 0.05,
            pan: 0.,
        })
        .collect();
    let mut dsp = Engine::new(RATE, 4., count, 2).unwrap();
    dsp.install_pool(&keys).unwrap();
    dsp.update_pool(&targets, count);
    dsp.prepare_calibration_history();
    let input = [[0.05; 2]; 128];
    let mut output = [[0.; 2]; 128];
    for _ in 0..16 {
        dsp.process_block(&input, &mut output);
    }
    let allocated = dsp.allocated_bytes();
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|track| track.set(true));
    for scale in [0.25, 0.75, 1., 2., 5., 0.5, 8., 1.] {
        dsp.set_time_fold_scale(scale).unwrap();
        dsp.set_pitch_offset((scale - 1.) * 3.).unwrap();
        for _ in 0..4 {
            dsp.process_block(&input, &mut output);
        }
        dsp.rebase_time_fold_scale(1.).unwrap();
    }
    TRACK.with(|track| track.set(false));
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
    assert_eq!(dsp.allocated_bytes(), allocated);
    assert_eq!(dsp.active_voice_count(), count);
    assert_eq!(dsp.target_voice_count(), count);
    assert!(output.iter().flatten().all(|sample| sample.is_finite()));
}
fn tone(frame: usize, frequency: f64) -> f32 {
    (0.1 * (std::f64::consts::TAU * frequency * frame as f64 / f64::from(RATE)).sin()) as f32
}
fn power(samples: &[f32], frequency: f64) -> f64 {
    let (mut re, mut im) = (0., 0.);
    for (frame, sample) in samples.iter().enumerate() {
        let phase = std::f64::consts::TAU * frequency * frame as f64 / f64::from(RATE);
        re += f64::from(*sample) * phase.cos();
        im += f64::from(*sample) * phase.sin();
    }
    re * re + im * im
}

#[test]
fn direct_delay_has_sample_exact_onset_and_bounded_level() {
    let mut dsp = engine(1);
    dsp.set_voices(&[spec("direct", 1., 0.05, 0.)], 1);
    let mut first = None;
    for frame in 0..1200 {
        let input = if frame == 200 { 0.5 } else { 0. };
        let out = dsp.process_frame([input; 2]);
        assert!(out.iter().all(|x| x.is_finite() && x.abs() < 1.));
        if out[0] != 0. {
            first.get_or_insert(frame);
        }
        assert_eq!(out[0], out[1]);
    }
    assert_eq!(first, Some(600));
}

#[test]
fn prepared_classic_branch_seeds_match_actual_key_grains_and_survive_control_updates() {
    let mut reserved = engine(2);
    let mut original_keys = engine(2);
    let storage_keys: [String; 2] = ["generation:trunk/A".into(), "generation:trunk/B".into()];
    let branch_keys: [String; 2] = ["generation:plant:1".into(), "generation:plant:2".into()];
    let seeds = branch_keys.each_ref().map(|key| phase_seed(key));
    assert_ne!(seeds[0], phase_seed(&storage_keys[0]));
    reserved.install_pool(&storage_keys).unwrap();
    original_keys.install_pool(&branch_keys).unwrap();
    let mut targets = [
        PoolTarget {
            delay: 0.18,
            rate: 1.7,
            gain: 0.45,
            pan: -0.4,
        },
        PoolTarget {
            delay: 0.27,
            rate: 0.63,
            gain: 0.28,
            pan: 0.3,
        },
    ];
    ALLOCS.with(|count| count.set(0));
    DEALLOCS.with(|count| count.set(0));
    TRACK.with(|track| track.set(true));
    reserved.set_pool_phase_seeds(&seeds);
    reserved.update_pool(&targets, 2);
    original_keys.update_pool(&targets, 2);
    let mut peak = 0.0_f32;
    for frame in 0..8000 {
        if frame == 3000 {
            targets[0].delay = 0.31;
            targets[1].rate = 1.21;
        }
        if frame % 128 == 0 || frame == 3000 {
            // A scene/control update repeats prepared key identities. It must
            // never restart the advancing grain phases or erase delay history.
            reserved.set_pool_phase_seeds(&seeds);
            reserved.update_pool(&targets, 2);
            original_keys.update_pool(&targets, 2);
        }
        let input = [tone(frame, 173.37), tone(frame, 259.53)];
        let output = reserved.process_frame(input);
        assert_eq!(output, original_keys.process_frame(input), "frame {frame}");
        peak = peak.max(output[0].abs());
    }
    TRACK.with(|track| track.set(false));
    assert!(peak > 0.01);
    assert_eq!(
        ALLOCS.with(Cell::get),
        0,
        "Phase preparation is callback-safe"
    );
    assert_eq!(DEALLOCS.with(Cell::get), 0);
}

#[test]
fn doubling_playback_rate_moves_tonal_energy_up_one_octave() {
    let mut dsp = engine(1);
    dsp.set_voices(&[spec("pitch", 2., 0.2, 0.)], 1);
    let mut samples = Vec::new();
    for frame in 0..16000 {
        let out = dsp.process_frame([tone(frame, 200.); 2]);
        if frame >= 8000 {
            samples.push(out[0]);
        }
    }
    assert!(power(&samples, 400.) > 100. * power(&samples, 200.));
    assert!(samples.iter().any(|sample| sample.abs() > 0.01));
}

#[test]
fn stereo_history_and_pan_keep_independent_input_channels() {
    let mut dsp = engine(2);
    dsp.set_voices(&[spec("left", 1., 0.1, -1.)], 1);
    let mut peak = 0f32;
    for frame in 0..4000 {
        let out = dsp.process_frame([tone(frame, 200.), tone(frame, 400.)]);
        peak = peak.max(out[0].abs());
        assert_eq!(out[1], 0.);
    }
    assert!(peak > 0.04);
}

#[test]
fn control_change_preserves_history_and_release_removes_voices() {
    let mut dsp = engine(1);
    dsp.set_voices(&[spec("same", 1., 0.1, 0.)], 1);
    for frame in 0..4000 {
        dsp.process_frame([tone(frame, 200.); 2]);
    }
    dsp.set_voices(&[spec("same", 1., 0.2, 0.)], 1);
    let mut peak = 0f32;
    for frame in 0..1000 {
        peak = peak.max(dsp.process_frame([tone(frame, 200.); 2])[0].abs());
    }
    assert!(
        peak > 0.03,
        "a delay edit must not clear the recorded input"
    );
    dsp.silence();
    for frame in 0..4000 {
        let out = dsp.process_frame([tone(frame, 200.); 2]);
        if frame > 3000 {
            assert!(out[0].abs() < 0.0001);
        }
        if frame % 128 == 127 {
            dsp.finish_block();
        }
    }
    assert_eq!(dsp.active_voice_count(), 0);
}

#[test]
fn rendering_and_silence_do_not_allocate_even_at_full_capacity() {
    let mut dsp = Engine::new(RATE, 4., DEFAULT_VOICE_CAPACITY, 1).unwrap();
    let specs: Vec<_> = (0..DEFAULT_VOICE_CAPACITY)
        .map(|i| spec(&format!("v{i}"), 0.125 + (i % 63) as f64 / 8., 0.2, 0.))
        .collect();
    dsp.set_voices(&specs, DEFAULT_VOICE_CAPACITY);
    assert_eq!(dsp.active_voice_count(), DEFAULT_VOICE_CAPACITY);
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|track| track.set(true));
    for _ in 0..128 {
        dsp.process_frame([0.1, 0.1]);
    }
    let mut output = [[0.; 2]; 128];
    dsp.process_block(&[[0.1; 2]; 128], &mut output);
    dsp.silence();
    dsp.finish_block();
    TRACK.with(|track| track.set(false));
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
}

#[test]
fn audible_render_and_completed_release_do_not_free_memory_on_sample_thread() {
    let mut dsp = engine(2);
    dsp.set_voices(&[spec("release", 2., 0.1, 0.2)], 1);
    // Collect enough real history that both pitched grains are sounding.
    for frame in 0..8000 {
        dsp.process_frame([tone(frame, 200.); 2]);
    }
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|track| track.set(true));
    let mut peak = 0f32;
    for frame in 0..128 {
        peak = peak.max(dsp.process_frame([tone(frame, 200.); 2])[0].abs());
    }
    dsp.silence();
    for frame in 0..3000 {
        dsp.process_frame([tone(frame, 200.); 2]);
        if frame % 128 == 127 {
            dsp.finish_block();
        }
    }
    TRACK.with(|track| track.set(false));
    assert!(peak > 0.01);
    assert_eq!(dsp.active_voice_count(), 0);
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
}

#[test]
fn full_capacity_coherent_release_does_not_discard_an_audible_aggregate_tail() {
    let mut dsp = Engine::new(RATE, 4., DEFAULT_VOICE_CAPACITY, 1).unwrap();
    let voices: Vec<_> = (0..DEFAULT_VOICE_CAPACITY)
        .map(|i| spec(&format!("coherent:{i}"), 1., 0.001, 0.))
        .collect();
    dsp.set_voices(&voices, DEFAULT_VOICE_CAPACITY);
    for _ in 0..2000 {
        dsp.process_frame([0.1; 2]);
    }
    dsp.silence();
    let mut last = 1f32;
    let mut retirement_jump = None;
    for frame in 0..4000 {
        let sample = dsp.process_frame([0.1; 2])[0];
        if dsp.active_voice_count() == 0 {
            retirement_jump = Some((last - sample).abs());
            break;
        }
        last = sample;
        if frame % 128 == 127 {
            dsp.finish_block();
        }
    }
    assert!(
        retirement_jump.is_some_and(|jump| jump < 0.0001),
        "aggregate retirement jump: {retirement_jump:?}"
    );
}

#[test]
fn malformed_configuration_and_input_are_bounded() {
    assert!(Engine::new(0, 4., 64, 1).is_err());
    assert!(Engine::new(RATE, f64::INFINITY, 64, 1).is_err());
    assert!(Engine::new(RATE, 4., DEFAULT_VOICE_CAPACITY + 1, 1).is_ok());
    assert!(Engine::new(RATE, 4., usize::MAX, 1).is_err());
    let mut scene = Scene::default();
    scene.events.push(VoiceEvent {
        time: -1.,
        ..VoiceEvent::default()
    });
    assert!(scene.validate().is_err());
    let mut dsp = engine(1);
    dsp.set_voices(
        &[VoiceSpec {
            key: "bad".into(),
            rate: f64::NAN,
            gain: 100.,
            pan: 100.,
            delay: -100.,
        }],
        1,
    );
    for _ in 0..4000 {
        let out = dsp.process_frame([f32::NAN, f32::INFINITY]);
        assert_eq!(out, [0., 0.]);
    }
}

#[test]
fn persistent_pool_updates_growth_and_completed_release_have_no_heap_activity() {
    let mut dsp = engine(2);
    let keys: Vec<String> = (0..64).map(|n| format!("generation:pool/{n}")).collect();
    dsp.install_pool(&keys).unwrap();
    assert_eq!(dsp.active_voice_count(), 0);
    let targets: Vec<PoolTarget> = (0..8)
        .map(|n| PoolTarget {
            delay: 0.08 + n as f64 * 0.025,
            rate: 0.5 + n as f64 * 0.25,
            gain: 0.06,
            pan: n as f64 / 3.5 - 1.,
        })
        .collect();
    dsp.update_pool(&targets, 4);
    for frame in 0..8000 {
        dsp.process_frame([tone(frame, 200.), tone(frame, 310.)]);
    }
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|track| track.set(true));
    dsp.set_pool_limit(8);
    let grown = dsp.active_voice_count();
    let mut peak = 0_f32;
    for frame in 0..1000 {
        peak = peak.max(dsp.process_frame([tone(frame, 200.), tone(frame, 310.)])[0].abs());
    }
    let edited = [PoolTarget {
        delay: 0.3,
        rate: 2.,
        gain: 0.1,
        pan: -0.6,
    }];
    dsp.update_pool(&edited, 64);
    let count = dsp.target_voice_count();
    dsp.update_pool(&[], 0);
    let input = [[0.1, -0.1]; 128];
    let mut output = [[0_f32; 2]; 128];
    for _ in 0..40 {
        dsp.process_block(&input, &mut output);
    }
    let remaining = dsp.active_voice_count();
    TRACK.with(|track| track.set(false));
    assert_eq!(grown, 8, "growth must reuse remembered target gains");
    assert_eq!(count, 1, "omitted descendants must leave the target prefix");
    assert!(peak > 0.005);
    assert_eq!(remaining, 0);
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
}

#[test]
fn persistent_pool_controls_keep_recorded_history_and_smooth_the_outgoing_prefix() {
    let mut dsp = engine(1);
    dsp.install_pool(&["stable".into(), "child".into()])
        .unwrap();
    let targets = [PoolTarget {
        delay: 0.1,
        rate: 1.,
        gain: 0.3,
        pan: 0.,
    }; 2];
    dsp.update_pool(&targets, 2);
    for _ in 0..4000 {
        dsp.process_frame([0.15; 2]);
    }
    let before = dsp.process_frame([0.15; 2])[0];
    dsp.update_pool(
        &[PoolTarget {
            delay: 0.2,
            ..targets[0]
        }],
        1,
    );
    let after = dsp.process_frame([0.; 2])[0];
    assert!(
        before > 0.05 && after > 0.05,
        "control updates must retain recorded input"
    );
    assert!(
        (after - before).abs() < 0.005,
        "outgoing descendants must release smoothly"
    );
    dsp.set_pool_limit(0);
    assert!(dsp.process_frame([0.; 2])[0] > 0.01);
    for frame in 0..4000 {
        dsp.process_frame([0.; 2]);
        if frame % 128 == 127 {
            dsp.finish_block();
        }
    }
    assert_eq!(dsp.active_voice_count(), 0);
    dsp.set_pool_limit(2);
    assert_eq!(
        dsp.target_voice_count(),
        1,
        "omitted targets must not regrow from stale gains"
    );
    assert_eq!(dsp.active_voice_count(), 1);
    assert!(engine(1)
        .install_pool(&["same".into(), "same".into()])
        .is_err());
}

#[test]
fn newly_installed_pool_matches_ordinary_voice_sound_exactly() {
    let mut ordinary = engine(2);
    let mut pool = engine(2);
    let voices: Vec<_> = (0..8)
        .map(|n| VoiceSpec {
            key: format!("branch/{n}"),
            delay: 0.08 + n as f64 * 0.023,
            rate: 0.5 + n as f64 * 0.25,
            gain: 0.05,
            pan: n as f64 / 3.5 - 1.,
        })
        .collect();
    pool.install_pool(&voices.iter().map(|v| v.key.clone()).collect::<Vec<_>>())
        .unwrap();
    let targets: Vec<_> = voices
        .iter()
        .map(|v| PoolTarget {
            delay: v.delay,
            rate: v.rate,
            gain: v.gain,
            pan: v.pan,
        })
        .collect();
    ordinary.set_voices(&voices, 8);
    pool.update_pool(&targets, 8);
    for block in 0..80 {
        let input = std::array::from_fn::<_, 128, _>(|n| {
            [tone(block * 128 + n, 200.), tone(block * 128 + n, 310.)]
        });
        let mut first = [[0.; 2]; 128];
        let mut second = [[0.; 2]; 128];
        ordinary.process_block(&input, &mut first);
        pool.process_block(&input, &mut second);
        assert_eq!(first, second);
    }
}

#[test]
fn pool_delay_return_before_render_and_during_first_half_restores_the_audible_source() {
    for (elapsed, return_delay) in [
        (0, 0.2),
        (208, 0.2),
        (0, 0.2 + 0.25 / 8000.),
        (208, 0.2 + 0.25 / 8000.),
    ] {
        let mut steady = engine(1);
        let mut edited = engine(1);
        let original = PoolTarget {
            delay: 0.2,
            rate: 1.,
            gain: 0.3,
            pan: 0.,
        };
        for dsp in [&mut steady, &mut edited] {
            dsp.install_pool(&["retime".into()]).unwrap();
            dsp.update_pool(&[original], 1);
        }
        for frame in 0..8000 {
            let input = [tone(frame, 173.); 2];
            assert_eq!(steady.process_frame(input), edited.process_frame(input));
        }
        edited.update_pool(
            &[PoolTarget {
                delay: 0.8,
                ..original
            }],
            1,
        );
        let mut changed_peak = 0_f32;
        for frame in 0..elapsed {
            let input = [tone(frame + 8000, 173.); 2];
            let unchanged = steady.process_frame(input);
            let changed = edited.process_frame(input);
            changed_peak = changed_peak.max((unchanged[0] - changed[0]).abs());
        }
        if elapsed > 0 {
            assert!(
                changed_peak > 0.005,
                "the destination must actually be audible"
            );
        }
        edited.update_pool(
            &[PoolTarget {
                delay: return_delay,
                ..original
            }],
            1,
        );
        let mut restored_peak = 0_f32;
        for frame in 0..1200 {
            let input = [tone(frame + 8000 + elapsed, 173.); 2];
            let unchanged = steady.process_frame(input);
            let restored = edited.process_frame(input);
            if elapsed == 0 || frame > 520 {
                assert_eq!(
                    unchanged, restored,
                    "source delay must be restored at elapsed={elapsed}, frame={frame}"
                );
                restored_peak = restored_peak.max(restored[0].abs());
            }
        }
        assert!(restored_peak > 0.01);
    }
}

#[test]
fn sixty_hz_delay_gestures_stay_within_the_continuous_tone_and_fade_envelope() {
    let original = PoolTarget {
        delay: 0.2,
        rate: 1.,
        gain: 0.3,
        pan: 0.,
    };
    let mut moving = engine(1);
    let mut stationary = engine(1);
    for dsp in [&mut moving, &mut stationary] {
        dsp.install_pool(&["gesture".into()]).unwrap();
        dsp.update_pool(&[original], 1);
    }
    let mut previous = [0.; 2];
    for frame in 0..8000 {
        previous = moving.process_frame([tone(frame, 173.); 2]);
        assert_eq!(previous, stationary.process_frame([tone(frame, 173.); 2]));
    }
    let mut previous_stationary = previous;
    let mut last_step = usize::MAX;
    let mut maximum_delta = 0_f64;
    let mut stationary_delta = 0_f64;
    let mut command_delta = 0_f64;
    for frame in 0..16000 {
        let step = frame * 60 / RATE as usize;
        let changed = step != last_step;
        if changed {
            let delay = match step {
                0..=29 => 0.2 + step as f64 * 0.0012,
                30..=59 => 0.82 - (step - 30) as f64 * 0.0008,
                60..=89 => 0.31 + (step - 60) as f64 * 0.0013,
                _ => 0.2 + (step - 90) as f64 * 0.0007,
            };
            moving.update_pool(&[PoolTarget { delay, ..original }], 1);
            last_step = step;
        }
        let input = [tone(frame + 8000, 173.); 2];
        let output = moving.process_frame(input);
        let steady = stationary.process_frame(input);
        let difference = f64::from((output[0] - previous[0]).abs());
        maximum_delta = maximum_delta.max(difference);
        if changed {
            command_delta = command_delta.max(difference);
        }
        stationary_delta =
            stationary_delta.max(f64::from((steady[0] - previous_stationary[0]).abs()));
        previous = output;
        previous_stationary = steady;
    }
    // tanh and linear interpolation cannot increase the input's Lipschitz
    // bound. The two fixed read heads have an equal-power sum bounded by
    // sqrt(2); their 65 ms sine/cosine weights have this derivative bound.
    // Thus legitimate carrier motion plus a continuous fade must fit this
    // envelope, even when the two heads read opposite tone phases.
    let carrier_delta = 0.2 * (std::f64::consts::PI * 173. / f64::from(RATE)).sin();
    let fade_delta = 0.1 * std::f64::consts::FRAC_PI_2 / (f64::from(RATE) * 0.065);
    let envelope = original.gain
        * std::f64::consts::FRAC_1_SQRT_2
        * std::f64::consts::SQRT_2
        * (carrier_delta + fade_delta)
        + 1e-7;
    eprintln!("gesture maximum adjacent={maximum_delta:0.8}, command={command_delta:0.8}, stationary={stationary_delta:0.8}, continuous envelope={envelope:0.8}");
    assert!(
        maximum_delta <= envelope,
        "60 Hz gesture introduced a discontinuity: {maximum_delta} > {envelope}"
    );
}

#[test]
fn pending_pool_edits_coalesce_without_postponing_the_final_target_forever() {
    for rate in [1., 2., 0.5] {
        let original = PoolTarget {
            delay: 0.2,
            rate,
            gain: 0.3,
            pan: 0.2,
        };
        let mut moving = engine(2);
        let mut final_target = engine(2);
        let mut latest_only = engine(2);
        for dsp in [&mut moving, &mut final_target, &mut latest_only] {
            dsp.install_pool(&["coalesced".into()]).unwrap();
            dsp.update_pool(&[original], 1);
        }
        for frame in 0..8000 {
            let input = [tone(frame, 173.), tone(frame, 259.5)];
            let output = moving.process_frame(input);
            assert_eq!(output, final_target.process_frame(input));
            assert_eq!(output, latest_only.process_frame(input));
        }
        // None of the intermediate commands has rendered a sample. They must
        // sound exactly like the last command alone, including pitched stereo.
        for delay in [0.2015, 0.203, 0.8, 0.37] {
            moving.update_pool(&[PoolTarget { delay, ..original }], 1);
        }
        latest_only.update_pool(
            &[PoolTarget {
                delay: 0.37,
                ..original
            }],
            1,
        );
        final_target.update_pool(
            &[PoolTarget {
                delay: 0.37,
                ..original
            }],
            1,
        );
        for frame in 0..640 {
            let input = [tone(frame + 8000, 173.), tone(frame + 8000, 259.5)];
            let output = moving.process_frame(input);
            assert_eq!(output, latest_only.process_frame(input));
            assert_eq!(output, final_target.process_frame(input));
        }
        // A new sweep spans multiple active fades and ends at the already
        // settled reference target. Latest controls must settle within one
        // current plus one final 65 ms fade, independent of discarded edits.
        for step in 0..20 {
            moving.update_pool(
                &[PoolTarget {
                    delay: 0.8 - step as f64 * 0.019,
                    ..original
                }],
                1,
            );
            for offset in 0..80 {
                let frame = 8640 + step * 80 + offset;
                let input = [tone(frame, 173.), tone(frame, 259.5)];
                moving.process_frame(input);
                final_target.process_frame(input);
            }
        }
        moving.update_pool(
            &[PoolTarget {
                delay: 0.37,
                ..original
            }],
            1,
        );
        let mut restored_peak = 0_f32;
        for offset in 0..1800 {
            let frame = 10240 + offset;
            let input = [tone(frame, 173.), tone(frame, 259.5)];
            let output = moving.process_frame(input);
            let settled = final_target.process_frame(input);
            if offset > 1040 {
                assert_eq!(output, settled, "rate={rate}, final target sample={offset}");
                restored_peak = restored_peak.max(output[0].abs());
            }
        }
        assert!(restored_peak > 0.01);
    }
}

#[test]
fn pending_long_delay_preserves_stereo_block_sample_parity_at_history_wrap() {
    let mut block = engine(2);
    let mut sample = engine(2);
    let original = PoolTarget {
        delay: 0.2,
        rate: 1.,
        gain: 0.3,
        pan: -0.2,
    };
    for dsp in [&mut block, &mut sample] {
        dsp.install_pool(&["ring".into()]).unwrap();
        dsp.update_pool(&[original], 1);
    }
    // Nonintegral cycle counts over the four-second ring ensure a prematurely
    // overwritten old sample differs from fresh input.
    for frame in 0..33000 {
        let input = [tone(frame, 173.37), tone(frame, 259.53)];
        assert_eq!(block.process_frame(input), sample.process_frame(input));
    }
    for dsp in [&mut block, &mut sample] {
        dsp.update_pool(
            &[PoolTarget {
                delay: 0.8,
                ..original
            }],
            1,
        );
    }
    // Leave about 20 samples of this fade, so the pending old-ring lane becomes
    // audible near the beginning, rather than the safe end, of the next block.
    for frame in 33000..33500 {
        let input = [tone(frame, 173.37), tone(frame, 259.53)];
        assert_eq!(block.process_frame(input), sample.process_frame(input));
    }
    for dsp in [&mut block, &mut sample] {
        dsp.update_pool(
            &[PoolTarget {
                delay: 4. - 3. / f64::from(RATE),
                ..original
            }],
            1,
        );
    }
    let mut cursor = 33500;
    let mut chunk = 0;
    while cursor < 44000 {
        if cursor >= 39500 {
            let target = [PoolTarget {
                delay: 0.17,
                ..original
            }];
            block.update_pool(&target, 1);
            sample.update_pool(&target, 1);
        }
        let count = [128, 7, 63, 1, 127][chunk % 5].min(44000 - cursor);
        let mut input = [[0.; 2]; 128];
        let mut output = [[0.; 2]; 128];
        for (offset, frame) in input[..count].iter_mut().enumerate() {
            *frame = [tone(cursor + offset, 173.37), tone(cursor + offset, 259.53)];
        }
        block.process_block(&input[..count], &mut output[..count]);
        for (offset, frame) in input[..count].iter().enumerate() {
            assert_eq!(
                output[offset],
                sample.process_frame(*frame),
                "pending long delay, frame {}",
                cursor + offset
            );
        }
        sample.finish_block();
        cursor += count;
        chunk += 1;
    }
}

#[test]
fn ranked_pool_normalizes_selected_generations_and_reuses_budget_controls() {
    let mut pool = engine(2);
    let mut ordinary = engine(2);
    let keys: Vec<_> = (0..4).map(|index| format!("ranked/{index}")).collect();
    pool.install_pool(&keys).unwrap();
    let targets = std::array::from_fn::<_, 4, _>(|index| PoolTarget {
        delay: 0.08 + index as f64 * 0.03,
        rate: 1.,
        gain: 0.4,
        pan: if index % 2 == 0 { -1. } else { 1. },
    });
    let ranks = [3, 0, 2, 1];
    let groups = [2, 1, 2, 1];
    pool.update_pool_ranked(&targets, &ranks, &groups, 2);
    let specs: Vec<_> = [1, 3]
        .into_iter()
        .map(|index| VoiceSpec {
            key: keys[index].clone(),
            delay: targets[index].delay,
            rate: 1.,
            pan: targets[index].pan,
            gain: 0.4 / 2_f64.sqrt(),
        })
        .collect();
    ordinary.set_voices(&specs, 4);
    assert_eq!(pool.target_voice_count(), 2);
    let mut cursor = 0;
    for _ in 0..64 {
        let input = std::array::from_fn::<_, 128, _>(|offset| {
            [tone(cursor + offset, 173.), tone(cursor + offset, 259.5)]
        });
        let mut first = [[0.; 2]; 128];
        let mut second = [[0.; 2]; 128];
        pool.process_block(&input, &mut first);
        ordinary.process_block(&input, &mut second);
        assert_eq!(first, second);
        assert!(first.iter().all(|frame| frame[0] == 0.));
        cursor += 128;
    }
    // Calibration grows without another topology command. This generation
    // now contains two selected voices and both generations must use sqrt(2).
    pool.set_pool_limit(4);
    let specs: Vec<_> = (0..4)
        .map(|index| VoiceSpec {
            key: keys[index].clone(),
            delay: targets[index].delay,
            rate: 1.,
            pan: targets[index].pan,
            gain: 0.4 / 2_f64.sqrt(),
        })
        .collect();
    ordinary.set_voices(&specs, 4);
    assert_eq!(pool.target_voice_count(), 4);
    for _ in 0..16 {
        let input = std::array::from_fn::<_, 128, _>(|offset| {
            [tone(cursor + offset, 173.), tone(cursor + offset, 259.5)]
        });
        let mut first = [[0.; 2]; 128];
        let mut second = [[0.; 2]; 128];
        pool.process_block(&input, &mut first);
        ordinary.process_block(&input, &mut second);
        assert_eq!(first, second);
        cursor += 128;
    }
    // Shrinking changes survivor normalization and releases the other slots.
    pool.set_pool_limit(1);
    ordinary.set_voices(
        &[VoiceSpec {
            gain: 0.4,
            ..specs[1].clone()
        }],
        4,
    );
    assert_eq!(pool.target_voice_count(), 1);
    for frame in cursor..cursor + 3000 {
        let input = [tone(frame, 173.), tone(frame, 259.5)];
        let a = pool.process_frame(input);
        let b = ordinary.process_frame(input);
        assert!((a[0] - b[0]).abs() < 1e-7 && (a[1] - b[1]).abs() < 1e-7);
    }
    pool.finish_block();
    assert_eq!(pool.active_voice_count(), 1);
    // Duplicate, missing and out-of-range ranks cannot bypass the limit.
    pool.update_pool_ranked(&targets, &[0, 0, usize::MAX], &[], 4);
    assert_eq!(pool.target_voice_count(), 1);
}

#[test]
fn rapid_ranked_pool_edits_normalization_and_retirement_have_no_heap_activity() {
    let mut dsp = engine(2);
    let keys: Vec<_> = (0..8).map(|index| format!("real-time/{index}")).collect();
    dsp.install_pool(&keys).unwrap();
    let mut targets = [PoolTarget {
        delay: 0.2,
        rate: 2.,
        gain: 0.2,
        pan: 0.,
    }; 8];
    let ranks = [7, 0, 6, 1, 5, 2, 4, 3];
    let groups = [1, 1, 2, 2, 3, 3, 3, 3];
    dsp.update_pool_ranked(&targets, &ranks, &groups, 4);
    for frame in 0..8000 {
        dsp.process_frame([tone(frame, 173.); 2]);
    }
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|track| track.set(true));
    let mut output = [[0.; 2]; 128];
    for step in 0..120 {
        for (index, target) in targets.iter_mut().enumerate() {
            target.delay = 0.2 + ((step + index) % 17) as f64 * 0.019;
            target.rate = 0.5 + ((step + index) % 7) as f64 * 0.25;
            target.pan = ((step + index) % 9) as f64 / 4. - 1.;
        }
        dsp.update_pool_ranked(&targets, &ranks, &groups, 1 + step % 8);
        dsp.set_pool_limit(1 + (step + 3) % 8);
        let input = std::array::from_fn::<_, 128, _>(|offset| {
            [
                tone(8000 + step * 128 + offset, 173.),
                tone(8000 + step * 128 + offset, 259.5),
            ]
        });
        dsp.process_block(&input, &mut output);
    }
    dsp.update_pool_ranked(&[], &[], &[], 0);
    for _ in 0..40 {
        dsp.process_block(&[[0.; 2]; 128], &mut output);
    }
    let remaining = dsp.active_voice_count();
    TRACK.with(|track| track.set(false));
    assert_eq!(remaining, 0);
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
}

#[test]
fn block_render_matches_sample_order_through_stereo_edits_startup_and_ring_wrap() {
    for long_delay in [false, true] {
        let mut block = engine(2);
        let mut sample = engine(2);
        let mut voices = vec![
            spec("direct", 1., if long_delay { 3.99 } else { 0.001 }, -0.3),
            spec("up", 8., 0.12, 0.7),
            spec("down", 0.125, if long_delay { 3.8 } else { 0.17 }, -0.8),
        ];
        block.set_voices(&voices, 8);
        sample.set_voices(&voices, 8);
        let mut cursor = 0;
        let mut chunk = 0;
        while cursor < 42000 {
            if cursor >= 1000 && voices[0].delay != 0.23 && cursor < 2000 {
                voices[0].delay = 0.23;
                voices[1].rate = 0.8;
                voices[1].pan = -0.6;
                block.set_voices(&voices, 8);
                sample.set_voices(&voices, 8);
            }
            if cursor >= 34000 && voices.len() == 3 {
                voices.remove(1);
                block.set_voices(&voices, 8);
                sample.set_voices(&voices, 8);
            }
            if cursor >= 38000 {
                block.silence();
                sample.silence();
            }
            let count = [128, 7, 63, 1, 127][chunk % 5].min(42000 - cursor);
            let mut input = [[0.; 2]; 128];
            let mut output = [[0.; 2]; 128];
            for (offset, frame) in input[..count].iter_mut().enumerate() {
                *frame = [tone(cursor + offset, 173.), tone(cursor + offset, 259.5)];
            }
            block.process_block(&input[..count], &mut output[..count]);
            for (offset, frame) in input[..count].iter().enumerate() {
                assert_eq!(
                    output[offset],
                    sample.process_frame(*frame),
                    "long delay {long_delay}, frame {}",
                    cursor + offset
                );
            }
            sample.finish_block();
            assert_eq!(block.active_voice_count(), sample.active_voice_count());
            cursor += count;
            chunk += 1;
        }
    }
}

#[test]
fn warmed_block_render_and_retirement_do_not_allocate_or_free() {
    let mut dsp = engine(2);
    dsp.set_voices(&[spec("block", 2., 0.1, 0.2)], 1);
    let input = [[0.1, -0.1]; 128];
    let mut output = [[0.; 2]; 128];
    for _ in 0..64 {
        dsp.process_block(&input, &mut output);
    }
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|track| track.set(true));
    dsp.process_block(&input, &mut output);
    let peak = output
        .iter()
        .map(|frame| frame[0].abs())
        .fold(0f32, f32::max);
    dsp.silence();
    for _ in 0..32 {
        dsp.process_block(&input, &mut output);
    }
    TRACK.with(|track| track.set(false));
    assert!(peak > 0.01);
    assert_eq!(dsp.active_voice_count(), 0);
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
}

#[test]
fn pool_growth_beyond_old_ceiling_preserves_samples_and_has_no_callback_heap_activity() {
    use l_system_delay_core::PreparedPool;
    let keys: Vec<_> = (0..32768).map(|i| format!("dynamic:{i}")).collect();
    let mut small = Engine::new(RATE, 4., 64, 1).unwrap();
    let mut reference = Engine::new(RATE, 4., keys.len(), 1).unwrap();
    small.install_pool(&keys[..64]).unwrap();
    reference.install_pool(&keys).unwrap();
    let targets = vec![
        PoolTarget {
            delay: 0.03,
            rate: 1.3,
            gain: 0.03,
            pan: -0.2
        };
        64
    ];
    small.update_pool(&targets, 48);
    reference.update_pool(&targets, 48);
    for frame in 0..1600 {
        assert_eq!(
            small.process_frame([tone(frame, 173.); 2]),
            reference.process_frame([tone(frame, 173.); 2])
        );
    }
    let mut prepared = PreparedPool::new(&keys).unwrap();
    ALLOCS.with(|n| n.set(0));
    DEALLOCS.with(|n| n.set(0));
    TRACK.with(|n| n.set(true));
    small.grow_pool(&mut prepared);
    small.update_pool(&targets, 48);
    for frame in 1600..2000 {
        let a = small.process_frame([tone(frame, 173.); 2]);
        let b = reference.process_frame([tone(frame, 173.); 2]);
        assert_eq!(
            a, b,
            "Growing reserve must preserve pitch phase and raw history"
        );
    }
    small.finish_block();
    TRACK.with(|n| n.set(false));
    assert_eq!(ALLOCS.with(Cell::get), 0);
    assert_eq!(DEALLOCS.with(Cell::get), 0);
    let many = vec![
        PoolTarget {
            delay: 0.03,
            rate: 1.,
            gain: 0.00001,
            pan: 0.
        };
        keys.len()
    ];
    let mut ranks: Vec<_> = (0..keys.len()).collect();
    ranks[32767] = 32766; // Duplicate rank above the former stack bitset boundary.
    small.update_pool_ranked(&many, &ranks, &vec![14; keys.len()], keys.len());
    assert_eq!(small.target_voice_count(), keys.len() - 1);
    assert_eq!(small.active_voice_count(), keys.len() - 1);
}

#[test]
fn measured_generation_activity_waits_for_actual_audio_and_follows_retained_history() {
    let mut dsp = engine(1);
    dsp.install_pool(&["activity".into()]).unwrap();
    let target = [PoolTarget {
        delay: 0.04,
        rate: 1.,
        gain: 0.5,
        pan: 0.,
    }];
    dsp.update_pool_ranked(&target, &[0], &[3], 1);
    let silence = [[0.; 2]; 128];
    let mut out = [[0.; 2]; 128];
    for _ in 0..8 {
        dsp.process_block(&silence, &mut out);
    }
    assert_eq!(dsp.generation_activity()[3], 0.);
    let signal = [[0.2; 2]; 128];
    dsp.process_block(&signal, &mut out);
    assert_eq!(
        dsp.generation_activity()[3],
        0.,
        "Lighting cannot precede a delay's real output"
    );
    for _ in 0..5 {
        dsp.process_block(&signal, &mut out);
    }
    assert!(dsp.generation_activity()[3] > 0.01);
    for _ in 0..300 {
        dsp.process_block(&silence, &mut out);
    }
    assert!(dsp.generation_activity()[3] < 0.000001);
    assert_eq!(dsp.generation_activity()[2], 0.);
}

#[test]
fn individual_taps_in_the_same_generation_light_at_their_own_audio_onsets() {
    let mut dsp = engine(1);
    dsp.install_pool(&["early".into(), "late".into()]).unwrap();
    let targets = [0.03, 0.13].map(|delay| PoolTarget {
        delay,
        rate: 1.,
        gain: 0.5,
        pan: 0.,
    });
    dsp.update_pool_ranked(&targets, &[0, 1], &[3, 3], 2);
    let mut output = [[0.; 2]; 128];
    for _ in 0..5 {
        dsp.process_block(&[[0.2; 2]; 128], &mut output);
    }
    assert!(dsp.tap_activity()[0] > 0.01);
    assert_eq!(
        dsp.tap_activity()[1],
        0.,
        "A sibling's output must not light a silent tap"
    );
    for _ in 0..5 {
        dsp.process_block(&[[0.2; 2]; 128], &mut output);
    }
    assert!(dsp.tap_activity()[1] > 0.01);
    assert_eq!(&dsp.tap_voice_indices()[..2], &[0, 1]);
}

#[test]
fn tap_meter_captures_an_impulse_between_sparse_generation_probes() {
    let mut dsp = engine(1);
    dsp.install_pool(&["impulse".into()]).unwrap();
    dsp.update_pool_ranked(
        &[PoolTarget {
            delay: 0.04,
            rate: 1.,
            gain: 0.5,
            pan: 0.,
        }],
        &[0],
        &[3],
        1,
    );
    let silence = [[0.; 2]; 128];
    let mut output = [[0.; 2]; 128];
    for _ in 0..16 {
        dsp.process_block(&silence, &mut output);
    }
    let mut impulse = silence;
    impulse[37] = [0.5; 2];
    dsp.process_block(&impulse, &mut output);
    dsp.process_block(&silence, &mut output);
    dsp.process_block(&silence, &mut output);
    assert!(output[101][0] > 0.1);
    assert!(
        dsp.tap_activity()[0] > 0.005,
        "Actual short audio must appear in the graphic"
    );
    let rendered_rms = (output
        .iter()
        .map(|frame| {
            let left = f64::from(frame[0]).atanh();
            let right = f64::from(frame[1]).atanh();
            (left * left + right * right) * 0.5
        })
        .sum::<f64>()
        / output.len() as f64)
        .sqrt();
    assert!(
        (f64::from(dsp.tap_activity()[0]) - rendered_rms).abs() < 1e-6,
        "The meter agrees with independently measured rendered audio"
    );
    assert_eq!(
        dsp.generation_activity()[3],
        0.,
        "This fixture reproduces sparse-probe blindness"
    );
}

#[test]
fn priority_edits_remap_tap_envelopes_by_voice_and_budget_shrink_retains_release() {
    let mut dsp = engine(1);
    dsp.install_pool(&["early".into(), "late".into()]).unwrap();
    let targets = [0.03, 0.3].map(|delay| PoolTarget {
        delay,
        rate: 1.,
        gain: 0.5,
        pan: 0.,
    });
    dsp.update_pool_ranked(&targets, &[0, 1], &[1, 1], 2);
    let mut output = [[0.; 2]; 128];
    for _ in 0..5 {
        dsp.process_block(&[[0.2; 2]; 128], &mut output);
    }
    let early = dsp.tap_activity()[0];
    assert!(early > 0.01);
    assert_eq!(dsp.tap_activity()[1], 0.);
    dsp.update_pool_ranked(&targets, &[1, 0], &[1, 1], 1);
    assert_eq!(&dsp.tap_voice_indices()[..2], &[1, 0]);
    assert_eq!(dsp.tap_activity()[0], 0.);
    assert_eq!(
        dsp.tap_activity()[1],
        early,
        "Pruning cannot transplant brightness to a different voice"
    );
    dsp.process_block(&[[0.2; 2]; 128], &mut output);
    assert!(
        dsp.tap_activity()[1] > 0.,
        "The released voice remains visible while it is audible"
    );
    for _ in 0..200 {
        dsp.process_block(&[[0.; 2]; 128], &mut output);
    }
    assert!(dsp.tap_activity()[1] < 0.000001);
}

#[test]
fn audio_voices_beyond_the_preview_meter_capacity_still_render() {
    let count = TAP_ACTIVITY_CAPACITY + 1;
    let keys: Vec<_> = (0..count).map(|index| format!("tap:{index}")).collect();
    let targets = vec![
        PoolTarget {
            delay: 0.02,
            rate: 1.,
            gain: 0.0001,
            pan: 0.
        };
        count
    ];
    let mut full = Engine::new(RATE, 4., count, 1).unwrap();
    let mut metered_only = Engine::new(RATE, 4., count, 1).unwrap();
    for dsp in [&mut full, &mut metered_only] {
        dsp.install_pool(&keys).unwrap();
        dsp.prepare_calibration_history();
    }
    full.update_pool(&targets, count);
    metered_only.update_pool(&targets, TAP_ACTIVITY_CAPACITY);
    assert_eq!(full.active_voice_count(), count);
    assert_eq!(full.target_voice_count(), count);
    assert_eq!(full.tap_meter_count(), TAP_ACTIVITY_CAPACITY);
    let mut full_output = [[0.; 2]; 128];
    let mut metered_output = full_output;
    full.process_block(&[[0.03125; 2]; 128], &mut full_output);
    metered_only.process_block(&[[0.03125; 2]; 128], &mut metered_output);
    assert!(
        full_output
            .iter()
            .zip(metered_output)
            .any(|(full, metered)| full[0] - metered[0] > 1e-7),
        "A voice without a visual meter still contributes audio"
    );
}
