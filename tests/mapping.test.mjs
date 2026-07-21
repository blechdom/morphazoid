import assert from "node:assert/strict";
import test from "node:test";

import {
  MAPPING_CURVE_MIN_GAP,
  MAPPING_CURVE_PRESETS,
  evaluateMappingCurve,
  mappingCurvePreset,
  sanitizeMappingCurve,
  updateMappingCurveNode,
} from "../src/mapping.js";

const PRESET_NAMES = ["linear", "exponential", "logarithmic", "smooth", "inverted"];

test("mapping curve presets contain five normalized, ordered nodes", () => {
  assert.deepEqual(Object.keys(MAPPING_CURVE_PRESETS), PRESET_NAMES);

  for (const name of PRESET_NAMES) {
    const nodes = MAPPING_CURVE_PRESETS[name];
    assert.equal(nodes.length, 5);
    assert.deepEqual(nodes.map(({ x }) => x), [0, 0.25, 0.5, 0.75, 1]);
    assert.ok(nodes.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
    assert.ok(Object.isFrozen(nodes));
    assert.ok(nodes.every(Object.isFrozen));
  }

  assert.ok(MAPPING_CURVE_PRESETS.exponential[1].y < 0.25);
  assert.ok(MAPPING_CURVE_PRESETS.logarithmic[1].y > 0.25);
  assert.deepEqual(MAPPING_CURVE_PRESETS.inverted.map(({ y }) => y), [1, 0.75, 0.5, 0.25, 0]);
});

test("mappingCurvePreset returns independent editable copies and a linear fallback", () => {
  const first = mappingCurvePreset("smooth");
  const second = mappingCurvePreset("SMOOTH");
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);

  first[0].y = 0.75;
  assert.equal(second[0].y, 0);
  assert.equal(MAPPING_CURVE_PRESETS.smooth[0].y, 0);
  assert.deepEqual(mappingCurvePreset("unknown"), mappingCurvePreset("linear"));
});

test("sanitizeMappingCurve clones nodes and clamps normalized values", () => {
  const source = [
    { x: 0.4, y: -1 },
    { x: 0.7, y: 0.2 },
    { x: 0.6, y: 2 },
    { x: Number.NaN, y: Number.NaN },
    { x: 0.8, y: 0.4 },
  ];
  const sanitized = sanitizeMappingCurve(source);

  assert.notEqual(sanitized, source);
  assert.ok(sanitized.every((node, index) => node !== source[index]));
  assert.deepEqual(sanitized, [
    { x: 0, y: 0 },
    { x: 0.7, y: 0.2 },
    { x: 0.71, y: 1 },
    { x: 0.75, y: 0.75 },
    { x: 1, y: 0.4 },
  ]);
  assert.deepEqual(source[0], { x: 0.4, y: -1 });
});

test("sanitizeMappingCurve supplies safe defaults for malformed curves and nodes", () => {
  assert.deepEqual(sanitizeMappingCurve(null), mappingCurvePreset("linear"));
  assert.deepEqual(sanitizeMappingCurve([{ x: 0.5, y: 0.5 }]), mappingCurvePreset("linear"));
  assert.deepEqual(sanitizeMappingCurve([null, {}, null]), [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ]);
});

test("updateMappingCurveNode clamps interior coordinates between neighbours", () => {
  const source = mappingCurvePreset("linear");
  const left = updateMappingCurveNode(source, 2, { x: -1, y: 2 });
  assert.equal(left[2].x, left[1].x + MAPPING_CURVE_MIN_GAP);
  assert.equal(left[2].y, 1);

  const right = updateMappingCurveNode(source, 2, { x: 2, y: -1 });
  assert.equal(right[2].x, right[3].x - MAPPING_CURVE_MIN_GAP);
  assert.equal(right[2].y, 0);
  assert.deepEqual(source, mappingCurvePreset("linear"));
});

test("updateMappingCurveNode fixes endpoint X while allowing endpoint Y", () => {
  const source = mappingCurvePreset("linear");
  const start = updateMappingCurveNode(source, 0, { x: 0.8, y: 0.6 });
  const end = updateMappingCurveNode(source, 4, { x: 0.2, y: 0.3 });

  assert.deepEqual(start[0], { x: 0, y: 0.6 });
  assert.deepEqual(end[4], { x: 1, y: 0.3 });
});

test("invalid and non-finite updates return a fresh sanitized curve", () => {
  const source = mappingCurvePreset("linear");
  const invalidIndex = updateMappingCurveNode(source, 12, { x: 0, y: 1 });
  const invalidValues = updateMappingCurveNode(source, 2, { x: Number.NaN, y: Infinity });

  assert.deepEqual(invalidIndex, source);
  assert.deepEqual(invalidValues, source);
  assert.notEqual(invalidIndex, source);
  assert.ok(invalidIndex.every((node, index) => node !== source[index]));
});

test("evaluateMappingCurve clamps input and interpolates each segment", () => {
  const nodes = [
    { x: 0, y: 0.2 },
    { x: 0.2, y: 0.8 },
    { x: 1, y: 0.4 },
  ];

  assert.equal(evaluateMappingCurve(-1, nodes), 0.2);
  assert.equal(evaluateMappingCurve(Number.NaN, nodes), 0.2);
  assert.ok(Math.abs(evaluateMappingCurve(0.1, nodes) - 0.5) < 1e-12);
  assert.ok(Math.abs(evaluateMappingCurve(0.6, nodes) - 0.6) < 1e-12);
  assert.equal(evaluateMappingCurve(2, nodes), 0.4);
});

test("preset evaluations express their intended normalized response", () => {
  assert.equal(evaluateMappingCurve(0.375, mappingCurvePreset("linear")), 0.375);
  assert.ok(evaluateMappingCurve(0.25, mappingCurvePreset("exponential")) < 0.25);
  assert.ok(evaluateMappingCurve(0.25, mappingCurvePreset("logarithmic")) > 0.25);
  assert.equal(evaluateMappingCurve(0.5, mappingCurvePreset("smooth")), 0.5);
  assert.equal(evaluateMappingCurve(0.25, mappingCurvePreset("inverted")), 0.75);
});
