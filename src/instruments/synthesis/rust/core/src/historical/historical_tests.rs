use super::*;
include!("historical_fixtures.rs");

fn render(
    engine: &mut HistoricalEngine,
    method: u32,
    frequency: f32,
    params: &[f32; 16],
    frames: usize,
) -> Vec<f32> {
    (0..frames)
        .map(|_| engine.sample(method, frequency, params, true))
        .collect()
}
fn rms(samples: &[f32]) -> f32 {
    (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt()
}

#[test]
fn all_48_presets_are_finite_and_have_signal_at_common_rates() {
    for sr in [8000.0, 44100.0, 48000.0, 96000.0] {
        let mut engine = HistoricalEngine::new(sr);
        for (method, frequency, params) in FACTORIES {
            engine.prepare(method, &params, frequency);
            engine.reset();
            engine.note_on(method, frequency, 0.8, &params);
            let output = render(&mut engine, method, frequency, &params, (sr * 0.5) as usize);
            assert!(
                output.iter().all(|v| v.is_finite() && v.abs() < 3.0),
                "method{method} at{sr}: finite headroom"
            );
            let mean = output.iter().sum::<f32>() / output.len() as f32;
            let ac = output.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / output.len() as f32;
            assert!(
                ac.sqrt() > 0.0001,
                "method{method} at{sr}: source has no alternating signal"
            );
        }
    }
}

#[test]
fn exposed_control_endpoints_and_invalid_values_remain_finite() {
    for sr in [8000.0, 48000.0, 96000.0] {
        for (slot, count) in [16, 10, 6, 12, 9, 13].into_iter().enumerate() {
            let (method, _, base) = FACTORIES[slot * 8];
            for index in 0..count {
                for edge in [0.0, 1.0, f32::NAN, f32::INFINITY] {
                    let mut params = base;
                    params[index] = edge;
                    let mut engine = HistoricalEngine::new(sr);
                    engine.note_on(method, sr * 0.19, 0.8, &params);
                    let output = render(&mut engine, method, sr * 0.19, &params, 768);
                    assert!(
                        output.iter().all(|v| v.is_finite() && v.abs() < 8.0),
                        "method{method},param{index},edge{edge},rate{sr}"
                    );
                }
            }
        }
    }
}

#[test]
fn reset_is_repeatable_and_common_velocity_is_not_applied_twice() {
    for (method, frequency, params) in FACTORIES {
        let mut engine = HistoricalEngine::new(48000.0);
        engine.prepare(method, &params, frequency);
        engine.reset();
        engine.note_on(method, frequency, 0.1, &params);
        let first = render(&mut engine, method, frequency, &params, 1024);
        engine.reset();
        engine.note_on(method, frequency, 1.0, &params);
        assert_eq!(first, render(&mut engine, method, frequency, &params, 1024));
    }
}

#[test]
fn psg_frequency_comes_from_integer_timer_and_documented_duty() {
    let (_, _, mut p) = FACTORIES[8];
    p[6] = 0.0;
    let (clock, timer) = Psg::timer(440.0, &p);
    assert_eq!(timer, 253);
    assert!((clock / (16.0 * (timer + 1) as f32) - 440.3969).abs() < 0.02);
    let sr = clock / (2.0 * (timer + 1) as f32);
    for (duty, expected) in [1, 2, 4, 6].into_iter().enumerate() {
        p[1] = duty as f32 / 3.0;
        let mut engine = Psg::default();
        let high = (0..8).filter(|_| engine.next(sr, 440.0, &p) > 0.0).count();
        assert_eq!(high, expected);
    }
}

#[test]
fn lfsr_nonzero_recurrences_have_the_documented_periods() {
    for (mode, expected) in [(0, 32767), (2, 127)] {
        let mut register = Lfsr::default();
        register.mode = mode;
        for step in 1..=expected {
            register.tick();
            assert_ne!(register.state, 0);
            if step < expected {
                assert_ne!(register.state, 1);
            }
        }
        assert_eq!(register.state, 1);
    }
    let mut short = Lfsr::default();
    short.mode = 1;
    let period = (1..=32767)
        .find(|_| {
            short.tick();
            short.state == 1
        })
        .unwrap();
    assert!([31, 93].contains(&period));
}

#[test]
fn delta_bits_are_steps_with_bounded_accumulator_not_pcm_codes() {
    assert_eq!(Dpcm::step(64, 1, 2), 66);
    assert_eq!(Dpcm::step(64, 0, 2), 62);
    assert_eq!(Dpcm::step(126, 1, 2), 126);
    assert_eq!(Dpcm::step(1, 0, 2), 1);
    let mut value = 64;
    for bit in [1, 1, 0, 1, 0, 0] {
        value = Dpcm::step(value, bit, 2);
    }
    assert_eq!(value, 64);
}

fn delta_error(params: &[f32; 16], step: i32) -> f32 {
    let mut p = *params;
    p[3] = (step - 1) as f32 / 15.0;
    let mut model = Dpcm::default();
    model.prepare(48000.0, &p);
    let mut value = integer(0, 127, p[5]);
    let mut error = 0.0;
    for i in 0..DELTA_BITS {
        value = Dpcm::step(value, model.bits[i], step);
        let actual = 2.0 * value as f32 / 127.0 - 1.0;
        error += (actual - model.reference[i]).powi(2);
    }
    error / DELTA_BITS as f32
}

#[test]
fn larger_matched_delta_step_reduces_fast_sine_slope_overload() {
    let (_, _, params) = FACTORIES[25];
    let small = delta_error(&params, 2);
    let large = delta_error(&params, 8);
    assert!(large < small * 0.75, "step2 MSE{small},step8 MSE{large}");
}

#[test]
fn bytebeat_counter_is_exactly_an_eight_bit_256_update_cycle() {
    for t in 0..1024_u32 {
        assert_eq!(Bytebeat::expression(0, t, 5, 8) & 255, t % 256);
    }
    assert_eq!(8000.0_f32 / 256.0, 31.25);
    for formula in 0..8 {
        for t in [0, 1, 255, 65535, u32::MAX] {
            let _ = Bytebeat::expression(formula, t, 32, u32::MAX);
        }
    }
    let (_, _, p) = FACTORIES[32];
    let mut generator = Bytebeat::default();
    generator.counter = u32::MAX;
    generator.reconstruction = 1.0;
    generator.next(8000.0, 220.0, &p);
    assert_eq!(generator.counter, 0);
}

#[test]
fn chebyshev_unit_cosine_creates_only_the_requested_harmonic() {
    let sr = 48000.0;
    let frequency = 500.0;
    for harmonic in 1..=8 {
        let mut p = [0.0; 16];
        p[..8].fill(0.5);
        p[harmonic - 1] = 1.0;
        p[8] = 1.0;
        p[9] = 0.5;
        let mut generator = Chebyshev::default();
        let errors: Vec<f32> = (0..960)
            .map(|i| {
                let actual = generator.next(sr, frequency, &p);
                let expected = 0.65 * (TAU * frequency * harmonic as f32 * i as f32 / sr).cos();
                actual - expected
            })
            .collect();
        assert!(
            rms(&errors) < 0.0002,
            "T{harmonic}, RMSerror{}",
            rms(&errors)
        );
    }
}

#[test]
fn cascade_and_parallel_voice_paths_are_distinct_and_keep_prescribed_poles() {
    let (_, frequency, mut p) = FACTORIES[0];
    let mut cascade = HistoricalEngine::new(48000.0);
    cascade.note_on(47, frequency, 0.8, &p);
    let a = render(&mut cascade, 47, frequency, &p, 4800);
    p[0] = 1.0;
    let mut parallel = HistoricalEngine::new(48000.0);
    parallel.note_on(47, frequency, 0.8, &p);
    let b = render(&mut parallel, 47, frequency, &p, 4800);
    assert!(rms(&a) > 0.001 && rms(&b) > 0.001);
    let difference: Vec<f32> = a.iter().zip(&b).map(|(x, y)| x - y).collect();
    assert!(rms(&difference) > 0.005);
    for i in 0..4 {
        assert_eq!(cascade.voice.cascade[i].a1, parallel.voice.parallel[i].a1);
        assert_eq!(cascade.voice.cascade[i].a2, parallel.voice.parallel[i].a2);
    }
}
