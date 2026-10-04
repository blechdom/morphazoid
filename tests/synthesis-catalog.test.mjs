import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { METHODS, SYNTHESIS_METHODS, PROCESSOR_METHODS, PRESET_COUNT, PARAMETER_COUNT, normalizedParameter, getMethod, getPreset, createDefaultState, sanitizeState, stateFromPreset, randomizeState, parameterValue, formatParameter } from '../src/instruments/synthesis/catalog.js';

test('synthesis catalog covers each requested engine with eight distinct, complete musical presets', () => {
  assert.equal(SYNTHESIS_METHODS.length, 53);
  assert.equal(PROCESSOR_METHODS.length, 16);
  assert.equal(METHODS.length, 69);
  assert.equal(PRESET_COUNT, 552);
  assert.equal(new Set(METHODS.map(method => method.id)).size, METHODS.length);
  METHODS.forEach((method, engineId) => {
    if (method.kind === "processor") assert.equal(method.processorId, engineId - SYNTHESIS_METHODS.length);
    else assert.equal(method.engineId, engineId);
    assert.ok(method.description && method.lineage && method.citation.url);
    assert.ok(method.controls.length >= 4 && method.controls.length <= PARAMETER_COUNT);
    assert.ok(!/later|implementation advances/i.test(method.group), "method groups describe sound generation");
    assert.equal(method.presets.length, 8);
    assert.equal(new Set(method.presets.map(preset => preset.id)).size, 8);
    assert.equal(new Set(method.presets.map(preset => JSON.stringify(preset.params))).size, 8, `${method.id}: presets must change synthesis controls, not only pitch/envelope`);
    for (const preset of method.presets) {
      assert.equal(preset.params.length, PARAMETER_COUNT);
      assert.ok(preset.params.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
      assert.ok(preset.frequencyHz >= 20 && preset.frequencyHz <= 8000);
      assert.ok(preset.cue.length > 20);
      assert.ok(!Object.hasOwn(preset, 'outputLevel') && !Object.hasOwn(preset, 'volume'));
      assert.deepEqual(sanitizeState({ ...preset, methodId: method.id, presetId: preset.id }).params, preset.params);
      assert.deepEqual(sanitizeState({ ...preset, methodId: method.id, presetId: preset.id }).envelope, preset.envelope);
    }
  });
});

test('normalized parameter display follows physical ranges, log cutoffs and discrete algorithms', () => {
  assert.equal(formatParameter(METHODS[37].controls[0], 0), 'Naïve');
  assert.equal(formatParameter(METHODS[37].controls[0], 1 / 3), 'PolyBLEP');
  assert.equal(formatParameter(METHODS[37].controls[0], 2 / 3), 'DPW');
  assert.equal(formatParameter(METHODS[37].controls[0], 1), 'MinBLEP');
  assert.equal(formatParameter(METHODS[24].controls[0], 0), '-1');
  assert.equal(formatParameter(METHODS[24].controls[0], 1), '1');
  assert.equal(formatParameter(METHODS[9].controls[1], .5), '50%');
  assert.equal(formatParameter(METHODS[8].controls.find(control => control.id === 'pole-radius'), 1), '0.9995');
  assert.equal(parameterValue(METHODS[7].controls[0], 0), 20);
  assert.equal(parameterValue(METHODS[7].controls[0], 1), 20000);
  assert.ok(Math.abs(parameterValue(METHODS[7].controls[0], .5) - Math.sqrt(20 * 20000)) < .001);
});

test('malformed state is bounded, hidden parameters are cleared and defaults are copied', () => {
  const initial = createDefaultState('fm');
  const corrupt = sanitizeState({ version: 2, methodId: 'fm', presetId: 'custom', params: [-1, NaN, Infinity, 5, 1, 1, 1, 1], frequencyHz: -2, outputLevel: 5,
    tuningId: 'not-a-tuning', arpMode: 'sideways',
    envelope: { attack: null, decay: Infinity, sustain: -1, release: 999 } });
  assert.equal(corrupt.methodId, 'fm');
  assert.equal(corrupt.presetId, 'custom');
  assert.equal(corrupt.frequencyHz, 20);
  assert.equal(corrupt.outputLevel, 1);
  assert.equal(corrupt.tuningId, 'edo-12-chromatic');
  assert.ok(!Object.hasOwn(corrupt, 'arpMode'));
  assert.ok(corrupt.params.slice(getMethod("fm").controls.length).every(value => value === 0));
  assert.equal(corrupt.params[0], 0);
  assert.equal(corrupt.params[3], 1);
  assert.equal(corrupt.envelope.attack, initial.envelope.attack);
  assert.equal(corrupt.envelope.sustain, 0);
  assert.equal(corrupt.envelope.release, 16);
  initial.params[0] = .999;
  initial.envelope.attack = 9;
  assert.notEqual(getPreset('fm').params[0], initial.params[0]);
  assert.notEqual(getPreset('fm').envelope.attack, initial.envelope.attack);
  assert.equal(getMethod('unknown').id, 'sampling');
  assert.equal(getMethod(38).id, 'antiderivative-waveshaping');
  assert.equal(sanitizeState(null).outputLevel, .7);
});

test('preset recall and full randomization preserve master output and stay recoverable', () => {
  for (const method of METHODS) {
    const current = { ...createDefaultState(method.id), outputLevel: .19, tuningId: 'edo-6-whole-tone', arpMode: 'up-down' };
    const recalled = stateFromPreset(method.id, method.presets[7].id, current);
    assert.equal(recalled.outputLevel, .19);
    assert.equal(recalled.tuningId, 'edo-6-whole-tone');
    assert.ok(!Object.hasOwn(recalled, 'arpMode'));
    assert.equal(recalled.presetId, method.presets[7].id);
    assert.deepEqual(recalled.params, method.presets[7].params);
    let step = 0;
    const randomized = randomizeState(current, () => ((step++ * 17 + 3) % 101) / 100);
    assert.equal(randomized.outputLevel, .19);
    assert.equal(randomized.tuningId, 'edo-6-whole-tone');
    assert.ok(!Object.hasOwn(randomized, 'arpMode'));
    assert.equal(randomized.presetId, 'custom');
    assert.equal(randomized.methodId, method.id);
    assert.notDeepEqual(randomized.params, current.params);
    assert.notDeepEqual(randomized.envelope, current.envelope);
    assert.notEqual(randomized.frequencyHz, current.frequencyHz);
    assert.deepEqual(randomized, sanitizeState(randomized));
    assert.deepEqual(stateFromPreset(method.id, method.presets[0].id, randomized), sanitizeState(current));
  }
});


test('old eight-slot patches retain physical values and gain neutral extension defaults', () => {
  const legacyStates = JSON.parse(readFileSync(new URL('./fixtures/synthesis-v1-states.json', import.meta.url)));
  for (const legacy of legacyStates) {
    const method = getMethod(legacy.methodId);
    const defaults = createDefaultState(method.id);
    const migrated = sanitizeState(legacy);
    assert.equal(migrated.version, 4);
    legacy.physical.forEach((value, index) => {
      const actual = parameterValue(method.controls[index], migrated.params[index]);
      assert.ok(Math.abs(actual - value) < 1e-4, `${method.id}/${index}: ${actual} should preserve ${value}`);
    });
    assert.deepEqual(migrated.params.slice(legacy.physical.length), defaults.params.slice(legacy.physical.length), `${method.id}: added defaults`);
  }
});

test('physical numeric values and inverse normalization agree across every method control', () => {
  for (const method of METHODS) for (const control of method.controls) {
    for (const normalized of [0, .17, .5, .89, 1]) {
      const value = parameterValue(control, normalized);
      assert.ok(Number.isFinite(value) && value >= control.min && value <= control.max);
      const restored = parameterValue(control, normalizedParameter(control, value));
      assert.ok(Math.abs(restored - value) < 1e-6, `${method.id}/${control.id}: exact value round trip`);
    }
  }
});


test('fixed preset calibration survives custom edits, old state and recall without owning master output', () => {
  for (const method of METHODS) {
    assert.ok(Number.isFinite(method.referenceLevelTrimDb));
    for (const preset of method.presets) {
      assert.ok(Number.isFinite(preset.levelTrimDb) && preset.levelTrimDb >= -36 && preset.levelTrimDb <= 48);
      const recalled = stateFromPreset(method.id, preset.id, { outputLevel: .23 });
      assert.equal(recalled.levelTrimDb, preset.levelTrimDb);
      assert.equal(recalled.outputLevel, .23);
      const edited = sanitizeState({ ...recalled, presetId: 'custom', frequencyHz: 317 });
      assert.equal(edited.levelTrimDb, preset.levelTrimDb);
      const old = { ...recalled }; delete old.levelTrimDb;
      assert.equal(sanitizeState(old).levelTrimDb, preset.levelTrimDb);
      const randomized = randomizeState(edited, () => .5);
      assert.equal(randomized.levelTrimDb, method.referenceLevelTrimDb);
      assert.equal(randomized.outputLevel, .23);
    }
  }
  assert.equal(sanitizeState({ levelTrimDb: 999 }).levelTrimDb, 48);
  assert.equal(sanitizeState({ levelTrimDb: -999 }).levelTrimDb, -36);
  assert.equal(sanitizeState({ levelTrimDb: NaN }).levelTrimDb, METHODS[0].presets[0].levelTrimDb);
});


test('every method has grounded touchstone demonstrations and valid single-control gestures', () => {
  for (const method of METHODS) {
    assert.ok(method.touchstones.length >= 2, method.id);
    for (const study of method.touchstones) {
      assert.ok(method.presets.some(p => p.id === study.presetId), `${method.id}/${study.id} has a real preset`);
      assert.ok(study.listenFor || study.expected);
      assert.ok(study.gesture || study.action);
      for (const gesture of study.parameterGestures || []) {
        const control = method.controls[gesture.controlIndex];
        assert.ok(control, `${method.id}/${study.id} has a real control`);
        const values = gesture.normalizedValues || [gesture.fromNormalized, gesture.toNormalized];
        assert.ok(values.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
      }
    }
  }
});

test('processing presets keep effect mix separate from master output and discard source devices', () => {
  const method = PROCESSOR_METHODS[0], preset = method.presets[0];
  const value = sanitizeState({ methodId: method.id, source: 99, wet: -1, inputDb: 90, outputDb: -99, bypass: true, stream: {}, file: {} });
  assert.equal(value.source, 7); assert.equal(value.wet, 0); assert.equal(value.inputDb, 24); assert.equal(value.outputDb, -36);
  assert.equal(value.bypass, true); assert.ok(!('stream' in value) && !('file' in value));
  const recalled = stateFromPreset(method.id, preset.id, { outputLevel: .4 });
  assert.equal(recalled.outputLevel, .4); assert.equal(recalled.source, preset.source);
  assert.equal(recalled.bypass, false); assert.equal(recalled.outputDb, preset.outputDb);
});


test('performer voicing and tuning survive presets, methods, processors and Random without owning arpeggiation', () => {
  for (const method of METHODS) {
    const original = createDefaultState(method.id);
    assert.equal(original.voiceMode, 'mono');
    assert.equal(original.tuningId, 'edo-12-chromatic');
    assert.ok(!Object.hasOwn(original, 'arpMode'));
    const migrated = sanitizeState({ ...original, version: 2 });
    assert.deepEqual(migrated.params, original.params, `${method.id}: v2 ranges remain unchanged`);
    assert.equal(migrated.voiceMode, 'mono');
    const performer = sanitizeState({ ...original, voiceMode: 'poly', tuningId: 'edo-6-whole-tone', arpMode: 'up-down' });
    assert.ok(!Object.hasOwn(performer, 'arpMode'));
    const recalled = stateFromPreset(method.id, method.presets[1].id, performer);
    assert.equal(recalled.voiceMode, 'poly');
    assert.equal(recalled.tuningId, 'edo-6-whole-tone');
    assert.ok(!Object.hasOwn(recalled, 'arpMode'));
    assert.equal(randomizeState(recalled).voiceMode, 'poly');
    assert.equal(randomizeState(recalled).tuningId, 'edo-6-whole-tone');
    assert.ok(!Object.hasOwn(randomizeState(recalled), 'arpMode'));
    const invalid = sanitizeState({ ...performer, voiceMode: 'invalid', tuningId: 'invalid', arpMode: 'invalid' });
    assert.deepEqual({ voiceMode: invalid.voiceMode, tuningId: invalid.tuningId },
      { voiceMode: 'mono', tuningId: 'edo-12-chromatic' });
    assert.ok(!Object.hasOwn(invalid, 'arpMode'));
  }
  const performer = { ...createDefaultState('additive'), voiceMode: 'poly', tuningId: 'edo-6-whole-tone', arpMode: 'down' };
  const effect = stateFromPreset('fx-delay', null, performer);
  assert.deepEqual({ voiceMode: effect.voiceMode, tuningId: effect.tuningId },
    { voiceMode: 'poly', tuningId: 'edo-6-whole-tone' });
  assert.ok(!Object.hasOwn(effect, 'arpMode'));
  const returned = stateFromPreset('fm', null, effect);
  assert.deepEqual({ voiceMode: returned.voiceMode, tuningId: returned.tuningId },
    { voiceMode: 'poly', tuningId: 'edo-6-whole-tone' });
  assert.ok(!Object.hasOwn(returned, 'arpMode'));
});
