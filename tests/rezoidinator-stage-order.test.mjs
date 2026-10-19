import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, createConfiguration } from '../src/instruments/simd-resonator-rust/model.js';
import { STAGE_ORDERS, SIGNAL_DEFAULTS, FILTER_TYPES, sanitizeSignalSettings, SignalPath,
  DiffusedRoom, ExcitationSource } from '../src/instruments/simd-resonator-rust/signal-path.js';

const scalarBytes = await readFile(new URL('../assets/wasm/rust-resonator-scalar.wasm', import.meta.url));
const simdBytes = await readFile(new URL('../assets/wasm/rust-resonator-simd.wasm', import.meta.url));
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(structuredClone(value)) }; } };
globalThis.registerProcessor = (_name, value) => { Processor = value; };
await import('../src/instruments/simd-resonator-rust/processor.js');
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const zero = new Float32Array(128);
const energy = samples => samples.reduce((sum, value) => sum + value * value, 0);
const peak = samples => samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const outputs = () => [Array.from({ length: 2 }, () => new Float32Array(128)), Array.from({ length: 16 }, () => new Float32Array(128))];
const musicalSignal = { bodyEnabled: true, processingEnabled: true, resynthesisEnabled: true, reverbEnabled: true,
  bodyMix: .8, resynthesisMix: .35, drive: 8, filterType: 'lowpass', filterFrequency: 1300,
  reverbTime: .8, reverbDamping: .3, reverbMix: .7 };
function engine(signal = {}, { spatial = false, settings = {}, reference = false } = {}) {
  const p = new Processor(); if (reference) p.signal = new LegacySignalPath();
  p.message({ type: 'install', scalarBytes, simdBytes, configuration: createConfiguration({ ...DEFAULTS, ...settings }) });
  p.message({ type: 'signal', configuration: signal });
  if (spatial) p.message({ type: 'spatial', configuration: { enabled: true, speakerCount: 16, pattern: 'scatter' } });
  assert.equal(p.ready, true); return p;
}
function render(p, blocks, source = null) {
  const out = outputs(), input = new Float32Array(128), samples = new Float32Array(blocks * 128);
  for (let block = 0; block < blocks; block++) {
    for (let frame = 0; frame < 128; frame++) input[frame] = source?.(block * 128 + frame) ?? 0;
    p.process([[input]], out); samples.set(out[0][0], block * 128);
    for (const bus of out) for (const channel of bus) assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) <= .950001));
    for (let frame = 0; frame < 128; frame++) assert.ok(out[1].reduce((sum, channel) => sum + Math.abs(channel[frame]), 0) <= .95 * Math.SQRT2 + 1e-6);
  }
  return { samples, out };
}

