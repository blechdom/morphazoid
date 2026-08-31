import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";
import {
  KARPLUS_STRONG_DEFAULTS,
  KARPLUS_STRONG_PRESETS,
  generateKarplusStrongSamples,
  sanitizeKarplusStrongSettings,
} from "./karplus-strong.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lerp = (start, end, amount) => start + (end - start) * amount;

export const LINEAR_DRUM_FREQUENCY_MIN = 20;
export const LINEAR_DRUM_FREQUENCY_MAX = 20_000;
export const LINEAR_DRUM_DEFAULTS = Object.freeze({
  rangeMin: 20,
  rangeMax: 16_000,
  kickTomHz: 110,
  tomHandHz: 720,
  handAirHz: 4_600,
  morphWidth: 1.05,
  attack: .0015,
  decay: .76,
  pitchFall: 1,
  strikeNoise: 1,
  brightness: 0.56,
  inharmonicity: 0.58,
  hardness: 0.62,
  sweepRate: 16,
  sweepSpeed: 1.5,
  model: "hybrid",
  pitchedOrder: Object.freeze(["harp", "harpsichord", "piano"]),
  karplusMorphOrder: Object.freeze(["bass", "nylon", "steel", "glass"]),
});

export const LINEAR_DRUM_MODELS = Object.freeze([
  Object.freeze({ id: "hybrid", label: "Modal + FM" }),
  Object.freeze({ id: "modal", label: "Modal" }),
  Object.freeze({ id: "fm", label: "FM" }),
  Object.freeze({ id: "pitched", label: "Pitched Morph" }),
  Object.freeze({ id: "karplus-strong", label: "Karplus Strong" }),
]);
export const LINEAR_DRUM_SOUND_ENGINES = Object.freeze([
  Object.freeze({ id: "rattlesnake", label: "Rattlesnake" }),
  Object.freeze({ id: "karplus-strong", label: "Karplus Strong" }),
]);

export const LINEAR_DRUM_PITCHED_ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "harp", label: "Harp",
    ratios: Object.freeze([1, 2.002, 3.007, 4.014, 5.024, 6.036, 7.05, 8.067]),
    gains: Object.freeze([1, .62, .42, .3, .22, .16, .12, .09]),
    decayScale: 1.42, highDamping: .19, noiseMix: .1, noiseColor: .42, detune: .35,
  }),
  Object.freeze({
    id: "harpsichord", label: "Harpsichord",
    ratios: Object.freeze([1, 2.003, 3.009, 4.018, 5.03, 6.045, 7.063, 8.084]),
    gains: Object.freeze([1, .82, .66, .52, .39, .3, .22, .16]),
    decayScale: .72, highDamping: .34, noiseMix: .28, noiseColor: .78, detune: .18,
  }),
  Object.freeze({
    id: "piano", label: "Piano",
    ratios: Object.freeze([1, 2.006, 3.018, 4.04, 5.075, 6.126, 7.196, 8.288]),
    gains: Object.freeze([1, .7, .48, .33, .23, .16, .105, .07]),
    decayScale: 1.06, highDamping: .27, noiseMix: .22, noiseColor: .58, detune: 1.6,
  }),
  Object.freeze({
    id: "marimba", label: "Marimba",
    ratios: Object.freeze([1, 4, 9.88, 19, 21, 30, 42, 55]),
    gains: Object.freeze([1, .5, .24, .105, .065, .038, .021, .012]),
    decayScale: 1.18, highDamping: .5, noiseMix: .13, noiseColor: .3, detune: .08,
  }),
  Object.freeze({
    id: "xylophone", label: "Xylophone",
    ratios: Object.freeze([1, 3, 6, 10, 15, 21, 28, 36]),
    gains: Object.freeze([1, .72, .45, .28, .17, .1, .06, .035]),
    decayScale: .34, highDamping: .76, noiseMix: .46, noiseColor: .86, detune: .05,
  }),
  Object.freeze({
    id: "kalimba", label: "Kalimba",
    ratios: Object.freeze([1, 5.7, 15.8, 29, 47, 69, 95, 125]),
    gains: Object.freeze([1, .34, .14, .07, .038, .021, .012, .007]),
    decayScale: .86, highDamping: .58, noiseMix: .31, noiseColor: .7, detune: .12,
  }),
]);

export const LINEAR_DRUM_PARAMETER_SPECS = Object.freeze([
  Object.freeze({
    id: "attack", label: "Attack", shortLabel: "ATK", min: .001, max: .12,
    scale: "log", defaultLow: .001, defaultHigh: .014, color: "#ff8464",
  }),
  Object.freeze({
    id: "decay", label: "Decay", shortLabel: "DEC", min: .04, max: 8,
    scale: "log", defaultLow: 1.1, defaultHigh: .13, color: "#efc85e",
  }),
  Object.freeze({
    id: "pitchFall", label: "Pitch fall", shortLabel: "FALL", min: 0, max: 2,
    scale: "linear", defaultLow: 1.45, defaultHigh: .08, color: "#a6d766",
  }),
  Object.freeze({
    id: "strikeNoise", label: "Attack noise", shortLabel: "NOISE", min: 0, max: 1.6,
    scale: "linear", defaultLow: .12, defaultHigh: 1.35, color: "#5ee0c0",
  }),
  Object.freeze({
    id: "brightness", label: "Brightness", shortLabel: "BRI", min: 0, max: 1,
    scale: "linear", defaultLow: .24, defaultHigh: .92, color: "#5dcddc",
  }),
  Object.freeze({
    id: "inharmonicity", label: "Membrane stiffness", shortLabel: "STIFF", min: 0, max: 1,
    scale: "linear", defaultLow: .38, defaultHigh: .86, color: "#75a8ff",
  }),
  Object.freeze({
    id: "hardness", label: "Strike hardness", shortLabel: "HARD", min: 0, max: 1,
    scale: "linear", defaultLow: .22, defaultHigh: .92, color: "#d08cff",
  }),
  Object.freeze({
    id: "sweepRate", label: "Hit density", shortLabel: "DENS", min: 4, max: 28,
    scale: "linear", defaultLow: 8, defaultHigh: 24, color: "#ff7eb6",
  }),
  Object.freeze({
    id: "sweepSpeed", label: "Gliss speed", shortLabel: "SPEED", min: .2, max: 4,
    scale: "log", defaultLow: .55, defaultHigh: 2.8, color: "#b996ff",
  }),
]);

const PARAMETER_SPEC_BY_ID = new Map(
  LINEAR_DRUM_PARAMETER_SPECS.map((specification) => [specification.id, specification]),
);

export const LINEAR_DRUM_DEFAULT_MAPS = Object.freeze(Object.fromEntries(
  LINEAR_DRUM_PARAMETER_SPECS.map((specification) => [
    specification.id,
    Object.freeze({
      enabled: false,
      source: "pitch",
      low: specification.defaultLow,
      high: specification.defaultHigh,
      curve: 0,
    }),
  ]),
));

