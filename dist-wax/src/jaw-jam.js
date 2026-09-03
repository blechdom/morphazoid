import {
  JAW_HARP_LIMITS,
  JAW_HARP_PRESETS,
  JAW_HARP_STYLE_CUSTOM_ID,
  VOWEL_PRESETS,
  applyVowel,
  jawHarpState,
  sanitizeJawHarpState,
  vowelPreset,
} from "./jaw-harp.js";

const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

const freezeRange = (minimum, maximum) => Object.freeze([minimum, maximum]);

export const JAW_JAM_ACTIONS = Object.freeze(["pluck", "sustain", "rest"]);
export const JAW_JAM_BREATH_RATIOS = Object.freeze([1 / 3, 1 / 2, 1, 2, 3]);

// Integer MIDI notes 27–53 resolve to 38.89–174.61 Hz. Those are the complete
// equal-tempered notes that fit inside the Jaw Harp model's physical 38–180 Hz
// reed range.
export const JAW_JAM_LIMITS = Object.freeze({
  stepCount: freezeRange(1, 32),
  tempo: freezeRange(36, 480),
  swing: freezeRange(-0.42, 0.42),
  midi: freezeRange(27, 53),
  reedFrequencyHz: freezeRange(...JAW_HARP_LIMITS.reedFrequencyHz),
  pluckIntensity: freezeRange(0, 1),
  breathPower: freezeRange(...JAW_HARP_LIMITS.breathDepth),
  breathRateMultiplier: freezeRange(0.125, 8),
  breathRateBpm: freezeRange(...JAW_HARP_LIMITS.breathRateBpm),
  pulseEnergy: freezeRange(0, 1),
});

const VOWEL_IDS = new Set(VOWEL_PRESETS.map(({ id }) => id));
const MATERIAL_IDS = new Set(JAW_HARP_PRESETS.map(({ id }) => id));
const MOUTH_ARTICULATION_KEYS = Object.freeze([
  "tonguePosition",
  "tongueHeight",
  "jawOpening",
  "lipRounding",
]);
const PROFILE_SETTING_KEYS = Object.freeze([
  ...MOUTH_ARTICULATION_KEYS,
  "glottisOpening",
  "cavityCoupling",
  "formantFocus",
  "dryResonance",
  "breathBalance",
]);

