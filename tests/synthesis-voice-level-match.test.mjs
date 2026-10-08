import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Permit review against an isolated source checkout, just as the percussion
// audio tests do. Normal repository verification exercises its own source.
const root = process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT
  ? resolve(process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT)
  : fileURLToPath(new URL('../', import.meta.url));
const { VoiceInputSource } = await import(pathToFileURL(resolve(root, 'src/instruments/synthesis/voice-source.js')));
const { NATIVE_OUTPUT_TRIMS } = await import(pathToFileURL(resolve(root, 'src/instruments/voicesaurus/output-calibration.js')));
const { defaultScene } = await import(pathToFileURL(resolve(root, 'src/instruments/voicesaurus/native-model.js')));
const { measureLevel } = await import(pathToFileURL(resolve(root, 'src/instruments/synthesis/performance-level-measure.js')));

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const request = (text = 'A measured phrase', engine = 'espeak') => ({ scene: defaultScene(engine), text });
function buffer(amplitude = .015, sampleRate = 48_000) {
  const samples = Float32Array.from({ length: sampleRate }, (_, frame) =>
    amplitude * Math.sin(2 * Math.PI * 330 * frame / sampleRate));
  return { duration: 1, sampleRate, numberOfChannels: 1, getChannelData: () => samples };
}
class Player {
  level = .82; buffer = null; engine = null; playing = false; jobs = [];
  async enable() { this.enabled = true; }
  setLevel(value) { this.level = value; }
  setLoop(value) { this.loop = value; }
  currentPosition() { return 0; }
  cancelRender() { this.pending?.cancel(); }
  stopAudition() {}
  pause() { this.playing = false; }
  async disable() { this.cancelRender(); this.pause(); }
  async close() { await this.disable(); }
  play() { this.playing = true; return true; }
  render(value, { prepareResult } = {}) {
    this.cancelRender();
    return new Promise((resolveResult, reject) => {
      let settled = false;
      const controller = new AbortController();
      const job = {
        cancel: () => { if (!settled) { settled = true; controller.abort(); reject(Object.assign(Error('Cancelled'), { name: 'AbortError' })); } },
        complete: async pcm => {
          if (settled) return;
          const result = { buffer: pcm, engine: value.engine };
          try { await prepareResult?.(result, { signal: controller.signal }); }
          catch (error) { if (!settled) { settled = true; reject(error); } return; }
          if (settled) return;
          settled = true; this.pending = null; this.buffer = pcm; this.engine = value.engine;
          resolveResult(result);
        },
      };
      this.jobs.push(job); this.pending = job;
    });
  }
}
function harness() {
  const player = new Player(), errors = [];
  const host = { armed: true, context: { state: 'running' }, input: { analyser: {} } };
  const source = new VoiceInputSource({ player, host: () => host, error: error => errors.push(error),
    levelWorkerFactory: () => ({
      postMessage({ channels, sampleRate }) { queueMicrotask(() => this.onmessage?.({ data: { type: 'level', stats: measureLevel(channels, sampleRate) } })); },
      terminate() {},
    }),
  });
  return { player, source, host, errors };
}
async function finish(h, state = request(), pcm = buffer(), options = { playing: true }) {
  const pending = h.source.update(state, options); await tick();
  h.player.pending.complete(pcm); assert.equal(await pending, true);
}

test('voice phrase level matching is static and applied only after successful PCM rendering', async () => {
  const h = harness();
  h.source.prepareLevelMatch(true);
  const pending = h.source.update(request(), { playing: true }); await tick();
  assert.equal(h.player.level, .82, 'the preceding voice is not boosted while its replacement renders');
  h.player.pending.complete(buffer()); assert.equal(await pending, true);
  assert.ok(Number.isFinite(h.player.level) && h.player.level > .82, 'a quiet rendered phrase receives a finite boost');
  assert.equal(h.player.playing, true); assert.equal(h.source.matchNextRender, false);
  const matched = h.player.level;
  await finish(h, request('A louder edited phrase'), buffer(.12));
  assert.equal(h.player.level, matched, 'ordinary parameter/text edits retain the static gain, so amplitude edits remain audible');
});

test('cached voice recall can match levels again without launching a new render', async () => {
  const h = harness(); await finish(h);
  assert.equal(h.player.level, .82);
  h.source.prepareLevelMatch(true);
  assert.equal(await h.source.update(request(), { playing: true }), true);
  assert.equal(h.player.jobs.length, 1); assert.ok(h.player.level > .82);
  const matched = h.player.level;
  h.source.prepareLevelMatch(false); assert.equal(h.player.level, .82);
  h.source.prepareLevelMatch(true);
  assert.equal(await h.source.update(request(), { playing: true }), true);
  assert.equal(h.player.jobs.length, 1); assert.equal(h.player.level, matched);
});

test('matching compensates each native engine reference trim instead of multiplying both calibrations', async () => {
  const levels = [];
  for (const engine of ['espeak', 'mea8000', 'gnuspeech', 'sinsy']) {
    const h = harness(); h.source.prepareLevelMatch(true);
    await finish(h, request('Same PCM', engine), buffer());
    levels.push(h.player.level / .82 * NATIVE_OUTPUT_TRIMS[engine]);
  }
  for (const level of levels) assert.ok(Math.abs(level - levels[0]) < 1e-12,
    'identical PCM has the same final gain, regardless of its native engine reference trim');
});

test('disabling matching during native rendering restores factory level and cannot apply a late boost', async () => {
  const h = harness(); h.source.prepareLevelMatch(true);
  const pending = h.source.update(request(), { playing: true }); await tick();
  h.source.prepareLevelMatch(false); assert.equal(h.player.level, .82);
  h.player.pending.complete(buffer()); assert.equal(await pending, true);
  assert.equal(h.player.level, .82); assert.equal(h.source.matchNextRender, false);
});

test('a cancelled old voice render cannot consume the replacement preset level-match request', async () => {
  const h = harness(); h.source.prepareLevelMatch(true);
  const old = h.source.update(request('Old phrase'), { playing: true }); await tick();
  const stale = h.player.pending;
  h.source.prepareLevelMatch(true);
  const latest = h.source.update(request('Replacement phrase'), { playing: true }); await tick();
  assert.equal(await old, false);
  stale.complete(buffer(.7));
  assert.equal(h.player.level, .82); assert.equal(h.source.matchNextRender, true);
  h.player.pending.complete(buffer()); assert.equal(await latest, true);
  assert.ok(h.player.level > .82); assert.equal(h.source.matchNextRender, false);
  assert.deepEqual(h.errors, []);
});

test('level matching never arms Audio or starts paused voice transport', async () => {
  const h = harness(); h.host.armed = false; h.source.prepareLevelMatch(true);
  assert.equal(await h.source.update(request(), { playing: true }), false);
  assert.equal(h.player.enabled, undefined); assert.equal(h.player.jobs.length, 0);
  h.host.armed = true;
  await finish(h, request(), buffer(), { playing: false });
  assert.ok(h.player.level > .82); assert.equal(h.player.playing, false);
});
