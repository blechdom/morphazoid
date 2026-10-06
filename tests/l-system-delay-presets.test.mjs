import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { captureScene, presetState, DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, L_SYSTEM_TYPES } from '../src/instruments/micmic/native/model.js';
import { DEFAULT_MASTERING, captureMastering } from '../src/instruments/micmic/native/mastering.js';

const presets = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
const order = ['pythagorean', 'bramble', 'venus', 'ivy', 'binary', 'coral', 'moss', 'plant', 'kelp', 'dragon',
  'koch', 'clean', 'orchid', 'willow', 'mangrove', 'sequoia', 'cedar', 'aspen', 'juniper', 'baobab',
  'foxglove', 'lotus', 'acacia', 'lichen', 'moonflower', 'horsetail'];
const external = { source: 'mic', frozen: true, frequency: 311, pulseRate: .7, automatic: false, voiceCeiling: 777,
  inputGain: 3.25, level: 0 };
const ownedMix = ['wet', 'dry'];
const changedMastering = { ...DEFAULT_MASTERING, inputHighpassHz: 320, highpassHz: 710, lowpassHz: 2300,
  thresholdDb: -41, ratio: 4, kneeDb: 20, attackMs: 40, releaseMs: 710,
  makeupDb: 9, compressorEnabled: false, autoMakeup: false };

