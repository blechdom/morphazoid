import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShape,
  pointAtPath,
  verticalIntersections,
} from "../../src/geometry.js";
import {
  analyzeContact,
  analyzeFrame,
  analyzePath,
  analyzeReader,
  classifySelfIntersections,
  flattenFeatureValues,
  pointContainment,
} from "../analysis.js";
import {
  FEATURE_REGISTRY,
  getFeatureDescriptor,
  normalizeFeatureValue,
} from "../feature-registry.js";

function near(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("the feature registry is a unique, stable, mapping-safe namespace", () => {
  const ids = FEATURE_REGISTRY.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 60);
  assert.deepEqual(getFeatureDescriptor("contact.polarAngle")?.normalization, {
    kind: "cyclic",
    minimum: -Math.PI,
    period: Math.PI * 2,
  });
  near(normalizeFeatureValue("geometry.compactness", 0.25), 0.25);
  near(normalizeFeatureValue("contact.polarAngle", -Math.PI), 0);
  near(normalizeFeatureValue("contact.polarAngle", Math.PI), 0);
  assert.equal(normalizeFeatureValue("geometry.area", null), null);
  assert.equal(normalizeFeatureValue("not.a.feature", 1), null);
});

test("form analysis reports sampled accuracy, invariants, and unavailable values", () => {
  const circle = buildShape({ sides: 1, samplesPerEdge: 128 });
  const circleAnalysis = analyzePath(circle);
  near(circleAnalysis.area, Math.PI, 0.002);
  near(circleAnalysis.perimeter, Math.PI * 2, 0.001);
  assert.ok(circleAnalysis.compactness > 0.999);
  assert.equal(circleAnalysis.solidity, 1);
  assert.equal(circleAnalysis.centerContainment.inside, true);
  assert.equal(circleAnalysis.quality.method, "sampled-polyline");
  assert.equal(circleAnalysis.quality.analytic, false);

  const line = buildShape({ sides: 2, curvature: 0.4, samplesPerEdge: 32 });
  const lineAnalysis = analyzePath(line);
  assert.equal(lineAnalysis.closed, false);
  assert.equal(lineAnalysis.area, null);
  assert.equal(lineAnalysis.compactness, null);
  assert.equal(lineAnalysis.solidity, null);
  assert.equal(lineAnalysis.centerContainment.inside, null);
  assert.equal(lineAnalysis.features["geometry.center.inside"], null);
});

test("rigid rotation preserves intrinsic form metrics", () => {
  const base = analyzePath(buildShape({
    sides: 7,
    shapeType: "star",
    starDepth: 0.48,
    curvature: 0.2,
    aspect: 0.35,
    skew: -0.2,
    rotationDeg: 0,
    samplesPerEdge: 48,
  }));
  const rotated = analyzePath(buildShape({
    sides: 7,
    shapeType: "star",
    starDepth: 0.48,
    curvature: 0.2,
    aspect: 0.35,
    skew: -0.2,
    rotationDeg: 137,
    samplesPerEdge: 48,
  }));
  near(rotated.area, base.area, 1e-10);
  near(rotated.perimeter, base.perimeter, 1e-10);
  near(rotated.compactness, base.compactness, 1e-10);
  near(rotated.solidity, base.solidity, 1e-10);
  assert.equal(rotated.selfIntersections.length, base.selfIntersections.length);
});

test("containment and nonadjacent segment intersections are explicit", () => {
  const bowTie = {
    points: [
      { x: -1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: 1, y: -1 },
    ],
    closed: true,
  };
  const intersections = classifySelfIntersections(bowTie);
  assert.equal(intersections.length, 1);
  assert.equal(intersections[0].kind, "cross");
  near(intersections[0].point.x, 0);
  near(intersections[0].point.y, 0);

  const square = buildShape({ sides: 4, curvature: 0, samplesPerEdge: 8 });
  assert.equal(pointContainment(square, { x: 0, y: 0 }).inside, true);
  assert.equal(pointContainment(square, { x: 1.2, y: 0 }).inside, false);
  assert.equal(pointContainment(square, square.points[0]).onBoundary, true);
});

