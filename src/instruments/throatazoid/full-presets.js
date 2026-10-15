import {
  ARTICULATIONS, MAX_NOSES, MAX_PRESSURE_SOURCES, MAX_THROATS, MAX_TONGUES, PHONEMES, SPECIMENS, VOICE_PRESETS,
  specimenState, voicePresetState,
} from "../../families/tract/throatazoid.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const THROATAZOID_MUTANT_SPECIMEN = "mutant";
const INTERVAL_FALLBACKS = Object.freeze([-12, 0, 7, 12, 19, 24, 31]);
const DETUNE_FALLBACKS = Object.freeze([-8, 5, -4, 7, -6, 3, -2]);
const MANNERS = Object.freeze(["vowel", "fricative", "stop", "nasal", "affricate", "approximant"]);
const MOTION_SWITCHES = Object.freeze(["motionEnabled", "motionMouths", "motionTongues", "motionNoses", "motionPressure"]);

const num = (value, lo, hi, fallback = lo) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));
const int = (value, lo, hi, fallback = lo) => Math.round(num(value, lo, hi, fallback));

export const THROATAZOID_UNIT_KEYS = Object.freeze([
  "bodyLength", "tension", "mutation", "growl", "wet", "spread", "oralClosure", "articulationPlace",
  "articulationAperture", "articulationVoicing", "glottalClosure", "nasalCoupling",
  "exciterIntensity", "exciterTenseness", "exciterBreath", "exciterVibrato", "exciterWobble", "motionDepth",
]);
const SCALAR_RANGES = Object.freeze({ dry: [0, .5], coupling: [0, .72], exciterPitch: [40, 420], lipDiameter: [.35, 3] });
export const THROATAZOID_SCALAR_KEYS = Object.freeze([...THROATAZOID_UNIT_KEYS, ...Object.keys(SCALAR_RANGES)]);
export const THROATAZOID_PRESET_KEYS = Object.freeze([
  "specimen", "phoneme", "articulationManner", "voiceMode", "classicTopology",
  "throatCount", "tongueCount", "noseCount", "pressureSourceCount",
  ...THROATAZOID_SCALAR_KEYS, ...MOTION_SWITCHES,
  "voiceIntervals", "voiceDetunes", "throats", "tongues", "noses", "pressureSources",
]);

const rangeFor = key => SCALAR_RANGES[key] ?? [0, 1];

export function captureThroatazoidPreset(source) {
  const specimen = SPECIMENS[source.specimen] ? source.specimen : THROATAZOID_MUTANT_SPECIMEN;
  const snapshot = {
    specimen,
    phoneme: ARTICULATIONS[source.phoneme] ? source.phoneme : "",
    articulationManner: MANNERS.includes(source.articulationManner) ? source.articulationManner : "vowel",
    voiceMode: source.voiceMode === "polyphonic" ? "polyphonic" : "shared",
    throatCount: int(source.throatCount, 1, MAX_THROATS, 1),
    tongueCount: int(source.tongueCount, 1, MAX_TONGUES, 1),
    noseCount: int(source.noseCount, 0, MAX_NOSES, 0),
    pressureSourceCount: int(source.pressureSourceCount, 1, MAX_PRESSURE_SOURCES, 1),
  };
  snapshot.classicTopology = Boolean(source.classicTopology) && snapshot.throatCount === 1;
  for (const key of THROATAZOID_SCALAR_KEYS) {
    const [lo, hi] = rangeFor(key);
    snapshot[key] = num(source[key], lo, hi, key === "lipDiameter" ? 3 : lo);
  }
  for (const key of MOTION_SWITCHES) snapshot[key] = Boolean(source[key]);
  snapshot.voiceIntervals = Array.from({ length: MAX_THROATS }, (_, i) => num(source.voiceIntervals?.[i], -48, 48, INTERVAL_FALLBACKS[i]));
  snapshot.voiceDetunes = Array.from({ length: MAX_THROATS }, (_, i) => num(source.voiceDetunes?.[i], -1200, 1200, DETUNE_FALLBACKS[i]));
  snapshot.throats = Array.from({ length: MAX_THROATS }, (_, i) => ({
    aperture: num(source.throats?.[i]?.aperture, .05, 1, .5), length: num(source.throats?.[i]?.length, 0, 1, .5),
    muted: Boolean(source.throats?.[i]?.muted),
  }));
  snapshot.tongues = Array.from({ length: MAX_TONGUES }, (_, i) => ({
    position: num(source.tongues?.[i]?.position, 0, 1, .5), height: num(source.tongues?.[i]?.height, 0, 1, .5),
    curl: num(source.tongues?.[i]?.curl, 0, 1, .2),
  }));
  snapshot.noses = Array.from({ length: MAX_NOSES }, (_, i) => ({
    openness: num(source.noses?.[i]?.openness, 0, 1, 0), length: num(source.noses?.[i]?.length, 0, 1, .5),
    resonance: num(source.noses?.[i]?.resonance, 0, 1, .5),
  }));
  snapshot.pressureSources = Array.from({ length: MAX_PRESSURE_SOURCES }, (_, i) => ({
    open: i < snapshot.pressureSourceCount && source.pressureSources?.[i]?.open !== false,
    level: num(source.pressureSources?.[i]?.level, 0, 1, 1),
  }));
  return snapshot;
}

export function validateThroatazoidPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== THROATAZOID_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(captureThroatazoidPreset(snapshot))) {
    throw new TypeError("Invalid complete Throatazoid preset");
  }
  return snapshot;
}

