import test from "node:test";
import assert from "node:assert/strict";
import {
  QUADRUPED_ANIMALS, QUADRUPED_BEHAVIORS, QUADRUPED_PACE_RATIOS,
  createQuadrupedState, applyQuadrupedAnimal, applyQuadrupedBehavior,
  quadrupedScoreTiming, quadrupedClockAtPosition, quadrupedPositionAtClock,
  quadrupedStepDurationSeconds, quadrupedSupportSnapshot, quadrupedFootCycleState,
  quadrupedFlightTrajectory, deriveQuadrupedPose, sanitizeQuadrupedState,
} from "../src/quadruped.js";
import { createQuadrupedMotorState, advanceQuadrupedMotor, synchronizeQuadrupedMotorTempo } from "../src/quadruped-motor.js";

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("weighted cabinet-card time is invertible at every pace across loop boundaries", () => {
  for (const { id } of QUADRUPED_BEHAVIORS) {
    for (const paceRatio of QUADRUPED_PACE_RATIOS) {
      const state = { ...createQuadrupedState("cat", id), paceRatio, suspensionBeats: 5 };
      const timing = quadrupedScoreTiming(state);
      near(timing.beats, 1 / paceRatio + (timing.window ? 5 : 0));
      for (const position of [-32.25, -16, -0.1, 0, 3.95, 4, 7.35, 13.999, 16, 48.4]) {
        near(quadrupedPositionAtClock(state, quadrupedClockAtPosition(state, position)), position);
      }
      near(timing.durations.reduce((sum, value, frame) => sum + quadrupedStepDurationSeconds(state, frame), 0), timing.beats * 60 / state.tempoBpm);
    }
  }
});

test("½×, 1×, 2×, and 3× are exact ratios independent of the animal", () => {
  for (const { id } of QUADRUPED_ANIMALS) {
    for (const paceRatio of QUADRUPED_PACE_RATIOS) {
      const state = { ...createQuadrupedState(id, "walk"), tempoBpm: 120, paceRatio };
      const initial = createQuadrupedMotorState(state);
      const result = advanceQuadrupedMotor(state, initial, 0.5);
      near(result.motor.position, 16 * paceRatio);
      near(result.motor.velocity, 32 * paceRatio);
      assert.equal(result.events.length, Math.floor(16 * paceRatio));
    }
  }
});

test("a five-beat leap extension is a continuous unsupported rest, followed by exactly timed landing", () => {
  for (const behaviorId of ["leap", "walk-leap", "run-leap"]) {
    const state = { ...createQuadrupedState("cat", behaviorId), tempoBpm: 60, suspensionBeats: 5 };
    const [start, end] = quadrupedScoreTiming(state).window;
    const startClock = quadrupedClockAtPosition(state, start);
    const duration = (quadrupedClockAtPosition(state, end) - startClock) / 16;
    near(duration, 5 + (end - start) / 16);
    let motor = createQuadrupedMotorState(state, { position: start });
    for (let elapsed = 0; elapsed < 5; elapsed += 0.125) {
      const result = advanceQuadrupedMotor(state, motor, 0.125);
      motor = result.motor;
      assert.equal(motor.supportCount, 0);
      assert.equal(motor.airborne, true);
      assert.ok(motor.height > 0);
      assert.ok(!result.transitions.some(({ type }) => ["landing", "load", "push"].includes(type)));
      for (const { frame } of result.events) {
        assert.ok(Object.values(state.pattern).every(lane => lane[frame] === 0));
      }
    }
    near(quadrupedClockAtPosition(state, motor.position), startClock + 80);
    const result = advanceQuadrupedMotor(state, motor, duration - 5 + 0.02);
    const landing = result.transitions.find(({ type }) => type === "landing");
    assert.ok(landing, behaviorId + " must land");
    near(landing.offsetSeconds, duration - 5, 0.003);
    assert.ok(result.motor.supportCount > 0);
    near(result.motor.height, 0);
  }
});