const MODEL_IDS = new Set(LINEAR_DRUM_MODELS.map(({ id }) => id));
const PITCHED_ARCHETYPE_BY_ID = new Map(
  LINEAR_DRUM_PITCHED_ARCHETYPES.map((archetype) => [archetype.id, archetype]),
);
const PITCHED_ARCHETYPE_IDS = new Set(PITCHED_ARCHETYPE_BY_ID.keys());
const KARPLUS_PRESET_BY_ID = new Map(
  KARPLUS_STRONG_PRESETS.map((item) => [item.id, item]),
);
const KARPLUS_PRESET_IDS = new Set(KARPLUS_PRESET_BY_ID.keys());
const KARPLUS_MORPH_PARAMETER_KEYS = Object.freeze(
  Object.keys(KARPLUS_STRONG_DEFAULTS).filter((key) => key !== "frequency" && key !== "level"),
);

function sanitizePitchedOrder(source) {
  const requested = Array.isArray(source) ? source : LINEAR_DRUM_DEFAULTS.pitchedOrder;
  const order = [];
  for (const id of [...requested, ...LINEAR_DRUM_DEFAULTS.pitchedOrder]) {
    if (PITCHED_ARCHETYPE_IDS.has(id) && !order.includes(id)) order.push(id);
    if (order.length === 3) break;
  }
  return order;
}

function sanitizeKarplusMorphOrder(source) {
  const requested = Array.isArray(source) ? source : [];
  return LINEAR_DRUM_DEFAULTS.karplusMorphOrder.map((fallback, index) => (
    KARPLUS_PRESET_IDS.has(requested[index]) ? requested[index] : fallback
  ));
}

const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "kick",
    ratios: Object.freeze([1, 1.56, 2.08, 2.29, 2.64, 2.91]),
    gains: Object.freeze([1, .34, .16, .1, .065, .04]),
    decay: .76,
    highDamping: .56,
    pitchDropOctaves: 1.82,
    pitchDropSeconds: .072,
    noiseMix: .035,
    noiseDecay: .028,
    noiseColor: .12,
    bodyMix: 1,
    fmRatio: 1.43,
    fmIndex: 3.8,
    fmDecay: .16,
  }),
  Object.freeze({
    id: "tom",
    ratios: Object.freeze([1, 1.59, 2.14, 2.31, 2.67, 2.94]),
    gains: Object.freeze([1, .46, .25, .16, .09, .055]),
    decay: .48,
    highDamping: .72,
    pitchDropOctaves: .56,
    pitchDropSeconds: .048,
    noiseMix: .09,
    noiseDecay: .036,
    noiseColor: .3,
    bodyMix: .96,
    fmRatio: 1.58,
    fmIndex: 2.7,
    fmDecay: .12,
  }),
  Object.freeze({
    id: "hand",
    ratios: Object.freeze([1, 1.48, 2.03, 2.57, 3.18, 4.06]),
    gains: Object.freeze([1, .54, .33, .21, .13, .075]),
    decay: .235,
    highDamping: .98,
    pitchDropOctaves: .17,
    pitchDropSeconds: .026,
    noiseMix: .43,
    noiseDecay: .052,
    noiseColor: .64,
    bodyMix: .82,
    fmRatio: 1.91,
    fmIndex: 1.65,
    fmDecay: .075,
  }),
  Object.freeze({
    id: "air",
    ratios: Object.freeze([1, 1.87, 2.73, 3.91, 5.42, 7.08]),
    gains: Object.freeze([1, .62, .42, .28, .17, .1]),
    decay: .085,
    highDamping: 1.32,
    pitchDropOctaves: .025,
    pitchDropSeconds: .012,
    noiseMix: .94,
    noiseDecay: .072,
    noiseColor: .96,
    bodyMix: .28,
    fmRatio: 2.47,
    fmIndex: .72,
    fmDecay: .045,
  }),
]);

function sanitizeCoreLinearDrumSettings(source = {}) {
  const settings = source && typeof source === "object" ? source : {};
  const rangeMin = clamp(
    finiteOr(settings.rangeMin, LINEAR_DRUM_DEFAULTS.rangeMin),
    LINEAR_DRUM_FREQUENCY_MIN,
    120,
  );
  const rangeMax = clamp(
    finiteOr(settings.rangeMax, LINEAR_DRUM_DEFAULTS.rangeMax),
    Math.max(4_000, rangeMin * 8),
    LINEAR_DRUM_FREQUENCY_MAX,
  );
  return {
    rangeMin,
    rangeMax,
    kickTomHz: clamp(finiteOr(settings.kickTomHz, LINEAR_DRUM_DEFAULTS.kickTomHz), 55, 220),
    tomHandHz: clamp(finiteOr(settings.tomHandHz, LINEAR_DRUM_DEFAULTS.tomHandHz), 250, 1_800),
    handAirHz: clamp(finiteOr(settings.handAirHz, LINEAR_DRUM_DEFAULTS.handAirHz), 1_900, 10_000),
    morphWidth: clamp(finiteOr(settings.morphWidth, LINEAR_DRUM_DEFAULTS.morphWidth), .3, 2.5),
    attack: clamp(finiteOr(settings.attack, LINEAR_DRUM_DEFAULTS.attack), .001, .12),
    decay: clamp(finiteOr(settings.decay, LINEAR_DRUM_DEFAULTS.decay), .04, 8),
    pitchFall: clamp(finiteOr(settings.pitchFall, LINEAR_DRUM_DEFAULTS.pitchFall), 0, 2),
    strikeNoise: clamp(finiteOr(settings.strikeNoise, LINEAR_DRUM_DEFAULTS.strikeNoise), 0, 1.6),
    brightness: clamp(finiteOr(settings.brightness, LINEAR_DRUM_DEFAULTS.brightness), 0, 1),
    inharmonicity: clamp(
      finiteOr(settings.inharmonicity, LINEAR_DRUM_DEFAULTS.inharmonicity),
      0,
      1,
    ),
    hardness: clamp(finiteOr(settings.hardness, LINEAR_DRUM_DEFAULTS.hardness), 0, 1),
    sweepRate: clamp(finiteOr(settings.sweepRate, LINEAR_DRUM_DEFAULTS.sweepRate), 4, 28),
    sweepSpeed: clamp(finiteOr(settings.sweepSpeed, LINEAR_DRUM_DEFAULTS.sweepSpeed), .2, 4),
    model: MODEL_IDS.has(settings.model) ? settings.model : LINEAR_DRUM_DEFAULTS.model,
    pitchedOrder: sanitizePitchedOrder(settings.pitchedOrder),
    karplusMorphOrder: sanitizeKarplusMorphOrder(settings.karplusMorphOrder),
  };
}

export function linearDrumParameterValue(parameterId, position) {
  const specification = PARAMETER_SPEC_BY_ID.get(parameterId);
  if (!specification) return 0;
  const amount = clamp(finiteOr(position, 0), 0, 1);
  if (specification.scale === "log") {
    return specification.min * ((specification.max / specification.min) ** amount);
  }
  return lerp(specification.min, specification.max, amount);
}

