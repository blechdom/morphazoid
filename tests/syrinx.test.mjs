import assert from "node:assert/strict";
import test from "node:test";

import {
  ANIMALS,
  CALL_GESTURES,
  DEFAULT_SYRINX_STATE,
  animalState,
  callsForAnimal,
  interpolateGesture,
  modulateSyrinxState,
  randomizeSyrinxState,
  resolveSourceControls,
  sampleModulationWave,
  sanitizeSyrinxState,
} from "../src/syrinx.js";
import { syrinxSourceModelId } from "../src/syrinx-source-models.js";

const ANIMAL_IDS = Object.freeze([
  "lion",
  "wolf",
  "dog",
  "elephant",
  "alligator",
  "cat",
  "horse",
  "reddeer",
  "hyena",
  "wildboar",
  "cow",
  "raven",
  "songbird",
  "dove",
  "owl",
  "bullfrog",
  "treefrog",
  "mouse",
]);

const SOURCE_FAMILY_IDS = Object.freeze([
  "mammal",
  "bird",
  "frog",
  "rodent",
]);

const CONTINUOUS_CONTROLS = Object.freeze([
  "pressure",
  "tension",
  "adduction",
  "sourceScale",
  "tractLengthM",
  "mouthOpening",
  "cavityCoupling",
  "asymmetry",
  "sourceBalance",
  "roughness",
  "gestureRate",
]);

function assertFiniteTree(value, label = "value", seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    assertFiniteTree(child, `${label}.${key}`, seen);
  }
}

function assertCompleteControls(state, label) {
  assert.ok(state && typeof state === "object", `${label} must resolve a state`);
  for (const control of CONTINUOUS_CONTROLS) {
    assert.ok(Number.isFinite(state[control]), `${label}.${control} must be finite`);
  }
  assert.ok(SOURCE_FAMILY_IDS.includes(state.sourceModel), `${label} needs a physical source family`);
  assertFiniteTree(state, label);
}

function assertRange(range, label, { positive = false } = {}) {
  assert.ok(Array.isArray(range), `${label} must be a [minimum, maximum] pair`);
  assert.equal(range.length, 2, `${label} must contain exactly two limits`);
  assert.ok(Number.isFinite(range[0]), `${label} minimum must be finite`);
  assert.ok(Number.isFinite(range[1]), `${label} maximum must be finite`);
  assert.ok(range[0] <= range[1], `${label} limits must be ordered`);
  if (positive) assert.ok(range[0] > 0, `${label} minimum must be positive`);
}

function assertBiologicalBounds(animalId, state, label = animalId) {
  const animal = ANIMALS[animalId];
  assert.equal(animal.biologicalLock, true, `${animalId} must keep biological lock enabled`);
  assert.equal(state.biologicalLock, true, `${label} must retain its biological lock`);
  assertRange(animal.frequencyRangeHz, `${animalId}.frequencyRangeHz`, { positive: true });
  assert.ok(animal.bounds && typeof animal.bounds === "object", `${animalId} needs control bounds`);
  assert.ok(Object.keys(animal.bounds).length >= 1, `${animalId} needs at least one bounded control`);
  for (const [control, range] of Object.entries(animal.bounds)) {
    assertRange(range, `${animalId}.bounds.${control}`);
    assert.ok(Number.isFinite(state[control]), `${label}.${control} must be finite`);
    assert.ok(
      state[control] >= range[0] && state[control] <= range[1],
      `${label}.${control} must stay in ${range[0]}..${range[1]}`,
    );
  }
}

test("animal presets cover four physical source families with complete playable state", () => {
  assert.deepEqual(Object.keys(ANIMALS), ANIMAL_IDS);
  assert.ok(Object.keys(CALL_GESTURES).length >= ANIMAL_IDS.length);

  const states = ANIMAL_IDS.map((animalId) => {
    const state = animalState(animalId);
    assert.equal(state.animalId, animalId);
    assertCompleteControls(state, animalId);
    assertBiologicalBounds(animalId, state);

    const calls = callsForAnimal(animalId);
    assert.ok(Array.isArray(calls), `${animalId} calls must be an array`);
    assert.ok(calls.length >= 1, `${animalId} needs at least one call gesture`);
    assert.equal(
      new Set(calls.map(({ id }) => id)).size,
      calls.length,
      `${animalId} calls must be unique`,
    );
    assert.ok(
      calls.some(({ id }) => id === state.callId),
      `${animalId} default call must belong to the animal`,
    );
    for (const call of calls) {
      assert.equal(CALL_GESTURES[call.id], call, `${animalId} references missing call ${call.id}`);
    }
    return state;
  });

  assert.deepEqual(
    [...new Set(states.map(({ sourceModel }) => sourceModel))].sort(),
    [...SOURCE_FAMILY_IDS].sort(),
    "the menu must expose mammal, bird, frog, and whistle source physics",
  );
  assert.equal(animalState("wolf").sourceModel, "mammal");
  assert.equal(animalState("lion").sourceModel, "mammal");
  assert.equal(animalState("dog").sourceModel, "mammal");
  assert.equal(animalState("elephant").sourceModel, "mammal");
  assert.equal(animalState("alligator").sourceModel, "mammal");
  assert.equal(animalState("songbird").sourceModel, "bird");
  assert.equal(animalState("raven").sourceModel, "bird");
  assert.equal(animalState("bullfrog").sourceModel, "frog");
  assert.equal(animalState("mouse").sourceModel, "rodent");
});

