import { ALPHABET, WHEEL_MORPH_LIMITS, createWheelState, normalizeWheelWord } from "./wheel-of-organs.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const GLOBAL_SPECS = Object.freeze({
  rootMidi: [24, 60], rate: [90, 720], overlap: [0, 1], vibrato: [0, 1], growl: [0, 1], slime: [0, 1], dirt: [0, 1],
  depth: [0, 1], spread: [0, 1],
});
const MOUTH_SPECS = Object.freeze({
  pull: [0, 1], aperture: [0.04, 1], tongue: [0, 1], glottalTension: [0, 1], breath: [0, 1], pinch: [0, 1], push: [0, 1],
  nasality: [0, 1], screech: [0, 1], size: [WHEEL_MORPH_LIMITS.size.minimum, WHEEL_MORPH_LIMITS.size.maximum],
  stretch: [WHEEL_MORPH_LIMITS.stretch.minimum, WHEEL_MORPH_LIMITS.stretch.maximum], tongueOut: [0, 1], interval: [-36, 36],
});
export const WHEEL_GLOBAL_KEYS = Object.freeze(Object.keys(GLOBAL_SPECS));
export const WHEEL_MOUTH_KEYS = Object.freeze(["letter", "active", ...Object.keys(MOUTH_SPECS)]);
export const WHEEL_PRESET_KEYS = Object.freeze(["word", "mouths", ...WHEEL_GLOBAL_KEYS]);
const MAX_MOUTHS = 32;
const INTERVAL_CHOICES = Object.freeze([-12, -7, -5, -2, 0, 0, 2, 4, 5, 7, 7, 9, 12, 14, 16]);

const limit = (value, [min, max]) => {
  const number = Number.isFinite(Number(value)) ? Number(value) : min;
  return Math.min(max, Math.max(min, number));
};
const lettersOf = word => [...word].filter(character => ALPHABET.includes(character));

function normalizeMouth(source) {
  const mouth = { letter: ALPHABET.includes(source?.letter) ? source.letter : "A", active: source?.active === true };
  for (const key of Object.keys(MOUTH_SPECS)) mouth[key] = limit(source?.[key], MOUTH_SPECS[key]);
  return mouth;
}

function normalize(values) {
  const mouths = (Array.isArray(values.mouths) ? values.mouths : []).slice(0, MAX_MOUTHS).map(normalizeMouth);
  const word = normalizeWheelWord(values.word);
  return {
    word: lettersOf(word).join("") === mouths.map(mouth => mouth.letter).join("") ? word : mouths.map(mouth => mouth.letter).join(""),
    mouths,
    ...Object.fromEntries(WHEEL_GLOBAL_KEYS.map(key => [key, limit(values[key], GLOBAL_SPECS[key])])),
  };
}

export function captureWheelPreset(state, rate, overlap) {
  return normalize({
    word: state.word, mouths: state.mouths, rootMidi: state.rootMidi, rate, overlap, vibrato: state.vibrato, growl: state.growl,
    slime: state.slime, dirt: state.dirt, depth: state.depth, spread: state.spread,
  });
}

export function validateWheelPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== WHEEL_PRESET_KEYS.length
    || !Array.isArray(snapshot.mouths) || snapshot.mouths.some(mouth => Object.keys(mouth ?? {}).length !== WHEEL_MOUTH_KEYS.length)
    || presetStateKey(snapshot) !== presetStateKey(normalize(snapshot))) {
    throw new TypeError("Invalid complete Wheel of Organs preset");
  }
  return snapshot;
}

export function wheelStateFromPreset(state, snapshot) {
  validateWheelPreset(snapshot);
  const mouths = snapshot.mouths.map((mouth, index) => ({ id: `mouth-${index + 1}`, ...mouth }));
  const selectedMouth = mouths.length ? Math.max(0, Math.min(state.selectedMouth ?? 0, mouths.length - 1)) : -1;
  return {
    state: {
      ...state, word: snapshot.word, rootMidi: snapshot.rootMidi, vibrato: snapshot.vibrato, growl: snapshot.growl,
      slime: snapshot.slime, dirt: snapshot.dirt, depth: snapshot.depth, spread: snapshot.spread, mouths, selectedMouth, running: false,
    },
    rate: snapshot.rate,
    overlap: snapshot.overlap,
  };
}

