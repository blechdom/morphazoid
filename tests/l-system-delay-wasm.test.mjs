import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE } from '../src/instruments/micmic/native/model.js';
import { DEFAULT_MASTERING } from '../src/instruments/micmic/native/mastering.js';

const bytes = await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url));
const module = await WebAssembly.compile(bytes);
const encoder = new TextEncoder(), decoder = new TextDecoder();
const RATE = 48000, BLOCK = 128;
const TRANSPARENT = { ...DEFAULT_MASTERING, inputHighpassHz: 0, highpassHz: 0, lowpassHz: 0,
  compressorEnabled: false, autoMakeup: false, makeupDb: 0 };

function renderer() {
  const wasm = new WebAssembly.Instance(module).exports, allocations = [];
  assert.equal(wasm.lsd_abi_version(), 1);
  const error = () => decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.lsd_error_ptr(), wasm.lsd_error_len()));
  function allocate(data) {
    const bytes = typeof data === 'number' ? new Uint8Array(data) : data;
    const pointer = wasm.lsd_alloc(bytes.byteLength);
    assert.ok(pointer, error());
    new Uint8Array(wasm.memory.buffer, pointer, bytes.byteLength).set(bytes);
    allocations.push([pointer, bytes.byteLength]); return pointer;
  }
  const handle = wasm.lsd_new(RATE, 1); assert.ok(handle, error());
  const pointers = Array.from({ length: 4 }, () => allocate(BLOCK * 4));
  const metrics = () => [...new Float64Array(wasm.memory.buffer, wasm.lsd_metrics_ptr(handle), wasm.lsd_metrics_len())];
  function performance(candidate = {}) {
    const settings = { ...DEFAULT_PERFORMANCE, automatic: false, inputGain: 1, level: 1, wet: 1,
      dry: 0, mastering: TRANSPARENT, ...candidate };
    const json = encoder.encode(JSON.stringify(settings)), pointer = allocate(json);
    assert.equal(wasm.lsd_performance(handle, pointer, json.length), 1, error());
    return settings;
  }
  function installPool({ count = 1, delay = .05, rate = 1, gain = .7, revision = 1 } = {}) {
    const bytes = new Uint8Array(32 + count * 48), view = new DataView(bytes.buffer);
    view.setUint32(0, 0x4c534431, true); view.setUint32(4, 1, true);
    view.setUint32(8, count, true); view.setUint32(12, count, true);
    view.setUint32(16, revision, true); view.setFloat64(24, 1, true);
    for (let index = 0; index < count; index++) {
      const offset = 32 + index * 48;
      view.setFloat64(offset, delay, true); view.setFloat64(offset + 8, rate, true);
      view.setFloat64(offset + 16, gain, true); view.setFloat64(offset + 24, 0, true);
      view.setUint32(offset + 32, index, true); view.setUint32(offset + 36, 123 + index, true);
      view.setUint32(offset + 40, 1, true);
    }
    const pointer = allocate(bytes);
    assert.equal(wasm.lsd_install(handle, pointer, bytes.length), 1, error());
  }
  function compile(parameters) {
    const json = encoder.encode(JSON.stringify({ ...DEFAULT_PARAMETERS, ...parameters }));
    const pointer = allocate(json), compilation = wasm.lsd_compile(pointer, json.length, RATE);
    assert.ok(compilation, error());
    try {
      const preview = JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer,
        wasm.lsd_compile_json_ptr(compilation), wasm.lsd_compile_json_len(compilation))));
      const pool = new Uint8Array(wasm.memory.buffer,
        wasm.lsd_compile_pool_ptr(compilation), wasm.lsd_compile_pool_len(compilation)).slice();
      const copy = allocate(pool);
      assert.equal(wasm.lsd_install(handle, copy, pool.length), 1, error()); return { preview, pool };
    } finally { wasm.lsd_compile_free(compilation); }
  }
  function process(input, count = input.length) {
    assert.ok(count > 0 && count <= BLOCK);
    for (const pointer of pointers.slice(0, 2)) new Float32Array(wasm.memory.buffer, pointer, count).set(input);
    assert.equal(wasm.lsd_process(handle, ...pointers, count), 1, error());
    const output = new Float32Array(wasm.memory.buffer, pointers[2], count).slice();
    const right = new Float32Array(wasm.memory.buffer, pointers[3], count);
    assert.ok(output.every(Number.isFinite) && right.every(Number.isFinite), 'finite stereo samples');
    assert.ok(output.every(sample => Math.abs(sample) <= 1) && right.every(sample => Math.abs(sample) <= 1), 'bounded stereo samples');
    return output;
  }
  function render(frames, input = () => 0) {
    const output = new Float32Array(frames);
    for (let start = 0; start < frames; start += BLOCK) {
      const count = Math.min(BLOCK, frames - start), samples = Float32Array.from({ length: count }, (_, index) => input(start + index));
      output.set(process(samples), start);
    }
    return output;
  }
  function dispose() {
    wasm.lsd_drop(handle);
    for (const [pointer, length] of allocations) wasm.lsd_free(pointer, length);
  }
  return { wasm, handle, allocate, error, performance, installPool, compile, process, render, metrics, dispose };
}
const rms = samples => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
const sine = (frequency, amplitude = .1) => index => amplitude * Math.sin(index / RATE * Math.PI * 2 * frequency);
function strongestFrequency(samples, low, high) {
  let maximum = 0, strongest = low;
  for (let hz = low; hz <= high; hz += 2) {
    let real = 0, imaginary = 0;
    for (let index = 0; index < samples.length; index++) {
      const phase = index * hz * Math.PI * 2 / RATE;
      real += samples[index] * Math.cos(phase); imaginary += samples[index] * Math.sin(phase);
    }
    const power = real * real + imaginary * imaginary;
    if (power > maximum) { maximum = power; strongest = hz; }
  }
  return strongest;
}