test("new researched mammals expose additive call banks without replacing legacy presets", () => {
  const expectedCalls = {
    cat: ["cat-meow", "cat-purr"],
    horse: ["horse-whinny", "horse-nicker"],
    reddeer: ["reddeer-common-roar", "reddeer-harsh-roar"],
    hyena: ["hyena-whoop", "hyena-giggle"],
    wildboar: ["wildboar-grunt", "wildboar-squeal"],
    cow: ["cow-moo", "cow-contact"],
  };
  for (const [animalId, callIds] of Object.entries(expectedCalls)) {
    assert.deepEqual(ANIMALS[animalId].callIds, callIds);
    assert.deepEqual(callsForAnimal(animalId).map(({ id }) => id), callIds);
  }
  assert.equal(resolveSourceControls(interpolateGesture("cat-purr", 0.5, animalState("cat"))).frequencyHz >= 25, true);
});

test("randomization preserves selected animal, call, loop, and safe bounds", () => {
  const before = animalState("wolf", { callId: "wolf-howl", loop: true, biologicalLock: false });
  const after = randomizeSyrinxState(before, () => 0.75);
  assert.equal(after.animalId, before.animalId);
  assert.equal(after.callId, before.callId);
  assert.equal(after.loop, true);
  assert.equal(after.biologicalLock, false);
  assert.notEqual(after.pressure, before.pressure);
});

test("assignable modulators move targets without mutating their baseline", () => {
  const baseline = animalState("wolf", { biologicalLock: false, active: true });
  const snapshot = structuredClone(baseline);
  const modulated = modulateSyrinxState(baseline, [{
    enabled: true,
    target: "tension",
    shape: "sine",
    rateHz: 1,
    depth: 0.5,
  }], 0.25);
  assert.ok(modulated.tension > baseline.tension);
  assert.equal(modulated.active, true);
  assert.deepEqual(baseline, snapshot);
  assert.equal(sampleModulationWave("triangle", 0.5), 1);
  assert.equal(sampleModulationWave("square", 0.75), -1);
});

test("Syrinx state sanitation rejects invalid selectors and keeps physical controls bounded", () => {
  const fallback = animalState("raven");
  const snapshot = structuredClone(fallback);
  const sanitized = sanitizeSyrinxState({
    animalId: "not-an-animal",
    callId: "not-a-call",
    sourceModel: "not-a-model",
    pressure: Number.POSITIVE_INFINITY,
    tension: Number.NaN,
    adduction: -1e9,
    sourceScale: 1e9,
    tractLengthM: -1e9,
    mouthOpening: 1e9,
    cavityCoupling: -1e9,
    asymmetry: 1e9,
    sourceBalance: -1e9,
    roughness: 1e9,
    gestureRate: -1e9,
  }, fallback);

  assertCompleteControls(sanitized, "sanitized");
  assertBiologicalBounds(sanitized.animalId, sanitized, "sanitized");
  assert.equal(sanitized.animalId, fallback.animalId);
  assert.equal(sanitized.callId, fallback.callId);
  assert.equal(sanitized.sourceModel, fallback.sourceModel);
  assert.deepEqual(fallback, snapshot, "sanitizing must not mutate its fallback state");

  for (const key of [
    "pressure",
    "tension",
    "adduction",
    "mouthOpening",
    "cavityCoupling",
    "asymmetry",
    "sourceBalance",
    "roughness",
  ]) {
    assert.ok(sanitized[key] >= 0 && sanitized[key] <= 1, `${key} must stay in its unit range`);
  }
  assert.ok(sanitized.sourceScale > 0);
  assert.ok(sanitized.tractLengthM > 0);
  assert.ok(sanitized.gestureRate > 0);
  assert.deepEqual(DEFAULT_SYRINX_STATE, sanitizeSyrinxState());
});

