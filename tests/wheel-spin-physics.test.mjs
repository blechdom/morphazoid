import assert from "node:assert/strict";
import test from "node:test";

import {
  WHEEL_SPIN_DEFAULTS,
  WHEEL_SPIN_PHASES,
  canStartWheelSpin,
  createWheelSpinState,
  startWheelSpin,
  stepWheelSpin,
  wheelMouthCrossings,
} from "../src/wheel-of-organs.js";

const TAU = Math.PI * 2;

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
}

test("the unspun wheel is still, silent, and ready only when it has mouths", () => {
  const idle = createWheelSpinState({ mouthCount: 8, rotation: 0.37, seed: 123 });
  assert.equal(idle.phase, WHEEL_SPIN_PHASES.idle);
  assert.equal(idle.rotation, 0.37);
  assert.equal(idle.angularVelocity, 0);
  assert.equal(idle.finalEnvelope, 0);
  assert.equal(idle.locked, false);
  assert.equal(idle.canSpin, true);
  assert.equal(canStartWheelSpin(idle), true);
  assert.equal(Object.isFrozen(WHEEL_SPIN_PHASES), true);
  assert.equal(Object.isFrozen(WHEEL_SPIN_DEFAULTS), true);

  const unchanged = stepWheelSpin(idle, 30);
  assert.equal(unchanged.state, idle);
  assert.deepEqual(unchanged.events, []);

  const empty = createWheelSpinState({ mouthCount: 0 });
  assert.equal(empty.canSpin, false);
  assert.equal(canStartWheelSpin(empty), false);
  assert.equal(startWheelSpin(empty).phase, WHEEL_SPIN_PHASES.idle);
});

test("reader events occur only as a mouth crosses the three-o'clock ray", () => {
  assert.deepEqual(wheelMouthCrossings(-0.1, -0.01, 4), []);
  const clockwise = wheelMouthCrossings(-0.1, 0.1, 4);
  assert.equal(clockwise.length, 1);
  assert.deepEqual(clockwise[0], {
    type: "mouth-crossing",
    mouthIndex: 0,
    crossingRotation: 0,
    readerAngle: 0,
    direction: 1,
  });
  assert.equal(
    wheelMouthCrossings(0, 0.1, 4).length,
    0,
    "a mouth already on the reader is not retriggered without another crossing",
  );

  const counterclockwise = wheelMouthCrossings(0.1, -0.1, 4);
  assert.equal(counterclockwise.length, 1);
  assert.equal(counterclockwise[0].mouthIndex, 0);
  assert.equal(counterclockwise[0].direction, -1);

  const many = wheelMouthCrossings(-0.2, TAU + 0.2, 5);
  assert.equal(many.length, 6);
  for (const event of many) {
    const mouthAngle = event.crossingRotation + event.mouthIndex * TAU / 5;
    close(mouthAngle / TAU, Math.round(mouthAngle / TAU));
  }
  assert.deepEqual(wheelMouthCrossings(0, TAU, 0), []);
});

test("a spin accelerates, coasts, then physically brakes across many turns", () => {
  const started = startWheelSpin(createWheelSpinState({ mouthCount: 8 }), {
    targetMouthIndex: 3,
    turns: 6,
    accelerationSeconds: 1,
    coastSeconds: 1,
    decelerationSeconds: 2,
  });
  assert.equal(started.phase, WHEEL_SPIN_PHASES.accelerating);
  assert.equal(started.targetMouthIndex, 3);
  assert.ok(started.travelRadians >= TAU * 6);
  assert.equal(started.angularVelocity, 0);
  assert.equal(started.locked, true);
  assert.equal(started.canSpin, false);

  const accelerating = stepWheelSpin(started, 0.5).state;
  assert.equal(accelerating.phase, WHEEL_SPIN_PHASES.accelerating);
  close(accelerating.angularVelocity, started.peakAngularVelocity * 0.5);

  const coasting = stepWheelSpin(accelerating, 0.5).state;
  assert.equal(coasting.phase, WHEEL_SPIN_PHASES.coasting);
  close(coasting.angularVelocity, started.peakAngularVelocity);

  const brakingStart = stepWheelSpin(coasting, 1).state;
  assert.equal(brakingStart.phase, WHEEL_SPIN_PHASES.decelerating);
  close(brakingStart.angularVelocity, started.peakAngularVelocity);

  const braking = stepWheelSpin(brakingStart, 1).state;
  assert.equal(braking.phase, WHEEL_SPIN_PHASES.decelerating);
  close(braking.angularVelocity, started.peakAngularVelocity * 0.5);
  assert.ok(
    started.rotation < accelerating.rotation
      && accelerating.rotation < coasting.rotation
      && coasting.rotation < brakingStart.rotation
      && brakingStart.rotation < braking.rotation,
  );
});

