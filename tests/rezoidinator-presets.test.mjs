import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULTS } from '../src/instruments/simd-resonator-rust/model.js';
import { SIMD_RESONATOR_FULL_PRESETS } from '../src/families/simd-resonator/simd-resonator-presets.js';
import { EXCITATION_TYPES, FILTER_TYPES, SIGNAL_DEFAULTS, STAGE_ORDERS } from '../src/instruments/simd-resonator-rust/signal-path.js';
import {
  PRESETS, DEFAULT_PRESET_SETTINGS, SPATIAL_PRESET_DEFAULTS, APPLICATION_MODES,
  REVERB_CHARACTERS, RESYNTHESIS_CHARACTERS, applicationForSettings, signalSettingsForPreset,
  sanitizePresetSettings, capturePreset, validatePreset, randomizePreset,
} from '../src/instruments/simd-resonator-rust/presets.js';

const stageKeys = ['bodyEnabled', 'processingEnabled', 'resynthesisEnabled', 'reverbEnabled'];
const removedKeys = [...stageKeys, 'stageOrder', 'spaceTarget', 'resynthesisMix'];
const roleFlags = { body: 'bodyEnabled', processing: 'processingEnabled', reverb: 'reverbEnabled', resynthesis: 'resynthesisEnabled' };
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const keys = value => Object.keys(value).sort();
function assertExclusive(settings, expected = settings.applicationMode) {
  for (const key of removedKeys) assert(!Object.hasOwn(settings, key), key + ' must not be preset state');
  const signal = signalSettingsForPreset(settings);
  for (const key of stageKeys) assert.equal(signal[key], key === roleFlags[expected], key);
  assert.equal(signal.stageOrder, SIGNAL_DEFAULTS.stageOrder);
  assert.equal(signal.resynthesisMix, settings.fftMix);
}
function historicalScene() {
  const { resynthesisMix, stageOrder: _order, ...signal } = SIGNAL_DEFAULTS;
  return { ...DEFAULTS, ...SPATIAL_PRESET_DEFAULTS, spaceTarget: 'both', ...signal,
    fftMix: resynthesisMix, excitationType: 'pluck', excitationStrength: .8, excitationDurationMs: 18 };
}

test('Rezoidinator starts as one plucked body and retains all twenty factory IDs', () => {
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
  const denseRoles = ['body', 'body', 'body', 'resynthesis', 'processing', 'reverb', 'body', 'resynthesis'];
  for (const [index, preset] of PRESETS.entries()) {
    const state = preset.snapshot;
    assert.equal(state.applicationMode, index < 8 ? denseRoles[index] : index < 12 ? 'body' : 'resynthesis', preset.id);
    assert.deepEqual(validatePreset(state), state);
    assert.deepEqual(sanitizePresetSettings(state), state);
    assert.deepEqual(keys(state), keys(DEFAULT_PRESET_SETTINGS));
    assertExclusive(state);
    assert(state.wetMix > 0 && state.excitationStrength > 0 && state.fftInputGain > 0, preset.id);
    const mixKey = { body: 'bodyMix', reverb: 'reverbMix', resynthesis: 'fftMix' }[state.applicationMode];
    if (mixKey) assert(state[mixKey] > 0, preset.id);
  }
  assert.deepEqual(new Set(PRESETS.map(preset => preset.snapshot.excitationType)), new Set(EXCITATION_TYPES));
});

test('the explicitly spectral classic scenes preserve their FFT values in the resynthesis role', () => {
  for (const original of SIMD_RESONATOR_FULL_PRESETS.slice(4)) {
    const snapshot = PRESETS.find(preset => preset.id === 'classic:' + original.id).snapshot;
    for (const [key, value] of Object.entries(original.snapshot)) assert.equal(snapshot[key], value, original.id + ':' + key);
    assertExclusive(snapshot, 'resynthesis');
    assert.equal(snapshot.excitationType, 'impulse');
  }
});

test('one of four roles changes without replacing timbres, mixes or spatial motion', () => {
  const previous = sanitizePresetSettings({ baseFrequency: 137, filterType: 'highpass', filterFrequency: 1300,
    reverbTime: 7, reverbDamping: .81, excitationType: 'pink-noise', fftResponseMs: 415,
    bodyMix: .42, fftMix: .74, reverbMix: .29, spaceMotion: true, spaceRate: -.35 });
  assert.deepEqual(APPLICATION_MODES.map(mode => mode.id), ['body', 'processing', 'reverb', 'resynthesis']);
  for (const mode of APPLICATION_MODES) {
    assert.deepEqual(keys(mode.settings), [...stageKeys].sort());
    assert.equal(stageKeys.filter(key => mode.settings[key]).length, 1);
    const next = sanitizePresetSettings({ ...previous, applicationMode: mode.id });
    assert.equal(applicationForSettings(next), mode.id);
    assertExclusive(next, mode.id);
    for (const key of Object.keys(previous)) if (key !== 'applicationMode') assert.equal(next[key], previous[key], mode.id + ':' + key);
  }
});

