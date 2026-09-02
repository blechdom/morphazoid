import assert from "node:assert/strict";
import test from "node:test";

import { ConstellationAudio, performanceEventsForWindow } from "../src/constellation-audio.js";

const projectedEvents = Object.freeze([
  Object.freeze({ id: "control:0", beat: 0, signal: "control", playable: false, value: 0.2 }),
  Object.freeze({ id: "drums:0", beat: 0, signal: "trigger", playable: true, address: "patch/drums/voice", note: 48 }),
  Object.freeze({ id: "trace:1", beat: 1, signal: "trigger", playable: false, address: "patch/clock/out" }),
  Object.freeze({ id: "bass:1", beat: 1, signal: "trigger", playable: true, address: "patch/bass/voice", note: 36 }),
  Object.freeze({ id: "control:2", beat: 2, signal: "control", playable: false, value: 0.8 }),
  Object.freeze({ id: "drums:2", beat: 2, signal: "trigger", playable: true, address: "patch/drums/voice", note: 50 }),
  Object.freeze({ id: "bass:3", beat: 3, signal: "trigger", playable: true, address: "patch/bass/voice", note: 43 }),
  Object.freeze({ id: "drums:4", beat: 4, signal: "trigger", playable: true, address: "patch/drums/voice", note: 48 }),
]);

test("performance windows consume graph-projected playable events", () => {
  const result = performanceEventsForWindow({ events: projectedEvents }, 0, 4);
  assert.deepEqual(result.map(({ id }) => id), ["drums:0", "bass:1", "drums:2", "bass:3"]);
  assert.equal(result.every(({ playable }) => playable), true);
});

test("performance windows are half-open and preserve event identity across slices", () => {
  const first = performanceEventsForWindow(projectedEvents, 0, 2);
  const second = performanceEventsForWindow(projectedEvents, 2, 4);

  assert.deepEqual(first.map(({ id }) => id), ["drums:0", "bass:1"]);
  assert.deepEqual(second.map(({ id }) => id), ["drums:2", "bass:3"]);
  assert.equal(new Set([...first, ...second].map(({ id }) => id)).size, 4);
  assert.equal(first[0], projectedEvents[1], "windowing preserves the projected event object");
});

test("control events are opt-in and remain ordered with playable triggers", () => {
  assert.deepEqual(
    performanceEventsForWindow(projectedEvents, 0, 3).map(({ id }) => id),
    ["drums:0", "bass:1", "drums:2"],
  );
  assert.deepEqual(
    performanceEventsForWindow(projectedEvents, 0, 3, { includeControl: true }).map(({ id }) => id),
    ["control:0", "drums:0", "bass:1", "control:2", "drums:2"],
  );
});

test("performance event windows remain bounded under dense projections", () => {
  const dense = Array.from({ length: 2_000 }, (_, index) => ({
    id: `dense:${String(index).padStart(4, "0")}`,
    beat: index / 64,
    signal: "trigger",
    playable: true,
  }));
  const events = performanceEventsForWindow({ events: dense }, 0, 32, { maximum: 37 });
  assert.equal(events.length, 37);
  assert.deepEqual(events.map(({ beat }) => beat), dense.slice(0, 37).map(({ beat }) => beat));
});

test("zero-velocity playable events are silent while zero-valued control remains observable", () => {
  const source = [
    { id: "silent-note", beat: 0, signal: "trigger", playable: true, velocity: 0 },
    { id: "audible-note", beat: 0.5, signal: "trigger", playable: true, velocity: 0.01 },
    { id: "zero-control", beat: 0.75, signal: "control", playable: false, value: 0, velocity: 0 },
  ];

  assert.deepEqual(
    performanceEventsForWindow(source, 0, 1).map(({ id }) => id),
    ["audible-note"],
  );
  assert.deepEqual(
    performanceEventsForWindow(source, 0, 1, { includeControl: true }).map(({ id }) => id),
    ["audible-note", "zero-control"],
  );
});

test("direct zero-velocity triggers skip before starting an AudioContext", async () => {
  let contextStarts = 0;
  class UnexpectedAudioContext {
    constructor() {
      contextStarts += 1;
      throw new Error("silent events must not start Web Audio");
    }
  }
  const audio = new ConstellationAudio({ AudioContext: UnexpectedAudioContext });
  const result = await audio.trigger({
    id: "direct-silent-note",
    signal: "trigger",
    playable: true,
    velocity: 0,
  });

  assert.deepEqual(result, { scheduled: false, skipped: true, reason: "silent" });
  assert.equal(contextStarts, 0);
  assert.equal(audio.context, null);
  assert.equal(audio.started, false);
});
