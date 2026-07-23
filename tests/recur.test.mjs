import assert from "node:assert/strict";
import test from "node:test";

import {
  RECUR_PROGRAMS,
  buildRecurTimeline,
  programById,
  stackDepthProfile,
} from "../src/recur.js";

const EXPECTED_IDS = ["factorial", "countdown", "sum", "hanoi", "fibonacci"];

function isUnimodal(values) {
  const peak = values.indexOf(Math.max(...values));
  for (let index = 1; index <= peak; index += 1) {
    if (values[index] < values[index - 1]) return false;
  }
  for (let index = peak + 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) return false;
  }
  return true;
}

test("program registry exposes stable ids and clamped ranges", () => {
  assert.deepEqual(RECUR_PROGRAMS.map((program) => program.id), EXPECTED_IDS);
  for (const program of RECUR_PROGRAMS) {
    assert.ok(program.label && program.blurb);
    assert.ok(["linear", "tree"].includes(program.kind));
    assert.ok(program.nMin <= program.nDefault && program.nDefault <= program.nMax);
    assert.equal(typeof program.supportsMemo, "boolean");
  }
  assert.equal(programById("hanoi").kind, "tree");
  assert.equal(programById("nope"), null);
});

test("timelines are deterministic and bounded", () => {
  for (const program of RECUR_PROGRAMS) {
    const first = buildRecurTimeline(program.id, program.nDefault, { stepSeconds: 0.5 });
    const second = buildRecurTimeline(program.id, program.nDefault, { stepSeconds: 0.5 });
    assert.deepEqual(first, second);
    assert.ok(first.events.length > 0);
    assert.equal(first.duration, first.events.length * 0.5);
    assert.equal(first.frameCount, first.events.filter((event) => event.type === "call").length);
    // Every call is matched by exactly one return sharing its frameId.
    const calls = first.events.filter((event) => event.type === "call").map((event) => event.frameId);
    const returns = first.events.filter((event) => event.type === "return").map((event) => event.frameId);
    assert.deepEqual([...calls].sort(), [...returns].sort());
  }
  assert.throws(() => buildRecurTimeline("not-a-program", 3), RangeError);
});

test("n is clamped to the program range", () => {
  const clampedHigh = buildRecurTimeline("hanoi", 999);
  assert.equal(clampedHigh.n, 10);
  const clampedLow = buildRecurTimeline("factorial", -4);
  assert.equal(clampedLow.n, 1);
});

test("factorial(4) descends to one base case and unwinds LIFO", () => {
  const timeline = buildRecurTimeline("factorial", 4, { stepSeconds: 1 });
  assert.equal(timeline.events.length, 9);
  assert.deepEqual(
    timeline.events.map((event) => event.type),
    ["call", "call", "call", "call", "base", "return", "return", "return", "return"],
  );
  assert.equal(timeline.maxDepth, 3);
  const returns = timeline.events.filter((event) => event.type === "return");
  assert.deepEqual(returns.map((event) => event.depth), [3, 2, 1, 0]);
  assert.deepEqual(returns.map((event) => event.value), [1, 2, 6, 24]);
  assert.deepEqual(timeline.events.map((event) => event.tStart), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("hanoi(3) produces the ruler sequence with a full call tree", () => {
  const timeline = buildRecurTimeline("hanoi", 3);
  const moves = timeline.events.filter((event) => event.type === "base");
  assert.equal(moves.length, 7);
  assert.deepEqual(moves.map((event) => event.value), [1, 2, 1, 3, 1, 2, 1]);
  assert.equal(timeline.events.filter((event) => event.type === "call").length, 15);
  assert.equal(timeline.events.filter((event) => event.type === "return").length, 15);
});

test("naive fibonacci recomputes; memoize removes the redundancy", () => {
  const naive = buildRecurTimeline("fibonacci", 5);
  assert.equal(naive.events.filter((event) => event.type === "call").length, 15);
  assert.equal(naive.events.filter((event) => event.type === "base").length, 8);
  assert.ok(naive.events.every((event) => event.memoHit === false));

  const memoized = buildRecurTimeline("fibonacci", 5, { memoize: true });
  const freshCalls = memoized.events.filter((event) => event.type === "call" && !event.memoHit);
  assert.equal(freshCalls.length, 6);
  assert.ok(memoized.events.some((event) => event.memoHit === true));
  assert.ok(memoized.events.length < naive.events.length);
  // Both compute fib(5) = 5.
  assert.equal(naive.events.at(-1).value, 5);
  assert.equal(memoized.events.at(-1).value, 5);
});

test("stackDepthProfile is normalized and unimodal for linear programs", () => {
  const timeline = buildRecurTimeline("factorial", 6);
  const profile = stackDepthProfile(timeline);
  assert.equal(profile.length, timeline.events.length);
  assert.ok(profile.every((value) => value >= 0 && value <= 1));
  assert.equal(Math.max(...profile), 1);
  assert.ok(isUnimodal(profile));
});
