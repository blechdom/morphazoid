import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ANIMALS,
  CALL_GESTURES,
  animalState,
  callsForAnimal,
  interpolateGesture,
  modulateSyrinxState,
  resolveSyrinxOutputLevel,
  resolveSyrinxPresetGain,
  resolveSourceControls,
} from "../src/syrinx.js";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const CONFIGURE_EVERY_BLOCKS = 12;
const OUTPUT_LIMIT = 0.940001;
const REFERENCE_MARGIN = 10 ** (3 / 20);
const BIRD_REFERENCE_IDS = Object.freeze(["raven", "songbird", "dove", "owl"]);

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `Unable to isolate ${name}`);
  return source.slice(start, end);
}

function processorConfiguration(animalId, state) {
  const controls = resolveSourceControls(state);
  return {
    source: controls,
    tract: {
      ...controls,
      animalId,
      cavityFrequencyHz: ANIMALS[animalId].cavityFrequencyHz,
    },
  };
}

function renderGesture(ProcessorConstructor, animalId, gesture, capture = false) {
  // The same call ID drives the shared post-model preset gain in Syrinx UI,
  // Tongued Beasts, and Hybrinx (including edited Hybrinx contours).
  const base = animalState(animalId, { callId: gesture.id });
  const initial = interpolateGesture(gesture, 0, base);
  const initialConfiguration = processorConfiguration(animalId, initial);
  const processor = new ProcessorConstructor({
    processorOptions: {
      configuration: {
        ...initialConfiguration,
        seed: 0x51f15e,
      },
    },
  });
  const frameCount = Math.max(1, Math.round(gesture.durationMs * SAMPLE_RATE / 1_000));
  const blockCount = Math.ceil(frameCount / BLOCK_SIZE);
  const measured = capture ? new Float32Array(frameCount * 2) : null;
  let squareSum = 0;
  let sampleCount = 0;
  let peak = 0;

  for (let block = 0; block < blockCount; block += 1) {
    if (block % CONFIGURE_EVERY_BLOCKS === 0) {
      const phase = Math.min(1, block * BLOCK_SIZE / frameCount);
      const state = interpolateGesture(gesture, phase, base);
      processor.port.onmessage({
        data: {
          type: "configure",
          ...processorConfiguration(animalId, state),
        },
      });
    }
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    assert.equal(processor.process([], [[left, right]]), true);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absoluteFrame = block * BLOCK_SIZE + frame;
      const leftSample = left[frame];
      const rightSample = right[frame];
      assert.ok(Number.isFinite(leftSample), `${animalId} left output must remain finite`);
      assert.ok(Number.isFinite(rightSample), `${animalId} right output must remain finite`);
      peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
      if (absoluteFrame >= frameCount) continue;
      if (measured) {
        measured[absoluteFrame * 2] = leftSample;
        measured[absoluteFrame * 2 + 1] = rightSample;
      }
      squareSum += leftSample * leftSample + rightSample * rightSample;
      sampleCount += 2;
    }
  }
  const rawRms = Math.sqrt(squareSum / sampleCount);
  const outputLevel = resolveSyrinxOutputLevel(initial);
  return Object.freeze({
    measured,
    outputLevel,
    rawPeak: peak,
    rawRms,
    peak: peak * outputLevel,
    rms: rawRms * outputLevel,
  });
}

function renderManualPreset(ProcessorConstructor, animalId) {
  // Manual breath and tongue performances do not carry a gesture frequency
  // ratio, so the resolver deliberately selects the animal's manual trim.
  const state = animalState(animalId, { active: true });
  const processor = new ProcessorConstructor({
    processorOptions: {
      configuration: {
        ...processorConfiguration(animalId, state),
        seed: 0x51f15e,
      },
    },
  });
  let squareSum = 0;
  let sampleCount = 0;
  let rawPeak = 0;
  const warmupBlocks = 120;
  const measureBlocks = 140;

  for (let block = 0; block < warmupBlocks + measureBlocks; block += 1) {
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    assert.equal(processor.process([], [[left, right]]), true);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const leftSample = left[frame];
      const rightSample = right[frame];
      assert.ok(Number.isFinite(leftSample), `${animalId} manual left output must remain finite`);
      assert.ok(Number.isFinite(rightSample), `${animalId} manual right output must remain finite`);
      rawPeak = Math.max(rawPeak, Math.abs(leftSample), Math.abs(rightSample));
      if (block < warmupBlocks) continue;
      squareSum += leftSample * leftSample + rightSample * rightSample;
      sampleCount += 2;
    }
  }

  const outputLevel = resolveSyrinxOutputLevel(state);
  const rawRms = Math.sqrt(squareSum / sampleCount);
  return Object.freeze({
    outputLevel,
    rawPeak,
    rawRms,
    peak: rawPeak * outputLevel,
    rms: rawRms * outputLevel,
  });
}

