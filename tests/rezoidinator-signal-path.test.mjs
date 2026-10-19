import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, createConfiguration } from '../src/instruments/simd-resonator-rust/model.js';
import { SIGNAL_DEFAULTS, SIGNAL_LIMITS, EXCITATION_TYPES, ExcitationSource,
  sanitizeSignalSettings, sanitizeExcitation } from '../src/instruments/simd-resonator-rust/signal-path.js';

const scalarBytes = await readFile(new URL('../assets/wasm/rust-resonator-scalar.wasm', import.meta.url));
const simdBytes = await readFile(new URL('../assets/wasm/rust-resonator-simd.wasm', import.meta.url));
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(structuredClone(value)) }; } };
globalThis.registerProcessor = (_name, value) => { Processor = value; };
await import('../src/instruments/simd-resonator-rust/processor.js');
const energy = samples => samples.reduce((sum, value) => sum + value * value, 0);
const peak = samples => samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
function processor(signal = {}, settings = {}, spatial = false) {
  const p = new Processor();
  p.message({ type: 'install', scalarBytes, simdBytes, configuration: createConfiguration({ ...DEFAULTS, ...settings }) });
  assert.equal(p.ready, true);
  p.message({ type: 'signal', configuration: { ...SIGNAL_DEFAULTS, ...signal } });
  if (spatial) p.message({ type: 'spatial', configuration: { enabled: true, speakerCount: 16, pattern: 'scatter' } });
  return p;
}
function buffers() { return [Array.from({ length: 2 }, () => new Float32Array(128)), Array.from({ length: 16 }, () => new Float32Array(128))]; }
function render(p, blocks, { source = null, collect = true } = {}) {
  const output = buffers(), input = new Float32Array(128);
  const stereo = collect ? new Float32Array(blocks * 128) : null;
  for (let block = 0; block < blocks; block++) {
    if (source) for (let sample = 0; sample < 128; sample++) input[sample] = source(block * 128 + sample);
    p.process([[input]], output);
    for (const bus of output) for (const channel of bus) assert.ok(channel.every(Number.isFinite));
    if (collect) stereo.set(output[0][0], block * 128);
  }
  return { stereo, output };
}

test('source path defaults to a body, permits deliberate bypass, and bounds hostile settings', () => {
  assert.deepEqual(sanitizeSignalSettings(), SIGNAL_DEFAULTS);
  const allOff = sanitizeSignalSettings({ bodyEnabled: false, resynthesisEnabled: false, processingEnabled: false, reverbEnabled: false });
  assert.equal(allOff.bodyEnabled, false);
  for (const value of [NaN, Infinity, -Infinity, -1e20, 1e20]) {
    const settings = sanitizeSignalSettings(Object.fromEntries(Object.keys(SIGNAL_LIMITS).map(key => [key, value])));
    for (const [key, [low, high]] of Object.entries(SIGNAL_LIMITS)) assert.ok(settings[key] >= low && settings[key] <= high, key);
  }
  assert.deepEqual(sanitizeExcitation({ kind: 'invented', durationMs: Infinity, strength: -20 }), { kind: 'pluck', durationMs: 18, strength: 0 });
});

test('force events are finite, single-shot, deterministic on reset, and bounded under repeated triggers', () => {
  for (const kind of EXCITATION_TYPES) {
    const source = new ExcitationSource();
    source.trigger({ kind, durationMs: 18, strength: .8 });
    const first = Float32Array.from({ length: 1800 }, () => source.nextSample());
    assert.ok(first.every(Number.isFinite)); assert.ok(energy(first) > 0, kind);
    assert.ok(first.subarray(864).every(value => value === 0), kind + ' ends');
    if (kind === 'impulse') { assert.equal(first[0], Math.fround(.8)); assert.ok(first.subarray(1).every(value => value === 0)); }
    source.reset(); source.trigger({ kind, durationMs: 18, strength: .8 });
    assert.deepEqual(Float32Array.from({ length: 1800 }, () => source.nextSample()), first);
    for (let i = 0; i < 40; i++) source.trigger({ kind, durationMs: 300, strength: 1.5 });
    assert.ok(Array.from({ length: 15000 }, () => source.nextSample()).every(value => Number.isFinite(value) && Math.abs(value) <= 2));
  }
});

