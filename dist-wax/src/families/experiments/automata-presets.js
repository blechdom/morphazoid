import {
  AUTOMATAPOEIA_BOUNDARIES, AUTOMATAPOEIA_FAMILIES, AUTOMATAPOEIA_SONIFICATION_MODES, AUTOMATAPOEIA_TRANSFORMS,
  AUTOMATAPOEIA_POLARITIES, AUTOMATAPOEIA_OBJECT_MODES, AUTOMATAPOEIA_PITCH_CURVES, AUTOMATAPOEIA_TIMBRE_SOURCES,
  AUTOMATAPOEIA_CONTOUR_SOURCES, AUTOMATAPOEIA_PHRASE_SHAPES, AUTOMATAPOEIA_VOICES, AUTOMATAPOEIA_DEFAULT_ENVELOPE,
} from "../../automatapoeia.js";
import { presetStateKey } from "../../site/header-presets.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../site/preset-random.js";

const choices = {
  caBoundary: AUTOMATAPOEIA_BOUNDARIES, caFamily: AUTOMATAPOEIA_FAMILIES, caSonificationMode: AUTOMATAPOEIA_SONIFICATION_MODES,
  caTransform: AUTOMATAPOEIA_TRANSFORMS, caPolarity: AUTOMATAPOEIA_POLARITIES, caObjectMode: AUTOMATAPOEIA_OBJECT_MODES,
  caPitchCurve: AUTOMATAPOEIA_PITCH_CURVES, caTimbreSource: AUTOMATAPOEIA_TIMBRE_SOURCES,
  caContourSource: AUTOMATAPOEIA_CONTOUR_SOURCES, caPhraseShape: AUTOMATAPOEIA_PHRASE_SHAPES, caVoice: AUTOMATAPOEIA_VOICES,
};
const ranges = {
  level: [0, 0.82], caWidth: [25, 127], caRate: [1, 24], caDensity: [0, 1],
  caFrequencyMin: [20, 380], caFrequencyMax: [400, 12000], caPitchTrace: [0, 1], caTimbreAmount: [0, 1],
  caContourAmount: [0, 1], caRhythmDetail: [1, 16], caTimeSpread: [0, 1], caSwing: [-0.42, 0.42],
  caStrikeLength: [0.1, 2], caAttack: [0.001, 0.4], caDecay: [0.005, 1.5], caSustain: [0, 1], caRelease: [0.005, 2],
};
const defaults = {
  level: 0.48, caRule: 30, caWidth: 73, caRate: 8, caDensity: 0,
  caRuleByFamily: { elementary: 30, "totalistic-r2": 20 },
  caFamily: "elementary", caBoundary: "fixed", caPolarity: "one", caObjectMode: "runs", caSonificationMode: "row-events",
  caTransform: "none", caVoice: "rattlesnake", caPhraseShape: "bands", caPitchCurve: "linear",
  caTimbreSource: "local-walls", caContourSource: "motion", caFrequencyMin: 70, caFrequencyMax: 6400,
  caPitchTrace: 0.7, caTimbreAmount: 0.8, caContourAmount: 0.42, caRhythmDetail: 8, caTimeSpread: 0.76,
  caSwing: 0.08, caStrikeLength: 1.15,
  caAttack: AUTOMATAPOEIA_DEFAULT_ENVELOPE.attack, caDecay: AUTOMATAPOEIA_DEFAULT_ENVELOPE.decay,
  caSustain: AUTOMATAPOEIA_DEFAULT_ENVELOPE.sustain, caRelease: AUTOMATAPOEIA_DEFAULT_ENVELOPE.release,
};
export const AUTOMATA_PRESET_KEYS = Object.freeze(Object.keys(defaults));
export function captureAutomataPreset(state) {
  return clonePresetData({ parameters: Object.fromEntries(AUTOMATA_PRESET_KEYS.map(key => [key, state[key]])), seedOrigin: state.caSeedOrigin });
}
export function validateAutomataPreset(snapshot) {
  presetStateKey(snapshot);
  const p = snapshot.parameters;
  if (!p || Object.keys(p).length !== AUTOMATA_PRESET_KEYS.length || AUTOMATA_PRESET_KEYS.some(key => !Object.hasOwn(p, key))) throw new TypeError("Incomplete Automatapoeia scene");
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new TypeError(`Invalid Automatapoeia ${key}`);
  for (const [key, values] of Object.entries(choices)) if (!values.some(value => value.id === p[key])) throw new TypeError(`Invalid Automatapoeia ${key}`);
  if (![p.caRule, p.caWidth, p.caRhythmDetail, snapshot.seedOrigin].every(Number.isInteger) || snapshot.seedOrigin < 1 || snapshot.seedOrigin > 0xffffffff) throw new TypeError("Invalid CA integer/seed");
  for (const [family, max] of [["elementary", 255], ["totalistic-r2", 63]]) {
    if (!Number.isInteger(p.caRuleByFamily?.[family]) || p.caRuleByFamily[family] < 0 || p.caRuleByFamily[family] > max) throw new TypeError("Invalid CA rule bank");
  }
  if (p.caRule !== p.caRuleByFamily[p.caFamily]) throw new TypeError("CA family/rule mismatch");
  return snapshot;
}
function scene(id, label, overrides, seedOrigin = 1) {
  const parameters = { ...defaults, ...overrides,
    caRuleByFamily: { ...defaults.caRuleByFamily, [overrides.caFamily ?? defaults.caFamily]: overrides.caRule ?? defaults.caRule } };
  return { id, label, description: `${label}: complete automaton, seed, voice, pitch/timbre mappings and envelope. New seed lineage; Audio remains unchanged.`,
    snapshot: validateAutomataPreset({ parameters, seedOrigin }) };
}
export const AUTOMATA_FULL_PRESETS = Object.freeze([
  scene("original-thirty", "Rule 30 · Original cascade", {}),
  scene("ninety-carpet", "Rule 90 · Soft lace", { caRule: 90, caVoice: "karplus-carpet", caRate: 4, caFrequencyMax: 1600, caAttack: 0.025, caDecay: 0.25, caRelease: 0.5, level: 0.4 }),
  scene("columns-110", "Rule 110 · Singing columns", { caRule: 110, caSonificationMode: "vertical-sine", caRate: 5, caWidth: 49, caFrequencyMax: 2200, caDensity: 0.18, level: 0.34 }, 110),
  scene("mirror-150", "Rule 150 · Mirror phrases", { caRule: 150, caTransform: "reflect", caPhraseShape: "centers", caPitchCurve: "reverse", caRate: 10, caFrequencyMax: 2800, caSwing: -0.15, level: 0.4 }),
  scene("connected-54", "Rule 54 · Connected bodies", { caRule: 54, caObjectMode: "connected", caContourSource: "expansion", caContourAmount: 0.75, caDensity: 0.24, caRate: 7, caFrequencyMax: 3400, level: 0.4 }, 54),
  scene("slow-45", "Rule 45 · Slow droplets", { caRule: 45, caRate: 2, caWidth: 41, caTimeSpread: 0.95, caVoice: "karplus-carpet", caFrequencyMax: 1400, caStrikeLength: 1.7, level: 0.42 }, 45),
  scene("fast-60", "Rule 60 · Fast clockwork", { caRule: 60, caRate: 18, caWidth: 61, caRelease: 0.07, caDecay: 0.04, caStrikeLength: 0.35, caTimeSpread: 0.3, caRhythmDetail: 6, caFrequencyMax: 2400, level: 0.34 }),
  scene("negative-126", "Rule 126 · Dark negative", { caRule: 126, caPolarity: "zero", caBoundary: "periodic", caTimbreSource: "row-walls", caDensity: 0.35, caPitchCurve: "late", caFrequencyMax: 1800, level: 0.36 }, 126),
  scene("radius-two", "Radius two · Broad bands", { caFamily: "totalistic-r2", caRule: 20, caWidth: 97, caRate: 6, caTimbreSource: "symmetry", caFrequencyMax: 2400, caDensity: 0.12, level: 0.36 }, 20),
  scene("radius-skip", "Radius two · Skipping seams", { caFamily: "totalistic-r2", caRule: 45, caTransform: "shift-left", caBoundary: "periodic", caSwing: 0.24, caPitchCurve: "early", caRate: 11, caFrequencyMax: 3200, level: 0.38 }, 451),
  scene("nasty-walls", "Rule 22 · Nasty walls", { caRule: 22, caTimbreAmount: 1, caTimbreSource: "edge-flux", caContourSource: "birth-death", caTransform: "complement", caRate: 13, caDensity: 0.45, caFrequencyMax: 4800, level: 0.3 }, 22),
  scene("radius-choir", "Radius two · Quiet choir", { caFamily: "totalistic-r2", caRule: 36, caSonificationMode: "vertical-sine", caWidth: 37, caRate: 3, caPitchCurve: "smooth", caFrequencyMin: 110, caFrequencyMax: 1200, caDensity: 0.2, level: 0.32 }, 36),
]);
export function randomizeAutomataPreset(current, random = Math.random) {
  const rng = presetRandom(random), p = { ...randomParameterValues({
    ...ranges, caRate: [2, 16], caFrequencyMax: [800, 4800], caAttack: [0.008, 0.09], caRelease: [0.04, 0.7],
    caDecay: [0.03, 0.5], caDensity: [0.05, 0.5],
  }, rng), caRuleByFamily: { elementary: rng.pick([18, 22, 30, 45, 54, 60, 90, 110, 126, 150]), "totalistic-r2": rng.pick([20, 22, 36, 45, 54]) } };
  for (const [key, values] of Object.entries(choices)) p[key] = rng.pick(values).id;
  p.caRule = p.caRuleByFamily[p.caFamily];
  p.caWidth = rng.integer(25, 97); p.caRhythmDetail = rng.integer(2, 12); p.level = current.parameters.level;
  return validateAutomataPreset({ parameters: p, seedOrigin: rng.integer(1, 0xffffffff) });
}
