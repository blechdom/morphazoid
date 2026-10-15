import {
  JAW_JAM_BREATH_RATIOS, JAW_JAM_PATTERNS, randomizeJawJamPattern, sanitizeJawJamPattern,
} from "./jaw-jam.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export function captureJawJamPreset(pattern) {
  const { stepCount, tempo, swing, breathRatio, steps } = sanitizeJawJamPattern(pattern);
  return { pattern: { stepCount, tempo, swing, breathRatio, steps: steps.map(step => ({ ...step })) } };
}

export function validateJawJamPreset(snapshot) {
  if (!snapshot?.pattern || presetStateKey(snapshot) !== presetStateKey(captureJawJamPreset(snapshot.pattern))) {
    throw new TypeError("Invalid complete Jaw Jam preset");
  }
  return snapshot;
}

const PROFILE_BY_VOWEL = Object.freeze({ a: "open-a", e: "bright-e", i: "needle-i", o: "rounded-o", u: "deep-u" });

function phrase(id, label, {
  notes, materials, vowels, tempo, swing = 0, breathRatio = 1, pluck = [0.8], air = [0.9], rate = [1],
}) {
  let midi = 38, plucks = 0;
  const steps = notes.trim().split(/\s+/).map((token, index) => {
    const action = token[0] === "S" ? "sustain" : token[0] === "X" ? "rest" : "pluck";
    if (action === "pluck") { midi = Number(token.slice(1)); plucks += 1; }
    const vowelId = vowels[index % vowels.length];
    const sound = materials[index % materials.length];
    return {
      action, midi, vowelId,
      soundPresetId: sound.startsWith("-") ? sound.slice(1) : `${sound}-${PROFILE_BY_VOWEL[vowelId]}`,
      pluckIntensity: action === "pluck" ? pluck[plucks % pluck.length] : 0,
      breathPower: action === "rest" ? 0 : air[index % air.length],
      breathRateMultiplier: rate[index % rate.length],
    };
  });
  const snapshot = captureJawJamPreset({ stepCount: steps.length, tempo, swing, breathRatio, steps });
  validateJawJamPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
}

const sources = JAW_JAM_PATTERNS.map(pattern => Object.freeze({
  id: pattern.id, label: pattern.label, snapshot: Object.freeze(captureJawJamPreset(pattern)),
}));

export const JAW_JAM_FULL_PRESETS = Object.freeze([
  ...sources,
  phrase("drone-hymn", "Drone hymn", {
    notes: "P33 S S S P36 S S X", materials: ["khomus", "dan-moi"], vowels: ["u", "o", "a", "o"], tempo: 58,
    breathRatio: 0.5, pluck: [0.95, 0.7], air: [1.2, 1.05, 0.9], rate: [0.5, 0.75],
  }),
  phrase("octave-reel", "Octave reel", {
    notes: "P38 P50 P38 P45 P50 P38 X P43 P50 P38 P47 P50 P38 X P45", materials: ["munnharpe", "marranzanu", "munnharpe"],
    vowels: ["a", "i", "e", "i", "a"], tempo: 172, swing: 0.18, breathRatio: 2, pluck: [0.9, 0.55, 0.7], air: [0.7, 0.95], rate: [2, 1],
  }),
  phrase("overtone-rain", "Overtone rain", {
    notes: "P52 X P49 S P53 X X P47 P51 S X P50", materials: ["kubing", "munnharpe"], vowels: ["i", "e", "i", "e"],
    tempo: 92, swing: -0.1, breathRatio: 3, pluck: [0.45, 0.6, 0.38], air: [0.5, 0.65], rate: [3, 2, 1.5],
  }),
  phrase("triplet-shuffle", "Triplet shuffle", {
    notes: "P40 X P43 P40 X P45 P40 P47 X P43 X P45", materials: ["marranzanu", "khomus"], vowels: ["o", "a", "e"],
    tempo: 144, swing: 0.32, breathRatio: 1, pluck: [0.85, 0.6, 0.72], air: [0.8, 1.1], rate: [1, 1.5],
  }),
  phrase("long-breath", "Long breath · Six steps", {
    notes: "P31 S S P34 S S", materials: ["dan-moi", "khomus"], vowels: ["u", "a", "o"], tempo: 46, breathRatio: 1 / 3,
    pluck: [1, 0.8], air: [1.4, 1.2, 1.5], rate: [0.5],
  }),
  phrase("fast-chatter", "Fast chatter · 32 steps", {
    notes: "P45 P45 P47 P45 P45 P50 P45 X P43 P43 P45 P43 P43 P48 P43 X P41 P41 P43 P41 P41 P46 P41 X P38 P50 P38 S P38 X P52 X",
    materials: ["kubing", "munnharpe", "marranzanu", "khomus"], vowels: ["e", "i", "a", "o"], tempo: 236, swing: 0.06,
    breathRatio: 2, pluck: [0.7, 0.5, 0.9, 0.4], air: [0.6, 0.8, 0.5], rate: [3, 2],
  }),
  phrase("dan-moi-call", "Dan Moi call and answer", {
    notes: "P43 S X P50 S P47 X X P41 S P48 S X P45", materials: ["dan-moi", "kubing"], vowels: ["o", "e", "u", "i"],
    tempo: 108, swing: 0.14, breathRatio: 1, pluck: [0.88, 0.5], air: [1.0, 0.7, 1.3], rate: [1, 0.75],
  }),
  phrase("kit-melody", "Kit melody · Shared voices", {
    notes: "P38 P41 P45 S P50 P45 P41 X P43 P46 P50 S P53 P50 P46 X",
    materials: ["-soft-fm", "-analog", "-modal", "-karplus-strong", "-pitched-morph", "-sine"],
    vowels: ["a", "e", "o", "i"], tempo: 126, swing: 0.1, breathRatio: 1, pluck: [0.8, 0.6, 0.9], air: [0.8], rate: [1],
  }),
]);

export function randomizeJawJamPreset(current, random = Math.random) {
  validateJawJamPreset(current);
  const rng = presetRandom(random);
  const stepCount = rng.integer(4, 24);
  const base = sanitizeJawJamPattern({ ...current.pattern, steps: [], stepCount });
  const result = captureJawJamPreset(randomizeJawJamPattern(base, rng.unit));
  result.pattern.breathRatio = rng.pick(JAW_JAM_BREATH_RATIOS);
  return validateJawJamPreset(result);
}
