import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSolid,
  deformSolid,
  planeBasis,
  planeIntersections,
  planeNormal,
  projectPoint3,
  rotatePoint3,
} from "../src/solid.js";

test("wireframe solids expose finite vertices and connected segments", () => {
  const expected = {
    cube: 12, pyramid: 8, octahedron: 12, prism: 9,
    cone: 32, cylinder: 36, torus: 144,
  };
  for (const type of [
    "cube", "pyramid", "octahedron", "prism", "cone", "cylinder", "sphere", "torus",
  ]) {
    const solid = buildSolid(type);
    assert.ok(solid.vertices.length >= 5);
    assert.ok(solid.edges.length >= (expected[type] ?? 40));
    assert.ok(solid.vertices.every((point) => [point.x, point.y, point.z].every(Number.isFinite)));
    assert.ok(solid.edges.every(({ a, b }) => a >= 0 && b >= 0 && a < solid.vertices.length && b < solid.vertices.length));
  }
});

test("solid form controls stretch and skew every wireframe without changing topology", () => {
  const cube = buildSolid("cube");
  const deformed = deformSolid(cube, {
    scaleX: 1.5,
    scaleY: 0.75,
    scaleZ: 1.2,
    skewX: 0.4,
    skewZ: -0.3,
  });
  assert.equal(deformed.edges, cube.edges);
  assert.equal(deformed.vertices.length, cube.vertices.length);
  assert.notDeepEqual(deformed.vertices, cube.vertices);
  assert.ok(deformed.vertices.every((point) => [point.x, point.y, point.z].every(Number.isFinite)));
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

test("Solid defaults to Sine and silences continuous voices while stopped", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../solid.html", import.meta.url), "utf8"),
    readFile(new URL("../solid-app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<option value="sine" selected>/);
  assert.match(app, /soundMode: "sine"/);
  for (const axis of ["X", "Y", "Z"]) {
    assert.match(html, new RegExp(`id="rotation${axis}Play"`));
    assert.match(html, new RegExp(`id="rotation${axis}Speed"`));
  }
  for (const axis of ["planeYaw", "planePitch"]) {
    assert.match(html, new RegExp(`id="${axis}Play"`));
    assert.match(html, new RegExp(`id="${axis}Speed"`));
  }
  assert.doesNotMatch(html, /id="manualRotation"|id="autoRotation"|id="rotationSpeed"/);
  assert.match(html, /id="formScaleX"/);
  assert.match(html, /id="formSkewZ"/);
  assert.match(app, /const moving = motionIsActive\(\)/);
  assert.match(app, /else pool\.setVoices\(\[\]\)/);
});

test("Solid opens with a dimensional shape and a visibly broad surface", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../solid.html", import.meta.url), "utf8"),
    readFile(new URL("../solid-app.js", import.meta.url), "utf8"),
  ]);
  for (const [key, value] of [
    ["rotationX", -24], ["rotationY", 36], ["rotationZ", 8],
    ["planeYaw", 45], ["planePitch", -22],
  ]) {
    assert.match(app, new RegExp(`${key}: ${value}`));
    assert.match(html, new RegExp(`id="${key}"[^>]+value="${value}"`));
  }

  const normal = planeNormal(45, -22);
  const { u, v } = planeBasis(normal);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => projectPoint3({
    x: (u.x * a + v.x * b) * 1.18,
    y: (u.y * a + v.y * b) * 1.18,
    z: (u.z * a + v.z * b) * 1.18,
  }));
  const projectedArea = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % corners.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) * 0.5;
  assert.ok(projectedArea > 3.5);
});
