import {
  WEBGPU_SYNTHS_DEFAULTS,
  WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS,
  WEBGPU_SYNTHS_LIMITS,
  WEBGPU_SYNTHS_MODELS,
  WEBGPU_SYNTHS_ORGAN_RANK_COUNT,
  WEBGPU_SYNTHS_RUNTIME_DEFAULTS,
  WEBGPU_SYNTHS_SCALES,
  WEBGPU_SYNTHS_WORKGROUP_SIZES,
  WebGpuSynthLabAudio,
  createWebGpuSynthSequence,
  sanitizeWebGpuSynthOrganRanks,
  sanitizeWebGpuSynthParams,
  sanitizeWebGpuSynthSequence,
  varyWebGpuSynthSequence,
  webGpuSynthModelLabel,
  webGpuSynthSupport,
} from "./src/webgpu-synths.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

const LANE_SPECS = Object.freeze([
  Object.freeze({ id: "pitch", label: "Pitch", color: "#74f7ff", description: "scale degree" }),
  Object.freeze({ id: "energy", label: "Pulse", color: "#ffda57", description: "gate + energy" }),
  Object.freeze({ id: "timbre", label: "Timbre", color: "#ff6eaa", description: "model color" }),
  Object.freeze({ id: "morph", label: "Morph", color: "#a78bff", description: "model + motion" }),
]);

const ORGAN_RANK_LABELS = Object.freeze(["16′", "5⅓′", "8′", "4′", "2⅔′", "2′", "1⅗′", "1⅓′", "1′"]);

const MODEL_DETAILS = Object.freeze([
  "1–48 resonant harmonic partials",
  "1–12 feed-forward phase operators",
  "1–8 detuned wavefold layers",
  "1–32 stiff inharmonic resonators",
  "1–16 windowed micrograins",
  "1–9 editable additive ranks",
]);

const MODEL_COLORS = Object.freeze(["#91ff63", "#74f7ff", "#ffda57", "#ff6eaa", "#a78bff", "#ffe6a8"]);

const TECHNIQUES = Object.freeze([
  Object.freeze({ id: "euclid", label: "Euclidean Pattern" }),
  Object.freeze({ id: "brownian", label: "Brownian Walk" }),
  Object.freeze({ id: "cellular", label: "Rule 110" }),
  Object.freeze({ id: "recurrence", label: "Golden Recurrence" }),
  Object.freeze({ id: "orbit", label: "Orbital Phase" }),
  Object.freeze({ id: "noise", label: "Seed Noise" }),
]);

function presetParams(overrides) {
  return sanitizeWebGpuSynthParams({ ...WEBGPU_SYNTHS_DEFAULTS, ...overrides });
}

function preset(id, label, technique, variation, overrides) {
  return Object.freeze({ id, label, technique, variation, params: presetParams(overrides) });
}