test("preset trims are frozen, bounded, and routed independently from user level", async () => {
  for (const [callId, gesture] of Object.entries(CALL_GESTURES)) {
    assert.equal(Object.isFrozen(gesture), true, `${callId} metadata must be frozen`);
    assert.ok(
      Number.isFinite(gesture.levelTrim)
        && gesture.levelTrim >= 0.05
        && gesture.levelTrim <= 1,
      `${callId}.levelTrim must be a valid attenuation`,
    );
  }
  for (const [animalId, animal] of Object.entries(ANIMALS)) {
    assert.equal(Object.isFrozen(animal), true, `${animalId} metadata must be frozen`);
    assert.ok(
      Number.isFinite(animal.manualLevelTrim)
        && animal.manualLevelTrim >= 0.05
        && animal.manualLevelTrim <= 1,
      `${animalId}.manualLevelTrim must be a valid attenuation`,
    );
  }

  const manualHorse = animalState("horse", { active: true, level: 0.8 });
  const whinny = interpolateGesture(
    CALL_GESTURES["horse-whinny"],
    0.5,
    animalState("horse", { callId: "horse-whinny", level: 0.8 }),
  );
  assert.equal(resolveSyrinxPresetGain(manualHorse), ANIMALS.horse.manualLevelTrim);
  assert.equal(resolveSyrinxPresetGain(whinny), CALL_GESTURES["horse-whinny"].levelTrim);
  assert.ok(resolveSyrinxPresetGain(manualHorse) < 1, "manual horse breath needs calibration");
  assert.ok(resolveSyrinxPresetGain(whinny) < 1, "horse whinny needs call calibration");
  assert.equal(
    resolveSyrinxPresetGain(modulateSyrinxState(manualHorse, [], 0)),
    ANIMALS.horse.manualLevelTrim,
    "host modulation must not turn manual breath into a call contour",
  );
  assert.equal(
    resolveSyrinxPresetGain(modulateSyrinxState(whinny, [], 0)),
    CALL_GESTURES["horse-whinny"].levelTrim,
    "host modulation must retain an active call's contour trim",
  );
  assert.ok(
    Math.abs(resolveSyrinxOutputLevel(manualHorse) - 0.8 * ANIMALS.horse.manualLevelTrim) < 1e-12,
  );
  assert.ok(
    Math.abs(
      resolveSyrinxOutputLevel(whinny)
        - 0.8 * CALL_GESTURES["horse-whinny"].levelTrim,
    ) < 1e-12,
  );

  const app = await readFile(new URL("../syrinx-app.js", import.meta.url), "utf8");
  const postConfiguration = functionBody(app, "postConfiguration", "setAudioPresentation");
  const createAudioGraph = functionBody(app, "createAudioGraph", "ensureAudio");
  const updatePerformance = functionBody(app, "updatePerformance", "updateHybrinxTimeline");
  assert.match(
    postConfiguration,
    /presetGain\.gain\.setTargetAtTime\(\s*resolveSyrinxPresetGain\(soundingState\),\s*audioContext\.currentTime,\s*0\.025,?\s*\)/,
  );
  assert.match(
    postConfiguration,
    /masterGain\.gain\.setTargetAtTime\(\s*clamp\(soundingState\.level\),\s*audioContext\.currentTime,\s*0\.025,?\s*\)/,
    "the Level control must remain independent from preset calibration",
  );
  assert.match(createAudioGraph, /const presetGain = context\.createGain\(\)/);
  assert.match(createAudioGraph, /presetGain\.gain\.value = resolveSyrinxPresetGain\(state\)/);
  assert.match(createAudioGraph, /masterGain\.gain\.value = state\.level/);
  assert.match(
    createAudioGraph,
    /sourceNode\.connect\(presetGain\);\s*presetGain\.connect\(masterGain\);\s*masterGain\.connect\(compressor\)/,
    "calibration must remain post-model and pre-user-level/compressor",
  );
  assert.match(createAudioGraph, /return \{[^}]*sourceNode[^}]*presetGain[^}]*masterGain[^}]*compressor/s);
  assert.match(
    updatePerformance,
    /gestureSourceFrequencyRatio\s*=\s*performanceState\.sourceFrequencyRatio[\s\S]*Number\.isFinite\(gestureSourceFrequencyRatio\)[\s\S]*sourceFrequencyRatio:\s*gestureSourceFrequencyRatio/,
    "tongue motion must preserve call identity so Tongued Beasts keeps the call trim",
  );
});

