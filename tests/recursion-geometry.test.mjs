import assert from "node:assert/strict";
import test from "node:test";

import {
  causalCurve,
  geometryTrace,
  motionCoordinates,
  stackPoint,
  torusPoint,
} from "../src/recursion-geometry.js";
import { buildRecursionPlan } from "../src/recursion.js";

const EPSILON = 1e-9;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function near(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertCoordinate(coordinate, moment, momentIndex) {
  assert.ok(Number.isInteger(coordinate.pulseIndex) && coordinate.pulseIndex >= 0);
  assert.equal(coordinate.generation, moment.depth);
  assert.equal(coordinate.momentIndex, momentIndex);
  for (const key of [
    "u",
    "v",
    "w",
    "time",
    "spectrum",
    "rhythm",
    "phrase",
    "energy",
    "delay",
  ]) {
    assert.ok(Number.isFinite(coordinate[key]), `${key} must be finite`);
    assert.ok(
      coordinate[key] >= 0 && coordinate[key] <= 1,
      `${key} must be normalized`,
    );
  }
  for (const key of ["pitch", "pan"]) {
    assert.ok(Number.isFinite(coordinate[key]), `${key} must be finite`);
    assert.ok(coordinate[key] >= -1 && coordinate[key] <= 1);
  }
  assert.ok(coordinate.orientation === -1 || coordinate.orientation === 1);
  assert.equal(typeof coordinate.channelSwap, "boolean");
  assert.equal(typeof coordinate.active, "boolean");
}

function assertProjected(point) {
  assert.deepEqual(Object.keys(point), ["x", "y", "z", "scale", "alpha"]);
  for (const key of ["x", "y", "z", "scale", "alpha"]) {
    assert.ok(Number.isFinite(point[key]), `${key} must be finite`);
  }
  assert.ok(Math.abs(point.x) <= 2.5);
  assert.ok(Math.abs(point.y) <= 2.5);
  assert.ok(Math.abs(point.z) <= 2.5);
  assert.ok(point.scale > 0 && point.scale <= 2);
  assert.ok(point.alpha >= 0 && point.alpha <= 1);
}

function changed(left, right, keys) {
  return keys.some((key) => Math.abs(left[key] - right[key]) > EPSILON);
}

test("motion coordinates are deterministic normalized readings of actual DSP pulses", () => {
  const plan = buildRecursionPlan("spectral-mobius", {
    depth: 4,
    pace: 3.4,
    transform: 0.83,
    intensity: 0.91,
  });
  const momentIndex = 2;
  const moment = plan.moments[momentIndex];
  const before = clone(moment);
  const coordinates = motionCoordinates(moment, {
    momentIndex,
    maxDepth: 4,
  });

  assert.deepEqual(moment, before, "coordinate extraction must not mutate the score");
  assert.deepEqual(
    coordinates,
    motionCoordinates(moment, { momentIndex, maxDepth: 4 }),
  );
  assert.equal(coordinates.length, moment.motion.pulses.length);
  coordinates.forEach((coordinate) => assertCoordinate(
    coordinate,
    moment,
    momentIndex,
  ));
  assert.deepEqual(
    coordinates.map((coordinate) => coordinate.pulseIndex),
    Array.from({ length: coordinates.length }, (_, index) => index),
  );
  assert.ok(new Set(coordinates.map((coordinate) => coordinate.u.toFixed(4))).size >= 4);
  assert.ok(new Set(coordinates.map((coordinate) => coordinate.v.toFixed(4))).size >= 4);
  assert.ok(new Set(coordinates.map((coordinate) => coordinate.w.toFixed(4))).size >= 4);

  const first = coordinates[0];
  const pulse = moment.motion.pulses[0];
  near(first.pan, pulse.pan);
  assert.equal(first.orientation, pulse.timeDirection);
  assert.equal(first.channelSwap, pulse.channelSwap);

  const phraseMutation = clone(moment);
  phraseMutation.motion.pulses[0].sourcePosition = (
    phraseMutation.motion.pulses[0].sourcePosition < 0.5 ? 0.97 : 0.03
  );
  const phraseCoordinate = motionCoordinates(
    phraseMutation,
    { momentIndex, maxDepth: 4 },
  )[0];
  assert.ok(changed(first, phraseCoordinate, ["u", "phrase"]));

  const spectrumMutation = clone(moment);
  spectrumMutation.motion.pulses[0].filterHz = (
    spectrumMutation.motion.pulses[0].filterHz < 2_000 ? 14_000 : 80
  );
  const spectrumCoordinate = motionCoordinates(
    spectrumMutation,
    { momentIndex, maxDepth: 4 },
  )[0];
  assert.ok(changed(first, spectrumCoordinate, ["v", "spectrum"]));

  const pitchMutation = clone(moment);
  pitchMutation.motion.pulses[0].playbackRate = (
    pitchMutation.motion.pulses[0].playbackRate < 1 ? 2.8 : 0.48
  );
  pitchMutation.motion.pulses[0].pitchEnd *= -1;
  const pitchCoordinate = motionCoordinates(
    pitchMutation,
    { momentIndex, maxDepth: 4 },
  )[0];
  assert.ok(changed(first, pitchCoordinate, ["pitch"]));

  const rhythmMutation = clone(moment);
  rhythmMutation.motion.pulses[0].offset = moment.duration * 0.72;
  rhythmMutation.motion.pulses[0].delay = Math.min(
    plan.motionCaps.maxDelaySeconds,
    pulse.delay + 0.4,
  );
  const rhythmCoordinate = motionCoordinates(
    rhythmMutation,
    { momentIndex, maxDepth: 4 },
  )[0];
  assert.ok(changed(first, rhythmCoordinate, ["w", "time", "rhythm", "delay"]));
});

test("orbit, stack, and causal projections stay finite while exposing different geometry", () => {
  const plan = buildRecursionPlan("ouroboros-tape", {
    depth: 3,
    intensity: 0.88,
  });
  const coordinates = motionCoordinates(plan.moments[2], {
    momentIndex: 2,
    maxDepth: 3,
  });
  const options = {
    rotation: 0.37,
    twist: 1.4,
    depthScale: 0.22,
  };
  const sample = coordinates[Math.floor(coordinates.length / 3)];

  const orbit = torusPoint(sample, options);
  const stack = stackPoint(sample, options);
  assert.deepEqual(orbit, torusPoint(sample, options));
  assert.deepEqual(stack, stackPoint(sample, options));
  assertProjected(orbit);
  assertProjected(stack);
  assert.ok(changed(orbit, stack, ["x", "y", "z"]));

  const movedAroundOrbit = torusPoint({
    ...sample,
    u: (sample.u + 0.5) % 1,
    phrase: (sample.phrase + 0.5) % 1,
  }, options);
  const movedThroughSpectrum = torusPoint({
    ...sample,
    v: (sample.v + 0.5) % 1,
    spectrum: (sample.spectrum + 0.5) % 1,
  }, options);
  assertProjected(movedAroundOrbit);
  assertProjected(movedThroughSpectrum);
  assert.ok(changed(orbit, movedAroundOrbit, ["x", "y", "z"]));
  assert.ok(changed(orbit, movedThroughSpectrum, ["x", "y", "z"]));

  const curveInput = coordinates.slice(0, 12);
  const curve = causalCurve(curveInput, options);
  assert.deepEqual(curve, causalCurve(curveInput, options));
  assert.ok(Array.isArray(curve) && curve.length >= curveInput.length);
  assert.ok(curve.length <= curveInput.length * 16);
  curve.forEach(assertProjected);
  assert.ok(
    new Set(curve.map((point) => (
      `${point.x.toFixed(4)}:${point.y.toFixed(4)}:${point.z.toFixed(4)}`
    ))).size >= curveInput.length,
  );
});

test("geometry traces preserve ancestry and active progress under deterministic point caps", () => {
  const plan = buildRecursionPlan("phase-labyrinth", {
    depth: 7,
    pace: 2,
    intensity: 0.95,
  });
  const totalPulses = plan.moments.reduce(
    (total, moment) => total + moment.motion.pulses.length,
    0,
  );
  const maximumDepth = Math.max(...plan.moments.map((moment) => moment.depth));
  const options = {
    maxPoints: 73,
    activeMomentIndex: 4,
    progress: 0.46,
  };
  const trace = geometryTrace(plan.moments, options);

  assert.deepEqual(trace, geometryTrace(plan.moments, options));
  assert.equal(trace.totalPoints, totalPulses);
  assert.equal(trace.maxDepth, maximumDepth);
  assert.equal(trace.truncated, true);
  assert.ok(trace.points.length > 0 && trace.points.length <= options.maxPoints);
  assert.ok(Array.isArray(trace.edges));
  trace.points.forEach((coordinate) => {
    const moment = plan.moments[coordinate.momentIndex];
    assertCoordinate(coordinate, moment, coordinate.momentIndex);
  });

  const representedMoments = new Set(
    trace.points.map((coordinate) => coordinate.momentIndex),
  );
  assert.ok(representedMoments.size >= Math.min(6, plan.moments.length));
  assert.ok(representedMoments.has(0), "the root generation must survive decimation");
  assert.ok(
    representedMoments.has(plan.moments.length - 1),
    "the deepest/final generation must survive decimation",
  );
  assert.ok(representedMoments.has(options.activeMomentIndex));

  const active = trace.points.filter((coordinate) => coordinate.active);
  assert.ok(active.length > 0);
  assert.ok(active.every((coordinate) => (
    coordinate.momentIndex === options.activeMomentIndex
    && coordinate.time <= options.progress + 1e-9
  )));
  assert.ok(trace.points.some((coordinate) => (
    coordinate.momentIndex === options.activeMomentIndex && !coordinate.active
  )));

  for (const edge of trace.edges) {
    assert.ok(Number.isInteger(edge.from));
    assert.ok(Number.isInteger(edge.to));
    assert.ok(edge.from >= 0 && edge.from < trace.points.length);
    assert.ok(edge.to >= 0 && edge.to < trace.points.length);
    assert.notEqual(edge.from, edge.to);
  }

  const full = geometryTrace(plan.moments.slice(0, 3), {
    maxPoints: 512,
    activeMomentIndex: -1,
    progress: 0,
  });
  assert.equal(full.truncated, false);
  assert.equal(full.points.length, full.totalPoints);
  assert.ok(full.points.every((coordinate) => !coordinate.active));
});
