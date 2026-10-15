import {
  LINEAR_DRUM_DEFAULTS,
  LINEAR_DRUM_MODELS,
  LINEAR_DRUM_PARAMETER_SPECS,
  LINEAR_DRUM_PITCHED_ARCHETYPES,
  LINEAR_DRUM_PRESETS,
  linearDrumParameterValue,
  sanitizeLinearDrumSettings,
} from "./linear-drums.js";
import { KARPLUS_STRONG_PRESETS } from "../karplus-strong/karplus-strong.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const LINEAR_DRUM_PRESET_KEYS = Object.freeze([
  "rangeMin", "rangeMax", "kickTomHz", "tomHandHz", "handAirHz", "morphWidth", "attack", "decay", "pitchFall",
  "strikeNoise", "brightness", "inharmonicity", "hardness", "sweepRate", "sweepSpeed", "model", "pitchedOrder",
  "karplusMorphOrder", "parameterMaps", "sweepMode",
]);
const SWEEP_MODES = ["pendulum", "up", "down"];
const MODEL_IDS = LINEAR_DRUM_MODELS.map(model => model.id);
const PITCHED_IDS = LINEAR_DRUM_PITCHED_ARCHETYPES.map(archetype => archetype.id);
const KARPLUS_IDS = KARPLUS_STRONG_PRESETS.map(preset => preset.id);

export function captureLinearDrumPreset(source) {
  const settings = sanitizeLinearDrumSettings(source);
  return {
    ...Object.fromEntries(LINEAR_DRUM_PRESET_KEYS.filter(key => key !== "sweepMode").map(key => [key, settings[key]])),
    sweepMode: SWEEP_MODES.includes(source?.sweepMode) ? source.sweepMode : "pendulum",
  };
}

export function validateLinearDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureLinearDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete Rattlesnake preset");
  }
  return snapshot;
}

