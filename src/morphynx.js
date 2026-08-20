import {
  ANIMALS,
  animalState,
  clamp,
  resolveSourceControls,
} from "./syrinx.js";
import {
  ARTICULATIONS,
  SPECIMENS,
  VOICE_PRESETS,
  capitalExpression,
  capitalizedPerformanceState,
  keyboardArticulation,
  keyboardPresetShortcut,
  specimenState,
  voicePresetState,
} from "./throatazoid.js";

const lerp = (from, to, amount) => from + (to - from) * clamp(amount);
const mean = (values, fallback = 0) => {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? finite.reduce((total, value) => total + value, 0) / finite.length
    : fallback;
};

const FORMANTS = Object.freeze({
  a: Object.freeze([730, 1_090, 2_440]),
  e: Object.freeze([530, 1_840, 2_480]),
  i: Object.freeze([270, 2_290, 3_010]),
  o: Object.freeze([570, 840, 2_410]),
  u: Object.freeze([300, 870, 2_240]),
});

const PHONEME_VOWEL = Object.freeze({
  a: "a", b: "a", c: "i", d: "e", e: "e", f: "u", g: "a", h: "a",
  i: "i", j: "i", k: "a", l: "e", m: "u", n: "e", o: "o", p: "a",
  q: "u", r: "a", s: "i", t: "e", u: "u", v: "u", w: "u", x: "i",
  y: "i", z: "i", glottal: "a",
});

function cloneVoiceState(source) {
  return {
    ...source,
    throats: (source.throats ?? []).map((value) => ({ ...value })),
    tongues: (source.tongues ?? []).map((value) => ({ ...value })),
    noses: (source.noses ?? []).map((value) => ({ ...value })),
    pressureSources: (source.pressureSources ?? []).map((value) => ({ ...value })),
  };
}

function applyPhoneme(source, phonemeId) {
  const articulation = ARTICULATIONS[phonemeId];
  if (!articulation) return source;
  const phoneme = articulation.gesture ?? articulation;
  return {
    ...source,
    phoneme: phonemeId,
    tongueCount: phoneme.tongueCount,
    noseCount: phoneme.noseCount,
    oralClosure: phoneme.oralClosure,
    lipDiameter: phoneme.lipDiameter,
    articulationPlace: phoneme.tongues[0]?.position ?? source.articulationPlace,
    articulationAperture: 1 - clamp(phoneme.oralClosure),
    articulationManner: articulation.manner ?? phoneme.kind ?? source.articulationManner,
    tongues: phoneme.tongues.map((value) => ({ ...value })),
    noses: phoneme.noses.map((value) => ({ ...value })),
  };
}

export const MORPHYNX_VOICE_PRESETS = Object.freeze(Object.entries(VOICE_PRESETS).map(
  ([id, preset]) => Object.freeze({
    id,
    label: preset.name,
    description: preset.description,
  }),
));

export const MORPHYNX_ANATOMIES = Object.freeze(Object.entries(SPECIMENS).map(
  ([id, specimen]) => Object.freeze({
    id,
    label: specimen.name,
    description: specimen.description,
  }),
));

export const DEFAULT_MORPHYNX_STATE = Object.freeze({
  animalId: "raven",
  callId: ANIMALS.raven.callIds[0],
  voicePreset: "clear",
  anatomyId: "",
  phoneme: "a",
  capitalLetter: "",
  morph: 0.56,
  sourceMode: "internal",
  motionEnabled: true,
  motionDepth: 0.28,
  loop: false,
  loopGapMs: 650,
  gestureRate: 1,
  level: 0.48,
});

export function morphynxVoiceState({
  voicePreset = DEFAULT_MORPHYNX_STATE.voicePreset,
  anatomyId = "",
  phoneme = "",
  capitalLetter = "",
} = {}) {
  const base = anatomyId && SPECIMENS[anatomyId]
    ? specimenState(anatomyId)
    : voicePresetState(VOICE_PRESETS[voicePreset] ? voicePreset : "clear");
  let next = applyPhoneme(cloneVoiceState(base), phoneme);
  if (capitalLetter && capitalExpression(capitalLetter)) {
    next = capitalizedPerformanceState(next, capitalLetter);
  }
  return next;
}