const DRIFT_STEPS = Object.freeze([-1, 0, 1]);
const voice = (word, globals, template = null) => {
  const defaults = createWheelState({ word });
  const mouths = defaults.mouths.map((base, index) => {
    const drift = DRIFT_STEPS[index % 3] * 0.02;
    const patch = template ? {
      ...template, pull: template.pull + drift, tongue: template.tongue + Math.sin(index * 1.37) * 0.035, aperture: template.aperture - drift,
    } : {};
    return { ...base, ...patch, active: true };
  });
  return { word: defaults.word, mouths, ...globals };
};
const scene = (id, label, values) => Object.freeze({ id, label, snapshot: Object.freeze(normalize(values)) });
const T = (pull, aperture, tongue, glottalTension, breath, pinch, push, nasality, screech, size, stretch, tongueOut) => (
  { pull, aperture, tongue, glottalTension, breath, pinch, push, nasality, screech, size, stretch, tongueOut }
);

export const WHEEL_FULL_PRESETS = Object.freeze([
  scene("clear-choir", "Clear choir", voice("ORGANISM",
    { rootMidi: 40, rate: 250, overlap: 0.82, vibrato: 0.12, growl: 0.04, slime: 0.03, dirt: 0.01, depth: 0.46, spread: 0.7 },
    T(0.2, 0.8, 0.5, 0.7, 0.01, 0.02, 0.4, 0.06, 0, 1, 1, 0))),
  scene("wet-organism", "Wet organism", voice("ORGANISM",
    { rootMidi: 36, rate: 320, overlap: 0.68, vibrato: 0.24, growl: 0.46, slime: 0.74, dirt: 0.62, depth: 0.78, spread: 0.84 })),
  scene("velvet-hymn", "Velvet hymn", voice("HALLELUJAH",
    { rootMidi: 32, rate: 190, overlap: 0.92, vibrato: 0.18, growl: 0.08, slime: 0.08, dirt: 0.015, depth: 0.7, spread: 0.58 },
    T(0.11, 0.72, 0.44, 0.56, 0.015, 0.025, 0.32, 0.12, 0, 1.1, 1.12, 0.015))),
  scene("humming-ring", "Humming ring", voice("MMM HMM",
    { rootMidi: 36, rate: 220, overlap: 0.9, vibrato: 0.16, growl: 0.035, slime: 0.045, dirt: 0.008, depth: 0.62, spread: 0.76 },
    T(0.16, 0.66, 0.42, 0.64, 0.008, 0.015, 0.36, 0.58, 0, 1.04, 1.05, 0))),
  scene("glass-throats", "Glass throats", voice("CRYSTAL",
    { rootMidi: 48, rate: 280, overlap: 0.76, vibrato: 0.08, growl: 0.02, slime: 0.015, dirt: 0.006, depth: 0.38, spread: 0.88 },
    T(0.34, 0.62, 0.62, 0.86, 0.006, 0.035, 0.38, 0.025, 0.02, 0.94, 1.04, 0))),
  scene("soft-speech", "Soft speech", voice("HELLO WORLD",
    { rootMidi: 40, rate: 300, overlap: 0.6, vibrato: 0.06, growl: 0.025, slime: 0.02, dirt: 0.008, depth: 0.5, spread: 0.64 },
    T(0.18, 0.74, 0.52, 0.68, 0.012, 0.04, 0.42, 0.14, 0, 1, 1, 0.025))),
  scene("quiet-giant", "Quiet giant", voice("ROAR",
    { rootMidi: 27, rate: 150, overlap: 0.94, vibrato: 0.1, growl: 0.045, slime: 0.055, dirt: 0.008, depth: 0.82, spread: 0.5 },
    T(0.06, 0.78, 0.4, 0.58, 0.008, 0.015, 0.34, 0.1, 0, 1.62, 1.28, 0))),
  scene("bone-flute", "Bone flute", voice("WHISTLE",
    { rootMidi: 56, rate: 360, overlap: 0.7, vibrato: 0.3, growl: 0, slime: 0.02, dirt: 0.02, depth: 0.3, spread: 0.9 },
    T(0.45, 0.4, 0.72, 0.8, 0.38, 0.3, 0.22, 0.04, 0.08, 0.7, 1.5, 0.1))),
  scene("swamp-chant", "Swamp chant", voice("BOG MUD",
    { rootMidi: 29, rate: 210, overlap: 0.85, vibrato: 0.14, growl: 0.5, slime: 0.7, dirt: 0.3, depth: 0.9, spread: 0.45 },
    T(0.1, 0.5, 0.3, 0.45, 0.2, 0.5, 0.7, 0.9, 0.05, 1.4, 0.8, 0.3))),
  scene("screech-owl", "Screech owl", voice("OWL SCREECH",
    { rootMidi: 52, rate: 520, overlap: 0.5, vibrato: 0.4, growl: 0.12, slime: 0.1, dirt: 0.12, depth: 0.35, spread: 1 },
    T(0.7, 0.7, 0.8, 0.95, 0.15, 0.2, 0.3, 0.2, 0.75, 0.9, 1.9, 0.5))),
  scene("moon-vowels", "Moon vowels", voice("AEIOU",
    { rootMidi: 33, rate: 100, overlap: 1, vibrato: 0.35, growl: 0, slime: 0.04, dirt: 0, depth: 0.6, spread: 0.8 },
    T(0.12, 0.95, 0.5, 0.6, 0.02, 0, 0.25, 0.15, 0, 1.3, 1.2, 0))),
  scene("stutter-machine", "Stutter machine", voice("TATATA TA",
    { rootMidi: 45, rate: 700, overlap: 0.3, vibrato: 0, growl: 0.1, slime: 0, dirt: 0.15, depth: 0.2, spread: 0.95 },
    T(0.3, 0.55, 0.6, 0.75, 0.25, 0.4, 0.55, 0.1, 0.2, 0.8, 0.9, 0.2))),
  scene("alphabet-ring", "Alphabet ring", voice("ABCDEFGHIJKLM",
    { rootMidi: 38, rate: 400, overlap: 0.74, vibrato: 0.1, growl: 0.06, slime: 0.06, dirt: 0.02, depth: 0.5, spread: 1 },
    T(0.2, 0.7, 0.5, 0.7, 0.03, 0.05, 0.4, 0.2, 0.02, 0.8, 1, 0.05))),
]);

