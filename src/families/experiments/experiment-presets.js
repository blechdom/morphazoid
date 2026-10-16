import { presetStateKey } from "../../site/header-presets.js";
import { clonePresetData, presetRandom } from "../../site/preset-random.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const decimals = value => (String(value).split(".")[1] ?? "").length;
const sigmoid = value => 1 / (1 + Math.exp(-value));
const round3 = value => Math.round(value * 1000) / 1000;

const range = (min, max, step, lo = min, hi = max) => ({ kind: "range", min, max, step, lo, hi });
const flag = () => ({ kind: "flag" });
const choice = values => ({ kind: "choice", values });
const tuple = (...fields) => ({ kind: "tuple", fields });
const matrix = (rows, cols, limit) => ({ kind: "matrix", rows, cols, limit });
const vector = (length, limit) => ({ kind: "vector", length, limit });
const dna = () => ({ kind: "dna" });

const isIntegerGrid = field => field.step === 1 && Number.isInteger(field.min);
const isFiniteIn = (value, limit) => Number.isFinite(value) && Math.abs(value) <= limit;

function fieldValid(field, value) {
  switch (field.kind) {
    case "range":
      return Number.isFinite(value) && value >= field.min && value <= field.max
        && (!isIntegerGrid(field) || Number.isInteger(value));
    case "flag": return typeof value === "boolean";
    case "choice": return field.values.includes(value);
    case "tuple": return Array.isArray(value) && value.length === field.fields.length
      && field.fields.every((item, index) => fieldValid(item, value[index]));
    case "matrix": return Array.isArray(value) && value.length === field.rows
      && value.every(row => Array.isArray(row) && row.length === field.cols && row.every(cell => isFiniteIn(cell, field.limit)));
    case "vector": return Array.isArray(value) && value.length === field.length && value.every(cell => isFiniteIn(cell, field.limit));
    case "dna": return typeof value === "string" && /^[ACGT]{3,120}$/.test(value);
    default: return false;
  }
}

function snapField(field, value) {
  switch (field.kind) {
    case "range": {
      const steps = Math.round((clamp(value, field.min, field.max) - field.min) / field.step);
      return Math.min(field.max, Number((field.min + steps * field.step).toFixed(Math.max(decimals(field.step), decimals(field.min)))));
    }
    case "tuple": return field.fields.map((item, index) => snapField(item, value[index]));
    case "matrix": return value.map(row => row.map(cell => round3(clamp(cell, -field.limit, field.limit))));
    case "vector": return value.map(cell => round3(clamp(cell, -field.limit, field.limit)));
    default: return value;
  }
}

const STOP_CODONS = new Set(["TAA", "TAG", "TGA"]);

function drawDna(rng) {
  const gc = rng.between(0.2, 0.8);
  const base = () => (rng.unit() < gc ? "GC" : "AT")[rng.integer(0, 1)];
  const codons = [];
  const length = rng.integer(5, 30);
  while (codons.length < length) {
    const codon = base() + base() + base();
    if (!STOP_CODONS.has(codon)) codons.push(codon);
  }
  return `ATG${codons.join("")}${rng.pick([...STOP_CODONS])}`;
}

function drawField(field, rng) {
  switch (field.kind) {
    case "range": return snapField(field, rng.between(field.lo, field.hi));
    case "flag": return rng.unit() < 0.5;
    case "choice": return rng.pick(field.values);
    case "tuple": return field.fields.map(item => drawField(item, rng));
    case "matrix": return Array.from({ length: field.rows }, () => Array.from({ length: field.cols }, () => round3(rng.between(-field.limit, field.limit))));
    case "vector": return Array.from({ length: field.length }, () => round3(rng.between(-field.limit, field.limit)));
    case "dna": return drawDna(rng);
    default: throw new TypeError("Unknown preset field");
  }
}

function defineExperiment({ experiment, id, fields, defaults, scenes, constrain, check, read, constant = [] }) {
  const keys = Object.keys(fields);
  const validate = snapshot => {
    presetStateKey(snapshot);
    if (!snapshot || Object.keys(snapshot).length !== keys.length || keys.some(key => !Object.hasOwn(snapshot, key))) {
      throw new TypeError(`Incomplete ${id} preset`);
    }
    for (const key of keys) if (!fieldValid(fields[key], snapshot[key])) throw new TypeError(`Invalid ${id} ${key}`);
    check?.(snapshot);
    return snapshot;
  };
  const capture = state => clonePresetData(Object.fromEntries(keys.map(key => [key, read?.(state, key) ?? state[key]])));
  const scene = (sceneId, label, overrides = {}) => {
    const merged = { ...defaults, ...overrides };
    const snapshot = Object.fromEntries(keys.map(key => [key, snapField(fields[key], merged[key])]));
    return Object.freeze({ id: sceneId, label, snapshot: Object.freeze(validate(snapshot)) });
  };
  const presets = Object.freeze(scenes.map(([sceneId, label, overrides]) => scene(sceneId, label, overrides)));
  const bankKeys = new Set(presets.map(preset => presetStateKey(preset.snapshot)));
  const randomize = (current, random = Math.random) => {
    const rng = presetRandom(random);
    const before = presetStateKey(current);
    for (let attempt = 0; attempt < 8; attempt++) {
      const draft = Object.fromEntries(keys.map(key => [key, drawField(fields[key], rng)]));
      constrain?.(draft, rng);
      const snapshot = validate(Object.fromEntries(keys.map(key => [key, snapField(fields[key], draft[key])])));
      const key = presetStateKey(snapshot);
      if (key !== before && !bankKeys.has(key)) return snapshot;
    }
    throw new Error(`Could not randomize ${id}`);
  };
  return Object.freeze({ experiment, id, fields, keys, constant, presets, capture, validate, randomize });
}

function neuralForward(weights, biases, gain, inputIndex) {
  const input = [0, 1, 2, 3].map(index => (index === inputIndex ? 1 : 0.08));
  const layer = (matrixValue, biasValue, source) => matrixValue.map((row, index) => (
    sigmoid((row.reduce((sum, weight, from) => sum + weight * source[from], biasValue[index])) * gain)));
  const hidden = layer(weights[0], biases[0], input);
  return { hidden, output: layer(weights[1], biases[1], hidden) };
}

function neuralThreshold(weights, biases, gain, inputIndex) {
  const { hidden, output } = neuralForward(weights, biases, gain, inputIndex);
  return Math.min(Math.max(...hidden), Math.max(...output));
}

function seededUnit(seed) {
  let value = seed >>> 0;
  return () => { value = (1664525 * value + 1013904223) >>> 0; return value / 0x100000000; };
}