export function humanizedControls(voiceState = voicePresetState("clear")) {
  const voice = cloneVoiceState(voiceState);
  const lipDiameter = Number.isFinite(voice.lipDiameter) ? voice.lipDiameter : 1.8;
  const noseOpenness = mean((voice.noses ?? []).map(({ openness }) => Number(openness)), 0);
  const pitchRatio = Number.isFinite(voice.pitchRatio) ? voice.pitchRatio : 1;
  const bodyLength = clamp(voice.bodyLength ?? 0.55);
  const breath = clamp(voice.exciterBreath ?? voice.breath ?? 0.12);
  const pressure = clamp(voice.exciterIntensity ?? voice.intensity ?? 0.8);
  const oralOpening = 1 - clamp(voice.oralClosure ?? 0);
  return Object.freeze({
    model: "mammal",
    frequencyHz: clamp((voice.exciterPitch ?? 140) * pitchRatio, 24, 2_400),
    pressure,
    tension: clamp(voice.exciterTenseness ?? voice.tension ?? 0.58),
    adduction: clamp((voice.articulationVoicing ?? 0.92) * 0.68 + (1 - breath) * 0.32),
    breath,
    sourceScale: clamp(0.2 + bodyLength * 0.72, 0.08, 1),
    asymmetry: clamp(voice.mutation ?? 0),
    sourceBalance: 0,
    roughness: clamp(Math.max(voice.growl ?? 0, voice.mutation ?? 0) * 0.82),
    coupling: clamp(0.26 + (voice.coupling ?? 0) * 0.54),
    feedback: clamp(0.28 + (1 - oralOpening) * 0.46),
    outputGain: 0.78,
    tractLengthM: 0.09 + bodyLength * 0.2,
    mouthOpening: clamp((lipDiameter - 0.35) / 2.65) * oralOpening,
    cavityCoupling: clamp(Math.max(voice.nasalCoupling ?? 0, noseOpenness) * 0.88),
    cavityFrequencyHz: clamp((voice.exciterPitch ?? 140) * 3.4, 110, 4_800),
  });
}

export function morphynxConfiguration({
  animal = animalState(DEFAULT_MORPHYNX_STATE.animalId, { biologicalLock: false }),
  voice = morphynxVoiceState(),
  morph = DEFAULT_MORPHYNX_STATE.morph,
  active = false,
  motion = 0,
} = {}) {
  const amount = clamp(morph);
  const animalDefinition = ANIMALS[animal.animalId] ?? ANIMALS.raven;
  const animalSource = resolveSourceControls({
    ...animal,
    active,
    biologicalLock: false,
  });
  const human = humanizedControls(voice);
  const motionAmount = clamp(Math.abs(motion), 0, 1);
  const source = Object.freeze({
    model: amount >= 0.68 ? human.model : animalSource.model,
    frequencyHz: lerp(animalSource.frequencyHz, human.frequencyHz, amount)
      * (1 + motion * 0.035),
    pressure: active
      ? clamp(lerp(animal.pressure, human.pressure, amount) * (1 + motionAmount * 0.08))
      : 0,
    tension: clamp(lerp(animalSource.tension, human.tension, amount) + motion * 0.025),
    adduction: lerp(animalSource.adduction, human.adduction, amount),
    breath: lerp(animalSource.breath, human.breath, amount),
    sourceScale: lerp(animalSource.sourceScale, human.sourceScale, amount),
    asymmetry: lerp(animalSource.asymmetry, human.asymmetry, amount),
    sourceBalance: lerp(animalSource.sourceBalance, human.sourceBalance, amount),
    roughness: clamp(lerp(animalSource.roughness, human.roughness, amount) + motionAmount * 0.03),
    pulseRateHz: lerp(animalSource.pulseRateHz, 22 + human.tension * 36, amount),
    coupling: lerp(animalSource.coupling, human.coupling, amount),
    feedback: lerp(animalSource.feedback, human.feedback, amount),
    outputGain: 0.78,
  });
  const tract = Object.freeze({
    animalId: amount >= 0.68 ? "mammal" : animalDefinition.id,
    model: source.model,
    tractLengthM: lerp(animal.tractLengthM, human.tractLengthM, amount),
    mouthOpening: lerp(animal.mouthOpening, human.mouthOpening, amount),
    cavityCoupling: lerp(animal.cavityCoupling, human.cavityCoupling, amount),
    cavityFrequencyHz: lerp(animalDefinition.cavityFrequencyHz, human.cavityFrequencyHz, amount),
  });
  return Object.freeze({ source, tract, animal: animalDefinition, human, morph: amount });
}

export function morphynxFormants(phonemeId = "a", voiceState = voicePresetState("clear")) {
  const vowel = PHONEME_VOWEL[phonemeId] ?? PHONEME_VOWEL[voiceState.phoneme] ?? "a";
  const values = FORMANTS[vowel];
  const lengthScale = 1.18 - clamp(voiceState.bodyLength ?? 0.55) * 0.34;
  const nasal = clamp(Math.max(
    voiceState.nasalCoupling ?? 0,
    mean((voiceState.noses ?? []).map(({ openness }) => Number(openness)), 0),
  ));
  return Object.freeze({
    frequencies: Object.freeze(values.map((frequency) => frequency * lengthScale)),
    nasalFrequency: 240 + nasal * 160,
    nasal,
  });
}

export function morphynxKeyboardCommand(key, code = "") {
  const anatomy = keyboardPresetShortcut(key, code);
  if (anatomy) return Object.freeze({ type: "anatomy", ...anatomy });
  const phoneme = keyboardArticulation(key);
  if (!phoneme) return null;
  return Object.freeze({
    type: "phoneme",
    phoneme,
    letter: /^[a-z]$/i.test(key) ? key.toLowerCase() : "",
  });
}
