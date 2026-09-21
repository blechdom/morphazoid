import { L_SYSTEM_PRESETS, traceLSystem } from "../../l-system.js";
import { GENERATION_RULE_PRESETS, FIXED_FORK_DENSITY, MAX_GENERATION_STAGES, recursionParameters, generationTopology } from "../../micmic.js";
import { amplitudeEnvelopePreset, sanitizeAmplitudeEnvelope } from "../../audio.js";
import { presetStateKey } from "../../site/header-presets.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../site/preset-random.js";
import { DEFAULT_L_SYSTEM_STATE, DEFAULT_MICMIC_STATE } from "./initial-state.js";
export { DEFAULT_L_SYSTEM_STATE, DEFAULT_MICMIC_STATE };

export const L_SYSTEM_LIVE_KEYS = Object.freeze(["playing", "audio", "position", "continuousPosition"]);
export const MICMIC_LIVE_KEYS = Object.freeze(["mic", "starting", "frozen", "pitchDetail"]);
const select = (source, defaults, live) => Object.fromEntries(Object.keys(defaults).filter(key => !live.includes(key)).map(key => [key, source[key]]));
const ranges = {
  iterations: [0, 12], angle: [0, 180], turnAsymmetry: [-0.8, 0.8], lengthScale: [0.3, 1], speed: [0.01, 4],
  level: [0, 1], baseFrequency: [20, 440], pitchRange: [0, 7], depthAmount: [0, 1], modulationIndex: [0, 12], stereoSpread: [0, 1],
};
export function captureLSystemPreset(state, envelope) {
  return clonePresetData({ parameters: select(state, DEFAULT_L_SYSTEM_STATE, L_SYSTEM_LIVE_KEYS), envelope });
}
export function validateLSystemPreset(s) {
  presetStateKey(s);
  const p = s.parameters, grammar = L_SYSTEM_PRESETS.find(g => g.id === p?.presetId);
  if (!grammar || Object.keys(p).length !== Object.keys(DEFAULT_L_SYSTEM_STATE).length - L_SYSTEM_LIVE_KEYS.length
    || Object.keys(DEFAULT_L_SYSTEM_STATE).filter(key => !L_SYSTEM_LIVE_KEYS.includes(key)).some(key => !Object.hasOwn(p, key))) throw new TypeError("Incomplete L-System scene");
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new TypeError(`Invalid L-System ${key}`);
  if (!Number.isInteger(p.iterations) || p.iterations > (grammar.maxIterations ?? 12)
    || ![-1, 1].includes(p.direction) || !["loop", "ping-pong"].includes(p.traversalBehavior)
    || !["final", "sequence", "together", "accumulate", "canon"].includes(p.structureMode)
    || !["angle", "height", "depth", "progress"].includes(p.pitchSource) || !["sine", "fm", "pm", "shepard"].includes(p.soundMode)) throw new TypeError("Invalid L-System choices");
  const e = s.envelope;
  if (!e || typeof e.enabled !== "boolean" || typeof e.swell !== "boolean" || (!e.enabled && e.swell)
    || !["pluck", "note", "sustain", "pad", "custom"].includes(e.preset) || !(e.level >= 0 && e.level <= 1)
    || presetStateKey(e.points) !== presetStateKey(sanitizeAmplitudeEnvelope(e.points))) throw new TypeError("Invalid L-System envelope");
  return s;
}
const designs = [
  ["pythagorean", "Pythagorean · Original branches", "sine", "final", 0.3, 220, 2, "sustain"],
  ["plant", "Plant · Velvet canopy", "fm", "canon", 0.08, 98, 2, "pad"],
  ["coral", "Coral · Phase bells", "pm", "together", 0.19, 130, 2.5, "pluck"],
  ["dragon", "Dragon · Reversing thread", "sine", "sequence", 0.14, 82, 3, "note"],
  ["koch", "Koch · Bright edges", "fm", "final", 0.38, 147, 2, "pluck"],
  ["sierpinski", "Sierpiński · Geometric choir", "sine", "accumulate", 0.12, 110, 2.5, "pad"],
  ["hilbert", "Hilbert · Clockwork ribbon", "pm", "sequence", 0.42, 65, 3, "note"],
  ["gosper", "Gosper · Endless garden", "shepard", "canon", 0.11, 98, 2, "sustain"],
  ["cantor", "Cantor · Quiet islands", "sine", "together", 0.065, 165, 1.5, "pad"],
  ["levy", "Lévy · Unequal wings", "pm", "accumulate", 0.23, 110, 3, "note"],
  ["terdragon", "Terdragon · Three-way chase", "fm", "canon", 0.5, 73, 3.5, "pluck"],
  ["pythagorean", "Pythagorean · Nasty brass", "fm", "together", 0.35, 55, 4, "sustain"],
  ["coral", "Coral · Sweet retreat", "sine", "final", 0.06, 196, 1.5, "pad"],
  ["hilbert", "Hilbert · Fast folded lines", "pm", "canon", 0.78, 82, 3.5, "note"],
];
export const L_SYSTEM_FULL_PRESETS = Object.freeze(designs.map(([id, label, soundMode, structureMode, speed, baseFrequency, pitchRange, envelope], index) => {
  const grammar = L_SYSTEM_PRESETS.find(p => p.id === id);
  const state = { ...DEFAULT_L_SYSTEM_STATE, presetId: id, iterations: grammar.iterations,
    angle: grammar.angle, turnAsymmetry: grammar.turnAsymmetry ?? 0, lengthScale: grammar.lengthScale,
    soundMode, structureMode, speed, baseFrequency, pitchRange,
    direction: index % 3 === 0 && index ? -1 : 1, traversalBehavior: index % 3 === 1 ? "ping-pong" : "loop",
    pitchSource: index === 0 ? "angle" : ["angle", "height", "depth", "progress"][index % 4],
    modulationIndex: index === 11 ? 6 : soundMode === "fm" ? 1.7 : soundMode === "pm" ? 2.2 : 3,
    level: index === 0 ? 0.55 : index === 11 ? 0.34 : 0.44,
  };
  return { id: `${id}-${index}`, label, description: `${grammar.name}, ${structureMode} iteration playback, ${soundMode} voice and complete growth/sound/envelope settings. Audio/Play and current phase are retained.`,
    snapshot: validateLSystemPreset(captureLSystemPreset(state, {
      enabled: true, swell: index % 4 === 2, preset: envelope, level: 1, points: amplitudeEnvelopePreset(envelope),
    })) };
}));
export function randomizeLSystemPreset(current, random = Math.random) {
  const rng = presetRandom(random), grammar = rng.pick(L_SYSTEM_PRESETS);
  const p = { ...current.parameters, ...randomParameterValues({
    ...ranges, angle: [15, 105], lengthScale: [0.45, 0.9], speed: [0.04, 0.65], baseFrequency: [55, 220], pitchRange: [0.5, 3.5], modulationIndex: [0.2, 5],
  }, rng), presetId: grammar.id, iterations: rng.integer(2, Math.min(grammar.iterations, grammar.maxIterations ?? 10)),
    direction: rng.pick([-1, 1]), traversalBehavior: rng.pick(["loop", "ping-pong"]), soundMode: rng.pick(["sine", "fm", "pm", "shepard"]),
    structureMode: rng.pick(["final", "sequence", "together", "accumulate", "canon"]), pitchSource: rng.pick(["angle", "height", "depth", "progress"]),
    level: current.parameters.level,
  };
  traceLSystem({ ...grammar, ...p });
  const enabled = rng.pick([true, false]);
  return validateLSystemPreset({ parameters: p, envelope: {
    enabled, swell: enabled && rng.pick([true, false]), preset: "custom", level: rng.between(0.35, 1),
    points: [0, 0.15, 0.4, 0.7, 1].map((x, index) => ({ x: index === 0 || index === 4 ? x : x + rng.between(-0.05, 0.05), y: rng.between(0.05, 1) })),
  } });
}

