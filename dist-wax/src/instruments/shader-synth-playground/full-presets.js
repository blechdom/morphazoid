import {
  SHADER_PLAYGROUND_COMBOS,
  SHADER_PLAYGROUND_MODULES,
  SHADER_PLAYGROUND_PRESETS,
  createShaderPlaygroundCombo,
  createShaderPlaygroundPatch,
  sanitizeShaderPlaygroundPatch,
} from "./shader-synth-playground.js?v=20260902-monotonic-play-note";
import { sanitizeWebGpuSynthOrganRanks } from "../webgpu-synths/webgpu-synths.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const MODULE_BY_ID = new Map(SHADER_PLAYGROUND_MODULES.map(module => [module.id, module]));
const STEP_DEPENDENT = new Set(["euclidean-gate", "euclidean-arpeggiator"]);
const ROTATION_DEPENDENT = new Set(["euclidean-gate", "euclidean-arpeggiator", "bitmask-rhythm"]);
const LEVEL_LIKE = /^(level|gain|volume|amp|amplitude|output)$/i;

export const shaderConnectionId = connection => `${connection.from.node}.${connection.from.port}>${connection.to.node}.${connection.to.port}`
  .replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);

function constrainParams(type, params) {
  const module = MODULE_BY_ID.get(type);
  const result = { ...params };
  if (!module) return result;
  const steps = result.steps ?? module.params.find(({ id }) => id === "steps")?.default ?? 1;
  const stepCount = Math.max(1, Math.round(Number(steps) || 1));
  for (const param of module.params) {
    let maximum = param.max;
    if (STEP_DEPENDENT.has(type) && param.id === "pulses") maximum = Math.min(maximum, stepCount);
    if (ROTATION_DEPENDENT.has(type) && param.id === "rotation") maximum = Math.min(maximum, Math.max(0, stepCount - 1));
    const value = Number(result[param.id] ?? param.default);
    result[param.id] = Math.min(maximum, Math.max(param.min, value));
  }
  return result;
}

export function captureShaderSynthPreset(state) {
  const patch = sanitizeShaderPlaygroundPatch(JSON.parse(JSON.stringify({
    nodes: state.patch?.nodes ?? [], connections: state.patch?.connections ?? state.patch?.edges ?? [],
  })));
  return {
    nodes: patch.nodes.map(node => ({
      id: node.id, type: node.type, params: constrainParams(node.type, node.params),
      ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
    })),
    connections: patch.connections.map(({ from, to }) => ({ from: { ...from }, to: { ...to } })),
    organRanks: sanitizeWebGpuSynthOrganRanks(state.organRanks).map(rank => ({ ...rank })),
  };
}

export function shaderSynthSnapshotPatch(snapshot) {
  return {
    id: "scene", name: "Scene",
    nodes: snapshot.nodes.map(node => ({ ...node, params: { ...node.params } })),
    connections: snapshot.connections.map(({ from, to }) => ({ id: shaderConnectionId({ from, to }), from: { ...from }, to: { ...to } })),
  };
}

export function validateShaderSynthPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.connections) || !Array.isArray(snapshot.organRanks)
    || presetStateKey(snapshot) !== presetStateKey(captureShaderSynthPreset({ patch: shaderSynthSnapshotPatch(snapshot), organRanks: snapshot.organRanks }))) {
    throw new TypeError("Invalid complete Modular Shader Synth preset");
  }
  return snapshot;
}

const DEFAULT_RANKS = sanitizeWebGpuSynthOrganRanks();
const snapshotOf = patch => captureShaderSynthPreset({ patch, organRanks: DEFAULT_RANKS });
const deepFreeze = value => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const authored = SHADER_PLAYGROUND_COMBOS.filter(combo => combo.collection === "authored-scenes" || combo.kind === "scene");
const seen = new Set();
export const SHADER_SYNTH_FULL_PRESETS = Object.freeze([
  ...SHADER_PLAYGROUND_PRESETS.map(preset => ({ id: preset.id, label: preset.label ?? preset.name ?? preset.id, patch: () => createShaderPlaygroundPatch(preset.id) })),
  ...authored.map(combo => ({ id: combo.id, label: combo.label ?? combo.name ?? combo.id, patch: () => createShaderPlaygroundCombo(combo.id) })),
].filter(entry => !seen.has(entry.id) && seen.add(entry.id)).map(entry => Object.freeze({
  id: entry.id, label: entry.label, snapshot: deepFreeze(snapshotOf(entry.patch())),
})));

const TEMPLATES = Object.freeze([
  ...SHADER_PLAYGROUND_PRESETS.map(preset => () => createShaderPlaygroundPatch(preset.id)),
  ...SHADER_PLAYGROUND_COMBOS.map(combo => () => createShaderPlaygroundCombo(combo.id)),
]);
const RATIOS = Object.freeze([0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8]);

const normalized = (param, value) => (param.scale === "log" && param.min > 0
  ? Math.log(value / param.min) / Math.log(param.max / param.min)
  : (value - param.min) / (param.max - param.min));
const denormalized = (param, unit) => (param.scale === "log" && param.min > 0
  ? param.min * (param.max / param.min) ** unit
  : param.min + (param.max - param.min) * unit);

function randomParam(param, template, rng) {
  if (param.step >= 1 && param.max - param.min <= 12) return rng.integer(param.min, param.max);
  const start = Math.min(1, Math.max(0, normalized(param, template)));
  const spread = LEVEL_LIKE.test(param.id) ? [-0.3, 0.15] : [-0.5, 0.5];
  const unit = Math.min(1, Math.max(0, start + rng.between(spread[0], spread[1])));
  const value = denormalized(param, unit);
  return param.step >= 1 ? Math.round(value) : Number(value.toPrecision(5));
}

export function randomizeShaderSynthPreset(current, random = Math.random) {
  validateShaderSynthPreset(current);
  const rng = presetRandom(random);
  const template = sanitizeShaderPlaygroundPatch(rng.pick(TEMPLATES)());
  const keptOutput = current.nodes.find(node => node.type === "output")?.params;
  const nodes = template.nodes.map(node => {
    const module = MODULE_BY_ID.get(node.type);
    const params = Object.fromEntries(module.params.map(param => [
      param.id,
      node.type === "output" ? keptOutput?.[param.id] ?? node.params[param.id] : randomParam(param, node.params[param.id], rng),
    ]));
    return { ...node, params };
  });
  const organRanks = sanitizeWebGpuSynthOrganRanks(Array.from({ length: 9 }, (_, index) => ({
    ratio: rng.pick(RATIOS), level: index === 2 ? rng.between(0.6, 1) : rng.between(0, 1),
    amRate: rng.between(0, 2), amDepth: rng.between(0, 0.3),
  })));
  return validateShaderSynthPreset(captureShaderSynthPreset({ patch: { nodes, connections: template.connections }, organRanks }));
}
