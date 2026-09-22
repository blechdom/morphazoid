import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReferenceVoices, REFERENCE_ABSOLUTE_TOLERANCE, REFERENCE_RELATIVE_TOLERANCE,
} from "./helpers/shapes-reference-voices.mjs";

const voice = Object.freeze({
  frequency: 294.0975479820248, gain: 0.2704090762795511, pan: 0.06861610629328291,
  waveform: "sine", mode: "sine", synthDrive: 0, modulationIndex: 0,
  modulationRatio: 1, shepardRate: 0, shepardWidth: 4,
  shepardPosition: null, shepardTravel: null, gainSmoothingSeconds: 0.004,
});
const compare = (patch, target = voice) => assertReferenceVoices([{ ...target, ...patch }], [target], "reference");

test("both CI reports and their accumulated modulation-index delta fit the fixed numeric budget", () => {
  assert.notEqual(294.0975479820249, voice.frequency);
  assert.doesNotThrow(() => compare({ frequency: 294.0975479820249 }));
  assert.doesNotThrow(() => compare(
    { synthDrive: 0.5359942781539363, modulationIndex: 4.555951364308458 },
    { ...voice, synthDrive: 0.5359942781539382, modulationIndex: 4.555951364308474 },
  ));
  assert.equal(REFERENCE_ABSOLUTE_TOLERANCE, 1e-12);
  assert.equal(REFERENCE_RELATIVE_TOLERANCE, 1e-12);
});

test("large, small and near-zero values are accepted inside the budget and rejected outside it", () => {
  for (const frequency of [10, 512, 20_000]) {
    assert.doesNotThrow(() => compare({ frequency: frequency * (1 + 0.5e-12) }, { ...voice, frequency }));
    assert.throws(() => compare({ frequency: frequency * (1 + 2e-12) }, { ...voice, frequency }), /frequency/);
  }
  for (const pan of [-0.75, -1e-16, 0, 1e-16, 0.75]) {
    assert.doesNotThrow(() => compare({ pan: pan + 0.5e-12 }, { ...voice, pan }));
    assert.throws(() => compare({ pan: pan + 2e-12 }, { ...voice, pan }), /pan/);
  }
  assert.doesNotThrow(() => compare({ gain: 0.25 + 0.5e-12 }, { ...voice, gain: 0.25 }));
  assert.throws(() => compare({ gain: 0.25 + 2e-12 }, { ...voice, gain: 0.25 }), /gain/);
});

test("tiny but larger-than-roundoff changes to every computed output still fail", () => {
  for (const key of ["frequency", "gain", "pan", "synthDrive", "modulationIndex", "shepardRate", "shepardPosition", "shepardTravel"]) {
    const reference = { ...voice, [key]: 0.25 };
    assert.throws(() => compare({ [key]: 0.25 + 1e-10 }, reference), new RegExp(key));
  }
});

test("one failed comparison reports every divergent computed field rather than only the first", () => {
  assert.throws(() => compare({ frequency: 440, gain: 0.5, synthDrive: 0.2 }), error => {
    for (const field of ["frequency", "gain", "synthDrive"]) assert.match(error.message, new RegExp(field));
    return true;
  });
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
