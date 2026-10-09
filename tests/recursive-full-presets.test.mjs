import assert from "node:assert/strict";
import test from "node:test";

import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";
import { RECURSIVE_PRESET_PERFORMANCE_KEYS } from "../src/families/recursive/full-presets.js";
import {
  RECURSIVE_AM_FULL_PRESETS, recursiveAmPresets, randomizeRecursiveAmPreset,
} from "../src/instruments/recursive-am/full-presets.js";
import {
  RECURSIVE_FM_FULL_PRESETS, recursiveFmPresets, randomizeRecursiveFmPreset,
} from "../src/instruments/recursive-fm/full-presets.js";
import {
  RECURSIVE_PM_FULL_PRESETS, recursivePmPresets, randomizeRecursivePmPreset,
} from "../src/instruments/recursive-pm/full-presets.js";
import {
  RECURSIVE_AM_PRESETS, RecursiveAmProcessor, deriveRecursiveAmStack,
} from "../src/instruments/recursive-am/recursive-am.js";
import {
  RECURSIVE_FM_PRESETS, RECURSIVE_FM_PERFORMANCE_DEFAULTS,
} from "../src/instruments/recursive-fm/recursive-fm.js";
import {
  RECURSIVE_PM_PRESETS, deriveRecursivePmStack,
} from "../src/instruments/recursive-pm/recursive-pm.js";
import { RECURSIVE_AM_PERFORMANCE_DEFAULTS } from "../src/instruments/recursive-am/recursive-am-midi.js";
import { RECURSIVE_PM_PERFORMANCE_DEFAULTS } from "../src/instruments/recursive-pm/recursive-pm-midi.js";
import { fft } from "../src/instruments/recursion/recursion-spectral-dsp.js";

const PERFORMANCE_KEYS = [
  "ampAttackMs", "ampDecayMs", "ampSustainLevel", "ampReleaseMs",
  "glideMode", "glideTimeMs", "rootMidiNote", "pitchBendRangeSemitones",
];
const techniques = [
  { kind: "AM", api: recursiveAmPresets, bank: RECURSIVE_AM_FULL_PRESETS,
    randomize: randomizeRecursiveAmPreset, originals: RECURSIVE_AM_PRESETS,
    defaults: RECURSIVE_AM_PERFORMANCE_DEFAULTS,
    settingsKeys: ["depth", "carrierHz", "startModFrequencyHz", "frequencyDivisor", "startAmplitudeIndex", "indexDivisor"] },
  { kind: "FM", api: recursiveFmPresets, bank: RECURSIVE_FM_FULL_PRESETS,
    randomize: randomizeRecursiveFmPreset, originals: RECURSIVE_FM_PRESETS,
    defaults: RECURSIVE_FM_PERFORMANCE_DEFAULTS,
    settingsKeys: ["depth", "carrierHz", "offsetHz", "modulationHz", "divisor"] },
  { kind: "PM", api: recursivePmPresets, bank: RECURSIVE_PM_FULL_PRESETS,
    randomize: randomizeRecursivePmPreset, originals: RECURSIVE_PM_PRESETS,
    defaults: RECURSIVE_PM_PERFORMANCE_DEFAULTS,
    settingsKeys: ["depth", "carrierHz", "startModFrequencyHz", "frequencyDivisor", "startPhaseIndex", "indexDivisor"] },
];
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));
const musicalKey = snapshot => presetStateKey({ settings: snapshot.settings, performance: snapshot.performance });
const seededRandom = (initial = 901) => {
  let seed = initial;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
};

test("recursive snapshots explicitly own synthesis and eight performance fields", () => {
  assert.deepEqual(RECURSIVE_PRESET_PERFORMANCE_KEYS, PERFORMANCE_KEYS);
});

