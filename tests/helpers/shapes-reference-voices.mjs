import assert from "node:assert/strict";

// Geometry, trigonometry, interpolation and timbre mapping accumulate error;
// a fixed single-operation ULP allowance is too tight for the resulting voices.
// The same source on Node 22/26 reproduced the AWS differences, including a
// 3.51e-15 scaled modulation-index delta over the 122 saved cases / 904 voices.
// This test-only budget is 1e-12 absolute near zero or 1e-12 relative at scale.
// At 20 kHz the frequency allowance is 2e-8 Hz. Do not round the fixture or DSP.
const computedFields = new Set([
  "frequency", "gain", "pan", "synthDrive", "modulationIndex",
  "shepardRate", "shepardPosition", "shepardTravel",
]);
export const REFERENCE_ABSOLUTE_TOLERANCE = 1e-12;
export const REFERENCE_RELATIVE_TOLERANCE = 1e-12;

export function assertReferenceVoices(actual, expected, label) {
  assert.ok(Array.isArray(actual) && Array.isArray(expected), `${label}: voice arrays`);
  assert.equal(actual.length, expected.length, `${label}: voice count`);
  const failures = [];
  for (const [index, reference] of expected.entries()) {
    const voice = actual[index];
    const context = `${label}: voice[${index}]`;
    assert.ok(voice && typeof voice === "object" && !Array.isArray(voice), context);
    assert.deepEqual(Object.keys(voice).sort(), Object.keys(reference).sort(), `${context}: fields`);
    for (const key of Object.keys(reference)) {
      const value = voice[key], target = reference[key];
      const field = `${context}.${key}`;
      if (!computedFields.has(key) || typeof target !== "number") {
        // Modes, ratios, widths, smoothing times, nulls and schema stay exact.
        try {
          assert.deepEqual(value, target, field);
        } catch (error) {
          failures.push(error.message);
        }
        continue;
      }
      if (!Number.isFinite(value) || !Number.isFinite(target)) {
        failures.push(`${field}: finite numbers required (${value} vs ${target})`);
        continue;
      }
      if (key === "gain" && (value === 0 || target === 0)) {
        // Rounding tolerance must never hide a silence/non-silence regression.
        if (value !== target) failures.push(`${field}: silence must remain exactly zero`);
        continue;
      }
      const tolerance = Math.max(REFERENCE_ABSOLUTE_TOLERANCE,
        REFERENCE_RELATIVE_TOLERANCE * Math.max(Math.abs(value), Math.abs(target)));
      const difference = Math.abs(value - target);
      if (difference > tolerance) {
        failures.push(`${field}: ${value} != ${target}; difference ${difference} exceeds ${tolerance}`);
      }
    }
  }
  assert.equal(failures.length, 0, failures.join("\n"));
}
