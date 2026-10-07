import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { audioStatusTransfers, normalizeAudioStatus } from '../src/instruments/micmic/native/telemetry.js';
import { DEFAULT_PERFORMANCE } from '../src/instruments/micmic/native/model.js';

const compact = (count = 4097) => ({
  activeVoices: count, voiceLimit: count, topologyRevision: 17, elapsedSeconds: 4.5,
  audioTimeSeconds: 12.75, failure: null,
  tapActivity: Float32Array.from({ length: count }, (_, index) => index / count),
  tapVoiceIndices: Uint32Array.from({ length: count }, (_, index) => index ? index : 0xffffffff),
  generationActivity: new Float32Array([0, .125, .5]),
  generationVoiceCounts: new Uint32Array([0, 3, count - 3]),
  inputEnvelope: { interval: .01, endTime: 4.5, values: new Float32Array([.125, .5, .75]) },
});

test('dense transferred telemetry retains every sample, public array shape, sentinel and clock', () => {
  const packet = compact(), buffers = audioStatusTransfers(packet);
  assert.equal(new Set(buffers).size, 5);
  const received = structuredClone(packet, { transfer: buffers });
  assert.ok(buffers.every(buffer => buffer.byteLength === 0), 'copies are transferred rather than cloned');
  const status = normalizeAudioStatus(received);
  for (const key of ['tapActivity', 'tapVoiceIndices', 'generationActivity', 'generationVoiceCounts']) {
    assert.ok(Array.isArray(status[key]), key);
    assert.equal(status[key].length, received[key].length, 'no transport voice cap');
  }
  assert.equal(status.tapVoiceIndices[0], -1);
  assert.equal(status.tapVoiceIndices.at(-1), 4096);
  assert.equal(status.tapActivity.at(-1), received.tapActivity.at(-1));
  assert.equal(received.tapVoiceIndices[0], 0xffffffff, 'normalization does not rewrite its packet');
  assert.deepEqual(status.inputEnvelope, { interval: .01, endTime: 4.5, values: [.125, .5, .75] });
  for (const key of ['activeVoices', 'voiceLimit', 'topologyRevision', 'elapsedSeconds', 'audioTimeSeconds', 'failure']) {
    assert.equal(status[key], received[key]);
  }
  assert.equal(normalizeAudioStatus(status), status, 'already public telemetry does not copy again');
});

test('empty and legacy telemetry retain their public API without introducing missing fields', () => {
  const legacy = { activeVoices: 0, tapActivity: [], tapVoiceIndices: [-1],
    inputEnvelope: { interval: .01, endTime: 0, values: [] } };
  assert.equal(normalizeAudioStatus(legacy), legacy);
  assert.equal(normalizeAudioStatus(undefined), undefined);
  assert.equal(normalizeAudioStatus(null), null);
  const packet = compact(0), status = normalizeAudioStatus(structuredClone(packet, { transfer: audioStatusTransfers(packet) }));
  assert.deepEqual(status.tapActivity, []); assert.deepEqual(status.tapVoiceIndices, []);
});

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)));
const RATE = 48000, BLOCK = 128;
function pool(count = 65) {
  const bytes = new ArrayBuffer(32 + count * 48), view = new DataView(bytes);
  view.setUint32(0, 0x4c534431, true); view.setUint32(4, 2, true);
  view.setUint32(8, count, true); view.setUint32(12, count, true);
  view.setUint32(16, 17, true); view.setFloat64(24, 1, true);
  for (let index = 0; index < count; index++) {
    const start = 32 + index * 48;
    view.setFloat64(start, .005, true); view.setFloat64(start + 8, 1, true);
    view.setFloat64(start + 16, .2, true); view.setUint32(start + 32, index, true);
    view.setUint32(start + 36, index + 1, true); view.setUint32(start + 40, 1, true);
  }
  return bytes;
}

