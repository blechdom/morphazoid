import test from "node:test";
import assert from "node:assert/strict";
import { QUADRUPED_ANIMALS, createQuadrupedState } from "../src/instruments/quadruped/quadruped.js";
import { QUADRUPED_CALLS } from "../src/instruments/quadruped/quadruped-voices.js";
import { createQuadrupedGestureCall, quadrupedGestureCallPerformance } from "../src/instruments/quadruped/quadruped-gesture-voices.js";

const gestureFields = {
  "trunk-lift": "trunkRaise", "horn-neigh": "hornPulse", "head-toss": "headToss",
  "whisker-meow": "whiskerPulse", "spine-chirp": "spineFlex", "neck-sway": "neckSway",
  "tongue-flick": "tongueFlick", "throat-pulse": "throatPulse",
};
const numericFields = ["strength", "progress", "noteIndex", "notePulse", ...new Set(Object.values(gestureFields)), "earFlick"];

test("all fifteen animals' calls retain their voice and animate their own gesture", () => {
  for (const animal of QUADRUPED_ANIMALS) for (let row = 0; row < 3; row += 1) {
    const voice = QUADRUPED_CALLS[animal.id][row];
    const call = createQuadrupedGestureCall(createQuadrupedState(animal.id), { row });
    assert.equal(call.label, voice.label);
    assert.equal(call.gesture, voice.gesture);
    assert.equal(call.type, voice.type);
    assert.equal(call.filter, voice.filter);
    assert.deepEqual(call.notes, voice.notes);
    let maximumGesture = 0;
    for (let index = 1; index < 200; index += 1) {
      const pose = quadrupedGestureCallPerformance(call, call.duration * index / 200);
      assert.equal(pose.active, true);
      assert.equal(pose.kind, voice.label);
      assert.ok(numericFields.every(key => Number.isFinite(pose[key])));
      assert.ok(pose.strength >= 0 && pose.strength <= call.intensity);
      for (const field of Object.values(gestureFields)) assert.ok(Math.abs(pose[field]) <= call.intensity);
      maximumGesture = Math.max(maximumGesture, Math.abs(pose[gestureFields[voice.gesture]]));
    }
    assert.ok(maximumGesture > 0.1, `${animal.id} ${voice.label} should move its ${voice.gesture}`);
    for (const elapsed of [-1, call.duration, call.duration + 1, Infinity, NaN]) {
      const pose = quadrupedGestureCallPerformance(call, elapsed);
      assert.equal(pose.active, false);
      for (const key of ["strength", "notePulse", ...Object.values(gestureFields), "earFlick"]) assert.equal(pose[key], 0);
    }
  }
});

test("continuous semitone pitch and intensity are bounded without mutating score or registry", () => {
  const score = createQuadrupedState("elephant");
  const before = structuredClone(score);
  const voicesBefore = structuredClone(QUADRUPED_CALLS);
  const call = createQuadrupedGestureCall(score, { row: 0, pitch: 3.25, strength: 0.36 });
  assert.deepEqual(call.notes, QUADRUPED_CALLS.elephant[0].notes.map(note => note + 3.25));
  assert.equal(call.intensity, 0.36);
  assert.ok(Object.isFrozen(call) && Object.isFrozen(call.notes));
  assert.notEqual(call.notes, QUADRUPED_CALLS.elephant[0].notes);
  assert.deepEqual(score, before);
  assert.deepEqual(QUADRUPED_CALLS, voicesBefore);
  assert.equal(createQuadrupedGestureCall(score, { pitch: 999, strength: 4, row: 99 }).pitch, 12);
  assert.equal(createQuadrupedGestureCall(score, { pitch: -999, strength: -2, row: -99 }).pitch, -12);
  assert.equal(createQuadrupedGestureCall(score, { strength: -2 }).intensity, 0);
  assert.equal(createQuadrupedGestureCall(score, { strength: 4 }).intensity, 1);
  const quiet = createQuadrupedGestureCall(score, { strength: 0 });
  assert.equal(quadrupedGestureCallPerformance(quiet, quiet.duration / 2).strength, 0);
  const low = createQuadrupedGestureCall(score, { strength: 0.25 });
  const high = createQuadrupedGestureCall(score, { strength: 1 });
  assert.ok(quadrupedGestureCallPerformance(low, 0.05).strength < quadrupedGestureCallPerformance(high, 0.05).strength / 3);
});

test("call duration and attack timing follow the existing synth at tempo extremes", () => {
  for (const animal of QUADRUPED_ANIMALS) for (const tempoBpm of [-99, 25, 96, 500, 9999, NaN]) for (let row = 0; row < 3; row += 1) {
    const call = createQuadrupedGestureCall({ animalId: animal.id, tempoBpm }, { row });
    assert.ok(call.duration >= 0.09 && call.duration <= 1.8);
    assert.ok(call.attackSeconds > 0 && call.attackSeconds < call.duration);
    assert.ok(call.releaseSeconds > 0 && call.releaseSeconds < call.duration);
    assert.equal(quadrupedGestureCallPerformance(call, call.duration).active, false);
  }
  const trumpet = createQuadrupedGestureCall({ animalId: "elephant", tempoBpm: 96 });
  assert.equal(trumpet.attackSeconds, 0.016);
  assert.equal(trumpet.undertoneAttackSeconds, 0.022);
  assert.ok(quadrupedGestureCallPerformance(trumpet, 0.022).strength > 0.75);
  assert.ok(quadrupedGestureCallPerformance(trumpet, trumpet.duration - 0.001).strength < 0.001);
  const strings = createQuadrupedGestureCall({ animalId: "gazelle", tempoBpm: 96 }, { row: 1 });
  assert.equal(strings.attackSeconds, 0.075);
  const sparkle = createQuadrupedGestureCall({ animalId: "unicorn", tempoBpm: 96 });
  assert.equal(sparkle.attackSeconds, 0.003);
});

test("missing and non-finite inputs recover to finite descriptors or a neutral pose", () => {
  for (const score of [undefined, null, {}, { animalId: "constructor", tempoBpm: Infinity }]) {
    const call = createQuadrupedGestureCall(score, { row: NaN, pitch: NaN, strength: NaN });
    assert.equal(call.animalId, "elephant");
    assert.equal(call.row, 0);
    assert.equal(call.pitch, 0);
    assert.equal(call.intensity, 0.8);
    assert.ok(call.notes.every(Number.isFinite));
  }
  for (const call of [undefined, null, {}, { duration: -1 }, { duration: NaN }]) {
    assert.equal(quadrupedGestureCallPerformance(call, 0.1).active, false);
  }
});
