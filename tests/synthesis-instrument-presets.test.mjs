import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNTHESIS_METHODS, createDefaultState } from '../src/instruments/synthesis/catalog.js';
import { INSTRUMENT_PRESETS, ADDITIONAL_INSTRUMENT_PRESETS, SAMPLE_INSTRUMENT_PRESETS, PERCUSSION_INSTRUMENT_PRESETS, RANDOMIZABLE_INPUTS, instrumentPresetsForInput, captureInstrumentPreset, randomizeInstrumentPreset, fitRandomAttackToSequence } from '../src/instruments/synthesis/instrument-presets.js';
import { inputsForCategory } from '../src/instruments/synthesis/signal-path.js';
import { NATIVE_METHODS } from '../src/instruments/voicesaurus/native-model.js';
import { validateFullPresetBank } from '../src/site/header-presets.js';
import { compileSequence } from '../src/instruments/synthesis/sequence-compiler.js';

test('the main bank combines the original tour with synthesis, voice, sample and percussion performances', () => {
  assert.equal(ADDITIONAL_INSTRUMENT_PRESETS.length, 100 + SAMPLE_INSTRUMENT_PRESETS.length);
  assert.equal(PERCUSSION_INSTRUMENT_PRESETS.length, 18);
  assert.equal(INSTRUMENT_PRESETS.length, 34 + ADDITIONAL_INSTRUMENT_PRESETS.length + PERCUSSION_INSTRUMENT_PRESETS.length);
  assert.deepEqual(INSTRUMENT_PRESETS.slice(34, 34 + ADDITIONAL_INSTRUMENT_PRESETS.length), ADDITIONAL_INSTRUMENT_PRESETS);
  assert.deepEqual(INSTRUMENT_PRESETS.slice(34 + ADDITIONAL_INSTRUMENT_PRESETS.length), PERCUSSION_INSTRUMENT_PRESETS);
  assert.equal(new Set(INSTRUMENT_PRESETS.map(p => p.id)).size, INSTRUMENT_PRESETS.length);
  assert.equal(new Set(INSTRUMENT_PRESETS.map(p => p.label)).size, INSTRUMENT_PRESETS.length);
  assert.equal(new Set(INSTRUMENT_PRESETS.map(p => JSON.stringify(p.snapshot))).size, INSTRUMENT_PRESETS.length);
  assert.deepEqual(RANDOMIZABLE_INPUTS.map(input => ADDITIONAL_INSTRUMENT_PRESETS.filter(p => p.snapshot.routing.input === input).length), [60, 20, 20, 0, SAMPLE_INSTRUMENT_PRESETS.length]);
  assert.deepEqual(new Set(ADDITIONAL_INSTRUMENT_PRESETS.filter(p => p.snapshot.routing.input === 'synthesis').map(p => p.snapshot.sound.methodId)), new Set(SYNTHESIS_METHODS.map(m => m.id)));
  for (const { id, snapshot } of ADDITIONAL_INSTRUMENT_PRESETS) {
    assert.deepEqual(captureInstrumentPreset(snapshot), snapshot, id);
    assert.equal(snapshot.routing.loop, true, id);
    const sample = snapshot.routing.input === 'samples';
    if (!sample) assert.equal(snapshot.routing.selection, null, id);
    assert.equal(snapshot.routing.effect.source, 0, id);
    if (!sample) assert.ok(snapshot.routing.effect.wet <= .35, id);
    if (snapshot.routing.input !== 'synthesis') {
      assert.deepEqual(snapshot.sound, snapshot.routing.effect, id);
      assert.equal(snapshot.sequence.id, 'none', id);
      if (!sample) assert.ok(snapshot.routing.voice.text.length <= 220, id);
    }
  }
});

test('sample performances cover bundled loops and recall processing without devices or sequencing', () => {
  assert.equal(SAMPLE_INSTRUMENT_PRESETS.length, 37);
  assert.deepEqual(new Set(SAMPLE_INSTRUMENT_PRESETS.map(p => p.snapshot.routing.selection)),
    new Set(inputsForCategory('samples').map(input => input.id)));
  assert.ok(new Set(SAMPLE_INSTRUMENT_PRESETS.map(p => p.snapshot.sound.methodId)).size >= 10);
  const positions = [];
  for (const preset of SAMPLE_INSTRUMENT_PRESETS) {
    const { sound, routing, sequence } = preset.snapshot;
    assert.equal(routing.input, 'samples');
    assert.equal(routing.effectEnabled, true);
    assert.equal(routing.loop, true);
    assert.equal(sound.source, 0);
    assert.equal(sound.bypass, false);
    assert.ok(sound.wet >= .4 && sound.wet <= .8);
    assert.deepEqual(sound, routing.effect);
    assert.equal(sequence.id, 'none');
    assert.deepEqual(captureInstrumentPreset(JSON.parse(JSON.stringify(preset.snapshot))), preset.snapshot);
    positions.push(ADDITIONAL_INSTRUMENT_PRESETS.indexOf(preset));
  }
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1] + 1)),
    'sample performances are interspersed through the mixed tour');
});

