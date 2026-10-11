import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE, PRESETS, TRACE_VOICES, DRUM_VOICES, sanitizeState, randomizeState } from '../src/instruments/vector-fractals/model.js';

test('Trace defaults and preset recall keep three separately editable voices', () => {
  const baseline = sanitizeState();
  assert.deepEqual(baseline.layerVoices, ['sine', 'reed', 'glass']);
  assert.deepEqual(baseline.layerEnabled, [true, true, true]);
  assert.deepEqual(baseline.layerSustain, [true, true, true]);
  assert.deepEqual(baseline.layerDrums, [false, false, false]);
  assert.deepEqual(baseline.layerDrumVoices, ['thump', 'wood', 'metal']);
  baseline.layerEnabled[0] = false;
  baseline.layerVoices[0] = 'glass';
  baseline.layerSustain[0] = false;
  baseline.layerDrums[0] = true;
  baseline.layerDrumVoices[0] = 'metal';
  assert.equal(DEFAULT_STATE.layerEnabled[0], true);
  assert.equal(DEFAULT_STATE.layerVoices[0], 'sine');
  assert.equal(DEFAULT_STATE.layerSustain[0], true);
  assert.equal(DEFAULT_STATE.layerDrums[0], false);
  assert.equal(DEFAULT_STATE.layerDrumVoices[0], 'thump');
  for (const preset of PRESETS) {
    assert.deepEqual(sanitizeState(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), Object.keys(DEFAULT_STATE).sort());
  }
  assert.ok(PRESETS.some(p => p.snapshot.mode === 'explorer' && p.snapshot.contourReader === 'xy'));
});

test('untrusted layer settings recover safely, while all-muted remains intentional', () => {
  const state = sanitizeState({ traceRate: Infinity, featureSize: NaN, layerVoices: [null, 'invalid', 'reed'], layerEnabled: [false, false, false] });
  assert.equal(state.traceRate, .1); assert.equal(state.featureSize, .015);
  assert.deepEqual(state.layerVoices, ['sine', 'reed', 'reed']);
  assert.deepEqual(state.layerEnabled, [false, false, false]);
  assert.equal(sanitizeState({ traceRate: -1 }).traceRate, .01);
  assert.equal(sanitizeState({ featureSize: 10 }).featureSize, .08);
});

test('older snapshots preserve their tone voices without adding drums or a fourth layer', () => {
  const state = sanitizeState({ contourReader: 'trace', layerVoices: ['glass', 'reed', 'sine'], layerEnabled: [true, false, true] });
  assert.deepEqual(state.layerVoices, ['glass', 'reed', 'sine']);
  assert.deepEqual(state.layerEnabled, [true, false, true]);
  assert.deepEqual(state.layerSustain, [true, true, true]);
  assert.deepEqual(state.layerDrums, [false, false, false]);
  assert.equal(state.toneLevel, 1);
  assert.equal(state.bendTimbre, .5);
  assert.equal(state.foldTimbre, 0);
  assert.equal(state.pitchDepth, 2);
  assert.equal(state.panWidth, 1);
  const extra = sanitizeState({ layerVoices: ['shepard', 'sine', 'glass', 'reed'], layerDrums: [true, false, true, true] });
  assert.deepEqual(extra.layerVoices, ['shepard', 'sine', 'glass']);
  assert.deepEqual(extra.layerDrums, [true, false, true]);
});

test('source switches, mappings and both mix levels may intentionally silence a scene', () => {
  const state = sanitizeState({ layerSustain: [false, false, false], layerDrums: [false, false, false],
    toneLevel: 0, drumLevel: 0, bendTimbre: 0, foldTimbre: 0, pitchDepth: 0, panWidth: 0 });
  assert.deepEqual(state.layerSustain, [false, false, false]);
  assert.deepEqual(state.layerDrums, [false, false, false]);
  for (const field of ['toneLevel', 'drumLevel', 'bendTimbre', 'foldTimbre', 'pitchDepth', 'panWidth']) assert.equal(state[field], 0);
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(state))), state);
});