export function linearDrumParameterPosition(parameterId, value) {
  const specification = PARAMETER_SPEC_BY_ID.get(parameterId);
  if (!specification) return 0;
  const bounded = clamp(finiteOr(value, specification.min), specification.min, specification.max);
  if (specification.scale === "log") {
    return Math.log(bounded / specification.min) / Math.log(specification.max / specification.min);
  }
  return (bounded - specification.min) / (specification.max - specification.min);
}

export function sanitizeLinearDrumParameterMaps(source = {}) {
  const maps = source && typeof source === "object" ? source : {};
  return Object.fromEntries(LINEAR_DRUM_PARAMETER_SPECS.map((specification) => {
    const fallback = LINEAR_DRUM_DEFAULT_MAPS[specification.id];
    const candidate = maps[specification.id];
    const mapping = candidate && typeof candidate === "object" ? candidate : fallback;
    return [specification.id, {
      enabled: Boolean(mapping.enabled),
      source: mapping.source === "vertical" ? "vertical" : "pitch",
      low: clamp(finiteOr(mapping.low, fallback.low), specification.min, specification.max),
      high: clamp(finiteOr(mapping.high, fallback.high), specification.min, specification.max),
      curve: clamp(finiteOr(mapping.curve, fallback.curve), -1, 1),
    }];
  }));
}

export function cloneDefaultLinearDrumParameterMaps() {
  return sanitizeLinearDrumParameterMaps(LINEAR_DRUM_DEFAULT_MAPS);
}

export function sanitizeLinearDrumSettings(source = {}) {
  const settings = source && typeof source === "object" ? source : {};
  return {
    ...sanitizeCoreLinearDrumSettings(settings),
    parameterMaps: sanitizeLinearDrumParameterMaps(settings.parameterMaps),
  };
}

function freezePreset(id, name, overrides = {}, parameterMaps = {}) {
  const settings = sanitizeLinearDrumSettings({
    ...LINEAR_DRUM_DEFAULTS,
    ...overrides,
    parameterMaps,
  });
  settings.parameterMaps = Object.freeze(Object.fromEntries(
    Object.entries(settings.parameterMaps).map(([key, mapping]) => [key, Object.freeze(mapping)]),
  ));
  settings.pitchedOrder = Object.freeze([...settings.pitchedOrder]);
  settings.karplusMorphOrder = Object.freeze([...settings.karplusMorphOrder]);
  return Object.freeze({ id, name, settings: Object.freeze(settings) });
}

const pitchMap = (low, high, curve = 0) => ({ enabled: true, source: "pitch", low, high, curve });
const verticalMap = (low, high, curve = 0) => ({
  enabled: true, source: "vertical", low, high, curve,
});

export const LINEAR_DRUM_PRESETS = Object.freeze([
  freezePreset("natural-line", "Natural Line"),
  freezePreset("sub-cavern", "Sub Cavern", {
    model: "modal", kickTomHz: 165, tomHandHz: 1_050, handAirHz: 7_200,
    morphWidth: 1.4, attack: .002, decay: 1.55, pitchFall: 1.42,
    strikeNoise: .42, brightness: .22, inharmonicity: .45, hardness: .3,
  }),
  freezePreset("rubber-arc", "Rubber Arc", {
    kickTomHz: 145, tomHandHz: 880, handAirHz: 5_900, morphWidth: .82,
    attack: .0035, decay: .92, pitchFall: 1.7, strikeNoise: .32,
    brightness: .34, inharmonicity: .28, hardness: .4,
  }, { hardness: pitchMap(.18, .72), pitchFall: pitchMap(1.8, .08) }),
  freezePreset("tom-field", "Tom Field", {
    model: "modal", kickTomHz: 72, tomHandHz: 1_380, handAirHz: 8_600,
    morphWidth: 1.72, attack: .0025, decay: 1.2, pitchFall: .72,
    strikeNoise: .22, brightness: .42, inharmonicity: .62, hardness: .48,
  }),
  freezePreset("skin-ladder", "Skin Ladder", {
    kickTomHz: 92, tomHandHz: 470, handAirHz: 3_300, morphWidth: .74,
    attack: .0013, decay: .58, pitchFall: .62, strikeNoise: .9,
    brightness: .6, inharmonicity: .7, hardness: .68,
  }, {
    strikeNoise: pitchMap(.18, 1.42),
    brightness: pitchMap(.32, .96),
    hardness: pitchMap(.35, .94),
  }),
  freezePreset("bongo-wire", "Bongo Wire", {
    model: "fm", kickTomHz: 66, tomHandHz: 360, handAirHz: 3_900,
    morphWidth: .62, attack: .001, decay: .36, pitchFall: .28,
    strikeNoise: .56, brightness: .66, inharmonicity: .82, hardness: .78,
  }),
  freezePreset("dry-wood", "Dry Wood", {
    model: "modal", kickTomHz: 58, tomHandHz: 280, handAirHz: 2_100,
    morphWidth: .5, attack: .001, decay: .16, pitchFall: .12,
    strikeNoise: .8, brightness: .72, inharmonicity: .88, hardness: .93,
  }),
  freezePreset("air-needles", "Air Needles", {
    model: "fm", kickTomHz: 58, tomHandHz: 260, handAirHz: 2_050,
    morphWidth: .42, attack: .001, decay: .09, pitchFall: .03,
    strikeNoise: 1.52, brightness: .98, inharmonicity: .94, hardness: 1,
  }),
  freezePreset("soft-rise", "Soft Rise", {
    attack: .008, decay: .8, pitchFall: .86, strikeNoise: .72,
    brightness: .48, inharmonicity: .52, hardness: .45,
  }, {
    attack: pitchMap(.012, .0015),
    decay: pitchMap(1.25, .11),
    hardness: pitchMap(.12, .72),
  }),
  freezePreset("hard-rise", "Hard Rise", {
    attack: .001, decay: .52, strikeNoise: .82, brightness: .6, hardness: .62,
    sweepRate: 15, sweepSpeed: 1.35,
  }, {
    strikeNoise: pitchMap(.08, 1.55),
    brightness: pitchMap(.18, 1),
    hardness: pitchMap(.1, 1),
    sweepRate: pitchMap(7, 27),
  }),
  freezePreset("reverse-weight", "Reverse Weight", {
    attack: .002, decay: .62, pitchFall: .8, strikeNoise: .8,
    brightness: .55, inharmonicity: .64, hardness: .6,
  }, {
    decay: pitchMap(.11, 1.45),
    strikeNoise: pitchMap(1.45, .08),
    brightness: pitchMap(.96, .2),
    hardness: pitchMap(.96, .14),
    sweepSpeed: pitchMap(2.8, .42),
  }),
  freezePreset("string-keys", "Harp Keys", {
    model: "pitched", pitchedOrder: ["harp", "harpsichord", "piano"],
    rangeMin: 40, rangeMax: 12_000,
    kickTomHz: 145, tomHandHz: 1_050, handAirHz: 5_400, morphWidth: 1.35,
    attack: .0022, decay: 1.25, pitchFall: 0, strikeNoise: .58,
    brightness: .67, inharmonicity: .28, hardness: .56,
  }, {
    decay: pitchMap(2.05, .28, .22),
    strikeNoise: pitchMap(.2, .92, -.18),
    brightness: pitchMap(.46, .94, -.3),
    inharmonicity: pitchMap(.08, .62, .24),
    hardness: pitchMap(.2, .9, .12),
  }),
  freezePreset("reverse-keys", "Reverse Keys", {
    model: "pitched", pitchedOrder: ["piano", "harpsichord", "harp"],
    rangeMin: 36, rangeMax: 12_000,
    kickTomHz: 125, tomHandHz: 920, handAirHz: 5_800, morphWidth: 1.5,
    attack: .002, decay: 1.1, pitchFall: 0, strikeNoise: .5,
    brightness: .64, inharmonicity: .3, hardness: .54,
  }, {
    decay: pitchMap(1.25, .62, -.18),
    brightness: pitchMap(.82, .48, .2),
    hardness: pitchMap(.76, .24, -.2),
  }),
  freezePreset("wood-bars", "Wood Bars", {
    model: "pitched", pitchedOrder: ["marimba", "kalimba", "xylophone"],
    rangeMin: 45, rangeMax: 14_000,
    kickTomHz: 150, tomHandHz: 1_180, handAirHz: 4_800, morphWidth: 1.1,
    attack: .0012, decay: .82, pitchFall: 0, strikeNoise: .72,
    brightness: .62, inharmonicity: .7, hardness: .68,
  }, {
    decay: pitchMap(1.35, .1, .18),
    strikeNoise: pitchMap(.2, 1.18, -.25),
    brightness: pitchMap(.38, .94, -.18),
    hardness: pitchMap(.32, .98, .12),
  }),
  freezePreset("tine-reverse", "Tine Reverse", {
    model: "pitched", pitchedOrder: ["kalimba", "xylophone", "marimba"],
    rangeMin: 38, rangeMax: 13_000,
    kickTomHz: 105, tomHandHz: 780, handAirHz: 5_200, morphWidth: .86,
    attack: .001, decay: .66, pitchFall: 0, strikeNoise: .68,
    brightness: .7, inharmonicity: .8, hardness: .76,
  }, {
    decay: pitchMap(.72, 1.08, -.28),
    strikeNoise: pitchMap(.55, .22, .3),
    brightness: pitchMap(.86, .48, .2),
    inharmonicity: pitchMap(.92, .5, .16),
  }),
  freezePreset("y-expression", "Y Expression", {
    attack: .0025, decay: .75, pitchFall: .82, strikeNoise: .72,
    brightness: .54, inharmonicity: .62, hardness: .55,
  }, {
    decay: verticalMap(1.45, .12),
    strikeNoise: verticalMap(.12, 1.48),
    brightness: verticalMap(.24, .96),
    hardness: verticalMap(.16, .98),
  }),
]);

