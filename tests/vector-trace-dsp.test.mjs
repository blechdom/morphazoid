import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_SIZE, createBank } from '../src/instruments/vector-fractals/model.js';
import { VectorDSP } from '../src/instruments/vector-fractals/dsp.js';

const traceState = { mode: 'explorer', contourReader: 'trace', pitch: 110, traceRate: .1,
  layerEnabled: [true, true, true], layerVoices: ['sine', 'reed', 'glass'] };
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

function layer(x = 0, y = 0, bend = 0) {
  return { x: new Float32Array(TABLE_SIZE).fill(x), y: new Float32Array(TABLE_SIZE).fill(y),
    bend: new Float32Array(TABLE_SIZE).fill(bend), pathIndex: 0, closed: true, depth: 4 };
}
function bank(layers = [layer(), layer(), layer()], aspect = 1) { return { view: { aspect }, layers }; }
function movingBank() {
  return bank([0, 1, 2].map(index => {
    const result = layer();
    for (let i = 0; i < TABLE_SIZE; i++) {
      const t = i / TABLE_SIZE * 2 * Math.PI;
      result.x[i] = .45 * Math.cos(t); result.y[i] = .4 * Math.sin(t + index * .3);
      result.bend[i] = (.5 + .5 * Math.cos(t * (index + 3))) ** 2;
    }
    return result;
  }));
}
function makeDsp(state = {}, input = bank(), sampleRate = 48000) {
  const dsp = new VectorDSP(sampleRate);
  dsp.setState({ ...traceState, ...state }); dsp.setTraceBank(input); dsp.playing = true;
  return dsp;
}
function render(dsp, seconds = .4, blockSize = 128) {
  const length = Math.round(seconds * dsp.sampleRate), x = new Float32Array(length), y = new Float32Array(length);
  for (let i = 0; i < length; i += blockSize) dsp.process(x.subarray(i, Math.min(length, i + blockSize)), y.subarray(i, Math.min(length, i + blockSize)));
  return { x, y };
}
function difference(a, b) { return rms(a.map((value, index) => value - b[index])); }
function measuredFrequency(signal, sampleRate) {
  let crossings = 0;
  for (let i = 1; i < signal.length; i++) if (signal[i - 1] <= 0 && signal[i] > 0) crossings++;
  return crossings / (signal.length / sampleRate);
}
function brightness(signal) {
  let differenceEnergy = 0, energy = 0;
  for (let i = 1; i < signal.length; i++) { differenceEnergy += (signal[i] - signal[i - 1]) ** 2; energy += signal[i] ** 2; }
  return differenceEnergy / energy;
}

test('Trace starts silent, runs three bounded voices, and releases on pause', () => {
  for (const sampleRate of [22050, 44100, 48000, 96000]) {
    const dsp = makeDsp({}, movingBank(), sampleRate); dsp.playing = false;
    assert.equal(rms(render(dsp).x), 0); assert.equal(dsp.tracePhase, 0); assert.equal(dsp.traceRate, 0);
    dsp.playing = true; dsp.level = .8;
    for (const pitch of [25, 110, 1200]) {
      dsp.setState({ ...traceState, pitch, traceRate: 1 });
      const { x, y } = render(dsp, .4);
      assert.ok(rms(x) > .015 && rms(y) > .015);
      assert.ok(x.every(Number.isFinite) && y.every(Number.isFinite));
      assert.ok(x.every(value => Math.abs(value) < .75) && y.every(value => Math.abs(value) < .75));
    }
    const phase = dsp.tracePhase; dsp.playing = false;
    const released = render(dsp, 1);
    close(dsp.tracePhase, phase); assert.equal(dsp.traceRate, 0);
    assert.ok(rms(released.x.slice(-2048)) < 1e-10 && rms(released.y.slice(-2048)) < 1e-10);
  }
});

test('traversal speed is sample-clocked, block-independent, and independent of pitch', () => {
  const low = makeDsp({ pitch: 30 }), high = makeDsp({ pitch: 1000 });
  render(low, 2, 17); render(high, 2, 128);
  close(low.tracePhase, .2); close(high.tracePhase, .2); close(low.trace.travel, high.trace.travel);
  const slow = makeDsp({ traceRate: .01, layerEnabled: [true, false, false] });
  const fast = makeDsp({ traceRate: 1, layerEnabled: [true, false, false] });
  render(slow, 1); render(fast, 1);
  const a = render(slow, 1), b = render(fast, 1);
  assert.ok(fast.trace.travel > slow.trace.travel * 40);
  assert.ok(difference(a.x, b.x) < 1e-8, 'changing exploration rate must not transpose a stationary point');
  close(measuredFrequency(a.x, 48000), 55, 1.01);
  const smallBlocks = makeDsp({}, movingBank()), largeBlocks = makeDsp({}, movingBank());
  const small = render(smallBlocks, 1, 11), large = render(largeBlocks, 1, 512);
  assert.equal(difference(small.x, large.x), 0); close(smallBlocks.tracePhase, largeBlocks.tracePhase);
});

