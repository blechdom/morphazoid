import test from "node:test";
import assert from "node:assert/strict";

import {
  QUADRUPED_MOTOR_LIMITS,
  advanceQuadrupedMotor,
  createQuadrupedMotorState,
  kickQuadrupedMotor,
  predictQuadrupedMotor,
  quadrupedMotorSnapshot,
  synchronizeQuadrupedMotorTempo,
} from "../src/quadruped-motor.js";
import {
  clearQuadrupedPattern,
  createQuadrupedState,
  setQuadrupedContact,
} from "../src/quadruped.js";

const FOOT_IDS = ["front-left", "front-right", "rear-left", "rear-right"];

function approximately(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function advanceFor(score, motor, seconds, chunk = 0.25) {
  let current = motor;
  const events = [];
  const transitions = [];
  let remaining = seconds;
  while (remaining > 1e-12) {
    const delta = Math.min(chunk, remaining);
    const result = advanceQuadrupedMotor(score, current, delta);
    current = result.motor;
    events.push(...result.events);
    transitions.push(...result.transitions);
    remaining -= delta;
  }
  return { motor: current, events, transitions };
}

test("foot support starts the sixteen-frame flywheel and crossings carry score frames", () => {
  const score = createQuadrupedState("elephant", "walk");
  const motor = createQuadrupedMotorState(score);
  const result = advanceQuadrupedMotor(score, motor, 1);

  assert.ok(result.motor.position > 0);
  assert.ok(result.motor.velocity > 0);
  assert.ok(result.events.length > 0);
  assert.ok(result.events.every((event, index) => (
    Number.isInteger(event.ordinal)
    && event.frame === ((event.ordinal % 16) + 16) % 16
    && event.offsetSeconds >= 0
    && event.offsetSeconds <= 1
    && (index === 0 || event.ordinal > result.events[index - 1].ordinal)
  )));
  assert.equal(motor.position, 0);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.motor));
  assert.ok(Object.isFrozen(result.events));
  assert.ok(result.events.every(Object.isFrozen));
});

test("a score with no feet cannot start and an unknown tail lane is ignored", () => {
  const cleared = clearQuadrupedPattern(createQuadrupedState("unicorn", "dance"));
  const unchanged = setQuadrupedContact(cleared, "tail", 0, 1);
  const result = advanceQuadrupedMotor(unchanged, createQuadrupedMotorState(unchanged), 2);

  assert.equal(result.motor.position, 0);
  assert.equal(result.motor.velocity, 0);
  assert.equal(result.events.length, 0);
  assert.deepEqual(unchanged.pattern, cleared.pattern);
  assert.equal(quadrupedMotorSnapshot(unchanged, result.motor).stalled, true);
});

test("clearing the feet lets existing momentum coast to an exact stall", () => {
  const score = clearQuadrupedPattern(createQuadrupedState("gazelle", "sprint"));
  const launched = createQuadrupedMotorState(score, { velocity: 22 });
  const coast = advanceFor(score, launched, 20, 2);
  const stoppedAt = coast.motor.position;
  const after = advanceQuadrupedMotor(score, coast.motor, 2).motor;

  assert.ok(stoppedAt > 0);
  assert.equal(coast.motor.velocity, 0);
  assert.equal(coast.motor.stalled, true);
  assert.equal(after.velocity, 0);
  assert.equal(after.position, stoppedAt);
});

test("a default cheetah flywheel settles an empty score inside the live UI window", () => {
  const score = clearQuadrupedPattern(createQuadrupedState("cheetah", "run-leap"));
  const launched = createQuadrupedMotorState(score, { velocity: 22 });
  const coast = advanceFor(score, launched, 12, 1);

  assert.equal(coast.motor.velocity, 0);
  assert.equal(coast.motor.stalled, true);
});

test("touchdown strength shapes impact without bending the global tempo", () => {
  const empty = clearQuadrupedPattern(createQuadrupedState("elephant", "walk"));
  const weak = setQuadrupedContact(empty, "rear-right", 0, 0.25);
  const strong = setQuadrupedContact(empty, "rear-right", 0, 1);
  const weakResult = advanceQuadrupedMotor(weak, createQuadrupedMotorState(weak), 0.3).motor;
  const strongResult = advanceQuadrupedMotor(strong, createQuadrupedMotorState(strong), 0.3).motor;

  approximately(weakResult.velocity, weak.tempoBpm * 16 / 60);
  approximately(strongResult.velocity, strong.tempoBpm * 16 / 60);
  approximately(strongResult.position, weakResult.position);
  assert.ok(strong.pattern["rear-right"][0] > weak.pattern["rear-right"][0]);
});

