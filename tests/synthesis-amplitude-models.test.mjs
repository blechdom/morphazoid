import test from "node:test";
import assert from "node:assert/strict";
import { SYNTHESIS_METHODS, PROCESSOR_METHODS } from "../src/instruments/synthesis/catalog.js";
import { AMPLITUDE_MODELS, AMPLITUDE_SOURCES, getAmplitudeModel } from "../src/instruments/synthesis/amplitude-models.js";

test("amplitude models cover the actual generator catalog, not processors", () => {
  assert.deepEqual(Object.keys(AMPLITUDE_MODELS).sort(), SYNTHESIS_METHODS.map(m => m.id).sort());
  for (const method of SYNTHESIS_METHODS) {
    const model = getAmplitudeModel(method);
    assert.equal(model, getAmplitudeModel(method.id));
    assert.equal(model.methodId, method.id);
    assert.ok(model.label && model.intrinsicExplanation && model.historicalContext);
    assert.ok(Object.isFrozen(model) && Object.isFrozen(model.hostEnvelope));
    assert.equal(model.hostEnvelope.alwaysApplied, true, method.id);
    assert.equal(model.hostEnvelope.label, "Added note envelope");
  }
  for (const method of PROCESSOR_METHODS) assert.equal(getAmplitudeModel(method), null);
  for (const value of [null, undefined, {}, "missing", "__proto__", "toString"]) assert.equal(getAmplitudeModel(value), null);
});

test("native articulation and coupled controls always name real parameters", () => {
  for (const method of SYNTHESIS_METHODS) {
    const ids = method.controls.map(c => c.id);
    const model = getAmplitudeModel(method);
    for (const list of [model.intrinsicControlIds, model.hostEnvelope.alsoModulatesControlIds]) {
      assert.equal(new Set(list).size, list.length, method.id);
      for (const id of list) assert.ok(ids.includes(id), `${method.id}: ${id}`);
      assert.ok(Object.isFrozen(list));
    }
  }
});

test("internal physical decay is distinct from the still-active host envelope", () => {
  for (const id of ["physical", "modal", "karplus-strong", "fdtd-membrane", "fdn-resonator"]) {
    const model = getAmplitudeModel(id);
    assert.equal(model.category, "natural-decay");
    assert.equal(model.displayStyle, "decay-controls");
    assert.equal(model.hostEnvelope.collapseByDefault, true);
    assert.equal(model.hostEnvelope.alwaysApplied, true);
    assert.match(model.hostEnvelope.explanation, /does not bypass/);
  }
  for (const id of ["waveguide", "scanned", "particle-shaker"]) {
    assert.equal(getAmplitudeModel(id).category, "driven-resonator");
    assert.equal(getAmplitudeModel(id).displayStyle, "excitation-controls");
  }
});

test("grain and pulse windows are not mislabeled as complete note envelopes", () => {
  for (const id of ["granular", "fof", "vosim", "window-formant", "pulsar", "corpus"]) {
    const model = getAmplitudeModel(id);
    assert.equal(model.category, "microsound-window");
    assert.equal(model.hostEnvelope.collapseByDefault, false);
    assert.ok(model.intrinsicControlIds.length > 0);
  }
});

test("spectral attack and scale weights do not imply native amplitude decay", () => {
  for (const id of ["fm", "ddsp", "hard-sync", "chebyshev"]) {
    assert.equal(getAmplitudeModel(id).category, "spectral-articulation");
    assert.equal(getAmplitudeModel(id).hostEnvelope.collapseByDefault, false);
  }
  assert.equal(getAmplitudeModel("wavelet").category, "continuous-generator");
  assert.match(getAmplitudeModel("wavelet").intrinsicExplanation, /not a decay time/);
  assert.equal(getAmplitudeModel("stochastic").category, "continuous-generator");
  assert.deepEqual(getAmplitudeModel("wavelet").intrinsicControlIds, []);
});

test("common ADSR's extra DSP destinations remain disclosed", () => {
  assert.deepEqual(getAmplitudeModel("subtractive").hostEnvelope.alsoModulatesControlIds, ["envelope-depth"]);
  assert.deepEqual(getAmplitudeModel("physical").hostEnvelope.alsoModulatesControlIds, ["tension-envelope"]);
  assert.deepEqual(getAmplitudeModel("waveguide").hostEnvelope.alsoModulatesControlIds, ["pressure", "breath-noise"]);
  assert.deepEqual(getAmplitudeModel("noise-modulation").hostEnvelope.alsoModulatesControlIds, ["depth-envelope"]);
  assert.deepEqual(getAmplitudeModel("hard-sync").hostEnvelope.alsoModulatesControlIds, ["sync-envelope"]);
  assert.deepEqual(getAmplitudeModel("fm").hostEnvelope.alsoModulatesControlIds, []);
});

test("historical examples are sourced and not claimed as DSP replicas", () => {
  for (const source of Object.values(AMPLITUDE_SOURCES)) {
    assert.equal(new URL(source.url).protocol, "https:");
    assert.ok(source.label && source.evidence);
    assert.ok(Object.isFrozen(source));
  }
  for (const model of Object.values(AMPLITUDE_MODELS)) {
    assert.ok(model.sources.length);
    for (const source of model.sources) assert.ok(Object.values(AMPLITUDE_SOURCES).includes(source));
  }
  for (const id of ["fm", "pm"]) {
    assert.match(getAmplitudeModel(id).historicalContext, /four rates and four levels/);
    assert.match(getAmplitudeModel(id).historicalContext, /does not implement/);
    assert.ok(getAmplitudeModel(id).sources.includes(AMPLITUDE_SOURCES.dx7));
  }
  assert.match(getAmplitudeModel("subtractive").historicalContext, /release switch/);
  assert.match(getAmplitudeModel("psg-pulse").historicalContext, /not a cycle-accurate/);
});

test("reading articulation metadata leaves musical state and preset envelopes intact", () => {
  const before = JSON.stringify(SYNTHESIS_METHODS);
  for (const method of SYNTHESIS_METHODS) getAmplitudeModel(method);
  assert.equal(JSON.stringify(SYNTHESIS_METHODS), before);
  assert.throws(() => { getAmplitudeModel("modal").hostEnvelope.alwaysApplied = false; }, TypeError);
});
