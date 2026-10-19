import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULTS } from '../src/instruments/simd-resonator-rust/model.js';
import { SIMD_RESONATOR_FULL_PRESETS } from '../src/families/simd-resonator/simd-resonator-presets.js';
import { EXCITATION_TYPES, FILTER_TYPES } from '../src/instruments/simd-resonator-rust/signal-path.js';
import {
  PRESETS, DEFAULT_PRESET_SETTINGS, SPATIAL_PRESET_DEFAULTS, APPLICATION_MODES,
  REVERB_CHARACTERS, RESYNTHESIS_CHARACTERS, applicationForSettings,
  sanitizePresetSettings, capturePreset, validatePreset, randomizePreset,
} from '../src/instruments/simd-resonator-rust/presets.js';

const stageKeys = ['bodyEnabled', 'processingEnabled', 'resynthesisEnabled', 'reverbEnabled'];
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const keys = value => Object.keys(value).sort();

test('Rezoidinator starts as a plucked body and retains all twenty factory IDs', () => {
  assert.equal(applicationForSettings(DEFAULT_PRESET_SETTINGS), 'body');
  assert.equal(DEFAULT_PRESET_SETTINGS.excitationType, 'pluck');
  assert.equal(DEFAULT_PRESET_SETTINGS.excitationStrength, .8);
  assert.equal(DEFAULT_PRESET_SETTINGS.excitationDurationMs, 18);
  assert.deepEqual(PRESETS[0].snapshot, DEFAULT_PRESET_SETTINGS);
  assert.deepEqual(PRESETS.map(preset => preset.id), [
    ...['silk-512', 'bronze-haze', 'glass-rain', 'close-choir', 'copper-spray', 'low-continuum', 'wire-cluster', 'voice-chamber'].map(id => 'rust:' + id),
    ...SIMD_RESONATOR_FULL_PRESETS.map(preset => 'classic:' + preset.id),
  ]);
  assert.equal(PRESETS.length, 20);
  for (const preset of PRESETS) {
    const state = preset.snapshot;
    assert.deepEqual(validatePreset(state), state);
    assert.deepEqual(sanitizePresetSettings(state), state);
    assert.deepEqual(keys(state), keys(DEFAULT_PRESET_SETTINGS));
    assert(state.wetMix > 0 && state.excitationStrength > 0 && state.fftInputGain > 0, preset.id);
    assert((state.bodyEnabled && state.bodyMix > 0) || state.processingEnabled
      || (state.resynthesisEnabled && state.fftMix > 0)
      || (state.reverbEnabled && state.reverbMix > 0), preset.id);
  }
  assert.deepEqual(new Set(PRESETS.map(preset => preset.snapshot.excitationType)), new Set(EXCITATION_TYPES));
});

test('the explicitly spectral classic scenes preserve their original FFT values and route', () => {
  for (const original of SIMD_RESONATOR_FULL_PRESETS.slice(4)) {
    const snapshot = PRESETS.find(preset => preset.id === 'classic:' + original.id).snapshot;
    for (const [key, value] of Object.entries(original.snapshot)) assert.equal(snapshot[key], value, original.id + ':' + key);
    assert.equal(snapshot.bodyEnabled, true);
    assert.equal(snapshot.resynthesisEnabled, true);
    assert.equal(snapshot.processingEnabled, false);
    assert.equal(snapshot.reverbEnabled, false);
    assert.equal(snapshot.excitationType, 'impulse');
  }
});

