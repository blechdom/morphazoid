import assert from "node:assert/strict";
import test from "node:test";

import {
  WEBGPU_303_BUFFER_PARAM_ORDER,
  WEBGPU_303_SEQUENCE_LENGTH,
  WEBGPU_303_LIMITS,
  WEBGPU_303_STEP_MODULATION_LIMITS,
  sanitizeWebGpu303Params,
} from "../src/webgpu-303.js";
import {
  HYPER_RUBIX_WEBGPU_303_DEFAULTS,
  createHyperRubixWebGpu303Pattern,
} from "../src/hyper-rubix-webgpu-303.js";
import {
  createHyperRubixStickerStream,
  createSolvedHyperRubix,
  hyperRubixSizeMetrics,
  turnHyperRubixBoundaryCell,
} from "../src/hyper-rubix.js";

function assertFinitePattern(pattern) {
  assert.equal(pattern.sequence.length, pattern.requiredSequenceCapacity);
  assert.equal(pattern.stepModulation.length, pattern.requiredSequenceCapacity);
  assert.ok(pattern.sequence.every(Number.isFinite));
  for (const modulation of pattern.stepModulation) {
    assert.equal(modulation.length, 4);
    assert.ok(modulation.every(Number.isFinite));
  }
  assert.deepEqual(pattern.params, sanitizeWebGpu303Params(pattern.params));
  assert.deepEqual(Object.keys(pattern.params), WEBGPU_303_BUFFER_PARAM_ORDER);
  for (const key of WEBGPU_303_BUFFER_PARAM_ORDER) {
    if (key === "timeMod") continue;
    const [minimum, maximum] = WEBGPU_303_LIMITS[key];
    assert.ok(pattern.params[key] >= minimum && pattern.params[key] <= maximum);
  }
  for (const modulation of pattern.stepModulation) {
    modulation.forEach((value, componentIndex) => {
      const [minimum, maximum] = WEBGPU_303_STEP_MODULATION_LIMITS[componentIndex];
      assert.ok(value >= minimum && value <= maximum);
    });
  }
}

test("Hyper Rubix WebGPU 303 defaults are safe, frozen, and leave modulation headroom", () => {
  assert.ok(Object.isFrozen(HYPER_RUBIX_WEBGPU_303_DEFAULTS));
  assert.deepEqual(
    HYPER_RUBIX_WEBGPU_303_DEFAULTS,
    sanitizeWebGpu303Params(HYPER_RUBIX_WEBGPU_303_DEFAULTS),
  );
  assert.ok(HYPER_RUBIX_WEBGPU_303_DEFAULTS.gain < 0.12);
  assert.ok(HYPER_RUBIX_WEBGPU_303_DEFAULTS.partials < 128);
});

for (const size of [2, 3, 4]) {
  test(`order-${size} Hyper Rubix maps every sticker into one forward serial note`, () => {
    const puzzle = createSolvedHyperRubix(size);
    const metrics = hyperRubixSizeMetrics(puzzle);
    const pattern = createHyperRubixWebGpu303Pattern(puzzle, {
      tempo: 120,
      subdivisionsPerBeat: 4,
      swing: 0.2,
    });

    assertFinitePattern(pattern);
    assert.equal(pattern.params.timeMod, metrics.stickerStreamLength);
    assert.equal(pattern.params.timeScale, 8);
    assert.equal(pattern.params.swing, 0.2);
    assert.equal(pattern.steps.length, metrics.stickerStreamLength);
    assert.equal(pattern.requiredSequenceCapacity, metrics.stickerStreamLength);
    assert.equal(
      pattern.runtimeCompatible,
      metrics.stickerStreamLength <= WEBGPU_303_SEQUENCE_LENGTH,
    );
    assert.equal(new Set(pattern.steps.map(({ stickerId }) => stickerId)).size, metrics.stickerStreamLength);
    assert.deepEqual(
      pattern.steps.map(({ stickerId }) => stickerId),
      createHyperRubixStickerStream(puzzle).map(({ stickerId }) => stickerId),
      "the GPU score should retain the model's stable forward sticker order",
    );
    assert.ok(
      pattern.stepModulation.every(([gain]) => gain > 0),
      "every sticker pulse should be audible",
    );
    assert.ok(
      pattern.sequence.every((value) => value >= 0 && value < 1),
      "every sticker pulse should hold a drawn note",
    );
    assert.ok(Object.isFrozen(pattern));
    assert.ok(Object.isFrozen(pattern.sequence));
    assert.ok(Object.isFrozen(pattern.stepModulation));
    assert.ok(Object.isFrozen(pattern.steps));
    assert.equal(typeof pattern.fingerprint, "string");
    assert.ok(pattern.fingerprint.length > metrics.stickerStreamLength * 10);
  });
}

