//! Stereo external-input DSP bank. All effects process supplied PCM; explicit
//! test sources are available to hosts but source 0 always means real input.
//! No allocation, locking, permission requests or sample-rate changes in process.
use std::f32::consts::{PI, TAU};
pub const PROCESSOR_COUNT: usize = 16;
pub const PARAMETER_COUNT: usize = 16;
pub const FRAMES: usize = 128;
const KNEE: f32 = 0.95;
const CEILING: f32 = 0.999;
pub const METHOD_NAMES: [&str; 16] = [
    "Biquad filter / EQ",
    "State-variable filter",
    "Nonlinear ladder filter",
    "Windowed-sinc FIR filter",
    "Feedback / feedforward comb",
    "Stereo feedback delay",
    "Flanger / chorus",
    "Allpass phaser",
    "Feedback delay network reverb",
    "Antialiased saturation",
    "Bit depth / sample-rate reduction",
    "Compressor",
    "Downward expander / gate",
    "Envelope-following filter",
    "Hilbert frequency shifter",
    "Eight-band vocoder",
];
pub const METHOD_IDS: [&str; 16] = [
    "biquad",
    "svf",
    "ladder",
    "fir",
    "comb",
    "delay",
    "modulated-delay",
    "phaser",
    "reverb",
    "saturation",
    "decimator",
    "compressor",
    "expander",
    "envelope-filter",
    "frequency-shifter",
    "vocoder",
];
pub const DEFAULT_SOURCES: [u32; 16] = [3, 3, 5, 3, 4, 6, 5, 5, 6, 1, 7, 6, 6, 6, 2, 7];
pub const CONTROL_NAMES: [[&str; 16]; 16] = [
    [
        "Response",
        "Frequency",
        "Q",
        "EQ gain",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Cutoff", "Q", "Response", "Drive", "Unused", "Unused", "Unused", "Unused", "Unused",
        "Unused", "Unused", "Unused", "Unused", "Unused", "Unused", "Unused",
    ],
    [
        "Cutoff",
        "Resonance",
        "Drive",
        "Poles",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Response",
        "Frequency",
        "Bandwidth",
        "Window",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Resonance frequency",
        "Feedback",
        "Damping",
        "Feedforward",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Delay",
        "Feedback",
        "Damping",
        "Cross feedback",
        "Stereo offset",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Base delay",
        "Depth",
        "Rate",
        "Feedback",
        "Stereo phase",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Rate", "Sweep", "Center", "Feedback", "Stages", "Unused", "Unused", "Unused", "Unused",
        "Unused", "Unused", "Unused", "Unused", "Unused", "Unused", "Unused",
    ],
    [
        "Size",
        "Decay",
        "Damping",
        "Predelay",
        "Stereo width",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Drive",
        "Curve",
        "Bias",
        "Antialiasing",
        "Tone",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Bits",
        "Sample rate",
        "Dither",
        "Output low-pass",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Threshold",
        "Ratio",
        "Attack",
        "Release",
        "Knee",
        "Makeup",
        "Detector",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Threshold",
        "Ratio",
        "Attack",
        "Release",
        "Maximum reduction",
        "Hold",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Sensitivity",
        "Base frequency",
        "Sweep",
        "Q",
        "Attack",
        "Release",
        "Direction",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Shift",
        "Fine shift",
        "Sideband",
        "Input high-pass",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
    [
        "Carrier frequency",
        "Pulse / saw",
        "Attack",
        "Release",
        "Band Q",
        "Formant scale",
        "Unvoiced carrier",
        "Spectral tilt",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
        "Unused",
    ],
];
pub const DEFAULT_PARAMS: [[f32; 16]; 16] = [
    [
        0.0,
        0.5927170834612145,
        0.24996368669121863,
        0.5,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.5510708379251146,
        0.09995642402946234,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.5132797330870178,
        0.3,
        0.25,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.0,
        0.6353475781823255,
        0.2,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.5206963425791125,
        0.8316326530612245,
        0.7558536095622292,
        0.75,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.6289174995846284,
        0.43478260869565216,
        0.7901107651134204,
        0.7,
        0.26,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.6069119518459338,
        0.2,
        0.43575558719297985,
        0.6388888888888888,
        0.5,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.45198468251128315,
        0.7,
        0.5462100471445852,
        0.676470588235294,
        0.4,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.4444444444444445,
        0.6638243993087611,
        0.6934264036172708,
        0.17999999999999997,
        0.85,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.3333333333333333,
        0.0,
        0.5,
        1.0,
        0.9225490200071285,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.42857142857142855,
        0.7470560676391805,
        0.0,
        0.9515449934959717,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.6,
        0.15789473684210525,
        0.5927170834612145,
        0.5455263544885197,
        0.25,
        0.25,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.6486486486486487,
        0.3333333333333333,
        0.49237375157322083,
        0.46899920821597907,
        0.75,
        0.125,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.625,
        0.31330219572526247,
        0.6,
        0.46275642631951835,
        0.46275642631951835,
        0.5404604490558215,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.52,
        0.5,
        0.0,
        0.17718382013555792,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
    [
        0.39344470356937045,
        0.7,
        0.38907562519182176,
        0.6276362525516529,
        0.21428571428571427,
        0.5,
        0.1,
        0.5,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ],
];
const RANGES: [[(f32, f32, bool); 16]; 16] = [
    [
        (0.0, 7.0, false),
        (20.0, 20000.0, true),
        (0.25, 16.0, true),
        (-24.0, 24.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (20.0, 20000.0, true),
        (0.5, 16.0, true),
        (0.0, 3.0, false),
        (0.0, 18.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (30.0, 18000.0, true),
        (0.0, 1.0, false),
        (0.0, 24.0, false),
        (2.0, 4.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (0.0, 2.0, false),
        (40.0, 16000.0, true),
        (0.25, 4.0, false),
        (0.0, 2.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (20.0, 2000.0, true),
        (-0.98, 0.98, false),
        (200.0, 18000.0, true),
        (-1.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (0.01, 2.0, true),
        (0.0, 0.92, false),
        (200.0, 18000.0, true),
        (0.0, 1.0, false),
        (0.0, 0.5, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (0.0005, 0.03, true),
        (0.0, 0.015, false),
        (0.02, 10.0, true),
        (-0.9, 0.9, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (0.02, 8.0, true),
        (0.0, 1.0, false),
        (100.0, 4000.0, true),
        (-0.85, 0.85, false),
        (2.0, 12.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (0.2, 2.0, false),
        (0.1, 12.0, true),
        (500.0, 18000.0, true),
        (0.0, 0.1, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (0.0, 36.0, false),
        (0.0, 2.0, false),
        (-0.5, 0.5, false),
        (0.0, 1.0, false),
        (200.0, 20000.0, true),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (2.0, 16.0, false),
        (200.0, 48000.0, true),
        (0.0, 1.0, false),
        (200.0, 20000.0, true),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (-60.0, 0.0, false),
        (1.0, 20.0, false),
        (0.0001, 0.1, true),
        (0.01, 2.0, true),
        (0.0, 24.0, false),
        (0.0, 24.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (-80.0, -6.0, false),
        (1.0, 10.0, false),
        (0.0001, 0.1, true),
        (0.01, 2.0, true),
        (0.0, 80.0, false),
        (0.0, 0.2, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (-24.0, 24.0, false),
        (60.0, 2000.0, true),
        (0.0, 5.0, false),
        (0.5, 10.0, true),
        (0.0005, 0.2, true),
        (0.01, 1.5, true),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (-2000.0, 2000.0, false),
        (-10.0, 10.0, false),
        (0.0, 1.0, false),
        (20.0, 1000.0, true),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
    [
        (40.0, 800.0, true),
        (0.0, 1.0, false),
        (0.0005, 0.05, true),
        (0.005, 0.5, true),
        (1.0, 8.0, false),
        (0.5, 2.0, true),
        (0.0, 1.0, false),
        (-1.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
        (0.0, 1.0, false),
    ],
];

fn finite(x: f32, fallback: f32) -> f32 {
    if x.is_finite() {
        x
    } else {
        fallback
    }
}
fn clean(x: f32) -> f32 {
    if x.is_finite() && x.abs() >= 1e-20 {
        x.clamp(-16.0, 16.0)
    } else {
        0.0
    }
}
fn db(x: f32) -> f32 {
    10.0_f32.powf(x / 20.0)
}
fn lp_coefficient(hz: f32, sr: f32) -> f32 {
    1.0 - (-TAU * hz.clamp(1.0, sr * 0.45) / sr).exp()
}
fn protect(x: f32) -> f32 {
    let x = clean(x);
    if x.abs() <= KNEE {
        x
    } else {
        x.signum() * (KNEE + (CEILING - KNEE) * ((x.abs() - KNEE) / (CEILING - KNEE)).tanh())
    }
}
fn map(method: usize, slot: usize, value: f32) -> f32 {
    let (a, b, log) = RANGES[method][slot];
    if log {
        a * (b / a).powf(value)
    } else {
        a + (b - a) * value
    }
}
fn noise(seed: &mut u32) -> f32 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    *seed as f32 / u32::MAX as f32 * 2.0 - 1.0
}

#[derive(Clone, Copy, Default)]
struct Biquad {
    c: [f32; 5],
    z: [f32; 2],
}
impl Biquad {
    fn configure(&mut self, kind: u32, hz: f32, q: f32, gain: f32, sr: f32) {
        let w = TAU * hz.clamp(10.0, sr * 0.45) / sr;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q.max(0.1));
        let a = db(gain * 0.5);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            0 => (
                (1.0 - c) * 0.5,
                1.0 - c,
                (1.0 - c) * 0.5,
                1.0 + alpha,
                -2.0 * c,
                1.0 - alpha,
            ),
            1 => (
                (1.0 + c) * 0.5,
                -(1.0 + c),
                (1.0 + c) * 0.5,
                1.0 + alpha,
                -2.0 * c,
                1.0 - alpha,
            ),
            2 => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            3 => (1.0, -2.0 * c, 1.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            4 => (
                1.0 - alpha,
                -2.0 * c,
                1.0 + alpha,
                1.0 + alpha,
                -2.0 * c,
                1.0 - alpha,
            ),
            5 => (
                1.0 + alpha * a,
                -2.0 * c,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * c,
                1.0 - alpha / a,
            ),
            6 => {
                let t = 2.0 * a.sqrt() * s * std::f32::consts::FRAC_1_SQRT_2;
                (
                    a * ((a + 1.0) - (a - 1.0) * c + t),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * c),
                    a * ((a + 1.0) - (a - 1.0) * c - t),
                    (a + 1.0) + (a - 1.0) * c + t,
                    -2.0 * ((a - 1.0) + (a + 1.0) * c),
                    (a + 1.0) + (a - 1.0) * c - t,
                )
            }
            _ => {
                let t = 2.0 * a.sqrt() * s * std::f32::consts::FRAC_1_SQRT_2;
                (
                    a * ((a + 1.0) + (a - 1.0) * c + t),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * c),
                    a * ((a + 1.0) + (a - 1.0) * c - t),
                    (a + 1.0) - (a - 1.0) * c + t,
                    2.0 * ((a - 1.0) - (a + 1.0) * c),
                    (a + 1.0) - (a - 1.0) * c - t,
                )
            }
        };
        self.c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    }
    fn next(&mut self, x: f32) -> f32 {
        let y = clean(self.c[0] * x + self.z[0]);
        self.z[0] = clean(self.c[1] * x - self.c[3] * y + self.z[1]);
        self.z[1] = clean(self.c[2] * x - self.c[4] * y);
        y
    }
}
#[derive(Clone, Copy, Default)]
struct Svf {
    z1: f32,
    z2: f32,
}
impl Svf {
    fn next(&mut self, x: f32, hz: f32, q: f32, sr: f32) -> [f32; 4] {
        let g = (PI * hz.clamp(10.0, sr * 0.42) / sr).tan();
        let k = 1.0 / q.max(0.25);
        let a = 1.0 / (1.0 + g * (g + k));
        let v1 = a * (self.z1 + g * (x - self.z2));
        let v2 = self.z2 + g * v1;
        self.z1 = clean(2.0 * v1 - self.z1);
        self.z2 = clean(2.0 * v2 - self.z2);
        [v2, v1 * k, x - k * v1 - v2, x - k * v1]
    }
}
#[derive(Clone, Copy, Default)]
struct Allpass {
    z: f32,
}
impl Allpass {
    fn next(&mut self, x: f32, a: f32) -> f32 {
        let y = clean(a * x + self.z);
        self.z = clean(x - a * y);
        y
    }
}

pub struct ProcessorBank {
    sr: f32,
    method: usize,
    params: [f32; 16],
    smooth: [f32; 16],
    transfer: [f32; 16],
    coefficient: f32,
    input: [[f32; FRAMES]; 2],
    output: [[f32; FRAMES]; 2],
    input_peak: [f32; 2],
    output_peak: [f32; 2],
    wet: f32,
    wet_target: f32,
    bypass: f32,
    bypass_target: f32,
    input_gain: f32,
    input_target: f32,
    output_gain: f32,
    output_target: f32,
    source: u32,
    source_frequency: f32,
    source_frequency_target: f32,
    source_active: f32,
    source_target: f32,
    source_clock: u64,
    source_phase: f32,
    source_phase_b: f32,
    source_seed: u32,
    source_low: f32,
    source_last: [f32; 2],
    source_from: [f32; 2],
    source_fade: u32,
    transition_from: [f32; 2],
    transition_left: u32,
    previous: [f32; 2],
    clock: usize,
    biquad: [Biquad; 2],
    svf: [Svf; 2],
    ladder: [[f32; 4]; 2],
    input_previous: [f32; 2],
    history: [[f32; 128]; 2],
    kernel: [f32; 127],
    kernel_target: [f32; 127],
    hilbert: [f32; 63],
    fir_clock: usize,
    delay: Vec<[f32; 2]>,
    delay_clock: usize,
    delay_low: [f32; 2],
    phaser: [[Allpass; 12]; 2],
    feedback: [f32; 2],
    phase: f32,
    reverb: Vec<f32>,
    reverb_stride: usize,
    reverb_clock: usize,
    reverb_low: [f32; 8],
    shaper_previous: [f32; 2],
    shaper_valid: [bool; 2],
    tone: [f32; 2],
    dc_x: [f32; 2],
    dc_y: [f32; 2],
    held: [f32; 2],
    hold_phase: f32,
    noise_seed: u32,
    detector: [f32; 2],
    gain: [f32; 2],
    hold: [u32; 2],
    analysis: [[Svf; 8]; 2],
    carrier: [[Svf; 8]; 2],
    band_env: [[f32; 8]; 2],
    carrier_phase: f32,
}
impl ProcessorBank {
    pub fn new(sample_rate: f32) -> Self {
        let sr = finite(sample_rate, 48000.0).clamp(8000.0, 192000.0);
        let stride = (sr * 0.14).ceil() as usize + 4;
        let mut s = Self {
            sr,
            method: 0,
            params: DEFAULT_PARAMS[0],
            smooth: DEFAULT_PARAMS[0],
            transfer: DEFAULT_PARAMS[0],
            coefficient: 1.0 - (-1.0 / (sr * 0.008)).exp(),
            input: [[0.0; FRAMES]; 2],
            output: [[0.0; FRAMES]; 2],
            input_peak: [0.0; 2],
            output_peak: [0.0; 2],
            wet: 1.0,
            wet_target: 1.0,
            bypass: 0.0,
            bypass_target: 0.0,
            input_gain: 1.0,
            input_target: 1.0,
            output_gain: 1.0,
            output_target: 1.0,
            source: 0,
            source_frequency: 220.0,
            source_frequency_target: 220.0,
            source_active: 0.0,
            source_target: 0.0,
            source_clock: 0,
            source_phase: 0.0,
            source_phase_b: 0.0,
            source_seed: 0x9183ab,
            source_low: 0.0,
            source_last: [0.0; 2],
            source_from: [0.0; 2],
            source_fade: 0,
            transition_from: [0.0; 2],
            transition_left: 0,
            previous: [0.0; 2],
            clock: 0,
            biquad: [Biquad::default(); 2],
            svf: [Svf::default(); 2],
            ladder: [[0.0; 4]; 2],
            input_previous: [0.0; 2],
            history: [[0.0; 128]; 2],
            kernel: [0.0; 127],
            kernel_target: [0.0; 127],
            hilbert: [0.0; 63],
            fir_clock: 0,
            delay: vec![[0.0; 2]; (sr * 3.0).ceil() as usize + 4],
            delay_clock: 0,
            delay_low: [0.0; 2],
            phaser: [[Allpass::default(); 12]; 2],
            feedback: [0.0; 2],
            phase: 0.0,
            reverb: vec![0.0; stride * 8],
            reverb_stride: stride,
            reverb_clock: 0,
            reverb_low: [0.0; 8],
            shaper_previous: [0.0; 2],
            shaper_valid: [false; 2],
            tone: [0.0; 2],
            dc_x: [0.0; 2],
            dc_y: [0.0; 2],
            held: [0.0; 2],
            hold_phase: 0.0,
            noise_seed: 0x851938,
            detector: [0.0; 2],
            gain: [1.0; 2],
            hold: [0; 2],
            analysis: [[Svf::default(); 8]; 2],
            carrier: [[Svf::default(); 8]; 2],
            band_env: [[0.0; 8]; 2],
            carrier_phase: 0.0,
        };
        for i in 0..63 {
            let k = i as i32 - 31;
            let w = 0.42 - 0.5 * (TAU * i as f32 / 62.0).cos()
                + 0.08 * (2.0 * TAU * i as f32 / 62.0).cos();
            s.hilbert[i] = if k % 2 != 0 {
                2.0 / (PI * k as f32) * w
            } else {
                0.0
            };
        }
        s.prepare_fir();
        s
    }
    pub fn sample_rate(&self) -> f32 {
        self.sr
    }
    pub fn method(&self) -> usize {
        self.method
    }
    pub fn input_mut(&mut self, channel: usize) -> &mut [f32; FRAMES] {
        &mut self.input[channel.min(1)]
    }
    pub fn output(&self, channel: usize) -> &[f32; FRAMES] {
        &self.output[channel.min(1)]
    }
    pub fn set_method(&mut self, method: usize) {
        let m = method.min(PROCESSOR_COUNT - 1);
        if m == self.method {
            return;
        }
        let previous = self.previous;
        self.reset_effects();
        self.method = m;
        self.params = DEFAULT_PARAMS[m];
        self.smooth = self.params;
        self.transition_from = previous;
        self.transition_left = (self.sr * 0.008) as u32;
        self.prepare_fir();
        self.kernel = self.kernel_target;
    }
    pub fn set_params(&mut self, params: [f32; 16]) {
        for (i, p) in params.iter().enumerate() {
            self.params[i] = finite(*p, DEFAULT_PARAMS[self.method][i]).clamp(0.0, 1.0);
        }
        if self.source_active < 1e-6 {
            self.smooth = self.params;
        }
        if self.method == 3 {
            self.prepare_fir();
        }
    }
    pub fn set_mix(&mut self, wet: f32, bypass: bool, input_db: f32, output_db: f32) {
        self.wet_target = finite(wet, 1.0).clamp(0.0, 1.0);
        self.bypass_target = if bypass { 1.0 } else { 0.0 };
        self.input_target = db(finite(input_db, 0.0).clamp(-36.0, 24.0));
        self.output_target = db(finite(output_db, 0.0).clamp(-36.0, 24.0));
        if self.source_active < 1e-6 {
            self.wet = self.wet_target;
            self.bypass = self.bypass_target;
            self.input_gain = self.input_target;
            self.output_gain = self.output_target;
        }
    }
    pub fn set_source(&mut self, source: u32, frequency: f32, active: bool) {
        let source = source.min(7);
        if source != self.source {
            self.source_from = self.source_last;
            self.source_fade = (self.sr * 0.005) as u32;
            self.source = source;
            self.source_clock = 0;
            self.source_phase = 0.0;
            self.source_phase_b = 0.0;
            self.source_seed = 0x9183ab;
            self.source_low = 0.0;
        }
        self.source_frequency_target =
            finite(frequency, 220.0).clamp(20.0, (self.sr * 0.2).min(8000.0));
        self.source_target = if active { 1.0 } else { 0.0 };
    }
    pub fn reset(&mut self) {
        self.reset_effects();
        self.smooth = self.params;
        self.wet = self.wet_target;
        self.bypass = self.bypass_target;
        self.input_gain = self.input_target;
        self.output_gain = self.output_target;
        self.source_active = self.source_target;
        self.source_frequency = self.source_frequency_target;
        self.source_clock = 0;
        self.source_phase = 0.0;
        self.source_phase_b = 0.0;
        self.source_seed = 0x9183ab;
        self.source_low = 0.0;
        self.source_last = [0.0; 2];
        self.source_from = [0.0; 2];
        self.source_fade = 0;
        self.transition_left = 0;
        self.previous = [0.0; 2];
        self.input = [[0.0; FRAMES]; 2];
        self.output = [[0.0; FRAMES]; 2];
        self.input_peak = [0.0; 2];
        self.output_peak = [0.0; 2];
        self.prepare_fir();
        self.kernel = self.kernel_target;
    }
    fn reset_effects(&mut self) {
        self.biquad = [Biquad::default(); 2];
        self.svf = [Svf::default(); 2];
        self.ladder = [[0.0; 4]; 2];
        self.input_previous = [0.0; 2];
        self.history = [[0.0; 128]; 2];
        self.fir_clock = 0;
        self.delay.fill([0.0; 2]);
        self.delay_clock = 0;
        self.delay_low = [0.0; 2];
        self.phaser = [[Allpass::default(); 12]; 2];
        self.feedback = [0.0; 2];
        self.phase = 0.0;
        self.reverb.fill(0.0);
        self.reverb_clock = 0;
        self.reverb_low = [0.0; 8];
        self.shaper_previous = [0.0; 2];
        self.shaper_valid = [false; 2];
        self.tone = [0.0; 2];
        self.dc_x = [0.0; 2];
        self.dc_y = [0.0; 2];
        self.held = [0.0; 2];
        self.hold_phase = 0.0;
        self.noise_seed = 0x851938;
        self.detector = [0.0; 2];
        self.gain = [1.0; 2];
        self.hold = [0; 2];
        self.analysis = [[Svf::default(); 8]; 2];
        self.carrier = [[Svf::default(); 8]; 2];
        self.band_env = [[0.0; 8]; 2];
        self.carrier_phase = 0.0;
        self.clock = 0;
    }
    fn prepare_fir(&mut self) {
        let kind = map(3, 0, self.params[0]).round() as u32;
        let hz = map(3, 1, self.params[1]).min(self.sr * 0.42);
        let band = map(3, 2, self.params[2]);
        let window = map(3, 3, self.params[3]).round() as u32;
        let low = (hz * 2.0_f32.powf(-band * 0.5)).clamp(5.0, self.sr * 0.42);
        let high = (hz * 2.0_f32.powf(band * 0.5)).clamp(10.0, self.sr * 0.45);
        let mut sum = 0.0;
        for i in 0..127 {
            let n = i as i32 - 63;
            let x = TAU * i as f32 / 126.0;
            let w = match window {
                0 => 0.5 - 0.5 * x.cos(),
                1 => 0.54 - 0.46 * x.cos(),
                _ => 0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos(),
            };
            let sinc = |f: f32| {
                if n == 0 {
                    2.0 * f / self.sr
                } else {
                    (TAU * f * n as f32 / self.sr).sin() / (PI * n as f32)
                }
            };
            self.kernel_target[i] = if kind == 2 {
                (sinc(high) - sinc(low)) * w
            } else {
                sinc(hz) * w
            };
            sum += self.kernel_target[i];
        }
        if kind < 2 {
            for x in &mut self.kernel_target {
                *x /= sum.max(1e-8);
                if kind == 1 {
                    *x = -*x;
                }
            }
            if kind == 1 {
                self.kernel_target[63] += 1.0;
            }
        }
        if self.source_active < 1e-6 {
            self.kernel = self.kernel_target;
        }
    }
    fn delay_read(&self, frames: f32, channel: usize) -> f32 {
        let n = self.delay.len();
        let frames = frames.clamp(1.0, (n - 2) as f32);
        let whole = frames as usize;
        let f = frames - whole as f32;
        let a = (self.delay_clock + n - whole) % n;
        let b = (a + n - 1) % n;
        self.delay[a][channel] * (1.0 - f) + self.delay[b][channel] * f
    }
    fn source_sample(&mut self, external: [f32; 2]) -> [f32; 2] {
        self.source_frequency +=
            (self.source_frequency_target - self.source_frequency) * self.coefficient;
        let phase = self.source_phase;
        let time = self.source_clock as f32 / self.sr;
        let n = noise(&mut self.source_seed);
        let v = match self.source {
            0 => 0.0,
            1 => (TAU * phase).sin() * 0.25,
            2 => ((TAU * phase).sin() + (TAU * self.source_phase_b).sin()) * 0.15,
            3 => {
                self.source_low += (n - self.source_low) * 0.025;
                (n * 0.65 + self.source_low * 1.8) * 0.22
            }
            4 => {
                if self.source_clock % (self.sr * 0.5) as u64 == 0 {
                    0.55
                } else {
                    0.0
                }
            }
            5 => ((phase * 2.0 - 1.0) * 0.6 + if phase < 0.35 { 0.4 } else { -0.4 }) * 0.24,
            6 => {
                let beat = (time * 4.0).floor() as u32;
                let t = time % 0.25;
                let velocity = if beat % 4 == 0 {
                    1.0
                } else if beat % 2 == 0 {
                    0.65
                } else {
                    0.3
                };
                let drum = if beat % 4 == 0 {
                    (TAU * (65.0 * t + 14.0 * (1.0 - (-35.0 * t).exp()))).sin() * (-22.0 * t).exp()
                } else {
                    n * (-45.0 * t).exp() * 0.65
                        + (TAU * 180.0 * t).sin() * (-28.0 * t).exp() * 0.35
                };
                drum * velocity * 0.55
            }
            _ => {
                let syllable = (time * 0.8).sin().max(0.0) * 0.8 + 0.2;
                let mut voice = 0.0;
                for h in 1..=16 {
                    let hz = h as f32 * self.source_frequency;
                    let center = 650.0 + 450.0 * (time * 0.9).sin();
                    let formant = (-((hz - center) / 280.0).powi(2)).exp()
                        + 0.5 * (-((hz - 1700.0) / 400.0).powi(2)).exp();
                    voice += (TAU * phase * h as f32).sin() * (0.04 + formant) / h as f32;
                }
                voice * syllable * 0.32
            }
        };
        self.source_phase = (phase + self.source_frequency / self.sr).fract();
        self.source_phase_b = (self.source_phase_b + self.source_frequency * 1.5 / self.sr).fract();
        self.source_clock = self.source_clock.wrapping_add(1);
        let mut out = if self.source == 0 { external } else { [v, v] };
        if self.source_fade > 0 {
            let a = self.source_fade as f32 / (self.sr * 0.005);
            for (c, x) in out.iter_mut().enumerate() {
                *x = self.source_from[c] * a + *x * (1.0 - a);
            }
            self.source_fade -= 1;
        }
        self.source_last = out;
        out
    }
    fn effect(&mut self, x: [f32; 2]) -> [f32; 2] {
        let p: [f32; 16] = std::array::from_fn(|i| map(self.method, i, self.smooth[i]));
        let mut out = [0.0; 2];
        match self.method {
            0 => {
                if self.clock % 16 == 0 {
                    for b in &mut self.biquad {
                        b.configure(p[0].round() as u32, p[1], p[2], p[3], self.sr);
                    }
                }
                for c in 0..2 {
                    out[c] = self.biquad[c].next(x[c]);
                }
            }
            1 => {
                let mode = p[2].round().clamp(0.0, 3.0) as usize;
                let drive = db(p[3]);
                for c in 0..2 {
                    let input = if p[3] > 0.01 {
                        (x[c] * drive).tanh() / drive.sqrt()
                    } else {
                        x[c]
                    };
                    out[c] = self.svf[c].next(input, p[0], p[1], self.sr)[mode];
                }
            }
            2 => {
                let drive = db(p[2]);
                let a = lp_coefficient(p[0], self.sr * 4.0);
                for c in 0..2 {
                    for sub in 0..4 {
                        let u = self.input_previous[c]
                            + (x[c] - self.input_previous[c]) * (sub + 1) as f32 * 0.25;
                        let mut stage = (u * drive - self.ladder[c][3] * p[1] * 3.95).tanh();
                        for z in &mut self.ladder[c] {
                            *z = clean(*z + a * (stage - z.tanh()));
                            stage = *z;
                        }
                    }
                    self.input_previous[c] = x[c];
                    out[c] = self.ladder[c][if p[3] < 3.0 { 1 } else { 3 }] / drive.sqrt();
                }
            }
            3 => {
                // FIR coefficient interpolation stays stable and avoids a
                // sudden waveform step when cutoff/window controls move.
                for k in 0..127 {
                    self.kernel[k] += (self.kernel_target[k] - self.kernel[k]) * self.coefficient;
                }
                for c in 0..2 {
                    self.history[c][self.fir_clock] = x[c];
                    for k in 0..127 {
                        out[c] +=
                            self.kernel[k] * self.history[c][(self.fir_clock + 128 - k) % 128];
                    }
                }
                self.fir_clock = (self.fir_clock + 1) % 128;
            }
            4 => {
                let a = lp_coefficient(p[2], self.sr);
                for c in 0..2 {
                    let delayed = self.delay_read(self.sr / p[0], c);
                    self.delay_low[c] =
                        clean(self.delay_low[c] + a * (delayed - self.delay_low[c]));
                    self.delay[self.delay_clock][c] = clean(x[c] + p[1] * self.delay_low[c]);
                    out[c] = (x[c] + p[3] * delayed) * 0.7;
                }
                self.delay_clock = (self.delay_clock + 1) % self.delay.len();
            }
            5 => {
                let a = lp_coefficient(p[2], self.sr);
                for c in 0..2 {
                    out[c] = self
                        .delay_read(self.sr * p[0] * (1.0 + if c == 1 { p[4] } else { 0.0 }), c);
                    self.delay_low[c] = clean(self.delay_low[c] + a * (out[c] - self.delay_low[c]));
                }
                for c in 0..2 {
                    self.delay[self.delay_clock][c] = clean(
                        x[c] + p[1]
                            * (self.delay_low[c] * (1.0 - p[3]) + self.delay_low[1 - c] * p[3]),
                    );
                }
                self.delay_clock = (self.delay_clock + 1) % self.delay.len();
            }
            6 => {
                for c in 0..2 {
                    let lfo = (TAU * (self.phase + c as f32 * p[4])).sin();
                    let seconds = (p[0] + p[1] * lfo).max(0.0001);
                    out[c] = self.delay_read(seconds * self.sr, c);
                    self.delay[self.delay_clock][c] = clean(x[c] + out[c] * p[3]);
                }
                self.delay_clock = (self.delay_clock + 1) % self.delay.len();
                self.phase = (self.phase + p[2] / self.sr).fract();
            }
            7 => {
                let count = p[4].round().clamp(2.0, 12.0) as usize;
                for c in 0..2 {
                    let lfo = (TAU * (self.phase + c as f32 * 0.25)).sin();
                    let mut y = x[c] + self.feedback[c] * p[3];
                    for i in 0..count {
                        let hz = (p[2]
                            * 2.0_f32
                                .powf(lfo * p[1] * 2.0 + (i as f32 / count as f32 - 0.5) * 1.3))
                        .clamp(30.0, self.sr * 0.4);
                        let g = (PI * hz / self.sr).tan();
                        y = self.phaser[c][i].next(y, (g - 1.0) / (g + 1.0));
                    }
                    self.feedback[c] = clean(y);
                    out[c] = y;
                }
                self.phase = (self.phase + p[0] / self.sr).fract();
            }
            8 => {
                const TIMES: [f32; 8] = [
                    0.0297, 0.0371, 0.0411, 0.0437, 0.0503, 0.0561, 0.0617, 0.0673,
                ];
                let a = lp_coefficient(p[2], self.sr);
                let mut taps = [0.0; 8];
                let mut gains = [0.0; 8];
                let mut delayed_input = [0.0; 2];
                for c in 0..2 {
                    delayed_input[c] = if p[3] * self.sr >= 1.0 {
                        self.delay_read(p[3] * self.sr, c)
                    } else {
                        x[c]
                    };
                    self.delay[self.delay_clock][c] = x[c];
                }
                self.delay_clock = (self.delay_clock + 1) % self.delay.len();
                for i in 0..8 {
                    let length = (TIMES[i] * p[0] * self.sr)
                        .round()
                        .clamp(1.0, (self.reverb_stride - 1) as f32)
                        as usize;
                    let read =
                        (self.reverb_clock + self.reverb_stride - length) % self.reverb_stride;
                    let value = self.reverb[i * self.reverb_stride + read];
                    self.reverb_low[i] =
                        clean(self.reverb_low[i] + a * (value - self.reverb_low[i]));
                    taps[i] = self.reverb_low[i];
                    gains[i] = (-6.907755 * length as f32 / (self.sr * p[1])).exp();
                }
                let mut matrix = taps;
                for width in [1, 2, 4] {
                    for start in (0..8).step_by(width * 2) {
                        for j in 0..width {
                            let a = matrix[start + j];
                            let b = matrix[start + j + width];
                            matrix[start + j] = a + b;
                            matrix[start + j + width] = a - b;
                        }
                    }
                }
                for i in 0..8 {
                    let excitation = delayed_input[i % 2] * if i % 4 < 2 { 0.3 } else { -0.3 };
                    self.reverb[i * self.reverb_stride + self.reverb_clock] =
                        clean(excitation + matrix[i] * 0.3535534 * gains[i]);
                }
                let l = (taps[0] + taps[2] - taps[4] + taps[6]) * 0.5;
                let r = (taps[1] - taps[3] + taps[5] + taps[7]) * 0.5;
                let mid = (l + r) * 0.5;
                out = [mid + (l - mid) * p[4], mid + (r - mid) * p[4]];
                self.reverb_clock = (self.reverb_clock + 1) % self.reverb_stride;
            }
            9 => {
                let drive = db(p[0]);
                let shape = p[1].round() as u32;
                let a = lp_coefficient(p[4], self.sr);
                let dc = (-TAU * 8.0 / self.sr).exp();
                for c in 0..2 {
                    let u = x[c] * drive + p[2];
                    let delta = u - self.shaper_previous[c];
                    let y = if p[3] >= 0.5 && self.shaper_valid[c] {
                        if delta.abs() > 1e-4 {
                            (primitive(u, shape) - primitive(self.shaper_previous[c], shape))
                                / delta
                        } else {
                            curve((u + self.shaper_previous[c]) * 0.5, shape)
                        }
                    } else {
                        curve(u, shape)
                    };
                    self.shaper_previous[c] = u;
                    self.shaper_valid[c] = true;
                    self.tone[c] = clean(self.tone[c] + a * (y - self.tone[c]));
                    let hp = self.tone[c] - self.dc_x[c] + dc * self.dc_y[c];
                    self.dc_x[c] = self.tone[c];
                    self.dc_y[c] = clean(hp);
                    out[c] = hp;
                }
            }
            10 => {
                self.hold_phase += p[1].min(self.sr) / self.sr;
                let update = self.hold_phase >= 1.0;
                if update {
                    self.hold_phase -= 1.0;
                }
                let steps = 2.0_f32.powf(p[0].round() - 1.0);
                let a = lp_coefficient(p[3], self.sr);
                for c in 0..2 {
                    if update {
                        let d = (noise(&mut self.noise_seed) + noise(&mut self.noise_seed))
                            * p[2]
                            * 0.5
                            / steps;
                        self.held[c] =
                            ((x[c] + d) * steps).round().clamp(-steps, steps - 1.0) / steps;
                    }
                    self.tone[c] = clean(self.tone[c] + a * (self.held[c] - self.tone[c]));
                    out[c] = self.tone[c];
                }
            }
            11 => {
                for c in 0..2 {
                    let level = if p[6] >= 0.5 { x[c] * x[c] } else { x[c].abs() };
                    let a = 1.0
                        - (-1.0 / (self.sr * if level > self.detector[c] { p[2] } else { p[3] }))
                            .exp();
                    self.detector[c] = clean(self.detector[c] + a * (level - self.detector[c]));
                    let e = if p[6] >= 0.5 {
                        self.detector[c].max(0.0).sqrt()
                    } else {
                        self.detector[c]
                    };
                    let over = 20.0 * e.max(1e-9).log10() - p[0];
                    let reduce = if p[4] > 0.001 && over.abs() < p[4] * 0.5 {
                        (1.0 - 1.0 / p[1]) * (over + p[4] * 0.5).powi(2) / (2.0 * p[4])
                    } else {
                        (1.0 - 1.0 / p[1]) * over.max(0.0)
                    };
                    out[c] = x[c] * db(p[5] - reduce);
                }
            }
            12 => {
                for c in 0..2 {
                    let level = x[c].abs();
                    let a = 1.0 - (-1.0 / (self.sr * 0.003)).exp();
                    self.detector[c] = clean(self.detector[c] + a * (level - self.detector[c]));
                    let below = p[0] - 20.0 * self.detector[c].max(1e-9).log10();
                    if below < 0.0 {
                        self.hold[c] = (p[5] * self.sr) as u32;
                    } else {
                        self.hold[c] = self.hold[c].saturating_sub(1);
                    }
                    let target = if self.hold[c] > 0 {
                        1.0
                    } else {
                        db(-((p[1] - 1.0) * below.max(0.0)).min(p[4]))
                    };
                    let a = 1.0
                        - (-1.0 / (self.sr * if target > self.gain[c] { p[2] } else { p[3] }))
                            .exp();
                    self.gain[c] += a * (target - self.gain[c]);
                    out[c] = x[c] * self.gain[c];
                }
            }
            13 => {
                for c in 0..2 {
                    let level = x[c].abs() * db(p[0]);
                    let a = 1.0
                        - (-1.0 / (self.sr * if level > self.detector[c] { p[4] } else { p[5] }))
                            .exp();
                    self.detector[c] = clean(self.detector[c] + a * (level - self.detector[c]));
                    let amount = self.detector[c].clamp(0.0, 1.0);
                    let exponent = if p[6] < 0.5 { amount } else { 1.0 - amount };
                    let hz = p[1] * 2.0_f32.powf(p[2] * exponent);
                    out[c] = self.svf[c].next(x[c], hz, p[3], self.sr)[0];
                }
            }
            14 => {
                let dc = (-TAU * p[3].min(self.sr * 0.2) / self.sr).exp();
                let (sin, cos) = (TAU * self.phase).sin_cos();
                for c in 0..2 {
                    let hp = x[c] - self.dc_x[c] + dc * self.dc_y[c];
                    self.dc_x[c] = x[c];
                    self.dc_y[c] = clean(hp);
                    self.history[c][self.fir_clock] = hp;
                    let real = self.history[c][(self.fir_clock + 128 - 31) % 128];
                    let mut imaginary = 0.0;
                    for k in 0..63 {
                        imaginary +=
                            self.hilbert[k] * self.history[c][(self.fir_clock + 128 - k) % 128];
                    }
                    out[c] = real * cos + imaginary * sin * if p[2] < 0.5 { -1.0 } else { 1.0 };
                }
                self.fir_clock = (self.fir_clock + 1) % 128;
                self.phase = (self.phase + (p[0] + p[1]) / self.sr).rem_euclid(1.0);
            }
            _ => {
                let phase = self.carrier_phase;
                let saw = phase * 2.0 - 1.0;
                let pulse = if phase < 0.5 { 1.0 } else { -1.0 };
                let carrier = (pulse * (1.0 - p[1]) + saw * p[1]) * 0.55;
                let breath = noise(&mut self.noise_seed) * p[6] * 0.35;
                for c in 0..2 {
                    for band in 0..8 {
                        let hz = 100.0 * 1.78_f32.powi(band as i32);
                        let analysis =
                            self.analysis[c][band].next(x[c], hz, p[4], self.sr)[1].abs();
                        let a = 1.0
                            - (-1.0
                                / (self.sr
                                    * if analysis > self.band_env[c][band] {
                                        p[2]
                                    } else {
                                        p[3]
                                    }))
                            .exp();
                        self.band_env[c][band] =
                            clean(self.band_env[c][band] + a * (analysis - self.band_env[c][band]));
                        let color =
                            self.carrier[c][band].next(carrier + breath, hz * p[5], p[4], self.sr)
                                [1];
                        out[c] +=
                            color * self.band_env[c][band] * db(p[7] * (band as f32 - 3.5) * 2.0);
                    }
                    out[c] *= 4.0;
                }
                self.carrier_phase = (phase + p[0] / self.sr).fract();
            }
        }
        out.map(clean)
    }
    /// Process at most 128 planar stereo frames. Hosts overwrite both inputs
    /// each call (duplicate mono or zero-fill absent channels). Outputs are
    /// unity-scaled processing results, independent of synthesis note gates.
    pub fn process(&mut self, frames: usize) -> usize {
        if frames > FRAMES {
            return 0;
        }
        self.input_peak = [0.0; 2];
        self.output_peak = [0.0; 2];
        for i in 0..frames {
            for j in 0..16 {
                self.smooth[j] += (self.params[j] - self.smooth[j]) * self.coefficient;
            }
            self.wet += (self.wet_target - self.wet) * self.coefficient;
            self.bypass += (self.bypass_target - self.bypass) * self.coefficient;
            self.input_gain += (self.input_target - self.input_gain) * self.coefficient;
            self.output_gain += (self.output_target - self.output_gain) * self.coefficient;
            let gate_a = 1.0 - (-1.0 / (self.sr * 0.005)).exp();
            self.source_active += (self.source_target - self.source_active) * gate_a;
            if self.source_target == 0.0 && self.source_active < 1e-8 {
                self.source_active = 0.0;
            }
            let source = self.source_sample([
                finite(self.input[0][i], 0.0).clamp(-4.0, 4.0),
                finite(self.input[1][i], 0.0).clamp(-4.0, 4.0),
            ]);
            let dry = source.map(|v| v * self.source_active);
            let input = dry.map(|v| clean(v * self.input_gain));
            let wet = self.effect(input);
            let mut result = [0.0; 2];
            for c in 0..2 {
                let mixed = (input[c] * (1.0 - self.wet) + wet[c] * self.wet) * self.output_gain;
                result[c] = mixed * (1.0 - self.bypass) + dry[c] * self.bypass;
                self.input_peak[c] = self.input_peak[c].max(input[c].abs());
            }
            if self.transition_left > 0 {
                let a = self.transition_left as f32 / (self.sr * 0.008);
                for c in 0..2 {
                    result[c] = self.transition_from[c] * a + result[c] * (1.0 - a);
                }
                self.transition_left -= 1;
            }
            for c in 0..2 {
                self.previous[c] = clean(result[c]);
                self.output[c][i] = protect(result[c]);
                self.output_peak[c] = self.output_peak[c].max(self.output[c][i].abs());
            }
            self.clock = self.clock.wrapping_add(1);
        }
        frames
    }
}
fn curve(x: f32, shape: u32) -> f32 {
    match shape {
        0 => x.tanh(),
        1 => x.clamp(-1.0, 1.0),
        _ => {
            let v = x.clamp(-1.0, 1.0);
            v - v * v * v / 3.0
        }
    }
}
fn primitive(x: f32, shape: u32) -> f32 {
    match shape {
        0 => {
            let a = x.abs();
            a + (-2.0 * a).exp().ln_1p() - std::f32::consts::LN_2
        }
        1 => {
            if x.abs() <= 1.0 {
                x * x * 0.5
            } else {
                x.abs() - 0.5
            }
        }
        _ => {
            if x.abs() <= 1.0 {
                x * x * 0.5 - x.powi(4) / 12.0
            } else {
                x.abs() * 2.0 / 3.0 - 0.25
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn proc_method_count() -> u32 {
    PROCESSOR_COUNT as u32
}
#[no_mangle]
pub extern "C" fn proc_param_count() -> u32 {
    16
}
#[no_mangle]
pub extern "C" fn proc_new(sr: f32) -> *mut ProcessorBank {
    Box::into_raw(Box::new(ProcessorBank::new(sr)))
}
#[no_mangle]
pub unsafe extern "C" fn proc_free(ptr: *mut ProcessorBank) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}
#[no_mangle]
pub unsafe extern "C" fn proc_params_ptr(ptr: *mut ProcessorBank) -> *mut f32 {
    ptr.as_mut()
        .map_or(std::ptr::null_mut(), |p| p.transfer.as_mut_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn proc_apply_params(ptr: *mut ProcessorBank) {
    if let Some(p) = ptr.as_mut() {
        p.set_params(p.transfer);
    }
}
#[no_mangle]
pub unsafe extern "C" fn proc_set_method(ptr: *mut ProcessorBank, method: u32) {
    if let Some(p) = ptr.as_mut() {
        p.set_method(method as usize);
    }
}
#[no_mangle]
pub unsafe extern "C" fn proc_input_ptr(ptr: *mut ProcessorBank, channel: u32) -> *mut f32 {
    if channel > 1 {
        return std::ptr::null_mut();
    }
    ptr.as_mut().map_or(std::ptr::null_mut(), |p| {
        p.input[channel as usize].as_mut_ptr()
    })
}
#[no_mangle]
pub unsafe extern "C" fn proc_output_ptr(ptr: *mut ProcessorBank, channel: u32) -> *const f32 {
    if channel > 1 {
        return std::ptr::null();
    }
    ptr.as_ref()
        .map_or(std::ptr::null(), |p| p.output[channel as usize].as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn proc_process(ptr: *mut ProcessorBank, frames: u32) -> u32 {
    ptr.as_mut()
        .map_or(0, |p| p.process(frames as usize) as u32)
}
#[no_mangle]
pub unsafe extern "C" fn proc_reset(ptr: *mut ProcessorBank) {
    if let Some(p) = ptr.as_mut() {
        p.reset();
    }
}
#[no_mangle]
pub unsafe extern "C" fn proc_set_mix(
    ptr: *mut ProcessorBank,
    wet: f32,
    bypass: u32,
    input_db: f32,
    output_db: f32,
) {
    if let Some(p) = ptr.as_mut() {
        p.set_mix(wet, bypass != 0, input_db, output_db);
    }
}
#[no_mangle]
pub unsafe extern "C" fn proc_set_source(
    ptr: *mut ProcessorBank,
    source: u32,
    frequency: f32,
    active: u32,
) {
    if let Some(p) = ptr.as_mut() {
        p.set_source(source, frequency, active != 0);
    }
}
#[no_mangle]
pub unsafe extern "C" fn proc_input_peak(ptr: *const ProcessorBank, channel: u32) -> f32 {
    ptr.as_ref()
        .map_or(0.0, |p| p.input_peak[channel.min(1) as usize])
}
#[no_mangle]
pub unsafe extern "C" fn proc_output_peak(ptr: *const ProcessorBank, channel: u32) -> f32 {
    ptr.as_ref()
        .map_or(0.0, |p| p.output_peak[channel.min(1) as usize])
}

#[cfg(test)]
mod tests {
    use super::*;
    fn norm(method: usize, slot: usize, value: f32) -> f32 {
        let (a, b, log) = RANGES[method][slot];
        if log {
            (value / a).ln() / (b / a).ln()
        } else {
            (value - a) / (b - a)
        }
    }
    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }
    fn render(
        bank: &mut ProcessorBank,
        count: usize,
        mut input: impl FnMut(usize) -> [f32; 2],
    ) -> Vec<[f32; 2]> {
        let mut output = Vec::with_capacity(count);
        let mut cursor = 0;
        while cursor < count {
            let n = (count - cursor).min(FRAMES);
            for i in 0..n {
                let v = input(cursor + i);
                bank.input[0][i] = v[0];
                bank.input[1][i] = v[1];
            }
            assert_eq!(bank.process(n), n);
            for i in 0..n {
                output.push([bank.output[0][i], bank.output[1][i]]);
            }
            cursor += n;
        }
        output
    }
    fn configured(method: usize, sr: f32) -> ProcessorBank {
        let mut p = ProcessorBank::new(sr);
        p.set_method(method);
        p.set_params(DEFAULT_PARAMS[method]);
        p.set_source(0, 220.0, true);
        p.reset();
        p
    }
    #[test]
    fn every_effect_processes_real_input_and_source_zero_never_injects_a_demo() {
        for method in 0..PROCESSOR_COUNT {
            let mut bank = configured(method, 48000.0);
            let silent = render(&mut bank, 4096, |_| [0.0; 2]);
            assert!(
                silent.iter().flatten().all(|x| *x == 0.0),
                "method {method} generated a proxy source"
            );
            bank.reset();
            let output = render(&mut bank, 24000, |i| {
                let t = i as f32 / 48000.0;
                [
                    (TAU * 440.0 * t).sin() * 0.13 + (TAU * 1700.0 * t).sin() * 0.08,
                    (TAU * 733.0 * t).sin() * 0.16,
                ]
            });
            assert!(output
                .iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() <= CEILING));
            assert!(
                output.iter().flatten().any(|x| x.abs() > 0.0001),
                "method {method} must respond to actual PCM"
            );
        }
    }
    #[test]
    fn unity_bypass_preserves_stereo_and_ignores_effect_drive() {
        let mut bank = configured(9, 48000.0);
        bank.set_mix(1.0, true, 24.0, 24.0);
        bank.reset();
        let output = render(&mut bank, 2048, |i| {
            [0.2 * (i as f32 * 0.07).sin(), 0.1 * (i as f32 * 0.11).cos()]
        });
        for (i, frame) in output.iter().enumerate() {
            assert_eq!(frame[0], 0.2 * (i as f32 * 0.07).sin());
            assert_eq!(frame[1], 0.1 * (i as f32 * 0.11).cos());
        }
    }
    #[test]
    fn dry_mix_is_unity_without_synthesis_envelope_or_calibration() {
        let mut bank = configured(8, 48000.0);
        bank.set_mix(0.0, false, 0.0, 0.0);
        bank.reset();
        let out = render(&mut bank, 128, |_| [0.3, -0.2]);
        assert!(out.iter().all(|v| *v == [0.3, -0.2]));
    }
    fn tone_gain(method: usize, params: [f32; 16], hz: f32) -> f32 {
        let mut bank = configured(method, 48000.0);
        bank.set_params(params);
        bank.reset();
        let out = render(&mut bank, 12000, |i| {
            [(TAU * hz * i as f32 / 48000.0).sin() * 0.1; 2]
        });
        rms(&out[6000..].iter().map(|v| v[0]).collect::<Vec<_>>())
            / (0.1 / std::f32::consts::SQRT_2)
    }
    #[test]
    fn measured_biquad_and_fir_response_matches_selected_filter() {
        for method in [0, 3] {
            let mut p = DEFAULT_PARAMS[method];
            p[0] = 0.0;
            p[1] = norm(method, 1, 1200.0);
            let pass = tone_gain(method, p, 150.0);
            let stop = tone_gain(method, p, 9000.0);
            assert!(pass > 0.85, "method {method} passes low tone: {pass}");
            assert!(
                stop < pass * 0.04,
                "method {method} rejects high tone: {stop}"
            );
            p[0] = norm(method, 0, 1.0);
            let low = tone_gain(method, p, 150.0);
            let high = tone_gain(method, p, 9000.0);
            assert!(
                high > 0.85 && low < high * 0.04,
                "method {method} high-pass response {low}/{high}"
            );
        }
    }
    #[test]
    fn delay_impulse_has_the_requested_arrival_and_stop_preserves_its_tail() {
        let mut bank = configured(5, 48000.0);
        let mut p = DEFAULT_PARAMS[5];
        p[0] = norm(5, 0, 0.02);
        p[1] = 0.0;
        p[3] = 0.0;
        p[4] = 0.0;
        bank.set_params(p);
        bank.reset();
        let out = render(
            &mut bank,
            1200,
            |i| if i == 0 { [0.3, 0.0] } else { [0.0; 2] },
        );
        assert!(out[..958].iter().all(|v| v[0] == 0.0));
        let arrival = (958..964)
            .max_by(|a, b| out[*a][0].total_cmp(&out[*b][0]))
            .unwrap();
        assert!((arrival as i32 - 960).abs() <= 1);
        assert!(out[arrival][0] > 0.299);
        assert!(out.iter().all(|v| v[1] == 0.0));
        bank.reset();
        bank.input[0][0] = 0.3;
        bank.process(128);
        bank.set_source(0, 220.0, false);
        let tail = render(&mut bank, 1200, |_| [0.0; 2]);
        assert!(
            tail.iter().any(|v| v[0] > 0.29),
            "Stop closes input but does not erase stored delay audio"
        );
    }
    #[test]
    fn compressor_reduces_loud_input_more_than_quiet_input() {
        let p = DEFAULT_PARAMS[11];
        let gain = |amplitude: f32| {
            let mut b = configured(11, 48000.0);
            b.set_params(p);
            b.reset();
            let out = render(&mut b, 24000, |i| {
                [(TAU * 440.0 * i as f32 / 48000.0).sin() * amplitude; 2]
            });
            rms(&out[16000..].iter().map(|v| v[0]).collect::<Vec<_>>()) / amplitude
        };
        let quiet = gain(0.01);
        let loud = gain(0.5);
        assert!(loud < quiet * 0.35, "compressor gain {loud} vs {quiet}");
    }
    #[test]
    fn hilbert_shifter_adds_hertz_instead_of_scaling_pitch() {
        let mut b = configured(14, 48000.0);
        let mut p = DEFAULT_PARAMS[14];
        p[0] = norm(14, 0, 375.0);
        p[1] = norm(14, 1, 0.0);
        b.set_params(p);
        b.reset();
        let out = render(&mut b, 16384, |i| {
            [(TAU * 3000.0 * i as f32 / 48000.0).sin() * 0.2; 2]
        });
        let power = |hz: f32| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, v) in out[8192..].iter().enumerate() {
                let a = std::f64::consts::TAU * hz as f64 * i as f64 / 48000.0;
                re += v[0] as f64 * a.cos();
                im += v[0] as f64 * a.sin();
            }
            re * re + im * im
        };
        let upper = power(3375.0);
        let lower = power(2625.0);
        assert!(
            upper > lower * 100.0,
            "one shifted sideband dominates: upper {upper}, lower {lower}"
        );
        assert!(
            upper > power(3000.0) * 100.0,
            "carrier is translated, not mixed back"
        );
    }
    #[test]
    fn rates_extremes_invalid_input_and_abi_remain_bounded() {
        for sr in [8000.0, 44100.0, 96000.0, 192000.0] {
            for method in 0..16 {
                let mut b = configured(method, sr);
                for extreme in [0.0, 1.0] {
                    b.set_params([extreme; 16]);
                    b.set_mix(1.0, false, 12.0, 6.0);
                    b.reset();
                    let out = render(&mut b, 2048, |i| {
                        if i % 31 == 0 {
                            [f32::NAN, f32::INFINITY]
                        } else {
                            [(i as f32 * 0.8).sin() * 0.4, (i as f32 * 0.13).cos() * 0.3]
                        }
                    });
                    assert!(
                        out.iter()
                            .flatten()
                            .all(|x| x.is_finite() && x.abs() <= CEILING),
                        "method {method} at {sr}"
                    );
                }
            }
        }
        unsafe {
            let p = proc_new(48000.0);
            assert_eq!(proc_process(p, 129), 0);
            assert!(proc_input_ptr(p, 2).is_null());
            assert!(proc_output_ptr(p, 2).is_null());
            proc_set_mix(p, f32::NAN, 0, f32::INFINITY, f32::NAN);
            assert_eq!(proc_process(p, 128), 128);
            proc_free(p);
            assert_eq!(proc_process(std::ptr::null_mut(), 128), 0);
        }
    }
    #[test]
    fn test_sources_reset_deterministically_and_source_gate_stops_them() {
        let mut b = configured(0, 48000.0);
        b.set_mix(0.0, false, 0.0, 0.0);
        for source in 1..=7 {
            b.set_source(source, 220.0, true);
            b.reset();
            let first = render(&mut b, 4096, |_| [0.0; 2]);
            b.reset();
            assert_eq!(first, render(&mut b, 4096, |_| [0.0; 2]));
            assert!(
                first.iter().any(|v| v[0].abs() > 0.001),
                "source {source} sounds"
            );
            b.set_source(source, 220.0, false);
            let tail = render(&mut b, 16000, |_| [0.0; 2]);
            assert!(
                tail[15000..].iter().flatten().all(|x| x.abs() < 1e-7),
                "source {source} closes"
            );
        }
    }
    #[test]
    fn fir_live_edits_are_smooth_and_reset_uses_the_complete_target_kernel() {
        let mut changed = configured(3, 48000.0);
        let mut steady = configured(3, 48000.0);
        let mut p = DEFAULT_PARAMS[3];
        p[1] = norm(3, 1, 10000.0);
        for b in [&mut changed, &mut steady] {
            b.set_params(p);
            b.reset();
            render(b, 4096, |i| {
                [(TAU * 5000.0 * i as f32 / 48000.0).sin() * 0.2; 2]
            });
        }
        p[1] = norm(3, 1, 300.0);
        changed.set_params(p);
        let input = |i: usize| [(TAU * 5000.0 * (i + 4096) as f32 / 48000.0).sin() * 0.2; 2];
        let a = render(&mut changed, 4096, input);
        let b = render(&mut steady, 4096, input);
        assert!(
            (a[0][0] - b[0][0]).abs() < 0.002,
            "cutoff starts with a short smooth transition"
        );
        let target_rms = rms(&a[3072..].iter().map(|x| x[0]).collect::<Vec<_>>());
        assert!(
            target_rms < 0.001,
            "new low cutoff settles to its authored rejection"
        );
        changed.reset();
        let mut fresh = configured(3, 48000.0);
        fresh.set_params(p);
        fresh.reset();
        let pulse = |i: usize| if i == 0 { [0.2; 2] } else { [0.0; 2] };
        assert_eq!(
            render(&mut changed, 1024, pulse),
            render(&mut fresh, 1024, pulse)
        );
    }
    #[test]
    fn two_bit_quantizer_has_exactly_four_signed_pcm_codes() {
        let mut bank = ProcessorBank::new(48000.0);
        bank.set_method(10);
        let mut p = DEFAULT_PARAMS[10];
        p[0] = 0.0;
        p[1] = 1.0;
        p[2] = 0.0;
        bank.set_params(p);
        bank.set_source(0, 220.0, true);
        bank.reset();
        let mut codes = std::collections::BTreeSet::new();
        for i in 0..201 {
            bank.input_mut(0).fill(-1.0 + 2.0 * i as f32 / 200.0);
            bank.input_mut(1).fill(0.0);
            bank.process(128);
            codes.insert((bank.held[0] * 2.0).round() as i32);
        }
        assert_eq!(codes.into_iter().collect::<Vec<_>>(), vec![-2, -1, 0, 1]);
    }

    #[test]
    fn full_stereo_delay_range_reaches_three_seconds_without_clamping() {
        let mut bank = ProcessorBank::new(48000.0);
        bank.set_method(5);
        let mut p = DEFAULT_PARAMS[5];
        p[0] = 1.0;
        p[1] = 0.0;
        p[3] = 0.0;
        p[4] = 1.0;
        bank.set_params(p);
        bank.set_mix(1.0, false, 0.0, 0.0);
        bank.set_source(0, 220.0, true);
        bank.reset();
        let mut first = [None, None];
        for frame in (0..144128).step_by(128) {
            bank.input_mut(0).fill(0.0);
            bank.input_mut(1).fill(0.0);
            if frame == 0 {
                bank.input_mut(0)[0] = 0.5;
                bank.input_mut(1)[0] = 0.5;
            }
            bank.process(128);
            for c in 0..2 {
                for i in 0..128 {
                    if first[c].is_none() && bank.output(c)[i].abs() > 0.01 {
                        first[c] = Some(frame + i);
                    }
                }
            }
        }
        assert_eq!(first, [Some(96000), Some(144000)]);
    }
}
