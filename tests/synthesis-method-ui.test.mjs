import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS, SYNTHESIS_METHODS, parameterValue } from '../src/instruments/synthesis/catalog.js';
import { METHOD_EDITOR_SCHEMAS, groupMethodControls } from '../src/instruments/synthesis/method-ui.js';

test('method control groups cover every synthesis and processing parameter exactly once without changing order', () => {
  for (const method of METHODS) {
    const indexes = groupMethodControls(method).flatMap(group => group.indexes);
    assert.deepEqual([...indexes].sort((a, b) => a - b), method.controls.map((_, index) => index), method.id);
    assert.equal(new Set(indexes).size, method.controls.length, `${method.id}: no duplicate fields`);
  }
});

test('every composite editor names real controls and only joins genuine coordinate/value sets', () => {
  for (const [methodId, editors] of Object.entries(METHOD_EDITOR_SCHEMAS)) {
    const method = SYNTHESIS_METHODS.find(candidate => candidate.id === methodId);
    assert.ok(method, `${methodId}: known method`);
    const ids = new Set(method.controls.map(control => control.id));
    const used = new Set();
    for (const editor of editors) {
      assert.ok(['xy', 'curve'].includes(editor.kind));
      const referenced = editor.kind === 'xy' ? [editor.x, editor.y] : editor.ids;
      assert.ok(referenced.length >= 2);
      for (const id of referenced) {
        assert.ok(ids.has(id), `${methodId}.${id}: known control`);
        assert.ok(!used.has(id), `${methodId}.${id}: one composite gesture owns each control`);
        used.add(id);
      }
    }
  }
});

test('clear synthesis parameter planes and banks receive technique-shaped editors', () => {
  const expected = {
    subtractive: [['xy', 'cutoff', 'resonance']],
    fm: [
      ['xy', 'frequency-ratio', 'index'],
      ['xy', 'second-ratio', 'second-depth'],
    ],
    pm: [
      ['xy', 'frequency-ratio', 'phase-depth'],
      ['xy', 'second-ratio', 'second-depth'],
    ],
    granular: [
      ['xy', 'source-position', 'position-spray'],
      ['xy', 'grain-size', 'density'],
    ],
    waveshaping: [['xy', 'drive', 'asymmetry']],
    'phase-vocoder': [['xy', 'low-cut', 'high-cut']],
    physical: [['xy', 'strike-position', 'pickup']],
    modal: [['xy', 'inharmonicity', 'modal-decay']],
    'formant-voice': [
      ['curve', 'f1', 'f2', 'f3', 'f4'],
      ['curve', 'b1', 'b2', 'b3', 'b4'],
    ],
  };
  for (const [methodId, signatures] of Object.entries(expected)) {
    const actual = METHOD_EDITOR_SCHEMAS[methodId].map(editor => [
      editor.kind,
      ...(editor.kind === 'xy' ? [editor.x, editor.y] : editor.ids),
    ]);
    assert.deepEqual(actual, signatures, methodId);
  }
});

test('formant curves share truthful physical Hz domains instead of comparing unrelated normalized ranges', () => {
  const method = SYNTHESIS_METHODS.find(candidate => candidate.id === 'formant-voice');
  const editors = METHOD_EDITOR_SCHEMAS['formant-voice'];
  for (const editor of editors) {
    assert.deepEqual(
      { min: editor.domain.min, max: editor.domain.max, scale: editor.domain.scale, unit: editor.domain.unit },
      editor.ids[0] === 'f1'
        ? { min: 200, max: 5500, scale: 'log', unit: 'Hz' }
        : { min: 30, max: 800, scale: 'log', unit: 'Hz' },
    );
    for (const id of editor.ids) {
      const control = method.controls.find(candidate => candidate.id === id);
      assert.ok(control.min >= editor.domain.min, `${id}: domain includes minimum`);
      assert.ok(control.max <= editor.domain.max, `${id}: domain includes maximum`);
    }
  }
  const [centers] = editors;
  const physicalDefaults = centers.ids.map(id => {
    const control = method.controls.find(candidate => candidate.id === id);
    return parameterValue(control, control.defaultNormalized);
  });
  assert.deepEqual(physicalDefaults, [...physicalDefaults].sort((a, b) => a - b), 'default contour rises with actual Hz');
});

test('method controls are grouped by signal-path meaning rather than incidental substrings', () => {
  const groupFor = (methodId, controlId) => {
    const method = METHODS.find(candidate => candidate.id === methodId);
    assert.ok(method, `${methodId}: known method`);
    const index = method.controls.findIndex(control => control.id === controlId);
    assert.notEqual(index, -1, `${methodId}.${controlId}: known control`);
    return groupMethodControls(method).find(group => group.indexes.includes(index))?.id;
  };
  const expected = {
    'sampling:loop-length': 'source',
    'sampling:direction': 'source',
    'granular:reverse-probability': 'quality',
    'stochastic:duration-step': 'motion',
    'stochastic:duration-ceiling': 'motion',
    'phase-vocoder:low-cut': 'spectrum',
    'phase-vocoder:high-cut': 'spectrum',
    'lpc:pole-radius': 'spectrum',
    'modal:strike-hardness': 'spectrum',
    'modal:strike-noise': 'spectrum',
    'phase-vocoder:phase-diffusion': 'quality',
    'phase-vocoder:phase-lock': 'quality',
    'padsynth:phase-seed': 'quality',
    'single-sideband:shift-motion': 'motion',
    'fdtd-membrane:strike-hardness': 'spectrum',
    'fx-compressor:ratio': 'dynamics',
    'fx-compressor:threshold': 'dynamics',
    'fx-compressor:knee': 'dynamics',
    'fx-compressor:makeup': 'dynamics',
    'fx-compressor:detector': 'dynamics',
    'fx-expander:ratio': 'dynamics',
    'fx-expander:threshold': 'dynamics',
    'fx-expander:maximum-reduction': 'dynamics',
    'fx-decimator:sample-rate': 'quality',
    'fx-reverb:predelay': 'motion',
    'bytebeat:shift-a': 'source',
    'bytebeat:shift-b': 'source',
    'pm:phase-depth': 'motion',
    'phase-vocoder:freeze': 'motion',
    'physical:mass-count': 'source',
    'modal:mode-detune': 'pitch',
    'formant-voice:open-quotient': 'source',
    'formant-voice:aspiration': 'source',
    'formant-voice:frication': 'source',
    'granular:grain-size': 'motion',
  };
  for (const [key, groupId] of Object.entries(expected)) {
    const separator = key.indexOf(':');
    assert.equal(groupFor(key.slice(0, separator), key.slice(separator + 1)), groupId, key);
  }
});
