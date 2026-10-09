//! A local control surface. All sample processing and device I/O remain in Rust.
mod adaptive;
mod audio;
mod conditioning;
mod envelope;
mod model;
mod performance;
mod resources;

use audio::{PoolUpdate, Session};
use model::{try_compile, Parameters, Topology};
use performance::Performance;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::Read,
    time::{Duration, Instant},
};
use tiny_http::{Header, Method, Request, Response, Server};

const MAX_BODY: usize = 16 * 1024;
const IDLE_TIMEOUT: Duration = Duration::from_secs(10);

fn pool_update(topology: &Topology, depth: f64, pitch_offset: f64, revision: u64) -> Result<PoolUpdate, String> {
    let mut phase_seeds = resources::filled(topology.targets.len(), 0_u32)?;
    for node in &topology.nodes {
        phase_seeds[node.voice_index] = l_system_delay_core::phase_seed(&node.key);
    }
    Ok(PoolUpdate {
        phase_seeds,
        revision,
        pitch_offset,
        targets: resources::copied(&topology.targets)?,
        ranks: resources::copied(&topology.ranks)?,
        groups: resources::copied(&topology.groups)?,
        wet_normalization: 0.36 + 0.64 * (1.0 - depth * depth).max(0.08).sqrt(),
        growth: None,
    })
}

struct Application {
    parameters: Parameters,
    performance: Performance,
    topology: Topology,
    topology_revision: u64,
    session: Option<Session>,
    error: Option<String>,
    last_seen: Instant,
    no_device: bool,
    memory_voice_capacity: usize,
    generation_limits: std::collections::BTreeMap<String, u8>,
    capabilities_checked: Instant,
}

impl Application {
    fn new(no_device: bool) -> Self {
        let mut parameters = Parameters::default();
        let memory_voice_capacity = resources::voice_capacity();
        parameters.generations = parameters.generations.min(model::generation_limit(
            "pythagorean",
            memory_voice_capacity,
        ));
        let generation_limits = model::L_SYSTEM_TYPES
            .iter()
            .map(|id| {
                (
                    (*id).to_string(),
                    model::generation_limit(id, memory_voice_capacity),
                )
            })
            .collect();
        Self {
            topology: try_compile(&parameters, 48_000).expect("Default tree fits available memory"),
            topology_revision: 1,
            parameters,
            performance: Performance::default(),
            session: None,
            error: None,
            last_seen: Instant::now(),
            no_device,
            memory_voice_capacity,
            generation_limits,
            capabilities_checked: Instant::now(),
        }
    }

    fn status(&self) -> Value {
        let status = self.session.as_ref().map_or_else(
            || {
                json!({
                    "sampleRate": 0, "device": "Audio off", "inputDevice": null,
                    "activeVoices": 0, "targetVoices": 0, "voiceLimit": 0, "installedCapacity": 0, "generationActivity": [], "calibratedVoices": 0,
                    "tapActivity": [], "tapVoiceIndices": [], "wetBusGain": 0, "topologyRevision": 0,
                    "cpuLoad": 0, "peakLoad": 0, "inputPeak": 0, "outputPeak": 0,
                    "outputLeftPeak": 0, "outputRightPeak": 0,
                    "gainReductionDb": 0,
                    "underruns": 0, "overruns": 0, "deadlineMisses": 0, "elapsedSeconds": 0,
                    "automatic": self.performance.automatic, "source": self.performance.source,
                    "failure": null
                })
            },
            |session| serde_json::to_value(session.snapshot()).expect("Finite native telemetry"),
        );
        json!({
            "audio": self.session.is_some(), "parameters": self.parameters,
            "topologyRevision": self.topology_revision,
            "performance": self.performance, "status": status, "error": self.error,
            "requestedVoices": self.topology.requested_voices,
            "eligibleVoices": self.topology.eligible_voices,
            "deviceAvailable": !self.no_device,
            "memoryVoiceCapacity": self.memory_voice_capacity,
            "generationLimits": self.generation_limits,
        })
    }

    fn state(&self) -> Value {
        let mut state = self.status();
        state["nodes"] =
            serde_json::to_value(&self.topology.nodes[..self.topology.nodes.len().min(16382)])
                .expect("Finite native preview");
        state["previewSampled"] = json!(self.topology.nodes.len() > 16382);
        state
    }