// Eight deliberately serious mouth profiles are crossed with every one of the
// five existing physical bodies. The resulting forty sound presets remain
// explicit, deterministic combinations: the material chooses the tine/frame,
// while the profile chooses the resonating mouth and its initial vowel.
const ARTICULATION_PROFILES = Object.freeze([
  Object.freeze({
    id: "open-a",
    label: "Open A fundamental",
    vowelId: "a",
    description: "A broad jaw and relaxed throat favor the fundamental and low ladder.",
    settings: Object.freeze({
      tonguePosition: 0.34, tongueHeight: 0.08, jawOpening: 1.08, lipRounding: -0.08,
      glottisOpening: 0.54, cavityCoupling: 1.18, formantFocus: 0.16,
      dryResonance: 0.24, breathBalance: 0.47,
    }),
  }),
  Object.freeze({
    id: "bright-e",
    label: "Bright E ladder",
    vowelId: "e",
    description: "A forward tongue and compact jaw expose a clear upper harmonic ladder.",
    settings: Object.freeze({
      tonguePosition: 0.86, tongueHeight: 0.66, jawOpening: 0.3, lipRounding: -0.1,
      glottisOpening: 0.28, cavityCoupling: 0.72, formantFocus: 1.46,
      dryResonance: 0.16, breathBalance: 0.42,
    }),
  }),
  Object.freeze({
    id: "needle-i",
    label: "Needle I focus",
    vowelId: "i",
    description: "A narrow front cavity picks a precise high overtone from the ringing tine.",
    settings: Object.freeze({
      tonguePosition: 1.16, tongueHeight: 1.04, jawOpening: 0.06, lipRounding: -0.18,
      glottisOpening: 0.16, cavityCoupling: 0.56, formantFocus: 2.08,
      dryResonance: 0.1, breathBalance: 0.38,
    }),
  }),
  Object.freeze({
    id: "rounded-o",
    label: "Rounded O chamber",
    vowelId: "o",
    description: "Projected lips and a round cavity produce a centered, vocal bell.",
    settings: Object.freeze({
      tonguePosition: 0.18, tongueHeight: 0.4, jawOpening: 0.54, lipRounding: 1.04,
      glottisOpening: 0.38, cavityCoupling: 1.12, formantFocus: 0.62,
      dryResonance: 0.26, breathBalance: 0.55,
    }),
  }),
  Object.freeze({
    id: "deep-u",
    label: "Deep U tube",
    vowelId: "u",
    description: "A long lip tube and raised rear tongue darken the resonant response.",
    settings: Object.freeze({
      tonguePosition: -0.08, tongueHeight: 0.94, jawOpening: 0.08, lipRounding: 1.28,
      glottisOpening: 0.22, cavityCoupling: 1.3, formantFocus: -0.14,
      dryResonance: 0.3, breathBalance: 0.58,
    }),
  }),
  Object.freeze({
    id: "throat-a",
    label: "Low throat A",
    vowelId: "a",
    description: "A deep tongue root and nearly closed glottis emphasize subharmonic weight.",
    settings: Object.freeze({
      tonguePosition: -0.5, tongueHeight: -0.22, jawOpening: 1.22, lipRounding: 0.02,
      glottisOpening: 0.05, cavityCoupling: 1.52, formantFocus: -0.56,
      dryResonance: 0.36, breathBalance: 0.5,
    }),
  }),
  Object.freeze({
    id: "overtone-e",
    label: "Overtone E beam",
    vowelId: "e",
    description: "A small aperture and strong focus isolate a singing harmonic beam.",
    settings: Object.freeze({
      tonguePosition: 1.02, tongueHeight: 0.78, jawOpening: 0.18, lipRounding: -0.04,
      glottisOpening: 0.44, cavityCoupling: 0.9, formantFocus: 2.34,
      dryResonance: 0.12, breathBalance: 0.46,
    }),
  }),
  Object.freeze({
    id: "air-o",
    label: "Air O halo",
    vowelId: "o",
    description: "An open glottis and loose rounded chamber let breath orbit the tine.",
    settings: Object.freeze({
      tonguePosition: 0.08, tongueHeight: 0.24, jawOpening: 0.72, lipRounding: 0.9,
      glottisOpening: 1.3, cavityCoupling: 0.66, formantFocus: 1.04,
      dryResonance: 0.42, breathBalance: 0.52,
    }),
  }),
]);

function sanitizedProfileSettings(materialId, profile) {
  const materialState = jawHarpState(materialId);
  const candidate = sanitizeJawHarpState({
    ...materialState,
    ...profile.settings,
    vowelId: profile.vowelId,
  }, materialState);
  return Object.freeze(Object.fromEntries(
    PROFILE_SETTING_KEYS.map((key) => [key, candidate[key]]),
  ));
}

export const JAW_JAM_SOUND_PRESETS = Object.freeze(JAW_HARP_PRESETS.flatMap((material) => (
  ARTICULATION_PROFILES.map((profile) => Object.freeze({
    id: `${material.id}-${profile.id}`,
    label: `${material.label} · ${profile.label}`,
    description: `${material.family}; ${profile.description}`,
    materialId: material.id,
    presetId: material.id,
    materialFamily: material.family,
    profileId: profile.id,
    initialVowelId: profile.vowelId,
    vowelId: profile.vowelId,
    settings: sanitizedProfileSettings(material.id, profile),
  }))
)));

const SOUND_PRESET_IDS = new Set(JAW_JAM_SOUND_PRESETS.map(({ id }) => id));
const DEFAULT_SOUND_PRESET_ID = "khomus-open-a";
const DEFAULT_STEP = Object.freeze({
  action: "pluck",
  midi: 38,
  vowelId: "a",
  soundPresetId: DEFAULT_SOUND_PRESET_ID,
  pluckIntensity: 0.78,
  breathPower: 0.82,
  breathRateMultiplier: 1,
});

