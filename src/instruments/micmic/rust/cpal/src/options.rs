use crate::Result;
use std::collections::HashSet;

pub const HELP: &str = "l-system-delay-cpal --scene scene.json (--input recording.wav | --demo) [--render output.wav | --bench report.json] [--seconds 8] [--level 0..1]
l-system-delay-cpal --scene scene.json --live [--seconds 8] [--level 0..1]
l-system-delay-cpal --devices

--render writes stereo float32 WAV through the exact DSP core, without opening a device.
File input must be mono/stereo PCM or float32 WAV at the scene sample rate.
--demo supplies an original deterministic test signal. Omitting --render/--bench plays CPAL output.
Offline render defaults to level 1 for numerical comparison; device playback/live defaults to 0.58.
--live explicitly captures the default microphone. Input/output must support the scene rate.
Live and stationary benchmarks accept at most one scene event, at time zero.
--bench primes history without voices, warms 128 blocks, then times 3 x 64 blocks of 128 frames.
--bench-blocks N (default 64), --bench-warmup N (default 128), --bench-repetitions N (default 3)
Bench timing includes core processing only; it measures local CPU cost, not hardware underruns.";

pub struct Options {
    pub scene: Option<String>,
    pub input: Option<String>,
    pub render: Option<String>,
    pub bench: Option<String>,
    pub live: bool,
    pub devices: bool,
    pub help: bool,
    pub demo: bool,
    pub seconds: f64,
    pub level: Option<f32>,
    pub bench_blocks: usize,
    pub bench_warmup: usize,
    pub bench_repetitions: usize,
}

impl Options {
    pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Self> {
        let mut options = Self {
            scene: None,
            input: None,
            render: None,
            bench: None,
            live: false,
            devices: false,
            help: false,
            demo: false,
            seconds: 8.0,
            level: None,
            bench_blocks: 64,
            bench_warmup: 128,
            bench_repetitions: 3,
        };
        let mut args = args.into_iter();
        let mut seen = HashSet::new();
        while let Some(arg) = args.next() {
            if !seen.insert(arg.clone()) {
                return Err(format!("Repeated argument: {arg}").into());
            }
            if matches!(arg.as_str(), "--help" | "--devices" | "--live" | "--demo") {
                match arg.as_str() {
                    "--help" => options.help = true,
                    "--devices" => options.devices = true,
                    "--live" => options.live = true,
                    "--demo" => options.demo = true,
                    _ => unreachable!(),
                }
                continue;
            }
            if !matches!(
                arg.as_str(),
                "--scene"
                    | "--input"
                    | "--render"
                    | "--bench"
                    | "--seconds"
                    | "--level"
                    | "--bench-blocks"
                    | "--bench-warmup"
                    | "--bench-repetitions"
            ) {
                return Err(format!("Unknown argument: {arg}; use --help").into());
            }
            let value = args
                .next()
                .filter(|s| !s.starts_with("--"))
                .ok_or_else(|| format!("Missing value for {arg}"))?;
            match arg.as_str() {
                "--scene" => options.scene = Some(value),
                "--input" => options.input = Some(value),
                "--render" => options.render = Some(value),
                "--bench" => options.bench = Some(value),
                "--seconds" => options.seconds = value.parse()?,
                "--level" => options.level = Some(value.parse()?),
                "--bench-blocks" => options.bench_blocks = value.parse()?,
                "--bench-warmup" => options.bench_warmup = value.parse()?,
                "--bench-repetitions" => options.bench_repetitions = value.parse()?,
                _ => unreachable!(),
            }
        }
        if options.help {
            return Ok(options);
        }
        if options.devices {
            if seen.len() != 1 {
                return Err("--devices cannot be combined with other arguments".into());
            }
            return Ok(options);
        }
        if options.scene.as_ref().is_none_or(|s| s.is_empty()) {
            return Err("--scene scene.json is required".into());
        }
        if !options.seconds.is_finite()
            || !(0.01..=600.0).contains(&options.seconds)
            || options
                .level
                .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
            || !(1..=65_536).contains(&options.bench_blocks)
            || options.bench_warmup > 65_536
            || !(1..=100).contains(&options.bench_repetitions)
        {
            return Err("Invalid duration, level or benchmark count".into());
        }
        let sources = usize::from(options.live)
            + usize::from(options.demo)
            + usize::from(options.input.is_some());
        if sources != 1 {
            return Err("Choose exactly one of --input recording.wav, --demo or --live".into());
        }
        if options.render.is_some() && options.bench.is_some() {
            return Err("Choose --render or --bench".into());
        }
        if options.live && (options.render.is_some() || options.bench.is_some()) {
            return Err("--live cannot be combined with --render or --bench".into());
        }
        if options.bench.is_none() && seen.iter().any(|s| s.starts_with("--bench-")) {
            return Err("Benchmark counts require --bench report.json".into());
        }
        Ok(options)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(args: &[&str]) -> Result<Options> {
        Options::parse(args.iter().map(|s| s.to_string()))
    }
    #[test]
    fn malformed_arguments_are_errors_instead_of_silent_defaults() {
        for args in [
            vec![],
            vec!["--scene"],
            vec!["--scene", "--demo"],
            vec!["--scene", "x", "--demo", "--seconds", "NaN"],
            vec!["--scene", "x", "--input", "a", "--live"],
            vec!["--scene", "x", "--demo", "--levle", "1"],
            vec!["--scene", "x", "--demo", "--level", "-1"],
            vec!["--devices", "--demo"],
            vec!["--scene", "x", "--demo", "--demo"],
        ] {
            assert!(parse(&args).is_err(), "{args:?}");
        }
    }
    #[test]
    fn render_and_live_defaults_leave_levels_to_the_destination() {
        let render = parse(&["--scene", "x", "--demo", "--render", "out.wav"]).unwrap();
        assert!(render.level.is_none());
        assert_eq!(render.seconds, 8.0);
        assert!(parse(&["--scene", "x", "--live"]).unwrap().live);
        assert!(parse(&["--devices"]).unwrap().devices);
    }
}