test("four-dimensional view rotation continuously changes the WebGPU sound mapping", () => {
  const puzzle = createSolvedHyperRubix(3);
  const still = createHyperRubixWebGpu303Pattern(puzzle, {
    rotation: { xy: 0, xz: 0, xw: 0, yz: 0, yw: 0, zw: 0 },
  });
  const folded = createHyperRubixWebGpu303Pattern(puzzle, {
    rotation: { xy: 19, xz: -27, xw: 73, yz: 31, yw: -48, zw: 22 },
  });

  assert.notDeepEqual(folded.params, still.params);
  assert.notDeepEqual(folded.sequence, still.sequence);
  assert.notDeepEqual(
    folded.stepModulation,
    still.stepModulation,
  );
  assert.notEqual(folded.fingerprint, still.fingerprint);
});

test("a manual puzzle twist reshapes the next GPU loop without adding rests", () => {
  const solved = createSolvedHyperRubix(3);
  const turned = turnHyperRubixBoundaryCell(solved, {
    cell: "w+",
    plane: "xy",
    quarterTurns: 1,
  });
  const before = createHyperRubixWebGpu303Pattern(solved);
  const after = createHyperRubixWebGpu303Pattern(turned);

  assert.notDeepEqual(after.params, before.params);
  assert.notDeepEqual(after.sequence, before.sequence);
  assert.notDeepEqual(
    after.stepModulation,
    before.stepModulation,
  );
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.ok(after.stepModulation.every(([gain]) => gain > 0));
  assert.ok(after.sequence.every((value) => value >= 0));
  assert.equal(solved.stickers.every((sticker) => Object.isFrozen(sticker)), true);
});

test("Hyper Rubix WebGPU mapper is deterministic and sanitizes extreme controls", () => {
  const puzzle = createSolvedHyperRubix(4);
  const options = {
    tempo: 900,
    subdivisionsPerBeat: 99,
    swing: 4,
    pitchInfluence: 99,
    filterInfluence: 99,
    stereoInfluence: 99,
    neighborResponse: 99,
    wInfluence: 99,
    disorderInfluence: 99,
    rotation: { xy: 720, xz: -450, xw: 91, yz: 181, yw: -273, zw: 47 },
    baseParams: {
      gain: 8,
      frequency: 999,
      fundamental: 99999,
      flt: -999,
      stereo: 999,
    },
  };
  const first = createHyperRubixWebGpu303Pattern(puzzle, options);
  const second = createHyperRubixWebGpu303Pattern(puzzle, options);

  assertFinitePattern(first);
  assert.deepEqual(first, second);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.params.timeMod, 512);
  assert.equal(first.requiredSequenceCapacity, 512);
  assert.equal(first.runtimeCompatible, WEBGPU_303_SEQUENCE_LENGTH >= 512);
  assert.equal(first.params.timeScale, 80);
  assert.equal(first.params.swing, 0.42);
});

test("Hyper Rubix WebGPU mapper rejects malformed option containers and rotations", () => {
  const puzzle = createSolvedHyperRubix();
  assert.throws(
    () => createHyperRubixWebGpu303Pattern(puzzle, []),
    /options must be an object/,
  );
  assert.throws(
    () => createHyperRubixWebGpu303Pattern(puzzle, { rotation: [] }),
    /rotation must be an object/,
  );
});