// Frozen pre-order source/mix algorithm from ce809fe6, retaining the existing
// room implementation. This checks sample-exact default compatibility through
// live controls, rather than asserting that a refactored method calls itself.
/** Smoothed live mix/filter state. All sample/block storage is allocated once. */
class LegacySignalPath {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate; this.settings = { ...SIGNAL_DEFAULTS };
    this.excitation = new ExcitationSource(sampleRate); this.room = new DiffusedRoom(sampleRate);
    this.step = 1 - Math.exp(-1 / (sampleRate * .02));
    this.bodyMix = 1; this.fftMix = 0; this.wetMix = 1; this.processingMix = 0; this.reverbMix = 0;
    this.drive = 1; this.g = Math.tan(Math.PI * Math.min(8000, sampleRate * .45) / sampleRate);
    this.gTarget = this.g; this.ic1 = 0; this.ic2 = 0;
    this.composite = new Float64Array(18);
    this.filterWeights = new Float64Array([1, 0, 0, 0]); this.filterTarget = this.filterWeights.slice();
  }
  configure(value, immediate = false) {
    this.settings = sanitizeSignalSettings(value);
    this.gTarget = Math.tan(Math.PI * Math.min(this.settings.filterFrequency, this.sampleRate * .45) / this.sampleRate);
    this.filterTarget.fill(0); this.filterTarget[FILTER_TYPES.indexOf(this.settings.filterType)] = 1;
    this.room.configure(this.settings, immediate);
    if (immediate) {
      this.bodyMix = this.settings.bodyEnabled ? this.settings.bodyMix : 0;
      this.fftMix = this.settings.resynthesisEnabled ? this.settings.resynthesisMix : 0;
      this.processingMix = Number(this.settings.processingEnabled); this.wetMix = this.settings.wetMix;
      this.reverbMix = this.settings.reverbEnabled ? this.settings.reverbMix : 0;
      this.drive = this.settings.drive; this.g = this.gTarget; this.filterWeights.set(this.filterTarget);
    }
  }
  reset() { this.excitation.reset(); this.room.reset(); this.ic1 = this.ic2 = 0; this.configure(this.settings, true); }
  processSource(raw) {
    const s = this.settings, step = this.step;
    this.processingMix += (Number(s.processingEnabled) - this.processingMix) * step;
    this.drive += (s.drive - this.drive) * step; this.g += (this.gTarget - this.g) * step;
    for (let i = 0; i < 4; i++) this.filterWeights[i] += (this.filterTarget[i] - this.filterWeights[i]) * step;
    const denominator = 1 + this.g * (this.g + Math.SQRT2);
    const v1 = (this.ic1 + this.g * (raw - this.ic2)) / denominator;
    const low = this.ic2 + this.g * v1;
    this.ic1 = clamp(finite(2 * v1 - this.ic1), -8, 8); this.ic2 = clamp(finite(2 * low - this.ic2), -8, 8);
    const high = raw - Math.SQRT2 * v1 - low;
    const filtered = low * this.filterWeights[0] + high * this.filterWeights[1]
      + v1 * Math.SQRT2 * this.filterWeights[2] + raw * this.filterWeights[3];
    const saturated = Math.tanh(filtered * this.drive) / Math.tanh(this.drive);
    const driven = filtered + (saturated - filtered) * Math.min(1, this.drive - 1);
    return raw + (driven - raw) * this.processingMix;
  }
  advanceMix() {
    const s = this.settings, step = this.step;
    this.bodyMix += ((s.bodyEnabled ? s.bodyMix : 0) - this.bodyMix) * step;
    this.fftMix += ((s.resynthesisEnabled ? s.resynthesisMix : 0) - this.fftMix) * step;
    this.wetMix += (s.wetMix - this.wetMix) * step;
    this.reverbMix += ((s.reverbEnabled ? s.reverbMix : 0) - this.reverbMix) * step;
    this.room.advance();
  }
  mix(channel, raw, processed, modal, spectral, roomSend = 0) {
    const body = processed + (modal - processed) * this.bodyMix;
    const combined = body + (spectral - body) * this.fftMix;
    this.composite[channel] = combined;
    const room = this.room.process(channel, this.settings.reverbEnabled || this.reverbMix > 1e-6 ? combined + roomSend : 0);
    const wet = combined + (room - combined) * this.reverbMix;
    return finite(raw + (wet - raw) * this.wetMix);
  }
  ageChannel(channel) { this.room.process(channel, 0); }
}


test('stage order accepts precisely the six permutations and defaults legacy settings', () => {
  assert.equal(STAGE_ORDERS.length, 6); assert.equal(new Set(STAGE_ORDERS).size, 6);
  for (const order of STAGE_ORDERS) {
    assert.deepEqual(order.split('-').sort(), ['process', 'resonance', 'reverb']);
    assert.equal(sanitizeSignalSettings({ stageOrder: order }).stageOrder, order);
  }
  for (const value of [undefined, null, '', 'reverb-body-fft-process', ['process', 'resonance', 'reverb']]) {
    assert.equal(sanitizeSignalSettings({ stageOrder: value }).stageOrder, 'process-resonance-reverb');
  }
});

