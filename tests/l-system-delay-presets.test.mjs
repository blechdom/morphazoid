import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { captureScene, presetState, DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE } from '../src/instruments/micmic/native/model.js';
import { DEFAULT_MASTERING } from '../src/instruments/micmic/native/mastering.js';

const presets = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
const order = ['pythagorean', 'bramble', 'venus', 'ivy', 'binary', 'coral', 'moss', 'plant', 'kelp', 'dragon',
  'koch', 'clean', 'orchid', 'willow', 'mangrove', 'sequoia', 'cedar', 'aspen', 'juniper', 'baobab',
  'foxglove', 'lotus', 'acacia', 'lichen', 'moonflower', 'horsetail'];
const external = { source: 'mic', frozen: true, frequency: 311, pulseRate: .7, automatic: false, voiceCeiling: 777 };
const ownedMix = ['wet', 'dry', 'inputGain', 'level'];
const changedMastering = { ...DEFAULT_MASTERING, inputHighpassHz: 320, highpassHz: 710, lowpassHz: 2300,
  thresholdDb: -41, ratio: 4, kneeDb: 20, attackMs: 40, releaseMs: 710,
  makeupDb: 9, compressorEnabled: false, autoMakeup: false };

test('all factory presets remain in the former button order without a second preset surface', async () => {
  assert.deepEqual(presets.map(preset => preset.id), order);
  const html = await readFile(new URL('../src/pages/l-mic-rust.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-generation-preset/);
  assert.equal(new Set(presets.map(preset => preset.id)).size, order.length);
});

test('every pair of factory recalls restores the destination full scene independently of its predecessor', () => {
  for (const previous of presets) for (const target of presets) {
    const live = { ...DEFAULT_PERFORMANCE, ...previous.snapshot.performance, ...external };
    const before = structuredClone(live), snapshot = structuredClone(target.snapshot);
    const recalled = presetState(target, live);
    assert.deepEqual(captureScene(recalled.parameters, recalled.performance), target.snapshot,
      `${previous.id} → ${target.id}: all parameters, mix, output and mastering`);
    for (const [key, value] of Object.entries(external)) assert.equal(recalled.performance[key], value,
      `${previous.id} → ${target.id}: preserves external ${key}`);
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
  }
});

test('legacy missing owned fields reset defaults instead of inheriting the preceding scene', () => {
  const live = { ...DEFAULT_PERFORMANCE, ...external, wet: .13, dry: .31, inputGain: 1.41, level: .21,
    mastering: changedMastering };
  const legacy = { snapshot: { parameters: { generations: 4, angle: 71 }, performance: { wet: .64 } } };
  const recalled = presetState(legacy, live);
  assert.deepEqual(recalled.parameters, { ...DEFAULT_PARAMETERS, generations: 4, angle: 71 });
  for (const key of ownedMix) assert.equal(recalled.performance[key], key === 'wet' ? .64 : DEFAULT_PERFORMANCE[key], key);
  assert.deepEqual(recalled.performance.mastering, DEFAULT_MASTERING);
  for (const [key, value] of Object.entries(external)) assert.equal(recalled.performance[key], value);
  const partialMastering = presetState({ snapshot: { parameters: {}, performance: { mastering: { thresholdDb: -26 } } } }, live);
  assert.deepEqual(partialMastering.performance.mastering, { ...DEFAULT_MASTERING, thresholdDb: -26 });
  const noPerformance = presetState({ snapshot: { parameters: {} } }, live);
  for (const key of ownedMix) assert.equal(noPerformance.performance[key], DEFAULT_PERFORMANCE[key], key);
  assert.deepEqual(noPerformance.performance.mastering, DEFAULT_MASTERING);
});

test('preset import cannot replace live microphone, freeze or device admission policy', () => {
  const snapshot = { parameters: {}, performance: { source: 'seed', frozen: false, automatic: true, voiceCeiling: 12,
    frequency: 440, pulseRate: 3, wet: .63 } };
  const recalled = presetState({ snapshot }, { ...DEFAULT_PERFORMANCE, ...external });
  for (const key of ['source', 'frozen', 'automatic', 'voiceCeiling']) assert.equal(recalled.performance[key], external[key], key);
  assert.equal(recalled.performance.frequency, 440); assert.equal(recalled.performance.pulseRate, 3);
});