export function linearDrumFrequencyAtPosition(position, minimum = 20, maximum = 16_000) {
  const low = clamp(finiteOr(minimum, 20), LINEAR_DRUM_FREQUENCY_MIN, LINEAR_DRUM_FREQUENCY_MAX);
  const high = clamp(finiteOr(maximum, 16_000), low, LINEAR_DRUM_FREQUENCY_MAX);
  return low * ((high / low) ** clamp(finiteOr(position, 0), 0, 1));
}

export function linearDrumPositionAtFrequency(frequency, minimum = 20, maximum = 16_000) {
  const low = clamp(finiteOr(minimum, 20), LINEAR_DRUM_FREQUENCY_MIN, LINEAR_DRUM_FREQUENCY_MAX);
  const high = clamp(finiteOr(maximum, 16_000), low, LINEAR_DRUM_FREQUENCY_MAX);
  if (high === low) return 0;
  const safeFrequency = clamp(finiteOr(frequency, low), low, high);
  return Math.log(safeFrequency / low) / Math.log(high / low);
}

/** A center/width morph in logarithmic frequency space, with no threshold edge. */
export function linearDrumSigmoid(frequency, centerHz, widthOctaves = 1) {
  const safeFrequency = Math.max(LINEAR_DRUM_FREQUENCY_MIN, finiteOr(frequency, 20));
  const safeCenter = Math.max(LINEAR_DRUM_FREQUENCY_MIN, finiteOr(centerHz, 100));
  const safeWidth = clamp(finiteOr(widthOctaves, 1), .05, 8);
  const distance = Math.log2(safeFrequency / safeCenter) / safeWidth;
  return 1 / (1 + Math.exp(-4 * distance));
}

/** Shapes a normalized mapping like a crossfade curve while preserving both endpoints. */
export function linearDrumMappingAmount(amount, curve = 0) {
  const position = clamp(finiteOr(amount, 0), 0, 1);
  const bend = clamp(finiteOr(curve, 0), -1, 1);
  if (Math.abs(bend) < 1e-6) return position;
  const exponent = 2 ** (Math.abs(bend) * 2);
  return bend > 0
    ? position ** exponent
    : 1 - ((1 - position) ** exponent);
}

export function linearDrumMorphWeights(frequency, sourceSettings = {}) {
  const settings = sanitizeCoreLinearDrumSettings(sourceSettings);
  const kickToTom = linearDrumSigmoid(frequency, settings.kickTomHz, settings.morphWidth);
  const tomToHand = linearDrumSigmoid(frequency, settings.tomHandHz, settings.morphWidth);
  const handToAir = linearDrumSigmoid(frequency, settings.handAirHz, settings.morphWidth);
  return Object.freeze({
    kick: 1 - kickToTom,
    tom: kickToTom * (1 - tomToHand),
    hand: kickToTom * tomToHand * (1 - handToAir),
    air: kickToTom * tomToHand * handToAir,
  });
}

export function linearDrumPitchedMorphWeights(frequency, sourceSettings = {}) {
  const settings = sanitizeCoreLinearDrumSettings(sourceSettings);
  const firstToSecond = linearDrumSigmoid(
    frequency,
    settings.kickTomHz,
    settings.morphWidth,
  );
  const secondToThird = linearDrumSigmoid(
    frequency,
    settings.tomHandHz,
    settings.morphWidth,
  );
  const [first, second, third] = settings.pitchedOrder;
  return Object.freeze({
    [first]: 1 - firstToSecond,
    [second]: firstToSecond * (1 - secondToThird),
    [third]: firstToSecond * secondToThird,
  });
}