export const JAW_JAM_DEFAULTS = Object.freeze({
  patternId: "appalachian-drive",
  stepCount: 16,
  tempo: 118,
  swing: 0.08,
  breathRatio: 1,
  ...DEFAULT_STEP,
  step: DEFAULT_STEP,
});

function sanitizedAction(value, fallback = DEFAULT_STEP.action) {
  return JAW_JAM_ACTIONS.includes(value) ? value : fallback;
}

function sanitizedVowelId(value, fallback = DEFAULT_STEP.vowelId) {
  return VOWEL_IDS.has(value) ? value : (VOWEL_IDS.has(fallback) ? fallback : "a");
}

function sanitizedSoundPresetId(value, fallback = DEFAULT_STEP.soundPresetId) {
  return SOUND_PRESET_IDS.has(value)
    ? value
    : (SOUND_PRESET_IDS.has(fallback) ? fallback : DEFAULT_SOUND_PRESET_ID);
}

function sanitizedBreathRatio(value, fallback = JAW_JAM_DEFAULTS.breathRatio) {
  const requested = finiteOr(value, fallback);
  let closest = JAW_JAM_BREATH_RATIOS[0];
  let distance = Infinity;
  for (const ratio of JAW_JAM_BREATH_RATIOS) {
    const nextDistance = Math.abs(requested - ratio);
    if (nextDistance < distance) {
      closest = ratio;
      distance = nextDistance;
    }
  }
  return closest;
}

export function jawJamSoundPreset(id) {
  return JAW_JAM_SOUND_PRESETS.find((preset) => preset.id === id)
    ?? JAW_JAM_SOUND_PRESETS[0];
}

export function sanitizeJawJamStep(source = {}, fallback = DEFAULT_STEP) {
  const candidate = source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};
  const base = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : DEFAULT_STEP;
  const action = sanitizedAction(candidate.action, sanitizedAction(base.action));
  const midi = Math.round(clamp(
    candidate.midi ?? candidate.pitchMidi,
    ...JAW_JAM_LIMITS.midi,
  ));
  return Object.freeze({
    action,
    midi: Number.isFinite(Number(candidate.midi ?? candidate.pitchMidi))
      ? midi
      : Math.round(clamp(base.midi, ...JAW_JAM_LIMITS.midi)),
    vowelId: sanitizedVowelId(candidate.vowelId, base.vowelId),
    soundPresetId: sanitizedSoundPresetId(
      candidate.soundPresetId ?? candidate.comboId,
      base.soundPresetId,
    ),
    pluckIntensity: clamp(
      candidate.pluckIntensity ?? candidate.intensity ?? base.pluckIntensity,
      ...JAW_JAM_LIMITS.pluckIntensity,
    ),
    breathPower: clamp(
      candidate.breathPower ?? base.breathPower,
      ...JAW_JAM_LIMITS.breathPower,
    ),
    breathRateMultiplier: clamp(
      candidate.breathRateMultiplier ?? candidate.breathMultiplier
        ?? base.breathRateMultiplier,
      ...JAW_JAM_LIMITS.breathRateMultiplier,
    ),
  });
}

function inferredStepCount(source, fallback) {
  if (Number.isFinite(Number(source?.stepCount))) return Number(source.stepCount);
  if (Array.isArray(source?.steps) && source.steps.length) return source.steps.length;
  if (Number.isFinite(Number(fallback?.stepCount))) return Number(fallback.stepCount);
  if (Array.isArray(fallback?.steps) && fallback.steps.length) return fallback.steps.length;
  return JAW_JAM_DEFAULTS.stepCount;
}

function patternText(value, fallback) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || fallback;
}

