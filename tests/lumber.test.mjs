import assert from "node:assert/strict";
import test from "node:test";

import {
  addContourVertex,
  createContourTimeWarp,
  contourPitchRatioAt,
  fadeLoopEdges,
  loopPhaseAtTime,
  mixDelayParametersFromOffsets,
  moveVertex,
  nearestContourPhase,
  pointOnContour,
  pitchShiftLoopSamplesByContour,
  phaseThroughContourTimeWarp,
  presetVertices,
  radialContourVertices,
  removeContourVertex,
  reverseSamples,
  scrubPhaseFromAngle,
  scrubRateFromMotion,
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

test("visible contour radius shifts pitch without changing loop duration", () => {
  const untouched = radialContourVertices(Array(12).fill(0));
  const outwardOffsets = Array(12).fill(0);
  outwardOffsets[0] = 0.62;
  const outward = radialContourVertices(outwardOffsets);
  const inwardOffsets = Array(12).fill(0);
  inwardOffsets[0] = -0.42;
  const inward = radialContourVertices(inwardOffsets);

  assert.ok(contourPitchRatioAt(outward, 0, 1) > 1, "outward must raise pitch");
  assert.ok(contourPitchRatioAt(inward, 0, 1) < 1, "inward must lower pitch");
  assert.equal(contourPitchRatioAt(untouched, 0, 1), 1);
  assert.ok(contourPitchRatioAt(untouched, 0.5 / untouched.length, 1) < 1);

  const samples = Float32Array.from(
    { length: 4096 },
    (_, index) => Math.sin(index * Math.PI * 2 / 64),
  );
  const contoured = pitchShiftLoopSamplesByContour(samples, untouched, 1);
  const shifted = pitchShiftLoopSamplesByContour(samples, outward, 1);
  assert.equal(contoured.length, samples.length);
  assert.equal(shifted.length, samples.length);
  assert.notDeepEqual([...contoured], [...samples]);
  assert.notDeepEqual([...shifted], [...samples]);
});

test("triangle and square use their full visible shape as a pitch envelope", () => {
  for (const count of [3, 4]) {
    const vertices = radialContourVertices(Array(count).fill(0));
    assert.equal(vertices.length, count);
    assert.equal(contourPitchRatioAt(vertices, 0, 1), 1);
    assert.ok(contourPitchRatioAt(vertices, 0.5 / count, 1) < 1);
  }
});

test("triangle contour produces an audible local pitch drop without changing duration", () => {
  const sampleRate = 48_000;
  const frequency = 220;
  const samples = Float32Array.from(
    { length: sampleRate },
    (_, index) => Math.sin(index * Math.PI * 2 * frequency / sampleRate),
  );
  const triangle = radialContourVertices(Array(3).fill(0));
  const shifted = pitchShiftLoopSamplesByContour(samples, triangle, 0.65);
  const start = Math.floor(shifted.length * 0.08);
  const end = Math.floor(shifted.length * 0.25);
  let positiveCrossings = 0;
  for (let index = start + 1; index < end; index += 1) {
    if (shifted[index - 1] <= 0 && shifted[index] > 0) positiveCrossings += 1;
  }
  const localFrequency = positiveCrossings * sampleRate / (end - start);
  assert.equal(shifted.length, samples.length);
  assert.ok(
    localFrequency < frequency * 0.9,
    `triangle midpoint should pitch 220 Hz clearly downward, received ${localFrequency.toFixed(1)} Hz`,
  );
});

test("mix delay ring is dry at rest and maps inward and outward independently", () => {
  const dry = mixDelayParametersFromOffsets(Array(12).fill(0));
  assert.deepEqual(dry, { inward: 0, outward: 0, time: 0.28, feedback: 0, wet: 0 });

  const inward = mixDelayParametersFromOffsets([-0.34, ...Array(11).fill(0)]);
  assert.ok(inward.time < dry.time);
  assert.equal(inward.feedback, 0);
  assert.ok(inward.wet > 0);

  const outward = mixDelayParametersFromOffsets([0.34, ...Array(11).fill(0)]);
  assert.equal(outward.time, dry.time);
  assert.ok(outward.feedback > 0);
  assert.ok(outward.wet > inward.wet);

  const combined = mixDelayParametersFromOffsets([-0.34, 0.34, ...Array(10).fill(0)]);
  assert.ok(combined.time < dry.time);
  assert.ok(combined.feedback > 0);
  assert.ok(combined.wet > outward.wet);
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
