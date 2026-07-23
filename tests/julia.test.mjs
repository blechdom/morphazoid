import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  JULIA_DEFAULTS,
  JULIA_PRESETS,
  TAU,
  buildBoundaryPath,
  cumulativeTurnOctaves,
  escapeTimeJulia,
  extractMarchingSquaresContours,
  generateJuliaBoundary,
  generateJuliaField,
  juliaContourVerticalAddress,
  juliaVerticalAddressOctaves,
  sampleBoundary,
  selectLongestClosedContour,
  simplifyClosedContour,
  smoothClosedContour,
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

test("signed contour treatment can smooth left of its raw midpoint", () => {
  const points = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
  ];
  const smoothed = smoothClosedContour(points, 1);
  assert.equal(smoothed.length, points.length);
  assert.notDeepEqual(smoothed, points);
  assert.ok(buildBoundaryPath(smoothed));
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
  assert.ok(Math.abs(atSeam.octavePosition - JULIA_DEFAULTS.turnOctaves) < 1e-9);
  assert.ok(Math.abs(reverseLap.octavePosition + JULIA_DEFAULTS.turnOctaves) < 1e-9);
  assert.ok(Math.abs(atSeam.octavePhase) < 1e-9);
});

test("the default field is centrally symmetric and its vertical harmony is complementary", () => {
  for (const [x, y] of [[0.2, 0.7], [-1.1, 0.25], [1.4, -0.6]]) {
    assert.equal(
      escapeTimeJulia(x, y),
      escapeTimeJulia(-x, -y),
      `escape depth should agree at ±(${x}, ${y})`,
    );
  }
  assert.equal(juliaVerticalAddressOctaves(-1), 3 / 12);
  assert.equal(juliaVerticalAddressOctaves(0), 5 / 12);
  assert.equal(juliaVerticalAddressOctaves(1), 7 / 12);
  assert.equal(juliaContourVerticalAddress(0, 101), -1);
  assert.equal(juliaContourVerticalAddress(50, 101), 0);
  assert.equal(juliaContourVerticalAddress(100, 101), 1);
  assert.equal(
    juliaVerticalAddressOctaves(juliaContourVerticalAddress(0, 101)),
    3 / 12,
    "the bottom contour coordinate should map to a minor third",
  );
  assert.equal(
    juliaVerticalAddressOctaves(juliaContourVerticalAddress(100, 101)),
    7 / 12,
    "the top contour coordinate should map to a perfect fifth",
  );
  for (const y of [-1, -0.3, 0, 0.45, 1]) {
    assert.ok(Math.abs(
      juliaVerticalAddressOctaves(y) + juliaVerticalAddressOctaves(-y) - 10 / 12,
    ) < 1e-12);
  }
  const generated = generateJuliaBoundary({
    cReal: JULIA_DEFAULTS.cReal,
    cImag: JULIA_DEFAULTS.cImag,
    resolution: JULIA_DEFAULTS.resolution,
    maxIterations: JULIA_DEFAULTS.maxIterations,
    simplifyTolerance: 0,
  });
  for (const phase of [0, 0.07, 0.19, 0.33, 0.49]) {
    const upper = sampleBoundary(generated.boundary, phase);
    const lower = sampleBoundary(generated.boundary, phase + 0.5);
    assert.ok(Math.hypot(
      upper.x + lower.x - (generated.field.width - 1),
      upper.y + lower.y - (generated.field.height - 1),
    ) < 1e-8);
  }
});

