import assert from "node:assert/strict";
import test from "node:test";

import {
  D4_TRANSFORMS,
  IDENTITY_TRANSFORM,
  PAINT_MAPPING_TARGETS,
  PLAYHEAD_PAINT_POLAR_CENTER_BLEND_RADIUS,
  PLAYHEAD_PAINT_SAMPLE_VERSION,
  PLAYHEAD_PAINT_SCHEMA_VERSION,
  REFLECTION_AXES,
  affineTransformForMarkTransform,
  applyAffineTransform,
  applyMarkPointTransforms,
  cumulativeArcLengths,
  evaluateAudioMapping,
  generateTransformedPaths,
  generateTransformedVoices,
  interpolateMarkPoint,
  interpolateRecordedPoint,
  interpolateSteadyPoint,
  layoutPaintLoop,
  loopEntriesAtTime,
  loopTimeAt,
  markPathLength,
  markPointTransformMatrix,
  measureMarkPath,
  multiplyAffineTransforms,
  pathBounds,
  polarCoordinateSources,
  polyphonyGainScale,
  reflectionTransforms,
  sanitizeAffineTransform,
  sanitizeAudioMapping,
  sanitizeMark,
  sanitizeMarkEnvelope,
  sanitizeMarkTransform,
  sanitizeReflectionAxes,
  sanitizeSample,
  sanitizeTimedPoints,
  simplifyTimedPoints,
} from "../src/playhead-paint.js";

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const pointCloseTo = (actual, expected, epsilon = 1e-9) => {
  closeTo(actual.x, expected.x, epsilon);
  closeTo(actual.y, expected.y, epsilon);
};

test("Playhead Paint exposes stable schema, axes, targets, and identity constants", () => {
  assert.equal(PLAYHEAD_PAINT_SCHEMA_VERSION, 1);
  assert.equal(PLAYHEAD_PAINT_SAMPLE_VERSION, 1);
  assert.deepEqual(REFLECTION_AXES, [
    "horizontal",
    "vertical",
    "diagonal",
    "antiDiagonal",
  ]);
  assert.deepEqual(PAINT_MAPPING_TARGETS, ["none", "pitch", "pan", "gain", "timbre"]);
  assert.deepEqual(IDENTITY_TRANSFORM, {
    id: "identity",
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
  });
  assert.ok(Object.isFrozen(IDENTITY_TRANSFORM));
  assert.equal(Object.keys(D4_TRANSFORMS).length, 8);
});

test("sanitizeSample accepts legacy keys and bounds unsafe values", () => {
  assert.deepEqual(sanitizeSample({ u: -4, v: 7, time: 50, force: 2 }), {
    version: 1,
    x: 0,
    y: 1,
    tMs: 50,
    pressure: 1,
  });
  assert.deepEqual(sanitizeSample({ x: Number.NaN, y: Infinity, tMs: -20 }), {
    version: 1,
    x: 0.5,
    y: 0.5,
    tMs: 0,
    pressure: 0.5,
  });
  const unclamped = sanitizeSample({ x: 2, y: -3 }, { clampCoordinates: false });
  assert.equal(unclamped.x, 2);
  assert.equal(unclamped.y, -3);
});

test("sanitizeTimedPoints rebases source time and repairs it monotonically", () => {
  const source = [
    { x: 0.1, y: 0.2, timestamp: 1_000 },
    { x: 0.2, y: 0.3, timestamp: 1_040 },
    { x: 0.3, y: 0.4, timestamp: 1_020 },
    { x: 0.4, y: 0.5, timestamp: 1_090 },
  ];
  const points = sanitizeTimedPoints(source);
  assert.deepEqual(points.map(({ tMs }) => tMs), [0, 40, 40, 90]);
  assert.deepEqual(source[0], { x: 0.1, y: 0.2, timestamp: 1_000 });
  assert.ok(points.every(({ version }) => version === PLAYHEAD_PAINT_SAMPLE_VERSION));
});