function mappedParameterValuesFromSettings(frequency, settings, performance = {}) {
  const pitchPosition = linearDrumPositionAtFrequency(
    frequency,
    settings.rangeMin,
    settings.rangeMax,
  );
  const verticalPosition = clamp(finiteOr(performance.vertical, .5), 0, 1);
  return Object.fromEntries(LINEAR_DRUM_PARAMETER_SPECS.map((specification) => {
    const mapping = settings.parameterMaps[specification.id];
    if (!mapping.enabled) return [specification.id, settings[specification.id]];
    const sourceAmount = mapping.source === "vertical" ? verticalPosition : pitchPosition;
    const amount = linearDrumMappingAmount(sourceAmount, mapping.curve);
    const lowPosition = linearDrumParameterPosition(specification.id, mapping.low);
    const highPosition = linearDrumParameterPosition(specification.id, mapping.high);
    return [
      specification.id,
      linearDrumParameterValue(specification.id, lerp(lowPosition, highPosition, amount)),
    ];
  }));
}

export function linearDrumMappedParameterValues(
  frequency,
  sourceSettings = {},
  performance = {},
) {
  const settings = sanitizeLinearDrumSettings(sourceSettings);
  const safeFrequency = clamp(
    finiteOr(frequency, settings.rangeMin),
    LINEAR_DRUM_FREQUENCY_MIN,
    LINEAR_DRUM_FREQUENCY_MAX,
  );
  return mappedParameterValuesFromSettings(safeFrequency, settings, performance);
}

function interpolateArchetypeValue(weights, key) {
  return ARCHETYPES.reduce((total, archetype) => total + weights[archetype.id] * archetype[key], 0);
}

function interpolateArchetypeArray(weights, key) {
  return ARCHETYPES[0][key].map((_, index) => (
    ARCHETYPES.reduce(
      (total, archetype) => total + weights[archetype.id] * archetype[key][index],
      0,
    )
  ));
}

function interpolatePitchedValue(weights, key) {
  return Object.entries(weights).reduce((total, [id, amount]) => (
    total + amount * PITCHED_ARCHETYPE_BY_ID.get(id)[key]
  ), 0);
}

function interpolatePitchedArray(weights, key) {
  return LINEAR_DRUM_PITCHED_ARCHETYPES[0][key].map((_, index) => (
    Object.entries(weights).reduce((total, [id, amount]) => (
      total + amount * PITCHED_ARCHETYPE_BY_ID.get(id)[key][index]
    ), 0)
  ));
}

export function linearDrumParameters(frequency, sourceSettings = {}, performance = {}) {
  const settings = sanitizeLinearDrumSettings(sourceSettings);
  const safeFrequency = clamp(
    finiteOr(frequency, settings.rangeMin),
    LINEAR_DRUM_FREQUENCY_MIN,
    LINEAR_DRUM_FREQUENCY_MAX,
  );
  const mappedValues = mappedParameterValuesFromSettings(safeFrequency, settings, performance);
  const effectiveSettings = { ...settings, ...mappedValues };
  const weights = linearDrumMorphWeights(safeFrequency, settings);
  const pitchedWeights = linearDrumPitchedMorphWeights(safeFrequency, settings);
  const isPitched = settings.model === "pitched";
  const naturalRatios = interpolateArchetypeArray(weights, "ratios");
  const stiffnessBlend = .3 + effectiveSettings.inharmonicity * .7;
  const modalRatios = naturalRatios.map((ratio, index) => (
    lerp(index + 1, ratio, stiffnessBlend)
  ));
  const naturalGains = interpolateArchetypeArray(weights, "gains");
  const modalGains = naturalGains.map((gain, index) => {
    const tilt = lerp(1.2 - index * .14, .72 + index * .14, effectiveSettings.brightness);
    const strikeLift = 1 + index * effectiveSettings.hardness * .13;
    return Math.max(.001, gain * tilt * strikeLift);
  });
  const pitchedRatios = interpolatePitchedArray(pitchedWeights, "ratios").map((ratio, index) => (
    ratio * (1 + effectiveSettings.inharmonicity * index * index * .0012)
  ));
  const pitchedGains = interpolatePitchedArray(pitchedWeights, "gains").map((gain, index) => {
    const spectralTilt = lerp(1.25 - index * .13, .72 + index * .16, effectiveSettings.brightness);
    return Math.max(.0005, gain * spectralTilt * (1 + index * effectiveSettings.hardness * .045));
  });
  const frequencyPosition = linearDrumPositionAtFrequency(
    safeFrequency,
    settings.rangeMin,
    settings.rangeMax,
  );
  const pitchedAir = linearDrumSigmoid(safeFrequency, settings.handAirHz, settings.morphWidth);
  const drumDecay = interpolateArchetypeValue(weights, "decay")
    * (effectiveSettings.decay / LINEAR_DRUM_DEFAULTS.decay);
  const pitchedDecay = effectiveSettings.decay
    * interpolatePitchedValue(pitchedWeights, "decayScale");
  const drumNoiseMix = interpolateArchetypeValue(weights, "noiseMix")
    * effectiveSettings.strikeNoise;
  const pitchedNoiseMix = (
    interpolatePitchedValue(pitchedWeights, "noiseMix") + pitchedAir * .28
  ) * effectiveSettings.strikeNoise;
  const drumNoiseColor = interpolateArchetypeValue(weights, "noiseColor")
    + (effectiveSettings.brightness - .5) * .34;
  const pitchedNoiseColor = interpolatePitchedValue(pitchedWeights, "noiseColor")
    + pitchedAir * .18 + (effectiveSettings.brightness - .5) * .28;

  return Object.freeze({
    frequency: safeFrequency,
    frequencyPosition,
    verticalPosition: clamp(finiteOr(performance.vertical, .5), 0, 1),
    model: settings.model,
    weights,
    pitchedWeights,
    bodyWeights: isPitched ? pitchedWeights : weights,
    pitchedOrder: Object.freeze([...settings.pitchedOrder]),
    karplusMorphOrder: Object.freeze([...settings.karplusMorphOrder]),
    mappedValues: Object.freeze(mappedValues),
    modalRatios: Object.freeze(modalRatios),
    modalGains: Object.freeze(modalGains),
    pitchedRatios: Object.freeze(pitchedRatios),
    pitchedGains: Object.freeze(pitchedGains),
    attack: effectiveSettings.attack,
    decay: isPitched ? pitchedDecay : drumDecay,
    highDamping: isPitched
      ? interpolatePitchedValue(pitchedWeights, "highDamping")
      : interpolateArchetypeValue(weights, "highDamping"),
    pitchDropOctaves: isPitched ? 0 : (
      interpolateArchetypeValue(weights, "pitchDropOctaves") * effectiveSettings.pitchFall
    ),
    pitchDropSeconds: interpolateArchetypeValue(weights, "pitchDropSeconds"),
    noiseMix: clamp(isPitched ? pitchedNoiseMix : drumNoiseMix, 0, 1.4),
    noiseDecay: isPitched
      ? lerp(.018, .065, effectiveSettings.hardness) * lerp(1, 1.45, pitchedAir)
      : interpolateArchetypeValue(weights, "noiseDecay")
        * lerp(.72, 1.35, effectiveSettings.hardness),
    noiseColor: clamp(isPitched ? pitchedNoiseColor : drumNoiseColor, 0, 1),
    bodyMix: isPitched ? 1 : interpolateArchetypeValue(weights, "bodyMix"),
    pitchedDetune: interpolatePitchedValue(pitchedWeights, "detune")
      * lerp(.45, 1.35, effectiveSettings.inharmonicity),
    fmRatio: interpolateArchetypeValue(weights, "fmRatio")
      * lerp(.92, 1.08, effectiveSettings.inharmonicity),
    fmIndex: interpolateArchetypeValue(weights, "fmIndex")
      * lerp(.72, 1.24, effectiveSettings.inharmonicity),
    fmDecay: interpolateArchetypeValue(weights, "fmDecay")
      * (effectiveSettings.decay / LINEAR_DRUM_DEFAULTS.decay),
    hardness: effectiveSettings.hardness,
    brightness: effectiveSettings.brightness,
    inharmonicity: effectiveSettings.inharmonicity,
    strikeNoise: effectiveSettings.strikeNoise,
    sweepRate: effectiveSettings.sweepRate,
    sweepSpeed: effectiveSettings.sweepSpeed,
  });
}