test("contact analysis exposes edge, center, directional, and hull semantics", () => {
  const square = buildShape({ sides: 4, curvature: 0, samplesPerEdge: 8 });
  const contact = analyzeContact(square, pointAtPath(square, 0.125));
  assert.equal(contact.logicalEdgeIndex, 0);
  near(contact.logicalEdgeT, 0.5);
  near(contact.features["contact.contourPhase"], 0.125);
  assert.ok(Number.isFinite(contact.features["contact.polarAngle"]));
  assert.ok(Number.isFinite(contact.features["contact.tangentAngle"]));
  assert.ok(Number.isFinite(contact.features["contact.radialAlignment"]));
  assert.ok(Number.isFinite(contact.features["contact.centerFacing"]));
  assert.equal(contact.hullClass, "hull-boundary");

  const circle = buildShape({ sides: 1, samplesPerEdge: 64 });
  const smoothContact = analyzeContact(circle, pointAtPath(circle, 0.2));
  assert.equal(smoothContact.features["contact.corner.distance"], null);
  assert.ok(Number.isFinite(smoothContact.features["contact.curvature"]));
});

test("reader analysis orders contacts and identifies enter/exit inside spans", () => {
  const circle = buildShape({ sides: 1, samplesPerEdge: 96 });
  const reader = { id: "scan", type: "vertical", x: 0 };
  const contacts = verticalIntersections(circle, reader.x);
  const analysis = analyzeReader(circle, reader, null, { contacts });
  assert.equal(analysis.contacts.length, 2);
  assert.deepEqual(analysis.contacts.map(({ boundaryRole }) => boundaryRole), ["enter", "exit"]);
  assert.equal(analysis.insideIntervals.length, 1);
  near(analysis.insideSpan, 2, 1e-8);
  near(analysis.features["reader.insideFraction"], 1, 1e-8);

  const tracer = analyzeReader(circle, {
    id: "trace",
    type: "path",
    contacts: [pointAtPath(circle, 0.25)],
  });
  assert.equal(tracer.features["reader.insideIntervalCount"], null);
  assert.equal(tracer.features["reader.insideSpan"], null);
});

test("stable identities and pair-bifurcation events survive a rotating form", () => {
  const reader = { id: "fixed-scan", type: "vertical", x: 0.9 };
  const hiddenPath = buildShape({
    sides: 4,
    curvature: 0,
    rotationDeg: 45,
    samplesPerEdge: 24,
  });
  const hidden = analyzeFrame({
    path: hiddenPath,
    reader,
    contacts: verticalIntersections(hiddenPath, reader.x),
    timestamp: 0,
  });
  assert.equal(hidden.contacts.length, 0);

  const visiblePath = buildShape({
    sides: 4,
    curvature: 0,
    rotationDeg: 10,
    samplesPerEdge: 24,
  });
  const born = analyzeFrame({
    path: visiblePath,
    reader,
    contacts: verticalIntersections(visiblePath, reader.x),
    previousFrame: hidden,
    timestamp: 0.1,
  });
  assert.equal(born.contacts.length, 2);
  assert.equal(born.eventCounts.births, 2);
  assert.ok(born.events.some(({ type }) => type === "contact_pair_birth"));
  assert.ok(born.contacts.every(({ id }) => id.startsWith("fixed-scan:contact:")));

  const nextPath = buildShape({
    sides: 4,
    curvature: 0,
    rotationDeg: 5,
    samplesPerEdge: 24,
  });
  const continued = analyzeFrame({
    path: nextPath,
    reader,
    contacts: verticalIntersections(nextPath, reader.x),
    previousFrame: born,
    timestamp: 0.2,
  });
  assert.deepEqual(
    continued.contacts.map(({ id }) => id).sort(),
    born.contacts.map(({ id }) => id).sort(),
  );
  assert.ok(continued.contacts.every(({ age }) => age > 0));
});

test("one frame flattens to the same stable IDs consumed by mappings", () => {
  const path = buildShape({ sides: 5, curvature: 0.25, samplesPerEdge: 24 });
  const reader = { id: "trace", type: "path", contacts: [pointAtPath(path, 0.3)] };
  const frame = analyzeFrame({ path, reader, timestamp: 1 });
  const values = flattenFeatureValues(frame);
  assert.equal(values["geometry.closed"], true);
  assert.equal(values["reader.contactCount"], 1);
  near(values["contact.contourPhase"], 0.3);
  assert.equal(values["events.births"], 1);
  for (const id of Object.keys(values)) {
    assert.ok(getFeatureDescriptor(id), `flattened value ${id} must have a registry descriptor`);
  }
});