test('the original factory presets remain first in the former button order without a second preset surface', async () => {
  assert.deepEqual(presets.slice(0, order.length).map(preset => preset.id), order);
  const html = await readFile(new URL('../src/pages/l-mic-rust.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-generation-preset/);
  assert.equal(new Set(presets.map(preset => preset.id)).size, presets.length);
});

test('the expanded bank covers every grammar and contrasting timing, pitch, density and mastering settings', () => {
  const additions = presets.slice(order.length);
  assert.ok(additions.length >= 80, 'the expansion supplies a substantial bank of new scenes');
  assert.equal(new Set(presets.map(preset => JSON.stringify(preset.snapshot))).size, presets.length,
    'every factory scene has distinct sound settings');
  for (const grammar of L_SYSTEM_TYPES) {
    assert.ok(additions.filter(preset => preset.snapshot.parameters.lSystemType === grammar).length >= 6,
      `${grammar} offers several new sound choices`);
  }
  const parameters = additions.map(preset => preset.snapshot.parameters);
  for (const [key, low, high] of [
    ['intervalMs', 2, 2500], ['timeRatio', .3, 1.7], ['pitchScale', 0, 3.5],
    ['depth', .35, .9], ['spread', 0, 1], ['mutation', 0, .85], ['generations', 6, 20],
  ]) {
    assert.ok(parameters.some(p => p[key] <= low), `${key} includes its low region`);
    assert.ok(parameters.some(p => p[key] >= high), `${key} includes its high region`);
  }
  const mastering = additions.map(preset => preset.snapshot.performance.mastering);
  assert.deepEqual(new Set(mastering.map(m => m.compressorEnabled)), new Set([false, true]));
  assert.ok(new Set(mastering.map(m => JSON.stringify(m))).size >= 7, 'master buses have contrasting characters');
  assert.ok(mastering.some(m => m.highpassHz >= 350 && m.lowpassHz <= 3500 && m.lowpassHz > 0),
    'the bank includes a band-limited texture');
  assert.ok(mastering.some(m => m.highpassHz === 0 && m.lowpassHz === 0 && !m.compressorEnabled),
    'the bank includes unfiltered, uncompressed scenes');
  for (const preset of additions) {
    assert.deepEqual(Object.keys(preset.snapshot.performance).sort(), ['dry', 'mastering', 'wet'],
      `${preset.id} cannot own input, gain or device capacity`);
    assert.deepEqual(preset.snapshot.performance.mastering, captureMastering(preset.snapshot.performance.mastering),
      `${preset.id} contains a complete master bus without live output boost`);
  }
});

test('every pair of factory recalls restores the destination full scene independently of its predecessor', () => {
  for (const previous of presets) for (const target of presets) {
    const live = { ...DEFAULT_PERFORMANCE, ...previous.snapshot.performance, ...external,
      mastering: { ...previous.snapshot.performance.mastering, makeupDb: 24 } };
    const before = structuredClone(live), snapshot = structuredClone(target.snapshot);
    const recalled = presetState(target, live);
    assert.deepEqual(captureScene(recalled.parameters, recalled.performance), target.snapshot,
      `${previous.id} → ${target.id}: all parameters, mix, filters and compression`);
    for (const [key, value] of Object.entries(external)) assert.equal(recalled.performance[key], value,
      `${previous.id} → ${target.id}: preserves external ${key}`);
    assert.equal(recalled.performance.mastering.makeupDb, 24, 'recall preserves live output boost');
    assert.deepEqual(live, before, 'recall cannot mutate the current scene');
    assert.deepEqual(target.snapshot, snapshot, 'recall cannot mutate factory data');
  }
});

test('a saved custom scene restores its complete capture after arbitrary edits', () => {
  const parameters = { ...DEFAULT_PARAMETERS, lSystemType: 'dragon', generations: 9, intervalMs: 641,
    timeRatio: 1.4, angle: 111, asymmetry: -.4, mutation: .7, pitchScale: 3, pruningBias: .85, depth: .9, spread: .15 };
  const performance = { ...DEFAULT_PERFORMANCE, ...external, wet: .37, dry: .21, inputGain: 1.14, level: .27,
    mastering: changedMastering };
  const snapshot = captureScene(parameters, performance);
  for (const previous of presets) {
    const live = { ...DEFAULT_PERFORMANCE, ...previous.snapshot.performance, ...external };
    const recalled = presetState({ snapshot }, live);
    assert.deepEqual(captureScene(recalled.parameters, recalled.performance), snapshot, previous.id);
    for (const [key, value] of Object.entries(external)) assert.equal(recalled.performance[key], value);
    assert.equal(recalled.performance.mastering.makeupDb, DEFAULT_MASTERING.makeupDb);
  }
});

test('legacy missing owned fields reset defaults instead of inheriting the preceding scene', () => {
  const live = { ...DEFAULT_PERFORMANCE, ...external, wet: .13, dry: .31, inputGain: 1.41, level: .21,
    mastering: changedMastering };
  const legacy = { snapshot: { parameters: { generations: 4, angle: 71 }, performance: { wet: .64 } } };
  const recalled = presetState(legacy, live);
  assert.deepEqual(recalled.parameters, { ...DEFAULT_PARAMETERS, generations: 4, angle: 71 });
  for (const key of ownedMix) assert.equal(recalled.performance[key], key === 'wet' ? .64 : DEFAULT_PERFORMANCE[key], key);
  assert.deepEqual(recalled.performance.mastering, { ...DEFAULT_MASTERING, makeupDb: changedMastering.makeupDb });
  for (const key of ['source', 'frozen', 'frequency', 'pulseRate', 'automatic', 'voiceCeiling', 'inputGain', 'level']) {
    assert.equal(recalled.performance[key], live[key]);
  }
  const partialMastering = presetState({ snapshot: { parameters: {}, performance: { mastering: { thresholdDb: -26 } } } }, live);
  assert.deepEqual(partialMastering.performance.mastering, { ...DEFAULT_MASTERING, thresholdDb: -26, makeupDb: changedMastering.makeupDb });
  const noPerformance = presetState({ snapshot: { parameters: {} } }, live);
  for (const key of ownedMix) assert.equal(noPerformance.performance[key], DEFAULT_PERFORMANCE[key], key);
  assert.deepEqual(noPerformance.performance.mastering, { ...DEFAULT_MASTERING, makeupDb: changedMastering.makeupDb });
});

test('saved scene identity excludes live levels and legacy level fields cannot override them', () => {
  const sound = { ...DEFAULT_PERFORMANCE, wet: .31, dry: .23, mastering: changedMastering };
  const snapshot = captureScene(DEFAULT_PARAMETERS, sound);
  assert.deepEqual(Object.keys(snapshot.performance).sort(), ['dry', 'mastering', 'wet']);
  assert.deepEqual(snapshot.performance.mastering, captureMastering(changedMastering));
  const legacy = { ...snapshot, performance: { ...snapshot.performance, inputGain: 0, level: 1,
    mastering: { ...snapshot.performance.mastering, makeupDb: -12 } } };
  for (const inputGain of [0, .85, 4]) for (const level of [0, .27, 1]) for (const makeupDb of [-12, 9, 24]) {
    const live = { ...sound, inputGain, level, mastering: { ...changedMastering, makeupDb } };
    assert.deepEqual(captureScene(DEFAULT_PARAMETERS, live), snapshot, 'level edits cannot mark a sound Custom');
    const recalled = presetState({ snapshot: legacy }, live);
    assert.equal(recalled.performance.inputGain, inputGain);
    assert.equal(recalled.performance.level, level);
    assert.equal(recalled.performance.mastering.makeupDb, makeupDb);
    assert.deepEqual(captureScene(recalled.parameters, recalled.performance), snapshot);
  }
});

test('preset import cannot replace live microphone, freeze or device admission policy', () => {
  const snapshot = { parameters: {}, performance: { source: 'seed', frozen: false, automatic: true, voiceCeiling: 12,
    frequency: 440, pulseRate: 3, wet: .63 } };
  const recalled = presetState({ snapshot }, { ...DEFAULT_PERFORMANCE, ...external });
  for (const key of ['source', 'frozen', 'automatic', 'voiceCeiling']) assert.equal(recalled.performance[key], external[key], key);
  assert.equal(recalled.performance.frequency, 440); assert.equal(recalled.performance.pulseRate, 3);
});
