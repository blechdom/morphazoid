import { DEFAULT_FM_DRUM_VOICES, sanitizeFmDrumVoice } from "./fm-drums.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const FM_DRUM_PRESET_KEYS = Object.freeze([
  "frequency", "attack", "decay", "modRatio", "modIndex", "pitchBend", "noise", "tone", "level",
]);
const FAMILY_KEYS = Object.freeze(["kick", "snare", "tom", "hat", "metal", "bell", "effect"]);

export function captureFmDrumPreset(voices) {
  const byId = new Map(voices.map(voice => [voice.id, voice]));
  return {
    voices: DEFAULT_FM_DRUM_VOICES.map(base => {
      const voice = sanitizeFmDrumVoice({ ...base, ...byId.get(base.id) });
      return { id: base.id, ...Object.fromEntries(FM_DRUM_PRESET_KEYS.map(key => [key, voice[key]])) };
    }),
  };
}

export function validateFmDrumPreset(snapshot) {
  if (!Array.isArray(snapshot?.voices) || snapshot.voices.length !== DEFAULT_FM_DRUM_VOICES.length
    || presetStateKey(snapshot) !== presetStateKey(captureFmDrumPreset(snapshot.voices))) {
    throw new TypeError("Invalid complete FM Drums preset");
  }
  return snapshot;
}

const scale = (value, factor) => value * factor;
const kit = (id, label, byFamily, all = {}) => {
  const voices = DEFAULT_FM_DRUM_VOICES.map(base => {
    const f = { ...all, ...byFamily[base.family] };
    return sanitizeFmDrumVoice({
      ...base,
      frequency: scale(base.frequency, f.tune ?? 1),
      attack: scale(base.attack, f.attack ?? 1),
      decay: scale(base.decay, f.decay ?? 1),
      modRatio: scale(base.modRatio, f.ratio ?? 1),
      modIndex: scale(base.modIndex, f.index ?? 1),
      pitchBend: base.pitchBend + (f.sweep ?? 0),
      noise: base.noise + (f.noise ?? 0),
      tone: base.tone + (f.tone ?? 0),
      level: scale(base.level, f.level ?? 1),
    });
  });
  const snapshot = captureFmDrumPreset(voices);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const FM_DRUM_FULL_PRESETS = Object.freeze([
  kit("factory", "Factory kit", {}),
  kit("deep-sub", "Deep sub", { kick: { tune: .72, decay: 1.5, index: .7 }, tom: { tune: .75, decay: 1.3 }, snare: { tune: .85 } }, { }),
  kit("glass-ward", "Glass ward", { bell: { tune: 1.4, decay: 1.5, index: 1.5, ratio: 1.2 }, metal: { tune: 1.3, ratio: 1.3 }, hat: { tune: 1.2 } }, { tone: .1 }),
  kit("tight-808", "Tight 808", { kick: { decay: 1.8, tune: .8, sweep: 1, attack: 1 }, snare: { decay: .8, noise: .1 }, hat: { decay: .6 } }),
  kit("radio-static", "Radio static", { snare: { noise: .25, decay: 1.2 }, hat: { noise: .2, decay: 1.8, tune: .8 }, metal: { noise: .3 } }, { tone: -.15, index: .8 }),
  kit("gamelan-court", "Gamelan court", { bell: { tune: 1.1, decay: 1.7, ratio: 1.5 }, tom: { tune: 1.6, decay: 1.2, ratio: 1.4 }, metal: { tune: .9, decay: 1.8 } }, { index: .7 }),
  kit("fm-cathedral", "FM cathedral", { kick: { index: 1.8, ratio: 1.3 }, snare: { index: 1.5 }, bell: { index: 1.7, decay: 1.4 }, effect: { index: 1.4 } }, { decay: 1.15 }),
  kit("rubber-band", "Rubber band", { kick: { sweep: 2, decay: .8 }, tom: { sweep: 2.5 }, effect: { sweep: 3 }, snare: { sweep: 1 } }, { index: 1.1 }),
  kit("tiny-toys", "Tiny toys", {}, { tune: 1.7, decay: .55, index: .8, level: .9 }),
  kit("iron-works", "Iron works", { metal: { tune: .7, decay: 1.6, index: 1.6, ratio: 1.25 }, snare: { ratio: 1.3, index: 1.4 }, kick: { tune: .9 } }, { noise: .08 }),
  kit("dry-room", "Dry room", {}, { decay: .45, attack: 1.2, tone: .1 }),
  kit("lunar-march", "Lunar march", { kick: { tune: .62, decay: 1.9, sweep: 1.5 }, tom: { tune: .7, decay: 1.8 }, bell: { tune: .6, decay: 2 }, hat: { tune: .6, decay: 1.5 } }, { index: .9, tone: -.1 }),
]);

const RANGES = {
  frequency: [.5, 1.9], attack: [.6, 2.4], decay: [.45, 2.2], modRatio: [.55, 1.9], modIndex: [.3, 2.2],
};

export function randomizeFmDrumPreset(current, random = Math.random) {
  validateFmDrumPreset(current);
  const rng = presetRandom(random);
  const kitScale = Object.fromEntries(FAMILY_KEYS.map(family => [family, {
    frequency: rng.between(...RANGES.frequency), decay: rng.between(...RANGES.decay),
    modRatio: rng.between(...RANGES.modRatio), modIndex: rng.between(...RANGES.modIndex),
  }]));
  const voices = DEFAULT_FM_DRUM_VOICES.map(base => {
    const k = kitScale[base.family];
    return sanitizeFmDrumVoice({
      ...base,
      frequency: base.frequency * k.frequency * rng.between(.9, 1.1),
      attack: base.attack * rng.between(...RANGES.attack),
      decay: base.decay * k.decay * rng.between(.85, 1.15),
      modRatio: base.modRatio * k.modRatio * rng.between(.92, 1.08),
      modIndex: base.modIndex * k.modIndex * rng.between(.85, 1.15),
      pitchBend: rng.between(-.4, 5),
      noise: rng.unit(), tone: rng.unit(),
      level: Math.min(1, base.level * rng.between(.75, 1.15)),
    });
  });
  return validateFmDrumPreset(captureFmDrumPreset(voices));
}