test('published Rust delay binary has no native or JavaScript DSP imports', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const exports = new Set(WebAssembly.Module.exports(module).map(record => record.name));
  for (const name of ['memory', 'lsd_compile', 'lsd_install', 'lsd_process', 'lsd_observe', 'lsd_drop',
    'lsd_envelope_ptr', 'lsd_taps_ptr', 'lsd_metrics_ptr']) assert.ok(exports.has(name), name);
});

test('actual WASM preserves all factory topology settings and unlimited voice demand', async () => {
  const engine = renderer();
  try {
    const bank = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
    for (const preset of bank) {
      const { preview, pool } = engine.compile(preset.snapshot.parameters);
      assert.deepEqual(preview.parameters, preset.snapshot.parameters, preset.id);
      assert.equal(pool.byteLength, 32 + preview.requestedVoices * 48);
      assert.ok(preview.nodes.length > 1 && preview.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)), preset.id);
    }
    const { preview, pool } = engine.compile({ generations: 15 });
    assert.equal(preview.requestedVoices, 65534);
    assert.equal(pool.byteLength, 32 + preview.requestedVoices * 48, 'audio has every target even when the graphic is sampled');
    assert.ok(preview.memoryVoiceCapacity > preview.requestedVoices);
    assert.ok(preview.generationLimits.pythagorean > 15);
  } finally { engine.dispose(); }
});