test("analytic stepping is deterministic and fixed-step independent", () => {
  const options = {
    targetMouthIndex: 6,
    turns: 7,
    accelerationSeconds: 0.8,
    coastSeconds: 1.3,
    decelerationSeconds: 3.7,
  };
  const first = startWheelSpin(createWheelSpinState({ mouthCount: 9, seed: 77 }), options);
  const repeated = startWheelSpin(createWheelSpinState({ mouthCount: 9, seed: 77 }), options);
  assert.equal(first.targetRotation, repeated.targetRotation);
  assert.equal(first.peakAngularVelocity, repeated.peakAngularVelocity);

  const single = stepWheelSpin(first, first.motionDurationSeconds);
  let fixed = repeated;
  const fixedEvents = [];
  while (fixed.elapsedSeconds < fixed.motionDurationSeconds) {
    const remaining = fixed.motionDurationSeconds - fixed.elapsedSeconds;
    const advanced = stepWheelSpin(
      fixed,
      Math.min(WHEEL_SPIN_DEFAULTS.fixedStepSeconds, remaining),
    );
    fixed = advanced.state;
    fixedEvents.push(...advanced.events);
  }

  close(fixed.rotation, single.state.rotation, 1e-8);
  close(fixed.angularVelocity, single.state.angularVelocity, 1e-10);
  assert.equal(fixed.phase, WHEEL_SPIN_PHASES.sustaining);
  assert.deepEqual(
    fixedEvents.map(({ mouthIndex }) => mouthIndex),
    single.events.map(({ mouthIndex }) => mouthIndex),
  );
  assert.equal(single.events.length > 9 * 6, true);
  assert.equal(single.events.filter(({ isFinal }) => isFinal).length, 1);
  assert.equal(single.events.at(-1).mouthIndex, first.targetMouthIndex);
  assert.equal(single.events.at(-1).isFinal, true);
  assert.equal(single.events.at(-1).sustainSeconds, first.sustainSeconds);
  assert.equal(single.events.at(-1).decaySeconds, first.decaySeconds);
  for (const event of single.events) {
    const mouthAngle = event.crossingRotation + event.mouthIndex * TAU / 9;
    close(mouthAngle / TAU, Math.round(mouthAngle / TAU), 1e-8);
  }
});

test("ordinary 50 ms animation frames still emit exactly one final reader hit", () => {
  let spin = startWheelSpin(createWheelSpinState({ mouthCount: 8 }), {
    targetMouthIndex: 5,
    turns: 6,
  });
  const events = [];
  while (spin.elapsedSeconds < spin.motionDurationSeconds) {
    const advanced = stepWheelSpin(spin, 0.05);
    spin = advanced.state;
    events.push(...advanced.events);
  }
  const finals = events.filter(({ isFinal }) => isFinal);
  assert.equal(finals.length, 1);
  assert.equal(finals[0].mouthIndex, 5);
  assert.equal(spin.phase, WHEEL_SPIN_PHASES.sustaining);
});

test("the landing organ sustains, decays, and keeps the wheel locked through cooldown", () => {
  const started = startWheelSpin(createWheelSpinState({ mouthCount: 6 }), {
    targetMouthIndex: 4,
    turns: 5,
    accelerationSeconds: 0.5,
    coastSeconds: 0.5,
    decelerationSeconds: 1,
    sustainSeconds: 1.2,
    decaySeconds: 2,
    cooldownSeconds: 0.8,
  });
  const landed = stepWheelSpin(started, started.motionDurationSeconds).state;
  assert.equal(landed.phase, WHEEL_SPIN_PHASES.sustaining);
  assert.equal(landed.angularVelocity, 0);
  assert.equal(landed.rotation, landed.targetRotation);
  assert.equal(landed.finalMouthIndex, 4);
  assert.equal(landed.finalEnvelope, 1);
  assert.equal(landed.locked, true);
  assert.equal(canStartWheelSpin(landed), false);
  assert.equal(startWheelSpin(landed), landed, "a locked spin cannot be restarted");

  const held = stepWheelSpin(landed, 0.6).state;
  assert.equal(held.phase, WHEEL_SPIN_PHASES.sustaining);
  assert.equal(held.finalEnvelope, 1);
  close(held.sustainRemainingSeconds, 0.6);

  const halfDecayed = stepWheelSpin(held, 1.6).state;
  assert.equal(halfDecayed.phase, WHEEL_SPIN_PHASES.decaying);
  close(halfDecayed.finalEnvelope, 0.5);
  close(halfDecayed.decayRemainingSeconds, 1);

  const cooling = stepWheelSpin(halfDecayed, 1).state;
  assert.equal(cooling.phase, WHEEL_SPIN_PHASES.cooldown);
  assert.equal(cooling.finalEnvelope, 0);
  assert.equal(cooling.locked, true);
  close(cooling.cooldownRemainingSeconds, 0.8);

  const ready = stepWheelSpin(cooling, 0.8).state;
  assert.equal(ready.phase, WHEEL_SPIN_PHASES.idle);
  assert.equal(ready.finalEnvelope, 0);
  assert.equal(ready.finalMouthIndex, 4);
  assert.equal(ready.locked, false);
  assert.equal(ready.canSpin, true);
  assert.equal(startWheelSpin(ready).phase, WHEEL_SPIN_PHASES.accelerating);
});
