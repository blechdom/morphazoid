import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceInputSource } from '../src/instruments/synthesis/voice-source.js';
import { gainForLevel } from '../src/instruments/synthesis/performance-level-measure.js';
import { NATIVE_OUTPUT_TRIMS } from '../src/instruments/voicesaurus/output-calibration.js';
import { measureLevel } from '../src/instruments/synthesis/performance-level-measure.js';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const stats = { peak: .1, scoreDb: -30, nonfinite: 0, silent: false };
const pcm = () => ({ sampleRate: 48000, numberOfChannels: 1,
  getChannelData: () => new Float32Array(480).fill(.1) });

test('authored PCM worker returns the pure meter result and reports malformed data', async () => {
  const source = await readFile(new URL('../src/instruments/synthesis/voice-level-worker.js', import.meta.url), 'utf8');
  const messages = [], self = { postMessage: result => messages.push(result) };
  runInNewContext(source.replace(/^import .*;\n/m, ''), { self, measureLevel });
  const channels = [new Float32Array(4800).fill(.1)];
  self.onmessage({ data: { channels, sampleRate: 48000 } });
  assert.equal(messages[0].type, 'level');
  assert.deepEqual(messages[0].stats, measureLevel(channels, 48000));
  self.onmessage({ data: { channels, sampleRate: 1 } });
  assert.equal(messages[1].type, 'error'); assert.match(messages[1].message, /sample rate/);
});
class Worker {
  postMessage(data) { this.data = data; }
  terminate() { this.terminated = true; }
  complete(value = stats) { this.onmessage({ data: { type: 'level', stats: value } }); }
}
function harness() {
  const workers = [], errors = [], player = { setLevel(value) { this.level = value; },
    cancelRender() {}, stopAudition() {}, pause() {}, currentPosition() { return 0; }, close: async () => {} };
  const source = new VoiceInputSource({ player, host: () => ({}), error: error => errors.push(error),
    levelWorkerFactory: () => { const worker = new Worker(); workers.push(worker); return worker; } });
  return { source, workers, player, errors };
}

test('voice level scans are delegated, cached by buffer and retain exact PCM ownership', async () => {
  const h = harness(), result = { buffer: pcm(), engine: 'espeak' };
  h.source.prepareLevelMatch(true);
  const pending = h.source.prepareRenderedLevel(result);
  assert.equal(h.workers.length, 1); assert.equal(h.player.level, .82);
  assert.equal(h.workers[0].data.sampleRate, 48000);
  assert.equal(h.workers[0].data.channels[0].length, 480);
  h.workers[0].complete(); await pending;
  assert.equal(h.workers[0].terminated, true); assert.equal(h.source.levelJob, null);
  h.source.matchRenderedLevel(result);
  assert.equal(h.player.level, .82 * gainForLevel(stats) / NATIVE_OUTPUT_TRIMS.espeak);
  h.source.prepareLevelMatch(true); await h.source.prepareRenderedLevel(result);
  assert.equal(h.workers.length, 1, 'cached resume never rescans PCM');
});

test('turning matching off terminates work and prevents late gain changes', async () => {
  const h = harness(), result = { buffer: pcm(), engine: 'espeak' };
  h.source.prepareLevelMatch(true); const pending = h.source.prepareRenderedLevel(result);
  h.source.prepareLevelMatch(false); assert.equal(h.workers[0].terminated, true);
  h.workers[0].complete(); await pending; h.source.matchRenderedLevel(result);
  assert.equal(h.player.level, .82); assert.equal(h.source.levelStats.has(result.buffer), false);
  assert.equal(h.source.levelJob, null); assert.deepEqual(h.errors, []);
});

test('a stale measurement cannot consume matching enabled for the next render', async () => {
  const h = harness(), first = { buffer: pcm(), engine: 'espeak' }, next = { buffer: pcm(), engine: 'espeak' };
  h.source.prepareLevelMatch(true); const stale = h.source.prepareRenderedLevel(first);
  h.source.prepareLevelMatch(false); h.source.prepareLevelMatch(true);
  const current = h.source.prepareRenderedLevel(next);
  h.workers[0].complete(); await stale;
  assert.equal(h.source.matchNextRender, true); assert.equal(h.source.levelStats.has(first.buffer), false);
  h.workers[1].complete(); await current; h.source.matchRenderedLevel(next);
  assert.equal(h.player.level, .82 * gainForLevel(stats) / NATIVE_OUTPUT_TRIMS.espeak);
});

test('native-render cancellation terminates level work and rejects preparation', async () => {
  const h = harness(), controller = new AbortController();
  h.source.prepareLevelMatch(true);
  const pending = h.source.prepareRenderedLevel({ buffer: pcm(), engine: 'espeak' }, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); controller.abort();
  await rejected; assert.equal(h.workers[0].terminated, true); assert.equal(h.source.levelJob, null);
});

for (const action of ['invalidate', 'pause', 'destroy']) test(action + ' terminates pending level work', async () => {
  const h = harness(), result = { buffer: pcm(), engine: 'espeak' };
  h.source.prepareLevelMatch(true); const pending = h.source.prepareRenderedLevel(result);
  await h.source[action](); await pending;
  assert.equal(h.workers[0].terminated, true); assert.equal(h.source.levelJob, null);
  h.workers[0].complete(); assert.equal(h.source.levelStats.has(result.buffer), false);
});

test('optional measurement errors retain factory level and do not reject valid voice PCM', async () => {
  const h = harness(), result = { buffer: pcm(), engine: 'espeak' };
  h.source.prepareLevelMatch(true); const pending = h.source.prepareRenderedLevel(result);
  h.workers[0].onerror({ message: 'Unavailable' }); await pending;
  h.source.matchRenderedLevel(result); assert.equal(h.player.level, .82);
  assert.equal(h.workers[0].terminated, true); assert.equal(h.source.levelJob, null);
  assert.match(h.errors[0].message, /Unavailable/);
});
