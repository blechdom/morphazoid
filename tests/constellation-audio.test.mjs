import assert from "node:assert/strict";
import test from "node:test";

import { performanceEventsForWindow } from "../src/constellation-audio.js";

const clip = Object.freeze({
  id: "pulse",
  sectionId: "opening",
  lane: 1,
  instrumentId: "graph-synth",
  instrumentType: "pitched",
  soundId: "glass",
  patternId: "offbeats",
  rootNote: 60,
  startBeat: 2,
  endBeat: 6,
  pattern: Object.freeze({
    steps: Object.freeze([1, 0, 0.5, 0]),
    stepBeats: 0.5,
    noteOffsets: Object.freeze([0, 2, 7, 5]),
  }),
});

test("performance windows expand projected clip patterns deterministically", () => {
  const events = performanceEventsForWindow([clip], 0, 8);
  assert.deepEqual(events.map(({ beat, note, velocity }) => [beat, note, velocity]), [
    [2, 60, 1],
    [3, 67, 0.5],
    [4, 60, 1],
    [5, 67, 0.5],
  ]);
});

test("performance windows are half-open and preserve event identity across lookahead slices", () => {
  const first = performanceEventsForWindow([clip], 2, 4);
  const second = performanceEventsForWindow([clip], 4, 6);
  assert.deepEqual(first.map(({ id }) => id), ["pulse:0", "pulse:2"]);
  assert.deepEqual(second.map(({ id }) => id), ["pulse:4", "pulse:6"]);
  assert.equal(new Set([...first, ...second].map(({ id }) => id)).size, 4);
});

test("performance windows remain bounded under dense patterns", () => {
  const dense = {
    ...clip,
    id: "dense",
    startBeat: 0,
    endBeat: 128,
    pattern: { steps: [1], stepBeats: 1 / 64, noteOffsets: [0] },
  };
  assert.equal(performanceEventsForWindow([dense], 0, 128, { maximum: 37 }).length, 37);
});