test('height changes continuous pitch, horizontal position controls pan, and XY mono does not override it', () => {
  const frequencies = [];
  for (const y of [-.25, .031, .25]) {
    const dsp = makeDsp({ pitch: 200, layerEnabled: [true, false, false] }, bank([layer(0, y)]));
    render(dsp, 1); const sound = render(dsp, 1);
    const expected = 100 * 2 ** (4 * y);
    close(dsp.trace.frequencies[0], expected, .0001);
    close(measuredFrequency(sound.x, 48000), expected, 1.1); frequencies.push(expected);
  }
  assert.ok(frequencies[1] > 108 && frequencies[1] < 110, 'mapping should retain continuous height, without note quantization');
  for (const x of [-.5, .5]) {
    const dsp = makeDsp({ readout: 'mono', rotation: 180, layerEnabled: [true, false, false] }, bank([layer(x)]));
    render(dsp, 1); const sound = render(dsp);
    const near = x < 0 ? sound.x : sound.y, far = x < 0 ? sound.y : sound.x;
    assert.ok(rms(near) > .04); assert.ok(rms(far) < rms(near) * 1e-6);
  }
  const wide = makeDsp({ pitch: 200, layerEnabled: [true, false, false] }, bank([layer(0, .125)], 2));
  render(wide, 1); close(wide.trace.frequencies[0], 200, .0001);
});

test('the three selectable voices differ and meaningful bends increase their brightness', () => {
  const sounds = [];
  for (const voice of ['sine', 'reed', 'glass']) {
    const dull = makeDsp({ layerEnabled: [true, false, false], layerVoices: [voice, voice, voice] }, bank([layer(0, 0, 0)]));
    const bright = makeDsp({ layerEnabled: [true, false, false], layerVoices: [voice, voice, voice] }, bank([layer(0, 0, 1)]));
    render(dull, 1); render(bright, 1);
    const a = render(dull, 1).x, b = render(bright, 1).x;
    assert.ok(brightness(b) > brightness(a) * 1.008, `${voice} bend mapping must change spectrum`);
    assert.ok(difference(a, b) > .001); sounds.push(b);
  }
  for (let i = 0; i < sounds.length; i++) for (let j = i + 1; j < sounds.length; j++) assert.ok(difference(sounds[i], sounds[j]) > .01);
});

test('each detail level retains its own register and can be muted without moving the shared phase', () => {
  for (let layerIndex = 0; layerIndex < 3; layerIndex++) {
    const enabled = [false, false, false]; enabled[layerIndex] = true;
    const dsp = makeDsp({ pitch: 200, layerVoices: ['sine', 'sine', 'sine'], layerEnabled: enabled });
    render(dsp, 1); const sound = render(dsp, 1);
    close(measuredFrequency(sound.x, 48000), [100, 200, 400][layerIndex], 1.01);
    const phase = dsp.tracePhase;
    dsp.setState({ ...traceState, layerEnabled: [false, false, false] });
    close(dsp.tracePhase, phase);
    const muted = render(dsp, 1);
    assert.ok(rms(muted.x.slice(-2048)) < 1e-10); close(dsp.tracePhase, (phase + .1) % 1);
  }
});

test('missing and invalid layers are silent and an empty completed bank releases every voice', () => {
  const missing = { x: new Float32Array(0), y: new Float32Array(0), bend: new Float32Array(0) };
  const invalid = layer(); invalid.y[10] = NaN;
  const dsp = makeDsp({}, bank([missing, invalid]));
  assert.equal(rms(render(dsp, .4).x), 0);
  dsp.setTraceBank(movingBank()); const restored = render(dsp, .6);
  assert.ok(Math.hypot(rms(restored.x), rms(restored.y)) > .02);
  dsp.setTraceBank(bank()); dsp.setTraceBank({ view: { aspect: NaN }, layers: [] });
  const sound = render(dsp, 1);
  assert.ok(rms(sound.x.slice(-2048)) < 1e-10);
  assert.equal(dsp.trace.previous, null); assert.equal(dsp.trace.pending, null);
  dsp.setTraceBank(bank([layer(Infinity), layer(4, -4, 5), layer(-4, 4, -5)]));
  dsp.setState({ ...traceState, traceRate: Infinity, pitch: NaN, layerVoices: ['unknown'] });
  const hostile = render(dsp, 1);
  assert.ok(hostile.x.every(Number.isFinite) && hostile.y.every(Number.isFinite));
  assert.ok(hostile.x.every(value => Math.abs(value) < .75));
});

