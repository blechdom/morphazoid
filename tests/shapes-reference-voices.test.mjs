import assert from "node:assert/strict";
import test from "node:test";
import { assertReferenceVoices, REFERENCE_ROUNDING_FACTOR } from "./helpers/shapes-reference-voices.mjs";

const voice = Object.freeze({
  frequency: 294.0975479820248, gain: 0.2704090762795511, pan: 0.06861610629328291,
  waveform: "sine", mode: "sine", synthDrive: 0, modulationIndex: 0,
  modulationRatio: 1, shepardRate: 0, shepardWidth: 4,
  shepardPosition: null, shepardTravel: null, gainSmoothingSeconds: 0.004,
});
const compare = (patch, target = voice) => assertReferenceVoices([{ ...target, ...patch }], [target], "reference");

test("the reported CI two-ULP frequency difference is accepted without editing either value", () => {
  assert.notEqual(294.0975479820249, voice.frequency);
  assert.doesNotThrow(() => compare({ frequency: 294.0975479820249 }));
  assert.equal(REFERENCE_ROUNDING_FACTOR, 8 * Number.EPSILON);
});

test("rounding bounds stay near machine precision for large, small and near-zero computed values", () => {
  assert.doesNotThrow(() => compare({ frequency: 512 + 8 * Number.EPSILON * 512 }, { ...voice, frequency: 512 }));
  assert.throws(() => compare({ frequency: 512 + 16 * Number.EPSILON * 512 }, { ...voice, frequency: 512 }), /frequency/);
  assert.doesNotThrow(() => compare({ pan: Number.EPSILON }, { ...voice, pan: 0 }));
  assert.throws(() => compare({ pan: 1e-12 }, { ...voice, pan: 0 }), /pan/);
  assert.throws(() => compare({ gain: 0.25 + 1e-12 }, { ...voice, gain: 0.25 }), /gain/);
});

test("tiny but larger-than-roundoff changes to every computed output still fail", () => {
  for (const key of ["frequency", "gain", "pan", "synthDrive", "modulationIndex", "shepardRate", "shepardPosition", "shepardTravel"]) {
    const reference = { ...voice, [key]: 0.25 };
    assert.throws(() => compare({ [key]: 0.25 + 1e-9 }, reference), new RegExp(key));
  }
});

test("silence is exact even below the rounding allowance", () => {
  assert.throws(() => compare({ gain: Number.MIN_VALUE }, { ...voice, gain: 0 }), /silence/);
  assert.throws(() => compare({ gain: 0 }, { ...voice, gain: Number.MIN_VALUE }), /silence/);
});

test("voice counts, ordering, schema, modes and literal synthesis settings stay exact", () => {
  assert.throws(() => assertReferenceVoices([], [voice], "reference"), /voice count/);
  assert.throws(() => assertReferenceVoices([voice, voice], [voice], "reference"), /voice count/);
  const second = { ...voice, frequency: 440 };
  assert.throws(() => assertReferenceVoices([second, voice], [voice, second], "reference"), /voice\[0\].frequency/);
  const missing = { ...voice }; delete missing.pan;
  assert.throws(() => assertReferenceVoices([missing], [voice], "reference"), /fields/);
  assert.throws(() => compare({ extra: 0 }), /fields/);
  for (const patch of [
    { mode: "fm" }, { waveform: "square" },
    { modulationRatio: 1 + Number.EPSILON }, { shepardWidth: 4 + 4 * Number.EPSILON },
    { gainSmoothingSeconds: 0.004 + Number.EPSILON },
    { shepardPosition: 0 }, { shepardTravel: 0 },
  ]) assert.throws(() => compare(patch), /reference/);
});

test("nonfinite or nonnumeric outputs are never treated as harmless rounding", () => {
  for (const value of [NaN, Infinity, -Infinity, null, undefined, "294.0975479820248"]) {
    assert.throws(() => compare({ frequency: value }), /finite numbers/);
  }
  assert.throws(() => compare({ frequency: Infinity }, { ...voice, frequency: Infinity }), /finite numbers/);
});
