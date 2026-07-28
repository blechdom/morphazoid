import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildHyperPyramid,
  buildHypersphere,
  buildKleinBottle,
  buildHyperShape,
  buildTesseract,
  crossedHyperplaneLoop,
  crossedHyperplaneVertex,
  hyperplaneIntersections,
  hyperplaneOffsetForShapePhase,
  hyperplaneWRange,
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

test("rotated Hyper loop phases span only the occupied W range and wrap at the shape", () => {
  const scenarios = [
    [{}, {}],
    [
      { xw: 90, yw: 37, zw: -61, xy: 16, yz: -9 },
      { x: 1.6, y: 0.4, z: 1.3, w: 0.55 },
    ],
    [
      { xw: 67, yw: -41, zw: 29, xy: 16, yz: -9 },
      { x: 1.3, y: 0.7, z: 1.5, w: 0.6 },
    ],
  ];
  for (const type of ["tesseract", "hyperpyramid", "hypersphere", "klein"]) {
    for (const [rotation, form] of scenarios) {
      const shape = transformedHyperShape(type, rotation, form);
      const { minW, maxW, span } = hyperplaneWRange(shape);
      assert.equal(minW, Math.min(...shape.vertices.map(({ w }) => w)));
      assert.equal(maxW, Math.max(...shape.vertices.map(({ w }) => w)));
      assert.equal(span, maxW - minW);
      assert.equal(hyperplaneOffsetForShapePhase(shape, 0), minW);
      assert.equal(hyperplaneOffsetForShapePhase(shape, 1), minW);
      assert.equal(hyperplaneOffsetForShapePhase(shape, -1), minW);
      assert.equal(
        hyperplaneOffsetForShapePhase(shape, 0.5),
        minW + (maxW - minW) * 0.5,
      );
      for (let step = 0; step < 32; step += 1) {
        const offset = hyperplaneOffsetForShapePhase(shape, step / 32);
        assert.ok(offset >= minW && offset <= maxW);
        assert.ok(
          hyperplaneIntersections(shape, offset).length > 0,
          `${type} phase ${step}/32 should stay on the shape`,
        );
      }
    }
  }
  assert.deepEqual(hyperplaneWRange({ vertices: [] }), { minW: 0, maxW: 0, span: 0 });
  assert.equal(hyperplaneOffsetForShapePhase({ vertices: [] }, 0.75), 0);
  assert.equal(crossedHyperplaneLoop(0.999, 1.001), true);
  assert.equal(crossedHyperplaneLoop(0.001, -0.001), true);
  assert.equal(crossedHyperplaneLoop(1.1, 1.9), false);
  assert.equal(crossedHyperplaneLoop(Number.NaN, 1), false);
  assert.equal(crossedHyperplaneVertex(0.2, -0.2), true);
  assert.equal(crossedHyperplaneVertex(0.2, 0), false);
  assert.equal(crossedHyperplaneVertex(0, -0.2), true);
  assert.equal(crossedHyperplaneVertex(-0.2, -0.1), false);
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
  assert.match(app, /hyperplaneOffsetForShapePhase\(shape, phase\)/);
  assert.match(app, /crossedHyperplaneLoop/);
  assert.match(app, /state\.direction > 0 \? minW : maxW/);
  assert.doesNotMatch(app, /1\.25 \* state\.hyperScaleW/);
  assert.match(app, /MAX_HYPER_VOICES = 20/);
  assert.match(app, /evenlySelect\(contacts, MAX_HYPER_VOICES\)/);
  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /state\.rotationYW = normalizeDegrees/);
  assert.match(app, /state\.rotationXW = normalizeDegrees/);
  assert.doesNotMatch(app, /state\.rotationZW = normalizeDegrees\(canvasDrag/);
});
