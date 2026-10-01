import test from 'node:test';
import assert from 'node:assert/strict';
import createEspeak from '../vendor/espeak-ng/espeak-ng.js';
import { ESPEAK_PHONES, renderEspeakAtlas } from '../src/instruments/spelling-synthesizer/spelling-espeak-atlas.js';
import { SPELLING_DIPHONE_CLIPS } from '../src/instruments/spelling-synthesizer/spelling-diphone-atlas.js';
import { loadEspeakAtlas } from '../src/instruments/spelling-synthesizer/spelling-espeak-loader.js';

let atlas;
const rendered = async () => {
  if (!atlas) {
    const module = await createEspeak();
    const voice = new module.eSpeakNGWorker();
    atlas = renderEspeakAtlas(voice);
  }
  return atlas;
};

test('local eSpeak renders every English gesture, audible consonants and seamless held vowels', async () => {
  const { samples, sampleRate, clips } = await rendered();
  assert.deepEqual(Object.keys(clips), Object.keys(SPELLING_DIPHONE_CLIPS));
  assert.equal(sampleRate, 22050);
  assert(samples.every(x => Number.isFinite(x) && Math.abs(x) <= 1));
  let previousEnd = 0;
  for (const [key, clip] of Object.entries(clips)) {
    assert(clip.offset >= previousEnd, `${key}: clips do not overlap`);
    previousEnd = clip.offset + clip.duration;
    assert(clip.duration > .015 && clip.duration < .7, `${key}: bounded duration`);
    const start = Math.round(clip.offset * sampleRate);
    const pcm = samples.subarray(start, start + Math.round(clip.duration * sampleRate));
    const rms = Math.sqrt(pcm.reduce((sum, x) => sum + x*x, 0) / pcm.length);
    assert(rms > .002, `${key}: audible PCM`);
    assert(pcm[0] === 0); assert(pcm.at(-1) === 0);
    if (clip.kind === 'vowel') {
      const a = Math.round(clip.sustainStart * sampleRate), b = Math.round(clip.sustainEnd * sampleRate);
      assert(a > 0 && b < pcm.length && b-a >= sampleRate*.025);
      assert(Math.abs(pcm[b-1]-pcm[a]) < .035, `${key}: small loop boundary`);
      assert(Math.sqrt(pcm.subarray(a,b).reduce((sum,x)=>sum+x*x,0)/(b-a)) > .025);
    } else assert.equal(clip.sustainEnd, 0);
  }
});

test('short i keeps the IH vowel rather than collapsing to ee', async () => {
  const module = await createEspeak(), voice = new module.eSpeakNGWorker();
  voice.set_voice('en-us');
  const phones = [];
  voice.synthesize(`[[${ESPEAK_PHONES.i}]]`, (_pcm, events) => {
    phones.push(...events.filter(e => e.type === 'phoneme').map(e => e.id)); return false;
  });
  assert(phones.some(phone => phone.includes('ɪ')));
});

function harness({ throws = false } = {}) {
  const workers = [], buffers = [];
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.terminations = 0; workers.push(this); }
    postMessage(message) { if (throws) throw new Error('post failed'); this.request = message; }
    terminate() { this.terminations++; }
    emit(data) { this.onmessage?.({ data }); }
  }
  const audio = { createBuffer(channels, length, rate) {
    const pcm = new Float32Array(length), buffer = { duration:length/rate, sampleRate:rate, getChannelData:()=>pcm };
    buffers.push(buffer); return buffer;
  } };
  return { workers, buffers, audio, runtime:{ Worker } };
}

test('worker atlas is copied into Web Audio and the worker is released exactly once', async () => {
  const h = harness(), controller = new AbortController();
  const pending = loadEspeakAtlas({ ...h, signal:controller.signal });
  const w = h.workers[0];
  assert.equal(w.options.type, 'module'); assert.deepEqual(w.request, { type:'render', voiceName:'en-us' });
  const data = await rendered(); w.emit({ type:'ready', ...data });
  const result = await pending;
  assert.deepEqual(result.buffer.getChannelData(0), data.samples);
  assert.equal(Object.keys(result.clips).length, 43);
  controller.abort(); assert.equal(w.terminations, 1); assert.equal(w.onmessage, null);
});

test('cancelled cold loads ignore stale results and never allocate an audio buffer', async () => {
  const h = harness(), controller = new AbortController();
  const pending = loadEspeakAtlas({ ...h, signal:controller.signal });
  const w = h.workers[0], late = w.onmessage;
  controller.abort(); await assert.rejects(pending, { name:'AbortError' });
  late({ data:{ type:'ready', ...await rendered() } });
  assert.equal(h.buffers.length, 0); assert.equal(w.terminations, 1);
  await assert.rejects(loadEspeakAtlas({ ...h, signal:controller.signal }), { name:'AbortError' });
  assert.equal(h.workers.length, 1);
});

test('worker failures and malformed atlases release resources without playback', async () => {
  const data = await rendered();
  for (const bad of [null, { type:'error', message:'render failed' },
    { type:'ready', ...data, samples:Float32Array.of(NaN) },
    { type:'ready', ...data, clips:{ ...data.clips, a:{ ...data.clips.a, offset:999 } } }]) {
    const h = harness(), pending = loadEspeakAtlas(h);
    h.workers[0].emit(bad); await assert.rejects(pending);
    assert.equal(h.buffers.length, 0); assert.equal(h.workers[0].terminations, 1);
  }
  const h = harness({ throws:true });
  await assert.rejects(loadEspeakAtlas(h), /post failed/);
  assert.equal(h.workers[0].terminations, 1);
});