test("animal overrides and call gestures resolve into finite source controls", () => {
  for (const animalId of ANIMAL_IDS) {
    const animal = ANIMALS[animalId];
    const hostileOverrides = { biologicalLock: true };
    let useUpperBound = false;
    for (const control of Object.keys(animal.bounds)) {
      hostileOverrides[control] = useUpperBound ? 1e9 : -1e9;
      useUpperBound = !useUpperBound;
    }
    const base = animalState(animalId, hostileOverrides);
    assertBiologicalBounds(animalId, base, `${animalId}.overrides`);

    for (const [control, [minimum, maximum]] of Object.entries(animal.bounds)) {
      assert.equal(
        animalState(animalId, { [control]: -1e9 })[control],
        minimum,
        `${animalId}.${control} must clamp to its biological minimum`,
      );
      assert.equal(
        animalState(animalId, { [control]: 1e9 })[control],
        maximum,
        `${animalId}.${control} must clamp to its biological maximum`,
      );
    }

    const baseSource = resolveSourceControls(base);
    assertFiniteTree(baseSource, `${animalId}.source`);
    assert.ok(
      baseSource.frequencyHz >= animal.frequencyRangeHz[0]
        && baseSource.frequencyHz <= animal.frequencyRangeHz[1],
      `${animalId} source frequency must stay in its species/family range`,
    );

    for (const call of callsForAnimal(animalId)) {
      const frames = [0, 0.125, 0.5, 0.875, 1].map((phase) => (
        interpolateGesture(call, phase, base)
      ));
      for (const [index, frame] of frames.entries()) {
        assertCompleteControls(frame, `${animalId}.${call.id}[${index}]`);
        const source = resolveSourceControls(frame);
        assertFiniteTree(source, `${animalId}.${call.id}[${index}].source`);
        assert.ok(
          source.frequencyHz >= animal.frequencyRangeHz[0]
            && source.frequencyHz <= animal.frequencyRangeHz[1],
          `${animalId}.${call.id}[${index}] frequency must stay biologically bounded`,
        );
      }

      const signatures = frames.map((frame) => CONTINUOUS_CONTROLS
        .map((control) => frame[control].toFixed(7))
        .join(":"));
      assert.ok(
        new Set(signatures).size > 1,
        `${animalId}.${call.id} must move at least one synthesis control over time`,
      );
    }
  }
});

test("gesture interpolation clamps phase and does not mutate presets", () => {
  const animal = animalState("songbird");
  const call = callsForAnimal("songbird")[0];
  const animalSnapshot = structuredClone(animal);
  const callSnapshot = structuredClone(CALL_GESTURES[call.id]);

  assert.deepEqual(
    interpolateGesture(call, -100, animal),
    interpolateGesture(call, 0, animal),
  );
  assert.deepEqual(
    interpolateGesture(call, 100, animal),
    interpolateGesture(call, 1, animal),
  );
  assertCompleteControls(interpolateGesture(call, Number.NaN, animal), "NaN phase");
  assert.deepEqual(animal, animalSnapshot);
  assert.deepEqual(CALL_GESTURES[call.id], callSnapshot);
});

