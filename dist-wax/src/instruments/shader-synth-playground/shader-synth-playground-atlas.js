const freeze = (value) => Object.freeze(value);

function port(id, label, type, options = {}) {
  return freeze({
    id,
    label,
    type,
    types: freeze(options.types ?? [type]),
    required: Boolean(options.required),
    component: options.component ?? null,
  });
}

function parameter(id, label, minimum, maximum, defaultValue, options = {}) {
  return freeze({
    id,
    label,
    min: minimum,
    max: maximum,
    default: defaultValue,
    step: options.step ?? (maximum - minimum) / 100,
    unit: options.unit ?? "",
    scale: options.scale ?? "linear",
    options: options.options ? freeze([...options.options]) : null,
    low: options.low ?? "less",
    high: options.high ?? "more",
    behavior: options.behavior ?? "Changes the module's response.",
  });
}

function moduleSpec(spec) {
  return freeze({
    ...spec,
    aliases: freeze([...(spec.aliases ?? [])]),
    tags: freeze([...(spec.tags ?? [])]),
    inputs: freeze([...(spec.inputs ?? [])]),
    outputs: freeze([...(spec.outputs ?? [])]),
    params: freeze([...(spec.params ?? [])]),
    shaderSource: spec.shaderSource ? freeze({ ...spec.shaderSource }) : null,
    faust: spec.faust ? freeze({ ...spec.faust }) : null,
  });
}

const pitchGateOutputs = () => [
  port("pitch", "pitch", "control"),
  port("gate", "gate", "control", { component: "y" }),
];

const fieldGateOutputs = () => [
  port("field", "field", "control"),
  port("gate", "gate", "control", { component: "y" }),
];

const pitchScaleParameter = () => parameter("scale", "Pitch scale", 0, 6, 2, {
  step: 1,
  options: ["Chromatic", "Major", "Minor", "Pentatonic", "Whole tone", "Octatonic", "Quarter-tone"],
  low: "chromatic",
  high: "quarter-tone",
  behavior: "Maps the geometric field onto a pitch collection, including quarter-tone steps.",
});

const octaveParameter = (defaultValue = 3) => parameter("octaves", "Pitch span", 1, 4, defaultValue, {
  step: 1,
  unit: "oct",
  low: "compact",
  high: "wide",
  behavior: "Sets how many octaves the generated pitch field can traverse.",
});

export const SHADER_SYNTH_PLAYGROUND_ATLAS_KINDS = freeze({
  triggerImpulse: 88,
  segmentAdsr: 89,
  grainWindow: 90,
  logParameterMap: 91,
  cheapFilteredWave: 92,
  additiveTransferFilter: 93,
  gaussianRandomPair: 94,
  controlDerivedDucking: 95,
  parallelVoiceBank: 96,
  hexTriangleLatticeClock: 97,
  logSpiralEventField: 98,
  domainWarpTimeField: 99,
  fractalOrbitTrapEvents: 100,
});

