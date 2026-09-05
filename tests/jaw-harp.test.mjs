import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  JAW_HARP_DEFAULTS,
  JAW_HARP_LIMITS,
  JAW_HARP_MODE_COUNT,
  JAW_HARP_PRESETS,
  JAW_HARP_RANDOM_LIMITS,
  JAW_HARP_RHYTHMS,
  JAW_HARP_STYLE_CUSTOM_ID,
  JAW_HARP_STYLE_GESTURE_KEYS,
  JAW_HARP_STYLE_REFERENCES,
  JAW_HARP_STYLE_SETTING_KEYS,
  JAW_HARP_VOWEL_SEQUENCES,
  JAW_HARP_VOWEL_SEQUENCE_MODES,
  MAX_TINE_PULL,
  VOWEL_PRESETS,
  applyJawHarpStyle,
  applyVowel,
  breathCycleFlow,
  breathCycleIntervalMs,
  breathLobeBoundaryCount,
  dominantHarmonic,
  effectiveBreathRateBpm,
  jawHarpState,
  jawHarpStyle,
  jawHarpStyleGesture,
  jawHarpRhythmHit,
  jawHarpRhythmLoopMs,
  jawHarpVowelSequence,
  jawHarpVowelSequenceStep,
  linkedBreathIntervalMs,
  mouthFormants,
  mouthGeometry,
  naturalTineStrike,
  pluckForceFromPull,
  randomizeJawHarpState,
  reedMaterialProperties,
  reedModeFrequencies,
  repeatIntervalMs,
  sanitizeJawHarpState,
  tineDisplayFrequencyHz,
  tineReleaseMotion,
} from "../src/jaw-harp.js";

const root = new URL("../", import.meta.url);

test("jaw-harp presets describe distinct physical reeds", () => {
  assert.equal(JAW_HARP_PRESETS.length, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ id }) => id)).size, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ settings }) => settings.reedFrequencyHz)).size, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ material }) => JSON.stringify(material))).size, 5);
  for (const preset of JAW_HARP_PRESETS) {
    const state = jawHarpState(preset.id);
    assert.equal(state.presetId, preset.id);
    assert.ok(state.reedFrequencyHz >= 38 && state.reedFrequencyHz <= 180);
    assert.ok(state.reedDecaySeconds >= 0.35 && state.reedDecaySeconds <= 8);
    assert.ok(preset.material.youngsModulusGPa > 0);
    assert.ok(preset.material.densityKgM3 > 0);
    assert.ok(preset.material.internalLossFactor > 0);
    assert.ok(preset.material.elasticLimitStrain > 0);
  }
  const defaultVoice = jawHarpState("khomus");
  assert.deepEqual(
    [
      defaultVoice.reedFrequencyHz,
      defaultVoice.reedDecaySeconds,
      defaultVoice.reedStiffness,
      defaultVoice.pluckForce,
      defaultVoice.pluckPosition,
      defaultVoice.frameCoupling,
      defaultVoice.dryResonance,
    ],
    [76, 4.4, 0.72, 0.92, 0.29, 0.4, 0.14],
  );
  assert.deepEqual(
    JAW_HARP_PRESETS.map(({ id, settings, material }) => ({ id, settings, material })),
    [
      {
        id: "khomus",
        settings: {
          reedFrequencyHz: 76, reedDecaySeconds: 4.4, reedStiffness: 0.72,
          pluckForce: 0.92, pluckPosition: 0.29, frameCoupling: 0.4,
        },
        material: {
          brightness: 0.72, inharmonicity: 1.25, lossTilt: 0.72,
          frameRatio: 0.78, frameBandwidth: 0.72, contact: 0.86, airResponse: 0.88,
          youngsModulusGPa: 200, densityKgM3: 7_800,
          internalLossFactor: 0.0001, elasticLimitStrain: 0.009,
        },
      },
      {
        id: "munnharpe",
        settings: {
          reedFrequencyHz: 92, reedDecaySeconds: 2.7, reedStiffness: 0.82,
          pluckForce: 0.66, pluckPosition: 0.24, frameCoupling: 0.48,
        },
        material: {
          brightness: 1.34, inharmonicity: 1.12, lossTilt: 1.18,
          frameRatio: 1.32, frameBandwidth: 0.58, contact: 1.2, airResponse: 1.08,
          youngsModulusGPa: 210, densityKgM3: 7_800,
          internalLossFactor: 0.00008, elasticLimitStrain: 0.0095,
        },
      },
      {
        id: "marranzanu",
        settings: {
          reedFrequencyHz: 108, reedDecaySeconds: 1.9, reedStiffness: 0.76,
          pluckForce: 0.78, pluckPosition: 0.2, frameCoupling: 0.62,
        },
        material: {
          brightness: 1.08, inharmonicity: 0.92, lossTilt: 1.46,
          frameRatio: 1.72, frameBandwidth: 1.34, contact: 1.52, airResponse: 0.82,
          youngsModulusGPa: 200, densityKgM3: 7_850,
          internalLossFactor: 0.00024, elasticLimitStrain: 0.0065,
        },
      },
      {
        id: "kubing",
        settings: {
          reedFrequencyHz: 56, reedDecaySeconds: 0.62, reedStiffness: 0.28,
          pluckForce: 0.58, pluckPosition: 0.46, frameCoupling: 0.74,
        },
        material: {
          brightness: 0.48, inharmonicity: 0.38, lossTilt: 2.08,
          frameRatio: 0.58, frameBandwidth: 0.92, contact: 0.54, airResponse: 0.68,
          youngsModulusGPa: 10.6, densityKgM3: 630,
          internalLossFactor: 0.015, elasticLimitStrain: 0.006,
        },
      },
      {
        id: "dan-moi",
        settings: {
          reedFrequencyHz: 126, reedDecaySeconds: 2.25, reedStiffness: 0.56,
          pluckForce: 0.48, pluckPosition: 0.4, frameCoupling: 0.24,
        },
        material: {
          brightness: 1.62, inharmonicity: 0.74, lossTilt: 0.94,
          frameRatio: 1.08, frameBandwidth: 0.5, contact: 0.62, airResponse: 1.34,
          youngsModulusGPa: 105, densityKgM3: 8_500,
          internalLossFactor: 0.0015, elasticLimitStrain: 0.0035,
        },
      },
    ],
  );
});

test("reference performances are pure, idempotent, bounded, and preserve exact physical state", () => {
  assert.equal(JAW_HARP_STYLE_REFERENCES.length, 16);
  assert.ok(Object.isFrozen(JAW_HARP_STYLE_REFERENCES));
  assert.ok(Object.isFrozen(JAW_HARP_STYLE_GESTURE_KEYS));
  assert.ok(Object.isFrozen(JAW_HARP_STYLE_SETTING_KEYS));
  assert.equal(
    new Set(JAW_HARP_STYLE_REFERENCES.map(({ id }) => id)).size,
    JAW_HARP_STYLE_REFERENCES.length,
  );
  assert.equal(new Set(JAW_HARP_STYLE_SETTING_KEYS).size, JAW_HARP_STYLE_SETTING_KEYS.length);
  assert.deepEqual(
    new Set(JAW_HARP_STYLE_REFERENCES.map(({ recommendedPresetId }) => recommendedPresetId)),
    new Set(JAW_HARP_PRESETS.map(({ id }) => id)),
    "the reference catalog should cover every physical harp body",
  );
  for (const requiredId of [
    "appalachian-corn-shuck",
    "southern-jawharp-blues",
    "double-take-bounce",
    "studio-sproing",
  ]) {
    assert.ok(jawHarpStyle(requiredId), `missing reference performance ${requiredId}`);
  }
  const physicalKeys = [...new Set([
    "presetId",
    ...JAW_HARP_PRESETS.flatMap(({ settings }) => Object.keys(settings)),
    "dryResonance",
    "level",
    "repeat",
  ])];
  const styleKeys = new Set(JAW_HARP_STYLE_SETTING_KEYS);
  const gestureKeys = new Set(JAW_HARP_STYLE_GESTURE_KEYS);
  assert.ok([...gestureKeys].every((key) => styleKeys.has(key)));
  const presetSnapshot = structuredClone(JAW_HARP_PRESETS);
  const presetObjectReferences = JAW_HARP_PRESETS.map(({ settings, material }) => ({
    settings,
    material,
  }));
  assert.ok(physicalKeys.every((key) => !styleKeys.has(key)));
  for (const [styleIndex, style] of JAW_HARP_STYLE_REFERENCES.entries()) {
    assert.equal(jawHarpStyle(style.id), style);
    assert.ok(Object.isFrozen(style));
    assert.ok(Object.isFrozen(style.source));
    assert.ok(Object.isFrozen(style.settings));
    assert.ok(Object.isFrozen(style.gestureSteps));
    assert.ok(style.gestureSteps.every(Object.isFrozen));
    assert.ok(JAW_HARP_PRESETS.some(({ id }) => id === style.recommendedPresetId));
    assert.match(style.source.url, /^https:\/\//);
    assert.ok(style.source.label && style.source.license);
    assert.deepEqual(Object.keys(style.settings).sort(), [...styleKeys].sort());
    assert.ok(Object.keys(style.settings).every((key) => !physicalKeys.includes(key)));
    for (const [key, value] of Object.entries(style.settings)) {
      if (key === "autoBreath" || key === "breathLinked") {
        assert.equal(typeof value, "boolean", `${style.id} ${key} must be boolean`);
      } else if (key === "rhythmId") {
        assert.ok(JAW_HARP_RHYTHMS.some(({ id }) => id === value), `${style.id} has an unknown rhythm`);
      } else if (key === "pluckDirection") {
        assert.ok(value === -1 || value === 1, `${style.id} has an invalid pluck direction`);
      } else if (key === "vowelSequenceId") {
        assert.ok(
          JAW_HARP_VOWEL_SEQUENCES.some(({ id }) => id === value),
          `${style.id} has an unknown vowel phrase`,
        );
      } else if (key === "vowelSequenceMode") {
        assert.ok(
          JAW_HARP_VOWEL_SEQUENCE_MODES.includes(value),
          `${style.id} has an unknown vowel phrase mode`,
        );
      } else {
        assert.ok(Number.isFinite(value), `${style.id} ${key} must be finite`);
        assert.ok(
          value >= JAW_HARP_LIMITS[key][0] && value <= JAW_HARP_LIMITS[key][1],
          `${style.id} ${key} escaped its model limits`,
        );
      }
    }
    for (const [presetIndex, preset] of JAW_HARP_PRESETS.entries()) {
      const original = Object.freeze(jawHarpState(preset.id, {
        reedFrequencyHz: 43 + presetIndex * 23,
        reedDecaySeconds: 0.77 + presetIndex * 1.21,
        reedStiffness: 0.09 + presetIndex * 0.17,
        pluckForce: 0.123 + presetIndex * 0.61,
        pluckPosition: 0.11 + presetIndex * 0.16,
        frameCoupling: 0.13 + presetIndex * 0.14,
        dryResonance: 0.07 + presetIndex * 0.18,
        level: 0.19 + presetIndex * 0.11,
        repeat: presetIndex % 2 === 0,
      }));
      const originalSnapshot = structuredClone(original);
      const styled = applyJawHarpStyle(original, style.id);
      const expected = sanitizeJawHarpState({
        ...original,
        ...style.settings,
        styleId: style.id,
      }, original);
      assert.deepEqual(original, originalSnapshot, `${style.id} mutated its source state`);
      assert.deepEqual(styled, expected, `${style.id} applied keys outside its declared layer`);
      assert.equal(styled.styleId, style.id);
      for (const key of physicalKeys) {
        assert.equal(styled[key], original[key], `${style.id} changed ${preset.id} ${key}`);
      }
      assert.ok(Number.isFinite(effectiveBreathRateBpm(styled)));
      assert.deepEqual(
        applyJawHarpStyle(styled, style.id),
        styled,
        `${style.id} was not idempotent`,
      );
      const nextStyle = JAW_HARP_STYLE_REFERENCES[
        (styleIndex + 1) % JAW_HARP_STYLE_REFERENCES.length
      ];
      assert.deepEqual(
        applyJawHarpStyle(styled, nextStyle.id),
        applyJawHarpStyle(original, nextStyle.id),
        `${style.id} leaked settings into ${nextStyle.id}`,
      );
    }
  }
  const original = jawHarpState("munnharpe", {
    reedFrequencyHz: 147,
    reedDecaySeconds: 6.7,
    reedStiffness: 0.17,
    pluckForce: 3.37,
    pluckPosition: 0.81,
    frameCoupling: 0.23,
    dryResonance: 0.91,
    repeat: true,
    level: 0.27,
  });
  const custom = applyJawHarpStyle(original, "not-a-reference");
  assert.deepEqual(
    custom,
    sanitizeJawHarpState({ ...original, styleId: JAW_HARP_STYLE_CUSTOM_ID }, original),
  );
  assert.deepEqual(JAW_HARP_PRESETS, presetSnapshot);
  for (const [index, preset] of JAW_HARP_PRESETS.entries()) {
    assert.equal(preset.settings, presetObjectReferences[index].settings);
    assert.equal(preset.material, presetObjectReferences[index].material);
  }
  const cartoon = jawHarpStyle(JAW_HARP_DEFAULTS.styleId);
  for (const key of JAW_HARP_STYLE_SETTING_KEYS) {
    assert.equal(JAW_HARP_DEFAULTS[key], cartoon.settings[key], `default ${key} drifted`);
  }
});

test("reference gesture sequences wrap safely and cannot alter physical controls", () => {
  const forbiddenKeys = new Set([
    "presetId",
    ...JAW_HARP_PRESETS.flatMap(({ settings }) => Object.keys(settings)),
    "dryResonance",
    "level",
    "repeat",
    "styleId",
    "vowelId",
    "breathFlow",
  ]);
  const gestureKeys = new Set(JAW_HARP_STYLE_GESTURE_KEYS);
  for (const style of JAW_HARP_STYLE_REFERENCES) {
    const { gestureSteps } = style;
    if (!gestureSteps.length) {
      for (const step of [-3, -1, 0, 1, 20, NaN, Infinity]) {
        assert.equal(jawHarpStyleGesture(style.id, step), null);
      }
      continue;
    }
    assert.equal(jawHarpStyleGesture(style.id, 0), gestureSteps[0]);
    assert.equal(jawHarpStyleGesture(style.id, gestureSteps.length), gestureSteps[0]);
    assert.equal(jawHarpStyleGesture(style.id, -1), gestureSteps.at(-1));
    assert.equal(jawHarpStyleGesture(style.id, gestureSteps.length * 11 + 1), gestureSteps[1 % gestureSteps.length]);
    assert.equal(jawHarpStyleGesture(style.id, -gestureSteps.length * 9 - 1), gestureSteps.at(-1));
    assert.equal(jawHarpStyleGesture(style.id, NaN), gestureSteps[0]);
    assert.equal(jawHarpStyleGesture(style.id, Infinity), gestureSteps[0]);
    for (const gesture of gestureSteps) {
      assert.ok(Object.keys(gesture).length > 0, `${style.id} contains an empty gesture`);
      for (const [key, value] of Object.entries(gesture)) {
        assert.ok(gestureKeys.has(key), `${style.id} gesture used undeclared key ${key}`);
        assert.ok(!forbiddenKeys.has(key), `${style.id} gesture changed protected key ${key}`);
        assert.ok(Number.isFinite(value), `${style.id} gesture ${key} must be finite`);
        assert.ok(
          value >= JAW_HARP_LIMITS[key][0] && value <= JAW_HARP_LIMITS[key][1],
          `${style.id} gesture ${key} escaped its model limits`,
        );
      }
    }
  }
  assert.equal(jawHarpStyleGesture("not-a-reference", 0), null);
});

test("spring steel and bamboo material models preserve their measured contrast", () => {
  const steel = reedMaterialProperties("khomus");
  const bamboo = reedMaterialProperties("kubing");
  assert.equal(steel.youngsModulusPa, 200e9);
  assert.equal(steel.densityKgM3, 7_800);
  assert.equal(bamboo.youngsModulusPa, 10.6e9);
  assert.equal(bamboo.densityKgM3, 630);
  assert.ok(steel.waveSpeedMps > bamboo.waveSpeedMps);
  assert.ok(bamboo.internalLossFactor >= steel.internalLossFactor * 100);
  assert.ok(steel.intrinsicCycleRetention > bamboo.intrinsicCycleRetention);
  assert.ok(jawHarpState("kubing").reedDecaySeconds >= 0.45);
  assert.ok(jawHarpState("kubing").reedDecaySeconds <= 0.75);
});

test("time-expanded tine motion keeps powerful second and third rebounds", () => {
  const steelState = jawHarpState("khomus");
  const bambooState = jawHarpState("kubing");
  const steelPeriod = 1 / tineDisplayFrequencyHz(steelState);
  const bambooPeriod = 1 / tineDisplayFrequencyHz(bambooState);
  const steelPeaks = [0, 1, 2].map((cycle) => Math.abs(
    tineReleaseMotion(steelState, cycle * steelPeriod, 1, 1),
  ));
  const bambooPeaks = [0, 1, 2].map((cycle) => Math.abs(
    tineReleaseMotion(bambooState, cycle * bambooPeriod, 1, 1),
  ));
  assert.ok(steelPeaks[1] > steelPeaks[0] * 0.98);
  assert.ok(steelPeaks[2] > steelPeaks[0] * 0.97);
  assert.ok(bambooPeaks[1] > bambooPeaks[0] * 0.9);
  assert.ok(bambooPeaks[2] > bambooPeaks[0] * 0.88);
  assert.ok(steelPeaks[2] / steelPeaks[0] > bambooPeaks[2] / bambooPeaks[0]);
  assert.ok(Math.abs(tineReleaseMotion(steelState, 8 * steelPeriod, 1, 1)) < steelPeaks[0] * 0.01);
  assert.equal(
    tineReleaseMotion(steelState, 0, 1, -1),
    -tineReleaseMotion(steelState, 0, 1, 1),
  );
  assert.ok(
    Math.abs(tineReleaseMotion(steelState, 0, 4, 1))
      > Math.abs(tineReleaseMotion(steelState, 0, 0.05, 1)) * 8,
  );
});

test("vowel postures move formants without moving the reed fundamental", () => {
  const starting = jawHarpState("khomus");
  const results = VOWEL_PRESETS.map(({ id }) => applyVowel(starting, id));
  assert.deepEqual(
    results.map(({ reedFrequencyHz }) => reedFrequencyHz),
    Array(5).fill(JAW_HARP_DEFAULTS.reedFrequencyHz),
  );
  assert.equal(new Set(results.map((state) => Math.round(mouthFormants(state).focusFrequencyHz))).size, 5);
  assert.ok(dominantHarmonic(results[2]).index > dominantHarmonic(results[4]).index);
});

test("vowel phrase catalog is immutable, complete, and wraps every sequence safely", () => {
  assert.deepEqual(JAW_HARP_VOWEL_SEQUENCE_MODES, ["off", "pluck", "breath"]);
  assert.ok(Object.isFrozen(JAW_HARP_VOWEL_SEQUENCE_MODES));
  assert.equal(JAW_HARP_VOWEL_SEQUENCES.length, 6);
  assert.ok(Object.isFrozen(JAW_HARP_VOWEL_SEQUENCES));
  assert.equal(
    new Set(JAW_HARP_VOWEL_SEQUENCES.map(({ id }) => id)).size,
    JAW_HARP_VOWEL_SEQUENCES.length,
  );
  assert.deepEqual(jawHarpVowelSequence("a-i-o-i").steps, ["a", "i", "o", "i"]);

  const vowelIds = new Set(VOWEL_PRESETS.map(({ id }) => id));
  for (const sequence of JAW_HARP_VOWEL_SEQUENCES) {
    assert.ok(Object.isFrozen(sequence));
    assert.ok(Object.isFrozen(sequence.steps));
    assert.ok(sequence.id && sequence.label && sequence.steps.length >= 2);
    assert.ok(sequence.steps.every((id) => vowelIds.has(id)));
    assert.equal(jawHarpVowelSequence(sequence.id), sequence);
    assert.equal(jawHarpVowelSequenceStep(sequence.id, 0).id, sequence.steps[0]);
    assert.equal(jawHarpVowelSequenceStep(sequence.id, sequence.steps.length).id, sequence.steps[0]);
    assert.equal(jawHarpVowelSequenceStep(sequence.id, -1).id, sequence.steps.at(-1));
    assert.equal(jawHarpVowelSequenceStep(sequence.id, NaN).id, sequence.steps[0]);
    assert.equal(jawHarpVowelSequenceStep(sequence.id, Infinity).id, sequence.steps[0]);
  }
  assert.equal(jawHarpVowelSequence("not-a-phrase"), JAW_HARP_VOWEL_SEQUENCES[0]);
  assert.equal(jawHarpVowelSequenceStep("not-a-phrase", 2).id, "o");

  const sanitized = sanitizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    vowelSequenceId: "not-a-phrase",
    vowelSequenceMode: "not-a-mode",
  });
  assert.equal(sanitized.vowelSequenceId, JAW_HARP_VOWEL_SEQUENCES[0].id);
  assert.equal(sanitized.vowelSequenceMode, "off");
});