test("sanitizeTimedPoints supplies a playable center sample for empty data", () => {
  assert.deepEqual(sanitizeTimedPoints([]), [{
    version: 1,
    x: 0.5,
    y: 0.5,
    tMs: 0,
    pressure: 0.5,
  }]);
  assert.deepEqual(sanitizeTimedPoints(null), sanitizeTimedPoints([]));
});

test("sanitizeMark preserves layer and axes while versioning timing and release", () => {
  const source = {
    id: "  mark / unsafe  ",
    layerId: "violet layer",
    axes: ["vertical", "anti-diagonal", "vertical", "nope"],
    samples: [
      { x: 0.1, y: 0.2, tMs: 500, pressure: 0.25 },
      { x: 0.9, y: 0.8, tMs: 620, pressure: 0.75 },
    ],
    startOffsetMs: 250,
    durationMs: 80,
    releaseMs: 345,
    brushSize: 0.04,
    color: "#abcdef",
    waveform: "TRIANGLE",
    envelope: { attackMs: 5, decayMs: 20, sustain: 0.6, releaseMs: 999 },
    transform: { translateX: 0.2, rotationDeg: 450, scale: 2 },
  };
  const mark = sanitizeMark(source);

  assert.equal(mark.version, PLAYHEAD_PAINT_SCHEMA_VERSION);
  assert.equal(mark.id, "mark-unsafe");
  assert.equal(mark.layerId, "violet-layer");
  assert.deepEqual(mark.axes, ["vertical", "antiDiagonal"]);
  assert.deepEqual(mark.samples.map(({ tMs }) => tMs), [0, 120]);
  assert.equal(mark.startOffsetMs, 250);
  assert.equal(mark.durationMs, 120);
  assert.equal(mark.endOffsetMs, 370);
  assert.equal(mark.releaseMs, 345);
  assert.equal(mark.releaseEndOffsetMs, 715);
  assert.deepEqual(mark.envelope, {
    attackMs: 5,
    decayMs: 20,
    sustain: 0.6,
    releaseMs: 345,
  });
  assert.equal(mark.waveform, "triangle");
  assert.equal(mark.brushSize, 0.04);
  assert.equal(mark.color, "#abcdef");
  assert.deepEqual(mark.transform, {
    translateX: 0.2,
    translateY: 0,
    rotationDeg: 90,
    scaleX: 2,
    scaleY: 2,
    originX: null,
    originY: null,
  });
  assert.equal(source.id, "  mark / unsafe  ");
});

test("mark, envelope, and transform sanitizers provide finite safe bounds", () => {
  const mark = sanitizeMark({
    id: "",
    startOffsetMs: -Infinity,
    durationMs: Infinity,
    releaseMs: -50,
    brushSize: 20,
    waveform: "noise",
    samples: [{ x: Infinity, y: -Infinity, tMs: Infinity }],
    transform: {
      translateX: 500,
      translateY: -500,
      scaleX: 0,
      scaleY: Infinity,
      originX: Infinity,
    },
  }, { fallbackId: "safe id" });
  assert.equal(mark.id, "safe-id");
  assert.equal(mark.startOffsetMs, 0);
  assert.equal(mark.releaseMs, 0);
  assert.equal(mark.brushSize, 1);
  assert.equal(mark.waveform, "sine");
  assert.ok(Object.values(mark.samples[0]).every((value) => Number.isFinite(value)));
  assert.deepEqual(mark.transform, {
    translateX: 4,
    translateY: -4,
    rotationDeg: 0,
    scaleX: 0.001,
    scaleY: 1,
    originX: null,
    originY: null,
  });
  assert.deepEqual(sanitizeMarkEnvelope({ attack: -2, decay: 100_000, sustain: 5 }), {
    attackMs: 0,
    decayMs: 60_000,
    sustain: 1,
    releaseMs: 240,
  });
  assert.deepEqual(sanitizeMarkTransform(null), {
    translateX: 0,
    translateY: 0,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
    originX: null,
    originY: null,
  });
});

test("simplifyTimedPoints removes truly redundant timed samples", () => {
  const source = Array.from({ length: 5 }, (_, index) => ({
    x: index / 4,
    y: index / 4,
    tMs: index * 25,
    pressure: index / 4,
  }));
  const simplified = simplifyTimedPoints(source, 0.00001, { pressureTolerance: 0.00001 });
  assert.equal(simplified.length, 2);
  assert.deepEqual(simplified.map(({ tMs }) => tMs), [0, 100]);
  assert.notEqual(simplified[0], source[0]);
});

