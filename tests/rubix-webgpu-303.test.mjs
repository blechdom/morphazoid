import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_303_DEFAULT_STEP_MODULATION,
  WEBGPU_303_BUFFER_PARAM_ORDER,
  WEBGPU_303_PARAM_ORDER,
  WEBGPU_303_SEQUENCE_LENGTH,
  WebGpu303Audio,
  sanitizeWebGpu303Params,
  sanitizeWebGpu303StepModulation,
  webGpu303StepModulationArray,
} from "../src/webgpu-303.js";
import {
  RUBIX_WEBGPU_303_DEFAULTS,
  createRubixWebGpu303Pattern,
  rubixWebGpu303Placement,
} from "../src/rubix-webgpu-303.js";
import {
  RUBIX_SNAKE_ORDER,
  createRubixSequenceSnapshot,
  createSolvedRubixCube,
  extractRubixFace,
  turnRubixLayer,
} from "../src/rubix.js";

const root = new URL("../", import.meta.url);
const near = (actual, expected, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
};

function faceCell(cube, face, row, column) {
  return extractRubixFace(cube, face).find((sticker) => (
    sticker.homeRow === row && sticker.homeColumn === column
  ));
}

function numericValues(value) {
  return Object.values(value).filter((entry) => Number.isFinite(entry));
}

function assertStepModulation(step) {
  assert.ok(Array.isArray(step), "each WebGPU 303 step should be a plain vec4");
  assert.equal(step.length, 4);
  assert.ok(step.every(Number.isFinite));
  assert.ok(step[0] >= 0 && step[0] <= 1, "step gain should remain normalized");
}

