import { ANIMALS, CONTROL_LIMITS, animalState } from "../../families/syrinx/syrinx.js";
import { ARTICULATIONS } from "../../families/tract/throatazoid.js";
import { MORPHYNX_ANATOMIES, MORPHYNX_VOICE_PRESETS, morphynxVoiceState } from "./morphynx.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const MORPHYNX_ANIMAL_KEYS = Object.freeze([
  "pressure", "tension", "adduction", "sourceScale", "tractLengthM",
  "mouthOpening", "cavityCoupling", "asymmetry", "sourceBalance", "roughness",
]);
export const MORPHYNX_ANATOMY_KEYS = Object.freeze(["throatCount", "tongueCount", "noseCount", "mutation", "coupling", "growl"]);
const INTEGER_ANATOMY = Object.freeze({ throatCount: [1, 7], tongueCount: [1, 5], noseCount: [1, 3] });
const VOICE_IDS = Object.freeze(MORPHYNX_VOICE_PRESETS.map(({ id }) => id));
const ANATOMY_IDS = Object.freeze(MORPHYNX_ANATOMIES.map(({ id }) => id));
const PHONEMES = Object.freeze(["a", "e", "i", "o", "u", "m", "n", "l", "r"]);

const num = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function captureMorphynxPreset(source) {
  const animalId = ANIMALS[source.animalId] ? source.animalId : "raven";
  const calls = ANIMALS[animalId].callIds;
  const base = animalState(animalId, { biologicalLock: false });
  const animal = Object.fromEntries(MORPHYNX_ANIMAL_KEYS.map(key => {
    const [lo, hi] = CONTROL_LIMITS[key];
    return [key, num(source.animal?.[key], lo, hi, base[key])];
  }));
  const anatomy = Object.fromEntries(MORPHYNX_ANATOMY_KEYS.map(key => {
    const [lo, hi] = INTEGER_ANATOMY[key] ?? [0, 1];
    const value = num(source.anatomy?.[key], lo, hi, lo);
    return [key, INTEGER_ANATOMY[key] ? Math.round(value) : value];
  }));
  return {
    animalId,
    callId: calls.includes(source.callId) ? source.callId : calls[0],
    voicePreset: VOICE_IDS.includes(source.voicePreset) ? source.voicePreset : "clear",
    anatomyId: ANATOMY_IDS.includes(source.anatomyId) ? source.anatomyId : "",
    phoneme: ARTICULATIONS[source.phoneme] ? source.phoneme : "a",
    morph: num(source.morph, 0, 1, .56),
    animal, anatomy,
    motionEnabled: Boolean(source.motionEnabled),
    motionDepth: num(source.motionDepth, 0, 1, .28),
    loop: Boolean(source.loop),
    gestureRate: num(source.gestureRate, .25, 2.5, 1),
    loopGapMs: num(source.loopGapMs, 0, 8000, 650),
  };
}

export function validateMorphynxPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureMorphynxPreset(snapshot))) {
    throw new TypeError("Invalid complete Morphynx preset");
  }
  return snapshot;
}

function anatomyOf(voicePreset, anatomyId) {
  const voice = morphynxVoiceState({ voicePreset, anatomyId, phoneme: "" });
  return {
    throatCount: voice.throatCount ?? 1, tongueCount: voice.tongueCount ?? 1, noseCount: voice.noseCount ?? 1,
    mutation: voice.mutation ?? 0, coupling: voice.coupling ?? 0, growl: voice.growl ?? 0,
  };
}

const scene = (id, label, animalId, callIndex, [voicePreset, anatomyId = ""], phoneme, morph, animal = {}, extra = {}) => {
  const { anatomy = {}, ...rest } = extra;
  const base = animalState(animalId, { biologicalLock: false });
  return Object.freeze({
    id, label,
    snapshot: Object.freeze(captureMorphynxPreset({
      animalId, callId: ANIMALS[animalId].callIds[callIndex], voicePreset, anatomyId, phoneme, morph,
      animal: { ...base, ...animal }, anatomy: { ...anatomyOf(voicePreset, anatomyId), ...anatomy },
      motionEnabled: true, motionDepth: .28, loop: false, gestureRate: 1, loopGapMs: 650, ...rest,
    })),
  });
};

