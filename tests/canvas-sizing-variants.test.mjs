import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canvasSizing } from "../src/graphics/canvas-sizing.js";
import { runCanvasResize } from "./helpers/canvas-resize-harness.mjs";
import { currentSourcePath } from "./helpers/relocated-sources.mjs";

const reference = JSON.parse(await readFile(new URL("./fixtures/canvas-resize-variants-v1.json", import.meta.url)));
const dimensions = [
  [1440, 900], [390, 844], [844, 390], [801.49, 603.51],
  [0, 0], [-2, 0.5], [10000, 9000], [Infinity, 300], [Number.NaN, 300],
];
const ratios = [undefined, 0, -1, 0.5, 1, 1.25, 2, 3, Infinity, Number.NaN];

// Throat Singer now keeps anatomy in fixed coordinates at the owner's request.
// Preserve the frozen pixel-allocation/lifecycle evidence and separately verify
// its uniformly scaled view; do not rewrite the historical callback fixture.
function compareThroatSingerResize(actual, expected) {
  const { viewTransform, ...preserved } = actual;
  assert.equal(actual.cssWidth, 900);
  assert.equal(actual.cssHeight, 720);
  assert.equal(viewTransform.width, expected.cssWidth);
  assert.equal(viewTransform.height, expected.cssHeight);
  assert.equal(viewTransform.scale, Math.min(expected.cssWidth / 900, expected.cssHeight / 720));
  assert.equal(Number(viewTransform.dataset.viewScaleX), viewTransform.scale);
  assert.equal(Number(viewTransform.dataset.viewScaleY), viewTransform.scale);
  assert.equal(viewTransform.dataset.modelWidth, "900");
  assert.equal(viewTransform.dataset.modelHeight, "720");
  preserved.cssWidth = expected.cssWidth;
  preserved.cssHeight = expected.cssHeight;
  preserved.calls = actual.calls.map(call => call[0] === "width"
    ? [call[0], call[1], expected.cssWidth, expected.cssHeight, call[4]] : call);
  assert.deepEqual(preserved, expected);
}

for (const entry of reference.entries) {
  const current = await readFile(new URL(`../${currentSourcePath(entry.file)}`, import.meta.url), "utf8");
  // Respect the function's indentation, including nested graph controllers.
  const callback = current.match(/(^[ \t]*)function resizeCanvas\(\) \{[\s\S]*?\n\1\}/m)?.[0].trimStart();
  assert.ok(callback, `${entry.file} callback must exist`);
  assert.match(current, /import \{ canvasSizing \}/, `${entry.file} must use the shared sizing module`);
  assert.match(callback, /canvasSizing\(/, `${entry.file} must not reintroduce an inline sizing implementation`);

  const throatSinger = entry.file === "throat-singing-app.js";
  const modelOptions = throatSinger ? { modelSize: { width: 900, height: 720 } } : {};

  test(`${entry.file}: existing sizing policy and callback effects are preserved`, () => {
    for (const [width, height] of dimensions) {
      for (const dpr of ratios) {
        const bounds = { width, height };
        const expected = runCanvasResize(entry.source, bounds, dpr).execute(canvasSizing);
        const sizing = canvasSizing(bounds, dpr, entry.options);
        assert.deepEqual({
          cssWidth: sizing.cssWidth, cssHeight: sizing.cssHeight, pixelRatio: sizing.pixelRatio,
          width: sizing.width, height: sizing.height,
        }, {
          cssWidth: expected.cssWidth, cssHeight: expected.cssHeight, pixelRatio: expected.pixelRatio,
          width: expected.backing.width, height: expected.backing.height,
        }, `policy at ${width}x${height}, DPR ${dpr}`);
        const actual = runCanvasResize(callback, bounds, dpr, modelOptions).execute(canvasSizing);
        if (throatSinger) compareThroatSingerResize(actual, expected);
        else assert.deepEqual(actual, expected);
      }
    }
  });

  test(`${entry.file}: repeated resize, disposal, active gestures, and pending frames retain their behavior`, () => {
    for (const scene of [
      { repetitions: 2 },
      { disposed: true },
      { activeGesture: true, scheduledFrame: 17, repetitions: 2 },
    ]) {
      const bounds = { width: 801.25, height: 605.75 };
      const actual = runCanvasResize(callback, bounds, 1.5, { ...scene, ...modelOptions }).execute(canvasSizing);
      const expected = runCanvasResize(entry.source, bounds, 1.5, scene).execute(canvasSizing);
      if (throatSinger) compareThroatSingerResize(actual, expected);
      else assert.deepEqual(actual, expected);
    }
  });
}

test("policy options do not impose a new budget or minimum device scale", () => {
  assert.equal(canvasSizing({ width: 10000, height: 10000 }, 2, { pixelBudget: null }).pixelRatio, 2);
  assert.equal(canvasSizing({ width: 400, height: 300 }, 0.5, {
    pixelBudget: null, minPixelRatio: null, maxPixelRatio: 2.5,
  }).pixelRatio, 0.5);
  assert.equal(canvasSizing({ width: Infinity, height: 300 }, 2, { pixelBudget: null }).pixelRatio, 2);
});
