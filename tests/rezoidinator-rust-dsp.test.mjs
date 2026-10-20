import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createConfiguration } from '../src/instruments/simd-resonator-rust/model.js';
import { SIGNAL_DEFAULTS, STAGE_ORDERS, EXCITATION_TYPES } from '../src/instruments/simd-resonator-rust/signal-path.js';
import { SignalPath } from './helpers/rezoidinator-js-signal-reference.mjs';
import { RustSignalPath } from '../src/instruments/simd-resonator-rust/signal-rust.js';

const bytes = Object.fromEntries(await Promise.all(['scalar', 'simd'].map(async backend => [backend,
  await readFile(new URL('../assets/wasm/rust-resonator-' + backend + '.wasm', import.meta.url))])));
const modules = Object.fromEntries(Object.entries(bytes).map(([backend, data]) => [backend, new WebAssembly.Module(data)]));
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(structuredClone(value)) }; } };
globalThis.registerProcessor = (_name, value) => { Processor = value; };
await import('../src/instruments/simd-resonator-rust/processor.js');
const { JavascriptReferenceProcessor } = await import('./helpers/rezoidinator-js-processor-reference.mjs');
const channels = () => [Array.from({ length: 2 }, () => new Float32Array(128)), Array.from({ length: 16 }, () => new Float32Array(128))];
function engine(Type, backend, signal, spatial = false) {
  const p = new Type(); p.message({ type: 'install', scalarBytes: bytes.scalar, simdBytes: bytes.simd,
    requestedBackend: backend, configuration: createConfiguration({ fftSize: 2048, fftBandCount: 128, fftHopRatio: .125 }) });
  assert.equal(p.ready, true); p.message({ type: 'signal', configuration: signal });
  p.message({ type: 'mic', active: true });
  p.message({ type: 'spatial', configuration: { enabled: spatial, speakerCount: 16, pattern: 'scatter', motion: true, rate: .13 } });
  return p;
}

for (const backend of ['scalar', 'simd']) test(backend + ' source shaping and delayed room match JavaScript at all supported sample-rate extremes', () => {
  for (const rate of [8000, 44100, 48000, 96000, 384000]) {
    const e = new WebAssembly.Instance(modules[backend]).exports; e.signal_init(rate);
    const rust = new RustSignalPath(); rust.bind(e); const js = new SignalPath(rate);
    const input = new Float32Array(128), raw = new Float32Array(128), processed = new Float32Array(128), spectral = new Float32Array(128);
    const modalLeft = new Float32Array(e.memory.buffer, e.output_left_ptr(), 128), modalRight = new Float32Array(e.memory.buffer, e.output_right_ptr(), 128);
    let maxSource = 0, maxOutput = 0;
    for (let block = 0; block < 300; block++) {
      if (block % 40 === 0) {
        const cfg = { ...SIGNAL_DEFAULTS, processingEnabled: true, reverbEnabled: true, bodyMix: .4,
          resynthesisEnabled: true, resynthesisMix: .3, wetMix: .95, filterFrequency: 1300 + block % 100 * 30,
          drive: 4.3, reverbMix: .8, stageOrder: STAGE_ORDERS[Math.floor(block / 40) % 6],
          filterType: ['bandpass', 'highpass', 'lowpass', 'bypass'][Math.floor(block / 40) % 4] };
        rust.configure(cfg, block === 0); js.configure(cfg, block === 0);
      }
      if (block % 35 === 0) {
        const cfg = { kind: EXCITATION_TYPES[Math.floor(block / 35) % 6], strength: .8, durationMs: 77 };
        rust.excitation.trigger(cfg); js.excitation.trigger(cfg);
      }
      for (let f = 0; f < 128; f++) {
        const t = block * 128 + f; input[f] = .15 * Math.sin(t * .073);
        modalLeft[f] = .04 * Math.cos(t * .031); modalRight[f] = .07 * Math.cos(t * .051); spectral[f] = .05 * Math.sin(t * .17);
      }
      rust.prepare(input, 128, true, true, true);
      for (let f = 0; f < 128; f++) {
        const r = Math.max(-2, Math.min(2, input[f] + js.excitation.nextSample())), p = js.processSource(r);
        raw[f] = r; processed[f] = p; maxSource = Math.max(maxSource, Math.abs(rust.fftInput[f] - p));
      }
      rust.spectral.set(spectral); rust.mixBlock(128, true, false, 8, 0, .3);
      for (let f = 0; f < 128; f++) {
        js.advanceMix(); const a = js.mix(0, raw[f], processed[f], modalLeft[f], spectral[f] * .5), b = js.mix(1, raw[f], processed[f], modalRight[f], spectral[f] * .5);
        const scale = 1 / Math.max(1, Math.abs(a) / .95, Math.abs(b) / .95);
        maxOutput = Math.max(maxOutput, Math.abs(rust.outputLeft[f] - Math.fround(a * scale)), Math.abs(rust.outputRight[f] - Math.fround(b * scale)));
        for (let ch = 2; ch < 18; ch++) js.ageChannel(ch);
      }
    }
    assert.ok(maxSource < 1e-12, `${rate} Hz source difference ${maxSource}`);
    assert.ok(maxOutput < 1e-7, `${rate} Hz output difference ${maxOutput}`);
  }
});

