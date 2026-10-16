import { choice, defineParamModel, range, toggle } from "../preset-kit/param-schema.js";

export const CANTOR_LOCK_MODEL = defineParamModel({
  depth: range(2, 5, 1),
  offset: range(0, 242, 1),
  seed: range(1, 999, 1),
  mode: choice(["cantor", "solid"]),
  tightened: toggle(),
}, {
  label: "Cantor Lock",
  constrain: snapshot => ({ ...snapshot, offset: snapshot.offset % 3 ** snapshot.depth }),
});

export const CANTOR_LOCK_PRESET_KEYS = CANTOR_LOCK_MODEL.keys;
export const captureCantorLockPreset = state => CANTOR_LOCK_MODEL.sanitize(state);
export const validateCantorLockPreset = CANTOR_LOCK_MODEL.validate;
export const randomizeCantorLockPreset = CANTOR_LOCK_MODEL.randomize;

const lock = (depth, offset, seed, mode, tightened) => ({ depth, offset, seed, mode, tightened });

export const CANTOR_LOCK_FULL_PRESETS = CANTOR_LOCK_MODEL.bank([
  ["seeded-depth-four", "Seeded depth four", lock(4, 0, 37, "cantor", false)],
  ["tight-depth-four", "Tightened depth four", lock(4, 0, 37, "cantor", true)],
  ["shallow-dust", "Shallow dust · depth 2", lock(2, 3, 11, "cantor", false)],
  ["shallow-locked", "Shallow lock · depth 3", lock(3, 7, 204, "cantor", true)],
  ["deep-lattice", "Deep lattice · depth 5", lock(5, 0, 37, "cantor", false)],
  ["deep-trap", "Deep tightened trap", lock(5, 81, 512, "cantor", true)],
  ["solid-comparator", "Solid comparator", lock(4, 0, 37, "solid", false)],
  ["solid-tightened", "Solid tightened", lock(4, 0, 37, "solid", true)],
  ["shifted-window", "Shifted window · offset 40", lock(4, 40, 88, "cantor", true)],
  ["wide-solid-five", "Wide solid · depth 5", lock(5, 120, 640, "solid", false)],
  ["seed-lottery", "Seed lottery", lock(4, 13, 777, "cantor", false)],
  ["tiny-solid", "Tiny solid cell", lock(2, 1, 3, "solid", true)],
  ["offset-edge", "Offset edge · depth 3", lock(3, 26, 950, "cantor", true)],
]);
