import assert from "node:assert/strict";
import test from "node:test";

import {
  JAW_HARP_LIMITS,
  JAW_HARP_PRESETS,
  VOWEL_PRESETS,
} from "../src/jaw-harp.js";
import {
  JAW_JAM_ACTIONS,
  JAW_JAM_BREATH_RATIOS,
  JAW_JAM_DEFAULTS,
  JAW_JAM_LIMITS,
  JAW_JAM_PATTERNS,
  JAW_JAM_SOUND_PRESETS,
  jawJamBreathRateBpm,
  jawJamMidiFrequencyHz,
  jawJamPattern,
  jawJamPulseEnergy,
  jawJamResolvedMaterialId,
  jawJamResolvedMidi,
  jawJamResolvedSoundPresetId,
  jawJamSoundPreset,
  jawJamStepConfiguration,
  jawJamStepIntervalSeconds,
  randomizeJawJamPattern,
  sanitizeJawJamPattern,
  sanitizeJawJamStep,
} from "../src/jaw-jam.js";

const MATERIAL_IDS = new Set(JAW_HARP_PRESETS.map(({ id }) => id));
const VOWEL_IDS = new Set(VOWEL_PRESETS.map(({ id }) => id));

function patternFromSteps(steps, overrides = {}) {
  return sanitizeJawJamPattern({
    id: "test-pattern",
    label: "Test pattern",
    tempo: 120,
    swing: 0,
    breathRatio: 1,
    stepCount: steps.length,
    steps,
    ...overrides,
  });
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function assertInRange(value, [minimum, maximum], message = "value") {
  assert.ok(value >= minimum && value <= maximum, `${message}: ${value} not in ${minimum}–${maximum}`);
}

test("Jaw Jam publishes frozen monophonic actions, exact breath ratios, and physical limits", () => {
  assert.deepEqual(JAW_JAM_ACTIONS, ["pluck", "sustain", "rest"]);
  assert.deepEqual(JAW_JAM_BREATH_RATIOS, [1 / 3, 1 / 2, 1, 2, 3]);
  assert.ok(Object.isFrozen(JAW_JAM_ACTIONS));
  assert.ok(Object.isFrozen(JAW_JAM_BREATH_RATIOS));
  assert.ok(Object.isFrozen(JAW_JAM_LIMITS));
  assert.deepEqual(JAW_JAM_LIMITS.stepCount, [1, 32]);
  assert.deepEqual(JAW_JAM_LIMITS.midi, [27, 53]);
  assert.deepEqual(JAW_JAM_LIMITS.reedFrequencyHz, [38, 180]);
  assert.deepEqual(JAW_JAM_LIMITS.breathPower, JAW_HARP_LIMITS.breathDepth);
  for (const limits of Object.values(JAW_JAM_LIMITS)) {
    assert.ok(Object.isFrozen(limits));
    assert.equal(limits.length, 2);
    assert.ok(limits[0] <= limits[1]);
  }
});

test("the forty sound presets form a frozen eight-profile matrix over all five materials", () => {
  assert.equal(JAW_JAM_SOUND_PRESETS.length, 40);
  assert.ok(Object.isFrozen(JAW_JAM_SOUND_PRESETS));
  assert.equal(new Set(JAW_JAM_SOUND_PRESETS.map(({ id }) => id)).size, 40);
  assert.equal(new Set(JAW_JAM_SOUND_PRESETS.map(({ label }) => label)).size, 40);

  const materialCounts = new Map(JAW_HARP_PRESETS.map(({ id }) => [id, 0]));
  const profileCounts = new Map();
  for (const preset of JAW_JAM_SOUND_PRESETS) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.settings));
    assert.ok(MATERIAL_IDS.has(preset.materialId), preset.id);
    assert.equal(preset.presetId, preset.materialId);
    assert.ok(VOWEL_IDS.has(preset.initialVowelId), preset.id);
    assert.equal(preset.vowelId, preset.initialVowelId);
    assert.ok(preset.label.includes(" · "));
    assert.ok(preset.description.length > 24);
    materialCounts.set(preset.materialId, materialCounts.get(preset.materialId) + 1);
    profileCounts.set(preset.profileId, (profileCounts.get(preset.profileId) ?? 0) + 1);
    for (const [key, value] of Object.entries(preset.settings)) {
      assert.ok(Number.isFinite(value), `${preset.id}.${key}`);
      assertInRange(value, JAW_HARP_LIMITS[key], `${preset.id}.${key}`);
    }
  }
  assert.deepEqual([...materialCounts.values()], [8, 8, 8, 8, 8]);
  assert.equal(profileCounts.size, 8);
  assert.deepEqual([...profileCounts.values()], [5, 5, 5, 5, 5, 5, 5, 5]);
  assert.equal(jawJamSoundPreset("kubing-deep-u").materialId, "kubing");
  assert.equal(jawJamSoundPreset("not-a-preset"), JAW_JAM_SOUND_PRESETS[0]);
});

