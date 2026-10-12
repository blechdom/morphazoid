import test from "node:test";
import assert from "node:assert/strict";
import { peakEnvelope, beatLoop, syncTarget, formatTime } from "../src/instruments/trackazoid/waveform.js";

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const phase = (position, bpm, offset) => (((position - offset) * bpm / 60) % 1 + 1) % 1;
function nearPhase(actual, expected) {
  const distance = Math.abs(actual - expected);
  assert.ok(Math.min(distance, 1 - distance) < 1e-8, `Beat phase ${actual} matches ${expected}`);
}

test("waveform envelopes preserve stereo polarity and transients in every uneven bin", () => {
  const left = Float32Array.from([0, 0.25, 0, -0.75, 0, 0, 0.5]);
  const right = Float32Array.from([0, -0.25, 1, 0, -1, 0, 0]);
  assert.deepEqual([...peakEnvelope([left, right], 3)], [-0.25, 0.25, -0.75, 1, -1, 0.5]);
  assert.deepEqual([...peakEnvelope([left, right], 1)], [-1, 1]);
  assert.equal(peakEnvelope([left, right], 10000).length, 14, "Small buffers cannot allocate more bins than samples");
});

test("waveform envelopes stay finite for bad samples and empty or silent tracks", () => {
  assert.deepEqual([...peakEnvelope([Float32Array.from([NaN, Infinity, -Infinity, 0.5])], 2)], [0, 0, 0, 0.5]);
  assert.deepEqual([...peakEnvelope([], 4)], []);
  assert.deepEqual([...peakEnvelope([new Float32Array(5)], 2)], [0, 0, 0, 0]);
  assert.equal(peakEnvelope([new Float32Array(5)], 0).length, 2);
});

test("beat loops use the manual downbeat and selected beat count", () => {
  const loop = beatLoop(2.2, 120, 0.125, 4, 60);
  near(loop.start, 2.125); near(loop.end, 4.125);
  const fast = beatLoop(3.75, 240, 0, 8, 60);
  near(fast.start, 3.75); near(fast.end, 5.75);
  const slow = beatLoop(4.6, 40, 0.125, 2, 60);
  near(slow.start, 3.125); near(slow.end, 6.125);
  const fallback = beatLoop(2, NaN, 0, 99, 60);
  near(fallback.start, 2); near(fallback.end, 4);
});

test("beat loops respect file boundaries and the engine’s 50 ms minimum", () => {
  assert.equal(beatLoop(0, 120, 0, 4, 0), null);
  assert.equal(beatLoop(0, 120, 0, 4, 0.049), null);
  assert.deepEqual(beatLoop(0, 120, 0, 4, 0.05), { start: 0, end: 0.05 });
  assert.equal(beatLoop(2.01, 120, 0, 4, 2.049), null);
  assert.equal(beatLoop(30, 120, 0, 4, 30), null);
  const clipped = beatLoop(27.7, 120, 0, 16, 30);
  assert.deepEqual(clipped, { start: 27.5, end: 30 });
  const beforeDownbeat = beatLoop(0.01, 120, 0.125, 1, 30);
  assert.ok(beforeDownbeat.start >= 0 && beforeDownbeat.end <= 30);
  near(beatLoop(2 - 1e-8, 120, 0, 1, 30).start, 2, 1e-12);
});

test("sync matches effective tempo and beat phase across source BPMs and manual offsets", () => {
  const scenarios = [
    { bpm: 120, offset: 0, otherBpm: 126, otherOffset: 0.12, otherRate: 0.98 },
    { bpm: 83.5, offset: 0.375, otherBpm: 89.2, otherOffset: 2.21, otherRate: 0.94 },
    { bpm: 175, offset: 4.2, otherBpm: 158, otherOffset: 0, otherRate: 1.05 },
    { bpm: 65, offset: 0.16, otherBpm: 70, otherOffset: 6.5, otherRate: 1 },
  ];
  for (const options of scenarios) for (const position of [0, 0.01, 1.125, 17.33, 120]) {
    const otherPosition = 13.37;
    const target = syncTarget({ ...options, position, otherPosition });
    assert.ok(target && target.position >= 0);
    near(options.bpm * target.rate, options.otherBpm * options.otherRate, 1e-10);
    nearPhase(phase(target.position, options.bpm, options.offset), phase(otherPosition, options.otherBpm, options.otherOffset));
    // The selected phase-aligned location should be the closest valid beat.
    const beat = 60 / options.bpm;
    for (const alternate of [target.position - beat, target.position + beat]) {
      if (alternate >= 0) assert.ok(Math.abs(target.position - position) <= Math.abs(alternate - position) + 1e-10);
    }
  }
});

test("sync at the start advances to a matching phase instead of clamping an invalid negative target", () => {
  const target = syncTarget({ position: 0, bpm: 120, otherPosition: 0.4, otherBpm: 120, otherRate: 1 });
  near(target.position, 0.4);
  near(target.rate, 1);
});

test("sync near the end chooses a phase-aligned point within the track or reports no usable point", () => {
  const options = { position: 2.05, duration: 2.05, bpm: 120, otherPosition: 0.4, otherBpm: 120, otherRate: 1 };
  const target = syncTarget(options);
  near(target.position, 1.9);
  assert.ok(target.position <= options.duration);
  nearPhase(phase(target.position, 120, 0), phase(0.4, 120, 0));
  assert.equal(syncTarget({ ...options, position: 0.2, duration: 0.3 }), null);
  near(syncTarget({ ...options, position: 0.2, duration: 0.4 }).position, 0.4);
});

test("sync admits exactly ±16 percent and rejects tempos beyond the deck range", () => {
  const options = { position: 2, bpm: 120, otherPosition: 3, otherBpm: 120, otherRate: 1 };
  near(syncTarget({ ...options, otherRate: 0.84 }).rate, 0.84);
  near(syncTarget({ ...options, otherRate: 1.16 }).rate, 1.16);
  for (const otherRate of [0.839, 1.161, 0, -1, NaN, Infinity]) assert.equal(syncTarget({ ...options, otherRate }), null);
  assert.equal(syncTarget({ ...options, bpm: 0 }), null);
  assert.equal(syncTarget({ ...options, otherBpm: 180 }), null);
});

test("track time readouts keep elapsed minutes and tenths at useful boundaries", () => {
  assert.equal(formatTime(-1), "00:00.0");
  assert.equal(formatTime(0), "00:00.0");
  assert.equal(formatTime(61.25), "01:01.2");
  assert.equal(formatTime(3600), "60:00.0");
});
