import assert from "node:assert/strict";
import test from "node:test";

import {
  FERAL_TONGUE_PRESETS,
  TONGUE_MOTION_PRESETS,
  TONGUE_PARAMETER_LIMITS,
  modulateTongueState,
  sampleTongueMotionPreset,
} from "../src/tongue-performance.js";
import {
  CONTROL_LIMITS,
  MODULATION_TARGETS,
} from "../src/syrinx.js";

const ARTICULATION_UNIT_PARAMETERS = Object.freeze([
  "lateralBypass",
  "flutterDepth",
  "turbulence",
  "voicing",
  "burstGain",
]);
const SUPPORTED_MODULATION_SHAPES = Object.freeze([
  "sine",
  "triangle",
  "square",
  "sample-hold",
]);

function assertBounded(value, minimum, maximum, message) {
  assert.ok(Number.isFinite(value), `${message} must be finite`);
  assert.ok(value >= minimum, `${message} must be at least ${minimum}; got ${value}`);
  assert.ok(value <= maximum, `${message} must be at most ${maximum}; got ${value}`);
}

function assertCompleteMotionSample(sample, id, time) {
  const context = `${id} at ${time.toFixed(3)} s`;
  assert.equal(sample.id, id);
  assert.equal(sample.articulation.active, true);

  for (const [parameter, [minimum, maximum]] of Object.entries(TONGUE_PARAMETER_LIMITS)) {
    assertBounded(sample.tongue[parameter], minimum, maximum, `${context} ${parameter}`);
  }

  for (const [parameter, value] of Object.entries(sample.host)) {
    assert.ok(Number.isFinite(value), `${context} host ${parameter} must be finite`);
    if (CONTROL_LIMITS[parameter]) {
      assertBounded(value, ...CONTROL_LIMITS[parameter], `${context} host ${parameter}`);
    }
  }

  for (const parameter of ARTICULATION_UNIT_PARAMETERS) {
    assertBounded(sample.articulation[parameter], 0, 1, `${context} ${parameter}`);
  }
  for (const parameter of ["airwayGate", "gatePosition"]) {
    if (sample.articulation[parameter] !== null) {
      assertBounded(sample.articulation[parameter], 0, 1, `${context} ${parameter}`);
    }
  }
  assertBounded(sample.articulation.flutterHz, 0, 60, `${context} flutterHz`);
  assert.ok(
    sample.articulation.flowDirection === -1 || sample.articulation.flowDirection === 1,
    `${context} flowDirection must be -1 or 1`,
  );
  assertBounded(
    sample.articulation.burstFrequencyHz,
    80,
    20_000,
    `${context} burstFrequencyHz`,
  );
}

test("every tongue motion stays finite, bounded, and animated across its phases", () => {
  const times = Array.from({ length: 257 }, (_, index) => index * 0.03125);

  for (const id of Object.keys(TONGUE_MOTION_PRESETS)) {
    const signatures = new Set();
    for (const time of times) {
      const sample = sampleTongueMotionPreset(id, time);
      assertCompleteMotionSample(sample, id, time);
      signatures.add(JSON.stringify({
        tongue: sample.tongue,
        host: sample.host,
        articulation: sample.articulation,
      }));
    }
    assert.ok(signatures.size > 1, `${id} must change over time`);
  }
});

test("P and B share a closure gesture but keep unvoiced and voiced releases distinct", () => {
  const pClosed = sampleTongueMotionPreset("p", 0);
  const bClosed = sampleTongueMotionPreset("b", 0);
  const pReleased = sampleTongueMotionPreset("p", 0.72 / 2.9);
  const bReleased = sampleTongueMotionPreset("b", 0.72 / 2.65);

  assert.deepEqual(pClosed.tongue, bClosed.tongue);
  assert.equal(pClosed.articulation.airwayGate, 0);
  assert.equal(bClosed.articulation.airwayGate, 0);
  assert.equal(pReleased.articulation.airwayGate, 1);
  assert.equal(bReleased.articulation.airwayGate, 1);

  assert.equal(pReleased.articulation.voicing, 0);
  assert.equal(bReleased.articulation.voicing, 1);
  assert.ok(pReleased.host.adduction < bReleased.host.adduction);
  assert.ok(pReleased.host.roughness > bReleased.host.roughness);
  assert.ok(pReleased.articulation.turbulence > bReleased.articulation.turbulence);
  assert.ok(pReleased.articulation.burstGain > bReleased.articulation.burstGain);
  assert.ok(
    pReleased.articulation.burstFrequencyHz > bReleased.articulation.burstFrequencyHz,
  );
});