test('default order preserves every sample of the previous source, stereo and spatial processing', () => {
  const p = engine(musicalSignal, { spatial: true }), previous = engine(musicalSignal, { spatial: true, reference: true });
  const a = outputs(), b = outputs(), input = new Float32Array(128);
  for (const value of [p, previous]) { value.message({ type: 'mic', active: true }); value.message({ type: 'excite', kind: 'white-noise', durationMs: 30, strength: .6 }); }
  for (let block = 0; block < 150; block++) {
    if (block === 40 || block === 85) for (const value of [p, previous]) value.message({ type: 'signal', configuration: {
      ...musicalSignal, filterType: block === 40 ? 'highpass' : 'bandpass', filterFrequency: block === 40 ? 200 : 3000,
      drive: block === 40 ? 2 : 15, reverbTime: block === 40 ? 3 : .3, reverbMix: .4 } });
    if (block === 100) for (const value of [p, previous]) value.message({ type: 'mic', active: false });
    for (let frame = 0; frame < 128; frame++) input[frame] = .1 * Math.sin((block * 128 + frame) * .051);
    p.process([[input]], a); previous.process([[input]], b);
    assert.deepEqual(p.sourceBlock, previous.sourceBlock); assert.deepEqual(p.processedBlock, previous.processedBlock);
    assert.deepEqual(a, b, 'default order at quantum ' + block);
  }
});

test('all six orders change actual audio with nonlinear processing and an active resonance group', () => {
  const sounds = [];
  for (const stageOrder of STAGE_ORDERS) {
    const p = engine({ ...musicalSignal, stageOrder }); p.message({ type: 'mic', active: true });
    p.message({ type: 'excite', kind: 'white-noise', durationMs: 75, strength: .8 });
    const samples = render(p, 240, frame => (.18 * Math.sin(frame * .053) + .12 * Math.sin(frame * .237)) * (.6 + .4 * Math.sin(frame * .0008))).samples;
    assert.ok(energy(samples) > 1, stageOrder); sounds.push(samples);
  }
  for (let a = 0; a < sounds.length; a++) for (let b = a + 1; b < sounds.length; b++) {
    let difference = 0;
    for (let frame = 4096; frame < sounds[a].length; frame++) difference += (sounds[a][frame] - sounds[b][frame]) ** 2;
    assert.ok(difference > .01, STAGE_ORDERS[a] + ' differs from ' + STAGE_ORDERS[b]);
  }
});

test('all-off dry passes the original source unchanged while every order moves', () => {
  const bypass = { bodyEnabled: false, processingEnabled: false, resynthesisEnabled: false, reverbEnabled: false };
  const p = engine(bypass); p.message({ type: 'mic', active: true });
  const input = Float32Array.from({ length: 128 }, (_, index) => .2 * Math.sin(index * .123)), out = outputs();
  for (const stageOrder of STAGE_ORDERS) {
    p.message({ type: 'signal', configuration: { ...bypass, stageOrder } });
    for (let block = 0; block < 16; block++) { p.process([[input]], out); assert.deepEqual(out[0][0], input); assert.deepEqual(out[0][1], input); }
  }
});

test('order changes retain the source timeline, bank states and input lifetime; placement arrives smoothly', () => {
  const p = engine(musicalSignal), control = engine(musicalSignal), a = outputs(), b = outputs();
  for (const value of [p, control]) { value.message({ type: 'mic', active: true }); value.message({ type: 'excite', kind: 'white-noise', durationMs: 300, strength: .7 }); }
  let order = STAGE_ORDERS[0];
  for (let block = 0; block < 130; block++) {
    if (block % 3 === 0) {
      order = STAGE_ORDERS[(block / 3) % 6];
      const state = p.kernel.real.slice(), frames = p.totalFrames;
      p.message({ type: 'signal', configuration: { ...musicalSignal, stageOrder: order } });
      assert.deepEqual(p.kernel.real, state); assert.equal(p.totalFrames, frames); assert.equal(p.transition, 'steady');
    }
    p.process([[zero]], a); control.process([[zero]], b);
    assert.deepEqual(p.sourceBlock, control.sourceBlock); assert.equal(p.signal.excitation.age[0], control.signal.excitation.age[0]);
    assert.equal(p.inputActive, true);
    assert.ok(Math.abs(p.signal.positions.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    for (const channel of a[0]) assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) <= .950001));
  }
  render(p, 10); assert.equal(p.signal.orderRemaining, 0);
  assert.equal(p.signal.settings.stageOrder, order); assert.deepEqual(p.signal.positions, p.signal.positionTarget);
  assert.equal(p.signal.excitation.age[0], 14400);
});

