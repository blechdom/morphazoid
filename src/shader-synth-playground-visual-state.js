const freeze = (value) => Object.freeze(value);

function port(id, label, type, options = {}) {
  return freeze({
    id,
    label,
    type,
    types: freeze([...(options.types ?? [type])]),
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
    stateful: true,
    aliases: freeze([...(spec.aliases ?? [])]),
    tags: freeze([...(spec.tags ?? [])]),
    inputs: freeze([...(spec.inputs ?? [])]),
    outputs: freeze([...(spec.outputs ?? [])]),
    params: freeze([...(spec.params ?? [])]),
    state: freeze({ ...spec.state }),
    faust: spec.faust ? freeze({ ...spec.faust }) : null,
  });
}

const pitchGateOutputs = () => [
  port("pitch", "pitch", "control", { component: "x" }),
  port("gate", "gate", "control", { component: "y" }),
];

const fieldGateOutputs = () => [
  port("field", "field", "control", { component: "x" }),
  port("gate", "gate", "control", { component: "y" }),
];

const coordinateOutputs = () => [
  port("x", "x", "control", { component: "x" }),
  port("y", "y", "control", { component: "y" }),
];

const stereoOutput = () => [port("out", "stereo", "stereo")];

export const SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS = freeze({
  cellularAutomatonScore: 105,
  reactionDiffusionLattice: 106,
  geometricFeedbackLattice: 107,
  spectralSdf: 108,
  flowFieldAdvection: 109,
  raymarchResonator: 110,
});

/**
 * These modules deliberately describe the passes and memory they actually
 * require. They are not sample-independent stand-ins for stateful algorithms.
 * The runtime allocates each family's private GPU resources only while at
 * least one node of that family is present in the active graph, and releases
 * them when the last node is removed.
 *
 * Parameter order is fixed: descriptors 0..3 occupy p0.xyzw and 4..7 occupy
 * p1.xyzw in both the graph and visual-state pipelines.
 */