test("L keeps a voiced lateral bypass while its tongue tip constricts the center", () => {
  const lateral = sampleTongueMotionPreset("l", 0.25);
  const centralStop = sampleTongueMotionPreset("p", 0);
  const effectiveOpening = lateral.articulation.lateralBypass
    + lateral.articulation.airwayGate * (1 - lateral.articulation.lateralBypass);

  assert.ok(lateral.tongue.tongueTip > 0.9);
  assert.ok(lateral.tongue.tongueHeight > 0.75);
  assert.ok(lateral.articulation.airwayGate < 0.2);
  assert.ok(lateral.articulation.lateralBypass > 0.5);
  assert.ok(effectiveOpening > 0.6);
  assert.equal(lateral.articulation.voicing, 1);
  assert.equal(lateral.articulation.burstGain, 0);
  assert.equal(centralStop.articulation.lateralBypass, 0);
});

test("rolled R and raspberry hand stable high-rate flutter controls to the worklet", () => {
  const expected = {
    "rolled-r": { flutterHz: 24, flutterDepth: 0.94 },
    raspberry: { flutterHz: 18.5, flutterDepth: 0.98 },
  };

  for (const [id, flutter] of Object.entries(expected)) {
    for (const time of [0, 0.137, 0.521, 1.913]) {
      const articulation = sampleTongueMotionPreset(id, time).articulation;
      assert.equal(articulation.flutterHz, flutter.flutterHz);
      assert.equal(articulation.flutterDepth, flutter.flutterDepth);
      assert.ok(articulation.airwayGate < 0.1);
    }
  }
  assert.ok(expected["rolled-r"].flutterHz > expected.raspberry.flutterHz);
});

test("feral presets completely cover every modulatable host and tongue parameter", () => {
  const hostTargets = [...MODULATION_TARGETS].sort();
  const tongueTargets = Object.keys(TONGUE_PARAMETER_LIMITS).sort();

  for (const [id, preset] of Object.entries(FERAL_TONGUE_PRESETS)) {
    assert.equal(preset.id, id);
    assert.ok(preset.label.length > 0);
    assert.ok(TONGUE_MOTION_PRESETS[preset.motion], `${id} must name a real motion preset`);
    assert.deepEqual(Object.keys(preset.host).sort(), hostTargets);
    assert.deepEqual(Object.keys(preset.tongue).sort(), tongueTargets);

    for (const target of hostTargets) {
      assertBounded(preset.host[target], ...CONTROL_LIMITS[target], `${id} host ${target}`);
    }
    for (const target of tongueTargets) {
      assertBounded(
        preset.tongue[target],
        ...TONGUE_PARAMETER_LIMITS[target],
        `${id} tongue ${target}`,
      );
    }

    assertBounded(preset.modulation.rateBase, 0.02, 30, `${id} modulation rateBase`);
    assertBounded(preset.modulation.rateSpread, 0, 30, `${id} modulation rateSpread`);
    assertBounded(preset.modulation.depth, 0, 1, `${id} modulation depth`);
    assert.ok(preset.modulation.shapes.length > 0);
    for (const shape of preset.modulation.shapes) {
      assert.ok(SUPPORTED_MODULATION_SHAPES.includes(shape), `${id} has unknown ${shape} shape`);
    }
  }
});

test("every modulation waveform moves parameters without escaping their limits", () => {
  const center = Object.fromEntries(
    Object.keys(TONGUE_PARAMETER_LIMITS).map((target) => [target, 0.5]),
  );

  for (const [target, [minimum, maximum]] of Object.entries(TONGUE_PARAMETER_LIMITS)) {
    for (const shape of SUPPORTED_MODULATION_SHAPES) {
      const values = Array.from({ length: 161 }, (_, index) => (
        modulateTongueState(center, [{
          enabled: true,
          target,
          shape,
          rateHz: index % 2 ? 30_000 : -30_000,
          depth: 10,
          phase: 0.173,
        }], index / 80)[target]
      ));
      assert.ok(values.every((value) => Number.isFinite(value)));
      assert.ok(values.every((value) => value >= minimum && value <= maximum));
      assert.ok(new Set(values).size > 1, `${shape} modulation must move ${target}`);
    }
  }

  const pinned = modulateTongueState(
    Object.fromEntries(Object.keys(TONGUE_PARAMETER_LIMITS).map((target) => [target, 1])),
    Object.keys(TONGUE_PARAMETER_LIMITS).map((target, index) => ({
      enabled: true,
      target,
      shape: SUPPORTED_MODULATION_SHAPES[index % SUPPORTED_MODULATION_SHAPES.length],
      rateHz: Number.POSITIVE_INFINITY,
      depth: Number.POSITIVE_INFINITY,
      phase: index * 0.19,
    })),
    123.456,
  );
  for (const [target, [minimum, maximum]] of Object.entries(TONGUE_PARAMETER_LIMITS)) {
    assertBounded(pinned[target], minimum, maximum, `stacked ${target}`);
  }
});