test("default state and rich steps are frozen, bounded, canonical records", () => {
  assert.ok(Object.isFrozen(JAW_JAM_DEFAULTS));
  assert.ok(Object.isFrozen(JAW_JAM_DEFAULTS.step));
  assert.equal(JAW_JAM_DEFAULTS.patternId, JAW_JAM_PATTERNS[0].id);

  const fallback = sanitizeJawJamStep({
    action: "sustain",
    midi: 41,
    vowelId: "o",
    soundPresetId: "kubing-rounded-o",
    pluckIntensity: 0.4,
    breathPower: 0.8,
    breathRateMultiplier: 1.5,
  });
  const invalid = sanitizeJawJamStep({
    action: "chord",
    midi: Number.NaN,
    vowelId: "y",
    soundPresetId: "missing",
    pluckIntensity: 99,
    breathPower: -99,
    breathRateMultiplier: Infinity,
  }, fallback);
  assert.ok(Object.isFrozen(invalid));
  assert.deepEqual(invalid, {
    action: "sustain",
    midi: 41,
    vowelId: "o",
    soundPresetId: "kubing-rounded-o",
    pluckIntensity: 1,
    breathPower: 0,
    breathRateMultiplier: 0.125,
  });

  assert.deepEqual(
    sanitizeJawJamStep({
      action: "pluck",
      pitchMidi: -200,
      comboId: "dan-moi-air-o",
      intensity: -1,
      breathPower: 99,
      breathMultiplier: 99,
      vowelId: "i",
    }),
    {
      action: "pluck",
      midi: 27,
      vowelId: "i",
      soundPresetId: "dan-moi-air-o",
      pluckIntensity: 0,
      breathPower: 3,
      breathRateMultiplier: 8,
    },
  );
});

test("pattern sanitation deterministically infers, clamps, fills, and deeply freezes 1–32 steps", () => {
  const source = {
    id: "  bounded  ",
    label: "  Bounded phrase  ",
    description: "  deterministic record  ",
    tempo: 99_000,
    swing: -99,
    breathRatio: 0.74,
    steps: [
      { action: "pluck", midi: 48, soundPresetId: "dan-moi-needle-i", vowelId: "i" },
      { action: "rest" },
    ],
  };
  const snapshot = structuredClone(source);
  const pattern = sanitizeJawJamPattern(source);
  assert.deepEqual(source, snapshot, "sanitation must not mutate caller data");
  assert.ok(Object.isFrozen(pattern));
  assert.ok(Object.isFrozen(pattern.steps));
  assert.ok(pattern.steps.every(Object.isFrozen));
  assert.equal(pattern.id, "bounded");
  assert.equal(pattern.label, "Bounded phrase");
  assert.equal(pattern.description, "deterministic record");
  assert.equal(pattern.stepCount, 2);
  assert.equal(pattern.steps.length, 2);
  assert.equal(pattern.tempo, 480);
  assert.equal(pattern.swing, -0.42);
  assert.equal(pattern.breathRatio, 0.5, "equal-distance ratio ties resolve predictably downward");
  assert.deepEqual(sanitizeJawJamPattern(source), pattern);

  const maximum = sanitizeJawJamPattern({ stepCount: 10_000, steps: [{}] });
  const minimum = sanitizeJawJamPattern({ stepCount: -10_000, steps: [] });
  assert.equal(maximum.stepCount, 32);
  assert.equal(maximum.steps.length, 32);
  assert.equal(minimum.stepCount, 1);
  assert.equal(minimum.steps.length, 1);
});