export function sanitizeJawJamPattern(source = {}, fallback = JAW_JAM_DEFAULTS) {
  const candidate = source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};
  const base = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : JAW_JAM_DEFAULTS;
  const stepCount = Math.round(clamp(
    inferredStepCount(candidate, base),
    ...JAW_JAM_LIMITS.stepCount,
  ));
  const sourceSteps = Array.isArray(candidate.steps) ? candidate.steps : [];
  const fallbackSteps = Array.isArray(base.steps) ? base.steps : [];
  const steps = Object.freeze(Array.from({ length: stepCount }, (_, index) => (
    sanitizeJawJamStep(
      sourceSteps[index],
      fallbackSteps[index] ?? base.step ?? DEFAULT_STEP,
    )
  )));
  const id = patternText(candidate.id, patternText(base.id, "custom"));
  const label = patternText(candidate.label, patternText(base.label, "Custom performance"));
  const description = patternText(
    candidate.description,
    patternText(base.description, "A monophonic Jaw Jam performance."),
  );
  return Object.freeze({
    id,
    label,
    description,
    stepCount,
    tempo: clamp(candidate.tempo ?? base.tempo, ...JAW_JAM_LIMITS.tempo),
    swing: clamp(candidate.swing ?? base.swing, ...JAW_JAM_LIMITS.swing),
    breathRatio: sanitizedBreathRatio(
      candidate.breathRatio,
      sanitizedBreathRatio(base.breathRatio),
    ),
    steps,
  });
}

const comboId = (materialId, profileId) => `${materialId}-${profileId}`;
const authoredStep = (
  action,
  midi,
  soundPresetId,
  vowelId,
  pluckIntensity,
  breathPower,
  breathRateMultiplier = 1,
) => sanitizeJawJamStep({
  action,
  midi,
  soundPresetId,
  vowelId,
  pluckIntensity,
  breathPower,
  breathRateMultiplier,
});
const pluck = (...values) => authoredStep("pluck", ...values);
const sustain = (...values) => authoredStep("sustain", ...values);
const rest = (midi = DEFAULT_STEP.midi) => authoredStep(
  "rest",
  midi,
  DEFAULT_SOUND_PRESET_ID,
  "a",
  0,
  0,
  1,
);

const authoredPattern = (pattern) => sanitizeJawJamPattern({
  ...pattern,
  stepCount: pattern.steps.length,
});

