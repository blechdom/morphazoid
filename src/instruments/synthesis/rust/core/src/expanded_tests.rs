use super::*;

fn defaults(method: u32) -> [f32; 16] {
    let mut p = [0.0; 16];
    let values: &[f32] = match method {
        39 => &[3.0 / 31.0, 0.5, 0.5, 0.0, 0.5, 1.0, 0.0, 1.0],
        40 => &[0.5, 0.9 / 15.9, 0.0, 7.0 / 31.0, 0.5, 1.0, 0.0, 0.0],
        41 => &[0.0, 4.0 / 7.0, 0.75 / 2.75, 0.5, 0.4, 0.5, 0.0, 0.0],
        42 => &[0.5, 0.0, 1.0, 0.0, 0.0, 0.4, 0.0, 0.0],
        43 => &[0.6, 0.5, 0.5, 0.45, 0.7, 0.0, 0.7, 0.6],
        44 => &[0.4, 0.3, 0.5, 0.5, 1.0 / 3.0, 0.3, 0.6, 0.0, 0.7, 0.6],
        45 => &[0.5, 0.5, 0.3, 1.0, 1.0, 0.4, 0.5, 1.0, 0.0, 0.0],
        46 => &[
            1.0 / 3.0,
            0.15 / 0.95,
            3.7 / 14.0,
            0.8 / 1.8,
            0.0,
            0.0,
            1.0,
            0.5,
        ],
        _ => &[],
    };
    p[..values.len()].copy_from_slice(values);
    p
}
fn render(method: u32, p: &[f32; 16], count: usize) -> Vec<f32> {
    let mut engine = NewMethods::new(48000.0);
    engine.note_on(method, 220.0, 0.8, p);
    (0..count)
        .map(|_| engine.next(method, 220.0, p, true, 0.8))
        .collect()
}
fn rms(samples: &[f32]) -> f64 {
    (samples.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / samples.len() as f64).sqrt()
}
fn tone(samples: &[f32], frequency: f64) -> f64 {
    let mut re = 0.0;
    let mut im = 0.0;
    for (n, x) in samples.iter().enumerate() {
        let phase = std::f64::consts::TAU * frequency * n as f64 / 48000.0;
        re += *x as f64 * phase.cos();
        im += *x as f64 * phase.sin();
    }
    2.0 * re.hypot(im) / samples.len() as f64
}

#[test]
fn defaults_are_audible_and_reset_is_reproducible() {
    for method in 39..=46 {
        let p = defaults(method);
        let mut engine = NewMethods::new(48000.0);
        let mut first = Vec::new();
        for pass in 0..2 {
            engine.reset();
            engine.note_on(method, 220.0, 0.8, &p);
            let samples: Vec<_> = (0..24000)
                .map(|_| engine.next(method, 220.0, &p, true, 0.8))
                .collect();
            assert!(samples.iter().all(|x| x.is_finite()), "method {method}");
            assert!(rms(&samples) > 0.0001, "silent method {method}");
            if pass == 0 {
                first = samples;
            } else {
                assert_eq!(first, samples, "reset {method}");
            }
        }
    }
}

#[test]
fn controls_change_the_mechanism_with_dependencies_active() {
    for method in 39..=46 {
        let count = if method == 44 || method == 45 { 10 } else { 8 };
        for slot in 0..count {
            let mut p = defaults(method);
            if method == 39 {
                p[1] = 1.0;
                p[0] = 3.5 / 31.0;
            }
            if method == 40 {
                p[0] = 0.58;
            }
            if method == 42 {
                p[6] = 0.65;
            }
            if method == 43 {
                p[5] = 0.4;
            }
            if method == 44 {
                p[2] = 0.31;
                p[3] = 0.62;
            }
            if method == 45 {
                p[0] = 0.25;
                p[1] = 0.8;
            }
            p[slot] = 0.2;
            let a = render(method, &p, 24000);
            p[slot] = 0.8;
            let b = render(method, &p, 24000);
            let error = a
                .iter()
                .zip(&b)
                .map(|(a, b)| (*a as f64 - *b as f64).powi(2))
                .sum::<f64>()
                / a.len() as f64;
            assert!(
                error > 1e-13,
                "inactive method {method} slot {slot}: {error}"
            );
        }
    }
}

#[test]
fn ssb_translates_each_partial_by_an_additive_offset() {
    let mut p = defaults(40);
    p[0] = (137.0 + 4000.0) / 8000.0;
    p[3] = 1.0 / 31.0;
    p[4] = 0.0;
    let upper = render(40, &p, 48000);
    assert!(tone(&upper, 357.0) > 0.3);
    assert!(tone(&upper, 577.0) > 0.3);
    assert!(tone(&upper, 714.0) < 0.002, "pitch scaling appeared");
    assert!(tone(&upper, 83.0) < 0.002, "opposite sideband leaked");
    p[2] = 1.0;
    let lower = render(40, &p, 48000);
    assert!(tone(&lower, 83.0) > 0.3 && tone(&lower, 303.0) > 0.3);
    assert!(tone(&lower, 357.0) < 0.002);
}

