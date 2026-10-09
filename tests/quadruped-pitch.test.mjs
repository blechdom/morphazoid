import test from "node:test";
import assert from "node:assert/strict";
import { QUADRUPED_CALLS, quadrupedCallEvents, quadrupedPitchRatio } from "../src/instruments/quadruped/quadruped-voices.js";
import { createQuadrupedGestureCall } from "../src/instruments/quadruped/quadruped-gesture-voices.js";

test("score pitch continuously transposes every scored and gestured voice and its filter together", () => {
  for (const [animalId, voices] of Object.entries(QUADRUPED_CALLS)) {
    for (const pitchSemitones of [-36, -17.25, 0, 13.625, 36]) {
      const score = { animalId, pitchSemitones, tempoBpm: 96, callPattern: [[1], [0.8], [0.6]] };
      const events = quadrupedCallEvents(score, 0);
      assert.equal(events.length, 3);
      for (const [row, voice] of voices.entries()) {
        const gesture = createQuadrupedGestureCall(score, { row });
        assert.deepEqual(events[row].notes, voice.notes.map(note => note + pitchSemitones));
        assert.deepEqual(gesture.notes, events[row].notes);
        assert.equal(gesture.filter, events[row].filter);
        assert.equal(gesture.duration, events[row].duration);
        assert.equal(events[row].duration, quadrupedCallEvents({ ...score, pitchSemitones: 0 }, 0)[row].duration);
        const raised = createQuadrupedGestureCall(score, { row, pitch: 5.125 });
        assert.deepEqual(raised.notes, voice.notes.map(note => note + pitchSemitones + 5.125));
      }
    }
  }
  assert.equal(quadrupedPitchRatio(-36), 0.125);
  assert.equal(quadrupedPitchRatio(36), 8);
  assert.equal(quadrupedPitchRatio(0), 1);
});

test("call tempo extends to 10–1000 BPM with bounded release and finite hostile-input recovery", () => {
  for (const animalId of Object.keys(QUADRUPED_CALLS)) for (let row = 0; row < 3; row++) {
    const score = { animalId, callPattern: Array.from({ length: 3 }, () => [1]) };
    const durations = [10, 25, 96, 500, 1000].map(tempoBpm => {
      const voice = quadrupedCallEvents({ ...score, tempoBpm }, 0)[row];
      assert.ok(voice.duration >= 0.09 && voice.duration <= 1.8);
      return voice.duration;
    });
    assert.ok(durations.every((duration, index) => !index || duration <= durations[index - 1]));
  }
  for (const pitchSemitones of [NaN, Infinity, -Infinity, {}, "bad", -1e99, 1e99]) {
    const score = { animalId: "constructor", tempoBpm: Infinity, pitchSemitones, callPattern: [[1]] };
    const call = quadrupedCallEvents(score, 0)[0];
    assert.ok(call.notes.every(Number.isFinite));
    assert.ok(Number.isFinite(call.filter));
    assert.ok(call.duration >= 0.09 && call.duration <= 1.8);
    assert.ok(quadrupedPitchRatio(pitchSemitones) >= 0.125 && quadrupedPitchRatio(pitchSemitones) <= 8);
  }
  assert.deepEqual(quadrupedCallEvents(null, NaN), []);
});
