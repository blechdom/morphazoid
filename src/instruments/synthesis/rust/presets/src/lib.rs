//! Generated browser/native preset parity. Regenerate with build:synthesis-wasm.
use synthesis_core::Engine;

pub struct Preset {
    pub name: &'static str,
    pub frequency: f32,
    pub params: [f32; 16],
    pub envelope: [f32; 4],
    /// Measured static calibration before the common output protection stage.
    pub level_trim_db: f32,
}

include!("data.rs");

pub fn apply_preset(engine: &mut Engine, method: usize, preset: usize) -> &'static Preset {
    let m = method.min(METHOD_NAMES.len() - 1);
    let p = &PRESETS[m][preset.min(7)];
    engine.set_method(m as u32);
    engine.set_level_trim_db(p.level_trim_db);
    engine.set_params(p.params);
    engine.set_frequency(p.frequency);
    engine.set_envelope(p.envelope[0], p.envelope[1], p.envelope[2], p.envelope[3]);
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factory_calibration_is_applied_and_survives_parameter_edits() {
        let mut engine = Engine::new(48_000.0);
        for method in 0..METHOD_NAMES.len() {
            for preset in 0..8 {
                // Ensure missing application cannot pass using the default trim.
                engine.set_level_trim_db(-35.0);
                let expected = apply_preset(&mut engine, method, preset);
                assert!(expected.level_trim_db.is_finite());
                assert!((-36.0..=48.0).contains(&expected.level_trim_db));
                assert_eq!(engine.level_trim_db(), expected.level_trim_db);
                let mut edited = expected.params;
                edited[0] = 0.123;
                engine.set_params(edited);
                assert_eq!(engine.level_trim_db(), expected.level_trim_db);
                engine.reset();
                assert_eq!(engine.level_trim_db(), expected.level_trim_db);
            }
        }
    }
}

/// Processing presets carry explicit source fixtures for browser/CPAL demos;
/// a native effect host may retain external input while applying the timbre.
pub struct ProcessorPreset {
    pub name: &'static str,
    pub params: [f32; 16],
    pub source: u32,
    pub frequency: f32,
    pub wet: f32,
    pub input_db: f32,
    pub output_db: f32,
}
include!("processing_data.rs");

pub fn apply_processor_preset(
    bank: &mut synthesis_core::processing::ProcessorBank,
    method: usize,
    preset: usize,
) -> &'static ProcessorPreset {
    let method = method.min(PROCESSOR_NAMES.len() - 1);
    let p = &PROCESSOR_PRESETS[method][preset.min(PROCESSOR_PRESETS[method].len() - 1)];
    bank.set_method(method);
    bank.set_params(p.params);
    bank.set_mix(p.wet, false, p.input_db, p.output_db);
    bank.set_source(p.source, p.frequency, false);
    p
}
