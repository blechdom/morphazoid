import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/instruments/synthesis/catalog.js';
import { INPUT_CATEGORIES, inputsForCategory, sanitizeSignalPath } from '../src/instruments/synthesis/signal-path.js';
import { captureInstrumentPreset, randomizeInstrumentPreset } from '../src/instruments/synthesis/instrument-presets.js';

test('source-led categories are flat and signals and recordings have different provenance', () => {
  assert.deepEqual(INPUT_CATEGORIES.map(x => x.id), ['synthesis', 'microphone', 'file', 'samples', 'signals']);
  assert.ok(inputsForCategory('samples').every(x => x.kind === 'demo'));
  assert.ok(inputsForCategory('signals').every(x => x.kind === 'signal'));
  for (const category of INPUT_CATEGORIES) for (const item of inputsForCategory(category.id)) assert.ok(!item.label.includes(' · '));
});

test('old synth and processor snapshots migrate to deterministic safe routing', () => {
  const synth = createDefaultState('fm'), effect = createDefaultState('fx-biquad');
  assert.deepEqual(sanitizeSignalPath({}, synth), sanitizeSignalPath(undefined, synth));
  assert.equal(sanitizeSignalPath({}, synth).input, 'synthesis');
  assert.equal(sanitizeSignalPath({}, synth).effectEnabled, false);
  assert.equal(sanitizeSignalPath({}, effect).input, 'signals');
  assert.equal(sanitizeSignalPath({}, effect).effectEnabled, true);
  const hostile = sanitizeSignalPath({ input: 'invalid', selection: 'file:///secret', effectEnabled: 'yes', effect: { methodId: '__proto__' } }, synth);
  assert.equal(hostile.input, 'synthesis'); assert.equal(hostile.selection, null); assert.equal(hostile.effectEnabled, false);
});

test('complete presets round-trip synth inserts, source selection and looping without storing devices', () => {
  for (const input of ['synthesis', 'microphone', 'file', 'samples', 'signals']) {
    const sound = createDefaultState(input === 'synthesis' ? 'modal' : 'fx-delay');
    const routing = { input, selection: inputsForCategory(input).at(-1)?.id, loop: false, effectEnabled: true, effect: createDefaultState('fx-delay') };
    const snapshot = captureInstrumentPreset({ sound, routing });
    assert.deepEqual(captureInstrumentPreset(snapshot), snapshot);
    assert.equal(snapshot.routing.loop, false);
    assert.equal(snapshot.routing.input, input);
    for (const id of ['stream', 'file', 'buffer', 'context', 'playing', 'outputLevel']) assert.ok(!Object.hasOwn(snapshot.routing, id));
    assert.ok(!Object.hasOwn(snapshot.routing.effect, 'outputLevel'));
  }
});

test('whole-instrument randomization includes insert settings and cannot request devices', () => {
  const current = captureInstrumentPreset({ sound: createDefaultState('fm') });
  let seed = 231;
  const rng = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
  const enabled = new Set(), methods = new Set(), loopPolicies = new Set();
  for (let i = 0; i < 50; i++) {
    const next = randomizeInstrumentPreset(current, rng);
    assert.equal(next.routing.input, 'synthesis'); assert.equal(next.routing.selection, null);
    assert.equal(next.routing.effect.presetId, 'custom');
    enabled.add(next.routing.effectEnabled); methods.add(next.routing.effect.methodId); loopPolicies.add(next.routing.loop);
  }
  assert.equal(enabled.size, 2); assert.ok(methods.size > 8);
  assert.equal(loopPolicies.size, 2);
});
