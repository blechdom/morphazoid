import { PHYSICAL_SOUND_LIMITS, physicalSoundDefinition, sanitizePhysicalSoundState } from "../../physical-sounds.js";
import { DENTAPHONE_PITCH_LAYOUTS, sanitizeDentaphonePitchState } from "./dentaphone.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const KIND = "object-forge";
export const DENTAPHONE_SOUND_KEYS = Object.freeze([
  "presetId", "size", "damping", "brightness", "energy", "stereoWidth", "stiffness", "strikePosition", "pickupPosition", "modeCount",
]);
export const DENTAPHONE_PITCH_KEYS = Object.freeze(["layout", "root", "octave"]);
export const DENTAPHONE_MATERIALS = Object.freeze(
  Object.fromEntries(Object.values(physicalSoundDefinition(KIND).presets).map(preset => [preset.id, preset.settings.modeCount])),
);

/** Tooth pitch follows the pitch map, so base frequency and imported modal JSON are not preset-owned. */
export function captureDentaphonePreset(source) {
  const state = sanitizePhysicalSoundState(KIND, { ...source.sound, modalJson: "" });
  const pitch = sanitizeDentaphonePitchState(source.pitch);
  return {
    sound: Object.fromEntries(DENTAPHONE_SOUND_KEYS.map(key => [key, state[key]])),
    pitch: Object.fromEntries(DENTAPHONE_PITCH_KEYS.map(key => [key, pitch[key]])),
  };
}

export function validateDentaphonePreset(snapshot) {
  if (!snapshot?.sound || !snapshot.pitch || presetStateKey(snapshot) !== presetStateKey(captureDentaphonePreset(snapshot))) {
    throw new TypeError("Invalid complete Dentaphone preset");
  }
  return snapshot;
}

const scene = (id, label, sound, pitch) => {
  const snapshot = captureDentaphonePreset({ sound, pitch });
  validateDentaphonePreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};
const body = (presetId, values) => ({
  size: 1, damping: 0.48, brightness: 0.55, energy: 0.7, stereoWidth: 0.42, stiffness: 0.5, strikePosition: 0.37,
  pickupPosition: 0.63, modeCount: DENTAPHONE_MATERIALS[presetId], ...values, presetId,
});

export const DENTAPHONE_FULL_PRESETS = Object.freeze([
  scene("wood-marimba", "Wood marimba", body("wood-bar", { damping: 0.4, stiffness: 0.34 }), { layout: "marimba-split", root: 0, octave: 3 }),
  scene("glass-chromatic", "Glass chromatic", body("glass-bowl", { damping: 0.2, brightness: 0.7, stereoWidth: 0.7 }), { layout: "paired-chromatic", root: 0, octave: 3 }),
  scene("bronze-gamelan", "Bronze gamelan", body("bronze-bell", { damping: 0.3, size: 1.4, energy: 0.78, stereoWidth: 0.6 }), { layout: "twin-diatonic", root: 2, octave: 2 }),
  scene("steel-plates", "Steel plates", body("steel-plate", { damping: 0.35, brightness: 0.75, stiffness: 0.7, strikePosition: 0.22 }), { layout: "opposed-arches", root: 7, octave: 2 }),
  scene("ceramic-tiles", "Ceramic tiles", body("ceramic-tile", { damping: 0.58, brightness: 0.62, strikePosition: 0.5 }), { layout: "twin-diatonic", root: 5, octave: 3 }),
  scene("deep-wood-drums", "Deep wood drums", body("wood-bar", { size: 2.4, damping: 0.55, energy: 0.9, brightness: 0.3, strikePosition: 0.3 }), { layout: "marimba-split", root: 3, octave: 1 }),
  scene("tiny-glass-bells", "Tiny glass bells", body("glass-bowl", { size: 0.4, damping: 0.12, brightness: 0.85, energy: 0.6, modeCount: 6 }), { layout: "twin-diatonic", root: 9, octave: 3 }),
  scene("bronze-drone", "Bronze drone", body("bronze-bell", { size: 2, damping: 0.08, energy: 0.65, stereoWidth: 0.9, strikePosition: 0.15, pickupPosition: 0.85 }), { layout: "opposed-arches", root: 0, octave: 1 }),
  scene("dry-tile-clicks", "Dry tile clicks", body("ceramic-tile", { size: 0.7, damping: 0.9, brightness: 0.4, energy: 0.55, modeCount: 5, stiffness: 0.85 }), { layout: "paired-chromatic", root: 4, octave: 3 }),
  scene("steel-shimmer", "Steel shimmer", body("steel-plate", { size: 0.6, damping: 0.1, brightness: 0.95, stereoWidth: 1, stiffness: 0.25, strikePosition: 0.6 }), { layout: "paired-chromatic", root: 10, octave: 2 }),
  scene("soft-wood-lullaby", "Soft wood lullaby", body("wood-bar", { size: 1.2, damping: 0.65, energy: 0.45, brightness: 0.35, stereoWidth: 0.3, stiffness: 0.2, modeCount: 5 }), { layout: "twin-diatonic", root: 7, octave: 2 }),
  scene("wide-glass-pairs", "Wide glass pairs", body("glass-bowl", { size: 1.6, damping: 0.3, energy: 0.8, stereoWidth: 1, pickupPosition: 0.2 }), { layout: "opposed-arches", root: 2, octave: 3 }),
]);

export function randomizeDentaphonePreset(current, random = Math.random) {
  validateDentaphonePreset(current);
  const rng = presetRandom(random);
  const limits = PHYSICAL_SOUND_LIMITS[KIND];
  const presetId = rng.pick(Object.keys(DENTAPHONE_MATERIALS));
  return validateDentaphonePreset(captureDentaphonePreset({
    sound: {
      presetId, size: Math.exp(rng.between(Math.log(0.4), Math.log(2.6))), damping: rng.between(0.05, 0.95),
      brightness: rng.unit(), energy: rng.between(0.35, 1), stereoWidth: rng.unit(), stiffness: rng.unit(),
      strikePosition: rng.between(0.08, 0.92), pickupPosition: rng.between(0.08, 0.92),
      modeCount: rng.integer(Math.max(limits.modeCount[0], 4), DENTAPHONE_MATERIALS[presetId]),
    },
    pitch: {
      layout: rng.pick(DENTAPHONE_PITCH_LAYOUTS.map(({ id }) => id)), root: rng.integer(0, 11), octave: rng.integer(1, 3),
    },
  }));
}