// This batch deliberately contains only bounded, sample-independent
// techniques. Uploaded tables, recursive filters, feedback, FFT reductions,
// and physical grids require storage or ordered passes and do not belong in
// this evaluator fragment.
export const SHADER_SYNTH_PLAYGROUND_ATLAS_MODULES = freeze([
  moduleSpec({
    id: "trigger-impulse", kind: 88, name: "Trigger / Impulse", category: "control", color: "#ff6eaa",
    aliases: ["unit impulse", "sample trigger", "excitation", "clock pulse"],
    tags: ["trigger", "impulse", "sample accurate", "excitation", "clock"],
    description: "Marks a deterministic sample address with a pulse. A width of one sample is a unit impulse; wider defaults make the event easier to audition as a gate.",
    execution: "Single-sample · integer sample comparison", wgsl: "hit = localSample < pulseSamples;",
    auditionKind: "gate", auditionPreset: null,
    inputs: [], outputs: [port("out", "trigger", "control")],
    params: [
      parameter("rate", "Event rate", 0.1, 64, 4, { step: 0.01, unit: "Hz", scale: "log", low: "spaced", high: "rapid", behavior: "Sets how often the sample-addressed event repeats." }),
      parameter("width", "Width", 1, 4096, 96, { step: 1, unit: "samples", low: "unit impulse", high: "short gate", behavior: "Sets the number of active samples; one produces the exact unit impulse." }),
      parameter("edge", "Edge smoothing", 0, 1, 0.28, { step: 0.01, low: "hard sample edge", high: "rounded pulse", behavior: "Rounds wider pulse edges while leaving a one-sample impulse intact." }),
      parameter("phase", "Clock phase", 0, 1, 0, { step: 0.001, unit: "cycle", low: "aligned", high: "shifted", behavior: "Moves the event address within its repeating period." }),
      parameter("accentEvery", "Accent cycle", 1, 32, 4, { step: 1, low: "every event", high: "long cycle", behavior: "Sets how many events occur between emphasized impulses." }),
      parameter("accent", "Accent", 0, 1, 0.28, { step: 0.01, low: "even", high: "contrasted", behavior: "Raises the accent and slightly lowers the intervening events." }),
      parameter("alternate", "Alternating polarity", 0, 1, 0, { step: 1, options: ["Positive", "Alternating"], low: "positive", high: "bipolar", behavior: "Optionally inverts every other event for excitation experiments." }),
      parameter("level", "Level", 0, 1, 1, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the final trigger value." }),
    ],
    faust: { symbol: "ba.pulse", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
  moduleSpec({
    id: "segment-adsr", kind: 89, name: "Segment ADSR", category: "control", color: "#ff6eaa",
    aliases: ["adsr", "breakpoint envelope", "note envelope", "segment envelope"],
    tags: ["adsr", "envelope", "attack", "decay", "sustain", "release"],
    description: "Evaluates a repeating attack, decay, sustain, and release contour directly from note-local sample time, with no hidden envelope state.",
    execution: "Single-sample · analytic note-local segments", wgsl: "env = atlasAdsrAt(localTime, gateTime, attack, decay, sustain, release);",
    auditionKind: "gate", auditionPreset: null,
    inputs: [], outputs: [port("out", "envelope", "control")],
    params: [
      parameter("rate", "Note rate", 0.1, 16, 1.8, { step: 0.01, unit: "Hz", scale: "log", low: "long notes", high: "short notes", behavior: "Sets the duration of the repeating analytic note." }),
      parameter("gate", "Gate length", 0.08, 0.95, 0.55, { step: 0.01, unit: "cycle", low: "short hold", high: "long hold", behavior: "Places note-off within each cycle so the release segment has a known start time." }),
      parameter("attack", "Attack", 0.001, 1, 0.018, { step: 0.001, unit: "s", scale: "log", low: "sharp", high: "slow", behavior: "Sets the time from zero to the envelope peak." }),
      parameter("decay", "Decay", 0.001, 2, 0.19, { step: 0.001, unit: "s", scale: "log", low: "quick settle", high: "slow settle", behavior: "Sets how quickly the peak approaches the sustain level." }),
      parameter("sustain", "Sustain", 0, 1, 0.54, { step: 0.01, low: "falls away", high: "held peak", behavior: "Sets the held level after decay and before note-off." }),
      parameter("release", "Release", 0.001, 4, 0.18, { step: 0.001, unit: "s", scale: "log", low: "short", high: "long", behavior: "Sets the fall from the note-off level to zero; values longer than the remaining cycle are compressed to the next zero boundary." }),
      parameter("curve", "Segment curve", 0.25, 4, 1.25, { step: 0.01, low: "soft", high: "snappy", behavior: "Curves both the attack and release while preserving their endpoints." }),
      parameter("level", "Level", 0, 1, 1, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the complete ADSR contour." }),
    ],
    faust: { symbol: "en.adsr", url: "https://faustlibraries.grame.fr/libs/envelopes/" },
  }),
  moduleSpec({
    id: "grain-window", kind: 90, name: "Grain Window", category: "control", color: "#ffda57",
    aliases: ["hann window", "gaussian window", "tukey window", "splice envelope"],
    tags: ["grain", "window", "hann", "gaussian", "tukey", "click safe"],
    description: "Generates a bounded periodic splice window whose endpoints reach zero before the next grain begins.",
    execution: "Single-sample · analytic window", wgsl: "window = atlasGrainWindow(grainPhase, shape, shapeAmount);",
    auditionKind: "gate", auditionPreset: null,
    inputs: [], outputs: [port("out", "window", "control")],
    params: [
      parameter("rate", "Grain rate", 0.2, 200, 7.5, { step: 0.01, unit: "Hz", scale: "log", low: "separate grains", high: "dense grains", behavior: "Sets how often a new analytic window begins." }),
      parameter("duration", "Active duration", 0.05, 1, 0.72, { step: 0.01, unit: "cycle", low: "short grain", high: "full cycle", behavior: "Sets how much of each period contains the window before returning to zero." }),
      parameter("shape", "Shape", 0, 3, 0, { step: 1, options: ["Hann", "Gaussian", "Tukey", "Sine"], low: "Hann", high: "sine power", behavior: "Selects the analytic window family." }),
      parameter("shapeAmount", "Shape amount", 0.05, 1, 0.45, { step: 0.01, low: "concentrated", high: "broad", behavior: "Changes Hann or sine curvature, Gaussian width, or Tukey taper while keeping the splice endpoints at zero." }),
      parameter("skew", "Skew", -1, 1, 0, { step: 0.01, low: "leans late", high: "leans early", behavior: "Warps grain phase so the window leans toward its attack or release." }),
      parameter("phase", "Window phase", 0, 1, 0, { step: 0.001, unit: "cycle", low: "aligned", high: "shifted", behavior: "Offsets the window inside the repeating sample clock." }),
      parameter("bipolar", "Window lobes", 0, 1, 0, { step: 1, options: ["Positive", "Signed lobes"], low: "positive", high: "signed", behavior: "Introduces signed inner lobes while preserving zero at both splice endpoints." }),
      parameter("level", "Level", 0, 1, 1, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the active window without changing its timing." }),
    ],
    faust: { symbol: "sin, exp", url: "https://faustlibraries.grame.fr/libs/maths/" },
  }),
  moduleSpec({
    id: "log-parameter-map", kind: 91, name: "Log Range Mapper", category: "control", color: "#ffda57",
    aliases: ["exponential mapper", "frequency mapper", "log control", "octave map"],
    tags: ["control", "mapping", "logarithmic", "frequency", "range"],
    description: "Maps a normalized control across a positive range with even proportional or octave spacing.",
    execution: "Single-sample · exponential control mapping", wgsl: "mapped = minimum * pow(maximum / minimum, unit);",
    auditionKind: "control", auditionPreset: null,
    inputs: [port("control", "normalized control", "control", { required: true })], outputs: [port("out", "mapped control", "control")],
    params: [
      parameter("minimum", "Minimum", 0.001, 1000, 0.25, { step: 0.001, scale: "log", low: "small floor", high: "large floor", behavior: "Sets one positive endpoint of the mapped range." }),
      parameter("maximum", "Maximum", 0.01, 20000, 8, { step: 0.01, scale: "log", low: "narrow range", high: "wide range", behavior: "Sets the other positive endpoint; endpoints are sorted safely in the shader." }),
      parameter("curve", "Curve", 0.25, 4, 1, { step: 0.01, low: "early travel", high: "late travel", behavior: "Warps normalized travel before logarithmic interpolation." }),
      parameter("polarity", "Input range", 0, 1, 0, { step: 1, options: ["Bipolar", "Unipolar"], low: "−1 to 1", high: "0 to 1", behavior: "Chooses how the incoming control is normalized." }),
      parameter("gain", "Input gain", -4, 4, 1, { step: 0.01, unit: "×", low: "inverted", high: "expanded", behavior: "Scales the input before normalization and clamping." }),
      parameter("offset", "Input offset", -2, 2, 0, { step: 0.01, low: "lower", high: "higher", behavior: "Offsets the input before normalization and clamping." }),
      parameter("invert", "Direction", 0, 1, 0, { step: 1, options: ["Minimum → maximum", "Maximum → minimum"], low: "rising", high: "falling", behavior: "Reverses the direction of the logarithmic mapping." }),
      parameter("level", "Output scale", 0.001, 4, 1, { step: 0.001, unit: "×", scale: "log", low: "reduced", high: "expanded", behavior: "Scales the mapped physical value before output." }),
    ],
    faust: { symbol: "pow", url: "https://faustlibraries.grame.fr/libs/maths/" },
  }),
  moduleSpec({
    id: "cheap-filtered-wave", kind: 92, name: "Rounded-edge Oscillator", category: "source", color: "#74f7ff",
    aliases: ["rounded saw", "rounded square", "shader filtered wave", "soft edge oscillator"],
    tags: ["oscillator", "saw", "square", "roundness", "shadertoy"],
    description: "Rounds a saw or square discontinuity geometrically, creating filter-like spectral motion without claiming to filter arbitrary audio.",
    execution: "Single-sample · analytic waveform geometry", wgsl: "wave = atlasRoundedWave(phase, waveform, roundness);",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("roundness", "roundness CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Frequency", 20, 6000, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets the oscillator fundamental before pitch input and MIDI transposition." }),
      parameter("waveform", "Waveform", 0, 1, 0, { step: 1, options: ["Saw", "Square"], low: "saw", high: "square", behavior: "Selects which discontinuous waveform receives geometric edge rounding." }),
      parameter("roundness", "Roundness", 0, 0.98, 0.34, { step: 0.01, low: "raw edge", high: "soft cycle", behavior: "Morphs a linear saw ramp toward a continuous rounded cycle, progressively reducing the reset discontinuity." }),
      parameter("cvDepth", "Roundness CV", -1, 1, 0.45, { step: 0.01, low: "inverse motion", high: "forward motion", behavior: "Sets how strongly the first input moves edge roundness." }),
      parameter("stereo", "Stereo detune", 0, 40, 3.2, { step: 0.1, unit: "cents", low: "mono", high: "wide", behavior: "Offsets left and right oscillator frequencies in opposite directions." }),
      parameter("drive", "Drive", 0.25, 8, 1, { step: 0.01, unit: "×", scale: "log", low: "clean", high: "compressed", behavior: "Pushes the rounded waveform into a soft ceiling." }),
      parameter("geometryMix", "Geometry mix", 0, 1, 1, { step: 0.01, low: "PolyBLEP reference", high: "rounded geometry", behavior: "Crossfades from the host's corrected oscillator to the ShaderToy-style rounded edge." }),
      parameter("level", "Level", 0, 1, 0.42, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the stereo oscillator result." }),
    ],
    faust: { symbol: "os.polyblep_saw", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "additive-transfer-filter", kind: 93, name: "Partial Transfer Filter", category: "spectral", color: "#ff9f68",
    aliases: ["analytic transfer filter", "spectral lowpass", "filtered additive bank", "partial response"],
    tags: ["additive", "filter", "transfer function", "resonance", "partials"],
    description: "Builds its own harmonic bank, applies a low-pass magnitude curve, and gives every known partial an independently adjustable frequency-dependent phase color. It is not an arbitrary-audio filter.",
    execution: "Single-sample · bounded partial response loop", wgsl: "sum += partial * atlasTransferMagnitude(partialHz, cutoff, resonance);",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("cutoff", "cutoff CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("frequency", "Fundamental", 20, 2400, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets the harmonic-bank fundamental before pitch input and MIDI transposition." }),
      parameter("partials", "Partials", 1, 48, 24, { step: 1, low: "fundamental", high: "dense bank", behavior: "Bounds how many harmonics receive the analytic transfer response." }),
      parameter("cutoff", "Cutoff", 20, 18000, 1400, { step: 1, unit: "Hz", scale: "log", low: "dark", high: "open", behavior: "Places the analytic low-pass corner across the known harmonic series." }),
      parameter("resonance", "Resonance", 0, 8, 1.4, { step: 0.01, low: "flat corner", high: "peaked corner", behavior: "Raises a bounded Gaussian peak around the transfer cutoff." }),
      parameter("slope", "Slope", 0.5, 8, 2.4, { step: 0.01, low: "gentle", high: "steep", behavior: "Changes how quickly partial magnitudes fall above cutoff." }),
      parameter("phaseColor", "Partial phase color", 0, 1, 0.45, { step: 0.01, low: "aligned partials", high: "frequency-colored", behavior: "Increases an independent frequency-dependent phase offset across the partial bank; it is not the exact phase response of the magnitude curve." }),
      parameter("cvDepth", "Cutoff CV", -8, 8, 3, { step: 0.01, unit: "oct", low: "inverse sweep", high: "forward sweep", behavior: "Sets how many cutoff octaves the first input can traverse." }),
      parameter("level", "Level", 0, 1, 0.48, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the normalized filtered harmonic bank." }),
    ],
    faust: { symbol: "fi.lowpass", url: "https://faustlibraries.grame.fr/libs/filters/" },
  }),
  moduleSpec({
    id: "gaussian-random-pair", kind: 94, name: "Gaussian Pair", category: "modulation", color: "#ffda57",
    aliases: ["box muller", "normal distribution", "gaussian scatter", "humanized random"],
    tags: ["gaussian", "random", "box muller", "scatter", "two outputs"],
    description: "Transforms two patched uniform controls into a correlated pair of bell-shaped values using the stateless Box–Muller transform.",
    execution: "Single-sample/event · stateless distribution transform", wgsl: "pair = atlasGaussianPair(uniformA, uniformB);",
    auditionKind: "coordinate", auditionPreset: null,
    inputs: [
      port("u1", "uniform A", "control", { required: true }),
      port("u2", "uniform B", "control", { required: true }),
    ],
    outputs: [
      port("x", "Gaussian X", "control"),
      port("y", "Gaussian Y", "control", { component: "y" }),
    ],
    params: [
      parameter("meanX", "X mean", -2, 2, 0, { step: 0.01, low: "negative", high: "positive", behavior: "Offsets the first Gaussian output." }),
      parameter("meanY", "Y mean", -2, 2, 0, { step: 0.01, low: "negative", high: "positive", behavior: "Offsets the second Gaussian output." }),
      parameter("deviation", "Deviation", 0, 2, 0.42, { step: 0.01, low: "concentrated", high: "wide", behavior: "Sets the standard deviation of both outputs." }),
      parameter("correlation", "Correlation", -0.98, 0.98, 0.28, { step: 0.01, low: "opposed", high: "linked", behavior: "Correlates the second result with the first while keeping bounded variance." }),
      parameter("rotation", "Pair rotation", -0.5, 0.5, 0, { step: 0.001, unit: "turn", low: "counter", high: "clockwise", behavior: "Rotates the two-dimensional Gaussian result." }),
      parameter("clip", "Safety range", 0.25, 8, 2.5, { step: 0.01, low: "tight", high: "open", behavior: "Clamps rare distribution tails to a predictable patching range." }),
      parameter("level", "Level", 0, 2, 1, { step: 0.01, low: "small", high: "large", behavior: "Scales both Gaussian outputs after clipping." }),
      parameter("uniformOffset", "Uniform offset", 0, 1, 0.173, { step: 0.001, low: "alignment A", high: "alignment B", behavior: "Offsets both patched uniform coordinates before the transform." }),
    ],
    faust: { symbol: "log, sqrt, sin, cos", url: "https://faustlibraries.grame.fr/libs/maths/" },
  }),
  moduleSpec({
    id: "control-derived-ducking", kind: 95, name: "Clock Duck", category: "dynamics", color: "#ff6eaa",
    aliases: ["sidechain pump", "rhythmic duck", "clocked gain", "control ducking"],
    tags: ["ducking", "sidechain", "gain", "clock", "stateless"],
    description: "Choreographs gain from a known analytic clock or a patched duck envelope. It does not pretend to detect unexpected audio peaks.",
    execution: "Single-sample · analytic gain contour", wgsl: "out = signal * mix(1.0, floorGain, duckAmount);",
    auditionKind: "effect", auditionPreset: null,
    inputs: [
      port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true }),
      port("duck", "duck envelope", "control"),
    ],
    outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Clock rate", 0.1, 24, 2.4, { step: 0.01, unit: "Hz", scale: "log", low: "slow pump", high: "rapid pump", behavior: "Sets the internal deterministic duck cycle." }),
      parameter("depth", "Depth", 0, 1, 0.72, { step: 0.01, low: "none", high: "full", behavior: "Sets how strongly the selected envelope lowers gain." }),
      parameter("floor", "Floor gain", 0, 1, 0.18, { step: 0.01, low: "near silence", high: "shallow", behavior: "Sets the lowest gain reached at maximum ducking." }),
      parameter("attack", "Duck attack", 0.001, 0.5, 0.012, { step: 0.001, unit: "s", scale: "log", low: "immediate", high: "soft", behavior: "Sets how quickly attenuation reaches its maximum after the clock event." }),
      parameter("hold", "Hold", 0, 1, 0.055, { step: 0.001, unit: "s", low: "no hold", high: "long hold", behavior: "Keeps maximum attenuation before recovery begins." }),
      parameter("release", "Recovery", 0.002, 4, 0.32, { step: 0.001, unit: "s", scale: "log", low: "quick", high: "slow", behavior: "Sets how long gain takes to recover after the hold." }),
      parameter("externalMix", "External envelope", 0, 1, 0, { step: 0.01, low: "internal clock", high: "patched envelope", behavior: "Crossfades from analytic clock ducking to the second input." }),
      parameter("level", "Level", 0, 1.5, 0.94, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the ducked stereo result." }),
    ],
    faust: { symbol: "*", url: "https://faustdoc.grame.fr/manual/syntax/" },
  }),
  moduleSpec({
    id: "parallel-voice-bank", kind: 96, name: "Parallel Voice Bank", category: "source", color: "#74f7ff",
    aliases: ["polyphonic bank", "voice stack", "bounded polyphony", "parallel oscillator bank"],
    tags: ["polyphony", "voices", "parallel", "unison", "chord", "gpu"],
    description: "Evaluates a bounded bank of independently pitched, drifting, and panned oscillator voices inside each output sample.",
    execution: "Single-sample · 1–12 bounded voice loop", wgsl: "for voice in activeVoices { mix += atlasVoice(voice); }",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("pitch", "pitch", "control"), port("spread", "spread CV", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Center pitch", 20, 2400, 82.41, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets the center frequency before pitch input and MIDI transposition." }),
      parameter("voices", "Voices", 1, 12, 7, { step: 1, low: "single", high: "twelve", behavior: "Bounds how many voices are evaluated and normalized." }),
      parameter("waveform", "Waveform", 0, 3, 2, { step: 1, options: ["Sine", "Triangle", "Saw", "Pulse"], low: "rounded", high: "edged", behavior: "Selects the waveform shared by the voice bank." }),
      parameter("interval", "Interval spread", 0, 12, 0, { step: 0.01, unit: "st", low: "unison", high: "wide chord", behavior: "Spreads voices symmetrically in semitone intervals." }),
      parameter("detune", "Fine detune", 0, 80, 13, { step: 0.1, unit: "cents", low: "locked", high: "wide", behavior: "Adds continuous symmetric fine detuning around the interval structure." }),
      parameter("width", "Stereo width", 0, 1, 0.82, { step: 0.01, low: "mono", high: "wide", behavior: "Pans voices across the stereo field; spread input can move it further." }),
      parameter("drift", "Pitch drift", 0, 40, 3.5, { step: 0.1, unit: "cents", low: "steady", high: "wandering", behavior: "Applies a phase-correct sinusoidal frequency drift independently to each voice." }),
      parameter("level", "Level", 0, 1, 0.42, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the energy-normalized bank." }),
    ],
    faust: { symbol: "par, os.osc", url: "https://faustdoc.grame.fr/manual/syntax/" },
  }),
  moduleSpec({
    id: "hex-triangle-lattice-clock", kind: 97, name: "Hex / Triangle Lattice", category: "geometry", color: "#ff8ccf",
    aliases: ["hex clock", "triangular lattice", "three axis grid", "lattice crossings"],
    tags: ["geometry", "hexagonal", "triangle", "lattice", "clock", "pitch gate"],
    description: "Moves a trajectory through a 60-degree coordinate basis so crossings on three coupled axes become related gates and pitches.",
    execution: "Single-sample · affine lattice coordinates", wgsl: "axes = vec3(x, 0.5*x + 0.866*y, 0.5*x - 0.866*y);",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "Book of Shaders pattern coordinates", url: "https://thebookofshaders.com/09/" },
    inputs: [port("root", "root pitch", "control")], outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Travel rate", 0.05, 24, 3.6, { step: 0.01, unit: "Hz", scale: "log", low: "slow", high: "rapid", behavior: "Sets how quickly the trajectory crosses lattice cells." }),
      parameter("length", "Path length", 2, 128, 19, { step: 1, low: "short", high: "long", behavior: "Sets how many lattice positions form the repeating path." }),
      parameter("lattice", "Lattice", 0, 1, 0, { step: 1, options: ["Triangular lines", "Hexagonal cells"], low: "line crossings", high: "cell crossings", behavior: "Changes how the same three axes are combined into a gate field." }),
      parameter("density", "Density", 0.5, 12, 3, { step: 0.01, low: "broad cells", high: "fine cells", behavior: "Sets the spatial frequency of the repeated lattice." }),
      parameter("rotation", "Rotation", -0.5, 0.5, 0.08, { step: 0.001, unit: "turn", low: "counter", high: "clockwise", behavior: "Rotates the trajectory through all three axes together." }),
      parameter("threshold", "Crossing threshold", 0, 1, 0.58, { step: 0.01, low: "dense", high: "sparse", behavior: "Raises the field level required to open a gate, moving from broad lattice regions toward isolated crossings." }),
      pitchScaleParameter(),
      octaveParameter(3),
    ],
    faust: { symbol: "floor, fmod", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "log-spiral-event-field", kind: 98, name: "Log Spiral Events", category: "geometry", color: "#ff8ccf",
    aliases: ["spiral clock", "logarithmic spiral", "radial events", "spiral sequencer"],
    tags: ["geometry", "log spiral", "polar", "event field", "accelerando", "pitch gate"],
    description: "Converts polar angle and logarithmic radius into scale-invariant event bands whose timing changes as the orbit moves inward and outward.",
    execution: "Single-sample · polar logarithmic field", wgsl: "phase = fract((angle + turns * log(radius)) * arms / TAU);",
    auditionKind: "pitch-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy log-spiral pinwheel", url: "https://www.shadertoy.com/view/Wf3cz2" },
    inputs: [port("root", "root pitch", "control")], outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Orbit rate", 0.02, 16, 0.72, { step: 0.01, unit: "Hz", scale: "log", low: "slow orbit", high: "rapid orbit", behavior: "Sets how quickly the analytic point travels around and across the spiral." }),
      parameter("arms", "Spiral arms", 1, 24, 5, { step: 1, low: "single arm", high: "dense pinwheel", behavior: "Repeats the logarithmic event field around the polar angle." }),
      parameter("turns", "Log turns", -8, 8, 2.2, { step: 0.01, low: "reverse", high: "forward", behavior: "Sets how strongly logarithmic radius rotates event phase." }),
      parameter("radialCycles", "Radial motion", 0.125, 8, 1.5, { step: 0.001, low: "slow breathing", high: "rapid breathing", behavior: "Sets how often the trajectory moves inward and outward during an orbit." }),
      parameter("rotation", "Rotation", -1, 1, 0, { step: 0.001, unit: "turn", low: "counter", high: "clockwise", behavior: "Offsets the complete logarithmic spiral field." }),
      parameter("width", "Event width", 0.005, 0.48, 0.085, { step: 0.001, low: "points", high: "bands", behavior: "Sets the width of each softly edged spiral event." }),
      pitchScaleParameter(),
      octaveParameter(3),
    ],
    faust: { symbol: "atan2, log", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
  moduleSpec({
    id: "domain-warp-time-field", kind: 99, name: "Domain-warp Time Field", category: "geometry", color: "#ff8ccf",
    aliases: ["warped time", "fbm timing", "microtiming field", "domain warp"],
    tags: ["geometry", "domain warp", "fbm", "microtiming", "field", "gate"],
    description: "Builds two bounded octave fields, uses them to bend the input coordinate, and emits a related continuous control and event gate.",
    execution: "Single-sample · two bounded octave-field passes", wgsl: "warped = point + warp * vec2(fieldA, fieldB);",
    auditionKind: "field-gate", auditionPreset: null,
    shaderSource: { label: "Book of Shaders fBm and warping", url: "https://thebookofshaders.com/13/" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control", { required: true }),
      port("warp", "warp motion", "control"),
    ],
    outputs: fieldGateOutputs(),
    params: [
      parameter("octaves", "Octaves", 1, 6, 4, { step: 1, low: "broad", high: "detailed", behavior: "Bounds how many spatial frequency layers each field evaluates." }),
      parameter("frequency", "Base frequency", 0.1, 12, 1.6, { step: 0.01, low: "broad", high: "fine", behavior: "Sets the first field frequency before octave multiplication." }),
      parameter("warp", "Warp depth", 0, 4, 1.15, { step: 0.01, low: "straight", high: "folded", behavior: "Sets how far the first field pair displaces the second lookup." }),
      parameter("lacunarity", "Lacunarity", 1.1, 4, 2.03, { step: 0.01, low: "close octaves", high: "wide octaves", behavior: "Sets the frequency ratio between successive field layers." }),
      parameter("gain", "Octave gain", 0.1, 0.9, 0.52, { step: 0.01, low: "smooth", high: "rough", behavior: "Sets how slowly upper-octave field amplitudes decay." }),
      parameter("speed", "Field speed", -4, 4, 0.11, { step: 0.01, unit: "Hz", low: "reverse", high: "forward", behavior: "Animates the domain without carrying hidden state." }),
      parameter("threshold", "Gate threshold", -1, 1, 0.16, { step: 0.01, low: "open negative", high: "open positive", behavior: "Chooses which warped-field values open the event output." }),
      parameter("softness", "Gate softness", 0.001, 0.5, 0.065, { step: 0.001, low: "sharp", high: "soft", behavior: "Widens the continuous transition around the gate threshold." }),
    ],
    faust: { symbol: "sin, cos", url: "https://faustlibraries.grame.fr/libs/maths/" },
  }),
  moduleSpec({
    id: "fractal-orbit-trap-events", kind: 100, name: "Fractal Orbit-trap Events", category: "geometry", color: "#ff8ccf",
    aliases: ["orbit trap", "fractal events", "kifs field", "recursive geometry"],
    tags: ["geometry", "fractal", "orbit trap", "kifs", "recursive", "field gate"],
    description: "Runs a bounded inverse-and-fold recurrence per sample and turns the nearest orbit-trap approach into continuous control and sparse gates.",
    execution: "Single-sample · 1–12 bounded recurrence iterations", wgsl: "z = mix(z, abs(z), fold) / max(dot(z,z), epsilon) - offset;",
    auditionKind: "field-gate", auditionPreset: null,
    shaderSource: { label: "ShaderToy compact KIFS fractal", url: "https://www.shadertoy.com/view/4ttBWM" },
    inputs: [
      port("x", "x", "control", { required: true }),
      port("y", "y", "control", { required: true }),
      port("morph", "orbit morph", "control"),
    ],
    outputs: fieldGateOutputs(),
    params: [
      parameter("iterations", "Iterations", 1, 12, 7, { step: 1, low: "broad", high: "deep", behavior: "Bounds the number of recurrence folds evaluated per output sample." }),
      parameter("zoom", "Input zoom", 0.1, 8, 1.4, { step: 0.01, low: "wide view", high: "fine view", behavior: "Scales the incoming coordinate before recurrence." }),
      parameter("rotation", "Rotation", -0.5, 0.5, 0.06, { step: 0.001, unit: "turn", low: "counter", high: "clockwise", behavior: "Rotates the coordinate before orbit iteration." }),
      parameter("fold", "Absolute fold", 0, 1, 0.82, { step: 0.01, low: "unfolded", high: "KIFS fold", behavior: "Morphs from an inverse recurrence into absolute-value KIFS folding." }),
      parameter("trapRadius", "Trap radius", 0.02, 4, 0.74, { step: 0.01, low: "center trap", high: "outer trap", behavior: "Sets the radius whose closest approach is measured across the orbit." }),
      parameter("width", "Event width", 0.001, 1, 0.085, { step: 0.001, low: "sparse", high: "broad", behavior: "Sets how close the orbit must approach the trap to open a gate." }),
      parameter("seed", "Orbit seed", 1, 65535, 17011, { step: 1, low: "field A", high: "field B", behavior: "Selects a deterministic recurrence offset and orientation." }),
      parameter("level", "Field level", 0, 4, 1, { step: 0.01, low: "small", high: "large", behavior: "Scales the continuous trap-distance output without changing the gate." }),
    ],
    faust: { symbol: "abs, dot, min", url: "https://faustdoc.grame.fr/manual/syntax/#mathh" },
  }),
]);

// The host shader supplies SAMPLE_RATE, PI, TAU, render_info,
// phaseAtSample, smootherstep01, oscillatorWave, hashU32, softClip, and
// arpScalePitch. Every helper here is pure with respect to sampleIndex.
export const SHADER_SYNTH_PLAYGROUND_ATLAS_HELPERS = /* wgsl */ `
fn atlasCycleCoordinates(sampleIndex: u32, rate: f32, phaseOffset: f32) -> vec3<u32> {
  let periodSamples = max(u32(round(SAMPLE_RATE / max(rate, 0.001))), 1u);
  let offsetSamples = u32(round(fract(phaseOffset) * f32(periodSamples))) % periodSamples;
  let shiftedSample = sampleIndex + offsetSamples;
  return vec3<u32>(shiftedSample / periodSamples, shiftedSample % periodSamples, periodSamples);
}

fn atlasAdsrHeldLevel(time: f32, gateTime: f32, attack: f32, decay: f32, sustain: f32, curve: f32) -> f32 {
  let safeAttack = max(min(attack, gateTime), 0.000001);
  if (time < safeAttack) {
    return pow(clamp(time / safeAttack, 0.0, 1.0), max(curve, 0.01));
  }
  let decayTime = max(decay, 0.000001);
  return sustain + (1.0 - sustain) * exp(-5.0 * max(time - safeAttack, 0.0) / decayTime);
}

fn atlasGrainWindow(phase: f32, shape: u32, amount: f32) -> f32 {
  let x = clamp(phase, 0.0, 1.0);
  if (shape == 1u) {
    let sigma = mix(0.08, 0.42, clamp(amount, 0.0, 1.0));
    let centered = (x - 0.5) / max(sigma, 0.0001);
    let gaussian = exp(-0.5 * centered * centered);
    let endpoint = exp(-0.125 / max(sigma * sigma, 0.000001));
    return clamp((gaussian - endpoint) / max(1.0 - endpoint, 0.000001), 0.0, 1.0);
  }
  if (shape == 2u) {
    let taper = mix(0.02, 0.5, clamp(amount, 0.0, 1.0));
    return min(smootherstep01(x / taper), smootherstep01((1.0 - x) / taper));
  }
  if (shape == 3u) {
    return pow(max(sin(PI * x), 0.0), mix(4.0, 0.35, clamp(amount, 0.0, 1.0)));
  }
  let hann = max(0.5 - 0.5 * cos(TAU * x), 0.0);
  let hannPower = exp2((0.5 - clamp(amount, 0.0, 1.0)) * 3.0);
  return pow(hann, hannPower);
}

fn atlasRoundedSaw(phase: f32, roundness: f32) -> f32 {
  let p = fract(phase);
  let amount = clamp(roundness, 0.0, 0.98);
  let rawSaw = p * 2.0 - 1.0;
  let roundedCycle = -cos(TAU * p);
  return mix(rawSaw, roundedCycle, smootherstep01(amount));
}

fn atlasRoundedSquare(phase: f32, roundness: f32) -> f32 {
  let p = fract(phase);
  let edge = mix(0.0002, 0.245, clamp(roundness, 0.0, 0.98));
  let rise = smootherstep01(p / edge);
  let fall = 1.0 - smootherstep01((p - 0.5) / edge);
  return clamp((rise * fall) * 2.0 - 1.0, -1.0, 1.0);
}

fn atlasRotate(point: vec2<f32>, turns: f32) -> vec2<f32> {
  let angle = turns * TAU;
  let cosine = cos(angle);
  let sine = sin(angle);
  return vec2<f32>(point.x * cosine - point.y * sine, point.x * sine + point.y * cosine);
}

fn atlasScaleSize(scale: u32) -> u32 {
  switch scale {
    case 1u: { return 7u; }
    case 2u: { return 7u; }
    case 3u: { return 5u; }
    case 4u: { return 6u; }
    case 5u: { return 8u; }
    case 6u: { return 24u; }
    default: { return 12u; }
  }
}

fn atlasPitchDegree(field: f32, count: u32) -> u32 {
  let safeCount = max(count, 1u);
  return min(u32(floor(clamp(field, 0.0, 0.999999) * f32(safeCount))), safeCount - 1u);
}

fn atlasQuantizedPitchGuard(position: f32, width: f32) -> f32 {
  let cellPhase = fract(position);
  let edge = clamp(width, 0.001, 0.49);
  return smootherstep01(cellPhase / edge)
    * smootherstep01((1.0 - cellPhase) / edge);
}

fn atlasOctaveField(point: vec2<f32>, octaves: u32, frequency: f32, lacunarity: f32, gain: f32, offset: f32) -> f32 {
  var cursor = point * frequency + vec2<f32>(offset, -offset * 0.731);
  var amplitude = 1.0;
  var total = 0.0;
  var weight = 0.0;
  for (var octave = 0u; octave < 6u; octave += 1u) {
    if (octave >= octaves) { break; }
    let layer = sin(TAU * (cursor.x + 0.31 * cos(TAU * cursor.y)))
      * cos(TAU * (cursor.y - 0.27 * sin(TAU * cursor.x)));
    total += layer * amplitude;
    weight += amplitude;
    cursor = atlasRotate(cursor * lacunarity + vec2<f32>(0.173, -0.219), 0.137);
    amplitude *= gain;
  }
  return total / max(weight, 0.000001);
}
`;

// Insert these cases inside the host evaluateNode switch after the helper
// fragment above has been included in SHADER_PLAYGROUND_SHADER.
export const SHADER_SYNTH_PLAYGROUND_ATLAS_CASES = /* wgsl */ `
    case 88u: {
      let coordinates = atlasCycleCoordinates(sampleIndex, p0.x, p0.w);
      let pulseSamples = min(u32(clamp(round(p0.y), 1.0, 4096.0)), coordinates.z);
      var pulse = 0.0;
      if (coordinates.y < pulseSamples) {
        pulse = 1.0;
        if (pulseSamples > 1u && p0.z > 0.0001) {
          let edgeSamples = max(u32(round(f32(pulseSamples) * clamp(p0.z, 0.0, 1.0) * 0.5)), 1u);
          let remaining = pulseSamples - 1u - coordinates.y;
          pulse = min(
            smootherstep01(f32(coordinates.y + 1u) / f32(edgeSamples)),
            smootherstep01(f32(remaining + 1u) / f32(edgeSamples))
          );
        }
      }
      let accentPeriod = u32(clamp(round(p1.x), 1.0, 32.0));
      let accented = (coordinates.x % accentPeriod) == 0u;
      let accentGain = select(1.0 - p1.y * 0.5, 1.0 + p1.y, accented);
      let alternatingSign = select(1.0, -1.0, (coordinates.x & 1u) == 1u);
      let polarity = mix(1.0, alternatingSign, clamp(p1.z, 0.0, 1.0));
      result = vec2<f32>(pulse * accentGain * polarity * p1.w);
    }
    case 89u: {
      let coordinates = atlasCycleCoordinates(sampleIndex, p0.x, 0.0);
      let periodTime = f32(coordinates.z) / SAMPLE_RATE;
      let localTime = f32(coordinates.y) / SAMPLE_RATE;
      let gateTime = clamp(p0.y, 0.08, 0.95) * periodTime;
      let sustain = clamp(p1.x, 0.0, 1.0);
      let curve = max(p1.z, 0.01);
      var envelope = 0.0;
      if (localTime < gateTime) {
        envelope = atlasAdsrHeldLevel(localTime, gateTime, p0.z, p0.w, sustain, curve);
      } else {
        let releaseStart = atlasAdsrHeldLevel(gateTime, gateTime, p0.z, p0.w, sustain, curve);
        let availableRelease = max(periodTime - gateTime, 0.000001);
        let releaseTime = min(max(p1.y, 0.000001), availableRelease);
        let releasePhase = clamp((localTime - gateTime) / releaseTime, 0.0, 1.0);
        envelope = releaseStart * pow(1.0 - smootherstep01(releasePhase), curve);
      }
      result = vec2<f32>(clamp(envelope, 0.0, 1.0) * p1.w);
    }
    case 90u: {
      let coordinates = atlasCycleCoordinates(sampleIndex, p0.x, p1.y);
      let cyclePhase = f32(coordinates.y) / f32(max(coordinates.z - 1u, 1u));
      let duration = clamp(p0.y, 0.05, 1.0);
      var window = 0.0;
      if (cyclePhase < duration) {
        var grainPhase = clamp(cyclePhase / duration, 0.0, 1.0);
        let skew = clamp(p1.x, -1.0, 1.0);
        if (skew < 0.0) {
          grainPhase = pow(grainPhase, mix(1.0, 4.0, -skew));
        } else if (skew > 0.0) {
          grainPhase = 1.0 - pow(1.0 - grainPhase, mix(1.0, 4.0, skew));
        }
        window = atlasGrainWindow(grainPhase, u32(clamp(round(p0.z), 0.0, 3.0)), p0.w);
        let signedLobes = window * (window * 2.0 - 1.0);
        window = mix(window, signedLobes, clamp(p1.z, 0.0, 1.0));
      }
      result = vec2<f32>(window * p1.w);
    }
    case 91u: {
      let minimum = max(min(p0.x, p0.y), 0.000001);
      let maximum = max(max(p0.x, p0.y), minimum + 0.000001);
      let transformed = inputA.x * p1.x + p1.y;
      let bipolarUnit = transformed * 0.5 + 0.5;
      var unit = mix(bipolarUnit, transformed, clamp(p0.w, 0.0, 1.0));
      unit = clamp(unit, 0.0, 1.0);
      unit = mix(unit, 1.0 - unit, clamp(p1.z, 0.0, 1.0));
      let curved = pow(unit, max(p0.z, 0.01));
      result = vec2<f32>(minimum * pow(maximum / minimum, curved) * p1.w);
    }
    case 92u: {
      let baseHz = p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0);
      let stereoRatio = exp2(clamp(p1.x, 0.0, 40.0) / 1200.0);
      let frequencies = clamp(
        vec2<f32>(baseHz / stereoRatio, baseHz * stereoRatio),
        vec2<f32>(1.0),
        vec2<f32>(SAMPLE_RATE * 0.45)
      );
      let roundness = clamp(p0.z + inputA.x * p0.w, 0.0, 0.98);
      let waveform = u32(clamp(round(p0.y), 0.0, 1.0));
      let leftPhase = phaseAtSample(sampleIndex, frequencies.x);
      let rightPhase = phaseAtSample(sampleIndex, frequencies.y);
      let rounded = vec2<f32>(
        select(atlasRoundedSaw(leftPhase, roundness), atlasRoundedSquare(leftPhase, roundness), waveform == 1u),
        select(atlasRoundedSaw(rightPhase, roundness), atlasRoundedSquare(rightPhase, roundness), waveform == 1u)
      );
      let hostWaveform = select(2u, 3u, waveform == 1u);
      let reference = vec2<f32>(
        oscillatorWave(leftPhase, frequencies.x / SAMPLE_RATE, hostWaveform, 0.5),
        oscillatorWave(rightPhase, frequencies.y / SAMPLE_RATE, hostWaveform, 0.5)
      );
      let wave = mix(reference, rounded, clamp(p1.z, 0.0, 1.0));
      result = softClip(wave * max(p1.y, 0.0)) * p1.w;
    }
    case 93u: {
      let fundamental = clamp(
        p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0),
        1.0,
        SAMPLE_RATE * 0.45
      );
      let partialCount = u32(clamp(round(p0.y), 1.0, 48.0));
      let cutoff = clamp(p0.z * exp2(inputA.x * p1.z), 10.0, SAMPLE_RATE * 0.46);
      let resonance = clamp(p0.w, 0.0, 8.0);
      let slope = clamp(p1.x, 0.5, 8.0);
      let phaseColorAmount = clamp(p1.y, 0.0, 1.0);
      var sum = 0.0;
      var energy = 0.0;
      for (var partial = 1u; partial <= 48u; partial += 1u) {
        if (partial > partialCount) { break; }
        let partialHz = fundamental * f32(partial);
        let nyquistFade = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, partialHz);
        if (nyquistFade <= 0.000001) { continue; }
        let ratio = clamp(partialHz / cutoff, 0.0001, 10000.0);
        let lowpass = inverseSqrt(1.0 + pow(ratio, slope * 2.0));
        let resonanceDistance = log2(ratio) / 0.22;
        let resonancePeak = 1.0 + resonance * exp(-0.5 * resonanceDistance * resonanceDistance);
        let amplitude = lowpass * resonancePeak * nyquistFade / f32(partial);
        let partialPhaseColor = atan(ratio) * phaseColorAmount;
        sum += sin(TAU * phaseAtSample(sampleIndex, partialHz) - partialPhaseColor) * amplitude;
        energy += amplitude * amplitude;
      }
      result = vec2<f32>(sum / max(sqrt(energy), 1.0) * p1.w);
    }
    case 94u: {
      let offset = fract(p1.w);
      let uniforms = clamp(
        fract(vec2<f32>(inputA.x, inputB.x) * 0.5 + vec2<f32>(0.5 + offset, 0.5 + offset * 0.61803398875)),
        vec2<f32>(0.000001),
        vec2<f32>(0.999999)
      );
      let radius = sqrt(-2.0 * log(uniforms.x));
      let independent = vec2<f32>(cos(TAU * uniforms.y), sin(TAU * uniforms.y)) * radius;
      let correlation = clamp(p0.w, -0.98, 0.98);
      let correlated = vec2<f32>(
        independent.x,
        independent.x * correlation + independent.y * sqrt(max(1.0 - correlation * correlation, 0.0))
      );
      let centered = atlasRotate(correlated, p1.x) * max(p0.z, 0.0);
      let safety = max(p1.y, 0.0001);
      let bounded = clamp(centered, vec2<f32>(-safety), vec2<f32>(safety));
      result = (bounded + vec2<f32>(p0.x, p0.y)) * p1.z;
    }
    case 95u: {
      let coordinates = atlasCycleCoordinates(sampleIndex, p0.x, 0.0);
      let age = f32(coordinates.y) / SAMPLE_RATE;
      let periodTime = f32(coordinates.z) / SAMPLE_RATE;
      let requestedAttack = max(p0.w, 1.0 / SAMPLE_RATE);
      let requestedHold = max(p1.x, 0.0);
      let requestedRelease = max(p1.y, 1.0 / SAMPLE_RATE);
      let requestedTotal = requestedAttack + requestedHold + requestedRelease;
      let availableSegments = max(periodTime - 2.0 / SAMPLE_RATE, 1.0 / SAMPLE_RATE);
      let segmentScale = min(1.0, availableSegments / max(requestedTotal, 1.0 / SAMPLE_RATE));
      let attackTime = max(requestedAttack * segmentScale, 1.0 / SAMPLE_RATE);
      let holdEnd = attackTime + requestedHold * segmentScale;
      let releaseTime = max(requestedRelease * segmentScale, 1.0 / SAMPLE_RATE);
      var internalEnvelope = smootherstep01(age / attackTime);
      if (age >= holdEnd) {
        internalEnvelope = 1.0 - smootherstep01((age - holdEnd) / releaseTime);
      }
      internalEnvelope = clamp(internalEnvelope, 0.0, 1.0);
      let externalEnvelope = clamp(inputB.x, 0.0, 1.0);
      let envelope = mix(internalEnvelope, externalEnvelope, clamp(p1.z, 0.0, 1.0));
      let attenuation = clamp(envelope * p0.y, 0.0, 1.0);
      let gain = mix(1.0, clamp(p0.z, 0.0, 1.0), attenuation);
      result = inputA * gain * p1.w;
    }
    case 96u: {
      let centerHz = clamp(
        p0.x * exp2((inputA.x + render_info.performancePitch) / 12.0),
        1.0,
        SAMPLE_RATE * 0.42
      );
      let voiceCount = u32(clamp(round(p0.y), 1.0, 12.0));
      let width = clamp(p1.y + inputB.x * 0.25, 0.0, 1.0);
      var bank = vec2<f32>(0.0);
      for (var voice = 0u; voice < 12u; voice += 1u) {
        if (voice >= voiceCount) { break; }
        var position = 0.0;
        if (voiceCount > 1u) {
          position = f32(voice) / f32(voiceCount - 1u) * 2.0 - 1.0;
        }
        let semitones = position * p0.w * f32(voiceCount - 1u) * 0.5 + position * p1.x / 100.0;
        let voiceHz = clamp(centerHz * exp2(semitones / 12.0), 1.0, SAMPLE_RATE * 0.45);
        let driftRate = 0.071 + f32(voice) * 0.017;
        let driftFraction = exp2(p1.z / 1200.0) - 1.0;
        let driftPhase = fract(phaseAtSample(sampleIndex, driftRate) + hashU32(voice * 104729u + 8191u));
        let driftCycles = -voiceHz * driftFraction / (TAU * driftRate) * cos(TAU * driftPhase);
        let phase = fract(phaseAtSample(sampleIndex, voiceHz) + driftCycles + hashU32(voice * 65537u + 17u));
        let wave = oscillatorWave(phase, voiceHz / SAMPLE_RATE, u32(clamp(round(p0.z), 0.0, 3.0)), 0.5);
        let pan = position * width;
        let gains = sqrt(max(vec2<f32>(0.5 * (1.0 - pan), 0.5 * (1.0 + pan)), vec2<f32>(0.0)));
        bank += gains * wave;
      }
      result = softClip(bank * inverseSqrt(f32(voiceCount)) * p1.w * 1.2);
    }
    case 97u: {
      let coordinates = atlasCycleCoordinates(sampleIndex, p0.x, 0.0);
      let pathLength = u32(clamp(round(p0.y), 2.0, 128.0));
      let pathPosition = (f32(coordinates.x % pathLength) + f32(coordinates.y) / f32(max(coordinates.z, 1u))) / f32(pathLength);
      var point = vec2<f32>(
        pathPosition * p0.w,
        sin(TAU * pathPosition * 1.61803398875) * 0.65 * p0.w
      );
      point = atlasRotate(point, p1.x);
      let axes = vec3<f32>(point.x, point.x * 0.5 + point.y * 0.8660254, point.x * 0.5 - point.y * 0.8660254);
      let cells = abs(fract(axes) * 2.0 - vec3<f32>(1.0));
      let triangularField = 1.0 - min(cells.x, min(cells.y, cells.z));
      let hexagonalField = clamp((cos(TAU * axes.x) + cos(TAU * axes.y) + cos(TAU * axes.z)) / 6.0 + 0.5, 0.0, 1.0);
      let field = mix(triangularField, hexagonalField, clamp(p0.z, 0.0, 1.0));
      var gate = smoothstep(p1.y - 0.055, p1.y + 0.055, field);
      let scale = u32(clamp(round(p1.z), 0.0, 6.0));
      let noteCount = atlasScaleSize(scale) * u32(clamp(round(p1.w), 1.0, 4.0));
      let identity = coordinates.x % pathLength;
      let pitchField = fract(field * 0.73 + hashU32(identity * 2246822519u) * 0.27);
      let pitchPosition = pitchField * f32(noteCount);
      let degree = atlasPitchDegree(pitchField, noteCount);
      let eventPhase = f32(coordinates.y) / f32(max(coordinates.z - 1u, 1u));
      let eventGuard = smootherstep01(eventPhase / 0.08)
        * smootherstep01((1.0 - eventPhase) / 0.08);
      gate *= atlasQuantizedPitchGuard(pitchPosition, 0.12) * eventGuard;
      result = vec2<f32>(inputA.x + arpScalePitch(degree, scale), gate);
    }
    case 98u: {
      let phase = phaseAtSample(sampleIndex, max(p0.x, 0.001));
      let radialPhase = phaseAtSample(sampleIndex, max(p0.x * p0.w, 0.001));
      let radius = 0.06 + 0.94 * (0.5 + 0.5 * sin(TAU * radialPhase));
      let angle = TAU * phase;
      let spiralPhase = fract(((angle + p0.z * log(max(radius, 0.0001))) / TAU) * max(round(p0.y), 1.0) + p1.x);
      let distance = min(spiralPhase, 1.0 - spiralPhase);
      let width = clamp(p1.y, 0.005, 0.48);
      var gate = 1.0 - smoothstep(width, width + max(width * 0.24, 0.003), distance);
      let scale = u32(clamp(round(p1.z), 0.0, 6.0));
      let noteCount = atlasScaleSize(scale) * u32(clamp(round(p1.w), 1.0, 4.0));
      let pitchField = fract(spiralPhase + log2(max(radius, 0.0001)) * 0.125);
      let pitchPosition = pitchField * f32(noteCount);
      let degree = atlasPitchDegree(pitchField, noteCount);
      gate *= atlasQuantizedPitchGuard(pitchPosition, 0.12);
      result = vec2<f32>(inputA.x + arpScalePitch(degree, scale), gate);
    }
    case 99u: {
      let octaveCount = u32(clamp(round(p0.x), 1.0, 6.0));
      let motionPhase = phaseAtSample(sampleIndex, abs(p1.y));
      let motionDirection = select(-1.0, 1.0, p1.y >= 0.0);
      let motion = vec2<f32>(cos(TAU * motionPhase), sin(TAU * motionPhase) * motionDirection);
      let point = vec2<f32>(inputA.x, inputB.x);
      let firstOffset = 1.7 + motion.x * 1.2 + motion.y * 0.5;
      let secondOffset = 7.9 + motion.y * 1.1 - motion.x * 0.43;
      let first = atlasOctaveField(point, octaveCount, p0.y, p0.w, p1.x, firstOffset);
      let second = atlasOctaveField(point + vec2<f32>(4.1, -2.3), octaveCount, p0.y, p0.w, p1.x, secondOffset);
      let warpDepth = p0.z + inputC.x;
      let warped = point + vec2<f32>(first, second) * warpDepth;
      let fieldOffset = 13.1 + motion.x * 0.73 + motion.y * 0.51;
      let field = atlasOctaveField(warped, octaveCount, p0.y, p0.w, p1.x, fieldOffset);
      let gate = smoothstep(p1.z - p1.w, p1.z + p1.w, field);
      result = vec2<f32>(field, gate);
    }
    case 100u: {
      let iterations = u32(clamp(round(p0.x), 1.0, 12.0));
      let randomOffset = hashU32(u32(round(abs(p1.z))));
      let offsetAngle = randomOffset * TAU + inputC.x * 0.7;
      let offset = vec2<f32>(cos(offsetAngle), sin(offsetAngle)) * (0.55 + inputC.x * 0.18);
      var orbit = atlasRotate(vec2<f32>(inputA.x, inputB.x) * p0.y, p0.z);
      var trapDistance = 1000000.0;
      for (var iteration = 0u; iteration < 12u; iteration += 1u) {
        if (iteration >= iterations) { break; }
        let folded = mix(orbit, abs(orbit), clamp(p0.w, 0.0, 1.0));
        orbit = folded / max(dot(folded, folded), 0.02) - offset;
        orbit = clamp(orbit, vec2<f32>(-32.0), vec2<f32>(32.0));
        trapDistance = min(trapDistance, abs(length(orbit) - p1.x));
      }
      let width = max(p1.y, 0.001);
      let gate = 1.0 - smoothstep(width, width + max(width * 0.25, 0.003), trapDistance);
      result = vec2<f32>(trapDistance * p1.w, gate);
    }
`;
