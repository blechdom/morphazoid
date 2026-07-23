import assert from "node:assert/strict";
import test from "node:test";

import {
  crossesPeriodicTarget,
  crossesPingPongTarget,
  motionSubsteps,
  rebaseContinuousPosition,
  rebasePingPongPosition,
  spatialEnvelopeTimeRange,
} from "../src/articulation.js";

test("corner crossings work forward, backward, and across cycle wrap", () => {
  assert.equal(crossesPeriodicTarget(0.2, 0.4, 0.3), true);
  assert.equal(crossesPeriodicTarget(0.4, 0.2, 0.3), true);
  assert.equal(crossesPeriodicTarget(0.9, 1.1, 0.05), true);
  assert.equal(crossesPeriodicTarget(1.1, 0.9, 0.05), true);
  assert.equal(crossesPeriodicTarget(0.2, 0.25, 0.3), false);
});

test("starting exactly on a corner does not retrigger until it is crossed again", () => {
  assert.equal(crossesPeriodicTarget(0.3, 0.35, 0.3), false);
  assert.equal(crossesPeriodicTarget(0.35, 0.3, 0.3), true);
});

test("ping-pong crossings work on both legs and at the turnaround", () => {
  assert.equal(crossesPingPongTarget(0.2, 0.4, 0.3), true);
  assert.equal(crossesPingPongTarget(0.4, 0.2, 0.3), true);
  assert.equal(crossesPingPongTarget(1.6, 1.8, 0.3), true);
  assert.equal(crossesPingPongTarget(1.8, 1.6, 0.3), true);
  assert.equal(crossesPingPongTarget(0.9, 1.1, 1), true);
  assert.equal(crossesPingPongTarget(0.2, 0.25, 0.3), false);
});

test("ping-pong crossing follows a moving target", () => {
  assert.equal(crossesPingPongTarget(0.5, 0.5, 0.6, 0.4), true);
  assert.equal(crossesPingPongTarget(0.5, 0.5, 0.6, 0.55), false);
});

test("a rotating vertex can cross a stationary scanner", () => {
  assert.equal(crossesPeriodicTarget(0.5, 0.5, 0.6, 0.4), true);
  assert.equal(crossesPeriodicTarget(0.5, 0.5, 0.6, 0.55), false);
});

test("fast reader and rotation motion is split before crossing detection", () => {
  assert.equal(motionSubsteps(0, 0), 1);
  assert.equal(motionSubsteps(0.12, 0), 5);
  assert.equal(motionSubsteps(0, 12), 6);
  assert.equal(motionSubsteps(0, 72), 36);
  assert.equal(motionSubsteps(1_000, 0), 120);
});

test("rotation substeps expose two near-tangent crossings hidden by frame endpoints", () => {
  const scannerPhase = (0.995 + 1) / 2;
  const steps = motionSubsteps(0, 12);
  let previousTarget = (Math.cos((-6 * Math.PI) / 180) + 1) / 2;
  let crossings = 0;
  for (let step = 1; step <= steps; step += 1) {
    const degrees = -6 + (12 * step) / steps;
    const target = (Math.cos((degrees * Math.PI) / 180) + 1) / 2;
    if (crossesPeriodicTarget(scannerPhase, scannerPhase, previousTarget, target)) crossings += 1;
    previousTarget = target;
  }
  assert.equal(crossings, 2);
});

test("spatial envelope timing reports exact, ranged, doubled, and stopped values", () => {
  assert.deepEqual(spatialEnvelopeTimeRange(0.25, [0.2], 0.05), {
    minimumMs: 1000,
    maximumMs: 1000,
  });
  assert.deepEqual(spatialEnvelopeTimeRange(0.25, [0.2, 0.4], 0.05), {
    minimumMs: 1000,
    maximumMs: 2000,
  });
  assert.deepEqual(spatialEnvelopeTimeRange(1, [0.2, 0.4], 0.05), {
    minimumMs: 4000,
    maximumMs: 8000,
  }, "a full Segment ramp follows each edge's actual traversal time");
  assert.deepEqual(spatialEnvelopeTimeRange(0.25, [1], 0.05, 2), {
    minimumMs: 2500,
    maximumMs: 2500,
  });
  assert.equal(spatialEnvelopeTimeRange(0.5, [0.25], 0), null);
  assert.equal(spatialEnvelopeTimeRange(0.5, [], 0.1), null);
  assert.deepEqual(spatialEnvelopeTimeRange(2, [0.25], 0.1), {
    minimumMs: 2500,
    maximumMs: 2500,
  });
});

test("manual scrubbing preserves completed forward and reverse cycles", () => {
  assert.equal(rebaseContinuousPosition(12.2, 0.2, 0.7), 12.7);
  assert.equal(rebaseContinuousPosition(-4.2, 0.8, 0.1), -4.9);
});

test("ping-pong scrubbing preserves the current travel leg", () => {
  assert.equal(rebasePingPongPosition(12.2, 0.7), 12.7);
  assert.equal(rebasePingPongPosition(13.8, 0.7), 13.3);
  assert.ok(Math.abs(rebasePingPongPosition(-4.2, 0.1) - (-4.1)) < 1e-12);
});
