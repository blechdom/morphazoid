import test from "node:test";
import assert from "node:assert/strict";
import {
  QUADRUPED_ANIMALS, QUADRUPED_BEHAVIORS, QUADRUPED_FOOT_LANES, QUADRUPED_LIMITS,
  createQuadrupedContactSampler, quadrupedSupportSnapshot,
  createQuadrupedState, sanitizeQuadrupedState, applyQuadrupedAnimal, applyQuadrupedBehavior,
  quadrupedClockAtPosition, quadrupedPositionAtClock, quadrupedScoreTiming,
  quadrupedFootCycleState, quadrupedFlightTrajectory, quadrupedSequenceEvent,
  deriveQuadrupedPose, clearQuadrupedPattern,
} from "../src/instruments/quadruped/quadruped.js";
import {
  createQuadrupedMotorState, advanceQuadrupedMotor, advanceQuadrupedMotorState, predictQuadrupedMotor,
  quadrupedMotorSnapshot, synchronizeQuadrupedMotorTempo, QUADRUPED_MOTOR_LIMITS,
} from "../src/instruments/quadruped/quadruped-motor.js";
import { createQuadrupedTravel, changeQuadrupedTravel, quadrupedWorldAtPosition } from "../src/instruments/quadruped/quadruped-travel.js";

const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const actor = changes => sanitizeQuadrupedState({ ...createQuadrupedState("horse", "walk"), ...changes });
const finiteTree = value => {
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  else if (value && typeof value === "object") Object.values(value).forEach(finiteTree);
};

test("expanded motion state migrates old actors and retains expressive endpoints through animal/gait edits", () => {
  const old = { ...createQuadrupedState(), version: 8 };
  delete old.lopsided; delete old.spring; delete old.pitchSemitones;
  const migrated = sanitizeQuadrupedState(old);
  assert.equal(migrated.version, 9);
  assert.equal(migrated.lopsided, 0);
  assert.equal(migrated.spring, 1);
  assert.equal(migrated.pitchSemitones, 0);
  for (const end of [0, 1]) {
    const values = Object.fromEntries(["tempoBpm", "stride", "momentum", "gravity", "lopsided", "spring", "pitchSemitones"]
      .map(key => [key, QUADRUPED_LIMITS[key][end]]));
    const score = actor(values);
    for (const [key, value] of Object.entries(values)) assert.equal(score[key], value);
    for (const next of [applyQuadrupedAnimal(score, "cat"), applyQuadrupedBehavior(score, "trot")]) {
      for (const key of ["lopsided", "spring", "pitchSemitones"]) assert.equal(next[key], score[key]);
    }
  }
  finiteTree(sanitizeQuadrupedState({ lopsided: NaN, spring: Infinity, pitchSemitones: -Infinity }));
});

test("lopsided timing changes the push and pause within a beat while keeping a monotonic invertible master clock", () => {
  for (const lopsided of [-1, 0, 1]) for (const paceRatio of [0.5, 1, 3]) {
    const score = actor({ lopsided, paceRatio, behaviorId: "leap", suspensionBeats: 6 });
    const timing = quadrupedScoreTiming(score);
    near(timing.beats, 1 / paceRatio + 6);
    assert.ok(timing.durations.every(value => value >= QUADRUPED_LIMITS.minimumTimingWeight / paceRatio));
    if (lopsided) assert.notEqual(timing.durations[0], timing.durations[15]);
    let clock = -Infinity;
    for (let position = -17; position < 34; position += 0.13) {
      const next = quadrupedClockAtPosition(score, position);
      assert.ok(next > clock);
      near(quadrupedPositionAtClock(score, next), position);
      clock = next;
    }
  }
});