test('pause, reader changes, reset, and resumed startup preserve the right clock', () => {
  const dsp = makeDsp({}, movingBank()); dsp.tracePhase = .37;
  render(dsp, 1); close(dsp.tracePhase, .47);
  const phase = dsp.tracePhase; dsp.playing = false; render(dsp, .2); close(dsp.tracePhase, phase);
  dsp.playing = true; render(dsp, .3); close(dsp.tracePhase, .5);
  dsp.setState({ ...traceState, contourReader: 'xy' }); render(dsp, .3); close(dsp.tracePhase, .5); assert.equal(dsp.traceRate, 0);
  dsp.setState({ ...traceState, mode: 'julia' }); render(dsp, .3); close(dsp.tracePhase, .5); assert.equal(dsp.traceRate, 0);
  dsp.setState(traceState); render(dsp, .2); close(dsp.tracePhase, .52);
  const carrier = dsp.phase, voicePhase = dsp.trace.carriers[0];
  dsp.resetMotion(); assert.equal(dsp.tracePhase, 0); assert.equal(dsp.trace.travel, 0);
  close(dsp.phase, carrier); close(dsp.trace.carriers[0], voicePhase);
  render(dsp, .2); close(dsp.tracePhase, .02);
});

test('bank and voice changes crossfade from the existing sample without phase resets or dropouts', () => {
  const dsp = makeDsp({ pitch: 55, layerVoices: ['sine', 'sine', 'sine'] }, bank());
  const baseline = makeDsp({ pitch: 55, layerVoices: ['sine', 'sine', 'sine'] }, bank());
  render(dsp, 1); render(baseline, 1);
  const phase = dsp.tracePhase, carrier = dsp.trace.carriers[0];
  dsp.setTraceBank(bank([layer(-.5, -.5, 1), layer(.5, .5, 1), layer(.2, .2, 1)]));
  dsp.setTraceBank(movingBank());
  dsp.setState({ ...traceState, pitch: 55, layerVoices: ['reed', 'glass', 'reed'] });
  close(dsp.tracePhase, phase); close(dsp.trace.carriers[0], carrier);
  const sound = render(dsp, 1), reference = render(baseline, 1);
  assert.ok(Math.abs(sound.x[0] - reference.x[0]) < .0003);
  let largestJump = 0;
  for (let i = 1; i < sound.x.length; i++) largestJump = Math.max(largestJump, Math.abs(sound.x[i] - sound.x[i - 1]));
  assert.ok(largestJump < .015, `transition sample delta ${largestJump}`);
  for (let start = 0; start < sound.x.length; start += 2048) assert.ok(rms(sound.x.slice(start, start + 2048)) > .004);
  assert.equal(dsp.trace.previous, null); assert.equal(dsp.trace.pending, null);
  close(dsp.tracePhase, baseline.tracePhase);
});

test('switching from XY to Trace and back fades without altering the original carrier', () => {
  const dsp = new VectorDSP(); dsp.setBank(createBank({ shape: 'circle' }));
  dsp.setState({ pitch: 55 }); dsp.playing = true; dsp.setTraceBank(movingBank());
  const xy = render(dsp, 1); assert.ok(rms(xy.x) > .05);
  const phase = dsp.phase; dsp.setState({ ...traceState, pitch: 55 }); close(dsp.phase, phase);
  const traced = render(dsp, 1); assert.ok(rms(traced.x.slice(-2048)) > .01); assert.ok(dsp.traceMix > .9999);
  const tracePhase = dsp.tracePhase; dsp.setState({ pitch: 55 });
  const again = render(dsp, 1); assert.ok(dsp.traceMix < 1e-10); close(dsp.tracePhase, tracePhase);
  for (const sound of [traced.x, again.x]) {
    let jump = 0;
    for (let i = 1; i < sound.length; i++) jump = Math.max(jump, Math.abs(sound[i] - sound[i - 1]));
    assert.ok(jump < .025, `reader transition sample delta ${jump}`);
  }
});

test('worklet accepts initial and replaced Trace banks, reports the audio clock, and tears down', async () => {
  const original = Object.fromEntries(['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'].map(key => [key, globalThis[key]]));
  let Processor;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); } }; } };
  globalThis.registerProcessor = (name, implementation) => { assert.equal(name, 'vector-fractals'); Processor = implementation; };
  globalThis.sampleRate = 48000; globalThis.currentTime = 2;
  try {
    await import('../src/instruments/vector-fractals/processor.js');
    const processor = new Processor({ processorOptions: { state: traceState, traceBank: movingBank(), tracePhase: .3, playing: true } });
    const channels = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 64; i++) assert.equal(processor.process([], [channels]), true);
    assert.ok(rms(channels[0]) > .01);
    const telemetry = processor.port.messages.at(-1);
    close(telemetry.tracePhase, .3 + 8192 / 48000 * .1); close(telemetry.traceRate, .1);
    close(telemetry.time, 2 + 128 / 48000);
    processor.port.onmessage({ data: { type: 'trace-bank', bank: { layers: [] } } });
    for (let i = 0; i < 250; i++) processor.process([], [channels]);
    assert.ok(rms(channels[0]) < 1e-10);
    processor.port.onmessage({ data: { type: 'dispose' } }); assert.equal(processor.process([], [channels]), false);
  } finally {
    for (const [key, value] of Object.entries(original)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