const map = (source, low, high, curve = 0) => ({ enabled: true, source, low, high, curve });
const rattle = (id, label, sweepMode, extra = {}) => {
  const local = LINEAR_DRUM_PRESETS.find(preset => preset.id === id);
  return Object.freeze({
    id, label,
    snapshot: deepFreeze(captureLinearDrumPreset({ ...local.settings, ...extra, parameterMaps: { ...local.settings.parameterMaps, ...extra.parameterMaps }, sweepMode })),
  });
};
const strings = (id, label, order, values, parameterMaps = {}, sweepMode = "pendulum") => Object.freeze({
  id, label,
  snapshot: deepFreeze(captureLinearDrumPreset({
    ...LINEAR_DRUM_DEFAULTS, model: "karplus-strong", karplusMorphOrder: order, ...values, parameterMaps, sweepMode,
  })),
});
function deepFreeze(value) {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const LINEAR_DRUM_FULL_PRESETS = Object.freeze([
  rattle("natural-line", "Natural line", "pendulum"),
  rattle("sub-cavern", "Sub cavern", "down", { sweepRate: 9, sweepSpeed: .6 }),
  rattle("rubber-arc", "Rubber arc", "pendulum", { sweepRate: 20, sweepSpeed: 2.2 }),
  rattle("skin-ladder", "Skin ladder", "up", { sweepRate: 24, sweepSpeed: 1.1 }),
  rattle("bongo-wire", "Bongo wire", "pendulum", { sweepRate: 27, sweepSpeed: 3.2 }),
  rattle("soft-rise", "Soft rise", "up", { sweepRate: 7, sweepSpeed: .45 }),
  rattle("reverse-weight", "Reverse weight", "down", { sweepRate: 12, sweepSpeed: .9 }),
  rattle("string-keys", "Harp keys", "up", { sweepRate: 10, sweepSpeed: .7 }),
  rattle("wood-bars", "Wood bars", "pendulum", { sweepRate: 14, sweepSpeed: 1.6 }),
  strings("nylon-fall", "Nylon to glass", ["nylon", "steel", "kalimba", "glass"], {
    kickTomHz: 120, tomHandHz: 640, handAirHz: 4_200, morphWidth: 1.2, decay: 2.4, brightness: .5, inharmonicity: .3, hardness: .4,
    sweepRate: 8, sweepSpeed: .8,
  }, { decay: map("pitch", 3.5, .4, .2), brightness: map("pitch", .3, .95) }, "up"),
  strings("banjo-rain", "Banjo rain", ["bass", "banjo", "muted", "jawari"], {
    rangeMin: 30, kickTomHz: 90, tomHandHz: 520, handAirHz: 3_600, morphWidth: .8, decay: 1.1, brightness: .7, inharmonicity: .6, hardness: .75,
    sweepRate: 22, sweepSpeed: 2.6,
  }, { hardness: map("pitch", .3, .98, .1), decay: map("vertical", 2, .2) }),
  strings("prepared-garden", "Prepared garden", ["prepared", "rubber", "inverted", "choir"], {
    kickTomHz: 160, tomHandHz: 980, handAirHz: 6_400, morphWidth: 1.6, decay: 3.2, brightness: .4, inharmonicity: .8, hardness: .5,
    sweepRate: 6, sweepSpeed: .4,
  }, { inharmonicity: map("pitch", .9, .3, -.2), brightness: map("vertical", .2, .9) }, "down"),
  strings("ghost-dust", "Ghost dust", ["ghost", "dust", "frozen", "broken"], {
    rangeMin: 50, rangeMax: 9_000, kickTomHz: 70, tomHandHz: 400, handAirHz: 2_800, morphWidth: .5, decay: 5.5, brightness: .25, inharmonicity: .9, hardness: .2,
    sweepRate: 5, sweepSpeed: .25,
  }, { decay: map("pitch", 6, 1, .3), strikeNoise: map("vertical", .1, 1.2) }),
  strings("glass-choir", "Glass choir", ["choir", "glass", "choir", "kalimba"], {
    kickTomHz: 200, tomHandHz: 1_500, handAirHz: 9_000, morphWidth: 2, decay: 4.2, brightness: .85, inharmonicity: .15, hardness: .15,
    sweepRate: 12, sweepSpeed: 1.2,
  }, { brightness: map("pitch", .5, 1, .4), hardness: map("pitch", .1, .5) }, "up"),
]);

export function randomizeLinearDrumPreset(current, random = Math.random) {
  validateLinearDrumPreset(current);
  const rng = presetRandom(random);
  const shuffled = values => values.map(value => [rng.unit(), value]).sort((a, b) => a[0] - b[0]).map(item => item[1]);
  const parameterMaps = Object.fromEntries(LINEAR_DRUM_PARAMETER_SPECS.map(spec => [spec.id, {
    enabled: rng.unit() < .45,
    source: rng.pick(["pitch", "vertical"]),
    low: linearDrumParameterValue(spec.id, rng.unit()),
    high: linearDrumParameterValue(spec.id, rng.unit()),
    curve: rng.between(-.7, .7),
  }]));
  return validateLinearDrumPreset(captureLinearDrumPreset({
    rangeMin: rng.between(20, 70), rangeMax: rng.between(6_000, 18_000),
    kickTomHz: rng.between(60, 200), tomHandHz: rng.between(300, 1_600), handAirHz: rng.between(2_200, 9_000),
    morphWidth: rng.between(.4, 2.2), attack: linearDrumParameterValue("attack", rng.between(0, .6)),
    decay: linearDrumParameterValue("decay", rng.between(.1, .85)), pitchFall: rng.between(0, 1.8),
    strikeNoise: rng.between(0, 1.5), brightness: rng.unit(), inharmonicity: rng.unit(), hardness: rng.unit(),
    sweepRate: Math.round(rng.between(5, 27)), sweepSpeed: linearDrumParameterValue("sweepSpeed", rng.between(.1, .9)),
    model: rng.pick(MODEL_IDS), pitchedOrder: shuffled(PITCHED_IDS).slice(0, 3),
    karplusMorphOrder: shuffled(KARPLUS_IDS).slice(0, 4), parameterMaps, sweepMode: rng.pick(SWEEP_MODES),
  }));
}
