import assert from "node:assert/strict";
import test from "node:test";

import {
  addContourVertex,
  createContourTimeWarp,
  fadeLoopEdges,
  loopPhaseAtTime,
  moveVertex,
  nearestContourPhase,
  pointOnContour,
  phaseThroughContourTimeWarp,
  presetVertices,
  removeContourVertex,
  reverseSamples,
  scrubPhaseFromAngle,
  scrubRateFromMotion,
  timeStretchLoopSamples,
  waveformEnvelope,
  wrap01,
} from "../src/lumber.js";

test("native loop phase always closes at the recorded duration", () => {
  assert.equal(wrap01(-0.25), 0.75);
  assert.equal(loopPhaseAtTime(0, 2, 4), 0.5);
  assert.equal(loopPhaseAtTime(0, 4, 4), 0);
  assert.equal(loopPhaseAtTime(0.25, 1, 4, -1), 0);
  assert.equal(scrubPhaseFromAngle(0.25, Math.PI / 2), 0);
  assert.equal(scrubPhaseFromAngle(0.25, -Math.PI / 2), 0.5);
  assert.equal(scrubRateFromMotion(0.025, 4, 100), 1);
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