test("WebGPU 303 exposes a neutral, bounded vec4 modulation lane", () => {
  assert.deepEqual(WEBGPU_303_DEFAULT_STEP_MODULATION, [1, 0, 0, 0]);
  assert.ok(Object.isFrozen(WEBGPU_303_DEFAULT_STEP_MODULATION));

  const custom = [
    [0, 1.25, 2.5, -0.75],
    [0.4, -2, 3, 0.5],
  ];
  const sanitized = sanitizeWebGpu303StepModulation(custom);
  assert.equal(sanitized.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.deepEqual(sanitized[0], custom[0]);
  assert.deepEqual(sanitized[1], custom[1]);
  assert.deepEqual(sanitized.at(-1), WEBGPU_303_DEFAULT_STEP_MODULATION);
  sanitized.forEach(assertStepModulation);

  const invalid = sanitizeWebGpu303StepModulation([
    [Number.NaN, Number.POSITIVE_INFINITY, "x", null],
  ]);
  assert.deepEqual(invalid[0], WEBGPU_303_DEFAULT_STEP_MODULATION);

  const packed = webGpu303StepModulationArray(custom);
  assert.ok(packed instanceof Float32Array);
  assert.equal(packed.length, WEBGPU_303_SEQUENCE_LENGTH * 4);
  Array.from(packed.slice(0, 8)).forEach((value, index) => near(value, custom.flat()[index]));

  const audio = new WebGpu303Audio({});
  audio.updateStepModulation(custom);
  assert.deepEqual(audio.stepModulation.slice(0, 2), custom);
});

test("Rubix sticker placement is deterministic, normalized, and follows current geometry", () => {
  const solved = createSolvedRubixCube();
  const left = faceCell(solved, "front", 1, 0);
  const center = faceCell(solved, "front", 1, 1);
  const right = faceCell(solved, "front", 1, 2);
  const top = faceCell(solved, "front", 0, 1);
  const bottom = faceCell(solved, "front", 2, 1);
  const sourceCenter = structuredClone(center);

  const placements = [
    rubixWebGpu303Placement(left, 3, solved.size, 1, 0.68),
    rubixWebGpu303Placement(center, 4, solved.size, 1, 0.68),
    rubixWebGpu303Placement(right, 5, solved.size, 1, 0.68),
    rubixWebGpu303Placement(top, 1, solved.size, 1, 0.68),
    rubixWebGpu303Placement(bottom, 7, solved.size, 1, 0.68),
  ];
  for (const placement of placements) {
    assert.ok(Object.isFrozen(placement));
    assert.ok(numericValues(placement).length >= 4, "placement should expose several sound factors");
    assert.ok(numericValues(placement).every(Number.isFinite));
    assert.ok(
      Math.abs(placement.stereoDelta) <= 0.2,
      "column stereo should stay a subtle detune rather than split the pitch",
    );
  }
  assert.deepEqual(
    rubixWebGpu303Placement(center, 4, solved.size, 1, 0.68),
    placements[1],
    "the mapping should not contain random modulation",
  );
  assert.notDeepEqual(placements[0], placements[2], "horizontal placement should affect sound");
  assert.notDeepEqual(placements[3], placements[4], "vertical placement should affect sound");

  const turned = turnRubixLayer(solved, {
    axis: "y",
    layer: top.position.y,
    direction: 1,
  });
  const movedSticker = turned.stickers.find(({ id }) => id === top.id);
  assert.notDeepEqual(
    rubixWebGpu303Placement(movedSticker, 1, turned.size, 1, 0.68),
    placements[3],
    "turning the same sticker onto another face should retune its placement modulation",
  );
  assert.deepEqual(center, sourceCenter, "placement mapping must not mutate cube stickers");

  const dryLeft = rubixWebGpu303Placement(left, 3, solved.size, 1, 0);
  const dryRight = rubixWebGpu303Placement(right, 5, solved.size, 1, 0);
  assert.deepEqual(
    dryLeft.modulation,
    dryRight.modulation,
    "zero amount should bypass geometric tone modulation",
  );
});

test("Rubix WebGPU 303 patterns follow read order, tempo, visibility, and safe synth limits", () => {
  const snapshot = createRubixSequenceSnapshot(createSolvedRubixCube());
  const visibilityById = Object.freeze(Object.fromEntries(
    snapshot.stickerIds.map((id) => [id, 1]),
  ));
  const options = {
    readingMode: "parallel",
    tempo: 126,
    visibilityById,
    amount: 0.68,
    baseParams: RUBIX_WEBGPU_303_DEFAULTS,
  };
  const pattern = createRubixWebGpu303Pattern(snapshot, options);

  assert.ok(Object.isFrozen(pattern));
  assert.deepEqual(Object.keys(pattern).sort(), [
    "params",
    "placements",
    "sequence",
    "stepModulation",
  ]);
  assert.deepEqual(pattern.params, sanitizeWebGpu303Params(pattern.params));
  assert.deepEqual(Object.keys(pattern.params), WEBGPU_303_BUFFER_PARAM_ORDER);
  assert.deepEqual(
    WEBGPU_303_BUFFER_PARAM_ORDER.slice(0, -2),
    WEBGPU_303_PARAM_ORDER,
    "the Rubix-only timing fields should preserve the standalone control order",
  );
  assert.equal(pattern.params.sequencePhase, 0);
  assert.equal(pattern.sequence.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.equal(pattern.stepModulation.length, WEBGPU_303_SEQUENCE_LENGTH);
  pattern.stepModulation.forEach(assertStepModulation);
  assert.equal(pattern.placements.length, snapshot.lanes.acid.length);
  assert.deepEqual(
    pattern.sequence.slice(0, snapshot.lanes.acid.length),
    snapshot.audio.acidNormalized,
  );

  const snake = createRubixWebGpu303Pattern(snapshot, {
    ...options,
    readingMode: "snake",
  });
  assert.deepEqual(
    snake.sequence.slice(0, snapshot.lanes.acid.length),
    RUBIX_SNAKE_ORDER.map((index) => snapshot.audio.acidNormalized[index]),
    "the GPU pattern should use the same sticker traversal as the visible score",
  );

  const slow = createRubixWebGpu303Pattern(snapshot, { ...options, tempo: 60 });
  const fast = createRubixWebGpu303Pattern(snapshot, { ...options, tempo: 240 });
  assert.ok(
    fast.params.timeScale > slow.params.timeScale,
    "the continuous GPU shader clock should stay synchronized with Rubix tempo",
  );
  const swung = createRubixWebGpu303Pattern(snapshot, {
    ...options,
    baseParams: { ...RUBIX_WEBGPU_303_DEFAULTS, swing: 0.27 },
  });
  assert.equal(swung.params.swing, 0.27, "Rubix swing should reach the GPU timing warp");

  const hiddenId = snapshot.lanes.acid[0].id;
  const hidden = createRubixWebGpu303Pattern(snapshot, {
    ...options,
    visibilityById: { ...visibilityById, [hiddenId]: 0 },
  });
  assert.equal(hidden.stepModulation[0][0], 0, "a sticker that cannot be seen must be silent");

  const partiallyVisible = createRubixWebGpu303Pattern(snapshot, {
    ...options,
    visibilityById: { ...visibilityById, [hiddenId]: 0.25 },
  });
  assert.ok(partiallyVisible.stepModulation[0][0] > 0);
  assert.ok(partiallyVisible.stepModulation[0][0] < pattern.stepModulation[0][0]);
});

test("Rubix exposes Web Audio/WebGPU 303 choice and tears the GPU engine down safely", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("rubix-app.js", root), "utf8"),
  ]);

  const acidEngine = html.match(/<select\b[^>]*\bid="acidEngine"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(acidEngine, "the Acid voice panel should expose its engine setting");
  assert.match(acidEngine, /value="web-audio"[^>]*selected/);
  assert.match(acidEngine, /value="webgpu-303"/);

  const modulation = html.match(/<input\b[^>]*\bid="stickerModulation"[^>]*>/)?.[0];
  assert.ok(modulation, "sticker placement influence should be adjustable");
  assert.match(modulation, /\btype="range"/);
  assert.match(modulation, /\bmin="0"/);
  assert.match(modulation, /\bmax="1"/);

  assert.match(app, /WebGpu303Audio/);
  assert.match(app, /webGpu303Support\(globalThis\)/);
  assert.match(app, /createRubixWebGpu303Pattern/);
  assert.match(app, /updateStepModulation\(/);
  assert.match(
    app,
    /state\.soundBank\s*===\s*["']acid-303["']/,
    "WebGPU should only be relevant inside the Acid 303 sound bank",
  );
  assert.match(
    app,
    /state\.soundBank\s*!==\s*["']acid-303["'][\s\S]{0,300}(?:stopWebGpu303Engine|return false|disabled)/,
    "leaving the acid bank should stop, bypass, or disable its WebGPU sub-engine",
  );
  assert.match(
    app,
    /webgpu[\s\S]{0,500}supported|supported[\s\S]{0,500}webgpu/i,
    "unsupported WebGPU should be detected before selecting the engine",
  );

  const pagehide = app.slice(app.indexOf('window.addEventListener("pagehide"'));
  assert.match(pagehide, /\.stop\(\)/, "page exit should release the WebGPU device and AudioContext");
});