export function linearDrumBlendLabel(weights) {
  const labels = new Map([
    ["kick", "kick"], ["tom", "tom"], ["hand", "hand"], ["air", "air"],
    ...LINEAR_DRUM_PITCHED_ARCHETYPES.map(({ id, label }) => [id, label.toLowerCase()]),
  ]);
  const entries = Object.entries(weights ?? {})
    .map(([name, amount]) => [labels.get(name) ?? name, clamp(finiteOr(amount, 0), 0, 1)])
    .sort((left, right) => right[1] - left[1]);
  const visible = entries.filter(([, amount], index) => index === 0 || amount >= .08).slice(0, 2);
  return visible.map(([name, amount]) => `${Math.round(amount * 100)}% ${name}`).join(" / ");
}

function karplusStrongSettingsFromLinearParameters(parameters) {
  const weightKeys = ["kick", "tom", "hand", "air"];
  const morphed = Object.fromEntries(KARPLUS_MORPH_PARAMETER_KEYS.map((key) => {
    const value = weightKeys.reduce((total, weightKey, index) => {
      const presetId = parameters.karplusMorphOrder[index];
      const preset = KARPLUS_PRESET_BY_ID.get(presetId) ?? KARPLUS_STRONG_PRESETS[index];
      return total + parameters.weights[weightKey] * preset.settings[key];
    }, 0);
    return [key, value];
  }));
  const decayScale = parameters.mappedValues.decay / LINEAR_DRUM_DEFAULTS.decay;
  const brightnessDelta = parameters.brightness - LINEAR_DRUM_DEFAULTS.brightness;
  const hardnessDelta = parameters.hardness - LINEAR_DRUM_DEFAULTS.hardness;
  const stiffnessDelta = parameters.inharmonicity - LINEAR_DRUM_DEFAULTS.inharmonicity;
  const noiseScale = parameters.strikeNoise / LINEAR_DRUM_DEFAULTS.strikeNoise;
  const gesturePick = .05 + parameters.verticalPosition * .9;

  return sanitizeKarplusStrongSettings({
    ...morphed,
    frequency: parameters.frequency,
    decay: morphed.decay * clamp(decayScale, .15, 6),
    brightness: clamp(morphed.brightness + brightnessDelta * .72, 0, 1),
    hardness: clamp(morphed.hardness + hardnessDelta * .72, 0, 1),
    excitationColor: clamp(morphed.excitationColor + brightnessDelta * .24, 0, 1),
    excitationShape: clamp(morphed.excitationShape + hardnessDelta * .28, 0, 1),
    burstLength: morphed.burstLength * clamp(.62 + noiseScale * .38, .35, 1.35),
    pickPosition: lerp(morphed.pickPosition, gesturePick, .72),
    pickWidth: clamp(morphed.pickWidth + hardnessDelta * .2, 0, 1),
    dispersion: clamp(morphed.dispersion + stiffnessDelta * .55, 0, 1),
    drive: clamp(morphed.drive + hardnessDelta * .34, 0, 1),
    roughness: clamp(morphed.roughness + Math.max(0, noiseScale - 1) * .28, 0, 1),
    coupling: clamp(morphed.coupling + stiffnessDelta * .28, 0, 1),
    level: .62,
  });
}

export function linearDrumKarplusStrongSettings(frequency, sourceSettings = {}, performance = {}) {
  return karplusStrongSettingsFromLinearParameters(
    linearDrumParameters(frequency, sourceSettings, performance),
  );
}