export const JAW_JAM_PATTERNS = Object.freeze([
  authoredPattern({
    id: "appalachian-drive",
    label: "Appalachian Drive",
    description: "A firm mountain pulse with open calls, close overtone answers, and clean air rests.",
    tempo: 118,
    swing: 0.08,
    breathRatio: 1,
    steps: [
      pluck(38, comboId("khomus", "open-a"), "a", 0.86, 0.92, 1),
      sustain(38, comboId("khomus", "overtone-e"), "e", 0, 0.74, 1.5),
      pluck(43, comboId("munnharpe", "bright-e"), "i", 0.68, 0.82, 1),
      sustain(43, comboId("munnharpe", "needle-i"), "i", 0, 0.66, 0.75),
      rest(43),
      pluck(41, comboId("khomus", "rounded-o"), "o", 0.78, 1.04, 1),
      sustain(41, comboId("khomus", "deep-u"), "u", 0, 0.88, 0.5),
      pluck(45, comboId("munnharpe", "overtone-e"), "e", 0.62, 0.72, 2),
      pluck(38, comboId("khomus", "throat-a"), "a", 0.94, 1.12, 1),
      sustain(38, comboId("khomus", "open-a"), "a", 0, 0.86, 1),
      pluck(46, comboId("munnharpe", "needle-i"), "i", 0.72, 0.68, 1.5),
      sustain(46, comboId("munnharpe", "air-o"), "o", 0, 1.16, 2),
      rest(46),
      pluck(43, comboId("marranzanu", "bright-e"), "e", 0.8, 0.76, 1),
      sustain(43, comboId("marranzanu", "rounded-o"), "o", 0, 0.9, 0.5),
      pluck(38, comboId("khomus", "open-a"), "a", 1, 1.02, 1),
    ],
  }),
  authoredPattern({
    id: "khomus-overtone-cycle",
    label: "Khomus Overtone Cycle",
    description: "Long Siberian steel tones move deliberately through vowel-selected partials.",
    tempo: 84,
    swing: 0,
    breathRatio: 1 / 2,
    steps: [
      pluck(31, comboId("khomus", "throat-a"), "a", 0.92, 1.16, 0.5),
      sustain(31, comboId("khomus", "deep-u"), "u", 0, 1.04, 0.5),
      sustain(31, comboId("khomus", "rounded-o"), "o", 0, 0.94, 1),
      sustain(31, comboId("khomus", "open-a"), "a", 0, 0.86, 1),
      pluck(34, comboId("khomus", "bright-e"), "e", 0.72, 0.82, 1),
      sustain(34, comboId("khomus", "needle-i"), "i", 0, 0.7, 1.5),
      sustain(34, comboId("khomus", "overtone-e"), "e", 0, 0.76, 2),
      rest(34),
    ],
  }),
  authoredPattern({
    id: "morsing-tala-thread",
    label: "Morsing Tala Thread",
    description: "A fast, even tala-inspired line alternates dry attacks and controlled breath subdivisions.",
    tempo: 156,
    swing: 0.03,
    breathRatio: 2,
    steps: [
      pluck(45, comboId("marranzanu", "bright-e"), "e", 0.82, 0.72, 1),
      sustain(45, comboId("marranzanu", "needle-i"), "i", 0, 0.58, 1.5),
      pluck(42, comboId("munnharpe", "open-a"), "a", 0.58, 0.68, 1),
      pluck(47, comboId("marranzanu", "overtone-e"), "i", 0.74, 0.62, 2),
      rest(47),
      pluck(43, comboId("munnharpe", "rounded-o"), "o", 0.66, 0.84, 0.75),
      sustain(43, comboId("munnharpe", "air-o"), "o", 0, 1.12, 2),
      pluck(48, comboId("marranzanu", "needle-i"), "i", 0.88, 0.7, 1.5),
      pluck(45, comboId("marranzanu", "bright-e"), "e", 0.78, 0.74, 1),
      sustain(45, comboId("marranzanu", "overtone-e"), "i", 0, 0.62, 2),
      pluck(42, comboId("munnharpe", "throat-a"), "a", 0.54, 0.82, 0.5),
      pluck(47, comboId("marranzanu", "needle-i"), "i", 0.76, 0.66, 1.5),
      rest(47),
      pluck(43, comboId("munnharpe", "deep-u"), "u", 0.7, 0.9, 0.75),
      sustain(43, comboId("munnharpe", "rounded-o"), "o", 0, 0.86, 1),
      pluck(50, comboId("marranzanu", "overtone-e"), "e", 0.96, 0.72, 2),
    ],
  }),
  authoredPattern({
    id: "nordic-springar-line",
    label: "Nordic Springar Line",
    description: "A twelve-step asymmetric steel dance with clear attacks and patient sustained answers.",
    tempo: 132,
    swing: 0.14,
    breathRatio: 1,
    steps: [
      pluck(41, comboId("munnharpe", "open-a"), "a", 0.9, 0.82, 1),
      sustain(41, comboId("munnharpe", "bright-e"), "e", 0, 0.7, 1),
      pluck(46, comboId("munnharpe", "needle-i"), "i", 0.62, 0.68, 1.5),
      rest(46),
      pluck(43, comboId("munnharpe", "rounded-o"), "o", 0.78, 0.94, 0.75),
      sustain(43, comboId("munnharpe", "deep-u"), "u", 0, 0.86, 0.5),
      pluck(48, comboId("dan-moi", "overtone-e"), "e", 0.68, 0.74, 2),
      sustain(48, comboId("dan-moi", "air-o"), "o", 0, 1.08, 2),
      rest(48),
      pluck(45, comboId("munnharpe", "bright-e"), "e", 0.82, 0.72, 1),
      sustain(45, comboId("munnharpe", "needle-i"), "i", 0, 0.64, 1.5),
      pluck(41, comboId("munnharpe", "open-a"), "a", 0.98, 0.9, 1),
    ],
  }),
  authoredPattern({
    id: "bamboo-speech-ribbon",
    label: "Bamboo Speech Ribbon",
    description: "A light kubing phrase uses quick vowels and spacious breaths without comic gestures.",
    tempo: 104,
    swing: -0.05,
    breathRatio: 1 / 3,
    steps: [
      pluck(48, comboId("kubing", "open-a"), "a", 0.66, 0.78, 1),
      sustain(48, comboId("kubing", "bright-e"), "e", 0, 0.7, 1.5),
      sustain(48, comboId("kubing", "needle-i"), "i", 0, 0.62, 2),
      pluck(45, comboId("kubing", "rounded-o"), "o", 0.54, 0.9, 0.75),
      sustain(45, comboId("kubing", "deep-u"), "u", 0, 0.86, 0.5),
      rest(45),
      pluck(50, comboId("dan-moi", "overtone-e"), "e", 0.7, 0.68, 2),
      sustain(50, comboId("dan-moi", "air-o"), "o", 0, 1.18, 3),
      pluck(47, comboId("kubing", "bright-e"), "i", 0.58, 0.74, 1.5),
      sustain(47, comboId("kubing", "open-a"), "a", 0, 0.82, 1),
    ],
  }),
]);