test("authored performance patterns are serious, valid, monophonic frozen sequences", () => {
  assert.ok(JAW_JAM_PATTERNS.length >= 5);
  assert.ok(Object.isFrozen(JAW_JAM_PATTERNS));
  assert.equal(new Set(JAW_JAM_PATTERNS.map(({ id }) => id)).size, JAW_JAM_PATTERNS.length);
  assert.equal(new Set(JAW_JAM_PATTERNS.map(({ label }) => label)).size, JAW_JAM_PATTERNS.length);
  const usedMaterials = new Set();
  for (const pattern of JAW_JAM_PATTERNS) {
    assert.ok(Object.isFrozen(pattern));
    assert.ok(Object.isFrozen(pattern.steps));
    assert.equal(pattern.steps.length, pattern.stepCount);
    assertInRange(pattern.stepCount, JAW_JAM_LIMITS.stepCount, pattern.id);
    assertInRange(pattern.tempo, JAW_JAM_LIMITS.tempo, pattern.id);
    assertInRange(pattern.swing, JAW_JAM_LIMITS.swing, pattern.id);
    assert.ok(JAW_JAM_BREATH_RATIOS.includes(pattern.breathRatio));
    assert.ok(pattern.description.length > 40);
    assert.ok(pattern.steps.some(({ action }) => action === "pluck"));
    assert.ok(pattern.steps.some(({ action }) => action === "sustain"));
    assert.ok(pattern.steps.some(({ action }) => action === "rest"));
    pattern.steps.forEach((step, index) => {
      assert.ok(Object.isFrozen(step));
      assert.ok(JAW_JAM_ACTIONS.includes(step.action));
      assertInRange(step.midi, JAW_JAM_LIMITS.midi, `${pattern.id}.${index}.midi`);
      assert.ok(VOWEL_IDS.has(step.vowelId));
      assert.ok(JAW_JAM_SOUND_PRESETS.includes(jawJamSoundPreset(step.soundPresetId)));
      if (step.action === "pluck") usedMaterials.add(jawJamSoundPreset(step.soundPresetId).materialId);
      const configuration = jawJamStepConfiguration(pattern, index);
      if (step.action === "rest") assert.equal(configuration, null);
      else assert.ok(configuration, `${pattern.id} step ${index} should inherit a live reed`);
    });
  }
  assert.deepEqual(usedMaterials, MATERIAL_IDS);
  assert.equal(jawJamPattern("bamboo-speech-ribbon").stepCount, 10);
  assert.equal(jawJamPattern("missing-pattern"), JAW_JAM_PATTERNS[0]);
});

test("integer MIDI pitch always maps inside the physical 38–180 Hz reed range", () => {
  const frequencies = [];
  for (let midi = JAW_JAM_LIMITS.midi[0]; midi <= JAW_JAM_LIMITS.midi[1]; midi += 1) {
    const frequency = jawJamMidiFrequencyHz(midi);
    assertInRange(frequency, JAW_HARP_LIMITS.reedFrequencyHz, `MIDI ${midi}`);
    frequencies.push(frequency);
  }
  assert.ok(frequencies.every((frequency, index) => index === 0 || frequency > frequencies[index - 1]));
  assert.ok(Math.abs(frequencies[0] - 38.89087296526011) < 1e-9);
  assert.ok(Math.abs(frequencies.at(-1) - 174.61411571650194) < 1e-9);
  assert.equal(jawJamMidiFrequencyHz(-Infinity), frequencies[0]);
  assert.equal(jawJamMidiFrequencyHz(Infinity), frequencies[0]);
  assert.equal(jawJamMidiFrequencyHz(999), frequencies.at(-1));
});

test("sustains resolve pitch cyclically, while rests and all-sustain loops block inheritance", () => {
  const cyclic = patternFromSteps([
    { action: "sustain", midi: 51, soundPresetId: "dan-moi-air-o" },
    { action: "sustain", midi: 52, soundPresetId: "munnharpe-needle-i" },
    { action: "pluck", midi: 43, soundPresetId: "kubing-open-a" },
  ]);
  assert.deepEqual(
    cyclic.steps.map((_, index) => jawJamResolvedMidi(cyclic, index)),
    [43, 43, 43],
  );
  assert.equal(jawJamResolvedMidi(cyclic, -1), 43);
  assert.equal(jawJamResolvedMidi(cyclic, 4), 43);
  assert.equal(jawJamResolvedSoundPresetId(cyclic, 0), "dan-moi-air-o");
  assert.equal(jawJamResolvedMaterialId(cyclic, 0), "dan-moi");
  assert.equal(jawJamResolvedMaterialId(cyclic, 1), "munnharpe");
  assert.equal(jawJamResolvedMaterialId(cyclic, 2), "kubing");

  const blocked = patternFromSteps([
    { action: "sustain", midi: 51 },
    { action: "pluck", midi: 47, soundPresetId: "dan-moi-needle-i" },
    { action: "rest" },
  ]);
  assert.deepEqual(
    blocked.steps.map((_, index) => jawJamResolvedMidi(blocked, index)),
    [null, 47, null],
  );
  assert.equal(jawJamResolvedMaterialId(blocked, 0), null);

  const allSustain = patternFromSteps(Array.from({ length: 7 }, () => ({
    action: "sustain",
    midi: 44,
  })));
  assert.ok(allSustain.steps.every((_, index) => jawJamResolvedMidi(allSustain, index) === null));
  assert.ok(allSustain.steps.every((_, index) => jawJamStepConfiguration(allSustain, index) === null));
});