test("a long skid spends its extra beats on the belly without feet, flight, or landing attacks", () => {
  const state = { ...createQuadrupedState("cat", "skid"), tempoBpm: 60, suspensionBeats: 6 };
  let motor = createQuadrupedMotorState(state, { position: 3 });
  for (let i = 0; i < 32; i += 1) {
    const result = advanceQuadrupedMotor(state, motor, 0.125);
    motor = result.motor;
    const pose = deriveQuadrupedPose(state, motor.position, motor);
    assert.equal(pose.bodySlide, 1);
    assert.equal(motor.supportCount, 0);
    assert.equal(motor.airborne, false);
    assert.equal(motor.height, 0);
    assert.equal(result.transitions.length, 0);
    assert.ok(result.events.every(({ frame }) => Object.values(state.pattern).every(lane => lane[frame] === 0)));
  }
});

test("live BPM, pace, and air-length edits preserve card phase and retime immediately", () => {
  const original = { ...createQuadrupedState("mouse", "leap"), tempoBpm: 60, suspensionBeats: 4 };
  const motor = createQuadrupedMotorState(original, { position: 6.5 });
  for (const settings of [{ tempoBpm: 180 }, { paceRatio: 3 }, { suspensionBeats: 8 }]) {
    const state = { ...original, ...settings };
    const synced = synchronizeQuadrupedMotorTempo(state, motor);
    near(synced.position, motor.position);
    near(synced.velocity, state.tempoBpm * 16 / 60 / quadrupedScoreTiming(state).durations[6]);
    const result = advanceQuadrupedMotor(state, synced, 0.125);
    near(quadrupedClockAtPosition(state, result.motor.position) - quadrupedClockAtPosition(state, synced.position), state.tempoBpm * 16 / 60 * 0.125);
  }
});

test("changing creatures preserves the chosen gait, edits, pace, and extra rests", () => {
  const state = { ...createQuadrupedState("mouse", "walk-leap"), paceRatio: 0.5, suspensionBeats: 7, tempoBpm: 141, customized: true };
  state.pattern["front-left"][1] = 0.45;
  for (const { id } of QUADRUPED_ANIMALS) {
    const next = applyQuadrupedAnimal(state, id);
    assert.equal(next.behaviorId, state.behaviorId);
    assert.deepEqual(next.pattern, state.pattern);
    assert.equal(next.paceRatio, 0.5);
    assert.equal(next.suspensionBeats, 7);
    assert.equal(next.tempoBpm, 141);
  }
  const next = applyQuadrupedBehavior(state, "cartwheel");
  assert.equal(next.paceRatio, 0.5);
  assert.equal(next.suspensionBeats, 7);
});

test("upstairs shifts load and push rearward; downstairs shifts braking support forward", () => {
  const base = createQuadrupedState("cat", "walk");
  const footAtMidstance = (direction, lane) => {
    const state = { ...base, groundProfileId: direction };
    const start = quadrupedFootCycleState(state, lane, 0);
    return quadrupedFootCycleState(state, lane, start.previousTouchdownPosition + start.stanceDuration * 0.5);
  };
  for (const lane of ["front-left", "rear-right"]) {
    const level = footAtMidstance("level", lane);
    const up = footAtMidstance("stairs-up", lane);
    const down = footAtMidstance("stairs-down", lane);
    if (lane.startsWith("front")) {
      assert.ok(down.load > level.load && level.load > up.load);
      assert.ok(down.stanceDuration > up.stanceDuration);
    } else {
      assert.ok(up.propulsion > level.propulsion && level.propulsion > down.propulsion);
      assert.ok(up.stanceDuration > down.stanceDuration);
    }
  }
});

test("cartwheel and roll have distinct limb poses; invalid timing inputs remain bounded", () => {
  const wheel = deriveQuadrupedPose(createQuadrupedState("cat", "cartwheel"), 8);
  const roll = deriveQuadrupedPose(createQuadrupedState("cat", "forward-roll"), 8);
  assert.ok(wheel.cartwheel > 0 && wheel.rollTuck === 0);
  assert.ok(roll.forwardRoll > 0 && roll.rollTuck > 0);
  const state = sanitizeQuadrupedState({ ...createQuadrupedState(), paceRatio: 999, suspensionBeats: 999 });
  assert.equal(state.paceRatio, 1);
  assert.equal(state.suspensionBeats, 8);
  for (const position of [4.1, 6, 9.9]) {
    const leap = { ...createQuadrupedState("cat", "leap"), suspensionBeats: 8, gravity: 0.55 };
    const arc = quadrupedFlightTrajectory(leap, position, quadrupedSupportSnapshot(leap, position));
    assert.ok(arc && Number.isFinite(arc.height) && arc.height <= 2.1);
  }
});