export function jawJamPattern(id) {
  return JAW_JAM_PATTERNS.find((pattern) => pattern.id === id)
    ?? JAW_JAM_PATTERNS[0];
}

function asJawJamPattern(source) {
  return typeof source === "string"
    ? jawJamPattern(source)
    : sanitizeJawJamPattern(source);
}

function wrappedStepIndex(pattern, stepIndex) {
  const index = Math.trunc(finiteOr(stepIndex, 0));
  return ((index % pattern.stepCount) + pattern.stepCount) % pattern.stepCount;
}

function resolvedPluckStep(pattern, stepIndex) {
  const index = wrappedStepIndex(pattern, stepIndex);
  const current = pattern.steps[index];
  if (current.action === "rest") return null;
  if (current.action === "pluck") return current;
  for (let distance = 1; distance < pattern.stepCount; distance += 1) {
    const candidate = pattern.steps[(index - distance + pattern.stepCount) % pattern.stepCount];
    if (candidate.action === "rest") return null;
    if (candidate.action === "pluck") return candidate;
  }
  return null;
}

export function jawJamResolvedMidi(source, stepIndex = 0) {
  const pattern = asJawJamPattern(source);
  return resolvedPluckStep(pattern, stepIndex)?.midi ?? null;
}

export function jawJamResolvedSoundPresetId(source, stepIndex = 0) {
  const pattern = asJawJamPattern(source);
  const index = wrappedStepIndex(pattern, stepIndex);
  return jawJamResolvedMidi(pattern, index) === null
    ? null
    : pattern.steps[index].soundPresetId;
}

export function jawJamResolvedMaterialId(source, stepIndex = 0) {
  const soundPresetId = jawJamResolvedSoundPresetId(source, stepIndex);
  return soundPresetId ? jawJamSoundPreset(soundPresetId).materialId : null;
}

export function jawJamMidiFrequencyHz(midi) {
  const note = Math.round(clamp(midi, ...JAW_JAM_LIMITS.midi));
  return clamp(440 * (2 ** ((note - 69) / 12)), ...JAW_JAM_LIMITS.reedFrequencyHz);
}

export function jawJamStepIntervalSeconds(source = JAW_JAM_DEFAULTS, swingOrStep = 0, step = 0) {
  let tempo = source;
  let swing = swingOrStep;
  let absoluteStep = step;
  if (source && typeof source === "object") {
    const pattern = asJawJamPattern(source);
    tempo = pattern.tempo;
    swing = pattern.swing;
    absoluteStep = swingOrStep;
  }
  const bpm = clamp(tempo, ...JAW_JAM_LIMITS.tempo);
  const amount = clamp(swing, ...JAW_JAM_LIMITS.swing);
  const straightBeat = 60 / bpm;
  const isEven = Math.abs(Math.trunc(finiteOr(absoluteStep, 0)) % 2) === 0;
  return straightBeat * (isEven ? 1 + amount : 1 - amount);
}