test("shared Syrinx call and manual presets stay near the bird loudness band", async (t) => {
  const globals = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"];
  const originalDescriptors = new Map(
    globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  t.after(() => {
    for (const name of globals) {
      const descriptor = originalDescriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  let processorName = "";
  let ProcessorConstructor = null;
  globalThis.sampleRate = SAMPLE_RATE;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  };
  globalThis.registerProcessor = (name, Constructor) => {
    processorName = name;
    ProcessorConstructor = Constructor;
  };
  await import(`../src/syrinx-processor.js?loudness-test=${Date.now()}`);
  assert.equal(processorName, "syrinx-physical-model");
  assert.equal(typeof ProcessorConstructor, "function");

  const renders = new Map();
  for (const animalId of Object.keys(ANIMALS)) {
    for (const gesture of callsForAnimal(animalId)) {
      const rendered = renderGesture(
        ProcessorConstructor,
        animalId,
        gesture,
        gesture.id === "horse-whinny",
      );
      assert.ok(rendered.rms > 1e-7, `${gesture.id} must remain audible`);
      assert.ok(
        Number.isFinite(rendered.outputLevel)
          && rendered.outputLevel >= 0
          && rendered.outputLevel <= 1,
        `${gesture.id} must resolve a finite bounded output level`,
      );
      assert.ok(rendered.rawPeak <= OUTPUT_LIMIT, `${gesture.id} raw peak ${rendered.rawPeak}`);
      assert.ok(rendered.peak <= OUTPUT_LIMIT, `${gesture.id} effective peak ${rendered.peak}`);
      renders.set(gesture.id, rendered);
    }
  }

  const birdRms = BIRD_REFERENCE_IDS.flatMap((animalId) => (
    callsForAnimal(animalId).map(({ id }) => renders.get(id).rms)
  ));
  const birdCeiling = Math.max(...birdRms);
  assert.ok(birdCeiling > 0.005, "bird references must remain usefully audible");
  const alignedCeiling = birdCeiling * REFERENCE_MARGIN;

  const loudCalls = [...renders]
    .filter(([, { rms }]) => rms > alignedCeiling)
    .map(([gestureId, { rms }]) => `${gestureId} (${rms.toFixed(6)})`);
  assert.deepEqual(
    loudCalls,
    [],
    `calls exceeding bird RMS ${birdCeiling.toFixed(6)} by more than 3 dB: ${loudCalls.join(", ")}`,
  );

  const horse = renders.get("horse-whinny");
  assert.ok(horse.rms <= alignedCeiling, "the horse whinny must align with bird presets");
  const repeatedHorse = renderGesture(
    ProcessorConstructor,
    "horse",
    callsForAnimal("horse")[0],
    true,
  );
  assert.deepEqual(repeatedHorse.measured, horse.measured, "the seeded loudness render is deterministic");
  assert.equal(repeatedHorse.rawRms, horse.rawRms);
  assert.equal(repeatedHorse.rawPeak, horse.rawPeak);
  assert.equal(repeatedHorse.rms, horse.rms);
  assert.equal(repeatedHorse.peak, horse.peak);

  const manualRenders = new Map(
    Object.keys(ANIMALS).map((animalId) => [
      animalId,
      renderManualPreset(ProcessorConstructor, animalId),
    ]),
  );
  for (const [animalId, rendered] of manualRenders) {
    assert.ok(rendered.rms > 1e-7, `${animalId} manual breath must remain audible`);
    assert.ok(
      Number.isFinite(rendered.outputLevel)
        && rendered.outputLevel >= 0
        && rendered.outputLevel <= 1,
      `${animalId} manual output level must remain finite and bounded`,
    );
    assert.ok(rendered.rawPeak <= OUTPUT_LIMIT, `${animalId} manual raw peak ${rendered.rawPeak}`);
    assert.ok(rendered.peak <= OUTPUT_LIMIT, `${animalId} manual effective peak ${rendered.peak}`);
  }
  const birdManualCeiling = Math.max(
    ...BIRD_REFERENCE_IDS.map((animalId) => manualRenders.get(animalId).rms),
  );
  assert.ok(birdManualCeiling > 0.005, "manual bird references must remain usefully audible");
  const alignedManualCeiling = birdManualCeiling * REFERENCE_MARGIN;
  const loudManualPresets = [...manualRenders]
    .filter(([, { rms }]) => rms > alignedManualCeiling)
    .map(([animalId, { rms }]) => `${animalId} (${rms.toFixed(6)})`);
  assert.deepEqual(
    loudManualPresets,
    [],
    `manual presets exceeding bird RMS ${birdManualCeiling.toFixed(6)} by more than 3 dB: ${loudManualPresets.join(", ")}`,
  );
});
