import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { TEMPO_DEFAULTS } from "./tempo-tantrum.js";
import { clampNumber, roundTo } from "./preset-settle.js";

export const TEMPO_PRESET_PARAMS = Object.freeze(["tempo", "strength", "detune", "decay", "driver"]);
const RANGES = Object.freeze({
  tempo: [40, 240], strength: [0, 0.9], detune: [-0.6, 0.6], decay: [0.04, 0.8], driver: [0, 0.5],
});
const OFFSET_RANGE = Object.freeze([-0.45, 0.45]);
export const TEMPO_BODIES = 3;

export function captureTempoPreset(raw) {
  const snapshot = {};
  for (const key of TEMPO_PRESET_PARAMS) snapshot[key] = clampNumber(raw?.[key], ...RANGES[key], TEMPO_DEFAULTS[key]);
  const offsets = Array.isArray(raw?.offsets) ? raw.offsets : [];
  snapshot.offsets = Array.from({ length: TEMPO_BODIES }, (_, index) => clampNumber(offsets[index], ...OFFSET_RANGE, 0));
  return snapshot;
}

export function validateTempoPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.offsets) || snapshot.offsets.length !== TEMPO_BODIES
    || presetStateKey(snapshot) !== presetStateKey(captureTempoPreset(snapshot))) {
    throw new TypeError("Invalid complete Tempo Tantrum preset");
  }
  return snapshot;
}

const scene = (id, label, values, offsets = [0, 0, 0]) => Object.freeze({
  id, label, snapshot: Object.freeze(captureTempoPreset({ ...TEMPO_DEFAULTS, ...values, offsets })),
});

export const TEMPO_FULL_PRESETS = Object.freeze([
  scene("soft-agreement", "Soft agreement", {}, [0, -0.03, 0.04]),
  scene("on-the-edge", "On the edge", { tempo: 145, strength: 0.12, detune: 0.18, decay: 0.12, driver: 0.2 }, [0, -0.03, 0.04]),
  scene("no-manners", "No manners", { tempo: 170, strength: 0.04, detune: 0.42, decay: 0.08, driver: 0.12 }, [0, -0.03, 0.04]),
  scene("slow-recovery", "Slow recovery", { tempo: 80, strength: 0.19, detune: 0.08, decay: 0.6, driver: 0.1 }, [0, -0.03, 0.04]),
  scene("clockwork", "Clockwork", { tempo: 126, strength: 0.84, detune: 0.02, decay: 0.16, driver: 0.3 }),
  scene("hemiola-drift", "Hemiola drift", { tempo: 108, strength: 0.22, detune: 0.26, decay: 0.2, driver: 0.18 }, [0.08, -0.12, 0.05]),
  scene("glacial-lock", "Glacial lock", { tempo: 46, strength: 0.5, detune: 0.05, decay: 0.78, driver: 0.24 }, [0.02, 0, -0.02]),
  scene("quiet-drive", "Quiet drive", { tempo: 96, strength: 0.38, detune: 0.1, decay: 0.34, driver: 0 }, [0, 0.03, -0.05]),
  scene("loud-metronome", "Loud metronome", { tempo: 100, strength: 0.7, detune: 0.04, decay: 0.1, driver: 0.5 }),
  scene("sprung-bodies", "Sprung bodies", { tempo: 132, strength: 0.46, detune: 0, decay: 0.28, driver: 0.14 }, [0.3, -0.3, 0.18]),
  scene("scattering-trio", "Scattering trio", { tempo: 196, strength: 0.08, detune: -0.34, decay: 0.06, driver: 0.08 }, [-0.2, 0.1, 0.32]),
  scene("backward-pull", "Backward pull", { tempo: 74, strength: 0.3, detune: -0.28, decay: 0.42, driver: 0.2 }, [-0.1, -0.06, 0]),
  scene("fast-lock", "Fast lock", { tempo: 214, strength: 0.9, detune: 0.1, decay: 0.05, driver: 0.12 }, [0.02, -0.04, 0.03]),
]);

export function randomizeTempoPreset(current, random = Math.random) {
  validateTempoPreset(current);
  const rng = presetRandom(random);
  const locked = rng.unit() < 0.55;
  const strength = roundTo(locked ? rng.between(0.35, 0.9) : rng.between(0, 0.3));
  const spread = locked ? 0.14 : 0.4;
  return validateTempoPreset({
    tempo: Math.round(rng.between(48, 204)),
    strength,
    detune: roundTo(rng.between(-spread, spread)),
    decay: roundTo(rng.between(0.05, 0.72)),
    driver: roundTo(rng.between(0, 0.45)),
    offsets: Array.from({ length: TEMPO_BODIES }, () => roundTo(rng.between(-0.28, 0.28))),
  });
}
