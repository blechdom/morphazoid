import assert from "node:assert/strict";
import test from "node:test";

import { samplePoincareGeodesic } from "../src/escher-tessellation.js";

const close = (first, second, epsilon = 1e-9) => Math.abs(first - second) <= epsilon;

function orthogonalCircle(first, second) {
  const firstRight = (first.x * first.x + first.y * first.y + 1) / 2;
  const secondRight = (second.x * second.x + second.y * second.y + 1) / 2;
  const determinant = first.x * second.y - first.y * second.x;
  const center = {
    x: (firstRight * second.y - first.y * secondRight) / determinant,
    y: (first.x * secondRight - firstRight * second.x) / determinant,
  };
  return {
    center,
    radiusSquared: center.x * center.x + center.y * center.y - 1,
  };
}

test("samplePoincareGeodesic preserves endpoints and stays inside the disk", () => {
  const first = { x: -0.42, y: 0.18 };
  const second = { x: 0.56, y: 0.31 };
  const points = samplePoincareGeodesic(first, second, 32);

  assert.equal(points.length, 33);
  assert.deepEqual(points[0], first);
  assert.deepEqual(points.at(-1), second);
  assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.ok(points.every(({ x, y }) => x * x + y * y < 1));
});

test("samplePoincareGeodesic treats geodesics through the origin as diameters", () => {
  const points = samplePoincareGeodesic(
    { x: -0.75, y: 0 },
    { x: 0.6, y: 0 },
    12,
  );

  assert.equal(points.length, 13);
  for (let index = 0; index < points.length; index += 1) {
    assert.ok(close(points[index].y, 0));
    assert.ok(close(points[index].x, -0.75 + 1.35 * index / 12));
  }
});

test("curved geodesic samples share one circle orthogonal to the disk boundary", () => {
  const first = { x: 0.12, y: 0.58 };
  const second = { x: 0.67, y: -0.16 };
  const points = samplePoincareGeodesic(first, second, 48);
  const { center, radiusSquared } = orthogonalCircle(first, second);

  assert.ok(radiusSquared > 0);
  assert.ok(close(
    center.x * center.x + center.y * center.y - radiusSquared,
    1,
    1e-10,
  ));
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    assert.ok(close(dx * dx + dy * dy, radiusSquared, 1e-8));
    assert.ok(point.x * point.x + point.y * point.y < 1);
  }
});

test("malformed or exterior inputs still produce a bounded finite polyline", () => {
  const points = samplePoincareGeodesic(
    { x: Number.NaN, y: Number.POSITIVE_INFINITY },
    { x: 4, y: -3 },
    Number.NaN,
  );

  assert.equal(points.length, 25);
  assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.ok(points.every(({ x, y }) => x * x + y * y < 1));
});
