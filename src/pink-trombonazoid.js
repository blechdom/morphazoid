import {
  SPELLING_PRONUNCIATION_PHONE_CATALOG,
  isSpellingPronunciationVowel,
  spellingPhoneDefinition,
  spellingPronunciationTokens,
} from "./spelling-pronunciation.js?v=pink-trombonazoid-20260821-6";
import {
  isSpellingVowel,
  spellingPerformanceState,
  spellingSoundLabel,
  typingDynamics,
} from "./spelling-synthesizer.js?v=pink-trombonazoid-20260821-6";
import { MAX_THROATS } from "./throatazoid.js?v=pink-trombonazoid-20260821-6";

const DEFAULT_SAMPLE_COUNT = 128;
const MIN_SAMPLE_COUNT = 2;
const MAX_SAMPLE_COUNT = 2_048;
const DEFAULT_PERSONALITY = "clear";
const DEFAULT_CARRIER = "a";
const DEFAULT_INTERVAL_MS = 185;
const MIN_SEGMENT_MS = 24;
const MAX_SEGMENT_MS = 2_400;
export const PINK_TROMBONAZOID_LFO_SHAPES = Object.freeze([
  "sine",
  "triangle",
  "square",
  "sample-hold",
]);
const LFO_SHAPES = new Set(PINK_TROMBONAZOID_LFO_SHAPES);

const STOP_PHONES = new Set(["B", "D", "G", "K", "P", "T"]);
const AFFRICATE_PHONES = new Set(["CH", "JH"]);
const FRICATIVE_PHONES = new Set(["DH", "F", "HH", "S", "SH", "TH", "V", "Z", "ZH"]);
const NASAL_PHONES = new Set(["M", "N", "NG"]);
const APPROXIMANT_PHONES = new Set(["L", "R", "W", "Y"]);

export const PINK_TROMBONAZOID_DURATION_LIMITS = Object.freeze([
  MIN_SEGMENT_MS,
  MAX_SEGMENT_MS,
]);

export const PINK_TROMBONAZOID_LANES = Object.freeze([
  lane("pitch", "Pitch", "PITCH", "#d85f92", [40, 520], "Hz"),
  lane("intensity", "Voice intensity", "VOICE", "#e779a8", [0, 1]),
  lane("breath", "Breath", "BREATH", "#ffc0cb", [0, 1]),
  lane("tonguePosition", "Tongue position", "T POS", "#d85f92", [0, 1]),
  lane("tongueHeight", "Tongue height", "T HIGH", "#e779a8", [0, 1]),
  lane("lipOpening", "Lip opening", "LIPS", "#ffc0cb", [0, 4], "cm"),
  lane("nasalCoupling", "Nasal coupling", "NOSE", "#bd4f7a", [0, 1]),
  lane("mutation", "Mutation", "MUTATE", "#713047", [0, 1]),
]);

export const PINK_TROMBONAZOID_LANE_CATALOG = PINK_TROMBONAZOID_LANES;
export const PINK_TROMBONAZOID_AUTOMATION_LANES = PINK_TROMBONAZOID_LANES;
export const PINK_TROMBONAZOID_PHONE_CATALOG = SPELLING_PRONUNCIATION_PHONE_CATALOG;

export const PINK_TROMBONAZOID_PRESETS = deepFreeze({
  hello: {
    id: "hello",
    name: "Hello",
    text: "hello",
    personality: "clear",
    speechRate: 1,
  },
  "pink-trombone": {
    id: "pink-trombone",
    name: "Pink Trombone",
    text: "pink trombone",
    personality: "warm",
    speechRate: 0.94,
  },
  morphazoid: {
    id: "morphazoid",
    name: "Morphazoid",
    text: "morphazoid",
    personality: "creature",
    speechRate: 0.88,
  },
  sequencer: {
    id: "sequencer",
    name: "Sequencer",
    text: "sequencer",
    personality: "reed",
    speechRate: 1.08,
  },
});

export const DEFAULT_PINK_TROMBONAZOID_PRESET = "hello";

export const PINK_TROMBONAZOID_DEFAULTS = Object.freeze({
  preset: DEFAULT_PINK_TROMBONAZOID_PRESET,
  personality: DEFAULT_PERSONALITY,
  speechRate: 1,
  rhythmAmount: 0.34,
  intervalMs: DEFAULT_INTERVAL_MS,
  sampleCount: DEFAULT_SAMPLE_COUNT,
});

export const PINK_TROMBONAZOID_VOICE_HARMONIES = deepFreeze({
  shared: {
    id: "shared",
    name: "Linked throats",
    note: "one glottis through every branch",
    intervals: [0, 0, 0, 0, 0, 0, 0],
  },
  unison: {
    id: "unison",
    name: "Polyphonic unison",
    note: "one independent pitch per throat",
    intervals: [0, 0, 0, 0, 0, 0, 0],
  },
  fifths: {
    id: "fifths",
    name: "Open fifths",
    note: "stacked octaves and fifths",
    intervals: [-12, 0, 7, 12, 19, 24, 31],
  },
  choir: {
    id: "choir",
    name: "Choir chord",
    note: "wide fourths and fifths",
    intervals: [-12, -5, 0, 7, 12, 19, 24],
  },
});

export const PINK_TROMBONAZOID_VOICE_PRESETS = deepFreeze({
  clear: voicePreset("clear", "Clear solo", "plain and centered", "core", "clear"),
  warm: voicePreset("warm", "Velvet solo", "low and rounded", "core", "warm"),
  deep: voicePreset("deep", "Deep body", "larger, lower tract color", "core", "warm", {
    registerSemitones: -5,
    bodyLengthOffset: 0.18,
    tensionOffset: -0.05,
  }),
  bright: voicePreset("bright", "Bright body", "small, focused and taut", "core", "reed", {
    registerSemitones: 2,
    bodyLengthOffset: -0.12,
    tensionOffset: 0.05,
  }),
  alto: voicePreset("alto", "Alto", "raised velvet register", "register", "warm", {
    registerSemitones: 4,
    bodyLengthOffset: -0.06,
    tensionOffset: 0.02,
  }),
  mezzo: voicePreset("mezzo", "Mezzo", "clear upper-middle voice", "register", "clear", {
    registerSemitones: 6,
    bodyLengthOffset: -0.09,
    tensionOffset: 0.03,
  }),
  soprano: voicePreset("soprano", "Soprano", "light high register", "register", "clear", {
    registerSemitones: 9,
    bodyLengthOffset: -0.13,
    tensionOffset: 0.06,
  }),
  airy: voicePreset("airy", "Airy upper", "breathy and lifted", "register", "whisper", {
    registerSemitones: 4,
    bodyLengthOffset: -0.1,
    tensionOffset: -0.08,
  }),
  bell: voicePreset("bell", "Bell", "ringing high folds", "register", "reed", {
    registerSemitones: 9,
    bodyLengthOffset: -0.14,
    tensionOffset: 0.08,
  }),
  coloratura: voicePreset("coloratura", "Coloratura", "highest agile register", "register", "reed", {
    registerSemitones: 12,
    bodyLengthOffset: -0.18,
    tensionOffset: 0.06,
  }),
  whisper: voicePreset("whisper", "Whisper", "air-heavy and soft", "texture", "whisper", {
    tensionOffset: -0.08,
  }),
  reed: voicePreset("reed", "Reed", "pressed and electric", "texture", "reed", {
    tensionOffset: 0.08,
  }),
  beatbox: voicePreset("beatbox", "Beatbox", "low, taut consonant source", "texture", "clear", {
    registerSemitones: -4,
    tensionOffset: 0.12,
  }),
  double: voicePreset("double", "Double throat", "two linked resonators", "ensemble", "clear", {
    throatCount: 2,
    mouthVariation: 0.25,
    coupling: 0.18,
    spread: 0.55,
  }),
  unison: voicePreset("unison", "Unison stack", "three independently pitched throats", "ensemble", "clear", {
    throatCount: 3,
    harmony: "unison",
    detuneCents: 10,
    mouthVariation: 0.18,
    coupling: 0.12,
    spread: 0.85,
  }),
  fifths: voicePreset("fifths", "Open fifths", "three-voice octave and fifth", "ensemble", "warm", {
    throatCount: 3,
    harmony: "fifths",
    detuneCents: 6,
    bodyLengthOffset: 0.02,
    mouthVariation: 0.25,
    coupling: 0.22,
    spread: 0.85,
  }),
  choir: voicePreset("choir", "Choir", "five independently pitched throats", "ensemble", "warm", {
    throatCount: 5,
    harmony: "choir",
    detuneCents: 10,
    bodyLengthOffset: 0.04,
    tensionOffset: -0.04,
    mouthVariation: 0.32,
    coupling: 0.46,
    spread: 1,
  }),
  creature: voicePreset("creature", "Creature", "three coupled mutant throats", "ensemble", "creature", {
    throatCount: 3,
    registerSemitones: -3,
    bodyLengthOffset: 0.08,
    tensionOffset: 0.04,
    mouthVariation: 0.55,
    coupling: 0.5,
    spread: 0.92,
  }),
});