test('new synthesis performances compile sounding phrases with attacks fitted to their gates', () => {
  const signatures = new Set(), sequences = new Set(), tunings = new Set();
  for (const { id, snapshot } of ADDITIONAL_INSTRUMENT_PRESETS.filter(p => p.snapshot.routing.input === 'synthesis')) {
    const { sound, sequence, tuningId } = snapshot;
    const cycle = compileSequence(sequence.id, { parameters: sequence.parameters, tempo: sequence.tempoBpm });
    const notes = cycle.steps.flatMap(step => step.notes);
    assert.ok(notes.length >= 4, id);
    let onset = 0;
    for (const step of cycle.steps) { if (step.notes.length) break; onset += step.duration * 60 / sequence.tempoBpm; }
    assert.ok(onset < 1, `${id}: first note at ${onset}s`);
    const gates = cycle.steps.flatMap(step => step.notes.map(note => step.duration * note.gate * 60 / sequence.tempoBpm)).sort((a, b) => a - b);
    assert.ok(sound.envelope.attack <= Math.max(.001, gates[Math.floor(gates.length / 2)] * .25) + .000001, id);
    signatures.add(JSON.stringify([sound.methodId, sound.params, sequence, tuningId]));
    sequences.add(sequence.id); tunings.add(tuningId);
  }
  assert.equal(signatures.size, 60);
  assert.ok(sequences.size >= 16);
  assert.ok(tunings.size >= 12);
});

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

test('one mixed musical tour includes samples without selecting devices or test signals', () => {
  assert.deepEqual(RANDOMIZABLE_INPUTS, ['synthesis', 'speech', 'singing', 'percussion', 'samples']);
  for (const input of [...RANDOMIZABLE_INPUTS, 'microphone', 'file', 'signals']) {
    const bank = instrumentPresetsForInput(input);
    assert.equal(bank, INSTRUMENT_PRESETS);
    validateFullPresetBank(bank);
    for (const preset of bank) {
      assert.ok(RANDOMIZABLE_INPUTS.includes(preset.snapshot.routing.input));
      assert.deepEqual(captureInstrumentPreset(preset.snapshot), preset.snapshot, preset.id);
    }
  }
  assert.deepEqual(INSTRUMENT_PRESETS.slice(0, 3).map(p => p.snapshot.routing.input), ['synthesis', 'speech', 'singing']);
  assert.deepEqual(new Set(INSTRUMENT_PRESETS.flatMap(p => p.snapshot.routing.voice ? [p.snapshot.routing.voice.scene.engine] : [])), new Set(Object.keys(NATIVE_METHODS)));
  for (const input of ['microphone', 'file', 'signals']) {
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
    if (['speech', 'singing', 'samples'].includes(next.routing.input)) assert.equal(next.routing.loop, true);
    inputs.add(next.routing.input); loopPolicies.add(next.routing.loop);
    if (next.routing.voice) engines.add(next.routing.voice.scene.engine);
    if (next.routing.input === 'samples') assert.ok(inputsForCategory('samples').some(input => input.id === next.routing.selection));
    else assert.equal(next.routing.selection, null);
    if (next.routing.input !== 'synthesis') assert.deepEqual(next.sound, next.routing.effect);
  }
  assert.deepEqual(inputs, new Set(RANDOMIZABLE_INPUTS));
  assert.equal(engines.size, Object.keys(NATIVE_METHODS).length);
  assert.equal(loopPolicies.size, 2);
  for (const draw of [0, 1, NaN, -1, Infinity]) {
    assert.ok(RANDOMIZABLE_INPUTS.includes(randomizeInstrumentPreset({}, () => draw).routing.input));
  }
});

test('main sample dice varies bundled loops and processor parameters without devices, output or transport state', () => {
  const sourceIds = inputsForCategory('samples').map(input => input.id), seenSources = new Set(), seenEffects = new Set(), states = new Set();
  const previous = { ...SAMPLE_INSTRUMENT_PRESETS[0].snapshot, outputLevel: .27, armed: false, playing: true };
  const before = structuredClone(previous);
  const sampleDraw = (RANDOMIZABLE_INPUTS.indexOf('samples') + .5) / RANDOMIZABLE_INPUTS.length;
  const run = seed => {
    let first = true, counter = seed;
    return randomizeInstrumentPreset(previous, () => {
      if (first) { first = false; return sampleDraw; }
      return (counter = Math.imul(counter, 1664525) + 1013904223 >>> 0) / 4294967296;
    });
  };
  for (let i = 1; i <= 256; i++) {
    const next = run(Math.imul(i, 7919));
    assert.deepEqual(next, run(Math.imul(i, 7919)));
    assert.deepEqual(captureInstrumentPreset(next), next);
    assert.equal(next.routing.input, 'samples');
    assert.ok(sourceIds.includes(next.routing.selection));
    assert.equal(next.routing.loop, true);
    assert.equal(next.routing.effectEnabled, true);
    assert.equal(next.sequence.id, 'none');
    assert.equal(next.sound.source, 0);
    assert.equal(next.sound.bypass, false);
    assert.equal(next.sound.presetId, 'custom');
    assert.ok(next.sound.wet >= .15 && next.sound.wet <= .65);
    assert.ok(next.sound.inputDb <= 0 && next.sound.outputDb <= 0);
    assert.deepEqual(next.sound, next.routing.effect);
    for (const key of ['outputLevel', 'armed', 'playing']) {
      assert.ok(!Object.hasOwn(next, key)); assert.ok(!Object.hasOwn(next.sound, key));
    }
    seenSources.add(next.routing.selection); seenEffects.add(next.sound.methodId); states.add(JSON.stringify(next.sound.params));
  }
  assert.deepEqual(previous, before);
  assert.deepEqual(seenSources, new Set(sourceIds));
  assert.equal(seenEffects.size, 17);
  assert.ok(states.size > 200, 'fresh processor settings beyond the authored sample recipes');
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
