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
});

test("Hyper defaults to manual rotation and maps canvas drag to XW/YW", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../hyper.html", import.meta.url), "utf8"),
    readFile(new URL("../hyper-app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="rotationSummary">manual</);
  assert.match(html, /id="manualRotation"[^>]*aria-pressed="true"/);
  assert.match(html, /id="autoRotation"[^>]*aria-pressed="false"/);
  assert.match(html, /id="canvasInstructions"/);
  assert.match(html, /id="hyperShape"/);
  assert.match(html, /Hypersphere/);
  assert.match(html, /Hyperpyramid/);
  assert.match(html, /Klein bottle/);
  assert.match(app, /autoRotate: false/);
  assert.match(app, /transformedHyperShape\(state\.shapeType/);
  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /state\.rotationYW = normalizeDegrees/);
  assert.match(app, /state\.rotationXW = normalizeDegrees/);
  assert.doesNotMatch(app, /state\.rotationZW = normalizeDegrees\(canvasDrag/);
});