test("lopsided sound accents, planted support and rendered lift share the same side bias", () => {
  const score = actor({ lopsided: 1 });
  for (const row of Object.values(score.pattern)) { row.fill(0); row[0] = 0.5; }
  const other = { ...score, lopsided: -1 };
  const event = quadrupedSequenceEvent(score, 0);
  const opposite = quadrupedSequenceEvent(other, 0);
  const intensity = (value, id) => value.contacts.find(contact => contact.id === id).intensity;
  assert.ok(intensity(event, "front-left") > intensity(event, "front-right"));
  assert.ok(intensity(opposite, "front-left") < intensity(opposite, "front-right"));
  const left = quadrupedFootCycleState(score, "front-left", 0);
  const right = quadrupedFootCycleState(score, "front-right", 0);
  near(left.intensity, intensity(event, "front-left"));
  assert.ok(left.stanceDuration > right.stanceDuration);
  const pose = deriveQuadrupedPose(score, 12);
  assert.notEqual(pose.bodyRoll, deriveQuadrupedPose(other, 12).bodyRoll);
  for (const { id } of QUADRUPED_FOOT_LANES) {
    const start = quadrupedFootCycleState(score, id, 0);
    for (const progress of [0.15, 0.5, 0.9]) {
      const foot = quadrupedFootCycleState(score, id, start.stanceDuration * progress);
      assert.ok(foot.grounded);
      near(foot.footWorldX, start.anchorWorldX);
      near(foot.footWorldY, start.anchorWorldY);
      assert.equal(deriveQuadrupedPose(score, start.stanceDuration * progress).legs[id].lift, 0);
    }
  }
});

test("Spring increases clearance, bounce and visible flight without moving planted feet or musical touchdown time", () => {
  const base = createQuadrupedState("cat", "leap");
  const low = { ...base, spring: 0.2 };
  const high = { ...base, spring: 2.5 };
  const lane = "front-left";
  const cycle = quadrupedFootCycleState(low, lane, 1);
  const midSwing = (cycle.previousTouchdownPosition + cycle.stanceDuration + cycle.nextTouchdownPosition) / 2;
  assert.ok(quadrupedFootCycleState(high, lane, midSwing).lift > quadrupedFootCycleState(low, lane, midSwing).lift * 2);
  const small = quadrupedFlightTrajectory(low, 6);
  const large = quadrupedFlightTrajectory(high, 6);
  assert.ok(large.height > small.height);
  near(large.start, small.start); near(large.end, small.end); near(large.duration, small.duration);
  assert.ok(deriveQuadrupedPose(high, 6).bodyLift > deriveQuadrupedPose(low, 6).bodyLift);
  assert.deepEqual(quadrupedFootCycleState(high, lane, cycle.previousTouchdownPosition), quadrupedFootCycleState(low, lane, cycle.previousTouchdownPosition));
});

test("Momentum shapes active pushes and posture immediately and its extended endpoints change empty-score coasting", () => {
  const low = actor({ momentum: 0.12 });
  const high = actor({ momentum: 3 });
  assert.ok(quadrupedFootCycleState(high, "front-left", 0).stanceDuration < quadrupedFootCycleState(low, "front-left", 0).stanceDuration);
  assert.notEqual(deriveQuadrupedPose(high, 3).bodyPitch, deriveQuadrupedPose(low, 3).bodyPitch);
  assert.notEqual(quadrupedSequenceEvent(high, 0).footEnergy, quadrupedSequenceEvent(low, 0).footEnergy);
  const coast = score => {
    const empty = clearQuadrupedPattern(score);
    return advanceQuadrupedMotor(empty, createQuadrupedMotorState(empty, { velocity: 4 }), 2);
  };
  const slow = coast(low); const fast = coast(high);
  assert.equal(slow.motor.velocity, 0);
  assert.ok(fast.motor.velocity > 0);
  assert.ok(fast.motor.position > slow.motor.position * 4);
  const stopped = advanceQuadrupedMotor(clearQuadrupedPattern(high), createQuadrupedMotorState(high), 0);
  assert.equal(stopped.motor.position, 0);
  assert.equal(stopped.events.length, 0);
});

