import assert from "node:assert/strict";
import test from "node:test";

import { EdgeShape } from "../vendor/tactile/tactile.js";
import {
  TILING_TYPES,
  buildLattice,
  buildPrototile,
  centeredContactWindow,
  constrainPrototileEdit,
  contactsForLine,
  createScanLine,
  edgeCurve,
  evenlySelectContacts,
  intersectionAmplitudeEnvelope,
  latticeOffsetForPhase,
  parametersForDraggedVertex,
  prototileIsNonOverlapping,
  tilingInfo,
  tilingParameterRange,
} from "../src/lattice.js";

const bounds = { minX: -1.5, minY: -1, maxX: 1.5, maxY: 1 };

test("the complete Tactile isohedral catalog is exposed with control metadata", () => {
  assert.equal(TILING_TYPES.length, 72);
  assert.equal(new Set(TILING_TYPES.map((info) => info.type)).size, 72);
  assert.equal(TILING_TYPES[0].code, "IH01");
  assert.equal(TILING_TYPES.at(-1).code, "IH81");
  assert.equal(Math.max(...TILING_TYPES.map((info) => info.defaultParameters.length)), 6);
  assert.equal(Math.max(...TILING_TYPES.map((info) => info.edgeShapes.length)), 5);
  assert.equal(tilingInfo(20).label, "Pentagon \u00b7 IH20");
  assert.ok(TILING_TYPES.some((info) => info.edgeShapes.includes(EdgeShape.I)));
});

test("prototile editing stops before edges can overlap", () => {
  assert.ok(TILING_TYPES.every(({ type }) => prototileIsNonOverlapping({ type })));
  const info = tilingInfo(22);
  const straight = info.edgeShapes.map(() => 0);
  const extreme = info.edgeShapes.map(() => 1);
  assert.equal(prototileIsNonOverlapping({ type: 22, edgeCurves: extreme }), false);
  const guarded = constrainPrototileEdit({
    type: 22,
    currentParameters: info.defaultParameters,
    parameters: info.defaultParameters,
    currentEdgeCurves: straight,
    edgeCurves: extreme,
  });
  assert.equal(guarded.constrained, true);
  assert.ok(guarded.fraction < 1);
  assert.equal(prototileIsNonOverlapping({
    type: 22,
    parameters: guarded.parameters,
    edgeCurves: guarded.edgeCurves,
  }), true);
});

test("voice limiting keeps adjacent center contacts instead of widening dense chords", () => {
  const contacts = Array.from({ length: 11 }, (_, index) => ({
    along: index - 5,
    id: index,
  }));
  assert.deepEqual(centeredContactWindow(contacts, 3).map(({ id }) => id), [4, 5, 6]);
  assert.deepEqual(centeredContactWindow(contacts, 20).map(({ id }) => id), contacts.map(({ id }) => id));
});