for (const { kind, api, bank, randomize, originals, defaults, settingsKeys } of techniques) {
  test(`Recursive ${kind} has twelve complete, musically distinct immutable scenes`, () => {
    validateFullPresetBank(bank);
    assert.equal(bank.length, 12);
    assert.equal(new Set(bank.map(preset => preset.id)).size, 12);
    // A different preset ID alone does not constitute a different musical scene.
    assert.equal(new Set(bank.map(preset => musicalKey(preset.snapshot))).size, 12);
    assert.equal(api.bank, bank);
    assert.equal(api.randomize, randomize);
    assert.ok(Object.isFrozen(bank));
    for (const preset of bank) {
      assert.ok(preset.label.trim() && preset.description.trim());
      const { snapshot } = preset;
      assert.deepEqual(Object.keys(snapshot).sort(), ["activePresetId", "performance", "settings", "version"]);
      assert.deepEqual(Object.keys(snapshot.settings).sort(), [...settingsKeys].sort());
      assert.deepEqual(Object.keys(snapshot.performance).sort(), [...PERFORMANCE_KEYS].sort());
      assert.equal(snapshot.activePresetId, preset.id);
      assert.equal(snapshot.version, 1);
      for (const value of [preset, snapshot, snapshot.settings, snapshot.performance]) assert.ok(Object.isFrozen(value));
      const validated = api.validate(snapshot);
      assert.deepEqual(validated, snapshot);
      assert.notEqual(validated.settings, snapshot.settings);
      assert.notEqual(validated.performance, snapshot.performance);
    }
  });

  test(`Recursive ${kind} retains the existing scene order, synthesis and default articulation`, () => {
    assert.deepEqual(bank.slice(0, originals.length).map(({ id, label, description, snapshot }) => ({
      id, label, description, settings: snapshot.settings,
    })), originals);
    for (const preset of bank.slice(0, originals.length)) {
      assert.deepEqual(preset.snapshot.performance, pick(defaults, PERFORMANCE_KEYS));
    }
  });

  test(`Recursive ${kind} capture excludes output, play mode, devices and derived runtime state`, () => {
    const scene = structuredClone(bank.at(-1).snapshot);
    const live = {
      ...scene,
      settings: { ...scene.settings, maximumFrequencyHz: 14400, normalizedGain: 0.2, level: 0.17 },
      performance: { ...scene.performance, playMode: "midi", heldNotes: [60, 67], expression: 0.45 },
      level: 0.31, outputLevel: 0.31, playMode: "drone", audioEnabled: true,
      running: true, clock: 123.45, midiEnabled: true, deviceId: "live-device", sustainDown: true,
    };
    const before = structuredClone(live);
    const captured = api.capture(live);
    assert.deepEqual(captured, scene);
    assert.deepEqual(live, before);
    captured.settings.carrierHz = 300;
    captured.performance.ampAttackMs = 400;
    assert.deepEqual(live, before, "a captured snapshot must not alias mutable live settings");
    assert.deepEqual(api.capture({ ...live, activePresetId: undefined }), { ...scene, activePresetId: null });
  });

  test(`Recursive ${kind} rejects incomplete, malformed and out-of-range snapshots without changing input`, () => {
    const bankBefore = presetStateKey(bank);
    const checkRejected = (mutate, label) => {
      const snapshot = structuredClone(bank[0].snapshot);
      mutate(snapshot);
      const before = structuredClone(snapshot);
      assert.throws(() => api.validate(snapshot), TypeError, label);
      assert.deepEqual(snapshot, before, `${label}: validation must not repair or mutate input`);
    };
    for (const value of [null, undefined, [], 1, "preset"]) {
      assert.throws(() => api.validate(value), TypeError);
    }
    for (const key of ["version", "settings", "performance", "activePresetId"]) {
      checkRejected(snapshot => { delete snapshot[key]; }, `missing ${key}`);
    }
    checkRejected(snapshot => { snapshot.version = 2; }, "unknown version");
    checkRejected(snapshot => { snapshot.activePresetId = "missing-preset"; }, "unknown scene");
    checkRejected(snapshot => { snapshot.level = 0.4; }, "output in snapshot");
    checkRejected(snapshot => { snapshot.settings.maximumFrequencyHz = 20000; }, "derived synthesis field");
    checkRejected(snapshot => { snapshot.performance.playMode = "drone"; }, "transport in performance");
    checkRejected(snapshot => { snapshot.performance.glideMode = "warp"; }, "unknown glide mode");
    checkRejected(snapshot => { snapshot.settings.depth = 2.5; }, "fractional depth");
    checkRejected(snapshot => { snapshot.performance.rootMidiNote = 60.5; }, "fractional MIDI root");
    for (const [group, keys] of [["settings", settingsKeys], ["performance", PERFORMANCE_KEYS]]) {
      for (const replacement of [null, []]) {
        checkRejected(snapshot => { snapshot[group] = replacement; }, `invalid ${group} record`);
      }
      for (const key of keys) {
        checkRejected(snapshot => { delete snapshot[group][key]; }, `missing ${group}.${key}`);
        for (const value of [undefined, null, NaN, Infinity, -Infinity, -1e9, 1e9, "12"]) {
          checkRejected(snapshot => { snapshot[group][key] = value; }, `invalid ${group}.${key}: ${value}`);
        }
      }
    }
    assert.equal(presetStateKey(bank), bankBefore);
    const custom = structuredClone(bank[0].snapshot);
    custom.activePresetId = null;
    assert.deepEqual(api.validate(custom), custom);
  });

  test(`Recursive ${kind} dice is seeded, pure, bounded and varies every owned musical field`, () => {
    const current = bank[0].snapshot;
    const before = presetStateKey(current);
    assert.deepEqual(randomize(current, seededRandom()), randomize(current, seededRandom()));
    const rng = seededRandom();
    const scenes = Array.from({ length: 256 }, () => randomize(current, rng));
    const factoryKeys = new Set(bank.map(preset => musicalKey(preset.snapshot)));
    assert.equal(new Set(scenes.map(musicalKey)).size, scenes.length);
    for (const scene of scenes) {
      assert.deepEqual(api.validate(scene), scene);
      assert.equal(scene.activePresetId, null);
      assert.ok(!factoryKeys.has(musicalKey(scene)), "dice must author a new scene, not select a factory preset");
      assert.ok(scene.performance.ampAttackMs >= 1 && scene.performance.ampAttackMs <= 60);
    }
    for (const [group, keys] of [["settings", settingsKeys], ["performance", PERFORMANCE_KEYS]]) {
      for (const key of keys) {
        assert.ok(new Set(scenes.map(scene => scene[group][key])).size > 1, `${group}.${key} is frozen`);
      }
    }
    assert.deepEqual(new Set(scenes.map(scene => scene.performance.glideMode)), new Set(["off", "legato", "always"]));
    assert.equal(presetStateKey(current), before);
    for (const edge of [-1, 0, 1, 2]) {
      const scene = randomize(current, () => edge);
      assert.deepEqual(api.validate(scene), scene, `bounded random source ${edge}`);
    }
    for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => randomize(current, () => invalid), TypeError);
  });
}