function neuralNetwork(seed, pattern, weightScale, biasScale) {
  const unit = seededUnit(seed);
  const signed = () => unit() * 2 - 1;
  const first = Array.from({ length: 6 }, (_, hiddenIndex) => Array.from({ length: 4 }, (__, source) => {
    if (pattern === "routes") return hiddenIndex % 4 === source ? weightScale : signed() * 0.25 * weightScale;
    if (pattern === "excitatory") return unit() * weightScale;
    if (pattern === "inhibitory") return -unit() * weightScale * (source === hiddenIndex % 4 ? 0.2 : 1);
    if (pattern === "sparse") return unit() < 0.3 ? signed() * weightScale : 0;
    return signed() * weightScale;
  }));
  const second = Array.from({ length: 3 }, (_, outputIndex) => Array.from({ length: 6 }, (__, source) => {
    if (pattern === "routes") return source % 3 === outputIndex ? weightScale : signed() * 0.2 * weightScale;
    if (pattern === "excitatory") return unit() * weightScale;
    if (pattern === "inhibitory") return source % 3 === outputIndex ? weightScale : -unit() * weightScale * 0.6;
    if (pattern === "sparse") return unit() < 0.4 ? signed() * weightScale : 0;
    return signed() * weightScale;
  }));
  return {
    neuralWeights: [first, second],
    neuralBiases: [
      Array.from({ length: 6 }, () => signed() * biasScale),
      Array.from({ length: 3 }, () => signed() * biasScale),
    ],
  };
}

const neuralScene = (id, label, { seed, pattern, weightScale = 1, biasScale = 0.25, input = 0, gain = 1.4, rate = 1, noise = 0.08, share = 0.8 }) => {
  const network = neuralNetwork(seed, pattern, weightScale, biasScale);
  const weights = network.neuralWeights.map(layer => layer.map(row => row.map(round3)));
  const biases = network.neuralBiases.map(layer => layer.map(round3));
  const threshold = clamp(Math.floor(neuralThreshold(weights, biases, gain, input) * share * 100) / 100, 0.1, 0.9);
  return [id, label, {
    neuralWeights: weights, neuralBiases: biases, neuralInput: input, neuralGain: gain, neuralRate: rate, neuralNoise: noise, neuralThreshold: threshold,
  }];
};

const gray = (feed, offset) => Number((Math.sqrt(feed) / 2 - feed + offset).toFixed(4));

const CHLADNI_MINIMUM_EXCITATION = 0.25;
const chladniValue = (x, y, n, m) => Math.sin(n * Math.PI * x) * Math.sin(m * Math.PI * y);

