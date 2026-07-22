import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TAU,
  buildBoundaryPath,
  cumulativeTurnOctaves,
  escapeTimeJulia,
  extractMarchingSquaresContours,
  generateJuliaBoundary,
  sampleBoundary,
  selectLongestClosedContour,
  simplifyClosedContour,
} from "../src/julia.js";

function binaryField(rows) {
  return {
    values: rows.map((row) => Uint16Array.from(row)),
    width: rows[0].length,
    height: rows.length,
    maxIterations: 1,
    escapeRadius: 2,
    cReal: 0,
    cImag: 0,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
  };
}

test("Julia escape time distinguishes the filled set from immediate escape", () => {
  assert.equal(escapeTimeJulia(0, 0, 0, 0, 40), 40);
  assert.equal(escapeTimeJulia(3, 0, 0, 0, 40), 0);
});

test("marching squares discovers and closes every separated component", () => {
  const field = binaryField([
    [0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 1, 0, 0],
    [0, 1, 1, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0, 0, 0],
    [0, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ]);
  const contours = extractMarchingSquaresContours(field);
  assert.equal(contours.length, 3);
  assert.ok(contours.every((contour) => contour.closed));
  assert.ok(contours.every((contour) => contour.points.length >= 4));
  const longest = selectLongestClosedContour(contours);
  assert.equal(longest, [...contours].sort((a, b) => b.length - a.length)[0]);
});

test("edge-clipped marching-squares contours remain one continuous open path", () => {
  const field = binaryField([
    [0, 0, 0, 0, 0],
    [1, 1, 1, 0, 0],
    [1, 1, 1, 0, 0],
    [1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  const contours = extractMarchingSquaresContours(field);
  assert.equal(contours.length, 1);
  assert.equal(contours[0].closed, false);
  assert.ok(contours[0].points.length > 4);
});

test("closed simplification preserves a playable seam and removes collinear detail", () => {
  const points = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 },
    { x: 0, y: 2 }, { x: 0, y: 1 },
  ];
  const simplified = simplifyClosedContour(points, 0.1);
  assert.equal(simplified.length, 4);
  assert.notDeepEqual(simplified[0], simplified.at(-1));
  assert.ok(buildBoundaryPath(simplified));
});

test("boundary metadata normalizes orientation and retains left and right turns", () => {
  const clockwiseConcave = [
    { x: 0, y: 0 }, { x: 0, y: 3 }, { x: 3, y: 3 },
    { x: 1.5, y: 1.5 }, { x: 3, y: 0 },
  ];
  const path = buildBoundaryPath(clockwiseConcave);
  assert.ok(path.area > 0);
  assert.ok(path.turns.some((turn) => turn > 0.1), "expected a left turn");
  assert.ok(path.turns.some((turn) => turn < -0.1), "expected a right turn");
  assert.ok(Math.abs(path.totalTurn - TAU) < 1e-9);
});

test("boundary sampling follows true arclength rather than vertex count", () => {
  const path = buildBoundaryPath([
    { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 0, y: 2 },
  ]);
  const quarter = sampleBoundary(path, 0.25);
  assert.ok(Math.abs(quarter.distance - path.totalLength * 0.25) < 1e-9);
  assert.ok(Math.abs(quarter.x - 4) < 1e-9);
  assert.ok(Math.abs(quarter.y) < 1e-9);
});

test("cumulative signed turns make a seamless cyclic Shepard pitch", () => {
  const path = buildBoundaryPath([
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
  ]);
  const beforeSeam = cumulativeTurnOctaves(path, 1 - 1e-8, { glide: 1 });
  const atSeam = cumulativeTurnOctaves(path, 1, { glide: 1 });
  const reverseLap = cumulativeTurnOctaves(path, -1, { glide: 1 });
  assert.ok(Math.abs(beforeSeam.octavePosition - atSeam.octavePosition) < 1e-6);
  assert.ok(Math.abs(atSeam.octavePosition - 1) < 1e-9);
  assert.ok(Math.abs(reverseLap.octavePosition + 1) < 1e-9);
  assert.ok(Math.abs(atSeam.octavePhase) < 1e-9);
});

test("a real Julia field produces a longest closed playable boundary", () => {
  const generated = generateJuliaBoundary({
    cReal: -0.7,
    cImag: 0.27015,
    resolution: 96,
    maxIterations: 72,
    simplifyTolerance: 0.5,
  });
  assert.ok(generated.field.insideCount > 0);
  assert.ok(generated.contours.length > 0);
  assert.ok(generated.primaryContour?.closed);
  assert.ok(generated.boundary?.segments.length > 8);
});

test("Julia page exposes the fractal, signed-turn mapping, and Shepard controls", async () => {
  const root = new URL("../", import.meta.url);
  const [html, app] = await Promise.all([
    readFile(new URL("julia.html", root), "utf8"),
    readFile(new URL("julia-app.js", root), "utf8"),
  ]);
  for (const id of [
    "playButton", "position", "speed", "cReal", "cImag", "maxIterations",
    "resolution", "simplify", "viewZoom", "resetView", "turnOctaves", "cornerGlide", "baseFrequency",
    "shepardWidth", "similarityExperiment", "motifWidth", "similarityDepth",
    "similarityDuration", "analyzeSimilarity", "auditionSimilarity", "jumpSimilarity",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /leftRises[\s\S]*rightRises/);
  assert.match(html, /src="julia-app\.js"/);
  assert.match(app, /generateJuliaBoundary/);
  assert.match(app, /cumulativeTurnOctaves/);
  assert.match(app, /setVoiceTrajectory/);
  assert.match(app, /shepardPosition/);
  assert.match(app, /MAX_SHEPARD_RATE = 7\.5/);
  assert.match(app, /rateLimitedAudioTrajectory/);
  assert.match(app, /buildInverseArcFamily/);
  assert.match(app, /buildInverseArcTree/);
  assert.match(app, /similarityVoiceTrajectory/);
  assert.match(app, /pagehide[\s\S]*state\.audio = false/);
});