test("human vowels and impossible mouth corners remain finite and ordered", () => {
  for (const vowel of VOWEL_PRESETS) {
    const state = applyVowel(JAW_HARP_DEFAULTS, vowel.id);
    const geometry = mouthGeometry(state);
    const formants = mouthFormants(state);
    assert.ok(geometry.lengthM >= 0.085 && geometry.lengthM <= 0.235);
    assert.ok(geometry.volumeMl >= 24 && geometry.volumeMl <= 170);
    assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
    assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
  }
  for (const tonguePosition of JAW_HARP_LIMITS.tonguePosition) {
    for (const tongueHeight of JAW_HARP_LIMITS.tongueHeight) {
      for (const jawOpening of JAW_HARP_LIMITS.jawOpening) {
        for (const lipRounding of JAW_HARP_LIMITS.lipRounding) {
          for (const glottisOpening of JAW_HARP_LIMITS.glottisOpening) {
            const state = sanitizeJawHarpState({
              ...JAW_HARP_DEFAULTS,
              tonguePosition,
              tongueHeight,
              jawOpening,
              lipRounding,
              glottisOpening,
            });
            const geometry = mouthGeometry(state);
            const formants = mouthFormants(state);
            assert.ok(Object.values(geometry).every(Number.isFinite));
            assert.ok([...formants.frequenciesHz, ...formants.bandwidthsHz, formants.focusFrequencyHz]
              .every(Number.isFinite));
            assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
            assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
            assert.ok(formants.focusFrequencyHz >= 30 && formants.focusFrequencyHz <= 9_400);
          }
        }
      }
    }
  }
});

test("reed modes form a slightly stretched harmonic ladder", () => {
  const state = jawHarpState("munnharpe");
  const modes = reedModeFrequencies(state, 24);
  assert.equal(modes.length, 24);
  assert.ok(modes.every((frequency, index) => index === 0 || frequency > modes[index - 1]));
  assert.ok(modes[23] > modes[0] * 24);
});

test("state sanitization and deterministic randomization stay bounded and refresh performance state", () => {
  const unsafe = sanitizeJawHarpState({
    reedFrequencyHz: Infinity,
    tonguePosition: -4,
    tongueHeight: 9,
    repeatRateBpm: 9999,
    breathNoiseAmount: 4,
    breathFilter: 9,
    pluckDirection: -7,
  });
  assert.equal(unsafe.tonguePosition, -2);
  assert.equal(unsafe.tongueHeight, 3);
  assert.equal(unsafe.repeatRateBpm, 480);
  assert.equal(unsafe.breathNoiseAmount, 1);
  assert.equal(unsafe.breathFilter, 1);
  assert.equal(unsafe.pluckDirection, -1);
  const randomized = randomizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    presetId: "khomus",
    vowelId: "a",
    rhythmId: "quarter-eighths",
    repeat: true,
    autoBreath: false,
    breathLinked: true,
    breathsPerLoop: 16,
    pluckDirection: -1,
  }, () => 0.5);
  assert.ok(Math.abs(
    randomized.reedFrequencyHz
      - JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[0]
        * ((JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[1]
          / JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[0]) ** (0.5 ** 1.1)),
  ) < 1e-9);
  assert.ok(Math.abs(randomized.tonguePosition - 0.5) < 1e-12);
  assert.ok(
    randomized.cavityCoupling >= JAW_HARP_RANDOM_LIMITS.cavityCoupling[0]
    && randomized.cavityCoupling <= JAW_HARP_RANDOM_LIMITS.cavityCoupling[1]
  );
  assert.equal(randomized.presetId, "marranzanu");
  assert.equal(randomized.vowelId, "i");
  assert.equal(randomized.vowelSequenceId, "a-o-e-a");
  assert.equal(randomized.vowelSequenceMode, "pluck");
  assert.equal(randomized.rhythmId, "two-one");
  assert.equal(randomized.repeat, false);
  assert.equal(randomized.autoBreath, true);
  assert.equal(randomized.breathLinked, false);
  assert.equal(randomized.breathsPerLoop, 1);
  assert.equal(randomized.pluckDirection, 1);
  assert.equal(randomized.breathFlow, 0);
  assert.equal(randomized.breathNoiseAmount, 0.12 + (0.58 - 0.12) * (0.5 ** 1.35));
  assert.equal(randomized.breathFilter, 0.06 + (0.82 - 0.06) * (0.5 ** 1.45));
});

test("randomization favors playable tempos while preserving rare extremes", () => {
  const tempos = Array.from({ length: 1_000 }, (_, index) => (
    randomizeJawHarpState(JAW_HARP_DEFAULTS, () => (index + 0.5) / 1_000).repeatRateBpm
  ));
  assert.ok(tempos[499] < 90, `median random tempo was ${tempos[499]}`);
  assert.ok(tempos.filter((tempo) => tempo > 320).length < 110);
  assert.ok(tempos.filter((tempo) => tempo > 400).length < 50);
  assert.equal(randomizeJawHarpState(JAW_HARP_DEFAULTS, () => 0).repeatRateBpm, 36);
  assert.equal(randomizeJawHarpState(JAW_HARP_DEFAULTS, () => 1).repeatRateBpm, 480);

  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const states = Array.from(
    { length: 5_000 },
    () => randomizeJawHarpState(JAW_HARP_DEFAULTS, random),
  );
  const repeatShare = states.filter(({ repeat }) => repeat).length / states.length;
  const drillShare = states.filter(({ repeat, repeatRateBpm }) => (
    repeat && repeatRateBpm > 320
  )).length / states.length;
  const denseRhythmShare = states.filter(({ rhythmId }) => rhythmId === "quarter-eighths").length
    / states.length;
  const sequencedVowelShare = states.filter(({ vowelSequenceMode }) => vowelSequenceMode !== "off").length
    / states.length;
  assert.ok(repeatShare > 0.19 && repeatShare < 0.25, `repeat share was ${repeatShare}`);
  assert.ok(drillShare < 0.03, `fast recurring share was ${drillShare}`);
  assert.ok(denseRhythmShare < 0.1, `dense rhythm share was ${denseRhythmShare}`);
  assert.ok(
    sequencedVowelShare > 0.62 && sequencedVowelShare < 0.69,
    `sequenced vowel share was ${sequencedVowelShare}`,
  );
  assert.deepEqual(
    new Set(states.map(({ vowelSequenceId }) => vowelSequenceId)),
    new Set(JAW_HARP_VOWEL_SEQUENCES.map(({ id }) => id)),
  );

  const inside = (value, limits) => value >= limits[0] && value <= limits[1];
  for (const state of states) {
    for (const key of [
      "reedFrequencyHz",
      "reedDecaySeconds",
      "reedStiffness",
      "pluckForce",
      "pluckPosition",
      "cavityCoupling",
      "frameCoupling",
      "breathDepth",
      "breathNoiseAmount",
      "breathRateBpm",
      "breathBalance",
      "formantFocus",
    ]) assert.ok(inside(state[key], JAW_HARP_RANDOM_LIMITS[key]), `${key} escaped its playable random window`);
    for (const key of ["tonguePosition", "tongueHeight", "jawOpening", "lipRounding"]) {
      assert.ok(inside(state[key], JAW_HARP_RANDOM_LIMITS.mouthArticulation));
    }
    assert.ok(inside(state.glottisOpening, JAW_HARP_RANDOM_LIMITS.glottisOpening));
    assert.ok(JAW_HARP_VOWEL_SEQUENCES.some(({ id }) => id === state.vowelSequenceId));
    assert.ok(JAW_HARP_VOWEL_SEQUENCE_MODES.includes(state.vowelSequenceMode));
    assert.ok(state.autoBreath || state.vowelSequenceMode !== "breath");
    assert.ok(inside(
      state.dryResonance,
      state.autoBreath
        ? JAW_HARP_RANDOM_LIMITS.dryResonance
        : JAW_HARP_RANDOM_LIMITS.dryResonanceWithoutBreath,
    ));
    if (state.breathLinked) {
      assert.ok(inside(
        effectiveBreathRateBpm(state),
        JAW_HARP_RANDOM_LIMITS.effectiveBreathRateBpm,
      ));
    }
  }
});

test("pull distance maps symmetrically across a much wider attack range", () => {
  const pulls = [0.02, 0.08, 0.25, 0.7, 1.4, MAX_TINE_PULL];
  const forces = pulls.map((pull) => pluckForceFromPull(pull, 0.72));
  assert.ok(forces.every((force, index) => index === 0 || force > forces[index - 1]));
  assert.equal(pluckForceFromPull(0), 0);
  assert.equal(pluckForceFromPull(-1.4, 0.72), pluckForceFromPull(1.4, 0.72));
  assert.ok(forces[0] < 0.01);
  assert.ok(forces.at(-1) > 1.8);
  assert.ok(pluckForceFromPull(MAX_TINE_PULL, 4) > 3.9);
});

