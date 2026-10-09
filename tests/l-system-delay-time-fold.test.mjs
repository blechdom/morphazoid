import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { MIN_TIME_FOLD_MS, MAX_TIME_FOLD_MS, timeFoldFromSlider, sliderFromTimeFold,
  formatTimeFold } from '../src/instruments/micmic/native/time-fold.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, sanitizeParameters, presetState, captureScene,
  gestureParameters, buildPreview } from '../src/instruments/micmic/native/model.js';
import { generationTopology, timeFoldFromSlider as originalTimeFoldFromSlider,
  sliderFromTimeFold as originalSliderFromTimeFold } from '../src/instruments/micmic/micmic.js';
import { PRESETS as parametricPresets } from '../src/instruments/l-system-parametric-lab/config.js';
import { PRESETS as experimentPresets } from '../src/instruments/l-system-experiments/config.js';

const nativePresets = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12,
  `${actual} should equal ${expected}`);

test('native fold mapping has useful sub-ms travel and preserves established larger-fold anchors', () => {
  assert.equal(MIN_TIME_FOLD_MS, .05);
  assert.equal(MAX_TIME_FOLD_MS, 3000);
  assert.deepEqual([0, 150, 300, 900, 1000].map(timeFoldFromSlider), [.05, 50, 240, 1000, 3000]);
  assert.ok(sliderFromTimeFold(1) > 60, 'sub-ms folds occupy usable dial travel');
  for (const milliseconds of [.05, .051, .075, .1, .375, .999, 1, 2.45, 14, 38, 50, 50.125, 240, 641.125, 1000, 2300.5, 3000]) {
    close(timeFoldFromSlider(sliderFromTimeFold(milliseconds)), milliseconds);
  }
  let previous = timeFoldFromSlider(0);
  for (let position = .125; position <= 1000; position += .125) {
    const milliseconds = timeFoldFromSlider(position);
    assert.ok(milliseconds > previous, `${position}: no quantized plateaus`);
    close(sliderFromTimeFold(milliseconds), position);
    previous = milliseconds;
  }
  assert.equal(timeFoldFromSlider(-1), .05);
  assert.equal(timeFoldFromSlider(1001), 3000);
  assert.equal(sliderFromTimeFold(0), 0);
  assert.equal(sliderFromTimeFold(3001), 1000);
});

test('original JS delay keeps its existing minimum, anchors and whole-ms mapping', () => {
  assert.deepEqual([0, 150, 300, 900, 1000].map(originalTimeFoldFromSlider), [1, 50, 240, 1000, 3000]);
  assert.equal(originalSliderFromTimeFold(.05), 0);
  assert.equal(originalTimeFoldFromSlider(originalSliderFromTimeFold(2.45)), 2);
});

test('sub-ms custom folds remain exact through capture, recall, and viewport gestures', () => {
  for (const intervalMs of [.05, .075, .125, .999, 1.125]) {
    const parameters = { ...DEFAULT_PARAMETERS, intervalMs };
    assert.equal(sanitizeParameters(parameters).intervalMs, intervalMs);
    const saved = captureScene(parameters, DEFAULT_PERFORMANCE);
    const recalled = presetState({ snapshot: saved }, { ...DEFAULT_PERFORMANCE, inputGain: 2.5, level: .19 });
    assert.deepEqual(captureScene(recalled.parameters, recalled.performance), saved);
    assert.equal(recalled.performance.inputGain, 2.5);
    assert.equal(recalled.performance.level, .19);
    assert.equal(gestureParameters(parameters, -10000, 0, 1000, 700).intervalMs, intervalMs);
    assert.equal(gestureParameters(parameters, 10000, 0, 1000, 700).intervalMs, intervalMs);
    assert.equal(gestureParameters(parameters, -10000, 0, 1000, 700).pitchOffset, -24);
    assert.equal(gestureParameters(parameters, 10000, 0, 1000, 700).pitchOffset, 24);
  }
  assert.equal(sanitizeParameters({ intervalMs: 0 }).intervalMs, .05);
  assert.equal(sanitizeParameters({ intervalMs: 3001 }).intervalMs, 3000);
});

test('every existing classic, parametric and experimental preset keeps its sound and fold value', () => {
  for (const preset of [...nativePresets, ...parametricPresets, ...experimentPresets]) {
    const recalled = presetState(preset, DEFAULT_PERFORMANCE);
    assert.deepEqual(captureScene(recalled.parameters, recalled.performance), preset.snapshot, preset.id);
    close(timeFoldFromSlider(sliderFromTimeFold(recalled.parameters.intervalMs)), preset.snapshot.parameters.intervalMs);
  }
});

test('sub-ms preview timing changes leave branch geometry and inherited pitch intact', () => {
  const parameters = { ...DEFAULT_PARAMETERS, generations: 4, intervalMs: 1 };
  const previous = buildPreview(parameters, generationTopology);
  const shorter = buildPreview({ ...parameters, intervalMs: .05 }, generationTopology);
  assert.equal(shorter.length, previous.length);
  for (let index = 0; index < shorter.length; index++) {
    const node = shorter[index], reference = previous[index];
    for (const key of ['id', 'parentId', 'x', 'y', 'startX', 'startY', 'rate', 'gain', 'pan']) assert.equal(node[key], reference[key], `${index}/${key}`);
    close(node.delay, reference.delay * .05);
  }
});

test('fold readouts retain sub-ms values and identify nominal child folds below decimal resolution', () => {
  for (const [milliseconds, text] of [[.05, '0.05 ms'], [.075, '0.075 ms'], [.125, '0.125 ms'], [.999, '0.999 ms'],
    [1.125, '1.13 ms'], [240, '240 ms'], [641.125, '641.13 ms'], [3000, '3000 ms'], [.0001, '<0.001 ms'], [0, '0 ms']]) {
    assert.equal(formatTimeFold(milliseconds), text);
  }
});

test('all Rust delay pages preserve fractional interval values at the native range boundary', async () => {
  for (const route of ['l-mic-rust.html', 'l-system-parametric-lab.html', 'l-system-experiments.html']) {
    const html = await readFile(new URL(`../src/pages/${route}`, import.meta.url), 'utf8');
    assert.match(html, /<input id="interval"[^>]*step="any"[^>]*value="300"/);
  }
});
