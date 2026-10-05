import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_PRESETS } from '../src/instruments/synthesis/envelope-presets.js';
import { sanitizeEnvelopePoints } from '../src/instruments/synthesis/envelope-shape.js';
import { createDefaultState, sanitizeState } from '../src/instruments/synthesis/catalog.js';
import { captureInstrumentPreset, fitRandomAttackToSequence } from '../src/instruments/synthesis/instrument-presets.js';
import { readRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';

test('release builds explicitly include the independent envelope helper before commit', async () => {
  const manifest = await readRuntimeManifest();
  const entry = manifest.entries.find(entry => entry.path === 'src/instruments/synthesis/envelope-shape.js');
  assert.equal(entry?.copy, true);
  assert.equal(entry?.required, true);
});

test('version-five shapes survive sound, whole-instrument and JSON recall without promoting legacy ADSR', () => {
  for (const preset of ENVELOPE_PRESETS) {
    const sound = sanitizeState({ ...createDefaultState('fm'), envelope: preset.envelope });
    assert.equal(sound.version, 5);
    assert.deepEqual(sound.envelope, preset.envelope);
    assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(sound))), sound);
    const snapshot = captureInstrumentPreset({ sound });
    assert.deepEqual(snapshot.sound.envelope, preset.envelope);
    assert.deepEqual(captureInstrumentPreset(JSON.parse(JSON.stringify(snapshot))), snapshot);
    if (preset.envelope.points) {
      sound.envelope.points[2].level = .123;
      assert.notEqual(preset.envelope.points[2].level, .123, 'mutable state does not modify the factory bank');
    } else assert.equal(Object.hasOwn(sound.envelope, 'points'), false);
  }
  const legacy = { ...createDefaultState('fm'), version: 4 };
  assert.deepEqual(sanitizeState(legacy).envelope, legacy.envelope);
});

test('hostile points stay finite, independently bounded, ordered and idempotent', () => {
  for (const value of [-500, 1000, NaN, Infinity, undefined]) {
    const points = sanitizeEnvelopePoints(Array.from({ length: 5 }, () => ({ time: value, level: value })));
    assert.deepEqual(sanitizeEnvelopePoints(points), points);
    points.forEach((point, index) => {
      assert.ok(Number.isFinite(point.time) && point.time >= 0 && point.time <= 64);
      assert.ok(Number.isFinite(point.level) && point.level >= 0 && point.level <= 1);
      if (index) assert.ok(point.time > points[index - 1].time);
    });
  }
  for (const value of [null, {}, [], [{ time: 0, level: 1 }]]) assert.equal(sanitizeEnvelopePoints(value), null);
});

test('random shape fitting retimes the true attack for short gates and retains independent levels and release', () => {
  for (const preset of ENVELOPE_PRESETS.filter(preset => preset.envelope.points)) {
    const sound = sanitizeState({ ...createDefaultState('fm'), envelope: preset.envelope });
    const before = structuredClone(sound);
    for (const tempoBpm of [120, 1200]) {
      const next = fitRandomAttackToSequence(sound, { id: 'basic-up', tempoBpm, gate: 65 });
      assert.ok(next.envelope.points[1].time <= 60 / tempoBpm * .65 * .25 + .000001);
      assert.deepEqual(next.envelope.points.map(point => point.level), sound.envelope.points.map(point => point.level));
      assert.ok(Math.abs((next.envelope.points[4].time - next.envelope.points[3].time) - (sound.envelope.points[4].time - sound.envelope.points[3].time)) < .000001);
    }
    assert.deepEqual(sound, before);
  }
});
