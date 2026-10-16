import { MICROMORPH_PRESETS, sanitizeMicromorphParams } from "./micromorph.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const MICROMORPH_PRESET_KEYS = Object.freeze([
  "derivation", "material", "structureLock", "memory", "mutation", "continuation",
]);
const ANCHOR_LIMIT = 512;

const text = value => (typeof value === "string" ? value.slice(0, ANCHOR_LIMIT) : "");

export function captureMicromorphPreset(source) {
  const clean = sanitizeMicromorphParams(source.parameters ?? source);
  return {
    parameters: Object.fromEntries(MICROMORPH_PRESET_KEYS.map(key => [key, clean[key]])),
    anchors: { a: text(source.anchors?.a), b: text(source.anchors?.b) },
  };
}

export function validateMicromorphPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.anchors?.a || !snapshot.anchors?.b
    || presetStateKey(snapshot) !== presetStateKey(captureMicromorphPreset(snapshot))) {
    throw new TypeError("Invalid complete Micromorph preset");
  }
  return snapshot;
}

const scene = (id, label, anchorA, anchorB, [derivation, material, structureLock, memory, mutation, continuation]) => Object.freeze({
  id, label,
  snapshot: Object.freeze(captureMicromorphPreset({
    parameters: { derivation, material, structureLock, memory, mutation, continuation },
    anchors: { a: anchorA, b: anchorB },
  })),
});

export const MICROMORPH_FULL_PRESETS = Object.freeze([
  ...MICROMORPH_PRESETS.map(preset => Object.freeze({
    id: preset.id, label: preset.label, snapshot: Object.freeze(captureMicromorphPreset(preset)),
  })),
  scene("salt-flats", "Salt flats", "a whisper dried to crystalline grit", "wind singing across a mile of salt", [.46, .62, .7, .3, .14, .36]),
  scene("tide-pool", "Tide pool", "a murmur held under shallow water", "anemones answering in slow bubbles", [.64, .3, .55, .8, .2, .58]),
  scene("rust-cathedral", "Rust cathedral", "a hoarse voice in an empty boiler room", "an iron nave resonating a distant hymn", [.82, .84, .36, .66, .46, .3]),
  scene("paper-wasps", "Paper wasps", "dry consonants and clipped breaths", "a nest of paper wings chattering in unison", [.88, .48, .3, .4, .7, .22]),
  scene("moon-bone", "Moon bone", "a low hum against the roof of the mouth", "a hollow bone flute ringing on a cold night", [.36, .22, .86, .9, .06, .66]),
  scene("static-saint", "Static saint", "a plain spoken vowel with no ornament", "a radio saint murmuring through interference", [.74, .96, .2, .5, .84, .12]),
  scene("amber-ghost", "Amber ghost", "a gentle syllable trapped in resin", "the same syllable slowly escaping as warm smoke", [.52, .08, .62, .96, .32, .9]),
]);

const POOL_A = Object.freeze([
  "a close breath in a dry room", "a muffled hum behind cloth", "a clipped syllable and a wet click",
  "a hoarse whisper on a long exhale", "a steady vowel with a trembling edge", "a low growl held in the chest",
  "a bright consonant against the teeth", "a sleepy sigh near a microphone",
]);
const POOL_B = Object.freeze([
  "a glass choir folding into itself", "a swarm of tiny brass reeds", "slow moss answering from underground",
  "a stone throat singing through fog", "copper wire humming in a storm", "a distant whale made of paper",
  "an electric moth circling a lamp", "warm bells dissolving in rain",
]);

export function randomizeMicromorphPreset(current, random = Math.random) {
  validateMicromorphPreset(current);
  const rng = presetRandom(random);
  const lock = rng.between(.1, .95);
  const parameters = {
    derivation: rng.between(.12, .98), material: rng.unit(), structureLock: lock,
    memory: rng.between(.1, .98), mutation: rng.between(0, Math.min(.9, 1.05 - lock)),
    continuation: rng.between(0, .95),
  };
  return validateMicromorphPreset(captureMicromorphPreset({
    parameters, anchors: { a: rng.pick(POOL_A), b: rng.pick(POOL_B) },
  }));
}
