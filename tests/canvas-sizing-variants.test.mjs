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

for (const entry of reference.entries) {
  const current = await readFile(new URL(`../${currentSourcePath(entry.file)}`, import.meta.url), "utf8");
  // Respect the function's indentation, including nested graph controllers.
  const callback = current.match(/(^[ \t]*)function resizeCanvas\(\) \{[\s\S]*?\n\1\}/m)?.[0].trimStart();
  assert.ok(callback, `${entry.file} callback must exist`);
  assert.match(current, /import \{ canvasSizing \}/, `${entry.file} must use the shared sizing module`);
  assert.match(callback, /canvasSizing\(/, `${entry.file} must not reintroduce an inline sizing implementation`);

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
        assert.deepEqual(runCanvasResize(callback, bounds, dpr).execute(canvasSizing), expected);
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
      assert.deepEqual(
        runCanvasResize(callback, bounds, 1.5, scene).execute(canvasSizing),
        runCanvasResize(entry.source, bounds, 1.5, scene).execute(canvasSizing),
      );
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