export function jawJamBreathRateBpm(
  source = JAW_JAM_DEFAULTS,
  ratioOrStep = JAW_JAM_DEFAULTS.breathRatio,
  localMultiplier = 1,
) {
  let tempo = source;
  let ratio = ratioOrStep;
  let multiplier = localMultiplier;
  if (source && typeof source === "object") {
    const pattern = asJawJamPattern(source);
    tempo = pattern.tempo;
    ratio = pattern.breathRatio;
    const stepValue = ratioOrStep && typeof ratioOrStep === "object"
      ? sanitizeJawJamStep(ratioOrStep)
      : pattern.steps[wrappedStepIndex(pattern, ratioOrStep)];
    multiplier = stepValue.breathRateMultiplier;
  }
  const bpm = clamp(tempo, ...JAW_JAM_LIMITS.tempo);
  const breathRatio = sanitizedBreathRatio(ratio);
  const localRate = clamp(multiplier, ...JAW_JAM_LIMITS.breathRateMultiplier);
  return clamp(
    bpm * breathRatio * localRate,
    ...JAW_JAM_LIMITS.breathRateBpm,
  );
}

function profileAdjustedConfiguration(materialId, soundPreset, vowelId) {
  const body = jawHarpState(materialId);
  const selectedVowel = vowelPreset(vowelId);
  const initialVowel = vowelPreset(soundPreset.initialVowelId);
  const voiced = applyVowel(body, selectedVowel.id);
  const adjustedMouth = Object.fromEntries(MOUTH_ARTICULATION_KEYS.map((key) => [
    key,
    voiced[key] + soundPreset.settings[key] - initialVowel.settings[key],
  ]));
  const nonMouthSettings = Object.fromEntries(PROFILE_SETTING_KEYS
    .filter((key) => !MOUTH_ARTICULATION_KEYS.includes(key))
    .map((key) => [key, soundPreset.settings[key]]));
  return sanitizeJawHarpState({
    ...voiced,
    ...nonMouthSettings,
    ...adjustedMouth,
    presetId: materialId,
    vowelId: selectedVowel.id,
  }, body);
}

export function jawJamStepConfiguration(source, stepIndex = 0) {
  const pattern = asJawJamPattern(source);
  const index = wrappedStepIndex(pattern, stepIndex);
  const step = pattern.steps[index];
  const midi = jawJamResolvedMidi(pattern, index);
  const materialId = jawJamResolvedMaterialId(pattern, index);
  if (step.action === "rest" || midi === null || !materialId) return null;
  const expressivePreset = jawJamSoundPreset(step.soundPresetId);
  const expressive = profileAdjustedConfiguration(materialId, expressivePreset, step.vowelId);
  const [minimumForce, maximumForce] = JAW_HARP_LIMITS.pluckForce;
  const pluckForce = minimumForce
    + (maximumForce - minimumForce) * Math.pow(step.pluckIntensity, 1.45);
  const configuration = sanitizeJawHarpState({
    ...expressive,
    presetId: materialId,
    reedFrequencyHz: jawJamMidiFrequencyHz(midi),
    pluckForce,
    breathDepth: step.breathPower,
    breathRateBpm: jawJamBreathRateBpm(pattern, step),
    autoBreath: step.breathPower > 0,
    breathLinked: false,
    breathsPerLoop: pattern.breathRatio,
    repeatRateBpm: pattern.tempo,
    repeatSwing: pattern.swing,
    repeat: false,
    styleId: JAW_HARP_STYLE_CUSTOM_ID,
    vowelId: step.vowelId,
    vowelSequenceMode: "off",
    breathFlow: 0,
  }, expressive);
  return Object.freeze(configuration);
}