#[test]
fn sync_blep_corrects_a_fractional_discontinuity() {
    let mut before = 0.0;
    let mut after = 0.0;
    Sync::event(0.25, -2.0, &mut before, &mut after);
    assert!((before + 0.5625).abs() < 1e-7);
    assert!((after - 0.0625).abs() < 1e-7);
    let mut p = defaults(39);
    p[0] = 5.3 / 31.0;
    let corrected = render(39, &p, 4096);
    p[7] = 0.0;
    let naive = render(39, &p, 4096);
    assert!(corrected
        .iter()
        .zip(&naive)
        .any(|(a, b)| (a - b).abs() > 0.1));
}

#[test]
fn particle_count_changes_collision_statistics() {
    let mut counts = [0; 2];
    for (index, particles) in [0.0, 1.0].iter().enumerate() {
        let mut p = defaults(43);
        p[0] = *particles;
        p[5] = 1.0;
        let mut engine = NewMethods::new(48000.0);
        engine.note_on(43, 220.0, 0.8, &p);
        for _ in 0..48000 {
            engine.next(43, 220.0, &p, true, 0.8);
        }
        counts[index] = engine.shaker.collisions;
    }
    assert!(counts[0] > 0 && counts[1] > counts[0] * 30, "{counts:?}");
}

#[test]
fn membrane_obeys_cfl_and_dissipates_a_strike() {
    for sr in [8000.0, 48000.0, 192000.0] {
        let mut engine = NewMethods::new(sr);
        let mut p = defaults(44);
        p[0] = 1.0;
        p[4] = 1.0;
        p[9] = 1.0;
        engine.note_on(44, 4000.0, 0.8, &p);
        assert!(engine.membrane.lx2 + engine.membrane.ly2 <= 0.490001);
        for _ in 0..sr as usize {
            let x = engine.next(44, 4000.0, &p, false, 0.8);
            assert!(x.is_finite() && x.abs() < 2.0);
        }
        let energy = engine.membrane.current.iter().map(|x| x * x).sum::<f32>();
        assert!(energy < 0.00001, "undamped grid at {sr}: {energy}");
    }
}

#[test]
fn feedback_decay_is_bounded_and_rossler_is_deterministic() {
    let mut p = defaults(45);
    p[0] = 0.2;
    p[1] = 0.35;
    p[2] = 0.0;
    let signal = render(45, &p, 96000);
    assert!(signal.iter().all(|x| x.is_finite() && x.abs() < 4.0));
    assert!(rms(&signal[72000..]) < rms(&signal[1000..24000]) * 0.001);
    let p = defaults(46);
    let mut engine = NewMethods::new(48000.0);
    engine.note_on(46, 220.0, 0.8, &p);
    for _ in 0..96000 {
        assert!(engine.next(46, 220.0, &p, true, 0.8).is_finite());
    }
    assert_eq!(engine.rossler.resets, 0, "classic attractor escaped");
    assert!(engine.rossler.state.iter().all(|v| v.abs() < 64.0));
}

#[test]
fn combined_control_extremes_remain_finite() {
    for method in 39..=46 {
        let count = if method == 44 || method == 45 { 10 } else { 8 };
        for pattern in 0..4 {
            let mut p = [0.0; 16];
            for (i, value) in p.iter_mut().enumerate().take(count) {
                *value = match pattern {
                    0 => 0.0,
                    1 => 1.0,
                    2 => {
                        if i % 2 == 0 {
                            1.0
                        } else {
                            0.0
                        }
                    }
                    _ => {
                        if i % 2 == 0 {
                            0.0
                        } else {
                            1.0
                        }
                    }
                };
            }
            for sr in [8000.0, 48000.0, 192000.0] {
                let mut engine = NewMethods::new(sr);
                engine.note_on(method, 1173.0, 1.0, &p);
                for _ in 0..(sr * 0.12) as usize {
                    let x = engine.next(method, 1173.0, &p, true, 1.0);
                    assert!(
                        x.is_finite() && x.abs() < 32.0,
                        "method {method} pattern {pattern} sr {sr}: {x}"
                    );
                }
            }
        }
    }
}