test("simplifyTimedPoints preserves velocity, pause, pressure, and time-gap information", () => {
  const velocity = simplifyTimedPoints([
    { x: 0, y: 0, tMs: 0 },
    { x: 0.5, y: 0, tMs: 10 },
    { x: 1, y: 0, tMs: 100 },
  ], 0.01);
  assert.deepEqual(velocity.map(({ tMs }) => tMs), [0, 10, 100]);

  const pressure = simplifyTimedPoints([
    { x: 0, y: 0, tMs: 0, pressure: 0 },
    { x: 0.5, y: 0.5, tMs: 50, pressure: 1 },
    { x: 1, y: 1, tMs: 100, pressure: 0 },
  ], 0.1, { pressureTolerance: 0.1 });
  assert.equal(pressure.length, 3);

  const timeCapped = simplifyTimedPoints([
    { x: 0, y: 0, tMs: 0 },
    { x: 0.25, y: 0, tMs: 250 },
    { x: 0.5, y: 0, tMs: 500 },
    { x: 0.75, y: 0, tMs: 750 },
    { x: 1, y: 0, tMs: 1_000 },
  ], 1, { maxTimeGapMs: 300 });
  assert.ok(timeCapped.length >= 4);
  for (let index = 1; index < timeCapped.length; index += 1) {
    assert.ok(timeCapped[index].tMs - timeCapped[index - 1].tMs <= 300);
  }
});

test("arc length and bounds handle normal, empty, and zero-length paths", () => {
  const points = [{ x: 0, y: 0 }, { x: 0.3, y: 0.4 }, { x: 0.3, y: 0.4 }];
  assert.deepEqual(cumulativeArcLengths(points), [0, 0.5, 0.5]);
  assert.deepEqual(cumulativeArcLengths([]), []);
  const bounds = pathBounds(points);
  assert.deepEqual({
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: bounds.minY,
    maxY: bounds.maxY,
    width: bounds.width,
    height: bounds.height,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  }, {
    minX: 0,
    maxX: 0.3,
    minY: 0,
    maxY: 0.4,
    width: 0.3,
    height: 0.4,
    centerX: 0.15,
    centerY: 0.2,
  });
  assert.ok(bounds.safeWidth > 0 && bounds.safeHeight > 0);
  const dotBounds = pathBounds([{ x: 0.2, y: 0.7 }]);
  assert.equal(dotBounds.width, 0);
  assert.equal(dotBounds.height, 0);
  assert.ok(dotBounds.safeWidth > 0 && dotBounds.safeHeight > 0);
  assert.equal(markPathLength({ samples: points }), 0.5);
  assert.equal(measureMarkPath({ samples: [{ x: 0.2, y: 0.7 }] }).totalLength, 0);
});

test("polarCoordinateSources separates circular phase from seam-free bearing", () => {
  assert.equal(PLAYHEAD_PAINT_POLAR_CENTER_BLEND_RADIUS, 0.08);
  const center = polarCoordinateSources({ x: 0.5, y: 0.5 });
  assert.deepEqual(center, {
    radius: 0,
    phase: 0.5,
    bearing: 0.5,
    rawPhase: 0.5,
    centerBlend: 0,
    spokeCount: 0,
  });

  const east = polarCoordinateSources({ x: 1, y: 0.5 });
  closeTo(east.radius, 1 / Math.SQRT2);
  closeTo(east.phase, 0);
  closeTo(east.bearing, 1);
  const west = polarCoordinateSources({ x: 0, y: 0.5 });
  closeTo(west.phase, 0.5);
  closeTo(west.bearing, 0);

  const aboveSeam = polarCoordinateSources({ x: 0.9, y: 0.500001 });
  const belowSeam = polarCoordinateSources({ x: 0.9, y: 0.499999 });
  assert.ok(aboveSeam.phase < 0.001);
  assert.ok(belowSeam.phase > 0.999);
  closeTo(aboveSeam.bearing, belowSeam.bearing, 1e-10);
});