const CONSONANTS = [..."BCDFGHJKLMNPRSTVWZ"];
const VOWELS = [..."AEIOU"];
const rounded = value => Number(value.toFixed(2));

export function randomizeWheelPreset(current, random = Math.random) {
  validateWheelPreset(current);
  const rng = presetRandom(random);
  const syllables = rng.integer(2, 6);
  let word = "";
  for (let index = 0; index < syllables; index++) {
    word += rng.pick(CONSONANTS) + rng.pick(VOWELS);
    if (rng.unit() < 0.25) word += rng.pick(CONSONANTS);
    if (index < syllables - 1 && rng.unit() < 0.2) word += " ";
  }
  const letters = lettersOf(word);
  const activeIndex = rng.integer(0, letters.length - 1);
  const between = key => rounded(rng.between(...MOUTH_SPECS[key]));
  const mouths = letters.map((letter, index) => ({
    letter, active: index === activeIndex || rng.unit() > 0.1,
    pull: rounded(rng.between(0.04, 0.75)), aperture: rounded(rng.between(0.3, 1)), tongue: between("tongue"),
    glottalTension: rounded(rng.between(0.3, 0.97)), breath: rounded(rng.between(0, 0.45)), pinch: rounded(rng.between(0, 0.65)),
    push: rounded(rng.between(0.08, 0.85)), nasality: between("nasality"), screech: rounded(rng.between(0, 0.55)),
    size: rounded(rng.between(0.55, 1.9)), stretch: rounded(rng.between(0.6, 1.9)), tongueOut: rounded(rng.between(0, 0.8)),
    interval: rng.pick(INTERVAL_CHOICES),
  }));
  return validateWheelPreset(normalize({
    word, mouths, rootMidi: rng.integer(24, 60), rate: rng.integer(90, 720), overlap: rounded(rng.between(0.3, 1)),
    vibrato: rounded(rng.between(0, 0.55)), growl: rounded(rng.between(0, 0.6)), slime: rounded(rng.between(0, 0.8)),
    dirt: rounded(rng.between(0, 0.55)), depth: rounded(rng.between(0.2, 1)), spread: rounded(rng.between(0, 1)),
  }));
}
