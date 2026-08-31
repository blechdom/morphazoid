const freeze = (value) => Object.freeze(value);

function playable(moduleId, label, mode = "") {
  return freeze({
    kind: "playable",
    moduleId,
    label,
    mode,
  });
}

function infrastructure(featureId, label) {
  return freeze({
    kind: "infrastructure",
    featureId,
    label,
    mode: "",
  });
}

function workflow(featureId, label) {
  return freeze({
    kind: "workflow",
    featureId,
    label,
    mode: "",
  });
}

// This registry is intentionally explicit. The atlas describes shader
// functions, execution strategies, and complete workflows as well as graph
// modules, so subtracting the two collection sizes does not measure module
// coverage. Every primitive resolves either to something a listener can open
// in the playground or to the named runtime/workflow feature that implements
// it without pretending that an internal pass is an audible module.
export const SHADER_SYNTH_PRIMITIVE_COVERAGE = freeze({
  "swing-time": playable("clock", "Clock phase", "Swing"),
  "lane-value": playable("sequence-lane", "Sequence Lane", "Lane lookup"),
  "sequence-step-at": playable("sequence-lane", "Sequence Lane", "Step addressing"),
  "routed-unit": playable("normalized-route", "Normalized Route"),
  "routed-range": playable("linear-range-map", "Linear Range Map"),
  "mode-degree": playable("gpu-arp", "GPU Arpeggiator", "Scale degrees"),
  "scale-note": playable("gpu-arp", "GPU Arpeggiator", "Pitch quantizer"),
  "midi-frequency": playable("oscillator", "Oscillator", "MIDI pitch conversion"),
  smootherstep: playable("contour", "Event contour", "Smooth edges"),
  "hash-noise": playable("noise", "Hash noise"),
  "soft-clip": playable("softclip", "Soft clip"),
  "spectral-acid": playable("spectral-acid", "Spectral Acid"),
  "classic-fm": playable("fm", "FM / PM voice"),
  "wavefold-table": playable("wavefold-table-oscillator", "Wavefold Table Oscillator"),
  "modal-metal": playable("modal-metal", "Modal Metal"),
  "particle-cloud": playable("particle-cloud", "Particle Cloud"),
  "additive-organ": playable("additive-drawbar-organ", "Additive Drawbar Organ"),
  "vector-wavetable": playable("vector-wavetable", "Vector Wavetable"),
  "formant-bank": playable("formant-bank", "Formant Bank"),
  "synth-model": infrastructure("sample-graph-dispatch", "Sample-graph model dispatch"),
  "render-layer": infrastructure("sample-graph-dispatch", "Sample-graph layer renderer"),
  "layered-sound": playable("morph-crossfade", "Morph Crossfade", "Equal-power layer morph"),
  "dry-sound": workflow("modular-patch-graph", "Modular patch graph"),
  "history-at": infrastructure("gpu-history-ring", "GPU audio-history ring"),
  "sinc-lowpass": playable("fir-lowpass", "FIR Low-pass"),
  "multi-tap-delay": playable("delay", "Simple Delay", "Feed-forward taps"),
  "post-waveshaper": playable("fold", "Wavefolder", "Clip / fold"),
  "convolution-reverb": playable("convolution-space", "Convolution Space", "Sparse reflections"),
  "synthesize-dry": infrastructure("sample-compute-pass", "Sample-parallel graph pass"),
  "process-fx": infrastructure("ordered-effects-pass", "Ordered GPU effects pass"),
  "sample-clock": playable("clock", "Clock phase", "Sample clock"),
  "phase-oscillator": playable("oscillator", "Oscillator", "Sine / triangle / saw"),
  "pulse-oscillator": playable("oscillator", "Oscillator", "Pulse"),
  "ring-modulation": playable("ring", "Ring modulator"),
  tremolo: playable("am-tremolo", "AM / Tremolo", "Unipolar"),
  "hard-sync": playable("hard-sync", "Hard Sync"),
  "sample-hold": playable("sample-hold", "Sample + Hold"),
  "bit-crush": playable("quantize", "Amplitude quantizer"),
  "equal-power-pan": playable("pan", "Equal-power pan"),
  "fir-highpass": playable("fir-highpass", "FIR High-pass"),
  "fir-bandpass": playable("fir-bandpass", "FIR Band-pass"),
  "wavetable-lookup": playable("uploaded-wavetable", "Uploaded Wavetable", "Interpolated lookup"),
  "trigger-impulse": playable("trigger-impulse", "Trigger / Impulse"),
  "exponential-envelope": playable("contour", "Event contour", "Exponential decay"),
  "segment-adsr": playable("segment-adsr", "Segment ADSR"),
  "grain-window": playable("grain-window", "Grain Window"),
  "bitmask-sequencer": playable("bitmask-rhythm", "Bitmask Rhythm"),
  "interpolated-value-noise": playable("noise", "Hash noise", "Smoothed value noise"),
  "chirp-oscillator": playable("chirp-sweep", "Analytic Chirp Sweep"),
  "supersaw-unison": playable("supersaw", "Supersaw Unison"),
  "analytic-plucked-string": playable("analytic-plucked-string", "Analytic Plucked String"),
  "phase-distortion": playable("phase-distortion", "Phase Distortion"),
  "wave-terrain": playable("wave-terrain", "Analytic Wave Terrain"),
  "bytebeat-source": playable("bytebeat", "Bytebeat"),
  "fractal-recurrence": playable("fractal-recurrence", "Fractal Recurrence"),
  "procedural-kick": playable("procedural-kick", "Procedural Kick"),
  "procedural-snare": playable("procedural-snare", "Procedural Snare"),
  "metallic-hi-hat": playable("metallic-hi-hat", "Metallic Hi-hat"),
  "clap-burst": playable("clap-burst", "Clap Burst"),
  "sample-buffer-playback": playable("gpu-sampler-granulator", "GPU Sampler / Granulator", "Sample playback"),
  "granular-sample-cloud": playable("gpu-sampler-granulator", "GPU Sampler / Granulator", "Grain cloud"),
  "fof-formant-grain": playable("fof-voice", "FOF Formant Voice"),
  "sample-rate-reducer": playable("sample-rate-reducer", "Sample-rate Reducer"),
  "polynomial-waveshaper": playable("chebyshev", "Polynomial / Chebyshev shaper"),
  "full-wave-rectifier": playable("full-wave-rectifier", "Full-wave Rectifier"),
  "constant-power-crossfade": playable("morph-crossfade", "Morph Crossfade"),
  "mid-side-matrix": playable("mid-side-width", "Mid / Side Width"),
  "fractional-delay-read": playable("delay", "Simple Delay", "Fractional history read"),
  "chorus-flanger": playable("chorus", "Chorus", "Modulated delay"),
  "doppler-delay": playable("doppler-sweep", "Doppler Sweep"),
  "parallel-voice-bank": playable("parallel-voice-bank", "Parallel Voice Bank"),
  "ambisonic-encode": playable("spatializer", "Ambisonic Spatializer", "Ambisonic encode / decode"),
  "polyblep-oscillator": playable("oscillator", "Oscillator", "PolyBLEP edge correction"),
  "log-parameter-map": playable("log-parameter-map", "Log Range Mapper"),
  "event-relative-envelope": playable("segment-adsr", "Segment ADSR", "Event-relative release guard"),
  "euclidean-rhythm": playable("euclidean-gate", "Euclidean Gate"),
  "analytic-pitch-glide": playable("analytic-glide-oscillator", "Analytic Glide Oscillator"),
  "cheap-filtered-wave": playable("cheap-filtered-wave", "Rounded-edge Oscillator"),
  "additive-transfer-filter": playable("additive-transfer-filter", "Partial Transfer Filter"),
  "cyclic-fractal-noise": playable("cyclic-fractal-noise", "Cyclic Fractal Noise"),
  "gaussian-random-pair": playable("gaussian-random-pair", "Gaussian Pair"),
  "control-derived-ducking": playable("control-derived-ducking", "Clock Duck"),
  "dc-blocker": playable("recursive-filter", "Recursive Filter", "DC blocker"),
  "feedback-delay": playable("feedback-network", "Feedback Network", "Feedback delay"),
  "comb-allpass": playable("feedback-network", "Feedback Network", "Comb + all-pass"),
  "karplus-strong": playable("wavefield-solver", "Wavefield Solver", "Karplus–Strong string"),
  "fft-stft": infrastructure("spectral-frame-engine", "STFT analysis / synthesis engine"),
  "spectral-remap": playable("spectral-transport", "Spectral Transport", "Bin remap"),
  "phase-vocoder": playable("spectral-transport", "Spectral Transport", "Phase-vocoder transport"),
  "dynamics-reduction": playable("dynamics", "Dynamics", "Envelope reduction"),
  "recursive-biquad": playable("recursive-filter", "Recursive Filter", "Biquad"),
  "state-variable-filter": playable("recursive-filter", "Recursive Filter", "State variable"),
  "parallel-prefix-recursion": infrastructure("parallel-recursion-scan", "Parallel recurrence scan"),
  "overlap-add": infrastructure("spectral-frame-engine", "Overlap-add / overlap-save"),
  "partitioned-convolution": playable("convolution-space", "Convolution Space", "Partitioned FFT"),
  "feedback-delay-network": playable("feedback-network", "Feedback Network", "Feedback matrix"),
  "large-grain-engine": playable("gpu-sampler-granulator", "GPU Sampler / Granulator", "Grain-parallel engine"),
  "voice-mix-reduction": infrastructure("parallel-mix-reduction", "Parallel voice / layer reduction"),
  "million-sinusoid-bank": playable("massive-bank", "Massive Bank", "Sinusoid bank"),
  "massive-modal-synthesis": playable("massive-bank", "Massive Bank", "Modal resonator bank"),
  "nonlinear-string-fdtd": playable("wavefield-solver", "Wavefield Solver", "Nonlinear string"),
  "membrane-fdtd": playable("wavefield-solver", "Wavefield Solver", "Membrane / plate"),
  "room-acoustics-fdtd": playable("wavefield-solver", "Wavefield Solver", "Room wavefield"),
  "digital-waveguide-mesh": playable("wavefield-solver", "Wavefield Solver", "Waveguide mesh"),
  "hrtf-binaural-convolution": playable("spatializer", "Ambisonic Spatializer", "HRTF binaural"),
  "ambisonic-decode": playable("spatializer", "Ambisonic Spatializer", "Ambisonic encode / decode"),
  "sliding-phase-vocoder": playable("spectral-transport", "Spectral Transport", "Sliding phase vocoder"),
  "spectral-gate": playable("spectral-gate", "Spectral Gate"),
  "audio-analysis-texture": playable("audio-analysis-field", "Audio Analysis Field", "Waveform + spectrum field"),
  "compute-audio-stream-bridge": infrastructure("compute-audio-bridge", "GPU-to-audio chunk bridge"),
  "phase-prefix-integration": infrastructure("phase-integrator", "Continuous GPU phase integration"),
  "hybrid-convolution": playable("convolution-space", "Convolution Space", "Hybrid partitions"),
  "oversampled-nonlinearity": playable("fold", "Wavefolder", "Oversampled quality"),
  "filtered-noise-spectrum": playable("ddsp-resynth", "DDSP Resynth", "Filtered-noise spectrum"),
  "vocoder-cross-synthesis": playable("spectral-vocoder", "Cross-Synthesis Vocoder"),
  "lookahead-limiter": playable("dynamics", "Dynamics", "Look-ahead limiter"),
  "neural-dilated-convolution": playable("neural-processor", "Neural Processor", "Dilated convolution"),
  "neural-recurrent-model": playable("neural-processor", "Neural Processor", "Recurrent model"),
  "ddsp-decoder": playable("ddsp-resynth", "DDSP Resynth", "Harmonic + noise decoder"),
  "mirror-fold-time-field": playable("mirror-fold-sequencer", "Mirror Fold Sequencer"),
  "sdf-boundary-clock": playable("sdf-orbit-sequencer", "SDF Shape Sequencer"),
  "polar-kaleidoscope-clock": playable("polar-kaleidoscope-sequencer", "Polar Kaleidoscope"),
  "voronoi-event-field": playable("voronoi-cell-sequencer", "Voronoi Cell Sequencer"),
  "truchet-path-clock": playable("truchet-path-sequencer", "Truchet Path Sequencer"),
  "kifs-fold-clock": playable("kifs-fold-sequencer", "KIFS Fold Sequencer"),
  "interference-lattice-clock": playable("interference-lattice-sequencer", "Interference Lattice"),
  "phase-plane-coordinate-field": playable("phase-plane", "Phase Plane"),
  "tile-mirror-coordinate-field": playable("tile-mirror-domain", "Tile + Mirror"),
  "polar-fold-coordinate-field": playable("polar-fold-domain", "Polar Fold"),
  "sdf-pattern-control-field": playable("sdf-pattern-field", "SDF Pattern"),
  "sdf-boolean-control-field": playable("sdf-logic", "SDF Logic"),
  "interference-control-field": playable("interference-field", "Interference Field"),
  "voronoi-control-field": playable("voronoi-event-field", "Voronoi Events"),
  "truchet-router-control-field": playable("truchet-router", "Truchet Router"),
  "hex-triangle-lattice-clock": playable("hex-triangle-lattice-clock", "Hex / Triangle Lattice"),
  "log-spiral-event-field": playable("log-spiral-event-field", "Log Spiral Events"),
  "domain-warp-time-field": playable("domain-warp-time-field", "Domain-warp Time Field"),
  "fractal-orbit-trap-events": playable("fractal-orbit-trap-events", "Fractal Orbit-trap Events"),
  "cellular-automaton-score": playable("cellular-automaton-score", "Cellular Automaton Score"),
  "reaction-diffusion-score-lattice": playable("reaction-diffusion-score-lattice", "Reaction–Diffusion Score Lattice"),
  "geometric-feedback-lattice": playable("geometric-feedback-lattice", "Geometric Feedback Lattice"),
  "spectral-sdf": playable("spectral-sdf", "Spectral SDF"),
  "flow-field-advection": playable("flow-field-advection", "Flow-field Advection"),
  "raymarch-resonator": playable("raymarch-resonator", "Raymarch Resonator"),
  "batch-patch-renderer": workflow("sound-discovery-lab", "Batch sound-discovery renderer"),
});

export const SHADER_SYNTH_PRIMITIVE_COVERAGE_KINDS = freeze([
  "playable",
  "infrastructure",
  "workflow",
]);

export function shaderSynthPrimitiveCoverageById(primitiveId) {
  const id = String(primitiveId ?? "");
  return Object.hasOwn(SHADER_SYNTH_PRIMITIVE_COVERAGE, id)
    ? SHADER_SYNTH_PRIMITIVE_COVERAGE[id]
    : null;
}

export function shaderSynthPrimitivePlaygroundHref(primitiveId) {
  const coverage = shaderSynthPrimitiveCoverageById(primitiveId);
  if (coverage?.kind !== "playable") return null;
  return `shader-synth-playground.html?module=${encodeURIComponent(coverage.moduleId)}`;
}
