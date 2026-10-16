import { ORDER_TONES_PRESETS, dominantPeakBins, orderFindingDistribution } from "./order-tones.js";
import { choice, defineParamModel, range } from "../preset-kit/param-schema.js";

const MODULI = Object.freeze(ORDER_TONES_PRESETS.map(preset => preset.modulus));
const ALL_BASES = Object.freeze([...new Set(ORDER_TONES_PRESETS.flatMap(preset => preset.bases))].sort((a, b) => a - b));

const constrain = snapshot => {
  const { bases, defaultBase } = ORDER_TONES_PRESETS.find(preset => preset.modulus === snapshot.modulus);
  const base = bases.includes(snapshot.base) ? snapshot.base : bases[snapshot.base % bases.length] ?? defaultBase;
  return { ...snapshot, base, selectedBin: snapshot.selectedBin % 2 ** snapshot.precision };
};

export const ORDER_TONES_MODEL = defineParamModel({
  modulus: choice(MODULI),
  base: choice(ALL_BASES),
  precision: range(6, 9, 1),
  view: choice(["computational", "iqft"]),
  selectedBin: range(0, 511, 1),
}, { constrain, label: "Order Tones" });

export const ORDER_TONES_PRESET_KEYS = ORDER_TONES_MODEL.keys;
export const captureOrderTonesPreset = state => ORDER_TONES_MODEL.sanitize(state);
export const validateOrderTonesPreset = ORDER_TONES_MODEL.validate;
export const randomizeOrderTonesPreset = ORDER_TONES_MODEL.randomize;

const peak = (modulus, base, precision, rank) => {
  const { probabilities } = orderFindingDistribution(modulus, base, precision);
  const bins = dominantPeakBins(probabilities, rank + 1, { includeZero: false });
  return bins[rank] ?? bins[0];
};
const tones = (modulus, base, precision, view, rank = 0) => (
  { modulus, base, precision, view, selectedBin: peak(modulus, base, precision, rank) }
);

export const ORDER_TONES_FULL_PRESETS = ORDER_TONES_MODEL.bank([
  ["classic-15", "Classic 2ˣ mod 15", tones(15, 2, 8, "computational")],
  ["comb-15", "Inverse-QFT comb · 15", tones(15, 2, 8, "iqft", 2)],
  ["seven-mod-15", "Seven mod 15 · 128 bins", tones(15, 7, 7, "computational")],
  ["half-turn-15", "Half-turn period · 11 mod 15", tones(15, 11, 6, "iqft")],
  ["fine-grid-15", "Fine grid · 14 mod 15", tones(15, 14, 9, "computational")],
  ["sextet-21", "Sextet · 2ˣ mod 21", tones(21, 2, 8, "computational")],
  ["wide-comb-21", "Wide comb · 5ˣ mod 21", tones(21, 5, 9, "iqft", 1)],
  ["mirror-21", "Mirror pair · 20 mod 21", tones(21, 20, 7, "computational")],
  ["dozen-35", "Dozen steps · 2ˣ mod 35", tones(35, 2, 9, "computational")],
  ["dozen-comb-35", "Dozen comb · 3ˣ mod 35", tones(35, 3, 8, "iqft", 3)],
  ["flip-35", "Flip · 34 mod 35", tones(35, 34, 6, "computational")],
  ["quartet-35", "Quartet · 8ˣ mod 35", tones(35, 8, 8, "iqft")],
  ["coarse-21", "Coarse grid · 8ˣ mod 21", tones(21, 8, 6, "iqft")],
]);
