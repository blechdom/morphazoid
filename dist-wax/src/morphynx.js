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
const boundedInteger = (value, minimum, maximum, fallback = minimum) => {
  const number = Number(value);
  return Math.round(clamp(Number.isFinite(number) ? number : fallback, minimum, maximum));
};
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

const ARTICULATION_PLACE_POSITION = Object.freeze({
  glottal: 0.04,
  velar: 0.58,
  palatal: 0.7,
  postalveolar: 0.8,
  alveolar: 0.88,
  dental: 0.93,
  labiodental: 0.97,
  bilabial: 0.995,
});

// Safe startup trim for the hotter two-mass branch. The app refines it from
// paired worklet meters while both endpoints are audible, then ramps the gain.
export const MORPHYNX_HUMAN_BRANCH_TRIM = 0.16;

function cloneVoiceState(source) {
  return {
    ...source,
    throats: (source.throats ?? []).map((value) => ({ ...value })),
    tongues: (source.tongues ?? []).map((value) => ({ ...value })),
    noses: (source.noses ?? []).map((value) => ({ ...value })),
    pressureSources: (source.pressureSources ?? []).map((value) => ({ ...value })),
  };
}

function applyPhoneme(source, phonemeId, { preserveTopology = false } = {}) {
  const articulation = ARTICULATIONS[phonemeId];
  if (!articulation) return source;
  const phoneme = articulation.gesture ?? articulation;
  const manner = articulation.manner ?? phoneme.kind ?? source.articulationManner;
  return {
    ...source,
    phoneme: phonemeId,
    tongueCount: preserveTopology ? source.tongueCount : phoneme.tongueCount,
    noseCount: preserveTopology ? source.noseCount : phoneme.noseCount,
    oralClosure: phoneme.oralClosure,
    lipDiameter: phoneme.lipDiameter,
    articulationPlace: phoneme.tongues[0]?.position ?? source.articulationPlace,
    articulationAperture: 1 - clamp(phoneme.oralClosure),
    articulationManner: manner,
    articulationVoicing: articulation.voiced === false
      ? 0.04
      : articulation.voiced === true
        ? 1
        : source.articulationVoicing,
    articulationPlaceName: articulation.place ?? "",
    glottalClosure: articulation.glottalClosure ?? source.glottalClosure ?? 0,
    frication: articulation.frication ? { ...articulation.frication } : source.frication,
    burst: articulation.burst ? { ...articulation.burst } : source.burst,
    nasalCoupling: manner === "nasal"
      ? Math.max(source.nasalCoupling ?? 0, articulation.nasalCoupling ?? 0.84)
      : source.nasalCoupling,
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
  let next = applyPhoneme(cloneVoiceState(base), phoneme, {
    preserveTopology: Boolean(anatomyId),
  });
  if (capitalLetter && capitalExpression(capitalLetter)) {
    next = capitalizedPerformanceState(next, capitalLetter);
  }
  return next;
}

export function humanizedControls(voiceState = voicePresetState("clear")) {
  const voice = cloneVoiceState(voiceState);
  const lipDiameter = Number.isFinite(voice.lipDiameter) ? voice.lipDiameter : 1.8;
  const throatCount = boundedInteger(voice.throatCount, 1, 7, 1);
  const tongueCount = boundedInteger(voice.tongueCount, 1, 5, 1);
  const noseCount = boundedInteger(voice.noseCount, 0, 3, 0);
  const manner = voice.articulationManner ?? "vowel";
  const isStop = manner === "stop" || manner === "affricate";
  const isFricative = manner === "fricative" || manner === "affricate";
  const isNasal = manner === "nasal";
  const isLateral = manner === "approximant" && voice.phoneme === "l";
  const tongues = (voice.tongues ?? []).slice(0, tongueCount).map((tongue, index) => ({
    tongueEnabled: true,
    tongueAnatomy: "human",
    tonguePosition: clamp(tongue?.position ?? 0.5),
    tongueHeight: clamp((tongue?.height ?? 0.24) * (
      isLateral ? (index === 0 ? 0.58 : 0.48) : (index === 0 ? 0.92 : 0.68)
    )),
    tongueShape: clamp(tongue?.curl ?? 0.35),
    tongueTip: clamp((tongue?.curl ?? 0.25) * 0.82 + (tongue?.height ?? 0.2) * 0.18),
    tongueLateral: isLateral ? 0.98 : 0.12,
  }));
  const noses = (voice.noses ?? []).slice(0, noseCount);
  const noseOpenness = mean(noses.map(({ openness }) => Number(openness)), 0);
  const nasalNetwork = 1 - noses.reduce(
    (closed, nose) => closed * (1 - clamp(Number(nose?.openness)) * 0.72),
    1,
  );
  const nasalResonance = mean(noses.map(({ resonance }) => Number(resonance)), 0.45);
  const nasalLength = mean(noses.map(({ length }) => Number(length)), 0.55);
  const pitchRatio = Number.isFinite(voice.pitchRatio) ? voice.pitchRatio : 1;
  const bodyLength = clamp(voice.bodyLength ?? 0.55);
  const breath = clamp(voice.exciterBreath ?? voice.breath ?? 0.12);
  const intensity = clamp(voice.exciterIntensity ?? voice.intensity ?? 0.8);
  const pressure = clamp(0.28 + Math.sqrt(intensity) * 0.46, 0.2, 0.76);
  const oralOpening = 1 - clamp(voice.oralClosure ?? 0);
  const airwayGate = manner === "vowel"
    ? null
    : isStop
      ? clamp(oralOpening * 0.08)
      : isFricative
        ? clamp(0.1 + oralOpening * 0.28)
        : isNasal
          ? 0.08
          : clamp(0.34 + oralOpening * 0.34);
  return Object.freeze({
    model: "mammal",
    frequencyHz: clamp((voice.exciterPitch ?? 140) * pitchRatio, 24, 2_400),
    pressure,
    tension: clamp(voice.exciterTenseness ?? voice.tension ?? 0.58),
    adduction: clamp((voice.articulationVoicing ?? 0.92) * 0.68 + (1 - breath) * 0.32),
    breath,
    sourceScale: clamp(0.2 + bodyLength * 0.72, 0.08, 1),
    asymmetry: clamp((voice.mutation ?? 0) * 0.72, -1, 1),
    sourceBalance: 0,
    roughness: clamp((voice.growl ?? 0) * 0.74 + (voice.mutation ?? 0) * 0.34),
    pulseRateHz: 22 + clamp(voice.exciterWobble ?? 0.12) * 34,
    coupling: clamp(0.18 + (voice.coupling ?? 0) * 0.68),
    feedback: clamp(0.28 + (1 - oralOpening) * 0.46),
    outputGain: 0.58,
    tractLengthM: 0.09 + bodyLength * 0.2,
    mouthOpening: clamp((lipDiameter - 0.35) / 2.65) * (isLateral ? 0.72 : oralOpening),
    cavityCoupling: clamp(
      Math.max(voice.nasalCoupling ?? 0, nasalNetwork, noseOpenness) * 0.86
        + noseCount * 0.025
        + Math.max(0, noseCount - 1) * 0.09,
    ),
    cavityFrequencyHz: clamp(
      190 + nasalResonance * 360 + (1 - nasalLength) * 210,
      110,
      1_200,
    ),
    throatCount,
    tongueCount,
    noseCount,
    tongues: Object.freeze(tongues.map((tongue) => Object.freeze(tongue))),
    voiceSpreadCents: clamp(
      8 + (voice.mutation ?? 0) * 28 + (voice.growl ?? 0) * 12,
      0,
      52,
    ),
    airwayGate,
    gatePosition: clamp(
      ARTICULATION_PLACE_POSITION[voice.articulationPlaceName]
        ?? voice.articulationPlace
        ?? tongues[0]?.tonguePosition
        ?? 0.72,
    ),
    lateralBypass: isLateral ? 0.58 : 0,
    nasalBypass: isNasal ? clamp(0.5 + nasalNetwork * 0.42) : 0,
    turbulence: clamp((voice.frication?.gain ?? 0) * (isFricative ? 0.9 : 0), 0, 1.5),
    articulationVoicing: clamp(voice.articulationVoicing ?? 0.94),
    articulationPressure: clamp((voice.oralClosure ?? 0) * (isStop ? 1 : 0.46)),
    burstGain: clamp(voice.burst?.gain ?? 0, 0, 1.5),
    burstFrequencyHz: clamp(voice.burst?.frequency ?? 1_050, 80, 18_000),
    levelMatchEligible: manner === "vowel",
    minimumLevelTrim: isFricative ? 0.65 : isNasal ? 0.06 : isLateral ? 0.55 : 0.04,
  });
}

export function morphynxMix(
  morph = DEFAULT_MORPHYNX_STATE.morph,
  humanTrim = MORPHYNX_HUMAN_BRANCH_TRIM,
) {
  const amount = clamp(morph);
  const trim = clamp(humanTrim, 0.04, 8);
  return Object.freeze({
    animalGain: Math.cos(amount * Math.PI * 0.5),
    humanGain: Math.sin(amount * Math.PI * 0.5) * trim,
    humanTrim: trim,
  });
}

export function morphynxLevelMatchTrim(
  animalMeter = {},
  humanMeter = {},
  fallback = MORPHYNX_HUMAN_BRANCH_TRIM,
) {
  const animalRms = Math.max(0, Number(animalMeter.rms) || 0);
  const humanRms = Math.max(0, Number(humanMeter.rms) || 0);
  if (animalRms < 0.0005 || humanRms < 0.0005) return clamp(fallback, 0.04, 8);
  const rmsRatio = animalRms / humanRms;
  const animalPeak = Math.max(0, Number(animalMeter.peak) || 0);
  const humanPeak = Math.max(0, Number(humanMeter.peak) || 0);
  const peakRatio = animalPeak > 0.0005 && humanPeak > 0.0005
    ? animalPeak / humanPeak * 2
    : rmsRatio;
  return clamp(Math.min(rmsRatio, peakRatio), 0.04, 8);
}

export function morphynxConfiguration({
  animal = animalState(DEFAULT_MORPHYNX_STATE.animalId, { biologicalLock: false }),
  voice = morphynxVoiceState(),
  morph = DEFAULT_MORPHYNX_STATE.morph,
  active = false,
  motion = 0,
  humanTrim = MORPHYNX_HUMAN_BRANCH_TRIM,
  calibrateEndpoints = false,
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
  const performancePressure = clamp(animal.pressure ?? animalSource.pressure);
  const performanceTension = clamp(animal.tension ?? animalSource.tension);
  const performanceAdduction = clamp(animal.adduction ?? animalSource.adduction);
  const performanceRoughness = clamp(animal.roughness ?? animalSource.roughness);
  const performanceAsymmetry = clamp(animalSource.asymmetry, -1, 1);
  const performanceBalance = clamp(animalSource.sourceBalance, -1, 1);
  const animalEndpointSource = Object.freeze({
    ...animalSource,
    pressure: active && (amount < 1 || calibrateEndpoints)
      ? clamp(performancePressure * (1 + motionAmount * 0.06))
      : 0,
    tension: clamp(performanceTension + motion * 0.025),
    adduction: performanceAdduction,
    roughness: clamp(performanceRoughness + motionAmount * 0.025),
    asymmetry: performanceAsymmetry,
    sourceBalance: performanceBalance,
    outputGain: 0.82,
    voiceCount: 1,
    voiceSpreadCents: 0,
  });
  const humanEndpointSource = Object.freeze({
    ...human,
    model: human.model,
    frequencyHz: human.frequencyHz * (1 + motion * 0.028),
    pressure: active && (amount > 0 || calibrateEndpoints)
      ? clamp(performancePressure * 0.76 + human.pressure * 0.24)
      : 0,
    tension: clamp(performanceTension * 0.72 + human.tension * 0.28 + motion * 0.02),
    adduction: clamp(performanceAdduction * 0.76 + human.adduction * 0.24),
    breath: clamp(animalSource.breath * 0.42 + human.breath * 0.58),
    asymmetry: clamp(performanceAsymmetry * 0.62 + human.asymmetry * 0.38, -1, 1),
    sourceBalance: performanceBalance,
    roughness: clamp(performanceRoughness * 0.72 + human.roughness * 0.52),
    coupling: clamp(animalSource.coupling * 0.36 + human.coupling * 0.64),
    feedback: clamp(animalSource.feedback * 0.34 + human.feedback * 0.66),
    outputGain: human.outputGain,
    voiceCount: human.throatCount,
    voiceSpreadCents: human.voiceSpreadCents * (1 - human.coupling * 0.48),
  });
  const animalEndpointTract = Object.freeze({
    animalId: animalDefinition.id,
    model: animalEndpointSource.model,
    tractLengthM: animal.tractLengthM,
    mouthOpening: animal.mouthOpening,
    cavityCoupling: animal.cavityCoupling,
    cavityFrequencyHz: animalDefinition.cavityFrequencyHz,
    cavityBranches: 1,
    tongueEnabled: false,
  });
  const humanEndpointTract = Object.freeze({
    animalId: "mammal",
    model: humanEndpointSource.model,
    tractLengthM: clamp(human.tractLengthM * (
      0.72 + Math.sqrt(clamp((animal.tractLengthM - 0.018) / (0.82 - 0.018))) * 0.7
    ), 0.018, 0.82),
    mouthOpening: clamp(animal.mouthOpening * 0.62 + human.mouthOpening * 0.38),
    cavityCoupling: clamp(animal.cavityCoupling * 0.52 + human.cavityCoupling * 0.68),
    cavityFrequencyHz: human.cavityFrequencyHz,
    cavityBranches: human.noseCount,
    tongueEnabled: human.tongueCount > 0,
    tongueCount: human.tongueCount,
    tongues: human.tongues,
    airwayGate: human.airwayGate,
    gatePosition: human.gatePosition,
    lateralBypass: human.lateralBypass,
    nasalBypass: human.nasalBypass,
    turbulence: human.turbulence,
    articulationVoicing: human.articulationVoicing,
    articulationPressure: human.articulationPressure,
    burstGain: human.burstGain,
    burstFrequencyHz: human.burstFrequencyHz,
  });
  const mix = morphynxMix(amount, Math.max(humanTrim, human.minimumLevelTrim));
  const source = Object.freeze({
    model: amount <= 0 ? animalEndpointSource.model : amount >= 1 ? human.model : "hybrid",
    frequencyHz: lerp(animalEndpointSource.frequencyHz, humanEndpointSource.frequencyHz, amount)
      * (1 + motion * 0.035),
    pressure: lerp(animalEndpointSource.pressure, humanEndpointSource.pressure, amount),
    tension: lerp(animalEndpointSource.tension, humanEndpointSource.tension, amount),
    adduction: lerp(animalEndpointSource.adduction, humanEndpointSource.adduction, amount),
    breath: lerp(animalEndpointSource.breath, humanEndpointSource.breath, amount),
    sourceScale: lerp(animalEndpointSource.sourceScale, humanEndpointSource.sourceScale, amount),
    asymmetry: lerp(animalEndpointSource.asymmetry, humanEndpointSource.asymmetry, amount),
    sourceBalance: lerp(animalEndpointSource.sourceBalance, humanEndpointSource.sourceBalance, amount),
    roughness: lerp(animalEndpointSource.roughness, humanEndpointSource.roughness, amount),
    pulseRateHz: lerp(animalEndpointSource.pulseRateHz, humanEndpointSource.pulseRateHz, amount),
    coupling: lerp(animalEndpointSource.coupling, humanEndpointSource.coupling, amount),
    feedback: lerp(animalEndpointSource.feedback, humanEndpointSource.feedback, amount),
    outputGain: lerp(animalEndpointSource.outputGain, humanEndpointSource.outputGain, amount),
  });
  const tract = Object.freeze({
    animalId: amount <= 0 ? animalDefinition.id : amount >= 1 ? "mammal" : "hybrid",
    model: source.model,
    tractLengthM: lerp(animalEndpointTract.tractLengthM, humanEndpointTract.tractLengthM, amount),
    mouthOpening: lerp(animalEndpointTract.mouthOpening, humanEndpointTract.mouthOpening, amount),
    cavityCoupling: lerp(animalEndpointTract.cavityCoupling, humanEndpointTract.cavityCoupling, amount),
    cavityFrequencyHz: lerp(animalEndpointTract.cavityFrequencyHz, humanEndpointTract.cavityFrequencyHz, amount),
  });
  return Object.freeze({
    source,
    tract,
    animalSource: animalEndpointSource,
    humanSource: humanEndpointSource,
    animalTract: animalEndpointTract,
    humanTract: humanEndpointTract,
    mix,
    animal: animalDefinition,
    human,
    morph: amount,
  });
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