// Keep the source library stable, then present it as one reproducible shuffle
// with Modal Bloom fixed at the top of the grid.
const PRESET_LIBRARY = Object.freeze([
  preset("velvet-drawbars", "Velvet Drawbars", "orbit", 0.16, { topology: 5, baseNote: 36, clock: 2.2, steps: 16, glide: 0.36, complexity: 0.82, color: 0.34, motion: 0.28, decay: 1.65, fold: 0.04, space: 0.68, chaos: 0.03, swing: 0.04, gain: 0.092, seed: 31991, scale: 1, organRanks: 9, filterCutoff: 9200, filterTaps: 11, filterMix: 0.18, delayTime: 0.31, delayRepeats: 2, delayDecay: 0.38, delayMix: 0.13 }),
  preset("glass-choir", "Glass Choir", "recurrence", 0.1, { topology: 4.78, baseNote: 60, clock: 4.4, steps: 24, glide: 0.62, complexity: 0.54, color: 0.16, motion: 0.24, decay: 1.56, fold: 0.03, space: 0.88, chaos: 0.02, gain: 0.074, seed: 4221, scale: 4, grainCount: 4, organRanks: 7, filterCutoff: 13200, filterTaps: 9, filterMix: 0.12, delayTime: 0.48, delayRepeats: 3, delayDecay: 0.46, delayMix: 0.18 }),
  preset("slow-pipes", "Slow Pipes", "euclid", 0.06, { topology: 5, baseNote: 24, clock: 0.72, steps: 12, glide: 0.78, complexity: 0.62, color: 0.42, motion: 0.1, decay: 1.8, fold: 0, space: 0.54, chaos: 0, gain: 0.094, seed: 1139, scale: 3, organRanks: 6, filterCutoff: 6900, filterTaps: 15, filterMix: 0.28 }),
  preset("lunar-bells", "Lunar Bells", "orbit", 0.12, { topology: 3.02, baseNote: 67, clock: 7.2, steps: 15, glide: 0.08, complexity: 0.66, color: 0.76, motion: 0.3, decay: 1.62, fold: 0.08, space: 0.94, chaos: 0.04, gain: 0.078, seed: 8271, scale: 4, modalModes: 12, delayTime: 0.56, delayRepeats: 4, delayDecay: 0.62, delayMix: 0.28 }),
  preset("warm-reeds", "Warm Reeds", "brownian", 0.12, { topology: 0.42, baseNote: 43, clock: 3.1, steps: 18, glide: 0.38, complexity: 0.44, color: 0.3, motion: 0.22, decay: 1.1, fold: 0.06, space: 0.38, chaos: 0.05, swing: 0.08, gain: 0.1, seed: 9321, scale: 1, acidPartials: 10, pmOperators: 3, filterCutoff: 5200, filterTaps: 17, filterMix: 0.36 }),
  preset("modal-bloom", "Modal Bloom", "recurrence", 0.14, { topology: 3.18, baseNote: 52, clock: 9.8, steps: 27, glide: 0.24, complexity: 0.78, color: 0.64, motion: 0.44, decay: 1.48, fold: 0.12, space: 0.82, chaos: 0.07, gain: 0.082, seed: 14417, scale: 3, modalModes: 24, filterCutoff: 11200, filterTaps: 7, filterMix: 0.08, delayTime: 0.29, delayRepeats: 2, delayMix: 0.13 }),
  preset("soft-orbit", "Soft Orbit", "orbit", 0.15, { topology: 1.08, baseNote: 31, clock: 12.6, steps: 20, glide: 0.42, complexity: 0.48, color: 0.34, motion: 0.52, decay: 1.02, fold: 0.08, space: 0.76, chaos: 0.08, swing: 0.04, gain: 0.088, seed: 20119, scale: 4, pmOperators: 4, delayTime: 0.41, delayRepeats: 3, delayDecay: 0.5, delayMix: 0.2 }),
  preset("velvet-echo", "Velvet Echo", "euclid", 0.16, { topology: 4.92, baseNote: 58, clock: 5.6, steps: 16, glide: 0.34, complexity: 0.72, color: 0.4, motion: 0.36, decay: 1.3, fold: 0.04, space: 0.92, chaos: 0.06, swing: 0.12, gain: 0.086, seed: 27803, scale: 2, grainCount: 3, organRanks: 8, delayTime: 0.24, delayRepeats: 4, delayDecay: 0.58, delayMix: 0.26 }),

  preset("acid-fossil", "Acid Fossil", "euclid", 0.18, { topology: 0.08, baseNote: 32, clock: 6.2, steps: 16, complexity: 0.82, color: 0.72, decay: 0.3, fold: 0.42, space: 0.28, chaos: 0.12, swing: 0.14, seed: 17011, scale: 2, acidPartials: 24, filterCutoff: 4200, filterTaps: 13, filterMix: 0.42, shaperDrive: 2.2, shaperMix: 0.18 }),
  preset("neon-pulse", "Neon Pulse", "euclid", 0.22, { topology: 0.18, baseNote: 39, clock: 9.6, steps: 12, glide: 0.05, complexity: 0.7, color: 0.9, motion: 0.6, decay: 0.18, fold: 0.38, space: 0.42, chaos: 0.18, swing: 0.18, gain: 0.105, seed: 3109, scale: 0, acidPartials: 32, filterCutoff: 7600, filterTaps: 9, filterMix: 0.24, shaperDrive: 2.8, shaperMix: 0.22 }),
  preset("chrome-steps", "Chrome Steps", "cellular", 0.24, { topology: 1.04, baseNote: 35, clock: 7.4, steps: 32, glide: 0.12, complexity: 0.76, color: 0.68, motion: 0.54, decay: 0.28, fold: 0.26, space: 0.58, chaos: 0.2, swing: 0.08, seed: 18713, scale: 1, pmOperators: 6, delayTime: 0.16, delayRepeats: 2, delayMix: 0.12 }),
  preset("harmonic-run", "Harmonic Run", "recurrence", 0.2, { topology: 0.26, baseNote: 50, clock: 8.2, steps: 21, glide: 0.2, complexity: 0.9, color: 0.56, motion: 0.48, decay: 0.36, fold: 0.18, space: 0.66, chaos: 0.14, swing: 0.1, gain: 0.096, seed: 24593, scale: 3, acidPartials: 40, filterCutoff: 10400, filterTaps: 5, filterMix: 0.08 }),
  preset("phase-loom", "Phase Loom", "orbit", 0.28, { topology: 1.36, baseNote: 31, clock: 5.4, steps: 28, glide: 0.26, complexity: 0.84, color: 0.5, motion: 0.76, decay: 0.46, fold: 0.34, space: 0.78, chaos: 0.3, swing: 0.13, gain: 0.092, seed: 29171, scale: 5, pmOperators: 9, delayTime: 0.21, delayRepeats: 3, delayDecay: 0.42, delayMix: 0.18 }),
  preset("folded-mutant", "Folded Mutant", "cellular", 0.54, { topology: 2.18, baseNote: 38, clock: 8.4, steps: 32, glide: 0.04, complexity: 0.68, color: 0.38, motion: 0.72, decay: 0.2, fold: 0.88, space: 0.5, chaos: 0.48, swing: 0.06, seed: 39117, scale: 5, foldLayers: 5, shaperDrive: 4.8, shaperFold: 0.72, shaperMix: 0.48 }),
  preset("bell-swarm", "Bell Swarm", "orbit", 0.2, { topology: 3.06, baseNote: 46, clock: 2.7, steps: 20, glide: 0, complexity: 0.9, color: 0.78, motion: 0.48, decay: 1.22, fold: 0.18, space: 0.9, chaos: 0.12, swing: 0.02, gain: 0.1, seed: 8271, scale: 4, modalModes: 18, delayTime: 0.37, delayRepeats: 4, delayDecay: 0.63, delayMix: 0.34 }),
  preset("drawbar-dance", "Drawbar Dance", "cellular", 0.26, { topology: 5, baseNote: 37, clock: 6.8, steps: 24, glide: 0.2, complexity: 0.88, color: 0.48, motion: 0.62, decay: 0.62, fold: 0.12, space: 0.7, chaos: 0.16, swing: 0.2, gain: 0.094, seed: 33107, scale: 1, organRanks: 9, filterCutoff: 8400, filterTaps: 13, filterMix: 0.2, delayTime: 0.18, delayRepeats: 3, delayMix: 0.16 }),

  preset("recursive-chrome", "Recursive Chrome", "recurrence", 0.32, { topology: 1.14, baseNote: 30, clock: 4.8, steps: 21, glide: 0.18, complexity: 0.74, color: 0.63, motion: 0.58, decay: 0.52, fold: 0.3, space: 0.66, chaos: 0.26, seed: 24117, scale: 3, pmOperators: 7, delayTime: 0.19, delayRepeats: 3, delayDecay: 0.5, delayMix: 0.22 }),
  preset("prism-cascade", "Prism Cascade", "orbit", 0.38, { topology: 1.82, baseNote: 52, clock: 6.1, steps: 35, glide: 0.16, complexity: 0.92, color: 0.82, motion: 0.88, decay: 0.4, fold: 0.5, space: 0.96, chaos: 0.42, swing: 0.17, gain: 0.076, seed: 36451, scale: 4, pmOperators: 12, foldLayers: 3, delayTime: 0.12, delayRepeats: 4, delayDecay: 0.66, delayMix: 0.3 }),
  preset("copper-fold", "Copper Fold", "cellular", 0.44, { topology: 2.38, baseNote: 28, clock: 7.9, steps: 30, glide: 0.07, complexity: 0.78, color: 0.24, motion: 0.72, decay: 0.24, fold: 0.92, space: 0.52, chaos: 0.5, swing: 0.09, gain: 0.086, seed: 41023, scale: 3, foldLayers: 6, shaperDrive: 6.2, shaperFold: 0.7, shaperMix: 0.48 }),
  preset("grain-halo", "Grain Halo", "brownian", 0.4, { topology: 4.02, baseNote: 44, clock: 3.7, steps: 40, glide: 0.48, complexity: 0.82, color: 0.74, motion: 0.92, decay: 0.7, fold: 0.34, space: 1, chaos: 0.46, swing: 0.22, gain: 0.082, seed: 47231, scale: 5, grainCount: 10, filterCutoff: 14800, filterTaps: 7, filterMix: 0.1, delayTime: 0.43, delayRepeats: 4, delayDecay: 0.74, delayMix: 0.36 }),
  preset("modal-wire", "Modal Wire", "recurrence", 0.46, { topology: 3.42, baseNote: 33, clock: 5.9, steps: 26, glide: 0.04, complexity: 0.98, color: 0.92, motion: 0.7, decay: 0.58, fold: 0.48, space: 0.84, chaos: 0.52, swing: 0.11, gain: 0.078, seed: 50147, scale: 2, modalModes: 32, filterCutoff: 12400, filterTaps: 19, filterMix: 0.18, shaperDrive: 3.6, shaperMix: 0.24 }),
  preset("clockwork-dust", "Clockwork Dust", "cellular", 0.5, { topology: 4.18, baseNote: 26, clock: 12.4, steps: 48, glide: 0.18, complexity: 0.9, color: 0.56, motion: 0.86, decay: 0.16, fold: 0.58, space: 0.72, chaos: 0.58, swing: 0.24, gain: 0.082, seed: 53719, scale: 0, grainCount: 12, filterCutoff: 5600, filterTaps: 21, filterMix: 0.36, delayTime: 0.08, delayRepeats: 3, delayMix: 0.14 }),
  preset("particle-rain", "Particle Rain", "orbit", 0.52, { topology: 4.44, baseNote: 58, clock: 4.3, steps: 56, glide: 0.54, complexity: 0.96, color: 0.86, motion: 1, decay: 0.48, fold: 0.42, space: 1, chaos: 0.62, swing: 0.29, gain: 0.068, seed: 57037, scale: 4, grainCount: 16, delayTime: 0.67, delayRepeats: 4, delayDecay: 0.8, delayMix: 0.44 }),
  preset("interzone", "Interzone", "noise", 0.68, { topology: 1.72, baseNote: 24, clock: 11.3, steps: 48, glide: 0.28, complexity: 0.96, color: 0.54, motion: 0.93, decay: 0.14, fold: 0.74, space: 0.78, chaos: 0.94, swing: 0.31, gain: 0.085, seed: 64439, scale: 5, pmOperators: 10, foldLayers: 7, filterCutoff: 2800, filterTaps: 25, filterMix: 0.55, delayTime: 0.073, delayRepeats: 4, delayDecay: 0.72, delayMix: 0.27, shaperDrive: 7.4, shaperFold: 0.84, shaperMix: 0.62 }),

  preset("dust-engine", "Dust Engine", "brownian", 0.46, { topology: 3.88, baseNote: 27, clock: 7.7, steps: 24, glide: 0.42, complexity: 0.86, color: 0.9, motion: 0.82, decay: 0.34, fold: 0.56, space: 0.94, chaos: 0.72, swing: 0.21, gain: 0.11, seed: 51733, scale: 1, grainCount: 13, filterCutoff: 6100, filterTaps: 17, filterMix: 0.31, delayTime: 0.11, delayRepeats: 2, delayMix: 0.16 }),
  preset("static-choir", "Static Choir", "noise", 0.72, { topology: 4.72, baseNote: 41, clock: 6.6, steps: 37, glide: 0.6, complexity: 1, color: 0.88, motion: 0.96, decay: 0.38, fold: 0.62, space: 1, chaos: 0.8, swing: 0.34, gain: 0.066, seed: 60101, scale: 5, grainCount: 16, organRanks: 9, filterCutoff: 3800, filterTaps: 27, filterMix: 0.48, shaperDrive: 5.8, shaperFold: 0.64, shaperMix: 0.4 }),
  preset("razor-swarm", "Razor Swarm", "cellular", 0.76, { topology: 1.94, baseNote: 47, clock: 14.2, steps: 52, glide: 0.03, complexity: 1, color: 1, motion: 0.94, decay: 0.09, fold: 0.9, space: 0.86, chaos: 0.88, swing: 0.18, gain: 0.062, seed: 61583, scale: 2, pmOperators: 12, foldLayers: 8, filterCutoff: 9200, filterTaps: 23, filterMix: 0.34, shaperDrive: 9.4, shaperFold: 0.9, shaperMix: 0.68 }),
  preset("noise-lattice", "Noise Lattice", "noise", 0.8, { topology: 3.56, baseNote: 23, clock: 13.1, steps: 64, glide: 0.14, complexity: 1, color: 0.68, motion: 1, decay: 0.12, fold: 0.78, space: 0.92, chaos: 0.92, swing: 0.38, gain: 0.06, seed: 62011, scale: 0, modalModes: 32, filterCutoff: 2300, filterTaps: 31, filterMix: 0.62, delayTime: 0.047, delayRepeats: 4, delayDecay: 0.82, delayMix: 0.32 }),
  preset("broken-carrier", "Broken Carrier", "recurrence", 0.84, { topology: 1.28, baseNote: 20, clock: 16.6, steps: 43, glide: 0.72, complexity: 0.98, color: 0.12, motion: 0.98, decay: 0.07, fold: 0.84, space: 0.7, chaos: 0.96, swing: 0.41, gain: 0.058, seed: 63029, scale: 5, pmOperators: 12, filterCutoff: 1500, filterTaps: 29, filterMix: 0.68, shaperDrive: 10.8, shaperFold: 0.76, shaperMix: 0.72 }),
  preset("shrapnel-fold", "Shrapnel Fold", "cellular", 0.88, { topology: 2.62, baseNote: 62, clock: 18.2, steps: 60, glide: 0.01, complexity: 1, color: 0.96, motion: 1, decay: 0.05, fold: 1, space: 0.9, chaos: 0.98, swing: 0.3, gain: 0.052, seed: 63809, scale: 5, foldLayers: 8, filterCutoff: 17400, filterTaps: 3, filterMix: 0.08, shaperDrive: 14.2, shaperFold: 1, shaperMix: 0.86 }),
  preset("radio-storm", "Radio Storm", "noise", 0.94, { topology: 4.26, baseNote: 25, clock: 17.4, steps: 64, glide: 0.36, complexity: 1, color: 1, motion: 1, decay: 0.08, fold: 0.94, space: 1, chaos: 1, swing: 0.42, gain: 0.05, seed: 64937, scale: 0, grainCount: 16, filterCutoff: 840, filterTaps: 31, filterMix: 0.74, delayTime: 0.031, delayRepeats: 4, delayDecay: 0.88, delayMix: 0.48, shaperDrive: 12.8, shaperFold: 0.92, shaperMix: 0.82 }),
  preset("void-grinder", "Void Grinder", "noise", 1, { topology: 2.9, baseNote: 18, clock: 20, steps: 64, glide: 0.9, complexity: 1, color: 0.04, motion: 1, decay: 0.03, fold: 1, space: 1, chaos: 1, swing: 0.42, gain: 0.045, seed: 65535, scale: 5, acidPartials: 48, pmOperators: 12, foldLayers: 8, modalModes: 32, grainCount: 16, filterCutoff: 420, filterTaps: 31, filterMix: 0.82, delayTime: 0.019, delayRepeats: 4, delayDecay: 0.88, delayMix: 0.56, shaperDrive: 16, shaperFold: 1, shaperMix: 1 }),
]);

