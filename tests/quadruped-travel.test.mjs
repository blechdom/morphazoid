import test from "node:test";
import assert from "node:assert/strict";
import {
  QUADRUPED_ANIMALS, QUADRUPED_FOOT_LANES, createQuadrupedState,
  deriveQuadrupedPose, quadrupedFootCycleState, quadrupedGroundHeightAtWorldX,
  quadrupedSupportSnapshot, sanitizeQuadrupedState, setQuadrupedGroundProfile,
} from "../src/instruments/quadruped/quadruped.js";
import { advanceQuadrupedMotor, createQuadrupedMotorState } from "../src/instruments/quadruped/quadruped-motor.js";
import {
  QUADRUPED_TRAVEL_LIMITS, changeQuadrupedTravel, createQuadrupedTravel,
  quadrupedWorldAtPosition, rebaseQuadrupedTravel,
} from "../src/instruments/quadruped/quadruped-travel.js";

const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`,
);
const effective = (score, worldTravel) => ({ ...score, worldTravel });

test("ordinary world travel remains unchanged and transient travel is excluded from saved score state", () => {
  const score = createQuadrupedState("elephant", "walk");
  const forward = effective(score, createQuadrupedTravel({ stride: score.stride }));
  for (const position of [-24.5, -0.1, 0, 1.75, 16, 59.3]) {
    assert.equal(quadrupedWorldAtPosition(score, position), position / 16 * score.stride);
    assert.deepEqual(quadrupedSupportSnapshot(forward, position), quadrupedSupportSnapshot(score, position));
    assert.deepEqual(deriveQuadrupedPose(forward, position), deriveQuadrupedPose(score, position));
  }
  assert.equal(Object.hasOwn(sanitizeQuadrupedState(forward), "worldTravel"), false);
  assert.deepEqual(sanitizeQuadrupedState(forward), score);
});

test("signed travel supports pre-roll positions and changes direction without moving the body", () => {
  const score = createQuadrupedState("cat", "walk");
  const original = createQuadrupedTravel({ stride: score.stride });
  const originalJson = JSON.stringify(original);
  const p = 23.4;
  const worldX = quadrupedWorldAtPosition(effective(score, original), p);
  const reverse = changeQuadrupedTravel(original, { position: p, direction: -1, stride: score.stride });
  assert.equal(quadrupedWorldAtPosition(effective(score, reverse), p), worldX);
  close(quadrupedWorldAtPosition(effective(score, reverse), p + 16), worldX - score.stride);
  assert.equal(quadrupedWorldAtPosition(effective(score, reverse), -8), -0.5 * score.stride);
  assert.equal(JSON.stringify(original), originalJson);
  assert.equal(changeQuadrupedTravel(reverse, { position: p + 1, direction: -1, stride: score.stride }), reverse);
  assert.ok(Object.isFrozen(reverse) && Object.isFrozen(reverse.segments) && Object.isFrozen(reverse.segments[0]));
});

test("reversal preserves planted anchors and current airborne-foot positions for every animal", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    const score = createQuadrupedState(animal.id, "walk");
    for (const position of [1.2, 7.3, 19.1]) {
      const travel = createQuadrupedTravel({ stride: score.stride });
      const before = quadrupedSupportSnapshot(effective(score, travel), position);
      const reverse = changeQuadrupedTravel(travel, { position, direction: -1, stride: score.stride, feet: before.legs });
      const nextScore = effective(score, reverse);
      const after = quadrupedSupportSnapshot(nextScore, position);
      close(after.bodyWorldX, before.bodyWorldX);
      assert.equal(after.supportCount, before.supportCount);
      const later = quadrupedSupportSnapshot(nextScore, position + 0.025);
      assert.ok(later.bodyWorldX < after.bodyWorldX);
      for (const { id } of QUADRUPED_FOOT_LANES) {
        close(after.legs[id].footWorldX, before.legs[id].footWorldX);
        close(after.legs[id].footWorldY, before.legs[id].footWorldY);
        const foot = after.legs[id];
        if (foot.grounded && later.legs[id].eventId === foot.eventId && later.legs[id].grounded) {
          assert.equal(later.legs[id].footWorldX, foot.footWorldX);
          assert.equal(later.legs[id].footWorldY, foot.footWorldY);
          assert.ok(later.legs[id].footX > foot.footX, "a planted foot moves forward relative to a backing body");
        }
        if (!foot.grounded) {
          const landing = quadrupedFootCycleState(nextScore, id, foot.nextTouchdownPosition);
          const approach = quadrupedFootCycleState(nextScore, id, foot.nextTouchdownPosition - 1e-7);
          close(approach.footWorldX, landing.anchorWorldX, 1e-6);
          close(approach.footWorldY, landing.anchorWorldY, 1e-6);
        }
      }
    }
  }
});

test("repeated mid-swing direction changes retarget continuously and finish on the new landing anchor", () => {
  const score = createQuadrupedState("horse", "trot");
  let travel = createQuadrupedTravel({ stride: score.stride });
  for (let tick = 0; tick < 48; tick += 1) {
    const position = 1 + tick * 0.15;
    const before = quadrupedSupportSnapshot(effective(score, travel), position);
    travel = changeQuadrupedTravel(travel, { position, direction: tick % 2 ? 1 : -1, stride: score.stride, feet: before.legs });
    const after = quadrupedSupportSnapshot(effective(score, travel), position);
    for (const { id } of QUADRUPED_FOOT_LANES) {
      close(after.legs[id].footWorldX, before.legs[id].footWorldX);
      close(after.legs[id].footWorldY, before.legs[id].footWorldY);
    }
  }
});

test("backing across stairs keeps every planted foot on its actual tread and follows the continuous body grade", () => {
  for (const profile of ["stairs-up", "stairs-down"]) {
    const score = setQuadrupedGroundProfile(createQuadrupedState("goat", "walk"), profile);
    const position = 37.2;
    const travel = createQuadrupedTravel({ stride: score.stride });
    const before = quadrupedSupportSnapshot(effective(score, travel), position);
    const reverse = changeQuadrupedTravel(travel, { position, direction: -1, stride: score.stride, feet: before.legs });
    const nextScore = effective(score, reverse);
    for (let p = position; p <= position + 32; p += 0.25) {
      const support = quadrupedSupportSnapshot(nextScore, p);
      const pose = deriveQuadrupedPose(nextScore, p);
      close(pose.bodyGroundHeight, support.bodyGroundHeight);
      close(support.bodyGroundHeight, support.bodyWorldX * support.supportSlope);
      for (const { id } of QUADRUPED_FOOT_LANES) {
        const foot = support.legs[id];
        if (foot.grounded) {
          close(foot.footWorldY, quadrupedGroundHeightAtWorldX(profile, foot.footWorldX));
          close(pose.legs[id].footWorldX, foot.footWorldX);
          close(pose.legs[id].footX + support.bodyWorldX, foot.footWorldX);
        }
      }
    }
    const final = quadrupedSupportSnapshot(nextScore, position + 32);
    assert.ok(final.bodyWorldX < before.bodyWorldX);
    assert.equal(Math.sign(final.bodyGroundHeight - before.bodyGroundHeight), profile === "stairs-up" ? -1 : 1);
  }
});

test("world reversal leaves motor advancement and touchdown, stance, and release event order unchanged", () => {
  const score = createQuadrupedState("horse", "trot");
  const reverse = effective(score, createQuadrupedTravel({ direction: -1, stride: score.stride }));
  const forwardRun = advanceQuadrupedMotor(score, createQuadrupedMotorState(score), 1.5);
  const backwardRun = advanceQuadrupedMotor(reverse, createQuadrupedMotorState(reverse), 1.5);
  assert.deepEqual(backwardRun, forwardRun);
  assert.ok(backwardRun.events.length > 10);
  assert.ok(backwardRun.transitions.some(event => event.type === "toe-off"));
  assert.ok(backwardRun.transitions.some(event => event.type === "load"));
  assert.ok(backwardRun.transitions.some(event => event.type === "push"));
});

test("rebase preserves physical position while clearing old gait and swing captures", () => {
  const score = createQuadrupedState("elephant", "walk");
  const position = 7.3;
  const feet = quadrupedSupportSnapshot(score, position).legs;
  const travel = changeQuadrupedTravel(createQuadrupedTravel({ stride: score.stride }), { position, direction: -1, stride: score.stride, feet });
  assert.ok(Object.keys(travel.anchors).length > 0);
  const rebased = rebaseQuadrupedTravel(travel, { previousPosition: 11.2, position: 32 });
  close(quadrupedWorldAtPosition(effective(score, rebased), 32), quadrupedWorldAtPosition(effective(score, travel), 11.2));
  assert.equal(rebased.direction, -1);
  assert.deepEqual(rebased.anchors, {});
  assert.deepEqual(rebased.swings, {});
  const world = quadrupedWorldAtPosition(effective(score, rebased), 32);
  close(quadrupedWorldAtPosition(effective(score, rebased), 48), world - score.stride);
});

test("history remains bounded through dense reversals without losing live foot continuity or the footprint span", () => {
  const score = createQuadrupedState("dog", "walk");
  let travel = createQuadrupedTravel({ stride: score.stride });
  for (let index = 1; index <= 720; index += 1) {
    const position = index / 8;
    const before = quadrupedSupportSnapshot(effective(score, travel), position);
    travel = changeQuadrupedTravel(travel, { position, direction: index % 2 ? -1 : 1, stride: score.stride, feet: before.legs });
    assert.ok(travel.segments.length <= QUADRUPED_TRAVEL_LIMITS.maxSegments);
    assert.ok(travel.segments[0].position <= Math.max(0, position - QUADRUPED_TRAVEL_LIMITS.historyFrames));
    const after = quadrupedSupportSnapshot(effective(score, travel), position);
    close(after.bodyWorldX, before.bodyWorldX);
    for (const { id } of QUADRUPED_FOOT_LANES) close(after.legs[id].footWorldX, before.legs[id].footWorldX);
    assert.ok(travel.segments.every(segment => Number.isFinite(segment.worldX)));
  }
  assert.equal(travel.segments.length, QUADRUPED_TRAVEL_LIMITS.maxSegments);
});

test("hostile public inputs produce finite bounded coordinates", () => {
  for (const value of [NaN, Infinity, -Infinity, -1e50, 1e50, undefined, null, "bad"]) {
    const travel = createQuadrupedTravel({ position: value, worldX: value, direction: value, stride: value });
    const score = { ...createQuadrupedState("cat"), worldTravel: travel };
    const next = changeQuadrupedTravel(travel, { position: value, direction: -1, stride: value });
    for (const candidate of [travel, next, rebaseQuadrupedTravel(next, { position: value, previousPosition: value })]) {
      const x = quadrupedWorldAtPosition({ ...score, worldTravel: candidate }, value);
      assert.ok(Number.isFinite(x));
      assert.ok(Math.abs(x) <= QUADRUPED_TRAVEL_LIMITS.maxWorldX);
    }
  }
  const malformed = { ...createQuadrupedState("cat"), worldTravel: { segments: [{ position: NaN, worldX: Infinity, direction: NaN, stride: Infinity }] } };
  for (const foot of Object.values(quadrupedSupportSnapshot(malformed, 2).legs)) {
    assert.ok(Number.isFinite(foot.footWorldX) && Number.isFinite(foot.footWorldY));
  }
});
