import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FM_DRUM_VOICES, sanitizeFmDrumVoice } from '../src/instruments/fm-drums/fm-drums.js';
import { RUBIX_DEFAULTS } from '../src/instruments/rubix/factory-presets.js';
import { RUBIX_FULL_PRESETS, validateRubixFullPreset } from '../src/instruments/rubix/full-presets.js';
import { presetRandom } from '../src/site/preset-random.js';
import { RUBIX_BANK_CONTROLS, rubixBankDefaults, rubixBankParams, changeRubixBankParam, cloneRubixBankParams, validateRubixBankParams, randomizeRubixBankParams, rubixVoiceWithParams, rubixExtraSettings, rubixBankFrequency } from '../src/instruments/rubix/sound-params.js';

test('neutral native controls preserve every saved voice and the original extra-kit render recipes', () => {
  for (const bank of ['soft-fm', 'analog', 'modal', 'noise', 'rattlesnake', 'pitched-morph']) {
    const params = rubixBankDefaults(bank);
    for (const voice of DEFAULT_FM_DRUM_VOICES) {
      assert.deepEqual(sanitizeFmDrumVoice(rubixVoiceWithParams(voice, params)), sanitizeFmDrumVoice(voice));
      assert.equal(rubixBankFrequency(voice.frequency, 'red', params), voice.frequency);
    }
  }
  for (const [bank, decay] of [['rattlesnake', .42], ['pitched-morph', .48]]) {
    assert.deepEqual(rubixExtraSettings(bank, rubixBankDefaults(bank)), { attack: .0015, decay, hardness: .62, inharmonicity: .58, strikeNoise: 1, ...(bank === 'rattlesnake' ? {pitchFall: 1} : {}), morphWidth: 1.05 });
  }
});

test('shared banks inherit the exact old trigger defaults until edited', () => {
  for (const bank of Object.keys(RUBIX_BANK_CONTROLS).filter(id => id.startsWith('shared-'))) {
    const p = rubixBankDefaults(bank, RUBIX_DEFAULTS);
    assert.equal(p.duration, RUBIX_DEFAULTS.acidDecay);
    assert.equal(p.brightness, (RUBIX_DEFAULTS.cutoff - 160) / 4040);
    assert.equal(p.cutoff, 1400 + p.brightness * 12500);
    assert.equal(p.attack, .004); assert.equal(p.decay, .045); assert.equal(p.release, .055);
    assert.equal(p.drive, RUBIX_DEFAULTS.drive);
    for (const frequency of [65.4, 110, 261.6, 4000]) assert.equal(rubixBankFrequency(frequency, 'white', p), frequency);
  }
});

test('bank edits retain other banks, preserve caller state and roundtrip through complete presets', () => {
  const first = changeRubixBankParam(null, 'soft-fm', 'fmDepth', 2, RUBIX_DEFAULTS);
  const second = changeRubixBankParam(first, 'shared-simd-chiptune', 'rootHz', 144, RUBIX_DEFAULTS);
  assert.equal(Object.keys(first.banks).length, 1);
  assert.equal(second.banks['soft-fm'].fmDepth, 2);
  assert.equal(second.banks['shared-simd-chiptune'].rootHz, 144);
  assert.deepEqual(cloneRubixBankParams(second), second);
  const preset = {...structuredClone(RUBIX_FULL_PRESETS[0].snapshot), bankParams: second};
  assert.equal(validateRubixFullPreset(preset), preset);
  assert.equal(rubixBankParams('soft-fm', null).fmDepth, 1);
  assert.equal(Object.hasOwn(RUBIX_FULL_PRESETS[0].snapshot, 'bankParams'), false);
});

test('malformed sound maps reject without silently dropping accepted preset data', () => {
  for (const banks of [true, 3, '', [], null]) assert.throws(() => validateRubixBankParams({version: 1, banks}));
  const map = changeRubixBankParam(null, 'soft-fm', 'fmDepth', 1);
  for (const value of [NaN, Infinity, -1, 20]) assert.throws(() => validateRubixBankParams({version: 1, banks: {'soft-fm': {...map.banks['soft-fm'], fmDepth: value}}}));
  assert.throws(() => validateRubixFullPreset({...RUBIX_FULL_PRESETS[0].snapshot, bankParams: null}));
  assert.equal(cloneRubixBankParams(null), null);
});

test('pitch maps and root changes have independent, bounded destinations', () => {
  const original = rubixBankDefaults('shared-sine');
  assert.equal(rubixBankFrequency(110, 'white', {...original, transpose: 12}), 220);
  assert.equal(rubixBankFrequency(110, 'white', {...original, rootHz: 220}), 220);
  assert.equal(rubixBankFrequency(110, 'red', {...original, tuning: 'harmonic'}), 165);
  assert.notEqual(rubixBankFrequency(110, 'blue', {...original, tuning: 'minor'}), rubixBankFrequency(110, 'blue', {...original, tuning: 'pentatonic'}));
  assert.equal(rubixBankFrequency(8000, 'red', {...original, rootHz: 440, transpose: 24, pitchSpread: 2}), 12000);
});

test('randomization covers every new bank parameter and remains valid finite JSON', () => {
  let seed = 92; const rng = presetRandom(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; });
  const seen = new Map();
  for (let i = 0; i < 40; i++) {
    const map = randomizeRubixBankParams(rng); validateRubixBankParams(map);
    for (const [bank, params] of Object.entries(map.banks)) for (const [key, value] of Object.entries(params)) {
      const id = `${bank}:${key}`; if (!seen.has(id)) seen.set(id, new Set()); seen.get(id).add(value);
    }
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, key);
});