test("polar center blending bounds undefined-angle jitter and repairs unsafe input", () => {
  const jitter = [
    { x: 0.501, y: 0.5 },
    { x: 0.499, y: 0.5 },
    { x: 0.5, y: 0.501 },
    { x: 0.5, y: 0.499 },
  ].map((point) => polarCoordinateSources(point));
  assert.ok(jitter.every(({ bearing }) => Math.abs(bearing - 0.5) < 0.001));
  assert.ok(jitter.every(({ centerBlend }) => centerBlend > 0 && centerBlend < 0.002));
  assert.ok(jitter.every((result) => Object.values(result).every(Number.isFinite)));

  const repaired = polarCoordinateSources({ x: Infinity, y: Number.NaN }, {
    spokes: Infinity,
    centerBlendRadius: Number.NaN,
  });
  assert.ok(Object.values(repaired).every(Number.isFinite));
  assert.equal(repaired.radius, 0);
  assert.equal(repaired.bearing, 0.5);
});

test("polar spokes quantize phase before deriving an agreeing seam bearing", () => {
  const firstBin = polarCoordinateSources({ x: 0.9, y: 0.501 }, { spokes: 8 });
  const lastBin = polarCoordinateSources({ x: 0.9, y: 0.499 }, { spokes: 8 });
  assert.equal(firstBin.spokeCount, 8);
  assert.equal(firstBin.phase, 1 / 16);
  assert.equal(lastBin.phase, 15 / 16);
  closeTo(firstBin.bearing, lastBin.bearing);
  assert.ok(firstBin.rawPhase < 0.01);
  assert.ok(lastBin.rawPhase > 0.99);
});

test("reflection axis aliases sanitize into fixed UI order", () => {
  assert.deepEqual(
    sanitizeReflectionAxes(new Set(["V", "anti_diag", "h", "falling", "bogus"])),
    ["horizontal", "vertical", "antiDiagonal"],
  );
});

test("reflectionTransforms computes stable D4 closure with at most eight voices", () => {
  const ids = (axes) => reflectionTransforms(axes).map(({ id }) => id);
  assert.deepEqual(ids([]), ["identity"]);
  assert.deepEqual(ids(["horizontal"]), ["identity", "reflect-horizontal"]);
  assert.deepEqual(ids(["horizontal", "vertical"]), [
    "identity",
    "reflect-horizontal",
    "reflect-vertical",
    "rotate-180",
  ]);
  assert.deepEqual(ids(["diagonal", "antiDiagonal"]), [
    "identity",
    "rotate-180",
    "reflect-diagonal",
    "reflect-anti-diagonal",
  ]);
  assert.deepEqual(ids(["horizontal", "diagonal"]), [
    "identity",
    "reflect-horizontal",
    "reflect-vertical",
    "rotate-180",
    "reflect-diagonal",
    "reflect-anti-diagonal",
    "rotate-90",
    "rotate-270",
  ]);
  assert.equal(ids(REFLECTION_AXES).length, 8);
  assert.deepEqual(ids(REFLECTION_AXES), ids([...REFLECTION_AXES].reverse()));
});

test("polyphonyGainScale provides bounded constant-power reflection headroom", () => {
  closeTo(polyphonyGainScale(1), 1);
  closeTo(polyphonyGainScale(2), 1 / Math.sqrt(2));
  closeTo(polyphonyGainScale(8), 1 / Math.sqrt(8));
  closeTo(polyphonyGainScale(80), 1 / Math.sqrt(8));
  closeTo(polyphonyGainScale(Number.NaN), 1);
});

test("D4 matrices reflect across square-center axes with stable IDs", () => {
  const point = { x: 0.2, y: 0.3 };
  pointCloseTo(applyAffineTransform(point, D4_TRANSFORMS["reflect-horizontal"]), { x: 0.2, y: 0.7 });
  pointCloseTo(applyAffineTransform(point, D4_TRANSFORMS["reflect-vertical"]), { x: 0.8, y: 0.3 });
  pointCloseTo(applyAffineTransform(point, D4_TRANSFORMS["reflect-diagonal"]), { x: 0.7, y: 0.8 });
  pointCloseTo(applyAffineTransform(point, D4_TRANSFORMS["reflect-anti-diagonal"]), { x: 0.3, y: 0.2 });
  pointCloseTo(applyAffineTransform(point, D4_TRANSFORMS["rotate-90"]), { x: 0.7, y: 0.2 });
});