export const MORPHYNX_FULL_PRESETS = Object.freeze([
  scene("raven-clear", "Raven x Playable default", "raven", 0, ["clear"], "a", .56),
  scene("lion-deep", "Lion x Deep", "lion", 0, ["deep"], "o", .4, { roughness: .6 }),
  scene("wolf-choir", "Wolf choir", "wolf", 0, ["choir"], "o", .62, { tension: .5 }, { loop: true, loopGapMs: 1800, gestureRate: .8 }),
  scene("elephant-oracle", "Elephant oracle", "elephant", 0, ["clear", "oracle"], "u", .5, {}, { motionDepth: .5 }),
  scene("songbird-soprano", "Songbird soprano", "songbird", 0, ["soprano"], "i", .3, { tension: .7, mouthOpening: .6 }, { gestureRate: 1.4 }),
  scene("dove-warm", "Dove x Warm", "dove", 0, ["warm"], "o", .45, {}, { loop: true, loopGapMs: 1200 }),
  scene("owl-whisper", "Owl whisper", "owl", 0, ["whisper"], "u", .7, { roughness: .3 }, { motionEnabled: false }),
  scene("frog-nasal", "Bullfrog x Nasal", "bullfrog", 0, ["nasal"], "a", .5, { cavityCoupling: .7 }),
  scene("hyena-growl", "Hyena growl", "hyena", 1, ["growl"], "a", .75, { roughness: .7, asymmetry: .5 }, { gestureRate: 1.5 }),
  scene("cat-singer", "Cat singer", "cat", 0, ["singer"], "e", .66, { tension: .6 }, { loop: true, loopGapMs: 900 }),
  scene("horse-hive", "Horse hive", "horse", 0, ["clear", "hive"], "a", .55, {}, { motionDepth: .6 }),
  scene("mouse-needle", "Mouse needle", "mouse", 0, ["bright", "needle"], "i", .35, {}, { gestureRate: 2 }),
  scene("alligator-maw", "Alligator maw", "alligator", 0, ["clear", "maw"], "o", .6, { roughness: .6 }, { gestureRate: .7, loop: true, loopGapMs: 2400 }),
  scene("cow-cathedral", "Cow cathedral", "cow", 0, ["clear", "cathedral"], "u", .52, { cavityCoupling: .5 }, { motionDepth: .45 }),
  scene("treefrog-void", "Treefrog void", "treefrog", 1, ["clear", "void"], "e", .82, { tension: .55 }, { anatomy: { mutation: .6, coupling: .5 } }),
  scene("dog-alien", "Dog x Alien", "dog", 0, ["alien"], "a", .9, { roughness: .5 }, { motionDepth: .6 }),
]);

export function morphynxPresetEntryForSnapshot(snapshot) {
  const key = presetStateKey(snapshot);
  return MORPHYNX_FULL_PRESETS.find(preset => presetStateKey(preset.snapshot) === key) ?? null;
}

export function randomizeMorphynxPreset(current, random = Math.random) {
  validateMorphynxPreset(current);
  const rng = presetRandom(random);
  const animalId = rng.pick(Object.keys(ANIMALS));
  const animal = ANIMALS[animalId];
  const useAnatomy = rng.unit() < .4;
  const spread = key => {
    const [lo, hi] = animal.bounds?.[key] ?? CONTROL_LIMITS[key];
    const shaped = .06 + rng.unit() * .88;
    return key === "tractLengthM" ? Math.exp(Math.log(lo) + shaped * Math.log(hi / lo)) : lo + shaped * (hi - lo);
  };
  return validateMorphynxPreset(captureMorphynxPreset({
    animalId, callId: rng.pick(animal.callIds),
    voicePreset: rng.pick(VOICE_IDS), anatomyId: useAnatomy ? rng.pick(ANATOMY_IDS) : "",
    phoneme: rng.pick(PHONEMES), morph: rng.between(.05, .98),
    animal: Object.fromEntries(MORPHYNX_ANIMAL_KEYS.map(key => [key, spread(key)])),
    anatomy: {
      throatCount: rng.integer(1, 7), tongueCount: rng.integer(1, 5), noseCount: rng.integer(1, 3),
      mutation: rng.between(0, .8), coupling: rng.between(0, .8), growl: rng.between(0, .8),
    },
    motionEnabled: rng.unit() < .6, motionDepth: rng.between(.1, .8),
    loop: rng.unit() < .35, gestureRate: rng.between(.5, 1.8), loopGapMs: rng.integer(0, 60) * 50,
  }));
}
