import { connectAudioOutput } from "./audio-output-manager.js";
import {
  SHADER_SYNTH_PLAYGROUND_FX_MODULES,
  SHADER_SYNTH_PLAYGROUND_FX_LIMITS,
  SHADER_SYNTH_PLAYGROUND_FX_SHADER,
  SHADER_SYNTH_PLAYGROUND_HISTORY_CAPTURE_SHADER,
  isShaderSynthPlaygroundFxKind,
  shaderSynthPlaygroundFxHistoryByteSize,
  shaderSynthPlaygroundFxHistoryFrames,
  shaderSynthPlaygroundFxNodes,
} from "./shader-synth-playground-fx.js?v=20260830-atlas-dsp";
import { createShaderPlaygroundScenes } from "./shader-synth-playground-scenes.js";
import {
  SHADER_SYNTH_PLAYGROUND_EXTRA_CASES,
  SHADER_SYNTH_PLAYGROUND_EXTRA_HELPERS,
  SHADER_SYNTH_PLAYGROUND_EXTRA_MODULES,
} from "./shader-synth-playground-extra.js";
import {
  SHADER_SYNTH_PLAYGROUND_ATLAS_CASES,
  SHADER_SYNTH_PLAYGROUND_ATLAS_HELPERS,
  SHADER_SYNTH_PLAYGROUND_ATLAS_MODULES,
} from "./shader-synth-playground-atlas.js";
import {
  SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_CASES,
  SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_HELPERS,
  SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_MODULES,
} from "./shader-synth-playground-atlas-routing.js";
import {
  SHADER_SYNTH_PLAYGROUND_FOUND_CASES,
  SHADER_SYNTH_PLAYGROUND_FOUND_HELPERS,
  SHADER_SYNTH_PLAYGROUND_FOUND_MODULES,
} from "./shader-synth-playground-found-sounds.js";
import {
  SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES,
  SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS,
  SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES,
} from "./shader-synth-playground-geometry.js";
import {
  SHADER_SYNTH_PLAYGROUND_STATEFUL_CASES,
  SHADER_SYNTH_PLAYGROUND_STATEFUL_MODULES,
  SHADER_SYNTH_PLAYGROUND_STATEFUL_SHADER,
  ShaderSynthPlaygroundStateEngine,
} from "./shader-synth-playground-stateful.js";
import {
  WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS,
  WEBGPU_SYNTHS_ORGAN_RANK_COUNT,
  sanitizeWebGpuSynthOrganRanks,
  webGpuSynthOrganRankArray,
} from "./webgpu-synths.js";

const freeze = (value) => Object.freeze(value);
const MAX_NODES = 16;
const MAX_CONNECTIONS = 24;
const FLOATS_PER_NODE = 20;
const NODE_BUFFER_SIZE = MAX_NODES * FLOATS_PER_NODE * Float32Array.BYTES_PER_ELEMENT;
const NUM_CHANNELS = 2;
const RENDER_INFO_SIZE = 32;
const FX_STAGE_INFO_SIZE = 16;
const ORGAN_RANK_FLOATS = WEBGPU_SYNTHS_ORGAN_RANK_COUNT * 4;
const ORGAN_RANK_BUFFER_SIZE = ORGAN_RANK_FLOATS * 2 * Float32Array.BYTES_PER_ELEMENT;
const MAX_BUFFERED_CHUNKS = 2.5;
const SCHEDULE_PADDING_SECONDS = 0.05;
const SCHEDULE_LEAD_SECONDS = 0.012;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clone = (value) => JSON.parse(JSON.stringify(value));

function organRankTransitionArray(previousRanks, targetRanks) {
  const data = new Float32Array(ORGAN_RANK_FLOATS * 2);
  data.set(webGpuSynthOrganRankArray(previousRanks), 0);
  data.set(webGpuSynthOrganRankArray(targetRanks), ORGAN_RANK_FLOATS);
  return data;
}

function organRanksEqual(first, second) {
  const a = webGpuSynthOrganRankArray(first);
  const b = webGpuSynthOrganRankArray(second);
  return a.every((value, index) => value === b[index]);
}

function cloneParamMap(params = new Map()) {
  return new Map([...params].map(([id, values]) => [id, [...values]]));
}

function paramMapsEqual(first = new Map(), second = new Map()) {
  if (first.size !== second.size) return false;
  for (const [id, values] of first) {
    const comparison = second.get(id);
    if (!comparison || values.length !== comparison.length) return false;
    if (values.some((value, index) => value !== comparison[index])) return false;
  }
  return true;
}

function encodedAudioMatches(first, second) {
  if (!first || !second) return false;
  if (first.nodeCount !== second.nodeCount || first.outputIndex !== second.outputIndex) return false;
  if (first.order.length !== second.order.length || first.order.some((id, index) => id !== second.order[index])) return false;
  for (let nodeIndex = 0; nodeIndex < second.nodeCount; nodeIndex += 1) {
    const offset = nodeIndex * FLOATS_PER_NODE;
    // Header slots describe kind and routing. Target slots describe the
    // audible parameter state; previous slots are transition bookkeeping.
    for (const slot of [0, 1, 2, 3, 12, 13, 14, 15, 16, 17, 18, 19]) {
      if (first.data[offset + slot] !== second.data[offset + slot]) return false;
    }
  }
  return true;
}

function encodedTopologyMatches(first, second) {
  if (!first || !second) return false;
  if (first.nodeCount !== second.nodeCount || first.outputIndex !== second.outputIndex) return false;
  if (first.order.length !== second.order.length || first.order.some((id, index) => id !== second.order[index])) return false;
  for (let nodeIndex = 0; nodeIndex < second.nodeCount; nodeIndex += 1) {
    const offset = nodeIndex * FLOATS_PER_NODE;
    // Kind and the three encoded input routes are the graph topology. Knob
    // values live in the remaining slots and can flow into the existing
    // monotonic queue without replacing scheduled AudioBufferSource nodes.
    for (let slot = 0; slot < 4; slot += 1) {
      if (first.data[offset + slot] !== second.data[offset + slot]) return false;
    }
  }
  return true;
}

const port = (id, label, type, options = {}) => freeze({
  id,
  label,
  type,
  types: freeze(options.types ?? [type]),
  required: Boolean(options.required),
  component: options.component ?? null,
});

