import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/instruments/synthesis/catalog.js';
import { INSTRUMENT_PRESETS, RANDOMIZABLE_INPUTS, instrumentPresetsForInput, captureInstrumentPreset, randomizeInstrumentPreset, fitRandomAttackToSequence } from '../src/instruments/synthesis/instrument-presets.js';
import { inputsForCategory } from '../src/instruments/synthesis/signal-path.js';
import { NATIVE_METHODS } from '../src/instruments/voicesaurus/native-model.js';
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

test('one mixed musical tour excludes test sounds and loops without restricting the Input menu', () => {
  assert.deepEqual(RANDOMIZABLE_INPUTS, ['synthesis', 'speech', 'singing']);
  for (const input of [...RANDOMIZABLE_INPUTS, 'microphone', 'file', 'samples', 'signals']) {
    const bank = instrumentPresetsForInput(input);
    assert.equal(bank, INSTRUMENT_PRESETS);
    validateFullPresetBank(bank);
    for (const preset of bank) {
      assert.ok(RANDOMIZABLE_INPUTS.includes(preset.snapshot.routing.input));
      assert.deepEqual(captureInstrumentPreset(preset.snapshot), preset.snapshot, preset.id);
    }
  }
  assert.deepEqual(INSTRUMENT_PRESETS.slice(0, 3).map(p => p.snapshot.routing.input), RANDOMIZABLE_INPUTS);
  assert.deepEqual(new Set(INSTRUMENT_PRESETS.flatMap(p => p.snapshot.routing.voice ? [p.snapshot.routing.voice.scene.engine] : [])), new Set(Object.keys(NATIVE_METHODS)));
  for (const input of ['samples', 'signals']) {
    assert.ok(inputsForCategory(input).length > 0);
    assert.ok(INSTRUMENT_PRESETS.every(p => p.snapshot.routing.input !== input));
  }
});

test('global dice can leave every family and creates parameters across every safe input', () => {
  let seed = 532;
  const rng = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
  const inputs = new Set(), engines = new Set(), loopPolicies = new Set();
  for (let i = 0; i < 500; i++) {
    const previous = INSTRUMENT_PRESETS[i % INSTRUMENT_PRESETS.length].snapshot;
    const before = structuredClone(previous), next = randomizeInstrumentPreset(previous, rng);
    assert.ok(RANDOMIZABLE_INPUTS.includes(next.routing.input));
    assert.deepEqual(previous, before);
    assert.deepEqual(captureInstrumentPreset(next), next);
    assert.notDeepEqual(next, previous);
    assert.ok(!Object.hasOwn(next.sound, 'outputLevel'));
    assert.ok(!Object.hasOwn(next, 'playing'));
    assert.equal(next.routing.effect.presetId, 'custom');
    if (['speech', 'singing'].includes(next.routing.input)) assert.equal(next.routing.loop, true);
    inputs.add(next.routing.input); loopPolicies.add(next.routing.loop);
    if (next.routing.voice) engines.add(next.routing.voice.scene.engine);
    assert.equal(next.routing.selection, null);
    if (next.routing.input !== 'synthesis') assert.deepEqual(next.sound, next.routing.effect);
  }
  assert.deepEqual(inputs, new Set(RANDOMIZABLE_INPUTS));
  assert.equal(engines.size, Object.keys(NATIVE_METHODS).length);
  assert.equal(loopPolicies.size, 2);
  for (const draw of [0, 1, NaN, -1, Infinity]) {
    assert.ok(RANDOMIZABLE_INPUTS.includes(randomizeInstrumentPreset({}, () => draw).routing.input));
  }
});

test('whole-instrument dice makes a new complete musical state with a usable attack-to-gate relationship', () => {
  const current = captureInstrumentPreset({ sound: createDefaultState('additive') });
  for (let seed = 0; seed < 64; seed++) {
    let counter = seed + 1;
    const rng = () => ((counter = Math.imul(counter, 1664525) + 1013904223 >>> 0) / 4294967296);
    let first = true;
    const next = randomizeInstrumentPreset(current, () => { if (first) { first = false; return 0; } return rng(); });
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
