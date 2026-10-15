import {
  THROAT_SINGING_DEFAULTS, THROAT_SINGING_LIMITS, THROAT_SINGING_MOTION_SHAPES, THROAT_SINGING_STYLE_PRESETS,
  sanitizeThroatSingingState, throatSingingState,
} from "./throat-singing.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const THROAT_SINGING_EXTRA_RANGES = Object.freeze({
  sublingualCoupling: [0, 1], pulseRate: [0, 10], pulseDepth: [0, 1],
  phantomAirways: [1, 4], impossibleFocus: [0, 1], sourceInstability: [0, 1],
});
export const THROAT_SINGING_STYLE_EXTRAS = Object.freeze({
  "open-drone": { sublingualCoupling: 0.06, pulseRate: 0, pulseDepth: 0 },
  sygyt: { sublingualCoupling: 0.3, pulseRate: 0, pulseDepth: 0 },
  xoomei: { sublingualCoupling: 0.2, pulseRate: 0, pulseDepth: 0 },
  kargyraa: { sublingualCoupling: 0.06, pulseRate: 0.55, pulseDepth: 0.08 },
  borbangnadyr: { sublingualCoupling: 0.2, pulseRate: 0, pulseDepth: 0 },
  ezengileer: { sublingualCoupling: 0.16, pulseRate: 2.6, pulseDepth: 0.48 },
  "western-overtone": { sublingualCoupling: 0.12, pulseRate: 0, pulseDepth: 0 },
  "low-chant": { sublingualCoupling: 0.04, pulseRate: 0.32, pulseDepth: 0.08 },
});

const MODEL_KEYS = Object.keys(THROAT_SINGING_LIMITS).filter(key => key !== "level");
const EXTRA_KEYS = Object.keys(THROAT_SINGING_EXTRA_RANGES);
export const THROAT_SINGING_PRESET_KEYS = Object.freeze([...MODEL_KEYS, "motionShape", ...EXTRA_KEYS]);
export const THROAT_SINGING_NUMERIC_PRESET_KEYS = Object.freeze([...MODEL_KEYS, ...EXTRA_KEYS]);

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : lo));

export function captureThroatSingingPreset(state, extras = state) {
  const clean = sanitizeThroatSingingState(state, THROAT_SINGING_DEFAULTS);
  const snapshot = Object.fromEntries(MODEL_KEYS.map(key => [key, clean[key]]));
  snapshot.motionShape = clean.motionShape;
  for (const [key, [lo, hi]] of Object.entries(THROAT_SINGING_EXTRA_RANGES)) {
    const value = clamp(extras[key] ?? 0, lo, hi);
    snapshot[key] = key === "phantomAirways" ? Math.round(value) : value;
  }
  return snapshot;
}

export function validateThroatSingingPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== THROAT_SINGING_PRESET_KEYS.length
    || !THROAT_SINGING_MOTION_SHAPES.includes(snapshot.motionShape)
    || presetStateKey(snapshot) !== presetStateKey(captureThroatSingingPreset(snapshot))) {
    throw new TypeError("Invalid complete Throat Singing preset");
  }
  return snapshot;
}

export function splitThroatSingingPreset(snapshot) {
  validateThroatSingingPreset(snapshot);
  const extras = Object.fromEntries(EXTRA_KEYS.map(key => [key, snapshot[key]]));
  const model = Object.fromEntries(THROAT_SINGING_PRESET_KEYS.filter(key => !EXTRA_KEYS.includes(key)).map(key => [key, snapshot[key]]));
  return { model, extras };
}

export function throatSingingStyleIdForPreset(snapshot) {
  const key = presetStateKey(snapshot);
  return THROAT_SINGING_FULL_PRESETS.slice(0, THROAT_SINGING_STYLE_PRESETS.length)
    .find(preset => presetStateKey(preset.snapshot) === key)?.id ?? null;
}

const styleEntry = style => Object.freeze({
  id: style.id,
  label: style.label.replace(/ — comparison$/, ""),
  snapshot: Object.freeze(captureThroatSingingPreset(throatSingingState(style.id), THROAT_SINGING_STYLE_EXTRAS[style.id])),
});
const authored = (id, label, styleId, model, extras = {}) => Object.freeze({
  id, label,
  snapshot: Object.freeze(captureThroatSingingPreset(
    throatSingingState(styleId, model),
    { ...THROAT_SINGING_STYLE_EXTRAS[styleId], ...extras },
  )),
});

