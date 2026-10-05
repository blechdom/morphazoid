import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVELOPE,
  DEFAULT_ENVELOPE_PRESET_ID,
  ENVELOPE_LIMITS,
  ENVELOPE_PRESETS,
  envelopeFromPreset,
  getEnvelopePreset,
  matchEnvelopePreset,
  nextEnvelopePreset,
  randomEnvelopePreset,
  randomizeEnvelope,
  sanitizeEnvelope,
} from '../src/instruments/synthesis/envelope-presets.js';

test('the expanded ADSR and shape presets are distinct, complete and deeply immutable', () => {
  assert.deepEqual(ENVELOPE_PRESETS.slice(0, 8).map(preset => preset.id), [
    'pluck', 'percussion', 'organ', 'brass', 'strings', 'pad', 'swell', 'drone',
  ]);
  assert.equal(ENVELOPE_PRESETS.length, 32);
  assert.equal(new Set(ENVELOPE_PRESETS.map(preset => JSON.stringify(preset.envelope))).size, ENVELOPE_PRESETS.length);
  assert.ok(Object.isFrozen(ENVELOPE_PRESETS));
  for (const preset of ENVELOPE_PRESETS) {
    assert.ok(preset.label);
    assert.ok(preset.description);
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.envelope));
    assert.deepEqual(Object.keys(preset.envelope).filter(key => key !== 'points'), Object.keys(ENVELOPE_LIMITS));
    assert.equal(matchEnvelopePreset(preset.envelope), preset);
    for (const [stage, limits] of Object.entries(ENVELOPE_LIMITS)) {
      assert.ok(preset.envelope[stage] >= limits.min && preset.envelope[stage] <= limits.max);
    }
  }
});

test('sanitization follows the editor bounds, accepts numeric fields and never mutates input', () => {
  const input = { attack: -4, decay: '99', sustain: '0.37', release: Infinity, extra: 1 };
  const original = { ...input };
  const result = sanitizeEnvelope(input, { attack: .1, decay: .2, sustain: .3, release: .4 });
  assert.deepEqual(result, { attack: .001, decay: 12, sustain: .37, release: .4 });
  assert.deepEqual(input, original);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(sanitizeEnvelope(null), DEFAULT_ENVELOPE);
});

test('lookup, value matching and preset envelopes have safe deterministic fallbacks', () => {
  const organ = getEnvelopePreset(DEFAULT_ENVELOPE_PRESET_ID);
  assert.equal(getEnvelopePreset('organ'), organ);
  assert.equal(getEnvelopePreset('missing'), organ);
  assert.equal(envelopeFromPreset('pad'), getEnvelopePreset('pad').envelope);
  assert.equal(matchEnvelopePreset({ ...getEnvelopePreset('strings').envelope })?.id, 'strings');
  assert.equal(matchEnvelopePreset({ ...getEnvelopePreset('strings').envelope, sustain: .73 }), null);
});

test('Next moves in either direction and wraps without manufacturing new preset objects', () => {
  let preset = ENVELOPE_PRESETS[0];
  for (let index = 1; index <= ENVELOPE_PRESETS.length; index += 1) preset = nextEnvelopePreset(preset);
  assert.equal(preset, ENVELOPE_PRESETS[0]);
  assert.equal(nextEnvelopePreset(ENVELOPE_PRESETS[0], -1), ENVELOPE_PRESETS.at(-1));
  assert.equal(nextEnvelopePreset('custom'), ENVELOPE_PRESETS[0]);
  assert.equal(nextEnvelopePreset('custom', -1), ENVELOPE_PRESETS.at(-1));
});

test('preset and parameter random helpers are deterministic, bounded and immutable', () => {
  assert.equal(randomEnvelopePreset(() => 0), ENVELOPE_PRESETS[0]);
  assert.equal(randomEnvelopePreset(() => 1), ENVELOPE_PRESETS.at(-1));
  assert.notEqual(randomEnvelopePreset(() => 0, { excludeId: 'pluck' }).id, 'pluck');
  const first = randomizeEnvelope(() => .5);
  const second = randomizeEnvelope(() => .5);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  for (const [stage, limits] of Object.entries(ENVELOPE_LIMITS)) {
    assert.ok(first[stage] >= limits.min && first[stage] <= limits.max);
  }
  assert.notEqual(matchEnvelopePreset(first), getEnvelopePreset('organ'));
  assert.equal(first.points.length, 5);
  for (const bad of [NaN, Infinity, -1, 2]) {
    const envelope = randomizeEnvelope(() => bad);
    assert.ok(envelope.points.every(point => Number.isFinite(point.time) && Number.isFinite(point.level)));
    assert.ok(envelope.points[1].level >= .65);
  }
});
