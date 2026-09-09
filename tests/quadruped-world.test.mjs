import test from "node:test";
import assert from "node:assert/strict";
import { QUADRUPED_ANIMALS, QUADRUPED_LANES, createQuadrupedState, sanitizeQuadrupedState, applyQuadrupedAnimal, applyQuadrupedBehavior, deriveQuadrupedPose } from "../src/quadruped.js";
import { quadrupedCalls, quadrupedCallEvents, sanitizeQuadrupedCalls } from "../src/quadruped-voices.js";
import { createQuadrupedGroup, quadrupedGroupOffsets, shareQuadrupedWorld, quadrupedStairSound, renderQuadrupedFriction } from "../src/quadruped-world.js";

test("all fifteen animals own three named, distinct optional melodic calls", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    const score = createQuadrupedState(animal.id);
    assert.equal(quadrupedCalls(animal.id).length, 3);
    assert.equal(new Set(quadrupedCalls(animal.id).map(call => call.label)).size, 3);
    assert.equal(new Set(quadrupedCalls(animal.id).map(call => JSON.stringify([call.notes, call.type, call.filter, call.pulse]))).size, 3);
    assert.deepEqual(quadrupedCallEvents(score, 0), []);
    score.callPattern[0][0] = 1;
    assert.equal(quadrupedCallEvents(score, 16).length, 1);
    const pose = deriveQuadrupedPose(score, 0.5);
    assert.ok(pose.headPerformance.active && pose.headPerformance.strength > 0);
    assert.deepEqual(QUADRUPED_LANES.map(lane => pose.legs[lane.id].contact), QUADRUPED_LANES.map(lane => deriveQuadrupedPose(createQuadrupedState(animal.id), 0.5).legs[lane.id].contact), "calls never become feet or propulsion");
    assert.deepEqual(applyQuadrupedAnimal(score, "frog").callPattern, score.callPattern);
    assert.deepEqual(applyQuadrupedBehavior(score, "leap").callPattern, score.callPattern);
  }
});

test("call migration bounds hostile input and frog has tailless folded hind anatomy", () => {
  const pattern = sanitizeQuadrupedCalls([[Infinity, -2, 8, "0.58"]]);
  assert.deepEqual(pattern[0].slice(0, 4), [0, 0, 1, 0.58]);
  assert.equal(pattern.length, 3); assert.equal(pattern[2].length, 16);
  const old = sanitizeQuadrupedState({ version: 7, animalId: "frog" });
  assert.equal(old.version, 8);
  assert.ok(old.callPattern.every(row => row.every(value => value === 0)));
  const frog = QUADRUPED_ANIMALS.find(animal => animal.id === "frog");
  assert.equal(frog.morphology.tailLength, 0);
  assert.ok(frog.morphology.hindUpper > frog.morphology.frontUpper * 2);
  old.callPattern[0][0] = 1;
  assert.ok(deriveQuadrupedPose(old, 0.5).headPerformance.throatPulse > 0);
});

test("groups share tempo and ground but retain private gaits, feet and calls", () => {
  const lead = createQuadrupedState("frog", "jump");
  lead.tempoBpm = 147;
  const trio = createQuadrupedGroup(lead, "trio");
  assert.equal(trio.length, 3);
  assert.equal(new Set(trio.map(score => score.behaviorId)).size, 3);
  for (const score of trio) assert.equal(score.tempoBpm, 147);
  trio[1].pattern["front-left"][0] = 0.13;
  trio[1].callPattern[0][0] = 1;
  assert.equal(trio[0].callPattern[0][0], 0);
  const shared = shareQuadrupedWorld(trio[1], { ...lead, tempoBpm: 60, surfaceId: "wood" });
  assert.equal(shared.tempoBpm, 60); assert.equal(shared.surfaceId, "wood");
  assert.deepEqual(shared.pattern, trio[1].pattern);
  assert.deepEqual(shared.callPattern, trio[1].callPattern);
  assert.deepEqual(quadrupedGroupOffsets(42), quadrupedGroupOffsets(42));
  assert.notDeepEqual(quadrupedGroupOffsets(42), quadrupedGroupOffsets(43));
  assert.equal(new Set(createQuadrupedGroup(lead, "herd").map(score => score.animalId)).size, 1);
});

test("each descending tread lowers register and darkens a bounded cavern response", () => {
  const down = { groundProfileId: "stairs-down" };
  const a = quadrupedStairSound(down, 0);
  const b = quadrupedStairSound(down, 0.91);
  const c = quadrupedStairSound(down, 1.81);
  assert.ok(a.pitchRatio > b.pitchRatio && b.pitchRatio > c.pitchRatio);
  assert.ok(a.cutoff > b.cutoff && b.cutoff > c.cutoff);
  assert.ok(a.wet < b.wet && b.wet < c.wet);
  assert.ok(a.delay < b.delay && b.delay < c.delay);
  assert.ok(quadrupedStairSound({ groundProfileId: "stairs-up" }, 2).pitchRatio > 1);
  assert.equal(quadrupedStairSound(down, 200, 0).pitchRatio, 1);
  for (const x of [-1e12, -1, NaN, 0, 1e12]) {
    const color = quadrupedStairSound(down, x);
    assert.ok(Object.values(color).every(Number.isFinite));
    assert.ok(color.feedback < 0.8 && color.cutoff >= 600);
  }
});

test("seeded slide grains are finite, bounded, reproducible and material-specific", () => {
  const signatures = new Set();
  for (const surfaceId of ["earth", "sand", "wood", "stone", "metal", "snow", "water", "crystal"]) {
    const options = { sampleRate: 8000, seconds: 0.4, seed: 42, surfaceId };
    const samples = renderQuadrupedFriction(options);
    assert.deepEqual(samples, renderQuadrupedFriction(options));
    assert.notDeepEqual(samples, renderQuadrupedFriction({ ...options, seed: 43 }));
    assert.notDeepEqual(samples, renderQuadrupedFriction({ ...options, grain: 0 }));
    assert.equal(Math.abs(samples[0]), 0); assert.equal(Math.abs(samples.at(-1)), 0);
    assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    assert.ok(rms > 0.001);
    signatures.add(rms.toFixed(5));
  }
  assert.equal(signatures.size, 8);
});