export function jawJamPulseEnergy(stepOrPull = DEFAULT_STEP, breathPower = 0) {
  let action = "pluck";
  let pull = stepOrPull;
  let air = breathPower;
  if (stepOrPull && typeof stepOrPull === "object") {
    const step = sanitizeJawJamStep(stepOrPull);
    action = step.action;
    pull = step.action === "pluck" ? step.pluckIntensity : 0;
    air = step.breathPower;
  }
  if (action === "rest") return 0;
  const normalizedPull = clamp(pull, ...JAW_JAM_LIMITS.pluckIntensity);
  const normalizedAir = clamp(air, ...JAW_JAM_LIMITS.breathPower)
    / JAW_JAM_LIMITS.breathPower[1];
  return clamp(
    normalizedPull + (1 - normalizedPull) * normalizedAir * 0.68,
    ...JAW_JAM_LIMITS.pulseEnergy,
  );
}

function randomUnit(random) {
  return clamp(typeof random === "function" ? finiteOr(random(), 0.5) : 0.5, 0, 1);
}

function randomChoice(values, random) {
  const draw = Math.min(1 - Number.EPSILON, randomUnit(random));
  return values[Math.floor(draw * values.length)];
}

export function randomizeJawJamPattern(source = JAW_JAM_DEFAULTS.patternId, random = Math.random) {
  let patternSource = source;
  let generator = random;
  if (typeof source === "function") {
    generator = source;
    patternSource = JAW_JAM_DEFAULTS.patternId;
  }
  const base = asJawJamPattern(patternSource);
  const localRates = Object.freeze([0.5, 0.75, 1, 1.5, 2, 3]);
  let hasPitch = false;
  let lastMidi = DEFAULT_STEP.midi;
  const steps = Array.from({ length: base.stepCount }, (_, index) => {
    const actionDraw = randomUnit(generator);
    let action = index === 0 || !hasPitch
      ? "pluck"
      : actionDraw < 0.46
        ? "pluck"
        : actionDraw < 0.84
          ? "sustain"
          : "rest";
    if (action === "rest") hasPitch = false;
    if (action === "pluck") {
      hasPitch = true;
      lastMidi = Math.round(
        JAW_JAM_LIMITS.midi[0]
          + randomUnit(generator) * (JAW_JAM_LIMITS.midi[1] - JAW_JAM_LIMITS.midi[0]),
      );
    }
    if (action === "sustain" && !hasPitch) action = "pluck";
    return sanitizeJawJamStep({
      action,
      midi: lastMidi,
      soundPresetId: randomChoice(JAW_JAM_SOUND_PRESETS, generator).id,
      vowelId: randomChoice(VOWEL_PRESETS, generator).id,
      pluckIntensity: action === "pluck"
        ? 0.32 + Math.pow(randomUnit(generator), 0.72) * 0.68
        : 0,
      breathPower: action === "rest" ? 0 : 0.34 + randomUnit(generator) * 1.86,
      breathRateMultiplier: randomChoice(localRates, generator),
    });
  });
  return sanitizeJawJamPattern({
    id: "custom",
    label: "Randomized performance",
    description: "A deterministic, playable monophonic mutation when supplied a seeded random source.",
    stepCount: base.stepCount,
    tempo: 72 + randomUnit(generator) * 144,
    swing: -0.14 + randomUnit(generator) * 0.34,
    breathRatio: randomChoice(JAW_JAM_BREATH_RATIOS, generator),
    steps,
  }, base);
}

// Keep this assertion next to the catalog so a future material addition cannot
// silently ship without the full articulation matrix.
if (
  JAW_JAM_SOUND_PRESETS.length !== JAW_HARP_PRESETS.length * ARTICULATION_PROFILES.length
  || JAW_JAM_SOUND_PRESETS.some(({ materialId }) => !MATERIAL_IDS.has(materialId))
) {
  throw new Error("Jaw Jam sound presets must cover every material/profile combination.");
}
