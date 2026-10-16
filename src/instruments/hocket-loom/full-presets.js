import {
  HOCKET_PRESETS, HOCKET_SOUND_ENGINES, HOCKET_STEP_OPTIONS, createHocketState, sanitizeHocketState,
} from "./hocket-loom.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const HOCKET_SOUND_SETS = Object.freeze(["relay", "wood", "metal", "breath"]);
export const HOCKET_FOCUS_MODES = Object.freeze(["balanced", "call-answer", "rotating"]);
export const HOCKET_MOTION_MODES = Object.freeze(["loop", "pingpong"]);
export const HOCKET_SCALAR_KEYS = Object.freeze([
  "voiceCount", "length", "pulsesPerBeat", "tempoBpm", "swing", "pulseLengthMs", "preserveComposite",
  "soundSet", "soundEngine", "focusMode", "direction", "motionMode",
]);

/** Captures only musical state; level, play state and the playhead stay with the session. */
export function captureHocketPreset(source) {
  const state = sanitizeHocketState({ ...source, names: undefined });
  const settings = Object.fromEntries(HOCKET_SCALAR_KEYS.filter(key => key !== "direction" && key !== "motionMode")
    .map(key => [key, state[key]]));
  settings.direction = Number(source.direction) < 0 ? -1 : 1;
  settings.motionMode = source.motionMode === "pingpong" ? "pingpong" : "loop";
  return { settings, patterns: state.patterns, phases: state.phases };
}

export function validateHocketPreset(snapshot) {
  if (!snapshot?.settings || presetStateKey(snapshot) !== presetStateKey(captureHocketPreset({
    ...snapshot.settings, patterns: snapshot.patterns, phases: snapshot.phases,
  }))) throw new TypeError("Invalid complete Hocket Luigi preset");
  return snapshot;
}

export function hocketStateFromPreset(snapshot, { presetId, variation, level }) {
  return sanitizeHocketState({
    ...snapshot.settings, patterns: snapshot.patterns, phases: snapshot.phases, presetId, variation, level,
  });
}

const tones = text => [...text].map(char => (char === "." ? 0 : Number(char)));

function scene(id, label, { rows, phases, ...settings }) {
  const patterns = rows.map(tones);
  const length = patterns[0].length;
  const snapshot = captureHocketPreset({
    voiceCount: patterns.length, length, pulsesPerBeat: 4, tempoBpm: 112, swing: 0, pulseLengthMs: 92,
    preserveComposite: true, soundSet: "relay", soundEngine: "original", focusMode: "balanced", direction: 1,
    motionMode: "loop", ...settings, patterns, phases: phases ?? patterns.map(() => 0),
  });
  validateHocketPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
}

const sources = HOCKET_PRESETS.map(preset => {
  const state = createHocketState(preset.id);
  const snapshot = captureHocketPreset({ ...state, direction: 1, motionMode: "loop" });
  return Object.freeze({ id: preset.id, label: preset.name, snapshot: Object.freeze(snapshot) });
});

