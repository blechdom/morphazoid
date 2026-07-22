import assert from "node:assert/strict";
import test from "node:test";
import { generateJuliaBoundary } from "../src/julia.js";
import {
  buildInverseArcFamily,
  buildInverseArcTree,
  comparePitchSignals,
  criticalOrbitStatus,
  evaluateSimilarityPlans,
  findRepellingPeriodicPoints,
  forwardJuliaArc,
  inverseJuliaArc,
  minimumAuditionDuration,
  pitchSignalForArc,
  sampleBoundaryArc,
  rateLimitedTemporalPitchFidelity,
  temporalPitchFidelity,
} from "../src/julia-similarity.js";

test("the critical orbit diagnoses the cap-sensitive Spiral preset", () => {
  const spiral = criticalOrbitStatus(-0.7, 0.27015, 200);
  const basilica = criticalOrbitStatus(-1, 0, 200);
  const siegelLike = criticalOrbitStatus(-0.391, -0.587, 65_536);
  assert.equal(spiral.bounded, false);
  assert.equal(spiral.escapeIteration, 96);
  assert.equal(basilica.escaped, false);
  assert.equal(basilica.bounded, null);
  assert.equal(siegelLike.escaped, true);
});

test("repelling cycles predict the Spiral zoom and rotation multipliers", () => {
  const points = findRepellingPeriodicPoints(-0.7, 0.27015, { maxPeriod: 2 });
  const fixed = points.find((point) => point.period === 1 && point.magnification > 2);
  const periodTwo = points.find((point) => point.period === 2);
  assert.ok(fixed);
  assert.ok(Math.abs(fixed.magnification - 2.9812461664) < 1e-6);
  assert.ok(periodTwo);
  assert.ok(Math.abs(periodTwo.magnification - 1.6148363261) < 1e-6);
  assert.ok(Math.abs(periodTwo.rotation - 0.7330912762) < 1e-6);
});

test("continuous inverse branches land on exact Julia preimages", () => {
  const parent = Array.from({ length: 64 }, (_value, index) => ({
    x: -0.7 + index / 63 * 0.4,
    y: 0.18 + Math.sin(index / 63 * Math.PI) * 0.08,
  }));
  for (const branch of [-1, 1]) {
    const child = inverseJuliaArc(parent, -0.123, 0.745, branch);
    const recovered = forwardJuliaArc(child, -0.123, 0.745);
    assert.equal(recovered.length, parent.length);
    for (let index = 0; index < parent.length; index += 1) {
      assert.ok(Math.hypot(
        recovered[index].x - parent[index].x,
        recovered[index].y - parent[index].y,
      ) < 1e-10);
    }
  }
  const tree = buildInverseArcTree(parent, {
    cReal: -0.123,
    cImag: 0.745,
    depth: 3,
    samples: 64,
  });
  assert.deepEqual(tree.levels.map((level) => level.length), [1, 2, 4, 8]);
});

test("tangent pitch retains a shape under translation, rotation, scale, and tempo", () => {
  const source = Array.from({ length: 180 }, (_value, index) => {
    const amount = index / 179;
    return {
      x: amount * 2,
      y: Math.sin(amount * Math.PI * 3) * 0.23 + Math.sin(amount * Math.PI * 7) * 0.04,
    };
  });
  const angle = 0.83;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const transformed = source.map((point) => ({
    x: 3.4 + 0.17 * (point.x * cosine - point.y * sine),
    y: -1.2 + 0.17 * (point.x * sine + point.y * cosine),
  }));
  const reference = pitchSignalForArc(source);
  const candidate = pitchSignalForArc(transformed);
  const comparison = comparePitchSignals(reference, candidate);
  assert.ok(comparison.pitchCorrelation > 0.9999);
  assert.ok(comparison.intervalCorrelation > 0.999);
  assert.ok(comparison.circularRmse < 1e-4);
  assert.ok(temporalPitchFidelity(reference, 0.5).pitchCorrelation > 0.9);
  assert.ok(temporalPitchFidelity(reference, 2).pitchCorrelation > 0.99);
  const fourOctaveSignal = {
    pitches: Float64Array.from(reference.pitches, (pitch) => pitch * 4),
  };
  const fast = rateLimitedTemporalPitchFidelity(fourOctaveSignal, 0.5);
  const slow = rateLimitedTemporalPitchFidelity(fourOctaveSignal, 8);
  assert.ok(fast.limitedFraction > slow.limitedFraction);
  assert.ok(fast.pitchCorrelation < slow.pitchCorrelation);
  assert.ok(minimumAuditionDuration(reference) > 0);
});

test("five plan proxies and sanity checks run on a real Rabbit inverse-image family", () => {
  const generated = generateJuliaBoundary({
    cReal: -0.123,
    cImag: 0.745,
    resolution: 256,
    maxIterations: 128,
    simplifyTolerance: 0.35,
  });
  const parent = sampleBoundaryArc(generated.boundary, generated.field, {
    centerPhase: 0.5,
    fraction: 0.025,
    samples: 512,
  });
  const family = buildInverseArcFamily(parent, {
    cReal: -0.123,
    cImag: 0.745,
    depth: 3,
  });
  assert.equal(family.levels.length, 4);
  assert.ok(family.levels.slice(1).every((level) => level.comparison.pitchCorrelation > 0.98));
  assert.ok(family.levels.slice(1).every((level) => level.comparison.circularRmse < 0.05));

  const plans = evaluateSimilarityPlans(family);
  assert.ok(plans.chorus.score > 0.95);
  assert.ok(plans.canon.score > 0.9);
  assert.ok(plans.wavelet.score > 0.8);
  assert.ok(plans.orbit.score > 0.98);
  assert.equal(plans.orbit.shapeBearing, "arc-only");
  assert.equal(plans.harmony.shapeBearing, false);
});
