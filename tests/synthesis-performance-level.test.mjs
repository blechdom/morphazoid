import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { measureLevel, createLevelMeter, gainForLevel } from '../src/instruments/synthesis/performance-level-measure.js';
import { PerformanceLevelMatcher } from '../src/instruments/synthesis/performance-level-matcher.js';
import { INSTRUMENT_PRESETS, PERCUSSION_INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';

const tone = (rate, amplitude = .1, frequency = 1000, seconds = 1) => Float32Array.from(
  { length: Math.ceil(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
const near = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`);

test('level score is chunk-invariant and does not cancel opposite-polarity stereo', () => {
  const left = tone(48000), right = left.map(value => -value);
  const mono = measureLevel([left], 48000), stereo = measureLevel([left, right], 48000);
  near(mono.scoreDb, stereo.scoreDb);
  near(mono.rmsDb, stereo.rmsDb);
  near(mono.peak, .1);
  near(mono.rmsDb, 20 * Math.log10(.1 / Math.sqrt(2)));
  const meter = createLevelMeter(48000);
  for (let i = 0; i < left.length; i += 137) meter.push([left.subarray(i, i + 137), right.subarray(i, i + 137)]);
  assert.deepEqual(meter.finish(), stereo);
  assert.equal(stereo.nonfinite, 0);
  assert.equal(stereo.silent, false);
});

test('level weighting tracks the device rate, preserves gain ratios and ignores silence safely', () => {
  const results = [44100, 48000, 96000].map(rate => measureLevel([tone(rate)], rate));
  results.forEach(result => near(result.scoreDb, results[1].scoreDb, .04));
  const normal = results[1], soft = measureLevel([tone(48000, .01)], 48000);
  near(normal.scoreDb - soft.scoreDb, 20, .00001);
  const gain = gainForLevel(soft);
  assert.ok(gain > 1 && gain <= 10 ** (24 / 20));
  assert.ok(soft.peak * gain <= .7);
  assert.ok(soft.scoreDb + 20 * Math.log10(gain) <= -16.49999);
  for (const samples of [new Float32Array(48000), tone(48000, 1e-7), Float32Array.of(NaN, Infinity, 0)]) {
    assert.equal(gainForLevel(measureLevel([samples], 48000)), 1);
  }
  const invalid = measureLevel([Float32Array.of(0, NaN, Infinity, -.1)], 48000);
  assert.equal(invalid.nonfinite, 2);
  assert.throws(() => measureLevel([new Float32Array(2), new Float32Array(3)]), /equal lengths/);
  assert.throws(() => createLevelMeter(NaN), /sample rate/);
});

class FakeWorker {
  messages = [];
  terminated = false;
  postMessage(message) { this.messages.push(message); }
  emit(data) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const scene = () => structuredClone(INSTRUMENT_PRESETS.find(preset => preset.snapshot.routing.input === 'synthesis').snapshot);

test('factory level recall is immediate and never starts an offline renderer', async () => {
  const matcher = new PerformanceLevelMatcher({ workerFactory: () => { throw new Error('Unexpected renderer startup'); } });
  try {
    for (const input of ['synthesis', 'percussion']) {
      const snapshot = INSTRUMENT_PRESETS.find(preset => preset.snapshot.routing.input === input).snapshot;
      const cached = matcher.cached(snapshot);
      assert.equal(cached.stats.calibration, 'factory');
      assert.deepEqual(await matcher.match(snapshot), cached);
      assert.equal(matcher.worker, null);
      assert.equal(matcher.active, null);
    }
  } finally { matcher.dispose(); }
});

test('level client cancels stale results, caches complete performances, and never creates audio', async () => {
  const workers = [];
  const matcher = new PerformanceLevelMatcher({ factoryCache: false, workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, cacheSize: 2 });
  try {
    const first = matcher.match(scene());
    const rejected = assert.rejects(first, { name: 'AbortError' });
    const latest = scene(); latest.sequence.tempoBpm += 1;
    const second = matcher.match(latest);
    workers[0].emit({ type: 'ready' }); await flush();
    await rejected;
    const request = workers[0].messages.find(message => message.type === 'match');
    assert.equal(request.performance.sequence.tempoBpm, latest.sequence.tempoBpm);
    const result = { sourceTrimDb: 12, outputGain: 1, stats: { peak: .3 } };
    workers[0].emit({ type: 'result', id: request.id - 1, result: { sourceTrimDb: 48 } });
    workers[0].emit({ type: 'result', id: request.id, result });
    assert.deepEqual(await second, result);
    const before = workers[0].messages.length;
    const cached = await matcher.match(latest); cached.stats.peak = 100;
    assert.deepEqual(await matcher.match(latest), result, 'callers cannot mutate cached results');
    assert.equal(workers[0].messages.length, before);
    const aborter = new AbortController();
    const aborted = matcher.match(scene(), { signal: aborter.signal });
    const abortCheck = assert.rejects(aborted, { name: 'AbortError' });
    aborter.abort(); await abortCheck;
    assert.equal(matcher.active, null);
    assert.equal((await matcher.match({ routing: { input: 'microphone' } })).stats.skipped, 'external-input');
  } finally { matcher.dispose(); }
  assert.ok(workers.every(worker => worker.terminated));
  await assert.rejects(matcher.match(scene()), /closed/);
});

test('level client recovers from failed startup and teardown rejects pending preparation', async () => {
  const workers = [];
  const matcher = new PerformanceLevelMatcher({ factoryCache: false, workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  const failed = matcher.match(scene());
  const failedCheck = assert.rejects(failed, /network/);
  workers[0].emit({ type: 'error', message: 'network' });
  await failedCheck;
  assert.equal(workers[0].terminated, true);
  const pending = matcher.match(scene());
  const pendingCheck = assert.rejects(pending, { name: 'AbortError' });
  assert.equal(workers.length, 2);
  matcher.dispose(); await pendingCheck;
});

// Browser-shaped Worker transport only. The production module, compiled score,
// worklet scheduler and committed WASM are unchanged; no mock oscillator.
function actualWorkerFactory() {
  const url = new URL('../src/instruments/synthesis/performance-level-worker.js', import.meta.url).href;
  const thread = new NodeWorker(`
    const { parentPort } = require('node:worker_threads');
    const { readFile } = require('node:fs/promises');
    let listener;
    const queued = [];
    globalThis.postMessage = data => parentPort.postMessage(data);
    globalThis.addEventListener = (name, fn) => {
      if (name === 'message') { listener = fn; for (const data of queued.splice(0)) listener({data}); }
    };
    parentPort.on('message', data => listener ? listener({data}) : queued.push(data));
    globalThis.fetch = async url => new Response(await readFile(url));
    import(${JSON.stringify(url)}).catch(error => { throw error; });
  `, { eval: true });
  const worker = {
    postMessage: message => thread.postMessage(message),
    terminate: () => thread.terminate(),
  };
  thread.on('message', data => worker.onmessage?.({ data }));
  thread.on('error', error => worker.onerror?.(error));
  return worker;
}

test('actual WASM worker calibrates all drum families and reuses its renderer without prior-scene contamination', { timeout: 60000 }, async () => {
  const matcher = new PerformanceLevelMatcher({ factoryCache: false, workerFactory: actualWorkerFactory });
  try {
    await matcher.warm();
    const families = PERCUSSION_INSTRUMENT_PRESETS.filter((_, index) => index % 3 === 0);
    for (const preset of families) {
      const before = structuredClone(preset.snapshot);
      const result = await matcher.match(preset.snapshot);
      assert.equal(result.sourceTrimDb, null);
      assert.ok(result.outputGain > 0 && result.outputGain <= 16, preset.id);
      assert.equal(result.stats.nonfinite, 0);
      assert.equal(result.stats.silent, false, preset.id);
      assert.ok(result.stats.peak * result.outputGain <= .7, preset.id);
      assert.deepEqual(preset.snapshot, before, 'probe never edits musical state');
    }
    const first = scene();
    const firstResult = await matcher.match(first);
    assert.equal(firstResult.stats.nonfinite, 0);
    assert.equal(firstResult.stats.silent, false);
    assert.ok(firstResult.sourceTrimDb >= -36 && firstResult.sourceTrimDb <= 48);
    assert.ok(firstResult.stats.peak <= .7);
    matcher.cache.clear();
    await matcher.match(families.at(-1).snapshot);
    matcher.cache.clear();
    const repeated = await matcher.match(first);
    assert.deepEqual(repeated, firstResult, 'drum → synth and candidate passes reset deterministically');
    const direct = scene(); direct.sequence = { id: 'none', tempoBpm: 120, gate: 65 };
    assert.equal((await matcher.match(direct)).stats.silent, false, 'direct notes are measured without a sequence');
    direct.sequence.id = 'basic-up-down';
    assert.equal((await matcher.match(direct)).stats.silent, false, 'basic tuning arpeggios are measured too');
    for (const id of ['euclidean-tines', 'pythagorean-pluck', 'slendro-cloud', 'pelog-plate', 'lü-vowel-weave',
      'meantone-strings', 'tritave-chamber', 'harmonic-formants', 'thirteen-orbit', 'twenty-two-beads', 'fifty-three-sync',
      'performance:parallel-vowel-choir']) {
      const preset = INSTRUMENT_PRESETS.find(item => item.id === id);
      const result = await matcher.match(preset.snapshot);
      assert.equal(result.stats.nonfinite, 0, id);
      assert.equal(result.stats.silent, false, id);
      assert.ok(result.sourceTrimDb >= -36 && result.sourceTrimDb <= 48, id);
      assert.ok(result.stats.peak <= .7, id);
      assert.notEqual(result.stats.limited, 'nonlinear-source', `${id}: calibration should find a verified linear setting`);
    }
    for (const sampleRate of [44100, 96000]) {
      const preset = INSTRUMENT_PRESETS.find(item => item.id === 'pythagorean-pluck');
      const result = await matcher.match(preset.snapshot, { sampleRate });
      assert.equal(result.stats.sampleRate, sampleRate);
      assert.equal(result.stats.nonfinite, 0);
      assert.equal(result.stats.silent, false);
      assert.ok(result.stats.peak <= .7);
    }
  } finally { matcher.dispose(); }
});