    fn update_parameters(&mut self, parameters: Parameters) -> Result<(), String> {
        parameters.validate()?;
        let sample_rate = self
            .session
            .as_ref()
            .map_or(48_000, |session| session.snapshot().sample_rate);
        let topology = try_compile(&parameters, sample_rate)?;
        let revision = self.topology_revision.wrapping_add(1).max(1);
        if let Some(session) = &mut self.session {
            session.update(
                pool_update(&topology, parameters.depth, parameters.pitch_offset, revision)?,
                self.performance,
            )?;
        }
        self.topology_revision = revision;
        self.parameters = parameters;
        self.topology = topology;
        self.error = None;
        Ok(())
    }

    fn update_performance(&mut self, performance: Performance) -> Result<(), String> {
        performance.validate()?;
        if let Some(session) = &mut self.session {
            session.update_performance(performance)?;
        }
        self.performance = performance;
        self.error = None;
        Ok(())
    }

    fn audio(&mut self, enabled: bool) -> Result<(), String> {
        if enabled && self.session.is_none() {
            if self.no_device {
                return Err("This test server has device audio disabled".into());
            }
            self.session = Some(Session::start(
                pool_update(
                    &self.topology,
                    self.parameters.depth,
                    self.parameters.pitch_offset,
                    self.topology_revision,
                )?,
                self.performance,
            )?);
        } else if !enabled {
            self.stop();
        }
        self.error = None;
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(session) = self.session.take() {
            session.stop();
        }
    }

    fn tick(&mut self) {
        if self.capabilities_checked.elapsed() >= Duration::from_secs(1) {
            self.capabilities_checked = Instant::now();
            let capacity = resources::voice_capacity();
            if capacity > self.memory_voice_capacity {
                self.memory_voice_capacity = capacity;
                self.generation_limits = model::L_SYSTEM_TYPES
                    .iter()
                    .map(|id| ((*id).to_string(), model::generation_limit(id, capacity)))
                    .collect();
            }
        }
        if let Some(session) = &mut self.session {
            session.reclaim();
            let failure = session.snapshot().failure;
            if failure.is_some() {
                self.error = failure;
                self.stop();
            } else if self.last_seen.elapsed() > IDLE_TIMEOUT {
                self.stop();
            }
        }
    }

    fn action(&mut self, path: &str, body: &[u8]) -> Result<Value, String> {
        self.last_seen = Instant::now();
        let result = match path {
            "/api/parameters" => {
                self.update_parameters(parse(body)?)?;
                Ok(self.status())
            }
            "/api/performance" => {
                self.update_performance(parse(body)?)?;
                Ok(self.status())
            }
            "/api/audio" => {
                let action: AudioAction = parse(body)?;
                self.audio(action.enabled)?;
                Ok(self.status())
            }
            "/api/strike" => {
                let _: EmptyAction = parse(body)?;
                self.session
                    .as_ref()
                    .ok_or("Turn Audio on before playing the seed")?
                    .strike()?;
                Ok(self.status())
            }
            "/api/reset" => {
                let _: EmptyAction = parse(body)?;
                self.update_parameters(Parameters::default())?;
                Ok(self.state())
            }
            _ => Err("Unknown control action".into()),
        };
        self.last_seen = Instant::now();
        result
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AudioAction {
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyAction {}

fn parse<T: serde::de::DeserializeOwned>(body: &[u8]) -> Result<T, String> {
    serde_json::from_slice(body).map_err(|error| format!("Invalid control request: {error}"))
}

fn asset(path: &str) -> Option<&'static [u8]> {
    match path {
        "/" | "/index.html" => Some(include_bytes!("../ui/index.html")),
        _ => None,
    }
}

fn mime(path: &str) -> &'static str {
    if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else {
        "text/html; charset=utf-8"
    }
}

fn respond(request: Request, code: u16, body: Vec<u8>, content_type: &str) {
    let response = Response::from_data(body).with_status_code(code)
        .with_header(Header::from_bytes("Content-Type", content_type).unwrap())
        .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
        .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap())
        .with_header(Header::from_bytes("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'").unwrap());
    let _ = request.respond(response);
}

fn respond_json(request: Request, code: u16, value: Value) {
    respond(
        request,
        code,
        serde_json::to_vec(&value).unwrap(),
        "application/json; charset=utf-8",
    );
}

fn header<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str())
}