function shuffledPresetBank(presets, seed = 0x4d4f5250) {
  const featured = presets.find(({ id }) => id === "modal-bloom");
  if (!featured) throw new Error("Modal Bloom preset is required.");
  const shuffled = presets.filter((candidate) => candidate !== featured);
  let state = seed >>> 0;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return Object.freeze([featured, ...shuffled]);
}

const PRESETS = shuffledPresetBank(PRESET_LIBRARY);

const CONTROL_GROUPS = Object.freeze({
  model: Object.freeze([
    { key: "topology", label: "Model topology", step: 0.01 },
    { key: "complexity", label: "Complexity", step: 0.01 },
    { key: "color", label: "Color", step: 0.01 },
    { key: "fold", label: "Nonlinearity", step: 0.01 },
  ]),
  time: Object.freeze([
    { key: "clock", label: "Shader clock", step: 0.01 },
    { key: "steps", label: "Cycle length", step: 1 },
    { key: "swing", label: "Swing", step: 0.01 },
    { key: "glide", label: "Pitch memory", step: 0.01 },
    { key: "decay", label: "Event decay", step: 0.01 },
  ]),
  field: Object.freeze([
    { key: "baseNote", label: "Root note", step: 1 },
    { key: "scale", label: "Scale", type: "select", options: WEBGPU_SYNTHS_SCALES },
    { key: "motion", label: "Motion", step: 0.01 },
    { key: "space", label: "Stereo field", step: 0.01 },
    { key: "chaos", label: "Model morph depth", step: 0.01 },
    { key: "gain", label: "Shader gain", step: 0.001 },
    { key: "seed", label: "Shader seed", step: 1 },
  ]),
  components: Object.freeze([
    { key: "acidPartials", label: "Acid partials", step: 1 },
    { key: "pmOperators", label: "PM operators", step: 1 },
    { key: "foldLayers", label: "Wavefold layers", step: 1 },
    { key: "modalModes", label: "Modal resonators", step: 1 },
    { key: "grainCount", label: "Particle grains", step: 1 },
    { key: "organRanks", label: "Organ ranks", step: 1 },
  ]),
  effects: Object.freeze([
    { key: "filterCutoff", label: "FIR cutoff", step: 10 },
    { key: "filterTaps", label: "FIR taps", step: 2 },
    { key: "filterMix", label: "Filter mix", step: 0.01 },
    { key: "delayTime", label: "Delay time", step: 0.01 },
    { key: "delayRepeats", label: "Delay taps", step: 1 },
    { key: "delayDecay", label: "Tap decay", step: 0.01 },
    { key: "delayMix", label: "Delay mix", step: 0.01 },
    { key: "shaperDrive", label: "Shaper drive", step: 0.1 },
    { key: "shaperFold", label: "Shaper fold", step: 0.01 },
    { key: "shaperMix", label: "Shaper mix", step: 0.01 },
  ]),
});