const motionDefaults = { motionEnabled: false, motionDepth: .55, motionMouths: true, motionTongues: true, motionNoses: true, motionPressure: true };

export const THROATAZOID_FULL_PRESETS = Object.freeze([
  ...Object.entries(VOICE_PRESETS).map(([key, voice]) => Object.freeze({
    id: `voice-${key}`, label: voice.name, voicePreset: key,
    snapshot: Object.freeze(captureThroatazoidPreset({ ...voicePresetState(key), ...motionDefaults })),
  })),
  ...Object.entries(SPECIMENS).map(([key, specimen]) => Object.freeze({
    id: `anatomy-${key}`, label: `${specimen.name} anatomy`, voicePreset: "",
    snapshot: Object.freeze(captureThroatazoidPreset({
      ...specimenState(key), phoneme: key === "triune" || key === "singing" ? "a" : "",
      articulationPlace: specimenState(key).tongues[0]?.position ?? .48, articulationAperture: 1 - specimenState(key).oralClosure,
      articulationVoicing: .92, ...motionDefaults, pressureSourceCount: Math.min(4, Math.max(1, Math.ceil(specimenState(key).throatCount / 2))),
      pressureSources: Array.from({ length: 4 }, (_, i) => ({ open: true, level: i === 0 ? 1 : .94 - i * .1 })),
    })),
  })),
]);

export function throatazoidPresetEntryForSnapshot(snapshot) {
  const key = presetStateKey(snapshot);
  return THROATAZOID_FULL_PRESETS.find(preset => presetStateKey(preset.snapshot) === key) ?? null;
}

const INTERVAL_POOL = Object.freeze([-24, -17, -12, -7, -5, 0, 3, 4, 5, 7, 9, 12, 14, 16, 19, 24]);
const VOWELS = Object.freeze(["a", "e", "i", "o", "u"]);

export function randomizeThroatazoidPreset(current, random = Math.random) {
  validateThroatazoidPreset(current);
  const rng = presetRandom(random);
  const throatCount = rng.pick([1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7]);
  const tongueCount = rng.integer(1, MAX_TONGUES);
  const noseCount = rng.integer(1, MAX_NOSES);
  const pressureSourceCount = rng.integer(1, Math.min(MAX_PRESSURE_SOURCES, Math.max(1, Math.ceil(throatCount / 2) + 1)));
  const phoneme = rng.pick(VOWELS);
  const shape = PHONEMES[phoneme];
  const open = rng.between(.1, .95);
  const unmuted = rng.integer(0, throatCount - 1);
  const snapshot = {
    specimen: THROATAZOID_MUTANT_SPECIMEN, phoneme, articulationManner: "vowel",
    voiceMode: throatCount > 1 && rng.unit() < .45 ? "polyphonic" : "shared",
    classicTopology: throatCount === 1 && rng.unit() < .4,
    throatCount, tongueCount, noseCount, pressureSourceCount,
    bodyLength: rng.between(.2, .95), tension: rng.between(.15, .9), mutation: rng.between(0, 1),
    growl: rng.between(0, .7), wet: rng.between(.65, 1), dry: rng.between(0, .3), spread: rng.between(0, 1),
    coupling: rng.between(0, .72), oralClosure: rng.between(0, .35), articulationPlace: rng.between(.1, .9),
    articulationAperture: open, articulationVoicing: rng.between(.6, 1), glottalClosure: rng.between(0, .3),
    nasalCoupling: rng.between(0, .5), lipDiameter: rng.between(.5, 3),
    exciterPitch: rng.between(55, 300), exciterIntensity: rng.between(.5, 1), exciterTenseness: rng.between(.2, .9),
    exciterBreath: rng.between(0, .5), exciterVibrato: rng.between(0, .6), exciterWobble: rng.between(0, .4),
    motionEnabled: rng.unit() < .35, motionDepth: rng.between(.2, .9), motionMouths: rng.unit() < .75,
    motionTongues: rng.unit() < .75, motionNoses: rng.unit() < .75, motionPressure: rng.unit() < .75,
    voiceIntervals: Array.from({ length: MAX_THROATS }, () => rng.pick(INTERVAL_POOL)),
    voiceDetunes: Array.from({ length: MAX_THROATS }, () => rng.between(-18, 18)),
    throats: Array.from({ length: MAX_THROATS }, (_, i) => ({
      aperture: rng.between(.15, 1), length: rng.between(.1, 1), muted: i !== unmuted && i < throatCount && rng.unit() < .12,
    })),
    tongues: Array.from({ length: MAX_TONGUES }, (_, i) => ({
      position: num((shape.tongues[i]?.position ?? .5) + rng.between(-.3, .3), .05, .95),
      height: num((shape.tongues[i]?.height ?? .5) + rng.between(-.3, .3), .05, .95),
      curl: rng.between(0, .8),
    })),
    noses: Array.from({ length: MAX_NOSES }, () => ({
      openness: rng.between(0, .75), length: rng.between(.2, .95), resonance: rng.between(.15, .9),
    })),
    pressureSources: Array.from({ length: MAX_PRESSURE_SOURCES }, (_, i) => ({
      open: i < pressureSourceCount && (i === 0 || rng.unit() < .85), level: rng.between(.5, 1),
    })),
  };
  return validateThroatazoidPreset(captureThroatazoidPreset(snapshot));
}