#[test]
fn noise_exponent_changes_measured_low_to_high_band_power() {
    let mut ratios = [0.0; 2];
    for (index, slope) in [0.25, 0.75].iter().enumerate() {
        let mut p = defaults(42);
        p[0] = *slope;
        let signal = render(42, &p, 96000);
        let mut low = 0.0;
        let mut high_low = 0.0;
        let mut lo_energy = 0.0f64;
        let mut hi_energy = 0.0f64;
        let kl = 1.0 - (-TAU * 200.0 / 48000.0).exp();
        let kh = 1.0 - (-TAU * 3200.0 / 48000.0).exp();
        for (n, x) in signal.iter().enumerate() {
            low += kl * (x - low);
            high_low += kh * (x - high_low);
            if n > 8000 {
                lo_energy += (low as f64).powi(2);
                hi_energy += ((x - high_low) as f64).powi(2);
            }
        }
        ratios[index] = lo_energy / hi_energy;
    }
    assert!(
        ratios[1] > ratios[0] * 30.0,
        "spectral tilt ratios {ratios:?}"
    );
}

#[test]
fn rossler_rotation_preserves_coordinate_energy() {
    let axes = [3.0, -4.0, 2.0];
    for rotation in [0.0, 0.15, 0.25, 0.57, 0.9, 1.0] {
        let projected: [f32; 3] =
            std::array::from_fn(|i| Rossler::project(axes, i as f32 / 2.0, rotation));
        let energy: f32 = projected.iter().map(|x| x * x).sum();
        assert!((energy - 29.0).abs() < 0.00002, "{rotation}: {energy}");
    }
}

#[test]
fn shaker_factory_frequency_is_the_first_resonance() {
    let sr = 48000.0;
    for frequency in [2300.0, 3700.0, 5600.0, 6700.0] {
        let mut engine = NewMethods::new(sr);
        let mut p = defaults(43);
        p[2] = 0.8;
        engine.note_on(43, frequency, 0.8, &p);
        for (i, ratio) in [1.0, 1.37, 1.93, 2.61].iter().enumerate() {
            let hz = engine.shaker.pole_im[i].atan2(engine.shaker.pole_re[i]) * sr / TAU;
            let expected = frequency * lerp(1.0, *ratio, p[2]);
            assert!(
                (hz - expected).abs() < 0.02,
                "mode {i} at {frequency}: {hz}"
            );
            assert!(hz < 16000.0, "factory mode became near-ultrasonic: {hz}");
        }
    }
}

#[test]
fn fdn_storage_limit_preserves_active_delay_ratios() {
    let ratios = [0.719, 0.839, 1.0, 1.113, 1.229, 1.313, 1.421, 1.543];
    for sr in [8000.0, 48000.0, 192000.0] {
        for count in [2, 4, 6, 8] {
            let mut engine = NewMethods::new(sr);
            let mut p = defaults(45);
            p[0] = 1.0;
            p[4] = (count - 2) as f32 / 6.0;
            engine.note_on(45, 61.0, 0.8, &p);
            let longest = engine.fdn.lengths[count - 1];
            assert!(
                (longest - (engine.fdn.capacity - 2) as f32).abs() < 0.02,
                "largest ACTIVE line should use the available storage"
            );
            for i in 0..count {
                assert!(
                    (engine.fdn.lengths[i] / longest - ratios[i] / ratios[count - 1]).abs() < 1e-5,
                    "delay ratio collapsed for {count} lines at {sr}"
                );
                if i > 0 {
                    assert!(engine.fdn.lengths[i] - engine.fdn.lengths[i - 1] > 10.0);
                }
            }
        }
    }
}

#[test]
fn held_noise_bank_keeps_expected_source_power() {
    // Measure the bank before the performer's deliberate cutoff/resonance
    // filters. Its noise-power normalization must account for actual holding,
    // including bright highpass-like bands and dark correlated low bands.
    for (exponent, hold) in [(-0.4, 1), (-0.4, 24), (1.4, 4), (1.4, 64)] {
        let mut engine = NewMethods::new(48000.0);
        let mut p = defaults(42);
        p[0] = (exponent + 2.0) / 4.0;
        p[3] = 1.0; // Binary excitation has exactly the reference variance.
        p[4] = (hold - 1) as f32 / 63.0;
        engine.note_on(42, 220.0, 0.8, &p);
        let mut energy = 0.0_f64;
        let mut frames = 0;
        for n in 0..480000 {
            let output = engine.next(42, 220.0, &p, true, 0.8);
            assert!(output.is_finite());
            if n >= 48000 {
                let bank: f32 = (0..BANDS)
                    .map(|i| {
                        engine.colored.weight[i] * (engine.colored.high[i] - engine.colored.low[i])
                    })
                    .sum();
                energy += (bank as f64 * engine.colored.norm as f64).powi(2);
                frames += 1;
            }
        }
        let rms = (energy / frames as f64).sqrt();
        assert!(
            (0.21..0.29).contains(&rms),
            "incorrect held-source normalization: exponent {exponent}, hold {hold}, RMS {rms}"
        );
    }
}
