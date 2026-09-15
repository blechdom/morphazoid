const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)));

/**
 * The three existing Graph instruments that become playing modes in Graphs.
 * `href` records the source instrument for compatibility and comparison; the
 * combined app owns one graph rather than embedding those pages.
 */
export const GRAPHS_APP_MODES = freezeList([
  {
    id: "synth",
    label: "Synth",
    title: "Graph Synth",
    href: "graph-synth.html",
    audioKind: "synth",
    accent: "#b299ff",
  },
  {
    id: "drums",
    label: "Drums",
    title: "Graph Drum Machine",
    href: "graph-drums.html",
    audioKind: "drums",
    accent: "#ffad69",
  },
  {
    id: "mic",
    label: "Mic",
    title: "Graph Delay",
    href: "graph-delay.html",
    audioKind: "mic",
    accent: "#68e0d2",
  },
]);

const modeIds = new Set(GRAPHS_APP_MODES.map(({ id }) => id));
const allModes = Object.freeze(GRAPHS_APP_MODES.map(({ id }) => id));
const parameter = (id, label, modes, notes = "") => Object.freeze({
  id,
  label,
  modes: Object.freeze(modes.filter((mode) => modeIds.has(mode))),
  notes,
});

/** State that should have one authoritative value while modes change. */
export const GRAPHS_IDENTICAL_PARAMETERS = freezeList([
  parameter("topology", "Graph shape", allModes, "One of the ten canonical graph generators feeds every mode."),
  parameter("nodeCount", "Nodes", allModes, "One node set and identity map survives mode switching; the combined live graph uses the microphone-safe ceiling."),
  parameter("density", "Connection density", allModes, "One deterministic edge set is generated from density and seed."),
  parameter("seed", "Graph seed", allModes, "One seed reproduces topology before any hand-edited layout changes."),
  parameter("nodePositions", "Node positions", allModes, "Dragged, arranged, randomized, or animated coordinates remain the score for every mode."),
  parameter("edgeSwitches", "Route switches", allModes, "One enabled-route map controls event traversal and live signal flow."),
  parameter("baseDelay", "Minimum edge time", allModes, "One millisecond floor anchors the timing of every directed edge."),
  parameter("distanceRatio", "Distance-time ratio", allModes, "One dimensionless edge-length spread replaces Graph Delay's equivalent additive timeScale representation."),
  parameter("timeCurve", "Length response", allModes, "One exponent maps normalized edge length to route time."),
  parameter("nodePass", "Node pass-through", allModes, "One bounded split/merge-normalized gain controls forward propagation."),
  parameter("feedback", "Cycle return", allModes, "Only cycle-closing feedbackEdge routes apply this bounded return coefficient."),
  parameter("nodeMotionMode", "Node path", allModes, "Wiggle, orbit, and random-walk motion use the same visible geometry."),
  parameter("nodeMotionSpeed", "Node speed", allModes, "One motion rate changes edge timing and mappings without launching a new event."),
  parameter("nodeMotionAmount", "Node travel", allModes, "One travel radius bounds the animated displacement."),
  parameter("audio", "Audio armed state", allModes, "One explicit Audio state hands off safely between the selected engine routes."),
  parameter("level", "Master level", allModes, "One protected output level feeds synth voices, percussion, or microphone processing."),
]);

/** Shared musical ideas whose current implementations use different units or maps. */
export const GRAPHS_ANALOG_PARAMETERS = freezeList([
  parameter("graphPatch", "Graph preset", allModes, "Synth and Drums share eight timing patches; Mic has fourteen full delay scenes with different parameter ownership."),
  parameter("sourcePosition", "Graph input position", allModes, "One draggable input terminal changes entry delay and first-turn mapping for Synth, Drums, and live Mic routing."),
  parameter("turnPitch", "Turn to pitch", allModes, "Synth accumulates route intervals, Drums retunes strikes, and Mic shifts every incoming-to-outgoing audio route."),
  parameter("feedbackTone", "Feedback tone loss", allModes, "Event modes retain normalized brightness per lap; Mic uses a low-pass damping cutoff."),
  parameter("stereoSpread", "Stereo spread", allModes, "Synth pans node attacks, Drums separate attack lanes, and Mic pans audible sink taps."),
  parameter("mappingMode", "Graph mapping", ["synth", "drums", "mic"], "Synth and Drums expose alternate coordinate/degree/path maps; Mic directly maps local turns and sink positions."),
  parameter("seedNote", "Seed note", ["synth", "drums"], "A MIDI root launches independent event traversals; Mic receives a continuous, unpitched source."),
  parameter("pulseClock", "Pulse clock", ["synth", "drums"], "Tempo and pulse interval launch discrete graph runs; Mic is continuously driven."),
  parameter("attackPolicy", "Attack points", ["synth", "drums"], "Event modes can sound every node or only leaves; Mic currently taps forward sinks."),
]);