test('microphone samples produce a delayed wet impulse and real sample-clock telemetry', () => {
  const engine = renderer();
  try {
    engine.performance(); engine.installPool({ delay: .05 }); engine.render(RATE / 4);
    const before = engine.metrics(), memory = engine.wasm.memory.buffer.byteLength;
    const output = engine.render(RATE / 5, index => index === 0 ? .5 : 0);
    const onset = output.findIndex(sample => Math.abs(sample) > 1e-5);
    assert.ok(onset >= .05 * RATE, `wet impulse cannot precede the requested delay: ${onset}`);
    assert.ok(onset < .075 * RATE, `wet impulse remains within delay plus mastering lookahead: ${onset}`);
    assert.ok(rms(output) > 1e-4);
    const after = engine.metrics();
    assert.ok(Math.abs(after[14] - before[14] - .2) < 1e-12, 'clock counts rendered samples');
    assert.equal(after[16], 1);
    assert.equal(engine.wasm.memory.buffer.byteLength, memory, 'process does not grow WASM memory');
    const count = engine.wasm.lsd_envelope_count(engine.handle);
    const envelope = new Float32Array(engine.wasm.memory.buffer, engine.wasm.lsd_envelope_ptr(engine.handle), 4000);
    assert.ok([...envelope.slice(0, count)].some(level => level > 0), 'sampled input drives visual history');
    assert.ok(engine.wasm.lsd_envelope_end_time(engine.handle) <= after[14]);
  } finally { engine.dispose(); }
});

test('moving read heads measurably shift microphone pitch in the actual WASM output', () => {
  const frequencies = [];
  for (const rate of [1, 2]) {
    const engine = renderer();
    try {
      engine.performance(); engine.installPool({ rate });
      const output = engine.render(RATE, sine(173));
      frequencies.push(strongestFrequency(output.slice(-RATE / 5), 120, 420));
    } finally { engine.dispose(); }
  }
  assert.ok(Math.abs(frequencies[0] - 173) <= 3, `unity fundamental ${frequencies[0]}`);
  assert.ok(frequencies[1] > frequencies[0] * 1.6 && frequencies[1] < frequencies[0] * 2.4,
    `speed-shifted fundamental ${frequencies[1]} versus ${frequencies[0]}`);
});

test('mix, gain and mastering controls affect samples without resetting clock or history', () => {
  const engine = renderer();
  try {
    engine.performance({ wet: 0, dry: .5 }); engine.installPool();
    const baseline = engine.render(RATE / 2, sine(5000, .3));
    engine.performance({ wet: 0, dry: .5, level: 0 });
    const muted = engine.render(RATE / 2, sine(5000, .3));
    assert.ok(rms(muted.slice(-RATE / 5)) < 1e-5, 'zero output level silences actual samples');
    engine.performance({ wet: 0, dry: 0 });
    const noMix = engine.render(RATE / 2, sine(5000, .3));
    assert.ok(rms(noMix.slice(-RATE / 5)) < 1e-5, 'zero wet and dry silence actual samples');
    engine.performance({ wet: 0, dry: .5 }); engine.render(RATE / 4, sine(5000, .3));
    const before = engine.metrics();
    engine.performance({ wet: 0, dry: .5, mastering: { ...TRANSPARENT, lowpassHz: 400 } });
    const filtered = engine.render(RATE / 2, sine(5000, .3));
    assert.ok(rms(filtered.slice(-RATE / 5)) < rms(baseline.slice(-RATE / 5)) * .1, 'LPF changes actual output');
    assert.ok(engine.metrics()[14] >= before[14] + .5, 'filter changes preserve sample clock');
    engine.performance({ wet: 0, dry: .5, mastering: { ...TRANSPARENT, compressorEnabled: true,
      thresholdDb: -36, kneeDb: 3, ratio: 8, attackMs: 3, releaseMs: 180 } });
    const compressed = engine.render(RATE / 2, sine(173, .7));
    assert.ok(engine.metrics()[12] > 6, 'compressor measures real positive dB reduction');
    assert.ok(rms(compressed.slice(-RATE / 5)) < .06, 'compression affects actual samples');
    engine.performance({ wet: 0, dry: .5 }); engine.render(RATE / 4, sine(173, .7));
    assert.equal(engine.metrics()[12], 0, 'bypass clears actual compression reduction');
    engine.performance({ wet: 0, dry: .5, inputGain: 0 });
    const silent = engine.render(RATE / 2, sine(173, .7));
    assert.ok(rms(silent.slice(-RATE / 5)) < 1e-5, 'zero input gain silences dry path');
    engine.performance({ wet: 1, dry: 0 }); engine.installPool({ delay: .09, revision: 2 });
    engine.render(RATE / 2, sine(173)); const clock = engine.metrics()[14];
    engine.installPool({ count: 16, delay: .03, rate: 1.3, gain: .2, revision: 3 });
    const changed = engine.render(RATE / 2, sine(173));
    assert.ok(rms(changed.slice(-RATE / 5)) > .001, 'grown/retimed pool remains audible');
    assert.ok(engine.metrics()[14] >= clock + .5); assert.equal(engine.metrics()[16], 3);
    let delta = 0;
    for (let index = 1; index < changed.length; index++) delta = Math.max(delta, Math.abs(changed[index] - changed[index - 1]));
    assert.ok(delta < .08, `bounded sample steps through retime/growth ${delta}`);
  } finally { engine.dispose(); }
});

