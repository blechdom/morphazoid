import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShape,
  horizontalIntersections,
  pingPong01,
  pointAtPath,
  verticalIntersections,
  wrap01,
} from "../src/geometry.js";

const EPSILON = 1e-8;

function near(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("sides=2 is one open line and signed curvature bends opposite ways", () => {
  const straight = buildShape({ sides: 2, curvature: 0, samplesPerEdge: 16 });
  assert.equal(straight.closed, false);
  assert.equal(straight.vertexIndices.length, 2);
  assert.notDeepEqual(straight.points[0], straight.points[straight.points.length - 1]);
  near(straight.points[0].x, -1);
  near(straight.points[0].y, 0);
  near(straight.points[straight.points.length - 1].x, 1);
  near(straight.points[straight.points.length - 1].y, 0);
  near(straight.totalLength, 2);

  const positive = buildShape({ sides: 2, curvature: 1, samplesPerEdge: 16 });
  const negative = buildShape({ sides: 2, curvature: -1, samplesPerEdge: 16 });
  const midpoint = positive.samplesPerEdge / 2;
  assert.ok(positive.points[midpoint].y > 0.7);
  assert.ok(negative.points[midpoint].y < -0.7);
  near(positive.points[midpoint].y, -negative.points[midpoint].y);
});

test("three or more sides produce closed paths without a duplicated seam point", () => {
  for (const sides of [3, 4, 8, 16]) {
    const shape = buildShape({ sides, curvature: 0, samplesPerEdge: 12 });
    assert.equal(shape.closed, true);
    assert.equal(shape.vertexIndices.length, sides);
    assert.equal(shape.points.length, sides * 12);
    assert.notDeepEqual(shape.points[0], shape.points[shape.points.length - 1]);
    assert.deepEqual(pointAtPath(shape, 0), pointAtPath(shape, 1));
  }
});

test("curvature +1 follows the unit circumcircle and removes true corners", () => {
  const circle = buildShape({ sides: 5, curvature: 1, samplesPerEdge: 24 });
  for (const point of circle.points) near(Math.hypot(point.x, point.y), 1, 1e-10);
  for (const cornerStrength of circle.cornerStrengths) near(cornerStrength, 0, 1e-10);
});

test("negative curvature bows polygon edges inward without crossing the center", () => {
  const straight = buildShape({ sides: 4, curvature: 0, samplesPerEdge: 20 });
  const inward = buildShape({ sides: 4, curvature: -1, samplesPerEdge: 20 });
  const edgeMidpoint = 10;
  const straightRadius = Math.hypot(straight.points[edgeMidpoint].x, straight.points[edgeMidpoint].y);
  const inwardRadius = Math.hypot(inward.points[edgeMidpoint].x, inward.points[edgeMidpoint].y);
  assert.ok(inwardRadius < straightRadius * 0.3);
  assert.ok(inwardRadius > 0.1);
  assert.ok(inward.points.every((point) => Math.hypot(point.x, point.y) > 0.1));
});

test("rotation is expressed in degrees around the instrument origin", () => {
  const vertical = buildShape({ sides: 2, curvature: 0, rotationDeg: 90 });
  near(vertical.points[0].x, 0);
  near(vertical.points[0].y, -1);
  near(vertical.points[vertical.points.length - 1].x, 0);
  near(vertical.points[vertical.points.length - 1].y, 1);
});

test("pointAtPath uses constant arclength and supports open-line ping-pong", () => {
  const line = buildShape({ sides: 2, curvature: 0 });
  near(pointAtPath(line, 0.25).x, -0.5);
  near(pointAtPath(line, 0.5).x, 0);
  near(pointAtPath(line, 0.75).x, 0.5);
  near(pointAtPath(line, 2).x, 1);
  near(pointAtPath(line, 1.25, { pingPong: true }).x, 0.5);
  near(pointAtPath(line, 1.75, { pingPong: true }).x, -0.5);

  const triangle = buildShape({ sides: 3, curvature: 0, samplesPerEdge: 16 });
  const secondVertex = triangle.points[triangle.vertexIndices[1]];
  const oneThird = pointAtPath(triangle, 1 / 3);
  near(oneThird.x, secondVertex.x);
  near(oneThird.y, secondVertex.y);
  near(oneThird.cornerDistance, 0);
});

test("progress helpers wrap and reflect negative and positive values", () => {
  near(wrap01(-0.25), 0.75);
  near(wrap01(1.25), 0.25);
  near(pingPong01(-0.25), 0.25);
  near(pingPong01(1.25), 0.75);
  near(pingPong01(2.25), 0.25);
});

test("vertical scans are sorted, dedupe shared vertices, and include sonification metadata", () => {
  const diamond = buildShape({ sides: 4, curvature: 0, samplesPerEdge: 16 });
  const vertexHits = verticalIntersections(diamond, 0);
  assert.equal(vertexHits.length, 2);
  near(vertexHits[0].y, -1);
  near(vertexHits[1].y, 1);
  assert.ok(vertexHits.every((hit) => hit.cornerDistance <= EPSILON));
  assert.ok(vertexHits.every((hit) => hit.cornerStrength > 0));
  assert.ok(vertexHits.every((hit) => Math.hypot(hit.tangent.x, hit.tangent.y) > 0.99));

  const ordinaryHits = verticalIntersections(diamond, 0.25);
  assert.equal(ordinaryHits.length, 2);
  assert.ok(ordinaryHits[0].y < ordinaryHits[1].y);
  assert.ok(ordinaryHits.every((hit) => hit.segmentT >= 0 && hit.segmentT <= 1));

  const line = buildShape({ sides: 2, curvature: 0 });
  const lineHits = verticalIntersections(line, 0);
  assert.equal(lineHits.length, 1);
  near(lineHits[0].x, 0);
  near(lineHits[0].y, 0);
});

test("a scan coincident with a sampled straight edge collapses to its outer endpoints", () => {
  const verticalLine = buildShape({
    sides: 2,
    curvature: 0,
    rotationDeg: 90,
    samplesPerEdge: 48,
  });
  const lineOverlap = verticalIntersections(verticalLine, 0);
  assert.equal(lineOverlap.length, 2);
  near(lineOverlap[0].y, -1);
  near(lineOverlap[1].y, 1);

  const square = buildShape({
    sides: 4,
    curvature: 0,
    rotationDeg: 45,
    samplesPerEdge: 48,
  });
  const sideOverlap = verticalIntersections(square, Math.SQRT1_2);
  assert.equal(sideOverlap.length, 2);
  near(sideOverlap[0].y, -Math.SQRT1_2);
  near(sideOverlap[1].y, Math.SQRT1_2);
});

test("horizontal scans mirror vertical scan behavior and preserve contact metadata", () => {
  const diamond = buildShape({ sides: 4, curvature: 0, samplesPerEdge: 16 });
  const vertexHits = horizontalIntersections(diamond, 0);
  assert.equal(vertexHits.length, 2);
  near(vertexHits[0].x, -1);
  near(vertexHits[1].x, 1);
  assert.ok(vertexHits.every((hit) => hit.cornerDistance <= EPSILON));
  assert.ok(vertexHits.every((hit) => Math.hypot(hit.tangent.x, hit.tangent.y) > 0.99));

  const ordinaryHits = horizontalIntersections(diamond, 0.25);
  assert.equal(ordinaryHits.length, 2);
  assert.ok(ordinaryHits[0].x < ordinaryHits[1].x);

  const horizontalLine = buildShape({ sides: 2, curvature: 0, samplesPerEdge: 48 });
  const overlap = horizontalIntersections(horizontalLine, 0);
  assert.equal(overlap.length, 2);
  near(overlap[0].x, -1);
  near(overlap[1].x, 1);

  const verticalLine = buildShape({ sides: 2, curvature: 0, rotationDeg: 90 });
  const centerHit = horizontalIntersections(verticalLine, 0);
  assert.equal(centerHit.length, 1);
  near(centerHit[0].x, 0);
  near(centerHit[0].y, 0);
});

test("shape input validation and clamping keep geometry finite", () => {
  assert.throws(() => buildShape({ sides: 1, curvature: 0 }), RangeError);
  assert.throws(() => buildShape({ sides: 17, curvature: 0 }), RangeError);
  assert.throws(() => buildShape({ sides: 3.5, curvature: 0 }), RangeError);
  const clamped = buildShape({ sides: 3, curvature: 12, samplesPerEdge: 2 });
  assert.equal(clamped.curvature, 1);
  assert.equal(clamped.samplesPerEdge, 4);
  assert.ok(clamped.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});