export const THROAT_SINGING_FULL_PRESETS = Object.freeze([
  ...THROAT_SINGING_STYLE_PRESETS.map(styleEntry),
  authored("sygyt-whistle", "Sygyt high whistle", "sygyt", {
    trueFoldHz: 175, harmonicNumber: 16, formantConvergence: 1, focusBandwidthHz: 36, mouthOpening: .28,
    alveolarConstriction: 1, uvularConstriction: .08, vibratoDepthCents: 4, motionRateHz: 1.4, motionDepth: .14,
  }),
  authored("kargyraa-abyss", "Kargyraa abyss", "kargyraa", {
    trueFoldHz: 96, falseFoldDivision: 3, falseFoldCoupling: 1, roughness: .9, creakAmount: .22, harmonicNumber: 12,
    tractLengthCm: 19.5, mouthOpening: .82, intensity: .86,
  }, { pulseRate: .4, pulseDepth: .16 }),
  authored("xoomei-lake", "Xöömei lake", "xoomei", {
    trueFoldHz: 128, harmonicNumber: 7, formantConvergence: .8, focusBandwidthHz: 150, vibratoRateHz: 3.2,
    vibratoDepthCents: 26, motionRateHz: .3, motionDepth: .12, lipRounding: .4, frontCavityExpansion: .8,
  }, { sublingualCoupling: .34 }),
  authored("borbang-ripple", "Borbangnadyr ripple", "borbangnadyr", {
    trueFoldHz: 150, harmonicNumber: 13, motionRateHz: 6.8, motionDepth: .5, amplitudeMotionDepth: .2,
    motionShape: "triangle", vibratoRateHz: 6.4, vibratoDepthCents: 9,
  }),
  authored("ezengileer-gallop", "Ezengileer gallop", "ezengileer", {
    trueFoldHz: 118, harmonicNumber: 11, motionRateHz: 4.2, motionDepth: .4, amplitudeMotionDepth: .5,
    motionShape: "pulse", roughness: .3,
  }, { pulseRate: 4.2, pulseDepth: .6 }),
  authored("glass-choir", "Glass choir drone", "western-overtone", {
    trueFoldHz: 196, harmonicNumber: 14, formantConvergence: .9, focusBandwidthHz: 90, roughness: 0,
    foldTenseness: .72, vibratoRateHz: 5.6, vibratoDepthCents: 30, motionShape: "sample-hold", motionRateHz: 1.1, motionDepth: .22,
  }),
  authored("fry-cellar", "Fry cellar", "low-chant", {
    trueFoldHz: 62, creakAmount: .62, roughness: .6, harmonicNumber: 6, tractLengthCm: 20.5,
    mouthOpening: .9, formantConvergence: .12, foldTenseness: .3,
  }, { sublingualCoupling: .3 }),
  authored("twin-airways", "Twin airways", "xoomei", {
    trueFoldHz: 138, harmonicNumber: 12, formantConvergence: .93, focusBandwidthHz: 70,
  }, { phantomAirways: 2, impossibleFocus: .35, sourceInstability: .12 }),
  authored("impossible-throat", "Impossible throat", "sygyt", {
    trueFoldHz: 105, harmonicNumber: 18, formantConvergence: .6, formantSeparationHz: 780, motionRateHz: 2.2,
    motionDepth: .6, motionShape: "stirrup", tractLengthCm: 21,
  }, { phantomAirways: 4, impossibleFocus: .8, sourceInstability: .55, pulseRate: 1.2, pulseDepth: .3 }),
]);

const RANGES = Object.freeze({
  intensity: [.45, .9], foldTenseness: [.25, .9], creakAmount: [0, .6], roughness: [0, .85],
  formantConvergence: [.15, 1], formantSeparationHz: [300, 800], focusBandwidthHz: [36, 300],
  uvularConstriction: [0, 1], alveolarConstriction: [.1, 1], frontCavityExpansion: [.2, .9],
  tractLengthCm: [14.5, 20.5], mouthOpening: [.2, .95], lipRounding: [0, .6],
  vibratoRateHz: [2.5, 7], vibratoDepthCents: [0, 40], motionRateHz: [0, 7], motionDepth: [0, .5],
  amplitudeMotionDepth: [0, .5], sublingualCoupling: [0, .5], pulseRate: [0, 5], pulseDepth: [0, .55],
  impossibleFocus: [0, .5], sourceInstability: [0, .45],
});
const TARGET_CEILING_HZ = 3_600;

export function randomizeThroatSingingPreset(current, random = Math.random) {
  validateThroatSingingPreset(current);
  const rng = presetRandom(random);
  const values = Object.fromEntries(Object.entries(RANGES).map(([key, [lo, hi]]) => [key, rng.between(lo, hi)]));
  const divided = rng.unit() < .35;
  const falseFoldDivision = divided ? rng.integer(2, 4) : 1;
  const trueFoldHz = rng.between(70, 210);
  const heardHz = trueFoldHz / falseFoldDivision;
  const maxHarmonic = Math.max(5, Math.min(20, Math.floor(TARGET_CEILING_HZ / Math.max(1, heardHz))));
  const airways = rng.unit() < .75 ? 1 : rng.integer(2, 3);
  return validateThroatSingingPreset(captureThroatSingingPreset({
    ...values, trueFoldHz, falseFoldDivision,
    falseFoldCoupling: divided ? rng.between(.5, 1) : rng.between(0, .3),
    harmonicNumber: rng.integer(5, maxHarmonic),
    motionShape: rng.pick(THROAT_SINGING_MOTION_SHAPES),
    phantomAirways: airways,
  }));
}