test('invalid WASM control updates reject atomically and a dropped engine can be recreated', () => {
  const engine = renderer();
  try {
    const settings = engine.performance(); engine.installPool(); engine.render(BLOCK, sine(173));
    const before = engine.metrics();
    const invalid = encoder.encode(JSON.stringify({ ...settings, mastering: { ...TRANSPARENT, ratio: 0 } }));
    const pointer = engine.allocate(invalid);
    assert.equal(engine.wasm.lsd_performance(engine.handle, pointer, invalid.length), 0);
    assert.match(engine.error(), /ratio/i); assert.deepEqual(engine.metrics(), before);
    const output = engine.render(RATE / 4, sine(173)); assert.ok(rms(output) > .001);
  } finally { engine.dispose(); }
  const fresh = renderer();
  try { assert.equal(fresh.metrics()[14], 0); assert.equal(fresh.metrics()[9], 0); }
  finally { fresh.dispose(); }
});

test('rejected worklet pool and performance updates that grow WASM memory preserve active audio', async () => {
  const saved = Object.fromEntries(['AudioWorkletProcessor', 'registerProcessor', 'sampleRate']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let Processor, worklet;
  const messages = [];
  try {
    globalThis.AudioWorkletProcessor = class {
      constructor() { this.port = { postMessage: message => messages.push(message) }; }
    };
    globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
    globalThis.sampleRate = RATE;
    await import('../src/instruments/micmic/native/delay-worklet.js');
    worklet = new Processor({ processorOptions: { module } });
    const compiler = renderer();
    try {
      const { pool } = compiler.compile({ generations: 1, intervalMs: 10, timeRatio: 1, pitchScale: 0 });
      worklet.port.onmessage({ data: { id: 1, type: 'install', pool: pool.buffer } });
    } finally { compiler.dispose(); }
    worklet.port.onmessage({ data: { id: 2, type: 'performance', performance: {
      ...DEFAULT_PERFORMANCE, automatic: false, inputGain: 1, level: .5, wet: .8,
      dry: 0, mastering: TRANSPARENT,
    } } });
    const input = Float32Array.from({ length: BLOCK }, (_, index) => sine(173)(index));
    const left = new Float32Array(BLOCK), right = new Float32Array(BLOCK);
    const render = () => {
      assert.equal(worklet.process([[input]], [[left, right]]), true);
      assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite), 'real worklet copies finite WASM samples');
    };
    for (let index = 0; index < 100; index++) render();
    for (const message of [
      { id: 3, type: 'install', pool: new ArrayBuffer(16 * 1024 * 1024) },
      { id: 4, type: 'performance', performance: { ...DEFAULT_PERFORMANCE, unexpected: 'x'.repeat(32 * 1024 * 1024) } },
    ]) {
      const oldMemory = worklet.memory, before = worklet.snapshot().elapsedSeconds;
      worklet.port.onmessage({ data: message });
      assert.ok(messages.find(reply => reply.id === message.id)?.error, `large invalid ${message.type} is rejected`);
      assert.equal(oldMemory.byteLength, 0, `${message.type}: fixture detached the previous memory`);
      assert.equal(worklet.inputLeft.length, BLOCK, 'error recovery refreshes persistent input views');
      assert.equal(worklet.outputLeft.length, BLOCK, 'error recovery refreshes persistent output views');
      for (let index = 0; index < 30; index++) render();
      assert.ok(rms(left) > .001, 'previous topology still produces actual samples');
      assert.ok(worklet.snapshot().elapsedSeconds > before, `rejected ${message.type} preserves audio clock`);
    }
  } finally {
    worklet?.port.onmessage({ data: { id: 5, type: 'dispose' } });
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('fine and coarse worklet capacity measurements include admission bookkeeping time', async () => {
  const keys = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'performance'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dateNow = Date.now;
  try {
    for (const fine of [true, false]) {
      let clock = 0, Processor;
      globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
      globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
      globalThis.sampleRate = RATE;
      Object.defineProperty(globalThis, 'performance', { configurable: true,
        value: fine ? { now: () => clock } : undefined });
      Date.now = () => clock;
      await import(`../src/instruments/micmic/native/delay-worklet.js?timing=${fine}`);
      const processor = new Processor({ processorOptions: { module } }), api = processor.api;
      const observed = [];
      processor.api = { ...api,
        lsd_process(...args) { const result = api.lsd_process(...args); clock += fine ? .2 : 1; return result; },
        lsd_observe(...args) {
          observed.push(args[1]); const result = api.lsd_observe(...args); clock += fine ? .8 : 5; return result;
        },
      };
      try {
        const input = new Float32Array(BLOCK), left = new Float32Array(BLOCK), right = new Float32Array(BLOCK);
        for (let index = 0; index < (fine ? 2 : 64); index++) {
          assert.equal(processor.process([[input]], [[left, right]]), true);
        }
        assert.equal(observed.length, 2);
        const expected = fine ? [.0002, .001] : [.032, .037];
        for (let index = 0; index < expected.length; index++) {
          assert.ok(Math.abs(observed[index] - expected[index]) < 1e-12,
            `${fine ? 'fine' : 'coarse'} clock includes previous admission cost: ${observed[index]}`);
        }
      } finally { processor.port.onmessage({ data: { id: 1, type: 'dispose' } }); }
    }
  } finally {
    Date.now = dateNow;
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

let recoveryFixtureSequence = 0;
/** Exercise the published WASM through its actual worklet boundary. Only the
 * named export fault is substituted; sample generation and controls stay real.
 */
async function withRecoveryWorklet(run) {
  const keys = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const messages = [];
  let Processor, processor;
  try {
    globalThis.AudioWorkletProcessor = class {
      constructor() { this.port = { postMessage: message => messages.push(message) }; }
    };
    globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
    globalThis.sampleRate = RATE;
    await import(`../src/instruments/micmic/native/delay-worklet.js?recovery=${++recoveryFixtureSequence}`);
    processor = new Processor({ processorOptions: { module } });
    const compiler = renderer();
    try {
      const { pool } = compiler.compile({ generations: 1, intervalMs: 10, timeRatio: 1, pitchScale: 0 });
      processor.port.onmessage({ data: { id: 1, type: 'install', pool: pool.buffer } });
      assert.equal(messages.find(message => message.id === 1)?.error, undefined);
    } finally { compiler.dispose(); }
    processor.port.onmessage({ data: { id: 2, type: 'performance', performance: {
      ...DEFAULT_PERFORMANCE, automatic: false, source: 'mic', inputGain: 1, level: .5,
      wet: .7, dry: .3, mastering: TRANSPARENT,
    } } });
    assert.equal(messages.find(message => message.id === 2)?.error, undefined);
    const input = new Float32Array(BLOCK), left = new Float32Array(BLOCK), right = new Float32Array(BLOCK);
    let renderedFrames = 0;
    const render = () => {
      for (let index = 0; index < BLOCK; index++) input[index] = sine(173, .03)(renderedFrames + index);
      const running = processor.process([[input]], [[left, right]]);
      renderedFrames += BLOCK;
      return running;
    };
    for (let block = 0; block < 100; block++) assert.equal(render(), true);
    assert.ok(rms(left) > .001, 'fixture produces actual microphone-driven WASM audio');
    assert.equal(messages.filter(message => message.type === 'failure').length, 0, 'steady rendering sends no failure messages');
    await run({ processor, messages, input, left, right, render });
  } finally {
    processor?.port.onmessage({ data: { id: 999, type: 'dispose' } });
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

test('worklet keeps actual audio and its clock live when memory grows between callbacks or during observation', async () => {
  await withRecoveryWorklet(({ processor, messages, left, right, render }) => {
    const api = processor.api, before = processor.snapshot().elapsedSeconds;
    let previous = api.memory.buffer;
    api.memory.grow(1);
    assert.equal(previous.byteLength, 0, 'the fault fixture detaches persistent PCM views between callbacks');
    assert.equal(render(), true);
    assert.ok(rms(left) > .001, 'the next callback reads its real input through refreshed views');
    let grew = false;
    processor.api = { ...api, lsd_observe(...args) {
      const result = api.lsd_observe(...args);
      if (!grew) { previous = api.memory.buffer; api.memory.grow(1); grew = true; }
      return result;
    } };
    assert.equal(render(), true);
    assert.equal(grew, true, 'the observation boundary fault ran');
    assert.equal(previous.byteLength, 0, 'observation growth detached the prior PCM views');
    for (let block = 0; block < 30; block++) {
      assert.equal(render(), true);
      assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
    }
    assert.ok(rms(left) > .001, 'observation growth does not strand the live topology in silence');
    assert.ok(processor.snapshot().elapsedSeconds > before + BLOCK * 30 / RATE, 'sample clock keeps advancing after both faults');
    assert.equal(messages.filter(message => message.type === 'failure').length, 0, 'recoverable memory growth is not a fatal error');
  });
});

test('a fatal process return or Rust trap silences stereo and notifies the host exactly once', async () => {
  for (const fault of ['return-zero', 'process-trap', 'observe-trap']) {
    await withRecoveryWorklet(({ processor, messages, left, right, render }) => {
      const api = processor.api;
      processor.api = { ...api,
        ...(fault === 'return-zero' ? { lsd_process: () => 0 } : {}),
        ...(fault === 'process-trap' ? { lsd_process: () => { throw new WebAssembly.RuntimeError('unreachable: injected process trap'); } } : {}),
        ...(fault === 'observe-trap' ? { lsd_observe: () => { throw new WebAssembly.RuntimeError('unreachable: injected admission trap'); } } : {}),
      };
      left.fill(.5); right.fill(-.5);
      assert.equal(render(), false, `${fault}: the processor terminates instead of emitting broken audio`);
      assert.ok(left.every(value => value === 0) && right.every(value => value === 0), `${fault}: both output channels are silenced`);
      assert.equal(processor.failed, true);
      const failures = messages.filter(message => message.type === 'failure');
      assert.equal(failures.length, 1, `${fault}: the browser lifecycle receives an unsolicited fatal notification`);
      assert.equal(typeof failures[0].error, 'string');
      assert.ok(failures[0].error.length > 0);
      assert.equal(render(), false, `${fault}: the failed processor cannot resume itself`);
      assert.equal(messages.filter(message => message.type === 'failure').length, 1, `${fault}: later callbacks do not flood the message port`);
    });
  }
});

test('a Rust trap in an install or performance control notifies the host instead of retaining an unusable processor', async () => {
  for (const type of ['install', 'performance']) {
    await withRecoveryWorklet(({ processor, messages, render }) => {
      const exportName = type === 'install' ? 'lsd_install' : 'lsd_performance';
      processor.api = { ...processor.api, [exportName]: () => { throw new WebAssembly.RuntimeError(`unreachable: injected ${type} trap`); } };
      const update = type === 'install' ? { pool: new ArrayBuffer(32) } : { performance: DEFAULT_PERFORMANCE };
      processor.port.onmessage({ data: { id: 3, type, ...update } });
      assert.match(messages.find(message => message.id === 3)?.error ?? '', /unreachable/);
      const failures = messages.filter(message => message.type === 'failure');
      assert.equal(failures.length, 1, `${type}: the host learns that this processor is terminal`);
      assert.match(failures[0].error, /unreachable/);
      assert.equal(render(), false, `${type}: processing never continues through a trapped Rust engine`);
      assert.equal(messages.filter(message => message.type === 'failure').length, 1);
    });
  }
});

test('the actual topology worker recreates a trapped Rust compiler and retains the next valid pool', async () => {
  const keys = ['self', 'fetch'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const instanceDescriptor = Object.getOwnPropertyDescriptor(WebAssembly, 'Instance');
  const NativeInstance = WebAssembly.Instance, instances = [], messages = [], pending = new Map();
  let trappedCompilations = 0;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    globalThis.self = { onmessage: null, postMessage(message, transfers) {
      messages.push({ message, transfers });
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
    } };
    Object.defineProperty(WebAssembly, 'Instance', { configurable: true, writable: true, value: class {
      constructor(compiledModule, imports) {
        const instance = new NativeInstance(compiledModule, imports);
        instances.push(instance);
        if (instances.length === 1) return { exports: { ...instance.exports,
          lsd_compile() { trappedCompilations++; throw new WebAssembly.RuntimeError('unreachable: injected compiler trap'); },
        } };
        return instance;
      }
    } });
    await import(`../src/instruments/micmic/native/topology-worker.js?recovery=${++recoveryFixtureSequence}`);
    const exchange = (id, parameters, revision = id) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The topology worker fixture did not reply.')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      self.onmessage({ data: { id, parameters, revision, sampleRate: RATE } });
    });
    const parameters = { ...DEFAULT_PARAMETERS, generations: 3 };
    const failed = await exchange(1, parameters);
    assert.match(failed.error, /injected compiler trap/);
    assert.equal(trappedCompilations, 1);
    const recovered = await exchange(2, parameters, 0x10000002a);
    assert.equal(recovered.error, undefined);
    assert.equal(instances.length, 2, 'a Rust trap retires the first compiler instance');
    assert.deepEqual(recovered.result.parameters, parameters);
    assert.equal(recovered.result.requestedVoices, 14);
    assert.equal(recovered.pool.byteLength, 32 + 14 * 48, 'the recovered compiler returns the complete real WASM pool');
    assert.ok(recovered.module instanceof WebAssembly.Module);
    assert.deepEqual(WebAssembly.Module.imports(recovered.module), []);
    const header = new DataView(recovered.pool);
    assert.equal(header.getUint32(0, true), 0x4c534431);
    assert.equal(header.getUint32(16, true), 42);
    assert.equal(header.getUint32(20, true), 1, 'the worker preserves the full topology revision');
    assert.deepEqual(messages.find(record => record.message.id === 2).transfers, [recovered.pool]);
    const rejected = await exchange(3, { ...parameters, lSystemType: 'unknown' });
    assert.equal(typeof rejected.error, 'string', 'an ordinary invalid control is still rejected');
    const following = await exchange(4, { ...parameters, generations: 4 });
    assert.equal(following.error, undefined);
    assert.equal(following.result.requestedVoices, 30);
    assert.equal(instances.length, 2, 'ordinary validation errors retain the healthy recovered compiler');
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    Object.defineProperty(WebAssembly, 'Instance', instanceDescriptor);
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