fn allowed_origin(host: Option<&str>, origin: Option<&str>, port: u16) -> bool {
    let local_host = format!("localhost:{port}");
    let numeric_host = format!("127.0.0.1:{port}");
    let valid_host = host.is_some_and(|host| host == local_host || host == numeric_host);
    valid_host
        && origin.is_none_or(|origin| {
            origin == format!("http://{local_host}") || origin == format!("http://{numeric_host}")
        })
}

fn handle(mut request: Request, app: &mut Application, port: u16) {
    if !allowed_origin(header(&request, "Host"), header(&request, "Origin"), port) {
        respond_json(
            request,
            403,
            json!({"error": "Use this app's local address"}),
        );
        return;
    }
    let path = request.url().split('?').next().unwrap_or("/").to_owned();
    if *request.method() == Method::Get {
        match path.as_str() {
            "/api/state" => {
                app.last_seen = Instant::now();
                respond_json(request, 200, app.state());
            }
            "/api/preview" => {
                app.last_seen = Instant::now();
                respond_json(
                    request,
                    200,
                    json!({"parameters": app.parameters, "nodes": app.topology.preview}),
                );
            }
            "/api/status" => {
                app.last_seen = Instant::now();
                respond_json(request, 200, app.status());
            }
            _ => match asset(&path) {
                Some(bytes) => respond(request, 200, bytes.to_vec(), mime(&path)),
                None => respond_json(request, 404, json!({"error": "Page not found"})),
            },
        }
        return;
    }
    if *request.method() != Method::Post || !path.starts_with("/api/") {
        respond_json(
            request,
            405,
            json!({"error": "Use GET for the interface or POST for a control"}),
        );
        return;
    }
    if !header(&request, "Content-Type").is_some_and(|value| {
        value
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case("application/json")
    }) {
        respond_json(
            request,
            415,
            json!({"error": "Controls require application/json"}),
        );
        return;
    }
    if request
        .body_length()
        .is_some_and(|length| length > MAX_BODY)
    {
        respond_json(
            request,
            413,
            json!({"error": "Control request is too large"}),
        );
        return;
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(MAX_BODY as u64 + 1)
        .read_to_end(&mut body)
        .is_err()
        || body.len() > MAX_BODY
    {
        respond_json(
            request,
            400,
            json!({"error": "Could not read the control request"}),
        );
        return;
    }
    match app.action(&path, &body) {
        Ok(value) => respond_json(request, 200, value),
        Err(error) => {
            app.error = Some(error.clone());
            respond_json(request, 400, json!({"error": error}));
        }
    }
}

fn options(args: impl IntoIterator<Item = String>) -> Result<(u16, bool, bool), String> {
    let mut port = 3436;
    let mut no_device = false;
    let mut help = false;
    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--port" => {
                port = args
                    .next()
                    .ok_or("--port needs a number")?
                    .parse::<u16>()
                    .map_err(|_| "Invalid port")?
            }
            "--no-device" => no_device = true,
            "--help" => help = true,
            _ => return Err(format!("Unknown argument {argument}; use --help")),
        }
    }
    Ok((port, no_device, help))
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (port, no_device, help) = options(std::env::args().skip(1))?;
    if help {
        println!("l-system-delay-app [--port 3436] [--no-device]\nOpen http://localhost:3437/l-mic-rust.html in the Morphazoid webapp. Audio starts off. Rust/CPAL handles native sound.\n--no-device disables hardware audio for interface tests.");
        return Ok(());
    }
    let server = Server::http(("127.0.0.1", port))?;
    let port = server.server_addr().to_ip().ok_or("No TCP address")?.port();
    println!("L-system Delay service: http://localhost:{port}/\nInstrument: http://localhost:3437/l-mic-rust.html\nAudio is off. Open Morphazoid and explicitly enable Audio to play.");
    let mut app = Application::new(no_device);
    loop {
        app.tick();
        if let Some(request) = server.recv_timeout(Duration::from_millis(20))? {
            handle(request, &mut app, port);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_and_parameter_edits_never_arm_device_audio() {
        let mut app = Application::new(true);
        assert_eq!(app.state()["audio"], false);
        assert_eq!(app.topology.nodes.len(), 16382);
        let parameters = Parameters {
            generations: 4,
            angle: 63.,
            ..Parameters::default()
        };
        app.update_parameters(parameters).unwrap();
        assert_eq!(app.topology.nodes.len(), 30);
        assert!(app.session.is_none());
        assert!(app.audio(true).is_err());
        assert!(app.session.is_none());
    }

    #[test]
    fn invalid_control_changes_preserve_the_complete_previous_state() {
        let mut app = Application::new(true);
        let before = app.state();
        let parameters = Parameters {
            time_ratio: f64::NAN,
            ..Parameters::default()
        };
        assert!(app.update_parameters(parameters).is_err());
        let performance = Performance {
            level: -1.,
            ..Performance::default()
        };
        assert!(app.update_performance(performance).is_err());
        assert!(app
            .action("/api/audio", br#"{"enabled":true,"extra":1}"#)
            .is_err());
        assert!(app
            .action("/api/parameters", br#"{"unknown":true}"#)
            .is_err());
        assert_eq!(app.state(), before);
    }

    #[test]
    fn no_decay_depth_round_trips_in_native_status_and_rejects_values_above_one() {
        let mut app = Application::new(true);
        let parameters = Parameters {
            generations: 4,
            depth: 1.,
            ..Parameters::default()
        };
        app.action("/api/parameters", &serde_json::to_vec(&parameters).unwrap())
            .unwrap();
        assert_eq!(app.status()["parameters"]["depth"], 1.);
        assert_eq!(app.topology.eligible_voices, 30);
        assert!(app.topology.targets.iter().all(|target| target.gain == 0.5));
        assert!(app.session.is_none());
        let before = app.state();
        let invalid = Parameters {
            depth: 1.0001,
            ..parameters
        };
        assert!(app
            .action("/api/parameters", &serde_json::to_vec(&invalid).unwrap())
            .is_err());
        assert_eq!(app.state(), before);
    }

    #[test]
    fn mastering_controls_round_trip_without_arming_audio_or_replacing_topology() {
        let mut app = Application::new(true);
        let revision = app.topology_revision;
        let parameters = serde_json::to_value(&app.parameters).unwrap();
        let mut settings = serde_json::to_value(app.performance).unwrap();
        settings["mastering"]["lowpassHz"] = json!(6500.0);
        settings["mastering"]["ratio"] = json!(2.5);
        settings["mastering"]["autoMakeup"] = json!(false);
        settings["mastering"]["makeupDb"] = json!(2.0);
        app.action("/api/performance", &serde_json::to_vec(&settings).unwrap())
            .unwrap();
        assert_eq!(
            app.status()["performance"]["mastering"],
            settings["mastering"]
        );
        assert_eq!(app.status()["status"]["gainReductionDb"], 0);
        assert_eq!(app.topology_revision, revision);
        assert_eq!(serde_json::to_value(&app.parameters).unwrap(), parameters);
        assert!(app.session.is_none());
        let before = app.status();
        settings["mastering"]["ratio"] = json!(0.0);
        assert!(app
            .action("/api/performance", &serde_json::to_vec(&settings).unwrap())
            .is_err());
        assert_eq!(app.status(), before);
    }

    #[test]
    fn reset_preserves_source_levels_and_device_policy() {
        let mut app = Application::new(true);
        let performance = Performance {
            level: 0.31,
            source: performance::Source::Mic,
            voice_ceiling: 512,
            ..Performance::default()
        };
        app.update_performance(performance).unwrap();
        let parameters = Parameters {
            mutation: 0.75,
            ..Parameters::default()
        };
        app.update_parameters(parameters).unwrap();
        app.action("/api/reset", b"{}").unwrap();
        assert_eq!(app.performance.level, 0.31);
        assert_eq!(app.performance.source, performance::Source::Mic);
        assert_eq!(app.performance.voice_ceiling, 512);
        assert_eq!(app.parameters.mutation, 0.);
        assert!(app.session.is_none());
    }

    #[test]
    fn local_controls_accept_only_matching_loopback_hosts_and_origins() {
        assert!(allowed_origin(
            Some("localhost:3436"),
            Some("http://localhost:3436"),
            3436
        ));
        assert!(allowed_origin(Some("127.0.0.1:3436"), None, 3436));
        assert!(!allowed_origin(Some("attacker.example:3436"), None, 3436));
        assert!(!allowed_origin(
            Some("localhost:3436"),
            Some("http://another.example"),
            3436
        ));
        assert!(!allowed_origin(Some("localhost:3437"), None, 3436));
        assert!(!allowed_origin(None, None, 3436));
    }
}