const CONTROL_SPECS = Object.freeze(Object.values(CONTROL_GROUPS).flat());
const CONTROL_BY_KEY = new Map(CONTROL_SPECS.map((spec) => [spec.key, spec]));
const EFFECT_CONTROL_SECTIONS = Object.freeze([
  Object.freeze({ label: "FIR low-pass", detail: "Causal windowed-sinc taps", keys: Object.freeze(["filterCutoff", "filterTaps", "filterMix"]) }),
  Object.freeze({ label: "Feed-forward delay", detail: "GPU history with stereo taps", keys: Object.freeze(["delayTime", "delayRepeats", "delayDecay", "delayMix"]) }),
  Object.freeze({ label: "Waveshaper", detail: "Soft clipping to sine folding", keys: Object.freeze(["shaperDrive", "shaperFold", "shaperMix"]) }),
]);
const DISCRETE_KEYS = new Set([
  "steps",
  "baseNote",
  "seed",
  "scale",
  "acidPartials",
  "pmOperators",
  "foldLayers",
  "modalModes",
  "grainCount",
  "organRanks",
  "filterTaps",
  "delayRepeats",
]);
const KNOB_ORDER = Object.freeze(["topology", "complexity", "color", "fold", "motion", "chaos"]);
const KNOB_LABELS = Object.freeze({
  topology: "Model",
  complexity: "Density",
  color: "Color",
  fold: "Fold",
  motion: "Orbit",
  chaos: "Morph depth",
});

const support = webGpuSynthSupport(globalThis);
const firstPreset = PRESETS[0];
const state = {
  params: firstPreset.params,
  sequence: createWebGpuSynthSequence(firstPreset.technique, {
    steps: firstPreset.params.steps,
    seed: firstPreset.params.seed,
    variation: firstPreset.variation,
  }),
  organRanks: sanitizeWebGpuSynthOrganRanks(WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS),
  presetId: firstPreset.id,
  techniqueId: firstPreset.technique,
  activeLane: 0,
  audioOn: false,
  synthPlaying: false,
  visualHoldTime: 0,
  chunkDuration: WEBGPU_SYNTHS_RUNTIME_DEFAULTS.chunkDuration,
  workgroupSize: WEBGPU_SYNTHS_RUNTIME_DEFAULTS.workgroupSize,
  editing: false,
  editingLane: null,
  editingStep: null,
};

const controlInputs = new Map();
const controlOutputs = new Map();
const knobControls = new Map();
const knobOutputs = new Map();
const organRankInputs = new Map();
let engine = null;
let audioStartPromise = null;
let audioGeneration = 0;
let animationFrame = 0;
let activeKnobDrag = null;

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function formatParam(key, value) {
  if (key === "topology") return webGpuSynthModelLabel(value);
  if (key === "baseNote") return `MIDI ${Math.round(value)}`;
  if (["clock", "filterCutoff"].includes(key)) return `${value < 1000 ? value.toFixed(2) : (value / 1000).toFixed(2)} ${value < 1000 ? "Hz" : "kHz"}`;
  if (key === "steps") return `${Math.round(value)} steps`;
  if (key === "decay") return `${Math.round(value * 1000)} ms`;
  if (key === "delayTime") return `${Math.round(value * 1000)} ms`;
  if (key === "swing") return `${Math.round(value * 100)}%`;
  if (key === "gain") return `${Math.round(value * 100)}%`;
  if (key === "seed") return `${Math.round(value)}`;
  if (key === "scale") return WEBGPU_SYNTHS_SCALES[Math.round(value)];
  if (["acidPartials", "pmOperators", "foldLayers", "modalModes", "grainCount", "organRanks", "filterTaps", "delayRepeats"].includes(key)) {
    return `${Math.round(value)}`;
  }
  if (key === "shaperDrive") return `${value.toFixed(1)}×`;
  return `${Math.round(value * 100)}%`;
}

function syncReadouts() {
  for (const [key, input] of controlInputs) input.value = String(state.params[key]);
  for (const [key, output] of controlOutputs) output.textContent = formatParam(key, state.params[key]);
  for (const key of KNOB_ORDER) {
    const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[key];
    const value = state.params[key];
    const normalized = (value - minimum) / (maximum - minimum);
    const dial = knobControls.get(key);
    dial?.style.setProperty("--knob-fill", `${normalized * 75}%`);
    dial?.style.setProperty("--knob-angle", `${-135 + normalized * 270}deg`);
    dial?.setAttribute("aria-valuenow", value.toFixed(3));
    dial?.setAttribute("aria-valuetext", formatParam(key, value));
    const output = knobOutputs.get(key);
    if (output) output.textContent = formatParam(key, value);
  }
  $("modelState").textContent = webGpuSynthModelLabel(state.params.topology);
  $("timeState").textContent = `${state.params.steps} steps · ${state.params.clock.toFixed(2)} Hz`;
  $("fieldState").textContent = `${WEBGPU_SYNTHS_SCALES[state.params.scale]} · MIDI ${state.params.baseNote}`;
  $("componentsState").textContent = "six adjustable banks";
  const activeFx = [state.params.filterMix, state.params.delayMix, state.params.shaperMix].filter((value) => value > 0.001).length;
  $("effectsState").textContent = activeFx ? `${activeFx} active` : "bypassed";
  $("organRanksState").textContent = `${state.params.organRanks} active`;
  for (const node of $("modelRail").querySelectorAll("button")) {
    node.setAttribute("aria-pressed", String(Math.abs(Number(node.dataset.model) - state.params.topology) < 0.08));
  }
}

function applyParams(params, { preservePreset = false } = {}) {
  state.params = sanitizeWebGpuSynthParams({ ...state.params, ...params });
  if (!preservePreset) state.presetId = "custom";
  engine?.updateParams(state.params);
  syncReadouts();
  syncPressedStates();
}

function applySequence(sequence, { preservePreset = false } = {}) {
  state.sequence = sanitizeWebGpuSynthSequence(sequence);
  if (!preservePreset) state.presetId = "custom";
  engine?.updateSequence(state.sequence);
  syncPressedStates();
}

