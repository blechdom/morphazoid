import assert from "node:assert/strict";
import test from "node:test";
import { DeckTransport, crossfadeGains, normalizeLoop, phaseDifference, alignedPosition, matchingRate,
  beatJumpPosition, quantizedPosition, wholeBeatLoop, shiftedLoop, resizedLoop } from "../src/instruments/trackazoid/transport.js";

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

test("Trackazoid quantized targets preserve phase across cues, offsets and track boundaries", () => {
  for (const bpm of [40, 114, 126, 240]) for (const beatOffset of [0, 0.123, 3.7]) {
    const grid = { bpm, beatOffset };
    for (const reference of [0.01, 3.713, 77.27]) for (const target of [0, 0.25, 35, 99.999]) {
      const position = quantizedPosition(target, reference, grid, 100);
      assert.ok(position >= 0 && position < 100);
      near(phaseDifference(position, grid, reference, grid), 0);
      assert.ok(Math.abs(position - target) < 60 / bpm + 1e-7);
    }
  }
  assert.equal(quantizedPosition(0, 0.4, { bpm: 120, beatOffset: 0 }, 0.1), null);
  assert.equal(quantizedPosition(1, 2, { bpm: null }, 100), null);
});

test("Trackazoid beat jump and loop edits reject bounds without silently changing phase or size", () => {
  const grid = { bpm: 120, beatOffset: 0.1 };
  near(beatJumpPosition(10.37, 8, grid, 100), 14.37);
  assert.equal(beatJumpPosition(0.49, -1, grid, 100), null);
  assert.equal(beatJumpPosition(99.6, 1, grid, 100), null);
  for (const beats of [0, 0.5, 33, NaN]) assert.equal(beatJumpPosition(20, beats, grid, 100), null);
  assert.deepEqual(shiftedLoop({ start: 10, end: 12 }, -8, grid, 100), { start: 6, end: 8 });
  assert.equal(shiftedLoop({ start: 1, end: 3 }, -4, grid, 100), null);
  assert.equal(shiftedLoop({ start: 98, end: 100 }, 1, grid, 100), null);
  assert.deepEqual(resizedLoop({ start: 10, end: 12 }, 0.5, grid, 100), { start: 10, end: 11 });
  assert.equal(resizedLoop({ start: 98, end: 100 }, 2, grid, 100), null);
  assert.equal(resizedLoop({ start: 10, end: 26 }, 2, grid, 100), null);
  assert.equal(resizedLoop({ start: 10, end: 10.0625 }, 0.5, grid, 100), null);
  assert.equal(resizedLoop({ start: 10, end: 12 }, 3, grid, 100), null);
  assert.equal(wholeBeatLoop({ start: 10.1, end: 12.1 }, grid), true);
  assert.equal(wholeBeatLoop({ start: 10.1, end: 10.35 }, grid), false);
});

test("Trackazoid pending relative jumps retain elapsed phase through tempo retiming and clock rebasing", () => {
  const transport = new DeckTransport(); transport.load(100, 0); transport.play(0);
  transport.schedule(10, { position: 14 }, 9.9, { relativePosition: true });
  transport.schedule(10.05, { rate: 1.1 }, 9.95);
  near(transport.snapshot(10).position, 10, "old future jump was replaced");
  near(transport.snapshot(10.05).position, 14.05);
  near(transport.snapshot(11.05).position, 15.15);
  transport.rebase(10, 50);
  near(transport.snapshot(50.05).position, 14.05);
  near(transport.snapshot(51.05).position, 15.15);
  transport.change(50.01, { playing: false, position: transport.snapshot(50.01).position });
  near(transport.snapshot(51).position, 10.01); assert.equal(transport.pendingPositionOffset, null);
  transport.load(30, 51); assert.equal(transport.pending, null); assert.equal(transport.pendingPositionOffset, null);
});

test("Trackazoid projected intent does not briefly apply a cancelled pending tempo or absolute seek", () => {
  const transport = new DeckTransport(); transport.load(100, 0); transport.play(0);
  transport.schedule(10, { rate: 1.1 }, 9.9);
  near(transport.snapshot(10.05).position, 10.055, "original schedule would run the faster tempo");
  near(transport.projected(10.05, 9.95).position, 10.05, "replacement has not run that tempo yet");
  const state = transport.projected(10.05, 9.95);
  transport.schedule(10.05, { position: state.position + 4 }, 9.95, { relativePosition: true });
  near(transport.snapshot(10.05).position, 14.05); near(transport.snapshot(11.05).position, 15.15);
  transport.schedule(10.06, { position: 50 }, 9.96);
  near(transport.projected(10.1, 9.97).position, 50, "absolute destinations remain exact when replaced");
});

test("Trackazoid relative loop edits project the old loop until the new audible boundary", () => {
  const transport = new DeckTransport(); transport.load(100, 0); transport.seek(11.9, 0); transport.setLoop(10, 12, 0); transport.play(0);
  transport.schedule(0.05, { loop: { start: 14, end: 16 }, position: 15.95 }, 0, { relativePosition: true });
  transport.schedule(0.2, { rate: 1.1 }, 0.02);
  near(transport.snapshot(0.15).position, 10.05);
  near(transport.snapshot(0.2).position, 14.1);
  const resized = new DeckTransport(); resized.load(100, 0); resized.seek(3.9, 0); resized.setLoop(0, 4, 0); resized.play(0);
  resized.schedule(0.05, { loop: { start: 0, end: 2 }, position: 1.95 }, 0, { relativePosition: true });
  resized.schedule(0.2, { rate: 1.1 }, 0.02);
  near(resized.snapshot(0.2).position, 0.1);
});

test("Trackazoid retiming cannot clamp a relative action past the track end; absolute seeks remain absolute", () => {
  const transport = new DeckTransport(); transport.load(100, 0); transport.play(0);
  transport.schedule(10, { position: 99.99 }, 9.9, { relativePosition: true });
  const before = structuredClone(transport.pending);
  assert.throws(() => transport.schedule(10.05, { rate: 1.1 }, 9.95), /leave the track/);
  assert.deepEqual(transport.pending, before);
  transport.schedule(10.05, { position: 42 }, 9.95);
  transport.schedule(10.1, { rate: 1.1 }, 9.96);
  near(transport.snapshot(10.1).position, 42);
  const ended = new DeckTransport(); ended.load(1, 0); ended.play(0); ended.seek(0.5, 2);
  assert.equal(ended.snapshot(3).playing, false, "seeking an ended track does not restart playback");
});