export const SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_MODULES = freeze([
  moduleSpec({
    id: "cellular-automaton-score",
    kind: SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS.cellularAutomatonScore,
    name: "Cellular Automaton Score",
    category: "geometry",
    color: "#ff8ccf",
    aliases: ["elementary cellular automaton", "rule score", "cellular sequencer", "CA rhythm"],
    tags: ["cellular automaton", "persistent grid", "rule", "sequencer", "pitch", "gate"],
    description: "Evolves an elementary cellular-automaton row on the GPU. A moving read head turns live cells into gates, while cell position and neighborhood become quantized pitch.",
    execution: "Persistent GPU grid · ordered generation pass at event boundaries · active nodes only",
    wgsl: "nextCell = (rule >> neighborhood) & 1u; out = vec2(quantizedPitch, edgeSafeGate);",
    auditionKind: "pitch-gate",
    auditionPreset: null,
    inputs: [port("root", "root / transpose", "control")],
    outputs: pitchGateOutputs(),
    params: [
      parameter("rate", "Generation rate", 0.1, 32, 5, { step: 0.01, unit: "Hz", scale: "log", low: "slow generations", high: "rapid generations", behavior: "Sets how often the automaton advances to a new row and the musical read head advances." }),
      parameter("rule", "Rule", 0, 255, 90, { step: 1, low: "rule 0", high: "rule 255", behavior: "Selects the complete eight-entry elementary cellular-automaton transition table." }),
      parameter("cells", "Active cells", 8, 128, 48, { step: 1, low: "small ring", high: "wide row", behavior: "Sets how many cells participate in wrapped neighbor evolution and pitch addressing." }),
      parameter("seed", "Seed", 1, 65535, 17011, { step: 1, low: "initial row A", high: "initial row B", behavior: "Selects a repeatable initial population and resets this node's private state when changed." }),
      parameter("density", "Seed density", 0.01, 0.99, 0.34, { step: 0.01, low: "few live cells", high: "many live cells", behavior: "Sets the probability that each cell is alive in the seeded row." }),
      parameter("stride", "Read stride", 1, 31, 5, { step: 1, low: "neighbor cells", high: "wide jumps", behavior: "Changes which wrapped cell is read after every generation, producing different cycles from the same rule." }),
      parameter("scale", "Pitch scale", 0, 6, 2, { step: 1, options: ["Chromatic", "Major", "Minor", "Pentatonic", "Whole tone", "Octatonic", "Quarter-tone"], low: "chromatic", high: "quarter-tone", behavior: "Maps cell and neighborhood identity onto a musical pitch collection, including quarter-tone steps." }),
      parameter("octaves", "Pitch span", 1, 4, 3, { step: 1, unit: "oct", low: "compact", high: "wide", behavior: "Sets how many octaves the active row can address." }),
    ],
    state: {
      family: "cellular-automaton",
      resources: "two ping-pong integer cell rows",
      lifecycle: "allocate on first active node; release after last active node",
      resetParams: freeze(["rule", "cells", "seed", "density"]),
    },
    faust: { symbol: "select2, ba.pulse", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),

  moduleSpec({
    id: "reaction-diffusion-score-lattice",
    kind: SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS.reactionDiffusionLattice,
    name: "Reaction–Diffusion Score Lattice",
    category: "geometry",
    color: "#73e7ff",
    aliases: ["reaction-diffusion lattice", "gray scott", "reaction diffusion", "chemical texture", "Turing pattern"],
    tags: ["reaction diffusion", "Gray-Scott", "persistent texture", "field", "gate", "lattice"],
    description: "Evolves two coupled concentrations across a wrapped GPU surface. Patched X/Y coordinates sample its moving chemical field; contour strength supplies a related gate.",
    execution: "Persistent ping-pong GPU surface · bounded Gray–Scott update passes · active nodes only",
    wgsl: "aNext = a + (diffA * laplaceA - a*b*b + feed*(1-a)) * dt;",
    auditionKind: "field-gate",
    auditionPreset: null,
    inputs: [
      port("x", "sample X", "control", { required: true }),
      port("y", "sample Y", "control", { required: true }),
    ],
    outputs: fieldGateOutputs(),
    params: [
      parameter("speed", "Evolution speed", 0, 4, 1, { step: 0.01, unit: "×", low: "frozen surface", high: "fast evolution", behavior: "Scales the stable integration step without changing the audio sample clock." }),
      parameter("feed", "Feed", 0.01, 0.09, 0.037, { step: 0.0001, low: "slow replenishment", high: "rapid replenishment", behavior: "Controls how quickly chemical A returns and changes the family of spots, stripes, and waves." }),
      parameter("kill", "Kill", 0.03, 0.08, 0.06, { step: 0.0001, low: "persistent B", high: "short-lived B", behavior: "Controls chemical B removal and shifts the lattice between expanding, splitting, and vanishing structures." }),
      parameter("diffusionA", "A diffusion", 0.1, 1.2, 1, { step: 0.01, low: "local A", high: "spreading A", behavior: "Sets how quickly concentration A spreads into neighboring texture cells." }),
      parameter("diffusionB", "B diffusion", 0.05, 1, 0.5, { step: 0.01, low: "local B", high: "spreading B", behavior: "Sets B's independent diffusion rate and therefore the scale and stability of chemical features." }),
      parameter("zoom", "Surface zoom", 0.25, 16, 3.5, { step: 0.01, scale: "log", low: "broad region", high: "fine tiling", behavior: "Scales patched X/Y coordinates before wrapped texture sampling." }),
      parameter("threshold", "Contour threshold", 0.02, 0.98, 0.46, { step: 0.01, low: "dense gates", high: "rare gates", behavior: "Moves the field level around which the click-safe contour gate opens." }),
      parameter("seed", "Seed", 1, 65535, 23173, { step: 1, low: "chemical field A", high: "chemical field B", behavior: "Selects repeatable initial perturbations and resets this node's surface when changed." }),
    ],
    state: {
      family: "reaction-diffusion",
      resources: "two ping-pong two-channel concentration surfaces",
      lifecycle: "allocate on first active node; release after last active node",
      resetParams: freeze(["seed"]),
    },
    faust: { symbol: "rdtable, select2", url: "https://faustdoc.grame.fr/manual/syntax/" },
  }),

  moduleSpec({
    id: "geometric-feedback-lattice",
    kind: SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS.geometricFeedbackLattice,
    name: "Geometric Feedback Lattice",
    category: "space",
    color: "#e883ee",
    aliases: ["feedback delay network", "folded delay grid", "geometric echo lattice", "cellular delay"],
    tags: ["feedback", "delay", "persistent state", "lattice", "fold", "rotation", "effect"],
    description: "Injects audio into a wrapped grid of delay cells. Rotated, repeatedly folded neighbor routes circulate the signal as a spatially patterned feedback network.",
    execution: "Ordered GPU state pass · persistent delay-cell surface · active nodes only",
    wgsl: "cellNext = input + feedback * mix(previousCell, foldedNeighbors, coupling);",
    auditionKind: "effect",
    auditionPreset: null,
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })],
    outputs: stereoOutput(),
    params: [
      parameter("size", "Lattice size", 2, 32, 9, { step: 1, low: "few cells", high: "wide grid", behavior: "Sets the active square grid extent and therefore how many distinct circulation paths can form." }),
      parameter("delay", "Cell delay", 0.5, 180, 19, { step: 0.1, unit: "ms", scale: "log", low: "resonant comb", high: "separate echoes", behavior: "Sets propagation time between successive cell reads." }),
      parameter("feedback", "Feedback", 0, 0.985, 0.78, { step: 0.001, low: "single traversal", high: "long circulation", behavior: "Returns bounded cell output to the grid and controls decay length." }),
      parameter("coupling", "Neighbor coupling", 0, 1, 0.62, { step: 0.01, low: "independent cells", high: "shared energy", behavior: "Moves energy from each cell into its geometrically selected neighbors." }),
      parameter("folds", "Route folds", 1, 8, 4, { step: 1, low: "simple wrap", high: "self-similar routing", behavior: "Sets how many mirror-and-tile operations choose neighbor addresses." }),
      parameter("rotation", "Route rotation", -0.5, 0.5, 0.073, { step: 0.001, unit: "turn", low: "counter-clockwise", high: "clockwise", behavior: "Rotates the virtual lattice before folded neighbor lookup and changes circulation paths." }),
      parameter("damping", "High damping", 0, 1, 0.38, { step: 0.01, low: "bright return", high: "dark return", behavior: "Averages adjacent state samples before feedback so repeated circulation loses high-frequency energy." }),
      parameter("mix", "Wet mix", 0, 1, 0.55, { step: 0.01, low: "dry input", high: "lattice only", behavior: "Crossfades from the current input to the bounded stereo lattice output." }),
    ],
    state: {
      family: "feedback-lattice",
      resources: "delay-cell state surface and circular audio storage",
      lifecycle: "allocate on first active node; release after last active node",
      resetParams: freeze(["size"]),
    },
    faust: { symbol: "de.fdelay, ro.interleave", url: "https://faustlibraries.grame.fr/libs/delays/" },
  }),

  moduleSpec({
    id: "spectral-sdf",
    kind: SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS.spectralSdf,
    name: "Spectral SDF",
    category: "spectral",
    color: "#ff9f68",
    aliases: ["spectral shape", "FFT distance field", "SDF bin mask", "geometric spectrum"],
    tags: ["FFT", "inverse FFT", "SDF", "spectral mask", "overlap add", "effect"],
    description: "Places FFT bins and successive analysis frames in a signed-distance coordinate field. The selected shape keeps, suppresses, or reflects regions before inverse transform.",
    execution: "Block GPU pipeline · windowed FFT → SDF bin transform → inverse FFT and overlap-add",
    wgsl: "mask = smoothstep(edge, -edge, sdShape(binFramePoint)); spectrum *= spectralTransform(mask);",
    auditionKind: "effect",
    auditionPreset: null,
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })],
    outputs: stereoOutput(),
    params: [
      parameter("fftSize", "FFT size", 256, 2048, 1024, { step: 256, unit: "samples", low: "fast / coarse", high: "detailed / latent", behavior: "Selects the bounded power-of-two analysis size, trading time localization for frequency resolution." }),
      parameter("shape", "Shape", 0, 5, 0, { step: 1, options: ["Circle", "Box", "Diamond", "Ring", "Cross", "Spiral"], low: "round region", high: "spiral region", behavior: "Changes the signed-distance formula applied across bin and frame coordinates." }),
      parameter("size", "Shape extent", 0.03, 1.5, 0.58, { step: 0.01, low: "small spectral island", high: "broad spectral region", behavior: "Scales the kept or transformed SDF region across time and frequency." }),
      parameter("rotation", "Shape rotation", -0.5, 0.5, 0.08, { step: 0.001, unit: "turn", low: "counter-rotated", high: "rotated", behavior: "Rotates frame/bin coordinates before distance evaluation and redirects diagonal spectral motion." }),
      parameter("edge", "Boundary softness", 0.001, 0.35, 0.045, { step: 0.001, low: "hard bin edge", high: "soft transition", behavior: "Sets the antialiased distance band around the spectral shape boundary." }),
      parameter("depth", "Shape depth", -1, 1, 0.86, { step: 0.01, low: "invert region", high: "keep region", behavior: "Controls whether the inside or outside dominates and how strongly the SDF mask changes bin magnitudes." }),
      parameter("mix", "Wet mix", 0, 1, 0.72, { step: 0.01, low: "dry input", high: "resynthesized", behavior: "Crossfades from latency-aligned input to overlap-added inverse-transform audio." }),
      parameter("level", "Level", 0, 1.5, 0.9, { step: 0.01, low: "quiet", high: "strong", behavior: "Scales the normalized resynthesis result before the wet/dry blend." }),
    ],
    state: {
      family: "spectral-sdf",
      resources: "analysis windows, complex spectra, and overlap-add rings",
      lifecycle: "allocate on first active node; release after last active node",
      resetParams: freeze(["fftSize"]),
    },
    faust: { symbol: "an.fft, an.ifft", url: "https://faustlibraries.grame.fr/libs/analyzers/" },
  }),

  moduleSpec({
    id: "flow-field-advection",
    kind: SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS.flowFieldAdvection,
    name: "Flow-field Advection",
    category: "geometry",
    color: "#62f0d4",
    aliases: ["particle flow", "curl field", "advected coordinates", "vector field"],
    tags: ["flow field", "advection", "particles", "curl", "persistent state", "coordinates"],
    description: "Advects a persistent particle cloud through a curl-like vector field. Patched X/Y supplies a moving attractor; the output is the cloud centroid and anisotropy as two related controls.",
    execution: "Persistent GPU particle buffers · bounded advection and reduction passes · active nodes only",
    wgsl: "velocity = velocity * drag + curl(position * fieldScale) + attraction; position += velocity * dt;",
    auditionKind: "coordinate",
    auditionPreset: null,
    inputs: [
      port("x", "attractor X", "control", { required: true }),
      port("y", "attractor Y", "control", { required: true }),
    ],
    outputs: coordinateOutputs(),
    params: [
      parameter("speed", "Advection speed", 0, 8, 1.2, { step: 0.01, unit: "×", low: "frozen particles", high: "fast trajectories", behavior: "Scales the stable particle integration step." }),
      parameter("particles", "Particles", 8, 256, 96, { step: 8, low: "few paths", high: "dense cloud", behavior: "Sets how many persistent particle lanes contribute to the reduced control outputs." }),
      parameter("fieldScale", "Field scale", 0.1, 16, 2.7, { step: 0.01, scale: "log", low: "broad currents", high: "fine eddies", behavior: "Scales position before vector-field evaluation and changes the spatial size of curls." }),
      parameter("curl", "Curl strength", -4, 4, 1.35, { step: 0.01, low: "reverse rotation", high: "forward rotation", behavior: "Sets magnitude and direction of rotational acceleration around flow-field contours." }),
      parameter("drag", "Momentum", 0, 0.999, 0.92, { step: 0.001, low: "quickly damped", high: "long trajectories", behavior: "Sets how much velocity survives into the next persistent update." }),
      parameter("attraction", "Attractor force", -2, 2, 0.36, { step: 0.01, low: "repelled", high: "attracted", behavior: "Pushes particles away from or toward the patched X/Y position." }),
      parameter("seed", "Seed", 1, 65535, 44711, { step: 1, low: "cloud A", high: "cloud B", behavior: "Selects repeatable particle positions and resets this node's cloud when changed." }),
      parameter("spread", "Output spread", 0, 2, 0.82, { step: 0.01, low: "centroid only", high: "wide anisotropy", behavior: "Blends cloud-shape variance into the X/Y centroid outputs, increasing independent movement." }),
    ],
    state: {
      family: "flow-advection",
      resources: "ping-pong particle position/velocity buffers and reduction scratch",
      lifecycle: "allocate on first active node; release after last active node",
      resetParams: freeze(["particles", "seed"]),
    },
    faust: { symbol: "si.bus, min, max", url: "https://faustdoc.grame.fr/manual/syntax/" },
  }),

  moduleSpec({
    id: "raymarch-resonator",
    kind: SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS.raymarchResonator,
    name: "Raymarch Resonator",
    category: "spectral",
    color: "#c790ff",
    aliases: ["SDF resonator", "raymarch modes", "geometric modal bank", "shape resonator"],
    tags: ["raymarch", "SDF", "modal synthesis", "resonator", "persistent state", "effect"],
    description: "Raymarches a bounded signed-distance shape to derive path lengths and surface identities, then uses those measurements as frequencies and gains in a persistent modal resonator bank.",
    execution: "Dedicated GPU state projection · bounded SDF ray pass and transient modal coefficients · no persistent grid",
    wgsl: "distance += sdShape(rayOrigin + rayDirection * distance); mode = resonator(excitation, pathLength);",
    auditionKind: "effect",
    auditionPreset: null,
    inputs: [port("excite", "excitation", "audio", { types: ["audio", "stereo"], required: true })],
    outputs: stereoOutput(),
    params: [
      parameter("modes", "Modes", 2, 48, 18, { step: 1, low: "few resonances", high: "dense body", behavior: "Sets how many ray-derived modal recurrences are evaluated and energy-normalized." }),
      parameter("shape", "Shape", 0, 5, 1, { step: 1, options: ["Sphere", "Box", "Torus", "Capsule", "Cross", "Folded prism"], low: "smooth body", high: "faceted body", behavior: "Changes the signed-distance geometry from which path lengths and surface weights are measured." }),
      parameter("size", "Body size", 0.1, 4, 1, { step: 0.01, scale: "log", low: "small / high modes", high: "large / low modes", behavior: "Scales ray path lengths and therefore shifts the complete modal frequency family." }),
      parameter("reflectivity", "Reflectivity", 0, 0.999, 0.92, { step: 0.001, low: "absorbing surface", high: "reflective surface", behavior: "Sets how strongly later ray hits and modal recurrences retain energy." }),
      parameter("damping", "High damping", 0, 1, 0.42, { step: 0.01, low: "bright decay", high: "dark decay", behavior: "Shortens higher modes relative to low ones and darkens the resonant tail." }),
      parameter("brightness", "Surface brightness", -1, 1, 0.25, { step: 0.01, low: "low modes", high: "high modes", behavior: "Tilts excitation weights across ray-derived modes without changing their frequencies." }),
      parameter("stereo", "Ray spread", 0, 1, 0.72, { step: 0.01, low: "centered modes", high: "wide reflections", behavior: "Distributes surface identities and alternating ray directions across stereo." }),
      parameter("mix", "Wet mix", 0, 1, 0.78, { step: 0.01, low: "dry excitation", high: "resonator only", behavior: "Crossfades from latency-aligned excitation to the bounded modal result." }),
    ],
    state: {
      family: "raymarch-resonator",
      resources: "transient per-chunk ray and modal projection scratch; no persistent surface",
      lifecycle: "dispatch while active; no persistent-grid allocation",
      resetParams: freeze([]),
    },
    faust: { symbol: "pm.modeFilter", url: "https://faustlibraries.grame.fr/libs/physmodels/" },
  }),
]);

export const SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KIND_SET = freeze(new Set(
  Object.values(SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS),
));

export function isShaderSynthPlaygroundVisualStateKind(kind) {
  return SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KIND_SET.has(Number(kind));
}

// The dedicated state engine writes one vec2 for every active state node and
// sample. The ordinary graph evaluator consumes that value so downstream
// modules retain the same typed fan-out and ordering rules as every other node.
export const SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_CASES = /* wgsl */ `
    case 105u: { result = stateValue; }
    case 106u: { result = stateValue; }
    case 107u: { result = stateValue; }
    case 108u: { result = stateValue; }
    case 109u: { result = stateValue; }
    case 110u: { result = stateValue; }
`;