function syncPressedStates() {
  for (const button of $("presetButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.presetId));
  }
  for (const button of $("techniqueButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.technique === state.techniqueId));
  }
  const preset = PRESETS.find(({ id }) => id === state.presetId);
  $("presetState").textContent = preset?.label ?? "Custom patch";
  const technique = TECHNIQUES.find(({ id }) => id === state.techniqueId);
  $("variationState").textContent = technique?.label ?? "Hand-drawn sequence";
}

function selectSequenceLane(index, { quiet = false } = {}) {
  state.activeLane = clamp(Math.round(index), 0, LANE_SPECS.length - 1);
  for (const [buttonIndex, candidate] of [...$("laneButtons").children].entries()) {
    candidate.setAttribute("aria-pressed", String(buttonIndex === state.activeLane));
  }
  if (!quiet) announce(`${LANE_SPECS[state.activeLane].label} lane selected for editing.`);
}

function applyPreset(presetDefinition) {
  state.presetId = presetDefinition.id;
  state.techniqueId = presetDefinition.technique;
  state.params = sanitizeWebGpuSynthParams(presetDefinition.params);
  state.sequence = createWebGpuSynthSequence(presetDefinition.technique, {
    steps: state.params.steps,
    seed: state.params.seed,
    variation: presetDefinition.variation,
  });
  engine?.updateParams(state.params);
  engine?.updateSequence(state.sequence);
  syncReadouts();
  syncPressedStates();
  announce(`${presetDefinition.label} shader preset loaded.`);
}

function applyTechnique(technique) {
  state.techniqueId = technique.id;
  const variation = 0.3 + state.params.chaos * 0.6;
  applySequence(createWebGpuSynthSequence(technique.id, {
    steps: state.params.steps,
    seed: state.params.seed,
    variation,
  }));
  $("variationState").textContent = technique.label;
  announce(`${technique.label} generated four control lanes.`);
}

function changeParam(key, rawValue) {
  const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[key];
  let value = clamp(rawValue, minimum, maximum);
  if (DISCRETE_KEYS.has(key)) value = Math.round(value);
  const previousSteps = state.params.steps;
  applyParams({ [key]: value });
  if (key === "steps" && value !== previousSteps) {
    const technique = TECHNIQUES.find(({ id }) => id === state.techniqueId) ?? TECHNIQUES[0];
    state.sequence = createWebGpuSynthSequence(technique.id, {
      steps: value,
      seed: state.params.seed,
      variation: 0.3 + state.params.chaos * 0.6,
    });
    engine?.updateSequence(state.sequence);
  }
}

function createRangeControl(spec) {
  const wrapper = document.createElement("label");
  wrapper.className = "control";
  wrapper.htmlFor = spec.key;
  const line = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = `${spec.key}Out`;
  output.htmlFor = spec.key;
  line.append(label, output);
  const input = document.createElement("input");
  const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[spec.key];
  input.id = spec.key;
  input.type = "range";
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(spec.step);
  input.value = String(state.params[spec.key]);
  input.setAttribute("aria-label", spec.label);
  input.addEventListener("input", () => changeParam(spec.key, input.value));
  controlInputs.set(spec.key, input);
  controlOutputs.set(spec.key, output);
  wrapper.append(line, input);
  return wrapper;
}

function createSelectControl(spec) {
  const wrapper = document.createElement("label");
  wrapper.className = "select-control";
  wrapper.htmlFor = spec.key;
  const line = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = `${spec.key}Out`;
  output.htmlFor = spec.key;
  line.append(label, output);
  const shell = document.createElement("span");
  shell.className = "select-shell";
  const select = document.createElement("select");
  select.id = spec.key;
  select.setAttribute("aria-label", spec.label);
  spec.options.forEach((option, index) => {
    const element = document.createElement("option");
    element.value = String(index);
    element.textContent = option;
    select.append(element);
  });
  select.addEventListener("change", () => changeParam(spec.key, select.value));
  shell.append(select);
  controlInputs.set(spec.key, select);
  controlOutputs.set(spec.key, output);
  wrapper.append(line, shell);
  return wrapper;
}

function knobStep(spec) {
  return spec.step ?? ((WEBGPU_SYNTHS_LIMITS[spec.key][1] - WEBGPU_SYNTHS_LIMITS[spec.key][0]) / 100);
}

function createKnobControl(key, index) {
  const spec = CONTROL_BY_KEY.get(key);
  const color = MODEL_COLORS[index % MODEL_COLORS.length];
  const wrapper = document.createElement("div");
  wrapper.className = "webgpu-synth-knob";
  wrapper.style.setProperty("--knob-color", color);
  const dial = document.createElement("div");
  dial.className = "webgpu-synth-knob-dial";
  dial.style.setProperty("--knob-color", color);
  dial.tabIndex = 0;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", spec.label);
  dial.setAttribute("aria-valuemin", String(WEBGPU_SYNTHS_LIMITS[key][0]));
  dial.setAttribute("aria-valuemax", String(WEBGPU_SYNTHS_LIMITS[key][1]));
  dial.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    activeKnobDrag = { key, startY: event.clientY, startValue: state.params[key] };
    dial.setPointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointermove", (event) => {
    if (activeKnobDrag?.key !== key) return;
    event.preventDefault();
    const [minimum, maximum] = WEBGPU_SYNTHS_LIMITS[key];
    changeParam(key, activeKnobDrag.startValue + ((activeKnobDrag.startY - event.clientY) / 130) * (maximum - minimum));
  });
  dial.addEventListener("pointerup", (event) => {
    if (activeKnobDrag?.key !== key) return;
    activeKnobDrag = null;
    dial.releasePointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointercancel", () => { if (activeKnobDrag?.key === key) activeKnobDrag = null; });
  dial.addEventListener("wheel", (event) => {
    event.preventDefault();
    changeParam(key, state.params[key] + Math.sign(-event.deltaY) * knobStep(spec));
  }, { passive: false });
  dial.addEventListener("keydown", (event) => {
    const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : ["ArrowDown", "ArrowLeft"].includes(event.key) ? -1 : 0;
    if (direction) {
      event.preventDefault();
      changeParam(key, state.params[key] + direction * knobStep(spec));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      changeParam(key, WEBGPU_SYNTHS_LIMITS[key][event.key === "Home" ? 0 : 1]);
    }
  });
  const label = document.createElement("span");
  label.className = "webgpu-synth-knob-label";
  label.textContent = KNOB_LABELS[key];
  const output = document.createElement("output");
  output.className = "webgpu-synth-knob-value";
  knobControls.set(key, dial);
  knobOutputs.set(key, output);
  wrapper.append(dial, label, output);
  return wrapper;
}

const ORGAN_RANK_FIELDS = Object.freeze([
  Object.freeze({ key: "ratio", label: "Ratio", minimum: 0.125, maximum: 16, step: 0.01 }),
  Object.freeze({ key: "level", label: "Level", minimum: 0, maximum: 1, step: 0.01 }),
  Object.freeze({ key: "amRate", label: "AM Hz", minimum: 0, maximum: 30, step: 0.01 }),
  Object.freeze({ key: "amDepth", label: "AM depth", minimum: 0, maximum: 1, step: 0.01 }),
]);

function syncOrganRankInputs() {
  state.organRanks.forEach((rank, rankIndex) => {
    for (const field of ORGAN_RANK_FIELDS) {
      const input = organRankInputs.get(`${rankIndex}:${field.key}`);
      if (input) input.value = String(rank[field.key]);
    }
  });
}

function changeOrganRank(rankIndex, field, rawValue) {
  const next = state.organRanks.map((rank) => ({ ...rank }));
  next[rankIndex][field] = Number(rawValue);
  state.organRanks = sanitizeWebGpuSynthOrganRanks(next);
  state.presetId = "custom";
  engine?.updateOrganRanks(state.organRanks);
  syncOrganRankInputs();
  syncPressedStates();
}

function createOrganRankRow(rankIndex) {
  const row = document.createElement("div");
  row.className = "organ-rank-row";
  const title = document.createElement("b");
  title.textContent = `Rank ${rankIndex + 1} · ${ORGAN_RANK_LABELS[rankIndex]}`;
  row.append(title);
  for (const field of ORGAN_RANK_FIELDS) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = field.label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(field.minimum);
    input.max = String(field.maximum);
    input.step = String(field.step);
    input.value = String(state.organRanks[rankIndex][field.key]);
    input.setAttribute("aria-label", `${ORGAN_RANK_LABELS[rankIndex]} ${field.label}`);
    input.addEventListener("input", () => changeOrganRank(rankIndex, field.key, input.value));
    organRankInputs.set(`${rankIndex}:${field.key}`, input);
    label.append(caption, input);
    row.append(label);
  }
  return row;
}

function renderOrganRankControls() {
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "mini-action organ-rank-reset";
  reset.textContent = "Reset rank table";
  reset.addEventListener("click", () => {
    state.organRanks = sanitizeWebGpuSynthOrganRanks(WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS);
    state.presetId = "custom";
    engine?.updateOrganRanks(state.organRanks);
    syncOrganRankInputs();
    syncPressedStates();
    announce("Additive rank table reset.");
  });
  $("organRankControls").replaceChildren(
    ...Array.from({ length: WEBGPU_SYNTHS_ORGAN_RANK_COUNT }, (_, index) => createOrganRankRow(index)),
    reset,
  );
}

function renderEffectsControls() {
  $("effectsControls").replaceChildren(...EFFECT_CONTROL_SECTIONS.map((section) => {
    const module = document.createElement("section");
    module.className = "effect-module";
    const heading = document.createElement("h3");
    heading.textContent = section.label;
    const detail = document.createElement("small");
    detail.textContent = section.detail;
    module.append(heading, detail, ...section.keys.map((key) => createRangeControl(CONTROL_BY_KEY.get(key))));
    return module;
  }));
}

function renderControls() {
  for (const [group, specs] of Object.entries(CONTROL_GROUPS)) {
    if (group === "effects") continue;
    $(`${group}Controls`).replaceChildren(...specs.map((spec) => (
      spec.type === "select" ? createSelectControl(spec) : createRangeControl(spec)
    )));
  }
  $("knobControls").replaceChildren(...KNOB_ORDER.map(createKnobControl));
  renderOrganRankControls();
  renderEffectsControls();
  $("laneButtons").replaceChildren(...LANE_SPECS.map((lane, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${lane.label} · ${lane.description}`;
    button.style.setProperty("--lane-color", lane.color);
    button.setAttribute("aria-pressed", String(index === state.activeLane));
    button.addEventListener("click", () => selectSequenceLane(index));
    return button;
  }));
  $("modelRail").replaceChildren(...WEBGPU_SYNTHS_MODELS.map((model, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-node";
    button.dataset.model = String(index);
    button.style.setProperty("--model-color", MODEL_COLORS[index]);
    const name = document.createElement("b");
    name.textContent = model;
    const detail = document.createElement("small");
    detail.textContent = MODEL_DETAILS[index];
    button.append(name, detail);
    button.addEventListener("click", () => {
      changeParam("topology", index);
      announce(`${model} synthesis model selected.`);
    });
    return button;
  }));
  $("presetButtons").replaceChildren(...PRESETS.map((presetDefinition) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.preset = presetDefinition.id;
    button.textContent = presetDefinition.label;
    button.addEventListener("click", () => applyPreset(presetDefinition));
    return button;
  }));
  $("techniqueButtons").replaceChildren(...TECHNIQUES.map((technique) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.technique = technique.id;
    button.textContent = technique.label;
    button.addEventListener("click", () => applyTechnique(technique));
    return button;
  }));
  syncReadouts();
  syncPressedStates();
}

function setRuntimeState() {
  $("chunkDurationOut").textContent = `${Math.round(state.chunkDuration * 1000)} ms`;
  $("workgroupSizeOut").textContent = `${state.workgroupSize} lanes`;
  $("runtimeState").textContent = `${state.workgroupSize} lanes`;
}

function setSupportState() {
  if (state.audioOn && engine) {
    $("gpuState").textContent = "WGSL streaming";
    $("streamState").textContent = `${Math.round(engine.chunkDurationInSeconds * 1000)} ms finished stereo buffers`;
  } else if (!support.audio) {
    $("gpuState").textContent = "Buffer playback unavailable";
    $("streamState").textContent = "AudioContext missing";
  } else if (!support.webgpu) {
    $("gpuState").textContent = "WebGPU unavailable";
    $("streamState").textContent = "navigator.gpu missing";
  } else {
    $("gpuState").textContent = "WebGPU ready";
    $("streamState").textContent = "Ready for GPU buffer rendering";
  }
  $("audioButton").disabled = !support.supported || Boolean(audioStartPromise);
  $("synthPlayButton").disabled = !support.supported || Boolean(audioStartPromise);
}

function paintAudioReadout() {
  $("engineBadge").textContent = state.audioOn
    ? state.synthPlaying ? "WGSL synthesis running" : "WGSL synthesis ready"
    : "six synthesis models · two GPU passes";
  $("stageReadout").textContent = state.audioOn
    ? `WEBGPU · ${Math.round(engine?.sampleRate ?? 44100)} HZ · ${state.synthPlaying ? "SEQUENCE PLAYING" : "SEQUENCE PAUSED"}`
    : "WEBGPU · STANDBY · AUDIO OFF";
  $("sequenceStage").setAttribute("aria-label", `Editable four-lane GPU sequence. Click to add, drag vertically to change height, and double-click Pitch or Pulse to remove a note. Audio ${state.audioOn ? "on" : "off"}.`);
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  if (enabled && engine) {
    $("gpuState").textContent = "WGSL streaming";
    $("streamState").textContent = `${Math.round(engine.chunkDurationInSeconds * 1000)} ms finished stereo buffers`;
  } else setSupportState();
  paintAudioReadout();
  setSynthPlayState(state.synthPlaying, { quiet: true });
}

function setSynthPlayState(enabled, { quiet = false } = {}) {
  state.synthPlaying = Boolean(enabled && state.audioOn);
  engine?.setPlaybackEnabled(state.synthPlaying);
  $("synthPlayButton").setAttribute("aria-pressed", String(state.synthPlaying));
  $("synthPlayButton").textContent = state.synthPlaying ? "Pause sequence" : "Play sequence";
  paintAudioReadout();
  if (!quiet) announce(state.synthPlaying ? "WGSL sequence playing." : "WGSL sequence paused.");
}

async function startAudio() {
  if (state.audioOn && engine?.context) return true;
  if (audioStartPromise) return audioStartPromise;
  clearError();
  const generation = audioGeneration;
  const nextEngine = new WebGpuSynthLabAudio(globalThis, {
    chunkDuration: state.chunkDuration,
    workgroupSize: state.workgroupSize,
  });
  nextEngine.sequence = state.sequence;
  nextEngine.organRanks = state.organRanks;
  nextEngine.setOutput(Number($("output").value));
  nextEngine.setPlaybackEnabled(state.synthPlaying);
  nextEngine.setErrorHandler((error) => {
    showError(error);
    setSynthPlayState(false, { quiet: true });
    setAudioState(false);
    setTimeout(() => { if (engine === nextEngine) void stopAudio({ quiet: true }); }, 0);
  });
  engine = nextEngine;
  let pending;
  pending = nextEngine.start(state.params).then((context) => {
    if (generation !== audioGeneration || engine !== nextEngine || context !== nextEngine.context) {
      void nextEngine.stop();
      return false;
    }
    nextEngine.updateSequence(state.sequence);
    nextEngine.updateOrganRanks(state.organRanks);
    nextEngine.setOutput(Number($("output").value));
    nextEngine.setPlaybackEnabled(state.synthPlaying);
    setAudioState(true);
    announce("WebGPU shader initialized; finished stereo buffer stream ready.");
    return true;
  }).catch((error) => {
    if (engine === nextEngine) engine = null;
    setAudioState(false);
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
    setSupportState();
  });
  audioStartPromise = pending;
  setSupportState();
  return pending;
}

async function stopAudio({ quiet = false } = {}) {
  audioGeneration += 1;
  if (state.synthPlaying) setSynthPlayState(false, { quiet: true });
  const previous = engine;
  engine = null;
  audioStartPromise = null;
  if (previous) await previous.stop();
  setAudioState(false);
  if (!quiet) announce("GPU Shader Synths audio off.");
}

async function toggleAudio() {
  if (state.audioOn) await stopAudio();
  else await startAudio();
}

function toggleSynthPlay() {
  if (!state.audioOn) {
    announce("Turn Audio on before playing the WGSL sequence.");
    return;
  }
  setSynthPlayState(!state.synthPlaying);
}

async function restartAudio() {
  if (!state.audioOn) return;
  const wasPlaying = state.synthPlaying;
  await stopAudio({ quiet: true });
  state.synthPlaying = wasPlaying;
  await startAudio();
  setSynthPlayState(wasPlaying, { quiet: true });
}

function outputChanged() {
  const value = clamp($("output").value, 0, 1);
  $("outputOut").textContent = `${Math.round(value * 100)}%`;
  engine?.setOutput(value);
}

function runtimeChanged() {
  state.chunkDuration = clamp($("chunkDuration").value, 0.03, 0.25);
  state.workgroupSize = WEBGPU_SYNTHS_WORKGROUP_SIZES.includes(Number($("workgroupSize").value))
    ? Number($("workgroupSize").value)
    : WEBGPU_SYNTHS_RUNTIME_DEFAULTS.workgroupSize;
  setRuntimeState();
}

function varyLane(lane) {
  const amount = 0.08 + state.params.chaos * 0.28;
  applySequence(varyWebGpuSynthSequence(state.sequence, lane, amount, state.params.seed + performance.now()));
  announce(`${lane === "all" ? "All control lanes" : `${lane} lane`} varied.`);
}

function rotateSequence(direction) {
  const steps = state.params.steps;
  const active = state.sequence.slice(0, steps);
  const amount = ((direction % steps) + steps) % steps;
  const rotated = [...active.slice(steps - amount), ...active.slice(0, steps - amount)];
  applySequence([...rotated, ...state.sequence.slice(steps)]);
  announce(`Sequence rotated ${direction > 0 ? "right" : "left"}.`);
}

function reverseSequence() {
  const steps = state.params.steps;
  applySequence([...state.sequence.slice(0, steps).reverse(), ...state.sequence.slice(steps)]);
  announce("Sequence direction reversed.");
}

function invertActiveLane() {
  const steps = state.params.steps;
  const next = state.sequence.map((step, index) => (
    index < steps ? step.map((value, lane) => lane === state.activeLane ? 1 - value : value) : step
  ));
  applySequence(next);
  announce(`${LANE_SPECS[state.activeLane].label} lane inverted.`);
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(320, Math.round(rect.width * pixelRatio));
  const height = Math.max(280, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, pixelRatio };
}

function laneMetrics(width, height) {
  const top = height * 0.34;
  const bottom = height * 0.92;
  const gap = Math.max(6, height * 0.012);
  const heightEach = (bottom - top - gap * 3) / 4;
  return { top, bottom, gap, heightEach, width };
}

function visualTime() {
  if (!state.synthPlaying) return state.visualHoldTime;
  const playback = engine?.currentPlaybackTime?.();
  if (playback !== null && playback !== undefined) {
    state.visualHoldTime = playback;
    return playback;
  }
  return state.visualHoldTime;
}

function drawModelGraphic(context, width, height, time) {
  const centerX = width * 0.73;
  const centerY = height * 0.18;
  const topology = state.params.topology;
  const lower = Math.floor(topology);
  const color = MODEL_COLORS[lower];
  context.save();
  context.globalCompositeOperation = "lighter";
  for (let ring = 0; ring < 7; ring += 1) {
    const points = 36;
    const radius = height * (0.025 + ring * 0.013) * (0.8 + state.params.complexity * 0.5);
    context.beginPath();
    for (let point = 0; point <= points; point += 1) {
      const angle = (point / points) * Math.PI * 2;
      const deformation = Math.sin(angle * (2 + lower) + time * (0.2 + state.params.motion) + ring) * radius * (0.08 + state.params.chaos * 0.28);
      const x = centerX + Math.cos(angle) * (radius + deformation) * (1 + state.params.space * 0.5);
      const y = centerY + Math.sin(angle) * (radius + deformation);
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = `${color}${Math.round((0.1 + ring * 0.035) * 255).toString(16).padStart(2, "0")}`;
    context.lineWidth = 1 + (ring === Math.round(topology) ? 1 : 0);
    context.stroke();
  }
  context.restore();
}

function drawLanes(context, width, height, time) {
  const { top, gap, heightEach } = laneMetrics(width, height);
  const steps = state.params.steps;
  const cellWidth = width / steps;
  const activeStep = Math.floor(time * state.params.clock) % steps;
  for (const [laneIndex, lane] of LANE_SPECS.entries()) {
    const y = top + laneIndex * (heightEach + gap);
    context.fillStyle = laneIndex === state.activeLane ? `${lane.color}12` : "rgba(255,255,255,0.018)";
    context.fillRect(0, y, width, heightEach);
    context.strokeStyle = laneIndex === state.activeLane ? `${lane.color}52` : "rgba(255,255,255,0.08)";
    context.strokeRect(0.5, y + 0.5, width - 1, heightEach - 1);
    context.fillStyle = `${lane.color}b8`;
    context.font = `${Math.max(8, height * 0.018)}px ui-monospace, monospace`;
    context.fillText(lane.label.toUpperCase(), 9, y + 14);
    if (laneIndex === 1) {
      for (let step = 0; step < steps; step += 1) {
        const value = state.sequence[step][laneIndex];
        const valueY = y + heightEach - value * (heightEach - 8) - 4;
        const barWidth = Math.max(1, cellWidth - 3);
        context.fillStyle = value <= 0.01 ? "rgba(255,255,255,0.035)" : `${lane.color}${step === activeStep ? "f2" : "72"}`;
        context.fillRect(step * cellWidth + 1.5, valueY, barWidth, y + heightEach - 4 - valueY);
      }
    } else {
      context.beginPath();
      for (let step = 0; step < steps; step += 1) {
        const value = state.sequence[step][laneIndex];
        const x = (step + 0.5) * cellWidth;
        const valueY = y + heightEach - value * (heightEach - 8) - 4;
        if (step === 0) context.moveTo(x, valueY);
        else context.lineTo(x, valueY);
      }
      context.strokeStyle = `${lane.color}${laneIndex === state.activeLane ? "d8" : "78"}`;
      context.lineWidth = laneIndex === state.activeLane ? 2 : 1;
      context.stroke();
    }
    if (laneIndex === 0) {
      for (let step = 0; step < steps; step += 1) {
        if (state.sequence[step][1] <= 0.01) continue;
        const x = (step + 0.5) * cellWidth;
        const value = state.sequence[step][laneIndex];
        const valueY = y + heightEach - value * (heightEach - 8) - 4;
        context.fillStyle = `${lane.color}${step === activeStep ? "ff" : "c8"}`;
        context.beginPath();
        context.arc(x, valueY, step === activeStep ? 4 : 2.6, 0, Math.PI * 2);
        context.fill();
      }
    } else if (laneIndex !== 1) {
      const value = state.sequence[activeStep][laneIndex];
      const x = (activeStep + 0.5) * cellWidth;
      const valueY = y + heightEach - value * (heightEach - 8) - 4;
      context.fillStyle = lane.color;
      context.beginPath();
      context.arc(x, valueY, 2.5, 0, Math.PI * 2);
      context.fill();
    }
  }
  const playheadX = (activeStep + 0.5) * cellWidth;
  context.save();
  context.strokeStyle = "rgba(255,255,255,0.9)";
  context.shadowBlur = 18;
  context.shadowColor = MODEL_COLORS[Math.round(state.params.topology)];
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(playheadX, top - 5);
  context.lineTo(playheadX, height * 0.94);
  context.stroke();
  context.restore();
}

function draw() {
  const canvas = $("sequenceStage");
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = resizeCanvas(canvas);
  const time = visualTime();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#06070a";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(116,247,255,0.055)";
  context.lineWidth = 1;
  for (let x = 0; x < width; x += 32) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = 0; y < height; y += 32) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  drawModelGraphic(context, width, height, time);
  drawLanes(context, width, height, time);
  animationFrame = requestAnimationFrame(draw);
}

function sequencePointerPosition(event, { laneIndex = null, stepIndex = null } = {}) {
  const canvas = $("sequenceStage");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const metrics = laneMetrics(rect.width, rect.height);
  const localY = event.clientY - rect.top;
  let selectedLane = laneIndex;
  if (!Number.isInteger(selectedLane)) {
    const laneStride = metrics.heightEach + metrics.gap;
    selectedLane = Math.floor((localY - metrics.top) / laneStride);
    const candidateY = metrics.top + selectedLane * laneStride;
    if (selectedLane < 0 || selectedLane >= LANE_SPECS.length || localY < candidateY || localY > candidateY + metrics.heightEach) return null;
  }
  const laneY = metrics.top + selectedLane * (metrics.heightEach + metrics.gap);
  const value = clamp(1 - ((localY - laneY) / metrics.heightEach), 0, 1);
  const selectedStep = Number.isInteger(stepIndex)
    ? stepIndex
    : Math.min(state.params.steps - 1, Math.floor(clamp((event.clientX - rect.left) / rect.width, 0, 0.9999) * state.params.steps));
  return { laneIndex: selectedLane, stepIndex: selectedStep, value };
}

function editSequenceLane(event) {
  const position = sequencePointerPosition(event, { laneIndex: state.editingLane, stepIndex: state.editingStep });
  if (!position) return;
  const next = state.sequence.map((stepValues) => [...stepValues]);
  next[position.stepIndex][position.laneIndex] = event.shiftKey ? 0 : position.value;
  if (position.laneIndex === 0 && next[position.stepIndex][1] <= 0.01) {
    next[position.stepIndex][1] = 0.82;
  }
  state.techniqueId = "custom";
  applySequence(next);
}

function handlePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const position = sequencePointerPosition(event);
  if (!position) return;
  event.preventDefault();
  state.editing = true;
  state.editingLane = position.laneIndex;
  state.editingStep = position.stepIndex;
  selectSequenceLane(position.laneIndex, { quiet: true });
  $("sequenceStage").setPointerCapture?.(event.pointerId);
  editSequenceLane(event);
}

function handlePointerMove(event) {
  if (!state.editing) return;
  event.preventDefault();
  editSequenceLane(event);
}

function handlePointerEnd(event) {
  if (!state.editing) return;
  const editedLane = state.editingLane;
  state.editing = false;
  state.editingLane = null;
  state.editingStep = null;
  $("sequenceStage").releasePointerCapture?.(event.pointerId);
  announce(`${LANE_SPECS[editedLane ?? state.activeLane].label} sequence lane edited.`);
}

function removeSequenceNote(event) {
  const position = sequencePointerPosition(event);
  if (!position || position.laneIndex > 1) return;
  event.preventDefault();
  const next = state.sequence.map((stepValues) => [...stepValues]);
  next[position.stepIndex][1] = 0;
  state.techniqueId = "custom";
  applySequence(next);
  announce(`Sequence note ${position.stepIndex + 1} removed.`);
}

renderControls();
setRuntimeState();
setSupportState();
outputChanged();

$("audioButton").addEventListener("click", () => { void toggleAudio(); });
$("synthPlayButton").addEventListener("click", toggleSynthPlay);
$("output").addEventListener("input", outputChanged);
$("chunkDuration").addEventListener("input", runtimeChanged);
$("chunkDuration").addEventListener("change", () => { void restartAudio(); });
$("workgroupSize").addEventListener("change", () => { runtimeChanged(); void restartAudio(); });
$("resetPatch").addEventListener("click", () => {
  state.organRanks = sanitizeWebGpuSynthOrganRanks(WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS);
  engine?.updateOrganRanks(state.organRanks);
  syncOrganRankInputs();
  applyPreset(PRESETS[0]);
});
$("rotateLeft").addEventListener("click", () => rotateSequence(-1));
$("rotateRight").addEventListener("click", () => rotateSequence(1));
$("reverseSequence").addEventListener("click", reverseSequence);
$("invertLane").addEventListener("click", invertActiveLane);
for (const button of document.querySelectorAll("[data-vary]")) {
  button.addEventListener("click", () => varyLane(button.dataset.vary));
}
$("sequenceStage").addEventListener("pointerdown", handlePointerDown);
$("sequenceStage").addEventListener("pointermove", handlePointerMove);
$("sequenceStage").addEventListener("pointerup", handlePointerEnd);
$("sequenceStage").addEventListener("pointercancel", handlePointerEnd);
$("sequenceStage").addEventListener("dblclick", removeSequenceNote);
animationFrame = requestAnimationFrame(draw);

globalThis.addEventListener?.("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  void stopAudio({ quiet: true });
});
