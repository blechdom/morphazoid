import assert from "node:assert/strict";
import test from "node:test";
import { DeckTransport, crossfadeGains, normalizeLoop, phaseDifference, alignedPosition, matchingRate } from "../src/instruments/trackazoid/transport.js";

function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`); }

test("Trackazoid transport keeps phase through tempo, pause and clock changes", () => {
  const transport = new DeckTransport();
  transport.load(120, 10); transport.play(12);
  near(transport.snapshot(22).position, 10);
  transport.setRate(1.1, 22);
  near(transport.snapshot(32).position, 21);
  transport.pause(32);
  near(transport.snapshot(100).position, 21);
  transport.play(100); transport.rebase(105, 0.5);
  near(transport.snapshot(2.5).position, 28.7);
  assert.equal(transport.snapshot(2.5).playing, true);
});

test("Trackazoid loop survives long UI stalls and exposes independent snapshots", () => {
  const transport = new DeckTransport();
  transport.load(600, 0); transport.seek(8, 0); transport.setLoop(10, 12, 0); transport.play(0);
  near(transport.snapshot(1).position, 9, "lead-in before loop is preserved");
  near(transport.snapshot(1001).position, 11);
  const snapshot = transport.snapshot(1001); snapshot.loop.start = 999;
  assert.deepEqual(transport.snapshot(1001).loop, { start: 10, end: 12 });
  transport.clearLoop(1001);
  near(transport.snapshot(1003).position, 13);
});

test("Trackazoid ends finite tracks and Play restarts ended audio deterministically", () => {
  const transport = new DeckTransport();
  assert.equal(transport.play(0).playing, false);
  transport.load(4, 0); transport.play(0);
  assert.deepEqual(transport.snapshot(50), { position: 4, duration: 4, playing: false, rate: 1, loop: null });
  assert.equal(transport.play(50).position, 0);
  transport.load(20, 52);
  assert.equal(transport.snapshot(54).playing, false);
  assert.equal(transport.snapshot(54).position, 0);
});

test("Trackazoid bounds tempo, loops and seeks, including non-finite user input", () => {
  const transport = new DeckTransport(); transport.load(10, 0);
  assert.equal(transport.setRate(Infinity, 0).rate, 1);
  assert.equal(transport.setRate(-2, 0).rate, 0.84);
  assert.equal(transport.setRate(50, 0).rate, 1.16);
  assert.equal(transport.seek(-100, 0).position, 0);
  assert.equal(transport.seek(100, 0).position, 10);
  assert.equal(transport.seek(NaN, 0).position, 0);
  assert.equal(normalizeLoop(1, 1.01, 10), null);
  assert.equal(normalizeLoop(2, 1, 10), null);
  assert.deepEqual(normalizeLoop(-10, 50, 10), { start: 0, end: 10 });
});

test("Trackazoid crossfader has silent endpoints and constant power", () => {
  assert.deepEqual(crossfadeGains(-1), [1, 0]);
  assert.deepEqual(crossfadeGains(1), [0, 1]);
  for (let value = -1; value <= 1; value += 0.05) {
    const [a, b] = crossfadeGains(value); near(a * a + b * b, 1);
  }
});

test("Trackazoid future edits keep audible position intact and replace bounded pending intent", () => {
  const transport = new DeckTransport(); transport.load(120, 0); transport.play(0);
  transport.schedule(10, { rate: 1.1 }, 9);
  near(transport.snapshot(9.5).position, 9.5);
  assert.equal(transport.intent(9.5).rate, 1.1);
  assert.equal(transport.snapshot(9.5).rate, 1);
  transport.schedule(10.2, { rate: 1.15 }, 9.2);
  near(transport.snapshot(10.1).position, 10.1);
  near(transport.snapshot(11.2).position, 11.35);
  transport.rebase(9.5, 100);
  near(transport.snapshot(100.6).position, 10.1);
  near(transport.snapshot(101.7).position, 11.35);
});

test("Trackazoid beat alignment handles unknown grids, track edges and octave mistakes", () => {
  const grid = { bpm: 120, beatOffset: 0.2 };
  near(alignedPosition(0, grid, 0.5, 100), 0.45);
  near(alignedPosition(99.99, grid, 0.5, 100), 99.95);
  near(phaseDifference(0.45, grid, 0.25, { bpm: 120, beatOffset: 0 }), 0);
  assert.equal(phaseDifference(0, { bpm: null }, 0, grid), null);
  near(matchingRate(126, 114, 1), 114 / 126);
  assert.equal(matchingRate(60, 126, 1), null);
});
