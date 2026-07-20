import assert from "node:assert/strict";
import test from "node:test";

import {
  addContourVertex,
  createContourTimeWarp,
  contourPitchRatioAt,
  fadeLoopEdges,
  loopPhaseAtTime,
  moveVertex,
  nearestContourPhase,
  paintDelayMask,
  pointOnContour,
  pitchShiftLoopSamplesByContour,
  phaseThroughContourTimeWarp,
  presetVertices,
  radialContourVertices,
  removeContourVertex,
  reverseSamples,
  scrubPhaseFromAngle,
  scrubRateFromMotion,
  sampleDelayMask,
  timeStretchLoopSamples,
  waveformEnvelope,
  wrap01,
} from "../src/lumber.js";

test("loop phase always closes at the recorded duration", () => {
  assert.equal(wrap01(-0.25), 0.75);
  assert.equal(loopPhaseAtTime(0, 2, 4), 0.5);
  assert.equal(loopPhaseAtTime(0, 4, 4), 0);
  assert.equal(loopPhaseAtTime(0.25, 1, 4, -1), 0);
  assert.equal(scrubPhaseFromAngle(0.25, Math.PI / 2), 0);
  assert.equal(scrubPhaseFromAngle(0.25, -Math.PI / 2), 0.5);
  assert.equal(scrubRateFromMotion(0.025, 4, 100), 1);
});

test("radial vertex edits remain straight between adjacent handles", () => {
  const vertices = radialContourVertices([0, 0.5, 0, -0.2]);
  const midpoint = pointOnContour(vertices, 1.5 / vertices.length);
  assert.ok(Math.abs(midpoint.x - (vertices[1].x + vertices[2].x) / 2) < 1e-12);
  assert.ok(Math.abs(midpoint.y - (vertices[1].y + vertices[2].y) / 2) < 1e-12);
  assert.deepEqual(radialContourVertices([0, 99, 0])[1], {
    x: Math.cos(-Math.PI / 2 + Math.PI * 2 / 3) * 1.62,
    y: Math.sin(-Math.PI / 2 + Math.PI * 2 / 3) * 1.62,
  });
});

test("presets seed freely editable two-dimensional contours", () => {
  const triangle = presetVertices("triangle");
  const square = presetVertices("square");
  const circle = presetVertices("circle", 12);
  assert.equal(triangle.length, 3);
  assert.equal(square.length, 4);
  assert.equal(circle.length, 12);

  const moved = moveVertex(square, 0, { x: 1.4, y: -0.25 });
  assert.deepEqual(moved[0], { x: 1.4, y: -0.25 });
  assert.notDeepEqual(moved[0], square[0]);
  assert.deepEqual(moveVertex(square, 0, { x: 99, y: -99 })[0], { x: 1.8, y: -1.8 });
});

test("vertices can be inserted and removed without locking the preset", () => {
  const triangle = presetVertices("triangle");
  const four = addContourVertex(triangle);
  assert.equal(four.length, 4);
  assert.equal(removeContourVertex(four, 1).length, 3);
  assert.equal(removeContourVertex(triangle, 0).length, 3);
});

test("contour hit testing follows arbitrary skewed edges", () => {
  const vertices = [
    { x: -1.2, y: -0.5 },
    { x: 1.4, y: -0.8 },
    { x: 0.7, y: 1.3 },
    { x: -0.5, y: 0.8 },
  ];
  const point = pointOnContour(vertices, 0.125);
  assert.ok(Math.abs(point.x - 0.1) < 1e-12);
  assert.ok(Math.abs(point.y + 0.65) < 1e-12);
  const hit = nearestContourPhase(vertices, { x: point.x, y: point.y + 0.02 });
  assert.ok(Math.abs(hit.phase - 0.125) < 0.01);
  assert.ok(hit.distance < 0.03);
});

test("local shape timing preserves sample count while redistributing segment time", () => {
  const vertices = [
    { x: -1.5, y: -0.4 },
    { x: 1.5, y: -0.4 },
    { x: 0.2, y: 0.5 },
    { x: -0.2, y: 0.5 },
  ];
  const warp = createContourTimeWarp(vertices, 1);
  assert.equal(warp[0], 0);
  assert.equal(warp.at(-1), 1);
  assert.notEqual(phaseThroughContourTimeWarp(0.25, warp), 0.25);

  const samples = Float32Array.from(
    { length: 128 },
    (_, index) => Math.sin(index * Math.PI * 2 / 128),
  );
  const stretched = timeStretchLoopSamples(samples, vertices, 1);
  assert.equal(stretched.length, samples.length);
  assert.notDeepEqual([...stretched], [...samples]);
});

test("radial edits shift pitch locally without changing loop duration", () => {
  const untouched = radialContourVertices(Array(12).fill(0));
  const outwardOffsets = Array(12).fill(0);
  outwardOffsets[0] = 0.62;
  const outward = radialContourVertices(outwardOffsets);
  const inwardOffsets = Array(12).fill(0);
  inwardOffsets[0] = -0.42;
  const inward = radialContourVertices(inwardOffsets);

  assert.ok(contourPitchRatioAt(outward, 0, 1) < 1, "outward must lower pitch");
  assert.ok(contourPitchRatioAt(inward, 0, 1) > 1, "inward must raise pitch");
  assert.ok(Math.abs(contourPitchRatioAt(outward, 0.5, 1) - 1) < 1e-12);

  const samples = Float32Array.from(
    { length: 4096 },
    (_, index) => Math.sin(index * Math.PI * 2 / 64),
  );
  const identity = pitchShiftLoopSamplesByContour(samples, untouched, 1);
  const shifted = pitchShiftLoopSamplesByContour(samples, outward, 1);
  assert.equal(shifted.length, samples.length);
  assert.ok(Math.max(...identity.map((value, index) => Math.abs(value - samples[index]))) < 1e-6);
  assert.notDeepEqual([...shifted], [...samples]);
});

test("delay paint wraps around the ring and interpolates by contour phase", () => {
  let mask = new Float32Array(64);
  mask = paintDelayMask(mask, 0.99, 1, 0.08);
  assert.ok(mask[63] > 0.8);
  assert.ok(mask[0] > 0.7, "brush should wrap across the loop seam");
  assert.ok(sampleDelayMask(mask, 0.995) > 0.8);
  const erased = paintDelayMask(mask, 0.99, 0, 0.08);
  assert.ok(sampleDelayMask(erased, 0.99) < sampleDelayMask(mask, 0.99));
});

test("recorded samples retain envelope, reverse, and click-safe edges", () => {
  const samples = Float32Array.from([-0.75, 0.25, -0.5, 1]);
  const envelope = waveformEnvelope(samples, 2);
  assert.deepEqual([...envelope.minimums], [-0.75, -0.5]);
  assert.deepEqual([...envelope.maximums], [0.25, 1]);
  assert.deepEqual([...reverseSamples(samples)], [1, -0.5, 0.25, -0.75]);
  assert.deepEqual(
    [...fadeLoopEdges(Float32Array.from([1, 1, 1, 1, 1, 1]), 100, 0.02)],
    [0, 0.5, 1, 1, 0.5, 0],
  );
});