test("affine composition and mark transforms apply local, reflection, scene order", () => {
  const local = { translateX: 0.1 };
  const scene = { translateY: 0.2 };
  const reflected = applyMarkPointTransforms(
    { x: 0.2, y: 0.2 },
    local,
    D4_TRANSFORMS["reflect-vertical"],
    scene,
  );
  pointCloseTo(reflected, { x: 0.7, y: 0.4 });

  const matrix = markPointTransformMatrix(
    local,
    D4_TRANSFORMS["reflect-vertical"],
    scene,
  );
  pointCloseTo(applyAffineTransform({ x: 0.2, y: 0.2 }, matrix), reflected);

  const translation = sanitizeAffineTransform({ id: "move", a: 1, b: 0, c: 0, d: 1, e: 0.1, f: 0 });
  const verticalAfterTranslation = multiplyAffineTransforms(
    D4_TRANSFORMS["reflect-vertical"],
    translation,
  );
  pointCloseTo(applyAffineTransform({ x: 0.2, y: 0.2 }, verticalAfterTranslation), { x: 0.7, y: 0.2 });
  assert.equal(verticalAfterTranslation.id, "reflect-vertical-after-move");
});

test("affineTransformForMarkTransform rotates and scales about its pivot", () => {
  const matrix = affineTransformForMarkTransform({ rotationDeg: 90, scale: 2 }, {
    originX: 0.5,
    originY: 0.5,
    id: "local",
  });
  pointCloseTo(applyAffineTransform({ x: 0.75, y: 0.5 }, matrix), { x: 0.5, y: 1 });
  assert.equal(matrix.id, "local");
});

test("recorded interpolation follows sample time and holds through release point", () => {
  const mark = {
    durationMs: 200,
    samples: [
      { x: 0, y: 0.2, tMs: 0, pressure: 0 },
      { x: 1, y: 0.8, tMs: 100, pressure: 1 },
    ],
  };
  const middle = interpolateRecordedPoint(mark, 50);
  pointCloseTo(middle, { x: 0.5, y: 0.5 });
  closeTo(middle.pressure, 0.5);
  assert.equal(middle.tMs, 50);
  const held = interpolateRecordedPoint(mark, 175);
  pointCloseTo(held, { x: 1, y: 0.8 });
  assert.equal(held.tMs, 175);
  assert.equal(interpolateRecordedPoint(mark, -500).tMs, 0);
  assert.equal(interpolateRecordedPoint(mark, 500).tMs, 200);
  pointCloseTo(interpolateMarkPoint(mark, 0.25, { units: "progress" }), { x: 0.5, y: 0.5 });
});

test("steady interpolation follows distance instead of recorded velocity", () => {
  const mark = {
    samples: [
      { x: 0, y: 0, tMs: 0 },
      { x: 0.75, y: 0, tMs: 90 },
      { x: 1, y: 0, tMs: 100 },
    ],
  };
  const halfway = interpolateSteadyPoint(mark, 0.5);
  pointCloseTo(halfway, { x: 0.5, y: 0 });
  closeTo(halfway.tMs, 60);
  closeTo(halfway.pathDistance, 0.5);
  closeTo(halfway.pathProgress, 0.5);

  const byDistance = interpolateSteadyPoint(mark, 0.875, { units: "distance" });
  pointCloseTo(byDistance, { x: 0.875, y: 0 });
  closeTo(byDistance.tMs, 95);
  pointCloseTo(
    interpolateMarkPoint(mark, 0.5, { mode: "steady", units: "progress" }),
    halfway,
  );
});