export const GRAPHS_UNIQUE_PARAMETERS = Object.freeze({
  synth: freezeList([
    parameter("triggerScope", "Attack points", ["synth"]),
    parameter("attackLaneCount", "Attack separation", ["synth"]),
    parameter("synthMappingMode", "Graph to pitch", ["synth"]),
    parameter("turnPitchScale", "Full-turn pitch travel", ["synth"]),
    parameter("pitchRange", "Position / Shepard span", ["synth"]),
    parameter("tuningMode", "Pitch system", ["synth"]),
    parameter("edoDivisions", "Equal divisions per octave", ["synth"]),
    parameter("soundMode", "Voice", ["synth"]),
    parameter("modulationIndex", "Modulation depth", ["synth"]),
    parameter("modulationRatio", "Modulation ratio", ["synth"]),
    parameter("articulation", "Triggered or edge gate", ["synth"]),
    parameter("noteDuration", "Triggered duration", ["synth"]),
    parameter("adsr", "Attack / decay / sustain / release", ["synth"]),
  ]),
  drums: freezeList([
    parameter("triggerScope", "Attack points", ["drums"]),
    parameter("attackLaneCount", "Attack separation", ["drums"]),
    parameter("drumMappingMode", "Node to voice", ["drums"]),
    parameter("percussionStyle", "Percussion style", ["drums"]),
    parameter("drumMap", "Sixteen percussion voices", ["drums"]),
    parameter("pitchDepth", "Height / progress to pitch", ["drums"]),
    parameter("turnPitchDepth", "Turn to pitch", ["drums"]),
    parameter("characterDepth", "Graph to character", ["drums"]),
  ]),
  mic: freezeList([
    parameter("microphoneInput", "Microphone permission / input", ["mic"]),
    parameter("inputTrim", "Input trim", ["mic"]),
    parameter("inputPosition", "Microphone terminal", ["mic"]),
    parameter("pitchScale", "Angle to octave span", ["mic"]),
    parameter("pitchAsymmetry", "Turn asymmetry", ["mic"]),
    parameter("pitchCurve", "Angle response", ["mic"]),
    parameter("pitchSlew", "Pitch glide", ["mic"]),
    parameter("damping", "Feedback damping", ["mic"]),
    parameter("wet", "Graph presence", ["mic"]),
    parameter("dry", "Direct microphone", ["mic"]),
    parameter("inputMeter", "Input signal meter", ["mic"]),
    parameter("panic", "Stop input and graph tails", ["mic"]),
  ]),
});

export const GRAPHS_CROSSOVER_PARAMETERS = freezeList([
  {
    id: "time-scale-to-distance-ratio",
    from: "mic",
    parameter: "timeScale",
    to: Object.freeze(["synth", "drums"]),
    recommendation: "Represent every edge as baseDelay × (1 + length^curve × (distanceRatio - 1)); distanceRatio = 1 + timeScale / baseDelay preserves Graph Delay timing exactly inside the shared range.",
  },
  {
    id: "microphone-position-to-event-source",
    from: "mic",
    parameter: "inputPosition",
    to: Object.freeze(["synth", "drums"]),
    recommendation: "Use the draggable source terminal for event entry time and first-turn mapping as well as live microphone routing.",
  },
  {
    id: "turn-shaping-to-event-pitch",
    from: "mic",
    parameter: "pitchAsymmetry/pitchCurve",
    to: Object.freeze(["synth", "drums"]),
    recommendation: "Apply left/right asymmetry and response curvature before event-mode turn intervals are accumulated or used to retune percussion.",
  },
  {
    id: "synth-tuning-to-turn-network",
    from: "synth",
    parameter: "tuningMode",
    to: Object.freeze(["drums", "mic"]),
    recommendation: "Offer pure, equal-division, and just-ratio turn intervals to percussion and live pitch routes while keeping Pure continuous as the default for Mic.",
  },
  {
    id: "drum-maps-to-synth-character",
    from: "drums",
    parameter: "drumMappingMode",
    to: Object.freeze(["synth", "mic"]),
    recommendation: "Reuse position grid, degree × turn, and path × cycle as optional timbre or routing maps without replacing pitch mapping.",
  },
  {
    id: "sink-policy-to-all-modes",
    from: "synth/drums",
    parameter: "triggerScope",
    to: Object.freeze(["mic"]),
    recommendation: "Expose every-node versus sink-only listening as one graph-output policy, with live-feedback normalization recalculated before enabling every-node taps.",
  },
  {
    id: "direct-source-to-event-modes",
    from: "mic",
    parameter: "dry",
    to: Object.freeze(["synth", "drums"]),
    recommendation: "Use Direct as a bounded immediate root voice or strike so long acyclic routes remain playable before their first delayed arrival.",
  },
  {
    id: "mode-aware-scene-presets",
    from: "synth/drums/mic",
    parameter: "graphPatch",
    to: Object.freeze(allModes),
    recommendation: "Keep topology, layout, switches, and timing shared while preserving separate Synth, Drums, and Mic sound banks and their existing preset ownership.",
  },
]);

export const GRAPH_DISTANCE_RATIO_MIN = 1;
export const GRAPH_DISTANCE_RATIO_MAX = 12;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * Convert Graph Delay's additive length spread into the event instruments'
 * multiplicative representation. Callers can compare the result with the
 * exported 1x–12x range before applying it to a live control.
 */
export function graphDistanceRatioFromTimeScale(
  baseDelayMilliseconds,
  timeScaleMilliseconds,
) {
  const baseDelay = Math.max(Number.EPSILON, finite(baseDelayMilliseconds));
  const timeScale = Math.max(0, finite(timeScaleMilliseconds));
  return 1 + timeScale / baseDelay;
}

/** Inverse of graphDistanceRatioFromTimeScale for representable ratios. */
export function graphTimeScaleFromDistanceRatio(
  baseDelayMilliseconds,
  distanceRatio,
) {
  const baseDelay = Math.max(0, finite(baseDelayMilliseconds));
  const ratio = Math.max(GRAPH_DISTANCE_RATIO_MIN, finite(distanceRatio, 1));
  return baseDelay * (ratio - 1);
}

export function graphsModeFor(id = "synth") {
  return GRAPHS_APP_MODES.find((mode) => mode.id === id) ?? GRAPHS_APP_MODES[0];
}
