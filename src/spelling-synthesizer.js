import {
  ARTICULATIONS,
  CONSONANTS,
  MAX_NOSES,
  MAX_TONGUES,
  PHONEMES,
  clamp,
  keyboardArticulation,
  voicePresetState,
} from "./throatazoid.js";

const VOWELS = new Set(["a", "e", "i", "o", "u", "iy", "ao", "uw"]);

function spellingVowelGesture(name, position, height, lipDiameter = 3) {
  return Object.freeze({
    name,
    kind: "vowel",
    tongueCount: 1,
    noseCount: 1,
    oralClosure: 0,
    lipDiameter,
    tongues: Object.freeze([
      Object.freeze({ position, height, curl: 0.1 }),
    ]),
    noses: PHONEMES.a.noses,
  });
}

// Pink-Trombone-style coordinates retuned to common American-English phonics
// vowels. These are local to Spelling Synthesizer; Throatazoid keeps its own
// performance vowel set.
const SPELLING_VOWEL_GESTURES = Object.freeze({
  a: spellingVowelGesture("AE", 0.116, 0.497),
  e: spellingVowelGesture("EH", 0.371, 0.048),
  i: spellingVowelGesture("IH", 0.755, 0.434),
  o: spellingVowelGesture("AA", 0.006, 0.83),
  u: spellingVowelGesture("AH", 0.28, 0.717),
  iy: spellingVowelGesture("IY", 0.817, 0.897),
  ao: spellingVowelGesture("AO", 0.274, 1, 0.95),
  uw: spellingVowelGesture("UW", 0.566, 1, 0.62),
});

export const SPELLING_ENGINES = Object.freeze({
  tube: Object.freeze({
    name: "Bellazoid tract",
    shortName: "Bellazoid",
    lineage: "Daisy Bell lineage · 44-section tract",
    description: "A living 44-section vocal tract in the Kelly–Lochbaum tradition, shaped for Morphazoid.",
    color: "#d8ff57",
  }),
  diphone: Object.freeze({
    name: "KAL phone samples",
    shortName: "Samples",
    lineage: "CMU Flite KAL16 · phone and pair atlas",
    description: "Long vowel bodies and compact consonant and joined-pair units rendered from Flite's KAL16 diphone voice.",
    color: "#79dcff",
  }),
  vocoder: Object.freeze({
    name: "Voxazoid vocoder",
    shortName: "Voxazoid",
    lineage: "KAL16 modulator · twenty speech bands",
    description: "A speech-preserving channel vocoder follows the KAL phone spectrum with normalized pulse and noise carriers.",
    color: "#ffcb69",
  }),
});

export const SPELLING_PERSONALITIES = Object.freeze({
  clear: Object.freeze({
    name: "Clear",
    preset: "clear",
    note: "plain and centered",
    hue: 82,
    pitchScale: 1,
    breathOffset: 0,
    tensionOffset: 0,
    spectralScale: 1,
  }),
  warm: Object.freeze({
    name: "Velvet",
    preset: "warm",
    note: "low and rounded",
    hue: 28,
    pitchScale: 0.88,
    breathOffset: 0.05,
    tensionOffset: -0.08,
    spectralScale: 0.9,
  }),
  whisper: Object.freeze({
    name: "Whisper",
    preset: "whisper",
    note: "air-heavy and soft",
    hue: 188,
    pitchScale: 1.06,
    breathOffset: 0.22,
    tensionOffset: -0.18,
    spectralScale: 1.04,
  }),
  reed: Object.freeze({
    name: "Reed",
    preset: "reed",
    note: "pinched and electric",
    hue: 286,
    pitchScale: 1.12,
    breathOffset: -0.04,
    tensionOffset: 0.16,
    spectralScale: 1.08,
  }),
  creature: Object.freeze({
    name: "Creature",
    preset: "alien",
    note: "low and uncanny",
    hue: 330,
    pitchScale: 0.78,
    breathOffset: 0.08,
    tensionOffset: 0.04,
    spectralScale: 0.82,
  }),
});