test('application selection changes stage routing without replacing layer timbres or spatial motion', () => {
  const previous = sanitizePresetSettings({ baseFrequency: 137, filterType: 'highpass', filterFrequency: 1300,
    reverbTime: 7, reverbDamping: .81, excitationType: 'pink-noise', fftResponseMs: 415,
    spaceMotion: true, spaceRate: -.35 });
  assert.deepEqual(APPLICATION_MODES.map(mode => mode.id), [
    'body', 'processing', 'reverb', 'resynthesis', 'body-reverb', 'body-resynthesis', 'resynthesis-reverb', 'all',
  ]);
  for (const mode of APPLICATION_MODES) {
    const next = sanitizePresetSettings({ ...previous, ...mode.settings });
    assert.equal(applicationForSettings(next), mode.id);
    for (const key of Object.keys(previous)) if (!Object.hasOwn(mode.settings, key)) assert.equal(next[key], previous[key], mode.id + ':' + key);
    assert.equal(applicationForSettings({ ...next, bodyMix: .12, fftMix: .43, reverbTime: 11 }), mode.id);
  }
  assert.equal(applicationForSettings({ ...previous, bodyEnabled: true, processingEnabled: true }), 'custom');
  assert.equal(applicationForSettings({ ...previous, ...Object.fromEntries(stageKeys.map(key => [key, false])) }), 'custom');
});

test('focused reverb and FFT characters preserve every parameter belonging to another layer', () => {
  const previous = randomizePreset(DEFAULT_PRESET_SETTINGS, seeded(39));
  for (const [bank, allowed] of [
    [REVERB_CHARACTERS, new Set(['reverbTime', 'reverbDamping', 'reverbMix'])],
    [RESYNTHESIS_CHARACTERS, new Set(Object.keys(DEFAULTS).filter(key => key.startsWith('fft')))],
  ]) {
    assert(bank.length >= 4);
    for (const character of bank) {
      for (const key of Object.keys(character.settings)) assert(allowed.has(key), character.id + ':' + key);
      const next = validatePreset({ ...previous, ...character.settings });
      for (const key of Object.keys(previous)) if (!Object.hasOwn(character.settings, key)) assert.equal(next[key], previous[key], character.id + ':' + key);
    }
  }
});

test('live sanitization supplies complete bounded native state and keeps one FFT level field', () => {
  assert.deepEqual(sanitizePresetSettings(), DEFAULT_PRESET_SETTINGS);
  const state = sanitizePresetSettings({ modeCount: 1e9, spectralSpan: -10, bodyMix: 2, wetMix: -1,
    excitationType: 'unknown', excitationStrength: 100, excitationDurationMs: -5,
    drive: 100, filterFrequency: -1, reverbTime: Infinity, reverbDamping: 1,
    spaceSpan: 100, spacePattern: 'unknown', fftMix: .123, fftHopRatio: .314159 });
  assert.deepEqual(validatePreset(state), state);
  assert.equal(state.modeCount, 4096);
  assert.equal(state.spectralSpan, 8);
  assert.equal(state.bodyMix, 1);
  assert.equal(state.wetMix, 0);
  assert.equal(state.excitationType, 'pluck');
  assert.equal(state.excitationStrength, 1.5);
  assert.equal(state.excitationDurationMs, 1);
  assert.equal(state.drive, 24);
  assert.equal(state.filterFrequency, 20);
  assert.equal(state.reverbTime, DEFAULT_PRESET_SETTINGS.reverbTime);
  assert.equal(state.reverbDamping, .98);
  assert.equal(state.spaceSpan, 4);
  assert.equal(state.spacePattern, 'ascending');
  assert.equal(state.fftMix, .123);
  assert.equal(state.fftHopRatio, .314159);
  assert(!Object.hasOwn(state, 'resynthesisMix'));
});

test('both complete older scene formats migrate without losing modal, FFT or spatial values', () => {
  for (const legacy of [
    { ...DEFAULTS, fftMix: .29, modeCount: 256, spectralSpan: 64 },
    { ...DEFAULTS, ...SPATIAL_PRESET_DEFAULTS, fftMix: .67, spaceTarget: 'fft', spacePattern: 'scatter', spaceMotion: true, spaceRate: -.43 },
  ]) {
    const before = structuredClone(legacy), migrated = validatePreset(legacy);
    for (const [key, value] of Object.entries(legacy)) assert.equal(migrated[key], value, key);
    assert.equal(applicationForSettings(migrated), 'body-resynthesis');
    assert.equal(migrated.excitationType, 'impulse');
    assert.deepEqual(keys(migrated), keys(DEFAULT_PRESET_SETTINGS));
    assert.deepEqual(validatePreset(migrated), migrated);
    assert.deepEqual(legacy, before);
  }
});