function cancelledAudioStart() {
  const error = new Error("Linear Drums audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

export class LinearDrumAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.noiseBuffer = null;
    this.output = .62;
    this.activeVoices = [];
    this.lifecycleGeneration = 0;
  }

  async start() {
    const lifecycleGeneration = this.lifecycleGeneration;
    let context = this.context;
    if (!context || context.state === "closed") {
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not available in this browser.");
      context = new Context();
      this.context = context;
      this.input = context.createGain();
      this.input.gain.value = .78;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -15;
      compressor.knee.value = 9;
      compressor.ratio.value = 10;
      compressor.attack.value = .0015;
      compressor.release.value = .14;
      this.master = context.createGain();
      this.master.gain.value = this.output;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = .72;
      this.input.connect(compressor);
      compressor.connect(this.master);
      this.master.connect(this.analyser);
      this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });
      this.noiseBuffer = this.#createNoiseBuffer(context);
    }
    if (context.state && context.state !== "running") {
      unlockAudioContext(context);
      await context.resume();
    }
    if (
      lifecycleGeneration !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw cancelledAudioStart();
    return context;
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, 0), 0, .85);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.output, this.context.currentTime, .015);
    }
  }

  async trigger(frequency, sourceSettings = {}, options = {}) {
    const context = await this.start();
    if (context !== this.context || context.state === "closed") throw cancelledAudioStart();
    const parameters = linearDrumParameters(frequency, sourceSettings, {
      vertical: options.performanceY,
    });
    const minimumVelocity = clamp(finiteOr(options.minimumVelocity, .05), .001, .05);
    const velocity = clamp(finiteOr(options.velocity, .82), minimumVelocity, 1);
    const requestedStartAt = options.startAt === undefined || options.startAt === null
      ? Number.NaN
      : Number(options.startAt);
    const now = Number.isFinite(requestedStartAt)
      ? Math.max(context.currentTime, requestedStartAt)
      : context.currentTime + clamp(finiteOr(options.delay, 0), 0, .12);
    const voice = this.#createVoice(now, velocity);
    const engine = options.engine === "karplus-strong" || parameters.model === "karplus-strong"
      ? "karplus-strong"
      : "rattlesnake";

    if (engine === "karplus-strong") {
      this.#addKarplusStrongBody(parameters, voice, now);
    } else {
      const model = parameters.model;
      if (model === "pitched") {
        this.#addPitchedBody(parameters, voice, now);
      } else if (model === "modal" || model === "hybrid") {
        this.#addModalBody(parameters, voice, now, model === "hybrid" ? .75 : 1);
      }
      if (model === "fm" || model === "hybrid") {
        this.#addFmBody(parameters, voice, now, model === "hybrid" ? .42 : .82);
      }
      this.#addImpact(parameters, voice, now);
    }
    this.#registerVoice(voice, now);
    return parameters;
  }

  #createVoice(now, velocity) {
    const output = this.context.createGain();
    output.gain.setValueAtTime(.38 * velocity, now);
    output.connect(this.input);
    return { output, sources: [], stopAt: now + .2 };
  }

  #addKarplusStrongBody(parameters, voice, now) {
    const settings = karplusStrongSettingsFromLinearParameters(parameters);
    const pan = (parameters.frequencyPosition * 2 - 1) * settings.spread;
    this.#addKarplusStrongVoice(settings, voice, now, 1.45, pan);

    const coupledFrequency = settings.frequency
      * settings.couplingRatio
      * (2 ** (settings.couplingDetune / 1_200));
    if (settings.coupling > .04 && coupledFrequency < this.context.sampleRate * .22) {
      this.#addKarplusStrongVoice({
        ...settings,
        frequency: coupledFrequency,
        decay: Math.max(.2, settings.decay * (.42 + settings.coupling * .28)),
        damping: clamp(settings.damping + .12, 0, 1),
        brightness: clamp(settings.brightness - .08, 0, 1),
        hardness: settings.hardness * .72,
        pickPosition: 1 - settings.pickPosition,
        pickupPosition: 1 - settings.pickupPosition,
        coupling: 0,
      }, voice, now + .006, settings.coupling * .44, -pan);
    }
  }

  #addKarplusStrongVoice(settings, voice, now, level, pan) {
    const context = this.context;
    const duration = clamp(.14 + settings.decay * 1.02, .18, 16.5);
    const samples = generateKarplusStrongSamples({
      ...settings,
      sampleRate: context.sampleRate,
      duration,
    });
    const analysisFrames = Math.min(samples.length, Math.ceil(context.sampleRate * .14));
    let energy = 0;
    for (let index = 0; index < analysisFrames; index += 1) {
      energy += samples[index] * samples[index];
    }
    const openingRms = Math.sqrt(energy / Math.max(1, analysisFrames));
    const normalization = clamp(.24 / Math.max(.0001, openingRms), 1.15, 3.6);
    const normalizedSamples = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      normalizedSamples[index] = clamp(samples[index] * normalization, -1, 1);
    }
    const buffer = context.createBuffer(1, normalizedSamples.length, context.sampleRate);
    if (typeof buffer.copyToChannel === "function") buffer.copyToChannel(normalizedSamples, 0);
    else buffer.getChannelData(0).set(normalizedSamples);

    const source = context.createBufferSource();
    const tone = context.createBiquadFilter();
    const body = context.createBiquadFilter();
    const mix = context.createGain();
    const panner = typeof context.createStereoPanner === "function"
      ? context.createStereoPanner()
      : null;
    source.buffer = buffer;
    tone.type = "lowpass";
    tone.frequency.value = Math.min(
      context.sampleRate * .44,
      500 + settings.brightness ** 1.45 * 19_000,
    );
    tone.Q.value = .3 + settings.dispersion * 1.1;
    body.type = "peaking";
    body.frequency.value = Math.min(
      context.sampleRate * .4,
      settings.frequency * settings.bodyTune,
    );
    body.Q.value = settings.bodyQ;
    body.gain.value = settings.body * 10;
    mix.gain.value = Math.max(.0002, level);
    source.connect(tone).connect(body).connect(mix);
    if (panner) {
      panner.pan.value = pan;
      mix.connect(panner).connect(voice.output);
    } else {
      mix.connect(voice.output);
    }
    source.start(now);
    source.stop(now + duration + .01);
    voice.sources.push(source);
    voice.stopAt = Math.max(voice.stopAt, now + duration + .01);
  }

  #addModalBody(parameters, voice, now, modelLevel) {
    const context = this.context;
    const nyquist = context.sampleRate * .5;
    const gainTotal = parameters.modalGains.reduce((sum, gain) => sum + gain, 0);
    parameters.modalRatios.forEach((ratio, index) => {
      const targetFrequency = parameters.frequency * ratio;
      const aliasFade = 1 - smoothstep(nyquist * .68, nyquist * .94, targetFrequency);
      if (aliasFade <= .001) return;
      const modeDecay = Math.max(
        .018,
        parameters.decay / (1 + index * parameters.highDamping * .42),
      );
      const amplitude = context.createGain();
      const level = Math.max(
        .0002,
        modelLevel * parameters.bodyMix * parameters.modalGains[index] / gainTotal * aliasFade,
      );
      amplitude.gain.setValueAtTime(.0001, now);
      amplitude.gain.exponentialRampToValueAtTime(level, now + parameters.attack);
      amplitude.gain.exponentialRampToValueAtTime(
        .0001,
        now + parameters.attack + modeDecay,
      );
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      const startFrequency = Math.min(
        nyquist * .92,
        targetFrequency * (2 ** parameters.pitchDropOctaves),
      );
      oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), now);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, targetFrequency),
        now + parameters.pitchDropSeconds,
      );
      oscillator.connect(amplitude);
      amplitude.connect(voice.output);
      oscillator.start(now);
      oscillator.stop(now + parameters.attack + modeDecay + .035);
      voice.sources.push(oscillator);
      voice.stopAt = Math.max(voice.stopAt, now + parameters.attack + modeDecay + .035);
    });
  }

  #addFmBody(parameters, voice, now, modelLevel) {
    const context = this.context;
    const nyquist = context.sampleRate * .5;
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulation = context.createGain();
    const amplitude = context.createGain();
    const bodyDecay = Math.max(.025, parameters.decay * .76);
    const targetFrequency = Math.min(nyquist * .92, parameters.frequency);
    const aliasFade = 1 - smoothstep(nyquist * .55, nyquist * .94, parameters.frequency);
    const startFrequency = Math.min(
      nyquist * .92,
      targetFrequency * (2 ** parameters.pitchDropOctaves),
    );
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(Math.max(20, startFrequency), now);
    carrier.frequency.exponentialRampToValueAtTime(
      Math.max(20, targetFrequency),
      now + parameters.pitchDropSeconds,
    );
    modulator.type = "sine";
    modulator.frequency.value = Math.min(nyquist * .9, parameters.frequency * parameters.fmRatio);
    modulation.gain.setValueAtTime(
      Math.max(
        .001,
        Math.min(nyquist * .42, parameters.frequency * parameters.fmIndex) * aliasFade,
      ),
      now,
    );
    modulation.gain.exponentialRampToValueAtTime(
      .001,
      now + Math.max(.02, parameters.attack + parameters.fmDecay),
    );
    amplitude.gain.setValueAtTime(.0001, now);
    amplitude.gain.exponentialRampToValueAtTime(
      Math.max(.001, modelLevel * parameters.bodyMix * aliasFade),
      now + parameters.attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(
      .0001,
      now + parameters.attack + bodyDecay,
    );
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    carrier.connect(amplitude);
    amplitude.connect(voice.output);
    carrier.start(now);
    modulator.start(now);
    carrier.stop(now + parameters.attack + bodyDecay + .03);
    modulator.stop(now + parameters.attack + bodyDecay + .03);
    voice.sources.push(carrier, modulator);
    voice.stopAt = Math.max(voice.stopAt, now + parameters.attack + bodyDecay + .03);
  }

  #addPitchedBody(parameters, voice, now) {
    const context = this.context;
    const nyquist = context.sampleRate * .5;
    const gainTotal = parameters.pitchedGains.reduce((sum, gain, index) => {
      const targetFrequency = parameters.frequency * parameters.pitchedRatios[index];
      return targetFrequency < nyquist * .96 ? sum + gain : sum;
    }, 0) || 1;
    const stringAmount = (parameters.pitchedWeights.harp ?? 0) * .22
      + (parameters.pitchedWeights.harpsichord ?? 0) * .12
      + (parameters.pitchedWeights.piano ?? 0) * .34;

    parameters.pitchedRatios.forEach((ratio, index) => {
      const targetFrequency = parameters.frequency * ratio;
      const aliasFade = 1 - smoothstep(nyquist * .72, nyquist * .96, targetFrequency);
      if (aliasFade <= .001) return;
      const modeDecay = Math.max(
        .025,
        parameters.decay / (1 + index * parameters.highDamping * .48),
      );
      const amplitude = context.createGain();
      const level = Math.max(
        .0002,
        parameters.pitchedGains[index] / gainTotal * aliasFade * .94,
      );
      amplitude.gain.setValueAtTime(.0001, now);
      amplitude.gain.exponentialRampToValueAtTime(level, now + parameters.attack);
      amplitude.gain.exponentialRampToValueAtTime(
        .0001,
        now + parameters.attack + modeDecay,
      );

      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = Math.max(20, targetFrequency);
      oscillator.connect(amplitude);
      amplitude.connect(voice.output);
      oscillator.start(now);
      oscillator.stop(now + parameters.attack + modeDecay + .035);
      voice.sources.push(oscillator);

      if (index < 3 && stringAmount > .02 && parameters.pitchedDetune > .01) {
        const pairedOscillator = context.createOscillator();
        const pairedMix = context.createGain();
        const direction = index % 2 ? -1 : 1;
        pairedOscillator.type = "sine";
        pairedOscillator.frequency.value = Math.max(
          20,
          targetFrequency * (2 ** (direction * parameters.pitchedDetune / 1_200)),
        );
        pairedMix.gain.value = stringAmount;
        pairedOscillator.connect(pairedMix);
        pairedMix.connect(amplitude);
        pairedOscillator.start(now);
        pairedOscillator.stop(now + parameters.attack + modeDecay + .035);
        voice.sources.push(pairedOscillator);
      }
      voice.stopAt = Math.max(voice.stopAt, now + parameters.attack + modeDecay + .035);
    });
  }

  #addImpact(parameters, voice, now) {
    const context = this.context;
    const nyquist = context.sampleRate * .5;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const bodyFilter = context.createBiquadFilter();
    const airFilter = context.createBiquadFilter();
    const bodyGain = context.createGain();
    const airGain = context.createGain();
    const noiseLevel = .08 + parameters.noiseMix * .66;
    const airAmount = smoothstep(.2, .9, parameters.noiseColor);
    const impactDecay = Math.max(.009, parameters.noiseDecay);
    const impactDuration = parameters.attack + impactDecay;

    bodyFilter.type = "bandpass";
    bodyFilter.frequency.value = Math.min(
      nyquist * .84,
      Math.max(95, parameters.frequency * lerp(5.5, 2.1, parameters.noiseColor)),
    );
    bodyFilter.Q.value = lerp(1.7, .58, parameters.hardness);
    airFilter.type = "highpass";
    airFilter.frequency.value = Math.min(
      nyquist * .78,
      lerp(650, 8_500, parameters.noiseColor ** 1.45),
    );
    airFilter.Q.value = .7;

    const scheduleImpactGain = (gain, peak, duration) => {
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(.0002, peak),
        now + parameters.attack,
      );
      gain.gain.exponentialRampToValueAtTime(
        .0001,
        now + parameters.attack + duration,
      );
    };
    scheduleImpactGain(bodyGain, noiseLevel * (1 - airAmount * .64), impactDecay * .78);
    scheduleImpactGain(airGain, noiseLevel * (.16 + airAmount * .84), impactDecay);
    source.connect(bodyFilter);
    source.connect(airFilter);
    bodyFilter.connect(bodyGain);
    airFilter.connect(airGain);
    bodyGain.connect(voice.output);
    airGain.connect(voice.output);
    const maxOffset = Math.max(0, this.noiseBuffer.duration - impactDuration - .01);
    source.start(now, Math.random() * maxOffset);
    source.stop(now + impactDuration + .02);
    voice.sources.push(source);
    voice.stopAt = Math.max(voice.stopAt, now + impactDuration + .02);
  }

  #registerVoice(voice, now) {
    this.activeVoices = this.activeVoices.filter(({ stopAt }) => stopAt > now);
    while (this.activeVoices.length >= 24) {
      const oldest = this.activeVoices.shift();
      if (!oldest) break;
      oldest.output.gain.cancelScheduledValues(now);
      oldest.output.gain.setTargetAtTime(0, now, .006);
      for (const source of oldest.sources) {
        try { source.stop(now + .025); } catch { /* already stopped */ }
      }
    }
    this.activeVoices.push(voice);
    const disconnectDelay = Math.max(0, voice.stopAt - now + .08) * 1_000;
    this.runtime.setTimeout?.(() => {
      try { voice.output.disconnect(); } catch { /* already disconnected */ }
      this.activeVoices = this.activeVoices.filter((candidate) => candidate !== voice);
    }, disconnectDelay);
  }

  /** Fade active and look-ahead-scheduled strikes without closing the engine. */
  silence() {
    const context = this.context;
    if (!context) {
      this.activeVoices = [];
      return;
    }
    const now = Number(context.currentTime) || 0;
    for (const voice of this.activeVoices) {
      try {
        const gain = voice.output?.gain;
        if (typeof gain?.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
        else gain?.cancelScheduledValues?.(now);
        gain?.setTargetAtTime?.(0, now, .004);
      } catch {
        // A completed voice is already silent.
      }
      for (const source of voice.sources ?? []) {
        try { source.stop(now + .025); } catch { /* already stopped */ }
      }
    }
    this.activeVoices = [];
  }

  #createNoiseBuffer(context) {
    const frameCount = Math.ceil(context.sampleRate * 1.25);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * .18 + white * .82;
      samples[index] = previous;
    }
    return buffer;
  }

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.silence();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    this.noiseBuffer = null;
    this.activeVoices = [];
    if (context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
  }
}

function smoothstep(start, end, value) {
  if (start === end) return value < start ? 0 : 1;
  const amount = clamp((value - start) / (end - start), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