test('live sanitization and engine mapping ignore latent chain flags and order', () => {
  for (const mode of APPLICATION_MODES) for (const stageOrder of STAGE_ORDERS) for (let mask = 0; mask < 16; mask++) {
    const flags = Object.fromEntries(stageKeys.map((key, index) => [key, Boolean(mask & (1 << index))]));
    const incoming = { ...DEFAULT_PRESET_SETTINGS, applicationMode: mode.id, ...flags, stageOrder,
      spaceTarget: 'both', fftMix: .53, resynthesisMix: 1 };
    const canonical = sanitizePresetSettings(incoming), engine = signalSettingsForPreset(incoming);
    assertExclusive(canonical, mode.id);
    assert.equal(engine.stageOrder, SIGNAL_DEFAULTS.stageOrder);
    assert.equal(engine.resynthesisMix, .53);
    for (const key of stageKeys) assert.equal(engine[key], key === roleFlags[mode.id]);
  }
  assertExclusive(sanitizePresetSettings({ resynthesisEnabled: true, reverbEnabled: true }), 'body');
  assertExclusive(sanitizePresetSettings({ applicationMode: 'body-reverb' }), 'body');
});

test('focused reverb and FFT characters preserve the role and every unrelated parameter', () => {
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

test('live sanitization supplies complete bounded native parameter values', () => {
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
  assertExclusive(state);
});

test('pre-role modal and spatial scenes migrate to resynthesis without losing their retained values', () => {
  for (const legacy of [
    { ...DEFAULTS, fftMix: .29, modeCount: 256, spectralSpan: 64 },
    { ...DEFAULTS, ...SPATIAL_PRESET_DEFAULTS, spaceTarget: 'fft', fftMix: .67, spacePattern: 'scatter', spaceMotion: true, spaceRate: -.43 },
  ]) {
    const before = structuredClone(legacy), migrated = validatePreset(legacy);
    for (const [key, value] of Object.entries(legacy)) if (key !== 'spaceTarget') assert.equal(migrated[key], value, key);
    assertExclusive(migrated, 'resynthesis');
    assert.equal(migrated.excitationType, 'impulse');
    assert.deepEqual(keys(migrated), keys(DEFAULT_PRESET_SETTINGS));
    assert.deepEqual(validatePreset(migrated), migrated);
    assert.deepEqual(legacy, before);
  }
});

test('all complete historical chain combinations migrate with explicit single-role priority', () => {
  for (let mask = 0; mask < 16; mask++) for (const stageOrder of [null, ...STAGE_ORDERS]) {
    const flags = Object.fromEntries(stageKeys.map((key, index) => [key, Boolean(mask & (1 << index))]));
    const legacy = { ...historicalScene(), ...flags, fftMix: .39, bodyMix: .63, reverbMix: .27,
      filterFrequency: 3710, spaceTarget: 'modes', spaceSpan: 2.1,
      ...(stageOrder ? { stageOrder } : {}) };
    const expected = flags.resynthesisEnabled ? 'resynthesis' : flags.bodyEnabled ? 'body'
      : flags.reverbEnabled ? 'reverb' : flags.processingEnabled ? 'processing' : 'body';
    const before = structuredClone(legacy), migrated = validatePreset(legacy);
    assertExclusive(migrated, expected);
    for (const [key, value] of Object.entries(legacy)) if (!removedKeys.includes(key)) assert.equal(migrated[key], value, key);
    assert.deepEqual(capturePreset({ ...legacy, outputLevel: .5, playing: true }), migrated);
    assert.deepEqual(validatePreset(migrated), migrated);
    assert.deepEqual(legacy, before);
  }
});

test('capture excludes session levels, devices, input selection and obsolete routing fields', () => {
  const session = { ...DEFAULT_PRESET_SETTINGS, audioOn: true, inputGain: 2, outputLevel: 100,
    inputSource: 'sample-file', inputSample: 'drums', playing: true, loop: true,
    surroundEnabled: true, surroundLayout: '16-ring', surroundPreview: true, recording: true,
    stageOrder: STAGE_ORDERS[5], resynthesisEnabled: true, spaceTarget: 'fft' };
  assert.deepEqual(capturePreset(session), DEFAULT_PRESET_SETTINGS);
  assert.throws(() => validatePreset(session), /Incomplete/);
  assert.deepEqual(capturePreset({ ...DEFAULTS, outputLevel: .1 }), validatePreset(DEFAULTS));
});

test('saved scenes reject incomplete canonical states and corrupt historical formats atomically', () => {
  const missing = { ...DEFAULT_PRESET_SETTINGS }; delete missing.reverbTime;
  const missingRole = { ...DEFAULT_PRESET_SETTINGS }; delete missingRole.applicationMode;
  const missingLegacy = { ...DEFAULTS }; delete missingLegacy.fftGateDb;
  const missingFlag = historicalScene(); delete missingFlag.processingEnabled;
  const missingTarget = historicalScene(); delete missingTarget.spaceTarget;
  const invalid = [
    missing, missingRole, missingLegacy, missingFlag, missingTarget,
    { ...DEFAULTS, bodyEnabled: true }, { ...DEFAULTS, spaceMotion: true }, { ...DEFAULTS, fftMix: 2 },
    { ...DEFAULTS, modeCount: 127 }, { ...DEFAULTS, fftSize: 1000 },
    { ...DEFAULT_PRESET_SETTINGS, applicationMode: 'all' },
    { ...DEFAULT_PRESET_SETTINGS, applicationMode: undefined },
    { ...DEFAULT_PRESET_SETTINGS, bodyEnabled: true },
    { ...DEFAULT_PRESET_SETTINGS, stageOrder: STAGE_ORDERS[0] },
    { ...DEFAULT_PRESET_SETTINGS, spaceTarget: 'both' },
    { ...DEFAULT_PRESET_SETTINGS, filterType: 'notch' },
    { ...DEFAULT_PRESET_SETTINGS, excitationType: 'bell-recording' },
    { ...DEFAULT_PRESET_SETTINGS, excitationDurationMs: 301 },
    { ...DEFAULT_PRESET_SETTINGS, reverbTime: NaN },
    { ...DEFAULT_PRESET_SETTINGS, resynthesisMix: .2 },
    { ...historicalScene(), bodyEnabled: 'true' },
    { ...historicalScene(), filterFrequency: Infinity },
    { ...historicalScene(), spaceTarget: 'unknown' },
    { ...historicalScene(), outputLevel: .5 },
    { ...historicalScene(), stageOrder: 'process-process-reverb' },
    { ...historicalScene(), stageOrder: ['process', 'resonance', 'reverb'] },
    { ...historicalScene(), stageOrder: undefined },
  ];
  for (const value of invalid) {
    const before = structuredClone(value);
    assert.throws(() => validatePreset(value));
    assert.deepEqual(value, before);
  }
});

test('seeded dice covers every owned parameter and all four exclusive roles', () => {
  const previous = Object.freeze({ ...DEFAULT_PRESET_SETTINGS });
  const random = seeded(893), values = Object.fromEntries(Object.keys(previous).map(key => [key, new Set()]));
  let first;
  for (let index = 0; index < 256; index++) {
    const next = randomizePreset(previous, random);
    first ??= next;
    assert.deepEqual(validatePreset(next), next);
    assert.deepEqual(sanitizePresetSettings(next), next);
    assertExclusive(next);
    for (const [key, value] of Object.entries(next)) values[key].add(value);
  }
  for (const [key, found] of Object.entries(values)) assert(found.size > 1, key);
  assert.deepEqual(values.excitationType, new Set(EXCITATION_TYPES));
  assert.deepEqual(values.filterType, new Set(FILTER_TYPES));
  assert.deepEqual(values.applicationMode, new Set(Object.keys(roleFlags)));
  assert.deepEqual(randomizePreset(previous, seeded(893)), first);
  assert.deepEqual(previous, DEFAULT_PRESET_SETTINGS);
  const minimum = randomizePreset(previous, () => 0), maximum = randomizePreset(previous, () => 1);
  assert.equal(minimum.excitationStrength, 0);
  assert.equal(maximum.excitationStrength, 1.5);
  assert.equal(minimum.reverbTime, .12);
  assert.equal(maximum.reverbTime, 12);
  assertExclusive(minimum); assertExclusive(maximum);
  assert.throws(() => randomizePreset(previous, () => NaN), /finite/);
});