for (const backend of ['scalar', 'simd']) test(backend + ' full processor preserves all four roles, FFT changes, surround and tails against pre-port JavaScript', () => {
  for (const role of ['body', 'processing', 'reverb', 'resynthesis']) {
    let signal = { ...SIGNAL_DEFAULTS, bodyEnabled: role === 'body', processingEnabled: role === 'processing',
      reverbEnabled: role === 'reverb', resynthesisEnabled: role === 'resynthesis', reverbMix: 1, resynthesisMix: 1,
      filterFrequency: 1600, drive: 6, reverbTime: .35, reverbDamping: .3 };
    const p = engine(Processor, backend, signal, true), old = engine(JavascriptReferenceProcessor, backend, signal, true);
    const input = new Float32Array(128), a = channels(), b = channels(); let maximum = 0, energy = 0;
    for (let block = 0; block < 360; block++) {
      if (block % 45 === 0) for (const value of [p, old]) value.message({ type: 'excite', kind: EXCITATION_TYPES[Math.floor(block / 45) % 6], strength: .8, durationMs: 18 });
      if (block === 60 || block === 105 || block === 200) {
        signal = { ...signal, filterType: block === 60 ? 'highpass' : 'bandpass', filterFrequency: block === 60 ? 200 : 2700,
          drive: block === 60 ? 2 : 12, reverbTime: block === 60 ? 1.2 : .2, reverbDamping: .62 };
        for (const value of [p, old]) value.message({ type: 'signal', configuration: signal });
      }
      if ([90, 92, 180].includes(block)) for (const value of [p, old]) value.message({ type: 'configure', configuration: createConfiguration({
        fftSize: block === 90 ? 4096 : block === 92 ? 256 : 1024, fftWindow: block === 90 ? 1 : 2,
        fftHopRatio: .125, fftBandCount: block === 90 ? 128 : 64, fftDetail: .4, fftMix: 1 }) });
      if (block === 240) for (const value of [p, old]) value.message({ type: 'mic', active: false });
      for (let f = 0; f < 128; f++) input[f] = .12 * Math.sin((block * 128 + f) * .071) + .06 * Math.sin((block * 128 + f) * .357);
      p.process([[input]], a); old.process([[input]], b);
      for (let bus = 0; bus < 2; bus++) for (let ch = 0; ch < a[bus].length; ch++) for (let f = 0; f < 128; f++) {
        assert.ok(Number.isFinite(a[bus][ch][f])); maximum = Math.max(maximum, Math.abs(a[bus][ch][f] - b[bus][ch][f])); energy += a[bus][ch][f] ** 2;
      }
    }
    assert.ok(maximum < 2e-7, `${role} maximum difference ${maximum}`); assert.ok(energy > 1, role);
    assert.equal(p.messages.some(message => message.type === 'error'), false);
    p.message({ type: 'dispose' }); old.message({ type: 'dispose' });
  }
});

test('switching Rust backend preserves FFT overlap, excitation and live room state', () => {
  const signal = { ...SIGNAL_DEFAULTS, bodyEnabled: false, resynthesisEnabled: true, resynthesisMix: .7, reverbEnabled: true, reverbMix: .6 };
  const p = engine(Processor, 'simd', signal, true), control = engine(Processor, 'simd', signal, true);
  const input = new Float32Array(128), a = channels(), b = channels(); let maximum = 0;
  for (let block = 0; block < 240; block++) {
    if (block === 40) for (const value of [p, control]) value.message({ type: 'configure', configuration: createConfiguration({ fftSize: 4096, fftWindow: 1 }) });
    if ([41, 95, 153, 200].includes(block)) p.message({ type: 'backend', backend: p.backend === 'simd' ? 'scalar' : 'simd' });
    for (let f = 0; f < 128; f++) input[f] = .11 * Math.sin((block * 128 + f) * .043);
    p.process([[input]], a); control.process([[input]], b);
    for (let bus = 0; bus < 2; bus++) for (let ch = 0; ch < a[bus].length; ch++) for (let f = 0; f < 128; f++) maximum = Math.max(maximum, Math.abs(a[bus][ch][f] - b[bus][ch][f]));
  }
  assert.ok(maximum < 2e-7, `backend state transfer error ${maximum}`);
  assert.equal(p.messages.some(message => message.type === 'error'), false);
});

test('reset before installation is safe and keeps Audio unarmed', () => {
  const p = new Processor(); p.message({ type: 'reset' });
  assert.equal(p.ready, false); assert.equal(p.messages.some(message => message.type === 'error'), false);
  p.message({ type: 'dispose' }); assert.equal(p.process([], channels()), false);
});