export const SPELLING_DIPHTHONGS = Object.freeze({
  ai: Object.freeze({ from: "e", to: "iy", label: "EY /eɪ/" }),
  ay: Object.freeze({ from: "e", to: "iy", label: "EY /eɪ/" }),
  au: Object.freeze({ from: "ao", to: "ao", label: "AO /ɔ/" }),
  aw: Object.freeze({ from: "ao", to: "ao", label: "AO /ɔ/" }),
  ei: Object.freeze({ from: "e", to: "iy", label: "EY /eɪ/" }),
  ey: Object.freeze({ from: "e", to: "iy", label: "EY /eɪ/" }),
  oi: Object.freeze({ from: "ao", to: "iy", label: "OY /ɔɪ/" }),
  oy: Object.freeze({ from: "ao", to: "iy", label: "OY /ɔɪ/" }),
  ou: Object.freeze({ from: "o", to: "uw", label: "AW /aʊ/" }),
  ow: Object.freeze({ from: "o", to: "uw", label: "AW /aʊ/" }),
});

function definePair(kind, label, sounds) {
  return Object.freeze({
    kind,
    label,
    sounds: Object.freeze(sounds.map((sound) => Object.freeze({ ...sound }))),
  });
}

export const SPELLING_PAIRS = Object.freeze({
  th: definePair("digraph", "TH", [
    { articulation: "th", label: "TH" },
  ]),
  sh: definePair("digraph", "SH", [{ articulation: "sh", label: "SH" }]),
  ch: definePair("digraph", "CH", [{ articulation: "c", label: "CH" }]),
  ph: definePair("digraph", "F", [{ articulation: "f", label: "F" }]),
  ng: definePair("digraph", "NG", [{ articulation: "ng", label: "NG" }]),
  ck: definePair("digraph", "K", [{ articulation: "k", label: "K" }]),
  qu: definePair("digraph", "KW", [
    { articulation: "k", label: "K" },
    { articulation: "w", label: "W" },
  ]),
  wh: definePair("digraph", "WH", [{ articulation: "w", label: "WH" }]),
  ai: definePair("vowel pair", "EY /eɪ/", [
    { articulation: "e", label: "EH" },
    { articulation: "iy", label: "IY" },
  ]),
  ay: definePair("vowel pair", "EY /eɪ/", [
    { articulation: "e", label: "EH" },
    { articulation: "iy", label: "IY" },
  ]),
  au: definePair("vowel pair", "AO /ɔ/", [{ articulation: "ao", label: "AO" }]),
  aw: definePair("vowel pair", "AO /ɔ/", [{ articulation: "ao", label: "AO" }]),
  ei: definePair("vowel pair", "EY /eɪ/", [
    { articulation: "e", label: "EH" },
    { articulation: "iy", label: "IY" },
  ]),
  ey: definePair("vowel pair", "EY /eɪ/", [
    { articulation: "e", label: "EH" },
    { articulation: "iy", label: "IY" },
  ]),
  oi: definePair("vowel pair", "OY /ɔɪ/", [
    { articulation: "ao", label: "AO" },
    { articulation: "iy", label: "IY" },
  ]),
  oy: definePair("vowel pair", "OY /ɔɪ/", [
    { articulation: "ao", label: "AO" },
    { articulation: "iy", label: "IY" },
  ]),
  ou: definePair("vowel pair", "AW /aʊ/", [
    { articulation: "o", label: "AA" },
    { articulation: "uw", label: "UW" },
  ]),
  ow: definePair("vowel pair", "AW /aʊ/", [
    { articulation: "o", label: "AA" },
    { articulation: "uw", label: "UW" },
  ]),
  ee: definePair("vowel pair", "IY /i/", [{ articulation: "iy", label: "IY" }]),
  ea: definePair("vowel pair", "IY /i/", [{ articulation: "iy", label: "IY" }]),
  oo: definePair("vowel pair", "UW /u/", [{ articulation: "uw", label: "UW" }]),
  oa: definePair("vowel pair", "OW /oʊ/", [
    { articulation: "ao", label: "AO" },
    { articulation: "uw", label: "UW" },
  ]),
});