const micRanges = {
  inputTrim: [0, 2], level: [0, 1], generations: [1, MAX_GENERATION_STAGES], depth: [0, 1],
  interval: [1, 3000], mutation: [0, 1], timeRatio: [0.2, 2], generationAngle: [0, 180],
  generationAsymmetry: [-1, 1], generationPitchScale: [0, 4], pruningBias: [-1, 1],
  spread: [0, 1], wet: [0, 1], dry: [0, 1],
};
export function captureMicmicPreset(state) {
  return clonePresetData({ parameters: select(state, DEFAULT_MICMIC_STATE, MICMIC_LIVE_KEYS) });
}
export function validateMicmicPreset(s) {
  presetStateKey(s);
  const p = s.parameters;
  const names = Object.keys(DEFAULT_MICMIC_STATE).filter(key => !MICMIC_LIVE_KEYS.includes(key));
  if (!p || Object.keys(p).length !== names.length || names.some(key => !Object.hasOwn(p, key))) throw new TypeError("Incomplete L-system Delay scene");
  for (const [key, [min, max]] of Object.entries(micRanges)) if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new TypeError(`Invalid L-system Delay ${key}`);
  if (p.branching !== FIXED_FORK_DENSITY || !Number.isInteger(p.generations)
    || !L_SYSTEM_PRESETS.some(g => g.id === p.lSystemType) || !(p.generationPreset === "custom" || Object.hasOwn(GENERATION_RULE_PRESETS, p.generationPreset))) throw new TypeError("Invalid recursion choices");
  recursionParameters(p);
  return s;
}
export const MICMIC_FULL_PRESETS = Object.freeze(Object.entries(GENERATION_RULE_PRESETS).map(([id, growth], index) => {
  const lSystemType = L_SYSTEM_PRESETS.some(p => p.id === id) ? id : ["plant", "coral", "pythagorean"][index % 3];
  const parameters = { ...DEFAULT_MICMIC_STATE, generationPreset: id, label: growth.label, lSystemType,
    generations: growth.generations, depth: growth.depth, interval: growth.interval, mutation: growth.mutation,
    timeRatio: growth.timeRatio, generationAngle: growth.angle, generationAsymmetry: growth.asymmetry,
    generationPitchScale: growth.pitchScale, pruningBias: index % 3 === 0 ? -0.35 : index % 3 === 1 ? 0.35 : 0,
    wet: index % 4 === 0 ? 0.55 : 0.72, dry: index % 4 === 2 ? 0.18 : 0, spread: index % 4 === 1 ? 0.4 : 0.85,
    inputTrim: 0.75, level: 0.48,
  };
  return { id, label: `${growth.label} · ${L_SYSTEM_PRESETS.find(p => p.id === lSystemType).name}`,
    description: `${growth.description} Complete topology, growth, pitch and mix. Microphone, frozen input, active pitch backend and recorded history are retained.`,
    snapshot: validateMicmicPreset(captureMicmicPreset(parameters)),
  };
}));
export function randomizeMicmicPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const p = { ...current.parameters, ...randomParameterValues({
    ...micRanges, inputTrim: [0.45, 0.85], depth: [0.25, 0.8], interval: [50, 1600], timeRatio: [0.35, 1.1],
    generationAngle: [15, 90], generationPitchScale: [0, 1.6], dry: [0, 0.25], wet: [0.4, 0.8],
  }, rng), generations: rng.integer(3, 8), branching: FIXED_FORK_DENSITY, label: "Custom",
    generationPreset: "custom", lSystemType: rng.pick(L_SYSTEM_PRESETS).id, level: current.parameters.level,
  };
  generationTopology({ lSystemType: p.lSystemType, generations: p.generations, branching: p.branching, mutation: p.mutation, timeRatio: p.timeRatio, angle: p.generationAngle, asymmetry: p.generationAsymmetry });
  return validateMicmicPreset({ parameters: p });
}
