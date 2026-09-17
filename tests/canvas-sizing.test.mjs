import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { canvasSizing } from "../src/graphics/canvas-sizing.js";

// Verbatim resizeCanvas() body shared by Solid/Hyper at 4e9feed. Keep this
// independent reference unchanged when editing the extracted implementation.
const reference = await readFile(new URL("./fixtures/canvas-resize-v1.txt", import.meta.url), "utf8");
const pages = await Promise.all([
  "solid", "hyper", "l-system", "l-system-drums", "l-systems", "physics",
].map(async (id) => {
  const source = await readFile(new URL(`../${id}-app.js`, import.meta.url), "utf8");
  const resize = source.match(/function resizeCanvas\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(resize, `${id} resize callback must exist`);
  return { id, resize };
}));

function runResize(source, bounds, devicePixelRatio) {
  const calls = [];
  const result = {};
  const runtime = {
    cssWidth: 1, cssHeight: 1, pixelRatio: 1,
    canvasSizing,
    stageWrap: { getBoundingClientRect() { calls.push("measure"); return bounds; } },
    window: { get devicePixelRatio() { calls.push("read-dpr"); return devicePixelRatio; } },
    canvas: {
      set width(value) {
        result.width = value;
        calls.push(["width", value, runtime.cssWidth, runtime.cssHeight, runtime.pixelRatio]);
      },
      set height(value) { result.height = value; calls.push(["height", value]); },
    },
    scheduleFrame() { calls.push("schedule"); },
  };
  runInNewContext(`${source}\nresizeCanvas();`, runtime);
  return {
    sizing: {
      cssWidth: runtime.cssWidth,
      cssHeight: runtime.cssHeight,
      pixelRatio: runtime.pixelRatio,
      ...result,
    },
    calls,
  };
}

const cases = [
  [1440, 900, 1], [390, 844, 3], [844, 390, 2],
  [800.49, 600.51, 1.25], [0, 0, 0], [0.49, 0.51, undefined],
  [-10, -20, -1], [1, 1, 0.5], [3840, 2160, 4],
  [10000, 10000, 3], [400, 300, Number.NaN],
  [Infinity, 300, 2], [Number.NaN, 300, 2], [400, 300, Infinity],
];

test("canvas sizing matches the original calculation, including existing edge behavior", () => {
  for (const [width, height, dpr] of cases) {
    const bounds = { width, height };
    assert.deepEqual(canvasSizing(bounds, dpr), runResize(reference, bounds, dpr).sizing);
  }
});

test("a reproducible range of fractional sizes preserves the original calculation", () => {
  let seed = 0x4e9feed;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let index = 0; index < 160; index += 1) {
    const bounds = { width: next() * 8000, height: next() * 5000 };
    const dpr = next() * 5;
    assert.deepEqual(canvasSizing(bounds, dpr), runResize(reference, bounds, dpr).sizing);
  }
});

for (const { id, resize } of pages) {
  test(`${id} preserves measurement, assignment, and frame scheduling behavior`, () => {
    for (const [width, height, dpr] of cases) {
      const bounds = { width, height };
      assert.deepEqual(runResize(resize, bounds, dpr), runResize(reference, bounds, dpr));
    }
  });
}