test("32 iterations is the lowest tested default retaining over 90% of the deep mask", () => {
  const fieldAt = (maxIterations) => generateJuliaField({
    cReal: JULIA_DEFAULTS.cReal,
    cImag: JULIA_DEFAULTS.cImag,
    resolution: JULIA_DEFAULTS.resolution,
    maxIterations,
  });
  const reference = fieldAt(96);
  const maskIou = (candidate) => {
    let intersection = 0;
    let union = 0;
    for (let row = 0; row < candidate.height; row += 1) {
      for (let column = 0; column < candidate.width; column += 1) {
        const a = candidate.values[row][column] === candidate.maxIterations;
        const b = reference.values[row][column] === reference.maxIterations;
        if (a && b) intersection += 1;
        if (a || b) union += 1;
      }
    }
    return intersection / union;
  };
  assert.ok(maskIou(fieldAt(32)) > 0.9);
  assert.ok(maskIou(fieldAt(28)) < 0.9);
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

test("every curated Julia preset produces a playable contour at its recommended grid", () => {
  assert.equal(new Set(JULIA_PRESETS.map((preset) => preset.id)).size, JULIA_PRESETS.length);
  for (const preset of JULIA_PRESETS) {
    const generated = generateJuliaBoundary({
      cReal: preset.cReal,
      cImag: preset.cImag,
      resolution: Math.max(JULIA_DEFAULTS.resolution, preset.minimumResolution ?? 0),
      maxIterations: JULIA_DEFAULTS.maxIterations,
      simplifyTolerance: Math.min(JULIA_DEFAULTS.contourTreatment, preset.maximumSimplify ?? Infinity),
    });
    assert.ok(generated.field.insideCount > 0, `${preset.name} needs surviving pixels`);
    assert.ok(generated.primaryContour?.closed, `${preset.name} needs a closed contour`);
    assert.ok(generated.boundary?.points.length >= 8, `${preset.name} needs a playable path`);
  }
});

test("named preset constants retain their defining critical cycles", () => {
  const preset = (id) => JULIA_PRESETS.find((candidate) => candidate.id === id);
  const criticalAfter = (id, iterations) => {
    const { cReal, cImag } = preset(id);
    let x = 0;
    let y = 0;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      [x, y] = [x * x - y * y + cReal, 2 * x * y + cImag];
    }
    return Math.hypot(x, y);
  };
  assert.ok(criticalAfter("circle", 1) < 1e-14);
  assert.ok(criticalAfter("basilica", 2) < 1e-14);
  for (const id of ["rabbit", "corabbit", "airplane"]) {
    assert.ok(criticalAfter(id, 3) < 1e-12, `${id} should be an exact period-three center`);
  }
  const theta = (Math.sqrt(5) - 1) * 0.5;
  const lambda = { x: Math.cos(TAU * theta), y: Math.sin(TAU * theta) };
  const siegel = preset("siegel");
  assert.ok(Math.abs(siegel.cReal - (lambda.x * 0.5 - (lambda.x ** 2 - lambda.y ** 2) * 0.25)) < 1e-14);
  assert.ok(Math.abs(siegel.cImag - (lambda.y * 0.5 - 2 * lambda.x * lambda.y * 0.25)) < 1e-14);
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
    "shepardWidth", "synthMode", "soundSummary", "synthModeHelp", "verticalHarmonyRule",
    "similarityExperiment", "motifWidth", "similarityDepth",
    "similarityDuration", "analyzeSimilarity", "auditionSimilarity", "jumpSimilarity",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /leftRises[\s\S]*rightRises/);
  for (const preset of JULIA_PRESETS) {
    assert.match(html, new RegExp(`option value="${preset.id}"`));
  }
  assert.match(html, /id="speed"[^>]*value="0"[^>]*data-mid="0\.017"/);
  assert.match(html, /id="cReal"[^>]*value="0"[^>]*data-low="-2"[^>]*data-mid="-0\.788"[^>]*data-high="0\.5"/);
  assert.match(html, /id="cImag"[^>]*value="0"[^>]*data-low="-1\.2"[^>]*data-mid="0\.1191"[^>]*data-high="1\.2"/);
  assert.match(html, /id="maxIterations"[^>]*value="0"[^>]*data-mid="32"/);
  assert.match(html, /id="resolution"[^>]*value="0"[^>]*data-mid="320"/);
  assert.match(html, /id="simplify"[^>]*min="-3"[^>]*max="3"[^>]*value="0"/);
  assert.match(html, /id="turnOctaves"[^>]*min="0"[^>]*max="8"[^>]*value="5"/);
  assert.match(html, /id="baseFrequency"[^>]*min="20"[^>]*max="580"[^>]*value="300"/);
  assert.match(html, /id="shepardWidth"[^>]*min="1"[^>]*max="15"[^>]*value="8"/);
  assert.match(html, /id="synthMode"[\s\S]*option value="harmony" selected>Shepard \+ vertical harmony<[\s\S]*option value="basic">Basic Shepard</);
  assert.match(html, /src="julia-app\.js"/);
  assert.match(app, /generateJuliaBoundary/);
  assert.match(app, /cumulativeTurnOctaves/);
  assert.match(app, /setVoiceTrajectory/);
  assert.match(app, /shepardPosition/);
  assert.match(app, /shepardTravel/);
  assert.match(app, /MAX_BASIC_SHEPARD_RATE = 7\.5/);
  assert.match(app, /MAX_SIMILARITY_SHEPARD_RATE = 30/);
  assert.match(app, /rateLimitedAudioTrajectory/);
  assert.match(app, /state\.synthMode === "basic"/);
  assert.match(app, /basic \? "julia:boundary" : "julia:boundary:shape"/);
  assert.match(app, /buildInverseArcFamily/);
  assert.match(app, /buildInverseArcTree/);
  assert.match(app, /similarityVoiceTrajectory/);
  assert.match(app, /juliaVerticalAddressOctaves/);
  assert.match(app, /pagehide[\s\S]*state\.audio = false/);
});