const SPELLING_PAIR_PREFIXES = new Set(
  Object.keys(SPELLING_PAIRS).map((pair) => pair[0]),
);
SPELLING_PAIR_PREFIXES.add("g");

const VOWEL_LABELS = Object.freeze({
  a: "AE",
  e: "EH",
  i: "IH",
  o: "AA",
  u: "AH",
  iy: "IY",
  ao: "AO",
  uw: "UW",
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneVoiceState(source) {
  return {
    ...source,
    throats: source.throats.map((throat) => ({ ...throat })),
    tongues: source.tongues.map((tongue) => ({ ...tongue })),
    noses: source.noses.map((nose) => ({ ...nose })),
    pressureSources: source.pressureSources.map((pressure) => ({ ...pressure })),
    voiceIntervals: [...source.voiceIntervals],
    voiceDetunes: [...source.voiceDetunes],
  };
}

function applyGesture(target, articulation, carrierVowel) {
  const key = String(articulation ?? "").toLowerCase();
  const consonant = CONSONANTS[key];
  const spellingVowel = SPELLING_VOWEL_GESTURES[key];
  const gesture = consonant?.gesture ?? spellingVowel ?? ARTICULATIONS[key];
  if (!gesture) return target;

  const isVowel = !consonant && gesture.kind === "vowel";
  const carrierColored = key === "h";
  target.phoneme = key;
  if (!carrierColored) {
    target.tongueCount = Math.round(clamp(gesture.tongueCount, 1, MAX_TONGUES));
    target.noseCount = Math.round(clamp(gesture.noseCount, 1, MAX_NOSES));
  }
  target.oralClosure = carrierColored
    ? 0
    : clamp(consonant?.oralClosure ?? gesture.oralClosure);
  target.articulationPlace = consonant?.constrictionPosition
    ?? gesture.tongues?.[0]?.position
    ?? target.articulationPlace;
  target.articulationAperture = consonant
    ? consonant.id === "glottal"
      ? 1
      : consonant.constrictionDiameter <= 0
        ? 0
        : clamp((consonant.constrictionDiameter + 0.035) / 1.38)
    : 1;
  target.articulationVoicing = consonant
    ? consonant.voiced ? 0.92 : 0.04
    : target.articulationVoicing;
  target.glottalClosure = consonant?.glottalClosure ?? 0;
  target.nasalCoupling = consonant?.nasalCoupling ?? target.nasalCoupling;
  target.articulationManner = consonant?.manner ?? "vowel";
  target.lipDiameter = isVowel
    ? gesture.lipDiameter ?? target.lipDiameter
    : consonant?.lipDiameter
      ?? SPELLING_VOWEL_GESTURES[carrierVowel]?.lipDiameter
      ?? PHONEMES[carrierVowel]?.lipDiameter
      ?? target.lipDiameter;
  if (!carrierColored) {
    target.tongues = Array.from({ length: MAX_TONGUES }, (_, index) => ({
      ...target.tongues[index],
      ...(gesture.tongues?.[index] ?? {}),
    }));
    target.noses = Array.from({ length: MAX_NOSES }, (_, index) => ({
      ...target.noses[index],
      ...(gesture.noses?.[index] ?? {}),
    }));
  }
  return target;
}

export function spellingEngine(name = "diphone") {
  return SPELLING_ENGINES[name] ? name : "diphone";
}

export function spellingPersonality(name = "clear") {
  return SPELLING_PERSONALITIES[name] ? name : "clear";
}

export function spellingArticulation(character) {
  if (typeof character !== "string" || character.length !== 1) return "";
  if (character.toLowerCase() === "c") return "k";
  return keyboardArticulation(character);
}

export function spellingContextualArticulation(character, nextCharacter = "") {
  const letter = String(character ?? "").toLowerCase();
  const next = String(nextCharacter ?? "").toLowerCase();
  if (letter === "c") return /[eiy]/.test(next) ? "s" : "k";
  if (letter === "g") return /[eiy]/.test(next) ? "j" : "g";
  return spellingArticulation(character);
}

export function spellingSoundLabel(articulation) {
  const key = String(articulation ?? "").toLowerCase();
  if (key === "x") return "KS";
  if (VOWEL_LABELS[key]) return VOWEL_LABELS[key];
  return CONSONANTS[key]?.symbol ?? key.toUpperCase();
}

export function isSpellingVowel(value) {
  return VOWELS.has(String(value ?? "").toLowerCase());
}

export function spellingDiphthong(previousCharacter, character) {
  const pair = `${String(previousCharacter ?? "").toLowerCase()}${String(character ?? "").toLowerCase()}`;
  return SPELLING_DIPHTHONGS[pair] ?? null;
}

export function spellingPair(previousCharacter, character) {
  const pair = `${String(previousCharacter ?? "").toLowerCase()}${String(character ?? "").toLowerCase()}`;
  return SPELLING_PAIRS[pair] ?? null;
}

export function isSpellingPairPrefix(character) {
  return SPELLING_PAIR_PREFIXES.has(String(character ?? "").toLowerCase());
}

export function spellingTokens(value, { joinPairs = true } = {}) {
  const source = String(value ?? "");
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (/\s|[.!?,;:]/.test(character)) {
      tokens.push({ type: "boundary", source: character, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    const articulation = joinPairs
      ? spellingContextualArticulation(character, source[index + 1])
      : spellingArticulation(character);
    if (!articulation) {
      index += 1;
      continue;
    }
    const pair = joinPairs ? spellingPair(character, source[index + 1]) : null;
    if (pair) {
      tokens.push({
        type: "sound",
        source: source.slice(index, index + 2),
        start: index,
        end: index + 2,
        ...pair,
      });
      index += 2;
      continue;
    }
    tokens.push({
      type: "sound",
      source: character,
      start: index,
      end: index + 1,
      kind: "letter",
      label: spellingSoundLabel(articulation),
      sounds: [{ articulation, label: spellingSoundLabel(articulation) }],
    });
    index += 1;
  }
  return tokens;
}

export function typingDynamics({
  intervalMs = 320,
  averageIntervalMs = intervalMs,
  amount = 0.72,
  capital = false,
} = {}) {
  const interval = clamp(finite(intervalMs, 320), 45, 1_600);
  const average = clamp(finite(averageIntervalMs, interval), 70, 1_200);
  const influence = clamp(finite(amount, 0.72));
  const pace = clamp((640 - interval) / 570);
  const surprise = clamp(Math.abs(interval - average) / Math.max(120, average));
  const afterPause = clamp((interval - 520) / 720);
  const capitalAccent = capital ? 0.28 : 0;
  const emphasis = clamp(
    0.24
      + influence * (pace * 0.42 + surprise * 0.28 + afterPause * 0.32)
      + capitalAccent,
  );
  const pitchCents = influence * (
    -5 + pace * 18 + surprise * 11 + afterPause * 8
  ) + (capital ? 24 : 0);
  const durationMs = clamp(
    118 + (1 - pace) * 238 + emphasis * 52,
    95,
    520,
  );

  return Object.freeze({
    intervalMs: interval,
    pace,
    surprise,
    afterPause,
    emphasis,
    pitchCents,
    pitchRatio: 2 ** (pitchCents / 1_200),
    velocity: clamp(0.48 + emphasis * 0.48),
    breathAccent: influence * (surprise * 0.12 + pace * 0.045),
    durationMs,
    attackMs: clamp(34 - pace * 20 - emphasis * 7, 5, 40),
    releaseMs: clamp(42 + (1 - pace) * 74, 24, 150),
  });
}

export function spellingPerformanceState({
  personality = "clear",
  articulation = "a",
  carrierVowel = "a",
  dynamics = {},
} = {}) {
  const personalityKey = spellingPersonality(personality);
  const profile = SPELLING_PERSONALITIES[personalityKey];
  const carrier = isSpellingVowel(carrierVowel) ? carrierVowel.toLowerCase() : "a";
  const requested = String(articulation ?? "").toLowerCase();
  // Callers pass resolved internal phones here. Preserve CH's internal `c`
  // articulation; literal typed C is resolved to K/S before this boundary.
  const key = SPELLING_VOWEL_GESTURES[requested] || ARTICULATIONS[requested]
    ? requested
    : spellingArticulation(articulation);
  const base = cloneVoiceState(voicePresetState(profile.preset));

  applyGesture(base, carrier, carrier);
  applyGesture(base, key || carrier, carrier);

  const pitchRatio = clamp(finite(dynamics.pitchRatio, 1), 0.5, 2);
  const breathAccent = clamp(finite(dynamics.breathAccent));
  const emphasis = clamp(finite(dynamics.emphasis, 0.4));
  base.exciterPitch = clamp(
    base.exciterPitch * profile.pitchScale * pitchRatio,
    40,
    520,
  );
  base.exciterBreath = clamp(base.exciterBreath + profile.breathOffset + breathAccent);
  base.exciterTenseness = clamp(base.exciterTenseness + profile.tensionOffset + emphasis * 0.035);
  base.exciterIntensity = clamp(base.exciterIntensity * (0.72 + emphasis * 0.42));
  base.mutation = clamp(base.mutation + emphasis * (personalityKey === "creature" ? 0.16 : 0.035));
  base.spellingPersonality = personalityKey;
  base.spellingSpectralScale = profile.spectralScale;
  return base;
}

export function previousTypedLetter(text, caret = String(text ?? "").length) {
  const source = String(text ?? "").slice(0, Math.max(0, finite(caret, 0)));
  return source.match(/[a-z]$/i)?.[0]?.toLowerCase() ?? "";
}

export function insertedText(previousValue, nextValue) {
  const previous = String(previousValue ?? "");
  const next = String(nextValue ?? "");
  let prefix = 0;
  while (
    prefix < previous.length
    && prefix < next.length
    && previous[prefix] === next[prefix]
  ) prefix += 1;
  let previousSuffix = previous.length;
  let nextSuffix = next.length;
  while (
    previousSuffix > prefix
    && nextSuffix > prefix
    && previous[previousSuffix - 1] === next[nextSuffix - 1]
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }
  return next.slice(prefix, nextSuffix);
}

export function spellingTextEdit(previousValue, nextValue) {
  const previous = String(previousValue ?? "");
  const next = String(nextValue ?? "");
  let start = 0;
  while (
    start < previous.length
    && start < next.length
    && previous[start] === next[start]
  ) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start
    && nextEnd > start
    && previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return Object.freeze({
    start,
    removed: previous.slice(start, previousEnd),
    inserted: next.slice(start, nextEnd),
  });
}

export function remapSpellingOffset(offset, edit) {
  const start = Math.max(0, finite(edit?.start, 0));
  const removedLength = String(edit?.removed ?? "").length;
  const insertedLength = String(edit?.inserted ?? "").length;
  const oldEnd = start + removedLength;
  const cursor = Math.max(0, finite(offset, 0));
  if (start > cursor) return cursor;
  if (oldEnd <= cursor) return Math.max(0, cursor + insertedLength - removedLength);
  return start + insertedLength;
}