test("steady interpolation safely gives held dots a time position", () => {
  const dot = {
    durationMs: 200,
    samples: [
      { x: 0.3, y: 0.4, tMs: 0 },
      { x: 0.3, y: 0.4, tMs: 100 },
    ],
  };
  const point = interpolateSteadyPoint(dot, 0.75);
  pointCloseTo(point, { x: 0.3, y: 0.4 });
  assert.equal(point.pathDistance, 0);
  assert.equal(point.pathProgress, 0.75);
  assert.equal(point.tMs, 150);
});

test("audio mapping sanitizes routes and evaluates X/Y/size curves", () => {
  const defaults = evaluateAudioMapping({ x: 0.25, y: 0.25 }, 0.0325);
  closeTo(defaults.pan, -0.5);
  closeTo(defaults.frequencyHz, 55 * (1760 / 55) ** 0.75);
  closeTo(defaults.gain, 1);
  closeTo(defaults.timbre, 0.5);

  const mapping = sanitizeAudioMapping({
    xTarget: "frequency",
    yTarget: "pitch",
    sizeTarget: "amplitude",
    invertY: false,
    pitchMin: 100,
    pitchMax: 400,
    gainMin: 0.2,
    gainMax: 0.8,
    xCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  assert.equal(mapping.xTarget, "pitch");
  assert.equal(mapping.yTarget, "pitch");
  assert.equal(mapping.sizeTarget, "gain");
  const evaluated = evaluateAudioMapping({ x: 0.1, y: 0.8 }, 0.06, mapping);
  // Y deterministically overwrites X because both target pitch.
  closeTo(evaluated.frequencyHz, 100 * 4 ** 0.8);
  closeTo(evaluated.gain, 0.8);
  assert.ok(evaluated.mapping.xCurve !== mapping.xCurve);
});

test("generateTransformedPaths uses stored axes, transform IDs, and mark metadata", () => {
  const mark = {
    id: "stroke-7",
    layerId: "cyan",
    axes: ["horizontal"],
    color: "#00ffff",
    waveform: "square",
    brushSize: 0.025,
    durationMs: 100,
    releaseMs: 50,
    transform: { translateX: 0.1 },
    samples: [
      { x: 0.2, y: 0.3, tMs: 0 },
      { x: 0.4, y: 0.3, tMs: 100 },
    ],
  };
  const paths = generateTransformedPaths(mark);
  assert.deepEqual(paths.map(({ id }) => id), [
    "stroke-7@identity",
    "stroke-7@reflect-horizontal",
  ]);
  assert.deepEqual(paths.map(({ transformId }) => transformId), [
    "identity",
    "reflect-horizontal",
  ]);
  pointCloseTo(paths[0].samples[0], { x: 0.3, y: 0.3 });
  pointCloseTo(paths[1].samples[0], { x: 0.3, y: 0.7 });
  assert.equal(paths[0].layerId, "cyan");
  assert.equal(paths[0].color, "#00ffff");
  assert.equal(paths[0].brushSize, 0.025);
  assert.equal(paths[0].durationMs, 100);
  assert.equal(paths[0].releaseMs, 50);
  closeTo(paths[0].totalLength, 0.2);

  const moved = generateTransformedPaths(mark, { sceneTransform: { translateY: 0.1 } });
  assert.deepEqual(moved.map(({ id }) => id), paths.map(({ id }) => id));
  pointCloseTo(moved[0].samples[0], { x: 0.3, y: 0.4 });
});

test("transformed path and voice generation can deduplicate coincident reflections", () => {
  const centerDot = {
    id: "center",
    axes: REFLECTION_AXES,
    releaseMs: 0,
    samples: [{ x: 0.5, y: 0.5, tMs: 0 }],
  };
  assert.equal(generateTransformedPaths(centerDot).length, 8);
  assert.equal(generateTransformedPaths(centerDot, { dedupeCoincident: true }).length, 1);

  const voices = generateTransformedVoices({
    ...centerDot,
    samples: [{ x: 0.25, y: 0.25, tMs: 0 }],
    axes: ["horizontal"],
  }, 0);
  assert.equal(voices.length, 2);
  assert.deepEqual(voices.map(({ key }) => key), [
    "playhead-paint:center@identity",
    "playhead-paint:center@reflect-horizontal",
  ]);
  closeTo(voices[0].gain, 1 / Math.sqrt(2));
  closeTo(voices[1].gain, 1 / Math.sqrt(2));
  assert.ok(voices.every(({ frequencyHz, pan, timbre }) => (
    Number.isFinite(frequencyHz) && Number.isFinite(pan) && Number.isFinite(timbre)
  )));

  const outside = generateTransformedVoices({
    id: "outside",
    transform: { translateX: 0.4 },
    samples: [{ x: 0.9, y: 0.5, tMs: 0 }],
  }, 0);
  // Geometry retains scene/local overflow; only normalized audio mapping clamps it.
  closeTo(outside[0].x, 1.3);
  closeTo(outside[0].pan, 1);
});

test("recorded loop layout preserves offsets, overlap, release, and mark order", () => {
  const layout = layoutPaintLoop([
    {
      id: "later",
      startOffsetMs: 100,
      durationMs: 200,
      releaseMs: 50,
      samples: [{ x: 0, y: 0, tMs: 0 }, { x: 1, y: 0, tMs: 200 }],
    },
    {
      id: "earlier",
      startOffsetMs: 25,
      durationMs: 75,
      releaseMs: 0,
      samples: [{ x: 0, y: 0, tMs: 0 }, { x: 0, y: 1, tMs: 75 }],
    },
  ], { mode: "recorded", loopGapMs: 100 });
  assert.deepEqual(layout.entries.map(({ id }) => id), ["earlier", "later"]);
  assert.deepEqual(layout.entries.map(({ startMs }) => startMs), [25, 100]);
  assert.deepEqual(layout.entries.map(({ noteOffMs }) => noteOffMs), [100, 300]);
  assert.deepEqual(layout.entries.map(({ releaseEndMs }) => releaseEndMs), [100, 350]);
  assert.equal(layout.contentDurationMs, 350);
  assert.equal(layout.durationMs, 450);
});

test("steady loop layout uses path distance, sequential gaps, and tap duration", () => {
  const layout = layoutPaintLoop([
    {
      id: "line",
      startOffsetMs: 50,
      releaseMs: 0,
      samples: [{ x: 0, y: 0, tMs: 0 }, { x: 0.35, y: 0, tMs: 5_000 }],
    },
    {
      id: "dot",
      startOffsetMs: 100,
      releaseMs: 0,
      durationMs: 4_000,
      samples: [{ x: 0.2, y: 0.2, tMs: 0 }],
    },
  ], {
    mode: "steady",
    steadySpeed: 0.35,
    interMarkGapMs: 50,
    dotDurationMs: 120,
    loopGapMs: 30,
  });
  assert.equal(layout.entries[0].durationMs, 1_000);
  assert.equal(layout.entries[0].startMs, 0);
  assert.equal(layout.entries[1].startMs, 1_050);
  assert.equal(layout.entries[1].durationMs, 120);
  assert.equal(layout.contentDurationMs, 1_170);
  assert.equal(layout.durationMs, 1_200);
  assert.equal(layoutPaintLoop([], { loopGapMs: 500 }).durationMs, 0);
});

test("loop helpers wrap clocks and include attack/sustain/release windows", () => {
  const layout = layoutPaintLoop([{
    id: "voice",
    startOffsetMs: 20,
    durationMs: 50,
    releaseMs: 30,
    samples: [{ x: 0, y: 0, tMs: 0 }, { x: 1, y: 0, tMs: 50 }],
  }], { loopGapMs: 20 });
  assert.equal(layout.durationMs, 120);
  assert.equal(loopTimeAt(layout, 125), 5);
  assert.equal(loopTimeAt(layout, -5), 115);
  assert.equal(loopEntriesAtTime(layout, 40).length, 1);
  assert.equal(loopEntriesAtTime(layout, 80).length, 1);
  assert.equal(loopEntriesAtTime(layout, 80, { includeRelease: false }).length, 0);
  assert.equal(loopEntriesAtTime(layout, 110).length, 0);
  assert.equal(loopTimeAt({ durationMs: 0 }, Infinity), 0);
});
