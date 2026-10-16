import { DEFAULT_SAMPLE_DRUM_VOICES, sanitizeSampleDrumVoice } from "./sample-drums.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const SAMPLE_DRUM_PRESET_KEYS = Object.freeze(["pitch", "attack", "decay", "tone", "level"]);
const FAMILY_KEYS = Object.freeze(["kick", "snare", "tom", "hat", "metal"]);

export function captureSampleDrumPreset(voices) {
  const byId = new Map(voices.map(voice => [voice.id, voice]));
  return {
    voices: DEFAULT_SAMPLE_DRUM_VOICES.map(base => {
      const voice = sanitizeSampleDrumVoice({ ...base, ...byId.get(base.id) });
      return { id: base.id, ...Object.fromEntries(SAMPLE_DRUM_PRESET_KEYS.map(key => [key, voice[key]])) };
    }),
  };
}

export function validateSampleDrumPreset(snapshot) {
  if (!Array.isArray(snapshot?.voices) || snapshot.voices.length !== DEFAULT_SAMPLE_DRUM_VOICES.length
    || presetStateKey(snapshot) !== presetStateKey(captureSampleDrumPreset(snapshot.voices))) {
    throw new TypeError("Invalid complete Sample Drums preset");
  }
  return snapshot;
}

const kit = (id, label, byFamily, all = {}) => {
  const voices = DEFAULT_SAMPLE_DRUM_VOICES.map(base => {
    const f = { ...all, ...byFamily[base.family] };
    return sanitizeSampleDrumVoice({
      ...base,
      pitch: base.pitch + (f.pitch ?? 0),
      attack: base.attack * (f.attack ?? 1),
      decay: base.decay * (f.decay ?? 1),
      tone: base.tone + (f.tone ?? 0),
      level: base.level * (f.level ?? 1),
    });
  });
  const snapshot = captureSampleDrumPreset(voices);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const SAMPLE_DRUM_FULL_PRESETS = Object.freeze([
  kit("factory", "Factory 808/909", {}),
  kit("sub-808", "Sub 808", { kick: { pitch: -7, decay: 1.8 }, tom: { pitch: -5, decay: 1.4 }, snare: { pitch: -2 } }, { tone: -.1 }),
  kit("tight-909", "Tight 909", { kick: { decay: .55, pitch: 1.5 }, snare: { decay: .6, tone: .1 }, hat: { decay: .35 }, tom: { decay: .6 } }, { tone: .08 }),
  kit("chipmunk", "Chipmunk break", {}, { pitch: 7, decay: .6, tone: .1 }),
  kit("tape-slowed", "Tape slowed", {}, { pitch: -9, decay: 1.5, tone: -.2, attack: 3 }),
  kit("hat-storm", "Hat storm", { hat: { pitch: 4, decay: 1.8, tone: .15 }, metal: { pitch: 3, decay: 1.6 }, kick: { level: .85 } }),
  kit("dub-room", "Dub room", { snare: { decay: 2.2, pitch: -3 }, tom: { decay: 1.9, pitch: -4 }, metal: { decay: 1.7, pitch: -2 } }, { tone: -.15, attack: 2 }),
  kit("clicks-cuts", "Clicks and cuts", { kick: { decay: .3, pitch: 5 }, snare: { decay: .25, pitch: 3 }, hat: { decay: .2, pitch: 6 }, metal: { decay: .25, pitch: 4 }, tom: { decay: .3, pitch: 5 } }, { tone: .2 }),
  kit("tom-parade", "Tom parade", { tom: { pitch: 3, decay: 1.6, level: 1.1 }, kick: { pitch: -3 }, snare: { pitch: 1 } }),
  kit("bell-metal", "Bell metal", { metal: { pitch: 7, decay: 2.2, tone: .15 }, hat: { pitch: 2, decay: 1.2 }, snare: { pitch: 4 } }, { attack: 1.5 }),
  kit("dark-industrial", "Dark industrial", { kick: { pitch: -4, decay: 1.3 }, snare: { pitch: -5, tone: -.25 }, hat: { pitch: -6, decay: 1.4 }, metal: { pitch: -5, decay: 1.5 } }, { tone: -.1, level: .95 }),
  kit("bright-pop", "Bright pop", { snare: { pitch: 2, tone: .25 }, hat: { tone: .2, pitch: 1 }, kick: { tone: .2 } }, { tone: .1, decay: .85 }),
  kit("slow-swell", "Slow swell", { kick: { attack: 12 }, snare: { attack: 20, decay: 1.5 }, tom: { attack: 15 }, metal: { attack: 25, decay: 1.4 }, hat: { attack: 10 } }),
]);

const RANGES = { pitch: [-8, 8], decay: [.35, 2.4], attack: [0, 1] };

export function randomizeSampleDrumPreset(current, random = Math.random) {
  validateSampleDrumPreset(current);
  const rng = presetRandom(random);
  const kitScale = Object.fromEntries(FAMILY_KEYS.map(family => [family, {
    pitch: rng.between(...RANGES.pitch), decay: rng.between(...RANGES.decay),
    attack: 30 ** rng.between(...RANGES.attack),
  }]));
  const voices = DEFAULT_SAMPLE_DRUM_VOICES.map(base => {
    const k = kitScale[base.family];
    return sanitizeSampleDrumVoice({
      ...base,
      pitch: base.pitch + k.pitch + rng.between(-2, 2),
      attack: base.attack * k.attack * rng.between(.8, 1.25),
      decay: base.decay * k.decay * rng.between(.85, 1.15),
      tone: rng.unit(),
      level: Math.min(1, base.level * rng.between(.75, 1.15)),
    });
  });
  return validateSampleDrumPreset(captureSampleDrumPreset(voices));
}
