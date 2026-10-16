import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { LOOPINI_LIMITS } from "./loopini.js";

const { slots: SLOTS, minSpeed, maxSpeed } = LOOPINI_LIMITS;
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Loopini's musical state is almost all recorded audio, so presets own playback only: speed and which circles are on. */
export function captureLoopiniPreset(raw) {
  const speed = Number(raw?.speed);
  return {
    speed: Number.isFinite(speed) ? Math.min(maxSpeed, Math.max(minSpeed, speed)) : 1,
    slots: Array.from({ length: SLOTS }, (_, id) => ({ on: raw?.slots?.[id]?.on !== false })),
  };
}

/** Empty circles cannot be toggled, so they keep the last recalled choice for round-tripping. */
export function captureLoopiniWithHeld(speed, slots, held) {
  return captureLoopiniPreset({
    speed,
    slots: Array.from({ length: SLOTS }, (_, id) => (slots[id]?.filled ? { on: slots[id].on } : { on: held?.slots?.[id]?.on })),
  });
}

export function validateLoopiniPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.slots) || snapshot.slots.length !== SLOTS
    || presetStateKey(snapshot) !== presetStateKey(captureLoopiniPreset(snapshot))) {
    throw new TypeError("Invalid complete Loopini preset");
  }
  return snapshot;
}

const mask = text => [...text].map(char => ({ on: char === "1" }));
const scene = (id, label, speed, pattern) => Object.freeze({
  id, label, snapshot: Object.freeze(captureLoopiniPreset({ speed, slots: mask(pattern) })),
});

export const LOOPINI_FULL_PRESETS = Object.freeze([
  scene("everything-on", "Everything on", 1, "111111"),
  scene("half-speed", "Half speed", 0.5, "111111"),
  scene("double-speed", "Double speed", 2, "111111"),
  scene("slow-and-low", "Slow and low", 0.75, "111111"),
  scene("quick-and-bright", "Quick and bright", 1.5, "111111"),
  scene("odds-only", "Odds only", 1, "101010"),
  scene("evens-only", "Evens only", 1, "010101"),
  scene("first-three", "First three", 1, "111000"),
  scene("last-three", "Last three", 1, "000111"),
  scene("solo-first", "Solo first", 0.85, "100000"),
  scene("solo-last", "Solo last", 1.2, "000001"),
  scene("outer-pair", "Outer pair", 1, "100001"),
  scene("inner-four", "Inner four", 0.67, "011110"),
  scene("tape-drag", "Tape drag", 0.6, "110101"),
  scene("gentle-lift", "Gentle lift", 1.15, "111110"),
]);

export function randomizeLoopiniPreset(current, random = Math.random) {
  validateLoopiniPreset(current);
  const rng = presetRandom(random);
  const slots = Array.from({ length: SLOTS }, () => ({ on: rng.unit() < 0.6 }));
  slots[rng.integer(0, SLOTS - 1)].on = true;
  let speed = round(minSpeed * (maxSpeed / minSpeed) ** rng.unit());
  // Few states exist, so step the speed off any preset or the current state rather than repeat one.
  const taken = new Set([current, ...LOOPINI_FULL_PRESETS.map(preset => preset.snapshot)].map(presetStateKey));
  while (taken.has(presetStateKey({ speed, slots }))) speed = round(speed + 0.01 > maxSpeed ? minSpeed : speed + 0.01);
  return validateLoopiniPreset({ speed, slots });
}