test("natural tine strikes are deterministic, velocity-sensitive released pulls", () => {
  const source = jawHarpState("khomus", {
    pluckForce: 1.2,
    pluckDirection: -1,
    pluckPosition: 0.31,
  });
  const draws = [0, 0.5, 1];
  let drawIndex = 0;
  const centered = naturalTineStrike(source, {}, () => draws[drawIndex++]);
  assert.equal(drawIndex, 3);
  assert.ok(Object.isFrozen(centered));
  assert.ok(Math.abs(centered.pull - 1.135) < 1e-12);
  assert.equal(centered.force, pluckForceFromPull(centered.pull, source.pluckForce));
  assert.equal(centered.direction, -1);
  assert.equal(centered.position, 0.31);

  const quiet = naturalTineStrike(source, { velocity: 0 }, () => 0);
  const ordinary = naturalTineStrike(source, { velocity: 1 }, () => 0);
  const emphatic = naturalTineStrike(source, { velocity: 1 }, () => 1);
  assert.ok(quiet.pull < ordinary.pull && ordinary.pull < emphatic.pull);
  assert.ok(quiet.force < ordinary.force && ordinary.force < emphatic.force);
  assert.ok(quiet.force >= JAW_HARP_LIMITS.pluckForce[0]);
  assert.ok(emphatic.force <= JAW_HARP_LIMITS.pluckForce[1]);
  assert.deepEqual(
    naturalTineStrike(source, { direction: 9, position: 99 }, () => Infinity),
    Object.freeze({
      pull: 1.135,
      force: pluckForceFromPull(1.135, source.pluckForce),
      direction: 1,
      position: JAW_HARP_LIMITS.pluckPosition[1],
    }),
  );
});

test("swing preserves each two-pluck pair duration", () => {
  const straight = repeatIntervalMs(120, 0, 0);
  const long = repeatIntervalMs(120, 0, 0.3);
  const short = repeatIntervalMs(120, 1, 0.3);
  assert.equal(straight, 500);
  assert.ok(long > straight);
  assert.ok(short < straight);
  assert.ok(Math.abs(long + short - straight * 2) < 1e-9);
});

test("jaw-harp repeats use accented loops and phase-linked breath ratios", () => {
  assert.equal(JAW_HARP_RHYTHMS.length, 6);
  assert.deepEqual(JAW_HARP_RHYTHMS[0].steps, [1, 0, 0.82, 0.72]);
  const state = jawHarpState("khomus", {
    rhythmId: "quarter-eighths",
    repeatRateBpm: 120,
    breathsPerLoop: 1,
  });
  assert.equal(jawHarpRhythmLoopMs(state), 1_000);
  assert.equal(linkedBreathIntervalMs(state), 1_000);
  assert.equal(linkedBreathIntervalMs({ ...state, breathsPerLoop: 2 }), 500);
  assert.deepEqual(jawHarpRhythmHit(state, 0), { index: 0, velocity: 1, active: true });
  assert.deepEqual(jawHarpRhythmHit(state, 1), { index: 1, velocity: 0, active: false });
  assert.ok(Math.abs(effectiveBreathRateBpm(state) - 60) < 1e-9);
  assert.ok(Math.abs(effectiveBreathRateBpm({ ...state, breathRateBpm: 84 }) - 120) < 1e-9);
  assert.equal(effectiveBreathRateBpm({ ...state, breathLinked: false, breathRateBpm: 84 }), 84);
});

test("automatic breath is a bounded signed inhale-exhale cycle", () => {
  const state = sanitizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    breathDepth: 0.8,
    breathBalance: 0.4,
    breathRateBpm: 30,
  });
  assert.equal(breathCycleIntervalMs(state.breathRateBpm), 2_000);
  assert.ok(breathCycleFlow(state, 0.2) < -0.79);
  assert.ok(breathCycleFlow(state, 0.7) > 0.79);
  assert.ok(Math.abs(breathCycleFlow(state, 0)) < 1e-12);
  assert.ok(Math.abs(breathCycleFlow(state, 1)) < 1e-12);
  assert.ok(Math.abs(breathCycleFlow(state, -0.3)) <= state.breathDepth);
  assert.equal(breathCycleIntervalMs(JAW_HARP_LIMITS.breathRateBpm[1]), 50);
  const extreme = sanitizeJawHarpState({
    ...state,
    breathDepth: 3,
    breathBalance: 0.02,
    breathRateBpm: 1_200,
  });
  assert.ok(breathCycleFlow(extreme, 0.01) < -2.99);
  assert.ok(breathCycleFlow(extreme, 0.51) > 2.99);
});

test("breath vowel sequencing counts every inhale and exhale boundary", () => {
  assert.equal(breathLobeBoundaryCount(0, 0.39, 0.4), 0);
  assert.equal(breathLobeBoundaryCount(0, 0.4, 0.4), 1);
  assert.equal(breathLobeBoundaryCount(0, 1, 0.4), 2);
  assert.equal(breathLobeBoundaryCount(0.35, 0.1, 0.4), 1);
  assert.equal(breathLobeBoundaryCount(0.9, 0.2, 0.4), 1);
  assert.equal(breathLobeBoundaryCount(0.35, 1.2, 0.4), 3);
  assert.equal(breathLobeBoundaryCount(0.2, 3.7, 0.46), 7);
  assert.equal(breathLobeBoundaryCount(-0.1, 0.2, 0.4), 1);
  assert.equal(breathLobeBoundaryCount(0.4, 0, 0.4), 0);
  assert.equal(breathLobeBoundaryCount(0.2, -2, 0.4), 0);
  assert.equal(breathLobeBoundaryCount(0.99, 4.75, 0.4), 10);
});

