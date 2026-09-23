import assert from "node:assert/strict";
import test from "node:test";
import { SHAPES_FULL_PRESETS, randomizeShapesPreset } from "../src/instruments/shapes/full-presets.js";

test("Shapes generative dice gives comparable coverage to 2D, 3D and 4D, independently of preset-bank sizes", () => {
  let seed = 20260923;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const counts = { "2d": 0, "3d": 0, "4d": 0 };
  let current = SHAPES_FULL_PRESETS[0].snapshot;
  for (let roll = 0; roll < 6000; roll++) {
    current = randomizeShapesPreset(current, random);
    counts[current.parameters.selection.dimension]++;
  }
  // A fixed seed makes this non-flaky. Broad bounds deliberately avoid pinning
  // the RNG call order when another legitimate musical parameter is added.
  for (const [dimension, count] of Object.entries(counts)) {
    assert.ok(count >= 1800 && count <= 2200, `${dimension}: ${count}/6000`);
  }
});
