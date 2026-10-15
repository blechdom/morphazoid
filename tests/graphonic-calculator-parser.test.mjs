import test from "node:test";
import assert from "node:assert/strict";
import {
  CompileError, ParseError, compile, createEnvironment, describeNode, factorial, formatNumber, parse, realPower, tokenize, variableNames,
} from "../src/instruments/graphonic-calculator/parser.js";

const evaluate = (text, scope = {}, options = {}) => compile(parse(text), createEnvironment(options))(scope);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("tokenizer splits letter runs into known words and single-letter variables", () => {
  assert.deepEqual(tokenize("2xsin(x)").map((t) => [t.type, t.value]), [
    ["number", 2], ["name", "x"], ["function", "sin"], ["op", "("], ["name", "x"], ["op", ")"], ["end", null],
  ]);
  assert.deepEqual(tokenize("sinx").map((t) => t.type), ["function", "name", "end"]);
  assert.deepEqual(tokenize("pie").map((t) => [t.type, t.value]), [["constant", "pi"], ["constant", "e"], ["end", null]]);
  assert.deepEqual(tokenize("a_1 + b_{12}").map((t) => t.value).slice(0, 3), ["a_1", "+", "b_12"]);
  assert.deepEqual(tokenize("arcsin θ ≤ τ").map((t) => t.value), ["asin", "θ", "<=", "tau", null]);
  assert.deepEqual(tokenize("3·x × y ÷ 2 − 1").map((t) => t.value), [3, "*", "x", "*", "y", "/", 2, "-", 1, null]);
  assert.throws(() => tokenize("1.2.3"), ParseError);
  assert.throws(() => tokenize("x # y"), ParseError);
});

test("operator precedence follows standard text-calculator conventions", () => {
  close(evaluate("1 + 2 * 3"), 7);
  close(evaluate("2 ^ 3 ^ 2"), 512);
  close(evaluate("-2 ^ 2"), -4);
  close(evaluate("2 ^ -1"), 0.5);
  close(evaluate("1 / 2x", { x: 4 }), 2);
  close(evaluate("2x^2", { x: 3 }), 18);
  close(evaluate("(1 + 2)(3 + 4)"), 21);
  close(evaluate("3!"), 6);
  close(evaluate("2 3"), 6);
  close(evaluate("10 - 2 - 3"), 5);
  close(evaluate("8 / 2 / 2"), 2);
});

test("implicit multiplication and bare function application read like Desmos input", () => {
  close(evaluate("2x", { x: 5 }), 10);
  close(evaluate("xy", { x: 2, y: 7 }), 14);
  close(evaluate("x(x + 1)", { x: 3 }), 12);
  close(evaluate("sin x", { x: Math.PI / 2 }), 1);
  close(evaluate("sin 2x", { x: Math.PI / 4 }), 1);
  close(evaluate("sin x cos x", { x: Math.PI / 4 }), 0.5);
  close(evaluate("sin x^2", { x: Math.sqrt(Math.PI / 2) }), 1);
  close(evaluate("sin^2 x + cos^2 x", { x: 0.7 }), 1);
  close(evaluate("sin 2x + 1", { x: Math.PI / 4 }), 2);
  close(evaluate("e^x", { x: 2 }), Math.E ** 2);
  close(evaluate("2π"), Math.PI * 2);
  close(evaluate("|x|", { x: -3 }), 3);
  close(evaluate("2|x| + 1", { x: -3 }), 7);
  close(evaluate("|x - 1| + |y|", { x: -1, y: -4 }), 6);
  assert.throws(() => parse("sin"), /needs an argument/);
});

test("builtin functions, constants and degree mode", () => {
  close(evaluate("sqrt(16) + cbrt(27) + abs(-2)"), 9);
  close(evaluate("floor(2.7) + ceil(2.1) + round(2.5) + sign(-3)"), 7);
  close(evaluate("min(3, 1, 2) + max(3, 1, 2)"), 4);
  close(evaluate("mod(-1, 3)"), 2);
  close(evaluate("ln(e) + log(100)"), 3);
  close(evaluate("exp(0) + tanh(0) + sinh(0) + cosh(0)"), 2);
  close(evaluate("sin(90)", {}, { angle: "degrees" }), 1);
  close(evaluate("asin(1)", {}, { angle: "degrees" }), 90);
  close(evaluate("cos(180) + tan(45)", {}, { angle: "degrees" }), 0);
  close(evaluate("sec(0) + csc(pi/2) + cot(pi/4)"), 3);
  close(evaluate("3.5!"), factorial(3.5));
  close(factorial(5), 120);
  close(factorial(0.5) ** 2, Math.PI / 4, 1e-9);
  assert.ok(Number.isNaN(factorial(-2)));
  assert.throws(() => compile(parse("sqrt(1, 2)")), CompileError);
  assert.throws(() => compile(parse("mod(1)")), CompileError);
});

