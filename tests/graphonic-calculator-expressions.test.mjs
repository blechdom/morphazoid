import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRows, formatParameterValue, parameterText } from "../src/instruments/graphonic-calculator/expressions.js";

const rows = (...texts) => texts.map((text, index) => ({ id: `r${index}`, text }));
const analyze = (texts, options) => analyzeRows(rows(...texts), options);
const only = (texts, options) => analyze(texts, options).rows.at(-1);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("explicit, implicit, polar and parametric rows are classified like Desmos input", () => {
  assert.equal(only([""]).kind, "empty");
  const y = only(["y = x^2"]); assert.equal(y.kind, "explicit-y"); close(y.plot.fn({ x: 3 }), 9);
  assert.equal(only(["x^2"]).kind, "explicit-y");
  assert.equal(only(["x = y^2"]).kind, "explicit-x");
  assert.equal(only(["y^2"]).kind, "explicit-x");
  assert.equal(only(["x = 3"]).kind, "explicit-x"); close(only(["x = 3"]).plot.fn({ y: 7 }), 3);
  assert.equal(only(["y = 2"]).kind, "explicit-y");
  const circle = only(["x^2 + y^2 = 4"]); assert.equal(circle.kind, "implicit"); close(circle.plot.fn({ x: 2, y: 0 }), 0); close(circle.plot.fn({ x: 0, y: 0 }), -4);
  assert.equal(only(["y^2 = x"]).kind, "explicit-x");
  assert.equal(only(["y^2 = x + y"]).kind, "implicit");
  assert.equal(only(["x^2 = y"]).kind, "explicit-y");
  const rose = only(["r = cos(3θ)"]); assert.equal(rose.kind, "polar"); close(rose.plot.fn({ "θ": 0 }), 1);
  assert.equal(only(["cos(3theta)"]).kind, "polar");
  close(only(["r = theta"]).plot.fn({ "θ": 2 }), 2);
  assert.match(only(["r = x"]).error, /r = f\(θ\)/);
  const param = only(["(cos t, sin t)"]); assert.equal(param.kind, "parametric"); close(param.plot.fx({ t: 0 }), 1); close(param.plot.fy({ t: Math.PI / 2 }), 1);
  assert.match(only(["x + y"]).error, /Add =/);
  assert.match(only(["θ + x"]).error, /θ/);
  const radius = only(["x^2 + y^2 = r^2"]); assert.equal(radius.kind, "error"); assert.match(radius.error, /polar radius/); assert.deepEqual(radius.missing, []);
  assert.match(only(["y = θ"]).error, /θ belongs/);
  assert.match(only(["r + 1"]).error, /polar radius/);
  assert.deepEqual(only(["x^2 + y^2 = R^2"]).missing, ["R"]);
  assert.match(only(["(x, 1)"]).error, /cannot depend/); assert.deepEqual(only(["(x, 1)"]).missing, []);
  assert.match(only(["a = x^2"]).error, /cannot depend/);
});

test("parameters become sliders, derived values and dependency-ordered scopes", () => {
  const { rows: result, scope } = analyze(["a = 2", "b = 2a", "c = d", "ax^2", "b x + c"]);
  assert.equal(result[0].kind, "parameter"); assert.equal(result[0].definition.slider, true); assert.equal(result[0].value, 2);
  assert.equal(result[1].kind, "parameter"); assert.equal(result[1].definition.slider, false); assert.equal(result[1].value, 4);
  assert.equal(result[2].kind, "parameter"); assert.deepEqual(result[2].missing, ["d"]); assert.match(result[2].error, /Undefined: d/);
  assert.equal(result[3].kind, "explicit-y"); close(result[3].plot.fn({ ...scope, x: 3 }), 18);
  assert.equal(result[4].kind, "explicit-y");
  assert.deepEqual(only(["ax^2 + k"]).missing, ["a", "k"]);
  assert.equal(only(["a = -2"]).definition.slider, true); assert.equal(only(["a = -2"]).value, -2);
  assert.equal(only(["a = (3)"]).definition.slider, true);
  const ordered = analyze(["b = a + 1", "a = 1"]); assert.equal(ordered.rows[0].value, 2);
  const circular = analyze(["a = b", "b = a"]); assert.match(circular.rows[0].error, /Circular/); assert.match(circular.rows[1].error, /Circular/);
  const duplicate = analyze(["a = 1", "a = 2"]); assert.equal(duplicate.rows[0].value, 1); assert.match(duplicate.rows[1].error, /already defined/);
});

test("function definitions plot, compose and reject recursion", () => {
  const { rows: result, scope } = analyze(["a = 1", "f(x) = x^2 + a", "f(2)", "g(x, y) = x y", "g(2, 3)", "y = f(x) + 1", "h(x) = h(x - 1)"]);
  assert.equal(result[1].kind, "function"); assert.deepEqual(result[1].definition, { name: "f", params: ["x"] }); close(result[1].plot.fn({ ...scope, x: 3 }), 10);
  assert.equal(result[2].kind, "value"); assert.equal(result[2].value, 5);
  assert.equal(result[3].kind, "function"); assert.equal(result[3].plot, null);
  assert.equal(result[4].value, 6);
  close(result[5].plot.fn({ ...scope, x: 1 }), 3);
  assert.match(result[6].error, /in terms of itself/);
  assert.match(only(["f(x) = x + q"]).error, /Undefined: q/);
  assert.match(only(["f(x, x) = x"]).error, /distinct/);
  assert.match(only(["f(1)"]).error, /Undefined: f/);
});

test("points, draggable coordinates and inequalities", () => {
  const { rows: result } = analyze(["a = 1", "b = 2", "(1, 2)", "(a, b)", "(a, 2a)", "(a + 1, c)"]);
  assert.equal(result[2].kind, "point"); assert.deepEqual(result[2].point, [1, 2]); assert.deepEqual(result[2].plot.draggable, [null, null]);
  assert.deepEqual(result[3].point, [1, 2]); assert.deepEqual(result[3].plot.draggable, ["a", "b"]);
  assert.deepEqual(result[4].plot.draggable, ["a", null]);
  assert.deepEqual(result[5].missing, ["c"]);
  const below = only(["y < x^2"]); assert.equal(below.kind, "inequality"); assert.deepEqual([below.plot.axis, below.plot.direction, below.plot.strict], ["y", "less", true]);
  const flipped = only(["x^2 >= y"]); assert.deepEqual([flipped.plot.axis, flipped.plot.direction, flipped.plot.strict], ["y", "less", false]);
  const right = only(["x > y^2"]); assert.deepEqual([right.plot.axis, right.plot.direction, right.plot.strict], ["x", "greater", true]); close(right.plot.fn({ y: 3 }), 9);
  assert.match(only(["x^2 + y^2 < 1"]).error, /Shading supports/);
  assert.match(only(["0 < x < 1"]).error, /Only one comparison/);
});

test("values, degree mode, labels and parameter text formatting", () => {
  assert.equal(only(["2 + 2"]).value, 4);
  close(only(["sin(pi)"]).value, 0);
  close(only(["y = sin(x)"], { angle: "degrees" }).plot.fn({ x: 90 }), 1);
  assert.equal(only(["2x + 1"]).label, "2x + 1");
  const broken = only(["2 +"]); assert.equal(broken.kind, "error"); assert.match(broken.error, /ends too early/); assert.equal(broken.position, 3);
  assert.equal(parameterText("a", 2.5), "a = 2.5");
  assert.equal(formatParameterValue(1 / 3), "0.333333");
  assert.equal(formatParameterValue(NaN), "0");
  assert.equal(formatParameterValue(-0), "0");
});
