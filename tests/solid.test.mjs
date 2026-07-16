import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSolid,
  planeIntersections,
  planeNormal,
  rotatePoint3,
} from "../src/solid.js";

test("wireframe solids expose finite vertices and connected segments", () => {
  const expected = { cube: 12, pyramid: 8, cone: 32 };
  for (const type of ["cube", "pyramid", "cone", "sphere"]) {
    const solid = buildSolid(type);
    assert.ok(solid.vertices.length >= 5);
    assert.ok(solid.edges.length >= (expected[type] ?? 40));
    assert.ok(solid.vertices.every((point) => [point.x, point.y, point.z].every(Number.isFinite)));
    assert.ok(solid.edges.every(({ a, b }) => a >= 0 && b >= 0 && a < solid.vertices.length && b < solid.vertices.length));
  }
});

test("a plane reads segment intersections rather than solid volume", () => {
  const cube = buildSolid("cube");
  const contacts = planeIntersections(cube, planeNormal(0, 0), 0);
  assert.equal(contacts.length, 4);
  assert.ok(contacts.every((contact) => Math.abs(contact.x) < 1e-8));

  const rotated = { ...cube, vertices: cube.vertices.map((point) => rotatePoint3(point, { y: 45 })) };
  const rotatedContacts = planeIntersections(rotated, planeNormal(0, 18), 0.1);
  assert.ok(rotatedContacts.length >= 3);
  assert.ok(rotatedContacts.every((contact) => [contact.x, contact.y, contact.z].every(Number.isFinite)));
});