test("the Syrinx worklet joins each source family to a finite variable-length tract", async (t) => {
  const originalSampleRate = Object.getOwnPropertyDescriptor(globalThis, "sampleRate");
  const originalProcessor = Object.getOwnPropertyDescriptor(globalThis, "AudioWorkletProcessor");
  const originalRegister = Object.getOwnPropertyDescriptor(globalThis, "registerProcessor");
  t.after(() => {
    for (const [name, descriptor] of [
      ["sampleRate", originalSampleRate],
      ["AudioWorkletProcessor", originalProcessor],
      ["registerProcessor", originalRegister],
    ]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  let processorName = "";
  let ProcessorConstructor = null;
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      const messages = [];
      this.messages = messages;
      this.port = {
        onmessage: null,
        postMessage(message) { messages.push(message); },
      };
    }
  };
  globalThis.registerProcessor = (name, Constructor) => {
    processorName = name;
    ProcessorConstructor = Constructor;
  };

  const { tractDiameterAt, tractSectionCount } = await import(
    `../src/syrinx-processor.js?test=${Date.now()}`
  );
  assert.equal(processorName, "syrinx-physical-model");
  assert.equal(typeof ProcessorConstructor, "function");
  assert.ok(tractSectionCount(0.75) > tractSectionCount(0.17));
  assert.ok(tractSectionCount(0.17) > tractSectionCount(0.022));

  const profilePositions = [0, 0.18, 0.4, 0.62, 0.82, 1];
  const profileSignatures = ["lion", "wolf", "raven", "bullfrog", "mouse"]
    .map((animalId) => {
      const controls = resolveSourceControls(animalState(animalId));
      return profilePositions.map((position) => tractDiameterAt(position, {
        ...controls,
        animalId,
      }));
    });
  assert.equal(
    new Set(profileSignatures.map((profile) => JSON.stringify(profile))).size,
    profileSignatures.length,
    "representative animals need distinct tract diameter profiles",
  );
  for (const profile of profileSignatures) {
    assert.ok(profile.every((diameter) => Number.isFinite(diameter) && diameter > 0));
  }

  const ravenBase = {
    ...resolveSourceControls(animalState("raven")),
    animalId: "raven",
  };
  const tonguePosition = 0.68;
  const untonguedDiameter = tractDiameterAt(tonguePosition, ravenBase);
  const tonguedDiameter = tractDiameterAt(tonguePosition, {
    ...ravenBase,
    tongueEnabled: true,
    tongueAnatomy: "human",
    tonguePosition: 0.58,
    tongueHeight: 0.8,
    tongueShape: 0.5,
    tongueTip: 0.35,
  });
  assert.ok(tonguedDiameter < untonguedDiameter, "tongue geometry must constrict the host waveguide");

  const speedOfSound = 343;
  const waveguideRateForTest = (outputRate) => (
    outputRate <= 50_000 ? outputRate * 2 : Math.min(outputRate, 96_000)
  );
  const fullLengthPolicies = [48_000, 96_000, 192_000].map((outputRate) => {
    const sections = tractSectionCount(0.82, outputRate);
    const waveguideRate = waveguideRateForTest(outputRate);
    return {
      outputRate,
      sections,
      physicalLengthM: sections * speedOfSound / waveguideRate,
      halfCellM: speedOfSound / (waveguideRate * 2),
    };
  });
  assert.equal(
    new Set(fullLengthPolicies.map(({ sections }) => sections)).size,
    1,
    "the 0.82 m tract must not shorten at high output sample rates",
  );
  for (const policy of fullLengthPolicies) {
    assert.ok(
      Math.abs(policy.physicalLengthM - 0.82) <= policy.halfCellM + 1e-12,
      `${policy.outputRate} Hz should represent 0.82 m within half a delay cell`,
    );
  }

  const renderAnimal = (animalId, active = true) => {
    const state = animalState(animalId, { active });
    const controls = resolveSourceControls(state);
    const processor = new ProcessorConstructor({
      processorOptions: {
        configuration: {
          source: controls,
          tract: controls,
          seed: 0x51f15e,
        },
      },
    });
    const samples = [];
    let peak = 0;
    let squareSum = 0;
    let sampleCount = 0;
    for (let block = 0; block < 180; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]), `${animalId} left ${block}:${index}`);
        assert.ok(Number.isFinite(right[index]), `${animalId} right ${block}:${index}`);
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        if (block >= 120) {
          squareSum += left[index] ** 2 + right[index] ** 2;
          sampleCount += 2;
          samples.push(left[index], right[index]);
        }
      }
    }
    return {
      processor,
      samples,
      peak,
      rms: Math.sqrt(squareSum / Math.max(1, sampleCount)),
    };
  };

  const representatives = ["lion", "raven", "bullfrog", "mouse"]
    .map((animalId) => [animalId, renderAnimal(animalId)]);
  for (const [animalId, rendered] of representatives) {
    assert.ok(rendered.rms > 1e-7, `${animalId} must reach the tract output`);
    assert.ok(rendered.peak <= 0.940001, `${animalId} must respect the output limiter`);
    const telemetry = rendered.processor.messages.filter(({ type }) => type === "telemetry");
    assert.ok(telemetry.length >= 1, `${animalId} must report physical-model telemetry`);
    assert.equal(
      telemetry.at(-1).model,
      syrinxSourceModelId(resolveSourceControls(animalState(animalId)).model),
    );
    assert.ok(Number.isFinite(telemetry.at(-1).tractLengthM));
    assert.ok(telemetry.at(-1).sections >= 5);
  }

  const signatures = representatives.map(([, { samples }]) => samples);
  for (let first = 0; first < signatures.length; first += 1) {
    for (let second = first + 1; second < signatures.length; second += 1) {
      let squareDifference = 0;
      for (let index = 0; index < signatures[first].length; index += 1) {
        squareDifference += (signatures[first][index] - signatures[second][index]) ** 2;
      }
      const differenceRms = Math.sqrt(squareDifference / signatures[first].length);
      assert.ok(
        differenceRms > 1e-6,
        `${representatives[first][0]} and ${representatives[second][0]} need distinct renders`,
      );
    }
  }

  const silent = renderAnimal("lion", false);
  assert.equal(silent.peak, 0, "an inactive pressure source must leave a reset tract silent");

  const lionState = animalState("lion", { active: true });
  const lionSource = resolveSourceControls(lionState);
  const configurationProcessor = new ProcessorConstructor({
    processorOptions: {
      configuration: {
        source: lionSource,
        tract: {
          animalId: "lion",
          tractLengthM: lionState.tractLengthM,
          mouthOpening: lionState.mouthOpening,
          cavityCoupling: lionState.cavityCoupling,
          cavityFrequencyHz: ANIMALS.lion.cavityFrequencyHz,
        },
        seed: 0x51f15e,
      },
    },
  });
  const sourceModelBeforeTractUpdate = configurationProcessor.source.target.model;
  configurationProcessor.port.onmessage({
    data: {
      type: "configure",
      tract: {
        animalId: "raven",
        tractLengthM: ANIMALS.raven.tractLengthM,
        mouthOpening: ANIMALS.raven.controls.mouthOpening,
        cavityCoupling: ANIMALS.raven.controls.cavityCoupling,
        cavityFrequencyHz: ANIMALS.raven.cavityFrequencyHz,
      },
    },
  });
  assert.equal(configurationProcessor.source.target.model, sourceModelBeforeTractUpdate);
  assert.equal(configurationProcessor.configuration.model, sourceModelBeforeTractUpdate);

  const resetLengthM = ANIMALS.elephant.tractLengthM;
  const resetSectionCount = tractSectionCount(resetLengthM, 48_000);
  configurationProcessor.port.onmessage({
    data: {
      type: "configure",
      tract: {
        animalId: "elephant",
        tractLengthM: resetLengthM,
        mouthOpening: ANIMALS.elephant.controls.mouthOpening,
        cavityCoupling: ANIMALS.elephant.controls.cavityCoupling,
        cavityFrequencyHz: ANIMALS.elephant.cavityFrequencyHz,
      },
      resetTract: true,
    },
  });
  assert.equal(configurationProcessor.targetSections, resetSectionCount);
  assert.equal(
    configurationProcessor.activeSections,
    resetSectionCount,
    "resetTract must install its requested delay length before the next render block",
  );

  const idleState = animalState("raven", { active: false });
  const idleProcessor = new ProcessorConstructor({
    processorOptions: {
      configuration: {
        source: resolveSourceControls(idleState),
        tract: {
          animalId: "raven",
          tractLengthM: idleState.tractLengthM,
          mouthOpening: idleState.mouthOpening,
          cavityCoupling: idleState.cavityCoupling,
          cavityFrequencyHz: ANIMALS.raven.cavityFrequencyHz,
        },
        seed: 0x51f15e,
      },
    },
  });
  let idlePeak = 0;
  const idleBlockCount = Math.ceil(2 * 48_000 / 128);
  for (let block = 0; block < idleBlockCount; block += 1) {
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    assert.equal(idleProcessor.process([], [[left, right]]), true);
    for (let index = 0; index < left.length; index += 1) {
      idlePeak = Math.max(idlePeak, Math.abs(left[index]), Math.abs(right[index]));
    }
  }
  assert.equal(idlePeak, 0, "two seconds of inactive rendering must remain silent");

  idleProcessor.port.onmessage({
    data: {
      type: "configure",
      source: resolveSourceControls(animalState("raven", { active: true })),
    },
  });
  let sustainedSquareSum = 0;
  let sustainedSampleCount = 0;
  let nonzeroTailBlocks = 0;
  const activationBlocks = 220;
  const tailBlocks = 60;
  for (let block = 0; block < activationBlocks; block += 1) {
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    assert.equal(idleProcessor.process([], [[left, right]]), true);
    if (block < activationBlocks - tailBlocks) continue;
    let blockEnergy = 0;
    for (let index = 0; index < left.length; index += 1) {
      blockEnergy += left[index] ** 2 + right[index] ** 2;
      sustainedSquareSum += left[index] ** 2 + right[index] ** 2;
      sustainedSampleCount += 2;
    }
    if (blockEnergy > 1e-12) nonzeroTailBlocks += 1;
  }
  const sustainedRms = Math.sqrt(sustainedSquareSum / sustainedSampleCount);
  assert.ok(sustainedRms > 1e-7, "an activated idle worklet must reach sustained output");
  assert.ok(
    nonzeroTailBlocks >= tailBlocks * 0.9,
    "activation must remain nonzero across the render tail, not emit one transient",
  );
});