test("step configuration inherits pitch while every sustain selects its own physical body and expression", () => {
  const pattern = patternFromSteps([
    {
      action: "pluck",
      midi: 40,
      soundPresetId: "kubing-open-a",
      vowelId: "a",
      pluckIntensity: 0.6,
      breathPower: 0.8,
      breathRateMultiplier: 1,
    },
    {
      action: "sustain",
      midi: 53,
      soundPresetId: "dan-moi-needle-i",
      vowelId: "i",
      pluckIntensity: 0,
      breathPower: 1.4,
      breathRateMultiplier: 1.5,
    },
    { action: "rest" },
    {
      action: "sustain",
      midi: 50,
      soundPresetId: "khomus-air-o",
      vowelId: "o",
    },
  ], { tempo: 120, breathRatio: 2, swing: 0.12 });
  const attack = jawJamStepConfiguration(pattern, 0);
  const sustainConfiguration = jawJamStepConfiguration(pattern, 1);
  assert.ok(Object.isFrozen(attack));
  assert.ok(Object.isFrozen(sustainConfiguration));
  assert.equal(attack.presetId, "kubing");
  assert.equal(sustainConfiguration.presetId, "dan-moi", "sustain carries its selected tail-safe material");
  assert.equal(sustainConfiguration.reedFrequencyHz, jawJamMidiFrequencyHz(40));
  assert.equal(sustainConfiguration.vowelId, "i");
  assert.equal(sustainConfiguration.formantFocus, jawJamSoundPreset("dan-moi-needle-i").settings.formantFocus);
  assert.equal(sustainConfiguration.breathDepth, 1.4);
  assert.equal(sustainConfiguration.breathRateBpm, 360);
  assert.equal(sustainConfiguration.repeat, false);
  assert.equal(sustainConfiguration.breathLinked, false);
  assert.equal(sustainConfiguration.vowelSequenceMode, "off");
  assert.equal(sustainConfiguration.autoBreath, true);
  assert.equal(jawJamStepConfiguration(pattern, 2), null);
  assert.equal(jawJamStepConfiguration(pattern, 3), null, "rest blocks a later sustain");
  for (const [key, limits] of Object.entries(JAW_HARP_LIMITS)) {
    assertInRange(sustainConfiguration[key], limits, key);
  }
});

test("every sound preset yields a finite bounded Jaw Harp configuration", () => {
  for (const preset of JAW_JAM_SOUND_PRESETS) {
    const pattern = patternFromSteps([{
      action: "pluck",
      midi: 46,
      soundPresetId: preset.id,
      vowelId: preset.initialVowelId,
      pluckIntensity: 0.72,
      breathPower: 1.1,
      breathRateMultiplier: 1,
    }], { tempo: 108, breathRatio: 1 / 2 });
    const configuration = jawJamStepConfiguration(pattern, 0);
    assert.equal(configuration.presetId, preset.materialId);
    assert.equal(configuration.vowelId, preset.initialVowelId);
    assert.equal(configuration.reedFrequencyHz, jawJamMidiFrequencyHz(46));
    assert.equal(configuration.breathRateBpm, 54);
    for (const [key, limits] of Object.entries(JAW_HARP_LIMITS)) {
      assert.ok(Number.isFinite(configuration[key]), `${preset.id}.${key}`);
      assertInRange(configuration[key], limits, `${preset.id}.${key}`);
    }
  }
});

test("breath clock ratios are exact factors of quarter-note tempo with a bounded local multiplier", () => {
  for (const ratio of JAW_JAM_BREATH_RATIOS) {
    assert.equal(jawJamBreathRateBpm(120, ratio, 1), 120 * ratio);
    assert.equal(jawJamBreathRateBpm(90, ratio, 2), 180 * ratio);
  }
  const pattern = patternFromSteps([
    { action: "pluck", breathRateMultiplier: 0.5 },
    { action: "sustain", breathRateMultiplier: 3 },
  ], { tempo: 144, breathRatio: 1 / 2 });
  assert.equal(jawJamBreathRateBpm(pattern, 0), 36);
  assert.equal(jawJamBreathRateBpm(pattern, 1), 216);
  assert.equal(jawJamBreathRateBpm(pattern, pattern.steps[1]), 216);
  assert.equal(jawJamBreathRateBpm(480, 3, 8), JAW_HARP_LIMITS.breathRateBpm[1]);
  assert.equal(jawJamBreathRateBpm(-Infinity, -99, -99), 1.5);
});

