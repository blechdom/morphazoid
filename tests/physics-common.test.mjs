import assert from "node:assert/strict";
import test from "node:test";

import {
  convexHull,
  createFixedStepper,
  delaunayEdges,
  measurePolyline,
  pointAtDistance,
  pointInPolygon,
  regularPolygon,
} from "../src/physics-common.js";

test("regular physics polygons are deterministic and use centered model coordinates", () => {
  const first = regularPolygon(5, { radius: 0.7, rotation: 0.2 });
  const second = regularPolygon(5, { radius: 0.7, rotation: 0.2 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(pointInPolygon({ x: 0, y: 0 }, first), true);
  assert.equal(pointInPolygon({ x: 2, y: 0 }, first), false);
});

test("measured contour lookup wraps without changing geometric speed", () => {
  const path = measurePolyline([
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ]);
  assert.equal(path.total, 8);
  assert.deepEqual(pointAtDistance(path, 1), {
    x: 0,
    y: -1,
    tangent: { x: 1, y: 0 },
    edgeIndex: 0,
    edgeT: 0.5,
    distance: 1,
  });
  assert.deepEqual(pointAtDistance(path, 9), pointAtDistance(path, 1));
});

test("convex hull excludes interior points and Delaunay edges remain unique", () => {
  const points = [
    { id: 0, x: -1, y: -1 },
    { id: 1, x: 1, y: -1 },
    { id: 2, x: 1, y: 1 },
    { id: 3, x: -1, y: 1 },
    { id: 4, x: 0, y: 0 },
  ];
  assert.deepEqual(convexHull(points).map((point) => point.id), [0, 1, 2, 3]);
  const edges = delaunayEdges(points);
  assert.ok(edges.length >= 8);
  assert.equal(new Set(edges.map((edge) => edge.key)).size, edges.length);
});

test("fixed stepper produces the same step count across different frame chunking", () => {
  const first = createFixedStepper();
  const second = createFixedStepper();
  let firstCount = 0;
  let secondCount = 0;
  for (let index = 0; index < 60; index += 1) {
    first.advance(1 / 60, () => { firstCount += 1; });
  }
  for (let index = 0; index < 120; index += 1) {
    second.advance(1 / 120, () => { secondCount += 1; });
  }
  assert.equal(firstCount, 120);
  assert.equal(secondCount, 120);
});
