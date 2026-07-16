import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTesseract,
  hyperplaneIntersections,
  projectPoint4,
  transformedTesseract,
} from "../src/hyper.js";

test("the tesseract has 16 corners and 32 one-axis edges", () => {
  const tesseract = buildTesseract();
  assert.equal(tesseract.vertices.length, 16);
  assert.equal(tesseract.edges.length, 32);
  assert.deepEqual(new Set(tesseract.edges.map((edge) => edge.axis)), new Set(["x", "y", "z", "w"]));
});

test("4D rotation and W-plane contacts remain finite", () => {
  const tesseract = transformedTesseract({ xw: 28, yw: -17, zw: 11 });
  const contacts = hyperplaneIntersections(tesseract, 0);
  assert.ok(contacts.length >= 4);
  for (const point of [...tesseract.vertices, ...contacts]) {
    assert.ok([point.x, point.y, point.z, point.w].every(Number.isFinite));
    assert.ok([projectPoint4(point).x, projectPoint4(point).y].every(Number.isFinite));
  }
});