test('mic activation retains body-only sound instead of switching to an FFT-heavy blend', () => {
  const body = processor(), bypass = processor({ bodyEnabled: false });
  body.message({ type: 'mic', active: true }); bypass.message({ type: 'mic', active: true });
  const source = frame => .1 * Math.sin(frame * .041);
  const a = render(body, 120, { source }).stereo, b = render(bypass, 120, { source }).stereo;
  assert.equal(body.signal.fftMix, 0); assert.equal(body.signal.bodyMix, 1);
  assert.ok(energy(a) > 1); assert.notDeepEqual(a, b);
  for (let i = 0; i < b.length; i++) assert.equal(b[i], Math.fround(source(i)));
});

test('every excitation reaches cold and warm pure FFT without an external source', () => {
  for (const kind of EXCITATION_TYPES) for (const warm of [false, true]) {
    const p = processor({ bodyEnabled: false, resynthesisEnabled: true, resynthesisMix: 1 });
    if (warm) render(p, 24, { collect: false });
    p.message({ type: 'excite', kind, durationMs: kind === 'soft-mallet' ? 8 : kind === 'hard-mallet' ? 3 : 18, strength: .8 });
    const samples = render(p, 100).stereo;
    assert.ok(peak(samples) > .003, kind + (warm ? ' warm' : ' cold'));
    assert.ok(samples.subarray(8192).every(value => value === 0));
    assert.equal(p.inputActive, false);
  }
});

test('excitation and external input share the same path and excitation does not stop the source', () => {
  const alone = processor({ bodyEnabled: false }), together = processor({ bodyEnabled: false });
  together.message({ type: 'mic', active: true });
  for (const p of [alone, together]) p.message({ type: 'excite', kind: 'white-noise', durationMs: 18, strength: .4 });
  const a = render(alone, 16).stereo, b = render(together, 16, { source: () => .1 }).stereo;
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs((b[i] - a[i]) - .1) < 2e-8);
  assert.equal(together.inputActive, true); assert.equal(together.signal.bodyMix, 0);
});

test('tone, drive and final wet/dry have real audible destinations', () => {
  const source = frame => .15 * Math.sin(frame * .031) + .1 * Math.sin(frame * 1.24);
  const dry = processor({ bodyEnabled: false, processingEnabled: true, drive: 12, wetMix: 0 });
  const low = processor({ bodyEnabled: false, processingEnabled: true, filterFrequency: 300, filterType: 'lowpass', drive: 1 });
  const high = processor({ bodyEnabled: false, processingEnabled: true, filterFrequency: 3000, filterType: 'highpass', drive: 12 });
  for (const p of [dry, low, high]) p.message({ type: 'mic', active: true });
  const a = render(dry, 50, { source }).stereo, b = render(low, 50, { source }).stereo, c = render(high, 50, { source }).stereo;
  for (let i = 0; i < a.length; i++) assert.equal(a[i], Math.fround(source(i)));
  assert.ok(energy(b) < energy(a) * .7); assert.ok(energy(c) > energy(b) * 2);
  assert.notDeepEqual(b, c);
});

test('room uses delayed diffusion and tunable decaying tails independently of the modal bank', () => {
  const make = time => processor({ bodyEnabled: false, reverbEnabled: true, reverbMix: 1, reverbTime: time, reverbDamping: .15 });
  const short = make(.2), long = make(2);
  for (const p of [short, long]) p.message({ type: 'excite', kind: 'impulse', strength: 1 });
  const a = render(short, 750).stereo, b = render(long, 750).stereo;
  assert.ok(b.subarray(0, 1400).every(value => value === 0));
  assert.ok(energy(b.subarray(1400, 12000)) > .1);
  assert.ok(energy(b.subarray(12000, 24000)) > energy(a.subarray(12000, 24000)) * 100);
  assert.ok(energy(b.subarray(72000)) < energy(b.subarray(12000, 24000)) * .01);
  assert.ok(peak(b) < .95);
});