test("a live tempo change synchronizes immediately and preserves phase", () => {
  const slow = { ...createQuadrupedState("camel", "walk"), tempoBpm: 60 };
  const initial = kickQuadrupedMotor(slow, createQuadrupedMotorState(slow, { position: 5.25 }), 1);
  approximately(initial.velocity, 16);
  const fast = { ...slow, animalId: "cheetah", behaviorId: "sprint", tempoBpm: 180 };
  const synchronized = synchronizeQuadrupedMotorTempo(fast, initial);
  approximately(synchronized.position, 5.25);
  approximately(synchronized.velocity, 48);
  const advanced = advanceQuadrupedMotor(fast, synchronized, 0.25).motor;
  approximately(advanced.position, 17.25);
  approximately(advanced.velocity, 48);
});

test("fixed-step integration is stable across caller chunk sizes", () => {
  const score = createQuadrupedState("unicorn", "gallop");
  const initial = createQuadrupedMotorState(score);
  const single = advanceQuadrupedMotor(score, initial, 1);
  let chunkedMotor = initial;
  const ordinals = [];
  for (let index = 0; index < 120; index += 1) {
    const result = advanceQuadrupedMotor(score, chunkedMotor, 1 / 120);
    chunkedMotor = result.motor;
    ordinals.push(...result.events.map(({ ordinal }) => ordinal));
  }

  approximately(chunkedMotor.position, single.motor.position);
  approximately(chunkedMotor.velocity, single.motor.velocity);
  approximately(chunkedMotor.height, single.motor.height);
  approximately(chunkedMotor.compression, single.motor.compression);
  assert.deepEqual(ordinals, single.events.map(({ ordinal }) => ordinal));
});

test("prediction leaves its input untouched and bounds hostile horizons and state", () => {
  const score = createQuadrupedState("gazelle", "sprint");
  const motor = createQuadrupedMotorState(score, { velocity: 12 });
  const before = { ...motor };
  const result = predictQuadrupedMotor(score, {
    ...motor,
    velocity: Number.POSITIVE_INFINITY,
    height: 999,
    verticalVelocity: Number.NEGATIVE_INFINITY,
    compression: 999,
  }, 1e9);

  assert.deepEqual(motor, before);
  assert.equal(result.advancedSeconds, QUADRUPED_MOTOR_LIMITS.maxAdvanceSeconds);
  assert.ok(result.events.length <= QUADRUPED_MOTOR_LIMITS.maxCrossingEvents);
  assert.ok(result.transitions.length <= QUADRUPED_MOTOR_LIMITS.maxTransitionEvents);
  for (const value of Object.values(result.motor)) {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
  }
  assert.ok(result.motor.velocity >= 0 && result.motor.velocity <= QUADRUPED_MOTOR_LIMITS.maxVelocity);
  assert.ok(result.motor.height >= 0 && result.motor.height <= QUADRUPED_MOTOR_LIMITS.maxHeight);
  assert.ok(result.motor.compression >= 0 && result.motor.compression <= 1);
});

test("flight uses finite gravity and returns through a landing with compression", () => {
  const score = createQuadrupedState("gazelle", "sprint");
  let motor = createQuadrupedMotorState(score);
  let maximumHeight = 0;
  let sawAirborne = false;
  let sawLanding = false;
  let sawCompression = false;

  for (let index = 0; index < 160; index += 1) {
    const result = advanceQuadrupedMotor(score, motor, 1 / 60);
    motor = result.motor;
    maximumHeight = Math.max(maximumHeight, motor.height);
    sawAirborne ||= motor.airborne;
    sawLanding ||= result.transitions.some(({ type }) => type === "landing");
    sawCompression ||= motor.compression > 0;
    for (const value of [motor.height, motor.verticalVelocity, motor.landing, motor.compression]) {
      assert.ok(Number.isFinite(value));
    }
  }

  assert.equal(sawAirborne, true);
  assert.equal(sawLanding, true);
  assert.equal(sawCompression, true);
  assert.ok(maximumHeight > 0 && maximumHeight <= QUADRUPED_MOTOR_LIMITS.maxHeight);
  assert.ok(motor.landingCount > 0);
});

test("all four foot lanes contribute propulsion and there is no fifth contact lane", () => {
  const base = clearQuadrupedPattern(createQuadrupedState("unicorn", "walk"));
  for (const laneId of FOOT_IDS) {
    const score = setQuadrupedContact(base, laneId, 0, 1);
    const result = advanceQuadrupedMotor(score, createQuadrupedMotorState(score), 0.2);
    assert.ok(result.motor.velocity > 0, `${laneId} should propel the motor`);
  }
  const invalid = setQuadrupedContact(base, "tail", 0, 1);
  assert.deepEqual(invalid.pattern, base.pattern);
  assert.equal(advanceQuadrupedMotor(invalid, createQuadrupedMotorState(invalid), 0.2).motor.velocity, 0);
});