test("jaw-harp worklet renders a bounded, decaying pluck", async () => {
  const previousRate = globalThis.sampleRate;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  let telemetry;
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage: (message) => { telemetry = message; } };
    }
  };
  globalThis.registerProcessor = (name, Constructor) => {
    assert.equal(name, "jaw-harp-physical-model");
    Processor = Constructor;
  };
  try {
    const { breathDirection, breathTextureGain, fastSine } = await import(
      `../src/jaw-harp-processor.js?test=${Date.now()}`
    );
    assert.equal(breathDirection(0), 0);
    assert.ok(breathDirection(-0.2) < -0.99);
    assert.ok(breathDirection(0.2) > 0.99);
    for (const boundary of [-0.015, 0, 0.015]) {
      assert.ok(
        Math.abs(breathDirection(boundary + 1e-6) - breathDirection(boundary - 1e-6)) < 0.00004,
        `breath direction retained a hard switch near ${boundary}`,
      );
    }
    assert.equal(breathTextureGain(0), 0);
    assert.equal(breathTextureGain(0.01), 0);
    assert.equal(breathTextureGain(0.018), 0);
    assert.ok(breathTextureGain(0.05) < 0.005);
    assert.ok(breathTextureGain(0.1) < 0.025);
    assert.ok(breathTextureGain(0.32) > breathTextureGain(0.1) * 8);
    assert.equal(breathTextureGain(1), 1);
    const breathTextureCurve = Array.from(
      { length: 101 },
      (_, index) => breathTextureGain(index / 100),
    );
    assert.ok(breathTextureCurve.every(
      (gain, index) => index === 0 || gain >= breathTextureCurve[index - 1],
    ));
    let maximumSineError = 0;
    for (let index = -8_192; index <= 16_384; index += 1) {
      const phase = (index + 0.371) * Math.PI / 4_096;
      maximumSineError = Math.max(maximumSineError, Math.abs(fastSine(phase) - Math.sin(phase)));
    }
    assert.ok(maximumSineError < 1e-7, `sine-table error was ${maximumSineError}`);
    const processor = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
    processor._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
    let squareSum = 0;
    let peak = 0;
    for (let block = 0; block < 200; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (const sample of left) {
        squareSum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    const rms = Math.sqrt(squareSum / (200 * 128));
    assert.ok(rms > 0.0002 && rms < 0.4);
    assert.ok(peak > 0.001 && peak < 0.95);
    assert.equal(telemetry.type, "telemetry");
    assert.ok(telemetry.energy > 0);

    const renderBreath = (flow) => {
      const voiced = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
      voiced._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      voiced._handleMessage({ type: "breath", flow });
      let lateSquareSum = 0;
      let lateSamples = 0;
      let latePeak = 0;
      for (let block = 0; block < 700; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        voiced.process([], [[left, right]]);
        if (block < 500) continue;
        for (const sample of left) {
          lateSquareSum += sample * sample;
          latePeak = Math.max(latePeak, Math.abs(sample));
          lateSamples += 1;
        }
      }
      return { rms: Math.sqrt(lateSquareSum / lateSamples), peak: latePeak };
    };
    const unbreathed = renderBreath(0);
    const inhaled = renderBreath(-0.78);
    const exhaled = renderBreath(0.78);
    assert.ok(inhaled.rms > unbreathed.rms * 2);
    assert.ok(exhaled.rms > unbreathed.rms * 2);
    assert.ok(
      Math.abs(exhaled.rms - inhaled.rms) > 0.001,
      `inhale/exhale level distinction collapsed (${inhaled.rms}, ${exhaled.rms})`,
    );
    assert.ok(inhaled.peak < 0.98 && exhaled.peak < 0.98);

    const renderVoice = (configuration, {
      force = 0.72,
      flow = 0.9,
      blocks = 90,
    } = {}) => {
      const voice = new Processor({
        processorOptions: {
          configuration: sanitizeJawHarpState({
            ...JAW_HARP_DEFAULTS,
            autoBreath: false,
            ...configuration,
          }),
        },
      });
      voice._handleMessage({ type: "breath", flow, manual: true });
      voice._handleMessage({ type: "pluck", force, direction: 1, position: 0.32 });
      return renderProcessor(voice, blocks);
    };
    const renderProcessor = (voice, blocks = 90) => {
      const rendered = new Float32Array(blocks * 128);
      let offset = 0;
      for (let block = 0; block < blocks; block += 1) {
        const left = rendered.subarray(offset, offset + 128);
        const right = new Float32Array(128);
        voice.process([], [[left, right]]);
        offset += 128;
      }
      return rendered;
    };
    const normalizedDifference = (left, right) => {
      let delta = 0;
      let energy = 0;
      for (let index = 0; index < left.length; index += 1) {
        delta += (left[index] - right[index]) ** 2;
        energy += left[index] ** 2 + right[index] ** 2;
      }
      return Math.sqrt(delta / Math.max(1e-12, energy));
    };
    const rmsOf = (samples, length = samples.length) => {
      let energy = 0;
      for (let index = 0; index < length; index += 1) energy += samples[index] ** 2;
      return Math.sqrt(energy / Math.max(1, length));
    };
    const windowRms = (samples, start, end) => {
      let energy = 0;
      for (let index = start; index < end; index += 1) energy += samples[index] ** 2;
      return Math.sqrt(energy / Math.max(1, end - start));
    };
    const modalEnergy = (voice) => voice.amplitudes.reduce(
      (sum, amplitude) => sum + amplitude * amplitude,
      0,
    );

    const turbulenceVoice = (breathNoiseAmount, breathFilter = 0.36) => {
      const voice = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
        breathNoiseAmount,
        breathFilter,
      } } });
      voice._handleMessage({ type: "breath", flow: 1, manual: true });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      return voice;
    };
    const cleanBreathVoice = turbulenceVoice(0);
    const texturedBreathVoice = turbulenceVoice(1);
    assert.deepEqual(
      Array.from(texturedBreathVoice.amplitudes),
      Array.from(cleanBreathVoice.amplitudes),
      "breath texture must not alter the pluck excitation",
    );
    const turbulence = new Float64Array(8_192);
    let turbulenceSquareSum = 0;
    let differenceSquareSum = 0;
    let turbulenceMean = 0;
    let coherentAirDifference = 0;
    let coherentAirEnergy = 0;
    for (let index = 0; index < turbulence.length; index += 1) {
      const cleanSource = cleanBreathVoice._renderSource();
      const texturedSource = texturedBreathVoice._renderSource();
      coherentAirDifference += (texturedSource - cleanSource) ** 2;
      coherentAirEnergy += cleanSource ** 2 + texturedSource ** 2;
      const sample = texturedBreathVoice.breathTexture;
      turbulence[index] = sample;
      turbulenceSquareSum += sample * sample;
      turbulenceMean += sample;
      if (index > 0) differenceSquareSum += (sample - turbulence[index - 1]) ** 2;
    }
    const turbulenceRms = Math.sqrt(turbulenceSquareSum / turbulence.length);
    const turbulenceDifferenceRms = Math.sqrt(
      differenceSquareSum / (turbulence.length - 1),
    );
    assert.ok(turbulence.every(Number.isFinite));
    assert.ok(
      Math.sqrt(coherentAirDifference / Math.max(1e-12, coherentAirEnergy)) > 0.005,
      "breath amount must also soften or open the coherent aerodynamic reed drive",
    );
    assert.ok(turbulenceRms > 0.005, `breath texture RMS was ${turbulenceRms}`);
    assert.ok(
      turbulenceDifferenceRms / turbulenceRms < 0.65,
      "breath texture retained too much sample-to-sample white-noise edge",
    );
    assert.ok(
      Math.abs(turbulenceMean / turbulence.length) < turbulenceRms * 0.08,
      "breath texture accumulated a low-frequency pressure offset",
    );

    const quietTextureVoice = turbulenceVoice(0.03);
    let quietTextureSquareSum = 0;
    for (let index = 0; index < turbulence.length; index += 1) {
      quietTextureVoice._renderSource();
      quietTextureSquareSum += quietTextureVoice.breathTexture ** 2;
    }
    const quietTextureRms = Math.sqrt(quietTextureSquareSum / turbulence.length);
    assert.ok(
      quietTextureRms < turbulenceRms * 0.002,
      `the low-end breath setting was not effectively clean (${quietTextureRms})`,
    );

    const textureEdgeRatio = (breathFilter) => {
      const voice = turbulenceVoice(1, breathFilter);
      let sum = 0;
      let difference = 0;
      let previous = 0;
      for (let index = 0; index < turbulence.length; index += 1) {
        voice._renderSource();
        const sample = voice.breathTexture;
        sum += sample * sample;
        if (index > 0) difference += (sample - previous) ** 2;
        previous = sample;
      }
      return Math.sqrt(difference / (turbulence.length - 1))
        / Math.sqrt(sum / turbulence.length);
    };
    const darkTextureEdge = textureEdgeRatio(0);
    const neutralTextureEdge = textureEdgeRatio(0.5);
    const openTextureEdge = textureEdgeRatio(1);
    assert.ok(
      darkTextureEdge < neutralTextureEdge && neutralTextureEdge < openTextureEdge,
      "the breath filter must get progressively brighter across its range",
    );
    assert.ok(
      openTextureEdge > darkTextureEdge * 2.5,
      "the breath filter must span distinctly dark and open turbulence",
    );
    assert.ok(openTextureEdge < 1, "even fully open breath must remain colored, not white");

    const adjacentDifferenceRatio = (samples) => {
      let energy = 0;
      let difference = 0;
      for (let index = 0; index < samples.length; index += 1) {
        energy += samples[index] ** 2;
        if (index > 0) difference += (samples[index] - samples[index - 1]) ** 2;
      }
      return Math.sqrt(difference / Math.max(1, samples.length - 1))
        / Math.sqrt(energy / Math.max(1, samples.length));
    };
    const coherentAirFftSize = 8_192;
    const coherentAirHann = Float64Array.from(
      { length: coherentAirFftSize },
      (_, index) => 0.5 - 0.5 * Math.cos(
        2 * Math.PI * index / coherentAirFftSize,
      ),
    );
    const coherentAirPowerSpectrum = (samples, offset) => {
      const real = new Float64Array(coherentAirFftSize);
      const imaginary = new Float64Array(coherentAirFftSize);
      for (let index = 0; index < coherentAirFftSize; index += 1) {
        real[index] = samples[offset + index] * coherentAirHann[index];
      }
      for (let index = 1, reversed = 0; index < coherentAirFftSize; index += 1) {
        let bit = coherentAirFftSize >> 1;
        while (reversed & bit) {
          reversed ^= bit;
          bit >>= 1;
        }
        reversed ^= bit;
        if (index >= reversed) continue;
        [real[index], real[reversed]] = [real[reversed], real[index]];
        [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
      }
      for (let span = 2; span <= coherentAirFftSize; span <<= 1) {
        const half = span >> 1;
        const stepReal = Math.cos(-2 * Math.PI / span);
        const stepImaginary = Math.sin(-2 * Math.PI / span);
        for (let start = 0; start < coherentAirFftSize; start += span) {
          let twiddleReal = 1;
          let twiddleImaginary = 0;
          for (let index = 0; index < half; index += 1) {
            const even = start + index;
            const odd = even + half;
            const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
            const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
            real[odd] = real[even] - oddReal;
            imaginary[odd] = imaginary[even] - oddImaginary;
            real[even] += oddReal;
            imaginary[even] += oddImaginary;
            const nextTwiddleReal = twiddleReal * stepReal
              - twiddleImaginary * stepImaginary;
            twiddleImaginary = twiddleReal * stepImaginary
              + twiddleImaginary * stepReal;
            twiddleReal = nextTwiddleReal;
          }
        }
      }
      return Float64Array.from(
        { length: coherentAirFftSize / 2 + 1 },
        (_, bin) => {
          const power = real[bin] ** 2 + imaginary[bin] ** 2;
          return bin > 0 && bin < coherentAirFftSize / 2 ? power * 2 : power;
        },
      );
    };
    const coherentAirSpectrum = (samples) => {
      const windowCount = 4;
      assert.equal(samples.length, coherentAirFftSize * windowCount);
      const firstBin = (frequency) => Math.ceil(
        frequency * coherentAirFftSize / globalThis.sampleRate,
      );
      const lastBin = (frequency) => Math.floor(
        frequency * coherentAirFftSize / globalThis.sampleRate,
      );
      const sixKhzBin = firstBin(6_000);
      const tenKhzBin = firstBin(10_000);
      const twentyKhzBin = lastBin(20_000);
      const maxima = {
        tenToTwentyPowerShare: 0,
        sixToTwentyPowerShare: 0,
        sixToTwentyFlatness: 0,
      };
      const windows = [];
      for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
        const powers = coherentAirPowerSpectrum(
          samples,
          windowIndex * coherentAirFftSize,
        );
        let totalPower = 0;
        let sixToTwentyPower = 0;
        let tenToTwentyPower = 0;
        let sixToTwentyLogPower = 0;
        let sixToTwentyBinCount = 0;
        for (let bin = 0; bin < powers.length; bin += 1) {
          const power = powers[bin];
          totalPower += power;
          if (bin < sixKhzBin || bin > twentyKhzBin) continue;
          sixToTwentyPower += power;
          sixToTwentyLogPower += Math.log(Math.max(1e-300, power));
          sixToTwentyBinCount += 1;
          if (bin >= tenKhzBin) tenToTwentyPower += power;
        }
        assert.ok(totalPower > 0);
        const sixToTwentyMeanPower = sixToTwentyPower / sixToTwentyBinCount;
        const metrics = {
          tenToTwentyPowerShare: tenToTwentyPower / totalPower,
          sixToTwentyPowerShare: sixToTwentyPower / totalPower,
          sixToTwentyFlatness: Math.exp(
            sixToTwentyLogPower / sixToTwentyBinCount,
          ) / Math.max(1e-300, sixToTwentyMeanPower),
        };
        windows.push(metrics);
        maxima.tenToTwentyPowerShare = Math.max(
          maxima.tenToTwentyPowerShare,
          metrics.tenToTwentyPowerShare,
        );
        maxima.sixToTwentyPowerShare = Math.max(
          maxima.sixToTwentyPowerShare,
          metrics.sixToTwentyPowerShare,
        );
        maxima.sixToTwentyFlatness = Math.max(
          maxima.sixToTwentyFlatness,
          metrics.sixToTwentyFlatness,
        );
      }
      return { ...maxima, windows };
    };
    const prepareIsolatedAir = (configuration = {}, flow = 0.72) => {
      const voice = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
        breathNoiseAmount: 0,
        ...configuration,
      } } });
      voice._handleMessage({ type: "breath", flow, manual: true });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      renderProcessor(voice, 180);
      voice.amplitudes.fill(0);
      voice.clickEnvelope = 0;
      voice.attackEnvelope = 0;
      voice.strikePresence = 0;
      voice.energy = 0;
      voice.sourceDc = 0;
      voice._resetFilters();
      renderProcessor(voice, 80);
      return voice;
    };
    const renderIsolatedAir = (configuration, flow = 0.72) => {
      const voice = prepareIsolatedAir(configuration, flow);
      const samples = renderProcessor(voice, 256);
      return {
        samples,
        rms: rmsOf(samples),
        edge: adjacentDifferenceRatio(samples),
      };
    };
    const coherentAirCases = [
      ["inhale", -0.72],
      ["exhale", 0.72],
    ].flatMap(([direction, flow]) => [0, 0.5, 1].map((breathFilter) => {
      const air = renderIsolatedAir({ breathFilter }, flow);
      return {
        direction,
        breathFilter,
        air,
        spectrum: coherentAirSpectrum(air.samples),
      };
    }));
    const exhaledAir = (breathFilter) => coherentAirCases.find(
      (entry) => entry.direction === "exhale" && entry.breathFilter === breathFilter,
    ).air;
    const darkAir = exhaledAir(0);
    const neutralAir = exhaledAir(0.5);
    const openAir = exhaledAir(1);
    assert.ok(coherentAirCases.every(({ air }) => air.samples.every(Number.isFinite)));
    assert.ok(
      normalizedDifference(darkAir.samples, openAir.samples) > 0.18,
      "the breath filter must color the complete noise-free aerodynamic path",
    );
    assert.ok(
      darkAir.edge < neutralAir.edge && neutralAir.edge < openAir.edge,
      `noise-free air edge did not open monotonically (${darkAir.edge}, ${neutralAir.edge}, ${openAir.edge})`,
    );
    assert.ok(
      darkAir.edge < openAir.edge * 0.75,
      "the dark breath setting retained too much of the open setting's upper-mode edge",
    );
    assert.ok(
      darkAir.rms > openAir.rms * 0.12 && openAir.rms > darkAir.rms * 0.12,
      "breath color must not pass merely by muting either endpoint",
    );
    const maximumCoherentAirSpectrum = coherentAirCases.reduce((maximum, entry) => ({
      tenToTwentyPowerShare: Math.max(
        maximum.tenToTwentyPowerShare,
        entry.spectrum.tenToTwentyPowerShare,
      ),
      sixToTwentyPowerShare: Math.max(
        maximum.sixToTwentyPowerShare,
        entry.spectrum.sixToTwentyPowerShare,
      ),
      sixToTwentyFlatness: Math.max(
        maximum.sixToTwentyFlatness,
        entry.spectrum.sixToTwentyFlatness,
      ),
    }), {
      tenToTwentyPowerShare: 0,
      sixToTwentyPowerShare: 0,
      sixToTwentyFlatness: 0,
    });
    const coherentAirSpectrumReport = coherentAirCases.map((entry) => ({
      direction: entry.direction,
      breathFilter: entry.breathFilter,
      ...entry.spectrum,
    }));
    assert.ok(
      maximumCoherentAirSpectrum.tenToTwentyPowerShare < 1e-7,
      `noise-free air retained a 10–20 kHz haze (${JSON.stringify(coherentAirSpectrumReport)})`,
    );
    assert.ok(
      maximumCoherentAirSpectrum.sixToTwentyPowerShare < 1e-3,
      `noise-free air retained excessive 6–20 kHz power (${JSON.stringify(coherentAirSpectrumReport)})`,
    );
    assert.ok(
      maximumCoherentAirSpectrum.sixToTwentyFlatness < 1e-5,
      `noise-free air became spectrally flat above 6 kHz (${JSON.stringify(coherentAirSpectrumReport)})`,
    );

    const oneSampleOutput = () => [[new Float32Array(1), new Float32Array(1)]];
    const processOneSample = (voice, output) => {
      assert.equal(voice.process([], output), true);
      return Math.max(
        Math.abs(voice.lastFinalDriveLeft),
        Math.abs(voice.lastFinalDriveRight),
      );
    };
    const driveVoice = prepareIsolatedAir({ breathFilter: JAW_HARP_DEFAULTS.breathFilter });
    const driveOutput = oneSampleOutput();
    let reedAboveHalf = 0;
    let reedAboveOne = 0;
    let finalAboveOne = 0;
    const driveSamples = 8_192;
    for (let index = 0; index < driveSamples; index += 1) {
      const finalDrive = processOneSample(driveVoice, driveOutput);
      if (Math.abs(driveVoice.lastReedDrive) > 0.5) reedAboveHalf += 1;
      if (Math.abs(driveVoice.lastReedDrive) > 1) reedAboveOne += 1;
      if (finalDrive > 1) finalAboveOne += 1;
    }
    assert.ok(
      reedAboveHalf / driveSamples < 0.08,
      `default breath lived in the reed saturator (${reedAboveHalf / driveSamples})`,
    );
    assert.ok(
      reedAboveOne / driveSamples < 0.01,
      `default breath severely saturated the reed (${reedAboveOne / driveSamples})`,
    );
    assert.ok(
      finalAboveOne / driveSamples < 0.02,
      `default breath lived in the final limiter (${finalAboveOne / driveSamples})`,
    );
    const fullVoiceDriveDuty = (flow, configuration = {}) => {
      const voice = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
        breathNoiseAmount: 0,
        ...configuration,
      } } });
      voice._handleMessage({ type: "breath", flow, manual: true });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      renderProcessor(voice, 500);
      let aboveHalf = 0;
      let aboveOne = 0;
      let aboveTwo = 0;
      let finalAboveOne = 0;
      let finalAboveTwo = 0;
      const output = oneSampleOutput();
      for (let index = 0; index < driveSamples; index += 1) {
        const finalDrive = processOneSample(voice, output);
        const magnitude = Math.abs(voice.lastReedDrive);
        if (magnitude > 0.5) aboveHalf += 1;
        if (magnitude > 1) aboveOne += 1;
        if (magnitude > 2) aboveTwo += 1;
        if (finalDrive > 1) finalAboveOne += 1;
        if (finalDrive > 2) finalAboveTwo += 1;
      }
      return {
        aboveHalf: aboveHalf / driveSamples,
        aboveOne: aboveOne / driveSamples,
        aboveTwo: aboveTwo / driveSamples,
        finalAboveOne: finalAboveOne / driveSamples,
        finalAboveTwo: finalAboveTwo / driveSamples,
      };
    };
    const fullVoiceDrive = {
      unbreathed: fullVoiceDriveDuty(0),
      exhale: fullVoiceDriveDuty(0.72),
      inhale: fullVoiceDriveDuty(-0.72),
    };
    assert.ok(
      fullVoiceDrive.unbreathed.aboveOne < 0.08,
      `unbreathed sustain over-drove the reed (${fullVoiceDrive.unbreathed.aboveOne})`,
    );
    for (const direction of ["inhale", "exhale"]) {
      assert.ok(
        fullVoiceDrive[direction].aboveOne < 0.2,
        `${direction} sustain lived in the reed saturator (${fullVoiceDrive[direction].aboveOne})`,
      );
      assert.ok(
        fullVoiceDrive[direction].aboveTwo < 0.005,
        `${direction} sustain severely over-drove the reed (${fullVoiceDrive[direction].aboveTwo})`,
      );
      assert.ok(
        fullVoiceDrive[direction].finalAboveOne < 0.02,
        `${direction} sustain lived in the final limiter (${fullVoiceDrive[direction].finalAboveOne})`,
      );
    }
    for (const flow of [-3, 3]) {
      const maximumPressureDrive = fullVoiceDriveDuty(flow, {
        breathNoiseAmount: 1,
        breathFilter: 1,
      });
      assert.ok(
        maximumPressureDrive.finalAboveOne < 0.05,
        `maximum legal flow ${flow} lived in the final limiter (${maximumPressureDrive.finalAboveOne})`,
      );
      assert.ok(
        maximumPressureDrive.finalAboveTwo < 0.005,
        `maximum legal flow ${flow} severely over-drove the final limiter (${maximumPressureDrive.finalAboveTwo})`,
      );
    }

    const renderIsolatedClick = (frameCoupling, muteFrame = false) => {
      const voice = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
        breathNoiseAmount: 0,
        frameCoupling,
      } } });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      voice.amplitudes.fill(0);
      voice.attackEnvelope = 0;
      voice.strikePresence = 0;
      voice.energy = 0;
      if (muteFrame) voice.frameFilterLeft.process = () => 0;
      const samples = new Float64Array(2_400);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = voice._radiate(voice._renderSource(), -1);
      }
      return samples;
    };
    const framelessClick = renderIsolatedClick(0);
    const coupledClick = renderIsolatedClick(1);
    const frameMutedClick = renderIsolatedClick(1, true);
    const coupledClickEarly = windowRms(coupledClick, 0, 240);
    const coupledClickTail = windowRms(coupledClick, 1_200, 2_400);
    assert.ok(coupledClickEarly > 0.0005, "frame coupling must retain a clear contact snap");
    assert.ok(
      rmsOf(framelessClick) < rmsOf(coupledClick) * 1e-6,
      "random contact noise leaked around the frame coupling control",
    );
    assert.ok(
      rmsOf(frameMutedClick) < rmsOf(coupledClick) * 1e-6,
      "random contact noise leaked through the mouth instead of the frame path",
    );
    assert.ok(
      coupledClickTail < coupledClickEarly * 0.1,
      "the contact-noise tail outlasted the short tine strike",
    );
    assert.ok(
      adjacentDifferenceRatio(coupledClick) < 0.75,
      "the contact snap retained a white-noise sample edge",
    );
    const framelessMechanicalAttack = renderVoice({
      autoBreath: false,
      breathNoiseAmount: 0,
      frameCoupling: 0,
    }, { flow: 0, blocks: 4 });
    assert.ok(
      rmsOf(framelessMechanicalAttack) > 0.001,
      "zero frame coupling must preserve the deterministic tine attack",
    );

    const handoffVoice = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: true,
      breathLinked: false,
      breathDepth: 0.72,
      breathRateBpm: 1,
      breathBalance: 0.5,
      breathNoiseAmount: 0,
    } } });
    handoffVoice._handleMessage({ type: "breath", flow: 0.72, manual: true });
    handoffVoice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
    for (let index = 0; index < 4_000; index += 1) handoffVoice._renderSource();
    handoffVoice.breathPhase = 0.25;
    const flowBeforeHandoff = handoffVoice.breathFlow;
    const automaticTarget = -0.72;
    handoffVoice._handleMessage({ type: "breath", manual: false });
    handoffVoice._renderSource();
    const handoffFirstStep = Math.abs(handoffVoice.breathFlow - flowBeforeHandoff);
    assert.ok(
      handoffFirstStep < Math.abs(automaticTarget - flowBeforeHandoff) * 0.01,
      "manual-to-automatic breath jumped instead of slewing",
    );
    for (let index = 0; index < 2_400; index += 1) handoffVoice._renderSource();
    assert.ok(handoffVoice.breathFlow < -0.68, "breath handoff did not settle promptly");

    const stoppingBreath = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: true,
      breathLinked: false,
      breathDepth: 0.72,
      breathRateBpm: 1,
      breathNoiseAmount: 0,
    } } });
    stoppingBreath.breathPhase = 0.75;
    stoppingBreath._renderSource();
    const flowBeforeStop = stoppingBreath.breathFlow;
    stoppingBreath._handleMessage({ type: "configure", configuration: { autoBreath: false } });
    stoppingBreath.process([], [[new Float32Array(1), new Float32Array(1)]]);
    assert.ok(
      Math.abs(stoppingBreath.breathFlow - flowBeforeStop) < Math.abs(flowBeforeStop) * 0.01,
      "automatic breath shutdown bypassed the smooth handoff",
    );
    while (stoppingBreath.breathHandoffSamplesRemaining > 0) stoppingBreath._renderSource();
    assert.ok(Math.abs(stoppingBreath.breathFlow) < 1e-12);
    stoppingBreath._renderSource();
    assert.equal(stoppingBreath.breathFlow, 0);

    for (const breathBalance of [0.02, 0.5, 0.98]) {
      for (const startPhase of [0, 0.19, 0.43, 0.71]) {
        const maximumRateConfiguration = {
          ...JAW_HARP_DEFAULTS,
          autoBreath: true,
          breathLinked: true,
          repeatRateBpm: 480,
          breathsPerLoop: 16,
          breathDepth: 3,
          breathRateBpm: JAW_HARP_LIMITS.breathRateBpm[1],
          breathBalance,
          breathNoiseAmount: 0,
        };
        assert.equal(effectiveBreathRateBpm(maximumRateConfiguration), 7_200);
        const transitioning = new Processor({
          processorOptions: { configuration: maximumRateConfiguration },
        });
        transitioning._handleMessage({ type: "breath", flow: 3, manual: true });
        for (let index = 0; index < 512; index += 1) transitioning._renderSource();
        transitioning.breathPhase = startPhase;
        const automaticReference = new Processor({
          processorOptions: { configuration: maximumRateConfiguration },
        });
        automaticReference.breathPhase = startPhase;
        transitioning._handleMessage({ type: "breath", manual: false });
        for (let index = 0; index < transitioning.breathHandoffTotalSamples; index += 1) {
          transitioning._renderSource();
          automaticReference._renderSource();
        }
        assert.equal(transitioning.breathHandoffSamplesRemaining, 0);
        assert.ok(
          Math.abs(transitioning.breathFlow - automaticReference.breathFlow) < 1e-9,
          `maximum-rate handoff missed its endpoint (${breathBalance}, ${startPhase})`,
        );
        const transitionBefore = transitioning.breathFlow;
        const referenceBefore = automaticReference.breathFlow;
        transitioning._renderSource();
        automaticReference._renderSource();
        const transitionStep = transitioning.breathFlow - transitionBefore;
        const referenceStep = automaticReference.breathFlow - referenceBefore;
        assert.ok(
          Math.abs(transitionStep - referenceStep) < 1e-9,
          `maximum-rate handoff snapped at completion (${breathBalance}, ${startPhase})`,
        );
      }
    }

    const tractOnlyTexture = turbulenceVoice(1, 1);
    tractOnlyTexture.breathTexture = 1;
    tractOnlyTexture.breathFlow = 1;
    tractOnlyTexture._radiate(0, -1);
    assert.ok(
      tractOnlyTexture.mouthFiltersLeft.some(({ band }) => Math.abs(band) > 0),
      "breath texture must excite the mouth formants",
    );
    assert.equal(
      tractOnlyTexture.frameFilterLeft.band,
      0,
      "breath texture must not excite the metallic frame resonator",
    );

    const vowelA = new Processor({ processorOptions: { configuration: applyVowel({
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    }, "a") } });
    const vowelI = new Processor({ processorOptions: { configuration: applyVowel({
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    }, "i") } });
    vowelA.breathFlow = 1;
    vowelI.breathFlow = 1;
    let vowelTextureDifference = 0;
    let vowelTextureEnergy = 0;
    for (let index = 0; index < 4_096; index += 1) {
      // Probe near the A mouth's first formant, which the I posture moves far
      // lower. Only the breath branch is active for this comparison.
      const texture = Math.sin(index * Math.PI * 2 * 800 / 48_000) * 0.05;
      vowelA.breathTexture = texture;
      vowelI.breathTexture = texture;
      const aSample = vowelA._radiate(0, -1);
      const iSample = vowelI._radiate(0, -1);
      if (index > 256) {
        vowelTextureDifference += (aSample - iSample) ** 2;
        vowelTextureEnergy += aSample * aSample + iSample * iSample;
      }
    }
    assert.ok(
      Math.sqrt(vowelTextureDifference / vowelTextureEnergy) > 0.3,
      "isolated breath texture must follow changing mouth/vowel formants",
    );

    const releasedFromHold = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const quickFingerStrike = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const equivalentStrike = {
      force: 1.17,
      direction: -1,
      position: 0.41,
    };
    releasedFromHold._handleMessage({ type: "hold-tine" });
    releasedFromHold._handleMessage({ type: "release-tine", ...equivalentStrike });
    quickFingerStrike._handleMessage({ type: "strike-tine", ...equivalentStrike });
    assert.deepEqual(
      Array.from(quickFingerStrike.amplitudes),
      Array.from(releasedFromHold.amplitudes),
      "a resting button/MIDI/repeat strike should start with held-release modal amplitudes",
    );
    assert.deepEqual(
      Array.from(quickFingerStrike.phases),
      Array.from(releasedFromHold.phases),
      "a resting button/MIDI/repeat strike should start at released displacement",
    );
    assert.equal(quickFingerStrike.attackEnvelope, releasedFromHold.attackEnvelope);
    assert.equal(quickFingerStrike.clickEnvelope, releasedFromHold.clickEnvelope);
    assert.equal(quickFingerStrike.hasBeenPlucked, true);

    const repeatingStrike = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
      dryResonance: 1,
    } } });
    for (let strikeIndex = 0; strikeIndex < 12; strikeIndex += 1) {
      if (strikeIndex) renderProcessor(repeatingStrike, 3);
      const amplitudesBefore = Float64Array.from(repeatingStrike.amplitudes);
      const energyBefore = modalEnergy(repeatingStrike);
      repeatingStrike._handleMessage({
        type: "strike-tine",
        force: 0.9,
        direction: strikeIndex % 2 ? -1 : 1,
        position: strikeIndex % 3 ? 0.31 : 0.67,
        automatic: true,
      });
      assert.ok(
        repeatingStrike.amplitudes.every((amplitude, index) => (
          amplitude + 1e-12 >= amplitudesBefore[index]
        )),
        `released-displacement strike ${strikeIndex + 1} reduced modal energy`,
      );
      assert.ok(modalEnergy(repeatingStrike) + 1e-12 >= energyBefore);
      assert.ok(repeatingStrike.attackEnvelope >= 0.899);
      const attack = renderProcessor(repeatingStrike, 4);
      assert.ok(rmsOf(attack, 384) > 0.002, `strike ${strikeIndex + 1} lost its attack`);
      assert.ok(attack.every(Number.isFinite));
      assert.ok(attack.every((sample) => Math.abs(sample) < 0.95));
    }

    for (const style of JAW_HARP_STYLE_REFERENCES) {
      const configuration = applyJawHarpStyle(
        jawHarpState(style.recommendedPresetId),
        style.id,
      );
      const voice = new Processor({ processorOptions: { configuration } });
      voice._handleMessage({ type: "hold-tine" });
      voice._handleMessage({
        type: "release-tine",
        force: configuration.pluckForce,
        direction: configuration.pluckDirection,
        position: configuration.pluckPosition,
      });
      const rendered = renderProcessor(voice, 160);
      let peak = 0;
      let squareSum = 0;
      for (const sample of rendered) {
        assert.ok(Number.isFinite(sample), `${style.id} rendered a non-finite sample`);
        peak = Math.max(peak, Math.abs(sample));
        squareSum += sample * sample;
      }
      const styleRms = Math.sqrt(squareSum / rendered.length);
      assert.ok(styleRms > 0.001, `${style.id} rendered too quietly (${styleRms})`);
      assert.ok(peak > 0.005, `${style.id} had no audible attack (${peak})`);
      assert.ok(peak < 0.98, `${style.id} exceeded the worklet bound (${peak})`);
    }
    const defaultReleaseVoice = new Processor({
      processorOptions: { configuration: JAW_HARP_DEFAULTS },
    });
    defaultReleaseVoice._handleMessage({ type: "hold-tine" });
    defaultReleaseVoice._handleMessage({
      type: "release-tine",
      force: JAW_HARP_DEFAULTS.pluckForce,
      direction: JAW_HARP_DEFAULTS.pluckDirection,
      position: JAW_HARP_DEFAULTS.pluckPosition,
    });
    const defaultRelease = renderProcessor(defaultReleaseVoice, 60);
    const defaultAttackRms = windowRms(defaultRelease, 0, 960);
    const defaultBodyRms = windowRms(defaultRelease, 960, 4_800);
    assert.ok(
      defaultAttackRms >= defaultBodyRms * 0.5,
      `default strike lost its attack/body contrast (${defaultAttackRms}, ${defaultBodyRms})`,
    );
    assert.ok(Math.max(...defaultRelease.map(Math.abs)) < 0.95);
    assert.ok(defaultReleaseVoice.strikePresence < 0.01);
    assert.ok(defaultReleaseVoice.decays[0] ** 48_000 > 0.78);
    assert.ok(defaultReleaseVoice.decays[0] ** 48_000 < 0.82);
    const randomizedAuditionState = jawHarpState("kubing", {
      autoBreath: false,
      dryResonance: JAW_HARP_RANDOM_LIMITS.dryResonanceWithoutBreath[0],
      reedFrequencyHz: JAW_HARP_RANDOM_LIMITS.reedFrequencyHz[0],
      cavityCoupling: JAW_HARP_RANDOM_LIMITS.cavityCoupling[1],
      frameCoupling: JAW_HARP_RANDOM_LIMITS.frameCoupling[0],
      pluckForce: JAW_HARP_RANDOM_LIMITS.pluckForce[0],
    });
    const randomizedAuditionVoice = new Processor({
      processorOptions: { configuration: jawHarpState("khomus") },
    });
    randomizedAuditionVoice._handleMessage({ type: "silence" });
    randomizedAuditionVoice._handleMessage({
      type: "configure",
      configuration: randomizedAuditionState,
    });
    assert.equal(randomizedAuditionVoice.silenced, true);
    randomizedAuditionVoice._handleMessage({
      type: "pluck",
      force: JAW_HARP_DEFAULTS.pluckForce,
      direction: randomizedAuditionState.pluckDirection,
      position: randomizedAuditionState.pluckPosition,
      automatic: true,
    });
    assert.equal(randomizedAuditionVoice.silenced, false);
    assert.equal(randomizedAuditionVoice.hasBeenPlucked, true);
    const randomizedAudition = renderProcessor(randomizedAuditionVoice, 20);
    let randomizedAuditionPeak = 0;
    for (const sample of randomizedAudition) {
      randomizedAuditionPeak = Math.max(randomizedAuditionPeak, Math.abs(sample));
    }
    assert.ok(rmsOf(randomizedAudition) > 0.001);
    assert.ok(randomizedAuditionPeak > 0.001);

    let auditionSeed = 0xa11d1b1e;
    const auditionRandom = () => {
      auditionSeed = (Math.imul(auditionSeed, 1_664_525) + 1_013_904_223) >>> 0;
      return auditionSeed / 0x1_0000_0000;
    };
    for (let index = 0; index < 16; index += 1) {
      const configuration = randomizeJawHarpState(JAW_HARP_DEFAULTS, auditionRandom);
      const sequenceVowel = configuration.vowelSequenceMode === "off"
        ? null
        : jawHarpVowelSequenceStep(configuration.vowelSequenceId, 0);
      const audibleConfiguration = sequenceVowel
        ? sanitizeJawHarpState({
          ...configuration,
          ...sequenceVowel.settings,
          vowelId: sequenceVowel.id,
        }, configuration)
        : configuration;
      const voice = new Processor({ processorOptions: { configuration: audibleConfiguration } });
      voice._handleMessage({
        type: "pluck",
        force: Math.max(JAW_HARP_DEFAULTS.pluckForce, audibleConfiguration.pluckForce),
        direction: audibleConfiguration.pluckDirection,
        position: audibleConfiguration.pluckPosition,
        automatic: true,
      });
      const samples = renderProcessor(voice, 48);
      assert.ok(rmsOf(samples) > 0.001, `random audition ${index} was too quiet`);
    }
    const renderAutomaticVoice = (configuration, blocks = 120) => {
      const voice = new Processor({ processorOptions: { configuration: sanitizeJawHarpState({
        ...JAW_HARP_DEFAULTS,
        autoBreath: true,
        breathLinked: false,
        breathDepth: 3,
        breathRateBpm: 120,
        breathBalance: 0.5,
        ...configuration,
      }) } });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      return renderProcessor(voice, blocks);
    };

    const releaseState = (direction) => {
      const voice = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
      } } });
      voice._handleMessage({ type: "hold-tine" });
      voice._handleMessage({
        type: "release-tine", force: 1, direction, position: 0.32,
      });
      return voice;
    };
    const outwardRelease = releaseState(1);
    const inwardRelease = releaseState(-1);
    const outwardDisplacement = outwardRelease.amplitudes[0]
      * Math.sin(outwardRelease.phases[0]);
    const outwardVelocity = outwardRelease.amplitudes[0]
      * Math.cos(outwardRelease.phases[0]);
    const inwardDisplacement = inwardRelease.amplitudes[0]
      * Math.sin(inwardRelease.phases[0]);
    assert.ok(outwardDisplacement > 0.5);
    assert.ok(Math.abs(outwardVelocity) < 1e-12);
    assert.ok(Math.abs(outwardDisplacement + inwardDisplacement) < 1e-12);

    renderProcessor(outwardRelease, 4);
    const phasesBeforeRetrigger = Float64Array.from(outwardRelease.phases);
    const amplitudesBeforeRetrigger = Float64Array.from(outwardRelease.amplitudes);
    outwardRelease._handleMessage({
      type: "pluck", force: 0.8, direction: 1, position: 0.32,
    });
    for (let index = 0; index < JAW_HARP_MODE_COUNT; index += 1) {
      assert.ok(outwardRelease.amplitudes[index] >= amplitudesBeforeRetrigger[index]);
      if (amplitudesBeforeRetrigger[index] >= 1e-9) {
        assert.equal(outwardRelease.phases[index], phasesBeforeRetrigger[index]);
      }
    }
    assert.ok(outwardRelease.amplitudes[0] > amplitudesBeforeRetrigger[0]);

    const retriggerReference = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const retriggered = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    for (const voice of [retriggerReference, retriggered]) {
      voice._handleMessage({ type: "breath", flow: 0.9, manual: true });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      renderProcessor(voice, 80);
    }
    retriggered._handleMessage({
      type: "pluck", force: 0.8, direction: -1, position: 0.68,
    });
    const referenceAfterRetrigger = renderProcessor(retriggerReference, 8);
    const retriggeredOutput = renderProcessor(retriggered, 8);
    assert.ok(
      rmsOf(retriggeredOutput) > rmsOf(referenceAfterRetrigger) * 0.9,
      "an active reed retrigger must not phase-brake the ringing sound",
    );

    const strongReference = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const weakRetriggered = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    for (const voice of [strongReference, weakRetriggered]) {
      voice._handleMessage({ type: "breath", flow: 0.9, manual: true });
      voice._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32 });
      renderProcessor(voice, 1);
    }
    const attackBeforeWeakRetrigger = weakRetriggered.attackEnvelope;
    const clickBeforeWeakRetrigger = weakRetriggered.clickEnvelope;
    weakRetriggered._handleMessage({
      type: "pluck", force: 0.005, direction: 1, position: 0.68,
    });
    assert.equal(weakRetriggered.attackEnvelope, attackBeforeWeakRetrigger);
    assert.equal(weakRetriggered.clickEnvelope, clickBeforeWeakRetrigger);
    const uninterruptedStrongOutput = renderProcessor(strongReference, 8);
    const weakRetriggerOutput = renderProcessor(weakRetriggered, 8);
    assert.ok(
      rmsOf(weakRetriggerOutput) > rmsOf(uninterruptedStrongOutput) * 0.9,
      "a weak follow-up pluck must not erase a strong ringing attack",
    );

    const reopeningGate = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    reopeningGate._handleMessage({ type: "breath", flow: 0.9, manual: true });
    reopeningGate._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
    reopeningGate.amplitudes.fill(0);
    reopeningGate.airGate = 0;
    reopeningGate.airPathPrimed = true;
    for (let sample = 0; sample < 4_800; sample += 1) {
      reopeningGate.energy = 0;
      reopeningGate._renderSource();
    }
    const reopenedPresence = 1 - Math.exp(-Math.abs(reopeningGate.breathFlow) * 1.15);
    const reopenedTarget = 0.08 + reopenedPresence * 1.12;
    assert.ok(
      reopeningGate.airGate > reopenedTarget * 0.9,
      "low-energy breath must reopen the air path within 100 ms",
    );

    const selectiveGlottis = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const coefficientMasks = [];
    const updateCoefficients = selectiveGlottis._updateCoefficients.bind(selectiveGlottis);
    selectiveGlottis._updateCoefficients = (mask) => {
      coefficientMasks.push(mask);
      return updateCoefficients(mask);
    };
    const tractFrequencyBefore = selectiveGlottis.mouthFiltersLeft[0].frequency;
    const frameFrequencyBefore = selectiveGlottis.frameFilterLeft.frequency;
    const breathColorBefore = selectiveGlottis.breathNoiseColorInhale;
    selectiveGlottis.frequencies[0] = 12_345;
    selectiveGlottis.decays[0] = 0.12345;
    selectiveGlottis._handleMessage({
      type: "configure", configuration: { glottisOpening: 3 },
    });
    selectiveGlottis._approachConfiguration(128);
    assert.deepEqual(coefficientMasks, [18]);
    assert.equal(selectiveGlottis.frequencies[0], 12_345);
    assert.equal(selectiveGlottis.decays[0], 0.12345);
    assert.notEqual(selectiveGlottis.mouthFiltersLeft[0].frequency, tractFrequencyBefore);
    assert.equal(selectiveGlottis.frameFilterLeft.frequency, frameFrequencyBefore);
    assert.notEqual(selectiveGlottis.breathNoiseColorInhale, breathColorBefore);

    const selectiveBreathFilter = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const breathFilterMasks = [];
    const updateBreathFilterCoefficients = selectiveBreathFilter._updateCoefficients.bind(
      selectiveBreathFilter,
    );
    selectiveBreathFilter._updateCoefficients = (mask) => {
      breathFilterMasks.push(mask);
      return updateBreathFilterCoefficients(mask);
    };
    const breathFilterTractBefore = selectiveBreathFilter.mouthFiltersLeft[0].frequency;
    const breathFilterFrameBefore = selectiveBreathFilter.frameFilterLeft.frequency;
    const breathFilterColorBefore = selectiveBreathFilter.breathNoiseColorInhale;
    selectiveBreathFilter._handleMessage({
      type: "configure", configuration: { breathFilter: 1 },
    });
    selectiveBreathFilter._approachConfiguration(128);
    assert.deepEqual(breathFilterMasks, [16]);
    assert.equal(selectiveBreathFilter.mouthFiltersLeft[0].frequency, breathFilterTractBefore);
    assert.equal(selectiveBreathFilter.frameFilterLeft.frequency, breathFilterFrameBefore);
    assert.ok(selectiveBreathFilter.breathNoiseColorInhale > breathFilterColorBefore);

    const rawReleaseCycleRms = (presetId) => {
      const configuration = jawHarpState(presetId, { autoBreath: false, dryResonance: 1 });
      const voice = new Processor({ processorOptions: { configuration } });
      voice._handleMessage({ type: "hold-tine" });
      voice._handleMessage({
        type: "release-tine", force: 1, direction: 1, position: 0.32,
      });
      // Measure the material/modal rebound separately from the intentionally
      // short contact transient that gives the default voice its clear attack.
      voice.attackEnvelope = 0;
      voice.strikePresence = 0;
      const period = Math.round(48_000 / configuration.reedFrequencyHz);
      const cycles = [];
      for (let cycle = 0; cycle < 3; cycle += 1) {
        let energy = 0;
        for (let sample = 0; sample < period; sample += 1) {
          const value = voice._renderSource();
          energy += value * value;
        }
        cycles.push(Math.sqrt(energy / period));
      }
      return cycles;
    };
    for (const presetId of ["khomus", "munnharpe", "kubing"]) {
      const cycles = rawReleaseCycleRms(presetId);
      assert.ok(cycles[1] > cycles[0] * 0.78, `${presetId} second rebound remains strong`);
      assert.ok(cycles[2] > cycles[0] * 0.72, `${presetId} third rebound remains strong`);
    }

    assert.equal(processor.amplitudes.length, JAW_HARP_MODE_COUNT);
    const attackRms = [0.005, 0.05, 0.5, 4].map((force) => rmsOf(renderVoice({
      autoBreath: false,
      dryResonance: 1,
    }, { force, flow: 0, blocks: 20 }), 2_400));
    assert.ok(attackRms.every((amount, index) => index === 0 || amount > attackRms[index - 1]));
    assert.ok(attackRms.at(-1) > attackRms[0] * 20);
    const maximumBreathAttacks = [0.005, 0.05, 0.5, 4].map((force) => renderVoice({
      autoBreath: false,
      dryResonance: 0.06,
    }, { force, flow: 3, blocks: 8 }));
    const maximumBreathFiveMs = maximumBreathAttacks.map((samples) => rmsOf(samples, 240));
    assert.ok(maximumBreathFiveMs.every((amount, index) => index === 0 || amount > maximumBreathFiveMs[index - 1]));
    assert.ok(maximumBreathFiveMs.at(-1) > maximumBreathFiveMs[0] * 2);
    assert.ok(rmsOf(maximumBreathAttacks.at(-1), 960) > rmsOf(maximumBreathAttacks[0], 960) * 1.2);
    for (const key of [
      "tonguePosition",
      "tongueHeight",
      "jawOpening",
      "lipRounding",
      "glottisOpening",
      "formantFocus",
      "cavityCoupling",
      "frameCoupling",
    ]) {
      const low = renderVoice({ [key]: JAW_HARP_LIMITS[key][0] });
      const high = renderVoice({ [key]: JAW_HARP_LIMITS[key][1] });
      assert.ok(normalizedDifference(low, high) > 0.2, `${key} must remain audibly connected`);
    }
    const dryMouth = renderVoice({ dryResonance: 0 }, { flow: 0 });
    const resonantMouth = renderVoice({ dryResonance: 1 }, { flow: 0 });
    assert.ok(normalizedDifference(dryMouth, resonantMouth) > 0.2);
    for (const [label, lowConfiguration, highConfiguration] of [
      ["breath depth", { breathDepth: 0 }, { breathDepth: 3 }],
      ["breath rate", { breathRateBpm: 1 }, { breathRateBpm: 1_200 }],
      ["breath balance", { breathBalance: 0.02 }, { breathBalance: 0.98 }],
      ["breath link", { breathLinked: false }, { breathLinked: true }],
      [
        "linked hand tempo",
        { breathLinked: true, repeatRateBpm: 36 },
        { breathLinked: true, repeatRateBpm: 480 },
      ],
      [
        "breaths per loop",
        { breathLinked: true, breathsPerLoop: 0.125 },
        { breathLinked: true, breathsPerLoop: 16 },
      ],
    ]) {
      const low = renderAutomaticVoice(lowConfiguration);
      const high = renderAutomaticVoice(highConfiguration);
      assert.ok(normalizedDifference(low, high) > 0.2, `${label} must remain audibly connected`);
    }

    const presetRenders = JAW_HARP_PRESETS.map((preset) => renderVoice(jawHarpState(preset.id)));
    for (let left = 0; left < presetRenders.length; left += 1) {
      for (let right = left + 1; right < presetRenders.length; right += 1) {
        assert.ok(normalizedDifference(presetRenders[left], presetRenders[right]) > 0.2);
      }
    }

    const liveReference = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    const liveMouth = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    for (const voice of [liveReference, liveMouth]) {
      voice._handleMessage({ type: "breath", flow: 0.9, manual: true });
      voice._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      renderProcessor(voice, 8);
    }
    liveMouth._handleMessage({ type: "configure", configuration: {
      tonguePosition: 3,
      tongueHeight: -2,
      jawOpening: 3,
      lipRounding: -2,
      glottisOpening: 3,
      formantFocus: 3,
      cavityCoupling: 2,
    } });
    const liveReferenceOutput = renderProcessor(liveReference, 120);
    const liveMouthOutput = renderProcessor(liveMouth, 120);
    assert.ok(liveMouth.configuration.tonguePosition > 2.99);
    assert.ok(normalizedDifference(liveReferenceOutput, liveMouthOutput) > 0.2);

    const appOrderReference = new Processor({
      processorOptions: { configuration: JAW_HARP_DEFAULTS },
    });
    const appOrderPreset = new Processor({
      processorOptions: { configuration: JAW_HARP_DEFAULTS },
    });
    const armAppOrderedRelease = (voice, configuration) => {
      voice._handleMessage({ type: "configure", configuration });
      voice._handleMessage({ type: "hold-tine" });
      voice._handleMessage({ type: "configure", configuration });
      voice._handleMessage({
        type: "release-tine", force: 0.72, direction: 1, position: 0.32,
      });
    };
    armAppOrderedRelease(appOrderReference, JAW_HARP_DEFAULTS);
    armAppOrderedRelease(appOrderPreset, jawHarpState("dan-moi"));
    const appOrderReferenceOutput = renderProcessor(appOrderReference, 90);
    const appOrderPresetOutput = renderProcessor(appOrderPreset, 90);
    assert.equal(appOrderPreset.configuration.presetId, "dan-moi");
    assert.ok(normalizedDifference(appOrderReferenceOutput, appOrderPresetOutput) > 0.2);

    const held = new Processor({
      processorOptions: { configuration: { ...JAW_HARP_DEFAULTS, autoBreath: false } },
    });
    const heldReference = new Processor({
      processorOptions: { configuration: { ...JAW_HARP_DEFAULTS, autoBreath: false } },
    });
    for (const voice of [held, heldReference]) {
      voice._handleMessage({ type: "breath", flow: 3, manual: true });
      voice._handleMessage({ type: "pluck", force: 1, direction: 1, position: 0.32 });
    }
    const ringingOutput = new Float32Array(128);
    held.process([], [[ringingOutput, new Float32Array(128)]]);
    heldReference.process([], [[new Float32Array(128), new Float32Array(128)]]);
    held._handleMessage({ type: "hold-tine" });
    const heldOutput = new Float32Array(128);
    const heldOutputRight = new Float32Array(128);
    held.process([], [[heldOutput, heldOutputRight]]);
    const heldReferenceOutput = new Float32Array(128);
    heldReference.process([], [[heldReferenceOutput, new Float32Array(128)]]);
    assert.ok(heldOutput.some((sample) => Math.abs(sample) > 1e-5));
    assert.ok(heldOutputRight.some((sample) => Math.abs(sample) > 1e-5));
    const holdTransitionDifference = Math.abs(heldOutput[0] - heldReferenceOutput[0]);
    assert.ok(
      holdTransitionDifference < 1e-5,
      `holding the tine introduced a ${holdTransitionDifference} edge before its fade began`,
    );
    const heldFadeTail = new Float32Array(128);
    held.process([], [[heldFadeTail, new Float32Array(128)]]);
    assert.ok(heldFadeTail.some((sample) => Math.abs(sample) > 1e-5));
    assert.equal(heldFadeTail[heldFadeTail.length - 1], 0);
    const fullyHeldOutput = new Float32Array(128);
    held.process([], [[fullyHeldOutput, new Float32Array(128)]]);
    assert.ok(fullyHeldOutput.every((sample) => sample === 0));
    assert.equal(held.tineHoldFading, false);
    held._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32, automatic: true });
    const suppressedOutput = new Float32Array(128);
    const suppressedOutputRight = new Float32Array(128);
    held.process([], [[suppressedOutput, suppressedOutputRight]]);
    assert.ok(suppressedOutput.every((sample) => sample === 0));
    assert.ok(suppressedOutputRight.every((sample) => sample === 0));
    held._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32, automatic: false });
    const suppressedManualOutput = new Float32Array(128);
    const suppressedManualOutputRight = new Float32Array(128);
    held.process([], [[suppressedManualOutput, suppressedManualOutputRight]]);
    assert.ok(suppressedManualOutput.every((sample) => sample === 0));
    assert.ok(suppressedManualOutputRight.every((sample) => sample === 0));
    held._handleMessage({ type: "release-tine", force: 4, direction: 1, position: 0.32 });
    const releasedOutput = new Float32Array(128);
    held.process([], [[releasedOutput, new Float32Array(128)]]);
    assert.ok(releasedOutput.some((sample) => Math.abs(sample) > 1e-5));

    const heldClock = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: true,
      breathLinked: false,
      breathRateBpm: 1_200,
    } } });
    heldClock._handleMessage({ type: "hold-tine" });
    const phaseBeforeHold = heldClock.breathPhase;
    const silentHeldClock = new Float32Array(128);
    heldClock.process([], [[silentHeldClock, new Float32Array(128)]]);
    assert.notEqual(heldClock.breathPhase, phaseBeforeHold);
    assert.ok(silentHeldClock.every((sample) => sample === 0));
    heldClock._handleMessage({ type: "release-tine" });
    for (let block = 0; block < 38; block += 1) {
      const cancelledOutput = new Float32Array(128);
      const cancelledOutputRight = new Float32Array(128);
      heldClock.process([], [[cancelledOutput, cancelledOutputRight]]);
      assert.ok(cancelledOutput.every((sample) => sample === 0));
      assert.ok(cancelledOutputRight.every((sample) => sample === 0));
    }

    const cancelledActiveVoice = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
    } } });
    cancelledActiveVoice._handleMessage({ type: "breath", flow: 3, manual: true });
    cancelledActiveVoice._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32 });
    cancelledActiveVoice.process([], [[new Float32Array(128), new Float32Array(128)]]);
    cancelledActiveVoice._handleMessage({ type: "hold-tine" });
    cancelledActiveVoice._handleMessage({ type: "release-tine" });
    for (let block = 0; block < 38; block += 1) {
      const cancelledOutput = new Float32Array(128);
      const cancelledOutputRight = new Float32Array(128);
      cancelledActiveVoice.process([], [[cancelledOutput, cancelledOutputRight]]);
      assert.ok(cancelledOutput.every((sample) => sample === 0));
      assert.ok(cancelledOutputRight.every((sample) => sample === 0));
    }

    const rapidBreath = new Processor({
      processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: true,
        breathLinked: false,
        breathDepth: 3,
        breathRateBpm: 1_200,
        breathBalance: 0.5,
      } },
    });
    rapidBreath._handleMessage({ type: "pluck", force: 1, direction: 1, position: 0.32 });
    let previousSign = 0;
    let directionChanges = 0;
    for (let block = 0; block < 100; block += 1) {
      rapidBreath.process([], [[new Float32Array(128), new Float32Array(128)]]);
      const sign = Math.abs(rapidBreath.breathFlow) < 0.01 ? 0 : Math.sign(rapidBreath.breathFlow);
      if (sign && previousSign && sign !== previousSign) directionChanges += 1;
      if (sign) previousSign = sign;
    }
    assert.ok(directionChanges >= 8);

    const enabledAfterManualStart = new Processor({ processorOptions: { configuration: {
      ...JAW_HARP_DEFAULTS,
      autoBreath: false,
      breathLinked: false,
      breathDepth: 3,
      breathRateBpm: 1_200,
    } } });
    enabledAfterManualStart._handleMessage({
      type: "configure",
      configuration: { autoBreath: true },
    });
    enabledAfterManualStart._handleMessage({
      type: "pluck", force: 1, direction: 1, position: 0.32,
    });
    let automaticFlowPeak = 0;
    let automaticFlowChanges = 0;
    let previousAutomaticSign = 0;
    for (let block = 0; block < 100; block += 1) {
      enabledAfterManualStart.process([], [[new Float32Array(128), new Float32Array(128)]]);
      automaticFlowPeak = Math.max(automaticFlowPeak, Math.abs(enabledAfterManualStart.breathFlow));
      const sign = Math.abs(enabledAfterManualStart.breathFlow) < 0.01
        ? 0
        : Math.sign(enabledAfterManualStart.breathFlow);
      if (sign && previousAutomaticSign && sign !== previousAutomaticSign) automaticFlowChanges += 1;
      if (sign) previousAutomaticSign = sign;
    }
    assert.ok(automaticFlowPeak > 2.9);
    assert.ok(automaticFlowChanges >= 8);

    for (const breathBalance of [0.02, 0.98]) {
      const extremeRate = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: true,
        breathLinked: true,
        repeatRateBpm: 480,
        breathsPerLoop: 16,
        breathRateBpm: 1_200,
        breathBalance,
        breathDepth: 3,
      } } });
      extremeRate._handleMessage({ type: "pluck", force: 1, direction: 1, position: 0.32 });
      let previousExtremeSign = 0;
      let extremeDirectionChanges = 0;
      let minimumFlow = 0;
      let maximumFlow = 0;
      let positiveSamples = 0;
      let negativeSamples = 0;
      for (let sample = 0; sample < 4_800; sample += 1) {
        extremeRate._renderSource();
        minimumFlow = Math.min(minimumFlow, extremeRate.breathFlow);
        maximumFlow = Math.max(maximumFlow, extremeRate.breathFlow);
        if (extremeRate.breathFlow > 0.01) positiveSamples += 1;
        if (extremeRate.breathFlow < -0.01) negativeSamples += 1;
        const sign = Math.abs(extremeRate.breathFlow) < 0.01 ? 0 : Math.sign(extremeRate.breathFlow);
        if (sign && previousExtremeSign && sign !== previousExtremeSign) extremeDirectionChanges += 1;
        if (sign) previousExtremeSign = sign;
      }
      assert.ok(extremeDirectionChanges >= 20);
      assert.ok(minimumFlow < -2.9 && maximumFlow > 2.9);
      assert.ok(positiveSamples > 60 && negativeSamples > 60);
    }

    const mouthKeys = [
      "tonguePosition", "tongueHeight", "jawOpening", "lipRounding", "glottisOpening",
    ];
    for (let mask = 0; mask < 2 ** mouthKeys.length; mask += 1) {
      for (const focusValue of [-2, 3]) {
        for (const coupling of [0, 2]) {
          const mouthConfiguration = Object.fromEntries(mouthKeys.map((key, index) => [
            key,
            mask & (1 << index) ? JAW_HARP_LIMITS[key][1] : JAW_HARP_LIMITS[key][0],
          ]));
          const extremeVoice = new Processor({ processorOptions: { configuration: {
            ...JAW_HARP_DEFAULTS,
            autoBreath: false,
            ...mouthConfiguration,
            formantFocus: focusValue,
            cavityCoupling: coupling,
          } } });
          extremeVoice._handleMessage({ type: "breath", flow: 3, manual: true });
          extremeVoice._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32 });
          for (let block = 0; block < 8; block += 1) {
            const left = new Float32Array(128);
            const right = new Float32Array(128);
            extremeVoice.process([], [[left, right]]);
            assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
            assert.ok(left.every((sample) => Math.abs(sample) <= 0.821));
            assert.ok(right.every((sample) => Math.abs(sample) <= 0.821));
          }
          for (const values of [
            extremeVoice.amplitudes,
            extremeVoice.phases,
            extremeVoice.frequencies,
            extremeVoice.decays,
          ]) assert.ok(values.every(Number.isFinite));
          assert.ok([
            extremeVoice.energy,
            extremeVoice.reedDisplacement,
            extremeVoice.breathFlow,
            extremeVoice.airGate,
            extremeVoice.airColorState,
            extremeVoice.airSmoothState,
            extremeVoice.breathNoiseState,
            extremeVoice.breathNoiseSmoothState,
            extremeVoice.breathNoiseDcState,
            extremeVoice.breathTexture,
            extremeVoice.clickColorState,
            extremeVoice.clickSmoothState,
            extremeVoice.clickDcState,
            extremeVoice.sourceDc,
            extremeVoice.lastReedDrive,
            extremeVoice.lastFinalDriveLeft,
            extremeVoice.lastFinalDriveRight,
          ].every(Number.isFinite));
        }
      }
    }

    const attackRetentionByRate = [];
    const attackRetentionSeconds = 0.1;
    for (const renderRate of [44_100, 96_000]) {
      globalThis.sampleRate = renderRate;
      const attackVoice = new Processor({ processorOptions: { configuration: {
        ...JAW_HARP_DEFAULTS,
        autoBreath: false,
        breathNoiseAmount: 0,
      } } });
      attackVoice._handleMessage({
        type: "pluck", force: 4, direction: 1, position: 0.32,
      });
      const initialAttackEnvelope = attackVoice.attackEnvelope;
      const attackSampleCount = Math.round(renderRate * attackRetentionSeconds);
      for (let sample = 0; sample < attackSampleCount; sample += 1) {
        attackVoice._renderSource();
      }
      assert.ok(attackVoice.attackEnvelope > 0);
      attackRetentionByRate.push(attackVoice.attackEnvelope / initialAttackEnvelope);
      for (const flow of [-3, 3]) {
        const rateVoice = new Processor({ processorOptions: { configuration: {
          ...JAW_HARP_DEFAULTS,
          autoBreath: false,
          breathNoiseAmount: 1,
          breathFilter: 1,
          reedFrequencyHz: JAW_HARP_LIMITS.reedFrequencyHz[1],
          reedStiffness: JAW_HARP_LIMITS.reedStiffness[1],
          frameCoupling: JAW_HARP_LIMITS.frameCoupling[1],
          cavityCoupling: JAW_HARP_LIMITS.cavityCoupling[1],
        } } });
        rateVoice._handleMessage({ type: "breath", flow, manual: true });
        rateVoice._handleMessage({ type: "pluck", force: 4, direction: 1, position: 0.32 });
        let ratePeak = 0;
        const blockCount = Math.ceil(renderRate * 0.125 / 128);
        for (let block = 0; block < blockCount; block += 1) {
          const left = new Float32Array(128);
          const right = new Float32Array(128);
          rateVoice.process([], [[left, right]]);
          assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
          assert.ok(left.every((sample) => Math.abs(sample) <= 0.821));
          assert.ok(right.every((sample) => Math.abs(sample) <= 0.821));
          for (let index = 0; index < left.length; index += 1) {
            ratePeak = Math.max(ratePeak, Math.abs(left[index]), Math.abs(right[index]));
          }
        }
        assert.ok(ratePeak > 0.001, `${renderRate} Hz flow ${flow} became silent`);
        assert.ok([
          rateVoice.airColorState,
          rateVoice.airSmoothState,
          rateVoice.breathNoiseState,
          rateVoice.breathNoiseSmoothState,
          rateVoice.breathNoiseDcState,
          rateVoice.breathTexture,
          rateVoice.clickColorState,
          rateVoice.clickSmoothState,
          rateVoice.clickDcState,
          rateVoice.contactClick,
          rateVoice.sourceDc,
          rateVoice.lastReedDrive,
          rateVoice.lastFinalDriveLeft,
          rateVoice.lastFinalDriveRight,
        ].every(Number.isFinite), `${renderRate} Hz flow ${flow} corrupted internal DSP state`);
      }
    }
    assert.ok(
      Math.abs(attackRetentionByRate[0] - attackRetentionByRate[1]) < 1e-9,
      `equal-time attack retention drifted across rates (${attackRetentionByRate})`,
    );
    globalThis.sampleRate = 48_000;
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
});

