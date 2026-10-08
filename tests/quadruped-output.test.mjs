import test from "node:test";
import assert from "node:assert/strict";
import {
  QUADRUPED_OUTPUT_CEILING,
  guardQuadrupedSample,
  protectQuadrupedSample,
} from "../src/instruments/quadruped/quadruped-output.js";

test("Quadruped peak protection preserves quiet samples, polarity, and exact silence", () => {
  for (const sample of [-0.72, -0.5, -0.001, 0, 0.001, 0.5, 0.72]) {
    assert.equal(protectQuadrupedSample(sample), sample);
    assert.equal(guardQuadrupedSample(sample), sample);
  }
  for (const sample of [0.73, 0.84, 0.99, 2, 8, 100]) {
    assert.equal(protectQuadrupedSample(-sample), -protectQuadrupedSample(sample));
    assert.equal(guardQuadrupedSample(-sample), -guardQuadrupedSample(sample));
  }
});

test("protection curves stay finite, monotonic, and bounded through extreme inputs", () => {
  let previous = -Infinity;
  for (let index = 0; index <= 16000; index += 1) {
    const input = index / 1000 - 8;
    const output = guardQuadrupedSample(protectQuadrupedSample(input));
    assert.ok(Number.isFinite(output));
    assert.ok(output >= previous);
    assert.ok(Math.abs(output) <= QUADRUPED_OUTPUT_CEILING);
    assert.ok(Math.abs(guardQuadrupedSample(input)) <= QUADRUPED_OUTPUT_CEILING);
    previous = output;
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(protectQuadrupedSample(invalid), 0);
    assert.equal(guardQuadrupedSample(invalid), 0);
  }
});