test("extended stride survives signed travel and live reversal preserves planted anchors", () => {
  for (const stride of [0.15, 2.4]) {
    const score = actor({ stride, lopsided: 1, spring: 2.5 });
    const worldTravel = createQuadrupedTravel({ stride });
    const before = { ...score, worldTravel };
    near(quadrupedWorldAtPosition(before, 16), stride);
    const feet = Object.fromEntries(QUADRUPED_FOOT_LANES.map(({ id }) => [id, quadrupedFootCycleState(before, id, 3)]));
    const next = { ...score, worldTravel: changeQuadrupedTravel(worldTravel, { position: 3, stride, direction: -1, feet }) };
    near(quadrupedWorldAtPosition(next, 3), quadrupedWorldAtPosition(before, 3));
    near(quadrupedWorldAtPosition(next, 19), quadrupedWorldAtPosition(before, 3) - stride);
    for (const { id } of QUADRUPED_FOOT_LANES) {
      near(quadrupedFootCycleState(next, id, 3).footWorldX, feet[id].footWorldX);
    }
  }
});

test("the fastest dense lopsided score retains every crossing and stance accent inside live scheduling windows", () => {
  for (const horizon of [0.09, 0.125, QUADRUPED_LIMITS.schedulerLookaheadSeconds]) for (const lopsided of [-1, 1]) for (const momentum of [0.12, 3]) {
    const score = actor({ tempoBpm: 1000, paceRatio: 3, lopsided, momentum, spring: 2.5 });
    for (const row of Object.values(score.pattern)) row.fill(1);
    const initial = synchronizeQuadrupedMotorTempo(score, createQuadrupedMotorState(score, { position: 11 }));
    const result = predictQuadrupedMotor(score, initial, horizon);
    assert.equal(result.droppedEvents, 0);
    assert.equal(result.droppedTransitions, 0);
    near(quadrupedClockAtPosition(score, result.motor.position) - quadrupedClockAtPosition(score, initial.position), 1000 * 16 / 60 * (horizon - result.motor.remainderSeconds));
    assert.ok(result.motor.velocity <= QUADRUPED_MOTOR_LIMITS.maxVelocity);
    assert.deepEqual(result.events.map(event => event.ordinal), Array.from({ length: Math.floor(result.motor.position + 1e-8) - 11 }, (_, i) => i + 12));
    const accents = result.transitions.filter(event => ["load", "push", "toe-off"].includes(event.type));
    assert.equal(new Set(accents.map(event => event.eventId)).size, accents.length);
    for (const { id } of QUADRUPED_FOOT_LANES) for (let ordinal = 11; ordinal < result.motor.position; ordinal += 1) {
      const leg = quadrupedFootCycleState(score, id, ordinal);
      for (const [type, phase] of [["load", 0.28], ["push", 0.72], ["toe-off", 1]]) {
        const position = ordinal + leg.stanceDuration * phase;
        if (position > result.motor.position + 1e-8) continue;
        const event = accents.find(value => value.eventId === `${leg.eventId}:${type}`);
        assert.ok(event, `${id} at ${ordinal} missing ${type}`);
        near(event.position, position);
        near(event.offsetSeconds, (quadrupedClockAtPosition(score, position) - quadrupedClockAtPosition(score, 11)) / (1000 * 16 / 60), 0.000002);
      }
    }
    const flightIds = result.transitions.filter(event => event.type === "landing").map(event => event.eventId);
    assert.equal(new Set(flightIds).size, flightIds.length);
    assert.equal(flightIds.length, Math.floor(result.motor.position + 1e-8) - 11);
    finiteTree(result);
  }
});

test("extreme live tempo and skew edits preserve phase, while paused prediction cannot advance", () => {
  let score = actor({ tempoBpm: 10, lopsided: -1, paceRatio: 3 });
  let motor = createQuadrupedMotorState(score, { position: 5.25 });
  for (const settings of [{ tempoBpm: 1000 }, { lopsided: 1 }, { tempoBpm: 10 }, { lopsided: 0 }]) {
    score = { ...score, ...settings };
    const before = motor.position;
    motor = synchronizeQuadrupedMotorTempo(score, motor);
    near(motor.position, before);
    near(quadrupedMotorSnapshot(score, motor).velocity, score.tempoBpm * 16 / 60 / quadrupedScoreTiming(score).durations[5]);
    const paused = predictQuadrupedMotor(score, motor, 0);
    near(paused.motor.position, before);
    assert.equal(paused.events.length, 0);
  }
});