export const DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET = "clear";

const LANE_BY_ID = new Map(PINK_TROMBONAZOID_LANES.map((definition) => (
  [definition.id, definition]
)));
const CARRIER_SOURCE_LANE_IDS = new Set(["pitch", "intensity", "breath", "mutation"]);
const VOICE_DETUNE_PATTERN = Object.freeze([-1, 0.68, -0.38, 1, -0.72, 0.44, -0.22]);

function lane(id, label, shortLabel, color, range, unit = "") {
  return Object.freeze({
    id,
    parameter: id,
    label,
    shortLabel,
    color,
    range: Object.freeze([...range]),
    unit,
    normalized: true,
  });
}

function voicePreset(id, name, note, group, personality, settings = {}) {
  return {
    id,
    name,
    note,
    group,
    personality,
    voice: {
      preset: id,
      throatCount: 1,
      harmony: "shared",
      registerSemitones: 0,
      detuneCents: 0,
      bodyLengthOffset: 0,
      tensionOffset: 0,
      mouthVariation: 0,
      coupling: 0,
      spread: 0,
      ...settings,
    },
  };
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function clampInteger(value, minimum, maximum, fallback) {
  return Math.round(clamp(finite(value, fallback), minimum, maximum));
}

function pinkVoicePreset(value) {
  const key = String(value ?? DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET).toLowerCase();
  return PINK_TROMBONAZOID_VOICE_PRESETS[key]
    ?? PINK_TROMBONAZOID_VOICE_PRESETS[DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET];
}

export function normalizePinkTrombonazoidVoice(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const preset = pinkVoicePreset(source.preset);
  const requested = { ...preset.voice, ...source };
  const harmony = PINK_TROMBONAZOID_VOICE_HARMONIES[requested.harmony]
    ? requested.harmony
    : "shared";
  return deepFreeze({
    preset: preset.id,
    throatCount: clampInteger(requested.throatCount, 1, MAX_THROATS, 1),
    harmony,
    registerSemitones: clamp(requested.registerSemitones, -12, 12),
    detuneCents: clamp(requested.detuneCents, 0, 30),
    bodyLengthOffset: clamp(requested.bodyLengthOffset, -0.22, 0.22),
    tensionOffset: clamp(requested.tensionOffset, -0.25, 0.25),
    mouthVariation: clamp(requested.mouthVariation),
    coupling: clamp(requested.coupling, 0, 0.72),
    spread: clamp(requested.spread),
  });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function presetFor(value) {
  const key = String(value ?? DEFAULT_PINK_TROMBONAZOID_PRESET).toLowerCase();
  return PINK_TROMBONAZOID_PRESETS[key]
    ?? PINK_TROMBONAZOID_PRESETS[DEFAULT_PINK_TROMBONAZOID_PRESET];
}

function normalizedLaneValue(id, rawValue) {
  const definition = LANE_BY_ID.get(id);
  if (!definition) return 0;
  const [minimum, maximum] = definition.range;
  return clamp((finite(rawValue, minimum) - minimum) / Math.max(1e-9, maximum - minimum));
}

function rawLaneValue(id, normalized) {
  const definition = LANE_BY_ID.get(id);
  if (!definition) return 0;
  const [minimum, maximum] = definition.range;
  return minimum + clamp(normalized) * (maximum - minimum);
}

function laneValuesFromPerformance(performance = {}) {
  const tongue = performance.tongues?.[0] ?? {};
  return Object.freeze({
    pitch: normalizedLaneValue("pitch", performance.exciterPitch),
    intensity: normalizedLaneValue("intensity", performance.exciterIntensity),
    breath: normalizedLaneValue("breath", performance.exciterBreath),
    tonguePosition: normalizedLaneValue("tonguePosition", tongue.position),
    tongueHeight: normalizedLaneValue("tongueHeight", tongue.height),
    lipOpening: normalizedLaneValue("lipOpening", performance.lipDiameter),
    nasalCoupling: normalizedLaneValue("nasalCoupling", performance.nasalCoupling),
    mutation: normalizedLaneValue("mutation", performance.mutation),
  });
}

function sanitizeLaneOverrides(candidate = {}) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  return Object.freeze(Object.fromEntries(
    PINK_TROMBONAZOID_LANES
      .filter(({ id }) => Number.isFinite(Number(source[id])))
      .map(({ id }) => [id, clamp(source[id])]),
  ));
}

function performanceWithLaneValues(performance, values = {}) {
  const next = {
    ...performance,
    throats: performance.throats?.map((throat) => ({ ...throat })) ?? [],
    tongues: performance.tongues?.map((tongue) => ({ ...tongue })) ?? [],
    noses: performance.noses?.map((nose) => ({ ...nose })) ?? [],
    pressureSources: performance.pressureSources?.map((source) => ({ ...source })) ?? [],
    voiceIntervals: [...(performance.voiceIntervals ?? [])],
    voiceDetunes: [...(performance.voiceDetunes ?? [])],
  };

  if (Number.isFinite(values.pitch)) next.exciterPitch = rawLaneValue("pitch", values.pitch);
  if (Number.isFinite(values.intensity)) {
    next.exciterIntensity = rawLaneValue("intensity", values.intensity);
  }
  if (Number.isFinite(values.breath)) next.exciterBreath = rawLaneValue("breath", values.breath);
  if (Number.isFinite(values.lipOpening)) {
    next.lipDiameter = rawLaneValue("lipOpening", values.lipOpening);
  }
  if (Number.isFinite(values.nasalCoupling)) {
    next.nasalCoupling = rawLaneValue("nasalCoupling", values.nasalCoupling);
  }
  if (Number.isFinite(values.mutation)) next.mutation = rawLaneValue("mutation", values.mutation);
  if (next.tongues[0]) {
    if (Number.isFinite(values.tonguePosition)) {
      next.tongues[0].position = rawLaneValue("tonguePosition", values.tonguePosition);
      next.articulationPlace = next.tongues[0].position;
    }
    if (Number.isFinite(values.tongueHeight)) {
      next.tongues[0].height = rawLaneValue("tongueHeight", values.tongueHeight);
    }
  }
  return deepFreeze(next);
}

/**
 * Apply pronunciation-safe global voice coloration to a performance state.
 * Articulation, tongue, lip, nasal, closure, and timing fields are deliberately
 * left untouched so this layer cannot rewrite the selected phone.
 */
export function pinkTrombonazoidVoicePerformance(performance, settings = {}) {
  if (!performance || typeof performance !== "object") return performance;
  const voice = normalizePinkTrombonazoidVoice(settings);
  const harmony = PINK_TROMBONAZOID_VOICE_HARMONIES[voice.harmony];
  const polyphonic = voice.throatCount > 1 && voice.harmony !== "shared";
  const baseThroats = performance.throats ?? [];
  const throats = Array.from({ length: MAX_THROATS }, (_, index) => {
    const source = baseThroats[index]
      ?? baseThroats[index % Math.max(1, baseThroats.length)]
      ?? { aperture: 0.9, length: 0.56, muted: false };
    const position = voice.throatCount <= 1
      ? 0
      : clamp(index / Math.max(1, voice.throatCount - 1) * 2 - 1, -1, 1);
    const irregularity = Math.sin((index + 1) * 1.93);
    return {
      ...source,
      aperture: clamp(
        finite(source.aperture, 0.9) + irregularity * voice.mouthVariation * 0.08,
        0.08,
        1,
      ),
      length: clamp(
        finite(source.length, 0.56)
          + position * voice.mouthVariation * 0.12
          + irregularity * voice.mouthVariation * 0.025,
        0.05,
        1,
      ),
      muted: index < voice.throatCount ? false : Boolean(source.muted),
    };
  });
  const next = {
    ...performance,
    throatCount: voice.throatCount,
    bodyLength: clamp(finite(performance.bodyLength, 0.55) + voice.bodyLengthOffset),
    coupling: voice.throatCount > 1 ? voice.coupling : 0,
    spread: voice.throatCount > 1 ? voice.spread : 0,
    exciterPitch: clamp(
      finite(performance.exciterPitch, 140) * 2 ** (voice.registerSemitones / 12),
      40,
      520,
    ),
    exciterTenseness: clamp(
      finite(performance.exciterTenseness, 0.58) + voice.tensionOffset,
    ),
    classicTopology: Boolean(
      voice.throatCount === 1
      && !polyphonic
      && performance.classicTopology
    ),
    voiceMode: polyphonic ? "polyphonic" : "shared",
    voiceIntervals: harmony.intervals.map((interval) => interval),
    voiceDetunes: VOICE_DETUNE_PATTERN.map((amount) => amount * voice.detuneCents),
    throats,
    tongues: performance.tongues?.map((tongue) => ({ ...tongue })) ?? [],
    noses: performance.noses?.map((nose) => ({ ...nose })) ?? [],
    pressureSources: performance.pressureSources?.map((source) => ({ ...source })) ?? [],
    pinkVoicePreset: voice.preset,
    pinkVoiceHarmony: voice.harmony,
  };
  return deepFreeze(next);
}

function boundaryDurationMs(source) {
  const value = String(source ?? "");
  if (/[.!?]/.test(value)) return 360;
  if (/\r|\n/.test(value)) return 240;
  if (/[:;]/.test(value)) return 230;
  if (/,/.test(value)) return 175;
  if (/\s/.test(value)) return 82;
  return 56;
}

function phoneDurationMs(phone, stress, vowel = isSpellingPronunciationVowel(phone)) {
  const id = String(phone ?? "").toUpperCase();
  if (vowel) return stress > 0 ? 190 : 138;
  if (STOP_PHONES.has(id)) return 78;
  if (AFFRICATE_PHONES.has(id)) return 116;
  if (FRICATIVE_PHONES.has(id)) return id === "HH" ? 82 : 104;
  if (NASAL_PHONES.has(id)) return 112;
  if (APPROXIMANT_PHONES.has(id)) return 108;
  return 96;
}

function gestureWeights(count, vowel) {
  if (count <= 1) return [1];
  if (vowel && count === 2) return [0.58, 0.42];
  return Array.from({ length: count }, () => 1 / count);
}

function articulationCarrier(phoneEntries, phoneIndex, fallback) {
  for (let index = phoneIndex; index < phoneEntries.length; index += 1) {
    const definition = spellingPhoneDefinition(phoneEntries[index]?.id);
    if (!definition?.vowel) continue;
    const carrier = definition.gestures.find((gesture) => isSpellingVowel(gesture));
    if (carrier) return carrier;
  }
  return isSpellingVowel(fallback) ? String(fallback).toLowerCase() : DEFAULT_CARRIER;
}

function pronunciationTokens(value, pronunciations) {
  if (!Array.isArray(value)) return spellingPronunciationTokens(value, pronunciations);
  return value.map((token) => {
    const common = {
      type: token?.type === "word" ? "word" : "boundary",
      source: String(token?.source ?? ""),
      start: Math.max(0, Math.trunc(finite(token?.start))),
      end: Math.max(0, Math.trunc(finite(token?.end))),
    };
    if (common.type !== "word") return common;
    return {
      ...common,
      phones: Array.isArray(token?.phones)
        ? token.phones.map((phone) => ({
          id: String(phone?.id ?? phone ?? "").toUpperCase(),
          stress: clamp(finite(phone?.stress), 0, 2),
        }))
        : [],
    };
  });
}

function cloneTokens(tokens) {
  return tokens.map((token) => ({
    type: token.type,
    source: token.source,
    start: token.start,
    end: token.end,
    ...(token.type === "word" ? {
      phones: token.phones.map((phone) => ({ id: phone.id, stress: phone.stress })),
    } : {}),
  }));
}

function dynamicsForDraft(draft) {
  const capital = /[A-Z]/.test(draft.wordSource ?? "");
  const base = typingDynamics({
    intervalMs: draft.intervalMs,
    averageIntervalMs: DEFAULT_INTERVAL_MS,
    amount: draft.rhythmAmount,
    capital,
  });
  const stress = clamp(draft.stress, 0, 2);
  const stressAmount = draft.vowel ? stress * 0.18 : 0;
  const pitchCents = base.pitchCents + stressAmount * 115;
  const emphasis = clamp(base.emphasis + stressAmount);
  return Object.freeze({
    ...base,
    stress,
    emphasis,
    pitchCents,
    pitchRatio: 2 ** (pitchCents / 1_200),
    velocity: clamp(base.velocity + stressAmount * 0.28),
    durationMs: clamp(draft.durationMs, MIN_SEGMENT_MS, MAX_SEGMENT_MS),
    attackMs: draft.vowel ? 8 : draft.manner === "stop" ? 3 : 5,
    releaseMs: draft.vowel ? 34 : draft.manner === "fricative" ? 28 : 24,
  });
}

function mannerForPhone(phone, vowel) {
  if (vowel) return "vowel";
  if (STOP_PHONES.has(phone)) return "stop";
  if (AFFRICATE_PHONES.has(phone)) return "affricate";
  if (FRICATIVE_PHONES.has(phone)) return "fricative";
  if (NASAL_PHONES.has(phone)) return "nasal";
  if (APPROXIMANT_PHONES.has(phone)) return "approximant";
  return "consonant";
}

function makeArticulationDraft({
  token,
  wordIndex,
  phone,
  phoneIndex,
  definition,
  articulation,
  articulationIndex,
  carrierVowel,
  durationMs,
  personality,
  rhythmAmount,
  intervalMs,
}) {
  const nextCarrier = isSpellingVowel(articulation)
    ? String(articulation).toLowerCase()
    : carrierVowel;
  return {
    id: `word-${wordIndex}-phone-${phoneIndex}-articulation-${articulationIndex}`,
    type: "articulation",
    wordId: `word-${wordIndex}`,
    phoneId: `word-${wordIndex}-phone-${phoneIndex}`,
    wordIndex,
    phoneIndex,
    articulationIndex,
    wordSource: token.source,
    wordPhones: token.phones.map(({ id, stress }) => ({ id, stress })),
    sourceStart: token.start,
    sourceEnd: token.end,
    phone: phone.id,
    phoneLabel: phone.id,
    stress: phone.stress,
    vowel: Boolean(definition.vowel),
    sampleKey: articulationIndex === 0 ? definition.sampleKey : "",
    voicing: definition.voicing,
    articulation,
    articulationLabel: spellingSoundLabel(articulation),
    soundLabel: phone.id,
    carrierVowel: nextCarrier,
    activeCarrierVowel: carrierVowel,
    durationMs,
    personality,
    rhythmAmount,
    intervalMs,
    manner: mannerForPhone(phone.id, definition.vowel),
    sustain: false,
    wordSpeech: true,
    laneOverrides: Object.freeze({}),
  };
}

function draftsFromTokens(tokens, options) {
  const drafts = [];
  let wordIndex = 0;
  let boundaryIndex = 0;
  let voiceCarrier = DEFAULT_CARRIER;
  for (const token of tokens) {
    if (token.type !== "word") {
      drafts.push({
        id: `boundary-${boundaryIndex++}`,
        type: "boundary",
        source: token.source,
        sourceStart: token.start,
        sourceEnd: token.end,
        durationMs: boundaryDurationMs(token.source) / options.speechRate,
      });
      continue;
    }
    for (let phoneIndex = 0; phoneIndex < token.phones.length; phoneIndex += 1) {
      const phone = token.phones[phoneIndex];
      const definition = spellingPhoneDefinition(phone.id);
      if (!definition?.gestures?.length) continue;
      const carrier = articulationCarrier(token.phones, phoneIndex, voiceCarrier);
      const weights = gestureWeights(definition.gestures.length, definition.vowel);
      const totalDuration = phoneDurationMs(phone.id, phone.stress, definition.vowel)
        / options.speechRate;
      definition.gestures.forEach((articulation, articulationIndex) => {
        const draft = makeArticulationDraft({
          token,
          wordIndex,
          phone,
          phoneIndex,
          definition,
          articulation,
          articulationIndex,
          carrierVowel: carrier,
          durationMs: totalDuration * weights[articulationIndex],
          personality: options.personality,
          rhythmAmount: options.rhythmAmount,
          intervalMs: options.intervalMs,
        });
        drafts.push(draft);
        if (isSpellingVowel(articulation)) voiceCarrier = articulation;
      });
    }
    wordIndex += 1;
  }
  return drafts;
}

function materializeArticulation(draft, startMs, sequenceIndex) {
  const dynamics = dynamicsForDraft(draft);
  let performance = spellingPerformanceState({
    personality: draft.personality,
    articulation: draft.articulation,
    carrierVowel: draft.activeCarrierVowel,
    dynamics,
  });
  if (draft.voicing !== null && Number.isFinite(Number(draft.voicing))) {
    performance = { ...performance, articulationVoicing: clamp(draft.voicing) };
  }
  const carrierDynamics = {
    ...dynamics,
    breathAccent: dynamics.breathAccent * 0.35,
  };
  let carrierPerformance = spellingPerformanceState({
    personality: draft.personality,
    articulation: draft.carrierVowel,
    carrierVowel: draft.carrierVowel,
    dynamics: carrierDynamics,
  });
  performance = performanceWithLaneValues(performance, draft.laneOverrides);
  const carrierOverrides = draft.vowel
    ? draft.laneOverrides
    : Object.fromEntries(Object.entries(draft.laneOverrides).filter(([id]) => (
      CARRIER_SOURCE_LANE_IDS.has(id)
    )));
  carrierPerformance = performanceWithLaneValues(carrierPerformance, carrierOverrides);
  const laneValues = laneValuesFromPerformance(performance);
  const durationMs = dynamics.durationMs;
  const endMs = startMs + durationMs;
  const word = Object.freeze({
    type: "word",
    source: draft.wordSource,
    start: draft.sourceStart,
    end: draft.sourceEnd,
    phones: Object.freeze(draft.wordPhones.map(({ id, stress }) => Object.freeze({ id, stress }))),
  });
  return {
    ...draft,
    sequenceIndex,
    startMs,
    endMs,
    durationMs,
    start: startMs / 1_000,
    end: endMs / 1_000,
    duration: durationMs / 1_000,
    laneOverrides: sanitizeLaneOverrides(draft.laneOverrides),
    laneValues,
    lanes: laneValues,
    performance,
    carrierPerformance,
    dynamics,
    character: draft.wordSource,
    word,
    wordPhone: draft.phone,
    pair: null,
  };
}

function materializeBoundary(draft, startMs, sequenceIndex) {
  const durationMs = clamp(draft.durationMs, 0, MAX_SEGMENT_MS);
  const endMs = startMs + durationMs;
  return {
    ...draft,
    sequenceIndex,
    startMs,
    endMs,
    durationMs,
    start: startMs / 1_000,
    end: endMs / 1_000,
    duration: durationMs / 1_000,
  };
}

function segmentWithPhase(segment, durationMs) {
  return {
    ...segment,
    phaseStart: durationMs > 0 ? segment.startMs / durationMs : 0,
    phaseEnd: durationMs > 0 ? segment.endMs / durationMs : 1,
  };
}

function groupSegments(segments) {
  const wordGroups = new Map();
  for (const segment of segments) {
    if (segment.type !== "articulation") continue;
    if (!wordGroups.has(segment.wordId)) wordGroups.set(segment.wordId, []);
    wordGroups.get(segment.wordId).push(segment);
  }
  const words = [];
  const phones = [];
  for (const [wordId, articulations] of wordGroups) {
    const phoneGroups = new Map();
    for (const segment of articulations) {
      if (!phoneGroups.has(segment.phoneId)) phoneGroups.set(segment.phoneId, []);
      phoneGroups.get(segment.phoneId).push(segment);
    }
    const wordPhones = [];
    for (const [phoneId, phoneArticulations] of phoneGroups) {
      const first = phoneArticulations[0];
      const last = phoneArticulations.at(-1);
      const phone = {
        id: phoneId,
        type: "phone",
        phone: first.phone,
        label: first.phoneLabel,
        phoneLabel: first.phoneLabel,
        stress: first.stress,
        vowel: first.vowel,
        carrierVowel: first.activeCarrierVowel,
        wordId,
        wordIndex: first.wordIndex,
        phoneIndex: first.phoneIndex,
        startMs: first.startMs,
        endMs: last.endMs,
        durationMs: last.endMs - first.startMs,
        start: first.start,
        end: last.end,
        duration: last.end - first.start,
        sourceStart: first.sourceStart,
        sourceEnd: first.sourceEnd,
        articulations: Object.freeze([...phoneArticulations]),
        segments: Object.freeze([...phoneArticulations]),
      };
      phones.push(phone);
      wordPhones.push(phone);
    }
    const first = articulations[0];
    const last = articulations.at(-1);
    words.push({
      id: wordId,
      type: "word",
      label: first.wordSource,
      source: first.wordSource,
      sourceStart: first.sourceStart,
      sourceEnd: first.sourceEnd,
      wordIndex: first.wordIndex,
      startMs: first.startMs,
      endMs: last.endMs,
      durationMs: last.endMs - first.startMs,
      start: first.start,
      end: last.end,
      duration: last.end - first.start,
      phones: Object.freeze(wordPhones),
      articulations: Object.freeze([...articulations]),
      segments: Object.freeze([...articulations]),
    });
  }
  return { words, phones };
}

function surroundingLaneValue(segments, index, laneId, direction, fallback = null) {
  for (let cursor = index + direction; cursor >= 0 && cursor < segments.length; cursor += direction) {
    const value = segments[cursor].laneValues?.[laneId];
    if (Number.isFinite(value)) return clamp(value);
  }
  if (Number.isFinite(fallback)) return clamp(fallback);
  return laneId === "intensity" || laneId === "breath" ? 0 : 0.5;
}

function laneValueForSegment(segments, index, laneId, localPhase = 0) {
  const segment = segments[index];
  if (!segment) return 0;
  if (segment.type === "boundary") {
    if (laneId === "intensity" || laneId === "breath") return 0;
    const before = surroundingLaneValue(segments, index, laneId, -1);
    const after = surroundingLaneValue(segments, index, laneId, 1);
    return clamp(before + (after - before) * clamp(localPhase));
  }
  const value = clamp(segment.laneValues?.[laneId]);
  const next = surroundingLaneValue(segments, index, laneId, 1, value);
  const transition = clamp((localPhase - 0.66) / 0.34);
  let resolved = value + (next - value) * transition;
  if (laneId === "intensity") {
    const attack = clamp(localPhase / 0.08);
    const release = clamp((1 - localPhase) / 0.08);
    resolved *= Math.min(attack, release);
  }
  return clamp(resolved);
}

function segmentIndexAtTime(segments, timeMs) {
  if (!segments.length) return -1;
  for (let index = 0; index < segments.length; index += 1) {
    if (timeMs < segments[index].endMs || index === segments.length - 1) return index;
  }
  return segments.length - 1;
}

function buildAutomation(segments, durationMs, sampleCount) {
  const times = Array.from({ length: sampleCount }, (_, index) => (
    sampleCount <= 1 ? 0 : durationMs * index / (sampleCount - 1)
  ));
  const automation = {};
  for (const definition of PINK_TROMBONAZOID_LANES) {
    const points = segments.map((segment, index) => ({
      segmentId: segment.id,
      sequenceIndex: index,
      timeMs: segment.startMs,
      time: segment.start,
      phase: durationMs > 0 ? segment.startMs / durationMs : 0,
      value: laneValueForSegment(segments, index, definition.id, 0),
      editable: segment.type === "articulation",
    }));
    if (segments.length) {
      const lastIndex = segments.length - 1;
      points.push({
        segmentId: segments[lastIndex].id,
        sequenceIndex: lastIndex,
        timeMs: durationMs,
        time: durationMs / 1_000,
        phase: 1,
        value: laneValueForSegment(segments, lastIndex, definition.id, 1),
        editable: false,
      });
    }
    const samples = times.map((timeMs) => {
      const index = segmentIndexAtTime(segments, timeMs);
      if (index < 0) return 0;
      const segment = segments[index];
      const localPhase = segment.durationMs > 0
        ? clamp((timeMs - segment.startMs) / segment.durationMs)
        : 0;
      return laneValueForSegment(segments, index, definition.id, localPhase);
    });
    automation[definition.id] = {
      ...definition,
      sampleCount,
      samples: Object.freeze(samples),
      points: Object.freeze(points),
    };
  }
  return {
    sampleTimesMs: Object.freeze(times),
    sampleTimes: Object.freeze(times.map((timeMs) => timeMs / 1_000)),
    automation,
  };
}

function draftFromSegment(segment) {
  if (segment.type === "boundary") {
    return {
      id: segment.id,
      type: "boundary",
      source: segment.source,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      durationMs: segment.durationMs,
    };
  }
  return {
    id: segment.id,
    type: "articulation",
    wordId: segment.wordId,
    phoneId: segment.phoneId,
    wordIndex: segment.wordIndex,
    phoneIndex: segment.phoneIndex,
    articulationIndex: segment.articulationIndex,
    wordSource: segment.wordSource,
    wordPhones: (segment.word?.phones ?? [{ id: segment.phone, stress: segment.stress }])
      .map(({ id, stress }) => ({ id, stress })),
    sourceStart: segment.sourceStart,
    sourceEnd: segment.sourceEnd,
    phone: segment.phone,
    phoneLabel: segment.phoneLabel,
    stress: segment.stress,
    vowel: segment.vowel,
    sampleKey: segment.sampleKey,
    voicing: segment.voicing,
    articulation: segment.articulation,
    articulationLabel: segment.articulationLabel,
    soundLabel: segment.soundLabel,
    carrierVowel: segment.carrierVowel,
    activeCarrierVowel: segment.activeCarrierVowel,
    durationMs: segment.durationMs,
    personality: segment.personality,
    rhythmAmount: segment.rhythmAmount,
    intervalMs: segment.intervalMs,
    manner: segment.manner,
    sustain: Boolean(segment.sustain),
    wordSpeech: Boolean(segment.wordSpeech),
    laneOverrides: sanitizeLaneOverrides(segment.laneOverrides),
  };
}

function buildSequence(drafts, metadata) {
  let cursorMs = 0;
  const materialized = drafts.map((draft, index) => {
    const segment = draft.type === "boundary"
      ? materializeBoundary(draft, cursorMs, index)
      : materializeArticulation(draft, cursorMs, index);
    cursorMs = segment.endMs;
    return segment;
  });
  const durationMs = cursorMs;
  const segments = materialized.map((segment) => segmentWithPhase(segment, durationMs));
  const { words, phones } = groupSegments(segments);
  const automationData = buildAutomation(segments, durationMs, metadata.sampleCount);
  const sequence = {
    type: "pink-trombonazoid-sequence",
    source: metadata.source,
    text: metadata.source,
    preset: metadata.preset,
    personality: metadata.personality,
    speechRate: metadata.speechRate,
    rhythmAmount: metadata.rhythmAmount,
    intervalMs: metadata.intervalMs,
    durationMs,
    duration: durationMs / 1_000,
    sampleCount: metadata.sampleCount,
    tokens: cloneTokens(metadata.tokens),
    segments,
    articulationSegments: segments.filter(({ type }) => type === "articulation"),
    boundarySegments: segments.filter(({ type }) => type === "boundary"),
    words,
    wordSegments: words,
    phones,
    phoneSegments: phones,
    sampleTimesMs: automationData.sampleTimesMs,
    sampleTimes: automationData.sampleTimes,
    automation: automationData.automation,
    automationLanes: PINK_TROMBONAZOID_LANES.map(({ id }) => automationData.automation[id]),
  };
  return deepFreeze(sequence);
}

/**
 * Compile text, or an existing spellingPronunciationTokens() result, into an
 * immutable speech timeline. Times named `start`, `end`, and `duration` are in
 * seconds; the parallel `*Ms` properties are convenient for sequencer UIs.
 */
export function compilePinkTrombonazoid(value = null, options = {}) {
  let requested = value;
  let settings = options ?? {};
  if (value && !Array.isArray(value) && typeof value === "object") {
    settings = { ...value, ...options };
    requested = value.tokens ?? value.text ?? null;
  }
  const preset = presetFor(settings.preset);
  if (requested === null || requested === undefined) requested = preset.text;
  const source = Array.isArray(requested)
    ? String(settings.text ?? requested.map((token) => token?.source ?? "").join(""))
    : String(requested);
  const tokens = pronunciationTokens(requested, settings.pronunciations ?? new Map());
  const speechRate = clamp(
    settings.speechRate ?? (Number.isFinite(Number(settings.tempo))
      ? Number(settings.tempo) / 120
      : preset.speechRate),
    0.35,
    3,
  );
  const metadata = {
    source,
    preset: preset.id,
    personality: String(settings.personality ?? preset.personality ?? DEFAULT_PERSONALITY),
    speechRate,
    rhythmAmount: clamp(settings.rhythmAmount ?? 0.34),
    intervalMs: clamp(settings.intervalMs ?? DEFAULT_INTERVAL_MS, 45, 1_600),
    sampleCount: clampInteger(
      settings.sampleCount,
      MIN_SAMPLE_COUNT,
      MAX_SAMPLE_COUNT,
      DEFAULT_SAMPLE_COUNT,
    ),
    tokens,
  };
  return buildSequence(draftsFromTokens(tokens, metadata), metadata);
}

export const compilePinkTrombonazoidSequence = compilePinkTrombonazoid;

export function pinkTrombonazoidSequenceDuration(sequenceOrSegments) {
  if (Number.isFinite(Number(sequenceOrSegments?.durationMs))) {
    return Math.max(0, Number(sequenceOrSegments.durationMs));
  }
  const segments = Array.isArray(sequenceOrSegments)
    ? sequenceOrSegments
    : sequenceOrSegments?.segments;
  return Array.isArray(segments)
    ? segments.reduce((total, segment) => total + Math.max(0, finite(segment?.durationMs)), 0)
    : 0;
}

function metadataFromSequence(sequence) {
  return {
    source: String(sequence?.source ?? sequence?.text ?? ""),
    preset: String(sequence?.preset ?? DEFAULT_PINK_TROMBONAZOID_PRESET),
    personality: String(sequence?.personality ?? DEFAULT_PERSONALITY),
    speechRate: clamp(sequence?.speechRate ?? 1, 0.35, 3),
    rhythmAmount: clamp(sequence?.rhythmAmount ?? 0.34),
    intervalMs: clamp(sequence?.intervalMs ?? DEFAULT_INTERVAL_MS, 45, 1_600),
    sampleCount: clampInteger(
      sequence?.sampleCount,
      MIN_SAMPLE_COUNT,
      MAX_SAMPLE_COUNT,
      DEFAULT_SAMPLE_COUNT,
    ),
    tokens: pronunciationTokens(sequence?.tokens ?? [], new Map()),
  };
}

function patchedLaneOverrides(segment, patch) {
  const requested = {
    ...segment.laneOverrides,
    ...(patch?.laneOverrides ?? {}),
    ...(patch?.lanes ?? {}),
    ...(patch?.laneValues ?? {}),
    ...(patch?.values ?? {}),
    ...(patch?.automation ?? {}),
  };
  for (const { id } of PINK_TROMBONAZOID_LANES) {
    if (Object.hasOwn(patch ?? {}, id)) requested[id] = patch[id];
  }
  if (LANE_BY_ID.has(patch?.parameter) && Number.isFinite(Number(patch?.value))) {
    requested[patch.parameter] = patch.value;
  }
  if (LANE_BY_ID.has(patch?.lane) && Number.isFinite(Number(patch?.value))) {
    requested[patch.lane] = patch.value;
  }
  return sanitizeLaneOverrides(requested);
}

function resolvedPhone(sequence, idOrIndex) {
  if (!Array.isArray(sequence?.phones)) return null;
  if (typeof idOrIndex === "number") {
    return sequence.phones[Math.trunc(idOrIndex)] ?? null;
  }
  const requested = String(idOrIndex ?? "");
  const direct = sequence.phones.find(({ id }) => id === requested);
  if (direct) return direct;
  const segment = sequence.segments?.find(({ id }) => id === requested);
  return segment
    ? sequence.phones.find(({ id }) => id === segment.phoneId) ?? null
    : null;
}

function expressiveLaneOverrides(segments) {
  const overrides = {};
  for (const id of CARRIER_SOURCE_LANE_IDS) {
    let weightedValue = 0;
    let totalWeight = 0;
    for (const segment of segments) {
      const value = segment?.laneOverrides?.[id];
      if (!Number.isFinite(Number(value))) continue;
      const weight = Math.max(1, finite(segment.durationMs, 1));
      weightedValue += clamp(value) * weight;
      totalWeight += weight;
    }
    if (totalWeight) overrides[id] = weightedValue / totalWeight;
  }
  return sanitizeLaneOverrides(overrides);
}

function phoneEntries(sequence) {
  return (sequence?.phones ?? []).map((phone) => ({
    id: phone.phone,
    stress: phone.stress,
    origin: phone,
  }));
}

function wordPhoneCounts(tokens) {
  return tokens
    .filter(({ type }) => type === "word")
    .map(({ phones }) => phones.length);
}

function copyAuthoredPhoneDraft(draft, origin) {
  const previous = origin?.articulations?.[draft.articulationIndex];
  if (!previous) return draft;
  draft.durationMs = previous.durationMs;
  draft.laneOverrides = sanitizeLaneOverrides(previous.laneOverrides);
  draft.personality = previous.personality;
  draft.rhythmAmount = previous.rhythmAmount;
  draft.intervalMs = previous.intervalMs;
  draft.sustain = Boolean(previous.sustain);
  return draft;
}

function rebuildWithPhoneEntries(sequence, entries, counts) {
  const metadata = metadataFromSequence(sequence);
  const tokens = cloneTokens(metadata.tokens);
  const origins = new Map();
  let wordIndex = 0;
  let entryIndex = 0;
  for (const token of tokens) {
    if (token.type !== "word") continue;
    const count = Math.max(0, Math.trunc(counts[wordIndex] ?? token.phones.length));
    const assigned = entries.slice(entryIndex, entryIndex + count);
    token.phones = assigned.map(({ id, stress }, phoneIndex) => {
      origins.set(`${wordIndex}:${phoneIndex}`, assigned[phoneIndex].origin ?? null);
      return { id, stress };
    });
    entryIndex += assigned.length;
    wordIndex += 1;
  }
  if (entryIndex !== entries.length) return sequence;
  metadata.tokens = tokens;

  const previousBoundaries = new Map(
    sequence.boundarySegments.map((segment) => [segment.id, segment]),
  );
  const drafts = draftsFromTokens(tokens, metadata).map((draft) => {
    if (draft.type === "boundary") {
      const previous = previousBoundaries.get(draft.id);
      if (previous) draft.durationMs = previous.durationMs;
      return draft;
    }
    return copyAuthoredPhoneDraft(
      draft,
      origins.get(`${draft.wordIndex}:${draft.phoneIndex}`),
    );
  });
  return buildSequence(drafts, metadata);
}

/**
 * Replace one complete pronunciation phone and return a new frozen sequence.
 * A phone may contain more than one tract gesture (for example OW = ao → uw),
 * so this operation expands or collapses its segment group as one edit.
 */
export function replacePinkTrombonazoidPhone(sequence, idOrIndex, replacementId) {
  if (!sequence || !Array.isArray(sequence.segments)) return sequence;
  const target = resolvedPhone(sequence, idOrIndex);
  const replacement = String(replacementId ?? "").toUpperCase();
  const definition = spellingPhoneDefinition(replacement);
  if (!target || !definition?.gestures?.length || target.phone === replacement) return sequence;

  const metadata = metadataFromSequence(sequence);
  const tokens = cloneTokens(metadata.tokens);
  const wordToken = tokens.filter(({ type }) => type === "word")[target.wordIndex];
  const tokenPhone = wordToken?.phones?.[target.phoneIndex];
  if (!tokenPhone) return sequence;
  wordToken.phones[target.phoneIndex] = { ...tokenPhone, id: replacement };
  metadata.tokens = tokens;

  const previousById = new Map(sequence.segments.map((segment) => [segment.id, segment]));
  const previousTarget = target.articulations ?? target.segments ?? [];
  const targetDurationMs = previousTarget.reduce(
    (total, segment) => total + Math.max(0, finite(segment.durationMs)),
    0,
  );
  const targetOverrides = expressiveLaneOverrides(previousTarget);
  const targetPersonality = previousTarget[0]?.personality ?? metadata.personality;
  const targetRhythmAmount = previousTarget[0]?.rhythmAmount ?? metadata.rhythmAmount;
  const targetIntervalMs = previousTarget[0]?.intervalMs ?? metadata.intervalMs;
  const targetSustain = previousTarget.some(({ sustain }) => sustain);
  const weights = gestureWeights(definition.gestures.length, definition.vowel);

  const drafts = draftsFromTokens(tokens, metadata).map((draft) => {
    const previous = previousById.get(draft.id);
    if (draft.type === "boundary") {
      if (previous) draft.durationMs = previous.durationMs;
      return draft;
    }
    if (draft.phoneId === target.id) {
      draft.durationMs = targetDurationMs * weights[draft.articulationIndex];
      draft.laneOverrides = targetOverrides;
      draft.personality = targetPersonality;
      draft.rhythmAmount = targetRhythmAmount;
      draft.intervalMs = targetIntervalMs;
      draft.sustain = targetSustain;
      return draft;
    }
    if (!previous) return draft;
    draft.durationMs = previous.durationMs;
    draft.laneOverrides = sanitizeLaneOverrides(previous.laneOverrides);
    draft.personality = previous.personality;
    draft.rhythmAmount = previous.rhythmAmount;
    draft.intervalMs = previous.intervalMs;
    draft.sustain = Boolean(previous.sustain);
    return draft;
  });

  return buildSequence(drafts, metadata);
}

/** Remove one complete pronunciation phone and close the resulting time gap. */
export function removePinkTrombonazoidPhone(sequence, idOrIndex) {
  if (!sequence || !Array.isArray(sequence.segments)) return sequence;
  const target = resolvedPhone(sequence, idOrIndex);
  if (!target) return sequence;

  const metadata = metadataFromSequence(sequence);
  const tokens = cloneTokens(metadata.tokens);
  const wordToken = tokens.filter(({ type }) => type === "word")[target.wordIndex];
  if (!wordToken?.phones?.[target.phoneIndex]) return sequence;
  wordToken.phones.splice(target.phoneIndex, 1);
  metadata.tokens = tokens;

  const previousBoundaries = new Map(
    sequence.boundarySegments.map((segment) => [segment.id, segment]),
  );
  const previousArticulations = new Map(
    sequence.articulationSegments.map((segment) => [
      `${segment.wordIndex}:${segment.phoneIndex}:${segment.articulationIndex}`,
      segment,
    ]),
  );
  const drafts = draftsFromTokens(tokens, metadata).map((draft) => {
    if (draft.type === "boundary") {
      const previous = previousBoundaries.get(draft.id);
      if (previous) draft.durationMs = previous.durationMs;
      return draft;
    }
    const previousPhoneIndex = draft.wordIndex === target.wordIndex
      && draft.phoneIndex >= target.phoneIndex
      ? draft.phoneIndex + 1
      : draft.phoneIndex;
    const previous = previousArticulations.get(
      `${draft.wordIndex}:${previousPhoneIndex}:${draft.articulationIndex}`,
    );
    if (!previous) return draft;
    draft.durationMs = previous.durationMs;
    draft.laneOverrides = sanitizeLaneOverrides(previous.laneOverrides);
    draft.personality = previous.personality;
    draft.rhythmAmount = previous.rhythmAmount;
    draft.intervalMs = previous.intervalMs;
    draft.sustain = Boolean(previous.sustain);
    return draft;
  });

  return buildSequence(drafts, metadata);
}

/** Insert one pronunciation phone immediately before or after an existing phone. */
export function insertPinkTrombonazoidPhone(sequence, idOrIndex, insertedId, {
  position = "after",
} = {}) {
  if (!sequence || !Array.isArray(sequence.segments)) return sequence;
  const inserted = String(insertedId ?? "").toUpperCase();
  const definition = spellingPhoneDefinition(inserted);
  if (!definition?.gestures?.length) return sequence;

  const metadata = metadataFromSequence(sequence);
  const counts = wordPhoneCounts(metadata.tokens);
  if (!counts.length) return sequence;
  const entries = phoneEntries(sequence);
  const target = resolvedPhone(sequence, idOrIndex);
  let insertionIndex = 0;
  let wordIndex = counts.findIndex((count) => count > 0);
  if (target) {
    const targetIndex = sequence.phones.findIndex(({ id }) => id === target.id);
    insertionIndex = targetIndex + (position === "before" ? 0 : 1);
    wordIndex = target.wordIndex;
  } else {
    if (entries.length) return sequence;
    if (wordIndex < 0) wordIndex = 0;
  }
  entries.splice(insertionIndex, 0, {
    id: inserted,
    stress: definition.vowel ? 1 : 0,
    origin: null,
  });
  counts[wordIndex] += 1;
  return rebuildWithPhoneEntries(sequence, entries, counts);
}

/** Move one complete phone to a new index in pronunciation-timeline order. */
export function movePinkTrombonazoidPhone(sequence, idOrIndex, targetIndex) {
  if (!sequence || !Array.isArray(sequence.segments) || sequence.phones.length < 2) {
    return sequence;
  }
  const target = resolvedPhone(sequence, idOrIndex);
  if (!target) return sequence;
  const entries = phoneEntries(sequence);
  const sourceIndex = sequence.phones.findIndex(({ id }) => id === target.id);
  const destination = Math.round(clamp(targetIndex, 0, entries.length - 1));
  if (sourceIndex < 0 || sourceIndex === destination) return sequence;
  if (sequence.phones[destination]?.wordIndex !== target.wordIndex) return sequence;
  const [moved] = entries.splice(sourceIndex, 1);
  entries.splice(destination, 0, moved);
  const metadata = metadataFromSequence(sequence);
  return rebuildWithPhoneEntries(sequence, entries, wordPhoneCounts(metadata.tokens));
}

/** Return a new frozen sequence after editing one articulation or pause. */
export function updatePinkTrombonazoidSegment(sequence, idOrIndex, patch = {}) {
  if (!sequence || !Array.isArray(sequence.segments)) return sequence;
  patch = patch ?? {};
  const index = typeof idOrIndex === "number"
    ? Math.trunc(idOrIndex)
    : sequence.segments.findIndex(({ id }) => id === String(idOrIndex));
  if (index < 0 || index >= sequence.segments.length) return sequence;
  const drafts = sequence.segments.map(draftFromSegment);
  const previous = sequence.segments[index];
  const draft = drafts[index];
  const requestedDurationMs = Number.isFinite(Number(patch.durationMs))
    ? Number(patch.durationMs)
    : Number.isFinite(Number(patch.duration))
      ? Number(patch.duration) * 1_000
      : draft.durationMs;
  draft.durationMs = previous.type === "boundary"
    ? clamp(requestedDurationMs, 0, MAX_SEGMENT_MS)
    : clamp(requestedDurationMs, MIN_SEGMENT_MS, MAX_SEGMENT_MS);
  if (previous.type === "articulation") {
    draft.laneOverrides = patchedLaneOverrides(previous, patch);
    if (Number.isFinite(Number(patch.stress))) draft.stress = clamp(patch.stress, 0, 2);
    if (typeof patch.personality === "string" && patch.personality) {
      draft.personality = patch.personality;
    }
    if (typeof patch.articulation === "string" && patch.articulation) {
      draft.articulation = patch.articulation.toLowerCase();
      draft.articulationLabel = spellingSoundLabel(draft.articulation);
      draft.carrierVowel = isSpellingVowel(draft.articulation)
        ? draft.articulation
        : draft.carrierVowel;
    }
    if (isSpellingVowel(patch.carrierVowel)) {
      draft.activeCarrierVowel = String(patch.carrierVowel).toLowerCase();
      if (!isSpellingVowel(draft.articulation)) draft.carrierVowel = draft.activeCarrierVowel;
    }
    if (typeof patch.sustain === "boolean") draft.sustain = patch.sustain;
  }
  return buildSequence(drafts, metadataFromSequence(sequence));
}

/** Change the tract personality without discarding phone, timing, or lane edits. */
export function updatePinkTrombonazoidPersonality(sequence, personality) {
  if (!sequence || !Array.isArray(sequence.segments)) return sequence;
  const requested = String(personality ?? "").trim();
  if (!requested || requested === sequence.personality) return sequence;
  const drafts = sequence.segments.map((segment) => {
    const draft = draftFromSegment(segment);
    if (draft.type === "articulation") draft.personality = requested;
    return draft;
  });
  const metadata = metadataFromSequence(sequence);
  metadata.personality = requested;
  return buildSequence(drafts, metadata);
}

/**
 * Scale every articulation and pause together. A number is a target duration
 * in milliseconds; an object may specify { durationMs } or { scale }.
 */
export function retimePinkTrombonazoidSequence(sequence, request = {}) {
  if (!sequence || !Array.isArray(sequence.segments)) return sequence;
  const currentDuration = pinkTrombonazoidSequenceDuration(sequence);
  const settings = typeof request === "number" ? { durationMs: request } : request ?? {};
  let scale = Number(settings.scale);
  if (!Number.isFinite(scale) || scale <= 0) {
    const target = Number(settings.durationMs);
    scale = Number.isFinite(target) && target >= 0 && currentDuration > 0
      ? target / currentDuration
      : 1;
  }
  scale = clamp(scale, 0.1, 10);
  const drafts = sequence.segments.map((segment) => ({
    ...draftFromSegment(segment),
    durationMs: segment.durationMs * scale,
  }));
  return buildSequence(drafts, metadataFromSequence(sequence));
}

export function rescalePinkTrombonazoidSequence(sequence, scale = 1) {
  return retimePinkTrombonazoidSequence(sequence, { scale });
}

export function samplePinkTrombonazoidLfo(shape = "sine", phase = 0, seed = 0) {
  const requestedShape = LFO_SHAPES.has(shape) ? shape : "sine";
  const numericPhase = finite(phase);
  const cycle = ((numericPhase % 1) + 1) % 1;
  if (requestedShape === "triangle") return 1 - Math.abs(cycle - 0.5) * 4;
  if (requestedShape === "square") return cycle < 0.5 ? 1 : -1;
  if (requestedShape === "sample-hold") {
    const bucket = Math.floor(numericPhase);
    const random = Math.sin((bucket + finite(seed) + 1) * 12.9898) * 43_758.5453;
    return (random - Math.floor(random)) * 2 - 1;
  }
  return Math.sin(cycle * Math.PI * 2);
}

/** Apply normalized, bipolar LFO offsets to a normalized lane-value object. */
export function applyPinkTrombonazoidModulation(
  laneValues,
  modulators = [],
  elapsedSeconds = 0,
) {
  const source = laneValues?.laneValues ?? laneValues?.lanes ?? laneValues ?? {};
  const activeModulators = Array.isArray(modulators) ? modulators : [];
  const next = Object.fromEntries(PINK_TROMBONAZOID_LANES.map(({ id }) => (
    [id, clamp(source[id])]
  )));
  for (let index = 0; index < activeModulators.length; index += 1) {
    const modulator = activeModulators[index];
    const target = modulator?.target ?? modulator?.parameter;
    if (modulator?.enabled === false || !LANE_BY_ID.has(target)) continue;
    const rateHz = clamp(modulator?.rateHz ?? modulator?.rate ?? 1, 0, 40);
    const depth = clamp(modulator?.depth ?? 0.1);
    const phase = finite(elapsedSeconds) * rateHz + finite(modulator?.phase);
    const wave = samplePinkTrombonazoidLfo(
      modulator?.shape,
      phase,
      modulator?.seed ?? index,
    );
    next[target] = clamp(next[target] + wave * depth);
  }
  return Object.freeze(next);
}

/**
 * Convert a segment to the event contract consumed by Spelling Synthesizer's
 * Throatazoid audio engines. Optional modulators are evaluated without
 * changing the authored segment or sequence.
 */
export function pinkTrombonazoidAudioEvent(segment, {
  modulators = [],
  elapsedSeconds = 0,
  laneValues = null,
  voice = null,
} = {}) {
  if (!segment || segment.type !== "articulation" || !segment.performance) return null;
  const values = applyPinkTrombonazoidModulation(
    laneValues ?? segment.laneValues,
    modulators,
    elapsedSeconds,
  );
  const carrierBaseValues = laneValuesFromPerformance(segment.carrierPerformance);
  const carrierValues = Object.freeze(Object.fromEntries(
    PINK_TROMBONAZOID_LANES.map(({ id }) => [
      id,
      clamp(carrierBaseValues[id] + values[id] - segment.laneValues[id]),
    ]),
  ));
  const lanePerformance = performanceWithLaneValues(segment.performance, values);
  const laneCarrierPerformance = performanceWithLaneValues(
    segment.carrierPerformance,
    carrierValues,
  );
  const voiceSettings = voice ? normalizePinkTrombonazoidVoice(voice) : null;
  const performance = voiceSettings
    ? pinkTrombonazoidVoicePerformance(lanePerformance, voiceSettings)
    : lanePerformance;
  const carrierPerformance = voiceSettings
    ? pinkTrombonazoidVoicePerformance(laneCarrierPerformance, voiceSettings)
    : laneCarrierPerformance;
  return deepFreeze({
    character: segment.character,
    articulation: segment.articulation,
    carrierVowel: segment.carrierVowel,
    personality: segment.personality,
    performance,
    carrierPerformance,
    dynamics: { ...segment.dynamics },
    pair: segment.pair,
    soundLabel: segment.soundLabel,
    word: {
      type: "word",
      source: segment.wordSource,
      start: segment.sourceStart,
      end: segment.sourceEnd,
      phones: (segment.word?.phones ?? [{ id: segment.phone, stress: segment.stress }])
        .map(({ id, stress }) => ({ id, stress })),
    },
    wordPhone: segment.phone,
    wordSpeech: true,
    sampleKey: segment.sampleKey,
    sustain: Boolean(segment.sustain),
    laneValues: values,
    voiceSettings,
  });
}

export function samplePinkTrombonazoidAutomation(sequence, laneId, phase = 0) {
  const samples = sequence?.automation?.[laneId]?.samples;
  if (!Array.isArray(samples) || !samples.length) return 0;
  const position = clamp(phase) * (samples.length - 1);
  const left = Math.floor(position);
  const right = Math.min(samples.length - 1, left + 1);
  const mix = position - left;
  return clamp(samples[left] + (samples[right] - samples[left]) * mix);
}
