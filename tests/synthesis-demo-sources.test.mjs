import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSING_INPUT_OPTIONS, getProcessingInput, loadProcessingDemo } from '../src/instruments/synthesis/demo-sources.js';

function audioBuffer(channels, length, sampleRate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: index => data[index] };
}
function fixture(kind, rate = 8000) {
  const buffer = audioBuffer(1, Math.round(rate * .12), rate), data = buffer.getChannelData(0);
  const frequency = ({ kick: 72, snare: 220, hat: 1900, tom: 160 })[kind] ?? 330;
  for (let i = 0; i < data.length; i++) data[i] = .5 * Math.sin(i * Math.PI * 2 * frequency / rate) * Math.exp(-i / (rate * .04));
  return buffer;
}
function environment(t, decode) {
  const fetched = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, { signal } = {}) => {
    signal?.throwIfAborted();
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url.pathname).buffer };
  };
  t.after(() => { globalThis.fetch = original; });
  const context = { sampleRate: 8000, createBuffer: audioBuffer, decodeAudioData: decode ?? (async bytes => fixture(new TextDecoder().decode(bytes).split('/').at(-1).replace('.wav', ''))) };
  return { fetched, context };
}
function stats(buffer) {
  let energy = 0, peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) for (const value of buffer.getChannelData(c)) {
    assert.ok(Number.isFinite(value));
    energy += value * value; peak = Math.max(peak, Math.abs(value));
  }
  return { peak, rms: Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)) };
}

test('input choices distinguish live input, recorded demos and all seven stable Rust sources', () => {
  assert.equal(new Set(PROCESSING_INPUT_OPTIONS.map(option => option.id)).size, PROCESSING_INPUT_OPTIONS.length);
  for (const option of PROCESSING_INPUT_OPTIONS) {
    assert.ok(Object.isFrozen(option));
    assert.ok(option.label && option.group);
    assert.equal(getProcessingInput(option.id), option);
    assert.ok(Number.isInteger(option.source) && option.source >= 0 && option.source <= 7);
    if (option.kind !== 'signal') assert.equal(option.source, 0);
  }
  assert.deepEqual(PROCESSING_INPUT_OPTIONS.filter(option => option.kind === 'signal').map(option => option.source).sort(), [1,2,3,4,5,6,7]);
  assert.equal(getProcessingInput('unknown'), null);
});

test('recorded drum demo makes a finite stereo loop with separated transient events and bounded level', async t => {
  const { context, fetched } = environment(t);
  const { buffer, label, credit } = await loadProcessingDemo(context, 'sample-drums');
  assert.equal(fetched.length, 4);
  assert.ok(fetched.every(url => /\/assets\/puggler\/(kick|snare|hat|tom)\.wav$/.test(url.pathname)));
  assert.equal(buffer.duration, 4);
  assert.equal(buffer.numberOfChannels, 2);
  assert.match(label, /Acoustic drums/); assert.match(credit, /CC0/);
  const { peak, rms } = stats(buffer);
  assert.ok(peak <= .82001 && peak > .3);
  assert.ok(rms > .06 && rms <= .16001);
  const data = buffer.getChannelData(0);
  const energy = (start, end) => data.slice(start * buffer.sampleRate, end * buffer.sampleRate).reduce((sum, value) => sum + value * value, 0);
  assert.ok(energy(0, .1) > energy(.13, .23) * 10, 'attacks retain real space between them');
  assert.notDeepEqual(buffer.getChannelData(0), buffer.getChannelData(1));
});

test('voice demos preserve source buffers, provide bounded playback and a rest for tails', async t => {
  const decoded = fixture('voice'), original = decoded.getChannelData(0).slice();
  const { context, fetched } = environment(t, async () => decoded);
  for (const id of ['voice-bdl', 'voice-slt', 'speech']) {
    const { buffer, creditUrl } = await loadProcessingDemo(context, id);
    assert.equal(buffer.length, decoded.length + Math.round(decoded.sampleRate * .35));
    assert.ok(buffer.getChannelData(0).subarray(decoded.length).every(value => value === 0));
    assert.ok(stats(buffer).peak <= .82001);
    assert.match(creditUrl, /(?:COPYING|CREDITS\.md)$/);
  }
  assert.deepEqual(decoded.getChannelData(0), original);
  assert.ok(fetched[0].pathname.endsWith('/assets/audio/vocalzoid-cmu-arctic-bdl.wav'));
});

test('birdsong preserves its continuous duration and includes recording credit', async t => {
  const { context } = environment(t);
  const { buffer, credit } = await loadProcessingDemo(context, 'birdsong');
  assert.equal(buffer.duration, .12);
  assert.match(credit, /Oona Räisänen.*public-domain/);
  assert.ok(stats(buffer).peak <= .82001);
});

test('abort during decode never produces a replacement input buffer', async t => {
  const controller = new AbortController();
  const { context } = environment(t, async () => { controller.abort(); return fixture('voice'); });
  let constructed = false;
  context.createBuffer = (...args) => { constructed = true; return audioBuffer(...args); };
  await assert.rejects(loadProcessingDemo(context, 'voice-bdl', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(constructed, false);
});

test('unsupported inputs and already cancelled requests do not fetch or create audio', async t => {
  const { context, fetched } = environment(t);
  await assert.rejects(loadProcessingDemo(context, 'microphone'), RangeError);
  await assert.rejects(loadProcessingDemo(context, 'noise'), RangeError);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadProcessingDemo(context, 'speech', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fetched.length, 0);
});
