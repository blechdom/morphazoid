import assert from "node:assert/strict";

// These fields are computed from geometry/envelopes rather than recalled
// literally. Serialized doubles can differ in their last bits between runners:
// CI reported 294.0975479820249 versus the saved 294.0975479820248.
// Keep this allowance near machine precision; do not round the fixture or DSP.
const computedFields = new Set([
  "frequency", "gain", "pan", "synthDrive", "modulationIndex",
  "shepardRate", "shepardPosition", "shepardTravel",
]);
export const REFERENCE_ROUNDING_FACTOR = 8 * Number.EPSILON;

export function assertReferenceVoices(actual, expected, label) {
  assert.ok(Array.isArray(actual) && Array.isArray(expected), `${label}: voice arrays`);
  assert.equal(actual.length, expected.length, `${label}: voice count`);
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
        assert.deepEqual(value, target, field);
        continue;
      }
      assert.ok(Number.isFinite(value) && Number.isFinite(target), `${field}: finite numbers`);
      if (key === "gain" && (value === 0 || target === 0)) {
        // Rounding tolerance must never hide a silence/non-silence regression.
        assert.ok(value === target, `${field}: silence must remain exactly zero`);
        continue;
      }
      const tolerance = REFERENCE_ROUNDING_FACTOR * Math.max(1, Math.abs(value), Math.abs(target));
      const difference = Math.abs(value - target);
      assert.ok(difference <= tolerance,
        `${field}: ${value} != ${target}; difference ${difference} exceeds ${tolerance}`);
    }
  }
}