test("odd roots of negatives stay real while even roots do not", () => {
  close(evaluate("x^(1/3)", { x: -8 }), -2);
  close(evaluate("x^(2/3)", { x: -8 }), 4);
  assert.ok(Number.isNaN(evaluate("x^(1/2)", { x: -4 })));
  close(realPower(-32, 0.2), -2);
  close(realPower(4, 0.5), 2);
  assert.ok(Number.isNaN(realPower(-2, Math.PI)));
});

test("user functions and parameters compile through the environment", () => {
  const functions = new Map([
    ["f", { params: ["x"], body: parse("x^2 + a") }],
    ["g", { params: ["u", "v"], body: parse("f(u) - v") }],
  ]);
  const env = createEnvironment({ functions });
  close(compile(parse("f(3)"), env)({ a: 1 }), 10);
  close(compile(parse("g(2, 1) + x"), env)({ a: 1, x: 5 }), 9);
  close(compile(parse("2f(x)"), env)({ a: 0, x: 3 }), 18);
  close(compile(parse("a(x + 1)"), env)({ a: 2, x: 3 }), 8);
  assert.throws(() => compile(parse("f(1, 2)"), env), /takes 1 argument/);
  assert.throws(() => compile(parse("h(1, 2)"), env), /not a defined function/);
  const recursive = createEnvironment({ functions: new Map([["f", { params: ["x"], body: parse("f(x) + 1") }]]) });
  assert.throws(() => compile(parse("f(2)"), recursive), /in terms of itself/);
  assert.ok(Number.isNaN(compile(parse("q + 1"), env)({})));
});

test("relations, tuples and variable inventory are exposed for classification", () => {
  const relation = parse("x^2 + y^2 = r^2");
  assert.equal(relation.type, "relation");
  assert.equal(relation.op, "=");
  assert.deepEqual([...variableNames(relation)].sort(), ["r", "x", "y"]);
  assert.deepEqual([...variableNames(parse("f(x) + a_1 sin(t)"))].sort(), ["a_1", "f", "t", "x"]);
  const point = parse("(cos t, sin t)");
  assert.equal(point.type, "tuple");
  assert.equal(point.items.length, 2);
  assert.equal(parse("y <= 2x").op, "<=");
  assert.throws(() => parse("0 < x < 1"), /Only one comparison/);
  assert.throws(() => parse("(1, 2, 3)"), /two coordinates/);
  assert.throws(() => compile(parse("(1, 2) + 1")), CompileError);
  assert.throws(() => compile(parse("x = 1")), CompileError);
});

test("syntax errors carry positions and readable messages", () => {
  for (const [text, pattern] of [
    ["2 +", /ends too early/],
    ["(2 + 3", /Missing “\)”/],
    ["2 + 3)", /Unmatched/],
    ["|x", /closing/],
    ["()", /Empty/],
    ["2 * * 3", /Unexpected/],
  ]) {
    assert.throws(() => parse(text), (error) => error instanceof ParseError && pattern.test(error.message) && Number.isInteger(error.position), text);
  }
});

test("descriptions and number formatting are compact", () => {
  assert.equal(describeNode(parse("2x^2 + sin(x)")), "2x^2 + sin(x)");
  assert.equal(describeNode(parse("(a, b)")), "(a, b)");
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatNumber(1234567.891), "1234570");
  assert.equal(formatNumber(1e-9), "1e-9");
  assert.equal(formatNumber(2e12), "2e+12");
  assert.equal(formatNumber(NaN), "undefined");
  assert.equal(formatNumber(-Infinity), "-∞");
  assert.equal(formatNumber(0), "0");
});