export const EXPERIMENT_PRESET_SPECS = Object.freeze({
  moire: defineExperiment({
    experiment: "moire", id: "moire-organ",
    fields: {
      moireInterval: range(0.1, 2, 0.01, 0.25, 1.6), moireVoices: range(4, 12, 1), moireUpAngle: range(0, 30, 0.1, 0.5, 18),
      moireDownAngle: range(0, 30, 0.1, 0.5, 18), moireSecondPair: flag(), moireLayerOffset: range(0, 4, 0.01, 0.2, 3),
      moireOverlap: range(0, 2, 0.01, 0.15, 1.6), moireTone: range(55, 440, 1, 70, 330),
    },
    defaults: { moireInterval: 1, moireVoices: 8, moireUpAngle: 4, moireDownAngle: 4, moireSecondPair: false, moireLayerOffset: 0.6, moireOverlap: 0.65, moireTone: 164 },
    scenes: [
      ["classic-risset", "Classic Risset glide"],
      ["slow-tide", "Slow tide", { moireUpAngle: 1.2, moireDownAngle: 1.2, moireTone: 110, moireOverlap: 0.9, moireVoices: 10 }],
      ["fast-ascent", "Fast ascent", { moireUpAngle: 22, moireDownAngle: 3, moireTone: 220 }],
      ["counter-rotation", "Counter-rotation", { moireUpAngle: 12, moireDownAngle: 12, moireInterval: 0.5, moireVoices: 12 }],
      ["four-lattices", "Four lattices", { moireSecondPair: true, moireLayerOffset: 1.2, moireVoices: 8, moireTone: 147 }],
      ["tritone-mist", "Tritone mist", { moireInterval: 0.5, moireVoices: 12, moireOverlap: 1.4, moireUpAngle: 2, moireDownAngle: 2.5, moireTone: 130 }],
      ["deep-organ", "Deep organ", { moireTone: 60, moireVoices: 12, moireInterval: 0.33, moireUpAngle: 0.8, moireDownAngle: 1.4, moireOverlap: 1.1 }],
      ["bright-shimmer", "Bright shimmer", { moireTone: 330, moireVoices: 6, moireInterval: 1.5, moireUpAngle: 9, moireDownAngle: 6, moireOverlap: 0.3 }],
      ["beating-pair", "Beating pair", { moireUpAngle: 5, moireDownAngle: 5.3, moireOverlap: 0.8, moireTone: 196 }],
      ["wide-cathedral", "Wide cathedral", { moireInterval: 2, moireVoices: 5, moireSecondPair: true, moireLayerOffset: 2.5, moireOverlap: 1.2, moireTone: 98 }],
      ["stuttering-gate", "Stuttering gate", { moireOverlap: 0.15, moireUpAngle: 28, moireDownAngle: 17, moireVoices: 4, moireTone: 247 }],
      ["frozen-lattice", "Frozen lattice", { moireUpAngle: 0, moireDownAngle: 0.1, moireOverlap: 0.55, moireTone: 147, moireInterval: 0.75 }],
      ["dual-drift", "Dual drift", { moireSecondPair: true, moireLayerOffset: 0.25, moireUpAngle: 3, moireDownAngle: 7.5, moireTone: 185 }],
    ],
  }),
  chladni: defineExperiment({
    experiment: "chladni", id: "chladni-plate",
    fields: {
      chladniN: range(1, 8, 1), chladniM: range(1, 8, 1), excitationX: range(0.02, 0.98, 0.01),
      excitationY: range(0.02, 0.98, 0.01), chladniDrive: range(0, 1, 0.01, 0.2, 1),
    },
    defaults: { chladniN: 3, chladniM: 2, excitationX: 0.62, excitationY: 0.37, chladniDrive: 0.68 },
    check: s => {
      if (Math.abs(chladniValue(s.excitationX, s.excitationY, s.chladniN, s.chladniM)) < 0.1) throw new TypeError("Chladni excitation sits on a nodal line");
    },
    constrain: (draft, rng) => {
      const hundredth = value => Math.round(value * 100) / 100;
      const loud = () => Math.abs(chladniValue(hundredth(draft.excitationX), hundredth(draft.excitationY), draft.chladniN, draft.chladniM)) >= CHLADNI_MINIMUM_EXCITATION;
      for (let attempt = 0; attempt < 24 && !loud(); attempt++) {
        draft.excitationX = rng.between(0.02, 0.98);
        draft.excitationY = rng.between(0.02, 0.98);
      }
      if (!loud()) {
        draft.excitationX = (rng.integer(0, draft.chladniN - 1) + 0.5) / draft.chladniN;
        draft.excitationY = (rng.integer(0, draft.chladniM - 1) + 0.5) / draft.chladniM;
      }
    },
    scenes: [
      ["factory-mode", "Mode 3:2 factory"],
      ["fundamental", "Fundamental", { chladniN: 1, chladniM: 1, excitationX: 0.5, excitationY: 0.5, chladniDrive: 0.6 }],
      ["square-dance", "Square dance", { chladniN: 2, chladniM: 2, excitationX: 0.25, excitationY: 0.25, chladniDrive: 0.7 }],
      ["cross-hatch", "Cross hatch", { chladniN: 3, chladniM: 3, excitationX: 0.5, excitationY: 0.5, chladniDrive: 0.75 }],
      ["rising-lattice", "Rising lattice", { chladniN: 4, chladniM: 3, excitationX: 0.38, excitationY: 0.5, chladniDrive: 0.8 }],
      ["fine-sand", "Fine sand", { chladniN: 7, chladniM: 6, excitationX: 0.36, excitationY: 0.08, chladniDrive: 0.55 }],
      ["thin-ribbon", "Thin ribbon", { chladniN: 8, chladniM: 1, excitationX: 0.06, excitationY: 0.5, chladniDrive: 0.62 }],
      ["tall-drum", "Tall drum", { chladniN: 1, chladniM: 8, excitationX: 0.5, excitationY: 0.06, chladniDrive: 0.65 }],
      ["corner-strike", "Corner strike", { chladniN: 5, chladniM: 4, excitationX: 0.1, excitationY: 0.12, chladniDrive: 0.9 }],
      ["soft-mallet", "Soft mallet", { chladniN: 2, chladniM: 3, excitationX: 0.75, excitationY: 0.17, chladniDrive: 0.3 }],
      ["diagonal-weave", "Diagonal weave", { chladniN: 6, chladniM: 5, excitationX: 0.25, excitationY: 0.5, chladniDrive: 0.7 }],
      ["dense-mode", "Dense mode", { chladniN: 8, chladniM: 8, excitationX: 0.06, excitationY: 0.06, chladniDrive: 0.85 }],
      ["off-center-buzz", "Off-center buzz", { chladniN: 3, chladniM: 5, excitationX: 0.83, excitationY: 0.1, chladniDrive: 0.95 }],
    ],
  }),
  springs: defineExperiment({
    experiment: "springs", id: "spring-choir",
    fields: {
      springMasses: range(5, 28, 1), springStiffness: range(0.15, 1.4, 0.01, 0.2, 1.35),
      springDamping: range(0.002, 0.09, 0.001, 0.004, 0.07), springDrive: range(0, 0.8, 0.01, 0, 0.7),
    },
    defaults: { springMasses: 14, springStiffness: 0.72, springDamping: 0.028, springDrive: 0.18 },
    scenes: [
      ["chorus-line", "Chorus line"],
      ["tight-bell", "Tight bell", { springMasses: 6, springStiffness: 1.3, springDamping: 0.006, springDrive: 0.1 }],
      ["long-cable", "Long cable", { springMasses: 28, springStiffness: 0.3, springDamping: 0.012, springDrive: 0.25 }],
      ["rubber-string", "Rubber string", { springMasses: 10, springStiffness: 0.2, springDamping: 0.06, springDrive: 0.3 }],
      ["glass-harp", "Glass harp", { springMasses: 20, springStiffness: 1.2, springDamping: 0.004, springDrive: 0.05 }],
      ["heavy-drone", "Heavy drone", { springMasses: 8, springStiffness: 0.15, springDamping: 0.02, springDrive: 0.7 }],
      ["dense-swarm", "Dense swarm", { springMasses: 26, springStiffness: 0.9, springDamping: 0.035, springDrive: 0.45 }],
      ["quick-snap", "Quick snap", { springMasses: 12, springStiffness: 1.4, springDamping: 0.08, springDrive: 0 }],
      ["slow-motion", "Slow motion", { springMasses: 16, springStiffness: 0.18, springDamping: 0.003, springDrive: 0.1 }],
      ["ringing-octave", "Ringing octave", { springMasses: 5, springStiffness: 0.6, springDamping: 0.01, springDrive: 0.2 }],
      ["driven-wave", "Driven wave", { springMasses: 18, springStiffness: 0.5, springDamping: 0.05, springDrive: 0.8 }],
      ["soft-choir", "Soft choir", { springMasses: 22, springStiffness: 0.45, springDamping: 0.018, springDrive: 0.35 }],
      ["brittle-comb", "Brittle comb", { springMasses: 24, springStiffness: 1.35, springDamping: 0.002, springDrive: 0.02 }],
    ],
  }),
  gears: defineExperiment({
    experiment: "gears", id: "gear-ratio-drums",
    fields: {
      gearTeethA: range(5, 32, 1), gearTeethB: range(6, 40, 1), gearSpeed: range(0, 1.6, 0.01, 0.05, 1.4), gearAccent: range(0, 1, 0.01),
    },
    defaults: { gearTeethA: 12, gearTeethB: 20, gearSpeed: 0.2, gearAccent: 0.64 },
    constrain: draft => {
      if (draft.gearTeethA === draft.gearTeethB) draft.gearTeethB = draft.gearTeethA + 1;
    },
    scenes: [
      ["three-against-five", "Three against five"],
      ["lockstep", "Lockstep", { gearTeethA: 16, gearTeethB: 16, gearSpeed: 0.25 }],
      ["two-against-three", "Two against three", { gearTeethA: 12, gearTeethB: 18, gearSpeed: 0.3 }],
      ["fourths", "Three against four", { gearTeethA: 15, gearTeethB: 20, gearSpeed: 0.24 }],
      ["prime-clash", "Prime clash", { gearTeethA: 13, gearTeethB: 17, gearSpeed: 0.3 }],
      ["seven-five", "Seven against five", { gearTeethA: 14, gearTeethB: 10, gearSpeed: 0.18 }],
      ["fast-clockwork", "Fast clockwork", { gearTeethA: 8, gearTeethB: 24, gearSpeed: 1.2 }],
      ["slow-giants", "Slow giants", { gearTeethA: 30, gearTeethB: 40, gearSpeed: 0.06, gearAccent: 0.9 }],
      ["ticking", "Ticking", { gearTeethA: 9, gearTeethB: 30, gearSpeed: 0.8, gearAccent: 0.3 }],
      ["sevens", "Sevens", { gearTeethA: 21, gearTeethB: 35, gearSpeed: 0.35, gearAccent: 0.8 }],
      ["off-by-one", "Off by one", { gearTeethA: 19, gearTeethB: 20, gearSpeed: 0.22 }],
      ["seven-eight", "Seven against eight", { gearTeethA: 28, gearTeethB: 32, gearSpeed: 0.5 }],
      ["rapid-ratchet", "Rapid ratchet", { gearTeethA: 6, gearTeethB: 36, gearSpeed: 1.5, gearAccent: 1 }],
      ["gentle-gears", "Gentle gears", { gearTeethA: 10, gearTeethB: 25, gearSpeed: 0.12, gearAccent: 0.15 }],
    ],
  }),
  primes: defineExperiment({
    experiment: "primes", id: "prime-sieve",
    fields: {
      primeLimit: range(30, 240, 1, 40, 240), primeRate: range(1, 30, 0.5, 1.5, 28), primeRoot: range(55, 220, 1), primeSpread: range(0.5, 4, 0.1, 0.6, 3.8),
    },
    defaults: { primeLimit: 120, primeRate: 10, primeRoot: 92, primeSpread: 2.5 },
    scenes: [
      ["standard-sieve", "Standard sieve"],
      ["short-and-fast", "Short and fast", { primeLimit: 60, primeRate: 24, primeRoot: 110, primeSpread: 1.5 }],
      ["long-walk", "Long walk", { primeLimit: 240, primeRate: 6, primeRoot: 73, primeSpread: 3.2 }],
      ["slow-bells", "Slow bells", { primeLimit: 90, primeRate: 2, primeRoot: 130, primeSpread: 2 }],
      ["wide-leaps", "Wide leaps", { primeLimit: 150, primeRate: 12, primeRoot: 82, primeSpread: 4 }],
      ["narrow-murmur", "Narrow murmur", { primeLimit: 100, primeRate: 8, primeRoot: 98, primeSpread: 0.5 }],
      ["machine-gun", "Machine gun", { primeLimit: 200, primeRate: 30, primeRoot: 165, primeSpread: 2.8 }],
      ["deep-and-sparse", "Deep and sparse", { primeLimit: 240, primeRate: 3.5, primeRoot: 55, primeSpread: 3.6 }],
      ["bright-counting", "Bright counting", { primeLimit: 70, primeRate: 15, primeRoot: 196, primeSpread: 1.2 }],
      ["midrange-tune", "Midrange tune", { primeLimit: 130, primeRate: 9, primeRoot: 120, primeSpread: 2.2 }],
      ["sub-rumble", "Sub rumble", { primeLimit: 180, primeRate: 5, primeRoot: 56, primeSpread: 1 }],
      ["high-glitter", "High glitter", { primeLimit: 120, primeRate: 20, primeRoot: 215, primeSpread: 3.5 }],
      ["lazy-afternoon", "Lazy afternoon", { primeLimit: 45, primeRate: 1.5, primeRoot: 104, primeSpread: 2 }],
    ],
  }),
  lissajous: defineExperiment({
    experiment: "lissajous", id: "lissajous-orbits",
    fields: {
      lissajousX: range(1, 9, 1), lissajousY: range(1, 9, 1), lissajousPhase: range(0, 180, 1),
      lissajousRate: range(0.03, 0.6, 0.01, 0.04, 0.5), lissajousTone: range(30, 180, 1, 32, 170),
    },
    defaults: { lissajousX: 3, lissajousY: 2, lissajousPhase: 90, lissajousRate: 0.12, lissajousTone: 55 },
    constrain: draft => {
      if (draft.lissajousX === draft.lissajousY) draft.lissajousY = draft.lissajousX % 9 + 1;
    },
    scenes: [
      ["three-to-two", "Three to two"],
      ["unison-ellipse", "Unison ellipse", { lissajousX: 1, lissajousY: 1, lissajousPhase: 45, lissajousRate: 0.15, lissajousTone: 82 }],
      ["octave-figure", "Octave figure", { lissajousX: 2, lissajousY: 1, lissajousPhase: 90, lissajousRate: 0.1, lissajousTone: 65 }],
      ["fifth-sweep", "Fifth sweep", { lissajousX: 3, lissajousY: 2, lissajousPhase: 30, lissajousRate: 0.18, lissajousTone: 73 }],
      ["fourth-knot", "Fourth knot", { lissajousX: 4, lissajousY: 3, lissajousPhase: 60, lissajousTone: 73 }],
      ["major-sixth", "Major sixth", { lissajousX: 5, lissajousY: 3, lissajousPhase: 120, lissajousTone: 49 }],
      ["minor-seventh", "Minor seventh", { lissajousX: 9, lissajousY: 5, lissajousPhase: 90, lissajousRate: 0.08, lissajousTone: 41 }],
      ["knot-of-five", "Knot of five", { lissajousX: 5, lissajousY: 4, lissajousPhase: 15, lissajousRate: 0.2, lissajousTone: 98 }],
      ["wide-trefoil", "Wide trefoil", { lissajousX: 3, lissajousY: 1, lissajousPhase: 90, lissajousTone: 110 }],
      ["dense-weave", "Dense weave", { lissajousX: 7, lissajousY: 6, lissajousPhase: 45, lissajousRate: 0.06, lissajousTone: 130 }],
      ["fast-spin", "Fast spin", { lissajousX: 2, lissajousY: 3, lissajousPhase: 120, lissajousRate: 0.55, lissajousTone: 36 }],
      ["slow-star", "Slow star", { lissajousX: 7, lissajousY: 2, lissajousPhase: 75, lissajousRate: 0.04, lissajousTone: 60 }],
      ["eight-and-nine", "Eight and nine", { lissajousX: 8, lissajousY: 9, lissajousPhase: 5, lissajousRate: 0.3, lissajousTone: 150 }],
      ["tritone-loop", "Tritone loop", { lissajousX: 7, lissajousY: 5, lissajousPhase: 100, lissajousRate: 0.12, lissajousTone: 88 }],
    ],
  }),
  pendulums: defineExperiment({
    experiment: "pendulums", id: "pendulum-wave",
    fields: {
      pendulumCount: range(6, 24, 1), pendulumRephase: range(10, 60, 1), pendulumStep: range(1, 3, 1),
      pendulumSwing: range(5, 42, 1, 6, 40), pendulumTone: range(48, 180, 1, 50, 175),
    },
    defaults: { pendulumCount: 16, pendulumRephase: 30, pendulumStep: 1, pendulumSwing: 24, pendulumTone: 72 },
    scenes: [
      ["classic-wave", "Classic wave"],
      ["short-reunion", "Short reunion", { pendulumCount: 12, pendulumRephase: 12, pendulumSwing: 30, pendulumTone: 96 }],
      ["long-cycle", "Long cycle", { pendulumCount: 20, pendulumRephase: 60, pendulumSwing: 20, pendulumTone: 60 }],
      ["big-swing", "Big swing", { pendulumSwing: 42, pendulumTone: 80 }],
      ["tiny-swing", "Tiny swing", { pendulumCount: 24, pendulumRephase: 45, pendulumStep: 2, pendulumSwing: 8, pendulumTone: 110 }],
      ["double-step", "Double step", { pendulumStep: 2 }],
      ["triple-step", "Triple step", { pendulumCount: 18, pendulumRephase: 36, pendulumStep: 3, pendulumSwing: 26, pendulumTone: 130 }],
      ["sparse-six", "Sparse six", { pendulumCount: 6, pendulumRephase: 20, pendulumSwing: 35, pendulumTone: 150 }],
      ["dense-curtain", "Dense curtain", { pendulumCount: 24, pendulumRephase: 50, pendulumSwing: 16, pendulumTone: 54 }],
      ["quick-phasing", "Quick phasing", { pendulumCount: 10, pendulumRephase: 10, pendulumStep: 2, pendulumSwing: 28, pendulumTone: 120 }],
      ["low-drift", "Low drift", { pendulumCount: 14, pendulumRephase: 55, pendulumSwing: 12, pendulumTone: 48 }],
      ["high-bells", "High bells", { pendulumCount: 22, pendulumRephase: 25, pendulumStep: 3, pendulumSwing: 38, pendulumTone: 175 }],
      ["mid-canon", "Mid canon", { pendulumCount: 8, pendulumRephase: 40, pendulumStep: 2, pendulumSwing: 22, pendulumTone: 90 }],
    ],
  }),
  doublependulum: defineExperiment({
    experiment: "doublependulum", id: "double-pendulum",
    fields: {
      chaosGravity: range(1, 18, 0.1, 2, 17), chaosLength: range(0.5, 1.5, 0.01, 0.55, 1.45), chaosOffset: range(0.01, 2, 0.01, 0.02, 1.8),
      chaosSpeed: range(0.2, 2, 0.01, 0.25, 1.9), chaosTone: range(50, 220, 1, 52, 210),
    },
    defaults: { chaosGravity: 9.81, chaosLength: 1, chaosOffset: 0.35, chaosSpeed: 0.85, chaosTone: 92 },
    scenes: [
      ["butterfly", "Butterfly"],
      ["moon-gravity", "Moon gravity", { chaosGravity: 1.6, chaosTone: 70 }],
      ["heavy-planet", "Heavy planet", { chaosGravity: 18, chaosSpeed: 0.6, chaosTone: 120 }],
      ["long-forearm", "Long forearm", { chaosGravity: 9.8, chaosLength: 1.5, chaosOffset: 0.2, chaosSpeed: 0.8, chaosTone: 80 }],
      ["short-forearm", "Short forearm", { chaosGravity: 9.8, chaosLength: 0.5, chaosOffset: 0.5, chaosSpeed: 1, chaosTone: 140 }],
      ["hair-trigger", "Hair trigger", { chaosGravity: 9.8, chaosOffset: 0.01, chaosSpeed: 1.2, chaosTone: 100 }],
      ["wide-split", "Wide split", { chaosGravity: 9.8, chaosOffset: 2, chaosTone: 90 }],
      ["fast-chaos", "Fast chaos", { chaosGravity: 14, chaosLength: 0.9, chaosSpeed: 2, chaosTone: 160 }],
      ["slow-chaos", "Slow chaos", { chaosGravity: 5, chaosLength: 1.1, chaosOffset: 0.3, chaosSpeed: 0.2, chaosTone: 60 }],
      ["bass-swing", "Bass swing", { chaosGravity: 6.5, chaosLength: 1.3, chaosOffset: 0.8, chaosSpeed: 0.5, chaosTone: 52 }],
      ["treble-tumble", "Treble tumble", { chaosGravity: 16, chaosLength: 0.7, chaosOffset: 0.15, chaosSpeed: 1.6, chaosTone: 210 }],
      ["twin-drift", "Twin drift", { chaosGravity: 9.8, chaosOffset: 1, chaosSpeed: 1, chaosTone: 110 }],
      ["gentle-divergence", "Gentle divergence", { chaosGravity: 4, chaosLength: 0.8, chaosOffset: 0.05, chaosSpeed: 0.4, chaosTone: 75 }],
    ],
  }),
  reaction: defineExperiment({
    experiment: "reaction", id: "reaction-diffusion",
    fields: {
      reactionFeed: range(0.01, 0.09, 0.0001, 0.022, 0.075), reactionKill: range(0.045, 0.07, 0.0001),
      reactionDiffusion: range(0.2, 0.8, 0.01, 0.4, 0.5), reactionSpeed: range(0.2, 3, 0.1, 0.6, 2.8),
    },
    defaults: { reactionFeed: 0.0367, reactionKill: 0.0649, reactionDiffusion: 0.5, reactionSpeed: 1.2 },
    constrain: (draft, rng) => {
      const upper = 0.0055 * clamp((0.06 - draft.reactionFeed) / 0.02, 0, 1);
      draft.reactionKill = gray(draft.reactionFeed, rng.between(-0.002, upper));
    },
    scenes: [
      ["mitosis", "Mitosis"],
      ["coral", "Coral growth", { reactionFeed: 0.0545, reactionKill: 0.062 }],
      ["bubbles", "Bubbles", { reactionFeed: 0.078, reactionKill: 0.061, reactionDiffusion: 0.45 }],
      ["spots", "Spots", { reactionFeed: 0.03, reactionKill: 0.0625 }],
      ["maze", "Maze", { reactionFeed: 0.039, reactionKill: 0.058 }],
      ["worms", "Worms", { reactionFeed: 0.029, reactionKill: 0.057 }],
      ["solitons", "Solitons", { reactionFeed: 0.022, reactionKill: 0.051 }],
      ["negatons", "Negatons", { reactionFeed: 0.03, reactionKill: 0.062 }],
      ["fast-coral", "Fast coral", { reactionFeed: 0.0545, reactionKill: 0.062, reactionSpeed: 2.8 }],
      ["slow-mitosis", "Slow mitosis", { reactionDiffusion: 0.42, reactionSpeed: 0.6 }],
      ["broad-maze", "Broad maze", { reactionFeed: 0.039, reactionKill: 0.058, reactionDiffusion: 0.5, reactionSpeed: 1.8 }],
      ["fine-worms", "Fine worms", { reactionFeed: 0.029, reactionKill: 0.057, reactionDiffusion: 0.4, reactionSpeed: 2.4 }],
      ["restless-spots", "Restless spots", { reactionFeed: 0.026, reactionKill: 0.061, reactionDiffusion: 0.5, reactionSpeed: 2.6 }],
    ],
  }),
  orbitals: defineExperiment({
    experiment: "orbitals", id: "atomic-orbitals",
    fields: {
      orbitalN: range(1, 4, 1), orbitalL: range(0, 3, 1), orbitalM: range(0, 3, 1), orbitalScale: range(4, 18, 0.1, 5, 17),
      orbitalRotation: range(0, 360, 1), orbitalRate: range(0.02, 0.5, 0.01, 0.03, 0.45), orbitalTone: range(40, 200, 1, 45, 190),
    },
    defaults: { orbitalN: 2, orbitalL: 1, orbitalM: 1, orbitalScale: 10, orbitalRotation: 0, orbitalRate: 0.12, orbitalTone: 82 },
    check: s => {
      if (s.orbitalL >= s.orbitalN || s.orbitalM > s.orbitalL) throw new TypeError("Invalid orbital quantum numbers");
    },
    constrain: (draft, rng) => {
      draft.orbitalL = rng.integer(0, draft.orbitalN - 1);
      draft.orbitalM = rng.integer(0, draft.orbitalL);
    },
    scenes: [
      ["two-p", "2p dumbbell"],
      ["one-s", "1s ground state", { orbitalN: 1, orbitalL: 0, orbitalM: 0, orbitalScale: 6, orbitalRate: 0.08, orbitalTone: 70 }],
      ["two-s", "2s shell", { orbitalN: 2, orbitalL: 0, orbitalM: 0, orbitalScale: 9, orbitalRate: 0.1, orbitalTone: 78 }],
      ["two-p-axial", "2p axial", { orbitalN: 2, orbitalL: 1, orbitalM: 0, orbitalRotation: 45, orbitalTone: 90 }],
      ["three-s", "3s rings", { orbitalN: 3, orbitalL: 0, orbitalM: 0, orbitalScale: 14, orbitalRate: 0.15, orbitalTone: 64 }],
      ["three-p", "3p lobes", { orbitalN: 3, orbitalL: 1, orbitalM: 1, orbitalScale: 13, orbitalRotation: 30, orbitalTone: 100 }],
      ["three-d", "3d cloverleaf", { orbitalN: 3, orbitalL: 2, orbitalM: 2, orbitalScale: 13, orbitalRotation: 22, orbitalTone: 110 }],
      ["three-d-axial", "3d axial", { orbitalN: 3, orbitalL: 2, orbitalM: 0, orbitalScale: 12, orbitalRate: 0.2, orbitalTone: 120 }],
      ["four-f", "4f rosette", { orbitalN: 4, orbitalL: 3, orbitalM: 3, orbitalScale: 16, orbitalTone: 140 }],
      ["four-s", "4s onion", { orbitalN: 4, orbitalL: 0, orbitalM: 0, orbitalScale: 17, orbitalRate: 0.06, orbitalTone: 58 }],
      ["four-p", "4p tall", { orbitalN: 4, orbitalL: 1, orbitalM: 0, orbitalScale: 15, orbitalRotation: 90, orbitalTone: 72 }],
      ["four-d", "4d petals", { orbitalN: 4, orbitalL: 2, orbitalM: 1, orbitalScale: 15, orbitalRotation: 60, orbitalTone: 150 }],
      ["four-f-belts", "4f belts", { orbitalN: 4, orbitalL: 3, orbitalM: 1, orbitalScale: 16, orbitalRate: 0.3, orbitalTone: 175 }],
      ["three-d-spinning", "3d spinning", { orbitalN: 3, orbitalL: 2, orbitalM: 1, orbitalRotation: 90, orbitalRate: 0.45, orbitalTone: 85 }],
    ],
  }),
  dna: defineExperiment({
    experiment: "dna", id: "dna-translator",
    fields: {
      dnaSequence: dna(), dnaRate: range(1, 16, 0.1, 1.5, 14), dnaTone: range(55, 220, 1, 60, 210), dnaWindow: range(12, 36, 1), dnaTwist: range(0.5, 2, 0.01),
    },
    defaults: { dnaSequence: "ATGGCTTACGAACTGCCATTCGGTAACTAG", dnaRate: 5, dnaTone: 96, dnaWindow: 27, dnaTwist: 1 },
    scenes: [
      ["start-to-stop", "Start to stop"],
      ["gfp-head", "Fluorescent head", { dnaSequence: "ATGAGTAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTTAA", dnaRate: 6, dnaTone: 110 }],
      ["poly-a", "Poly-A drone", { dnaSequence: "ATGAAAAAAAAAAAAAAAAAAAAAAAAAAATAA", dnaRate: 4, dnaTone: 70, dnaTwist: 0.6 }],
      ["gc-rich", "GC rich", { dnaSequence: "ATGGCGGCCGGGCCCGCGGGCGCCGGGCGCTGA", dnaRate: 7, dnaTone: 130 }],
      ["at-rich", "AT rich", { dnaSequence: "ATGATATTAAATATATTATAAATTTATATAATAA", dnaRate: 3, dnaTone: 85, dnaWindow: 20 }],
      ["cag-repeat", "CAG repeat", { dnaSequence: "ATGCAGCAGCAGCAGCAGCAGCAGCAGCAGTAG", dnaRate: 8, dnaTone: 100, dnaTwist: 1.4 }],
      ["insulin-b", "Insulin B chain", { dnaSequence: "ATGTTTGTGAACCAACACCTGTGTGGCTCACACCTGGTGGAAGCTCTCTACCTAGTGTGCGGGGAACGAGGCTTCTTCTACACACCCAAGACCTAA", dnaRate: 5.5, dnaTone: 120, dnaWindow: 33 }],
      ["four-note-cycle", "Four-note cycle", { dnaSequence: "ATGACGTACGTACGTACGTACGTACGTACGTAG", dnaRate: 9, dnaTone: 150, dnaWindow: 16, dnaTwist: 0.8 }],
      ["stop-storm", "Stop codon storm", { dnaSequence: "ATGTAATAGTGATAATAGTGATAATAGTGA", dnaRate: 12, dnaTone: 180, dnaWindow: 14 }],
      ["tiny-gene", "Tiny gene", { dnaSequence: "ATGGCCTAA", dnaRate: 2, dnaTone: 75, dnaWindow: 12, dnaTwist: 1.8 }],
      ["glycine-wobble", "Glycine wobble", { dnaSequence: "ATGGGTGGCGGAGGGGGTGGCGGAGGTGGGTAA", dnaRate: 6.5, dnaTone: 90, dnaTwist: 0.7 }],
      ["leucine-choir", "Leucine choir", { dnaSequence: "ATGCTGCTTCTCCTACTTTTGCTATTAGTTAA", dnaRate: 4.5, dnaTone: 105, dnaWindow: 30 }],
      ["serine-switch", "Serine switch", { dnaSequence: "ATGTCTAGCAGTTCCTCATCGAGTAGCTCTTAA", dnaRate: 10, dnaTone: 140, dnaWindow: 24, dnaTwist: 1.2 }],
      ["proline-staccato", "Proline staccato", { dnaSequence: "ATGCCCCCTCCACCGCCCCCTCCACCGTAA", dnaRate: 14, dnaTone: 200, dnaWindow: 18, dnaTwist: 1.6 }],
    ],
  }),
  neural: defineExperiment({
    experiment: "neural", id: "neural-pulse",
    fields: {
      neuralWeights: tuple(matrix(6, 4, 1.2), matrix(3, 6, 1.2)), neuralBiases: tuple(vector(6, 0.35), vector(3, 0.35)),
      neuralInput: range(0, 3, 1), neuralThreshold: range(0.1, 0.9, 0.01), neuralGain: range(0.5, 3, 0.1, 0.8, 2.8),
      neuralRate: range(0.2, 3, 0.1, 0.3, 2.8), neuralNoise: range(0, 0.5, 0.01),
    },
    defaults: {},
    constrain: (draft, rng) => {
      const alive = () => neuralThreshold(draft.neuralWeights, draft.neuralBiases, draft.neuralGain, draft.neuralInput) >= 0.32;
      for (let attempt = 0; attempt < 40 && !alive(); attempt++) {
        draft.neuralWeights = drawField(tuple(matrix(6, 4, 1.2), matrix(3, 6, 1.2)), rng);
        draft.neuralBiases = drawField(tuple(vector(6, 0.35), vector(3, 0.35)), rng);
      }
      const reach = neuralThreshold(draft.neuralWeights, draft.neuralBiases, draft.neuralGain, draft.neuralInput);
      draft.neuralThreshold = rng.between(0.1, Math.max(0.1, Math.min(0.9, reach * 0.95)));
    },
    scenes: [
      neuralScene("scattered-weights", "Scattered weights", { seed: 19, pattern: "random", weightScale: 1.2 }),
      neuralScene("direct-routes", "Direct routes", { seed: 7, pattern: "routes", weightScale: 1.1, input: 1, gain: 1.6 }),
      neuralScene("all-excitatory", "All excitatory", { seed: 31, pattern: "excitatory", weightScale: 0.9, biasScale: 0.1, input: 2, gain: 1.1 }),
      neuralScene("lateral-inhibition", "Lateral inhibition", { seed: 5, pattern: "inhibitory", weightScale: 1.2, biasScale: 0.35, input: 3, gain: 2.4 }),
      neuralScene("sparse-wiring", "Sparse wiring", { seed: 101, pattern: "sparse", weightScale: 1.2, input: 0, gain: 2, rate: 1.6 }),
      neuralScene("hot-hidden-layer", "Hot hidden layer", { seed: 43, pattern: "random", weightScale: 1.2, biasScale: 0.35, input: 1, gain: 2.8, noise: 0.2, rate: 2 }),
      neuralScene("cool-gradient", "Cool gradient", { seed: 77, pattern: "random", weightScale: 0.6, biasScale: 0.1, input: 2, gain: 1, rate: 0.5, noise: 0.02 }),
      neuralScene("noisy-cortex", "Noisy cortex", { seed: 12, pattern: "random", weightScale: 1, input: 0, gain: 1.8, noise: 0.45, rate: 1.2 }),
      neuralScene("slow-thought", "Slow thought", { seed: 64, pattern: "routes", weightScale: 0.8, input: 3, gain: 1.3, rate: 0.3, noise: 0.05 }),
      neuralScene("rapid-firing", "Rapid firing", { seed: 88, pattern: "excitatory", weightScale: 1.2, biasScale: 0.2, input: 1, gain: 1.5, rate: 3, noise: 0.12 }),
      neuralScene("sparse-tight", "Sparse and tight", { seed: 23, pattern: "sparse", weightScale: 1.2, biasScale: 0.05, input: 2, gain: 2.6, noise: 0, share: 0.9 }),
      neuralScene("inhibitory-pulse", "Inhibitory pulse", { seed: 150, pattern: "inhibitory", weightScale: 1, biasScale: 0.3, input: 0, gain: 2.2, rate: 1.4 }),
      neuralScene("routes-wide", "Wide routes", { seed: 9, pattern: "routes", weightScale: 1.2, biasScale: 0.15, input: 2, gain: 2, noise: 0.15 }),
    ],
  }),
  fourier: defineExperiment({
    experiment: "fourier", id: "fourier-epicycles",
    fields: {
      fourierWave: choice(["sine", "square", "triangle", "saw"]), fourierHarmonics: range(1, 12, 1),
      fourierRate: range(0.03, 0.5, 0.01, 0.04, 0.45), fourierTone: range(30, 180, 1, 32, 170),
    },
    defaults: { fourierWave: "square", fourierHarmonics: 12, fourierRate: 0.12, fourierTone: 55 },
    scenes: [
      ["square-series", "Square series"],
      ["bright-saw", "Bright saw", { fourierWave: "saw", fourierRate: 0.2, fourierTone: 65 }],
      ["soft-triangle", "Soft triangle", { fourierWave: "triangle", fourierHarmonics: 8, fourierTone: 82 }],
      ["pure-sine", "Pure sine", { fourierWave: "sine", fourierRate: 0.1, fourierTone: 110 }],
      ["three-term-square", "Three-term square", { fourierWave: "square", fourierHarmonics: 3, fourierTone: 73 }],
      ["five-term-saw", "Five-term saw", { fourierWave: "saw", fourierHarmonics: 5, fourierRate: 0.15, fourierTone: 49 }],
      ["slow-triangle", "Slow triangle", { fourierWave: "triangle", fourierRate: 0.05, fourierTone: 41 }],
      ["gibbs-saw", "Gibbs saw", { fourierWave: "saw", fourierRate: 0.45, fourierTone: 40 }],
      ["hollow-square", "Hollow square", { fourierWave: "square", fourierHarmonics: 4, fourierRate: 0.08, fourierTone: 36 }],
      ["reedy-saw", "Reedy saw", { fourierWave: "saw", fourierHarmonics: 7, fourierTone: 98 }],
      ["glass-triangle", "Glass triangle", { fourierWave: "triangle", fourierHarmonics: 5, fourierRate: 0.18, fourierTone: 140 }],
      ["sub-square", "Sub square", { fourierWave: "square", fourierRate: 0.03, fourierTone: 32 }],
      ["organ-square", "Organ square", { fourierWave: "square", fourierHarmonics: 6, fourierRate: 0.25, fourierTone: 80 }],
      ["buzz-saw", "Buzz saw", { fourierWave: "saw", fourierRate: 0.5, fourierTone: 120 }],
      ["wobble-triangle", "Wobble triangle", { fourierWave: "triangle", fourierHarmonics: 2, fourierRate: 0.35, fourierTone: 70 }],
    ],
  }),
  lensing: defineExperiment({
    experiment: "lensing", id: "gravity-lens",
    fields: {
      lensMass: range(0.1, 4, 0.01, 0.15, 3.8), lensOffset: range(-1.5, 1.5, 0.01, -1.4, 1.4), lensOrbit: range(0, 1.5, 0.01, 0, 1.4),
      lensRate: range(0.01, 0.3, 0.01, 0.01, 0.28), lensTone: range(50, 220, 1, 52, 210),
    },
    defaults: { lensMass: 1, lensOffset: 0.25, lensOrbit: 0.7, lensRate: 0.06, lensTone: 110 },
    scenes: [
      ["point-lens", "Point lens"],
      ["einstein-ring", "Einstein ring", { lensOffset: 0, lensOrbit: 0, lensRate: 0.05, lensTone: 90 }],
      ["heavy-cluster", "Heavy cluster", { lensMass: 4, lensOffset: 0.5, lensOrbit: 1, lensTone: 70 }],
      ["wisp-mass", "Wisp mass", { lensMass: 0.1, lensOffset: 0.3, lensOrbit: 0.6, lensTone: 160 }],
      ["wide-orbit", "Wide orbit", { lensOrbit: 1.5, lensRate: 0.1 }],
      ["close-pass", "Close pass", { lensOffset: 0.05, lensOrbit: 0.3, lensRate: 0.15, lensTone: 130 }],
      ["slow-microlensing", "Slow microlensing", { lensMass: 0.6, lensOrbit: 1.2, lensRate: 0.01, lensTone: 95 }],
      ["fast-flyby", "Fast flyby", { lensMass: 1.5, lensOrbit: 1.4, lensRate: 0.3, lensTone: 150 }],
      ["off-axis", "Off axis", { lensOffset: 1.4, lensOrbit: 0.1, lensRate: 0.03, lensTone: 120 }],
      ["negative-offset", "Negative offset", { lensOffset: -1.2, lensOrbit: 0.5, lensTone: 100 }],
      ["deep-bass-lens", "Deep bass lens", { lensMass: 3, lensOffset: 0.2, lensOrbit: 0.9, lensTone: 52 }],
      ["high-glint", "High glint", { lensMass: 0.3, lensOffset: -0.2, lensOrbit: 0.8, lensRate: 0.2, lensTone: 210 }],
      ["symmetric-swing", "Symmetric swing", { lensOffset: 0, lensOrbit: 1.2, lensRate: 0.08, lensTone: 85 }],
    ],
  }),
  orbitalFerris: defineExperiment({
    experiment: "orbitalFerris", id: "orbital-ferris",
    fields: {
      orbitalGestures: range(1, 6, 1, 1, 5), orbitalLevels: range(1, 5, 1, 2, 5), orbitalRate: range(0.02, 0.6, 0.005, 0.03, 0.45),
      orbitalRatio: range(1.5, 8, 0.1, 1.6, 7), orbitalGestureSeconds: range(0.1, 4, 0.05, 0.3, 4), orbitalPitchSpan: range(1, 8, 0.5, 1.5, 7),
      orbitalZoom: range(0, 1, 0.01, 0, 0.5), orbitalTone: range(40, 220, 1, 45, 210), orbitalGestureMode: choice(["loop", "bounce"]),
      orbitalLevelEnabled: tuple(flag(), flag(), flag(), flag(), flag()),
      orbitalLevelShapes: tuple(
        choice(["circle", "triangle", "square", "star"]),
        ...Array.from({ length: 4 }, () => choice(["circle", "triangle", "square", "line", "star"])),
      ),
      orbitalLevelProcessors: tuple(...Array.from({ length: 4 }, () => choice(["pass", "modulator", "delay"]))),
    },
    defaults: {
      orbitalGestures: 1, orbitalLevels: 3, orbitalRate: 0.1, orbitalRatio: 3, orbitalGestureSeconds: 4, orbitalPitchSpan: 4, orbitalZoom: 0,
      orbitalTone: 110, orbitalGestureMode: "loop", orbitalLevelEnabled: [true, true, true, true, true],
      orbitalLevelShapes: ["circle", "triangle", "square", "line", "star"], orbitalLevelProcessors: ["modulator", "delay", "pass", "pass"],
    },
    read: (state, key) => (key === "orbitalLevelProcessors" ? state.orbitalLevelProcessors.slice(1) : undefined),
    check: s => {
      if (!s.orbitalLevelEnabled[0]) throw new TypeError("Level 1 carries the audible voice and must stay enabled");
    },
    constrain: draft => { draft.orbitalLevelEnabled[0] = true; },
    constant: ["orbitalLevelEnabled.0"],
    scenes: [
      ["original-ferry", "Original ferry"],
      ["single-wheel", "Single wheel", { orbitalLevels: 2, orbitalRate: 0.05, orbitalLevelShapes: ["circle", "circle", "square", "line", "star"], orbitalLevelProcessors: ["modulator", "pass", "pass", "pass"] }],
      ["twin-gestures", "Twin gestures", { orbitalGestures: 2, orbitalLevels: 3, orbitalTone: 98, orbitalRatio: 2.5 }],
      ["echo-chamber", "Echo chamber", { orbitalLevels: 4, orbitalRate: 0.07, orbitalLevelProcessors: ["delay", "delay", "delay", "pass"], orbitalLevelShapes: ["circle", "circle", "triangle", "square", "star"], orbitalTone: 82 }],
      ["modulated-shimmer", "Modulated shimmer", { orbitalLevels: 4, orbitalTone: 150, orbitalPitchSpan: 5, orbitalLevelProcessors: ["modulator", "modulator", "modulator", "pass"] }],
      ["star-carousel", "Star carousel", { orbitalGestures: 3, orbitalLevels: 3, orbitalRate: 0.25, orbitalRatio: 2.5, orbitalLevelShapes: ["star", "star", "star", "line", "star"], orbitalTone: 130 }],
      ["slow-orbit", "Slow orbit", { orbitalRate: 0.02, orbitalRatio: 1.5, orbitalZoom: 0.2, orbitalTone: 70 }],
      ["fast-spinner", "Fast spinner", { orbitalRate: 0.5, orbitalRatio: 6, orbitalGestureSeconds: 0.4, orbitalGestureMode: "bounce", orbitalTone: 180 }],
      ["deep-bass-wheel", "Deep bass wheel", { orbitalTone: 42, orbitalPitchSpan: 3, orbitalLevels: 5, orbitalLevelEnabled: [true, true, false, true, false] }],
      ["zoomed-contour", "Zoomed contour", { orbitalZoom: 0.7, orbitalGestures: 2, orbitalLevels: 2, orbitalTone: 120, orbitalLevelShapes: ["triangle", "square", "square", "line", "star"] }],
      ["bounce-ballad", "Bounce ballad", { orbitalGestureMode: "bounce", orbitalGestureSeconds: 2.5, orbitalGestures: 4, orbitalLevels: 3, orbitalRate: 0.06, orbitalTone: 88 }],
      ["five-level-engine", "Five-level engine", { orbitalLevels: 5, orbitalGestures: 2, orbitalRatio: 2, orbitalRate: 0.08, orbitalLevelProcessors: ["modulator", "delay", "modulator", "delay"], orbitalLevelShapes: ["square", "triangle", "star", "circle", "line"] }],
      ["square-dance", "Square dance", { orbitalLevels: 4, orbitalLevelShapes: ["square", "square", "line", "square", "line"], orbitalRate: 0.18, orbitalRatio: 4, orbitalTone: 104 }],
      ["pass-through", "Pass-through voice", { orbitalLevels: 2, orbitalLevelProcessors: ["pass", "pass", "pass", "pass"], orbitalGestureSeconds: 1.5, orbitalTone: 66 }],
    ],
  }),
});

export const EXPERIMENT_PRESET_SESSION_KEYS = Object.freeze([
  "audioOn", "audioStarting", "time", "lastFrame", "level", "orbitalPlaying", "orbitalLevelPhases", "orbitalGestureTravel", "caPlaying",
]);
