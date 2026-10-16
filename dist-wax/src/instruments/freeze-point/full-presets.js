import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const FREEZE_POINT_PRESET_KEYS = Object.freeze(["disorder", "coupling", "damping"]);
const RANGES = Object.freeze({ disorder: [0, 3], coupling: [0.05, 1], damping: [0.2, 8] });
const DEFAULTS = Object.freeze({ disorder: 0.4, coupling: 0.55, damping: 2.4 });

const clamp = (value, low, high, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};

export function captureFreezePointPreset(raw) {
  return Object.fromEntries(FREEZE_POINT_PRESET_KEYS.map(key => [key, clamp(raw?.[key], ...RANGES[key], DEFAULTS[key])]));
}

export function validateFreezePointPreset(snapshot) {
  if (!snapshot || presetStateKey(snapshot) !== presetStateKey(captureFreezePointPreset(snapshot))) {
    throw new TypeError("Invalid complete Freeze Point preset");
  }
  return snapshot;
}

const scene = (id, label, values) => Object.freeze({
  id, label, snapshot: Object.freeze(captureFreezePointPreset({ ...DEFAULTS, ...values })),
});

export const FREEZE_POINT_FULL_PRESETS = Object.freeze([
  scene("open-lattice", "Open lattice", {}),
  scene("spreading-bloom", "Spreading bloom", { disorder: 0.1, coupling: 0.9, damping: 3.6 }),
  scene("long-shimmer", "Long shimmer", { disorder: 0.25, coupling: 0.7, damping: 7 }),
  scene("edge-of-trapping", "Edge of trapping", { disorder: 0.95, coupling: 0.6, damping: 3 }),
  scene("just-frozen", "Just frozen", { disorder: 1.25, coupling: 0.55, damping: 2.4 }),
  scene("pinned-spark", "Pinned spark", { disorder: 2.4, coupling: 0.35, damping: 1.1 }),
  scene("deep-freeze", "Deep freeze", { disorder: 3, coupling: 0.15, damping: 6.5 }),
  scene("strong-coupling-thaw", "Strong coupling thaw", { disorder: 1.6, coupling: 1, damping: 4.2 }),
  scene("brittle-glass", "Brittle glass", { disorder: 0.6, coupling: 0.3, damping: 0.45 }),
  scene("slow-melt", "Slow melt", { disorder: 0.8, coupling: 0.45, damping: 5.4 }),
  scene("tight-cluster", "Tight cluster", { disorder: 1.9, coupling: 0.8, damping: 0.8 }),
  scene("whisper-network", "Whisper network", { disorder: 0.45, coupling: 0.1, damping: 2 }),
  scene("pulsing-lattice", "Pulsing lattice", { disorder: 0.7, coupling: 0.95, damping: 1.6 }),
]);

export function randomizeFreezePointPreset(current, random = Math.random) {
  validateFreezePointPreset(current);
  const rng = presetRandom(random);
  const frozen = rng.unit() < 0.45;
  return validateFreezePointPreset({
    disorder: Math.round((frozen ? rng.between(1, 3) : rng.between(0, 1.1)) * 100) / 100,
    coupling: Math.round(rng.between(0.08, 1) * 100) / 100,
    damping: Math.round(0.35 * 20 ** rng.unit() * 20) / 20,
  });
}
