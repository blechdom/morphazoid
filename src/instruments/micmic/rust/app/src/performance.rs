use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Seed,
    #[default]
    Mic,
}

/// Input cleanup and stereo mastering. Zero-frequency filters are bypassed.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Mastering {
    pub input_highpass_hz: f64,
    pub highpass_hz: f64,
    pub lowpass_hz: f64,
    pub compressor_enabled: bool,
    pub threshold_db: f64,
    pub knee_db: f64,
    pub ratio: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub auto_makeup: bool,
    pub makeup_db: f64,
}

impl Default for Mastering {
    fn default() -> Self {
        Self {
            input_highpass_hz: 55.0,
            highpass_hz: 0.0,
            lowpass_hz: 0.0,
            compressor_enabled: true,
            threshold_db: -12.0,
            knee_db: 5.0,
            ratio: 18.0,
            attack_ms: 3.0,
            release_ms: 180.0,
            auto_makeup: true,
            makeup_db: 0.0,
        }
    }
}

impl Mastering {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value, minimum, maximum) in [
            ("Input HPF", self.input_highpass_hz, 0.0, 2000.0),
            ("Master HPF", self.highpass_hz, 0.0, 2000.0),
            ("Master LPF", self.lowpass_hz, 0.0, 20_000.0),
            ("Compressor threshold", self.threshold_db, -60.0, 0.0),
            ("Compressor knee", self.knee_db, 0.0, 40.0),
            ("Compressor ratio", self.ratio, 1.0, 20.0),
            ("Compressor attack", self.attack_ms, 0.1, 100.0),
            ("Compressor release", self.release_ms, 10.0, 1500.0),
            ("Makeup gain", self.makeup_db, -12.0, 12.0),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(format!("{name} is outside its supported range"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Performance {
    pub source: Source,
    pub level: f32,
    pub wet: f32,
    pub dry: f32,
    pub frozen: bool,
    pub input_gain: f32,
    pub frequency: f64,
    pub pulse_rate: f64,
    /// Zero means no user-imposed ceiling. Allocation and measured deadlines govern admission.
    pub voice_ceiling: usize,
    pub automatic: bool,
    pub mastering: Mastering,
}

impl Default for Performance {
    fn default() -> Self {
        Self {
            source: Source::Mic,
            level: 0.58,
            wet: 0.76,
            dry: 0.0,
            frozen: false,
            input_gain: 0.85,
            frequency: 173.0,
            pulse_rate: 2.0,
            voice_ceiling: 0,
            automatic: true,
            mastering: Mastering::default(),
        }
    }
}

impl Performance {
    pub fn capped(&self, available: usize) -> usize {
        if self.voice_ceiling == 0 {
            available
        } else {
            available.min(self.voice_ceiling)
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if !self.level.is_finite()
            || !(0.0..=1.0).contains(&self.level)
            || !self.wet.is_finite()
            || !(0.0..=1.0).contains(&self.wet)
            || !self.dry.is_finite()
            || !(0.0..=0.5).contains(&self.dry)
            || !self.input_gain.is_finite()
            || !(0.0..=4.0).contains(&self.input_gain)
            || !self.frequency.is_finite()
            || !(40.0..=1200.0).contains(&self.frequency)
            || !self.pulse_rate.is_finite()
            || !(0.1..=12.0).contains(&self.pulse_rate)
        {
            return Err("Performance settings are outside their supported ranges".into());
        }
        self.mastering.validate()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_and_partial_performance_keep_original_conditioning_defaults() {
        let legacy: Performance = serde_json::from_str(r#"{"wet":0.4}"#).unwrap();
        assert_eq!(legacy.mastering, Mastering::default());
        let partial: Performance =
            serde_json::from_str(r#"{"mastering":{"lowpassHz":7000}}"#).unwrap();
        assert_eq!(partial.mastering.lowpass_hz, 7000.0);
        assert_eq!(partial.mastering.input_highpass_hz, 55.0);
        assert_eq!(partial.mastering.ratio, 18.0);
        assert!(partial.validate().is_ok());
        let serialized = serde_json::to_value(partial).unwrap();
        assert_eq!(serialized["mastering"]["lowpassHz"], 7000.0);
    }

    #[test]
    fn mastering_rejects_unknown_malformed_and_out_of_range_values() {
        for payload in [
            r#"{"mastering":{"threshold":-12}}"#,
            r#"{"mastering":{"compressorEnabled":1}}"#,
            r#"{"mastering":{"ratio":"4"}}"#,
            r#"{"mastering":null}"#,
        ] {
            assert!(serde_json::from_str::<Performance>(payload).is_err());
        }
        for payload in [
            r#"{"mastering":{"inputHighpassHz":2001}}"#,
            r#"{"mastering":{"highpassHz":-1}}"#,
            r#"{"mastering":{"lowpassHz":20001}}"#,
            r#"{"mastering":{"thresholdDb":1}}"#,
            r#"{"mastering":{"kneeDb":41}}"#,
            r#"{"mastering":{"ratio":0.99}}"#,
            r#"{"mastering":{"attackMs":0}}"#,
            r#"{"mastering":{"releaseMs":1501}}"#,
            r#"{"mastering":{"makeupDb":-13}}"#,
        ] {
            let settings = serde_json::from_str::<Performance>(payload).unwrap();
            assert!(settings.validate().is_err(), "Accepted {payload}");
        }
        let invalid = Mastering {
            ratio: f64::NAN,
            ..Mastering::default()
        };
        assert!(invalid.validate().is_err());
    }
}