test("all animal poses remain finite across expanded control corners and terrain profiles", () => {
  for (const { id } of QUADRUPED_ANIMALS) for (const lopsided of [-1, 1]) {
    const score = sanitizeQuadrupedState({ ...createQuadrupedState(id, "leap"), lopsided,
      stride: 2.4, momentum: lopsided > 0 ? 3 : 0.12, gravity: lopsided > 0 ? 3 : 0.1,
      spring: 2.5, tempoBpm: 1000, paceRatio: 3, groundProfileId: lopsided > 0 ? "stairs-up" : "stairs-down" });
    for (const position of [0, 0.01, 2.5, 4.7, 8, 12.1, 15.99, 16.1]) {
      const pose = deriveQuadrupedPose(score, position);
      finiteTree(pose);
      assert.ok(pose.bodyLift >= -0.1 && pose.bodyLift <= 1.2);
      for (const { id: lane } of QUADRUPED_FOOT_LANES) {
        assert.ok(pose.legs[lane].lift >= 0 && pose.legs[lane].lift <= 2.8);
        if (pose.legs[lane].grounded) {
          near(pose.legs[lane].footWorldX, pose.legs[lane].anchorWorldX);
          near(pose.legs[lane].footWorldY, pose.legs[lane].anchorWorldY);
        }
      }
    }
  }
});


test("prepared motor contacts exactly follow full support across animals, gaits and expressive extremes", () => {
  for (const { id: animalId } of QUADRUPED_ANIMALS) for (const { id: behaviorId } of QUADRUPED_BEHAVIORS) {
    const scores = [createQuadrupedState(animalId, behaviorId), ...[-1, 1].map(lopsided => ({
      ...createQuadrupedState(animalId, behaviorId), lopsided, momentum: lopsided > 0 ? 3 : 0.12,
      stride: 2.4, spring: 2.5, gravity: 0.1, groundProfileId: lopsided > 0 ? "stairs-up" : "stairs-down",
    }))];
    for (const score of scores) {
      const sample = createQuadrupedContactSampler(score);
      for (const position of [-16.2, 0, 0.08, 3.75, 7.99, 11.3, 15.98, 16.03]) {
        const full = quadrupedSupportSnapshot(score, position), fast = sample(position);
        assert.equal(fast.supportCount, full.supportCount);
        near(fast.supportEnergy, full.supportEnergy);
        near(fast.propulsion, full.propulsion);
        for (const { id } of QUADRUPED_FOOT_LANES) for (const [key, value] of Object.entries(fast.legs[id])) {
          if (typeof value === "number") near(value, full.legs[id][key]);
          else assert.equal(value, full.legs[id][key]);
        }
      }
    }
  }
});


test("state-only materialization is identical to eventful integration through dense extremes, edits and coasting", () => {
  for (const tempoBpm of [10, 96, 1000]) for (const lopsided of [-1, 1]) {
    let score = actor({ tempoBpm, lopsided, paceRatio: 3, momentum: 3, spring: 2.5 });
    for (const row of Object.values(score.pattern)) row.fill(1);
    let full = createQuadrupedMotorState(score, { position: 11 });
    let minimal = full;
    for (const delta of [0, 0.003, 0.02, 0.09, 0.125, 0.23]) {
      full = advanceQuadrupedMotor(score, full, delta).motor;
      minimal = advanceQuadrupedMotorState(score, minimal, delta);
      assert.deepEqual(minimal, full);
    }
    for (const changes of [{ momentum: 0.12 }, { lopsided: -lopsided }, { gravity: 0.1 }, { spring: 0 }]) {
      score = { ...score, ...changes };
      full = advanceQuadrupedMotor(score, full, 0.09).motor;
      minimal = advanceQuadrupedMotorState(score, minimal, 0.09);
      assert.deepEqual(minimal, full);
    }
    score = clearQuadrupedPattern(score);
    full = advanceQuadrupedMotor(score, full, 0.5).motor;
    minimal = advanceQuadrupedMotorState(score, minimal, 0.5);
    assert.deepEqual(minimal, full);
  }
});
