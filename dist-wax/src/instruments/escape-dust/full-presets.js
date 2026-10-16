import { choice, defineParamModel, range } from "../preset-kit/param-schema.js";

const WAVE_SIZE = 81;
const OPENING_CELLS = Object.freeze(Array.from({ length: 12 }, (_, index) => 15 + index * 2));

export const ESCAPE_DUST_MODEL = defineParamModel({
  packetPosition: range(0.02, 0.98, 0.005),
  packetMomentum: range(0.02, 0.98, 0.005),
  packetSpread: range(0.025, 0.18, 0.001),
  openingCells: choice(OPENING_CELLS),
  seed: range(1, 999, 1),
  stepRate: range(0.5, 8, 0.5),
  view: choice(["classical", "wave", "overlay"]),
}, { label: "Escape Dust" });

export const ESCAPE_DUST_PRESET_KEYS = ESCAPE_DUST_MODEL.keys;
export const openingCellsFromWidth = width => Math.round(width * WAVE_SIZE);
export const openingWidthFromCells = cells => cells / WAVE_SIZE;
export const captureEscapeDustPreset = state => ESCAPE_DUST_MODEL.sanitize({
  ...state, openingCells: openingCellsFromWidth(state.openingWidth),
});
export const validateEscapeDustPreset = ESCAPE_DUST_MODEL.validate;
export const randomizeEscapeDustPreset = ESCAPE_DUST_MODEL.randomize;

const dust = (packetPosition, packetMomentum, packetSpread, openingCells, seed, stepRate, view) => (
  { packetPosition, packetMomentum, packetSpread, openingCells, seed, stepRate, view }
);

export const ESCAPE_DUST_FULL_PRESETS = ESCAPE_DUST_MODEL.bank([
  ["open-triadic", "Open triadic packet", dust(0.24, 0.68, 0.072, 27, 37, 2, "overlay")],
  ["narrow-keyhole", "Narrow keyhole", dust(0.5, 0.5, 0.04, 15, 37, 2, "overlay")],
  ["wide-door", "Wide-open door", dust(0.3, 0.6, 0.09, 37, 101, 2, "overlay")],
  ["fast-leak", "Fast leak", dust(0.2, 0.8, 0.05, 33, 37, 6, "classical")],
  ["slow-wave-seep", "Slow wave seep", dust(0.75, 0.25, 0.12, 21, 222, 0.5, "wave")],
  ["corner-packet", "Corner packet", dust(0.08, 0.92, 0.03, 27, 314, 3, "overlay")],
  ["centered-smear", "Centered smear", dust(0.5, 0.5, 0.18, 25, 37, 1.5, "wave")],
  ["sharp-classical-dust", "Sharp classical dust", dust(0.35, 0.15, 0.025, 29, 512, 4, "classical")],
  ["edge-hugger", "Edge hugger", dust(0.95, 0.5, 0.06, 19, 77, 2.5, "overlay")],
  ["seed-lottery", "Sparse seed lottery", dust(0.6, 0.7, 0.1, 23, 888, 5, "classical")],
  ["diagonal-glide", "Diagonal glide", dust(0.15, 0.15, 0.07, 31, 19, 3.5, "overlay")],
  ["door-at-the-wall", "Door at the wall", dust(0.5, 0.97, 0.045, 17, 640, 7, "wave")],
  ["heavy-fog", "Heavy fog", dust(0.4, 0.35, 0.16, 35, 5, 1, "wave")],
]);