test("swing preserves each two-beat duration and follows absolute steps across odd loops", () => {
  assert.equal(jawJamStepIntervalSeconds(120, 0, 0), 0.5);
  assert.equal(jawJamStepIntervalSeconds(120, 0.25, 0), 0.625);
  assert.equal(jawJamStepIntervalSeconds(120, 0.25, 1), 0.375);
  assert.equal(jawJamStepIntervalSeconds(120, 0.25, -1), 0.375);
  assert.equal(
    jawJamStepIntervalSeconds(120, 0.25, 0) + jawJamStepIntervalSeconds(120, 0.25, 1),
    1,
  );

  const odd = patternFromSteps(Array.from({ length: 5 }, (_, index) => ({
    action: index === 0 ? "pluck" : "sustain",
  })), { tempo: 120, swing: 0.42 });
  const twoLoops = Array.from(
    { length: odd.stepCount * 2 },
    (_, absoluteStep) => jawJamStepIntervalSeconds(odd, absoluteStep),
  ).reduce((sum, interval) => sum + interval, 0);
  assert.ok(Math.abs(twoLoops - 5) < 1e-12);
  assert.notEqual(
    jawJamStepIntervalSeconds(odd, 0),
    jawJamStepIntervalSeconds(odd, odd.stepCount),
    "the first step of an odd-length second loop must switch swing parity",
  );
});

test("pulse energy combines normalized pull and air without giving rests energy", () => {
  const pullOnly = jawJamPulseEnergy(0.5, 0);
  const airOnly = jawJamPulseEnergy(0, 1.5);
  const combined = jawJamPulseEnergy(0.5, 1.5);
  assert.equal(pullOnly, 0.5);
  assert.equal(airOnly, 0.34);
  assert.ok(combined > pullOnly);
  assert.ok(combined > airOnly);
  assertInRange(combined, JAW_JAM_LIMITS.pulseEnergy);
  assert.equal(jawJamPulseEnergy({ action: "rest", pluckIntensity: 1, breathPower: 3 }), 0);
  assert.equal(jawJamPulseEnergy({ action: "sustain", breathPower: 0 }), 0);
  assert.ok(jawJamPulseEnergy({ action: "sustain", breathPower: 2 }) > 0);
  assert.equal(jawJamPulseEnergy(99, 99), 1);
});

test("seeded randomization is deterministic, playable, bounded, and never sustains after a rest", () => {
  const source = jawJamPattern("nordic-springar-line");
  const first = randomizeJawJamPattern(source, seededRandom(0x4a61774a));
  const second = randomizeJawJamPattern(source, seededRandom(0x4a61774a));
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.steps));
  assert.equal(first.id, "custom");
  assert.equal(first.stepCount, source.stepCount);
  assert.equal(first.steps[0].action, "pluck");
  assert.ok(first.steps.some(({ action }) => action === "pluck"));
  assert.ok(JAW_JAM_BREATH_RATIOS.includes(first.breathRatio));
  let hasPitch = false;
  for (const step of first.steps) {
    assert.ok(Object.isFrozen(step));
    if (step.action === "rest") hasPitch = false;
    if (step.action === "sustain") assert.equal(hasPitch, true);
    if (step.action === "pluck") hasPitch = true;
    assertInRange(step.midi, JAW_JAM_LIMITS.midi);
    assertInRange(step.pluckIntensity, JAW_JAM_LIMITS.pluckIntensity);
    assertInRange(step.breathPower, JAW_JAM_LIMITS.breathPower);
    assertInRange(step.breathRateMultiplier, JAW_JAM_LIMITS.breathRateMultiplier);
    assert.ok(VOWEL_IDS.has(step.vowelId));
    assert.ok(JAW_JAM_SOUND_PRESETS.some(({ id }) => id === step.soundPresetId));
  }

  const zeros = randomizeJawJamPattern(() => 0);
  const ones = randomizeJawJamPattern(() => 1);
  assert.ok(zeros.steps.every(({ action }) => action === "pluck"));
  assert.equal(ones.steps[0].action, "pluck");
  assert.deepEqual(
    ones.steps.map(({ action }) => action),
    Array.from({ length: ones.stepCount }, (_, index) => index % 2 ? "rest" : "pluck"),
    "a forced pluck after every rest prevents unresolved randomized sustains",
  );
  assert.ok(zeros.steps.every((_, index) => jawJamResolvedMidi(zeros, index) !== null));
});
