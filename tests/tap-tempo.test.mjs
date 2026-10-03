import assert from "node:assert/strict";
import test from "node:test";
import { createTapTempoTracker, tapTempoBpm, tapTempoValue } from "../src/tap-tempo.js";

test("two taps establish tempo; the last four intervals average imperfect playing", () => {
  const tracker = createTapTempoTracker();
  assert.equal(tracker.tap(0), null);
  assert.equal(tracker.tap(500), 120);
  assert.equal(tracker.tap(1020), 60000 / 510);
  assert.equal(tracker.tap(1500), 120);
  tracker.tap(2020);
  assert.equal(tracker.tap(2540), 60000 / 510);
});

test("accidental duplicate contacts leave the beat intact", () => {
  const tracker = createTapTempoTracker();
  tracker.tap(0);
  assert.equal(tracker.tap(10), null);
  assert.equal(tracker.tap(500), 120);
  assert.equal(tracker.tap(510), null);
  assert.equal(tracker.tap(1000), 120);
  assert.equal(tracker.tap(NaN), null);
  assert.equal(tracker.tap(1500), 120);
});

test("a pause, reset, or backwards clock starts a fresh series without changing tempo", () => {
  const tracker = createTapTempoTracker();
  tracker.tap(0); tracker.tap(500);
  assert.equal(tracker.tap(8000), null);
  assert.equal(tracker.tap(9000), 60);
  tracker.reset();
  assert.equal(tracker.tap(9500), null);
  assert.equal(tracker.tap(500), null);
  assert.equal(tracker.tap(1000), 120);
});

test("slow-tempo owners can allow a complete long beat between taps", () => {
  const tracker = createTapTempoTracker();
  tracker.tap(0, 75000);
  assert.equal(tracker.tap(30000, 75000), 2);
});

for (const [name, mapping, bpm, expected] of [
  ["native BPM", { unit: "bpm" }, 120, 120],
  ["native cycles/sec", { unit: "hz" }, 120, 2],
  ["degrees/sec", { unit: "hz", scale: 360 }, 120, 720],
  ["duration seconds", { unit: "seconds" }, 120, .5],
  ["duration milliseconds", { unit: "milliseconds" }, 120, 500],
  ["Barber squared range", { unit: "powerHz", span: 5, exponent: 2 }, 75, .5],
  ["L-System cubic range", { unit: "powerHz", floor: .01, span: 3.99, exponent: 3 }, 30.525, .5],
  ["Chiptune normalized log range", { unit: "exponentialHz", floor: .25, factor: 16 }, 60, .5],
  ["Fractal normalized log range", { unit: "exponentialHz", floor: .0625, factor: 1024 }, 120, .5],
  ["Rubix independent action clock", { unit: "exponentialHz", floor: .25, factor: 48, inputScale: 100 }, 120, 100 * Math.log(8) / Math.log(48)],
  ["Julia lower linear half", { unit: "juliaHz" }, .54, -.5],
  ["Julia upper linear half", { unit: "juliaHz" }, 8.01, .5],
  ["tape normal playback", { unit: "multiplier", referenceBpm: 120 }, 60, .5],
  ["longer timing multiplier", { unit: "inverseMultiplier", referenceBpm: 120 }, 60, 2],
  ["Acoustic logarithmic multiplier", { unit: "exponentialMultiplier", base: 2, referenceBpm: 120 }, 240, 1],
  ["Jaw Jam tempo-relative breath rate", { unit: "multiplier", referenceBpm: 180 }, 120, 2 / 3],
  ["Lattice density-scaled timebase", { unit: "exponentialHz", floor: .01, factor: 400, frequencyScale: 2 }, 2.4, Math.log(2) / Math.log(400)],
]) test(`${name} maps a physical beat into the original UI domain`, () => {
  assert.ok(Math.abs(tapTempoValue(bpm, mapping) - expected) < 1e-9);
  assert.ok(Math.abs(tapTempoBpm(expected, mapping) - bpm) < 1e-9);
});

test("signed rotation preserves its direction and starts positive from stillness", () => {
  const mapping = { unit: "hz", signed: true };
  assert.equal(tapTempoValue(120, mapping, -.4), -2);
  assert.equal(tapTempoValue(120, mapping, 0), 2);
  assert.equal(tapTempoBpm(-2, mapping), 120);
});

test("Shape and 303 nonlinear ranges retain their physical rate curves", () => {
  const shape = { unit: "shapeHz" };
  assert.ok(Math.abs(tapTempoValue(240, shape) - 1) < 1e-12);
  assert.ok(Math.abs(tapTempoBpm(tapTempoValue(120, shape), shape) - 120) < 1e-10);
  const clock = { unit: "powerHz", floor: .01, span: 29.99, exponent: 2.65 };
  assert.ok(Math.abs(tapTempoValue(1800, clock) - 1) < 1e-12);
  assert.ok(Math.abs(tapTempoBpm(tapTempoValue(120, clock), clock) - 120) < 1e-10);
});

test("Time Fold retains its piecewise millisecond timing scale", () => {
  const mapping = { unit: "piecewiseMilliseconds", points: [[0, 1], [150, 50], [900, 1000], [1000, 3000]] };
  assert.equal(tapTempoValue(60, mapping), 900);
  assert.equal(tapTempoValue(20, mapping), 1000);
  assert.equal(tapTempoValue(1200, mapping), 150);
  assert.equal(tapTempoBpm(900, mapping), 60);
  assert.equal(tapTempoBpm(1000, mapping), 20);
});
