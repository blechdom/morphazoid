import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/instruments/synthesis/catalog.js';
import { INSTRUMENT_PRESETS, instrumentPresetsForInput, captureInstrumentPreset, randomizeInstrumentPreset, fitRandomAttackToSequence } from '../src/instruments/synthesis/instrument-presets.js';
import { validateFullPresetBank } from '../src/site/header-presets.js';
import { compileSequence } from '../src/instruments/synthesis/sequence-compiler.js';

test('whole-instrument bank recalls synthesis, processing, voicing, score, tempo, ADSR and tuning', () => {
  validateFullPresetBank(INSTRUMENT_PRESETS);
  assert.ok(INSTRUMENT_PRESETS.some(p => p.snapshot.sound.methodId.startsWith('fx-')));
  assert.ok(INSTRUMENT_PRESETS.some(p => p.snapshot.voiceMode === 'poly'));
  for (const preset of INSTRUMENT_PRESETS) {
    assert.deepEqual(captureInstrumentPreset(preset.snapshot), preset.snapshot, preset.id);
    assert.ok(!Object.hasOwn(preset.snapshot.sound, 'outputLevel'));
    assert.ok(!Object.hasOwn(preset.snapshot, 'playing'));
  }
});

test('capture preserves direct and basic patterns for transaction rollback', () => {
  for (const id of ['none', 'basic-up', 'basic-down', 'basic-up-down']) {
    const snapshot = captureInstrumentPreset({ sound: createDefaultState('fm'), voiceMode: 'poly', sequence: { id, tempoBpm: 137, gate: 39 } });
    assert.equal(snapshot.sequence.id, id);
    assert.equal(snapshot.sequence.tempoBpm, 137);
    assert.equal(snapshot.sequence.gate, 39);
    assert.deepEqual(captureInstrumentPreset(snapshot), snapshot);
  }
});

test('each voice input replaces the instrument bank and randomizes only its own musical category', () => {
  assert.equal(instrumentPresetsForInput('synthesis'), INSTRUMENT_PRESETS);
  assert.equal(instrumentPresetsForInput('signals'), INSTRUMENT_PRESETS);
  for (const input of ['speech', 'singing']) {
    const bank = instrumentPresetsForInput(input);
    validateFullPresetBank(bank);
    assert.ok(bank.length > 20);
    for (const preset of bank) {
      assert.equal(preset.snapshot.routing.input, input);
      assert.equal(preset.snapshot.routing.effectEnabled, false);
      assert.deepEqual(captureInstrumentPreset(preset.snapshot), preset.snapshot, preset.id);
    }
    let seed = 532;
    const rng = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
    const engines = new Set(), loopPolicies = new Set(), effects = new Set();
    for (let i = 0; i < 32; i++) {
      const next = randomizeInstrumentPreset(bank[0].snapshot, rng);
      assert.equal(next.routing.input, input);
      assert.deepEqual(captureInstrumentPreset(next), next);
      assert.notDeepEqual(next.routing.voice, bank[0].snapshot.routing.voice);
      engines.add(next.routing.voice.scene.engine); loopPolicies.add(next.routing.loop); effects.add(next.routing.effectEnabled);
      assert.ok(!Object.hasOwn(next.sound, 'outputLevel'));
      assert.ok(!Object.hasOwn(next, 'playing'));
    }
    assert.ok(engines.size > 2); assert.equal(loopPolicies.size, 2); assert.equal(effects.size, 2);
  }
});

test('whole-instrument dice makes a new complete musical state with a usable attack-to-gate relationship', () => {
  const current = captureInstrumentPreset({ sound: createDefaultState('additive') });
  for (let seed = 0; seed < 64; seed++) {
    let counter = seed + 1;
    const rng = () => ((counter = Math.imul(counter, 1664525) + 1013904223 >>> 0) / 4294967296);
    const next = randomizeInstrumentPreset(current, rng);
    assert.notDeepEqual(next, current);
    assert.equal(next.sound.presetId, 'custom');
    assert.deepEqual(captureInstrumentPreset(next), next);
    const cycle = compileSequence(next.sequence.id, { parameters: next.sequence.parameters, tempo: next.sequence.tempoBpm });
    const gates = cycle.steps.flatMap(step => step.notes.map(note => step.duration * note.gate * 60 / next.sequence.tempoBpm)).sort((a,b) => a-b);
    assert.ok(gates.length > 0);
    assert.ok(next.sound.envelope.attack <= Math.max(.001, gates[Math.floor(gates.length / 2)] * .25) + .000001);
  }
});

test('local synthesis dice fits quick tuning arpeggios without changing manual direct-note attacks', () => {
  const sound = createDefaultState('fm');
  sound.envelope.attack = 1.8;
  for (const id of ['basic-up', 'basic-down', 'basic-up-down']) {
    for (const tempoBpm of [120, 1200]) {
      const next = fitRandomAttackToSequence(sound, { id, tempoBpm, gate: 65 });
      assert.ok(next.envelope.attack <= 60 / tempoBpm * .65 * .25);
      assert.equal(sound.envelope.attack, 1.8);
      assert.deepEqual(next.params, sound.params);
    }
  }
  assert.equal(fitRandomAttackToSequence(sound, { id: 'none' }), sound);
});
