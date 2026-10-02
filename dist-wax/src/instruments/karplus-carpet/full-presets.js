import { presetRandom, randomParameterValues } from "../../site/preset-random.js";
import {
  KARPLUS_STRONG_DEFAULTS,
  sanitizeKarplusStrongSettings,
} from "../karplus-strong/karplus-strong.js";
import {
  KARPLUS_CARPET_DEFAULTS,
  KARPLUS_CARPET_TEXTURE_PRESETS,
  sanitizeKarplusCarpetSettings,
} from "./karplus-carpet.js";

const THREAD_SETTING_KEYS = Object.freeze([
  "decay", "damping", "brightness", "hardness", "excitationColor",
  "excitationShape", "burstLength", "pickPosition", "pickWidth", "detune",
  "dispersion", "polarity", "lowCut", "drive", "chorusDepth", "chorusRate",
  "roughness", "pickupPosition", "pickupMix", "body", "bodyTune", "bodyQ",
  "coupling", "couplingRatio", "couplingDetune",
]);

const CARPET_SETTING_KEYS = Object.freeze([
  "lowFrequency", "highFrequency", "divisionsPerOctave", "spacing",
  "grainDuration", "attackDuration", "decayDuration", "sustainLevel",
  "releaseDuration", "timbreVariation", "velocityScatter", "stereoSpread",
  "gainTrim",
]);

export const KARPLUS_CARPET_PRESET_SETTING_KEYS = Object.freeze([
  ...THREAD_SETTING_KEYS,
  ...CARPET_SETTING_KEYS,
]);

const FACTORY_TUNINGS = Object.freeze([
  [82.41, 329.63, 12, "octave"],
  [110, 880, 7, "octave"],
  [146.83, 1_174.66, 19, "octave"],
  [220, 1_760, 12, "equal-hz"],
  [55, 440, 5, "octave"],
  [73.42, 587.33, 12, "octave"],
  [123.47, 987.77, 24, "octave"],
  [164.81, 1_318.51, 31, "equal-hz"],
  [98, 784, 12, "equal-hz"],
  [65.41, 523.25, 7, "octave"],
  [196, 1_568, 19, "octave"],
  [261.63, 2_093, 24, "equal-hz"],
]);

function frozenSnapshot(snapshot) {
  return Object.freeze({
    settings: Object.freeze({ ...snapshot.settings }),
    selectedPresetId: snapshot.selectedPresetId,
  });
}

export function captureKarplusCarpetPreset(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const thread = sanitizeKarplusStrongSettings(input);
  const carpet = sanitizeKarplusCarpetSettings(input);
  const settings = Object.fromEntries(KARPLUS_CARPET_PRESET_SETTING_KEYS.map((key) => [
    key,
    Object.hasOwn(thread, key) ? thread[key] : carpet[key],
  ]));
  return {
    settings,
    selectedPresetId: typeof input.selectedPresetId === "string"
      ? input.selectedPresetId
      : null,
  };
}

export function applyKarplusCarpetPreset(current = {}, snapshot = {}) {
  const input = snapshot && typeof snapshot === "object" ? snapshot : {};
  const captured = captureKarplusCarpetPreset({
    ...current,
    ...(input.settings && typeof input.settings === "object" ? input.settings : {}),
    selectedPresetId: input.selectedPresetId,
  });
  return {
    ...(current && typeof current === "object" ? current : {}),
    ...captured.settings,
    selectedPresetId: captured.selectedPresetId,
  };
}

export const KARPLUS_CARPET_FULL_PRESETS = Object.freeze(
  KARPLUS_CARPET_TEXTURE_PRESETS.map((preset, index) => {
    const [lowFrequency, highFrequency, divisionsPerOctave, spacing] = FACTORY_TUNINGS[index];
    const snapshot = captureKarplusCarpetPreset({
      ...KARPLUS_STRONG_DEFAULTS,
      ...KARPLUS_CARPET_DEFAULTS,
      ...preset.settings,
      lowFrequency,
      highFrequency,
      divisionsPerOctave,
      spacing,
      selectedPresetId: preset.id,
    });
    return Object.freeze({
      id: preset.id,
      label: preset.name,
      description: preset.description,
      snapshot: frozenSnapshot(snapshot),
    });
  }),
);

export function randomizeKarplusCarpetPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const lowFrequency = rng.between(48, 260);
  const randomized = randomParameterValues({
    decay: [0.3, 9],
    damping: [0.08, 0.92],
    brightness: [0.08, 0.98],
    hardness: [0.08, 0.95],
    excitationColor: [0.05, 1],
    excitationShape: [0, 1],
    burstLength: [0.2, 3.6],
    pickPosition: [0.05, 0.95],
    pickWidth: [0.1, 0.96],
    detune: [-24, 24],
    dispersion: [0, 0.9],
    lowCut: [0.01, 0.75],
    drive: [0, 0.8],
    chorusDepth: [0, 0.55],
    chorusRate: [0.08, 5],
    roughness: [0, 0.65],
    pickupPosition: [0.05, 0.95],
    pickupMix: [0, 0.9],
    body: [0, 0.92],
    bodyTune: [0.6, 7.5],
    bodyQ: [0.5, 10],
    coupling: [0, 0.75],
    couplingRatio: [0.35, 3.5],
    couplingDetune: [-30, 30],
    grainDuration: [0.08, 0.4],
    attackDuration: [0.001, 0.12],
    decayDuration: [0.005, 1],
    sustainLevel: [0.05, 0.85],
    releaseDuration: [0.01, 0.4],
    timbreVariation: [0, 1],
    velocityScatter: [0, 0.75],
    stereoSpread: [0.15, 1],
    gainTrim: [0.6, 1.2],
  }, rng);
  return captureKarplusCarpetPreset({
    ...randomized,
    polarity: rng.pick([-1, 1]),
    lowFrequency,
    highFrequency: Math.min(8_000, lowFrequency * (2 ** rng.between(1.4, 3.6))),
    divisionsPerOctave: rng.pick([5, 7, 12, 19, 24, 31]),
    spacing: rng.pick(["octave", "equal-hz"]),
    selectedPresetId: null,
  });
}
