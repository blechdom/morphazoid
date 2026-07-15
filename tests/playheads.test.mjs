import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalHeadOffsets,
  sanitizeHeadOffsets,
  updateHeadOffset,
  wrapOffset,
} from "../src/playheads.js";

test("canonical point and parallel layouts are equidistant", () => {
  assert.deepEqual(canonicalHeadOffsets(1), [0]);
  assert.deepEqual(canonicalHeadOffsets(4), [0, 0.25, 0.5, 0.75]);
});

test("crossed layouts distribute each scan axis independently", () => {
  assert.deepEqual(canonicalHeadOffsets(2, "crossed"), [0, 0]);
  assert.deepEqual(canonicalHeadOffsets(4, "crossed"), [0, 0, 0.5, 0.5]);
  assert.deepEqual(canonicalHeadOffsets(3, "crossed"), [0, 0, 0.5]);
});

test("custom offsets wrap, overlap, sanitize, and retain stable order", () => {
  assert.equal(wrapOffset(-0.2), 0.8);
  assert.ok(Math.abs(wrapOffset(1.2) - 0.2) < 1e-12);
  assert.deepEqual(sanitizeHeadOffsets([0.1, Number.NaN], 3), [0.1, 1 / 3, 2 / 3]);
  assert.deepEqual(updateHeadOffset([0, 0.5], 1, 1), [0, 0]);
});
