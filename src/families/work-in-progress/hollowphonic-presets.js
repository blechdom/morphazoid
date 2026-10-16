import { HOLLOW_PRESETS } from "./hollowphonic.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const HOLLOWPHONIC_PRESET_KEYS = Object.freeze(["depth", "loss", "coupling", "mix"]);
export const HOLLOWPHONIC_DEFAULT_OFFSETS = Object.freeze([0, 0.13, -0.17]);
const OFFSET_LIMIT = 0.4;

const num = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function captureHollowphonicPreset(source) {
  const snapshot = Object.fromEntries(HOLLOWPHONIC_PRESET_KEYS.map(key => [key, num(source[key], 0, 1, 0.5)]));
  snapshot.generator = Math.round(num(source.generator, 0, 2, 1));
  snapshot.offsets = HOLLOWPHONIC_DEFAULT_OFFSETS.map((fallback, i) => num(source.offsets?.[i], -OFFSET_LIMIT, OFFSET_LIMIT, fallback));
  return snapshot;
}

export function validateHollowphonicPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureHollowphonicPreset(snapshot))) {
    throw new TypeError("Invalid complete Hollowphonic preset");
  }
  return snapshot;
}

const scene = (id, label, [depth, loss, coupling, mix], generator, offsets = HOLLOWPHONIC_DEFAULT_OFFSETS) => Object.freeze({
  id, label, snapshot: Object.freeze(captureHollowphonicPreset({ depth, loss, coupling, mix, generator, offsets })),
});

export const HOLLOWPHONIC_FULL_PRESETS = Object.freeze([
  ...Object.entries(HOLLOW_PRESETS).map(([name, p]) => scene(
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name,
    [p.depth, p.loss, p.coupling, p.mix], p.source,
  )),
  scene("cathedral-nave", "Cathedral nave", [0.9, 0.1, 0.45, 0.95], 2, [0, 0.2, 0.35]),
  scene("tin-cistern", "Tin cistern", [0.7, 0.3, 0.2, 0.9], 1, [-0.1, 0.05, 0.1]),
  scene("bottle-choir", "Bottle choir", [0.35, 0.2, 0.6, 1], 2, [-0.25, 0.1, 0.3]),
  scene("brass-pipe", "Brass pipe", [0.15, 0.08, 0.3, 1], 2, [0, 0.12, -0.12]),
  scene("wet-tunnel", "Wet tunnel", [0.62, 0.55, 0.8, 0.9], 1, [0.1, -0.1, 0.2]),
  scene("thin-glass", "Thin glass", [0.05, 0.05, 0.85, 1], 1, [0.05, 0.3, -0.3]),
  scene("stone-well", "Stone well", [0.95, 0.28, 0.08, 0.8], 1, [0.02, 0.02, 0.02]),
  scene("padded-closet", "Padded closet", [0.4, 0.92, 0.15, 0.7], 2),
  scene("strike-chapel", "Strike chapel", [0.78, 0.15, 0.5, 1], 0, [-0.1, 0.2, 0.3]),
  scene("whisper-coupling", "Whisper coupling", [0.5, 0.35, 0.95, 0.6], 1, [0.3, -0.3, 0]),
  scene("detuned-trio", "Detuned trio", [0.5, 0.25, 0.35, 1], 2, [-0.35, 0, 0.35]),
]);

export function randomizeHollowphonicPreset(current, random = Math.random) {
  validateHollowphonicPreset(current);
  const rng = presetRandom(random);
  return validateHollowphonicPreset(captureHollowphonicPreset({
    depth: rng.between(0.05, 0.95), loss: rng.between(0.05, 0.9), coupling: rng.between(0, 0.95), mix: rng.between(0.4, 1),
    generator: rng.pick([0, 1, 1, 1, 2, 2, 2]),
    offsets: HOLLOWPHONIC_DEFAULT_OFFSETS.map(() => rng.between(-0.35, 0.35)),
  }));
}