test('reader, drum and Shepard settings reject malformed values and remain bounded', () => {
  for (const reader of ['trace', 'radar', 'scan', 'xy']) assert.equal(sanitizeState({ contourReader: reader }).contourReader, reader);
  const state = sanitizeState({ contourReader: 'unknown', shepardDirection: 'sideways', layerDrumVoices: ['invalid', 'metal'],
    drumSpacing: 0, drumDecay: 10, drumPitch: Infinity, radarX: -10, radarY: 10, scanAngle: 720,
    shepardCycles: 0, shepardWidth: 10, bendTimbre: NaN, foldTimbre: 3, pitchDepth: -1, panWidth: 8 });
  assert.equal(state.contourReader, 'trace');
  assert.equal(state.shepardDirection, 'rise');
  assert.equal(sanitizeState({ shepardDirection: 'fall' }).shepardDirection, 'fall');
  assert.deepEqual(state.layerDrumVoices, ['thump', 'metal', 'metal']);
  assert.equal(state.drumSpacing, .006); assert.equal(state.drumDecay, 1.5); assert.equal(state.drumPitch, 120);
  assert.equal(state.radarX, -.5); assert.equal(state.radarY, .5); assert.equal(state.scanAngle, 180);
  assert.equal(state.shepardCycles, .25); assert.equal(state.shepardWidth, 2);
  assert.equal(state.bendTimbre, .5); assert.equal(state.foldTimbre, 1); assert.equal(state.pitchDepth, 0); assert.equal(state.panWidth, 1);
});

test('presets offer percussion alone, mixed scanning, and endless Shepard motion', () => {
  const radar = PRESETS.find(p => p.id === 'radar-drums').snapshot;
  assert.equal(radar.contourReader, 'radar');
  assert.ok(radar.layerDrums.every(Boolean));
  assert.ok(radar.layerSustain.every(v => !v));
  const scan = PRESETS.find(p => p.id === 'scan-mixed').snapshot;
  assert.equal(scan.contourReader, 'scan');
  assert.ok(scan.layerDrums.some(Boolean) && scan.layerSustain.some(Boolean));
  const shepard = PRESETS.find(p => p.id === 'shepard-rise').snapshot;
  assert.ok(shepard.layerVoices.some((voice, i) => voice === 'shepard' && shepard.layerEnabled[i] && shepard.layerSustain[i]));
  assert.equal(shepard.shepardDirection, 'rise');
});

test('randomization explores each reader, voice, source switch and mapping without empty mixes', () => {
  let seed = 8104;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const layerKeys = ['layerVoices', 'layerDrumVoices', 'layerEnabled', 'layerSustain', 'layerDrums'];
  const seen = Object.fromEntries(layerKeys.map(key => [key, [new Set(), new Set(), new Set()]]));
  const fieldKeys = ['contourReader', 'toneLevel', 'drumLevel', 'drumSpacing', 'drumDecay', 'drumPitch', 'bendTimbre', 'foldTimbre', 'pitchDepth', 'panWidth', 'radarX', 'radarY', 'scanAngle', 'shepardDirection', 'shepardCycles', 'shepardWidth'];
  const fields = Object.fromEntries(fieldKeys.map(key => [key, new Set()]));
  for (let i = 0; i < 300; i++) {
    const state = randomizeState(DEFAULT_STATE, random);
    assert.deepEqual(sanitizeState(state), state);
    assert.ok(state.layerEnabled.some((enabled, i) => enabled && (state.layerSustain[i] && state.toneLevel > 0 || state.layerDrums[i] && state.drumLevel > 0)));
    for (const key of layerKeys) {
      assert.equal(state[key].length, 3);
      state[key].forEach((value, i) => seen[key][i].add(value));
    }
    for (const key of fieldKeys) fields[key].add(state[key]);
  }
  for (let i = 0; i < 3; i++) {
    assert.deepEqual([...seen.layerVoices[i]].sort(), [...TRACE_VOICES].sort());
    assert.deepEqual([...seen.layerDrumVoices[i]].sort(), [...DRUM_VOICES].sort());
    for (const key of ['layerEnabled', 'layerSustain', 'layerDrums']) assert.equal(seen[key][i].size, 2, `${key}[${i}] varies`);
  }
  assert.deepEqual([...fields.contourReader].sort(), ['radar', 'scan', 'trace', 'xy']);
  assert.deepEqual([...fields.shepardDirection].sort(), ['fall', 'rise']);
  for (const key of fieldKeys) assert.ok(fields[key].size > 1, `${key} varies`);
  for (const constant of [0, .5, 1]) {
    const state = randomizeState(DEFAULT_STATE, () => constant);
    assert.ok(state.layerEnabled.some((enabled, i) => enabled && (state.layerSustain[i] || state.layerDrums[i])));
  }
});