test("jaw-harp page exposes the physical model and accessible interactions", async () => {
  const [html, css, app, processor] = await Promise.all([
    readFile(new URL("jaw-harp.html", root), "utf8"),
    readFile(new URL("jaw-harp.css", root), "utf8"),
    readFile(new URL("jaw-harp-app.js", root), "utf8"),
    readFile(new URL("src/jaw-harp-processor.js", root), "utf8"),
  ]);
  assert.match(html, /<body class="jaw-harp-page"/);
  assert.match(html, /id="stage"[\s\S]*?tabindex="0"/);
  assert.match(html, /id="pluckButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /id="tonguePosition"/);
  assert.match(html, /id="jawOpening"/);
  assert.match(html, /id="cavityCoupling"/);
  assert.match(html, /id="inhaleButton"/);
  assert.match(html, /id="exhaleButton"/);
  assert.match(html, /id="breathCycleButton"/);
  assert.match(html, /id="rhythmSelect"/);
  assert.match(html, /id="breathsPerLoop"/);
  assert.match(html, /id="breathLinkButton"/);
  assert.match(html, /id="dryResonance"/);
  assert.match(html, /Breath filter \/ color/);
  assert.match(html, /same live mouth and formant resonator/);
  assert.match(html, /id="breathXYPad"[\s\S]*?data-jaw-xy-pad="air"[\s\S]*?data-x-control="breathRateBpm"[\s\S]*?data-y-control="breathDepth"/);
  assert.match(html, /id="breathXYThumb"[\s\S]*?data-jaw-xy-thumb/);
  assert.match(html, /id="breathXYReadout"/);
  assert.match(html, /id="rhythmXYPad"[\s\S]*?data-jaw-xy-pad="rhythm"[\s\S]*?data-x-control="repeatRateBpm"[\s\S]*?data-y-control="repeatSwing"/);
  assert.match(html, /id="rhythmXYThumb"[\s\S]*?data-jaw-xy-thumb/);
  assert.match(html, /id="rhythmXYReadout"/);
  assert.match(html, /Physical harp \/ material/);
  assert.match(html, /id="harpSelect" aria-label="Jaw harp physical body and material preset"/);
  assert.match(html, /id="styleSelect"[\s\S]*?aria-describedby="styleDescription styleSource"/);
  assert.match(html, /id="styleSource"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/);
  assert.match(html, /id="vowelSequenceSelect"[\s\S]*?aria-describedby="vowelSequenceHelp"/);
  assert.match(html, /data-vowel-sequence-mode="off"[\s\S]*?data-vowel-sequence-mode="pluck"[\s\S]*?data-vowel-sequence-mode="breath"/);
  assert.match(html, /Breath mode steps once at every inhale\/exhale turn/);
  assert.ok(html.indexOf('id="randomizeButton"') < html.indexOf('id="vowelSequenceSelect"'));
  assert.ok(html.indexOf('id="vowelSequenceSelect"') < html.indexOf('class="jaw-model-hud"'));
  assert.match(html, /src="jaw-harp-app\.js"/);
  for (const key of [
    "pluckForce",
    "tonguePosition",
    "tongueHeight",
    "jawOpening",
    "lipRounding",
    "formantFocus",
    "cavityCoupling",
    "glottisOpening",
    "breathNoiseAmount",
    "breathFilter",
    "breathDepth",
    "breathRateBpm",
    "breathBalance",
    "repeatRateBpm",
    "repeatSwing",
    "dryResonance",
  ]) {
    const tag = html.match(new RegExp(`<input id="${key}"[^>]*>`))?.[0];
    assert.ok(tag, `${key} range exists`);
    const minimum = Number(tag.match(/min="([^"]+)"/)?.[1]);
    const maximum = Number(tag.match(/max="([^"]+)"/)?.[1]);
    assert.deepEqual([minimum, maximum], JAW_HARP_LIMITS[key], `${key} HTML and model limits match`);
  }
  assert.match(html, /<option value="16">16 breaths \/ loop<\/option>/);
  assert.match(html, /side panel, drag the Breath gesture XY pad in two dimensions:[\s\S]*twenty per second/i);
  assert.match(html, /Drag the Hand clock XY pad horizontally from[\s\S]*vertically[\s\S]*alternating swing/);
  assert.match(html, /focus and cavity node in two dimensions/);
  assert.match(html, /glottis node\s+horizontally/);
  assert.match(css, /\.jaw-harp-page \.shell/);
  assert.match(css, /\.jaw-style-source/);
  assert.match(css, /\.jaw-xy-pad\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(css, /\.jaw-xy-thumb\s*\{[\s\S]*?--jaw-xy-top/);
  assert.match(css, /grid-template-rows:\s*minmax\(285px, 48dvh\)/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(app, /new AudioWorkletNode\(context, "jaw-harp-physical-model"/);
  const audioConfigurationBlock = app.slice(
    app.indexOf("function audioConfiguration("),
    app.indexOf("function breathLabel("),
  );
  assert.match(audioConfigurationBlock, /styleId: _styleId/);
  assert.match(audioConfigurationBlock, /for \(const key of JAW_HARP_STYLE_GESTURE_KEYS\)/);
  assert.match(audioConfigurationBlock, /function postNextReferenceGesture\(\)/);
  assert.match(audioConfigurationBlock, /jawHarpStyleGesture\(state\.styleId, referenceGestureStep\)/);
  assert.match(audioConfigurationBlock, /jawHarpVowelSequenceStep\(/);
  assert.match(audioConfigurationBlock, /state\.vowelSequenceMode === "pluck"/);
  assert.match(audioConfigurationBlock, /configuration: audioConfiguration\(gesture\)/);
  assert.match(app, /function updateBreathVowelSequence\(/);
  assert.match(app, /breathLobeBoundaryCount\(/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pluckForceFromPull\(drag\.pull, state\.pluckForce\)/);
  assert.match(app, /tineReleaseMotion\(/);
  assert.match(app, /visualTineRelease/);
  assert.doesNotMatch(app, /clamp\(telemetry\.displacement/);
  assert.match(app, /type: "hold-tine"/);
  assert.match(app, /type: "release-tine"/);
  assert.match(app, /function cancelHeldTine\(\)/);
  assert.match(app, /audioStartupPromise/);
  assert.match(app, /intentGeneration !== performanceIntentGeneration/);
  assert.match(app, /lostpointercapture", release/);
  assert.match(app, /pageLifecycleGeneration/);
  assert.match(app, /manualBreathGeneration/);
  assert.match(app, /manualBreathOwner/);
  assert.match(app, /function breathFlowForDisplay\(/);
  assert.match(app, /lastBreathTelemetryAt/);
  assert.doesNotMatch(app, /telemetry\.breathFlow \?\? commandedBreathFlow/);
  assert.match(app, /function logarithmicValue\(/);
  assert.match(app, /type === "air"/);
  assert.match(app, /type === "rhythm"/);
  assert.match(app, /type === "glottis"/);
  assert.match(app, /breathRateBpm: logarithmicValue\(/);
  assert.match(app, /repeatRateBpm: logarithmicValue\(/);
  assert.match(app, /function installXYPadInteractions\(\)/);
  assert.match(app, /querySelectorAll\("\[data-jaw-xy-pad\]"\)/);
  assert.match(app, /if \(pointerId !== null\) return/);
  assert.match(app, /pad\.setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(app, /ArrowLeft:\s*\[-1, 0\]/);
  assert.match(app, /ArrowUp:\s*\[0, 1\]/);
  assert.match(app, /const patch = xyPadPatch\(/);
  assert.match(app, /if \(patch\) commitParameterPatch\(patch\)/);
  assert.match(app, /function updateXYPadPresentation\(\)/);
  assert.match(app, /breathXYReadout/);
  assert.match(app, /rhythmXYReadout/);
  assert.match(app, /formatCycleRate\(effectiveRate\)/);
  assert.doesNotMatch(app, /model\.airPad|model\.rhythmPad/);
  assert.doesNotMatch(app, /function drawAirPadDetails|function drawRhythmPadDetails|function drawTempoSlider/);
  assert.match(app, /const RANDOMIZE_AUDITION_FORCE_FLOOR = JAW_HARP_DEFAULTS\.pluckForce/);
  const auditionBlock = app.match(/async function auditionRandomizedModel\([\s\S]*?^\}/m)?.[0] ?? "";
  assert.match(auditionBlock, /intentGeneration = performanceIntentGeneration/);
  assert.match(auditionBlock, /parkOwner = \+\+repeatClockParkSerial/);
  assert.match(auditionBlock, /repeatClockParkOwner !== parkOwner/);
  assert.match(auditionBlock, /repeatClockParkOwner = parkOwner/);
  assert.match(auditionBlock, /repeatClockParkOwner = 0/);
  assert.match(auditionBlock, /audioContext\?\.state !== "running"/);
  assert.match(auditionBlock, /nextRepeatAt = Infinity/);
  assert.match(auditionBlock, /await ensureAudio\(\)/);
  assert.match(auditionBlock, /auditionBreathPhase = state\.autoBreath \? state\.breathBalance \* 0\.5 : 0/);
  assert.match(auditionBlock, /resetBreathCycle\(auditionBreathPhase\)/);
  assert.match(auditionBlock, /clamp\([\s\S]*?RANDOMIZE_AUDITION_FORCE_FLOOR,[\s\S]*?JAW_HARP_RANDOM_LIMITS\.pluckForce\[1\]/);
  assert.match(auditionBlock, /const struck = await pluck\(/);
  assert.match(auditionBlock, /automatic: true/);
  assert.match(auditionBlock, /repeatStep = 1/);
  assert.match(auditionBlock, /repeatHitCount = 1/);
  assert.match(auditionBlock, /repeatIntervalMs\(state\.repeatRateBpm, 0, state\.repeatSwing\)/);
  const randomizeBlock = app.match(/function randomizeModel\(\) \{[\s\S]*?^\}/m)?.[0] ?? "";
  assert.match(randomizeBlock, /type: "silence"/);
  assert.match(randomizeBlock, /repeatStep = 0/);
  assert.match(randomizeBlock, /repeatHitCount = 0/);
  assert.match(randomizeBlock, /nextRepeatAt = randomizedAt/);
  assert.match(randomizeBlock, /startingBreathPhase = state\.autoBreath \? state\.breathBalance \* 0\.5 : 0/);
  assert.match(randomizeBlock, /resetBreathCycle\(startingBreathPhase\)/);
  assert.match(randomizeBlock, /resetVowelSequence\(\{ post: false, present: false \}\)/);
  assert.doesNotMatch(randomizeBlock, /vowelSequenceMode:\s*"off"/);
  assert.match(randomizeBlock, /commandedBreathFlow = breathFlowAt\(\)/);
  assert.match(randomizeBlock, /void auditionRandomizedModel\(\)/);
  assert.ok(
    randomizeBlock.indexOf("postConfiguration()")
      < randomizeBlock.indexOf("auditionRandomizedModel()"),
  );
  assert.match(app, /sendManualBreath\(manualBreathDirection \* state\.breathDepth\)/);
  assert.match(app, /function drawParameterPad\(/);
  assert.match(app, /function retimeRepeatClock\(/);
  assert.match(app, /function preserveBreathCyclePhase\(/);
  const setControlBlock = app.slice(
    app.indexOf("function setControl("),
    app.indexOf("function loadHarp("),
  );
  const pointerControlBlock = app.slice(
    app.indexOf("function commitParameterPatch("),
    app.indexOf("function installCanvasInteractions("),
  );
  assert.doesNotMatch(setControlBlock, /resetBreathCycle|repeatStep = 0|repeatHitCount = 0/);
  assert.doesNotMatch(pointerControlBlock, /resetBreathCycle|repeatStep = 0|repeatHitCount = 0/);
  assert.match(setControlBlock, /retimeRepeatClock\(previousState, changedAt\)/);
  assert.match(pointerControlBlock, /preserveBreathCyclePhase\(previousPhase, changedAt\)/);
  assert.match(app, /compressor\.threshold\.value = -22/);
  assert.match(app, /compressor\.knee\.value = 18/);
  assert.match(app, /compressor\.ratio\.value = 2\.5/);
  assert.match(app, /compressor\.attack\.value = 0\.008/);
  assert.match(app, /compressor\.release\.value = 0\.075/);
  assert.match(app, /sourceNode\.connect\(compressor\);[\s\S]*?compressor\.connect\(masterGain\);[\s\S]*?masterGain\.connect\(analyser\);/);
  assert.doesNotMatch(app, /ceilingGain/);
  assert.match(app, /function audioGraphIsRunning\(\)/);
  const audioGraphRunningBlock = app.slice(
    app.indexOf("function audioGraphIsRunning("),
    app.indexOf("async function toggleAudio("),
  );
  assert.match(audioGraphRunningBlock, /pageIsActive/);
  assert.match(audioGraphRunningBlock, /audioDesiredOn/);
  assert.match(audioGraphRunningBlock, /audioContext === graph\.context/);
  assert.match(audioGraphRunningBlock, /audioContext\.state === "running"/);
  const pluckBlock = app.slice(
    app.indexOf("async function pluck("),
    app.indexOf("function presentPluck("),
  );
  assert.match(pluckBlock, /startupNeeded = !audioGraphIsRunning\(\)/);
  assert.match(pluckBlock, /startupNeeded && !\(await ensureAudio\(\)\)/);
  assert.match(pluckBlock, /startupNeeded && requestSerial !== pluckRequestSerial/);
  assert.match(pluckBlock, /naturalTineStrike\(state, \{ velocity, direction, position \}\)\.force/);
  assert.match(pluckBlock, /postNextReferenceGesture\(\)/);
  assert.match(pluckBlock, /type: "strike-tine"/);
  assert.doesNotMatch(pluckBlock, /type: "pluck"/);
  const releaseTineBlock = app.slice(
    app.indexOf("async function releaseTine("),
    app.indexOf("function clearPointerInteraction("),
  );
  assert.match(releaseTineBlock, /audioGraphIsRunning\(\) \? true : await ensureAudio\(\)/);
  assert.match(releaseTineBlock, /postNextReferenceGesture\(\)/);
  assert.match(releaseTineBlock, /type: "release-tine"/);
  const loadHarpBlock = app.slice(
    app.indexOf("function loadHarp("),
    app.indexOf("function loadVowel("),
  );
  assert.match(loadHarpBlock, /audioGraphIsRunning\(\) && !tineIsHeld/);
  assert.match(loadHarpBlock, /breathNoiseAmount: state\.breathNoiseAmount/);
  assert.match(loadHarpBlock, /breathFilter: state\.breathFilter/);
  const referencePerformanceBlock = app.slice(
    app.indexOf("function markReferencePerformanceCustom("),
    app.indexOf("function loadVowel("),
  );
  assert.match(referencePerformanceBlock, /referencePerformanceBaseline/);
  assert.match(referencePerformanceBlock, /applyJawHarpStyle\(state, style\.id\)/);
  assert.match(referencePerformanceBlock, /level: retainedLevel/);
  assert.match(referencePerformanceBlock, /repeat: retainedRepeat/);
  assert.match(referencePerformanceBlock, /\.\.\.baseline\.settings/);
  assert.match(referencePerformanceBlock, /preserveBreathCyclePhase\(previousPhase, changedAt\)/);
  assert.doesNotMatch(referencePerformanceBlock, /type: "silence"/);
  const midiBlock = app.slice(
    app.indexOf("function handleMidiInput("),
    app.indexOf("function tick("),
  );
  assert.match(midiBlock, /message\.type === "noteOn"/);
  assert.match(midiBlock, /event\.preventDefault\(\)/);
  assert.match(midiBlock, /source === "wax"[\s\S]*?morphazoidWaxOutputMode === "midi"/);
  assert.match(midiBlock, /Number\.isFinite\(numericNote\)/);
  assert.match(midiBlock, /setControl\("reedFrequencyHz", frequency\)/);
  assert.match(midiBlock, /Number\(message\.velocity\)[\s\S]*?\/ 127/);
  assert.match(midiBlock, /void pluck\(\{ velocity, automatic: true, announcePluck: false \}\)/);
  const tickBlock = app.slice(app.indexOf("function tick("), app.indexOf("buildPresets();"));
  assert.match(tickBlock, /updateBreathVowelSequence\(time\)/);
  assert.match(tickBlock, /velocity: hit\.velocity/);
  assert.match(app, /function followManualBreathWithVowel\(/);
  assert.match(app, /manualBreathDirection[\s\S]*?resetBreathSequenceClock\(time\)/);
  assert.match(app, /addEventListener\("morphazoid:midi-input", handleMidiInput\)/);
  assert.match(app, /function responsiveAnatomyScale\(width, height, compact\)/);
  assert.match(app, /Math\.min\(width \/ 460, height \/ 330\), 0\.68, 1/);
  assert.match(app, /const mouthY = cssHeight \* \(compact \? 0\.48 : 0\.51\)/);
  assert.match(app, /cssHeight - mouthY - 132 \* anatomyScale/);
  assert.match(app, /mouthY \+ jawGap \+ 126 \* anatomyScale/);
  assert.match(app, /\(compact \? 360 : 510\) \* anatomyScale/);
  assert.match(app, /230 \* anatomyScale/);
  assert.match(app, /function drawHair\(/);
  assert.match(app, /const headOverlapY = compact \? 3 : 5/);
  assert.match(app, /const frontHairY = topY \+ 28 \+ headOverlapY/);
  assert.match(app, /const backHairY = topY \+ 49 \+ headOverlapY/);
  assert.match(app, /topY \+ \(frontHairY - topY\) \* anatomyScale/);
  assert.match(app, /topY \+ \(backHairY - topY\) \* anatomyScale/);
  assert.match(app, /function drawEye\(/);
  assert.match(app, /1 \+ exhale \* 0\.36 - inhale \* 0\.11/);
  assert.doesNotMatch(app, /function drawSpectrum\(|MOUTH-SELECTED PARTIAL/);
  assert.match(app, /function lipExtensionPixels\(/);
  assert.match(app, /maximumRetraction/);
  assert.match(app, /maximumProtrusion/);
  assert.match(app, /noseProjection/);
  assert.match(app, /nearestDistance/);
  assert.match(app, /audioPresentationStatus === "on"/);
  assert.match(app, /addEventListener\("pageshow"/);
  assert.match(app, /manual: false/);
  assert.match(app, /pointercancel", cancelPointer/);
  assert.match(processor, /registerProcessor\("jaw-harp-physical-model"/);
  assert.match(processor, /class StateVariableBandpass/);
  assert.match(processor, /message\.type === "strike-tine"/);
  assert.match(processor, /maximum displacement with zero velocity/);
  assert.match(processor, /fast finger strike adds another released-displacement state/);
  assert.match(processor, /retrigger supplies energy without phase-braking/);
  assert.match(processor, /COEFFICIENT_REED/);
  assert.match(processor, /coefficientMaskForKey/);
  assert.match(processor, /_updateCoefficients\(coefficientMask = COEFFICIENT_ALL\)/);
  assert.match(processor, /const SINE_TABLE = new Float64Array\(SINE_TABLE_SIZE\)/);
  assert.match(processor, /const INHALE_AIR_WEIGHTS_DRY = new Float64Array\(MODE_COUNT\)/);
  assert.match(processor, /const EXHALE_AIR_WEIGHTS_WET = new Float64Array\(MODE_COUNT\)/);
  const renderSourceBlock = processor.slice(
    processor.indexOf("  _renderSource()"),
    processor.indexOf("  _radiate(source, side)"),
  );
  assert.match(renderSourceBlock, /fastSine\(phase\)/);
  assert.doesNotMatch(renderSourceBlock, /Math\.sin|Math\.pow\(harmonic|% \(Math\.PI \* 2\)/);
  const radiateBlock = processor.match(/_radiate\(source, side\) \{[\s\S]*?^  \}/m)?.[0] ?? "";
  assert.match(processor, /const INHALE_FORMANT_WEIGHTS = Object\.freeze\(\[/);
  assert.match(processor, /const EXHALE_FORMANT_WEIGHTS = Object\.freeze\(\[/);
  assert.match(processor, /const REST_FORMANT_WEIGHTS = Object\.freeze\(\[/);
  assert.match(radiateBlock, /INHALE_FORMANT_WEIGHTS/);
  assert.match(radiateBlock, /EXHALE_FORMANT_WEIGHTS/);
  assert.match(radiateBlock, /REST_FORMANT_WEIGHTS/);
  assert.doesNotMatch(
    radiateBlock,
    /(?:=|\?|:)\s*\[\s*-?(?:\d|\.)|Array\.from|new\s+(?:Array|Float(?:32|64)Array)/,
  );
  assert.match(processor, /message\.type === "breath"/);
  assert.match(processor, /_automaticBreathFlow\(\)/);
  assert.match(processor, /focusFilterLeft/);
});