export const HOCKET_FULL_PRESETS = Object.freeze([
  ...sources,
  scene("tight-duet", "Tight duet · 12 pulses", {
    rows: ["1.3.5.3.2.4.", ".2.4.1.5.3.1"], tempoBpm: 132, pulsesPerBeat: 3, soundSet: "wood", pulseLengthMs: 70,
  }),
  scene("slow-breath", "Slow breath · Ping-pong", {
    rows: ["3...5...2...6...", "..4...1...5...3."], tempoBpm: 58, pulsesPerBeat: 4, soundSet: "breath",
    pulseLengthMs: 210, swing: 0.12, motionMode: "pingpong", focusMode: "call-answer",
  }),
  scene("metal-rush", "Metal rush · Reverse 24", {
    rows: ["5.5.5.55.5.5.5.55.5.5.5.", ".3.3..3.3.3..3.3.3.3..3", "7..7..7..7..7..7..7..7..", "..1..1.1..1..1.1..1..1.1"],
    phases: [0, 3, 0, -2], tempoBpm: 172, pulsesPerBeat: 6, soundSet: "metal", pulseLengthMs: 44, direction: -1,
    focusMode: "rotating",
  }),
  scene("wood-triplets", "Wood triplets · Drift", {
    rows: ["1.2.3.1.2.3.", "2.3.1.2.3.1.", ".1.2.3.1.2.3"], phases: [0, 4, -3], tempoBpm: 100, pulsesPerBeat: 3,
    soundSet: "wood", swing: 0.2, pulseLengthMs: 120,
  }),
  scene("modal-ring", "Modal ring · Two voices", {
    rows: ["6..4..5..3..2...", "..5..4..6..1..7."], tempoBpm: 84, pulsesPerBeat: 4, soundEngine: "modal", pulseLengthMs: 180,
    swing: 0.08, focusMode: "call-answer",
  }),
  scene("karplus-weave", "Plucked weave · 16", {
    rows: ["1.3.1.5.1.3.1.5.", ".2.4.2.6.2.4.2.6", "5...3...5...7..."], tempoBpm: 116, soundEngine: "karplus-strong",
    pulseLengthMs: 150, phases: [0, 1, 0], focusMode: "rotating",
  }),
  scene("noise-skip", "Noise skip · Sparse 8", {
    rows: ["1...1.1.", "..2.2...", "...3..3."], tempoBpm: 144, pulsesPerBeat: 2, soundEngine: "noise", pulseLengthMs: 36,
    preserveComposite: false, swing: 0.3, direction: -1, motionMode: "pingpong",
  }),
  scene("analog-fourway", "Analog four-way · 16", {
    rows: ["1.2.....3.4.....", "..3.4.....5.6...", "....5.6.....7.8.", "6.....7.8.....1."], tempoBpm: 124,
    pulsesPerBeat: 4, soundEngine: "analog", pulseLengthMs: 90, phases: [0, 2, 4, 6],
  }),
]);

export function randomizeHocketPreset(current, random = Math.random) {
  validateHocketPreset(current);
  const rng = presetRandom(random);
  const voiceCount = rng.integer(2, 4), length = rng.pick(HOCKET_STEP_OPTIONS);
  const all = Array.from({ length: 8 }, (_, index) => index + 1);
  const pool = [];
  for (let count = rng.integer(3, 6); count > 0; count--) pool.push(...all.splice(rng.integer(0, all.length - 1), 1));
  const density = rng.between(0.35, 0.8), overlap = rng.between(0, 0.25);
  const patterns = Array.from({ length: voiceCount }, () => Array(length).fill(0));
  for (let step = 0; step < length; step++) {
    if (rng.unit() > density) continue;
    const owner = rng.integer(0, voiceCount - 1);
    patterns[owner][step] = rng.pick(pool);
    if (rng.unit() < overlap) patterns[(owner + 1) % voiceCount][step] = rng.pick(pool);
  }
  patterns[0][0] ||= rng.pick(pool);
  return validateHocketPreset(captureHocketPreset({
    voiceCount, length, pulsesPerBeat: rng.pick([2, 3, 4, 6, 8]), tempoBpm: rng.between(56, 180), swing: rng.between(0, 0.34),
    pulseLengthMs: rng.between(36, 200), preserveComposite: rng.unit() < 0.7, soundSet: rng.pick(HOCKET_SOUND_SETS),
    soundEngine: rng.pick(HOCKET_SOUND_ENGINES.map(({ id }) => id)), focusMode: rng.pick(HOCKET_FOCUS_MODES),
    direction: rng.pick([-1, 1]), motionMode: rng.pick(HOCKET_MOTION_MODES), patterns,
    phases: patterns.map(() => rng.integer(-Math.floor(length / 2), Math.floor(length / 2))),
  }));
}