test("curved isohedral edges retain exact endpoints and legal symmetry", () => {
  for (const shape of [EdgeShape.I, EdgeShape.J, EdgeShape.S, EdgeShape.U]) {
    const points = edgeCurve(shape, 0.7, 1, 16);
    assert.deepEqual(points[0], { x: 0, y: 0 });
    assert.deepEqual(points.at(-1), { x: 1, y: 0 });
    assert.equal(points.length, 17);
    assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  assert.ok(edgeCurve(EdgeShape.I, 1).every((point) => point.y === 0));
});

test("every family exposes a finite editable prototile", () => {
  for (const info of TILING_TYPES) {
    const model = buildPrototile({
      type: info.type,
      parameters: info.defaultParameters,
      edgeCurves: info.edgeShapes.map(() => 0.45),
    });
    assert.equal(model.vertices.length, info.sideCount);
    assert.equal(model.edges.length, info.sideCount);
    assert.ok(model.outline.length >= info.sideCount);
    assert.ok(model.outline.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.ok(model.bounds.maxX > model.bounds.minX);
    assert.ok(model.bounds.maxY > model.bounds.minY);
  }
});

test("corner dragging projects onto legal Tactile parameters", () => {
  const info = tilingInfo(20);
  const before = buildPrototile({ type: 20, parameters: info.defaultParameters });
  const vertexIndex = 1;
  const vertex = before.vertices[vertexIndex];
  const target = { x: vertex.x + 0.08, y: vertex.y + 0.05 };
  const parameters = parametersForDraggedVertex({
    type: 20,
    parameters: info.defaultParameters,
    vertexIndex,
    target,
  });
  assert.notDeepEqual(parameters, info.defaultParameters);
  parameters.forEach((value, index) => {
    const range = tilingParameterRange(20, index);
    assert.ok(value >= range.min && value <= range.max);
  });
  const after = buildPrototile({ type: 20, parameters });
  assert.ok(
    Math.hypot(after.vertices[vertexIndex].x - target.x, after.vertices[vertexIndex].y - target.y)
      < Math.hypot(vertex.x - target.x, vertex.y - target.y),
  );

  const fixedTarget = { x: before.vertices[0].x + 0.2, y: before.vertices[0].y + 0.2 };
  assert.deepEqual(parametersForDraggedVertex({
    type: 20,
    parameters: info.defaultParameters,
    vertexIndex: 0,
    target: fixedTarget,
  }), info.defaultParameters);
  assert.deepEqual(parametersForDraggedVertex({
    type: 69,
    parameters: [],
    vertexIndex: 0,
    target: { x: 2, y: 2 },
  }), []);
});

test("all 72 families build finite deduplicated edge fields", () => {
  for (const info of TILING_TYPES) {
    const lattice = buildLattice({
      type: info.type,
      parameters: info.defaultParameters,
      edgeCurves: info.edgeShapes.map(() => 0.2),
      scale: 0.3,
      bounds,
    });
    assert.ok(lattice.tiles.length > 5, `${info.code} should produce visible tiles`);
    assert.ok(lattice.edges.length > 10, `${info.code} should produce visible edges`);
    assert.equal(new Set(lattice.edges.map((edge) => edge.key)).size, lattice.edges.length);
    assert.ok(lattice.edges.every((edge) => edge.points.length === 13));
    assert.ok(Number.isFinite(lattice.period.x) && Number.isFinite(lattice.period.y));
    assert.ok(Math.hypot(lattice.period.x, lattice.period.y) > 0.01);
  }
});

test("native shape parameters and independent edge classes alter geometry", () => {
  const info = tilingInfo(20);
  const straight = buildLattice({
    type: 20,
    parameters: info.defaultParameters,
    edgeCurves: [0, 0, 0],
    scale: 0.3,
    bounds,
  });
  const parameters = [...info.defaultParameters];
  parameters[0] += 0.1;
  const reshaped = buildLattice({ type: 20, parameters, edgeCurves: [0, 0, 0], scale: 0.3, bounds });
  assert.notEqual(
    Math.hypot(straight.period.x, straight.period.y),
    Math.hypot(reshaped.period.x, reshaped.period.y),
  );

  const bent = buildLattice({
    type: 20,
    parameters: info.defaultParameters,
    edgeCurves: [0, 0.8, 0],
    scale: 0.3,
    bounds,
  });
  const straightEdge = straight.edges.find((edge) => edge.edgeShapeId === 1);
  const bentEdge = bent.edges.find((edge) => edge.key === straightEdge.key);
  assert.ok(bentEdge);
  assert.notDeepEqual(bentEdge.points[3], straightEdge.points[3]);
  assert.ok(straight.edges.filter((edge) => edge.edgeShapeId !== 1).some((edge) => {
    const peer = bent.edges.find((candidate) => candidate.key === edge.key);
    return peer && peer.points.every((point, index) => (
      Math.hypot(point.x - edge.points[index].x, point.y - edge.points[index].y) < 1e-9
    ));
  }));
});

test("the default line is vertical and remains centered for every pattern phase", () => {
  const scan = createScanLine(bounds);
  assert.equal(scan.angleDegrees, 90);
  assert.ok(Math.abs(scan.origin.x - scan.center.x) < 1e-12);
  assert.ok(Math.abs(scan.origin.y - scan.center.y) < 1e-12);

  const lattice = buildLattice({ type: 20, scale: 0.26, bounds, alignPeriodToDegrees: 180 });
  const firstOffset = latticeOffsetForPhase(lattice, 0);
  const lastOffset = latticeOffsetForPhase(lattice, 1);
  assert.deepEqual(firstOffset, { x: 0, y: 0 });
  assert.ok(Math.hypot(lastOffset.x, lastOffset.y) > 0.1);
  assert.equal(scan.position, 0.5);
});

test("pattern bearing rotates independently from the reader line", () => {
  const horizontal = buildLattice({
    type: 20,
    scale: 0.26,
    bounds,
    alignPeriodToDegrees: 180,
  });
  const diagonal = buildLattice({
    type: 20,
    scale: 0.26,
    bounds,
    alignPeriodToDegrees: 225,
  });
  const vertical = buildLattice({
    type: 20,
    scale: 0.26,
    bounds,
    alignPeriodToDegrees: 270,
  });
  assert.ok(horizontal.period.x < -0.1);
  assert.ok(Math.abs(horizontal.period.y) < 1e-9);
  assert.ok(diagonal.period.x < -0.1 && diagonal.period.y < -0.1);
  assert.ok(Math.abs(vertical.period.x) < 1e-9);
  assert.ok(vertical.period.y < -0.1);
  assert.equal(createScanLine(bounds, 0.5, 37).angleDegrees, 37);
});

test("one lattice translation closes the visual and audio contact loop exactly", () => {
  for (const type of [1, 20, 39, 69]) {
    const lattice = buildLattice({ type, curve: 0.42, scale: 0.26, bounds, alignPeriodToDegrees: 180 });
    const scan = createScanLine(bounds, 0.5, 90);
    const first = contactsForLine(lattice, scan, undefined, latticeOffsetForPhase(lattice, 0));
    const last = contactsForLine(lattice, scan, undefined, latticeOffsetForPhase(lattice, 1));
    assert.ok(first.length > 4);
    assert.equal(last.length, first.length, `IH${type} contact count should close`);
    assert.deepEqual(last.map((contact) => contact.voiceKey), first.map((contact) => contact.voiceKey));
    first.forEach((contact, index) => {
      assert.ok(Math.hypot(contact.x - last[index].x, contact.y - last[index].y) < 1e-8);
      assert.ok(Math.abs(contact.incidence - last[index].incidence) < 1e-8);
      assert.ok(Math.abs(contact.orientation - last[index].orientation) < 1e-8);
    });
  }
});

test("an arbitrary-angle line returns ordered, merged contacts", () => {
  const lattice = buildLattice({ type: 20, curve: 0.42, scale: 0.26, bounds, alignPeriodToDegrees: 180 });
  const scan = createScanLine(bounds, 0.5, 37);
  const contacts = contactsForLine(lattice, scan, undefined, latticeOffsetForPhase(lattice, 0.37));
  assert.ok(contacts.length > 4);
  assert.ok(contacts.every((contact) => Number.isFinite(contact.x)));
  assert.ok(contacts.every((contact) => contact.incidence >= 0 && contact.incidence <= 1));
  assert.ok(contacts.every((contact) => contact.orientation >= 0 && contact.orientation <= 1));
  for (let index = 1; index < contacts.length; index += 1) {
    assert.ok(contacts[index - 1].along <= contacts[index].along);
    assert.ok(Math.hypot(
      contacts[index - 1].x - contacts[index].x,
      contacts[index - 1].y - contacts[index].y,
    ) > lattice.scale * 0.01);
  }

  const vertical = contactsForLine(
    lattice,
    createScanLine(bounds, 0.5, 90),
    undefined,
    latticeOffsetForPhase(lattice, 0.37),
  );
  assert.notDeepEqual(
    contacts.map((contact) => contact.voiceKey),
    vertical.map((contact) => contact.voiceKey),
    "rotating the line must change its intersections without rotating the lattice",
  );
});

test("dense contacts are sampled spatially and intersection amplitude decays to silence", () => {
  const contacts = Array.from({ length: 21 }, (_, index) => ({ index }));
  assert.deepEqual(
    evenlySelectContacts(contacts, 5).map((contact) => contact.index),
    [0, 5, 10, 15, 20],
  );
  assert.deepEqual(evenlySelectContacts(contacts, 1), [{ index: 10 }]);
  assert.deepEqual(evenlySelectContacts(contacts, 0), []);

  const onset = intersectionAmplitudeEnvelope(0, 0.65, 0.2);
  const tail = intersectionAmplitudeEnvelope(0.1, 0.65, 0.2);
  assert.ok(onset > tail);
  assert.ok(tail > 0);
  assert.ok(
    intersectionAmplitudeEnvelope(0.19, 0.65, 0.2)
      > intersectionAmplitudeEnvelope(0.199, 0.65, 0.2),
    "the final approach to silence must keep tapering",
  );
  assert.ok(intersectionAmplitudeEnvelope(0.199, 0.65, 0.2) < onset * 0.001);
  assert.equal(intersectionAmplitudeEnvelope(0.2, 0.65, 0.2), 0);
  assert.equal(intersectionAmplitudeEnvelope(1, 0.65, 0.2), 0);
  assert.equal(intersectionAmplitudeEnvelope(0, 0), 1);
  assert.ok(
    intersectionAmplitudeEnvelope(0.1, 0.75, 0.2)
      > intersectionAmplitudeEnvelope(0.1, 0.75, 0.05),
    "longer decay must retain oscillator amplitude",
  );
});