async function workletFixture(run) {
  const keys = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const messages = [], transferred = [];
  let Processor, processor;
  try {
    globalThis.AudioWorkletProcessor = class {
      constructor() {
        this.port = { postMessage(message, buffers = []) {
          const before = buffers.map(buffer => buffer.byteLength);
          const received = structuredClone(message, { transfer: buffers });
          messages.push(received);
          if (buffers.length) transferred.push({ message, before, buffers, received });
        } };
      }
    };
    globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
    globalThis.sampleRate = RATE; globalThis.currentTime = 0;
    await import(`../src/instruments/micmic/native/delay-worklet.js?telemetry=${workletFixture.serial++}`);
    processor = new Processor({ processorOptions: { module } });
    const send = data => processor.port.onmessage({ data });
    const left = new Float32Array(BLOCK), right = new Float32Array(BLOCK);
    const input = Float32Array.from({ length: BLOCK }, (_, index) => Math.sin(index * .1) * .1);
    const render = () => {
      const accepted = processor.process([[input]], [[left, right]]);
      globalThis.currentTime += BLOCK / RATE;
      return accepted;
    };
    await run({ processor, messages, transferred, send, render, left, right });
  } finally {
    if (processor && !processor.dead) processor.port.onmessage({ data: { id: 999, type: 'dispose' } });
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}
workletFixture.serial = 0;

test('real worklet installation and repeated status ACKs transfer owned copies while audio stays live', async () => {
  await workletFixture(async ({ processor, messages, transferred, send, render, left, right }) => {
    send({ id: 1, type: 'performance', performance: { ...DEFAULT_PERFORMANCE, automatic: false, voiceCeiling: 65,
      dry: .2, wet: .8, inputGain: 1, level: .5 } });
    send({ id: 2, type: 'install', pool: pool(), seedCapacity: 65 });
    for (let index = 0; index < 30 && !messages.some(message => message.id === 2); index++) assert.equal(render(), true);
    const installed = messages.find(message => message.id === 2);
    assert.ok(installed?.status); assert.equal(installed.status.topologyRevision, 17);
    assert.ok(installed.status.tapActivity instanceof Float32Array);
    const before = normalizeAudioStatus(installed.status);
    assert.equal(before.tapActivity.length, processor.api.lsd_taps_count(processor.engine));
    for (const id of [3, 4, 5]) {
      assert.equal(render(), true); send({ id, type: 'status' });
      const reply = messages.find(message => message.id === id), status = normalizeAudioStatus(reply.status);
      assert.ok(status.elapsedSeconds > before.elapsedSeconds);
      assert.ok(Number.isFinite(status.audioTimeSeconds));
      assert.equal(status.topologyRevision, 17); assert.equal(status.failure, null);
      assert.equal(processor.inputLeft.length, BLOCK); assert.equal(processor.envelope.length, 4000);
      assert.ok(processor.memory.byteLength > 0, 'transfers leave live WASM memory attached');
      assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
    }
    assert.ok(left.some(sample => Math.abs(sample) > .001), 'actual PCM survives snapshots');
    assert.equal(transferred.length, 4, 'install ACK and all status replies use transfers');
    for (const { before, buffers, received } of transferred) {
      assert.equal(buffers.length, 5); assert.ok(buffers.every(buffer => buffer.byteLength === 0));
      assert.notEqual(received.status.inputEnvelope.values.buffer, processor.memory);
      assert.deepEqual(audioStatusTransfers(received.status).map(buffer => buffer.byteLength), before);
    }
    assert.deepEqual(messages.find(message => message.id === 1), { id: 1 }, 'coefficient ACK stays lightweight');
    const originalMemory = processor.memory;
    processor.api.memory.grow(1);
    assert.equal(originalMemory.byteLength, 0);
    send({ id: 6, type: 'status' });
    assert.notEqual(processor.memory, originalMemory, 'snapshot refreshes views after memory growth');
    assert.ok(normalizeAudioStatus(messages.find(message => message.id === 6).status).elapsedSeconds > before.elapsedSeconds);
    assert.equal(render(), true); assert.ok(left.every(Number.isFinite));
    send({ id: 7, type: 'dispose' });
    const finalCount = messages.length;
    send({ id: 8, type: 'status' }); assert.equal(messages.length, finalCount);
    assert.equal(render(), false, 'disposed processor remains retired');
  });
});

test('wrapped envelope copies remain chronological and independent of live memory; failure status survives transfer', async () => {
  await workletFixture(async ({ processor, messages, send, render, left, right }) => {
    // Ring metadata boundary fixture; storage is still the actual WASM view.
    const real = processor.api;
    processor.api = { ...real, lsd_envelope_count: () => 4000, lsd_envelope_offset: () => 3998,
      lsd_envelope_interval: () => .01, lsd_envelope_end_time: () => 40 };
    for (let index = 0; index < 4000; index++) processor.envelope[index] = index;
    send({ id: 1, type: 'status' });
    const status = normalizeAudioStatus(messages.find(message => message.id === 1).status);
    assert.equal(status.inputEnvelope.values.length, 4000);
    assert.deepEqual(status.inputEnvelope.values.slice(0, 4), [3998, 3999, 0, 1]);
    assert.equal(status.inputEnvelope.values.at(-1), 3997);
    assert.equal(status.inputEnvelope.endTime, 40); assert.equal(status.inputEnvelope.interval, .01);
    processor.envelope[3998] = -20;
    assert.equal(status.inputEnvelope.values[0], 3998, 'in-flight snapshot does not alias the recording');
    processor.api = { ...real, lsd_process() { throw new WebAssembly.RuntimeError('QA trapped renderer'); } };
    assert.equal(render(), false); assert.ok(left.every(sample => sample === 0) && right.every(sample => sample === 0));
    assert.equal(messages.filter(message => message.type === 'failure').length, 1);
    send({ id: 2, type: 'status' });
    assert.equal(normalizeAudioStatus(messages.find(message => message.id === 2).status).failure, 'The audio engine stopped.');
    assert.equal(render(), false);
  });
});
