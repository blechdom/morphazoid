import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RoachSynthAudio, ROACH_RECORDINGS } from '../src/roach-synth-audio.js';

function fixture(fetcher, decoder) {
  const messages = []; const requests = [];
  class AudioNode {
    constructor() { this.gain = { value: 0, cancelScheduledValues() {}, setTargetAtTime() {} }; }
    connect() {} disconnect() {}
  }
  class AudioContext {
    constructor() {
      this.currentTime = 0; this.state = 'suspended'; this.destination = new AudioNode();
      this.audioWorklet = { addModule: async () => {} };
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { return new AudioNode(); }
    async decodeAudioData(bytes) { return decoder ? decoder(bytes) : {
      duration: .25, numberOfChannels: 1, sampleRate: 48000,
      getChannelData: () => new Float32Array(12000).fill(.1),
    }; }
  }
  class AudioWorkletNode extends AudioNode {
    constructor() { super(); this.port = { postMessage: (message, transfer) => messages.push({ message, transfer }), close() {} }; }
  }
  const runtime = { AudioContext, AudioWorkletNode, performance: { now: () => 0 },
    fetch: (url, options) => { requests.push({ url, options }); return fetcher(url, options); } };
  return { runtime, requests, messages };
}
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(24044) });

test('bundled animal excerpts match their provenance, format and runtime movement cues', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/roach-synth/audio/manifest.json', import.meta.url)));
  assert.equal(manifest.source.license, 'CC0-1.0');
  let total = 0;
  for (const recording of ROACH_RECORDINGS) {
    const metadata = manifest.samples.find(item => item.id === recording.id);
    const bytes = readFileSync(recording.url);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
    assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 48000);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.deepEqual(recording.cues, metadata.cues);
    assert.ok(recording.cues.every(cue => cue >= 0 && cue < metadata.duration));
    total += metadata.duration;
  }
  assert.ok(total <= 12, 'decoding stays within the recording budget');
});

test('recordings load after explicit Audio without delaying transport and transfer once', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture(async () => { await pending; return response(); });
  const statuses = []; const audio = new RoachSynthAudio({ runtime: f.runtime, onSamples: state => statuses.push(state) });
  try {
    audio.update({ playing: true, time: 4 });
    assert.equal(f.requests.length, 0);
    await audio.enable();
    assert.equal(audio.enabled, true); assert.equal(audio.getTime(), 4);
    assert.equal(f.requests.length, 3); assert.equal(audio.getState().samplesStatus, 'loading');
    const loading = audio.loadSamples(); finish(); await loading;
    const banks = f.messages.filter(({ message }) => message.type === 'sample-bank');
    assert.equal(banks.length, 1); assert.equal(banks[0].message.samples.length, 3);
    assert.deepEqual(banks[0].message.samples.map(item => item.id), ROACH_RECORDINGS.map(item => item.id));
    assert.ok(banks[0].message.samples.every((item, i) => item.data.buffer === banks[0].transfer[i]));
    assert.equal(audio.getState().samplesLoaded, 3); assert.equal(statuses.at(-1).status, 'ready');
    audio.disable(); await audio.enable(); await audio.loadSamples();
    assert.equal(f.requests.length, 3, 'mute/rearm reuses the decoded bank');
  } finally { audio.dispose(); }
});

test('failed or oversized recordings do not interrupt audio; partial banks remain usable', async () => {
  const f = fixture(async url => String(url).includes('scuttle') ? response()
    : String(url).includes('rustle') ? { ok: false }
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(1024 * 1024 + 1) });
  const audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    await audio.enable({ playing: true }); await audio.loadSamples();
    assert.equal(audio.enabled, true); assert.equal(audio.getState().samplesLoaded, 1);
    assert.equal(f.messages.filter(({ message }) => message.type === 'sample-bank')[0].message.samples[0].id, 'vivarium_scuttle');
  } finally { audio.dispose(); }
});

test('recording samples are sanitized before ownership transfers to the audio thread', async () => {
  const source = new Float32Array([NaN, Infinity, -Infinity, 4, -2, .25]);
  const f = fixture(async () => response(), () => ({ duration: 6 / 48000, numberOfChannels: 1,
    sampleRate: 48000, getChannelData: () => source }));
  const audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    await audio.enable(); await audio.loadSamples();
    const bank = f.messages.find(({ message }) => message.type === 'sample-bank').message.samples;
    assert.deepEqual([...bank[0].data], [0, 0, 0, 1, -1, .25]);
    assert.notEqual(bank[0].data.buffer, source.buffer, 'decoding source remains owned by the browser');
  } finally { audio.dispose(); }
});

test('all-failed banks retry on rearm and disposal cannot install a late decoded bank', async () => {
  let failing = true; let finishDecode;
  const pendingDecode = new Promise(resolve => { finishDecode = resolve; });
  const f = fixture(async () => failing ? { ok: false } : response(), () => pendingDecode);
  const audio = new RoachSynthAudio({ runtime: f.runtime });
  await audio.enable(); await audio.loadSamples();
  assert.equal(audio.getState().samplesStatus, 'unavailable'); assert.equal(audio.enabled, true);
  audio.disable(); failing = false; await audio.enable();
  const loading = audio.loadSamples(); audio.dispose();
  finishDecode({ duration: .25, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(12000) });
  await loading;
  assert.ok(f.requests.slice(-3).every(({ options }) => options.signal.aborted));
  assert.equal(f.messages.filter(({ message }) => message.type === 'sample-bank').length, 0);
  assert.equal(audio.context.state, 'closed');
});

test('a restarted processor never receives the old processor’s delayed recording bank', async () => {
  let finish;
  let calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture(async () => { if (++calls <= 3) await pending; return response(); });
  const audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    await audio.enable(); const oldLoading = audio.loadSamples();
    audio.node.onprocessorerror(); await audio.enable(); await audio.loadSamples();
    finish(); await oldLoading;
    assert.equal(audio.enabled, true); assert.equal(audio.getState().samplesLoaded, 3);
    assert.equal(f.messages.filter(({ message }) => message.type === 'sample-bank').length, 1);
  } finally { audio.dispose(); }
});
