import { METHODS, getMethod, getPreset, createDefaultState, stateFromPreset, sanitizeState, randomizeState } from "./catalog.js";

// Match the grouped method menu rather than engine-number order.
const groups = new Map();
for (const method of METHODS) {
  if (!groups.has(method.group)) groups.set(method.group, []);
  groups.get(method.group).push(method);
}
export const METHOD_MENU_ORDER = Object.freeze([...groups.values()].flat());
export const methodSection = methodId => getMethod(methodId).kind === "processor" ? "processing" : "synthesis";
export const SECTION_METHODS = Object.freeze(Object.fromEntries(
  ["synthesis", "processing"].map(section => [section, Object.freeze(METHOD_MENU_ORDER.filter(method => methodSection(method.id) === section))]),
));
export const fullPresetId = (methodId, presetId) => `${methodId}:${presetId}`;

/** Master level and voicing are performer choices, independent of sound recall. */
export function captureSoundState(value) {
  const { outputLevel, voiceMode, ...sound } = sanitizeState(value);
  return sound;
}

export const SYNTHESAURUS_FULL_PRESETS = Object.freeze(METHOD_MENU_ORDER.flatMap(method =>
  method.presets.map(preset => Object.freeze({
    id: fullPresetId(method.id, preset.id),
    label: `${method.label} · ${preset.name}`,
    description: `${method.group}. ${preset.cue}`,
    snapshot: captureSoundState(stateFromPreset(method.id, preset.id)),
  })),
));

export const SECTION_PRESETS = Object.freeze(Object.fromEntries(
  Object.keys(SECTION_METHODS).map(section => [section, Object.freeze(SYNTHESAURUS_FULL_PRESETS.filter(preset => methodSection(preset.snapshot.methodId) === section))]),
));

/** Randomize the current method, including processor mix and gain controls. */
export function randomizeMethodState(value = {}, rng = Math.random) {
  const result = randomizeState(value, rng);
  const method = getMethod(result.methodId);
  if (method.kind !== "processor") return result;
  const draw = () => { const n = Number(rng()); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
  // Keep an explicitly selected external input. Built-in signals can vary
  // without opening devices; paired trims keep the total gain near its reference.
  result.source = result.source === 0 ? 0 : 1 + Math.min(6, Math.floor(draw() * 7));
  result.wet = .25 + .75 * draw();
  result.bypass = draw() < .08;
  result.inputDb = -12 + 24 * draw();
  result.outputDb = Math.max(-36, Math.min(24, getPreset(method.id).outputDb - result.inputDb - 3 + 6 * draw()));
  return sanitizeState(result);
}

/** Preset dice explores only the current section, with new parameter values. */
export function randomizeAllState(value = {}, rng = Math.random) {
  const current = sanitizeState(value);
  const draw = Number(rng());
  const unit = Number.isFinite(draw) ? Math.max(0, Math.min(1, draw)) : 0;
  const methods = SECTION_METHODS[methodSection(current.methodId)];
  const method = methods[Math.min(methods.length - 1, Math.floor(unit * methods.length))];
  const initial = method.id === current.methodId ? current : {
    ...createDefaultState(method.id), outputLevel: current.outputLevel, voiceMode: current.voiceMode,
  };
  // Changing processors retains an explicitly selected file or microphone input.
  if (method.kind === "processor" && current.source === 0) initial.source = 0;
  return randomizeMethodState(initial, rng);
}
