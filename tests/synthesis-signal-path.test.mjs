import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/instruments/synthesis/catalog.js';
import { INPUT_CATEGORIES, inputsForCategory, sanitizeSignalPath } from '../src/instruments/synthesis/signal-path.js';
import { captureInstrumentPreset, randomizeInstrumentPreset } from '../src/instruments/synthesis/instrument-presets.js';
import { createVoiceInputState } from '../src/instruments/synthesis/voice-input-state.js';

test('source-led categories are flat and signals and recordings have different provenance', () => {
  assert.deepEqual(INPUT_CATEGORIES.map(x => x.id), ['synthesis', 'speech', 'singing', 'percussion', 'microphone', 'file', 'samples', 'signals']);
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
  for (const input of ['synthesis', 'percussion', 'microphone', 'file', 'samples', 'signals']) {
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
    assert.ok(['synthesis', 'speech', 'singing', 'percussion', 'samples'].includes(next.routing.input));
    assert.ok(!['microphone', 'file'].includes(next.routing.selection));
    assert.equal(next.routing.effect.presetId, 'custom');
    enabled.add(next.routing.effectEnabled); methods.add(next.routing.effect.methodId); loopPolicies.add(next.routing.loop);
  }
  assert.equal(enabled.size, 2); assert.ok(methods.size > 8);
  assert.equal(loopPolicies.size, 2);
});

test('speech and singing routes store native musical state, with optional processing', () => {
  const sound = createDefaultState('fx-reverb');
  for (const input of ['speech', 'singing']) {
    const voice = createVoiceInputState(input);
    const route = sanitizeSignalPath({ input, voice, loop: true, effectEnabled: false }, sound);
    assert.equal(route.version, 2);
    assert.equal(route.input, input);
    assert.equal(route.selection, null);
    assert.equal(route.effectEnabled, false);
    assert.deepEqual(route.voice, voice);
    assert.deepEqual(sanitizeSignalPath(route, sound), route);
    const snapshot = captureInstrumentPreset({ sound, routing: route });
    assert.deepEqual(captureInstrumentPreset(snapshot), snapshot);
    assert.equal(sanitizeSignalPath({ ...route, effectEnabled: true }, sound).effectEnabled, true);
    // A stale/cross-kind route must never put voice menus over a synth DSP state.
    assert.equal(sanitizeSignalPath(route, createDefaultState('fm')).input, 'synthesis');
  }
});