test('pure reverb fills independent surround buses, preserving stereo and excluding unused channels', () => {
  const settings = { bodyEnabled: false, reverbEnabled: true, reverbMix: 1, reverbTime: 2 };
  const spatial = processor(settings, {}, true), stereo = processor(settings);
  for (const p of [spatial, stereo]) p.message({ type: 'excite', kind: 'white-noise', strength: .8, durationMs: 30 });
  const a = render(spatial, 120), b = render(stereo, 120);
  assert.deepEqual(a.stereo, b.stereo);
  for (const channel of a.output[1]) assert.ok(energy(channel) > 1e-12);
  for (let channel = 1; channel < 16; channel++) assert.notDeepEqual(a.output[1][0], a.output[1][channel]);
  spatial.message({ type: 'spatial', configuration: { enabled: true, speakerCount: 4 } });
  const reduced = render(spatial, 1);
  for (const channel of reduced.output[1].slice(4)) assert.ok(channel.every(value => value === 0));
});

test('all sixteen stage combinations remain bounded through live changes and reset/dispose', () => {
  const p = processor({}, { modeCount: 4096 }, true), output = buffers(), input = new Float32Array(128);
  p.message({ type: 'mic', active: true });
  for (let mask = 0; mask < 16; mask++) {
    p.message({ type: 'signal', configuration: { bodyEnabled: Boolean(mask & 1), processingEnabled: Boolean(mask & 2),
      resynthesisEnabled: Boolean(mask & 4), reverbEnabled: Boolean(mask & 8), filterType: mask % 2 ? 'highpass' : 'lowpass',
      filterFrequency: mask % 2 ? 20 : 20000, drive: 24, reverbTime: 12, reverbDamping: mask % 2 ? .98 : 0,
      reverbMix: 1, resynthesisMix: .5 } });
    p.message({ type: 'excite', kind: EXCITATION_TYPES[mask % 6], strength: 1.5, durationMs: 300 });
    for (let block = 0; block < 24; block++) {
      for (let sample = 0; sample < 128; sample++) input[sample] = sample % 37 ? 2 * Math.sin((block * 128 + sample) * .137) : Infinity;
      p.process([[input]], output);
      for (const bus of output) for (const channel of bus) assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) <= .950001));
      for (let frame = 0; frame < 128; frame++) assert.ok(output[1].reduce((sum, channel) => sum + Math.abs(channel[frame]), 0) <= .95 * Math.SQRT2 + 1e-6);
    }
  }
  p.message({ type: 'reset' }); p.message({ type: 'mic', active: false });
  assert.ok(render(p, 2).stereo.every(value => value === 0));
  p.message({ type: 'dispose' }); assert.equal(p.process([[]], output), false);
  for (const bus of output) for (const channel of bus) assert.ok(channel.every(value => value === 0));
});

test('full modes, maximum FFT overlap and sixteen rooms report combined callback timing', t => {
  const p = processor({ bodyEnabled: true, processingEnabled: true, resynthesisEnabled: true,
    resynthesisMix: .5, reverbEnabled: true, reverbMix: .5, drive: 8 },
  { modeCount: 4096, fftSize: 4096, fftHopRatio: .125 }, true);
  p.message({ type: 'mic', active: true });
  render(p, 192, { source: frame => .1 * Math.sin(frame * .063), collect: false });
  const report = p.messages.filter(message => message.type === 'telemetry').at(-1);
  assert.equal(report.modeCount, 4096); assert.equal(report.spatialSpeakerCount, 16);
  assert.ok(report.callbackMicros >= report.kernelMicros); assert.ok(report.rms > 0);
  t.diagnostic(JSON.stringify({ callbackMeanMicroseconds: report.callbackMicros, callbackMaxMicroseconds: report.callbackMaxMicros,
    budgetMicroseconds: report.budgetMicros, scope: 'Node callback measurement; not browser/device acceptance' }));
});