test('capture excludes session levels, devices, input selection and transport', () => {
  const session = { ...DEFAULT_PRESET_SETTINGS, audioOn: true, inputGain: 2, outputLevel: 100,
    inputSource: 'sample-file', inputSample: 'drums', playing: true, loop: true,
    surroundEnabled: true, surroundLayout: '16-ring', surroundPreview: true, recording: true };
  assert.deepEqual(capturePreset(session), DEFAULT_PRESET_SETTINGS);
  assert.throws(() => validatePreset(session), /Incomplete/);
  assert.deepEqual(capturePreset({ ...DEFAULTS, outputLevel: .1 }), validatePreset(DEFAULTS));
});

test('saved scenes reject partial migrations, unknown fields and invalid values atomically', () => {
  const missing = { ...DEFAULT_PRESET_SETTINGS }; delete missing.reverbTime;
  const missingLegacy = { ...DEFAULTS }; delete missingLegacy.fftGateDb;
  const invalid = [
    missing, missingLegacy, { ...DEFAULTS, bodyEnabled: true },
    { ...DEFAULTS, spaceMotion: true }, { ...DEFAULTS, fftMix: 2 },
    { ...DEFAULTS, modeCount: 127 }, { ...DEFAULTS, fftSize: 1000 },
    { ...DEFAULTS, ...SPATIAL_PRESET_DEFAULTS, spaceMotion: 'false' },
    { ...DEFAULT_PRESET_SETTINGS, bodyEnabled: 'true' },
    { ...DEFAULT_PRESET_SETTINGS, filterType: 'notch' },
    { ...DEFAULT_PRESET_SETTINGS, excitationType: 'bell-recording' },
    { ...DEFAULT_PRESET_SETTINGS, excitationDurationMs: 301 },
    { ...DEFAULT_PRESET_SETTINGS, reverbTime: NaN },
    { ...DEFAULT_PRESET_SETTINGS, resynthesisMix: .2 },
  ];
  for (const value of invalid) {
    const before = structuredClone(value);
    assert.throws(() => validatePreset(value));
    assert.deepEqual(value, before);
  }
});

test('seeded dice covers all owned controls, every exciter and filter, and at least one active stage', () => {
  const previous = Object.freeze({ ...DEFAULT_PRESET_SETTINGS });
  const random = seeded(893), values = Object.fromEntries(Object.keys(previous).map(key => [key, new Set()]));
  let first;
  for (let index = 0; index < 256; index++) {
    const next = randomizePreset(previous, random);
    first ??= next;
    assert.deepEqual(validatePreset(next), next);
    assert.deepEqual(sanitizePresetSettings(next), next);
    assert(stageKeys.some(key => next[key]));
    for (const [key, value] of Object.entries(next)) values[key].add(value);
  }
  for (const [key, found] of Object.entries(values)) assert(found.size > 1, key);
  assert.deepEqual(values.excitationType, new Set(EXCITATION_TYPES));
  assert.deepEqual(values.filterType, new Set(FILTER_TYPES));
  assert.deepEqual(randomizePreset(previous, seeded(893)), first);
  assert.deepEqual(previous, DEFAULT_PRESET_SETTINGS);
  const minimum = randomizePreset(previous, () => 0), maximum = randomizePreset(previous, () => 1);
  assert.equal(minimum.excitationStrength, 0);
  assert.equal(maximum.excitationStrength, 1.5);
  assert.equal(minimum.reverbTime, .12);
  assert.equal(maximum.reverbTime, 12);
  assert(stageKeys.some(key => minimum[key]));
  assert.throws(() => randomizePreset(previous, () => NaN), /finite/);
});