test("momentum lengthens a coast and gravity changes a bounded flight arc", () => {
  const empty = clearQuadrupedPattern(createQuadrupedState("gazelle", "sprint"));
  const lightFlywheel = { ...empty, momentum: 0.5 };
  const heavyFlywheel = { ...empty, momentum: 1.4 };
  const initialOptions = { velocity: 18 };
  const light = advanceQuadrupedMotor(lightFlywheel, createQuadrupedMotorState(lightFlywheel, initialOptions), 1).motor;
  const heavy = advanceQuadrupedMotor(heavyFlywheel, createQuadrupedMotorState(heavyFlywheel, initialOptions), 1).motor;
  assert.ok(heavy.velocity > light.velocity);
  assert.ok(heavy.position > light.position);

  const base = createQuadrupedState("gazelle", "sprint");
  const lowGravity = { ...base, gravity: 0.55 };
  const highGravity = { ...base, gravity: 1.55 };
  let low = createQuadrupedMotorState(lowGravity);
  let high = createQuadrupedMotorState(highGravity);
  let lowPeak = 0;
  let highPeak = 0;
  for (let index = 0; index < 80; index += 1) {
    low = advanceQuadrupedMotor(lowGravity, low, 1 / 120).motor;
    high = advanceQuadrupedMotor(highGravity, high, 1 / 120).motor;
    lowPeak = Math.max(lowPeak, low.height);
    highPeak = Math.max(highPeak, high.height);
  }
  assert.ok(lowPeak > highPeak);
  assert.ok(lowPeak <= QUADRUPED_MOTOR_LIMITS.maxHeight);
});

test("all twelve species keep finite physics while sharing the requested sequence rate", () => {
  const base = createQuadrupedState("gazelle", "sprint");
  const velocities = new Map();
  for (const animalId of [
    "elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe",
    "lizard", "horse", "dog", "goat", "rabbit", "camel",
  ]) {
    const score = { ...base, animalId };
    const result = advanceQuadrupedMotor(score, createQuadrupedMotorState(score), 0.5);
    assert.ok(result.motor.velocity > 0);
    assert.ok(Object.values(result.motor).filter((value) => typeof value === "number").every(Number.isFinite));
    velocities.set(animalId, result.motor.velocity);
  }
  for (const velocity of velocities.values()) approximately(velocity, base.tempoBpm * 16 / 60);
  assert.equal(new Set(velocities.values()).size, 1);
});

test("ground contact always reconciles stale ballistic state", () => {
  const score = createQuadrupedState("elephant", "walk");
  const grounded = createQuadrupedMotorState(score, {
    position: 0.5,
    velocity: 8,
    height: 1.8,
    verticalVelocity: -7,
    airborne: true,
    flightId: "stale-flight",
    supportCount: 0,
  });
  assert.ok(grounded.supportCount > 0);
  assert.equal(grounded.height, 0);
  assert.equal(grounded.verticalVelocity, 0);
  assert.equal(grounded.airborne, false);
  assert.equal(grounded.flightId, null);

  let motor = grounded;
  for (let index = 0; index < 600; index += 1) {
    motor = advanceQuadrupedMotor(score, motor, 1 / 120).motor;
    if (motor.supportCount > 0) {
      assert.equal(motor.height, 0);
      assert.equal(motor.verticalVelocity, 0);
      assert.equal(motor.airborne, false);
      assert.equal(motor.flightId, null);
    }
  }
});

test("load and push accents have stable IDs inside their touchdown stance", () => {
  const score = createQuadrupedState("horse", "walk");
  const run = advanceFor(score, createQuadrupedMotorState(score), 3, 0.25);
  const accents = run.transitions.filter(({ type }) => type === "load" || type === "push");
  assert.ok(accents.some(({ type }) => type === "load"));
  assert.ok(accents.some(({ type }) => type === "push"));
  assert.equal(new Set(accents.map(({ eventId }) => eventId)).size, accents.length);
  for (const accent of accents) {
    assert.equal(accent.eventId, `${accent.touchdownId}:${accent.type}`);
    assert.ok(FOOT_IDS.includes(accent.laneId));
    assert.ok(accent.stanceProgress === 0.28 || accent.stanceProgress === 0.72);
  }
});

test("lift-off and landing share one flight ID across exact zero-support intervals", () => {
  const score = createQuadrupedState("gazelle", "sprint");
  const run = advanceFor(score, createQuadrupedMotorState(score), 4, 0.08);
  const liftOffs = run.transitions.filter(({ type }) => type === "lift-off");
  const landings = run.transitions.filter(({ type }) => type === "landing");
  assert.ok(liftOffs.length > 0);
  assert.ok(landings.length > 0);
  const liftIds = new Set(liftOffs.map(({ flightId }) => flightId));
  assert.ok(landings.every(({ flightId }) => typeof flightId === "string" && liftIds.has(flightId)));
  assert.equal(new Set(run.transitions.map(({ eventId }) => eventId)).size, run.transitions.length);
});