const parameter = (id, label, minimum, maximum, defaultValue, options = {}) => freeze({
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

const moduleSpec = (spec) => freeze({
  ...spec,
  inputs: freeze(spec.inputs ?? []),
  outputs: freeze(spec.outputs ?? []),
  params: freeze(spec.params ?? []),
  faust: spec.faust ? freeze(spec.faust) : null,
});

export const SHADER_PLAYGROUND_LIMITS = freeze({
  maxNodes: MAX_NODES,
  maxConnections: MAX_CONNECTIONS,
  maxInputs: 3,
});

// Shared geometry keeps the compact DOM nodes, automatic layout, new-node
// placement, and drag bounds in agreement. These are editor dimensions only;
// they do not affect the encoded GPU graph.
export const SHADER_PLAYGROUND_LAYOUT_DEFAULTS = freeze({
  nodeWidth: 150,
  nodeHeight: 96,
  gapX: 24,
  gapY: 20,
  marginX: 20,
  marginTop: 52,
  marginBottom: 20,
});

// The readback path is deliberately buffered like the standalone WebGPU 303:
// one 100 ms GPU render at a time, with roughly 300 ms scheduled ahead. The
// extra lead absorbs mapAsync/browser-main-thread jitter before it can open a
// gap between adjacent AudioBufferSourceNodes.
export const SHADER_PLAYGROUND_RUNTIME_DEFAULTS = freeze({
  chunkDuration: 0.1,
  workgroupSize: 256,
  bufferedChunks: MAX_BUFFERED_CHUNKS,
  schedulePadding: SCHEDULE_PADDING_SECONDS,
});

export const SHADER_PLAYGROUND_MODULES = freeze([
  moduleSpec({
    id: "constant", kind: 1, name: "Constant", category: "control", color: "#ffda57",
    description: "Produces a fixed control value for parameters that would otherwise remain unpatched.",
    execution: "Single-sample · uniform value", wgsl: "value = vec2<f32>(amount);", auditionPreset: "moving-drone",
    inputs: [], outputs: [port("out", "value", "control")],
    params: [parameter("amount", "Value", -1, 1, 0, { step: 0.01, low: "negative", high: "positive", behavior: "Moves a destination below or above its base value." })],
    faust: { symbol: "hslider", url: "https://faustdoc.grame.fr/manual/syntax/#user-interface-elements" },
  }),
  moduleSpec({
    id: "clock", kind: 2, name: "Clock phase", category: "control", color: "#ff6eaa",
    description: "Converts absolute sample time into a repeating 0–1 event phase; swing changes alternate phase lengths.",
    execution: "Single-sample · analytic event time", wgsl: "phase = swingPhase(time, rate, swing);", auditionPreset: "pm-bell",
    inputs: [], outputs: [port("phase", "phase", "control")],
    params: [
      parameter("rate", "Rate", 0.25, 16, 2.4, { step: 0.01, unit: "Hz", scale: "log", low: "slow events", high: "rapid events", behavior: "Sets how often a new event begins." }),
      parameter("swing", "Swing", 0, 0.42, 0, { step: 0.01, low: "even", high: "long / short", behavior: "Alternates longer and shorter event phases without changing the two-event duration." }),
    ],
    faust: { symbol: "os.lf_sawpos", url: "https://faustlibraries.grame.fr/libs/oscillators/#oslf_sawpos" },
  }),
  moduleSpec({
    id: "lfo", kind: 3, name: "LFO", category: "control", color: "#a78bff",
    description: "Produces cyclic control motion from absolute time without carrying oscillator state between samples.",
    execution: "Single-sample · analytic phase", wgsl: "cv = lfoWave(fract(time * rate), shape) * depth + offset;", auditionPreset: "moving-drone",
    inputs: [], outputs: [port("out", "control", "control")],
    params: [
      parameter("rate", "Rate", 0.02, 30, 0.23, { step: 0.01, unit: "Hz", scale: "log", low: "slow drift", high: "audio-rate edge", behavior: "Sets the speed of repeated parameter motion." }),
      parameter("shape", "Shape", 0, 3, 0, { step: 1, options: ["Sine", "Triangle", "Square", "Saw"], low: "smooth", high: "edged", behavior: "Changes the motion from continuous curves to abrupt or ramped changes." }),
      parameter("depth", "Depth", 0, 1, 0.8, { step: 0.01, low: "subtle", high: "full range", behavior: "Sets the size of the modulation swing." }),
      parameter("offset", "Offset", -1, 1, 0, { step: 0.01, low: "lower center", high: "higher center", behavior: "Moves the center of the control waveform." }),
    ],
    faust: { symbol: "os.lf_triangle", url: "https://faustlibraries.grame.fr/libs/oscillators/#oslf_triangle" },
  }),
  moduleSpec({
    id: "contour", kind: 4, name: "Event contour", category: "control", color: "#ff6eaa",
    description: "Turns a clock phase into an attack-and-decay amplitude or modulation contour.",
    execution: "Single-sample · event-age envelope", wgsl: "env = attack(phase) * exp(-phase / tail);", auditionPreset: "pm-bell",
    inputs: [port("phase", "phase", "control", { required: true })], outputs: [port("out", "envelope", "control")],
    params: [
      parameter("attack", "Attack", 0.002, 0.4, 0.018, { step: 0.001, unit: "cycle", scale: "log", low: "sharp onset", high: "slow swell", behavior: "Controls how quickly the event rises from silence." }),
      parameter("tail", "Tail", 0.03, 1.5, 0.32, { step: 0.01, unit: "cycle", scale: "log", low: "short", high: "sustained", behavior: "Controls how long the event remains audible within each clock cycle." }),
      parameter("curve", "Curve", 0.3, 5, 1.4, { step: 0.01, low: "soft", high: "concave", behavior: "Redistributes energy toward the start or body of the contour." }),
      parameter("level", "Level", 0, 1, 1, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the control signal before it reaches another module." }),
    ],
    faust: { symbol: "en.ar", url: "https://faustlibraries.grame.fr/libs/envelopes/" },
  }),
  moduleSpec({
    id: "oscillator", kind: 5, name: "Oscillator", category: "source", color: "#74f7ff",
    description: "Evaluates a periodic waveform for each output sample; its input is a phase offset, not integrated arbitrary FM.",
    execution: "Single-sample · analytic oscillator", wgsl: "sample = wave(fract(time * hz), shape, duty, pm);", auditionPreset: "folded-pulse",
    inputs: [port("pm", "phase mod", "control", { types: ["control", "audio"] }), port("pitch", "pitch", "control")], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("frequency", "Frequency", 30, 4000, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low pitch", high: "high pitch", behavior: "Sets the fundamental pitch. Changes apply to the next rendered GPU chunk." }),
      parameter("waveform", "Waveform", 0, 3, 1, { step: 1, options: ["Sine", "Triangle", "Saw", "Pulse"], low: "rounded", high: "bright edges", behavior: "Changes the harmonic series produced by the source." }),
      parameter("shape", "Pulse width", 0.05, 0.95, 0.5, { step: 0.01, low: "thin pulse", high: "wide pulse", behavior: "Changes pulse duty cycle; it mainly affects the Pulse waveform." }),
      parameter("level", "Level", 0, 1, 0.42, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the oscillator before downstream processing." }),
      parameter("pmDepth", "PM depth", 0, 12, 1.8, { step: 0.01, unit: "rad", low: "carrier only", high: "dense sidebands", behavior: "Scales a connected phase-modulation signal and spreads energy into sidebands." }),
    ],
    faust: { symbol: "os.polyblep_saw", url: "https://faustlibraries.grame.fr/libs/oscillators/#ospolyblep_saw" },
  }),
  moduleSpec({
    id: "noise", kind: 6, name: "Hash noise", category: "source", color: "#74f7ff",
    description: "Creates deterministic noise from the sample coordinate; rate and smoothing move it toward stepped control-like texture.",
    execution: "Single-sample · deterministic hash", wgsl: "noise = mix(hash(sample), valueNoise(time * rate), smooth);", auditionPreset: "metal-rain",
    inputs: [], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("rate", "Update rate", 20, 48000, 12000, { step: 1, unit: "Hz", scale: "log", low: "stepped", high: "full-band", behavior: "Sets how frequently the random value changes." }),
      parameter("smooth", "Interpolation", 0, 1, 0.12, { step: 0.01, low: "hard steps", high: "smooth drift", behavior: "Interpolates between neighboring random values." }),
      parameter("seed", "Seed", 1, 65535, 9137, { step: 1, low: "pattern A", high: "pattern B", behavior: "Chooses a repeatable random sequence without changing its statistics." }),
      parameter("level", "Level", 0, 1, 0.26, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the noise before downstream processing." }),
    ],
    faust: { symbol: "no.noise", url: "https://faustlibraries.grame.fr/libs/noises/" },
  }),
  moduleSpec({
    id: "fm", kind: 7, name: "FM / PM voice", category: "modulation", color: "#ffda57",
    description: "A bounded carrier–modulator phase network. Ratio sets sideband spacing; index sets their spectral spread.",
    execution: "Single-sample · fixed-ratio phase modulation", wgsl: "sample = sin(carrierPhase + sin(modPhase) * index);", auditionPreset: "pm-bell",
    inputs: [port("index", "index mod", "control", { types: ["control", "audio"] }), port("pitch", "pitch", "control")], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("frequency", "Carrier", 30, 3000, 165, { step: 0.1, unit: "Hz", scale: "log", low: "low pitch", high: "high pitch", behavior: "Sets the carrier pitch around which sidebands form." }),
      parameter("ratio", "Ratio", 0.125, 16, 2.71, { step: 0.001, low: "close bands", high: "wide bands", behavior: "Integer ratios tend toward harmonic spectra; non-integers tend toward metallic spectra." }),
      parameter("index", "Index", 0, 12, 3.4, { step: 0.01, unit: "rad", low: "carrier only", high: "dense sidebands", behavior: "Raises the number and strength of audible sidebands." }),
      parameter("level", "Level", 0, 1, 0.36, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the PM voice before processing." }),
      parameter("modDepth", "Index CV", 0, 8, 2.6, { step: 0.01, unit: "rad", low: "fixed index", high: "wide movement", behavior: "Sets how strongly the connected input changes modulation index." }),
    ],
    faust: { symbol: "sy.fm", url: "https://faustlibraries.grame.fr/libs/synths/#syfm" },
  }),
  moduleSpec({
    id: "additive", kind: 8, name: "Harmonic bank", category: "source", color: "#ff9a62",
    description: "Sums a bounded set of partials, fading components near Nyquist so density and spectral slope remain controllable.",
    execution: "Single-sample · bounded partial loop", wgsl: "sample = sum(sin(TAU * hz * partial * time) / pow(partial, tilt));", auditionPreset: "metal-rain",
    inputs: [port("brightness", "brightness", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("frequency", "Fundamental", 30, 1200, 92, { step: 0.1, unit: "Hz", scale: "log", low: "low body", high: "high body", behavior: "Sets the base frequency shared by all partials." }),
      parameter("partials", "Partials", 1, 32, 14, { step: 1, low: "pure", high: "dense", behavior: "Adds progressively higher components to the spectrum." }),
      parameter("tilt", "Spectral tilt", 0.35, 2.5, 1.1, { step: 0.01, low: "bright", high: "dark", behavior: "Controls how quickly higher partials lose amplitude." }),
      parameter("stretch", "Stretch", 0.92, 1.12, 1.012, { step: 0.001, low: "compressed", high: "inharmonic", behavior: "Moves upper partials away from exact integer multiples." }),
      parameter("level", "Level", 0, 1, 0.34, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the normalized partial sum." }),
    ],
    faust: { symbol: "sy.additiveDrum", url: "https://faustlibraries.grame.fr/libs/synths/#syadditiveDrum" },
  }),
  moduleSpec({
    id: "vca", kind: 9, name: "VCA", category: "compose", color: "#ff9a62",
    description: "Uses a control signal to articulate an audio signal; the depth control crossfades between constant and modulated gain.",
    execution: "Single-sample · multiply + soft ceiling", wgsl: "audio *= mix(base, clamp(cv, 0.0, 1.0), depth);", auditionPreset: "pm-bell",
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true }), port("cv", "gain CV", "control")], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("base", "Base gain", 0, 1, 0.72, { step: 0.01, low: "closed", high: "open", behavior: "Sets gain when no contour is connected or modulation depth is low." }),
      parameter("depth", "CV depth", 0, 1, 1, { step: 0.01, low: "fixed gain", high: "full articulation", behavior: "Sets how completely the control input replaces base gain." }),
      parameter("drive", "Drive", 1, 8, 1.1, { step: 0.01, unit: "×", low: "clean", high: "compressed", behavior: "Raises level into a soft ceiling, adding harmonics at high values." }),
    ],
    faust: { symbol: "*", url: "https://faustdoc.grame.fr/manual/syntax/#infix-operators" },
  }),
  moduleSpec({
    id: "ring", kind: 10, name: "Ring modulator", category: "modulation", color: "#ffda57",
    description: "Multiplies two bipolar audio signals, replacing their original frequencies with sum-and-difference components.",
    execution: "Single-sample · signal multiplication", wgsl: "out = mix(a, a * b, amount) * level;", auditionPreset: "moving-drone",
    inputs: [port("a", "signal A", "audio", { types: ["audio", "stereo"], required: true }), port("b", "signal B", "audio", { types: ["audio", "stereo"], required: true })], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("amount", "Amount", 0, 1, 1, { step: 0.01, low: "signal A", high: "sum / difference", behavior: "Crossfades from the first input to full bipolar multiplication." }),
      parameter("level", "Level", 0, 1.5, 0.72, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the ring-modulated result." }),
    ],
    faust: { symbol: "*", url: "https://faustdoc.grame.fr/manual/syntax/#infix-operators" },
  }),
  moduleSpec({
    id: "mix", kind: 11, name: "Two-channel mix", category: "compose", color: "#ff9a62",
    description: "Combines two routes with an equal-power balance so the center does not collapse as quickly as a linear crossfade.",
    execution: "Single-sample · equal-power sum", wgsl: "out = a * cos(mix * PI/2) + b * sin(mix * PI/2);", auditionPreset: "moving-drone",
    inputs: [port("a", "signal A", "audio", { types: ["audio", "stereo"] }), port("b", "signal B", "audio", { types: ["audio", "stereo"] })], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("balance", "Balance", -1, 1, 0, { step: 0.01, low: "A", high: "B", behavior: "Moves continuously between the two connected signals." }),
      parameter("level", "Level", 0, 1.5, 0.72, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the combined signal." }),
    ],
    faust: { symbol: ":>", url: "https://faustdoc.grame.fr/manual/syntax/#merge-composition" },
  }),
  moduleSpec({
    id: "sum-3", kind: 34, name: "3-input Adder", category: "compose", color: "#ff9a62",
    description: "Adds three independent signal branches with separate weights, then applies energy compensation and a soft ceiling.",
    execution: "Single-sample · three-input weighted sum", wgsl: "out = softClip((a * wa + b * wb + c * wc) / sqrt(weight));", auditionPreset: null,
    inputs: [
      port("a", "signal A", "audio", { types: ["audio", "stereo"], required: true }),
      port("b", "signal B", "audio", { types: ["audio", "stereo"], required: true }),
      port("c", "signal C", "audio", { types: ["audio", "stereo"], required: true }),
    ],
    outputs: [port("out", "audio", "audio")],
    params: [
      parameter("a", "A weight", -1.5, 1.5, 1, { step: 0.01, low: "inverted", high: "forward", behavior: "Sets the signed contribution of the first branch; zero mutes it and negative values subtract it." }),
      parameter("b", "B weight", -1.5, 1.5, 1, { step: 0.01, low: "inverted", high: "forward", behavior: "Sets the signed contribution of the second branch; zero mutes it and negative values subtract it." }),
      parameter("c", "C weight", -1.5, 1.5, 1, { step: 0.01, low: "inverted", high: "forward", behavior: "Sets the signed contribution of the third branch; zero mutes it and negative values subtract it." }),
      parameter("level", "Level", 0, 1.5, 0.82, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the compensated sum before its soft ceiling." }),
    ],
    faust: { symbol: "+", url: "https://faustdoc.grame.fr/manual/syntax/#infix-operators" },
  }),
  moduleSpec({
    id: "product-3", kind: 35, name: "3-input Multiplier", category: "modulation", color: "#ffda57",
    description: "Multiplies three bipolar branches, producing intermodulation components that none of the inputs contains alone.",
    execution: "Single-sample · three-input multiplication", wgsl: "out = mix(sum, a * b * c * drive, amount);", auditionPreset: null,
    inputs: [
      port("a", "signal A", "audio", { types: ["audio", "stereo"], required: true }),
      port("b", "signal B", "audio", { types: ["audio", "stereo"], required: true }),
      port("c", "signal C", "audio", { types: ["audio", "stereo"], required: true }),
    ],
    outputs: [port("out", "audio", "audio")],
    params: [
      parameter("amount", "Product", 0, 1, 1, { step: 0.01, low: "parallel sum", high: "full product", behavior: "Moves from a quiet parallel sum into three-way intermodulation." }),
      parameter("drive", "Drive", 0.5, 8, 2, { step: 0.01, unit: "×", low: "open", high: "compressed", behavior: "Raises the multiplied signal into a soft ceiling." }),
      parameter("level", "Level", 0, 1.5, 0.78, { step: 0.01, low: "quiet", high: "loud", behavior: "Sets the output level after multiplication." }),
    ],
    faust: { symbol: "*", url: "https://faustdoc.grame.fr/manual/syntax/#infix-operators" },
  }),
  moduleSpec({
    id: "fold", kind: 12, name: "Wavefolder", category: "shape", color: "#e883ee",
    description: "Reflects an overdriven waveform through a sinusoidal fold, adding upper harmonics as drive and fold increase.",
    execution: "Single-sample · nonlinear transfer", wgsl: "out = mix(softClip(x * drive), sin((x + symmetry) * PI * drive), fold);", auditionPreset: "folded-pulse",
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("drive", "Drive", 1, 16, 3.2, { step: 0.01, unit: "×", low: "clean", high: "many folds", behavior: "Pushes more of the waveform across folding boundaries." }),
      parameter("fold", "Fold", 0, 1, 0.72, { step: 0.01, low: "soft clip", high: "sinusoidal fold", behavior: "Crossfades between smooth saturation and reflected wavefolding." }),
      parameter("mix", "Wet mix", 0, 1, 0.8, { step: 0.01, low: "dry", high: "processed", behavior: "Blends the unprocessed signal with the folded result." }),
      parameter("symmetry", "Symmetry", -0.5, 0.5, 0, { step: 0.01, low: "negative bias", high: "positive bias", behavior: "Offsets the transfer curve, introducing even harmonics." }),
    ],
    faust: { symbol: "ef.cubicnl", url: "https://faustlibraries.grame.fr/libs/misceffects/" },
  }),
  moduleSpec({
    id: "quantize", kind: 13, name: "Amplitude quantizer", category: "shape", color: "#e883ee",
    description: "Rounds amplitude to a finite number of levels. Lower bit depths replace smooth motion with stepped distortion.",
    execution: "Single-sample · amplitude rounding", wgsl: "crushed = round(signal * levels) / levels;", auditionPreset: "metal-rain",
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("bits", "Bit depth", 2, 16, 7, { step: 1, unit: "bit", low: "coarse steps", high: "fine steps", behavior: "Sets the number of available amplitude levels." }),
      parameter("mix", "Wet mix", 0, 1, 0.65, { step: 0.01, low: "dry", high: "quantized", behavior: "Blends the clean and stepped signals." }),
      parameter("level", "Level", 0, 1, 0.8, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the result after quantization." }),
    ],
    faust: { symbol: "qu.quantize", url: "https://faustlibraries.grame.fr/libs/quantizers/" },
  }),
  moduleSpec({
    id: "pan", kind: 14, name: "Equal-power pan", category: "space", color: "#6ca8ff",
    description: "Converts mono to stereo using sine/cosine gains; a control input can move the position around its base value.",
    execution: "Single-sample · stereo vector math", wgsl: "stereo = mono * vec2(cos(angle), sin(angle));", auditionPreset: "moving-drone",
    inputs: [port("signal", "mono", "audio", { types: ["audio", "stereo"], required: true }), port("position", "pan CV", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("pan", "Position", -1, 1, 0, { step: 0.01, low: "left", high: "right", behavior: "Moves the signal between the left and right channels." }),
      parameter("depth", "CV depth", 0, 1, 0.7, { step: 0.01, low: "fixed", high: "wide motion", behavior: "Sets how far the connected control signal can move the pan position." }),
      parameter("level", "Level", 0, 1, 0.9, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales both output channels." }),
    ],
    faust: { symbol: "sp.panner", url: "https://faustlibraries.grame.fr/libs/spats/" },
  }),
  moduleSpec({
    id: "softclip", kind: 15, name: "Soft clip", category: "shape", color: "#e883ee",
    description: "Compresses peaks with a rational transfer curve, raising harmonic density without a hard digital corner.",
    execution: "Single-sample · nonlinear transfer", wgsl: "soft = driven / (1.0 + abs(driven));", auditionPreset: "pm-bell",
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("drive", "Drive", 1, 12, 1.8, { step: 0.01, unit: "×", low: "clean", high: "compressed", behavior: "Pushes peaks farther into saturation and adds harmonics." }),
      parameter("mix", "Wet mix", 0, 1, 0.75, { step: 0.01, low: "dry", high: "saturated", behavior: "Blends the input with the compressed transfer curve." }),
      parameter("level", "Level", 0, 1.2, 0.86, { step: 0.01, low: "quiet", high: "loud", behavior: "Sets level after saturation." }),
    ],
    faust: { symbol: "ef.softclip", url: "https://faustlibraries.grame.fr/libs/misceffects/" },
  }),
  moduleSpec({
    id: "spectral-acid", kind: 17, name: "Spectral Acid", category: "source", color: "#74f7ff",
    description: "Builds an acid-like oscillator by weighting a bounded harmonic bank around a movable spectral cutoff and resonance peak.",
    execution: "Single-sample · 1–48 partials · no filter history", wgsl: "level = (lowpass + resonantPeak) / harmonic;", auditionPreset: null,
    inputs: [port("cutoff", "cutoff CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Fundamental", 30, 1200, 82.41, { step: 0.1, unit: "Hz", scale: "log", low: "low growl", high: "high squelch", behavior: "Sets the fundamental beneath the generated harmonic series." }),
      parameter("partials", "Partials", 1, 48, 28, { step: 1, low: "rounded", high: "extended", behavior: "Sets the maximum number of harmonics before the Nyquist fade removes upper components." }),
      parameter("cutoff", "Spectral cutoff", 0, 1, 0.48, { step: 0.01, low: "few harmonics", high: "open spectrum", behavior: "Moves the spectral low-pass edge through the harmonic numbers; this is not a recursive filter." }),
      parameter("resonance", "Peak", 0, 1, 0.68, { step: 0.01, low: "flat edge", high: "focused band", behavior: "Raises partials near the spectral cutoff to create an acid-like emphasis." }),
      parameter("tilt", "Tilt", 0.55, 1.8, 1, { step: 0.01, low: "bright", high: "dark", behavior: "Changes how quickly harmonic level falls with harmonic number." }),
      parameter("drive", "Drive", 0.5, 8, 1.8, { step: 0.01, unit: "×", low: "open", high: "compressed", behavior: "Pushes the normalized partial sum into a soft ceiling." }),
      parameter("level", "Level", 0, 1, 0.34, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the stereo oscillator result." }),
      parameter("cvDepth", "Cutoff CV", 0, 1, 0.72, { step: 0.01, low: "fixed", high: "wide sweep", behavior: "Sets how far a connected control signal moves the spectral cutoff." }),
    ],
    faust: { symbol: "os.osc + spectral weighting", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "modal-metal", kind: 18, name: "Modal Metal", category: "source", color: "#74f7ff",
    description: "Restarts a bounded bank of scattered inharmonic modes at each event and gives higher modes progressively shorter decays.",
    execution: "Single-sample · 1–32 analytic damped modes", wgsl: "mode = sin(TAU * modeHz * age) * exp(-age * damping);", auditionPreset: null,
    inputs: [port("strike", "strike CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Body pitch", 30, 1000, 118, { step: 0.1, unit: "Hz", scale: "log", low: "large plate", high: "small object", behavior: "Sets the first modal frequency." }),
      parameter("rate", "Strike rate", 0.25, 16, 2.7, { step: 0.01, unit: "Hz", scale: "log", low: "separate rings", high: "rapid strikes", behavior: "Sets how often the closed-form modal response restarts." }),
      parameter("decay", "Decay", 0.03, 3, 0.72, { step: 0.01, unit: "s", scale: "log", low: "damped tap", high: "long ring", behavior: "Sets the low modes' exponential decay time." }),
      parameter("inharmonicity", "Stiffness", 0, 1, 0.56, { step: 0.01, low: "near harmonic", high: "spread metal", behavior: "Bends upper mode ratios with a quadratic stiffness term." }),
      parameter("modes", "Modes", 1, 32, 18, { step: 1, low: "simple", high: "dense", behavior: "Sets how many damped sine modes are evaluated." }),
      parameter("brightness", "Mode tilt", 0.55, 2, 1.05, { step: 0.01, low: "hard strike", high: "soft strike", behavior: "Controls how quickly upper modes lose amplitude." }),
      parameter("strikeDepth", "Strike CV", 0, 1, 0, { step: 0.01, low: "internal decay", high: "external contour", behavior: "Crossfades the built-in decay toward a connected strike contour." }),
      parameter("level", "Level", 0, 1, 0.4, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the normalized modal sum." }),
    ],
    faust: { symbol: "pm.modalModel", url: "https://faustlibraries.grame.fr/libs/physmodels/" },
  }),
  moduleSpec({
    id: "particle-cloud", kind: 19, name: "Particle Cloud", category: "source", color: "#74f7ff",
    description: "Layers sixteen deterministic, windowed oscillator grains with per-grain pitch and stereo placement; it does not read recorded samples.",
    execution: "Single-sample · 16 analytic grain lanes", wgsl: "grain = sin(TAU * grainHz * age) * pow(sin(PI * position), 2.0);", auditionPreset: null,
    inputs: [port("density", "density CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Center pitch", 30, 2400, 146.83, { step: 0.1, unit: "Hz", scale: "log", low: "low cloud", high: "high cloud", behavior: "Sets the center frequency from which seeded grain pitches spread." }),
      parameter("rate", "Grain rate", 1, 80, 18, { step: 0.1, unit: "Hz", scale: "log", low: "separate grains", high: "fused cloud", behavior: "Sets the shared event grid; sixteen lanes are staggered across it." }),
      parameter("size", "Grain size", 0.002, 0.25, 0.042, { step: 0.001, unit: "s", scale: "log", low: "ticks", high: "long particles", behavior: "Sets the Hann-windowed duration of each oscillator particle." }),
      parameter("density", "Density", 0.05, 1, 0.7, { step: 0.01, low: "sparse", high: "continuous", behavior: "Sets the deterministic probability that each scheduled grain is active." }),
      parameter("spread", "Pitch spread", 0, 24, 9, { step: 0.1, unit: "st", low: "unison", high: "two octaves", behavior: "Spreads seeded grain pitches symmetrically around the center." }),
      parameter("stereo", "Stereo spread", 0, 1, 0.78, { step: 0.01, low: "mono", high: "wide", behavior: "Moves grains toward their seeded left or right positions." }),
      parameter("seed", "Seed", 1, 65535, 7219, { step: 1, low: "pattern A", high: "pattern B", behavior: "Selects a repeatable set of grain pitches, onsets, and positions." }),
      parameter("level", "Level", 0, 1, 0.34, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the normalized grain cloud." }),
    ],
    faust: { symbol: "os.osc (windowed bank)", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "vector-wavetable", kind: 20, name: "Vector Wavetable", category: "source", color: "#74f7ff",
    description: "Reconstructs sine, triangle, and saw spectra from a bounded Fourier bank, then scans continuously between them without a table lookup.",
    execution: "Single-sample · 1–32 Fourier partials", wgsl: "level = mix(sineSpectrum, triangleSpectrum, sawSpectrum, scan);", auditionPreset: null,
    inputs: [port("scan", "scan CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Frequency", 30, 3000, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low pitch", high: "high pitch", behavior: "Sets the common fundamental of the Fourier reconstruction." }),
      parameter("scan", "Spectral scan", 0, 1, 0.46, { step: 0.01, low: "sine", high: "saw", behavior: "Morphs from sine through triangle toward saw harmonic weights." }),
      parameter("harmonics", "Harmonics", 1, 32, 20, { step: 1, low: "fundamental", high: "detailed", behavior: "Sets the bounded Fourier series length before Nyquist fading." }),
      parameter("tilt", "Spectral tilt", 0.6, 1.8, 1, { step: 0.01, low: "bright", high: "dark", behavior: "Tilts the reconstructed spectrum after the wavetable scan." }),
      parameter("stereo", "Phase spread", 0, 1, 0.32, { step: 0.01, low: "mono", high: "wide", behavior: "Offsets upper-partial phase in opposite directions across stereo." }),
      parameter("cvDepth", "Scan CV", 0, 1, 0.72, { step: 0.01, low: "fixed", high: "full scan", behavior: "Sets how far a connected control signal moves through the spectra." }),
      parameter("level", "Level", 0, 1, 0.38, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the normalized stereo reconstruction." }),
    ],
    faust: { symbol: "os.osc", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "formant-bank", kind: 21, name: "Formant Bank", category: "source", color: "#74f7ff",
    description: "Weights source harmonics with three vowel-shaped Gaussian spectral peaks; it is spectral-envelope synthesis, not recursive filtering.",
    execution: "Single-sample · 1–32 formant-weighted harmonics", wgsl: "gain = gaussian(hz, f1) + 0.72 * gaussian(hz, f2) + 0.42 * gaussian(hz, f3);", auditionPreset: null,
    inputs: [port("vowel", "vowel CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Fundamental", 30, 600, 92.5, { step: 0.1, unit: "Hz", scale: "log", low: "low voice", high: "high voice", behavior: "Sets the harmonic spacing beneath the formant envelope." }),
      parameter("vowel", "Vowel scan", 0, 1, 0.28, { step: 0.01, low: "A / E", high: "O / U", behavior: "Moves three spectral peaks through an A–E–I–O–U trajectory." }),
      parameter("harmonics", "Harmonics", 3, 32, 24, { step: 1, low: "sparse", high: "defined vowels", behavior: "Sets how many harmonics can meet the formant peaks." }),
      parameter("bandwidth", "Bandwidth", 60, 600, 230, { step: 1, unit: "Hz", scale: "log", low: "narrow peaks", high: "broad mouth", behavior: "Sets the width of all three formant regions." }),
      parameter("tilt", "Voice tilt", 0.3, 1.8, 0.72, { step: 0.01, low: "bright", high: "dark", behavior: "Controls the source spectrum beneath the vowel peaks." }),
      parameter("breath", "Breath", 0, 0.5, 0.07, { step: 0.01, low: "pure tone", high: "noisy", behavior: "Adds deterministic full-band breath to the harmonic voice." }),
      parameter("cvDepth", "Vowel CV", 0, 1, 0.74, { step: 0.01, low: "fixed mouth", high: "wide articulation", behavior: "Sets how far a connected control signal moves the vowel scan." }),
      parameter("level", "Level", 0, 1, 0.44, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the normalized stereo formant bank." }),
    ],
    faust: { symbol: "os.osc + spectral weighting", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "procedural-kick", kind: 22, name: "Procedural Kick", category: "source", color: "#ff6eaa",
    description: "Integrates a falling exponential pitch analytically, then combines the decaying sine body with a separately windowed click.",
    execution: "Single-sample · analytic pitch integral + envelope", wgsl: "phase = baseHz * age + bendHz * (1.0 - exp(-k * age)) / k;", auditionPreset: null,
    inputs: [port("phase", "event phase", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("rate", "Event rate", 0.25, 16, 2.4, { step: 0.01, unit: "Hz", scale: "log", low: "spaced kicks", high: "rapid kicks", behavior: "Sets the internal repetition rate and converts event phase into seconds." }),
      parameter("frequency", "Body pitch", 28, 120, 52, { step: 0.1, unit: "Hz", scale: "log", low: "deep", high: "tight", behavior: "Sets the pitch reached after the initial fall." }),
      parameter("drop", "Pitch drop", 0, 8, 4.2, { step: 0.01, unit: "×", low: "steady tone", high: "hard knock", behavior: "Sets how far above the body frequency the attack begins." }),
      parameter("decay", "Body decay", 0.03, 1.5, 0.34, { step: 0.01, unit: "s", scale: "log", low: "short", high: "booming", behavior: "Sets the exponential amplitude tail." }),
      parameter("click", "Click", 0, 1, 0.34, { step: 0.01, low: "soft onset", high: "sharp beater", behavior: "Adds a very short seeded noise transient without changing the body oscillator." }),
      parameter("drive", "Drive", 0.5, 8, 1.7, { step: 0.01, unit: "×", low: "clean", high: "compressed", behavior: "Pushes body and click together into a soft ceiling." }),
      parameter("phaseDepth", "External phase", 0, 1, 0, { step: 0.01, low: "internal clock", high: "patched clock", behavior: "Crossfades from the internal event phase to a connected phase signal." }),
      parameter("level", "Level", 0, 1, 0.66, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the finished kick." }),
    ],
    faust: { symbol: "sy.kick", url: "https://faustlibraries.grame.fr/libs/synths/" },
  }),
  moduleSpec({
    id: "sample-hold", kind: 23, name: "Sample + Hold", category: "control", color: "#ffda57",
    description: "Derives deterministic random plateaus from the sample coordinate, with an optional end-of-step glide that requires no stored history.",
    execution: "Single-sample · stateless hash cells", wgsl: "held = hashU32(sampleIndex / periodSamples) * 2.0 - 1.0;", auditionPreset: null,
    inputs: [], outputs: [port("out", "held CV", "control")],
    params: [
      parameter("rate", "Update rate", 0.05, 2000, 3.2, { step: 0.01, unit: "Hz", scale: "log", low: "slow plateaus", high: "stepped noise", behavior: "Sets how often a new deterministic value is chosen." }),
      parameter("seed", "Seed", 1, 65535, 3907, { step: 1, low: "pattern A", high: "pattern B", behavior: "Chooses a repeatable held-value sequence." }),
      parameter("slew", "Edge glide", 0, 1, 0.08, { step: 0.01, low: "hard steps", high: "long glide", behavior: "Interpolates only near the end of each hold cell to soften discontinuities." }),
      parameter("bipolar", "Polarity", 0, 1, 1, { step: 1, options: ["Unipolar", "Bipolar"], low: "0 to 1", high: "−1 to 1", behavior: "Chooses a unipolar or bipolar random range." }),
      parameter("depth", "Depth", 0, 1, 0.8, { step: 0.01, low: "subtle", high: "full range", behavior: "Scales the held modulation range." }),
      parameter("offset", "Offset", -1, 1, 0, { step: 0.01, low: "lower center", high: "higher center", behavior: "Moves the center of the held control values." }),
    ],
    faust: { symbol: "ba.sAndH", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
  moduleSpec({
    id: "euclidean-gate", kind: 24, name: "Euclidean Gate", category: "control", color: "#ff6eaa",
    description: "Evaluates an integer modulo predicate on a repeating step grid to distribute gates as evenly as possible.",
    execution: "Single-sample · integer clock + modulo", wgsl: "hit = ((rotatedStep * pulses) % steps) < pulses;", auditionPreset: null,
    inputs: [], outputs: [port("out", "gate", "control")],
    params: [
      parameter("rate", "Step rate", 0.25, 32, 8, { step: 0.01, unit: "Hz", scale: "log", low: "slow pattern", high: "rapid pattern", behavior: "Sets how quickly the pattern advances by one step." }),
      parameter("steps", "Steps", 2, 128, 16, { step: 1, low: "short cycle", high: "long cycle", behavior: "Sets the number of positions in the repeating cycle." }),
      parameter("pulses", "Pulses", 1, 128, 5, { step: 1, low: "sparse", high: "dense", behavior: "Sets the number of active steps; values above Steps are clamped to the cycle length." }),
      parameter("rotation", "Rotation", 0, 127, 0, { step: 1, low: "original", high: "shifted", behavior: "Rotates the accent position without changing the spacing family." }),
      parameter("width", "Gate width", 0.02, 1, 0.42, { step: 0.01, low: "short trigger", high: "held step", behavior: "Sets how much of each active step remains high." }),
      parameter("accent", "Cycle accent", 0, 1, 0.22, { step: 0.01, low: "even", high: "strong downbeat", behavior: "Separates the cycle start by lowering the other active gates while the first stays at Level." }),
      parameter("level", "Level", 0, 1, 1, { step: 0.01, low: "low gate", high: "full gate", behavior: "Scales the control value sent to another module." }),
    ],
    faust: { symbol: "ba.pulse", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
  moduleSpec({
    id: "gpu-arp", kind: 33, name: "GPU Arpeggiator", category: "control", color: "#91ff63",
    description: "Selects scale degrees, swing timing, glide, and a click-safe gate from the absolute sample coordinate. Pitch and gate can fan out independently.",
    execution: "Single-sample · GPU step selection", wgsl: "step = pattern(sampleIndex); out = vec2(semitones, edgeSafeGate);", auditionPreset: null,
    inputs: [],
    outputs: [
      port("pitch", "pitch", "control", { component: "x" }),
      port("gate", "gate", "control", { component: "y" }),
    ],
    params: [
      parameter("rate", "Step rate", 0.25, 24, 5, { step: 0.01, unit: "Hz", scale: "log", low: "slow sequence", high: "rapid sequence", behavior: "Sets how often the GPU advances to another scale degree." }),
      parameter("steps", "Pattern length", 2, 128, 8, { step: 1, low: "short loop", high: "long loop", behavior: "Sets the number of positions before the pitch pattern repeats." }),
      parameter("pattern", "Pattern", 0, 5, 0, { step: 1, options: ["Up", "Down", "Up / down", "Seeded random", "Golden skip", "Folded"], low: "ordered", high: "rearranged", behavior: "Changes how step positions are mapped into scale degrees." }),
      parameter("scale", "Scale", 0, 6, 1, { step: 1, options: ["Chromatic", "Major", "Minor", "Pentatonic", "Whole tone", "Octatonic", "Quarter tone"], low: "chromatic", high: "quarter-tone", behavior: "Maps the integer pattern onto a pitch collection, including 0.5-semitone quarter-tone steps." }),
      parameter("octaves", "Range", 1, 4, 2, { step: 1, unit: "oct", low: "compact", high: "wide", behavior: "Sets how many octaves the generated degrees can occupy." }),
      parameter("glide", "Glide", 0, 0.95, 0.08, { step: 0.01, low: "stepped pitch", high: "long slides", behavior: "Interpolates toward the following pitch near the end of each step." }),
      parameter("swing", "Swing", 0, 0.42, 0, { step: 0.01, low: "even", high: "long / short", behavior: "Alternates step lengths while preserving the duration of each two-step pair." }),
      parameter("seed", "Seed", 1, 65535, 8191, { step: 1, low: "pattern A", high: "pattern B", behavior: "Selects deterministic random and folded pattern orderings." }),
    ],
    faust: { symbol: "ba.pulse + select2", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
  moduleSpec({
    id: "hard-sync", kind: 25, name: "Hard Sync", category: "modulation", color: "#ffda57",
    description: "Maps a slave oscillator into each master cycle so the slave phase restarts at every master boundary.",
    execution: "Single-sample · stateless phase reset", wgsl: "slavePhase = fract(masterPhase * ratio);", auditionPreset: null,
    inputs: [port("ratio", "ratio CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Master pitch", 30, 3000, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low pitch", high: "high pitch", behavior: "Sets the audible fundamental and reset rate." }),
      parameter("ratio", "Sync ratio", 1, 16, 3.2, { step: 0.01, low: "little reset color", high: "many slave cycles", behavior: "Sets how many slave cycles are forced inside each master cycle." }),
      parameter("waveform", "Slave wave", 0, 3, 0, { step: 1, options: ["Sine", "Triangle", "Saw", "Pulse"], low: "rounded", high: "edged", behavior: "Selects the waveform evaluated after phase resetting." }),
      parameter("shape", "Pulse width", 0.05, 0.95, 0.5, { step: 0.01, low: "thin pulse", high: "wide pulse", behavior: "Changes duty cycle when the slave waveform is Pulse." }),
      parameter("cvDepth", "Ratio CV", 0, 8, 2.4, { step: 0.01, low: "fixed ratio", high: "wide sweep", behavior: "Sets how strongly a connected control signal changes the slave ratio." }),
      parameter("stereo", "Stereo detune", 0, 20, 2.8, { step: 0.1, unit: "cents", low: "mono", high: "wide beating", behavior: "Offsets the slave ratio slightly and oppositely in the two channels." }),
      parameter("level", "Level", 0, 1, 0.38, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the hard-synced oscillator." }),
    ],
    faust: { symbol: "os.osc with phase reset", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "phase-distortion", kind: 26, name: "Phase Distortion", category: "modulation", color: "#ffda57",
    description: "Bends the phase slope on either side of a movable split point while preserving one complete oscillator cycle.",
    execution: "Single-sample · piecewise phase map", wgsl: "warped = select(phase * pivot / split, pivot + (phase - split) * (1.0 - pivot) / (1.0 - split), phase >= split);", auditionPreset: null,
    inputs: [port("bend", "bend CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Frequency", 30, 4000, 130.81, { step: 0.1, unit: "Hz", scale: "log", low: "low pitch", high: "high pitch", behavior: "Sets the oscillator fundamental." }),
      parameter("bend", "Phase bend", 0.05, 0.95, 0.72, { step: 0.01, low: "early motion", high: "late motion", behavior: "Sets where the split point lands in output phase, changing the two phase slopes." }),
      parameter("split", "Time split", 0.05, 0.95, 0.34, { step: 0.01, low: "early split", high: "late split", behavior: "Sets where the piecewise phase mapping changes slope." }),
      parameter("curve", "Curve", 0.35, 3, 1, { step: 0.01, low: "front loaded", high: "back loaded", behavior: "Curves the mapped phase again for a broader range of spectra." }),
      parameter("cvDepth", "Bend CV", 0, 0.9, 0.42, { step: 0.01, low: "fixed", high: "wide warp", behavior: "Sets how far a connected control signal moves the phase bend." }),
      parameter("stereo", "Stereo offset", 0, 20, 2, { step: 0.1, unit: "cents", low: "mono", high: "wide", behavior: "Detunes the phase-distorted oscillators in opposite directions." }),
      parameter("level", "Level", 0, 1, 0.42, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the stereo oscillator result." }),
    ],
    faust: { symbol: "os.osc with phase map", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "bytebeat", kind: 27, name: "Bytebeat", category: "source", color: "#74f7ff",
    description: "Turns explicit 32-bit shifts, masks, multiplication, and overflow into repeating lo-fi melody and rhythm.",
    execution: "Single-sample · u32 arithmetic · intentionally aliased", wgsl: "byte = (t * ((t >> 5u) | (t >> 8u))) & mask;", auditionPreset: null,
    inputs: [port("variation", "variation CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("clock", "Integer clock", 1000, 48000, 8000, { step: 1, unit: "Hz", scale: "log", low: "slow code", high: "bright code", behavior: "Sets how quickly the integer time variable advances." }),
      parameter("pitch", "Clock ratio", 0.125, 4, 1, { step: 0.001, low: "lower", high: "higher", behavior: "Multiplies the integer clock rate without changing the formula." }),
      parameter("formula", "Formula", 0, 5, 0, { step: 1, options: ["Classic", "Rhythm", "Bit chord", "Cascade", "Mask song", "Xor steps"], low: "formula A", high: "formula F", behavior: "Selects one of six explicit integer expressions." }),
      parameter("bits", "Output bits", 3, 8, 8, { step: 1, unit: "bit", low: "coarse", high: "detailed", behavior: "Sets the output mask and amplitude resolution." }),
      parameter("variation", "Variation", 0, 255, 17, { step: 1, low: "base constants", high: "shifted constants", behavior: "Changes constants and time offsets inside the selected formula." }),
      parameter("cvDepth", "Variation CV", 0, 128, 24, { step: 1, low: "fixed code", high: "wide mutation", behavior: "Sets how strongly a connected control signal changes the integer variation." }),
      parameter("stereo", "Stereo offset", 0, 1, 0.42, { step: 0.01, low: "mono", high: "split code", behavior: "Blends the mono formula with a time-shifted right-channel evaluation." }),
      parameter("level", "Level", 0, 1, 0.28, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the intentionally discontinuous result." }),
    ],
    faust: { symbol: "integer bitwise primitives", url: "https://faustdoc.grame.fr/manual/syntax/" },
  }),
  moduleSpec({
    id: "chebyshev", kind: 28, name: "Polynomial / Chebyshev shaper", category: "shape", color: "#e883ee",
    description: "Builds a bounded Chebyshev polynomial series from a clipped input; a normalized sine exposes the clearest harmonic-number relationship.",
    execution: "Single-sample · 1–8 polynomial recurrence", wgsl: "next = 2.0 * x * current - previous;", auditionPreset: null,
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })], outputs: [port("out", "audio", "audio")],
    params: [
      parameter("order", "Order", 1, 8, 4, { step: 1, low: "low harmonics", high: "high harmonics", behavior: "Sets the highest Chebyshev polynomial evaluated by the bounded recurrence." }),
      parameter("drive", "Input drive", 0.25, 6, 1.35, { step: 0.01, unit: "×", low: "gentle", high: "clipped", behavior: "Scales the signal before it is clamped to the polynomial's −1 to 1 domain." }),
      parameter("tilt", "Series tilt", 0.2, 3, 1.2, { step: 0.01, low: "upper orders", high: "lower orders", behavior: "Controls how quickly higher polynomial orders lose weight." }),
      parameter("mix", "Wet mix", 0, 1, 0.72, { step: 0.01, low: "dry", high: "polynomial", behavior: "Blends the original input with the Chebyshev series." }),
      parameter("bias", "Bias", -0.5, 0.5, 0, { step: 0.01, low: "negative asymmetry", high: "positive asymmetry", behavior: "Offsets the transfer curve and introduces even-harmonic and DC components." }),
      parameter("level", "Level", 0, 1.2, 0.76, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the shaped result." }),
    ],
    faust: { symbol: "ma.chebychevpoly", url: "https://faustlibraries.grame.fr/libs/maths/" },
  }),
  ...SHADER_SYNTH_PLAYGROUND_EXTRA_MODULES.map(moduleSpec),
  ...SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES.map(moduleSpec),
  ...SHADER_SYNTH_PLAYGROUND_FOUND_MODULES.map(moduleSpec),
  ...SHADER_SYNTH_PLAYGROUND_FX_MODULES.map(moduleSpec),
  ...SHADER_SYNTH_PLAYGROUND_ATLAS_MODULES.map(moduleSpec),
  ...SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_MODULES.map(moduleSpec),
  ...SHADER_SYNTH_PLAYGROUND_STATEFUL_MODULES.map(moduleSpec),
  moduleSpec({
    id: "output", kind: 16, name: "Output", category: "output", color: "#91ff63",
    description: "Collects the graph's final stereo signal, applies output gain, and limits extreme peaks before readback.",
    execution: "Single-sample · final stereo write", wgsl: "pcm[n] = clamp(softClip(signal * gain), vec2(-0.92), vec2(0.92));", auditionPreset: "pm-bell",
    inputs: [port("signal", "stereo in", "stereo", { types: ["audio", "stereo"], required: true })], outputs: [],
    params: [
      parameter("level", "Shader level", 0, 1, 0.72, { step: 0.01, low: "silent", high: "full", behavior: "Sets the level written by the shader before the page's master output control." }),
      parameter("ceiling", "Soft ceiling", 0.2, 1, 0.88, { step: 0.01, low: "compressed", high: "open", behavior: "Sets the maximum PCM magnitude after soft limiting." }),
    ],
    faust: { symbol: "process", url: "https://faustdoc.grame.fr/manual/quick-start/#the-process-line" },
  }),
]);

const MODULE_BY_ID = new Map(SHADER_PLAYGROUND_MODULES.map((entry) => [entry.id, entry]));
export const SHADER_PLAYGROUND_SCENES = createShaderPlaygroundScenes(SHADER_PLAYGROUND_MODULES);

function node(id, type, x, y, params = {}) {
  const spec = MODULE_BY_ID.get(type);
  return {
    id,
    type,
    x,
    y,
    params: Object.fromEntries(spec.params.map((entry) => [entry.id, params[entry.id] ?? entry.default])),
  };
}

function edge(id, fromNode, fromPort, toNode, toPort) {
  return { id, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
}

export const SHADER_PLAYGROUND_PRESETS = freeze([
  freeze({
    id: "pm-bell", name: "PM Bell", description: "A clocked PM voice whose contour controls both brightness and amplitude.",
    patch: freeze({
      id: "pm-bell", name: "PM Bell",
      nodes: freeze([
        node("clock", "clock", 28, 48, { rate: 2.2, swing: 0 }),
        node("shape", "contour", 250, 34, { attack: 0.012, tail: 0.42, curve: 1.8 }),
        node("voice", "fm", 250, 190, { frequency: 164.81, ratio: 2.713, index: 2.4, modDepth: 4.5 }),
        node("vca", "vca", 474, 130, { base: 0, depth: 1, drive: 1.35 }),
        node("pan", "pan", 688, 130, { pan: -0.08, depth: 0 }),
        node("out", "output", 900, 130, { level: 0.72, ceiling: 0.88 }),
      ]),
      connections: freeze([
        edge("clock-shape", "clock", "phase", "shape", "phase"),
        edge("shape-index", "shape", "out", "voice", "index"),
        edge("voice-vca", "voice", "out", "vca", "signal"),
        edge("shape-vca", "shape", "out", "vca", "cv"),
        edge("vca-pan", "vca", "out", "pan", "signal"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "folded-pulse", name: "Folded Pulse", description: "An anti-aliased pulse/saw source animated through phase modulation and folding.",
    patch: freeze({
      id: "folded-pulse", name: "Folded Pulse",
      nodes: freeze([
        node("clock", "clock", 24, 42, { rate: 3.4, swing: 0.18 }),
        node("env", "contour", 232, 36, { attack: 0.01, tail: 0.23, curve: 1.3 }),
        node("lfo", "lfo", 24, 218, { rate: 0.31, shape: 0, depth: 0.7 }),
        node("osc", "oscillator", 232, 205, { frequency: 82.41, waveform: 2, pmDepth: 0.42, level: 0.5 }),
        node("fold", "fold", 452, 190, { drive: 4.8, fold: 0.82, mix: 0.88 }),
        node("vca", "vca", 662, 126, { base: 0, depth: 1, drive: 1.2 }),
        node("pan", "pan", 870, 126, { pan: 0.04, depth: 0 }),
        node("out", "output", 1072, 126, { level: 0.7 }),
      ]),
      connections: freeze([
        edge("clock-env", "clock", "phase", "env", "phase"), edge("lfo-osc", "lfo", "out", "osc", "pm"),
        edge("osc-fold", "osc", "out", "fold", "signal"), edge("fold-vca", "fold", "out", "vca", "signal"),
        edge("env-vca", "env", "out", "vca", "cv"), edge("vca-pan", "vca", "out", "pan", "signal"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "metal-rain", name: "Metal Rain", description: "Stretched additive partials, quantization, and a short clocked contour.",
    patch: freeze({
      id: "metal-rain", name: "Metal Rain",
      nodes: freeze([
        node("clock", "clock", 24, 42, { rate: 6.7, swing: 0.23 }),
        node("env", "contour", 238, 42, { attack: 0.004, tail: 0.18, curve: 2.4 }),
        node("bank", "additive", 238, 214, { frequency: 118, partials: 21, tilt: 0.86, stretch: 1.047, level: 0.29 }),
        node("crush", "quantize", 464, 205, { bits: 6, mix: 0.38, level: 0.9 }),
        node("vca", "vca", 678, 126, { base: 0, depth: 1, drive: 1.55 }),
        node("panlfo", "lfo", 464, 42, { rate: 0.14, shape: 1, depth: 0.85 }),
        node("pan", "pan", 884, 126, { pan: 0, depth: 0.88 }),
        node("out", "output", 1088, 126, { level: 0.66 }),
      ]),
      connections: freeze([
        edge("clock-env", "clock", "phase", "env", "phase"), edge("bank-crush", "bank", "out", "crush", "signal"),
        edge("crush-vca", "crush", "out", "vca", "signal"), edge("env-vca", "env", "out", "vca", "cv"),
        edge("vca-pan", "vca", "out", "pan", "signal"), edge("lfo-pan", "panlfo", "out", "pan", "position"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "moving-drone", name: "Moving Drone", description: "Two oscillators become sum-and-difference tones, then fold and move in stereo.",
    patch: freeze({
      id: "moving-drone", name: "Moving Drone",
      nodes: freeze([
        node("a", "oscillator", 24, 50, { frequency: 73.42, waveform: 1, level: 0.48 }),
        node("b", "oscillator", 24, 226, { frequency: 110, waveform: 0, level: 0.48 }),
        node("ring", "ring", 246, 132, { amount: 0.86, level: 0.86 }),
        node("fold", "fold", 460, 132, { drive: 2.7, fold: 0.52, mix: 0.66 }),
        node("lfo", "lfo", 460, 306, { rate: 0.057, shape: 0, depth: 0.92 }),
        node("pan", "pan", 678, 132, { pan: 0, depth: 0.9 }),
        node("clip", "softclip", 884, 132, { drive: 1.5, mix: 0.7, level: 0.82 }),
        node("out", "output", 1090, 132, { level: 0.62 }),
      ]),
      connections: freeze([
        edge("a-ring", "a", "out", "ring", "a"), edge("b-ring", "b", "out", "ring", "b"),
        edge("ring-fold", "ring", "out", "fold", "signal"), edge("fold-pan", "fold", "out", "pan", "signal"),
        edge("lfo-pan", "lfo", "out", "pan", "position"), edge("pan-clip", "pan", "out", "clip", "signal"),
        edge("clip-out", "clip", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "gpu-organ-lanes", name: "GPU Organ Lanes", description: "Nine editable drawbar ranks follow a chord arpeggiator through chorale motion and a diffuse room.",
    patch: freeze({
      id: "gpu-organ-lanes", name: "GPU Organ Lanes",
      nodes: freeze([
        node("organ", "additive-drawbar-organ", 280, 54, { frequency: 73.42, ranks: 9, timbre: 0.48, chorale: 0.36, rotor: 0.52, width: 0.88, level: 0.34, cvDepth: 0.3 }),
        node("arp", "chord-arpeggiator", 24, 214, { rate: 3.4, chord: 1, voicing: 3, pattern: 2, transpose: 0, width: 0.74, glide: 0.09, swing: 0.1 }),
        node("amp", "vca", 548, 116, { base: 0.02, depth: 0.98, drive: 1.12 }),
        node("ensemble", "chorus", 770, 116, { base: 20, depth: 5.8, rate: 0.28, mix: 0.52, voices: 6, spread: 0.94, drift: 0.42, level: 0.9 }),
        node("room", "reverb", 986, 116, { size: 2.7, decay: 0.86, taps: 54, mix: 0.38, predelay: 0.038, width: 0.96, tone: 0.42, level: 0.86 }),
        node("out", "output", 1202, 116, { level: 0.58, ceiling: 0.88 }),
      ]),
      connections: freeze([
        edge("arp-pitch", "arp", "pitch", "organ", "pitch"), edge("organ-amp", "organ", "out", "amp", "signal"),
        edge("arp-gate", "arp", "gate", "amp", "cv"), edge("amp-ensemble", "amp", "out", "ensemble", "signal"),
        edge("ensemble-room", "ensemble", "out", "room", "signal"), edge("room-out", "room", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "simple-delay", name: "Simple Delay", description: "A click-safe GPU arpeggio leaves a clear, widening trail of evenly spaced echoes.",
    patch: freeze({
      id: "simple-delay", name: "Simple Delay",
      nodes: freeze([
        node("arp", "gpu-arp", 24, 208, { rate: 3.2, steps: 7, pattern: 2, scale: 3, octaves: 2, glide: 0.04, swing: 0.08, seed: 4111 }),
        node("voice", "oscillator", 24, 44, { frequency: 98, waveform: 2, shape: 0.44, level: 0.42 }),
        node("amp", "vca", 292, 108, { base: 0, depth: 1, drive: 1.18 }),
        node("echo", "delay", 548, 108, { time: 0.285, repeats: 5, decay: 0.66, mix: 0.52, spread: 0.92, tone: 0.12, pattern: 0.1, level: 0.9 }),
        node("out", "output", 824, 108, { level: 0.64, ceiling: 0.88 }),
      ]),
      connections: freeze([
        edge("arp-pitch", "arp", "pitch", "voice", "pitch"), edge("voice-amp", "voice", "out", "amp", "signal"),
        edge("arp-gate", "arp", "gate", "amp", "cv"), edge("amp-echo", "amp", "out", "echo", "signal"),
        edge("echo-out", "echo", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "warm-vibrato", name: "Warm Vibrato", description: "A slowly changing harmonic color passes through a cents-calibrated stereo pitch bend.",
    patch: freeze({
      id: "warm-vibrato", name: "Warm Vibrato",
      nodes: freeze([
        node("motion", "lfo", 24, 238, { rate: 0.09, shape: 0, depth: 0.52, offset: 0.08 }),
        node("voice", "vector-wavetable", 24, 56, { frequency: 110, scan: 0.28, harmonics: 22, tilt: 1.12, stereo: 0.2, cvDepth: 0.58, level: 0.38 }),
        node("bend", "vibrato", 408, 94, { rate: 5.1, depth: 21, delay: 8, mix: 1, stereo: 0.14, shape: 0.08, tone: 0.08, level: 0.94 }),
        node("out", "output", 750, 94, { level: 0.64, ceiling: 0.88 }),
      ]),
      connections: freeze([
        edge("motion-scan", "motion", "out", "voice", "scan"), edge("voice-bend", "voice", "out", "bend", "signal"),
        edge("bend-out", "bend", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "choral-room", name: "Choral Room", description: "A soft vowel arpeggio blooms through a six-voice chorus and a long, diffuse room.",
    patch: freeze({
      id: "choral-room", name: "Choral Room",
      nodes: freeze([
        node("arp", "gpu-arp", 24, 246, { rate: 2.15, steps: 9, pattern: 4, scale: 2, octaves: 3, glide: 0.22, swing: 0.11, seed: 9127 }),
        node("voice", "formant-bank", 24, 50, { frequency: 73.42, vowel: 0.54, harmonics: 30, bandwidth: 260, tilt: 0.92, breath: 0.08, level: 0.4 }),
        node("amp", "vca", 318, 112, { base: 0.03, depth: 0.97, drive: 1.08 }),
        node("ensemble", "chorus", 558, 112, { base: 22, depth: 6.8, rate: 0.24, mix: 0.62, voices: 6, spread: 0.96, drift: 0.52, level: 0.9 }),
        node("room", "reverb", 798, 112, { size: 3.1, decay: 0.9, taps: 60, mix: 0.54, predelay: 0.052, width: 0.98, tone: 0.52, level: 0.82 }),
        node("out", "output", 1048, 112, { level: 0.56, ceiling: 0.88 }),
      ]),
      connections: freeze([
        edge("arp-pitch", "arp", "pitch", "voice", "pitch"), edge("voice-amp", "voice", "out", "amp", "signal"),
        edge("arp-gate", "arp", "gate", "amp", "cv"), edge("amp-ensemble", "amp", "out", "ensemble", "signal"),
        edge("ensemble-room", "ensemble", "out", "room", "signal"), edge("room-out", "room", "out", "out", "signal"),
      ]),
    }),
  }),
  freeze({
    id: "spectral-bloom", name: "Spectral Bloom", description: "A sparse grain cloud is rebuilt into shifted spectral light, then opened into a wide room.",
    patch: freeze({
      id: "spectral-bloom", name: "Spectral Bloom",
      nodes: freeze([
        node("motion", "lfo", 24, 248, { rate: 0.16, shape: 1, depth: 0.42, offset: 0.18 }),
        node("cloud", "particle-cloud", 24, 54, { frequency: 130.81, rate: 13, size: 0.085, density: 0.58, spread: 14, stereo: 0.92, seed: 22343, level: 0.3 }),
        node("spectrum", "spectral-resynth", 392, 96, { window: 112, bins: 20, shift: 1.48, mix: 0.66, smear: 0.78, tilt: 0.82, width: 0.96, level: 0.82 }),
        node("room", "reverb", 676, 96, { size: 3.65, decay: 0.94, taps: 64, mix: 0.58, predelay: 0.09, width: 1, tone: 0.68, level: 0.78 }),
        node("out", "output", 944, 96, { level: 0.54, ceiling: 0.86 }),
      ]),
      connections: freeze([
        edge("motion-density", "motion", "out", "cloud", "density"), edge("cloud-spectrum", "cloud", "out", "spectrum", "signal"),
        edge("spectrum-room", "spectrum", "out", "room", "signal"), edge("room-out", "room", "out", "out", "signal"),
      ]),
    }),
  }),
]);

// The combination library is generated from a small set of readable graph
// families and fixed voicings. Keeping the recipe data deterministic makes the
// collection inexpensive to maintain while still giving the UI many complete,
// playable patches to browse.
const COMBO_VOICINGS = freeze([
  freeze({ id: "deep", name: "Deep", description: "low, slow, and gently driven", frequency: 55, rate: 0.72, motion: 0.07, pan: -0.58, ratio: 0.5, drive: 1.5, bits: 12, waveform: 0 }),
  freeze({ id: "hollow", name: "Hollow", description: "open intervals with a restrained center", frequency: 73.42, rate: 1.05, motion: 0.11, pan: -0.36, ratio: 1.414, drive: 2.1, bits: 10, waveform: 1 }),
  freeze({ id: "amber", name: "Amber", description: "warm midrange motion and rounded edges", frequency: 92.5, rate: 1.48, motion: 0.17, pan: -0.18, ratio: 2, drive: 2.8, bits: 9, waveform: 2 }),
  freeze({ id: "clear", name: "Clear", description: "balanced pitch, timing, and harmonic weight", frequency: 110, rate: 2.1, motion: 0.23, pan: 0, ratio: 2.5, drive: 3.4, bits: 8, waveform: 0 }),
  freeze({ id: "glass", name: "Glass", description: "bright inharmonic partials with moderate motion", frequency: 138.59, rate: 2.85, motion: 0.31, pan: 0.22, ratio: 2.713, drive: 4.2, bits: 7, waveform: 1 }),
  freeze({ id: "wire", name: "Wire", description: "taut upper-mid harmonics and faster articulation", frequency: 174.61, rate: 3.75, motion: 0.43, pan: 0.44, ratio: 3.5, drive: 5.1, bits: 6, waveform: 2 }),
  freeze({ id: "spark", name: "Spark", description: "short bright events with coarse spectral edges", frequency: 220, rate: 5.1, motion: 0.59, pan: 0.64, ratio: 5, drive: 6.3, bits: 5, waveform: 3 }),
  freeze({ id: "nervous", name: "Nervous", description: "quick asymmetric motion and dense modulation", frequency: 277.18, rate: 7.25, motion: 0.83, pan: -0.72, ratio: 6.75, drive: 7.7, bits: 4, waveform: 2 }),
  freeze({ id: "prism", name: "Prism", description: "high, widely spread, and strongly transformed", frequency: 349.23, rate: 10.4, motion: 1.21, pan: 0.76, ratio: 9, drive: 9.2, bits: 3, waveform: 3 }),
]);

function comboGraph(id, name, nodes, connections) {
  return freeze({ id, name, nodes: freeze(nodes), connections: freeze(connections) });
}

function comboOutput(level = 0.66) {
  return node("out", "output", 1080, 150, { level, ceiling: 0.88 });
}

const COMBO_FAMILIES = freeze([
  freeze({
    id: "wave-pan", name: "Wave + position",
    description: "A waveform passes directly into stereo while a constant sets its position.",
    route: "Oscillator → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("source", "oscillator", 30, 90, { frequency: v.frequency, waveform: v.waveform, level: 0.42 }),
        node("position", "constant", 30, 280, { amount: v.pan }),
        node("pan", "pan", 650, 130, { pan: 0, depth: 1, level: 0.9 }), comboOutput(),
      ], [
        edge("source-pan", "source", "out", "pan", "signal"), edge("position-pan", "position", "out", "pan", "position"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "fold-motion", name: "Moving wavefold",
    description: "An LFO bends oscillator phase and stereo position around a wavefolder.",
    route: "Oscillator → Wavefolder → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("motion", "lfo", 25, 270, { rate: v.motion, shape: v.waveform, depth: 0.72 }),
        node("source", "oscillator", 25, 70, { frequency: v.frequency, waveform: (v.waveform + 2) % 4, pmDepth: 0.35 + v.motion * 0.18, level: 0.44 }),
        node("fold", "fold", 360, 80, { drive: v.drive, fold: 0.68, mix: 0.78, symmetry: v.pan * 0.18 }),
        node("pan", "pan", 720, 120, { pan: v.pan * 0.25, depth: 0.78 }), comboOutput(0.62),
      ], [
        edge("motion-source", "motion", "out", "source", "pm"), edge("source-fold", "source", "out", "fold", "signal"),
        edge("fold-pan", "fold", "out", "pan", "signal"), edge("motion-pan", "motion", "out", "pan", "position"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "noise-events", name: "Noise events",
    description: "A clock contour articulates deterministic noise before amplitude quantization.",
    route: "Hash noise → VCA → Quantizer → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("clock", "clock", 20, 30, { rate: v.rate, swing: Math.min(0.38, v.motion * 0.16) }),
        node("env", "contour", 260, 30, { attack: 0.004 + v.motion * 0.002, tail: 0.12 + v.motion * 0.16, curve: 1.2 + v.motion }),
        node("source", "noise", 20, 245, { rate: Math.min(48000, 900 + v.frequency * 82), smooth: Math.min(0.88, 0.08 + v.motion * 0.12), seed: 1901 + Math.round(v.frequency * 31), level: 0.32 }),
        node("amp", "vca", 480, 150, { base: 0, depth: 1, drive: 1.25 }),
        node("steps", "quantize", 690, 150, { bits: v.bits, mix: 0.54, level: 0.82 }),
        node("pan", "pan", 880, 150, { pan: v.pan, depth: 0 }), comboOutput(0.64),
      ], [
        edge("clock-env", "clock", "phase", "env", "phase"), edge("source-amp", "source", "out", "amp", "signal"),
        edge("env-amp", "env", "out", "amp", "cv"), edge("amp-steps", "amp", "out", "steps", "signal"),
        edge("steps-pan", "steps", "out", "pan", "signal"), edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "pm-strikes", name: "PM strikes",
    description: "One event contour opens a PM voice and expands its sidebands at the onset.",
    route: "FM / PM voice → VCA → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("clock", "clock", 20, 30, { rate: v.rate, swing: Math.min(0.4, v.motion * 0.12) }),
        node("env", "contour", 250, 30, { attack: 0.006, tail: 0.18 + v.motion * 0.18, curve: 1.3 + v.motion * 0.55 }),
        node("voice", "fm", 250, 230, { frequency: v.frequency * 1.5, ratio: v.ratio, index: 1.2 + v.motion, modDepth: 2.1 + v.motion * 2.2, level: 0.38 }),
        node("amp", "vca", 500, 135, { base: 0, depth: 1, drive: 1.2 + v.motion * 0.2 }),
        node("pan", "pan", 760, 135, { pan: v.pan, depth: 0 }), comboOutput(0.66),
      ], [
        edge("clock-env", "clock", "phase", "env", "phase"), edge("env-voice", "env", "out", "voice", "index"),
        edge("voice-amp", "voice", "out", "amp", "signal"), edge("env-amp", "env", "out", "amp", "cv"),
        edge("amp-pan", "amp", "out", "pan", "signal"), edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "partial-shimmer", name: "Partial shimmer",
    description: "Slow control reshapes a stretched harmonic bank and moves its saturated output.",
    route: "Harmonic bank → Soft clip → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("motion", "lfo", 20, 275, { rate: v.motion, shape: v.waveform, depth: 0.68 }),
        node("bank", "additive", 20, 70, { frequency: v.frequency, partials: 8 + v.bits, tilt: 0.62 + v.bits * 0.055, stretch: 1 + (v.ratio % 3) * 0.012, level: 0.34 }),
        node("clip", "softclip", 400, 95, { drive: 1.2 + v.drive * 0.32, mix: 0.68, level: 0.83 }),
        node("pan", "pan", 740, 125, { pan: 0, depth: 0.82 }), comboOutput(0.61),
      ], [
        edge("motion-bank", "motion", "out", "bank", "brightness"), edge("bank-clip", "bank", "out", "clip", "signal"),
        edge("clip-pan", "clip", "out", "pan", "signal"), edge("motion-pan", "motion", "out", "pan", "position"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "ring-fold", name: "Ring + fold",
    description: "Two oscillators multiply into sum-and-difference tones before folding.",
    route: "2× Oscillator → Ring modulator → Wavefolder → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("a", "oscillator", 20, 30, { frequency: v.frequency, waveform: v.waveform, level: 0.46 }),
        node("b", "oscillator", 20, 225, { frequency: v.frequency * (1 + v.ratio * 0.19), waveform: (v.waveform + 1) % 4, level: 0.43 }),
        node("ring", "ring", 300, 125, { amount: 0.58 + Math.min(0.4, v.motion * 0.25), level: 0.82 }),
        node("fold", "fold", 530, 125, { drive: v.drive, fold: 0.56, mix: 0.7, symmetry: v.pan * 0.12 }),
        node("pan", "pan", 790, 125, { pan: v.pan, depth: 0 }), comboOutput(0.58),
      ], [
        edge("a-ring", "a", "out", "ring", "a"), edge("b-ring", "b", "out", "ring", "b"),
        edge("ring-fold", "ring", "out", "fold", "signal"), edge("fold-pan", "fold", "out", "pan", "signal"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "dual-spectrum", name: "Dual spectrum",
    description: "A periodic wave and stretched partial bank meet in an equal-power mix.",
    route: "Oscillator + Harmonic bank → Mix → Soft clip → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("wave", "oscillator", 20, 30, { frequency: v.frequency, waveform: v.waveform, level: 0.38 }),
        node("bank", "additive", 20, 230, { frequency: v.frequency * 0.5, partials: 6 + v.bits, tilt: 0.82, stretch: 1.006 + v.motion * 0.012, level: 0.3 }),
        node("blend", "mix", 330, 125, { balance: v.pan * 0.55, level: 0.7 }),
        node("clip", "softclip", 560, 125, { drive: 1.4 + v.drive * 0.28, mix: 0.62, level: 0.82 }),
        node("pan", "pan", 800, 125, { pan: -v.pan * 0.45, depth: 0 }), comboOutput(0.62),
      ], [
        edge("wave-blend", "wave", "out", "blend", "a"), edge("bank-blend", "bank", "out", "blend", "b"),
        edge("blend-clip", "blend", "out", "clip", "signal"), edge("clip-pan", "clip", "out", "pan", "signal"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "pm-layer", name: "PM layer",
    description: "A PM voice and waveform layer combine, fold, and drift across stereo.",
    route: "FM / PM voice + Oscillator → Mix → Wavefolder → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("motion", "lfo", 20, 335, { rate: v.motion, shape: (v.waveform + 1) % 4, depth: 0.74 }),
        node("voice", "fm", 20, 25, { frequency: v.frequency, ratio: v.ratio, index: 1.4 + v.motion * 1.7, modDepth: 1.8, level: 0.33 }),
        node("wave", "oscillator", 20, 180, { frequency: v.frequency * 0.5, waveform: v.waveform, level: 0.32 }),
        node("blend", "mix", 330, 110, { balance: v.pan * 0.38, level: 0.74 }),
        node("fold", "fold", 550, 110, { drive: 1.5 + v.drive * 0.55, fold: 0.66, mix: 0.7 }),
        node("pan", "pan", 790, 110, { pan: 0, depth: 0.84 }), comboOutput(0.58),
      ], [
        edge("motion-voice", "motion", "out", "voice", "index"), edge("voice-blend", "voice", "out", "blend", "a"),
        edge("wave-blend", "wave", "out", "blend", "b"), edge("blend-fold", "blend", "out", "fold", "signal"),
        edge("fold-pan", "fold", "out", "pan", "signal"), edge("motion-pan", "motion", "out", "pan", "position"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "gated-hybrid", name: "Gated hybrid",
    description: "Clocked amplitude shapes a noise-and-wave blend before bit-depth reduction.",
    route: "Noise + Oscillator → Mix → VCA → Quantizer → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("clock", "clock", 15, 20, { rate: v.rate, swing: Math.min(0.4, v.motion * 0.18) }),
        node("env", "contour", 230, 20, { attack: 0.006, tail: 0.14 + v.motion * 0.15, curve: 1.5 }),
        node("noise", "noise", 15, 195, { rate: 1800 + v.frequency * 48, smooth: 0.12, seed: 7001 + Math.round(v.frequency), level: 0.22 }),
        node("wave", "oscillator", 15, 350, { frequency: v.frequency, waveform: v.waveform, level: 0.38 }),
        node("blend", "mix", 320, 245, { balance: v.pan * 0.5, level: 0.76 }),
        node("amp", "vca", 540, 155, { base: 0, depth: 1, drive: 1.25 }),
        node("steps", "quantize", 735, 155, { bits: v.bits, mix: 0.42, level: 0.86 }),
        node("pan", "pan", 915, 155, { pan: v.pan, depth: 0 }), comboOutput(0.62),
      ], [
        edge("clock-env", "clock", "phase", "env", "phase"), edge("noise-blend", "noise", "out", "blend", "a"),
        edge("wave-blend", "wave", "out", "blend", "b"), edge("blend-amp", "blend", "out", "amp", "signal"),
        edge("env-amp", "env", "out", "amp", "cv"), edge("amp-steps", "amp", "out", "steps", "signal"),
        edge("steps-pan", "steps", "out", "pan", "signal"), edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "phase-pulse", name: "Phase pulse",
    description: "Independent slow phase motion colors an oscillator inside a clocked amplitude shape.",
    route: "Oscillator → VCA → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("clock", "clock", 15, 20, { rate: v.rate * 0.75, swing: 0.08 + Math.min(0.28, v.motion * 0.1) }),
        node("env", "contour", 235, 20, { attack: 0.008, tail: 0.2 + v.motion * 0.12, curve: 1.35 }),
        node("motion", "lfo", 15, 330, { rate: v.motion * 1.3, shape: v.waveform, depth: 0.82 }),
        node("source", "oscillator", 235, 245, { frequency: v.frequency, waveform: (v.waveform + 3) % 4, pmDepth: 0.35 + v.motion * 0.35, level: 0.44 }),
        node("amp", "vca", 510, 130, { base: 0, depth: 1, drive: 1.1 + v.drive * 0.08 }),
        node("pan", "pan", 770, 130, { pan: v.pan, depth: 0 }), comboOutput(0.65),
      ], [
        edge("clock-env", "clock", "phase", "env", "phase"), edge("motion-source", "motion", "out", "source", "pm"),
        edge("source-amp", "source", "out", "amp", "signal"), edge("env-amp", "env", "out", "amp", "cv"),
        edge("amp-pan", "amp", "out", "pan", "signal"), edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "folded-partials", name: "Folded partials",
    description: "A clocked harmonic bank is quantized, folded, and articulated as a short event.",
    route: "Harmonic bank → Quantizer → Wavefolder → VCA → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("clock", "clock", 15, 20, { rate: v.rate * 1.2, swing: Math.min(0.36, v.motion * 0.14) }),
        node("env", "contour", 225, 20, { attack: 0.004, tail: 0.11 + v.motion * 0.1, curve: 1.8 + v.motion * 0.35 }),
        node("bank", "additive", 15, 240, { frequency: v.frequency, partials: Math.min(32, 10 + v.bits), tilt: 0.65 + v.bits * 0.04, stretch: 1.008 + (v.ratio % 4) * 0.011, level: 0.3 }),
        node("steps", "quantize", 265, 235, { bits: Math.min(14, v.bits + 2), mix: 0.36, level: 0.88 }),
        node("fold", "fold", 475, 220, { drive: 1.2 + v.drive * 0.5, fold: 0.58, mix: 0.66 }),
        node("amp", "vca", 670, 125, { base: 0, depth: 1, drive: 1.2 }),
        node("pan", "pan", 875, 125, { pan: v.pan, depth: 0 }), comboOutput(0.59),
      ], [
        edge("clock-env", "clock", "phase", "env", "phase"), edge("bank-steps", "bank", "out", "steps", "signal"),
        edge("steps-fold", "steps", "out", "fold", "signal"), edge("fold-amp", "fold", "out", "amp", "signal"),
        edge("env-amp", "env", "out", "amp", "cv"), edge("amp-pan", "amp", "out", "pan", "signal"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
  freeze({
    id: "three-source-drone", name: "Three-source drone",
    description: "Ring-modulated oscillators blend with a harmonic bank before saturation and stereo motion.",
    route: "Oscillator × PM voice + Harmonic bank → Mix → Soft clip → Pan → Output",
    build(v, id, name) {
      return comboGraph(id, name, [
        node("motion", "lfo", 15, 420, { rate: v.motion * 0.55, shape: v.waveform, depth: 0.75 }),
        node("wave", "oscillator", 15, 20, { frequency: v.frequency, waveform: v.waveform, level: 0.38 }),
        node("voice", "fm", 15, 170, { frequency: v.frequency * 1.5, ratio: v.ratio, index: 1.5 + v.motion, modDepth: 1.8, level: 0.32 }),
        node("ring", "ring", 280, 90, { amount: 0.72, level: 0.8 }),
        node("bank", "additive", 15, 305, { frequency: v.frequency * 0.5, partials: 7 + v.bits, tilt: 0.94, stretch: 1.004 + v.motion * 0.01, level: 0.27 }),
        node("blend", "mix", 505, 175, { balance: v.pan * 0.5, level: 0.72 }),
        node("clip", "softclip", 700, 175, { drive: 1.5 + v.drive * 0.3, mix: 0.7, level: 0.8 }),
        node("pan", "pan", 890, 175, { pan: 0, depth: 0.86 }), comboOutput(0.55),
      ], [
        edge("motion-voice", "motion", "out", "voice", "index"), edge("wave-ring", "wave", "out", "ring", "a"),
        edge("voice-ring", "voice", "out", "ring", "b"), edge("ring-blend", "ring", "out", "blend", "a"),
        edge("bank-blend", "bank", "out", "blend", "b"), edge("blend-clip", "blend", "out", "clip", "signal"),
        edge("clip-pan", "clip", "out", "pan", "signal"), edge("motion-pan", "motion", "out", "pan", "position"),
        edge("pan-out", "pan", "out", "out", "signal"),
      ]);
    },
  }),
]);

const GENERATED_COMBOS = COMBO_FAMILIES.flatMap((family, familyIndex) =>
  COMBO_VOICINGS.map((voicing, voicingIndex) => {
    const sequence = familyIndex * COMBO_VOICINGS.length + voicingIndex + 1;
    const id = `combo-${String(sequence).padStart(3, "0")}-${family.id}-${voicing.id}`;
    const name = `${family.name} · ${voicing.name}`;
    const patch = family.build(voicing, id, name);
    const moduleTypes = [...new Set(patch.nodes.map((graphNode) => graphNode.type))];
    return freeze({
      id,
      name,
      description: `${family.description} This voicing is ${voicing.description}.`,
      family: family.id,
      character: voicing.id,
      route: family.route,
      moduleTypes: freeze(moduleTypes),
      moduleNames: freeze(moduleTypes.map((type) => MODULE_BY_ID.get(type).name)),
      patch,
    });
  }),
);

function moduleCombo(sequence, slug, name, description, category, route, patch) {
  const moduleTypes = [...new Set(patch.nodes.map((graphNode) => graphNode.type))];
  return freeze({
    id: `combo-${String(sequence).padStart(3, "0")}-${slug}`,
    name,
    description,
    family: slug,
    character: "primitive-audition",
    category,
    route,
    moduleTypes: freeze(moduleTypes),
    moduleNames: freeze(moduleTypes.map((type) => MODULE_BY_ID.get(type).name)),
    patch,
  });
}

const MODULE_COMBOS = [
  moduleCombo(109, "spectral-acid-sweep", "Spectral Acid · Held sweep", "A deterministic held control moves the spectral cutoff and its emphasized harmonic band.", "tonal", "Sample + Hold → Spectral Acid → Pan → Output",
    comboGraph("combo-109-spectral-acid-sweep", "Spectral Acid · Held sweep", [
      node("motion", "sample-hold", 20, 260, { rate: 1.7, slew: 0.32, depth: 0.76, seed: 17011 }),
      node("source", "spectral-acid", 250, 80, { frequency: 82.41, partials: 36, cutoff: 0.36, resonance: 0.78, cvDepth: 0.68, drive: 2.2 }),
      node("pan", "pan", 660, 110, { pan: -0.08, depth: 0, level: 0.88 }), comboOutput(0.62),
    ], [
      edge("motion-acid", "motion", "out", "source", "cutoff"), edge("acid-pan", "source", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(110, "modal-metal-strike", "Modal Metal · Euclidean plate", "A Euclidean gate accents the analytic rings of a stiff, scattered modal plate.", "rhythmic", "Euclidean Gate → Modal Metal → Pan → Output",
    comboGraph("combo-110-modal-metal-strike", "Modal Metal · Euclidean plate", [
      node("gate", "euclidean-gate", 20, 250, { rate: 7.5, steps: 13, pulses: 5, rotation: 2, width: 0.46 }),
      node("source", "modal-metal", 280, 70, { frequency: 126, rate: 7.5, decay: 0.64, inharmonicity: 0.78, modes: 22, strikeDepth: 1, level: 0.46 }),
      node("pan", "pan", 680, 110, { pan: 0.18, depth: 0 }), comboOutput(0.6),
    ], [
      edge("gate-metal", "gate", "out", "source", "strike"), edge("metal-pan", "source", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(111, "particle-cloud-drift", "Particle Cloud · Sparse drift", "Held density motion opens and thins a stereo field of synthetic grains.", "texture", "Sample + Hold → Particle Cloud → Pan → Output",
    comboGraph("combo-111-particle-cloud-drift", "Particle Cloud · Sparse drift", [
      node("motion", "sample-hold", 20, 270, { rate: 0.74, slew: 0.58, depth: 0.7, offset: -0.12, seed: 57037 }),
      node("source", "particle-cloud", 275, 70, { frequency: 174.61, rate: 27, size: 0.056, density: 0.48, spread: 14, stereo: 0.92, seed: 7219, level: 0.4 }),
      node("pan", "pan", 690, 110, { pan: 0, depth: 0, level: 0.94 }), comboOutput(0.58),
    ], [
      edge("motion-cloud", "motion", "out", "source", "density"), edge("cloud-pan", "source", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(112, "vector-wavetable-scan", "Vector Wavetable · Fourier scan", "A slow triangle control scans an analytic sine–triangle–saw spectrum.", "tonal", "LFO → Vector Wavetable → Pan → Output",
    comboGraph("combo-112-vector-wavetable-scan", "Vector Wavetable · Fourier scan", [
      node("motion", "lfo", 20, 270, { rate: 0.16, shape: 1, depth: 0.82 }),
      node("source", "vector-wavetable", 270, 70, { frequency: 110, scan: 0.5, harmonics: 28, tilt: 0.92, stereo: 0.5, cvDepth: 0.58, level: 0.4 }),
      node("pan", "pan", 690, 110, { pan: -0.12, depth: 0 }), comboOutput(0.61),
    ], [
      edge("motion-table", "motion", "out", "source", "scan"), edge("table-pan", "source", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(113, "formant-bank-vowel", "Formant Bank · Vowel orbit", "A slow sine traverses vowel formants independently of the harmonic fundamental.", "tonal", "LFO → Formant Bank → Pan → Output",
    comboGraph("combo-113-formant-bank-vowel", "Formant Bank · Vowel orbit", [
      node("motion", "lfo", 20, 270, { rate: 0.11, shape: 0, depth: 0.86 }),
      node("source", "formant-bank", 270, 65, { frequency: 92.5, vowel: 0.48, harmonics: 30, bandwidth: 260, breath: 0.09, cvDepth: 0.58, level: 0.46 }),
      node("pan", "pan", 690, 110, { pan: 0.1, depth: 0 }), comboOutput(0.61),
    ], [
      edge("motion-vowel", "motion", "out", "source", "vowel"), edge("vowel-pan", "source", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(114, "procedural-kick-body", "Procedural Kick · Bent body", "An integrated pitch fall and separate click pass through a restrained soft ceiling.", "rhythmic", "Procedural Kick → Soft clip → Pan → Output",
    comboGraph("combo-114-procedural-kick-body", "Procedural Kick · Bent body", [
      node("source", "procedural-kick", 25, 95, { rate: 2.6, frequency: 48, drop: 5.4, decay: 0.42, click: 0.4, drive: 1.9, level: 0.7 }),
      node("clip", "softclip", 360, 95, { drive: 1.45, mix: 0.56, level: 0.86 }),
      node("pan", "pan", 690, 110, { pan: 0, depth: 0 }), comboOutput(0.63),
    ], [
      edge("kick-clip", "source", "out", "clip", "signal"), edge("clip-pan", "clip", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(115, "sample-hold-phase", "Sample + Hold · Phase steps", "Held bipolar values jump an oscillator's phase before folding, producing repeatable timbre changes.", "experimental", "Sample + Hold → Oscillator → Wavefolder → Pan → Output",
    comboGraph("combo-115-sample-hold-phase", "Sample + Hold · Phase steps", [
      node("motion", "sample-hold", 20, 275, { rate: 4.2, slew: 0.04, depth: 0.72, seed: 9137 }),
      node("source", "oscillator", 260, 70, { frequency: 98, waveform: 1, pmDepth: 2.4, level: 0.46 }),
      node("fold", "fold", 500, 80, { drive: 2.6, fold: 0.62, mix: 0.7 }),
      node("pan", "pan", 745, 105, { pan: -0.2, depth: 0 }), comboOutput(0.59),
    ], [
      edge("hold-phase", "motion", "out", "source", "pm"), edge("source-fold", "source", "out", "fold", "signal"),
      edge("fold-pan", "fold", "out", "pan", "signal"), edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(116, "euclidean-gate-pulse", "Euclidean Gate · Pulse lattice", "An even-distribution predicate opens a bright oscillator VCA on five of sixteen steps.", "rhythmic", "Euclidean Gate + Oscillator → VCA → Pan → Output",
    comboGraph("combo-116-euclidean-gate-pulse", "Euclidean Gate · Pulse lattice", [
      node("gate", "euclidean-gate", 20, 260, { rate: 9, steps: 16, pulses: 5, rotation: 3, width: 0.31, accent: 0.28 }),
      node("source", "oscillator", 20, 70, { frequency: 146.83, waveform: 2, level: 0.43 }),
      node("amp", "vca", 400, 120, { base: 0, depth: 1, drive: 1.25 }),
      node("pan", "pan", 680, 120, { pan: 0.24, depth: 0 }), comboOutput(0.6),
    ], [
      edge("source-amp", "source", "out", "amp", "signal"), edge("gate-amp", "gate", "out", "amp", "cv"),
      edge("amp-pan", "amp", "out", "pan", "signal"), edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(117, "hard-sync-sweep", "Hard Sync · Ratio sweep", "A slow control sweeps the number of slave cycles reset inside each master period.", "tonal", "LFO → Hard Sync → Wavefolder → Pan → Output",
    comboGraph("combo-117-hard-sync-sweep", "Hard Sync · Ratio sweep", [
      node("motion", "lfo", 20, 275, { rate: 0.19, shape: 1, depth: 0.72 }),
      node("source", "hard-sync", 270, 70, { frequency: 110, ratio: 3.4, waveform: 0, cvDepth: 3.1, stereo: 3.5, level: 0.42 }),
      node("fold", "fold", 510, 80, { drive: 1.8, fold: 0.38, mix: 0.46 }),
      node("pan", "pan", 760, 105, { pan: 0.06, depth: 0 }), comboOutput(0.58),
    ], [
      edge("motion-sync", "motion", "out", "source", "ratio"), edge("sync-fold", "source", "out", "fold", "signal"),
      edge("fold-pan", "fold", "out", "pan", "signal"), edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(118, "phase-distortion-warp", "Phase Distortion · Bent glass", "Independent bend and split coordinates reshape one locked oscillator cycle.", "tonal", "LFO → Phase Distortion → Pan → Output",
    comboGraph("combo-118-phase-distortion-warp", "Phase Distortion · Bent glass", [
      node("motion", "lfo", 20, 270, { rate: 0.27, shape: 0, depth: 0.66 }),
      node("source", "phase-distortion", 270, 70, { frequency: 130.81, bend: 0.68, split: 0.31, curve: 0.78, cvDepth: 0.26, stereo: 2.7, level: 0.46 }),
      node("pan", "pan", 690, 110, { pan: -0.16, depth: 0 }), comboOutput(0.62),
    ], [
      edge("motion-bend", "motion", "out", "source", "bend"), edge("phase-pan", "source", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(119, "bytebeat-code", "Bytebeat · Split code", "A masked integer formula becomes stereo code rhythm before amplitude quantization.", "experimental", "Bytebeat → Quantizer → Pan → Output",
    comboGraph("combo-119-bytebeat-code", "Bytebeat · Split code", [
      node("source", "bytebeat", 25, 85, { clock: 8000, pitch: 1, formula: 1, bits: 7, variation: 29, stereo: 0.56, level: 0.3 }),
      node("steps", "quantize", 360, 90, { bits: 6, mix: 0.36, level: 0.82 }),
      node("pan", "pan", 690, 110, { pan: 0, depth: 0 }), comboOutput(0.55),
    ], [
      edge("code-steps", "source", "out", "steps", "signal"), edge("steps-pan", "steps", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
  moduleCombo(120, "chebyshev-series", "Chebyshev · Harmonic series", "A sine enters a bounded polynomial recurrence whose order and tilt expose new harmonic weights.", "experimental", "Oscillator → Polynomial / Chebyshev shaper → Pan → Output",
    comboGraph("combo-120-chebyshev-series", "Chebyshev · Harmonic series", [
      node("source", "oscillator", 25, 85, { frequency: 110, waveform: 0, level: 0.7 }),
      node("shape", "chebyshev", 350, 85, { order: 6, drive: 1.42, tilt: 1.16, mix: 0.82, bias: 0.03, level: 0.78 }),
      node("pan", "pan", 700, 110, { pan: 0.14, depth: 0 }), comboOutput(0.57),
    ], [
      edge("source-shape", "source", "out", "shape", "signal"), edge("shape-pan", "shape", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ])),
];

function firstSignalInput(spec) {
  return spec.inputs.find((candidate) => candidate.types?.some((type) => type === "audio" || type === "stereo"))
    ?? spec.inputs[0];
}

function firstSignalOutput(spec) {
  return spec.outputs.find((candidate) => candidate.type === "audio" || candidate.type === "stereo")
    ?? spec.outputs[0];
}

const SOURCE_AUDITION_CONTROL_INPUT = Object.freeze({
  "additive-drawbar-organ": "control",
  "robot-voice": "vowel",
  "fractal-recurrence": "control",
  "cyclic-fractal-noise": "control",
  "cheap-filtered-wave": "roundness",
  "additive-transfer-filter": "cutoff",
  "parallel-voice-bank": "spread",
  "wavefold-table-oscillator": "scan",
});

const EFFECT_AUDITION_OVERRIDES = Object.freeze({
  "geometric-feedback-lattice": Object.freeze({
    source: "procedural-kick",
    sourceLabel: "Procedural Kick",
    sourceParams: Object.freeze({ rate: 1.7, frequency: 48, drop: 4.8, decay: 0.2, click: 0.38, drive: 1.5, level: 0.58 }),
    focusParams: Object.freeze({ size: 11, delay: 27, feedback: 0.84, coupling: 0.7, folds: 5, rotation: 0.093, damping: 0.44, mix: 0.72 }),
  }),
  "spectral-sdf": Object.freeze({
    source: "supersaw",
    sourceLabel: "Supersaw",
    sourceParams: Object.freeze({ frequency: 82.41, voices: 7, detune: 23, spread: 0.82, driftRate: 0.16, driftDepth: 0.18, waveform: 0, level: 0.46 }),
    focusParams: Object.freeze({ fftSize: 2, shape: 3, size: 0.64, rotation: 0.11, edge: 0.07, depth: 0.8, mix: 0.84, level: 1.08 }),
  }),
  "raymarch-resonator": Object.freeze({
    source: "procedural-kick",
    sourceLabel: "Procedural Kick",
    sourceParams: Object.freeze({ rate: 2.1, frequency: 62, drop: 5.6, decay: 0.12, click: 0.64, drive: 1.25, level: 0.46 }),
    focusParams: Object.freeze({ modes: 26, shape: 2, size: 1.15, reflectivity: 0.965, damping: 0.34, brightness: 0.3, stereo: 0.84, mix: 0.9 }),
  }),
});

function buildModuleAudition(spec, sequence) {
  const slug = `audition-${spec.id}`;
  const comboId = `combo-${String(sequence).padStart(3, "0")}-${slug}`;
  const name = `${spec.name} · Hear`;
  const focusOutputSpec = firstSignalOutput(spec);
  const focusOutput = focusOutputSpec?.id;
  const focusInput = firstSignalInput(spec)?.id;
  let route;
  let patch;

  if (spec.id === "gaussian-random-pair") {
    route = `2× Sample + Hold → ${spec.name} → Oscillator pitch + pan → Output`;
    patch = comboGraph(comboId, name, [
      node("uniform-a", "sample-hold", 20, 245, { rate: 1.7, seed: 17011, slew: 0.58, bipolar: 0, depth: 1, offset: 0 }),
      node("uniform-b", "sample-hold", 20, 405, { rate: 1.13, seed: 57037, slew: 0.64, bipolar: 0, depth: 1, offset: 0 }),
      node("focus", spec.id, 280, 260, { deviation: 0.72, correlation: 0.28, clip: 2.5, level: 1 }),
      node("source", "oscillator", 535, 80, { frequency: 98, waveform: 1, level: 0.46 }),
      node("pan", "pan", 745, 110, { pan: 0, depth: 0.42 }), comboOutput(0.58),
    ], [
      edge("uniform-a-focus", "uniform-a", "out", "focus", "u1"),
      edge("uniform-b-focus", "uniform-b", "out", "focus", "u2"),
      edge("gaussian-pitch", "focus", "x", "source", "pitch"),
      edge("source-pan", "source", "out", "pan", "signal"),
      edge("gaussian-pan", "focus", "y", "pan", "position"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "pitch-gate") {
    const pitch = spec.outputs.find(({ id }) => id === "pitch")?.id ?? spec.outputs[0]?.id;
    const gate = spec.outputs.find(({ id }) => id === "gate")?.id ?? spec.outputs[1]?.id;
    route = `${spec.name} → Oscillator + VCA → Pan → Output`;
    const rootControl = spec.id === "cellular-automaton-score"
      ? [node("root", "constant", 20, 405, { amount: 0 })]
      : [];
    patch = comboGraph(comboId, name, [
      node("focus", spec.id, 20, 245),
      ...rootControl,
      node("source", "oscillator", 260, 70, { frequency: 82.41, waveform: 2, level: 0.48 }),
      node("amp", "vca", 500, 115, { base: 0, depth: 1, drive: 1.2 }),
      node("pan", "pan", 735, 115, { pan: 0, depth: 0 }), comboOutput(0.62),
    ], [
      ...(spec.id === "cellular-automaton-score"
        ? [edge("root-focus", "root", "out", "focus", "root")]
        : []),
      edge("pitch-source", "focus", pitch, "source", "pitch"),
      edge("source-amp", "source", "out", "amp", "signal"),
      edge("gate-amp", "focus", gate, "amp", "cv"),
      edge("amp-pan", "amp", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "coordinate") {
    const generator = spec.id === "phase-plane";
    route = generator
      ? `${spec.name} X/Y → Oscillator phase + pan → Output`
      : `Phase Plane → ${spec.name} X/Y → Oscillator phase + pan → Output`;
    const coordinateNodes = generator
      ? [
        node("motion", "lfo", 20, 255, { rate: 0.08, shape: 0, depth: 0.72, offset: 0 }),
        node("focus", spec.id, 250, 205),
      ]
      : [
        node("motion", "phase-plane", 20, 245, { rate: 0.29, ratio: 1.5, phase: 0.25, phaseDepth: 0 }),
        ...(spec.inputs[2] ? [node("transform", "lfo", 20, 405, { rate: 0.071, shape: 0, depth: 0.58, offset: 0 })] : []),
        node("focus", spec.id, 250, 205),
      ];
    const coordinateConnections = generator
      ? [edge("motion-phase", "motion", "out", "focus", "phase")]
      : [
        edge("motion-x", "motion", "x", "focus", spec.inputs[0].id),
        edge("motion-y", "motion", "y", "focus", spec.inputs[1].id),
        ...(spec.inputs[2] ? [edge("transform-focus", "transform", "out", "focus", spec.inputs[2].id)] : []),
      ];
    patch = comboGraph(comboId, name, [
      ...coordinateNodes,
      node("source", "oscillator", 510, 70, { frequency: 82.41, waveform: 1, level: 0.46, pmDepth: 3.1 }),
      node("pan", "pan", 735, 105, { pan: 0, depth: 0.85 }), comboOutput(0.58),
    ], [
      ...coordinateConnections,
      edge("coordinate-phase", "focus", "x", "source", "pm"),
      edge("source-pan", "source", "out", "pan", "signal"),
      edge("coordinate-pan", "focus", "y", "pan", "position"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "field-gate") {
    route = `Phase Plane → ${spec.name} → Oscillator + VCA → Pan → Output`;
    patch = comboGraph(comboId, name, [
      node("motion", "phase-plane", 20, 245, { rate: 0.37, ratio: 1.5, phase: 0.25, phaseDepth: 0 }),
      ...(spec.inputs[2] ? [node("field-motion", "lfo", 20, 405, { rate: 0.083, shape: 0, depth: 0.54, offset: 0 })] : []),
      node("focus", spec.id, 250, 245),
      node("source", "oscillator", 250, 55, { frequency: 82.41, waveform: 2, level: 0.46, pmDepth: 2.4 }),
      node("amp", "vca", 500, 95, { base: 0, depth: 1, drive: 1.15 }),
      node("pan", "pan", 725, 105, { pan: 0, depth: 0 }), comboOutput(0.58),
    ], [
      edge("motion-x", "motion", "x", "focus", "x"),
      edge("motion-y", "motion", "y", "focus", "y"),
      ...(spec.inputs[2] ? [edge("field-motion-focus", "field-motion", "out", "focus", spec.inputs[2].id)] : []),
      edge("field-phase", "focus", "field", "source", "pm"),
      edge("source-amp", "source", "out", "amp", "signal"),
      edge("gate-amp", "focus", "gate", "amp", "cv"),
      edge("amp-pan", "amp", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "sdf-logic") {
    route = `Phase Plane → 2× SDF Pattern → ${spec.name} → Oscillator + VCA → Pan → Output`;
    patch = comboGraph(comboId, name, [
      node("motion", "phase-plane", 20, 245, { rate: 0.29, ratio: 1.5, phase: 0.25, phaseDepth: 0 }),
      node("shape-a", "sdf-pattern-field", 220, 60, { shape: 0, size: 0.44, repeatX: 2, repeatY: 3, rotation: 0.03, band: 0.02 }),
      node("shape-b", "sdf-pattern-field", 220, 280, { shape: 1, size: 0.34, repeatX: 3, repeatY: 2, rotation: 0.125, band: 0.02 }),
      node("focus", spec.id, 450, 205, { operation: 0, smoothing: 0.08, width: 0.055, morph: 0.18 }),
      node("source", "oscillator", 450, 25, { frequency: 73.42, waveform: 2, level: 0.46, pmDepth: 3.8 }),
      node("amp", "vca", 675, 80, { base: 0, depth: 1, drive: 1.15 }),
      node("pan", "pan", 860, 95, { pan: 0, depth: 0 }), comboOutput(0.57),
    ], [
      edge("motion-x-a", "motion", "x", "shape-a", "x"),
      edge("motion-y-a", "motion", "y", "shape-a", "y"),
      edge("motion-x-b", "motion", "x", "shape-b", "x"),
      edge("motion-y-b", "motion", "y", "shape-b", "y"),
      edge("shape-a-logic", "shape-a", "field", "focus", "a"),
      edge("shape-b-logic", "shape-b", "field", "focus", "b"),
      edge("motion-morph", "motion", "y", "focus", "morph"),
      edge("logic-phase", "focus", "field", "source", "pm"),
      edge("source-amp", "source", "out", "amp", "signal"),
      edge("logic-gate", "focus", "gate", "amp", "cv"),
      edge("amp-pan", "amp", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "gate") {
    route = `${spec.name} + Oscillator → VCA → Pan → Output`;
    patch = comboGraph(comboId, name, [
      node("focus", spec.id, 20, 250),
      node("source", "oscillator", 20, 65, { frequency: 98, waveform: 2, level: 0.46 }),
      node("amp", "vca", 390, 115, { base: 0, depth: 1, drive: 1.25 }),
      node("pan", "pan", 675, 115, { pan: 0.1, depth: 0 }), comboOutput(0.62),
    ], [
      edge("source-amp", "source", "out", "amp", "signal"),
      edge("focus-amp", "focus", spec.outputs[0].id, "amp", "cv"),
      edge("amp-pan", "amp", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "control") {
    route = `LFO → ${spec.name} → Oscillator → Pan → Output`;
    patch = comboGraph(comboId, name, [
      node("motion", "lfo", 20, 245, { rate: 0.18, shape: 0, depth: 0.75, offset: 0 }),
      node("focus", spec.id, 280, 245),
      node("source", "oscillator", 280, 65, { frequency: 98, waveform: 2, level: 0.46 }),
      node("pan", "pan", 675, 115, { pan: 0.1, depth: 0 }), comboOutput(0.62),
    ], [
      edge("motion-focus", "motion", "out", "focus", focusInput),
      edge("focus-source", "focus", focusOutput, "source", "pitch"),
      edge("source-pan", "source", "out", "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "history") {
    route = `Oscillator → ${spec.name} → Output`;
    patch = comboGraph(comboId, name, [
      node("source", "oscillator", 25, 100, { frequency: 92.5, waveform: 2, level: 0.42 }),
      node("focus", spec.id, 410, 100), comboOutput(0.62),
    ], [
      edge("source-focus", "source", "out", "focus", focusInput),
      edge("focus-out", "focus", focusOutput, "out", "signal"),
    ]);
  } else if (SOURCE_AUDITION_CONTROL_INPUT[spec.id]) {
    const controlInput = SOURCE_AUDITION_CONTROL_INPUT[spec.id];
    route = `LFO → ${spec.name} → Stereo trim → Output`;
    patch = comboGraph(comboId, name, [
      node("motion", "lfo", 20, 245, { rate: 0.16, shape: 0, depth: 0.82, offset: 0 }),
      node("focus", spec.id, 280, 90),
      node("stereo", "mid-side-width", 590, 105, { width: 1, mid: 1, side: 1, rotation: 0, mix: 1, level: 1 }),
      comboOutput(0.6),
    ], [
      edge("motion-focus", "motion", "out", "focus", controlInput),
      edge("focus-stereo", "focus", focusOutput, "stereo", "signal"),
      edge("stereo-out", "stereo", "out", "out", "signal"),
    ]);
  } else if (spec.id === "harmonic-exciter") {
    route = `Oscillator + LFO → ${spec.name} → Pan → Output`;
    patch = comboGraph(comboId, name, [
      node("source", "oscillator", 20, 70, { frequency: 110, waveform: 1, level: 0.52 }),
      node("motion", "lfo", 20, 260, { rate: 0.19, shape: 0, depth: 0.72, offset: 0 }),
      node("focus", spec.id, 350, 105, { cvDepth: 1.1 }),
      node("pan", "pan", 690, 115, { pan: 0, depth: 0 }), comboOutput(0.6),
    ], [
      edge("source-focus", "source", "out", "focus", "signal"),
      edge("motion-focus", "motion", "out", "focus", "drive"),
      edge("focus-pan", "focus", focusOutput, "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (spec.id === "morph-crossfade") {
    route = `Oscillator + Supersaw + LFO → ${spec.name} → Stereo trim → Output`;
    patch = comboGraph(comboId, name, [
      node("source-a", "oscillator", 20, 35, { frequency: 82.41, waveform: 1, level: 0.48 }),
      node("source-b", "supersaw", 20, 165, { frequency: 123.47, voices: 5, detune: 16, width: 0.72, level: 0.42 }),
      node("motion", "lfo", 20, 305, { rate: 0.11, shape: 0, depth: 0.9, offset: 0 }),
      node("focus", spec.id, 375, 110, { morph: 0.5, cvDepth: 0.44 }),
      node("stereo", "mid-side-width", 690, 115, { width: 1, mid: 1, side: 1, rotation: 0, mix: 1, level: 1 }),
      comboOutput(0.56),
    ], [
      edge("source-a-focus", "source-a", "out", "focus", "a"),
      edge("source-b-focus", "source-b", "out", "focus", "b"),
      edge("motion-focus", "motion", "out", "focus", "morph"),
      edge("focus-stereo", "focus", focusOutput, "stereo", "signal"),
      edge("stereo-out", "stereo", "out", "out", "signal"),
    ]);
  } else if (spec.auditionKind === "effect") {
    const audition = EFFECT_AUDITION_OVERRIDES[spec.id] ?? {
      source: "oscillator",
      sourceLabel: "Oscillator",
      sourceParams: { frequency: 110, waveform: 1, level: 0.52 },
      focusParams: {},
    };
    route = `${audition.sourceLabel} → ${spec.name} → Pan → Output`;
    patch = comboGraph(comboId, name, [
      node("source", audition.source, 25, 100, audition.sourceParams),
      node("focus", spec.id, 345, 100, audition.focusParams),
      node("pan", "pan", 690, 115, { pan: 0, depth: 0 }), comboOutput(0.6),
    ], [
      edge("source-focus", "source", "out", "focus", focusInput),
      edge("focus-pan", "focus", focusOutput, "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  } else if (focusOutputSpec?.type === "stereo") {
    route = `${spec.name} → Stereo trim → Output`;
    patch = comboGraph(comboId, name, [
      node("focus", spec.id, 25, 100),
      node("stereo", "mid-side-width", 520, 115, { width: 1, mid: 1, side: 1, rotation: 0, mix: 1, level: 1 }),
      comboOutput(0.6),
    ], [
      edge("focus-stereo", "focus", focusOutput, "stereo", "signal"),
      edge("stereo-out", "stereo", "out", "out", "signal"),
    ]);
  } else {
    route = `${spec.name} → Pan → Output`;
    patch = comboGraph(comboId, name, [
      node("focus", spec.id, 25, 100),
      node("pan", "pan", 520, 115, { pan: 0, depth: 0 }), comboOutput(0.6),
    ], [
      edge("focus-pan", "focus", focusOutput, "pan", "signal"),
      edge("pan-out", "pan", "out", "out", "signal"),
    ]);
  }

  return moduleCombo(
    sequence,
    slug,
    name,
    `${spec.description} This compact graph is tuned to reveal the module from its Hear button; sparse event fields begin when their first geometric crossing arrives.`,
    spec.category,
    route,
    patch,
  );
}

const MODULE_AUDITION_COMBOS = SHADER_PLAYGROUND_MODULES
  .filter((spec) => spec.auditionKind)
  .map((spec, index) => buildModuleAudition(spec, 141 + index));

/**
 * The original 120 deterministic graphs remain as variations and compact
 * primitive auditions. Authored scenes add different clocks, fan-out,
 * multi-input operators, pitch/gate routing, and ordered GPU-history effects.
 */
export const SHADER_PLAYGROUND_COMBOS = freeze([
  ...GENERATED_COMBOS,
  ...MODULE_COMBOS,
  ...MODULE_AUDITION_COMBOS,
  ...SHADER_PLAYGROUND_SCENES,
]);

const COMBO_BY_ID = new Map(SHADER_PLAYGROUND_COMBOS.map((entry) => [entry.id, entry]));

export function createShaderPlaygroundCombo(comboId = SHADER_PLAYGROUND_COMBOS[0].id) {
  const combo = COMBO_BY_ID.get(comboId) ?? SHADER_PLAYGROUND_COMBOS[0];
  return sanitizeShaderPlaygroundPatch(clone(combo.patch));
}

const PRESET_BY_ID = new Map(SHADER_PLAYGROUND_PRESETS.map((entry) => [entry.id, entry]));

function sanitizeNode(candidate, index) {
  const spec = MODULE_BY_ID.get(String(candidate?.type ?? ""));
  if (!spec) return null;
  const params = {};
  for (const descriptor of spec.params) {
    const value = clamp(finiteOr(candidate?.params?.[descriptor.id], descriptor.default), descriptor.min, descriptor.max);
    params[descriptor.id] = descriptor.step >= 1 ? Math.round(value) : value;
  }
  const node = {
    id: String(candidate?.id ?? `${spec.id}-${index + 1}`).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || `${spec.id}-${index + 1}`,
    type: spec.id,
    x: clamp(finiteOr(candidate?.x, 30 + index * 28), 0, 4096),
    y: clamp(finiteOr(candidate?.y, 40 + index * 24), 0, 4096),
    params,
  };
  // Stateful nodes retain a real graph-level bypass flag. Keeping this
  // outside p0/p1 avoids spending one of the eight audible parameter slots.
  // Missing flags remain enabled so every existing patch keeps its behavior.
  if (spec.stateful) node.enabled = candidate?.enabled !== false;
  return node;
}

export function sanitizeShaderPlaygroundPatch(candidate = {}) {
  const nodes = (Array.isArray(candidate?.nodes) ? candidate.nodes : [])
    .slice(0, MAX_NODES)
    .map(sanitizeNode)
    .filter(Boolean);
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const targetKeys = new Set();
  const connections = [];
  for (const [index, candidateEdge] of (Array.isArray(candidate?.connections) ? candidate.connections : []).slice(0, MAX_CONNECTIONS).entries()) {
    const fromNode = String(candidateEdge?.from?.node ?? "");
    const toNode = String(candidateEdge?.to?.node ?? "");
    const fromPort = String(candidateEdge?.from?.port ?? "");
    const toPort = String(candidateEdge?.to?.port ?? "");
    const targetKey = `${toNode}:${toPort}`;
    if (!nodeIds.has(fromNode) || !nodeIds.has(toNode) || fromNode === toNode || targetKeys.has(targetKey)) continue;
    targetKeys.add(targetKey);
    connections.push({
      id: String(candidateEdge?.id ?? `edge-${index + 1}`).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || `edge-${index + 1}`,
      from: { node: fromNode, port: fromPort },
      to: { node: toNode, port: toPort },
    });
  }
  return {
    id: String(candidate?.id ?? "custom-patch").slice(0, 80),
    name: String(candidate?.name ?? "Custom patch").slice(0, 120),
    nodes,
    connections,
  };
}

export function createShaderPlaygroundPatch(presetId = "pm-bell") {
  const preset = PRESET_BY_ID.get(presetId) ?? SHADER_PLAYGROUND_PRESETS[0];
  return sanitizeShaderPlaygroundPatch(clone(preset.patch));
}

function portForEndpoint(patch, endpoint, direction) {
  const graphNode = patch.nodes.find(({ id }) => id === endpoint?.node);
  const spec = MODULE_BY_ID.get(graphNode?.type);
  const ports = direction === "output" ? spec?.outputs : spec?.inputs;
  return { graphNode, spec, port: ports?.find(({ id }) => id === endpoint?.port) };
}

function topologicalOrder(patch) {
  const outgoing = new Map(patch.nodes.map(({ id }) => [id, []]));
  const indegree = new Map(patch.nodes.map(({ id }) => [id, 0]));
  for (const connection of patch.connections) {
    if (!outgoing.has(connection.from.node) || !indegree.has(connection.to.node)) continue;
    outgoing.get(connection.from.node).push(connection.to.node);
    indegree.set(connection.to.node, indegree.get(connection.to.node) + 1);
  }
  const originalIndex = new Map(patch.nodes.map(({ id }, index) => [id, index]));
  const queue = patch.nodes.filter(({ id }) => indegree.get(id) === 0).map(({ id }) => id);
  queue.sort((a, b) => originalIndex.get(a) - originalIndex.get(b));
  const order = [];
  while (queue.length) {
    const current = queue.shift();
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort((a, b) => originalIndex.get(a) - originalIndex.get(b));
      }
    }
  }
  return order;
}

function historyFxTailErrors(patch) {
  const effectNodes = patch.nodes.filter((graphNode) => {
    const spec = MODULE_BY_ID.get(graphNode.type);
    return isShaderSynthPlaygroundFxKind(spec?.kind);
  });
  if (effectNodes.length === 0) return [];

  const output = patch.nodes.find(({ type }) => type === "output");
  if (!output) return [];
  const effectIds = new Set(effectNodes.map(({ id }) => id));
  const tailIds = new Set();
  let incoming = patch.connections.find((connection) => connection.to.node === output.id && connection.to.port === "signal");
  while (incoming && effectIds.has(incoming.from.node)) {
    const effectId = incoming.from.node;
    if (tailIds.has(effectId)) break;
    tailIds.add(effectId);
    incoming = patch.connections.find((connection) => connection.to.node === effectId && connection.to.port === "signal");
  }

  const errors = [];
  if (effectNodes.length > SHADER_SYNTH_PLAYGROUND_FX_LIMITS.maxChainEffects) {
    errors.push(`A history tail can contain at most ${SHADER_SYNTH_PLAYGROUND_FX_LIMITS.maxChainEffects} effects.`);
  }
  if (tailIds.size !== effectIds.size) {
    errors.push("History effects must form one connected tail directly before Output.");
  }
  for (const effectNode of effectNodes) {
    const outgoing = patch.connections.filter((connection) => connection.from.node === effectNode.id);
    if (outgoing.length !== 1 || !outgoing.every((connection) => {
      const destination = patch.nodes.find(({ id }) => id === connection.to.node);
      return connection.from.port === "out"
        && connection.to.port === "signal"
        && (destination?.type === "output" || effectIds.has(destination?.id));
    })) {
      errors.push(`${MODULE_BY_ID.get(effectNode.type)?.name ?? "History effect"} ${effectNode.id} must feed only the next history effect or Output.`);
    }
  }
  return errors;
}

function rawConnectionErrors(candidate) {
  const errors = [];
  if (candidate?.connections !== undefined && !Array.isArray(candidate.connections)) {
    return ["Patch connections must be an array."];
  }

  const rawNodes = Array.isArray(candidate?.nodes) ? candidate.nodes : [];
  const nodeById = new Map(rawNodes.map((graphNode) => [String(graphNode?.id ?? ""), graphNode]));
  const targetKeys = new Set();
  const connections = Array.isArray(candidate?.connections) ? candidate.connections : [];
  if (connections.length > MAX_CONNECTIONS) {
    errors.push(`A patch can contain at most ${MAX_CONNECTIONS} connections.`);
  }

  for (const [index, connection] of connections.entries()) {
    const connectionId = String(connection?.id ?? `connection ${index + 1}`);
    const fromNodeId = String(connection?.from?.node ?? "");
    const fromPortId = String(connection?.from?.port ?? "");
    const toNodeId = String(connection?.to?.node ?? "");
    const toPortId = String(connection?.to?.port ?? "");
    if (!fromNodeId || !fromPortId || !toNodeId || !toPortId) {
      errors.push(`Connection ${connectionId} needs a source module, source port, destination module, and destination port.`);
      continue;
    }
    if (fromNodeId === toNodeId) {
      errors.push(`Connection ${connectionId} cannot connect a module directly to itself.`);
      continue;
    }

    const sourceNode = nodeById.get(fromNodeId);
    const targetNode = nodeById.get(toNodeId);
    const sourceSpec = MODULE_BY_ID.get(String(sourceNode?.type ?? ""));
    const targetSpec = MODULE_BY_ID.get(String(targetNode?.type ?? ""));
    if (!sourceNode || !targetNode || !sourceSpec || !targetSpec) {
      errors.push(`Connection ${connectionId} references a missing module.`);
      continue;
    }
    const sourcePort = sourceSpec.outputs.find(({ id }) => id === fromPortId);
    const targetPort = targetSpec.inputs.find(({ id }) => id === toPortId);
    if (!sourcePort || !targetPort) {
      errors.push(`Connection ${connectionId} references a missing port.`);
      continue;
    }
    if (!targetPort.types.includes(sourcePort.type)) {
      errors.push(`${sourcePort.label} (${sourcePort.type}) cannot connect to ${targetPort.label} (${targetPort.types.join(" or ")}).`);
    }
    const targetKey = `${toNodeId}:${toPortId}`;
    if (targetKeys.has(targetKey)) errors.push(`Input ${targetKey} already has a connection.`);
    targetKeys.add(targetKey);
  }
  return errors;
}

export function validateShaderPlaygroundPatch(candidate = {}) {
  const patch = sanitizeShaderPlaygroundPatch(candidate);
  const errors = rawConnectionErrors(candidate);
  const nodeIds = new Set();
  for (const graphNode of patch.nodes) {
    if (nodeIds.has(graphNode.id)) errors.push(`Duplicate module id: ${graphNode.id}.`);
    nodeIds.add(graphNode.id);
  }
  const outputNodes = patch.nodes.filter(({ type }) => type === "output");
  if (outputNodes.length !== 1) errors.push("A playable patch needs exactly one Output module.");
  const targetKeys = new Set();
  const connectedInputs = new Set();
  for (const connection of patch.connections) {
    const from = portForEndpoint(patch, connection.from, "output");
    const to = portForEndpoint(patch, connection.to, "input");
    if (!from.graphNode || !to.graphNode) {
      errors.push(`Connection ${connection.id} references a missing module.`);
      continue;
    }
    if (!from.port || !to.port) {
      errors.push(`Connection ${connection.id} references a missing port.`);
      continue;
    }
    if (!to.port.types.includes(from.port.type)) {
      errors.push(`${from.port.label} (${from.port.type}) cannot connect to ${to.port.label} (${to.port.types.join(" or ")}).`);
    } else {
      connectedInputs.add(`${connection.to.node}:${connection.to.port}`);
    }
    const targetKey = `${connection.to.node}:${connection.to.port}`;
    if (targetKeys.has(targetKey)) errors.push(`Input ${targetKey} already has a connection.`);
    targetKeys.add(targetKey);
  }
  for (const graphNode of patch.nodes) {
    const spec = MODULE_BY_ID.get(graphNode.type);
    for (const input of spec?.inputs ?? []) {
      if (input.required && !connectedInputs.has(`${graphNode.id}:${input.id}`)) {
        errors.push(`${spec.name} ${graphNode.id} requires a connection to ${input.label}.`);
      }
    }
  }
  errors.push(...historyFxTailErrors(patch));
  const order = topologicalOrder(patch);
  if (order.length !== patch.nodes.length) errors.push("Feedback cables need an explicit state module; this graph contains a bare cycle.");
  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors, order, patch };
}

/**
 * Produce a compact spatial layout for the patch editor. The output module is
 * always the final item in the final row, and that row is right-aligned so the
 * terminal audio destination remains at the right edge when rows wrap.
 */
export function layoutShaderPlaygroundPatch(candidate = {}, options = {}) {
  const nodeWidth = Math.max(1, finiteOr(options.nodeWidth, SHADER_PLAYGROUND_LAYOUT_DEFAULTS.nodeWidth));
  const nodeHeight = Math.max(1, finiteOr(options.nodeHeight, SHADER_PLAYGROUND_LAYOUT_DEFAULTS.nodeHeight));
  const gapX = Math.max(0, finiteOr(options.gapX, SHADER_PLAYGROUND_LAYOUT_DEFAULTS.gapX));
  const gapY = Math.max(0, finiteOr(options.gapY, SHADER_PLAYGROUND_LAYOUT_DEFAULTS.gapY));
  const marginX = Math.max(0, finiteOr(options.marginX, SHADER_PLAYGROUND_LAYOUT_DEFAULTS.marginX));
  const marginTop = Math.max(0, finiteOr(options.marginTop, SHADER_PLAYGROUND_LAYOUT_DEFAULTS.marginTop));
  const marginBottom = Math.max(0, finiteOr(options.marginBottom, SHADER_PLAYGROUND_LAYOUT_DEFAULTS.marginBottom));
  const width = Math.max(nodeWidth + marginX * 2, finiteOr(options.width, 720));
  const height = Math.max(nodeHeight + marginTop + marginBottom, finiteOr(options.height, 480));
  const validation = validateShaderPlaygroundPatch(candidate);
  const nodes = validation.patch.nodes;
  const nodeById = new Map(nodes.map((graphNode) => [graphNode.id, graphNode]));
  const ordered = [
    ...validation.order.map((id) => nodeById.get(id)).filter((graphNode) => graphNode?.type !== "output"),
    ...validation.order.map((id) => nodeById.get(id)).filter((graphNode) => graphNode?.type === "output"),
    ...nodes.filter((graphNode) => !validation.order.includes(graphNode.id) && graphNode.type !== "output"),
    ...nodes.filter((graphNode) => !validation.order.includes(graphNode.id) && graphNode.type === "output"),
  ];
  if (!ordered.length) return [];

  const columnCount = Math.max(1, Math.floor((width - marginX * 2 + gapX) / (nodeWidth + gapX)));
  const rowCount = Math.ceil(ordered.length / columnCount);
  const naturalRowStep = nodeHeight + gapY;
  const availableRowStep = rowCount > 1
    ? (height - marginTop - nodeHeight - marginBottom) / (rowCount - 1)
    : naturalRowStep;
  const rowStep = Math.max(nodeHeight + 16, Math.min(naturalRowStep, availableRowStep));
  const fullRowCount = Math.min(columnCount, ordered.length);
  const occupiedWidth = fullRowCount * nodeWidth + Math.max(0, fullRowCount - 1) * gapX;
  const centeredOriginX = Math.max(marginX, (width - occupiedWidth) * 0.5);

  return ordered.map((graphNode, index) => {
    const row = Math.floor(index / columnCount);
    const slot = index % columnCount;
    const rowStart = row * columnCount;
    const rowNodes = ordered.slice(rowStart, rowStart + columnCount);
    const rowWidth = rowNodes.length * nodeWidth + Math.max(0, rowNodes.length - 1) * gapX;
    const rowEndsAtOutput = rowNodes.at(-1)?.type === "output";
    const rowOriginX = rowEndsAtOutput
      ? Math.max(marginX, width - marginX - rowWidth)
      : Math.max(marginX, Math.min(centeredOriginX, width - marginX - rowWidth));
    return {
      id: graphNode.id,
      x: Math.round(rowOriginX + slot * (nodeWidth + gapX)),
      y: Math.round(marginTop + row * rowStep),
    };
  });
}

export function canConnectShaderPlaygroundPorts(candidate, from, to) {
  const patch = sanitizeShaderPlaygroundPatch(candidate);
  if (from?.node === to?.node) return { valid: false, reason: "A module cannot connect directly to itself." };
  const source = portForEndpoint(patch, from, "output");
  const target = portForEndpoint(patch, to, "input");
  if (!source.port || !target.port) return { valid: false, reason: "Choose an output port and an input port." };
  if (!target.port.types.includes(source.port.type)) {
    return { valid: false, reason: `${source.port.type} cannot feed ${target.port.types.join(" or ")}.` };
  }
  if (patch.connections.some((connection) => connection.to.node === to.node && connection.to.port === to.port)) {
    return { valid: false, reason: "That input already has a cable." };
  }
  const sourceIsHistoryEffect = isShaderSynthPlaygroundFxKind(source.spec?.kind);
  const targetIsHistoryEffect = isShaderSynthPlaygroundFxKind(target.spec?.kind);
  if (sourceIsHistoryEffect && !(targetIsHistoryEffect || (target.spec?.id === "output" && to.port === "signal"))) {
    return { valid: false, reason: "History effects must feed the next history effect or Output." };
  }
  const trial = {
    ...patch,
    connections: [...patch.connections, edge("trial-edge", from.node, from.port, to.node, to.port)],
  };
  const order = topologicalOrder(trial);
  if (order.length !== trial.nodes.length) return { valid: false, reason: "Bare feedback is not allowed; use a state module when feedback support is added." };
  return { valid: true, reason: source.port.type === target.port.type ? "Compatible ports." : "Mono audio is duplicated into the stereo input." };
}

function paramVector(graphNode, spec) {
  const values = spec.params.map((descriptor) => finiteOr(graphNode.params[descriptor.id], descriptor.default));
  while (values.length < 8) values.push(0);
  return values.slice(0, 8);
}

export function encodeShaderPlaygroundPatch(candidate, previousParams = new Map()) {
  const result = validateShaderPlaygroundPatch(candidate);
  if (!result.valid) throw new Error(result.errors.join(" "));
  const patch = result.patch;
  const graphNodeById = new Map(patch.nodes.map((entry) => [entry.id, entry]));
  const orderedNodes = result.order.map((id) => graphNodeById.get(id));
  const indexById = new Map(orderedNodes.map(({ id }, index) => [id, index]));
  const data = new Float32Array(MAX_NODES * FLOATS_PER_NODE);
  const nextParams = new Map();
  for (const [index, graphNode] of orderedNodes.entries()) {
    const spec = MODULE_BY_ID.get(graphNode.type);
    const offset = index * FLOATS_PER_NODE;
    // A negative kind preserves the module identity and all cable slots while
    // marking this stateful node inactive. The graph shader passes input A
    // through without evaluating the kind, and the state engine intentionally
    // ignores negative kinds so its private allocation is released.
    data[offset] = spec.stateful && graphNode.enabled === false ? -spec.kind : spec.kind;
    for (const [inputIndex, inputPort] of spec.inputs.slice(0, 3).entries()) {
      const connection = patch.connections.find((entry) => entry.to.node === graphNode.id && entry.to.port === inputPort.id);
      if (!connection) {
        data[offset + 1 + inputIndex] = 0;
        continue;
      }
      const sourceNode = graphNodeById.get(connection.from.node);
      const sourcePort = MODULE_BY_ID.get(sourceNode?.type)?.outputs.find(({ id }) => id === connection.from.port);
      const sourceSlot = indexById.get(connection.from.node) + 1;
      // A negative slot selects the y component. This lets a packed control
      // module expose independent pitch and gate outputs without changing the
      // stereo signal representation used by audio modules.
      data[offset + 1 + inputIndex] = sourcePort?.component === "y" ? -sourceSlot : sourceSlot;
    }
    const target = paramVector(graphNode, spec);
    const previous = previousParams.get(graphNode.id) ?? target;
    data.set(previous.slice(0, 4), offset + 4);
    data.set(previous.slice(4, 8), offset + 8);
    data.set(target.slice(0, 4), offset + 12);
    data.set(target.slice(4, 8), offset + 16);
    nextParams.set(graphNode.id, target);
  }
  const outputIndex = orderedNodes.findIndex(({ type }) => type === "output");
  return { data, patch, order: result.order, nodeCount: orderedNodes.length, outputIndex, paramsByNode: nextParams };
}

export const SHADER_PLAYGROUND_SHADER = /* wgsl */ `
override SAMPLE_RATE: f32 = 44100.0;
override WORKGROUP_SIZE: u32 = 256u;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const PARAMETER_TRANSITION_SECONDS: f32 = 0.035;
const MAX_GRAPH_NODES: u32 = 16u;
const MAJOR_SCALE: array<f32, 7> = array<f32, 7>(0.0, 2.0, 4.0, 5.0, 7.0, 9.0, 11.0);
const MINOR_SCALE: array<f32, 7> = array<f32, 7>(0.0, 2.0, 3.0, 5.0, 7.0, 8.0, 10.0);
const PENTATONIC_SCALE: array<f32, 5> = array<f32, 5>(0.0, 3.0, 5.0, 7.0, 10.0);
const WHOLE_TONE_SCALE: array<f32, 6> = array<f32, 6>(0.0, 2.0, 4.0, 6.0, 8.0, 10.0);
const OCTATONIC_SCALE: array<f32, 8> = array<f32, 8>(0.0, 2.0, 3.0, 5.0, 6.0, 8.0, 9.0, 11.0);

struct RenderInfo {
  baseSample: u32,
  nodeCount: u32,
  outputIndex: u32,
  sampleCount: u32,
  rampActive: u32,
  performancePitch: f32,
  organRampActive: u32,
  stateActive: u32,
}

struct GraphNode {
  header: vec4<f32>,
  previous0: vec4<f32>,
  previous1: vec4<f32>,
  target0: vec4<f32>,
  target1: vec4<f32>,
}

@group(0) @binding(0) var<uniform> render_info: RenderInfo;
@group(0) @binding(1) var<storage, read> graph_nodes: array<GraphNode>;
@group(0) @binding(2) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> organ_rank: array<vec4<f32>>;
// Conditional node×sample scratch is bound only while a stateful node is
// active. Otherwise two distinct tiny placeholders satisfy the layout, and
// the stateActive branch prevents either array from being accessed.
@group(0) @binding(4) var<storage, read_write> graph_signals: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> state_output: array<vec2<f32>>;

fn hashU32(value: u32) -> f32 {
  var word = value;
  word = word ^ (word >> 16u);
  word = word * 0x7feb352du;
  word = word ^ (word >> 15u);
  word = word * 0x846ca68bu;
  word = word ^ (word >> 16u);
  return f32(word) * 2.3283064365386963e-10;
}

fn softClip(value: vec2<f32>) -> vec2<f32> {
  return value / (vec2<f32>(1.0) + abs(value));
}

fn polyBlep(phase: f32, increment: f32) -> f32 {
  let width = clamp(abs(increment), 0.000001, 0.5);
  if (phase < width) {
    let x = phase / width;
    return x + x - x * x - 1.0;
  }
  if (phase > 1.0 - width) {
    let x = (phase - 1.0) / width;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

fn readInput(values: ptr<function, array<vec2<f32>, 16>>, encoded: f32) -> vec2<f32> {
  let slot = u32(max(round(abs(encoded)), 0.0));
  if (slot == 0u || slot > MAX_GRAPH_NODES) { return vec2<f32>(0.0); }
  let value = (*values)[slot - 1u];
  if (encoded < 0.0) { return vec2<f32>(value.y); }
  return value;
}

fn phaseAtSample(sampleIndex: u32, rate: f32) -> f32 {
  var digits = sampleIndex;
  var scale = max(rate, 0.0) / SAMPLE_RATE;
  var phase = 0.0;
  for (var digit = 0u; digit < 4u; digit += 1u) {
    phase = fract(phase + f32(digits & 255u) * scale);
    digits = digits >> 8u;
    scale = fract(scale * 256.0);
  }
  return phase;
}

fn smootherstep01(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

fn arpScaleSize(scale: u32) -> u32 {
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

fn arpScalePitch(degree: u32, scale: u32) -> f32 {
  let count = arpScaleSize(scale);
  let octave = degree / count;
  let index = degree % count;
  var tone = f32(index);
  switch scale {
    case 1u: { tone = MAJOR_SCALE[index]; }
    case 2u: { tone = MINOR_SCALE[index]; }
    case 3u: { tone = PENTATONIC_SCALE[index]; }
    case 4u: { tone = WHOLE_TONE_SCALE[index]; }
    case 5u: { tone = OCTATONIC_SCALE[index]; }
    case 6u: { tone = f32(index) * 0.5; }
    default: { tone = f32(index); }
  }
  return f32(octave) * 12.0 + tone;
}

fn arpSpanDegree(position: u32, positionCount: u32, noteCount: u32) -> u32 {
  let safePositions = max(positionCount, 1u);
  let safeNotes = max(noteCount, 1u);
  if (safePositions <= 1u || safeNotes <= 1u) { return 0u; }
  let boundedPosition = min(position, safePositions - 1u);
  return min(
    safeNotes - 1u,
    (boundedPosition * (safeNotes - 1u) + (safePositions - 1u) / 2u) / (safePositions - 1u)
  );
}

fn arpDegree(absoluteStep: u32, length: u32, pattern: u32, noteCount: u32, seed: u32) -> u32 {
  let position = absoluteStep % max(length, 1u);
  switch pattern {
    case 1u: { return arpSpanDegree(length - 1u - position, length, noteCount); }
    case 2u: {
      let period = max(length * 2u - 2u, 1u);
      let folded = absoluteStep % period;
      return arpSpanDegree(select(folded, period - folded, folded >= length), length, noteCount);
    }
    case 3u: { return u32(floor(hashU32(absoluteStep + seed) * f32(noteCount))) % noteCount; }
    case 4u: { return (position * 5u + (absoluteStep / max(length, 1u)) * 3u + seed % 5u) % noteCount; }
    case 5u: { return ((position ^ (position >> 1u)) + seed % max(noteCount, 1u)) % noteCount; }
    default: { return arpSpanDegree(position, length, noteCount); }
  }
}

fn swingPhase(sampleIndex: u32, rate: f32, swing: f32) -> f32 {
  let pairPosition = phaseAtSample(sampleIndex, max(rate, 0.001) * 0.5) * 2.0;
  let boundary = 1.0 + clamp(swing, 0.0, 0.42);
  if (pairPosition < boundary) { return pairPosition / boundary; }
  return (pairPosition - boundary) / max(2.0 - boundary, 0.001);
}

fn lfoWave(phase: f32, shape: u32) -> f32 {
  if (shape == 1u) { return 1.0 - 4.0 * abs(phase - 0.5); }
  if (shape == 2u) { return select(-1.0, 1.0, phase < 0.5); }
  if (shape == 3u) { return phase * 2.0 - 1.0; }
  return sin(TAU * phase);
}

fn oscillatorWave(phase: f32, increment: f32, shape: u32, duty: f32) -> f32 {
  if (shape == 1u) { return 1.0 - 4.0 * abs(phase - 0.5); }
  if (shape == 2u) { return phase * 2.0 - 1.0 - polyBlep(phase, increment); }
  if (shape == 3u) {
    var pulse = select(-1.0, 1.0, phase < clamp(duty, 0.05, 0.95));
    pulse += polyBlep(phase, increment);
    pulse -= polyBlep(fract(phase - duty), increment);
    return pulse;
  }
  return sin(TAU * phase);
}

fn vowelFormants(scan: f32) -> vec3<f32> {
  let position = clamp(scan, 0.0, 1.0) * 4.0;
  let segment = u32(min(floor(position), 3.0));
  let amount = position - f32(segment);
  var lower = vec3<f32>(800.0, 1150.0, 2900.0);
  var upper = vec3<f32>(400.0, 1700.0, 2600.0);
  if (segment == 1u) {
    lower = vec3<f32>(400.0, 1700.0, 2600.0);
    upper = vec3<f32>(350.0, 2000.0, 2800.0);
  } else if (segment == 2u) {
    lower = vec3<f32>(350.0, 2000.0, 2800.0);
    upper = vec3<f32>(450.0, 800.0, 2830.0);
  } else if (segment == 3u) {
    lower = vec3<f32>(450.0, 800.0, 2830.0);
    upper = vec3<f32>(325.0, 700.0, 2530.0);
  }
  return mix(lower, upper, amount);
}

fn bytebeatWord(timeValue: u32, formula: u32, variation: u32) -> u32 {
  let t = timeValue;
  switch formula {
    case 0u: { return t * ((t >> 5u) | (t >> 8u)) + variation; }
    case 1u: { return (t * (((t >> 9u) | (t >> 13u)) & (25u + (variation & 7u)))) & (t >> 6u); }
    case 2u: { return t * ((t >> 11u) & (t >> 8u) & (123u + variation) & (t >> 3u)); }
    case 3u: { return (t * ((t >> 5u) | (t >> 8u))) >> ((t >> 16u) & 7u); }
    case 4u: { return t * ((42u + (variation & 31u)) & (t >> 10u)); }
    default: { return (t ^ (t >> (3u + (variation & 3u)))) + ((t >> 7u) * (variation | 1u)); }
  }
}

fn chebyshevSeries(value: vec2<f32>, order: u32, tilt: f32) -> vec2<f32> {
  var previous = vec2<f32>(1.0);
  var current = value;
  var sum = current;
  var weight = 1.0;
  for (var degree = 2u; degree <= 8u; degree += 1u) {
    if (degree > order) { break; }
    let next = 2.0 * value * current - previous;
    let amplitude = 1.0 / pow(f32(degree), max(tilt, 0.01));
    sum += next * amplitude;
    weight += amplitude;
    previous = current;
    current = next;
  }
  return sum / max(weight, 1.0);
}

${SHADER_SYNTH_PLAYGROUND_EXTRA_HELPERS}
${SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS}
${SHADER_SYNTH_PLAYGROUND_FOUND_HELPERS}
${SHADER_SYNTH_PLAYGROUND_ATLAS_HELPERS}
${SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_HELPERS}

fn evaluateNode(
  kind: u32,
  inputA: vec2<f32>,
  inputB: vec2<f32>,
  inputC: vec2<f32>,
  p0: vec4<f32>,
  p1: vec4<f32>,
  sampleIndex: u32,
  organRankOffset: u32,
  stateValue: vec2<f32>
) -> vec2<f32> {
  var result = vec2<f32>(0.0);
  switch kind {
    case 1u: { result = vec2<f32>(p0.x); }
    case 2u: { result = vec2<f32>(swingPhase(sampleIndex, p0.x, p0.y)); }
    case 3u: {
      let cv = lfoWave(phaseAtSample(sampleIndex, max(p0.x, 0.001)), u32(round(p0.y))) * p0.z + p0.w;
      result = vec2<f32>(clamp(cv, -1.0, 1.0));
    }
    case 4u: {
      let phase = fract(inputA.x);
      let attack = smoothstep(0.0, max(p0.x, 0.0001), phase);
      let tail = exp(-phase / max(p0.y, 0.0001));
      // A repeating analytic envelope must meet zero at both ends of its
      // period. Without this short release, the exponential tail jumps from a
      // nonzero value to zero when phase wraps and produces a clock-rate click.
      let release = 1.0 - smoothstep(0.985, 1.0, phase);
      result = vec2<f32>(pow(clamp(attack * tail * release, 0.0, 1.0), max(p0.z, 0.01)) * p0.w);
    }
    case 5u: {
      let hz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.45);
      let increment = hz / SAMPLE_RATE;
      let phase = fract(phaseAtSample(sampleIndex, hz) + inputA.x * p1.x / TAU);
      let value = oscillatorWave(phase, increment, u32(round(p0.y)), p0.z) * p0.w;
      result = vec2<f32>(value);
    }
    case 6u: {
      let rate = clamp(p0.x * exp2(render_info.performancePitch / 12.0), 1.0, SAMPLE_RATE);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let cell = sampleIndex / periodSamples;
      let cellPhase = f32(sampleIndex % periodSamples) / f32(periodSamples);
      let blend = smoothstep(0.0, 1.0, cellPhase);
      let seed = u32(round(abs(p0.z)));
      let a = hashU32(cell + seed) * 2.0 - 1.0;
      let b = hashU32(cell + seed + 1u) * 2.0 - 1.0;
      let white = hashU32(sampleIndex + seed * 1664525u) * 2.0 - 1.0;
      result = vec2<f32>(mix(white, mix(a, b, blend), p0.y) * p0.w);
    }
    case 7u: {
      let hz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.4);
      let index = max(0.0, p0.z + inputA.x * p1.x);
      let modulator = sin(TAU * phaseAtSample(sampleIndex, hz * p0.y));
      result = vec2<f32>(sin(TAU * phaseAtSample(sampleIndex, hz) + modulator * index) * p0.w);
    }
    case 8u: {
      let hz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.45);
      let partialCount = u32(clamp(round(p0.y), 1.0, 32.0));
      var sum = 0.0;
      var weight = 0.0;
      for (var partial = 1u; partial <= 32u; partial += 1u) {
        if (partial > partialCount) { break; }
        let ratio = pow(f32(partial), p0.w);
        let partialHz = hz * ratio;
        let nyquistFade = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, partialHz);
        let amplitude = nyquistFade / pow(f32(partial), max(p0.z - inputA.x * 0.25, 0.15));
        sum += sin(TAU * phaseAtSample(sampleIndex, partialHz)) * amplitude;
        weight += amplitude * amplitude;
      }
      result = vec2<f32>(sum / max(sqrt(weight), 1.0) * p1.x);
    }
    case 9u: {
      let gain = mix(p0.x, clamp(inputB.x, 0.0, 1.0), clamp(p0.y, 0.0, 1.0));
      result = softClip(inputA * gain * max(p0.z, 1.0));
    }
    case 10u: { result = mix(inputA, inputA * inputB, clamp(p0.x, 0.0, 1.0)) * p0.y; }
    case 11u: {
      let balance = clamp(p0.x * 0.5 + 0.5, 0.0, 1.0);
      result = (inputA * cos(balance * PI * 0.5) + inputB * sin(balance * PI * 0.5)) * p0.y;
    }
    case 34u: {
      let weighted = inputA * p0.x + inputB * p0.y + inputC * p0.z;
      let compensation = inverseSqrt(max(p0.x * p0.x + p0.y * p0.y + p0.z * p0.z, 1.0));
      result = softClip(weighted * compensation * p0.w);
    }
    case 35u: {
      let parallel = (inputA + inputB + inputC) * 0.3333333;
      let multiplied = softClip(inputA * inputB * inputC * max(p0.y, 0.5) * 4.0);
      result = mix(parallel, multiplied, clamp(p0.x, 0.0, 1.0)) * p0.z;
    }
    ${SHADER_SYNTH_PLAYGROUND_EXTRA_CASES}
    ${SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES}
    ${SHADER_SYNTH_PLAYGROUND_FOUND_CASES}
    ${SHADER_SYNTH_PLAYGROUND_ATLAS_CASES}
    ${SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_CASES}
    ${SHADER_SYNTH_PLAYGROUND_STATEFUL_CASES}
    case 12u: {
      let driven = (inputA + vec2<f32>(p0.w)) * max(p0.x, 1.0);
      let shaped = mix(softClip(driven), sin(driven * PI), clamp(p0.y, 0.0, 1.0));
      result = mix(inputA, shaped, clamp(p0.z, 0.0, 1.0));
    }
    case 13u: {
      let levels = max(2.0, pow(2.0, round(p0.x) - 1.0));
      let crushed = round(inputA * levels) / levels;
      result = mix(inputA, crushed, clamp(p0.y, 0.0, 1.0)) * p0.z;
    }
    case 14u: {
      let mono = (inputA.x + inputA.y) * 0.5;
      let pan = clamp(p0.x + inputB.x * p0.y, -1.0, 1.0);
      let angle = (pan + 1.0) * PI * 0.25;
      result = vec2<f32>(cos(angle), sin(angle)) * mono * p0.z * 1.41421356;
    }
    case 15u: {
      let shaped = softClip(inputA * max(p0.x, 1.0));
      result = mix(inputA, shaped, clamp(p0.y, 0.0, 1.0)) * p0.z;
    }
    case 16u: {
      // Output gain and ceiling are applied after the optional history chain.
      result = inputA;
    }
    case 17u: {
      let hz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.45);
      let partialCount = u32(clamp(round(p0.y), 1.0, 48.0));
      let cutoffControl = clamp(p0.z + inputA.x * p1.w * 0.5, 0.0, 1.0);
      let cutoff = 1.5 + cutoffControl * max(f32(partialCount) - 1.0, 1.0);
      var voice = vec2<f32>(0.0);
      var energy = 0.0;
      for (var partial = 1u; partial <= 48u; partial += 1u) {
        if (partial > partialCount) { break; }
        let harmonic = f32(partial);
        let partialHz = hz * harmonic;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, partialHz);
        let distance = harmonic - cutoff;
        let lowpass = exp(-max(distance, 0.0) * mix(0.42, 0.13, cutoffControl));
        let peak = exp(-distance * distance * 0.32) * p0.w * 8.0;
        let amplitude = (lowpass + peak) * bandGain / pow(harmonic, max(p1.x, 0.1));
        let phase = TAU * phaseAtSample(sampleIndex, partialHz);
        let stereoPhase = harmonic * p0.w * 0.0025;
        voice += vec2<f32>(sin(phase + stereoPhase), sin(phase - stereoPhase)) * amplitude;
        energy += amplitude * amplitude;
      }
      result = softClip(voice / max(sqrt(energy), 1.0) * max(p1.y, 0.0)) * p1.z;
    }
    case 18u: {
      let hz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.45);
      let rate = max(p0.y, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventSample = sampleIndex % periodSamples;
      let eventProgress = f32(eventSample) / f32(max(periodSamples - 1u, 1u));
      let age = f32(eventSample) / SAMPLE_RATE;
      let release = 1.0 - smoothstep(0.985, 1.0, eventProgress);
      let modeCount = u32(clamp(round(p1.x), 1.0, 32.0));
      let strikeGain = mix(1.0, clamp(inputA.x, 0.0, 1.0), clamp(p1.z, 0.0, 1.0));
      var voice = vec2<f32>(0.0);
      var energy = 0.0;
      for (var mode = 0u; mode < 32u; mode += 1u) {
        if (mode >= modeCount) { break; }
        let order = f32(mode + 1u);
        let scatter = (hashU32(mode * 7919u + 137u) - 0.5) * p0.w * 0.12;
        let ratio = max(0.25, order + order * order * 0.018 * p0.w + scatter);
        let modeHz = hz * ratio;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, modeHz);
        let damping = exp(-age * (1.0 + order * 0.13) / max(p0.z, 0.001));
        let onset = smoothstep(0.0, 0.0015 + order * 0.00016, age);
        let amplitude = damping * onset * release * bandGain / pow(order, max(p1.y, 0.1));
        let phase = age * modeHz * TAU;
        voice += vec2<f32>(sin(phase + order * 0.19), sin(phase - order * 0.23)) * amplitude;
        energy += amplitude * amplitude;
      }
      result = voice / max(sqrt(energy), 1.0) * strikeGain * p1.w;
    }
    case 19u: {
      let centerHz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.4);
      let grainRate = max(p0.y, 0.01);
      let periodSamples = max(u32(round(SAMPLE_RATE * 16.0 / grainRate)), 16u);
      let density = clamp(p0.w + inputA.x * 0.35, 0.01, 1.0);
      let seed = u32(round(abs(p1.z)));
      var voice = vec2<f32>(0.0);
      for (var grain = 0u; grain < 16u; grain += 1u) {
        let laneOffset = (periodSamples * grain) / 16u;
        let shiftedSample = sampleIndex + laneOffset;
        let cell = shiftedSample / periodSamples;
        let eventSample = shiftedSample % periodSamples;
        let eventPosition = f32(eventSample) / f32(periodSamples);
        let grainActive = hashU32(cell + seed + grain * 104729u) < density;
        let duration = clamp(p0.z * SAMPLE_RATE / f32(periodSamples), 0.001, 1.0);
        if (grainActive && eventPosition < duration) {
          let grainPosition = eventPosition / duration;
          let window = sin(PI * grainPosition);
          let pitchUnit = hashU32(cell * 31337u + seed + grain * 8191u) * 2.0 - 1.0;
          let ratio = pow(2.0, pitchUnit * p1.x / 12.0);
          let grainAge = f32(eventSample) / SAMPLE_RATE;
          let particle = sin(TAU * centerHz * ratio * grainAge) * window * window;
          let pan = (hashU32(cell * 65537u + seed + grain * 4099u) * 2.0 - 1.0) * p1.y;
          voice += vec2<f32>(particle * (1.0 - pan * 0.72), particle * (1.0 + pan * 0.72));
        }
      }
      result = voice / sqrt(max(density * 16.0, 1.0)) * p1.w;
    }
    case 20u: {
      let hz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.45);
      let scan = clamp(p0.y + inputA.x * p1.y * 0.5, 0.0, 1.0);
      let partialCount = u32(clamp(round(p0.z), 1.0, 32.0));
      var voice = vec2<f32>(0.0);
      var energy = 0.0;
      for (var partial = 1u; partial <= 32u; partial += 1u) {
        if (partial > partialCount) { break; }
        let harmonic = f32(partial);
        let partialHz = hz * harmonic;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, partialHz);
        let sineLevel = select(0.0, 1.0, partial == 1u);
        let triangleLevel = select(0.0, 1.0 / (harmonic * harmonic), (partial & 1u) == 1u);
        let sawLevel = 1.0 / harmonic;
        let tableLevel = mix(
          mix(sineLevel, triangleLevel, smoothstep(0.0, 0.52, scan)),
          sawLevel,
          smoothstep(0.48, 1.0, scan)
        );
        let amplitude = tableLevel * pow(harmonic, 1.0 - p0.w) * bandGain;
        let phase = TAU * phaseAtSample(sampleIndex, partialHz);
        let stereoPhase = harmonic * p1.x * 0.005;
        voice += vec2<f32>(sin(phase + stereoPhase), sin(phase - stereoPhase)) * amplitude;
        energy += amplitude * amplitude;
      }
      result = voice / max(sqrt(energy), 1.0) * p1.z;
    }
    case 21u: {
      let fundamental = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.4);
      let vowel = clamp(p0.y + inputA.x * p1.z * 0.5, 0.0, 1.0);
      let formants = vowelFormants(vowel);
      let partialCount = u32(clamp(round(p0.z), 3.0, 32.0));
      let bandwidth = max(p0.w, 1.0);
      var voice = vec2<f32>(0.0);
      var energy = 0.0;
      for (var partial = 1u; partial <= 32u; partial += 1u) {
        if (partial > partialCount) { break; }
        let harmonic = f32(partial);
        let partialHz = fundamental * harmonic;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, partialHz);
        let d1 = (partialHz - formants.x) / bandwidth;
        let d2 = (partialHz - formants.y) / (bandwidth * 1.35);
        let d3 = (partialHz - formants.z) / (bandwidth * 1.75);
        let envelope = 0.035 + exp(-d1 * d1) + exp(-d2 * d2) * 0.72 + exp(-d3 * d3) * 0.42;
        let amplitude = envelope * bandGain / pow(harmonic, max(p1.x, 0.1));
        let phase = TAU * phaseAtSample(sampleIndex, partialHz);
        let stereoPhase = harmonic * vowel * 0.0035;
        voice += vec2<f32>(sin(phase + stereoPhase), sin(phase - stereoPhase)) * amplitude;
        energy += amplitude * amplitude;
      }
      let breath = (hashU32(sampleIndex * 1664525u + 1013904223u) * 2.0 - 1.0) * p1.y;
      result = (voice / max(sqrt(energy), 1.0) + vec2<f32>(breath * 0.22)) * p1.w;
    }
    case 22u: {
      let rate = max(p0.x, 0.001);
      let internalPhase = phaseAtSample(sampleIndex, rate);
      let eventPhase = mix(internalPhase, fract(inputA.x), clamp(p1.z, 0.0, 1.0));
      let release = 1.0 - smoothstep(0.985, 1.0, eventPhase);
      let age = eventPhase / rate;
      let pitchTau = clamp(p0.w * 0.12, 0.006, 0.08);
      let baseHz = max(p0.y * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0);
      let phaseCycles = baseHz * age + baseHz * p0.z * pitchTau * (1.0 - exp(-age / pitchTau));
      let body = sin(TAU * phaseCycles) * exp(-age / max(p0.w, 0.001));
      let clickNoise = hashU32(sampleIndex * 747796405u + 2891336453u) * 2.0 - 1.0;
      let click = clickNoise * exp(-age / 0.0055) * p1.x * 0.42;
      result = softClip(vec2<f32>((body + click) * release * max(p1.y, 0.0))) * p1.w;
    }
    case 23u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let cell = sampleIndex / periodSamples;
      let cellPhase = f32(sampleIndex % periodSamples) / f32(periodSamples);
      let seed = u32(round(abs(p0.y)));
      let heldA = hashU32(cell + seed);
      let heldB = hashU32(cell + seed + 1u);
      var held = heldA;
      if (p0.z > 0.0001) {
        held = mix(heldA, heldB, smoothstep(1.0 - clamp(p0.z, 0.0, 1.0), 1.0, cellPhase));
      }
      let ranged = mix(held, held * 2.0 - 1.0, clamp(p0.w, 0.0, 1.0));
      result = vec2<f32>(clamp(ranged * p1.x + p1.y, -1.0, 1.0));
    }
    case 24u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let cell = sampleIndex / periodSamples;
      let stepPhase = f32(sampleIndex % periodSamples) / f32(periodSamples);
      let steps = u32(clamp(round(p0.y), 2.0, 128.0));
      let pulses = min(u32(clamp(round(p0.z), 1.0, 128.0)), steps);
      let rotation = u32(max(round(p0.w), 0.0)) % steps;
      let rotatedStep = (cell + rotation) % steps;
      let hit = ((rotatedStep * pulses) % steps) < pulses;
      var gate = select(0.0, p1.z, hit && stepPhase < clamp(p1.x, 0.02, 1.0));
      if (rotatedStep != 0u && gate > 0.0) { gate *= 1.0 - clamp(p1.y, 0.0, 1.0) * 0.55; }
      result = vec2<f32>(clamp(gate, 0.0, 1.0));
    }
    case 25u: {
      let masterHz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.4);
      let ratio = clamp(p0.y + inputA.x * p1.x, 1.0, 24.0);
      let detune = pow(2.0, p1.y / 1200.0);
      let masterPhase = phaseAtSample(sampleIndex, masterHz);
      let leftRatio = ratio / max(detune, 0.0001);
      let rightRatio = ratio * detune;
      let leftPhase = fract(masterPhase * leftRatio);
      let rightPhase = fract(masterPhase * rightRatio);
      let waveform = u32(round(p0.z));
      let left = oscillatorWave(leftPhase, masterHz * leftRatio / SAMPLE_RATE, waveform, p0.w);
      let right = oscillatorWave(rightPhase, masterHz * rightRatio / SAMPLE_RATE, waveform, p0.w);
      result = vec2<f32>(left, right) * p1.z;
    }
    case 26u: {
      let hz = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.45);
      let bend = clamp(p0.y + inputA.x * p1.x, 0.02, 0.98);
      let split = clamp(p0.z, 0.02, 0.98);
      let detune = pow(2.0, p1.y / 1200.0);
      let leftPhase = phaseAtSample(sampleIndex, hz / max(detune, 0.0001));
      let rightPhase = phaseAtSample(sampleIndex, hz * detune);
      let leftWarp = select(
        leftPhase * bend / split,
        bend + (leftPhase - split) * (1.0 - bend) / (1.0 - split),
        leftPhase >= split
      );
      let rightWarp = select(
        rightPhase * bend / split,
        bend + (rightPhase - split) * (1.0 - bend) / (1.0 - split),
        rightPhase >= split
      );
      result = vec2<f32>(sin(TAU * pow(leftWarp, p0.w)), sin(TAU * pow(rightWarp, p0.w))) * p1.z;
    }
    case 27u: {
      let clockRatio = clamp(p0.x * p0.y * exp2((inputB.x + render_info.performancePitch) / 12.0) / SAMPLE_RATE, 0.0001, 8.0);
      let integerTime = u32(floor(f32(sampleIndex & 0x00ffffffu) * clockRatio));
      let formula = u32(clamp(round(p0.z), 0.0, 5.0));
      let bits = u32(clamp(round(p0.w), 3.0, 8.0));
      let mask = (1u << bits) - 1u;
      let variation = u32(clamp(round(p1.x + inputA.x * p1.y), 0.0, 255.0));
      let leftWord = bytebeatWord(integerTime, formula, variation);
      let rightWord = bytebeatWord(integerTime + 23u + (variation & 63u), formula, variation ^ 90u);
      let scale = f32(mask);
      let left = f32(leftWord & mask) / scale * 2.0 - 1.0;
      let right = f32(rightWord & mask) / scale * 2.0 - 1.0;
      result = vec2<f32>(left, mix(left, right, clamp(p1.z, 0.0, 1.0))) * p1.w;
    }
    case 28u: {
      let order = u32(clamp(round(p0.x), 1.0, 8.0));
      let domain = clamp(inputA * p0.y + vec2<f32>(p1.x), vec2<f32>(-1.0), vec2<f32>(1.0));
      let shaped = chebyshevSeries(domain, order, p0.z);
      result = mix(inputA, shaped, clamp(p0.w, 0.0, 1.0)) * p1.y;
    }
    // Stateful/history processors execute in the ordered post-graph pass.
    // Their dry-pass behavior is transparent so the terminal FX chain has a
    // single pre-effect signal to capture in the persistent history ring.
    case 29u: { result = inputA; }
    case 30u: { result = inputA; }
    case 31u: { result = inputA; }
    case 32u: { result = inputA; }
    case 60u: { result = inputA; }
    case 61u: { result = inputA; }
    case 62u: { result = inputA; }
    case 63u: { result = inputA; }
    case 64u: { result = inputA; }
    case 65u: { result = inputA; }
    case 84u: { result = inputA; }
    case 85u: { result = inputA; }
    case 86u: { result = inputA; }
    case 87u: { result = inputA; }
    case 33u: {
      let rate = max(p0.x, 0.001);
      let pairSamples = max(u32(round(SAMPLE_RATE * 2.0 / rate)), 2u);
      let pairIndex = sampleIndex / pairSamples;
      let withinPair = sampleIndex % pairSamples;
      let swing = clamp(p1.z, 0.0, 0.42);
      let requestedFirst = u32(round(f32(pairSamples) * 0.5 * (1.0 + swing)));
      let firstSamples = min(max(requestedFirst, 1u), pairSamples - 1u);
      var localSample = withinPair;
      var stepSamples = firstSamples;
      var parity = 0u;
      if (withinPair >= firstSamples) {
        localSample = withinPair - firstSamples;
        stepSamples = pairSamples - firstSamples;
        parity = 1u;
      }
      let absoluteStep = pairIndex * 2u + parity;
      let length = u32(clamp(round(p0.y), 2.0, 128.0));
      let pattern = u32(clamp(round(p0.z), 0.0, 5.0));
      let scale = u32(clamp(round(p0.w), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.x), 1.0, 4.0));
      let noteCount = arpScaleSize(scale) * octaves;
      let seed = u32(round(abs(p1.w)));
      let currentDegree = arpDegree(absoluteStep, length, pattern, noteCount, seed);
      let nextDegree = arpDegree(absoluteStep + 1u, length, pattern, noteCount, seed);
      let phase = f32(localSample) / f32(max(stepSamples - 1u, 1u));
      let glideStart = 1.0 - clamp(p1.y, 0.0, 0.95);
      let glide = smootherstep01((phase - glideStart) / max(1.0 - glideStart, 0.0001));
      let pitch = mix(arpScalePitch(currentDegree, scale), arpScalePitch(nextDegree, scale), glide);
      let edgeSamples = min(max(u32(round(SAMPLE_RATE * 0.012)), 1u), max(stepSamples / 4u, 1u));
      let remainingSamples = stepSamples - 1u - min(localSample, stepSamples - 1u);
      let attack = smootherstep01(f32(localSample) / f32(edgeSamples));
      let release = smootherstep01(f32(remainingSamples) / f32(edgeSamples));
      result = vec2<f32>(pitch, attack * release);
    }
    default: {}
  }
  return result;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn render(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let sample = global_id.x;
  if (sample >= render_info.sampleCount || sample >= arrayLength(&sound_chunk)) { return; }
  let sampleIndex = render_info.baseSample + sample;
  let transitionActive = render_info.rampActive != 0u || render_info.organRampActive != 0u;
  var ramp = 1.0;
  if (transitionActive && render_info.sampleCount > 1u) {
    let transitionSamples = min(
      render_info.sampleCount - 1u,
      max(u32(round(SAMPLE_RATE * PARAMETER_TRANSITION_SECONDS)), 1u)
    );
    ramp = smootherstep01(f32(min(sample, transitionSamples)) / f32(transitionSamples));
  }
  let previousOrganRankOffset = select(9u, 0u, render_info.organRampActive != 0u);
  var previousValues: array<vec2<f32>, 16>;
  var targetValues: array<vec2<f32>, 16>;
  for (var clearIndex = 0u; clearIndex < MAX_GRAPH_NODES; clearIndex += 1u) {
    previousValues[clearIndex] = vec2<f32>(0.0);
    targetValues[clearIndex] = vec2<f32>(0.0);
  }

  for (var nodeIndex = 0u; nodeIndex < MAX_GRAPH_NODES; nodeIndex += 1u) {
    if (nodeIndex >= render_info.nodeCount) { break; }
    let graphNode = graph_nodes[nodeIndex];
    let bypassed = graphNode.header.x < 0.0;
    let kind = u32(round(abs(graphNode.header.x)));
    var stateValue = vec2<f32>(0.0);
    if (render_info.stateActive != 0u) {
      stateValue = state_output[nodeIndex * render_info.sampleCount + sample];
    }
    let previousInputA = readInput(&previousValues, graphNode.header.y);
    var previousResult = previousInputA;
    if (!bypassed) {
      previousResult = evaluateNode(
        kind,
        previousInputA,
        readInput(&previousValues, graphNode.header.z),
        readInput(&previousValues, graphNode.header.w),
        graphNode.previous0,
        graphNode.previous1,
        sampleIndex,
        previousOrganRankOffset,
        stateValue
      );
    }
    var targetResult = previousResult;
    if (transitionActive) {
      let targetInputA = readInput(&targetValues, graphNode.header.y);
      targetResult = targetInputA;
      if (!bypassed) {
        targetResult = evaluateNode(
          kind,
          targetInputA,
          readInput(&targetValues, graphNode.header.z),
          readInput(&targetValues, graphNode.header.w),
          graphNode.target0,
          graphNode.target1,
          sampleIndex,
          9u,
          stateValue
        );
      }
    }
    previousValues[nodeIndex] = previousResult;
    targetValues[nodeIndex] = targetResult;
    if (render_info.stateActive != 0u) {
      graph_signals[nodeIndex * render_info.sampleCount + sample] = mix(previousResult, targetResult, ramp);
    }
  }
  let outputIndex = min(render_info.outputIndex, MAX_GRAPH_NODES - 1u);
  sound_chunk[sample] = mix(previousValues[outputIndex], targetValues[outputIndex], ramp);
}`;

function gpuConstants(runtime) {
  const usage = runtime.GPUBufferUsage ?? globalThis.GPUBufferUsage;
  const mapMode = runtime.GPUMapMode ?? globalThis.GPUMapMode;
  if (!usage || !mapMode) throw new Error("WebGPU buffer constants are unavailable.");
  return { usage, mapMode };
}

export function shaderPlaygroundSupport(runtime = globalThis) {
  const audio = Boolean(runtime.AudioContext ?? runtime.webkitAudioContext);
  const webgpu = Boolean(runtime.navigator?.gpu?.requestAdapter);
  return { audio, webgpu, ready: audio && webgpu };
}

function setAudioParam(param, value, context) {
  if (!param) return;
  if (typeof param.setTargetAtTime === "function") param.setTargetAtTime(value, context?.currentTime ?? 0, 0.018);
  else param.value = value;
}

function scheduleFirstChunkFade(param, value, startTime) {
  if (!param) return;
  if (typeof param.cancelScheduledValues === "function") param.cancelScheduledValues(startTime);
  if (typeof param.setValueAtTime === "function" && typeof param.linearRampToValueAtTime === "function") {
    param.setValueAtTime(0, startTime);
    param.linearRampToValueAtTime(value, startTime + SCHEDULE_LEAD_SECONDS);
    return;
  }
  param.value = value;
}

function scheduleQueueFadeOut(param, startTime, endTime) {
  if (!param) return;
  const heldValue = Number.isFinite(Number(param.value)) ? Number(param.value) : 0;
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(startTime);
  } else {
    param.cancelScheduledValues?.(startTime);
    param.setValueAtTime?.(heldValue, startTime);
  }
  if (typeof param.linearRampToValueAtTime === "function") {
    param.linearRampToValueAtTime(0, endTime);
  } else {
    setAudioParam(param, 0, { currentTime: startTime });
  }
}

export class ShaderSynthPlaygroundAudio {
  constructor(runtime = globalThis, {
    chunkDuration = SHADER_PLAYGROUND_RUNTIME_DEFAULTS.chunkDuration,
    workgroupSize = SHADER_PLAYGROUND_RUNTIME_DEFAULTS.workgroupSize,
  } = {}) {
    this.runtime = runtime;
    this.chunkDuration = clamp(
      finiteOr(chunkDuration, SHADER_PLAYGROUND_RUNTIME_DEFAULTS.chunkDuration),
      0.03,
      0.5,
    );
    this.workgroupSize = [32, 64, 128, 256].includes(Number(workgroupSize)) ? Number(workgroupSize) : 256;
    this.context = null;
    this.input = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.historyCapturePipeline = null;
    this.historyCaptureBindGroup = null;
    this.fxPipeline = null;
    this.statefulPipeline = null;
    this.statefulEngine = null;
    this.stateGraphFallbackBuffer = null;
    this.stateOutputFallbackBuffer = null;
    this.fxBindGroups = [];
    this.fxStageInfoBuffer = null;
    this.fxStageInfoStride = 0;
    this.fxStageCount = 0;
    this.renderInfoBuffer = null;
    this.nodeBuffer = null;
    this.organRankBuffer = null;
    this.chunkBuffer = null;
    this.fxOutputBuffer = null;
    this.fxHistoryBuffer = null;
    this.fxHistoryFrames = 0;
    this.fxHistoryAllocated = false;
    this.mapBuffer = null;
    this.chunkSamples = 0;
    this.chunkBufferSize = 0;
    this.sampleRate = 44100;
    this.renderOffset = 0;
    this.renderSampleOffset = 0;
    this.nextStartTime = 0;
    this.timeoutId = null;
    this.renderingPromise = null;
    this.running = false;
    this.playbackEnabled = false;
    this.output = 0.7;
    this.patch = createShaderPlaygroundPatch();
    this.organRanks = sanitizeWebGpuSynthOrganRanks(WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS);
    this.previousOrganRanks = sanitizeWebGpuSynthOrganRanks(this.organRanks);
    this.organRankRevision = 0;
    this.pendingOrganRankRamp = false;
    this.encodedPatch = null;
    this.previousParams = new Map();
    this.patchRevision = 0;
    this.pendingRamp = false;
    this.performancePitch = 0;
    this.queueGeneration = 0;
    this.sources = new Set();
    this.sourceGains = new Map();
    this.scheduledChunks = [];
    this.pendingQueueHandoff = null;
    this.deferredQueueRefresh = false;
    this.visualTimers = new Set();
    this.onError = null;
    this.onChunk = null;
    this.onStatus = null;
  }

  setErrorHandler(handler) { this.onError = typeof handler === "function" ? handler : null; }
  setChunkHandler(handler) { this.onChunk = typeof handler === "function" ? handler : null; }
  setStatusHandler(handler) { this.onStatus = typeof handler === "function" ? handler : null; }

  reportStatus(status) {
    try {
      this.onStatus?.(status);
    } catch (error) {
      this.runtime.console?.error?.("Shader playground status callback failed.", error);
    }
  }

  async start(patch = this.patch) {
    if (this.context) await this.stop();
    const support = shaderPlaygroundSupport(this.runtime);
    if (!support.audio) throw new Error("Web Audio buffer playback is unavailable in this browser.");
    if (!support.webgpu) throw new Error("WebGPU is unavailable in this browser.");
    const validated = validateShaderPlaygroundPatch(patch);
    if (!validated.valid) throw new Error(validated.errors.join(" "));
    this.patch = validated.patch;
    this.reportStatus("preparing");
    const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    this.context = new AudioContextCtor();
    if (this.context.state === "suspended" && typeof this.context.resume === "function") await this.context.resume();
    this.sampleRate = this.context.sampleRate;
    this.input = this.context.createGain();
    this.master = this.context.createGain();
    this.input.gain.value = 1;
    // The first source may begin at a non-zero waveform sample. Hold the
    // output at zero until that source starts, then apply a short click-free
    // fade in fillBuffer().
    this.master.gain.value = 0;
    this.input.connect(this.master);
    this.releaseAudioOutput = connectAudioOutput(this.context, this.master, { runtime: this.runtime });
    await this.initGpu();
    // No prior registration is audible across a fresh start, so seed both
    // banks from the latest editor state instead of fading from stale defaults.
    this.previousOrganRanks = sanitizeWebGpuSynthOrganRanks(this.organRanks);
    this.pendingOrganRankRamp = false;
    this.writeOrganRankTransition();
    this.previousParams = new Map();
    // initGpu created fresh graph/state buffers; force this patch to upload
    // even when the same graph was used before a stop/start cycle.
    this.encodedPatch = null;
    this.updatePatch(this.patch);
    this.renderOffset = 0;
    this.renderSampleOffset = 0;
    this.nextStartTime = this.context.currentTime + 0.06;
    this.scheduledChunks = [];
    this.pendingQueueHandoff = null;
    this.deferredQueueRefresh = false;
    this.running = true;
    this.reportStatus("rendering");
    const prime = this.fillBuffer({ forceFirstChunk: true, maxChunks: 1 });
    this.renderingPromise = prime;
    try {
      await prime;
    } catch (error) {
      this.running = false;
      throw error;
    } finally {
      if (this.renderingPromise === prime) this.renderingPromise = null;
    }
    this.reportStatus("ready");
    this.queueFill();
    return this.context;
  }

  async initGpu() {
    const { usage } = gpuConstants(this.runtime);
    const adapter = await this.runtime.navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter was found.");
    this.device = await adapter.requestDevice();
    this.chunkSamples = Math.max(128, Math.round(this.sampleRate * this.chunkDuration));
    this.chunkBufferSize = this.chunkSamples * NUM_CHANNELS * Float32Array.BYTES_PER_ELEMENT;
    this.renderInfoBuffer = this.device.createBuffer({ size: RENDER_INFO_SIZE, usage: usage.UNIFORM | usage.COPY_DST });
    this.nodeBuffer = this.device.createBuffer({ size: NODE_BUFFER_SIZE, usage: usage.STORAGE | usage.COPY_DST });
    this.organRankBuffer = this.device.createBuffer({ size: ORGAN_RANK_BUFFER_SIZE, usage: usage.STORAGE | usage.COPY_DST });
    this.chunkBuffer = this.device.createBuffer({ size: this.chunkBufferSize, usage: usage.STORAGE | usage.COPY_SRC });
    this.fxOutputBuffer = this.device.createBuffer({ size: this.chunkBufferSize, usage: usage.STORAGE | usage.COPY_SRC });
    // Distinct tiny placeholders satisfy the inactive graph shader layout
    // without aliasing writable storage bindings. Large node×sample state
    // scratch remains conditional inside ShaderSynthPlaygroundStateEngine.
    this.stateGraphFallbackBuffer = this.device.createBuffer({ size: 16, usage: usage.STORAGE });
    this.stateOutputFallbackBuffer = this.device.createBuffer({ size: 16, usage: usage.STORAGE });
    this.fxHistoryFrames = 0;
    this.fxHistoryAllocated = false;
    this.fxHistoryBuffer = this.device.createBuffer({
      size: 16,
      usage: usage.STORAGE,
    });
    const stageAlignment = Math.max(16, Number(this.device.limits?.minUniformBufferOffsetAlignment) || 256);
    this.fxStageInfoStride = Math.ceil(FX_STAGE_INFO_SIZE / stageAlignment) * stageAlignment;
    this.fxStageInfoBuffer = this.device.createBuffer({
      size: this.fxStageInfoStride * SHADER_SYNTH_PLAYGROUND_FX_LIMITS.maxChainEffects,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.mapBuffer = this.device.createBuffer({ size: this.chunkBufferSize, usage: usage.MAP_READ | usage.COPY_DST });
    const module = this.device.createShaderModule({ code: SHADER_PLAYGROUND_SHADER });
    const pipelineDescriptor = {
      layout: "auto",
      compute: { module, entryPoint: "render", constants: { SAMPLE_RATE: this.sampleRate, WORKGROUP_SIZE: this.workgroupSize } },
    };
    const historyCaptureModule = this.device.createShaderModule({ code: SHADER_SYNTH_PLAYGROUND_HISTORY_CAPTURE_SHADER });
    const historyCapturePipelineDescriptor = {
      layout: "auto",
      compute: { module: historyCaptureModule, entryPoint: "captureDryHistory", constants: { WORKGROUP_SIZE: this.workgroupSize } },
    };
    const fxModule = this.device.createShaderModule({ code: SHADER_SYNTH_PLAYGROUND_FX_SHADER });
    const fxPipelineDescriptor = {
      layout: "auto",
      compute: { module: fxModule, entryPoint: "processPostGraphFx", constants: { SAMPLE_RATE: this.sampleRate, WORKGROUP_SIZE: this.workgroupSize } },
    };
    const statefulModule = this.device.createShaderModule({ code: SHADER_SYNTH_PLAYGROUND_STATEFUL_SHADER });
    const statefulPipelineDescriptor = {
      layout: "auto",
      compute: { module: statefulModule, entryPoint: "renderStateNode", constants: { SAMPLE_RATE: this.sampleRate } },
    };
    this.reportStatus("compiling");
    if (typeof this.device.createComputePipelineAsync === "function") {
      [
        this.pipeline,
        this.historyCapturePipeline,
        this.fxPipeline,
        this.statefulPipeline,
      ] = await Promise.all([
        this.device.createComputePipelineAsync(pipelineDescriptor),
        this.device.createComputePipelineAsync(historyCapturePipelineDescriptor),
        this.device.createComputePipelineAsync(fxPipelineDescriptor),
        this.device.createComputePipelineAsync(statefulPipelineDescriptor),
      ]);
    } else {
      this.pipeline = this.device.createComputePipeline(pipelineDescriptor);
      this.historyCapturePipeline = this.device.createComputePipeline(historyCapturePipelineDescriptor);
      this.fxPipeline = this.device.createComputePipeline(fxPipelineDescriptor);
      this.statefulPipeline = this.device.createComputePipeline(statefulPipelineDescriptor);
    }
    this.statefulEngine = new ShaderSynthPlaygroundStateEngine(this.device, {
      usage,
      sampleRate: this.sampleRate,
      chunkSamples: this.chunkSamples,
      maxNodes: MAX_NODES,
      renderInfoBuffer: this.renderInfoBuffer,
      nodeBuffer: this.nodeBuffer,
    }).setPipeline(this.statefulPipeline);
    this.rebuildGraphBindGroup();
    this.rebuildFxBindGroups();
  }

  rebuildFxBindGroups() {
    if (
      !this.device || !this.historyCapturePipeline || !this.fxPipeline
      || !this.renderInfoBuffer || !this.nodeBuffer || !this.chunkBuffer || !this.fxOutputBuffer
      || !this.fxHistoryBuffer || !this.fxStageInfoBuffer
    ) return;
    this.historyCaptureBindGroup = this.device.createBindGroup({
      layout: this.historyCapturePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderInfoBuffer } },
        { binding: 1, resource: { buffer: this.chunkBuffer } },
        { binding: 2, resource: { buffer: this.fxHistoryBuffer } },
      ],
    });
    const fxLayout = this.fxPipeline.getBindGroupLayout(0);
    this.fxBindGroups = Array.from(
      { length: SHADER_SYNTH_PLAYGROUND_FX_LIMITS.maxChainEffects },
      (_, stageIndex) => {
        const stageResource = {
          buffer: this.fxStageInfoBuffer,
          offset: stageIndex * this.fxStageInfoStride,
          size: FX_STAGE_INFO_SIZE,
        };
        const entries = (inputBuffer, outputBuffer) => [
          { binding: 0, resource: { buffer: this.renderInfoBuffer } },
          { binding: 1, resource: { buffer: this.nodeBuffer } },
          { binding: 2, resource: { buffer: inputBuffer } },
          { binding: 3, resource: { buffer: outputBuffer } },
          { binding: 4, resource: { buffer: this.fxHistoryBuffer } },
          { binding: 5, resource: stageResource },
        ];
        return {
          forward: this.device.createBindGroup({ layout: fxLayout, entries: entries(this.chunkBuffer, this.fxOutputBuffer) }),
          reverse: this.device.createBindGroup({ layout: fxLayout, entries: entries(this.fxOutputBuffer, this.chunkBuffer) }),
        };
      },
    );
  }

  syncFxHistoryResources(activeFxCount) {
    if (!this.device || !this.fxPipeline || !this.fxHistoryBuffer) return false;
    const needed = Number(activeFxCount) > 0;
    if (needed === this.fxHistoryAllocated && this.fxHistoryBuffer) return false;
    const { usage } = gpuConstants(this.runtime);
    let replacement;
    if (needed) {
      const byteSize = shaderSynthPlaygroundFxHistoryByteSize(this.sampleRate, this.chunkSamples);
      const limits = [
        Number(this.device.limits?.maxStorageBufferBindingSize),
        Number(this.device.limits?.maxBufferSize),
      ].filter((value) => Number.isFinite(value) && value > 0);
      const limit = limits.length ? Math.min(...limits) : Number.POSITIVE_INFINITY;
      if (byteSize > limit) {
        throw new Error(`GPU effect history needs ${byteSize} bytes, but this device allows ${limit}.`);
      }
      replacement = this.device.createBuffer({ size: byteSize, usage: usage.STORAGE });
      this.fxHistoryFrames = shaderSynthPlaygroundFxHistoryFrames(this.sampleRate, this.chunkSamples);
    } else {
      replacement = this.device.createBuffer({ size: 16, usage: usage.STORAGE });
      this.fxHistoryFrames = 0;
    }
    try { this.fxHistoryBuffer?.destroy?.(); } catch { /* optional cleanup */ }
    this.fxHistoryBuffer = replacement;
    this.fxHistoryAllocated = needed;
    this.rebuildFxBindGroups();
    return true;
  }

  rebuildGraphBindGroup() {
    if (!this.device || !this.pipeline || !this.chunkBuffer) return;
    const stateBindings = this.statefulEngine?.graphBindings(
      this.stateGraphFallbackBuffer,
      this.stateOutputFallbackBuffer,
    ) ?? {
      graphSignals: this.stateGraphFallbackBuffer,
      stateOutput: this.stateOutputFallbackBuffer,
    };
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderInfoBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } },
        { binding: 2, resource: { buffer: this.chunkBuffer } },
        { binding: 3, resource: { buffer: this.organRankBuffer } },
        { binding: 4, resource: { buffer: stateBindings.graphSignals } },
        { binding: 5, resource: { buffer: stateBindings.stateOutput } },
      ],
    });
  }

  updateOrganRanks(ranks = this.organRanks) {
    const nextRanks = sanitizeWebGpuSynthOrganRanks(ranks);
    if (organRanksEqual(nextRanks, this.organRanks)) return this.organRanks;
    this.organRanks = nextRanks;
    this.organRankRevision += 1;
    this.pendingOrganRankRamp = true;
    this.writeOrganRankTransition();
    // Match the 303 control path: keep the audible timeline intact and let
    // the next normally rendered chunk consume the latest rank bank.
    return this.organRanks;
  }

  writeOrganRankTransition() {
    if (this.device && this.organRankBuffer) {
      this.device.queue.writeBuffer(
        this.organRankBuffer,
        0,
        organRankTransitionArray(this.previousOrganRanks, this.organRanks),
      );
    }
  }

  commitOrganRankRamp(revision, renderedRanks, rampActive) {
    if (!rampActive) return;
    this.previousOrganRanks = sanitizeWebGpuSynthOrganRanks(renderedRanks);
    this.pendingOrganRankRamp = revision !== this.organRankRevision;
    this.writeOrganRankTransition();
  }

  updatePatch(patch = this.patch) {
    const encoded = encodeShaderPlaygroundPatch(patch, this.previousParams);
    const audioChanged = !encodedAudioMatches(this.encodedPatch, encoded);
    const topologyChanged = !encodedTopologyMatches(this.encodedPatch, encoded);
    this.patch = encoded.patch;
    if (!audioChanged && this.encodedPatch) {
      this.encodedPatch = { ...this.encodedPatch, patch: encoded.patch };
      return this.patch;
    }
    this.encodedPatch = encoded;
    const statefulBindingsChanged = this.statefulEngine?.sync(encoded) ?? false;
    if (statefulBindingsChanged) this.rebuildGraphBindGroup();
    const orderIndex = new Map(encoded.order.map((id, index) => [id, index]));
    const effectNodes = shaderSynthPlaygroundFxNodes(encoded);
    this.fxStageCount = effectNodes.length;
    this.syncFxHistoryResources(effectNodes.length);
    if (this.device && this.fxStageInfoBuffer && this.fxStageInfoStride > 0) {
      const stageData = new ArrayBuffer(
        this.fxStageInfoStride * SHADER_SYNTH_PLAYGROUND_FX_LIMITS.maxChainEffects,
      );
      const stageView = new DataView(stageData);
      if (effectNodes.length === 0) {
        stageView.setUint32(12, 2, true); // Finalize dry input without an active effect.
      } else {
        effectNodes.forEach((effectNode, stageIndex) => {
          const offset = stageIndex * this.fxStageInfoStride;
          stageView.setUint32(offset, orderIndex.get(effectNode.id), true);
          stageView.setUint32(offset + 4, stageIndex, true);
          stageView.setUint32(offset + 8, stageIndex + 1, true);
          stageView.setUint32(offset + 12, 1 | (stageIndex === effectNodes.length - 1 ? 2 : 0), true);
        });
      }
      this.device.queue.writeBuffer(this.fxStageInfoBuffer, 0, stageData);
    }
    this.patchRevision += 1;
    this.pendingRamp = true;
    if (this.device && this.nodeBuffer) this.device.queue.writeBuffer(this.nodeBuffer, 0, encoded.data);
    // Parameter-only edits arrive many times per pointer drag. Replacing the
    // future queue for every event caused repeated 100 ms handoffs and could
    // replay a late chunk. Keep the 303-style stable queue for knobs; reserve
    // queue replacement for an actual node/routing change.
    if (this.running && topologyChanged) this.refreshSchedule();
    return this.patch;
  }

  commitRamp(revision, renderedParams = this.encodedPatch?.paramsByNode, rampActive = this.pendingRamp) {
    if (!rampActive || !renderedParams || !this.encodedPatch) return;
    // Advance from the target that this chunk actually rendered, even when a
    // newer slider event arrived during GPU readback. The next chunk then
    // continues target A -> target B instead of restarting old -> target B.
    this.previousParams = cloneParamMap(renderedParams);
    const committed = encodeShaderPlaygroundPatch(this.patch, this.previousParams);
    this.encodedPatch = committed;
    this.pendingRamp = revision !== this.patchRevision
      && !paramMapsEqual(this.previousParams, committed.paramsByNode);
    if (this.device && this.nodeBuffer) this.device.queue.writeBuffer(this.nodeBuffer, 0, committed.data);
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, 0.7), 0, 1);
    if (!this.master || !this.context) return;
    if (this.playbackEnabled && this.scheduledChunks.length === 0) {
      this.master.gain.value = 0;
      return;
    }
    setAudioParam(this.master.gain, this.playbackEnabled ? this.output : 0, this.context);
  }

  setPlaybackEnabled(enabled) {
    this.playbackEnabled = Boolean(enabled);
    if (!this.master || !this.context) return;
    if (this.playbackEnabled && this.scheduledChunks.length === 0) {
      this.master.gain.value = 0;
      return;
    }
    setAudioParam(this.master.gain, this.playbackEnabled ? this.output : 0, this.context);
  }

  setPerformancePitch(semitones, { refresh = false } = {}) {
    const next = clamp(finiteOr(semitones, 0), -48, 48);
    const changed = Math.abs(next - this.performancePitch) > 1e-7;
    this.performancePitch = next;
    if (refresh && changed) this.refreshSchedule();
    return this.performancePitch;
  }

  refreshSchedule() {
    if (!this.running || !this.context) return false;
    // Keep any current multi-chunk fill generation alive. Continuous pointer
    // input marks one deferred refresh instead of invalidating every in-flight
    // GPU readback and starving the audible queue.
    if (this.pendingQueueHandoff || this.renderingPromise) {
      this.deferredQueueRefresh = true;
      this.queueFill();
      return true;
    }
    this.deferredQueueRefresh = false;
    const audibleGeneration = this.queueGeneration;
    this.queueGeneration += 1;
    const now = finiteOr(this.context.currentTime, 0);
    // GPU readback can take most of a chunk on slower devices. Keep every
    // already scheduled source audible while the replacement generation is
    // rendering; fillBuffer performs the handoff only after its first buffer
    // exists. This also leaves the master/play state completely untouched.
    this.pendingQueueHandoff = {
      generation: this.queueGeneration,
      sources: new Set(this.sources),
    };
    const minimumBoundary = now + Math.max(this.chunkDuration, SCHEDULE_PADDING_SECONDS);
    const replacementBoundary = this.scheduledChunks
      .filter((chunk) => (
        chunk.generation === audibleGeneration
        && Number.isFinite(chunk.offset)
        && Number.isFinite(chunk.startAt)
        && chunk.startAt >= minimumBoundary
      ))
      .sort((first, second) => first.startAt - second.startAt)[0] ?? null;
    if (replacementBoundary) {
      this.renderSampleOffset = Math.max(0, Math.round(replacementBoundary.offset * this.sampleRate));
      this.renderOffset = this.renderSampleOffset / this.sampleRate;
      this.nextStartTime = replacementBoundary.startAt;
    } else {
      this.nextStartTime = now + SCHEDULE_LEAD_SECONDS;
    }
    this.queueFill();
    return true;
  }

  connectScheduledSource(source) {
    const sourceGain = this.context?.createGain?.() ?? null;
    if (sourceGain?.gain && typeof sourceGain.connect === "function") {
      sourceGain.gain.value = 1;
      source.connect(sourceGain);
      sourceGain.connect(this.input);
      this.sourceGains.set(source, sourceGain);
      return sourceGain;
    }
    source.connect(this.input);
    return null;
  }

  handoffScheduledQueue(generation, sourceGain, startAt) {
    const handoff = this.pendingQueueHandoff;
    if (!handoff || handoff.generation !== generation) return false;
    const oldSources = [...handoff.sources].filter((source) => this.sources.has(source));
    if (oldSources.length === 0) {
      this.pendingQueueHandoff = null;
      return false;
    }
    const fadeEnd = startAt + SCHEDULE_LEAD_SECONDS;
    if (sourceGain?.gain) scheduleFirstChunkFade(sourceGain.gain, 1, startAt);
    for (const source of oldSources) {
      const oldGain = this.sourceGains.get(source);
      if (oldGain?.gain) {
        scheduleQueueFadeOut(oldGain.gain, startAt, fadeEnd);
      } else {
        // AudioBufferSourceNode always has a per-source gain in browsers that
        // support this instrument. Keep a defensive fallback for lightweight
        // test/Web Audio shims that omit createGain().
        try { source.stop?.(fadeEnd); } catch { /* source may already be ending */ }
      }
    }
    this.pendingQueueHandoff = null;
    return true;
  }

  queueFill(delay = 0) {
    if (!this.running || this.renderingPromise || this.timeoutId !== null) return;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    this.timeoutId = setTimer(() => {
      this.timeoutId = null;
      const task = this.fillBuffer().catch((error) => this.handleError(error)).finally(() => {
        if (this.renderingPromise === task) {
          this.renderingPromise = null;
          if (this.running && this.deferredQueueRefresh) {
            this.deferredQueueRefresh = false;
            this.refreshSchedule();
          } else if (this.running) {
            this.queueFill(this.chunkDuration * 220);
          }
        }
      });
      this.renderingPromise = task;
    }, Math.max(0, delay));
  }

  async fillBuffer({ forceFirstChunk = false, maxChunks = Number.POSITIVE_INFINITY } = {}) {
    if (!this.context || !this.input) return;
    const queueGeneration = this.queueGeneration;
    const horizon = this.chunkDuration * MAX_BUFFERED_CHUNKS + SCHEDULE_PADDING_SECONDS;
    const chunkLimit = Number.isFinite(Number(maxChunks))
      ? Math.max(1, Math.trunc(Number(maxChunks)))
      : Number.POSITIVE_INFINITY;
    let scheduledChunkCount = 0;
    while (
      this.running
      && queueGeneration === this.queueGeneration
      && this.context
      && scheduledChunkCount < chunkLimit
      && (
        (scheduledChunkCount === 0 && forceFirstChunk)
        || this.nextStartTime - this.context.currentTime < horizon
      )
    ) {
      const baseSample = this.renderSampleOffset;
      const offset = baseSample / this.sampleRate;
      const chunk = await this.renderChunk(baseSample);
      if (!this.running || queueGeneration !== this.queueGeneration || !this.context || !this.input) return;
      const audioBuffer = this.context.createBuffer(NUM_CHANNELS, this.chunkSamples, this.sampleRate);
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      for (let index = 0; index < this.chunkSamples; index += 1) {
        left[index] = chunk[index * 2];
        right[index] = chunk[index * 2 + 1];
      }
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;
      const sourceGain = this.connectScheduledSource(source);
      source.onended = () => {
        this.sources.delete(source);
        const endedGain = this.sourceGains.get(source);
        this.sourceGains.delete(source);
        try { endedGain?.disconnect?.(); } catch { /* optional Web Audio cleanup */ }
        this.pendingQueueHandoff?.sources.delete(source);
        this.scheduledChunks = this.scheduledChunks.filter((entry) => entry.source !== source);
      };
      this.sources.add(source);
      const queueWasEmpty = this.scheduledChunks.length === 0;
      const startAt = Math.max(this.context.currentTime + SCHEDULE_LEAD_SECONDS, this.nextStartTime);
      const endAt = startAt + audioBuffer.duration;
      this.scheduledChunks.push({
        source,
        gain: sourceGain,
        generation: queueGeneration,
        offset,
        startAt,
        endAt,
        duration: audioBuffer.duration,
      });
      const handedOff = scheduledChunkCount === 0
        && this.handoffScheduledQueue(queueGeneration, sourceGain, startAt);
      if (queueWasEmpty && this.playbackEnabled && !handedOff) {
        scheduleFirstChunkFade(this.master?.gain, this.output, startAt);
      }
      source.start(startAt);
      scheduledChunkCount += 1;
      this.nextStartTime = endAt;
      this.renderSampleOffset = baseSample + this.chunkSamples;
      this.renderOffset = this.renderSampleOffset / this.sampleRate;
      this.queueChunkVisualization(chunk, { sampleRate: this.sampleRate, offset, startAt, duration: audioBuffer.duration });
    }
  }

  currentPlaybackTime() {
    if (!this.context || !this.running) return null;
    const now = finiteOr(this.context.currentTime, 0);
    this.scheduledChunks = this.scheduledChunks.filter((chunk) => chunk.endAt >= now - 0.1);
    const current = this.scheduledChunks.find((chunk) => now >= chunk.startAt && now < chunk.endAt);
    if (current) return Math.max(0, current.offset + now - current.startAt);
    const next = this.scheduledChunks.find((chunk) => now < chunk.startAt);
    if (next) return Math.max(0, next.offset);
    const last = this.scheduledChunks.at(-1);
    if (last) return Math.max(0, last.offset + clamp(now - last.startAt, 0, last.duration));
    return Math.max(0, this.renderOffset - Math.max(0, this.nextStartTime - now));
  }

  queueChunkVisualization(chunk, metadata) {
    if (!this.onChunk || !this.context) return;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    const delay = Math.max(0, (metadata.startAt - this.context.currentTime) * 1000);
    const samples = chunk.slice();
    let timer = null;
    timer = setTimer(() => {
      this.visualTimers.delete(timer);
      if (!this.running || !this.onChunk) return;
      try {
        this.onChunk(samples, metadata);
      } catch (error) {
        this.runtime.console?.error?.("Shader playground visualization callback failed.", error);
      }
    }, delay);
    this.visualTimers.add(timer);
  }

  async renderChunk(baseSample) {
    if (
      !this.device || !this.pipeline || !this.bindGroup
      || !this.historyCapturePipeline || !this.historyCaptureBindGroup
      || !this.fxPipeline || this.fxBindGroups.length === 0
      || !this.statefulPipeline || !this.statefulEngine
      || !this.renderInfoBuffer || !this.chunkBuffer || !this.organRankBuffer || !this.fxOutputBuffer || !this.fxHistoryBuffer || !this.fxStageInfoBuffer
      || !this.mapBuffer || !this.encodedPatch
    ) {
      throw new Error("The WebGPU playground renderer is not initialized.");
    }
    const { mapMode } = gpuConstants(this.runtime);
    const queueGeneration = this.queueGeneration;
    const info = new ArrayBuffer(RENDER_INFO_SIZE);
    const view = new DataView(info);
    view.setUint32(0, Math.max(0, Math.round(baseSample)) >>> 0, true);
    view.setUint32(4, this.encodedPatch.nodeCount, true);
    view.setUint32(8, this.encodedPatch.outputIndex, true);
    view.setUint32(12, this.chunkSamples, true);
    const rampActive = this.pendingRamp;
    const renderedParams = cloneParamMap(this.encodedPatch.paramsByNode);
    view.setUint32(16, rampActive ? 1 : 0, true);
    view.setFloat32(20, this.performancePitch, true);
    const organRankRevision = this.organRankRevision;
    const renderedOrganRanks = this.organRanks;
    const organRankRampActive = this.pendingOrganRankRamp;
    view.setUint32(24, organRankRampActive ? 1 : 0, true);
    const activeStateful = Boolean(this.statefulEngine?.active);
    view.setUint32(28, activeStateful ? 1 : 0, true);
    this.device.queue.writeBuffer(this.renderInfoBuffer, 0, info);
    const revision = this.patchRevision;
    const encoder = this.device.createCommandEncoder();
    const encodeGraphPass = () => {
      const graphPass = encoder.beginComputePass();
      graphPass.setPipeline(this.pipeline);
      graphPass.setBindGroup(0, this.bindGroup);
      graphPass.dispatchWorkgroups(Math.ceil(this.chunkSamples / this.workgroupSize));
      graphPass.end();
    };
    // Capture every node's current GPU signal. Ordered state-node passes then
    // consume their real connected inputs; a graph rerun after each stage
    // exposes its stateValue through any intervening stateless modules.
    encodeGraphPass();
    if (activeStateful) {
      for (const statefulResource of this.statefulEngine.orderedResources) {
        this.statefulEngine.encodeNodePass(encoder, statefulResource);
        encodeGraphPass();
      }
    }
    if (this.fxStageCount > 0) {
      const historyPass = encoder.beginComputePass();
      historyPass.setPipeline(this.historyCapturePipeline);
      historyPass.setBindGroup(0, this.historyCaptureBindGroup);
      historyPass.dispatchWorkgroups(Math.ceil(this.chunkSamples / this.workgroupSize));
      historyPass.end();
    }
    const fxPassCount = Math.max(1, this.fxStageCount);
    for (let stageIndex = 0; stageIndex < fxPassCount; stageIndex += 1) {
      const fxPass = encoder.beginComputePass();
      fxPass.setPipeline(this.fxPipeline);
      fxPass.setBindGroup(0, stageIndex % 2 === 0
        ? this.fxBindGroups[stageIndex].forward
        : this.fxBindGroups[stageIndex].reverse);
      fxPass.dispatchWorkgroups(Math.ceil(this.chunkSamples / this.workgroupSize));
      fxPass.end();
    }
    const renderedBuffer = fxPassCount % 2 === 0 ? this.chunkBuffer : this.fxOutputBuffer;
    encoder.copyBufferToBuffer(renderedBuffer, 0, this.mapBuffer, 0, this.chunkBufferSize);
    this.device.queue.submit([encoder.finish()]);
    await this.mapBuffer.mapAsync(mapMode.READ, 0, this.chunkBufferSize);
    const result = new Float32Array(this.chunkSamples * NUM_CHANNELS);
    result.set(new Float32Array(this.mapBuffer.getMappedRange(0, this.chunkBufferSize)));
    this.mapBuffer.unmap();
    // A superseded render is discarded by fillBuffer. Do not let it advance
    // transition anchors that were never scheduled or heard.
    if (queueGeneration === this.queueGeneration) {
      this.commitRamp(revision, renderedParams, rampActive);
      this.commitOrganRankRamp(organRankRevision, renderedOrganRanks, organRankRampActive);
    }
    return result;
  }

  handleError(error) {
    this.running = false;
    this.onError?.(error);
  }

  async stop() {
    this.running = false;
    const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
    if (this.timeoutId !== null) clearTimer(this.timeoutId);
    this.timeoutId = null;
    for (const timer of this.visualTimers) clearTimer(timer);
    this.visualTimers.clear();
    if (this.renderingPromise) await this.renderingPromise.catch(() => {});
    this.renderingPromise = null;
    for (const source of this.sources) {
      try { source.stop?.(this.context?.currentTime); } catch { /* source already ended */ }
    }
    this.sources.clear();
    for (const sourceGain of this.sourceGains.values()) {
      try { sourceGain?.disconnect?.(); } catch { /* optional Web Audio cleanup */ }
    }
    this.sourceGains.clear();
    this.scheduledChunks = [];
    this.pendingQueueHandoff = null;
    this.deferredQueueRefresh = false;
    const context = this.context;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    if (context && context.state !== "closed" && typeof context.close === "function") await context.close();
    this.statefulEngine?.destroy();
    this.statefulEngine = null;
    for (const buffer of [
      this.renderInfoBuffer,
      this.nodeBuffer,
      this.organRankBuffer,
      this.chunkBuffer,
      this.fxOutputBuffer,
      this.fxHistoryBuffer,
      this.fxStageInfoBuffer,
      this.stateGraphFallbackBuffer,
      this.stateOutputFallbackBuffer,
      this.mapBuffer,
    ]) {
      try { buffer?.destroy?.(); } catch { /* optional cleanup */ }
    }
    try { this.device?.destroy?.(); } catch { /* Device.destroy is optional. */ }
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.historyCapturePipeline = null;
    this.historyCaptureBindGroup = null;
    this.fxPipeline = null;
    this.statefulPipeline = null;
    this.fxBindGroups = [];
    this.fxStageInfoBuffer = null;
    this.fxStageInfoStride = 0;
    this.fxStageCount = 0;
    this.renderInfoBuffer = null;
    this.nodeBuffer = null;
    this.organRankBuffer = null;
    this.chunkBuffer = null;
    this.fxOutputBuffer = null;
    this.fxHistoryBuffer = null;
    this.fxHistoryFrames = 0;
    this.fxHistoryAllocated = false;
    this.stateGraphFallbackBuffer = null;
    this.stateOutputFallbackBuffer = null;
    this.mapBuffer = null;
  }
}