test('the first reordered sample starts with a small fade instead of switching chains abruptly', () => {
  const signal = { ...musicalSignal, drive: 12, reverbMix: .65 };
  for (const stageOrder of STAGE_ORDERS.slice(1)) {
    const p = engine(signal), reference = engine(signal);
    for (const value of [p, reference]) { value.message({ type: 'mic', active: true }); render(value, 90, frame => .12 * Math.sin(frame * .043)); }
    p.message({ type: 'signal', configuration: { ...signal, stageOrder } });
    const source = frame => .12 * Math.sin((90 * 128 + frame) * .043);
    const a = render(p, 1, source).samples, b = render(reference, 1, source).samples;
    assert.ok(Math.abs(a[0] - b[0]) < .002, stageOrder + ' starts from the outgoing chain');
    assert.ok(p.signal.orderRemaining > 0); assert.ok(energy(a) > 0);
  }
});

test('ordering preserves stereo independently of surround; post filters retain separate spatial buses', () => {
  for (const stageOrder of STAGE_ORDERS) {
    const signal = { ...musicalSignal, stageOrder }, p = engine(signal, { spatial: true }), stereo = engine(signal);
    for (const value of [p, stereo]) value.message({ type: 'excite', kind: 'white-noise', durationMs: 120, strength: 1 });
    const a = render(p, 90), b = render(stereo, 90);
    assert.deepEqual(a.samples, b.samples);
    assert.ok(a.out[1].filter(channel => energy(channel) > 1e-12).length > 3, stageOrder);
    assert.notDeepEqual(a.out[1][0], a.out[1][1]);
  }
});

test('moving reverb does not revive expired tails or inactive filter histories', () => {
  const settings = { bodyEnabled: false, processingEnabled: true, resynthesisEnabled: false, reverbEnabled: true,
    filterFrequency: 100, drive: 4, reverbTime: .12, reverbMix: 1, reverbDamping: .1 };
  const p = engine(settings, { spatial: true }); p.message({ type: 'excite', kind: 'white-noise', strength: .8, durationMs: 20 });
  assert.ok(energy(render(p, 35).samples) > 0);
  p.message({ type: 'signal', configuration: { ...settings, stageOrder: 'reverb-resonance-process' } });
  render(p, 750);
  p.message({ type: 'spatial', configuration: { enabled: false } }); render(p, 200);
  p.message({ type: 'spatial', configuration: { enabled: true, speakerCount: 16 } });
  p.message({ type: 'signal', configuration: settings });
  const after = render(p, 80); assert.ok(peak(after.samples) < 1e-8);
  for (const channel of after.out[1]) assert.ok(peak(channel) < 1e-8);
  p.message({ type: 'reset' }); assert.ok(render(p, 20).samples.every(value => value === 0));
  p.message({ type: 'dispose' }); assert.equal(p.process([[zero]], outputs()), false);
});

test('default and maximum ordered configurations report separate warm callback costs', t => {
  const cases = [
    { label: 'default body, stereo', settings: {}, signal: {}, spatial: false },
    { label: '512 modes + FFT + post drive +16rooms', settings: {}, signal: { ...musicalSignal, stageOrder: 'resonance-reverb-process' }, spatial: true },
    { label: '4096 modes + max FFT overlap +post drive+16rooms', settings: { modeCount: 4096, fftSize: 4096, fftHopRatio: .125 }, signal: { ...musicalSignal, stageOrder: 'resonance-reverb-process' }, spatial: true },
  ];
  for (const value of cases) {
    const p = engine(value.signal, value); p.message({ type: 'mic', active: true });
    render(p, 192, frame => .1 * Math.sin(frame * .053));
    const report = p.messages.filter(message => message.type === 'telemetry').at(-1);
    t.diagnostic(JSON.stringify({ label: value.label, callbackMeanMicroseconds: report.callbackMicros,
      callbackMaxMicroseconds: report.callbackMaxMicros, budgetMicroseconds: report.budgetMicros,
      scope: 'Node mechanical measurement, not physical-device or listening acceptance' }));
  }
});