test("additional AM and PM voicings produce bounded audible output during their first quarter second", async () => {
  // Capture the actual PM worklet class without changing its public exports.
  let RecursivePmProcessor;
  const previousRegister = globalThis.registerProcessor;
  try {
    globalThis.registerProcessor = (_name, processor) => { RecursivePmProcessor = processor; };
    await import("../src/instruments/recursive-pm/recursive-pm.js?full-preset-render");
  } finally {
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
  }
  const rate = 48000;
  const frameCount = rate / 4;
  for (const [bank, originalCount, Processor, derive] of [
    [RECURSIVE_AM_FULL_PRESETS, RECURSIVE_AM_PRESETS.length, RecursiveAmProcessor, deriveRecursiveAmStack],
    [RECURSIVE_PM_FULL_PRESETS, RECURSIVE_PM_PRESETS.length, RecursivePmProcessor, deriveRecursivePmStack],
  ]) {
    for (const { id, snapshot } of bank.slice(originalCount)) {
      const stack = derive(snapshot.settings, { sampleRate: rate });
      const processor = new Processor();
      processor.port.onmessage({ data: { type: "settings", settings: stack.settings, immediate: true } });
      const samples = new Float32Array(frameCount);
      for (let offset = 0; offset < frameCount; offset += 128) {
        assert.equal(processor.process([], [[samples.subarray(offset, Math.min(frameCount, offset + 128))]]), true);
      }
      assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1.000001), id);
      const onset = samples.subarray(0, rate / 20);
      const onsetRms = Math.sqrt(onset.reduce((sum, sample) => sum + sample ** 2, 0) / onset.length);
      assert.ok(onsetRms * stack.normalizedGain > 0.02, `${id}: silent first 50 ms`);
      // Hann-windowed energy above 20 Hz rejects DC/subaudio-only false positives.
      const size = 4096;
      const spectrum = fft(Float64Array.from(samples.subarray(2048, 2048 + size),
        (sample, index) => sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1)))));
      let audiblePower = 0;
      for (let bin = 1; bin < size / 2; bin += 1) {
        const frequency = bin * rate / size;
        if (frequency >= 20 && frequency <= 20000) {
          audiblePower += 2 * (spectrum.real[bin] ** 2 + spectrum.imag[bin] ** 2);
        }
      }
      const audibleRms = Math.sqrt(audiblePower / (size ** 2 * 0.375)) * stack.normalizedGain;
      assert.ok(audibleRms > 0.05, `${id}: little audible spectral energy (${audibleRms})`);
    }
  }
});
