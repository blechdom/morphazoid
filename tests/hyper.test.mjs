import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildHyperPyramid,
  buildHypersphere,
  buildKleinBottle,
  buildHyperShape,
  buildTesseract,
  hyperplaneIntersections,
  projectPoint4,
  transformedHyperShape,
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

test("Hyper exposes finite hypersphere, hyperpyramid, and Klein wireframes", () => {
  const shapes = {
    hypersphere: buildHypersphere(),
    hyperpyramid: buildHyperPyramid(),
    klein: buildKleinBottle(),
  };
  for (const [type, shape] of Object.entries(shapes)) {
    assert.ok(shape.vertices.length >= 5, `${type} needs vertices`);
    assert.ok(shape.edges.length >= shape.vertices.length, `${type} needs a connected wireframe`);
    assert.ok(shape.vertices.every((point) => (
      [point.x, point.y, point.z, point.w].every(Number.isFinite)
    )));
    assert.ok(shape.edges.every((edge) => (
      edge.a >= 0 && edge.a < shape.vertices.length
      && edge.b >= 0 && edge.b < shape.vertices.length
    )));
    assert.deepEqual(buildHyperShape(type), shape);
  }
  assert.ok(shapes.hypersphere.vertices.length <= 108);
  assert.ok(shapes.hypersphere.edges.length <= 288);
  assert.ok(shapes.klein.vertices.length <= 96);
  assert.ok(shapes.klein.edges.length <= 192);
});

test("4D form stretch changes geometry before rotation", () => {
  const native = transformedHyperShape("tesseract", {});
  const stretched = transformedHyperShape("tesseract", {}, { x: 1.5, y: 0.5, z: 1, w: 1.25 });
  assert.equal(stretched.edges.length, native.edges.length);
  assert.notDeepEqual(stretched.vertices, native.vertices);
  assert.ok(Math.max(...stretched.vertices.map(({ x }) => Math.abs(x)))
    > Math.max(...native.vertices.map(({ x }) => Math.abs(x))));
});

test("Hyper exposes independent axis motion and maps canvas drag to XW/YW", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../hyper.html", import.meta.url), "utf8"),
    readFile(new URL("../hyper-app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="rotationSummary">paused</);
  for (const axis of ["XW", "YW", "ZW"]) {
    assert.match(html, new RegExp(`id="rotation${axis}Play"`));
    assert.match(html, new RegExp(`id="rotation${axis}Speed"`));
  }
  assert.doesNotMatch(html, /id="manualRotation"|id="autoRotation"|id="rotationSpeed"/);
  assert.match(html, /id="canvasInstructions"/);
  assert.match(html, /id="hyperShape"/);
  assert.match(html, /Hypersphere/);
  assert.match(html, /Hyperpyramid/);
  assert.match(html, /Klein bottle/);
  assert.match(html, /id="hyperScaleW"/);
  assert.match(html, /<option value="sine" selected>/);
  assert.match(app, /soundMode: "sine"/);
  assert.match(app, /const moving = state\.playing \|\| rotationIsMoving\(\)/);
  assert.match(app, /else pool\.setVoices\(\[\]\)/);
  assert.match(app, /transformedHyperShape\(state\.shapeType, nextRotation, hyperForm\(\)\)/);
  assert.match(app, /MAX_HYPER_VOICES = 20/);
  assert.match(app, /evenlySelect\(contacts, MAX_HYPER_VOICES\)/);
  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /state\.rotationYW = normalizeDegrees/);
  assert.match(app, /state\.rotationXW = normalizeDegrees/);
  assert.doesNotMatch(app, /state\.rotationZW = normalizeDegrees\(canvasDrag/);
});
